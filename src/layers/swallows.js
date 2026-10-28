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
 * Une rangée peut aussi être **appelée** par l'application (`perchOnSpan`,
 * `spanToCall`) sur une portée que le tirage laisse vide : un événement, comme
 * la traversée d'une bête, oublié une fois la rangée envolée.
 *
 * L'envol n'est pas celui des étourneaux : elles ne font pas nuage, elles
 * s'égaillent. Chaque hirondelle part en vague depuis le bout de la rangée le
 * plus proche de l'observateur, se laisse tomber du fil dans le sens où elle
 * regarde, nez bas, accélère en virant à l'opposé de lui, incliné dans ses
 * virages, puis file en crochets, piqués et ressources, battues et glissés
 * alternés.
 *
 * Les silhouettes sont grossies de `SWALLOW_LOOK` : à taille vraie, une
 * hirondelle à cinquante mètres n'est qu'un point sur le fil.
 */

import { hashUnit, positionSeed } from '../core/groundSeed.js';

export const SWALLOW_MAX = 48;
export const SWALLOW_SPAN_ODDS = 0.036;
export const SWALLOW_PER_SPAN = [3, 10];
/** Au-delà, une hirondelle sur un fil n'est plus un pixel. */
export const SWALLOW_SEEN_M = 160;
export const SWALLOW_RESOW_M = 30;
export const SWALLOW_FLUSH_M = 30;
export const SWALLOW_REST_S = 300;
export const SWALLOW_FLIGHT_S = 9;
export const SWALLOW_SPEED_M_S = 14;
export const SWALLOW_LOOK = 2.2;
/** Envergure en vol, grossie : 33 cm en vrai. */
export const SWALLOW_SPAN_M = 0.33 * SWALLOW_LOOK;
export const SWALLOW_FLAP_HZ = 9;
const SALT = 7417;

/**
 * Cote du câble à la fraction `t` de la portée : entre les cotes publiées par
 * `appendOverheadLine` quand il y en a, sinon la corde et sa flèche.
 */
function wireY(span, t) {
  const h = span.heights;
  if (!h?.length) return span.ay + (span.by - span.ay) * t - span.sag * 4 * t * (1 - t);
  const f = Math.min(h.length - 1, Math.max(0, t * (h.length - 1)));
  const i = Math.min(h.length - 2, Math.floor(f));
  return h[i] + (h[i + 1] - h[i]) * (f - i);
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
    perches.push(perchOnSpan(frame, span));
  }
  return perches;
}

/**
 * La rangée d'oiseaux d'une portée, qu'elle soit habitée d'elle-même ou non :
 * pure, la même portée rend toujours la même rangée.
 * @returns {{key:number, x:number, z:number, birds:Array}}
 */
export function perchOnSpan(frame, span) {
  const x = (span.ax + span.bx) / 2;
  const z = (span.az + span.bz) / 2;
  const key = positionSeed(frame, x, z, SALT);
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
      along: t * Math.hypot(span.bx - span.ax, span.bz - span.az),
      scale: SWALLOW_SPAN_M * (0.9 + hashUnit(key, 30 + i) * 0.2),
      delay: hashUnit(key, 50 + i) * 0.35,
      swerve: (hashUnit(key, 70 + i) * 2 - 1) * 0.8,
      phase: hashUnit(key, 90 + i) * Math.PI * 2,
    });
    t += (0.45 + hashUnit(key, 110 + i) * 1.1) / Math.hypot(span.bx - span.ax, span.bz - span.az);
  }
  return { key, x, z, birds };
}

/**
 * La portée où appeler une rangée devant l'observateur : la plus proche hors
 * de la distance d'envol, pour qu'elle ne parte pas aussitôt posée ; à défaut,
 * la plus proche tout court. `null` sans ligne tendue.
 */
export function spanToCall(spans, here) {
  let best = null;
  let bestD = Infinity;
  let fallback = null;
  let fallbackD = Infinity;
  for (const span of spans ?? []) {
    const d = Math.hypot((span.ax + span.bx) / 2 - here.x, (span.az + span.bz) / 2 - here.z);
    if (d < fallbackD) { fallback = span; fallbackD = d; }
    if (d >= SWALLOW_FLUSH_M + 15 && d < bestD) { best = span; bestD = d; }
  }
  return best ?? fallback;
}

/** Vrai si l'observateur est assez près d'un des oiseaux de la portée pour la lever. */
export function flushes(perch, here) {
  return perch.birds.some((b) => Math.hypot(b.x - here.x, b.z - here.z) < SWALLOW_FLUSH_M);
}

/**
 * Lève une rangée : le cap à l'opposé de l'observateur, et d'où part la vague
 * — l'oiseau le plus proche de lui.
 * @returns {{start:number, wallClock:number, away:number, nearAlong:number}}
 */
export function launchSwallows(perch, here, time, wallClock) {
  let nearAlong = 0;
  let best = Infinity;
  for (const b of perch.birds) {
    const d = Math.hypot(b.x - here.x, b.z - here.z);
    if (d < best) { best = d; nearAlong = b.along ?? 0; }
  }
  return { start: time, wallClock, away: Math.atan2(perch.x - here.x, perch.z - here.z), nearAlong };
}

/** Secondes entre la levée de la rangée et le départ de cet oiseau. */
function departure(bird, flight) {
  return bird.delay + Math.abs((bird.along ?? 0) - (flight.nearAlong ?? 0)) * 0.09;
}

/** Écart d'angle ramené dans `[-π, π]`. */
function turn(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function headingAt(bird, away, t) {
  const target = turn(bird.facing, away + bird.swerve);
  // Deux ondes sans rapport entre elles : un crochet, pas un slalom.
  const weave = (0.38 * Math.sin(1.7 * t + bird.phase) + 0.22 * Math.sin(3.7 * t + 2.3 * bird.phase)) * Math.min(1, t / 1.2);
  return bird.facing + target * (1 - Math.exp(-t / 0.8)) + weave;
}

function speedAt(t) {
  return 3.5 + (SWALLOW_SPEED_M_S - 3.5) * (1 - Math.exp(-t / 0.7));
}

/** Vitesse verticale : la chute hors du fil, puis la remontée, en piqués et ressources. */
function climbAt(bird, t) {
  const swoop = (1.1 * Math.sin(1.9 * t + bird.phase) + 0.5 * Math.sin(4.3 * t + 2 * bird.phase)) * Math.min(1, t / 1.5);
  return -2.2 * Math.exp(-t / 0.3) + 1.6 * (1 - Math.exp(-t / 1)) + swoop;
}

/**
 * Position `t` secondes après le départ de l'oiseau, par intégration de sa
 * vitesse : il part lentement dans le sens où il regarde, en chute, puis
 * accélère, vire et remonte.
 */
function flightPoint(bird, away, t) {
  const step = 0.05;
  let x = bird.x;
  // Le corps en vol est centré : il part de la hauteur du corps posé, pas des pattes.
  let y = bird.y + 0.08 * SWALLOW_LOOK;
  let z = bird.z;
  for (let u = 0; u < t; u += step) {
    const dt = Math.min(step, t - u);
    const m = u + dt / 2;
    const heading = headingAt(bird, away, m);
    const speed = speedAt(m);
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    y += climbAt(bird, m) * dt;
  }
  return { x, y, z };
}

/** Élan avant le départ : l'oiseau bascule en avant sur ses pattes. */
const SWALLOW_LEAN_S = 0.25;

/**
 * Pose d'une hirondelle levée : sur le fil tant qu'elle n'est pas partie,
 * `null` une fois le vol fini. Pur.
 *
 * `pitch` (nez levé positif) suit la pente du vol, `roll` l'inclinaison d'un
 * virage coordonné (la plus haute aile à l'extérieur) ; `wing` est la position
 * des ailes, de -1 (basses) à 1 (hautes).
 * @param {{start:number, away:number, nearAlong?:number}} flight Voir `launchSwallows`.
 * @returns {{perched:boolean, x:number, y:number, z:number, heading:number, pitch:number, roll:number, wing:number, size:number}|null}
 */
export function swallowAt(bird, flight, time) {
  const elapsed = time - flight.start;
  if (elapsed >= SWALLOW_FLIGHT_S) return null;
  const t = elapsed - departure(bird, flight);
  if (t < 0) {
    const lean = Math.max(0, 1 + t / SWALLOW_LEAN_S);
    return { perched: true, x: bird.x, y: bird.y, z: bird.z, heading: bird.facing, pitch: -0.55 * lean, roll: 0, wing: 0, size: 1 };
  }
  const here = flightPoint(bird, flight.away, t);
  const speed = speedAt(t);
  const turning = (headingAt(bird, flight.away, t + 0.05) - headingAt(bird, flight.away, Math.max(0, t - 0.05))) / (t < 0.05 ? t + 0.05 : 0.1);
  // Battues soutenues au départ, puis des glissés ailes tenues un peu hautes.
  const gliding = t > 1 && Math.sin(1.6 * t + bird.phase * 2) < -0.3;
  return {
    perched: false,
    ...here,
    heading: headingAt(bird, flight.away, t),
    pitch: Math.atan2(climbAt(bird, t), speed),
    roll: Math.max(-0.9, Math.min(0.9, Math.atan((speed * turning) / 9.81))),
    // Premier coup d'aile depuis le haut, puis chacune à son rythme.
    wing: gliding ? 0.3 : Math.cos(2 * Math.PI * SWALLOW_FLAP_HZ * t + bird.phase * Math.min(1, t)),
    size: Math.min(1, (SWALLOW_FLIGHT_S - elapsed) / 0.5),
  };
}

/** Assemble une liste de triangles, coordonnées en mètres multipliées par `k`. */
function triangles(THREE, list, k, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.flat(2).map((v) => v * k)), 3));
  geometry.computeVertexNormals();
  geometry.name = name;
  return geometry;
}

/**
 * Silhouette posée, pattes à l'origine sur le fil, bec vers +z : tête et bec,
 * corps incliné, ailes repliées qui dépassent le croupion, queue fourchue qui
 * pend sous le fil. Taille vraie (18 cm du bec au bout de la queue) grossie de
 * `SWALLOW_LOOK` ; à l'échelle 1 pour un oiseau d'envergure `SWALLOW_SPAN_M`.
 */
export function createPerchedSwallowGeometry(THREE) {
  const top = [0, 0.095, 0.035], beak = [0, 0.07, 0.072], chin = [0, 0.055, 0.042], nape = [0, 0.074, 0.008];
  const cheekL = [-0.018, 0.074, 0.032], cheekR = [0.018, 0.074, 0.032];
  const breast = [0, 0.045, 0.036], rump = [0, 0.028, -0.05], back = [0, 0.066, -0.004], belly = [0, 0.002, 0];
  const flankL = [-0.025, 0.036, -0.004], flankR = [0.025, 0.036, -0.004];
  const baseL = [-0.012, 0.028, -0.044], baseR = [0.012, 0.028, -0.044];
  const notch = [0, 0.002, -0.088], forkL = [-0.024, -0.032, -0.135], forkR = [0.024, -0.032, -0.135];
  const wing = (s) => {
    const shoulder = [s * 0.027, 0.056, 0.02], low = [s * 0.025, 0.02, -0.02], ridge = [s * 0.013, 0.057, -0.035], tip = [s * 0.012, -0.006, -0.118];
    return [[shoulder, low, tip], [shoulder, tip, ridge]];
  };
  return triangles(THREE, [
    [top, cheekL, beak], [top, beak, cheekR], [top, cheekR, nape], [top, nape, cheekL],
    [chin, beak, cheekL], [chin, cheekR, beak], [chin, cheekL, nape], [chin, nape, cheekR],
    [breast, back, flankL], [breast, flankR, back], [breast, belly, flankR], [breast, flankL, belly],
    [rump, flankL, back], [rump, back, flankR], [rump, flankR, belly], [rump, belly, flankL],
    [baseL, baseR, notch], [baseL, notch, forkL], [baseR, forkR, notch],
    ...wing(-1), ...wing(1),
  ], SWALLOW_LOOK, 'swallow-perched');
}

/**
 * Silhouette en vol, envergure 1, bec vers +z : ailes en faux rejetées en
 * arrière et queue fourchue — ce qui distingue une hirondelle d'un passereau
 * quelconque. Seules les ailes ont du relief en y : l'échelle y de l'instance
 * les fait battre, de haut (positive) en bas (négative), corps et queue fixes.
 */
export function createFlyingSwallowGeometry(THREE) {
  const wing = (s) => {
    const front = [0, 0, 0.07], elbow = [s * 0.22, 0.04, 0.05], tip = [s * 0.5, 0.1, -0.15], rear = [0, 0, -0.06];
    return [[front, elbow, rear], [elbow, tip, rear]];
  };
  const baseL = [-0.03, 0, -0.05], baseR = [0.03, 0, -0.05], notch = [0, 0, -0.17];
  return triangles(THREE, [
    [[0, 0, 0.17], [-0.035, 0, 0.04], [0.035, 0, 0.04]],
    ...wing(-1), ...wing(1),
    [baseL, baseR, notch], [baseL, notch, [-0.09, 0, -0.32]], [baseR, [0.09, 0, -0.32], notch],
  ], 1, 'swallow');
}
