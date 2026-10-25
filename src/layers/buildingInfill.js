/*
 * buildingInfill — des empreintes de bâti là où la donnée n'en relève pas.
 *
 * Ne tourne que dans une région dont le dossier dit le bâti mal relevé
 * (`sparse: ['buildings']`, voir `docs/regions.md`) : ailleurs, une maison
 * absente de la carte reste absente. Le module ne dessine rien ; il rend des
 * anneaux que `buildingLayer` traite exactement comme ceux des tuiles, de sorte
 * que toit, jardin, rue et mobilier suivent sans règle à eux.
 *
 * Trois verrous, tous exigés :
 *   1. une emprise habitée (`landuse` résidentiel, commercial ou de commerce),
 *      hors vert urbain, hors eau, hors pente forte ;
 *   2. une rue devant (profil `major` ou `minor`), hors de son emprise ;
 *   3. une parcelle libre : un bâtiment relevé dans la parcelle la ferme. Une
 *      rue bien relevée n'a donc plus de place, et rien ne s'y ajoute.
 *
 * Un point d'intérêt sans empreinte (église, commerce) reçoit la sienne à sa
 * position : c'est la seule source d'un bâtiment à fonction. Une maison semée
 * n'en reçoit jamais — la personnalité vient du point, dans `buildingLayer`.
 *
 * Les cotes (recul, taille, proportion, pignon sur rue, intervalle entre
 * maisons) sont mesurées sur les bâtiments réels de villages roumains ; elles
 * se contrôlent par `scripts/buildings-audit.mjs`. Toute graine vient d'une
 * maille mondiale (`eachWorldCell`), et l'ordre d'acceptation est celui des
 * tirages de maille, jamais celui des tuiles.
 */

import { eachWorldCell, hash32, randomStream } from '../core/groundSeed.js';
import { inCorridor } from './roadCorridor.js';

/** Mot de région qui autorise le semis. */
export const SPARSE_BUILDINGS = 'buildings';

/** Vrai si le dossier de région autorise le semis du bâti. Pure. */
export function infillAllowed(region) {
  return Array.isArray(region?.sparse) && region.sparse.includes(SPARSE_BUILDINGS);
}

/** Classes `landuse` où une maison peut être semée. */
export const INFILL_AREA_CLASSES = new Set(['residential', 'commercial', 'retail']);

/** Profils de chaussée qui portent une façade. */
export const INFILL_STREET_PROFILES = new Set(['major', 'minor']);

/**
 * Cotes d'une maison et de sa parcelle, en mètres. Les tables sont des
 * quantiles (0, 10, 25, 50, 75, 90, 100 %) relevés au premier rang des rues de
 * neuf villages roumains et d'une petite ville (bâtiments OSM et détectés),
 * puis recalés par `scripts/buildings-audit.mjs` : le semis écarte plus souvent
 * les grandes maisons, et l'acceptation au premier venu tasse les façades.
 * Le recul se compte de l'axe de la rue au bâtiment.
 */
export const INFILL_DIMENSIONS = Object.freeze({
  setback: [3, 3.4, 5.7, 9.4, 14.7, 19.6, 24],
  length: [7.5, 9.5, 12, 15.5, 20.5, 26, 30],
  ratio: [1, 1.1, 1.2, 1.5, 1.9, 2.5, 3],
  annexLength: [4, 5, 6, 8, 11, 14, 18],
  /** Part des maisons pignon sur rue ; les autres longent la rue. */
  gableShare: 0.47,
  /** Écart d'orientation à la rue, au plus, en degrés. */
  skewDeg: 8,
  /** Intervalle entre deux façades d'un même côté de rue (quantiles). */
  spacing: [14, 15.1, 18.7, 25.1, 37, 56.2, 70],
  /** Facteur sur l'intervalle tiré, recalé sur la densité réelle par le banc. */
  spacingScale: 0.9,
  /** Part des parcelles laissées vides. */
  emptyShare: 0.12,
  /** Part des maisons qui ont une annexe au fond de la cour. */
  annexShare: 0.5,
  /** Profondeur de parcelle derrière la maison, fermée à un autre semis. */
  plotDepth: 30,
  /** Jour minimal entre deux bâtiments. */
  gap: 2,
  /** Dénivelé maximal sous une empreinte. */
  maxRelief: 3,
  /**
   * Un quartier relevé l'est en entier : à partir de ce nombre de bâtiments
   * relevés dans `surveyRadius` autour du pied de façade, le vide est un vide.
   */
  surveyCount: 4,
  surveyRadius: 60,
  /**
   * Couverture relevée à plus grande échelle : bâtiments relevés dans
   * `coverageRadius`, rapportés à ceux qu'y mettrait la rue habitable
   * (`expectedPer100m` par côté et par 100 m, annexes comprises). Au-delà de
   * `coverageCeiling`, le lieu est relevé et rien n'est semé.
   */
  coverageRadius: 200,
  expectedPer100m: 3.5,
  coverageCeiling: 0.4,
});

/** Côté des mailles qui proposent une façade. */
export const INFILL_CELL_M = 10;

/**
 * Emprise d'un bâtiment de fonction posé sur un point d'intérêt sans empreinte,
 * en mètres : longueur, largeur, et orientation (`east` : axe long est-ouest,
 * chœur à l'est ; `street` : façade longue sur la rue).
 */
export const ANCHOR_FOOTPRINTS = Object.freeze({
  church: { length: 22, width: 11, axis: 'east' },
  mosque: { length: 16, width: 16, axis: 'east' },
  retail: { length: 40, width: 28, axis: 'street' },
  shop: { length: 12, width: 9, axis: 'street' },
  bakery: { length: 12, width: 9, axis: 'street' },
  fuel: { length: 14, width: 10, axis: 'street' },
});

/** Distance au-delà de laquelle un point d'intérêt hors emprise n'a pas de rue à lui. */
const ANCHOR_STREET_REACH_M = 40;
/** Pas du recul d'un bâtiment de fonction qui mord sur une chaussée. */
const ANCHOR_SHIFT_STEP_M = 1;
const ANCHOR_SHIFT_MAX_M = 12;

const HASH_CELL_M = 32;

/** Valeur d'une table de quantiles pour un tirage `u` dans [0, 1[. Pure. */
export function quantile(table, u) {
  const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
  for (let i = 1; i < steps.length; i++) {
    if (u <= steps[i]) {
      const k = (u - steps[i - 1]) / (steps[i] - steps[i - 1]);
      return table[i - 1] + (table[i] - table[i - 1]) * k;
    }
  }
  return table[table.length - 1];
}

/** Rectangle orienté : centre, axes unitaires `u` (long) et `v`, demi-côtés. Rend ses quatre coins. */
function corners(cx, cz, ux, uz, halfU, halfV) {
  const vx = -uz, vz = ux;
  return [
    { x: cx + ux * halfU + vx * halfV, z: cz + uz * halfU + vz * halfV },
    { x: cx - ux * halfU + vx * halfV, z: cz - uz * halfU + vz * halfV },
    { x: cx - ux * halfU - vx * halfV, z: cz - uz * halfU - vz * halfV },
    { x: cx + ux * halfU - vx * halfV, z: cz + uz * halfU - vz * halfV },
  ];
}

function boxOf(ring) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) / (b.z - a.z || 1)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Deux polygones convexes se recouvrent-ils ? (axes séparateurs) */
function convexOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.z - p.z, nz = p.x - q.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of a) { const d = c.x * nx + c.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const c of b) { const d = c.x * nx + c.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Index plan de rectangles ou d'anneaux, par boîte. */
class BoxHash {
  constructor() {
    this.cells = new Map();
    this._stamp = 0;
  }
  _key(i, j) { return (i + 0x8000) * 0x10000 + (j + 0x8000); }
  add(item) {
    item._seen = 0;
    const { box } = item;
    for (let i = Math.floor(box.minX / HASH_CELL_M); i <= Math.floor(box.maxX / HASH_CELL_M); i++) {
      for (let j = Math.floor(box.minZ / HASH_CELL_M); j <= Math.floor(box.maxZ / HASH_CELL_M); j++) {
        const k = this._key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }
  /** Éléments dont la maille recoupe `box`, chacun une fois. */
  near(box) {
    const stamp = ++this._stamp;
    const out = [];
    for (let i = Math.floor(box.minX / HASH_CELL_M); i <= Math.floor(box.maxX / HASH_CELL_M); i++) {
      for (let j = Math.floor(box.minZ / HASH_CELL_M); j <= Math.floor(box.maxZ / HASH_CELL_M); j++) {
        const list = this.cells.get(this._key(i, j));
        if (!list) continue;
        for (const item of list) {
          if (item._seen === stamp) continue;
          item._seen = stamp;
          out.push(item);
        }
      }
    }
    return out;
  }
  /** Tous les éléments, chacun une fois. */
  all() {
    const stamp = ++this._stamp;
    const out = [];
    for (const list of this.cells.values()) {
      for (const item of list) {
        if (item._seen === stamp) continue;
        item._seen = stamp;
        out.push(item);
      }
    }
    return out;
  }
}

function expand(box, by) {
  return { minX: box.minX - by, minZ: box.minZ - by, maxX: box.maxX + by, maxZ: box.maxZ + by };
}

function boxesTouch(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** Les anneaux d'une liste, indexés par boîte pour le test de point. */
function ringIndex(rings) {
  const hash = new BoxHash();
  for (const ring of rings ?? []) if (ring?.length >= 3) hash.add({ ring, box: boxOf(ring) });
  return {
    has(x, z) {
      for (const item of hash.near({ minX: x, minZ: z, maxX: x, maxZ: z })) {
        if (x >= item.box.minX && x <= item.box.maxX && z >= item.box.minZ && z <= item.box.maxZ && pointInRing(item.ring, x, z)) return true;
      }
      return false;
    },
  };
}

/**
 * Plan du semis : les empreintes à ajouter, en mètres locaux.
 *
 * Générateur (cède entre les mailles) ; rend
 * `Array<{ring: Array<{x,z}>, kind: 'house'|'annex'|string, x, z}>`, où `kind`
 * vaut la personnalité du point d'intérêt pour un bâtiment de fonction.
 *
 * @param {Object} context
 * @param {Object} context.frame Repère de la bulle (graines).
 * @param {Array} context.streets Tronçons (`RoadNetwork.roadSegments`).
 * @param {Array} context.builtUp Emprises habitées (`collectBuiltUpAreas`).
 * @param {Array<string>} context.builtUpClasses Classe `landuse` de chaque emprise, au même rang.
 * @param {Array} [context.greens] Vert urbain (`collectUrbanGreens`).
 * @param {Array} [context.real] Empreintes relevées, `{footprint: Array<{x,z}>}`.
 * @param {Array} [context.anchors] Points d'intérêt `{x, z, kind}`.
 * @param {Object|null} [context.roadIndex] Emprise des chaussées (`RoadIndex`).
 * @param {Function|null} [context.blocked] `(x, z) => boolean` : eau, marais.
 * @param {Function|null} [context.groundAt] `(x, z) => mètres` : relief.
 * @param {{x:number,z:number}} [context.here] Observateur.
 * @param {number} [context.radius] Portée du semis autour de l'observateur.
 * @param {Object} [context.dimensions] Cotes (`INFILL_DIMENSIONS`).
 */
export function* planInfillSteps({
  frame,
  streets = [],
  builtUp = [],
  builtUpClasses = [],
  greens = [],
  real = [],
  anchors = [],
  roadIndex = null,
  blocked = null,
  groundAt = null,
  here = { x: 0, z: 0 },
  radius = Infinity,
  dimensions = INFILL_DIMENSIONS,
}) {
  const out = [];
  if (!frame) return out;
  const D = dimensions;
  const areas = ringIndex(builtUp.filter((_, i) => INFILL_AREA_CLASSES.has(builtUpClasses[i])));
  const green = ringIndex(greens);
  const placed = new BoxHash();
  const realHash = new BoxHash();
  for (const r of real) {
    if (!r?.footprint || r.footprint.length < 3) continue;
    const box = boxOf(r.footprint);
    realHash.add({ ring: r.footprint, box, x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 });
  }

  const inArea = (x, z) => areas.has(x, z) && !green.has(x, z) && !blocked?.(x, z);
  const clearOfRoads = (ring) => !ring.some((p) => inCorridor(roadIndex, p.x, p.z));
  const flatEnough = (ring) => {
    if (!groundAt) return true;
    let lo = Infinity, hi = -Infinity;
    for (const p of ring) { const h = groundAt(p.x, p.z); if (!Number.isFinite(h)) return false; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return hi - lo <= D.maxRelief;
  };
  const free = (ring, box) => {
    const grown = expand(box, D.gap);
    for (const item of realHash.near(grown)) if (boxesTouch(grown, item.box) && overlapsWithGap(ring, item.ring, D.gap)) return false;
    for (const item of placed.near(grown)) if (boxesTouch(grown, item.box) && overlapsWithGap(ring, item.ring, D.gap)) return false;
    return true;
  };
  const accept = (ring, kind) => {
    const box = boxOf(ring);
    const item = { ring, box, kind, x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
    placed.add(item);
    out.push({ ring, kind, x: item.x, z: item.z });
  };

  const eligible = [];
  for (const segment of streets) {
    if (!INFILL_STREET_PROFILES.has(segment?.profile) || !Array.isArray(segment.path) || segment.path.length < 2) continue;
    if (segment.works?.some((code) => code !== 0)) continue;
    eligible.push(segment);
  }

  // 1. Les bâtiments de fonction, avant les maisons : ils sont relevés.
  for (const anchor of anchors) {
    const spec = ANCHOR_FOOTPRINTS[anchor?.kind];
    if (!spec || Math.hypot(anchor.x - here.x, anchor.z - here.z) > radius) continue;
    if (hasRealAt(realHash, anchor.x, anchor.z)) continue;
    const near = nearestStreet(eligible, anchor.x, anchor.z);
    if (!areas.has(anchor.x, anchor.z) && (!near || near.distance > ANCHOR_STREET_REACH_M)) continue;
    let ux = 1, uz = 0;
    if (spec.axis === 'street' && near) { ux = near.ux; uz = near.uz; }
    // Recul hors de la rue la plus proche, s'il le faut, sans quitter le point.
    const nx = near ? (anchor.x - near.x) / (near.distance || 1) : 0;
    const nz = near ? (anchor.z - near.z) / (near.distance || 1) : 0;
    for (let shift = 0; shift <= ANCHOR_SHIFT_MAX_M; shift += ANCHOR_SHIFT_STEP_M) {
      const cx = anchor.x + nx * shift, cz = anchor.z + nz * shift;
      const ring = corners(cx, cz, ux, uz, spec.length / 2, spec.width / 2);
      if (!pointInRing(ring, anchor.x, anchor.z)) break;
      if (!clearOfRoads(ring) || !free(ring, boxOf(ring))) continue;
      accept(ring, anchor.kind);
      break;
    }
  }
  yield;

  // 2. Les façades proposées : une par maille mondiale, sur la rue la plus proche.
  // Une maille ne donne que le pied de façade : il suffit qu'elle borde la rue.
  const reach = INFILL_CELL_M;
  const offers = new Map();
  let visited = 0;
  eligible.forEach((segment, s) => {
    const path = segment.path;
    let along = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const minX = Math.min(a.x, b.x) - reach - segment.halfWidth, maxX = Math.max(a.x, b.x) + reach + segment.halfWidth;
      const minZ = Math.min(a.z, b.z) - reach - segment.halfWidth, maxZ = Math.max(a.z, b.z) + reach + segment.halfWidth;
      if (minX > here.x + radius || maxX < here.x - radius || minZ > here.z + radius || maxZ < here.z - radius) { along += len; continue; }
      const reachSq = (segment.halfWidth + reach) ** 2;
      eachWorldCell(frame, minX, minZ, maxX, maxZ, INFILL_CELL_M, (id, row, x, z, size) => {
        visited++;
        const cx = x + size / 2, cz = z + size / 2;
        const t = (cx - a.x) * ux + (cz - a.z) * uz;
        if (t < 0 || t > len) return;
        const d = (cx - a.x) * -uz + (cz - a.z) * ux;
        const distance = Math.abs(d);
        if (distance < segment.halfWidth || d * d > reachSq) return;
        const key = id * 67108864 + row;
        const previous = offers.get(key);
        if (previous && previous.distance <= distance) return;
        offers.set(key, {
          rank: hash32(id, row, 0x1f1),
          seed: hash32(id, row, 0x2e2),
          street: s,
          side: d > 0 ? 1 : -1,
          along: along + t,
          px: a.x + ux * t, pz: a.z + uz * t,
          ux, uz,
          halfWidth: segment.halfWidth,
          distance,
        });
      });
      along += len;
    }
  });
  yield;

  const coverage = coverageField(eligible, realHash, D);

  // 3. Acceptation dans l'ordre des tirages : le même sol rend le même village.
  const fronts = new Map();
  const list = [...offers.values()].sort((p, q) => p.rank - q.rank || p.along - q.along);
  for (const offer of list) {
    if (++visited % 256 === 0) yield;
    if (coverage.at(offer.px, offer.pz) > D.coverageCeiling) continue;
    if (surveyed(realHash, offer.px, offer.pz, D.surveyRadius, D.surveyCount)) continue;
    const random = randomStream(offer.seed);
    if (random() < D.emptyShare) continue;
    const gable = random() < D.gableShare;
    const length = quantile(D.length, random());
    const width = Math.max(5, length / quantile(D.ratio, random()));
    const skew = ((random() * 2 - 1) * D.skewDeg * Math.PI) / 180;
    const minSetback = offer.halfWidth + 1;
    const setback = Math.max(minSetback, quantile(D.setback, random()));
    const depth = gable ? length : width;
    const frontage = gable ? width : length;
    // Normale vers le côté de la maille.
    const nx = -offer.uz * offer.side, nz = offer.ux * offer.side;
    const cx = offer.px + nx * (setback + depth / 2);
    const cz = offer.pz + nz * (setback + depth / 2);
    if (Math.hypot(cx - here.x, cz - here.z) > radius) continue;

    const line = fronts.get(`${offer.street},${offer.side}`) ?? [];
    const spacing = Math.max(quantile(D.spacing, random()) * D.spacingScale, frontage + D.gap);
    if (line.some((a) => Math.abs(a - offer.along) < spacing)) continue;

    const cos = Math.cos(skew), sin = Math.sin(skew);
    const ax = gable ? nx : offer.ux, az = gable ? nz : offer.uz;
    const ux = ax * cos - az * sin, uz = ax * sin + az * cos;
    const ring = corners(cx, cz, ux, uz, length / 2, width / 2);
    if (!ring.every((p) => inArea(p.x, p.z)) || !inArea(cx, cz)) continue;
    // La parcelle et ses voisines immédiates : un bâtiment relevé à moins d'un
    // intervalle de façade, de la rue au fond de la cour, ferme le semis.
    const plot = corners(
      offer.px + nx * (offer.halfWidth + (setback - offer.halfWidth + depth + D.plotDepth) / 2),
      offer.pz + nz * (offer.halfWidth + (setback - offer.halfWidth + depth + D.plotDepth) / 2),
      offer.ux, offer.uz, D.spacing[3], (setback - offer.halfWidth + depth + D.plotDepth) / 2
    );
    if (realInside(realHash, plot)) continue;
    const box = boxOf(ring);
    if (!clearOfRoads(ring) || !free(ring, box) || !flatEnough(ring)) continue;
    accept(ring, 'house');
    line.push(offer.along);
    fronts.set(`${offer.street},${offer.side}`, line);

    if (random() < D.annexShare) {
      const annexLength = quantile(D.annexLength, random());
      const annexWidth = Math.max(3.5, annexLength / quantile(D.ratio, random()));
      const back = setback + depth + D.gap + 2 + annexWidth / 2 + random() * 8;
      const slide = (random() < 0.5 ? -1 : 1) * Math.max(0, frontage / 2 - annexLength / 2);
      const ax2 = offer.px + nx * back + offer.ux * slide;
      const az2 = offer.pz + nz * back + offer.uz * slide;
      const annex = corners(ax2, az2, offer.ux, offer.uz, annexLength / 2, annexWidth / 2);
      if (annex.every((p) => inArea(p.x, p.z)) && clearOfRoads(annex) && free(annex, boxOf(annex)) && flatEnough(annex)) accept(annex, 'annex');
    }
  }
  return out;
}

/** Version sans pause de `planInfillSteps`. */
export function planInfill(context) {
  const steps = planInfillSteps(context);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

function overlapsWithGap(a, b, gap) {
  // Écart minimal approché : on grossit le premier polygone autour de son centre.
  const cx = a.reduce((s, p) => s + p.x, 0) / a.length;
  const cz = a.reduce((s, p) => s + p.z, 0) / a.length;
  const grown = a.map((p) => {
    const d = Math.hypot(p.x - cx, p.z - cz) || 1;
    return { x: p.x + ((p.x - cx) / d) * gap, z: p.z + ((p.z - cz) / d) * gap };
  });
  if (b.length <= 5 || isConvex(b)) return convexOverlap(grown, b);
  // Anneau concave relevé : un sommet dans l'autre, ou l'inverse, suffit à le dire.
  return b.some((p) => pointInRing(grown, p.x, p.z)) || grown.some((p) => pointInRing(b, p.x, p.z));
}

function isConvex(ring) {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function hasRealAt(hash, x, z) {
  for (const item of hash.near({ minX: x, minZ: z, maxX: x, maxZ: z })) if (pointInRing(item.ring, x, z)) return true;
  return false;
}

const COVERAGE_CELL_M = 50;

/**
 * Part relevée du bâti autour d'un point : bâtiments relevés sur bâtiments
 * attendus, dans un disque. Ne dépend que de la donnée autour du point.
 */
function coverageField(streets, realHash, D) {
  const length = new Map();
  const count = new Map();
  const key = (x, z) => `${Math.floor(x / COVERAGE_CELL_M)},${Math.floor(z / COVERAGE_CELL_M)}`;
  for (const segment of streets) {
    const path = segment.path;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const k = key((a.x + b.x) / 2, (a.z + b.z) / 2);
      length.set(k, (length.get(k) ?? 0) + len);
    }
  }
  for (const item of realHash.all()) {
    const k = key(item.x, item.z);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const memo = new Map();
  const reach = Math.ceil(D.coverageRadius / COVERAGE_CELL_M);
  return {
    at(x, z) {
      const ci = Math.floor(x / COVERAGE_CELL_M), cj = Math.floor(z / COVERAGE_CELL_M);
      const k = `${ci},${cj}`;
      if (memo.has(k)) return memo.get(k);
      let meters = 0, found = 0;
      for (let i = ci - reach; i <= ci + reach; i++) {
        for (let j = cj - reach; j <= cj + reach; j++) {
          if ((i - ci) ** 2 + (j - cj) ** 2 > reach * reach) continue;
          meters += length.get(`${i},${j}`) ?? 0;
          found += count.get(`${i},${j}`) ?? 0;
        }
      }
      const expected = (meters / 100) * 2 * D.expectedPer100m;
      const share = expected > 0 ? found / expected : 1;
      memo.set(k, share);
      return share;
    },
  };
}

function surveyed(hash, x, z, radius, count) {
  let n = 0;
  for (const item of hash.near({ minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius })) {
    if (Math.hypot(item.x - x, item.z - z) <= radius && ++n >= count) return true;
  }
  return false;
}

function realInside(hash, plot) {
  for (const item of hash.near(boxOf(plot))) if (pointInRing(plot, item.x, item.z)) return true;
  return false;
}

/** Point le plus proche sur les rues, avec la direction locale de la rue. */
function nearestStreet(streets, x, z) {
  let best = null;
  for (const segment of streets) {
    const path = segment.path;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const t = Math.max(0, Math.min(len, (x - a.x) * ux + (z - a.z) * uz));
      const px = a.x + ux * t, pz = a.z + uz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance) best = { x: px, z: pz, ux, uz, distance };
    }
  }
  return best;
}
