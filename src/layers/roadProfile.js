/*
 * Profil vertical des chaussées affichées, indépendant du terrassement.
 * Les chaussées au sol gardent leur assise terrassée, même quand sa pente
 * dépasse la cible : une contrainte de pente ne justifie pas un viaduc.
 * Les ponts peuvent être lissés sans perdre leur dégagement ; leurs accès,
 * les tunnels et les passages inférieurs conservent leurs cotes.
 * Les portions réellement suspendues publient des appuis pour BridgeLayer,
 * sans changer les drapeaux OSM ni les hauteurs utilisées par le terrain.
 * Les lignes dont le remblai est en terre sont publiées de même
 * (`findEarthFills`) : le terrain s'y relève sous la chaussée, et nulle part
 * où un mur, un tablier ou un profil lissé la porte déjà.
 */
import { pathFrames } from './ribbonGeometry.js';
import {
  contiguousRuns,
  crossSlope,
  profileTakesGuardrail,
  STEEP_CROSS_SLOPE,
  FILL_WALL_MIN_ROWS,
} from './furniturePlacement.js';

export const ROAD_MAX_GRADE = 0.12;
export const ROAD_SUPPORT_DROP_M = 2.5;
export const ROAD_SUPPORT_LENGTH_M = 15;

export function smoothRoadProfiles(segments, { maxGrade = ROAD_MAX_GRADE, crossings = [] } = {}) {
  const fixedRows = new Map();
  for (const crossing of crossings) {
    const lower = segments[crossing.lower];
    if (crossing.rail || !lower) continue;
    if (!fixedRows.has(lower)) fixedRows.set(lower, new Set());
    fixedRows.get(lower).add(crossing.row).add(crossing.row + 1);
  }
  const nodes = [], shared = new Map(), ids = new Map();
  for (const segment of segments) {
    if (!segment.paved) continue;
    const rows = [];
    for (let r = 0; r < segment.path.length; r++) {
      const p = segment.path[r];
      const floor = segment.terrainPlatform?.[r] ?? segment.platform[r];
      const fixed = segment.works?.[r] !== 1 || fixedRows.get(segment)?.has(r);
      const key = `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}:${segment.levels?.[r] ?? 0}`;
      let id = shared.get(key);
      if (id == null) {
        id = nodes.length;
        nodes.push({ height: segment.platform[r], floor, fixed, pin: fixed ? floor : null, links: [] });
        shared.set(key, id);
      } else {
        nodes[id].height = Math.max(nodes[id].height, segment.platform[r]);
        nodes[id].floor = Math.max(nodes[id].floor, floor);
        if (fixed) nodes[id].pin = Math.max(nodes[id].pin ?? -Infinity, floor);
        nodes[id].fixed ||= fixed;
      }
      rows.push(id);
      if (r) {
        const before = rows[r - 1];
        const length = Math.hypot(p.x - segment.path[r - 1].x, p.z - segment.path[r - 1].z);
        nodes[id].links.push([before, length * maxGrade]);
        nodes[before].links.push([id, length * maxGrade]);
      }
    }
    ids.set(segment, rows);
  }
  const envelope = (initial) => {
    const heights = Float64Array.from(initial);
    const queue = new ProfileQueue();
    heights.forEach((h, id) => { if (Number.isFinite(h)) queue.push(h, id); });
    while (queue.size) {
      const [height, id] = queue.pop();
      if (height < heights[id]) continue;
      for (const [next, cost] of nodes[id].links) {
        const h = height - cost;
        if (h <= heights[next] + 1e-9) continue;
        heights[next] = h;
        queue.push(h, next);
      }
    }
    return heights;
  };
  let raised = envelope(nodes.map(n => n.height));
  const ceiling = envelope(nodes.map(n => n.fixed ? -n.pin : -Infinity));
  for (let pass = 0; pass < 12; pass++) {
    const next = raised.slice();
    nodes.forEach((node, id) => {
      if (node.fixed || !node.links.length) return;
      let sum = 0, weight = 0;
      for (const [near, cost] of node.links) {
        const w = 1 / Math.max(cost, .0001);
        sum += raised[near] * w;
        weight += w;
      }
      next[id] = Math.max(node.floor, Math.min(-ceiling[id], sum / weight));
    });
    raised = next;
  }
  raised = envelope(raised);
  let constrained = 0;
  for (const [segment, rows] of ids) {
    rows.forEach((id, r) => {
      const n = nodes[id];
      const wanted = Math.min(raised[id], -ceiling[id]);
      segment.platform[r] = n.fixed ? n.pin : Math.max(n.floor, wanted);
    });
    for (let r = 1; r < rows.length; r++) {
      const d = Math.hypot(segment.path[r].x - segment.path[r - 1].x, segment.path[r].z - segment.path[r - 1].z);
      if (Math.abs(segment.platform[r] - segment.platform[r - 1]) > maxGrade * d + .0001) constrained++;
    }
  }
  return { constrained };
}

export function findRoadSupports(segments, groundAt, areas = null) {
  for (const segment of segments) {
    const { path, platform, halfWidth } = segment;
    const mask = segment.supports = new Uint8Array(path.length);
    if (!segment.paved) continue;
    const frames = segment.frames ?? pathFrames(path);
    const ecartsSol = path.map((p, r) => {
      const px = frames[r * 4 + 2], pz = frames[r * 4 + 3];
      const left = platform[r] - groundAt(p.x + px * halfWidth, p.z + pz * halfWidth);
      const right = platform[r] - groundAt(p.x - px * halfWidth, p.z - pz * halfWidth);
      const centre = platform[r] - groundAt(p.x, p.z);
      return Math.max(centre, Math.min(left, right));
    });
    const suspended = ecartsSol.map((ecart, r) => !segment.works?.[r] && ecart >= ROAD_SUPPORT_DROP_M);
    for (let r = 0; r < path.length;) {
      if (!suspended[r]) { r++; continue; }
      const from = r;
      while (r + 1 < path.length && suspended[r + 1]) r++;
      const to = r++;
      if (path[to].distance - path[from].distance < ROAD_SUPPORT_LENGTH_M) continue;
      let a = from, b = to;
      // Le seuil choisit l'ouvrage ; seul le retour au sol termine ses accès.
      while (a > 0 && !segment.works?.[a] && ecartsSol[a] > .0001) a--;
      while (b + 1 < path.length && !segment.works?.[b] && ecartsSol[b] > .0001) b++;
      for (let i = a; i <= b; i++) if (!segment.works?.[i]) mask[i] = 1;
    }
  }
  for (const area of areas?.areas ?? []) {
    area.supported = !area.terrainCovered && area.deck - groundAt(area.x, area.z) >= ROAD_SUPPORT_DROP_M;
    if (!area.supported) continue;
    for (const segment of segments) segment.junction?.forEach((a, r) => {
      if (areas.areas[a] === area && !segment.works?.[r]) segment.supports[r] = 1;
    });
  }
}

/**
 * Pose sur chaque tronçon `earthFill` : 1 sur les lignes où le terrain porte
 * le remblai de la chaussée. Tout ce qui est au sol, sauf les versants francs
 * assez longs pour un mur de soutènement — même pente et même longueur que
 * `roadsideRelief`, pour que mur et terre ne se disputent aucune ligne.
 */
export function findEarthFills(segments) {
  for (const segment of segments) {
    const { path, platform, edges, probeSpan } = segment;
    const fills = (segment.earthFill = new Uint8Array(path.length));
    if (!segment.paved) continue;
    const onEarth = (r) =>
      !segment.works?.[r] && !segment.supports?.[r] && Math.abs(platform[r] - (segment.terrainPlatform?.[r] ?? platform[r])) < 0.001;
    const rows = Array.from(path, (_, r) => r);
    for (const r of rows) if (onEarth(r)) fills[r] = 1;
    if (!edges || !profileTakesGuardrail(segment.profile)) continue;
    const steep = (r) => onEarth(r) && crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan).slope >= STEEP_CROSS_SLOPE;
    for (const run of contiguousRuns(rows, steep, FILL_WALL_MIN_ROWS)) for (const r of run) fills[r] = 0;
  }
}

class ProfileQueue {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(height, id) {
    const items = this.items;
    let i = items.length;
    items.push([height, id]);
    while (i) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] >= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      items[0] = last;
      for (let i = 0;;) {
        const left = i * 2 + 1, right = left + 1;
        let best = i;
        if (left < items.length && items[left][0] > items[best][0]) best = left;
        if (right < items.length && items[right][0] > items[best][0]) best = right;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return first;
  }
}
