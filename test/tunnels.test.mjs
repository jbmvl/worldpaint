/* Gabarit ouvert et chaussée continue, y compris sur un ouvrage long. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelWorkSpans, WORK_NONE, WORK_TUNNEL } from '../src/layers/roadWorks.js';
import { appendProfile, createProfileBuffer } from '../src/layers/ribbonGeometry.js';
import { vaultProfile } from '../src/layers/bridgeLayer.js';
test('un tunnel de deux kilomètres suit ses entrées plutôt que la montagne', () => {
 const path=Array.from({length:21},(_,i)=>({x:i*100,z:0,distance:i*100}));
 const heights=new Float32Array(21).fill(500);heights[0]=100;heights[20]=120;
 const works=Array(21).fill(WORK_TUNNEL);works[0]=works[20]=WORK_NONE;
 levelWorkSpans(path,heights,works);
 assert.equal(heights[10],110);
});
test('la voûte ne possède aucune face bouchant une entrée', () => {
 const buffer=createProfileBuffer();
 const profile=vaultProfile(3,{arch:[.1,.1,.1]});
 appendProfile(buffer,{path:[{x:0,z:0},{x:0,z:20}],profile,baseHeights:[0,0],closed:false,smoothRadius:0});
 for(let i=0;i<buffer.indices.length;i+=3) {
   const z=buffer.indices.slice(i,i+3).map(n=>buffer.positions[n*3+2]);
   assert.notEqual(Math.min(...z),Math.max(...z),'aucun bouchon transversal');
 }
});

test('les lanternes éclairent localement avec un budget de deux lumières et se libèrent', async () => {
  const THREE=await import('three');
  const {TunnelLighting}=await import('../src/layers/tunnelLighting.js');
  const {defaultTheme}=await import('../src/themes/default.js');
  const scene=new THREE.Scene();
  const lighting=new TunnelLighting(THREE,scene,defaultTheme.tunnelLights);
  lighting.rebuild([{x:0,y:4,z:0},{x:0,y:4,z:18},{x:0,y:4,z:36}]);
  lighting.update({x:0,y:0,z:10});
  assert.equal(lighting.lights.filter(l=>l.visible).length,2);
  assert.ok(lighting.lights.every(l=>l.intensity>0 && !l.castShadow));
  lighting.update({x:100,y:0,z:100});
  assert.ok(lighting.lights.every(l=>!l.visible));
  lighting.dispose();
  assert.equal(scene.children.length,0);
});

test('le front ferme les côtés au-dessus de l’arc tout en gardant la chaussée ouverte', async () => {
  const THREE=await import('three');
  const {BridgeLayer}=await import('../src/layers/bridgeLayer.js');
  const {toColoredGeometry}=await import('../src/layers/ribbonGeometry.js');
  const buffer=createProfileBuffer();
  const layer=Object.create(BridgeLayer.prototype);
  layer._buildPortalFace(buffer,[{x:0,z:0},{x:0,z:20}],[0,0],3,
    {portal:{face:[.4,.4,.4],arch:[.1,.1,.1],crown:1.4,jamb:2}},0,()=>8);
  const geometry=toColoredGeometry(THREE,buffer);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.updateMatrixWorld();
  const hit=(x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,-5),new THREE.Vector3(0,0,1)).intersectObject(mesh).length;
  assert.ok(hit(2.8,4.1)>0);
  assert.ok(hit(-2.8,4.1)>0);
  assert.equal(hit(0,1.5),0);
  geometry.dispose();material.dispose();
});
