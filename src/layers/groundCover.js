/*
 * groundCover — la couverture herbacée, à trois échelles (`coverBands.js`) :
 * la plante, la touffe, la masse. Une instance ne représente plus une touffe
 * au-delà de la première bande, mais quelques mètres carrés de prairie
 * (`GRASS_VARIANTS`, cases `clump*`).
 *
 * Deux règles gouvernent le module : les touffes sont ancrées au sol (maille
 * fixe, graine dérivée des seules coordonnées de maille — avancer ajoute des
 * mailles devant sans redistribuer le reste) ; le bitume est écarté par
 * l'index du réseau routier (`roadGraph.js`), pas par les polygones
 * d'occupation du sol (qui ne découpent pas les chaussées).
 *
 * Coût tenu par un seul maillage instancié jamais réalloué (matrices
 * réécrites en place, `count` ajusté) et un vent qui vit dans le shader.
 *
 * Trois correctifs de cohérence : le non-classé retombe sur le repli du
 * shader de terrain (`grassSampleFallback`) ; l'herbe générique s'efface
 * devant une vraie culture (`grassBlockedByCrop`, la lisière garde son
 * coquelicot) ; la hauteur ne suit pas le même fondu que la présence
 * (`coverHeightFade` plancher la taille pour qu'elle ne s'éteigne pas avant
 * de disparaître).
 *
 * La limite d'une surface, elle, n'est pas celle du carreau de la carte : le
 * sol est lu quelques mètres à côté de la maille (`fringeOffset`), d'un
 * décalage tiré de la maille elle-même. Sans quoi l'herbe s'arrête au carreau
 * de 2,7 m, en marches d'escalier, là où une prairie s'épuise dans le sable
 * sur quelques mètres. Le shader de terrain fait de même de son côté, à la
 * même amplitude (`edgeWarpM`).
 *
 * Le sol d'un bois, enfin, n'est plus nu : la part de bois ne comptait pour
 * rien dans le végétal (`grass` vaut zéro sous les arbres), donc une forêt
 * n'avait pas une touffe, jusque sous le nez de l'observateur. Elle compte
 * maintenant pour ce qu'elle vaut (`grassGreenFor`) et ce qui y pousse est une
 * litière — rase, clairsemée, sans fleurs (`woodFloorFor`), pas une prairie à
 * l'ombre. Le pire cas d'instances ne bouge pas : un bois plein rend moins de
 * touffes qu'une prairie pleine, sur laquelle `GRASS_COUNT` est mesuré.
 */

import {
  createGrassAtlasCanvas,
  GRASS_ATLAS_COLS,
  GRASS_ATLAS_OFFSETS,
  GRASS_VARIANTS,
} from '../materials/proceduralTextures.js';
import {
  createFoliageMaterial,
  createCrossedQuads,
  advanceFoliageWind,
  setFoliageWind,
  ATLAS_ATTRIBUTE,
} from '../materials/foliageMaterial.js';
import { makeRandom } from '../materials/proceduralTextures.js';
import { soilWashFor } from '../core/climate.js';
import { CORRIDOR_MARGIN_M, inCorridor } from './roadCorridor.js';
import {
  coverBand,
  coverBandRing,
  coverBandFade,
  coverHeightFade,
  coverMassDensity,
  coverBandsRadius,
} from './coverBands.js';
import { SETTLED_GRASS, VEGETAL_SURFACES } from '../terrain/groundClassMap.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Les trois échelles de la couverture herbacée. Les mailles doublent à
 * chaque bande, les tirages s'effondrent (la bande 2 couvre quatre fois la
 * surface de la bande 0 pour cinq fois moins d'instances). `spread` élargit
 * sans élever, `rise` reste modeste pour éviter l'effet d'escalier au
 * changement de bande.
 *
 * Budgets d'images par seconde et règles de composition, donc du moteur, pas du thème.
 */
export const GRASS_BANDS = [
  coverBand({ from: 0, to: 32, cell: 1.6, perCell: 10, fadeOut: 6, salt: 0 }),
  coverBand({
    from: 26,
    to: 70,
    cell: 3.2,
    perCell: 3,
    spread: 2.4,
    rise: 1.35,
    massBias: 0.35,
    fadeIn: 6,
    fadeOut: 10,
    salt: 1,
  }),
  coverBand({
    from: 60,
    to: 130,
    cell: 6.4,
    perCell: 2,
    spread: 4.5,
    rise: 1.7,
    massBias: 0.6,
    fadeIn: 10,
    fadeOut: 52, // long fondu de sortie sur les 50 derniers mètres
    salt: 2,
  }),
];

/** Portée de la couverture herbacée, en mètres — le bord de la dernière bande. */
export const GRASS_RADIUS_M = coverBandsRadius(GRASS_BANDS);
/**
 * Nombre maximal de touffes. Borne le pire cas (prairie pleine, sans route ni
 * bâti pour trouer le semis) ; s'il est atteint, ce qui se perd est au bord
 * de la couverture, où une instance de moins ne se voit pas. Mesuré à 14 501
 * sur prairie pleine ; la marge couvre les arrondis de maille.
 */
export const GRASS_COUNT = 17000;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const GRASS_REBUILD_M = 8;
/** Côté de la maille d'ancrage au sol de la bande de détail, en mètres. */
export const GRASS_CELL_M = GRASS_BANDS[0].cell;
/** Touffes tirées par maille de détail. La couverture décide de celles qui poussent. */
export const GRASS_PER_CELL = GRASS_BANDS[0].perCell;
/** Part de végétal en deçà de laquelle rien ne pousse (bitume, roche, eau). */
export const GRASS_GREEN_MIN = 0.25;
/** Débord toléré au-delà de la chaussée, en mètres — c'est l'emprise routière (`roadCorridor`), conservée sous son ancien nom (publique). */
export const GRASS_ROAD_MARGIN_M = CORRIDOR_MARGIN_M;
/** Part de la portée à partir de laquelle la couverture s'éclaircit (le fondu de sortie de la dernière bande, en part du rayon). */
export const GRASS_FADE_FROM = 1 - GRASS_BANDS[GRASS_BANDS.length - 1].fadeOut / GRASS_RADIUS_M;
/** Plancher de hauteur en bord de bande, en part de la hauteur nominale (garde les dernières touffes visibles). */
export const GRASS_HEIGHT_FADE_FLOOR = 0.55;
/** Distances entre lesquelles la compensation d'alpha monte, et son gain — voir `createFoliageMaterial`. */
export const GRASS_COVERAGE_RANGE = [28, 110];
export const GRASS_COVERAGE_GAIN = 2.2;

/**
 * Variante de touffe à semer en un point, d'après ce que dit la carte de
 * classes et un tirage attaché à la touffe.
 *
 * Fonction pure. Rend un indice dans `GRASS_VARIANTS` (0 = herbe nue).
 *
 * @param {{grass:number, farmland:number}|null} sample
 * @param {number} draw Tirage dans [0, 1[ propre à la touffe.
 */
export function grassVariantFor(sample, draw, grass = defaultTheme.grass) {
  if (!sample) return 0;

  // Bord de champ : herbe et culture au même endroit, seul cas où le coquelicot pousse.
  const edge = sample.grass > 0.2 && sample.farmland > 0.2;
  if (edge) return draw < grass.poppyShare ? GRASS_VARIANTS.indexOf('poppy') : 0;

  if (draw >= grass.flowerShare) return 0;
  // En prairie : marguerites et boutons d'or, à peu près à parts égales.
  return draw < grass.flowerShare * 0.5
    ? GRASS_VARIANTS.indexOf('white')
    : GRASS_VARIANTS.indexOf('yellow');
}

/** Masse correspondant à chaque touffe de détail, par nom de variante. */
const GRASS_MASS_OF = {
  plain: 'clump',
  white: 'clumpWhite',
  yellow: 'clumpYellow',
  poppy: 'clumpPoppy',
};

/**
 * Silhouette de masse correspondant à une touffe de détail. Le fleurissement
 * est conservé (une prairie de marguerites le reste à 80 m). L'herbe nue
 * dispose de deux silhouettes tirées par `draw`, pour ne pas se lire comme un motif.
 *

 * @param {number} variant Indice de la touffe de détail.
 * @param {number} draw    Tirage dans [0, 1[ propre à la touffe.
 */
export function grassMassVariant(variant, draw) {
  const mass = GRASS_MASS_OF[GRASS_VARIANTS[variant]];
  if (!mass) return variant;
  if (mass === 'clump' && draw >= 0.5) return GRASS_VARIANTS.indexOf('clumpAlt');
  return GRASS_VARIANTS.indexOf(mass);
}

/**
 * Mailles d'un disque d'une seule échelle, de la plus proche à la plus
 * lointaine. `coverBandRing` en est la généralisation, employée par la
 * couche ; celle-ci délègue plutôt que garder un second parcours à tenir d'accord.
 *
 * @param {number} radius Rayon, en mètres.
 * @param {number} cell   Côté d'une maille, en mètres.
 * @returns {Array<{gx:number, gz:number, distance:number}>} indices de maille
 *          absolus (à multiplier par `cell`) et distance au centre.
 */
export function grassCellRing(radius, cell) {
  // Epsilon relatif pour inclure la maille qui tombait pile sur le rayon (borne haute exclusive de `coverBandRing`).
  return coverBandRing([coverBand({ from: 0, to: radius * (1 + 1e-12), cell, perCell: 0 })]);
}

/** Nombre de valeurs décrivant une touffe dans le tampon de maille. */
export const GRASS_TUFT_STRIDE = 7;

/**
 * Remplit le tampon des touffes d'une maille : position, présence, taille,
 * rotation, teinte.
 *
 * Invariant : le nombre de tirages consommés est constant, et la graine ne
 * dépend que des coordonnées de la maille — une maille rend toujours
 * exactement les mêmes touffes. Écrit dans un tampon fourni (pas d'objets
 * jetables par redistribution). Le sel distingue les bandes, sinon deux
 * échelles superposeraient les mêmes touffes à la même maille.
 *
 * @param {Float32Array} out Longueur `perCell × GRASS_TUFT_STRIDE`.
 * @param {number} gx Indice de maille (absolu, pas relatif à l'observateur).
 * @param {number} gz
 * @param {number} [cell] Côté de la maille, en mètres.
 * @param {number} [perCell] Touffes tirées.
 * @param {number} [salt] Sel de graine propre à la bande.
 * @returns {Float32Array} le tampon fourni.
 */
export function fillGrassCell(out, gx, gz, cell = GRASS_CELL_M, perCell = GRASS_PER_CELL, salt = 0) {
  const random = makeRandom((gx * 73856093) ^ (gz * 19349663) ^ (salt * 2654435761));
  const originX = gx * cell;
  const originZ = gz * cell;

  for (let i = 0; i < perCell; i++) {
    const at = i * GRASS_TUFT_STRIDE;
    out[at] = originX + random() * cell;
    out[at + 1] = originZ + random() * cell;
    out[at + 2] = random(); // présence
    out[at + 3] = random(); // taille
    out[at + 4] = random(); // rotation
    out[at + 5] = random(); // teinte
    out[at + 6] = random(); // fleurissement
  }

  return out;
}

/**
 * Rétrécissement d'une touffe selon sa distance à l'observateur (fondu plutôt
 * que frontière nette : une touffe qui entre dans le disque entre à taille nulle).
 */
export function grassEdgeFade(distance, radius = GRASS_RADIUS_M, from = GRASS_FADE_FROM) {
  const start = radius * from;
  if (distance <= start) return 1;
  const fade = 1 - (distance - start) / (radius - start);
  return fade < 0 ? 0 : fade;
}

/** Rétrécissement de la hauteur seule, avec un plancher (`grassEdgeFade` pilote combien de touffes restent, celle-ci leur taille). */
export function grassHeightFade(
  distance,
  radius = GRASS_RADIUS_M,
  from = GRASS_FADE_FROM,
  floor = GRASS_HEIGHT_FADE_FLOOR
) {
  return coverHeightFade(grassEdgeFade(distance, radius, from), floor);
}

/**
 * Échantillon à utiliser quand `sampleAt` ne sait rien dire (hors carte, ou
 * donnée absente) — le même repli que le shader de terrain (`uUnclassified`,
 * voir `terrainMaterial.js`), et il faut que ce soit le même : la peinture du
 * sol et les touffes qui poussent dessus se contrediraient sinon.
 *
 * C'étaient quatre poids ; c'est un **nom de matière** depuis que la carte du
 * sol n'en porte plus qu'un par texel. Une matière que la strate basse ne
 * distingue pas compte pour du minéral, où rien ne pousse.
 *
 * @param {{grass:number, wood:number, farmland:number, bare:number}|null} sample
 * @param {string} unclassified Matière de repli — `TERRAIN_LOOK.unclassified`.
 */
export function grassSampleFallback(sample, unclassified) {
  if (sample) return sample;
  const empty = { grass: 0, wood: 0, farmland: 0, bare: 0 };
  if (unclassified === 'wood') return { ...empty, wood: 1 };
  if (unclassified === 'farmland') return { ...empty, farmland: 1 };
  if (unclassified === 'settled') return { ...empty, grass: SETTLED_GRASS, bare: 1 - SETTLED_GRASS };
  // Les couvertures végétales poussent comme de l'herbe : c'est leur ligne de
  // `SURFACE_LOOK` qui dit ensuite de quelle taille et de quelle teinte.
  if (VEGETAL_SURFACES.has(unclassified)) return { ...empty, grass: 1 };
  return { ...empty, bare: 1 };
}

/**
 * Vrai si une vraie culture occupe ce point et doit effacer l'herbe
 * générique. La lisière (herbe et culture mêlées) n'est jamais bloquée ici —
 * même condition `edge` que `grassVariantFor`.
 *
 * @param {{grass:number, farmland:number}|null} sample
 * @param {string|null} crop Retour de `groundClass.cropAt`.
 */
export function grassBlockedByCrop(sample, crop) {
  if (!crop) return false;
  const edge = sample && sample.grass > 0.2 && sample.farmland > 0.2;
  return !edge;
}

/** Ce qu'une couverture ordinaire — une prairie — fait à l'herbe : rien. */
export const COVER_GRASS_NEUTRAL = Object.freeze({ height: 1, density: 1, tint: [1, 1, 1] });

/**
 * Ce que la couverture du sol fait aux touffes : leur taille, leur nombre,
 * leur teinte.
 *
 * Une lande n'est pas une prairie plus terne, c'est une prairie **rase** ; un
 * maquis est surtout fait de vide entre les arbustes ; une roselière monte plus
 * haut qu'un pré. Ces trois écarts se lisent à hauteur d'homme, et aucun ne se
 * rend par la seule couleur du sol (voir l'albédo de `SURFACE_LOOK`, qui la
 * porte, elle).
 *
 * Fonction pure. Une couverture absente de la table pousse comme une prairie —
 * c'est-à-dire exactement comme avant que les couvertures existent.
 *
 * @param {string|null} cover Matière du sol (`groundClass.surfaceAt`).
 * @param {Object} [surfaces] Tranche `theme.surfaces`.
 */
export function coverGrassFor(cover, surfaces = defaultTheme.surfaces) {
  const look = cover ? surfaces?.[cover] : null;
  if (!look) return COVER_GRASS_NEUTRAL;
  return {
    height: look.grassHeight ?? 1,
    density: look.grassDensity ?? 1,
    tint: look.grassTint || COVER_GRASS_NEUTRAL.tint,
  };
}

/**
 * Part de végétal au sol vue par l'herbe, et part de ce vert qui est du
 * sous-bois.
 *
 * Un bois comptait pour zéro : `grass` vaut zéro sous un couvert d'arbres, et
 * le sol d'une forêt restait donc la seule texture du terrain, sans une touffe,
 * jusque sous le nez de l'observateur. Il compte maintenant pour ce qu'il vaut
 * (`woodFloor.green`) — une litière, pas une prairie, et c'est `shade` qui dit
 * de combien s'en écarter.
 *
 * Fonction pure.
 *
 * @param {{grass:number, wood:number, farmland:number}} sample
 * @param {Object} [look] Tranche `theme.grass.woodFloor`.
 * @returns {{green:number, shade:number}}
 */
export function grassGreenFor(sample, look = defaultTheme.grass.woodFloor) {
  const meadow = sample.grass + sample.farmland * 0.5;
  const floor = (sample.wood || 0) * (look?.green ?? 0);
  const green = Math.min(1, meadow + floor);
  return { green, shade: green > 0 ? Math.min(1, floor / green) : 0 };
}

/**
 * Ce que l'ombre des arbres fait aux touffes : leur taille, leur nombre, leur
 * couleur. Même contrat que `coverGrassFor`, et les deux se multiplient — un
 * sous-bois de lande reste une lande.
 *
 * Fonction pure. `shade` nul rend le neutre, sans rien allouer.
 *
 * @param {number} shade Part de sous-bois dans le vert du lieu (`grassGreenFor`).
 * @param {Object} [look] Tranche `theme.grass.woodFloor`.
 */
export function woodFloorFor(shade, look = defaultTheme.grass.woodFloor) {
  if (!(shade > 0) || !look) return COVER_GRASS_NEUTRAL;
  const mix = (value) => 1 + ((value ?? 1) - 1) * shade;
  const tint = look.tint || COVER_GRASS_NEUTRAL.tint;
  return {
    height: mix(look.height),
    density: mix(look.density),
    tint: [mix(tint[0]), mix(tint[1]), mix(tint[2])],
  };
}

/**
 * Part de sous-bois au-delà de laquelle rien ne fleurit. Les fleurs de l'atlas
 * sont des fleurs de plein soleil — coquelicot, marguerite, bouton d'or : aucune
 * ne pousse sous un couvert fermé.
 */
export const WOODLAND_FLOWER_MAX = 0.5;

/**
 * Variantes d'atlas qui portent une fleur, par indice.
 *
 * La correction de sol d'un climat s'applique à l'herbe, pas à ce qui fleurit
 * dedans : un coquelicot d'Andalousie est rouge, et le multiplier par le
 * facteur d'une herbe sèche — qui triple le rouge — en ferait une lampe. La
 * touffe qui le porte reste donc à sa teinte de prairie ; elle est minoritaire
 * (`flowerShare`), donc ça ne défait pas le calage avec le sol.
 */
const FLOWERING_VARIANTS = new Set(
  ['white', 'yellow', 'poppy', 'clumpWhite', 'clumpYellow', 'clumpPoppy'].map((name) =>
    GRASS_VARIANTS.indexOf(name)
  )
);

/** Vrai si la variante porte une fleur. Voir `FLOWERING_VARIANTS`. */
export function isFloweringVariant(variant) {
  return FLOWERING_VARIANTS.has(variant);
}

/** Sel de la frange : la maille ne doit pas tirer son décalage sur la même graine que ses touffes. */
const FRINGE_SALT = 0x5eed;

/**
 * Décalage de lecture du sol pour une maille — la « frange ».
 *
 * Les cartes du sol ont un pas de 2,7 m, et `sampleAt` lit un carreau, sans
 * flou : la limite entre deux surfaces est donc celle du carreau, et l'herbe
 * s'arrête net sur une ligne en escalier. On lit le sol à quelques mètres de
 * la maille plutôt qu'en son centre : au bord, une maille sur deux lit l'autre
 * surface. L'herbe déborde alors sur le sable, le sable mord dans l'herbe, et
 * la frontière cesse d'être un trait.
 *
 * Le décalage ne dépend que de la maille (déterminisme spatial : la même
 * maille lit toujours le même point) et il est **borné** par `reach` : une
 * touffe ne peut pas emprunter le sol d'une parcelle lointaine.
 *
 * Le shader de terrain déplace sa lecture de la même façon et de la même
 * amplitude (`edgeWarpM`), mais avec son propre bruit : la peinture et les
 * touffes ne suivent pas la même limite au mètre près, elles la brouillent
 * chacune de son côté, sur la même largeur.
 *
 * @param {number} gx Indice de maille.
 * @param {number} gz
 * @param {number} salt Sel de la bande (les bandes n'ont pas la même maille).
 * @param {number} reach Amplitude, en mètres.
 * @returns {{x:number, z:number}} Décalage à ajouter au point lu.
 */
export function fringeOffset(gx, gz, salt, reach) {
  if (!(reach > 0)) return { x: 0, z: 0 };
  const random = makeRandom((gx * 73856093) ^ (gz * 19349663) ^ ((salt + FRINGE_SALT) * 2654435761));
  const angle = random() * Math.PI * 2;
  // Racine du tirage : sans elle le décalage se masse au centre du disque, et
  // la frange serait plus étroite que son amplitude ne l'annonce.
  const radius = Math.sqrt(random()) * reach;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** Voisinage sondé par `widenFieldEdge`, en mètres depuis le point d'origine. */
const FIELD_EDGE_OFFSETS_M = [
  [5, 0], [-5, 0], [0, 5], [0, -5],
  [3.5, 3.5], [-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5],
];

/**
 * Échantillon élargi pour la détection de lisière de champ.
 * `GroundClassMap.sampleAt` lit un seul pixel de 2,7 m, sans flou : au bord
 * d'un vrai polygone, un pixel est herbe ou culture, jamais un peu des deux —
 * la condition « lisière » de `grassVariantFor`/`grassBlockedByCrop` ne se
 * déclenchait donc presque jamais. Cette fonction cherche la culture à
 * quelques mètres à la ronde plutôt que sur le seul pixel interrogé.
 *

 * @param {Object|null} groundClass Instance `GroundClassMap`.
 * @param {number} x
 * @param {number} z
 * @param {{grass:number, farmland:number}|null} sample Échantillon au pixel
 *        exact — voir `GroundClassMap.sampleAt`.
 * @returns {Object|null} `sample`, ou une copie dont `farmland` est monté au
 *          maximum trouvé dans le voisinage.
 */
export function widenFieldEdge(groundClass, x, z, sample) {
  if (!sample || sample.grass <= 0.2 || sample.farmland > 0.2) return sample;
  let farmland = sample.farmland;
  for (const [dx, dz] of FIELD_EDGE_OFFSETS_M) {
    const near = groundClass?.sampleAt?.(x + dx, z + dz);
    if (near && near.farmland > farmland) farmland = near.farmland;
  }
  return farmland === sample.farmland ? sample : { ...sample, farmland };
}

export class GroundCover {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble     Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — c'est elle
   *        qui dit où il y a du végétal.
   * @param {Object} [options.roads]    Instance `RoadNetwork` — l'herbe ne pousse
   *        pas sur ses chaussées.
   * @param {Object} [options.streets]  Instance `StreetLayer` — ni sur ses
   *        trottoirs (un quartier porte une part d'herbe, voir `SETTLED_GRASS`).
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass,
    roads = null,
    streets = null,
    count = GRASS_COUNT,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.roads = roads;
    this.streets = streets;
    /**
     * Famille climatique du lieu, ou `null`. Posée par le compositeur ; elle
     * décide de la teinte des touffes, et c'est **le même facteur** que le
     * shader de terrain applique à l'albédo du sol — sans quoi le premier plan
     * et le lointain divergeraient.
     */
    this.climate = null;
    this._wash = soilWashFor(null, theme.soils);
    this.disposed = false;
    this._anchor = null;
    this._frame = null;
    this._bands = GRASS_BANDS;
    this._cells = coverBandRing(this._bands);
    // Une seule allocation, dimensionnée sur la bande la plus fournie.
    const widest = Math.max(...this._bands.map((band) => band.perCell));
    this._tufts = new Float32Array(widest * GRASS_TUFT_STRIDE);

    this.texture = new THREE.CanvasTexture(createGrassAtlasCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = createCrossedQuads(THREE);
    // Décalage d'atlas : donnée d'instance, alloué une fois pour toutes comme les matrices.
    this._atlasOffsets = new Float32Array(count * 2);
    this.geometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._atlasOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      wind: true,
      // 0,35 × l'élancement de la touffe : l'amplitude s'exprime maintenant
      // en part de la hauteur et non de la largeur du panneau (voir
      // `foliageMaterial`). Le produit est le même de près — ce qui change,
      // c'est que les masses élargies des bandes lointaines cessent de
      // balayer deux mètres au lieu de vingt centimètres.
      windStrength: 0.35 * theme.grass.aspect,
      atlas: true,
      tiles: GRASS_ATLAS_COLS,
      coverage: true,
      coverageRange: GRASS_COVERAGE_RANGE,
      coverageGain: GRASS_COVERAGE_GAIN,
      cacheKey: 'foliage-grass-cover-v4',
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'ground-cover';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // toujours autour de la caméra
    this.mesh.receiveShadow = true; // reçoit l'ombre, n'en projette pas
    scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    this._color = new THREE.Color();
  }

  /**
   * Pose la famille climatique du lieu.
   *
   * @param {string|null} family
   * @returns {boolean} vrai si elle a changé — l'appelant doit alors
   *          redistribuer, la teinte étant écrite dans les instances.
   */
  setClimate(family) {
    const next = family || null;
    if (next === this.climate) return false;
    this.climate = next;
    this._wash = soilWashFor(next, this.theme.soils);
    return true;
  }

  setMaxAnisotropy(value) {
    this.texture.anisotropy = Math.min(value || 4, 8);
    this.texture.needsUpdate = true;
  }

  /** Fait avancer le vent. À appeler une fois par image, avec le delta en secondes. */
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
   * Redistribue les touffes si l'observateur s'est assez éloigné.
   * @param {number} x Position locale de l'observateur.
   * @param {number} z
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return false;

    const frameChanged = this._frame !== this.bubble.frame;
    if (!force && !frameChanged && this._anchor) {
      if (Math.hypot(x - this._anchor.x, z - this._anchor.z) < GRASS_REBUILD_M) return false;
    }

    this._scatter(x, z);
    this._anchor = { x, z };
    this._frame = this.bubble.frame;
    return true;
  }

  /** Sème la couverture, bande par bande et maille par maille. */
  _scatter(centerX, centerZ) {
    const { bubble, groundClass, roads, streets, mesh } = this;
    const capacity = mesh.instanceMatrix.count;
    const index = roads?.index || null;
    const pavement = streets?.index || null;
    const bands = this._bands;
    // Un centre arrondi par bande : les mailles retenues ne dépendent que du sol.
    const bases = bands.map((band) => ({
      x: Math.round(centerX / band.cell),
      z: Math.round(centerZ / band.cell),
    }));
    const tufts = this._tufts;
    const grass = this.theme.grass;
    // Amplitude de la frange : la même valeur que le shader de terrain, pour
    // que les deux brouillent la limite sur la même largeur.
    const fringeM = this.theme.terrain.edgeWarpM ?? 0;
    let placed = 0;

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const band = bands[cell.band];
      const base = bases[cell.band];
      const gx = base.x + cell.gx;
      const gz = base.z + cell.gz;

      const cellX = (gx + 0.5) * band.cell;
      const cellZ = (gz + 0.5) * band.cell;
      // Le sol se lit à la frange, pas au centre de la maille : c'est ce qui
      // fait déborder l'herbe sur la surface voisine (voir `fringeOffset`).
      // Les trois lectures — matière, culture, couverture — partagent le même
      // point, sinon une touffe pousserait sur une matière et prendrait la
      // taille d'une autre.
      const fringe = fringeOffset(gx, gz, band.salt, fringeM);
      const readX = cellX + fringe.x;
      const readZ = cellZ + fringe.z;
      const sample = grassSampleFallback(
        groundClass?.sampleAt(readX, readZ) ?? null,
        this.theme.terrain.unclassified
      );
      // Échantillon brut (pas élargi) : la verdure de la touffe ne doit rien à une culture à 5 m de là.
      const { green, shade } = grassGreenFor(sample, this.theme.grass.woodFloor);
      if (green < GRASS_GREEN_MIN) continue;

      const edgeSample = widenFieldEdge(groundClass, readX, readZ, sample);

      const crop = groundClass?.cropAt?.(readX, readZ) ?? null;
      if (grassBlockedByCrop(edgeSample, crop)) continue;

      // Couverture du sol : lande, maquis, marais… Elle ne décide pas *si* de
      // l'herbe pousse — c'est la part de végétal qui le dit — mais de quelle
      // taille, en quelle quantité et de quelle couleur.
      const coverLook = coverGrassFor(
        groundClass?.surfaceAt?.(readX, readZ) ?? null,
        this.theme.surfaces
      );

      const fade = coverBandFade(cell.distance, band);
      if (fade <= 0.02) continue;
      const heightFade = coverHeightFade(fade, GRASS_HEIGHT_FADE_FLOOR);
      // Et ce que l'ombre des arbres en fait, par-dessus : une litière rase.
      // Après le fondu : hors des bois elle ne coûte rien, mais dans un bois
      // elle alloue, et une maille écartée n'a pas à la payer.
      const floorLook = woodFloorFor(shade, this.theme.grass.woodFloor);
      // À distance, une instance représente plusieurs mètres carrés. La
      // couverture dit *ce que c'est*, le climat *dans quel pays* : une lande
      // écossaise est rase parce que c'est une lande, et un peu plus rase
      // encore parce qu'elle est en pays venté. Les deux se multiplient.
      const density =
        coverMassDensity(green, band) *
        coverLook.density *
        floorLook.density *
        this._wash.grassDensity;

      fillGrassCell(tufts, gx, gz, band.cell, band.perCell, band.salt);

      for (let i = 0; i < band.perCell && placed < capacity; i++) {
        const at = i * GRASS_TUFT_STRIDE;
        if (tufts[at + 2] > density * fade) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        if (inCorridor(index, x, z, GRASS_ROAD_MARGIN_M)) continue;
        if (pavement?.covers(x, z, 0)) continue;

        const tint = tufts[at + 5];
        const height =
          (grass.minHeight + tufts[at + 3] * (grass.maxHeight - grass.minHeight)) *
          (0.72 + green * 0.28) * // plus dense, plus haute
          coverLook.height *
          floorLook.height *
          this._wash.grassHeight *
          heightFade *
          band.rise;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
        const width = height * grass.aspect * band.spread; // élargi, pas élevé

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(width, height, width);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(placed, this._matrix);
        // Fleurissement décidé par le sol, pas par un tirage libre ; survit au
        // changement d'échelle. Tiré **avant** la teinte, qui en dépend : voir
        // `FLOWERING_VARIANTS`.
        let variant =
          shade > WOODLAND_FLOWER_MAX
            ? 0
            : grassVariantFor(edgeSample, tufts[at + 6], this.theme.grass);
        if (cell.band > 0) variant = grassMassVariant(variant, tufts[at + 5]);

        const dry = (1 - green) * 0.5 + tint * 0.35;
        const wash = isFloweringVariant(variant) ? COVER_GRASS_NEUTRAL.tint : this._wash.grass;
        this._color.setRGB(
          (0.82 + dry * 0.26) * coverLook.tint[0] * floorLook.tint[0] * wash[0],
          (0.96 + tint * 0.09) * coverLook.tint[1] * floorLook.tint[1] * wash[1],
          (0.74 - dry * 0.2) * coverLook.tint[2] * floorLook.tint[2] * wash[2]
        );
        mesh.setColorAt(placed, this._color);

        const [u, v] = GRASS_ATLAS_OFFSETS[variant];
        this._atlasOffsets[placed * 2] = u;
        this._atlasOffsets[placed * 2 + 1] = v;
        placed++;
      }
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.geometry.getAttribute(ATLAS_ATTRIBUTE).needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
