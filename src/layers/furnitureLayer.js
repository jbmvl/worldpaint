/*
 * furnitureLayer — le mobilier, posé dans la bulle. Exécute les règles de
 * `furniturePlacement` avec les formes de `furnitureKit`, reconstruit sur la
 * même cadence que la chaussée et le bâti (tous les 250 m), à partir des
 * mêmes tuiles déjà décodées.
 *
 * Deux familles : le linéaire (haies, murets, clôtures, glissières, talus,
 * câbles) est balayé le long d'une polyligne (`appendProfile`), une seule
 * géométrie fusionnée par matière ; le ponctuel (lampadaires, poteaux,
 * panneaux, bornes, bâtiments agricoles) est instancié, un `InstancedMesh` par forme.
 *
 * Rien ne se pose sur la chaussée ni la voie ferrée (`RailwayLayer` publie
 * son propre `RoadIndex`, comme les routes) — `_onRoad` et
 * `_clipOffRoad`/`_clipInfra` interrogent les deux indistinctement.
 *
 * Forte pente : la chaussée est dressée à mi-hauteur de sa section
 * (`levelRow`), donc à la fois encaissée et portée sur un versant. En amont,
 * un mur habille la tranchée entaillée (`terrainBubble.cutElevation`) ; en
 * aval, un mur de soutènement porte la glissière ; hors versant raide, un
 * simple talus suffit. Les deux murs et la glissière n'apparaissent que là
 * où le relief, lu dans le MNT, les rend nécessaires.
 *
 * Ce qui donne de la vie (bétail, poules et linge de ferme, feux aux
 * carrefours, halo des lampadaires) reste immobile : ce qui bouge (oiseaux,
 * fumée) vit dans `lifeLayer`, animé par image.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { defaultTheme } from '../themes/default.js';
import {
  createProfileBuffer,
  appendProfile,
  appendVariableWall,
  smoothColumns,
  pathFrames,
  toColoredGeometry,
  resamplePath,
} from './ribbonGeometry.js';
import {
  HEDGE_SAMPLE_M,
  hedgeStyleFor,
  hedgeModulation,
  appendHedgeClumps,
  facetJitter,
} from './hedgeGeometry.js';
import { ROAD_SAMPLE_M, ROAD_LIFT_M } from './roadNetwork.js';
import { WATER_SOURCE_LAYER } from './waterLayer.js';
import { ROAD_CUT_M } from '../terrain/roadCut.js';
import { collectBuiltUpAreas, collectPlaceNames, nearestNamedPlace, pointInAreas, ringsOf } from './settlement.js';
import { LabelAtlas, pushLabelQuad, labelFontPxForCellHeight, LABEL_PX_PER_M } from '../materials/labelAtlas.js';
import {
  clipOutsideCorridor,
  filterOutsideCorridor,
  inCorridor,
  pushOutsideCorridor,
} from './roadCorridor.js';
import { CombinedIndex } from './roadGraph.js';
import {
  Kit,
  createFurnitureGeometries,
  createFurnitureMaterial,
  createFurnitureRotorMaterial,
  createFurnitureGreenhouseMaterial,
  advanceFurnitureRotor,
  createGlowMaterial,
  createGlowGeometry,
  createLightPoolGeometry,
  createLightPoolMaterial,
  BARBED_WIRE_HEIGHTS,
  LAMP_HEAD_HEIGHT_M,
  LAMP_HEAD_REACH_M,
  furnitureSpecsFor,
  TRAFFIC_LENS_REACH_M,
  CEMETERY_GATE_SPAN_M,
  GREENHOUSE_BASE_LENGTH_M,
} from './furnitureKit.js';
import {
  spacedAlongPath,
  realBoundaryRuns,
  boundaryFurnitureFor,
  scatterFurnitureFor,
  herdFor,
  rockKindFor,
  signKindFor,
  pathTurn,
  guardrailStyleFor,
  roadsideVergeFor,
  roadsideFurnitureFor,
  roadsideYaw,
  crossSlope,
  contiguousRuns,
  runsByValue,
  ringAreaMeters,
  scatterInRing,
  pointInRing,
  randomAt,
  positionSeed,
  ROW_CROPS,
  STEEP_CROSS_SLOPE,
  EMBANKMENT_MIN_DROP_M,
} from './furniturePlacement.js';

/**
 * Seuils de taille d'un bourg, en bâtiments comptés autour de son centroïde
 * (`FabricIndex.countWithin`) — voir `_buildVillageLandmarks`.
 */
export const VILLAGE_HAMLET_MAX_BUILDINGS = 20;
export const VILLAGE_TOWN_MAX_BUILDINGS = 150;

/** Portée du mobilier autour de l'observateur, en mètres. */
export const FURNITURE_RADIUS_M = 700;
/** Portée des seuls repères d'horizon — ils n'existent que pour la profondeur. */
export const LANDMARK_RADIUS_M = 2400;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const FURNITURE_REBUILD_M = 250;
/** Pas de ré-échantillonnage des contours de parcelles, en mètres. */
export const BOUNDARY_SAMPLE_M = 6;
/** Longueur minimale d'un contour retenu, en mètres. */
export const BOUNDARY_MIN_LENGTH_M = 30;
/**
 * Pas de ré-échantillonnage du mur d'enceinte d'un cimetière, en mètres — plus
 * fin que `BOUNDARY_SAMPLE_M` : c'est sur ce pas que se règle la largeur de la
 * brèche laissée pour le portail (`CEMETERY_GATE_SPAN_M`), qui ne tolère pas
 * l'à-peu-près d'un échantillonnage à six mètres.
 */
export const CEMETERY_WALL_SAMPLE_M = 2;
/** Décollement du mobilier au-dessus du sol : il s'ancre, il ne flotte pas. */
export const FURNITURE_SINK_M = 0.08;

/**
 * Toute la signalisation du catalogue, dans un seul endroit.
 *
 * C'est `signKindFor` qui choisit lequel poser, et il ne rend que des clés de
 * cette liste : ajouter un panneau au catalogue et l'oublier ici le rendrait
 * silencieusement invisible.
 */
export const SIGN_ITEMS = [
  'signWarning',
  'signStop',
  'signYield',
  'signPriority',
  'signSpeedLimit',
  'signNoOvertaking',
  'signRoundabout',
  'signCrossing',
  'signChevron',
  'signDirection',
  'signPlaceName',
];

/**
 * Panneau d'entrée d'agglomération : à quelle distance il va chercher son
 * nom (`settlement.nearestNamedPlace`), et à quelle distance il exige une
 * vraie grappe de bâtiments (`FabricIndex.countWithin`) avant de se
 * planter — les deux conditions sont nécessaires, sinon ce panneau se posait
 * à l'entrée de n'importe quel `landuse=residential` (un périmètre
 * administratif, pas une agglomération).
 */
export const SIGN_PLACE_NAME_MAX_M = 450;
export const SIGN_PLACE_NAME_FABRIC_RADIUS_M = 80;
/**
 * Longueur minimale, en mètres, du passage hors agglomération qui doit
 * précéder une portion bâtie pour que son début compte comme une vraie
 * entrée de ville (voir `isSettlementEdgeRun`) : sans ce garde-fou, la
 * moindre coupure entre deux polygones `landuse` adjacents en ville
 * redémarrait une portion « bâtie », donc un panneau de plus, en plein centre.
 */
export const SIGN_PLACE_NAME_MIN_GAP_M = 150;

/**
 * Vrai si la portion précédente d'une chaîne (`runsByValue`) est un vrai
 * passage hors agglomération — la seule chose qui fasse du début de la
 * portion suivante une vraie entrée de ville plutôt qu'un artefact du
 * découpage des `landuse`. Sans portion précédente, le repli est négatif :
 * une chaîne redécoupée autour de l'observateur commence très souvent déjà en ville.
 *

 * @param {{value:boolean, rows:Array<{distance:number}>}|null} previous
 * @param {number} [minGapM]
 */
export function isSettlementEdgeRun(previous, minGapM = SIGN_PLACE_NAME_MIN_GAP_M) {
  if (!previous) return false;
  const gap = previous.rows[previous.rows.length - 1].distance - previous.rows[0].distance;
  return gap >= minGapM;
}
/** Largeur de texte utilisable sur la lame blanche du panneau, en mètres —
 *  voir `signPlaceName` dans `furnitureKit.js` (face large de 1,64 m). */
export const SIGN_PLACE_NAME_TEXT_WIDTH_M = 1.5;
/** Hauteur de case visée pour le nom peint, en mètres, et son plancher (marge de part et d'autre sur la lame de 0,4 m). */
export const SIGN_PLACE_NAME_LABEL_HEIGHT_M = 0.32;
export const SIGN_PLACE_NAME_LABEL_MIN_HEIGHT_M = 0.14;
/** Repère local du texte sur la lame — voir `signPlaceName` (`y: 1.85`, face
 *  avant à `plane: 0.04`) : un centimètre devant elle, pour ne pas se
 *  disputer le pixel avec le blanc peint qu'il recouvre. */
export const SIGN_PLACE_NAME_LABEL_Y_M = 1.85;
export const SIGN_PLACE_NAME_LABEL_Z_M = 0.05;
/** Encre du nom peint : noir légèrement adouci, comme la lettre d'un vrai
 *  panneau EB10 sur fond blanc. */
export const SIGN_PLACE_NAME_LABEL_INK = '#1c1c1c';

/**
 * Vraies lumières de lampadaire présentes dans la scène. Deux, pas une de
 * plus : le nombre de lumières entre dans la clé de programme de tous les
 * matériaux. Posées sur les deux têtes les plus proches, avec un fondu
 * d'entrée et de sortie.
 */
export const LAMP_LIGHT_COUNT = 2;
/** Portée d'une de ces lumières, en mètres. */
export const LAMP_LIGHT_RANGE_M = 34;
/** Intensité de plein régime, en candela. */
export const LAMP_LIGHT_CD = 620;
/** Diamètre de la nappe de lumière au sol, en mètres. */
export const LAMP_POOL_M = 17;
/** Recul d'un feu tricolore en amont du nœud de carrefour, en mètres. */
const TRAFFIC_LIGHT_SETBACK_M = 10;
/** Durée d'un cycle de feu tricolore, en secondes. */
export const TRAFFIC_CYCLE_S = 14;

/**
 * État d'un feu tricolore à un instant donné : quelle lentille est allumée.
 * Cycle asymétrique (le vert dure, l'orange passe). `phase` décale le cycle
 * d'un feu à l'autre, sinon deux feux voisins synchrones trahissent le procédural.
 *
 * @param {number} time  Secondes écoulées.
 * @param {number} phase Décalage propre au feu, en secondes.
 * @returns {number} indice dans `TRAFFIC_LENSES` (0 rouge, 1 orange, 2 vert).
 */
export function trafficPhaseAt(time, phase = 0) {
  const t = (((time + phase) % TRAFFIC_CYCLE_S) + TRAFFIC_CYCLE_S) % TRAFFIC_CYCLE_S;
  if (t < TRAFFIC_CYCLE_S * 0.52) return 2; // vert
  if (t < TRAFFIC_CYCLE_S * 0.6) return 1; // orange
  return 0; // rouge
}

/** Portée des cailloux et blocs rocheux, en mètres. */
export const ROCK_RADIUS_M = 220;
/** Pas de la grille de semis des pierres, en mètres. */
export const ROCK_CELL_M = 14;
/** Portée des rangs de vigne et de verger, en mètres. */
export const ROW_CROP_RADIUS_M = 320;
/** Sel du facettage du feuillage de vigne (`hedgeGeometry.facetJitter`) : pas de `style` comme la haie, donc un sel dédié. */
const VINE_ROW_FACET_SALT = 733;

/**
 * Plafonds. Ils ne sont pas décoratifs : une commune de bocage dense peut
 * offrir plusieurs centaines de contours dans la bulle, et rien n'oblige à les
 * dessiner tous pour que le paysage se lise.
 */
/**
 * Seuils de détection d'une cour de ferme — voir `_looksLikeFarmstead`.
 * `landuse=farmyard` n'atteint pas les tuiles OpenFreeMap : l'indice qui
 * reste est indirect, une petite parcelle agricole qui porte à elle seule
 * une vraie grappe de bâtiments (`FabricIndex`).
 */
export const FARMSTEAD_MAX_HECTARES = 3;
/** Rayon dans lequel on cherche la grappe de bâtiments, en mètres. */
export const FARMSTEAD_CLUSTER_RADIUS_M = 80;
/** Bâtiments réels requis dans ce rayon — un seul ne fait pas une ferme. */
export const FARMSTEAD_CLUSTER_MIN_BUILDINGS = 2;

/**
 * Longueur des tunnels de serre — voir `_placeFarmstead`. En dessous du
 * minimum, le tunnel redevient le petit modèle de catalogue
 * (`GREENHOUSE_BASE_LENGTH_M`) ; au-delà du maximum, une voûte continue se
 * lirait comme un hangar sans fin.
 */
export const GREENHOUSE_MIN_LENGTH_M = 12;
export const GREENHOUSE_MAX_LENGTH_M = 60;
/** Écart centre à centre entre deux tunnels voisins, en mètres (largeur 4,2 m + une allée). */
export const GREENHOUSE_SPACING_M = 6;

export const FURNITURE_LIMITS = {
  boundaries: 180,
  // Un bocage dense peut offrir plusieurs centaines de prés et de champs dans
  // les 700 m de portée — voir `FURNITURE_RADIUS_M` — et ce plafond, atteint
  // en cours de tuile plutôt que par distance, en écartait certains au hasard
  // de l'ordre d'arrivée plutôt que par éloignement réel.
  scatter: 640,
  points: 1100,
  farmBuildings: 32,
  landmarks: 12,
  // Un feu tricolore ne se voit qu'aux carrefours d'une agglomération, et une
  // agglomération traversée n'en compte pas vingt-quatre. Le plafond précédent
  // ne plafonnait rien : c'est la règle de détection qui en posait trop.
  trafficLights: 8,
  rocks: 200,
  vineRows: 90,
  // Antennes de sommet : posées sur les vrais sommets relevés dans les
  // tuiles (`mountain_peak`), donc bornées par leur rareté propre — la bulle
  // n'en contient jamais des dizaines.
  peakLandmarks: 6,
  // Phares : plus rares encore. Un littoral n'en porte pas un tous les
  // kilomètres, et la bulle ne montre jamais plus qu'un tronçon de côte.
  coastLandmarks: 3,
  // Arbres de crête : de vrais repères, pas un boisement — une poignée dans
  // toute la bulle, jamais un semis.
  ridgeTrees: 40,
  // Repères urbains posés sur une emprise landuse (cimetière, zone
  // industrielle, stade, foire) : un par polygone, donc rarement nombreux.
  urbanLandmarks: 14,
  // Arbustes de haie. Ils ne coûtent ni matière ni appel de dessin de plus —
  // ils s'écrivent dans le maillage de la haie —, mais un bocage dense mis
  // bout à bout fait des kilomètres de limite, et il n'y a aucune raison d'en
  // détailler plus que ce que la caméra a sous les yeux.
  hedgeClumps: 3600,
};

/** Formes ponctuelles du catalogue, dans l'ordre où on les instancie. */
export const POINT_ITEMS = [
  'streetLamp',
  'utilityPole',
  'pylon',
  'radioMast',
  'windTurbine',
  'lighthouse',
  'guardrailPost',
  'fencePostWood',
  'fencePostConcrete',
  'trafficLight',
  'milestone',
  'busShelter',
  'fountain',
  'lavoir',
  'hayBaleRound',
  'hayBaleSquare',
  'woodPile',
  'barn',
  'silo',
  'hangar',
  'greenhouse',
  'windmill',
  'watermill',
  'waterTower',
  'laundryLine',
  'cow',
  'sheep',
  'goat',
  'horse',
  'donkey',
  'chicken',
  'bush',
  'treeBroad',
  'treeConifer',
  'treeRound',
  'treeColumnar',
  'treeOval',
  'vineStock',
  'rockSmall',
  'rockBoulder',
  'rockOutcrop',
  'monument',
  'castle',
  'tower',
  'cemeteryCross',
  'cemeteryGate',
  'cemeteryTomb',
  'cemeteryTombFlat',
  'cemeteryTap',
  'factoryChimney',
  'ferrisWheel',
  'stadium',
  ...SIGN_ITEMS,
];

/** Matières linéaires : une géométrie fusionnée par matière. */
export const LINEAR_KINDS = [
  'hedge',
  'lowHedge',
  'vineRow',
  'dryStoneWall',
  'cutWall',
  'fillWall',
  'guardrailBeam',
  'woodRail',
  'woodRailTop',
  'embankment',
  'wire',
];

/**
 * Matières facettées (`hedgeGeometry.facetJitter`) : leur ombrage doit rester
 * plat, sinon les arêtes voulues sont moyennées et disparaissent à l'écran.
 * Tout le reste de `LINEAR_KINDS` garde l'ombrage lissé qu'attend un ouvrage
 * (muret, glissière, remblai, câble).
 */
const FLAT_SHADED_LINEAR_KINDS = new Set(['hedge', 'lowHedge', 'vineRow']);

/**
 * Essences plantables en alignement de route, avec leur part du tirage.
 *
 * Le conifère reste rare (0,22, la valeur d'avant ce catalogue élargi) : un
 * alignement de sapins en plaine ne se voit à peu près jamais. Les quatre
 * feuillus se partagent le reste à parts à peu près égales, aucun ne devant
 * dominer ni disparaître : la variété tient à ce qu'une route sur cinq environ
 * choisisse chaque silhouette, pas à ce qu'une seule domine les autres.
 */
const ALIGNMENT_TREE_SPECIES = [
  { item: 'treeConifer', share: 0.22 },
  { item: 'treeBroad', share: 0.195 },
  { item: 'treeRound', share: 0.195 },
  { item: 'treeColumnar', share: 0.195 },
  { item: 'treeOval', share: 0.195 },
];

/**
 * Choisit l'essence d'un alignement, tirée une fois pour toute la chaîne
 * (voir l'appelant) — jamais arbre par arbre, ce qui replanterait une haie de
 * platanes en sapins au hasard de chaque pied.
 */
function alignmentTreeSpeciesFor(x, z) {
  const draw = randomAt(x, z, 37);
  let acc = 0;
  for (const { item, share } of ALIGNMENT_TREE_SPECIES) {
    acc += share;
    if (draw < acc) return item;
  }
  return ALIGNMENT_TREE_SPECIES[ALIGNMENT_TREE_SPECIES.length - 1].item;
}

export class FurnitureLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble     Instance `TerrainBubble`.
   * @param {Object} [options.groundClass] Instance `GroundClassMap` — sert à ne
   *        pas planter d'alignement au milieu d'un bois déjà planté.
   */
  constructor({ THREE, scene, bubble, groundClass = null, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.specs = furnitureSpecsFor(theme.furniture.colors);
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.disposed = false;
    this._anchor = null;
    this._frame = null;
    this._fabric = null;
    this._railIndex = null;
    this._infraIndex = null;

    this.group = new THREE.Group();
    this.group.name = 'furniture';
    scene.add(this.group);

    this.material = createFurnitureMaterial(THREE);
    // Matériau à part pour la seule pièce qui tourne — voir son en-tête dans
    // `furnitureKit.js` sur pourquoi il n'est pas une option du précédent.
    this.rotorMaterial = createFurnitureRotorMaterial(THREE);
    // Matériau à part pour la seule pièce qui doit se voir au travers —
    // même raison, voir `createFurnitureGreenhouseMaterial`.
    this.greenhouseMaterial = createFurnitureGreenhouseMaterial(THREE);
    this.geometries = createFurnitureGeometries(THREE, theme.furniture.colors);

    /** @type {Map<string, Object>} `InstancedMesh` par forme ponctuelle. */
    this.instanced = new Map();
    /**
     * Éoliennes de la dernière reconstruction : position et échelle, sans le
     * lacet — `setWindDirection` le calcule et réécrit l'instanciation à part,
     * pour qu'une éolienne s'oriente sans attendre la prochaine reconstruction.
     * @type {Array<{x:number,y:number,z:number,yaw:number,scale:number}>}
     */
    this._turbines = [];
    this._windDirection = 0;
    this._windForce = 0;
    /** @type {Map<string, Object>} maillage fusionné par matière linéaire. */
    this.linear = new Map();
    /** Compte des objets posés lors de la dernière reconstruction. */
    this.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0, hedgeClumps: 0 };

    // Halos des lampadaires : un panneau additif par tête, éteint le jour. Ils
    // vivent dans leur propre maillage parce que leur matériau n'a rien à voir
    // avec celui du mobilier — additif, sans profondeur, sans brouillard.
    this.glowGeometry = createGlowGeometry(THREE);
    this.glowMaterial = createGlowMaterial(THREE);
    this.glowMesh = null;
    /** @type {Array<{x:number,y:number,z:number}>} têtes de lampadaire posées. */
    this._lampHeads = [];

    // Nappes de lumière au sol : une par tête de lampadaire, additive et posée
    // à plat. C'est elle qui fait qu'un lampadaire **éclaire** au lieu de
    // simplement briller — voir `createLightPoolMaterial`.
    this.poolGeometry = createLightPoolGeometry(THREE);
    this.poolMaterial = createLightPoolMaterial(THREE);
    this.poolMesh = null;

    // Les deux seules vraies lumières du décor. Leur nombre est **fixe** : il
    // entre dans la clé de programme de tous les matériaux, donc en ajouter une
    // par lampadaire recompilerait toute la scène à chaque reconstruction. Elles
    // se déplacent sur les deux têtes les plus proches (`advanceLamps`).
    this.lampLights = [];
    for (let i = 0; i < LAMP_LIGHT_COUNT; i++) {
      const light = new THREE.PointLight(0xffd9a0, 0, LAMP_LIGHT_RANGE_M, 1.7);
      light.name = `street-lamp-${i}`;
      light.position.set(0, -1000, 0);
      scene.add(light);
      this.lampLights.push(light);
    }

    // Feux tricolores : le boîtier est du mobilier ordinaire, la lentille
    // allumée non — elle change de couleur toutes les quelques secondes, donc
    // elle vit dans son propre maillage, réécrit par image.
    this.signalGeometry = new THREE.CircleGeometry(0.11, 10);
    // Attribut de couleur blanc : `vertexColors` est ce qui allume `USE_COLOR`,
    // seul define qui fasse appliquer `vColor` dans le fragment — sans lui la
    // couleur d'instance est ignorée, et sans attribut elle serait multipliée
    // par un attribut non lié, c'est-à-dire par du noir.
    const white = new Float32Array(this.signalGeometry.attributes.position.count * 3).fill(1);
    this.signalGeometry.setAttribute('color', new THREE.BufferAttribute(white, 3));
    this.signalMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false });
    this.signalMaterial.name = 'traffic-lens';
    this.signalMesh = null;
    // Pas de réglage à passer : le halo prend la couleur de l'instance dès que
    // le maillage en porte une, et c'est le cas du feu — voir `createGlowMaterial`.
    this.signalGlowMaterial = createGlowMaterial(THREE);
    this.signalGlowMesh = null;
    /** @type {Array<{x:number,y:number,z:number,yaw:number,phase:number}>} */
    this._signals = [];
    this._signalClock = 0;
    /**
     * Cheminées qui fument, publiées pour `lifeLayer`. Ce ne sont pas des objets
     * de mobilier : la fumée est animée par image, donc elle n'a rien à faire
     * dans une couche reconstruite tous les 250 mètres.
     * @type {Array<{x:number,y:number,z:number}>}
     */
    this.chimneys = [];
    /**
     * Emprise routière de la reconstruction en cours (`RoadIndex`), ou `null`.
     * Elle ne vit que le temps d'un `rebuild` : hors de là, il n'y a pas de
     * frontière à faire respecter, seulement un index périmé.
     */
    this._roadIndex = null;
    this._night = 0;
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    this._color = new THREE.Color();

    // Noms peints sur les panneaux d'entrée d'agglomération — voir l'en-tête
    // de `materials/labelAtlas.js` sur pourquoi un texte ne peut pas passer
    // par la géométrie partagée de `signPlaceName`.
    this.labelAtlas = new LabelAtlas({ THREE, width: 512, height: 256 });
    this.labelMaterial = new THREE.MeshBasicMaterial({
      map: this.labelAtlas.texture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      fog: true,
    });
    this.labelMaterial.name = 'furniture-labels';
    this.labelMesh = null;
    this.labelGeometry = null;
    /** @type {Array<{x:number,y:number,z:number,yaw:number,name:string}>} */
    this._labelQuads = [];
    /** @type {Array<{x:number,z:number,name:string}>|null} */
    this._places = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= FURNITURE_REBUILD_M;
  }

  /**
   * Reconstruit tout le mobilier depuis les tuiles déjà décodées.
   *
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Array} roadSegments Tronçons produits par `collectRoadSegments`.
   * @param {Object|null} roadIndex Index spatial de ces mêmes tronçons
   *        (`RoadIndex`). Il tient l'**emprise routière** — la frontière que
   *        rien du décor ne doit franchir (`roadCorridor`) — et donne
   *        l'altitude de plate-forme sous un point quelconque.
   * @param {Array} junctions Carrefours relevés sur le graphe routier
   *        (`roadNetwork.junctions`). Seul endroit où un feu tricolore a un
   *        sens : le mobilier ne peut pas les redécouvrir seul, un tronçon
   *        découpé ne porte plus la trace du croisement qu'il traversait.
   * @param {Object|null} fabric Instance `FabricIndex` (`settlement.js`) —
   *        combien de bâtiments autour d'un point. Sert à distinguer un
   *        hameau d'un bourg pour le mobilier qui n'a de sens que dans le
   *        premier (moulin à vent isolé) : sans elle, ce mobilier ne se pose
   *        pas, ce qui est le bon repli.
   * @param {Object|null} railIndex Emprise ferroviaire, au même format que
   *        `roadIndex` (`RoadIndex`, publiée par `RailwayLayer`). Rien ne se
   *        pose sur la voie, exactement comme rien ne se pose sur la
   *        chaussée — voir `_onRoad` et `_clipOffRoad`, qui interrogent les
   *        deux indistinctement.
   * @param {Array|null} places Lieux nommés (`settlement.collectPlaceNames`)
   *        — seule source qui associe un nom à une agglomération, pour le
   *        panneau d'entrée (`nearestNamedPlace`, dans `_applyRoadsidePlan`).
   * @returns {boolean} vrai si quelque chose a été posé.
   */
  rebuild(
    source,
    tiles,
    here,
    roadSegments = [],
    roadIndex = null,
    junctions = [],
    builtUpAreas = null,
    fabric = null,
    railIndex = null,
    places = null
  ) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    // Gardés le temps de la reconstruction, remis à `null` en sortie pour
    // qu'aucun appel tardif ne s'appuie sur une donnée périmée.
    this._roadIndex = roadIndex;
    this._fabric = fabric;
    this._railIndex = railIndex;
    this._infraIndex = new CombinedIndex([roadIndex, railIndex]);
    // Même repli que `builtUp`, juste en dessous : `worldComposer` les lit
    // déjà tous les deux au même moment pour la voirie, mais la couche reste
    // capable de les relire seule.
    this._places = places || collectPlaceNames(source, tiles, this.bubble.frame);
    this._labelQuads = [];

    const sampleElevation = (x, z) =>
      this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;

    // Accumulateurs remis à zéro : le mobilier est intégralement refait, il ne
    // se met pas à jour par différence. Sur quelques milliers d'objets, la
    // reconstruction coûte moins cher que le suivi de ce qui a changé.
    const buffers = {};
    for (const kind of LINEAR_KINDS) buffers[kind] = createProfileBuffer();
    const placements = new Map();
    for (const item of POINT_ITEMS) placements.set(item, []);

    const context = { source, tiles, here, sampleElevation, buffers, placements };
    this.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0, hedgeClumps: 0 };
    this._lampHeads = [];
    this._signals = [];
    this.chimneys = [];

    try {
      // Les emprises habitées viennent de `worldComposer` quand il les a déjà
      // lues pour la voirie : c'est la même question posée une seule fois. En
      // leur absence, la couche les relit — elle ne dépend de personne.
      const builtUp = builtUpAreas || collectBuiltUpAreas(source, tiles, this.bubble.frame);
      this._buildRoadside(context, roadSegments, builtUp);
      this._buildCrossings(context, junctions, roadIndex, builtUp);
      this._buildParcels(context, builtUp);
      this._buildVillageLandmarks(context, builtUp);
      this._buildPointsOfInterest(context, roadSegments);
      this._buildRocks(context, builtUp);
      this._buildLandmarks(context, builtUp);
      this._buildPeakLandmarks(context, builtUp);
      this._buildCoastalLandmarks(context, builtUp);
      this._buildRidgeTrees(context, builtUp);
    } catch (e) {
      // La pile complète, pas le seul message : cette exception avale tout ce
      // qui restait à construire (voir le commentaire au-dessus), et sans
      // elle il n'y a aucun moyen de savoir laquelle des étapes a jeté.
      console.warn('[furniture] mobilier partiel', e?.stack || e?.message || e);
    }

    for (const kind of LINEAR_KINDS) this._applyLinear(kind, buffers[kind]);
    for (const [item, list] of placements) this._applyInstances(item, list);
    this._applyGlow();
    this._applySignals();
    this._applyLabels();

    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    this._roadIndex = null;
    this._fabric = null;
    this._railIndex = null;
    this._infraIndex = null;
    this._places = null;
    return this.counts.points + this.counts.boundaries > 0;
  }

  // --- Emprise routière ----------------------------------------------------

  /**
   * Vrai si un point tombe sur la voirie — chaussée et accotement excavé —
   * ou sur l'emprise ferroviaire. Les deux sont interrogées comme une seule
   * emprise (`this._infraIndex`, un `CombinedIndex` — voir `roadGraph.js`),
   * exactement le même index que celui que reçoivent désormais les jardins,
   * la végétation, l'herbe et les cultures : rien ne pousse sur l'une ou
   * l'autre, ce n'est pas une question posée deux fois.
   *
   * Le mobilier **de bord de route** ne passe pas par là, et c'est voulu :
   * glissière, lampadaire, borne et feu sont posés au ras de la rive, donc
   * dans l'emprise, et c'est exactement là qu'ils doivent être. Seul le décor
   * qui n'a rien à faire sur la voirie — ou sur la voie — s'y heurte.
   *
   * `own` ne vaut que pour la route : c'est toujours une chaussée que l'objet
   * borde délibérément (voir `_clipOffRoad`), jamais un tronçon de voie
   * ferrée — l'exclusion ne s'applique donc de toute façon qu'à la route.
   */
  _onRoad(x, z, own = null) {
    const accept = own ? (other) => other !== own : null;
    return inCorridor(this._infraIndex, x, z, undefined, accept);
  }

  /**
   * Découpe une polyligne aux traversées de chaussée **et** de voie ferrée.
   *
   * `offset` est le décalage latéral auquel l'objet sera réellement posé : une
   * haie de bas-côté longe la route à deux mètres de sa rive, et c'est là qu'il
   * faut sonder l'emprise, pas sur l'axe de la route.
   */
  _clipOffRoad(path, { offset = 0, minLength = BOUNDARY_MIN_LENGTH_M, own = null } = {}) {
    // `own` est la chaussée que l'objet borde délibérément : une haie de
    // bas-côté longe sa route à quelques mètres de la rive, donc dans son
    // emprise, et c'est sa place. Elle doit malgré tout s'arrêter à chaque rue
    // transversale — et, de la même façon, à chaque voie ferrée qu'elle
    // croise : `own` désigne toujours une chaussée, jamais un tronçon de
    // rail, donc l'exclusion ne s'applique de toute façon qu'à la route.
    const accept = own ? (other) => other !== own : null;
    return clipOutsideCorridor(path, this._infraIndex, undefined, { offset, minLength, accept });
  }

  /** Écarte d'un semis les points tombés sur la route ou sur la voie ferrée. */
  _filterOffInfra(points) {
    return filterOutsideCorridor(points, this._infraIndex);
  }

  // --- Bord de route -------------------------------------------------------
  //
  // Les emprises habitées (`settlement.js`) servent d'interrupteur : à
  // l'intérieur, une rue est éclairée et n'a ni poteau téléphonique ni haie ; à
  // l'extérieur, c'est l'inverse. La même lecture sert à `streetLayer`, qui la
  // complète du bâti réellement présent — un périmètre habité n'est pas encore
  // une rue, et c'est ce qui décide de son trottoir.

  /**
   * Le mobilier qui accompagne la chaussée.
   *
   * Trois passes sur chaque portion : le relief d'abord, qui décide des deux
   * murs et de la glissière ; le contexte ensuite, qui décide de l'éclairage,
   * des poteaux, des bornes, des panneaux, de l'alignement et de la haie ; le
   * talus enfin, qui comble ce que le mur n'a pas pris.
   *
   * La portée se mesure ligne par ligne et non au milieu du tronçon. Depuis que
   * les chaussées sont fusionnées, une chaîne traverse la bulle de part en part :
   * juger au milieu poserait du mobilier à neuf cents mètres, derrière le
   * brouillard — ou, pire, en écarterait une chaîne qui passe juste à côté 
   * de l'observateur mais dont le milieu tombe au loin.
   */
  _buildRoadside(context, roadSegments, builtUp) {
    const { placements, here } = context;

    for (const segment of roadSegments) {
      const { path, platform, edges, probeSpan } = segment;
      const rows = path.length;
      if (rows < 4) continue;

      const rowsInfo = [];
      for (let r = 0; r < rows; r++) {
        const { slope, uphill } = crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan);
        // Terrain de part et d'autre, à quatre mètres au-delà de la rive : c'est
        // lui qui dit jusqu'où monte le mur amont et jusqu'où descend l'aval.
        const uphillGround = uphill > 0 ? edges[r * 2] : edges[r * 2 + 1];
        const downhillGround = uphill > 0 ? edges[r * 2 + 1] : edges[r * 2];
        const turn = pathTurn(path, r);
        rowsInfo.push({
          r,
          x: path[r].x,
          z: path[r].z,
          distance: path[r].distance,
          slope,
          uphill,
          // Courbure locale : c'est elle, autant que la pente, qui décide d'un
          // parapet. Une glissière protège d'une sortie de route, et on sort de
          // la route dans les virages. Le signe donne le côté extérieur, où se
          // posent les balises.
          curvature: Math.abs(turn),
          turn: Math.sign(turn),
          // Surplomb de la rive aval : c'est lui qui appelle le mur ou le talus.
          drop: platform[r] - downhillGround,
          // Hauteur du terrain au-dessus de la plate-forme, côté amont : la
          // tranchée que le déblai a creusée, et que le mur doit habiller.
          rise: uphillGround - platform[r],
        });
      }

      const inReach = (row) => Math.hypot(row.x - here.x, row.z - here.z) <= FURNITURE_RADIUS_M;
      for (const near of contiguousRuns(rowsInfo, inReach, 4)) {
        const walled = this._buildRoadsideRelief(context, segment, near);
        this._buildRoadsideContext(context, segment, near, builtUp);
        this._buildEmbankment(context, segment, near, walled);
      }
    }

    this.counts.points = this._countPlacements(placements);
  }

  /**
   * Ce que le relief impose : les deux ouvrages qui tiennent la chaussée sur un
   * versant, plus la glissière qui borde le vide.
   *
   * Rien de tout cela n'est décidé par le type de route — c'est la pente en
   * travers, lue dans le MNT, qui le déclenche.
   *
   * ## La géométrie, et pourquoi elle est symétrique
   *
   * La plate-forme est dressée **à mi-hauteur** de la section (`levelRow`),
   * c'est-à-dire là où un terrassier la met : le déblai d'un côté paie le
   * remblai de l'autre. La chaussée est donc à la fois encaissée et portée, et
   * chaque rive appelle son mur — l'un qui monte, l'autre qui descend :
   *
   * - **en amont**, le terrain domine la rive. Le terrain lui-même est entaillé
   *   le long de la chaussée (`terrainBubble.cutElevation`), et le mur habille
   *   la tranchée : il part de la plate-forme et monte jusqu'au terrain naturel.
   *   Ce n'est pas un muret posé sur l'accotement, c'est le parement du déblai —
   *   d'où sa hauteur variable, qui suit le versant mètre par mètre.
   * - **en aval**, la rive surplombe le vide. Le mur y descend de la plate-forme
   *   jusqu'au sol, et la glissière se pose dessus.
   *
   * @returns {Set<number>} lignes déjà tenues par un mur de remblai — le talus
   *          de rase campagne ne doit pas s'y ajouter.
   */
  _buildRoadsideRelief(context, segment, rowsInfo) {
    const { buffers, sampleElevation } = context;
    const { platform, halfWidth, profile } = segment;
    const walled = new Set();

    // Murs et glissière ne concernent que les chaussées aménagées : un sentier
    // de montagne n'a ni l'un ni l'autre, il passe.
    if (!FurnitureLayer._profileTakesGuardrail(profile)) return walled;

    this._buildParapets(context, segment, rowsInfo);

    for (const run of contiguousRuns(rowsInfo, (row) => row.slope >= STEEP_CROSS_SLOPE, 5)) {
      const side = run[Math.floor(run.length / 2)].uphill;
      // Distances ramenées à zéro : un tronçon extrait au kilomètre 3 doit
      // s'espacer depuis son propre début, pas depuis celui de la chaussée.
      const origin = run[0].distance;
      const runPath = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
      const deck = new Float32Array(run.map((row) => platform[row.r]));

      // --- Amont : le parement du déblai ------------------------------------
      const cut = this.specs.wallSpecs.cut;
      // Le mur se dresse au bord du **fond plat** de l'entaille, pas au ras de
      // la chaussée : entre les deux, il y a l'accotement excavé.
      const cutOffset = side * (halfWidth + ROAD_CUT_M + cut.thickness / 2);
      const cutTop = new Float32Array(run.length);
      for (let i = 0; i < run.length; i++) {
        // Arase un peu au-dessus du terrain retenu : une arase pile au niveau
        // du versant laisserait la terre déborder par-dessus.
        const rise = Math.min(run[i].rise + cut.crown, cut.maxHeight);
        cutTop[i] = deck[i] + Math.max(0, rise);
      }
      smoothColumns(cutTop, run.length, 1, 2);
      appendVariableWall(buffers.cutWall, {
        path: runPath,
        base: deck,
        top: cutTop,
        offset: cutOffset,
        thickness: cut.thickness,
        coping: cut.coping,
        colorFoot: cut.colorFoot,
        colorTop: cut.colorTop,
      });

      // --- Aval : le parement du remblai, et la glissière dessus ------------
      const fill = this.specs.wallSpecs.fill;
      const offset = -side * (halfWidth + fill.thickness / 2);
      const frames = pathFrames(runPath);
      const fillBase = new Float32Array(run.length);
      // L'arase affleure la **surface** de la chaussée, pas sa plate-forme : le
      // ruban est décollé de `ROAD_LIFT_M`, et une arase posée sur la plate-forme
      // laisserait une saignée de quatorze centimètres le long de la rive.
      const fillTop = new Float32Array(run.length);
      for (let i = 0; i < run.length; i++) {
        fillTop[i] = deck[i] + ROAD_LIFT_M;
        // Terrain sous le pied du mur, et non sous la rive : c'est là qu'il
        // repose, et la différence vaut plusieurs décimètres sur un versant.
        const ground = sampleElevation(
          runPath[i].x + frames[i * 4 + 2] * offset,
          runPath[i].z + frames[i * 4 + 3] * offset
        );
        // Plancher : le mur ne descend jamais plus bas que son plafond, et ne
        // remonte jamais au-dessus de la plate-forme qu'il porte.
        fillBase[i] = Math.max(deck[i] - fill.maxHeight, Math.min(ground, deck[i]));
        walled.add(run[i].r);
      }
      smoothColumns(fillBase, run.length, 1, 2);
      appendVariableWall(buffers.fillWall, {
        path: runPath,
        base: fillBase,
        top: fillTop,
        offset,
        thickness: fill.thickness,
        coping: fill.coping,
        colorFoot: fill.colorFoot,
        colorTop: fill.colorTop,
      });

    }

    return walled;
  }

  /**
   * Les parapets : glissière métallique ou garde-corps de bois, là où la rive
   * aval surplombe vraiment quelque chose.
   *
   * ## Pourquoi ils sont séparés des murs
   *
   * Ils l'étaient : la glissière naissait dans la boucle des versants raides,
   * donc partout où le MNT accusait plus de 14 % de devers — c'est-à-dire, vu le
   * bruit d'un modèle à trente mètres, sur des kilomètres de plaine. Ce n'est
   * pas la même question : un mur tient la **plate-forme**, un parapet protège
   * d'un **vide**. Ils ont donc leurs propres tronçons, et leur propre règle
   * (`guardrailStyleFor`), qui exige un surplomb réel et, en plus, soit un
   * versant franc, soit une courbe.
   *
   * ## Deux matières
   *
   * L'acier sur les grands axes, le bois sur les petites routes et les chemins
   * de montagne — là où une glissière métallique fait autoroute. Le garde-corps
   * de bois est fait de deux lisses et de piquets, la glissière d'une lisse en W
   * et de poteaux galvanisés.
   */
  _buildParapets(context, segment, rowsInfo) {
    const { buffers, placements, sampleElevation } = context;
    const { platform, halfWidth, profile } = segment;

    const styleOf = (row) =>
      guardrailStyleFor({ profile, slope: row.slope, curvature: row.curvature, drop: row.drop });

    // Un tronçon par matière : mélanger acier et bois sur la même longueur
    // produirait un raccord au milieu de la courbe, qu'on ne voit nulle part.
    for (const family of ['steel', 'wood']) {
      for (const run of contiguousRuns(rowsInfo, (row) => styleOf(row) === family, 6)) {
        const side = run[Math.floor(run.length / 2)].uphill;
        const origin = run[0].distance;
        const runPath = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
        const deck = new Float32Array(run.map((row) => platform[row.r]));
        const offset = -side * (halfWidth + 0.35);

        const rails = family === 'steel' ? ['guardrailBeam'] : ['woodRail', 'woodRailTop'];
        for (const rail of rails) {
          appendProfile(buffers[rail], {
            path: runPath,
            profile: this.specs.profiles[rail],
            sampleElevation,
            offset,
            baseHeights: deck,
            closed: true,
          });
        }

        const post = family === 'steel' ? 'guardrailPost' : 'fencePostWood';
        const spacing = family === 'steel' ? 4 : 2.4;
        for (const p of spacedAlongPath(runPath, spacing, { margin: 1 })) {
          // Le poteau se pose sur la plate-forme, pas sur le terrain : la rive
          // aval surplombe le vide, et un poteau posé au sol pendrait sous la
          // lisse.
          const row = Math.min(deck.length - 1, Math.max(0, Math.round(p.distance / ROAD_SAMPLE_M)));
          this._place(placements, post, {
            x: p.x + p.tz * offset,
            z: p.z - p.tx * offset,
            y: deck[row],
            yaw: roadsideYaw(p.tx, p.tz, offset),
            exactY: true,
          });
        }
      }
    }
  }

  /**
   * Talus de remblai, là où la plate-forme surplombe le terrain sans qu'un mur
   * ne s'en charge — un simple remblai de rase campagne, en terre et non en
   * pierre. Les lignes déjà tenues par un mur en sont exclues : les deux
   * ouvrages se superposeraient au même endroit.
   */
  _buildEmbankment(context, segment, rowsInfo, walled) {
    const { buffers, sampleElevation } = context;
    const { platform, halfWidth } = segment;

    const keep = (row) => row.drop >= EMBANKMENT_MIN_DROP_M && !walled.has(row.r);
    for (const run of contiguousRuns(rowsInfo, keep, 4)) {
      const side = run[Math.floor(run.length / 2)].uphill;
      const drop = run.reduce((max, row) => Math.max(max, row.drop), 0);
      appendProfile(buffers.embankment, {
        path: run.map((row) => ({ x: row.x, z: row.z, distance: row.distance })),
        profile: this.specs.embankmentProfile(Math.min(drop, 6)),
        sampleElevation,
        offset: -side * halfWidth,
        baseHeights: new Float32Array(run.map((row) => platform[row.r])),
      });
    }
  }

  /**
   * Ce que porte ce type de route **à cet endroit**.
   *
   * Le contexte est lu ligne par ligne, pas au milieu du tronçon. C'est une
   * conséquence directe de la fusion des chaussées : une chaîne fait maintenant
   * plusieurs centaines de mètres et traverse le village avant d'en ressortir.
   * Juger au milieu donnerait des lampadaires en pleine campagne ou une haie au
   * milieu du bourg, sur toute la longueur de la chaîne.
   *
   * Chaque portion garde la numérotation de la chaîne — les espacements se
   * comptent depuis le nœud d'ancrage, pas depuis le début de la portion —, donc
   * traverser une limite d'agglomération ne décale rien.
   */
  _buildRoadsideContext(context, segment, rowsInfo, builtUp) {
    const { buffers, placements, sampleElevation, here } = context;
    const { platform, halfWidth, profile, startDistance, anchor } = segment;
    // Le côté de la haie et de la ligne téléphonique se tire au nœud
    // d'ancrage : il ne dépend donc ni du découpage ni de la position de
    // l'observateur, et ne change plus de bord d'une reconstruction à l'autre.
    const side = anchor || segment.path[0];

    // Matérialisé plutôt que parcouru au fil de l'eau : `isSettlementEdge`
    // (plus bas) a besoin de connaître la portion **précédente** — voir sa
    // raison d'être au-dessus de `SIGN_PLACE_NAME_MIN_GAP_M`.
    const runs = runsByValue(rowsInfo, (row) => pointInAreas(builtUp, row.x, row.z), 8);

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const rows = run.rows;
      if (rows.length < 3) continue;
      const origin = rows[0].distance;
      const path = rows.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
      const deck = new Float32Array(rows.map((row) => platform[row.r]));
      const mid = rows[Math.floor(rows.length / 2)];

      const inTown = run.value;
      const plan = roadsideFurnitureFor(profile, { builtUp: inTown });
      const spacing = { startDistance: startDistance + origin, margin: 4 };

      const previous = r > 0 ? runs[r - 1] : null;
      const isSettlementEdge = isSettlementEdgeRun(previous);

      this._applyRoadsidePlan({
        plan,
        path,
        rows,
        platform: deck,
        halfWidth,
        mid,
        side,
        spacing,
        profile,
        inTown,
        isSettlementEdge,
        buffers,
        placements,
        sampleElevation,
        segment,
        here,
      });
    }
  }

  /**
   * Pose un plan de mobilier de bord de route sur une portion homogène.
   *
   * `side` est le point d'ancrage de la chaîne : tout ce qui se range d'un seul
   * côté de la route — la ligne téléphonique, la haie — s'y tire au sort. Deux
   * portions d'une même chaîne rendent donc le même côté, ce qui évite la haie
   * qui saute d'un bord à l'autre à chaque limite d'agglomération.
   */
  _applyRoadsidePlan({
    plan,
    path,
    rows,
    platform,
    halfWidth,
    mid,
    side,
    spacing,
    profile,
    inTown,
    isSettlementEdge = true,
    buffers,
    placements,
    sampleElevation,
    segment,
    here = null,
  }) {
    if (plan.lamp) {
      for (const p of spacedAlongPath(path, plan.lamp, spacing)) {
        // Alternance d'un côté et de l'autre : deux rangées face à face
        // n'existent que sur les boulevards, et se voient comme une erreur.
        const lamp = p.index % 2 === 0 ? 1 : -1;
        const offset = lamp * (halfWidth + 0.9);
        const placed = this._placeBeside(placements, 'streetLamp', p, offset, platform, {
          facing: 'road',
          onPlatform: true,
        });
        // Halo nocturne : accroché à la tête, c'est-à-dire au bout de la crosse,
        // qui avance au-dessus de la chaussée — pas au-dessus du mât.
        if (placed) {
          const reach = -Math.sign(offset) * LAMP_HEAD_REACH_M;
          this._lampHeads.push({
            x: placed.x + p.tz * reach,
            y: placed.y + LAMP_HEAD_HEIGHT_M,
            z: placed.z - p.tx * reach,
          });
        }
      }
    }

    if (plan.utilityPole) {
      const poleSide = randomAt(side.x, side.z, 11) < 0.5 ? 1 : -1;
      const poles = spacedAlongPath(path, plan.utilityPole, spacing);
      for (const p of poles) {
        // Dans l'axe de la route, et non tourné vers elle : la traverse d'un
        // poteau est perpendiculaire aux fils qu'elle porte, donc à la ligne.
        // Tourné vers la chaussée, il présentait sa traverse en travers de la
        // route — un détail qu'on ne peut plus ne pas voir une fois repéré.
        this._placeBeside(placements, 'utilityPole', p, poleSide * (halfWidth + 2.2), platform, {
          facing: 'along',
        });
      }
      this._appendOverheadLine(buffers.wire, poles, poleSide * (halfWidth + 2.2), sampleElevation, 8.35);
    }

    // Bornes hectométriques, sauf tous les dix rangs : là, c'est la borne
    // kilométrique qui prend la place, plus haute. Côté droit, comme sur le
    // terrain, donc décalage négatif (la gauche de la marche est positive).
    const kerb = -(halfWidth + 0.7);
    if (plan.milestone) {
      const every = plan.kilometreStone ? Math.round(plan.kilometreStone / plan.milestone) : 0;
      for (const p of spacedAlongPath(path, plan.milestone, spacing)) {
        if (every && p.index % every === 0) continue;
        this._placeBeside(placements, 'milestone', p, kerb, platform, { facing: 'road', onPlatform: true });
      }
    }
    if (plan.kilometreStone) {
      for (const p of spacedAlongPath(path, plan.kilometreStone, spacing)) {
        this._placeBeside(placements, 'milestone', p, kerb, platform, {
          facing: 'road',
          scale: 1.7,
          onPlatform: true,
        });
      }
    }

    // Panneaux : ils s'adressent au conducteur qui arrive, donc ils regardent le
    // trafic et non la chaussée. Posés à droite, ils font face au sens de la
    // marche — c'est `roadsideYaw` qui tient la convention.
    //
    // Lequel poser dépend de ce qui se passe **à cet endroit** (`signKindFor`) :
    // une balise dans une courbe, un panneau de priorité en ligne droite, un
    // passage piétons en ville. Un seul type répété tous les six cents mètres se
    // lisait comme un motif dès le troisième.
    if (plan.sign) {
      for (const p of spacedAlongPath(path, plan.sign, spacing)) {
        const row = FurnitureLayer._nearestRow(rows, p.distance);
        const item = signKindFor({
          curvature: row?.curvature ?? 0,
          builtUp: inTown,
          profile,
          variant: randomAt(p.x, p.z, 71),
        });
        this._placeBeside(placements, item, p, -(halfWidth + 1.1), platform, {
          facing: 'traffic',
          onPlatform: true,
        });
      }
    }

    // Balises de virage : elles ne se posent pas isolément mais **en série**
    // dans la courbe, ce qui est justement ce qui les fait lire comme telles.
    // Seulement sur les chaussées aménagées : un sentier de montagne n'en porte
    // pas, et il est fait à peu près uniquement de virages serrés.
    const curveMarkers = FurnitureLayer._profileTakesGuardrail(profile)
      ? spacedAlongPath(path, 14, spacing)
      : [];
    for (const p of curveMarkers) {
      const row = FurnitureLayer._nearestRow(rows, p.distance);
      if (!row || row.curvature < 0.022) continue;
      // Extérieur de la courbe : la perpendiculaire gauche étant `(tz, -tx)`, un
      // virage à gauche a un `turn` négatif et son extérieur est donc du côté
      // des décalages négatifs. Le signe du virage *est* le côté à prendre.
      const outer = row.turn || 1;
      this._placeBeside(placements, 'signChevron', p, outer * (halfWidth + 1), platform, {
        facing: 'traffic',
        onPlatform: true,
      });
    }

    if (plan.directionSign) {
      for (const p of spacedAlongPath(path, plan.directionSign, spacing)) {
        this._placeBeside(placements, 'signDirection', p, -(halfWidth + 1.8), platform, {
          facing: 'traffic',
          onPlatform: true,
        });
      }
    }

    // Entrée d'agglomération : un seul panneau, au tout début de la portion
    // bâtie — et seulement là où un vrai lieu nommé est à portée
    // (`nearestNamedPlace`), où `FabricIndex` confirme que des bâtiments
    // réels s'y trouvent déjà, et où `isSettlementEdge` dit que ce début est
    // une vraie entrée et non un artefact du découpage des `landuse` (voir
    // `SIGN_PLACE_NAME_MIN_GAP_M`). Un `landuse=residential` n'est qu'un
    // périmètre administratif (voir l'en-tête de `settlement.js`) : sans les
    // trois conditions, ce panneau se plantait à l'entrée de n'importe quel
    // pâté de maisons, jamais forcément une ville — et sans nom à y peindre.
    if (inTown && isSettlementEdge && path.length > 4 && plan.lamp) {
      const start = path[1];
      const place = nearestNamedPlace(this._places, start.x, start.z, SIGN_PLACE_NAME_MAX_M);
      const hasFabric =
        place &&
        this._fabric &&
        this._fabric.countWithin(start.x, start.z, SIGN_PLACE_NAME_FABRIC_RADIUS_M, 1) > 0;
      if (place && hasFabric) {
        const tx = path[2].x - path[0].x;
        const tz = path[2].z - path[0].z;
        const length = Math.hypot(tx, tz) || 1;
        const placed = this._placeBeside(
          placements,
          'signPlaceName',
          { x: start.x, z: start.z, tx: tx / length, tz: tz / length, distance: start.distance },
          -(halfWidth + 1.4),
          platform,
          { facing: 'traffic', onPlatform: true }
        );
        if (placed) this._labelQuads.push({ x: placed.x, y: placed.y, z: placed.z, yaw: placed.yaw, name: place.name });
      }
    }

    if (plan.alignmentTree) {
      // Un alignement n'a de sens qu'en terrain découvert : dans un bois, il
      // se noierait dans les arbres déjà plantés depuis la photo.
      if (this._openGround(mid.x, mid.z)) {
        // L'essence est tirée **une fois pour la chaîne** : un alignement mêlant
        // platanes et sapins n'existe pas, c'est le propre d'un alignement d'être
        // planté le même jour.
        const species = alignmentTreeSpeciesFor(side.x, side.z);
        for (const p of spacedAlongPath(path, plan.alignmentTree, spacing)) {
          const row = p.index % 2 === 0 ? 1 : -1;
          this._placeBeside(placements, species, p, row * (halfWidth + 3.2), platform, {
            scale: 1.05 + randomAt(p.x, p.z, 3) * 0.5,
            // Un platane pousse au bord de la route qu'il borde — donc celle-ci
            // ne le gêne pas — mais pas au milieu de celle qui la croise.
            offRoad: true,
            own: segment,
          });
        }
      }
    }

    // Bas-côté : haie basse, haie de bocage. Le motif n'est donné qu'à une
    // portion sur trois environ : appliqué partout, il transforme la
    // campagne en circuit.
    const verge = roadsideVergeFor(profile, { builtUp: inTown, variant: randomAt(side.x, side.z, 83) });
    const openGround = this._openGround(mid.x, mid.z);
    if (verge.verge && openGround) {
      this._appendHedgerow(buffers.lowHedge, 'lowHedge', path, sampleElevation, {
        offset: verge.vergeSide * (halfWidth + 2.6),
        here,
        startDistance: spacing.startDistance,
        own: segment,
      });
    }

    // La haie de bocage le long de la route reste, mais elle n'est plus
    // systématique : une petite route sur deux seulement en porte une, et
    // jamais du côté où court déjà la haie basse du bas-côté.
    if (plan.hedge && openGround && randomAt(side.x, side.z, 29) < 0.5) {
      const hedgeSide = verge.verge
        ? -verge.vergeSide
        : randomAt(side.x, side.z, 23) < 0.5 ? 1 : -1;
      this._appendHedgerow(buffers.hedge, 'hedge', path, sampleElevation, {
        offset: hedgeSide * (halfWidth + 1.8),
        here,
        startDistance: spacing.startDistance,
        own: segment,
      });
    }
  }

  /**
   * Forme urbaine correspondant à une classe `landuse`, ou `null`.
   *
   * `cemetery` et `stadium` sont des classes `landuse` vérifiées dans ce
   * projet (`groundClassMap.groundClassFor` les peint déjà en herbe).
   * `industrial` l'est également. `fairground`, en revanche, est une
   * supposition — la même réserve que `_poiItem` s'applique.
   */
  static _urbanLanduseKind(klass) {
    if (klass === 'cemetery') return 'cemeteryCross';
    if (klass === 'industrial') return 'factoryChimney';
    if (klass === 'stadium') return 'stadium';
    if (klass === 'fairground') return 'ferrisWheel';
    return null;
  }

  /** Ligne d'échantillonnage la plus proche d'une distance donnée. */
  static _nearestRow(rows, distance) {
    if (!rows || rows.length === 0) return null;
    const origin = rows[0].distance;
    const index = Math.round(distance / ROAD_SAMPLE_M);
    return rows[Math.min(rows.length - 1, Math.max(0, index))] ?? rows[0] ?? { distance: origin };
  }

  /** Les profils assez larges pour porter une glissière réglementaire. */
  static _profileTakesGuardrail(profile) {
    return profile === 'express' || profile === 'major' || profile === 'minor';
  }

  /**
   * Câble de ligne aérienne entre poteaux consécutifs.
   *
   * La flèche est une parabole — l'approximation classique de la caténaire pour
   * de petites portées, et la seule différence visible avec un segment droit,
   * qui trahirait aussitôt le décor.
   *
   * La courbe est bâtie **déjà décalée** sur la ligne des poteaux, plutôt que
   * décalée au balayage : c'est ce qui garantit que l'altitude du câble est
   * prise sous le poteau et non sous l'axe de la route, laquelle peut être un
   * mètre plus haut sur un versant.
   */
  _appendOverheadLine(buffer, poles, offset, sampleElevation, height) {
    for (let i = 1; i < poles.length; i++) {
      const a = poles[i - 1];
      const b = poles[i];
      // Extrémités reportées sur la ligne des poteaux.
      const ax = a.x + a.tz * offset;
      const az = a.z - a.tx * offset;
      const bx = b.x + b.tz * offset;
      const bz = b.z - b.tx * offset;

      const span = Math.hypot(bx - ax, bz - az);
      // Une portée absente (poteaux confondus) ou démesurée signale un trou
      // dans l'espacement, pas une ligne : mieux vaut ne rien tendre.
      if (span < 4 || span > 90) continue;

      const sag = Math.min(1.6, span * 0.028);
      const steps = 6;
      const curve = [];
      const heights = new Float32Array(steps + 1);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        curve.push({ x, z, distance: span * t });
        // Parabole normalisée : nulle aux appuis, maximale à mi-portée.
        heights[s] = sampleElevation(x, z) + height - sag * 4 * t * (1 - t);
      }

      appendProfile(buffer, {
        path: curve,
        profile: this.specs.profiles.wire,
        sampleElevation,
        baseHeights: heights,
        closed: true,
        // Aucun lissage : la flèche *est* la forme voulue, la moyenner
        // l'aplatirait et rendrait le câble rectiligne.
        smoothRadius: 0,
      });
    }
  }

  /**
   * Feux tricolores, aux carrefours d'agglomération.
   *
   * Le schéma OpenMapTiles ne porte pas `highway=traffic_signals` — comme il ne
   * porte ni lampadaire ni panneau. Mais il porte les chaussées, et un carrefour
   * est une propriété du **graphe** routier : un nœud où plus de deux arêtes se
   * rejoignent. `roadGraph` le relève au moment où il recoud les chaussées, et
   * le publie ; c'est cette liste-là qu'on lit ici.
   *
   * Elle a remplacé une détection géométrique — chercher où deux rubans se
   * recouvrent — qui trouvait le même croisement sur une dizaine de lignes de
   * chaque branche, et obligeait à écarter tout ce qui se trouvait à moins de
   * cent mètres pour n'en garder qu'un. Un nœud est un nœud : il n'y en a
   * qu'un, et il tombe au centre du carrefour et pas sur la première ligne où
   * les rubans commencent à se toucher.
   *
   * Deux conditions restent : le carrefour doit être en zone bâtie (une croisée
   * de départementales en pleine campagne porte un cédez-le-passage, pas un
   * feu), et sa chaussée dominante doit en mériter un (`plan`).
   */
  _buildCrossings(context, junctions, roadIndex, builtUp) {
    if (!roadIndex || !Array.isArray(junctions)) return;
    const { placements, here } = context;
    let placed = 0;

    for (const junction of junctions) {
      if (placed >= FURNITURE_LIMITS.trafficLights) break;
      if (Math.hypot(junction.x - here.x, junction.z - here.z) > FURNITURE_RADIUS_M) continue;
      if (!pointInAreas(builtUp, junction.x, junction.z)) continue;
      if (!roadsideFurnitureFor(junction.profile, { builtUp: true }).trafficLight) continue;

      // La branche la plus large : c'est celle dont le feu règle l'accès, et
      // c'est sur elle que l'automobiliste le cherche.
      let branch = null;
      for (const candidate of junction.branches) {
        if (!branch || candidate.halfWidth > branch.halfWidth) branch = candidate;
      }
      if (!branch) continue;

      // Une dizaine de mètres en amont du nœud, sur la branche, et à droite —
      // c'est la position française. `branch` sort du carrefour, donc reculer
      // le long de la branche veut dire avancer dans son sens.
      const back = TRAFFIC_LIGHT_SETBACK_M;
      const px = junction.x + branch.x * back;
      const pz = junction.z + branch.z * back;
      // Sens de la marche : celui du trafic qui arrive au feu, donc l'inverse
      // de la direction sortante de la branche.
      const tx = -branch.x;
      const tz = -branch.z;
      const offset = -(junction.halfWidth + 1.2);
      const yaw = roadsideYaw(tx, tz, offset, 'traffic');

      // Altitude prise sur la plate-forme de la branche, pas sur le terrain :
      // le feu est au bord de la chaussée, qui est dressée de niveau.
      const deck = roadIndex.deckAt(roadIndex.query(px, pz, 1));

      const post = this._place(placements, 'trafficLight', {
        x: px + tz * offset,
        z: pz - tx * offset,
        y: deck,
        yaw,
        exactY: deck != null,
      });
      // Le feu publie son point d'allumage : `advanceSignals` y pose la
      // lentille vive et son halo. La phase est tirée du **lieu**, donc deux
      // carrefours voisins ne passent jamais au vert ensemble, et un même
      // carrefour garde son rythme d'une reconstruction à l'autre.
      if (post) {
        this._signals.push({
          x: post.x,
          y: post.y,
          z: post.z,
          yaw,
          phase: randomAt(post.x, post.z, 97) * TRAFFIC_CYCLE_S,
        });
      }
      placed++;
    }
  }

  // --- Parcelles -----------------------------------------------------------

  /**
   * Contours et intérieurs des parcelles : haies, murets, clôtures, bottes de
   * foin, bosquets et bâtiments de ferme.
   */
  _buildParcels(context, builtUp) {
    const { source, tiles, here, sampleElevation, buffers, placements } = context;
    const { origin, scale, zoom } = this.bubble.frame;
    let boundaries = 0;
    let scattered = 0;
    let farmBuildings = 0;
    let urbanPlaced = 0;

    const handle = (geometry, properties, bounds) => {
      for (const ring of ringsOf(geometry)) {
        const local = ring.map(([lng, lat]) => ({
          x: (lngToTileX(lng, zoom) - origin.x) * scale,
          z: (latToTileY(lat, zoom) - origin.y) * scale,
        }));
        if (local.length < 4) continue;

        // Le mobilier de parcelle se pose **autour d'un centre** — bâtiments de
        // ferme, rangs de vigne, bottes de foin —, donc la distance au
        // centroïde est la bonne mesure. La culture, elle, ne passe plus par
        // ici : elle est peinte dans la carte des cultures, qui couvre 4 km et
        // ne connaît pas cette limite.
        const centre = FurnitureLayer._centroid(local);
        if (Math.hypot(centre.x - here.x, centre.z - here.z) > FURNITURE_RADIUS_M) continue;

        // Repères urbains : un par emprise reconnue — cimetière, zone
        // industrielle, stade, champ de foire. Avant le filtre « hors zone
        // habitée » ci-dessous, et pour cause : une zone industrielle **est**
        // elle-même une classe bâtie (`BUILT_UP_CLASSES`), donc son propre
        // centroïde tombe dans son propre périmètre — filtrée après coup, sa
        // cheminée ne se poserait jamais. Un seul repère par polygone, jamais
        // un semis : ce sont des équipements, pas de la végétation. Une petite
        // emprise mal classée (une chapelle de lotissement, un atelier isolé)
        // n'a pas la taille de ce qu'elle prétend être et ne reçoit rien.
        const urbanKind = FurnitureLayer._urbanLanduseKind(properties.class);
        if (urbanKind && urbanPlaced < FURNITURE_LIMITS.urbanLandmarks && !this._onRoad(centre.x, centre.z)) {
          const hectares = ringAreaMeters(local) / 10000;
          const minHectares = urbanKind === 'cemeteryCross' ? 0.15 : urbanKind === 'stadium' ? 0.3 : 0.4;
          if (hectares >= minHectares) {
            const placed = this._place(placements, urbanKind, {
              x: centre.x,
              z: centre.z,
              yaw: randomAt(centre.x, centre.z, 191) * Math.PI * 2,
            });
            // Fumée : publiée comme celle de la ferme (`_placeFarmstead`),
            // près du sommet du fût (`factoryChimney`, 28 m).
            if (placed && urbanKind === 'factoryChimney') {
              this.chimneys.push({ x: placed.x, y: placed.y + 26, z: placed.z });
            }
            // La croix posée plus haut ne marquait le site que d'un seul
            // repère ; ce qui suit l'habille — mur, portail, tombes, robinet.
            if (placed && urbanKind === 'cemeteryCross') {
              this._buildCemetery(context, local, centre);
            }
            urbanPlaced++;
          }
        }

        if (pointInAreas(builtUp, centre.x, centre.z)) continue;

        const steepness = this._steepnessAt(centre.x, centre.z);
        const variant = randomAt(centre.x, centre.z, 7);
        // La culture n'est **pas tirée ici** : elle est lue dans la carte des
        // cultures, qui l'a tirée une fois pour toutes et que lisent aussi le
        // shader de terrain et `cropLayer`. Le mobilier s'en sert pour savoir
        // qu'un champ en culture ne se clôt pas et qu'on n'y sème pas de bottes
        // de foin — et il aurait été absurde qu'il en décide autrement que ce
        // qui pousse effectivement dessus.
        const crop = this.groundClass?.cropAt?.(centre.x, centre.z) ?? null;

        // Cour de ferme : les bâtiments d'exploitation, à la vraie place.
        // Voir `_looksLikeFarmstead` — `landuse=farmyard` n'existe pas dans
        // cette donnée, l'indice est indirect.
        if (farmBuildings < FURNITURE_LIMITS.farmBuildings && this._looksLikeFarmstead(properties, local, centre)) {
          farmBuildings += this._placeFarmstead(placements, local, centre);
        }

        if (crop && ROW_CROPS.has(crop)) this._buildRows(context, local, centre, crop, here);

        // Le budget de contours ne coupe que les contours. Il arrêtait jusqu'ici
        // le parcours **entier** des parcelles : dans un bocage, cent
        // quatre-vingts tronçons de haie sont dépensés en une trentaine de
        // parcelles, et les parcelles arrivent dans l'ordre des tuiles, pas
        // dans celui des distances. Une fois le budget épuisé, plus une cour de
        // ferme, plus un rang de vigne, plus une botte de foin — y compris sous
        // les roues de l'observateur.
        const kind =
          boundaries < FURNITURE_LIMITS.boundaries
            ? boundaryFurnitureFor(properties, { steepness, variant, crop })
            : null;
        if (kind) {
          boundaries += this._appendParcelBoundary(buffers, placements, kind, ring, bounds, sampleElevation, here);
        }

        if (scattered < FURNITURE_LIMITS.scatter) {
          scattered += this._scatterInside(placements, properties, local, centre, variant, steepness, crop);
        }
      }
    };

    source.forEachFeature('landcover', tiles, handle);
    source.forEachFeature('landuse', tiles, handle);
    this.counts.boundaries = boundaries;
  }

  /**
   * Pose un contour de parcelle, en n'en gardant que les tronçons réels.
   * @returns {number} nombre de tronçons posés.
   */
  _appendParcelBoundary(buffers, placements, kind, ring, bounds, sampleElevation, here = null) {
    let placed = 0;

    for (const run of realBoundaryRuns(ring, bounds)) {
      const { origin, scale, zoom } = this.bubble.frame;
      const local = run.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));

      const sampled = resamplePath(local, BOUNDARY_SAMPLE_M);
      if (sampled.length < 3) continue;
      if (sampled[sampled.length - 1].distance < BOUNDARY_MIN_LENGTH_M) continue;

      // Un contour de parcelle suit très souvent le bord d'une route sur toute
      // sa longueur — c'est la définition même du bocage. Le couper à chaque
      // sondage qui tombe dans l'emprise ne laisserait aucun tronçon dehors :
      // toute la haie disparaîtrait, faute d'un point réellement extérieur d'où
      // repartir. On la repousse donc au ras de l'emprise plutôt qu'on ne
      // l'interrompt — c'est elle qui trace le bocage, pas la route. Voie
      // ferrée comprise : un contour de parcelle longe un talus de chemin de
      // fer aussi souvent qu'une route.
      const pushed = pushOutsideCorridor(sampled, this._infraIndex);
      if (pushed.length < 3) continue;

      // Le refoulement ne peut pas tout : là où deux chaussées se longent ou
      // se rejoignent en Y, les emprises se recouvrent et **aucune** position
      // libre n'existe. `pushOutsideCorridor` rend alors le point tel quel,
      // c'est-à-dire sur le bitume. Ce qui y reste est donc coupé — sur la
      // chaussée stricte, pas sur l'emprise : le refoulement s'occupe déjà de
      // l'accotement, et couper à l'emprise hacherait le bocage à chaque
      // courbe, faute des quinze centimètres de garde que le refoulement laisse.
      for (const path of clipOutsideCorridor(pushed, this._infraIndex, 0, { minLength: BOUNDARY_MIN_LENGTH_M })) {
        // Un muret de pierre sèche est arasé de niveau et reste un balayage nu ;
        // une haie est un alignement d'arbustes, et se bâtit comme tel.
        if (kind === 'hedge' || kind === 'lowHedge') {
          this._appendHedgerow(buffers[kind], kind, path, sampleElevation, { here });
          placed++;
          continue;
        }

        if (kind === 'dryStoneWall') {
          appendProfile(buffers[kind], {
            path,
            profile: this.specs.profiles[kind],
            sampleElevation,
            lift: -FURNITURE_SINK_M,
            closed: true,
          });
          placed++;
          continue;
        }

        // Clôtures : des piquets instanciés, et — pour le barbelé — trois brins
        // tendus. Un grillage plein serait un mur ; ici on doit voir au travers.
        const wood = kind === 'woodFence';
        for (const post of spacedAlongPath(path, wood ? 2.6 : 3.4, { margin: 0.5 })) {
          this._place(placements, wood ? 'fencePostWood' : 'fencePostConcrete', {
            x: post.x,
            z: post.z,
            yaw: Math.atan2(post.tx, post.tz),
          });
        }
        for (const height of wood ? [0.5, 0.95] : BARBED_WIRE_HEIGHTS) {
          appendProfile(buffers.wire, {
            path,
            profile: this.specs.profiles.wire,
            sampleElevation,
            lift: height,
            closed: true,
          });
        }
        placed++;
      }
    }

    return placed;
  }

  /**
   * Rangs d'une parcelle plantée en lignes : vigne et verger.
   *
   * ## Ce qui fait lire un vignoble
   *
   * Ce ne sont pas les ceps, c'est le **rang** — des lignes parallèles,
   * régulières, orientées toutes pareil, qui filent jusqu'au bout de la
   * parcelle. Le semer en vrac donnerait un buisson par-ci par-là ; le semer en
   * rangs donne un vignoble même avec la moitié moins de géométrie.
   *
   * La direction n'est pas tirée au sort : elle vient du **plus long côté** de
   * la parcelle, qui est ce que suit le planteur. Chaque rang est ensuite
   * découpé aux vraies limites du champ (`contiguousRuns` sur l'appartenance à
   * l'anneau), donc les rangs s'arrêtent où le champ s'arrête et non sur une
   * boîte englobante.
   */
  _buildRows(context, ring, centre, crop, here) {
    if (Math.hypot(centre.x - here.x, centre.z - here.z) > ROW_CROP_RADIUS_M) return;
    if (this.counts.rows >= FURNITURE_LIMITS.vineRows) return;

    const { buffers, placements, sampleElevation } = context;
    const angle = FurnitureLayer._principalAngle(ring);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    // Perpendiculaire : c'est le long d'elle que les rangs s'échelonnent.
    const spacing = crop === 'vineyard' ? 2.4 : 7;
    const step = crop === 'vineyard' ? 3 : 6;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of ring) {
      const u = (p.x - centre.x) * dirX + (p.z - centre.z) * dirZ;
      const v = -(p.x - centre.x) * dirZ + (p.z - centre.z) * dirX;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    if (!Number.isFinite(minU) || maxU - minU < spacing * 2) return;

    for (let v = minV + spacing * 0.5; v <= maxV && this.counts.rows < FURNITURE_LIMITS.vineRows; v += spacing) {
      const samples = [];
      for (let u = minU; u <= maxU; u += step) {
        samples.push({
          x: centre.x + dirX * u - dirZ * v,
          z: centre.z + dirZ * u + dirX * v,
          distance: u - minU,
        });
      }
      for (const run of contiguousRuns(samples, (s) => pointInRing(ring, s.x, s.z), 3)) {
        const origin = run[0].distance;
        const rowPath = run.map((s) => ({ x: s.x, z: s.z, distance: s.distance - origin }));
        // Un rang est déjà découpé aux limites du champ ; il lui reste à
        // s'arrêter au bord de la route qui le traverse. Le pas des rangs (3 à
        // 6 m) est trop lâche pour repérer une voie communale : c'est la
        // découpe d'emprise, qui sonde au mètre, qui s'en charge.
        for (const path of this._clipOffRoad(rowPath, { minLength: 0 })) {
          if (crop === 'vineyard') {
            // Rééchantillonné plus fin que le pas du rang (3 m) avant le
            // balayage : c'est ce même pas fin (`HEDGE_SAMPLE_M`, réemployé
            // ici faute d'un pas propre à la vigne) qui fixe l'espacement des
            // arêtes facettées, comme pour une haie.
            const fine = resamplePath(path, HEDGE_SAMPLE_M);
            const dense = fine.length >= 2 ? fine : path;
            const facets = facetJitter(dense, VINE_ROW_FACET_SALT);
            appendProfile(buffers.vineRow, {
              path: dense,
              profile: this.specs.profiles.vineRow,
              sampleElevation,
              lift: -FURNITURE_SINK_M,
              closed: true,
              scaleUp: facets.up,
              scaleAcross: facets.across,
              lateralJitter: facets.lateral,
              smoothRadius: Math.round(6 / HEDGE_SAMPLE_M),
            });
            for (const stock of spacedAlongPath(path, 1.2, { margin: 0.4 })) {
              this._place(placements, 'vineStock', { x: stock.x, z: stock.z, yaw: angle });
            }
          } else {
            for (const tree of spacedAlongPath(path, 6, { margin: 1 })) {
              this._place(placements, 'treeBroad', {
                x: tree.x,
                z: tree.z,
                yaw: randomAt(tree.x, tree.z, 67) * Math.PI * 2,
                // Un verger est planté d'arbres taillés bas et de taille égale :
                // c'est exactement ce qui le distingue d'un bois.
                scale: 0.55 + randomAt(tree.x, tree.z, 68) * 0.12,
              });
            }
          }
          this.counts.rows++;
        }
      }
    }
  }

  /**
   * Direction du plus long côté d'un anneau, en radians.
   *
   * C'est la direction dans laquelle une parcelle est travaillée : les rangs, les
   * sillons et les andains la suivent. Un angle tiré au sort donnerait des
   * vignes en travers du coteau, ce qui n'existe pas.
   */
  static _principalAngle(ring) {
    let best = 0;
    let angle = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length > best) {
        best = length;
        angle = Math.atan2(b.z - a.z, b.x - a.x);
      }
    }
    return angle;
  }

  /** Sème l'intérieur d'une parcelle. @returns {number} objets posés. */
  _scatterInside(placements, properties, ring, centre, variant, steepness = 0, crop = null) {
    const rule = scatterFurnitureFor(properties, { crop });
    if (!rule) return 0;

    const hectares = ringAreaMeters(ring) / 10000;
    if (hectares < 0.4) return 0;
    // Arrondi stochastique, comme `vegetationLayer.treesForScore` : sans lui,
    // `floor` renvoyait zéro pour **toute** parcelle sous le seuil d'un
    // exemplaire plein — pour un troupeau (1,1/ha), tout pré de moins de
    // 0,91 ha, c'est-à-dire l'essentiel du bocage. Un pré de 0,5 ha a une
    // espérance de 0,55 bête : avec un tirage ancré au lieu en jitter, il en
    // porte une un peu plus d'une fois sur deux, au lieu de jamais.
    const expected = hectares * rule.perHectare;
    const jitter = randomAt(centre.x, centre.z, 45);
    const count = Math.min(24, Math.floor(expected + jitter));
    if (count <= 0) return 0;

    const seed = positionSeed(centre.x, centre.z, 41);
    let placed = 0;

    if (rule.item === 'herd') return this._placeHerd(placements, ring, centre, variant, steepness, count);

    // Rondes ou parallélépipédiques, mais pas les deux dans le même champ : une
    // moissonneuse ne change pas de presse au milieu d'une parcelle. Les bottes
    // s'alignent en outre sur le sens du travail de la parcelle, comme les
    // andains qu'elles suivent.
    const item = variant < 0.6 ? 'hayBaleRound' : 'hayBaleSquare';
    const heading = FurnitureLayer._principalAngle(ring);
    // Une route qui traverse le champ n'y interdit pas la moisson : elle
    // interdit d'en poser une botte sur la chaussée. Le semis n'est pas
    // redistribué pour autant — on retire, on ne recompose pas, sinon la même
    // parcelle changerait de bottes à chaque reconstruction.
    for (const spot of this._filterOffInfra(scatterInRing(ring, count, seed))) {
      this._place(placements, item, {
        x: spot.x,
        z: spot.z,
        yaw: heading + (spot.variant - 0.5) * 0.25,
      });
      placed++;
    }
    return placed;
  }

  /**
   * Met du bétail dans une pâture.
   *
   * Deux choses font qu'un troupeau se lit comme un troupeau, et pas comme un
   * semis d'objets : il est **groupé** (`scatterInRing({ cluster })`), et les
   * bêtes regardent à peu près dans la même direction — un troupeau au pré
   * s'aligne sur le vent et sur la pente, il ne se disperse pas en étoile.
   *
   * Une parcelle sur cinq reste vide : les prés ne sont pas tous occupés le même
   * jour, et le décor y gagne en respiration.
   */
  _placeHerd(placements, ring, centre, variant, steepness, count) {
    if (randomAt(centre.x, centre.z, 53) < 0.2) return 0;

    const { item, spread } = herdFor({ steepness, variant });
    const heading = randomAt(centre.x, centre.z, 59) * Math.PI * 2;
    const seed = positionSeed(centre.x, centre.z, 61);
    let placed = 0;

    // Un troupeau ne paît pas sur le bitume, ni sur le ballast.
    for (const spot of this._filterOffInfra(scatterInRing(ring, count, seed, { cluster: spread }))) {
      this._place(placements, item, {
        x: spot.x,
        z: spot.z,
        // Cap commun, plus un écart d'une trentaine de degrés : assez pour que
        // ce ne soit pas un rang, pas assez pour que ce soit une rosace.
        yaw: heading + (spot.variant - 0.5) * 1.1,
        scale: 0.9 + spot.variant * 0.22,
      });
      placed++;
    }
    return placed;
  }

  /**
   * Vrai si une parcelle agricole a la forme d'une cour de ferme — voir
   * `FARMSTEAD_MAX_HECTARES` pour pourquoi ce n'est qu'un indice indirect.
   *
   * Deux conditions, et les deux sont nécessaires :
   *
   * 1. **une petite parcelle**, agricole ou pâture — pas les cinquante
   *    hectares d'openfield qu'elle borde. Au-delà du plafond, le centroïde
   *    n'a plus de raison de tomber près d'un bâtiment : ce n'est plus la cour
   *    de la ferme, c'est un de ses champs ;
   * 2. **une vraie grappe de bâtiments** relevée par `FabricIndex`, à portée
   *    du centroïde. Une maison isolée en pleine campagne est un pavillon, pas
   *    une exploitation ; deux bâtiments groupés hors d'un périmètre habité en
   *    sont une.
   *
   * Sans `FabricIndex` (`fabric` absent de `rebuild`), personne ne sait
   * combien de bâtiments compte le voisinage : cette exploitation ne se pose
   * pas, ce qui est le bon repli — même raison que `_buildVillageLandmarks`.
   *
   * Fonction pure à ceci près qu'elle lit `this._fabric`, posé par `rebuild`
   * pour la durée de la reconstruction.
   */
  _looksLikeFarmstead(properties, local, centre) {
    if (!this._fabric) return false;

    const klass = properties.class;
    const subclass = properties.subclass;
    const isFarmland = klass === 'farmland';
    const isPasture = klass === 'grass' && (subclass === 'meadow' || subclass === 'grassland');
    if (!isFarmland && !isPasture) return false;

    if (ringAreaMeters(local) / 10000 > FARMSTEAD_MAX_HECTARES) return false;

    return (
      this._fabric.countWithin(centre.x, centre.z, FARMSTEAD_CLUSTER_RADIUS_M, FARMSTEAD_CLUSTER_MIN_BUILDINGS) >=
      FARMSTEAD_CLUSTER_MIN_BUILDINGS
    );
  }

  /**
   * Pose une exploitation : grange, hangar, un ou deux silos — et ce qui la
   * rend habitée : une cheminée qui fume, du linge qui sèche, des poules.
   *
   * Ces trois-là ne sont pas du décor gratuit. Une ferme sans eux est un
   * assemblage de volumes ; avec eux, on la lit comme un lieu où quelqu'un vit,
   * et c'est le plus grand écart de réalisme pour le moins de triangles de tout
   * le catalogue.
   */
  _placeFarmstead(placements, ring, centre) {
    const yaw = randomAt(centre.x, centre.z, 13) * Math.PI * 2;
    const draw = randomAt(centre.x, centre.z, 17);

    const barn = this._place(placements, 'barn', { x: centre.x, z: centre.z, yaw });
    const offX = Math.cos(yaw) * 24;
    const offZ = Math.sin(yaw) * 24;
    this._place(placements, 'hangar', { x: centre.x + offX, z: centre.z + offZ, yaw: yaw + 0.3 });

    const silos = draw < 0.5 ? 1 : 2;
    for (let i = 0; i < silos; i++) {
      this._place(placements, 'silo', {
        x: centre.x - offZ * 0.5 + i * 6.2,
        z: centre.z + offX * 0.5,
        yaw,
      });
    }

    // Serres : un maraîchage plutôt qu'une exploitation céréalière, sur un
    // tirage propre à la ferme — indépendant de celui des silos, pour qu'une
    // exploitation ne cumule pas systématiquement les deux. Le tirage est
    // délibérément généreux : une exploitation elle-même reste rare
    // (`_looksLikeFarmstead`), inutile d'empiler une seconde rareté dessus.
    // TEMPORAIRE (inspection visuelle) : seuil forcé à 1, toutes les
    // exploitations portent des serres. À remettre à 0.4.
    if (randomAt(centre.x, centre.z, 31) < 1) {
      // Un rang, dans le sens de la ferme (même axe que la grange et le
      // hangar) — pas un semis : un maraîchage réel aligne ses tunnels côte à
      // côte, tous parallèles à l'allée qui les dessert. Chaque tunnel court
      // sur la longueur réelle de la parcelle plutôt que sur la cote fixe du
      // modèle : voir `_greenhouseLengthFor`.
      const rowCount = randomAt(centre.x, centre.z, 37) < 0.55 ? 2 : 3;
      const perpX = -Math.sin(yaw);
      const perpZ = Math.cos(yaw);
      const gx = centre.x + offX * 1.6;
      const gz = centre.z + offZ * 1.6;
      const length = FurnitureLayer._greenhouseLengthFor(ring, centre, yaw);
      const scaleZ = length / GREENHOUSE_BASE_LENGTH_M;

      for (let i = 0; i < rowCount; i++) {
        const lateral = (i - (rowCount - 1) / 2) * GREENHOUSE_SPACING_M;
        this._place(placements, 'greenhouse', {
          x: gx + perpX * lateral,
          z: gz + perpZ * lateral,
          yaw,
          scaleZ,
        });
      }
    }

    // Cheminée : au faîtage de la grange, du côté du pignon. La fumée elle-même
    // est animée par `lifeLayer` — ici on ne publie que le point d'émission.
    if (barn) {
      this.chimneys.push({
        x: barn.x - Math.sin(yaw) * 5.5,
        y: barn.y + 8.6,
        z: barn.z - Math.cos(yaw) * 5.5,
      });
    }

    // Fil à linge, au vent, derrière la grange.
    const lineX = centre.x - offZ * 0.42;
    const lineZ = centre.z + offX * 0.42;
    this._place(placements, 'laundryLine', { x: lineX, z: lineZ, yaw: yaw + Math.PI / 2 });

    // Poules dans la cour : elles ne s'éloignent jamais beaucoup du bâtiment.
    const hens = 3 + Math.floor(randomAt(centre.x, centre.z, 19) * 4);
    for (let i = 0; i < hens; i++) {
      const angle = randomAt(centre.x + i * 3.1, centre.z, 23) * Math.PI * 2;
      const radius = 6 + randomAt(centre.x, centre.z + i * 3.1, 29) * 7;
      this._place(placements, 'chicken', {
        x: centre.x + Math.cos(angle) * radius,
        z: centre.z + Math.sin(angle) * radius,
        yaw: angle,
      });
    }

    return 1;
  }

  /**
   * Habille un site de cimetière reconnu (`landuse=cemetery`, voir
   * `_urbanLanduseKind`) : le mur d'enceinte, le portail qui le perce, les
   * tombes qu'il protège, et le robinet qu'on y trouve toujours pour
   * l'entretien.
   *
   * La croix centrale reste posée par l'appelant, comme avant cette
   * fonction : c'était le seul repère du site, il ne bouge pas. Ce qui suit
   * est ce qui manquait pour qu'on y entre — un cimetière qu'on ne peut ni
   * enjamber ni franchir ne se lit pas comme un lieu, seulement comme une
   * étiquette posée sur de l'herbe.
   *
   * Tout est ancré au **centroïde du site** (`centre`), jamais à l'ordre des
   * sommets de l'anneau ni à la position de l'observateur : la même parcelle
   * doit rendre le même mur, le même portail au même endroit et le même
   * carré de tombes, qu'on l'aborde par le nord ou par le sud, aujourd'hui ou
   * dans une heure.
   */
  _buildCemetery(context, ring, centre) {
    const { buffers, placements, sampleElevation } = context;

    // L'anneau GeoJSON est déjà fermé (premier sommet répété en fin de
    // liste) ; on ne le referme qu'au cas où un appelant futur en fournirait
    // un qui ne le soit pas.
    const first = ring[0];
    const last = ring[ring.length - 1];
    const closedRing = first.x === last.x && first.z === last.z ? ring : [...ring, first];
    const wallPath = resamplePath(closedRing, CEMETERY_WALL_SAMPLE_M);
    // Un site trop petit ou dégénéré ne porte ni mur ni portail : la croix
    // déjà posée par l'appelant reste son seul repère.
    if (wallPath.length < 12) return;

    // Angle du portail dans la brèche : tiré une fois pour tout le site,
    // jamais recalculé au passage — c'est l'invariant qui garantit que deux
    // reconstructions percent le même mur au même endroit.
    const gateAngle = randomAt(centre.x, centre.z, 211) * Math.PI * 2;
    let gateIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < wallPath.length; i++) {
      const p = wallPath[i];
      let diff = Math.abs(Math.atan2(p.z - centre.z, p.x - centre.x) - gateAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        gateIndex = i;
      }
    }
    const gatePoint = wallPath[gateIndex];

    // Rotation du contour sur ce point : la brèche s'ouvre alors aux deux
    // bouts du tableau plutôt qu'au milieu, et se découpe par simple recul
    // depuis chaque extrémité — pas de modulo à chaque pas.
    const rotated = wallPath.slice(gateIndex).concat(wallPath.slice(0, gateIndex));
    const halfGate = CEMETERY_GATE_SPAN_M / 2 + 0.6;
    let cut = 1;
    while (cut < rotated.length && Math.hypot(rotated[cut].x - gatePoint.x, rotated[cut].z - gatePoint.z) < halfGate) {
      cut++;
    }
    let cutEnd = rotated.length - 1;
    while (
      cutEnd > cut &&
      Math.hypot(rotated[cutEnd].x - gatePoint.x, rotated[cutEnd].z - gatePoint.z) < halfGate
    ) {
      cutEnd--;
    }
    const wallArc = rotated.slice(cut, cutEnd + 1);
    // La brèche mange tout le pourtour rééchantillonné : un site trop exigu
    // pour porter à la fois un mur et un portail n'en porte aucun des deux,
    // plutôt qu'un portail posé sans mur pour le percer.
    if (wallArc.length < 2) return;

    appendProfile(buffers.dryStoneWall, {
      path: wallArc,
      profile: this.specs.profiles.dryStoneWall,
      sampleElevation,
      lift: -FURNITURE_SINK_M,
      closed: true,
    });

    // Portail : face tournée vers l'extérieur du site, donc vers qui arrive.
    const before = wallPath[(gateIndex - 1 + wallPath.length) % wallPath.length];
    const after = wallPath[(gateIndex + 1) % wallPath.length];
    let tx = after.x - before.x;
    let tz = after.z - before.z;
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen;
    tz /= tlen;
    let nx = tz;
    let nz = -tx;
    const outward = Math.hypot(gatePoint.x + nx - centre.x, gatePoint.z + nz - centre.z);
    const inward = Math.hypot(gatePoint.x - nx - centre.x, gatePoint.z - nz - centre.z);
    if (outward < inward) {
      nx = -nx;
      nz = -nz;
    }
    this._place(placements, 'cemeteryGate', { x: gatePoint.x, z: gatePoint.z, yaw: Math.atan2(nx, nz) });

    // Tombes : une vraie grille, pas un semis — c'est l'alignement en carrés
    // qui fait lire un cimetière, et un vrai cimetière est plein, pas semé au
    // hasard sur son herbe. La grille suit un cap tiré une fois pour tout le
    // site (`heading`) ; ses deux axes sont calés sur les cotes de la tombe
    // elle-même (`cemeteryTomb`, 0,95 × 2,05 m), au pas près du plot voisin,
    // pas au petit bonheur d'un rejet aléatoire dans la boîte englobante.
    const heading = randomAt(centre.x, centre.z, 223) * Math.PI * 2;
    const alongX = Math.cos(heading);
    const alongZ = Math.sin(heading);
    // Perpendiculaire à `heading`, direct : c'est l'axe de profondeur de la
    // tombe (tête-pied), donc celui des rangs.
    const acrossX = -alongZ;
    const acrossZ = alongX;
    const tombYaw = Math.atan2(acrossX, acrossZ);
    const plotSpacing = 1.35; // largeur d'une tombe (0,95 m) + une allée étroite
    const rowSpacing = 2.4; // profondeur d'une tombe (2,05 m) + une allée étroite
    const wallMargin = 1.6; // dégagement au pied du mur, où rien ne tient
    // Case vide, comme `HEDGE_SHAPES.hedge.gapChance` : une grille pleine se
    // lit comme une grille, pas comme un cimetière — une concession vendue,
    // une tombe qu'on a fini de relever. Le même tirage réduit d'autant le
    // compte total, ce qui est aussi tout ce qu'on lui demande.
    const tombGapChance = 0.5;
    // Clairière au portail : sans elle, la grille recouvre l'entrée elle-même
    // et referme d'une tombe ce que le mur venait d'ouvrir. Le robinet s'y
    // pose aussi, juste à côté du passage plutôt que dessus.
    const gateClearance = 3.6;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of ring) {
      const u = (p.x - centre.x) * alongX + (p.z - centre.z) * alongZ;
      const v = (p.x - centre.x) * acrossX + (p.z - centre.z) * acrossZ;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    // Un site n'épuise pas à lui seul le budget partagé de l'espèce
    // (`FURNITURE_LIMITS.points`) : au-delà, un cimetière hors norme cesse
    // simplement de se remplir, il ne prive pas les autres sites du reste de
    // la bulle.
    const tombCap = 500;
    let tombs = 0;
    for (let v = minV + wallMargin; v <= maxV - wallMargin && tombs < tombCap; v += rowSpacing) {
      for (let u = minU + wallMargin; u <= maxU - wallMargin && tombs < tombCap; u += plotSpacing) {
        const x = centre.x + alongX * u + acrossX * v;
        const z = centre.z + alongZ * u + acrossZ * v;
        if (Math.hypot(x - gatePoint.x, z - gatePoint.z) < gateClearance) continue;
        if (!pointInRing(ring, x, z)) continue;
        if (this._onRoad(x, z)) continue;
        if (randomAt(x, z, 239) < tombGapChance) continue;

        // Deux pierres plutôt qu'une répétée à l'identique — voir
        // `cemeteryTombFlat`. Le tirage est ancré à la position du plot, donc
        // stable d'une reconstruction à l'autre.
        const draw = randomAt(x, z, 227);
        this._place(placements, draw < 0.65 ? 'cemeteryTomb' : 'cemeteryTombFlat', {
          x,
          z,
          yaw: tombYaw,
          scale: 0.94 + draw * 0.1,
        });
        tombs++;
      }
    }

    // Robinet : posé près du portail, à l'écart du passage — jamais loin de
    // l'entrée dans un vrai cimetière, et la clairière ci-dessus lui garantit
    // une place libre.
    const tapYaw = randomAt(centre.x, centre.z, 233) * Math.PI * 2;
    const tapX = gatePoint.x - nx * 2.4 + tx * 2.6;
    const tapZ = gatePoint.z - nz * 2.4 + tz * 2.6;
    if (pointInRing(ring, tapX, tapZ) && !this._onRoad(tapX, tapZ)) {
      this._place(placements, 'cemeteryTap', { x: tapX, z: tapZ, yaw: tapYaw });
    }
  }

  /**
   * Un repère par périmètre habité, choisi selon la taille du bourg :
   *
   * - **hameau isolé** (moins de vingt bâtiments) — moulin à vent ou moulin à
   *   eau : le genre d'ouvrage qu'on ne trouve précisément que là où il n'y a
   *   pas grand-chose d'autre ;
   * - **ville moyenne** (vingt à cent cinquante bâtiments) — un château d'eau,
   *   qui dessert justement ce format de commune. Un hameau de dix maisons
   *   n'en a pas les moyens, une vraie ville en a d'autres, plus imposants et
   *   non modélisés ici.
   *
   * Il se pose **au bord** du périmètre, jamais dedans. Sans `FabricIndex`
   * (`fabric` absent de `rebuild`), personne ne sait combien de bâtiments
   * compte le périmètre, et ce mobilier ne se pose pas — le bon repli, plutôt
   * que d'en semer un partout par défaut.
   */
  _buildVillageLandmarks(context, builtUp) {
    const { here, placements } = context;
    if (!this._fabric || !builtUp) return;

    for (const ring of builtUp) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const centre = FurnitureLayer._centroid(ring);
      if (Math.hypot(centre.x - here.x, centre.z - here.z) > FURNITURE_RADIUS_M) continue;

      let reach = 0;
      for (const p of ring) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
      // Un périmètre minuscule n'est pas un bourg — un fond de jardin
      // `landuse=residential` isolé, par exemple.
      if (reach < 20) continue;

      // Comptés jusqu'à cent cinquante : au-delà, ni le hameau isolé ni la
      // ville moyenne ne décrivent plus ce périmètre, et aucun des deux
      // repères n'y a sa place.
      const count = this._fabric.countWithin(centre.x, centre.z, reach + 40, VILLAGE_TOWN_MAX_BUILDINGS);
      if (count === 0) continue;

      // Un seul repère par bourg, et pas dans tous les bourgs : sur le
      // tirage propre au lieu, la plupart n'en portent aucun.
      const draw = randomAt(centre.x, centre.z, 151);
      let item = null;
      if (count < VILLAGE_HAMLET_MAX_BUILDINGS) {
        if (draw < 0.1) item = 'windmill';
        else if (draw < 0.16) item = 'watermill';
      } else if (count < VILLAGE_TOWN_MAX_BUILDINGS) {
        if (draw < 0.3) item = 'waterTower';
      }
      if (!item) continue;

      const angle = randomAt(centre.x, centre.z, 153) * Math.PI * 2;
      const x = centre.x + Math.cos(angle) * reach * 1.25;
      const z = centre.z + Math.sin(angle) * reach * 1.25;
      // Le point tiré peut retomber dans le périmètre bâti voisin d'un hameau
      // à l'autre, ou sur la route qui le dessert : dans les deux cas, on
      // laisse tomber plutôt que de le replacer, pour ne pas déplacer le
      // repère d'une reconstruction à l'autre.
      if (pointInAreas(builtUp, x, z)) continue;
      if (this._onRoad(x, z)) continue;

      this._place(placements, item, { x, z, yaw: randomAt(x, z, 157) * Math.PI * 2 });
    }
  }

  // --- Points d'intérêt ----------------------------------------------------

  /**
   * Ce que la couche `poi` sait donner : arrêts de bus, fontaines, lavoirs.
   *
   * Ce sont les seuls objets de mobilier que le schéma OpenMapTiles porte
   * nommément. Ils sont donc à leur vraie place — et il n'y en a pas d'autres à
   * y chercher : ni lampadaire, ni panneau, ni borne ne survivent à la
   * génération des tuiles.
   */
  _buildPointsOfInterest(context, roadSegments) {
    const { source, tiles, here, placements } = context;
    const { origin, scale, zoom } = this.bubble.frame;

    source.forEachFeature('poi', tiles, (geometry, properties) => {
      if (geometry.type !== 'Point') return;
      const [lng, lat] = geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const x = (lngToTileX(lng, zoom) - origin.x) * scale;
      const z = (latToTileY(lat, zoom) - origin.y) * scale;
      if (Math.hypot(x - here.x, z - here.z) > FURNITURE_RADIUS_M) return;

      const item = FurnitureLayer._poiItem(properties);
      if (!item) return;

      // Orienté vers la chaussée la plus proche : un abribus qui tourne le dos
      // à la route est le genre de détail qui saute aux yeux.
      const yaw = this._facingRoad(x, z, roadSegments);
      this._place(placements, item, { x, z, yaw });
    });
  }

  /**
   * Forme du catalogue correspondant à un point d'intérêt, ou `null`.
   *
   * Église, mosquée, hôpital, boulangerie, commerce et centre commercial n'y
   * sont **plus** : poser un modèle séparé à leurs coordonnées le plaçait à
   * côté du vrai bâtiment, que celui-ci — plus grand, plus haut, ou juste
   * différemment centré — finissait presque toujours par recouvrir. C'est
   * `buildingLayer.buildingPersonalityFor` qui les traite désormais, en
   * donnant sa silhouette au bâtiment qui existe réellement à cet endroit
   * plutôt qu'en ajoutant un objet dessus.
   *
   * Château, monument et tour restent ici : ce sont de grandes structures
   * visibles de loin, pas des bâtiments qu'une empreinte ordinaire recouvre.
   *
   * ## Ce qui est vérifié, et ce qui ne l'est pas
   *
   * Les trois premières lignes sont éprouvées : elles tournaient déjà avant ce
   * chantier. Le reste suit le schéma OpenMapTiles habituel (`poi.yaml`) tel
   * qu'on peut le reconstituer sans accès aux tuiles réellement servies par ce
   * projet — à vérifier, une fois posé sur un vrai monument ou un vrai
   * château, avant de considérer ce dispatch comme acquis.
   */
  static _poiItem(properties = {}) {
    const klass = properties.class;
    const subclass = properties.subclass;
    if (klass === 'bus' || subclass === 'bus_stop' || subclass === 'bus_station') return 'busShelter';
    if (subclass === 'drinking_water' || subclass === 'water_point' || subclass === 'fountain') return 'fountain';
    if (subclass === 'wash_house' || subclass === 'watermill') return 'lavoir';
    if (klass === 'monument' || subclass === 'monument' || subclass === 'memorial') return 'monument';
    if (klass === 'castle' || subclass === 'castle') return 'castle';
    if (klass === 'tower' || subclass === 'tower' || subclass === 'observation_tower') return 'tower';
    if (subclass === 'theme_park') return 'ferrisWheel';
    return null;
  }

  /**
   * Cap tourné vers la chaussée la plus proche, **perpendiculairement**.
   *
   * Deux points, dont le second est celui qui se voit :
   *
   * 1. on vise la chaussée **en travers**, et non le point de la polyligne le
   *    plus proche : un abribus est parallèle à la route qu'il borde, c'est la
   *    perpendiculaire locale qui l'oriente ;
   * 2. le balayage grossier (un échantillon sur quatre, soit vingt mètres) ne
   *    sert **qu'à trouver la bonne chaussée**, jamais à donner le cap : pour un
   *    arrêt posé à cinq mètres de la route, un écart longitudinal de dix mètres
   *    ferait tourner l'abribus de soixante degrés. Le cap vient d'un
   *    affinement local.
   *
   * Sans route à portée, on retombe sur un cap tiré du lieu — stable d'une
   * reconstruction à l'autre, ce qui est la seule chose qui compte alors.
   */
  _facingRoad(x, z, roadSegments) {
    let best = Infinity;
    let bestSegment = null;
    let bestRow = 0;

    for (const segment of roadSegments) {
      const path = segment.path;
      for (let r = 0; r < path.length; r += 4) {
        const d = (path[r].x - x) ** 2 + (path[r].z - z) ** 2;
        if (d < best) {
          best = d;
          bestSegment = segment;
          bestRow = r;
        }
      }
    }

    if (!bestSegment) return randomAt(x, z, 5) * Math.PI * 2;

    const path = bestSegment.path;
    const from = Math.max(0, bestRow - 4);
    const to = Math.min(path.length - 1, bestRow + 4);
    for (let r = from; r <= to; r++) {
      const d = (path[r].x - x) ** 2 + (path[r].z - z) ** 2;
      if (d < best) {
        best = d;
        bestRow = r;
      }
    }

    // Tangente locale, prise par différence centrée comme partout ailleurs.
    const prev = path[Math.max(0, bestRow - 1)];
    const next = path[Math.min(path.length - 1, bestRow + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;

    // De quel côté de la marche l'objet se trouve : c'est le signe de sa
    // projection sur la perpendiculaire gauche `(tz, -tx)`.
    const at = path[bestRow];
    const offset = (x - at.x) * tz - (z - at.z) * tx;
    return roadsideYaw(tx, tz, offset, 'road');
  }

  // --- Pierres -------------------------------------------------------------

  /**
   * Cailloux, blocs et affleurements, là où le sol est minéral.
   *
   * ## Pourquoi une grille et pas des parcelles
   *
   * Parce qu'il n'y a pas de parcelle : un éboulis n'est pas un polygone
   * `landcover=rock` bien découpé, c'est une **matière** qui apparaît à partir
   * d'une certaine altitude et d'une certaine pente. La carte de classes la
   * donne au pixel près, et la pente vient du MNT — d'où un semis sur grille
   * fixe, ancrée au monde et non à l'observateur, exactement comme les repères
   * d'horizon.
   *
   * Chaque maille consomme le **même nombre de tirages** quel que soit son
   * résultat : sans ça, une pierre changerait de place dès qu'une voisine
   * apparaît ou disparaît.
   */
  _buildRocks(context, builtUp) {
    const { here, placements } = context;
    const step = ROCK_CELL_M;
    const startX = Math.floor((here.x - ROCK_RADIUS_M) / step) * step;
    const startZ = Math.floor((here.z - ROCK_RADIUS_M) / step) * step;
    let placed = 0;

    for (let z = startZ; z <= here.z + ROCK_RADIUS_M && placed < FURNITURE_LIMITS.rocks; z += step) {
      for (let x = startX; x <= here.x + ROCK_RADIUS_M && placed < FURNITURE_LIMITS.rocks; x += step) {
        const px = x + (randomAt(x, z, 101) - 0.5) * step * 0.9;
        const pz = z + (randomAt(x, z, 103) - 0.5) * step * 0.9;
        if (Math.hypot(px - here.x, pz - here.z) > ROCK_RADIUS_M) continue;
        if (pointInAreas(builtUp, px, pz)) continue;
        // Un bloc erratique au milieu de la chaussée est le plus visible de
        // tous les défauts d'emprise : il est opaque et il est haut.
        if (this._onRoad(px, pz)) continue;

        const sample = this.groundClass?.sampleAt?.(px, pz);
        // Sans carte de classes, on ne devine pas un éboulis : la pente seule
        // mettrait des rochers sur toutes les prairies de montagne.
        if (!sample) continue;
        const kind = rockKindFor({
          bare: sample.bare,
          steepness: this._steepnessAt(px, pz),
          variant: randomAt(px, pz, 107),
        });
        if (!kind) continue;

        this._place(placements, kind.item, {
          x: px,
          z: pz,
          yaw: randomAt(px, pz, 109) * Math.PI * 2,
          scale: kind.scale,
        });
        placed++;
      }
    }
    this.counts.rocks = placed;
  }

  // --- Repères d'horizon ---------------------------------------------------

  /**
   * Éoliennes et pylônes, au loin.
   *
   * Ils ne sont pas dans les tuiles — `power=tower` et `generator:source=wind`
   * n'y survivent pas —, et ils ne prétendent donc pas être à leur vraie place.
   * Ils ont une autre fonction : donner à l'horizon une échelle verticale. Sans
   * eux, un brouillard sur un relief nu ne dit pas si la crête est à un
   * kilomètre ou à dix.
   *
   * Trois garde-fous rendent leur présence acceptable : ils ne se posent que
   * sur des points hauts (une éolienne ne s'installe pas au fond d'un vallon),
   * jamais dans une zone bâtie, et leur tirage dépend uniquement de la position
   * au sol — donc ils ne bougent pas d'une reconstruction à l'autre.
   */
  _buildLandmarks(context, builtUp) {
    const { here, placements } = context;
    const radius = Math.min(LANDMARK_RADIUS_M, this.bubble.radiusMeters || LANDMARK_RADIUS_M);
    const step = 320;
    let placed = 0;
    // Reconstituée à chaque reconstruction ; `setWindDirection` la relit donc
    // pour orienter les éoliennes fraîchement posées, pas celles d'avant.
    this._turbines = [];

    // Grille ancrée sur le monde, pas sur l'observateur : les mailles visitées
    // changent, les tirages de chaque maille non.
    const startX = Math.floor((here.x - radius) / step) * step;
    const startZ = Math.floor((here.z - radius) / step) * step;

    for (let z = startZ; z <= here.z + radius && placed < FURNITURE_LIMITS.landmarks; z += step) {
      for (let x = startX; x <= here.x + radius && placed < FURNITURE_LIMITS.landmarks; x += step) {
        const draw = randomAt(x, z, 91);
        if (draw > 0.14) continue;

        // Décalage dans la maille : une grille régulière se lit comme une grille.
        const px = x + (randomAt(x, z, 92) - 0.5) * step * 0.8;
        const pz = z + (randomAt(x, z, 93) - 0.5) * step * 0.8;
        const distance = Math.hypot(px - here.x, pz - here.z);
        if (distance < 420 || distance > radius) continue;
        if (pointInAreas(builtUp, px, pz)) continue;
        if (!this._isHighPoint(px, pz)) continue;

        const item = draw < 0.08 ? 'windTurbine' : 'pylon';
        // Une éolienne s'oriente face au vent, pas au hasard de sa position ;
        // un pylône, lui, n'a pas de face — le tirage précédent lui reste.
        const yaw = item === 'windTurbine' ? this._turbineYaw() : randomAt(px, pz, 94) * Math.PI * 2;
        const entry = this._place(placements, item, { x: px, z: pz, yaw });
        if (item === 'windTurbine' && entry) this._turbines.push(entry);
        placed++;
      }
    }
    this.counts.landmarks = placed;
  }

  /**
   * Lacet qui pose la nacelle face au vent, à partir de `_windDirection`.
   *
   * Dans le repère local de la pièce, la nacelle regarde `-Z` (le moyeu et les
   * pales sont posés à `z < 0`, voir `windTurbine` dans `furnitureKit.js`) ;
   * `_windDirection` est l'angle vers lequel le vent souffle, au sens de
   * `windAxis`/`windVector` (`weather.js`) : `(cos θ, sin θ)` en `(x, z)`. Une
   * éolienne fait face à l'amont, donc à `-(cos θ, sin θ)`. Avec la convention
   * de lacet de `THREE.Quaternion.setFromAxisAngle` (axe Y), `-Z` tourné de
   * `φ` pointe vers `(-sin φ, -cos φ)` : on résout `φ = atan2(cos θ, sin θ)`.
   */
  _turbineYaw() {
    return Math.atan2(Math.cos(this._windDirection), Math.sin(this._windDirection));
  }

  /**
   * Arbre isolé de ligne de crête : un repère de hauteur, à défaut d'une
   * vraie détection de crête.
   *
   * Rien dans le MNT ni dans les tuiles ne dit « ceci est une ligne de
   * crête ». La détection retenue est une approximation assumée : un point
   * haut par rapport à ses abords immédiats (`_isHighPoint`, déjà utilisé
   * pour poser éoliennes et pylônes) et dégagé (`_openGround`). Un vrai calcul
   * suivrait la ligne de partage des eaux dans le MNT, ce qui reste à faire ;
   * ceci pose un arbre là où le relief est visiblement haut, pas
   * nécessairement sur l'arête exacte.
   */
  _buildRidgeTrees(context, builtUp) {
    const { here, placements } = context;
    const radius = Math.min(LANDMARK_RADIUS_M, this.bubble.radiusMeters || LANDMARK_RADIUS_M);
    const step = 140;
    let placed = 0;

    const startX = Math.floor((here.x - radius) / step) * step;
    const startZ = Math.floor((here.z - radius) / step) * step;

    for (let z = startZ; z <= here.z + radius && placed < FURNITURE_LIMITS.ridgeTrees; z += step) {
      for (let x = startX; x <= here.x + radius && placed < FURNITURE_LIMITS.ridgeTrees; x += step) {
        // Rare : un arbre de crête toutes les vingt à trente mailles environ,
        // jamais un par maille — sans quoi la grille se verrait.
        if (randomAt(x, z, 181) > 0.035) continue;

        const px = x + (randomAt(x, z, 182) - 0.5) * step * 0.8;
        const pz = z + (randomAt(x, z, 183) - 0.5) * step * 0.8;
        const distance = Math.hypot(px - here.x, pz - here.z);
        if (distance < 60 || distance > radius) continue;
        if (pointInAreas(builtUp, px, pz)) continue;
        if (this._onRoad(px, pz)) continue;
        if (!this._openGround(px, pz)) continue;
        if (!this._isHighPoint(px, pz)) continue;

        const conifer = randomAt(px, pz, 184) < 0.35;
        this._place(placements, conifer ? 'treeConifer' : 'treeBroad', {
          x: px,
          z: pz,
          yaw: randomAt(px, pz, 185) * Math.PI * 2,
          scale: 0.9 + randomAt(px, pz, 186) * 0.5,
        });
        placed++;
      }
    }
  }

  /** Vrai si le point domine ses alentours immédiats — une crête, pas un fond. */
  _isHighPoint(x, z) {
    const here = this.bubble.surfaceElevationAtLocal(x, z, 0);
    if (!Number.isFinite(here)) return false;
    let higher = 0;
    for (const [dx, dz] of [[-140, 0], [140, 0], [0, -140], [0, 140]]) {
      if (this.bubble.surfaceElevationAtLocal(x + dx, z + dz, 0) > here + 4) higher++;
    }
    return higher === 0;
  }

  /**
   * Antennes de sommet : posées sur les vrais sommets relevés dans les tuiles
   * (`mountain_peak`), et non devinés sur une grille comme les éoliennes et
   * les pylônes de `_buildLandmarks` — ceux-ci n'ont aucune existence dans la
   * donnée, un sommet en a une : on le lit, on ne l'invente pas.
   */
  _buildPeakLandmarks(context, builtUp) {
    const { source, tiles, here, placements } = context;
    const { origin, scale, zoom } = this.bubble.frame;
    let placed = 0;

    source.forEachFeature('mountain_peak', tiles, (geometry, properties) => {
      if (placed >= FURNITURE_LIMITS.peakLandmarks) return;
      if (geometry.type !== 'Point') return;
      const [lng, lat] = geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const x = (lngToTileX(lng, zoom) - origin.x) * scale;
      const z = (latToTileY(lat, zoom) - origin.y) * scale;
      if (Math.hypot(x - here.x, z - here.z) > LANDMARK_RADIUS_M) return;
      if (pointInAreas(builtUp, x, z)) return;

      // Un sommet sur trois environ, tiré sur sa position : les équiper tous
      // ferait une forêt de mâts, ce qu'aucune ligne de crête ne porte.
      if (randomAt(x, z, 131) > 0.35) return;

      this._place(placements, 'radioMast', { x, z, yaw: randomAt(x, z, 133) * Math.PI * 2 });
      placed++;
    });
  }

  /**
   * Phares : posés sur le trait de côte réel, jamais devinés — seule une
   * nappe `water` de classe `ocean` en fait un, une rivière ou un lac n'en
   * portent pas.
   *
   * Le contour d'une nappe `ocean` n'a pas d'orientation garantie (elle peut
   * sortir de plusieurs tuiles recousues dans n'importe quel sens), donc le
   * côté « terre » n'est pas supposé à partir de l'enroulement : il est
   * **mesuré**, en comparant l'altitude de part et d'autre du tracé et en
   * gardant le côté le plus haut.
   */
  _buildCoastalLandmarks(context, builtUp) {
    const { source, tiles, here, placements, sampleElevation } = context;
    const { origin, scale, zoom } = this.bubble.frame;
    const toLocal = (ring) =>
      ring.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));
    let placed = 0;

    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (placed >= FURNITURE_LIMITS.coastLandmarks) return;
      if (properties.class !== 'ocean') return;

      const rings =
        geometry.type === 'Polygon'
          ? [geometry.coordinates[0]]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates.map((r) => r[0]).filter(Boolean)
            : [];

      for (const ring of rings) {
        if (placed >= FURNITURE_LIMITS.coastLandmarks) break;
        if (!Array.isArray(ring) || ring.length < 3) continue;

        const path = resamplePath(toLocal(ring), 60);
        if (path.length < 3) continue;

        for (let i = 1; i < path.length - 1 && placed < FURNITURE_LIMITS.coastLandmarks; i++) {
          const p = path[i];
          if (Math.hypot(p.x - here.x, p.z - here.z) > LANDMARK_RADIUS_M) continue;

          // Un point de trait de côte sur quarante environ : un phare tous
          // les deux kilomètres et demi, pas un tous les soixante mètres.
          if (randomAt(p.x, p.z, 141) > 0.025) continue;

          const prev = path[i - 1];
          const next = path[i + 1];
          let tx = next.x - prev.x;
          let tz = next.z - prev.z;
          const len = Math.hypot(tx, tz) || 1;
          tx /= len;
          tz /= len;
          const nx = tz;
          const nz = -tx;
          const reach = 9;
          const a = sampleElevation(p.x + nx * reach, p.z + nz * reach);
          const b = sampleElevation(p.x - nx * reach, p.z - nz * reach);
          const land =
            (Number.isFinite(a) ? a : -Infinity) > (Number.isFinite(b) ? b : -Infinity)
              ? { x: p.x + nx * reach, z: p.z + nz * reach, h: a }
              : { x: p.x - nx * reach, z: p.z - nz * reach, h: b };
          // Le seuil écarte un candidat encore sous l'eau — bruit de tuile ou
          // presqu'île trop étroite pour porter quoi que ce soit.
          if (!Number.isFinite(land.h) || land.h < 0.6) continue;
          if (pointInAreas(builtUp, land.x, land.z)) continue;

          this._place(placements, 'lighthouse', { x: land.x, z: land.z, yaw: randomAt(p.x, p.z, 143) * Math.PI * 2 });
          placed++;
        }
      }
    });
  }

  // --- Utilitaires géométriques -------------------------------------------

  static _centroid(ring) {
    let x = 0;
    let z = 0;
    for (const p of ring) {
      x += p.x;
      z += p.z;
    }
    return { x: x / ring.length, z: z / ring.length };
  }

  /**
   * Longueur de tunnel de serre qui tient dans la parcelle, dans le sens de
   * la ferme (`yaw`, le même axe que la grange et le hangar) — voir
   * `_placeFarmstead`.
   *
   * Projection des sommets de l'anneau sur cet axe : l'écart entre le plus
   * loin en avant et le plus loin en arrière du centroïde est ce que la
   * parcelle offre réellement comme longueur, quelle que soit sa forme.
   * Bornée par `GREENHOUSE_MIN_LENGTH_M`/`GREENHOUSE_MAX_LENGTH_M` — voir
   * leur commentaire pour pourquoi les deux bouts sont utiles.
   *
   * Fonction pure.
   */
  static _greenhouseLengthFor(ring, centre, yaw) {
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);
    let min = Infinity;
    let max = -Infinity;
    for (const p of ring) {
      const proj = (p.x - centre.x) * dirX + (p.z - centre.z) * dirZ;
      if (proj < min) min = proj;
      if (proj > max) max = proj;
    }
    if (!(max > min)) return GREENHOUSE_MIN_LENGTH_M;
    return Math.min(GREENHOUSE_MAX_LENGTH_M, Math.max(GREENHOUSE_MIN_LENGTH_M, max - min));
  }

  /** Pente moyenne alentour, mesurée sur cent mètres. */
  _steepnessAt(x, z) {
    const span = 100;
    const here = this.bubble.surfaceElevationAtLocal(x, z, 0);
    const east = this.bubble.surfaceElevationAtLocal(x + span, z, here);
    const south = this.bubble.surfaceElevationAtLocal(x, z + span, here);
    return Math.hypot(east - here, south - here) / span;
  }

  /**
   * Vrai si le sol n'est pas déjà boisé.
   *
   * C'est la **part de boisé** qui décide, pas la part de végétal : un bois a
   * justement zéro d'herbe, donc juger sur le vert plantait les alignements
   * dans les futaies et les refusait au milieu des prairies — exactement
   * l'inverse de ce qu'on veut.
   */
  _openGround(x, z) {
    return (this.groundClass?.woodAt?.(x, z) ?? 0) < 0.35;
  }

  /**
   * Pose une haie : sa masse continue, et ses arbustes.
   *
   * Une haie n'est pas une section balayée — c'est un **alignement d'arbustes**
   * qui, mis bout à bout, ferme une parcelle. Le balayage seul tient très bien
   * à cent mètres et se trahit à dix : sa crête est une ligne, sa section est
   * constante, c'est un tube. Deux moitiés, donc, chacune pour sa distance
   * (voir `hedgeGeometry`) :
   *
   * - le **balayage**, modulé en hauteur et en largeur, porte la haie au loin,
   *   et facetté (`hedgeGeometry.facetJitter`) pour qu'il ne se lise plus,
   *   même de près, comme un tube extrudé ;
   * - les **arbustes**, posés dans le seul champ proche, portent sa silhouette
   *   de près — et le balayage se baisse d'autant sous eux, de sorte que le
   *   passage de l'un à l'autre ne se voit pas.
   *
   * Ils s'écrivent dans le même accumulateur : une haie reste une géométrie,
   * une matière, un appel de dessin, et hérite donc du même ombrage plat
   * (`_applyLinear`) — sans lui, les arêtes du facettage seraient moyennées et
   * invisibles.
   *
   * Le tracé est ré-échantillonné plus fin que les contours dont il vient : à
   * six mètres, aucune modulation à l'échelle de l'arbuste ne passe. Ce pas
   * (`HEDGE_SAMPLE_M`) fixe aussi l'espacement des arêtes facettées.
   *
   * `startDistance` ancre les arbustes sur le **nœud amont** de la voie et non
   * sur le début du tronçon rendu : un tronçon redécoupé ailleurs les ferait
   * sinon tous glisser, et la haie se replanterait à chaque reconstruction.
   *
   * `own` est la chaussée que la haie borde délibérément : posée à `offset` de
   * l'axe, elle est hors de l'emprise de sa propre route, mais file tout droit
   * dans les rues transversales. La découpe la coupe à chacune ; chaque tronçon
   * garde alors sa part de la distance parcourue, faute de quoi la coupe
   * replanterait tout ce qui la suit.
   */
  _appendHedgerow(buffer, kind, path, sampleElevation, options = {}) {
    const { offset = 0, own = null, startDistance = 0 } = options;
    if (!own) {
      this._appendHedgerowRun(buffer, kind, path, sampleElevation, options);
      return;
    }
    for (const run of this._clipOffRoad(path, { offset, minLength: BOUNDARY_MIN_LENGTH_M, own })) {
      this._appendHedgerowRun(buffer, kind, run, sampleElevation, {
        ...options,
        startDistance: startDistance + FurnitureLayer._distanceAlong(path, run[0]),
      });
    }
  }

  /**
   * Distance parcourue sur `path` jusqu'à un point qui s'y trouve.
   *
   * Les tronçons rendus par la découpe repartent tous de zéro : sans ce report,
   * l'ancrage des arbustes se perdrait à chaque traversée.
   */
  static _distanceAlong(path, point) {
    let travelled = 0;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const span = Math.hypot(dx, dz);
      if (span > 1e-6) {
        const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (span * span)));
        const gap = Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z);
        if (gap < bestGap) {
          bestGap = gap;
          best = travelled + span * t;
        }
      }
      travelled += span;
    }
    return best;
  }

  /** Une haie d'un seul tenant : sa masse balayée, puis ses arbustes. */
  _appendHedgerowRun(buffer, kind, path, sampleElevation, { offset = 0, here = null, startDistance = 0 } = {}) {
    const style = hedgeStyleFor(kind, this.theme.furniture.hedges);
    const fine = resamplePath(path, HEDGE_SAMPLE_M);
    const dense = fine.length >= 2 ? fine : path;

    // Deux bruits composés, pas un seul : `hedgeModulation` reste la courbe
    // longue qui porte la silhouette au loin, `facetJitter` y superpose un
    // saut indépendant par ligne — c'est lui, combiné à l'ombrage plat de
    // `_applyLinear`, qui casse le tube de près.
    const modulation = hedgeModulation(dense, { offset, here, style });
    const facets = facetJitter(dense, style.salt);
    const scaleUp = new Float32Array(dense.length);
    const scaleAcross = new Float32Array(dense.length);
    for (let r = 0; r < dense.length; r++) {
      scaleUp[r] = modulation.up[r] * facets.up[r];
      scaleAcross[r] = modulation.across[r] * facets.across[r];
    }

    appendProfile(buffer, {
      path: dense,
      profile: this.specs.profiles[kind],
      sampleElevation,
      offset,
      lift: -FURNITURE_SINK_M,
      closed: true,
      scaleUp,
      scaleAcross,
      lateralJitter: facets.lateral,
      // Fenêtre de lissage du pied gardée à ~6 m de chaque côté (l'ancien
      // rayon par défaut, 2, au pas d'avant ce chantier, 3 m) : le pas plus
      // fin qui fait les arêtes du balayage ne doit pas aussi laisser
      // repasser le bruit métrique du MNT sous la haie.
      smoothRadius: Math.round(6 / HEDGE_SAMPLE_M),
    });

    this.counts.hedgeClumps += appendHedgeClumps(buffer, {
      path: dense,
      offset,
      here,
      style,
      sampleElevation,
      lift: -FURNITURE_SINK_M,
      colors: this.theme.furniture.colors,
      startDistance,
      limit: FURNITURE_LIMITS.hedgeClumps - this.counts.hedgeClumps,
    });
  }

  /**
   * Pose un objet en bord de chaussée, décalé perpendiculairement.
   *
   * `facing` décide de l'orientation, et c'est `roadsideYaw` qui la calcule —
   * le signe s'y prenait à l'envers, et tout le mobilier de bord de route
   * regardait le champ d'en face. `onPlatform` pose l'objet au niveau de la
   * chaussée plutôt que du terrain : au ras de la rive, une borne posée sur le
   * terrain se retrouverait au pied du remblai, un mètre plus bas que la route
   * qu'elle borne. Les objets plus éloignés — un alignement d'arbres à deux
   * mètres et demi — sont mieux servis par le terrain, qui est bien ce sur quoi
   * ils poussent.
   *
   * @param {Float32Array} platform Altitudes de plate-forme, une par ligne.
   * @returns {{x:number,y:number,z:number}|null} l'objet posé, ou `null`.
   */
  _placeBeside(
    placements,
    item,
    point,
    offset,
    platform,
    { facing = 'along', scale = 1, onPlatform = false, offRoad = false, own = null } = {}
  ) {
    // Perpendiculaire à gauche de la marche, comme partout ailleurs.
    const x = point.x + point.tz * offset;
    const z = point.z - point.tx * offset;
    // `offRoad` ne concerne que ce qui pousse — un alignement d'arbres. Le
    // mobilier réglementaire, lui, est posé au ras de la rive, donc dans
    // l'emprise, et c'est sa place : une glissière hors de l'emprise ne
    // protège rien.
    if (offRoad && this._onRoad(x, z, own)) return null;
    const yaw = roadsideYaw(point.tx, point.tz, offset, facing);

    let y = null;
    if (onPlatform && platform?.length) {
      const row = Math.min(platform.length - 1, Math.max(0, Math.round(point.distance / ROAD_SAMPLE_M)));
      y = platform[row];
    }

    return this._place(placements, item, { x, z, y, yaw, scale, exactY: y != null });
  }

  /** @returns {{x:number,y:number,z:number}|null} l'objet posé, ou `null`. */
  _place(placements, item, { x, z, y = null, yaw = 0, scale = 1, scaleX = null, scaleZ = null, exactY = false }) {
    const list = placements.get(item);
    if (!list || list.length >= FURNITURE_LIMITS.points) return null;

    const ground =
      exactY && y != null
        ? y
        : this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;
    if (!Number.isFinite(ground)) return null;

    const placed = { x, y: ground - FURNITURE_SINK_M, z, yaw, scale };
    // Mise à l'échelle non uniforme, optionnelle : seule la serre en a besoin
    // aujourd'hui — une longueur qui suit la parcelle, sans étirer sa largeur
    // ni sa hauteur (voir `_placeFarmstead`). Absente, `_applyInstances`
    // retombe sur `scale` seul.
    if (scaleX != null) placed.scaleX = scaleX;
    if (scaleZ != null) placed.scaleZ = scaleZ;
    list.push(placed);
    return placed;
  }

  _countPlacements(placements) {
    let total = 0;
    for (const list of placements.values()) total += list.length;
    return total;
  }

  // --- Rendu ---------------------------------------------------------------

  _applyLinear(kind, buffer) {
    const { THREE } = this;
    const geometry = toColoredGeometry(THREE, buffer, { flat: FLAT_SHADED_LINEAR_KINDS.has(kind) });
    const existing = this.linear.get(kind);

    if (!geometry) {
      if (existing) {
        this.group.remove(existing);
        existing.geometry.dispose();
        this.linear.delete(kind);
      }
      return;
    }

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `furniture-${kind}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.linear.set(kind, mesh);
  }

  /**
   * (Ré)alimente l'instanciation d'une forme.
   *
   * Le maillage est réalloué quand le nombre d'exemplaires dépasse sa capacité,
   * et seulement alors : `InstancedMesh` fixe son compte à la construction, mais
   * `count` peut descendre librement en dessous. Une marge de 25 % évite de
   * réallouer à chaque reconstruction pour trois lampadaires de plus.
   */
  _applyInstances(item, list) {
    const { THREE } = this;
    let mesh = this.instanced.get(item);

    if (list.length === 0) {
      if (mesh) mesh.count = 0;
      return;
    }

    if (!mesh || mesh.instanceMatrix.count < list.length) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
      const capacity = Math.ceil(list.length * 1.25) + 8;
      // Seule l'éolienne porte le matériau à rotor (`createFurnitureRotorMaterial`),
      // seule la serre porte le matériau translucide (`createFurnitureGreenhouseMaterial`)
      // — sa bâche, contrairement à toute autre pièce du catalogue, doit se voir au travers.
      const material =
        item === 'windTurbine' ? this.rotorMaterial : item === 'greenhouse' ? this.greenhouseMaterial : this.material;
      mesh = new THREE.InstancedMesh(this.geometries[item], material, capacity);
      mesh.name = `furniture-${item}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // La géométrie est partagée entre toutes les instances ; la sphère
      // englobante de l'ensemble se recalcule après écriture des matrices.
      this.group.add(mesh);
      this.instanced.set(item, mesh);
    }

    list.forEach((p, index) => {
      this._position.set(p.x, p.y, p.z);
      this._quaternion.setFromAxisAngle(this._axis, p.yaw);
      // `scaleX`/`scaleZ` retombent sur `scale` quand ils sont absents : la
      // même ligne sert le mobilier ordinaire (mise à l'échelle uniforme) et
      // la serre (longueur seule étirée) sans se dédoubler.
      this._scale.set(p.scaleX ?? p.scale ?? 1, p.scale || 1, p.scaleZ ?? p.scale ?? 1);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
    });

    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  /**
   * (Ré)alimente les halos de lampadaire.
   *
   * Même mécanique que `_applyInstances`, mais l'échelle porte ici le **rayon du
   * halo** et non la taille d'un objet : le shader la relit dans la matrice
   * d'instance pour dresser son panneau face caméra.
   */
  _applyGlow() {
    const { THREE } = this;
    const heads = this._lampHeads;

    if (heads.length === 0) {
      if (this.glowMesh) this.glowMesh.count = 0;
      return;
    }

    if (!this.glowMesh || this.glowMesh.instanceMatrix.count < heads.length) {
      if (this.glowMesh) {
        this.group.remove(this.glowMesh);
        this.glowMesh.dispose?.();
      }
      const capacity = Math.ceil(heads.length * 1.25) + 8;
      this.glowMesh = new THREE.InstancedMesh(this.glowGeometry, this.glowMaterial, capacity);
      this.glowMesh.name = 'furniture-lamp-glow';
      this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Dessiné après tout le reste : un halo additif sans écriture de
      // profondeur doit passer par-dessus la scène, jamais l'inverse.
      this.glowMesh.renderOrder = 8;
      this.glowMesh.frustumCulled = false;
      this.group.add(this.glowMesh);
    }

    const mesh = this.glowMesh;
    heads.forEach((head, index) => {
      this._position.set(head.x, head.y, head.z);
      this._quaternion.identity();
      this._scale.setScalar(6.5);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
    });
    mesh.count = heads.length;
    mesh.instanceMatrix.needsUpdate = true;

    this._applyPools(heads);
  }

  /**
   * Nappes de lumière au sol, une par tête de lampadaire.
   *
   * Elles sont posées à l'altitude du **terrain sous la tête**, et non sous le
   * mât : la tête avance d'un mètre et demi au-dessus de la chaussée, et c'est
   * là que la flaque tombe. Sur un versant, la différence vaut un décimètre —
   * assez pour que la nappe disparaisse dans le talus ou flotte au-dessus.
   */
  _applyPools(heads) {
    const { THREE } = this;
    if (heads.length === 0) {
      if (this.poolMesh) this.poolMesh.count = 0;
      return;
    }

    if (!this.poolMesh || this.poolMesh.instanceMatrix.count < heads.length) {
      if (this.poolMesh) {
        this.group.remove(this.poolMesh);
        this.poolMesh.dispose?.();
      }
      const capacity = Math.ceil(heads.length * 1.25) + 8;
      this.poolMesh = new THREE.InstancedMesh(this.poolGeometry, this.poolMaterial, capacity);
      this.poolMesh.name = 'furniture-lamp-pool';
      this.poolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Après la chaussée, avant les halos : la nappe se pose sur le sol, le
      // halo par-dessus tout.
      this.poolMesh.renderOrder = 7;
      this.group.add(this.poolMesh);
    }

    const mesh = this.poolMesh;
    heads.forEach((head, index) => {
      const ground = this.bubble.surfaceElevationAtLocal(head.x, head.z, 0) * this.bubble.verticalScale;
      this._position.set(head.x, (Number.isFinite(ground) ? ground : head.y - LAMP_HEAD_HEIGHT_M) + 0.06, head.z);
      this._quaternion.identity();
      this._scale.set(LAMP_POOL_M, 1, LAMP_POOL_M);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
    });
    mesh.count = heads.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  /**
   * (Ré)alimente le maillage des noms peints sur les panneaux d'entrée
   * d'agglomération — voir l'en-tête de `materials/labelAtlas.js` sur
   * pourquoi un texte par instance ne peut pas passer par la géométrie
   * partagée de `signPlaceName` (`Kit`, instanciée par `_applyInstances`).
   *
   * Le repère local du texte sur la lame (`SIGN_PLACE_NAME_LABEL_Y_M`,
   * `SIGN_PLACE_NAME_LABEL_Z_M`) est recopié de `signPlaceName`
   * (`furnitureKit.js`) : les deux doivent rester d'accord, sans quoi le nom
   * se peint à côté de la lame plutôt que dessus. Seuls x et z tournent avec
   * le lacet de l'instance (`Kit.transform`) — y ne bouge pas sous un lacet.
   */
  _applyLabels() {
    const { THREE } = this;
    const labels = { positions: [], uvs: [] };

    for (const quad of this._labelQuads) {
      const uv = this.labelAtlas.place(quad.name, {
        maxWidthPx: Math.max(1, SIGN_PLACE_NAME_TEXT_WIDTH_M * LABEL_PX_PER_M),
        maxFontPx: labelFontPxForCellHeight(SIGN_PLACE_NAME_LABEL_HEIGHT_M * LABEL_PX_PER_M),
        minFontPx: labelFontPxForCellHeight(SIGN_PLACE_NAME_LABEL_MIN_HEIGHT_M * LABEL_PX_PER_M),
        color: SIGN_PLACE_NAME_LABEL_INK,
      });
      if (!uv) continue;

      const halfWidth = uv.widthPx / LABEL_PX_PER_M / 2;
      const halfHeight = uv.heightPx / LABEL_PX_PER_M / 2;
      // Local +X est la droite de qui fait face au panneau (même lacet que
      // `Kit.transform`), donc c'est lui qu'il faut passer en premier à
      // `pushLabelQuad` — voir sa note : le premier point est le côté droit
      // du texte. Les inverser laisse le texte lisible... à l'envers.
      const left = Kit.transform([-halfWidth, 0, SIGN_PLACE_NAME_LABEL_Z_M], { yaw: quad.yaw });
      const right = Kit.transform([halfWidth, 0, SIGN_PLACE_NAME_LABEL_Z_M], { yaw: quad.yaw });
      const bottom = quad.y + SIGN_PLACE_NAME_LABEL_Y_M - halfHeight;
      const top = quad.y + SIGN_PLACE_NAME_LABEL_Y_M + halfHeight;
      pushLabelQuad(
        labels,
        { x: quad.x + right[0], y: quad.z + right[2] },
        { x: quad.x + left[0], y: quad.z + left[2] },
        bottom,
        top,
        uv
      );
    }

    this.labelAtlas.upload();

    if (labels.positions.length === 0) {
      if (this.labelMesh) this.labelMesh.visible = false;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(labels.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(labels.uvs, 2));
    geometry.computeBoundingSphere();

    if (this.labelMesh) {
      this.labelGeometry?.dispose();
      this.labelMesh.geometry = geometry;
      this.labelMesh.visible = true;
    } else {
      const mesh = new THREE.Mesh(geometry, this.labelMaterial);
      mesh.name = 'furniture-labels';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.labelMesh = mesh;
    }
    this.labelGeometry = geometry;
  }

  /** (Ré)alimente les lentilles allumées des feux tricolores. */
  _applySignals() {
    const { THREE } = this;
    const count = this._signals.length;

    if (count === 0) {
      if (this.signalMesh) this.signalMesh.count = 0;
      if (this.signalGlowMesh) this.signalGlowMesh.count = 0;
      return;
    }

    const build = (mesh, geometry, material, name, order) => {
      if (mesh && mesh.instanceMatrix.count >= count) return mesh;
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
      const next = new THREE.InstancedMesh(geometry, material, count + 4);
      next.name = name;
      next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      next.renderOrder = order;
      next.frustumCulled = false;
      this.group.add(next);
      return next;
    };

    this.signalMesh = build(this.signalMesh, this.signalGeometry, this.signalMaterial, 'traffic-lens', 7);
    this.signalGlowMesh = build(this.signalGlowMesh, this.glowGeometry, this.signalGlowMaterial, 'traffic-glow', 8);
    this.signalMesh.count = count;
    this.signalGlowMesh.count = count;
    this.advanceSignals(0);
  }

  /**
   * Fait tourner les feux tricolores. À appeler une fois par image.
   *
   * Une seule lentille est allumée à la fois — c'est ce qui manquait : les trois
   * couleurs brillaient en permanence, ce qui ne ressemble à rien, et leurs
   * verres se disputaient le pixel avec le boîtier, d'où le scintillement.
   *
   * @param {number} delta Secondes écoulées.
   */
  advanceSignals(delta = 0) {
    if (this.disposed || !this.signalMesh || this._signals.length === 0) return;
    this._signalClock = (this._signalClock + (Number.isFinite(delta) ? delta : 0)) % 3600;

    this._signals.forEach((signal, index) => {
      const lens = this.specs.trafficLenses[trafficPhaseAt(this._signalClock, signal.phase)];
      // Devant le boîtier, dans l'axe où le feu regarde. `yaw` amène le +Z de la
      // pièce sur `(sin θ, cos θ)` : la même convention que `roadsideYaw`.
      const reach = TRAFFIC_LENS_REACH_M;
      const x = signal.x + Math.sin(signal.yaw) * reach;
      const z = signal.z + Math.cos(signal.yaw) * reach;

      this._position.set(x, signal.y + lens.y, z);
      this._quaternion.setFromAxisAngle(this._axis, signal.yaw);
      this._scale.setScalar(1);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.signalMesh.setMatrixAt(index, this._matrix);
      this._color.setRGB(lens.color[0], lens.color[1], lens.color[2]);
      this.signalMesh.setColorAt(index, this._color);

      this._scale.setScalar(1.5);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.signalGlowMesh.setMatrixAt(index, this._matrix);
      this.signalGlowMesh.setColorAt(index, this._color);
    });

    this.signalMesh.instanceMatrix.needsUpdate = true;
    if (this.signalMesh.instanceColor) this.signalMesh.instanceColor.needsUpdate = true;
    this.signalGlowMesh.instanceMatrix.needsUpdate = true;
    if (this.signalGlowMesh.instanceColor) this.signalGlowMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Pose les deux vraies lumières sur les têtes de lampadaire les plus proches.
   *
   * ## Pourquoi seulement deux
   *
   * Le nombre de lumières d'une scène entre dans la clé de programme de **tous**
   * ses matériaux. Une lumière par lampadaire ferait recompiler l'intégralité des
   * shaders à chaque reconstruction du mobilier, c'est-à-dire tous les 250
   * mètres — un gel d'une demi-seconde, régulier. Deux lumières fixes qui se
   * déplacent coûtent deux comparaisons par tête et rien d'autre.
   *
   * L'intensité s'éteint en approchant du bord de portée : sans ce fondu, une
   * lampe s'allumerait d'un bloc en entrant dans la liste.
   *
   * @param {{x:number,z:number}} at Position de l'observateur.
   */
  advanceLamps(at) {
    if (this.disposed || this.lampLights.length === 0) return;

    const heads = this._lampHeads;
    // Les deux plus proches, trouvées par insertion : trier une liste de
    // plusieurs centaines de têtes à chaque image serait absurde pour en garder
    // deux.
    const best = [];
    for (const head of heads) {
      const d = Math.hypot(head.x - at.x, head.z - at.z);
      if (d > LAMP_LIGHT_RANGE_M) continue;
      if (best.length < this.lampLights.length) {
        best.push({ head, d });
        best.sort((a, b) => a.d - b.d);
      } else if (d < best[best.length - 1].d) {
        best[best.length - 1] = { head, d };
        best.sort((a, b) => a.d - b.d);
      }
    }

    this.lampLights.forEach((light, index) => {
      const pick = best[index];
      if (!pick) {
        light.intensity = 0;
        return;
      }
      light.position.set(pick.head.x, pick.head.y, pick.head.z);
      // Fondu sur le dernier tiers de la portée.
      const fade = Math.min(1, (LAMP_LIGHT_RANGE_M - pick.d) / (LAMP_LIGHT_RANGE_M * 0.35));
      light.intensity = LAMP_LIGHT_CD * this._night * fade;
    });
  }

  /**
   * Oriente les éoliennes face au vent et règle la vitesse à laquelle
   * `advanceRotor` fait tourner leurs pales.
   *
   * Indépendant d'une reconstruction : le vent tourne sans que l'observateur
   * bouge, donc les éoliennes déjà posées doivent suivre tout de suite — pas
   * seulement celles de la prochaine reconstruction.
   *
   * @param {number} direction Direction du vent, en radians (`weather.windDirection`).
   * @param {number} force Force du vent, de 0 à 1 (`weather.wind`).
   */
  setWindDirection(direction, force = 0) {
    if (this.disposed) return;
    this._windDirection = Number.isFinite(direction) ? direction : 0;
    this._windForce = Number.isFinite(force) ? Math.min(1, Math.max(0, force)) : 0;
    this._refreshTurbineYaw();
  }

  /** Réécrit le lacet des éoliennes déjà posées sur `_windDirection`. */
  _refreshTurbineYaw() {
    if (this.disposed || this._turbines.length === 0) return;
    const yaw = this._turbineYaw();
    for (const t of this._turbines) t.yaw = yaw;
    this._applyInstances('windTurbine', this._turbines);
  }

  /**
   * Fait tourner les pales d'éolienne. À appeler une fois par image.
   * @param {number} delta Secondes écoulées.
   */
  advanceRotor(delta) {
    if (this.disposed) return;
    advanceFurnitureRotor(this.rotorMaterial, delta, this._windForce);
  }

  /**
   * Règle l'éclairage nocturne du mobilier.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));
    this._night = value;
    this.glowMaterial.uniforms.uOpacity.value = value * 0.95;
    this.poolMaterial.uniforms.uOpacity.value = value * 0.5;
    this.signalGlowMaterial.uniforms.uOpacity.value = 0.55 + value * 0.35;
    if (this.glowMesh) this.glowMesh.visible = value > 0.01;
    if (this.poolMesh) this.poolMesh.visible = value > 0.01;
    for (const light of this.lampLights) light.intensity *= value > 0.01 ? 1 : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const mesh of this.instanced.values()) {
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.instanced.clear();

    for (const mesh of this.linear.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.linear.clear();

    for (const mesh of [this.glowMesh, this.poolMesh, this.signalMesh, this.signalGlowMesh, this.labelMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.glowMesh = null;
    this.poolMesh = null;
    this.signalMesh = null;
    this.signalGlowMesh = null;
    this.labelMesh = null;
    this.labelGeometry?.dispose();
    this.labelGeometry = null;
    this.labelMaterial.dispose();
    this.labelAtlas.dispose();
    this._labelQuads = [];

    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.poolGeometry.dispose();
    this.poolMaterial.dispose();
    this.signalGeometry.dispose();
    this.signalMaterial.dispose();
    this.signalGlowMaterial.dispose();

    for (const light of this.lampLights) this.scene.remove(light);
    this.lampLights.length = 0;

    this._lampHeads = [];
    this._signals = [];
    this.chimneys = [];

    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.geometries = {};
    this.material.dispose();
    this.rotorMaterial.dispose();
    this.greenhouseMaterial.dispose();
    this._turbines = [];
    this.scene.remove(this.group);
  }
}
