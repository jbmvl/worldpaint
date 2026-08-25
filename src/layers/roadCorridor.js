/*
 * roadCorridor — l'emprise routière, frontière partagée du paysage.
 * ------------------------------------------------------------------
 * La chaussée n'est pas une couche de plus posée à côté des autres : c'est la
 * **structure dominante** du paysage, et donc une frontière que le reste du
 * décor n'a pas le droit de franchir. Une haie qui traverse une départementale,
 * une clôture plantée en travers d'une voie communale, une botte de paille au
 * milieu du bitume : trois défauts différents à première vue, une seule cause.
 *
 * Ce module donne un nom à cette frontière, et deux façons de l'interroger.
 * Il est **entièrement pur** — ni three.js, ni géométrie de rendu, ni état :
 * ce sont les règles, pas leur exécution, et elles se testent sous Node.
 *
 * ## Ce que « l'emprise » recouvre exactement
 *
 * La chaussée, **plus l'accotement excavé** — le fond plat de l'entaille que
 * `roadCut` creuse dans le terrain. Ce n'est pas une valeur de plus à régler :
 * c'est la même largeur, importée du même endroit. Le terrain est terrassé
 * jusque-là, donc rien n'y pousse ; au-delà commence le raccord, où le sol
 * redevient naturel et où la haie, le fossé et l'alignement d'arbres ont leur
 * place — c'est d'ailleurs là que `furnitureLayer` les met déjà.
 *
 * Une seule définition, donc, là où trois marges dispersées disaient à peu près
 * la même chose sans le dire (`0.5` pour l'herbe, `1` pour les cultures, rien
 * du tout pour les haies et les jardins).
 *
 * ## Pourquoi une découpe, et pas un simple rejet
 *
 * Une haie est une **polyligne**, pas un point. Un contour de parcelle que la
 * route traverse mesure trois cents mètres et n'en a que huit de fautifs :
 * l'écarter en entier effacerait le bocage à chaque croisement, le garder
 * entier poserait un tube vert en travers de la chaussée. La bonne réponse est
 * de le **couper** — deux tronçons, interpolés au point exact de traversée.
 *
 * C'est `clipOutsideCorridor` qui fait ça, et c'est la seule pièce non triviale
 * du module.
 *
 * ## Ce que ce module n'est pas
 *
 * Il ne connaît ni les carrefours, ni la hiérarchie des routes, ni ce qui se
 * pose au bord. Il répond à une question et une seule — « suis-je dans
 * l'emprise ? » — pour que les couches végétales n'aient jamais à lire
 * `roadSegments`. Elles n'ont pas besoin du réseau, seulement de sa frontière.
 */

import { ROAD_CUT_M } from '../terrain/roadCut.js';

/**
 * Débord de l'emprise au-delà de la rive de la chaussée, en mètres.
 *
 * C'est **exactement** le fond plat du déblai (`ROAD_CUT_M`), et l'égalité
 * n'est pas une coïncidence qu'on entérine : le terrain est arasé au niveau de
 * la plate-forme sur toute cette largeur, donc un objet posé là serait posé sur
 * de la voirie. Les deux valeurs doivent bouger ensemble ; elles n'ont donc
 * qu'une seule définition, et c'est celle de `roadCut`.
 */
export const CORRIDOR_MARGIN_M = ROAD_CUT_M;

/**
 * Pas de sondage le long d'une polyligne, en mètres.
 *
 * Il doit être plus court que la plus étroite des emprises, sinon une haie
 * perpendiculaire pourrait l'enjamber entre deux sondages sans qu'on s'en
 * aperçoive. La plus étroite est celle d'un sentier — 1,4 m de large, soit
 * 3,8 m d'emprise avec ses deux accotements — et les contours de parcelle sont
 * ré-échantillonnés tous les six mètres, donc le sondage ne peut pas se
 * contenter des sommets fournis : il lui faut son propre pas, plus fin.
 */
export const CORRIDOR_PROBE_M = 1;

/**
 * Itérations de dichotomie pour situer une traversée.
 *
 * Huit passes ramènent l'incertitude à 1/256 du pas de sondage, soit quatre
 * millimètres. Chercher mieux n'aurait pas de sens : l'emprise elle-même est
 * une idée à dix centimètres près.
 */
export const CORRIDOR_BISECT_STEPS = 8;

/**
 * Vrai si un point tombe dans l'emprise d'une chaussée.
 *
 * C'est la question que toutes les couches doivent poser — et la seule. Sans
 * index (pas encore de réseau construit, ou aucune route dans la bulle), la
 * réponse est « non » : on ne devine pas une route absente.
 *
 * Fonction pure.
 *
 * `accept` permet d'ignorer certaines chaussées, et sert exactement une fois :
 * ce qui **borde** une route — son fossé, sa haie de bas-côté — est posé à un
 * ou deux mètres de sa rive et doit l'ignorer, tout en s'arrêtant net à chaque
 * rue transversale. Sans lui, la règle reposerait sur la seule promesse que
 * l'appelant se décale toujours d'un peu plus que l'accotement, ce qui n'est
 * pas une garantie mais une coïncidence entretenue à la main.
 *
 * @param {Object|null} index Instance `RoadIndex`, ou `null`.
 * @param {number} x Mètres locaux.
 * @param {number} z
 * @param {number} [margin] Débord au-delà de la rive, en mètres.
 * @param {Function|null} [accept] `(segment, index) => boolean`, pour ne
 *        retenir que certaines chaussées.
 * @returns {boolean}
 */
export function inCorridor(index, x, z, margin = CORRIDOR_MARGIN_M, accept = null) {
  if (!index) return false;
  if (!accept) return index.covers(x, z, margin);
  return index.query(x, z, margin, accept) !== null;
}

/**
 * Ne garde que les points hors emprise.
 *
 * Pour tout ce qui se sème par points — bottes de paille, troupeaux, rochers,
 * touffes de fougère. L'ordre et les valeurs des points conservés ne changent
 * pas : le semis reste celui que le tirage ancré au sol a produit, on n'en
 * retire que ce qui tombait sur la voirie.
 *
 * Fonction pure.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {Object|null} index Instance `RoadIndex`, ou `null`.
 * @param {number} [margin]
 * @returns {Array<{x:number,z:number}>}
 */
export function filterOutsideCorridor(points, index, margin = CORRIDOR_MARGIN_M) {
  if (!Array.isArray(points)) return [];
  if (!index) return points;
  return points.filter((p) => p && !index.covers(p.x, p.z, margin));
}

/** Marge de sécurité au-delà de la rive stricte de l'emprise, pour `pushOutsideCorridor`. */
export const CORRIDOR_PUSH_CLEARANCE_M = 0.15;

/** Écarts au-delà desquels `pushOutsideCorridor` renonce à repousser un point (carrefours serrés). */
const CORRIDOR_PUSH_ITERATIONS = 4;

/**
 * Écarte un point de l'emprise, sans le supprimer.
 *
 * `filterOutsideCorridor` retire, `clipOutsideCorridor` coupe : aucun des deux
 * ne convient à un contour de parcelle. Une limite de champ suit très souvent
 * le bord d'une route sur toute sa longueur — c'est la définition même du
 * bocage —, et sa distance à l'axe est un hasard du tracé cadastral, pas une
 * décision de composition. La couper à chaque sondage qui tombe dans l'emprise
 * ne laisse **aucun** tronçon dehors : toute la haie disparaît, faute d'un
 * seul point réellement extérieur d'où repartir. La repousser au ras de
 * l'emprise, en revanche, garde la haie continue — c'est elle qui trace le
 * bocage, pas la route.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object|null} index Instance `RoadIndex`, ou `null`.
 * @param {number} [margin]
 * @param {number} [clearance] Débord au-delà de la rive stricte, pour ne pas
 *        reposer le point exactement dessus.
 * @returns {{x:number,z:number}} le point, inchangé s'il est déjà hors emprise.
 */
function pushPointOutsideCorridor(x, z, index, margin = CORRIDOR_MARGIN_M, clearance = CORRIDOR_PUSH_CLEARANCE_M) {
  if (!index) return { x, z };
  let px = x;
  let pz = z;
  // Plusieurs passes : un carrefour met deux chaussées à portée, et s'écarter
  // de la première peut retomber dans l'emprise de la seconde.
  for (let i = 0; i < CORRIDOR_PUSH_ITERATIONS; i++) {
    const hit = index.query(px, pz, margin);
    if (!hit) return { x: px, z: pz };

    const a = hit.segment.path[hit.row];
    const b = hit.segment.path[Math.min(hit.segment.path.length - 1, hit.row + 1)];
    const nx = a.x + (b.x - a.x) * hit.t;
    const nz = a.z + (b.z - a.z) * hit.t;

    let dx = px - nx;
    let dz = pz - nz;
    let len = hit.distance;
    if (len < 1e-6) {
      // Le point tombe pile sur l'axe — un contour qui partage un nœud avec la
      // route. Écarté perpendiculairement à la marche : arbitraire, mais
      // déterministe pour ce point précis, ce qui suffit.
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      dx = tz / tl;
      dz = -tx / tl;
      len = 1;
    }

    const need = hit.segment.halfWidth + margin + clearance;
    const scale = need / len;
    px = nx + dx * scale;
    pz = nz + dz * scale;
  }
  return { x: px, z: pz };
}

/**
 * Écarte de l'emprise chaque point d'une polyligne, sans jamais l'interrompre.
 *
 * Pour les contours de parcelle : voir `pushPointOutsideCorridor`, dont c'est
 * l'application point par point. Les distances sont recalculées sur la
 * polyligne déplacée.
 *
 * Fonction pure.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {Object|null} index Instance `RoadIndex`, ou `null`.
 * @param {number} [margin]
 * @param {number} [clearance]
 * @returns {Array<{x:number,z:number,distance:number}>}
 */
export function pushOutsideCorridor(
  points,
  index,
  margin = CORRIDOR_MARGIN_M,
  clearance = CORRIDOR_PUSH_CLEARANCE_M
) {
  if (!Array.isArray(points)) return [];
  if (!index) return points;
  const moved = points.map((p) => pushPointOutsideCorridor(p.x, p.z, index, margin, clearance));
  return withDistances(moved);
}

/** Perpendiculaire à gauche de la marche, ligne par ligne. Convention de `pathFrames`. */
function perpendiculars(path) {
  const rows = path.length;
  const out = new Float64Array(rows * 2);
  for (let r = 0; r < rows; r++) {
    const prev = path[Math.max(0, r - 1)];
    const next = path[Math.min(rows - 1, r + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    // px = tz, pz = -tx — le même repère que celui d'`appendProfile`, sans
    // quoi on testerait l'emprise à un endroit et poserait la haie à un autre.
    out[r * 2] = tz;
    out[r * 2 + 1] = -tx;
  }
  return out;
}

/**
 * Point de la polyligne **d'origine** à l'abscisse `(row, t)`.
 *
 * Le sondage, lui, se fait sur la ligne décalée de `offset` (voir `inside`).
 * Les deux partagent exactement la même paramétrisation, donc l'abscisse
 * trouvée sur l'une désigne le bon point sur l'autre : c'est ce qui permet de
 * sonder là où l'objet sera posé et de découper la ligne qu'on repassera à
 * `appendProfile`.
 */
function pointAt(path, row, t) {
  const a = path[row];
  const b = path[Math.min(path.length - 1, row + 1)];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Recompose un tronçon : ses distances repartent de zéro. */
function withDistances(points) {
  const out = [];
  let travelled = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const step = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      // Un sommet dupliqué — une traversée qui tombe pile sur un sommet —
      // casserait `spacedAlongPath`, qui divise par l'écart entre deux lignes.
      if (step < 1e-6) continue;
      travelled += step;
    }
    out.push({ x: points[i].x, z: points[i].z, distance: travelled });
  }
  return out;
}

/**
 * Découpe une polyligne en tronçons **hors emprise routière**.
 *
 * C'est la pièce qui manquait : sans elle, une couche n'a le choix qu'entre
 * tout garder et tout jeter, et les deux se voient.
 *
 * ## Comment la traversée est trouvée
 *
 * La polyligne est sondée à pas fin (`CORRIDOR_PROBE_M`), pas seulement à ses
 * sommets : ré-échantillonnée tous les six mètres, une haie pourrait enjamber
 * un sentier sans qu'aucun de ses sommets ne tombe dedans. À chaque changement
 * d'état — dedans/dehors — une dichotomie situe le passage à quelques
 * millimètres, et ce point-là devient le bout du tronçon.
 *
 * Aucune formule fermée n'est cherchée : l'emprise est la réunion des capsules
 * de toutes les chaussées voisines, et intersecter une polyligne avec cette
 * réunion analytiquement coûterait beaucoup de code pour un résultat que la
 * dichotomie donne au millimètre.
 *
 * ## `offset`
 *
 * Ce qui longe une route n'est pas posé sur son axe mais à côté — une haie de
 * bas-côté à deux mètres de la rive, un fossé à un mètre cinquante. `offset`
 * dit de sonder l'emprise **là où l'objet sera réellement posé**, avec la même
 * convention qu'`appendProfile` (positif à gauche de la marche), tout en
 * rendant des tronçons exprimés sur la ligne d'origine — c'est elle qu'on
 * repassera à `appendProfile`, offset compris.
 *
 * Fonction pure.
 *
 * @param {Array<{x:number,z:number}>} path Polyligne, telle que la rend
 *        `resamplePath`. Les `distance` fournies sont ignorées et recalculées.
 * @param {Object|null} index Instance `RoadIndex`, ou `null` — sans réseau, la
 *        polyligne ressort entière.
 * @param {number} [margin] Débord de l'emprise, en mètres.
 * @param {Object} [options]
 * @param {number} [options.offset]    Décalage latéral de l'objet, en mètres.
 * @param {number} [options.minLength] Longueur en deçà de laquelle un tronçon
 *        ne vaut pas la peine d'être posé, en mètres.
 * @param {number} [options.probe]     Pas de sondage, en mètres.
 * @param {Function|null} [options.accept] Chaussées à prendre en compte — voir
 *        `inCorridor`. Un fossé ignore la route qu'il longe, pas les autres.
 * @returns {Array<Array<{x:number,z:number,distance:number}>>} tronçons, dont
 *          les distances repartent de zéro — c'est ce qu'attendent
 *          `spacedAlongPath` et `appendRibbon`.
 */
export function clipOutsideCorridor(
  path,
  index,
  margin = CORRIDOR_MARGIN_M,
  { offset = 0, minLength = 0, probe = CORRIDOR_PROBE_M, accept = null } = {}
) {
  const rows = path?.length ?? 0;
  if (rows < 2) return [];

  const keep = (points) => {
    if (points.length < 2) return null;
    const run = withDistances(points);
    if (run.length < 2) return null;
    if (run[run.length - 1].distance < minLength) return null;
    return run;
  };

  if (!index) {
    const whole = keep(path);
    return whole ? [whole] : [];
  }

  const perp = perpendiculars(path);
  const step = Math.max(probe, 0.05);
  // Sondage sans allocation : une polyligne de trois cents mètres se sonde au
  // mètre, et trois cents objets jetables par contour de parcelle — pour cent
  // quatre-vingts contours à chaque reconstruction — se paient en ramassage
  // miettes, pas en calcul.
  const inside = (row, t) => {
    const a = path[row];
    const b = path[Math.min(rows - 1, row + 1)];
    const next = Math.min(rows - 1, row + 1);
    let x = a.x + (b.x - a.x) * t;
    let z = a.z + (b.z - a.z) * t;
    if (offset) {
      x += (perp[row * 2] + (perp[next * 2] - perp[row * 2]) * t) * offset;
      z += (perp[row * 2 + 1] + (perp[next * 2 + 1] - perp[row * 2 + 1]) * t) * offset;
    }
    return inCorridor(index, x, z, margin, accept);
  };

  /**
   * Abscisse de la traversée entre deux sondages d'états opposés. La recherche
   * se fait dans l'espace `(row, t)` de la ligne d'origine, donc le point rendu
   * est directement utilisable — pas besoin de le reprojeter.
   */
  const crossing = (row, tA, tB) => {
    let low = tA;
    let high = tB;
    const stateLow = inside(row, low);
    for (let i = 0; i < CORRIDOR_BISECT_STEPS; i++) {
      const mid = (low + high) * 0.5;
      if (inside(row, mid) === stateLow) low = mid;
      else high = mid;
    }
    return (low + high) * 0.5;
  };

  const runs = [];
  let current = null;
  let state = inside(0, 0);
  if (!state) current = [pointAt(path, 0, 0)];

  for (let row = 0; row < rows - 1; row++) {
    const a = path[row];
    const b = path[row + 1];
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    if (span < 1e-6) continue;

    // Écart d'un coup les tronçons qui n'ont aucune chaussée dans leur
    // voisinage : en rase campagne c'est le cas de presque tous, et les sonder
    // au mètre coûterait cent fois le prix de ce test. La boîte est élargie du
    // décalage latéral, puisque c'est là que le sondage irait vraiment lire.
    if (!state && typeof index.mayCover === 'function') {
      const reach = Math.abs(offset) + margin;
      const clearOfRoads = !index.mayCover(
        Math.min(a.x, b.x) - reach,
        Math.min(a.z, b.z) - reach,
        Math.max(a.x, b.x) + reach,
        Math.max(a.z, b.z) + reach
      );
      if (clearOfRoads) {
        if (current) current.push({ x: b.x, z: b.z });
        continue;
      }
    }

    // Sondages intermédiaires **plus** le sommet d'arrivée : sans ce dernier,
    // une traversée qui commence pile au sommet passerait à la ligne suivante.
    const steps = Math.max(1, Math.ceil(span / step));
    let previousT = 0;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const next = inside(row, t);

      if (next !== state) {
        const tc = crossing(row, previousT, t);
        const point = pointAt(path, row, tc);
        if (state) {
          // On sort de l'emprise : un tronçon commence au point de sortie.
          current = [point];
        } else {
          // On y entre : le tronçon en cours s'arrête au point d'entrée.
          if (current) {
            current.push(point);
            const run = keep(current);
            if (run) runs.push(run);
          }
          current = null;
        }
        state = next;
      }

      previousT = t;
    }

    // Le sommet d'arrivée rejoint le tronçon en cours. Les sondages ne posent
    // aucun sommet : ils ne servent qu'à détecter les traversées, et une haie
    // ne doit pas gagner un sommet tous les mètres au passage.
    if (!state && current) current.push({ x: b.x, z: b.z });
  }

  if (current) {
    const run = keep(current);
    if (run) runs.push(run);
  }

  return runs;
}
