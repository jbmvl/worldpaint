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
  LABEL_BUILDING_PERSONALITY,
  LABEL_FURNITURE,
  LABEL_ROADS,
  LABEL_CROPS,
} from '../src/inspect/objectLabels.js';
import {
  resamplePath,
  smoothColumns,
  monotoneDownstream,
  createRibbonBuffer,
  appendRibbon,
  pathFrames,
  levelRow,
  createProfileBuffer,
  appendProfile,
  appendVariableWall,
} from '../src/layers/ribbonGeometry.js';
import {
  spacedAlongPath,
  isTileEdgeSegment,
  realBoundaryRuns,
  boundaryFurnitureFor,
  scatterFurnitureFor,
  herdFor,
  cropFor,
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
} from '../src/layers/furnitureKit.js';
import { tileBounds } from '../src/core/vectorTileSource.js';
import {
  roadStyleFor,
  roadLines,
  clipToRadius,
  roadLiftFor,
  anchorDistances,
  collectRoadLines,
  ROAD_PROFILE_ORDER,
  ROAD_LIFT_M,
} from '../src/layers/roadNetwork.js';
import {
  mergeRoadLines,
  trimAtJunctions,
  distanceToSegment,
  stitchPlatforms,
  RoadIndex,
  CombinedIndex,
  NODE_WELD_M,
  JUNCTION_OVERLAP_M,
  JUNCTION_MIN_RUN_M,
} from '../src/layers/roadGraph.js';
import {
  CORRIDOR_MARGIN_M,
  CORRIDOR_PROBE_M,
  CORRIDOR_PUSH_CLEARANCE_M,
  inCorridor,
  clipOutsideCorridor,
  filterOutsideCorridor,
  pushOutsideCorridor,
} from '../src/layers/roadCorridor.js';
import { fittedGardenMargin, gardenOutlineClear } from '../src/layers/gardenLayer.js';
import {
  grassCellRing,
  grassEdgeFade,
  fillGrassCell,
  GRASS_PER_CELL,
  GRASS_TUFT_STRIDE,
  GRASS_CELL_M,
} from '../src/layers/groundCover.js';
import { coveringTiles } from '../src/core/vectorTileSource.js';
import { tileableValueNoise, fractalNoise } from '../src/materials/proceduralTextures.js';
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
  treesForScore,
  forestTypeAt,
  variantsFor,
  understoryVariants,
  treeHeight,
  foliageTint,
  thinPlacements,
  FOREST_PATCH_M,
  WOOD_SCORE_MIN,
  WOOD_DENSITY_CURVE,
  EMERGENT_SHARE,
  CLUMP_TINT_M,
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
  coverGrassFor,
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
} from '../src/materials/proceduralTextures.js';
import {
  townPaletteAt,
  buildingStyleAt,
  roofShapeFor,
  TOWN_PATCH_M,
  isHouse,
  SHUTTER_SHARE,
  HOUSE_MAX_HEIGHT_M,
  HOUSE_MAX_AREA_M2,
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
} from '../src/layers/furnitureLayer.js';
import {
  HEDGE_STYLES,
  hedgeNearness,
  hedgeModulation,
  hedgeClumps,
  appendHedgeClump,
} from '../src/layers/hedgeGeometry.js';
import { TREE_ATLAS_OFFSETS, GRASS_VARIANTS } from '../src/materials/proceduralTextures.js';
import { snapToShadowTexels, sunDirection, SHADOW_RADIUS_M } from '../src/environment/shadowFrame.js';
import {
  waterwayStyleFor,
  isDrawableWater,
  waterPolygons,
  boundsIntersect,
  pointInPolygon,
  interiorSamples,
  lowQuantile,
  waterSurfaceLevel,
  waterwayProfile,
} from '../src/layers/waterLayer.js';
import { WaterIndex, ringCrossings } from '../src/layers/waterIndex.js';
import {
  railProfileFor,
  RAILWAY_GAUGE_HALF_M,
  RAILWAY_BALLAST_HALF_M,
} from '../src/layers/railwayLayer.js';
import {
  cutWaterElevationAt,
  WATER_BED_M,
  WATER_CUT_BLEND_M,
} from '../src/terrain/waterCut.js';
import { skyParameters, lightingFor, sunlightColor } from '../src/environment/skyModel.js';
import {
  climateAt,
  refineByRelief,
  CLIMATE_FAMILIES,
  FAMILY_OF_KOPPEN,
  KOPPEN_CODES,
  GRID,
  MONTANE_ELEVATION_M,
  ALPINE_ELEVATION_M,
} from '../src/core/climate.js';
import {
  groundClassFor,
  classPolygons,
  CLASS_FILL,
  GroundClassMap,
  CLASS_AREA_M,
  SETTLED_GRASS,
  coverFor,
  coverId,
  coverFromId,
  COVER_KINDS,
  COVER_ID_STEP,
} from '../src/terrain/groundClassMap.js';
import { collectBuiltUpAreas, pointInAreas, ringsOf, FabricIndex } from '../src/layers/settlement.js';
import {
  kerbQualifies,
  kerbProfile,
  pavementBand,
  walkWidthAt,
  STREET_PROFILES,
  STREET_FABRIC_MIN,
  STREET_FABRIC_RADIUS_M,
  STREET_MAX_CROSS_SLOPE,
  STREET_MIN_RUN,
  pavementOnOtherRoad,
} from '../src/layers/streetLayer.js';
import { streetSurfaceAt } from '../src/layers/townStyle.js';
import { CROP_KINDS, CROP_ID_STEP, cropId, cropFromId } from '../src/layers/furniturePlacement.js';
import { cutElevationAt, ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../src/terrain/roadCut.js';
import { birdAt, createBirdGeometry } from '../src/layers/lifeLayer.js';
import { windowGrid, windowDraw } from '../src/layers/buildingLayer.js';
import {
  srgb,
} from '../src/core/color.js';

/** Les sections du thème par défaut, résolues une fois. */
const FURNITURE_SPECS = furnitureSpecsFor();
import {
  ROAD_PROFILES,
  FOREST_TYPES,
  CROP_LOOK,
  TOWN_PALETTES,
  TREE_VARIANTS,
  WINDOW_LIT_SHARE,
  WINDOW_WIDTH_M,
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

// --- Végétation ------------------------------------------------------------

test('le nombre d’arbres suit la part de boisé, et zéro sous le seuil', () => {
  assert.equal(treesForScore(0, 9), 0);
  assert.equal(treesForScore(WOOD_SCORE_MIN - 0.001, 9), 0);
  assert.equal(treesForScore(1, 9), 9, 'un sous-bois plein donne le maximum');
  // Un score moyen donne peu d’arbres : c’est la courbe de densité qui creuse
  // l’écart entre une lisière et un sous-bois.
  const middling = treesForScore(0.65, 9);
  assert.ok(middling >= 1 && middling <= 4, `score moyen → ${middling} arbres`);
});

test('l’arrondi stochastique évite l’effet de verger', () => {
  // Densité attendue < 1 : sans tirage, chaque cellule recevrait le même
  // nombre d’arbres — un arbre partout, soit une savane régulière.
  const score = 0.42;
  const low = treesForScore(score, 9, 0);
  const high = treesForScore(score, 9, 0.999);
  assert.ok(high > low, `le tirage doit départager : ${low} vs ${high}`);

  // Et l’espérance suit bien la densité attendue.
  let total = 0;
  const draws = 400;
  for (let i = 0; i < draws; i++) total += treesForScore(score, 9, (i + 0.5) / draws);
  const normalized = (score - WOOD_SCORE_MIN) / (1 - WOOD_SCORE_MIN);
  const expected = Math.pow(normalized, WOOD_DENSITY_CURVE) * 9;
  close(total / draws, expected, 0.02, 'espérance du tirage');
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

test('le sous-bois tire dans les buissons, quel que soit le peuplement', () => {
  const variants = understoryVariants();
  assert.ok(variants.length > 0);
  // Ce sont bien les silhouettes basses, pas celles de la futaie au-dessus.
  assert.deepEqual(variants, TREE_ESSENCES.bushy);
  // Et sans essence buissonnante, on rend quand même une case d’atlas valide.
  assert.deepEqual(understoryVariants({}), [0]);
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
  const list = Array.from({ length: 1000 }, (_, i) => i);
  assert.equal(thinPlacements(list, 2000), list, 'sous le plafond, on ne touche à rien');

  const thinned = thinPlacements(list, 250);
  assert.equal(thinned.length, 250, 'le plafond est tenu exactement');
  // L’éclaircie est répartie : chaque quart du semis garde un quart de ce qui
  // reste. C’est ce qui manquait quand on s’arrêtait de planter en route — le
  // sud d’une tuile restait nu au milieu d’un massif.
  for (let q = 0; q < 4; q++) {
    const kept = thinned.filter((v) => v >= q * 250 && v < (q + 1) * 250).length;
    assert.ok(Math.abs(kept - 62.5) <= 2, `quart ${q} : ${kept} points gardés`);
  }
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
  // Un tunnel passe sous le relief : le dessiner en surface poserait une route
  // en travers d’une montagne.
  assert.equal(roadStyleFor({ class: 'primary', brunnel: 'tunnel' }), null, 'tunnel écarté');
  assert.ok(roadStyleFor({ class: 'primary', brunnel: 'bridge' }), 'pont conservé');
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

test('les voies secondaires passent sous les grandes aux carrefours', () => {
  close(roadLiftFor('express'), ROAD_LIFT_M, 1e-9, 'le premier rang porte l’observateur');
  assert.ok(roadLiftFor('minor') < roadLiftFor('major'));
  assert.ok(roadLiftFor('path') < roadLiftFor('track'));
  assert.ok(roadLiftFor('path') > 0, 'aucun ruban ne repasse sous le terrain');
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

test('les deux formes de géométrie surfacique sont acceptées', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.deepEqual(waterPolygons({ type: 'Polygon', coordinates: [ring] }), [[ring]]);
  assert.deepEqual(waterPolygons({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }), [[ring], [ring]]);
  assert.deepEqual(waterPolygons({ type: 'LineString', coordinates: ring }), []);
  assert.deepEqual(waterPolygons(null), []);
});

test('un lac qui entoure l’observateur n’est pas écarté', () => {
  // Le cas qui compte : tous les sommets sont hors de portée, et pourtant la
  // rive passe sous les roues. Un test sommet par sommet le raterait.
  const huge = [
    { x: -5000, z: -5000 },
    { x: 5000, z: -5000 },
    { x: 5000, z: 5000 },
    { x: -5000, z: 5000 },
  ];
  assert.equal(boundsIntersect(huge, 0, 0, 900), true, 'englobant');

  const far = [{ x: 4000, z: 4000 }, { x: 4100, z: 4100 }];
  assert.equal(boundsIntersect(far, 0, 0, 900), false, 'hors de portée');

  const straddling = [{ x: 800, z: 0 }, { x: 3000, z: 0 }];
  assert.equal(boundsIntersect(straddling, 0, 0, 900), true, 'à cheval sur la frontière');
  assert.equal(boundsIntersect([], 0, 0, 900), false);
});

test('point dans un polygone à trou', () => {
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  const hole = [{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }];
  assert.equal(pointInPolygon(5, 5, square, [hole]), false, 'dans le trou');
  assert.equal(pointInPolygon(1, 1, square, [hole]), true, 'dans l’anneau, hors du trou');
  assert.equal(pointInPolygon(20, 20, square, [hole]), false, 'hors de tout');
});

test('la grille intérieure reste dans le polygone et sous le plafond d’échantillons', () => {
  const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
  const points = interiorSamples(square, [], 64);
  assert.ok(points.length > 0, 'un grand polygone produit des échantillons');
  assert.ok(points.length <= 64 * 1.5, 'le pas de grille respecte le plafond, à la maille près');
  for (const p of points) assert.equal(pointInPolygon(p.x, p.z, square, []), true);

  assert.deepEqual(interiorSamples([{ x: 0, z: 0 }, { x: 1, z: 0 }], [], 64), [], 'contour dégénéré');
});

test('le quantile bas écarte l’aberration isolée, dans les deux sens', () => {
  // Une série constante : le quantile la rend telle quelle.
  close(lowQuantile(new Array(100).fill(50), 0.05), 50, 1e-9, 'série constante');

  // Un seul creux aberrant sur cent points — c'est le MNT au-dessus de l'eau.
  // Le minimum tomberait à -30 et enterrerait la nappe ; le quantile tient.
  const oneDip = new Array(100).fill(50);
  oneDip[7] = -30;
  close(lowQuantile(oneDip, 0.05), 50, 1e-9, 'un creux isolé ne compte pas');

  // Symétriquement, une berge minoritaire ne doit pas remonter le niveau.
  const mostlyLow = new Array(100).fill(10);
  for (let i = 0; i < 20; i++) mostlyLow[i] = 90;
  close(lowQuantile(mostlyLow, 0.05), 10, 1e-9, 'la berge minoritaire ne compte pas');

  assert.equal(lowQuantile([], 0.05), Infinity, 'série vide');
});

test('l’altitude d’une nappe ignore les points sans donnée plutôt que de les compter pour zéro', () => {
  // Le contour dit tous 100 m ; un pixel de MNT sans tuile chargée à
  // l’intérieur ne doit pas faire chuter la nappe à zéro.
  const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
  const sampleWithHole = (x, z) => (x > 40 && x < 60 && z > 40 && z < 60 ? NaN : 100);
  close(waterSurfaceLevel(square, [], sampleWithHole), 100, 1e-9, 'la lacune du milieu est ignorée');

  // Un creux **large** au milieu du lac — invisible depuis le seul contour —
  // doit tirer le niveau vers le bas : c'est du relief, pas du bruit.
  const sampleWithBasin = (x, z) => (x > 20 && x < 80 && z > 20 && z < 80 ? 90 : 100);
  close(waterSurfaceLevel(square, [], sampleWithBasin), 90, 1e-9, 'la cuvette intérieure est vue');

  // Un creux **ponctuel** au même endroit ne doit pas, lui, couler la nappe :
  // c'est la différence entre l'ancien minimum et le quantile.
  const sampleWithSpeck = (x, z) => (x > 49 && x < 51 && z > 49 && z < 51 ? -50 : 100);
  close(waterSurfaceLevel(square, [], sampleWithSpeck), 100, 1e-9, 'le point aberrant est écarté');

  // Aucune donnée nulle part : le niveau reste indéfini (Infinity), à charge
  // de l’appelant d’écarter le polygone.
  assert.equal(waterSurfaceLevel(square, [], () => NaN), Infinity);
});

test('un profil de cours d’eau ne remonte jamais vers l’aval', () => {
  // Descente franche, mais bosselée : le bruit ne doit pas produire de contre-pente.
  const noisy = [100, 103, 96, 98, 92, 95, 88];
  const out = Array.from(monotoneDownstream(noisy));
  for (let r = 1; r < out.length; r++) {
    assert.ok(out[r] <= out[r - 1] + 1e-6, `pas de remontée en ${r}`);
  }
  assert.deepEqual(out, [100, 100, 96, 96, 92, 92, 88]);

  // Le sens vient des altitudes, pas de l’ordre du tableau : le même cours
  // numérisé à l’envers donne le même relief, lu dans l’autre sens.
  const reversed = Array.from(monotoneDownstream(noisy.slice().reverse()));
  assert.deepEqual(reversed, out.slice().reverse(), 'sens de numérisation indifférent');

  // Un profil déjà descendant passe intact.
  assert.deepEqual(Array.from(monotoneDownstream([50, 40, 30])), [50, 40, 30]);
  assert.equal(monotoneDownstream([]).length, 0);
});

test('une section d’eau est horizontale, au niveau du lit, et suit la pente', () => {
  // Vallée en V : le lit descend vers l’est, les berges remontent en travers.
  const path = resamplePath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 10);
  const sampleElevation = (x, z) => 200 - x * 0.02 + Math.abs(z) * 0.5;

  const platform = waterwayProfile(path, 5, sampleElevation);
  assert.ok(platform, 'un tracé couvert par le MNT produit un profil');
  for (let r = 0; r < path.length; r++) {
    // Le plus bas de la section, pas sa moyenne : sinon la nappe noierait les
    // berges. Ici le plus bas est l'axe, les rives remontent de 2,50 m.
    close(platform[r], 200 - path[r].x * 0.02, 1e-3, `section ${r} au niveau du lit`);
  }

  // Et la section est bien posée à plat en travers, une fois le ruban construit.
  const buffer = createRibbonBuffer();
  assert.ok(appendRibbon(buffer, { path, halfWidth: 5, sampleElevation, platform, smoothRadius: 0 }));
  const columns = 5;
  const rows = buffer.positions.length / 3 / columns;
  for (let r = 0; r < rows; r++) {
    const first = buffer.positions[r * columns * 3 + 1];
    for (let c = 1; c < columns; c++) {
      close(buffer.positions[(r * columns + c) * 3 + 1], first, 1e-6, `section ${r} plate`);
    }
  }
});

test('la cuvette d’eau creuse le lit, raccorde la rive et ne remonte jamais le terrain', () => {
  const level = 100;
  const bed = level - WATER_BED_M;

  // Sous la nappe : le terrain **est** le lit.
  close(cutWaterElevationAt(120, level, 0), bed, 1e-9, 'sous la nappe');

  // Au-delà du raccord : intact, quoi qu'il arrive.
  close(cutWaterElevationAt(120, level, WATER_CUT_BLEND_M), 120, 1e-9, 'hors du raccord');
  close(cutWaterElevationAt(120, level, WATER_CUT_BLEND_M + 50), 120, 1e-9, 'bien au-delà');

  // Entre les deux : monotone, et strictement encadré.
  let previous = bed;
  for (let d = 0; d <= WATER_CUT_BLEND_M; d += 0.5) {
    const h = cutWaterElevationAt(120, level, d);
    assert.ok(h >= previous - 1e-9, `le raccord ne redescend pas en ${d} m`);
    assert.ok(h >= bed - 1e-9 && h <= 120 + 1e-9, `le raccord reste borné en ${d} m`);
    previous = h;
  }

  // Jamais une bosse : un fond déjà plus bas que le lit reste tel quel. On
  // garantit que l'eau se voit, on ne prétend pas corriger le relief.
  close(cutWaterElevationAt(50, level, 0), 50, 1e-9, 'fond déjà creux');
  close(cutWaterElevationAt(50, level, 3), 50, 1e-9, 'fond déjà creux, dans le raccord');
});

test('la cuvette sait où est l’eau, jusqu’où porte la rive, et à quelle hauteur', () => {
  // Un carré de 200 m, avec un îlot au milieu — le trou doit rester sec.
  const outer = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 200 }, { x: 0, z: 200 }];
  const hole = [{ x: 90, z: 90 }, { x: 110, z: 90 }, { x: 110, z: 110 }, { x: 90, z: 110 }];
  const index = new WaterIndex([{ rings: [outer, hole], level: 42 }]);
  assert.ok(index.ready, 'la cuvette est construite');

  const inside = index.query(50, 50);
  assert.ok(inside, 'un point du lac est couvert');
  close(inside.level, 42, 1e-6, 'altitude de la nappe');
  close(inside.distance, 0, 1e-9, 'sous la nappe, la rive est à zéro');

  // L'îlot n'est jamais sous la nappe. Son centre est même hors de portée du
  // raccord (12 m de rive pour 11 m de portée) : son terrain reste intact.
  const islet = index.query(100, 100);
  assert.ok(!islet || islet.distance > 0, 'l’îlot n’est pas sous l’eau');

  // Juste dehors : dans le raccord, avec l'altitude de la nappe voisine.
  const near = index.query(-4, 100);
  assert.ok(near, 'un point de berge est encore couvert');
  close(near.level, 42, 1e-6, 'la berge connaît la nappe dont elle est la rive');
  assert.ok(near.distance > 0 && near.distance <= WATER_CUT_BLEND_M, 'dans le raccord');

  // Au-delà du raccord : plus rien, le terrain est libre.
  assert.equal(index.query(-100, 100), null, 'hors de portée du raccord');
  assert.equal(new WaterIndex([]).ready, false, 'aucune nappe, aucune cuvette');
});

test('les traversées d’un anneau comptent un sommet une seule fois', () => {
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  assert.deepEqual(ringCrossings(square, 5), [0, 10], 'ligne franche');

  // Une ligne passant exactement par deux sommets : sans la convention de
  // demi-ouverture, la parité s'inverserait et la moitié du lac disparaîtrait.
  const crossings = ringCrossings(square, 0);
  assert.equal(crossings.length % 2, 0, 'parité préservée à hauteur d’un sommet');
});

test('un cours d’eau sans aucune donnée d’altitude n’est pas dessiné', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 10);
  assert.equal(waterwayProfile(path, 5, () => NaN), null, 'tracé entièrement hors tuiles');

  // Une lacune partielle, elle, est comblée en plateau plutôt que comptée
  // pour zéro — un zéro se propagerait à tout l'aval par le minimum courant.
  const partial = waterwayProfile(path, 5, (x) => (x > 40 ? NaN : 100 - x * 0.1));
  assert.ok(partial, 'une lacune partielle ne fait pas disparaître le cours d’eau');
  for (const h of partial) assert.ok(Number.isFinite(h) && h > 50, 'aucune altitude de zéro');
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
  // Les valeurs de `class` sont celles que filtrent les styles du projet.
  assert.equal(groundClassFor('landcover', { class: 'wood' }), 'wood');
  assert.equal(groundClassFor('landcover', { class: 'grass' }), 'grass');
  assert.equal(groundClassFor('landcover', { class: 'wetland' }), 'grass');
  assert.equal(groundClassFor('landcover', { class: 'farmland' }), 'farmland');
  assert.equal(groundClassFor('landcover', { class: 'rock' }), 'bare');
  assert.equal(groundClassFor('landcover', { subclass: 'glacier' }), 'bare');

  // Un quartier d’habitation n’est pas une surface minérale : c’est un
  // périmètre, majoritairement vert, dont le minéral se compose le long des
  // rues. Une zone d’activité, elle, l’est réellement.
  assert.equal(groundClassFor('landuse', { class: 'residential' }), 'settled');
  assert.equal(groundClassFor('landuse', { class: 'suburb' }), 'settled');
  assert.equal(groundClassFor('landuse', { class: 'industrial' }), 'bare');
  assert.equal(groundClassFor('landuse', { class: 'retail' }), 'bare');
  assert.equal(groundClassFor('landuse', { class: 'quarry' }), 'bare');
  assert.equal(groundClassFor('landuse', { class: 'cemetery' }), 'grass');
  // Un parc est un parc, quelle que soit la zone qui l’entoure.
  assert.equal(groundClassFor('park', { class: 'public_park' }), 'grass');

  // Ce qui ne décrit pas une surface ne doit rien peindre du tout.
  assert.equal(groundClassFor('landuse', { class: 'school' }), null);
  assert.equal(groundClassFor('landcover', { class: 'unknown' }), null);
  assert.equal(groundClassFor('transportation', { class: 'motorway' }), null);
  assert.equal(groundClassFor('landcover', {}), null);
});

test('la sous-classe dit la sorte de sol, pas seulement sa matière', () => {
  // Ce que les tuiles portent déjà et qui était jeté : une lande, un maquis et
  // une prairie sont trois `class: grass`, et c’est la sous-classe qui les
  // sépare.
  assert.equal(coverFor('landcover', { class: 'grass', subclass: 'heath' }), 'heath');
  assert.equal(coverFor('landcover', { class: 'grass', subclass: 'scrub' }), 'scrub');
  assert.equal(coverFor('landcover', { class: 'grass', subclass: 'fell' }), 'alpine');
  assert.equal(coverFor('landcover', { class: 'wetland', subclass: 'bog' }), 'wetland');
  assert.equal(coverFor('landcover', { class: 'sand', subclass: 'dune' }), 'sand');
  // Un éboulis n’est pas une dalle : l’un est une pente qui bouge, l’autre un
  // plateau.
  assert.equal(coverFor('landcover', { class: 'rock', subclass: 'scree' }), 'scree');
  assert.equal(coverFor('landcover', { class: 'rock', subclass: 'bare_rock' }), 'rock');

  // Une prairie ordinaire n’est pas une couverture : c’est le cas par défaut,
  // et rien ne doit être peint pour elle.
  assert.equal(coverFor('landcover', { class: 'grass', subclass: 'meadow' }), null);
  assert.equal(coverFor('landcover', { class: 'farmland' }), null);
  // Ni `landuse` ni `park` ne décrivent une matière : ils disent l’usage.
  assert.equal(coverFor('landuse', { class: 'residential' }), null);
  assert.equal(coverFor('park', { class: 'public_park' }), null);
});

test('l’identifiant de couverture survit à l’aller-retour dans le canal vert', () => {
  // Même contrat que les cultures : l’identifiant est peint dans une image et
  // relu par le shader comme par les couches. Un décalage repeint une lande en
  // éboulis, en silence.
  for (const kind of COVER_KINDS) {
    assert.equal(coverFromId(coverId(kind) * COVER_ID_STEP), kind, kind);
  }
  assert.equal(coverId(null), 0, 'zéro reste « aucune couverture »');
  assert.equal(coverFromId(0), null);
  // Le pas doit tenir toutes les couvertures dans un octet, sinon la dernière
  // déborde et se relit comme rien du tout.
  assert.ok(COVER_KINDS.length * COVER_ID_STEP <= 255, 'les identifiants tiennent dans le canal');
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

test('chaque matière a un canal distinct, et l’alpha porte la couverture', () => {
  // L’encodage est le contrat entre ce module et le shader : R herbe, G bois,
  // B culture, et « classé sol nu » = alpha plein avec les trois canaux à zéro.
  const seen = new Set();
  for (const [kind, fill] of Object.entries(CLASS_FILL)) {
    assert.ok(/^rgba\(\d+, \d+, \d+, 1\)$/.test(fill), `${kind} : alpha plein`);
    assert.ok(!seen.has(fill), `${kind} : couleur distincte`);
    seen.add(fill);
  }
  assert.equal(CLASS_FILL.bare, 'rgba(0, 0, 0, 1)', 'le sol nu est le complément');
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

test('ce qui se sème dans un champ dépend de sa culture', () => {
  assert.equal(scatterFurnitureFor({ class: 'farmland', subclass: 'farmland' }).item, 'hay');
  // Un champ **en culture** n’a rien à semer par-dessus : c’est la couche de
  // culture qui le couvre, et une botte de foin dans le tournesol se lit comme
  // une erreur.
  assert.equal(scatterFurnitureFor({ class: 'farmland' }, { crop: 'sunflower' }), null);
  assert.equal(scatterFurnitureFor({ class: 'farmland' }, { crop: 'plough' }).item, 'hay');
  // Une pâture porte du bétail, pas des bosquets.
  assert.equal(scatterFurnitureFor({ class: 'grass', subclass: 'meadow' }).item, 'herd');
  assert.equal(scatterFurnitureFor({ class: 'wood' }), null);
});

test('le bétail suit le terrain : bovins en plaine, ovins sur les pentes', () => {
  // Le tirage est le même de part et d’autre : c’est la pente seule qui doit
  // faire basculer l’espèce.
  assert.equal(herdFor({ steepness: 0.02, variant: 0.5 }).item, 'cow');
  assert.equal(herdFor({ steepness: 0.3, variant: 0.5 }).item, 'sheep');
  // Un troupeau de moutons se tient plus serré qu’un troupeau de vaches.
  assert.ok(herdFor({ steepness: 0.3, variant: 0.1 }).spread < herdFor({ steepness: 0, variant: 0.9 }).spread);
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

// --- Rognage des voies secondaires au carrefour -------------------------------

test('la voie secondaire s’arrête au bord de la chaussée dominante', () => {
  const { chains, junctions } = mergeRoadLines(teeLines());
  const trimmed = trimAtJunctions(chains, junctions);

  const minor = trimmed.find((c) => c.profile === 'minor');
  assert.ok(minor, 'la desserte survit au rognage');

  // Elle partait du nœud ; elle doit maintenant partir de la rive, c'est-à-dire
  // à la demi-largeur de la nationale, moins le recouvrement volontaire.
  const start = minor.points.reduce((a, b) => (Math.abs(a.z) < Math.abs(b.z) ? a : b));
  close(Math.abs(start.z), 4.25 - JUNCTION_OVERLAP_M, 1e-2, 'coupée sur la rive');
  assert.ok(
    minor.points.every((p) => Math.abs(p.z) >= 4.25 - JUNCTION_OVERLAP_M - 1e-2),
    'plus rien de la desserte ne court sous la nationale'
  );
});

test('la chaussée dominante n’est pas rognée par sa propre branche', () => {
  const { chains, junctions } = mergeRoadLines(teeLines());
  const trimmed = trimAtJunctions(chains, junctions);

  const major = trimmed.filter((c) => c.profile === 'major');
  assert.equal(major.length, 1, 'la nationale n’est pas coupée en deux');
  close(major[0].points[0].x, 0, 1e-6, 'ni raccourcie au départ');
  close(major[0].points[major[0].points.length - 1].x, 200, 1e-6, 'ni à l’arrivée');
});

test('deux routes de même largeur ne se rognent pas l’une l’autre', () => {
  // Sans dominante, couper les deux ouvrirait un trou au milieu du croisement
  // au lieu de recouvrir un chevauchement.
  const lines = teeLines(100, 4.25);
  lines[1].profile = 'major';
  const { chains, junctions } = mergeRoadLines(lines);
  const trimmed = trimAtJunctions(chains, junctions);

  assert.deepEqual(
    trimmed.map((c) => c.points.length),
    chains.map((c) => c.points.length),
    'rien n’est coupé'
  );
});

test('une desserte qui traverse la nationale est coupée en deux, pas raccourcie', () => {
  const { chains, junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    {
      profile: 'minor',
      halfWidth: 2.5,
      points: [
        { x: 100, z: -60 },
        { x: 100, z: 0 },
        { x: 100, z: 60 },
      ],
    },
  ]);
  const trimmed = trimAtJunctions(chains, junctions);

  const minor = trimmed.filter((c) => c.profile === 'minor');
  assert.equal(minor.length, 2, 'une amorce de chaque côté');
  for (const run of minor) {
    assert.ok(
      run.points.every((p) => Math.abs(p.z) >= 4.25 - JUNCTION_OVERLAP_M - 1e-2),
      'aucune des deux ne traverse la chaussée'
    );
  }
});

test('le sommet posé sur la rive est un point d’ancrage', () => {
  // C'est de lui que se comptent lampadaires et bornes le long de la desserte,
  // et il vient du nœud du carrefour : il ne bouge pas d'une reconstruction à
  // l'autre, contrairement au bout de chaîne que le découpage en tuiles décide.
  const { chains, junctions } = mergeRoadLines(teeLines());
  const minor = trimAtJunctions(chains, junctions).find((c) => c.profile === 'minor');

  const nearest = minor.points.reduce(
    (best, p, i) => (Math.abs(p.z) < Math.abs(minor.points[best].z) ? i : best),
    0
  );
  assert.equal(minor.anchors[nearest], true);
});

test('un moignon plus court que le seuil disparaît au lieu de dépasser', () => {
  const { chains, junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    // Une amorce de six mètres : il n'en resterait que deux une fois la rive
    // atteinte, moins que `JUNCTION_MIN_RUN_M`.
    {
      profile: 'minor',
      halfWidth: 2.5,
      points: [
        { x: 100, z: 0 },
        { x: 100, z: 6 },
      ],
    },
  ]);
  const trimmed = trimAtJunctions(chains, junctions);

  assert.ok(JUNCTION_MIN_RUN_M > 6 - (4.25 - JUNCTION_OVERLAP_M), 'le cas testé est bien un moignon');
  assert.equal(trimmed.filter((c) => c.profile === 'minor').length, 0);
});

test('sans carrefour, le rognage rend les chaînes telles quelles', () => {
  const { chains } = mergeRoadLines([
    { profile: 'minor', halfWidth: 2.5, points: straight(0, 200, 8) },
  ]);

  assert.equal(trimAtJunctions(chains, []), chains, 'pas de recopie inutile');
  assert.equal(trimAtJunctions(chains, null), chains);
});

test('le rognage ne touche pas à deux chaussées qui se croisent sans nœud', () => {
  // Un pont : les deux rubans se recouvrent au sol mais ne partagent aucun
  // sommet. Rogner y ouvrirait une brèche sous l'ouvrage.
  const { chains, junctions } = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 200, 8) },
    {
      profile: 'minor',
      halfWidth: 2.5,
      points: [
        { x: 103, z: -60 },
        { x: 103, z: 60 },
      ],
    },
  ]);

  assert.equal(junctions.length, 0, 'aucun nœud partagé');
  assert.equal(trimAtJunctions(chains, junctions), chains);
});

// --- Index des chaussées et recouture des carrefours -------------------------

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

test('la distance à un segment est bien prise sur le segment, pas sur ses bouts', () => {
  close(distanceToSegment(50, 10, 0, 0, 100, 0).distance, 10, 1e-9, 'de côté');
  close(distanceToSegment(150, 0, 0, 0, 100, 0).distance, 50, 1e-9, 'au-delà du bout');
  close(distanceToSegment(50, 0, 0, 0, 100, 0).t, 0.5, 1e-9, 'abscisse du projeté');
});

test('l’index sait ce qui tombe sur le bitume et ce qui tombe à côté', () => {
  const segments = [fakeSegment(straight(0, 100, 20), 2.5)];
  const index = new RoadIndex(segments);

  assert.ok(index.covers(50, 0), 'au milieu de la chaussée');
  assert.ok(index.covers(50, 2.4), 'au ras de la rive');
  assert.ok(!index.covers(50, 4), 'sur l’accotement, l’herbe pousse');
  assert.ok(index.covers(50, 3, 1), 'la marge élargit la chaussée');
  assert.ok(!index.covers(50, 40), 'en pleine prairie');
  assert.ok(!index.covers(400, 0), 'au-delà de la chaussée');
});

test('une voie qui débouche sur une plus large vient épouser son altitude', () => {
  // Une nationale à l'altitude 10, une petite route à l'altitude 9 qui la
  // rejoint : sans recouture, elle l'aborde par une marche d'un mètre.
  const main = fakeSegment(straight(-50, 50, 20), 4.25, 10);
  const branch = fakeSegment(
    Array.from({ length: 11 }, (_, i) => ({ x: 0, z: 50 - i * 5 })),
    2.5,
    9
  );
  const segments = [main, branch];
  const index = new RoadIndex(segments);
  assert.equal(stitchPlatforms(segments, index), 1, 'seule la plus étroite bouge');

  const last = branch.platform.length - 1;
  close(branch.platform[last], 10, 1e-4, 'au carrefour, les deux se rejoignent');
  assert.ok(branch.platform[last - 2] > 9 && branch.platform[last - 2] < 10, 'raccord en rampe');
  close(branch.platform[0], 9, 1e-6, 'loin du carrefour, rien ne change');
  close(main.platform[10], 10, 1e-6, 'la plus large ne se dérange pas');
});

test('un pont n’est pas un carrefour : les deux chaussées se laissent tranquilles', () => {
  const under = fakeSegment(straight(-50, 50, 20), 4.25, 10);
  const over = fakeSegment(
    Array.from({ length: 11 }, (_, i) => ({ x: 0, z: 50 - i * 5 })),
    2.5,
    18
  );
  const segments = [under, over];
  stitchPlatforms(segments, new RoadIndex(segments));
  close(over.platform[over.platform.length - 1], 18, 1e-6, 'le pont reste en l’air');
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
  // Le shader de terrain peint le non-classé avec `unclassifiedWeights` — par
  // défaut tout herbe. Avant ce correctif, `groundCover` recevait `null` de
  // `sampleAt` et ne semait rien : sol vert, aucune touffe.
  const allGrass = grassSampleFallback(null, [1, 0, 0, 0]);
  assert.equal(allGrass.grass, 1);
  assert.equal(allGrass.farmland, 0);

  // Un thème qui déciderait un repli différent (davantage de bois, par
  // exemple) doit se refléter ici aussi : ce n'est pas une constante figée.
  const mixed = grassSampleFallback(null, [0.4, 0.3, 0.2, 0.1]);
  assert.equal(mixed.grass, 0.4);
  assert.equal(mixed.wood, 0.3);
  assert.equal(mixed.farmland, 0.2);
  assert.equal(mixed.bare, 0.1);

  // Un échantillon réel n'est jamais remplacé par le repli.
  const real = { grass: 0.9, wood: 0, farmland: 0, bare: 0.1 };
  assert.equal(grassSampleFallback(real, [1, 0, 0, 0]), real);
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
  // Un carrefour prime sur tout le reste.
  for (const variant of [0.1, 0.5, 0.9]) {
    const item = signKindFor({ junction: true, variant });
    assert.ok(['signStop', 'signYield', 'signRoundabout'].includes(item), item);
  }
  // Un virage serré appelle sa balise.
  assert.equal(signKindFor({ curvature: 0.05, variant: 0.5 }), 'signChevron');
  // La ville a ses passages piétons, la rase campagne non.
  const town = new Set([0.1, 0.4, 0.8].map((v) => signKindFor({ builtUp: true, variant: v })));
  assert.ok(town.has('signCrossing'));

  // Tout ce que la règle peut rendre existe dans le catalogue : un panneau
  // oublié dans `SIGN_ITEMS` serait silencieusement invisible.
  for (let i = 0; i < 60; i++) {
    const variant = i / 60;
    for (const context of [
      { variant },
      { variant, builtUp: true },
      { variant, junction: true },
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
  assert.equal(TREE_ATLAS_OFFSETS.length, TREE_VARIANTS.length, 'une case par silhouette');
  for (const [u, v] of TREE_ATLAS_OFFSETS) {
    assert.ok(u >= 0 && u < 1 && v >= 0 && v < 1, 'décalage dans la texture');
  }
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

test('un village garde sa palette, et son voisin en a une autre', () => {
  const a = townPaletteAt(10, 10);
  const b = townPaletteAt(10 + TOWN_PATCH_M * 0.4, 10);
  assert.equal(a.name, b.name, 'la maille tient sur toute la traversée');

  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(townPaletteAt(i * TOWN_PATCH_M, 0).name);
  assert.ok(names.size >= 4, `plusieurs pays (${[...names].join(', ')})`);
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

// --- La voirie urbaine -------------------------------------------------------

test('un quartier d’habitation porte de l’herbe, une zone d’activité non', () => {
  // Le fond du problème : `residential` décrit un périmètre, pas un revêtement.
  // Son remplissage est donc **partiel** — la seule matière qui le soit.
  const settled = CLASS_FILL.settled.match(/rgba\((\d+), (\d+), (\d+), 1\)/);
  assert.equal(Number(settled[1]), Math.round(SETTLED_GRASS * 255), 'part d’herbe dans le rouge');
  assert.equal(Number(settled[2]), 0, 'pas de bois dans un lotissement');
  assert.equal(Number(settled[3]), 0, 'ni de culture');
  assert.ok(SETTLED_GRASS > 0.5 && SETTLED_GRASS < 1, 'majoritairement vert, jamais un pré');

  // Le sol nu reste le complément exact : c’est le contrat avec le shader.
  assert.equal(CLASS_FILL.bare, 'rgba(0, 0, 0, 1)');
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

test('un trottoir ne se pose pas sur la chaussée d’à côté', () => {
  // Deux rues parallèles à sept mètres d'axe en axe — le cas d'une venelle qui
  // double une rue, ou des deux branches d'un Y juste avant qu'elles se
  // touchent : entre les deux il y a la place d'un bas-côté, pas d'un trottoir.
  const north = [];
  const south = [];
  for (let x = -100; x <= 100; x += 10) north.push({ x, z: 0 });
  for (let x = -100; x <= 100; x += 10) south.push({ x, z: 7 });
  const segments = [fakeSegment(north, 2.5, 10), fakeSegment(south, 2.5, 10)];
  const index = new RoadIndex(segments);

  // Perpendiculaire de la marche : la rue court d'ouest en est, donc +z est le
  // côté -1 dans la convention d'`appendProfile` (px = tz, pz = -tx).
  const at = { x: 0, z: 0, px: 0, pz: -1, halfWidth: 2.5, segment: segments[0] };

  assert.equal(
    pavementOnOtherRoad({ ...at, side: -1 }, index),
    true,
    'du côté de l’autre rue, le trottoir tomberait sur son bitume'
  );
  assert.equal(
    pavementOnOtherRoad({ ...at, side: 1 }, index),
    false,
    'de l’autre côté, rien ne gêne'
  );

  // Sa propre chaussée ne compte pas : sans l'exception, aucun trottoir ne se
  // poserait jamais, puisqu'il borde la rue par définition.
  assert.equal(
    pavementOnOtherRoad({ ...at, side: 1, segment: null }, new RoadIndex([segments[0]])),
    true,
    'sans exception, sa propre rive le refuse'
  );
  assert.equal(
    pavementOnOtherRoad({ ...at, side: 1 }, new RoadIndex([segments[0]])),
    false,
    'avec elle, il la borde tranquillement'
  );

  // Sans réseau connu, la couche ne devine pas : elle ne refuse rien.
  assert.equal(pavementOnOtherRoad({ ...at, side: -1 }, null), false);
});

test('une portion de trottoir trop courte est un artefact du découpage', () => {
  // Cinq lignes de cinq mètres : vingt-cinq mètres, la longueur en deçà de
  // laquelle un bout de bordure se lit comme un bug et non comme une rue.
  assert.ok(STREET_MIN_RUN >= 4, 'assez long pour être une rue');
  const rows = [1, 1, 1, 0, 1, 1, 1, 1, 1, 1].map((ok, r) => ({ r, ok: ok === 1 }));
  const runs = contiguousRuns(rows, (row) => row.ok, STREET_MIN_RUN);
  assert.equal(runs.length, 1, 'seule la portion assez longue est retenue');
  assert.equal(runs[0].length, 6);
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
