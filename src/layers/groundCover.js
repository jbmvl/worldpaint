/*
 * groundCover — la couverture herbacée, à trois échelles.
 * -------------------------------------------------------
 * Un sol texturé reste plat : sous la caméra, il manque quelque chose qui ait
 * une hauteur et qui défile. C'était d'abord un disque de touffes semé sur
 * quarante mètres ; c'est maintenant une couverture semée sur cent trente, en
 * trois **bandes** (`coverBands.js`) — la plante, la touffe, la masse.
 *
 * Le disque unique n'échouait pas par manque d'objets : il échouait parce qu'à
 * cinquante mètres il dessinait encore des brins, c'est-à-dire quelque chose que
 * personne ne distingue et que le premier mip efface. Passé la première bande,
 * une instance ne représente donc plus une touffe mais quelques mètres carrés de
 * prairie, avec la silhouette qui va avec (`GRASS_VARIANTS`, cases `clump*`).
 *
 * Deux règles gouvernent tout le module :
 *
 * - **Les touffes sont ancrées au sol, pas à l'observateur.** Une maille fixe de
 *   deux mètres, une graine dérivée des seules coordonnées de la maille : une
 *   touffe garde sa position, sa hauteur et sa teinte d'une redistribution à
 *   l'autre, et avancer ne fait qu'ajouter des mailles devant et retirer celles
 *   de derrière. Semer autour de l'observateur faisait au contraire sauter les neuf
 *   mille touffes à chaque changement de graine.
 * - **Le bitume est écarté par l'index du réseau routier** (`roadGraph.js`),
 *   c'est-à-dire par la géométrie même sur laquelle roule l'observateur. Les
 *   polygones d'occupation du sol, eux, ne découpent pas les chaussées : une
 *   prairie traversée par une départementale y est verte sur toute sa surface.
 *
 * Restent deux choix qui tiennent le coût : un **seul** maillage instancié
 * jamais réalloué — on réécrit les matrices en place et on ajuste `count` —, et
 * le vent qui vit entièrement dans le shader, un uniforme avancé par image.
 *
 * ## Expérimentation — cohérence avec le terrain et fondu de distance
 *
 * Trois correctifs locaux, sans nouveau système :
 *
 * - **le non-classé retombe sur le même repli que le shader de terrain**
 *   (`TERRAIN_LOOK.unclassifiedWeights`, voir `grassSampleFallback`). Avant,
 *   `sampleAt` rendait `null` et la maille restait nue alors que le terrain, au
 *   même endroit, se peignait en herbe — sol vert, aucune touffe ;
 * - **l'herbe générique s'efface devant une vraie culture** (`cropAt`,
 *   `grassBlockedByCrop`) : un champ de blé n'a plus de prairie superposée à
 *   ses tiges. La lisière (herbe et culture mêlées dans la carte de classes)
 *   garde son coquelicot, inchangé ;
 * - **la hauteur ne suit plus le même fondu que la présence** : la densité
 *   décide combien de touffes restent, mais `coverHeightFade` plancher la
 *   taille de celles qui restent, pour qu'elles ne s'éteignent pas juste avant
 *   de disparaître.
 *
 * ## Ce que les bandes n'ont pas changé
 *
 * La bande 0 est le semis d'origine, aux mêmes valeurs : même maille, même
 * nombre de tirages, mêmes hauteurs, mêmes fleurs, même vent, même emprise
 * routière. Ce qui a été ajouté l'a été **autour**, et le premier plan est au
 * pixel près celui d'avant.
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
import { CORRIDOR_MARGIN_M, inCorridor } from './roadCorridor.js';
import {
  coverBand,
  coverBandRing,
  coverBandFade,
  coverHeightFade,
  coverMassDensity,
  coverBandsRadius,
} from './coverBands.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Les trois échelles de la couverture herbacée.
 *
 * La bande 0 reprend exactement le disque d'origine — maille de 1,6 m, dix
 * tirages —, les deux suivantes agrègent. Les mailles doublent à chaque bande,
 * les tirages s'effondrent : la bande 2 couvre quatre fois la surface de la
 * bande 0 pour cinq fois moins d'instances.
 *
 * `spread` élargit sans élever : c'est la largeur qui ferme les trous entre
 * masses. `rise` reste modeste pour que le dessus de la prairie ne monte pas en
 * marches d'escalier quand on passe d'une bande à l'autre.
 *
 * Ce sont des budgets d'images par seconde et des règles de composition, donc
 * du moteur et non du thème (voir `CONTRIBUTING.md`).
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
    // Long fondu de sortie : la couverture s'éclaircit sur les cinquante
    // derniers mètres au lieu de s'arrêter au couteau. C'est la portée que
    // portait `GRASS_FADE_FROM` du temps du disque unique.
    fadeOut: 52,
    salt: 2,
  }),
];

/** Portée de la couverture herbacée, en mètres — le bord de la dernière bande. */
export const GRASS_RADIUS_M = coverBandsRadius(GRASS_BANDS);
/**
 * Nombre maximal de touffes.
 *
 * Le plafond n'est pas la densité : la densité se règle par les bandes, et le
 * plafond n'est là que pour borner le pire cas (prairie pleine, sans route ni
 * bâti pour trouer le semis). S'il est atteint, ce qui se perd est au bord de
 * la couverture, où une instance de moins ne se voit pas — c'est tout l'intérêt
 * de semer de la plus proche maille à la plus lointaine.
 *
 * Mesuré à 14 501 sur prairie pleine, contre 11 514 du temps du disque de
 * trente-huit mètres : la portée est passée à cent trente mètres pour un quart
 * d'instances en plus, et c'est tout l'intérêt de l'agrégation. La marge
 * couvre les arrondis de maille sans réserver une mémoire qui ne servirait
 * jamais.
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
/**
 * Débord toléré au-delà de la chaussée, en mètres : l'accotement reste nu.
 *
 * Ce n'est plus une valeur propre à l'herbe. C'est **l'emprise routière**
 * (`roadCorridor`), la même frontière que respectent les haies, les clôtures,
 * les jardins et les cultures : le terrain est terrassé jusque-là, donc rien
 * n'y pousse. Conservée sous son ancien nom parce qu'elle est publique.
 */
export const GRASS_ROAD_MARGIN_M = CORRIDOR_MARGIN_M;
/**
 * Part de la portée à partir de laquelle la couverture s'éclaircit. C'est
 * aujourd'hui le fondu de sortie de la dernière bande, exprimé en part du
 * rayon : les deux disent la même chose, et `grassEdgeFade` reste la façon de
 * le lire d'un seul tenant.
 */
export const GRASS_FADE_FROM = 1 - GRASS_BANDS[GRASS_BANDS.length - 1].fadeOut / GRASS_RADIUS_M;
/**
 * Plancher de hauteur en bord de bande, en part de la hauteur nominale.
 *
 * Avant, la hauteur suivait le même fondu que la présence : les touffes
 * devenaient à la fois plus rares *et* plus petites, jusqu'à s'éteindre juste
 * avant de disparaître. Le plancher garde les dernières touffes visibles —
 * seule leur **présence** continue de se raréfier.
 */
export const GRASS_HEIGHT_FADE_FLOOR = 0.55;
/**
 * Distances entre lesquelles la compensation d'alpha monte, et son gain — voir
 * `createFoliageMaterial`. Sans elle, les masses des bandes lointaines
 * s'érodent au mip exactement comme les touffes qu'elles remplacent.
 */
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

  // Bord de champ : herbe **et** culture au même endroit. C'est là et
  // seulement là que le coquelicot pousse.
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
 * Silhouette de masse correspondant à une touffe de détail.
 *
 * Le fleurissement est **conservé** : une prairie de marguerites reste une
 * prairie de marguerites à quatre-vingts mètres, là où une masse unique et
 * neutre aurait effacé ce que la carte de classes avait décidé. L'herbe nue,
 * de loin le cas le plus fréquent, dispose de deux silhouettes tirées par
 * `draw` — une seule, répétée sur des hectares, se lit comme un motif.
 *
 * Fonction pure. Rend un indice dans `GRASS_VARIANTS`.
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
 * lointaine — le semis d'avant les bandes.
 *
 * `coverBandRing` en est la généralisation et c'est elle que sème la couche ;
 * celle-ci reste le raccourci pour raisonner sur une échelle isolée, et
 * délègue plutôt que de garder un second parcours à tenir d'accord avec le
 * premier. Fonction pure.
 *
 * @param {number} radius Rayon, en mètres.
 * @param {number} cell   Côté d'une maille, en mètres.
 * @returns {Array<{gx:number, gz:number, distance:number}>} indices de maille
 *          absolus (à multiplier par `cell`) et distance au centre.
 */
export function grassCellRing(radius, cell) {
  // Borne haute exclusive : `coverBandRing` écarte `distance >= to`, là où le
  // disque acceptait `distance <= radius`. Un epsilon relatif rend la maille
  // qui tombait pile sur le rayon, sans dépendre de l'échelle.
  return coverBandRing([coverBand({ from: 0, to: radius * (1 + 1e-12), cell, perCell: 0 })]);
}

/** Nombre de valeurs décrivant une touffe dans le tampon de maille. */
export const GRASS_TUFT_STRIDE = 7;

/**
 * Remplit le tampon des touffes d'une maille : position, présence, taille,
 * rotation, teinte.
 *
 * **Invariant** : le nombre de tirages consommés est constant, et la graine ne
 * dépend que des coordonnées de la maille. Une maille rend donc toujours
 * exactement les mêmes touffes, quels que soient l'ordre des appels et la
 * position de l'observateur — c'est ce qui fait qu'avancer ajoute des touffes devant
 * au lieu de redistribuer tout le disque. Si un filtre venait sauter un tirage,
 * toutes les touffes suivantes de la maille changeraient de place et l'herbe se
 * remettrait à sauter.
 *
 * Fonction pure, écrite dans un tampon fourni : neuf mille objets jetables par
 * redistribution ne coûteraient rien d'utile.
 *
 * Le **sel** distingue les bandes : sans lui, la maille (3, 4) de la bande de
 * détail et la maille (3, 4) de la bande de masse tireraient exactement les
 * mêmes touffes, et les deux échelles se superposeraient au lieu de se relayer.
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
 * Rétrécissement d'une touffe selon sa distance à l'observateur.
 *
 * Le disque se termine en fondu plutôt que par une frontière nette d'herbe
 * coupée au couteau — et c'est aussi ce qui rend l'apparition d'une maille
 * invisible : une touffe qui entre dans le disque entre à taille nulle.
 * Fonction pure.
 */
export function grassEdgeFade(distance, radius = GRASS_RADIUS_M, from = GRASS_FADE_FROM) {
  const start = radius * from;
  if (distance <= start) return 1;
  const fade = 1 - (distance - start) / (radius - start);
  return fade < 0 ? 0 : fade;
}

/**
 * Rétrécissement de la **hauteur** seule, avec un plancher.
 *
 * `grassEdgeFade` pilote combien de touffes restent ; celle-ci pilote leur
 * taille, et ne descend jamais sous `floor` — une touffe qui survit au tri de
 * densité doit rester perceptible, pas s'éteindre en même temps. Fonction
 * pure.
 */
export function grassHeightFade(
  distance,
  radius = GRASS_RADIUS_M,
  from = GRASS_FADE_FROM,
  floor = GRASS_HEIGHT_FADE_FLOOR
) {
  return coverHeightFade(grassEdgeFade(distance, radius, from), floor);
}

/**
 * Échantillon à utiliser quand `sampleAt` ne sait rien dire — alpha nul,
 * classé ou non, ou point hors de la carte. C'est exactement le repli que
 * fait le shader de terrain (`uUnclassified`, voir `terrainMaterial.js`) :
 * sans lui, un point que le terrain peint en herbe pouvait rester nu ici,
 * faute de donnée à cet endroit précis. Fonction pure.
 *
 * @param {{grass:number, wood:number, farmland:number, bare:number}|null} sample
 * @param {number[]} unclassifiedWeights [herbe, bois, culture, sol nu] —
 *        `TERRAIN_LOOK.unclassifiedWeights`.
 */
export function grassSampleFallback(sample, unclassifiedWeights) {
  if (sample) return sample;
  const [grass, wood, farmland, bare] = unclassifiedWeights;
  return { grass, wood, farmland, bare };
}

/**
 * Vrai si une vraie culture occupe ce point et doit effacer l'herbe
 * générique. La lisière — herbe et culture mêlées dans la carte de classes —
 * reste seule à fleurir en coquelicot (voir `grassVariantFor`), donc elle
 * n'est jamais bloquée ici : c'est la même condition `edge` que là-bas.
 * Fonction pure.
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
 * rend par la seule couleur du sol (voir `TERRAIN_LOOK.coverAlbedo`, qui la
 * porte, elle).
 *
 * Fonction pure. Une couverture absente de la table pousse comme une prairie —
 * c'est-à-dire exactement comme avant que les couvertures existent.
 *
 * @param {string|null} cover Retour de `groundClass.coverAt`.
 * @param {Object} [covers] Tranche `theme.covers`.
 */
export function coverGrassFor(cover, covers = defaultTheme.covers) {
  const look = cover ? covers?.[cover] : null;
  if (!look) return COVER_GRASS_NEUTRAL;
  return {
    height: look.grassHeight ?? 1,
    density: look.grassDensity ?? 1,
    tint: look.grassTint || COVER_GRASS_NEUTRAL.tint,
  };
}

/** Voisinage sondé par `widenFieldEdge`, en mètres depuis le point d'origine. */
const FIELD_EDGE_OFFSETS_M = [
  [5, 0], [-5, 0], [0, 5], [0, -5],
  [3.5, 3.5], [-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5],
];

/**
 * Échantillon élargi pour la détection de lisière de champ.
 *
 * `GroundClassMap.sampleAt` lit **un seul pixel**, de 2,7 m de côté, sans le
 * moindre flou (voir son en-tête — le filtrage linéaire dont il parle est
 * celui du GPU, pas de cette lecture-ci, purement CPU). Au bord d'un vrai
 * polygone, un pixel est herbe ou il est culture : jamais un peu des deux à
 * la fois, sauf hasard d'anticrénelage sur une largeur d'un pixel. La
 * condition « lisière » de `grassVariantFor` et `grassBlockedByCrop` — herbe
 * *et* culture au-dessus de 0,2 au même point — ne pouvait donc pratiquement
 * jamais se déclencher : c'est ce que corrige cette fonction, en cherchant la
 * culture à quelques mètres à la ronde plutôt que sur le seul pixel interrogé.
 *
 * Elle ne fait rien sur un point déjà en pleine culture, ni sur de la
 * bare/du bois — sa réponse ne compte que pour un point déjà herbeux, seul
 * cas où `grassVariantFor` et `grassBlockedByCrop` la consultent.
 *
 * Fonction pure, hormis la lecture de `groundClass`.
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
   *        trottoirs. Depuis qu'un quartier d'habitation porte une part
   *        d'herbe (voir `groundClassFor`), le semis atteint la voirie : sans
   *        cette seconde exclusion, les touffes traverseraient la bordure.
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
    this.disposed = false;
    this._anchor = null;
    this._frame = null;
    this._bands = GRASS_BANDS;
    this._cells = coverBandRing(this._bands);
    // Une seule allocation, dimensionnée sur la bande la plus fournie : les
    // bandes lointaines en utilisent le début et laissent le reste tranquille.
    const widest = Math.max(...this._bands.map((band) => band.perCell));
    this._tufts = new Float32Array(widest * GRASS_TUFT_STRIDE);

    this.texture = new THREE.CanvasTexture(createGrassAtlasCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = createCrossedQuads(THREE);
    // Le décalage d'atlas est une donnée **d'instance** : il faut donc le tampon
    // sur la géométrie, alloué une fois pour toutes comme les matrices — l'herbe
    // est le seul maillage de la scène qui n'est jamais réalloué.
    this._atlasOffsets = new Float32Array(count * 2);
    this.geometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._atlasOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      wind: true,
      atlas: true,
      tiles: GRASS_ATLAS_COLS,
      coverage: true,
      coverageRange: GRASS_COVERAGE_RANGE,
      coverageGain: GRASS_COVERAGE_GAIN,
      cacheKey: 'foliage-grass-cover-v3',
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'ground-cover';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // toujours autour de la caméra
    // L'herbe reçoit l'ombre mais n'en projette pas : neuf mille touffes de
    // trente centimètres coûteraient une passe d'ombres entière pour un gain
    // qu'on ne verrait pas.
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

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

  /** Fait avancer le vent. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo. L'herbe est la plante qui le montre le plus :
   * c'est sur elle que se lit d'abord qu'il s'est levé.
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
    // Un centre arrondi **par bande** : chaque grille garde son propre pas, donc
    // l'ensemble des mailles retenues ne dépend que du sol, jamais de la
    // position exacte de l'observateur.
    const bases = bands.map((band) => ({
      x: Math.round(centerX / band.cell),
      z: Math.round(centerZ / band.cell),
    }));
    const tufts = this._tufts;
    const grass = this.theme.grass;
    let placed = 0;

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const band = bands[cell.band];
      const base = bases[cell.band];
      const gx = base.x + cell.gx;
      const gz = base.z + cell.gz;

      const cellX = (gx + 0.5) * band.cell;
      const cellZ = (gz + 0.5) * band.cell;
      // Repli sur le non-classé du terrain : voir `grassSampleFallback`.
      const sample = grassSampleFallback(
        groundClass?.sampleAt(cellX, cellZ) ?? null,
        this.theme.terrain.unclassifiedWeights
      );
      // Même lecture que `greenAt`, mais on garde l'échantillon complet : c'est
      // la présence simultanée d'herbe et de culture qui signale un bord de
      // champ, donc un coquelicot. C'est volontairement l'échantillon **brut**,
      // pas l'échantillon élargi (`edgeSample` ci-dessous) : la verdure de la
      // touffe ne doit rien à une culture qui pousse à cinq mètres de là.
      const green = Math.min(1, sample.grass + sample.farmland * 0.5);
      if (green < GRASS_GREEN_MIN) continue;

      // Échantillon élargi : voir `widenFieldEdge` sur pourquoi le pixel seul
      // ne suffit pas à détecter un bord de champ.
      const edgeSample = widenFieldEdge(groundClass, cellX, cellZ, sample);

      // Une vraie culture efface l'herbe générique — voir `grassBlockedByCrop`.
      const crop = groundClass?.cropAt?.(cellX, cellZ) ?? null;
      if (grassBlockedByCrop(edgeSample, crop)) continue;

      // Couverture du sol : lande, maquis, marais… Elle ne décide pas *si* de
      // l'herbe pousse — c'est la part de végétal qui le dit — mais de quelle
      // taille, en quelle quantité et de quelle couleur.
      const coverLook = coverGrassFor(
        groundClass?.coverAt?.(cellX, cellZ) ?? null,
        this.theme.covers
      );

      const fade = coverBandFade(cell.distance, band);
      if (fade <= 0.02) continue;
      // La hauteur ne suit pas le fondu jusqu'à zéro : c'est la densité qui
      // passe la main d'une bande à l'autre, pas la taille.
      const heightFade = coverHeightFade(fade, GRASS_HEIGHT_FADE_FLOOR);
      // À distance, une instance représente plusieurs mètres carrés : une
      // prairie à demi verte y est une masse un peu clairsemée, pas une maille
      // sur deux vide.
      const density = coverMassDensity(green, band) * coverLook.density;

      fillGrassCell(tufts, gx, gz, band.cell, band.perCell, band.salt);

      for (let i = 0; i < band.perCell && placed < capacity; i++) {
        const at = i * GRASS_TUFT_STRIDE;
        // La couverture décide de la densité, pas de la position : une prairie
        // à demi verte donne une touffe sur deux, aux mêmes endroits.
        if (tufts[at + 2] > density * fade) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        if (inCorridor(index, x, z, GRASS_ROAD_MARGIN_M)) continue;
        if (pavement?.covers(x, z, 0)) continue;

        const tint = tufts[at + 5];
        const height =
          (grass.minHeight + tufts[at + 3] * (grass.maxHeight - grass.minHeight)) *
          // Plus l'herbe est dense, plus elle est haute : une pelouse rase et
          // une friche ne se distinguent pas autrement.
          (0.72 + green * 0.28) *
          coverLook.height *
          heightFade *
          band.rise;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
        // Élargi, pas élevé : c'est la largeur qui ferme les trous entre masses,
        // et une masse aussi haute que large ferait monter le dessus de la
        // prairie en marches d'escalier d'une bande à l'autre.
        const width = height * grass.aspect * band.spread;

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(width, height, width);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(placed, this._matrix);
        // Teinte par touffe : sans elle, un tapis de clones. Le jaune monte là
        // où la couverture faiblit — bord de champ, herbe sèche, passage.
        // Teintes resserrées depuis que la couleur d'instance est réellement
        // appliquée (voir `foliageMaterial`) : les valeurs d'avant avaient été
        // réglées à l'aveugle sur un canal qui n'arrivait pas au fragment, et
        // telles quelles elles viraient au jaune paille.
        const dry = (1 - green) * 0.5 + tint * 0.35;
        this._color.setRGB(
          (0.82 + dry * 0.26) * coverLook.tint[0],
          (0.96 + tint * 0.09) * coverLook.tint[1],
          (0.74 - dry * 0.2) * coverLook.tint[2]
        );
        mesh.setColorAt(placed, this._color);

        // Fleurissement : la variante d'atlas est décidée par le sol, pas par un
        // tirage libre — coquelicots en lisière de culture, marguerites et
        // boutons d'or en prairie. Passé la bande de détail, c'est la masse
        // correspondante qui est tirée : le fleurissement décidé ici survit au
        // changement d'échelle.
        let variant = grassVariantFor(edgeSample, tufts[at + 6], this.theme.grass);
        if (cell.band > 0) variant = grassMassVariant(variant, tufts[at + 5]);
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
