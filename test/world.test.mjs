/*
 * Tests unitaires de la géométrie de la bulle 3D.
 * Aucune dépendance navigateur : `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

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
  LABEL_FURNITURE,
  LABEL_ROADS,
  LABEL_CROPS,
} from '../src/inspect/objectLabels.js';
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
  distanceToSegment,
  stitchPlatforms,
  RoadIndex,
  NODE_WELD_M,
} from '../src/layers/roadGraph.js';
import {
  CORRIDOR_MARGIN_M,
  CORRIDOR_PROBE_M,
  inCorridor,
  clipOutsideCorridor,
  filterOutsideCorridor,
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
} from '../src/layers/buildingLayer.js';
import {
  treesForScore,
  forestTypeAt,
  variantsFor,
  FOREST_PATCH_M,
  WOOD_SCORE_MIN,
  WOOD_DENSITY_CURVE,
} from '../src/layers/vegetationLayer.js';
import { grassVariantFor, GRASS_RADIUS_M, GRASS_COUNT, GRASS_FADE_FROM } from '../src/layers/groundCover.js';
import {
  cropCellRing,
  fillCropCell,
  CROP_PER_CELL,
  CROP_TUFT_STRIDE,
  CROP_CELL_M,
  CROP_RADIUS_M,
  CROP_FADE_FROM,
  CROP_COUNT,
} from '../src/layers/cropLayer.js';
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
import { trafficPhaseAt, TRAFFIC_CYCLE_S, SIGN_ITEMS } from '../src/layers/furnitureLayer.js';
import { TREE_ATLAS_OFFSETS, GRASS_VARIANTS } from '../src/materials/proceduralTextures.js';
import { snapToShadowTexels, sunDirection, SHADOW_RADIUS_M } from '../src/environment/shadowFrame.js';
import { waterwayStyleFor, isDrawableWater, waterPolygons, boundsIntersect } from '../src/layers/waterLayer.js';
import { skyParameters, lightingFor, sunlightColor } from '../src/environment/skyModel.js';
import { groundClassFor, classPolygons, CLASS_FILL } from '../src/terrain/groundClassMap.js';
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

test('une section d’eau est horizontale, à l’altitude la plus basse', () => {
  // Vallée en V : le lit descend vers l’est, les berges remontent en travers.
  const path = resamplePath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 10);
  const sampleElevation = (x, z) => 200 - x * 0.02 + Math.abs(z) * 0.5;

  const buffer = createRibbonBuffer();
  assert.ok(
    appendRibbon(buffer, {
      path,
      halfWidth: 5,
      sampleElevation,
      flatCrossSection: true,
      level: false,
      smoothRadius: 0,
    })
  );

  const columns = 5;
  const rows = buffer.positions.length / 3 / columns;
  for (let r = 0; r < rows; r++) {
    const heights = [];
    for (let c = 0; c < columns; c++) heights.push(buffer.positions[(r * columns + c) * 3 + 1]);
    for (const h of heights) close(h, heights[0], 1e-6, `section ${r} plate`);
    // Le minimum de la section, pas sa moyenne : sinon la nappe noierait les
    // berges. Tolérance à la hauteur du tampon d'altitudes, qui est en float32.
    close(heights[0], 200 - path[r].x * 0.02, 1e-3, `section ${r} au niveau du lit`);
  }
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

// --- Occupation du sol ------------------------------------------------------

test('les couches vectorielles décrivent la matière du sol', () => {
  // Les valeurs de `class` sont celles que filtrent les styles du projet.
  assert.equal(groundClassFor('landcover', { class: 'wood' }), 'wood');
  assert.equal(groundClassFor('landcover', { class: 'grass' }), 'grass');
  assert.equal(groundClassFor('landcover', { class: 'wetland' }), 'grass');
  assert.equal(groundClassFor('landcover', { class: 'farmland' }), 'farmland');
  assert.equal(groundClassFor('landcover', { class: 'rock' }), 'bare');
  assert.equal(groundClassFor('landcover', { subclass: 'glacier' }), 'bare');

  assert.equal(groundClassFor('landuse', { class: 'residential' }), 'bare');
  assert.equal(groundClassFor('landuse', { class: 'cemetery' }), 'grass');
  // Un parc est un parc, quelle que soit la zone qui l’entoure.
  assert.equal(groundClassFor('park', { class: 'public_park' }), 'grass');

  // Ce qui ne décrit pas une surface ne doit rien peindre du tout.
  assert.equal(groundClassFor('landuse', { class: 'school' }), null);
  assert.equal(groundClassFor('landcover', { class: 'unknown' }), null);
  assert.equal(groundClassFor('transportation', { class: 'motorway' }), null);
  assert.equal(groundClassFor('landcover', {}), null);
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

// --- Ce qui donne de la vie -------------------------------------------------

test('un oiseau tourne sur son orbite en regardant où il va', () => {
  const bird = { radius: 80, height: 60, speed: 0.06, phase: 0.4, beat: 1, scale: 1 };
  const centre = { x: 10, y: 200, z: -5 };

  // Deux instants successifs : le cap rendu doit être celui du déplacement.
  const a = birdAt(bird, 0, centre);
  const b = birdAt(bird, 0.5, centre);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Le +Z de la silhouette, tourné du cap rendu, doit suivre le déplacement.
  const norm = Math.hypot(dx, dz) || 1;
  close(Math.sin(a.heading), dx / norm, 0.02, 'composante x du vol');
  close(Math.cos(a.heading), dz / norm, 0.02, 'composante z du vol');

  // L’orbite reste bien à son rayon, à l’ondulation verticale près.
  const radius = Math.hypot(a.x - centre.x, a.z - centre.z);
  close(radius, bird.radius, 1e-9, 'rayon d’orbite');
  assert.ok(a.y > centre.y, 'l’oiseau vole au-dessus de l’observateur');
  assert.ok(a.flap > 0 && a.flap <= 1, 'battement borné');
});

test('un vol qui tourne dans l’autre sens regarde aussi dans l’autre sens', () => {
  // Une vitesse angulaire négative doit renverser le cap, pas seulement le
  // déplacement : c’est le genre de signe qui fait voler les oiseaux à reculons.
  const centre = { x: 0, y: 0, z: 0 };
  const clockwise = birdAt({ radius: 50, height: 40, speed: 0.05, phase: 0, beat: 1 }, 0, centre);
  const other = birdAt({ radius: 50, height: 40, speed: -0.05, phase: 0, beat: 1 }, 0, centre);
  close(Math.abs(clockwise.heading - other.heading), Math.PI, 1e-9, 'caps opposés');
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

/** Polyligne droite, de `from` à `to` en `steps` pas, sur l'axe des x. */
function straight(from, to, steps = 4, z = 0) {
  const points = [];
  for (let i = 0; i <= steps; i++) points.push({ x: from + ((to - from) * i) / steps, z });
  return points;
}

test('deux morceaux d’une même route bout à bout ne font qu’une chaîne', () => {
  const merged = mergeRoadLines([
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
  const merged = mergeRoadLines([
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
  const merged = mergeRoadLines([
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
  const merged = mergeRoadLines([
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
  const merged = mergeRoadLines([
    { profile: 'major', halfWidth: 4.25, points: straight(0, 100) },
    { profile: 'minor', halfWidth: 2.5, points: straight(100, 200) },
  ]);

  assert.equal(merged.length, 2, 'la largeur change, donc le ruban change');
});

test('un virage à angle droit n’est pas pris pour une continuation', () => {
  const merged = mergeRoadLines([
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
  const forward = mergeRoadLines([a, b])[0].points;
  const backward = mergeRoadLines([b, a])[0].points;
  close(forward[0].x, backward[0].x, 1e-6, 'même départ');
  close(forward[forward.length - 1].x, backward[backward.length - 1].x, 1e-6, 'même arrivée');
});

test('deux sommets plus proches que la tolérance sont le même nœud', () => {
  const merged = mergeRoadLines([
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

test('le bas-côté complet reste minoritaire', () => {
  // Le motif fossé / talus / limite est très reconnaissable *parce qu'il n'est
  // pas partout*. Appliqué à toutes les routes, il fait un décor de circuit.
  let ditched = 0;
  for (let i = 0; i < 100; i++) {
    if (roadsideVergeFor('minor', { variant: i / 100 }).ditch) ditched++;
  }
  assert.ok(ditched > 20 && ditched < 60, `un tiers environ (${ditched} %)`);
  // Une voie rapide, elle, en a des deux côtés.
  assert.equal(roadsideVergeFor('express', { variant: 0.9 }).ditchSide, 0);
  // Pas de fossé en agglomération, ni le long d'un sentier.
  assert.equal(roadsideVergeFor('minor', { builtUp: true, variant: 0.1 }).ditch, false);
  assert.equal(roadsideVergeFor('path', { variant: 0.1 }).ditch, false);
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

test('le plafond de touffes couvre le pire cas, sinon le disque rétrécit en douce', () => {
  // Un plafond atteint ne casse rien — les mailles sont semées de la plus
  // proche à la plus lointaine — mais il raccourcit le disque sans le dire, et
  // d'une quantité qui dépend de la culture. On préfère le savoir ici.
  const compte = (cells, buffer, stride, perCell, densite, radius, fadeFrom) => {
    let n = 0;
    for (const cell of cells) {
      const start = radius * fadeFrom;
      const fade =
        cell.distance <= start ? 1 : Math.max(0, 1 - (cell.distance - start) / (radius - start));
      if (fade <= 0.05) continue;
      buffer.fill(cell);
      for (let i = 0; i < perCell; i++) if (buffer.data[i * stride + 2] <= densite * fade) n++;
    }
    return n;
  };

  const grassBuffer = {
    data: new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE),
    fill(cell) {
      fillGrassCell(this.data, cell.gx, cell.gz);
    },
  };
  const pires = compte(
    grassCellRing(GRASS_RADIUS_M, GRASS_CELL_M),
    grassBuffer,
    GRASS_TUFT_STRIDE,
    GRASS_PER_CELL,
    1,
    GRASS_RADIUS_M,
    GRASS_FADE_FROM
  );
  assert.ok(pires <= GRASS_COUNT, `prairie pleine : ${pires} touffes pour ${GRASS_COUNT}`);

  const cropBuffer = {
    data: new Float32Array(CROP_PER_CELL * CROP_TUFT_STRIDE),
    fill(cell) {
      fillCropCell(this.data, cell.gx, cell.gz);
    },
  };
  const cells = cropCellRing(CROP_RADIUS_M, CROP_CELL_M);
  for (const [nom, look] of Object.entries(CROP_LOOK)) {
    const n = compte(cells, cropBuffer, CROP_TUFT_STRIDE, CROP_PER_CELL, look.density, CROP_RADIUS_M, CROP_FADE_FROM);
    assert.ok(n <= CROP_COUNT, `${nom} : ${n} touffes pour ${CROP_COUNT}`);
  }
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
