/*
 * Franchissements : le tablier garde ses appuis ; le passage inférieur reçoit
 * le déblai nécessaire. Sur autoroute, une part du dégagement devient un
 * remblai des accès, sauf dans un réseau supérieur dense en carrefours.
 * Les décisions précèdent les maillages. Aucune proximité ne vaut croisement,
 * aucune correction ne lit le terrain déjà corrigé, et les rails ne se soudent
 * jamais au graphe routier. Les passages à niveau et les tunnels sous le rail
 * ancrent son profil et bornent une tranchée voisine. L'eau n'impose aucune revanche.
 */
import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { mergeRoadLines, RoadIndex } from './roadGraph.js';
import { subdividePath } from './ribbonGeometry.js';
import { WORK_BRIDGE, WORK_TUNNEL, roadLevelFor, resampleLevels, raiseApproaches, workRuns, APPROACH_WELD_M, BRIDGE_CLEARANCE_M } from './roadWorks.js';

// Ballast, caténaire et épaisseur du tablier compris dans le passage libre.
const RAIL_CLEARANCE_M = 8.5;
const RAIL_GRADE = 0.025;
const MOTORWAY_CUT_M = 1.5;
const JUNCTION_REACH_M = 100;

export function collectCrossingRails(source, tiles, frame, elevation) {
  const lines = [];
  const { origin, scale, zoom } = frame;
  source.forEachFeature('transportation', tiles, (geometry, properties) => {
    if (properties.class !== 'rail' || properties.brunnel) return;
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] :
      geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const part of parts) {
      const points = part.filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z)).map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));
      if (points.length > 1) lines.push({ points, profile: 'rail', halfWidth: 1.75, level: roadLevelFor(properties) });
    }
  });
  return mergeRoadLines(lines).chains.map((chain) => {
    const path = subdividePath(chain.points, 4);
    return { path, halfWidth: chain.halfWidth, profile: 'rail',
      levels: resampleLevels(chain.points, chain.levels, path),
      platform: Float32Array.from(path, (p) => elevation(p.x, p.z)) };
  });
}

export function intersection(a, b, c, d) {
  const ux = b.x - a.x, uz = b.z - a.z;
  const vx = d.x - c.x, vz = d.z - c.z;
  const cross = ux * vz - uz * vx;
  if (Math.abs(cross) < 1e-8) return null;
  const dx = c.x - a.x, dz = c.z - a.z;
  const t = (dx * vz - dz * vx) / cross;
  const u = (dx * uz - dz * ux) / cross;
  if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)),
    x: a.x + t * ux, z: a.z + t * uz,
    sin: Math.abs(cross) / (Math.hypot(ux, uz) * Math.hypot(vx, vz)) };
}
const at = (values, row, t) => values[row] * (1 - t) + values[row + 1] * t;

export function stitchBridgeAccesses(segments) {
  const ends = [];
  for (const segment of segments) for (const run of workRuns(segment.works, WORK_BRIDGE)) {
    for (const row of [run.from, run.to]) ends.push({ segment, point: segment.path[row], height: segment.platform[row] });
  }
  for (const segment of segments) {
    const anchors = [];
    for (const row of [0, segment.path.length - 1]) {
      if (segment.works?.[row]) continue;
      const p = segment.path[row];
      const candidates = ends.filter((end) => end.segment !== segment &&
        Math.hypot(end.point.x - p.x, end.point.z - p.z) <= APPROACH_WELD_M);
      if (candidates.length) anchors.push({ distance: p.distance,
        delta: Math.min(...candidates.map((end) => end.height)) - segment.platform[row] });
    }
    for (let r = 0; r < segment.path.length; r++) {
      if (segment.works?.[r]) continue;
      let delta = 0;
      for (const anchor of anchors) {
        const t = Math.max(0, 1 - Math.abs(segment.path[r].distance - anchor.distance) / 30);
        const correction = anchor.delta * t * t * (3 - 2 * t);
        if (Math.abs(correction) > Math.abs(delta)) delta = correction;
      }
      segment.platform[r] += delta;
    }
  }
}

export function resolveTransportCrossings(segments, rails = [], { centres = [], bench = 0 } = {}) {
  stitchBridgeAccesses(segments);
  const lower = [...segments, ...rails];
  const index = new RoadIndex(lower, { margin: 0, includeWorks: true });
  const crossings = [];
  const junctionCounts = new Map();
  const railStops = rails.map(() => []);
  for (let ri = 0; ri < rails.length; ri++) {
    const rail = rails[ri];
    for (let r = 0; r < rail.path.length - 1; r++) {
      const a = rail.path[r], b = rail.path[r + 1];
      index.forEachNear(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), (road, row, si) => {
        if (si >= segments.length) return;
        const tunnel = road.works?.[row] === WORK_TUNNEL || road.works?.[row+1] === WORK_TUNNEL;
        if (!tunnel && (road.works?.[row] || road.works?.[row+1])) return;
        const roadLevel = road.levels?.[row] ?? 0, railLevel = rail.levels?.[r] ?? 0;
        if (tunnel ? roadLevel > railLevel : roadLevel !== railLevel) return;
        const hit = intersection(a, b, road.path[row], road.path[row + 1]);
        if (hit) railStops[ri].push({ distance: a.distance + hit.t * (b.distance - a.distance),
          half: (road.halfWidth + bench) / Math.max(0.1, hit.sin) });
      });
    }
  }
  const seen = new Set();
  for (let si = 0; si < segments.length; si++) {
    const upper = segments[si];
    for (const run of workRuns(upper.works, WORK_BRIDGE)) {
      for (let r = run.from; r < run.to; r++) {
        const a = upper.path[r], b = upper.path[r + 1];
        index.forEachNear(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), (under, row, li) => {
          if (under === upper || under.works?.[row] || under.works?.[row + 1]) return;
          if ((under.levels?.[row] ?? 0) > (upper.levels?.[r] ?? 0)) return;
          const hit = intersection(a, b, under.path[row], under.path[row + 1]);
          if (!hit) return;
          const near = (p) => Math.hypot(hit.x - p.x, hit.z - p.z) <= APPROACH_WELD_M;
          const atAbutment = near(upper.path[run.from]) || near(upper.path[run.to]);
          const atEnd = near(under.path[0]) || near(under.path[under.path.length - 1]);
          // Une branche qui rejoint la culée est un accès, pas un passage inférieur.
          if (li < segments.length && atAbutment && atEnd) return;
          const key = `${si}:${run.from}:${li}:${Math.round(hit.x * 100)}:${Math.round(hit.z * 100)}`;
          if (seen.has(key)) return;
          seen.add(key);
          const rail = li >= segments.length;
          const clearance = rail ? RAIL_CLEARANCE_M : BRIDGE_CLEARANCE_M;
          const missing = Math.max(0, at(under.platform, row, hit.u) + clearance - at(upper.platform, r, hit.t));
          const runKey = `${si}:${run.from}`;
          if (!junctionCounts.has(runKey)) {
            const probe = segments.map((segment) => ({ ...segment, platform: new Float32Array(segment.path.length) }));
            raiseApproaches(probe, [{ segment: si, row: run.from, lift: 1 }, { segment: si, row: run.to, lift: 1 }],
              { centres, ramp: JUNCTION_REACH_M });
            const junctions = new Set();
            for (const segment of probe) for (let j = 0; j < (segment.junction?.length ?? 0); j++) {
              if (segment.platform[j] > 0 && segment.junction[j] >= 0) junctions.add(segment.junction[j]);
            }
            junctionCounts.set(runKey, junctions.size);
          }
          const crowded = junctionCounts.get(runKey) >= 2;
          const motorway = under.profile === 'express';
          const cut = !rail && motorway && !crowded ? Math.min(MOTORWAY_CUT_M, missing * 0.25) : missing;
          crossings.push({ upper: si, upperRow: r, lower: li, run, row, ...hit, rail, clearance, missing,
            lift: missing - cut, cut, reason: rail ? 'rail' : crowded ? 'carrefours' : motorway ? 'autoroute' : 'route' });
        });
      }
    }
  }

  const rises = new Map();
  for (const c of crossings) {
    const key = `${c.upper}:${c.run.from}`;
    rises.set(key, Math.max(rises.get(key) ?? 0, c.lift));
  }
  for (const c of crossings) if (c.rail) rises.set(`${c.upper}:${c.run.from}`, 0);
  const up = [], down = [], railDown = [];
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    segment.crossingBase = segment.platform.slice();
    for (const run of workRuns(segment.works, WORK_BRIDGE)) {
      const lift = rises.get(`${s}:${run.from}`) ?? 0;
      for (let r = run.from; r <= run.to; r++) segment.platform[r] += lift;
      up.push({ segment: s, row: run.from, lift }, { segment: s, row: run.to, lift });
    }
  }
  for (const rail of rails) rail.crossingBase = rail.platform.slice();
  raiseApproaches(segments, up, { centres });
  for (const c of crossings) {
    const lift = rises.get(`${c.upper}:${c.run.from}`);
    c.lift = lift;
    c.cut = Math.max(0, at(lower[c.lower].platform, c.row, c.u) + c.clearance -
      at(segments[c.upper].platform, c.upperRow, c.t));
    // Le creux reste plein sous toute la largeur du tablier, même en biais.
    const segment = lower[c.lower];
    const distance = at(segment.path.map((p) => p.distance), c.row, c.u);
    const half = (segments[c.upper].halfWidth + bench) / Math.max(0.1, c.sin) + 4;
    for (let r = 0; r < segment.path.length; r++) {
      if (Math.abs(segment.path[r].distance - distance) > half) continue;
      (c.rail ? railDown : down).push({ segment: c.rail ? c.lower - segments.length : c.lower, row: r, lift: c.cut });
    }
  }
  raiseApproaches(segments, down, { centres, direction: -1 });
  // Un passage à niveau ou un tunnel inférieur ancre le rail : le raccord
  // de la tranchée se termine avant son
  // emprise. Les corrections se combinent par maximum, jamais par addition.
  for (let ri = 0; ri < rails.length; ri++) {
    const rail = rails[ri];
    const seeds = railDown.filter((seed) => seed.segment === ri && seed.lift > 0);
    for (const seed of seeds) {
      const centre = rail.path[seed.row].distance;
      let left = 1.5 * seed.lift / RAIL_GRADE, right = left;
      for (const stop of railStops[ri]) {
        if (stop.distance < centre) left = Math.min(left, Math.max(0, centre - stop.distance - stop.half));
        else right = Math.min(right, Math.max(0, stop.distance - centre - stop.half));
      }
      for (let r = 0; r < rail.path.length; r++) {
        const distance = rail.path[r].distance - centre;
        const reach = distance < 0 ? left : right;
        const t = reach > 0 ? Math.max(0, 1 - Math.abs(distance) / reach) : 0;
        rail.platform[r] = Math.min(rail.platform[r], rail.crossingBase[r] - seed.lift * t * t * (3 - 2 * t));
      }
    }
  }
  return crossings;
}
