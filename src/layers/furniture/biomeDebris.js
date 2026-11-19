import { finishGeneration } from '../../core/generationSteps.js';
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
 * Les plantes naturalisées du pays (`naturalized` du dossier de région) se
 * sèment sur la même grille, sur la matière de la matrice et celle qu'elle
 * cède en pente, avec leur propre plafond : l'un atteint n'arrête pas l'autre.
 *
 * Portée : celle du reste du mobilier (`FURNITURE_RADIUS_M`, 800 m, 200 ha).
 * Les densités de la table restent entre 0,05 et 0,5 par hectare ; le
 * plafond, s'il mord, coupe au bord (`gridCellsAround`).
 */

import { pointInAreas } from '../settlement.js';
import { biomeDebrisKindFor, naturalizedScale } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, BIOME_DEBRIS, NATURALIZED_SOWING } from './catalog.js';
import { NATURALIZED_KINDS, surfaceForMatrix, gapSteepSurfaceForMatrix } from '../../core/regionInterpretation.js';
import { reachedRadius } from '../../core/decorReach.js';
import { randomAt, worldCellsAround } from '../../core/groundSeed.js';

/** Portée du semis, en mètres (celle du reste du mobilier). */
export const BIOME_DEBRIS_RADIUS_M = FURNITURE_RADIUS_M;
/** Pas de la grille, en mètres. */
export const BIOME_DEBRIS_CELL_M = 22;
/** Surface d'une maille, en hectares — `perHa` se compare à ce facteur près. */
const CELL_HA = (BIOME_DEBRIS_CELL_M * BIOME_DEBRIS_CELL_M) / 10000;

export function buildBiomeDebris(layer, context, builtUp) {
  return finishGeneration(buildBiomeDebrisSteps(layer, context, builtUp));
}

export function* buildBiomeDebrisSteps(layer, context, builtUp) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  const step = BIOME_DEBRIS_CELL_M;
  let placed = 0, sown = 0, visited = 0;
  const wild = naturalizedSowing(layer.region);

  for (const { x, z } of worldCellsAround(frame, here, reachedRadius(BIOME_DEBRIS_RADIUS_M, layer.bubble), step)) {
    if (++visited % 32 === 0) yield;
    const debrisFull = placed >= FURNITURE_LIMITS.biomeDebris;
    const wildFull = !wild || sown >= FURNITURE_LIMITS.naturalized;
    if (debrisFull && wildFull) break;
    const px = x + (randomAt(frame, x, z, 461) - 0.5) * step * 0.9;
    const pz = z + (randomAt(frame, x, z, 463) - 0.5) * step * 0.9;
    if (Math.hypot(px - here.x, pz - here.z) > reachedRadius(BIOME_DEBRIS_RADIUS_M, layer.bubble)) continue;
    if (pointInAreas(builtUp, px, pz)) continue;
    if (layer._onRoad(px, pz)) continue;

    const kind = layer.groundClass?.surfaceAt?.(px, pz);
    // La pâture du pays est surtout le trou que la matrice remplit : `coverAt`.
    if (!wildFull && wild.surfaces.has(kind ?? layer.groundClass?.coverAt?.(px, pz))) {
      const draw = randomAt(frame, px, pz, 467);
      const pick = wild.items.find((w) => draw < w.upTo);
      if (pick) {
        layer._place(placements, pick.item, {
          x: px,
          z: pz,
          yaw: randomAt(frame, px, pz, 469) * Math.PI * 2,
          scale: naturalizedScale(pick.scale, randomAt(frame, px, pz, 471)),
        });
        sown++;
        continue;
      }
    }
    const table = !debrisFull && kind ? BIOME_DEBRIS[kind] : null;
    if (!table) continue;

    const chosen = biomeDebrisKindFor(table, CELL_HA * table.perHa, randomAt(frame, px, pz, 467));
    if (!chosen) continue;

    layer._place(placements, chosen.item, {
      x: px,
      z: pz,
      yaw: randomAt(frame, px, pz, 469) * Math.PI * 2,
      scale: chosen.scale,
    });
    placed++;
  }
  layer.counts.biomeDebris = placed;
  layer.counts.naturalized = sown;
}

/**
 * Ce que le pays sème en sauvage : les matières de sa matrice (à plat et en
 * pente), et ses formes avec la borne cumulée de leur tirage par maille.
 * `null` s'il n'en déclare pas.
 */
export function naturalizedSowing(region) {
  const surface = surfaceForMatrix(region?.matrix);
  if (!surface || !region.naturalized?.length) return null;
  const items = [];
  let upTo = 0;
  for (const word of region.naturalized) {
    for (const item of NATURALIZED_KINDS[word]?.items ?? []) {
      const sowing = NATURALIZED_SOWING[item];
      if (!sowing) continue;
      upTo += CELL_HA * sowing.perHa;
      items.push({ item, upTo, scale: sowing.scale });
    }
  }
  const surfaces = new Set([surface, gapSteepSurfaceForMatrix(region.matrix)].filter(Boolean));
  return items.length ? { surfaces, items } : null;
}
