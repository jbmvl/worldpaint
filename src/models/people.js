/*
 * people — la silhouette humaine du décor : un spectateur debout.
 * ---------------------------------------------------------------
 * Deux géométries par tenue, et pas une : le corps (jambes, buste, tête) et
 * un bras, dont le pivot est l'épaule. C'est ce qui permet de lever et
 * d'agiter les bras par une simple matrice d'instance, sans os ni shader —
 * à la distance où l'on voit un spectateur, un bras qui s'agite suffit.
 *
 * Repère : origine au pied, +Y vers le haut, +Z vers l'avant (le regard).
 * Le bras pend le long de −Y depuis son origine ; `SHOULDER` dit où le poser.
 */

import { Kit } from './kit.js';

/** Hauteur d'un adulte debout, en mètres. */
export const PERSON_HEIGHT_M = 1.72;
/** Épaule droite dans le repère du corps ; la gauche est son symétrique en x. */
export const SHOULDER = { x: 0.25, y: 1.44, z: 0 };

/**
 * Tenues composées depuis le nuancier `theme.life.people` : chaque tenue
 * prend une peau, un haut, un bas et une chevelure en décalant les indices,
 * pour que `count` tenues ne se ressemblent pas deux à deux.
 *
 * @param {{skins:Array, tops:Array, bottoms:Array, hair:Array}} palette
 * @param {number} count
 */
export function composeOutfits(palette, count) {
  const pick = (list, i) => list[i % list.length];
  return Array.from({ length: count }, (_, i) => ({
    skin: pick(palette.skins, i),
    top: pick(palette.tops, i),
    bottom: pick(palette.bottoms, i * 3 + 1),
    hair: pick(palette.hair, i * 5 + 2),
  }));
}

/** Corps sans les bras : jambes, bassin, buste, cou, tête et cheveux. */
export function createPersonBodyGeometry(THREE, outfit) {
  const k = new Kit();
  for (const side of [-1, 1]) {
    k.box({ width: 0.14, height: 0.82, depth: 0.16, color: outfit.bottom, x: side * 0.09 });
    k.box({ width: 0.15, height: 0.07, depth: 0.26, color: outfit.bottom, x: side * 0.09, z: 0.04 });
  }
  k.box({ width: 0.36, height: 0.12, depth: 0.2, color: outfit.bottom, y: 0.8 });
  k.box({ width: 0.4, height: 0.56, depth: 0.22, color: outfit.top, y: 0.9 });
  k.box({ width: 0.1, height: 0.07, depth: 0.1, color: outfit.skin, y: 1.46 });
  k.box({ width: 0.2, height: 0.22, depth: 0.21, color: outfit.skin, y: 1.5 });
  k.box({ width: 0.22, height: 0.07, depth: 0.23, color: outfit.hair, y: 1.68, z: -0.005 });
  k.box({ width: 0.22, height: 0.12, depth: 0.05, color: outfit.hair, y: 1.57, z: -0.095 });
  return k.toGeometry(THREE, 'person');
}

/** Un bras, pivot à l'épaule, pendant le long de −Y : manche puis main. */
export function createPersonArmGeometry(THREE, outfit) {
  const k = new Kit();
  k.box({ width: 0.1, height: 0.5, depth: 0.11, color: outfit.top, y: -0.5 });
  k.box({ width: 0.085, height: 0.14, depth: 0.09, color: outfit.skin, y: -0.64 });
  return k.toGeometry(THREE, 'person-arm');
}
