/*
 * roosts — les dortoirs d'étourneaux, adossés à la route.
 * -------------------------------------------------------
 * Un vol d'étourneaux n'existe que pour être vu se lever, et le décor est
 * regardé depuis la route : comme les troupeaux (`roadwardFocus`), le dortoir
 * se pose à la lisière du bois qui fait face à la chaussée la plus proche, et
 * se lève quand l'observateur passe au point de la route qui lui fait face.
 * Un bois sans route à `ROOST_ROAD_REACH_M` n'en porte pas.
 *
 * Une maille mondiale de `ROOST_CELL_M` sur quelques-unes porte un dortoir,
 * toujours la même ; le point vient de tirages dans la maille et de la route
 * la plus proche, jamais de l'observateur. `lifeLayer` ne fait que le jouer.
 */

import { cellRandomAt, randomAt, worldCellsAround } from '../../core/groundSeed.js';
import { reachedRadius } from '../../core/decorReach.js';
import { FURNITURE_RADIUS_M } from './catalog.js';

export const ROOST_CELL_M = 120;
export const ROOST_ODDS = 0.07;
export const ROOST_WOOD_MIN = 0.45;
/** Au-delà, le vol se lèverait trop loin pour être vu de la route. */
export const ROOST_ROAD_REACH_M = 150;
const ROOST_DRAWS = 8;
const EDGE_STEP_M = 4;
const SALT = 9311;

/**
 * Le dortoir d'une maille, ou `null`. Pur, à `woodAt` et `nearestRoad` près.
 * @param {(x:number, z:number, radius:number) => {x:number,z:number}|null} nearestRoad
 * @returns {{x:number, z:number, roadX:number, roadZ:number, seed:number}|null}
 */
export function roostInCell(frame, cell, woodAt, nearestRoad) {
  const cx = cell.x + cell.size / 2;
  const cz = cell.z + cell.size / 2;
  if (cellRandomAt(frame, cx, cz, ROOST_CELL_M, SALT) >= ROOST_ODDS) return null;
  // Le point boisé de la maille le plus proche d'une route.
  let best = null;
  for (let k = 0; k < ROOST_DRAWS; k++) {
    const x = cell.x + randomAt(frame, cx, cz, SALT + 1 + 2 * k) * cell.size;
    const z = cell.z + randomAt(frame, cx, cz, SALT + 2 + 2 * k) * cell.size;
    if (!(woodAt(x, z) >= ROOST_WOOD_MIN)) continue;
    const road = nearestRoad(x, z, ROOST_ROAD_REACH_M);
    if (road && (!best || road.distance < best.road.distance)) best = { x, z, road };
  }
  if (!best) return null;
  // Jusqu'à la lisière, vers la route : c'est de là qu'on les voit partir.
  const { road } = best;
  const run = Math.hypot(road.x - best.x, road.z - best.z);
  let { x, z } = best;
  for (let d = EDGE_STEP_M; d < run; d += EDGE_STEP_M) {
    const nx = best.x + ((road.x - best.x) / run) * d;
    const nz = best.z + ((road.z - best.z) / run) * d;
    if (!(woodAt(nx, nz) >= ROOST_WOOD_MIN)) break;
    x = nx;
    z = nz;
  }
  return { x, z, roadX: road.x, roadZ: road.z, seed: randomAt(frame, cx, cz, SALT + 3) };
}

/** Publie dans `layer.roosts` les dortoirs à portée du mobilier. */
export function buildRoosts(layer, context) {
  const { frame } = layer.bubble;
  const woodAt = (x, z) => layer.groundClass?.woodAt?.(x, z) ?? 0;
  const nearestRoad = (x, z, radius) => layer._roadIndex?.nearestWithin?.(x, z, radius) ?? null;
  const radius = reachedRadius(FURNITURE_RADIUS_M, layer.bubble);
  for (const cell of worldCellsAround(frame, context.here, radius, ROOST_CELL_M)) {
    const roost = roostInCell(frame, cell, woodAt, nearestRoad);
    if (roost) layer.roosts.push({ key: `${cell.row}:${cell.id}`, ...roost });
  }
}
