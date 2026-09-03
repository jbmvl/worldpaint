/*
 * townStyle — la couleur et la forme d'un village.
 *
 * Les tuiles OpenMapTiles ne portent que `render_height`/`render_min_height`/
 * `hide_3d` sur le bâti : ni matériau, ni couleur de toit, ni forme n'y
 * survivent. On ne peut donc pas peindre chaque maison d'après sa vraie
 * couleur, mais la régularité du bâti français est de toute façon à l'échelle
 * du village, pas de la maison. D'où une palette par village (tirée d'une
 * maille de terrain, donc stable d'une reconstruction à l'autre) et une
 * variation par maison à l'intérieur.
 *
 * Couleurs linéaires, prêtes pour les attributs de sommet, volontairement pastel.
 */

import { srgb } from '../core/color.js';
import { positionSeed, randomAt } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/** Côté de la maille qui décide de la palette d'un bourg, en mètres. */
export const TOWN_PATCH_M = 1400;

/** Les palettes d'un thème, converties en couleurs linéaires (mémorisées par thème). */
const LINEAR_CACHE = new WeakMap();

function linearTowns(towns) {
  let out = LINEAR_CACHE.get(towns);
  if (!out) {
    out = towns.map((palette) => ({
      name: palette.name,
      walls: palette.walls.map(srgb),
      roofs: palette.roofs.map(srgb),
      // Repli sur les tons de mur si le thème ne porte pas de volets.
      shutters: (palette.shutters || palette.walls).map(srgb),
      roofShapes: palette.roofShapes,
    }));
    LINEAR_CACHE.set(towns, out);
  }
  return out;
}

/** Palette du bourg qui contient un point. Ancrée au lieu (stable en traversée). */
export function townPaletteAt(x, z, towns = defaultTheme.towns) {
  const palettes = linearTowns(towns);
  const gx = Math.floor(x / TOWN_PATCH_M) * TOWN_PATCH_M;
  const gz = Math.floor(z / TOWN_PATCH_M) * TOWN_PATCH_M;
  const draw = randomAt(gx, gz, 149);
  return palettes[Math.min(palettes.length - 1, Math.floor(draw * palettes.length))];
}

/**
 * Revêtement de voirie du bourg qui contient un point. Tiré sur la même
 * maille que la palette du bâti (une commune refait sa voirie d'un coup),
 * avec une graine distincte de celle des murs.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object} [streets] Tranche `theme.streets`.
 * @returns {{name:string, walk:number[], kerb:number[], joint:number[], gutter:number[]}}
 */
export function streetSurfaceAt(x, z, streets = defaultTheme.streets) {
  const surfaces = linearStreets(streets);
  const gx = Math.floor(x / TOWN_PATCH_M) * TOWN_PATCH_M;
  const gz = Math.floor(z / TOWN_PATCH_M) * TOWN_PATCH_M;
  const draw = randomAt(gx, gz, 191);
  return surfaces[Math.min(surfaces.length - 1, Math.floor(draw * surfaces.length))];
}

const LINEAR_STREETS = new WeakMap();

function linearStreets(streets) {
  let out = LINEAR_STREETS.get(streets);
  if (!out) {
    const gutter = srgb(streets.gutter);
    out = streets.surfaces.map((surface) => ({
      name: surface.name,
      walk: srgb(surface.walk),
      kerb: srgb(surface.kerb),
      joint: srgb(surface.joint),
      gutter,
    }));
    LINEAR_STREETS.set(streets, out);
  }
  return out;
}

/**
 * Habillage d'un bâtiment : ton de mur, ton de toit, ton de volet, forme de
 * toit, et sa nature de maison. Variation double : un ton tiré parmi ceux de
 * la palette, plus une modulation de quelques pour cent (volontairement
 * faible, sinon le village devient une collection).
 *
 * `x`, `z` sont les coordonnées locales du bâtiment.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object} [context]
 * @param {number} [context.area]   Emprise au sol, en m².
 * @param {number} [context.height] Hauteur, en mètres.
 * @returns {{wall:number[], roof:number[], shutter:number[], shape:string,
 *           house:boolean, shutters:boolean, palette:string}}
 */
export function buildingStyleAt(x, z, { area = 100, height = 7 } = {}, towns = defaultTheme.towns) {
  const palette = townPaletteAt(x, z, towns);
  const seed = positionSeed(x, z, 151);
  const pickWall = palette.walls[seed % palette.walls.length];
  const pickRoof = palette.roofs[(seed >>> 3) % palette.roofs.length];
  const pickShutter = palette.shutters[(seed >>> 6) % palette.shutters.length];

  // Modulation tirée du lieu : ±6 % pour le crépi, ±3 % pour le volet peint (vieillit moins vite).
  const shade = 0.94 + randomAt(x, z, 157) * 0.12;
  const wall = pickWall.map((c) => Math.min(1, c * shade));
  const roof = pickRoof.map((c) => Math.min(1, c * (0.95 + randomAt(x, z, 163) * 0.1)));
  const shutter = pickShutter.map((c) => Math.min(1, c * (0.97 + randomAt(x, z, 167) * 0.06)));

  const house = isHouse({ area, height });
  return {
    wall,
    roof,
    shutter,
    shape: roofShapeFor(palette, { area, height, seed }),
    house,
    shutters: house && randomAt(x, z, 173) < SHUTTER_SHARE,
    palette: palette.name,
  };
}

/** Part des maisons qui portent des volets. */
export const SHUTTER_SHARE = 0.76;

/**
 * Maison, par opposition à immeuble ou bâtiment d'activité (d'après hauteur
 * et emprise). Sert aux volets (`buildingStyleAt`) et au jardin (`gardenLayer`).
 */
export function isHouse({ area = 100, height = 7 } = {}) {
  return height <= HOUSE_MAX_HEIGHT_M && area <= HOUSE_MAX_AREA_M2;
}

/** Au-delà, c'est un immeuble : trois niveaux et des combles. */
export const HOUSE_MAX_HEIGHT_M = 11.5;
/** Au-delà, c'est une exploitation ou un équipement, pas une maison. */
export const HOUSE_MAX_AREA_M2 = 320;

/** Forme du toit, d'après la palette du bourg et la taille du bâtiment (la taille tranche avant le tirage). */
export function roofShapeFor(palette, { area = 100, height = 7, seed = 0 } = {}) {
  if (height > 16 || area > 900) return 'flat';

  const shapes = palette.roofShapes;
  const shape = shapes[seed % shapes.length];
  // Pyramide sur une emprise très allongée = tente de cirque : on préfère la faîtière.
  if (shape === 'pyramid' && area > 240) return 'hip';
  return shape;
}
