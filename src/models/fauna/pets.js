/*
 * fauna/pets — le chat et le chien du bâti, pas du pré.
 * ------------------------------------------------------
 * Deux bêtes qu'on croise devant une porte, jamais groupées : `chat` a son
 * propre corps (rond, bas, la queue portée haute) ; `chien` reprend le corps
 * `canid` de `wildlife.js` — un chien de hameau n'est qu'un canidé de plus,
 * seules les proportions et la couleur changent.
 */

import { AnimalKit, LIMB, robe } from '../animalKit.js';
import { canid } from './wildlife.js';

/**
 * Chat : un corps court et souple porté bas, une tête ronde à museau court,
 * de grandes oreilles dressées et une queue qui fait le tiers de l'animal,
 * portée haute — c'est elle, plus que la taille, qui le distingue d'un jeune
 * chien à distance.
 */
export function cat(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(1.3),
    sections: [
      { z: -0.22, y: 0.24, w: 0.055, h: 0.065 },
      { z: -0.08, y: 0.26, w: 0.09, h: 0.1 },
      { z: 0.06, y: 0.25, w: 0.095, h: 0.105 },
      { z: 0.18, y: 0.26, w: 0.08, h: 0.09 },
      { z: 0.26, y: 0.28, w: 0.055, h: 0.065 },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.055, 0.16],
    [LIMB.LEG_FRONT_RIGHT, 0.055, 0.16],
    [LIMB.LEG_REAR_LEFT, -0.06, -0.16],
    [LIMB.LEG_REAR_RIGHT, 0.06, -0.16],
  ]) {
    k.leg({
      limb, x, z,
      top: 0.25,
      bend: z > 0 ? 0.015 : -0.05,
      knee: 0.55,
      width: 0.032,
      widthFoot: 0.024,
      foot: 0.03,
      footHeight: 0.022,
      color: coat,
      footColor: C.claw,
    });
  }

  // Pivot bas et court : un chat porte la tête dans l'axe du dos, comme tout
  // carnassier — elle ne plonge que pour flairer.
  k.part(LIMB.HEAD, [0, 0.27, 0.26], (h) => {
    h.bone({ from: { y: 0.27, z: 0.26 }, to: { y: 0.33, z: 0.36 }, width: 0.085, depth: 0.09, widthEnd: 0.08, depthEnd: 0.085, color: coat });
    h.taper({ y: 0.33, z: 0.4, width: 0.07, depth: 0.07, widthTop: 0.045, depthTop: 0.05, height: 0.06, color: coat });
    h.box({ width: 0.02, height: 0.016, depth: 0.016, y: 0.315, z: 0.435, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.022, height: 0.022, depth: 0.022, x: side * 0.045, y: 0.335, z: 0.4, color: C.eye });
    }
    // Grandes oreilles triangulaires, dressées et bien écartées : le repère
    // qui sépare un chat d'un chiot à cette distance.
    h.ears({ x: 0.045, y: 0.36, z: 0.35, length: 0.075, width: 0.055, depth: 0.02, tilt: 0.05, spread: 0.85, color: coat });
    h.muzzle([0, 0.315, 0.44]);
  });

  // Queue longue et portée haute plutôt que basse — un chat au repos la
  // tient dressée, c'est ce qui la distingue de celle d'un chien qui pend.
  k.tail({ y: 0.28, z: -0.2, length: 0.28, width: 0.028, widthEnd: 0.014, droop: -0.55, color: coat });
  return k;
}

/**
 * Chien : le corps `canid` réglé sur un corniaud de cour plutôt qu'un fauve —
 * plus trapu qu'un renard, la queue plus courte que celle d'un loup et
 * portée moins basse.
 */
export function dog(C) {
  return canid(C, {
    scale: 0.95,
    tailLength: 0.34,
    tailWidth: 0.075,
    tailDroop: 0.15,
    earLength: 0.13,
    muzzle: 0.2,
    chestDepth: 1.05,
  });
}
