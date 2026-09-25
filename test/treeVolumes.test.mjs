/* Même description d'arbre, positions et couleur pour les deux distances. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { treePrototype } from '../src/models/treeKit.js';
import { TreeVolumes, TREE_VOLUME_BUDGET } from '../src/layers/treeVolumes.js';
import { defaultTheme } from '../src/themes/default.js';
test('les prototypes sont déterministes, bornés et sans triangle dégénéré', () => {
  defaultTheme.trees.variants.slice(0,9).forEach((v,i) => {
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
test('le volume proche garde le placement du peuplement et libère ses lots', () => {
  const group=new THREE.Group(); const volumes=new TreeVolumes(THREE,group,defaultTheme);
  volumes.set('a',[{variant:0,x:20,y:3,z:0,height:14,aspect:.7,rotation:.4,color:[1,1,1]}]);
  volumes.update(0,0);
  assert.equal(volumes.batches[0].count,1);
  assert.equal(volumes.batches[0].instanceMatrix.array[12],20);
  volumes.update(300,0); assert.equal(volumes.batches[0].count,0);
  volumes.dispose(); assert.equal(group.children.length,0);
});

test('le fondu proche conserve la profondeur et la découpe dans les ombres', () => {
  const group=new THREE.Group(); const volumes=new TreeVolumes(THREE,group,defaultTheme);
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>'};
  volumes.material.onBeforeCompile(shader);
  assert.equal(volumes.material.transparent, false);
  assert.equal(volumes.material.depthWrite, true);
  assert.ok(shader.fragmentShader.includes('coverThreshold'));
  const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  volumes.batches[0].customDepthMaterial.onBeforeCompile(depth);
  assert.ok(depth.fragmentShader.includes('coverThreshold'));
  assert.equal(depth.uniforms.uCoverObserver, shader.uniforms.uCoverObserver);
  const band=volumes.batches[0].geometry.attributes.aCoverBand.array;
  assert.equal(band[1],190);
  assert.equal(band[3],70);
  volumes.dispose();
});

import { VegetationLayer } from '../src/layers/vegetationLayer.js';
import { createTreeAtlasCanvas, TREE_ATLAS_OFFSETS } from '../src/materials/proceduralTextures.js';

function canvasTemoin(action) {
  const touched = new Set();
  let cell = 0;
  const stack = [];
  const mark = () => touched.add(cell);
  const ctx = {
    save() { stack.push(cell); }, restore() { cell = stack.pop(); },
    translate(x, y) { if (stack.length === 1) cell = x / 160 + y / 160 * 4; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {},
    quadraticCurveTo() {}, scale() {}, rotate() {}, fill: mark, stroke: mark, fillRect: mark,
  };
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { Object.assign(this, { width, height }); }
    getContext() { return ctx; }
  };
  try { action(touched); } finally { globalThis.OffscreenCanvas = previous; }
}

const placement = (variant, x, z = 0) => ({ variant, x, z, y: 0, height: 10, aspect: .7, rotation: 0, color: [1, 1, 1] });
const bandes = count => {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  for (let i = 0; i < count; i++) attribute.array.set([0, 1e7, 0, 0], i * 4);
  return attribute;
};

test('les quinze variantes et toutes les essences ont un atlas et une représentation proche', () => {
  canvasTemoin(touched => {
    createTreeAtlasCanvas();
    const volumes = new TreeVolumes(THREE, new THREE.Group(), defaultTheme);
    const plants = defaultTheme.trees.variants.map((_, i) => placement(i, i));
    const bands = bandes(plants.length);
    volumes.set('essences', plants, bands);
    volumes.update(0, 0);
    assert.equal(plants.length, 15);
    for (const indices of Object.values(defaultTheme.trees.essences)) for (const i of indices) {
      assert.ok(touched.has(i), `atlas vide pour ${i}`);
      assert.ok(TREE_ATLAS_OFFSETS[i].every(Number.isFinite));
      if (i < 9) {
        assert.equal(volumes.batches[i].count, 1, `volume absent pour ${i}`);
        assert.equal(bands.getX(i), 120);
      } else assert.equal(bands.getX(i), 0, `silhouette basse masquée pour ${i}`);
    }
    volumes.dispose();
  });
});

test('les plans du peuplement et les buissons écrivent leur profondeur sans tri transparent', () => {
  canvasTemoin(() => {
    const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(), bubble: {} });
    for (const material of [layer.standMaterial, layer.thicketMaterial]) {
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
      assert.equal(material.depthTest, true);
      assert.equal(material.alphaTest, .5);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
      material.onBeforeCompile(shader);
      assert.ok(shader.fragmentShader.includes('coverThreshold'));
    }
    layer.dispose();
  });
});

test('le budget conserve les plans excédentaires et privilégie les proches indépendamment des tuiles', () => {
  const volumes = new TreeVolumes(THREE, new THREE.Group(), defaultTheme);
  const plants = Array.from({ length: TREE_VOLUME_BUDGET + 20 }, (_, i) => placement(7, i / 100));
  const bands = bandes(plants.length);
  volumes.set('dense', plants.toReversed(), bands);
  volumes.update(0, 0);
  assert.equal(volumes.batches[7].count, TREE_VOLUME_BUDGET);
  assert.equal(volumes.selected[0].p.x, 0);
  assert.equal(bands.getX(0), 0);
  assert.equal(bands.getX(plants.length - 1), 120);
  assert.deepEqual(volumes.batches[7].instanceMatrix.updateRanges, [{ start: 0, count: TREE_VOLUME_BUDGET * 16 }]);
  const positions = volumes.selected.map(entry => entry.p.x);
  volumes.set('dense', null);
  volumes.set('première', plants.slice(0, 1000));
  volumes.set('seconde', plants.slice(1000));
  volumes.update(0, 0);
  assert.deepEqual(volumes.selected.map(entry => entry.p.x), positions);
  volumes.update(500, 0);
  assert.equal(volumes.batches[7].count, 0);
  assert.ok(bands.array.every((v, i) => i % 4 !== 0 || v === 0));
  volumes.dispose();
});

test('une tuile lointaine n’est pas parcourue et un retrait invalide les volumes sans déplacement', () => {
  const volumes = new TreeVolumes(THREE, new THREE.Group(), defaultTheme);
  const far = placement(0, 1000);
  volumes.set('loin', [far]);
  Object.defineProperty(far, 'variant', { get() { throw new Error('placement lointain parcouru'); } });
  volumes.set('près', [placement(0, 0)]);
  volumes.update(0, 0);
  assert.equal(volumes.batches[0].count, 1);
  volumes.set('près', null);
  volumes.update(0, 0);
  assert.equal(volumes.batches[0].count, 0);
  volumes.dispose();
});
