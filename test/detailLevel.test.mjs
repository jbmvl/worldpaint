/*
 * Le niveau de détail d'une image (`createWorld({ detail: { level } })`) :
 * `'full'` est le rendu par défaut, à l'identique ; `'light'` dessine moins des
 * mêmes plantes, jamais d'autres.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { VegetationLayer, UNDERSTORY_FULL_M, UNDERSTORY_LIGHT_M } from '../src/layers/vegetationLayer.js';
import { VEGETATION_DETAIL_M, VEGETATION_DETAIL_LIGHT_M } from '../src/layers/vegetationDetail.js';

const anything = () => new Proxy(function () {}, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : anything()),
  apply: () => anything(),
  set: () => true,
});
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
  createElementNS: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
};

const bois = (options = {}) => {
  const tile = { key: 't', x: 0, y: 0, ring: 0 };
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(),
    bubble: { frame: { zoom: 15, scale: 834, origin: { x: 0, y: 0 } }, tiles: new Map([['t', tile]]),
      surfaceElevationAtLocal: () => 0, verticalScale: 1 },
    groundClass: { woodAt: () => 1, coverageOf: () => 1 }, ...options });
  layer._build(tile);
  return layer;
};
const blocs = (layer) => [...layer.meshes.values()].flat()
  .sort((a, b) => a.name.localeCompare(b.name) || a.boundingSphere.center.x - b.boundingSphere.center.x ||
    a.boundingSphere.center.z - b.boundingSphere.center.z || a.userData.treeVariant - b.userData.treeVariant);
const compiled = (material) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  return { vertex: shader.vertexShader, key: material.customProgramCacheKey() };
};

test('le niveau complet est le rendu par défaut, shader compris', () => {
  const defaut = bois();
  const complet = bois({ level: 'full' });
  try {
    assert.deepEqual(defaut._detailM, VEGETATION_DETAIL_M);
    assert.deepEqual(complet._understoryM, defaut._understoryM);
    assert.deepEqual(compiled(complet.understoryMaterial), compiled(defaut.understoryMaterial));
    for (const layer of [defaut, complet]) layer.update(417 + 260, 417, { force: true });
    const [a, b] = [blocs(defaut), blocs(complet)];
    assert.deepEqual(b.map((m) => [m.count, m.userData.treeDetail]), a.map((m) => [m.count, m.userData.treeDetail]));
  } finally {
    defaut.dispose();
    complet.dispose();
  }
});

test('le niveau économe dessine un sous-ensemble du même semis, plus simple plus tôt', () => {
  const complet = bois();
  const leger = bois({ level: 'light' });
  try {
    assert.notEqual(compiled(leger.understoryMaterial).key, compiled(complet.understoryMaterial).key,
      'un autre programme : les seuils sont écrits dans le shader');
    assert.ok(compiled(leger.understoryMaterial).vertex.includes(`${UNDERSTORY_LIGHT_M[0].toFixed(1)}`));
    let eclaircis = 0;
    let simplifies = 0;
    for (const [x, z] of [[417, 417], [417 + 180, 417], [417 + 400, 417 + 100]]) {
      for (const layer of [complet, leger]) layer.update(x, z, { force: true });
      const [a, b] = [blocs(complet), blocs(leger)];
      assert.equal(b.length, a.length);
      a.forEach((full, i) => {
        const light = b[i];
        assert.deepEqual(light.instanceMatrix.array, full.instanceMatrix.array, 'mêmes plantes, même ordre');
        assert.ok(light.count <= full.count, 'jamais plus de plantes');
        assert.ok(light.userData.treeDetail >= full.userData.treeDetail, 'jamais plus de détail');
        if (light.count < full.count) eclaircis++;
        if (light.userData.treeDetail > full.userData.treeDetail) simplifies++;
        // À portée pleine du niveau économe, rien ne manque.
        const s = light.boundingSphere;
        if (light.userData.full && Math.hypot(s.center.x - x, s.center.z - z) - s.radius <= UNDERSTORY_LIGHT_M[0]) {
          assert.equal(light.count, light.userData.full);
        }
      });
    }
    assert.ok(eclaircis > 0 && simplifies > 0, `${eclaircis} blocs éclaircis, ${simplifies} simplifiés`);
    assert.ok(UNDERSTORY_LIGHT_M[0] < UNDERSTORY_FULL_M && VEGETATION_DETAIL_LIGHT_M[0] < VEGETATION_DETAIL_M[0]);
  } finally {
    complet.dispose();
    leger.dispose();
  }
});

test('createWorld passe le niveau au ciel et aux arbres, et refuse un niveau inconnu', async () => {
  const { createWorld, DETAIL_LEVELS } = await import('../src/world.js');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  assert.deepEqual(DETAIL_LEVELS, ['full', 'light']);
  assert.throws(() => createWorld({ THREE, scene: new THREE.Scene(), detail: { level: 'low' } }), /detail\.level/);
  const defaut = createWorld({ THREE, scene: new THREE.Scene(), sky: { Sky } });
  const complet = createWorld({ THREE, scene: new THREE.Scene(), sky: { Sky }, detail: { level: 'full' } });
  const leger = createWorld({ THREE, scene: new THREE.Scene(), sky: { Sky }, detail: { level: 'light', radius: 375 } });
  try {
    const ciel = (world) => world.environment.sky.material.fragmentShader;
    assert.equal(ciel(complet), ciel(defaut));
    assert.ok(ciel(defaut).includes('i < 5'));
    assert.ok(ciel(leger).includes('i < 3') && !ciel(leger).includes('i < 5'));
    assert.deepEqual(defaut.composer.vegetation._detailM, VEGETATION_DETAIL_M);
    assert.deepEqual(leger.composer.vegetation._detailM, VEGETATION_DETAIL_LIGHT_M);
  } finally {
    defaut.dispose();
    complet.dispose();
    leger.dispose();
  }
});
