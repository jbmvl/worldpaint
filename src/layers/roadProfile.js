/*
 * Profil vertical des chaussées. Une ligne n'a qu'une cote, lue par le
 * terrain comme par l'affichage.
 * `gradeRoadNetwork` aplanit le réseau au sol comme un seul graphe, dans la
 * limite du terrassement consenti : un nœud partagé n'a qu'une cote, et les
 * voies qui se longent se rejoignent sur un plan commun.
 * Les chaussées au sol gardent ensuite cette assise, même quand sa pente
 * dépasse la cible : une contrainte de pente ne justifie pas un viaduc.
 * Les ponts peuvent être lissés sans perdre leur dégagement ; leurs accès,
 * les tunnels et les passages inférieurs conservent leurs cotes, et le
 * terrain ne lit pas la cote d'un tablier.
 * Les portions réellement suspendues publient des appuis pour BridgeLayer,
 * sans changer les drapeaux OSM.
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

/**
 * Aplanit le profil en long du réseau revêtu, dans la limite du terrassement
 * consenti. Dressée section par section, une chaussée épouse le bruit du MNT ;
 * un terrassier tend une pente et laisse l'ouvrage rattraper l'écart.
 *
 * Le réseau est un graphe de lignes. Deux chaussées qui partagent un point au
 * même niveau y partagent une cote, et se raccordent donc sans couture ; deux
 * voies qui se longent (`facing`) sont liées en travers, ligne à ligne, et se
 * rejoignent sur un plan commun. Chaque ligne est tirée vers la moyenne de ses
 * voisines, puis ramenée dans sa bande autour du relief relevé — nulle, la
 * route colle au sol ; large, elle s'en détache et le déblai, le mur ou le
 * remblai suivent. Deux rues en terrasse, que leurs bandes ne réconcilient
 * pas, restent chacune à sa cote.
 *
 * À `strength` 0,5 et quarante passes, sur un pas de 5 m, il reste 0 % d'une
 * vague de 40 m, 21 % d'une vague de 80 m et 94 % d'une pente de 400 m.
 *
 * Un bout libre ne bouge pas : il finit au bord de la portée, contre un autre
 * découpage du même tracé, et doit repartir de la cote du terrain. Son
 * influence s'éteint en cinquante mètres.
 *
 * Passes de Jacobi (toutes les lignes lues dans le même état) et bandes
 * réunies sans ordre : ni le sens des tracés ni le rang des tronçons ne
 * décident du résultat.
 *
 * @param {Array<Object>} segments Tronçons revêtus : `path`, `levels`, et
 *        `platform`, le relief relevé, remplacé par le profil aplani.
 * @param {Array<{maxCut:Float32Array|number, maxFill:Float32Array|number}>} bands
 *        Enfoncement et exhaussement tolérés, par tronçon puis par ligne.
 * @param {Object} [options]
 * @param {Array} [options.facing] Vis-à-vis des voies qui se longent (`roadBundles.facingRows`).
 */
export function gradeRoadNetwork(segments, bands, { facing = null, iterations = 40, strength = 0.5 } = {}) {
  const ids = new Map();
  const rowsOf = [];
  const low = [];
  const high = [];
  const least = [];
  const most = [];
  // Voisines le long du tracé, puis en travers : rang et poids, à plat.
  const along = [];
  const across = [];
  const bound = (v, r) => (typeof v === 'number' ? v : v?.[r] ?? 0);
  segments.forEach((segment, si) => {
    const { path, platform, levels } = segment;
    const rows = new Int32Array(path.length);
    for (let r = 0; r < path.length; r++) {
      const p = path[r];
      const key = `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}:${levels?.[r] ?? 0}`;
      const floor = platform[r] - bound(bands[si]?.maxCut, r);
      const ceiling = platform[r] + bound(bands[si]?.maxFill, r);
      let id = ids.get(key);
      if (id === undefined) {
        id = low.length;
        ids.set(key, id);
        low.push(floor);
        high.push(ceiling);
        least.push(platform[r]);
        most.push(platform[r]);
        along.push([]);
        across.push(null);
      } else {
        low[id] = Math.max(low[id], floor);
        high[id] = Math.min(high[id], ceiling);
        least[id] = Math.min(least[id], platform[r]);
        most[id] = Math.max(most[id], platform[r]);
      }
      rows[r] = id;
      if (r && rows[r - 1] !== id) {
        along[id].push(rows[r - 1]);
        along[rows[r - 1]].push(id);
      }
    }
    rowsOf.push(rows);
  });
  facing?.forEach((own, si) => {
    own?.forEach((links, r) => {
      if (!links) return;
      const list = (across[rowsOf[si][r]] ??= []);
      for (let i = 0; i < links.length; i += 3) {
        const other = rowsOf[links[i]];
        const row = links[i + 1];
        const t = links[i + 2];
        list.push(other[row], 1 - t, other[Math.min(other.length - 1, row + 1)], t);
      }
    });
  });

  const count = low.length;
  let heights = new Float64Array(count);
  let next = new Float64Array(count);
  for (let id = 0; id < count; id++) {
    // Deux relevés du même point que leurs bandes ne réconcilient pas : le milieu.
    if (low[id] > high[id]) low[id] = high[id] = (low[id] + high[id]) / 2;
    heights[id] = Math.min(high[id], Math.max(low[id], (least[id] + most[id]) / 2));
  }

  for (let k = 0; k < iterations; k++) {
    for (let id = 0; id < count; id++) {
      const around = along[id];
      if (around.length < 2) {
        next[id] = heights[id];
        continue;
      }
      let sum = 0;
      let weight = around.length;
      for (let n = 0; n < around.length; n++) sum += heights[around[n]];
      const beside = across[id];
      if (beside) {
        for (let n = 0; n < beside.length; n += 2) {
          sum += heights[beside[n]] * beside[n + 1];
          weight += beside[n + 1];
        }
      }
      const eased = heights[id] + strength * (sum / weight - heights[id]);
      next[id] = Math.min(high[id], Math.max(low[id], eased));
    }
    [heights, next] = [next, heights];
  }

  segments.forEach((segment, si) => {
    rowsOf[si].forEach((id, r) => { segment.platform[r] = heights[id]; });
  });
}

export function smoothRoadProfiles(segments, { maxGrade = ROAD_MAX_GRADE, crossings = [] } = {}) {
  const fixedRows = new Map();
  for (const crossing of crossings) {
    const lower = segments[crossing.lower];
    if (crossing.rail || !lower) continue;
    if (!fixedRows.has(lower)) fixedRows.set(lower, new Set());
    fixedRows.get(lower).add(crossing.row).add(crossing.row + 1);
  }
  const nodes = [], shared = new Map(), ids = new Map(), seats = new Map();
  for (const segment of segments) {
    if (!segment.paved) continue;
    const rows = [];
    // L'assise des lignes au sol : chacune garde la sienne, même au point qu'elle partage avec un tablier relevé.
    const seat = new Float64Array(segment.path.length).fill(NaN);
    seats.set(segment, seat);
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
      if (fixed) seat[r] = floor;
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
    const seat = seats.get(segment);
    rows.forEach((id, r) => {
      const n = nodes[id];
      const wanted = Math.min(raised[id], -ceiling[id]);
      segment.platform[r] = seat[r] === seat[r] ? seat[r] : n.fixed ? n.pin : Math.max(n.floor, wanted);
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
    // Chaque sommet contre le sol qu'il surplombe : la cote moyenne d'une
    // surface en pente ne dit rien du vide sous un de ses points.
    const ecarts = area.vertices.filter(p => Number.isFinite(p.y)).map(p => p.y - groundAt(p.x, p.z));
    const ecart = ecarts.length ? ecarts.reduce((somme, e) => somme + e, 0) / ecarts.length : area.deck - groundAt(area.x, area.z);
    area.supported = !area.terrainCovered && ecart >= ROAD_SUPPORT_DROP_M;
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
