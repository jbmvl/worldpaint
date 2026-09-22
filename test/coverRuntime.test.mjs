/* Contrôle des géométries et du semis avec le véritable three, sans GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GroundCover } from '../src/layers/groundCover.js';
import { paddedCoverBands } from '../src/materials/coverTransition.js';
test('le tapis garde ses matrices entre deux chargements et suit la caméra par uniforme', () => {
  const scene = new THREE.Scene();
  const cover = new GroundCover({ THREE, scene, bubble: { frame: {}, verticalScale: 1, surfaceElevationAtLocal: () => 0 }, groundClass: null });
  cover.update(0,0);
  const matrices = cover.mesh.instanceMatrix.array.slice();
  assert.ok(cover.mesh.count > 30000);
  assert.ok(cover.mesh.count < cover.mesh.instanceMatrix.count, 'le tapis ne doit pas saturer');
  assert.equal(cover.material.map, null);
  cover.update(2,0);
  assert.deepEqual(cover.mesh.instanceMatrix.array, matrices);
  assert.equal(cover.material.userData.coverObserver.value.x, 2);
  cover.dispose();
  assert.equal(scene.children.length,0);
});
test('la réserve de semis couvre le déplacement avant le prochain chargement', () => {
  const b = paddedCoverBands([{ from:20,to:70,cell:3.2 }],10)[0];
  assert.ok(b.from <= 10);
  assert.ok(b.to >= 80);
});
