/* Chats et chiens de maison : jamais dans un bâtiment, ni posés ni en marche. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomesticFauna, circuitClear, insideAnyHouse } from '../src/layers/furniture/domesticFauna.js';

/** Un hameau serré : des longères en biais, mitoyennes à trois mètres. */
function hamlet() {
  const houses = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      const cx = i * 12;
      const cz = j * 9;
      houses.push({ x: cx, z: cz, box: { cx, cz, angle: 0.3, long: 5, short: 3 } });
    }
  }
  return houses;
}

function fakeLayer() {
  return {
    fauna: [],
    _places: [{ name: 'Le Hameau', x: 120, z: 90, class: 'hamlet' }],
    _onRoad: () => false,
    _coatFor: () => [1, 1, 1],
    bubble: { surfaceElevationAtLocal: () => 0, verticalScale: 1 },
  };
}

test('un rectangle orienté contient son centre et ses coins, pas au-delà de la marge', () => {
  const houses = [{ box: { cx: 0, cz: 0, angle: Math.PI / 2, long: 6, short: 2 } }];
  assert.ok(insideAnyHouse(houses, 0, 0, 0));
  assert.ok(insideAnyHouse(houses, 0, 5.9, 0));
  assert.ok(!insideAnyHouse(houses, 5.9, 0, 0));
});

test('aucune bête domestique ne se pose ni ne marche dans une maison', () => {
  const houses = hamlet();
  const layer = fakeLayer();
  const placed = buildDomesticFauna(layer, houses);
  assert.ok(placed > 0);
  for (const animal of layer.fauna) {
    assert.ok(!insideAnyHouse(houses, animal.x, animal.z, 0), `${animal.kind} à ${animal.x},${animal.z}`);
    assert.ok(circuitClear(animal.circuit, (x, z) => insideAnyHouse(houses, x, z, 0)));
  }
});
