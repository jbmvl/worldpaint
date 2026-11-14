/*
 * ruinGeometry — les ruines antiques, dessinées sur l'emprise réelle.
 *
 * Les tuiles ne disent d'une ruine que son nom et `castle/ruins` : ni l'époque
 * ni le type d'édifice. La forme se décide donc par le nom quand il parle
 * (« Tempio », « Teatro », « Anfiteatro »), par l'emprise sinon : un rectangle
 * plein et allongé est un temple, le reste des murs arasés. Un théâtre sans
 * nom ne se devine pas : sa forme se confond avec trop de choses.
 *
 * Chaque forme rend un `Kit` centré sur le rectangle orienté de l'emprise,
 * pied à l'assise du bâtiment (`buildingLayer` le pose). L'usure d'un temple
 * (colonnes debout, tronquées, entablement) se tire par position au sol, pour
 * que le même temple revienne à chaque reconstruction.
 */
import { Kit } from './furnitureKit.js';
import { randomAt } from '../core/groundSeed.js';

const TEMPLE_NAME = /\b(tempi[oa]|temples?|templo|tempel|naos)\b/i;
const AMPHITHEATRE_NAME = /(anfiteatr|amphith[ée][aâ]tre|amphitheat|ar[eè]nes\b)/i;
const THEATRE_NAME = /(\bteatr|th[ée][aâ]tre|\btheater\b|\bodeon\b|\bodéon\b)/i;
// Un théâtre ou une attraction n'est une ruine que si son nom le dit antique :
// la plupart des théâtres sont des salles en service.
const ANCIENT_NAME = /(\btempi[oa]\b|\btemples?\b|\btemplo\b|\btempel\b|anfiteatr|amphith[ée][aâ]tre|amphitheat|\bar[eè]nes\b|\b(teatro|th[ée][aâ]tre|theatre|theater)\s+(greco|grec|romano|romain|antique|antico|ancient))/i;

/** Un nom qui désigne un édifice antique (temple, théâtre grec ou romain, amphithéâtre). */
export function isAncientName(name) {
  return typeof name === 'string' && ANCIENT_NAME.test(name);
}

/** Allongement minimal (grand côté / petit côté) d'un temple reconnu à sa seule emprise. */
export const TEMPLE_MIN_ASPECT = 1.9;
/** Part du rectangle orienté que l'emprise d'un temple sans nom remplit au moins. */
export const TEMPLE_MIN_FILL = 0.8;
/** Longueur minimale d'un temple, en mètres. */
export const TEMPLE_MIN_LENGTH_M = 10;
/** Diamètre minimal d'un théâtre ou d'un amphithéâtre, en mètres. */
export const THEATRE_MIN_SPAN_M = 20;

/**
 * Forme d'une ruine : `temple`, `theatre`, `amphitheatre` ou `remains`.
 * @param {{name?:string|null, box:{long:number, short:number, fill:number}}} ruin
 */
export function ruinFormFor({ name = null, box }) {
  const length = box.long * 2;
  if (name && TEMPLE_NAME.test(name)) return length >= TEMPLE_MIN_LENGTH_M ? 'temple' : 'remains';
  if (name && AMPHITHEATRE_NAME.test(name)) return length >= THEATRE_MIN_SPAN_M ? 'amphitheatre' : 'remains';
  if (name && THEATRE_NAME.test(name)) return length >= THEATRE_MIN_SPAN_M ? 'theatre' : 'remains';
  const aspect = box.long / Math.max(box.short, 1e-6);
  if (aspect >= TEMPLE_MIN_ASPECT && box.fill >= TEMPLE_MIN_FILL && length >= TEMPLE_MIN_LENGTH_M) return 'temple';
  return 'remains';
}

/**
 * Le `Kit` d'une ruine, en mètres autour du centre de `box`, `y = 0` à l'assise.
 *
 * @param {Object} o
 * @param {string} o.form Voir `ruinFormFor`.
 * @param {Array<{x:number,z:number}>} o.footprint Emprise, en coordonnées de scène.
 * @param {Object} o.box Rectangle orienté de l'emprise (`orientedBox`).
 * @param {{wall:number[], roof:number[]}} o.look Pierre claire, pierre ombrée.
 * @param {Object} o.frame Repère local : graine de l'usure.
 * @param {number} o.relief Dénivelé de l'emprise (crête − assise), en mètres.
 * @param {(x:number,z:number)=>number} o.groundAt Sol en coordonnées de scène.
 */
export function ruinKit({ form, footprint, box, look, frame, relief = 0, groundAt = null }) {
  const kit = new Kit();
  if (form === 'temple') templeRuin(kit, box, look, frame, relief);
  else if (form === 'theatre') theatreRuin(kit, box, look, relief, uphillSide(box, groundAt));
  else if (form === 'amphitheatre') amphitheatreRuin(kit, box, look);
  else wallRemains(kit, footprint, box, look, frame);
  return kit;
}

// Repère de la ruine : `u` le long du grand côté, `v` en travers.
function axes(box) {
  const ux = Math.cos(box.angle), uz = Math.sin(box.angle);
  return {
    at: (u, y, v) => [u * ux - v * uz, y, u * uz + v * ux],
    world: (u, v) => ({ x: box.cx + u * ux - v * uz, z: box.cz + u * uz + v * ux }),
    yaw: -box.angle,
  };
}

// Pose un quadrilatère tourné vers `want` (vecteur), quel que soit l'ordre des sommets.
function face(kit, a, b, c, d, color, want) {
  const n = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) kit.quad(d, c, b, a, color);
  else kit.quad(a, b, c, d, color);
}

/** Proportions d'un temple dorique : diamètre de colonne, hauteur, entraxe. */
export const TEMPLE_COLUMN = { widthShare: 1 / 9, minM: 0.8, maxM: 2.2, heightRatio: 5.5, spacingRatio: 2.3 };
/** Part des temples restés debout avec leur entablement (Concorde, Ségeste). */
export const TEMPLE_STANDING_SHARE = 0.35;

function templeRuin(kit, box, look, frame, relief) {
  const { at, world, yaw } = axes(box);
  const L = box.long * 2, W = box.short * 2;
  const d = Math.max(TEMPLE_COLUMN.minM, Math.min(TEMPLE_COLUMN.maxM, W * TEMPLE_COLUMN.widthShare));
  const step = Math.max(0.25, Math.min(0.5, W / 40));

  // Crépis de trois degrés, monté au-dessus du point haut : sur une pente,
  // le temple reste sur son podium au lieu de s'enfoncer côté amont.
  const floor = relief + step * 3;
  for (let i = 0; i < 3; i++) {
    const inset = i * step * 1.4;
    const y0 = i === 0 ? -0.6 : relief + step * i;
    kit.box({ width: L - inset * 2, depth: W - inset * 2, height: relief + step * (i + 1) - y0, y: y0, yaw, color: i === 2 ? look.wall : look.roof });
  }

  const standing = randomAt(frame, box.cx, box.cz, 701) < TEMPLE_STANDING_SHARE;
  const height = d * TEMPLE_COLUMN.heightRatio;
  const inset = d * 1.1;
  const halfU = L / 2 - inset, halfV = W / 2 - inset;
  const nu = Math.max(2, Math.round((halfU * 2) / (d * TEMPLE_COLUMN.spacingRatio)) + 1);
  const nv = Math.max(2, Math.round((halfV * 2) / (d * TEMPLE_COLUMN.spacingRatio)) + 1);

  // Péristyle : le pourtour parcouru dans l'ordre, chaque colonne une fois.
  const ring = [];
  for (let i = 0; i < nu; i++) ring.push([-halfU + (2 * halfU * i) / (nu - 1), -halfV]);
  for (let j = 1; j < nv; j++) ring.push([halfU, -halfV + (2 * halfV * j) / (nv - 1)]);
  for (let i = nu - 2; i >= 0; i--) ring.push([-halfU + (2 * halfU * i) / (nu - 1), halfV]);
  for (let j = nv - 2; j >= 1; j--) ring.push([-halfU, -halfV + (2 * halfV * j) / (nv - 1)]);

  const heights = ring.map(([u, v]) => {
    if (standing) return height;
    const p = world(u, v);
    const r = randomAt(frame, p.x, p.z, 703);
    if (r < 0.3) return 0;
    if (r < 0.5) return height * (0.2 + randomAt(frame, p.x, p.z, 707) * 0.5);
    return height;
  });

  ring.forEach(([u, v], i) => {
    const h = heights[i];
    if (h <= 0) {
      // Tambour tombé au pied de sa base : la place de la colonne reste lisible.
      const [x, , z] = at(u, 0, v);
      kit.cylinder({ radiusBottom: d * 0.5, radiusTop: d * 0.5, height: d * 0.5, radial: 8, x, y: floor, z, color: look.roof });
      return;
    }
    const [x, , z] = at(u, 0, v);
    kit.cylinder({ radiusBottom: d * 0.5, radiusTop: d * 0.42, height: h, radial: 8, x, y: floor, z, color: look.wall });
    if (h === height) kit.box({ width: d * 1.15, depth: d * 1.15, height: d * 0.25, x, y: floor + h, z, yaw, color: look.wall });
  });

  // Entablement : en entier sur un temple debout, sinon par travées dont
  // les deux colonnes ont gardé leur chapiteau.
  const beamY = floor + height + d * 0.25;
  const beamH = d * 1.3;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    if (!standing && (heights[i] !== height || heights[j] !== height)) continue;
    const [u0, v0] = ring[i], [u1, v1] = ring[j];
    const span = Math.hypot(u1 - u0, v1 - v0);
    const along = Math.abs(u1 - u0) > Math.abs(v1 - v0);
    const [x, , z] = at((u0 + u1) / 2, 0, (v0 + v1) / 2);
    kit.box({
      width: along ? span + d : d * 1.1,
      depth: along ? d * 1.1 : span + d,
      height: beamH,
      x, y: beamY, z, yaw,
      color: look.wall,
    });
  }

  if (standing) {
    // Frontons aux deux petits côtés, sans toiture : c'est ce qui en reste.
    const top = beamY + beamH, rise = W * 0.12;
    for (const s of [-1, 1]) {
      const u = s * halfU;
      const a = at(u, top, -halfV - d * 0.55), b = at(u, top, halfV + d * 0.55), c = at(u, top + rise, 0);
      const outward = [Math.cos(box.angle) * s, 0, Math.sin(box.angle) * s];
      const n = ((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])) * outward[0] +
        ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * outward[2];
      if (n >= 0) kit.tri(a, b, c, look.wall); else kit.tri(a, c, b, look.wall);
    }
  } else {
    // Cella arasée : quatre murs bas au cœur du péristyle.
    const cu = halfU * 0.7, cv = halfV * 0.55, t = d * 0.6, h = Math.min(height * 0.3, 2.4);
    for (const [u, v, w, dd] of [[0, -cv, cu * 2, t], [0, cv, cu * 2, t], [-cu, 0, t, cv * 2], [cu, 0, t, cv * 2]]) {
      const [x, , z] = at(u, 0, v);
      kit.box({ width: w, depth: dd, height: h, x, y: floor - 0.1, z, yaw, color: look.roof });
    }
  }
}

// Côté du petit axe où le sol monte : un théâtre grec s'adosse à la pente.
function uphillSide(box, groundAt) {
  if (!groundAt) return 1;
  const { world } = axes(box);
  const a = world(0, box.short), b = world(0, -box.short);
  const ha = groundAt(a.x, a.z), hb = groundAt(b.x, b.z);
  return Number.isFinite(ha) && Number.isFinite(hb) && hb > ha ? -1 : 1;
}

/** Gradins : hauteur d'un degré, bornes en mètres ; part du rayon laissée à l'orchestre ou à l'arène. */
export const THEATRE_TIER = { minRiseM: 0.4, maxRiseM: 1, depthM: 1.6, minCount: 6, maxCount: 30 };

// Gradins en anneau elliptique, de `t0` à 1 du rayon, sur `[θ0, θ1]`, montant vers l'extérieur.
function tiers(kit, { center, a, b, t0, theta0, theta1, segments, rise, count, look, at }) {
  const point = (t, theta, y) => at(center[0] + Math.cos(theta) * a * t, y, center[1] + Math.sin(theta) * b * t);
  const radial = (theta) => {
    const [x, , z] = at(Math.cos(theta) * a, 0, Math.sin(theta) * b);
    const [ox, , oz] = at(0, 0, 0);
    return [x - ox, 0, z - oz];
  };
  for (let k = 0; k < count; k++) {
    const ti = t0 + ((1 - t0) * k) / count, to = t0 + ((1 - t0) * (k + 1)) / count;
    const y = rise * (k + 1), below = rise * k;
    for (let s = 0; s < segments; s++) {
      const p = theta0 + ((theta1 - theta0) * s) / segments, q = theta0 + ((theta1 - theta0) * (s + 1)) / segments;
      const color = k % 2 ? look.roof : look.wall;
      face(kit, point(ti, p, y), point(to, p, y), point(to, q, y), point(ti, q, y), color, [0, 1, 0]);
      const inward = radial((p + q) / 2).map((c) => -c);
      face(kit, point(ti, p, below), point(ti, q, below), point(ti, q, y), point(ti, p, y), color, inward);
    }
  }
  // Mur de fond, du sol au dernier degré.
  const top = rise * count;
  for (let s = 0; s < segments; s++) {
    const p = theta0 + ((theta1 - theta0) * s) / segments, q = theta0 + ((theta1 - theta0) * (s + 1)) / segments;
    face(kit, point(1, p, -0.6), point(1, q, -0.6), point(1, q, top), point(1, p, top), look.roof, radial((p + q) / 2));
  }
  return top;
}

function tierCount(depth, relief) {
  const count = Math.max(THEATRE_TIER.minCount, Math.min(THEATRE_TIER.maxCount, Math.round(depth / THEATRE_TIER.depthM)));
  const rise = Math.max(THEATRE_TIER.minRiseM, Math.min(THEATRE_TIER.maxRiseM, relief / count));
  return { count, rise };
}

function theatreRuin(kit, box, look, relief, side) {
  const { at, yaw } = axes(box);
  // Le diamètre suit le grand côté, la scène le bord droit, la cavea monte vers l'amont.
  const a = box.long, b = box.short * 2 * side;
  const center = [0, -side * box.short];
  const t0 = 0.3;
  const { count, rise } = tierCount(Math.abs(b) * (1 - t0), relief);
  tiers(kit, { center, a, b, t0, theta0: 0, theta1: Math.PI, segments: 20, rise, count, look, at });

  // Scène arasée, le long du diamètre.
  const [x, , z] = at(0, 0, center[1] - side * 1.5);
  kit.box({ width: a * 1.6, depth: 2, height: Math.min(4, 1.5 + a * 0.04), x, y: -0.6, z, yaw, color: look.roof });
}

function amphitheatreRuin(kit, box, look) {
  const { at } = axes(box);
  // Pas d'adossement : les gradins montent de toute leur hauteur.
  const { count, rise } = tierCount(box.short * 0.45, Infinity);
  const top = tiers(kit, { center: [0, 0], a: box.long, b: box.short, t0: 0.55, theta0: 0, theta1: Math.PI * 2, segments: 32, rise, count, look, at });
  // Façade : un étage d'arcades au-dessus des gradins, lu de loin comme un anneau.
  const facade = top + 3;
  const point = (theta, y) => at(Math.cos(theta) * box.long, y, Math.sin(theta) * box.short);
  for (let s = 0; s < 32; s++) {
    const p = (Math.PI * 2 * s) / 32, q = (Math.PI * 2 * (s + 1)) / 32;
    const out = at(Math.cos((p + q) / 2) * box.long, 0, Math.sin((p + q) / 2) * box.short);
    face(kit, point(p, top), point(q, top), point(q, facade), point(p, facade), look.wall, [out[0], 0, out[2]]);
  }
}

/** Murs arasés : tronçons le long de l'emprise, longueur et hauteurs en mètres, plafond de tronçons. */
export const REMAINS = { pieceM: 3, thicknessM: 0.7, minHeightM: 0.5, maxHeightM: 2.2, standingShare: 0.7, maxPieces: 80 };

function wallRemains(kit, footprint, box, look, frame) {
  let pieces = 0;
  for (let i = 0; i < footprint.length && pieces < REMAINS.maxPieces; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.5) continue;
    const n = Math.max(1, Math.round(length / REMAINS.pieceM));
    const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
    for (let k = 0; k < n && pieces < REMAINS.maxPieces; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (randomAt(frame, x, z, 711) > REMAINS.standingShare) continue;
      const h = REMAINS.minHeightM + randomAt(frame, x, z, 713) * (REMAINS.maxHeightM - REMAINS.minHeightM);
      kit.box({ width: length / n, depth: REMAINS.thicknessM, height: h + 0.6, x: x - box.cx, y: -0.6, z: z - box.cz, yaw, color: pieces % 3 ? look.wall : look.roof });
      pieces++;
    }
  }
}
