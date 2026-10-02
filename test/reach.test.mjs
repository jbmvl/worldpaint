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

test('la végétation ne sème que les tuiles et cellules à portée', async () => {
  const { VegetationLayer } = await import('../src/layers/vegetationLayer.js');
  const frame = { origin: { x: 0, y: 0 }, scale: 800 };
  const tiles = new Map(
    [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [`${x}:${y}`, { key: `${x}:${y}`, x, y, ring: 0 }])
  );
  const layer = Object.create(VegetationLayer.prototype);
  Object.assign(layer, {
    disposed: false,
    maxRing: 1,
    bubble: { frame, tiles },
    queue: [],
    _planted: new Set(),
    _stale: new Set(),
    _partial: new Map(),
  });

  layer.sync();
  assert.equal(layer.queue.length, 4, 'sans portée, toutes les tuiles');

  // Observateur dans la tuile (0,0), à 100 m de ses bords haut et gauche : 120 m ne touchent qu'elle.
  layer.setReach({ x: 100, z: 100 }, 120);
  layer.sync();
  assert.deepEqual(layer.queue, ['0:0']);
  assert.equal(layer._beyondReach(100, 100, 25), false);
  assert.equal(layer._beyondReach(600, 600, 25), true);

  layer.setReach(null, Infinity);
  layer.sync();
  assert.equal(layer.queue.length, 4, 'la limite se lève');
});

/** Bulle de terrain réduite à `setCenter` et ce qu'il lit avant de charger le relief. */
function terrainWith(reach, blockSize = 3) {
  const bubble = Object.create(TerrainBubble.prototype);
  Object.assign(bubble, { _reach: reach, zoom: 15, blockSize });
  return bubble;
}
const tilesAroundPoint = (fx, fy, reach) => {
  const lat = tileYToLat(11200 + fy, 15);
  const t = { x: 8000 + fx, y: 11200 + fy };
  const all = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) all.push({ x: 8000 + dx, y: 11200 + dy, ring: Math.max(Math.abs(dx), Math.abs(dy)) });
  }
  return terrainWith(reach)._withinReach(all, t, lat).map((w) => `${w.x - 8000},${w.y - 11200}`).sort();
};

test('le terrain d’une scène figée ne monte que les tuiles qui touchent la portée', () => {
  assert.equal(terrainWith(Infinity)._withinReach(['tout'], {}, 0)[0], 'tout', 'sans portée, rien ne change');
  assert.deepEqual(tilesAroundPoint(0.5, 0.5, 100), ['0,0'], 'au milieu de sa tuile : une seule');
  assert.deepEqual(tilesAroundPoint(0.8, 0.5, 160), ['0,0', '1,0'], 'près d’un bord : la voisine');
  assert.deepEqual(tilesAroundPoint(0.9, 0.9, 160), ['0,0', '0,1', '1,0', '1,1'], 'près d’un coin : quatre');
  assert.equal(tilesAroundPoint(0.5, 0.5, 5000).length, 9, 'portée immense : tout le bloc');
});

test('la carte du sol ne relit qu’une fenêtre autour de la portée, au même pas de texel', async () => {
  const { GroundClassMap, CLASS_PIXELS, CLASS_AREA_M, surfaceSignature } = await import('../src/terrain/groundClassMap.js');
  const { finishGeneration } = await import('../src/core/generationSteps.js');
  const perMeter = CLASS_PIXELS / CLASS_AREA_M;
  const mapWith = (reach) => {
    const map = new GroundClassMap({ THREE, reach });
    map.texture.dispose();
    return map;
  };

  assert.deepEqual(mapWith(undefined)._windowAround(768, 768, perMeter), { x: 0, y: 0, size: CLASS_PIXELS });
  const near = mapWith(120)._windowAround(768, 768, perMeter);
  assert.ok(near.size < CLASS_PIXELS / 4, `fenêtre de ${near.size} texels`);
  assert.ok(near.size / perMeter >= 2 * 120, 'la fenêtre couvre la portée');
  assert.ok(Math.abs(near.x + near.size / 2 - 768) <= 1, 'centrée sur l’observateur');
  const corner = mapWith(120)._windowAround(5, CLASS_PIXELS - 5, perMeter);
  assert.equal(corner.x, 0);
  assert.equal(corner.y + corner.size, CLASS_PIXELS, 'au bord, la fenêtre reste dans la carte');

  // Une fenêtre muette : la carte entière doit l'être, fenêtre et pourtour confondus.
  const map = mapWith(120);
  map._window = near;
  const silent = new Uint8ClampedArray(near.size * near.size * 4);
  for (let p = 0; p < near.size * near.size; p++) silent.set([0, 0, surfaceSignature(0), 255], p * 4);
  map.ctx = { getImageData: (x, y, w, h) => {
    assert.deepEqual([x, y, w, h], [near.x, near.y, near.size, near.size]);
    return { data: silent };
  } };
  finishGeneration(map.readBackSteps());
  assert.equal(map._data.length, CLASS_PIXELS * CLASS_PIXELS * 4);
  const first = map._data.slice(0, 4).join();
  const inside = ((near.y + 3) * CLASS_PIXELS + near.x + 3) * 4;
  assert.equal(map._data.slice(inside, inside + 4).join(), first, 'le pourtour porte ce que la fenêtre muette porte');
  assert.equal(map._data[0], 0, 'matière muette');
});

test('au-delà de la portée, le terrain n’est pas creusé', () => {
  const bubble = Object.create(TerrainBubble.prototype);
  let sampled = 0;
  Object.assign(bubble, {
    _reachDisc: { x: 0, z: 0, radius2: 200 * 200 },
    _earthworks: { sample: (x, z, raw) => { sampled++; return { elevation: raw - 1, mask: 1 }; } },
    _unpaved: null,
    _roadCut: null,
  });
  assert.deepEqual(bubble._roadCutWithMask(300, 0, 10), { elevation: 10, mask: 0 });
  assert.equal(sampled, 0, 'aucun terrassement lu hors portée');
  assert.equal(bubble._roadCutWithMask(50, 0, 10).elevation, 9, 'à portée, le terrassement s’applique');
  bubble._reachDisc = null;
  assert.equal(bubble._roadCutWithMask(300, 0, 10).elevation, 9, 'sans portée, partout');
});

test('mountAt maille le terrain une seule fois, après le décor, et rend une scène achevée', async () => {
  const calls = [];
  const composer = Object.create(WorldComposer.prototype);
  let queue = 2;
  let seeds = 3;
  Object.assign(composer, {
    _refreshTask: null,
    bubble: {
      setCenter: async (lng, lat, options) => { calls.push(['setCenter', options.meshes]); },
      processRebuildQueue: (budget) => { calls.push(['maille', budget]); return queue-- > 0; },
    },
    vegetation: {
      get pending() { return seeds > 0; },
      processQueue: () => { seeds--; },
    },
    refresh: async (lng, lat, options) => { calls.push(['refresh', options.force, options.budgetMs]); return true; },
  });
  assert.equal(await composer.mountAt(1, 2), true);
  assert.deepEqual(calls[0], ['setCenter', false], 'pas de maille avant le déblai');
  assert.equal(calls[1][0], 'refresh');
  assert.equal(calls[1][1], true);
  assert.ok(calls[1][2] >= 50, 'le décor se monte sans pauses à chaque image');
  assert.ok(calls.slice(2).every(([name, budget]) => name === 'maille' && budget === Infinity));
  assert.equal(queue, -1, 'la file des mailles est vide');
  assert.equal(seeds, 0, 'le semis est achevé');
});
