/* Banc hors réseau des profils, protections, découpes et coutures d'eau.
 * Les mêmes modules que le compositeur sont utilisés ; le temps est fixé
 * par waterLab.set pour comparer les niveaux et le grain entre les LOD. */
import * as THREE from 'three';
import {TerrainBubble} from '/src/terrain/terrainBubble.js';
import {GroundClassMap} from '/src/terrain/groundClassMap.js';
import {defaultTheme} from '/src/themes/default.js';
import {createLocalFrame,tileXToLng,tileYToLat} from '/src/core/tileMath.js';
import {collectWaterFeatures} from '/src/core/waterFeatures.js';
import {prepareWater,waterFallbacks} from '/src/core/waterPreparation.js';
import {waterSurfaceFor,waterwayStyleFor} from '/src/terrain/surfaceClassification.js';
import {placeWater,addWaterBands} from '/src/layers/waterPlacement.js';
import {waterProtectionTriangles} from '/src/layers/waterProtections.js';
import {WaterLayer} from '/src/layers/waterLayer.js';
import {corridorContours} from '/src/layers/roadCorridor.js';
import {RoadNetwork,createRoadMaterials} from '/src/layers/roadNetwork.js';
import {BridgeLayer} from '/src/layers/bridgeLayer.js';
import {junctionTriangles} from '/src/layers/junctionTriangulation.js';
import {finishGeneration} from '/src/core/generationSteps.js';
import {area} from '/src/core/waterGeometry.js';
import {subdividePath,pathFrames} from '/src/layers/ribbonGeometry.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#afc2cd');scene.add(new THREE.HemisphereLight(0xe3eef5,0x7d735e,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.8);sun.position.set(-90,160,70);scene.add(sun);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,0.1,6000);
const zoom=17,tx=65536,ty=47150,frame=createLocalFrame(tileXToLng(tx+0.5,zoom),tileYToLat(ty+0.5,zoom),zoom),tile={x:tx,y:ty,z:zoom,key:`${zoom}/${tx}/${ty}`,ring:0};
const bounds={west:tileXToLng(tx,zoom),east:tileXToLng(tx+1,zoom),north:tileYToLat(ty,zoom),south:tileYToLat(ty+1,zoom)};
const rectangle=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]];
const geo=p=>{const g=frame.toLngLat(...p);return [g.lng,g.lat];};
const polygon=(kind,rings,id=1,layer='water',extra={})=>({layer,geometry:{type:'Polygon',coordinates:rings.map(r=>r.map(geo))},properties:{class:kind,...extra},id});
const line=(kind,points,id=2,layer='waterway',extra={})=>({layer,geometry:{type:'LineString',coordinates:points.map(geo)},properties:{class:kind,...extra},id});
const state={case:'lac',distance:160,pitchDeg:32,yawDeg:160,time:12,segments:48};let world=null;
function description(name) {
  if(name==='ruisseau'||name==='fossé')return {height:()=>1,features:[line(name==='fossé'?'ditch':'stream',[[-90,3],[90,3]])]};
  if(name==='profil')return {height:(x,z)=>2-x*0.015+(Math.abs(x)<3?0.2:0),features:[line('river',[[-90,0],[90,0]])]};
  if(name==='protections'||name==='pont')return {height:()=>1,features:[polygon('lake',[rectangle(-65,-35,130,70)]),polygon('house',[rectangle(-24,4,14,16)],12,'building'),line('minor',[[15,-90],[15,90]],13,'transportation',name==='pont'?{brunnel:'bridge',layer:1}:{})]};
  if(name==='méandre') {
    const path=[{x:-50,z:-80},{x:-50,z:0}];
    for(let i=1;i<=24;i++){const a=Math.PI-i*Math.PI/24;path.push({x:Math.cos(a)*50,z:Math.sin(a)*50});}
    path.push({x:50,z:-80});
    const dense=subdividePath(path,4),frames=pathFrames(dense),left=[],right=[];
    for(let i=0;i<dense.length;i++){const p=dense[i],px=frames[i*4+2],pz=frames[i*4+3];left.push([p.x+px*6,p.z+pz*6]);right.push([p.x-px*6,p.z-pz*6]);}
    const ring=[...right,...left.reverse()];
    const h=(x,z)=>z<=0?(x<0?3-(z+80)*.006:2.52-.3*Math.PI+z*.006):2.52-.3*(Math.PI-Math.atan2(z,x));
    return {height:h,features:[line('river',path.map(p=>[p.x,p.z]),77),polygon('river',[ring],88)]};
  }
  if(name==='tuiles') {
    const seam=frame.scale/2,margin=frame.scale*64/4096,second={...tile,x:tx+1,key:`${zoom}/${tx+1}/${ty}`};
    const a=polygon('lake',[rectangle(seam-30,-30,30+margin,60)],7),b=polygon('lake',[rectangle(seam-margin,-30,30+margin,60)],7);
    a.tile=tile;b.tile=second;
    return {height:x=>.02*x,features:[a,b],tiles:state.reverseTiles?[second,tile]:[tile,second]};
  }
  if(name==='mer')return {height:(x,z)=>Math.max(0,-z)*0.015,features:[polygon('ocean',[rectangle(-95,0,190,95)])]};
  if(name==='marais-riz')return {height:()=>1,features:[polygon('wetland',[rectangle(-80,-60,75,120)],1,'landcover',{subclass:'marsh'}),polygon('farmland',[rectangle(5,-60,75,120)],2,'landcover',{crop:'rice',subclass:'rice'})]};
  return {height:(x,z)=>0.02*x,features:[polygon('lake',[rectangle(-45,-45,90,90),rectangle(-9,-9,18,18)])]};
}
function dispose() {if(!world)return;world.water.dispose();world.roads.dispose();world.bridges.dispose();world.roadMaterials.dispose();world.bubble.dispose();world.ground.dispose();for(const mesh of world.boxes){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}}
function build() {
  dispose();const data=description(state.case),features=data.features,tiles=data.tiles??[tile];
  const source={forEachFeature(layer,wanted,callback){for(const f of features){const t=f.tile??tile;if(f.layer===layer && wanted.some(w=>w.x===t.x && w.y===t.y))callback(f.geometry,f.properties,{west:tileXToLng(t.x,zoom),east:tileXToLng(t.x+1,zoom),north:tileYToLat(t.y,zoom),south:tileYToLat(t.y+1,zoom)},{id:f.id,tile:t,extent:4096});}}};
  const ground=new GroundClassMap({THREE,theme:defaultTheme});
  const elevation={zoom,tilePixels:256,revision:1,has:()=>true,sampleTile(x,y){const p=frame.tileToLocal(x,y);return data.height(p.x,p.z);},sampleTileStrict(x,y){return this.sampleTile(x,y);},dispose(){}};
  const segments=['ruisseau','fossé'].includes(state.case)&&!state.explicitSegments?10:state.segments;
  const bubble=new TerrainBubble({THREE,scene,elevation,groundClass:ground,zoom,blockSize:1,segmentsByRing:[segments],theme:defaultTheme});bubble.frame=frame;bubble._centerTile={x:tx,y:ty};for(const t of tiles){bubble.tiles.set(t.key,{...t});bubble._buildMesh(bubble.tiles.get(t.key));}
  const collected=collectWaterFeatures(source,tiles,{waterSurfaceFor,waterwayStyleFor,waterways:defaultTheme.water.waterways});
  const prepared=prepareWater(collected,{frame,sampleDem:(lng,lat)=>bubble.getElevation(lng,lat,NaN,{strict:true}),grid:{zoom,pixels:256},waterways:defaultTheme.water.waterways,triangulateShape:THREE.ShapeUtils.triangulateShape});
  ground.rebuild(source,tiles,{x:0,z:0},frame,{resolvedWaterKeys:prepared.resolvedKeys,waterFallbacks:waterFallbacks(prepared)});bubble.materials.syncGroundClass();
  const roadMaterials=createRoadMaterials(THREE,defaultTheme.roads),roads=new RoadNetwork({THREE,scene,bubble,materials:roadMaterials,theme:defaultTheme});roads.rebuild(source,tiles,{x:0,z:0});while(bubble.processRebuildQueue(1000)){}
  const bridges=new BridgeLayer({THREE,scene,bubble,theme:defaultTheme});bridges.rebuild(roads.roadSegments,{x:0,z:0});
  const protections=waterProtectionTriangles({buildings:collected.buildings,frame,roadContours:corridorContours(roads.index,{minX:-110,maxX:110,minZ:-110,maxZ:110}),junctionTriangles:(roads.junctionAreas?.areas??[]).flatMap(a=>{const t=junctionTriangles(a);return t.triangles.map(is=>is.map(i=>t.vertices[i]));})},THREE.ShapeUtils.triangulateShape);
  const index=addWaterBands(placeWater(prepared,protections,THREE.ShapeUtils.triangulateShape,{profiles:defaultTheme.water.profiles}),defaultTheme.water.profiles),water=new WaterLayer({THREE,scene,theme:defaultTheme});const meshes=water.prepare(index,frame,bubble.verticalScale),cuts=finishGeneration(bubble.prepareWaterSurfaceSteps(index));bubble.setWaterSurface(index,cuts);ground.setWaterSurface(index);water.publish(meshes);water.setTime(state.time);bubble.materials.advanceWater(state.time);
  const boxes=[];if(['protections','pont'].includes(state.case)){const mesh=new THREE.Mesh(new THREE.BoxGeometry(14,8,16),new THREE.MeshLambertMaterial({color:0xa49582}));mesh.position.set(-17,5,12);scene.add(mesh);boxes.push(mesh);}
  world={bubble,water,ground,roads,bridges,roadMaterials,index,prepared,boxes};
}
function render() {
  world.water.setTime(state.time);const pitch=state.pitchDeg*Math.PI/180,yaw=state.yawDeg*Math.PI/180;
  const targetX=state.case==='tuiles'?frame.scale/2:0;
  camera.position.set(targetX-Math.sin(yaw)*Math.cos(pitch)*state.distance,Math.sin(pitch)*state.distance,Math.cos(yaw)*Math.cos(pitch)*state.distance);camera.lookAt(targetX,0,0);renderer.render(scene,camera);
  const info={case:state.case,segments:world.bubble.tiles.get(tile.key).segments,time:state.time,waterTriangles:world.index.triangles.length,waterAreaM2:world.index.triangles.reduce((s,t)=>s+area(t.points),0),levels:world.prepared.polygons.map(p=>({kind:p.kind,status:p.profile.status,levelM:p.profile.levelM})),diagnostics:world.prepared.diagnostics.map(d=>({kind:d.kind,status:d.status,reason:d.reason})),roadWater:world.index.sample(15,0),buildingWater:world.index.sample(-17,12),islandWater:world.index.sample(0,0)};
  document.getElementById('info').textContent=JSON.stringify(info,null,2);return info;
}
window.waterLab={set(options={}){const rebuild=options.case!==undefined||options.segments!==undefined||options.reverseTiles!==undefined;Object.assign(state,options);if(options.segments!==undefined)state.explicitSegments=true;if(rebuild)build();return render();},info:render,world:()=>world};
build();render();window.waterLabReady=true;
