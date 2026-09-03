/*
 * index — la surface publique. Ce qui est exporté ici est un contrat stable ;
 * le reste de `src/` est cuisine interne, libre de bouger.
 */

// --- Monter un paysage ------------------------------------------------------
export { createWorld, World, DEFAULT_VIEW } from './world.js';
export { WorldComposer, WORLD_ATTRIBUTION } from './worldComposer.js';

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
  labelForPlace,
  sourceForMeshName,
  LABEL_RADIUS_M,
  LABEL_SOURCE_OSM,
  LABEL_SOURCE_GENERATED,
} from './inspect/objectLabels.js';
export { forestTypeAt } from './layers/vegetationLayer.js';

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
