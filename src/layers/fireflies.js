/*
 * fireflies — les lucioles des sous-bois, la nuit.
 * ------------------------------------------------
 * Contrairement aux vols du ciel, elles sont **ancrées au sol** : on marche
 * parmi elles, on les dépasse, on les retrouve au même endroit en revenant.
 * Elles se sèment donc sur la grille mondiale (`worldCellsAround`), une
 * luciole au plus par maille, là où la carte du sol dit du bois — jamais
 * d'après la position de l'observateur, qui ne fait que borner la portée.
 *
 * Le semis ne se refait que lorsque l'observateur a franchi `FIREFLY_RESOW_M` ;
 * entre deux, une image ne coûte qu'une matrice par luciole.
 */

import { cellRandomAt, randomAt, worldCellsAround } from '../core/groundSeed.js';

export const FIREFLY_REACH_M = 45;
export const FIREFLY_CELL_M = 4;
/** Part des mailles boisées qui portent une luciole. */
export const FIREFLY_ODDS = 0.4;
/** Part de bois sous laquelle une maille n'en porte pas : une haie, une lisière lâche. */
export const FIREFLY_WOOD_MIN = 0.5;
export const FIREFLY_MAX = 180;
export const FIREFLY_RESOW_M = 4;
export const FIREFLY_HEIGHT_MIN = 0.3;
export const FIREFLY_HEIGHT_MAX = 2.2;
export const FIREFLY_SIZE_M = 0.22;
/** Errance autour du point de semis, en mètres. */
export const FIREFLY_WANDER_M = 0.9;
const SALT = 8209;

/**
 * Les lucioles de la portée, de la plus proche à la plus lointaine : un
 * plafond atteint coupe au bord de la portée. Pur, à `woodAt` et
 * `elevationAt` près.
 *
 * @param {Object} frame Repère local (`groundSeed`).
 * @param {{x:number,z:number}} here
 * @param {(x:number,z:number)=>number} woodAt Part de bois, de 0 à 1.
 * @param {(x:number,z:number)=>number} elevationAt Cote du sol, en scène.
 */
export function sowFireflies(frame, here, woodAt, elevationAt) {
  const flies = [];
  for (const cell of worldCellsAround(frame, here, FIREFLY_REACH_M, FIREFLY_CELL_M)) {
    if (cell.distance > FIREFLY_REACH_M) break;
    const cx = cell.x + cell.size / 2;
    const cz = cell.z + cell.size / 2;
    if (cellRandomAt(frame, cx, cz, FIREFLY_CELL_M, SALT) >= FIREFLY_ODDS) continue;
    const x = cell.x + randomAt(frame, cx, cz, SALT + 1) * cell.size;
    const z = cell.z + randomAt(frame, cx, cz, SALT + 2) * cell.size;
    if (!(woodAt(x, z) >= FIREFLY_WOOD_MIN)) continue;
    const ground = elevationAt(x, z);
    if (!Number.isFinite(ground)) continue;
    const r = (k) => randomAt(frame, cx, cz, SALT + 3 + k);
    flies.push({
      x,
      z,
      y: ground + FIREFLY_HEIGHT_MIN + r(0) * (FIREFLY_HEIGHT_MAX - FIREFLY_HEIGHT_MIN),
      period: 2.5 + r(1) * 3.5,
      phase: r(2),
      drift: r(3) * Math.PI * 2,
      size: FIREFLY_SIZE_M * (0.8 + r(4) * 0.4),
    });
    if (flies.length >= FIREFLY_MAX) break;
  }
  return flies;
}

/**
 * Position et éclat d'une luciole. Pur.
 * L'éclat est un bref pic par période : une luciole est surtout éteinte.
 * @returns {{x:number,y:number,z:number,glow:number}}
 */
export function fireflyAt(fly, time) {
  const t = time + fly.drift * 3;
  const cycle = (time / fly.period + fly.phase) % 1;
  const pulse = cycle < 0.18 ? Math.sin((cycle / 0.18) * Math.PI) : 0;
  return {
    x: fly.x + FIREFLY_WANDER_M * Math.sin(t * 0.37 + fly.drift),
    y: fly.y + 0.35 * Math.sin(t * 0.53 + fly.drift * 2),
    z: fly.z + FIREFLY_WANDER_M * Math.cos(t * 0.29 + fly.drift * 3),
    glow: pulse,
  };
}
