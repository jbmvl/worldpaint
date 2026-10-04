/* Des données nantaises vérifient la continuité réelle des rubans et dalles. */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRoadSegments } from '../src/layers/roadNetwork.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import { updateJunctionSeams } from '../src/layers/junctionSeams.js';
import { areaCovers, junctionRibbonRuns, junctionSurface, markJunctionRows } from '../src/layers/roadJunctions.js';
import { appendRibbon, createRibbonBuffer } from '../src/layers/ribbonGeometry.js';

const donnees = JSON.parse(readFileSync(new URL('./fixtures/junctions-nantes.json', import.meta.url)));
const source = { forEachFeature(couche, tuiles, visite) {
  if (couche === 'transportation') for (const entite of donnees.features) visite(entite.geometry, entite.properties);
}};
const produit = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);

test('l’entrée courbe nantaise rejoint la couronne sans ressortir de la dalle',()=>{
  const {lng,lat,zoom}=donnees.centre;
  const {areas}=collectRoadSegments(source,[],{x:0,z:0},createLocalFrame(lng,lat,zoom),()=>30,2000);
  const aire=areas.areas.find(a=>a.roundabout && Math.hypot(a.x-106.2899,a.z-227.9379)<1);
  assert.ok(aire);
  for(const [x,z] of [[111.9587,239.0674],[111,239.5],[113,239]])
    assert.ok(areaCovers(aire,x,z),`l’entrée reste dans la dalle en ${x}, ${z}`);
  assert.equal(areaCovers(aire,aire.x,aire.z),false,'l’îlot reste libre');
  assert.equal(areaCovers(aire,102,250),false,'la desserte extérieure n’est pas absorbée par la couronne');
});

for (const inverse of [false,true]) test(`Nantes : axes dessinés, ordre ${inverse ? 'inversé' : 'initial'}`,()=>{
  const lecture = inverse ? { forEachFeature(couche,tuiles,visite) {
    source.forEachFeature(couche,tuiles,(geometrie,proprietes)=>visite({
      ...geometrie, coordinates:geometrie.coordinates.slice().reverse(),
    },proprietes));
  }} : source;
  const { lng,lat,zoom } = donnees.centre;
  const {segments,areas} = collectRoadSegments(lecture,[],{x:0,z:0},createLocalFrame(lng,lat,zoom),()=>30,2000);
  updateJunctionSeams(areas);
  for(const segment of segments)segment.junction=markJunctionRows(segment,areas);
  const tampons = areas.areas.map(a=>junctionSurface(a,a.decks));
  for (const segment of segments) if (segment.paved) {
    for (const plage of junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}])) {
      const tampon = createRibbonBuffer();
      appendRibbon(tampon,{...plage,halfWidth:segment.halfWidth,sampleElevation:()=>30});
      tampons.push(tampon);
    }
  }
  const triangles = tampons.filter(Boolean).flatMap(tampon=>Array.from({length:tampon.indices.length/3},(_,i)=>
    tampon.indices.slice(i*3,i*3+3).map(j=>({x:tampon.positions[j*3],z:tampon.positions[j*3+2]}))));
  for (const segment of segments) if (segment.paved) {
    for (let ligne=1;ligne<segment.path.length;ligne++) {
      const a=segment.path[ligne-1],b=segment.path[ligne],point={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      const couvert = triangles.some(triangle=>{
        const cotes=triangle.map((p,i)=>produit(p,triangle[(i+1)%3],point));
        return Math.min(...cotes)>=-1e-5 || Math.max(...cotes)<=1e-5;
      });
      assert.ok(couvert,`${segment.profile} absente en ${point.x}, ${point.z}`);
    }
  }
});

test('deux rues urbaines voisines de rang différent gardent leurs deux axes',()=>{
  const frame=createLocalFrame(0,47,14),urban={any:true,covers:()=>true,nearCity:()=>true};
  const sourceLocale={forEachFeature(couche,tuiles,visite){
    if(couche!=='transportation')return;
    for(const [classe,z] of [['primary',0],['service',10]]) {
      const coordinates=[-100,100].map(x=>{const p=frame.toLngLat(x,z);return [p.lng,p.lat];});
      visite({type:'LineString',coordinates},{class:classe});
    }
  }};
  const {segments}=collectRoadSegments(sourceLocale,[],{x:0,z:0},frame,()=>30,400,undefined,{urban});
  assert.equal(segments.filter(s=>s.profile==='major').length,1);
  assert.equal(segments.filter(s=>s.profile==='lane').length,1);
});
