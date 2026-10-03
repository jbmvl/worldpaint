/* Galeries communes et accès : les franchissements gardent leur topologie. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveTunnelProfiles } from '../src/layers/transportTunnels.js';
import { BridgeLayer } from '../src/layers/bridgeLayer.js';
import { TransportEarthworks } from '../src/terrain/transportEarthworks.js';

function tunnel(z=0,{length=60,width=3,height=50,reverse=false,level=-1}={}) {
  const path=Array.from({length:101},(_,i)=>({x:(i-50)*4,z,distance:i*4}));
  if(reverse) {path.reverse();path.forEach((p,i)=>p.distance=i*4);}
  return {path,halfWidth:width,paved:true,platform:new Float32Array(path.length).fill(height),
    works:Uint8Array.from(path,p=>Math.abs(p.x)<=length/2?2:0),
    levels:Int8Array.from(path,p=>Math.abs(p.x)<=length/2?level:0)};
}
const roofs=segments=>segments.flatMap(s=>s.tunnelStructures);
const ground=()=>50;
function render(segments) {
  const layer=new BridgeLayer({THREE,scene:new THREE.Scene(),bubble:{frame:{},verticalScale:1,surfaceElevationAtLocal:ground}});
  layer.rebuild(segments,{x:0,z:0});return layer;
}

test('un passage inférieur court dégage le rail sans relever sa plateforme',()=>{
  const lower=tunnel(0,{length:24});
  const upper={path:[{x:0,z:-100,distance:0},{x:0,z:100,distance:200}],halfWidth:1.75,platform:Float32Array.of(50,50)};
  resolveTunnelProfiles([lower],[upper],ground);
  assert.equal(roofs([lower])[0].kind,'underpass');
  assert.ok(lower.platform[50]<=44.5);
  assert.deepEqual([...upper.platform],[50,50]);
  assert.ok(lower.platform[40]>lower.platform[50] && lower.platform[40]<50);
  assert.equal(lower.platform[0],50);
  const earth=new TransportEarthworks([lower]);
  assert.ok(earth.sample(-30,0,50).elevation<50);
  assert.equal(earth.sample(0,0,50).elevation,50,'le terrain au-dessus reste couvert');
  const layer=render([lower]);
  assert.equal(layer.tunnelMouths.length,2);
  assert.ok(layer.tunnelMouths.every(m=>m.roofHeight>0));
  assert.equal(layer.tunnelFixtures.length,0);
  layer.dispose();
});

test('un passage sous un pont garde son dégagement sans galerie ni portail',()=>{
  const lower=tunnel(0,{length:24});
  const upper={path:[{x:0,z:-20,distance:0},{x:0,z:20,distance:40}],halfWidth:3,
    platform:Float32Array.of(50,50),works:Uint8Array.of(1,1),levels:Int8Array.of(1,1)};
  resolveTunnelProfiles([lower,upper],[],ground);
  assert.deepEqual(lower.tunnelStructures,[]);
  assert.ok(lower.works.every(code=>code===0),'le sol est excavé sous le passage');
  assert.ok(lower.platform[50]<=44.5,'le tablier conserve son gabarit');
  assert.deepEqual([...upper.platform],[50,50]);
  assert.ok(new TransportEarthworks([lower]).sample(0,0,50).elevation<=44.5);
  for(let r=1;r<lower.path.length;r++) assert.ok(Math.abs(lower.platform[r]-lower.platform[r-1])/4<.121);
  const layer=render([lower]);
  assert.equal(layer.counts.portals,0);
  assert.equal(layer.tunnelMouths.length,0);
  assert.equal(layer.tunnelFixtures.length,0);
  layer.dispose();
});

test('un pont déjà assez haut laisse le passage inférieur au niveau naturel',()=>{
  const lower=tunnel(0,{length:24});
  const upper={path:[{x:0,z:-20,distance:0},{x:0,z:20,distance:40}],halfWidth:3,
    platform:Float32Array.of(60,60),works:Uint8Array.of(1,1),levels:Int8Array.of(1,1)};
  resolveTunnelProfiles([lower,upper],[],ground);
  assert.ok(lower.platform.every(h=>h===50));
  assert.ok(lower.works.every(code=>code===0));
  assert.deepEqual(lower.tunnelStructures,[]);
});

test('deux tunnels parallèles voisins reçoivent une enveloppe et deux entrées communes',()=>{
  const segments=[tunnel(0),tunnel(7,{width:1,reverse:true})];
  resolveTunnelProfiles(segments,[],ground);
  const structures=roofs(segments);
  assert.equal(structures.length,1);
  assert.equal(structures[0].members,2);
  assert.equal(structures[0].halfWidth,5.5);
  assert.equal(segments[0].platform[50],segments[1].platform[50]);
  const layer=render(segments);
  assert.equal(layer.tunnelMouths.length,2);
  assert.ok(layer.tunnelFixtures.length>0);
  layer.dispose();
});

test('les tunnels distants ou superposés conservent leurs propres ouvertures',()=>{
  for(const second of [tunnel(20),tunnel(5,{height:54}),tunnel(5,{level:-2})]) {
    const segments=[tunnel(),second];resolveTunnelProfiles(segments,[],ground);
    assert.equal(roofs(segments).length,2);
  }
});

test('la galerie déjà sous une colline ne creuse pas inutilement ses accès',()=>{
  const segment=tunnel();
  resolveTunnelProfiles([segment],[],()=>70);
  assert.ok(segment.platform.every(h=>h===50));
});

test('une galerie longue sans couverture abaisse ses accès sans ouvrir son toit',()=>{
  const segment=tunnel(0,{length:120});resolveTunnelProfiles([segment],[],ground);
  assert.ok(segment.platform[50]<46);
  assert.ok(segment.platform[30]>segment.platform[50] && segment.platform[30]<50);
  assert.equal(segment.platform[0],50);
  const earth=new TransportEarthworks([segment]);
  assert.equal(earth.sample(0,0,50).elevation,50);
});

test('un passage bâti court conserve son niveau et ne porte aucune lampe',()=>{
  const segment=tunnel(0,{length:8});
  const buildings=[[[{x:-6,z:-10},{x:6,z:-10},{x:6,z:10},{x:-6,z:10}]]];
  resolveTunnelProfiles([segment],[],ground,{buildings});
  assert.equal(roofs([segment])[0].kind,'building');
  assert.ok(segment.platform.every(h=>h===50));
  const layer=render([segment]);assert.equal(layer.tunnelFixtures.length,0);layer.dispose();
});

test('le regroupement ne dépend pas de l’ordre des chaussées',()=>{
  const make=reverse=>{const segments=[tunnel(),tunnel(7,{width:1})];if(reverse)segments.reverse();resolveTunnelProfiles(segments,[],ground);return roofs(segments);};
  assert.deepEqual(make(false),make(true));
});

test('une limite de tuile ne devient pas un portail et ne rapproche pas deux galeries',()=>{
  const segments=[tunnel(),tunnel(7,{width:1})];segments[1].works.fill(2);
  resolveTunnelProfiles(segments,[],ground);
  assert.equal(roofs(segments).length,2);
  const layer=render(segments);assert.equal(layer.tunnelMouths.length,2);layer.dispose();
});

test('l’entaille ordinaire de la route s’arrête elle aussi au portail',async()=>{
  const { RoadIndex }=await import('../src/layers/roadGraph.js');
  const segment=tunnel(0,{length:24});
  const index=new RoadIndex([segment],{margin:20});
  const hit=index.query(-10,0,20);
  assert.ok(hit);
  assert.equal(index.deckAt(hit),null,'aucun déblai derrière le seuil');
  assert.equal(index.deckAt(index.query(-14,0,20)),50,'l’accès conserve sa cote');
  const deck=new RoadIndex([segment],{margin:20,includeWorks:true});
  assert.equal(deck.deckAt(deck.query(-10,0,20)),50,'la navigation lit toujours la chaussée enterrée');
});

test('le sol commun couvre l’intervalle entre deux chaussées sans masquer leur ruban',()=>{
  const segments=[tunnel(),tunnel(7,{width:1})];resolveTunnelProfiles(segments,[],ground);
  const layer=render(segments),structure=roofs(segments)[0];
  const positions=layer.geometry.attributes.position.array;
  let floor=false;
  for(let i=0;i<positions.length;i+=3) {
    if(Math.abs(positions[i+1]-structure.platform[0])<.01) floor=true;
  }
  assert.ok(floor);layer.dispose();
});

test('le changement de layer après le portail n’interrompt pas la rampe de sortie',()=>{
  const segment=tunnel(0,{length:24});
  for(let r=44;r<=56;r++) segment.levels[r]=-1;
  const rail={path:[{x:0,z:-100,distance:0},{x:0,z:100,distance:200}],halfWidth:1.75,platform:Float32Array.of(50,50)};
  resolveTunnelProfiles([segment],[rail],ground);
  for(let r=1;r<segment.path.length;r++) assert.ok(Math.abs(segment.platform[r]-segment.platform[r-1])/4<.121);
  assert.equal(segment.platform[29],50,'le raccord court retrouve le relief à 84 m');
});

test('le déblai ordinaire ne recreuse pas l’appui conservé sous un rail supérieur',async()=>{
  const { TerrainBubble }=await import('../src/terrain/terrainBubble.js');
  const { RoadIndex }=await import('../src/layers/roadGraph.js');
  const road=tunnel(0,{length:24});
  const rail={profile:'rail',path:[{x:-10,z:-40,distance:0},{x:30,z:40,distance:Math.hypot(40,80)}],halfWidth:1.75,
    platform:Float32Array.of(50,50),crossingBase:Float32Array.of(50,50)};
  resolveTunnelProfiles([road],[rail],ground);
  const earth=new TransportEarthworks([road,rail],{bench:6});
  const context={_earthworks:earth,_roadCut:new RoadIndex([road],{margin:11}),verticalScale:1,cutBenchM:6};
  const sample=TerrainBubble.prototype._roadCutWithMask.call(context,12,4,50);
  assert.equal(sample.elevation,50);
});

test('un tunnel raccorde aussi un accès déjà corrigé par un autre ouvrage',()=>{
  const road=tunnel(0,{length:24,height:55});road.crossingBase=new Float32Array(road.path.length).fill(50);
  const rail={path:[{x:0,z:-100,distance:0},{x:0,z:100,distance:200}],halfWidth:1.75,platform:Float32Array.of(50,50)};
  resolveTunnelProfiles([road],[rail],ground);
  assert.ok(Math.abs(road.platform[54]-road.platform[53])<.15,'aucune marche à la sortie de l’ouvrage');
});

test('tunnelAt rend la chaussée et la voûte sous l’ouvrage, rien à côté', async () => {
  const { tunnelAt } = await import('../src/layers/transportTunnels.js');
  const high=()=>80;
  const road=tunnel(0,{length:120,height:50});
  resolveTunnelProfiles([road],[],high);
  const inside=tunnelAt([road],0,1);
  assert.ok(inside);
  assert.equal(inside.kind,'tunnel');
  assert.ok(Math.abs(inside.floor-road.platform[50])<1e-6);
  assert.ok(inside.roof>inside.floor+4 && inside.roof<high());
  assert.equal(tunnelAt([road],0,20),null,'à côté de la voûte');
  assert.equal(tunnelAt([road],150,0),null,'hors de la plage couverte');
});
