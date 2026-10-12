/*
 * groundSeed — la seule source d'aléa du moteur : un hachage entier, une suite
 * pseudo-aléatoire, et les graines attachées à un point du sol.
 *
 * Une graine de lieu ne se tire jamais des coordonnées de scène telles
 * quelles : le repère local est centré sur le point de départ de l'observateur
 * et son échelle suit la latitude de ce point, si bien que le même champ
 * aurait d'autres coordonnées — donc d'autres tirages — selon d'où l'on vient.
 * Toute graine passe par le repère (`frame`) qui ramène le point en
 * coordonnées Web Mercator absolues, quantifiées sur une grille mondiale.
 *
 * De même, une grille de semis ne s'aligne pas sur l'origine du repère : ses
 * mailles découpent les tuiles Web Mercator (`worldCellsIn`), en un nombre
 * entier par tuile, si bien qu'elles tombent au même endroit pour tout
 * observateur. Le côté d'une maille suit la latitude de sa rangée de tuiles et
 * s'écarte du pas demandé de moins de 2 % jusqu'à 60° de latitude.
 */

import { EARTH_CIRCUMFERENCE } from './tileMath.js';

/** Zoom des tuiles qui portent la grille des graines, et celle des mailles de petit pas. */
export const SEED_ZOOM = 15;
/** Pas de quantification des graines, en fraction de tuile z15 (≈ 0,4 m à 47°). */
export const SEED_STEPS = 2048;
/** Plus de mailles par tuile z15 que ne l'admet l'identifiant d'une maille. */
const MAX_CELLS_PER_TILE = 4096;

/** Hachage entier de trois entiers sur 32 bits, bien mélangé. Pur. */
export function hash32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** `hash32` ramené dans [0, 1[. */
export function hashUnit(a, b = 0, c = 0) {
  return hash32(a, b, c) / 4294967296;
}

/** Suite pseudo-aléatoire déterministe dans [0, 1[ (mulberry32). */
export function randomStream(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lattices = new WeakMap();

/** Passage des mètres locaux du repère aux pas de la grille mondiale des graines. */
function latticeOf(frame) {
  let lattice = lattices.get(frame);
  if (!lattice) {
    if (!Number.isFinite(frame?.zoom) || !Number.isFinite(frame.scale) || !frame.origin) {
      throw new TypeError('groundSeed : un repère local complet est requis (zoom, origin, scale)');
    }
    const perTile = SEED_STEPS * 2 ** (SEED_ZOOM - frame.zoom);
    lattice = { x0: frame.origin.x * perTile, z0: frame.origin.y * perTile, perMeter: perTile / frame.scale };
    lattices.set(frame, lattice);
  }
  return lattice;
}

/** Graine entière d'un point du sol (`x`, `z` en mètres du repère `frame`). Pure. */
export function positionSeed(frame, x, z, salt = 0) {
  const { x0, z0, perMeter } = latticeOf(frame);
  return hash32(Math.round(x0 + x * perMeter), Math.round(z0 + z * perMeter), salt);
}

/** Tirage dans [0, 1[ attaché à un point du sol. Pur. */
export function randomAt(frame, x, z, salt = 0) {
  return positionSeed(frame, x, z, salt) / 4294967296;
}

/** Mailles par tuile, au moins, quel que soit le pas : une tuile trop petite arrondirait trop le pas. */
const MIN_CELLS_PER_TILE = 64;

/** Zoom des tuiles qui portent la grille de pas `step` : z15, ou moins pour un grand pas. */
function latticeZoom(step) {
  let zoom = SEED_ZOOM;
  while (zoom > 0 && EARTH_CIRCUMFERENCE / 2 ** zoom < MIN_CELLS_PER_TILE * step) zoom--;
  return zoom;
}

/** Mailles par côté d'une tuile de la rangée `tileY` au zoom `zoom`, au pas voisin de `step` mètres réels. */
function cellsPerTile(tileY, zoom, step) {
  const n = Math.PI * (1 - (2 * (tileY + 0.5)) / 2 ** zoom);
  const tileMeters = (EARTH_CIRCUMFERENCE * Math.cos(Math.atan(Math.sinh(n)))) / 2 ** zoom;
  return Math.min(MAX_CELLS_PER_TILE, Math.max(1, Math.round(tileMeters / step)));
}

/**
 * Mailles mondiales de côté voisin de `step` mètres qui recoupent le
 * rectangle local [minX, maxX] × [minZ, maxZ]. Chaque tuile (z15, ou plus
 * grande pour un grand pas) en porte `round(côté / step)` par côté : la grille
 * ne dépend que du sol.
 *
 * @returns {Array<{id:number, row:number, x:number, z:number, size:number}>}
 *          `id`, `row` identifient la maille dans le monde (à passer à
 *          `hash32`) ; `x`, `z` est son coin nord-ouest dans le repère ;
 *          `size` son côté local.
 */
export function worldCellsIn(frame, minX, minZ, maxX, maxZ, step) {
  latticeOf(frame);
  const zoom = latticeZoom(step);
  const toTile = 2 ** (zoom - frame.zoom);
  const tileMeters = frame.scale / toTile;
  const ox = frame.origin.x * toTile, oz = frame.origin.y * toTile;
  const cells = [];
  const tx0 = Math.floor(ox + minX / tileMeters), tx1 = Math.floor(ox + maxX / tileMeters);
  const ty0 = Math.floor(oz + minZ / tileMeters), ty1 = Math.floor(oz + maxZ / tileMeters);
  for (let ty = ty0; ty <= ty1; ty++) {
    const n = cellsPerTile(ty, zoom, step);
    const size = tileMeters / n;
    const rowZ = (ty - oz) * tileMeters;
    const j0 = Math.max(0, Math.floor((minZ - rowZ) / size)), j1 = Math.min(n - 1, Math.floor((maxZ - rowZ) / size));
    for (let tx = tx0; tx <= tx1; tx++) {
      const colX = (tx - ox) * tileMeters;
      const i0 = Math.max(0, Math.floor((minX - colX) / size)), i1 = Math.min(n - 1, Math.floor((maxX - colX) / size));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          cells.push({ id: tx * MAX_CELLS_PER_TILE + i, row: ty * MAX_CELLS_PER_TILE + j, x: colX + i * size, z: rowZ + j * size, size });
        }
      }
    }
  }
  return cells;
}

/** Tirage dans [0, 1[ commun à toute la maille mondiale (pas voisin de `step`) qui contient le point. Pur. */
export function cellRandomAt(frame, x, z, step, salt = 0) {
  latticeOf(frame);
  const zoom = latticeZoom(step);
  const toTile = 2 ** (zoom - frame.zoom);
  const tx = frame.origin.x * toTile + (x * toTile) / frame.scale;
  const ty = frame.origin.y * toTile + (z * toTile) / frame.scale;
  const col = Math.floor(tx), row = Math.floor(ty);
  const n = cellsPerTile(row, zoom, step);
  return hashUnit(
    col * MAX_CELLS_PER_TILE + Math.min(n - 1, Math.floor((tx - col) * n)),
    row * MAX_CELLS_PER_TILE + Math.min(n - 1, Math.floor((ty - row) * n)),
    salt
  );
}

/**
 * Mailles mondiales (pas voisin de `step`) qui couvrent le disque de `radius`
 * autour de `here`, de la plus proche à la plus lointaine : un plafond atteint
 * coupe alors au bord de la portée, jamais au hasard d'une rangée.
 */
export function worldCellsAround(frame, here, radius, step) {
  const cells = worldCellsIn(frame, here.x - radius, here.z - radius, here.x + radius, here.z + radius, step);
  for (const cell of cells) cell.distance = Math.hypot(cell.x + cell.size / 2 - here.x, cell.z + cell.size / 2 - here.z);
  return cells.sort((a, b) => a.distance - b.distance || a.row - b.row || a.id - b.id);
}
