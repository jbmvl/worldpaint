/*
 * index — la surface publique. Ce qui est exporté ici est un contrat stable ;
 * le reste de `src/` est cuisine interne, libre de bouger.
 */

// --- Monter un paysage ------------------------------------------------------
export { createWorld, World, DEFAULT_VIEW } from './world.js';
export { WorldComposer, WORLD_ATTRIBUTION, FAUNA_CROSS_AHEAD_M } from './worldComposer.js';

// --- Le vivant : déclencher un événement -------------------------------------
// `world.crossFauna({ kind, at, forward })` fait traverser une bête devant
// l'observateur. Le catalogue dit quelles espèces existent, et ce qu'elles
// savent faire (allures, famille, foulée).
export { FAUNA_KINDS, FAUNA_SPECIES } from './models/fauna/index.js';
export { DASH_SPAN_M } from './layers/faunaMotion.js';

// --- La direction artistique ------------------------------------------------
// Une application donne ses tranches à `createWorld({ theme })`.
export { defaultTheme } from './themes/default.js';
export { resolveTheme } from './themes/theme.js';

// --- Les pièces, pour qui veut monter le décor à la main --------------------
export { ElevationField, TERRARIUM_URL, DEM_TILE_PIXELS } from './core/elevationField.js';
export { VectorTileSource, coveringTiles, VECTOR_ZOOM } from './core/vectorTileSource.js';
export { SceneEnvironment, DEFAULT_SKY_PALETTE, SKY_RADIUS, SHADOW_LEAD_M, SHADOW_RADIUS_M, sunDirection } from './environment/sceneEnvironment.js';

// --- La météo ---------------------------------------------------------------
// Un état (change en cours de route), pas une direction artistique. `src/` ne
// fait aucune requête réseau : brancher un service météo est à l'application.
export { DEFAULT_WEATHER, PRECIPITATION_TYPES, resolveWeather } from './environment/weather.js';

// --- Géographie : passer de lng/lat aux mètres de la scène ------------------
export {
  lngLatToTile,
  lngToTileX,
  latToTileY,
  tileXToLng,
  tileYToLat,
  tileSizeMeters,
  createLocalFrame,
  bearingToYaw,
  lerpBearing,
  EARTH_RADIUS,
} from './core/tileMath.js';

// --- Mise au point : étiqueter ce qu'on regarde -----------------------------
export {
  collectSceneLabels,
  collectCropLabels,
  collectPlaceLabels,
  collectBuildingLabels,
  labelForForestType,
  labelForMeshName,
  LABEL_FAUNA,
  labelForPlace,
  sourceForMeshName,
  LABEL_RADIUS_M,
  LABEL_SOURCE_OSM,
  LABEL_SOURCE_GENERATED,
} from './inspect/objectLabels.js';
export { forestTypeAt } from './layers/vegetationLayer.js';

// --- Mise au point : isoler une valeur possible du vocabulaire de région ----
// Pas un pays, un mot : « à quoi ressemble `granite` », sans y rouler.
export { showcaseEntries, SHOWCASE_FIELDS } from './inspect/showcase.js';

// --- Mise au point : voir le réseau routier tel qu'il est compris -----------
// Rend des paires de points colorées, en mètres du repère local : à
// l'application d'en faire une géométrie de lignes. Voir `demo/main.js`.
export {
  collectRoadDebug,
  levelTint,
  ROAD_DEBUG_KINDS,
  ROAD_DEBUG_COLORS,
  ROAD_DEBUG_LIFT_M,
  ROAD_DEBUG_RADIUS_M,
} from './inspect/roadDebug.js';

// --- Les régions naturelles -------------------------------------------------
// Même question que le décor se pose : dans quel pays sommes-nous, à cette
// longitude et cette latitude. Pure, synchrone, sans réseau.
export { regionAt, regionById, MAX_REACH_KM } from './core/region.js';
export { REGIONS } from './core/regions.js';
export {
  MATRIX_KINDS,
  STONE_KINDS,
  BUILDING_KINDS,
  FARMING_KINDS,
  TREE_KINDS,
  VOCABULARIES,
} from './core/regionInterpretation.js';

// Hauteur dont la chaussée est décollée du terrain — à appliquer à tout objet
// posé sur la route par l'application, sous peine de s'enfoncer dans le bitume.
export { ROAD_LIFT_M } from './layers/roadNetwork.js';

// L'emprise routière (chaussée + accotement excavé), pour qu'une application
// pose ses propres objets à la même frontière que l'herbe, les haies et les
// jardins. `inCorridor(world.composer.roads.index, x, z)` est la question complète.
export {
  CORRIDOR_MARGIN_M,
  inCorridor,
  clipOutsideCorridor,
  pushOutsideCorridor,
} from './layers/roadCorridor.js';

// Le halo des lampadaires, pour qu'une application ajoutant ses propres
// sources lumineuses les fasse de la même matière.
export { createGlowGeometry, createGlowMaterial } from './layers/furnitureKit.js';
export { srgb } from './core/color.js';

// Le catalogue de formes isolées (mobilier, arbres de crête…), pour qui veut
// poser un objet du décor sans passer par une couche entière — voir l'afficheur.
export { createFurnitureGeometries, createFurnitureMaterial } from './layers/furnitureKit.js';
