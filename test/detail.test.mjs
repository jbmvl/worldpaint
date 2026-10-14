/*
 * Le budget de murs (`createWorld({ detail: { budget } })`) : en ville le rayon
 * des couches et le pas de relève se resserrent avec la densité du lieu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  reachedRadius, budgetedRadius, decorStepFor,
  DECOR_STEP_M, DECOR_STABLE_RADIUS_M, DETAIL_MIN_RADIUS_M, DETAIL_RING_M,
} from '../src/core/decorReach.js';
import { wallLengthsByDistance } from '../src/layers/settlement.js';

const anything = () => new Proxy(function () {}, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : anything()),
  apply: () => anything(),
  set: () => true,
});
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
  createElementNS: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
};

test('reachedRadius lit la portée du décor avant celle de la scène', () => {
  assert.equal(reachedRadius(900, { reachMeters: Infinity, decorReachMeters: 400 }), 400);
  assert.equal(reachedRadius(300, { reachMeters: Infinity, decorReachMeters: 400 }), 300);
  assert.equal(reachedRadius(900, { reachMeters: 120, decorReachMeters: 120 }), 120);
});

test('budgetedRadius : le rayon s’arrête à la couronne qui dépasse le budget, jamais sous le minimum', () => {
  const dense = new Array(40).fill(10000);
  assert.equal(budgetedRadius(dense, 95000), 9 * DETAIL_RING_M, 'bord intérieur de la dixième couronne');
  assert.equal(budgetedRadius(dense, 15000), DETAIL_MIN_RADIUS_M, 'un lieu très dense garde le rayon minimal');
  assert.equal(budgetedRadius([100, , 200], 60000), Infinity, 'budget jamais atteint : tout le détail');
  assert.equal(budgetedRadius(dense, Infinity), Infinity);
  assert.equal(budgetedRadius(dense, 0), Infinity);
});

test('decorStepFor : le pas de relève se resserre avec le rayon, jamais au-delà du pas plein', () => {
  assert.equal(decorStepFor(Infinity), DECOR_STEP_M);
  assert.equal(decorStepFor(DECOR_STABLE_RADIUS_M), DECOR_STEP_M);
  assert.equal(decorStepFor(1500), DECOR_STEP_M);
  assert.equal(decorStepFor(350), 100);
  // L'observateur atteint le pas à (rayon − pas) du bord : la zone stable garde deux pas.
  for (const radius of [300, 400, 600]) assert.ok(radius - decorStepFor(radius) >= 2 * decorStepFor(radius));
  assert.equal(decorStepFor(100), 50);
  assert.equal(decorStepFor(60), 30, 'une portée très courte : jamais plus de la moitié du rayon');
});

test('wallLengthsByDistance range le périmètre des anneaux bâtis par couronne, une lecture par tuile', () => {
  let read = 0;
  const square = (x, y, side) => [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }, { x, y }];
  const layer = {
    extent: 1000,
    length: 2,
    feature: (i) => ({ loadGeometry: () => { read++; return i === 0 ? [square(0, 0, 10)] : [square(500, 0, 20), [{ x: 1, y: 1 }]]; } }),
  };
  const entry = { tile: { layers: { building: layer } }, x: 3, y: 5, z: 14 };
  const source = { entriesOf: () => [entry] };
  // Tuile de 1000 m au zoom du repère, origine à son coin.
  const frame = { zoom: 14, scale: 1000, origin: { x: 3, y: 5 } };
  const rings = wallLengthsByDistance(source, [], frame, { x: 0, z: 0 });
  assert.equal(rings[0], 40, 'le carré de 10 m, à l’origine');
  assert.equal(rings[500 / DETAIL_RING_M], 80, 'le carré de 20 m, à 500 m');
  wallLengthsByDistance(source, [], frame, { x: 0, z: 0 });
  assert.equal(read, 2, 'la tuile n’est décodée qu’une fois');
  assert.deepEqual(wallLengthsByDistance({}, [], frame, { x: 0, z: 0 }), []);
});

test('la bulle resserre portée et pas de relève au rayon du budget', async () => {
  const { createWorld } = await import('../src/world.js');
  const world = createWorld({ THREE, scene: new THREE.Scene() });
  try {
    assert.equal(world.bubble.decorStepMeters, DECOR_STEP_M);
    world.bubble.setDetailBudgetRadius(350);
    assert.equal(world.bubble.decorReachMeters, 350);
    assert.equal(world.bubble.decorStepMeters, 100);
    world.bubble.setDetailBudgetRadius(Infinity);
    assert.equal(world.bubble.decorReachMeters, Infinity);
    assert.equal(world.bubble.decorStepMeters, DECOR_STEP_M);
    world.setReach(200);
    world.bubble.setDetailBudgetRadius(350);
    assert.equal(world.bubble.decorReachMeters, 200, 'la portée du monde passe avant un budget plus large');
  } finally {
    world.dispose();
  }
});
