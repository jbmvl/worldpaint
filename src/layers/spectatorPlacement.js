/*
 * spectatorPlacement — où se tient un groupe de spectateurs.
 * ----------------------------------------------------------
 * Comme `faunaCrossing`, c'est un événement : l'application le demande, le
 * décor ne le retrouvera pas au passage suivant. Mais là où la bête traverse
 * le regard, les spectateurs se rangent **le long de la route** — sur
 * l'accotement, face à la chaussée, jamais dessus. Chacun est reposé sur le
 * bord par `platformSideAt` à sa propre abscisse, ce qui leur fait suivre un
 * virage au lieu de s'aligner sur sa corde.
 *
 * Ici on décide de ce qui existe ; `spectatorLayer` ne fait plus que le jouer.
 */

import { seededUnit } from '../models/kit.js';
import { platformSideAt } from './roadNetwork.js';

/** Plafond d'un groupe : au-delà, c'est une foule, et ce n'est plus le même coût. */
export const CHEER_MAX = 24;
/** Premier rang : de quoi ne pas avoir les pieds sur le bitume. */
const FRONT_ROW_M = 0.6;
/** Profondeur au-delà du premier rang, en mètres. */
const DEPTH_M = 1.6;
/** Portée de la recherche de chaussée autour de chaque spectateur. */
const SNAP_RADIUS_M = 12;

/**
 * Compose un groupe de spectateurs au bord de la route la plus proche de
 * `(x, z)` — ou `[]` si aucune chaussée n'est à portée.
 *
 * @param {Object} options
 * @param {Object} options.roads Réseau routier (`elevationIndex`).
 * @param {(x:number, z:number) => number} options.groundAt Altitude du sol, en unités de scène.
 * @param {number} options.x
 * @param {number} options.z
 * @param {{x:number, z:number}|null} [options.ahead] Sens de marche : fixe le côté `1`/`-1`.
 * @param {number} [options.count]
 * @param {number} [options.side] `1` à droite, `-1` à gauche, `0` des deux côtés.
 * @param {number} [options.spreadM] Longueur de route occupée, en mètres.
 * @param {number} options.seed Graine, tirée d'une position au sol quantifiée.
 * @param {number} options.outfits Nombre de tenues disponibles.
 * @returns {Array<{x:number, y:number, z:number, yaw:number, outfit:number,
 *          phase:number, rate:number, arms:number}>} `arms` : 0 bras le long
 *          du corps, 1 un bras levé, 2 les deux.
 */
export function planCheer({
  roads,
  groundAt,
  x,
  z,
  ahead = null,
  count = 8,
  side = 0,
  spreadM = 14,
  seed,
  outfits,
}) {
  const centre = platformSideAt(roads, x, z, { ahead, radius: SNAP_RADIUS_M * 2 });
  if (!centre) return [];
  const tangent = centre.tangent;
  const draw = seededUnit(seed);
  const people = [];

  for (let i = 0; i < Math.min(count, CHEER_MAX); i++) {
    const along = (count > 1 ? i / (count - 1) - 0.5 : 0) * spreadM + (draw() - 0.5) * 1.2;
    const own = side === 0 ? (draw() < 0.5 ? -1 : 1) : Math.sign(side);
    const px = centre.axis.x + tangent.x * along;
    const pz = centre.axis.z + tangent.z * along;
    const edge = platformSideAt(roads, px, pz, {
      side: own,
      offset: FRONT_ROW_M + draw() * DEPTH_M,
      ahead: tangent,
      radius: SNAP_RADIUS_M,
    });
    if (!edge) continue;
    people.push({
      x: edge.x,
      y: groundAt(edge.x, edge.z),
      z: edge.z,
      // Face à la chaussée : +Z du modèle tourné vers l'axe (−normale).
      yaw: Math.atan2(-edge.normal.x, -edge.normal.z) + (draw() - 0.5) * 0.7,
      outfit: Math.floor(draw() * outfits),
      phase: draw() * Math.PI * 2,
      rate: 0.8 + draw() * 0.6,
      arms: draw() < 0.25 ? 1 : 2,
    });
  }
  return people;
}
