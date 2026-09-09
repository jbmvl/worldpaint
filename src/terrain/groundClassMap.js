/*
 * groundClassMap — l'occupation du sol, rasterisée pour toute la scène.
 * Source unique de ce dont le sol est fait : le shader de terrain
 * (`terrainMaterial`), la végétation (`vegetationLayer`) et l'herbe/le
 * mobilier lisent tous la même carte au même endroit, donc jamais de contradiction.
 *
 * Encodage — un canal par matière, l'alpha portant la couverture :
 *
 *   R = herbe      G = bois      B = culture      alpha = classé
 *   alpha nul → non classé (l'appelant décide de son repli)
 *   alpha plein, R = G = B = 0 → sol nu, minéral ou bâti
 *
 * Les poids sont des parts, pas des étiquettes : une entité peut en peindre
 * plusieurs à la fois (le lotissement en est le cas type — voir `groundClassFor`).
 * Filtrage linéaire : les lisières se fondent sur quelques mètres, ce qui est
 * plus juste que la donnée elle-même.
 *
 * ## La seconde carte : ce qui pousse, et de quelle sorte
 *
 * Quatre matières ne distinguent pas une lande écossaise d'une prairie
 * normande — les deux sont de l'herbe, alors que les tuiles savent le dire
 * (`landcover.subclass` vaut `heath`, `scrub`, `wetland`, `scree`, `dune`…).
 * Cette information était lue puis jetée ; elle vit maintenant dans la carte
 * des cultures, qui n'utilisait qu'un de ses canaux :
 *
 *   R = identifiant de culture    (`CROP_KINDS`)
 *   G = identifiant de couverture (`COVER_KINDS`)
 *   alpha = peint
 *
 * Deux identifiants indépendants, même repère, filtrés au plus proche : une
 * parcelle porte une culture **ou** une couverture, jamais un mélange, et les
 * deux se lisent d'un seul échantillonnage.
 *
 * L'eau est une couverture comme les autres (`water`), et c'est la seule
 * description de l'eau dans la scène : il n'y a pas de plan d'eau posé sur le
 * terrain, le sol *est* l'eau là où la carte le dit.
 *
 * ## Le sol de la ville
 *
 * Une couverture n'est pas relevée : `pavement` est **déduite**. Entre la
 * chaussée et les façades, un centre-ville n'a ni herbe ni sol nu, il a du
 * trottoir — et le dire ici plutôt qu'en géométrie est ce qui permet au
 * revêtement d'aller jusqu'aux murs, d'épouser n'importe quelle forme de bâti
 * et de ne laisser aucun trou, sans qu'aucune couche n'ait à connaître le
 * contour des bâtiments.
 *
 * Elle est peinte par sa propre passe (`_paintPavement`), à un rang précis :
 *
 *     landuse (occupation) → PAVEMENT → vert urbain → landcover
 *
 * Ce rang **est** la règle des parcs. Le revêtement recouvre `settled` (un
 * quartier d'habitation n'est pas deux tiers d'herbe en centre-ville) et se
 * fait recouvrir par tout ce qui décrit du vert — cimetière, stade et terrain
 * de jeu par le troisième temps, parc, bois et prairie par `landcover`. Un parc
 * en ville reste donc un parc, avec son herbe et ses allées de terre, sans
 * aucune règle de plus. Le vert urbain est en outre retiré du revêtement en
 * **trous** au moment de le peindre, et pas seulement recouvert après : sinon
 * la couverture, elle, resterait dessous et le parc se peindrait en dalle.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { cropFor, cropId, cropFromId, randomAt, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import { URBAN_GREEN_LANDUSE } from '../layers/settlement.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Côté du carré couvert, en mètres. Il doit dépasser la portée du sol de
 * proximité (un kilomètre) **plus** la distance parcourue entre deux
 * rasterisations, sinon la matière s'arrêterait net avant la fin du fondu.
 */
export const CLASS_AREA_M = 4096;
/** Côté de la carte, en pixels. ~2,7 m par pixel : une lisière n'est pas un trait. */
export const CLASS_PIXELS = 1536;
/** Déplacement de l'observateur avant re-rasterisation, en mètres. */
export const CLASS_REBUILD_M = 400;

/**
 * Couches source lues, dans l'ordre de dessin (les dernières recouvrent).
 *
 * La couche `park` n'en fait **pas** partie, et c'est un piège de nommage : au
 * schéma OpenMapTiles elle ne contient aucun parc de ville, mais
 * `boundary=protected_area`, `boundary=national_park`, `leisure=nature_reserve`
 * — des périmètres de protection, souvent immenses (Natura 2000 couvre presque
 * tout le littoral français, la Camargue, les Landes). Un périmètre juridique
 * ne dit rien de la matière du sol. Le parc de ville, lui, arrive bien :
 * `leisure=park`, `garden`, `village_green`, `recreation_ground` et
 * `golf_course` sont rangés par le schéma dans `landcover`, classe `grass`.
 */
export const CLASS_SOURCE_LAYERS = ['landuse', 'landcover'];

/** Couches source de l'eau, dans les tuiles vectorielles. */
export const WATER_SOURCE_LAYER = 'water';
export const WATERWAY_SOURCE_LAYER = 'waterway';

/** Vrai si une surface d'eau compte (les piscines produisent des confettis bleus à cette échelle). */
export function isDrawableWater(properties = {}) {
  if (properties.brunnel === 'tunnel') return false;
  return properties.class !== 'swimming_pool';
}

/**
 * Demi-largeur d'un cours d'eau linéaire, ou `null` s'il n'a pas de surface
 * d'eau visible. Un cours d'eau souterrain n'en a pas ; un cours d'eau
 * intermittent, la plupart du temps, non plus. Fonction pure.
 */
export function waterwayStyleFor(properties = {}, waterways = defaultTheme.water.waterways) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.intermittent === 1 || properties.intermittent === true) return null;
  const width = waterways[properties.class];
  return width ? { halfWidth: width / 2 } : null;
}

/**
 * Distance à laquelle `woodEdgeAt` va chercher le dehors, en mètres. Plus
 * large que le fondu de la carte (2,7 m par pixel, filtré) pour ne pas prendre
 * le flou d'un bord pour le bord lui-même ; plus étroite que la profondeur d'un
 * ourlet, faute de quoi tout un bosquet serait sa propre lisière.
 */
export const WOOD_EDGE_REACH_M = 14;

/** Voisins sondés par `woodEdgeAt` : les quatre directions cardinales suffisent à couper un bord, quelle que soit son orientation. */
const WOOD_EDGE_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Matière d'une entité surfacique, ou `null` si elle n'en décrit aucune.
 *
 * `landuse=residential` ne prend pas `bare` : c'est un périmètre
 * administratif où le sol réel est majoritairement de l'herbe (pelouses,
 * jardins), le minéral ne couvrant que la chaussée et ses abords (composés
 * séparément par `streetLayer`). D'où `settled` : part d'herbe dominante,
 * part de minéral. Une zone d'activité (industrielle, commerciale, ferroviaire,
 * carrière), elle, reste `bare` : réellement minérale sur toute sa surface.
 *
 * La couche `park` rendait `grass`, et c'était le défaut le plus coûteux de ce
 * module : elle ne porte pas de parcs mais des périmètres de protection (voir
 * `CLASS_SOURCE_LAYERS`), peints en dernier par-dessus tout le reste. Un
 * cordon dunaire classé, un marais protégé, une forêt de parc naturel
 * régional : tous ramenés à de l'herbe, et leur couverture effacée avec.
 */
export function groundClassFor(sourceLayer, properties = {}) {
  const klass = properties.class;

  if (sourceLayer === 'landcover') {
    if (klass === 'wood') return 'wood';
    if (klass === 'grass' || klass === 'wetland') return 'grass';
    if (klass === 'farmland') return 'farmland';
    if (klass === 'rock' || klass === 'sand' || klass === 'ice') return 'bare';
    // `glacier` et `ice_shelf` arrivent par la sous-classe.
    if (properties.subclass === 'glacier' || properties.subclass === 'ice_shelf') return 'bare';
    return null;
  }

  if (sourceLayer === 'landuse') {
    if (klass === 'cemetery' || klass === 'pitch' || klass === 'playground' || klass === 'stadium') {
      return 'grass';
    }
    if (klass === 'residential' || klass === 'suburb' || klass === 'neighbourhood' || klass === 'quarter') {
      return 'settled';
    }
    if (klass === 'industrial' || klass === 'commercial' || klass === 'retail' || klass === 'railway' || klass === 'quarry') {
      return 'bare';
    }
    return null;
  }

  return null;
}

/** Part d'herbe d'un quartier d'habitation (ordre de grandeur du non-bâti/non-revêtu dans un lotissement français). */
export const SETTLED_GRASS = 0.66;

/**
 * Couleur de remplissage d'une matière. L'alpha vaut toujours 255 (distingue
 * « classé sol nu » de « pas classé du tout »). `settled` est le seul
 * remplissage partiel : un mélange d'herbe et de minéral écrit dans le canal rouge.
 */
export const CLASS_FILL = {
  grass: 'rgba(255, 0, 0, 1)',
  wood: 'rgba(0, 255, 0, 1)',
  farmland: 'rgba(0, 0, 255, 1)',
  settled: `rgba(${Math.round(SETTLED_GRASS * 255)}, 0, 0, 1)`,
  bare: 'rgba(0, 0, 0, 1)',
};

/**
 * Les couvertures, dans l'ordre de leur identifiant.
 *
 * Même contrat que `CROP_KINDS`, et les mêmes précautions : l'identifiant vaut
 * `indice + 1`, il est **peint** dans le canal vert de la carte des cultures, et
 * relu des deux côtés — par le shader de terrain, qui en tire la couleur du sol
 * jusqu'à l'horizon, et par l'herbe et la végétation, qui décident de ce qui y
 * pousse. L'ordre est donc gravé : le changer repeint une lande en éboulis.
 *
 * Les trois premières sont **végétales** (peintes sur de l'herbe), les cinq
 * suivantes **minérales** (peintes sur du sol nu).
 *
 * `pavement` n'a pas de source dans les tuiles, et c'est la seule : elle n'est
 * pas une matière relevée mais une **déduction** — le sol d'une ville, entre la
 * chaussée et les façades, est revêtu. Elle est peinte par sa propre passe
 * (voir `rebuild`), à un endroit précis de l'ordre : après l'occupation du sol,
 * qu'elle recouvre, et avant le vert urbain, qui la recouvre à son tour. C'est
 * cet ordre-là, et rien d'autre, qui laisse un parc et un cimetière verts au
 * milieu du bitume.
 */
export const COVER_KINDS = [
  'heath',
  'scrub',
  'wetland',
  'alpine',
  'scree',
  'rock',
  'sand',
  'pavement',
  'water',
];

/**
 * Rang de l'eau dans `COVER_KINDS`, à partir de 1 comme tous les
 * identifiants peints. Le shader de terrain en a besoin nommément : l'eau
 * n'est pas une matière de plus, elle remplace tout ce qui la précède.
 */
export const WATER_COVER_ID = COVER_KINDS.indexOf('water') + 1;

/**
 * Pas entre deux identifiants dans le canal vert.
 *
 * Vingt-cinq, et non trente : neuf couvertures à trente dépasseraient 255. Le
 * pas ne sert qu'à écarter deux identifiants d'assez pour qu'un filtrage au
 * plus proche ne les confonde pas — douze niveaux de marge suffisent
 * largement, l'arrondi de lecture ayant la moitié du pas pour lui.
 */
export const COVER_ID_STEP = 25;

/** Rang du revêtement urbain, à partir de 1 comme tous les identifiants peints. */
export const PAVEMENT_COVER_ID = COVER_KINDS.indexOf('pavement') + 1;

/**
 * Couverture décrite par une entité surfacique, ou `null`.
 *
 * Seule la couche `landcover` en porte : `landuse` décrit qui occupe le sol,
 * pas de quoi il est fait. Les valeurs de `subclass` sont celles du schéma
 * OpenMapTiles, qui y recopie le tag OSM d'origine (`natural`, `landuse`,
 * `leisure` ou `wetland`).
 *
 * Fonction pure.
 */
export function coverFor(sourceLayer, properties = {}) {
  if (sourceLayer !== 'landcover') return null;
  const klass = properties.class;
  const subclass = properties.subclass;

  if (klass === 'wetland') return 'wetland';
  if (klass === 'sand') return 'sand';
  // L'éboulis et la dalle sont deux paysages différents : l'un est une pente de
  // cailloux qui bouge, l'autre un plateau de pierre. Les confondre était le
  // défaut du gris unique.
  if (klass === 'rock') return subclass === 'scree' ? 'scree' : 'rock';
  if (klass === 'grass') {
    if (subclass === 'heath') return 'heath';
    if (subclass === 'scrub' || subclass === 'shrubbery') return 'scrub';
    // `fell` est la pelouse d'altitude au-dessus de la limite forestière ;
    // `tundra` en est l'équivalent boréal.
    if (subclass === 'fell' || subclass === 'tundra') return 'alpine';
  }
  return null;
}

/** Identifiant d'une couverture dans la carte, ou 0. Fonction pure. */
export function coverId(cover) {
  const index = COVER_KINDS.indexOf(cover);
  return index < 0 ? 0 : index + 1;
}

/** Couverture portée par une valeur du canal vert, ou `null`. Fonction pure. */
export function coverFromId(green) {
  const index = Math.round(green / COVER_ID_STEP) - 1;
  return COVER_KINDS[index] || null;
}

/** Anneaux d'une géométrie surfacique. */
export function classPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

export class GroundClassMap {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} [options.theme] Fournit `theme.water.waterways` (largeur
   *        des cours d'eau) et `theme.water.riparianBufferM` (largeur de la
   *        ripisylve) — voir `rebuild`.
   */
  constructor({ THREE, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    /**
     * Famille climatique du lieu, ou `null`. La carte des cultures est le seul
     * endroit où une culture est tirée (voir `cropFor`), donc c'est ici que le
     * climat doit arriver — pas dans `cropLayer`, qui ne fait que relire.
     */
    this.climate = null;
    this.canvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace; // les canaux portent des poids, pas une couleur
    // Sans ce réglage, three retourne l'image et la carte serait en miroir nord-sud.
    this.texture.flipY = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    // Carte des cultures : même carré, même repère, identifiant de culture
    // dans le rouge au lieu de poids de matière.
    this.cropCanvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.cropCtx = this.cropCanvas.getContext('2d', { willReadFrequently: true });

    this.cropTexture = new THREE.CanvasTexture(this.cropCanvas);
    this.cropTexture.colorSpace = THREE.NoColorSpace;
    this.cropTexture.flipY = false;
    this.cropTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cropTexture.wrapT = THREE.ClampToEdgeWrapping;
    // Au plus proche, contrairement à la carte de classes : le rouge porte un
    // identifiant, pas une quantité (interpoler donnerait une culture inventée).
    this.cropTexture.minFilter = THREE.NearestFilter;
    this.cropTexture.magFilter = THREE.NearestFilter;
    this.cropTexture.generateMipmaps = false;

    /** Coin nord-ouest du carré couvert, en mètres locaux. */
    this.origin = new THREE.Vector2(0, 0);
    this.size = CLASS_AREA_M;
    this.count = 0;
    /** Numéro de rasterisation, incrémenté à chaque repeinte (sert à qui garde ce qu'il a lu ici, ex. la végétation). */
    this.revision = 0;

    /** Copie CPU, relue par la végétation. `null` tant que rien n'a été peint. */
    this._data = null;
    this._cropData = null;

    this._anchor = null;
    this._frame = null;
    this.disposed = false;
  }

  /**
   * Pose la famille climatique du lieu. Le compositeur repeint la carte quand
   * elle change : ce qui a été semé sous un autre climat n'est plus valable.
   */
  setClimate(family) {
    this.climate = family || null;
  }

  /**
   * Matières présentes en un point, ou `null` hors carte ou non classé (même
   * donnée que celle lue par le shader, au même endroit).
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {{grass:number, wood:number, farmland:number, bare:number}|null}
   */
  sampleAt(x, z) {
    const data = this._data;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null; // la donnée ne dit rien ici

    const grass = data[i] / 255;
    const wood = data[i + 1] / 255;
    const farmland = data[i + 2] / 255;
    return { grass, wood, farmland, bare: Math.max(0, 1 - grass - wood - farmland) };
  }

  /**
   * Part de végétal au sol, de 0 à 1, ou `null` si la donnée se tait —
   * l'entrée de l'herbe et des alignements d'arbres. Une culture ne compte
   * que pour moitié (herbe une partie de l'année seulement).
   */
  greenAt(x, z) {
    const sample = this.sampleAt(x, z);
    if (!sample) return null;
    return Math.min(1, sample.grass + sample.farmland * 0.5);
  }

  /** Part de boisé, de 0 à 1. Zéro là où la donnée se tait : on ne devine pas un bois. */
  woodAt(x, z) {
    return this.sampleAt(x, z)?.wood ?? 0;
  }

  /**
   * Part de lisière d'un point : 0 en plein bois comme hors du bois, 1 sur un
   * bord franc. C'est la seule réponse à « suis-je à l'ourlet ? », et deux
   * couches la posent — la végétation, qui y baisse la houppe et y épaissit le
   * fourré, et le mobilier, qui n'empile du bois qu'au bord.
   *
   * Mesurée par comparaison avec le voisinage, pas par un gradient : ce qui
   * compte est l'écart au voisin **le plus ouvert**, sinon un coin de bois
   * répond moins qu'un bord droit alors qu'il est plus lisière encore.
   *
   * Un voisin dont la carte ne dit rien ne compte pas : on ne devine pas une
   * lisière là où la donnée se tait — sans quoi tout le pourtour du carré
   * couvert en serait une.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @param {number} [reach] Distance du sondage, en mètres.
   * @returns {number} de 0 à 1.
   */
  woodEdgeAt(x, z, reach = WOOD_EDGE_REACH_M) {
    const here = this.sampleAt(x, z)?.wood ?? 0;
    if (here <= 0) return 0;
    let open = 0;
    for (const [dx, dz] of WOOD_EDGE_OFFSETS) {
      const neighbour = this.sampleAt(x + dx * reach, z + dz * reach);
      if (!neighbour) continue;
      const gap = here - neighbour.wood;
      if (gap > open) open = gap;
    }
    return Math.min(1, open / here);
  }

  /**
   * Culture portée par un point, ou `null` (hors carte, hors champ, ou
   * culture qu'on ne sait pas nommer). Seule réponse à « qu'est-ce qui pousse
   * ici », lue aussi par le shader, `cropLayer`, et le mobilier.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null}
   */
  cropAt(x, z) {
    const data = this._cropData;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null;
    return cropFromId(data[i]);
  }

  /**
   * Couverture portée par un point, ou `null` — hors carte, ou couverture
   * ordinaire (une prairie n'en est pas une : c'est le cas par défaut).
   *
   * Lue dans le canal **vert** de la carte des cultures, au même repère et au
   * même échantillonnage que la culture elle-même. C'est la seule réponse à la
   * question « de quelle sorte est ce sol » : le shader de terrain y prend sa
   * couleur, l'herbe sa hauteur, la végétation ses arbustes.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null}
   */
  coverAt(x, z) {
    const data = this._cropData;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null;
    return coverFromId(data[i + 1]);
  }

  /** Vrai dès qu'une carte des cultures **et des couvertures** a été relue. */
  get cropReady() {
    return this._cropData !== null;
  }

  /** Vrai dès qu'une rasterisation a été relue : avant, personne ne sait rien. */
  get ready() {
    return this._data !== null;
  }

  /**
   * Part d'un rectangle, en mètres locaux, sur laquelle la carte a quelque
   * chose à dire : de 0 (rien, hors carte) à 1 (tout). Une tuile de coin
   * déborde régulièrement du carré couvert (qui suit l'observateur par sauts
   * de 400 m) ; sans cette mesure, une forêt tombant juste après le bord au
   * moment de sa plantation ne poussait jamais.
   */
  coverageOf(minX, minZ, maxX, maxZ, frame = null) {
    if (!this.ready) return 0;
    if (frame && this._frame !== frame) return 0;
    const area = (maxX - minX) * (maxZ - minZ);
    if (!(area > 0)) return 0;
    const overlapX = Math.min(maxX, this.origin.x + this.size) - Math.max(minX, this.origin.x);
    const overlapZ = Math.min(maxZ, this.origin.y + this.size) - Math.max(minZ, this.origin.y);
    if (overlapX <= 0 || overlapZ <= 0) return 0;
    return Math.min(1, (overlapX * overlapZ) / area);
  }

  needsRebuild(x, z, frame) {
    if (this._frame !== frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= CLASS_REBUILD_M;
  }

  /**
   * Le sol revêtu de la ville : entre la chaussée et les façades, un
   * centre-ville n'a pas de sol nu ni d'herbe, il a du trottoir.
   *
   * Trois termes, ceux du masque urbain (voir `settlement.UrbanMask`) : le
   * **disque** d'agglomération borne la portée et sert de découpe ; les
   * emprises **bâties** donnent la forme ; le **vert urbain** est retiré, et
   * l'est ici en trous d'un remplissage pair-impair plutôt qu'en effacement —
   * effacer creuserait aussi l'occupation du sol déjà peinte dessous.
   *
   * Une emprise à la fois, et non toutes en un tracé : deux emprises bâties
   * qui se recouvrent (un quartier dans une commune) s'annuleraient en
   * pair-impair, et la ville aurait un trou là où elle est le plus dense.
   *
   * Le revêtement s'écrit dans les deux cartes : sol nu dans celle des
   * matières (ni herbe ni semis n'y poussent, gratuitement), couverture
   * `pavement` dans celle des cultures, d'où le shader tire sa couleur.
   *
   * @returns {number} emprises revêtues.
   */
  _paintPavement(urban, originX, originZ, perMeter) {
    if (!urban?.any || !urban.builtUp?.length) return 0;
    const { ctx, cropCtx } = this;

    const ringPath = (ring, into = new Path2D()) => {
      for (let i = 0; i < ring.length; i++) {
        const px = (ring[i].x - originX) * perMeter;
        const pz = (ring[i].z - originZ) * perMeter;
        if (i === 0) into.moveTo(px, pz);
        else into.lineTo(px, pz);
      }
      into.closePath();
      return into;
    };

    // La découpe : les disques d'agglomération. Ce sont eux, et rien d'autre,
    // qui font qu'un village bâti ne se retrouve pas pavé jusqu'aux jardins.
    const discs = new Path2D();
    for (const disc of urban.discs) {
      discs.arc(
        (disc.x - originX) * perMeter,
        (disc.z - originZ) * perMeter,
        disc.radius * perMeter,
        0,
        Math.PI * 2
      );
      discs.closePath();
    }

    // Les trous, construits une fois : ils sont les mêmes pour chaque emprise.
    const greens = new Path2D();
    for (const ring of urban.greens || []) {
      if (Array.isArray(ring) && ring.length >= 3) ringPath(ring, greens);
    }

    ctx.save();
    cropCtx.save();
    ctx.clip(discs);
    cropCtx.clip(discs);
    ctx.fillStyle = CLASS_FILL.bare;
    cropCtx.fillStyle = `rgba(0, ${PAVEMENT_COVER_ID * COVER_ID_STEP}, 0, 1)`;
    let painted = 0;

    for (const ring of urban.builtUp) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const path = ringPath(ring);
      path.addPath(greens);
      ctx.fill(path, 'evenodd');
      cropCtx.fill(path, 'evenodd');
      painted++;
    }

    cropCtx.restore();
    ctx.restore();
    return painted;
  }

  /**
   * Re-rasterise la carte autour d'un point.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Object} frame  Repère local de la bulle.
   * @param {Object} [options]
   * @param {Object|null} [options.urban] `UrbanMask` : le sol revêtu de la
   *        ville. Absent, aucune passe de revêtement — c'est le comportement de
   *        campagne, et celui d'avant ce lot.
   * @returns {boolean} vrai si des surfaces ont été peintes.
   */
  rebuild(source, tiles, here, frame, { urban = null } = {}) {
    if (this.disposed || !source || !frame) return false;

    const { ctx } = this;
    const half = CLASS_AREA_M / 2;
    const originX = here.x - half;
    const originZ = here.z - half;
    const perMeter = CLASS_PIXELS / CLASS_AREA_M;
    const { origin, scale, zoom } = frame;

    // Transparent = non classé, distinct du sol nu.
    ctx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);
    this.cropCtx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);

    let painted = 0;

    // L'ordre compte, et il compte maintenant à trois temps :
    //
    //   occupation du sol → revêtement urbain → vert urbain → landcover
    //
    // Le revêtement de ville recouvre `settled` (un quartier d'habitation
    // n'est pas deux tiers d'herbe en centre-ville), et le vert urbain
    // — cimetière, stade, terrain de jeu — le recouvre à son tour. Sans ce
    // troisième temps, un cimetière peint avant le revêtement dans l'ordre des
    // entités de la tuile disparaîtrait sous le bitume, et l'ordre des entités
    // dans une tuile n'est pas quelque chose dont on décide.
    //
    // Le vert urbain n'est donc pas relu : son tracé est **différé**, mis de
    // côté au passage et rejoué après le revêtement. Une seule traversée de
    // `landuse`, comme avant.
    const deferred = [];

    for (const sourceLayer of CLASS_SOURCE_LAYERS) {
      source.forEachFeature(sourceLayer, tiles, (geometry, properties) => {
        const kind = groundClassFor(sourceLayer, properties);
        if (!kind) return;
        const green = sourceLayer === 'landuse' && URBAN_GREEN_LANDUSE.has(properties.class);

        ctx.fillStyle = CLASS_FILL[kind];
        for (const rings of classPolygons(geometry)) {
          if (!Array.isArray(rings) || rings.length === 0) continue;

          // Tracé construit une fois, rempli deux fois (matière + culture).
          const path = new Path2D();
          let sumX = 0;
          let sumZ = 0;
          let counted = 0;

          for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            for (let i = 0; i < ring.length; i++) {
              const [lng, lat] = ring[i];
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
              const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
              const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
              if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              // Centre = graine de la culture ; seul l'anneau extérieur compte.
              if (ring === rings[0]) {
                sumX += localX;
                sumZ += localZ;
                counted++;
              }
            }
            path.closePath();
          }

          if (green) {
            // Rejoué après le revêtement : voir plus haut.
            deferred.push({ path, fill: CLASS_FILL[kind] });
            painted++;
            continue;
          }

          ctx.fill(path, 'evenodd'); // anneaux intérieurs = trous
          painted++;

          // Couverture fine — lande, maquis, marais, éboulis. Elle vit dans le
          // canal vert de la carte des cultures (voir l'en-tête).
          const cover = coverId(coverFor(sourceLayer, properties));

          if (kind !== 'farmland') {
            if (cover) {
              this.cropCtx.fillStyle = `rgba(0, ${cover * COVER_ID_STEP}, 0, 1)`;
              this.cropCtx.fill(path, 'evenodd');
            }
            continue;
          }
          if (counted === 0) continue;
          // Tirée ici et nulle part ailleurs, ancrée au sol (centre de la parcelle).
          const id = cropId(
            cropFor(properties, randomAt(sumX / counted, sumZ / counted, 43), this.climate)
          );
          if (!id && !cover) continue;
          this.cropCtx.fillStyle = `rgba(${id * CROP_ID_STEP}, ${cover * COVER_ID_STEP}, 0, 1)`;
          this.cropCtx.fill(path, 'evenodd');
        }
      });

      // Le revêtement de ville et le vert qu'il ne recouvre pas, entre les
      // deux couches source : `landuse` vient de poser l'occupation, et
      // `landcover` posera par-dessus la matière réelle — un parc, un bois,
      // une prairie —, ce qui est exactement le rang qu'on veut leur laisser.
      if (sourceLayer === 'landuse') {
        painted += this._paintPavement(urban, originX, originZ, perMeter);
        for (const piece of deferred) {
          ctx.fillStyle = piece.fill;
          ctx.fill(piece.path, 'evenodd');
        }
      }
    }

    // Ripisylve : une bande de bois tracée le long des cours d'eau linéaires
    // (`waterway`, pas un polygone), plantée par `vegetationLayer` avec les
    // mêmes silhouettes qu'une vraie forêt. Après les polygones : le lit d'un
    // ruisseau qui traverse un champ de blé doit y remplacer la culture.
    {
      const waterways = this.theme.water.waterways;
      const bufferM = this.theme.water.riparianBufferM ?? 0;
      if (bufferM > 0) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = CLASS_FILL.wood;
        this.cropCtx.save();
        this.cropCtx.lineCap = 'round';
        this.cropCtx.lineJoin = 'round';

        source.forEachFeature(WATERWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
          // Un fossé n'a pas de ripisylve.
          if (properties.class === 'ditch') return;
          const style = waterwayStyleFor(properties, waterways);
          if (!style) return;
          const width = style.halfWidth * 2;

          const lines =
            geometry.type === 'LineString'
              ? [geometry.coordinates]
              : geometry.type === 'MultiLineString'
                ? geometry.coordinates
                : [];
          const lineWidthPx = (width + bufferM * 2) * perMeter;

          for (const line of lines) {
            if (!Array.isArray(line) || line.length < 2) continue;
            const path = new Path2D();
            let started = false;
            for (const [lng, lat] of line) {
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
              const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
              const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
              const px = (localX - originX) * perMeter;
              const pz = (localZ - originZ) * perMeter;
              if (!started) {
                path.moveTo(px, pz);
                started = true;
              } else {
                path.lineTo(px, pz);
              }
            }
            if (!started) continue;

            ctx.lineWidth = lineWidthPx;
            ctx.stroke(path);
            // Le trait est centré sur l'axe : il faut reprendre le lit, sinon
            // un large cours d'eau se retrouve planté d'arbres en son milieu.
            // Peint en sol nu, et non effacé : effacer rendrait le lit « non
            // classé », dont le repli est l'herbe (`unclassifiedWeights`).
            ctx.save();
            ctx.strokeStyle = CLASS_FILL.bare;
            ctx.lineWidth = width * perMeter;
            ctx.stroke(path);
            ctx.restore();
            // Dans l'autre carte, deux traits, et l'ordre n'est pas
            // indifférent. D'abord l'ourlet entier efface ce qui poussait là
            // (un champ ne pousse pas sous un bosquet)…
            this.cropCtx.save();
            this.cropCtx.globalCompositeOperation = 'destination-out';
            this.cropCtx.strokeStyle = '#000';
            this.cropCtx.lineWidth = lineWidthPx;
            this.cropCtx.stroke(path);
            this.cropCtx.restore();
            // …puis le lit reprend par-dessus, en eau. Peint avant, il serait
            // effacé par l'ourlet qui est plus large ; peint sous
            // `destination-out`, il effacerait au lieu de peindre — la couleur
            // d'une source n'est pas lue dans ce mode. Les deux à la fois, et
            // c'était le défaut : aucun cours d'eau linéaire ne portait d'eau.
            this.cropCtx.save();
            this.cropCtx.strokeStyle = `rgba(0, ${WATER_COVER_ID * COVER_ID_STEP}, 0, 1)`;
            this.cropCtx.lineWidth = width * perMeter;
            this.cropCtx.stroke(path);
            this.cropCtx.restore();
            painted++;
          }
        });

        this.cropCtx.restore();
      }
    }

    // Le lit d'un grand cours d'eau est un polygone (`water`), pas seulement
    // le trait `waterway` (dont la largeur de thème décrit un ruisseau, pas un
    // fleuve). On reprend donc, après coup, tout ce qui a été peint sous
    // l'emprise réelle de l'eau — en sol nu, et non en effaçant : une case
    // effacée est « non classée », dont le repli est l'herbe pleine.
    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (!isDrawableWater(properties)) return;
      for (const rings of classPolygons(geometry)) {
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const path = new Path2D();
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
            const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
            if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
            else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
          }
          path.closePath();
        }

        ctx.save();
        ctx.fillStyle = CLASS_FILL.bare;
        ctx.fill(path, 'evenodd');
        ctx.restore();

        // Et la matière : de l'eau. C'est de là que le shader de terrain tire
        // le plan d'eau lui-même.
        this.cropCtx.save();
        this.cropCtx.fillStyle = `rgba(0, ${WATER_COVER_ID * COVER_ID_STEP}, 0, 1)`;
        this.cropCtx.fill(path, 'evenodd');
        this.cropCtx.restore();
      }
    });

    this.count = painted;
    this.revision++;
    this.origin.set(originX, originZ);
    this.texture.needsUpdate = true;
    this.cropTexture.needsUpdate = true;

    // Relecture unique, à la rasterisation (un `getImageData` par appel serait ruineux).
    try {
      this._data = ctx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS).data;
    } catch (e) {
      this._data = null;
      console.warn('[groundClassMap] relecture impossible', e?.message || e);
    }
    // Relue en entier, comme celle des matières, pour la même indexation.
    try {
      this._cropData = this.cropCtx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS).data;
    } catch (e) {
      this._cropData = null;
      console.warn('[groundClassMap] relecture des cultures impossible', e?.message || e);
    }
    this._anchor = { x: here.x, z: here.z };
    this._frame = frame;
    return painted > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._data = null;
    this._cropData = null;
    this.texture.dispose();
    this.cropTexture.dispose();
  }
}
