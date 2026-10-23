/* Les fantômes de cimetière ne paraissent qu'en pleine nuit et flottent sans réécrire leurs matrices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CemeteryGhosts } from '../src/layers/cemeteryGhosts.js';
import { defaultTheme } from '../src/themes/default.js';

test('les fantômes restent cachés de jour et au crépuscule, paraissent en pleine nuit', () => {
  const ghosts = new CemeteryGhosts({ THREE, group: new THREE.Group() });
  ghosts.set([{ x: 1, y: 10, z: 2, phase: 0.3 }]);
  assert.equal(ghosts.mesh.count, 1);
  assert.equal(ghosts.mesh.visible, false);
  ghosts.setNight(defaultTheme.furniture.ghost.fromNight);
  assert.equal(ghosts.mesh.visible, false);
  ghosts.setNight(1);
  assert.equal(ghosts.mesh.visible, true);
  assert.equal(ghosts.material.uniforms.uOpacity.value, 1);
  const version = ghosts.mesh.instanceMatrix.version;
  ghosts.advance(0.5);
  assert.equal(ghosts.mesh.instanceMatrix.version, version);
  ghosts.set([]);
  assert.equal(ghosts.mesh.visible, false);
  ghosts.dispose();
});

test('un fantôme flotte au-dessus du sol, à sa taille', () => {
  const ghosts = new CemeteryGhosts({ THREE, group: new THREE.Group() });
  ghosts.set([{ x: 0, y: 5, z: 0, phase: 0, scale: 1 }]);
  const look = defaultTheme.furniture.ghost;
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  ghosts.mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m);
  assert.ok(Math.abs(p.y - (5 + look.floatM + look.heightM / 2)) < 1e-6);
  ghosts.dispose();
});
