import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { coloredProfileGeometrySteps, ribbonProfileGeometrySteps, storedProfileGeometrySteps } from '../src/layers/profileGeometry.js';
import { toColoredGeometry, toGeometry } from '../src/layers/ribbonGeometry.js';
import { packColoredGeometry, createProfileStore, drainProfileBuffer, profileStoreGeometry } from '../src/layers/facetBuffers.js';
import { finishGeneration } from '../src/core/generationSteps.js';

function buffer(size) {
  const positions = [], colors = [], indices = [];
  for (let i = 0; i < size; i++) {
    positions.push(Math.sin(i), Math.cos(i / 3), i / 7);
    colors.push(i % 7 / 7, .3, .21);
    if (i > 1) indices.push(i - 2, i - 1, i);
  }
  return { positions, colors, indices };
}
for (const flat of [false, true]) for (const packed of [false, true]) {
  test(`conversion coopérative identique, flat=${flat}, packed=${packed}`, () => {
    const data = buffer(5011);
    let expected = toColoredGeometry(THREE, data, { flat });
    if (packed) expected = packColoredGeometry(THREE, expected);
    const actual = finishGeneration(coloredProfileGeometrySteps(THREE, data, { flat, packed }));
    for (const key of ['position','color','normal']) {
      assert.equal(actual.attributes[key].normalized, expected.attributes[key].normalized);
      assert.deepEqual(actual.attributes[key].array, expected.attributes[key].array, key);
    }
    assert.deepEqual(actual.index?.array, expected.index?.array);
    assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
  });
}
test('une grande géométrie rend la main avant de publier un résultat', () => {
  const steps = coloredProfileGeometrySteps(THREE, buffer(12000), { flat:true, packed:true });
  let turns = 0, result;
  do { result = steps.next(); turns++; } while (!result.done);
  assert.ok(turns > 30);
  assert.ok(result.value.attributes.position.count > 30000);
});
test('un tampon vide ne publie aucune géométrie', () => {
  assert.equal(finishGeneration(coloredProfileGeometrySteps(THREE,{positions:[]})),null);
});

test('ruban texturé : positions, normales, UV et bornes identiques', () => {
  const data=buffer(7123);delete data.colors;
  data.uvs=data.positions.flatMap((v,i)=>i%3===2?[]:[v]);
  data.tips=data.uvs.map(v=>v/3);
  const expected=toGeometry(THREE,data);
  const actual=finishGeneration(ribbonProfileGeometrySteps(THREE,data));
  assert.deepEqual(Object.keys(actual.attributes).sort(), Object.keys(expected.attributes).sort());
  for(const key of Object.keys(expected.attributes)) assert.deepEqual(actual.attributes[key].array,expected.attributes[key].array,key);
  assert.deepEqual(actual.index.array,expected.index.array);
  assert.deepEqual(actual.boundingSphere,expected.boundingSphere);
});

test('une réserve de voirie conserve son encodage et ses tableaux après le découpage', () => {
  const store=createProfileStore();drainProfileBuffer(store,buffer(8123));
  const expected=profileStoreGeometry(THREE,store);
  const actual=finishGeneration(storedProfileGeometrySteps(THREE,store));
  for(const key of Object.keys(expected.attributes)) {
    assert.deepEqual(actual.attributes[key].array,expected.attributes[key].array,key);
    assert.equal(actual.attributes[key].normalized,expected.attributes[key].normalized,key);
  }
  assert.deepEqual(actual.index.array,expected.index.array);assert.deepEqual(actual.boundingSphere,expected.boundingSphere);
  assert.equal(actual.attributes.position.array.buffer,store.positions.data.buffer);
});
