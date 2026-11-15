import test from 'node:test';
import assert from 'node:assert/strict';
import { FurnitureLayer } from '../src/layers/furnitureLayer.js';
import { appendParcelBoundary } from '../src/layers/furniture/parcels.js';
import { boundaryFurnitureFor } from '../src/layers/furniturePlacement.js';
import { testFrame } from './testFrame.mjs';

/** Un pré carré de 200 m, contour posé en muret ; `woodAt` et `inBuiltUp` disent ce qui l'entoure. */
function wallAround({ woodAt = () => 0, inBuiltUp = null } = {}) {
  const layer = Object.create(FurnitureLayer.prototype);
  layer.bubble = { frame: testFrame };
  layer.groundClass = { woodAt };
  layer._infraIndex = null;
  const walls = [];
  layer._appendDryStoneWall = (buffer, path) => walls.push(path);
  const corners = [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]];
  const ring = corners.map(([x, z]) => {
    const { lng, lat } = testFrame.toLngLat(x, z);
    return [lng, lat];
  });
  appendParcelBoundary(layer, { dryStoneWall: null }, [], 'dryStoneWall', ring, null, () => 0, inBuiltUp);
  return walls;
}

test('un contour de parcelle ne se bâtit pas contre un bois ni contre le village', () => {
  const all = wallAround().flat();
  assert.ok(all.length > 0);
  assert.ok(all.some((p) => p.z < 1), 'le côté nord est bâti en rase campagne');

  // Un bois au nord du pré : ce côté-là n'a pas de muret, les autres en gardent.
  const wooded = wallAround({ woodAt: (x, z) => (z < 0 ? 1 : 0) }).flat();
  assert.ok(wooded.length > 0);
  assert.ok(!wooded.some((p) => p.z < 1 && p.x > 20 && p.x < 180), 'pas de muret le long du bois');

  // Le village à l'est : même chose.
  const village = wallAround({ inBuiltUp: (x) => x > 200 }).flat();
  assert.ok(!village.some((p) => p.x > 199 && p.z > 20 && p.z < 180), 'pas de muret contre le village');
  assert.ok(village.some((p) => p.x < 1), 'le côté ouest reste clos');
});

test('le rocher et l’éboulis ne reçoivent pas de muret, quelle que soit la pente', () => {
  for (const subclass of ['bare_rock', 'scree', undefined]) {
    assert.equal(boundaryFurnitureFor({ class: 'rock', subclass }, { steepness: 1.2 }), null);
  }
});
