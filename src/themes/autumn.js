/*
 * autumn — la tranche d'automne : feuillus roux, dorés ou cuivrés, herbe et
 * pré jaunis, litière brune sous bois, presque plus de fleurs, haies qui virent
 * par plages, champs moissonnés ou secs. Résineux, pins et persistants gardent
 * leur vert : ce contraste fait lire la saison de loin.
 *
 * D'une parcelle à l'autre, une même culture n'en est pas au même point
 * (`cropStages`) : un blé moissonné est déjà levé, ou porte un couvert
 * d'interculture.
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

// Fin octobre : blé moissonné, tournesol et maïs secs sur pied (le tournesol
// garde sa silhouette, roussie), colza semé fin août qui ne fait encore que
// des rosettes au ras du sol. Blé moissonné et colza n'ont donc pas de
// touffes : ce sont des couleurs de sol.
const { wheat: _wheat, rapeseed: _rapeseed, ...standing } = defaultTheme.crops;
const crops = {
  ...standing,
  maize: { ...defaultTheme.crops.maize, tint: [1.45, 0.82, 0.42] },
  sunflower: { ...defaultTheme.crops.sunflower, tint: [0.75, 0.58, 0.45] },
};

// Terre labourée à peine rougie ; le champ de blé moissonné ou en chaume a la
// même couleur : un sol jaune ferait un désert.
const PLOUGHED = [0.25, 0.125, 0.055];

const terrain = {
  ...defaultTheme.terrain,
  cropAlbedo: {
    ...defaultTheme.terrain.cropAlbedo,
    plough: PLOUGHED,
    wheat: PLOUGHED,
    wheatStubble: PLOUGHED,
    maize: [0.3, 0.22, 0.06],
    sunflower: [0.2, 0.15, 0.05],
    rapeseed: [0.075, 0.15, 0.025],
    // Rangs jaunissants sur un inter-rang enherbé : un vert olive, pas l'ocre
    // d'une feuille seule, qui couvrait de moutarde les pays de vigne.
    vineyard: [0.1, 0.125, 0.03],
    coverCrop: surfaces.grass.albedo,
    orchard: [0.2, 0.18, 0.05],
  },
};

// Le blé moissonné ne reste pas terre nue : couvert d'interculture ou levée.
// Le labour reste celui des champs que l'assolement dit labourés.
const cropStages = {
  wheat: [['coverCrop', 2 / 3], ['wheatSprouts', 1 / 3]],
};

// Facteurs sur le feuillage des haies, par plage : vert olive, vert éteint,
// jaune terne, et quelques touches orangées. Des citrouilles dans les petites
// parcelles au ras du sol, à moins de quarante mètres de la route.
const furniture = {
  ...defaultTheme.furniture,
  pumpkins: { maxHa: 1.5, perHectare: 120, perParcel: 180, roadsideM: 40, looks: ['coverCrop', 'plough', 'wheatSprouts'] },
  hedgeTints: [
    [[1.12, 1.0, 0.55], 0.35],
    [[0.95, 0.95, 0.8], 0.2],
    [[1.5, 1.22, 0.45], 0.3],
    [[1.85, 0.95, 0.32], 0.15],
  ],
};

export const autumnTheme = { trees, surfaces, crops, cropStages, terrain, furniture };

/**
 * La tranche de la saison d'une date, ou `null` (l'été par défaut). Seul
 * l'automne météorologique est décrit : septembre à novembre.
 * @param {Date} [date]
 */
export function seasonalTheme(date = new Date()) {
  const month = date.getMonth();
  return month >= 8 && month <= 10 ? autumnTheme : null;
}
