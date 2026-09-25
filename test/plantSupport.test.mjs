/* Le cache GPU dépend du sol, de sa matière et du repère, jamais de la caméra. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlantSupportAtlas } from '../src/terrain/plantSupportAtlas.js';

function support() {
  const value = value => ({ value });
  const uniforms = {
    uSurfaceMap: value(null), uSurfaceOrigin: value(new THREE.Vector2()), uSurfaceSize: value(100),
    uSurfaceEnabled: value(0), uUnclassified: value(1), uGrainCellM: value(6), uGrainAmplitudeM: value(1.4),
    uSlopeRange: value(new THREE.Vector2(.2, .8)), uRockGrain: value(new THREE.Vector2(3, 2)),
    uSurfaceGrainCell: value([6]), uSurfaceGrainAmplitude: value([1.4]),
  };
  const geometry = new THREE.PlaneGeometry(10, 10, 1, 1); geometry.rotateX(-Math.PI / 2);
  const tile = { key: 'sol', geometry, segments: 1, size: 10 };
  const atlas = new PlantSupportAtlas(THREE, uniforms);
  atlas.sync([tile], 0);
  let target = { name: 'cible de l’application' };
  const renderer = {
    calls: 0, info: { autoReset: true }, xr: { enabled: true }, shadowMap: { autoUpdate: true, needsUpdate: true },
    extensions: { has: () => true },
    getRenderTarget: () => target, getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 1,
    setRenderTarget(next, face, level) { target = next; this.face = face; this.level = level; },
    render() { this.calls++; },
  };
  return { atlas, renderer, tile, uniforms, geometry };
}

test('les appuis ne sont préparés que quand leurs entrées changent', () => {
  const { atlas, renderer, tile, uniforms, geometry } = support();
  const matrix = new THREE.Matrix4();
  atlas.prepare(renderer, matrix); const target = atlas.bakeTarget;
  atlas.prepare(renderer, matrix); assert.equal(renderer.calls, 1);
  atlas.sync([tile], 1); atlas.prepare(renderer, matrix); assert.equal(renderer.calls, 2);
  assert.equal(atlas.bakeTarget, target);
  uniforms.uSurfaceGrainAmplitude.value[0] = 2;
  atlas.prepare(renderer, matrix); assert.equal(renderer.calls, 3);
  matrix.makeTranslation(2, 3, 4);
  atlas.prepare(renderer, matrix); assert.equal(renderer.calls, 4);
  assert.deepEqual(atlas.bakeMaterial.uniforms.uPlantModelMatrix.value.elements, matrix.elements);
  assert.equal(renderer.getRenderTarget().name, 'cible de l’application');
  assert.equal(renderer.face, 2); assert.equal(renderer.level, 1);
  assert.equal(renderer.xr.enabled, true); assert.equal(renderer.info.autoReset, true);
  assert.deepEqual(renderer.shadowMap, { autoUpdate: true, needsUpdate: true });
  atlas.dispose(); geometry.dispose();
});

test('une erreur de préparation restaure les réglages du renderer', () => {
  const { atlas, renderer, geometry } = support();
  renderer.render = () => { throw new Error('interruption'); };
  assert.throws(() => atlas.prepare(renderer, new THREE.Matrix4()), /interruption/);
  assert.equal(renderer.getRenderTarget().name, 'cible de l’application');
  assert.equal(renderer.xr.enabled, true); assert.equal(renderer.info.autoReset, true);
  assert.deepEqual(renderer.shadowMap, { autoUpdate: true, needsUpdate: true });
  assert.equal(atlas.uniforms.uPlantBaked.value, 0);
  atlas.dispose(); geometry.dispose();
});

test('sans cible flottante les plantes gardent leur calcul direct', () => {
  const { atlas, renderer, geometry } = support();
  renderer.extensions.has = () => false;
  atlas.prepare(renderer, new THREE.Matrix4());
  assert.equal(renderer.calls, 0); assert.equal(atlas.uniforms.uPlantBaked.value, 0);
  assert.equal(atlas.bakeTarget, undefined);
  atlas.dispose(); geometry.dispose();
});

test('les ressources supplémentaires sont libérées avec l’atlas', () => {
  const { atlas, renderer, geometry } = support();
  atlas.prepare(renderer, new THREE.Matrix4());
  let disposed = 0;
  for (const resource of [atlas.texture, atlas.bakeTarget, atlas.bakeMaterial, atlas.bakeMesh.geometry]) {
    resource.addEventListener('dispose', () => disposed++);
  }
  atlas.dispose(); assert.equal(disposed, 4); geometry.dispose();
});

test('le repli CPU reste nécessaire si une racine pourrait sortir de l’atlas', () => {
  const { atlas, geometry } = support();
  atlas.uniforms.uPlantTiles.value[0].set(0, 0, 5, 2);
  assert.equal(atlas.coversPatch(5, 5, .5), true);
  assert.equal(atlas.coversPatch(.1, 5, .5), false);
  assert.equal(atlas.coversPatch(9.8, 5, .5), false);
  assert.equal(atlas.coversPatch(5, 10, 0), false);
  atlas.dispose(); geometry.dispose();
});
