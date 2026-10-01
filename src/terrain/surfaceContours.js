/*
 * surfaceContours — les limites de la carte du sol, redessinées en traits.
 *
 * La carte porte une matière par texel de 2,7 m. Lue telle quelle, toute
 * limite est un escalier, et aucun filtre ne le redresse : la carte ne dit pas
 * où passe le polygone dans le texel, et un noyau, si large soit-il, ne fait
 * qu'arrondir les marches. On retrouve donc le **trait** :
 *
 * 1. les arêtes entre deux texels de matières différentes sont chaînées d'une
 *    jonction à l'autre (un coin où se touchent trois matières, ou le bord de
 *    la carte), ou en boucle ;
 * 2. chaque chaîne, prise par le milieu de ses arêtes, est simplifiée
 *    (Douglas-Peucker) : l'escalier d'une droite redevient la droite, le coin
 *    d'une parcelle reste vif. Les virages doux qui restent sont arrondis, les
 *    angles francs non ;
 * 3. chaque texel proche d'un trait reçoit sa **distance** au trait le plus
 *    proche et la matière d'**en face**, et prend la matière du côté du trait
 *    où tombe son centre.
 *
 * Le shader de terrain interpole cette distance, signée par la matière du
 * texel : elle est linéaire de part et d'autre d'un trait droit, donc
 * l'interpolation bilinéaire le restitue exactement. La matière d'en face
 * n'est là que pour qu'il sache quelle matière opposer, y compris dans une
 * maille dont les quatre texels sont du même côté.
 *
 * Le module ne connaît que des étiquettes entières ; ce qu'elles désignent
 * (matière, culture) est l'affaire de `groundClassMap`. Il est déterministe :
 * une chaîne ne dépend que des texels, et la carte est calée sur la grille du
 * monde.
 */

import { finishGeneration } from '../core/generationSteps.js';

/** Portée de la distance, en texels : au-delà, un texel est « loin de tout trait ». Couvre le voisinage 4 × 4 que lit le shader. */
export const CONTOUR_REACH_TEXELS = 3;

/**
 * Écart toléré entre l'escalier et le trait, en texels. Les milieux d'arêtes
 * d'une droite rasterisée s'en écartent d'un demi-texel de part et d'autre ;
 * une corde tirée entre deux d'entre eux peut donc en laisser un à un texel
 * entier. En dessous, l'escalier survit ; bien au-dessus, un vrai détail
 * disparaît.
 */
export const CONTOUR_TOLERANCE_TEXELS = 1.05;

/** Virage au-dessous duquel un sommet est arrondi, en radians : un coin de parcelle reste vif. */
const SMOOTH_MAX_TURN = (50 * Math.PI) / 180;
/** Longueur rognée de part et d'autre d'un sommet arrondi, au plus, en texels. */
const SMOOTH_MAX_CUT = 1.5;
const SMOOTH_PASSES = 2;

/** Points de chaînes simplifiés, puis traits mesurés, entre deux étapes de `contourSurfaceSteps`. */
const POINTS_PER_STEP = 40000;
const SEGMENTS_PER_STEP = 4000;

/**
 * Redessine les limites d'une carte d'étiquettes. Voir `contourSurfaceSteps`.
 */
export function contourSurface(labels, pixels) {
  return finishGeneration(contourSurfaceSteps(labels, pixels));
}

/**
 * @param {Uint8Array} labels Une étiquette par texel, ligne par ligne —
 *        **réécrite sur place** là où le trait passe de l'autre côté d'un centre.
 * @param {number} pixels Côté de la carte.
 * @returns {{distance: Float32Array, other: Int16Array, chains: number}}
 *          distance au trait le plus proche, en texels (plafonnée à
 *          `CONTOUR_REACH_TEXELS`), et étiquette d'en face (-1 : aucun trait
 *          à portée).
 */
export function* contourSurfaceSteps(labels, pixels) {
  const chains = yield* traceChainsSteps(labels, pixels);
  const segments = [];
  let work = 0;
  for (const chain of chains) {
    work += chain.points.length / 2;
    if (work > POINTS_PER_STEP) {
      work = 0;
      yield;
    }
    const points = smoothTurns(simplify(chain.points, chain.closed), chain.closed);
    const count = chain.closed ? points.length / 2 : points.length / 2 - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % (points.length / 2);
      segments.push(points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1], chain.left, chain.right);
    }
  }
  yield;

  const total = pixels * pixels;
  const distance = new Float32Array(total).fill(CONTOUR_REACH_TEXELS);
  const side = new Int16Array(total).fill(-1);
  const across = new Int16Array(total).fill(-1);
  const facing = new Uint8Array(total);
  for (let s = 0; s < segments.length; s += 6) {
    if (s > 0 && (s / 6) % SEGMENTS_PER_STEP === 0) yield;
    measureSegment(segments, s, pixels, distance, side, across, facing);
  }

  yield;
  const other = new Int16Array(total).fill(-1);
  for (let p = 0; p < total; p++) {
    if (side[p] < 0) continue;
    const own = labels[p];
    if (own !== side[p] && own !== across[p]) {
      // Une troisième matière près d'une jonction garde la sienne : le trait
      // le plus proche sépare deux autres matières que lui.
      other[p] = side[p];
    } else if (facing[p]) {
      labels[p] = side[p];
      other[p] = across[p];
    } else {
      // Au-delà du bout d'un trait, le côté ne se lit pas sûrement (pointe
      // d'un angle aigu) : le texel garde sa matière.
      other[p] = own === side[p] ? across[p] : side[p];
    }
  }
  return { distance, other, chains: chains.length };
}

/**
 * Chaînes d'arêtes entre texels d'étiquettes différentes.
 *
 * Les coins de texels forment une grille de `pixels + 1` de côté ; une arête
 * verticale va de (x, y) à (x, y + 1), une horizontale de (x, y) à (x + 1, y).
 * Un coin traversé par exactement deux arêtes sépare toujours les deux mêmes
 * étiquettes, du même côté : c'est ce qui permet de ne lire les deux côtés
 * qu'à la première arête. Tout autre coin est une jonction.
 *
 * `left` est l'étiquette du côté où le produit vectoriel (sens de marche,
 * point) est positif, `right` l'autre.
 */
export function traceChains(labels, pixels) {
  return finishGeneration(traceChainsSteps(labels, pixels));
}

/** Lignes de coins parcourues entre deux étapes de `traceChainsSteps`. */
const TRACE_ROWS_PER_STEP = 256;

export function* traceChainsSteps(labels, pixels) {
  const n = pixels;
  const stride = n + 1;
  // 1 : arête à parcourir, 2 : déjà chaînée.
  const vertical = new Uint8Array(stride * stride);
  const horizontal = new Uint8Array(stride * stride);
  for (let y = 0; y < n; y++) {
    for (let x = 1; x < n; x++) {
      if (labels[y * n + x - 1] !== labels[y * n + x]) vertical[y * stride + x] = 1;
    }
  }
  for (let y = 1; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (labels[(y - 1) * n + x] !== labels[y * n + x]) horizontal[y * stride + x] = 1;
    }
  }
  yield;

  const edge = (x, y, dir) => {
    switch (dir) {
      case 0: return y > 0 ? vertical[(y - 1) * stride + x] : 0;
      case 1: return horizontal[y * stride + x];
      case 2: return vertical[y * stride + x];
      default: return x > 0 ? horizontal[y * stride + x - 1] : 0;
    }
  };
  const degree = (x, y) => (edge(x, y, 0) > 0) + (edge(x, y, 1) > 0) + (edge(x, y, 2) > 0) + (edge(x, y, 3) > 0);
  const chains = [];

  // Un coin en damier (deux étiquettes croisées) n'est pas une jonction : l'une
  // des deux passe en diagonale. C'est la plus rare alentour — le filet d'eau
  // d'un texel, pas le pré qu'il traverse —, la plus haute à égalité. Le tracé
  // contourne alors le coin des deux autres texels au lieu de pincer le filet.
  const saddle = (x, y) => {
    if (x < 1 || y < 1 || x >= n || y >= n) return 0;
    const tl = labels[(y - 1) * n + x - 1];
    const tr = labels[(y - 1) * n + x];
    if (tl === tr || labels[y * n + x] !== tl || labels[y * n + x - 1] !== tr) return 0;
    let balance = 0;
    for (let j = Math.max(0, y - 2); j < Math.min(n, y + 2); j++) {
      for (let i = Math.max(0, x - 2); i < Math.min(n, x + 2); i++) {
        balance += (labels[j * n + i] === tl) - (labels[j * n + i] === tr);
      }
    }
    // 1 : la diagonale haut-gauche / bas-droite passe ; 2 : l'autre.
    return balance < 0 || (balance === 0 && tl > tr) ? 1 : 2;
  };
  // Arête de sortie selon l'arête d'arrivée (0 haut, 1 droite, 2 bas, 3 gauche).
  const SADDLE_EXIT = [null, [1, 0, 3, 2], [3, 2, 1, 0]];

  // Directions : 0 haut, 1 droite, 2 bas, 3 gauche.
  const walk = (x0, y0, dir0, closed) => {
    const points = closed ? [] : [x0, y0];
    let left;
    let right;
    switch (dir0) {
      case 0: left = labels[(y0 - 1) * n + x0]; right = labels[(y0 - 1) * n + x0 - 1]; break;
      case 1: left = labels[y0 * n + x0]; right = labels[(y0 - 1) * n + x0]; break;
      case 2: left = labels[y0 * n + x0 - 1]; right = labels[y0 * n + x0]; break;
      default: left = labels[(y0 - 1) * n + x0 - 1]; right = labels[y0 * n + x0 - 1]; break;
    }
    let x = x0;
    let y = y0;
    let dir = dir0;
    for (;;) {
      switch (dir) {
        case 0: vertical[(y - 1) * stride + x] = 2; points.push(x, y - 0.5); y--; break;
        case 1: horizontal[y * stride + x] = 2; points.push(x + 0.5, y); x++; break;
        case 2: vertical[y * stride + x] = 2; points.push(x, y + 0.5); y++; break;
        default: horizontal[y * stride + x - 1] = 2; points.push(x - 0.5, y); x--; break;
      }
      const pass = saddle(x, y);
      if (pass) {
        const exit = SADDLE_EXIT[pass][(dir + 2) % 4];
        if (edge(x, y, exit) !== 1) break;
        dir = exit;
        continue;
      }
      if (!closed && degree(x, y) !== 2) {
        points.push(x, y);
        break;
      }
      let next = -1;
      for (let d = 0; d < 4; d++) {
        if (edge(x, y, d) === 1) { next = d; break; }
      }
      if (next < 0) break;
      dir = next;
    }
    chains.push({ points, left, right, closed });
  };

  // D'abord les chaînes qui partent d'une jonction ou du bord, puis les boucles.
  for (let y = 0; y <= n; y++) {
    if (y % TRACE_ROWS_PER_STEP === 0 && y > 0) yield;
    for (let x = 0; x <= n; x++) {
      const d = degree(x, y);
      if (d === 0 || d === 2 || saddle(x, y)) continue;
      for (let dir = 0; dir < 4; dir++) if (edge(x, y, dir) === 1) walk(x, y, dir, false);
    }
  }
  for (let y = 0; y <= n; y++) {
    if (y % TRACE_ROWS_PER_STEP === 0 && y > 0) yield;
    for (let x = 0; x <= n; x++) {
      if (horizontal[y * stride + x] === 1) walk(x, y, 1, true);
      if (vertical[y * stride + x] === 1) walk(x, y, 2, true);
    }
  }
  return chains;
}

/** Douglas-Peucker ; une boucle garde au moins quatre sommets, sans quoi un texel isolé s'effondrerait en segment. */
export function simplify(points, closed, tolerance = CONTOUR_TOLERANCE_TEXELS) {
  const count = points.length / 2;
  if (count <= 3) return points;
  const keep = new Uint8Array(count);
  const tolerance2 = tolerance * tolerance;
  // Indices pris modulo : la seconde moitié d'une boucle se referme sur le premier point.
  const px = (i) => points[(i % count) * 2];
  const py = (i) => points[(i % count) * 2 + 1];

  const farthest = (a, b) => {
    const dx = px(b) - px(a);
    const dy = py(b) - py(a);
    const length2 = dx * dx + dy * dy;
    let best = -1;
    let bestDistance2 = -1;
    for (let i = a + 1; i < b; i++) {
      // Écart au segment, pas à sa droite : une chaîne qui part d'une
      // jonction et y revient a une corde de quelques texels.
      const ex = px(i) - px(a);
      const ey = py(i) - py(a);
      const t = length2 > 0 ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / length2)) : 0;
      const d2 = (ex - t * dx) ** 2 + (ey - t * dy) ** 2;
      if (d2 > bestDistance2) {
        bestDistance2 = d2;
        best = i;
      }
    }
    return { best, distance2: bestDistance2 };
  };
  const reduce = (a, b) => {
    const stack = [a, b];
    while (stack.length) {
      const j = stack.pop();
      const i = stack.pop();
      if (j - i < 2) continue;
      const { best, distance2 } = farthest(i, j);
      if (distance2 <= tolerance2) continue;
      keep[best % count] = 1;
      stack.push(i, best, best, j);
    }
  };

  if (!closed) {
    keep[0] = 1;
    keep[count - 1] = 1;
    reduce(0, count - 1);
  } else {
    // Une boucle se coupe en deux au point le plus éloigné du premier, et
    // chaque moitié garde au moins son point le plus saillant.
    let far = 1;
    for (let i = 2; i < count; i++) {
      if (Math.hypot(px(i) - px(0), py(i) - py(0)) > Math.hypot(px(far) - px(0), py(far) - py(0))) far = i;
    }
    keep[0] = 1;
    keep[far] = 1;
    for (const [a, b] of [[0, far], [far, count]]) {
      if (b - a >= 2) keep[farthest(a, b).best % count] = 1;
      reduce(a, b);
    }
  }

  const kept = [];
  for (let i = 0; i < count; i++) if (keep[i]) kept.push(i);
  return refit(points, kept, closed);
}

/** Écart au-delà duquel un sommet réajusté est jugé aberrant, en texels. */
const REFIT_MAX_SHIFT = 1.5;

/**
 * Les sommets gardés par Douglas-Peucker sont des points de l'escalier, donc
 * à un demi-texel du vrai tracé. Chaque morceau est remplacé par la droite
 * des moindres carrés de tous ses points, et un sommet par l'intersection de
 * ses deux droites — sauf aux bouts d'une chaîne ouverte, qui sont des
 * jonctions partagées.
 */
function refit(points, kept, closed) {
  const count = points.length / 2;
  const pieces = closed ? kept.length : kept.length - 1;
  const lines = [];
  for (let j = 0; j < pieces; j++) {
    const from = kept[j];
    const to = j + 1 < kept.length ? kept[j + 1] : kept[0] + count;
    let cx = 0;
    let cy = 0;
    for (let i = from; i <= to; i++) {
      cx += points[(i % count) * 2];
      cy += points[(i % count) * 2 + 1];
    }
    const n = to - from + 1;
    cx /= n;
    cy /= n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let i = from; i <= to; i++) {
      const dx = points[(i % count) * 2] - cx;
      const dy = points[(i % count) * 2 + 1] - cy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ cx, cy, ux: Math.cos(angle), uy: Math.sin(angle) });
  }

  const project = (line, x, y) => {
    const t = (x - line.cx) * line.ux + (y - line.cy) * line.uy;
    return [line.cx + t * line.ux, line.cy + t * line.uy];
  };
  const out = [];
  for (let j = 0; j < kept.length; j++) {
    const x = points[kept[j] * 2];
    const y = points[kept[j] * 2 + 1];
    const before = j > 0 ? lines[j - 1] : closed ? lines[pieces - 1] : null;
    const after = j < pieces ? lines[j] : null;
    if (!before || !after) {
      out.push(x, y);
      continue;
    }
    const cross = before.ux * after.uy - before.uy * after.ux;
    let vx;
    let vy;
    if (Math.abs(cross) > 0.2) {
      const t = ((after.cx - before.cx) * after.uy - (after.cy - before.cy) * after.ux) / cross;
      vx = before.cx + t * before.ux;
      vy = before.cy + t * before.uy;
    }
    if (vx === undefined || Math.hypot(vx - x, vy - y) > REFIT_MAX_SHIFT) {
      const [ax, ay] = project(before, x, y);
      const [bx, by] = project(after, x, y);
      vx = (ax + bx) / 2;
      vy = (ay + by) / 2;
    }
    out.push(vx, vy);
  }
  return out;
}

/**
 * Arrondit les virages doux par coupe de coin (Chaikin), sans toucher aux
 * angles francs ni aux extrémités d'une chaîne ouverte, qui sont des jonctions
 * partagées avec d'autres chaînes.
 */
export function smoothTurns(points, closed) {
  let current = points;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const count = current.length / 2;
    if (count < 3) return current;
    const out = [];
    for (let i = 0; i < count; i++) {
      const x = current[i * 2];
      const y = current[i * 2 + 1];
      const interior = closed || (i > 0 && i < count - 1);
      if (!interior) {
        out.push(x, y);
        continue;
      }
      const a = (i - 1 + count) % count;
      const b = (i + 1) % count;
      const inX = x - current[a * 2];
      const inY = y - current[a * 2 + 1];
      const outX = current[b * 2] - x;
      const outY = current[b * 2 + 1] - y;
      const inLength = Math.hypot(inX, inY);
      const outLength = Math.hypot(outX, outY);
      if (inLength === 0 || outLength === 0) {
        out.push(x, y);
        continue;
      }
      const cos = (inX * outX + inY * outY) / (inLength * outLength);
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > SMOOTH_MAX_TURN) {
        out.push(x, y);
        continue;
      }
      const cutIn = Math.min(inLength * 0.25, SMOOTH_MAX_CUT) / inLength;
      const cutOut = Math.min(outLength * 0.25, SMOOTH_MAX_CUT) / outLength;
      out.push(x - inX * cutIn, y - inY * cutIn, x + outX * cutOut, y + outY * cutOut);
    }
    current = out;
  }
  return current;
}

/**
 * Distance des centres de texels voisins à un trait. Parcourt le trait selon
 * son grand axe, et sur l'autre une bande juste assez large pour la portée :
 * la boîte englobante d'un long trait oblique coûterait son carré.
 */
function measureSegment(segments, s, pixels, distance, side, across, facing) {
  const ax = segments[s];
  const ay = segments[s + 1];
  const bx = segments[s + 2];
  const by = segments[s + 3];
  const left = segments[s + 4];
  const right = segments[s + 5];
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return;
  const reach = CONTOUR_REACH_TEXELS;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const slope = alongX ? dy / dx : dx / dy;
  const band = reach * Math.sqrt(1 + slope * slope) + 1;
  const [from, to] = alongX ? [Math.min(ax, bx), Math.max(ax, bx)] : [Math.min(ay, by), Math.max(ay, by)];

  const first = Math.max(0, Math.floor(from - reach - 0.5));
  const last = Math.min(pixels - 1, Math.ceil(to + reach - 0.5));
  for (let major = first; major <= last; major++) {
    const centre = major + 0.5;
    const clamped = Math.max(from, Math.min(to, centre));
    const line = alongX ? ay + (clamped - ax) * slope : ax + (clamped - ay) * slope;
    const low = Math.max(0, Math.floor(line - band - 0.5));
    const high = Math.min(pixels - 1, Math.ceil(line + band - 0.5));
    for (let minor = low; minor <= high; minor++) {
      const tx = alongX ? major : minor;
      const ty = alongX ? minor : major;
      const px = tx + 0.5 - ax;
      const py = ty + 0.5 - ay;
      const along = (px * dx + py * dy) / length2;
      const t = Math.max(0, Math.min(1, along));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d = Math.hypot(ex, ey);
      const p = ty * pixels + tx;
      if (d >= distance[p]) continue;
      distance[p] = d;
      const positive = dx * py - dy * px >= 0;
      side[p] = positive ? left : right;
      across[p] = positive ? right : left;
      facing[p] = along > 0 && along < 1 ? 1 : 0;
    }
  }
}
