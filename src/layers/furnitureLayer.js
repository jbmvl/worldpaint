/*
 * furnitureLayer — le mobilier, posé dans la bulle.
 * -------------------------------------------------
 * Le terrain, la route, le bâti et les arbres donnent une campagne juste mais
 * vide : rien n'y borde, rien n'y clôt, rien n'y marque la distance. Ce sont
 * ces objets-là qui font qu'on lit une route de campagne plutôt qu'un ruban
 * gris sur une photo aérienne.
 *
 * Cette couche exécute les règles de `furniturePlacement` avec les formes de
 * `furnitureKit`. Elle se reconstruit sur la même cadence que la chaussée et le
 * bâti — tous les 250 mètres parcourus —, à partir des mêmes tuiles déjà
 * décodées : aucune requête réseau supplémentaire.
 *
 * ## Deux familles, deux traitements
 *
 * - **Le linéaire** — haies, murets, clôtures, glissières, talus, câbles — est
 *   *balayé* : une section suivie le long d'une polyligne (`appendProfile`).
 *   Une seule géométrie fusionnée par matière, refaite à chaque reconstruction.
 * - **Le ponctuel** — lampadaires, poteaux, panneaux, bornes, bottes, bâtiments
 *   agricoles, éoliennes — est *instancié* : une géométrie partagée, une
 *   matrice par exemplaire. Un `InstancedMesh` par forme.
 *
 * ## Le cas de la forte pente
 *
 * La chaussée est dressée de niveau en travers, **à mi-hauteur** de sa section
 * (`levelRow`) : c'est là qu'un terrassier la met, le déblai d'un côté payant le
 * remblai de l'autre. Sur un versant, la route est donc à la fois encaissée et
 * portée, et chaque rive appelle son ouvrage :
 *
 * - en **amont**, le terrain est entaillé le long de la chaussée
 *   (`terrainBubble.cutElevation`) et un **mur habille la tranchée** — il part
 *   de la plate-forme et monte jusqu'au terrain naturel, donc sa hauteur suit le
 *   versant mètre par mètre ;
 * - en **aval**, un **mur de soutènement** descend de la rive jusqu'au sol
 *   qu'elle surplombe, et la **glissière** se pose dessus ;
 * - hors des versants raides, un simple **talus** de terre suffit là où la
 *   plate-forme surplombe légèrement le terrain.
 *
 * Ce n'est donc pas un décor plaqué au hasard sur les routes de montagne : les
 * deux murs et la glissière apparaissent là où le relief, lu dans le MNT, les
 * rend nécessaires — et nulle part ailleurs.
 *
 * ## Ce qui donne de la vie
 *
 * Un décor juste mais inerte se lit comme une maquette. S'y ajoutent donc du
 * bétail dans les pâtures, des poules et du linge dans les cours de ferme, des
 * feux aux carrefours d'agglomération, et le halo des lampadaires la nuit. Tout
 * cela est **immobile** : ce qui bouge — oiseaux, fumée — vit dans `lifeLayer`,
 * qui est animé par image là où cette couche est reconstruite tous les 250 m.
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
import { ROAD_SAMPLE_M, ROAD_LIFT_M } from './roadNetwork.js';
import { ROAD_CUT_M } from '../terrain/roadCut.js';
import { clipOutsideCorridor, filterOutsideCorridor, inCorridor } from './roadCorridor.js';
import {
  createFurnitureGeometries,
  createFurnitureMaterial,
  createGlowMaterial,
  createGlowGeometry,
  createLightPoolGeometry,
  createLightPoolMaterial,
  BARBED_WIRE_HEIGHTS,
  LAMP_HEAD_HEIGHT_M,
  LAMP_HEAD_REACH_M,
  furnitureSpecsFor,
  TRAFFIC_LENS_REACH_M,
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
  BUILT_UP_CLASSES,
  FARMYARD_SUBCLASSES,
  ROW_CROPS,
  STEEP_CROSS_SLOPE,
  EMBANKMENT_MIN_DROP_M,
} from './furniturePlacement.js';

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
 * Vraies lumières de lampadaire présentes dans la scène.
 *
 * Deux, et pas une de plus : le nombre de lumières entre dans la clé de
 * programme de **tous** les matériaux, donc il doit rester constant sur toute la
 * vie de la scène. Elles se posent en permanence sur les deux têtes les plus
 * proches de l'observateur, avec un fondu d'entrée et de sortie qui évite qu'une rue
 * s'allume d'un bloc quand on y entre.
 */
export const LAMP_LIGHT_COUNT = 2;
/** Portée d'une de ces lumières, en mètres. */
export const LAMP_LIGHT_RANGE_M = 34;
/** Intensité de plein régime, en candela. */
export const LAMP_LIGHT_CD = 620;
/** Diamètre de la nappe de lumière au sol, en mètres. */
export const LAMP_POOL_M = 17;
/** Durée d'un cycle de feu tricolore, en secondes. */
export const TRAFFIC_CYCLE_S = 14;

/**
 * État d'un feu tricolore à un instant donné : quelle lentille est allumée.
 *
 * Le cycle réel n'est pas symétrique — le vert dure, l'orange passe. Le rendre
 * symétrique donnerait un clignotement régulier, qui se lit comme une
 * décoration de Noël plutôt que comme un carrefour.
 *
 * Fonction pure. `phase` décale le cycle d'un feu à l'autre : deux feux voisins
 * synchrones sont la première chose qui trahit un décor procédural.
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

/**
 * Plafonds. Ils ne sont pas décoratifs : une commune de bocage dense peut
 * offrir plusieurs centaines de contours dans la bulle, et rien n'oblige à les
 * dessiner tous pour que le paysage se lise.
 */
export const FURNITURE_LIMITS = {
  boundaries: 180,
  scatter: 320,
  points: 1100,
  farmBuildings: 32,
  landmarks: 12,
  // Un feu tricolore ne se voit qu'aux carrefours d'une agglomération, et une
  // agglomération traversée n'en compte pas vingt-quatre. Le plafond précédent
  // ne plafonnait rien : c'est la règle de détection qui en posait trop.
  trafficLights: 8,
  rocks: 200,
  vineRows: 90,
};

/** Formes ponctuelles du catalogue, dans l'ordre où on les instancie. */
const POINT_ITEMS = [
  'streetLamp',
  'utilityPole',
  'pylon',
  'windTurbine',
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
  'laundryLine',
  'cow',
  'sheep',
  'chicken',
  'bush',
  'treeBroad',
  'treeConifer',
  'fernClump',
  'vineStock',
  'rockSmall',
  'rockBoulder',
  'rockOutcrop',
  ...SIGN_ITEMS,
];

/** Matières linéaires : une géométrie fusionnée par matière. */
const LINEAR_KINDS = [
  'hedge',
  'lowHedge',
  'ditch',
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

    this.group = new THREE.Group();
    this.group.name = 'furniture';
    scene.add(this.group);

    this.material = createFurnitureMaterial(THREE);
    this.geometries = createFurnitureGeometries(THREE, theme.furniture.colors);

    /** @type {Map<string, Object>} `InstancedMesh` par forme ponctuelle. */
    this.instanced = new Map();
    /** @type {Map<string, Object>} maillage fusionné par matière linéaire. */
    this.linear = new Map();
    /** Compte des objets posés lors de la dernière reconstruction. */
    this.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0 };

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
    this.signalGlowMaterial = createGlowMaterial(THREE, { perInstanceColor: true });
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
   *        (`RoadIndex`). Il sert deux fois : à trouver les carrefours, seul
   *        endroit où un feu tricolore a un sens, et à tenir l'**emprise
   *        routière** — la frontière que rien du décor ne doit franchir
   *        (`roadCorridor`).
   * @returns {boolean} vrai si quelque chose a été posé.
   */
  rebuild(source, tiles, here, roadSegments = [], roadIndex = null) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    // Gardé le temps de la reconstruction : haies, clôtures, bottes et
    // troupeaux s'y heurtent. Il est remis à `null` en sortie pour qu'aucun
    // appel tardif ne s'appuie sur un index périmé.
    this._roadIndex = roadIndex;

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
    this.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0 };
    this._lampHeads = [];
    this._signals = [];
    this.chimneys = [];

    try {
      const builtUp = this._collectBuiltUpAreas(source, tiles);
      this._buildRoadside(context, roadSegments, builtUp);
      this._buildCrossings(context, roadSegments, roadIndex, builtUp);
      this._buildParcels(context, builtUp);
      this._buildPointsOfInterest(context, roadSegments);
      this._buildRocks(context, builtUp);
      this._buildLandmarks(context, builtUp);
    } catch (e) {
      console.warn('[furniture] mobilier partiel', e?.message || e);
    }

    for (const kind of LINEAR_KINDS) this._applyLinear(kind, buffers[kind]);
    for (const [item, list] of placements) this._applyInstances(item, list);
    this._applyGlow();
    this._applySignals();

    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    this._roadIndex = null;
    return this.counts.points + this.counts.boundaries > 0;
  }

  // --- Emprise routière ----------------------------------------------------

  /**
   * Vrai si un point tombe sur la voirie — chaussée et accotement excavé.
   *
   * Le mobilier **de bord de route** ne passe pas par là, et c'est voulu :
   * glissière, lampadaire, borne et feu sont posés au ras de la rive, donc
   * dans l'emprise, et c'est exactement là qu'ils doivent être. Seul le décor
   * qui n'a rien à faire sur la voirie s'y heurte.
   */
  _onRoad(x, z, own = null) {
    const accept = own ? (other) => other !== own : null;
    return inCorridor(this._roadIndex, x, z, undefined, accept);
  }

  /**
   * Découpe une polyligne aux traversées de chaussée.
   *
   * `offset` est le décalage latéral auquel l'objet sera réellement posé : une
   * haie de bas-côté longe la route à deux mètres de sa rive, et c'est là qu'il
   * faut sonder l'emprise, pas sur l'axe de la route.
   */
  _clipOffRoad(path, { offset = 0, minLength = BOUNDARY_MIN_LENGTH_M, own = null } = {}) {
    // `own` est la chaussée que l'objet borde délibérément : un fossé longe sa
    // route à un mètre cinquante de la rive, donc dans son emprise, et c'est sa
    // place. Il doit malgré tout s'arrêter à chaque rue transversale.
    const accept = own ? (other) => other !== own : null;
    return clipOutsideCorridor(path, this._roadIndex, undefined, { offset, minLength, accept });
  }

  // --- Zones bâties --------------------------------------------------------

  /**
   * Emprises résidentielles et commerciales, en anneaux métriques.
   *
   * Elles servent d'interrupteur : à l'intérieur, une rue est éclairée et n'a
   * ni poteau téléphonique ni haie ; à l'extérieur, c'est l'inverse. C'est la
   * seule information dont on dispose pour distinguer une rue d'une route, et
   * elle est portée par la couche `landuse` du schéma OpenMapTiles.
   */
  _collectBuiltUpAreas(source, tiles) {
    const areas = [];
    const { origin, scale, zoom } = this.bubble.frame;

    const collect = (geometry, properties) => {
      if (!BUILT_UP_CLASSES.has(properties.class)) return;
      for (const ring of this._ringsOf(geometry)) {
        const local = ring.map(([lng, lat]) => ({
          x: (lngToTileX(lng, zoom) - origin.x) * scale,
          z: (latToTileY(lat, zoom) - origin.y) * scale,
        }));
        if (local.length >= 3) areas.push(local);
      }
    };

    source.forEachFeature('landuse', tiles, collect);
    return areas;
  }

  /** Vrai si le point tombe dans l'une des emprises bâties. */
  static _inAreas(areas, x, z) {
    for (const ring of areas) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const zi = ring[i].z;
        const zj = ring[j].z;
        if (zi > z !== zj > z) {
          const t = (z - zi) / (zj - zi || 1);
          if (x < ring[i].x + t * (ring[j].x - ring[i].x)) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  // --- Bord de route -------------------------------------------------------

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
    const { buffers, placements, sampleElevation } = context;
    const { platform, halfWidth, profile, startDistance, anchor } = segment;
    // Le côté de la haie et de la ligne téléphonique se tire au nœud
    // d'ancrage : il ne dépend donc ni du découpage ni de la position de
    // l'observateur, et ne change plus de bord d'une reconstruction à l'autre.
    const side = anchor || segment.path[0];

    for (const run of runsByValue(rowsInfo, (row) => FurnitureLayer._inAreas(builtUp, row.x, row.z), 8)) {
      const rows = run.rows;
      if (rows.length < 3) continue;
      const origin = rows[0].distance;
      const path = rows.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
      const deck = new Float32Array(rows.map((row) => platform[row.r]));
      const mid = rows[Math.floor(rows.length / 2)];

      const inTown = run.value;
      const plan = roadsideFurnitureFor(profile, { builtUp: inTown });
      const spacing = { startDistance: startDistance + origin, margin: 4 };

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
        buffers,
        placements,
        sampleElevation,
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
    buffers,
    placements,
    sampleElevation,
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
    // bâtie. C'est le seul objet du décor qui dise « ici commence le village ».
    if (inTown && path.length > 4 && plan.lamp) {
      const start = path[1];
      const tx = path[2].x - path[0].x;
      const tz = path[2].z - path[0].z;
      const length = Math.hypot(tx, tz) || 1;
      this._placeBeside(
        placements,
        'signPlaceName',
        { x: start.x, z: start.z, tx: tx / length, tz: tz / length, distance: start.distance },
        -(halfWidth + 1.4),
        platform,
        { facing: 'traffic', onPlatform: true }
      );
    }

    if (plan.alignmentTree) {
      // Un alignement n'a de sens qu'en terrain découvert : dans un bois, il
      // se noierait dans les arbres déjà plantés depuis la photo.
      if (this._openGround(mid.x, mid.z)) {
        // L'essence est tirée **une fois pour la chaîne** : un alignement mêlant
        // platanes et sapins n'existe pas, c'est le propre d'un alignement d'être
        // planté le même jour.
        const conifer = randomAt(side.x, side.z, 37) < 0.22;
        for (const p of spacedAlongPath(path, plan.alignmentTree, spacing)) {
          const row = p.index % 2 === 0 ? 1 : -1;
          this._placeBeside(placements, conifer ? 'treeConifer' : 'treeBroad', p, row * (halfWidth + 3.2), platform, {
            scale: 1.05 + randomAt(p.x, p.z, 3) * 0.5,
            // Un platane pousse au bord de la route qu'il borde — donc celle-ci
            // ne le gêne pas — mais pas au milieu de celle qui la croise.
            offRoad: true,
            own: segment,
          });
        }
      }
    }

    // Bas-côté : fossé, haie basse, haie de bocage. Le motif complet — fossé,
    // talus, limite végétale — n'est donné qu'à une portion sur trois : appliqué
    // partout, il transforme la campagne en circuit.
    const verge = roadsideVergeFor(profile, { builtUp: inTown, variant: randomAt(side.x, side.z, 83) });
    if (verge.ditch) {
      const sides = verge.ditchSide === 0 ? [1, -1] : [verge.ditchSide];
      for (const s of sides) {
        const offset = s * (halfWidth + 1.5);
        // Le fossé s'interrompt là où une rue transversale le coupe : un fossé
        // qui traverse une chaussée est une saignée en travers de la route.
        for (const run of this._clipOffRoad(path, { offset, minLength: 0, own: segment })) {
          appendProfile(buffers.ditch, {
            path: run,
            profile: this.specs.profiles.ditch,
            sampleElevation,
            offset,
            lift: -FURNITURE_SINK_M,
          });
        }
        // Fougères sur la berge amont du fossé : c'est ce qui y pousse, et une
        // saignée nue se lirait comme une tranchée de chantier. Une touffe tous
        // les cinq mètres, sautée une fois sur trois.
        for (const spot of spacedAlongPath(path, 5, spacing)) {
          if (randomAt(spot.x, spot.z, 173) > 0.66) continue;
          const away = offset + s * 1.1;
          const fx = spot.x + spot.tz * away;
          const fz = spot.z - spot.tx * away;
          if (this._onRoad(fx, fz, segment)) continue;
          this._place(placements, 'fernClump', {
            x: fx,
            z: fz,
            yaw: randomAt(spot.x, spot.z, 179) * Math.PI * 2,
            scale: 0.8 + randomAt(spot.x, spot.z, 181) * 0.7,
          });
        }
      }
    }

    const openGround = this._openGround(mid.x, mid.z);
    if (verge.verge && openGround) {
      const vergeSide = verge.ditchSide || 1;
      this._appendBoundary(
        buffers.lowHedge,
        'lowHedge',
        path,
        sampleElevation,
        vergeSide * (halfWidth + 2.6),
        segment
      );
    }

    // La haie de bocage le long de la route reste, mais elle n'est plus
    // systématique : une petite route sur deux seulement en porte une, et
    // jamais du côté où court déjà le fossé.
    if (plan.hedge && openGround && randomAt(side.x, side.z, 29) < 0.5) {
      const hedgeSide = -(verge.ditchSide || (randomAt(side.x, side.z, 23) < 0.5 ? 1 : -1));
      this._appendBoundary(
        buffers.hedge,
        'hedge',
        path,
        sampleElevation,
        hedgeSide * (halfWidth + 1.8),
        segment
      );
    }
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
   * est une propriété **géométrique** du réseau : c'est un point où deux
   * chaussées distinctes se recouvrent. L'index spatial le sait déjà, puisque
   * c'est exactement la question que lui pose la recouture des plate-formes.
   *
   * Trois conditions, et elles éliminent l'essentiel : le carrefour doit être en
   * zone bâtie (une croisée de départementales en pleine campagne porte un
   * cédez-le-passage, pas un feu), la chaussée doit en mériter un (`plan`), et
   * deux carrefours à moins de trente mètres n'en sont qu'un — les branches d'un
   * même croisement se recoupent sur plusieurs lignes.
   */
  _buildCrossings(context, roadSegments, roadIndex, builtUp) {
    if (!roadIndex) return;
    const { placements, here } = context;
    const seen = [];
    let placed = 0;

    for (const segment of roadSegments) {
      if (placed >= FURNITURE_LIMITS.trafficLights) break;
      if (!roadsideFurnitureFor(segment.profile, { builtUp: true }).trafficLight) continue;

      const { path, platform, halfWidth } = segment;
      for (let r = 2; r < path.length - 2 && placed < FURNITURE_LIMITS.trafficLights; r++) {
        const p = path[r];
        if (Math.hypot(p.x - here.x, p.z - here.z) > FURNITURE_RADIUS_M) continue;
        if (!FurnitureLayer._inAreas(builtUp, p.x, p.z)) continue;

        // Une autre chaussée passe ici, et assez large pour être une rue et non
        // une entrée de garage.
        const hit = roadIndex.query(p.x, p.z, 0, (other) => other !== segment && other.halfWidth >= 2.2);
        if (!hit) continue;
        // Cent mètres de séparation, et non trente. Un carrefour est détecté sur
        // toutes les lignes où les deux rubans se recouvrent — donc sur une
        // dizaine de lignes de chaque branche —, et trente mètres laissaient
        // passer deux ou trois feux par croisement. C'est de là que venait leur
        // nombre, pas du plafond.
        if (seen.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 100)) continue;
        seen.push({ x: p.x, z: p.z });

        // Posé à droite, une dizaine de mètres avant le carrefour, face au
        // trafic qu'il arrête — c'est la position française.
        const before = path[Math.max(0, r - 2)];
        const tx = p.x - before.x;
        const tz = p.z - before.z;
        const length = Math.hypot(tx, tz) || 1;
        const offset = -(halfWidth + 1.2);
        const yaw = roadsideYaw(tx / length, tz / length, offset, 'traffic');
        const post = this._place(placements, 'trafficLight', {
          x: before.x + (tz / length) * offset,
          z: before.z - (tx / length) * offset,
          y: platform?.[Math.max(0, r - 2)] ?? null,
          yaw,
          exactY: !!platform,
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

    const handle = (geometry, properties, bounds) => {
      for (const ring of this._ringsOf(geometry)) {
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
        if (FurnitureLayer._inAreas(builtUp, centre.x, centre.z)) continue;

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
        if (FARMYARD_SUBCLASSES.has(properties.subclass) && farmBuildings < FURNITURE_LIMITS.farmBuildings) {
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
          boundaries += this._appendParcelBoundary(buffers, placements, kind, ring, bounds, sampleElevation);
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
  _appendParcelBoundary(buffers, placements, kind, ring, bounds, sampleElevation) {
    let placed = 0;

    for (const run of realBoundaryRuns(ring, bounds)) {
      const { origin, scale, zoom } = this.bubble.frame;
      const local = run.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));

      const sampled = resamplePath(local, BOUNDARY_SAMPLE_M);
      if (sampled.length < 3) continue;

      // Une route qui traverse la parcelle coupe sa limite en deux : le contour
      // repart de l'autre côté de la chaussée au lieu de la franchir. C'est le
      // seul endroit du bocage où une haie a le droit de s'interrompre, et
      // c'est aussi le seul où elle le fait vraiment.
      for (const path of this._clipOffRoad(sampled)) {
        if (path.length < 3) continue;

        if (kind === 'hedge' || kind === 'lowHedge' || kind === 'dryStoneWall') {
          appendProfile(buffers[kind], {
            path,
            profile: this.specs.profiles[kind],
            sampleElevation,
            lift: -FURNITURE_SINK_M,
            closed: true,
            // Un muret de pierre sèche est arasé de niveau, une haie non : elle
            // seule respire le long du tracé.
            scaleUp: kind === 'dryStoneWall' ? null : FurnitureLayer._hedgeRelief(path),
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
            appendProfile(buffers.vineRow, {
              path,
              profile: this.specs.profiles.vineRow,
              sampleElevation,
              lift: -FURNITURE_SINK_M,
              closed: true,
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
    const count = Math.min(24, Math.floor(hectares * rule.perHectare));
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
    for (const spot of filterOutsideCorridor(scatterInRing(ring, count, seed), this._roadIndex)) {
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

    // Un troupeau ne paît pas sur le bitume.
    for (const spot of filterOutsideCorridor(
      scatterInRing(ring, count, seed, { cluster: spread }),
      this._roadIndex
    )) {
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

  /** Forme du catalogue correspondant à un point d'intérêt, ou `null`. */
  static _poiItem(properties = {}) {
    const klass = properties.class;
    const subclass = properties.subclass;
    if (klass === 'bus' || subclass === 'bus_stop' || subclass === 'bus_station') return 'busShelter';
    if (subclass === 'drinking_water' || subclass === 'water_point' || subclass === 'fountain') return 'fountain';
    if (subclass === 'wash_house' || subclass === 'watermill') return 'lavoir';
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
        if (FurnitureLayer._inAreas(builtUp, px, pz)) continue;
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
        if (FurnitureLayer._inAreas(builtUp, px, pz)) continue;
        if (!this._isHighPoint(px, pz)) continue;

        const item = draw < 0.08 ? 'windTurbine' : 'pylon';
        this._place(placements, item, { x: px, z: pz, yaw: randomAt(px, pz, 94) * Math.PI * 2 });
        placed++;
      }
    }
    this.counts.landmarks = placed;
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

  // --- Utilitaires géométriques -------------------------------------------

  _ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]).filter(Boolean);
    return [];
  }

  static _centroid(ring) {
    let x = 0;
    let z = 0;
    for (const p of ring) {
      x += p.x;
      z += p.z;
    }
    return { x: x / ring.length, z: z / ring.length };
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
   * Ajoute une haie ou une clôture le long d'une chaussée.
   *
   * Elle est posée à `offset` de l'axe, donc **hors** de l'emprise de sa propre
   * route — c'est ce que garantissent les décalages choisis par l'appelant, qui
   * dépassent tous l'accotement excavé. Restent les **autres** chaussées :
   * à un carrefour, une haie de bas-côté file tout droit dans la rue
   * transversale. C'est celles-là que la découpe retire, en sondant l'emprise
   * là où la haie sera réellement posée.
   */
  _appendBoundary(buffer, kind, path, sampleElevation, offset, own = null) {
    for (const run of this._clipOffRoad(path, { offset, minLength: BOUNDARY_MIN_LENGTH_M, own })) {
      appendProfile(buffer, {
        path: run,
        profile: this.specs.profiles[kind],
        sampleElevation,
        offset,
        lift: -FURNITURE_SINK_M,
        closed: true,
        scaleUp: FurnitureLayer._hedgeRelief(run, offset),
      });
    }
  }

  /**
   * Hauteur relative d'une haie le long de son tracé.
   *
   * Une haie n'a pas la même hauteur sur deux cents mètres : elle est taillée
   * par bouts, trouée par un passage, plus haute là où un arbre s'y est
   * installé. Sans cette variation, la section balayée se lit exactement pour ce
   * qu'elle est — un tube extrudé —, et c'est le défaut qu'on remarque en
   * premier sur tout le mobilier linéaire.
   *
   * Deux ondes de périodes incommensurables, tirées de la **position au sol** :
   * la même haie garde donc son relief d'une reconstruction à l'autre.
   */
  static _hedgeRelief(path, offset = 0) {
    const out = new Float32Array(path.length);
    for (let r = 0; r < path.length; r++) {
      const s = path[r].x * 0.21 + path[r].z * 0.13 + offset;
      const wave = Math.sin(s * 0.9) * 0.55 + Math.sin(s * 0.31 + 1.7) * 0.45;
      out[r] = 0.78 + (wave * 0.5 + 0.5) * 0.44;
    }
    return out;
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
  _place(placements, item, { x, z, y = null, yaw = 0, scale = 1, exactY = false }) {
    const list = placements.get(item);
    if (!list || list.length >= FURNITURE_LIMITS.points) return null;

    const ground =
      exactY && y != null
        ? y
        : this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;
    if (!Number.isFinite(ground)) return null;

    const placed = { x, y: ground - FURNITURE_SINK_M, z, yaw, scale };
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
    const geometry = toColoredGeometry(THREE, buffer);
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
      mesh = new THREE.InstancedMesh(this.geometries[item], this.material, capacity);
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
      this._scale.setScalar(p.scale || 1);
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

    for (const mesh of [this.glowMesh, this.poolMesh, this.signalMesh, this.signalGlowMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.glowMesh = null;
    this.poolMesh = null;
    this.signalMesh = null;
    this.signalGlowMesh = null;

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
    this.scene.remove(this.group);
  }
}
