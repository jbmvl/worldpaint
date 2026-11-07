/*
 * roofGeometry — donner un toit à une empreinte OSM quelconque (pas d'axe ni
 * de pans définis). Plutôt qu'un vrai « straight skeleton » — cher et instable
 * sur les empreintes dégénérées — la **forme** du comble vient du rectangle
 * englobant orienté (`orientedBox`) : deux plans pour une faîtière, quatre
 * pour une croupe ou une pyramide, et le toit est leur minimum. Ce champ de
 * hauteur n'est évalué que **sur l'empreinte réelle**, triangle par triangle :
 * aucun débord, rien au-dessus d'un vide. Là où il passe au-dessus de l'égout
 * le long d'un mur, un panneau vertical ferme le comble.
 *
 * Approximation assumée : le faîtage suit l'axe de la boîte, pas celui de
 * chaque aile — dans une empreinte en L, le flanc de l'aile devient un haut
 * pignon. Les empreintes trop mal remplies (`fill < 0.62`) retombent sur le
 * toit plat.
 *
 * Fonctions pures, sommets en mètres locaux.
 */

import { defaultTheme } from '../themes/default.js';

/**
 * Rectangle englobant orienté d'un anneau, par rotation d'appui : chaque côté
 * du polygone est essayé comme direction candidate, on garde celle qui
 * minimise l'aire (approximation sur l'anneau brut plutôt que son enveloppe
 * convexe).
 *
 * @param {Array<{x:number, z:number}>} ring
 * @returns {{cx:number, cz:number, angle:number, long:number, short:number,
 *           fill:number}|null} centre, direction du grand côté, demi-dimensions,
 *          et part de l'empreinte réellement occupée.
 */
export function orientedBox(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;

    const ux = dx / length;
    const uz = dz / length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of ring) {
      const u = p.x * ux + p.z * uz;
      const v = -p.x * uz + p.z * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uz, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;

  const { ux, uz, minU, maxU, minV, maxV } = best;
  const midU = (minU + maxU) / 2;
  const midV = (minV + maxV) / 2;
  const spanU = maxU - minU;
  const spanV = maxV - minV;

  // Le grand côté porte le faîtage.
  const alongU = spanU >= spanV;
  const angle = alongU ? Math.atan2(uz, ux) : Math.atan2(ux, -uz);

  return {
    cx: midU * ux - midV * uz,
    cz: midU * uz + midV * ux,
    angle,
    long: Math.max(spanU, spanV) / 2,
    short: Math.min(spanU, spanV) / 2,
    fill: best.area > 0 ? Math.min(1, ringArea(ring) / best.area) : 0,
  };
}

/** Aire signée d'un anneau métrique, positive dans le sens trigonométrique du plan (x, z). */
function signedRingArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z);
  }
  return sum / 2;
}

/** Aire absolue d'un anneau métrique. Fonction pure. */
export function ringArea(ring) {
  return Math.abs(signedRingArea(ring));
}

/** Hauteur du comble d'un toit posé sur une demi-largeur donnée. */
export function roofRise(short, roofs = defaultTheme.roofs) {
  return Math.min(roofs.maxRiseM, short * roofs.pitch);
}

/**
 * Plans d'un comble : chacun rend, en un point du sol, la part de la hauteur
 * du comble qu'il y atteint — 1 sur le faîtage, 0 sur le bord de la boîte. Le
 * toit est leur minimum.
 */
function roofPlanes(box, shape) {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const short = box.short || 0.01;
  const long = box.long || 0.01;
  // Forme `k0 + ku·u + kv·v` du repère de la boîte (u le long du faîtage, v en
  // travers), réécrite en `a + b·x + c·z`.
  const plane = (k0, ku, kv) => {
    const b = ku * cos - kv * sin;
    const c = ku * sin + kv * cos;
    return { a: k0 - b * box.cx - c * box.cz, b, c };
  };

  const planes = [plane(1, 0, -1 / short), plane(1, 0, 1 / short)];
  // Croupe à la pente des longs pans : le faîtage s'arrête à `long - short`.
  if (shape === 'hip') planes.push(plane(long / short, -1 / short, 0), plane(long / short, 1 / short, 0));
  if (shape === 'pyramid') planes.push(plane(1, -1 / long, 0), plane(1, 1 / long, 0));
  return planes;
}

/** Partie d'un polygone convexe où `side` est négatif ou nul. */
function clipHalfPlane(polygon, side) {
  const kept = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) kept.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      kept.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return kept;
}

/**
 * Triangles d'un comble posé sur l'empreinte réelle. Rend une liste plate de
 * sommets `[x, y, z]` groupés par trois avec leurs normales : les pans, puis
 * les panneaux verticaux qui ferment le comble au-dessus des murs.
 *
 * @param {Array<{x:number, z:number}>} ring Anneau des murs.
 * @param {Array<number[]>} faces Triangulation de l'anneau, indices par trois.
 * @param {Object} box    Résultat d'`orientedBox` sur ce même anneau.
 * @param {number} eaves  Altitude de l'égout (le haut des murs).
 * @param {string} shape  `gable`, `hip`, `pyramid` ou `flat`.
 * @returns {{positions:number[], normals:number[]}}
 */
export function roofTriangles(ring, faces, box, eaves, shape, roofs = defaultTheme.roofs) {
  const out = { positions: [], normals: [] };
  if (!box || !Array.isArray(ring) || ring.length < 3 || !Array.isArray(faces) || shape === 'flat') return out;

  const rise = roofRise(box.short, roofs);
  if (rise <= 0.05) return out;

  const planes = roofPlanes(box, shape);
  const share = (plane, p) => plane.a + plane.b * p.x + plane.c * p.z;
  // L'empreinte est dans la boîte : le minimum n'y est négatif qu'à l'arrondi près.
  const heightAt = (p) => {
    let least = Infinity;
    for (const plane of planes) least = Math.min(least, share(plane, p));
    return eaves + rise * Math.max(0, least);
  };

  // Enroulement choisi pour que la normale regarde du côté de `facing`.
  const push = (a, b, c, facing) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // Morceau dégénéré : découpe tombée sur un sommet, pignon qui s'annule.
    if (length < 1e-9) return;
    const sign = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0 ? -1 : 1;
    nx *= sign / length;
    ny *= sign / length;
    nz *= sign / length;
    const [p0, p1, p2] = sign < 0 ? [a, c, b] : [a, b, c];
    for (const p of [p0, p1, p2]) out.positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 3; i++) out.normals.push(nx, ny, nz);
  };

  // Pans : chaque triangle de l'empreinte, restreint à la zone où un plan est
  // le plus bas — là, le toit est ce plan, et le morceau reste plan.
  const up = [0, 1, 0];
  for (const face of faces) {
    const triangle = face.map((index) => ring[index]);
    if (triangle.length !== 3 || triangle.some((p) => !p)) continue;
    for (const plane of planes) {
      let piece = triangle;
      for (const other of planes) {
        if (other === plane || piece.length < 3) continue;
        piece = clipHalfPlane(piece, (p) => share(plane, p) - share(other, p));
      }
      if (piece.length < 3) continue;
      const lifted = piece.map((p) => [p.x, eaves + rise * Math.max(0, share(plane, p)), p.z]);
      for (let i = 1; i < lifted.length - 1; i++) push(lifted[0], lifted[i], lifted[i + 1], up);
    }
  }

  // Pignons : le long d'un mur, la hauteur du toit est affine par morceaux ;
  // l'arête est coupée partout où deux plans échangent leur rang.
  const orientation = signedRingArea(ring) < 0 ? -1 : 1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const outward = [orientation * (b.z - a.z), 0, -orientation * (b.x - a.x)];
    const cuts = [0, 1];
    for (let j = 0; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const d0 = share(planes[j], a) - share(planes[k], a);
        const d1 = share(planes[j], b) - share(planes[k], b);
        if (d0 * d1 < 0) cuts.push(d0 / (d0 - d1));
      }
    }
    cuts.sort((s, t) => s - t);

    let previous = null;
    for (const t of cuts) {
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const current = { foot: [p.x, eaves, p.z], head: [p.x, heightAt(p), p.z] };
      if (previous && Math.max(previous.head[1], current.head[1]) > eaves + 1e-4) {
        push(previous.foot, current.foot, current.head, outward);
        push(previous.foot, current.head, previous.head, outward);
      }
      previous = current;
    }
  }

  return out;
}

/** Emprise minimale d'un toit-terrasse pour qu'il porte quelque chose, en m². */
export const ROOF_CLUTTER_MIN_AREA_M2 = 40;

/**
 * Ce qu'un toit-terrasse porte : un édicule d'escalier, des climatiseurs,
 * parfois une antenne. Positions dans le rectangle orienté, en retrait des
 * bords ; l'appelant écarte ce qui sort de l'empreinte. Tiré du lieu, au
 * centre du rectangle.
 *
 * @param {Object} frame Repère local.
 * @param {{cx:number,cz:number,angle:number,long:number,short:number}} box
 * @param {Function} random `randomAt`.
 * @returns {Array<{kind:'stair'|'unit'|'antenna', x:number, z:number, yaw:number}>}
 */
export function roofClutterFor(frame, box, random) {
  const area = box.long * box.short;
  if (area < ROOF_CLUTTER_MIN_AREA_M2 || box.short < 4) return [];
  const draw = (salt) => random(frame, box.cx, box.cz, salt);
  const at = boxPoint(box);
  const out = [];
  // Un îlot à cour intérieure a un grand rectangle et une emprise en anneau :
  // on tire en proportion du rectangle, l'appelant garde ce qui tombe sur le toit.
  const stairs = area >= 100 ? Math.min(4, 1 + Math.floor(area / 500)) : 0;
  for (let i = 0; i < stairs; i++) {
    if (draw(601 + i * 6) < 0.8) out.push(at('stair', draw(603 + i * 6) * 1.5 - 0.75, draw(605 + i * 6) * 1.3 - 0.65));
  }
  const units = 2 + Math.floor(draw(631) * Math.min(14, area / 50));
  for (let i = 0; i < units; i++) out.push(at('unit', draw(633 + i * 4) * 1.6 - 0.8, draw(635 + i * 4) * 1.4 - 0.7));
  const antennas = Math.min(3, Math.floor(area / 300) + (draw(711) < 0.5 ? 1 : 0));
  for (let i = 0; i < antennas; i++) out.push(at('antenna', draw(713 + i * 4) * 1.4 - 0.7, draw(715 + i * 4) * 1.2 - 0.6));
  return out;
}

/**
 * Souches de cheminée d'un immeuble à toit pentu : une rangée sur le faîtage,
 * une tous les huit mètres environ, et parfois une antenne sur l'une d'elles.
 * Sur une croupe, le faîtage est plus court que le bâtiment d'une largeur.
 *
 * @returns {Array<{kind:'stack'|'antenna', x:number, z:number, yaw:number, height:number}>}
 */
export function ridgeStacksFor(frame, box, shape, random) {
  if (box.long < 6 || shape === 'flat') return [];
  const draw = (salt) => random(frame, box.cx, box.cz, salt);
  const ridge = shape === 'gable' ? box.long * 0.8 : Math.max(0, box.long - box.short);
  const count = Math.min(5, 1 + Math.floor(ridge / 8));
  const at = boxPoint(box);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * (ridge / box.long);
    const item = at('stack', t * 2, (draw(661 + i * 4) - 0.5) * 0.1);
    item.height = 1.1 + draw(663 + i * 4) * 0.8;
    out.push(item);
  }
  if (draw(691) < 0.4) {
    const host = out[Math.floor(draw(693) * out.length)];
    out.push({ ...host, kind: 'antenna', height: host.height });
  }
  return out;
}

/** Un point du rectangle orienté, en fractions de demi-côté (−1…1). */
function boxPoint(box) {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  return (kind, along, across) => ({
    kind,
    x: box.cx + cos * along * box.long * 0.5 - sin * across * box.short * 0.5,
    z: box.cz + sin * along * box.long * 0.5 + cos * across * box.short * 0.5,
    yaw: Math.PI / 2 - box.angle,
  });
}
