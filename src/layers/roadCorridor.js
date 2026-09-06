/*
 * roadCorridor — l'emprise routière, frontière partagée du paysage : rien
 * (haie, clôture, botte de paille) n'a le droit de la franchir. Module pur,
 * testable sous Node.
 *
 * L'emprise couvre la chaussée plus l'accotement excavé — la même largeur que
 * `roadCut`, importée de là, plutôt que trois marges dispersées qui disaient
 * chacune à peu près la même chose sans le dire.
 *
 * `clipOutsideCorridor` découpe (plutôt que rejette en bloc) une polyligne qui
 * traverse une route, pour ne perdre que le segment réellement dans l'emprise.
 *
 * Ce module ne connaît ni les carrefours ni la hiérarchie des routes : il
 * répond à « suis-je dans l'emprise ? », pour que les couches végétales
 * n'aient jamais à lire le réseau lui-même.
 */

import { ROAD_CUT_M } from '../terrain/roadCut.js';

/** Débord de l'emprise au-delà de la rive de la chaussée, en mètres — le fond plat du déblai (`ROAD_CUT_M`). */
export const CORRIDOR_MARGIN_M = ROAD_CUT_M;

/**
 * Pas de sondage le long d'une polyligne, en mètres. Doit rester plus court
 * que la plus étroite des emprises (un sentier, 3,8 m), sinon une haie
 * perpendiculaire pourrait l'enjamber entre deux sondages.
 */
export const CORRIDOR_PROBE_M = 1;

/** Itérations de dichotomie pour situer une traversée (huit passes ≈ 4 mm de précision). */
export const CORRIDOR_BISECT_STEPS = 8;

/**
 * Vrai si un point tombe dans l'emprise d'une chaussée. Sans index, la
 * réponse est « non » : on ne devine pas une route absente.
 *
 * `accept` permet d'ignorer certaines chaussées — ce qui borde une route (son
 * fossé, sa haie de bas-côté) doit ignorer celle-là tout en s'arrêtant net
 * aux rues transversales.
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
 * Ne garde que les points hors emprise (bottes de paille, troupeaux, rochers,
 * touffes de fougère). Ne retire rien d'autre que ce qui tombait sur la voirie.
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
 * Écarte un point de l'emprise, sans le supprimer. Ni `filterOutsideCorridor`
 * (retire) ni `clipOutsideCorridor` (coupe) ne conviennent à un contour de
 * parcelle qui longe une route sur toute sa longueur (le bocage) : le couper
 * ne laisserait aucun tronçon dehors, alors que le repousser garde la haie continue.
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
  // Plusieurs passes : s'écarter d'une chaussée peut retomber dans celle d'un carrefour voisin.
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
      // Point pile sur l'axe : écarté perpendiculairement à la marche (arbitraire mais déterministe).
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
 * Écarte de l'emprise chaque point d'une polyligne, sans jamais l'interrompre
 * (application point par point de `pushPointOutsideCorridor`).
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
    // px = tz, pz = -tx : même repère qu'`appendProfile`.
    out[r * 2] = tz;
    out[r * 2 + 1] = -tx;
  }
  return out;
}

/**
 * Point de la polyligne d'origine à l'abscisse `(row, t)`. Le sondage, lui,
 * se fait sur la ligne décalée de `offset` (voir `inside`) — même paramétrisation.
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
      // Un sommet dupliqué casserait `spacedAlongPath` (division par l'écart entre deux lignes).
      if (step < 1e-6) continue;
      travelled += step;
    }
    out.push({ x: points[i].x, z: points[i].z, distance: travelled });
  }
  return out;
}

/**
 * Découpe une polyligne en tronçons hors emprise routière : sondage à pas fin
 * (`CORRIDOR_PROBE_M`, pas seulement les sommets), et dichotomie pour situer
 * chaque traversée au millimètre.
 *
 * `offset` sonde l'emprise là où l'objet sera réellement posé (une haie de
 * bas-côté à deux mètres de la rive, un fossé à un mètre cinquante), même
 * convention qu'`appendProfile`, mais rend des tronçons exprimés sur la ligne
 * d'origine.
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
  // Sondage sans allocation (coût dominé par le ramasse-miettes sinon, vu le nombre de contours).
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

  /** Abscisse de la traversée entre deux sondages d'états opposés, dans l'espace `(row, t)` de la ligne d'origine. */
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

    // Écarte d'un coup les tronçons sans chaussée dans leur voisinage (la plupart, en rase campagne).
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

    // Sondages intermédiaires plus le sommet d'arrivée (sinon une traversée pile au sommet serait manquée).
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

    // Le sommet d'arrivée rejoint le tronçon en cours (les sondages n'en posent pas).
    if (!state && current) current.push({ x: b.x, z: b.z });
  }

  if (current) {
    const run = keep(current);
    if (run) runs.push(run);
  }

  return runs;
}
