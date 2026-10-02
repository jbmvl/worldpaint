/*
 * `createWorld({ reach })` : le décor d'une scène fixe ne bâtit que ce qui est
 * à portée, et rien ne change quand la portée est absente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { reachedRadius } from '../src/core/decorReach.js';
import { createLocalFrame, tileXToLng, tileYToLat } from '../src/core/tileMath.js';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { WorldComposer } from '../src/worldComposer.js';
import { BuildingLayer, BUILDING_RADIUS_M, BUILDING_SOURCE_LAYER } from '../src/layers/buildingLayer.js';
import { BRIDGE_RADIUS_M } from '../src/layers/bridgeLayer.js';
import { RoadNetwork, ROAD_RADIUS_M } from '../src/layers/roadNetwork.js';

/** `document` minimal : la couche bâtie dessine ses étiquettes dans un canvas. */
const anything = () => new Proxy(function () {}, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : anything()),
  apply: () => anything(),
  set: () => true,
});
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
  createElementNS: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
};

test('reachedRadius plafonne sans jamais rallonger', () => {
  assert.equal(reachedRadius(900, { reachMeters: 80 }), 80);
  assert.equal(reachedRadius(900, { reachMeters: 5000 }), 900);
  assert.equal(reachedRadius(900, { reachMeters: Infinity }), 900);
});

test('reachedRadius laisse le rayon propre quand la bulle ne déclare rien', () => {
  assert.equal(reachedRadius(900, null), 900);
  assert.equal(reachedRadius(900, {}), 900);
  assert.equal(reachedRadius(900, { reachMeters: NaN }), 900);
  assert.equal(reachedRadius(900, { reachMeters: 0 }), 900);
});

/** Bulle réduite à ce que lisent les couches : la portée, le repère, la hauteur. */
function bubbleWith(reach, blockSize = 3) {
  return {
    reachMeters: reach ?? Infinity,
    zoom: 15,
    blockSize,
    verticalScale: 1,
    frame: null,
    surfaceElevationAtLocal: () => 0,
  };
}

test('la bulle publie la portée, infinie par défaut', () => {
  const reachOf = (_reach) =>
    Object.getOwnPropertyDescriptor(TerrainBubble.prototype, 'reachMeters').get.call({ _reach });
  assert.equal(reachOf(Infinity), Infinity);
  assert.equal(reachOf(120), 120);
});

/** Source vectorielle réduite à ce que lit `BuildingLayer`. */
function buildingSource(frame, distances) {
  const polygon = (d) => {
    const at = (x, z) => frame.toLngLat(x, z);
    const ring = [at(d, 0), at(d + 8, 0), at(d + 8, 8), at(d, 8), at(d, 0)].map(({ lng, lat }) => [lng, lat]);
    return { type: 'Polygon', coordinates: [ring] };
  };
  return {
    forEachFeature(layer, _tiles, visit) {
      if (layer !== BUILDING_SOURCE_LAYER) return;
      for (const d of distances) visit(polygon(d), { render_height: 6 });
    },
  };
}

function builtCount(reach, distances) {
  const frame = createLocalFrame(2.35, 48.85, 15);
  const bubble = Object.assign(bubbleWith(reach), { frame });
  const layer = new BuildingLayer({ THREE, scene: new THREE.Scene(), bubble });
  layer.rebuild(buildingSource(frame, distances), [], { x: 0, z: 0 });
  return layer.count;
}

test('une portée écarte les bâtiments lointains, sans elle ils sont tous bâtis', () => {
  const distances = [30, 60, 400, 900];
  assert.equal(builtCount(undefined, distances), 4);
  assert.equal(builtCount(100, distances), 2);
  assert.equal(builtCount(500, distances), 3);
});

test('une portée plus longue que le rayon du bâti ne l’allonge pas', () => {
  assert.equal(builtCount(BUILDING_RADIUS_M * 10, [BUILDING_RADIUS_M + 50]), 0);
});

test('chaque couche lit la portée de sa bulle', () => {
  const bubble = bubbleWith(75);
  assert.equal(RoadNetwork.prototype._radius.call({ bubble }), 75);
  assert.equal(RoadNetwork.prototype._radius.call({ bubble: bubbleWith(Infinity) }), ROAD_RADIUS_M);
  assert.equal(reachedRadius(BRIDGE_RADIUS_M, bubble), 75);
});

function composerWith(reach, blockSize = 3) {
  const composer = Object.create(WorldComposer.prototype);
  composer.bubble = bubbleWith(reach, blockSize);
  composer.vectorTiles = { zoom: 14 };
  return composer;
}

test('sans portée, toutes les tuiles du bloc sont demandées', () => {
  const lng = tileXToLng(8000.5, 14);
  const lat = tileYToLat(5000.5, 14);
  const tiles = composerWith(Infinity)._wantedTiles(lng, lat);
  assert.ok(tiles.length >= 1);
  assert.equal(composerWith(1e9)._wantedTiles(lng, lat).length, tiles.length);
});

test('une portée courte ne charge que la tuile où se tient la scène', () => {
  // Centre d'une tuile de zoom 14 : tout le bloc 3×3 du zoom 15 la recouvre.
  const lng = tileXToLng(8000 * 2 + 1, 15);
  const lat = tileYToLat(5000 * 2 + 1, 15);
  const all = composerWith(Infinity)._wantedTiles(lng, lat);
  const near = composerWith(60)._wantedTiles(lng, lat);
  assert.ok(near.length >= 1 && near.length <= all.length);
  assert.ok(near.every((t) => all.some((a) => a.x === t.x && a.y === t.y)), 'jamais une tuile hors du bloc');
});

test('au bord d’une tuile, la voisine reste demandée', () => {
  const lng = tileXToLng(8000 * 2 + 0.001, 15);
  const lat = tileYToLat(5000 * 2 + 1, 15);
  const near = composerWith(60)._wantedTiles(lng, lat);
  assert.ok(near.length >= 2, `une tuile voisine à quelques mètres : ${near.length}`);
});

test('createWorld passe la portée à la bulle et cale le brouillard dessus', async () => {
  const { createWorld } = await import('../src/world.js');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  const near = createWorld({ THREE, scene: new THREE.Scene(), reach: 150, sky: { Sky } });
  const far = createWorld({ THREE, scene: new THREE.Scene(), sky: { Sky } });
  try {
    assert.equal(near.bubble.reachMeters, 150);
    assert.equal(near.environment.fogRadius, 150);
    assert.equal(far.bubble.reachMeters, Infinity);
    assert.ok(far.environment.fogRadius > 150, 'sans portée, le brouillard suit la bulle');
    assert.equal(typeof near.mountAt, 'function');
  } finally {
    near.dispose();
    far.dispose();
  }
});
