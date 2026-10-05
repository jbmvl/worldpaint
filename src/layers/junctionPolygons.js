/*
 * junctionPolygons — union et triangulation de polygones plans, pour les
 * surfaces de carrefour.
 *
 * L'union découpe toutes les arêtes à leurs intersections et ne garde que
 * celles qui séparent la chaussée du dehors, orientées chaussée à gauche ;
 * l'appartenance se lit à l'enroulement non nul, si bien qu'un anneau replié
 * compte encore comme chaussée. Les anneaux rendus ont tous l'intérieur à
 * gauche : positifs pour un contour, négatifs pour un îlot.
 *
 * Les sommets d'entrée sont gardés tels quels (mêmes objets) : c'est ce qui
 * permet à l'appelant de retrouver une bouche dans le contour. Un sommet créé
 * à une intersection passe par `blend`, qui lui donne ses attributs.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

const SNAP_M = 1e-4;
const SIDE_M = 2e-4;
/** Double aire en deçà de laquelle un triangle est plat, en m². */
const FLAT = 1e-7;
/** Écart maximal entre un bout d'arête orphelin et le départ qui lui manque. */
const MEND_M = 5e-2;

export const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Aire signée d'un anneau : positive quand l'intérieur est à gauche de la marche. */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/**
 * Enroulement d'un point autour d'anneaux : non nul dedans. `boxes`, s'il est
 * donné, écarte les anneaux qui ne croisent pas le rayon tiré vers +x.
 */
export function windingAt(rings, x, z, boxes = null) {
  let winding = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const box = boxes?.[r];
    if (box && (z < box.minZ || z > box.maxZ || x > box.maxX)) continue;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const side = (b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z);
      if (a.z <= z) {
        if (b.z > z && side > 0) winding++;
      } else if (b.z <= z && side < 0) winding--;
    }
  }
  return winding;
}

function boxOf(points) {
  const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of points) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.z < box.minZ) box.minZ = p.z;
    if (p.z > box.maxZ) box.maxZ = p.z;
  }
  return box;
}

const overlaps = (a, b, margin = 0) =>
  a.minX <= b.maxX + margin && b.minX <= a.maxX + margin && a.minZ <= b.maxZ + margin && b.minZ <= a.maxZ + margin;

/**
 * Union d'anneaux plans.
 *
 * @param {Array<Array<{x:number,z:number}>>} rings Anneaux d'entrée, dans
 *        n'importe quel sens.
 * @param {(parts:Array<[Object, number]>, x:number, z:number) => Object} blend
 *        Fabrique un sommet à une intersection, depuis les sommets pondérés des
 *        deux arêtes qui s'y coupent.
 * @param {Object} [options]
 * @param {number} [options.minHole] Aire en dessous de laquelle un trou est
 *        comblé, en m².
 * @returns {Array<{outline:Array<Object>, holes:Array<Array<Object>>}>}
 */
export function unionRings(rings, blend, { minHole = 0 } = {}) {
  // Sommets confondus à `SNAP_M` près : un seul objet, celui vu en premier.
  const canon = new Map();
  const canonical = (p) => {
    const cx = Math.round(p.x / SNAP_M);
    const cz = Math.round(p.z / SNAP_M);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const known of canon.get((cx + i) * 1e8 + cz + j) ?? []) {
          if (Math.abs(known.x - p.x) <= SNAP_M && Math.abs(known.z - p.z) <= SNAP_M) return known;
        }
      }
    }
    const key = cx * 1e8 + cz;
    if (!canon.has(key)) canon.set(key, []);
    canon.get(key).push(p);
    return p;
  };
  const input = [];
  for (const raw of rings) {
    const ring = [];
    for (const p of raw) {
      const v = canonical(p);
      if (ring.length === 0 || ring[ring.length - 1] !== v) ring.push(v);
    }
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length < 3) continue;
    input.push(ringArea(ring) < 0 ? ring.reverse() : ring);
  }
  if (input.length === 0) return [];
  const boxes = input.map(boxOf);

  const edges = [];
  for (const ring of input) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      edges.push({ p, q, cuts: [{ t: 0, v: p }, { t: 1, v: q }], box: boxOf([p, q]) });
    }
  }

  // Balayage en x : seules les arêtes dont les boîtes se chevauchent se comparent.
  const order = edges.map((_, i) => i).sort((i, j) => edges[i].box.minX - edges[j].box.minX || i - j);
  for (let oi = 0; oi < order.length; oi++) {
    for (let oj = oi + 1; oj < order.length; oj++) {
      if (edges[order[oj]].box.minX > edges[order[oi]].box.maxX + SNAP_M) break;
      const a = edges[Math.min(order[oi], order[oj])];
      const b = edges[Math.max(order[oi], order[oj])];
      if (!overlaps(a.box, b.box, SNAP_M)) continue;
      const rx = a.q.x - a.p.x;
      const rz = a.q.z - a.p.z;
      const la = Math.hypot(rx, rz);
      const sx = b.q.x - b.p.x;
      const sz = b.q.z - b.p.z;
      const lb = Math.hypot(sx, sz);
      const wx = b.p.x - a.p.x;
      const wz = b.p.z - a.p.z;
      const denom = rx * sz - rz * sx;
      if (Math.abs(denom) > 1e-12 * la * lb) {
        const t = (wx * sz - wz * sx) / denom;
        const u = (wx * rz - wz * rx) / denom;
        const ea = SNAP_M / la;
        const eb = SNAP_M / lb;
        if (t < -ea || t > 1 + ea || u < -eb || u > 1 + eb) continue;
        const va = t <= ea ? a.p : t >= 1 - ea ? a.q : null;
        const vb = u <= eb ? b.p : u >= 1 - eb ? b.q : null;
        let v = va ?? vb;
        if (!v) {
          const tc = Math.min(1, Math.max(0, t));
          const uc = Math.min(1, Math.max(0, u));
          v = canonical(blend(
            [[a.p, (1 - tc) / 2], [a.q, tc / 2], [b.p, (1 - uc) / 2], [b.q, uc / 2]],
            a.p.x + rx * tc,
            a.p.z + rz * tc
          ));
        }
        if (v !== a.p && v !== a.q) a.cuts.push({ t: Math.min(1, Math.max(0, t)), v });
        if (v !== b.p && v !== b.q) b.cuts.push({ t: Math.min(1, Math.max(0, u)), v });
      } else if (Math.abs(wx * rz - wz * rx) <= SNAP_M * la) {
        // Colinéaires : chaque bout de l'une coupe l'autre s'il tombe dedans.
        for (const [edge, other, dx, dz, length] of [[a, b, rx, rz, la], [b, a, sx, sz, lb]]) {
          for (const v of [other.p, other.q]) {
            if (v === edge.p || v === edge.q) continue;
            const t = ((v.x - edge.p.x) * dx + (v.z - edge.p.z) * dz) / (length * length);
            if (t > SNAP_M / length && t < 1 - SNAP_M / length) edge.cuts.push({ t, v });
          }
        }
      }
    }
  }

  // Les arêtes qui ont la chaussée à gauche et le dehors à droite.
  const kept = new Map();
  const ids = new Map();
  const id = (v) => {
    if (!ids.has(v)) ids.set(v, ids.size);
    return ids.get(v);
  };
  for (const edge of edges) {
    edge.cuts.sort((m, n) => m.t - n.t);
    for (let k = 1; k < edge.cuts.length; k++) {
      const p = edge.cuts[k - 1].v;
      const q = edge.cuts[k].v;
      if (p === q) continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const length = Math.hypot(dx, dz);
      if (length < SNAP_M) continue;
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const nx = (-dz / length) * SIDE_M;
      const nz = (dx / length) * SIDE_M;
      const left = windingAt(input, mx + nx, mz + nz, boxes) !== 0;
      const right = windingAt(input, mx - nx, mz - nz, boxes) !== 0;
      if (left === right) continue;
      // Un anneau replié tourne à l'envers sur l'une de ses boucles : l'arête
      // est alors retournée pour garder la chaussée à gauche.
      const [from, to] = left ? [p, q] : [q, p];
      const key = `${id(from)}>${id(to)}`;
      if (!kept.has(key)) kept.set(key, { p: from, q: to, used: false });
    }
  }

  // Trois arêtes presque concourantes se coupent en trois points voisins : un
  // bout orphelin se raccorde au départ orphelin le plus proche.
  const balance = new Map();
  for (const edge of kept.values()) {
    balance.set(edge.p, (balance.get(edge.p) || 0) + 1);
    balance.set(edge.q, (balance.get(edge.q) || 0) - 1);
  }
  const starts = [...balance].filter(([, d]) => d > 0).map(([v]) => v);
  for (const [end, d] of balance) {
    for (let k = d; k < 0; k++) {
      let best = null;
      for (const start of starts) {
        if ((balance.get(start) || 0) <= 0) continue;
        const gap = Math.hypot(start.x - end.x, start.z - end.z);
        if (gap <= MEND_M && (!best || gap < best.gap)) best = { start, gap };
      }
      if (!best) break;
      kept.set(`${id(end)}>${id(best.start)}`, { p: end, q: best.start, used: false });
      balance.set(best.start, balance.get(best.start) - 1);
    }
  }

  const outgoing = new Map();
  for (const edge of kept.values()) {
    if (!outgoing.has(edge.p)) outgoing.set(edge.p, []);
    outgoing.get(edge.p).push(edge);
  }
  // À un sommet où deux anneaux se touchent, on tourne le moins possible dans
  // le sens horaire depuis l'arête d'arrivée : chaque anneau se referme seul.
  const nextOf = (edge) => {
    const candidates = (outgoing.get(edge.q) || []).filter((e) => !e.used);
    if (candidates.length <= 1) return candidates[0] ?? null;
    const back = Math.atan2(edge.p.z - edge.q.z, edge.p.x - edge.q.x);
    let best = null;
    let bestTurn = Infinity;
    for (const e of candidates) {
      let turn = back - Math.atan2(e.q.z - e.p.z, e.q.x - e.p.x);
      while (turn <= 1e-12) turn += Math.PI * 2;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = e;
      }
    }
    return best;
  };

  const loops = [];
  for (const start of kept.values()) {
    if (start.used) continue;
    const loop = [];
    let edge = start;
    let closed = false;
    while (edge && !edge.used) {
      edge.used = true;
      loop.push(edge.p);
      if (edge.q === start.p) {
        closed = true;
        break;
      }
      edge = nextOf(edge);
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }

  const outers = [];
  const holes = [];
  for (const raw of loops) {
    // Le premier sommet ne dépend pas de l'ordre de lecture : la triangulation non plus.
    let first = 0;
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].x < raw[first].x || (raw[i].x === raw[first].x && raw[i].z < raw[first].z)) first = i;
    }
    const loop = withoutSpikes([...raw.slice(first), ...raw.slice(0, first)]);
    if (loop.length < 3) continue;
    const area = ringArea(loop);
    // Un éclat de l'ordre de l'accrochage n'est pas une surface.
    if (area > SNAP_M) outers.push({ outline: loop, holes: [], area, box: boxOf(loop) });
    else if (area < -Math.max(minHole, 1e-9)) holes.push(loop);
  }
  for (const hole of holes) {
    const probe = hole[0];
    let owner = null;
    for (const outer of outers) {
      if (probe.x < outer.box.minX || probe.x > outer.box.maxX || probe.z < outer.box.minZ || probe.z > outer.box.maxZ) continue;
      if (windingAt([outer.outline], probe.x, probe.z) === 0 && !outer.outline.includes(probe)) continue;
      if (!owner || outer.area < owner.area) owner = outer;
    }
    if (owner) owner.holes.push(hole);
  }
  return outers.map(({ outline, holes: inner }) => ({ outline, holes: inner }));
}

/**
 * Retire les aiguilles d'un anneau : un sommet où le bord repart sur lui-même,
 * reste de deux intersections voisines.
 */
function withoutSpikes(loop) {
  const ring = loop.slice();
  for (let changed = true; changed && ring.length >= 3; ) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      const back = (a.x - b.x) * (c.x - b.x) + (a.z - b.z) * (c.z - b.z) > 0;
      if (a === c || (back && Math.abs(cross(a, b, c)) <= FLAT)) {
        ring.splice(i, 1);
        if (a === c) ring.splice(i % ring.length, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

function segmentsCross(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > 1e-12 && abD < -1e-12) || (abC < -1e-12 && abD > 1e-12)) &&
    ((cdA > 1e-12 && cdB < -1e-12) || (cdA < -1e-12 && cdB > 1e-12));
}

/**
 * Triangule un contour positif percé de trous négatifs, par oreilles, après
 * avoir relié chaque trou au contour par un pont ; les points intérieurs
 * donnés sont insérés ensuite, et les triangles rendus de Delaunay.
 *
 * @param {Array<Object>} outline
 * @param {Array<Array<Object>>} [holes]
 * @param {Array<Object>} [inner] Sommets à poser à l'intérieur.
 * @returns {{triangles:Array<[Object,Object,Object]>, valid:boolean}}
 */
export function triangulateRings(outline, holes = [], inner = []) {
  let ring = outline.slice();
  const sorted = holes
    .filter((hole) => hole.length >= 3)
    .map((hole) => {
      let top = 0;
      for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[top].x) top = i;
      return { hole, top };
    })
    .sort((m, n) => n.hole[n.top].x - m.hole[m.top].x);

  for (let h = 0; h < sorted.length; h++) {
    const { hole, top } = sorted[h];
    const m = hole[top];
    const rest = sorted.slice(h + 1).map((entry) => entry.hole);
    const candidates = ring.map((p, i) => ({ i, d: (p.x - m.x) ** 2 + (p.z - m.z) ** 2 })).sort((a, b) => a.d - b.d);
    let bridge = -1;
    for (const { i } of candidates) {
      const p = ring[i];
      if (p.x === m.x && p.z === m.z) continue;
      let blocked = false;
      const check = (loop) => {
        for (let k = 0; k < loop.length && !blocked; k++) {
          const a = loop[k];
          const b = loop[(k + 1) % loop.length];
          if (a === p || b === p || a === m || b === m) continue;
          if (segmentsCross(m, p, a, b)) blocked = true;
        }
      };
      check(ring);
      check(hole);
      for (const other of rest) check(other);
      if (blocked) continue;
      const mx = (m.x + p.x) / 2;
      const mz = (m.z + p.z) / 2;
      if (windingAt([ring, hole, ...rest], mx, mz) === 0) continue;
      bridge = i;
      break;
    }
    if (bridge < 0) continue;
    const loop = [...hole.slice(top), ...hole.slice(0, top), m];
    ring = [...ring.slice(0, bridge + 1), ...loop, ...ring.slice(bridge)];
  }

  const triangles = [];
  const same = (a, b) => a.x === b.x && a.z === b.z;
  const indices = ring.map((_, i) => i);
  let valid = true;
  while (indices.length > 3) {
    let clipped = false;
    for (let k = 0; k < indices.length; k++) {
      const a = ring[indices[(k + indices.length - 1) % indices.length]];
      const b = ring[indices[k]];
      const c = ring[indices[(k + 1) % indices.length]];
      if (cross(a, b, c) <= FLAT) continue;
      let ear = true;
      for (const j of indices) {
        const p = ring[j];
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        if (cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      triangles.push([a, b, c]);
      indices.splice(k, 1);
      clipped = true;
      break;
    }
    if (clipped) continue;
    // Un sommet aligné sur ses voisins, ou un aller-retour de pont, n'est
    // jamais une oreille : il se retire sans triangle.
    const flat = indices.findIndex((j, k) => {
      const a = ring[indices[(k + indices.length - 1) % indices.length]];
      const c = ring[indices[(k + 1) % indices.length]];
      return Math.abs(cross(a, ring[j], c)) <= FLAT;
    });
    if (flat < 0) {
      valid = false;
      break;
    }
    indices.splice(flat, 1);
  }
  if (indices.length === 3) {
    const [a, b, c] = indices.map((j) => ring[j]);
    if (cross(a, b, c) > FLAT) triangles.push([a, b, c]);
  }
  // Un point intérieur partage le triangle qui le contient, ou les deux qui
  // bordent l'arête où il tombe.
  for (const p of inner) {
    const around = [];
    for (let t = 0; t < triangles.length; t++) {
      const [a, b, c] = triangles[t];
      if (cross(a, b, p) >= -FLAT && cross(b, c, p) >= -FLAT && cross(c, a, p) >= -FLAT) around.push(t);
    }
    if (around.length === 0 || around.some((t) => triangles[t].some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 1e-6))) continue;
    // Dans un triangle, ou sur l'arête de deux : chacun se partage autour du point.
    for (const t of around.reverse()) {
      const [a, b, c] = triangles[t];
      const parts = [[a, b, p], [b, c, p], [c, a, p]].filter((tri) => cross(...tri) > FLAT);
      triangles.splice(t, 1, ...parts);
    }
  }
  delaunay(triangles);
  return { triangles, valid };
}

/** Vrai si `d` tombe dans le cercle circonscrit au triangle positif `a b c`. */
function inCircle(a, b, c, d) {
  const ax = a.x - d.x;
  const az = a.z - d.z;
  const bx = b.x - d.x;
  const bz = b.z - d.z;
  const cx = c.x - d.x;
  const cz = c.z - d.z;
  return (ax * ax + az * az) * (bx * cz - cx * bz) - (bx * bx + bz * bz) * (ax * cz - cx * az) +
    (cx * cx + cz * cz) * (ax * bz - bx * az) > 1e-9;
}

/**
 * Bascule les diagonales intérieures jusqu'à des triangles de Delaunay : les
 * oreilles taillent de longs éventails, et une cote interpolée sur un triangle
 * qui traverse le carrefour s'écarte de ses bords. Les arêtes du contour, qui
 * n'ont qu'un triangle, ne bougent jamais.
 */
function delaunay(triangles) {
  const ids = new Map();
  for (const t of triangles) for (const v of t) if (!ids.has(v)) ids.set(v, ids.size);
  const n = ids.size;
  const key = (p, q) => {
    const a = ids.get(p);
    const b = ids.get(q);
    return a < b ? a * n + b : b * n + a;
  };
  const owners = new Map();
  const link = (t, sign) => {
    for (let k = 0; k < 3; k++) {
      const edge = key(triangles[t][k], triangles[t][(k + 1) % 3]);
      if (sign > 0) {
        if (!owners.has(edge)) owners.set(edge, []);
        owners.get(edge).push(t);
      } else {
        const list = owners.get(edge);
        list.splice(list.indexOf(t), 1);
      }
    }
  };
  triangles.forEach((_, t) => link(t, 1));
  const stack = [];
  for (const t of triangles) for (let k = 0; k < 3; k++) stack.push([t[k], t[(k + 1) % 3]]);
  for (let guard = 64 * triangles.length + 64; stack.length && guard > 0; guard--) {
    const [p, q] = stack.pop();
    const pair = owners.get(key(p, q));
    if (!pair || pair.length !== 2) continue;
    // `t` porte l'arête dans le sens a → b, `u` dans l'autre.
    let [t, u] = pair;
    let k = triangles[t].indexOf(p);
    if (triangles[t][(k + 1) % 3] !== q) {
      [t, u] = [u, t];
      k = triangles[t].indexOf(p);
      if (triangles[t][(k + 1) % 3] !== q) continue;
    }
    const a = p;
    const b = q;
    const c = triangles[t][(k + 2) % 3];
    const d = triangles[u].find((v) => v !== a && v !== b);
    if (!d || !inCircle(a, b, c, d) || owners.get(key(c, d))?.length) continue;
    // La diagonale `c d` doit rester dans le quadrilatère.
    if (cross(c, a, d) <= FLAT || cross(d, b, c) <= FLAT) continue;
    link(t, -1);
    link(u, -1);
    triangles[t] = [c, a, d];
    triangles[u] = [d, b, c];
    link(t, 1);
    link(u, 1);
    stack.push([a, d], [d, b], [b, c], [c, a]);
  }
}
