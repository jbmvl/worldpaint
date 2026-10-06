/* Arbres et buissons : un prototype en volume par silhouette, rangé par bloc. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { treePrototype } from '../src/models/treeKit.js';
import { VegetationLayer, VEGETATION_BLOCK_M, understoryShare, understoryWeight, UNDERSTORY_FULL_M, UNDERSTORY_FAR_M } from '../src/layers/vegetationLayer.js';
import { plantedTree } from '../src/layers/plantedTrees.js';
import { defaultTheme } from '../src/themes/default.js';

test('les prototypes sont déterministes, bornés et sans triangle dégénéré', () => {
  defaultTheme.trees.variants.forEach((v,i) => {
    const p=treePrototype(v,i);
    assert.deepEqual(p.positions,treePrototype(v,i).positions);
    for(let j=0;j<p.positions.length;j+=3) {
      assert.ok(Math.abs(p.positions[j])<=.5);
      assert.ok(p.positions[j+1]>=0 && p.positions[j+1]<=1);
      const length=Math.hypot(...p.normals.slice(j,j+3));
      assert.ok(length>.99 && length<1.01);
    }
  });
});
const placement = (variant, x, z = 0) => ({ variant, x, z, y: 0, height: 10, aspect: .7, rotation: 0, color: [1, 1, 1] });
const couche = (options = {}) => new VegetationLayer({ THREE, scene: new THREE.Scene(),
  bubble: { frame: {}, surfaceElevationAtLocal: () => 0, verticalScale: 1 }, ...options });

test('toutes les silhouettes des essences ont un volume', () => {
  const layer = couche();
  const plants = defaultTheme.trees.variants.map((_, i) => placement(i, 0));
  layer.setPlants('essences', plants);
  const variants = new Set(layer.meshes.get('essences').map(m => layer.prototypes.indexOf(m.geometry)));
  for (const indices of Object.values(defaultTheme.trees.essences)) for (const i of indices) {
    assert.ok(variants.has(i), `volume absent pour ${i}`);
  }
  layer.dispose();
});

test('un maillage par bloc et par silhouette, à la position du semis', () => {
  const layer = couche();
  const plants = [placement(0, 10), placement(0, 20), placement(0, VEGETATION_BLOCK_M + 10), placement(5, 10)];
  layer.setPlants('t', plants);
  const meshes = layer.meshes.get('t');
  assert.deepEqual(meshes.map(m => m.count).sort(), [1, 1, 2]);
  for (const mesh of meshes) {
    assert.equal(mesh.frustumCulled, true, 'l’élimination hors champ travaille par bloc');
    assert.ok(mesh.boundingSphere, 'sphère englobante du bloc');
  }
  const first = meshes.find(m => m.count === 2);
  assert.equal(first.instanceMatrix.array[12], 10);
  assert.equal(first.instanceMatrix.array[16 + 12], 20);
  layer.dispose();
});

test('une relève retire les anciennes instances sans toucher au prototype partagé', () => {
  const layer = couche();
  layer.setPlants('t', [placement(0, 10)]);
  const [previous] = layer.meshes.get('t');
  let disposed = 0;
  layer.prototypes[0].addEventListener('dispose', () => disposed++);
  layer.setPlants('t', [placement(0, 12)]);
  assert.equal(previous.parent, null);
  assert.equal(layer.meshes.get('t')[0].geometry, layer.prototypes[0]);
  layer.setPlants('t', []);
  assert.equal(layer.meshes.has('t'), false);
  assert.equal(disposed, 0);
  layer.dispose();
});

test('un terrassement resème les bois à leur place sans les retirer d’abord', () => {
  const tile = { key: 'k', ring: 0 };
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(),
    bubble: { frame: {}, tiles: new Map([['k', tile]]) } });
  layer._planted.add('k');
  layer.setPlants('k', [placement(0, 10)]);
  const meshes = layer.meshes.get('k');
  layer.sync({ resettle: true });
  assert.equal(layer.meshes.get('k'), meshes, 'le bois reste affiché tant qu’il n’est pas resemé');
  assert.deepEqual(layer.queue, ['k']);
  layer.dispose();
});

const bois = () => {
  const tile = { key: 't', x: 0, y: 0, ring: 0 };
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(),
    bubble: { frame: { scale: 834, origin: { x: 0, y: 0 } }, tiles: new Map([['t', tile]]),
      surfaceElevationAtLocal: () => 0, verticalScale: 1 },
    groundClass: { woodAt: () => 1, coverageOf: () => 1 } });
  return { layer, tile };
};
const decrits = layer => layer.meshes.get('t/sous-etage').flatMap(m =>
  Array.from({ length: m.userData.full }, (_, i) => `${m.instanceMatrix.array[i * 16 + 12].toFixed(3)}:${m.instanceMatrix.array[i * 16 + 14].toFixed(3)}:${m.userData.treeVariant}`)).sort();

test('le sous-étage est semé par tuile, sans dépendre de l’observateur', () => {
  const { layer, tile } = bois();
  layer.update(0, 0, { force: true });
  layer._build(tile);
  const avant = decrits(layer);
  assert.ok(avant.length > 1000, `${avant.length} plantes`);
  layer.update(300, 200, { force: true });
  layer._build(tile);
  assert.deepEqual(decrits(layer), avant);
  const meshes = layer.meshes.get('t/sous-etage');
  assert.ok(meshes.length > 0);
  assert.ok(meshes.every(m => m.castShadow === false && m.receiveShadow));
  layer.remove('t');
  assert.equal(layer.meshes.has('t/sous-etage'), false);
  layer.dispose();
});

test('un bloc éclairci range ses plantes par poids, lu dans leur orientation', () => {
  const layer = couche();
  const turns = [0.7, 0.1, 0.9, 0.4];
  const plants = turns.map((turn, i) => ({ ...placement(0, i), rotation: turn * Math.PI * 2 }));
  plants.forEach((p, i) => assert.ok(Math.abs(understoryWeight(p) - turns[i]) < 1e-9));
  const [mesh] = layer._instances(plants, layer.understoryMaterial, 'essai', false, true);
  const xs = [0, 1, 2, 3].map(i => mesh.instanceMatrix.array[i * 16 + 12]);
  assert.deepEqual(xs, [1, 3, 0, 2]);
  // Le poids relu dans la matrice, comme le fait le shader.
  for (let i = 0; i < 4; i++) {
    const a = mesh.instanceMatrix.array;
    const turn = Math.atan2(-a[i * 16 + 2], a[i * 16]) / (Math.PI * 2);
    assert.ok(Math.abs((turn - Math.floor(turn)) - [0.1, 0.4, 0.7, 0.9][i]) < 1e-6);
  }
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  layer.understoryMaterial.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('if (understoryWeight >= understoryShare) transformed = vec3(0.0);'));
  assert.ok(shader.vertexShader.includes(`${UNDERSTORY_FULL_M.toFixed(1)}`));
  layer.dispose();
});

test('l’éclaircie garde un sous-ensemble des mêmes plantes, jamais à moins de 500 m', () => {
  assert.equal(understoryShare(0), 1);
  assert.equal(understoryShare(UNDERSTORY_FULL_M), 1);
  assert.equal(understoryShare(UNDERSTORY_FAR_M), 0);
  const { layer, tile } = bois();
  layer._build(tile);
  const meshes = layer.meshes.get('t/sous-etage');
  // L'observateur au centre de la tuile, puis au loin.
  layer.update(417, 417, { force: true });
  const proches = meshes.filter(m => Math.hypot(m.boundingSphere.center.x - 417, m.boundingSphere.center.z - 417) - m.boundingSphere.radius <= UNDERSTORY_FULL_M);
  assert.ok(proches.length > 0);
  assert.ok(proches.every(m => m.count === m.userData.full), 'complet sous 500 m');
  layer.update(417 + 900, 417, { force: true });
  assert.ok(meshes.some(m => m.count < m.userData.full), 'au loin, le sous-étage s’éclaircit');
  layer.update(417, 417, { force: true });
  assert.ok(proches.every(m => m.count === m.userData.full), 'le retour rend le même bloc complet');
  layer.dispose();
});

test('toutes les plantations ont une variante valide et un tirage stable', () => {
  for (const kind of Object.keys(defaultTheme.trees.plantations)) {
    const p = { x: 31, y: 4, z: 12, scale: 1 };
    const a = plantedTree(kind, p, defaultTheme.trees);
    assert.deepEqual(a, plantedTree(kind, p, defaultTheme.trees));
    assert.ok(defaultTheme.trees.variants[a.variant]);
    assert.equal(a.y, p.y);
    assert.notDeepEqual(a, plantedTree(kind, { ...p, x: 32 }, defaultTheme.trees));
  }
});

import { buildRows } from '../src/layers/furniture/parcels.js';

test('les rangs de verger publient des pommiers sans changer les arbres isolés', () => {
  const plants = [];
  const layer = {
    counts: { rows: 0 },
    _clipOffRoad: path => [path],
    _place(placements, item, p) { const plant = { ...p, y: 0, item }; plants.push(plant); return plant; },
  };
  const ring = [{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }];
  buildRows(layer, { placements: new Map(), buffers: {}, sampleElevation: () => 0 }, ring, { x: 0, z: 0 }, 'orchard', { x: 0, z: 0 });
  assert.ok(plants.length > 0);
  for (const p of plants) {
    assert.equal(p.plantation, 'treeApple');
    const fruitier = plantedTree(p.plantation, p, defaultTheme.trees);
    assert.equal(defaultTheme.trees.variants[fruitier.variant].kind, 'apple');
    assert.deepEqual(fruitier, plantedTree(p.plantation, p, defaultTheme.trees));
    const isole = plantedTree(p.item, p, defaultTheme.trees);
    assert.equal(defaultTheme.trees.variants[isole.variant].fruit, undefined);
  }
});

test('les pommes sont des facettes du prototype, sans instances supplémentaires', () => {
  const variant = defaultTheme.trees.plantations.treeApple.variants[0];
  const look = defaultTheme.trees.variants[variant];
  const withFruit = treePrototype(look, variant);
  const withoutFruit = treePrototype({ ...look, fruit: null }, variant);
  assert.equal(withFruit.positions.length - withoutFruit.positions.length,
    (look.volume.lobes ?? 5) * look.fruit.perLobe * 8 * 9);
  const layer = couche();
  layer.setPlants('verger', [placement(variant, 0)]);
  assert.deepEqual(layer.meshes.get('verger').map(m => m.count), [1]);
  layer.dispose();
});

test('la ligne de mire efface les arbres entre caméra et sujet, jamais leur ombre', () => {
  const layer = couche();
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  layer.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vSightPoint = (modelMatrix * instanceMatrix'));
  assert.ok(shader.fragmentShader.includes('if (sightKeep <= sightNoise) discard;'));
  assert.equal(shader.uniforms.uSightRadius.value.z, 0, 'inactive tant que personne ne la pose');
  const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  layer.depthMaterial.onBeforeCompile(depth);
  assert.equal(depth.fragmentShader.includes('sightKeep'), false);
  layer.setSightline({ x: 0, y: 5, z: 16 }, { x: 0, y: 1.6, z: 0 }, { fromRadius: 4 });
  assert.deepEqual(shader.uniforms.uSightTo.value.toArray(), [0, 1.6, 0]);
  assert.deepEqual(shader.uniforms.uSightRadius.value.toArray(), [4, 1.2, 1]);
  const under = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  layer.understoryMaterial.onBeforeCompile(under);
  assert.equal(under.uniforms.uSightFrom, shader.uniforms.uSightFrom, 'sous-étage et peuplement partagent la même ligne');
  layer.setSightline(null, null);
  assert.equal(shader.uniforms.uSightRadius.value.z, 0);
  layer.dispose();
});
