/*
 * lowPolyForest — la géométrie en volume d'une essence de forêt.
 * -----------------------------------------------------------------
 * `vegetationLayer` plantait des arbres de bois en panneaux croisés (deux
 * quadrilatères texturés) : quatre triangles, un atlas peint, une silhouette
 * qui se lit bien mais reste un cutout — elle se trahit dès qu'on la longe.
 * Ce module construit à la place un petit volume facetté, dans le même style
 * « low poly » que les arbres de bord de route et les buissons de jardin
 * (`furnitureKit.Kit.rock`, `treeBroad`, `treeConifer`) : tronc balayé,
 * houppe en masse irrégulière à normales de face — jamais lissées.
 *
 * ## Un volume par essence, pas par « genre »
 *
 * `theme.trees.variants` (`TREE_VARIANTS`) décrit neuf essences, groupées en
 * quatre genres (`kind`) mais chacune avec son propre tronc, sa propre houppe
 * et sa propre teinte de base (`hue`). Un feuillage silhouetté a longtemps
 * porté cette teinte à même l'atlas peint (`createTreeAtlasCanvas`,
 * `proceduralTextures.js`) ; un volume la porte à même ses sommets. La
 * fonction qui la calcule ici (`essenceCrownTone`) reprend donc **exactement**
 * la formule de luminance des peintres d'atlas — même base, même amplitude
 * par genre, même hue multiplicatif — pour que la houppe en volume ne
 * réinvente pas une couleur que le thème a déjà fixée ailleurs.
 *
 * ## Un budget de triangles, pas un goût
 *
 * `vegetationLayer` en plante jusqu'à mille par tuile : le nombre de facettes
 * de chaque volume est un budget de rendu, pas une esthétique. Tronc à cinq
 * pans, houppe à cinq ou six pans et un seul anneau — de quoi lire un volume
 * facetté sans qu'un bois de mille arbres ne devienne des dizaines de
 * milliers de triangles inutiles à cette distance.
 */

import { Kit } from './furnitureKit.js';
import { srgb } from '../core/color.js';

/**
 * Base de luminance par genre, 0-255 avant teinte — reprise telle quelle des
 * peintres d'atlas (`drawBroadleaf`, `drawColumn`, `drawConifer`, `drawBushy`
 * dans `proceduralTextures.js`) : `value = base + lift * span`, `lift` valant
 * 0 au pied de la houppe et 1 à son sommet.
 */
const KIND_LUMA = {
  broadleaf: { base: 46, span: 74 },
  column: { base: 42, span: 78 },
  conifer: { base: 40, span: 66 },
  bushy: { base: 44, span: 72 },
};

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Teinte d'une essence à une hauteur de houppe donnée. Fonction pure.
 * @param {{kind:string, hue:{r:number,g:number,b:number}}} variant
 * @param {number} lift 0 (pied de la houppe, à l'ombre) à 1 (sommet, éclairé).
 * @returns {number[]} `[r, g, b]`, en espace linéaire.
 */
export function essenceCrownTone(variant, lift) {
  const { base, span } = KIND_LUMA[variant.kind] || KIND_LUMA.broadleaf;
  const value = (base + lift * span) / 255;
  return [
    srgbToLinear(value * variant.hue.r),
    srgbToLinear(value * variant.hue.g),
    srgbToLinear(value * variant.hue.b),
  ];
}

/** Écorce : le même brun que celui peint au pied des silhouettes d'atlas. */
export const TRUNK_COLOR = srgb('#5b4530');

/** Segments radiaux du tronc — un pilier, jamais la silhouette d'un arbre. */
const TRUNK_RADIAL = 5;

/**
 * Construit le volume d'une essence, normalisé : pied du tronc à `y = 0`,
 * sommet de la houppe à `y = 1`, emprise en plan de l'ordre de ±0,5. Une
 * instance l'échelonne ensuite comme elle échelonnait un panneau
 * (`_scale.set(height * aspect, height, height * aspect)`) : le rapport
 * largeur/hauteur reste donc le même levier qu'avant.
 *
 * @param {Object} THREE
 * @param {Object} variant Entrée de `TREE_VARIANTS` (`kind`, `hue`, `trunk`,
 *        `crownBase`, `spread`).
 * @param {number} index Indice du variant — sépare les graines de bruit d'une
 *        essence à l'autre, sinon deux essences voisines partageraient
 *        exactement le même contour de houppe.
 */
export function buildEssenceGeometry(THREE, variant, index) {
  const k = new Kit();
  const foot = essenceCrownTone(variant, 0.15);
  const tip = essenceCrownTone(variant, 0.85);
  const trunkTop = Math.min(0.92, Math.max(0.15, variant.crownBase));
  const trunkRadius = 0.045 + variant.trunk * 0.22;
  const crownHeight = 1 - trunkTop;
  const radius = Math.max(0.16, variant.spread);
  const seed = 4001 + index * 97;

  k.cylinder({
    radiusBottom: trunkRadius,
    radiusTop: trunkRadius * 0.7,
    height: trunkTop,
    radial: TRUNK_RADIAL,
    color: TRUNK_COLOR,
    cap: false,
  });

  if (variant.kind === 'conifer') {
    // Deux étages effilés plutôt qu'une masse arrondie : un résineux se lit à
    // sa silhouette pointue, jamais à une houppe en boule.
    const stage1 = crownHeight * 0.58;
    const stage2 = crownHeight - stage1;
    k.cylinder({
      radiusBottom: radius,
      radiusTop: radius * 0.5,
      height: stage1,
      radial: 6,
      y: trunkTop,
      color: foot,
      colorTop: tip,
      cap: false,
    });
    k.cylinder({
      radiusBottom: radius * 0.5,
      radiusTop: 0,
      height: stage2,
      radial: 6,
      y: trunkTop + stage1,
      color: tip,
      cap: false,
    });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  if (variant.kind === 'column') {
    // Fuseau étroit et haut : peu de pans en travers, plusieurs anneaux en
    // hauteur pour garder le profil pointu d'un peuplier.
    k.rock({
      radius: radius * 0.8,
      height: crownHeight,
      sides: 5,
      rings: 2,
      seed,
      y: trunkTop,
      color: foot,
      colorTop: tip,
    });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  if (variant.kind === 'bushy') {
    // Pas de tronc dégagé : la masse part quasiment du sol, comme un taillis.
    k.rock({
      radius: radius * 1.15,
      height: crownHeight + trunkTop * 0.4,
      sides: 6,
      rings: 1,
      seed,
      y: Math.max(0, trunkTop - trunkTop * 0.4),
      color: foot,
      colorTop: tip,
    });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  // Feuillu : une masse large et arrondie, le cas le plus courant.
  k.rock({
    radius,
    height: crownHeight,
    sides: 6,
    rings: 1,
    seed,
    y: trunkTop,
    color: foot,
    colorTop: tip,
  });
  return k.toGeometry(THREE, `lowpoly-tree-${index}`);
}

/**
 * Construit un volume par essence du thème, dans l'ordre de `variants`. Une
 * seule fois par instance de couche : les géométries sont ensuite partagées
 * par toutes les tuiles, comme le fait déjà `furnitureLayer` pour son
 * catalogue de mobilier.
 * @returns {Array<Object>} une géométrie par entrée de `variants`.
 */
export function buildEssenceGeometries(THREE, variants) {
  return variants.map((variant, index) => buildEssenceGeometry(THREE, variant, index));
}
