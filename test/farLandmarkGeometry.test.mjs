/*
 * La silhouette lointaine d'un repère : posée au sol à son pied, gabarit du
 * thème sans emprise, clocher aux proportions du bâti proche, quelques
 * dizaines de triangles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFarLandmarks, farLandmarkBox, farLandmarkKit } from '../src/layers/farLandmarkGeometry.js';
import { towerRise, towerSide } from '../src/layers/buildingLayer.js';
import { createFacetBuffer } from '../src/layers/facetBuffers.js';
import { defaultTheme } from '../src/themes/default.js';

const personalities = defaultTheme.personalities;

function extent(kit) {
  const ys = [], xs = [];
  for (let i = 0; i < kit.positions.length; i += 3) { xs.push(kit.positions[i]); ys.push(kit.positions[i + 1]); }
  return { minY: Math.min(...ys), maxY: Math.max(...ys), minX: Math.min(...xs), maxX: Math.max(...xs) };
}

test('chaque personnalité notable a une silhouette légère posée au sol', () => {
  for (const kind of ['church', 'castle', 'mosque', 'ruin']) {
    const kit = farLandmarkKit({ kind, x: 0, z: 0 }, { personalities });
    assert.ok(kit, kind);
    const triangles = kit.positions.length / 9;
    assert.ok(triangles > 0 && triangles <= 300, `${kind} : ${triangles} triangles`);
    assert.ok(Math.abs(extent(kit).minY) < 1e-9, `${kind} repose au sol`);
  }
  assert.equal(farLandmarkKit({ kind: 'tall', x: 0, z: 0 }, { personalities }), null);
  assert.equal(farLandmarkKit({ kind: 'rampart', x: 0, z: 0 }, { personalities }), null);
});

test("sans emprise, le gabarit du thème ; avec, l'emprise publiée", () => {
  const far = personalities.church.far;
  assert.deepEqual(farLandmarkBox({ x: 0, z: 0 }, far), {
    box: { cx: 0, cz: 0, long: far.lengthM / 2, short: far.widthM / 2, angle: 0 },
    height: far.eavesM,
  });
  const published = farLandmarkBox({ x: 0, z: 0, size: 20, short: 7, angle: 0.3, y: 100, top: 118 }, far);
  assert.deepEqual(published, { box: { cx: 0, cz: 0, long: 20, short: 7, angle: 0.3 }, height: 18 });
});

test('la flèche monte où monte celle du bâti proche', () => {
  const far = personalities.church.far;
  const box = { long: far.lengthM / 2, short: far.widthM / 2 };
  const kit = farLandmarkKit({ kind: 'church', x: 0, z: 0 }, { personalities });
  const rise = Math.max(6, far.eavesM) + towerRise(box);
  const expected = rise + towerSide(box, rise) * 1.5;
  assert.ok(Math.abs(extent(kit).maxY - expected) < 1e-9);
});

test("l'angle de l'emprise tourne la nef", () => {
  const along = extent(farLandmarkKit({ kind: 'church', x: 0, z: 0, size: 20, short: 5, angle: 0 }, { personalities }));
  const across = extent(farLandmarkKit({ kind: 'church', x: 0, z: 0, size: 20, short: 5, angle: Math.PI / 2 }, { personalities }));
  assert.ok(along.maxX - along.minX > 39);
  assert.ok(across.maxX - across.minX < 12);
});

test('un temple antique se dit par ses colonnes, une ruine sans nom par ses pans', () => {
  const temple = farLandmarkKit({ kind: 'ruin', name: 'Tempio della Concordia', x: 0, z: 0 }, { personalities });
  const remains = farLandmarkKit({ kind: 'ruin', x: 0, z: 0 }, { personalities });
  assert.notEqual(temple.positions.length, remains.positions.length);
});

test('le tampon reçoit chaque silhouette à son pied, au sol', () => {
  const buffer = createFacetBuffer();
  const ground = (x, z) => 40 + x * 0.01 + z * 0.02;
  const landmarks = [
    { kind: 'church', x: 2400, z: -800 },
    { kind: 'castle', x: -3100, z: 1500 },
    { kind: 'shop', x: 0, z: 0 },
  ];
  assert.equal(appendFarLandmarks(buffer, landmarks, { personalities, groundAt: ground }), 2);
  const positions = buffer.positions.data.subarray(0, buffer.positions.length);
  let low = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i] - 2400) < 40) low = Math.min(low, positions[i + 1]);
  }
  assert.ok(Math.abs(low - ground(2400, -800)) < 1e-3);
  assert.equal(buffer.normals.length, buffer.positions.length);
  assert.equal(buffer.colors.length, buffer.positions.length);
});
