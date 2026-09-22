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
  assert.ok(cover.mesh.count > 20000);
  assert.ok(cover.mesh.count < cover.mesh.instanceMatrix.count, 'le tapis ne doit pas saturer');
  assert.equal(cover.material.map, null);
  assert.ok(cover.flowers.meshes[0].count>0, "les fleurs blanches sont conservées");
  assert.ok(cover.flowers.meshes[1].count>0, "les fleurs jaunes sont conservées");
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

test('la maille d’herbe porte neuf racines distinctes et aucune rampe de couleur', async () => {
  const {createGrassBlade,GRASS_BLADES_PER_PATCH}=await import('../src/layers/grassGeometry.js');
  const color=[.05,.135,.017];
  const geometry=createGrassBlade(THREE,{root:color,tip:[1,1,1]});
  assert.equal(geometry.index.count/3,GRASS_BLADES_PER_PATCH*3);
  const a=geometry.attributes;
  const roots=new Set();
  for(let i=0;i<a.position.count;i+=5) {
    roots.add(`${a.position.getX(i).toFixed(3)}:${a.position.getZ(i).toFixed(3)}`);
    for(let j=i;j<i+5;j++) assert.deepEqual(Array.from(a.color.array.slice(j*3,j*3+3)),Array.from(a.color.array.slice(0,3)));
  }
  assert.equal(roots.size,9);
  geometry.dispose();
});

test('les racines réparties suivent une pente sans coucher les brins', () => {
  const scene=new THREE.Scene();
  const cover=new GroundCover({THREE,scene,bubble:{frame:{},verticalScale:1,surfaceElevationAtLocal:(x,z)=>x*.2+z*.1},groundClass:null});
  cover.update(0,0);
  const matrix=new THREE.Matrix4();cover.mesh.getMatrixAt(0,matrix);
  const pos=cover.geometry.attributes.position;
  for(let i=0;i<pos.count;i+=5) {
    const root=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(matrix);
    assert.ok(Math.abs(root.y-root.x*.2-root.z*.1)<1e-4);
  }
  assert.equal(matrix.elements[4],0);
  assert.equal(matrix.elements[6],0);
  cover.dispose();
});

test('les coquelicots restent présents au bord des cultures', () => {
  const scene=new THREE.Scene();
  const cover=new GroundCover({THREE,scene,bubble:{frame:{},verticalScale:1,surfaceElevationAtLocal:()=>0},
    groundClass:{sampleAt:()=>({grass:.6,wood:0,farmland:.4,bare:0})}});
  cover.update(0,0);
  assert.ok(cover.flowers.meshes[2].count>0);
  cover.dispose();
});
