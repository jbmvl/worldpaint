/* Un toit pris pour du relief est ramené au sol, sous une emprise de bâtiment seulement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoofCut, roofGround, ROOF_BLEND_M } from '../src/terrain/roofCut.js';

const square = (x0, z0, size, clockwise = false) => {
  const ring = [{ x: x0, z: z0 }, { x: x0 + size, z: z0 }, { x: x0 + size, z: z0 + size }, { x: x0, z: z0 + size }];
  return clockwise ? ring.reverse() : ring;
};
// Une tour de 40 m dans le MNT sur 30 m de côté, débordant de 3 m, posée sur un sol en pente douce.
const ground = (x, z) => 10 + 0.02 * x + 0.01 * z;
const tower = (x, z) => ground(x, z) + (x > -3 && x < 33 && z > -3 && z < 33 ? 40 : 0);

test('un toit dans le MNT est reconnu, quel que soit le sens du contour', () => {
  for (const clockwise of [false, true]) {
    const cut = roofGround(square(0, 0, 30, clockwise), tower);
    assert.ok(cut, clockwise ? 'sens horaire' : 'sens trigonométrique');
    assert.ok(Math.abs(cut.plane.a + cut.plane.b * (15 - cut.plane.cx) + cut.plane.c * (15 - cut.plane.cz) - ground(15, 15)) < 0.5);
  }
});

test('une emprise posée sur un relief sans toit ne change rien', () => {
  assert.equal(roofGround(square(0, 0, 30), ground), null);
  // Un versant raide n'est pas un toit : le plan de l'anneau le suit.
  assert.equal(roofGround(square(0, 0, 30), (x, z) => 100 + 0.6 * x), null);
});

test('le sol corrigé est le plan alentour, raccordé sur un pixel, et ne fait que baisser', () => {
  const geometry = { type: 'Polygon', coordinates: [square(0, 0, 30).map((p) => [p.x, p.z])] };
  const source = { forEachFeature: (layer, tiles, fn) => layer === 'building' && fn(geometry, {}) };
  const frame = { toLocal: (x, z) => ({ x, z }) };
  const roofs = new RoofCut({ frame, elevationAt: tower });
  roofs.rebuild(source, []);
  assert.equal(roofs.count, 1);
  assert.ok(Math.abs(roofs.elevationAt(15, 15, tower(15, 15)) - ground(15, 15)) < 0.5);
  // Le bord du cône, dans le raccord, baisse aussi ; au-delà, rien.
  assert.ok(roofs.elevationAt(-2, 15, tower(-2, 15)) < tower(-2, 15));
  assert.equal(roofs.elevationAt(-ROOF_BLEND_M - 1, 15, 7), 7);
  // Un relief déjà sous le plan n'est jamais relevé.
  assert.equal(roofs.elevationAt(15, 15, 2), 2);
  assert.ok(roofs.touches(0, 0, 10, 10));
  assert.ok(!roofs.touches(500, 500, 510, 510));
});
