/*
 * `createWorld({ detail })` : un décor allégé pour un appareil modeste. Le rayon
 * plafonne les couches sans figer la scène (relief et tuiles intacts), la
 * densité éclaircit herbe et cultures ; sans `detail`, rien ne change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { reachedRadius } from '../src/core/decorReach.js';
import { coverBand, thinnedCoverBands } from '../src/layers/coverBands.js';

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

test('thinnedCoverBands réduit les tirages par maille, jamais sous un, et rien à pleine densité', () => {
  const bands = [coverBand({ from: 0, to: 55, cell: 2.2, perCell: 16 }), coverBand({ from: 50, to: 90, cell: 4, perCell: 2 })];
  assert.equal(thinnedCoverBands(bands, 1), bands);
  assert.equal(thinnedCoverBands(bands, undefined), bands);
  const thin = thinnedCoverBands(bands, 0.4);
  assert.deepEqual(thin.map((b) => b.perCell), [6, 1]);
  assert.equal(thin[0].cell, 2.2);
  assert.equal(bands[0].perCell, 16, 'les bandes d’origine ne sont pas touchées');
});

test('createWorld : le rayon du détail plafonne le décor, pas la portée de la scène', async () => {
  const { createWorld } = await import('../src/world.js');
  const light = createWorld({ THREE, scene: new THREE.Scene(), detail: { radius: 400, density: 0.4 } });
  const full = createWorld({ THREE, scene: new THREE.Scene() });
  const fixed = createWorld({ THREE, scene: new THREE.Scene(), reach: 120, detail: { radius: 400 } });
  try {
    assert.equal(light.bubble.reachMeters, Infinity, 'relief et tuiles restent ceux de la bulle');
    assert.equal(light.bubble.decorReachMeters, 400);
    assert.equal(full.bubble.decorReachMeters, Infinity);
    assert.equal(fixed.bubble.decorReachMeters, 120);
    assert.ok(light.composer.grass._bands[0].perCell < full.composer.grass._bands[0].perCell);
    assert.ok(light.composer.crops._bands[0].perCell < full.composer.crops._bands[0].perCell);
  } finally {
    light.dispose();
    full.dispose();
    fixed.dispose();
  }
});
