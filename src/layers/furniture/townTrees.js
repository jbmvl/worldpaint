/*
 * townTrees — les arbres semés dans l'habitat : ceux d'un parc de ville,
 * ceux qu'un bourg porte dans ses cours et ses jardins, et ceux d'une place
 * piétonne (`transportation` path/pedestrian en polygone), avec ses bancs.
 *
 * Ni l'un ni l'autre n'est relevé : un parc n'est qu'une pelouse, et un bourg
 * qu'une emprise `residential`. On les sème donc, clairsemés, sur une maille
 * mondiale (`worldCellsIn`) : une emprise rendue par deux tuiles, ou découpée
 * autrement, garde les mêmes arbres.
 *
 * Le bourg ne plante que sur son sol d'habitat (`settled`) : le revêtement
 * d'une ville, une zone d'activité ou un parc n'en sont pas, et un arbre n'y
 * est jamais semé deux fois. Les deux semis évitent les allées, l'eau, ce qui
 * est déjà un bois et les bâtiments ; ils sont triés par distance avant
 * d'être posés, pour que le plafond des arbres plantés coupe au loin. Leurs
 * essences sont celles du pays, aux parts de ses bois (`plantedSpeciesShares`).
 */
import { worldCellsIn, randomAt } from '../../core/groundSeed.js';
import { pointInAreas, ringsOf } from '../settlement.js';
import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { reachedRadius } from '../../core/decorReach.js';
import { FURNITURE_RADIUS_M, PLANTED_TREE } from './catalog.js';
import { pickShare } from '../furniturePlacement.js';
import { plantedSpeciesShares } from '../plantedTrees.js';

/** Pas de la maille, part des mailles plantées, dégagement d'une façade, sol exigé. */
export const PARK_TREES = { cellM: 13, share: 0.45, clearanceM: 2, surface: null, salt: 1301 };
export const YARD_TREES = { cellM: 18, share: 0.3, clearanceM: 3, surface: 'settled', salt: 1331 };
export const SQUARE_TREES = { cellM: 15, share: 0.4, clearanceM: 3, surface: null, salt: 1361 };
/** Part des arbres de place qui ont un banc au pied, et l'écart du banc au tronc. */
export const SQUARE_BENCH_SHARE = 0.35;
const SQUARE_BENCH_OFFSET_M = 1.8;

/** Classes `landuse` d'un quartier d'habitation. */
const YARD_LANDUSE = new Set(['residential', 'suburb', 'neighbourhood', 'quarter']);

/** Vrai si l'entité `landcover` décrit un parc. Fonction pure. */
export function isPark(properties = {}) {
  return properties.class === 'grass' && properties.subclass === 'park';
}

/** Vrai si l'entité `transportation` décrit une place piétonne (polygone). Fonction pure. */
export function isSquare(properties = {}) {
  return properties.class === 'path' && properties.subclass === 'pedestrian';
}

/** Vrai si l'entité `landuse` décrit un quartier d'habitation. Fonction pure. */
export function isYard(properties = {}) {
  return YARD_LANDUSE.has(properties.class);
}

/**
 * Sème les anneaux donnés selon `rule` (`PARK_TREES`, `YARD_TREES`).
 *
 * @param {Object} layer `FurnitureLayer`.
 * @param {Map} placements
 * @param {Array<Array<{x:number,z:number}>>} rings Anneaux locaux.
 * @param {{x:number,z:number}} here
 * @param {number} radius Portée du mobilier.
 * @param {Object} rule
 * @returns {number} arbres posés.
 */
export function plantTownTrees(layer, placements, rings, here, radius, rule, onPlanted = null) {
  const { frame } = layer.bubble;
  const mix = plantedSpeciesShares(layer.region?.trees, layer.theme.trees);
  if (mix.length === 0) return 0;
  const seen = new Set();
  const spots = [];

  for (const ring of rings) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    minX = Math.max(minX, here.x - radius);
    maxX = Math.min(maxX, here.x + radius);
    minZ = Math.max(minZ, here.z - radius);
    maxZ = Math.min(maxZ, here.z + radius);
    if (minX > maxX || minZ > maxZ) continue;

    for (const cell of worldCellsIn(frame, minX, minZ, maxX, maxZ, rule.cellM)) {
      const key = `${cell.id}:${cell.row}`;
      if (seen.has(key)) continue;
      if (randomAt(frame, cell.x, cell.z, rule.salt) >= rule.share) continue;
      const x = cell.x + (0.15 + 0.7 * randomAt(frame, cell.x, cell.z, rule.salt + 2)) * cell.size;
      const z = cell.z + (0.15 + 0.7 * randomAt(frame, cell.x, cell.z, rule.salt + 6)) * cell.size;
      if (!pointInAreas([ring], x, z)) continue;
      const distance = Math.hypot(x - here.x, z - here.z);
      if (distance > radius) continue;
      seen.add(key);
      spots.push({ x, z, distance, cell });
    }
  }

  spots.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  let planted = 0;
  for (const { x, z, cell } of spots) {
    if (rule.surface && layer.groundClass?.surfaceAt?.(x, z) !== rule.surface) continue;
    if (layer._onRoad(x, z) || layer._onWater(x, z)) continue;
    if (!layer._openGround(x, z)) continue;
    if (layer._fabric?.covers?.(x, z, rule.clearanceM)) continue;
    const species = pickShare(mix, randomAt(frame, cell.x, cell.z, rule.salt + 10));
    const placed = layer._place(placements, PLANTED_TREE, {
      x,
      z,
      yaw: randomAt(frame, x, z, rule.salt + 14) * Math.PI * 2,
      scale: 0.9 + randomAt(frame, cell.x, cell.z, rule.salt + 12) * 0.6,
    });
    if (placed) {
      placed.species = species;
      planted++;
      onPlanted?.(placed, cell);
    }
  }
  return planted;
}

/**
 * Plante les places piétonnes de la fenêtre, et pose un banc au pied d'une
 * part de leurs arbres, dos au tronc.
 *
 * @returns {{trees:number, benches:number}}
 */
export function buildTownSquares(layer, context) {
  const { source, tiles, here, placements } = context;
  const { frame } = layer.bubble;
  const { origin, scale, zoom } = frame;
  const squares = [];
  source.forEachFeature('transportation', tiles, (geometry) => {
    for (const ring of ringsOf(geometry)) {
      const local = ring.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));
      if (local.length >= 4) squares.push(local);
    }
  }, isSquare);

  let benches = 0;
  const trees = plantTownTrees(layer, placements, squares, here, reachedRadius(FURNITURE_RADIUS_M, layer.bubble), SQUARE_TREES, (tree, cell) => {
    if (randomAt(frame, cell.x, cell.z, SQUARE_TREES.salt + 20) >= SQUARE_BENCH_SHARE) return;
    const yaw = randomAt(frame, cell.x, cell.z, SQUARE_TREES.salt + 22) * Math.PI * 2;
    const x = tree.x + Math.sin(yaw) * SQUARE_BENCH_OFFSET_M;
    const z = tree.z + Math.cos(yaw) * SQUARE_BENCH_OFFSET_M;
    if (layer._onRoad(x, z) || layer._fabric?.covers?.(x, z, 1)) return;
    if (layer._place(placements, 'bench', { x, z, yaw })) benches++;
  });
  return { trees, benches };
}
