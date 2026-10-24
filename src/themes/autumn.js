/*
 * autumn — la tranche d'automne : feuillus roux, dorés ou cuivrés, herbe et
 * pré jaunis, litière brune sous bois, presque plus de fleurs, champs
 * moissonnés ou secs. Résineux, pins et persistants gardent leur vert : ce
 * contraste fait lire la saison de loin.
 *
 * Ce n'est qu'une surcharge de `defaultTheme` passée à `resolveTheme` ; aucune
 * couche ne sait quelle saison il fait. Les teintes multiplient `volume.leaf`,
 * comme celles de l'été.
 */

import { defaultTheme } from './default.js';

/** Teinte d'automne par indice de `TREE_VARIANTS` ; les absents ne changent pas. */
const AUTUMN_HUES = {
  0: { r: 1.35, g: 0.8, b: 0.25 }, // chêne : roux
  1: { r: 1.55, g: 0.7, b: 0.2 }, // hêtre : cuivre
  2: { r: 1.3, g: 1.0, b: 0.2 }, // frêne, bouleau : jaune
  4: { r: 1.4, g: 1.05, b: 0.2 }, // peuplier : or
  7: { r: 1.2, g: 0.78, b: 0.25 },
  8: { r: 1.6, g: 0.6, b: 0.2 }, // cornouiller, merisier : rouge
  9: { r: 0.95, g: 0.72, b: 0.35 }, // ronce
  10: { r: 1.2, g: 0.7, b: 0.3 },
  16: { r: 1.1, g: 0.9, b: 0.3 }, // pommier
};

const trees = {
  ...defaultTheme.trees,
  variants: defaultTheme.trees.variants.map((v, i) => (AUTUMN_HUES[i] ? { ...v, hue: AUTUMN_HUES[i] } : v)),
};

// Pré jauni et litière de feuilles : c'est le sol qui couvre l'image.
const surfaces = {
  ...defaultTheme.surfaces,
  grass: { ...defaultTheme.surfaces.grass, albedo: [0.085, 0.12, 0.02] },
  wood: { ...defaultTheme.surfaces.wood, albedo: [0.07, 0.058, 0.014] },
};

// Fin octobre : blé et tournesol moissonnés, maïs sec sur pied, colza
// semé fin août qui ne fait encore que des rosettes vertes au ras du sol.
const crops = {
  ...defaultTheme.crops,
  wheat: { ...defaultTheme.crops.plough },
  maize: { ...defaultTheme.crops.maize, tint: [1.45, 0.82, 0.42] },
  sunflower: { ...defaultTheme.crops.plough, tint: [0.8, 0.7, 0.55] },
  rapeseed: { ...defaultTheme.crops.rapeseed, atlas: 'rice', height: 0.25, tint: [0.9, 1.05, 0.8] },
};

const terrain = {
  ...defaultTheme.terrain,
  cropAlbedo: {
    ...defaultTheme.terrain.cropAlbedo,
    wheat: [0.36, 0.27, 0.07],
    maize: [0.3, 0.22, 0.06],
    sunflower: [0.2, 0.15, 0.05],
    rapeseed: [0.075, 0.15, 0.025],
    vineyard: [0.3, 0.2, 0.05],
    orchard: [0.2, 0.18, 0.05],
  },
};

export const autumnTheme = { trees, surfaces, crops, terrain };

/**
 * La tranche de la saison d'une date, ou `null` (l'été par défaut). Seul
 * l'automne météorologique est décrit : septembre à novembre.
 * @param {Date} [date]
 */
export function seasonalTheme(date = new Date()) {
  const month = date.getMonth();
  return month >= 8 && month <= 10 ? autumnTheme : null;
}
