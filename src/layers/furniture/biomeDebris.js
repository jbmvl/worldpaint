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
 * Portée volontairement plus courte que celle du reste du mobilier
 * (`FURNITURE_RADIUS_M` = 700 m, 154 ha) : à cette échelle, un objet par
 * hectare ferait déjà cent cinquante objets. Les densités de la table restent
 * entre 0,05 et 0,5 par hectare, et le rayon ici est celui d'un petit objet
 * qui ne se voit pas au-delà.
 */

import { pointInAreas } from '../settlement.js';
import { biomeDebrisKindFor, randomAt } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, BIOME_DEBRIS } from './catalog.js';

/** Portée du semis, en mètres — plus courte que celle du reste du mobilier. */
export const BIOME_DEBRIS_RADIUS_M = 300;
/** Pas de la grille, en mètres. */
export const BIOME_DEBRIS_CELL_M = 22;
/** Surface d'une maille, en hectares — `perHa` se compare à ce facteur près. */
const CELL_HA = (BIOME_DEBRIS_CELL_M * BIOME_DEBRIS_CELL_M) / 10000;

export function buildBiomeDebris(layer, context, builtUp) {
  const { here, placements } = context;
  const step = BIOME_DEBRIS_CELL_M;
  const startX = Math.floor((here.x - BIOME_DEBRIS_RADIUS_M) / step) * step;
  const startZ = Math.floor((here.z - BIOME_DEBRIS_RADIUS_M) / step) * step;
  let placed = 0;

  for (
    let z = startZ;
    z <= here.z + BIOME_DEBRIS_RADIUS_M && placed < FURNITURE_LIMITS.biomeDebris;
    z += step
  ) {
    for (
      let x = startX;
      x <= here.x + BIOME_DEBRIS_RADIUS_M && placed < FURNITURE_LIMITS.biomeDebris;
      x += step
    ) {
      const px = x + (randomAt(x, z, 461) - 0.5) * step * 0.9;
      const pz = z + (randomAt(x, z, 463) - 0.5) * step * 0.9;
      if (Math.hypot(px - here.x, pz - here.z) > BIOME_DEBRIS_RADIUS_M) continue;
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
  }
  layer.counts.biomeDebris = placed;
}
