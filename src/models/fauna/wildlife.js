/*
 * fauna/wildlife — ce qu'on aperçoit, et qu'on n'a pas le temps de détailler.
 * --------------------------------------------------------------------------
 * Cerf, biche, renne, sanglier, renard, loup, ours.
 *
 * Une bête sauvage ne se voit pas comme une vache. On la voit **une fois**,
 * de loin, souvent en lisière, souvent en train de partir. Ce qui doit être
 * juste n'est donc pas le détail mais le **profil** : le coin d'un sanglier,
 * la ligne de dos plongeante d'un loup, la bosse d'épaules d'un ours, la
 * queue du renard qui fait la moitié de l'animal.
 *
 * ## Herbivores et carnivores ne portent pas la tête pareil
 *
 * Un cervidé a l'encolure dressée et la rabat pour brouter, comme une vache.
 * Un canidé porte la tête **dans l'axe du dos**, à hauteur d'épaule : elle ne
 * plonge pas pour manger, elle plonge pour flairer, et bien moins bas. C'est
 * la raison des `grazeRad` très différents d'une famille à l'autre
 * (voir `index.js`) — et ce qui rend absurde un loup animé comme un mouton.
 *
 * ## Le corps du cervidé est mutualisé
 *
 * Cerf et biche sont la même bête à trois différences près : les bois, la
 * taille, et la longueur des oreilles (une biche les a plus grandes,
 * proportionnellement, ce qui est un vrai repère de terrain). `cervid` les
 * porte ensemble ; les deux entrées du catalogue ne font que la régler.
 */

import { AnimalKit, LIMB, robe } from '../animalKit.js';

/**
 * Le corps commun des cervidés, réglé par ses options.
 *
 * @param {boolean} [options.antlered] Porte des bois.
 * @param {number}  [options.rake] Rabattement des bois vers l'avant, en
 *        mètres — nul pour un cerf, franc pour un renne.
 * @param {number}  [options.rump] Éclat de la croupe (le « miroir »), le
 *        seul repère qui reste quand la bête s'enfuit.
 */
function cervid(C, { scale = 1, antlered = false, tines = 3, antlerLength = 0.42, rake = 0, earLength = 0.16, rump = 1.5, neckColor = null } = {}) {
  const k = new AnimalKit(C);
  const coat = robe(1);
  const s = scale;
  const y = (v) => v * s;
  const z = (v) => v * s;

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(1.25),
    sections: [
      { z: z(-0.72), y: y(0.94), w: 0.13 * s, h: 0.17 * s },
      { z: z(-0.52), y: y(0.93), w: 0.22 * s, h: 0.28 * s },
      { z: z(-0.15), y: y(0.9), w: 0.24 * s, h: 0.31 * s },
      { z: z(0.25), y: y(0.93), w: 0.24 * s, h: 0.32 * s },
      { z: z(0.55), y: y(0.98), w: 0.21 * s, h: 0.28 * s },
      { z: z(0.7), y: y(1.02), w: 0.15 * s, h: 0.2 * s },
    ],
  });
  // Le miroir : la tache claire de la croupe. Posée en volume et non en
  // couleur de section, elle mord sur le dos et s'arrête net — c'est ce
  // qu'on voit d'une bête qui détale, et souvent la seule chose qu'on voit.
  k.loft({
    sides: 7,
    color: robe(rump),
    cap: false,
    sections: [
      { z: z(-0.68), y: y(0.94), w: 0.15 * s, h: 0.19 * s },
      { z: z(-0.5), y: y(0.93), w: 0.225 * s, h: 0.285 * s },
    ],
  });

  for (const [limb, lx, lz] of [
    [LIMB.LEG_FRONT_LEFT, -0.15, 0.44],
    [LIMB.LEG_FRONT_RIGHT, 0.15, 0.44],
    [LIMB.LEG_REAR_LEFT, -0.16, -0.48],
    [LIMB.LEG_REAR_RIGHT, 0.16, -0.48],
  ]) {
    k.leg({
      limb,
      x: lx * s,
      z: z(lz),
      top: y(0.78),
      // Un cervidé a le jarret très fermé : c'est ce qui lui donne sa détente
      // et, au repos, sa ligne d'arrière-main.
      bend: lz > 0 ? 0.04 * s : -0.13 * s,
      knee: 0.58,
      width: 0.085 * s,
      widthFoot: 0.045 * s,
      foot: 0.055 * s,
      footHeight: 0.07 * s,
      color: coat,
      footColor: C.hoof,
    });
  }

  const neck = neckColor || coat;
  // Pivot au bas de l'encolure, en avant du garrot : un cervidé broute sans
  // fléchir les antérieurs, ce que la longueur seule ne suffit pas à donner.
  k.part(LIMB.HEAD, [0, y(0.98), z(0.55)], (h) => {
    h.bone({
      from: { y: y(0.98), z: z(0.55) },
      to: { y: y(1.52), z: z(0.85) },
      width: 0.17 * s, depth: 0.22 * s,
      widthEnd: 0.13 * s, depthEnd: 0.15 * s,
      color: neck,
    });
    h.bone({
      from: { y: y(1.52), z: z(0.85) },
      to: { y: y(1.52), z: z(1.12) },
      width: 0.13 * s, depth: 0.15 * s,
      widthEnd: 0.09 * s, depthEnd: 0.11 * s,
      color: coat,
    });
    h.box({ width: 0.075 * s, height: 0.06 * s, depth: 0.05 * s, y: y(1.48), z: z(1.15), color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.032 * s, height: 0.032 * s, depth: 0.032 * s, x: side * 0.06 * s, y: y(1.56), z: z(1.0), color: C.eye });
    }
    h.ears({ x: 0.075 * s, y: y(1.58), z: z(0.89), length: earLength * s, width: 0.05 * s, depth: 0.09 * s, tilt: -0.1, spread: 1.0, color: coat });
    if (antlered) {
      h.antlers({
        x: 0.055 * s,
        y: y(1.6),
        z: z(0.9),
        length: antlerLength * s,
        width: 0.035 * s,
        tines,
        spread: 0.4,
        rake: rake * s,
        color: C.antler,
      });
    }
    h.muzzle([0, y(1.48), z(1.2)]);
  });

  k.tail({ y: y(0.98), z: z(-0.7), length: 0.16 * s, width: 0.05 * s, droop: 0.2, color: robe(rump) });
  return k;
}

/** Cerf : le cervidé qui porte les bois. Ce sont eux qu'on lit en premier. */
export function deer(C) {
  return cervid(C, { scale: 1, antlered: true, tines: 3, antlerLength: 0.46, earLength: 0.15 });
}

/**
 * Biche : le même corps, sans bois, un peu plus légère — et les oreilles plus
 * grandes, qui deviennent le repère principal une fois les bois retirés.
 */
export function doe(C) {
  return cervid(C, { scale: 0.92, antlered: false, earLength: 0.2 });
}

/**
 * Renne : le cervidé du Nord. Plus lourd, plus bas sur pattes, l'encolure
 * claire, et des bois immenses rabattus vers l'avant — un renne se
 * reconnaît à ses bois avant sa robe, y compris de dos.
 */
export function reindeer(C) {
  return cervid(C, {
    scale: 1.05,
    antlered: true,
    tines: 3,
    antlerLength: 0.62,
    rake: 0.34,
    earLength: 0.13,
    rump: 1.2,
    neckColor: robe(1.6),
  });
}

/**
 * Sanglier : un coin. Épaules hautes et massives, croupe qui fuit, tête
 * portée bas dans l'axe du garrot — pas d'encolure visible, c'est ça qui le
 * distingue de tout le reste, bien avant ses défenses.
 *
 * Il ne relève presque jamais la tête : `grazeRad` est faible et la pose de
 * repos est déjà basse.
 */
export function boar(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(0.8),
    sections: [
      { z: -0.62, y: 0.5, w: 0.12, h: 0.14 },
      { z: -0.44, y: 0.52, w: 0.21, h: 0.22 },
      { z: -0.1, y: 0.55, w: 0.26, h: 0.28 },
      { z: 0.24, y: 0.62, w: 0.29, h: 0.33 },
      { z: 0.5, y: 0.62, w: 0.24, h: 0.28 },
    ],
  });
  // La crête d'épaules : la bosse de soies dressées qui fait le coin. Sans
  // elle le profil est celui d'un mouton sombre.
  k.taper({
    y: 0.86, z: 0.14,
    width: 0.1, depth: 0.4, widthTop: 0.03, depthTop: 0.3,
    height: 0.12,
    color: robe(0.65),
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.17, 0.26],
    [LIMB.LEG_FRONT_RIGHT, 0.17, 0.26],
    [LIMB.LEG_REAR_LEFT, -0.16, -0.36],
    [LIMB.LEG_REAR_RIGHT, 0.16, -0.36],
  ]) {
    k.leg({ limb, x, z, top: 0.46, bend: z > 0 ? 0.03 : -0.07, width: 0.1, widthFoot: 0.055, foot: 0.06, footHeight: 0.06, color: robe(0.7), footColor: C.hoof });
  }

  // Tête sans encolure : elle part du garrot vers l'avant et vers le bas.
  k.part(LIMB.HEAD, [0, 0.7, 0.44], (h) => {
    h.bone({ from: { y: 0.7, z: 0.44 }, to: { y: 0.56, z: 0.82 }, width: 0.22, depth: 0.28, widthEnd: 0.14, depthEnd: 0.18, color: coat });
    h.taper({ y: 0.48, z: 0.86, width: 0.13, depth: 0.16, widthTop: 0.11, depthTop: 0.13, height: 0.1, tilt: 1.3, color: robe(0.8) });
    h.box({ width: 0.1, height: 0.07, depth: 0.05, y: 0.44, z: 0.99, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.03, height: 0.03, depth: 0.03, x: side * 0.075, y: 0.63, z: 0.72, color: C.eye });
      // Défenses : deux traits clairs, courts, relevés vers l'extérieur.
      h.bone({ x: side * 0.06, from: { y: 0.44, z: 0.94 }, to: { y: 0.56, z: 0.99 }, width: 0.025, widthEnd: 0.012, color: C.tusk });
    }
    h.ears({ x: 0.09, y: 0.72, z: 0.6, length: 0.12, width: 0.055, depth: 0.05, tilt: -0.25, spread: 0.5, color: coat });
    h.muzzle([0, 0.44, 1.04]);
  });

  k.tail({ y: 0.55, z: -0.6, length: 0.22, width: 0.028, droop: 0.9, tuft: { length: 0.06, width: 0.045, color: robe(0.6) }, color: coat });
  return k;
}

/**
 * Le corps commun des canidés — renard et loup sont la même bête à l'échelle,
 * au port de queue et à la finesse près.
 *
 * Différence de fond avec un herbivore : la tête est **dans l'axe du dos**,
 * pas au-dessus. Un canidé modelé avec l'encolure d'un cervidé ressemble à un
 * lama, ce qui est exactement l'erreur à ne pas refaire.
 */
function canid(C, { scale = 1, tailLength = 0.5, tailWidth = 0.09, tailDroop = 0.55, earLength = 0.16, muzzle = 0.24, chestDepth = 1, socks = null } = {}) {
  const k = new AnimalKit(C);
  const coat = robe(1);
  const s = scale;

  k.loft({
    sides: 7,
    color: coat,
    colorBelly: robe(1.4),
    sections: [
      { z: -0.5 * s, y: 0.62 * s, w: 0.1 * s, h: 0.12 * s },
      { z: -0.34 * s, y: 0.62 * s, w: 0.17 * s, h: 0.19 * s },
      { z: -0.02 * s, y: 0.6 * s, w: 0.18 * s, h: 0.2 * s },
      { z: 0.3 * s, y: 0.62 * s, w: 0.19 * s, h: 0.24 * s * chestDepth },
      { z: 0.48 * s, y: 0.64 * s, w: 0.15 * s, h: 0.18 * s },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.115, 0.3],
    [LIMB.LEG_FRONT_RIGHT, 0.115, 0.3],
    [LIMB.LEG_REAR_LEFT, -0.12, -0.34],
    [LIMB.LEG_REAR_RIGHT, 0.12, -0.34],
  ]) {
    k.leg({
      limb,
      x: x * s,
      z: z * s,
      top: 0.52 * s,
      bend: z > 0 ? 0.025 * s : -0.09 * s,
      knee: 0.55,
      width: 0.07 * s,
      widthFoot: 0.045 * s,
      foot: 0.055 * s,
      footHeight: 0.05 * s,
      color: socks ? robe(socks) : coat,
      footColor: C.claw,
    });
  }

  k.part(LIMB.HEAD, [0, 0.6 * s, 0.4 * s], (h) => {
    // Encolure courte et presque horizontale : la tête prolonge le dos.
    h.bone({
      from: { y: 0.6 * s, z: 0.4 * s },
      to: { y: 0.72 * s, z: 0.62 * s },
      width: 0.15 * s, depth: 0.17 * s,
      widthEnd: 0.13 * s, depthEnd: 0.14 * s,
      color: coat,
    });
    // Museau effilé : c'est lui, et pas la taille, qui fait « canidé ».
    h.bone({
      from: { y: 0.72 * s, z: 0.62 * s },
      to: { y: 0.68 * s, z: (0.62 + muzzle) * s },
      width: 0.09 * s, depth: 0.1 * s,
      widthEnd: 0.05 * s, depthEnd: 0.055 * s,
      color: coat,
    });
    h.box({ width: 0.035 * s, height: 0.03 * s, depth: 0.03 * s, y: 0.67 * s, z: (0.63 + muzzle) * s, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.028 * s, height: 0.028 * s, depth: 0.028 * s, x: side * 0.055 * s, y: 0.76 * s, z: 0.66 * s, color: C.eye });
    }
    // Oreilles dressées et triangulaires, plantées haut sur le crâne.
    h.ears({ x: 0.06 * s, y: 0.78 * s, z: 0.6 * s, length: earLength * s, width: 0.07 * s, depth: 0.045 * s, tilt: -0.05, spread: 0.3, color: coat });
    h.muzzle([0, 0.67 * s, (0.66 + muzzle) * s]);
  });

  k.tail({
    y: 0.62 * s,
    z: -0.5 * s,
    length: tailLength * s,
    width: tailWidth * s,
    widthEnd: tailWidth * s * 0.75,
    droop: tailDroop,
    tuft: { length: 0.09 * s, width: tailWidth * s * 0.9, color: robe(1.6) },
    color: coat,
  });
  return k;
}

/**
 * Renard : petit, bas, et une queue qui fait presque la longueur du corps —
 * c'est elle qu'on voit, avant la robe. Manchettes sombres aux quatre pattes
 * et bout de queue blanc, les deux repères qui restent à cinquante mètres.
 */
export function fox(C) {
  return canid(C, {
    scale: 0.72,
    tailLength: 0.62,
    tailWidth: 0.13,
    tailDroop: 0.35,
    earLength: 0.2,
    muzzle: 0.26,
    socks: 0.28,
  });
}

/**
 * Loup : deux fois le renard, le poitrail profond, la queue portée basse et
 * les pattes hautes. Ce qui le distingue d'un gros chien, c'est la ligne :
 * dos droit, arrière-main un peu plus basse que le garrot.
 */
export function wolf(C) {
  return canid(C, {
    scale: 1.28,
    tailLength: 0.42,
    tailWidth: 0.1,
    tailDroop: 0.85,
    earLength: 0.13,
    muzzle: 0.22,
    chestDepth: 1.15,
  });
}

/**
 * Ours : une masse. Pas de silhouette élancée à tenir, deux choses à rendre
 * justes — la **bosse d'épaules**, plus haute que la croupe, et l'absence de
 * queue. Le reste (petites oreilles rondes, museau court et clair, pattes
 * courtes et larges) est du détail qui confirme.
 */
export function bear(C) {
  const k = new AnimalKit(C);
  const coat = robe(1);

  k.loft({
    sides: 8,
    color: coat,
    colorBelly: robe(0.78),
    sections: [
      { z: -0.9, y: 0.82, w: 0.24, h: 0.28 },
      { z: -0.6, y: 0.84, w: 0.35, h: 0.38 },
      { z: -0.15, y: 0.84, w: 0.38, h: 0.42 },
      { z: 0.3, y: 0.9, w: 0.4, h: 0.46 },
      { z: 0.62, y: 0.88, w: 0.33, h: 0.38 },
      { z: 0.8, y: 0.84, w: 0.24, h: 0.28 },
    ],
  });
  // La bosse : le garrot d'un ours est un muscle, pas un os. Elle doit être
  // au-dessus des antérieures et retomber vers la croupe.
  k.loft({
    sides: 8,
    cap: false,
    color: robe(0.92),
    sections: [
      { z: 0.02, y: 0.92, w: 0.3, h: 0.36 },
      { z: 0.3, y: 0.96, w: 0.38, h: 0.45 },
      { z: 0.56, y: 0.9, w: 0.31, h: 0.37 },
    ],
  });

  for (const [limb, x, z] of [
    [LIMB.LEG_FRONT_LEFT, -0.26, 0.45],
    [LIMB.LEG_FRONT_RIGHT, 0.26, 0.45],
    [LIMB.LEG_REAR_LEFT, -0.27, -0.55],
    [LIMB.LEG_REAR_RIGHT, 0.27, -0.55],
  ]) {
    k.leg({
      limb, x, z,
      top: 0.62,
      bend: z > 0 ? 0.03 : -0.06,
      knee: 0.45,
      width: 0.2,
      widthFoot: 0.16,
      // Plantigrade : un ours pose toute la plante, pas une pointe de sabot.
      foot: 0.19,
      footHeight: 0.09,
      color: coat,
      footColor: C.claw,
    });
  }

  k.part(LIMB.HEAD, [0, 0.82, 0.66], (h) => {
    h.bone({ from: { y: 0.82, z: 0.66 }, to: { y: 0.92, z: 0.98 }, width: 0.3, depth: 0.32, widthEnd: 0.25, depthEnd: 0.26, color: coat });
    h.bone({ from: { y: 0.92, z: 0.98 }, to: { y: 0.84, z: 1.22 }, width: 0.2, depth: 0.2, widthEnd: 0.14, depthEnd: 0.14, color: robe(1.35) });
    h.box({ width: 0.09, height: 0.07, depth: 0.06, y: 0.83, z: 1.24, color: C.nose });
    for (const side of [-1, 1]) {
      h.box({ width: 0.04, height: 0.04, depth: 0.04, x: side * 0.09, y: 0.98, z: 1.04, color: C.eye });
    }
    // Oreilles rondes, petites, très écartées — l'autre repère de l'ours.
    h.ears({ x: 0.16, y: 1.02, z: 0.88, length: 0.11, width: 0.12, depth: 0.06, tilt: -0.1, spread: 0.5, color: coat });
    h.muzzle([0, 0.83, 1.3]);
  });

  // Pas de `tail` : celle d'un ours mesure dix centimètres et ne se voit pas.
  return k;
}
