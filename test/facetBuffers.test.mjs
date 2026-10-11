import test from 'node:test';
import assert from 'node:assert/strict';
import { GrowingArray, createFacetBuffer, indexFacetPairs } from '../src/layers/facetBuffers.js';

test('GrowingArray grandit sans perdre ce qui est déjà posé', () => {
  const array = new GrowingArray(Float32Array);
  for (let i = 0; i < 5000; i++) array.push(i, i + 0.5);
  assert.equal(array.length, 10000);
  assert.equal(array.data[9998], 4999);
  assert.equal(array.data[9999], 4999.5);
});

test('une normale et une couleur hors bornes sont écrêtées, pas repliées', () => {
  const buffer = createFacetBuffer();
  buffer.normals.push(-1, 0.5, 1.2);
  buffer.colors.push(-0.1, 0.5, 1.5);
  assert.deepEqual([...buffer.normals.data.subarray(0, 3)], [-127, 64, 127]);
  assert.deepEqual([...buffer.colors.data.subarray(0, 3)], [0, 32768, 65535]);
});

function facets(vertices) {
  const buffer = createFacetBuffer();
  for (const [x, y, z, tone = 0.5] of vertices) {
    buffer.positions.push(x, y, z);
    buffer.normals.push(0, 0, 1);
    buffer.colors.push(tone, tone, tone);
  }
  return buffer;
}

function triangles(buffer, count, index) {
  const p = buffer.positions.data;
  return [...index].map((v) => (v < count ? [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]] : null));
}

test('un pan posé en deux triangles garde quatre sommets, et ses triangles', () => {
  const pan = [[0, 0, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]];
  const buffer = facets([...pan, [5, 5, 5], [6, 5, 5], [5, 6, 5]]);
  const { count, index } = indexFacetPairs(buffer.positions.data, buffer.normals.data, buffer.colors.data, 9);
  assert.equal(count, 7);
  assert.equal(index.length, 9);
  assert.deepEqual(triangles(buffer, count, index), [...pan, [5, 5, 5], [6, 5, 5], [5, 6, 5]]);
});

test('deux triangles de teintes différentes ne partagent aucun sommet', () => {
  const buffer = facets([
    [0, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 0, 0, 0.2],
    [0, 0, 0, 0.8], [0, 1, 0, 0.8], [1, 1, 0, 0.8],
  ]);
  const { count, index } = indexFacetPairs(buffer.positions.data, buffer.normals.data, buffer.colors.data, 6);
  assert.equal(count, 6);
  assert.deepEqual([...index], [0, 1, 2, 3, 4, 5]);
});

test('un triangle isolé avant un pan ne décale pas l’appariement', () => {
  const lone = [[9, 9, 9], [8, 9, 9], [9, 8, 9]];
  const pan = [[0, 0, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]];
  const buffer = facets([...lone, ...pan]);
  const { count, index } = indexFacetPairs(buffer.positions.data, buffer.normals.data, buffer.colors.data, 9);
  assert.equal(count, 7);
  assert.deepEqual(triangles(buffer, count, index), [...lone, ...pan]);
});
