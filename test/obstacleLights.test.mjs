/* Les balises suivent les ouvrages et le cycle nocturne sans modifier le rotor. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ObstacleLights, obstacleFlash } from '../src/layers/obstacleLights.js';
import { defaultTheme } from '../src/themes/default.js';
import { FURNITURE_BUILDERS, WIND_TURBINE_BEACON } from '../src/layers/furnitureKit.js';

test('le flash rouge alterne un éclair bref et une extinction complète avec des bords doux', () => {
  assert.equal(obstacleFlash(0.15), 1);
  assert.equal(obstacleFlash(1), 0);
  assert.equal(obstacleFlash(2.15), 1);
  assert.ok(obstacleFlash(0.03) > 0 && obstacleFlash(0.03) < 1);
  assert.equal(obstacleFlash(NaN), 0);
});

test('les balises suivent hauteur, échelle et lacet puis disparaissent au retrait des objets', () => {
  const group = new THREE.Group();
  const lights = new ObstacleLights({ THREE, group });
  const mast = { x: 5, y: 20, z: -2, yaw: 0, scale: 2 };
  const turbine = { x: 100, y: 12, z: 70, yaw: Math.PI / 2, scale: 1 };
  lights.set([mast], [turbine]);
  assert.equal(lights.mesh.count, 2);
  assert.equal(lights.mesh.visible, false);
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  lights.mesh.getMatrixAt(0, matrix); p.setFromMatrixPosition(matrix);
  const forme = defaultTheme.furniture.radioMast, feu = defaultTheme.furniture.obstacleLight;
  assert.ok(Math.abs(p.y - (20 + (forme.heightM + forme.spireM + feu.lensM / 2) * 2)) < 1e-5);
  lights.mesh.getMatrixAt(1, matrix); p.setFromMatrixPosition(matrix);
  assert.equal(p.x, turbine.x + WIND_TURBINE_BEACON.z);
  assert.equal(p.z, turbine.z);
  lights.setNight(1); lights.advance(0.15);
  assert.equal(lights.mesh.visible, true);
  assert.equal(lights.material.uniforms.uOpacity.value, 1);
  const version = lights.mesh.instanceMatrix.version;
  lights.advance(0.85);
  assert.equal(lights.material.uniforms.uOpacity.value, 0);
  assert.equal(lights.mesh.instanceMatrix.version, version);
  lights.setNight(0);
  assert.equal(lights.material.uniforms.uOpacity.value, 0);
  assert.equal(lights.mesh.visible, false);
  lights.set([], []);
  assert.equal(lights.mesh.count, 0);
  lights.dispose();
  assert.equal(group.children.length, 0);
});

test('le treillis reste fini, déterministe et borné ; la balise de nacelle ne tourne pas', () => {
  const mast = FURNITURE_BUILDERS.radioMast();
  assert.ok(mast.vertexCount / 3 < 2200);
  assert.deepEqual(mast.positions, FURNITURE_BUILDERS.radioMast().positions);
  for (const value of [...mast.positions, ...mast.normals, ...mast.colors]) assert.ok(Number.isFinite(value));
  const turbine = FURNITURE_BUILDERS.windTurbine();
  let lentille = 0;
  for (let i = 0; i < turbine.vertexCount; i++) {
    const [x, y, z] = turbine.positions.slice(i * 3, i * 3 + 3);
    if (Math.abs(x) <= 0.12 && y >= WIND_TURBINE_BEACON.y && Math.abs(z - WIND_TURBINE_BEACON.z) < 0.12) {
      assert.equal(turbine.spins[i], 0); lentille++;
    }
  }
  assert.ok(lentille >= 36);
});
