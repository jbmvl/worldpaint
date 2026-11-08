/*
 * slopeSpots — chaque endroit d'un lieu rejoué où la chaussée au sol est trop
 * raide ou casse sa pente, avec ce qui l'entoure : ouvrage, carrefour, bout
 * libre, remblai, voie à étage, relief lui-même raide, bord de la bulle.
 * Lu par `placeLab.slopeSpots()` et `scripts/slope-bench.mjs`, pour trouver les
 * familles de cas plutôt que les lieux.
 *
 * La pente se lit sur une corde de 20 m tous les 5 m, comme un cycliste la
 * sent ; la rupture est l'écart entre deux cordes consécutives. Les seuils
 * disent où regarder, pas ce qui est faux.
 */
import { areaCovers } from '/src/layers/roadJunctions.js';

const STEP_M = 5;
const CHORD_M = 20;
const STEEP = 0.15;
const BREAK = 0.1;
/** Portée du contexte : un ouvrage, un carrefour ou un bout à moins de ça compte. */
const NEAR_M = 30;
const FREE_END_M = 50;
const MERGE_M = 15;

function rowAt(path, distance) {
  let i = 1;
  while (i < path.length - 1 && path[i].distance < distance) i++;
  return i;
}

function at(segment, distance) {
  const path = segment.path;
  const i = rowAt(path, distance);
  const a = path[i - 1];
  const b = path[i];
  const span = b.distance - a.distance;
  const t = span ? Math.max(0, Math.min(1, (distance - a.distance) / span)) : 0;
  return {
    row: t < 0.5 ? i - 1 : i,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    y: segment.platform[i - 1] + (segment.platform[i] - segment.platform[i - 1]) * t,
  };
}

/** Rangs du tronçon à moins de `m` mètres de `distance`. */
function rowsNear(segment, distance, m) {
  const rows = [];
  segment.path.forEach((p, r) => { if (Math.abs(p.distance - distance) <= m) rows.push(r); });
  return rows;
}

export function slopeSpots(world) {
  const composer = world.composer;
  const bubble = composer.bubble;
  const scale = bubble.verticalScale;
  const areas = composer.roads.junctionAreas?.areas ?? [];
  const inJunction = (x, z) => areas.some((area) => areaCovers(area, x, z));
  // Un carrefour proche : une de ses bouches sur ce tronçon à moins de NEAR_M.
  const nearJunction = (segment, d) =>
    areas.some((area) => (area.mouths ?? []).some((m) => m.segment === segment && Math.abs(m.distance - d) < NEAR_M));
  const radius = bubble.radiusMeters;
  // Le banc centre le lieu sur l'origine du repère local.
  const centre = { x: 0, z: 0 };
  const spots = [];

  for (const segment of composer.roads.roadSegments) {
    if (!segment.paved) continue;
    const path = segment.path;
    const start = path[0].distance;
    const end = path[path.length - 1].distance;
    if (end - start < CHORD_M * 2) continue;
    const freeStart = !inJunction(path[0].x, path[0].z);
    const freeEnd = !inJunction(path[path.length - 1].x, path[path.length - 1].z);
    let previous = null;
    let open = null;
    for (let d = start + CHORD_M / 2; d <= end - CHORD_M / 2; d += STEP_M) {
      const a = at(segment, d - CHORD_M / 2);
      const b = at(segment, d + CHORD_M / 2);
      const mid = at(segment, d);
      const near = rowsNear(segment, d, CHORD_M / 2);
      // Une corde sur un ouvrage ou une voie à étage ne lit pas le sol.
      const covered = near.some((r) => segment.works?.[r] || segment.levels?.[r]);
      const grade = covered ? null : (b.y - a.y) / scale / CHORD_M;
      const broke = grade !== null && previous !== null ? Math.abs(grade - previous) : 0;
      previous = grade;
      if (grade === null || (Math.abs(grade) < STEEP && broke < BREAK)) {
        open = null;
        continue;
      }
      const na = bubble.naturalElevationAtLocal(a.x, a.z, NaN);
      const nb = bubble.naturalElevationAtLocal(b.x, b.z, NaN);
      const natural = Number.isFinite(na) && Number.isFinite(nb) ? (nb - na) / CHORD_M : null;
      if (open && d - open.lastD <= MERGE_M) {
        open.lastD = d;
        open.lengthM += STEP_M;
        if (Math.abs(grade) > Math.abs(open.grade)) Object.assign(open, { grade, natural, x: mid.x, z: mid.z, d });
        open.break = Math.max(open.break, broke);
        continue;
      }
      open = { segment, d, lastD: d, x: mid.x, z: mid.z, grade, natural, break: broke, lengthM: STEP_M, freeStart, freeEnd, start, end };
      spots.push(open);
    }
  }

  return spots.map((s) => {
    const { segment } = s;
    const near = rowsNear(segment, s.d, NEAR_M);
    const context = [];
    if (near.some((r) => segment.works?.[r])) context.push('ouvrage');
    if (near.some((r) => segment.levels?.[r])) context.push('etage');
    if (near.some((r) => segment.supports?.[r])) context.push('appui');
    if (near.some((r) => segment.earthFill?.[r])) context.push('remblai');
    if (inJunction(s.x, s.z) || nearJunction(segment, s.d)) context.push('carrefour');
    if ((s.freeStart && s.d - s.start < FREE_END_M) || (s.freeEnd && s.end - s.d < FREE_END_M)) context.push('bout');
    const fromCentre = Math.hypot(s.x - centre.x, s.z - centre.z);
    if (radius && fromCentre > radius - 200) context.push('bord');
    if (s.natural !== null && Math.abs(s.natural) >= STEEP) context.push('relief-raide');
    if (s.natural !== null && Math.abs(s.grade) > Math.abs(s.natural) + BREAK) context.push('plus-raide-que-sol');
    if (s.break >= BREAK) context.push('rupture');
    if (!context.length) context.push('aucun');
    const lngLat = world.frame.toLngLat(s.x, s.z);
    return {
      lng: +lngLat.lng.toFixed(5),
      lat: +lngLat.lat.toFixed(5),
      x: Math.round(s.x),
      z: Math.round(s.z),
      profil: segment.profile,
      pente: +(100 * s.grade).toFixed(1),
      sol: s.natural === null ? null : +(100 * s.natural).toFixed(1),
      rupture: +(100 * s.break).toFixed(1),
      longueurM: s.lengthM,
      contexte: context,
    };
  });
}
