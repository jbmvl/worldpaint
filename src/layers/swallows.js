/*
 * swallows — des hirondelles posées sur les lignes aériennes, qui s'envolent
 * quand on s'en approche.
 * -------------------------------------------------------------------------
 * La portée est **ancrée au sol** : une portée de câble publiée par le
 * mobilier (`wireSpans`) sur quelques-unes porte une rangée d'oiseaux, tirée
 * de son milieu (`SWALLOW_SPAN_ODDS`), toujours la même. L'observateur ne fait
 * que la lever en passant à moins de `SWALLOW_FLUSH_M` ; une portée levée reste
 * vide `SWALLOW_REST_S`.
 *
 * L'envol n'est pas celui des étourneaux : chaque hirondelle se laisse tomber
 * du fil, puis file à ras, en zigzag, à l'opposé de l'observateur — elles ne
 * font pas nuage, elles s'égaillent.
 */

import { hashUnit, positionSeed } from '../core/groundSeed.js';

export const SWALLOW_MAX = 48;
export const SWALLOW_SPAN_ODDS = 0.18;
export const SWALLOW_PER_SPAN = [3, 10];
/** Au-delà, une hirondelle sur un fil n'est plus un pixel. */
export const SWALLOW_SEEN_M = 160;
export const SWALLOW_RESOW_M = 30;
export const SWALLOW_FLUSH_M = 30;
export const SWALLOW_REST_S = 300;
export const SWALLOW_FLIGHT_S = 6;
export const SWALLOW_SPEED_M_S = 12;
export const SWALLOW_SPAN_M = 0.33;
export const SWALLOW_FLAP_HZ = 13;
const SALT = 7417;

/** Cote du câble à la fraction `t` de la portée : la flèche de `appendOverheadLine`. */
function wireY(span, t) {
  return span.ay + (span.by - span.ay) * t - span.sag * 4 * t * (1 - t);
}

/**
 * Les portées habitées à portée de vue de `here`, chacune avec ses oiseaux.
 * Pur : la même portée porte toujours les mêmes oiseaux, au même endroit.
 * @returns {Array<{key:number, x:number, z:number, birds:Array}>}
 */
export function perchesNear(frame, here, spans) {
  const perches = [];
  for (const span of spans ?? []) {
    const x = (span.ax + span.bx) / 2;
    const z = (span.az + span.bz) / 2;
    if (Math.hypot(x - here.x, z - here.z) > SWALLOW_SEEN_M) continue;
    const key = positionSeed(frame, x, z, SALT);
    if (key / 4294967296 >= SWALLOW_SPAN_ODDS) continue;
    const r = (k) => hashUnit(key, k);
    const [min, max] = SWALLOW_PER_SPAN;
    const count = min + Math.floor(r(1) * (max - min + 1));
    // Tous tournés du même côté du fil : face au vent, qu'on ne lit pas ici.
    const facing = Math.atan2(span.bx - span.ax, span.bz - span.az) + (r(2) < 0.5 ? 1 : -1) * Math.PI / 2;
    // Une rangée serrée sur une part de la portée, pas un semis sur toute sa longueur.
    const from = 0.15 + r(3) * 0.4;
    const birds = [];
    let t = from;
    for (let i = 0; i < count && t < 0.9; i++) {
      birds.push({
        x: span.ax + (span.bx - span.ax) * t,
        y: wireY(span, t),
        z: span.az + (span.bz - span.az) * t,
        facing: facing + (hashUnit(key, 10 + i) - 0.5) * 0.5,
        scale: SWALLOW_SPAN_M * (0.9 + hashUnit(key, 30 + i) * 0.2),
        delay: hashUnit(key, 50 + i) * 0.7,
        swerve: (hashUnit(key, 70 + i) * 2 - 1) * 0.8,
        phase: hashUnit(key, 90 + i) * Math.PI * 2,
      });
      t += (0.25 + hashUnit(key, 110 + i) * 0.9) / Math.hypot(span.bx - span.ax, span.bz - span.az);
    }
    perches.push({ key, x, z, birds });
  }
  return perches;
}

/** Vrai si l'observateur est assez près d'un des oiseaux de la portée pour la lever. */
export function flushes(perch, here) {
  return perch.birds.some((b) => Math.hypot(b.x - here.x, b.z - here.z) < SWALLOW_FLUSH_M);
}

function flightPoint(bird, away, t) {
  const heading = away + bird.swerve;
  const run = SWALLOW_SPEED_M_S * t;
  const side = 2.5 * Math.sin(2.4 * t + bird.phase) - 2.5 * Math.sin(bird.phase);
  const dx = Math.sin(heading);
  const dz = Math.cos(heading);
  return {
    x: bird.x + dx * run + dz * side,
    // La chute hors du fil, puis la remontée.
    y: bird.y - 2.2 * Math.sin(Math.PI * Math.min(1, t / 1.2)) + 9 * Math.max(0, 1 - Math.exp(-(t - 0.6) / 2)),
    z: bird.z + dz * run - dx * side,
  };
}

/**
 * Pose d'une hirondelle levée : `null` tant qu'elle n'est pas partie (elle est
 * encore sur le fil) ou une fois le vol fini. Pur.
 * @param {number} away Cap à l'opposé de l'observateur, fixé à l'envol.
 * @returns {{perched:boolean, x:number, y:number, z:number, heading:number, flap:number, size:number}|null}
 */
export function swallowAt(bird, away, start, time) {
  const elapsed = time - start;
  if (elapsed >= SWALLOW_FLIGHT_S) return null;
  const t = elapsed - bird.delay;
  if (t < 0) return { perched: true, x: bird.x, y: bird.y, z: bird.z, heading: bird.facing, flap: 1, size: 1 };
  const here = flightPoint(bird, away, t);
  const next = flightPoint(bird, away, t + 0.05);
  return {
    perched: false,
    ...here,
    heading: Math.atan2(next.x - here.x, next.z - here.z),
    flap: 0.25 + 0.75 * Math.abs(Math.sin(time * Math.PI * SWALLOW_FLAP_HZ + bird.phase)),
    size: Math.min(1, (SWALLOW_FLIGHT_S - elapsed) / 1.2),
  };
}

/**
 * Silhouette posée : deux losanges croisés, tête en haut, queue fourchue en
 * bas — un point sombre sur le fil sous tous les angles.
 */
export function createPerchedSwallowGeometry(THREE) {
  const h = 0.5;
  const w = 0.12;
  const positions = new Float32Array([
    // Plan de face.
    0, h, 0, -w, 0.18, 0, 0, -0.1, 0,
    0, h, 0, 0, -0.1, 0, w, 0.18, 0,
    -w * 0.6, -0.1, 0, 0, -h * 0.9, 0, w * 0.6, -0.1, 0,
    // Plan de profil.
    0, h, 0, 0, 0.18, -w, 0, -0.1, 0,
    0, h, 0, 0, -0.1, 0, 0, 0.18, w,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.name = 'swallow-perched';
  return geometry;
}
