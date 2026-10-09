/* Les profils affichés ne retouchent pas le terrassement et gardent leurs raccords. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { smoothRoadProfiles, findRoadSupports, ROAD_MAX_GRADE } from '../src/layers/roadProfile.js';
import { segmentOf, networkOf, buffersOf, trianglesOf, heightIn } from './junctionWorld.mjs';
import { RoadNetwork } from '../src/layers/roadNetwork.js';
import { BridgeLayer } from '../src/layers/bridgeLayer.js';
import { FurnitureLayer } from '../src/layers/furnitureLayer.js';
import { createLocalFrame } from '../src/core/tileMath.js';

const grade = s => Math.max(...s.path.slice(1).map((p, i) => Math.abs(s.platform[i + 1] - s.platform[i]) / Math.hypot(p.x-s.path[i].x,p.z-s.path[i].z)));
const line = (points, deck) => segmentOf(points, 3, { deck });

test('une rampe à 35 % devient une chaussée à pente bornée sans enfoncement', () => {
  const s = line([{x:0,z:0},{x:120,z:0}], x=>x*.35);
  const initial = s.platform.slice();
  assert.equal(smoothRoadProfiles([s]).constrained, 0);
  assert.ok(grade(s) <= ROAD_MAX_GRADE + 1e-5);
  s.platform.forEach((h,r)=>assert.ok(h >= initial[r]));
});

test('le profil borné reste identique lorsque le réseau et ses tracés sont inversés', () => {
  const make = inverse => [[{x:0,z:0},{x:90,z:0}],[{x:90,z:0},{x:90,z:70}]].map(points=>line(inverse ? points.toReversed() : points,(x,z)=>x*.3+z*.25));
  const a=make(false),b=make(true).reverse();
  smoothRoadProfiles(a);smoothRoadProfiles(b);
  const read = list => list.flatMap(s=>s.path.map((p,r)=>[`${p.x.toFixed(5)}:${p.z.toFixed(5)}`,s.platform[r]])).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(read(a),read(b));
});

test('un carrefour en forte pente garde ses bouches cousues aux rubans', () => {
  const lines=[{points:[{x:-80,z:0},{x:0,z:0},{x:80,z:0}],profile:'minor',halfWidth:3},
    {points:[{x:0,z:-70},{x:0,z:0},{x:0,z:70}],profile:'minor',halfWidth:3}];
  const network=networkOf(lines,{deck:(x,z)=>30+x*.3+z*.2});
  smoothRoadProfiles(network.segments);network.areas.updateDecks();
  for(const s of network.segments) assert.ok(grade(s)<=ROAD_MAX_GRADE+1e-5);
  const geometry=buffersOf(network);
  for(const area of network.areas.areas) for(const mouth of area.mouths) {
    for(const p of [mouth.left,mouth.right]) {
      const values=geometry.flatMap(b=>trianglesOf(b).map(t=>heightIn(t,p.x,p.z)).filter(v=>v!=null));
      assert.ok(values.length>=2);
      assert.ok(Math.max(...values)-Math.min(...values)<1e-4);
    }
  }
});

test('deux niveaux superposés ne propagent pas leurs altitudes', () => {
  const a=line([{x:0,z:0},{x:90,z:0}],x=>x*.3);
  const b=line([{x:0,z:0},{x:0,z:90}],()=>0);b.levels.fill(1);
  smoothRoadProfiles([a,b]);assert.equal(Math.max(...b.platform),0);
});

test('les ouvrages existants restent fixes et les contraintes impossibles sont publiées', () => {
  const s=line([{x:0,z:0},{x:60,z:0}],x=>x*.4);
  s.works[0]=2;
  const end=s.platform[0];
  assert.ok(smoothRoadProfiles([s]).constrained>0);
  assert.equal(s.platform[0],end);
});

test('une suspension longue reçoit un tablier, une dépression courte reste sans ouvrage', () => {
  const a=line([{x:0,z:0},{x:90,z:0}],()=>8);
  findRoadSupports([a],()=>0);assert.ok(a.supports.every(Boolean));assert.ok(a.works.every(v=>v===0));
  const b=line([{x:0,z:0},{x:90,z:0}],()=>0);
  b.platform[10]=5;findRoadSupports([b],()=>0);assert.ok(b.supports.every(v=>v===0));
});

test('un simple dévers ne transforme pas la corniche en pont', () => {
  const s=line([{x:0,z:0},{x:90,z:0}],()=>0);
  findRoadSupports([s],(x,z)=>z*2);assert.ok(s.supports.every(v=>v===0));
});

test('le tablier et ses parapets suivent les rampes jusqu’au premier contact au sol', () => {
  const hauteur = x => Math.max(0, Math.min(6, (x - 15) * .1, (165 - x) * .1));
  const s = line([{x:0,z:0},{x:180,z:0}], hauteur);
  const initial = s.platform.slice();
  findRoadSupports([s], () => 0);
  for (let r = 0; r < s.path.length; r++) {
    assert.equal(s.supports[r], s.path[r].x >= 15 && s.path[r].x <= 165 ? 1 : 0);
  }
  assert.deepEqual(s.platform, initial);
  assert.ok(s.works.every(v => v === 0));
  const layer = new BridgeLayer({THREE, scene:new THREE.Scene(),
    bubble:{frame:{}, verticalScale:1, surfaceElevationAtLocal:() => 0}});
  layer.rebuild([s], {x:90,z:0});
  assert.equal(layer.counts.spans, 1);
  const positions = layer.geometry.attributes.position.array;
  for (const x of [15, 30, 150, 165]) {
    const hauteurs = [];
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i] - x) < .001) hauteurs.push(positions[i + 1]);
    }
    assert.ok(Math.min(...hauteurs) < hauteur(x), `sous-face à ${x} m`);
    assert.ok(Math.max(...hauteurs) > hauteur(x) + .5, `parapet à ${x} m`);
  }
  layer.dispose();
});

test('une faible suspension isolée ne déclenche pas de pont', () => {
  const s = line([{x:0,z:0},{x:90,z:0}], () => 2);
  findRoadSupports([s], () => 0);
  assert.ok(s.supports.every(v => v === 0));
});

test('les accès portés sont identiques lorsque le tracé est inversé', () => {
  const points = [{x:0,z:0},{x:180,z:0}];
  const hauteur = x => Math.max(0, Math.min(6, (x - 15) * .1, (165 - x) * .1));
  const a = line(points, hauteur), b = line(points.toReversed(), hauteur);
  findRoadSupports([a,b], () => 0);
  assert.deepEqual(a.supports, b.supports.slice().reverse());
});

test('une route suspendue porte ses piles sur le sol final', () => {
  const s=line([{x:0,z:0},{x:90,z:0}],()=>9);findRoadSupports([s],()=>0);
  const bubble={frame:{},verticalScale:1,surfaceElevationAtLocal:()=>0};
  const layer=new BridgeLayer({THREE,scene:new THREE.Scene(),bubble});
  assert.ok(layer.rebuild([s],{x:0,z:0}));assert.ok(layer.counts.piers>=2);
  const p=layer.geometry.attributes.position.array;
  assert.ok(Array.from(p).every(Number.isFinite));assert.ok(Array.from(p).some((v,i)=>i%3===1&&v===0));
  layer.dispose();
});

test('un lampadaire décalé de trois mètres du sol est rejeté', () => {
  const layer=Object.create(FurnitureLayer.prototype);
  layer.bubble={verticalScale:1,surfaceElevationAtLocal:()=>2,renderedSupportAtLocal:()=>({y:2})};
  const placements=new Map([['streetLamp',[]]]);
  assert.equal(layer._place(placements,'streetLamp',{x:0,z:0,y:5,exactY:true,grounded:true}),null);
  assert.ok(layer._place(placements,'streetLamp',{x:0,z:0,y:2.1,exactY:true,grounded:true}));
});

test('le réseau transmet au terrain ses profils initiaux, distincts du profil affiché', () => {
  const frame=createLocalFrame(0,45,15);
  const coords=[{x:0,z:0},{x:150,z:0}].map(p=>{const q=frame.toLngLat(p.x,p.z);return[q.lng,q.lat];});
  const source={forEachFeature:(layer,tiles,fn)=>{if(layer==='transportation')fn({type:'LineString',coordinates:coords},{class:'minor'});}};
  let terrain;
  const bubble={frame,verticalScale:1,cutBenchM:4,surfaceGeneration:0,naturalElevationAtLocal:x=>x*.35,
    setRoadCut:(index,areas,earthworks)=>{terrain={index,areas,earthworks};}};
  const materials={byProfile:{minor:new THREE.MeshBasicMaterial()},junctions:{}};
  const roads=new RoadNetwork({THREE,scene:new THREE.Scene(),bubble,materials});
  roads.rebuild(source,[],{x:0,z:0});
  const s=roads.roadSegments[0], original=terrain.index.segments[0];
  assert.notEqual(s.platform,original.platform);assert.ok(s.platform[0]>original.platform[0]+10);
  assert.ok(grade(s)<=ROAD_MAX_GRADE+1e-5);assert.ok(grade(original)>.3);
  assert.equal(terrain.earthworks.supports.segments[0],original);
  const before=original.platform.slice();s.platform.fill(99);assert.deepEqual(original.platform,before);
  roads.dispose();
});

test('le déplacement du disque de rendu ne relève pas une rue déjà visible', () => {
  const frame=createLocalFrame(0,45,15);
  const coordinates=Array.from({length:26},(_,i)=>{const p=frame.toLngLat(i*100,0);return[p.lng,p.lat];});
  const source={forEachFeature:(layer,tiles,fn)=>{if(layer==='transportation')fn({type:'LineString',coordinates},{class:'minor'});}};
  const build=x=>{
    const bubble={frame,verticalScale:1,cutBenchM:4,surfaceGeneration:0,naturalElevationAtLocal:x=>x*.3,setRoadCut(){}};
    const roads=new RoadNetwork({THREE,scene:new THREE.Scene(),bubble,materials:{byProfile:{minor:new THREE.MeshBasicMaterial()},junctions:{}}});
    roads.rebuild(source,[],{x,z:0});return roads;
  };
  const a=build(0),b=build(250);
  for(const x of [100,250,400]) {
    const read=r=>r.elevationIndex.deckAt(r.elevationIndex.query(x,0,0));
    assert.ok(Math.abs(read(a)-read(b))<.0001);
  }
  a.dispose();b.dispose();
});

test('un carrefour suspendu reçoit une dalle commune avec ses bouches ouvertes', () => {
  const network=networkOf([{points:[{x:-60,z:0},{x:0,z:0},{x:60,z:0}],profile:'minor',halfWidth:3},
    {points:[{x:0,z:-60},{x:0,z:0},{x:0,z:60}],profile:'minor',halfWidth:3}],{deck:()=>10});
  findRoadSupports(network.segments,()=>0,network.areas);
  assert.ok(network.areas.areas[0].supported);
  const layer=new BridgeLayer({THREE,scene:new THREE.Scene(),bubble:{frame:{},verticalScale:1,surfaceElevationAtLocal:()=>0}});
  layer.rebuild(network.segments,{x:0,z:0},{areas:network.areas});
  assert.equal(layer.counts.spans,5,'quatre bras et une dalle de carrefour');
  assert.ok(Array.from(layer.geometry.attributes.position.array).every(Number.isFinite));
  for(const mouth of network.areas.areas[0].mouths) {
    const p=mouth.centre;
    for(const edge of network.areas.areas[0].edges) for(let i=1;i<edge.points.length;i++) {
      const a=edge.points[i-1],b=edge.points[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
      assert.ok(Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)>2,'aucun parapet ne ferme une bouche');
    }
  }
  layer.dispose();
});

test('un relevage affiché reste mobile devant un accès de tunnel conservé', () => {
  const s=line([{x:0,z:0},{x:90,z:0}],()=>0);
  s.terrainPlatform=s.platform.slice();s.crossingBase=s.platform.slice();
  s.platform.fill(10);s.platform[s.platform.length-1]=0;s.works[s.works.length-1]=2;
  const result=smoothRoadProfiles([s]);
  assert.equal(result.constrained,0);assert.equal(s.platform.at(-1),0);
  assert.ok(grade(s)<=ROAD_MAX_GRADE+1e-5);
});

test('le relevage d’un pont ne réduit pas le dégagement du passage inférieur', () => {
  const lower=line([{x:0,z:-60},{x:0,z:60}],()=>0);
  const upper=line([{x:-60,z:0},{x:60,z:0}],x=>8+x*.25);upper.levels.fill(1);upper.works.fill(1);
  const row=lower.path.findIndex(p=>p.z===0);
  const before=upper.platform.slice();
  smoothRoadProfiles([upper,lower],{crossings:[{lower:1,row,rail:false}]});
  assert.equal(lower.platform[row],0);assert.equal(lower.platform[row+1],0);
  upper.platform.forEach((h,r)=>assert.ok(h>=before[r]));assert.ok(grade(upper)<=ROAD_MAX_GRADE+1e-5);
});

test('les piles d’une portion suspendue laissent libre la chaussée inférieure', () => {
  const upper=line([{x:-60,z:0},{x:60,z:0}],()=>10);upper.supports=new Uint8Array(upper.path.length).fill(1);
  const lower=line([{x:0,z:-60},{x:0,z:60}],()=>0);
  const layer=new BridgeLayer({THREE,scene:new THREE.Scene(),bubble:{frame:{},verticalScale:1,surfaceElevationAtLocal:()=>0}});
  const roadIndex={queryAll:(x,z)=>Math.abs(x)<5&&Math.abs(z)<60?[{segment:lower}]:[],deckAt:()=>0};
  layer.rebuild([upper],{x:0,z:0},{roadIndex});
  const p=layer.geometry.attributes.position.array;
  for(let i=0;i<p.length;i+=3) if(p[i+1]<5) assert.ok(Math.abs(p[i])>4,'aucun appui dans le passage');
  assert.ok(layer.counts.piers>0);layer.dispose();
});

test('le calcul du profil complet ne réécrit pas le terrassement ferroviaire', () => {
  const frame=createLocalFrame(0,45,15);
  const points=[[-150,0],[-10,0],[10,0],[150,0]];
  const features=[[points.slice(0,2),{}],[points.slice(1,3),{brunnel:'bridge',layer:1}],[points.slice(2),{}]];
  const source={forEachFeature:(layer,tiles,fn)=>{
    if(layer!=='transportation')return;
    for(const [points,p] of features)fn({type:'LineString',coordinates:points.map(([x,z])=>{
      const q=frame.toLngLat(x,z);return[q.lng,q.lat];})},{class:'minor',...p});
  }};
  const rail=segmentOf([{x:0,z:-100},{x:0,z:100}],1.75,{profile:'rail',deck:()=>10});
  rail.paved=false;
  const bubble={frame,verticalScale:1,cutBenchM:4,surfaceGeneration:0,naturalElevationAtLocal:x=>Math.max(0,x*.3),setRoadCut(){}};
  const roads=new RoadNetwork({THREE,scene:new THREE.Scene(),bubble,materials:{byProfile:{minor:new THREE.MeshBasicMaterial()},junctions:{}}});
  roads.rebuild(source,[],{x:0,z:0},{railwaySegments:[rail]});
  assert.ok(rail.crossingBase.every(h=>h===10),'la référence reste le rail naturel');
  assert.ok(Math.min(...rail.platform)<10,'le franchissement a bien corrigé le rail');
  roads.dispose();
});
