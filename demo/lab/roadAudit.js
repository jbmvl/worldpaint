/*
 * roadAudit — ce que le réseau routier d'un lieu rejoué a de mesurable :
 * pentes, marches, terrassement, bouches, chaussées superposées, et une
 * empreinte du réseau (tracés, largeurs, cotes) pour prouver qu'un changement
 * est neutre. Lu par `placeLab.roads()` et `scripts/roads-audit.mjs`.
 *
 * Les seuils sont ceux d'un contrôle, pas des règles du moteur : ils disent
 * où regarder, pas ce qui est faux.
 */
import { areaCovers } from '/src/layers/roadJunctions.js';

/** Pente au-delà de laquelle une ligne au sol est comptée (la cible du profil). */
const GRADE_TARGET = 0.12;
const GRADE_STEEP = 0.2;
/** Une marche : plus d'un mètre de dénivelé sur moins de quatre mètres. */
const STEP_RISE_M = 1;
const STEP_RUN_M = 4;
/** Un carrefour gauche : ses bouches s'écartent de plus de 15 % de son diamètre. */
const AREA_GRADE = 0.15;
/** Deux axes parallèles plus proches que cette part de la demi-largeur la plus étroite. */
const OVERLAP_SHARE = 0.6;
const OVERLAP_COS = 0.94;
const CELL_M = 16;

const quantile = (values, share) => {
  if (!values.length) return null;
  const sorted = Float64Array.from(values).sort();
  return +sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))].toFixed(2);
};

function distanceToEdge(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

function platformAt(segment, distance) {
  const path = segment.path;
  let i = 1;
  while (i < path.length - 1 && path[i].distance < distance) i++;
  const a = path[i - 1];
  const b = path[i];
  const span = b.distance - a.distance;
  const t = span ? Math.max(0, Math.min(1, (distance - a.distance) / span)) : 0;
  return segment.platform[i - 1] + (segment.platform[i] - segment.platform[i - 1]) * t;
}

/** Empreinte FNV-1a des tracés, largeurs et cotes, au millimètre. */
function fingerprint(segments) {
  let hash = 0x811c9dc5;
  const mix = (value) => {
    let n = Math.round(value * 1000) | 0;
    for (let k = 0; k < 4; k++) {
      hash = Math.imul(hash ^ (n & 0xff), 0x01000193);
      n >>= 8;
    }
  };
  const ordered = segments
    .map((s) => ({ s, key: `${Math.round(s.path[0].x * 10)},${Math.round(s.path[0].z * 10)},${s.path.length},${s.profile}` }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { s } of ordered) {
    mix(s.halfWidth);
    for (let r = 0; r < s.path.length; r++) {
      mix(s.path[r].x);
      mix(s.path[r].z);
      mix(s.platform[r]);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function auditRoads(composer) {
  const roads = composer.roads;
  const segments = roads.roadSegments;
  const areas = roads.junctionAreas?.areas ?? [];
  const paved = segments.filter((s) => s.paved);
  const inJunction = (x, z) => areas.some((area) => areaCovers(area, x, z));

  let metres = 0;
  let rows = 0;
  let overTarget = 0;
  let steep = 0;
  let steps = 0;
  let missing = 0;
  let worst = 0;
  let worstAt = null;
  const earthwork = [];
  for (const s of paved) {
    for (let r = 1; r < s.path.length; r++) {
      const a = s.path[r - 1];
      const b = s.path[r];
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      metres += run;
      if (!Number.isFinite(s.platform[r])) {
        missing++;
        continue;
      }
      if (run < 0.2 || s.works[r] || s.works[r - 1]) continue;
      const rise = Math.abs(s.platform[r] - s.platform[r - 1]);
      rows++;
      if (rise > GRADE_TARGET * run) overTarget++;
      if (rise > GRADE_STEEP * run) steep++;
      if (rise > STEP_RISE_M && run < STEP_RUN_M) steps++;
      if (rise / run > worst) {
        worst = rise / run;
        worstAt = { x: Math.round(b.x), z: Math.round(b.z), profil: s.profile };
      }
      if (!s.supports?.[r]) {
        const natural = composer.bubble.naturalElevationAtLocal(b.x, b.z);
        if (Number.isFinite(natural)) earthwork.push(Math.abs(s.platform[r] / composer.bubble.verticalScale - natural));
      }
    }
  }

  let mouths = 0;
  let mouthSteps = 0;
  let warped = 0;
  let unresolved = 0;
  for (const area of areas) {
    if (area.valid === false || area.vertices?.some((v) => !Number.isFinite(v.y))) unresolved++;
    const decks = [];
    for (const mouth of area.mouths ?? []) {
      mouths++;
      const deck = platformAt(mouth.segment, mouth.distance);
      decks.push(deck);
      if (Math.max(Math.abs((mouth.left?.y ?? deck) - deck), Math.abs((mouth.right?.y ?? deck) - deck)) > 0.05) mouthSteps++;
    }
    if (decks.length > 1 && (Math.max(...decks) - Math.min(...decks)) / (2 * area.radius) > AREA_GRADE) warped++;
  }

  const grid = new Map();
  paved.forEach((s, index) => {
    for (let r = 0; r + 1 < s.path.length; r++) {
      const a = s.path[r];
      const b = s.path[r + 1];
      for (let cx = Math.floor(Math.min(a.x, b.x) / CELL_M); cx <= Math.floor(Math.max(a.x, b.x) / CELL_M); cx++) {
        for (let cz = Math.floor(Math.min(a.z, b.z) / CELL_M); cz <= Math.floor(Math.max(a.z, b.z) / CELL_M); cz++) {
          const key = `${cx},${cz}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(index, r);
        }
      }
    }
  });
  let overlap = 0;
  const overlapAt = [];
  paved.forEach((s, index) => {
    for (let r = 0; r + 1 < s.path.length; r++) {
      if (s.works[r]) continue;
      const a = s.path[r];
      const b = s.path[r + 1];
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      if (run < 0.2) continue;
      let hit = false;
      const cx = Math.floor(x / CELL_M);
      const cz = Math.floor(z / CELL_M);
      for (let i = -1; i <= 1 && !hit; i++) {
        for (let j = -1; j <= 1 && !hit; j++) {
          const entries = grid.get(`${cx + i},${cz + j}`);
          if (!entries) continue;
          for (let e = 0; e < entries.length && !hit; e += 2) {
            if (entries[e] === index) continue;
            const other = paved[entries[e]];
            const row = entries[e + 1];
            if ((other.levels?.[row] ?? 0) !== (s.levels?.[r] ?? 0) || other.works[row]) continue;
            const oa = other.path[row];
            const ob = other.path[row + 1];
            const otherRun = Math.hypot(ob.x - oa.x, ob.z - oa.z);
            if (otherRun < 0.2) continue;
            const cos = Math.abs(((b.x - a.x) * (ob.x - oa.x) + (b.z - a.z) * (ob.z - oa.z)) / (run * otherRun));
            if (cos > OVERLAP_COS && distanceToEdge(x, z, oa, ob) < OVERLAP_SHARE * Math.min(s.halfWidth, other.halfWidth)) hit = true;
          }
        }
      }
      if (!hit || inJunction(x, z)) continue;
      overlap += run;
      if (overlapAt.length < 6 && !overlapAt.some((p) => Math.hypot(p.x - x, p.z - z) < 60)) {
        overlapAt.push({ x: Math.round(x), z: Math.round(z), profil: s.profile });
      }
    }
  });

  return {
    troncons: segments.length,
    revetus: paved.length,
    km: +(metres / 1000).toFixed(1),
    carrefours: areas.length,
    bouches: mouths,
    bouchesEnMarche: mouthSteps,
    carrefoursGauches: warped,
    carrefoursSansCote: unresolved,
    lignesAuSol: rows,
    plusDe12: overTarget,
    plusDe20: steep,
    marches: steps,
    penteMax: +worst.toFixed(2),
    penteMaxEn: worstAt,
    cotesAbsentes: missing,
    terrassement: { median: quantile(earthwork, 0.5), p95: quantile(earthwork, 0.95), max: quantile(earthwork, 1) },
    superposeM: Math.round(overlap),
    superposeEn: overlapAt,
    empreinte: fingerprint(segments),
  };
}
