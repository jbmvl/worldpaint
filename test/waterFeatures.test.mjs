/* Identité et coupes MVT vérifiées avec les données enregistrées et leurs
 * marges réelles ; les enveloppes bâties sont lues sans plafond de décor. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {VectorTile} from '@mapbox/vector-tile';import {PbfReader} from 'pbf';
import {VectorTileSource,tileBounds} from '../src/core/vectorTileSource.js';
import {collectWaterFeatures,groupWaterPolygons,componentEdges,WaterFeatureCollector,WATER_COMPONENT_TILE_LIMIT} from '../src/core/waterFeatures.js';
import {waterSurfaceFor,waterwayStyleFor} from '../src/terrain/surfaceClassification.js';
import {defaultTheme} from '../src/themes/default.js';
import {createLocalFrame,tileXToLng,tileYToLat,lngToTileX} from '../src/core/tileMath.js';
const classification={waterSurfaceFor,waterwayStyleFor,waterways:defaultTheme.water.waterways};
const t={x:8184,y:5753,z:14},f=createLocalFrame(tileXToLng(t.x,14),tileYToLat(t.y,14),14);
function fixtureSource(name) {
 const source=new VectorTileSource({tiles:[],zoom:14}),tiles=[];
 const base=new URL(`../demo/lab/places/${name}/vector/14/`,import.meta.url);
 for(const x of fs.readdirSync(base))for(const file of fs.readdirSync(new URL(`${x}/`,base))) {
 const tile={x:Number(x),y:parseInt(file),z:14};tiles.push(tile);source._store(`14/${tile.x}/${tile.y}`,{...tile,tile:new VectorTile(new PbfReader(fs.readFileSync(new URL(`${x}/${file}`,base))))});
 } return {source,tiles};
}
test('les fixtures conservent l’ID GeoJSON distinct des propriétés et l’extent native',()=>{const {source,tiles}=fixtureSource('station-montreuil-bellay');let thouet=null,polygon=null;source.forEachFeature('waterway',tiles,(g,p,b,m)=>{if(m.id===1505161592)thouet={p,m};});source.forEachFeature('water',tiles,(g,p,b,m)=>{if(m.id===21537313)polygon={p,m};});assert.ok(thouet);assert.equal(thouet.p.id,undefined);assert.equal(thouet.m.extent,4096);assert.equal(polygon.p.id,2153731);assert.notEqual(thouet.m.id,polygon.m.id);});
const coordinates=(tile,points)=>points.map(([x,y])=>[tileXToLng(tile.x+x/4096,14),tileYToLat(tile.y+y/4096,14)]);
function marginSource() {
 const second={...t,x:t.x+1},records=[{tile:t,coordinates:coordinates(t,[[3500,1000],[4160,1000],[4160,2000],[3500,2000],[3500,1000]])},{tile:second,coordinates:coordinates(second,[[-64,1000],[500,1000],[500,2000],[-64,2000],[-64,1000]])}];
 return {records,source:{forEachFeature(layer,tiles,callback){if(layer!=='water')return;for(const r of records)if(tiles.some(q=>q.x===r.tile.x))callback({type:'Polygon',coordinates:[r.coordinates]},{class:'lake'},tileBounds(r.tile.x,r.tile.y,14),{id:9,tile:r.tile,extent:4096});}}};
}
test('les marges −64/4160 sont coupées, tous les fragments conservés et la jointure n’est pas une rive',()=>{const {records,source}=marginSource(),tiles=records.map(r=>r.tile);const a=collectWaterFeatures(source,tiles,classification),b=collectWaterFeatures(source,tiles.slice().reverse(),classification);assert.deepEqual(a,b);assert.equal(a.polygons.length,2);for(const p of a.polygons)for(const [lng] of p.rings.flat())assert.ok(lngToTileX(lng,14)>=p.tile.x-1e-8 && lngToTileX(lng,14)<=p.tile.x+1+1e-8);const edges=componentEdges(groupWaterPolygons(a.polygons)[0],f);assert.ok(edges.length);assert.ok(edges.every(e=>e.kind==='shore'));});
test('une collecte de composante conserve les fragments avant éviction du LRU',async()=>{const {records,source}=marginSource();source.load=async()=>({});const collector=new WaterFeatureCollector(classification);const result=await collector.collect(source,[t],f);assert.equal(result.polygons.length,2);assert.ok(result.polygons.every(p=>!p.incomplete));assert.equal(collector.cache.size,2);});
test('une composante sans identifiant et ouverte reste incomplète sans recherche mondiale',async()=>{const {source}=marginSource(),wrapped={forEachFeature(layer,tiles,cb){source.forEachFeature(layer,tiles,(g,p,b,m)=>cb(g,p,b,{...m,id:null}));},load(){throw new Error('aucun chargement attendu');}};const result=await new WaterFeatureCollector(classification).collect(wrapped,[t],f);assert.ok(result.polygons.every(p=>p.incomplete));});
test('le collecteur écarte les piscines, les intermittents et seulement le bâti explicitement surélevé',()=>{const ring=coordinates(t,[[100,100],[200,100],[200,200],[100,200],[100,100]]);const source={forEachFeature(layer,tiles,cb){for(const properties of layer==='building'?[{height:30},{hide_3d:true},{min_height:2}]:layer==='water'?[{class:'swimming_pool'},{class:'lake',intermittent:1},{class:'pond'}]:[])cb({type:'Polygon',coordinates:[ring]},properties,tileBounds(t.x,t.y,14),{id:1,tile:t,extent:4096});}};const result=collectWaterFeatures(source,[t],classification);assert.equal(result.polygons.length,1);assert.equal(result.buildings.length,2);});

test('la limite de 64 tuiles garde toute la composante ouverte en repli',async()=> {
 let loads=0;
 const source={async load(){loads++;},forEachFeature(layer,tiles,callback){if(layer!=='water')return;for(const tile of tiles)callback({type:'Polygon',coordinates:[coordinates(tile,[[-64,100],[4160,100],[4160,200],[-64,200],[-64,100]])]},{class:'lake'},tileBounds(tile.x,tile.y,14),{id:7,tile,extent:4096});}};
 const collector=new WaterFeatureCollector(classification),result=await collector.collect(source,[t],f);
 assert.equal(loads,WATER_COMPONENT_TILE_LIMIT-1);assert.equal(result.polygons.length,WATER_COMPONENT_TILE_LIMIT);assert.ok(result.polygons.every(p=>p.incomplete));
});
test('le cache extrait retire les tuiles qui ne servent plus aux objets du lot',async()=> {
 const {source}=marginSource(),collector=new WaterFeatureCollector(classification);source.load=async()=>({});
 await collector.collect(source,[t],f);assert.equal(collector.cache.size,2);
 await collector.collect({forEachFeature(){}},[{...t,x:t.x+10}],f);assert.equal(collector.cache.size,1);
 collector.clear();assert.equal(collector.cache.size,0);
});
