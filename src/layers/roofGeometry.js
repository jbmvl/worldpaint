/*
 * roofGeometry — donner un toit à une empreinte OSM quelconque (pas d'axe ni
 * de pans définis). Plutôt qu'un vrai « straight skeleton » — cher et instable
 * sur les empreintes dégénérées — on construit le toit sur le rectangle
 * englobant orienté de l'empreinte (`orientedBox`). Ça déborde dans l'angle
 * rentrant d'une empreinte en L, accepté car le bâti rural est presque
 * toujours rectangulaire ; les empreintes trop mal remplies (`fill < 0.62`)
 * retombent sur le toit plat.
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

/** Aire absolue d'un anneau métrique. Fonction pure. */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z);
  }
  return Math.abs(sum / 2);
}

/** Hauteur du comble d'un toit posé sur une demi-largeur donnée. */
export function roofRise(short, roofs = defaultTheme.roofs) {
  return Math.min(roofs.maxRiseM, short * roofs.pitch);
}

/**
 * Triangles d'un toit posé sur un rectangle orienté. Rend une liste plate de
 * sommets `[x, y, z]` groupés par trois avec leurs normales.
 *
 * @param {Object} box    Résultat d'`orientedBox`.
 * @param {number} eaves  Altitude de l'égout (le haut des murs).
 * @param {string} shape  `gable`, `hip`, `pyramid` ou `flat`.
 * @returns {{positions:number[], normals:number[]}}
 */
export function roofTriangles(box, eaves, shape, roofs = defaultTheme.roofs) {
  const out = { positions: [], normals: [] };
  if (!box || shape === 'flat') return out;

  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const long = box.long + roofs.overhangM;
  const short = box.short + roofs.overhangM;
  const rise = roofRise(box.short, roofs);
  if (rise <= 0.05) return out;

  // Repère local du toit : `u` le long du faîtage, `v` en travers.
  const at = (u, v, y) => [box.cx + u * cos - v * sin, y, box.cz + u * sin + v * cos];

  const top = eaves + rise;
  // Faîtage : plein pour une faîtière, raccourci pour une croupe, nul pour une pyramide.
  const ridge = shape === 'pyramid' ? 0 : shape === 'hip' ? Math.max(0, long - short) : long;

  const eaveA = at(-long, -short, eaves);
  const eaveB = at(long, -short, eaves);
  const eaveC = at(long, short, eaves);
  const eaveD = at(-long, short, eaves);
  const ridgeA = at(-ridge, 0, top);
  const ridgeB = at(ridge, 0, top);

  // Enroulement choisi pour que chaque normale sorte du comble.
  const push = (a, b, c) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // Triangle dégénéré (pyramide : faîtage réduit à un point).
    if (length < 1e-9) return;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const p of [a, b, c]) {
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(nx, ny, nz);
    }
  };
  const quad = (a, b, c, d) => {
    push(a, b, c);
    push(a, c, d);
  };

  // Les deux longs pans, puis les deux bouts (pignons ou croupes).
  quad(eaveA, ridgeA, ridgeB, eaveB);
  quad(eaveD, eaveC, ridgeB, ridgeA);
  push(eaveA, eaveD, ridgeA);
  push(eaveB, ridgeB, eaveC);

  return out;
}
