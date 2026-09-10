/*
 * Tests unitaires de la géométrie de la bulle 3D.
 * Aucune dépendance navigateur : `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  EARTH_CIRCUMFERENCE,
  lngToTileX,
  latToTileY,
  tileXToLng,
  tileYToLat,
  tileSizeMeters,
  createLocalFrame,
  decodeTerrarium,
  decodeTerrainRgb,
  tilesAround,
  fillTileUrl,
  bearingToYaw,
  lerpBearing,
} from '../src/core/tileMath.js';

import { ElevationField, DEM_TILE_PIXELS } from '../src/core/elevationField.js';
import {
  labelForMeshName,
  nearestInstance,
  nearestVertex,
  collectSceneLabels,
  clusterCropGrid,
  collectCropLabels,
  labelForPlace,
  collectPlaceLabels,
  collectBuildingLabels,
  sourceForMeshName,
  LABEL_BUILDING_PERSONALITY,
  LABEL_FURNITURE,
  LABEL_FAUNA,
  LABEL_ROADS,
  LABEL_CROPS,
  LABEL_SOURCE_OSM,
  LABEL_SOURCE_GENERATED,
} from '../src/inspect/objectLabels.js';
import {
  collectRoadDebug,
  levelTint,
  ROAD_DEBUG_COLORS,
} from '../src/inspect/roadDebug.js';
import {
  branchSection,
  branchYields,
  junctionArea,
  junctionBoundaryAt,
  junctionCentreDeck,
  junctionCorner,
  junctionDeckAt,
  junctionSurface,
  outlineDeckAt,
  junctionRibbonRuns,
  markJunctionRows,
  mergeParallelBranches,
  pointInOutline,
  JunctionAreas,
  JUNCTION_CORNER_MAX_M,
} from '../src/layers/roadJunctions.js';
import {
  absorbParallelLines,
  appendGapSurface,
  appendZebra,
  collectRoadGaps,
  curvesTowards,
  facingEdgeAt,
  gapIsSeam,
  gapLength,
  ABSORB_GAP_M,
  ZEBRA_PITCH_M,
} from '../src/layers/roadBundles.js';
import {
  edgeClearance,
  outwardSide,
  polylineLength,
  EDGE_REACH_M,
} from '../src/layers/roadEdges.js';
import {
  appendCrossing,
  appendMarkingBar,
  approachLane,
  appendMarkingLine,
  markingLinesFor,
  sectionAtDistance,
  appendMarkingSymbols,
  cycleGlyph,
  glyphBar,
  glyphRing,
  MARKING_BAR_M,
  MARKING_DASH_M,
  MARKING_SYMBOL_SPACING_M,
  MARKING_WIDTH_M,
  MOUTH_CROSSING_M,
} from '../src/layers/roadMarkings.js';
import {
  resamplePath,
  smoothColumns,
  createRibbonBuffer,
  appendRibbon,
  pathFrames,
  levelRow,
  createProfileBuffer,
  appendProfile,
  appendVariableWall,
  appendRockCut,
  flattenGrade,
} from '../src/layers/ribbonGeometry.js';
import {
  spacedAlongPath,
  isTileEdgeSegment,
  realBoundaryRuns,
  boundaryFurnitureFor,
  scatterFurnitureFor,
  WOOD_PILE_EDGE_MIN,
  forestGameFor,
  FOREST_GAME,
  DEFAULT_FOREST_GAME,
  FOREST_PREDATORS,
  DEFAULT_FOREST_PREDATORS,
  PREDATOR_ODDS,
  PREDATOR_MAX,
  FOREST_GAME_EMPTY_ODDS,
  FOREST_GAME_PER_HECTARE,
  herdFor,
  HERD_SHEEP_ODDS,
  DEFAULT_SHEEP_ODDS,
  cropFor,
  pickShare,
  CROP_MIXES,
  DEFAULT_CROP_MIX,
  ROW_CROPS,
  rockKindFor,
  signKindFor,
  pathCurvature,
  pathTurn,
  guardrailStyleFor,
  roadsideVergeFor,
  roadsideFurnitureFor,
  roadsideYaw,
  crossSlope,
  contiguousRuns,
  ringAreaMeters,
  pointInRing,
  scatterInRing,
  coatFor,
  positionSeed,
  randomAt,
} from '../src/layers/furniturePlacement.js';
import {
  Kit,
  createGlowMaterial,
  createFurnitureRotorMaterial,
  advanceFurnitureRotor,
  FURNITURE_BUILDERS,
  furnitureSpecsFor,
  lampArcAt,
  LAMP_ARC,
  LAMP_HEAD_HEIGHT_M,
  LAMP_HEAD_REACH_M,
  GREENHOUSE_BASE_LENGTH_M,
} from '../src/layers/furnitureKit.js';
import { tileBounds } from '../src/core/vectorTileSource.js';
import {
  roadStyleFor,
  isPedestrianWay,
  roadLines,
  clipToRadius,
  anchorDistances,
  collectRoadLines,
  ROAD_PROFILE_ORDER,
  ROAD_LIFT_M,
  collectRoadSegments,
  gradeAllowance,
  RoadNetwork,
  ROAD_GRADE_CUT_FLAT_M,
  ROAD_GRADE_CUT_STEEP_M,
  ROAD_GRADE_FILL_STEEP_M,
} from '../src/layers/roadNetwork.js';
import {
  mergeRoadLines,
  distanceToSegment,
  stitchPlatforms,
  RoadIndex,
  CombinedIndex,
  NODE_WELD_M,
  GRAFT_REACH_M,
  knownCoverage,
} from '../src/layers/roadGraph.js';
import {
  WORK_NONE,
  WORK_BRIDGE,
  WORK_TUNNEL,
  workCodeFor,
  workRuns,
  drawableRuns,
  resampleWorks,
  resampleLevels,
  roadLevelFor,
  LEVEL_GROUND,
  LEVEL_MIN,
  LEVEL_MAX,
  levelWorkSpans,
  bridgeFreeboardFor,
  BRIDGE_FREEBOARD_MIN_M,
  BRIDGE_CLEARANCE_M,
  BRIDGE_FREEBOARD_M,
} from '../src/layers/roadWorks.js';
import { BridgeLayer, deckProfile, vaultProfile } from '../src/layers/bridgeLayer.js';
import {
  CORRIDOR_MARGIN_M,
  CORRIDOR_PROBE_M,
  CORRIDOR_PUSH_CLEARANCE_M,
  inCorridor,
  clipOutsideCorridor,
  filterOutsideCorridor,
  pushOutsideCorridor,
  pushPointOutsideCorridor,
  clipPolygonOutsideCorridor,
} from '../src/layers/roadCorridor.js';
import { fittedGardenMargin, gardenOutlineClear } from '../src/layers/gardenLayer.js';
import {
  grassCellRing,
  grassEdgeFade,
  fillGrassCell,
  fringeOffset,
  GRASS_PER_CELL,
  GRASS_TUFT_STRIDE,
  GRASS_CELL_M,
  isFloweringVariant,
} from '../src/layers/groundCover.js';
import { coveringTiles } from '../src/core/vectorTileSource.js';
import {
  tileableValueNoise,
  fractalNoise,
  stretchToUnit,
  createEdgeNoiseCanvas,
} from '../src/materials/proceduralTextures.js';
import {
  buildingHeight,
  buildingMinHeight,
  ringSignedArea,
  ringCentroid,
  outerRings,
  BUILDING_DEFAULT_HEIGHT,
  BUILDING_MAX_HEIGHT,
  plinthTopFor,
  pushPanel,
  appendOpenings,
  PLINTH_HEIGHT_M,
  WINDOW_FRAME_M,
  SHUTTER_WIDTH_RATIO,
  buildingPersonalityFor,
  sortPersonalities,
  personalityLookFor,
  shopfrontTopFor,
  SHOPFRONT_HEIGHT_M,
  towerSide,
  towerRise,
  towerFoot,
  TOWER_SIDE_MIN_M,
  TOWER_SIDE_MAX_M,
  TOWER_RISE_MIN_M,
  TOWER_RISE_MAX_M,
} from '../src/layers/buildingLayer.js';
import {
  woodDensity,
  standTreesPerCell,
  lowStratumPart,
  standDraw,
  describeTree,
  standTypeFrom,
  forestTypeAt,
  variantsFor,
  understoryStrata,
  treeHeight,
  saplingHeight,
  thicketPerCell,
  thicketDensityFor,
  UNDERSTORY_REF,
  edgeLowPart,
  edgeCanopy,
  EDGE_CANOPY_DROP,
  foliageTint,
  thinPlacements,
  FOREST_PATCH_M,
  WOOD_SCORE_MIN,
  WOOD_DENSITY_CURVE,
  EMERGENT_SHARE,
  CLUMP_TINT_M,
  STAND_SLOTS,
  STAND_CANDIDATES,
  TREES_PER_CELL,
  THICKET_BANDS,
  THICKET_PER_HA,
  SAPLING_MIN_HEIGHT,
  BUSH_MIN_HEIGHT,
  BUSH_MAX_HEIGHT,
  coverBushesFor,
} from '../src/layers/vegetationLayer.js';
import { TREE_ESSENCES } from '../src/themes/default.js';
import {
  grassVariantFor,
  grassSampleFallback,
  grassBlockedByCrop,
  grassHeightFade,
  grassMassVariant,
  GRASS_BANDS,
  GRASS_RADIUS_M,
  GRASS_COUNT,
  GRASS_FADE_FROM,
  GRASS_HEIGHT_FADE_FLOOR,
  GRASS_GREEN_MIN,
  coverGrassFor,
  grassGreenFor,
  woodFloorFor,
  WOODLAND_FLOWER_MAX,
} from '../src/layers/groundCover.js';
import {
  cropCellRing,
  fillCropCell,
  cropEdgeFade,
  cropHeightFade,
  CROP_BANDS,
  CROP_PER_CELL,
  CROP_TUFT_STRIDE,
  CROP_CELL_M,
  CROP_RADIUS_M,
  CROP_FADE_FROM,
  CROP_HEIGHT_FADE_FLOOR,
  CROP_COUNT,
  CROP_MASS_SPREAD,
} from '../src/layers/cropLayer.js';
import { coverBandRing, coverBandFade, coverMassDensity } from '../src/layers/coverBands.js';
import { createFoliageMaterial } from '../src/materials/foliageMaterial.js';
import {
  atlasOffsets,
  createGrassAtlasCanvas,
  createCropAtlasCanvas,
  GRASS_ATLAS_COLS,
  GRASS_ATLAS_ROWS,
  GRASS_ATLAS_OFFSETS,
  CROP_ATLAS_COLS,
  CROP_ATLAS_ROWS,
  CROP_ATLAS_OFFSETS,
  CROP_VARIANTS,
  CROP_MASS_ASPECT,
} from '../src/materials/proceduralTextures.js';
import {
  townPaletteAt,
  worksStyleAt,
  buildingStyleAt,
  roofShapeFor,
  TOWN_PATCH_M,
  isHouse,
  SHUTTER_SHARE,
  HOUSE_MAX_HEIGHT_M,
  HOUSE_MAX_AREA_M2,
  pavementTone,
} from '../src/layers/townStyle.js';
import {
  picketOffsets,
  gardenCorners,
  isDetached,
  GARDEN_MARGIN_M,
  appendBush,
  GATE_WIDTH_M,
  GARDEN_CLEAR_M,
  PICKET_SPACING_M,
} from '../src/layers/gardenLayer.js';
import { orientedBox, roofTriangles, ringArea } from '../src/layers/roofGeometry.js';
import {
  trafficPhaseAt,
  TRAFFIC_CYCLE_S,
  SIGN_ITEMS,
  FurnitureLayer,
  LINEAR_KINDS,
  POINT_ITEMS,
  POI_CLEARANCE_M,
  FURNITURE_LIMITS,
  FARMSTEAD_MAX_HECTARES,
  FARMSTEAD_CLUSTER_RADIUS_M,
  FARMSTEAD_CLUSTER_MIN_BUILDINGS,
  GREENHOUSE_MIN_LENGTH_M,
  GREENHOUSE_MAX_LENGTH_M,
  GREENHOUSE_SPACING_M,
  isSettlementEdgeRun,
  SIGN_PLACE_NAME_MIN_GAP_M,
  ROCK_CUT_MIN_RISE_M,
} from '../src/layers/furnitureLayer.js';
import {
  HEDGE_STYLES,
  HEDGE_SAMPLE_M,
  HEDGE_NOSE_FLOOR,
  hedgeNearness,
  hedgeModulation,
  hedgeClumps,
  hedgeNosePath,
  hedgeEndTaper,
  hedgeNoseFactor,
  appendHedgeClump,
} from '../src/layers/hedgeGeometry.js';
import {
  TREE_ATLAS_OFFSETS,
  GRASS_VARIANTS,
  createTreeAtlasCanvas,
  createRoadCanvas,
} from '../src/materials/proceduralTextures.js';
import { snapToShadowTexels, sunDirection, SHADOW_RADIUS_M } from '../src/environment/shadowFrame.js';
import {
  railProfileFor,
  RAILWAY_GAUGE_HALF_M,
  RAILWAY_BALLAST_HALF_M,
} from '../src/layers/railwayLayer.js';
import { skyParameters, lightingFor, sunlightColor } from '../src/environment/skyModel.js';
import {
  climateAt,
  refineByRelief,
  filterByClimate,
  CLIMATE_FAMILIES,
  FAMILY_OF_KOPPEN,
  KOPPEN_CODES,
  GRID,
  MONTANE_ELEVATION_M,
  ALPINE_ELEVATION_M,
  soilWashFor,
} from '../src/core/climate.js';
import {
  surfaceFor,
  surfaceId,
  surfaceFromId,
  surfaceFill,
  surfaceSignature,
  SURFACE_SIGNATURES,
  repairSurfaceEdges,
  classPolygons,
  CLASS_SOURCE_LAYERS,
  SURFACE_KINDS,
  SURFACE_ID_STEP,
  WATER_ID,
  PAVEMENT_ID,
  waterwayStyleFor,
  isDrawableWater,
  GroundClassMap,
  CLASS_AREA_M,
  CLASS_PIXELS,
  SETTLED_GRASS,
  VEGETAL_SURFACES,
  WOOD_EDGE_REACH_M,
} from '../src/terrain/groundClassMap.js';
import {
  collectBuiltUpAreas,
  pointInAreas,
  ringsOf,
  FabricIndex,
  SETTLEMENT_PLACE_CLASSES,
  collectPlaceNames,
  collectUrbanGreens,
  nearestNamedPlace,
  UrbanMask,
  URBAN_GREEN_LANDUSE,
  URBAN_PLACE_RADIUS_M,
} from '../src/layers/settlement.js';
import {
  kerbQualifies,
  kerbProfile,
  pavementBand,
  walkWidthAt,
  STREET_PROFILES,
  STREET_FABRIC_MIN,
  STREET_FABRIC_RADIUS_M,
  STREET_MAX_CROSS_SLOPE,
  STREET_MIN_LENGTH_M,
  walkWidthFor,
  StreetLayer,
} from '../src/layers/streetLayer.js';
import { streetSurfaceAt } from '../src/layers/townStyle.js';
import { CROP_KINDS, CROP_ID_STEP, cropId, cropFromId } from '../src/layers/furniturePlacement.js';
import { cutElevationAt, ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../src/terrain/roadCut.js';
import { TerrainMaterialFactory } from '../src/terrain/terrainMaterial.js';
import { birdAt, createBirdGeometry } from '../src/layers/lifeLayer.js';
import {
  FAUNA_BUILDERS,
  FAUNA_KINDS,
  FAUNA_SPECIES,
  grazeAngleFor,
  createFaunaGeometries,
  createFaunaMaterial,
  GRAZE_TARGET_M,
  GRAZE_MAX_RAD,
} from '../src/models/fauna/index.js';
import {
  LIMB,
  LEGS,
  LIMB_ATTRIBUTE,
  MOTION_ATTRIBUTE,
  MOTION_SIZE,
} from '../src/models/animalKit.js';
import {
  behaviourFor,
  buildCircuit,
  faunaStateAt,
  FAUNA_BEHAVIOURS,
  FAUNA_REPERTOIRE,
  DEFAULT_REPERTOIRE,
  CROSS_ODDS,
  CROSS_SPAN_M,
  DASH_SPAN_M,
  HEAD_RAMP_S,
  TERRAIN_SAMPLE_M,
  CIRCUIT_MAX_STATIONS,
} from '../src/layers/faunaMotion.js';
import {
  FaunaLayer,
  boundMix,
  FAUNA_CROSSING_MAX,
  CROSSING_FORGET_M,
} from '../src/layers/faunaLayer.js';
import {
  windowGrid,
  windowDraw,
  shopfrontLayout,
  appendShopfront,
  appendShopSignBlade,
  shopfrontEmojiFor,
} from '../src/layers/buildingLayer.js';
import {
  fitLabelText,
  pushLabelQuad,
  labelFontPxForCellHeight,
  LABEL_PADDING_PX,
  LABEL_LINE_HEIGHT_RATIO,
} from '../src/materials/labelAtlas.js';
import {
  srgb,
} from '../src/core/color.js';

/** Les sections du thème par défaut, résolues une fois. */
const FURNITURE_SPECS = furnitureSpecsFor();
import {
  ROAD_PROFILES,
  FOREST_TYPES,
  CROP_LOOK,
  TERRAIN_LOOK,
  WOODLAND_FLOOR,
  TOWN_PALETTES,
  TREE_VARIANTS,
  ROOF_PITCH as DEFAULT_PITCH,
  WINDOW_LIT_SHARE,
  WINDOW_WIDTH_M,
  SHOPFRONT_EMOJI,
  SHOPFRONT_EMOJI_DEFAULT,
  defaultTheme,
} from '../src/themes/default.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

test('le méridien et l’équateur tombent au centre de la tuile du zoom 0', () => {
  close(lngToTileX(0, 0), 0.5, 1e-12, 'lngToTileX');
  close(latToTileY(0, 0), 0.5, 1e-12, 'latToTileY');
});

test('les conversions tuile ↔ géographique sont réciproques', () => {
  for (const [lng, lat] of [[2.35, 48.85], [-9.14, 38.72], [12.49, 41.89], [-74.0, 40.71]]) {
    const z = 15;
    close(tileXToLng(lngToTileX(lng, z), z), lng, 1e-9, 'longitude');
    close(tileYToLat(latToTileY(lat, z), z), lat, 1e-9, 'latitude');
  }
});

test('une tuile de zoom 0 couvre la circonférence terrestre à l’équateur', () => {
  close(tileSizeMeters(0, 0), EARTH_CIRCUMFERENCE, 1e-6, 'tileSizeMeters');
  // À 45°, le facteur de réduction est cos(45°).
  close(tileSizeMeters(0, 45), EARTH_CIRCUMFERENCE * Math.SQRT1_2, 1e-6, 'tileSizeMeters(45°)');
});

test('le repère local place son origine en (0, 0) et sait revenir en arrière', () => {
  const frame = createLocalFrame(2.35, 48.85, 15);
  const here = frame.toLocal(2.35, 48.85);
  close(here.x, 0, 1e-9, 'x origine');
  close(here.z, 0, 1e-9, 'z origine');

  const back = frame.toLngLat(1234, -567);
  const again = frame.toLocal(back.lng, back.lat);
  close(again.x, 1234, 1e-6, 'aller-retour x');
  close(again.z, -567, 1e-6, 'aller-retour z');
});

test('le repère local restitue de vraies distances métriques', () => {
  const lat = 45;
  const frame = createLocalFrame(0, lat, 15);
  // 0,001° de longitude à 45° ≈ 78,7 m au sol.
  const east = frame.toLocal(0.001, lat);
  close(east.x, 78.7, 0.5, 'un millième de degré vers l’est');
  close(east.z, 0, 1e-6, 'pas de dérive en z');

  // Vers le nord, z doit être négatif (l’axe z pointe au sud).
  const north = frame.toLocal(0, lat + 0.001);
  assert.ok(north.z < 0, 'le nord doit donner un z négatif');
  close(Math.abs(north.z), 111.2, 1.0, 'un millième de degré vers le nord');
});

test('les décodeurs d’altitude respectent leurs formats', () => {
  close(decodeTerrarium(128, 0, 0), 0, 1e-9, 'Terrarium niveau de la mer');
  close(decodeTerrarium(128, 100, 128), 100.5, 1e-9, 'Terrarium 100,5 m');
  close(decodeTerrainRgb(0, 0, 0), -10000, 1e-9, 'Terrain-RGB plancher');
  close(decodeTerrainRgb(1, 134, 160), 0, 1e-6, 'Terrain-RGB niveau de la mer');
});

test('le bloc de tuiles est complet, centré et trié du centre vers le bord', () => {
  const tiles = tilesAround(16638.4, 11550.7, 5, 15);
  assert.equal(tiles.length, 25);
  assert.equal(tiles[0].ring, 0);
  assert.equal(tiles[0].x, 16638);
  assert.equal(tiles[0].y, 11550);

  const perRing = tiles.reduce((acc, t) => ((acc[t.ring] = (acc[t.ring] || 0) + 1), acc), {});
  assert.deepEqual(perRing, { 0: 1, 1: 8, 2: 16 });

  // Trié : jamais un anneau plus proche après un anneau plus lointain.
  for (let i = 1; i < tiles.length; i++) {
    assert.ok(tiles[i].ring >= tiles[i - 1].ring, 'ordre de chargement');
  }
});

test('le bloc de tuiles enjambe l’antiméridien sans produire d’index négatif', () => {
  const z = 2; // 4 tuiles de large
  const tiles = tilesAround(0.5, 1.5, 3, z);
  assert.ok(tiles.every((t) => t.x >= 0 && t.x < 4), 'x reste dans le monde');
  assert.ok(tiles.some((t) => t.x === 3), 'la colonne à l’ouest boucle par l’est');
});

test('les gabarits d’URL gèrent {z}/{x}/{y} et le schéma TMS', () => {
  assert.equal(fillTileUrl('a/{z}/{x}/{y}.png', 3, 4, 5), 'a/3/4/5.png');
  // TMS : y inversé, 2^3 - 1 - 5 = 2
  assert.equal(fillTileUrl('a/{z}/{x}/{-y}.png', 3, 4, 5), 'a/3/4/2.png');
  // Sous-domaine choisi par (x + y) % n : ici 2 % 2 = 0.
  assert.equal(fillTileUrl('{s}.tiles/{z}.png', 1, 1, 1, ['a', 'b']), 'a.tiles/1.png');
  assert.equal(fillTileUrl('{s}.tiles/{z}.png', 1, 2, 1, ['a', 'b']), 'b.tiles/1.png');
});

test('le cap se convertit en rotation, nord et est compris', () => {
  close(bearingToYaw(0), 0, 1e-12, 'nord');
  close(bearingToYaw(90), -Math.PI / 2, 1e-12, 'est');
  // Vecteur « devant » = (-sin(yaw), 0, -cos(yaw)) : cap 90° doit pointer plein est.
  const yaw = bearingToYaw(90);
  close(-Math.sin(yaw), 1, 1e-12, 'composante est');
  close(-Math.cos(yaw), 0, 1e-12, 'composante nord');
});

test('l’interpolation de cap prend le chemin le plus court', () => {
  close(lerpBearing(350, 10, 0.5), 360, 1e-9, 'passage par le nord');
  close(lerpBearing(10, 350, 0.5), 0, 1e-9, 'retour par le nord');
  close(lerpBearing(0, 180, 0.5), 90, 1e-9, 'demi-tour');
});

// --- Champ d’altitude ------------------------------------------------------

/** Injecte une tuile synthétique dans le champ, sans réseau. */
function seed(field, x, y, fill) {
  const size = DEM_TILE_PIXELS;
  const data = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) data[j * size + i] = fill(i, j);
  }
  field.tiles.set(`${field.zoom}/${x}/${y}`, data);
}

test('l’échantillonnage est continu au travers d’une frontière de tuiles', () => {
  const field = new ElevationField({ zoom: 15 });
  // Rampe globale en x : l’altitude ne doit dépendre que de la position absolue.
  const ramp = (tileX) => (i) => (tileX * DEM_TILE_PIXELS + i) * 0.5;
  seed(field, 100, 50, ramp(100));
  seed(field, 101, 50, ramp(101));

  const border = 101; // frontière exacte entre les deux tuiles
  const left = field.sampleTile(border - 1e-9, 50.5);
  const right = field.sampleTile(border + 1e-9, 50.5);
  close(left, right, 1e-3, 'pas de marche à la couture');

  // Et la valeur suit bien la rampe : au pixel 128 de la tuile 100.
  const expected = (100 * DEM_TILE_PIXELS + 128) * 0.5;
  close(field.sampleTile(100 + 128.5 / DEM_TILE_PIXELS, 50.5), expected, 1e-3, 'valeur de la rampe');
});

test('un point sans tuile chargée retombe sur la valeur de repli', () => {
  const field = new ElevationField({ zoom: 15 });
  assert.equal(field.sampleTile(4000.5, 3000.5, -1), -1);
});

test('une tuile voisine manquante donne un plateau, pas une falaise', () => {
  const field = new ElevationField({ zoom: 15 });
  seed(field, 10, 10, () => 250);
  // Juste au-delà du bord est : la seule tuile connue vaut 250 partout.
  const outside = field.sampleTile(11 - 1e-6, 10.5);
  close(outside, 250, 1e-6, 'plateau au bord du bloc');
});

// --- Rubans ----------------------------------------------------------------

test('le ré-échantillonnage pose des points à pas constant', () => {
  const line = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
  const samples = resamplePath(line, 10);
  assert.equal(samples.length, 11);
  samples.forEach((s, i) => {
    close(s.x, i * 10, 1e-9, `abscisse ${i}`);
    close(s.z, 0, 1e-9, `ordonnée ${i}`);
    close(s.distance, i * 10, 1e-9, `distance ${i}`);
  });
});

test('le pas reste constant en traversant un sommet de la polyligne', () => {
  const corner = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }];
  const samples = resamplePath(corner, 10);
  assert.equal(samples.length, 7);
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    // Au passage du coin, la corde est plus courte que l’arc : on tolère l’écart.
    assert.ok(step <= 10 + 1e-9, `pas ${i} = ${step}`);
    close(samples[i].distance - samples[i - 1].distance, 10, 1e-9, `abscisse curviligne ${i}`);
  }
  close(samples[6].x, 30, 1e-9, 'fin en x');
  close(samples[6].z, 30, 1e-9, 'fin en z');
});

test('le ré-échantillonnage refuse les entrées dégénérées', () => {
  assert.deepEqual(resamplePath([], 10), []);
  assert.deepEqual(resamplePath([{ x: 0, z: 0 }], 10), []);
  assert.deepEqual(resamplePath([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0), []);
});

test('le lissage longitudinal écrête le bruit sans mélanger les colonnes', () => {
  const rows = 9;
  const cols = 3;
  const heights = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Colonne 0 à 0 m, colonne 1 à 100 m, colonne 2 à 200 m, plus un pic.
      heights[r * cols + c] = c * 100 + (r === 4 ? 50 : 0);
    }
  }
  smoothColumns(heights, rows, cols, 2);

  const at = (r, c) => heights[r * cols + c];
  // Le pic de 50 m est réparti sur cinq échantillons.
  close(at(4, 0), 10, 1e-4, 'pic écrêté');
  // Les colonnes restent séparées : aucune n’a récupéré l’altitude d’une voisine.
  close(at(0, 1) - at(0, 0), 100, 1e-4, 'écart entre colonnes 0 et 1');
  close(at(8, 2) - at(8, 1), 100, 1e-4, 'écart entre colonnes 1 et 2');
});

// --- Textures procédurales -------------------------------------------------

test('le bruit se répète sans couture', () => {
  const size = 8;
  const lattice = 4;
  const noise = tileableValueNoise(size, lattice, 1234);
  const at = (x, y) => noise[y * size + x];

  // Avec size=8 et lattice=4, l’échantillon 7 tombe pile entre le nœud 3 et le
  // nœud 0 : s’il vaut leur moyenne, c’est que la grille boucle bien.
  for (let y = 0; y < size; y++) {
    close(at(7, y), (at(6, y) + at(0, y)) / 2, 1e-6, `couture horizontale, ligne ${y}`);
  }
  for (let x = 0; x < size; x++) {
    close(at(x, 7), (at(x, 6) + at(x, 0)) / 2, 1e-6, `couture verticale, colonne ${x}`);
  }
});

test('le bruit fractal reste dans [0, 1] et ne dépend que de sa graine', () => {
  const a = fractalNoise(32, [4, 8, 16], 99);
  const b = fractalNoise(32, [4, 8, 16], 99);
  const c = fractalNoise(32, [4, 8, 16], 100);

  assert.deepEqual(Array.from(a), Array.from(b), 'même graine, même image');
  assert.notDeepEqual(Array.from(a), Array.from(c), 'graine différente, image différente');
  assert.ok(a.every((v) => v >= 0 && v <= 1), 'valeurs normalisées');
  // Et il varie vraiment : une image constante passerait les tests ci-dessus.
  assert.ok(Math.max(...a) - Math.min(...a) > 0.2, 'amplitude utile');
});

test('la nappe macro ne porte que des fréquences lentes', () => {
  // La variation macro et le choix des régions du relevé sans répétition
  // lisent la **même** texture, et les deux exigent qu'elle soit lente : une
  // couleur qui crépite au mètre, et deux relevés qui changent de région à
  // chaque pas, donc se mélangent partout et rendent le flou qu'on voulait
  // éviter. C'est le choix des octaves qui le garantit, rien d'autre.
  const size = 64;
  const macro = stretchToUnit(fractalNoise(size, [1, 2, 4], 40213));
  const grain = fractalNoise(size, [4, 8, 16, 32, 64], 40213);

  // Rugosité : le plus grand écart d'un texel au suivant, rapporté à
  // l'amplitude du champ. Le rapport à l'amplitude est ce qui rend les deux
  // comparables — la nappe est étirée, le grain non.
  const roughness = (field) => {
    let step = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const here = field[y * size + x];
        step = Math.max(step, Math.abs(field[y * size + ((x + 1) % size)] - here));
        step = Math.max(step, Math.abs(field[((y + 1) % size) * size + x] - here));
      }
    }
    return step / (Math.max(...field) - Math.min(...field));
  };

  assert.ok(
    roughness(macro) * 2 < roughness(grain),
    `nappe ${roughness(macro).toFixed(4)} contre grain ${roughness(grain).toFixed(4)}`
  );
  // Et elle occupe toute l'amplitude : sans l'étirement, trois octaves
  // moyennées n'en tiennent qu'un quart, et le réglage du thème ne voudrait
  // plus dire ce qu'il annonce.
  assert.equal(Math.min(...macro), 0);
  assert.equal(Math.max(...macro), 1);
});

test('l’étirement laisse un champ constant tranquille', () => {
  // Division par zéro, et surtout : une nappe plate est un cas légitime (une
  // seule octave sur une graine malchanceuse), pas une erreur.
  const flat = stretchToUnit(new Float32Array([0.4, 0.4, 0.4]));
  assert.deepEqual(Array.from(flat), Array.from(new Float32Array([0.4, 0.4, 0.4])));
});

// --- Végétation ------------------------------------------------------------

test('la part de boisé se convertit en densité, et zéro sous le seuil', () => {
  assert.equal(woodDensity(0), 0);
  assert.equal(woodDensity(WOOD_SCORE_MIN - 0.001), 0);
  assert.equal(woodDensity(1), 1, 'un bois plein donne la densité pleine');
  // La courbe creuse l’écart entre une lisière et un sous-bois : au milieu du
  // barème, on est loin de la moitié de la densité.
  const middling = woodDensity(0.65);
  assert.ok(middling > 0.4 && middling < 0.62, `score moyen → densité ${middling}`);
  close(
    middling,
    Math.pow((0.65 - WOOD_SCORE_MIN) / (1 - WOOD_SCORE_MIN), WOOD_DENSITY_CURVE),
    1e-12,
    'courbe de densité'
  );
});

test('le sous-bois se compte en plus des arbres, pas à leur place', () => {
  const clair = { density: 1, understory: 0 };
  const fourni = { density: 1, understory: 0.5 };
  assert.equal(standTreesPerCell(clair), TREES_PER_CELL);
  close(standTreesPerCell(fourni), TREES_PER_CELL * 1.5, 1e-9, 'sous-bois en plus');
  assert.equal(lowStratumPart(clair), 0);
  close(lowStratumPart(fourni), 1 / 3, 1e-9, 'part de strate basse');
  // Le peuplement le plus fourni du thème tient sous le plafond de candidats,
  // sans quoi une maille saturerait au lieu de suivre sa densité.
  const worst = Math.max(...FOREST_TYPES.map((type) => standTreesPerCell(type)));
  assert.ok(worst <= STAND_CANDIDATES, `${worst} arbres attendus pour ${STAND_CANDIDATES} candidats`);
});

test('les tirages d’un candidat sont indépendants les uns des autres', () => {
  const seed = 123456789;
  // Un tirage ne dépend que de son rang : lire le voisin ne le déplace pas.
  assert.equal(standDraw(seed, 7), standDraw(seed, 7));
  assert.notEqual(standDraw(seed, 7), standDraw(seed, 8));
  // Et la suite couvre l’intervalle sans se tasser d’un côté.
  let total = 0;
  const draws = 4000;
  for (let k = 0; k < draws; k++) {
    const v = standDraw(seed, k);
    assert.ok(v >= 0 && v < 1, `tirage hors bornes : ${v}`);
    total += v;
  }
  close(total / draws, 0.5, 0.02, 'moyenne des tirages');
});

test('écarter un arbre de la chaussée n’en déplace aucun autre', () => {
  // C’est l’invariant du semis, et le défaut qu’il corrige : avec une suite
  // parcourue dans l’ordre, le premier arbre refusé décalait tout le reste de
  // la tuile — le même bois ne se plantait pas deux fois pareil selon que la
  // route était connue ou non.
  const seed = 987654321;
  const type = { density: 1, understory: 0.2, minHeight: 8, maxHeight: 16, tint: [1, 1, 1] };
  const strata = understoryStrata(defaultTheme.trees, true);
  const sow = (rejected) => {
    const out = [];
    for (let i = 0; i < STAND_CANDIDATES; i++) {
      const base = i * STAND_SLOTS;
      if (standDraw(seed, base) >= 0.5) continue; // présence
      const x = standDraw(seed, base + 1);
      const z = standDraw(seed, base + 2);
      if (rejected(x, z)) continue; // « sur la chaussée »
      out.push({ x, z, ...describeTree({}, seed, base, type, 0.2, [1, 2], strata) });
    }
    return out;
  };

  const libre = sow(() => false);
  const coupe = sow((x) => x > 0.4 && x < 0.6);
  assert.ok(coupe.length < libre.length, 'la chaussée doit bien retirer des arbres');
  // Tout ce qui n’est pas sur la chaussée est identique, au même endroit, de la
  // même hauteur, de la même silhouette.
  const survivants = libre.filter((tree) => !(tree.x > 0.4 && tree.x < 0.6));
  assert.deepEqual(coupe, survivants, 'le reste du semis ne bouge pas');
});

test('les hauteurs se répartissent en strates, avec quelques dominants', () => {
  const type = { minHeight: 8, maxHeight: 16 };
  assert.equal(treeHeight(type, 0, 1), 8, 'le tirage nul donne la hauteur minimale');
  close(treeHeight(type, 1, 1), 16, 1e-9, 'le tirage plein donne la maximale');

  // La loi penche vers le bas : sans cela, un massif est une haie taillée.
  const draws = 400;
  let total = 0;
  for (let i = 0; i < draws; i++) total += treeHeight(type, (i + 0.5) / draws, 1);
  assert.ok(total / draws < 12, `moyenne ${total / draws} sous le milieu de la fourchette`);

  // Et quelques-uns dépassent la strate : ce sont eux qui donnent le relief.
  assert.ok(treeHeight(type, 1, 0) > 16, 'un dominant dépasse la hauteur du peuplement');
  assert.ok(EMERGENT_SHARE > 0 && EMERGENT_SHARE < 0.25, 'un dominant reste une exception');
});

test('une tige de sous-étage monte vers le peuplement sans l’atteindre', () => {
  const futaie = { minHeight: 12, maxHeight: 22 };
  assert.equal(saplingHeight(futaie, 0), SAPLING_MIN_HEIGHT);
  close(saplingHeight(futaie, 1), 12, 1e-9, 'elle s’arrête au bas du peuplement');
  for (let i = 0; i <= 20; i++) {
    const h = saplingHeight(futaie, i / 20);
    assert.ok(h >= SAPLING_MIN_HEIGHT && h <= futaie.minHeight, `hauteur de tige ${h}`);
  }
  // Un taillis est déjà bas : sa régénération ne doit pas se retrouver au-dessus.
  const taillis = { minHeight: 3.5, maxHeight: 7 };
  assert.ok(saplingHeight(taillis, 1) <= taillis.minHeight + 1e-9);
  // Et un peuplement plus bas que la tige minimale garde une fourchette utile.
  const nain = { minHeight: 1, maxHeight: 2 };
  assert.ok(saplingHeight(nain, 1) > saplingHeight(nain, 0), 'fourchette non nulle');

});

test('un candidat retenu est décrit par ses seuls tirages', () => {
  const seed = 24680;
  const type = { minHeight: 6, maxHeight: 12, density: 1, understory: 0.3 };
  const strata = understoryStrata(defaultTheme.trees, true);
  const a = describeTree({}, seed, 0, type, 0.3, [3, 4], strata);
  const b = describeTree({}, seed, 0, type, 0.3, [3, 4], strata);
  assert.deepEqual(a, b, 'même graine, même arbre');
  // La strate basse prend les plantes du tapis, la haute celles du peuplement.
  const bas = describeTree({}, seed, 0, type, 1, [3, 4], strata);
  const plante = strata.find((p) => p.variant === bas.variant);
  assert.ok(bas.low && plante, 'plante de strate basse');
  assert.ok(bas.height >= plante.min && bas.height <= plante.max, 'à sa taille à elle');
  assert.equal(bas.aspect, plante.aspect, 'et à son port');
  const haut = describeTree({}, seed, 0, type, 0, [3, 4], strata);
  assert.ok(!haut.low && [3, 4].includes(haut.variant), 'arbre du peuplement');
  // Le sous-étage tire dans la régénération, le peuplement dans les arbres faits.
  const tige = describeTree({}, seed, 0, type, 0, [3, 4], strata, true);
  assert.ok(tige.height <= type.minHeight, `tige de ${tige.height} m`);
  assert.ok(haut.height >= type.minHeight, `arbre fait de ${haut.height} m`);
});

test('le sous-étage se lit à deux échelles, et sa densité est celle d’un bois', () => {
  const [proche, lointaine] = THICKET_BANDS;
  assert.ok(lointaine.cell > proche.cell, 'la maille double avec la distance');
  assert.ok(lointaine.from < proche.to, 'les bandes se recouvrent, sinon un anneau nu');
  // Une maille demande ce que sa surface vaut : deux fois plus large, quatre
  // fois plus de tiges.
  close(
    thicketPerCell(1, lointaine.cell) / thicketPerCell(1, proche.cell),
    (lointaine.cell / proche.cell) ** 2,
    1e-9,
    'densité par surface'
  );
  close(thicketPerCell(1, 100), THICKET_PER_HA, 1e-9, 'un hectare de maille');
  // Et chaque bande peut porter ce qu’un bois ordinaire lui demande.
  for (const band of THICKET_BANDS) {
    assert.ok(
      thicketPerCell(1, band.cell) <= band.perCell,
      `bande de ${band.cell} m : ${thicketPerCell(1, band.cell)} tiges pour ${band.perCell} candidats`
    );
  }
});

test('le sous-étage suit la part de sous-bois du peuplement, pas seulement sa densité', () => {
  // Une futaie entretenue est dégagée au sol — c’est même ce qui la définit —
  // et doit se traverser à pied ; un taillis *est* son sous-bois. Sans ça, deux
  // bois également fournis en houppes se ressemblent au pied, ce qui est
  // justement là où on les traverse.
  const futaie = FOREST_TYPES.find((t) => t.name === 'futaie');
  const taillis = FOREST_TYPES.find((t) => t.name === 'taillis');
  assert.ok(
    thicketDensityFor(taillis) > thicketDensityFor(futaie) * 2,
    `taillis ${thicketDensityFor(taillis)} contre futaie ${thicketDensityFor(futaie)}`
  );
  // Le peuplement de référence vaut exactement sa densité de tiges : c’est ce
  // qui garde `THICKET_PER_HA` lisible comme le réglage du sous-étage.
  close(
    thicketDensityFor({ density: 1.4, understory: UNDERSTORY_REF }),
    1.4,
    1e-9,
    'peuplement de référence'
  );
  // Et une pinède dont l’aiguille étouffe tout reste claire au sol, malgré ses
  // houppes serrées.
  const pinede = FOREST_TYPES.find((t) => t.name === 'pinede');
  assert.ok(pinede.density > futaie.density, 'la pinède est la plus fournie en houppes');
  assert.ok(
    thicketDensityFor(pinede) < thicketDensityFor(taillis) * 0.5,
    'et pourtant dégagée au sol'
  );
});

test('le bord d’un bois est un ourlet : houppe basse, fourré épais', () => {
  // En plein bois, la lisière ne change rien du tout — c’est la condition pour
  // qu’elle ne soit pas un effet de bord déguisé en style.
  assert.equal(edgeLowPart(0.2, 0), 0.2);
  assert.equal(edgeCanopy(0), 1);

  // Au bord, la strate basse monte sans jamais dépasser un fourré plein, et la
  // houppe descend sans s’effondrer.
  const ourlet = edgeLowPart(0.2, 1);
  assert.ok(ourlet > 0.2 && ourlet < 1, `part de strate basse en lisière : ${ourlet}`);
  close(edgeCanopy(1), 1 - EDGE_CANOPY_DROP, 1e-9, 'hauteur en lisière');
  assert.ok(EDGE_CANOPY_DROP > 0 && EDGE_CANOPY_DROP < 0.5, 'un ourlet penche, il ne rampe pas');

  // Un taillis, déjà tout en strate basse, ne peut pas le devenir davantage.
  assert.equal(edgeLowPart(1, 1), 1);
  // Et l’effet est continu : à mi-lisière, à mi-chemin.
  close(edgeLowPart(0.2, 0.5), (0.2 + edgeLowPart(0.2, 1)) / 2, 1e-9, 'fondu de fourré');
  close(edgeCanopy(0.5), (1 + edgeCanopy(1)) / 2, 1e-9, 'fondu de houppe');
});

test('la strate basse porte sa taille, et le tapis du sol ne pousse que de près', () => {
  // De loin : les arbustes, et eux seuls — une fougère de 80 cm à un kilomètre
  // coûte une instance et ne se voit pas.
  const loin = understoryStrata();
  assert.deepEqual(loin.map((p) => p.variant), TREE_ESSENCES.bushy);
  for (const plant of loin) {
    assert.equal(plant.min, BUSH_MIN_HEIGHT, 'fourchette commune faute de taille déclarée');
    assert.equal(plant.max, BUSH_MAX_HEIGHT);
  }

  // De près, le tapis s’y ajoute, et chaque plante impose sa taille : une
  // fougère ne fait pas trois mètres.
  const pres = understoryStrata(defaultTheme.trees, true);
  assert.ok(pres.length > loin.length, 'le tapis vient en plus des arbustes');
  const tapis = pres.filter((p) => TREE_ESSENCES.undergrowth.includes(p.variant));
  assert.equal(tapis.length, TREE_ESSENCES.undergrowth.length);
  for (const plant of tapis) {
    const look = TREE_VARIANTS[plant.variant];
    assert.deepEqual([plant.min, plant.max], look.heightM, 'la taille vient de la plante');
    assert.ok(plant.max < BUSH_MAX_HEIGHT, `${look.kind} plus bas qu’un arbuste`);
    assert.ok(plant.min > 0.3, `${look.kind} : une plante, pas de l’herbe`);
    assert.ok(TREE_ATLAS_OFFSETS[plant.variant], `${look.kind} : case d’atlas présente`);
  }
  // Aucune de ces silhouettes n’est l’essence d’un peuplement : le tapis ne
  // pousse jamais à hauteur de houppe.
  for (const type of FOREST_TYPES) {
    for (const variant of variantsFor(type)) {
      assert.ok(!TREE_ESSENCES.undergrowth.includes(variant), `${type.name} tire dans le tapis`);
    }
  }

  // Et un thème sans strate basse rend quand même une case d’atlas valide.
  assert.equal(understoryStrata({}, true).length, 1);
});

test('la teinte d’un feuillage dérive par bosquet, et reste ancrée au lieu', () => {
  const hue = [0.92, 1, 0.86];
  const a = foliageTint(hue, 1200, -800, 1, 0.5);
  const b = foliageTint(hue, 1200 + 3, -800 - 4, 1, 0.5);
  assert.deepEqual(a, b, 'deux arbres du même bosquet portent le même vert de fond');

  // Deux bosquets éloignés ne portent pas le même : c’est tout l’objet.
  const greens = new Set();
  for (let i = 0; i < 30; i++) {
    greens.add(foliageTint(hue, i * CLUMP_TINT_M, 0, 1, 0.5).join(','));
  }
  assert.ok(greens.size > 20, `${greens.size} teintes de bosquet sur 30`);

  // La dérive est chaude-froide : rouge et bleu partent en sens contraires,
  // sinon on ne fait que monter et descendre la clarté.
  for (let i = 0; i < 30; i++) {
    const [r, , bl] = foliageTint([1, 1, 1], i * CLUMP_TINT_M, 500, 1, 0.5);
    close(r + bl, 2, 1e-9, 'la dérive ne déplace pas la moyenne');
  }

  // Les canaux restent dans une plage utilisable.
  const extreme = foliageTint([1.2, 1.2, 1.2], 400, 400, 1.12, 0.999);
  assert.ok(extreme.every((v) => v >= 0 && v <= 1.25), 'canaux bornés');
});

test('le plafond d’une tuile éclaircit le semis au lieu de le rogner', () => {
  const list = Array.from({ length: 1000 }, (_, i) => ({ i, thin: (i * 37) % 1000 / 1000 }));
  assert.equal(thinPlacements(list, 2000), list, 'sous le plafond, on ne touche à rien');

  const thinned = thinPlacements(list, 250);
  assert.ok(Math.abs(thinned.length - 250) <= 5, `${thinned.length} arbres gardés pour 250`);
  // L’éclaircie est répartie : chaque quart du semis garde un quart de ce qui
  // reste. C’est ce qui manquait quand on s’arrêtait de planter en route — le
  // sud d’une tuile restait nu au milieu d’un massif.
  for (let q = 0; q < 4; q++) {
    const kept = thinned.filter((v) => v.i >= q * 250 && v.i < (q + 1) * 250).length;
    assert.ok(Math.abs(kept - 62.5) <= 6, `quart ${q} : ${kept} points gardés`);
  }

  // Et surtout : elle tient sur le tirage de l’arbre, pas sur son rang. Retirer
  // les arbres tombés sur la chaussée ne rebat pas le semis de toute la tuile.
  const sansRoute = thinPlacements(list.filter((v) => v.i % 10 !== 3), 250);
  const gardes = new Set(thinned.filter((v) => v.i % 10 !== 3).map((v) => v.i));
  const communs = sansRoute.filter((v) => gardes.has(v.i)).length;
  assert.equal(communs, gardes.size, 'aucun arbre gardé ne disparaît parce qu’un autre est parti');
  assert.ok(sansRoute.length - communs <= 30, `${sansRoute.length - communs} arbres de rattrapage`);
});

// --- Bâti ------------------------------------------------------------------

test('la hauteur d’un bâtiment suit les attributs disponibles, dans l’ordre', () => {
  close(buildingHeight({ render_height: 12.5 }), 12.5, 1e-9, 'render_height');
  close(buildingHeight({ height: '9' }), 9, 1e-9, 'height en chaîne');
  close(buildingHeight({ 'building:levels': 4 }), 4 * 3.2, 1e-9, 'niveaux');
  // Priorité : une hauteur explicite l’emporte sur un nombre de niveaux.
  close(buildingHeight({ render_height: 20, 'building:levels': 2 }), 20, 1e-9, 'priorité');
  close(buildingHeight({}), BUILDING_DEFAULT_HEIGHT, 1e-9, 'sans attribut');
  // Données aberrantes : plafonnées, jamais propagées telles quelles.
  close(buildingHeight({ height: 99999 }), BUILDING_MAX_HEIGHT, 1e-9, 'plafond');
  close(buildingHeight({ height: -5 }), BUILDING_DEFAULT_HEIGHT, 1e-9, 'hauteur négative ignorée');
  close(buildingHeight({ height: 'quatre' }), BUILDING_DEFAULT_HEIGHT, 1e-9, 'hauteur illisible ignorée');
});

// Les couples `class | subclass` de ce bloc sont **relevés** sur les tuiles
// réellement servies (OpenFreeMap, schéma OpenMapTiles, z14), pas déduits du
// schéma : c'est exactement là qu'était la panne, la version précédente
// cherchant la boulangerie sous une classe qui n'existe pas.
test('la personnalité d’un bâtiment suit le point d’intérêt qui tombe dedans', () => {
  assert.equal(buildingPersonalityFor({ class: 'place_of_worship', subclass: 'christian' }), 'church');
  assert.equal(buildingPersonalityFor({ class: 'place_of_worship', subclass: 'jewish' }), 'church');
  assert.equal(buildingPersonalityFor({ class: 'place_of_worship', subclass: 'muslim' }), 'mosque');
  assert.equal(buildingPersonalityFor({ class: 'hospital', subclass: 'hospital' }), 'hospital');
  assert.equal(buildingPersonalityFor({ class: 'hospital', subclass: 'clinic' }), 'hospital');

  // La grande surface arrive sous deux classes différentes pour la même
  // silhouette : le centre commercial sous `shop`, le grand magasin et le
  // supermarché sous `grocery`. C'est la sous-classe qui tranche, pas la classe.
  assert.equal(buildingPersonalityFor({ class: 'shop', subclass: 'mall' }), 'retail');
  assert.equal(buildingPersonalityFor({ class: 'grocery', subclass: 'department_store' }), 'retail');
  assert.equal(buildingPersonalityFor({ class: 'grocery', subclass: 'supermarket' }), 'retail');

  // La boulangerie a sa propre classe : `class: 'shop'` ne l'a jamais portée.
  assert.equal(buildingPersonalityFor({ class: 'bakery', subclass: 'bakery' }), 'bakery');

  // Devanture générique : commerce, café, banque, coiffeur.
  assert.equal(buildingPersonalityFor({ class: 'shop', subclass: 'clothes' }), 'shop');
  assert.equal(buildingPersonalityFor({ class: 'grocery', subclass: 'greengrocer' }), 'shop');
  assert.equal(buildingPersonalityFor({ class: 'cafe', subclass: 'cafe' }), 'shop');
  assert.equal(buildingPersonalityFor({ class: 'bank', subclass: 'bank' }), 'shop');

  // Pas de façade sur rue : un cabinet, un bureau, une école n'en ont pas.
  assert.equal(buildingPersonalityFor({ class: 'doctors', subclass: 'doctors' }), null);
  assert.equal(buildingPersonalityFor({ class: 'office', subclass: 'lawyer' }), null);
  assert.equal(buildingPersonalityFor({ class: 'school', subclass: 'school' }), null);

  // Château, monument, tour : ce ne sont pas des personnalités de bâtiment —
  // ils restent du mobilier autonome (`furnitureLayer._poiItem`).
  assert.equal(buildingPersonalityFor({ class: 'castle', subclass: 'castle' }), null);
  assert.equal(buildingPersonalityFor({ class: 'monument', subclass: 'monument' }), null);
  assert.equal(buildingPersonalityFor({}), null);
});

test('le plafond des points d’intérêt tombe sur le lointain, pas sur le clocher', () => {
  const list = [];
  // Deux mille commerces tout près : dans l'ordre d'arrivée, ils mangeaient le
  // budget entier avant qu'une seule église soit vue.
  for (let i = 0; i < 2000; i++) list.push({ kind: 'shop', distance: 10 + i * 0.1 });
  list.push({ kind: 'church', distance: 1400 });
  list.push({ kind: 'hospital', distance: 900 });

  const kept = sortPersonalities(list, 50);
  assert.equal(kept.length, 50, 'le plafond est tenu');
  assert.equal(kept[0].kind, 'church', 'le clocher passe avant tout, même au bout de la bulle');
  assert.equal(kept[1].kind, 'hospital');
  assert.ok(
    kept.slice(2).every((p) => p.kind === 'shop'),
    'le reste du budget va aux commerces les plus proches'
  );
  // À rang égal, c'est la distance qui décide — jamais l'ordre des tuiles.
  assert.ok(kept[2].distance <= kept[3].distance);
  assert.equal(list.length, 2002, 'la liste d’entrée n’est pas modifiée');
});

test('l’habillage d’une personnalité ne remplace que ce qu’il nomme', () => {
  const church = personalityLookFor('church');
  assert.ok(church.spire, 'l’église porte un clocher');
  assert.equal(church.wall, null, 'et garde les murs de son bourg');
  assert.equal(church.shape, null, 'et la forme de toit de son bourg');

  const shop = personalityLookFor('shop');
  assert.ok(Array.isArray(shop.front), 'le commerce ne porte qu’une devanture');
  assert.equal(shop.wall, null, 'repeindre l’immeuble entier faisait virer tout un centre ancien');

  const hospital = personalityLookFor('hospital');
  assert.ok(Array.isArray(hospital.wall) && hospital.shape === 'flat');

  // La coupole se pose sur une terrasse : sans cette forme, elle flotterait
  // au-dessus d'un rampant.
  assert.equal(personalityLookFor('mosque').shape, 'flat');

  assert.equal(personalityLookFor(null), null);
  assert.equal(personalityLookFor('inconnu'), null);
  // Mémorisé sur la tranche de thème : deux lectures donnent le même objet.
  assert.equal(personalityLookFor('church'), church);
});

test('la devanture occupe la place du soubassement, pas le mur entier', () => {
  // Un immeuble ordinaire : le bandeau tient sur un niveau.
  const top = shopfrontTopFor(100, 0, 112);
  close(top - 100, SHOPFRONT_HEIGHT_M, 1e-9, 'un niveau');
  // Une échoppe basse : pas de bandeau du tout, il mangerait le mur.
  assert.equal(shopfrontTopFor(100, 0, 103.5), null, 'mur trop bas');
  // Sous un passage couvert, il n'y a pas de rez-de-chaussée à habiller.
  assert.equal(shopfrontTopFor(100, 4, 115), null, 'surplomb');
});

test('le clocher est dimensionné et posé sur le bâtiment qui le porte', () => {
  // `orientedBox` publie des demi-côtés : cette nef fait 10 m sur 30 m.
  const nef = { cx: 0, cz: 0, angle: 0, long: 15, short: 5, fill: 0.9 };
  const side = towerSide(nef);
  assert.ok(side > TOWER_SIDE_MIN_M && side < 2 * nef.short, 'plus étroit que la nef');
  assert.ok(towerRise(nef) >= TOWER_RISE_MIN_M && towerRise(nef) <= TOWER_RISE_MAX_M);

  // La chapelle et la collégiale n'ont pas la même tour : c'est tout l'objet
  // des proportions.
  const chapelle = { cx: 0, cz: 0, angle: 0, long: 4, short: 2.5, fill: 0.9 };
  const collegiale = { cx: 0, cz: 0, angle: 0, long: 40, short: 18, fill: 0.9 };
  assert.ok(towerSide(chapelle) < towerSide(collegiale), 'la tour suit l’empreinte');
  assert.ok(towerRise(chapelle) < towerRise(collegiale));
  // Bornée des deux côtés : ni mât ni allumette.
  assert.ok(towerSide(collegiale) <= TOWER_SIDE_MAX_M);

  // Le pied reste dans l'empreinte, décalé vers un bout du grand axe.
  const foot = towerFoot(nef, side);
  assert.ok(foot.x > 0 && foot.x + side / 2 <= nef.long, 'la tour ne déborde pas de la nef');
  close(foot.z, 0, 1e-9, 'centrée en travers');

  // Tournée avec le bâtiment : un quart de tour envoie le pied sur l'autre axe.
  const biais = { ...nef, angle: Math.PI / 2 };
  const tourne = towerFoot(biais, side);
  close(tourne.x, 0, 1e-9);
  assert.ok(tourne.z > 0, 'le pied suit le grand axe, pas l’axe du monde');
});

test('le dessous du bâtiment vaut zéro sauf mention contraire', () => {
  close(buildingMinHeight({}), 0, 1e-9, 'défaut');
  close(buildingMinHeight({ render_min_height: 4 }), 4, 1e-9, 'passage couvert');
  close(buildingMinHeight({ min_height: -2 }), 0, 1e-9, 'valeur absurde');
});

test('le sens de parcours d’une empreinte est détecté', () => {
  const ccw = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const cw = ccw.slice().reverse();
  assert.ok(ringSignedArea(ccw) > 0, 'sens direct');
  assert.ok(ringSignedArea(cw) < 0, 'sens rétrograde');
  close(Math.abs(ringSignedArea(ccw)), 1, 1e-9, 'aire unitaire');
});

test('le centre d’une empreinte ignore le point de fermeture répété', () => {
  const open = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const closed = [...open, [0, 0]];
  assert.deepEqual(ringCentroid(open), [1, 1]);
  // Sans cette précaution, le premier sommet compterait double.
  assert.deepEqual(ringCentroid(closed), [1, 1]);
});

test('seuls les anneaux extérieurs sont extrudés', () => {
  const outer = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]];
  assert.deepEqual(outerRings({ type: 'Polygon', coordinates: [outer, hole] }), [outer]);
  assert.deepEqual(
    outerRings({ type: 'MultiPolygon', coordinates: [[outer, hole], [hole]] }),
    [outer, hole]
  );
  assert.deepEqual(outerRings({ type: 'LineString', coordinates: outer }), []);
  assert.deepEqual(outerRings(null), []);
});

// --- Ruban de chaussée -----------------------------------------------------

test('un ruban droit est plaqué à plat, avec les bonnes coordonnées de texture', () => {
  const buffer = createRibbonBuffer();
  const path = resamplePath([{ x: 0, z: 0 }, { x: 24, z: 0 }], 6);
  const added = appendRibbon(buffer, {
    path,
    halfWidth: 4,
    sampleElevation: () => 100,
    lift: 0.2,
    textureLength: 12,
    columns: 5,
  });

  assert.ok(added);
  assert.equal(buffer.positions.length / 3, path.length * 5, 'un sommet par ligne et par colonne');
  assert.equal(buffer.indices.length, (path.length - 1) * 4 * 6, 'deux triangles par maille');

  // Terrain plat à 100 m, décollement de 20 cm.
  for (let i = 1; i < buffer.positions.length; i += 3) {
    close(buffer.positions[i], 100.2, 1e-4, 'altitude du ruban');
  }
  // La route va vers +x (est) ; sa largeur se déploie en z. La perpendiculaire
  // pointe à gauche (-z = nord), et la première colonne porte l’offset négatif,
  // donc u = 0 tombe côté sud. La section étant symétrique, le côté est sans
  // conséquence visuelle — mais il vaut mieux savoir lequel c’est.
  close(buffer.positions[2], 4, 1e-4, 'première colonne, côté sud');
  close(buffer.positions[4 * 3 + 2], -4, 1e-4, 'dernière colonne, côté nord');
  // u traverse la chaussée, v la parcourt en unités de longueur de texture.
  close(buffer.uvs[0], 0, 1e-9, 'u sur la première colonne');
  close(buffer.uvs[4 * 2], 1, 1e-9, 'u sur la dernière');
  close(buffer.uvs[5 * 2 + 1], 6 / 12, 1e-9, 'v après six mètres');
});

test('une plate-forme donnée se pose telle quelle : le ruban ne la relisse pas', () => {
  // Au sommet d'une côte, une seconde moyenne glissante faisait passer le ruban
  // sous le terrain entaillé à la cote de la plate-forme — celle-ci étant, elle,
  // lue telle quelle par le déblai, les bordures, le marquage et le mobilier.
  const buffer = createRibbonBuffer();
  const path = resamplePath([{ x: 0, z: 0 }, { x: 60, z: 0 }], 5);
  const platform = Float32Array.from(path, (p) => 100 - Math.abs(p.x - 30) * 0.05);

  appendRibbon(buffer, {
    path,
    halfWidth: 4,
    sampleElevation: () => 0,
    platform,
    lift: 0.1,
    columns: 5,
  });

  for (let r = 0; r < path.length; r++) {
    for (let c = 0; c < 5; c++) {
      close(
        buffer.positions[(r * 5 + c) * 3 + 1],
        platform[r] + 0.1,
        1e-4,
        `ligne ${r}, colonne ${c}`
      );
    }
  }
});

test('un ruban dégénéré ne produit rien', () => {
  const buffer = createRibbonBuffer();
  assert.equal(appendRibbon(buffer, { path: [], halfWidth: 3, sampleElevation: () => 0 }), false);
  assert.equal(buffer.positions.length, 0);
});

// --- Réseau routier --------------------------------------------------------

test('la classe OpenMapTiles choisit un profil de chaussée', () => {
  assert.equal(roadStyleFor({ class: 'motorway' }).profile, 'express');
  assert.equal(roadStyleFor({ class: 'primary' }).profile, 'major');
  assert.equal(roadStyleFor({ class: 'tertiary' }).profile, 'minor');
  assert.equal(roadStyleFor({ class: 'service' }).profile, 'lane');
  assert.equal(roadStyleFor({ class: 'primary' }).paved, true);
  assert.equal(roadStyleFor({ class: 'track' }).paved, false, 'un chemin n’est pas revêtu');
  // Un tunnel n’est plus écarté à la lecture : il reste dans le graphe (sinon
  // la route s’arrête net au pied de la colline) et porte son code d’ouvrage.
  // C’est le ruban qui saute ses lignes, voir `drawableRuns`.
  assert.equal(roadStyleFor({ class: 'primary', brunnel: 'tunnel' }).works, WORK_TUNNEL, 'tunnel signalé');
  assert.equal(roadStyleFor({ class: 'primary', brunnel: 'bridge' }).works, WORK_BRIDGE, 'pont signalé');
  assert.equal(roadStyleFor({ class: 'primary' }).works, WORK_NONE, 'route ordinaire');
  // Rails, transports guidés et lignes de ferry n’ont pas de revêtement.
  assert.equal(roadStyleFor({ class: 'rail' }), null);
  assert.equal(roadStyleFor({ class: 'ferry' }), null);
  assert.equal(roadStyleFor({}), null);
});

test('collectRoadLines ne dépend pas d’un receveur — forEachFeature appelle son callback nu', () => {
  const frame = createLocalFrame(2.35, 48.85, 15);
  // Reproduit l’appel réel : `VectorTileSource.forEachFeature` invoque son
  // callback sans `this` (`callback(geometry, properties, bounds)`, un simple
  // appel de fonction). Un `collectRoadLines` qui lirait `this.theme` au lieu
  // d’un paramètre planterait ici exactement comme il plantait en scène.
  const source = {
    forEachFeature(sourceLayer, tiles, callback) {
      callback(
        { type: 'LineString', coordinates: [[2.35, 48.85], [2.351, 48.851]] },
        { class: 'primary' }
      );
    },
  };
  const lines = collectRoadLines(source, [{ x: 0, y: 0 }], frame);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].profile, 'major');
});

test('la largeur du ruban est celle de la section dessinée', () => {
  // C’est l’invariant qui empêche le marquage de s’étirer : une seule source
  // de vérité pour la texture et pour la géométrie.
  for (const [key, profile] of Object.entries(ROAD_PROFILES)) {
    const style = roadStyleFor({ class: classForProfile(key) });
    assert.ok(style, `une classe mène au profil ${key}`);
    close(ROAD_PROFILES[style.profile].width / 2, style.halfWidth, 1e-9, key);
    assert.ok(profile.width > 0);
  }
});

test('la hiérarchie des profils descend par retraits successifs', () => {
  const { express, major, minor, lane } = ROAD_PROFILES;
  assert.ok(express.shoulder > 0, 'la grosse route garde son accotement en terre');
  assert.equal(major.shoulder, 0, 'la route moyenne perd l’accotement');
  assert.equal(major.centerDash, true);
  assert.equal(minor.centerDash, false, 'la petite route perd l’axe central');
  assert.equal(minor.edgeLines, true);
  assert.equal(lane.edgeLines, false, 'une desserte n’a aucun marquage');
  // Les largeurs sont strictement décroissantes le long de la hiérarchie.
  for (let i = 1; i < ROAD_PROFILE_ORDER.length; i++) {
    const wide = ROAD_PROFILES[ROAD_PROFILE_ORDER[i - 1]].width;
    const narrow = ROAD_PROFILES[ROAD_PROFILE_ORDER[i]].width;
    assert.ok(wide > narrow, `${ROAD_PROFILE_ORDER[i - 1]} plus large que ${ROAD_PROFILE_ORDER[i]}`);
  }
});

test('toutes les chaussées se décollent d’autant : le carrefour n’est plus un empilement', () => {
  // La hiérarchie de décollement (deux centimètres par rang) n'existait que
  // pour départager deux rubans qui se recouvraient à un carrefour. Ils ne se
  // recouvrent plus : `roadJunctions` leur donne une surface commune, et une
  // bouche de petite rue doit affleurer cette surface, pas passer dessous.
  assert.ok(ROAD_LIFT_M > 0, 'aucun ruban ne repasse sous le terrain');
});

test('la sous-classe sépare piste cyclable, sentier et escalier', () => {
  // Le schéma range les trois sous la même classe `path`.
  assert.equal(roadStyleFor({ class: 'path', subclass: 'cycleway' }).profile, 'cycleway');
  assert.equal(roadStyleFor({ class: 'path', bicycle: 'designated' }).profile, 'cycleway');
  assert.equal(roadStyleFor({ class: 'path', subclass: 'footway' }).profile, 'path');
  assert.equal(roadStyleFor({ class: 'path', subclass: 'steps' }), null, 'un escalier n’est pas un ruban');
});

/** Une classe menant à chaque profil, pour le test d’invariant. */
function classForProfile(profile) {
  return {
    express: 'motorway',
    major: 'primary',
    minor: 'tertiary',
    lane: 'service',
    cycleway: 'cycleway',
    track: 'track',
    path: 'path',
  }[profile];
}

test('les polylignes sont extraites des deux formes de géométrie', () => {
  const line = [[0, 0], [1, 1]];
  assert.deepEqual(roadLines({ type: 'LineString', coordinates: line }), [line]);
  assert.deepEqual(roadLines({ type: 'MultiLineString', coordinates: [line, line] }), [line, line]);
  assert.deepEqual(roadLines({ type: 'Polygon', coordinates: [line] }), []);
  assert.deepEqual(roadLines(null), []);
});

test('une chaussée traversant la bulle est coupée, pas rejetée', () => {
  // Ligne droite de -100 à +100, disque de rayon 50 centré sur l’origine.
  const points = [];
  for (let x = -100; x <= 100; x += 10) points.push({ x, z: 0 });
  const runs = clipToRadius(points, 0, 0, 50);

  assert.equal(runs.length, 1, 'un seul tronçon contigu');
  const run = runs[0].points;
  // Un point de part et d’autre est conservé, sinon le ruban se terminerait
  // pile sur la frontière du disque — bord franc bien visible.
  assert.ok(run[0].x <= -50, `début en dehors : ${run[0].x}`);
  assert.ok(run[run.length - 1].x >= 50, `fin en dehors : ${run[run.length - 1].x}`);
});

test('un tronçon découpé sait à quelle distance de l’origine il commence', () => {
  // Ligne droite de 0 à 400 par pas de 10, disque de rayon 50 centré en 300.
  const points = [];
  for (let x = 0; x <= 400; x += 10) points.push({ x, z: 0 });
  const [run] = clipToRadius(points, 300, 0, 50);

  // Sans cette distance, chaque reconstruction repartirait de zéro et toutes
  // les bornes glisseraient de quelques mètres, tous les 250 mètres parcourus.
  close(run.startDistance, run.points[0].x, 1e-9, 'distance d’origine du tronçon');
  close(run.startDistance, 240, 1e-9, 'le point conservé en amont est compté');
});

test('une chaussée entièrement hors de portée est écartée', () => {
  const points = [{ x: 900, z: 900 }, { x: 950, z: 950 }];
  assert.deepEqual(clipToRadius(points, 0, 0, 50), []);
});

test('une chaussée qui entre et ressort deux fois donne deux tronçons', () => {
  const points = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 200, z: 0 },
    { x: 300, z: 0 },
    { x: 400, z: 0 },
  ];
  // Deux zones proches : autour de 0 et autour de 400, avec un trou au milieu.
  const runs = clipToRadius(points, 0, 0, 50).concat(clipToRadius(points, 400, 0, 50));
  assert.equal(runs.length, 2);
});

// --- Chargement des tuiles vectorielles ------------------------------------

test('le bloc de la bulle est couvert par les tuiles du zoom inférieur', () => {
  // Bloc 5×5 au zoom 15 centré sur (100, 200) → tuiles 50..51 × 100..101 au 14.
  const tiles = coveringTiles(100, 200, 2, 15, 14);
  const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b);
  const ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
  assert.deepEqual(xs, [49, 50, 51]);
  assert.deepEqual(ys, [99, 100, 101]);
  assert.ok(tiles.every((t) => t.z === 14), 'toutes au zoom demandé');
});

test('un zoom cible égal ou supérieur ne change pas d’échelle', () => {
  const tiles = coveringTiles(10, 10, 1, 14, 14);
  assert.equal(tiles.length, 9);
  assert.ok(tiles.every((t) => t.z === 14));
  // Un zoom cible plus élevé est ramené au zoom d’origine, pas extrapolé.
  assert.deepEqual(coveringTiles(10, 10, 1, 14, 16), tiles);
});

// --- Ombres ----------------------------------------------------------------

test('le centre de la carte d’ombres tombe sur la grille de texels', () => {
  const sun = { x: 0.3, y: 0.8, z: -0.5 };
  const mapSize = 2048;
  const texel = (2 * SHADOW_RADIUS_M) / mapSize;

  // Base du repère de la lumière, reconstruite ici pour vérifier le résultat
  // dans le plan où le calage a lieu.
  const f = norm(sun);
  const right = norm(crossV({ x: 0, y: 1, z: 0 }, f));
  const up = crossV(f, right);

  for (const center of [{ x: 0, y: 0, z: 0 }, { x: 123.4567, y: 12.3, z: -98.7 }]) {
    const snapped = snapToShadowTexels(center, sun, SHADOW_RADIUS_M, mapSize);
    for (const [axis, label] of [[right, 'droite'], [up, 'haut']]) {
      const projection = dotV(snapped, axis) / texel;
      close(projection - Math.round(projection), 0, 1e-6, `multiple entier de texel (${label})`);
    }
    // Le déplacement reste inférieur à un texel : on cale, on ne dérive pas.
    assert.ok(Math.hypot(snapped.x - center.x, snapped.y - center.y, snapped.z - center.z) <= texel);
  }
});

test('le calage reste défini quand le soleil est au zénith', () => {
  // L’axe de référence vertical rendrait le produit vectoriel nul : le code
  // doit basculer sur un autre axe plutôt que de produire des NaN.
  const snapped = snapToShadowTexels({ x: 5, y: 0, z: 5 }, { x: 0, y: 1, z: 0 }, SHADOW_RADIUS_M, 2048);
  assert.ok(Number.isFinite(snapped.x) && Number.isFinite(snapped.y) && Number.isFinite(snapped.z));
});

test('un déplacement d’un texel entier translate le centre d’autant', () => {
  const sun = { x: 0.3, y: 0.8, z: -0.5 };
  const texel = (2 * SHADOW_RADIUS_M) / 2048;
  const right = norm(crossV({ x: 0, y: 1, z: 0 }, norm(sun)));

  const a = snapToShadowTexels({ x: 0, y: 0, z: 0 }, sun, SHADOW_RADIUS_M, 2048);
  const b = snapToShadowTexels(
    { x: right.x * texel, y: right.y * texel, z: right.z * texel },
    sun,
    SHADOW_RADIUS_M,
    2048
  );
  close(dotV(b, right) - dotV(a, right), texel, 1e-6, 'un texel, exactement');
});

test('le soleil est au-dessus de l’horizon à midi et dessous à minuit', () => {
  // Paris, 21 juin. SunCalc est déjà une dépendance du projet ; ce test vérifie
  // surtout notre conversion vers les axes de la scène.
  const midi = sunDirection(new Date('2026-06-21T12:00:00Z'), 48.85, 2.35);
  assert.ok(midi.y > 0.5, 'haut dans le ciel');
  close(Math.hypot(midi.x, midi.y, midi.z), 1, 1e-9, 'direction unitaire');

  const minuit = sunDirection(new Date('2026-06-21T00:00:00Z'), 48.85, 2.35);
  assert.ok(minuit.y < 0, 'sous l’horizon');
});

const dotV = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossV = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

// --- Eau --------------------------------------------------------------------

test('les cours d’eau souterrains et intermittents ne sont pas dessinés', () => {
  close(waterwayStyleFor({ class: 'river' }).halfWidth, 4.5, 1e-9, 'rivière');
  assert.ok(waterwayStyleFor({ class: 'stream' }));
  assert.equal(waterwayStyleFor({ class: 'river', brunnel: 'tunnel' }), null, 'busé');
  assert.equal(waterwayStyleFor({ class: 'river', intermittent: 1 }), null, 'à sec');
  assert.equal(waterwayStyleFor({ class: 'dam' }), null);
  assert.equal(waterwayStyleFor({}), null);

  assert.equal(isDrawableWater({ class: 'lake' }), true);
  assert.equal(isDrawableWater({ class: 'swimming_pool' }), false, 'pas de confettis dans les jardins');
  assert.equal(isDrawableWater({ class: 'lake', brunnel: 'tunnel' }), false);
});

test('l’eau est une matière du sol, et la dernière de la liste', () => {
  // L'ordre de `SURFACE_KINDS` est gravé : il est peint dans un canal et relu
  // par le shader. L'eau est en fin de liste pour cette raison.
  assert.equal(SURFACE_KINDS[WATER_ID - 1], 'water', 'l’identifiant désigne bien l’eau');
  assert.equal(WATER_ID, SURFACE_KINDS.length, 'en fin de liste, sans décaler les autres');

  // L'identifiant doit tenir dans un octet une fois multiplié par son pas,
  // sinon le canal saturerait et l'eau se relirait comme une autre matière.
  assert.ok(WATER_ID * SURFACE_ID_STEP <= 255, 'l’identifiant tient dans le canal');

  // Et rien ne pousse dans l'eau.
  assert.equal(coverBushesFor('water'), 0, 'aucun buisson dans l’eau');
});

// --- Ciel -------------------------------------------------------------------

test('l’atmosphère s’épaissit quand le soleil descend', () => {
  const midi = skyParameters(0.9);
  const rasant = skyParameters(0.02);

  // Soleil rasant : la lumière traverse bien plus d’air, le bleu est diffusé
  // hors du trajet et il ne reste que le rouge.
  assert.ok(rasant.turbidity > midi.turbidity, 'turbidité');
  assert.ok(rasant.rayleigh > midi.rayleigh, 'Rayleigh');
  assert.ok(rasant.mieCoefficient > midi.mieCoefficient, 'Mie');
  assert.ok(rasant.mieDirectionalG > midi.mieDirectionalG, 'halo resserré');

  // Monotone : pas d’inversion entre l’aube et le plein jour.
  let previous = Infinity;
  for (let y = 0; y <= 1; y += 0.05) {
    const t = skyParameters(y).turbidity;
    assert.ok(t <= previous + 1e-9, `turbidité décroissante à ${y.toFixed(2)}`);
    previous = t;
  }
});

test('la nuit est bleue et faible, pas noire', () => {
  const nuit = lightingFor(-0.4);
  assert.equal(nuit.night, true);
  assert.ok(nuit.sun > 0, 'une scène sans lumière serait illisible');
  assert.ok(nuit.ambient > 0);

  const [r, g, b] = sunlightColor(nuit.warmth, nuit.night);
  assert.ok(b > r, 'lueur froide');
});

test('la lumière directe rougit à l’horizon et blanchit au zénith', () => {
  const bas = lightingFor(0.02);
  const haut = lightingFor(0.9);
  assert.ok(bas.warmth > haut.warmth, 'chaleur');
  assert.ok(haut.sun > bas.sun, 'intensité');
  close(haut.warmth, 0, 1e-9, 'aucun rougissement au zénith');

  const rasant = sunlightColor(bas.warmth, false);
  const zenith = sunlightColor(haut.warmth, false);
  assert.ok(rasant[0] - rasant[2] > zenith[0] - zenith[2], 'écart rouge/bleu au couchant');
  close(zenith[0], zenith[1], 0.06, 'lumière presque neutre à midi');
});

// --- Climat -----------------------------------------------------------------

test('le climat d’un lieu est celui qu’on y trouve', () => {
  // Des points de contrôle plutôt qu’un échantillon : une erreur de projection
  // dans la lecture de la grille décale l’Europe entière, et ne se voit
  // autrement qu’à l’œil, sur un paysage qui a l’air « presque juste ».
  assert.deepEqual(climateAt(5.37, 43.3), { family: 'mediterranean', koppen: 'Csa' }, 'Marseille');
  assert.deepEqual(climateAt(-4.49, 48.39), { family: 'oceanic', koppen: 'Cfb' }, 'Brest');
  assert.deepEqual(climateAt(25.72, 66.5), { family: 'boreal', koppen: 'Dfc' }, 'Rovaniemi');
  assert.deepEqual(climateAt(-2.39, 37.05), { family: 'semiArid', koppen: 'BSk' }, 'Tabernas');
  assert.deepEqual(climateAt(-21.94, 64.15), { family: 'oceanicUpland', koppen: 'Cfc' }, 'Reykjavik');
  assert.equal(climateAt(27.56, 53.9).family, 'continental', 'Minsk');
  assert.equal(climateAt(7.75, 46.02).family, 'alpine', 'Zermatt');
});

test('hors de la fenêtre couverte, le climat se tait', () => {
  // `null` n’est pas une panne : c’est l’état dans lequel le décor se peint
  // comme il se peignait avant qu’un climat existe. Tout ce qui le lit doit
  // savoir s’en passer.
  assert.equal(climateAt(-74, 40.7), null, 'New York, hors grille');
  assert.equal(climateAt(2.35, 12), null, 'sous le bord sud');
  assert.equal(climateAt(NaN, 48), null);
  assert.equal(climateAt(2.35, undefined), null);
  // En plein Atlantique, la recherche de proximité ne doit pas ramener une
  // côte à cinq cents kilomètres.
  assert.equal(climateAt(-18, 48), null, 'plein océan');
});

test('une côte garde son climat même quand la cellule tombe à l’eau', () => {
  // La côte réelle passe au milieu d’une cellule de dix kilomètres : sans la
  // recherche de proximité, le décor perdrait son climat par intermittence
  // tout le long d’un littoral, c’est-à-dire là où l’on roule le plus.
  for (const [nom, lng, lat] of [
    ['pointe du Raz', -4.73, 48.04],
    ['cap Corse', 9.36, 43.0],
    ['Sagres', -8.94, 37.01],
  ]) {
    assert.ok(climateAt(lng, lat)?.family, nom);
  }
});

test('un saut d’un pays à l’autre repose la question du climat', async () => {
  // Régression : le profil s'est longtemps mémorisé sur une ancre en mètres
  // locaux. Le repère se ré-ancre au-delà de vingt kilomètres, si bien qu'après
  // une téléportation l'observateur était de nouveau à l'origine — Paris et
  // Athènes se lisaient à la même distance de zéro, la garde tenait, et le
  // climat pris au premier décor ne bougeait plus. Toute mémoïsation ajoutée
  // ici doit repasser ce test.
  const { WorldComposer } = await import('../src/worldComposer.js');
  const composer = {
    bubble: { frame: { repere: 'Paris' }, surfaceElevationAtLocal: () => 40 },
    landscape: null,
    _reliefAt: WorldComposer.prototype._reliefAt,
  };
  const update = (...args) => WorldComposer.prototype._updateLandscape.apply(composer, args);

  assert.equal(update(2.35, 48.85, { x: 0, z: 0 }), true, 'premier décor');
  assert.equal(composer.landscape.climate.family, 'oceanic');

  // Même point local, autre repère : c'est une téléportation.
  composer.bubble.frame = { repere: 'Athènes' };
  assert.equal(update(23.72, 37.98, { x: 0, z: 0 }), true, 'la famille a changé');
  assert.equal(composer.landscape.climate.family, 'mediterranean');

  // Et rester au même endroit ne périme rien : c'est ce que lit `refresh`.
  assert.equal(update(23.72, 37.98, { x: 100, z: 0 }), false, 'même famille');
});

test('la correction de sol est toujours complète', () => {
  // Trois facteurs, toujours les trois : le shader, les touffes et les tiges
  // les lisent séparément, et une famille qui n'en décrirait que deux ferait
  // diverger celui qui manque.
  const complete = (wash) => {
    for (const key of ['grass', 'bare', 'farmland']) {
      assert.ok(Array.isArray(wash[key]) && wash[key].length === 3, key);
    }
  };

  complete(soilWashFor(null, defaultTheme.soils));
  complete(soilWashFor('climat-inconnu', defaultTheme.soils));
  // `alpine` ne décrit pas ses champs — il n'en a guère : le facteur manquant
  // doit valoir « pas de correction », pas `undefined`.
  const alpine = soilWashFor('alpine', defaultTheme.soils);
  complete(alpine);
  assert.deepEqual(alpine.farmland, [1, 1, 1]);
  assert.notDeepEqual(alpine.bare, [1, 1, 1], 'la roche claire, elle, est décrite');

  // Sans tranche de thème, tout est neutre : un thème d'avant les sols se
  // comporte comme avant.
  assert.deepEqual(soilWashFor('mediterranean', null), {
    grass: [1, 1, 1],
    bare: [1, 1, 1],
    farmland: [1, 1, 1],
    grassDensity: 1,
    grassHeight: 1,
  });
});

test('un pays sec éclaircit et jaunit son herbe', () => {
  // La seule propriété qu'on peut vérifier sans regarder : une herbe sèche
  // réfléchit plus qu'une herbe grasse, et son rouge monte plus vite que son
  // vert. C'est ce qui distingue « plus claire » de « plus jaune ».
  const oceanique = soilWashFor('oceanic', defaultTheme.soils).grass;
  assert.deepEqual(oceanique, [1, 1, 1], 'la référence n’est pas corrigée');

  for (const family of ['mediterranean', 'semiArid', 'arid']) {
    const { grass } = soilWashFor(family, defaultTheme.soils);
    assert.ok(grass[1] > 1, `${family} : plus clair`);
    assert.ok(grass[0] / grass[1] > 1.4, `${family} : plus jaune`);
  }

  // Et un pays froid va dans l'autre sens.
  const boreal = soilWashFor('boreal', defaultTheme.soils);
  assert.ok(boreal.grass[0] < 1 && boreal.bare[0] < 1, 'la taïga est sombre');
});

test('aucune correction de sol ne sature la touffe du premier plan', () => {
  // La couleur d'instance multiplie une texture déjà éclairée : au-delà d'un
  // facteur d'environ 3,5, le brin part au blanc alors que le sol, lui,
  // continue de foncer — c'est-à-dire exactement la divergence que tout ce
  // mécanisme existe pour éviter. Voir `SOIL_LOOK`.
  for (const [family, look] of Object.entries(defaultTheme.soils)) {
    for (const [key, factors] of Object.entries(look)) {
      if (!Array.isArray(factors)) continue;
      for (const value of factors) {
        assert.ok(value > 0 && value <= 3.5, `${family}.${key} = ${value}`);
      }
    }
  }
});

test('un pays sec laisse voir sa terre entre les touffes', () => {
  // C'est ce qui fait une steppe, et la couleur seule ne le fait pas : un sol
  // jauni couvert d'une prairie continue reste une prairie jaunie. La densité
  // doit donc décroître avec la sécheresse, et la hauteur avec elle.
  const densite = (family) => soilWashFor(family, defaultTheme.soils).grassDensity;
  assert.equal(densite('oceanic'), 1, 'la référence garde sa prairie');
  assert.ok(densite('mediterranean') < densite('oceanic'));
  assert.ok(densite('semiArid') < densite('mediterranean'));
  assert.ok(densite('arid') < densite('semiArid'));

  // Aucune famille ne va jusqu'à supprimer l'herbe : un sol nu partout se lit
  // comme un décor qui n'a pas fini de charger.
  for (const family of CLIMATE_FAMILIES) {
    const { grassDensity, grassHeight } = soilWashFor(family, defaultTheme.soils);
    assert.ok(grassDensity > 0 && grassDensity <= 1, `${family} densité`);
    assert.ok(grassHeight > 0.3 && grassHeight <= 1, `${family} hauteur`);
  }
});

test('une fleur garde sa couleur, l’herbe autour prend celle du pays', () => {
  const flowering = ['white', 'yellow', 'poppy', 'clumpWhite', 'clumpYellow', 'clumpPoppy'];
  for (const name of flowering) {
    assert.ok(isFloweringVariant(GRASS_VARIANTS.indexOf(name)), name);
  }
  for (const name of ['plain', 'clump', 'clumpAlt']) {
    assert.equal(isFloweringVariant(GRASS_VARIANTS.indexOf(name)), false, name);
  }
});

test('un climat imposé ne suit plus le lieu, et rien ne le corrige', async () => {
  // C'est le seul moyen de comparer deux pays sur le **même** terrain : mêmes
  // routes, mêmes parcelles, même relief, tout le reste changé. Se téléporter
  // change aussi le tracé et la pente, et on ne sait plus ce qui vient du
  // climat.
  const { WorldComposer } = await import('../src/worldComposer.js');
  const composer = {
    bubble: { frame: {}, surfaceElevationAtLocal: () => 1800 },
    landscape: null,
    climateOverride: null,
    _reliefAt: WorldComposer.prototype._reliefAt,
  };
  const update = () => WorldComposer.prototype._updateLandscape.call(composer, 2.35, 48.85, { x: 0, z: 0 });
  const setClimate = (f) => WorldComposer.prototype.setClimate.call(composer, f);

  update();
  // Paris à 1 800 m n'existe pas, mais le relief a le dernier mot : c'est ce
  // que la famille imposée devra contredire.
  assert.equal(composer.landscape.climate.family, 'alpine');

  assert.equal(setClimate('mediterranean'), true);
  assert.equal(setClimate('mediterranean'), false, 'idempotent');
  assert.equal(update(), true, 'la famille a changé');
  assert.equal(composer.landscape.climate.family, 'mediterranean');
  // Le code Köppen n'est plus rendu : il décrivait le lieu, qu'on vient
  // justement de cesser de suivre. Le donner quand même laisserait lire
  // « mediterranean (Cfb) », qui n'est vrai ni d'un côté ni de l'autre.
  assert.equal(composer.landscape.climate.koppen, null);

  assert.equal(setClimate(null), true);
  update();
  assert.equal(composer.landscape.climate.family, 'alpine', 'la géographie reprend la main');
  assert.equal(composer.landscape.climate.koppen, 'Cfb');
});

test('le relief corrige ce que Köppen ne peut pas dire', () => {
  // Innsbruck est classée comme Rennes : la classification dit vrai pour le
  // fond de vallée et faux pour tout ce qui le domine. Le MNT, lui, est au
  // mètre.
  assert.equal(refineByRelief('oceanic', { elevation: 300 }), 'oceanic');
  assert.equal(refineByRelief('oceanic', { elevation: ALPINE_ELEVATION_M }), 'alpine');
  assert.equal(refineByRelief('continental', { elevation: 1800 }), 'alpine');
  // Une montagne méditerranéenne n’est pas une montagne alpine : pin noir et
  // karst sec contre épicéa et alpage.
  assert.equal(
    refineByRelief('mediterranean', { elevation: MONTANE_ELEVATION_M }),
    'mediterraneanMontane'
  );
  assert.equal(refineByRelief('mediterraneanMontane', { elevation: 2500 }), 'mediterraneanMontane');
  assert.equal(refineByRelief('glacial', { elevation: 3000 }), 'glacial', 'rien au-dessus');
  // Sans relief connu, on ne corrige rien plutôt que de deviner.
  assert.equal(refineByRelief('oceanic', null), 'oceanic');
  assert.equal(refineByRelief('oceanic', { elevation: NaN }), 'oceanic');
  assert.equal(refineByRelief(null, { elevation: 3000 }), null);
});

test('la grille climatique et son vocabulaire tiennent ensemble', () => {
  // L’ordre de `KOPPEN_CODES` est l’encodage de la grille : le changer sans
  // refabriquer la grille repeint l’Espagne en Finlande.
  assert.equal(KOPPEN_CODES.length, 31);
  assert.equal(new Set(KOPPEN_CODES).size, KOPPEN_CODES.length, 'aucun code en double');
  assert.ok(KOPPEN_CODES.length <= 255, 'les codes tiennent dans un octet');
  // Toute famille annoncée doit être atteignable, et toute famille atteinte
  // doit être annoncée : une faute de frappe ici ne se verrait qu’au moment où
  // une région entière se peindrait avec le contenu par défaut.
  for (const [code, family] of Object.entries(FAMILY_OF_KOPPEN)) {
    assert.ok(KOPPEN_CODES.includes(code), `${code} est un code connu`);
    assert.ok(CLIMATE_FAMILIES.includes(family), `${family} est une famille connue`);
  }
  const reachable = new Set(Object.values(FAMILY_OF_KOPPEN));
  for (const family of CLIMATE_FAMILIES) {
    assert.ok(reachable.has(family), `${family} est atteignable depuis un code Köppen`);
  }
  assert.equal(GRID.cols * GRID.step, 70, 'la fenêtre couvre l’Europe en longitude');
  assert.equal(GRID.rows * GRID.step, 38, 'et en latitude');
});

// --- Occupation du sol ------------------------------------------------------

test('les couches vectorielles décrivent la matière du sol', () => {
  // Une seule fonction, là où il en fallait deux : `groundClassFor` disait la
  // matière grossière et `coverFor` la précisait quand elle savait, si bien
  // qu'un `landcover.class = 'sand'` devait d'abord se déclarer « sol nu »
  // pour ensuite se corriger en « sable ». Il dit « sable » du premier coup.
  assert.equal(surfaceFor('landcover', { class: 'wood' }), 'wood');
  assert.equal(surfaceFor('landcover', { class: 'grass' }), 'grass');
  assert.equal(surfaceFor('landcover', { class: 'farmland' }), 'farmland');
  assert.equal(surfaceFor('landcover', { class: 'wetland' }), 'wetland');
  assert.equal(surfaceFor('landcover', { class: 'sand' }), 'sand');
  assert.equal(surfaceFor('landcover', { class: 'rock' }), 'rock');
  assert.equal(surfaceFor('landcover', { subclass: 'glacier' }), 'bare');

  // Ce que les tuiles portent déjà : une lande, un maquis et une prairie sont
  // trois `class: grass`, et c'est la sous-classe qui les sépare.
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'heath' }), 'heath');
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'scrub' }), 'scrub');
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'fell' }), 'alpine');
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'tundra' }), 'alpine');
  assert.equal(surfaceFor('landcover', { class: 'wetland', subclass: 'bog' }), 'wetland');
  assert.equal(surfaceFor('landcover', { class: 'sand', subclass: 'dune' }), 'sand');
  // Un éboulis n'est pas une dalle : l'un est une pente qui bouge, l'autre un plateau.
  assert.equal(surfaceFor('landcover', { class: 'rock', subclass: 'scree' }), 'scree');
  assert.equal(surfaceFor('landcover', { class: 'rock', subclass: 'bare_rock' }), 'rock');
  // Une prairie ordinaire reste de l'herbe : la sous-classe ne dit rien de plus.
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'meadow' }), 'grass');

  // Un quartier d'habitation n'est pas une surface minérale : c'est un
  // périmètre, majoritairement vert, dont le minéral se compose le long des
  // rues. Une zone d'activité, elle, l'est réellement.
  assert.equal(surfaceFor('landuse', { class: 'residential' }), 'settled');
  assert.equal(surfaceFor('landuse', { class: 'suburb' }), 'settled');
  assert.equal(surfaceFor('landuse', { class: 'industrial' }), 'bare');
  assert.equal(surfaceFor('landuse', { class: 'retail' }), 'bare');
  assert.equal(surfaceFor('landuse', { class: 'quarry' }), 'bare');
  assert.equal(surfaceFor('landuse', { class: 'cemetery' }), 'grass');

  // La couche `park` ne peint rien, et le nom est le piège : au schéma
  // OpenMapTiles elle ne porte aucun parc de ville mais des **périmètres de
  // protection** — `boundary=protected_area`, `national_park`,
  // `leisure=nature_reserve`. Le parc de ville arrive par `landcover`, en
  // classe `grass`.
  assert.equal(surfaceFor('park', { class: 'national_park' }), null);
  assert.equal(surfaceFor('park', { class: 'protected_area' }), null);
  assert.equal(surfaceFor('park', { class: 'nature_reserve' }), null);
  assert.equal(surfaceFor('landcover', { class: 'grass', subclass: 'park' }), 'grass');
  assert.ok(!CLASS_SOURCE_LAYERS.includes('park'), 'la couche n’est plus parcourue du tout');

  // Ce qui ne décrit pas une surface ne doit rien peindre du tout.
  assert.equal(surfaceFor('landuse', { class: 'school' }), null);
  assert.equal(surfaceFor('landcover', { class: 'unknown' }), null);
  assert.equal(surfaceFor('transportation', { class: 'motorway' }), null);
  assert.equal(surfaceFor('landcover', {}), null);
});

test('l’identifiant de matière survit à l’aller-retour dans le canal rouge', () => {
  // L'identifiant est peint dans une image et relu par le shader comme par les
  // couches. Un décalage repeint une lande en éboulis, en silence.
  for (const kind of SURFACE_KINDS) {
    assert.equal(surfaceFromId(surfaceId(kind) * SURFACE_ID_STEP), kind, kind);
  }
  assert.equal(surfaceId(null), 0, 'zéro reste « la donnée se tait »');
  assert.equal(surfaceFromId(0), null);

  // Le pas doit tenir toutes les matières dans un octet, sinon la dernière
  // déborde et se relit comme rien du tout. Et il doit rester de la place :
  // pouvoir en ajouter sans rien réorganiser est le point de la fusion.
  assert.ok(SURFACE_KINDS.length * SURFACE_ID_STEP <= 255, 'les identifiants tiennent dans le canal');
  const room = Math.floor(255 / SURFACE_ID_STEP) - SURFACE_KINDS.length;
  assert.ok(room >= 10, `il reste de la place pour ${room} matières, il en faut au moins dix`);
});

test('un remplissage porte la matière et sa culture, dans le même texel', () => {
  // C'étaient deux tracés dans deux canevas, qui pouvaient diverger : une case
  // portait une matière ici et une couverture sans rapport là.
  const grass = surfaceId('grass');
  assert.equal(
    surfaceFill('grass'),
    `rgba(${grass * SURFACE_ID_STEP}, 0, ${surfaceSignature(grass)}, 1)`
  );
  assert.match(surfaceFill('farmland', 3), /^rgba\(\d+, \d+, \d+, 1\)$/);

  // Peindre une matière efface la culture qui était dessous, gratuitement.
  const wood = surfaceId('wood');
  assert.equal(
    surfaceFill('wood'),
    `rgba(${wood * SURFACE_ID_STEP}, 0, ${surfaceSignature(wood)}, 1)`,
    'le canal des cultures repart à zéro'
  );

  // L'alpha est toujours plein : le fond est peint, pas effacé. Un canevas
  // transparent ferait porter aux pixels de bord un alpha partiel, donc des
  // canaux prémultipliés, donc un identifiant divisé — relu comme une matière
  // sans rapport tout le long des lisières.
  for (const kind of [...SURFACE_KINDS, null]) {
    assert.ok(surfaceFill(kind).endsWith(', 1)'), `alpha plein pour ${kind}`);
  }
  assert.equal(surfaceFill(null), 'rgba(0, 0, 0, 1)', 'le fond porte l’identifiant zéro');
});

test('aucun mélange de deux matières ne peut se faire passer pour une troisième', () => {
  // Le défaut que la signature répare, et la seule raison qu'elle ait d'exister.
  //
  // Le canevas lisse le bord de ses tracés — rien ne le débraye — donc un texel
  // de bord porte `alpha x A + (1 - alpha) x B`. Sans signature, ce mélange se
  // relit comme un **troisième** identifiant : entre le bois et l'eau, c'est-à-
  // dire tout le long de chaque cours d'eau, la quasi-totalité de la rampe
  // tombe sur une matière absente du lieu (du sable, de la roche, du trottoir).
  const woodId = surfaceId('wood') * SURFACE_ID_STEP;
  const waterId = surfaceId('water') * SURFACE_ID_STEP;
  const invented = new Set();
  for (let k = 1; k < 100; k++) {
    const red = Math.round(woodId + (k / 100) * (waterId - woodId));
    const kind = surfaceFromId(red);
    if (kind && kind !== 'wood' && kind !== 'water') invented.add(kind);
  }
  assert.ok(invented.size >= 8, `le seul rouge en invente ${invented.size}`);

  // Avec la signature, plus aucune : pour contrefaire la matière C, il faudrait
  // que le rouge tombe sur celui de C **et** que le bleu tombe en même temps
  // sur sa signature. On balaie toutes les couvertures de toutes les paires.
  let forged = 0;
  let closest = Infinity;
  for (let a = 0; a <= SURFACE_KINDS.length; a++) {
    for (let b = 0; b <= SURFACE_KINDS.length; b++) {
      if (a === b) continue;
      for (let k = 0; k <= 2000; k++) {
        const share = k / 2000;
        const red = Math.round(a * SURFACE_ID_STEP + share * (b - a) * SURFACE_ID_STEP);
        if (red % SURFACE_ID_STEP !== 0) continue;
        const id = red / SURFACE_ID_STEP;
        if (id === a || id === b || id > SURFACE_KINDS.length) continue;
        const blue = Math.round(
          SURFACE_SIGNATURES[a] + share * (SURFACE_SIGNATURES[b] - SURFACE_SIGNATURES[a])
        );
        const gap = Math.abs(blue - SURFACE_SIGNATURES[id]);
        if (gap === 0) forged++;
        closest = Math.min(closest, gap);
      }
    }
  }
  assert.equal(forged, 0, 'aucune contrefaçon possible');
  // La marge doit dépasser l'arrondi du canevas, sinon la propriété ne tient
  // que sur le papier.
  assert.ok(closest >= 4, `il reste ${closest} d’écart au plus juste`);

  // Une signature par identifiant, fond compris, sinon la table se décale.
  assert.equal(SURFACE_SIGNATURES.length, SURFACE_KINDS.length + 1, 'une signature par matière');
  assert.equal(new Set(SURFACE_SIGNATURES).size, SURFACE_SIGNATURES.length, 'toutes distinctes');
  assert.equal(surfaceSignature(0), 0, 'le fond garde la signature zéro');
});

test('la réparation rend un texel de bord à la matière qui le couvre le plus', () => {
  const PIXELS = 4;
  const texel = (id, crop = 0) => [id * SURFACE_ID_STEP, crop * CROP_ID_STEP, surfaceSignature(id), 255];
  const build = (ids) => {
    const data = new Uint8ClampedArray(PIXELS * PIXELS * 4);
    ids.forEach((cell, p) => data.set(cell, p * 4));
    return data;
  };

  const wood = surfaceId('wood');
  const water = surfaceId('water');
  const cells = Array.from({ length: PIXELS * PIXELS }, () => texel(wood));

  // Une colonne d'eau, et entre les deux la colonne de bord que le canevas
  // aurait fabriquée : le mélange se relit aujourd'hui comme du sable ou de la
  // roche selon la couverture.
  for (let y = 0; y < PIXELS; y++) {
    cells[y * PIXELS + 3] = texel(water);
    const share = y < 2 ? 0.2 : 0.8; // couvert à 20 % puis à 80 % par l'eau
    const mixed = (from, to) => Math.round(from + share * (to - from));
    cells[y * PIXELS + 2] = [
      mixed(wood * SURFACE_ID_STEP, water * SURFACE_ID_STEP),
      0,
      mixed(surfaceSignature(wood), surfaceSignature(water)),
      255,
    ];
  }

  const data = build(cells);
  // Sans réparation, la colonne de bord porte n'importe quoi.
  assert.notEqual(surfaceFromId(data[(0 * PIXELS + 2) * 4]), 'wood');
  assert.notEqual(surfaceFromId(data[(0 * PIXELS + 2) * 4]), 'water');

  const repaired = repairSurfaceEdges(data, PIXELS);
  assert.equal(repaired, PIXELS, 'une colonne réparée, et elle seule');

  // Le rouge le plus proche **est** le seuil de couverture : sous la moitié le
  // texel revient au bois, au-dessus il passe à l'eau. La limite tombe donc au
  // bon demi-texel au lieu d'inventer une matière.
  assert.equal(surfaceFromId(data[(0 * PIXELS + 2) * 4]), 'wood', 'couvert à 20 %');
  assert.equal(surfaceFromId(data[(3 * PIXELS + 2) * 4]), 'water', 'couvert à 80 %');

  // Et après la passe, plus un seul texel qui ne porte sa signature : c'est la
  // propriété que le shader et la végétation lisent tous les deux.
  for (let p = 0; p < PIXELS * PIXELS; p++) {
    const id = data[p * 4] / SURFACE_ID_STEP;
    assert.equal(data[p * 4] % SURFACE_ID_STEP, 0, `texel ${p} : identifiant entier`);
    assert.equal(data[p * 4 + 2], surfaceSignature(id), `texel ${p} : signé`);
  }

  // Une carte déjà saine ne coûte rien et ne bouge pas.
  const clean = build(Array.from({ length: PIXELS * PIXELS }, () => texel(surfaceId('grass'), 2)));
  const before = clean.slice();
  assert.equal(repairSurfaceEdges(clean, PIXELS), 0, 'rien à réparer');
  assert.deepEqual(clean, before);
});

test('la table des matières décrit chaque matière, et répartit les champs de grain', () => {
  const surfaces = defaultTheme.surfaces;

  for (const kind of SURFACE_KINDS) {
    const look = surfaces[kind];
    assert.ok(look, `${kind} : une ligne dans la table`);
    assert.equal(look.albedo?.length, 3, `${kind} : un albédo linéaire`);
    assert.ok(
      look.albedo.every((v) => v >= 0 && v <= 1),
      `${kind} : l’albédo reste dans [0, 1]`
    );
    assert.ok(
      [0, 1, 2].includes(look.noiseField),
      `${kind} : un champ de bruit de lisière parmi trois`
    );
  }

  // La table ne décrit **que** des matières de la liste : une ligne orpheline
  // est du réglage qui ne sert jamais, et qu'on croit pourtant régler.
  for (const kind of Object.keys(surfaces)) {
    assert.ok(SURFACE_KINDS.includes(kind), `${kind} : une matière qui existe`);
  }

  // Deux matières rangées côte à côte se touchent souvent dans le monde (c'est
  // le critère de l'ordre) : elles doivent prendre deux champs de bruit
  // différents, sans quoi leur lisière perd l'interpénétration et retombe sur
  // un fondu linéaire. L'eau est hors du mélange, son champ ne sert jamais.
  for (let i = 1; i < SURFACE_KINDS.length; i++) {
    const before = SURFACE_KINDS[i - 1];
    const here = SURFACE_KINDS[i];
    if (here === 'water' || before === 'water') continue;
    assert.notEqual(
      surfaces[before].noiseField,
      surfaces[here].noiseField,
      `${before} et ${here} se touchent : deux champs de bruit distincts`
    );
  }

  // Plus aucune matière n'a de texture : ni grain, ni ce qu'elle en gardait.
  for (const kind of SURFACE_KINDS) {
    assert.equal(surfaces[kind].grainKeep, undefined, `${kind} : plus de grain à garder`);
  }
});

test('la part d’une matière s’interpole, là où son identifiant ne le peut pas', () => {
  // Un identifiant ne se mélange pas — entre le sable et l'eau il n'y a rien —
  // mais l'appartenance à une matière, si. C'est ce que le filtrage linéaire
  // de la carte de poids donnait gratuitement, et qu'il faut reconstruire
  // depuis qu'il n'y a plus que des identifiants : sans ça une lisière de bois
  // répondrait « bois » ou « pas bois » au texel de 2,7 m, et les semis
  // s'aligneraient sur ce damier.
  const data = new Uint8ClampedArray(CLASS_PIXELS * CLASS_PIXELS * 4);
  const half = CLASS_PIXELS / 2;
  for (let z = 0; z < CLASS_PIXELS; z++) {
    for (let x = 0; x < CLASS_PIXELS; x++) {
      const i = (z * CLASS_PIXELS + x) * 4;
      data[i] = surfaceId(x < half ? 'wood' : 'grass') * SURFACE_ID_STEP;
      data[i + 3] = 255;
    }
  }

  const carte = Object.create(GroundClassMap.prototype);
  Object.assign(carte, { _data: data, origin: { x: 0, y: 0 }, size: CLASS_AREA_M });
  const perTexel = CLASS_AREA_M / CLASS_PIXELS;
  const boundary = half * perTexel;
  const share = (kind, x) => carte.shareOf(kind, x, CLASS_AREA_M / 2);

  // Au cœur de chaque moitié, la réponse est franche.
  assert.equal(share('wood', boundary - 50), 1, 'en plein bois');
  assert.equal(share('wood', boundary + 50), 0, 'en plein champ');
  assert.equal(share('grass', boundary + 50), 1);

  // Sur la limite, elle ne l'est pas : c'est une rampe d'un texel, pas une
  // marche. C'est exactement ce que le filtrage linéaire faisait.
  // La limite tombe à mi-chemin des deux centres de texel : moitié-moitié.
  const edge = share('wood', boundary);
  assert.ok(Math.abs(edge - 0.5) < 1e-9, `au milieu de la rampe : ${edge}`);
  const inside = share('wood', boundary - perTexel / 4);
  assert.ok(inside > 0.5 && inside < 1, `un quart avant la limite : ${inside}`);

  // Et la somme des parts vaut un partout où la carte dit quelque chose :
  // sinon les albédos se mélangeraient à un poids total faux, et le sol
  // s'assombrirait le long de chaque lisière.
  for (const offset of [-40, -perTexel, -perTexel / 3, 0, perTexel / 3, perTexel, 40]) {
    const total = share('wood', boundary + offset) + share('grass', boundary + offset);
    assert.ok(Math.abs(total - 1) < 1e-9, `somme des parts à ${offset} m : ${total}`);
  }

  // `sampleAt` en dérive, et le lotissement y compte pour sa part d'herbe —
  // ce qui était un poids peint dans la carte.
  for (let x = 0; x < CLASS_PIXELS; x++) {
    const i = ((half | 0) * CLASS_PIXELS + x) * 4;
    data[i] = surfaceId('settled') * SURFACE_ID_STEP;
  }
  const lotissement = carte.sampleAt(CLASS_AREA_M / 2, (half + 0.5) * perTexel);
  assert.ok(
    Math.abs(lotissement.grass - SETTLED_GRASS) < 1e-9,
    `part d’herbe d’un lotissement : ${lotissement.grass}`
  );
});

test('la couverture règle l’herbe et le fourré, jamais leur présence', () => {
  // Le cas par défaut est l’identité : une prairie pousse exactement comme
  // avant que les couvertures existent.
  const prairie = coverGrassFor(null);
  assert.deepEqual(prairie, { height: 1, density: 1, tint: [1, 1, 1] });
  assert.deepEqual(coverGrassFor('couverture-inconnue'), prairie);
  assert.equal(coverBushesFor(null), 0);

  // Une lande est rase, un marais est haut : c’est ce qui les distingue à
  // hauteur d’homme, la couleur du sol ne le dit pas.
  assert.ok(coverGrassFor('heath').height < 1, 'la lande est rase');
  assert.ok(coverGrassFor('wetland').height > 1, 'la roselière monte');
  // Un maquis est surtout du vide entre des arbustes : peu d’herbe, beaucoup
  // de buissons — l’inverse exact d’un pré.
  assert.ok(coverGrassFor('scrub').density < coverGrassFor('heath').density);
  assert.ok(coverBushesFor('scrub') > coverBushesFor('heath'));
  assert.equal(coverBushesFor('scree'), 0, 'rien ne pousse dans un éboulis');
});

test('le sol d’un bois porte une litière, pas une prairie à l’ombre', () => {
  const bois = { grass: 0, wood: 1, farmland: 0, bare: 0 };
  const pre = { grass: 1, wood: 0, farmland: 0, bare: 0 };
  const nu = { grass: 0, wood: 0, farmland: 0, bare: 1 };

  // Le défaut : la part de bois ne comptait pour rien, donc une forêt n’avait
  // pas une touffe — `grass` vaut zéro sous un couvert d’arbres.
  const sousBois = grassGreenFor(bois);
  assert.ok(sousBois.green > GRASS_GREEN_MIN, `un bois est du végétal (${sousBois.green})`);
  assert.equal(sousBois.shade, 1, 'et tout ce vert-là est du sous-bois');
  // Mais moins qu’un pré : c’est ce qui garde le pire cas d’instances sur la
  // prairie pleine, celle sur laquelle `GRASS_COUNT` est mesuré.
  assert.ok(sousBois.green < grassGreenFor(pre).green, 'un bois vaut moins qu’un pré');
  assert.equal(grassGreenFor(pre).shade, 0, 'un pré n’est l’ombre de personne');
  assert.equal(grassGreenFor(nu).green, 0, 'un sol nu reste nu');

  // Une lisière mêle les deux, et la part d’ombre suit.
  const lisiere = grassGreenFor({ grass: 0.5, wood: 0.5, farmland: 0 });
  assert.ok(lisiere.shade > 0 && lisiere.shade < 1, `part d’ombre en lisière : ${lisiere.shade}`);
  assert.ok(lisiere.green > sousBois.green, 'la lisière est plus verte que le sous-bois');

  // Ce qui y pousse : rase, clairsemée, assombrie — et le neutre exact hors
  // des bois, sinon toute prairie du monde changerait de couleur.
  assert.deepEqual(woodFloorFor(0), { height: 1, density: 1, tint: [1, 1, 1] });
  const litiere = woodFloorFor(1);
  assert.ok(litiere.height < 0.7, `herbe rase (${litiere.height})`);
  assert.ok(litiere.density < 1, 'clairsemée');
  assert.ok(litiere.tint[1] < 1 && litiere.tint[2] < litiere.tint[1], 'assombrie et réchauffée');
  // Et la transition est continue : à mi-ombre, on est à mi-chemin.
  const demi = woodFloorFor(0.5);
  close(demi.height, (1 + litiere.height) / 2, 1e-9, 'fondu de hauteur');
  close(demi.tint[2], (1 + litiere.tint[2]) / 2, 1e-9, 'fondu de teinte');

  // Sous un couvert fermé, rien ne fleurit : les fleurs de l’atlas sont des
  // fleurs de plein soleil.
  assert.ok(WOODLAND_FLOWER_MAX > 0 && WOODLAND_FLOWER_MAX < 1);
  assert.ok(sousBois.shade > WOODLAND_FLOWER_MAX, 'un vrai bois passe le seuil');
});

test('un sol de forêt reste vert : plus sombre qu’un pré, jamais un trou noir', () => {
  // Il l'était : son vert valait 0,056 contre 0,135 pour l'herbe, soit moins de
  // la moitié — sous les arbres, le décor tombait dans une matière plus sombre
  // que l'ombre qu'elle portait. La règle est maintenant écrite : un sous-bois
  // est une litière, donc plus sombre qu'une prairie, mais il en garde au moins
  // la moitié du vert.
  const woodAlbedo = defaultTheme.surfaces.wood.albedo;
  const grassAlbedo = defaultTheme.surfaces.grass.albedo;
  assert.ok(woodAlbedo[1] < grassAlbedo[1], 'un sous-bois reste plus sombre qu’un pré');
  assert.ok(
    woodAlbedo[1] >= grassAlbedo[1] * 0.5,
    `le vert du sous-bois : ${woodAlbedo[1]} pour ${grassAlbedo[1]} en prairie`
  );
  // Et c'est bien du vert : le canal dominant, comme dans l'herbe.
  assert.ok(woodAlbedo[1] > woodAlbedo[0] && woodAlbedo[1] > woodAlbedo[2]);

  // Les touffes qui poussent dessus suivent le même déplacement, sans quoi le
  // premier plan et le lointain peindraient deux forêts différentes.
  assert.ok(
    WOODLAND_FLOOR.tint[1] > 0.85,
    `la teinte des touffes de sous-bois : ${WOODLAND_FLOOR.tint[1]}`
  );
});

test('la carte de classes sait où s’arrête un bois', () => {
  // `woodEdgeAt` ne lit que `woodAt` et `hasDataAt` : on lui donne une carte de
  // poche, un bois qui occupe le demi-plan x < 0.
  const carte = {
    hasDataAt: (x) => x >= -400 && x <= 400,
    woodAt: (x) => (x < 0 ? 1 : 0),
  };
  const edgeAt = (x, z) => GroundClassMap.prototype.woodEdgeAt.call(carte, x, z);

  // Hors du bois, il n’y a pas de lisière : l’ourlet appartient au bois.
  assert.equal(edgeAt(20, 0), 0);
  // Juste au bord, en revanche, elle est franche.
  assert.equal(edgeAt(-1, 0), 1, 'le bord est une lisière pleine');
  // Et en plein bois, il n’y en a plus.
  assert.equal(edgeAt(-WOOD_EDGE_REACH_M * 3, 0), 0, 'le cœur du massif n’est pas un ourlet');

  // Un voisin dont la carte ne dit rien ne fait pas une lisière — sans quoi
  // tout le pourtour du carré couvert en serait une.
  const bord = {
    hasDataAt: (x) => x <= 100,
    woodAt: () => 1,
  };
  assert.equal(GroundClassMap.prototype.woodEdgeAt.call(bord, 95, 0), 0, 'le bord de carte n’est pas une lisière');

  // Une lisière molle (le bois s’éclaircit au lieu de s’arrêter) donne un
  // ourlet partiel, pas un tout ou rien.
  const fondu = {
    hasDataAt: () => true,
    woodAt: (x) => Math.max(0, Math.min(1, 0.5 - x / 200)),
  };
  const doux = GroundClassMap.prototype.woodEdgeAt.call(fondu, 0, 0);
  assert.ok(doux > 0 && doux < 1, `lisière progressive : ${doux}`);
});

test('la carte de classes sait dire ce qu’elle ne couvre pas', () => {
  // Le carré rasterisé est monté à la main : le constructeur veut un canevas,
  // et ce qu’on teste ici n’est que du cadrage.
  const frame = {};
  const map = Object.assign(Object.create(GroundClassMap.prototype), {
    _data: new Uint8ClampedArray(4),
    _frame: frame,
    origin: { x: 0, y: 0 },
    size: CLASS_AREA_M,
  });
  const coverage = (a, b, c, d, f) => map.coverageOf(a, b, c, d, f);

  close(coverage(100, 100, 1100, 1100, frame), 1, 1e-9, 'tuile entièrement dedans');
  assert.equal(coverage(-3000, 0, -2000, 1000, frame), 0, 'tuile entièrement dehors');
  // Débordement d’un côté : c’est le cas des tuiles de coin de la bulle, dont
  // l’emprise sort régulièrement du carré. La moitié semée l’est à l’aveugle.
  close(coverage(-500, 0, 500, 1000, frame), 0.5, 1e-9, 'tuile à cheval sur le bord');

  // Une carte d’un autre repère ne dit rien d’utilisable : ses mètres ne sont
  // pas ceux de la tuile qu’on interroge.
  assert.equal(coverage(100, 100, 1100, 1100, {}), 0, 'repère différent');

  // Et sans rasterisation relue, elle ne dit rien du tout.
  map._data = null;
  assert.equal(coverage(100, 100, 1100, 1100, frame), 0, 'carte pas encore peinte');
});

/*
 * Un canevas 2D qui n'encre rien mais retient tout : chaque `fill`/`stroke`
 * est consigné avec l'état de dessin en vigueur. C'est le seul moyen de
 * vérifier un ordre de composition sous `node`, où il n'y a ni canevas ni
 * pixels — et l'ordre de composition est exactement ce qui s'était perdu dans
 * la passe des cours d'eau.
 */
function recordingCanvas() {
  const ops = [];
  const state = {
    globalCompositeOperation: 'source-over',
    strokeStyle: '#000',
    fillStyle: '#000',
    lineWidth: 1,
  };
  const stack = [];
  const ctx = {
    ...state,
    ops,
    save() {
      stack.push({
        globalCompositeOperation: ctx.globalCompositeOperation,
        strokeStyle: ctx.strokeStyle,
        fillStyle: ctx.fillStyle,
        lineWidth: ctx.lineWidth,
      });
    },
    restore() {
      Object.assign(ctx, stack.pop() || state);
    },
    clearRect() {},
    fillRect() {
      ops.push({ op: 'fillRect', style: ctx.fillStyle });
    },
    fill() {
      ops.push({ op: 'fill', style: ctx.fillStyle, mode: ctx.globalCompositeOperation });
    },
    stroke() {
      ops.push({
        op: 'stroke',
        style: ctx.strokeStyle,
        mode: ctx.globalCompositeOperation,
        width: ctx.lineWidth,
      });
    },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {
      ops.push({ op: 'putImageData' });
    },
  };
  return ctx;
}

test('un cours d’eau linéaire porte de l’eau, et son ourlet ne l’efface pas', () => {
  // Bouchons : la carte veut un canevas et une fabrique de textures, et le
  // test ne regarde ni l'un ni l'autre — seulement l'ordre des opérations.
  const canvases = [];
  const previousCanvas = globalThis.OffscreenCanvas;
  const previousPath = globalThis.Path2D;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._ctx = recordingCanvas();
      canvases.push(this._ctx);
    }
    getContext() {
      return this._ctx;
    }
  };
  globalThis.Path2D = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };

  const THREE = {
    ClampToEdgeWrapping: 1,
    LinearFilter: 2,
    NearestFilter: 3,
    NoColorSpace: '',
    CanvasTexture: class {
      constructor(canvas) {
        this.image = canvas;
      }
    },
    Vector2: class {
      constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
      }
      set(x, y) {
        this.x = x;
        this.y = y;
        return this;
      }
    },
  };

  // Une seule entité par passe : un cours d'eau, qui n'existe dans les tuiles
  // que comme trait — c'est tout l'objet de cette passe.
  const sourceOf = (klass) => ({
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'waterway') return;
      callback(
        { type: 'LineString', coordinates: [[0, 0], [0.001, 0.001]] },
        { class: klass }
      );
    },
  });

  let map;
  let narrow;
  try {
    map = new GroundClassMap({ THREE });
    map.rebuild(sourceOf('stream'), [{ x: 0, y: 0 }], { x: 0, z: 0 }, { origin: { x: 0, y: 0 }, scale: 1, zoom: 14 });
    narrow = new GroundClassMap({ THREE });
    narrow.rebuild(sourceOf('ditch'), [{ x: 0, y: 0 }], { x: 0, z: 0 }, { origin: { x: 0, y: 0 }, scale: 1, zoom: 14 });
  } finally {
    if (previousCanvas) globalThis.OffscreenCanvas = previousCanvas;
    else delete globalThis.OffscreenCanvas;
    if (previousPath) globalThis.Path2D = previousPath;
    else delete globalThis.Path2D;
  }

  // Une seule carte par instance, désormais : les deux canaux du même texel.
  assert.equal(canvases.length, 2, 'une carte par instance, pas deux');
  const ops = canvases[0].ops;

  // Le fond est peint, pas effacé : identifiant zéro, alpha plein.
  assert.equal(ops[0].op, 'fillRect', 'le fond est peint en premier');
  assert.equal(ops[0].style, surfaceFill(null), 'et il porte l’identifiant zéro');

  const strokes = ops.filter((o) => o.op === 'stroke');
  const hem = strokes.findIndex((o) => o.style === surfaceFill('wood'));
  const bed = strokes.findIndex((o) => o.style === surfaceFill('water'));

  assert.ok(hem >= 0, 'l’ourlet de ripisylve est peint en bois');
  assert.ok(bed >= 0, 'le lit est peint en eau');
  assert.ok(hem < bed, 'l’ourlet passe avant le lit, sans quoi il le rongerait');
  assert.ok(strokes[hem].width > strokes[bed].width, 'l’ourlet déborde le lit');

  // Deux traits, là où il en fallait cinq — dont un en `destination-out` pour
  // effacer, dans l'autre carte, la culture que l'ourlet recouvrait. Peindre
  // une matière efface désormais la culture d'un même geste : c'est le même
  // texel, et le canal des cultures y repart à zéro.
  assert.equal(strokes.length, 2, 'deux traits par cours d’eau, pas cinq');
  assert.ok(
    !ops.some((o) => o.mode === 'destination-out'),
    'plus rien à effacer dans une seconde carte'
  );

  // Une classe que le thème ne décrit pas ne peint rien du tout — ni lit, ni
  // ourlet. Le fossé et le drain en sont sortis : plus étroits qu'un texel de
  // la carte (2,7 m), ils ne pouvaient se rendre qu'en pointillé.
  assert.equal(
    canvases[1].ops.filter((o) => o.op === 'stroke').length,
    0,
    'une classe hors du thème ne peint rien'
  );
});

test('l’encodage : un identifiant de matière, un de culture, le même texel', () => {
  // L'encodage est le contrat entre ce module et le shader. C'étaient deux
  // cartes — quatre poids interpolés d'un côté, deux identifiants au plus
  // proche de l'autre — et une case pouvait porter une matière ici et une
  // couverture sans rapport là. Il n'y a plus qu'un texel à tenir juste.
  const seen = new Set();
  for (const kind of SURFACE_KINDS) {
    const fill = surfaceFill(kind);
    assert.ok(/^rgba\(\d+, \d+, \d+, 1\)$/.test(fill), `${kind} : alpha plein`);
    assert.ok(!seen.has(fill), `${kind} : identifiant distinct`);
    seen.add(fill);
  }
  // Zéro n'est aucune matière : c'est « la donnée se tait », et le shader y
  // substitue le repli du thème.
  assert.ok(!seen.has(surfaceFill(null)), 'le silence n’est pas une matière');
});

test('les deux formes de géométrie surfacique sont acceptées par la carte de classes', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.deepEqual(classPolygons({ type: 'Polygon', coordinates: [ring] }), [[ring]]);
  assert.deepEqual(classPolygons({ type: 'MultiPolygon', coordinates: [[ring]] }), [[ring]]);
  assert.deepEqual(classPolygons({ type: 'Point', coordinates: [0, 0] }), []);
  assert.deepEqual(classPolygons(null), []);
});

test('la nuit reste éclairée assez pour qu’on lise le relief', () => {
  // Une nuit noire ne se distingue plus d’un rendu en panne.
  const nuit = lightingFor(-0.4);
  const jour = lightingFor(0.9);
  assert.ok(nuit.ambient > 0.5, 'ambiance nocturne');
  assert.ok(nuit.ambient < jour.ambient, 'mais toujours moins que le jour');
  assert.ok(nuit.sun < jour.sun);
});

// --- Chaussée dressée de niveau --------------------------------------------

/** Versant régulier : l’altitude ne dépend que de z, 20 % de pente. */
const slopeField = (x, z) => 100 + z * 0.2;

test('une section de chaussée se dresse à mi-hauteur de son emprise', () => {
  const path = [
    { x: 0, z: 0, distance: 0 },
    { x: 10, z: 0, distance: 10 },
  ];
  const frames = pathFrames(path);
  // La route va vers +x, c’est-à-dire vers l’est ; l’axe z pointant au sud, la
  // gauche de la marche est donc au nord, en -z.
  const row = levelRow(path, 0, frames, 4, slopeField);

  close(row.left, 99.2, 1e-6, 'rive gauche, en amont du versant');
  close(row.right, 100.8, 1e-6, 'rive droite, en aval');
  // La plate-forme est à mi-hauteur : le déblai d’un côté paie le remblai de
  // l’autre, comme le fait un terrassier. La porter au point haut mettrait
  // toute la chaussée en surplomb sur un remblai continu.
  close(row.deck, 100, 1e-6, 'plate-forme à mi-hauteur');
});

test('sur un devers, toute la largeur de la chaussée est à la même altitude', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 40, z: 0 }], 5);
  const buffer = createRibbonBuffer();
  appendRibbon(buffer, { path, halfWidth: 4, sampleElevation: slopeField, columns: 5 });

  const columns = 5;
  for (let r = 0; r < path.length; r++) {
    const first = buffer.positions[(r * columns) * 3 + 1];
    for (let c = 1; c < columns; c++) {
      close(buffer.positions[(r * columns + c) * 3 + 1], first, 1e-5, `ligne ${r}, colonne ${c}`);
    }
    // Et cette altitude commune est bien celle de la mi-hauteur, donc entre les
    // deux rives : encaissée en amont, portée en aval.
    close(first, 100, 1e-4, `plate-forme de la ligne ${r}`);
  }
});

test('un mur de hauteur variable suit le versant sans se refermer', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 30, z: 0 }], 10);
  const rows = path.length;
  const base = new Float32Array(rows).fill(100);
  // Le versant monte le long du tracé : le mur doit monter avec lui.
  const top = Float32Array.from({ length: rows }, (_, r) => 100 + 0.4 + r * 0.6);

  const buffer = createProfileBuffer();
  assert.ok(
    appendVariableWall(buffer, {
      path,
      base,
      top,
      offset: 3,
      thickness: 0.5,
      coping: 0.1,
      colorFoot: [0, 0, 0],
      colorTop: [1, 1, 1],
    })
  );

  const cols = 6;
  assert.equal(buffer.positions.length / 3, rows * cols, 'six sommets par ligne');
  assert.equal(buffer.colors.length, buffer.positions.length, 'une couleur par sommet');

  // Le sommet le plus haut de chaque ligne suit bien la consigne, et le pied
  // reste au niveau de la plate-forme.
  for (let r = 0; r < rows; r++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let c = 0; c < cols; c++) {
      const y = buffer.positions[(r * cols + c) * 3 + 1];
      highest = Math.max(highest, y);
      lowest = Math.min(lowest, y);
    }
    close(highest, top[r], 1e-4, `arase de la ligne ${r}`);
    close(lowest, base[r], 1e-4, `pied de la ligne ${r}`);
  }

  // Le mur est bien décalé de l’axe, du côté demandé : la route va vers +x, la
  // gauche de la marche est en -z, donc un décalage positif tombe côté nord.
  // Le premier sommet de la section est le pied côté intérieur, à une
  // demi-épaisseur en deçà de l’axe du mur.
  close(buffer.positions[2], -3 + 0.25, 1e-4, 'parement intérieur');
});

test('un mur sans hauteur nulle part n’est pas engendré', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
  const flat = new Float32Array(path.length).fill(50);
  const buffer = createProfileBuffer();
  // Terrain au niveau de la plate-forme : il n’y a rien à retenir, et un mur de
  // deux centimètres qui court le long de la route se lirait comme un défaut.
  assert.equal(
    appendVariableWall(buffer, {
      path,
      base: flat,
      top: flat,
      colorFoot: [0, 0, 0],
      colorTop: [1, 1, 1],
    }),
    false
  );
  assert.equal(buffer.positions.length, 0);
});

// --- Profil en long : l’aplanissement du terrassier -------------------------

/** Profil ondulé : une pente régulière de 4 %, plus une vague de 40 m d’un mètre. */
function wavyProfile(rows, spacing = 5) {
  return Float32Array.from({ length: rows }, (_, r) =>
    100 + r * spacing * 0.04 + Math.sin((2 * Math.PI * r * spacing) / 40)
  );
}

test('l’aplanissement efface les vagues et garde la pente', () => {
  const rows = 121;
  const raw = wavyProfile(rows);
  const graded = flattenGrade(Float32Array.from(raw), { maxCut: 3, maxFill: 3 });

  // La vague, mesurée loin des extrémités : ce qui en reste doit être invisible
  // à l’échelle d’une chaussée, là où elle valait un mètre de creux.
  let ripple = 0;
  for (let r = 30; r < rows - 30; r++) {
    const trend = (graded[r - 1] + graded[r + 1]) * 0.5;
    ripple = Math.max(ripple, Math.abs(graded[r] - trend));
  }
  assert.ok(ripple < 0.02, `vague résiduelle : ${ripple.toFixed(3)} m`);

  // La pente d’ensemble, elle, ne se rabote pas : quatre pour cent d’un bout à
  // l’autre, sinon la route ne monterait plus là où le terrain monte.
  const climb = graded[rows - 1] - graded[0];
  close(climb, raw[rows - 1] - raw[0], 0.35, 'dénivelé conservé');
});

test('l’aplanissement ne sort jamais de la bande de terrassement', () => {
  const rows = 121;
  const raw = wavyProfile(rows);
  const graded = flattenGrade(Float32Array.from(raw), { maxCut: 0.4, maxFill: 0.25 });

  for (let r = 0; r < rows; r++) {
    const gap = graded[r] - raw[r];
    assert.ok(gap <= 0.25 + 1e-4, `ligne ${r} : remblai de ${gap.toFixed(3)} m`);
    assert.ok(gap >= -0.4 - 1e-4, `ligne ${r} : déblai de ${(-gap).toFixed(3)} m`);
  }
});

test('sans terrassement consenti, le profil colle au terrain', () => {
  // C’est le régime de la rase campagne : rien à tenir, donc rien à aplanir.
  const raw = wavyProfile(41);
  const graded = flattenGrade(Float32Array.from(raw), { maxCut: 0, maxFill: 0 });
  for (let r = 0; r < raw.length; r++) close(graded[r], raw[r], 1e-6, `ligne ${r}`);
});

test('le terrassement consenti suit le devers', () => {
  const flat = gradeAllowance(0);
  const steep = gradeAllowance(0.6);

  close(flat.cut, ROAD_GRADE_CUT_FLAT_M, 1e-6, 'en plaine, la route colle au sol');
  close(steep.cut, ROAD_GRADE_CUT_STEEP_M, 1e-6, 'sur un versant, elle s’en détache');
  close(steep.fill, ROAD_GRADE_FILL_STEEP_M, 1e-6, 'et le mur porte la différence');
  // Le remblai reste le parent pauvre : porter coûte plus cher qu’entailler.
  assert.ok(steep.fill < steep.cut, 'on entaille plus volontiers qu’on ne porte');
  // Monotone : pas de marche entre les deux régimes.
  let previous = -Infinity;
  for (let slope = 0; slope <= 0.6; slope += 0.02) {
    const { cut } = gradeAllowance(slope);
    assert.ok(cut >= previous - 1e-9, `devers ${slope.toFixed(2)}`);
    previous = cut;
  }
});

// --- Falaise de déblai ------------------------------------------------------

test('la falaise monte jusqu’au terrain et le couvre jusqu’au raccord', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 30, z: 0 }], 10);
  const rows = path.length;
  const base = new Float32Array(rows).fill(100);
  // Paroi franche de six mètres, puis le versant qui continue de monter
  // derrière elle jusqu’au raccord du déblai.
  const crest = new Float32Array(rows).fill(106);
  const shelf = new Float32Array(rows).fill(107.5);
  const cap = new Float32Array(rows).fill(109);
  const reach = new Float32Array(rows).fill(1);
  const buffer = createProfileBuffer();

  assert.ok(
    appendRockCut(buffer, {
      path,
      base,
      crest,
      shelf,
      cap,
      offset: 4,
      side: 1,
      reach,
      capReach: 5,
      shelfAt: 0.5,
      colorFoot: [0, 0, 0],
      colorBreak: [0.5, 0.5, 0.5],
      colorTop: [1, 1, 1],
    })
  );

  const cols = 6;
  assert.equal(buffer.positions.length / 3, rows * cols, 'six sommets par ligne');
  assert.equal(buffer.colors.length, buffer.positions.length, 'une couleur par sommet');

  // La route va vers +x, la gauche de la marche est en -z : un décalage positif
  // s’éloigne donc vers -z, et le raccord est ce qui va le plus loin.
  const z = (r, c) => buffer.positions[(r * cols + c) * 3 + 2];
  const y = (r, c) => buffer.positions[(r * cols + c) * 3 + 1];

  for (let r = 0; r < rows; r++) {
    close(z(r, 0), -4, 1e-4, `pied de la ligne ${r}`);
    close(y(r, 0), 100, 1e-4, `le pied est sur la plate-forme, ligne ${r}`);
    close(z(r, 2), -5, 1e-4, `arase reculée du fruit, ligne ${r}`);
    close(y(r, 2), 106, 1e-4, `arase au terrain naturel, ligne ${r}`);
    // Le dos s’appuie sur le talus entre l’arase et le raccord : ni table
    // plate posée sur la falaise, ni paroi qui traverse le talus.
    close(z(r, 3), -7, 1e-4, `dos à mi-largeur, ligne ${r}`);
    close(y(r, 3), 107.5, 1e-4, `dos appuyé sur le talus, ligne ${r}`);
    close(z(r, 4), -9, 1e-4, `raccord au versant, ligne ${r}`);
    close(y(r, 4), 109, 1e-4, `le raccord suit le versant, ligne ${r}`);
    // La cassure est sur la face, entre le pied et l’arase.
    assert.ok(y(r, 1) > 100 && y(r, 1) < 106, `cassure à mi-hauteur, ligne ${r}`);
    assert.ok(z(r, 1) > -5 && z(r, 1) < -4, `cassure sur la face, ligne ${r}`);
  }
});

test('la falaise se dresse du côté du versant, pas de l’autre', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 30, z: 0 }], 10);
  const rows = path.length;
  const common = {
    path,
    base: new Float32Array(rows).fill(100),
    crest: new Float32Array(rows).fill(104),
    reach: new Float32Array(rows).fill(1),
    capReach: 5,
    colorFoot: [0, 0, 0],
    colorBreak: [0.5, 0.5, 0.5],
    colorTop: [1, 1, 1],
  };

  const left = createProfileBuffer();
  appendRockCut(left, { ...common, offset: 4, side: 1 });
  const right = createProfileBuffer();
  appendRockCut(right, { ...common, offset: -4, side: -1 });

  for (let i = 0; i < left.positions.length; i += 3) {
    assert.ok(left.positions[i + 2] <= -4 + 1e-6, 'côté amont à gauche de la marche');
    assert.ok(right.positions[i + 2] >= 4 - 1e-6, 'et rien ne déborde de l’autre côté');
  }
});

test('un versant qui ne domine pas la route ne donne pas de falaise', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
  const flat = new Float32Array(path.length).fill(50);
  const buffer = createProfileBuffer();

  assert.equal(
    appendRockCut(buffer, {
      path,
      base: flat,
      crest: flat,
      reach: new Float32Array(path.length).fill(1),
      colorFoot: [0, 0, 0],
      colorBreak: [0.5, 0.5, 0.5],
      colorTop: [1, 1, 1],
    }),
    false
  );
  assert.equal(buffer.positions.length, 0);
});

test('le suivi du terrain reste disponible quand on le demande explicitement', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 40, z: 0 }], 5);
  const buffer = createRibbonBuffer();
  appendRibbon(buffer, { path, halfWidth: 4, sampleElevation: slopeField, columns: 5, level: false });

  // Sans mise à niveau, les deux rives divergent de la pleine largeur du devers.
  const left = buffer.positions[1];
  const right = buffer.positions[4 * 3 + 1];
  close(Math.abs(left - right), 1.6, 1e-4, 'devers conservé');
});

// --- Déblai des chaussées ---------------------------------------------------

test('le terrain est taillé sous la chaussée et raccordé au-delà', () => {
  // Versant : terrain naturel à 110, plate-forme dressée à 100.
  const raw = 110;
  const deck = 100;
  const halfWidth = 2.5;

  close(cutElevationAt(raw, deck, 0, halfWidth), 100, 1e-9, 'sous l’axe');
  close(cutElevationAt(raw, deck, halfWidth, halfWidth), 100, 1e-9, 'sous la rive');
  // L’accotement excavé garde le fond plat.
  close(cutElevationAt(raw, deck, halfWidth + ROAD_CUT_M, halfWidth), 100, 1e-9, 'accotement');
  // Et au bout du raccord, le terrain est intact.
  close(
    cutElevationAt(raw, deck, halfWidth + ROAD_CUT_M + ROAD_CUT_BLEND_M, halfWidth),
    110,
    1e-9,
    'terrain naturel retrouvé'
  );
  close(cutElevationAt(raw, deck, 400, halfWidth), 110, 1e-9, 'loin de la route');
});

test('le raccord du déblai est monotone et sans arête', () => {
  const raw = 120;
  const deck = 100;
  const halfWidth = 4;
  let previous = -Infinity;

  for (let d = 0; d <= 20; d += 0.1) {
    const h = cutElevationAt(raw, deck, d, halfWidth);
    assert.ok(h >= previous - 1e-9, `remontée monotone à ${d.toFixed(1)} m`);
    assert.ok(h >= deck - 1e-9 && h <= raw + 1e-9, `borné à ${d.toFixed(1)} m`);
    previous = h;
  }

  // Les deux extrémités du raccord sont tangentes : c’est ce que la smoothstep
  // apporte et qu’une interpolation linéaire ne donnerait pas. Une arête vive y
  // se verrait, la maille de terrain faisant quatre mètres.
  const edge = halfWidth + ROAD_CUT_M;
  const slopeAt = (d) => (cutElevationAt(raw, deck, d + 0.01, halfWidth) - cutElevationAt(raw, deck, d, halfWidth)) / 0.01;
  close(slopeAt(edge), 0, 0.15, 'tangente au début du raccord');
  close(slopeAt(edge + ROAD_CUT_BLEND_M - 0.02), 0, 0.15, 'tangente à la fin');
});

test('le déblai ne remblaie jamais : côté aval, le terrain ne bouge pas', () => {
  // La plate-forme domine le sol : c’est un remblai, et il se tient par un mur,
  // pas par une bosse de terrain qui sortirait de nulle part.
  close(cutElevationAt(95, 100, 0, 3), 95, 1e-9, 'sous la chaussée');
  close(cutElevationAt(95, 100, 4, 3), 95, 1e-9, 'au ras de la rive');
  close(cutElevationAt(100, 100, 1, 3), 100, 1e-9, 'à niveau, rien à creuser');
});

// --- Sections balayées ------------------------------------------------------

test('une section balayée pose ses sommets en travers et referme son anneau', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 30, z: 0 }], 10);
  const buffer = createProfileBuffer();
  const profile = [
    { across: -1, up: 0, color: [0, 0, 0] },
    { across: 0, up: 2, color: [0.5, 0.5, 0.5] },
    { across: 1, up: 0, color: [1, 1, 1] },
  ];
  const added = appendProfile(buffer, { path, profile, sampleElevation: () => 50, closed: true });

  assert.ok(added);
  assert.equal(buffer.positions.length / 3, path.length * 3, 'un sommet par ligne et par point de section');
  assert.equal(buffer.colors.length, buffer.positions.length, 'une couleur par sommet');

  // La route va vers +x, donc la gauche de la marche est en -z : un `across`
  // négatif tombe côté +z, à droite.
  close(buffer.positions[2], 1, 1e-6, 'premier sommet, côté droit de la marche');
  close(buffer.positions[3 + 1], 52, 1e-6, 'crête à deux mètres du sol');

  // Anneau fermé : trois faces latérales par maille au lieu de deux, plus un
  // bouchon à chaque extrémité.
  const quads = (path.length - 1) * 3 * 6;
  const caps = 2 * 1 * 3;
  assert.equal(buffer.indices.length, quads + caps, 'côtés refermés et extrémités bouchées');
});

test('une section ouverte ne referme rien', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
  const buffer = createProfileBuffer();
  const profile = [
    { across: 0, up: 0, color: [0, 0, 0] },
    { across: -2, up: -1, color: [1, 1, 1] },
  ];
  appendProfile(buffer, { path, profile, sampleElevation: () => 0 });
  assert.equal(buffer.indices.length, (path.length - 1) * 1 * 6, 'une seule bande, aucun bouchon');
});

test('la section se dilate en travers sans quitter son axe', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
  const profile = [
    { across: -1, up: 0, color: [0, 0, 0] },
    { across: 0, up: 2, color: [1, 1, 1] },
    { across: 1, up: 0, color: [0, 0, 0] },
  ];
  const buffer = createProfileBuffer();
  const wide = new Float32Array(path.length).fill(2);
  appendProfile(buffer, { path, profile, sampleElevation: () => 0, scaleAcross: wide });

  // Les deux flancs s’écartent du double, la crête — `across` nul — ne bouge
  // pas d’un pouce : la section se dilate, elle ne glisse pas.
  close(buffer.positions[2], 2, 1e-6, 'flanc droit doublé');
  close(buffer.positions[3 * 2 + 2], -2, 1e-6, 'flanc gauche doublé');
  close(buffer.positions[3 * 1 + 2], 0, 1e-6, 'crête restée sur l’axe');
  close(buffer.positions[3 * 1 + 1], 2, 1e-6, 'hauteur inchangée');
});

// --- Haies ------------------------------------------------------------------

/**
 * Un bord de route complet, sans three.js ni tuiles : une chaussée droite, un
 * terrain plat, et les seules dépendances que la chaîne de bord de route lit
 * réellement. Ce n’est pas un test de rendu — c’est le seul moyen de faire
 * *exécuter* `_buildRoadsideContext`, dont une variable libre passerait
 * autrement toutes les vérifications jusqu’à l’écran.
 */
function roadsideHarness({ profile = 'minor', here = { x: 200, z: 0 } } = {}) {
  const layer = Object.create(FurnitureLayer.prototype);
  layer.theme = defaultTheme;
  layer.specs = furnitureSpecsFor(defaultTheme.furniture.colors);
  layer.counts = { points: 0, boundaries: 0, landmarks: 0, rocks: 0, rows: 0, hedgeClumps: 0 };
  layer.bubble = { surfaceElevationAtLocal: () => 100, verticalScale: 1 };
  layer.groundClass = { woodAt: () => 0, cropAt: () => null };
  layer._signals = [];
  layer._lampHeads = [];

  const path = resamplePath([{ x: 0, z: 0 }, { x: 400, z: 0 }], 5);
  const platform = new Float32Array(path.length).fill(100);
  const edges = new Float32Array(path.length * 2).fill(100);
  const rowsInfo = path.map((p, r) => ({
    r, x: p.x, z: p.z, distance: p.distance,
    slope: 0, uphill: 1, curvature: Math.abs(pathTurn(path, r)), turn: 0, drop: 0, rise: 0,
  }));

  const buffers = {};
  for (const kind of LINEAR_KINDS) buffers[kind] = createProfileBuffer();
  const placements = new Map();
  for (const item of POINT_ITEMS) placements.set(item, []);

  const context = { buffers, placements, sampleElevation: () => 100, here };
  const segment = { path, platform, edges, probeSpan: 4, halfWidth: 2.5, profile, startDistance: 0, anchor: path[0] };
  return { layer, context, segment, rowsInfo, buffers, placements };
}

/**
 * Une chaussée taillée dans un versant régulier, réduite à ce que la falaise
 * de déblai lit : la plate-forme, le terrain naturel et la hauteur dont il la
 * domine. Le versant monte vers -z, donc en amont à gauche de la marche.
 */
function rockCutHarness({ rise = 4, slope = 0.35 } = {}) {
  const layer = Object.create(FurnitureLayer.prototype);
  layer.specs = furnitureSpecsFor(defaultTheme.furniture.colors);

  const path = resamplePath([{ x: 0, z: 0 }, { x: 200, z: 0 }], 5);
  const rows = path.length;
  const deck = 100;
  const platform = new Float32Array(rows).fill(deck);
  // Terrain naturel : le versant monte d’autant qu’on s’écarte vers -z. La
  // surface affichée, elle, est celle que le déblai a laissée — c’est le talus
  // que la roche vient couvrir.
  const rawElevation = (x, z) => deck - z * slope;
  const sampleElevation = (x, z) =>
    cutElevationAt(rawElevation(x, z), deck, Math.abs(z), 2.5);

  const rowsInfo = path.map((p, r) => ({
    r, x: p.x, z: p.z, distance: p.distance,
    slope, uphill: 1, curvature: 0, turn: 0, drop: 0, rise,
  }));

  const buffers = {};
  for (const kind of LINEAR_KINDS) buffers[kind] = createProfileBuffer();
  const context = { buffers, sampleElevation, rawElevation, here: { x: 100, z: 0 } };
  const segment = { path, platform, halfWidth: 2.5, profile: 'minor' };
  return { layer, context, segment, rowsInfo, buffers, deck, rawElevation, sampleElevation };
}

test('un versant qui domine la chaussée est bordé de roche, pas d’un mur', () => {
  const { layer, context, segment, rowsInfo, buffers, deck, rawElevation, sampleElevation } =
    rockCutHarness();
  layer._buildRockCut(context, segment, rowsInfo);

  assert.ok(buffers.rockCut.indices.length > 0, 'la falaise est bien engendrée');
  assert.equal(buffers.fillWall.indices.length, 0, 'et rien n’est maçonné au passage');

  const positions = buffers.rockCut.positions;
  const cols = 6;
  const rows = positions.length / 3 / cols;
  const y = (r, c) => positions[(r * cols + c) * 3 + 1];
  const z = (r, c) => positions[(r * cols + c) * 3 + 2];
  const spec = FURNITURE_SPECS.rockCut;
  const foot = 2.5 + ROAD_CUT_M;

  for (let r = 0; r < rows; r++) {
    // Le versant monte vers -z : toute la falaise est de ce côté, au-delà de
    // l’accotement excavé.
    for (let c = 0; c < cols; c++) assert.ok(z(r, c) <= -foot + 1e-6, `ligne ${r}, colonne ${c}`);

    close(y(r, 0), deck, 1e-4, `le pied est sur la plate-forme, ligne ${r}`);
    // La paroi franche s’arrête au terrain naturel de son propre aplomb : plus
    // haut, elle dépasserait du versant comme une lame.
    const natural = rawElevation(0, z(r, 2));
    assert.ok(y(r, 2) >= rawElevation(0, -foot) - 1e-3, `arase au moins au pied du versant, ligne ${r}`);
    assert.ok(
      y(r, 2) <= natural + spec.grain.crest * (natural - deck) + 0.1,
      `arase sans lame au-dessus du versant, ligne ${r}`
    );
    // Le raccord, lui, va chercher le versant intact, cinq mètres plus loin —
    // et sa rallonge l'enfonce dedans plutôt que de le faire ressortir.
    close(y(r, 4), rawElevation(0, -(foot + ROAD_CUT_BLEND_M)) + spec.crown, 1e-3, `raccord au versant, ligne ${r}`);
    assert.ok(y(r, 4) <= rawElevation(0, z(r, 4)) + spec.crown + 1e-6, `arrière enfoui, ligne ${r}`);
    close(z(r, 4), z(r, 5), 1e-6, `semelle sous le raccord, ligne ${r}`);
    // Et le dos se tient entre le talus qu’il couvre et le terrain naturel :
    // en dessous, il plongerait dans le talus ; au-dessus, il coifferait le
    // versant d’une table de roche.
    assert.ok(y(r, 3) >= sampleElevation(0, z(r, 3)) - 1e-3, `dos au-dessus du talus, ligne ${r}`);
    assert.ok(y(r, 3) <= rawElevation(0, z(r, 3)) + 1e-3, `dos sous le versant, ligne ${r}`);
  }
});

test('un terrain qui ne domine pas la chaussée ne donne pas de falaise', () => {
  // Le seuil ne parle pas de devers mais de hauteur : sous cette hauteur, ce
  // qui borde la route est un accotement, pas une paroi.
  const { layer, context, segment, rowsInfo, buffers } = rockCutHarness({
    rise: ROCK_CUT_MIN_RISE_M - 0.1,
    slope: 0.05,
  });
  layer._buildRockCut(context, segment, rowsInfo);
  assert.equal(buffers.rockCut.indices.length, 0);
});

test('la falaise n’est pas un tube extrudé : sa section change à chaque ligne', () => {
  // Versant franc : sous un mètre de paroi, le fruit tape son plancher partout
  // et la section ne varie plus qu’en hauteur.
  const { layer, context, segment, rowsInfo, buffers } = rockCutHarness({ rise: 6, slope: 0.9 });
  layer._buildRockCut(context, segment, rowsInfo);

  // Le grain low poly tient à ce qu’aucune ligne ne ressemble à sa voisine :
  // sans quoi le maillage non lissé n’a aucune arête à montrer.
  const cols = 6;
  const positions = buffers.rockCut.positions;
  const rows = positions.length / 3 / cols;
  const section = (r) => {
    const out = [];
    for (let c = 0; c < cols; c++) {
      out.push(positions[(r * cols + c) * 3 + 1].toFixed(3), positions[(r * cols + c) * 3 + 2].toFixed(3));
    }
    return out.join('|');
  };

  const shapes = new Set();
  for (let r = 0; r < rows; r++) shapes.add(section(r));
  assert.equal(shapes.size, rows, `${shapes.size} sections distinctes sur ${rows} lignes`);

  // Et les trois cotes bruitées bougent chacune, pas seulement l’une d’elles.
  // Le raccord fait exception en hauteur : il va chercher le versant intact, à
  // distance fixe, et c'est le versant qui décide — sa rallonge ne bruite que
  // son recul.
  for (const [c, cote, varies] of [
    [0, 'pied', false],
    [1, 'cassure', true],
    [2, 'arase', true],
    [3, 'dos', true],
    [4, 'raccord', false],
  ]) {
    const offsets = new Set();
    const heights = new Set();
    for (let r = 0; r < rows; r++) {
      offsets.add(positions[(r * cols + c) * 3 + 2].toFixed(3));
      heights.add(positions[(r * cols + c) * 3 + 1].toFixed(3));
    }
    assert.ok(offsets.size > rows / 3, `${cote} : ${offsets.size} reculs distincts`);
    if (varies) assert.ok(heights.size > rows / 3, `${cote} : ${heights.size} hauteurs distinctes`);
  }

  // Le pied déborde vers le versant, jamais vers la chaussée.
  for (let r = 0; r < rows; r++) {
    assert.ok(
      positions[(r * cols) * 3 + 2] <= -(2.5 + ROAD_CUT_M) + 1e-6,
      `pied de la ligne ${r} au-delà de l’accotement`
    );
  }
});

test('le mobilier de bord de route se pose sans variable libre', () => {
  // Le mobilier entier est bâti dans un seul `try` : une variable libre dans la
  // chaîne de bord de route n’explose pas la haie, elle **avale tout ce qui
  // vient après** — les éoliennes, les pylônes, les parcelles. Rien n’est plus
  // silencieux, et rien ne se voit plus vite à l’écran.
  let clumps = 0;
  let hedgeTriangles = 0;
  let points = 0;

  // Plusieurs positions : le côté de la haie, le fossé et le bas-côté se
  // tirent au lieu, donc une seule portion n’en rencontre pas la moitié.
  for (const z of [0, 37, 91, 150, 233, 310, 404, 512]) {
    const { layer, context, segment, rowsInfo, buffers, placements } = roadsideHarness({ here: { x: 200, z } });
    const moved = rowsInfo.map((row) => ({ ...row, z: row.z + z }));
    const shifted = { ...segment, path: segment.path.map((p) => ({ ...p, z: p.z + z })), anchor: { x: 0, z } };

    layer._buildRoadsideContext({ ...context, here: { x: 200, z } }, shifted, moved, []);

    clumps += layer.counts.hedgeClumps;
    hedgeTriangles += buffers.hedge.indices.length / 3 + buffers.lowHedge.indices.length / 3;
    for (const list of placements.values()) points += list.length;
  }

  assert.ok(points > 0, 'la chaîne pose bien du mobilier ponctuel');
  assert.ok(hedgeTriangles > 0, 'et au moins une haie sur les huit portions');
  assert.ok(clumps > 0, 'avec ses arbustes, l’observateur étant au ras du tracé');
});

test('un bois interrompt l’alignement au lieu de l’effacer selon d’où l’on regarde', () => {
  // Le défaut : la question « sommes-nous en terrain découvert ? » se posait une
  // seule fois par portion, sur son point **médian** — c'est-à-dire sur un
  // point qui avance avec l'observateur, puisque la portion est ce qui reste du
  // tronçon après découpe au rayon. Un alignement entier existait ou non selon
  // l'endroit d'où on le regardait, et se replantait en roulant.
  //
  // Un bois sur la première moitié de la route, du découvert ensuite : le
  // découpage ne doit plus rien changer à ce qui pousse.
  const bois = { woodAt: (x) => (x < 150 ? 0.8 : 0), cropAt: () => null };

  const arbres = (jusqu) => {
    const { layer, context, segment, rowsInfo } = roadsideHarness({
      profile: 'major',
      here: { x: 100, z: 0 },
    });
    layer.groundClass = bois;
    const rows = rowsInfo.filter((row) => row.x <= jusqu);
    const path = segment.path.filter((p) => p.x <= jusqu);
    layer._buildRoadsideContext(context, { ...segment, path }, rows, []);

    const out = [];
    for (const [kind, list] of context.placements) {
      if (!kind.startsWith('tree')) continue;
      for (const item of list) out.push(`${kind}@${item.x.toFixed(3)},${item.z.toFixed(3)}`);
    }
    return out.sort();
  };

  const court = arbres(200);
  const long = arbres(400);
  assert.ok(long.length > court.length, 'la route longue porte plus d’arbres');
  assert.ok(court.length > 0, 'et la courte en porte quand même');

  // L'invariant : sur la portion commune, ce sont exactement les mêmes arbres.
  const communs = long.filter((clef) => Number(clef.split('@')[1].split(',')[0]) <= 200);
  assert.deepEqual(court, communs, 'le découpage ne replante rien');

  // Et rien ne pousse sous le bois : c'est bien le sol qui décide, pas la
  // longueur du tronçon rendu.
  for (const clef of long) {
    assert.ok(Number(clef.split('@')[1].split(',')[0]) >= 150, `${clef} pousse sous le bois`);
  }
});

test('une haie ne s’arrête plus au couteau : elle rentre en museau', () => {
  // Une haie finissait sur un bouchon plat — sa section entière tranchée net,
  // ce qui se lit comme un tube coupé. Elle rentre maintenant sur sa dernière
  // longueur de museau, en quart d'ellipse.
  const style = HEDGE_STYLES.hedge;
  const fine = resamplePath([{ x: 0, z: 0 }, { x: 60, z: 0 }], HEDGE_SAMPLE_M);

  // Le museau est d'abord une question de lignes : à soixante-quinze
  // centimètres de pas, l'arrondi tiendrait sur une ligne et demie.
  const dense = hedgeNosePath(fine, style.noseM);
  assert.ok(dense.length > fine.length, 'les bouts sont densifiés');
  const dansLeMuseau = dense.filter((p) => p.distance < style.noseM).length;
  assert.ok(dansLeMuseau >= 5, `${dansLeMuseau} lignes dans le museau`);
  // Et rien n'a bougé ailleurs : même longueur, mêmes distances croissantes.
  close(dense[dense.length - 1].distance, fine[fine.length - 1].distance, 1e-9, 'même longueur');
  for (let r = 1; r < dense.length; r++) {
    assert.ok(dense[r].distance > dense[r - 1].distance, 'aucune ligne confondue');
  }

  const taper = hedgeEndTaper(dense, style.noseM);
  assert.ok(taper[0] <= HEDGE_NOSE_FLOOR + 1e-9, 'la pointe ne garde presque rien de la section');
  assert.ok(taper[0] > 0, 'mais pas rien du tout : un anneau nul rend des triangles plats');
  close(taper[taper.length - 1], taper[0], 1e-6, 'les deux bouts se valent');
  const cœur = taper[Math.floor(taper.length / 2)];
  assert.equal(cœur, 1, 'le corps de la haie garde sa section');

  // Rond, pas conique : la courbe monte plus vite qu'une rampe près du bout,
  // c'est ce qui distingue une haie taillée d'un crayon.
  const moitie = hedgeNoseFactor(style.noseM * 0.5, style.noseM);
  assert.ok(moitie > 0.8, `à mi-museau la section vaut déjà ${moitie.toFixed(2)}`);
  assert.equal(hedgeNoseFactor(style.noseM * 2, style.noseM), 1, 'au-delà, plus d’arrondi');

  // Sans museau au thème, rien ne rentre : un thème qui ne le décrit pas garde
  // le bout franc d'avant.
  assert.equal(hedgeNoseFactor(0, 0), 1);
  assert.deepEqual(hedgeNosePath(fine, 0), fine);

  // Une haie trop courte pour deux museaux n'est pas retournée pour autant.
  const courte = resamplePath([{ x: 0, z: 0 }, { x: 1.2, z: 0 }], HEDGE_SAMPLE_M);
  const petit = hedgeEndTaper(hedgeNosePath(courte, style.noseM), style.noseM);
  assert.ok(petit.every((v) => v > 0 && v <= 1), 'facteurs bornés même sur un bout de haie');
});

test('le champ proche d’une haie se fond au lieu de basculer', () => {
  const style = HEDGE_STYLES.hedge;
  const here = { x: 0, z: 0 };
  const outer = style.detailRadiusM;
  const inner = outer - style.fadeM;

  assert.equal(hedgeNearness(0, 0, here, style), 1, 'sous le nez, tout est détaillé');
  assert.equal(hedgeNearness(inner - 1, 0, here, style), 1, 'dedans, encore plein détail');
  assert.equal(hedgeNearness(outer + 1, 0, here, style), 0, 'au-delà, plus rien');
  const middle = hedgeNearness((inner + outer) / 2, 0, here, style);
  assert.ok(middle > 0.4 && middle < 0.6, 'la bande de transition est linéaire');

  // Sans observateur, la haie est traitée comme lointaine : c’est le repli qui
  // garantit qu’une haie hors contexte reste une haie, et non un tronçon nu.
  assert.equal(hedgeNearness(0, 0, null, style), 0, 'pas d’observateur, pas de détail');
});

test('une haie respire en hauteur et en largeur, et le balayage reste dominant de près', () => {
  const style = HEDGE_STYLES.hedge;
  const path = resamplePath([{ x: 0, z: 0 }, { x: 300, z: 0 }], 3);

  const far = hedgeModulation(path, { style });
  const upSpread = Math.max(...far.up) - Math.min(...far.up);
  const acrossSpread = Math.max(...far.across) - Math.min(...far.across);
  assert.ok(upSpread > 0.25, 'la crête ondule assez pour ne pas lire comme un tube');
  assert.ok(acrossSpread > 0.15, 'les flancs ne sont pas parallèles');

  // Le même tracé, vu du bout : le balayage reste l’essentiel de la lecture
  // même de près — les arbustes ne sont que des accents, ils ne le remplacent
  // pas. Il fléchit un peu, il ne s’efface pas.
  const near = hedgeModulation(path, { style, here: { x: 0, z: 0 } });
  assert.ok(near.up[0] < far.up[0], 'le balayage fléchit un peu au pied de l’observateur');
  assert.ok(near.up[0] > far.up[0] * 0.75, 'mais reste l’essentiel de la silhouette');
  close(near.up[path.length - 1], far.up[path.length - 1], 1e-6, 'au loin, rien n’a changé');

  // Ancré au sol : la même haie repousse identique d’une reconstruction à
  // l’autre, comme tout le reste du décor.
  const again = hedgeModulation(path, { style });
  assert.deepEqual([...again.up], [...far.up], 'le relief ne dépend que du lieu');
});

test('les arbustes d’une haie sont irréguliers mais continus', () => {
  const style = HEDGE_STYLES.hedge;
  const path = resamplePath([{ x: 0, z: 0 }, { x: 120, z: 0 }], 3);
  const clumps = hedgeClumps(path, { style, here: { x: 0, z: 0 } });

  // Assez d’arbustes pour fermer la haie — quelques-uns sont sautés, la haie
  // s’éclaircit là, elle ne s’ouvre pas.
  const nominal = 120 / style.spacingM;
  assert.ok(clumps.length > nominal * 0.75, 'la haie reste continue');
  assert.ok(clumps.length <= nominal, 'quelques arbustes manquent à l’appel');

  const heights = clumps.map((c) => c.height);
  const widths = clumps.map((c) => c.across);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.6, 'les hauteurs sont inégales');
  assert.ok(Math.max(...widths) - Math.min(...widths) > 0.2, 'les largeurs aussi');

  // Aucun ne tombe sur le pas nominal, et aucun ne s’éloigne de l’axe plus que
  // le débattement permis : c’est ce qui distingue une haie d’une plantation.
  for (const clump of clumps) {
    assert.ok(Math.abs(clump.z) <= style.lateralM + 1e-6, 'l’arbuste reste sur la ligne');
  }
  const onGrid = clumps.filter((c) => Math.abs(c.x % style.spacingM) < 1e-6);
  assert.equal(onGrid.length, 0, 'aucun arbuste sur le pas nominal');

  // Sans observateur, aucun arbuste : le balayage seul, comme au loin.
  assert.equal(hedgeClumps(path, { style }).length, 0, 'pas d’observateur, pas d’arbuste');
  // Le plafond est un plafond.
  assert.equal(hedgeClumps(path, { style, here: { x: 0, z: 0 }, limit: 5 }).length, 5, 'plafond tenu');
});

test('les arbustes ne glissent pas quand le tronçon est redécoupé', () => {
  const style = HEDGE_STYLES.hedge;
  // Un tracé assez long pour porter plusieurs arbustes malgré leur nouvel
  // écartement — désormais espacés, ils sont bien moins nombreux au mètre.
  const here = { x: 95, z: 0 };
  const whole = resamplePath([{ x: 0, z: 0 }, { x: 190, z: 0 }], 3);
  // Le même tracé, repris quarante mètres plus loin : c’est ce que fait une
  // reconstruction quand la limite d’agglomération a bougé.
  const tail = resamplePath([{ x: 40, z: 0 }, { x: 190, z: 0 }], 3);

  const fromWhole = hedgeClumps(whole, { style, here });
  const fromTail = hedgeClumps(tail, { style, here, startDistance: 40 });

  // Les deux bouts sont hors comparaison : le ré-échantillonnage tronque le
  // reste d’un pas, donc le tout dernier arbuste peut manquer d’un côté.
  const common = fromWhole.filter((c) => c.x >= 41 && c.x <= 185);
  assert.ok(common.length > 10, 'la portion commune porte de quoi comparer');
  for (const clump of common) {
    const twin = fromTail.find((c) => Math.abs(c.x - clump.x) < 1e-6);
    assert.ok(twin, `l’arbuste de ${clump.x.toFixed(2)} m est resté à sa place`);
    close(twin.height, clump.height, 1e-6, 'et il a gardé sa taille');
  }
});

test('un arbuste de haie est un volume fermé, plus long que large', () => {
  const style = HEDGE_STYLES.hedge;
  const path = resamplePath([{ x: 0, z: 0 }, { x: 60, z: 0 }], 3);
  const [clump] = hedgeClumps(path, { style, here: { x: 0, z: 0 } });
  const buffer = createProfileBuffer();

  assert.ok(appendHedgeClump(buffer, clump, { ground: 100 }));
  const vertices = buffer.positions.length / 3;
  assert.equal(vertices, clump.sides * 3 + 1, 'trois couronnes et une pointe');
  assert.equal(buffer.colors.length, buffer.positions.length, 'une couleur par sommet');
  assert.equal(buffer.indices.length / 3, clump.sides * 5, 'deux bandes et un éventail');
  assert.ok(Math.max(...buffer.indices) < vertices, 'aucun indice ne sort du volume');

  let low = Infinity;
  let high = -Infinity;
  let spanAlong = 0;
  let spanAcross = 0;
  for (let i = 0; i < vertices; i++) {
    low = Math.min(low, buffer.positions[i * 3 + 1]);
    high = Math.max(high, buffer.positions[i * 3 + 1]);
    spanAlong = Math.max(spanAlong, Math.abs(buffer.positions[i * 3] - clump.x));
    spanAcross = Math.max(spanAcross, Math.abs(buffer.positions[i * 3 + 2] - clump.z));
  }
  assert.ok(low >= 100 && low < 100 + clump.height * 0.05, 'le pied est au ras du sol');
  close(high, 100 + clump.height, 1e-6, 'la pointe fait la hauteur annoncée');
  // La haie court vers +x : l’arbuste est étiré le long du tracé et mince en
  // travers, ce qui est la moitié de ce qui la fait lire comme une haie.
  assert.ok(spanAlong > spanAcross, 'plus long le long du tracé qu’en travers');
});

test('les altitudes imposées priment sur le terrain', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
  const buffer = createProfileBuffer();
  const heights = new Float32Array(path.length).fill(7);
  appendProfile(buffer, {
    path,
    profile: FURNITURE_SPECS.profiles.guardrailBeam,
    sampleElevation: () => 999,
    baseHeights: heights,
    closed: true,
  });
  // Une glissière se pose sur la plate-forme de la route, pas sur le terrain
  // qu’elle surplombe — sans quoi elle pendrait dans le vide du remblai.
  close(buffer.positions[1], 7.5, 1e-5, 'lisse posée sur la plate-forme imposée');
});

// --- Espacement du mobilier -------------------------------------------------

test('le mobilier s’espace à pas constant, et compte depuis la ligne d’origine', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 200, z: 0 }], 5);

  // Le rang zéro compte : au tout début d’une voie, la borne 0 existe.
  const fromStart = spacedAlongPath(path, 50, { startDistance: 0 });
  assert.deepEqual(fromStart.map((p) => p.x), [0, 50, 100, 150, 200]);

  // Le même tronçon vu 30 m plus loin dans la ligne d’origine : les objets
  // restent aux mêmes multiples absolus, donc ils ne glissent pas quand le
  // découpage se déplace avec l’observateur.
  const shifted = spacedAlongPath(path, 50, { startDistance: 30 });
  for (const p of shifted) {
    close((p.x + 30) % 50, 0, 1e-6, `borne à un multiple absolu (${p.x})`);
  }
});

test('l’espacement respecte les marges et rend une tangente unitaire', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 5);
  const points = spacedAlongPath(path, 25, { margin: 30 });
  assert.ok(points.every((p) => p.x >= 30 && p.x <= 70), 'marges respectées');
  for (const p of points) close(Math.hypot(p.tx, p.tz), 1, 1e-9, 'tangente unitaire');
});

test('une graine de position ne dépend que du lieu, pas de l’ordre d’appel', () => {
  const a = positionSeed(123.4, -567.8);
  const b = positionSeed(123.4, -567.8);
  assert.equal(a, b, 'même lieu, même graine');
  assert.notEqual(a, positionSeed(123.4, -567.3), 'lieux distincts, graines distinctes');
  const value = randomAt(10, 20);
  assert.ok(value >= 0 && value < 1, 'tirage dans [0, 1[');
});

// --- Contours de parcelles --------------------------------------------------

test('les bords de découpe des tuiles sont reconnus', () => {
  const bounds = tileBounds(8300, 5700, 14);

  const onWest = [
    [bounds.west, (bounds.north + bounds.south) / 2],
    [bounds.west, bounds.south],
  ];
  assert.ok(isTileEdgeSegment(onWest[0], onWest[1], bounds), 'bord ouest');

  const onNorth = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
  ];
  assert.ok(isTileEdgeSegment(onNorth[0], onNorth[1], bounds), 'bord nord');

  const inside = [
    [(bounds.west + bounds.east) / 2, (bounds.north + bounds.south) / 2],
    [(bounds.west + bounds.east) / 2 + 0.001, (bounds.north + bounds.south) / 2 + 0.001],
  ];
  assert.ok(!isTileEdgeSegment(inside[0], inside[1], bounds), 'segment intérieur conservé');
});

test('un contour tranché par la tuile ne rend que ses tronçons réels', () => {
  const bounds = tileBounds(8300, 5700, 14);
  const midLat = (bounds.north + bounds.south) / 2;
  const midLng = (bounds.west + bounds.east) / 2;

  // Parcelle coupée à l’ouest : deux côtés réels, un côté posé sur la frontière.
  const ring = [
    [bounds.west, midLat],
    [midLng, midLat],
    [midLng, bounds.south],
    [bounds.west, bounds.south],
    [bounds.west, midLat],
  ];
  const runs = realBoundaryRuns(ring, bounds);

  // Le côté ouest est un artefact de découpe : planter une haie dessus
  // dessinerait un quadrillage régulier en travers de la campagne.
  assert.ok(runs.length >= 1, 'des tronçons réels subsistent');
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      assert.ok(!isTileEdgeSegment(run[i - 1], run[i], bounds), 'aucun bord de découpe conservé');
    }
  }
});

test('un contour entièrement intérieur ressort d’un seul tenant', () => {
  const bounds = tileBounds(8300, 5700, 14);
  const cx = (bounds.west + bounds.east) / 2;
  const cy = (bounds.north + bounds.south) / 2;
  const d = Math.abs(bounds.east - bounds.west) / 8;
  const ring = [
    [cx - d, cy - d],
    [cx + d, cy - d],
    [cx + d, cy + d],
    [cx - d, cy + d],
    [cx - d, cy - d],
  ];
  assert.equal(realBoundaryRuns(ring, bounds).length, 1);
});

// --- Règles de placement ----------------------------------------------------

test('le traitement d’un contour suit la parcelle et le relief', () => {
  const farmland = { class: 'farmland', subclass: 'farmland' };
  assert.equal(boundaryFurnitureFor(farmland, { steepness: 0.02, variant: 0.1 }), 'hedge');
  // La même parcelle en terrain accidenté se clôt de pierre, pas de bois.
  assert.equal(boundaryFurnitureFor(farmland, { steepness: 0.3 }), 'dryStoneWall');

  const meadow = { class: 'grass', subclass: 'meadow' };
  assert.equal(boundaryFurnitureFor(meadow, { steepness: 0.02, variant: 0.3 }), 'woodFence');
  assert.equal(boundaryFurnitureFor(meadow, { steepness: 0.02, variant: 0.9 }), 'barbedWire');
  // Une pâture sur cinq garde une haie vive : c’est elle qui fait le bocage.
  assert.equal(boundaryFurnitureFor(meadow, { steepness: 0.02, variant: 0.05 }), 'hedge');

  // Un bois n’est pas une parcelle close, et l’eau encore moins.
  assert.equal(boundaryFurnitureFor({ class: 'wood' }), null);
  assert.equal(boundaryFurnitureFor({ class: 'wetland' }), null);
  assert.equal(boundaryFurnitureFor({}), null);
});

test('un champ en culture ne se clôt pas', () => {
  // C’est ce qui compartimentait la campagne à hauteur d’homme : toutes les
  // limites de parcelle portaient la même haie. Ni le blé ni le tournesol ne
  // s’échappent — seul le labour, qui borde des pâtures, en garde parfois une.
  const farmland = { class: 'farmland', subclass: 'farmland' };
  for (const crop of ['wheat', 'maize', 'sunflower', 'vineyard', 'orchard']) {
    assert.equal(boundaryFurnitureFor(farmland, { steepness: 0.02, variant: 0.1, crop }), null, crop);
  }
  assert.equal(boundaryFurnitureFor(farmland, { steepness: 0.02, variant: 0.1, crop: 'plough' }), 'hedge');
  // Et au-delà d’un labour sur deux, plus rien du tout.
  assert.equal(boundaryFurnitureFor(farmland, { steepness: 0.02, variant: 0.8, crop: 'plough' }), null);
});

test('la trame agraire n’est pas la même d’un pays à l’autre', () => {
  // C'est ce qui se lit de plus loin que la couleur d'un mur : un bocage
  // compartimente l'horizon en chambres de deux cents mètres, un openfield le
  // laisse filer, une terrasse méditerranéenne le raye de pierre. Tant que
  // toutes les limites portaient la même haie, une plaine castillane était un
  // bocage normand jauni.
  const pature = { class: 'grass', subclass: 'meadow' };
  const labour = { class: 'farmland', subclass: 'farmland' };
  const plat = { steepness: 0.02 };

  // Un tirage sur vingt : la part de haies vives, par pays.
  const partDe = (cible, properties, climate) => {
    let compte = 0;
    for (let i = 0; i < 20; i++) {
      const item = boundaryFurnitureFor(properties, { ...plat, variant: i / 20, climate });
      if (cible.includes(item)) compte++;
    }
    return compte / 20;
  };

  const haies = ['hedge', 'lowHedge'];
  assert.ok(partDe(haies, labour, 'oceanic') > 0.5, 'le bocage clôt ses labours');
  assert.ok(partDe(haies, labour, 'continental') < 0.25, 'l’openfield, non');
  assert.equal(partDe(haies, labour, 'arid'), 0, 'rien n’entretient une haie en désert');

  const pierre = ['dryStoneWall'];
  assert.equal(partDe(pierre, pature, 'oceanic'), 0, 'pas de muret en plaine humide');
  assert.ok(partDe(pierre, pature, 'mediterraneanMontane') > 0.5, 'la terrasse est en pierre');
  assert.ok(partDe(pierre, pature, 'oceanicUpland') > 0.4, 'les Highlands aussi');

  // Et la pierre sort du premier pli de terrain là où le sol en donne, alors
  // qu'il faut une vraie pente ailleurs.
  const pente = { steepness: 0.1, variant: 0.9 };
  assert.equal(boundaryFurnitureFor(pature, { ...pente, climate: 'mediterranean' }), 'dryStoneWall');
  assert.notEqual(boundaryFurnitureFor(pature, { ...pente, climate: 'oceanic' }), 'dryStoneWall');
});

test('sans climat, la trame agraire est celle d’avant', () => {
  // Le repli doit être **exactement** le bocage français d'origine : sinon
  // toute la campagne change le jour où la grille climatique ne répond pas.
  const pature = { class: 'grass', subclass: 'meadow' };
  const labour = { class: 'farmland', subclass: 'farmland' };
  //
  // Les tirages sont décalés d'un demi-pas pour ne tomber sur aucun seuil
  // exact : la somme cumulée de `pickShare` peut s'écarter d'un ulp de la
  // constante écrite (0,2 + 0,38 ne vaut pas 0,58 en binaire), et un tirage
  // réel n'atteint jamais une borne au bit près.
  for (let i = 0; i < 50; i++) {
    const variant = (i + 0.5) / 50;
    const attenduLabour = variant < 0.4 ? 'hedge' : variant < 0.62 ? 'lowHedge' : null;
    const attenduPature = variant < 0.2 ? 'hedge' : variant < 0.58 ? 'woodFence' : 'barbedWire';
    assert.equal(boundaryFurnitureFor(labour, { steepness: 0.02, variant }), attenduLabour, `labour ${variant}`);
    assert.equal(boundaryFurnitureFor(pature, { steepness: 0.02, variant }), attenduPature, `pâture ${variant}`);
  }
  // Et un climat que la table ne connaît pas retombe dessus.
  assert.equal(
    boundaryFurnitureFor(labour, { steepness: 0.02, variant: 0.1, climate: 'climat-inconnu' }),
    'hedge'
  );
});

test('la culture d’un champ est tirée une fois par parcelle', () => {
  // Les sous-classes que le schéma porte vraiment priment sur le tirage.
  assert.equal(cropFor({ class: 'farmland', subclass: 'vineyard' }, 0.1), 'vineyard');
  assert.equal(cropFor({ class: 'farmland', subclass: 'orchard' }, 0.9), 'orchard');
  assert.equal(cropFor({ class: 'grass' }, 0.5), null);

  // Toutes les cultures sortent au moins une fois, et aucune ne domine.
  const seen = new Map();
  for (let i = 0; i < 200; i++) {
    const crop = cropFor({ class: 'farmland' }, i / 200);
    seen.set(crop, (seen.get(crop) || 0) + 1);
  }
  for (const crop of ['wheat', 'maize', 'sunflower', 'vineyard', 'orchard', 'plough']) {
    assert.ok(seen.get(crop) > 0, `${crop} apparaît`);
    assert.ok(seen.get(crop) < 120, `${crop} ne domine pas (${seen.get(crop)})`);
  }
});

test('l’assolement suit le climat, et la donnée passe avant lui', () => {
  const field = { class: 'farmland' };
  const share = (climate) => {
    const seen = new Map();
    for (let i = 0; i < 500; i++) {
      const crop = cropFor(field, i / 500, climate);
      seen.set(crop, (seen.get(crop) || 0) + 1);
    }
    return seen;
  };

  // Ni maïs ni tournesol au nord : la saison est trop courte, et un champ de
  // tournesol en Laponie se remarque immédiatement.
  const boreal = share('boreal');
  assert.equal(boreal.get('maize'), undefined);
  assert.equal(boreal.get('sunflower'), undefined);
  assert.equal(boreal.get('vineyard'), undefined);
  // Au sud, la vigne et le verger portent le paysage agricole.
  const midi = share('mediterranean');
  assert.ok(midi.get('vineyard') + midi.get('orchard') > midi.get('wheat'));
  // En désert, la terre nue domine et le blé est marginal.
  const desert = share('arid');
  assert.ok(desert.get('plough') > 300);

  // Une vigne cartographiée reste une vigne, où qu’elle soit : le climat ne
  // décide que de ce que la donnée ignore.
  assert.equal(cropFor({ class: 'farmland', subclass: 'vineyard' }, 0.1, 'boreal'), 'vineyard');
});

test('l’assolement par défaut est celui d’une campagne française', () => {
  // Les seuils étaient écrits en dur ; ils sont maintenant une table. Le blé
  // domine, le labour vient ensuite, et le colza tient sa part — mais pas la
  // lavande, qui est une culture de pays et non un repli.
  const parts = new Map();
  for (const [crop, share] of DEFAULT_CROP_MIX) parts.set(crop, (parts.get(crop) || 0) + share);
  assert.equal(parts.get('wheat'), 0.3);
  close(parts.get('plough'), 0.2, 1e-9, 'labour');
  assert.ok(parts.get('rapeseed') > 0, 'le colza est semé sans climat connu');
  assert.equal(parts.get('lavender'), undefined, 'la lavande demande un pays');
  close([...parts.values()].reduce((a, b) => a + b, 0), 1, 1e-9, 'les parts font un tout');

  // Chaque assolement de climat est complet : une somme sous un rend la
  // dernière culture plus fréquente qu’écrit, en silence.
  for (const [family, mix] of Object.entries(CROP_MIXES)) {
    const total = mix.reduce((sum, [, share]) => sum + share, 0);
    close(total, 1, 1e-9, `${family} : les parts font un tout`);
    for (const [crop] of mix) assert.ok(CROP_KINDS.includes(crop), `${family} : ${crop} existe`);
  }
  // Le tirage est déterministe et couvre les deux bords.
  assert.equal(pickShare([['wheat', 0.5], ['plough', 0.5]], 0), 'wheat');
  assert.equal(pickShare([['wheat', 0.5], ['plough', 0.5]], 0.999), 'plough');
});

test('ce qui se sème dans un champ dépend de sa culture', () => {
  assert.equal(scatterFurnitureFor({ class: 'farmland', subclass: 'farmland' }).item, 'hay');
  // Un champ **en culture** n’a rien à semer par-dessus : c’est la couche de
  // culture qui le couvre, et une botte de foin dans le tournesol se lit comme
  // une erreur.
  assert.equal(scatterFurnitureFor({ class: 'farmland' }, { crop: 'sunflower' }), null);
  assert.equal(scatterFurnitureFor({ class: 'farmland' }, { crop: 'plough' }).item, 'hay');
  // Une pâture porte du bétail, pas des bosquets.
  assert.equal(scatterFurnitureFor({ class: 'grass', subclass: 'meadow' }).item, 'herd');
  // Un bois porte du bois de coupe — mais c'est l'ourlet qui décide où, pas la
  // règle : au milieu d'un massif, un tas de bois n'a rien à faire.
  assert.equal(scatterFurnitureFor({ class: 'wood' }).item, 'woodland');
  assert.ok(WOOD_PILE_EDGE_MIN > 0 && WOOD_PILE_EDGE_MIN < 1, 'seuil de lisière plausible');
  // Une classe qu'on ne sait pas lire ne sème rien.
  assert.equal(scatterFurnitureFor({ class: 'quarry' }), null);
});

test('le gibier d’un bois est celui du pays', () => {
  // Même massif, même tirage : seul le pays change. Le renne remplace le
  // cervidé au nord, le sanglier domine au sud.
  //
  // La domination se mesure sur la table entière et non sur un tirage précis :
  // écrite sur un `variant` choisi, l'assertion cassait au premier ajout
  // d'espèce sans que rien du sens n'ait bougé.
  const share = (pool, item) => pool.filter((k) => k === item).length / pool.length;
  assert.ok(share(FOREST_GAME.boreal, 'reindeer') >= 0.5, 'le renne domine la taïga');
  assert.ok(share(FOREST_GAME.mediterranean, 'boar') >= 0.5, 'le sanglier domine la chênaie');
  assert.ok(!FOREST_GAME.mediterranean.includes('reindeer'), 'pas de renne en Provence');
  assert.ok(!FOREST_GAME.boreal.includes('boar'), 'pas de sanglier en Laponie');
  assert.equal(forestGameFor({ variant: 0.1, climate: 'oceanic' }).item, 'deer');
  // Là où il n’y a pas de forêt, il n’y a rien à voir — et surtout pas un
  // chevreuil au milieu des Bardenas.
  assert.equal(forestGameFor({ variant: 0.5, climate: 'arid' }), null);
  assert.equal(forestGameFor({ variant: 0.5, climate: 'glacial' }), null);
  // Sans climat connu, un bois tempéré.
  assert.deepEqual(
    forestGameFor({ variant: 0.5 }),
    forestGameFor({ variant: 0.5, climate: 'pays-inconnu' })
  );

  // Le sanglier va en compagnie serrée, le cervidé en harde lâche.
  assert.ok(
    forestGameFor({ variant: 0, climate: 'mediterranean' }).spread <
      forestGameFor({ variant: 0, climate: 'boreal' }).spread
  );

  // Toute la table tire dans des silhouettes qui existent, et couvre toutes
  // les familles : une famille oubliée retomberait silencieusement sur le
  // gibier tempéré, ce qui se verrait en Laponie. Les bêtes ne sont plus au
  // catalogue du mobilier : elles bougent, donc elles sont dans `models/fauna`.
  for (const family of CLIMATE_FAMILIES) {
    assert.ok(FOREST_GAME[family], `${family} : gibier décrit`);
    assert.ok(FOREST_PREDATORS[family], `${family} : carnassiers décrits`);
    for (const item of FOREST_GAME[family]) {
      assert.ok(FAUNA_BUILDERS[item], `${family} : ${item} au catalogue`);
    }
    for (const item of FOREST_PREDATORS[family]) {
      assert.ok(FAUNA_BUILDERS[item], `${family} : ${item} au catalogue`);
    }
  }
  for (const item of DEFAULT_FOREST_GAME) assert.ok(FAUNA_BUILDERS[item], item);
  for (const item of DEFAULT_FOREST_PREDATORS) assert.ok(FAUNA_BUILDERS[item], item);

  // Le gibier reste rare : un bois sur deux ne montre rien, et on en croise
  // sans jamais en compter. Les seuils ont été desserrés en même temps que
  // les bêtes sont devenues animées — voir `FOREST_GAME_EMPTY_ODDS`.
  assert.ok(FOREST_GAME_EMPTY_ODDS > 0.35, 'beaucoup de bois ne montrent rien');
  assert.ok(FOREST_GAME_PER_HECTARE < 0.5, 'de quoi en croiser, pas de quoi en compter');
});

test('les carnassiers se tirent à part du gibier, et restent rares', () => {
  // Le second tirage décide seul de la famille : au-dessus du seuil c'est du
  // gibier, en dessous c'est un carnassier — quel que soit `variant`.
  const game = forestGameFor({ variant: 0.5, predatorDraw: 0.9, climate: 'continental' });
  assert.equal(game.solitary, false);
  assert.ok(['deer', 'doe', 'boar'].includes(game.item));

  const hunter = forestGameFor({ variant: 0.5, predatorDraw: 0.01, climate: 'continental' });
  assert.equal(hunter.solitary, true);
  assert.ok(['fox', 'wolf'].includes(hunter.item));

  // Sans second tirage, on ne tombe jamais sur un carnassier : c'est la
  // valeur par défaut, et elle doit rester du côté du gibier.
  assert.equal(forestGameFor({ variant: 0.5, climate: 'boreal' }).solitary, false);

  // Là où la glace couvre tout, il n'y a ni gibier ni carnassier : le repli
  // ne doit pas ramener un renard sur un glacier.
  assert.equal(forestGameFor({ variant: 0.5, predatorDraw: 0, climate: 'glacial' }), null);

  // Rare, et à garder rare : un loup par bois cesse d'être un loup.
  assert.ok(PREDATOR_ODDS < 0.25, 'un carnassier reste un événement');
  assert.ok(PREDATOR_MAX <= 3, 'ils ne vont pas en horde');
});

test('un tas de bois se range le long de la lisière', () => {
  // Bois dans le demi-plan x < 0 : sa lisière court donc selon Z.
  const layer = Object.create(FurnitureLayer.prototype);
  layer.groundClass = { woodAt: (x) => (x < 0 ? 1 : 0) };
  const yaw = layer._woodEdgeYaw(0, 0);

  // Les rondins de `woodPile` sont couchés selon Z : après le lacet, ils
  // doivent border le bois, pas y entrer.
  const [dx, , dz] = Kit.transform([0, 0, 1], { yaw });
  close(Math.abs(dz), 1, 1e-9, 'les rondins suivent la lisière');
  close(dx, 0, 1e-9, 'et ne pointent pas vers le bois');

  // Une lisière tournée d'un quart de tour tourne la pile d'autant.
  const autre = Object.create(FurnitureLayer.prototype);
  autre.groundClass = { woodAt: (x, z) => (z < 0 ? 1 : 0) };
  const [ax, , az] = Kit.transform([0, 0, 1], { yaw: autre._woodEdgeYaw(0, 0) });
  close(Math.abs(ax), 1, 1e-9, 'lisière est-ouest');
  close(az, 0, 1e-9);

  // Sans pente lisible, le cap est tiré au lieu : sinon toutes les piles d'une
  // clairière ronde s'aligneraient sur le même axe.
  const plat = Object.create(FurnitureLayer.prototype);
  plat.groundClass = { woodAt: () => 1 };
  assert.notEqual(plat._woodEdgeYaw(0, 0, 0.3), plat._woodEdgeYaw(0, 0, 0.7));
});

test('le bétail suit le terrain : bovins en plaine, ovins sur les pentes', () => {
  // Le tirage est le même de part et d’autre : c’est la pente seule qui doit
  // faire basculer l’espèce.
  assert.equal(herdFor({ steepness: 0.02, variant: 0.5 }).item, 'cow');
  assert.equal(herdFor({ steepness: 0.3, variant: 0.5 }).item, 'sheep');
  // Un troupeau de moutons se tient plus serré qu’un troupeau de vaches.
  assert.ok(herdFor({ steepness: 0.3, variant: 0.1 }).spread < herdFor({ steepness: 0, variant: 0.9 }).spread);
});

test('le bétail d’une pâture est celui du pays', () => {
  // Même pente, même tirage : seul le pays change. Une plaine irlandaise et un
  // causse castillan portaient jusqu’ici le même troupeau.
  const plaine = { steepness: 0.02, variant: 0.5 };
  assert.equal(herdFor({ ...plaine, climate: 'oceanic' }).item, 'cow');
  assert.equal(herdFor({ ...plaine, climate: 'arid' }).item, 'sheep');
  assert.equal(herdFor({ ...plaine, climate: 'oceanicUpland' }).item, 'sheep');
  assert.equal(herdFor({ ...plaine, climate: 'boreal' }).item, 'cow');

  // Sans climat, exactement le comportement d’avant.
  assert.equal(herdFor(plaine).item, herdFor({ ...plaine, climate: 'inconnu' }).item);
  assert.equal(DEFAULT_SHEEP_ODDS, 0.34);

  // La pente prime toujours : un pays à vaches en montagne reste un pays à
  // moutons et à chèvres, sinon la règle de pente aurait été perdue en route.
  assert.equal(herdFor({ steepness: 0.3, variant: 0.5, climate: 'oceanic' }).item, 'sheep');
  assert.equal(herdFor({ steepness: 0.4, variant: 0.2, climate: 'oceanic' }).item, 'goat');

  // Toutes les familles annoncées sont des parts valides.
  for (const [family, odds] of Object.entries(HERD_SHEEP_ODDS)) {
    assert.ok(odds > 0 && odds < 1, `${family} : part d’ovins plausible (${odds})`);
  }
});

test('un troupeau se regroupe, un semis se répartit', () => {
  const spreadOut = scatterInRing(square, 14, 4242);
  const clustered = scatterInRing(square, 14, 4242, { cluster: 0.3 });

  const extent = (points) => {
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  };

  assert.ok(clustered.length > 0, 'le troupeau existe');
  assert.ok(extent(clustered) < extent(spreadOut), 'le troupeau occupe moins de terrain');
  for (const p of clustered) assert.ok(pointInRing(square, p.x, p.z), 'bête hors du pré');
  // Déterministe comme le reste : les bêtes ne se téléportent pas d’une
  // reconstruction à l’autre.
  assert.deepEqual(scatterInRing(square, 14, 4242, { cluster: 0.3 }), clustered);
});

test('le mobilier de bord de route regarde du bon côté', () => {
  // Route vers l’est : tangente (1, 0). L’axe z pointant au sud, la gauche de la
  // marche est au nord, donc en -z, et un décalage positif y place l’objet.
  const tx = 1;
  const tz = 0;

  // Un objet posé à gauche (nord, z négatif) qui regarde la route doit regarder
  // vers le sud, c’est-à-dire +z : lacet nul. C’est *exactement* le signe qui
  // était inversé, et qui tournait tout le mobilier vers le champ d’en face.
  close(roadsideYaw(tx, tz, 4, 'road'), 0, 1e-9, 'objet à gauche, tourné vers la route');
  // Et posé à droite (sud), il regarde vers le nord : demi-tour.
  close(Math.abs(roadsideYaw(tx, tz, -4, 'road')), Math.PI, 1e-9, 'objet à droite');

  // Dans l’axe : le +Z de la pièce suit le sens de la marche.
  close(roadsideYaw(tx, tz, 4, 'along'), Math.PI / 2, 1e-9, 'dans l’axe de la route');

  // Face au trafic : posé à droite (circulation à droite), le panneau s’adresse
  // aux véhicules qui remontent dans le sens de la marche, donc il regarde en
  // arrière.
  close(roadsideYaw(tx, tz, -4, 'traffic'), -Math.PI / 2, 1e-9, 'panneau face au trafic');
  close(roadsideYaw(tx, tz, 4, 'traffic'), Math.PI / 2, 1e-9, 'panneau de l’autre sens');
});

test('la direction rendue est bien celle que la rotation applique', () => {
  // L’invariant qui compte : une pièce modelée face à +Z, tournée du lacet
  // rendu, doit pointer vers la chaussée. On refait donc la rotation à la main.
  for (const [tx, tz] of [[1, 0], [0, 1], [0.6, -0.8], [-0.5, -Math.sqrt(3) / 2]]) {
    for (const offset of [3, -3]) {
      const yaw = roadsideYaw(tx, tz, offset, 'road');
      // +Z tourné du lacet : (sin, cos).
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // Direction attendue : de l’objet vers l’axe, soit l’opposé du décalage.
      const side = offset >= 0 ? 1 : -1;
      close(fx, -side * tz, 1e-9, 'composante x');
      close(fz, side * tx, 1e-9, 'composante z');
    }
  }
});

test('les densités de bord de route restent desserrées', () => {
  // Ce test protège une décision de décor, pas un calcul : un mobilier
  // procédural s’additionne le long d’une route qu’on parcourt, et la densité
  // réglementaire y paraît saturée. Le jour où ces valeurs redescendent, c’est
  // qu’on a réintroduit la surcharge.
  const major = roadsideFurnitureFor('major', { builtUp: false });
  assert.ok(major.utilityPole >= 55, `poteaux espacés (${major.utilityPole} m)`);
  assert.ok(major.alignmentTree >= 14, `alignement aéré (${major.alignmentTree} m)`);

  const street = roadsideFurnitureFor('major', { builtUp: true });
  assert.ok(street.lamp >= 34, `lampadaires espacés (${street.lamp} m)`);
  // Un carrefour d’agglomération porte un feu ; en rase campagne, non.
  assert.equal(street.trafficLight, true);
  assert.equal(major.trafficLight, false);
  assert.equal(roadsideFurnitureFor('lane', { builtUp: true }).trafficLight, false, 'pas de feu sur une desserte');
});

test('le mobilier de bord de route distingue la rue de la route', () => {
  const street = roadsideFurnitureFor('minor', { builtUp: true });
  assert.ok(street.lamp > 0, 'une rue est éclairée');
  assert.equal(street.utilityPole, null, 'et ne porte pas de ligne aérienne');
  assert.equal(street.hedge, false, 'ni de haie');

  const country = roadsideFurnitureFor('minor', { builtUp: false });
  assert.equal(country.lamp, null, 'une route de campagne n’est pas éclairée');
  assert.ok(country.utilityPole > 0, 'mais elle porte des poteaux');
  assert.equal(country.hedge, true);

  // Bornes hectométriques et kilométriques ne cohabitent que sur les grandes
  // routes ; un sentier ne porte rien du tout.
  const major = roadsideFurnitureFor('major', { builtUp: false });
  assert.equal(major.milestone, 100);
  assert.equal(major.kilometreStone, 1000);
  assert.ok(major.alignmentTree > 0, 'alignement hors agglomération');

  const path = roadsideFurnitureFor('path', { builtUp: false });
  assert.equal(path.guardrail, false);
  assert.equal(path.sign, null);
});

test('la pente en travers désigne le versant amont', () => {
  // Gauche plus haute que droite : le versant monte à gauche de la marche.
  const left = crossSlope(120, 100, 20);
  close(left.slope, 1, 1e-9, 'pente relative');
  assert.equal(left.uphill, 1);

  const right = crossSlope(100, 106, 20);
  close(right.slope, 0.3, 1e-9);
  assert.equal(right.uphill, -1);
});

test('les tronçons raides sont contigus et assez longs pour valoir une glissière', () => {
  const rows = [1, 1, 0, 1, 1, 1, 1, 1, 0, 1];
  const runs = contiguousRuns(rows, (v) => v === 1, 4);
  // Deux échantillons isolés ne font pas une glissière : posée sur dix mètres
  // au milieu d’un plateau, elle se lirait comme un défaut.
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 5);
});


// ---------------------------------------------------------------------------
// Le vivant : modèles articulés (models/fauna), conduites (faunaMotion)
// ---------------------------------------------------------------------------

/** Le peu de `THREE` dont une géométrie de faune a besoin. */
function fakeFaunaTHREE() {
  class Attribute {
    constructor(array, itemSize) {
      this.array = Float32Array.from(array);
      this.itemSize = itemSize;
      this.count = this.array.length / itemSize;
    }
  }
  return {
    FrontSide: 0,
    BufferGeometry: class {
      constructor() {
        this.attributes = {};
      }
      setAttribute(name, attribute) {
        this.attributes[name] = attribute;
        return this;
      }
      getAttribute(name) {
        return this.attributes[name];
      }
      computeBoundingSphere() {}
      dispose() {}
    },
    Float32BufferAttribute: Attribute,
    InstancedBufferAttribute: Attribute,
    MeshLambertMaterial: class {
      constructor(options) {
        Object.assign(this, options, { userData: {} });
      }
    },
  };
}

/**
 * Un three de service, suffisant pour instancier `FaunaLayer` : les mêmes
 * primitives que `fakeFaunaTHREE`, plus ce qu'il faut pour composer une
 * matrice et porter des instances. Rien n'y dessine — on vérifie ce que la
 * couche décide, pas ce qu'elle rend.
 */
function fakeSceneTHREE() {
  const base = fakeFaunaTHREE();
  return {
    ...base,
    DynamicDrawUsage: 0,
    Group: class {
      constructor() {
        this.children = [];
      }
      add(child) {
        this.children.push(child);
      }
      remove(child) {
        this.children = this.children.filter((c) => c !== child);
      }
    },
    Matrix4: class {
      compose() {
        return this;
      }
    },
    Vector3: class {
      set() {
        return this;
      }
      setScalar() {
        return this;
      }
    },
    Quaternion: class {
      setFromEuler() {
        return this;
      }
    },
    Euler: class {
      set() {
        return this;
      }
    },
    Color: class {
      setRGB() {
        return this;
      }
    },
    InstancedMesh: class {
      constructor(geometry, material, capacity) {
        this.geometry = geometry;
        this.material = material;
        this.count = capacity;
        this.instanceMatrix = { count: capacity, setUsage() {}, needsUpdate: false };
        this.instanceColor = { needsUpdate: false };
      }
      setColorAt() {}
      setMatrixAt() {}
      dispose() {}
    },
  };
}

/** Une scène de service : elle ne fait qu'accueillir et rendre un groupe. */
function fakeScene() {
  return { children: [], add(child) { this.children.push(child); }, remove() {} };
}

/** Les sommets d'un membre donné, dans un assembleur déjà bâti. */
function limbVertices(kit, limb) {
  const out = [];
  for (let v = 0; v < kit.vertexCount; v++) {
    if (kit.limbs[v] !== limb) continue;
    out.push({ x: kit.positions[v * 3], y: kit.positions[v * 3 + 1], z: kit.positions[v * 3 + 2] });
  }
  return out;
}

test('chaque bête du catalogue se bâtit, repose au sol, et a de quoi être détaillée', () => {
  assert.ok(FAUNA_KINDS.length >= 12, `catalogue fourni (${FAUNA_KINDS.length} espèces)`);

  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);
    assert.equal(kit.positions.length % 9, 0, `${kind} : triangles complets`);
    assert.equal(kit.normals.length, kit.positions.length, `${kind} : une normale par sommet`);
    assert.equal(kit.colors.length, kit.positions.length, `${kind} : une couleur par sommet`);
    assert.equal(kit.limbs.length, kit.vertexCount, `${kind} : un membre par sommet`);
    assert.equal(kit.pivots.length, kit.vertexCount * 3, `${kind} : un pivot par sommet`);
    assert.equal(kit.coats.length, kit.vertexCount, `${kind} : un masque de robe par sommet`);

    // Le grief d'origine : une bête faite de six boîtes se lit comme une
    // caisse à pattes à quinze mètres. Le seuil ne dit pas que le modèle est
    // beau, il dit qu'il n'est pas retombé à l'état de boîtes.
    const triangles = kit.vertexCount / 3;
    assert.ok(triangles >= 150, `${kind} : de quoi tenir un galbe (${triangles} triangles)`);
    assert.ok(triangles <= 700, `${kind} : mais on reste en low poly (${triangles} triangles)`);

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < kit.positions.length; i += 3) {
      minY = Math.min(minY, kit.positions[i]);
      maxY = Math.max(maxY, kit.positions[i]);
    }
    // Origine au pied, comme le mobilier : une bête dont la base flotte
    // lévite une fois posée sur le terrain.
    assert.ok(Math.abs(minY) < 0.06, `${kind} : les pieds touchent le sol (${minY.toFixed(3)})`);
    assert.ok(maxY > 0.3, `${kind} : de la hauteur (${maxY.toFixed(2)})`);
  }
});

test('le masque de robe ne porte que sur des gris — sinon la teinte d’instance ment', () => {
  // La teinte d'instance **multiplie** la couleur de sommet. Un sommet de robe
  // doit donc être un niveau de gris : lui donner une vraie couleur ferait un
  // produit de deux teintes, c'est-à-dire n'importe quoi.
  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);
    let coated = 0;
    let fixed = 0;
    for (let v = 0; v < kit.vertexCount; v++) {
      const [r, g, b] = [kit.colors[v * 3], kit.colors[v * 3 + 1], kit.colors[v * 3 + 2]];
      assert.ok(kit.coats[v] === 0 || kit.coats[v] === 1, `${kind} : masque binaire`);
      if (kit.coats[v] === 1) {
        coated++;
        close(r, g, 1e-9, `${kind} : la robe est un gris`);
        close(g, b, 1e-9, `${kind} : la robe est un gris`);
      } else {
        fixed++;
      }
    }
    assert.ok(coated > 0, `${kind} : une robe teintable`);
    // Sabots, cornes, mufle, œil : ce qui ne doit pas suivre la robe.
    assert.ok(fixed > 0, `${kind} : des parties qui résistent à la teinte`);
  }
});

test('un membre tourne autour de son attache, jamais autour du sol', () => {
  // C'est l'erreur que rien dans le rendu ne signale : une patte dont le
  // pivot est au pied tourne comme une aiguille de montre, et la bête a
  // simplement l'air de patiner.
  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);

    // Le tronc ne tourne pas : son pivot est l'origine, et c'est ce que le
    // shader teste pour l'épargner.
    for (let v = 0; v < kit.vertexCount; v++) {
      if (kit.limbs[v] !== LIMB.BODY) continue;
      assert.equal(kit.pivots[v * 3], 0, `${kind} : le tronc n'a pas de pivot`);
      assert.equal(kit.pivots[v * 3 + 1], 0);
      assert.equal(kit.pivots[v * 3 + 2], 0);
    }

    for (const limb of LEGS) {
      const points = limbVertices(kit, limb);
      if (points.length === 0) continue; // la poule n'a que deux pattes
      const index = kit.limbs.indexOf(limb);
      const pivotY = kit.pivots[index * 3 + 1];
      const highest = Math.max(...points.map((p) => p.y));
      const lowest = Math.min(...points.map((p) => p.y));
      // La tolérance n'est pas de la complaisance : un tronçon incliné
      // (`bone`) dépasse d'un centimètre ou deux au-dessus de son attache,
      // par le coin de sa section. Ce qui compte est que le pivot soit en
      // haut de la patte et pas en bas.
      assert.ok(
        pivotY >= highest - 0.04,
        `${kind} : l'attache de la patte ${limb} est en haut (${pivotY.toFixed(2)} contre ${highest.toFixed(2)})`
      );
      assert.ok(
        pivotY > (lowest + highest) / 2,
        `${kind} : l'attache de la patte ${limb} est du côté de l'épaule`
      );
      assert.ok(pivotY > 0.05, `${kind} : l'attache de la patte ${limb} n'est pas au sol`);
    }

    // L'encolure part du pivot vers le haut : le pivot est donc sous la tête.
    const head = limbVertices(kit, LIMB.HEAD);
    assert.ok(head.length > 0, `${kind} : une tête articulée`);
    const headIndex = kit.limbs.indexOf(LIMB.HEAD);
    const headPivotY = kit.pivots[headIndex * 3 + 1];
    assert.ok(headPivotY < Math.max(...head.map((p) => p.y)), `${kind} : l'encolure monte depuis son attache`);
  }
});

test('les quadrupèdes ont bien quatre pattes, et la poule deux', () => {
  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);
    const legs = LEGS.filter((limb) => limbVertices(kit, limb).length > 0);
    const expected = kind === 'chicken' ? 2 : 4;
    assert.equal(legs.length, expected, `${kind} : ${expected} pattes`);
  }
});

test('l’angle de broutage amène vraiment le museau dans l’herbe', () => {
  // Le reproche de départ : une bête qui mime le broutage trente centimètres
  // au-dessus du sol. L'angle n'est pas réglé à la main mais déduit du modèle
  // (`grazeAngleFor`) — ce test vérifie que la déduction tient pour chacune.
  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);
    assert.ok(kit.muzzlePoint, `${kind} : le museau est déclaré`);
    assert.ok(kit.headPivot, `${kind} : l'attache d'encolure est déclarée`);

    const angle = grazeAngleFor(kit);
    assert.ok(angle > 0.3, `${kind} : l'encolure se rabat vraiment (${angle.toFixed(2)} rad)`);
    assert.ok(angle <= GRAZE_MAX_RAD + 1e-9, `${kind} : et pas au-delà du plié possible`);

    const dy = kit.muzzlePoint[1] - kit.headPivot[1];
    const dz = kit.muzzlePoint[2] - kit.headPivot[2];
    const muzzleY = kit.headPivot[1] + dy * Math.cos(angle) - dz * Math.sin(angle);
    assert.ok(muzzleY < 0.25, `${kind} : le museau descend dans l'herbe (${muzzleY.toFixed(3)} m)`);
    assert.ok(muzzleY > -0.2, `${kind} : sans s'enfoncer dans le sol (${muzzleY.toFixed(3)} m)`);
  }
});

test('la forme close de l’angle de broutage vaut le balayage numérique', () => {
  // La forme close est la seule chose ici qu'on ne puisse pas relire : on la
  // confronte au balayage qu'elle remplace.
  //
  // Le museau décrit un cercle : il passe **deux fois** par la hauteur visée,
  // en descendant puis en remontant de l'autre côté. Seule la première
  // compte — la seconde, c'est une encolure qui a basculé sous le poitrail.
  // Le balayage cherche donc la première descente, pas la meilleure racine.
  for (const kind of FAUNA_KINDS) {
    const kit = FAUNA_BUILDERS[kind](defaultTheme.fauna.colors);
    const dy = kit.muzzlePoint[1] - kit.headPivot[1];
    const dz = kit.muzzlePoint[2] - kit.headPivot[2];
    const heightAt = (a) => kit.headPivot[1] + dy * Math.cos(a) - dz * Math.sin(a);

    let first = null;
    let lowest = 0;
    let lowestY = Infinity;
    for (let step = 0; step <= 40000; step++) {
      const a = (step / 40000) * GRAZE_MAX_RAD;
      const y = heightAt(a);
      if (y < lowestY) {
        lowestY = y;
        lowest = a;
      }
      if (first === null && y <= GRAZE_TARGET_M) first = a;
    }
    // Encolure trop courte pour atteindre la cible : l'angle attendu est
    // celui qui descend le plus bas — une bête qui tend le cou au maximum.
    close(grazeAngleFor(kit), first ?? lowest, 2e-3, `${kind} : même angle que le balayage`);
  }
});

test('sans museau déclaré, l’angle de broutage est nul plutôt que faux', () => {
  assert.equal(grazeAngleFor(null), 0);
  assert.equal(grazeAngleFor({}), 0);
  assert.equal(grazeAngleFor({ headPivot: [0, 1, 0], muzzlePoint: null }), 0);
  // Museau confondu avec l'attache : aucune rotation ne le déplace.
  assert.equal(grazeAngleFor({ headPivot: [0, 1, 0], muzzlePoint: [0, 1, 0] }), 0);
});

test('le matériau du vivant greffe bien ses quatre morceaux dans le shader', () => {
  // Une greffe par `replace` échoue **en silence** : si three renomme un
  // chunk, le shader compile toujours et l'animation disparaît sans erreur.
  const material = createFaunaMaterial(fakeFaunaTHREE());
  const shader = {
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <color_vertex>',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
      '}',
    ].join('\n'),
  };
  material.onBeforeCompile(shader);

  for (const attribute of ['aLimb', 'aPivot', 'aCoat', 'aMotion']) {
    assert.ok(shader.vertexShader.includes(`attribute`), 'des attributs déclarés');
    assert.ok(shader.vertexShader.includes(attribute), `${attribute} est utilisé`);
  }
  assert.ok(shader.vertexShader.includes('mat3 faunaJointRotation()'), 'la rotation est définie');
  assert.ok(shader.vertexShader.includes('objectNormal = faunaJointRotation()'), 'la normale suit le membre');
  assert.ok(shader.vertexShader.includes('transformed = aPivot + faunaJointRotation()'), 'la position suit le membre');
  assert.ok(shader.vertexShader.includes('mix(color.xyz'), 'la teinte ne porte que sur la robe');

  // Les noms d'attributs viennent d'`animalKit` : les recopier dans le shader
  // les ferait diverger au premier renommage.
  assert.ok(shader.vertexShader.includes(LIMB_ATTRIBUTE));
  assert.ok(shader.vertexShader.includes(MOTION_ATTRIBUTE));
});

test('les deux greffes du shader ne dépendent pas l’une de l’autre', () => {
  // Dans le shader du `MeshBasicMaterial`, three enferme déjà
  // `<beginnormal_vertex>` dans un `#if` : une variable déclarée là ne serait
  // pas en portée à `<begin_vertex>`. Rien ne garantit que le lambertien y
  // échappera toujours, et l'échec serait une erreur de compilation.
  //
  // On le vérifie en inversant l'ordre des deux chunks : les deux greffes
  // doivent rester valides.
  const material = createFaunaMaterial(fakeFaunaTHREE());
  const shader = {
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <color_vertex>',
      '#include <begin_vertex>',
      '#include <beginnormal_vertex>',
      '}',
    ].join('\n'),
  };
  material.onBeforeCompile(shader);

  const lines = shader.vertexShader.split('\n');
  const declared = lines.findIndex((l) => l.includes('mat3 faunaJointRotation()'));
  const usedByPosition = lines.findIndex((l) => l.includes('transformed = aPivot'));
  const usedByNormal = lines.findIndex((l) => l.includes('objectNormal = faunaJointRotation()'));
  assert.ok(declared >= 0 && usedByPosition > declared, 'la fonction est définie avant son premier usage');
  assert.ok(usedByNormal > declared, 'et avant le second');
  // Aucune variable partagée entre les deux greffes : chacune se suffit.
  assert.ok(!shader.vertexShader.includes('mat3 faunaJoint ='), 'pas de variable partagée entre les greffes');
});

test('les géométries du vivant portent leurs attributs d’articulation', () => {
  const { geometries, grazeRad } = createFaunaGeometries(fakeFaunaTHREE(), defaultTheme.fauna.colors);
  for (const kind of FAUNA_KINDS) {
    const geometry = geometries[kind];
    const vertices = geometry.attributes.position.count;
    assert.equal(geometry.attributes.aLimb.count, vertices, `${kind} : un membre par sommet`);
    assert.equal(geometry.attributes.aPivot.count, vertices, `${kind} : un pivot par sommet`);
    assert.equal(geometry.attributes.aCoat.count, vertices, `${kind} : une robe par sommet`);
    assert.equal(geometry.attributes.aPivot.itemSize, 3);
    assert.ok(grazeRad[kind] > 0, `${kind} : un angle de broutage`);

    for (const limb of geometry.attributes.aLimb.array) {
      assert.ok(limb >= 0 && limb <= LIMB.EAR, `${kind} : membre connu (${limb})`);
    }
  }
});

// --- Conduites et circuits ---------------------------------------------------

/** Un sol plat : le relief est testé ailleurs, pas ici. */
const flatGround = () => 100;

test('toute conduite du répertoire existe, et le pré reste majoritairement calme', () => {
  for (const [family, pool] of Object.entries(FAUNA_REPERTOIRE)) {
    assert.ok(pool.length > 0, `${family} : un répertoire`);
    for (const behaviour of pool) {
      assert.ok(FAUNA_BEHAVIOURS[behaviour], `${family} : ${behaviour} est une conduite connue`);
    }
  }
  for (const behaviour of DEFAULT_REPERTOIRE) assert.ok(FAUNA_BEHAVIOURS[behaviour], behaviour);

  // Chaque espèce du catalogue tire dans un répertoire décrit : une famille
  // oubliée retomberait en silence sur le répertoire de repli.
  for (const kind of FAUNA_KINDS) {
    const family = FAUNA_SPECIES[kind].family;
    assert.ok(FAUNA_REPERTOIRE[family], `${kind} : la famille ${family} a un répertoire`);
  }

  // Un pré est fait de bêtes qui broutent. C'est ce qui rend remarquable
  // celle qui relève la tête.
  const calm = FAUNA_REPERTOIRE.grazer.filter((b) => b === 'graze').length;
  assert.ok(calm / FAUNA_REPERTOIRE.grazer.length > 0.5, 'la plupart des bêtes d’un pré broutent');
});

test('la traversée ne se déclenche que près d’une route, et rarement', () => {
  assert.equal(behaviourFor({ family: 'grazer', variant: 0.1, nearRoad: true, crossDraw: 0.01 }), 'cross');
  // Loin de toute route, le même tirage ne traverse rien.
  assert.notEqual(behaviourFor({ family: 'grazer', variant: 0.1, nearRoad: false, crossDraw: 0.01 }), 'cross');
  // Près d'une route mais au-dessus du seuil : elle broute comme les autres.
  assert.notEqual(behaviourFor({ family: 'grazer', variant: 0.1, nearRoad: true, crossDraw: 0.9 }), 'cross');
  assert.ok(CROSS_ODDS < 0.35, 'une traversée reste un événement');

  // Sans second tirage, on ne traverse jamais : c'est la valeur par défaut.
  assert.notEqual(behaviourFor({ family: 'grazer', variant: 0.1, nearRoad: true }), 'cross');
});

test('un circuit se referme : au bout d’une période, la bête est revenue', () => {
  const circuit = buildCircuit({
    behaviour: 'amble',
    x: 120,
    z: -40,
    walkMS: 1,
    runMS: 4,
    sampleY: flatGround,
  });
  assert.ok(circuit, 'un circuit est tracé');

  for (const t of [0, 3.5, 11.25, 40]) {
    const now = faunaStateAt(circuit, t);
    const later = faunaStateAt(circuit, t + circuit.period);
    close(later.x, now.x, 1e-9, 'même abscisse un tour plus tard');
    close(later.z, now.z, 1e-9, 'même ordonnée');
    close(later.heading, now.heading, 1e-9, 'même cap');
    // Le chemin, lui, ne se referme pas : c'est ce qui fait avancer la foulée.
    close(later.distance - now.distance, circuit.loopLength, 1e-9, 'un tour de plus au compteur');
  }
});

test('le chemin parcouru ne recule jamais, et vaut zéro à l’arrêt', () => {
  const circuit = buildCircuit({
    behaviour: 'graze',
    x: -300,
    z: 88,
    walkMS: 1.1,
    runMS: 3,
    sampleY: flatGround,
  });

  let previous = faunaStateAt(circuit, 0).distance;
  for (let step = 1; step <= 500; step++) {
    const state = faunaStateAt(circuit, step * 0.19);
    assert.ok(state.distance >= previous - 1e-9, 'le compteur de foulée ne recule pas');
    // À l'arrêt, rien n'avance : c'est ce qui empêche les pattes de battre
    // sur place quand la bête broute.
    if (state.speed === 0) assert.ok(state.head >= 0);
    previous = state.distance;
  }
});

test('la tête ne se baisse qu’à l’arrêt', () => {
  for (const behaviour of ['graze', 'amble', 'sniff', 'peck']) {
    const circuit = buildCircuit({
      behaviour,
      x: 41,
      z: 17,
      walkMS: 1,
      runMS: 4,
      sampleY: flatGround,
    });
    let grazed = false;
    for (let step = 0; step < 900; step++) {
      const state = faunaStateAt(circuit, step * 0.07);
      if (state.speed > 0) {
        assert.equal(state.head, 0, `${behaviour} : tête haute en marchant`);
      }
      assert.ok(state.head >= 0 && state.head <= 1, `${behaviour} : rabattement borné`);
      if (state.head > 0.5) grazed = true;
    }
    assert.ok(grazed, `${behaviour} : la tête descend pour de bon à un moment`);
  }
});

test('une bête qui guette ne bouge pas d’un pouce', () => {
  const circuit = buildCircuit({
    behaviour: 'watch',
    x: 5,
    z: 5,
    walkMS: 1,
    runMS: 4,
    sampleY: flatGround,
  });
  assert.equal(circuit.stations.length, 1);
  assert.equal(circuit.loopLength, 0);
  const first = faunaStateAt(circuit, 0);
  for (const t of [0.5, 9, 61, 400]) {
    const state = faunaStateAt(circuit, t);
    assert.equal(state.speed, 0);
    assert.equal(state.distance, 0, 'aucune foulée : les pattes restent droites');
    close(state.x, first.x, 1e-9);
    close(state.z, first.z, 1e-9);
    close(state.heading, first.heading, 1e-9);
  }
});

test('un circuit ne pose aucune station sur la chaussée', () => {
  // Une bande interdite en travers du champ : aucune station ne doit y tomber,
  // et le circuit doit malgré tout exister — une bête qui échoue à trouver sa
  // place disparaîtrait du pré.
  // L'ancre est hors emprise — c'est la précondition : `furnitureLayer` ne
  // pose une bête que sur un point déjà filtré (`_filterOffInfra`), et le
  // repli de dernier recours d'une station est justement de revenir dessus.
  const onRoad = (x) => Math.abs(x) < 6;
  const circuit = buildCircuit({
    behaviour: 'amble',
    x: 20,
    z: 0,
    walkMS: 1,
    runMS: 4,
    sampleY: flatGround,
    allow: (x) => !onRoad(x),
  });
  assert.ok(circuit, 'la bête trouve quand même où aller');
  // Le rayon d'`amble` (14 m) dépasse largement la bande interdite : sans
  // repli, la moitié des stations y tomberaient.
  assert.ok(FAUNA_BEHAVIOURS.amble.radiusM > 14 - 6, 'le circuit croise bien la bande');
  for (const station of circuit.stations) {
    if (station.dwell > 0) assert.ok(!onRoad(station.x), 'aucune halte sur la chaussée');
  }

  // Le nombre de haltes ne change pas selon ce qui est refusé : une station
  // rejetée est ramenée, jamais retirée. Sinon la période du circuit
  // changerait et la bête sauterait à chaque reconstruction.
  const free = buildCircuit({ behaviour: 'amble', x: 20, z: 0, walkMS: 1, runMS: 4, sampleY: flatGround });
  assert.equal(
    circuit.stations.filter((s) => s.dwell > 0).length,
    free.stations.filter((s) => s.dwell > 0).length,
    'autant de haltes, contrainte ou non'
  );
});

test('une traversée franchit vraiment la route, de bas-côté à bas-côté', () => {
  const circuit = buildCircuit({
    behaviour: 'cross',
    x: 200,
    z: 300,
    walkMS: 1.1,
    runMS: 4,
    sampleY: flatGround,
    // La traversée ignore délibérément l'interdit : c'est tout son objet.
    allow: () => false,
    crossAxis: { x: 1, z: 0 },
  });
  assert.ok(circuit);

  const halts = circuit.stations.filter((s) => s.dwell > 0);
  assert.equal(halts.length, 2, 'un bas-côté de chaque côté');
  const [a, b] = halts;
  close(Math.hypot(a.x - b.x, a.z - b.z), 2 * 9, 1e-9, 'la largeur franchie');
  // L'axe est bien celui qu'on a imposé : la bête traverse, elle ne longe pas.
  close(Math.abs(a.z - b.z), 0, 1e-9, 'perpendiculaire à la chaussée');
  // Le milieu du trajet est le point qu'on lui a donné : la route.
  close((a.x + b.x) / 2, 200, 1e-9);

  // Et elle attend longuement avant de s'engager.
  assert.ok(halts[0].dwell > 5, 'on ne traverse pas sans regarder');
});

test('un long trajet suit le terrain au lieu de le traverser', () => {
  // Sans points de passage, l'altitude est interpolée en ligne droite d'une
  // station à l'autre : une bête qui traverse trente mètres de pré vallonné
  // passe sous la butte du milieu.
  const hill = (x, z) => 100 + 8 * Math.sin(x / 20) * Math.cos(z / 20);
  const circuit = buildCircuit({
    behaviour: 'run',
    x: 0,
    z: 0,
    walkMS: 1.2,
    runMS: 7,
    sampleY: hill,
  });
  assert.ok(circuit.stations.length > FAUNA_BEHAVIOURS.run.stations, 'des points de passage insérés');
  assert.ok(circuit.stations.length <= CIRCUIT_MAX_STATIONS, 'mais bornés');

  // Aucun tronçon ne dépasse le pas d'échantillonnage, à la tolérance de
  // l'arrondi près : c'est ce qui garantit que le sol est suivi.
  for (let i = 0; i < circuit.stations.length; i++) {
    const from = circuit.stations[i];
    const to = circuit.stations[(i + 1) % circuit.stations.length];
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    assert.ok(span <= TERRAIN_SAMPLE_M + 1e-6, `tronçon échantillonné (${span.toFixed(2)} m)`);
  }

  // Et la bête passe bien par ces altitudes-là.
  for (const station of circuit.stations) {
    close(station.y, hill(station.x, station.z), 1e-9, 'altitude relevée sur le terrain');
  }
});

test('deux passages au même endroit rendent la même bête', () => {
  // Le déterminisme spatial est un invariant dur du projet : la conduite, le
  // circuit et la robe se tirent du lieu, jamais de l'ordre de parcours.
  const build = () =>
    buildCircuit({
      behaviour: behaviourFor({ family: 'grazer', variant: randomAt(77, -13, 227), crossDraw: 1 }),
      x: 77,
      z: -13,
      walkMS: 1,
      runMS: 3.4,
      sampleY: flatGround,
    });

  const first = build();
  const second = build();
  assert.equal(first.behaviour, second.behaviour);
  assert.equal(first.stations.length, second.stations.length);
  close(first.period, second.period, 1e-12);
  close(first.offset, second.offset, 1e-12);
  for (let i = 0; i < first.stations.length; i++) {
    close(first.stations[i].x, second.stations[i].x, 1e-12);
    close(first.stations[i].z, second.stations[i].z, 1e-12);
  }
});

test('deux bêtes voisines ne sont pas synchrones', () => {
  // Le défaut qui trahit un troupeau engendré : dix bêtes qui lèvent la tête
  // en même temps.
  const offsets = new Set();
  for (let i = 0; i < 12; i++) {
    const circuit = buildCircuit({
      behaviour: 'graze',
      x: 500 + i * 2.3,
      z: 500 - i * 1.7,
      walkMS: 1,
      runMS: 3,
      sampleY: flatGround,
    });
    offsets.add(circuit.offset.toFixed(4));
  }
  assert.equal(offsets.size, 12, 'chaque bête a son propre décalage');
});

// --- Courir : le trot et le bond ---------------------------------------------

test('le bond ne concerne que les espèces qui bondissent, et seulement lancées', () => {
  // C'est le nombre qui décide de tout : une espèce qui trotte ne bondit
  // jamais, une espèce qui bondit ne le fait qu'une fois lancée.
  const bondissent = ['goat', 'deer', 'doe', 'reindeer', 'fox'];
  const trottinent = ['cow', 'sheep', 'horse', 'donkey', 'chicken', 'boar', 'wolf', 'bear'];
  assert.equal(bondissent.length + trottinent.length, FAUNA_KINDS.length, 'le catalogue est couvert');

  for (const kind of bondissent) {
    const spec = FAUNA_SPECIES[kind];
    assert.equal(spec.bound, true, `${kind} bondit`);
    assert.equal(boundMix(0, spec), 0, `${kind} : à l'arrêt, rien ne bondit`);
    assert.equal(boundMix(spec.walkMS, spec), 0, `${kind} : au pas, la diagonale`);
    assert.equal(boundMix(spec.runMS, spec), 1, `${kind} : lancée, le bond entier`);
    // Et le passage de l'un à l'autre est continu : une bête ne change pas
    // d'allure d'une image à l'autre en franchissant un seuil.
    const middle = boundMix((spec.walkMS + spec.runMS) / 2, spec);
    assert.ok(middle > 0 && middle <= 1, `${kind} : fondu entre les deux (${middle.toFixed(2)})`);
  }

  for (const kind of trottinent) {
    const spec = FAUNA_SPECIES[kind];
    assert.ok(!spec.bound, `${kind} trottine`);
    assert.equal(boundMix(spec.runMS, spec), 0, `${kind} : même lancée, la diagonale`);
  }
});

test('le shader apparie les trains au bond et les diagonales au trot', () => {
  const material = createFaunaMaterial(fakeFaunaTHREE());
  const shader = {
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <color_vertex>',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
      '}',
    ].join('\n'),
  };
  material.onBeforeCompile(shader);

  // La quatrième composante de `aMotion` est le curseur trot/bond : sans elle
  // lue, le bond n'existe pas et rien ne le signalerait.
  assert.ok(shader.vertexShader.includes(`${MOTION_ATTRIBUTE}.w`), 'le shader lit la part de bond');
  assert.ok(shader.vertexShader.includes('attribute vec4 aMotion'), 'aMotion est un vec4');
  // Le fondu porte sur le déphasage lui-même, pas sur deux poses mélangées :
  // c'est ce qui rend l'accélération continue.
  assert.ok(shader.vertexShader.includes('mix(trot, leap, bound)'), 'le déphasage se fond');
});

test('le tampon d’animation porte quatre flottants par bête', () => {
  // Il en portait trois. Un tampon dimensionné pour trois et déclaré pour
  // quatre ne lèverait aucune erreur : il lirait la bête suivante.
  assert.equal(MOTION_SIZE, 4);
});

// --- La traversée déclenchée -------------------------------------------------

test('une traversée déclenchée va d’un bord à l’autre, une fois, et s’arrête', () => {
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 0,
    z: 0,
    walkMS: 1.2,
    runMS: 7,
    sampleY: flatGround,
    crossAxis: { x: 1, z: 0 },
  });
  assert.ok(circuit, 'un circuit est tracé');
  assert.equal(circuit.closed, false, 'il ne se referme pas');
  assert.ok(circuit.finish > 0, 'et il a une fin');
  assert.equal(circuit.offset, 0, 'joué depuis le début : il commence quand on le demande');

  const halts = circuit.stations.filter((s) => s.dwell > 0);
  assert.equal(halts.length, 2, 'un bord de chaque côté');
  close(Math.hypot(halts[0].x - halts[1].x, halts[0].z - halts[1].z), 2 * DASH_SPAN_M, 1e-9);

  // Elle part du bon côté et arrive à l'autre — et n'en revient pas : au-delà
  // de `finish`, c'est à l'appelant de la retirer, pas au circuit de boucler.
  const start = faunaStateAt(circuit, 0);
  const end = faunaStateAt(circuit, circuit.finish);
  close(start.x, -DASH_SPAN_M, 1e-9, 'elle débouche d’un côté');
  close(end.x, DASH_SPAN_M, 1e-9, 'elle arrive de l’autre');
  assert.equal(end.speed, 0, 'et elle s’y arrête');

  // Elle court, elle ne marche pas : c'est le point de toute la manœuvre.
  assert.equal(circuit.speed, 7);
  let couru = false;
  for (let step = 0; step < 200; step++) {
    const state = faunaStateAt(circuit, (step / 200) * circuit.finish);
    if (state.speed > 0) {
      assert.equal(state.speed, 7, 'à l’allure vive tout du long');
      couru = true;
    }
  }
  assert.ok(couru, 'elle traverse pour de bon');
});

test('une traversée déclenchée regarde là où elle va dès son apparition', () => {
  // Le cap d'une halte est celui de l'arrivée : sur un circuit ouvert, la
  // première station n'en a pas, et une bête déboucherait de biais.
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 10,
    z: -5,
    walkMS: 1,
    runMS: 6,
    sampleY: flatGround,
    crossAxis: { x: 0, z: 1 },
  });
  const start = faunaStateAt(circuit, 0);
  const running = faunaStateAt(circuit, circuit.finish * 0.5);
  close(start.heading, running.heading, 1e-9, 'même cap à l’arrêt et en course');
});

test('la demi-longueur d’une traversée se règle depuis l’extérieur', () => {
  // Une traversée du décor est vue de profil et de près, une traversée
  // déclenchée de face et de loin : elles n'ont pas la même longueur.
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 0,
    z: 0,
    walkMS: 1,
    runMS: 6,
    sampleY: flatGround,
    crossAxis: { x: 1, z: 0 },
    spanM: 40,
  });
  const halts = circuit.stations.filter((s) => s.dwell > 0);
  close(Math.hypot(halts[0].x - halts[1].x, halts[0].z - halts[1].z), 80, 1e-9);
  assert.ok(DASH_SPAN_M > CROSS_SPAN_M, 'et le défaut déclenché est le plus long');
});

test('la traversée du décor se court, et n’est jamais tirée pour une bête déclenchée', () => {
  assert.equal(FAUNA_BEHAVIOURS.cross.run, true, 'on ne s’attarde pas sur une chaussée');
  assert.equal(FAUNA_BEHAVIOURS.dash.run, true);
  // `dash` est un événement demandé, pas une conduite : aucun répertoire ne
  // doit la contenir, sinon une bête du décor la tirerait au sort.
  for (const pool of [...Object.values(FAUNA_REPERTOIRE), DEFAULT_REPERTOIRE]) {
    assert.ok(!pool.includes('dash'), 'aucune bête ne se donne une traversée déclenchée');
  }
  for (const draw of [0, 0.01, 0.5, 0.99]) {
    for (const family of Object.keys(FAUNA_REPERTOIRE)) {
      assert.notEqual(
        behaviourFor({ family, variant: draw, nearRoad: true, crossDraw: draw }),
        'dash'
      );
    }
  }
});

test('la couche du vivant joue une traversée déclenchée, puis l’oublie', () => {
  const layer = new FaunaLayer({ THREE: fakeSceneTHREE(), scene: fakeScene(), theme: defaultTheme });
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 0,
    z: 0,
    walkMS: 1.2,
    runMS: 7,
    sampleY: flatGround,
    crossAxis: { x: 1, z: 0 },
  });

  // Le décor d'abord : la traversée doit s'y ajouter, pas s'y substituer.
  layer.setAnimals(
    [{ kind: 'cow', x: 3, z: 3, circuit: buildCircuit({ behaviour: 'graze', x: 3, z: 3, walkMS: 1, runMS: 3, sampleY: flatGround }), tint: [1, 1, 1], scale: 1 }],
    { x: 0, z: 0 }
  );
  assert.equal(layer.animals.get('cow').length, 1);

  const crossing = layer.addCrossing({ kind: 'deer', x: 0, z: 0, circuit, tint: [1, 1, 1], scale: 1 });
  assert.ok(crossing, 'la bête est lancée');
  assert.equal(layer.animals.get('deer').length, 1, 'elle est jouée');
  assert.equal(layer.animals.get('cow').length, 1, 'et le décor est intact');

  // Tant qu'elle traverse, elle reste — même loin de l'observateur.
  layer.advance(circuit.finish * 0.5, { x: 4000, z: 4000 });
  assert.equal(layer.crossings.length, 1, 'on ne l’efface pas en pleine course');

  // Arrivée mais l'observateur est resté à portée : elle attend sur place.
  layer.advance(circuit.finish, { x: 0, z: 0 });
  assert.equal(layer.crossings.length, 1, 'elle ne s’évapore pas devant l’observateur');

  // L'observateur est passé au large : elle est oubliée.
  layer.advance(1, { x: CROSSING_FORGET_M + 50, z: 0 });
  assert.equal(layer.crossings.length, 0, 'oubliée une fois loin derrière');
  assert.equal(layer.animals.get('deer').length, 0);
  assert.equal(layer.animals.get('cow').length, 1, 'et le décor est toujours là');
});

test('une reconstruction du décor n’efface pas une traversée en cours', () => {
  // Le décor se refait tous les 250 mètres ; un événement déclenché par
  // l'application n'a aucune raison d'en dépendre.
  const layer = new FaunaLayer({ THREE: fakeSceneTHREE(), scene: fakeScene(), theme: defaultTheme });
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 0,
    z: 0,
    walkMS: 1.2,
    runMS: 7,
    sampleY: flatGround,
    crossAxis: { x: 1, z: 0 },
  });
  layer.addCrossing({ kind: 'fox', x: 0, z: 0, circuit, tint: [1, 1, 1], scale: 1 });
  layer.setAnimals([], { x: 0, z: 0 });
  assert.equal(layer.animals.get('fox').length, 1, 'toujours là après reconstruction');

  assert.ok(layer.cancelCrossing(layer.crossings[0]), 'et l’application peut l’interrompre');
  assert.equal(layer.animals.get('fox').length, 0);
});

test('les traversées déclenchées sont plafonnées', () => {
  const layer = new FaunaLayer({ THREE: fakeSceneTHREE(), scene: fakeScene(), theme: defaultTheme });
  const circuit = buildCircuit({
    behaviour: 'dash',
    x: 0,
    z: 0,
    walkMS: 1,
    runMS: 6,
    sampleY: flatGround,
    crossAxis: { x: 1, z: 0 },
  });
  for (let i = 0; i < FAUNA_CROSSING_MAX + 5; i++) {
    layer.addCrossing({ kind: 'doe', x: i, z: 0, circuit, tint: [1, 1, 1], scale: 1 });
  }
  assert.equal(layer.crossings.length, FAUNA_CROSSING_MAX, 'une application ne remplit pas le pré');
  // Une espèce inconnue ne fait rien tomber : elle est refusée, c'est tout.
  assert.equal(layer.addCrossing({ kind: 'licorne', x: 0, z: 0, circuit }), null);
});

// --- Près de la route ---------------------------------------------------------

test('l’encolure se baisse et se relève vite', () => {
  // Le mouvement qu'on regarde le plus longtemps de tout le décor : un pré au
  // repos, c'est vingt têtes qui montent et descendent.
  assert.ok(HEAD_RAMP_S <= 0.5, `montée d’encolure vive (${HEAD_RAMP_S} s)`);

  const circuit = buildCircuit({
    behaviour: 'graze',
    x: 12,
    z: 34,
    walkMS: 1,
    runMS: 3,
    sampleY: flatGround,
  });

  // On mesure la descente sur le circuit lui-même : le temps qui sépare la
  // dernière tête haute de la première tête entièrement basse. Sans cette
  // mesure, la constante pourrait cesser d'être respectée sans que rien ne
  // le dise.
  const step = 0.01;
  let lastHigh = null;
  let firstLow = null;
  for (let i = 0; i * step < circuit.period; i++) {
    const t = i * step;
    const head = faunaStateAt(circuit, t).head;
    if (head === 0) lastHigh = t;
    if (head > 0.99 && firstLow === null && lastHigh !== null) {
      firstLow = t;
      break;
    }
  }
  assert.ok(firstLow !== null, 'la tête descend bel et bien pendant la période');
  assert.ok(
    firstLow - lastHigh <= HEAD_RAMP_S + 2 * step,
    `descente en ${(firstLow - lastHigh).toFixed(2)} s, au plus ${HEAD_RAMP_S} s`
  );
});

test('un semis peut être adossé à un point imposé, et le tirage reste le même', () => {
  const ring = [
    { x: -200, z: -200 },
    { x: 200, z: -200 },
    { x: 200, z: 200 },
    { x: -200, z: 200 },
  ];
  const focus = { x: 170, z: 0 };
  const near = scatterInRing(ring, 12, 4242, { cluster: 0.4, focus, reachM: 20 });
  assert.ok(near.length > 0, 'des bêtes sont posées');
  for (const spot of near) {
    assert.ok(Math.abs(spot.x - focus.x) <= 20 + 1e-9, 'le semis tient dans la boîte imposée');
    assert.ok(Math.abs(spot.z - focus.z) <= 20 + 1e-9);
  }

  // Sans point imposé, le semis est celui d'avant : le tirage du point libre a
  // lieu de toute façon, pour qu'une parcelle ne change pas de semis selon
  // qu'une route passe à côté.
  const libre = scatterInRing(ring, 12, 4242, { cluster: 0.4 });
  const memeGraine = scatterInRing(ring, 12, 4242, { cluster: 0.4 });
  assert.deepEqual(libre, memeGraine, 'et il reste déterministe');
});

test('l’index des chaussées sait dire où est la route la plus proche', () => {
  // `query` répond à « suis-je dessus ». La question posée par un troupeau
  // qu'on veut voir depuis la route est l'autre : « où est-elle ».
  const index = new RoadIndex([
    {
      halfWidth: 3,
      path: [
        { x: 0, y: 0, z: -50 },
        { x: 0, y: 0, z: 50 },
      ],
    },
  ]);

  assert.equal(index.query(40, 0), null, 'à quarante mètres, on n’est pas dessus');
  const hit = index.nearestWithin(40, 0, 55);
  assert.ok(hit, 'mais la route est bien trouvée');
  close(hit.distance, 40, 1e-9);
  close(hit.x, 0, 1e-9, 'et le point de l’axe qui fait face');
  close(hit.z, 0, 1e-9);
  assert.equal(hit.segment.halfWidth, 3);

  // Hors de portée, rien — et le semis reprend son tirage libre.
  assert.equal(index.nearestWithin(40, 0, 20), null);
  assert.equal(index.nearestWithin(40, 0, 0), null, 'une portée nulle ne cherche rien');

  // La plus proche l'emporte, pas la première rencontrée.
  const deux = new RoadIndex([
    { halfWidth: 3, path: [{ x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: 50 }] },
    { halfWidth: 3, path: [{ x: 25, y: 0, z: -50 }, { x: 25, y: 0, z: 50 }] },
  ]);
  close(deux.nearestWithin(40, 0, 55).x, 25, 1e-9);
});

test('la robe d’une bête est tirée du lieu, et jamais absente', () => {
  const coats = defaultTheme.fauna.coats;
  for (const kind of FAUNA_KINDS) {
    const tint = coatFor(coats, kind, 111, -222);
    assert.deepEqual(tint, coatFor(coats, kind, 111, -222), `${kind} : même lieu, même robe`);
    assert.ok(coats[kind].includes(tint), `${kind} : tirée dans son nuancier`);
  }
  // Une espèce sans nuancier rend un blanc neutre : le matériau multiplie la
  // teinte d'instance dans la robe, et une bête sans teinte serait en plâtre.
  assert.deepEqual(coatFor(coats, 'licorne', 0, 0), [1, 1, 1]);
  assert.deepEqual(coatFor(null, 'cow', 0, 0), [1, 1, 1]);
});

test('chaque bête a un nom lisible et un nuancier de robes', () => {
  for (const kind of FAUNA_KINDS) {
    assert.ok(LABEL_FAUNA[kind], `${kind} doit avoir un nom lisible`);
    assert.equal(labelForMeshName(`fauna-${kind}`), LABEL_FAUNA[kind]);

    const coats = defaultTheme.fauna.coats[kind];
    assert.ok(Array.isArray(coats) && coats.length >= 3, `${kind} : plusieurs robes`);
    for (const coat of coats) {
      assert.equal(coat.length, 3, `${kind} : une robe est un triplet linéaire`);
      for (const channel of coat) assert.ok(channel >= 0 && channel <= 1, `${kind} : canal dans [0, 1]`);
    }
    // Plusieurs robes distinctes : une liste d'une seule couleur répétée
    // passerait les contrôles ci-dessus sans rien varier du tout.
    assert.ok(new Set(coats.map((c) => c.join(','))).size >= 3, `${kind} : des robes réellement différentes`);
  }

  // Une espèce inconnue ne disparaît pas de l'étiquetage : elle se nomme.
  assert.equal(labelForMeshName('fauna-licorne'), 'bête (licorne)');
});

// --- Semis dans une parcelle ------------------------------------------------

const square = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 100, z: 100 },
  { x: 0, z: 100 },
];

test('l’aire et l’appartenance d’un anneau métrique sont justes', () => {
  close(ringAreaMeters(square), 10000, 1e-6, 'un hectare');
  assert.ok(pointInRing(square, 50, 50));
  assert.ok(!pointInRing(square, 150, 50));
});

test('le semis reste à l’intérieur, et repousse au même endroit', () => {
  const first = scatterInRing(square, 12, 4242);
  const second = scatterInRing(square, 12, 4242);

  assert.equal(first.length, 12);
  assert.deepEqual(first, second, 'même graine, mêmes bottes de foin');
  for (const p of first) assert.ok(pointInRing(square, p.x, p.z), 'botte hors du champ');
  assert.notDeepEqual(scatterInRing(square, 12, 99), first, 'graine distincte, semis distinct');
});

// --- Catalogue de mobilier --------------------------------------------------

test('la conversion sRGB → linéaire respecte ses bornes', () => {
  assert.deepEqual(srgb('#000000'), [0, 0, 0]);
  const white = srgb('#ffffff');
  for (const c of white) close(c, 1, 1e-9, 'blanc');
  // Le gris moyen sRGB vaut environ 0,21 en linéaire : sans cette conversion,
  // tout le mobilier ressort délavé.
  close(srgb('#808080')[0], 0.2158, 1e-3, 'gris moyen');
});

test('les transformations du kit composent roulis, tangage et lacet', () => {
  close(Kit.transform([1, 0, 0], { yaw: Math.PI / 2 })[2], -1, 1e-9, 'lacet d’un quart de tour');
  close(Kit.transform([1, 0, 0], { roll: Math.PI / 2 })[1], 1, 1e-9, 'roulis d’un quart de tour');
  close(Kit.transform([0, 1, 0], { tilt: Math.PI / 2 })[2], 1, 1e-9, 'tangage d’un quart de tour');
  assert.deepEqual(Kit.transform([1, 2, 3], { x: 10, y: 20, z: 30 }), [11, 22, 33]);
});

test('toutes les pièces du catalogue se bâtissent et reposent sur le sol', () => {
  const names = Object.keys(FURNITURE_BUILDERS);
  assert.ok(names.length >= 15, `catalogue fourni (${names.length} pièces)`);

  for (const name of names) {
    const kit = FURNITURE_BUILDERS[name]();
    assert.ok(kit.vertexCount > 0, `${name} : géométrie non vide`);
    assert.equal(kit.positions.length % 9, 0, `${name} : triangles complets`);
    assert.equal(kit.normals.length, kit.positions.length, `${name} : une normale par sommet`);
    assert.equal(kit.colors.length, kit.positions.length, `${name} : une couleur par sommet`);

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < kit.positions.length; i += 3) {
      minY = Math.min(minY, kit.positions[i]);
      maxY = Math.max(maxY, kit.positions[i]);
    }
    // Origine au pied : un objet dont la base flotterait au-dessus de zéro
    // s’enfoncerait ou léviterait une fois posé sur le terrain.
    assert.ok(minY > -1.6, `${name} : base proche du sol (${minY.toFixed(2)})`);
    assert.ok(maxY > 0.1, `${name} : de la hauteur (${maxY.toFixed(2)})`);
    assert.ok(Number.isFinite(minY) && Number.isFinite(maxY), `${name} : coordonnées finies`);
  }
});

test('les sections du catalogue sont décrites en mètres et colorées', () => {
  for (const [name, profile] of Object.entries(FURNITURE_SPECS.profiles)) {
    assert.ok(profile.length >= 2, `${name} : au moins deux sommets`);
    for (const p of profile) {
      assert.ok(Math.abs(p.across) < 3, `${name} : largeur plausible`);
      assert.ok(Math.abs(p.up) < 4, `${name} : hauteur plausible`);
      assert.equal(p.color.length, 3, `${name} : couleur RVB`);
    }
  }
  // Une haie fait bien la taille d’une haie, pas celle d’un muret.
  const hedgeTop = Math.max(...FURNITURE_SPECS.profiles.hedge.map((p) => p.up));
  assert.ok(hedgeTop > 1.5 && hedgeTop < 2.5, `haie à hauteur d’homme (${hedgeTop})`);
});

test('le rail de voie ferrée est symétrique et tient dans le ballast', () => {
  const profile = railProfileFor();
  assert.ok(profile.length >= 4, 'assez de sommets pour un rail en relief');
  for (const p of profile) assert.equal(p.color.length, 3, 'couleur RVB');

  // Le rail — posé à `RAILWAY_GAUGE_HALF_M` de l'axe par `RailwayLayer.rebuild`
  // — doit tenir dans la largeur du ballast qui le porte.
  const across = profile.map((p) => p.across);
  const halfRail = Math.max(...across);
  assert.ok(RAILWAY_GAUGE_HALF_M + halfRail < RAILWAY_BALLAST_HALF_M, 'le rail tient dans le ballast');

  // Symétrie : un rail n'a pas de côté privilégié.
  const sorted = [...across].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    close(sorted[i], -sorted[sorted.length - 1 - i], 1e-9, `symétrie du sommet ${i}`);
  }
});

test('le talus de remblai s’approfondit avec le surplomb', () => {
  const shallow = FURNITURE_SPECS.embankmentProfile(0.5);
  const deep = FURNITURE_SPECS.embankmentProfile(4);
  const depthOf = (p) => Math.abs(Math.min(...p.map((v) => v.up)));
  const reachOf = (p) => Math.abs(Math.min(...p.map((v) => v.across)));

  assert.ok(depthOf(deep) > depthOf(shallow), 'plus le vide est grand, plus le talus descend');
  assert.ok(reachOf(deep) > reachOf(shallow), 'et plus il s’étale');
  // Même sans surplomb mesurable, le talus garde une amorce : sans elle, la
  // rive de la chaussée serait une arête franche en l’air.
  assert.ok(depthOf(FURNITURE_SPECS.embankmentProfile(0)) > 0);

  // Le talus descend du côté où il est posé. Il descendait toujours vers la
  // droite : sur la rive gauche, il repartait par-dessus la chaussée — un
  // versant sur deux, selon le côté où penche le terrain.
  const droite = FURNITURE_SPECS.embankmentProfile(2, -1);
  const gauche = FURNITURE_SPECS.embankmentProfile(2, 1);
  assert.ok(Math.min(...droite.map((v) => v.across)) < 0, 'à droite de la marche');
  assert.ok(Math.max(...gauche.map((v) => v.across)) > 0, 'à gauche de la marche');
  // Miroir exact : c'est le même talus, du côté opposé.
  gauche.forEach((v, i) => close(v.across, -droite[i].across, 1e-9, `sommet ${i}`));
  gauche.forEach((v, i) => close(v.up, droite[i].up, 1e-9, `hauteur du sommet ${i}`));
  // Sans rien préciser, c'est le talus d'avant, au bit près.
  assert.deepEqual(FURNITURE_SPECS.embankmentProfile(2), droite);
});

test('une route en remblai porte un talus de chaque côté, pas d’un seul', () => {
  // Une route de versant est encaissée en amont et portée en aval : un talus
  // d'un seul côté suffit. Une plate-forme qui domine le terrain **des deux
  // côtés** est autre chose — un remblai en pleine terre —, et c'est
  // exactement ce qu'est la rampe d'accès d'un pont, que la travée relève sur
  // trente mètres. Sans le second talus, la route montait vers son ouvrage en
  // ruban volant, l'air visible dessous.
  const { layer, context, segment, rowsInfo, buffers } = roadsideHarness();
  // Le terrain est plat, la plate-forme relevée de deux mètres : les deux
  // rives surplombent d'autant.
  const remblai = rowsInfo.map((row) => ({ ...row, drop: 2, perch: 2, uphill: 1 }));
  const platform = new Float32Array(segment.platform.length).fill(102);

  layer._buildEmbankment(context, { ...segment, platform }, remblai, new Set());

  const zs = [];
  for (let i = 2; i < buffers.embankment.positions.length; i += 3) {
    zs.push(buffers.embankment.positions[i]);
  }
  assert.ok(zs.length > 0, 'un talus est bien posé');
  assert.ok(Math.max(...zs) > segment.halfWidth, 'une rive');
  assert.ok(Math.min(...zs) < -segment.halfWidth, 'et l’autre');
  // Et chacun s'écarte de la chaussée : aucun sommet ne revient dessus.
  for (const z of zs) {
    assert.ok(Math.abs(z) >= segment.halfWidth - 1e-6, `sommet de talus à ${z.toFixed(2)}`);
  }

  // Sur un vrai versant — le terrain domine en amont —, un seul talus.
  const versant = rowsInfo.map((row) => ({ ...row, drop: 2, perch: -1.5, uphill: 1 }));
  const seul = createProfileBuffer();
  layer._buildEmbankment(
    { ...context, buffers: { ...buffers, embankment: seul } },
    { ...segment, platform },
    versant,
    new Set()
  );
  const cotes = [];
  for (let i = 2; i < seul.positions.length; i += 3) cotes.push(seul.positions[i]);
  assert.ok(cotes.length > 0, 'le talus aval est bien là');
  // Une seule rive : tous les sommets du même côté de l'axe.
  assert.ok(
    cotes.every((z) => z >= segment.halfWidth - 1e-6),
    `et lui seul : cotes de ${Math.min(...cotes).toFixed(2)} à ${Math.max(...cotes).toFixed(2)}`
  );
});

/** Le seul bout de `THREE` dont `createFurnitureRotorMaterial` a besoin. */
function fakeRotorTHREE() {
  return {
    MeshLambertMaterial: class {
      constructor(options) {
        Object.assign(this, options, { userData: {} });
      }
    },
  };
}

test('le rotor de l’éolienne est à l’arrêt sous le seuil de démarrage', () => {
  const THREE = fakeRotorTHREE();
  const material = createFurnitureRotorMaterial(THREE);
  // 5 km/h sur 90 km/h de bourrasque de référence (voir `WIND_SPEED_MAX_KMH`) :
  // pile sous le seuil demandé.
  advanceFurnitureRotor(material, 5, 0.04);
  assert.equal(material.userData.rotor.uRotorAngle.value, 0, 'rien sous le seuil de démarrage');
});

test('le rotor accélère de plus en plus vite, puis plafonne à un régime plausible', () => {
  const angleAfter = (force) => {
    const material = createFurnitureRotorMaterial(fakeRotorTHREE());
    // Un pas assez fin pour ne pas boucler sur `% (2π)` en un seul appel.
    for (let i = 0; i < 600; i++) advanceFurnitureRotor(material, 1 / 60, force);
    return material.userData.rotor.uRotorAngle.value;
  };

  const light = angleAfter(0.12); // 10,8 km/h : juste au-dessus du seuil
  const ordinary = angleAfter(0.25); // 22,5 km/h : la brise par défaut du thème
  const gale = angleAfter(1); // 90 km/h : la bourrasque de référence

  assert.ok(light > 0, 'au-dessus du seuil, ça tourne déjà un peu');
  assert.ok(ordinary > light, 'plus de vent, plus vite');

  // Le régime nominal doit rester du domaine du plausible pour une éolienne :
  // dix à quinze tours par minute, jamais un mixeur ni un ventilateur figé.
  const revsPerMinuteAt = (force) => {
    const material = createFurnitureRotorMaterial(fakeRotorTHREE());
    advanceFurnitureRotor(material, 1, force);
    return (material.userData.rotor.uRotorAngle.value / (2 * Math.PI)) * 60;
  };
  const rpm = revsPerMinuteAt(1);
  assert.ok(rpm >= 10 && rpm <= 15, `régime nominal plausible (${rpm.toFixed(1)} tr/min)`);

  // Passé le régime nominal, le vent supplémentaire n'accélère plus le rotor —
  // une éolienne réelle régule son régime, elle ne s'emballe pas.
  assert.equal(gale, angleAfter(0.5), 'plafonné au-delà du vent nominal');
});

// --- Ce qui donne de la vie -------------------------------------------------

test('un oiseau dérive dans le sens du vent en regardant où il va', () => {
  const bird = { baseX: 5, baseZ: -12, height: 60, speed: 4, phase: 0.4, beat: 1, scale: 1 };
  const centre = { x: 10, y: 200, z: -5 };
  const windDirection = 0.7;

  // Deux instants rapprochés (bien en deçà de la boîte de repli) : le cap
  // rendu doit être celui du déplacement réel.
  const a = birdAt(bird, 0, centre, windDirection);
  const b = birdAt(bird, 0.1, centre, windDirection);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const norm = Math.hypot(dx, dz) || 1;
  close(Math.sin(a.heading), dx / norm, 0.02, 'composante x du vol');
  close(Math.cos(a.heading), dz / norm, 0.02, 'composante z du vol');

  assert.ok(a.y > centre.y, 'l’oiseau vole au-dessus de l’observateur');
  assert.ok(a.flap > 0 && a.flap <= 1, 'battement borné');
});

test('tout le vol partage le même cap, celui du vent, quels que soient les oiseaux', () => {
  // C’est le point du changement : plus d’orbite propre à chaque oiseau, un
  // seul cap pour tout le vol — sans quoi certains voleraient encore contre
  // le vent.
  const centre = { x: 0, y: 0, z: 0 };
  const windDirection = -1.1;
  const one = birdAt({ baseX: 3, baseZ: 40, height: 40, speed: 5, phase: 0, beat: 1 }, 2, centre, windDirection);
  const other = birdAt({ baseX: -60, baseZ: -8, height: 22, speed: 8, phase: 1.4, beat: 1.2 }, 2, centre, windDirection);
  assert.equal(one.heading, other.heading, 'même cap malgré des paramètres différents');
  close(one.heading, Math.atan2(Math.cos(windDirection), Math.sin(windDirection)), 1e-9, 'le cap suit le vent');
});

test('un oiseau qui traverse la boîte de dérive y reste toujours, et finit par s’y replier', () => {
  const centre = { x: 100, y: 30, z: -40 };
  const bird = { baseX: 0, baseZ: 0, height: 30, speed: 6, phase: 0, beat: 1 };
  const windDirection = 0.3;
  let sawWrap = false;
  let previous = null;
  for (let t = 0; t <= 60; t += 0.25) {
    const at = birdAt(bird, t, centre, windDirection);
    assert.ok(Math.abs(at.x - centre.x) <= 95 + 1e-6, 'toujours dans la boîte, en x');
    assert.ok(Math.abs(at.z - centre.z) <= 95 + 1e-6, 'toujours dans la boîte, en z');
    // Même repli que la pluie et les débris (voir `precipitation.js`) : un
    // oiseau qui sort d’un côté réapparaît de l’autre, d’un coup — attendu
    // ici, pas un défaut : c’est ce qui garde le vol dans une boîte finie.
    if (previous && Math.hypot(at.x - previous.x, at.z - previous.z) > 50) sawWrap = true;
    previous = at;
  }
  assert.ok(sawWrap, 'le survol est assez long pour boucler au moins une fois');
});

test('un oiseau vole à altitude fixe, sans ondulation verticale', () => {
  const bird = { baseX: 0, baseZ: 0, height: 40, speed: 5, phase: 1.7, beat: 1 };
  const centre = { x: 0, y: 100, z: 0 };
  const windDirection = 0.9;
  for (let t = 0; t <= 20; t += 0.5) {
    assert.equal(birdAt(bird, t, centre, windDirection).y, centre.y + bird.height, `plat à t=${t}`);
  }
});

test('la silhouette d’oiseau est faite de deux ailes', () => {
  const geometry = createBirdGeometry({
    BufferGeometry: class {
      constructor() {
        this.attributes = {};
      }
      setAttribute(name, attribute) {
        this.attributes[name] = attribute;
      }
      computeVertexNormals() {}
    },
    BufferAttribute: class {
      constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
        this.count = array.length / itemSize;
      }
    },
  });
  assert.equal(geometry.attributes.position.count, 6, 'deux triangles');
});

test('la grille de fenêtres tient dans le mur qui la porte', () => {
  // Pignon trop court ou trop bas : aucune fenêtre plutôt qu’une fenêtre à
  // cheval sur l’arête.
  assert.equal(windowGrid(2, 8).columns, 0, 'mur trop court');
  assert.equal(windowGrid(20, 1.5).levels, 0, 'mur trop bas');

  const grid = windowGrid(20, 10);
  assert.ok(grid.columns > 0 && grid.levels > 0);
  // La dernière colonne reste en deçà de la longueur, marge comprise.
  assert.ok(grid.spacing * grid.columns < 20, 'dernière colonne dans le mur');
  // Trois niveaux dans dix mètres : allège à 1,1 m, niveaux de 3,2 m.
  assert.equal(grid.levels, 3);
});

test('les fenêtres allumées ne changent pas d’une reconstruction à l’autre', () => {
  // Le tirage ne dépend que du lieu et du rang : le village garde les mêmes
  // fenêtres allumées, là où un tirage libre les ferait clignoter tous les
  // 200 mètres parcourus.
  assert.equal(windowDraw(12.5, -37.25, 2), windowDraw(12.5, -37.25, 2));
  assert.notEqual(windowDraw(12.5, -37.25, 2), windowDraw(12.5, -37.25, 3), 'niveaux distincts');
  assert.notEqual(windowDraw(12.5, -37.25, 2), windowDraw(13.5, -37.25, 2), 'lieux distincts');

  // Et la part allumée est bien celle annoncée : un village endormi n’est ni
  // éteint ni illuminé.
  let lit = 0;
  const total = 4000;
  for (let i = 0; i < total; i++) {
    if (windowDraw(i * 0.37, i * -0.73, (i % 4) + 1) <= WINDOW_LIT_SHARE) lit++;
  }
  close(lit / total, WINDOW_LIT_SHARE, 0.04, 'part de fenêtres allumées');
});

test('le soubassement est une bande, pas un dégradé', () => {
  // Il ne se voyait pas : le point sombre était le bas du quadrilatère, soit
  // 60 cm sous le sol. Sa cote est maintenant au-dessus de l’assise.
  const base = 100;
  assert.equal(plinthTopFor(base, 0, base + 8), base + PLINTH_HEIGHT_M, 'au-dessus de l’assise');

  // Une partie en surplomb ne touche pas le sol : pas de plinthe en l’air.
  assert.equal(plinthTopFor(base, 4, base + 12), null, 'passage couvert');
  // Un mur trop bas serait entièrement en soubassement.
  assert.equal(plinthTopFor(base, 0, base + 1.2), null, 'abri de jardin');
});

test('un panneau de mur regarde vers l’extérieur', () => {
  const buffer = { positions: [], normals: [], colors: [] };
  pushPanel(buffer, { x: 0, y: 0 }, { x: 4, y: 0 }, 10, 13, 0, -1, [0.1, 0.2, 0.3], [0.4, 0.5, 0.6]);

  assert.equal(buffer.positions.length, 18, 'deux triangles');
  // La normale est celle qu’on a donnée, sur les six sommets.
  for (let i = 0; i < 6; i++) {
    assert.equal(buffer.normals[i * 3 + 1], 0, 'panneau d’aplomb');
    assert.equal(buffer.normals[i * 3 + 2], -1);
  }
  // Le bas prend la couleur du bas, le haut celle du haut.
  const ys = [];
  for (let i = 0; i < 6; i++) ys.push(buffer.positions[i * 3 + 1]);
  for (let i = 0; i < 6; i++) {
    assert.equal(buffer.colors[i * 3], ys[i] === 10 ? 0.1 : 0.4, 'couleur selon la cote');
  }

  // Enroulement : la face avant doit regarder du côté de la normale annoncée.
  const at = (i) => [buffer.positions[i * 3], buffer.positions[i * 3 + 1], buffer.positions[i * 3 + 2]];
  const [a, b, c] = [at(0), at(1), at(2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  assert.ok(cross[2] < 0, 'face avant du bon côté');
});

test('une maison n’est ni un immeuble ni un hangar', () => {
  assert.ok(isHouse({ area: 110, height: 7 }), 'pavillon');
  assert.ok(!isHouse({ area: 110, height: HOUSE_MAX_HEIGHT_M + 1 }), 'barre d’immeubles');
  assert.ok(!isHouse({ area: HOUSE_MAX_AREA_M2 + 1, height: 7 }), 'hangar');
  // Les volets ne sont posés que sur des maisons, et pas sur toutes.
  assert.ok(SHUTTER_SHARE > 0 && SHUTTER_SHARE < 1, 'ni toutes ni aucune');
});

test('une façade percée de jour : encadrement, verre, volets', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const openings = { panes: 0, budget: 100, lit: null };
  const style = {
    wall: [0.8, 0.8, 0.75],
    roof: [0.4, 0.2, 0.15],
    shutter: [0.2, 0.3, 0.45],
    shape: 'gable',
    house: true,
    shutters: true,
    palette: 'test',
  };
  // Un pan de 20 m, 8 m sous l’égout : deux niveaux de baies.
  appendOpenings(openings, walls, { x: 0, y: 0 }, { x: 20, y: 0 }, 0, -1, 100, 8, 0, style);

  assert.ok(openings.panes > 0, 'des baies');
  // Encadrement + verre + deux volets ; les volets fermés remplacent le verre,
  // donc quatre quadrilatères au plus par baie et trois au moins.
  const quads = walls.positions.length / 18;
  assert.ok(quads >= openings.panes * 3 && quads <= openings.panes * 4, 'trois à quatre panneaux');

  // Rien ne dépasse du mur qu’on perce : ni sous l’allège, ni au-delà des angles.
  const reach = WINDOW_WIDTH_M / 2 + WINDOW_FRAME_M + WINDOW_WIDTH_M * SHUTTER_WIDTH_RATIO;
  for (let i = 0; i < walls.positions.length; i += 3) {
    assert.ok(walls.positions[i] > -reach, 'rien avant l’angle');
    assert.ok(walls.positions[i] < 20 + reach, 'rien après l’angle');
    assert.ok(walls.positions[i + 1] > 100, 'rien sous l’assise');
    assert.ok(walls.positions[i + 1] < 108, 'rien au-dessus de l’égout');
  }

  // Un immeuble : mêmes baies, aucun volet — donc strictement moins de matière.
  const bare = { positions: [], normals: [], colors: [] };
  const bareBudget = { panes: 0, budget: 100, lit: null };
  appendOpenings(bareBudget, bare, { x: 0, y: 0 }, { x: 20, y: 0 }, 0, -1, 100, 8, 0, {
    ...style,
    house: false,
    shutters: false,
  });
  assert.equal(bareBudget.panes, openings.panes, 'autant de baies');
  assert.ok(bare.positions.length < walls.positions.length, 'un immeuble n’a pas de volets');
});

test('le budget de baies borne ce qui est posé', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const openings = { panes: 0, budget: 3, lit: null };
  const style = { shutter: [0, 0, 0], house: true, shutters: false };
  appendOpenings(openings, walls, { x: 0, y: 0 }, { x: 60, y: 0 }, 0, -1, 0, 12, 0, style);
  assert.equal(openings.panes, 3, 'pas une baie de plus que le budget');
});

// --- Jardins ----------------------------------------------------------------

test('les piquets se répartissent d’un angle à l’autre, portillon compris', () => {
  const plain = picketOffsets(12, PICKET_SPACING_M, null);
  assert.ok(plain.length > 2);
  // Premier et dernier piquets exactement aux angles : c’est l’intervalle
  // bâtard à l’angle qui trahit une clôture engendrée.
  close(plain[0].along, 0, 1e-9, 'premier piquet');
  close(plain[plain.length - 1].along, 12, 1e-9, 'dernier piquet');
  assert.ok(
    plain.every((p) => !p.gap),
    'aucune trouée sans portillon'
  );

  // Portillon : une trouée, une seule, et de la bonne largeur.
  const gated = picketOffsets(12, PICKET_SPACING_M, 6);
  assert.ok(gated.length < plain.length, 'des piquets en moins');
  const gaps = gated.filter((p) => p.gap);
  assert.equal(gaps.length, 1, 'un seul portillon');
  const after = gated[gated.indexOf(gaps[0]) + 1];
  assert.ok(after.along - gaps[0].along >= GATE_WIDTH_M, 'trouée assez large');

  // Un côté trop court n’a pas de clôture du tout plutôt qu’un piquet seul.
  assert.equal(picketOffsets(0.5, PICKET_SPACING_M, null).length, 0);
});

test('le jardin est cadré sur la maison et tourne avec elle', () => {
  const box = { cx: 10, cz: -4, angle: Math.PI / 2, long: 6, short: 4 };
  const corners = gardenCorners(box, 3);
  assert.equal(corners.length, 4);

  // Le centre du jardin est celui de la maison.
  const mid = corners.reduce((acc, p) => ({ x: acc.x + p.x / 4, z: acc.z + p.z / 4 }), { x: 0, z: 0 });
  close(mid.x, box.cx, 1e-9, 'centre x');
  close(mid.z, box.cz, 1e-9, 'centre z');

  // À 90°, le grand côté du jardin est porté par z, pas par x.
  const spanX = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
  const spanZ = Math.max(...corners.map((p) => p.z)) - Math.min(...corners.map((p) => p.z));
  close(spanZ, 2 * (box.long + 3), 1e-6, 'grand côté tourné');
  close(spanX, 2 * (box.short + 3), 1e-6, 'petit côté tourné');
});

test('une maison mitoyenne n’a pas de jardin clos', () => {
  const box = { cx: 0, cz: 0, angle: 0, long: 6, short: 4 };
  const house = { x: 0, z: 0, box };
  const margin = 3;

  assert.ok(isDetached(house, [house], margin), 'seule au monde');

  // Une voisine dont le centre tombe dans l’enclos : la clôture lui passerait
  // au travers.
  const inside = { x: box.long + margin - 1, z: 0, box };
  assert.ok(!isDetached(house, [house, inside], margin), 'voisine dans l’enclos');

  // Assez loin, elle ne gêne plus.
  const away = { x: box.long + margin + GARDEN_CLEAR_M + 1, z: 0, box };
  assert.ok(isDetached(house, [house, away], margin), 'voisine à l’écart');
});

test('un buisson est fermé, posé au sol, et différent de son voisin', () => {
  const buffer = { positions: [], normals: [], colors: [] };
  appendBush(buffer, { x: 3, y: 50, z: -7, radius: 0.8, height: 1.1, seed: 11, sides: 7 });

  // Deux couronnes et une pointe : trois triangles par secteur.
  assert.equal(buffer.positions.length / 9, 7 * 3, 'trois triangles par secteur');

  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 1; i < buffer.positions.length; i += 3) {
    lowest = Math.min(lowest, buffer.positions[i]);
    highest = Math.max(highest, buffer.positions[i]);
  }
  close(lowest, 50 + 1.1 * 0.22, 1e-9, 'couronne basse au sol');
  close(highest, 50 + 1.1, 1e-9, 'pointe à la hauteur annoncée');

  // Le bruitage par sommet : deux buissons de même taille n’ont pas la même
  // silhouette, sinon un jardin est une rangée de clones.
  const other = { positions: [], normals: [], colors: [] };
  appendBush(other, { x: 9, y: 50, z: 2, radius: 0.8, height: 1.1, seed: 11, sides: 7 });
  assert.notDeepEqual(
    buffer.positions.slice(0, 3).map((v, i) => v - [3, 50, -7][i]),
    other.positions.slice(0, 3).map((v, i) => v - [9, 50, 2][i]),
    'silhouettes distinctes'
  );
});

// --- Fusion des chaussées ---------------------------------------------------

/** Les seules chaînes : `mergeRoadLines` publie aussi les carrefours du graphe. */
const mergedChains = (lines) => mergeRoadLines(lines).chains;

/** Polyligne droite, de `from` à `to` en `steps` pas, sur l'axe des x. */
function straight(from, to, steps = 4, z = 0) {
  const points = [];
  for (let i = 0; i <= steps; i++) points.push({ x: from + ((to - from) * i) / steps, z });
  return points;
}

test('deux morceaux d’une même route bout à bout ne font qu’une chaîne', () => {
  const merged = mergedChains([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
  ]);

  assert.equal(merged.length, 1, 'une seule chaussée');
  const points = merged[0].points;
  close(points[0].x, 0, 1e-6, 'début');
  close(points[points.length - 1].x, 200, 1e-6, 'fin');
});

test('le même morceau livré par deux tuiles ne se dessine qu’une fois', () => {
  // Sans dédoublonnage, deux rubans coplanaires se disputent le pixel dans
  // toute la bande de recouvrement des tuiles.
  const merged = mergedChains([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].points.length, 5, 'pas de sommets en double');
});

test('deux moitiés qui se chevauchent au bord d’une tuile sont recousues', () => {
  // C'est le cas réel : le format laisse déborder chaque moitié de quelques
  // mètres au-delà de la frontière, donc les deux bouts se croisent au lieu de
  // se rejoindre — ils ne partagent aucun sommet.
  const merged = mergedChains([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 103) },
    { profile: 'major', halfWidth: 4.25, points: straight(97, 200) },
  ]);

  assert.equal(merged.length, 1, 'une seule chaussée');
  const xs = merged[0].points.map((p) => p.x);
  // Le repli est coupé : la chaîne avance toujours, elle ne revient jamais.
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] > xs[i - 1], `progression monotone (${xs[i - 1]} → ${xs[i]})`);
  }
  close(xs[xs.length - 1], 200, 1e-6, 'fin');
});

test('à un carrefour en T, c’est la route qui va tout droit qui continue', () => {
  const merged = mergedChains([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
    // Branche perpendiculaire greffée au milieu.
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 0 }, { x: 100, z: 60 }] },
  ]);

  assert.equal(merged.length, 2, 'la traversante et la branche');
  const through = merged.find((c) => c.points.length > 2);
  close(through.points[0].x, 0, 1e-6, 'la traversante n’est pas coupée');
  close(through.points[through.points.length - 1].x, 200, 1e-6, 'et va jusqu’au bout');

  // Le nœud du carrefour est un point d'ancrage : c'est de lui que se comptent
  // bornes et lampadaires, et il ne bouge jamais.
  const junction = through.points.findIndex((p) => Math.abs(p.x - 100) < 1e-6);
  assert.equal(through.anchors[junction], true, 'le carrefour est un ancrage');
  assert.equal(through.anchors[junction - 1], false, 'un sommet ordinaire ne l’est pas');
});

test('deux classes de route ne se fusionnent jamais', () => {
  const merged = mergedChains([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
  ]);

  assert.equal(merged.length, 2, 'la largeur change, donc le ruban change');
});

test('un virage à angle droit n’est pas pris pour une continuation', () => {
  const merged = mergedChains([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 0 }, { x: 100, z: 100 }] },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 0 }, { x: 200, z: 0 }] },
  ]);

  const through = merged.find((c) => c.points.some((p) => p.x > 150));
  assert.ok(
    through.points.every((p) => Math.abs(p.z) < 1e-6),
    'la chaîne suit la droite, pas le coude'
  );
});

test('une chaîne est orientée de la même façon quel que soit l’ordre des tuiles', () => {
  const a = { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) };
  const b = { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) };
  // Sans orientation canonique, le côté de la haie ou de la ligne téléphonique
  // changerait de bord d'une reconstruction à l'autre.
  const forward = mergedChains([a, b])[0].points;
  const backward = mergedChains([b, a])[0].points;
  close(forward[0].x, backward[0].x, 1e-6, 'même départ');
  close(forward[forward.length - 1].x, backward[backward.length - 1].x, 1e-6, 'même arrivée');
});

test('deux sommets plus proches que la tolérance sont le même nœud', () => {
  const merged = mergedChains([
    { profile: 'lane', halfWidth: 1.8, points: straight(0, 100) },
    // Décalé de moins que la tolérance : c'est la quantification du format,
    // pas une autre route.
    { profile: 'lane', halfWidth: 1.8, points: [{ x: 100, z: NODE_WELD_M * 0.5 }, { x: 200, z: 0 }] },
  ]);
  assert.equal(merged.length, 1);
});

test('la distance d’ancrage se compte depuis le dernier carrefour', () => {
  const points = straight(0, 400, 8); // pas de 50 m
  const anchors = points.map((_, i) => i === 0 || i === 4 || i === 8);
  const { distance, anchorIndex } = anchorDistances(points, anchors);

  close(distance[4], 0, 1e-9, 'le carrefour remet le compteur à zéro');
  close(distance[6], 100, 1e-9, 'et on compte depuis lui');
  assert.equal(anchorIndex[6], 4);

  // L'invariant qui compte : couper le début de la chaîne — ce que fait le
  // changement de jeu de tuiles — ne change aucune distance après le carrefour.
  const truncated = anchorDistances(points.slice(2), anchors.slice(2));
  close(truncated.distance[4], distance[6], 1e-9, 'stable si la chaîne est tronquée');
});

test('une tête de chaîne s’ancre au nœud suivant, faute d’en avoir un derrière', () => {
  // C'est le correctif du « reset » : une chaîne ne commence pas à un
  // cul-de-sac, elle commence là où les tuiles chargées s'arrêtent — un bord
  // qui avance avec l'observateur. Ancrées sur ce bout-là, les lignes d'avant
  // le premier carrefour se replantaient à chaque reconstruction : la ligne
  // téléphonique changeait de côté, l'alignement d'essence.
  const points = straight(0, 400, 8); // pas de 50 m
  const anchors = points.map((_, i) => i === 4); // un seul vrai carrefour, à 200 m

  const { distance, anchorIndex } = anchorDistances(points, anchors);
  assert.equal(anchorIndex[0], 4, 'la tête vise le carrefour qui la suit');
  close(distance[0], -200, 1e-9, 'et compte à rebours depuis lui');
  close(distance[4], 0, 1e-9);

  // Et c'est bien le même nœud, quel que soit l'endroit où la donnée s'arrête.
  for (const coupe of [1, 2, 3]) {
    const coupee = anchorDistances(points.slice(coupe), anchors.slice(coupe));
    for (let i = coupe; i < points.length; i++) {
      close(
        coupee.distance[i - coupe],
        distance[i],
        1e-9,
        `coupée à ${coupe} : la ligne ${i} garde sa phase`
      );
      assert.deepEqual(
        points[anchorIndex[i]],
        points.slice(coupe)[coupee.anchorIndex[i - coupe]],
        `coupée à ${coupe} : la ligne ${i} garde son nœud`
      );
    }
  }

  // Sans aucun nœud, il faut bien se rabattre sur quelque chose : le premier
  // sommet, comme avant.
  const orpheline = anchorDistances(points, points.map(() => false));
  assert.equal(orpheline.anchorIndex[3], 0);
  close(orpheline.distance[3], 150, 1e-9);
});

test('une extrémité de chaîne n’est pas un ancrage : elle bouge avec les tuiles', () => {
  // Le graphe ne distingue pas un cul-de-sac d'une route coupée au bord des
  // tuiles — les deux sont de degré un. Aucun des deux n'ancre donc plus rien ;
  // seuls les vrais nœuds (embranchement, croisement, changement de classe) le
  // font, et eux ne bougent pas.
  const merged = mergedChains([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 0 }, { x: 100, z: 60 }] },
  ]);
  const through = merged.find((c) => c.points.length > 2);
  assert.equal(through.anchors[0], false, 'le bout de la chaîne n’ancre rien');
  assert.equal(through.anchors[through.anchors.length - 1], false);
  assert.ok(
    through.anchors.some((flag) => flag),
    'mais le carrefour, si'
  );
});

// --- Carrefours relevés sur le graphe ----------------------------------------

/** Une nationale d'est en ouest, et une petite route qui s'y greffe en `x`. */
function teeLines(x = 100, minorHalfWidth = 2.5) {
  return [
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    {
      profile: 'minor',
      halfWidth: minorHalfWidth,
      points: [
        { x, z: 0 },
        { x, z: 60 },
      ],
    },
  ];
}

test('un nœud de degré trois est publié comme carrefour', () => {
  const { junctions } = mergeRoadLines(teeLines());

  assert.equal(junctions.length, 1, 'un seul carrefour');
  const [junction] = junctions;
  close(junction.x, 100, 1e-6, 'au nœud');
  close(junction.z, 0, 1e-6, 'au nœud');
  assert.equal(junction.degree, 3, 'deux branches de nationale et une de desserte');
  close(junction.halfWidth, 4.25, 1e-6, 'la dominante est la plus large');
  assert.equal(junction.profile, 'major');
  assert.equal(junction.branches.length, 3);
});

test('une branche publie la chaussée telle qu’elle part, et sa direction sur une longueur de rue', () => {
  // La tuile pose souvent son premier sommet à quelques mètres du nœud, et la
  // route tourne juste après : la direction de cette arête-là ne dit pas où la
  // branche s'en va.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: [{ x: 0, z: 0 }, { x: 200, z: 0 }] },
    {
      profile: 'minor',
      halfWidth: 2.5,
      points: [{ x: 100, z: 0 }, { x: 100, z: 2 }, { x: 104, z: 8 }, { x: 108, z: 20 }],
    },
  ]);

  const branch = junctions[0].branches.find((b) => b.profile === 'minor');
  assert.ok(branch.x > 0.3, 'la direction tient compte du coude, pas seulement du premier sommet');
  close(Math.hypot(branch.x, branch.z), 1, 1e-9, 'et elle reste unitaire');

  close(branch.path[0].x, 100, 1e-6, 'la polyligne part du nœud');
  close(branch.path[0].z, 0, 1e-6);
  assert.ok(branch.path.length >= 3, 'et elle porte le coude');
  close(branch.path[branch.path.length - 1].z, 20, 1e-6, 'suivie jusqu’au bout de la branche');
});

test('une desserte qui bute sur une traversante sans sommet commun est un carrefour', () => {
  // Le cas le plus fréquent, et celui que le graphe seul ne voyait pas : la
  // traversante est simplifiée (le sommet du carrefour y est aligné, donc
  // retiré), et la desserte s'arrête au milieu d'une arête.
  const { junctions, chains } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: [{ x: 0, z: 0 }, { x: 200, z: 0 }] },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 0 }, { x: 100, z: 60 }] },
  ]);

  assert.equal(junctions.length, 1, 'un carrefour');
  assert.equal(junctions[0].degree, 3, 'la traversante y est coupée en deux');
  close(junctions[0].x, 100, 1e-6, 'au point de greffe');
  const through = chains.find((c) => c.profile === 'major');
  assert.ok(
    through.points.some((p) => Math.abs(p.x - 100) < 1e-6),
    'la traversante porte désormais le sommet'
  );
});

test('un bout libre à deux mètres de la chaussée y est amené, à cinq il reste où il est', () => {
  // Deux tuiles voisines quantifient le même nœud à quelques décimètres près :
  // au-delà de la tolérance de soudure, le carrefour se perdait.
  const near = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: 2 }, { x: 100, z: 60 }] },
  ]);
  assert.equal(near.junctions.length, 1, 'greffé');
  const branch = near.chains.find((c) => c.profile === 'minor');
  close(branch.points[0].z, 0, 1e-6, 'le bout est posé sur la chaussée');

  const far = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 100, z: GRAFT_REACH_M + 2 }, { x: 100, z: 60 }] },
  ]);
  assert.equal(far.junctions.length, 0, 'trop loin : une impasse reste une impasse');
});

test('deux dessertes qui se rejoignent au ras d’une chaussée n’y font qu’un carrefour', () => {
  // La croisée dont la traversante a perdu son sommet : les deux dessertes se
  // soudent entre elles à un demi-mètre de l'axe, et ce nœud-là est de degré
  // deux — pas un bout libre. Greffé, il devient le carrefour de degré quatre
  // que la donnée décrit ; laissé seul, il posait deux rubans sur la chaussée.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 0, z: 0.5 }, { x: 0, z: 80 }] },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 0, z: -0.5 }, { x: 0, z: -80 }] },
  ]);

  assert.equal(junctions.length, 1, 'un seul carrefour, pas deux superposés');
  assert.equal(junctions[0].degree, 4, 'quatre branches');
  close(junctions[0].z, 0, 1e-6, 'ramené sur l’axe de la traversante');
});

test('un sommet intérieur ne se déplace pas au-delà de la tolérance de soudure', () => {
  // Une voie qui passe à deux mètres d'une autre sans s'y raccorder : la tirer
  // jusque-là coderait un coude de deux mètres dans un tracé continu.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] },
    {
      profile: 'minor',
      halfWidth: 2.5,
      points: [{ x: 0, z: -80 }, { x: 0, z: -2 }, { x: 20, z: 60 }],
    },
  ]);

  assert.equal(junctions.length, 0);
});

test('deux moitiés d’une même route qui se recouvrent ne font pas un carrefour', () => {
  // La couture de tuile : les deux bouts sont dans l'axe l'un de l'autre, donc
  // l'un prolonge l'autre — il n'y débouche pas. Sans ce critère, la greffe
  // planterait un carrefour au milieu d'une ligne droite à chaque frontière.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: [{ x: 0, z: 0 }, { x: 105, z: 0 }] },
    { profile: 'major', halfWidth: 4.25, points: [{ x: 95, z: 0.4 }, { x: 200, z: 0.4 }] },
  ]);

  assert.equal(junctions.length, 0);
});

test('une contre-allée qui longe une nationale ne s’y greffe pas', () => {
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    { profile: 'lane', halfWidth: 2, points: [{ x: 40, z: 6 }, { x: 120, z: 5.5 }] },
  ]);

  assert.equal(junctions.length, 0, 'deux voies qui se longent ne se rencontrent pas');
});

test('un bout libre ne se greffe pas sur une chaussée d’un autre niveau', () => {
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    {
      profile: 'minor',
      halfWidth: 2.5,
      level: 1,
      points: [{ x: 100, z: 1 }, { x: 100, z: 60 }],
    },
  ]);

  assert.equal(junctions.length, 0, 'ce qui survole ne débouche pas');
});

test('la greffe ne dépend pas de l’ordre de lecture des lignes', () => {
  const lines = [
    { profile: 'major', halfWidth: 4.25, points: [{ x: 0, z: 0 }, { x: 200, z: 0 }] },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 60, z: 1.5 }, { x: 60, z: 60 }] },
    { profile: 'lane', halfWidth: 2, points: [{ x: 140, z: -1.5 }, { x: 140, z: -60 }] },
  ];
  const places = (junctions) =>
    junctions.map((j) => `${j.x.toFixed(3)}|${j.z.toFixed(3)}|${j.degree}`).sort();
  const forward = mergeRoadLines(lines).junctions;
  const backward = mergeRoadLines([...lines].reverse()).junctions;

  assert.equal(forward.length, 2, 'les deux dessertes sont greffées');
  // Le rang d'un carrefour dans la liste suit l'ordre de lecture des arêtes,
  // comme avant la greffe ; ce sont les carrefours eux-mêmes qui ne doivent pas
  // en dépendre.
  assert.deepEqual(places(forward), places(backward), 'mêmes carrefours, aux mêmes places');
});

test('un changement de classe au milieu d’une route n’est pas un carrefour', () => {
  // Deux profils bout à bout : le nœud est de degré deux. Y planter un feu
  // reviendrait à en poser un partout où la donnée change d'attribut.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
  ]);

  assert.equal(junctions.length, 0);
});

test('le relevé des carrefours ne dépend pas de l’ordre des tuiles', () => {
  const lines = teeLines();
  const forward = mergeRoadLines(lines).junctions;
  const backward = mergeRoadLines([...lines].reverse()).junctions;

  assert.deepEqual(
    forward.map((j) => [j.x, j.z, j.degree, j.halfWidth]),
    backward.map((j) => [j.x, j.z, j.degree, j.halfWidth])
  );
});

// --- Mise au point : voir le réseau tel qu'il est compris --------------------

/** Tronçon complet, tel que `collectRoadSegments` le publie. */
function debugSegment({ rows = 6, works = null, levels = null, stitched = null } = {}) {
  return {
    profile: 'minor',
    halfWidth: 2.5,
    anchor: { x: 0, z: 0 },
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(3),
    works: Uint8Array.from(works || new Array(rows).fill(0)),
    levels: Int8Array.from(levels || new Array(rows).fill(0)),
    stitched: stitched ? Float32Array.from(stitched) : null,
  };
}

test('le relevé de mise au point rend un groupe par famille, et rien d’autre', () => {
  const { groups, counts } = collectRoadDebug([debugSegment()], [], { here: { x: 0, z: 0 } });
  const kinds = groups.map((g) => g.kind);

  assert.deepEqual(kinds, ['axis', 'edges', 'anchors'], 'sans carrefour ni ouvrage, trois familles');
  assert.equal(counts.segments, 1);
  assert.equal(counts.junctions, 0);
  for (const group of groups) {
    assert.equal(group.positions.length % 6, 0, 'des paires de points');
    assert.equal(group.colors.length, group.positions.length, 'une couleur par sommet');
  }
});

test('l’application choisit ce qu’elle affiche', () => {
  const { groups } = collectRoadDebug([debugSegment()], [], { kinds: ['axis'] });
  assert.deepEqual(groups.map((g) => g.kind), ['axis']);
});

test('un axe change de teinte avec son niveau : un survol se voit sans cliquer', () => {
  const sol = levelTint(0);
  const dessus = levelTint(1);
  const dessous = levelTint(-1);

  assert.notDeepEqual(sol, dessus, 'ce qui passe au-dessus ne se confond pas avec le sol');
  assert.notDeepEqual(sol, dessous);
  assert.notDeepEqual(dessus, dessous, 'ni le dessus avec le dessous');
  assert.deepEqual(levelTint(0), ROAD_DEBUG_COLORS.axis, 'le sol garde la couleur de base');
});

test('le relevé montre les ouvrages, les niveaux rencontrés et les lignes recousues', () => {
  const segment = debugSegment({
    works: [0, 0, 1, 1, 0, 0],
    levels: [0, 0, 1, 1, 0, 0],
    stitched: [0, 0.4, 0, 0, 0, 0],
  });
  const { groups, counts } = collectRoadDebug([segment], [], { here: { x: 0, z: 0 } });
  const byKind = Object.fromEntries(groups.map((g) => [g.kind, g]));

  assert.ok(byKind.works, 'la travée est surlignée');
  assert.ok(byKind.stitch, 'la couture aussi');
  assert.equal(counts.stitched, 1, 'une seule ligne reprise');
  assert.deepEqual(counts.levels, [0, 1], 'les deux niveaux rencontrés');

  // Le trait de couture mesure le déplacement : sans hauteur, il ne dirait rien.
  const y = byKind.stitch.positions;
  close(y[4] - y[1], 0.4, 1e-5, 'la hauteur du trait est le déplacement');
});

test('un carrefour se lit à son cercle et à ses branches, un croisement XY à leur absence', () => {
  const junction = {
    x: 10,
    z: 0,
    degree: 3,
    level: 0,
    halfWidth: 4,
    profile: 'major',
    branches: [
      { x: 1, z: 0, halfWidth: 4, profile: 'major' },
      { x: -1, z: 0, halfWidth: 4, profile: 'major' },
      { x: 0, z: 1, halfWidth: 2.5, profile: 'minor' },
    ],
  };
  const withJunction = collectRoadDebug([debugSegment()], [junction], { here: { x: 0, z: 0 } });
  const byKind = Object.fromEntries(withJunction.groups.map((g) => [g.kind, g]));

  assert.equal(withJunction.counts.junctions, 1);
  assert.equal(byKind.branches.positions.length / 6, 3, 'une flèche par branche');
  assert.ok(byKind.junctions.positions.length > 0, 'et le cercle du carrefour');

  // Les deux mêmes chaussées sans carrefour relevé : c'est exactement ce que
  // doit donner un passage supérieur, et c'est ce qui le rend lisible.
  const without = collectRoadDebug([debugSegment()], [], { here: { x: 0, z: 0 } });
  assert.ok(!without.groups.some((g) => g.kind === 'junctions'), 'aucun marqueur');
});

test('le relevé se borne à la portée demandée', () => {
  const near = debugSegment();
  const far = debugSegment();
  for (const p of far.path) p.x += 5000;
  far.anchor = { x: 5000, z: 0 };

  const { counts } = collectRoadDebug([near, far], [], { here: { x: 0, z: 0 }, radius: 100 });
  assert.equal(counts.segments, 1, 'le tronçon lointain n’est pas relevé');
});

// --- Niveaux de croisement : ce qui se rencontre et ce qui se survole --------

/**
 * Deux chaussées qui se coupent en croix. `level` s'applique à la seconde, et
 * le croisement tombe pile sur un sommet de chacune : c'est le cas le plus
 * défavorable pour la soudure, celui qui inventait un carrefour.
 */
function crossLines(level = 0) {
  return [
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8), level: 0 },
    {
      profile: 'major',
      halfWidth: 4.25,
      points: [
        { x: 100, z: -60 },
        { x: 100, z: 0 },
        { x: 100, z: 60 },
      ],
      level,
    },
  ];
}

test('le niveau de croisement se lit dans `layer`, et n’est pas une altitude', () => {
  assert.equal(roadLevelFor({ class: 'primary' }), LEVEL_GROUND, 'sans rien, le sol');
  assert.equal(roadLevelFor({ layer: 1 }), 1);
  assert.equal(roadLevelFor({ layer: '-1' }), -1, 'une chaîne de caractères se lit aussi');
  assert.equal(roadLevelFor({ level: 2 }), 2, 'à défaut de `layer`');
  assert.equal(roadLevelFor({ layer: 0, level: 3 }), 0, '`layer` prime');
  assert.equal(roadLevelFor({ layer: 'oui' }), LEVEL_GROUND, 'illisible : le sol');
  assert.equal(roadLevelFor({ layer: 900 }), LEVEL_MAX, 'borné');
  assert.equal(roadLevelFor({ layer: -900 }), LEVEL_MIN, 'borné');
  assert.equal(roadStyleFor({ class: 'primary', layer: 1 }).level, 1, 'porté par le style');
  assert.equal(roadStyleFor({ class: 'primary' }).level, LEVEL_GROUND);
});

test('un croisement au même niveau reste un carrefour', () => {
  const { junctions } = mergeRoadLines(crossLines(0));
  assert.equal(junctions.length, 1, 'un carrefour');
  assert.equal(junctions[0].degree, 4, 'quatre branches');
  assert.equal(junctions[0].level, LEVEL_GROUND);
});

test('un passage supérieur n’est pas un carrefour, même sans `bridge`', () => {
  // Deux routes au même endroit, `layer` différent : elles se croisent en XY,
  // elles ne se rencontrent pas. Sans le niveau, la soudure des nœuds en
  // faisait un croisement de degré quatre — donc une voie rognée, une couture
  // d'altitude et un feu tricolore, tout cela sous un pont.
  const { chains, junctions } = mergeRoadLines(crossLines(1));

  assert.equal(junctions.length, 0, 'aucun carrefour');
  assert.equal(chains.length, 2, 'les deux chaussées restent entières');
  for (const chain of chains) {
    assert.ok(chain.points.length >= 3, 'aucune n’est coupée au croisement');
  }
});

test('un croisement à niveaux différents ne se soude pas, même à un cheveu', () => {
  // Le sommet de la voie supérieure est à moins de la tolérance de soudure du
  // sommet de l’autre : c’est exactement ce que la tolérance recollait à tort.
  const { junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8), level: 0 },
    {
      profile: 'major',
      halfWidth: 4.25,
      points: [
        { x: 100 + NODE_WELD_M * 0.4, z: -60 },
        { x: 100 + NODE_WELD_M * 0.4, z: 0 },
        { x: 100 + NODE_WELD_M * 0.4, z: 60 },
      ],
      level: 1,
    },
  ]);

  assert.equal(junctions.length, 0);
});

test('le relevé des carrefours ne dépend pas de l’ordre, niveaux compris', () => {
  const lines = crossLines(1);
  const forward = mergeRoadLines(lines);
  const backward = mergeRoadLines([...lines].reverse());

  assert.deepEqual(forward.junctions, backward.junctions, 'aucun carrefour, dans les deux sens');
  assert.equal(forward.chains.length, backward.chains.length);
});

test('la culée tient : un pont marqué `layer` reste dans la chaîne de sa route', () => {
  // Le pont porte `layer=1`, ses approches rien. Leurs nœuds de culée ne se
  // soudent donc plus — et c'est `joinLooseEnds` qui recoud, parce que deux
  // bouts libres alignés qui se font face sont la définition d'une culée. La
  // route doit rester UNE chaîne : sinon le mobilier espacé recommence sa
  // numérotation à chaque pont.
  const { chains } = mergeRoadLines([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 40, 2), works: WORK_NONE, level: 0 },
    { profile: 'minor', halfWidth: 2.5, points: straight(40, 60, 1), works: WORK_BRIDGE, level: 1 },
    { profile: 'minor', halfWidth: 2.5, points: straight(60, 100, 2), works: WORK_NONE, level: 0 },
  ]);

  assert.equal(chains.length, 1, 'une seule chaîne');
  const chain = chains[0];
  close(chain.points[0].x, 0, 1e-6, 'début');
  close(chain.points[chain.points.length - 1].x, 100, 1e-6, 'fin');
  assert.ok(
    chain.works.some((code) => code === WORK_BRIDGE),
    'le pont est toujours signalé'
  );
  assert.ok(
    chain.levels.some((level) => level === 1),
    'et son niveau voyage avec lui'
  );
});

test('les niveaux se reportent par intervalle, culée comprise', () => {
  // Même convention que les ouvrages : le sommet porte le maximum, l'intervalle
  // le minimum. C'est ce qui rend exactement les arêtes d'origine.
  const points = straight(0, 40, 4);
  const levels = [0, 0, -1, 0, 0]; // un souterrain entre les sommets 1 et 3
  const path = Array.from({ length: 9 }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 }));
  const out = resampleLevels(points, levels, path);

  assert.equal(out.length, 9);
  assert.equal(out[0], 0, 'avant');
  assert.equal(out[3], -1, 'sous la colline');
  assert.equal(out[8], 0, 'après');
  assert.ok(out instanceof Int8Array, 'un niveau peut être négatif');
});

test('deux plate-formes de niveaux différents ne se recousent pas', () => {
  // Même emprise en plan, deux mètres d'écart en altitude : sous le seuil de
  // `STITCH_MAX_STEP_M`, donc l'ancien code les recousait. Le niveau dit que
  // l'une passe sur l'autre.
  const rows = 8;
  const build = (z, height, level) => {
    const path = Array.from({ length: rows }, (_, i) => ({ x: i * 5, z, distance: i * 5 }));
    return {
      profile: 'major',
      halfWidth: 4.25,
      path,
      platform: new Float32Array(rows).fill(height),
      works: new Uint8Array(rows),
      levels: new Int8Array(rows).fill(level),
      anchor: { x: 0, z },
    };
  };

  const under = build(0, 0, 0);
  const over = build(0, 2, 1);
  const segments = [under, over];
  stitchPlatforms(segments, new RoadIndex(segments, { margin: 0 }));

  assert.deepEqual(Array.from(over.platform), new Array(rows).fill(2), 'le pont ne redescend pas');
  assert.deepEqual(Array.from(under.platform), new Array(rows).fill(0), 'la route ne monte pas');
});

test('au même niveau, la voie étroite retrouve bien l’altitude de la large', () => {
  // Contrôle négatif du test précédent : sans différence de niveau, la couture
  // doit continuer de fonctionner exactement comme avant.
  const rows = 8;
  const wide = {
    profile: 'major',
    halfWidth: 6,
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(2),
    works: new Uint8Array(rows),
    levels: new Int8Array(rows),
    anchor: { x: 0, z: 0 },
  };
  const narrow = {
    profile: 'minor',
    halfWidth: 2.5,
    path: Array.from({ length: rows }, (_, i) => ({ x: 15, z: -10 + i * 5, distance: i * 5 })),
    platform: new Float32Array(rows).fill(0),
    works: new Uint8Array(rows),
    levels: new Int8Array(rows),
    anchor: { x: 15, z: -10 },
  };

  const segments = [wide, narrow];
  stitchPlatforms(segments, new RoadIndex(segments, { margin: 0 }));

  assert.ok(
    Math.max(...narrow.platform) > 0.5,
    'la voie étroite remonte vers la chaussée qu’elle rejoint'
  );
});

/** Tronçon minimal, tel que `collectRoadSegments` le produirait. */
function fakeSegment(points, halfWidth, deck = 0) {
  const path = points.map((p, i) => ({ ...p, distance: i * 5 }));
  return {
    profile: 'minor',
    halfWidth,
    path,
    platform: new Float32Array(path.length).fill(deck),
  };
}

// --- Le carrefour comme surface ---------------------------------------------

/** Branche sortante d'un carrefour, direction donnée en radians. */
const branchAt = (angle, halfWidth, profile = 'major') => ({
  x: Math.cos(angle),
  z: Math.sin(angle),
  halfWidth,
  profile,
});

/** Un T : une nationale est-ouest, une petite route vers le sud. */
const teeJunction = () => ({
  x: 0,
  z: 0,
  degree: 3,
  level: 0,
  halfWidth: 4.25,
  profile: 'major',
  branches: [branchAt(0, 4.25), branchAt(Math.PI, 4.25), branchAt(Math.PI / 2, 2.5, 'minor')],
});

/** Un X de quatre voies identiques : le cas que l'ancien rognage ne voyait pas. */
const crossJunction = (halfWidth = 2.5) => ({
  x: 0,
  z: 0,
  degree: 4,
  level: 0,
  halfWidth,
  profile: 'minor',
  branches: [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => branchAt(a, halfWidth, 'minor')),
});

test('un carrefour est une surface fermée qui contient son nœud', () => {
  const area = junctionArea(teeJunction());

  assert.ok(area, 'le T donne une aire');
  assert.ok(area.outline.length >= 8, 'un contour, pas un triangle');
  assert.ok(pointInOutline(area.outline, 0, 0), 'le nœud est dedans');
  assert.ok(!pointInOutline(area.outline, 30, 0), 'trente mètres plus loin, dehors');
  assert.ok(!pointInOutline(area.outline, 0, -30), 'et du côté sans branche aussi');
});

test('chaque branche s’arrête au-delà de la largeur des autres — la plus large comprise', () => {
  const area = junctionArea(teeJunction());
  const byProfile = Object.fromEntries(area.mouths.map((m) => [m.profile + m.distance, m]));
  const distances = area.mouths.map((m) => m.distance);

  // La nationale ne traverse plus le carrefour : elle s'arrête elle aussi.
  for (const mouth of area.mouths) {
    assert.ok(mouth.distance > 2.5, `la bouche ${mouth.profile} sort du carrefour`);
  }
  // La petite route doit dégager toute la largeur de la nationale ; la
  // nationale n'a que celle de la petite à dégager. Sa bouche est donc plus près.
  const minor = area.mouths.find((m) => m.profile === 'minor');
  const major = area.mouths.find((m) => m.profile === 'major');
  assert.ok(minor.distance > major.distance, 'la petite route recule davantage');
  assert.ok(major.distance > 2.5, 'et la nationale recule quand même');
  assert.ok(distances.length === 3 && byProfile);
});

test('deux voies de même largeur ont un carrefour, elles ne s’empilent plus', () => {
  // C'est le défaut central de l'ancien système : sans dominante, il ne rognait
  // rien du tout, et les deux rubans se superposaient sur toute la traversée.
  const area = junctionArea(crossJunction());

  assert.ok(area, 'un X de quatre voies identiques donne une aire');
  assert.equal(area.mouths.length, 4, 'quatre bouches');
  const [first] = area.mouths;
  for (const mouth of area.mouths) {
    close(mouth.distance, first.distance, 1e-9, 'aucune n’est privilégiée');
    assert.ok(mouth.distance > 2.5, 'et toutes s’arrêtent hors du carrefour');
  }
});

test('un angle de rue est un arc, et il ajoute de la chaussée au lieu d’en retirer', () => {
  const area = junctionArea(teeJunction());
  const corner = junctionCorner(
    { x: 0, z: 0 },
    branchAt(0, 4.25),
    branchAt(Math.PI / 2, 2.5, 'minor')
  );

  assert.ok(corner.points.length > 2, 'plusieurs sommets : un arc, pas un coin');
  // Le coin franc des deux rives est à (2,5 ; 4,25). Un rayon de bordure
  // l'enveloppe : le coin doit donc être **dans** la chaussée du carrefour.
  assert.ok(pointInOutline(area.outline, 2.5, 4.25), 'le coin franc est couvert');
  assert.ok(!pointInOutline(area.outline, 4.5, 6.25), 'mais pas le champ derrière');
});

// --- Une branche qui oblique avant la fin du carrefour -----------------------

/** Une branche qui part vers le sud puis tourne franchement à l'est. */
const bendingPath = () => [
  { x: 0, z: 0 },
  { x: 0, z: 4 },
  { x: 3, z: 7 },
  { x: 8, z: 9 },
];

test('la section d’une branche est prise sur la chaussée, pas sur son rayon', () => {
  const branch = { ...branchAt(Math.PI / 2, 2.5, 'minor'), path: bendingPath() };
  const section = branchSection({ x: 0, z: 0 }, branch, 6);

  // Six mètres de profondeur le long du rayon (le sud), c'est le sommet
  // (2 ; 6) de la polyligne — et non (0 ; 6), où le rayon seul l'aurait mise.
  close(section.centre.x, 2, 1e-9, 'la bouche a suivi la chaussée');
  close(section.centre.z, 6, 1e-9, 'sans reculer ni avancer le long du rayon');
  close(section.direction.x, Math.SQRT1_2, 1e-9, 'et elle prend la direction du coude');
  close(section.direction.z, Math.SQRT1_2, 1e-9);
});

test('sans polyligne, une branche reste son rayon', () => {
  const section = branchSection({ x: 0, z: 0 }, branchAt(Math.PI / 2, 2.5, 'minor'), 6);
  close(section.centre.x, 0, 1e-9);
  close(section.centre.z, 6, 1e-9);
  close(section.direction.z, 1, 1e-9);
});

test('une polyligne trop courte se prolonge sur sa dernière direction', () => {
  // Deux carrefours proches : la branche s'arrête avant la profondeur voulue.
  const branch = { ...branchAt(Math.PI / 2, 2.5, 'minor'), path: [{ x: 0, z: 0 }, { x: 0, z: 3 }] };
  const section = branchSection({ x: 0, z: 0 }, branch, 6);
  close(section.centre.z, 6, 1e-9, 'la profondeur demandée est tenue');
});

test('la bouche d’une branche coudée tombe sur la chaussée, et le contour avec elle', () => {
  // Le défaut : la couture couvre une dizaine de mètres, et une route oblique
  // bien avant d'en sortir. Posée sur le rayon, sa bouche se retrouvait à
  // plusieurs mètres à côté du ruban — d'où la fente d'un côté, la dalle
  // débordant sur le pré de l'autre.
  const path = bendingPath();
  const tee = {
    x: 0,
    z: 0,
    degree: 3,
    level: 0,
    halfWidth: 4.25,
    profile: 'major',
    branches: [
      branchAt(0, 4.25),
      branchAt(Math.PI, 4.25),
      { ...branchAt(Math.PI / 2, 2.5, 'minor'), path },
    ],
  };

  const area = junctionArea(tee);
  const mouth = area.mouths.find((m) => m.profile === 'minor');
  const straight = junctionArea({ ...tee, branches: tee.branches.map(({ path: _, ...b }) => b) });
  const reference = straight.mouths.find((m) => m.profile === 'minor');

  close(mouth.distance, reference.distance, 1e-9, 'la profondeur ne change pas');
  assert.ok(
    Math.hypot(mouth.centre.x - reference.centre.x, mouth.centre.z - reference.centre.z) > 3,
    'mais la bouche s’est déplacée en travers, avec la chaussée'
  );

  // Sur la polyligne, à la profondeur de la bouche : c'est là que le ruban
  // s'arrête, et c'est là que le contour doit passer.
  const along = (depth) => {
    let travelled = 0;
    for (let i = 1; i < path.length; i++) {
      const step = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      if (travelled + step >= depth) {
        const k = (depth - travelled) / step;
        return {
          x: path[i - 1].x + (path[i].x - path[i - 1].x) * k,
          z: path[i - 1].z + (path[i].z - path[i - 1].z) * k,
        };
      }
      travelled += step;
    }
    return path[path.length - 1];
  };
  let onPath = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const k = Math.min(
      1,
      Math.max(0, ((mouth.centre.x - a.x) * dx + (mouth.centre.z - a.z) * dz) / (dx * dx + dz * dz))
    );
    onPath = Math.min(onPath, Math.hypot(mouth.centre.x - a.x - dx * k, mouth.centre.z - a.z - dz * k));
  }
  assert.ok(onPath < 1e-9, 'la bouche est posée sur l’axe de la chaussée');

  const before = along(6);
  const after = along(12);
  assert.ok(pointInOutline(area.outline, before.x, before.z), 'la chaussée est dans le carrefour avant');
  assert.ok(!pointInOutline(area.outline, after.x, after.z), 'et dehors après');
});

test('une route droite garde sa rive droite : pas d’arc entre deux branches opposées', () => {
  const corner = junctionCorner({ x: 0, z: 0 }, branchAt(0, 4.25), branchAt(Math.PI, 4.25));

  assert.equal(corner.points.length, 1, 'un seul sommet');
  // Le secteur qui sépare la branche est de la branche ouest, dans l'ordre des
  // azimuts, est le côté sud : c'est là que passe la rive, et elle y est droite.
  close(corner.points[0].z, 4.25, 1e-6, 'posé sur la rive, à sa demi-largeur');
  close(corner.points[0].x, 0, 1e-6, 'au droit du nœud');
});

test('deux branches qui repartent ensemble n’en font qu’une', () => {
  // Une bretelle qui quitte une voie rapide à huit degrés n'est pas un angle de
  // rue : ses rives ne se rencontrent qu'à cinquante mètres. Les traiter comme
  // deux branches replierait le contour sur lui-même.
  const sorted = [branchAt(0, 4), branchAt(0.15, 4), branchAt(Math.PI, 4)].sort(
    (a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)
  ).map((b) => ({ ...b, angle: Math.atan2(b.z, b.x) }));

  assert.equal(mergeParallelBranches(sorted).length, 2, 'les deux rasantes fondent');
  assert.equal(
    junctionArea({ x: 0, z: 0, degree: 3, level: 0, halfWidth: 4, profile: 'major', branches: sorted }),
    null,
    'il ne reste pas de quoi faire un carrefour'
  );

  // Une vraie fourche, elle, en reste une.
  const fork = [branchAt(0, 4), branchAt(0.9, 4), branchAt(Math.PI, 4)].map((b) => ({
    ...b,
    angle: Math.atan2(b.z, b.x),
  }));
  assert.equal(mergeParallelBranches(fork).length, 3, 'à cinquante degrés, trois branches');
});

test('le rayon de raccordement reste borné, quelles que soient les largeurs', () => {
  const wide = junctionArea({
    x: 0,
    z: 0,
    degree: 4,
    level: 0,
    halfWidth: 40,
    profile: 'express',
    branches: [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => branchAt(a, 40, 'express')),
  });

  // Sans borne, un rayon proportionnel à la largeur ferait d'un carrefour
  // d'autoroute une place de deux cents mètres.
  for (const mouth of wide.mouths) {
    assert.ok(
      mouth.distance < 40 + JUNCTION_CORNER_MAX_M + 2,
      `la bouche reste au bord (${mouth.distance})`
    );
  }
});

test('un carrefour ne prend que les lignes de son niveau', () => {
  const areas = new JunctionAreas([teeJunction()]);
  const rows = 5;
  const build = (level) => ({
    path: Array.from({ length: rows }, (_, i) => ({ x: -10 + i * 5, z: 0, distance: i * 5 })),
    levels: new Int8Array(rows).fill(level),
  });

  const onGround = markJunctionRows(build(0), areas);
  const flyover = markJunctionRows(build(1), areas);

  assert.ok([...onGround].some((v) => v >= 0), 'la route au sol entre dans le carrefour');
  assert.ok([...flyover].every((v) => v < 0), 'la bretelle qui le survole n’y entre pas');
});

test('le ruban s’arrête pile sur le contour, et reprend de l’autre côté', () => {
  const areas = new JunctionAreas([teeJunction()]);
  const rows = 41;
  const path = Array.from({ length: rows }, (_, i) => ({ x: -100 + i * 5, z: 0, distance: i * 5 }));
  const segment = {
    path,
    platform: new Float32Array(rows).fill(7),
    levels: new Int8Array(rows),
  };
  segment.junction = markJunctionRows(segment, areas);

  const runs = junctionRibbonRuns(segment, areas, [{ from: 0, to: rows - 1 }]);
  assert.equal(runs.length, 2, 'deux morceaux, un de chaque côté');

  const outline = areas.areas[0].outline;
  const tip = runs[0].path[runs[0].path.length - 1];
  const resume = runs[1].path[0];

  // « Pile sur le contour » se vérifie des deux côtés : le sommet est dehors,
  // et deux centimètres plus loin il est dedans. C'est ce qui garantit qu'il
  // n'y a ni fente ni recouvrement à la bouche.
  assert.ok(!pointInOutline(outline, tip.x, tip.z), 'le dernier sommet est hors du carrefour');
  assert.ok(pointInOutline(outline, tip.x + 0.02, tip.z), 'et le suivant dedans');
  assert.ok(!pointInOutline(outline, resume.x, resume.z), 'la reprise aussi est dehors');
  assert.ok(pointInOutline(outline, resume.x - 0.02, resume.z), 'et son voisin dedans');

  // La plate-forme suit : un sommet inventé à la bouche doit porter une altitude.
  assert.ok(Number.isFinite(runs[0].platform[runs[0].platform.length - 1]));
  assert.equal(runs[0].platform.length, runs[0].path.length);
});

test('une section peut emprunter les repères de la rive qu’elle borde', () => {
  // Une courbe : c'est là que des repères recalculés sur une portion divergent
  // de ceux du tracé entier — à ses deux bouts, où le repère n'a plus qu'un
  // voisin. C'est cette divergence-là que six centimètres de recouvrement du
  // caniveau sur la chaussée cachaient.
  const path = Array.from({ length: 9 }, (_, i) => {
    const a = (i * Math.PI) / 16;
    return { x: Math.cos(a) * 40, z: Math.sin(a) * 40 };
  });
  const frames = pathFrames(path);
  const run = path.slice(3, 7);
  const own = pathFrames(run);
  assert.ok(Math.abs(own[2] - frames[3 * 4 + 2]) > 1e-3, 'le repère de tête diverge bien');

  const borrowed = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) borrowed[i * 4 + k] = frames[(3 + i) * 4 + k];
  }

  const profile = [
    { across: 0, up: 0, color: [0, 0, 0] },
    { across: 1, up: 0, color: [0, 0, 0] },
  ];
  const buffer = createProfileBuffer();
  appendProfile(buffer, {
    path: run,
    profile,
    sampleElevation: null,
    baseHeights: new Float32Array(4),
    frames: borrowed,
    smoothRadius: 0,
  });

  // Le premier sommet décalé tombe pile où le tracé entier le mettrait.
  const expectedX = run[0].x + frames[3 * 4 + 2];
  const expectedZ = run[0].z + frames[3 * 4 + 3];
  assert.ok(Math.abs(buffer.positions[3] - expectedX) < 1e-9);
  assert.ok(Math.abs(buffer.positions[5] - expectedZ) < 1e-9);

  // Sans les repères donnés, il tombe ailleurs : la fente.
  const loose = createProfileBuffer();
  appendProfile(loose, {
    path: run,
    profile,
    sampleElevation: null,
    baseHeights: new Float32Array(4),
    smoothRadius: 0,
  });
  assert.ok(Math.hypot(loose.positions[3] - expectedX, loose.positions[5] - expectedZ) > 1e-3);
});

test('la bordure finit sur la même bouche que le ruban', () => {
  // Sans ce sommet-là, la bordure s'arrêterait à la dernière ligne de
  // ré-échantillonnage, jusqu'à cinq mètres avant que le ruban s'arrête : la
  // rive de la chaussée aurait deux bouts à des endroits différents.
  const areas = new JunctionAreas([teeJunction()]);
  const rows = 41;
  const path = Array.from({ length: rows }, (_, i) => ({ x: -100 + i * 5, z: 0, distance: i * 5 }));
  const segment = {
    path,
    platform: new Float32Array(rows).fill(7),
    levels: new Int8Array(rows),
  };
  segment.junction = markJunctionRows(segment, areas);

  // La dernière ligne hors du carrefour, et sa voisine dedans.
  let keep = -1;
  for (let r = 0; r < rows; r++) {
    if (segment.junction[r] < 0 && segment.junction[r + 1] >= 0) keep = r;
  }
  assert.ok(keep > 0, 'le tronçon entre bien dans le carrefour');

  const edge = junctionBoundaryAt(segment, areas, keep, keep + 1);
  const outline = areas.areas[0].outline;
  assert.ok(!pointInOutline(outline, edge.point.x, edge.point.z), 'le sommet est hors du carrefour');
  assert.ok(pointInOutline(outline, edge.point.x + 0.02, edge.point.z), 'et son voisin dedans');
  assert.equal(edge.deck, 7, 'il porte la plate-forme');

  // C'est bien le même sommet que celui où le ruban s'arrête.
  const runs = junctionRibbonRuns(segment, areas, [{ from: 0, to: rows - 1 }]);
  const tip = runs[0].path[runs[0].path.length - 1];
  assert.ok(Math.hypot(tip.x - edge.point.x, tip.z - edge.point.z) < 1e-9);

  // Hors carrefour des deux côtés, il n'y a pas de bouche : rien à poser.
  assert.equal(junctionBoundaryAt(segment, areas, 0, 1), null);
  assert.equal(junctionBoundaryAt(segment, areas, 0, -1), null);
});

test('un carrefour sait de quelles chaussées il est fait', () => {
  // La bordure d'un coin de rue est tangente aux rives des branches : sans
  // cette liste, mesurer la place qui lui reste rendrait zéro partout.
  const areas = new JunctionAreas([teeJunction()]);
  const rows = 41;
  const through = {
    path: Array.from({ length: rows }, (_, i) => ({ x: -100 + i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(0),
    levels: new Int8Array(rows),
  };
  const aside = {
    path: Array.from({ length: rows }, (_, i) => ({ x: 400 + i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(0),
    levels: new Int8Array(rows),
  };
  for (const segment of [through, aside]) {
    segment.junction = markJunctionRows(segment, areas);
    areas.noteFeeder(segment);
  }

  assert.equal(areas.feeds(0, through), true, 'la route qui le traverse en fait partie');
  assert.equal(areas.feeds(0, aside), false, 'celle d’à côté, non');
  assert.equal(areas.feeds(-1, through), false, 'et hors index, la question n’a pas de sens');
});

test('deux carrefours voisins laissent quand même la chaussée entre eux', () => {
  // Vingt-cinq mètres d'écart : les deux bouches se font presque face. Le
  // morceau qui reste est court, et il doit exister — sinon la rue disparaît
  // entre deux places.
  const areas = new JunctionAreas([
    { ...teeJunction(), x: 0 },
    { ...teeJunction(), x: 25 },
  ]);
  const rows = 21;
  const path = Array.from({ length: rows }, (_, i) => ({ x: -25 + i * 5, z: 0, distance: i * 5 }));
  const segment = { path, platform: new Float32Array(rows).fill(0), levels: new Int8Array(rows) };
  segment.junction = markJunctionRows(segment, areas);

  const runs = junctionRibbonRuns(segment, areas, [{ from: 0, to: rows - 1 }]);
  const middle = runs.filter((run) => run.path[0].x > 0 && run.path[run.path.length - 1].x < 25);

  assert.equal(middle.length, 1, 'un morceau entre les deux carrefours');
  assert.ok(middle[0].path.length >= 2, 'et il a de quoi être dessiné');
});

test('la dalle d’un carrefour suit ses bouches au lieu d’être horizontale', () => {
  // Un versant : une branche arrive plus haut, l'autre plus bas. Posée à plat,
  // la dalle laissait une marche contre chacun des deux rubans, et le terrain
  // entaillé à la cote du ruban amont passait par-dessus.
  const area = junctionArea(teeJunction());
  const decks = area.mouths.map((mouth) => 100 + mouth.centre.x * 0.08);
  const surface = junctionSurface(area, decks);

  for (let i = 0; i < area.mouths.length; i++) {
    const rank = area.outline.indexOf(area.mouths[i].left);
    close(surface.positions[(1 + rank) * 3 + 1], decks[i], 1e-6, `bouche ${i} : aucune marche`);
  }
  close(surface.positions[1], junctionCentreDeck(decks), 1e-9, 'le nœud est à la moyenne');
});

test('une cote par branche : un sommet de bouche prend la sienne, un sommet d’arc les deux', () => {
  const decks = [10, 20];
  close(outlineDeckAt({ from: 0, to: 0, blend: 0 }, decks), 10, 1e-9, 'la bouche');
  close(outlineDeckAt({ from: 0, to: 1, blend: 0.25 }, decks), 12.5, 1e-9, 'le quart de l’arc');
  close(outlineDeckAt({ from: 0, to: 1, blend: 1 }, decks), 20, 1e-9, 'la bouche suivante');
  // Une branche hors de portée du réseau n'a pas de cote : le sommet prend
  // celle de l'autre plutôt que rien.
  close(outlineDeckAt({ from: 0, to: 1, blend: 0.5 }, [NaN, 20]), 20, 1e-9, 'une seule cote connue');
  assert.ok(Number.isNaN(junctionCentreDeck([NaN, NaN])), 'aucune : pas de dalle');
});

test('la cote de la dalle se lit en tout point qu’elle couvre', () => {
  const area = junctionArea(teeJunction());
  const decks = area.mouths.map((mouth) => 100 + mouth.centre.x * 0.08);
  const centre = junctionCentreDeck(decks);

  close(junctionDeckAt(area, decks, area.x, area.z), centre, 1e-6, 'au nœud');
  for (let i = 0; i < area.mouths.length; i++) {
    const mouth = area.mouths[i];
    close(junctionDeckAt(area, decks, mouth.left.x, mouth.left.z), decks[i], 1e-6, `bouche ${i}`);
  }
  // À mi-chemin du nœud et d'une bouche, à mi-cote : la dalle est réglée.
  const mouth = area.mouths[0];
  close(
    junctionDeckAt(area, decks, (area.x + mouth.left.x) / 2, (area.z + mouth.left.z) / 2),
    (centre + decks[0]) / 2,
    1e-6,
    'entre les deux'
  );
});

test('un carrefour sans cote ne creuse pas le terrain', () => {
  const areas = new JunctionAreas([teeJunction()]);
  assert.equal(areas.deckAt(0, 0), null, 'aire hors de portée du réseau construit');
  areas.areas[0].decks = areas.areas[0].mouths.map(() => 42);
  close(areas.deckAt(0, 0), 42, 1e-9, 'une fois les cotes posées');
  assert.equal(areas.deckAt(200, 200), null, 'et rien en dehors du contour');
  assert.equal(areas.deckAt(0, 0, 1), null, 'ni pour ce qui passe au-dessus');
});

test('la surface d’un carrefour est plane et refermée sur son contour', () => {
  const area = junctionArea(crossJunction(4));
  const surface = junctionSurface(area, 12);

  assert.equal(surface.positions.length / 3, area.outline.length + 1, 'un éventail depuis le nœud');
  assert.equal(surface.indices.length / 3, area.outline.length, 'un triangle par côté');
  for (let i = 1; i < surface.positions.length; i += 3) {
    close(surface.positions[i], 12, 1e-9, 'toute la surface est à l’altitude donnée');
  }
  for (const index of surface.indices) {
    assert.ok(index >= 0 && index < surface.positions.length / 3, 'aucun indice hors bornes');
  }
});

test('de la tuile au carrefour : les rubans s’arrêtent, la surface prend le relais', () => {
  // Un T complet lu depuis une fausse source, comme le fait le moteur.
  const frame = createLocalFrame(2.35, 48.85, 15);
  const at = (dx, dz) => [2.35 + dx * 0.0000135, 48.85 - dz * 0.000009];
  const source = {
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'transportation') return;
      callback(
        { type: 'LineString', coordinates: [at(-120, 0), at(0, 0), at(120, 0)] },
        { class: 'primary' }
      );
      callback({ type: 'LineString', coordinates: [at(0, 0), at(0, 120)] }, { class: 'tertiary' });
    },
  };

  const { segments, junctions, areas } = collectRoadSegments(
    source,
    [{ x: 0, y: 0 }],
    { x: 0, z: 0 },
    frame,
    () => 0
  );

  assert.equal(junctions.length, 1, 'un carrefour');
  assert.equal(areas.length, 1, 'et sa surface');

  const major = segments.find((s) => s.profile === 'major');
  const minor = segments.find((s) => s.profile === 'minor');
  assert.ok(major && minor);

  // La nationale traverse toujours le carrefour dans les **données** : c'est ce
  // qui fait que l'emprise, le déblai et le mobilier continuent de lire une
  // route entière. Seul son ruban s'interrompt.
  assert.ok([...major.junction].some((v) => v >= 0), 'ses lignes sont marquées');
  assert.ok(major.path.length > 40, 'mais la chaîne n’est pas coupée');

  const runs = junctionRibbonRuns(major, areas, [{ from: 0, to: major.path.length - 1 }]);
  assert.equal(runs.length, 2, 'deux morceaux de ruban');
  const gap =
    runs[1].path[0].x - runs[0].path[runs[0].path.length - 1].x;
  close(gap, areas.areas[0].mouths[0].distance * 2, 1e-3, 'la trouée vaut les deux bouches');
});

// --- Les ouvrages d'art : ponts et tunnels ----------------------------------

/** Tronçon d'ouvrage : `works[r]` par ligne, plate-forme posée sur le terrain. */
function worksSegment(rows, works, ground = () => 0) {
  const path = Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 }));
  const platform = new Float32Array(rows);
  for (let r = 0; r < rows; r++) platform[r] = ground(path[r].x);
  return { profile: 'major', halfWidth: 4.25, path, platform, works: Uint8Array.from(works) };
}

test('le code d’ouvrage vient de `brunnel`, et de lui seul', () => {
  assert.equal(workCodeFor('bridge'), WORK_BRIDGE);
  assert.equal(workCodeFor('tunnel'), WORK_TUNNEL);
  assert.equal(workCodeFor('ford'), WORK_NONE, 'un gué se traverse au sol');
  assert.equal(workCodeFor(undefined), WORK_NONE);
});

test('les plages d’ouvrage se relèvent une par une, bornes comprises', () => {
  const works = [0, 0, 1, 1, 1, 0, 2, 2, 0];
  assert.deepEqual(workRuns(works, WORK_BRIDGE), [{ from: 2, to: 4 }]);
  assert.deepEqual(workRuns(works, WORK_TUNNEL), [{ from: 6, to: 7 }]);
  assert.deepEqual(workRuns(works, WORK_NONE), [
    { from: 0, to: 1 },
    { from: 5, to: 5 },
    { from: 8, to: 8 },
  ]);
  assert.deepEqual(workRuns(null, WORK_BRIDGE), [], 'sans drapeau, aucun ouvrage');
});

test('le ruban saute le tunnel et lui seul — un pont reste de la chaussée', () => {
  // Deux morceaux à ciel ouvert, séparés par la colline. Chacun avance d'une
  // ligne sous la tête de tunnel, sinon la chaussée s'arrête cinq mètres avant
  // la bouche et laisse un trou.
  assert.deepEqual(drawableRuns([0, 0, 2, 2, 2, 2, 0, 0], 8), [
    { from: 0, to: 2 },
    { from: 5, to: 7 },
  ]);
  // Un pont se dessine comme le reste : il est simplement porté.
  assert.deepEqual(drawableRuns([0, 1, 1, 0], 4), [{ from: 0, to: 3 }]);
  // Sans drapeau du tout, le tronçon entier.
  assert.deepEqual(drawableRuns(null, 4), [{ from: 0, to: 3 }]);
  // Un tunnel d'une seule ligne : personne n'y avance, les deux morceaux se
  // disputeraient la même bande de bitume.
  assert.deepEqual(drawableRuns([0, 0, 2, 0, 0], 5), [
    { from: 0, to: 1 },
    { from: 3, to: 4 },
  ]);
  // Une ligne isolée entre deux tunnels ne fait pas un ruban.
  assert.deepEqual(drawableRuns([2, 0, 2], 3), []);
});

test('un ouvrage ne déborde pas d’un segment sur la route qui l’aborde', () => {
  // La convention du graphe : le sommet porte le maximum de ses arêtes, donc
  // les deux extrémités du pont sont marquées. En reprenant le minimum par
  // intervalle, on retrouve exactement l’arête d’origine — sans quoi le
  // tablier s’avancerait de vingt mètres sur le remblai d’accès.
  const points = [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 40, z: 0 },
    { x: 60, z: 0 },
  ];
  const vertices = [WORK_NONE, WORK_BRIDGE, WORK_BRIDGE, WORK_NONE];
  const path = Array.from({ length: 13 }, (_, i) => ({ distance: i * 5 }));

  const works = resampleWorks(points, vertices, path);
  assert.equal(works[3], WORK_NONE, 'à 15 m, encore sur le remblai');
  assert.equal(works[4], WORK_BRIDGE, 'à 20 m, la travée commence');
  assert.equal(works[8], WORK_BRIDGE, 'à 40 m, elle finit');
  assert.equal(works[9], WORK_NONE, 'à 45 m, on est redescendu');
});

test('une travée est tendue entre ses appuis, pas posée dans le ravin', () => {
  // Terrain : plateau à 20, gorge à 0 au milieu. Le pont couvre la gorge.
  const ground = (x) => (x >= 20 && x <= 60 ? 0 : 20);
  const segment = worksSegment(17, [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], ground);

  assert.equal(levelWorkSpans(segment.path, segment.platform, segment.works), 1);
  for (let r = 4; r <= 12; r++) {
    close(segment.platform[r], 20, 1e-4, `la travée reste à l’altitude des appuis (ligne ${r})`);
  }
  close(segment.platform[3], 20, 1e-6, 'l’appui ne bouge pas');
});

test('une travée trop basse se relève d’un bloc, et le remblai d’accès la rattrape', () => {
  // Rivière au niveau du terrain : la corde passerait à raser l’eau.
  const segment = worksSegment(21, Array.from({ length: 21 }, (_, r) => (r >= 8 && r <= 12 ? 1 : 0)));
  const clearanceAt = (x) => (x >= 40 && x <= 60 ? 0 : -50);

  levelWorkSpans(segment.path, segment.platform, segment.works, { clearanceAt });

  const deck = segment.platform[10];
  close(deck, BRIDGE_CLEARANCE_M, 1e-4, 'le tablier dégage exactement le gabarit');
  for (let r = 8; r <= 12; r++) {
    close(segment.platform[r], deck, 1e-5, `le tablier est droit (ligne ${r})`);
  }
  // Le remblai : décroissant en s’éloignant, nul au-delà de la rampe.
  assert.ok(segment.platform[7] > segment.platform[6], 'le remblai descend vers la route');
  assert.ok(segment.platform[6] > 0, 'et il porte encore la chaussée à six lignes');
  close(segment.platform[0], 0, 1e-5, 'loin de l’ouvrage, le terrain reprend la main');
});

test('un pont de plaine reste à l’altitude de ses appuis', () => {
  // Le défaut historique : le terrain servait de gabarit, donc n'importe quelle
  // travée — au-dessus d'un pré, d'un fossé, d'une voie ferrée — se relevait de
  // cinq mètres cinquante et repartait en remblai. Un plancher, lui, ne relève
  // rien tant que la corde passe au-dessus.
  const segment = worksSegment(21, Array.from({ length: 21 }, (_, r) => (r >= 8 && r <= 12 ? 1 : 0)));

  levelWorkSpans(segment.path, segment.platform, segment.works, { floorAt: () => 0 });

  for (const height of segment.platform) close(height, 0, 1e-6, 'la chaussée reste au sol');
});

test('un ruisseau ne se franchit pas à la hauteur d’un fleuve', () => {
  // Le relief est lu dans un MNT à trente mètres, qui ne résout pas le lit d'un
  // ruisseau : la cote « de l'eau » y est celle du pré autour. Une revanche
  // fixe de deux mètres jetait donc en l'air le moindre franchissement de rase
  // campagne, avec ses deux remblais d'accès. Elle suit maintenant la portée de
  // l'ouvrage — le seul indice disponible sur ce qu'il franchit.
  assert.ok(
    bridgeFreeboardFor(10) < bridgeFreeboardFor(200),
    'un tablier de dix mètres passe plus bas qu’un tablier de deux cents'
  );
  close(bridgeFreeboardFor(10), BRIDGE_FREEBOARD_MIN_M, 1e-9, 'un fossé : la revanche plancher');
  close(bridgeFreeboardFor(400), BRIDGE_FREEBOARD_M, 1e-9, 'un fleuve : la revanche pleine');
  // Bornée des deux côtés, et croissante entre les deux.
  let previous = 0;
  for (let span = 1; span <= 400; span += 7) {
    const value = bridgeFreeboardFor(span);
    assert.ok(value >= BRIDGE_FREEBOARD_MIN_M && value <= BRIDGE_FREEBOARD_M, `portée ${span}`);
    assert.ok(value >= previous, 'jamais décroissante');
    previous = value;
  }
  // Sans portée connue, on garde la revanche pleine : c'est le cas prudent.
  close(bridgeFreeboardFor(0), BRIDGE_FREEBOARD_M, 1e-9);

  // Et la portée arrive bien jusqu'au plancher : c'est `levelWorkSpans` qui la
  // connaît, personne d'autre.
  const segment = worksSegment(21, Array.from({ length: 21 }, (_, r) => (r >= 8 && r <= 12 ? 1 : 0)));
  const vues = [];
  levelWorkSpans(segment.path, segment.platform, segment.works, {
    floorAt: (x, z, span) => {
      vues.push(span);
      return -50;
    },
  });
  assert.ok(vues.length > 0, 'le plancher est bien interrogé');
  const portee = segment.path[13].distance - segment.path[7].distance;
  for (const span of vues) close(span, portee, 1e-9, 'la portée passée est celle de la travée');
});

test('le remblai d’accès d’une travée ne fait pas pencher sa voisine', () => {
  // Deux ponts séparés de deux lignes — un échangeur en compte de pareils. Le
  // remblai du second remonte vers le premier ; s'il ne s'arrêtait pas à la
  // culée, il ajouterait à un tablier **déjà tendu** une part qui décroît le
  // long de la travée, c'est-à-dire un tablier voilé.
  const works = Array.from({ length: 24 }, (_, r) => ((r >= 4 && r <= 8) || (r >= 11 && r <= 15) ? 1 : 0));
  const segment = worksSegment(24, works);
  // Une nappe sous la seconde travée seulement : elle seule se relève.
  const floorAt = (x) => (x >= 55 && x <= 75 ? 4 : -50);

  levelWorkSpans(segment.path, segment.platform, segment.works, { floorAt });

  close(segment.platform[13], 4, 1e-4, 'la seconde travée est relevée');
  assert.ok(segment.platform[10] > 0.5, 'et son remblai remonte vers la première');
  for (let r = 4; r <= 8; r++) {
    close(segment.platform[r], 0, 1e-6, `la première reste posée et droite (ligne ${r})`);
  }
});

test('un `brunnel` qui court sur des kilomètres ne lance pas un viaduc', () => {
  const rows = 120;
  const segment = worksSegment(rows, Array.from({ length: rows }, (_, r) => (r > 0 && r < rows - 1 ? 1 : 0)),
    (x) => x * 0.1);

  const before = Float32Array.from(segment.platform);
  assert.equal(levelWorkSpans(segment.path, segment.platform, segment.works), 0, 'portée refusée');
  assert.deepEqual(Array.from(segment.platform), Array.from(before), 'la chaussée suit le terrain');
});

test('la chaîne d’une route traverse son pont sans se couper', () => {
  // Trois morceaux bout à bout : route, pont, route. Le mobilier espacé ne doit
  // pas recommencer sa numérotation à chaque culée.
  const { chains } = mergeRoadLines([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 40, 2), works: WORK_NONE },
    { profile: 'minor', halfWidth: 2.5, points: straight(40, 60, 1), works: WORK_BRIDGE },
    { profile: 'minor', halfWidth: 2.5, points: straight(60, 100, 2), works: WORK_NONE },
  ]);

  assert.equal(chains.length, 1, 'une seule chaîne');
  const chain = chains[0];
  const bridged = chain.points.filter((_, i) => chain.works[i] === WORK_BRIDGE);
  assert.equal(bridged.length, 2, 'les deux extrémités du pont sont marquées');
  close(Math.min(...bridged.map((p) => p.x)), 40, 1e-6);
  close(Math.max(...bridged.map((p) => p.x)), 60, 1e-6);
});

test('l’emprise s’arrête à la culée : l’herbe pousse au-dessus d’un tunnel', () => {
  // L'emprise est une empreinte **au sol**. Là où la chaussée est enterrée, le
  // sol appartient au paysage : sinon un tunnel de deux kilomètres interdirait
  // l'herbe et les arbres sur toute la colline qu'il traverse. Même raison de
  // l'autre côté : le terrain ne doit pas se creuser jusqu'à sa dalle.
  const segment = fakeSegment(straight(0, 100, 20), 4.25, 12);
  segment.works = new Uint8Array(segment.path.length);
  segment.works.fill(WORK_TUNNEL, 5, 15);
  const index = new RoadIndex([segment]);

  assert.ok(index.covers(10, 0), 'au grand jour, la chaussée est une emprise');
  close(index.deckAt(index.query(10, 0, 1)), 12, 1e-6, 'et son altitude est servie');
  assert.ok(!index.covers(50, 0), 'sous la colline, plus rien n’est interdit');
  assert.equal(index.deckAt(index.query(50, 0, 1)), null, 'ni altitude à y lire');
  // La culée reste inscrite : l'emprise ne s'interrompt pas avant la tête.
  assert.ok(index.covers(25, 0), 'la dernière arête au jour tient encore');
});

test('sur un versant, l’aplanissement et la travée se passent le relais', () => {
  // Les deux systèmes se rencontrent exactement ici. Le terrassier aplanit le
  // profil en long dans la bande qu'un ouvrage peut rattraper (`flattenGrade`),
  // et la travée tend sa corde entre les appuis **ainsi obtenus**
  // (`levelWorkSpans`). Une travée bridée par la bande de terrassement serait
  // tirée vers le fond du ravin, et la diffusion entraînerait avec elle les
  // lignes d'approche : d'où l'allocation infinie sur une ligne d'ouvrage.
  const frame = createLocalFrame(2.35, 48.85, 15);
  const at = (dx) => [2.35 + dx * 0.0006, 48.85];

  const source = {
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'transportation') return;
      callback({ type: 'LineString', coordinates: [at(0), at(5)] }, { class: 'primary' });
      callback(
        { type: 'LineString', coordinates: [at(5), at(9)] },
        { class: 'primary', brunnel: 'bridge' }
      );
      callback({ type: 'LineString', coordinates: [at(9), at(14)] }, { class: 'primary' });
    },
  };

  // Un versant bruité — montée régulière plus une vague courte que
  // l'aplanissement doit effacer — creusé d'un ravin sous la travée, qui court
  // de x = 220 à x = 395. Le ravin est une vallée et non une falaise : aucun
  // terrassement n'absorbe une marche verticale, et ce n'est pas ce qu'on teste.
  const RAVINE_FROM = 210;
  const RAVINE_TO = 405;
  const ground = (x, z) => {
    const slope = x * 0.12 + Math.sin(x * 0.5) * 0.6 + z * 0.25;
    if (x <= RAVINE_FROM || x >= RAVINE_TO) return slope;
    const t = (x - RAVINE_FROM) / (RAVINE_TO - RAVINE_FROM);
    return slope - 16 * Math.sin(Math.PI * t) ** 2;
  };

  const { segments } = collectRoadSegments(
    source,
    [{ x: 0, y: 0 }],
    { x: 0, z: 0 },
    frame,
    ground,
    900,
    undefined,
    { floorAt: (x, z) => ground(x, z) }
  );

  assert.equal(segments.length, 1);
  const [segment] = segments;
  const span = [];
  for (let r = 0; r < segment.works.length; r++) {
    if (segment.works[r] === WORK_BRIDGE) span.push(r);
  }
  assert.ok(span.length > 4, `la travée est là (${span.length} lignes)`);

  // 1. La travée est une droite : trois lignes consécutives sans courbure.
  for (let i = 1; i < span.length - 1; i++) {
    const [a, b, c] = [span[i - 1], span[i], span[i + 1]].map((r) => segment.platform[r]);
    close(b, (a + c) / 2, 1e-3, `le tablier ne fléchit pas (ligne ${span[i]})`);
  }

  // 2. Elle est bien au-dessus du ravin qu'elle franchit — la bande de
  //    terrassement ne l'a pas rattrapée vers le fond. Ce qui la tient en l'air
  //    est la corde de ses appuis, pas une garde imposée : au droit du fond,
  //    elle domine donc le ravin de sa profondeur, à peu de chose près.
  const middle = span[Math.floor(span.length / 2)];
  for (const r of span) {
    const below = ground(segment.path[r].x, segment.path[r].z);
    assert.ok(segment.platform[r] >= below - 1e-2, `jamais sous le terrain (ligne ${r})`);
  }
  assert.ok(
    segment.platform[middle] - ground(segment.path[middle].x, segment.path[middle].z) > 10,
    'au milieu, la travée survole vraiment le ravin'
  );

  // 3. Le raccord aux culées reste sans marche : d'une ligne à l'autre, la
  //    pente ne saute pas.
  const steps = [];
  for (let r = 1; r < segment.platform.length; r++) {
    steps.push(Math.abs(segment.platform[r] - segment.platform[r - 1]));
  }
  assert.ok(Math.max(...steps) < 3, `aucune marche dans le profil (${Math.max(...steps).toFixed(2)} m)`);
});

test('de la tuile au tablier : un pont sort de l’eau qu’il franchit', () => {
  // Le chemin complet, tel qu'il tourne en scène : une route coupée en trois
  // morceaux par la tuile (route, pont, route), une nappe d'eau sous la travée,
  // et la plate-forme qui doit finir au-dessus de la nappe, pas dedans.
  const frame = createLocalFrame(2.35, 48.85, 15);
  const at = (dx) => [2.35 + dx * 0.0006, 48.85];

  const source = {
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'transportation') return;
      callback({ type: 'LineString', coordinates: [at(0), at(4)] }, { class: 'primary' });
      callback(
        { type: 'LineString', coordinates: [at(4), at(8)] },
        { class: 'primary', brunnel: 'bridge' }
      );
      callback({ type: 'LineString', coordinates: [at(8), at(12)] }, { class: 'primary' });
    },
  };

  // Terrain plat au niveau de l'eau : sans relevage, le tablier serait dedans.
  const water = 0;
  const { segments } = collectRoadSegments(
    source,
    [{ x: 0, y: 0 }],
    { x: 0, z: 0 },
    frame,
    () => water,
    900,
    undefined,
    // Le plancher que `RoadNetwork.rebuild` construit au-dessus d'une nappe.
    { floorAt: () => water + BRIDGE_FREEBOARD_M }
  );

  assert.equal(segments.length, 1, 'les trois morceaux ne font qu’un tronçon');
  const [segment] = segments;
  const bridged = [];
  for (let r = 0; r < segment.works.length; r++) {
    if (segment.works[r] === WORK_BRIDGE) bridged.push(segment.platform[r]);
  }

  assert.ok(bridged.length > 3, `la travée est retrouvée (${bridged.length} lignes)`);
  for (const height of bridged) {
    assert.ok(height >= water + BRIDGE_FREEBOARD_M - 1e-3, `le tablier passe au-dessus de l’eau (${height})`);
    // Et pas plus haut : une revanche n'est pas un gabarit, le pont d'une
    // rivière de campagne ne monte pas sur ses culées pour rien.
    assert.ok(height <= water + BRIDGE_FREEBOARD_M + 0.5, `sans se percher (${height})`);
  }
  // Et la chaussée d'approche, elle, redescend au terrain.
  close(segment.platform[0], water, 1e-3, 'la route retrouve son sol');
});

test('un pont de pré ne se perche pas, mais un viaduc dégage la route qu’il enjambe', () => {
  // Les deux moitiés d'une même question — qu'est-ce qu'une travée doit
  // dégager ? — dans le seul endroit qui puisse y répondre : la passe qui voit
  // tous les tronçons à la fois. Sur un terrain plat, la même route porte le
  // même pont ; ce qui change d'un cas à l'autre, c'est ce qui passe dessous.
  const frame = createLocalFrame(2.35, 48.85, 15);
  const along = (dx) => [2.35 + dx * 0.0006, 48.85];
  const across = (dz) => [2.35 + 7 * 0.0006, 48.85 + dz * 0.0004];

  const bridged = (extra) => ({
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'transportation') return;
      callback({ type: 'LineString', coordinates: [along(0), along(5)] }, { class: 'primary' });
      callback(
        { type: 'LineString', coordinates: [along(5), along(9)] },
        { class: 'primary', brunnel: 'bridge' }
      );
      callback({ type: 'LineString', coordinates: [along(9), along(14)] }, { class: 'primary' });
      if (extra) callback(extra.geometry, extra.properties);
    },
  });

  const collect = (source) =>
    collectRoadSegments(source, [{ x: 0, y: 0 }], { x: 0, z: 0 }, frame, () => 0, 900, undefined, {
      floorAt: () => 0,
    }).segments;

  /** Altitudes de la travée du tronçon qui en porte une. */
  const spanOf = (segments) => {
    const carrier = segments.find((segment) => segment.works.some((code) => code === WORK_BRIDGE));
    assert.ok(carrier, 'la travée est retrouvée');
    const out = [];
    for (let r = 0; r < carrier.works.length; r++) {
      if (carrier.works[r] === WORK_BRIDGE) out.push(carrier.platform[r]);
    }
    return out;
  };

  // 1. Au-dessus d'un pré, rien à dégager : la travée reste sur ses appuis.
  for (const height of spanOf(collect(bridged(null)))) {
    close(height, 0, 1e-3, 'le pont de pré reste au niveau du pré');
  }

  // 2. Une nationale passe dessous : le gabarit, lui, se prend.
  const crossed = collect(
    bridged({
      geometry: { type: 'LineString', coordinates: [across(-1), across(1)] },
      properties: { class: 'primary' },
    })
  );
  for (const height of spanOf(crossed)) {
    close(height, BRIDGE_CLEARANCE_M, 1e-3, 'le viaduc dégage le gabarit');
  }
  // Et la chaussée du dessous n'a pas bougé d'un pouce : c'est le pont qui
  // monte, jamais la route qu'il enjambe.
  const under = crossed.find((segment) => !segment.works.some((code) => code === WORK_BRIDGE));
  for (const height of under.platform) close(height, 0, 1e-3, 'la route du dessous reste au sol');
});

/**
 * Un `three` de fortune : la suite tourne sans lui (dépendance de pair). On ne
 * vérifie pas un rendu — on vérifie que la couche produit bien de la
 * géométrie, et à la bonne altitude. Une couche qui ne pose rien ne lève
 * pourtant rien : c'est exactement ce qu'on veut attraper.
 */
function stubWorksTHREE() {
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.index = null;
    }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
    }
    setIndex(index) {
      this.index = index;
    }
    computeVertexNormals() {}
    computeBoundingSphere() {}
    dispose() {}
  }
  return {
    DoubleSide: 2,
    BufferGeometry,
    Float32BufferAttribute: class {
      constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
        this.count = array.length / itemSize;
      }
    },
    MeshLambertMaterial: class {
      constructor(options) {
        Object.assign(this, options);
      }
      dispose() {}
    },
    Mesh: class {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
      }
      updateMatrix() {}
    },
  };
}

/** Bulle de fortune : un terrain plat à l'altitude demandée. */
function stubBubble(elevation = 0) {
  return {
    frame: {},
    verticalScale: 1,
    rawSurfaceElevationAtLocal: () => elevation,
  };
}

/** Hauteurs des sommets produits par une couche d'ouvrages. */
function worksHeights(layer) {
  const positions = layer.mesh?.geometry.attributes.position?.array || [];
  const out = [];
  for (let i = 1; i < positions.length; i += 3) out.push(positions[i]);
  return out;
}

test('un pont pose un tablier, des piles et deux parapets au-dessus du vide', () => {
  const scene = { add() {}, remove() {} };
  const layer = new BridgeLayer({ THREE: stubWorksTHREE(), scene, bubble: stubBubble(0) });

  // Cent mètres de travée à quinze mètres au-dessus d'un terrain plat à zéro.
  const rows = 21;
  const segment = {
    profile: 'major',
    halfWidth: 4.25,
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(15),
    works: Uint8Array.from({ length: rows }, () => WORK_BRIDGE),
  };

  assert.ok(layer.rebuild([segment], { x: 50, z: 0 }), 'la couche a posé quelque chose');
  assert.equal(layer.counts.spans, 1, 'une travée');
  assert.ok(layer.counts.piers >= 4, `deux culées et des piles (${layer.counts.piers})`);

  const heights = worksHeights(layer);
  assert.ok(heights.length > 0, 'de la géométrie');
  // Les piles descendent au terrain, les parapets dominent la chaussée.
  close(Math.min(...heights), 0, 1e-4, 'les piles se fondent au sol');
  assert.ok(Math.max(...heights) > 15.5, 'le parapet dépasse la chaussée');

  layer.dispose();
});

test('un ponceau de rase campagne ne se met pas sur pilotis', () => {
  const scene = { add() {}, remove() {} };
  const layer = new BridgeLayer({ THREE: stubWorksTHREE(), scene, bubble: stubBubble(0) });

  const rows = 6;
  const segment = {
    profile: 'minor',
    halfWidth: 2.5,
    // Quarante centimètres au-dessus du fossé : un tablier, pas un viaduc.
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(0.4),
    works: Uint8Array.from({ length: rows }, () => WORK_BRIDGE),
  };

  layer.rebuild([segment], { x: 10, z: 0 });
  assert.equal(layer.counts.spans, 1, 'le tablier est là');
  assert.equal(layer.counts.piers, 0, 'aucune pile sous quarante centimètres');
  layer.dispose();
});

test('sur un versant, un voile de pile se fonde sur son propre terrain', () => {
  // Un voile est balayé en travers de l'ouvrage : ses deux bouts ne sont pas
  // sur la même courbe de niveau. Fondés tous les deux au plus bas des deux,
  // ils faisaient une plaque pleine qui descendait la montagne du côté haut —
  // un pan de mur, pas une pile.
  const scene = { add() {}, remove() {} };
  const slope = (x, z) => z * 0.8;
  const layer = new BridgeLayer({
    THREE: stubWorksTHREE(),
    scene,
    bubble: { frame: {}, verticalScale: 1, rawSurfaceElevationAtLocal: slope },
  });

  const rows = 21;
  const segment = {
    profile: 'major',
    halfWidth: 4.25,
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(20),
    works: Uint8Array.from({ length: rows }, () => WORK_BRIDGE),
  };

  assert.ok(layer.rebuild([segment], { x: 50, z: 0 }));
  assert.ok(layer.counts.piers >= 4, `des appuis (${layer.counts.piers})`);

  const positions = layer.mesh.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    assert.ok(y >= slope(x, z) - 1e-3, `rien d’enterré sous son propre sol (${y} < ${slope(x, z)})`);
  }

  layer.dispose();
});

test('un tunnel reçoit une tête à chaque bout, et rien entre les deux', () => {
  const scene = { add() {}, remove() {} };
  const layer = new BridgeLayer({ THREE: stubWorksTHREE(), scene, bubble: stubBubble(40) });

  const rows = 41;
  const segment = {
    profile: 'major',
    halfWidth: 4.25,
    path: Array.from({ length: rows }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 })),
    platform: new Float32Array(rows).fill(10),
    works: Uint8Array.from({ length: rows }, (_, r) => (r >= 5 && r <= 35 ? WORK_TUNNEL : WORK_NONE)),
  };

  assert.ok(layer.rebuild([segment], { x: 100, z: 0 }));
  assert.equal(layer.counts.spans, 0, 'un tunnel n’a pas de tablier');
  assert.equal(layer.counts.portals, 2, 'une tête par bout');

  const xs = [];
  const positions = layer.mesh.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) xs.push(positions[i]);
  // Les têtes s'enfoncent de quelques mètres, elles ne courent pas tout le
  // tunnel : rien au milieu de la colline.
  assert.ok(!xs.some((x) => x > 105 && x < 145), 'rien au cœur de la montagne');
  layer.dispose();
});

test('une bretelle d’échangeur ne redescend pas se coller à l’autoroute qu’elle survole', () => {
  const under = fakeSegment(straight(-50, 50, 20), 6, 10);
  const ramp = fakeSegment(
    Array.from({ length: 11 }, (_, i) => ({ x: 0, z: 50 - i * 5 })),
    4.25,
    11.5 // moins de `STITCH_MAX_STEP_M` au-dessus : sans drapeau, elle serait recousue
  );
  ramp.works = new Uint8Array(ramp.path.length).fill(WORK_BRIDGE);

  const segments = [under, ramp];
  stitchPlatforms(segments, new RoadIndex(segments));
  for (const height of ramp.platform) close(height, 11.5, 1e-6, 'la bretelle reste à sa hauteur');
});

// --- L'herbe du premier plan ------------------------------------------------

test('les mailles d’herbe tiennent dans le disque, les plus proches d’abord', () => {
  const cells = grassCellRing(20, 2);
  assert.ok(cells.length > 100, `assez de mailles (${cells.length})`);
  for (const cell of cells) assert.ok(cell.distance <= 20, 'dans le disque');
  for (let i = 1; i < cells.length; i++) {
    assert.ok(cells[i].distance >= cells[i - 1].distance, 'triées par distance');
  }
  // L'ordre n'est pas cosmétique : si le plafond de touffes est atteint, ce qui
  // se perd doit être au bord du disque, là où les touffes sont minuscules.
  assert.ok(cells[0].distance < cells[cells.length - 1].distance);
});

test('le disque d’herbe se termine en fondu, pas au couteau', () => {
  close(grassEdgeFade(0, 40, 0.6), 1, 1e-9, 'au centre');
  close(grassEdgeFade(24, 40, 0.6), 1, 1e-9, 'jusqu’au début du fondu');
  close(grassEdgeFade(32, 40, 0.6), 0.5, 1e-9, 'à mi-fondu');
  close(grassEdgeFade(40, 40, 0.6), 0, 1e-9, 'au bord');
  close(grassEdgeFade(60, 40, 0.6), 0, 1e-9, 'au-delà');
});

test('la hauteur de l’herbe ne suit plus le fondu jusqu’à zéro', () => {
  // Le plancher garde une touffe perceptible même là où plus aucune ne sera
  // retenue par `grassEdgeFade` — c'est tout l'objet du correctif.
  close(grassHeightFade(0, 40, 0.6), 1, 1e-9, 'au centre : pleine hauteur');
  close(
    grassHeightFade(40, 40, 0.6),
    GRASS_HEIGHT_FADE_FLOOR,
    1e-9,
    'au bord : plancher, pas zéro'
  );
  close(
    grassHeightFade(60, 40, 0.6),
    GRASS_HEIGHT_FADE_FLOOR,
    1e-9,
    'au-delà : toujours le plancher'
  );
  assert.ok(
    grassHeightFade(40, 40, 0.6) > grassEdgeFade(40, 40, 0.6),
    'la hauteur rapetisse moins vite que la présence en bord de disque'
  );
});

test('les cultures ont le même plancher de hauteur que l’herbe', () => {
  close(cropHeightFade(0, CROP_RADIUS_M, CROP_FADE_FROM), 1, 1e-9, 'au centre');
  close(
    cropHeightFade(CROP_RADIUS_M, CROP_RADIUS_M, CROP_FADE_FROM),
    CROP_HEIGHT_FADE_FLOOR,
    1e-9,
    'au bord : plancher'
  );
  // La présence, elle, continue de tomber à zéro : seule la hauteur est
  // planchée, la densité par distance n'est pas touchée.
  close(cropEdgeFade(CROP_RADIUS_M, CROP_RADIUS_M, CROP_FADE_FROM), 0, 1e-9, 'présence : zéro au bord');
});

test('une zone non classée reçoit le même repli que le terrain : de l’herbe', () => {
  // Le shader de terrain peint le non-classé avec `unclassified` — par défaut
  // de l'herbe. Avant ce correctif, `groundCover` recevait `null` de `sampleAt`
  // et ne semait rien : sol vert, aucune touffe. Les deux replis doivent rester
  // le même, sinon la peinture du sol et les touffes se contredisent.
  const allGrass = grassSampleFallback(null, 'grass');
  assert.equal(allGrass.grass, 1);
  assert.equal(allGrass.farmland, 0);
  assert.equal(defaultTheme.terrain.unclassified, 'grass', 'le repli du thème est bien de l’herbe');

  // C'était quatre poids, c'est un nom de matière : un thème qui déciderait un
  // autre repli doit se refléter ici aussi.
  assert.equal(grassSampleFallback(null, 'wood').wood, 1);
  assert.equal(grassSampleFallback(null, 'farmland').farmland, 1);

  // Une couverture végétale pousse comme de l'herbe — c'est sa ligne de
  // `SURFACE_LOOK` qui dit ensuite de quelle taille et de quelle teinte.
  for (const kind of VEGETAL_SURFACES) {
    assert.equal(grassSampleFallback(null, kind).grass, 1, `${kind} porte de l’herbe`);
  }
  // Le minéral n'en porte pas.
  for (const kind of ['bare', 'scree', 'rock', 'sand', 'pavement', 'water']) {
    assert.equal(grassSampleFallback(null, kind).bare, 1, `${kind} ne porte rien`);
  }
  // Et un lotissement porte sa part, celle qu'il peignait dans la carte.
  assert.equal(grassSampleFallback(null, 'settled').grass, SETTLED_GRASS);

  // Un échantillon réel n'est jamais remplacé par le repli.
  const real = { grass: 0.9, wood: 0, farmland: 0, bare: 0.1 };
  assert.equal(grassSampleFallback(real, 'grass'), real);
});

test('une vraie culture efface l’herbe générique, mais pas la lisière', () => {
  // Champ en culture reconnue : pas d'herbe générique dessus.
  const inField = { grass: 0, farmland: 1 };
  assert.equal(grassBlockedByCrop(inField, 'wheat'), true);

  // Champ labouré : `cropAt` rend aussi une culture (`plough`) — même règle.
  assert.equal(grassBlockedByCrop(inField, 'plough'), true);

  // Pas de culture ici : l'herbe générique reste.
  assert.equal(grassBlockedByCrop(inField, null), false);

  // Bord de champ : herbe et culture mêlées dans la carte de classes. C'est
  // là, et seulement là, que la lisière (coquelicot compris, voir
  // `grassVariantFor`) doit continuer à pousser malgré une culture reconnue.
  const edge = { grass: 0.5, farmland: 0.5 };
  assert.equal(grassBlockedByCrop(edge, 'wheat'), false);

  // Prairie pure à côté d'un champ nommé par erreur (ne devrait pas arriver,
  // mais la fonction ne regarde que `crop` et `sample`, pas la cohérence des
  // deux) : sans mélange, pas de lisière, donc bloqué.
  const meadow = { grass: 1, farmland: 0 };
  assert.equal(grassBlockedByCrop(meadow, 'wheat'), true);
});

test('une maille d’herbe rend toujours les mêmes touffes', () => {
  // C'est l'invariant qui empêche l'herbe de se redistribuer entièrement tous
  // les quelques mètres : la graine ne dépend que de la maille, et le nombre de
  // tirages consommés est constant.
  const a = fillGrassCell(new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE), 12, -7);
  // Des mailles voisines tirées entre les deux appels : l'état du générateur ne
  // doit pas fuir d'une maille à l'autre.
  fillGrassCell(new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE), 13, -7);
  const b = fillGrassCell(new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE), 12, -7);
  assert.deepEqual([...a], [...b], 'même maille, mêmes touffes');

  const other = fillGrassCell(new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE), 13, -7);
  assert.notDeepEqual([...a], [...other], 'deux mailles ne portent pas la même touffe');
});

test('les touffes d’une maille restent dans leur maille', () => {
  for (const [gx, gz] of [[0, 0], [-4, 9], [312, -77]]) {
    const tufts = fillGrassCell(new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE), gx, gz);
    for (let i = 0; i < GRASS_PER_CELL; i++) {
      const at = i * GRASS_TUFT_STRIDE;
      const dx = tufts[at] - gx * GRASS_CELL_M;
      const dz = tufts[at + 1] - gz * GRASS_CELL_M;
      assert.ok(dx >= 0 && dx <= GRASS_CELL_M, `x dans la maille (${dx})`);
      assert.ok(dz >= 0 && dz <= GRASS_CELL_M, `z dans la maille (${dz})`);
      for (let k = 2; k < GRASS_TUFT_STRIDE; k++) {
        assert.ok(tufts[at + k] >= 0 && tufts[at + k] < 1, 'tirages normalisés');
      }
    }
  }
});

test('à largeur égale, c’est toujours la même voie qui s’incline', () => {
  // Deux départementales qui se croisent : il faut trancher, et trancher de la
  // même façon à chaque reconstruction. L'ordre des tronçons change avec le
  // découpage, le nœud d'ancrage non.
  const build = () => {
    const west = fakeSegment(straight(-50, 50, 20), 2.5, 10);
    west.anchor = { x: -400, z: 0 };
    const north = fakeSegment(
      Array.from({ length: 21 }, (_, i) => ({ x: 0, z: 50 - i * 5 })),
      2.5,
      9
    );
    north.anchor = { x: 0, z: 400 };
    return { west, north };
  };

  const first = build();
  stitchPlatforms([first.west, first.north], new RoadIndex([first.west, first.north]));
  const second = build();
  stitchPlatforms([second.north, second.west], new RoadIndex([second.north, second.west]));

  const mid = 10;
  close(first.north.platform[mid], 10, 1e-4, 'la voie nord s’aligne sur la voie ouest');
  close(second.north.platform[mid], first.north.platform[mid], 1e-6, 'quel que soit l’ordre');
  close(first.west.platform[mid], 10, 1e-6, 'la voie ouest ne bouge pas');
  close(second.west.platform[mid], 10, 1e-6, 'dans les deux sens');
});

// --- Signalisation, parapets, courbure --------------------------------------

test('la courbure se mesure en inverse de rayon, et son signe donne le côté', () => {
  // Un arc de cercle de 100 m de rayon a une courbure de 1/100.
  const left = [];
  const right = [];
  for (let i = 0; i < 20; i++) {
    const a = i * 0.05;
    left.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100 });
    right.push({ x: Math.cos(-a) * 100, z: Math.sin(-a) * 100 });
  }
  close(pathCurvature(left, 10), 0.01, 5e-4, 'rayon de 100 m');
  // Les deux sens donnent la même courbure et des signes opposés.
  close(pathCurvature(right, 10), pathCurvature(left, 10), 1e-9);
  assert.equal(Math.sign(pathTurn(left, 10)), -Math.sign(pathTurn(right, 10)));

  // Une ligne droite ne tourne pas.
  const straight = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, z: 0 }));
  close(pathCurvature(straight, 10), 0, 1e-9);
  // Une polyligne trop courte pour la fenêtre ne rend rien plutôt que n'importe quoi.
  close(pathCurvature([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0), 0, 1e-9);
});

test('un parapet demande un vide, pas seulement une pente', () => {
  // C'est le défaut qui en mettait partout : le MNT bruite le devers de
  // quelques pour cent en pleine plaine, et le seuil de pente y était franchi.
  assert.equal(guardrailStyleFor({ profile: 'minor', slope: 0.4, curvature: 0, drop: 0.2 }), null);
  assert.equal(guardrailStyleFor({ profile: 'minor', slope: 0.02, curvature: 0, drop: 4 }), null);

  // Versant franc et vraie hauteur : acier sur les grands axes.
  assert.equal(guardrailStyleFor({ profile: 'major', slope: 0.3, curvature: 0, drop: 3 }), 'steel');
  // Virage et petite route : bois.
  assert.equal(guardrailStyleFor({ profile: 'lane', slope: 0, curvature: 0.03, drop: 1.5 }), 'wood');
  // Une petite route au-dessus d'un vrai à-pic reprend de l'acier.
  assert.equal(guardrailStyleFor({ profile: 'minor', slope: 0.3, curvature: 0, drop: 4 }), 'steel');
  // Un sentier n'a jamais de parapet.
  assert.equal(guardrailStyleFor({ profile: 'path', slope: 0.5, curvature: 0.1, drop: 9 }), null);
});

test('le panneau posé dépend de ce qui se passe à cet endroit', () => {
  // Un virage serré appelle sa balise.
  assert.equal(signKindFor({ curvature: 0.05, variant: 0.5 }), 'signChevron');
  // La ville a ses passages piétons, la rase campagne non.
  const town = new Set([0.1, 0.4, 0.8].map((v) => signKindFor({ builtUp: true, variant: v })));
  assert.ok(town.has('signCrossing'));

  // Un carrefour ne choisit plus de panneau ici, et surtout n'en tire plus au
  // sort : `junction` n'est plus lu du tout, et la priorité se pose à la
  // bouche (`branchYields`). Passer l'ancien drapeau ne change donc rien.
  for (const variant of [0.1, 0.5, 0.9]) {
    assert.equal(signKindFor({ junction: true, variant }), signKindFor({ variant }));
  }
  const drawn = new Set();
  for (let i = 0; i < 200; i++) drawn.add(signKindFor({ variant: i / 200, builtUp: true }));
  assert.ok(!drawn.has('signStop'), 'aucun stop tiré au hasard');
  assert.ok(!drawn.has('signRoundabout'), 'aucun anneau tiré au hasard');

  // Tout ce que la règle peut rendre existe dans le catalogue : un panneau
  // oublié dans `SIGN_ITEMS` serait silencieusement invisible.
  for (let i = 0; i < 60; i++) {
    const variant = i / 60;
    for (const context of [
      { variant },
      { variant, builtUp: true },
      { variant, curvature: 0.03 },
      { variant, curvature: 0.012 },
      { variant, profile: 'express' },
    ]) {
      assert.ok(SIGN_ITEMS.includes(signKindFor(context)), signKindFor(context));
    }
  }
});

test('la haie basse de bas-côté reste minoritaire', () => {
  // Elle est reconnaissable *parce qu'elle n'est pas partout*. Appliquée à
  // toutes les routes, elle fait un décor de circuit.
  let verged = 0;
  for (let i = 0; i < 100; i++) {
    if (roadsideVergeFor('minor', { variant: i / 100 }).verge) verged++;
  }
  assert.ok(verged > 20 && verged < 45, `environ un tiers (${verged} %)`);
  // Ni en agglomération, ni le long d'un sentier ou d'une voie rapide.
  assert.equal(roadsideVergeFor('minor', { builtUp: true, variant: 0.1 }).verge, null);
  assert.equal(roadsideVergeFor('path', { variant: 0.1 }).verge, null);
  assert.equal(roadsideVergeFor('express', { variant: 0.1 }).verge, null);
});

test('un feu tricolore passe par les trois couleurs, et le vert dure', () => {
  const seen = new Map();
  const steps = 280;
  for (let i = 0; i < steps; i++) {
    const phase = trafficPhaseAt((i / steps) * TRAFFIC_CYCLE_S);
    seen.set(phase, (seen.get(phase) || 0) + 1);
  }
  assert.equal(seen.size, 3, 'les trois couleurs sortent');
  // L'orange passe, le vert dure : un cycle symétrique se lit comme une
  // guirlande, pas comme un carrefour.
  assert.ok(seen.get(1) < seen.get(0), 'orange plus court que rouge');
  assert.ok(seen.get(0) < seen.get(2), 'rouge plus court que vert');

  // Le déphasage décale le cycle sans le déformer.
  assert.equal(trafficPhaseAt(3, 5), trafficPhaseAt(8, 0));
  // Un temps négatif ne casse rien.
  assert.ok([0, 1, 2].includes(trafficPhaseAt(-4, 0)));
});

test('la pierre suit le minéral et la pente, jamais le hasard seul', () => {
  // Une prairie de plaine n'a pas de rocher, quel que soit le tirage.
  for (const variant of [0, 0.3, 0.9]) {
    assert.equal(rockKindFor({ bare: 0, steepness: 0.02, variant }), null);
  }
  // Un éboulis en porte, et de plusieurs tailles.
  const kinds = new Set();
  for (let i = 0; i < 40; i++) {
    const kind = rockKindFor({ bare: 0.9, steepness: 0.35, variant: i / 40 });
    if (kind) kinds.add(kind.item);
  }
  assert.ok(kinds.size >= 2, `plusieurs tailles (${[...kinds].join(', ')})`);
  assert.ok(kinds.has('rockSmall'));
  // Toutes les pièces rendues existent au catalogue.
  for (const item of kinds) assert.ok(FURNITURE_BUILDERS[item], item);
});

// --- Peuplements forestiers -------------------------------------------------

test('un bois garde ses essences quand la bulle se déplace', () => {
  const a = forestTypeAt(1234, -5678);
  const b = forestTypeAt(1234 + 3, -5678 - 4);
  assert.equal(a.name, b.name, 'la maille tient');

  // Et des mailles éloignées ne donnent pas toutes le même peuplement.
  const names = new Set();
  for (let i = 0; i < 40; i++) names.add(forestTypeAt(i * FOREST_PATCH_M, 0).name);
  assert.ok(names.size >= 3, `plusieurs peuplements (${[...names].join(', ')})`);
});

test('un bois ne pousse que là où son essence pousse vraiment', () => {
  // Le pin d’Alep en Finlande et l’épicéa en garrigue étaient possibles tant
  // que la liste était tirée en entier partout.
  const mediterranean = new Set();
  const boreal = new Set();
  for (let i = 0; i < 60; i++) {
    mediterranean.add(forestTypeAt(i * FOREST_PATCH_M, 0, FOREST_TYPES, 'mediterranean').name);
    boreal.add(forestTypeAt(i * FOREST_PATCH_M, 0, FOREST_TYPES, 'boreal').name);
  }
  assert.ok(mediterranean.size >= 2, `plusieurs peuplements (${[...mediterranean].join(', ')})`);
  for (const name of mediterranean) assert.ok(!boreal.has(name), `${name} n’est pas des deux`);
  assert.ok(boreal.has('taïga'));

  // La maille tient toujours : le climat réduit la liste, il ne déplace pas le
  // tirage.
  assert.equal(
    forestTypeAt(1234, -5678, FOREST_TYPES, 'oceanic').name,
    forestTypeAt(1234 + 3, -5678 - 4, FOREST_TYPES, 'oceanic').name
  );
});

test('un peuplement sans climat déclaré pousse partout', () => {
  // C’est ce qui fait qu’un thème écrit avant l’existence des climats se
  // comporte exactement comme avant.
  const ancien = [{ name: 'sans-climat', essences: ['broadleaf'], minHeight: 5, maxHeight: 9, density: 1, understory: 0.2, tint: [1, 1, 1] }];
  for (const family of CLIMATE_FAMILIES) {
    assert.equal(forestTypeAt(500, 500, ancien, family).name, 'sans-climat', family);
  }
  // Et un climat sans aucun contenu retombe sur la liste entière plutôt que de
  // rendre un décor vide : lever ici emporterait toutes les couches suivantes.
  assert.equal(filterByClimate(ancien, 'boreal').length, 1);
  const tagged = [{ name: 'a', climates: ['arid'] }];
  assert.deepEqual(filterByClimate(tagged, 'boreal'), tagged, 'repli sur la liste entière');
});

test('chaque peuplement tire dans des silhouettes qui existent', () => {
  for (const type of FOREST_TYPES) {
    const variants = variantsFor(type);
    assert.ok(variants.length >= 2, `${type.name} : plusieurs silhouettes`);
    for (const index of variants) {
      assert.ok(TREE_ATLAS_OFFSETS[index], `${type.name} : case ${index} présente`);
      assert.ok(TREE_VARIANTS[index], `${type.name} : variante ${index} décrite`);
    }
    assert.ok(type.maxHeight > type.minHeight, `${type.name} : hauteurs cohérentes`);
  }
  // Un taillis est bas, une futaie est haute : c'est ce contraste qui se lit.
  const taillis = FOREST_TYPES.find((t) => t.name === 'taillis');
  const futaie = FOREST_TYPES.find((t) => t.name === 'futaie');
  assert.ok(taillis.maxHeight < futaie.minHeight, 'un taillis ne dépasse pas une futaie');
});

test('les décalages d’atlas couvrent la grille sans se répéter', () => {
  const keys = new Set(TREE_ATLAS_OFFSETS.map(([u, v]) => `${u.toFixed(4)},${v.toFixed(4)}`));
  assert.equal(keys.size, TREE_ATLAS_OFFSETS.length, 'aucune case en double');
  // Une case par silhouette au moins ; les cases en trop restent transparentes
  // (l'atlas peut grandir avant que le thème le remplisse).
  assert.ok(
    TREE_ATLAS_OFFSETS.length >= TREE_VARIANTS.length,
    `${TREE_ATLAS_OFFSETS.length} cases pour ${TREE_VARIANTS.length} silhouettes`
  );
  for (const [u, v] of TREE_ATLAS_OFFSETS) {
    assert.ok(u >= 0 && u < 1 && v >= 0 && v < 1, 'décalage dans la texture');
  }
});

/**
 * Contexte 2D d'inventaire : il ne dessine rien, il retient où on a dessiné.
 * C'est la seule vérification automatique possible sur une texture — le rendu,
 * lui, se regarde.
 */
function atlasRecorder() {
  const marks = [];
  const stack = [];
  let tx = 0;
  let ty = 0;
  const mark = (x, y, pad = 0) => marks.push({ x, y, pad, cell: `${tx},${ty}` });
  return {
    marks,
    lineWidth: 0,
    fillStyle: '',
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    save() {
      stack.push([tx, ty]);
    },
    restore() {
      [tx, ty] = stack.pop();
    },
    translate(x, y) {
      tx += x;
      ty += y;
    },
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    moveTo(x, y) {
      mark(x, y, this.lineWidth / 2);
    },
    lineTo(x, y) {
      mark(x, y, this.lineWidth / 2);
    },
    fillRect(x, y, w, h) {
      mark(x, y);
      mark(x + w, y + h);
    },
    arc(x, y, r) {
      mark(x, y, r);
    },
    ellipse(x, y, rx, ry) {
      mark(x, y, Math.max(rx, ry));
    },
  };
}

test('chaque silhouette tient dans sa case, pose au sol et la remplit', () => {
  const cell = 160;
  const recorder = atlasRecorder();
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return recorder;
    }
  };
  try {
    createTreeAtlasCanvas(cell);
  } finally {
    if (previous) globalThis.OffscreenCanvas = previous;
    else delete globalThis.OffscreenCanvas;
  }

  const cells = new Map();
  for (const m of recorder.marks) {
    if (!cells.has(m.cell)) cells.set(m.cell, []);
    cells.get(m.cell).push(m);
  }
  assert.equal(cells.size, TREE_VARIANTS.length, 'une case dessinée par silhouette');

  const keys = [...cells.keys()];
  cells.forEach((marks, key) => {
    const look = TREE_VARIANTS[keys.indexOf(key)];
    const kind = look.kind;
    assert.ok(marks.length > 20, `${kind} : la case reçoit de l’encre`);

    // Déborder, c’est mordre sur la silhouette voisine de l’atlas : une fougère
    // gagnerait le pied d’un chêne. Le tapis du sol (celui qui déclare sa
    // taille) n’en a pas le droit ; les arbres, eux, mordent d’assez peu pour
    // que ça ne se soit jamais vu — la pointe d’un conifère sort de 7 % au
    // sommet de sa case, depuis toujours.
    const slack = look.heightM ? 0 : cell * 0.08;
    const over = Math.max(
      0,
      ...marks.map((m) =>
        Math.max(-(m.x - m.pad), m.x + m.pad - cell, -(m.y - m.pad), m.y + m.pad - cell)
      )
    );
    assert.ok(over <= slack, `${kind} : déborde de ${((over / cell) * 100).toFixed(1)} % de sa case`);
    // La plante pose au sol et occupe au moins les trois cinquièmes de sa case :
    // le panneau porte la hauteur qu’on lui donne, donc une silhouette tassée
    // en bas rendrait systématiquement plus petite qu’annoncé. L’arbuste de
    // `drawBushy` est le plus juste à cette barre (64 %).
    const low = Math.max(...marks.map((m) => m.y + m.pad));
    const high = Math.min(...marks.map((m) => m.y - m.pad));
    assert.ok(low >= cell * 0.9, `${kind} : posée au sol (${(low / cell).toFixed(2)})`);
    assert.ok(high <= cell * 0.4, `${kind} : remplit sa case (${(high / cell).toFixed(2)})`);
  });
});

// --- Fleurs et cultures -----------------------------------------------------

test('le coquelicot pousse en lisière de culture, pas au milieu du pré', () => {
  const poppy = GRASS_VARIANTS.indexOf('poppy');
  // Herbe **et** culture au même endroit : le filtrage linéaire de la carte de
  // classes ne donne ça qu'au bord d'un champ.
  assert.equal(grassVariantFor({ grass: 0.5, farmland: 0.5 }, 0.1), poppy);
  // En plein pré, jamais.
  for (const draw of [0, 0.1, 0.5, 0.99]) {
    assert.notEqual(grassVariantFor({ grass: 1, farmland: 0 }, draw), poppy);
  }
  // Et l'immense majorité des touffes reste de l'herbe nue.
  let flowered = 0;
  for (let i = 0; i < 100; i++) {
    if (grassVariantFor({ grass: 1, farmland: 0 }, i / 100) !== 0) flowered++;
  }
  assert.ok(flowered > 5 && flowered < 30, `un pré n'est pas un parterre (${flowered} %)`);
  // Sans donnée, pas de fleur inventée.
  assert.equal(grassVariantFor(null, 0.01), 0);
});

test('une maille de culture rend toujours les mêmes touffes', () => {
  const size = CROP_PER_CELL * CROP_TUFT_STRIDE;
  const a = fillCropCell(new Float32Array(size), 4, -9);
  fillCropCell(new Float32Array(size), 5, -9);
  const b = fillCropCell(new Float32Array(size), 4, -9);
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...fillCropCell(new Float32Array(size), 5, -9)]);

  for (let i = 0; i < CROP_PER_CELL; i++) {
    const at = i * CROP_TUFT_STRIDE;
    const dx = a[at] - 4 * CROP_CELL_M;
    const dz = a[at + 1] - -9 * CROP_CELL_M;
    assert.ok(dx >= 0 && dx <= CROP_CELL_M, 'x dans la maille');
    assert.ok(dz >= 0 && dz <= CROP_CELL_M, 'z dans la maille');
  }
});

test('le disque de culture est trié du centre vers le bord', () => {
  const cells = cropCellRing(20, 2.5);
  assert.ok(cells.length > 0);
  for (let i = 1; i < cells.length; i++) {
    assert.ok(cells[i].distance >= cells[i - 1].distance, 'les plus proches d’abord');
    assert.ok(cells[i].distance <= 20, 'dans le disque');
  }
});

// --- Villages : couleur et toiture ------------------------------------------

test('les ponts d’une vallée sortent du même bureau d’études', () => {
  // Même maille que la palette du bourg : les deux culées d'un pont, et les
  // deux ponts d'un village, tirent la même famille.
  const a = worksStyleAt(10, 10);
  const b = worksStyleAt(10 + TOWN_PATCH_M * 0.4, 10);
  assert.equal(a.name, b.name, 'la maille tient sur toute la traversée');

  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(worksStyleAt(i * TOWN_PATCH_M, 0).name);
  assert.ok(names.size >= 2, `plusieurs matériaux (${[...names].join(', ')})`);
  // Graine distincte de celle des murs : deux pays qui bâtissent pareil ne
  // font pas forcément leurs ponts pareil. On le montre en trouvant deux
  // mailles de même palette et d'ouvrage différent.
  const seen = new Map();
  let independent = false;
  for (let i = 0; i < 200 && !independent; i++) {
    const at = i * TOWN_PATCH_M;
    const palette = townPaletteAt(at, 0).name;
    const works = worksStyleAt(at, 0).name;
    if (seen.has(palette) && seen.get(palette) !== works) independent = true;
    seen.set(palette, works);
  }
  assert.ok(independent, 'la famille d’ouvrage ne suit pas la palette du bourg');
});

test('un tablier est plus large que sa chaussée, et sa sous-face rentrante', () => {
  const style = worksStyleAt(10, 10);
  const profile = deckProfile(4.25, style.deck);
  const rim = Math.max(...profile.map((p) => p.across));

  assert.ok(rim > 4.25, 'la corniche déborde de la rive');
  close(rim, 4.25 + style.deck.overhang, 1e-9, 'du débord annoncé par le thème');
  assert.equal(Math.max(...profile.map((p) => p.up)), 0, 'rien ne dépasse de la chaussée');
  close(Math.min(...profile.map((p) => p.up)), -style.deck.thickness, 1e-9, 'épaisseur du tablier');

  const soffit = profile.filter((p) => p.up === -style.deck.thickness);
  assert.ok(Math.max(...soffit.map((p) => p.across)) < rim, 'la sous-face est rentrante');
});

test('une voûte de tunnel dégage la chaussée et se referme au sol', () => {
  const style = worksStyleAt(10, 10);
  const halfWidth = 4.25;
  const vault = vaultProfile(halfWidth, style.portal);

  const feet = vault.filter((p) => p.up === 0);
  assert.equal(feet.length, 2, 'deux pieds, un par piédroit');
  assert.ok(Math.min(...vault.map((p) => p.across)) <= -halfWidth, 'la voûte dépasse la rive gauche');
  assert.ok(Math.max(...vault.map((p) => p.across)) >= halfWidth, 'et la rive droite');
  assert.ok(Math.max(...vault.map((p) => p.up)) > 4, 'un camion passe dessous');
});

test('un village garde sa palette, et son voisin en a une autre', () => {
  const a = townPaletteAt(10, 10);
  const b = townPaletteAt(10 + TOWN_PATCH_M * 0.4, 10);
  assert.equal(a.name, b.name, 'la maille tient sur toute la traversée');

  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(townPaletteAt(i * TOWN_PATCH_M, 0).name);
  assert.ok(names.size >= 4, `plusieurs pays (${[...names].join(', ')})`);
});

test('un village est bâti dans la pierre de son pays', () => {
  // La palette d’un bourg est ce qu’on lit d’une traversée avant même de
  // distinguer une maison : la même liste partout rendait la Baltique et
  // l’Andalousie interchangeables.
  const nordiques = new Set();
  const arides = new Set();
  for (let i = 0; i < 60; i++) {
    nordiques.add(townPaletteAt(i * TOWN_PATCH_M, 0, TOWN_PALETTES, 'boreal').name);
    arides.add(townPaletteAt(i * TOWN_PATCH_M, 0, TOWN_PALETTES, 'arid').name);
  }
  for (const name of nordiques) assert.ok(!arides.has(name), `${name} n’est pas des deux`);
  assert.ok(nordiques.has('bois rouge'));
  assert.ok(arides.has('badigeon'));

  // La maille tient : le climat réduit la liste, il ne déplace pas le tirage.
  assert.equal(
    townPaletteAt(10, 10, TOWN_PALETTES, 'oceanic').name,
    townPaletteAt(10 + TOWN_PATCH_M * 0.4, 10, TOWN_PALETTES, 'oceanic').name
  );
});

test('la pente du toit vient du bourg quand il en impose une', () => {
  // La silhouette d’un toit se lit de plus loin que sa couleur : un
  // toit-terrasse andalou et un pignon balte ne sont pas deux teintes.
  const plate = TOWN_PALETTES.find((p) => p.name === 'badigeon');
  const raide = TOWN_PALETTES.find((p) => p.name === 'brique balte');
  assert.ok(plate.pitch < DEFAULT_PITCH, 'le sud est plus plat que le défaut');
  assert.ok(raide.pitch > DEFAULT_PITCH, 'le nord est plus raide');
  // Un toit sans pente déclarée laisse celle du thème : `buildingStyleAt` rend
  // alors `undefined`, et l’appelant n’alloue rien.
  const calcaire = TOWN_PALETTES.find((p) => p.name === 'calcaire');
  assert.equal(calcaire.pitch, undefined);
});

test('aucun mur de bourg ne tombe hors de la plage claire du nuancier', () => {
  // La règle du nuancier (voir l’en-tête de `townStyle`) : pastel, jamais
  // sombre. Elle n’était vérifiée que sur le bourg qui tombait sous la sonde ;
  // une palette ajoutée pouvait donc l’enfreindre sans que rien ne le dise.
  // La modulation par maison descend jusqu’à 0,94 : c’est ce cas-là qu’on
  // mesure.
  for (const palette of TOWN_PALETTES) {
    for (const wall of palette.walls) {
      const value = Math.max(...srgb(wall)) * 0.94;
      assert.ok(value > 0.4, `${palette.name} ${wall} : mur trop sombre (${value.toFixed(3)})`);
    }
  }
});

test('deux maisons d’un même bourg se ressemblent sans être identiques', () => {
  const a = buildingStyleAt(100, 100, { area: 90, height: 7 });
  const b = buildingStyleAt(118, 92, { area: 110, height: 8 });
  assert.equal(a.palette, b.palette, 'même bourg');

  // Les tons restent proches — c'est ce partage qui fait le village — mais pas
  // rigoureusement égaux, sinon on lit un aplat.
  const gap = Math.max(...a.wall.map((c, i) => Math.abs(c - b.wall[i])));
  assert.ok(gap < 0.2, `tons voisins (${gap.toFixed(3)})`);

  let identical = 0;
  for (let i = 0; i < 40; i++) {
    const s = buildingStyleAt(100 + i * 7, 100, { area: 90, height: 7 });
    if (s.wall.every((c, k) => c === a.wall[k])) identical++;
  }
  assert.ok(identical < 30, `les maisons ne sont pas toutes de la même teinte (${identical}/40)`);

  // Pastel : rien de saturé, rien de sombre.
  for (const style of [a, b]) {
    const max = Math.max(...style.wall);
    const min = Math.min(...style.wall);
    assert.ok(max > 0.4, 'mur clair');
    assert.ok(max - min < 0.4, 'peu saturé');
  }
});

test('la forme du toit suit la taille avant le tirage', () => {
  const palette = { roofShapes: ['pyramid', 'gable'] };
  // Un immeuble n'a pas de comble, un hangar non plus.
  assert.equal(roofShapeFor(palette, { height: 24, area: 200 }), 'flat');
  assert.equal(roofShapeFor(palette, { height: 8, area: 1400 }), 'flat');
  // Une pyramide sur une grande emprise devient une croupe.
  assert.equal(roofShapeFor(palette, { height: 7, area: 400, seed: 0 }), 'hip');
  assert.equal(roofShapeFor(palette, { height: 7, area: 80, seed: 0 }), 'pyramid');

  // Chaque palette du nuancier ne propose que des formes connues.
  for (const p of TOWN_PALETTES) {
    assert.ok(p.roofShapes.length >= 2 && p.roofShapes.length <= 3, `${p.name} : deux ou trois formes`);
    for (const shape of p.roofShapes) {
      assert.ok(['gable', 'hip', 'pyramid', 'flat'].includes(shape), `${p.name} : ${shape}`);
    }
  }
});

test('le rectangle englobant trouve l’axe d’une empreinte', () => {
  // Un rectangle 20 × 6 tourné de 30° : la boîte doit le retrouver exactement.
  const angle = Math.PI / 6;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ring = [[-10, -3], [10, -3], [10, 3], [-10, 3]].map(([u, v]) => ({
    x: 40 + u * cos - v * sin,
    z: -12 + u * sin + v * cos,
  }));

  const box = orientedBox(ring);
  close(box.long, 10, 1e-6, 'demi-longueur');
  close(box.short, 3, 1e-6, 'demi-largeur');
  close(box.cx, 40, 1e-6);
  close(box.cz, -12, 1e-6);
  close(Math.abs(Math.sin(box.angle - angle)), 0, 1e-6, 'axe du faîtage');
  close(box.fill, 1, 1e-6, 'un rectangle remplit sa boîte');

  assert.equal(orientedBox([{ x: 0, z: 0 }]), null);
});

test('une empreinte en L remplit mal sa boîte, et retombe donc sur le toit plat', () => {
  const l = [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 6 },
    { x: 6, z: 6 },
    { x: 6, z: 20 },
    { x: 0, z: 20 },
  ];
  const box = orientedBox(l);
  assert.ok(box.fill < 0.62, `remplissage faible (${box.fill.toFixed(2)})`);
  close(ringArea(l), 20 * 6 + 6 * 14, 1e-6);
});

test('les pans d’un toit regardent le ciel, jamais l’intérieur', () => {
  const box = { cx: 0, cz: 0, angle: 0, long: 8, short: 4, fill: 1 };
  for (const shape of ['gable', 'hip', 'pyramid']) {
    const roof = roofTriangles(box, 6, shape);
    assert.ok(roof.positions.length > 0, `${shape} : de la géométrie`);
    assert.equal(roof.positions.length % 9, 0, `${shape} : triangles complets`);
    assert.equal(roof.normals.length, roof.positions.length);

    let up = 0;
    for (let i = 1; i < roof.normals.length; i += 3) {
      assert.ok(roof.normals[i] > -1e-6, `${shape} : aucun pan retourné`);
      if (roof.normals[i] > 0.2) up++;
    }
    assert.ok(up > 0, `${shape} : des pans inclinés`);

    // Le comble monte au-dessus de l'égout, et pas de façon déraisonnable.
    let maxY = -Infinity;
    for (let i = 1; i < roof.positions.length; i += 3) maxY = Math.max(maxY, roof.positions[i]);
    assert.ok(maxY > 6 && maxY <= 6 + 4.3, `${shape} : comble plausible (${maxY})`);
  }
  // Un toit plat n'est pas construit ici : c'est la triangulation de l'empreinte.
  assert.equal(roofTriangles(box, 6, 'flat').positions.length, 0);
  assert.equal(roofTriangles(null, 6, 'gable').positions.length, 0);
});

test('la crosse d’un lampadaire est continue du fût à la lanterne', () => {
  // C'était le défaut : trois tronçons posés à des cotes choisies à la main, qui
  // ne se touchaient pas. Le bout de chaque tronçon **est** le début du suivant.
  let previous = lampArcAt(0);
  close(previous.y, LAMP_ARC.shaft, 1e-9, 'la crosse part du haut du fût');
  close(previous.z, 0, 1e-9, 'et dans l’axe du mât');

  for (let i = 1; i <= 5; i++) {
    const point = lampArcAt(i / 5);
    assert.ok(point.y > previous.y, 'la crosse monte');
    assert.ok(point.z > previous.z, 'et avance');
    previous = point;
  }

  // La tête publiée est bien celle du bout de la crosse : c'est là que le halo
  // et la nappe de lumière s'accrochent.
  close(LAMP_HEAD_HEIGHT_M, lampArcAt(1).y - 0.16, 1e-9);
  close(LAMP_HEAD_REACH_M, lampArcAt(1).z + LAMP_ARC.lantern, 1e-9);
  assert.ok(LAMP_HEAD_REACH_M > 1 && LAMP_HEAD_REACH_M < 2, 'la lanterne avance sur la chaussée');
});

test('le semis des cultures a la densité de celui de l’herbe', () => {
  // « Il faut faire comme l'herbe » : même maille, donc même densité au mètre
  // carré à `density: 1`. C'est ce rapport, et non un nombre absolu, qui décide
  // qu'un champ de blé se lit comme un champ.
  const parMetreCarre = CROP_PER_CELL / CROP_CELL_M ** 2;
  const herbeParMetreCarre = GRASS_PER_CELL / GRASS_CELL_M ** 2;
  assert.ok(
    parMetreCarre >= herbeParMetreCarre * 0.8,
    `blé ${parMetreCarre.toFixed(2)}/m² contre herbe ${herbeParMetreCarre.toFixed(2)}/m²`
  );

});

/**
 * Rejoue le semis d'une couverture — toutes bandes confondues — et rend le
 * nombre d'instances posées, ainsi que le détail par bande. C'est la boucle de
 * `_scatter`, moins ce qui demande une scène : la couverture y est pleine et
 * rien n'est écarté par la route.
 */
function semisComplet(bands, fill, stride, densite) {
  const largest = Math.max(...bands.map((band) => band.perCell));
  const buffer = new Float32Array(largest * stride);
  const parBande = bands.map(() => 0);
  let total = 0;

  for (const cell of coverBandRing(bands)) {
    const band = bands[cell.band];
    const fade = coverBandFade(cell.distance, band);
    if (fade <= 0.02) continue;
    const seuil = coverMassDensity(densite, band) * fade;
    fill(buffer, cell.gx, cell.gz, band.cell, band.perCell, band.salt);
    for (let i = 0; i < band.perCell; i++) {
      if (buffer[i * stride + 2] <= seuil) {
        total++;
        parBande[cell.band]++;
      }
    }
  }
  return { total, parBande };
}

test('le plafond de touffes couvre le pire cas, sinon la couverture rétrécit en douce', () => {
  // Un plafond atteint ne casse rien — les mailles sont semées de la plus
  // proche à la plus lointaine — mais il raccourcit la couverture sans le dire,
  // et d'une quantité qui dépend de la culture. On préfère le savoir ici.
  const prairie = semisComplet(GRASS_BANDS, fillGrassCell, GRASS_TUFT_STRIDE, 1);
  assert.ok(
    prairie.total <= GRASS_COUNT,
    `prairie pleine : ${prairie.total} touffes pour ${GRASS_COUNT}`
  );

  for (const [nom, look] of Object.entries(CROP_LOOK)) {
    const champ = semisComplet(CROP_BANDS, fillCropCell, CROP_TUFT_STRIDE, look.density);
    assert.ok(champ.total <= CROP_COUNT, `${nom} : ${champ.total} touffes pour ${CROP_COUNT}`);
  }
});

test('l’agrégation tient sa promesse : plus loin, sans exploser le nombre d’instances', () => {
  // Le pari des bandes est celui-ci et pas un autre : si une bande lointaine
  // coûtait autant qu'une bande proche, autant garder un disque uniforme et
  // l'agrandir. Chaque bande doit donc poser **moins** d'instances que la
  // précédente, alors qu'elle couvre une surface bien plus grande.
  for (const [nom, bands, fill, stride, densite] of [
    ['herbe', GRASS_BANDS, fillGrassCell, GRASS_TUFT_STRIDE, 1],
    ['blé', CROP_BANDS, fillCropCell, CROP_TUFT_STRIDE, 1],
  ]) {
    const { parBande } = semisComplet(bands, fill, stride, densite);
    for (let i = 1; i < parBande.length; i++) {
      const surface = Math.PI * (bands[i].to ** 2 - bands[i].from ** 2);
      const precedente = Math.PI * (bands[i - 1].to ** 2 - bands[i - 1].from ** 2);
      assert.ok(
        surface > precedente,
        `${nom} : la bande ${i} doit couvrir plus de surface que la ${i - 1}`
      );
      assert.ok(
        parBande[i] < parBande[i - 1],
        `${nom} : bande ${i} pose ${parBande[i]} instances contre ${parBande[i - 1]} pour la ${i - 1}`
      );
    }
  }
});

test('les bandes se relaient sans creuser la couverture', () => {
  // Le passage d'une échelle à l'autre est un fondu de **densité** : dans la
  // zone commune, la bande intérieure perd ses instances pendant que
  // l'extérieure gagne les siennes. Si les deux fondus ne se compensaient pas,
  // il resterait un anneau clairsemé autour de l'observateur — le défaut que
  // les bandes sont censées corriger, réintroduit à une autre distance.
  for (const [nom, bands] of [
    ['herbe', GRASS_BANDS],
    ['cultures', CROP_BANDS],
  ]) {
    for (let i = 1; i < bands.length; i++) {
      const dedans = bands[i - 1];
      const dehors = bands[i];
      assert.ok(
        dehors.from < dedans.to,
        `${nom} : les bandes ${i - 1} et ${i} doivent se recouvrir`
      );
      // Sur toute la zone commune, la somme des deux parts reste proche de 1.
      for (let d = dehors.from; d <= dedans.to; d += 0.25) {
        const somme = coverBandFade(d, dedans) + coverBandFade(d, dehors);
        assert.ok(
          somme > 0.9 && somme < 1.1,
          `${nom} : à ${d.toFixed(2)} m les bandes ${i - 1} et ${i} totalisent ${somme.toFixed(3)}`
        );
      }
    }
    // Et la couverture ne s'arrête jamais au couteau : la dernière bande sort
    // en fondu.
    const derniere = bands[bands.length - 1];
    assert.ok(derniere.fadeOut > 0, `${nom} : la dernière bande doit sortir en fondu`);
    close(coverBandFade(derniere.to, derniere), 0, 1e-9, `${nom} : nulle au bord`);
  }
});

test('deux bandes ne sèment pas les mêmes touffes à la même maille', () => {
  // Chaque bande a sa propre grille, mais rien n'empêche deux grilles d'avoir
  // une maille de mêmes indices. Sans le sel, les deux échelles tireraient
  // alors exactement les mêmes touffes au même endroit : elles se
  // superposeraient au lieu de se relayer.
  const sels = GRASS_BANDS.map((band) => band.salt);
  assert.equal(new Set(sels).size, sels.length, 'les sels des bandes sont distincts');
  assert.equal(
    new Set(CROP_BANDS.map((band) => band.salt)).size,
    CROP_BANDS.length,
    'idem pour les cultures'
  );

  const taille = 10 * GRASS_TUFT_STRIDE;
  const bande0 = [...fillGrassCell(new Float32Array(taille), 5, -3, 1.6, 10, 0)];
  const bande1 = [...fillGrassCell(new Float32Array(taille), 5, -3, 1.6, 10, 1)];
  assert.notDeepEqual(bande0, bande1, 'un sel différent donne des touffes différentes');

  // Le sel par défaut ne change rien : la bande de détail sème exactement ce
  // qu'elle semait avant les bandes.
  assert.deepEqual(
    [...fillGrassCell(new Float32Array(taille), 5, -3)],
    bande0,
    'sans sel, le semis d’origine'
  );
});

test('une maille de bande lointaine reste ancrée au sol', () => {
  // Le déterminisme spatial vaut pour toutes les bandes, pas seulement la
  // première : une masse doit rester à sa place quand l'observateur avance,
  // sinon la moyenne distance se met à grouiller.
  const band = GRASS_BANDS[GRASS_BANDS.length - 1];
  const taille = band.perCell * GRASS_TUFT_STRIDE;
  const a = fillGrassCell(new Float32Array(taille), 7, 11, band.cell, band.perCell, band.salt);
  // Des mailles voisines tirées entre les deux appels : l'état du générateur ne
  // doit pas fuir d'une maille à l'autre.
  fillGrassCell(new Float32Array(taille), 8, 11, band.cell, band.perCell, band.salt);
  const b = fillGrassCell(new Float32Array(taille), 7, 11, band.cell, band.perCell, band.salt);
  assert.deepEqual([...a], [...b], 'même maille, même masse');

  // Et les positions tombent bien dans la maille de **cette** bande.
  for (let i = 0; i < band.perCell; i++) {
    const at = i * GRASS_TUFT_STRIDE;
    assert.ok(a[at] >= 7 * band.cell && a[at] < 8 * band.cell, 'x dans la maille');
    assert.ok(a[at + 1] >= 11 * band.cell && a[at + 1] < 12 * band.cell, 'z dans la maille');
  }
});

test('une masse garde le fleurissement et la culture qu’elle représente', () => {
  // C'est ce qui distingue cette agrégation d'une silhouette de masse unique :
  // un pré de coquelicots reste un pré de coquelicots à quatre-vingts mètres,
  // et un champ de maïs reste identifiable comme du maïs.
  for (const nom of ['white', 'yellow', 'poppy']) {
    const detail = GRASS_VARIANTS.indexOf(nom);
    const masse = grassMassVariant(detail, 0.5);
    assert.notEqual(masse, detail, `${nom} : la masse est une autre case`);
    assert.ok(
      GRASS_VARIANTS[masse].toLowerCase().includes(nom),
      `${nom} : la masse porte le même fleurissement (${GRASS_VARIANTS[masse]})`
    );
  }

  // L'herbe nue, cas de loin le plus fréquent, dispose de deux silhouettes :
  // une seule répétée sur des hectares se lirait comme un motif.
  const plain = GRASS_VARIANTS.indexOf('plain');
  const masses = new Set([grassMassVariant(plain, 0.1), grassMassVariant(plain, 0.9)]);
  assert.equal(masses.size, 2, 'deux masses d’herbe nue');
  for (const masse of masses) assert.ok(GRASS_VARIANTS[masse].startsWith('clump'));

  // Toute case de masse existe réellement dans l'atlas, et son décalage aussi.
  for (let i = 0; i < GRASS_VARIANTS.length; i++) {
    assert.ok(GRASS_ATLAS_OFFSETS[i], `case ${GRASS_VARIANTS[i]} sans décalage`);
  }
  for (const look of Object.values(CROP_LOOK)) {
    const masse = `${look.atlas}Mass`;
    const at = CROP_VARIANTS.indexOf(masse);
    assert.ok(at >= 0, `${masse} manque à l’atlas des cultures`);
    assert.ok(CROP_ATLAS_OFFSETS[at], `${masse} sans décalage`);
  }
});

/**
 * Contexte 2D bouchonné : il ne dessine rien, il **note** dans quelle case de
 * l'atlas chaque tracé est tombé.
 *
 * Le rendu des atlas n'existe qu'en navigateur, donc aucun test ne l'exécute —
 * et c'est précisément le genre de code où une case oubliée ou un peintre qui
 * lève ne se voit qu'à l'écran, tard. On ne juge pas ici du dessin : on vérifie
 * qu'il a lieu, partout où il doit.
 */
function atlasProbe(cell, cols, rows) {
  const touched = new Set();
  let x = 0;
  let y = 0;
  let sx = 1;
  let sy = 1;
  let current = null;
  const stack = [];
  // La case créditée est celle que la **boucle d'atlas** a cadrée, et non celle
  // où le point tombe : une masse déborde largement sur ses voisines (c'est même
  // ce qui la rend continue), et créditer le point ferait tenir une case vide
  // pour peinte par le débordement de la précédente.
  const mark = () => {
    if (current !== null) touched.add(current);
  };
  const ctx = {
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineCap(v) {},
    save() {
      stack.push([x, y, sx, sy, current]);
    },
    restore() {
      [x, y, sx, sy, current] = stack.pop();
    },
    translate(dx, dy) {
      x += dx * sx;
      y += dy * sy;
      // Seule la translation faite juste sous le `save` de la boucle d'atlas
      // cadre une case ; celles des sous-touffes d'une masse sont plus profondes.
      if (stack.length !== 1) return;
      const col = Math.round(x / cell);
      const row = Math.round(y / cell);
      current = col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : null;
    },
    scale(kx, ky) {
      sx *= kx;
      sy *= ky;
    },
    beginPath() {},
    closePath() {},
    fill: mark,
    stroke: mark,
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    ellipse() {},
    arc() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return { ctx, touched };
}

test('chaque case des atlas de couverture reçoit un dessin', () => {
  const CELL = 16;
  for (const [nom, cols, rows, variants, paint] of [
    ['herbe', GRASS_ATLAS_COLS, GRASS_ATLAS_ROWS, GRASS_VARIANTS, createGrassAtlasCanvas],
    ['cultures', CROP_ATLAS_COLS, CROP_ATLAS_ROWS, CROP_VARIANTS, createCropAtlasCanvas],
  ]) {
    const probe = atlasProbe(CELL, cols, rows);
    // `createCanvas` n'est appelé qu'ici, jamais au chargement du module : un
    // `OffscreenCanvas` bouchonné le temps de l'appel suffit.
    const previous = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        Object.assign(this, { width, height });
      }
      getContext() {
        return probe.ctx;
      }
    };
    try {
      // Ne doit pas lever : un peintre de masse qui casse rend la couche
      // entière inconstructible.
      paint(CELL, 1234);
    } finally {
      globalThis.OffscreenCanvas = previous;
    }

    for (let i = 0; i < variants.length; i++) {
      assert.ok(probe.touched.has(i), `${nom} : la case ${i} (${variants[i]}) reste vide`);
    }
  }
});

test('les décalages d’atlas suivent la taille de la grille', () => {
  // Une table écrite à la main et une grille agrandie donnent une végétation
  // qui échantillonne la case du voisin — un défaut qu'on ne voit qu'en
  // roulant. Les deux atlas de couverture sont carrés : le shader ne divise
  // l'UV que par un seul scalaire.
  assert.equal(GRASS_ATLAS_COLS, GRASS_ATLAS_ROWS, 'atlas d’herbe carré');
  assert.equal(CROP_ATLAS_COLS, CROP_ATLAS_ROWS, 'atlas de cultures carré');
  assert.ok(GRASS_VARIANTS.length <= GRASS_ATLAS_COLS * GRASS_ATLAS_ROWS);
  assert.ok(CROP_VARIANTS.length <= CROP_ATLAS_COLS * CROP_ATLAS_ROWS);

  // La convention de cases n'a pas bougé : sur une grille 2 × 2, la table
  // dérivée est exactement celle qui était écrite à la main.
  assert.deepEqual(atlasOffsets(2, 2), [
    [0, 0.5],
    [0.5, 0.5],
    [0, 0],
    [0.5, 0],
  ]);
  // Aucune case ne tombe hors de [0, 1[, et aucune ne se répète.
  const vues = new Set();
  for (const [u, v] of atlasOffsets(3, 3)) {
    assert.ok(u >= 0 && u < 1 && v >= 0 && v < 1, 'décalage dans la texture');
    vues.add(`${u.toFixed(6)},${v.toFixed(6)}`);
  }
  assert.equal(vues.size, 9, 'neuf cases distinctes');
});

test('l’identifiant de culture fait l’aller-retour par le canal rouge', () => {
  // Cet identifiant est le pont entre les trois lecteurs de la carte : le
  // shader de terrain, qui en tire la couleur du champ jusqu'à l'horizon,
  // `cropLayer`, qui sème dessus, et le mobilier, qui décide de ne pas clôturer
  // un champ en culture. S'il ne fait pas l'aller-retour, les trois se
  // contredisent — et c'est le genre de désaccord qu'on ne voit qu'en roulant.
  assert.equal(cropId(null), 0, 'pas de culture : zéro');
  assert.equal(cropId('inconnue'), 0);
  assert.equal(cropFromId(0), null);

  for (const kind of CROP_KINDS) {
    const id = cropId(kind);
    assert.ok(id > 0, `${kind} a un identifiant`);
    assert.equal(cropFromId(id * CROP_ID_STEP), kind, `${kind} se relit`);
  }

  // Le canal est un octet : au-delà, deux cultures partageraient une valeur.
  assert.ok(CROP_KINDS.length * CROP_ID_STEP <= 255, 'les identifiants tiennent dans un octet');

  // Toute culture que `cropFor` sait produire doit avoir un identifiant, sans
  // quoi elle serait peinte comme « pas un champ ».
  for (let i = 0; i <= 200; i++) {
    const crop = cropFor({ class: 'farmland' }, i / 200);
    if (crop) assert.ok(cropId(crop) > 0, `${crop} est dans CROP_KINDS`);
  }
});

test('une masse de culture est peinte pour l’élancement auquel elle sera vue', () => {
  // Le défaut que cela corrige : la case d'atlas est carrée, le panneau qui la
  // porte ne l'est pas. À 4,5 d'élargissement, un capitule de tournesol
  // s'étalait quatre fois plus large que haut — le champ lointain devenait une
  // frise de galettes. La masse est donc peinte resserrée d'autant, et pour que
  // ce soit possible avec **une** case, les deux bandes de masse partagent leur
  // élargissement.
  const massBands = CROP_BANDS.filter((band) => band.spread !== 1);
  assert.ok(massBands.length >= 2, 'il y a bien plusieurs bandes de masse');
  for (const band of massBands) {
    assert.equal(band.spread, CROP_MASS_SPREAD, 'les bandes de masse partagent leur élargissement');
  }

  // Et la compensation suit ce que le champ vaudra réellement à l'écran : la
  // largeur que `cropLayer` donne au panneau, divisée par sa hauteur.
  for (const [nom, look] of Object.entries(CROP_LOOK)) {
    const attendu = look.spread * 4 * CROP_MASS_SPREAD;
    const ecrit = CROP_MASS_ASPECT[look.atlas];
    assert.ok(ecrit, `${nom} : la masse ${look.atlas} n’a pas d’élancement`);
    assert.ok(
      Math.abs(ecrit - attendu) < 0.2,
      `${nom} : masse peinte pour ${ecrit}, vue à ${attendu.toFixed(2)}`
    );
  }
});

test('la lavande pousse dans le Midi, le colza dans le Nord', () => {
  // C'est ce que les climats étaient censés apporter, et ce qui manquait : les
  // assolements se distinguaient par des **parts** de quatre cultures
  // partout identiques. Un pays se reconnaît d'abord à ce qu'il cultive.
  const porte = (famille, culture) =>
    (CROP_MIXES[famille] || []).some(([crop]) => crop === culture);

  for (const famille of ['mediterranean', 'mediterraneanCool', 'mediterraneanMontane', 'semiArid']) {
    assert.ok(porte(famille, 'lavender'), `${famille} porte de la lavande`);
  }
  for (const famille of ['oceanic', 'oceanicUpland', 'continental', 'boreal']) {
    assert.ok(porte(famille, 'rapeseed'), `${famille} porte du colza`);
    assert.ok(!porte(famille, 'lavender'), `${famille} ne porte pas de lavande`);
  }
  // Et l'inverse : une lavande de Laponie ou un colza de désert se remarquent.
  assert.ok(!porte('boreal', 'lavender'));
  assert.ok(!porte('arid', 'rapeseed'));

  // Une culture d'assolement est soit semée en touffes, soit balayée en rangs :
  // rien ne doit être tiré qui ne sache se dessiner.
  for (const [famille, mix] of Object.entries(CROP_MIXES)) {
    for (const [crop] of mix) {
      assert.ok(
        CROP_LOOK[crop] || ROW_CROPS.has(crop),
        `${famille} : ${crop} n’est ni semé ni balayé`
      );
    }
  }
});

test('toute culture semée en touffes est une culture connue', () => {
  // `cropLayer` ne connaît que les cultures qu'il sait dessiner ; vigne et
  // verger passent par les rangs du mobilier. Mais l'inverse doit tenir : rien
  // ne doit être semé qui ne soit pas dans la carte.
  for (const kind of Object.keys(CROP_LOOK)) {
    assert.ok(CROP_KINDS.includes(kind), `${kind} doit avoir un identifiant de carte`);
  }
});

// ---------------------------------------------------------------------------
// Étiquettes de mise au point (objectLabels)
// ---------------------------------------------------------------------------

test('un nom de maillage se traduit, et rien ne se perd en route', () => {
  assert.equal(labelForMeshName('furniture-streetLamp'), 'lampadaire');
  assert.equal(labelForMeshName('furniture-hedge'), 'haie');
  assert.equal(labelForMeshName('road-major'), 'route principale');
  assert.equal(labelForMeshName('buildings'), 'bâtiment');
  assert.equal(labelForMeshName('vegetation-15/16594/11269'), 'arbres');
  assert.equal(labelForMeshName('terrain-15/16594/11269'), 'terrain 15/16594/11269');

  // Ce qui n'est pas du décor n'est pas étiqueté.
  assert.equal(labelForMeshName('sky-dome'), null);
  assert.equal(labelForMeshName(''), null);

  // Un outil de mise au point qui tait ce qu'il ne connaît pas ment sur l'état
  // du décor : un nom inconnu ressort tel quel, jamais rien.
  assert.equal(labelForMeshName('furniture-tramway'), 'mobilier (tramway)');
  assert.equal(labelForMeshName('road-tunnel'), 'route (tunnel)');
  assert.equal(labelForMeshName('quelque-chose-de-neuf'), 'quelque-chose-de-neuf');
});

test('sourceForMeshName : la carte pour ce qui existe dans la donnée, la procédure pour le reste', () => {
  // Ce que la donnée porte réellement.
  assert.equal(sourceForMeshName('buildings'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('water'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('railway'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('streets'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('road-major'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('furniture-monument'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('furniture-fountain'), LABEL_SOURCE_OSM);
  assert.equal(sourceForMeshName('furniture-cemeteryCross'), LABEL_SOURCE_OSM);

  // Une population tirée, même quand la parcelle qui la porte est réelle.
  assert.equal(sourceForMeshName('furniture-streetLamp'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('furniture-hedge'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('furniture-barn'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('ground-cover'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('crops'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('gardens'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName('vegetation-15/16594/11269'), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName(''), LABEL_SOURCE_GENERATED);
  assert.equal(sourceForMeshName(null), LABEL_SOURCE_GENERATED);
});

test('toute forme de mobilier posée dans la scène a un nom lisible', () => {
  // Le catalogue est la source : une forme ajoutée sans nom sortirait en
  // « mobilier (xxx) », ce qui est exactement le genre de trou qu'on ne
  // remarque qu'en cherchant autre chose.
  for (const kind of Object.keys(FURNITURE_BUILDERS)) {
    assert.ok(LABEL_FURNITURE[kind], `${kind} doit avoir un nom lisible`);
  }
  for (const profile of ROAD_PROFILE_ORDER) {
    assert.ok(LABEL_ROADS[profile], `le profil ${profile} doit avoir un nom lisible`);
  }
  for (const crop of CROP_KINDS) {
    assert.ok(LABEL_CROPS[crop], `la culture ${crop} doit avoir un nom lisible`);
  }
});

test("l'exemplaire étiqueté d'un maillage instancié est le plus proche", () => {
  // Une étiquette au centre de mille lampadaires ne désigne aucun lampadaire.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrixOf = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const mesh = {
    count: 3,
    instanceMatrix: { array: [...matrixOf(50, 0, 0), ...matrixOf(4, 1, 0), ...matrixOf(-30, 0, 12)] },
    matrixWorld: { elements: identity },
  };

  const nearest = nearestInstance(mesh, { x: 0, y: 1, z: 0 });
  assert.deepEqual(nearest, { x: 4, y: 1, z: 0 });

  // La matrice du parent compte : les couches instanciées vivent dans un groupe.
  const shifted = { ...mesh, matrixWorld: { elements: matrixOf(0, 100, 0) } };
  assert.equal(nearestInstance(shifted, { x: 0, y: 101, z: 0 }).y, 101);

  assert.equal(nearestInstance({ count: 0, instanceMatrix: { array: [] } }, { x: 0, y: 0, z: 0 }), null);
});

test("le sommet étiqueté d'une chaussée est celui qu'on a sous les yeux", () => {
  // Une chaussée fait neuf cents mètres : le centre de sa boîte englobante
  // poserait l'étiquette dans un champ, à cinq cents mètres de la route.
  const mesh = {
    geometry: { attributes: { position: { array: [-400, 0, 0, 3, 0, 2, 400, 0, 0], count: 3, itemSize: 3 } } },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  };
  assert.deepEqual(nearestVertex(mesh, { x: 0, y: 0, z: 0 }), { x: 3, y: 0, z: 2 });
});

test('la traversée du graphe étiquette ce qui est dans la portée, et le plus proche d’abord', () => {
  const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const meshAt = (name, x, extra = {}) => ({
    isMesh: true,
    name,
    id: name,
    matrixWorld: identity,
    geometry: { attributes: { position: { array: [x, 0, 0], count: 1, itemSize: 3 } } },
    ...extra,
  });

  const root = {
    children: [
      meshAt('furniture-streetLamp', 40),
      meshAt('buildings', 8),
      meshAt('road-minor', 5000), // hors portée
      meshAt('crops', 2), // étiqueté par parcelle, pas par touffe
      meshAt('water', 12, { visible: false }), // invisible : rien à désigner
      { children: [meshAt('furniture-hedge', 20)] }, // un groupe se traverse
    ],
  };

  const labels = collectSceneLabels({ root, eye: { x: 0, y: 0, z: 0 }, skip: new Set(['crops']) });
  assert.deepEqual(labels.map((l) => l.text), ['bâtiment', 'haie', 'lampadaire']);
  // Le bâtiment vient de la donnée, la haie et le lampadaire d'un tirage.
  assert.deepEqual(labels.map((l) => l.source), [LABEL_SOURCE_OSM, LABEL_SOURCE_GENERATED, LABEL_SOURCE_GENERATED]);

  // La portée se règle, et le nombre d'étiquettes aussi.
  const eye = { x: 0, y: 0, z: 0 };
  const skip = new Set(['crops']);
  assert.equal(collectSceneLabels({ root, eye, skip, radius: 10 }).length, 1);
  assert.equal(collectSceneLabels({ root, eye, skip, max: 2 }).length, 2);

  // Sans consigne, rien n'est sauté : les touffes de culture reviennent.
  assert.ok(collectSceneLabels({ root, eye }).some((l) => l.text === 'cultures (semis)'));
});

test('les cases voisines de même culture forment une parcelle, une route les sépare', () => {
  // Grille 4×3 : deux plages de blé séparées par une colonne sans culture.
  const W = 'wheat';
  const kinds = [
    W, W, null, W,
    W, W, null, W,
    W, W, null, W,
  ];
  const clusters = clusterCropGrid(kinds, 4, 3);
  assert.equal(clusters.length, 2, 'la colonne vide coupe la connexité');
  assert.equal(clusters[0].cells, 6);
  assert.equal(clusters[1].cells, 3);
  // Barycentre de la grande plage : colonnes 0 et 1, lignes 0 à 2.
  assert.equal(clusters[0].col, 0.5);
  assert.equal(clusters[0].row, 1);

  // Deux cultures différentes ne fusionnent pas, même collées.
  const mixed = clusterCropGrid([W, W, 'maize', 'maize'], 4, 1, 2);
  assert.deepEqual(mixed.map((c) => c.kind).sort(), ['maize', 'wheat']);

  // Une plage minuscule n'a pas d'étiquette : c'est du bruit de rasterisation.
  assert.equal(clusterCropGrid([W, null, null, null], 4, 1, 3).length, 0);
});

test("une parcelle s'étiquette au-dessus du sol, avec sa surface", () => {
  // Champ de blé de 5×5 cases de 12 m dans le quart nord-est du disque.
  const cropAt = (x, z) => (x >= 0 && x <= 48 && z >= 0 && z <= 48 ? 'wheat' : null);
  const labels = collectCropLabels({
    center: { x: 0, z: 0 },
    cropAt,
    groundAt: () => 100,
    radius: 120,
  });

  assert.equal(labels.length, 1);
  assert.match(labels[0].text, /^blé — /);
  // 25 cases de 12 m × 12 m = 0,36 ha.
  assert.match(labels[0].text, /0\.4 ha/);
  assert.equal(labels[0].y, 103, "l'étiquette flotte au-dessus du sol");
  assert.ok(labels[0].x > 0 && labels[0].z > 0, 'elle est posée sur le champ');
  // Le schéma ne dit quasiment jamais la culture : toujours inventé.
  assert.equal(labels[0].source, LABEL_SOURCE_GENERATED);
});

// --- Emprises `landuse`/`landcover` : le type de lieu, avant tout mobilier ---

test('labelForPlace : le subclass précise, la class prend le relais', () => {
  assert.equal(labelForPlace('farmland', 'farmyard'), 'cour de ferme');
  assert.equal(labelForPlace('farmland', undefined), 'terres agricoles');
  assert.equal(labelForPlace('residential', null), 'zone résidentielle');
  assert.equal(labelForPlace('inconnu', 'inconnu'), null);
});

/** Fausse source de tuiles vectorielles : une seule couche, une seule entité. */
function fakePlaceSource(features) {
  return {
    forEachFeature(layer, tiles, cb) {
      for (const f of features.filter((f) => f.layer === layer)) {
        cb(f.geometry, f.properties);
      }
    },
  };
}

/** Repère local qui traite lng/lat comme des mètres — suffisant pour ce test. */
const identityFrame = { toLocal: (lng, lat) => ({ x: lng, z: lat }) };

test('collectPlaceLabels retrouve une cour de ferme, pas les prés autour', () => {
  const source = fakePlaceSource([
    {
      layer: 'landuse',
      properties: { class: 'farmland', subclass: 'farmyard' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-50, -50],
            [50, -50],
            [50, 50],
            [-50, 50],
            [-50, -50],
          ],
        ],
      },
    },
    {
      // Ni class ni subclass reconnus : ne doit produire aucune étiquette.
      layer: 'landuse',
      properties: { class: 'meadow_unknown', subclass: undefined },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-50, -50],
            [50, -50],
            [50, 50],
            [-50, 50],
            [-50, -50],
          ],
        ],
      },
    },
  ]);

  const labels = collectPlaceLabels({
    source,
    tiles: [{ x: 0, y: 0 }],
    frame: identityFrame,
    eye: { x: 0, z: 0 },
    groundAt: () => 50,
  });

  assert.equal(labels.length, 1, "seule l'emprise reconnue est étiquetée");
  assert.match(labels[0].text, /^cour de ferme — /);
  assert.equal(labels[0].y, 52, "l'étiquette flotte au-dessus du sol");
  // `class`/`subclass` viennent de la tuile : toujours la carte.
  assert.equal(labels[0].source, LABEL_SOURCE_OSM);
});

test('collectPlaceLabels écarte ce qui est hors de portée', () => {
  const farAway = {
    layer: 'landuse',
    properties: { class: 'residential' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [995, 995],
          [1005, 995],
          [1005, 1005],
          [995, 1005],
          [995, 995],
        ],
      ],
    },
  };
  const source = fakePlaceSource([farAway]);

  const labels = collectPlaceLabels({
    source,
    tiles: [{ x: 0, y: 0 }],
    frame: identityFrame,
    eye: { x: 0, z: 0 },
    groundAt: () => 0,
    radius: 100,
  });

  assert.equal(labels.length, 0);
});

// --- Bâtiments spéciaux : église, mosquée, hôpital, boulangerie, commerce ---

test('collectBuildingLabels traduit chaque personnalité connue, écarte les autres', () => {
  const buildings = [
    { x: 10, z: 0, kind: 'church' },
    { x: 0, z: 20, kind: 'mosque' },
    { x: -10, z: 0, kind: 'hospital' },
    { x: 0, z: -10, kind: 'bakery' },
    { x: 5, z: 5, kind: 'retail' },
    { x: -5, z: -5, kind: 'shop' },
    { x: 1, z: 1, kind: 'inconnu' }, // ni dans LABEL_BUILDING_PERSONALITY
  ];

  const labels = collectBuildingLabels({ buildings, eye: { x: 0, z: 0 }, groundAt: () => 100 });

  assert.equal(labels.length, 6, "la personnalité non traduite n'a pas d'étiquette");
  const byText = labels.map((l) => l.text).sort();
  assert.deepEqual(byText, ['boulangerie', 'commerce', 'grande surface', 'hôpital', 'mosquée', 'église']);
  assert.equal(labels[0].y, 103, "l'étiquette flotte au-dessus du sol");
  // `buildingPersonalityFor` classe un vrai point d'intérêt : toujours la carte.
  assert.ok(labels.every((l) => l.source === LABEL_SOURCE_OSM));
});

test('collectBuildingLabels : retail et shop restent deux traductions distinctes', () => {
  assert.equal(LABEL_BUILDING_PERSONALITY.retail, 'grande surface');
  assert.equal(LABEL_BUILDING_PERSONALITY.shop, 'commerce');
  assert.notEqual(LABEL_BUILDING_PERSONALITY.retail, LABEL_BUILDING_PERSONALITY.shop);
});

test('collectBuildingLabels écarte ce qui est hors de portée, tolère une liste vide', () => {
  const labels = collectBuildingLabels({
    buildings: [{ x: 1000, z: 0, kind: 'church' }],
    eye: { x: 0, z: 0 },
    groundAt: () => 0,
    radius: 100,
  });
  assert.equal(labels.length, 0);

  assert.deepEqual(collectBuildingLabels({ buildings: [], eye: { x: 0, z: 0 }, groundAt: () => 0 }), []);
  assert.deepEqual(collectBuildingLabels({ buildings: undefined, eye: { x: 0, z: 0 }, groundAt: () => 0 }), []);
});

// --- Emprise routière : la frontière partagée du décor -----------------------
//
// Tout ce qui suit vérifie une seule chose sous des angles différents : un
// élément de décor ne doit jamais se retrouver sur la chaussée, et une haie que
// la route traverse doit être **coupée**, pas supprimée.

/** Une route droite d'ouest en est, axe z = 0. */
function corridorIndex(halfWidth = 2.5, z = 0) {
  const points = [];
  for (let x = -200; x <= 200; x += 10) points.push({ x, z });
  return new RoadIndex([fakeSegment(points, halfWidth, 10)], {
    margin: ROAD_CUT_M + ROAD_CUT_BLEND_M,
  });
}

/** Une polyligne nord-sud à l'abscisse `x`, échantillonnée tous les `step`. */
function crossing(x = 0, from = -30, to = 30, step = 6) {
  const points = [];
  for (let z = from; z <= to; z += step) points.push({ x, z });
  return points;
}

test('l’emprise est la chaussée plus son accotement excavé, et rien d’autre', () => {
  // Elle n'a pas de valeur propre : c'est le fond plat du déblai. Les deux
  // doivent bouger ensemble, sinon on terrasse plus large qu'on n'interdit.
  assert.equal(CORRIDOR_MARGIN_M, ROAD_CUT_M, 'même largeur que le déblai');

  const index = corridorIndex(2.5);
  assert.ok(inCorridor(index, 0, 0), 'au milieu de la chaussée');
  assert.ok(inCorridor(index, 0, 3.6), 'sur l’accotement excavé');
  assert.ok(!inCorridor(index, 0, 3.8), 'au-delà, le sol redevient naturel');
  assert.ok(!inCorridor(index, 0, 40), 'en pleine prairie');
});

test('sans réseau routier, rien n’est dans l’emprise', () => {
  // On ne devine pas une route absente : une bulle sans chaussée n'interdit
  // rien, et surtout pas au hasard.
  assert.equal(inCorridor(null, 0, 0), false);
  const runs = clipOutsideCorridor(crossing(), null);
  assert.equal(runs.length, 1, 'la polyligne ressort entière');
  assert.equal(runs[0].length, crossing().length, 'et avec tous ses sommets');
});

test('un index combiné répond comme l’union de ses emprises', () => {
  // Deux routes parallèles, l'une à z = 0 (la « chaussée »), l'autre à
  // z = 100 (la « voie ferrée ») : c'est exactement la forme sous laquelle
  // `worldComposer` combine route et rail (`CombinedIndex`).
  const road = corridorIndex(2.5, 0);
  const rail = corridorIndex(1.75, 100);
  const combined = new CombinedIndex([road, rail]);

  assert.ok(combined.covers(0, 0), 'sur la première emprise');
  assert.ok(combined.covers(0, 100), 'sur la seconde');
  assert.ok(!combined.covers(0, 50), 'entre les deux, rien');

  // `query` doit rendre le tronçon réellement touché, pas un artefact du
  // regroupement : à z = 100, c'est le rail qui répond, avec sa propre
  // demi-largeur.
  const hit = combined.query(0, 100, 5);
  assert.ok(hit, 'un point sur le rail est bien trouvé');
  close(hit.segment.halfWidth, 1.75, 1e-9, 'demi-largeur du rail, pas de la route');

  // Une entrée absente (pas encore de voie ferrée construite) ne casse rien :
  // c'est exactement `RoadIndex` seul.
  const roadOnly = new CombinedIndex([road, null]);
  assert.ok(roadOnly.covers(0, 0));
  assert.ok(!roadOnly.covers(0, 100));

  assert.deepEqual(new CombinedIndex([null, null]).indexes, [], 'aucune emprise absente ne subsiste');
});

test('une haie perpendiculaire est coupée au bord exact de la chaussée', () => {
  const index = corridorIndex(2.5);
  const runs = clipOutsideCorridor(crossing(), index);

  assert.equal(runs.length, 2, 'deux tronçons, un de chaque côté');
  const edge = 2.5 + CORRIDOR_MARGIN_M;
  // La tolérance est celle de la dichotomie : quelques millimètres.
  close(runs[0][runs[0].length - 1].z, -edge, 0.02, 'bout amont au bord');
  close(runs[1][0].z, edge, 0.02, 'reprise au bord opposé');
  assert.ok(
    runs.every((run) => run.every((p) => !inCorridor(index, p.x, p.z))),
    'aucun sommet ne reste sur la voirie'
  );
});

test('une haie parallèle hors emprise n’est pas touchée', () => {
  const index = corridorIndex(2.5);
  const along = [];
  for (let x = -50; x <= 50; x += 6) along.push({ x, z: 4.2 });

  const runs = clipOutsideCorridor(along, index);
  assert.equal(runs.length, 1, 'un seul tronçon');
  assert.equal(runs[0].length, along.length, 'aucun sommet ajouté ni perdu');
  // Le sondage sert à détecter les traversées, pas à densifier le tracé : une
  // haie ne doit pas gagner un sommet tous les mètres au passage.
  close(runs[0][0].x, along[0].x, 1e-9, 'premier sommet inchangé');
});

test('une haie parallèle posée dans l’emprise disparaît entièrement', () => {
  const index = corridorIndex(2.5);
  const inside = [];
  for (let x = -50; x <= 50; x += 6) inside.push({ x, z: 1 });
  assert.equal(clipOutsideCorridor(inside, index).length, 0);
});

test('une clôture enjambe un sentier étroit sans que la découpe le rate', () => {
  // Le cas qui condamne un test « sommet par sommet » : le contour est
  // ré-échantillonné tous les six mètres, le sentier fait 1,4 m de large, donc
  // aucun sommet ne tombe dedans. Seul un sondage plus fin le voit.
  const path = corridorIndex(0.7);
  // Décalé exprès : les sommets tombent à ±3 m, hors de l'emprise de 1,9 m.
  const fence = crossing(0, -33, 33, 6);
  assert.ok(
    fence.every((p) => !inCorridor(path, p.x, p.z)),
    'préalable : aucun sommet ne tombe dans l’emprise'
  );
  assert.equal(clipOutsideCorridor(fence, path).length, 2, 'la découpe le voit quand même');
  assert.ok(CORRIDOR_PROBE_M < 0.7 * 2, 'le pas de sondage tient dans la plus étroite emprise');
});

test('deux routes proches découpent la même haie en trois', () => {
  const north = [];
  const south = [];
  for (let x = -200; x <= 200; x += 10) {
    south.push({ x, z: 0 });
    north.push({ x, z: 20 });
  }
  const index = new RoadIndex(
    [fakeSegment(south, 2.5, 10), fakeSegment(north, 2.5, 10)],
    { margin: ROAD_CUT_M + ROAD_CUT_BLEND_M }
  );

  const runs = clipOutsideCorridor(crossing(0, -20, 40, 6), index);
  assert.equal(runs.length, 3, 'avant, entre, après');
  assert.ok(
    runs.every((run) => run.every((p) => !inCorridor(index, p.x, p.z))),
    'aucun tronçon ne mord sur l’une ou l’autre'
  );
});

test('chaque tronçon découpé repart d’une distance nulle', () => {
  // `spacedAlongPath` et `appendRibbon` comptent depuis le premier sommet du
  // tracé qu'on leur donne : un tronçon qui garderait les distances d'origine
  // décalerait tous ses piquets.
  const runs = clipOutsideCorridor(crossing(), corridorIndex(2.5));
  for (const run of runs) {
    close(run[0].distance, 0, 1e-9, 'origine à zéro');
    for (let i = 1; i < run.length; i++) {
      assert.ok(run[i].distance > run[i - 1].distance, 'distances croissantes');
      close(
        run[i].distance - run[i - 1].distance,
        Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z),
        1e-6,
        'distance cumulée cohérente'
      );
    }
  }
});

test('un tronçon trop court pour valoir une haie est écarté', () => {
  const index = corridorIndex(2.5);
  // Deux bouts de treize mètres de part et d'autre de la route.
  const short = crossing(0, -17, 17, 3.4);
  assert.equal(clipOutsideCorridor(short, index).length, 2, 'sans plancher, les deux passent');
  assert.equal(
    clipOutsideCorridor(short, index, undefined, { minLength: 30 }).length,
    0,
    'avec un plancher de trente mètres, aucun'
  );
});

test('le décalage latéral sonde l’emprise là où l’objet sera posé', () => {
  // Une haie de bas-côté longe la route à quatre mètres de son axe : elle est
  // hors emprise, alors que l'axe qui la porte est en plein dedans.
  const index = corridorIndex(2.5);
  const along = [];
  for (let x = -50; x <= 50; x += 6) along.push({ x, z: 0 });

  assert.equal(clipOutsideCorridor(along, index, undefined, { offset: 0 }).length, 0, 'sur l’axe');
  assert.equal(clipOutsideCorridor(along, index, undefined, { offset: 4 }).length, 1, 'à côté');
  assert.equal(clipOutsideCorridor(along, index, undefined, { offset: -4 }).length, 1, 'de l’autre côté');
});

test('une polyligne dégénérée ne produit aucun tronçon', () => {
  const index = corridorIndex(2.5);
  assert.deepEqual(clipOutsideCorridor([], index), []);
  assert.deepEqual(clipOutsideCorridor([{ x: 0, z: 40 }], index), []);
  assert.deepEqual(clipOutsideCorridor(null, index), []);
});

test('la découpe est déterministe : deux appels rendent exactement la même chose', () => {
  // C'est l'invariant que tout le décor engendré repose dessus : la même donnée
  // doit rendre le même paysage, sinon les haies clignotent tous les 250 m.
  const index = corridorIndex(2.5);
  const first = clipOutsideCorridor(crossing(), index);
  const second = clipOutsideCorridor(crossing(), index);
  assert.deepEqual(first, second);
});

test('le semis par points ne perd que ce qui tombe sur la voirie', () => {
  const index = corridorIndex(2.5);
  const bales = [
    { x: -20, z: -10 },
    { x: 0, z: 0 }, // en plein milieu de la chaussée
    { x: 10, z: 2 }, // sur l'accotement excavé
    { x: 30, z: 12 },
  ];
  const kept = filterOutsideCorridor(bales, index);
  assert.equal(kept.length, 2, 'deux bottes retirées');
  // L'ordre et les valeurs sont conservés : on retire, on ne recompose pas.
  assert.deepEqual(kept, [bales[0], bales[3]]);
  assert.deepEqual(filterOutsideCorridor(bales, null), bales, 'sans réseau, rien ne bouge');
});

test('une maison à cheval sur la route est rabotée, pas rejetée', () => {
  // Le tracé de la voie et le contour du bâti viennent de deux relevés
  // différents : la donnée pose parfois une maison sur la chaussée. Rejeter le
  // bâtiment ferait un trou dans un village pour quelques dizaines de
  // centimètres d'écart ; le laisser met un mur au milieu de la route.
  const index = corridorIndex(2.5); // axe z = 0, rive à 2,5 + 1,2 m
  const rive = 2.5 + CORRIDOR_MARGIN_M + CORRIDOR_PUSH_CLEARANCE_M;

  // Une maison de 10 × 10 dont le tiers sud mord sur la chaussée.
  const maison = [
    { x: 0, z: -2 },
    { x: 10, z: -2 },
    { x: 10, z: 8 },
    { x: 0, z: 8 },
  ];
  const rabotee = clipPolygonOutsideCorridor(maison, index);
  assert.ok(rabotee && rabotee.length >= 3, 'il reste une maison');
  for (const p of rabotee) {
    assert.ok(p.z >= rive - 1e-6, `sommet à z = ${p.z.toFixed(2)}, rive à ${rive.toFixed(2)}`);
    assert.ok(!inCorridor(index, p.x, p.z), 'et aucun sommet dans l’emprise');
  }
  // La coupe est un rabotage, pas une démolition : le nord du bâtiment n'a
  // pas bougé.
  assert.ok(
    rabotee.some((p) => Math.abs(p.z - 8) < 1e-6 && Math.abs(p.x) < 1e-6),
    'le coin nord-ouest est intact'
  );

  // Une maison qui ne touche pas la route ressort telle quelle, à l'identique.
  const loin = maison.map((p) => ({ x: p.x, z: p.z + 40 }));
  assert.deepEqual(clipPolygonOutsideCorridor(loin, index), loin);

  // Une maison entièrement posée sur la chaussée n'est pas bâtie : il n'en
  // reste rien d'habitable, et la garder mettrait une façade sur la voie.
  const dessus = [
    { x: 20, z: -1.5 },
    { x: 26, z: -1.5 },
    { x: 26, z: 1.5 },
    { x: 20, z: 1.5 },
  ];
  assert.equal(clipPolygonOutsideCorridor(dessus, index), null);

  // Sans réseau, on ne devine pas de route : rien n'est raboté.
  assert.deepEqual(clipPolygonOutsideCorridor(maison, null), maison);
});

test('un abribus posé sur la chaussée en sort, avec de quoi loger son dos', () => {
  // La donnée porte très souvent l'arrêt de bus sur le tracé de la route
  // lui-même (`stop_position`), et l'abribus se posait alors au milieu du
  // bitume. Le retirer ferait disparaître un objet qui existe : on l'écarte.
  const index = corridorIndex(2.5);
  const edge = 2.5 + CORRIDOR_MARGIN_M;
  const margin = CORRIDOR_MARGIN_M + POI_CLEARANCE_M;

  for (const depart of [{ x: 0, z: 0 }, { x: 12, z: 1.4 }, { x: -30, z: -2 }]) {
    const at = pushPointOutsideCorridor(depart.x, depart.z, index, margin);
    assert.ok(!inCorridor(index, at.x, at.z), `(${depart.x}, ${depart.z}) sort de l’emprise`);
    // Et pas de justesse : le centre est écarté d'assez pour que l'abri entier
    // tienne hors de la chaussée.
    assert.ok(
      Math.abs(at.z) >= edge + POI_CLEARANCE_M - 1e-6,
      `(${depart.x}, ${depart.z}) : centre à ${at.z.toFixed(2)} pour un bord à ${edge.toFixed(2)}`
    );
  }

  // Un arrêt déjà au bord de la route n'est pas déplacé pour rien.
  const loin = pushPointOutsideCorridor(0, 20, index, margin);
  assert.deepEqual(loin, { x: 0, z: 20 });

  // Sans réseau, aucune raison de bouger quoi que ce soit.
  assert.deepEqual(pushPointOutsideCorridor(0, 0, null, margin), { x: 0, z: 0 });
});

test('un contour de parcelle qui longe la route est repoussé au bord, pas supprimé', () => {
  // Le cas que la découpe rate structurellement : la limite ne sort jamais de
  // l'emprise, donc `clipOutsideCorridor` n'a aucun point de reprise et efface
  // toute la haie (voir le test « disparaît entièrement » plus haut). C'est
  // précisément ce que `pushOutsideCorridor` ne fait pas.
  const index = corridorIndex(2.5);
  const along = [];
  for (let x = -50; x <= 50; x += 6) along.push({ x, z: 3 }); // dans l'emprise (2.5 + 1.2 = 3.7)

  const pushed = pushOutsideCorridor(along, index);
  assert.equal(pushed.length, along.length, 'aucun point perdu');
  assert.ok(
    pushed.every((p) => !inCorridor(index, p.x, p.z)),
    'tous les points ressortent hors emprise'
  );
  assert.ok(pushed.every((p) => p.z > 3), 'repoussés vers l’extérieur, pas vers la chaussée');
  const edge = 2.5 + CORRIDOR_MARGIN_M + CORRIDOR_PUSH_CLEARANCE_M;
  for (const p of pushed) close(p.z, edge, 1e-6, 'posés juste au bord, pas loin dans le champ');
});

test('un contour déjà hors emprise n’est pas touché par le rejet', () => {
  const index = corridorIndex(2.5);
  const outside = [];
  for (let x = -50; x <= 50; x += 6) outside.push({ x, z: 6 });

  const pushed = pushOutsideCorridor(outside, index);
  for (let i = 0; i < outside.length; i++) {
    close(pushed[i].x, outside[i].x, 1e-9, 'x inchangé');
    close(pushed[i].z, outside[i].z, 1e-9, 'z inchangé');
  }
});

test('un contour qui traverse vraiment la route reste continu, il ne se coupe plus', () => {
  // Contrairement à `clipOutsideCorridor`, le rejet ne casse jamais la ligne :
  // une limite qui coupe la chaussée en travers en ressort longée, pas coupée
  // en deux tronçons.
  const index = corridorIndex(2.5);
  const pushed = pushOutsideCorridor(crossing(), index);
  assert.equal(pushed.length, crossing().length, 'toujours un seul tronçon, aucun sommet perdu');
  assert.ok(
    pushed.every((p) => !inCorridor(index, p.x, p.z)),
    'tous hors emprise'
  );
});

test('un carrefour de deux routes ne laisse aucun point coincé entre les deux emprises', () => {
  const south = [];
  const east = [];
  for (let x = -100; x <= 100; x += 10) south.push({ x, z: 0 });
  for (let z = -100; z <= 100; z += 10) east.push({ x: 0, z });
  const index = new RoadIndex([fakeSegment(south, 2.5, 10), fakeSegment(east, 2.5, 10)], {
    margin: ROAD_CUT_M + ROAD_CUT_BLEND_M,
  });

  // Un cercle serré autour du carrefour : plusieurs points y sont à portée des
  // deux chaussées à la fois.
  const ring = [];
  for (let a = 0; a < 360; a += 10) {
    const r = 4;
    ring.push({ x: Math.cos((a * Math.PI) / 180) * r, z: Math.sin((a * Math.PI) / 180) * r });
  }
  const pushed = pushOutsideCorridor(ring, index);
  assert.ok(
    pushed.every((p) => !inCorridor(index, p.x, p.z)),
    'aucun point ne reste dans l’une ou l’autre emprise après plusieurs passes'
  );
});

test('deux chaussées qui se rejoignent en Y ne laissent pas la haie sur le bitume', () => {
  // Le cas que le refoulement seul ne sait pas traiter : les deux emprises se
  // recouvrent, il n'existe aucune position libre entre elles, et le point
  // ressort donc **tel quel** — c'est-à-dire sur la chaussée.
  const straight = [];
  for (let x = -200; x <= 200; x += 10) straight.push({ x, z: 0 });
  const arm = [];
  for (let x = -200; x <= 0; x += 10) arm.push({ x, z: -x * 0.06 });
  const index = new RoadIndex([fakeSegment(straight, 3, 10), fakeSegment(arm, 3, 10)]);

  // Un contour de parcelle qui court dans la gorge du Y, à mi-distance.
  const ring = [];
  for (let x = -200; x <= 0; x += 6) ring.push({ x, z: (-x * 0.06) / 2 });

  const pushed = pushOutsideCorridor(ring, index);
  assert.ok(
    pushed.some((p) => inCorridor(index, p.x, p.z, 0)),
    'le refoulement seul laisse des points sur la chaussée : c’est le défaut à couvrir'
  );

  // La découpe retire ces tronçons-là, et seulement eux : le reste du contour,
  // qui court en terrain libre, doit survivre.
  const runs = clipOutsideCorridor(pushed, index, 0, { minLength: 30 });
  assert.ok(runs.length > 0, 'le contour n’est pas effacé en entier');
  for (const run of runs) {
    for (const p of run) {
      const hit = index.query(p.x, p.z, 0);
      // Les points de traversée tombent pile sur la rive : c'est leur
      // définition, et un dixième de millimètre n'est pas un empiètement.
      const depth = hit ? hit.segment.halfWidth - hit.distance : 0;
      assert.ok(depth < 0.01, `plus rien sur la chaussée (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
  }

  const kept = runs.reduce((m, run) => m + run[run.length - 1].distance, 0);
  assert.ok(kept > 100, `le bocage garde ses tronçons libres (${kept.toFixed(0)} m)`);
});

test('le rejet est déterministe et n’a pas besoin de réseau', () => {
  const index = corridorIndex(2.5);
  const along = [];
  for (let x = -50; x <= 50; x += 6) along.push({ x, z: 1 });

  assert.deepEqual(pushOutsideCorridor(along, index), pushOutsideCorridor(along, index));
  assert.equal(pushOutsideCorridor(along, null), along, 'sans réseau, la référence ressort telle quelle');
  assert.deepEqual(pushOutsideCorridor(null, index), []);
});

// --- Jardins : la clôture tient entre la maison et la rue, ou il n'y a pas de jardin

/** Maison de six mètres sur quatre, alignée sur les axes. */
const houseBox = (cx, cz) => ({ cx, cz, angle: 0, long: 6, short: 4 });

/** Une route droite du nord au sud, axe x = 0 — elle coupe les côtés est-ouest. */
function northSouthIndex(halfWidth = 2.5) {
  const points = [];
  for (let z = -200; z <= 200; z += 10) points.push({ x: 0, z });
  return new RoadIndex([fakeSegment(points, halfWidth, 10)], {
    margin: ROAD_CUT_M + ROAD_CUT_BLEND_M,
  });
}

test('une clôture de jardin qui coupe la rue en son milieu est détectée', () => {
  // Le piège du test « quatre angles » : une rue peut traverser un côté sans
  // toucher aucun angle.
  // La route file du nord au sud en plein milieu de la maison : elle traverse
  // les côtés nord et sud de la clôture, loin de leurs angles.
  const index = northSouthIndex(2.5);
  const box = houseBox(0, 0);
  const clear = (x, z) => !inCorridor(index, x, z);

  const corners = gardenCorners(box, 6.5);
  assert.ok(corners.every((c) => clear(c.x, c.z)), 'préalable : les angles sont au large');
  assert.equal(gardenOutlineClear(box, 6.5, clear), false, 'les côtés, eux, mordent sur la route');
});

test('le jardin se resserre plutôt que de disparaître, puis renonce', () => {
  const index = corridorIndex(2.5);
  const clear = (x, z) => !inCorridor(index, x, z);

  // Maison au large : le recul tiré passe tel quel.
  const roomy = fittedGardenMargin(houseBox(0, -40), 6.5, clear);
  close(roomy, 6.5, 1e-9, 'rien à resserrer');

  // Maison proche de la route : le recul généreux ne passe pas, un plus serré si.
  const tight = houseBox(0, -14);
  assert.equal(gardenOutlineClear(tight, 6.5, clear), false, 'préalable : 6,5 m ne tient pas');
  const fitted = fittedGardenMargin(tight, 6.5, clear);
  assert.ok(fitted !== null && fitted < 6.5, 'un recul plus serré a été trouvé');
  assert.ok(fitted >= GARDEN_MARGIN_M[0], 'jamais en deçà du minimum de la fourchette');
  assert.ok(gardenOutlineClear(tight, fitted, clear), 'et il tient vraiment');

  // Maison collée à la chaussée : même le minimum mord, donc pas de jardin.
  assert.equal(fittedGardenMargin(houseBox(0, -5), 6.5, clear), null, 'aucun recul ne tient');
});

test('sans emprise à respecter, le jardin garde le recul tiré', () => {
  close(fittedGardenMargin(houseBox(0, 0), 5.1, () => true), 5.1, 1e-9);
});

test('ce qui borde une route l’ignore, et s’arrête aux rues transversales', () => {
  // Les décalages du bas-côté (fossé à 1,5 m de la rive, haie à 1,8 m) tombent
  // aujourd'hui juste au-delà de l'accotement, donc hors de leur propre
  // emprise. C'est une marge de trente centimètres, et personne ne l'a écrite
  // nulle part : le prédicat dit la règle au lieu de compter dessus. On le
  // vérifie donc sur un décalage volontairement plus serré — celui qu'aurait
  // une bordure de trottoir.
  const along = [];
  for (let x = -100; x <= 100; x += 10) along.push({ x, z: 0 });
  const own = fakeSegment(along, 2.5, 10);

  const cross = [];
  for (let z = -100; z <= 100; z += 10) cross.push({ x: 0, z });
  const other = fakeSegment(cross, 2.5, 10);

  const index = new RoadIndex([own, other], { margin: ROAD_CUT_M + ROAD_CUT_BLEND_M });
  const ignoreOwn = (segment) => segment !== own;

  const hugging = 2.5 + 0.6; // au ras de la rive : dans sa propre emprise

  // Sans le prédicat, l'ouvrage s'efface lui-même sur toute sa longueur.
  assert.equal(
    clipOutsideCorridor(along, index, undefined, { offset: hugging }).length,
    0,
    'la route porteuse est comptée : il ne reste rien'
  );

  const runs = clipOutsideCorridor(along, index, undefined, {
    offset: hugging,
    accept: ignoreOwn,
  });
  assert.equal(runs.length, 2, 'il survit, coupé par la seule rue transversale');
  assert.ok(
    runs.every((run) => run.every((p) => !inCorridor(index, p.x, p.z, undefined, ignoreOwn))),
    'et aucun tronçon ne traverse la rue'
  );
});

test('un point posé au bord de sa propre route reste, un point sur une autre part', () => {
  const along = [];
  for (let x = -100; x <= 100; x += 10) along.push({ x, z: 0 });
  const own = fakeSegment(along, 2.5, 10);
  const index = new RoadIndex([own], { margin: ROAD_CUT_M + ROAD_CUT_BLEND_M });
  const ignoreOwn = (segment) => segment !== own;

  // Une glissière au ras de la rive : dans l'emprise, et c'est sa place.
  assert.ok(inCorridor(index, 0, 3), 'sans prédicat, le point est sur la voirie');
  assert.ok(!inCorridor(index, 0, 3, undefined, ignoreOwn), 'avec, sa route ne le gêne plus');
});

test('l’écart rapide de l’index ne se trompe que dans le sens sûr', () => {
  // `mayCover` sert à écarter d'un coup un tronçon de haie loin de toute route.
  // Il a le droit de dire « peut-être » là où rien ne couvre ; il n'a jamais le
  // droit de dire « non » là où quelque chose couvre — sinon une haie
  // traverserait la chaussée sans qu'on l'ait seulement sondée.
  const index = corridorIndex(2.5);

  assert.ok(index.mayCover(-5, -5, 5, 5), 'la boîte contient la route');
  assert.ok(!index.mayCover(-5, 400, 5, 410), 'très loin, rien à sonder');

  // L'invariant, vérifié point par point sur une grille qui coupe la route.
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -30; z <= 30; z += 1.5) {
      if (!inCorridor(index, x, z)) continue;
      assert.ok(
        index.mayCover(x, z, x, z),
        `un point couvert doit toujours être annoncé (${x}, ${z})`
      );
    }
  }
});

test('un réseau dit jusqu’où il sait, ce qui n’est pas dire ce qu’il contient', () => {
  // Hors du disque construit, un index ne répond pas « pas de route » : il ne
  // répond rien. Sans cette mesure, une tuile semée à 1 400 m plantait des
  // arbres sur une chaussée qu’elle ne pouvait pas voir, et ne les enlevait jamais.
  const here = { x: 0, z: 0 };
  assert.equal(knownCoverage(-10, -10, 10, 10, here, 900), 1, 'sous le nez, tout est su');
  assert.equal(knownCoverage(2000, 2000, 2100, 2100, here, 900), 0, 'au loin, rien');
  assert.equal(knownCoverage(-10, -10, 10, 10, null, 900), 0, 'sans point de construction, rien');

  // À cheval sur le bord, la mesure est partielle et croît quand on approche.
  const loin = knownCoverage(800, -100, 1200, 300, here, 900);
  const proche = knownCoverage(800, -100, 1200, 300, { x: 400, z: 100 }, 900);
  assert.ok(loin > 0 && loin < 1, `part connue au bord : ${loin}`);
  assert.ok(proche > loin, `approcher fait savoir davantage : ${proche} > ${loin}`);

  // Et elle est monotone : s’approcher n’a jamais fait oublier une route.
  let previous = 0;
  for (let x = -400; x <= 900; x += 100) {
    const seen = knownCoverage(800, -100, 1200, 300, { x, z: 100 }, 900);
    assert.ok(seen >= previous - 1e-9, `recul de connaissance à x=${x}`);
    previous = seen;
  }
});

// --- La voirie urbaine -------------------------------------------------------

test('un quartier d’habitation porte de l’herbe, une zone d’activité non', () => {
  // `residential` décrit un périmètre, pas un revêtement : pelouses tondues et
  // allées. C'était un remplissage **partiel** — deux tiers d'herbe peints dans
  // un canal de poids, la seule matière qui le fût. C'est maintenant une
  // matière comme les autres, et la part d'herbe n'est plus dans la carte mais
  // dans la strate basse, qui est la seule à en avoir besoin.
  assert.ok(SURFACE_KINDS.includes('settled'), 'le lotissement est une matière');
  assert.ok(SETTLED_GRASS > 0.5 && SETTLED_GRASS < 1, 'majoritairement vert, jamais un pré');

  // Sa couleur est la moyenne exacte que le mélange rendait : la fusion ne
  // devait pas déplacer une valeur artistique au passage.
  const { grass, bare, settled } = defaultTheme.surfaces;
  for (let i = 0; i < 3; i++) {
    const expected = grass.albedo[i] * SETTLED_GRASS + bare.albedo[i] * (1 - SETTLED_GRASS);
    assert.ok(
      Math.abs(settled.albedo[i] - expected) < 0.002,
      `canal ${i} : ${settled.albedo[i]} pour ${expected} attendu`
    );
  }
});

test('un périmètre habité ne suffit pas à faire une rue', () => {
  const slope = 0;

  // Les trois conditions, une par une. Aucune ne se rattrape.
  assert.equal(kerbQualifies({ builtUp: true, buildings: STREET_FABRIC_MIN, crossSlope: slope }), true);
  assert.equal(
    kerbQualifies({ builtUp: false, buildings: 12, crossSlope: slope }),
    false,
    'hors agglomération, pas de trottoir même sous les maisons'
  );
  assert.equal(
    kerbQualifies({ builtUp: true, buildings: STREET_FABRIC_MIN - 1, crossSlope: slope }),
    false,
    'un périmètre résidentiel sans maisons est un pré, pas une rue'
  );
  assert.equal(
    kerbQualifies({ builtUp: true, buildings: 8, crossSlope: STREET_MAX_CROSS_SLOPE + 0.01 }),
    false,
    'sur un devers, la rive appelle un mur, pas une bordure'
  );
  // Le devers est jugé en valeur absolue : la rive amont vaut la rive aval.
  assert.equal(kerbQualifies({ builtUp: true, buildings: 8, crossSlope: -0.02 }), true);
});

test('seules les chaussées qui desservent des maisons peuvent être bordées', () => {
  for (const profile of ['major', 'minor', 'lane']) {
    assert.ok(STREET_PROFILES.has(profile), `${profile} peut porter un trottoir`);
  }
  for (const profile of ['express', 'track', 'path', 'cycleway']) {
    assert.ok(!STREET_PROFILES.has(profile), `${profile} n’en porte pas`);
  }
});

test('l’index du bâti compte ce qui est là, et s’arrête au plafond', () => {
  const fabric = new FabricIndex([
    { x: 0, z: 0 },
    { x: 10, z: 5 },
    { x: 20, z: 0 },
    { x: 400, z: 400 },
  ]);
  assert.equal(fabric.count, 4);
  assert.equal(fabric.countWithin(0, 0, 25), 3, 'trois maisons dans le disque');
  assert.equal(fabric.countWithin(0, 0, 25, 2), 2, 'le plafond arrête le comptage');
  assert.equal(fabric.countWithin(0, 0, 5), 1, 'seulement celle qui est dessous');
  assert.equal(fabric.countWithin(-2000, 0, 30), 0, 'ailleurs, rien');

  // Une liste vide répond zéro partout, ce qui est la bonne réponse.
  assert.equal(new FabricIndex([]).countWithin(0, 0, 500), 0);
  assert.equal(new FabricIndex().count, 0);
});

test('le côté examiné change la réponse, pas le découpage', () => {
  // Un front bâti au nord d’une rue est-ouest : le disque posé au nord compte
  // des maisons, celui posé au sud n’en compte aucune.
  const fabric = new FabricIndex([
    { x: -10, z: -18 },
    { x: 0, z: -20 },
    { x: 12, z: -19 },
  ]);
  const north = fabric.countWithin(0, -18, STREET_FABRIC_RADIUS_M, STREET_FABRIC_MIN);
  const south = fabric.countWithin(0, 18, STREET_FABRIC_RADIUS_M, STREET_FABRIC_MIN);
  assert.ok(north >= STREET_FABRIC_MIN, 'le côté bâti est bordé');
  assert.equal(south, 0, 'le côté sur champs ne l’est pas');
  assert.equal(kerbQualifies({ builtUp: true, buildings: south }), false);
});

// --- Cour de ferme : un indice indirect, faute de landuse=farmyard servi ---
//
// `landuse=farmyard` n'atteint pas les tuiles OpenFreeMap (vérifié contre une
// vraie ferme d'OSM — voir le commentaire de `FARMSTEAD_MAX_HECTARES`).
// `_looksLikeFarmstead` s'appuie donc sur `FabricIndex` : une petite parcelle
// agricole ou une pâture, avec une vraie grappe de bâtiments à portée.

/** Carré de `side` mètres de côté, coin sud-ouest à l'origine. */
function squareRing(side) {
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

/** Instance minimale de `FurnitureLayer`, juste assez pour `_looksLikeFarmstead`. */
function farmsteadHarness(fabric) {
  const layer = Object.create(FurnitureLayer.prototype);
  layer._fabric = fabric;
  return layer;
}

test('_looksLikeFarmstead réclame une vraie grappe de bâtiments, pas un pavillon isolé', () => {
  const centre = { x: 50, z: 50 };
  const ring = squareRing(100); // 1 ha : sous FARMSTEAD_MAX_HECTARES

  const lone = new FabricIndex([{ x: 50, z: 55 }]);
  assert.equal(
    farmsteadHarness(lone)._looksLikeFarmstead({ class: 'farmland' }, ring, centre),
    false,
    'une seule maison ne fait pas une ferme'
  );

  const cluster = new FabricIndex([
    { x: 50, z: 55 },
    { x: 60, z: 45 },
  ]);
  assert.equal(
    farmsteadHarness(cluster)._looksLikeFarmstead({ class: 'farmland' }, ring, centre),
    true,
    'deux bâtiments groupés en font une'
  );
});

test('_looksLikeFarmstead : pâture oui, jardin ou parc non', () => {
  const centre = { x: 50, z: 50 };
  const ring = squareRing(100);
  const cluster = new FabricIndex([
    { x: 50, z: 55 },
    { x: 60, z: 45 },
  ]);
  const layer = farmsteadHarness(cluster);

  assert.equal(layer._looksLikeFarmstead({ class: 'farmland' }, ring, centre), true);
  assert.equal(layer._looksLikeFarmstead({ class: 'grass', subclass: 'meadow' }, ring, centre), true);
  assert.equal(layer._looksLikeFarmstead({ class: 'grass', subclass: 'grassland' }, ring, centre), true);
  // Une pelouse d'agrément n'est pas une terre agricole, même à côté de maisons.
  assert.equal(layer._looksLikeFarmstead({ class: 'grass', subclass: 'garden' }, ring, centre), false);
  assert.equal(layer._looksLikeFarmstead({ class: 'grass', subclass: 'park' }, ring, centre), false);
  assert.equal(layer._looksLikeFarmstead({ class: 'wood' }, ring, centre), false);
});

test('_looksLikeFarmstead écarte le grand champ ouvert et exige FabricIndex', () => {
  const cluster = new FabricIndex([
    { x: 50, z: 55 },
    { x: 60, z: 45 },
  ]);
  // Un openfield de cinquante hectares : le centroïde n'a plus de raison
  // d'être près d'un bâtiment, même si `FabricIndex` en trouve un par hasard.
  const bigRing = squareRing(1000); // 100 ha
  assert.equal(
    farmsteadHarness(cluster)._looksLikeFarmstead({ class: 'farmland' }, bigRing, { x: 500, z: 500 }),
    false
  );

  const smallRing = squareRing(100);
  assert.equal(
    farmsteadHarness(null)._looksLikeFarmstead({ class: 'farmland' }, smallRing, { x: 50, z: 50 }),
    false,
    'sans FabricIndex, le repli est de ne rien poser'
  );
});

test('les seuils de détection restent ceux documentés', () => {
  assert.equal(FARMSTEAD_MAX_HECTARES, 3);
  assert.equal(FARMSTEAD_CLUSTER_RADIUS_M, 80);
  assert.equal(FARMSTEAD_CLUSTER_MIN_BUILDINGS, 2);
});

// --- Serres : un rang, dans le sens de la ferme, long de la parcelle -------

test('_greenhouseLengthFor mesure la parcelle dans le sens de la ferme, et la borne', () => {
  // Rectangle 20 m (largeur) × 40 m (longueur), aligné sur les axes du monde.
  const ring = [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 40 },
    { x: 0, z: 40 },
  ];
  const centre = { x: 10, z: 20 };

  // yaw = π/2 : direction (cos, sin) = (0, 1), l'axe z — la longueur.
  close(FurnitureLayer._greenhouseLengthFor(ring, centre, Math.PI / 2), 40, 1e-6);
  // yaw = 0 : direction (1, 0), l'axe x — la largeur.
  close(FurnitureLayer._greenhouseLengthFor(ring, centre, 0), 20, 1e-6);

  // Bornée en dessous : une parcelle minuscule ne redescend pas sous le
  // gabarit minimal.
  const tiny = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 0, z: 1 },
  ];
  assert.equal(FurnitureLayer._greenhouseLengthFor(tiny, { x: 0.5, z: 0.5 }, 0), GREENHOUSE_MIN_LENGTH_M);

  // Bornée au-dessus : un openfield ne dépasse pas le gabarit maximal.
  const huge = squareRing(500);
  assert.equal(FurnitureLayer._greenhouseLengthFor(huge, { x: 250, z: 250 }, 0), GREENHOUSE_MAX_LENGTH_M);
});

/** Instance de `FurnitureLayer` juste assez armée pour poser du mobilier ponctuel. */
function farmsteadPlacementHarness() {
  const layer = Object.create(FurnitureLayer.prototype);
  layer.bubble = { surfaceElevationAtLocal: () => 100, verticalScale: 1 };
  layer.chimneys = [];
  // Les poules de la cour ne sont plus du mobilier : elles partent dans
  // `fauna`, que la couche publie pour `faunaLayer`.
  layer.fauna = [];
  layer._coats = defaultTheme.fauna.coats;
  const placements = new Map();
  for (const item of POINT_ITEMS) placements.set(item, []);
  return { layer, placements };
}

test('_place propage scaleX/scaleZ, et retombe sur scale sans eux', () => {
  const { layer, placements } = farmsteadPlacementHarness();

  const stretched = layer._place(placements, 'greenhouse', { x: 0, z: 0, scaleZ: 2.5 });
  assert.equal(stretched.scaleZ, 2.5);
  assert.equal(stretched.scaleX, undefined, 'non fourni, scaleX ne se fabrique pas tout seul');

  const plain = layer._place(placements, 'barn', { x: 0, z: 0 });
  assert.equal(plain.scaleX, undefined);
  assert.equal(plain.scaleZ, undefined);
  assert.equal(plain.scale, 1);
});

test('_placeFarmstead aligne plusieurs serres, longues de la parcelle plutôt que du modèle', () => {
  const { layer, placements } = farmsteadPlacementHarness();

  // Un losange plutôt qu'un carré aligné sur les axes : la longueur mesurée
  // ne doit rien à une coïncidence entre le tirage de `yaw` et l'orientation
  // du test.
  const centre = { x: 1000, z: 2000 };
  const ring = [
    { x: centre.x, z: centre.z - 60 },
    { x: centre.x + 60, z: centre.z },
    { x: centre.x, z: centre.z + 60 },
    { x: centre.x - 60, z: centre.z },
  ];

  layer._placeFarmstead(placements, ring, centre);

  const greenhouses = placements.get('greenhouse');
  assert.ok([2, 3].includes(greenhouses.length), 'un rang de deux ou trois tunnels');

  // Un seul tirage de longueur par ferme : toutes les serres du rang partagent
  // la même échelle.
  const scaleZs = new Set(greenhouses.map((g) => g.scaleZ));
  assert.equal(scaleZs.size, 1, 'un seul tirage de longueur par ferme');
  const length = greenhouses[0].scaleZ * GREENHOUSE_BASE_LENGTH_M;
  // Le losange choisi mesure entre ~85 m et 120 m selon l'axe projeté, quel
  // que soit le tirage de `yaw` : toujours au-delà du plafond, donc la
  // longueur retenue est déterministe.
  assert.equal(length, GREENHOUSE_MAX_LENGTH_M, 'plus longues que le modèle de catalogue (14 m), et plafonnées');

  // Alignées : écartées d'une distance régulière, côte à côte.
  for (let i = 1; i < greenhouses.length; i++) {
    const d = Math.hypot(greenhouses[i].x - greenhouses[i - 1].x, greenhouses[i].z - greenhouses[i - 1].z);
    close(d, GREENHOUSE_SPACING_M, 1e-6, 'écart régulier entre deux tunnels voisins');
  }
});


test('les bêtes quittent le mobilier : elles sont publiées, pas instanciées', () => {
  // Le mobilier ne les porte plus, ni dans son catalogue ni dans ses
  // instances. Un reste dans `POINT_ITEMS` ferait un maillage vide qui
  // n'aurait plus de géométrie.
  for (const kind of FAUNA_KINDS) {
    assert.ok(!POINT_ITEMS.includes(kind), `${kind} n'est plus une forme de mobilier`);
    assert.ok(!FURNITURE_BUILDERS[kind], `${kind} n'est plus au catalogue du mobilier`);
  }
});

test('_placeFauna publie une bête complète, prête à être jouée', () => {
  const { layer, placements } = farmsteadPlacementHarness();

  assert.equal(layer._placeFauna('cow', { x: 120, z: -80, scale: 1.05 }), 1);
  assert.equal(layer.fauna.length, 1);

  const [animal] = layer.fauna;
  assert.equal(animal.kind, 'cow');
  assert.equal(animal.scale, 1.05);
  assert.ok(animal.circuit.stations.length >= 1, 'un circuit tracé');
  assert.ok(FAUNA_BEHAVIOURS[animal.circuit.behaviour], 'une conduite connue');
  assert.equal(animal.tint.length, 3, 'une robe');
  // Rien n'a été instancié comme mobilier : c'est tout l'objet du découpage.
  for (const list of placements.values()) assert.equal(list.length, 0);

  // Une espèce inconnue ne fait pas tomber la reconstruction du décor.
  assert.equal(layer._placeFauna('licorne', { x: 0, z: 0 }), 0);
  assert.equal(layer.fauna.length, 1);
});

test('le nombre de bêtes posées est plafonné', () => {
  const { layer } = farmsteadPlacementHarness();
  for (let i = 0; i < FURNITURE_LIMITS.fauna + 40; i++) {
    layer._placeFauna('sheep', { x: i * 7.3, z: i * 3.1 });
  }
  assert.equal(layer.fauna.length, FURNITURE_LIMITS.fauna, 'plafonné, pas débordé');
});

test('la cour d’une ferme publie ses poules au lieu de les poser', () => {
  const { layer, placements } = farmsteadPlacementHarness();
  const centre = { x: 400, z: 900 };
  const ring = [
    { x: centre.x - 40, z: centre.z - 40 },
    { x: centre.x + 40, z: centre.z - 40 },
    { x: centre.x + 40, z: centre.z + 40 },
    { x: centre.x - 40, z: centre.z + 40 },
  ];
  layer._placeFarmstead(placements, ring, centre);

  const hens = layer.fauna.filter((a) => a.kind === 'chicken');
  assert.ok(hens.length >= 4, `une basse-cour (${hens.length} poules)`);
  // Elles ne s'éloignent pas du bâtiment : c'était vrai avant, ça doit le
  // rester maintenant qu'elles marchent.
  for (const hen of hens) {
    const spread = Math.hypot(hen.x - centre.x, hen.z - centre.z);
    assert.ok(spread < 16, `poule dans la cour (${spread.toFixed(1)} m)`);
    for (const station of hen.circuit.stations) {
      const reach = Math.hypot(station.x - centre.x, station.z - centre.z);
      assert.ok(reach < 24, `elle ne quitte pas la cour (${reach.toFixed(1)} m)`);
    }
  }
});

test('sans emprise routière connue, personne ne traverse', () => {
  const { layer } = farmsteadPlacementHarness();
  // `_infraIndex` ne vit que le temps d'une reconstruction : hors de là, il
  // n'y a pas de route à traverser, seulement un index absent.
  assert.equal(layer._crossingAt(0, 0), null);
});

test('_crossingAt vise le milieu de la chaussée, pas son bord', () => {
  const { layer } = farmsteadPlacementHarness();
  // Une bande de bitume en travers, à quelques mètres au nord de la bête.
  const roadZ = 9;
  layer._infraIndex = {
    covers: (x, z) => Math.abs(z - roadZ) < 3.5,
  };

  const crossing = layer._crossingAt(0, 0);
  assert.ok(crossing, 'une route à portée');
  // Le centre du trajet tombe dans l'emprise : une traversée qui commence
  // sur le bas-côté opposé n'en est pas une.
  assert.ok(layer._infraIndex.covers(crossing.centre.x, crossing.centre.z), 'le milieu est sur la chaussée');
  // L'axe pointe vers elle, donc franchement vers +Z ici.
  assert.ok(crossing.axis.z > 0.5, 'on traverse vers la route');
  close(Math.hypot(crossing.axis.x, crossing.axis.z), 1, 1e-9, 'axe normalisé');

  // Une route hors de portée ne déclenche rien.
  layer._infraIndex = { covers: (x, z) => Math.abs(z - 400) < 3.5 };
  assert.equal(layer._crossingAt(0, 0), null);
});

test('une emprise habitée se lit par lancer de rayon', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
    { x: 0, z: 100 },
  ];
  assert.equal(pointInAreas([square], 50, 50), true);
  assert.equal(pointInAreas([square], 150, 50), false);
  assert.equal(pointInAreas([], 50, 50), false, 'sans emprise, personne n’est en ville');
  assert.equal(pointInAreas(null, 50, 50), false);
});

test('la voirie ne lit que les anneaux extérieurs', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const hole = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.2]];
  assert.deepEqual(ringsOf({ type: 'Polygon', coordinates: [ring, hole] }), [ring]);
  assert.deepEqual(ringsOf({ type: 'MultiPolygon', coordinates: [[ring, hole], [ring]] }), [ring, ring]);
  assert.deepEqual(ringsOf({ type: 'LineString', coordinates: ring }), []);
  assert.deepEqual(ringsOf(null), []);
  assert.deepEqual(collectBuiltUpAreas(null, [], null), [], 'sans source, aucune emprise');
});

test('la section d’une rue va du caniveau au trottoir, dans cet ordre', () => {
  const streets = defaultTheme.streets;
  const tones = streetSurfaceAt(0, 0, streets);
  const section = kerbProfile({ halfWidth: 2.5, walkWidth: 1.8, side: 1, tones }, streets);

  // Les cotes se comptent depuis la chaussée : le caniveau creuse, la bordure
  // monte, et la jupe arrière s’enterre.
  const ups = section.map((v) => v.up);
  assert.ok(Math.min(...ups) < 0, 'le caniveau est un creux');
  assert.ok(Math.max(...ups) >= streets.kerbHeight, 'la bordure fait sa marche');
  assert.equal(ups[ups.length - 1], -streets.skirtDepth, 'la jupe arrière est enterrée');

  // Le trottoir est **légèrement** surélevé : c’est une marche, pas un quai.
  assert.ok(streets.kerbHeight <= 0.2, 'une bordure de quatorze centimètres');

  // La face de bordure est verticale : deux sommets au même travers.
  const faces = section.filter((v) => Math.abs(v.across - (2.5 + streets.gutterWidth)) < 1e-9);
  assert.equal(faces.length, 2, 'la bordure présente une face franche');

  // De la chaussée vers l’extérieur, sans retour en arrière.
  for (let i = 1; i < section.length; i++) {
    assert.ok(section[i].across >= section[i - 1].across - 1e-9, 'la section ne revient pas sur elle-même');
  }

  // Le côté droit est le miroir du gauche, parcouru dans le même sens de
  // rotation — sinon ses normales sortiraient par-dessous.
  const right = kerbProfile({ halfWidth: 2.5, walkWidth: 1.8, side: -1, tones }, streets);
  assert.equal(right.length, section.length);
  assert.deepEqual(
    right.map((v) => v.across),
    section.map((v) => -v.across).reverse()
  );
});

test('la section d’une rue se balaie le long de la plate-forme', () => {
  const streets = defaultTheme.streets;
  const tones = streetSurfaceAt(0, 0, streets);
  const path = [];
  for (let i = 0; i < 8; i++) path.push({ x: i * 5, z: 0 });
  // Plate-forme en pente douce : le trottoir doit la suivre, pas le terrain.
  const platform = new Float32Array(path.map((_, i) => 100 + i * 0.3));

  const buffer = createProfileBuffer();
  const built = appendProfile(buffer, {
    path,
    profile: kerbProfile({ halfWidth: 2.5, walkWidth: 1.8, side: 1, tones }, streets),
    sampleElevation: () => 0,
    baseHeights: platform,
    lift: 0.14,
    smoothRadius: 0,
  });

  assert.equal(built, true);
  assert.equal(buffer.positions.length / 3, path.length * 7, 'sept sommets par ligne');

  // Le dessus du trottoir de la dernière ligne suit la plate-forme, décollement
  // compris : c’est ce qui rend la bordure solidaire de la chaussée.
  const walkIndex = ((path.length - 1) * 7 + 5) * 3;
  const expected = platform[path.length - 1] + 0.14 + streets.kerbHeight + 0.004 + streets.walkFall;
  assert.ok(Math.abs(buffer.positions[walkIndex + 1] - expected) < 1e-4);
  // Et il est bien au-dessus de la chaussée de la même ligne.
  assert.ok(buffer.positions[walkIndex + 1] > platform[path.length - 1] + 0.14);
});

test('la bande revêtue publiée couvre le caniveau et le trottoir', () => {
  const streets = defaultTheme.streets;
  const band = pavementBand({ halfWidth: 2.5, walkWidth: 1.8, side: 1 }, streets);
  const inner = band.offset - band.halfWidth;
  const outer = band.offset + band.halfWidth;

  assert.ok(Math.abs(inner - 2.5) < 1e-9, 'elle commence à la rive de la chaussée');
  assert.ok(
    Math.abs(outer - (2.5 + streets.gutterWidth + streets.kerbNose + 1.8)) < 1e-9,
    'et finit au fond du trottoir'
  );
  // À droite, la bande est du côté des décalages négatifs.
  assert.ok(pavementBand({ halfWidth: 2.5, walkWidth: 1.8, side: -1 }, streets).offset < 0);
});

test('largeur et revêtement d’une rue sont tirés du lieu', () => {
  const [min, max] = defaultTheme.streets.walkWidth;
  for (const [x, z] of [[0, 0], [123, -456], [-2000, 3000]]) {
    const width = walkWidthAt(x, z);
    assert.ok(width >= min && width <= max, 'la largeur reste dans le gabarit');
    assert.equal(width, walkWidthAt(x, z), 'et ne dépend que du lieu');
  }

  // Le revêtement est celui du **bourg** : deux points de la même maille le
  // partagent, ce qui est ce qui fait qu’une traversée se lit comme un lieu.
  const here = streetSurfaceAt(10, 10);
  assert.equal(streetSurfaceAt(TOWN_PATCH_M * 0.4, TOWN_PATCH_M * 0.3).name, here.name);
  assert.ok(Array.isArray(here.walk) && here.walk.length === 3, 'couleurs linéaires');
  for (const key of ['walk', 'kerb', 'joint', 'gutter']) {
    assert.ok(here[key].every((c) => c >= 0 && c <= 1), `${key} : composantes valides`);
  }

  // Et les quatre revêtements du thème sortent bien tous, sur assez de mailles.
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(streetSurfaceAt(i * TOWN_PATCH_M, 0).name);
  assert.equal(seen.size, defaultTheme.streets.surfaces.length);
});

test('une clôture de jardin ne traverse pas un trottoir', () => {
  const box = { cx: 0, cz: 0, angle: 0, long: 6, short: 5 };
  // Bande revêtue au nord de la maison, à douze mètres du centre. C'est le
  // prédicat de liberté que le jardin interroge — la couche y branche à la fois
  // l'emprise routière et le trottoir.
  const pavement = {
    covers: (x, z) => z < -11 && z > -14 && Math.abs(x) < 40,
  };
  const clear = (x, z) => !pavement.covers(x, z);

  // Sans prédicat, le recul tiré est rendu tel quel.
  assert.equal(fittedGardenMargin(box, 6.5, null), 6.5);

  // Un recul de 6,5 m pousserait la clôture à 11,5 m : elle mord le trottoir,
  // donc elle est rabattue.
  const fitted = fittedGardenMargin(box, 6.5, clear);
  assert.ok(fitted !== null && fitted < 6.5, 'le recul est rabattu');
  for (const corner of gardenCorners(box, fitted)) {
    assert.equal(pavement.covers(corner.x, corner.z), false, 'la clôture tient derrière la bordure');
  }

  // Une maison dont même le recul minimal empiète n’a pas de jardin devant.
  assert.equal(fittedGardenMargin(box, 6.5, () => false), null);
});

test('la place au-delà d’une rive est une largeur, pas un refus', () => {
  // Deux rues parallèles à sept mètres d'axe en axe, larges de cinq : entre
  // les deux il reste deux mètres. C'est le cas d'une venelle qui double une
  // rue, ou des deux branches d'un Y juste avant qu'elles se touchent.
  const north = [];
  const south = [];
  for (let x = -100; x <= 100; x += 10) north.push({ x, z: 0 });
  for (let x = -100; x <= 100; x += 10) south.push({ x, z: 7 });
  const segments = [fakeSegment(north, 2.5, 10), fakeSegment(south, 2.5, 10)];
  const index = new RoadIndex(segments);
  const ignore = (other) => other === segments[0];

  // Sur sa propre rive sud, il reste la distance d'axe à axe moins les deux
  // demi-largeurs : deux mètres.
  const between = edgeClearance(0, 2.5, { roadIndex: index, ignore });
  assert.ok(Math.abs(between - 2) < 1e-6, `deux mètres entre les deux rives, vu ${between}`);

  // Du côté nord, rien en vue : la portée entière.
  assert.equal(edgeClearance(0, -2.5, { roadIndex: index, ignore }), EDGE_REACH_M);

  // Sans l'exception, sa propre chaussée se compterait elle-même et ne
  // laisserait aucune place à sa propre bordure.
  assert.equal(edgeClearance(0, -2.5, { roadIndex: index }), 0);

  // Sans réseau connu, la couche ne devine pas : toute la place est libre.
  assert.equal(edgeClearance(0, 0, {}), EDGE_REACH_M);
});

test('une chaussée d’un autre niveau ne prend pas la place du sol', () => {
  const under = [];
  for (let x = -100; x <= 100; x += 10) under.push({ x, z: 7 });
  const deck = fakeSegment(under, 2.5, 10);
  deck.levels = new Int8Array(deck.path.length).fill(1);
  const index = new RoadIndex([deck]);

  // Au sol, la voie relevée n'occupe rien : c'est la règle du lot A, relue ici.
  assert.equal(edgeClearance(0, 2.5, { roadIndex: index, level: 0 }), EDGE_REACH_M);
  // Au même niveau qu'elle, en revanche, elle borne bien la place.
  assert.ok(edgeClearance(0, 2.5, { roadIndex: index, level: 1 }) < EDGE_REACH_M);
});

test('le mobilier de rive lit la même règle : sa chaussée ne compte pas, celle d’en face si', () => {
  // Un lampadaire est posé à quatre-vingt-dix centimètres de la rive de **sa**
  // chaussée. Le décalage est légitime chez lui ; à un carrefour, ou le long
  // d'une voie qui en double une autre, il tombe sur la chaussée d'en face.
  const own = [];
  const across = [];
  for (let x = -100; x <= 100; x += 10) own.push({ x, z: 0 });
  for (let z = 4; z <= 100; z += 10) across.push({ x: 0, z });
  const segments = [fakeSegment(own, 2.5, 10), fakeSegment(across, 3.5, 10)];
  const index = new RoadIndex(segments);
  const ignore = (other) => other === segments[0];
  const kerb = (x, z) => edgeClearance(x, z, { roadIndex: index, ignore, reach: 0.01 });

  // Au ras de sa propre rive, loin du croisement : sa place.
  assert.ok(kerb(-60, 3.4) > 0, 'la sienne ne se compte pas elle-même');
  // À la même distance de sa rive, mais en travers de l'autre chaussée : refusé.
  assert.equal(kerb(0, 3.4), 0, 'celle d’en face, si');

  // Et dans la dalle d'un carrefour, quelle que soit la chaussée qui la borde.
  const areas = new JunctionAreas([teeJunction()]);
  assert.equal(edgeClearance(0, 0, { areas, ignore, reach: 0.01 }), 0);
});

test('un carrefour prend toute la place, sauf pour ce qui le borde', () => {
  const areas = new JunctionAreas([teeJunction()]);
  assert.equal(areas.length, 1);

  // Le nœud est au milieu de la surface : aucune place pour qui que ce soit.
  assert.equal(edgeClearance(0, 0, { areas }), 0);
  // Sauf pour la bordure du carrefour lui-même, qui n'est pas son propre obstacle.
  assert.equal(edgeClearance(0, 0, { areas, ignoreArea: (i) => i === 0 }), EDGE_REACH_M);
  // Et pas au niveau du dessus : une bretelle qui le survole n'y entre pas.
  assert.equal(edgeClearance(0, 0, { areas, level: 1 }), EDGE_REACH_M);
});

test('le trottoir se rétrécit avant de disparaître', () => {
  const streets = defaultTheme.streets;
  const fixed = streets.gutterWidth + streets.kerbNose + streets.skirtWidth;

  // Large : le lieu obtient ce qu'il voulait.
  assert.equal(walkWidthFor(6, 2, streets), 2);
  // À l'étroit : ce qui reste, et pas plus.
  const tight = walkWidthFor(fixed + 1.5, 2, streets);
  assert.ok(Math.abs(tight - 1.5) < 1e-6, `un mètre cinquante, vu ${tight}`);
  // Trop étroit pour le plus mince trottoir du thème : rien du tout. C'est là
  // que le comblement entre voies prendra le relais, pas un trottoir raboté.
  assert.equal(walkWidthFor(fixed + streets.walkWidth[0] - 0.01, 2, streets), 0);
  assert.equal(walkWidthFor(0, 2, streets), 0);
});

test('une portion de trottoir trop courte est un artefact du découpage', () => {
  // Une longueur, pas un compte de lignes : depuis que les carrefours
  // découpent les rives, un pâté de maisons entre deux croisements proches
  // fait légitimement moins de vingt-cinq mètres.
  assert.ok(STREET_MIN_LENGTH_M >= 10, 'assez long pour être une rue');
  const short = [{ x: 0, z: 0 }, { x: 5, z: 0 }];
  const long = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 40, z: 0 }];
  assert.ok(polylineLength(short) < STREET_MIN_LENGTH_M);
  assert.equal(polylineLength(long), 40);
  assert.equal(polylineLength([{ x: 0, z: 0 }]), 0);
});

test('la bordure d’un coin de rue se pose du côté extérieur', () => {
  const area = junctionArea(teeJunction());
  assert.ok(area.edges.length >= 3, 'un coin par paire de bouches consécutives');

  for (const edge of area.edges) {
    // Le morceau va d'une bouche à la suivante, sans trou : ses deux bouts
    // sont exactement les sommets où les rives de tronçon s'arrêtent.
    assert.ok(edge.points.length >= 2);
    const mid = edge.points[Math.floor(edge.points.length / 2)];
    const outward = edge.outward;
    assert.ok(Math.abs(Math.hypot(outward.x, outward.z) - 1) < 1e-9, 'direction unitaire');
    // Elle pointe bien vers le dehors : le point poussé dans ce sens sort du
    // contour, celui poussé dans l'autre y reste.
    assert.equal(pointInOutline(area.outline, mid.x + outward.x * 0.5, mid.z + outward.z * 0.5), false);
    assert.equal(pointInOutline(area.outline, mid.x - outward.x * 0.2, mid.z - outward.z * 0.2), true);

    const side = outwardSide(edge.points, outward);
    assert.ok(side === 1 || side === -1);
  }
});

// --- Le faisceau : des voies qui vont ensemble ------------------------------

/** Tronçon complet — repères, plate-forme, niveaux — pour interroger un faisceau. */
function fakeRoad(points, halfWidth, deck = 0, profile = 'minor') {
  let distance = 0;
  const path = points.map((p, i) => {
    if (i > 0) distance += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    return { x: p.x, z: p.z, distance };
  });
  return {
    profile,
    halfWidth,
    path,
    frames: pathFrames(path),
    platform: new Float32Array(path.length).fill(deck),
    levels: new Int8Array(path.length),
    startDistance: 0,
  };
}

/** Une droite est-ouest, à l'ordonnée donnée. */
const straightRoad = (z, halfWidth, deck = 0) =>
  fakeRoad(
    Array.from({ length: 41 }, (_, i) => ({ x: -100 + i * 5, z })),
    halfWidth,
    deck
  );

/** Un arc de cercle centré à l'origine, entre deux angles. */
const arcRoad = (radius, from, to, halfWidth, deck = 0) =>
  fakeRoad(
    Array.from({ length: 25 }, (_, i) => {
      const a = from + ((to - from) * i) / 24;
      return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
    }),
    halfWidth,
    deck
  );

test('une rive en face se reconnaît à six conditions, pas à une distance', () => {
  // Deux voies parallèles : axes à sept mètres, rives à deux.
  const north = straightRoad(0, 2.5);
  const south = straightRoad(7, 2.5);
  const index = new RoadIndex([north, south]);

  // La perpendiculaire gauche de la marche vaut (tz, -tx) : la route va vers
  // +x, donc +z est le côté -1.
  const hit = facingEdgeAt(north, 20, -1, { roadIndex: index });
  assert.ok(hit, 'la rive d’en face est trouvée');
  assert.equal(hit.other, south);
  assert.ok(Math.abs(hit.gap - 2) < 1e-6, `deux mètres de vide, vu ${hit.gap}`);
  // Le point d'en face est bien sur *sa* rive, pas sur son axe.
  assert.ok(Math.abs(hit.far.z - 4.5) < 1e-6);
  // Et la direction du vide va de nous vers eux.
  assert.ok(hit.outward.z > 0.99);

  // De l'autre côté, il n'y a rien.
  assert.equal(facingEdgeAt(north, 20, 1, { roadIndex: index }), null);

  // Deux voies qui se coupent passent forcément près l'une de l'autre juste
  // avant de se couper : le parallélisme les écarte.
  const across = fakeRoad(
    Array.from({ length: 21 }, (_, i) => ({ x: 20, z: -50 + i * 5 })),
    2.5
  );
  const crossing = new RoadIndex([north, across]);
  assert.equal(facingEdgeAt(north, 24, -1, { roadIndex: crossing }), null);

  // Superposées, elles ne se longent pas : elles se survolent.
  const above = straightRoad(7, 2.5);
  above.levels = new Int8Array(above.path.length).fill(1);
  assert.equal(facingEdgeAt(north, 20, -1, { roadIndex: new RoadIndex([north, above]) }), null);

  // Sur un ouvrage, il n'y a pas de sol à traiter.
  const carried = straightRoad(0, 2.5);
  carried.works = new Uint8Array(carried.path.length).fill(1);
  assert.equal(facingEdgeAt(carried, 20, -1, { roadIndex: index }), null);
});

test('un vide n’appartient qu’à une rive, et il doit durer', () => {
  const north = straightRoad(0, 2.5);
  const south = straightRoad(7, 2.5);
  const gaps = collectRoadGaps([north, south], { roadIndex: new RoadIndex([north, south]) });

  assert.equal(gaps.length, 1, 'un seul vide, pas un par rive');
  assert.ok(gapLength(gaps[0].pairs) > 150, 'il court sur toute la longueur');
  for (const pair of gaps[0].pairs) {
    assert.ok(Math.abs(pair.gap - 2) < 1e-6);
  }

  // Un frôlement ne fait pas un longement : deux tracés qui se rapprochent
  // puis repartent ne se longent que sur quelques mètres, et cela ne se
  // comble pas.
  const wedge = fakeRoad(
    Array.from({ length: 41 }, (_, i) => ({ x: -100 + i * 5, z: 7 + Math.abs(i - 20) * 1.5 })),
    2.5
  );
  const brief = collectRoadGaps([north, wedge], { roadIndex: new RoadIndex([north, wedge]) });
  assert.equal(brief.length, 0, 'le voisinage est trop court pour être un faisceau');
});

test('une aire close par des chaussées reste le terrain', () => {
  // R1, le cas propre : deux arcs du même cercle. Leurs deux rives
  // intérieures se courbent vers le vide — c'est un îlot, et le centre d'un
  // giratoire n'a pas à être comblé sous prétexte que des routes en font le
  // tour.
  const east = arcRoad(7, -Math.PI / 2, Math.PI / 2, 5);
  const west = arcRoad(7, Math.PI / 2, (3 * Math.PI) / 2, 5);
  const ring = new RoadIndex([east, west]);

  // Les deux se voient : la condition de distance, elle, est remplie.
  const hit = facingEdgeAt(east, 12, 1, { roadIndex: ring }) || facingEdgeAt(east, 12, -1, { roadIndex: ring });
  assert.ok(hit, 'les deux rives intérieures se font bien face');

  // Et pourtant rien n'est comblé.
  assert.equal(collectRoadGaps([east, west], { roadIndex: ring }).length, 0);

  // La règle est bien celle de la courbure, et elle est symétrique : chacune
  // des deux se courbe vers l'autre.
  const inward = { x: -east.path[12].x, z: -east.path[12].z };
  const length = Math.hypot(inward.x, inward.z);
  assert.equal(curvesTowards(east.path, 12, { x: inward.x / length, z: inward.z / length }), true);
  assert.equal(curvesTowards(east.path, 12, { x: -inward.x / length, z: -inward.z / length }), false);
  // Une droite ne se courbe vers rien.
  assert.equal(curvesTowards(straightRoad(0, 2.5).path, 12, { x: 0, z: 1 }), false);
});

test('deux voies parallèles en courbe se longent, elles ne s’enferment pas', () => {
  // Le contre-exemple qui rend la règle utile : deux arcs concentriques. Le
  // centre est du même côté pour les deux, donc l'une est concave vers le
  // vide et l'autre convexe — ce n'est pas un enclos.
  const inner = arcRoad(60, 0, Math.PI / 2, 3);
  const outer = arcRoad(68, 0, Math.PI / 2, 3);
  const gaps = collectRoadGaps([inner, outer], { roadIndex: new RoadIndex([inner, outer]) });
  assert.equal(gaps.length, 1, 'un vide, et il se comble');
});

test('ce que le sol porte déjà n’est pas un vide', () => {
  const north = straightRoad(0, 2.5);
  const south = straightRoad(7, 2.5);
  const index = new RoadIndex([north, south]);

  // Un trottoir qui occupe l'entre-deux : il n'y a plus rien à peindre.
  assert.equal(
    collectRoadGaps([north, south], { roadIndex: index, taken: () => true }).length,
    0
  );
  // Et un revêtement qui n'occupe que la moitié du vide le referme aussi :
  // deux revêtements au même endroit ne valent pas mieux qu'aucun.
  const halfway = (x, z) => z > 3.4 && z < 4.6;
  assert.equal(collectRoadGaps([north, south], { roadIndex: index, taken: halfway }).length, 0);
});

test('les hachures sont le maillage, et elles sont ancrées au sol', () => {
  const north = straightRoad(0, 2.5, 11);
  const south = straightRoad(7, 2.5, 13);
  const [gap] = collectRoadGaps([north, south], { roadIndex: new RoadIndex([north, south]) });

  const buffer = createProfileBuffer();
  const paint = [1, 1, 1];
  const ground = [0, 0, 0];
  const bands = appendZebra(buffer, gap, { paint, ground, pitch: ZEBRA_PITCH_M, lift: 0.1 });

  assert.ok(bands > 100, `une bande par pas de hachure, vu ${bands}`);
  assert.equal(buffer.positions.length / 3, bands * 4, 'quatre sommets par bande');
  assert.equal(buffer.indices.length, bands * 6, 'deux triangles par bande');

  // Chaque bande est d'une seule couleur, et les deux couleurs alternent.
  const kinds = new Set();
  for (let b = 0; b < bands; b++) {
    const first = buffer.colors[b * 12];
    for (let v = 0; v < 4; v++) assert.equal(buffer.colors[b * 12 + v * 3], first);
    kinds.add(first);
  }
  assert.equal(kinds.size, 2, 'peinte et revêtement, alternées');

  // La nappe est tendue entre les deux plate-formes, pas posée à plat : c'est
  // ce qui évite une marche ou une fente sur l'une des deux rives.
  const heights = new Set();
  for (let i = 1; i < buffer.positions.length; i += 3) heights.add(Math.round(buffer.positions[i] * 100));
  assert.ok(heights.has(1110) && heights.has(1310), 'les deux cotes s’y retrouvent');

  // Le rang d'une bande est tiré de l'abscisse curviligne de la chaussée : la
  // même portion décalée d'un pas entier tombe sur les mêmes couleurs.
  const shifted = createProfileBuffer();
  appendZebra(shifted, gap, { paint, ground, pitch: ZEBRA_PITCH_M, startDistance: ZEBRA_PITCH_M * 4 });
  assert.deepEqual([...shifted.colors].slice(0, 12), [...buffer.colors].slice(0, 12));
  const odd = createProfileBuffer();
  appendZebra(odd, gap, { paint, ground, pitch: ZEBRA_PITCH_M, startDistance: ZEBRA_PITCH_M });
  assert.notDeepEqual([...odd.colors].slice(0, 3), [...buffer.colors].slice(0, 3));
});

// --- Les attributs que three déclare déjà -----------------------------------

/*
 * three ajoute un préambule à tout `ShaderMaterial`, et ce préambule **déclare
 * les attributs intégrés** — `position`, `uv`, et, dès qu'un `InstancedMesh`
 * porte un `instanceColor`, `instanceColor`. Les redéclarer côté worldpaint ne
 * produit pas un avertissement mais une erreur de compilation du programme, et
 * donc un matériau entièrement noir ou absent. La panne est d'autant plus
 * traître qu'elle ne se déclenche qu'au premier rendu d'une instance colorée.
 */
const THREE_BUILTIN_ATTRIBUTES = [
  'position',
  'normal',
  'tangent',
  'uv',
  'uv1',
  'uv2',
  'uv3',
  'color',
  'instanceMatrix',
  'instanceColor',
  'batchId',
  'skinIndex',
  'skinWeight',
];

function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

test('aucun shader ne redéclare un attribut que three déclare déjà', () => {
  const declaration = /\battribute\s+\w+\s+(\w+)\s*;/g;
  for (const path of sourceFilesUnder('src')) {
    const source = readFileSync(path, 'utf8');
    for (const [, name] of source.matchAll(declaration)) {
      assert.ok(
        !THREE_BUILTIN_ATTRIBUTES.includes(name),
        `${path} redéclare l’attribut intégré « ${name} » — three le déclare déjà`
      );
    }
  }
});

test('la compensation d’alpha atteint sa cible, et n’atteint que les couvertures', () => {
  // Une greffe par `replace` qui ne trouve pas son point d'ancrage ne casse
  // rien : elle ne fait simplement **rien**, silencieusement. C'est le pire cas
  // pour un correctif visuel — on chercherait le défaut ailleurs pendant
  // longtemps. On vérifie donc que chaque morceau est bien arrivé.
  // Un stub, comme pour le halo : la suite tourne sans three (peer dependency),
  // et c'est la **source du shader** qu'on vérifie, pas son exécution. Les noms
  // d'inclusion sont ceux de three, et ce sont eux les points d'ancrage.
  const THREE = {
    DoubleSide: 2,
    MeshLambertMaterial: class {
      constructor(options) {
        Object.assign(this, options, { userData: {} });
      }
    },
    ShaderChunk: { lights_fragment_begin: 'IncidentLight directLight;\n#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )' },
  };
  const compile = (material) => {
    const shader = {
      uniforms: {},
      vertexShader: [
        '#include <common>',
        '#include <uv_vertex>',
        '#include <begin_vertex>',
        '#include <project_vertex>',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <map_fragment>',
        '#include <alphatest_fragment>',
        '#include <normal_fragment_begin>',
        '#include <lights_fragment_begin>',
      ].join('\n'),
    };
    material.onBeforeCompile(shader);
    return shader;
  };

  const couverture = compile(
    createFoliageMaterial({
      THREE,
      map: null,
      atlas: true,
      tiles: 3,
      wind: true,
      coverage: true,
      coverageRange: [28, 110],
      coverageGain: 2.2,
      cacheKey: 'test-coverage',
    })
  );
  assert.match(couverture.vertexShader, /varying float vCoverDist;/);
  assert.match(couverture.fragmentShader, /varying float vCoverDist;/);
  assert.match(couverture.vertexShader, /vCoverDist = -mvPosition\.z;/);
  assert.match(couverture.fragmentShader, /smoothstep\(28\.0, 110\.0, vCoverDist\)/);
  // Le découpage lui-même reste celui de three : on remonte l'alpha **avant**,
  // on ne réécrit pas le test.
  assert.ok(couverture.fragmentShader.includes('#include <alphatest_fragment>'));

  // Les arbres n'y gagnent rien — leurs panneaux restent grands à l'écran — et
  // leur programme doit rester exactement celui d'avant.
  const arbres = compile(
    createFoliageMaterial({ THREE, map: null, atlas: true, tiles: 3, cacheKey: 'test-nu' })
  );
  assert.ok(
    !/vCoverDist/.test(arbres.vertexShader + arbres.fragmentShader),
    'sans `coverage`, aucune trace de la compensation'
  );
});

test('le vent se mesure sur la hauteur de la plante, pas sur la largeur du panneau', () => {
  // Le déplacement est écrit dans le quadrilatère unité, puis mis à l'échelle
  // par la matrice d'instance : sans correction, son amplitude réelle était
  // celle de la **largeur** du panneau. Comme le niveau de détail élargit les
  // masses lointaines d'un facteur trois, un champ de tournesols ondulait de
  // plusieurs mètres à cent mètres et de dix centimètres à dix — l'inverse de
  // ce qu'on voit.
  const source = readFileSync('src/materials/foliageMaterial.js', 'utf8');
  assert.match(
    source,
    /float slim = length\(instanceMatrix\[1\]\.xyz\) \/ max\(length\(instanceMatrix\[0\]\.xyz\), 1e-4\);/
  );
  assert.match(source, /float bend = transformed\.y \* transformed\.y \* uWindStrength \* slim;/);
  // Sans instanciation, il n'y a pas de matrice à lire : le rapport vaut un.
  assert.match(source, /float slim = 1\.0;/);

  // Les couches qui l'appellent ont vu leur amplitude ramenée à leur élancement
  // de près : c'est ce qui garde le premier plan tel quel.
  assert.match(
    readFileSync('src/layers/groundCover.js', 'utf8'),
    /windStrength: 0\.35 \* theme\.grass\.aspect,/
  );
  assert.match(
    readFileSync('src/layers/vegetationLayer.js', 'utf8'),
    /windStrength: 0\.05 \* TREE_ASPECT,/
  );
  assert.match(readFileSync('src/layers/cropLayer.js', 'utf8'), /windStrength: CROP_WIND_STRENGTH,/);
});

test('le contour de l’eau se fond, sans que les identifiants cessent d’être lus au plus proche', () => {
  // Le shader de terrain ne se monte pas sous `node` (il fabrique des canevas
  // de grain), donc c'est sa **source** qu'on lit — comme pour la
  // compensation d'alpha plus haut, et pour la même raison : une greffe qui
  // rate son ancrage ne casse rien, elle ne fait rien.
  const source = readFileSync('src/terrain/terrainMaterial.js', 'utf8');

  // Une seule carte, un seul appel : la couleur et l'eau viennent des quatre
  // mêmes relevés. C'étaient trois mécanismes — un mélange de quatre poids
  // interpolés linéairement, une boucle de couvertures, une substitution de
  // culture — pour une seule question.
  assert.match(source, /surfaceAt\(surfaceUv, noise, far, farmAlbedo, albedo, gWater\);/);
  assert.ok(!/uClassMap|uCropMap/.test(source), 'les deux cartes ont fusionné');

  // Ce qui est interpolé est l'**appartenance**, pas l'identifiant : chaque
  // relevé vise un centre de texel, là où le filtrage au plus proche rend la
  // valeur peinte et rien d'autre.
  assert.match(source, /texture2D\(uSurfaceMap, \(texel \+ 0\.5\) \/ \$\{CLASS_PIXELS\}\.0\)/);
  assert.equal(
    (source.match(/surfaceIdAt\(corner/g) || []).length,
    4,
    'les quatre texels voisins, pas un seul'
  );

  // Et la berge est un fondu, pas une substitution.
  assert.match(source, /base = mix\(base, water, gWater\);/);

  // L'eau ne doit pas être peinte deux fois : écartée du mélange, sans quoi le
  // sol sous le fondu serait déjà de l'eau.
  assert.match(source, /if \(i != \$\{WATER_ID\}\)/);
  assert.match(source, /water = dot\(step\(abs\(ids - \$\{WATER_ID\}\.0\), vec4\(0\.5\)\), lifted\);/);
  // Et les parts sont rapportées à ce qui n'est pas de l'eau, sans quoi une
  // plage tournerait au gravier à l'approche de la mer.
  assert.match(source, /float land = max\(1\.0 - water, 1e-4\);/);
});

test('le halo lit la couleur d’instance sans la redéclarer', () => {
  // Un stub : le matériau n’a besoin que de retenir ce qu’on lui passe, et
  // c’est la **source du shader** qu’on vérifie, pas son exécution.
  const THREE = {
    DoubleSide: 2,
    AdditiveBlending: 2,
    Vector3: class {
      constructor(x, y, z) {
        Object.assign(this, { x, y, z });
      }
    },
    ShaderMaterial: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };

  const material = createGlowMaterial(THREE);
  assert.ok(!/attribute\s+vec3\s+instanceColor/.test(material.vertexShader), 'jamais déclaré ici');
  // La question « y a-t-il une couleur par instance ? » est posée à three, qui
  // la connaît déjà, et non à un paramètre que l’appelant devrait tenir juste.
  assert.match(material.vertexShader, /#ifdef USE_INSTANCING_COLOR/);
  assert.match(material.vertexShader, /vTint = instanceColor;/);
  // Sans couleur d’instance, le halo garde son ton : c’est le lampadaire.
  assert.match(material.vertexShader, /vTint = uColor;/);
  assert.equal(material.uniforms.uColor.value.x, 1);
  // Le halo s’allume la nuit : il naît éteint.
  assert.equal(material.uniforms.uOpacity.value, 0);
});

// --- Les noms des lieux : entrée d'agglomération, enseigne de commerce ------

test('collectPlaceNames retient les agglomérations nommées, écarte quartiers et lieux sans nom', () => {
  const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
  const source = fakePlaceSource([
    { layer: 'place', properties: { class: 'city', name: 'Lyon' }, geometry: point(4.83, 45.76) },
    { layer: 'place', properties: { class: 'suburb', name: 'Bellecour' }, geometry: point(4.83, 45.76) },
    { layer: 'place', properties: { class: 'village', name: 'Dornas' }, geometry: point(4.35, 44.85) },
    { layer: 'place', properties: { class: 'city' }, geometry: point(2.35, 48.85) }, // sans nom
    { layer: 'place', properties: { class: 'island', name: 'Île des Lémuriens' }, geometry: point(0, 0) },
  ]);
  const frame = { origin: { x: 0, y: 0 }, scale: 1000, zoom: 0 };

  const places = collectPlaceNames(source, [{ x: 0, y: 0 }], frame);

  assert.deepEqual(
    places.map((p) => p.name).sort(),
    ['Dornas', 'Lyon'],
    'ni le quartier, ni le lieu sans nom, ni l’île ne sont une agglomération'
  );
  assert.ok(places.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
  assert.deepEqual(collectPlaceNames(null, [], null), [], 'sans source, aucun lieu');
});

test('SETTLEMENT_PLACE_CLASSES exclut les subdivisions internes d’une ville', () => {
  assert.ok(SETTLEMENT_PLACE_CLASSES.has('city'));
  assert.ok(SETTLEMENT_PLACE_CLASSES.has('town'));
  assert.ok(SETTLEMENT_PLACE_CLASSES.has('village'));
  assert.ok(SETTLEMENT_PLACE_CLASSES.has('hamlet'));
  for (const excluded of ['suburb', 'quarter', 'neighbourhood', 'island']) {
    assert.ok(!SETTLEMENT_PLACE_CLASSES.has(excluded), excluded);
  }
});

test('nearestNamedPlace retient le plus proche, dans le rayon donné seulement', () => {
  const places = [
    { x: 0, z: 0, name: 'Loin' },
    { x: 10, z: 0, name: 'Proche' },
  ];
  assert.equal(nearestNamedPlace(places, 12, 0, 50).name, 'Proche');
  assert.equal(nearestNamedPlace(places, 12, 0, 1), null, 'hors de portée, personne');
  assert.equal(nearestNamedPlace([], 0, 0, 100), null);
  assert.equal(nearestNamedPlace(null, 0, 0, 100), null);
});

test('shopfrontLayout centre une large baie d’entrée, flanquée de baies symétriques', () => {
  const theme = { windowWidthM: 1.1, doorWidthM: 1.7, marginM: 0.45, gapM: 0.3 };
  const modules = shopfrontLayout(6, theme);
  assert.ok(modules, 'assez de place pour une devanture');

  const doors = modules.filter((m) => m.door);
  assert.equal(doors.length, 1, 'une seule porte');
  assert.equal(doors[0].offset, 0, 'centrée sur le pan');

  const windows = modules.filter((m) => !m.door);
  assert.equal(windows.length, 2, 'une baie de chaque côté');
  const offsets = windows.map((m) => m.offset).sort((a, b) => a - b);
  close(offsets[0], -offsets[1], 1e-9, 'symétrique de part et d’autre de la porte');
});

test('shopfrontLayout retombe sur des baies seules quand la porte ne tient pas', () => {
  const theme = { windowWidthM: 1.1, doorWidthM: 1.7, marginM: 0.45, gapM: 0.3 };
  const modules = shopfrontLayout(2, theme);
  assert.ok(modules);
  assert.ok(modules.every((m) => !m.door), 'pas de porte sur un pan trop étroit pour elle');
});

test('shopfrontLayout : un pan trop étroit ne tient même pas une baie', () => {
  const theme = { windowWidthM: 1.1, doorWidthM: 1.7, marginM: 2, gapM: 0.3 };
  assert.equal(shopfrontLayout(3, theme), null);
});

/** `theme.shopfront` minimal, pour les tests d'`appendShopfront`. */
const SHOPFRONT_THEME = {
  windowWidthM: 1.1,
  doorWidthM: 1.7,
  marginM: 0.45,
  gapM: 0.3,
  sillM: 0.15,
  fasciaHeightM: 0.6,
  fasciaGapM: 0.14,
};

test('appendShopfront perce une devanture et peint l’enseigne au-dessus', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  const openings = { panes: 0, budget: 10 };
  const atlas = { place: (text) => (text ? { u0: 0, v0: 0, u1: 1, v1: 1, widthPx: 200, heightPx: 60 } : null) };

  const drawn = appendShopfront(
    openings,
    walls,
    labels,
    atlas,
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    0,
    -1,
    100,
    103.05,
    0,
    'Chez Julien',
    SHOPFRONT_THEME
  );

  assert.equal(drawn, true, 'assez de place pour une devanture');
  assert.ok(openings.panes > 0, 'des baies comptées dans le même budget que les fenêtres');
  assert.ok(walls.positions.length > 0, 'de la géométrie de baie');
  assert.equal(labels.positions.length / 3, 6, 'un quadrilatère peint, six sommets');

  // Rien ne dépasse ni sous l'assise de la devanture, ni au-dessus d'elle.
  for (let i = 1; i < walls.positions.length; i += 3) {
    assert.ok(walls.positions[i] >= 100, 'rien sous l’assise');
    assert.ok(walls.positions[i] <= 103.05, 'rien au-dessus de la devanture');
  }
});

test('appendShopfront : sans nom, la devanture reste percée mais rien n’est peint', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  const openings = { panes: 0, budget: 10 };
  const atlas = { place: (text) => (text ? { u0: 0, v0: 0, u1: 1, v1: 1, widthPx: 200, heightPx: 60 } : null) };

  const drawn = appendShopfront(
    openings,
    walls,
    labels,
    atlas,
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    0,
    -1,
    100,
    103.05,
    0,
    null,
    SHOPFRONT_THEME
  );

  assert.equal(drawn, true);
  assert.equal(labels.positions.length, 0, 'sans nom, rien à peindre');
});

test('appendShopfront : un pan trop étroit ne pose rien, le bandeau reste seul', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  const openings = { panes: 0, budget: 10 };
  const theme = { ...SHOPFRONT_THEME, marginM: 2 };

  const drawn = appendShopfront(
    openings,
    walls,
    labels,
    null,
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    0,
    -1,
    100,
    103.05,
    0,
    'Test',
    theme
  );

  assert.equal(drawn, false);
  assert.equal(walls.positions.length, 0);
  assert.equal(openings.panes, 0);
});

test('appendOpenings : skipGroundLevel laisse le rez-de-chaussée à la devanture', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const openings = { panes: 0, budget: 100, lit: null };
  const style = { shutter: [0.2, 0.3, 0.45], house: false, shutters: false };

  appendOpenings(openings, walls, { x: 0, y: 0 }, { x: 20, y: 0 }, 0, -1, 100, 8, 0, style, undefined, {
    skipGroundLevel: true,
  });

  assert.ok(openings.panes > 0, 'l’étage garde ses baies');
  // Rez-de-chaussée : allège à 1,1 m, tête à 2,25 m — rien ne doit s’y trouver,
  // seul l’étage au-dessus (allège à 4,3 m) a posé quelque chose.
  for (let i = 1; i < walls.positions.length; i += 3) {
    assert.ok(walls.positions[i] > 103, 'rien au rez-de-chaussée, seulement à l’étage');
  }
});

test('fitLabelText réduit la fonte jusqu’à tenir dans la largeur, avec un interlettrage négatif', () => {
  // Mesure simplifiée : chaque caractère vaut `fontPx * 0.6` de large.
  const measure = (text, fontPx) => text.length * fontPx * 0.6;

  const wide = fitLabelText({ text: 'LYON', maxWidthPx: 1000, maxFontPx: 40, measure });
  assert.equal(wide.fontPx, 40, 'assez de place : la fonte nominale tient');
  assert.ok(wide.letterSpacingPx < 0, 'interlettrage resserré');

  const narrow = fitLabelText({
    text: 'SAINT-JEAN-DE-BOURNAY',
    maxWidthPx: 120,
    maxFontPx: 40,
    minFontPx: 8,
    measure,
  });
  assert.ok(narrow.fontPx < 40, 'un nom long réduit la fonte');
  assert.ok(narrow.fontPx >= 8, 'jamais sous le plancher');

  assert.equal(fitLabelText({ text: '', maxWidthPx: 100, maxFontPx: 40, measure }), null);
});

test('pushLabelQuad pousse un quadrilatère texturé, UV compris', () => {
  const buffer = { positions: [], uvs: [] };
  pushLabelQuad(buffer, { x: 0, y: 0 }, { x: 2, y: 0 }, 10, 11, { u0: 0, v0: 0, u1: 1, v1: 1 });
  assert.equal(buffer.positions.length, 18, 'six sommets, deux triangles');
  assert.equal(buffer.uvs.length, 12);
  for (let i = 1; i < buffer.positions.length; i += 3) {
    assert.ok(buffer.positions[i] >= 10 && buffer.positions[i] <= 11, 'entre bas et haut');
  }
  // `a` porte la fin du texte (u1), `b` son début (u0) — voir la note de
  // `pushLabelQuad` : un texte lu de droite à gauche ne casse rien à
  // l'exécution, ce qui l'a longtemps laissé passer inaperçu.
  assert.deepEqual(buffer.uvs.slice(0, 2), [1, 1], 'a porte u1');
  assert.deepEqual(buffer.uvs.slice(2, 4), [0, 0], 'b porte u0');
});

test('pushLabelQuad regarde dans le même sens que pushPanel, pour les mêmes points', () => {
  // Un pan de mur a → b, normale sortante à la `buildingLayer`.
  const wallA = { x: 0, y: 0 };
  const wallB = { x: 4, y: 0 };
  const nx = wallB.y - wallA.y;
  const nz = -(wallB.x - wallA.x);

  const walls = { positions: [], normals: [], colors: [] };
  pushPanel(walls, wallA, wallB, 1, 2, nx, nz, [1, 1, 1], [1, 1, 1]);

  const labels = { positions: [], uvs: [] };
  pushLabelQuad(labels, wallA, wallB, 1, 2, { u0: 0, v0: 0, u1: 1, v1: 1 });

  // Même triangle de tête (mêmes trois premiers sommets côté position) :
  // même enroulement, donc même face visible.
  assert.deepEqual(labels.positions.slice(0, 9), walls.positions.slice(0, 9));
});

test('labelFontPxForCellHeight retrouve la fonte qui a produit une case de cette hauteur', () => {
  const cellHeightPx = 51;
  const fontPx = labelFontPxForCellHeight(cellHeightPx);
  // Recomposé à la manière de `LabelAtlas.place` : `ceil(fontPx * ratio) + 2·padding`.
  const rebuilt = Math.ceil(fontPx * LABEL_LINE_HEIGHT_RATIO) + LABEL_PADDING_PX * 2;
  assert.ok(Math.abs(rebuilt - cellHeightPx) <= 1, 'la case reconstruite retombe sur la hauteur visée');
  assert.ok(labelFontPxForCellHeight(0) > 0, 'jamais une fonte nulle ou négative');
});

// --- L'enseigne en drapeau : un pictogramme lisible depuis le trottoir -----

test('shopfrontEmojiFor retrouve le pictogramme de la classe, ou le repli générique', () => {
  assert.equal(shopfrontEmojiFor('bakery'), SHOPFRONT_EMOJI.bakery);
  assert.equal(shopfrontEmojiFor('cafe'), SHOPFRONT_EMOJI.cafe);
  assert.equal(shopfrontEmojiFor('inconnu'), SHOPFRONT_EMOJI_DEFAULT);
  assert.equal(shopfrontEmojiFor(null), SHOPFRONT_EMOJI_DEFAULT);
});

test('la table des pictogrammes ne porte que des émojis à un seul point de code', () => {
  // `LabelAtlas.place`/`drawSpacedText` (materials/labelAtlas.js) peignent
  // glyphe par glyphe via `for (const glyph of text)` : une séquence à
  // variateur (️, U+FE0F) ou à jointure (‍, U+200D) s'y couperait en
  // plusieurs glyphes mal alignés au lieu d'un seul pictogramme.
  for (const [klass, emoji] of Object.entries(SHOPFRONT_EMOJI)) {
    assert.equal([...emoji].length, 1, `${klass} : "${emoji}"`);
  }
  assert.equal([...SHOPFRONT_EMOJI_DEFAULT].length, 1);
});

test('appendShopSignBlade pose un panneau des deux côtés, avec son pictogramme', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  const atlas = { place: (text) => (text ? { u0: 0, v0: 0, u1: 1, v1: 1, widthPx: 40, heightPx: 40 } : null) };

  appendShopSignBlade(walls, labels, atlas, { x: 0, y: 0 }, { x: 6, y: 0 }, 0, -1, 100, 0, 'bakery');

  // Panneau de fond (deux faces) + deux tiges (deux faces chacune), six
  // sommets par face.
  assert.equal(walls.positions.length / 3, 36, 'panneau et tiges, des deux côtés');
  // Pictogramme : deux passes également.
  assert.equal(labels.positions.length / 3, 12, 'deux faces peintes');

  // Rien ne flotte au-dessus du toit ni sous le sol : tout reste autour de
  // `BLADE_SIGN_HEIGHT_M` (2,55 m), à `BLADE_SIGN_SIZE_M` (0,5 m) près.
  for (let i = 1; i < walls.positions.length; i += 3) {
    assert.ok(walls.positions[i] > 102 && walls.positions[i] < 103.1, 'autour de la hauteur de pose');
  }
});

test('appendShopSignBlade : sans atlas, seul le panneau de fond se pose', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };

  appendShopSignBlade(walls, labels, null, { x: 0, y: 0 }, { x: 6, y: 0 }, 0, -1, 100, 0, 'bakery');

  assert.equal(walls.positions.length / 3, 36, 'le panneau et ses tiges ne dépendent pas de l’atlas');
  assert.equal(labels.positions.length, 0, 'rien à peindre sans atlas');
});

test('appendShopSignBlade : pan trop court pour le décalage, rien ne se pose', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  appendShopSignBlade(walls, labels, null, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, -1, 100, 0, 'bakery');
  assert.equal(walls.positions.length, 0);
});

test('appendShopSignBlade a une vraie épaisseur et deux tiges qui le lient au mur', () => {
  const walls = { positions: [], normals: [], colors: [] };
  const labels = { positions: [], uvs: [] };
  // Pan le long de x, mur au nord (nz = -1) : le panneau doit pousser vers
  // z négatif depuis le mur (z = 0), à l'inset (0,9 m) du bord.
  appendShopSignBlade(walls, labels, null, { x: 0, y: 0 }, { x: 6, y: 0 }, 0, -1, 100, 0, 'bakery');

  // Deux faces réellement écartées : les six premiers sommets (face avant) et
  // les six suivants (face arrière) ne partagent aucun x — l'épaisseur porte
  // sur l'axe x ici (la tangente du mur), pas sur z (sa portée).
  const xs = (from, to) => walls.positions.slice(from, to).filter((_, i) => i % 3 === 0);
  const frontXs = xs(0, 18);
  const backXs = xs(18, 36);
  assert.notDeepEqual(frontXs, backXs, 'les deux faces ne sont pas coplanaires');
  const thickness = Math.abs(frontXs[0] - backXs[0]);
  close(thickness, 0.05, 1e-9, 'l’épaisseur du panneau');

  // Deux tiges (quatre passes, deux par tige) après les deux faces du
  // panneau : chacune touche le mur (z = 0, à l’inset près sur x) d’un côté,
  // et la face intérieure du panneau (z ≈ -0,3 m) de l’autre.
  const rodPositions = walls.positions.slice(36);
  assert.equal(rodPositions.length / 18, 4, 'quatre passes de tige (deux tiges, deux faces chacune)');
  const zs = rodPositions.filter((_, i) => i % 3 === 2);
  assert.ok(zs.some((z) => Math.abs(z) < 0.03), 'une tige touche le mur');
  assert.ok(zs.some((z) => z < -0.25), 'une tige atteint la face intérieure du panneau');
});

test('les deux faces du panneau et de son pictogramme se font face, pas dos à dos', () => {
  // Reproduit la géométrie de deux commerces posés sur des pans d'orientations
  // différentes, et vérifie que chaque face du pictogramme regarde exactement
  // dans le même sens que sa face de fond correspondante — sans quoi les deux
  // se disputeraient le pixel (voir la note d'`appendShopSignBlade`).
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const normalOfFirstTri = (positions) => {
    const p = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    return cross(sub(p(1), p(0)), sub(p(2), p(0)));
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v) => Math.hypot(...v);
  const cos = (a, b) => dot(a, b) / (norm(a) * norm(b));

  for (const [a, b, nx, nz] of [
    [{ x: 0, y: 0 }, { x: 6, y: 0 }, 0, -1],
    [{ x: 3, y: -2 }, { x: 3, y: 5 }, 1, 0],
    [{ x: 0, y: 0 }, { x: 4, y: 4 }, Math.SQRT1_2, -Math.SQRT1_2],
  ]) {
    const walls = { positions: [], normals: [], colors: [] };
    const labels = { positions: [], uvs: [] };
    const atlas = { place: (text) => (text ? { u0: 0, v0: 0, u1: 1, v1: 1, widthPx: 40, heightPx: 40 } : null) };
    appendShopSignBlade(walls, labels, atlas, a, b, nx, nz, 100, 0, 'bakery');

    const backing1 = normalOfFirstTri(walls.positions.slice(0, 18));
    const backing2 = normalOfFirstTri(walls.positions.slice(18, 36));
    const icon1 = normalOfFirstTri(labels.positions.slice(0, 18));
    const icon2 = normalOfFirstTri(labels.positions.slice(18, 36));

    close(cos(backing1, icon1), 1, 1e-9, 'première face');
    close(cos(backing2, icon2), 1, 1e-9, 'seconde face');
    // Les deux faces du fond se font dos à dos, jamais face à face.
    close(cos(backing1, backing2), -1, 1e-9, 'les deux faces du fond');
  }
});

// --- Entrée d'agglomération : une vraie coupure, pas un artefact de tuile --

test('isSettlementEdgeRun : sans portion précédente, jamais une entrée', () => {
  // C'est le cas dominant dès que l'observateur est en ville — voir la note
  // de `SIGN_PLACE_NAME_MIN_GAP_M` : répondre "oui" par défaut ici revenait à
  // répondre "oui" partout en ville.
  assert.equal(isSettlementEdgeRun(null), false);
});

test('isSettlementEdgeRun : un écart trop court n’est pas une vraie campagne traversée', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ distance: i * 10 })); // 90 m
  assert.equal(isSettlementEdgeRun({ value: false, rows }, 150), false);
});

test('isSettlementEdgeRun : un vrai passage hors ville marque une entrée', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ distance: i * 10 })); // 190 m
  assert.equal(isSettlementEdgeRun({ value: false, rows }, 150), true);
});

test('isSettlementEdgeRun : le seuil est inclusif, et le plancher par défaut est celui du module', () => {
  const rows = [{ distance: 0 }, { distance: SIGN_PLACE_NAME_MIN_GAP_M }];
  assert.equal(isSettlementEdgeRun({ value: false, rows }), true);
});

test('isSettlementEdgeRun rejoué sur les deux terrains qui ont motivé ce garde-fou', () => {
  // Reconstitué depuis de vraies tuiles OpenFreeMap (voir la note de
  // `SIGN_PLACE_NAME_MIN_GAP_M` pour le protocole et les chiffres complets) :
  //
  // - Meyzieu (agglomération lyonnaise) : un observateur planté en plein
  //   centre-ville voit sa fenêtre de bord de route (`FURNITURE_RADIUS_M`)
  //   commencer déjà bâtie sur les 263 portions "ville" qu'elle contient —
  //   aucune ne porte de portion précédente. Sans ce garde-fou, chacune
  //   posait un panneau : 98 sur une seule reconstruction.
  const cityRun = null; // aucune portion précédente, dans les 263 cas observés
  assert.equal(isSettlementEdgeRun(cityRun), false);

  // - Dornas (village isolé d'Ardèche) : quel que soit le point d'approche
  //   autour du village, la portion précédente est un vrai passage de
  //   campagne — de 175 à 1465 m selon la route empruntée.
  for (const gapM of [175, 455, 595, 770, 920, 1250, 1465]) {
    const approach = { value: false, rows: [{ distance: 0 }, { distance: gapM }] };
    assert.equal(isSettlementEdgeRun(approach), true, `écart de ${gapM} m`);
  }
});

/**
 * Canevas bouchonné, assez complet pour les peintres de `proceduralTextures` :
 * le matériau de terrain en fabrique six à sa construction, et le test ne
 * regarde que la source du shader.
 */
function paintingCanvasContext() {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    save() {},
    restore() {},
    scale() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    ellipse() {},
    fill() {},
    stroke() {},
    fillRect() {},
    putImageData() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
}

/** Le strict nécessaire de three pour construire le matériau de terrain. */
function terrainThreeStub() {
  const vector = (n) =>
    class {
      constructor(...values) {
        for (let i = 0; i < n; i++) this[['x', 'y', 'z', 'w'][i]] = values[i] ?? 0;
      }
      set(...values) {
        for (let i = 0; i < n; i++) this[['x', 'y', 'z', 'w'][i]] = values[i] ?? 0;
        return this;
      }
      copy(other) {
        return this.set(other.x, other.y, other.z, other.w);
      }
    };
  return {
    RepeatWrapping: 1,
    NoColorSpace: '',
    CanvasTexture: class {
      constructor(canvas) {
        this.image = canvas;
      }
    },
    Vector2: vector(2),
    Vector3: vector(3),
    Vector4: vector(4),
    MeshLambertMaterial: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };
}

test('les limites de surfaces : la frange, les matières interpolées et la rive arrivent dans le shader', () => {
  // Une greffe par `replace` qui rate son ancrage ne casse rien : elle ne fait
  // simplement rien, en silence. Ce test ne juge pas du rendu — il vérifie que
  // les trois morceaux sont bien dans la source, et que les réglages du thème
  // arrivent aux uniformes.
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      Object.assign(this, { width, height });
    }
    getContext() {
      return paintingCanvasContext();
    }
  };

  let factory;
  try {
    factory = new TerrainMaterialFactory({ THREE: terrainThreeStub() });
  } finally {
    if (previousCanvas) globalThis.OffscreenCanvas = previousCanvas;
    else delete globalThis.OffscreenCanvas;
  }

  const shader = {
    uniforms: {},
    vertexShader: ['#include <common>', '#include <begin_vertex>'].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <normal_fragment_begin>',
    ].join('\n'),
  };
  factory.material.onBeforeCompile(shader);
  const source = shader.fragmentShader;

  // La frange : déclarée, et appliquée au point de lecture des deux cartes.
  assert.match(source, /vec2 edgeWarp\(vec2 world\)/);
  assert.match(
    source,
    /surfaceUv = \(vScenePos\.xz \+ edgeWarp\(vScenePos\.xz\) - uSurfaceOrigin\)/
  );

  // Les couvertures : lues aux quatre carreaux voisins, mélangées par leur
  // appartenance, l'eau tenue à part.
  assert.match(source, /out vec3 albedo, out float water/);
  assert.equal(
    (source.match(/surfaceIdAt\(corner/g) || []).length,
    4,
    'les quatre texels voisins, pas un seul'
  );
  assert.ok(
    !/waterShareAt|coverIdAt/.test(source),
    'les lectures séparées ont été reprises par surfaceAt'
  );

  // La rive : le même sol mouillé que la pluie, deux appels pour une formule.
  assert.match(source, /vec3 wetGround\(vec3 base, float amount\)/);
  assert.equal(
    (source.match(/wetGround\(/g) || []).length,
    3,
    'une déclaration et deux appels : la pluie et la rive'
  );
  assert.match(source, /float shore =\s*\n?\s*smoothstep\(0\.0, 0\.35, gWater\)/);

  // Les réglages viennent du thème, pas du shader.
  assert.equal(shader.uniforms.uShoreWet.value, defaultTheme.terrain.shoreWet);
  assert.equal(shader.uniforms.uEdgeWarp.value.x, defaultTheme.terrain.edgeWarpM);
  assert.equal(shader.uniforms.uEdgeWarp.value.y, defaultTheme.terrain.edgeWarpScaleM);
});

/** Corrélation de Pearson, en valeur absolue. Deux champs indépendants tendent vers 0. */
function correlation(a, b) {
  const n = a.length;
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;
  let joint = 0;
  let spreadA = 0;
  let spreadB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    joint += x * y;
    spreadA += x * x;
    spreadB += y * y;
  }
  return Math.abs(joint / Math.sqrt(spreadA * spreadB || 1));
}

test('le grain du sol : trois champs indépendants dans une seule carte', () => {
  // Les trois canaux ne sont pas un confort. L'interpénétration des matières
  // repondère les poids par la hauteur du grain de chacune : un grain commun
  // serait un facteur commun, qui s'annule à la normalisation, et la lisière
  // redeviendrait le dégradé linéaire que ce mécanisme remplace.
  const size = 128;
  let written = null;
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      Object.assign(this, { width, height });
    }
    getContext() {
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image) => {
          written = image.data;
        },
      };
    }
  };
  try {
    createEdgeNoiseCanvas(size, 4242);
  } finally {
    if (previousCanvas) globalThis.OffscreenCanvas = previousCanvas;
    else delete globalThis.OffscreenCanvas;
  }
  assert.ok(written, 'la carte de grain a bien été écrite');

  const channel = (c) => Array.from({ length: size * size }, (_, i) => written[i * 4 + c]);
  const red = channel(0);
  const green = channel(1);
  const blue = channel(2);

  assert.ok(correlation(red, green) < 0.2, 'R et G doivent être indépendants');
  assert.ok(correlation(red, blue) < 0.2, 'R et B doivent être indépendants');
  assert.ok(correlation(green, blue) < 0.2, 'G et B doivent être indépendants');

  // Une modulation, pas une couleur : centrée sur 0,5 et resserrée.
  for (const [name, values] of [['R', red], ['G', green], ['B', blue]]) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length / 255;
    assert.ok(Math.abs(mean - 0.5) < 0.01, `le canal ${name} doit moduler autour de 0,5`);
  }

  // L'alpha reste plein : un canevas 2D prémultiplie, et un quatrième champ
  // rangé là abîmerait les trois autres.
  assert.ok(
    channel(3).every((v) => v === 255),
    'l’alpha doit rester plein'
  );

  // Et le point de tout le relevé : c'est un **grain**, pas un nuage.
  //
  // Le test qui manquait. Une somme d'octaves à la mode habituelle est
  // dominée par sa grille la plus grossière : deux texels voisins y différaient
  // de 5 % de l'écart-type du champ — autant dire qu'ils étaient identiques, et
  // aucune échelle de lecture ne pouvait rattraper ça. On mesure donc
  // directement ce qui compte : l'écart entre voisins, rapporté à l'étendue du
  // champ. Au-dessus de 1, les voisins sont décorrélés et le grain vit à
  // l'échelle du texel, qui est la seule où un grain existe.
  for (const [name, values] of [['R', red], ['G', green], ['B', blue]]) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const spread = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    );
    let gap = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        gap += (values[y * size + x] - values[y * size + ((x + 1) % size)]) ** 2;
      }
    }
    gap = Math.sqrt(gap / (size * size));
    assert.ok(
      gap / spread > 1,
      `le canal ${name} doit avoir des voisins décorrélés (${(gap / spread).toFixed(2)})`
    );
  }

  // La quantité de lumière que le grain module, elle, n'a pas bougé : c'est
  // l'écart-type de l'ancien relevé nuageux, repris tel quel. Changer le
  // spectre et l'amplitude dans le même geste rendrait les deux effets
  // impossibles à départager à l'œil.
  for (const [name, values] of [['R', red], ['G', green], ['B', blue]]) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const spread =
      Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) / 255;
    assert.ok(
      Math.abs(spread - 0.1361) < 0.01,
      `le canal ${name} doit garder l'amplitude d'avant (${spread.toFixed(4)})`
    );
  }
});

test('le sol ne lit plus qu’un grain : ni motif, ni relevé anti-répétition', () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      Object.assign(this, { width, height });
    }
    getContext() {
      return paintingCanvasContext();
    }
  };

  let factory;
  try {
    factory = new TerrainMaterialFactory({ THREE: terrainThreeStub() });
  } finally {
    if (previousCanvas) globalThis.OffscreenCanvas = previousCanvas;
    else delete globalThis.OffscreenCanvas;
  }

  const shader = {
    uniforms: {},
    vertexShader: ['#include <common>', '#include <begin_vertex>'].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <normal_fragment_begin>',
    ].join('\n'),
  };
  factory.material.onBeforeCompile(shader);
  const source = shader.fragmentShader;

  // Rien de ce qui a été retiré ne doit revenir. Chaque ligne ici est une
  // couche qui prétendait faire lire un matériau et qu'on a fini par juger à
  // l'œil : motifs dessinés, relevé anti-répétition qui masquait leur pavage,
  // bruit « de détail », grain, relief tiré du grain.
  assert.ok(!/noTile/.test(source), 'le relevé anti-répétition a disparu');
  assert.ok(!/uGrassMap|uSoilMap|uWoodMap/.test(source), 'les textures de matière');
  assert.ok(!/uDetailMap|uDetailScale/.test(source), 'le bruit de détail');
  assert.ok(!/uGrainContrast|uGrainRelief|grainHeight/.test(source), 'le grain et son relief');
  assert.ok(!/dFdx|dFdy|fwidth/.test(source), 'plus aucune dérivée d’écran');
  for (const key of ['grainScaleM', 'grainPixels', 'grainContrast', 'grainRelief']) {
    assert.equal(defaultTheme.terrain[key], undefined, `${key} n'a plus d'objet`);
  }

  // Une surface est une couleur : ce qui multiplie l'albédo ne peut plus être
  // qu'une variation à l'échelle du paysage, jamais une matière.
  assert.match(source, /vec3 modulation = vec3\(1\.0\);/);
  assert.match(source, /uniform vec2 uDetailRange;/, 'la portée du fondu reste');

  // La seule normale encore perturbée est celle de l'eau. Le sol est lisse, et
  // il ne reste aucune dérivée d'écran dans le shader — c'est ce que dit
  // l'assertion ci-dessus, et c'est ce qui a fait disparaître le
  // fourmillement qui suivait l'observateur.
  assert.match(source, /mix\(worldNormal, wavy, gWater\)/);

  // Le bruit de lisière reste, et il ne s'affiche nulle part : deux lectures,
  // l'une pour la frange, l'autre pour donner leur forme aux limites.
  assert.equal(
    (source.match(/texture2D\(uEdgeNoise/g) || []).length,
    2,
    'la frange et la découpe des lisières, pas une de plus'
  );
  assert.match(
    source,
    /vec3 noise = texture2D\(uEdgeNoise, vScenePos\.xz \/ uEdgeNoiseScale\)\.rgb;/
  );
  assert.match(source, /texture2D\(uEdgeNoise, world \/ uEdgeWarp\.y\)/);
  // Chaque matière prend son champ dans la table, par un sélecteur : un bruit
  // commun serait un facteur commun, qui s'annule à la normalisation de
  // l'interpénétration, et la lisière retomberait sur un fondu linéaire.
  assert.match(source, /height \+= hit \* dot\(noise, uSurfaceNoise\[i - 1\]\);/);

  assert.equal(shader.uniforms.uEdgeNoiseScale.value, defaultTheme.terrain.edgeNoiseScaleM);

  // Le shader n'est compilé par personne ici : rien ne rattrape une parenthèse
  // ou une accolade perdue en éditant le gabarit, et l'erreur ne se verrait
  // qu'au premier rendu. Le compte, au moins, doit tomber juste.
  const count = (sign) => source.split(sign).length - 1;
  assert.equal(count('('), count(')'), 'parenthèses équilibrées');
  assert.equal(count('{'), count('}'), 'accolades équilibrées');
  assert.equal(factory.textures.length, 3, 'macro, bruit de lisière, rides');

  // Une matière = une couleur : le tableau d'albédos a exactement une entrée
  // par matière, et c'est tout ce qu'il faut pour en ajouter une.
  assert.equal(shader.uniforms.uSurfaceAlbedo.value.length, SURFACE_KINDS.length);
  assert.equal(shader.uniforms.uSurfaceNoise.value.length, SURFACE_KINDS.length);

  for (const key of ['detailScaleNear', 'detailScaleFar']) {
    assert.equal(defaultTheme.terrain[key], undefined, `${key} n'a plus d'objet`);
  }

  // Les trois périodes de matière n'ont plus d'objet.
  for (const key of ['groundScaleGrass', 'groundScaleSoil', 'groundScaleWood']) {
    assert.ok(!(key in defaultTheme.terrain), `${key} doit avoir disparu du thème`);
  }
});

test('la frange déplace la lecture du sol, sans dépendre du parcours ni sortir de sa portée', () => {
  const reach = defaultTheme.terrain.edgeWarpM;
  assert.ok(reach > 0 && reach <= 3, 'au-delà de trois mètres, un bord droit ondule');

  // Déterminisme spatial : la même maille lit toujours le même point, quel que
  // soit l'ordre dans lequel on la rencontre.
  const first = fringeOffset(12, -7, 0, reach);
  assert.deepEqual(fringeOffset(12, -7, 0, reach), first);

  // Bornée : une touffe ne peut pas emprunter le sol d'une parcelle lointaine.
  let outside = 0;
  let sumRadius = 0;
  const samples = 400;
  for (let i = 0; i < samples; i++) {
    const offset = fringeOffset(i, i * 3 - 11, i % 3, reach);
    const radius = Math.hypot(offset.x, offset.z);
    if (radius > reach + 1e-9) outside++;
    sumRadius += radius;
  }
  assert.equal(outside, 0, 'aucun décalage au-delà de la portée');
  // Tirage en surface (racine du rayon) : la moyenne d'un disque uniforme vaut
  // deux tiers du rayon. Sans la racine, elle vaudrait la moitié — la frange
  // serait plus étroite qu'annoncée.
  assert.ok(
    Math.abs(sumRadius / samples - (2 / 3) * reach) < 0.15 * reach,
    `rayon moyen ${(sumRadius / samples).toFixed(2)} m, attendu ~${((2 / 3) * reach).toFixed(2)} m`
  );

  // Deux mailles voisines ne lisent pas le même point : c'est ce qui brouille
  // la limite au lieu de la déplacer en bloc.
  const a = fringeOffset(4, 4, 0, reach);
  const b = fringeOffset(5, 4, 0, reach);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.2, 'des voisines tirent des décalages distincts');

  // Portée nulle : aucun décalage (un thème peut éteindre la frange).
  assert.deepEqual(fringeOffset(3, 9, 1, 0), { x: 0, z: 0 });
});

// --- Lot F : le marquage est de la géométrie ---------------------------------

test('la texture de chaussée ne porte plus une seule ligne', () => {
  // Le marquage peint dans la texture ne pouvait ni s'arrêter à une bouche de
  // carrefour, ni exister sur une surface de carrefour. La preuve qu'il n'y
  // est plus : les deux drapeaux du thème ne changent plus rien au dessin.
  const paint = (profile) => {
    const rects = [];
    const previous = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        Object.assign(this, { width, height });
      }
      getContext() {
        const ctx = paintingCanvasContext();
        ctx.fillRect = function fillRect(x, y, w, h) {
          rects.push({ x, y, w, h, style: this.fillStyle });
        };
        return ctx;
      }
    };
    try {
      createRoadCanvas(profile);
    } finally {
      if (previous) globalThis.OffscreenCanvas = previous;
      else delete globalThis.OffscreenCanvas;
    }
    return rects;
  };

  const base = { width: 8.5, shoulder: 0, texture: 128 };
  const marked = paint({ ...base, edgeLines: true, centerDash: true });
  assert.deepEqual(marked, paint(base), 'les drapeaux de marquage sont inertes');
  // Et rien de clair n'y est peint : une ligne se voit à sa couleur.
  for (const rect of marked) {
    assert.ok(!/2[0-9]{2},/.test(String(rect.style)), `couleur claire posée : ${rect.style}`);
  }

  // Elle ne tire plus rien au hasard non plus : son grain — un bruit par pixel,
  // d'amplitude propre à chaque revêtement — est parti avec celui du sol. D'où
  // la disparition de la graine, et de celles que chaque profil portait pour
  // que deux chaussées voisines n'aient pas le même.
  for (const surface of Object.values(defaultTheme.roads.surfaces)) {
    assert.equal(surface.grain, undefined, 'un revêtement est une couleur');
  }
  // Le thème est passé en **deuxième** argument, à la place qu'occupait la
  // graine : un appel resté à trois arguments peindrait la route en gris de
  // repli sans que rien ne le signale.
  const roads = { ...defaultTheme.roads, surfaces: { asphalt: { base: '#123456' } } };
  const previousCanvas = globalThis.OffscreenCanvas;
  const styles = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      Object.assign(this, { width, height });
    }
    getContext() {
      const ctx = paintingCanvasContext();
      ctx.fillRect = function fillRect() {
        styles.push(this.fillStyle);
      };
      return ctx;
    }
  };
  try {
    createRoadCanvas({ width: 6, texture: 64 }, roads);
  } finally {
    if (previousCanvas) globalThis.OffscreenCanvas = previousCanvas;
    else delete globalThis.OffscreenCanvas;
  }
  assert.ok(styles.includes('#123456'), 'le thème est lu au deuxième argument');
});

test('les lignes d’une chaussée se lisent dans son profil, et nulle part ailleurs', () => {
  // Une voie rapide : deux rives et un axe. Les rives se posent en deçà de
  // l'accotement, qui n'est pas de la chaussée.
  const express = markingLinesFor({ width: 12, shoulder: 1.2, edgeLines: true, centerDash: true }, 6);
  assert.equal(express.length, 3);
  const axis = express.filter((line) => line.offset === 0);
  assert.equal(axis.length, 1);
  assert.equal(axis[0].dash, MARKING_DASH_M, 'l’axe est discontinu');
  const edges = express.filter((line) => line.offset !== 0).map((line) => line.offset);
  assert.equal(edges.length, 2);
  assert.ok(Math.abs(edges[0] + edges[1]) < 1e-9, 'les deux rives sont symétriques');
  assert.ok(Math.abs(Math.abs(edges[0]) - (6 - 1.2 - 0.35 - MARKING_WIDTH_M / 2)) < 1e-9);
  for (const line of express) assert.ok(Math.abs(line.offset) < 6, 'aucune ligne au-delà de la rive');

  // Une petite route : ses rives, pas d'axe.
  const minor = markingLinesFor({ width: 5, shoulder: 0, edgeLines: true, centerDash: false }, 2.5);
  assert.equal(minor.length, 2);
  assert.ok(minor.every((line) => line.dash === 0));

  // Une desserte : rien du tout. Un marquage ne s'invente pas.
  assert.deepEqual(markingLinesFor({ width: 3.6, shoulder: 0 }, 1.8), []);

  // Un accotement qui mange toute la largeur ne laisse pas de rive à marquer.
  assert.deepEqual(markingLinesFor({ width: 3, shoulder: 1.4, edgeLines: true }, 1.5), []);
});

test('un trait discontinu tombe aux mêmes mètres, quel que soit le découpage', () => {
  // C'est l'invariant de déterminisme : la phase se compte depuis l'ancre de
  // graphe de la chaîne, pas depuis le début du morceau dessiné.
  const road = straightRoad(0, 2.5);
  const lay = (from) => {
    const buffer = createProfileBuffer();
    const origin = road.path[from].distance;
    appendMarkingLine(buffer, {
      path: road.path.slice(from).map((p) => ({ x: p.x, z: p.z, distance: p.distance - origin })),
      decks: road.platform.slice(from),
      offset: 0,
      color: [1, 1, 1],
      dash: MARKING_DASH_M,
      startDistance: origin,
    });
    // Les abscisses x couvertes par de la peinture, arrondies au décimètre.
    const painted = new Set();
    for (let i = 0; i < buffer.positions.length; i += 3) {
      painted.add(Math.round(buffer.positions[i] * 10));
    }
    return painted;
  };

  const whole = lay(0);
  const cut = lay(10);
  assert.ok(cut.size > 4, 'le morceau porte bien des traits');
  for (const x of cut) assert.ok(whole.has(x), `le découpage a déplacé un trait en x=${x / 10}`);

  // Et la phase est bien celle du cycle de six mètres : un trait sur deux.
  const buffer = createProfileBuffer();
  const laid = appendMarkingLine(buffer, {
    path: road.path,
    decks: road.platform,
    offset: 0,
    color: [1, 1, 1],
    dash: MARKING_DASH_M,
  });
  assert.ok(laid > 0);
  for (let i = 0; i < buffer.positions.length; i += 3) {
    const along = buffer.positions[i] + 100; // la droite part de x = -100
    const k = Math.floor((along + 1e-6) / MARKING_DASH_M);
    assert.ok(k % 2 === 0 || Math.abs(along % MARKING_DASH_M) < 1e-6, `peinture à ${along} m`);
  }
});

test('une ligne continue reste dans sa largeur et suit la plate-forme', () => {
  const road = straightRoad(0, 2.5);
  for (let r = 0; r < road.platform.length; r++) road.platform[r] = r * 0.1;
  const buffer = createProfileBuffer();
  const laid = appendMarkingLine(buffer, {
    path: road.path,
    decks: road.platform,
    frames: road.frames,
    offset: 2,
    color: [1, 1, 1],
    lift: 0.5,
  });
  assert.equal(laid, road.path.length - 1, 'un quadrilatère par intervalle');

  // La route va vers +x, donc la perpendiculaire gauche vaut (0, -1) : un
  // décalage de +2 se lit en z = -2.
  for (let i = 0; i < buffer.positions.length; i += 3) {
    const z = buffer.positions[i + 2];
    assert.ok(Math.abs(z + 2) <= MARKING_WIDTH_M / 2 + 1e-9, `trait sorti de sa largeur : ${z}`);
    // Et il monte avec la plate-forme, décollement compris.
    const expected = ((buffer.positions[i] + 100) / 5) * 0.1 + 0.5;
    assert.ok(Math.abs(buffer.positions[i + 1] - expected) < 1e-6);
  }
});

test('une section se prend à l’abscisse voulue, ou nulle part', () => {
  const road = straightRoad(0, 2.5);
  for (let r = 0; r < road.platform.length; r++) road.platform[r] = r;

  const at = sectionAtDistance(road.path, road.platform, road.frames, 12.5);
  assert.ok(at);
  assert.ok(Math.abs(at.x - (-100 + 12.5)) < 1e-6);
  assert.ok(Math.abs(at.deck - 2.5) < 1e-6, 'la cote est interpolée, pas arrondie à la ligne');

  // Hors de la plage : rien. Une ligne d'effet ne se pose pas au jugé.
  assert.equal(sectionAtDistance(road.path, road.platform, road.frames, -1), null);
  assert.equal(sectionAtDistance(road.path, road.platform, road.frames, 1e4), null);
});

test('une traversée n’est faite que de ses bandes peintes', () => {
  const near = { x: 0, z: 0, deck: 0, px: 0, pz: -1 };
  const far = { x: MOUTH_CROSSING_M, z: 0, deck: 0, px: 0, pz: -1 };
  const buffer = createProfileBuffer();
  const bands = appendCrossing(buffer, { near, far, halfWidth: 2.5, color: [1, 1, 1] });

  // Une bande peinte, un vide, sur toute la largeur : le vide est le bitume,
  // il n'est pas maillé.
  assert.ok(bands >= 2, `deux bandes au moins sur cinq mètres, vu ${bands}`);
  assert.equal(buffer.positions.length / 3, bands * 4);
  const painted = bands * MARKING_BAR_M;
  assert.ok(painted < 5, 'moins de peinture que de chaussée');

  // Rien ne déborde de la chaussée, ni en travers ni le long.
  for (let i = 0; i < buffer.positions.length; i += 3) {
    assert.ok(Math.abs(buffer.positions[i + 2]) <= 2.5 + 1e-9);
    assert.ok(buffer.positions[i] >= -1e-9 && buffer.positions[i] <= MOUTH_CROSSING_M + 1e-9);
  }

  // Le rang d'une bande se tire de l'axe de la chaussée : arriver par l'autre
  // bout ne déplace pas les bandes.
  const back = createProfileBuffer();
  appendCrossing(back, { near: far, far: near, halfWidth: 2.5, color: [1, 1, 1] });
  const lateral = (buf) => {
    const set = new Set();
    for (let i = 0; i < buf.positions.length; i += 3) set.add(Math.round(buf.positions[i + 2] * 1e6));
    return [...set].sort((a, b) => a - b);
  };
  assert.deepEqual(lateral(back), lateral(buffer));
});

test('une ligne d’effet ne couvre que la voie qui arrive', () => {
  const near = { x: 0, z: 0, deck: 0, px: 0, pz: -1 };
  const far = { x: MARKING_BAR_M, z: 0, deck: 0, px: 0, pz: -1 };
  const buffer = createProfileBuffer();
  // Décalages négatifs : la droite du conducteur qui marche vers +x.
  assert.equal(appendMarkingBar(buffer, { near, far, from: -2.5, to: 0, color: [1, 1, 1] }), 1);
  for (let i = 0; i < buffer.positions.length; i += 3) {
    const z = buffer.positions[i + 2];
    assert.ok(z >= -1e-9 && z <= 2.5 + 1e-9, `la ligne déborde sur l’autre voie : ${z}`);
  }
  // Une largeur nulle ne pose rien : mieux vaut pas de ligne qu'une ligne plate.
  assert.equal(appendMarkingBar(buffer, { near, far, from: 1, to: 1, color: [1, 1, 1] }), 0);
});

test('la ligne d’effet se pose sur la voie qui arrive, pas sur celle qui repart', () => {
  // La convention du projet met la gauche de la marche du tracé dans les
  // décalages positifs — c'est pour ça que tout le mobilier de bord de route
  // est posé à décalage négatif, « à droite ». Le conducteur, lui, ne marche
  // dans le sens du tracé qu'à l'un des deux bouts.
  assert.deepEqual(approachLane(2.5, false), { from: -2.5, to: 0 }, 'à la queue, il suit le tracé');
  assert.deepEqual(approachLane(2.5, true), { from: 0, to: 2.5 }, 'à la tête, il le remonte');

  // Les deux voies d'une même chaussée : disjointes, et elles la couvrent.
  const head = approachLane(2.5, true);
  const tail = approachLane(2.5, false);
  assert.equal(head.from, tail.to, 'les deux voies se touchent à l’axe');
  assert.equal(head.to - tail.from, 5, 'et remplissent la chaussée');
});

test('on cède le passage à plus large que soi, et à personne d’autre', () => {
  const area = { halfWidth: 4.25 };
  assert.equal(branchYields(area, 2.5), true, 'une petite route cède à une grande');
  assert.equal(branchYields(area, 4.25), false, 'deux voies identiques ne cèdent ni l’une ni l’autre');
  assert.equal(branchYields(area, 6), false, 'la plus large ne cède pas');
  // Sans donnée, aucune priorité inventée.
  assert.equal(branchYields(null, 2.5), false);
  assert.equal(branchYields({ halfWidth: 0 }, 2.5), false);
});

test('un morceau de ruban sait par quel carrefour chacun de ses bouts est borné', () => {
  // Sans cela, la ligne d'effet ne saurait pas de quel carrefour elle dépend,
  // et devrait redécouvrir seule ce que le découpage vient de faire.
  const branches = [
    { x: 1, z: 0, halfWidth: 2.5, profile: 'minor' },
    { x: -1, z: 0, halfWidth: 2.5, profile: 'minor' },
    { x: 0, z: 1, halfWidth: 1.8, profile: 'lane' },
  ];
  const area = junctionArea({ x: 0, z: 0, degree: 3, halfWidth: 2.5, profile: 'minor', branches });
  assert.ok(area);
  const areas = new JunctionAreas([{ x: 0, z: 0, degree: 3, halfWidth: 2.5, profile: 'minor', branches }]);

  const road = straightRoad(0, 2.5);
  road.junction = markJunctionRows(road, areas);
  const runs = junctionRibbonRuns(road, areas, [{ from: 0, to: road.path.length - 1 }]);
  assert.equal(runs.length, 2, 'la chaussée est coupée en deux par le carrefour');
  // Le bout libre est en dehors du réseau, le bout qui bute porte le rang.
  assert.equal(runs[0].head, -1);
  assert.equal(runs[0].tail, 0);
  assert.equal(runs[1].head, 0);
  assert.equal(runs[1].tail, -1);
});

test('le marquage d’une plage sort du profil, du carrefour, et de rien d’autre', () => {
  // Le câblage complet, sans three : `_appendMarkings` ne lit que le thème.
  const lay = (segment, run, areas) => {
    const buffer = createProfileBuffer();
    const laid = RoadNetwork.prototype._appendMarkings.call(
      { theme: defaultTheme },
      buffer,
      segment,
      run,
      areas,
      [1, 1, 1]
    );
    return { buffer, laid };
  };

  const road = straightRoad(0, 2.5); // `minor` : deux rives, pas d'axe
  const free = { path: road.path, platform: road.platform, head: -1, tail: -1 };
  const areas = { areas: [{ halfWidth: 4.25 }] };

  // Plage libre des deux bouts : les deux rives, et rien en travers.
  const plain = lay(road, free, areas);
  assert.equal(plain.laid, 2 * (road.path.length - 1), 'deux rives continues');

  // Même plage, mais butant sur un carrefour plus large : la ligne d'effet
  // s'ajoute, une seule fois, au bout qui bute.
  const stopped = lay(road, { ...free, tail: 0 }, areas);
  assert.equal(stopped.laid, plain.laid + 1);

  // Elle est posée en deçà de la bouche, au-delà de la place réservée à une
  // traversée, et sur la seule voie qui arrive.
  const bar = stopped.buffer.positions.slice(-12);
  for (let i = 0; i < 12; i += 3) {
    assert.ok(bar[i + 2] >= -1e-9 && bar[i + 2] <= 2.5 + 1e-9, `voie d’en face : ${bar[i + 2]}`);
    const back = 100 - bar[i]; // la droite finit en x = 100
    assert.ok(
      back >= MOUTH_CROSSING_M - 1e-6 && back <= MOUTH_CROSSING_M + MARKING_BAR_M + 1e-6,
      `ligne d’effet à ${back} m de la bouche`
    );
  }

  // Une branche aussi large que le carrefour ne cède pas : aucune ligne d'effet.
  assert.equal(lay(road, { ...free, tail: 0 }, { areas: [{ halfWidth: 2.5 }] }).laid, plain.laid);

  // Un chemin de terre ne porte aucun marquage, où qu'il aboutisse.
  const track = straightRoad(0, 1.5);
  track.profile = 'track';
  assert.equal(lay(track, { ...free, tail: 0 }, areas).laid, 0);
});

test('une traversée se peint là où un trottoir arrive des deux côtés, et pas ailleurs', () => {
  // Une traversée ne se pose pas parce qu'un carrefour existe : elle se pose
  // là où un piéton a un trottoir de départ **et** un trottoir d'arrivée.
  const junction = {
    x: 0,
    z: 0,
    degree: 3,
    halfWidth: 2.5,
    profile: 'minor',
    branches: [
      { x: 1, z: 0, halfWidth: 2.5, profile: 'minor' },
      { x: -1, z: 0, halfWidth: 2.5, profile: 'minor' },
      { x: 0, z: 1, halfWidth: 1.8, profile: 'lane' },
    ],
  };
  const areas = new JunctionAreas([junction]);
  const road = straightRoad(0, 2.5);
  road.junction = markJunctionRows(road, areas);

  // La dernière ligne hors du carrefour, en venant de l'ouest.
  let keep = 0;
  while (road.junction[keep + 1] < 0) keep++;
  const run = Array.from({ length: keep + 1 }, (_, r) => ({ r }));

  const paint = (sides) => {
    const mouths = new Map();
    for (const side of sides) StreetLayer._noteMouths(mouths, road, run, side, areas);
    const buffer = createProfileBuffer();
    const painted = StreetLayer.prototype._buildCrossings.call(
      { theme: defaultTheme },
      buffer,
      mouths,
      areas
    );
    return { painted, buffer };
  };

  // Un seul trottoir : rien. C'est un trottoir qui s'arrête devant un
  // carrefour, pas une traversée.
  assert.equal(paint([1]).painted, 0);
  assert.equal(paint([-1]).painted, 0);

  const both = paint([1, -1]);
  assert.equal(both.painted, 1);
  assert.ok(both.buffer.positions.length > 0, 'et elle a des bandes');

  // Elle tient dans la chaussée, et dans la profondeur que la chaussée lui a
  // réservée à la bouche — celle en deçà de laquelle la ligne d'effet se pose.
  const mouth = junctionBoundaryAt(road, areas, keep, keep + 1);
  assert.ok(mouth);
  for (let i = 0; i < both.buffer.positions.length; i += 3) {
    assert.ok(Math.abs(both.buffer.positions[i + 2]) <= 2.5 + 1e-6);
    const back = mouth.point.x - both.buffer.positions[i];
    assert.ok(back >= -1e-6 && back <= MOUTH_CROSSING_M + 1e-6, `bande à ${back} m de la bouche`);
  }
});

test('un panneau de priorité se pose à la bouche qui cède, et à aucune autre', () => {
  // Le lot : un panneau n'est plus tiré au sort parce qu'une intersection
  // existe. Deux `minor` de même largeur et une desserte : seule la desserte
  // cède, donc un seul panneau.
  const junction = {
    x: 0,
    z: 0,
    degree: 3,
    halfWidth: 2.5,
    profile: 'minor',
    branches: [
      { x: 1, z: 0, halfWidth: 2.5, profile: 'minor' },
      { x: -1, z: 0, halfWidth: 2.5, profile: 'minor' },
      { x: 0, z: 1, halfWidth: 1.8, profile: 'lane' },
    ],
  };
  const areas = new JunctionAreas([junction]);
  const roadIndex = new RoadIndex([straightRoad(0, 2.5)]);

  const post = (signalled) => {
    const placed = [];
    FurnitureLayer.prototype._buildJunctionSigns.call(
      {
        _signalled: signalled,
        _place: (_placements, item, at) => {
          placed.push({ item, ...at });
          return at;
        },
      },
      { placements: new Map(), here: { x: 0, z: 0 } },
      areas,
      roadIndex,
      []
    );
    return placed;
  };

  const signs = post([]);
  assert.equal(signs.length, 1, 'une seule branche cède');
  assert.equal(signs[0].item, 'signYield');

  // Posé au-delà de la bouche, à hauteur de la ligne d'effet, et à droite du
  // conducteur qui arrive — la desserte descend vers le carrefour depuis +z,
  // sa droite est donc +x.
  const mouth = areas.areas[0].mouths.find((m) => m.profile === 'lane');
  assert.ok(mouth);
  assert.ok(signs[0].x > 0, 'à droite de qui arrive');
  assert.ok(
    signs[0].z > mouth.distance && signs[0].z < mouth.distance + MOUTH_CROSSING_M + MARKING_BAR_M,
    `posé à z = ${signs[0].z}, bouche à ${mouth.distance}`
  );

  // Un carrefour à feux ne porte pas de cédez-le-passage : c'est le feu qui
  // règle l'accès.
  assert.equal(post([{ x: 0, z: 0 }]).length, 0);

  // Et un carrefour de deux voies identiques n'en porte aucun.
  const even = new JunctionAreas([
    {
      ...junction,
      branches: junction.branches.map((b) => ({ ...b, halfWidth: 2.5, profile: 'minor' })),
    },
  ]);
  const placed = [];
  FurnitureLayer.prototype._buildJunctionSigns.call(
    { _signalled: [], _place: (_p, item, at) => placed.push({ item, ...at }) },
    { placements: new Map(), here: { x: 0, z: 0 } },
    even,
    roadIndex,
    []
  );
  assert.equal(placed.length, 0);
});

test('le marquage regarde le ciel, sur les deux rives et dans les deux sens', () => {
  // Le sens de parcours *est* l'orientation de la face : l'ordre naturel des
  // quatre sommets d'un quadrilatère donne une face tournée vers le sol, donc
  // noire. Ce test la mesure au lieu de la supposer.
  const up = (buffer) => {
    let worst = Infinity;
    for (let i = 0; i < buffer.indices.length; i += 3) {
      const at = (k) => {
        const v = buffer.indices[i + k] * 3;
        return [buffer.positions[v], buffer.positions[v + 1], buffer.positions[v + 2]];
      };
      const [a, b, c] = [at(0), at(1), at(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      // Composante verticale du produit vectoriel : positive = face au ciel.
      worst = Math.min(worst, u[2] * v[0] - u[0] * v[2]);
    }
    return worst;
  };

  const road = straightRoad(0, 2.5);
  for (const offset of [2, -2, 0]) {
    const buffer = createProfileBuffer();
    appendMarkingLine(buffer, {
      path: road.path,
      decks: road.platform,
      frames: road.frames,
      offset,
      color: [1, 1, 1],
    });
    assert.ok(up(buffer) > 0, `ligne à ${offset} m retournée`);
  }

  // Une route qui marche dans l'autre sens : les repères tournent avec elle,
  // donc l'orientation ne bouge pas.
  const back = fakeRoad(
    Array.from({ length: 21 }, (_, i) => ({ x: 100 - i * 5, z: 0 })),
    2.5
  );
  const reversed = createProfileBuffer();
  appendMarkingLine(reversed, {
    path: back.path,
    decks: back.platform,
    frames: back.frames,
    offset: 2,
    color: [1, 1, 1],
  });
  assert.ok(up(reversed) > 0, 'ligne retournée sur une route à contre-sens');

  // La traversée et la ligne d'effet, qui empruntent le même quadrilatère.
  const near = { x: 0, z: 0, deck: 0, px: 0, pz: -1 };
  const far = { x: MOUTH_CROSSING_M, z: 0, deck: 0, px: 0, pz: -1 };
  const crossing = createProfileBuffer();
  appendCrossing(crossing, { near, far, halfWidth: 2.5, color: [1, 1, 1] });
  assert.ok(up(crossing) > 0, 'traversée retournée');

  const bar = createProfileBuffer();
  appendMarkingBar(bar, { near, far, from: -2.5, to: 0, color: [1, 1, 1] });
  assert.ok(up(bar) > 0, 'ligne d’effet retournée');
  const other = createProfileBuffer();
  appendMarkingBar(other, { near, far, from: 0, to: 2.5, color: [1, 1, 1] });
  assert.ok(up(other) > 0, 'ligne d’effet retournée sur l’autre voie');
});

// --- La ville : ce qu'on n'y dessine pas, et ce qu'on y peint ------------------

test('isPedestrianWay reconnaît le trottoir relevé et laisse le sentier tranquille', () => {
  assert.equal(isPedestrianWay({ class: 'pedestrian' }), true, 'une aire piétonne');
  assert.equal(isPedestrianWay({ class: 'path', subclass: 'footway' }), true);
  assert.equal(isPedestrianWay({ class: 'path', subclass: 'sidewalk' }), true);
  assert.equal(isPedestrianWay({ class: 'path', subclass: 'crossing' }), true);

  // Le sentier de campagne n'a pas de sous-classe piétonne : c'est un objet du
  // paysage, pas une redondance de saisie.
  assert.equal(isPedestrianWay({ class: 'path' }), false, 'un sentier reste un sentier');
  assert.equal(isPedestrianWay({ class: 'path', subclass: 'track' }), false);
  assert.equal(isPedestrianWay({ class: 'cycleway' }), false);
  // Un cheminement ouvert au vélo est une piste : on veut la voir.
  assert.equal(
    isPedestrianWay({ class: 'path', subclass: 'footway', bicycle: 'designated' }),
    false,
    'un cheminement cyclable n’est pas une voie piétonne'
  );
  assert.equal(isPedestrianWay({ class: 'residential' }), false);
  assert.equal(isPedestrianWay({}), false);
});

test('UrbanMask : un disque de ville, une emprise bâtie, et le vert retiré', () => {
  const square = (cx, cz, half) => [
    { x: cx - half, z: cz - half },
    { x: cx + half, z: cz - half },
    { x: cx + half, z: cz + half },
    { x: cx - half, z: cz + half },
  ];

  const mask = new UrbanMask({
    builtUp: [square(0, 0, 500)],
    greens: [square(200, 200, 60)],
    places: [{ x: 0, z: 0, class: 'town' }],
  });

  assert.equal(mask.any, true);
  assert.equal(mask.covers(100, 100), true, 'bâti, à portée du bourg');
  assert.equal(mask.covers(200, 200), false, 'le parc reste un parc');
  assert.equal(mask.covers(2000, 0), false, 'hors emprise bâtie');

  // Un village ne fait pas une ville : sans `city`/`town`, le masque ne couvre
  // rien, et tout le décor retombe sur son comportement de campagne.
  const village = new UrbanMask({
    builtUp: [square(0, 0, 500)],
    places: [{ x: 0, z: 0, class: 'village' }],
  });
  assert.equal(village.any, false);
  assert.equal(village.covers(0, 0), false);

  // Et le disque borne bien la portée du point nommé.
  assert.ok(URBAN_PLACE_RADIUS_M.city > URBAN_PLACE_RADIUS_M.town);
  assert.equal(URBAN_PLACE_RADIUS_M.village, undefined, 'un village n’a pas de portée urbaine');
  assert.equal(new UrbanMask().covers(0, 0), false, 'sans rien, personne n’est en ville');
});

test('collectUrbanGreens relève le vert urbain des deux couches source', () => {
  const ring = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
    [0, 0],
  ];
  const features = {
    landuse: [
      [{ type: 'Polygon', coordinates: [ring] }, { class: 'cemetery' }],
      [{ type: 'Polygon', coordinates: [ring] }, { class: 'residential' }],
    ],
    landcover: [[{ type: 'Polygon', coordinates: [ring] }, { class: 'grass' }]],
  };
  const source = {
    forEachFeature(layer, tiles, visit) {
      for (const [geometry, properties] of features[layer] || []) visit(geometry, properties);
    },
  };
  const frame = { origin: { x: 0, y: 0 }, scale: 1000, zoom: 14 };

  // Le cimetière et le parc, pas le quartier d'habitation.
  assert.equal(collectUrbanGreens(source, [{ x: 0, y: 0 }], frame).length, 2);
  assert.equal(collectUrbanGreens(null, [], null).length, 0, 'sans source, aucun vert');
  assert.ok(URBAN_GREEN_LANDUSE.has('cemetery') && URBAN_GREEN_LANDUSE.has('stadium'));
  assert.equal(URBAN_GREEN_LANDUSE.has('residential'), false);
});

test('absorbParallelLines écarte la desserte qui double une avenue, et rien d’autre', () => {
  const along = (offset, profile, halfWidth) => ({
    profile,
    halfWidth,
    level: 0,
    points: Array.from({ length: 21 }, (_, i) => ({ x: i * 10, z: offset })),
  });

  const avenue = along(0, 'major', 4.25);
  // Rives à 4,25 + 1,8 = 6,05 m d'écart d'axe : moins d'un mètre de vide.
  const service = along(7, 'lane', 1.8);
  // Une piste cyclable au même endroit : on veut la voir, elle n'est pas absorbée.
  const cycle = { ...along(7, 'cycleway', 1.1) };
  // Une rue perpendiculaire : elle passe près, elle ne longe pas.
  const cross = {
    profile: 'lane',
    halfWidth: 1.8,
    level: 0,
    points: Array.from({ length: 21 }, (_, i) => ({ x: 100, z: -100 + i * 10 })),
  };

  const kept = absorbParallelLines([avenue, service, cycle, cross], {
    order: ROAD_PROFILE_ORDER,
  });
  assert.ok(kept.includes(avenue), 'l’avenue reste');
  assert.ok(!kept.includes(service), 'la desserte est dans la largeur de l’avenue');
  assert.ok(kept.includes(cycle), 'la piste cyclable n’est jamais absorbée');
  assert.ok(kept.includes(cross), 'une transversale ne longe rien');

  // Le niveau tranche avant la distance : une voie qui passe dessous ne longe pas.
  const under = { ...along(7, 'lane', 1.8), level: -1 };
  assert.ok(
    absorbParallelLines([avenue, under], { order: ROAD_PROFILE_ORDER }).includes(under),
    'un passage inférieur n’est pas un longement'
  );

  // Écartée du champ d'application, la desserte revient.
  assert.ok(
    absorbParallelLines([avenue, service], {
      order: ROAD_PROFILE_ORDER,
      where: () => false,
    }).includes(service),
    'hors ville, on n’absorbe rien'
  );

  // Et trop loin, ce sont deux rues.
  const apart = along(6 + ABSORB_GAP_M + 4.25 + 1.8, 'lane', 1.8);
  assert.ok(
    absorbParallelLines([avenue, apart], { order: ROAD_PROFILE_ORDER }).includes(apart),
    'au-delà de l’écart, deux rues parallèles sont deux rues'
  );

  assert.deepEqual(absorbParallelLines([], { order: ROAD_PROFILE_ORDER }), []);
});

test('une couture entre deux chaussées jumelles se comble en plein, pas en zébra', () => {
  const gap = {
    a: { profile: 'major' },
    other: { profile: 'major' },
    pairs: [
      { near: { x: 0, z: 0, deck: 10, distance: 0 }, far: { x: 0, z: 2, deck: 10 } },
      { near: { x: 10, z: 0, deck: 10, distance: 10 }, far: { x: 10, z: 2, deck: 10 } },
    ],
  };
  assert.equal(gapIsSeam(gap), true);
  assert.equal(gapIsSeam({ ...gap, other: { profile: 'cycleway' } }), false, 'un îlot n’est pas une couture');
  assert.equal(gapIsSeam(null), false);

  const buffer = createProfileBuffer();
  const laid = appendGapSurface(buffer, gap, { color: [0.2, 0.2, 0.2], lift: 0.01 });
  assert.equal(laid, 1, 'un quadrilatère par couple de sections');
  assert.equal(buffer.positions.length / 3, 4);
  assert.equal(buffer.indices.length, 6);

  // Une seule couleur : c'est du revêtement, pas des hachures. Le zébra, lui,
  // en pose deux, et bien plus de bandes sur la même longueur.
  const colors = new Set();
  for (let i = 0; i < buffer.colors.length; i += 3) colors.add(buffer.colors.slice(i, i + 3).join(','));
  assert.equal(colors.size, 1);

  const hatched = createProfileBuffer();
  const bands = appendZebra(hatched, gap, { paint: [1, 1, 1], ground: [0.2, 0.2, 0.2] });
  assert.ok(bands > laid, 'le zébra découpe, le comblement plein non');
});

test('le pictogramme cycliste : un dessin fermé, posé en phase avec la chaîne', () => {
  const glyph = cycleGlyph();
  assert.ok(glyph.length > 20, 'deux roues et un cadre');

  // Tous les polygones tournent dans le **même** sens, et c'est ce qui décide
  // de la face : `appendMarkingGlyph` les retourne en éventail, un polygone à
  // l'envers rend une face tournée vers le sol, donc noire. Un test possible
  // sans les yeux, sur exactement le défaut qu'on ne verrait qu'à l'écran.
  const shoelace = (polygon) => {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      sum += a.along * b.across - b.along * a.across;
    }
    return sum;
  };
  for (const polygon of glyph) {
    assert.ok(polygon.length >= 3, 'aucun polygone dégénéré');
    assert.ok(shoelace(polygon) < 0, 'tous les polygones tournent dans le sens horaire');
  }
  assert.ok(shoelace(glyphBar({ along: 0, across: 0 }, { along: 1, across: 0 })) < 0);
  // Il tient dans la largeur d'une piste (2,20 m) et fait la longueur d'un vélo.
  const alongs = glyph.flat().map((v) => v.along);
  const acrosses = glyph.flat().map((v) => v.across);
  const length = Math.max(...alongs) - Math.min(...alongs);
  const width = Math.max(...acrosses) - Math.min(...acrosses);
  assert.ok(length > 1.3 && length < 1.9, `longueur du vélo : ${length}`);
  assert.ok(width < 2.2, `largeur du vélo : ${width}`);

  assert.equal(glyphBar({ along: 0, across: 0 }, { along: 0, across: 0 }).length, 0, 'un trait nul n’en est pas un');
  assert.equal(glyphRing(0, 0, 0.3, 0.07, 8).length, 8, 'une facette par côté');

  // Posé le long d'une chaussée droite de cent mètres : un vélo tous les
  // `MARKING_SYMBOL_SPACING_M`, aux multiples de l'abscisse de la chaîne.
  const path = Array.from({ length: 21 }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 }));
  const decks = new Float32Array(path.length).fill(12);
  const buffer = createProfileBuffer();
  const laid = appendMarkingSymbols(buffer, {
    path,
    decks,
    polygons: glyph,
    color: [1, 1, 1],
    startDistance: 0,
  });
  // Les multiples de l'espacement dans la plage — sauf celui de l'origine, où
  // la moitié arrière du vélo tomberait avant le début de la chaussée.
  assert.equal(laid, Math.floor(100 / MARKING_SYMBOL_SPACING_M));
  assert.ok(buffer.positions.length > 0);

  // La phase suit la chaîne, pas le découpage : décaler l'ancre décale les vélos.
  const shifted = createProfileBuffer();
  appendMarkingSymbols(shifted, {
    path,
    decks,
    polygons: glyph,
    color: [1, 1, 1],
    startDistance: MARKING_SYMBOL_SPACING_M / 2,
  });
  assert.notEqual(shifted.positions[0], buffer.positions[0], 'la phase a bougé avec l’ancre');

  // Une plage trop courte pour un vélo entier n'en porte aucun : mieux vaut
  // rien qu'un demi-vélo au bord d'un carrefour.
  const stub = [
    { x: 0, z: 0, distance: 0 },
    { x: 0.4, z: 0, distance: 0.4 },
  ];
  const nothing = createProfileBuffer();
  appendMarkingSymbols(nothing, {
    path: stub,
    decks: new Float32Array([12, 12]),
    polygons: glyph,
    color: [1, 1, 1],
    spacing: 0.2,
  });
  assert.equal(nothing.positions.length, 0);
});

test('le revêtement urbain : une matière qui tient dans le canal, et une seule teinte pour deux lectures', () => {
  // Les matières à leur pas doivent tenir dans un octet, sans quoi le dernier
  // identifiant serait écrêté et lu comme un autre.
  assert.ok(SURFACE_KINDS.length * SURFACE_ID_STEP <= 255, 'les identifiants tiennent dans le canal');
  assert.equal(SURFACE_KINDS[PAVEMENT_ID - 1], 'pavement');

  // La teinte du sol de la ville et celle du dessus de trottoir sont la même
  // valeur : deux lectures divergentes se verraient là où elles se rejoignent.
  const tone = pavementTone('mediterranean');
  assert.deepEqual(streetSurfaceAt(0, 0, undefined, 'mediterranean').walk, tone);
  assert.notDeepEqual(pavementTone('boreal'), tone, 'le pays change le revêtement');
  assert.deepEqual(pavementTone('inconnu'), pavementTone(null), 'un climat non décrit retombe sur le défaut');

  // Le rebord, lui, reste tiré du bourg : deux mailles éloignées ne donnent pas
  // forcément la même bordure, mais aucune ne donne le dessus.
  const here = streetSurfaceAt(0, 0, undefined, 'oceanic');
  assert.ok(Array.isArray(here.kerb) && here.kerb.length === 3);
  assert.ok(Array.isArray(here.joint) && Array.isArray(here.gutter));
});
