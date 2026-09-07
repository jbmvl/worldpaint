/*
 * fauna/livestock — ce qu'on met dans un pré.
 * -------------------------------------------
 * Vache, mouton, chèvre, cheval, âne, poule. Ce sont les bêtes qu'on croise
 * le plus, donc celles qu'on regarde le plus longtemps : elles sont modelées
 * au galbe (`AnimalKit.loft`) et non à la boîte.
 *
 * ## La pose de repos est la pose haute
 *
 * Chaque bête est modelée **tête levée**. Ce n'est pas un choix esthétique :
 * l'encolure est un membre articulé (`LIMB.HEAD`) que le shader fait plonger
 * de `grazeRad` radians pour brouter. Modeler la tête déjà baissée
 * rendrait le mouvement impossible dans un sens et absurde dans l'autre.
 *
 * ## La portée de l'encolure décide de ce qu'on peut brouter
 *
 * Le museau, une fois l'encolure rabattue à fond, descend au plus de la
 * **longueur du bras de levier** sous le pivot. Une encolure trop courte
 * donne une bête qui mime le broutage trente centimètres au-dessus de
 * l'herbe, ce qui se voit immédiatement. Règle tenue ici : distance
 * pivot→museau ≳ 0,85 × hauteur du pivot. Toucher à l'un sans l'autre casse
 * la pose ; `grazeRad` par espèce (voir `index.js`) referme l'écart restant.
 *
 * ## Les robes ne sont pas ici
 *
 * `robe(shade)` ne rend qu'un niveau de gris : la teinte vient de l'instance
 * et le nuancier est dans le thème (`FAUNA_COATS`). Ce qui reste écrit en dur
 * ici, ce sont les parties dont la couleur ne varie pas d'une bête à l'autre —
 * sabot, corne, mufle, œil.
 */

import { AnimalKit, LIMB, robe } from '../animalKit.js';

/**
 * Vache.
 *
 * Silhouette : un corps long, presque cylindrique, porté haut sur des pattes
 * fines ; le garrot légèrement plus haut que la croupe ; une encolure courte
 * et épaisse. Ce qui la distingue d'un cheval de loin, ce n'est pas la
 * taille — c'est que la ligne du dos est droite et que la tête est portée
 * dans le prolongement de l'encolure, pas au-dessus.
 */
export function cow(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);
  const dark = robe(0.42);

  k.loft({
    sides: 8,
    color: coat,
    colorBelly: robe(0.78),
    sections: [
      { z: -1.05, y: 1.02, w: 0.19, h: 0.22 },
      { z: -0.76, y: 1.02, w: 0.33, h: 0.36 },
      { z: -0.30, y: 0.98, w: 0.35, h: 0.40 },
      { z: 0.22, y: 0.99, w: 0.34, h: 0.40 },
      { z: 0.62, y: 1.03, w: 0.31, h: 0.37 },
      { z: 0.86, y: 1.06, w: 0.23, h: 0.27 },
    ],
  });
  // Croupe pie : la tache sombre est un volume posé sur le flanc, pas une
  // couleur de section — elle doit mordre sur le dos et s'arrêter net.
  k.loft({
    sides: 8,
    color: dark,
    sections: [
      { z: -0.92, y: 1.02, w: 0.28, h: 0.31 },
      { z: -0.62, y: 1.00, w: 0.345, h: 0.375 },
      { z: -0.34, y: 0.985, w: 0.33, h: 0.375 },
    ],
    cap: false,
  });
  // Pis : la seule chose qui dit « laitière » plutôt que « bovin ».
  k.taper({
    y: 0.66, z: -0.34,
    width: 0.26, depth: 0.32, widthTop: 0.3, depthTop: 0.38,
    height: 0.2,
    color: C.udder,
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.235, 0.60],
    [LIMB.LEG_FRONT_RIGHT, 0.235, 0.60],
    [LIMB.LEG_REAR_LEFT, -0.245, -0.62],
    [LIMB.LEG_REAR_RIGHT, 0.245, -0.62],
  ]) {
    k.leg({
      limb, x, z,
      top: 0.84,
      bend: z > 0 ? 0.05 : -0.08,
      width: 0.15,
      widthFoot: 0.085,
      foot: 0.1,
      footHeight: 0.11,
      color: coat,
      footColor: C.hoof,
    });
  }

  // Encolure et tête : un seul membre, pivot au garrot.
  k.part(LIMB.HEAD, [0, 1.1, 0.72], (h) => {
    h.bone({
      from: { y: 1.1, z: 0.72 },
      to: { y: 1.38, z: 1.22 },
      width: 0.3, depth: 0.34,
      widthEnd: 0.22, depthEnd: 0.24,
      color: coat,
    });
    // Crâne, puis chanfrein qui s'affine jusqu'au mufle. L'ensemble mesure
    // 0,95 m depuis le pivot — c'est ce qu'il faut pour que le mufle touche
    // l'herbe quand l'encolure se rabat (voir l'en-tête).
    h.bone({
      from: { y: 1.38, z: 1.22 },
      to: { y: 1.3, z: 1.56 },
      width: 0.22, depth: 0.24,
      widthEnd: 0.16, depthEnd: 0.17,
      color: coat,
    });
    h.taper({
      y: 1.18, z: 1.62,
      width: 0.17, depth: 0.13, widthTop: 0.15, depthTop: 0.12,
      height: 0.12,
      color: C.muzzle,
    });
    for (const side of [-1, 1]) {
      h.box({ width: 0.05, height: 0.05, depth: 0.05, x: side * 0.09, y: 1.4, z: 1.36, color: C.eye });
    }
    h.horns({ x: 0.09, y: 1.46, z: 1.26, length: 0.16, width: 0.045, sweep: 0.5, color: C.horn });
    h.ears({ x: 0.15, y: 1.38, z: 1.25, length: 0.17, width: 0.07, depth: 0.11, tilt: 0.1, spread: 1.25, color: coat });
    h.muzzle([0, 1.18, 1.68]);
  });

  k.tail({ y: 1.04, z: -1.02, length: 0.62, width: 0.055, droop: 0.97, tuft: { length: 0.14, width: 0.07, color: robe(0.35) }, color: coat });
  return k;
}

/**
 * Mouton : une masse laineuse posée bas sur des pattes courtes et sombres.
 *
 * Toute la lecture tient au contraste entre la toison — claire, large,
 * informe — et la tête et les pattes, sombres et fines. La toison est donc
 * lâche (sections larges, peu de galbe) et déborde sur le haut des pattes,
 * comme une vraie.
 */
export function sheep(C) {
  const k = new AnimalKit(C);
  const fleece = robe(1);
  const bare = robe(0.3);

  k.loft({
    sides: 7,
    color: fleece,
    colorBelly: robe(0.85),
    sections: [
      { z: -0.52, y: 0.56, w: 0.20, h: 0.20 },
      { z: -0.34, y: 0.58, w: 0.29, h: 0.28 },
      { z: 0.0, y: 0.58, w: 0.31, h: 0.30 },
      { z: 0.3, y: 0.59, w: 0.29, h: 0.28 },
      { z: 0.46, y: 0.6, w: 0.21, h: 0.21 },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.15, 0.28],
    [LIMB.LEG_FRONT_RIGHT, 0.15, 0.28],
    [LIMB.LEG_REAR_LEFT, -0.16, -0.3],
    [LIMB.LEG_REAR_RIGHT, 0.16, -0.3],
  ]) {
    k.leg({
      limb, x, z,
      top: 0.46,
      bend: z > 0 ? 0.03 : -0.05,
      width: 0.085,
      widthFoot: 0.055,
      footHeight: 0.07,
      color: bare,
      footColor: C.hoof,
    });
  }

  // Pivot bas et en retrait : l'encolure d'un mouton part du poitrail, pas du
  // garrot. C'est ce qui lui donne la portée nécessaire pour atteindre l'herbe.
  k.part(LIMB.HEAD, [0, 0.56, 0.38], (h) => {
    h.bone({ from: { y: 0.56, z: 0.38 }, to: { y: 0.8, z: 0.6 }, width: 0.17, depth: 0.19, widthEnd: 0.13, depthEnd: 0.14, color: fleece });
    h.bone({ from: { y: 0.8, z: 0.6 }, to: { y: 0.72, z: 0.86 }, width: 0.13, depth: 0.15, widthEnd: 0.09, depthEnd: 0.1, color: bare });
    h.box({ width: 0.09, height: 0.07, depth: 0.05, y: 0.68, z: 0.87, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.035, height: 0.035, depth: 0.035, x: side * 0.06, y: 0.78, z: 0.72, color: C.eye });
    }
    // Oreilles tombantes : elles pendent presque à l'horizontale, c'est le
    // repère qui sépare le mouton de la chèvre à cette distance.
    h.ears({ x: 0.09, y: 0.78, z: 0.62, length: 0.13, width: 0.05, depth: 0.08, tilt: 0.35, spread: 1.5, color: bare });
    h.muzzle([0, 0.68, 0.92]);
  });

  k.tail({ y: 0.6, z: -0.5, length: 0.14, width: 0.06, droop: 0.9, color: fleece });
  return k;
}

/**
 * Chèvre : plus petite et plus sèche qu'un mouton, l'arrière-main haute, des
 * cornes rabattues vers l'arrière et une barbiche. Elle se tient plus droite
 * qu'un mouton et regarde plus souvent : `grazeRad` la relève plus vite.
 */
export function goat(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(0.8),
    sections: [
      { z: -0.46, y: 0.62, w: 0.15, h: 0.18 },
      { z: -0.28, y: 0.62, w: 0.22, h: 0.25 },
      { z: 0.02, y: 0.6, w: 0.23, h: 0.26 },
      { z: 0.28, y: 0.62, w: 0.21, h: 0.24 },
      { z: 0.44, y: 0.64, w: 0.15, h: 0.18 },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.12, 0.26],
    [LIMB.LEG_FRONT_RIGHT, 0.12, 0.26],
    [LIMB.LEG_REAR_LEFT, -0.13, -0.28],
    [LIMB.LEG_REAR_RIGHT, 0.13, -0.28],
  ]) {
    k.leg({ limb, x, z, top: 0.5, bend: z > 0 ? 0.03 : -0.06, width: 0.075, widthFoot: 0.05, footHeight: 0.06, color: coat, footColor: C.hoof });
  }

  k.part(LIMB.HEAD, [0, 0.6, 0.36], (h) => {
    h.bone({ from: { y: 0.6, z: 0.36 }, to: { y: 0.9, z: 0.58 }, width: 0.14, depth: 0.16, widthEnd: 0.11, depthEnd: 0.12, color: coat });
    h.bone({ from: { y: 0.9, z: 0.58 }, to: { y: 0.86, z: 0.8 }, width: 0.11, depth: 0.13, widthEnd: 0.075, depthEnd: 0.09, color: coat });
    h.box({ width: 0.07, height: 0.06, depth: 0.045, y: 0.83, z: 0.81, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.03, height: 0.03, depth: 0.03, x: side * 0.055, y: 0.89, z: 0.7, color: C.eye });
    }
    // Barbiche : trois centimètres qui font toute la différence avec une brebis.
    h.taper({ y: 0.7, z: 0.74, width: 0.05, depth: 0.05, widthTop: 0.03, depthTop: 0.03, height: 0.1, tilt: -0.3, color: robe(0.5) });
    h.horns({ x: 0.055, y: 0.92, z: 0.6, length: 0.2, width: 0.032, sweep: 1.4, color: C.horn });
    h.ears({ x: 0.09, y: 0.89, z: 0.58, length: 0.13, width: 0.045, depth: 0.07, tilt: 0.15, spread: 1.15, color: coat });
    h.muzzle([0, 0.83, 0.86]);
  });

  k.tail({ y: 0.65, z: -0.44, length: 0.11, width: 0.04, droop: -0.5, color: coat });
  return k;
}

/**
 * Cheval : la plus grande silhouette d'un pré, et la plus reconnaissable —
 * l'encolure part du garrot vers le haut et vers l'avant, presque à
 * quarante-cinq degrés, ce qu'aucune autre bête d'ici ne fait.
 *
 * Crinière et queue sont d'un gris fixe, pas de la robe : un alezan a
 * rarement la crinière de sa robe, et une crinière teintée comme le corps
 * efface la ligne d'encolure.
 */
export function horse(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 8,
    color: coat,
    colorBelly: robe(0.82),
    sections: [
      { z: -1.05, y: 1.28, w: 0.18, h: 0.22 },
      { z: -0.8, y: 1.26, w: 0.34, h: 0.4 },
      { z: -0.35, y: 1.2, w: 0.36, h: 0.44 },
      { z: 0.2, y: 1.2, w: 0.35, h: 0.45 },
      { z: 0.65, y: 1.26, w: 0.32, h: 0.42 },
      { z: 0.9, y: 1.3, w: 0.24, h: 0.3 },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.24, 0.66],
    [LIMB.LEG_FRONT_RIGHT, 0.24, 0.66],
    [LIMB.LEG_REAR_LEFT, -0.25, -0.72],
    [LIMB.LEG_REAR_RIGHT, 0.25, -0.72],
  ]) {
    k.leg({
      limb, x, z,
      top: 1.02,
      // Le jarret d'un cheval est franc : c'est lui qui donne l'arrière-main.
      bend: z > 0 ? 0.06 : -0.14,
      knee: 0.55,
      width: 0.17,
      widthFoot: 0.085,
      foot: 0.1,
      footHeight: 0.1,
      color: coat,
      footColor: C.hoof,
    });
  }

  // L'encolure d'un cheval naît du poitrail, bien sous le garrot : c'est ce
  // qui lui donne son arc, et la portée pour atteindre l'herbe sans plier les
  // antérieurs.
  k.part(LIMB.HEAD, [0, 1.24, 0.72], (h) => {
    h.bone({ from: { y: 1.24, z: 0.72 }, to: { y: 1.84, z: 1.18 }, width: 0.26, depth: 0.38, widthEnd: 0.18, depthEnd: 0.24, color: coat });
    h.bone({ from: { y: 1.84, z: 1.18 }, to: { y: 1.78, z: 1.6 }, width: 0.18, depth: 0.24, widthEnd: 0.13, depthEnd: 0.16, color: coat });
    h.taper({ y: 1.68, z: 1.64, width: 0.14, depth: 0.12, widthTop: 0.13, depthTop: 0.13, height: 0.12, color: robe(0.55) });
    for (const side of [-1, 1]) {
      h.box({ width: 0.045, height: 0.045, depth: 0.045, x: side * 0.085, y: 1.84, z: 1.4, color: C.eye });
    }
    // Crinière : une crête posée sur l'encolure, du garrot aux oreilles.
    h.bone({ from: { y: 1.3, z: 0.68 }, to: { y: 1.92, z: 1.16 }, width: 0.07, depth: 0.2, widthEnd: 0.06, depthEnd: 0.14, color: C.mane });
    h.ears({ x: 0.07, y: 1.88, z: 1.2, length: 0.14, width: 0.05, depth: 0.06, tilt: -0.1, spread: 0.25, color: coat });
    h.muzzle([0, 1.68, 1.72]);
  });

  k.tail({ y: 1.3, z: -1.04, length: 0.85, width: 0.1, widthEnd: 0.08, droop: 0.96, color: C.mane });
  return k;
}

/**
 * Âne : le cheval en plus petit et plus trapu, sauf trois choses qui le
 * trahissent avant sa taille — des oreilles deux fois trop longues, une
 * encolure droite au lieu d'arquée, et la croix sombre sur le garrot.
 */
export function donkey(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);
  const dark = robe(0.5);

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(1.15),
    sections: [
      { z: -0.8, y: 0.96, w: 0.16, h: 0.2 },
      { z: -0.6, y: 0.95, w: 0.27, h: 0.32 },
      { z: -0.2, y: 0.92, w: 0.29, h: 0.35 },
      { z: 0.25, y: 0.93, w: 0.28, h: 0.35 },
      { z: 0.56, y: 0.97, w: 0.25, h: 0.31 },
      { z: 0.74, y: 1.0, w: 0.19, h: 0.23 },
    ],
  });
  // La croix de Saint-André : une bande sur le garrot, une le long du dos.
  k.box({ width: 0.5, height: 0.04, depth: 0.09, y: 1.22, z: 0.4, color: dark });
  k.box({ width: 0.09, height: 0.04, depth: 1.2, y: 1.22, z: -0.1, color: dark });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.19, 0.5],
    [LIMB.LEG_FRONT_RIGHT, 0.19, 0.5],
    [LIMB.LEG_REAR_LEFT, -0.2, -0.55],
    [LIMB.LEG_REAR_RIGHT, 0.2, -0.55],
  ]) {
    k.leg({ limb, x, z, top: 0.78, bend: z > 0 ? 0.04 : -0.1, width: 0.13, widthFoot: 0.07, foot: 0.08, footHeight: 0.08, color: coat, footColor: C.hoof });
  }

  k.part(LIMB.HEAD, [0, 0.94, 0.6], (h) => {
    h.bone({ from: { y: 0.94, z: 0.6 }, to: { y: 1.4, z: 0.9 }, width: 0.21, depth: 0.26, widthEnd: 0.16, depthEnd: 0.18, color: coat });
    h.bone({ from: { y: 1.4, z: 0.9 }, to: { y: 1.34, z: 1.22 }, width: 0.16, depth: 0.18, widthEnd: 0.12, depthEnd: 0.14, color: coat });
    h.taper({ y: 1.24, z: 1.26, width: 0.13, depth: 0.11, widthTop: 0.12, depthTop: 0.12, height: 0.1, color: robe(1.35) });
    for (const side of [-1, 1]) {
      h.box({ width: 0.04, height: 0.04, depth: 0.04, x: side * 0.07, y: 1.41, z: 1.08, color: C.eye });
    }
    h.ears({ x: 0.07, y: 1.44, z: 0.96, length: 0.32, width: 0.07, depth: 0.09, tilt: 0.05, spread: 0.22, color: coat });
    h.muzzle([0, 1.24, 1.32]);
  });

  k.tail({ y: 0.98, z: -0.78, length: 0.5, width: 0.05, droop: 0.98, tuft: { length: 0.16, width: 0.07, color: dark }, color: coat });
  return k;
}

/**
 * Poule : trente centimètres, mais trente centimètres qu'on regarde. Corps
 * ovoïde incliné vers l'avant, queue relevée, crête et caroncule rouges — la
 * seule pièce du catalogue dont la couleur fixe (le rouge) est plus lisible
 * que la robe.
 *
 * Deux pattes seulement : les codes de membre des pattes arrière restent
 * inutilisés, ce qui est sans effet — le shader ne fait tourner que les
 * membres présents.
 */
export function chicken(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 6,
    color: coat,
    colorBelly: robe(0.85),
    sections: [
      { z: -0.16, y: 0.24, w: 0.05, h: 0.06 },
      { z: -0.08, y: 0.21, w: 0.1, h: 0.11 },
      { z: 0.04, y: 0.2, w: 0.11, h: 0.12 },
      { z: 0.14, y: 0.22, w: 0.08, h: 0.09 },
    ],
  });
  // Queue en éventail, relevée : c'est elle qui fait la silhouette de poule
  // plutôt que de perdrix.
  k.part(LIMB.TAIL, [0, 0.26, -0.13], (t) => {
    t.taper({ y: 0.26, z: -0.13, tilt: -0.9, width: 0.02, depth: 0.1, widthTop: 0.015, depthTop: 0.16, height: 0.18, color: robe(0.7) });
  });

  for (const [limb, x] of [[LIMB.LEG_FRONT_LEFT, -0.05], [LIMB.LEG_FRONT_RIGHT, 0.05]]) {
    k.leg({ limb, x, z: 0.0, top: 0.16, bend: -0.02, width: 0.022, widthFoot: 0.018, foot: 0.035, footHeight: 0.02, color: C.beak, footColor: C.beak });
  }

  // Pivot au bas du cou : une poule qui picore déploie une encolure qu'on ne
  // lui soupçonne pas au repos, et c'est tout le mouvement qu'on lui voit.
  k.part(LIMB.HEAD, [0, 0.2, 0.04], (h) => {
    h.bone({ from: { y: 0.2, z: 0.04 }, to: { y: 0.36, z: 0.13 }, width: 0.06, depth: 0.06, widthEnd: 0.07, depthEnd: 0.08, color: coat });
    h.box({ width: 0.03, height: 0.03, depth: 0.05, y: 0.36, z: 0.16, color: C.beak });
    h.box({ width: 0.018, height: 0.06, depth: 0.05, y: 0.41, z: 0.12, color: C.comb });
    h.box({ width: 0.025, height: 0.04, depth: 0.03, y: 0.31, z: 0.15, color: C.comb });
    for (const side of [-1, 1]) {
      h.box({ width: 0.016, height: 0.016, depth: 0.016, x: side * 0.032, y: 0.375, z: 0.13, color: C.eye });
    }
    h.muzzle([0, 0.36, 0.2]);
  });
  return k;
}
