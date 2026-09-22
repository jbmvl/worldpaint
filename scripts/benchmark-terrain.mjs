/* Banc CPU reproductible, sans réseau ni GPU : maillage d'une tuile DEM. */
import * as THREE from 'three';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { ElevationField } from '../src/core/elevationField.js';
const elevation = new ElevationField({zoom:15});
for(let z=-1;z<=1;z++) for(let x=-1;x<=1;x++) {
  const heights=new Float32Array(256*256);
  for(let j=0;j<256;j++) for(let i=0;i<256;i++) heights[j*256+i]=100+30*Math.sin((i+x*256)*.013)*Math.cos((j+z*256)*.015);
  elevation._store(`15/${x}/${z}`,heights);
}
const bubble=Object.create(TerrainBubble.prototype);
Object.assign(bubble,{THREE,elevation,zoom:15,_demScale:1,verticalScale:1,segmentsByRing:[192,96,48],_centerTile:{x:0,y:0},frame:{scale:1000,tileToLocal:(x,z)=>({x:x*1000,z:z*1000})},group:new THREE.Group(),materials:{material:new THREE.MeshLambertMaterial()},_cutGeneration:0,_cliffGeneration:0});
const tile={x:0,y:0,key:'test',ring:0};
let samples=0; const sample=bubble._sample.bind(bubble); bubble._sample=(...args)=>{samples++;return sample(...args);};
const times=[];
for(let i=0;i<12;i++) {const start=performance.now();bubble._buildMesh(tile);times.push(performance.now()-start);}
console.log(JSON.stringify({case:'tuile 192×192, 12 reconstructions, DEM fixe',firstMs:times[0],medianWarmMs:times.slice(2).sort((a,b)=>a-b)[5],demSamples:samples,vertices:tile.mesh.geometry.attributes.position.count,triangles:tile.mesh.geometry.index.count/3},null,2));
tile.mesh.geometry.dispose();bubble.materials.material.dispose();
