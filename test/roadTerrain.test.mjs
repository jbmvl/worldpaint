/* Le déblai protège les triangles entre rues, y compris près des plis. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { JunctionAreas } from '../src/layers/roadJunctions.js';
import { lowestRoadDeckAt } from '../src/terrain/roadCut.js';

const road=(z,height)=>({path:[{x:-20,z},{x:20,z}],halfWidth:2,paved:true,
  platform:Float32Array.of(height,height)});
const context=(roads,areas=null)=>({_roadCut:new RoadIndex(roads,{margin:9}),_junctions:areas,cutBenchM:4,verticalScale:1});
const cut=(ctx,x,z)=>TerrainBubble.prototype._roadCutWithMask.call(ctx,x,z,20).elevation;

test('un sommet sous la rue haute reste excavé pour la rue basse voisine',()=>{
  const high=road(0,10),low=road(5,4),ctx=context([high,low]);
  assert.equal(cut(ctx,0,0),4,'les triangles qui partent de ce sommet traversent aussi la rue basse');
  assert.equal(cut(context([low,high]),0,0),4,'l’ordre du réseau ne décide pas du déblai');
});

test('le déblai tient compte du profil en long à portée de la maille',()=>{
  const s={path:[{x:0,z:0},{x:10,z:0}],halfWidth:1,platform:Float32Array.of(0,10)};
  const index=new RoadIndex([s],{margin:8});
  const hit=index.query(5,0);
  assert.equal(index.deckAt(hit),5);
  assert.equal(lowestRoadDeckAt(hit,2),2);
  const vertex=(x,z)=>cut({...context([s]),cutBenchM:2},x,z);
  const a=vertex(4,-2),b=vertex(8,-2),c=vertex(4,2);
  assert.ok((a+b+c)/3<=16/3,'la corde au centre du triangle ne traverse pas la chaussée en pente');
});

test('toutes les dalles voisines participent au déblai, pas seulement la plus proche',()=>{
  const tee=z=>({x:0,z,level:0,profile:'minor',halfWidth:2,degree:3,
    branches:[{x:1,z:0},{x:-1,z:0},{x:0,z:1}].map(d=>({...d,halfWidth:2,profile:'minor'}))});
  const junctions=[tee(0),tee(5)],areas=new JunctionAreas(junctions);
  for(const [i,a] of areas.areas.entries()) {a.decks=a.mouths.map(()=>i?3:10);a.deck=i?3:10;}
  assert.equal(areas.deckNear(0,0,9).deck,10,'la lecture de proximité garde son contrat');
  assert.equal(areas.deckSamplesNear(0,0,9).length,2);
  assert.equal(cut(context([road(0,10)],areas),0,0),3);
});

test('un remblai voisin ne relève pas la maille qui traverse une route abaissée',()=>{
  const ctx={...context([road(0,4)]),_earthworks:{sample:()=>({elevation:12,mask:1,supported:true})}};
  assert.equal(cut(ctx,0,0),4);
});

test('les ouvrages couverts ne donnent aucune cote de déblai ordinaire',()=>{
  const tunnel={...road(0,0),works:Uint8Array.of(2,2)};
  assert.equal(cut(context([tunnel]),0,0),20);
});

test('les triangles de l’accès restent dégagés près du seuil couvert',()=>{
  const s={...road(0,4),works:Uint8Array.of(0,2)};
  const ctx=context([s]);
  assert.equal(cut(ctx,21,0),4,'le sommet voisin du seuil protège aussi la corde de l’accès');
});

test('la sortie de galerie vers un pont reste dégagée dans les deux sens',()=>{
  for(const codes of [[2,1],[1,2]]) {
    const s={...road(0,4),works:Uint8Array.from(codes)};
    const ctx=context([s]);
    assert.equal(cut(ctx,0,0),4,'l’intervalle entre les ouvrages est à ciel ouvert');
    const couvert=ctx._roadCut.query(codes[0]===2?-21:21,0);
    assert.equal(couvert.covered,true,'le portail borne toujours la lecture de plate-forme');
    assert.equal(ctx._roadCut.deckAt(couvert),null);
  }
});

test('un déblai mesure la surface effectivement triangulée après réparation du contour',async()=>{
  const {junctionTriangles,junctionDistance}=await import('../src/layers/junctionTriangulation.js');
  const area={x:0,z:0,outline:[[-10,-10],[10,-10],[-6,-3],[6,3],[10,10],[-10,10],[6,-3],[-6,3]]
    .map(([x,z])=>({x,z,from:0,to:0,blend:0})),decks:[3]};
  const mesh=junctionTriangles(area);
  assert.ok(mesh.valid);
  for(const ids of mesh.triangles) {
    const vertices=ids.map(i=>mesh.vertices[i]);
    const x=vertices.reduce((sum,p)=>sum+p.x,0)/3,z=vertices.reduce((sum,p)=>sum+p.z,0)/3;
    assert.equal(junctionDistance(area,x,z).distance,0);
  }
});

test('un carrefour ouvert sous pont excave aussi le sol malgré son niveau OSM négatif',()=>{
  const areas=new JunctionAreas([{x:0,z:0,level:-1,profile:'minor',halfWidth:2,degree:3,
    branches:[{x:1,z:0},{x:-1,z:0},{x:0,z:1}].map(d=>({...d,halfWidth:2,profile:'minor'}))}]);
  const area=areas.areas[0];area.decks=area.mouths.map(()=>3);area.deck=3;area.terrainCovered=false;
  assert.equal(areas.deckNear(0,0,9),null,'la lecture par niveau conserve son contrat');
  assert.equal(cut(context([road(0,10)],areas),0,0),3);
  area.terrainCovered=true;
  assert.equal(cut(context([road(0,10)],areas),0,0),10,'une galerie conserve son toit');
});
