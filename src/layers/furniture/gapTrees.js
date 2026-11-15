/*
 * gapTrees — l'arbre isolé posé dans le trou : un olivier au milieu du chaume,
 * un chêne vert sur l'herbe sèche. Ni bois, ni verger, ni alignement.
 *
 * La densité est celle du sol du pays (`SOIL_LOOK[matrix].scatteredTreesPerHa`,
 * absente = aucun) ; l'essence se tire dans `region.trees`, aux parts du rang,
 * comme tout arbre planté. Un arbre ne se pose que là où la carte se tait et
 * en pente douce : pas sur le versant cédé à la broussaille, pas dans un champ
 * relevé, ni sur l'emprise d'une route, ni contre un bâtiment.
 */

import { randomAt, worldCellsAround } from '../../core/groundSeed.js';
import { reachedRadius } from '../../core/decorReach.js';
import { pickShare } from '../furniturePlacement.js';
import { plantedSpeciesShares } from '../plantedTrees.js';
import { pointInAreas } from '../settlement.js';
import { FURNITURE_LIMITS, PLANTED_TREE } from './catalog.js';

/** Côté de la maille mondiale qui porte au plus un arbre, en mètres. */
export const GAP_TREE_CELL_M = 60;
/** Portée du semis, en mètres. */
export const GAP_TREE_RADIUS_M = 1600;
/** Écart laissé à un bâtiment : cour, accès. */
export const GAP_TREE_CLEARANCE_M = 25;

/** Part des mailles qui portent un arbre, pour une densité à l'hectare. Pure. */
export function gapTreeChance(perHa, cellM = GAP_TREE_CELL_M) {
  return perHa > 0 ? Math.min(1, (perHa * cellM * cellM) / 10000) : 0;
}

/**
 * L'arbre d'une maille mondiale (`{ x, z, size }`), ou `null`. Tout se tire de
 * la position au sol : deux observateurs le retrouvent au même endroit.
 *
 * @param {Array} mix Parts d'essences (`plantedSpeciesShares`).
 */
export function gapTreeIn(frame, cell, chance, mix) {
  if (!mix.length || randomAt(frame, cell.x, cell.z, 191) >= chance) return null;
  const x = cell.x + (0.1 + 0.8 * randomAt(frame, cell.x, cell.z, 192)) * cell.size;
  const z = cell.z + (0.1 + 0.8 * randomAt(frame, cell.x, cell.z, 193)) * cell.size;
  return {
    x,
    z,
    species: pickShare(mix, randomAt(frame, x, z, 194)),
    yaw: randomAt(frame, x, z, 195) * Math.PI * 2,
    scale: 0.8 + randomAt(frame, x, z, 196) * 0.5,
  };
}

export function buildGapTrees(layer, context, builtUp) {
  const perHa = layer.theme.soils?.[layer.region?.matrix]?.scatteredTreesPerHa ?? 0;
  const chance = gapTreeChance(perHa);
  const ground = layer.groundClass;
  if (chance <= 0 || !ground?.surfaceAt) return 0;
  const mix = plantedSpeciesShares(layer.region?.trees, layer.theme.trees);
  if (!mix.length) return 0;

  const { frame } = layer.bubble;
  const { here, placements } = context;
  const radius = reachedRadius(Math.min(GAP_TREE_RADIUS_M, layer.bubble.radiusMeters || GAP_TREE_RADIUS_M), layer.bubble);
  let placed = 0;
  for (const cell of worldCellsAround(frame, here, radius, GAP_TREE_CELL_M)) {
    // Un plafond atteint arrête le semis au bord de la portée : les mailles
    // sont triées par distance.
    if (placed >= FURNITURE_LIMITS.gapTrees) break;
    const tree = gapTreeIn(frame, cell, chance, mix);
    if (!tree) continue;
    const { x, z } = tree;
    if (Math.hypot(x - here.x, z - here.z) > radius) continue;
    if (!ground.hasDataAt?.(x, z) || ground.surfaceAt(x, z) !== null) continue;
    if (ground.steepGapAt?.(x, z)) continue;
    if (pointInAreas(builtUp, x, z) || layer._onRoad(x, z)) continue;
    if (layer._fabric?.countWithin(x, z, GAP_TREE_CLEARANCE_M, 1) > 0) continue;
    const pose = layer._place(placements, PLANTED_TREE, { x, z, yaw: tree.yaw, scale: tree.scale });
    if (!pose) continue;
    pose.species = tree.species;
    placed++;
  }
  return placed;
}
