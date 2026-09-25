/*
 * roadWidths — partage l'espace des chaussées qui se longent après le graphe.
 * La largeur reste constante par chaîne, comme celle des rubans et des index.
 * Les contraintes se calculent sur les largeurs initiales puis s'appliquent
 * ensemble : l'ordre de parcours ne décide pas qui cède de la place.
 * Les chaînes qui partagent un sommet, les ouvrages et les niveaux distincts
 * restent hors de ce partage ; leurs rencontres relèvent du graphe.
 * Une chaîne portant un ouvrage est exclue entière pour conserver son gabarit.
 * Le partage exige un écart stable hors des surfaces de carrefour. Si un axe
 * pénètre la largeur nominale de l'autre, la paire est ambiguë et conservée :
 * une convergence ou un doublon ne donne pas la largeur d'une chaîne entière.
 */
import { JunctionAreas } from './roadJunctions.js';
import { RoadIndex, distanceToSegment } from './roadGraph.js';
import { BUNDLE_MIN_LENGTH_M, BUNDLE_PARALLEL_COS } from './roadBundles.js';

const PAS_M = 5;
// Un écart qui varie de plus de 20 % décrit une convergence, pas un gabarit.
const STABILITE_ECART = 0.8;
const clePoint = (p) => `${p.x},${p.z}`;

function seCroisent(a, b, c, d) {
  const ux = b.x - a.x, uz = b.z - a.z;
  const vx = d.x - c.x, vz = d.z - c.z;
  const determinant = ux * vz - uz * vx;
  if (Math.abs(determinant) < 1e-9) return false;
  const dx = c.x - a.x, dz = c.z - a.z;
  const t = (dx * vz - dz * vx) / determinant;
  const u = (dx * uz - dz * ux) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function fitParallelRoadWidths(chains, junctions = []) {
  const segments = chains.map((chain) => ({ ...chain, path: chain.works?.some(Boolean) ? [] : chain.points }));
  const index = new RoadIndex(segments, { margin: 0 });
  const facteurs = chains.map(() => 1);
  const aires = new JunctionAreas(junctions);
  const contraintes = [];
  const ambigues = new Set();
  const clePaire = (i, j) => `${Math.min(i, j)}:${Math.max(i, j)}`;
  const sommets = chains.map((chain) => new Set(chain.points.map(clePoint)));
  const voisins = new Map();
  const raccordes = (i, j) => {
    const cle = clePaire(i, j);
    if (!voisins.has(cle)) {
      const a = chains[i].points, b = chains[j].points;
      const rencontre = a.some((p, r) => sommets[j].has(clePoint(p)) ||
        (r + 1 < a.length && b.some((q, s) => s + 1 < b.length && seCroisent(p, a[r + 1], q, b[s + 1]))));
      voisins.set(cle, rencontre);
    }
    return voisins.get(cle);
  };

  for (let i = 0; i < segments.length; i++) {
    const route = segments[i];
    let actifs = new Map();
    const terminer = (j, plage) => {
      if (plage.longueur < BUNDLE_MIN_LENGTH_M) return;
      if (plage.ecartMin < STABILITE_ECART * plage.ecartMax) return;
      contraintes.push({ i, j, facteur: plage.facteur });
    };
    for (let r = 0; r < route.path.length - 1; r++) {
      const a = route.path[r], b = route.path[r + 1];
      const longueur = Math.hypot(b.x - a.x, b.z - a.z);
      if (!(longueur > 0)) continue;
      const tx = (b.x - a.x) / longueur, tz = (b.z - a.z) / longueur;
      const nombre = Math.ceil(longueur / PAS_M);
      const pas = longueur / nombre;
      for (let k = 0; k < nombre; k++) {
        const x = a.x + tx * (k + 0.5) * pas;
        const z = a.z + tz * (k + 0.5) * pas;
        const rencontres = new Map();
        if (!route.works?.[r] && !route.works?.[r + 1]) {
          const h = route.halfWidth;
          index.forEachNear(x - h, z - h, x + h, z + h, (autre, s, j) => {
            if (j === i || raccordes(i, j)) return;
            if (autre.works?.[s] || autre.works?.[s + 1]) return;
            if ((route.levels?.[r] ?? 0) !== (autre.levels?.[s] ?? 0)) return;
            const c = autre.path[s], d = autre.path[s + 1];
            const taille = Math.hypot(d.x - c.x, d.z - c.z);
            if (!(taille > 0)) return;
            const ux = (d.x - c.x) / taille, uz = (d.z - c.z) / taille;
            const cos = Math.abs(tx * ux + tz * uz);
            if (cos < BUNDLE_PARALLEL_COS) return;
            const projection = ((x - c.x) * ux + (z - c.z) * uz) / taille;
            if (projection < 0 || projection > 1) return;
            const lateral = (x - c.x) * uz - (z - c.z) * ux;
            // La borne couvre toute la cellule, pas seulement son milieu.
            const ecart = Math.abs(lateral) - Math.abs(tx * uz - tz * ux) * pas / 2;
            // Une paire ambiguë invalide aussi ses plages reconnues plus tôt.
            if (ecart < Math.max(h, autre.halfWidth)) {
              ambigues.add(clePaire(i, j));
              return;
            }
            const niveau = route.levels?.[r] ?? 0;
            const qx = c.x + projection * (d.x - c.x);
            const qz = c.z + projection * (d.z - c.z);
            if (aires.covers(x, z, niveau) || aires.covers(qx, qz, niveau)) return;
            const facteur = ecart * cos / (h + autre.halfWidth);
            if (!(facteur > 0 && facteur < 1)) return;
            const precedent = rencontres.get(j);
            if (!precedent || facteur < precedent.facteur) {
              rencontres.set(j, { facteur, ecart, cote: Math.sign(lateral) });
            }
          });
        }
        const suivants = new Map();
        for (const [j, rencontre] of rencontres) {
          const precedent = actifs.get(j);
          if (precedent && precedent.cote !== rencontre.cote) terminer(j, precedent);
          const suite = precedent?.cote === rencontre.cote ? precedent : null;
          suivants.set(j, {
            cote: rencontre.cote,
            longueur: (suite?.longueur ?? 0) + pas,
            facteur: Math.min(suite?.facteur ?? 1, rencontre.facteur),
            ecartMin: Math.min(suite?.ecartMin ?? Infinity, rencontre.ecart),
            ecartMax: Math.max(suite?.ecartMax ?? 0, rencontre.ecart),
          });
        }
        for (const [j, plage] of actifs) if (!rencontres.has(j)) terminer(j, plage);
        actifs = suivants;
      }
    }
    for (const [j, plage] of actifs) terminer(j, plage);
  }

  for (const { i, j, facteur } of contraintes) {
    if (ambigues.has(clePaire(i, j))) continue;
    facteurs[i] = Math.min(facteurs[i], facteur);
    facteurs[j] = Math.min(facteurs[j], facteur);
  }
  for (let i = 0; i < chains.length; i++) chains[i].halfWidth *= facteurs[i];
  // Les bouches doivent lire la même largeur que la chaîne qui les alimente.
  for (const junction of junctions) {
    for (const branche of junction.branches) {
      const p = branche.path?.[1];
      if (!p) continue;
      let largeur = branche.halfWidth;
      for (let i = 0; i < chains.length; i++) {
        if (facteurs[i] === 1 || chains[i].profile !== branche.profile) continue;
        if (!sommets[i].has(clePoint(junction))) continue;
        const points = chains[i].points;
        if (points.some((a, r) => r + 1 < points.length &&
          distanceToSegment(p.x, p.z, a.x, a.z, points[r + 1].x, points[r + 1].z).distance < 1e-5)) {
          largeur = Math.min(largeur, chains[i].halfWidth);
        }
      }
      branche.halfWidth = largeur;
    }
    const dominante = junction.branches.reduce((a, b) => a.halfWidth >= b.halfWidth ? a : b);
    junction.halfWidth = dominante.halfWidth;
    junction.profile = dominante.profile;
  }
}
