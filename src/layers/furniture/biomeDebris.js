/*
 * biomeDebris — ce qui traîne sur un biome : blocs de lande, souches de bois,
 * joncs de marais, bois flotté de vasière et de sable.
 *
 * Même patron que `buildRocks` (landmarks.js) : une grille ancrée au monde,
 * un nombre de tirages constant par maille, refus du bâti et des chaussées,
 * plafond propre. La différence est que `buildRocks` décide de son objet à
 * partir de la pente et du sol nu (`rockKindFor`), tandis qu'ici c'est le nom
 * même de la matière (`groundClass.surfaceAt`) qui choisit la table à lire
 * (`BIOME_DEBRIS`, catalog.js) : chaque matière n'y porte que ce que sa fiche
 * de biome lui donne, et une matière absente de la table n'est simplement pas
 * concernée.
 *
 * Portée : celle du reste du mobilier (`FURNITURE_RADIUS_M`, 800 m, 200 ha).
 * Les densités de la table restent entre 0,05 et 0,5 par hectare ; le
 * plafond, s'il mord, coupe au bord (`gridCellsAround`).
 */

import { pointInAreas } from '../settlement.js';
import { biomeDebrisKindFor, randomAt, gridCellsAround } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, BIOME_DEBRIS } from './catalog.js';
import { reachedRadius } from '../../core/decorReach.js';

/** Portée du semis, en mètres (celle du reste du mobilier). */
export const BIOME_DEBRIS_RADIUS_M = FURNITURE_RADIUS_M;
/** Pas de la grille, en mètres. */
export const BIOME_DEBRIS_CELL_M = 22;
/** Surface d'une maille, en hectares — `perHa` se compare à ce facteur près. */
const CELL_HA = (BIOME_DEBRIS_CELL_M * BIOME_DEBRIS_CELL_M) / 10000;

export function buildBiomeDebris(layer, context, builtUp) {
  const { here, placements } = context;
  const step = BIOME_DEBRIS_CELL_M;
  let placed = 0;

  for (const { x, z } of gridCellsAround(here, reachedRadius(BIOME_DEBRIS_RADIUS_M, layer.bubble), step)) {
    if (placed >= FURNITURE_LIMITS.biomeDebris) break;
    const px = x + (randomAt(x, z, 461) - 0.5) * step * 0.9;
    const pz = z + (randomAt(x, z, 463) - 0.5) * step * 0.9;
    if (Math.hypot(px - here.x, pz - here.z) > reachedRadius(BIOME_DEBRIS_RADIUS_M, layer.bubble)) continue;
    if (pointInAreas(builtUp, px, pz)) continue;
    if (layer._onRoad(px, pz)) continue;

    const kind = layer.groundClass?.surfaceAt?.(px, pz);
    const table = kind ? BIOME_DEBRIS[kind] : null;
    if (!table) continue;

    const chosen = biomeDebrisKindFor(table, CELL_HA * table.perHa, randomAt(px, pz, 467));
    if (!chosen) continue;

    layer._place(placements, chosen.item, {
      x: px,
      z: pz,
      yaw: randomAt(px, pz, 469) * Math.PI * 2,
      scale: chosen.scale,
    });
    placed++;
  }
  layer.counts.biomeDebris = placed;
}
