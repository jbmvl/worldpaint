/*
 * furnitureLayer — le coordinateur du mobilier. Il tient ce que toutes les
 * familles partagent — les accumulateurs, l'emprise routière, la pose d'un
 * objet, les haies, le rendu et les animations — et appelle chaque famille
 * dans l'ordre (voir `rebuild`). Les règles propres à une famille vivent dans
 * `furniture/`, une par module ; c'est là qu'on va, et non ici, pour changer
 * un garde-corps, une limite de parcelle ou un repère d'horizon.
 *
 * Deux façons de dessiner : le linéaire (haies, murets, clôtures, glissières,
 * talus, câbles) est balayé le long d'une polyligne (`appendProfile`), une
 * seule géométrie fusionnée par matière ; le ponctuel (lampadaires, poteaux,
 * panneaux, bornes, bâtiments agricoles) est instancié, un `InstancedMesh` par
 * forme. Une famille n'écrit jamais ailleurs que dans ces accumulateurs.
 *
 * Rien ne se pose sur la chaussée ni la voie ferrée (`RailwayLayer` publie
 * son propre `RoadIndex`, comme les routes) — `_onRoad` et `_clipOffRoad`
 * interrogent les deux indistinctement. Le mobilier de rive fait exception et
 * c'est voulu : sa place est dans l'emprise de **sa** chaussée, pas de celle
 * d'en face (`_onOtherPavement`).
 *
 * Ce qui bouge n'est pas posé ici : le mobilier publie les bêtes (`fauna`) et
 * les cheminées (`chimneys`) pour `faunaLayer` et `lifeLayer`, qui les animent
 * par image — cette couche, elle, ne se refait que tous les 250 m.
 */

import { defaultTheme } from '../themes/default.js';
import {
  createProfileBuffer,
  appendProfile,
  pathFrames,
  toColoredGeometry,
  resamplePath,
} from './ribbonGeometry.js';
import {
  HEDGE_SAMPLE_M,
  hedgeStyleFor,
  hedgeModulation,
  appendHedgeClumps,
  hedgeFacets,
  hedgeNosePath,
  hedgeEndTaper,
} from './hedgeGeometry.js';
import { facetJitter } from './facetJitter.js';
import { ROAD_SAMPLE_M } from './roadNetwork.js';
import { edgeClearance } from './roadEdges.js';
import { LEVEL_GROUND } from './roadWorks.js';
import { collectBuiltUpAreas, collectPlaceNames } from './settlement.js';
import { LabelAtlas, pushLabelQuad, labelFontPxForCellHeight, LABEL_PX_PER_M } from '../materials/labelAtlas.js';
import {
  clipOutsideCorridor,
  filterOutsideCorridor,
  inCorridor,
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
  furnitureSpecsFor,
  LAMP_HEAD_HEIGHT_M,
  TRAFFIC_LENS_REACH_M,
} from './furnitureKit.js';
import { roadsideYaw, coatFor } from './furniturePlacement.js';
import {
  BOUNDARY_MIN_LENGTH_M,
  DRY_STONE_WALL_SAMPLE_M,
  FLAT_SHADED_LINEAR_KINDS,
  FURNITURE_LIMITS,
  FURNITURE_REBUILD_M,
  FURNITURE_SINK_M,
  LINEAR_KINDS,
  POINT_ITEMS,
} from './furniture/catalog.js';
import { buildRoadside } from './furniture/roadsideFurniture.js';
import { buildCrossings, buildJunctionSigns, trafficPhaseAt } from './furniture/junctionFurniture.js';
import { buildParcels } from './furniture/parcels.js';
import {
  buildVillageLandmarks,
  buildRocks,
  buildLandmarks,
  buildPeakLandmarks,
  buildCoastalLandmarks,
  buildRidgeTrees,
} from './furniture/landmarks.js';
import { buildPointsOfInterest, collectChurches } from './furniture/pointsOfInterest.js';
import { buildDomesticFauna } from './furniture/domesticFauna.js';
import {
  SIGN_PLACE_NAME_TEXT_WIDTH_M,
  SIGN_PLACE_NAME_LABEL_HEIGHT_M,
  SIGN_PLACE_NAME_LABEL_MIN_HEIGHT_M,
  SIGN_PLACE_NAME_LABEL_Y_M,
  SIGN_PLACE_NAME_LABEL_Z_M,
  SIGN_PLACE_NAME_LABEL_INK,
} from './furniture/roadsideFurniture.js';

/*
 * Ré-exports : le mobilier reste une seule adresse vue de l'extérieur, quelle
 * que soit la famille qui porte réellement la règle.
 */
export {
  BOUNDARY_MIN_LENGTH_M,
  BOUNDARY_SAMPLE_M,
  FURNITURE_LIMITS,
  FURNITURE_RADIUS_M,
  FURNITURE_REBUILD_M,
  FURNITURE_SINK_M,
  LINEAR_KINDS,
  POINT_ITEMS,
  SIGN_ITEMS,
} from './furniture/catalog.js';
export {
  isSettlementEdgeRun,
  SIGN_PLACE_NAME_MAX_M,
  SIGN_PLACE_NAME_FABRIC_RADIUS_M,
  SIGN_PLACE_NAME_MIN_GAP_M,
  STREET_LAMP_CHURCH_RADIUS_M,
} from './furniture/roadsideFurniture.js';
export { churchWithin } from './furniture/pointsOfInterest.js';
export { trafficPhaseAt, TRAFFIC_CYCLE_S } from './furniture/junctionFurniture.js';
export { ROCK_CUT_MIN_RISE_M } from './furniture/roadsideRelief.js';
export { POI_CLEARANCE_M } from './furniture/pointsOfInterest.js';
export { HERD_EMPTY_ODDS } from './furniture/parcelFauna.js';
export {
  FARMSTEAD_MAX_HECTARES,
  FARMSTEAD_CLUSTER_RADIUS_M,
  FARMSTEAD_CLUSTER_MIN_BUILDINGS,
  FARMSTEAD_SHARE,
  GREENHOUSE_MIN_LENGTH_M,
  GREENHOUSE_MAX_LENGTH_M,
  GREENHOUSE_SPACING_M,
} from './furniture/parcels.js';
export {
  LANDMARK_RADIUS_M,
  LANDMARK_CLEARANCE_M,
  RIDGE_TREE_CLEARANCE_M,
  ROCK_RADIUS_M,
  ROCK_CELL_M,
  VILLAGE_HAMLET_MAX_BUILDINGS,
  VILLAGE_TOWN_MAX_BUILDINGS,
} from './furniture/landmarks.js';

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
/** Sel du grain du muret de pierre sèche (`facetJitter`). */
const DRY_STONE_WALL_SEED = 5521;

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
    /**
     * Famille climatique du lieu, ou `null`. Posée par le compositeur. Elle
     * décide de trois choses ici : le bétail d'une pâture, le traitement de
     * ses limites (`BOUNDARY_MIXES`) et l'essence d'un alignement de route
     * (`ALIGNMENT_SPECIES_MIXES`) — les deux dernières dessinant la trame du
     * paysage agraire, qui se lit de bien plus loin qu'une couleur.
     */
    this.climate = null;
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
     * Bêtes posées, publiées pour `faunaLayer`. Même raison que les cheminées :
     * ce qui est animé par image n'a rien à faire dans une couche reconstruite
     * tous les 250 mètres.
     *
     * Ce que la couche de mobilier garde, c'est le seul travail qui demande
     * les tuiles : **où** est un pré, **qui** y paît, et quel circuit y tient
     * sans mordre sur la chaussée. Ce qu'elle publie est déjà complet — une
     * espèce, un circuit avec ses altitudes, une robe.
     * @type {Array<Object>}
     */
    this.fauna = [];
    /** Nuancier des robes, une liste par espèce (voir `theme.fauna.coats`). */
    this._coats = theme.fauna?.coats || {};
    /**
     * Emprise routière de la reconstruction en cours (`RoadIndex`), ou `null`.
     * Elle ne vit que le temps d'un `rebuild` : hors de là, il n'y a pas de
     * frontière à faire respecter, seulement un index périmé.
     */
    this._roadIndex = null;
    /** Dalles de carrefour de la reconstruction en cours (`JunctionAreas`), même durée de vie. */
    this._areas = null;
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
    /** @type {Array<{x:number,z:number}>|null} lieux de culte relevés — voir `furniture/pointsOfInterest.collectChurches`. */
    this._churches = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  /**
   * Pose la famille climatique du lieu. Le mobilier se refait quand elle change
   * (le compositeur périme le décor), donc il n'y a rien à invalider ici.
   * @param {string|null} family
   */
  setClimate(family) {
    this.climate = family || null;
  }

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
   *        panneau d'entrée (`furniture/roadsideFurniture.js`) et le chat ou
   *        le chien d'une maison (`furniture/domesticFauna.js`).
   * @param {Object} [options]
   * @param {Object|null} [options.areas] `JunctionAreas` (`roadJunctions`) :
   *        les surfaces de carrefour. Un panneau de priorité se pose à une
   *        **bouche**, pas au nœud — et la bouche est une propriété de la
   *        surface, pas du graphe.
   * @param {Array|null} [options.houses] Maisons publiées par `buildingLayer`
   *        (`this.buildings.houses`) — seul endroit où une maison, sa forme
   *        et sa position existent ensemble, nécessaire pour poser un animal
   *        domestique devant elle.
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
    places = null,
    { areas = null, houses = null } = {}
  ) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    // Gardés le temps de la reconstruction, remis à `null` en sortie pour
    // qu'aucun appel tardif ne s'appuie sur une donnée périmée.
    this._roadIndex = roadIndex;
    this._areas = areas;
    this._fabric = fabric;
    this._railIndex = railIndex;
    this._infraIndex = new CombinedIndex([roadIndex, railIndex]);
    // Même repli que `builtUp`, juste en dessous : `worldComposer` les lit
    // déjà tous les deux au même moment pour la voirie, mais la couche reste
    // capable de les relire seule.
    this._places = places || collectPlaceNames(source, tiles, this.bubble.frame);
    // Toujours relus ici : aucune autre couche n'a besoin d'un lieu de culte,
    // ce n'est donc pas une question posée deux fois.
    this._churches = collectChurches(source, tiles, this.bubble.frame);
    this._labelQuads = [];

    const sampleElevation = (x, z) =>
      this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;
    // Terrain naturel, déblai exclu : la falaise du déblai rejoint le versant
    // tel qu'il était avant l'entaille, pas la surface déjà creusée — sur
    // laquelle elle se poserait à mi-pente du raccord.
    const rawElevation = (x, z) =>
      this.bubble.rawSurfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;

    // Accumulateurs remis à zéro : le mobilier est intégralement refait, il ne
    // se met pas à jour par différence. Sur quelques milliers d'objets, la
    // reconstruction coûte moins cher que le suivi de ce qui a changé.
    const buffers = {};
    for (const kind of LINEAR_KINDS) buffers[kind] = createProfileBuffer();
    const placements = new Map();
    for (const item of POINT_ITEMS) placements.set(item, []);

    const context = { source, tiles, here, sampleElevation, rawElevation, buffers, placements };
    this.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0, hedgeClumps: 0 };
    this._lampHeads = [];
    this._signals = [];
    this.chimneys = [];
    this.fauna = [];

    try {
      // Les emprises habitées viennent de `worldComposer` quand il les a déjà
      // lues pour la voirie : c'est la même question posée une seule fois. En
      // leur absence, la couche les relit — elle ne dépend de personne.
      const builtUp = builtUpAreas || collectBuiltUpAreas(source, tiles, this.bubble.frame);
      buildRoadside(this, context, roadSegments, builtUp);
      buildCrossings(this, context, junctions, roadIndex, builtUp);
      buildJunctionSigns(this, context, areas, roadIndex, builtUp);
      buildParcels(this, context, builtUp);
      buildDomesticFauna(this, houses);
      buildVillageLandmarks(this, context, builtUp);
      buildPointsOfInterest(this, context, roadSegments);
      buildRocks(this, context, builtUp);
      buildLandmarks(this, context, builtUp);
      buildPeakLandmarks(this, context, builtUp);
      buildCoastalLandmarks(this, context, builtUp);
      buildRidgeTrees(this, context, builtUp);
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
    this._areas = null;
    this._fabric = null;
    this._railIndex = null;
    this._infraIndex = null;
    this._places = null;
    this._churches = null;
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
   * qui n'a rien à faire sur la voirie — ou sur la voie — s'y heurte. Ce qui ne
   * veut pas dire qu'il ait le droit de se poser n'importe où : sa rive à lui
   * n'est pas la chaussée d'en face, et c'est `_onOtherPavement` qui fait la
   * différence.
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
   * Vrai si ce point tombe sur une chaussée **qui n'est pas la sienne**, ou
   * dans un carrefour.
   *
   * Le mobilier de rive ne passe pas par `_onRoad` : il est posé au ras de la
   * chaussée, donc dans son emprise, et c'est sa place (voir `_onRoad`). Mais
   * « au ras de la sienne » n'a jamais voulu dire « sur celle d'à côté ». Or un
   * lampadaire est posé à quatre-vingt-dix centimètres de sa propre rive, sans
   * rien demander à personne : à un carrefour, où deux chaussées se rejoignent,
   * et dans un faisceau, où deux voies se longent, ce décalage-là tombe droit
   * sur la chaussée d'en face. C'est ce qui plantait un lampadaire et un poteau
   * électrique au milieu de la route.
   *
   * La question posée est celle de la rive (`roadEdges.edgeClearance`) : la
   * place libre entre le point et la prochaine chaussée, sa propre chaussée
   * exceptée. Zéro veut dire « dessus ». La portée demandée est minuscule —
   * c'est un oui ou non, pas une largeur : on ne cherche pas ici de quoi
   * s'écarter, seulement de quoi refuser.
   *
   * @param {number} x
   * @param {number} z
   * @param {Object|null} own Le tronçon que l'objet borde délibérément.
   * @param {number} [level] Niveau de croisement de ce tronçon.
   * @returns {boolean}
   */
  _onOtherPavement(x, z, own, level = LEVEL_GROUND) {
    if (!this._roadIndex && !this._areas) return false;
    const room = edgeClearance(x, z, {
      roadIndex: this._roadIndex,
      areas: this._areas,
      level,
      ignore: own ? (segment) => segment === own : null,
      reach: 0.01,
    });
    return room <= 0;
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

  /**
   * Découpe une polyligne aux passages en sous-bois.
   *
   * Une haie sous un couvert déjà planté ne se voit pas et n'existe pas : le
   * bois y tient lieu de limite. La question se posait auparavant **une fois**,
   * sur un point pris au milieu du tronçon rendu — c'est-à-dire sur un point
   * qui avance avec l'observateur, si bien que la haie d'une même route
   * apparaissait et disparaissait en roulant. Posée ligne par ligne, elle ne
   * dépend plus que du sol : la haie s'arrête au bois et reprend après.
   *
   * @param {Array<{x:number,z:number}>} path
   * @param {number} [offset] Décalage latéral auquel la haie sera posée : c'est
   *        là qu'il faut sonder, pas sur l'axe de la route.
   * @param {number} [minLength] Longueur en deçà de laquelle un bout de haie ne
   *        vaut pas d'être posé.
   */
  _clipOpenGround(path, { offset = 0, minLength = BOUNDARY_MIN_LENGTH_M } = {}) {
    const rows = path?.length ?? 0;
    if (rows < 2) return [];
    if (!this.groundClass?.woodAt) return [path];

    const perp = pathFrames(path);
    const runs = [];
    let run = null;
    for (let r = 0; r < rows; r++) {
      // `pathFrames` range la tangente puis la perpendiculaire gauche —
      // `(tz, -tx)`, la même convention que `_placeBeside`.
      const x = path[r].x + perp[r * 4 + 2] * offset;
      const z = path[r].z + perp[r * 4 + 3] * offset;
      if (this._openGround(x, z)) {
        if (!run) runs.push((run = []));
        run.push(path[r]);
      } else {
        run = null;
      }
    }

    const out = [];
    for (const points of runs) {
      if (points.length < 2) continue;
      let travelled = 0;
      const withDistance = [{ ...points[0], distance: 0 }];
      for (let i = 1; i < points.length; i++) {
        travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
        withDistance.push({ ...points[i], distance: travelled });
      }
      if (travelled < minLength) continue;
      out.push(withDistance);
    }
    return out;
  }

  // --- Bord de route -------------------------------------------------------
  //
  // Les emprises habitées (`settlement.js`) servent d'interrupteur : à
  // l'intérieur, une rue est éclairée et n'a ni poteau téléphonique ni haie ; à
  // l'extérieur, c'est l'inverse. La même lecture sert à `streetLayer`, qui la
  // complète du bâti réellement présent — un périmètre habité n'est pas encore
  // une rue, et c'est ce qui décide de son trottoir.

  /** Robe d'une bête, tirée dans le nuancier de son espèce. Ancrée au lieu. */
  _coatFor(kind, x, z) {
    return coatFor(this._coats, kind, x, z);
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
   *   et facetté (`hedgeGeometry.hedgeFacets`) pour qu'il ne se lise plus,
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
    const { offset = 0, own = null, startDistance = 0, openGround = false } = options;
    const crossings = own
      ? this._clipOffRoad(path, { offset, minLength: BOUNDARY_MIN_LENGTH_M, own })
      : [path];
    for (const crossed of crossings) {
      // `openGround` ne vaut que pour la haie de bord de route, qui n'existe
      // que parce qu'on invente un bocage : dans un bois, elle n'a rien à
      // clore. Un contour de parcelle, lui, vient de la donnée — il longe une
      // lisière aussi souvent qu'un champ, et le couper là l'effacerait.
      const runs = openGround ? this._clipOpenGround(crossed, { offset }) : [crossed];
      for (const run of runs) {
        this._appendHedgerowRun(buffer, kind, run, sampleElevation, {
          ...options,
          startDistance: startDistance + FurnitureLayer._distanceAlong(path, run[0]),
        });
      }
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
    // Les deux bouts sont densifiés avant tout le reste : l'arrondi et le
    // facettage sont calculés dessus comme sur n'importe quelle ligne, donc le
    // museau garde le grain du corps de la haie au lieu d'être une calotte
    // lisse rapportée.
    const dense = hedgeNosePath(fine.length >= 2 ? fine : path, style.noseM);

    // Deux bruits composés, pas un seul : `hedgeModulation` reste la courbe
    // longue qui porte la silhouette au loin, `hedgeFacets` y superpose un
    // saut indépendant par ligne — c'est lui, combiné à l'ombrage plat de
    // `_applyLinear`, qui casse le tube de près.
    const modulation = hedgeModulation(dense, { offset, here, style });
    const facets = hedgeFacets(dense, style.salt);
    // Le bout arrondi vient **après** le facettage, et le multiplie : sinon un
    // tirage haut au ras de la pointe ressortirait de l'arrondi, et le bout
    // redeviendrait une coupe franche à un arbuste près.
    const nose = hedgeEndTaper(dense, style.noseM);
    const scaleUp = new Float32Array(dense.length);
    const scaleAcross = new Float32Array(dense.length);
    const lateral = new Float32Array(dense.length);
    for (let r = 0; r < dense.length; r++) {
      scaleUp[r] = modulation.up[r] * facets.up[r] * nose[r];
      scaleAcross[r] = modulation.across[r] * facets.across[r] * nose[r];
      // Le débattement latéral rentre lui aussi : à pleine amplitude, il ferait
      // partir la pointe de travers.
      lateral[r] = facets.lateral[r] * nose[r];
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
      lateralJitter: lateral,
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
   * Pose un muret de pierre sèche : un balayage facetté comme la haie
   * (`facetJitter`), plus discrètement, sur un tracé ré-échantillonné dont le
   * pas espace les arêtes.
   */
  _appendDryStoneWall(buffer, path, sampleElevation) {
    const fine = resamplePath(path, DRY_STONE_WALL_SAMPLE_M);
    const dense = fine.length >= 2 ? fine : [...path];
    // Le ré-échantillonnage s'arrête au dernier pas entier : sans ce bout, le
    // muret raccourcirait à chaque angle de parcelle et au portail.
    const end = path[path.length - 1];
    const last = dense[dense.length - 1];
    const tail = Math.hypot(end.x - last.x, end.z - last.z);
    const closing = { x: end.x, z: end.z, distance: last.distance + tail };
    if (tail > DRY_STONE_WALL_SAMPLE_M * 0.25) dense.push(closing);
    else if (tail > 0) dense[dense.length - 1] = closing;

    const grain = facetJitter(dense, DRY_STONE_WALL_SEED, this.specs.dryStoneWallGrain);
    appendProfile(buffer, {
      path: dense,
      profile: this.specs.profiles.dryStoneWall,
      sampleElevation,
      lift: -FURNITURE_SINK_M,
      closed: true,
      scaleUp: grain.up,
      scaleAcross: grain.across,
      lateralJitter: grain.lateral,
      smoothRadius: Math.round(6 / DRY_STONE_WALL_SAMPLE_M),
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
    {
      facing = 'along',
      scale = 1,
      onPlatform = false,
      offRoad = false,
      openGround = false,
      own = null,
      atKerb = false,
      level = LEVEL_GROUND,
    } = {}
  ) {
    // Perpendiculaire à gauche de la marche, comme partout ailleurs.
    const x = point.x + point.tz * offset;
    const z = point.z - point.tx * offset;
    // `atKerb` : mobilier de rive. Il a le droit d'être dans l'emprise de **sa**
    // chaussée — c'est sa place —, pas sur celle d'une autre ni dans un
    // carrefour (voir `_onOtherPavement`).
    if (atKerb && this._onOtherPavement(x, z, own, level)) return null;
    // `offRoad` ne concerne que ce qui pousse — un alignement d'arbres. Le
    // mobilier réglementaire, lui, est posé au ras de la rive, donc dans
    // l'emprise, et c'est sa place : une glissière hors de l'emprise ne
    // protège rien.
    if (offRoad && this._onRoad(x, z, own)) return null;
    // `openGround` : ce qui n'a pas de sens sous un couvert déjà planté. La
    // question se pose **là où l'objet se pose**, et non une fois pour toute
    // une portion — un point pris au milieu du tronçon rendu se déplace avec
    // l'observateur, et l'alignement apparaissait et disparaissait en roulant.
    if (openGround && !this._openGround(x, z)) return null;
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
    // ni sa hauteur (voir `furniture/parcels.js`). Absente, `_applyInstances`
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
    this.fauna = [];

    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.geometries = {};
    this.material.dispose();
    this.rotorMaterial.dispose();
    this.greenhouseMaterial.dispose();
    this._turbines = [];
    this.scene.remove(this.group);
  }
}
