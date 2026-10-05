/*
 * Un petit réseau pour éprouver les surfaces de carrefour sans tuiles : des
 * lignes recousues par le graphe, des tronçons métrés, les surfaces, et les
 * maillages que le réseau en tirerait.
 */
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, junctionRibbonRuns, junctionSurface } from '../src/layers/roadJunctions.js';
import { appendRibbon, createRibbonBuffer, pathFrames, subdividePath } from '../src/layers/ribbonGeometry.js';

/** Un tronçon métré, plate-forme donnée par `deck(x, z)`. */
export function segmentOf(points, halfWidth, { profile = 'minor', deck = () => 0, level = 0, edges = [], works = null } = {}) {
  const path = subdividePath(points, 3);
  return {
    profile,
    halfWidth,
    paved: true,
    path,
    frames: pathFrames(path),
    platform: Float32Array.from(path, (p) => deck(p.x, p.z)),
    levels: new Int8Array(path.length).fill(level),
    works: works ? new Uint8Array(path.length).fill(works) : new Uint8Array(path.length),
    graphEdges: new Set(edges),
  };
}

/** Les tronçons d'un graphe recousu, au pas donné. */
export function segmentsOf(chains, { step = 3, deck = () => 0 } = {}) {
  return chains.map((chain) => {
    const path = subdividePath(chain.points, step);
    return {
      ...chain,
      paved: true,
      path,
      frames: pathFrames(path),
      platform: Float32Array.from(path, (p) => deck(p.x, p.z)),
      levels: new Int8Array(path.length).fill(chain.levels?.[0] ?? 0),
      works: new Uint8Array(path.length).fill(chain.works?.[0] ?? 0),
    };
  });
}

/** Des lignes au réseau : graphe, tronçons et surfaces, cotes relues. */
export function networkOf(lines, { step = 3, deck = () => 0, inverse = false, graph = {} } = {}) {
  const input = inverse ? lines.slice().reverse().map((l) => ({ ...l, points: l.points.slice().reverse() })) : lines;
  const { chains, junctions } = mergeRoadLines(input, graph);
  const segments = segmentsOf(chains, { step, deck });
  const areas = new JunctionAreas(junctions, segments);
  areas.updateDecks();
  return { chains, junctions, segments, areas };
}

/**
 * Des carrefours de graphe sans tuiles : un tronçon par polyligne de branche,
 * partagé entre les deux nœuds qu'il relie.
 */
export function networkOfJunctions(junctions, { deck = () => 0 } = {}) {
  const key = (p) => `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`;
  const shared = new Map();
  const segments = [];
  const graph = junctions.map((junction) => ({
    ...junction,
    branches: junction.branches.map((branch) => {
      const ends = [key(branch.path[0]), key(branch.path.at(-1))].sort().join('/');
      let entry = shared.get(ends);
      if (!entry) {
        const edge = {};
        entry = { edge, segment: segmentOf(branch.path, branch.halfWidth, { profile: branch.profile, deck, level: junction.level ?? 0, edges: [edge] }) };
        shared.set(ends, entry);
        segments.push(entry.segment);
      }
      return { ...branch, edge: entry.edge };
    }),
  }));
  const areas = new JunctionAreas(graph, segments);
  areas.updateDecks();
  return { junctions: graph, segments, areas };
}

/** Les maillages : une surface par carrefour, puis les rubans. */
export function buffersOf({ areas, segments }, { lift = 0.02 } = {}) {
  const buffers = areas.areas.map((area) => junctionSurface(area, lift));
  for (const segment of segments) {
    for (const run of junctionRibbonRuns(segment, areas, [{ from: 0, to: segment.path.length - 1 }])) {
      const buffer = createRibbonBuffer();
      appendRibbon(buffer, { ...run, halfWidth: segment.halfWidth, sampleElevation: () => 0, lift });
      buffers.push(buffer);
    }
  }
  return buffers;
}

/** Les triangles d'un maillage, en points `[x, y, z]`. */
export function trianglesOf(buffer) {
  return Array.from({ length: buffer.indices.length / 3 }, (_, i) =>
    buffer.indices.slice(i * 3, i * 3 + 3).map((k) => buffer.positions.slice(k * 3, k * 3 + 3)));
}

/** Cote d'un point dans un triangle, ou `null` s'il n'y tombe pas. */
export function heightIn([a, b, c], x, z, slack = 1e-7) {
  const ux = b[0] - a[0];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vz = c[2] - a[2];
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-12) return null;
  const wb = ((x - a[0]) * vz - (z - a[2]) * vx) / det;
  const wc = (ux * (z - a[2]) - uz * (x - a[0])) / det;
  if (wb < -slack || wc < -slack || wb + wc > 1 + slack) return null;
  return a[1] + (b[1] - a[1]) * wb + (c[1] - a[1]) * wc;
}

/** Aire du recouvrement de deux triangles, en plan. */
export function overlap(a, b) {
  const cross = (u, v, p) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const orient = (t) => {
    const pts = t.map((p) => [p[0], p[2]]);
    return cross(pts[0], pts[1], pts[2]) < 0 ? pts.reverse() : pts;
  };
  let polygon = orient(a);
  const clip = orient(b);
  for (let i = 0; i < 3; i++) {
    const u = clip[i];
    const v = clip[(i + 1) % 3];
    const out = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j];
      const q = polygon[(j + 1) % polygon.length];
      const dp = cross(u, v, p);
      const dq = cross(u, v, q);
      if (dp >= 0) out.push(p);
      if ((dp < 0) !== (dq < 0)) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    polygon = out;
  }
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p[0] * q[1] - p[1] * q[0];
  }, 0)) / 2;
}
