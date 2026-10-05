/*
 * roadJunctions — un carrefour est une surface : la chaussée des routes qui s'y
 * rencontrent, réunie.
 *
 * Chaque chaussée qui part d'un nœud de carrefour en est un **bras**, jusqu'au
 * nœud suivant de sa chaussée. Le bras prête au carrefour la bande de son
 * propre ruban, du nœud à sa **bouche** : la première section qui ne touche
 * plus ni la bande d'un autre bras ni un arrondi de son carrefour. La bouche
 * se pose donc au-delà de la largeur des autres branches, au-delà des rayons
 * de bordure, et, à une fourche, là où les deux voies se sont séparées.
 *
 * Entre deux bras voisins, un secteur rentrant reçoit un **arrondi** (le rayon
 * de bordure, qui ajoute de la chaussée dans l'angle) ; un secteur saillant,
 * le **joint** qui comble l'encoche entre deux bouts coupés au nœud ; deux
 * rives qui ne se rejoignent pas en avant du nœud, un **biseau**. Un angle
 * plus fermé que `JUNCTION_FORK_ANGLE` garde sa pointe : c'est le nez d'un
 * îlot de fourche.
 *
 * La surface est l'union de ces bandes, arrondis, joints et biseaux
 * (`junctionPolygons`). Rien n'y dépend d'un nombre de branches, d'une forme,
 * ni de la façon dont le graphe a recousu les lignes : deux carrefours dont
 * les morceaux se touchent partagent une surface, et un giratoire
 * (`roadRoundabouts`) prête son anneau entier, son îlot restant un trou de
 * l'union. Un trou plus petit que `JUNCTION_ISLAND_MIN_M2` n'est pas un îlot.
 * Une bouche que la surface d'un voisin recouvre avance jusqu'à la border.
 *
 * Le ruban s'arrête à la bouche sur la **même** section que la bande
 * (`capAt`). Chaque sommet de la surface tient sa cote des plates-formes dont
 * il vient (`refs`), relues une fois les plates-formes cousues et les ouvrages
 * posés (`updateDecks`) ; ses sommets intérieurs sont l'axe même des
 * chaussées. Sur un versant, la surface est gauche et ne fait de marche
 * contre aucun ruban.
 *
 * La chaussée continue de traverser le carrefour dans les données : seul son
 * ruban s'interrompt. Emprise, déblai, couture et mobilier lisent une route
 * entière.
 *
 * C'est aussi ici que se décide qui cède le passage (`branchYields`), une fois
 * pour le marquage et le panneau.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

import { LEVEL_GROUND } from './roadWorks.js';
import { denseCells } from './roadGraph.js';
import { pathFrames } from './ribbonGeometry.js';
import { unionRings, triangulateRings, windingAt } from './junctionPolygons.js';

/**
 * Rayon de raccordement d'un coin, en part de la plus étroite des deux
 * demi-largeurs qui s'y rejoignent. Cote de tracé routier (le braquage d'un
 * véhicule), pas de goût.
 */
export const JUNCTION_CORNER_RATIO = 1.2;
/** Bornes de ce rayon, en mètres. */
export const JUNCTION_CORNER_MIN_M = 1.2;
export const JUNCTION_CORNER_MAX_M = 7;
/** Côtés d'un arc de raccordement. */
export const JUNCTION_ARC_STEPS = 4;
/** Longueur d'un biseau entre deux rives qui se longent, en part de leur écart. */
export const JUNCTION_TAPER_RATIO = 6;
/** Recul de la bouche au-delà de la première section dégagée, en mètres. */
export const JUNCTION_MOUTH_MARGIN_M = 0.4;
/** Angle de coin en deçà duquel deux rives gardent leur pointe (une fourche). */
export const JUNCTION_FORK_ANGLE = (30 * Math.PI) / 180;
/** Portée maximale d'une bouche le long de son bras, en mètres. */
export const JUNCTION_FORK_REACH_M = 90;
/** Aire en deçà de laquelle un trou de la surface n'est pas un îlot, en m². */
export const JUNCTION_ISLAND_MIN_M2 = 2;
/** Côté d'une cellule de l'index des surfaces, en mètres. */
export const JUNCTION_CELL_M = 24;
/**
 * Débord d'inscription d'une surface dans l'index, en mètres — et donc portée
 * maximale d'une interrogation au-delà du contour (le déblai du terrain).
 */
export const JUNCTION_REACH_M = 12;

/**
 * Longueur en deçà de laquelle le ruban entre deux surfaces n'est pas dessiné :
 * elles se rejoignent sur le tronçon.
 */
const JUNCTION_GAP_MIN_M = 2;
/** Au-delà, deux rives sont dans le prolongement l'une de l'autre. */
const STRAIGHT_COS = Math.cos((172 * Math.PI) / 180);
/** Pas angulaire d'un joint. */
const JOIN_STEP = (15 * Math.PI) / 180;
/** Pas de recherche de la bouche, puis dichotomie. */
const MOUTH_STEP_M = 1;
const MOUTH_BISECT_STEPS = 10;
/** Écart minimal d'un sommet intérieur au bord de la surface, en mètres. */
const INNER_CLEARANCE_M = 0.25;
/** Pas qu'une bouche recouverte peut avancer encore, au plus. */
const MOUTH_PASSES = 6;
/** Longueur sur laquelle se lit la direction d'un bras. */
const HEADING_M = 8;
/**
 * Points d'une bouche éprouvés contre le reste, en part de la section ; les
 * deux bouts débordent un peu des rives, qu'un arrondi longe.
 */
const MOUTH_SAMPLES = [-0.01, 0.25, 0.5, 0.75, 1.01];

const CELL_BIAS = 1 << 14;
const cellKey = (cx, cz) => (cx + CELL_BIAS) * 32768 + (cz + CELL_BIAS);

const frameCache = new WeakMap();
function framesOf(segment) {
  if (segment.frames) return segment.frames;
  let frames = frameCache.get(segment);
  if (!frames) {
    frames = pathFrames(segment.path);
    frameCache.set(segment, frames);
  }
  return frames;
}

/** Ligne `r` telle que `path[r].distance <= s <= path[r + 1].distance`. */
function rowAt(path, s) {
  let lo = 0;
  let hi = path.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path[mid].distance <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Cote de plate-forme d'un tronçon à une distance de son tracé. */
export function platformAt(segment, s) {
  const { path, platform } = segment;
  if (!platform || path.length < 2) return NaN;
  const r = rowAt(path, s);
  const a = path[r];
  const b = path[r + 1];
  const span = b.distance - a.distance;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - a.distance) / span)) : 0;
  return platform[r] + (platform[r + 1] - platform[r]) * t;
}

function vertex(x, z, refs) {
  return { x, z, y: NaN, refs };
}

/** Sommet d'intersection : ses références sont celles des sommets qu'il mêle. */
function blend(parts, x, z) {
  const refs = [];
  for (const [point, weight] of parts) {
    if (!(weight > 0)) continue;
    for (const [segment, distance, w] of point.refs) refs.push([segment, distance, w * weight]);
  }
  return vertex(x, z, refs);
}

function mix(a, b, t) {
  return blend([[a, 1 - t], [b, t]], a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
}

/**
 * La section en travers d'un tronçon à une distance de son tracé : son centre,
 * ses deux rives et le repère qui les porte. Bande de carrefour et ruban
 * s'arrêtent sur celle-ci, et nulle part ailleurs.
 */
export function capAt(segment, s) {
  const { path } = segment;
  const frames = framesOf(segment);
  const r = rowAt(path, s);
  const a = path[r];
  const b = path[r + 1];
  const span = b.distance - a.distance;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - a.distance) / span)) : 0;
  let px;
  let pz;
  if (t < 1e-9 || t > 1 - 1e-9) {
    const row = t < 1e-9 ? r : r + 1;
    px = frames[row * 4 + 2];
    pz = frames[row * 4 + 3];
  } else {
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    px = (b.z - a.z) / length;
    pz = -(b.x - a.x) / length;
  }
  const cx = a.x + (b.x - a.x) * t;
  const cz = a.z + (b.z - a.z) * t;
  const w = segment.halfWidth;
  const refs = [[segment, s, 1]];
  return {
    distance: s,
    centre: { x: cx, z: cz },
    left: vertex(cx + px * w, cz + pz * w, refs),
    right: vertex(cx - px * w, cz - pz * w, refs),
    px,
    pz,
  };
}

/**
 * La section d'un bras au nœud : perpendiculaire à son premier pas. Elle ne
 * dépend pas de la chaîne qui porte le bras — qu'elle traverse le nœud ou s'y
 * arrête —, ni donc de l'ordre où le graphe a recousu les lignes.
 */
function nodeCap(arm) {
  if (arm.cap) return arm.cap;
  const { segment, at, sign } = arm;
  const { path } = segment;
  let next = null;
  for (let r = 0; r < path.length && !next; r++) {
    const k = sign > 0 ? r : path.length - 1 - r;
    if (sign > 0 ? path[k].distance > at + 1e-6 : path[k].distance < at - 1e-6) next = path[k];
  }
  const centre = pointAt(segment, at);
  const length = Math.hypot(next.x - centre.x, next.z - centre.z) || 1;
  // Repère du tracé, et non du bras : la gauche reste celle du ruban.
  const tx = (sign * (next.x - centre.x)) / length;
  const tz = (sign * (next.z - centre.z)) / length;
  const w = segment.halfWidth;
  const refs = [[segment, at, 1]];
  arm.cap = {
    distance: at,
    centre,
    left: vertex(centre.x + tz * w, centre.z - tx * w, refs),
    right: vertex(centre.x - tz * w, centre.z + tx * w, refs),
    px: tz,
    pz: -tx,
  };
  return arm.cap;
}

/** Le point d'un tracé le plus proche, borné à une plage de distances. */
function nearestOn(segment, x, z, lo = -Infinity, hi = Infinity) {
  const { path } = segment;
  const from = Math.max(lo, path[0].distance);
  const to = Math.min(hi, path[path.length - 1].distance);
  let best = null;
  const first = rowAt(path, from);
  for (let r = first; r < path.length - 1 && path[r].distance <= to; r++) {
    const a = path[r];
    const b = path[r + 1];
    const span = b.distance - a.distance;
    if (!(span > 0)) continue;
    const t0 = Math.max(0, (from - a.distance) / span);
    const t1 = Math.min(1, (to - a.distance) / span);
    if (t1 < t0) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const raw = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1);
    const t = Math.min(t1, Math.max(t0, raw));
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    const error = Math.hypot(x - qx, z - qz);
    if (!best || error < best.error) {
      const end = (r === first && raw < t0) || (b.distance >= to - 1e-9 && raw > t1);
      best = { error, distance: a.distance + span * t, row: r, end };
    }
  }
  return best;
}

// --- Les bras ---------------------------------------------------------------

function pointAt(segment, s) {
  const { path } = segment;
  const r = rowAt(path, s);
  const a = path[r];
  const b = path[r + 1];
  const span = b.distance - a.distance;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - a.distance) / span)) : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Les nœuds d'un carrefour : le sien, ou ceux de l'anneau d'un giratoire. */
function originsOf(junction) {
  if (!junction.roundabout) return [{ x: junction.x, z: junction.z }];
  const seen = new Map();
  for (const branch of junction.branches || []) {
    const p = branch.path?.[0];
    if (p) seen.set(`${Math.round(p.x * 100)}:${Math.round(p.z * 100)}`, { x: p.x, z: p.z });
  }
  return [...seen.values()];
}

function armsOf(junction, owners) {
  const candidates = new Set();
  for (const branch of junction.branches || []) {
    for (const edge of branch.edge ? [branch.edge] : branch.edges ?? []) {
      for (const segment of owners.get(edge) ?? []) candidates.add(segment);
    }
  }
  for (const edge of junction.ringEdges ?? []) for (const segment of owners.get(edge) ?? []) candidates.add(segment);

  const level = junction.level ?? LEVEL_GROUND;
  const ring = junction.roundabout;
  const onRing = ring
    ? (p) => {
        const d = Math.hypot(p.x - junction.x, p.z - junction.z);
        return d >= ring.inner && d <= ring.outer;
      }
    : null;

  const nodes = [];
  for (const origin of originsOf(junction)) {
    const arms = [];
    for (const segment of candidates) {
      if (!(segment.path?.length >= 2) || !(segment.halfWidth > 0)) continue;
      const hit = nearestOn(segment, origin.x, origin.z);
      if (!hit || hit.error > segment.halfWidth) continue;
      if ((segment.levels?.[hit.row] ?? LEVEL_GROUND) !== level) continue;
      const { path } = segment;
      const start = path[0].distance;
      const end = path[path.length - 1].distance;
      // Une chaîne refermée sur elle-même passe deux fois par son bout.
      const stations = [hit.distance];
      for (const p of [path[0], path[path.length - 1]]) {
        if (Math.abs(p.distance - hit.distance) > 1e-3 && Math.hypot(p.x - origin.x, p.z - origin.z) <= hit.error + 1e-6) stations.push(p.distance);
      }
      for (const at of stations) {
        for (const sign of [1, -1]) {
          const length = sign > 0 ? end - at : at - start;
          if (length < 1e-3) continue;
          const ahead = pointAt(segment, at + sign * Math.min(HEADING_M, length));
          const here = pointAt(segment, at);
          const dx = ahead.x - here.x;
          const dz = ahead.z - here.z;
          if (!(Math.hypot(dx, dz) > 1e-9)) continue;
          const reach = Math.min(length, JUNCTION_FORK_REACH_M);
          const arm = {
            segment,
            junction,
            at,
            sign,
            level,
            halfWidth: segment.halfWidth,
            profile: segment.profile,
            reach,
            lo: Math.min(at, at + sign * reach),
            hi: Math.max(at, at + sign * reach),
            angle: Math.atan2(dz, dx),
            minimum: 0,
          };
          // L'anneau d'un giratoire appartient tout entier au carrefour : la
          // bouche ne se cherche qu'une fois le bras sorti de la couronne.
          const ringAt = (d) => onRing(pointAt(segment, at + sign * d));
          if (onRing && ringAt(Math.min(2, length))) {
            let low = 0;
            while (low + 0.5 < reach && ringAt(low + 0.5)) low += 0.5;
            let high = Math.min(low + 0.5, reach);
            if (ringAt(high)) low = high;
            else for (let k = 0; k < MOUTH_BISECT_STEPS; k++) {
              const mid = (low + high) / 2;
              if (ringAt(mid)) low = mid;
              else high = mid;
            }
            arm.minimum = low;
          }
          arms.push(arm);
        }
      }
    }
    if (arms.length >= 2) {
      arms.sort((a, b) => a.angle - b.angle);
      nodes.push({ origin, arms });
    }
  }
  return nodes;
}

/**
 * Une rive d'un bras, du nœud à sa portée : `side` +1 pour celle du côté des
 * angles croissants (vers le bras suivant), -1 pour l'autre.
 */
function armEdge(arm, side) {
  const { segment, at, sign } = arm;
  const frames = framesOf(segment);
  const w = segment.halfWidth * side * -sign;
  const points = [];
  const push = (cap, along) => {
    points.push({ x: cap.centre.x + cap.px * w, z: cap.centre.z + cap.pz * w, along });
  };
  push(nodeCap(arm), 0);
  const end = at + sign * arm.reach;
  const { path } = segment;
  const rows = [];
  for (let r = 0; r < path.length; r++) {
    const d = path[r].distance;
    if (sign > 0 ? d > at + 1e-6 && d < end - 1e-6 : d < at - 1e-6 && d > end + 1e-6) rows.push(r);
  }
  if (sign < 0) rows.reverse();
  for (const r of rows) {
    points.push({
      x: path[r].x + frames[r * 4 + 2] * w,
      z: path[r].z + frames[r * 4 + 3] * w,
      along: Math.abs(path[r].distance - at),
    });
  }
  push(capAt(segment, end), arm.reach);
  let length = 0;
  points[0].length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    points[i].length = length;
  }
  return points;
}

/** Point d'une rive à une longueur parcourue, sa distance au nœud le long du bras et sa direction. */
function alongEdge(edge, length) {
  for (let i = 1; i < edge.length; i++) {
    if (edge[i].length < length && i < edge.length - 1) continue;
    const a = edge[i - 1];
    const b = edge[i];
    const span = b.length - a.length;
    const t = span > 0 ? Math.min(1, Math.max(0, (length - a.length) / span)) : 0;
    const norm = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      along: a.along + (b.along - a.along) * t,
      dx: (b.x - a.x) / norm,
      dz: (b.z - a.z) / norm,
    };
  }
  return edge[edge.length - 1];
}

const refOf = (arm, along) => [arm.segment, arm.at + arm.sign * Math.min(along, arm.reach), 1];

/** Les sommets d'une rive strictement entre deux longueurs parcourues. */
const between = (edge, from, to) => edge.filter((p) => p.length > from + 1e-6 && p.length < to - 1e-6);

/**
 * L'arrondi d'un secteur rentrant entre deux bras : la région entre leurs deux
 * rives, depuis leur croisement, et la courbe de bordure qui leur est tangente.
 * La courbe est une parabole posée sur les tangentes des deux rives : sur deux
 * rives droites, elle double l'arc du rayon voulu ; sur une branche qui oblique,
 * elle reste tangente à la rive réelle.
 */
function fillet(a, b) {
  const ea = armEdge(a, 1);
  const eb = armEdge(b, -1);
  let hit = null;
  for (let i = 1; i < ea.length; i++) {
    const p = ea[i - 1];
    const q = ea[i];
    for (let j = 1; j < eb.length; j++) {
      const u = eb[j - 1];
      const v = eb[j];
      const rx = q.x - p.x;
      const rz = q.z - p.z;
      const sx = v.x - u.x;
      const sz = v.z - u.z;
      const denom = rx * sz - rz * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const wx = u.x - p.x;
      const wz = u.z - p.z;
      const t = (wx * sz - wz * sx) / denom;
      const s = (wx * rz - wz * rx) / denom;
      if (t < 0 || t > 1 || s < 0 || s > 1) continue;
      const la = p.length + (q.length - p.length) * t;
      const lb = u.length + (v.length - u.length) * s;
      if (hit && Math.max(la, lb) >= hit.rank) continue;
      const ra = Math.hypot(rx, rz);
      const rb = Math.hypot(sx, sz);
      hit = {
        rank: Math.max(la, lb),
        x: p.x + rx * t,
        z: p.z + rz * t,
        la,
        lb,
        da: { x: rx / ra, z: rz / ra },
        db: { x: sx / rb, z: sz / rb },
      };
    }
  }
  if (!hit) return taper(a, ea, b, eb) ?? taper(b, eb, a, ea) ?? splay(a, ea, b, eb) ?? splay(b, eb, a, ea);
  const cos = hit.da.x * hit.db.x + hit.da.z * hit.db.z;
  if (cos > Math.cos(JUNCTION_FORK_ANGLE) || cos < STRAIGHT_COS) return null;

  const half = Math.acos(Math.min(1, Math.max(-1, cos))) / 2;
  const radius = Math.min(
    JUNCTION_CORNER_MAX_M,
    Math.max(JUNCTION_CORNER_MIN_M, Math.min(a.halfWidth, b.halfWidth) * JUNCTION_CORNER_RATIO)
  );
  const room = Math.min(ea[ea.length - 1].length - hit.la, eb[eb.length - 1].length - hit.lb) - JUNCTION_MOUTH_MARGIN_M;
  const tangent = Math.min(radius / Math.tan(half), room);
  if (!(tangent > 0.05)) return null;

  const pa = alongEdge(ea, hit.la);
  const pb = alongEdge(eb, hit.lb);
  const corner = blend([[vertex(hit.x, hit.z, [refOf(a, pa.along)]), 0.5], [vertex(hit.x, hit.z, [refOf(b, pb.along)]), 0.5]], hit.x, hit.z);
  const ta = alongEdge(ea, hit.la + tangent);
  const tb = alongEdge(eb, hit.lb + tangent);
  const start = vertex(ta.x, ta.z, [refOf(a, ta.along)]);
  const stop = vertex(tb.x, tb.z, [refOf(b, tb.along)]);

  // Le sommet de la parabole : là où se coupent les tangentes des deux rives,
  // en deçà des deux points de tangence.
  const denom = ta.dx * tb.dz - ta.dz * tb.dx;
  let control = null;
  if (Math.abs(denom) > 1e-9) {
    const s = ((tb.x - ta.x) * tb.dz - (tb.z - ta.z) * tb.dx) / denom;
    const u = ((tb.x - ta.x) * ta.dz - (tb.z - ta.z) * ta.dx) / denom;
    // Une rive qui file le long de l'autre n'a plus de coin à arrondir : la
    // corde suffit.
    const open = ta.dx * tb.dx + ta.dz * tb.dz < Math.cos(JUNCTION_FORK_ANGLE);
    if (open && s < 0 && u < 0 && -s < 2 * tangent && -u < 2 * tangent) control = { x: ta.x + ta.dx * s, z: ta.z + ta.dz * s };
  }

  const ring = [corner];
  for (const p of between(ea, hit.la, hit.la + tangent)) ring.push(vertex(p.x, p.z, [refOf(a, p.along)]));
  ring.push(start);
  for (let k = 1; k < JUNCTION_ARC_STEPS && control; k++) {
    const t = k / JUNCTION_ARC_STEPS;
    const p = mix(start, stop, t);
    p.x = (1 - t) ** 2 * start.x + 2 * t * (1 - t) * control.x + t * t * stop.x;
    p.z = (1 - t) ** 2 * start.z + 2 * t * (1 - t) * control.z + t * t * stop.z;
    ring.push(p);
  }
  ring.push(stop);
  for (const p of between(eb, hit.lb, hit.lb + tangent).reverse()) ring.push(vertex(p.x, p.z, [refOf(b, p.along)]));
  // La bouche de chaque bras se pose au-delà de son point de tangence.
  a.minimum = Math.max(a.minimum, ta.along);
  b.minimum = Math.max(b.minimum, tb.along);
  return ring;
}

/**
 * Le biseau entre deux bras dont les rives ne se rejoignent pas en avant du
 * nœud — un tronc large qui se partage en deux voies plus étroites : la rive
 * de `b` se prolonge en ligne droite jusqu'à celle de `a`.
 */
function taper(a, ea, b, eb) {
  const corner = eb[0];
  let dx = eb[1].x - corner.x;
  let dz = eb[1].z - corner.z;
  const norm = Math.hypot(dx, dz) || 1;
  dx /= -norm;
  dz /= -norm;
  const limit = 4 * (a.halfWidth + b.halfWidth);
  for (let i = 1; i < ea.length; i++) {
    const p = ea[i - 1];
    const q = ea[i];
    const rx = q.x - p.x;
    const rz = q.z - p.z;
    const denom = rx * dz - rz * dx;
    if (Math.abs(denom) < 1e-12) continue;
    const wx = corner.x - p.x;
    const wz = corner.z - p.z;
    const t = (wx * dz - wz * dx) / denom;
    const u = (wx * rz - wz * rx) / denom;
    if (t < 0 || t > 1 || u < 0.05 || u > limit) continue;
    return wedge(a, ea, b, corner, p.length + (q.length - p.length) * t);
  }
  return null;
}

/**
 * Le biseau entre deux bras de largeurs inégales dont les rives se longent
 * sans se rejoindre : du coin du plus large à la rive du plus étroit, sur une
 * longueur proportionnée à leur écart.
 */
function splay(a, ea, b, eb) {
  const corner = eb[0];
  const cap = nodeCap(a);
  const offset = (corner.x - cap.centre.x) * cap.px + (corner.z - cap.centre.z) * cap.pz;
  const side = (ea[0].x - cap.centre.x) * cap.px + (ea[0].z - cap.centre.z) * cap.pz;
  const gap = Math.abs(offset) - a.halfWidth;
  if (offset * side <= 0 || gap < 0.05) return null;
  const length = Math.min(gap * JUNCTION_TAPER_RATIO, ea[ea.length - 1].length - JUNCTION_MOUTH_MARGIN_M);
  return length > 0.05 ? wedge(a, ea, b, corner, length) : null;
}

/** L'anneau d'un biseau : la rive de `a` jusqu'à `length`, refermée sur le coin de `b`. */
function wedge(a, ea, b, corner, length) {
  const at = alongEdge(ea, length);
  const ring = [vertex(ea[0].x, ea[0].z, [refOf(a, 0)])];
  for (const point of between(ea, 0, length)) ring.push(vertex(point.x, point.z, [refOf(a, point.along)]));
  ring.push(vertex(at.x, at.z, [refOf(a, at.along)]), vertex(corner.x, corner.z, [refOf(b, 0)]));
  a.minimum = Math.max(a.minimum, at.along);
  return ring;
}

/**
 * Le joint d'un secteur saillant : l'encoche entre deux bouts coupés au nœud,
 * comblée en tournant d'une rive à l'autre.
 */
function joint(a, b) {
  const capA = nodeCap(a);
  const capB = nodeCap(b);
  const from = a.sign > 0 ? capA.right : capA.left;
  const to = b.sign > 0 ? capB.left : capB.right;
  const centre = mix(
    vertex(capA.centre.x, capA.centre.z, [[a.segment, a.at, 1]]),
    vertex(capB.centre.x, capB.centre.z, [[b.segment, b.at, 1]]),
    0.5
  );
  const ra = Math.hypot(from.x - centre.x, from.z - centre.z);
  const rb = Math.hypot(to.x - centre.x, to.z - centre.z);
  const start = Math.atan2(from.z - centre.z, from.x - centre.x);
  let sweep = Math.atan2(to.z - centre.z, to.x - centre.x) - start;
  while (sweep < 0) sweep += Math.PI * 2;
  if (sweep < 0.02 || sweep > Math.PI) return null;
  const steps = Math.max(1, Math.ceil(sweep / JOIN_STEP));
  const ring = [centre, from];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const p = mix(from, to, t);
    const r = ra + (rb - ra) * t;
    p.x = centre.x + Math.cos(start + sweep * t) * r;
    p.z = centre.z + Math.sin(start + sweep * t) * r;
    ring.push(p);
  }
  ring.push(to);
  return ring;
}

function boxOf(points, margin = 0) {
  const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of points) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.z < box.minZ) box.minZ = p.z;
    if (p.z > box.maxZ) box.maxZ = p.z;
  }
  box.minX -= margin;
  box.minZ -= margin;
  box.maxX += margin;
  box.maxZ += margin;
  return box;
}

const boxesMeet = (a, b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
const inBox = (box, x, z) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

/** Vrai si un point est sur la bande d'un bras, sur toute sa portée. */
function onArm(arm, x, z) {
  if (!inBox(arm.box, x, z)) return false;
  const hit = nearestOn(arm.segment, x, z, arm.lo, arm.hi);
  return !!hit && !hit.end && hit.error < arm.halfWidth - 1e-3;
}

/**
 * Vrai si le ruban qui repart de cette section se replie avant sa ligne
 * suivante : au creux d'un virage serré, une rive repasse derrière la bouche.
 */
function folds(arm, d) {
  const { segment, sign } = arm;
  const { path } = segment;
  const frames = framesOf(segment);
  const s = arm.at + sign * d;
  let r = -1;
  for (let k = 0; k < path.length && r < 0; k++) {
    const row = sign > 0 ? k : path.length - 1 - k;
    if (sign > 0 ? path[row].distance > s + 1e-6 : path[row].distance < s - 1e-6) r = row;
  }
  if (r < 0) return false;
  const cap = capAt(segment, s);
  const tx = -cap.pz * sign;
  const tz = cap.px * sign;
  const w = segment.halfWidth;
  for (const side of [1, -1]) {
    const edge = side > 0 ? cap.left : cap.right;
    const x = path[r].x + side * frames[r * 4 + 2] * w;
    const z = path[r].z + side * frames[r * 4 + 3] * w;
    if ((x - edge.x) * tx + (z - edge.z) * tz < 1e-4) return true;
  }
  return false;
}

/** Distance du nœud à la bouche d'un bras : la première section dégagée. */
function mouthOf(arm, rivals, fillets) {
  let mouth = firstClear(arm, rivals, fillets);
  while (mouth > 0 && mouth < arm.reach && folds(arm, mouth)) mouth = Math.min(arm.reach, mouth + MOUTH_STEP_M / 2);
  return mouth;
}

function firstClear(arm, rivals, fillets) {
  const clear = (d) => {
    const cap = capAt(arm.segment, arm.at + arm.sign * d);
    for (const u of MOUTH_SAMPLES) {
      const x = cap.right.x + (cap.left.x - cap.right.x) * u;
      const z = cap.right.z + (cap.left.z - cap.right.z) * u;
      for (const other of rivals) if (onArm(other, x, z)) return false;
      for (const piece of fillets) if (inBox(piece.box, x, z) && windingAt([piece.ring], x, z) !== 0) return false;
    }
    return true;
  };
  let low = arm.minimum;
  if (clear(low)) return low > 0 ? Math.min(arm.reach, low + JUNCTION_MOUTH_MARGIN_M) : 0;
  let high = -1;
  for (let d = low + MOUTH_STEP_M; d < arm.reach + MOUTH_STEP_M; d += MOUTH_STEP_M) {
    const at = Math.min(d, arm.reach);
    if (clear(at)) {
      high = at;
      break;
    }
    low = at;
  }
  if (high < 0) return arm.reach;
  for (let i = 0; i < MOUTH_BISECT_STEPS; i++) {
    const mid = (low + high) / 2;
    if (clear(mid)) high = mid;
    else low = mid;
  }
  return Math.min(arm.reach, high + JUNCTION_MOUTH_MARGIN_M);
}

/** Les plages d'un même tronçon qui se touchent, ou presque, fondues en une. */
function mergeSpans(spans) {
  const bySegment = new Map();
  for (const span of spans) {
    if (!bySegment.has(span.segment)) bySegment.set(span.segment, []);
    bySegment.get(span.segment).push(span);
  }
  const out = [];
  for (const list of bySegment.values()) {
    list.sort((a, b) => a.from - b.from);
    let last = null;
    for (const span of list) {
      if (last && span.from <= last.to + JUNCTION_GAP_MIN_M) {
        last.to = Math.max(last.to, span.to);
        last.arms.push(...span.arms);
      } else {
        last = { ...span, arms: [...span.arms] };
        out.push(last);
      }
    }
  }
  return out;
}

/** La bande d'un tronçon entre deux distances, bornée par ses deux sections. */
function strip(segment, head, tail) {
  const { path } = segment;
  const frames = framesOf(segment);
  const w = segment.halfWidth;
  const left = [head.left];
  const right = [head.right];
  // Au creux d'un virage serré, la rive intérieure d'une ligne voisine peut
  // passer derrière la section de bout : elle n'appartient pas à la bande.
  const within = (x, z, d) =>
    (d - head.distance > 2 * w || (x - head.centre.x) * -head.pz + (z - head.centre.z) * head.px >= 0) &&
    (tail.distance - d > 2 * w || (x - tail.centre.x) * -tail.pz + (z - tail.centre.z) * tail.px <= 0);
  for (let r = 0; r < path.length; r++) {
    const d = path[r].distance;
    if (d <= head.distance + 1e-6 || d >= tail.distance - 1e-6) continue;
    const refs = [[segment, d, 1]];
    const lx = path[r].x + frames[r * 4 + 2] * w;
    const lz = path[r].z + frames[r * 4 + 3] * w;
    const rx = path[r].x - frames[r * 4 + 2] * w;
    const rz = path[r].z - frames[r * 4 + 3] * w;
    if (within(lx, lz, d)) left.push(vertex(lx, lz, refs));
    if (within(rx, rz, d)) right.push(vertex(rx, rz, refs));
  }
  left.push(tail.left);
  right.push(tail.right);
  return [...right, ...left.reverse()];
}

// --- Les surfaces ------------------------------------------------------------

/**
 * Le maillage d'une surface. Ses sommets intérieurs sont l'axe des chaussées,
 * ligne par ligne, et leurs nœuds, à leur propre cote : la surface suit les
 * routes qui la traversent au lieu de se tendre d'un bord à l'autre.
 */
function meshOf(outline, holes, spans) {
  const shape = { outline, holes };
  const inner = [];
  const keep = (x, z, refs) => {
    if (inner.some((p) => Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05)) return;
    if (!areaCovers(shape, x, z) || nearestBoundary(shape, x, z).distance < INNER_CLEARANCE_M) return;
    inner.push(vertex(x, z, refs));
  };
  for (const span of spans) {
    for (const arm of span.arms) keep(nodeCap(arm).centre.x, nodeCap(arm).centre.z, [[arm.segment, arm.at, 1]]);
    for (const point of span.segment.path) {
      if (point.distance > span.from && point.distance < span.to) keep(point.x, point.z, [[span.segment, point.distance, 1]]);
    }
  }
  const { triangles, valid } = triangulateRings(outline, holes, inner);
  const vertices = [];
  const seen = new Map();
  for (const p of [...outline, ...holes.flat(), ...triangles.flat()]) {
    if (!seen.has(p)) {
      seen.set(p, vertices.length);
      vertices.push(p);
    }
  }
  return { vertices, triangles: triangles.map((tri) => tri.map((p) => seen.get(p))), valid };
}

/** Rangs d'un anneau, objet par objet. */
function ringIndex(ring) {
  const index = new Map();
  ring.forEach((p, i) => index.set(p, i));
  return index;
}

const near = (p, q) => Math.abs(p.x - q.x) < 1e-5 && Math.abs(p.z - q.z) < 1e-5;

/**
 * La bouche d'une coupure, si sa section est bien sur le contour : d'une rive
 * à l'autre, en une arête ou en plusieurs alignées (un sommet voisin peut s'y
 * être posé).
 */
function findMouth(rings, cap) {
  const dx = cap.left.x - cap.right.x;
  const dz = cap.left.z - cap.right.z;
  const width = Math.hypot(dx, dz) || 1;
  const onCap = (p) => Math.abs((p.x - cap.right.x) * dz - (p.z - cap.right.z) * dx) / width < 1e-4;
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const first = ring[i];
      const leftFirst = near(first, cap.left);
      if (!leftFirst && !near(first, cap.right)) continue;
      const target = leftFirst ? cap.right : cap.left;
      for (let step = 1; step < n; step++) {
        const p = ring[(i + step) % n];
        if (near(p, target)) {
          const last = ring[(i + step) % n];
          return { ring: k, index: i, end: (i + step) % n, left: leftFirst ? first : last, right: leftFirst ? last : first };
        }
        if (!onCap(p)) break;
      }
    }
  }
  return null;
}

/** Les morceaux de rive entre deux bouches : coins de rue et bord d'îlot. */
function edgesOf(rings, mouths) {
  const edges = [];
  rings.forEach((ring, k) => {
    const cuts = mouths
      .map((mouth, rank) => ({ rank, index: mouth.at.ring === k ? mouth.at.index : -1, end: mouth.at.end }))
      .filter((cut) => cut.index >= 0)
      .sort((a, b) => a.index - b.index);
    const pieces = [];
    if (cuts.length === 0) pieces.push({ from: -1, to: -1, points: [...ring, ring[0]] });
    for (let c = 0; c < cuts.length; c++) {
      const next = cuts[(c + 1) % cuts.length];
      const points = [];
      let i = cuts[c].end;
      for (let guard = 0; guard <= ring.length; guard++) {
        points.push(ring[i]);
        if (i === next.index) break;
        i = (i + 1) % ring.length;
      }
      if (points.length >= 2) pieces.push({ from: cuts[c].rank, to: next.rank, points });
    }
    for (const piece of pieces) {
      const m = Math.max(0, Math.floor((piece.points.length - 2) / 2));
      const a = piece.points[m];
      const b = piece.points[m + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      // L'intérieur est à gauche de la marche : l'extérieur, à droite.
      edges.push({ ...piece, outward: { x: (b.z - a.z) / length, z: -(b.x - a.x) / length } });
    }
  });
  return edges;
}

/**
 * Les surfaces de carrefour d'un réseau, et leur index.
 *
 * Construites en plan, sur les tracés des tronçons ; les cotes viennent après
 * (`updateDecks`). Chaque tronçon reçoit `junction` (rang de surface par
 * ligne, `-1` hors carrefour) et `junctionCuts` (les plages que les surfaces
 * lui prennent, avec leurs sections de bout).
 */
export class JunctionAreas {
  /**
   * @param {Array<Object>} junctions Carrefours publiés par `mergeRoadLines`.
   * @param {Array<Object>} segments Tronçons : `path` (avec `distance`),
   *        `halfWidth`, `profile`, `graphEdges`, `levels`.
   * @param {Object} [options]
   */
  constructor(junctions = [], segments = [], { cell = JUNCTION_CELL_M } = {}) {
    this.cell = cell;
    this.areas = [];
    this.feeders = [];
    this.buckets = new Map();
    for (const segment of segments) {
      segment.junction = new Int32Array(segment.path?.length ?? 0).fill(-1);
      segment.junctionCuts = [];
    }

    const owners = new Map();
    for (const segment of segments) {
      for (const edge of segment.graphEdges ?? []) {
        if (!owners.has(edge)) owners.set(edge, []);
        owners.get(edge).push(segment);
      }
    }

    const nodes = [];
    for (const junction of junctions) nodes.push(...armsOf(junction, owners));
    const arms = nodes.flatMap((node) => node.arms);
    // Un bras s'arrête au nœud suivant de sa chaussée : au-delà, la route est
    // à l'autre carrefour, quelle que soit la façon dont le graphe a recousu
    // les lignes.
    const bySegment = new Map();
    for (const arm of arms) {
      if (!bySegment.has(arm.segment)) bySegment.set(arm.segment, []);
      bySegment.get(arm.segment).push(arm);
    }
    for (const arm of arms) {
      for (const other of bySegment.get(arm.segment)) {
        const gap = (other.at - arm.at) * arm.sign;
        if (gap > 1e-6 && gap < arm.reach) arm.reach = gap;
      }
      arm.lo = Math.min(arm.at, arm.at + arm.sign * arm.reach);
      arm.hi = Math.max(arm.at, arm.at + arm.sign * arm.reach);
    }
    for (const arm of arms) {
      const points = [];
      for (let d = 0; d <= arm.reach; d += Math.max(1, arm.reach / 16)) points.push(pointAt(arm.segment, arm.at + arm.sign * d));
      points.push(pointAt(arm.segment, arm.at + arm.sign * arm.reach));
      arm.box = boxOf(points, arm.halfWidth);
    }

    const fillets = [];
    const joints = [];
    for (const { arms: around } of nodes) {
      for (let i = 0; i < around.length; i++) {
        const a = around[i];
        const b = around[(i + 1) % around.length];
        if (a === b) continue;
        let sector = b.angle - a.angle;
        while (sector <= 0) sector += Math.PI * 2;
        const add = (ring, list) => ring && list.push({ ring, box: boxOf(ring), level: a.level, junction: a.junction });
        if (sector < Math.PI) add(fillet(a, b), fillets);
        else {
          add(joint(a, b), joints);
          // Deux bras presque alignés de largeurs inégales : le joint ne comble
          // pas la marche entre leurs rives.
          if (sector < Math.PI + JUNCTION_FORK_ANGLE) {
            const ea = armEdge(a, 1);
            const eb = armEdge(b, -1);
            add(splay(a, ea, b, eb) ?? splay(b, eb, a, ea), fillets);
          }
        }
      }
    }

    // La bouche de chaque bras, contre tout ce qui n'est pas son propre tronçon.
    const grid = new Map();
    const eachCell = (box, visit) => {
      for (let cx = Math.floor(box.minX / cell); cx <= Math.floor(box.maxX / cell); cx++) {
        for (let cz = Math.floor(box.minZ / cell); cz <= Math.floor(box.maxZ / cell); cz++) visit(cellKey(cx, cz));
      }
    };
    const file = (item, box) => eachCell(box, (key) => {
      const bucket = grid.get(key);
      if (bucket) bucket.push(item);
      else grid.set(key, [item]);
    });
    /** Les voisins d'une boîte, cellule par cellule : un même voisin peut revenir. */
    const eachNear = (box, visit) => eachCell(box, (key) => {
      const bucket = grid.get(key);
      if (bucket) for (const item of bucket) visit(item);
    });
    const around = (box) => {
      const found = new Set();
      eachNear(box, (item) => found.add(item));
      return found;
    };
    for (const arm of arms) file(arm, arm.box);
    for (const piece of fillets) file(piece, piece.box);
    for (const arm of arms) {
      const rivals = [];
      const corners = [];
      // Les arrondis d'un voisin ne repoussent pas une bouche : sa surface la
      // recouvre-t-elle, elle avance après coup (voir plus bas).
      for (const item of around(arm.box)) {
        if (item.level !== arm.level) continue;
        if (item.ring) {
          if (item.junction === arm.junction) corners.push(item);
        } else if (item !== arm && (item.segment !== arm.segment || Math.min(item.hi, arm.hi) - Math.max(item.lo, arm.lo) < 1e-3)) {
          // Le bras d'en face sur la même chaussée est la même route : il ne
          // borne pas la bouche.
          rivals.push(item);
        }
      }
      arm.mouth = mouthOf(arm, rivals, corners);
    }

    // Les plages prises à chaque tronçon : celles d'un même tronçon qui se
    // touchent, ou presque, n'en font qu'une, d'un carrefour à l'autre s'il le
    // faut.
    let spans = arms.map((arm) => {
      const end = arm.at + arm.sign * arm.mouth;
      return { segment: arm.segment, from: Math.min(arm.at, end), to: Math.max(arm.at, end), arms: [arm] };
    });
    const order = new Map(junctions.map((junction, i) => [junction, i]));
    // Une bouche dont la section ne borde pas la surface (un morceau voisin la
    // recouvre) avance d'un pas, et la surface est refaite.
    let surfaces = [];
    const unions = new Map();
    const tags = new Map();
    for (let pass = 0; pass <= MOUTH_PASSES; pass++) {
      spans = mergeSpans(spans);
      surfaces = this._surfaces(spans, fillets, joints, order, { grid, file, eachNear, unions, tags });
      const buried = [];
      for (const { outline, holes, spans: mine, outer } of surfaces) {
        // Une union reprise telle quelle a déjà toutes ses bouches au contour.
        if (outer.open) continue;
        const before = buried.length;
        for (const span of mine) {
          if (span.head && !findMouth([outline, ...holes], span.head)) buried.push([span, -1]);
          if (span.tail && !findMouth([outline, ...holes], span.tail)) buried.push([span, 1]);
        }
        outer.open = buried.length === before;
      }
      if (buried.length === 0 || pass === MOUTH_PASSES) break;
      for (const [span, side] of buried) {
        const { path } = span.segment;
        if (side < 0) span.from = Math.max(path[0].distance, span.from - MOUTH_STEP_M);
        else span.to = Math.min(path[path.length - 1].distance, span.to + MOUTH_STEP_M);
      }
    }
    for (const { outline, holes, spans: mine, members } of surfaces) this._addArea(outline, holes, mine, members);
  }

  /** Les surfaces d'un jeu de plages : bandes, arrondis et joints réunis par groupe. */
  _surfaces(spans, fillets, joints, order, { grid, file, eachNear, unions, tags }) {
    // Une bande par plage, coupée à chaque nœud qu'elle traverse : au nœud,
    // chaque morceau s'arrête sur la section de son bras (`nodeCap`).
    const strips = [];
    for (const span of spans) {
      const { segment, arms } = span;
      if (!(span.to - span.from > 1e-6)) continue;
      const capOf = (d, sign) => {
        const arm = arms.find((a) => a.sign === sign && Math.abs(a.at - d) < 1e-6);
        return arm ? nodeCap(arm) : capAt(segment, d);
      };
      span.head = span.from > segment.path[0].distance + 1e-6 ? capOf(span.from, 1) : null;
      span.tail = span.to < segment.path[segment.path.length - 1].distance - 1e-6 ? capOf(span.to, -1) : null;
      const stops = [...new Set(arms.map((a) => a.at).filter((d) => d > span.from + 1e-6 && d < span.to - 1e-6))].sort((a, b) => a - b);
      const ends = [span.from, ...stops, span.to];
      for (let k = 1; k < ends.length; k++) {
        const head = k === 1 && span.head ? span.head : capOf(ends[k - 1], 1);
        const tail = k === ends.length - 1 && span.tail ? span.tail : capOf(ends[k], -1);
        const ring = strip(segment, head, tail);
        strips.push({
          segment,
          span,
          from: ends[k - 1],
          to: ends[k],
          ring,
          box: boxOf(ring),
          level: arms[0].level,
          junctions: new Set(arms.map((arm) => arm.junction)),
        });
      }
    }

    // Les morceaux qui se touchent, au même niveau, font une seule surface.
    const pieces = [...strips, ...fillets, ...joints];
    const parent = pieces.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const join = (i, j) => {
      const a = root(i);
      const b = root(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    };
    grid.clear();
    pieces.forEach((piece, i) => {
      piece.rank = i;
      file(piece, piece.box);
    });
    for (const piece of pieces) {
      eachNear(piece.box, (other) => {
        if (other.rank > piece.rank && other.level === piece.level && boxesMeet(piece.box, other.box)) join(piece.rank, other.rank);
      });
    }
    const byJunction = new Map();
    pieces.forEach((piece, i) => {
      for (const junction of piece.junctions ?? [piece.junction]) {
        if (byJunction.has(junction)) join(i, byJunction.get(junction));
        else byJunction.set(junction, i);
      }
    });
    const clusters = new Map();
    pieces.forEach((piece, i) => {
      const r = root(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(piece);
    });

    const tag = (item) => {
      if (!tags.has(item)) tags.set(item, tags.size);
      return tags.get(item);
    };
    const surfaces = [];
    for (const group of [...clusters.values()].sort((a, b) => a[0].rank - b[0].rank)) {
      const owned = group.filter((piece) => piece.segment);
      const lent = [...new Set(owned.map((piece) => piece.span))];
      const covering = (outline) => lent.filter((span) => {
        const p = pointAt(span.segment, (span.from + span.to) / 2);
        return windingAt([outline], p.x, p.z) !== 0;
      });
      // Un groupe dont aucune bouche n'a bougé depuis la passe précédente rend
      // la même union : elle n'est pas refaite.
      const key = group.map((piece) => (piece.segment ? `${tag(piece.segment)}:${piece.from}:${piece.to}` : tag(piece))).join('|');
      let outers = unions.get(key);
      if (!outers) {
        // Une union qui n'aboutit pas retombe sur les seules bandes : mieux
        // vaut un coin franc qu'un carrefour sans surface.
        outers = unionRings(group.map((piece) => piece.ring), blend, { minHole: JUNCTION_ISLAND_MIN_M2 });
        if (owned.some((piece) => !outers.some(({ outline }) => covering(outline).includes(piece.span)))) {
          outers = unionRings(owned.map((piece) => piece.ring), blend, { minHole: JUNCTION_ISLAND_MIN_M2 });
        }
        unions.set(key, outers);
      }
      const members = [...new Set(group.flatMap((piece) => [...(piece.junctions ?? [piece.junction])]))]
        .sort((a, b) => order.get(a) - order.get(b));
      for (const outer of outers) {
        const mine = covering(outer.outline);
        if (mine.length > 0) surfaces.push({ outline: outer.outline, holes: outer.holes, spans: mine, members, outer });
      }
    }
    return surfaces;
  }

  _addArea(outline, holes, spans, members) {
    const index = this.areas.length;
    const rings = [outline, ...holes];
    const nodes = members.filter((junction) => spans.some((span) => span.arms.some((arm) => arm.junction === junction)));
    const first = nodes[0] ?? members[0];
    const ring = nodes.find((junction) => junction.roundabout);
    const dominant = nodes.reduce((a, b) => ((b.halfWidth ?? 0) > (a.halfWidth ?? 0) ? b : a), first);

    const mouths = [];
    for (const span of spans) {
      for (const [cap, outward] of [[span.head, -1], [span.tail, 1]]) {
        if (!cap) continue;
        const at = findMouth(rings, cap);
        if (!at) continue;
        // Le sens de la marche, perpendiculaire à la section ; une bouche
        // regarde hors du carrefour.
        const tx = -cap.pz * outward;
        const tz = cap.px * outward;
        mouths.push({
          segment: span.segment,
          distance: cap.distance,
          centre: cap.centre,
          left: at.left,
          right: at.right,
          direction: { x: tx, z: tz },
          halfWidth: span.segment.halfWidth,
          profile: span.segment.profile,
          at,
        });
      }
    }

    let radius = 0;
    for (const p of outline) radius = Math.max(radius, Math.hypot(p.x - first.x, p.z - first.z));

    const area = {
      index,
      x: first.x,
      z: first.z,
      level: spans[0].arms[0].level,
      profile: ring ? ring.roundabout.profile : dominant.profile,
      halfWidth: dominant.halfWidth,
      degree: mouths.length,
      roundabout: !!ring,
      fork: nodes.length === 1 && isForkJunction(nodes[0]),
      nodes,
      outline,
      holes,
      rings,
      mouths: mouths.map(({ at, ...mouth }) => mouth),
      edges: edgesOf(rings, mouths),
      strips: spans.map(({ segment, from, to }) => ({ segment, from, to })),
      radius,
      box: boxOf(outline),
      deck: NaN,
      terrainCovered: false,
    };
    // Le maillage n'est fait qu'à la première lecture : qui ne demande que
    // l'emprise (`covers`) ne le paie pas.
    let mesh = null;
    for (const name of ['vertices', 'triangles', 'valid']) {
      Object.defineProperty(area, name, {
        enumerable: true,
        get: () => (mesh ??= meshOf(outline, holes, spans))[name],
      });
    }
    this.areas.push(area);
    this.feeders.push(new Set(spans.map((span) => span.segment)));

    for (const span of spans) {
      const { segment } = span;
      segment.junctionCuts.push({ from: span.from, to: span.to, index, head: span.head, tail: span.tail });
      segment.junctionCuts.sort((a, b) => a.from - b.from);
      for (let r = 0; r < segment.path.length; r++) {
        const d = segment.path[r].distance;
        if (d >= span.from - 1e-6 && d <= span.to + 1e-6) segment.junction[r] = index;
      }
    }

    const reach = JUNCTION_REACH_M;
    for (let cx = Math.floor((area.box.minX - reach) / this.cell); cx <= Math.floor((area.box.maxX + reach) / this.cell); cx++) {
      for (let cz = Math.floor((area.box.minZ - reach) / this.cell); cz <= Math.floor((area.box.maxZ + reach) / this.cell); cz++) {
        const key = cellKey(cx, cz);
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(index);
        this._cells = null;
      }
    }
  }

  get length() {
    return this.areas.length;
  }

  /** Vrai si ce tronçon prête une bande à cette surface. */
  feeds(index, segment) {
    return index >= 0 && index < this.feeders.length && this.feeders[index].has(segment);
  }

  /**
   * Relit les cotes de chaque sommet sur les plates-formes, une fois cousues et
   * relevées par les ouvrages.
   */
  updateDecks() {
    for (const area of this.areas) {
      for (const p of area.vertices) {
        let sum = 0;
        let weight = 0;
        for (const [segment, distance, w] of p.refs) {
          const deck = platformAt(segment, distance);
          if (!Number.isFinite(deck)) continue;
          sum += deck * w;
          weight += w;
        }
        p.y = weight > 0 ? Math.fround(sum / weight) : NaN;
      }
      const decks = (area.mouths.length ? area.mouths.map((m) => platformAt(m.segment, m.distance)) : area.vertices.map((p) => p.y))
        .filter(Number.isFinite);
      area.deck = decks.length ? decks.reduce((sum, y) => sum + y, 0) / decks.length : NaN;
      area.terrainCovered = area.strips.every(({ segment, from, to }) => {
        const r = rowAt(segment.path, from);
        if (!segment.works?.[r]) return false;
        for (let k = r + 1; k < segment.path.length && segment.path[k].distance <= to; k++) if (!segment.works[k]) return false;
        return true;
      });
    }
  }

  /**
   * Rang de la surface qui couvre ce point **à ce niveau**, ou `-1` : une
   * chaussée qui passe au-dessus d'un carrefour n'y entre pas.
   */
  indexAt(x, z, level = LEVEL_GROUND) {
    const bucket = this.buckets.get(cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!bucket) return -1;
    for (const index of bucket) {
      const area = this.areas[index];
      if (area.level !== level || !inBox(area.box, x, z)) continue;
      if (areaCovers(area, x, z)) return index;
    }
    return -1;
  }

  covers(x, z, level = LEVEL_GROUND) {
    return this.indexAt(x, z, level) >= 0;
  }

  /** Cote de la surface sous ce point au sol, ou `null`. */
  deckAt(x, z, level = LEVEL_GROUND) {
    const index = this.indexAt(x, z, level);
    if (index < 0) return null;
    const deck = junctionDeckAt(this.areas[index], x, z);
    return Number.isFinite(deck) ? deck : null;
  }

  /**
   * Surface la plus proche d'un point, et la distance à son bord — zéro
   * dessus. Avec `spread`, la cote retenue est la plus basse dans ce rayon
   * (`lowestDeckAround`) : le terrain passe sous les plis de la surface.
   */
  deckNear(x, z, margin, level = LEVEL_GROUND, spread = 0) {
    const reach = Math.min(margin, JUNCTION_REACH_M);
    const cells = (this._cells ??= denseCells(this.buckets));
    const bucket = cells.at(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (!bucket) return null;
    let best = null;
    for (let i = 0; i < bucket.length; i++) {
      const sample = deckSample(this.areas[bucket[i]], x, z, reach, level, spread);
      if (sample && (!best || sample.distance < best.distance)) best = sample;
    }
    return best;
  }

  /**
   * `deckNear` pour qui ne veut que la surface **sous** le point, contour
   * compris : la même réponse quand la distance est nulle, `null` sinon, sans
   * mesurer l'écart aux surfaces voisines.
   */
  deckUnder(x, z, level = LEVEL_GROUND, spread = 0) {
    const cells = (this._cells ??= denseCells(this.buckets));
    const bucket = cells.at(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (!bucket) return null;
    for (let i = 0; i < bucket.length; i++) {
      const sample = deckSample(this.areas[bucket[i]], x, z, ON_OUTLINE_M, level, spread);
      if (sample?.distance === 0) return sample;
    }
    return null;
  }

  /**
   * Toutes les surfaces à portée. `level === null` : celles du terrain, toutes
   * celles qui ne sont pas entièrement portées par un ouvrage.
   */
  deckSamplesNear(x, z, margin, level = LEVEL_GROUND, spread = 0) {
    const reach = Math.min(margin, JUNCTION_REACH_M);
    const bucket = this.buckets.get(cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!bucket) return [];
    const samples = [];
    for (const index of bucket) {
      const sample = deckSample(this.areas[index], x, z, reach, level, spread);
      if (sample) samples.push(sample);
    }
    return samples;
  }
}

/** Marge de boîte qui garde un point posé sur le contour même, aux arrondis près. */
const ON_OUTLINE_M = 1e-6;

/** Cote d'une surface vue d'un point à moins de `reach` de son bord, ou `null`. */
function deckSample(area, x, z, reach, level, spread) {
  if (!Number.isFinite(area.deck) || (level === null ? area.terrainCovered : area.level !== level)) return null;
  const box = area.box;
  if (x < box.minX - reach || x > box.maxX + reach || z < box.minZ - reach || z > box.maxZ + reach) return null;
  const nearest = areaDistance(area, x, z);
  if (nearest.distance > reach) return null;
  let deck = nearest.distance > 0 ? nearest.deck : junctionDeckAt(area, x, z);
  if (spread > nearest.distance) deck = Math.min(deck, lowestDeckAround(area, x, z, spread));
  if (!Number.isFinite(deck)) return null;
  return { deck, distance: nearest.distance };
}

/** Vrai si un point est sur la chaussée d'une surface : dans son contour, hors de ses îlots. */
export function areaCovers(area, x, z) {
  if (area.box && !inBox(area.box, x, z)) return false;
  return windingAt(ringsOf(area), x, z) !== 0;
}

const ringsOf = (area) => area.rings ?? [area.outline, ...area.holes];

/**
 * Distance d'un point au bord d'une surface, le point du bord qui lui fait
 * face et la cote de la surface en ce point. Zéro dedans.
 */
export function areaDistance(area, x, z) {
  if (areaCovers(area, x, z)) return { distance: 0, x, z, deck: NaN };
  return nearestBoundary(area, x, z);
}

function nearestBoundary(area, x, z) {
  let best = Infinity;
  let px = x;
  let pz = z;
  let deck = NaN;
  for (const ring of ringsOf(area)) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i];
      const b = ring[i + 1 === n ? 0 : i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const d = (x - qx) ** 2 + (z - qz) ** 2;
      if (d >= best) continue;
      best = d;
      px = qx;
      pz = qz;
      deck = a.y + (b.y - a.y) * t;
    }
  }
  return { distance: Math.sqrt(best), x: px, z: pz, deck };
}

/**
 * Cote de la surface en un point qu'elle couvre, interpolée sur les triangles
 * mêmes du rendu ; au bord le plus proche si le point tombe juste dehors.
 */
export function junctionDeckAt(area, x, z) {
  const { vertices, triangles } = area;
  const slack = 1e-5;
  for (let k = 0; k < triangles.length; k++) {
    const triangle = triangles[k];
    const a = vertices[triangle[0]];
    const b = vertices[triangle[1]];
    const c = vertices[triangle[2]];
    if (x < Math.min(a.x, b.x, c.x) - slack || x > Math.max(a.x, b.x, c.x) + slack ||
      z < Math.min(a.z, b.z, c.z) - slack || z > Math.max(a.z, b.z, c.z) + slack) continue;
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vz = c.z - a.z;
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-12) continue;
    const px = x - a.x;
    const pz = z - a.z;
    const wb = (px * vz - pz * vx) / det;
    const wc = (ux * pz - uz * px) / det;
    if (wb >= -1e-8 && wc >= -1e-8 && wb + wc <= 1 + 1e-8) return a.y * (1 - wb - wc) + b.y * wb + c.y * wc;
  }
  return nearestBoundary(area, x, z).deck;
}

/** Cote la plus basse d'une arête `[a, b]` là où elle coupe le cercle, ou `Infinity`. */
function lowestCrossing(a, b, x, z, r2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const fx = a.x - x;
  const fz = a.z - z;
  const qa = dx * dx + dz * dz;
  if (qa < 1e-12) return Infinity;
  const qb = 2 * (fx * dx + fz * dz);
  const disc = qb * qb - 4 * qa * (fx * fx + fz * fz - r2);
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  let lowest = Infinity;
  const near = (-qb - root) / (2 * qa);
  if (near >= 0 && near <= 1) lowest = a.y + (b.y - a.y) * near;
  const far = (-qb + root) / (2 * qa);
  if (far >= 0 && far <= 1) {
    const h = a.y + (b.y - a.y) * far;
    if (h < lowest) lowest = h;
  }
  return lowest;
}

/**
 * Cote la plus basse de la surface à moins de `radius` d'un point. Sur un
 * triangle plan, le minimum dans le disque tombe sur un sommet, là où une
 * arête coupe le cercle, ou au point du cercle qui suit la pente vers le bas.
 *
 * @returns {number} `Infinity` si la surface ne tombe pas dans le disque.
 */
export function lowestDeckAround(area, x, z, radius) {
  const { vertices, triangles } = area;
  const r2 = radius * radius;
  let lowest = Infinity;
  for (let k = 0; k < triangles.length; k++) {
    const triangle = triangles[k];
    const a = vertices[triangle[0]];
    const b = vertices[triangle[1]];
    const c = vertices[triangle[2]];
    if (Math.min(a.x, b.x, c.x) > x + radius || Math.max(a.x, b.x, c.x) < x - radius ||
      Math.min(a.z, b.z, c.z) > z + radius || Math.max(a.z, b.z, c.z) < z - radius) continue;
    if (!Number.isFinite(a.y) || !Number.isFinite(b.y) || !Number.isFinite(c.y)) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 <= r2 && a.y < lowest) lowest = a.y;
    if ((b.x - x) ** 2 + (b.z - z) ** 2 <= r2 && b.y < lowest) lowest = b.y;
    if ((c.x - x) ** 2 + (c.z - z) ** 2 <= r2 && c.y < lowest) lowest = c.y;
    lowest = Math.min(lowest, lowestCrossing(a, b, x, z, r2), lowestCrossing(b, c, x, z, r2), lowestCrossing(c, a, x, z, r2));
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vz = c.z - a.z;
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-9) continue;
    // Le centre du disque, puis le point du cercle qui suit la pente vers le bas.
    let wb = ((x - a.x) * vz - (z - a.z) * vx) / det;
    let wc = (ux * (z - a.z) - uz * (x - a.x)) / det;
    if (wb >= 0 && wc >= 0 && wb + wc <= 1) {
      const h = a.y + (b.y - a.y) * wb + (c.y - a.y) * wc;
      if (h < lowest) lowest = h;
    }
    const gx = ((b.y - a.y) * vz - (c.y - a.y) * uz) / det;
    const gz = ((c.y - a.y) * ux - (b.y - a.y) * vx) / det;
    const slope = Math.hypot(gx, gz);
    if (slope < 1e-12) continue;
    const px = x - (gx / slope) * radius;
    const pz = z - (gz / slope) * radius;
    wb = ((px - a.x) * vz - (pz - a.z) * vx) / det;
    wc = (ux * (pz - a.z) - uz * (px - a.x)) / det;
    if (wb >= 0 && wc >= 0 && wb + wc <= 1) {
      const h = a.y + (b.y - a.y) * wb + (c.y - a.y) * wc;
      if (h < lowest) lowest = h;
    }
  }
  return lowest;
}

// --- Ce que le ruban et la bordure en lisent ---------------------------------

/**
 * Le sommet où un tronçon entre dans une surface, entre une ligne gardée
 * (`keep`, dehors) et la ligne voisine (`drop`, dedans) : la section de la
 * bouche, que ruban, bordure et traversée partagent.
 *
 * @returns {{point:{x:number,z:number,distance:number,section:Object}, deck:number}|null}
 */
export function junctionBoundaryAt(segment, areas, keep, drop) {
  const rows = segment?.path?.length ?? 0;
  if (keep < 0 || drop < 0 || keep >= rows || drop >= rows) return null;
  const low = Math.min(segment.path[keep].distance, segment.path[drop].distance) - 1e-6;
  const high = Math.max(segment.path[keep].distance, segment.path[drop].distance) + 1e-6;
  for (const cut of segment.junctionCuts ?? []) {
    const cap = drop > keep ? cut.head : cut.tail;
    if (!cap || cap.distance < low || cap.distance > high) continue;
    return boundaryOf(segment, cap);
  }
  return null;
}

function boundaryOf(segment, cap) {
  return {
    point: { ...cap.centre, distance: cap.distance, section: { left: cap.left, right: cap.right } },
    deck: platformAt(segment, cap.distance),
  };
}

/**
 * Les morceaux de ruban qu'un tronçon doit dessiner, surfaces retirées. Chaque
 * bout coupé porte la section de sa bouche ; `head` et `tail` donnent le rang
 * de la surface qui le borne, `-1` s'il est libre.
 *
 * @param {Object} segment
 * @param {JunctionAreas|null} areas
 * @param {Array<{from:number,to:number}>} runs Plages de lignes dessinables.
 */
export function junctionRibbonRuns(segment, areas, runs) {
  const { path, platform } = segment;
  const out = [];
  if (!path || !platform) return out;
  const cuts = segment.junctionCuts ?? [];
  for (const run of runs || []) {
    let spans = [{ from: path[run.from].distance, to: path[run.to].distance, head: null, tail: null }];
    for (const cut of cuts) {
      spans = spans.flatMap((span) => {
        if (cut.to <= span.from + 1e-6 || cut.from >= span.to - 1e-6) return [span];
        const pieces = [];
        if (cut.from > span.from + 1e-6) pieces.push({ ...span, to: cut.from, tail: cut.head ? { cap: cut.head, index: cut.index } : null });
        if (cut.to < span.to - 1e-6) pieces.push({ ...span, from: cut.to, head: cut.tail ? { cap: cut.tail, index: cut.index } : null });
        return pieces;
      });
    }
    for (const span of spans) {
      const piece = slice(path, platform, span.from, span.to);
      if (!piece) continue;
      for (const [end, row] of [[span.head, 0], [span.tail, piece.path.length - 1]]) {
        if (!end) continue;
        const boundary = boundaryOf(segment, end.cap);
        piece.path[row] = boundary.point;
        piece.platform[row] = boundary.deck;
      }
      out.push({ ...piece, head: span.head?.index ?? -1, tail: span.tail?.index ?? -1 });
    }
  }
  return out;
}

function slice(path, platform, from, to) {
  if (!(to - from > 1e-6)) return null;
  const points = [];
  const decks = [];
  const push = (distance) => {
    const r = rowAt(path, distance);
    const a = path[r];
    const b = path[r + 1];
    const span = b.distance - a.distance;
    const t = span > 0 ? Math.min(1, Math.max(0, (distance - a.distance) / span)) : 0;
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, distance });
    decks.push(platform[r] + (platform[r + 1] - platform[r]) * t);
  };
  push(from);
  for (const point of path) if (point.distance > from + 1e-6 && point.distance < to - 1e-6) push(point.distance);
  push(to);
  return { path: points, platform: Float32Array.from(decks) };
}

/**
 * La géométrie d'une surface : ses sommets à leur cote, décollés de `lift`,
 * et ses triangles. UV pris au sol : un carrefour n'a pas d'axe le long duquel
 * dérouler une texture.
 *
 * @returns {{positions:number[], uvs:number[], indices:number[]}|null}
 */
export function junctionSurface(area, lift = 0, { textureLength = 12, base = 0 } = {}) {
  if (!area?.triangles?.length || !Number.isFinite(area.deck)) return null;
  const positions = [];
  const uvs = [];
  for (const p of area.vertices) {
    positions.push(p.x, (Number.isFinite(p.y) ? p.y : area.deck) + lift, p.z);
    uvs.push(p.x / textureLength, p.z / textureLength);
  }
  const indices = [];
  for (const [a, b, c] of area.triangles) indices.push(base + a, base + c, base + b);
  return { positions, uvs, indices };
}

// --- Qui cède le passage -------------------------------------------------------

/**
 * La fourche d'un carrefour de graphe, s'il en est une : trois branches, dont
 * deux se quittent sous un angle fermé et la troisième arrive en face d'elles.
 */
export function forkOf(sorted) {
  if (!Array.isArray(sorted) || sorted.length !== 3) return null;
  for (let i = 0; i < 3; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % 3];
    const trunk = sorted[(i + 2) % 3];
    if (a.x * b.x + a.z * b.z < Math.cos(JUNCTION_FORK_ANGLE)) continue;
    const bx = a.x + b.x;
    const bz = a.z + b.z;
    const length = Math.hypot(bx, bz) || 1;
    if ((trunk.x * bx + trunk.z * bz) / length > -0.5) continue;
    return { trunk, a, b };
  }
  return null;
}

/** Vrai si un carrefour du graphe est une fourche (voir `forkOf`). */
export function isForkJunction(junction) {
  const branches = junction?.branches;
  if (!Array.isArray(branches) || branches.length !== 3) return false;
  return !!forkOf(branches.map((b) => ({ ...b, angle: Math.atan2(b.z, b.x) })).sort((a, b) => a.angle - b.angle));
}

/**
 * Vrai si une branche doit céder le passage au carrefour. La donnée ne porte
 * aucune priorité, mais la classe de chaque branche, donc sa largeur : on cède
 * le passage à plus large que soi. Lu par le marquage et par le panneau.
 *
 * @param {{halfWidth:number, roundabout?:boolean, fork?:boolean}} area Surface,
 *        ou carrefour de graphe.
 * @param {number} halfWidth Demi-largeur de la branche examinée.
 */
export function branchYields(area, halfWidth) {
  // On entre dans un giratoire en cédant le passage ; une fourche ne croise rien.
  if (area?.roundabout) return halfWidth > 0;
  if (area?.fork || isForkJunction(area)) return false;
  const dominant = area?.halfWidth;
  if (!(dominant > 0) || !(halfWidth > 0)) return false;
  return halfWidth < dominant - 1e-6;
}
