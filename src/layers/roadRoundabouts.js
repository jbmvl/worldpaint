/*
 * roadRoundabouts — reconnaître un giratoire dans le graphe routier.
 *
 * Un giratoire n'est pas une suite de carrefours en T posés sur un anneau : vu
 * nœud par nœud, chaque branche ouvrait sa propre dalle, et deux dalles
 * voisines se chevauchaient, rives peintes en travers de la chaussée. C'est
 * **un** carrefour, dont la surface est une couronne (`roadJunctions`).
 *
 * La donnée ne le dit pas (OpenMapTiles ne porte pas `junction=roundabout`) ;
 * la forme, si. Un anneau est une **face** du graphe — une région que les
 * chaussées bordent sans qu'aucune la traverse — petite et presque ronde. Les
 * faces se lisent en tournant toujours du même côté à chaque nœud : c'est le
 * parcours classique d'un graphe plan, sans recherche de cycle.
 *
 * Seules les chaussées revêtues, au sol, hors ouvrage, bordent une face : un
 * chemin qui coupe un îlot ne le partage pas, et un pont n'est pas un anneau.
 *
 * Module pur : aucun `three`.
 */

import { LEVEL_GROUND, WORK_NONE } from './roadWorks.js';

/** Rayon maximal d'un anneau, en mètres : au-delà, c'est un îlot de rues. */
export const ROUNDABOUT_MAX_RADIUS_M = 45;
/** Rayon minimal : en deçà, un rond de la donnée, pas un anneau qu'on contourne. */
export const ROUNDABOUT_MIN_RADIUS_M = 4;
/**
 * Rondeur minimale, `4πA / P²` : 1 pour un cercle, 0,79 pour un carré. Le
 * seuil écarte un pâté de maisons carré et l'îlot allongé d'une branche
 * dédoublée.
 */
export const ROUNDABOUT_MIN_ROUNDNESS = 0.85;
/** Sommets minimum d'un anneau : un triangle de routes n'en est pas un. */
export const ROUNDABOUT_MIN_NODES = 5;
/** Longueur maximale d'une face parcourue, en arêtes. */
const FACE_MAX_EDGES = 96;

/**
 * Les anneaux du graphe.
 *
 * @param {Array<{a:number,b:number,halfWidth:number,profile:string,works?:number,level?:number}>} edges
 * @param {{xs:ArrayLike<number>, zs:ArrayLike<number>}} nodes
 * @param {Object} [options]
 * @param {Set<string>|null} [options.unpaved] Profils non revêtus.
 * @returns {Array<{x:number, z:number, radius:number, inner:number, outer:number,
 *          halfWidth:number, profile:string, nodes:Set<number>, edges:Set<Object>}>}
 *          `inner` et `outer` bornent la chaussée de l'anneau depuis son centre.
 */
export function findRoundabouts(edges, nodes, { unpaved = null } = {}) {
  const around = new Map();
  const usable = [];
  for (const edge of edges || []) {
    if (edge.a === edge.b || unpaved?.has(edge.profile)) continue;
    if ((edge.works ?? WORK_NONE) !== WORK_NONE || (edge.level ?? LEVEL_GROUND) !== LEVEL_GROUND) continue;
    const index = usable.length;
    usable.push(edge);
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      const angle = Math.atan2(nodes.zs[to] - nodes.zs[from], nodes.xs[to] - nodes.xs[from]);
      if (!around.has(from)) around.set(from, []);
      around.get(from).push({ to, edge: index, angle });
    }
  }
  for (const list of around.values()) list.sort((p, q) => p.angle - q.angle || p.to - q.to);

  // Une demi-arête par sens : `2 * arête + (a → b ? 0 : 1)`.
  const half = (edge, from) => 2 * edge + (usable[edge].a === from ? 0 : 1);
  const visited = new Uint8Array(usable.length * 2);
  const found = [];

  for (let start = 0; start < visited.length; start++) {
    if (visited[start]) continue;
    const face = [];
    const faceEdges = [];
    let edge = start >> 1;
    let from = start & 1 ? usable[edge].b : usable[edge].a;
    let closed = false;
    for (let step = 0; step < FACE_MAX_EDGES; step++) {
      const key = half(edge, from);
      if (visited[key]) {
        closed = key === start;
        break;
      }
      visited[key] = 1;
      const to = usable[edge].a === from ? usable[edge].b : usable[edge].a;
      face.push(from);
      faceEdges.push(usable[edge]);
      // Au nœud d'arrivée, la voisine qui précède celle d'où l'on vient :
      // la face reste à gauche de la marche.
      const list = around.get(to);
      const back = list.findIndex((n) => n.edge === edge);
      const next = list[(back - 1 + list.length) % list.length];
      from = to;
      edge = next.edge;
    }
    if (!closed) continue;
    const ring = ringOf(face, faceEdges, nodes);
    if (ring) found.push(ring);
  }
  return found;
}

/** L'anneau que décrit une face, ou `null` si elle n'en est pas un. */
function ringOf(face, faceEdges, nodes) {
  const count = face.length;
  if (count < ROUNDABOUT_MIN_NODES || new Set(face).size !== count) return null;

  let area2 = 0;
  let perimeter = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    const ax = nodes.xs[face[i]];
    const az = nodes.zs[face[i]];
    const bx = nodes.xs[face[(i + 1) % count]];
    const bz = nodes.zs[face[(i + 1) % count]];
    const cross = ax * bz - bx * az;
    area2 += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
    perimeter += Math.hypot(bx - ax, bz - az);
  }
  // La face extérieure d'un anneau isolé tourne dans l'autre sens : son aire
  // est négative, et il n'est compté qu'une fois.
  if (!(area2 > 0)) return null;
  const area = area2 / 2;
  if ((4 * Math.PI * area) / (perimeter * perimeter) < ROUNDABOUT_MIN_ROUNDNESS) return null;
  cx /= 3 * area2;
  cz /= 3 * area2;

  let near = Infinity;
  let far = 0;
  let sum = 0;
  for (const node of face) {
    const d = Math.hypot(nodes.xs[node] - cx, nodes.zs[node] - cz);
    near = Math.min(near, d);
    far = Math.max(far, d);
    sum += d;
  }
  const radius = sum / count;
  if (radius < ROUNDABOUT_MIN_RADIUS_M || radius > ROUNDABOUT_MAX_RADIUS_M) return null;

  const widest = faceEdges.reduce((a, b) => (b.halfWidth > a.halfWidth ? b : a));
  const halfWidth = widest.halfWidth;
  return {
    x: cx,
    z: cz,
    radius,
    // La chaussée couvre l'anneau tel qu'il est tracé, pas le cercle moyen.
    inner: Math.max(1, near - halfWidth),
    outer: far + halfWidth,
    halfWidth,
    profile: widest.profile,
    nodes: new Set(face),
    edges: new Set(faceEdges),
  };
}
