/*
 * caneBrakes — la canne de Provence (Arundo donax) : des massifs de touffes de
 * 3 à 4 m le long des fossés, des cours d'eau et des routes de plaine du Midi.
 * Présence par matrice (`CANE_BRAKE_SHARES`), zéro ailleurs ; des tronçons
 * (`caneBrakeRuns`), jamais une haie continue.
 *
 * Un massif est fait de touffes (`caneClump`), pas d'un balayage : c'est le
 * jour entre les tiges qui fait la canne, et un volume plein se lisait comme un
 * mur. La canne veut un sol frais : au bord d'une route, elle ne pousse que
 * sur terrain doux (`CANE_ROAD_STEEPNESS_MAX`) — pas sur un lacet à flanc de
 * versant.
 *
 * Les touffes candidates sont rassemblées puis posées des plus proches aux
 * plus lointaines : le plafond coupe au bord de la portée, jamais au hasard
 * de l'ordre des tuiles.
 */

import { randomAt } from '../../core/groundSeed.js';
import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { WATERWAY_SOURCE_LAYER } from '../../terrain/groundClassMap.js';
import { resamplePath } from '../ribbonGeometry.js';
import { caneBrakeRuns, caneBrakeShareFor, caneClumpsAlong } from '../furniturePlacement.js';
import { pointInAreas } from '../settlement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, BOUNDARY_SAMPLE_M } from './catalog.js';

/** Cours d'eau linéaires dont la berge porte la canne — intermittents compris. */
export const CANE_WATERWAYS = new Set(['river', 'stream', 'ditch', 'drain']);
/** Pente moyenne (`_steepnessAt`) au-delà de laquelle un bord de route n'en porte pas. */
export const CANE_ROAD_STEEPNESS_MAX = 0.1;
/** Écart entre la rive d'un cours d'eau et l'axe du massif, en mètres. */
const CANE_BANK_M = 1.2;
/** Écart entre la rive d'une chaussée et l'axe du massif, en mètres. */
const CANE_VERGE_M = 2.6;

/**
 * Massifs le long d'une portion de route hors agglomération, du côté que
 * `freeSide` laisse libre (1, -1, ou 0 si aucun). Rangés dans `clumps`.
 */
export function appendRoadsideCane(layer, clumps, { path, halfWidth, side, profile, inTown, freeSide, segment }) {
  if (inTown || !freeSide || profile === 'express' || profile === 'cycleway' || profile === 'path') return;
  const { frame } = layer.bubble;
  if (randomAt(frame, side.x, side.z, 97) >= caneBrakeShareFor(layer.region?.matrix, 'road')) return;
  const offset = freeSide * (halfWidth + CANE_VERGE_M);
  for (const run of caneBrakeRuns(frame, path, 1)) {
    const mid = run[run.length >> 1];
    if (layer._steepnessAt(mid.x, mid.z) > CANE_ROAD_STEEPNESS_MAX) continue;
    for (const clump of caneClumpsAlong(frame, run, offset)) clumps.push({ ...clump, own: segment });
  }
}

/** Massifs sur les berges des cours d'eau linéaires de la portée du mobilier. */
export function collectWaterwayCanes(layer, context, builtUp) {
  const share = caneBrakeShareFor(layer.region?.matrix, 'water');
  if (share <= 0) return;
  const { source, tiles, here } = context;
  const { frame } = layer.bubble;
  const { origin, scale, zoom } = frame;
  const widths = layer.theme.water.waterways;
  const toLocal = (line) => line.map(([lng, lat]) => ({
    x: (lngToTileX(lng, zoom) - origin.x) * scale,
    z: (latToTileY(lat, zoom) - origin.y) * scale,
  }));

  source.forEachFeature(WATERWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
    if (!CANE_WATERWAYS.has(properties.class) || properties.brunnel === 'tunnel') return;
    const halfWidth = (widths[properties.class] ?? 0) / 2;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const path = resamplePath(toLocal(line), BOUNDARY_SAMPLE_M);
      if (path.length < 2) continue;
      // Une berge ou les deux, selon un tirage pris au début du trait.
      for (const bank of [1, -1]) {
        if (randomAt(frame, path[0].x, path[0].z, bank > 0 ? 213 : 217) >= share) continue;
        for (const run of caneBrakeRuns(frame, path, bank > 0 ? 3 : 5)) {
          const mid = run[run.length >> 1];
          if (Math.hypot(mid.x - here.x, mid.z - here.z) > FURNITURE_RADIUS_M) continue;
          if (pointInAreas(builtUp, mid.x, mid.z)) continue;
          context.caneClumps.push(...caneClumpsAlong(frame, run, bank * (halfWidth + CANE_BANK_M)));
        }
      }
    }
  });
}

/** Pose les touffes rassemblées, des plus proches aux plus lointaines, jusqu'au plafond. */
export function placeCaneClumps(layer, context) {
  const { here, placements } = context;
  const clumps = context.caneClumps;
  for (const c of clumps) c.distance = Math.hypot(c.x - here.x, c.z - here.z);
  clumps.sort((a, b) => a.distance - b.distance);
  let placed = 0;
  for (const c of clumps) {
    if (placed >= FURNITURE_LIMITS.caneClumps) break;
    if (c.distance > FURNITURE_RADIUS_M) break;
    if (layer._onRoad(c.x, c.z, c.own ?? null) || layer._onWater(c.x, c.z)) continue;
    if (layer._place(placements, 'caneClump', { x: c.x, z: c.z, yaw: c.yaw, scale: c.scale })) placed++;
  }
  return placed;
}
