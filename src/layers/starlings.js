/*
 * starlings — un vol d'étourneaux qui jaillit d'un bois quand on s'en approche.
 * -------------------------------------------------------------------------
 * Le dortoir est **ancré au sol** et composé par le mobilier
 * (`furniture/roosts.js`) : à la lisière d'un bois, face à la route la plus
 * proche. L'observateur ne fait que le déclencher en passant à moins de
 * `STARLING_TRIGGER_M` du point de cette route qui lui fait face ; un dortoir
 * levé ne se relève pas avant `STARLING_REST_S`.
 *
 * Un vol peut aussi être **levé** par l'application (`treeToRaise`) d'une
 * lisière devant l'observateur : un événement, oublié une fois le vol fini.
 *
 * Le vol lui-même est un centre qui s'éloigne de l'observateur en montant, et
 * autour duquel chaque oiseau garde sa place dans un nuage aplati qui se
 * déploie à l'envol puis respire — c'est cette respiration, décalée d'un
 * oiseau à l'autre selon sa place, qui fait l'onde d'une murmuration.
 */

import { hashUnit, randomAt } from '../core/groundSeed.js';

export const STARLING_COUNT = 48;
export const STARLING_TRIGGER_M = 45;
export const STARLING_REST_S = 600;
export const STARLING_FLIGHT_S = 14;
/** Hauteur de la cime d'où ils sortent, au-dessus du sol. */
export const STARLING_CANOPY_M = 11;
export const STARLING_SPEED_M_S = 9;
export const STARLING_CLIMB_M = 22;
export const STARLING_SPAN_M = 0.6;
export const STARLING_FLAP_HZ = 11;
const SALT = 9311;

/**
 * Le dortoir dont le point de route est le plus proche de `here`, à portée de
 * déclenchement, ou `null`. Pur.
 * @param {Array<{key:string, x:number, z:number, roadX:number, roadZ:number, seed:number}>} roosts
 */
export function roostNear(roosts, here) {
  let best = null;
  let bestDistance = STARLING_TRIGGER_M;
  for (const roost of roosts ?? []) {
    const d = Math.hypot(roost.roadX - here.x, roost.roadZ - here.z);
    if (d <= bestDistance) {
      best = roost;
      bestDistance = d;
    }
  }
  return best;
}

/** Rayon où l'application va chercher un arbre d'où lever un vol. */
export const STARLING_CALL_M = 450;
const CALL_STEP_M = 10;
const CALL_MIN_M = 35;

/**
 * Où lever un vol à la demande : le dortoir le plus proche s'il y en a un à
 * portée, sinon la lisière boisée la plus proche, de préférence dans le regard
 * (`forward`, à plat), sinon le bois le plus proche. `null` sans bois à portée.
 * @param {(x:number, z:number) => number} woodAt Part de bois, de 0 à 1.
 * @returns {{x:number, z:number, seed:number}|null}
 */
export function treeToRaise(frame, here, { woodAt, roosts, forward = null } = {}) {
  let roost = null;
  for (const r of roosts ?? []) {
    const d = Math.hypot(r.x - here.x, r.z - here.z);
    if (d >= CALL_MIN_M && d <= STARLING_CALL_M && (!roost || d < roost.d)) roost = { r, d };
  }
  if (roost) return { x: roost.r.x, z: roost.r.z, seed: roost.r.seed };
  if (!woodAt) return null;
  const length = forward ? Math.hypot(forward.x, forward.z) : 0;
  let best = null;
  for (let dx = -STARLING_CALL_M; dx <= STARLING_CALL_M; dx += CALL_STEP_M) {
    for (let dz = -STARLING_CALL_M; dz <= STARLING_CALL_M; dz += CALL_STEP_M) {
      const d = Math.hypot(dx, dz);
      if (d < CALL_MIN_M || d > STARLING_CALL_M) continue;
      const x = here.x + dx;
      const z = here.z + dz;
      if (!(woodAt(x, z) >= 0.5)) continue;
      // Une lisière : un vol qui sort du cœur d'un bois ne se voit pas partir.
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([u, v]) => woodAt(x + u * 12, z + v * 12) < 0.2);
      const ahead = length > 0 && (dx * forward.x + dz * forward.z) / (d * length) > 0.5;
      const rank = (edge ? 0 : 2) + (ahead ? 0 : 1);
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { x, z, d, rank };
    }
  }
  return best ? { x: best.x, z: best.z, seed: randomAt(frame, best.x, best.z, SALT) } : null;
}

/**
 * Le vol levé d'un dortoir : part à l'opposé de l'observateur, à un écart
 * près tiré du dortoir.
 */
export function launchFlock(roost, ground, from, time) {
  const away = Math.atan2(roost.x - from.x, roost.z - from.z);
  return {
    start: time,
    x: roost.x,
    y: ground + STARLING_CANOPY_M,
    z: roost.z,
    heading: away + (roost.seed * 2 - 1) * 0.7,
    swirl: roost.seed * Math.PI * 2,
  };
}

/** Place propre de chaque oiseau dans le nuage, et son retard à l'envol. */
export function buildStarlings() {
  const birds = [];
  for (let i = 0; i < STARLING_COUNT; i++) {
    const r = (k) => hashUnit(i, SALT + 10 + k);
    // Point d'une boule, aplatie : un vol s'étale plus qu'il ne s'empile.
    const u = r(0) * 2 - 1;
    const a = r(1) * Math.PI * 2;
    const s = Math.cbrt(r(2));
    const h = Math.sqrt(1 - u * u);
    birds.push({
      ox: h * Math.cos(a) * s,
      oy: u * s * 0.45,
      oz: h * Math.sin(a) * s,
      delay: r(3) * 1.6,
      beat: 0.85 + r(4) * 0.3,
      phase: r(5) * Math.PI * 2,
      scale: STARLING_SPAN_M * (0.85 + r(6) * 0.3),
    });
  }
  return birds;
}

function flockCentre(flock, t) {
  const dx = Math.sin(flock.heading);
  const dz = Math.cos(flock.heading);
  const run = STARLING_SPEED_M_S * t;
  const side = 14 * Math.sin(0.4 * t + flock.swirl) - 14 * Math.sin(flock.swirl);
  return {
    x: flock.x + dx * run + dz * side,
    y: flock.y + STARLING_CLIMB_M * (1 - Math.exp(-t / 3)) + 3 * Math.sin(0.7 * t + flock.swirl),
    z: flock.z + dz * run - dx * side,
  };
}

function birdPoint(bird, flock, t) {
  const c = flockCentre(flock, t);
  // Le nuage se déploie hors de la cime, puis respire en onde.
  const spread = 1 + 9 * (1 - Math.exp(-t / 1.4));
  const breath = 1 + 0.3 * Math.sin(1.1 * t - bird.ox * 2.5 + flock.swirl);
  const k = spread * breath;
  return { x: c.x + bird.ox * k, y: c.y + bird.oy * k, z: c.z + bird.oz * k * 0.8 };
}

/**
 * Position, cap, battement et taille apparente d'un étourneau, ou `null` s'il
 * est encore dans l'arbre ou si le vol est fini. Pur.
 * @returns {{x:number,y:number,z:number,heading:number,flap:number,size:number}|null}
 */
export function starlingAt(bird, flock, time) {
  const t = time - flock.start - bird.delay;
  if (t < 0 || time - flock.start >= STARLING_FLIGHT_S) return null;
  const here = birdPoint(bird, flock, t);
  const next = birdPoint(bird, flock, t + 0.05);
  const left = STARLING_FLIGHT_S - (time - flock.start);
  return {
    ...here,
    heading: Math.atan2(next.x - here.x, next.z - here.z),
    flap: 0.3 + 0.7 * Math.abs(Math.sin(time * Math.PI * STARLING_FLAP_HZ * bird.beat + bird.phase)),
    // Sort de la cime en grandissant, s'efface au loin.
    size: Math.min(1, t / 0.4, left / 1.5),
  };
}
