/*
 * vegetationLayer — les arbres, en instances. Poussent là où
 * `groundClassMap` dit « bois » — même donnée que le shader du terrain,
 * jamais de contradiction. `groundClassMap` ignore la voirie (un bois
 * traverse une route sans s'interrompre) : c'est cette couche qui refuse de
 * planter dans l'emprise (`roadCorridor`), comme l'herbe et les cultures.
 *
 * Chaque arbre est une paire de quadrilatères croisés (pas un modèle), neuf
 * silhouettes d'atlas, rotation/échelle/teinte propres à chaque instance. Le
 * peuplement (`FOREST_TYPES`, ancré à une maille de terrain) décide des
 * essences, des hauteurs, de la densité ; la couleur dérive par bosquets de
 * quelques dizaines de mètres (`foliageTint`).
 *
 * ## Un bois, deux distances
 *
 * Ce ne sont pas deux couches empilées mais deux échelles de lecture du même
 * bois, comme `coverBands` pour l'herbe :
 *
 *   - **le peuplement** — les arbres faits, semés par tuile, une tuile par
 *     image, statiques une fois posés. C'est la masse qui se lit de loin, et
 *     elle ne bouge jamais sous les yeux ;
 *   - **le sous-étage** — les tiges basses et les buissons, semés dans un
 *     anneau autour de l'observateur (`THICKET_BANDS`) et redistribués en
 *     marchant. À deux cents mètres il n'y a rien à y voir ; à vingt, c'est
 *     tout ce qui manque pour qu'un bois ne soit pas une colonnade. Sa densité
 *     suit la part de sous-bois du peuplement (`thicketDensityFor`) : une
 *     futaie se traverse à pied, un taillis non.
 *
 * Les deux lisent la même part de boisé, le même peuplement, la même emprise
 * routière ; ils ne se recouvrent pas (le peuplement plante des arbres faits,
 * le sous-étage des tiges qui montent vers eux sans les atteindre).
 *
 * ## Trois décisions à ne pas défaire
 *
 * 1. **Chaque candidat tire pour lui seul** (`standDraw`, graine ancrée au sol
 *    par maille). Écarter un arbre — parce qu'il tombe sur la chaussée — n'en
 *    déplace aucun autre. Une suite pseudo-aléatoire parcourue dans l'ordre
 *    faisait exactement le contraire : le premier arbre refusé décalait tout
 *    le reste de la tuile, et le même bois ne se plantait pas deux fois pareil
 *    selon que la route était connue ou non.
 * 2. **Une tuile retient ce qu'elle savait en semant** (`_partial` : carte de
 *    classes *et* portée des emprises) et se resème quand elle en sait plus.
 *    Sans ça une tuile semée à 1 400 m, hors de portée de l'index des
 *    chaussées, plantait des arbres sur la route et ne les enlevait jamais.
 *    La relève est **sans trou** (`_swap`) : le maillage en place ne s'en va
 *    qu'une fois le nouveau construit, sinon la forêt clignote le temps que la
 *    file arrive à cette tuile.
 * 3. **Le plafond d'une tuile éclaircit, il ne rogne pas** (`thinPlacements`),
 *    et il éclaircit sur un tirage porté par l'arbre, pas sur son rang dans la
 *    liste : retirer les arbres tombés sur la chaussée ne doit pas rebattre le
 *    semis de toute la tuile.
 *
 * La strate basse n'est pas une strate haute en réduction : elle tire dans ses
 * propres silhouettes, et chaque plante y porte sa taille (`understoryStrata`).
 * De loin ce sont les arbustes, de près le tapis du sol s'y ajoute.
 *
 * Au bord d'un bois, les deux semis lisent la lisière (`groundClass.woodEdgeAt`)
 * et en tirent la même conséquence : la houppe descend, le fourré épaissit. Un
 * ourlet est en pente et il est dense — c'est ce qui fait qu'un bois se pose sur
 * un champ au lieu d'y être découpé à l'emporte-pièce.
 *
 * Un maquis, une garrigue, une lande ne sont pas des forêts clairsemées : ce
 * sont des tapis d'arbustes sans strate haute, que la carte de classes peint
 * en herbe — `woodAt` y répond zéro et rien n'y pousserait. La couverture
 * (`groundClass.coverAt`) le dit, et c'est elle qui sème ici les buissons hors
 * des bois, dans les deux semis, avec les silhouettes du sous-bois.
 */

import {
  createTreeAtlasCanvas,
  TREE_ATLAS_OFFSETS,
  TREE_ATLAS_COLS,
} from '../materials/proceduralTextures.js';
import { positionSeed, randomAt } from './furniturePlacement.js';
import { inCorridor } from './roadCorridor.js';
import {
  coverBand,
  coverBandRing,
  coverBandFade,
  coverHeightFade,
  coverMassDensity,
  coverBandsRadius,
} from './coverBands.js';
import {
  createFoliageMaterial,
  createFoliageDepthMaterial,
  createCrossedQuads,
  advanceFoliageWind,
  setFoliageWind,
  ATLAS_ATTRIBUTE,
} from '../materials/foliageMaterial.js';
import { defaultTheme } from '../themes/default.js';
import { filterByClimate } from '../core/climate.js';

// --- Le semis : des candidats, pas une suite ------------------------------------
/**
 * Rangs des tirages d'un candidat. Chacun se calcule seul, à partir de la
 * graine de la maille : c'est ce qui permet d'écarter un arbre sans déranger
 * les autres (voir l'en-tête, décision 1).
 */
const SLOT_PRESENCE = 0;
const SLOT_X = 1;
const SLOT_Z = 2;
const SLOT_THIN = 3;
const SLOT_STRATUM = 4;
const SLOT_HEIGHT = 5;
const SLOT_EMERGENT = 6;
const SLOT_ROTATION = 7;
const SLOT_SHADE = 8;
const SLOT_TINT = 9;
const SLOT_VARIANT = 10;
const SLOT_ASPECT = 11;
/** Tirages réservés à un candidat. Le changer redistribue tous les semis. */
export const STAND_SLOTS = 12;

/**
 * Tirage numéro `k` d'une maille, dans [0, 1[. Fonction pure, sans état : deux
 * tirages voisins sont indépendants, et aucun ne dépend de ceux qu'on a lus
 * avant lui.
 *
 * @param {number} seed Graine de la maille (`positionSeed`, ancrée au sol).
 * @param {number} k    Rang du tirage (`indice du candidat × STAND_SLOTS + rang`).
 */
export function standDraw(seed, k) {
  let h = Math.imul(seed ^ Math.imul(k | 0, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- Le peuplement : ce qui se lit de loin ---------------------------------------
/** Côté de la grille de peuplement, par tuile (~36 m par maille au zoom 15). */
export const VEGETATION_CELLS = 24;
/** Arbres attendus dans une maille pleinement boisée, pour un peuplement de densité 1. */
export const TREES_PER_CELL = 14;
/**
 * Candidats tirés par maille. C'est le plafond de densité du peuplement : une
 * maille qui en demanderait davantage (fourré de couverture sur un bois épais)
 * sature, ce qui est le bon comportement — un fourré plein est un fourré plein.
 */
export const STAND_CANDIDATES = 40;
/** Sel de graine du peuplement (le sous-étage a les siens, par bande). */
export const STAND_SALT = 311;
/** Objectif d'arbres par tuile : un budget d'images, tenu par éclaircissement. */
export const MAX_TREES_PER_TILE = 7000;
/** Garde-fou de collecte : jamais plus d'objets intermédiaires que cela. */
export const PLACEMENT_HARD_CAP = MAX_TREES_PER_TILE * 4;
/** Anneau au-delà duquel on ne plante plus (le brouillard s'en charge). */
export const VEGETATION_MAX_RING = 1;
/** En deçà de cette part de boisé, la maille ne reçoit aucun arbre. */
export const WOOD_SCORE_MIN = 0.22;
/** Exposant de la courbe de densité (au-dessus de 1, creuse la différence entre lisière et sous-bois). */
export const WOOD_DENSITY_CURVE = 1.25;

/**
 * Part de boisé ramenée à une densité, de 0 (rien) à 1 (bois plein). Zéro sous
 * le seuil : une lisière qui bave sur un champ n'y plante pas trois arbres.
 * Fonction pure.
 */
export function woodDensity(score) {
  if (!(score >= WOOD_SCORE_MIN)) return 0;
  const normalized = (score - WOOD_SCORE_MIN) / (1 - WOOD_SCORE_MIN);
  return Math.pow(normalized, WOOD_DENSITY_CURVE);
}

/**
 * Arbres attendus dans une maille de peuplement pleinement boisée, sous-bois
 * compris — le sous-bois se compte **en plus** des arbres, un bois sans strate
 * basse se lisant comme une colonnade. Fonction pure.
 */
export function standTreesPerCell(type) {
  return TREES_PER_CELL * (type.density ?? 1) * (1 + (type.understory || 0));
}

/** Part de la strate basse dans un peuplement, de 0 à 1 (`understory` compté en plus). Fonction pure. */
export function lowStratumPart(type) {
  const understory = type.understory || 0;
  return understory / (1 + understory);
}

// --- La lisière ------------------------------------------------------------------
/**
 * Ce que le bord d'un bois porte de strate basse **en plus** de son intérieur.
 * Un ourlet est un fourré : les arbustes y prennent la lumière que la houppe
 * laisse passer sur le côté, ce qu'ils ne peuvent pas faire sous le couvert.
 */
export const EDGE_LOW_GAIN = 0.55;
/**
 * Ce que le bord d'un bois retire à la hauteur du peuplement. La lisière est en
 * pente : les arbres du bord sont plus courts, et c'est ce profil-là — pas une
 * limite nette — qui fait qu'un bois se pose sur un champ au lieu d'y être
 * découpé à l'emporte-pièce.
 */
export const EDGE_CANOPY_DROP = 0.3;

/** Part de strate basse corrigée de la lisière, de 0 à 1. Fonction pure. */
export function edgeLowPart(lowPart, edge) {
  return lowPart + (1 - lowPart) * edge * EDGE_LOW_GAIN;
}

/** Facteur de hauteur du peuplement à la lisière (jamais des buissons : un buisson a sa taille à lui). Fonction pure. */
export function edgeCanopy(edge) {
  return 1 - edge * EDGE_CANOPY_DROP;
}

// --- Le sous-étage : ce qui n'existe qu'à moins de deux cents mètres --------------
/**
 * Les deux échelles du sous-étage. Même doctrine que `GRASS_BANDS` : la maille
 * double, les tirages s'effondrent, le panneau s'élargit pour que la masse
 * reste continue. Budgets d'images, donc du moteur, pas du thème.
 */
export const THICKET_BANDS = [
  coverBand({ from: 0, to: 72, cell: 6, perCell: 8, fadeOut: 14, salt: 401 }),
  coverBand({
    from: 60,
    to: 180,
    cell: 12,
    perCell: 12,
    spread: 1.35,
    rise: 1.1,
    massBias: 0.3,
    fadeIn: 14,
    fadeOut: 45,
    salt: 419,
  }),
];
/** Portée du sous-étage, en mètres — le bord de la dernière bande. */
export const THICKET_RADIUS_M = coverBandsRadius(THICKET_BANDS);
/**
 * Tiges de sous-étage à l'hectare, pour un bois plein et un peuplement de
 * référence. **C'est le réglage de la densité de près** : le peuplement seul
 * pose une centaine d'arbres faits à l'hectare, ce qui suffit à distance et
 * laisse voir au travers dès qu'on y entre.
 */
export const THICKET_PER_HA = 500;
/**
 * Part de sous-bois du peuplement de référence — celui dont le sous-étage vaut
 * exactement `THICKET_PER_HA`. Le reste s'y compare : une futaie entretenue est
 * dégagée au sol (c'est même ce qui la définit) et doit se traverser à pied ;
 * un taillis, lui, *est* son sous-bois.
 */
export const UNDERSTORY_REF = 0.3;
/** Plafond d'instances du sous-étage (bois le plus épais, anneau plein). */
export const THICKET_COUNT = 12000;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const THICKET_REBUILD_M = 12;
/** Plancher de la taille en bord de bande : une tige entre en poussant, elle n'apparaît pas. */
export const THICKET_HEIGHT_FADE_FLOOR = 0.45;

/** Tiges de sous-étage attendues dans une maille pleinement boisée. Fonction pure. */
export function thicketPerCell(density, cell) {
  return THICKET_PER_HA * density * ((cell * cell) / 10000);
}

/**
 * Densité de sous-étage d'un peuplement, rapportée au peuplement de référence.
 * Elle suit sa part de sous-bois, pas seulement sa densité de tiges : deux bois
 * également fournis en houppes ne se traversent pas de la même façon, et c'est
 * au pied que ça se voit. Fonction pure.
 */
export function thicketDensityFor(type) {
  return (type.density ?? 1) * ((type.understory || 0) / UNDERSTORY_REF);
}

// --- Les strates ---------------------------------------------------------------
/** Exposant de la loi des hauteurs (au-dessus de 1, tasse le tirage vers la hauteur minimale). */
export const HEIGHT_CURVE = 1.35;
/** Part d'arbres **dominants**, ceux qui dépassent la houppe commune. */
export const EMERGENT_SHARE = 0.11;
/** Ce qu'un dominant ajoute à la hauteur du peuplement. */
export const EMERGENT_GAIN = 1.3;
/** Hauteur des buissons de sous-bois, en mètres. */
export const BUSH_MIN_HEIGHT = 1.1;
export const BUSH_MAX_HEIGHT = 3.2;
/** Hauteur minimale d'une tige de sous-étage, en mètres : le jeune arbre au-dessus du buisson. */
export const SAPLING_MIN_HEIGHT = 2.2;
/** Largeur d'un buisson, en part de sa hauteur : il est plus large que haut. */
export const BUSH_ASPECT = 1.15;
/** Largeur d'un arbre, en part de sa hauteur, et l'écart d'un arbre à l'autre. */
export const TREE_ASPECT = 0.72;
export const TREE_ASPECT_JITTER = 0.18;

/**
 * Hauteur d'un arbre fait dans son peuplement. Fonction pure.
 *
 * @param {Object} type Peuplement (`FOREST_TYPES`).
 * @param {number} draw Tirage uniforme dans [0, 1[ — la strate.
 * @param {number} pick Second tirage : décide du statut de dominant.
 */
export function treeHeight(type, draw, pick) {
  const span = type.maxHeight - type.minHeight;
  const base = type.minHeight + Math.pow(draw, HEIGHT_CURVE) * span;
  return pick < EMERGENT_SHARE ? base * EMERGENT_GAIN : base;
}

/**
 * Hauteur d'une tige de sous-étage : elle monte vers le peuplement sans
 * l'atteindre — c'est la régénération, pas un arbre fait en réduction. Fonction pure.
 */
export function saplingHeight(type, draw) {
  const top = Math.max(SAPLING_MIN_HEIGHT + 0.5, type.minHeight);
  return SAPLING_MIN_HEIGHT + Math.pow(draw, HEIGHT_CURVE) * (top - SAPLING_MIN_HEIGHT);
}

// --- La teinte -----------------------------------------------------------------
/** Côté de la maille qui fait dériver la teinte, en mètres (plus fin que le peuplement, pour des paquets de verts différents). */
export const CLUMP_TINT_M = 55;
/** Amplitude de la dérive d'un bosquet à l'autre, sur l'axe chaud-froid. */
export const CLUMP_TINT_SPREAD = 0.2;
/** Écart de teinte d'un arbre à l'autre, dans un même bosquet. */
export const TREE_TINT_SPREAD = 0.13;

/**
 * Teinte d'un feuillage : celle du peuplement, dérivée par bosquet puis par
 * arbre, ancrée au lieu. La dérive de bosquet joue sur l'axe chaud-froid
 * (rouge et bleu en sens contraires) pour parcourir le vert sans le désaturer.
 *
 * @param {number[]} hue Teinte du peuplement, trois canaux.
 * @param {number} x Mètres locaux.
 * @param {number} z
 * @param {number} shade Facteur de clarté propre à l'arbre.
 * @param {number} jitter Tirage uniforme dans [0, 1[, propre à l'arbre.
 * @returns {number[]} trois canaux, à multiplier par la texture.
 */
export function foliageTint(hue, x, z, shade, jitter) {
  const gx = Math.floor(x / CLUMP_TINT_M) * CLUMP_TINT_M;
  const gz = Math.floor(z / CLUMP_TINT_M) * CLUMP_TINT_M;
  const drift = (randomAt(gx, gz, 197) - 0.5) * 2;
  const spread = (jitter - 0.5) * 2 * TREE_TINT_SPREAD;
  const warm = drift * CLUMP_TINT_SPREAD;
  return [
    clampChannel(hue[0] * shade * (1 + warm + spread)),
    clampChannel(hue[1] * shade * (1 - Math.abs(warm) * 0.25)),
    clampChannel(hue[2] * shade * (1 - warm - spread)),
  ];
}

function clampChannel(v) {
  return Math.max(0, Math.min(1.25, v));
}

/**
 * Éclaircit un semis trop nombreux sans le rogner : chaque arbre porte son
 * propre tirage d'éclaircie et on garde ceux qui passent sous le seuil.
 *
 * L'éclaircie ne peut pas se faire sur le rang dans la liste : retirer les
 * arbres tombés sur la chaussée décalerait tous les suivants, et la tuile
 * resemée ne serait plus la même. Le compte rendu vaut `max` en espérance, à
 * quelques arbres près — c'est un budget, pas une frontière.
 */
export function thinPlacements(list, max) {
  if (list.length <= max) return list;
  const keep = max / list.length;
  const out = [];
  for (const item of list) if (item.thin < keep) out.push(item);
  return out;
}

/**
 * Gain de connaissance en deçà duquel on ne resème pas une tuile : un carré
 * qui glisse de quelques mètres n'apprend rien de neuf.
 */
export const BLIND_EPSILON = 0.02;

/**
 * Densité d'arbustes semés par une couverture **hors des bois**, de 0 (rien) à
 * 1 (fourré plein). Fonction pure.
 *
 * C'est ce qui distingue un maquis d'un pré : ni l'un ni l'autre n'est un bois
 * pour la carte de classes, mais l'un est couvert d'arbustes et l'autre non.
 *
 * @param {string|null} cover Retour de `groundClass.coverAt`.
 * @param {Object} [covers] Tranche `theme.covers`.
 */
export function coverBushesFor(cover, covers = defaultTheme.covers) {
  const look = cover ? covers?.[cover] : null;
  return look?.bushes ?? 0;
}

/** Côté de la maille qui décide du peuplement, en mètres. */
export const FOREST_PATCH_M = 420;

/**
 * Peuplement d'un point du sol, tiré dans une liste déjà réduite au climat.
 * Ancré au lieu : une forêt garde ses essences quand la bulle se déplace.
 *
 * C'est cette forme-là que les semis appellent, maille après maille : le
 * filtrage climatique alloue, et il n'a rien à faire dans une boucle chaude.
 */
export function standTypeFrom(pool, x, z) {
  const gx = Math.floor(x / FOREST_PATCH_M) * FOREST_PATCH_M;
  const gz = Math.floor(z / FOREST_PATCH_M) * FOREST_PATCH_M;
  const draw = randomAt(gx, gz, 131);
  return pool[Math.min(pool.length - 1, Math.floor(draw * pool.length))];
}

/**
 * Peuplement d'un point du sol. Le climat réduit d'abord la liste à ce qui
 * pousse ici, ce qui empêche un pin d'Alep en Finlande ; sans climat, la liste
 * entière est ouverte.
 */
export function forestTypeAt(x, z, forests = defaultTheme.forests, climate = null) {
  return standTypeFrom(filterByClimate(forests, climate), x, z);
}

/** Variantes d'atlas ouvertes à un peuplement, dans l'ordre de ses essences. */
export function variantsFor(type, essences = defaultTheme.trees.essences) {
  const out = [];
  for (const essence of type.essences) out.push(...(essences[essence] || []));
  return out.length > 0 ? out : [0];
}

/**
 * La strate basse d'un semis : ses silhouettes **et leur taille réelle**.
 *
 * Une fougère ne fait pas trois mètres. Tant que la strate basse n'était qu'une
 * liste de cases d'atlas, tout ce qu'elle portait tirait dans la même
 * fourchette de buisson ; une plante qui déclare sa taille (`heightM`) et sa
 * largeur (`aspect`) l'impose, les autres gardent la fourchette commune.
 *
 * `floor` ouvre le tapis du sol (fougère, ronce, buisson bas) en plus des
 * arbustes. Il n'a de sens que dans le sous-étage : de loin, la strate basse
 * reste faite d'arbustes, une fougère à un kilomètre coûtant une instance sans
 * rien donner à voir.
 *
 * Fonction pure.
 *
 * @param {Object} [trees] Tranche `theme.trees`.
 * @param {boolean} [floor] Vrai pour ouvrir le tapis du sol.
 * @returns {Array<{variant:number, min:number, max:number, aspect:number}>}
 */
export function understoryStrata(trees = defaultTheme.trees, floor = false) {
  const essences = trees.essences || {};
  const pool = floor ? [...(essences.undergrowth || []), ...(essences.bushy || [])] : essences.bushy || [];
  const out = [];
  for (const variant of pool) {
    const look = trees.variants?.[variant];
    const range = look?.heightM;
    out.push({
      variant,
      min: range ? range[0] : BUSH_MIN_HEIGHT,
      max: range ? range[1] : BUSH_MAX_HEIGHT,
      aspect: look?.aspect ?? BUSH_ASPECT,
    });
  }
  // Un thème sans strate basse garde une case d'atlas valide plutôt que rien.
  if (out.length === 0) {
    out.push({ variant: 0, min: BUSH_MIN_HEIGHT, max: BUSH_MAX_HEIGHT, aspect: BUSH_ASPECT });
  }
  return out;
}

/**
 * Décrit un candidat retenu — sa strate, sa hauteur, son port, sa silhouette,
 * sa clarté. Écrit dans l'objet fourni (appelée des dizaines de milliers de
 * fois par tuile) et ne lit que des tirages attachés au candidat.
 *
 * `sapling` distingue les deux semis : le peuplement pose des arbres faits, le
 * sous-étage des tiges qui montent vers eux. La strate basse, elle, ne tire ni
 * l'un ni l'autre : sa taille est celle de la plante tirée (`understoryStrata`).
 *
 * @param {Object} out Objet de travail, rendu tel quel.
 * @param {number} seed Graine de la maille.
 * @param {number} base Rang du premier tirage du candidat.
 * @param {Object} type Peuplement.
 * @param {number} lowPart Part de strate basse dans la maille, de 0 à 1.
 * @param {Array<number>} variants Silhouettes du peuplement.
 * @param {Array<Object>} strata   Strate basse, telle que rendue par `understoryStrata`.
 * @param {boolean} [sapling] Vrai pour le sous-étage.
 */
export function describeTree(out, seed, base, type, lowPart, variants, strata, sapling = false) {
  const low = standDraw(seed, base + SLOT_STRATUM) < lowPart;
  const draw = standDraw(seed, base + SLOT_HEIGHT);
  const pick = standDraw(seed, base + SLOT_VARIANT);

  out.low = low;
  if (low) {
    const plant = strata[Math.floor(pick * strata.length) % strata.length];
    out.variant = plant.variant;
    out.height = plant.min + draw * (plant.max - plant.min);
    out.aspect = plant.aspect;
  } else {
    out.variant = variants[Math.floor(pick * variants.length) % variants.length];
    out.height = sapling
      ? saplingHeight(type, draw)
      : treeHeight(type, draw, standDraw(seed, base + SLOT_EMERGENT));
    out.aspect = TREE_ASPECT + (standDraw(seed, base + SLOT_ASPECT) - 0.5) * 2 * TREE_ASPECT_JITTER;
  }
  out.rotation = standDraw(seed, base + SLOT_ROTATION) * Math.PI;
  // Strate basse plus sombre : elle est à l'ombre des houppes.
  out.shade = (low ? 0.66 : 0.84) + standDraw(seed, base + SLOT_SHADE) * 0.28;
  out.jitter = standDraw(seed, base + SLOT_TINT);
  out.thin = standDraw(seed, base + SLOT_THIN);
  return out;
}

export class VegetationLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — sans elle,
   *        rien ne pousse : on ne devine pas un bois.
   * @param {Object} [options.roads] Façade d'emprise (`index`, et
   *        `knownCoverageOf` pour dire jusqu'où elle sait) — un arbre ne se
   *        plante pas sur la chaussée, même quand le polygone de bois la traverse.
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass = null,
    roads = null,
    maxRing = VEGETATION_MAX_RING,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.roads = roads;
    this.maxRing = maxRing;
    /**
     * Famille climatique du lieu, ou `null` hors de la fenêtre couverte. Elle
     * n'arrive pas par le thème : elle change en cours de route, comme l'heure
     * et la météo, et c'est le compositeur qui la pose (`setClimate`).
     */
    this.climate = null;
    this.disposed = false;

    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    scene.add(this.group);

    this.texture = new THREE.CanvasTexture(
      createTreeAtlasCanvas(undefined, undefined, theme.trees.variants)
    );
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.baseGeometry = createCrossedQuads(THREE);
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      atlas: true,
      tiles: TREE_ATLAS_COLS,
      wind: true, // dix fois plus discret que dans l'herbe
      // 0,05 × `TREE_ASPECT` : l'amplitude se mesure sur la hauteur de l'arbre
      // et non sur la largeur de son panneau (voir `foliageMaterial`). Un arbre
      // moyen bouge autant qu'avant ; une colonne étroite penche un peu plus,
      // une masse de sous-étage élargie beaucoup moins.
      windStrength: 0.05 * TREE_ASPECT,
      cacheKey: 'foliage-atlas-wind-v4',
    });
    this.depthMaterial = createFoliageDepthMaterial({
      THREE,
      map: this.texture,
      tiles: TREE_ATLAS_COLS,
      cacheKey: 'foliage-atlas-depth-v2',
    });

    /** @type {Map<string, Object>} maillages du peuplement, par clé de tuile */
    this.meshes = new Map();
    /** Tuiles construites, y compris celles où rien n'a poussé (sinon reclassée à chaque image en rase campagne). @type {Set<string>} */
    this._planted = new Set();
    /**
     * Ce que chaque tuile savait en semant — carte de classes et portée des
     * emprises confondues. Elle repart en file dès qu'elle en sait davantage.
     * @type {Map<string, number>}
     */
    this._partial = new Map();
    /** Tuiles à resemer. Leur maillage reste en place jusqu'à la relève. @type {Set<string>} */
    this._stale = new Set();
    /** @type {string[]} tuiles à traiter, une par image */
    this.queue = [];

    // Le sous-étage : un maillage jamais réalloué, `count` ajusté, comme l'herbe.
    this._thicketCells = coverBandRing(THICKET_BANDS);
    this._thicketAnchor = null;
    this._thicketFrame = null;
    this._tree = {};

    this.thicketGeometry = this.baseGeometry.clone();
    this._thicketOffsets = new Float32Array(THICKET_COUNT * 2);
    this.thicketGeometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._thicketOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.thicket = new THREE.InstancedMesh(this.thicketGeometry, this.material, THICKET_COUNT);
    this.thicket.name = 'vegetation-thicket';
    this.thicket.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.thicket.count = 0;
    this.thicket.frustumCulled = false; // toujours autour de la caméra
    // Reçoit l'ombre, n'en projette pas : le sous-étage est déjà sous la houppe
    // du peuplement, et la passe d'ombre est l'endroit où un semis de premier
    // plan coûte le plus cher (même arbitrage que l'herbe).
    this.thicket.receiveShadow = true;
    this.group.add(this.thicket);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    this._color = new THREE.Color();
  }

  setMaxAnisotropy(value) {
    this.texture.anisotropy = Math.min(value || 4, 8);
    this.texture.needsUpdate = true;
  }

  /** Fait avancer le vent dans les houppes (l'ombre portée, elle, ne balance pas). */
  advance(delta) {
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo.
   * @param {{amplitude:number, speed:number}} field
   */
  setWind(field) {
    setFoliageWind(this.material, field);
  }

  /**
   * Pose la famille climatique du lieu.
   *
   * @param {string|null} family
   * @returns {boolean} vrai si elle a changé — auquel cas ce qui est déjà
   *          planté l'a été avec les mauvaises essences, et le compositeur
   *          replante (voir `sync({replant: true})`).
   */
  setClimate(family) {
    const next = family || null;
    if (next === this.climate) return false;
    this.climate = next;
    this._thicketAnchor = null; // le sous-étage est du même bois : il change d'essences aussi
    return true;
  }

  /**
   * Accorde le peuplement sur l'état de la bulle : met en file les tuiles
   * proches pas encore semées et celles qui en savent maintenant plus qu'en
   * semant, retire celles qui sont sorties. Idempotent, et assez bon marché
   * pour être appelé à chaque recentrage.
   *
   * @param {boolean} [replant] Vrai quand tout est à reprendre (changement de
   *        climat, arrivée de la carte de classes).
   */
  sync({ replant = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return;

    for (const key of [...this._planted]) {
      const tile = this.bubble.tiles.get(key);
      // Sortie de bulle, anneau devenu trop lointain, ou replantation forcée.
      if (replant || !tile || tile.ring > this.maxRing) {
        this.remove(key);
        continue;
      }
      // « Plus qu'alors », pas « incomplète » : sinon une tuile de coin, qui
      // déborde structurellement du carré couvert, serait resemée à chaque repeinte.
      const before = this._partial.get(key);
      if (before !== undefined && this._knowledgeOf(tile) > before + BLIND_EPSILON) {
        this._stale.add(key);
      }
    }

    this.queue.length = 0;
    for (const tile of this.bubble.tiles.values()) {
      if (tile.ring > this.maxRing) continue;
      if (!this._planted.has(tile.key) || this._stale.has(tile.key)) this.queue.push(tile.key);
    }
  }

  /** Sème au plus une tuile. À appeler une fois par image. */
  processQueue() {
    if (this.disposed || this.queue.length === 0) return false;
    const key = this.queue.shift();
    const tile = this.bubble.tiles.get(key);
    if (!tile) return false;
    if (this._planted.has(key) && !this._stale.has(key)) return false;
    this._planted.add(key);
    this._stale.delete(key);
    try {
      this._build(tile);
    } catch (e) {
      console.warn('[vegetation] tuile non semée', key, e?.message || e);
    }
    return true;
  }

  /** Retire les instances d'une tuile. */
  remove(key) {
    this._planted.delete(key);
    this._partial.delete(key);
    this._stale.delete(key);
    this._swap(key, null);
  }

  /**
   * Met un maillage à la place de celui de la tuile, et défait l'ancien
   * ensuite. L'ordre est la moitié du correctif : retirer d'abord laisserait la
   * forêt absente le temps que la file revienne à cette tuile.
   */
  _swap(key, mesh) {
    const previous = this.meshes.get(key);
    if (mesh) {
      this.group.add(mesh);
      this.meshes.set(key, mesh);
    } else {
      this.meshes.delete(key);
    }
    if (!previous) return;
    this.group.remove(previous);
    previous.geometry.dispose();
    previous.dispose?.();
  }

  /**
   * Ce que la tuile peut savoir d'elle-même, ici et maintenant : la part de son
   * emprise dont la carte de classes parle, et celle sur laquelle les emprises
   * routière et ferroviaire ont quelque chose à dire. La plus faible des deux —
   * une tuile n'est renseignée que si elle l'est des deux côtés.
   */
  _knowledgeOf(tile) {
    const frame = this.bubble?.frame;
    if (!frame || !this.groundClass) return 0;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;
    const maxX = originX + frame.scale;
    const maxZ = originZ + frame.scale;
    const classed = this.groundClass.coverageOf(originX, originZ, maxX, maxZ, frame);
    // Sans façade d'emprise, il n'y a pas de route à ignorer : rien à apprendre.
    const infra = this.roads?.knownCoverageOf?.(originX, originZ, maxX, maxZ) ?? 1;
    return Math.min(classed, infra);
  }

  _build(tile) {
    const { THREE, bubble, groundClass } = this;
    const frame = bubble.frame;
    if (!frame || !groundClass) return;
    const index = this.roads?.index || null;

    const cellSize = frame.scale / VEGETATION_CELLS;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;

    // Prise avant de semer, et retenue pour décider de recommencer plus tard.
    const known = this._knowledgeOf(tile);
    if (known < 1) this._partial.set(tile.key, known);
    else this._partial.delete(tile.key);

    const pool = filterByClimate(this.theme.forests, this.climate);
    // De loin, la strate basse reste faite d'arbustes (voir `understoryStrata`).
    const strata = understoryStrata(this.theme.trees);
    const tree = this._tree;

    const collected = [];
    for (let cy = 0; cy < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cy++) {
      for (let cx = 0; cx < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cx++) {
        const cellX = originX + cx * cellSize;
        const cellZ = originZ + cy * cellSize;
        const centreX = cellX + cellSize * 0.5;
        const centreZ = cellZ + cellSize * 0.5;

        const type = standTypeFrom(pool, centreX, centreZ);
        const stems = woodDensity(groundClass.woodAt(centreX, centreZ)) * standTreesPerCell(type);
        // Fourré de couverture — voir `coverBushesFor`. Il se sème là où il n'y
        // a pas de bois, donc il ne peut pas être conditionné aux tiges.
        const thicket =
          coverBushesFor(groundClass.coverAt?.(centreX, centreZ) ?? null, this.theme.covers) *
          TREES_PER_CELL;
        const expected = stems + thicket;
        if (expected <= 0) continue;

        const share = Math.min(1, expected / STAND_CANDIDATES);
        // L'ourlet : plus de fourré, moins de houppe (voir `EDGE_LOW_GAIN`).
        const edge = groundClass.woodEdgeAt?.(centreX, centreZ) ?? 0;
        const lowPart = edgeLowPart((stems * lowStratumPart(type) + thicket) / expected, edge);
        const canopy = edgeCanopy(edge);
        const variants = variantsFor(type, this.theme.trees.essences);
        const seed = positionSeed(cellX, cellZ, STAND_SALT);

        for (let i = 0; i < STAND_CANDIDATES; i++) {
          const base = i * STAND_SLOTS;
          if (standDraw(seed, base + SLOT_PRESENCE) >= share) continue;

          const x = cellX + standDraw(seed, base + SLOT_X) * cellSize;
          const z = cellZ + standDraw(seed, base + SLOT_Z) * cellSize;
          // Le bois ne s'arrête pas au bord de la route : c'est ici, pas dans la
          // carte de classes, qu'on refuse l'emprise. Écarter ce candidat n'en
          // déplace aucun autre (voir l'en-tête, décision 1).
          if (inCorridor(index, x, z)) continue;

          describeTree(tree, seed, base, type, lowPart, variants, strata);
          collected.push({
            x,
            z,
            y: bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale,
            // Un buisson garde sa taille : c'est la houppe qui descend, pas le sol.
            height: tree.low ? tree.height : tree.height * canopy,
            aspect: tree.aspect,
            rotation: tree.rotation,
            variant: tree.variant,
            shade: tree.shade,
            jitter: tree.jitter,
            thin: tree.thin,
            hue: type.tint,
          });
        }
      }
    }

    const placements = thinPlacements(collected, MAX_TREES_PER_TILE);
    if (placements.length === 0) {
      this._swap(tile.key, null);
      return;
    }

    // Géométrie clonée par tuile : l'attribut d'atlas est une donnée d'instance.
    const geometry = this.baseGeometry.clone();
    const offsets = new Float32Array(placements.length * 2);
    placements.forEach((item, index_) => {
      const [u, v] = TREE_ATLAS_OFFSETS[item.variant];
      offsets[index_ * 2] = u;
      offsets[index_ * 2 + 1] = v;
    });
    geometry.setAttribute(ATLAS_ATTRIBUTE, new THREE.InstancedBufferAttribute(offsets, 2));

    const mesh = new THREE.InstancedMesh(geometry, this.material, placements.length);
    mesh.name = `vegetation-${tile.key}`;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true; // un bois s'ombre lui-même
    mesh.customDepthMaterial = this.depthMaterial;

    placements.forEach((item, index_) => {
      this._compose(item.x, item.y, item.z, item.height, item.aspect, item.rotation);
      mesh.setMatrixAt(index_, this._matrix);
      const [r, g, b] = foliageTint(item.hue, item.x, item.z, item.shade, item.jitter);
      this._color.setRGB(r, g, b);
      mesh.setColorAt(index_, this._color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();

    this._swap(tile.key, mesh);
  }

  /** Matrice d'une instance : rapport largeur/hauteur variable, sinon deux arbres de même hauteur sont la même image à l'échelle près. */
  _compose(x, y, z, height, aspect, rotation) {
    this._position.set(x, y, z);
    this._quaternion.setFromAxisAngle(this._axis, rotation);
    const width = height * aspect;
    this._scale.set(width, height, width);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    return this._matrix;
  }

  /**
   * Redistribue le sous-étage si l'observateur s'est assez éloigné. À appeler
   * une fois par image, comme l'herbe.
   *
   * @param {number} x Position locale de l'observateur.
   * @param {number} z
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return false;

    const frameChanged = this._thicketFrame !== this.bubble.frame;
    if (!force && !frameChanged && this._thicketAnchor) {
      if (Math.hypot(x - this._thicketAnchor.x, z - this._thicketAnchor.z) < THICKET_REBUILD_M) {
        return false;
      }
    }

    this._scatterThicket(x, z);
    this._thicketAnchor = { x, z };
    this._thicketFrame = this.bubble.frame;
    return true;
  }

  /** Sème le sous-étage, bande par bande et maille par maille. */
  _scatterThicket(centerX, centerZ) {
    const { bubble, groundClass, thicket } = this;
    const capacity = thicket.instanceMatrix.count;
    const index = this.roads?.index || null;
    const pool = filterByClimate(this.theme.forests, this.climate);
    // De près, le tapis du sol s'ouvre : fougère, ronce, buisson bas.
    const strata = understoryStrata(this.theme.trees, true);
    const tree = this._tree;
    // Un centre arrondi par bande : les mailles retenues ne dépendent que du sol.
    const bases = THICKET_BANDS.map((band) => ({
      x: Math.round(centerX / band.cell),
      z: Math.round(centerZ / band.cell),
    }));
    let placed = 0;

    if (groundClass) {
      for (const cell of this._thicketCells) {
        if (placed >= capacity) break;

        const band = THICKET_BANDS[cell.band];
        const fade = coverBandFade(cell.distance, band);
        if (fade <= 0.02) continue;

        const base = bases[cell.band];
        const cellX = (base.x + cell.gx) * band.cell;
        const cellZ = (base.z + cell.gz) * band.cell;
        const centreX = cellX + band.cell * 0.5;
        const centreZ = cellZ + band.cell * 0.5;

        const type = standTypeFrom(pool, centreX, centreZ);
        const stems =
          woodDensity(groundClass.woodAt(centreX, centreZ)) *
          thicketPerCell(thicketDensityFor(type), band.cell);
        const thick =
          coverBushesFor(groundClass.coverAt?.(centreX, centreZ) ?? null, this.theme.covers) *
          thicketPerCell(1, band.cell);
        const expected = stems + thick;
        if (expected <= 0) continue;

        const share = Math.min(1, expected / band.perCell);
        const edge = groundClass.woodEdgeAt?.(centreX, centreZ) ?? 0;
        const lowPart = edgeLowPart((stems * lowStratumPart(type) + thick) / expected, edge);
        const canopy = edgeCanopy(edge);
        // À distance, une instance représente plusieurs mètres carrés : la
        // densité d'une bande large est relevée, son panneau élargi.
        const keep = coverMassDensity(share, band) * fade;
        const heightFade = coverHeightFade(fade, THICKET_HEIGHT_FADE_FLOOR);
        const variants = variantsFor(type, this.theme.trees.essences);
        const seed = positionSeed(cellX, cellZ, band.salt);

        for (let i = 0; i < band.perCell && placed < capacity; i++) {
          const slot = i * STAND_SLOTS;
          if (standDraw(seed, slot + SLOT_PRESENCE) >= keep) continue;

          const x = cellX + standDraw(seed, slot + SLOT_X) * band.cell;
          const z = cellZ + standDraw(seed, slot + SLOT_Z) * band.cell;
          if (inCorridor(index, x, z)) continue;

          describeTree(tree, seed, slot, type, lowPart, variants, strata, true);
          const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
          const height = tree.height * (tree.low ? 1 : canopy) * heightFade * band.rise;

          this._compose(x, y, z, height, tree.aspect * band.spread, tree.rotation);
          thicket.setMatrixAt(placed, this._matrix);
          const [r, g, b] = foliageTint(type.tint, x, z, tree.shade, tree.jitter);
          this._color.setRGB(r, g, b);
          thicket.setColorAt(placed, this._color);
          const [u, v] = TREE_ATLAS_OFFSETS[tree.variant];
          this._thicketOffsets[placed * 2] = u;
          this._thicketOffsets[placed * 2 + 1] = v;
          placed++;
        }
      }
    }

    thicket.count = placed;
    thicket.instanceMatrix.needsUpdate = true;
    if (thicket.instanceColor) thicket.instanceColor.needsUpdate = true;
    this.thicketGeometry.getAttribute(ATLAS_ATTRIBUTE).needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this._planted.clear();
    this._partial.clear();
    this._stale.clear();
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose?.();
    }
    this.meshes.clear();
    this.group.remove(this.thicket);
    this.thicket.dispose?.();
    this.thicketGeometry.dispose();
    this.scene.remove(this.group);
    this.baseGeometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.texture.dispose();
  }
}
