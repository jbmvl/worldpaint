/* Le déblai protège les triangles entre rues, y compris près des plis. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { networkOfJunctions } from './junctionWorld.mjs';

const road=(z,height)=>({path:[{x:-20,z},{x:20,z}],halfWidth:2,paved:true,
  platform:Float32Array.of(height,height)});
const context=(roads,areas=null)=>({_roadCut:new RoadIndex(roads,{margin:9}),_junctions:areas,cutBenchM:4,verticalScale:1});
const cut=(ctx,x,z)=>TerrainBubble.prototype._roadCutWithMask.call(ctx,x,z,20).elevation;

test('le déblai tient compte du profil en long à portée de la maille',()=>{
  const s={path:[{x:0,z:0},{x:10,z:0}],halfWidth:1,platform:Float32Array.of(0,10)};
  const index=new RoadIndex([s],{margin:8});
  const hit=index.query(5,0);
  assert.equal(index.deckAt(hit),5);
  const vertex=(x,z)=>cut({...context([s]),cutBenchM:2},x,z);
  const a=vertex(4,-2),b=vertex(8,-2),c=vertex(4,2);
  assert.ok((a+b+c)/3<=16/3,'la corde au centre du triangle ne traverse pas la chaussée en pente');
});

test('un remblai voisin ne relève pas la maille qui traverse une route abaissée',()=>{
  const ctx={...context([road(0,4)]),_earthworks:{sample:()=>({elevation:12,mask:1,supported:true})}};
  assert.equal(cut(ctx,0,0),4);
});

test('les ouvrages couverts ne donnent aucune cote de déblai ordinaire',()=>{
  const tunnel={...road(0,0),works:Uint8Array.of(2,2)};
  assert.equal(cut(context([tunnel]),0,0),20);
});

test('un déblai mesure la surface effectivement triangulée',()=>{
  const {areas}=networkOfJunctions([{x:0,z:0,level:0,profile:'minor',halfWidth:2,degree:4,
    branches:[{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}].map(d=>({...d,halfWidth:2,profile:'minor',
      path:[{x:0,z:0},{x:d.x*30,z:d.z*30}]}))}],{deck:()=>3});
  const area=areas.areas[0];
  for(const ids of area.triangles) {
    const vertices=ids.map(i=>area.vertices[i]);
    const x=vertices.reduce((sum,p)=>sum+p.x,0)/3,z=vertices.reduce((sum,p)=>sum+p.z,0)/3;
    assert.equal(areas.deckNear(x,z,9).distance,0);
  }
});
