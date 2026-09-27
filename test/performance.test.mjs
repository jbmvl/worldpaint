/* Une optimisation doit préserver les sommets et invalider ses données. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { GenerationMetrics } from '../src/inspect/generationMetrics.js';
test('le cache DEM évite les relectures et conserve exactement le maillage', () => {
 const b=Object.create(TerrainBubble.prototype);let reads=0;
 Object.assign(b,{THREE,elevation:{revision:0},verticalScale:1,frame:{scale:100,tileToLocal:(x,z)=>({x:x*100,z:z*100})},group:new THREE.Group(),materials:{material:new THREE.MeshLambertMaterial()},_sample:(x,z)=>{reads++;return x*3+z*2;},segmentsForTile:()=>8,_edgeSegmentsFor:()=>({north:8,south:8,east:8,west:8}),_cliffTouches:()=>false,_neighboursLoaded:()=>true});
 Object.defineProperty(b,'_gradientStep',{value:.01});
 const tile={x:0,y:0,ring:0};b._buildMesh(tile);
 const positions=tile.mesh.geometry.attributes.position.array.slice();const first=reads;
 const geometry=tile.mesh.geometry;b._buildMesh(tile);
 assert.equal(reads,first);assert.equal(tile.mesh.geometry,geometry);
 assert.deepEqual(tile.mesh.geometry.attributes.position.array,positions);
 b.elevation.revision++;b._buildMesh(tile);assert.ok(reads>first);
 b._disposeTile(tile);b.materials.material.dispose();
});
test('un recreusement à finesse égale ne déplace pas la surface', () => {
 const b=Object.create(TerrainBubble.prototype);
 Object.assign(b,{THREE,elevation:{revision:0},verticalScale:1,frame:{scale:100,tileToLocal:(x,z)=>({x:x*100,z:z*100})},group:new THREE.Group(),materials:{material:new THREE.MeshLambertMaterial()},_sample:(x,z)=>x+z,segmentsForTile:()=>8,_edgeSegmentsFor:()=>({north:8,south:8,east:8,west:8}),_cliffTouches:()=>false,_neighboursLoaded:()=>true,_rebuildQueue:[],_surfaceDirty:false,_surfaceGeneration:0});
 Object.defineProperty(b,'_gradientStep',{value:.01});
 const tile={x:0,y:0,ring:0};b._buildMesh(tile);b._settleSurface();
 assert.equal(b.surfaceGeneration,1);
 b._buildMesh(tile);b._settleSurface();
 assert.equal(b.surfaceGeneration,1);
 b._disposeTile(tile);b.materials.material.dispose();
});
test('le profilage est désactivable et enregistre aussi les erreurs', () => {
 const m=new GenerationMetrics();const o={run(){throw new Error('test');}};
 m.watch(o,'run','generation');assert.throws(()=>o.run());assert.deepEqual(m.snapshot(),{});
 m.enabled=true;assert.throws(()=>o.run());assert.equal(m.snapshot().generation.calls,1);
 m.reset();assert.deepEqual(m.snapshot(),{});
});
test('une tuile reconstruite en étapes garde sa géométrie affichée jusqu’à la dernière', () => {
 const b=Object.create(TerrainBubble.prototype);let slope=1;
 Object.assign(b,{THREE,elevation:{revision:0},verticalScale:1,frame:{scale:100,tileToLocal:(x,z)=>({x:x*100,z:z*100})},group:new THREE.Group(),materials:{material:new THREE.MeshLambertMaterial()},_sample:(x,z)=>slope*(x+z),segmentsForTile:()=>8,_edgeSegmentsFor:()=>({north:8,south:8,east:8,west:8}),_cliffTouches:()=>false,_neighboursLoaded:()=>true});
 Object.defineProperty(b,'_gradientStep',{value:.01});
 const tile={x:0,y:0,ring:0};b._buildMesh(tile);
 const shown=tile.mesh.geometry.attributes.position.array.slice();
 slope=2;b.elevation.revision++;
 const steps=b._buildMeshSteps(tile);let calls=0;
 while(!steps.next().done){calls++;assert.deepEqual(tile.mesh.geometry.attributes.position.array,shown);}
 assert.ok(calls>=8);
 const stepped=tile.mesh.geometry.attributes.position.array.slice();
 b._buildMesh(tile);
 assert.notDeepEqual(stepped,shown);assert.deepEqual(tile.mesh.geometry.attributes.position.array,stepped);
 b._disposeTile(tile);b.materials.material.dispose();
});
