/*
 * index — la surface publique.
 * -----------------------------
 * Ce fichier est un contrat : ce qu'on y trouve, une application peut s'en
 * servir et compter dessus. Le reste de `src/` est de la cuisine interne, libre
 * de bouger d'une version à l'autre.
 *
 * Il est court volontairement. Une bibliothèque qui ré-exporte ses trois cents
 * symboles n'a plus d'intérieur, et ne peut plus rien changer.
 */

// --- Monter un paysage ------------------------------------------------------
export { createWorld, World, DEFAULT_VIEW } from './world.js';
export { WorldComposer, WORLD_ATTRIBUTION } from './worldComposer.js';

// --- La direction artistique ------------------------------------------------
/*
 * Tout ce qui décide de l'apparence du décor, groupé. Une application en donne
 * ses propres tranches à `createWorld({ theme })` ; le thème résolu descend
 * jusqu'aux couches, et rien ne le retient ailleurs.
 */
export { defaultTheme } from './themes/default.js';
export { resolveTheme } from './themes/theme.js';

// --- Les pièces, pour qui veut monter le décor à la main --------------------
export { ElevationField, TERRARIUM_URL, DEM_TILE_PIXELS } from './core/elevationField.js';
export { VectorTileSource, coveringTiles, VECTOR_ZOOM } from './core/vectorTileSource.js';
export { SceneEnvironment, DEFAULT_SKY_PALETTE, SKY_RADIUS, SHADOW_LEAD_M, SHADOW_RADIUS_M, sunDirection } from './environment/sceneEnvironment.js';

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
  labelForForestType,
  labelForMeshName,
  LABEL_RADIUS_M,
} from './inspect/objectLabels.js';
export { forestTypeAt } from './layers/vegetationLayer.js';

/*
 * Hauteur dont la chaussée est décollée du terrain. Publiée parce qu'une
 * application qui pose son propre objet sur la route (un véhicule, un piéton)
 * doit le lever d'autant, sans quoi il s'enfonce dans le bitume.
 */
export { ROAD_LIFT_M } from './layers/roadNetwork.js';

/*
 * L'emprise routière : chaussée plus accotement excavé. Publiée pour la même
 * raison que `ROAD_LIFT_M` — une application qui pose ses propres objets dans
 * le décor (un arbre, un panneau, un piéton) doit pouvoir demander la même
 * frontière que celle que respectent l'herbe, les haies et les jardins, plutôt
 * que d'en réinventer une qui ne tomberait pas au même endroit.
 *
 * `inCorridor(world.composer.roads.index, x, z)` est la question complète.
 */
export { CORRIDOR_MARGIN_M, inCorridor, clipOutsideCorridor } from './layers/roadCorridor.js';

/*
 * Le halo des lampadaires. Publié parce qu'une application qui ajoute ses
 * propres sources lumineuses dans le décor doit pouvoir les faire de la même
 * matière : deux halos qui ne se ressemblent pas dans une même image se voient
 * plus qu'un halo imparfait.
 */
export { createGlowGeometry, createGlowMaterial } from './layers/furnitureKit.js';
export { srgb } from './core/color.js';
