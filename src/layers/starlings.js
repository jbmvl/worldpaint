/*
 * starlings — un vol d'étourneaux qui jaillit d'un bois quand on s'en approche.
 * -------------------------------------------------------------------------
 * Le dortoir est **ancré au sol** et composé par le mobilier
 * (`furniture/roosts.js`) : à la lisière d'un bois, face à la route la plus
 * proche. L'observateur ne fait que le déclencher en passant à moins de
 * `STARLING_TRIGGER_M` du point de cette route qui lui fait face ; un dortoir
 * levé ne se relève pas avant `STARLING_REST_S`.
 *
 * Le vol lui-même est un centre qui s'éloigne de l'observateur en montant, et
 * autour duquel chaque oiseau garde sa place dans un nuage aplati qui se
 * déploie à l'envol puis respire — c'est cette respiration, décalée d'un
 * oiseau à l'autre selon sa place, qui fait l'onde d'une murmuration.
 */

import { hashUnit } from '../core/groundSeed.js';

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
