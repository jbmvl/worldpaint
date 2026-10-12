/*
 * Ce qu'une relève du décor ne doit plus allouer ni décoder pour rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VectorTileSource } from '../src/core/vectorTileSource.js';
import { ElevationField } from '../src/core/elevationField.js';
import { WorldComposer } from '../src/worldComposer.js';

function sourceWith(features) {
  const source = new VectorTileSource({ tiles: ['memoire://{z}/{x}/{y}'], zoom: 14 });
  const decoded = [];
  const layer = {
    length: features.length,
    feature: (i) => ({
      properties: features[i],
      toGeoJSON: () => {
        decoded.push(i);
        return { geometry: { type: 'Point', coordinates: [0, 0] }, properties: features[i] };
      },
    }),
  };
  source.tiles.set('14/0/0', { tile: { layers: { poi: layer } }, x: 0, y: 0, z: 14 });
  return { source, decoded };
}

test('forEachFeature : une entité écartée sur ses propriétés n’est pas décodée', () => {
  const { source, decoded } = sourceWith([{ class: 'bus' }, { class: 'cafe' }, { class: 'bus' }]);
  const seen = [];
  source.forEachFeature('poi', [{ x: 0, y: 0 }], (geometry, properties) => seen.push(properties.class),
    (properties) => properties.class === 'bus');
  assert.deepEqual(seen, ['bus', 'bus']);
  assert.deepEqual(decoded, [0, 2]);
});

test('forEachFeature : sans filtre, tout est décodé comme avant', () => {
  const { source, decoded } = sourceWith([{ class: 'bus' }, { class: 'cafe' }]);
  let count = 0;
  source.forEachFeature('poi', [{ x: 0, y: 0 }], () => count++);
  assert.equal(count, 2);
  assert.deepEqual(decoded, [0, 1]);
});

test('le pixel du MNT suit le changement de tuile et de révision sans réallouer sa réserve', () => {
  const field = new ElevationField({ zoom: 1, maxTiles: 4 });
  const size = field.tilePixels;
  field.tiles.set('1/0/0', new Float32Array(size * size).fill(10));
  field.tiles.set('1/1/0', new Float32Array(size * size).fill(20));
  assert.equal(field._pixel(0, 0), 10);
  const reserve = field._last;
  assert.equal(field._pixel(size, 0), 20);
  assert.equal(field._last, reserve);
  field.tiles.set('1/0/0', new Float32Array(size * size).fill(30));
  field.revision++;
  assert.equal(field._pixel(0, 0), 30);
});

test('settling : vrai tant que le décor se construit ou s’achève image par image', () => {
  const settling = Object.getOwnPropertyDescriptor(WorldComposer.prototype, 'settling').get;
  const calm = { _refreshing: false, bubble: { rebuilding: false }, vegetation: { pending: false }, grass: { pending: false } };
  assert.equal(settling.call(calm), false);
  assert.equal(settling.call({ ...calm, _refreshing: true }), true);
  assert.equal(settling.call({ ...calm, bubble: { rebuilding: true } }), true);
  assert.equal(settling.call({ ...calm, vegetation: { pending: true } }), true);
  assert.equal(settling.call({ ...calm, grass: { pending: true } }), true);
});
