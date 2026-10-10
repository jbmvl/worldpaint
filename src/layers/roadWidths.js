/*
 * roadWidths — partage l'espace des chaussées qui se longent après le graphe.
 * La largeur reste constante par chaîne, comme celle des rubans et des index.
 * Les contraintes se calculent sur les largeurs initiales puis s'appliquent
 * ensemble : l'ordre de parcours ne décide pas qui cède de la place.
 * Les chaînes qui partagent un sommet, les ouvrages et les niveaux distincts
 * restent hors de ce partage ; leurs rencontres relèvent du graphe.
 * Une chaîne portant un ouvrage est exclue entière pour conserver son gabarit.
 * Le partage exige un écart stable hors des carrefours. Si un axe
 * pénètre la largeur nominale de l'autre, la paire est ambiguë et conservée :
 * une convergence ou un doublon ne donne pas la largeur d'une chaîne entière.
 * Sous une portée (`near`), seules les chaînes qui l'atteignent reçoivent leur
 * largeur : une paire n'est parcourue que si l'une des deux en est, et ces
 * chaînes-là sortent avec la même largeur que sans portée.
 * Un carrefour est ici un disque autour de son nœud, pas sa surface dessinée :
 * il ne dépend que du nœud et de sa branche la plus large, donc ni de
 * l'observateur ni des carrefours voisins, et ne demande aucune union de
 * polygones sur tout le réseau lu.
 */
import { RoadIndex, distanceToSegment } from './roadGraph.js';
import { BUNDLE_MIN_LENGTH_M, BUNDLE_PARALLEL_COS } from './roadBundles.js';

const PAS_M = 5;
// Un écart qui varie de plus de 20 % décrit une convergence, pas un gabarit.
const STABILITE_ECART = 0.8;
// Au-delà du rayon : l'emprise d'un carrefour posé juste dehors.
const MARGE_PORTEE_M = 30;
const clePoint = (p) => `${p.x},${p.z}`;

// Rayon du disque d'un carrefour : part de sa demi-largeur dominante, plus une marge.
const RAYON_CARREFOUR = 1.5;
const MARGE_CARREFOUR_M = 3;
const CELLULE_CARREFOUR_M = 64;
const cleCellule = (cx, cz) => cx * 67108864 + cz;

/** Rend `(x, z, niveau) → vrai` dans le disque d'un carrefour de ce niveau. */
function disquesDeCarrefour(junctions) {
  const cellules = new Map();
  for (const junction of junctions) {
    const rayon = junction.roundabout
      ? junction.roundabout.outer + junction.roundabout.halfWidth
      : RAYON_CARREFOUR * junction.halfWidth + MARGE_CARREFOUR_M;
    const disque = { x: junction.x, z: junction.z, rayon2: rayon * rayon, niveau: junction.level ?? 0 };
    for (let cx = Math.floor((junction.x - rayon) / CELLULE_CARREFOUR_M); cx <= Math.floor((junction.x + rayon) / CELLULE_CARREFOUR_M); cx++) {
      for (let cz = Math.floor((junction.z - rayon) / CELLULE_CARREFOUR_M); cz <= Math.floor((junction.z + rayon) / CELLULE_CARREFOUR_M); cz++) {
        const cle = cleCellule(cx, cz);
        const liste = cellules.get(cle);
        if (liste) liste.push(disque);
        else cellules.set(cle, [disque]);
      }
    }
  }
  return (x, z, niveau) => {
    const liste = cellules.get(cleCellule(Math.floor(x / CELLULE_CARREFOUR_M), Math.floor(z / CELLULE_CARREFOUR_M)));
    if (liste) for (const d of liste) if (d.niveau === niveau && (x - d.x) ** 2 + (z - d.z) ** 2 <= d.rayon2) return true;
    return false;
  };
}

function atteint(points, { x, z, radius }) {
  const portee = radius + MARGE_PORTEE_M;
  for (let r = 0; r + 1 < points.length; r++) {
    const a = points[r], b = points[r + 1];
    if (distanceToSegment(x, z, a.x, a.z, b.x, b.z).distance <= portee) return true;
  }
  return false;
}

function emprise(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Chaînes à parcourir sous une portée : celles qui l'atteignent, et celles
 * dont un échantillon peut encore contraindre l'une d'elles.
 */
function chainesUtiles(chains, near) {
  const utiles = chains.map((chain) => atteint(chain.points, near));
  const boites = chains.map((chain) => emprise(chain.points));
  const large = chains.reduce((max, chain) => Math.max(max, chain.halfWidth), 0);
  const parcourues = chains.map((chain, i) => {
    if (utiles[i]) return true;
    // Écart le plus grand qu'une contrainte accepte (`facteur < 1`), cellule comprise.
    const marge = (chain.halfWidth + large) / BUNDLE_PARALLEL_COS + PAS_M;
    const a = boites[i];
    return boites.some((b, j) => utiles[j] &&
      a.minX - marge <= b.maxX && a.maxX + marge >= b.minX && a.minZ - marge <= b.maxZ && a.maxZ + marge >= b.minZ);
  });
  return { utiles, parcourues };
}

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

/**
 * @param {Array} chains Chaînes revêtues ; leur `halfWidth` est réduite sur place.
 * @param {Array} [junctions] Carrefours du même graphe.
 * @param {{x:number,z:number,radius:number}|null} [near] Portée des chaussées bâties.
 */
export function fitParallelRoadWidths(chains, junctions = [], near = null) {
  const segments = chains.map((chain) => ({ ...chain, path: chain.works?.some(Boolean) ? [] : chain.points }));
  const index = new RoadIndex(segments, { margin: 0 });
  const facteurs = chains.map(() => 1);
  const enCarrefour = disquesDeCarrefour(junctions);
  const contraintes = [];
  const ambigues = new Set();
  const clePaire = (i, j) => `${Math.min(i, j)}:${Math.max(i, j)}`;
  const sommets = chains.map((chain) => new Set(chain.points.map(clePoint)));
  const voisins = new Map();
  const portee = near ? chainesUtiles(chains, near) : null;
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
    if (portee && !portee.parcourues[i]) continue;
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
            if (j === i || (portee && !portee.utiles[i] && !portee.utiles[j]) || raccordes(i, j)) return;
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
            if (enCarrefour(x, z, niveau) || enCarrefour(qx, qz, niveau)) return;
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
