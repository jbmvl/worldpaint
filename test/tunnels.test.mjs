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
