/*
 * roadBundles — le faisceau : des voies qui vont ensemble, et le vide qui
 * reste entre elles.
 *
 * ## Ce qu'un faisceau est, et ce qu'il n'est pas
 *
 * Deux chaussées peuvent être proches pour trois raisons qui n'ont rien à voir
 * l'une avec l'autre : elles se **croisent** (le graphe le sait déjà, c'est un
 * carrefour), elles passent l'une **au-dessus** de l'autre (le niveau le dit,
 * c'est le lot A), ou elles se **longent** — une piste cyclable le long d'une
 * départementale, une contre-allée, deux sens séparés, une voie de desserte
 * qui double une traversée de bourg. Ce troisième cas n'était nommé nulle
 * part, et c'est celui qui laisse entre deux rives une bande de terrain de
 * deux mètres où l'herbe pousse au milieu du bitume.
 *
 * Un faisceau ne se reconnaît **pas** à une distance. Six conditions tenues
 * ensemble, et aucune n'est suffisante seule :
 *
 *   1. **même niveau** — deux chaussées superposées ne se longent pas, elles
 *      se survolent (`levels`, lot A) ;
 *   2. **écart borné** — de rive à rive, et non d'axe à axe : deux voies
 *      larges dont les axes sont à quinze mètres peuvent avoir leurs rives à
 *      un mètre ;
 *   3. **parallélisme** — les deux tangentes font un angle faible. Deux voies
 *      qui se coupent passent forcément près l'une de l'autre juste avant de
 *      se couper, et ce n'est pas un longement ;
 *   4. **longueur de la zone de voisinage** — un faisceau se tient sur une
 *      certaine longueur. En deçà, c'est un frôlement : une bretelle qui
 *      s'écarte, deux tracés qui divergent ;
 *   5. **continuité de l'interlocuteur** — c'est la *même* chaussée d'en face
 *      d'un bout à l'autre. Une rive qui répond tantôt à l'une tantôt à
 *      l'autre traverse un nœud, elle ne longe rien ;
 *   6. **hors carrefour et hors ouvrage** — un carrefour a déjà sa surface, et
 *      sous un viaduc il n'y a pas de sol à traiter.
 *
 * ## Ce qu'on fait du vide (R2)
 *
 * On le **peint**, on ne le referme pas : aucune géométrie de chaussée n'est
 * déplacée, élargie ni recouverte. Le comblement est une nappe réglée tendue
 * entre les deux rives, sommet par sommet, à la cote de chacune — donc sans
 * fente ni marche d'un côté ni de l'autre — et hachurée en bandes alternées
 * comme un zébra. Les hachures **sont** le maillage : une bande peinte et une
 * bande de revêtement, pas deux surfaces coplanaires qui se disputeraient la
 * profondeur.
 *
 * ## Ce qu'on ne remplit jamais (R1)
 *
 * Une aire **close** par des chaussées n'est pas un vide de construction :
 * c'est un îlot, et un îlot reste le terrain — avec ses arbres. Le centre d'un
 * giratoire en est le cas propre.
 *
 * La règle est locale et géométrique : **un vide dont les deux rives se
 * courbent vers lui est un enclos.** C'est exactement ce qui distingue un
 * anneau d'un longement. Les deux rives intérieures d'un giratoire sont deux
 * arcs du même cercle, et leurs centres de courbure sont tous les deux dans le
 * vide. Deux voies parallèles en courbe, elles, tournent autour d'un centre
 * qui est du même côté pour les deux : l'une est concave vers le vide,
 * l'autre convexe. Un îlot triangulaire entre deux branches qui divergent n'a
 * aucune rive courbe, et se remplit — ce qui est bien ce qu'on en fait.
 *
 * ## L'absorption : ce qu'on ne dessine pas du tout
 *
 * Peindre le vide ne suffisait pas, et en ville c'était même le contraire d'un
 * remède. Un boulevard urbain est relevé dans OSM en cinq ou six voies
 * parallèles — la contre-allée, la desserte, la voie de bus, chaque sens —, et
 * les dessiner toutes donne un tas de rubans qui se chevauchent, hachuré de
 * zébras dans chaque interstice. Le paysage n'y gagne aucune information : ces
 * voies **sont** la même chaussée.
 *
 * D'où une seconde réponse, posée bien plus tôt — sur les **lignes**, avant
 * que le graphe n'en fasse des chaînes, donc sans toucher ni aux nœuds ni au
 * mobilier : une voie de rang inférieur qui longe une voie de rang supérieur
 * sur l'essentiel de sa longueur n'est pas dessinée (`absorbParallelLines`).
 * Elle est déjà là, dans la largeur de l'autre.
 *
 * Deux garde-fous, et ils disent tout ce que l'absorption n'est pas :
 *
 *   - seuls les **profils absorbables** le sont (`ABSORBABLE_PROFILES`). Une
 *     piste cyclable n'en fait pas partie, et c'est délibéré : on veut
 *     précisément la voir. Un chemin non plus — un chemin de terre le long
 *     d'une route est un objet du paysage, pas une redondance de saisie ;
 *   - le rang doit être **strictement** supérieur. Deux chaussées de même
 *     profil qui se longent sont les deux sens d'une même route : aucune des
 *     deux n'est de trop, et c'est le comblement qui les réunit — en
 *     revêtement plein, pas en zébra (voir `gapIsSeam`).
 *
 * Module pur : aucun `three`, testable sous Node.
 */

import { distanceToSegment } from './roadGraph.js';
import { LEVEL_GROUND } from './roadWorks.js';

/**
 * Écart maximal entre deux rives, en mètres, au-delà duquel l'entre-deux n'est
 * plus un vide mais un intervalle : il y a la place d'un accotement, d'un
 * fossé, d'un trottoir, de quelque chose. Ce n'est pas la condition d'un
 * faisceau — c'en est une sur six.
 */
export const BUNDLE_GAP_MAX_M = 4;

/**
 * Cosinus au-delà duquel deux tangentes sont parallèles (une vingtaine de
 * degrés). Pris en valeur absolue : deux sens séparés se longent en marchant
 * en sens inverse.
 */
export const BUNDLE_PARALLEL_COS = Math.cos((20 * Math.PI) / 180);

/**
 * Longueur minimale d'un longement, en mètres. En deçà, deux tracés se
 * frôlent — ce que fait toute paire de voies qui finit par se couper.
 */
export const BUNDLE_MIN_LENGTH_M = 15;

/**
 * Rayon de courbure, en mètres, en deçà duquel une rive est **courbe vers le
 * vide** (R1).
 *
 * Un rayon, et non un écart à la corde : l'écart dépend du pas
 * d'échantillonnage, le rayon non. Deux cents mètres est la limite entre une
 * route qui tourne — un giratoire, une contre-courbe de village — et une route
 * qui va tout droit avec le relief.
 */
export const BUNDLE_CONCAVE_RADIUS_M = 200;

/** Pas des hachures, en mètres : bande peinte et bande de revêtement. */
export const ZEBRA_PITCH_M = 0.9;

/**
 * La rive qui fait face à un point de rive, ou `null`.
 *
 * @param {Object} segment Tronçon interrogé.
 * @param {number} r Ligne.
 * @param {number} side `+1` ou `-1`, côté de la rive.
 * @param {Object} options
 * @param {Object} options.roadIndex `RoadIndex` des chaussées.
 * @param {Object|null} [options.areas] `JunctionAreas`.
 * @param {Function|null} [options.accept] `(segment) => boolean`.
 * @param {number} [options.gapMax]
 * @param {number} [options.parallelCos]
 * @returns {{other:Object, row:number, gap:number, near:Object, far:Object,
 *           outward:{x:number,z:number}}|null}
 */
export function facingEdgeAt(
  segment,
  r,
  side,
  {
    roadIndex,
    areas = null,
    accept = null,
    gapMax = BUNDLE_GAP_MAX_M,
    parallelCos = BUNDLE_PARALLEL_COS,
  }
) {
  const { path, frames, halfWidth } = segment;
  if (!path || !frames || r < 0 || r >= path.length) return null;
  if (segment.junction && segment.junction[r] >= 0) return null;
  if (segment.works && segment.works[r]) return null;

  const level = segment.levels?.[r] ?? LEVEL_GROUND;
  const px = frames[r * 4 + 2];
  const pz = frames[r * 4 + 3];
  const ex = path[r].x + px * side * halfWidth;
  const ez = path[r].z + pz * side * halfWidth;

  // Un carrefour a déjà sa surface : il n'y a pas de vide à peindre dedans.
  if (areas && areas.covers(ex, ez, level)) return null;

  let best = null;
  roadIndex.forEachNear(ex - gapMax, ez - gapMax, ex + gapMax, ez + gapMax, (other, row) => {
    if (other === segment) return;
    if (accept && !accept(other)) return;
    if ((other.levels?.[row] ?? LEVEL_GROUND) !== level) return;
    if (other.works && (other.works[row] || other.works[row + 1])) return;
    if (other.junction && (other.junction[row] >= 0 || other.junction[row + 1] >= 0)) return;

    const a = other.path[row];
    const b = other.path[row + 1];
    if (!a || !b) return;
    const hit = distanceToSegment(ex, ez, a.x, a.z, b.x, b.z);
    const gap = hit.distance - other.halfWidth;
    if (!(gap > 0) || gap > gapMax) return;
    if (best && gap >= best.gap) return;

    // Parallélisme : la tangente de l'arête d'en face contre la nôtre.
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const length = Math.hypot(tx, tz);
    if (length < 1e-6) return;
    tx /= length;
    tz /= length;
    const cos = Math.abs(tx * frames[r * 4] + tz * frames[r * 4 + 1]);
    if (cos < parallelCos) return;

    // Le point de leur rive qui nous fait face : sur l'axe, puis ramené vers
    // nous de sa demi-largeur.
    const ax = a.x + (b.x - a.x) * hit.t;
    const az = a.z + (b.z - a.z) * hit.t;
    let ox = ex - ax;
    let oz = ez - az;
    const reach = Math.hypot(ox, oz);
    if (!(reach > 1e-6)) return;
    ox /= reach;
    oz /= reach;

    best = {
      other,
      row,
      t: hit.t,
      gap,
      near: { x: ex, z: ez, deck: segment.platform[r], distance: path[r].distance },
      far: {
        x: ax + ox * other.halfWidth,
        z: az + oz * other.halfWidth,
        deck: other.platform[row] + (other.platform[row + 1] - other.platform[row]) * hit.t,
      },
      // Du nôtre vers le leur : la direction dans laquelle le vide s'ouvre.
      outward: { x: -ox, z: -oz },
    };
  });

  return best;
}

/**
 * Vrai si une rive se courbe **vers** une direction donnée (R1).
 *
 * Le centre de courbure est du côté vers lequel pointe l'accélération du
 * tracé — la différence de ses deux pas successifs. Aucune convention de sens
 * de parcours n'y entre : c'est une mesure, pas une déduction. L'écart est
 * rapporté au carré du pas, ce qui en fait une **courbure** : la réponse ne
 * change pas si le tracé est échantillonné plus fin.
 *
 * @param {Array<{x:number,z:number}>} path
 * @param {number} r
 * @param {{x:number,z:number}} towards Direction unitaire.
 * @param {number} [radius] Rayon de courbure limite, en mètres.
 * @returns {boolean}
 */
export function curvesTowards(path, r, towards, radius = BUNDLE_CONCAVE_RADIUS_M) {
  if (!path || r <= 0 || r >= path.length - 1) return false;
  const ax = path[r + 1].x - 2 * path[r].x + path[r - 1].x;
  const az = path[r + 1].z - 2 * path[r].z + path[r - 1].z;
  const step =
    (Math.hypot(path[r].x - path[r - 1].x, path[r].z - path[r - 1].z) +
      Math.hypot(path[r + 1].x - path[r].x, path[r + 1].z - path[r].z)) /
    2;
  if (!(step > 1e-6) || !(radius > 0)) return false;
  return ax * towards.x + az * towards.z > (step * step) / radius;
}

/**
 * Longueur d'une suite de couples de rives, mesurée du côté interrogé.
 * @param {Array<Object>} pairs
 * @returns {number}
 */
export function gapLength(pairs) {
  let total = 0;
  for (let i = 1; i < pairs.length; i++) {
    total += Math.hypot(pairs[i].near.x - pairs[i - 1].near.x, pairs[i].near.z - pairs[i - 1].near.z);
  }
  return total;
}

/**
 * Les vides d'un réseau : les entre-deux de faisceau qu'il faut peindre.
 *
 * Coût linéaire en nombre de lignes : chaque rive n'interroge que les cellules
 * de l'index qui touchent une boîte de quatre mètres. Aucune comparaison de
 * tronçon à tronçon.
 *
 * @param {Array<Object>} segments Tronçons publiés par `RoadNetwork`.
 * @param {Object} options
 * @param {Object} options.roadIndex `RoadIndex` des chaussées.
 * @param {Object|null} [options.areas] `JunctionAreas`.
 * @param {Function|null} [options.accept] `(segment) => boolean` : les
 *        chaussées qui peuvent participer à un faisceau (revêtues).
 * @param {Function|null} [options.taken] `(x, z) => boolean` : ce qui occupe
 *        déjà le sol et n'a pas à être repeint (une bande de trottoir).
 * @param {number} [options.gapMax]
 * @param {number} [options.minLength]
 * @param {number} [options.parallelCos]
 * @param {number} [options.concave] Rayon de courbure limite (R1).
 * @returns {Array<{a:Object, side:number, other:Object, pairs:Array<Object>}>}
 */
export function collectRoadGaps(
  segments,
  {
    roadIndex,
    areas = null,
    accept = null,
    taken = null,
    gapMax = BUNDLE_GAP_MAX_M,
    minLength = BUNDLE_MIN_LENGTH_M,
    parallelCos = BUNDLE_PARALLEL_COS,
    concave = BUNDLE_CONCAVE_RADIUS_M,
  }
) {
  const out = [];
  if (!roadIndex || !Array.isArray(segments)) return out;

  // Chaque vide est vu deux fois, une par rive. L'ordre de publication des
  // tronçons tranche — il ne dépend ni de l'observateur ni du parcours.
  const rank = new Map();
  for (let i = 0; i < segments.length; i++) rank.set(segments[i], i);

  for (const segment of segments) {
    if (accept && !accept(segment)) continue;
    if (!segment.frames || !segment.platform) continue;
    const rows = segment.path.length;

    for (const side of [1, -1]) {
      let run = null;
      let partner = null;

      const flush = () => {
        if (run && run.length >= 2 && gapLength(run) >= minLength) {
          out.push({ a: segment, side, other: partner, pairs: run });
        }
        run = null;
        partner = null;
      };

      for (let r = 0; r < rows; r++) {
        const hit = facingEdgeAt(segment, r, side, {
          roadIndex,
          areas,
          accept,
          gapMax,
          parallelCos,
        });
        // Continuité de l'interlocuteur : changer de vis-à-vis referme le vide.
        if (!hit || hit.other !== partner) flush();
        if (!hit) continue;
        // Le vide n'appartient qu'au tronçon de plus petit rang : sinon il
        // serait peint deux fois, une fois par rive.
        if ((rank.get(hit.other) ?? 0) < (rank.get(segment) ?? 0)) continue;
        // Ce que le sol porte déjà n'est pas un vide. Sondé des deux rives et
        // au milieu : un trottoir n'occupe souvent qu'un côté de l'entre-deux,
        // et le peindre par-dessus le reste serait deux revêtements au même
        // endroit.
        if (taken && [0, 0.5, 1].some((t) => taken(
          hit.near.x + (hit.far.x - hit.near.x) * t,
          hit.near.z + (hit.far.z - hit.near.z) * t
        ))) {
          flush();
          continue;
        }

        // R1 : un vide dont les deux rives se courbent vers lui est un enclos.
        const inward = { x: -hit.outward.x, z: -hit.outward.z };
        if (
          curvesTowards(segment.path, r, hit.outward, concave) &&
          curvesTowards(hit.other.path, hit.row, inward, concave)
        ) {
          flush();
          continue;
        }

        if (!run) {
          run = [];
          partner = hit.other;
        }
        run.push(hit);
      }
      flush();
    }
  }

  return out;
}

/**
 * Hachure un vide : une nappe réglée entre les deux rives, découpée en bandes
 * alternées en travers.
 *
 * Le rang d'une bande est tiré de l'**abscisse curviligne de la chaussée**,
 * comptée depuis son ancre de graphe (`startDistance`), et non du rang de la
 * bande dans la boucle : deux reconstructions qui découpent la chaîne
 * ailleurs posent les mêmes hachures aux mêmes endroits.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} gap Vide rendu par `collectRoadGaps`.
 * @param {Object} options
 * @param {number[]} options.paint  Couleur de la bande peinte, linéaire.
 * @param {number[]} options.ground Couleur de la bande de revêtement.
 * @param {number} [options.pitch]
 * @param {number} [options.lift]
 * @param {number} [options.startDistance] Abscisse de la première ligne.
 * @returns {number} bandes posées.
 */
export function appendZebra(
  buffer,
  gap,
  { paint, ground, pitch = ZEBRA_PITCH_M, lift = 0, startDistance = 0 }
) {
  const pairs = gap?.pairs;
  if (!Array.isArray(pairs) || pairs.length < 2) return 0;
  let bands = 0;

  // Sens de rotation, mesuré une fois sur le premier quadrilatère : selon le
  // côté de la rive, la marche et la direction du vide tournent dans un sens
  // ou dans l'autre, et une face à l'envers serait noire.
  const up =
    (pairs[0].far.z - pairs[0].near.z) * (pairs[1].near.x - pairs[0].near.x) -
    (pairs[0].far.x - pairs[0].near.x) * (pairs[1].near.z - pairs[0].near.z);
  const flip = up < 0;

  for (let i = 1; i < pairs.length; i++) {
    const from = pairs[i - 1];
    const to = pairs[i];
    const span = Math.hypot(to.near.x - from.near.x, to.near.z - from.near.z);
    const steps = Math.max(1, Math.round(span / pitch));
    const d0 = startDistance + (from.near.distance ?? 0);
    const d1 = startDistance + (to.near.distance ?? 0);

    for (let k = 0; k < steps; k++) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const mid = d0 + (d1 - d0) * (t0 + t1) * 0.5;
      const painted = Math.floor(mid / pitch) % 2 === 0;
      const color = painted ? paint : ground;

      const base = buffer.positions.length / 3;
      for (const t of [t0, t1]) {
        for (const edge of ['near', 'far']) {
          const a = from[edge];
          const b = to[edge];
          buffer.positions.push(
            a.x + (b.x - a.x) * t,
            a.deck + (b.deck - a.deck) * t + lift,
            a.z + (b.z - a.z) * t
          );
          buffer.colors.push(color[0], color[1], color[2]);
        }
      }
      // (near₀, far₀, near₁, far₁) : deux triangles.
      if (flip) buffer.indices.push(base, base + 3, base + 1, base, base + 2, base + 3);
      else buffer.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
      bands++;
    }
  }

  return bands;
}

/**
 * Vrai si le vide entre deux rives est une **couture** et non un îlot : les
 * deux chaussées sont du même profil, donc ce sont les deux sens de la même
 * route, et l'entre-deux est de la chaussée qu'on n'a pas relevée.
 *
 * Un zébra dit « ne roulez pas ici ». Le poser entre les deux chaussées d'un
 * boulevard est faux deux fois : ce n'est pas un îlot, et les hachures
 * couvrent la seule chose qui rende un boulevard lisible — son marquage. La
 * couture se comble donc en revêtement plein.
 *
 * @param {{a:Object, other:Object}} gap Vide rendu par `collectRoadGaps`.
 * @returns {boolean}
 */
export function gapIsSeam(gap) {
  return !!gap && !!gap.a && !!gap.other && gap.a.profile === gap.other.profile;
}

/**
 * Comble un vide d'une nappe unie, sans hachure : une bande de quadrilatères
 * tendue de rive à rive, un par couple de sections.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} gap Vide rendu par `collectRoadGaps`.
 * @param {Object} options
 * @param {number[]} options.color Couleur du revêtement, linéaire.
 * @param {number} [options.lift]
 * @returns {number} quadrilatères posés.
 */
export function appendGapSurface(buffer, gap, { color, lift = 0 }) {
  const pairs = gap?.pairs;
  if (!Array.isArray(pairs) || pairs.length < 2 || !color) return 0;

  // Même mesure de sens de rotation qu'`appendZebra`, et pour la même raison :
  // selon la rive interrogée, la marche et la direction du vide tournent dans
  // un sens ou dans l'autre, et une face à l'envers serait noire.
  const up =
    (pairs[0].far.z - pairs[0].near.z) * (pairs[1].near.x - pairs[0].near.x) -
    (pairs[0].far.x - pairs[0].near.x) * (pairs[1].near.z - pairs[0].near.z);
  const flip = up < 0;
  let laid = 0;

  for (let i = 1; i < pairs.length; i++) {
    const base = buffer.positions.length / 3;
    for (const at of [pairs[i - 1], pairs[i]]) {
      for (const edge of ['near', 'far']) {
        buffer.positions.push(at[edge].x, at[edge].deck + lift, at[edge].z);
        buffer.colors.push(color[0], color[1], color[2]);
      }
    }
    if (flip) buffer.indices.push(base, base + 3, base + 1, base, base + 2, base + 3);
    else buffer.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    laid++;
  }

  return laid;
}

/**
 * Profils qu'une voie plus grande peut absorber. Ce sont les voies dont la
 * présence dans la donnée décrit une **desserte** plutôt qu'un objet du
 * paysage : contre-allée, voie de bus, parking longitudinal, doublon de saisie.
 *
 * Ni `cycleway` (qu'on veut voir), ni `track`/`path` (un chemin de terre le
 * long d'une route n'est pas une redondance), ni `express`/`major` (qui n'ont
 * personne au-dessus d'eux).
 */
export const ABSORBABLE_PROFILES = new Set(['lane', 'minor']);

/**
 * Écart maximal, de rive à rive, en deçà duquel une voie est **dans** la
 * largeur d'une autre, en mètres.
 *
 * Plus large que `BUNDLE_GAP_MAX_M`, et ce n'est pas la même mesure : le
 * comblement demande « reste-t-il un vide trop étroit pour porter quoi que ce
 * soit ? », l'absorption demande « cette voie longe-t-elle celle-là ? ». Six
 * mètres, c'est-à-dire la place d'un trottoir et d'une file de stationnement :
 * au-delà, deux rues parallèles sont deux rues.
 */
export const ABSORB_GAP_M = 6;

/**
 * Part de sa longueur qu'une voie doit passer le long d'une autre pour être
 * absorbée. En deçà, elle s'en écarte : c'est une rue qui part, pas un
 * doublon.
 */
export const ABSORB_SHARE = 0.75;

/** Côté d'une maille de l'index de lignes, en mètres. */
const ABSORB_CELL_M = 24;

/**
 * Écarte les voies redondantes d'un jeu de lignes de chaussée.
 *
 * Posée sur les **lignes**, avant `mergeRoadLines` : ce qui n'est pas dessiné
 * n'entre pas dans le graphe, ne crée pas de nœud, ne numérote pas de
 * mobilier et ne fabrique pas de carrefour. Une absorption faite plus tard
 * laisserait derrière elle des carrefours sans branche.
 *
 * Les candidats sont traités **du meilleur rang au pire** : une desserte
 * absorbée par une rue elle-même absorbée par un boulevard ne peut pas
 * survivre à sa rue.
 *
 * @param {Array<{profile:string, halfWidth:number, points:Array, level:number}>} lines
 * @param {Object} options
 * @param {Array<string>} options.order Hiérarchie des profils, du plus large
 *        au plus étroit (`roadNetwork.ROAD_PROFILE_ORDER`).
 * @param {Set<string>} [options.absorbable]
 * @param {number} [options.gapMax]
 * @param {number} [options.share]
 * @param {number} [options.parallelCos]
 * @param {Function|null} [options.where] `(x, z) => boolean` : où l'absorption
 *        s'applique. Absente, partout.
 * @returns {Array<Object>} les lignes conservées, dans leur ordre d'origine.
 */
export function absorbParallelLines(
  lines,
  {
    order = [],
    absorbable = ABSORBABLE_PROFILES,
    gapMax = ABSORB_GAP_M,
    share = ABSORB_SHARE,
    parallelCos = BUNDLE_PARALLEL_COS,
    where = null,
  } = {}
) {
  if (!Array.isArray(lines) || lines.length === 0) return lines || [];
  const rankOf = (profile) => {
    const at = order.indexOf(profile);
    return at < 0 ? order.length : at;
  };

  // Index de mailles sur les segments de toutes les lignes : une voie de ville
  // en croise des centaines, et la comparaison de ligne à ligne coûterait le
  // carré du réseau.
  const cells = new Map();
  const key = (cx, cz) => cx * 73856093 + cz * 19349663;
  const spans = [];
  for (let li = 0; li < lines.length; li++) {
    const points = lines[li].points;
    if (!Array.isArray(points) || points.length < 2) continue;
    for (let i = 1; i < points.length; i++) {
      const span = { line: li, a: points[i - 1], b: points[i] };
      spans.push(span);
      const minX = Math.floor(Math.min(span.a.x, span.b.x) / ABSORB_CELL_M);
      const maxX = Math.floor(Math.max(span.a.x, span.b.x) / ABSORB_CELL_M);
      const minZ = Math.floor(Math.min(span.a.z, span.b.z) / ABSORB_CELL_M);
      const maxZ = Math.floor(Math.max(span.a.z, span.b.z) / ABSORB_CELL_M);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const at = key(cx, cz);
          const bucket = cells.get(at);
          if (bucket) bucket.push(span);
          else cells.set(at, [span]);
        }
      }
    }
  }

  const dropped = new Set();
  const candidates = [];
  for (let li = 0; li < lines.length; li++) {
    if (absorbable.has(lines[li].profile) && lines[li].points?.length >= 2) candidates.push(li);
  }
  candidates.sort((a, b) => rankOf(lines[a].profile) - rankOf(lines[b].profile));

  for (const li of candidates) {
    const line = lines[li];
    const mine = rankOf(line.profile);
    const level = line.level ?? LEVEL_GROUND;
    const points = line.points;
    let total = 0;
    let covered = 0;

    for (let i = 0; i < points.length; i++) {
      // Poids d'un sommet : la moitié de chacun de ses segments voisins. La
      // part mesurée est donc une **longueur**, pas un compte de sommets — la
      // donnée n'échantillonne pas régulièrement.
      const before = i > 0 ? Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) : 0;
      const after =
        i < points.length - 1
          ? Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z)
          : 0;
      const weight = (before + after) / 2;
      if (!(weight > 0)) continue;
      total += weight;
      if (where && !where(points[i].x, points[i].z)) continue;

      // Tangente locale, prise sur les deux voisins présents.
      const from = points[Math.max(0, i - 1)];
      const to = points[Math.min(points.length - 1, i + 1)];
      let tx = to.x - from.x;
      let tz = to.z - from.z;
      const length = Math.hypot(tx, tz);
      if (!(length > 1e-6)) continue;
      tx /= length;
      tz /= length;

      const reach = gapMax + line.halfWidth;
      const minX = Math.floor((points[i].x - reach) / ABSORB_CELL_M);
      const maxX = Math.floor((points[i].x + reach) / ABSORB_CELL_M);
      const minZ = Math.floor((points[i].z - reach) / ABSORB_CELL_M);
      const maxZ = Math.floor((points[i].z + reach) / ABSORB_CELL_M);
      let hit = false;

      for (let cx = minX; cx <= maxX && !hit; cx++) {
        for (let cz = minZ; cz <= maxZ && !hit; cz++) {
          const bucket = cells.get(key(cx, cz));
          if (!bucket) continue;
          for (const span of bucket) {
            if (span.line === li || dropped.has(span.line)) continue;
            const other = lines[span.line];
            if (rankOf(other.profile) >= mine) continue;
            if ((other.level ?? LEVEL_GROUND) !== level) continue;

            const seen = distanceToSegment(
              points[i].x,
              points[i].z,
              span.a.x,
              span.a.z,
              span.b.x,
              span.b.z
            );
            if (seen.distance - other.halfWidth - line.halfWidth > gapMax) continue;

            let ox = span.b.x - span.a.x;
            let oz = span.b.z - span.a.z;
            const olength = Math.hypot(ox, oz);
            if (!(olength > 1e-6)) continue;
            if (Math.abs((ox / olength) * tx + (oz / olength) * tz) < parallelCos) continue;

            hit = true;
            break;
          }
        }
      }

      if (hit) covered += weight;
    }

    if (total > 0 && covered / total >= share) dropped.add(li);
  }

  return dropped.size === 0 ? lines : lines.filter((_, li) => !dropped.has(li));
}
