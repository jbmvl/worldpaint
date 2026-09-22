/* Même description d'arbre, positions et couleur pour les deux distances. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { treePrototype } from '../src/models/treeKit.js';
import { TreeVolumes } from '../src/layers/treeVolumes.js';
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

test('le fondu proche se fait au-delà de 120 mètres sans bruit de découpe', () => {
  const group=new THREE.Group(); const volumes=new TreeVolumes(THREE,group,defaultTheme);
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>'};
  volumes.material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('diffuseColor.a *= smoothstep'));
  assert.ok(!shader.fragmentShader.includes('coverThreshold'));
  const band=volumes.batches[0].geometry.attributes.aCoverBand.array;
  assert.equal(band[1],190);
  assert.equal(band[3],70);
  volumes.dispose();
});
