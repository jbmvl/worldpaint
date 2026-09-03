/*
 * townStyle — la couleur et la forme d'un village.
 * -------------------------------------------------
 * Tout le bâti sortait beige et cubique : un seul ton de mur, un seul ton de
 * toit, un dessus plat. Traverser trois villages donnait donc trois fois le même
 * village, et aucun ne ressemblait à rien de connu.
 *
 * ## Ce que les tuiles savent, et ce qu'elles ignorent
 *
 * Le schéma OpenMapTiles réduit la couche `building` à trois attributs :
 * `render_height`, `render_min_height`, `hide_3d`. Ni le matériau, ni la couleur
 * du toit, ni la forme, ni même la fonction du bâtiment n'y survivent — alors
 * qu'OpenStreetMap les porte (`building:material`, `roof:shape`,
 * `roof:colour`…). Aucun réglage côté client ne les fera revenir.
 *
 * On ne peut donc **pas** peindre chaque maison d'après sa vraie couleur. Mais
 * on peut faire beaucoup mieux qu'un beige unique, parce que la vraie
 * régularité du bâti français n'est pas à l'échelle de la maison : elle est à
 * l'échelle du **pays**. Un village de Provence est ocre et tuile romaine, un
 * village d'Alsace est colombage et tuile plate, un village de Bretagne est
 * granit et ardoise. Toutes les maisons d'un même bourg partagent une gamme
 * étroite, et c'est ce partage-là qui se lit quand on traverse.
 *
 * D'où ce module : une **palette par village**, tirée d'une maille de terrain,
 * et à l'intérieur une variation par maison. Le tirage ne dépend que du lieu,
 * donc un village garde sa couleur d'une reconstruction à l'autre — et deux
 * villages voisins n'ont pas la même.
 *
 * Toutes les valeurs sont des couleurs **linéaires** prêtes pour les attributs
 * de sommet, et volontairement pastel : peu saturées, claires. Une palette
 * saturée est ce qui fait basculer un décor stylisé du côté du jouet.
 */

import { srgb } from '../core/color.js';
import { positionSeed, randomAt } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';
import { filterByClimate } from '../core/climate.js';

/** Côté de la maille qui décide de la palette d'un bourg, en mètres. */
export const TOWN_PATCH_M = 1400;

/**
 * Les palettes d'un thème, converties en couleurs linéaires.
 *
 * Mémorisées sur le tableau lui-même : la conversion coûte peu mais elle est
 * appelée pour chaque bâtiment, et deux mondes de thèmes différents doivent
 * pouvoir garder chacun les siennes. Un cache faible, indexé par la donnée
 * d'entrée, fait les deux sans rien retenir de global.
 */
const LINEAR_CACHE = new WeakMap();

function linearTowns(towns) {
  let out = LINEAR_CACHE.get(towns);
  if (!out) {
    out = towns.map((palette) => ({
      name: palette.name,
      walls: palette.walls.map(srgb),
      roofs: palette.roofs.map(srgb),
      // Optionnels : un thème antérieur aux volets n'en porte pas. Repli sur
      // les tons de mur plutôt qu'un plantage — un volet de la couleur du
      // crépi ne se voit quasiment pas, ce qui est la moindre erreur possible.
      shutters: (palette.shutters || palette.walls).map(srgb),
      roofShapes: palette.roofShapes,
      // Recopiés tels quels : ce ne sont pas des couleurs, mais ils voyagent
      // avec la palette jusqu'au bâtiment.
      climates: palette.climates,
      pitch: palette.pitch,
    }));
    LINEAR_CACHE.set(towns, out);
  }
  return out;
}

/**
 * Palettes converties **et** filtrées par climat, mémorisées par nuancier puis
 * par famille.
 *
 * Le filtrage rend un tableau neuf à chaque appel, et `townPaletteAt` est
 * appelée une fois par bâtiment : sans cette seconde mémoire, chaque maison
 * d'un bourg reconstruirait la liste. Indexée par la donnée d'entrée, comme la
 * première, donc deux mondes de thèmes différents ne peuvent pas se mélanger.
 */
const CLIMATE_CACHE = new WeakMap();

function palettesFor(towns, climate) {
  const all = linearTowns(towns);
  if (!climate) return all;
  let byFamily = CLIMATE_CACHE.get(towns);
  if (!byFamily) {
    byFamily = new Map();
    CLIMATE_CACHE.set(towns, byFamily);
  }
  let pool = byFamily.get(climate);
  if (!pool) {
    pool = filterByClimate(all, climate);
    byFamily.set(climate, pool);
  }
  return pool;
}

/**
 * Palette du bourg qui contient un point. Fonction pure, et ancrée au lieu :
 * c'est ce qui fait qu'un village ne change pas de couleur quand on le
 * traverse.
 *
 * Le climat réduit d'abord la liste à ce qui se bâtit ici : la pierre du pays
 * n'est pas la même en Andalousie et en Baltique, et c'est ce qu'on lit en
 * traversant un village avant même d'en distinguer une maison.
 *
 * @param {string|null} [climate] Famille climatique (`core/climate.js`).
 */
export function townPaletteAt(x, z, towns = defaultTheme.towns, climate = null) {
  const palettes = palettesFor(towns, climate);
  const gx = Math.floor(x / TOWN_PATCH_M) * TOWN_PATCH_M;
  const gz = Math.floor(z / TOWN_PATCH_M) * TOWN_PATCH_M;
  const draw = randomAt(gx, gz, 149);
  return palettes[Math.min(palettes.length - 1, Math.floor(draw * palettes.length))];
}

/**
 * Revêtement de voirie du bourg qui contient un point.
 *
 * Tiré sur la **même maille** que la palette du bâti, et pour la même raison :
 * une commune refait sa voirie d'un coup. Toutes les rues d'un bourg partagent
 * donc leur bordure et leur trottoir, et le bourg d'à côté a les siens — c'est
 * ce partage qui fait qu'une traversée se lit comme un lieu et non comme une
 * suite de tronçons. Une graine distincte de celle des murs : le béton d'un
 * trottoir ne dit rien du granit des façades.
 *
 * Les couleurs sont rendues en **linéaire**, prêtes pour les attributs de
 * sommet. Fonction pure.
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
 * toit, et sa nature de maison.
 *
 * ## Le « léger pattern »
 *
 * Deux maisons voisines du même village ne sont pas exactement de la même
 * couleur — le crépi n'a pas le même âge, l'exposition n'est pas la même. La
 * variation est donc double : le **ton** est tiré parmi les deux ou trois de la
 * palette, et une **modulation** de quelques pour cent s'y ajoute. Elle est
 * volontairement faible : au-delà de dix pour cent, le village cesse d'être un
 * village et devient une collection.
 *
 * Fonction pure. `x`, `z` sont les coordonnées locales du bâtiment.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object} [context]
 * @param {number} [context.area]   Emprise au sol, en m².
 * @param {number} [context.height] Hauteur, en mètres.
 * @param {string|null} [climate] Famille climatique.
 * @returns {{wall:number[], roof:number[], shutter:number[], shape:string,
 *           pitch:number|undefined, house:boolean, shutters:boolean,
 *           palette:string}}
 */
export function buildingStyleAt(
  x,
  z,
  { area = 100, height = 7 } = {},
  towns = defaultTheme.towns,
  climate = null
) {
  const palette = townPaletteAt(x, z, towns, climate);
  const seed = positionSeed(x, z, 151);
  const pickWall = palette.walls[seed % palette.walls.length];
  const pickRoof = palette.roofs[(seed >>> 3) % palette.roofs.length];
  const pickShutter = palette.shutters[(seed >>> 6) % palette.shutters.length];

  // Modulation : ±6 %, tirée du lieu. Le crépi vieillit, l'exposition compte.
  const shade = 0.94 + randomAt(x, z, 157) * 0.12;
  const wall = pickWall.map((c) => Math.min(1, c * shade));
  const roof = pickRoof.map((c) => Math.min(1, c * (0.95 + randomAt(x, z, 163) * 0.1)));
  // Le volet est peint, pas enduit : il vieillit moins vite que le crépi, donc
  // il varie moins. ±3 %.
  const shutter = pickShutter.map((c) => Math.min(1, c * (0.97 + randomAt(x, z, 167) * 0.06)));

  const house = isHouse({ area, height });
  return {
    wall,
    roof,
    shutter,
    shape: roofShapeFor(palette, { area, height, seed }),
    // Pente propre au bourg, ou rien — auquel cas l'appelant garde celle du
    // thème. La silhouette d'un toit se lit de plus loin que sa couleur : un
    // toit-terrasse andalou et un pignon balte ne sont pas deux teintes.
    pitch: palette.pitch,
    house,
    // Un volet n'est pas un standard : dans le même bourg, une maison sur quatre
    // n'en a pas — façade refaite, fenêtre percée après coup, dépendance.
    shutters: house && randomAt(x, z, 173) < SHUTTER_SHARE,
    palette: palette.name,
  };
}

/** Part des maisons qui portent des volets. */
export const SHUTTER_SHARE = 0.76;

/**
 * Maison, par opposition à immeuble ou bâtiment d'activité.
 *
 * Ce que les tuiles disent d'un bâtiment se réduit à sa hauteur et à son
 * emprise, et c'est heureusement assez : on ne met pas de volets à une barre
 * d'immeubles ni à un hangar, et le seuil qui sépare les deux est le même dans
 * toute la France — trois niveaux et une emprise de villa.
 *
 * Sert deux fois : les volets (`buildingStyleAt`) et le jardin (`gardenLayer`).
 * Fonction pure.
 */
export function isHouse({ area = 100, height = 7 } = {}) {
  return height <= HOUSE_MAX_HEIGHT_M && area <= HOUSE_MAX_AREA_M2;
}

/** Au-delà, c'est un immeuble : trois niveaux et des combles. */
export const HOUSE_MAX_HEIGHT_M = 11.5;
/** Au-delà, c'est une exploitation ou un équipement, pas une maison. */
export const HOUSE_MAX_AREA_M2 = 320;

/**
 * Forme du toit, d'après la palette du bourg et la taille du bâtiment.
 *
 * La taille tranche avant le tirage, et c'est ce qui rend le résultat crédible :
 * un hangar de mille mètres carrés n'a pas de toit à quatre pentes, il a un toit
 * plat ou une longue faîtière ; une tour n'a pas de toit du tout ; une petite
 * dépendance carrée porte souvent une pyramide.
 *
 * Fonction pure.
 */
export function roofShapeFor(palette, { area = 100, height = 7, seed = 0 } = {}) {
  // Immeuble ou grand bâtiment d'activité : toit plat, sans discussion.
  if (height > 16 || area > 900) return 'flat';

  const shapes = palette.roofShapes;
  const shape = shapes[seed % shapes.length];
  // Une pyramide sur une emprise très allongée donnerait une tente de cirque :
  // c'est la faîtière qui convient, et l'appelant sait déjà la construire.
  if (shape === 'pyramid' && area > 240) return 'hip';
  return shape;
}
