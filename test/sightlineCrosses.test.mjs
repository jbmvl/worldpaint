import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSightline, setSightline, sightlineCrosses } from '../src/materials/sightlineClearing.js';

test('seuls les maillages à portée de la ligne de mire portent l’effacement', () => {
  const line = createSightline(THREE);
  const near = new THREE.Sphere(new THREE.Vector3(0, 1, -3), 1);
  const far = new THREE.Sphere(new THREE.Vector3(40, 1, -3), 5);
  assert.equal(sightlineCrosses(line, near), false, 'ligne éteinte');
  setSightline(line, { x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: -8 });
  assert.equal(sightlineCrosses(line, near), true);
  assert.equal(sightlineCrosses(line, far), false);
  assert.equal(sightlineCrosses(line, new THREE.Sphere(new THREE.Vector3(0, 0, 300), 400)), true, 'un maillage étendu qui englobe la ligne');
});
