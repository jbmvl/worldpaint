/* Un pont dégage le relief de son emprise et raccorde ses accès sans revanche artistique. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRoadSegments } from '../src/layers/roadNetwork.js';
import { createLocalFrame } from '../src/core/tileMath.js';

const frame=createLocalFrame(0,45,15);
const voie=(points,bridge=false)=>({properties:{class:'minor',...(bridge?{brunnel:'bridge',layer:1}:{})},
  geometry:{type:'LineString',coordinates:points.map(([x,z])=>{const p=frame.toLngLat(x,z);return [p.lng,p.lat];})}});
const features=[voie([[-200,0],[-16,0]]),voie([[-16,0],[16,0]],true),voie([[16,0],[200,0]])];
const source={forEachFeature(layer,tiles,visit){if(layer==='transportation')for(const f of features)visit(f.geometry,f.properties);}};

for(const offset of [0,4])test(`le relief à ${offset} mètres de l’axe ne traverse pas le tablier`,()=>{
  const relief=(x,z)=>50+3*Math.exp(-(x*x+(z-offset)**2)/20);
  const {segments}=collectRoadSegments(source,[],{x:0,z:0},frame,relief,400,undefined,{bench:6});
  for(const s of segments)for(let r=0;r<s.path.length;r++) {
    if(s.works[r]!==1)continue;
    const p=s.path[r];
    for(const z of [-s.halfWidth,0,s.halfWidth])assert.ok(s.platform[r]>=relief(p.x,p.z+z)-1e-5);
  }
  const access=segments.flatMap(s=>s.path.map((p,r)=>({x:p.x,h:s.platform[r],work:s.works[r]}))).filter(p=>!p.work);
  assert.ok(access.some(p=>p.h>relief(p.x,0)+.01),'les accès rejoignent la travée relevée');
  assert.ok(access.filter(p=>Math.abs(p.x)>150).every(p=>Math.abs(p.h-50)<1e-5),'le relevage reste local');
});

test('un remblai voisin ne traverse pas un tablier et ne creuse pas le relief naturel',async()=>{
  const {TransportEarthworks}=await import('../src/terrain/transportEarthworks.js');
  const path=z=>[{x:-20,z,distance:0},{x:20,z,distance:40}];
  const fill={path:path(5),paved:true,halfWidth:3,platform:Float32Array.of(50,50),crossingBase:Float32Array.of(45,45)};
  const bridge={path:path(0),paved:true,halfWidth:3,platform:Float32Array.of(48,48),works:Uint8Array.of(1,1)};
  assert.ok(new TransportEarthworks([fill],{bench:4}).sample(0,0,45).elevation>48);
  const earth=new TransportEarthworks([fill,bridge],{bench:4});
  assert.equal(earth.sample(0,0,45).elevation,48);
  assert.equal(earth.sample(0,0,49).elevation,49);
});

test('une berge hors du tablier ne relève ni le pont ni ses approches',()=>{
  const relief=(x,z)=>Math.abs(z)>6 ? 65 : 50;
  const {segments}=collectRoadSegments(source,[],{x:0,z:0},frame,relief,400,undefined,{bench:12});
  assert.ok(segments.every(s=>s.platform.every(h=>Math.abs(h-50)<1e-5)));
});
