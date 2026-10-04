/* L'index final porte exclusions, rendu et trous ; la grille d'appui et la
 * publication sont vérifiées indépendamment de la présence d'un navigateur. */
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {WaterSurfaceIndex,placeWater,addWaterBands} from '../src/layers/waterPlacement.js';
import {triangulateRings,area,pointInRings} from '../src/core/waterGeometry.js';
import {cutWaterTerrain,terrainFragmentGeometry} from '../src/terrain/waterTerrainCut.js';
import {GroundClassMap} from '../src/terrain/groundClassMap.js';
import {TerrainBubble} from '../src/terrain/terrainBubble.js';
import {RoadIndex} from '../src/layers/roadGraph.js';import {corridorContours,inCorridor,CORRIDOR_MARGIN_M} from '../src/layers/roadCorridor.js';
import {waterwayProfile} from '../src/core/waterProfiles.js';import {riverSections,constrainPolygonAxes} from '../src/core/waterPreparation.js';
const rect=(x,z,w,h)=>[{x,z},{x:x+w,z},{x:x+w,z:z+h},{x,z:z+h}];
function waterRect(rings,levelM=1) {
 const points=triangulateRings(rings,THREE.ShapeUtils.triangulateShape).map(points=>({points:points.map(p=>({...p,levelM,flowKnown:0})),kind:'lake',sourceKey:'lac'}));
 const edges=rings.flatMap(r=>r.map((a,i)=>({a:{...a,levelM},b:{...r[(i+1)%r.length],levelM},kind:'shore',triangle:points[0]})));
 return new WaterSurfaceIndex(points,edges);
}
function grid(n=1) {
 const geometry=new THREE.BufferGeometry(),p=[],normal=[],mask=[],indices=[];
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++){p.push(x*20/n,1+x*0.4/n,z*20/n);normal.push(-0.02,1,0);mask.push(0);}
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x,b=a+1,c=a+n+1;indices.push(a,c,b,b,c,c+1);}
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geometry.setAttribute('roadMask',new THREE.Float32BufferAttribute(mask,1));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} ≠ ${b}`);
test('ruisseau et fossé au milieu d’une cellule de 20 m retirent le sol même sans sommet dans le lit',()=> {
 for(const width of [3,1.2]){const g=grid(),index=waterRect([rect(0,10-width/2,20,width)]),cut=cutWaterTerrain(g,index),remaining=cut.fragments.reduce((s,t)=>s+area(t.points),0);near(remaining,400-width*20);assert.equal(cut.intact.length,0);assert.equal(g.index.count,6);assert.ok(cut.banks.length);g.dispose();}
});
test('île et extérieur restent à leurs positions et attributs d’origine, sans variation avec le LOD',()=> {
 const index=waterRect([rect(2,2,16,16),rect(8,8,4,4)]);
 for(const n of [1,2,4]){const g=grid(n),before=g.attributes.position.array.slice(),cut=cutWaterTerrain(g,index);near(cut.fragments.reduce((s,t)=>s+area(t.points),0)+cut.intact.length/3*400/(n*n*2),160);assert.deepEqual(g.attributes.position.array,before);assert.equal(index.sample(10,10),null);assert.equal(index.sample(5,5).levelM,1);for(const t of cut.fragments)for(const p of t.points){near(p.y,t.source.reduce((s,v,i)=>s+v.y*p.weights[i],0));near(p.normal[1],1);}g.dispose();}
});
test('les lecteurs CPU consultent l’emprise précise même hors du raster',()=>{const g=Object.create(GroundClassMap.prototype);g.setWaterSurface(waterRect([rect(0,0,20,20)]));assert.equal(g.surfaceAt(5,5),'water');assert.equal(g.shareOf('water',5,5),1);assert.equal(g.shareOf('wood',5,5),0);assert.equal(g.cropAt(5,5),null);assert.equal(g.greenAt(5,5),0);assert.equal(g.woodAt(5,5),0);});
test('les capsules publiées couvrent inCorridor et bornent leur erreur à deux centimètres',()=> {
 const index=new RoadIndex([{path:[{x:0,z:0},{x:30,z:0}],halfWidth:3}]),contours=corridorContours(index,{minX:-10,maxX:40,minZ:-10,maxZ:10});
 for(let x=-8;x<=38;x+=.25)for(let z=-8;z<=8;z+=.25){const hit=pointInRings({x,z},contours);if(inCorridor(index,x,z))assert.ok(hit);if(hit)assert.ok(inCorridor(index,x,z,CORRIDOR_MARGIN_M+0.02));}
 const bridge=new RoadIndex([{path:[{x:0,z:0},{x:30,z:0}],halfWidth:3,works:['bridge','bridge']}]);assert.equal(corridorContours(bridge,{minX:-10,maxX:40,minZ:-10,maxZ:10}).length,0);
});
function bubbleFor(index=null) {
 const b=Object.create(TerrainBubble.prototype),support=grid();
 Object.assign(b,{THREE,frame:{scale:20,tileToLocal:(x,z)=>({x:x*20,z:z*20})},verticalScale:1,group:new THREE.Group(),materials:{material:new THREE.MeshLambertMaterial(),fragmentMaterial:new THREE.MeshLambertMaterial()},tiles:new Map(),_waterGeneration:0,_waterSurface:index,_rebuildQueue:[]});
 const tile={x:0,y:0,key:'tuile',segments:1,supportGeometry:support,mesh:new THREE.Mesh(support,b.materials.material),hadWater:false};b.tiles.set(tile.key,tile);b.group.add(tile.mesh);return {b,tile,support};
}
test('un lot de découpe annulé ne publie ni trou ni index et libère ses ressources',()=>{const {b,tile,support}=bubbleFor(),steps=b.prepareWaterSurfaceSteps(waterRect([rect(0,8,20,3)]));steps.next();assert.equal(tile.mesh.geometry,support);assert.equal(b._waterSurface,null);steps.return();assert.equal(tile.mesh.geometry,support);assert.equal(support.index.count,6);b._disposeTile(tile);});
test('publication atomique et libération séparent les index de rendu du support complet',()=>{const {b,tile,support}=bubbleFor(),index=waterRect([rect(0,8,20,3)]),steps=b.prepareWaterSurfaceSteps(index);steps.next();const {value:prepared}=steps.next();b.setWaterSurface(index,prepared);assert.notEqual(tile.mesh.geometry,support);assert.equal(support.index.count,6);assert.ok(tile.waterFragments);assert.equal(b.waterGeneration,1);let disposed=0;support.addEventListener('dispose',()=>disposed++);b._disposeTile(tile);assert.equal(disposed,1);assert.equal(tile.waterFragments,null);assert.equal(b.group.children.length,0);});
test('les fragments transmettent les trois sommets Float32 sources et leurs poids au shader',()=>{const g=grid(),cut=cutWaterTerrain(g,waterRect([rect(0,8,20,3)])),fragments=terrainFragmentGeometry(THREE,cut,4);const p=fragments.attributes.position,w=fragments.attributes.sourceWeights,side=fragments.attributes.waterSide;for(let i=0;i<p.count;i++)if(side.array[i]===0)for(let c=0;c<3;c++){const expected=['A','B','C'].reduce((s,key,j)=>s+w.array[i*3+j]*fragments.attributes[`source${key}`].array[i*3+c],0);near(p.array[i*3+c],expected);}fragments.dispose();g.dispose();});
test('un niveau au-dessus du terrain extérieur porte un diagnostic et ne justifie aucune paroi d’eau',()=>{const g=grid(),cut=cutWaterTerrain(g,waterRect([rect(0,8,20,3)],3));assert.ok(cut.conflicts.some(d=>d.sourceKey==='lac'));g.dispose();});

test('la partition d’une rivière en U conserve les niveaux distincts de ses bras voisins',()=> {
 const path=[{x:-50,z:-80},{x:-50,z:0}];for(let i=1;i<=24;i++){const a=Math.PI-i*Math.PI/24;path.push({x:Math.cos(a)*50,z:Math.sin(a)*50});}path.push({x:50,z:-80});
 const dense=profileStations(path,4),frames=pathFramesForTest(dense),left=[],right=[];
 for(let i=0;i<dense.length;i++){const p=dense[i],px=frames[i*4+2],pz=frames[i*4+3];left.push({x:p.x+px*6,z:p.z+pz*6});right.push({x:p.x-px*6,z:p.z-pz*6});}
 const ring=[...right,...left.reverse()],sample=(x,z)=>z<=0?(x<0?3-(z+80)*.006:2.52-.3*Math.PI+z*.006):2.52-.3*(Math.PI-Math.atan2(z,x));
 const profile=waterwayProfile(path,4.5,sample);assert.equal(profile.status,'resolved');
 const axes=[{key:'u',kind:'river',halfWidth:4.5,points:path,profile,phaseM:0}];constrainPolygonAxes(axes,[{profile:{status:'pending'},shapes:[[ring]]}],sample);assert.equal(axes[0].profile.status,'resolved');
 const sections=riverSections([[ring]],axes,THREE.ShapeUtils.triangulateShape,sample);assert.equal(sections.status,'resolved');
 const index=new WaterSurfaceIndex(sections.candidates);assert.ok(index.sample(-50,-40).levelM-index.sample(50,-40).levelM>1);near(sections.candidates.reduce((s,t)=>s+area(t.points),0),area(ring));assert.equal(index.sample(0,-40),null);
});
import {subdividePath as profileStations,pathFrames as pathFramesForTest} from '../src/layers/ribbonGeometry.js';

test('les confluences partagent une cote et une intersection sans sommet reste séparée',()=> {
 const key=p=>`${p.x}/${p.z}`,lines=[{key:'axe',points:[{x:-10,z:0},{x:0,z:0},{x:10,z:0}]},{key:'bras',points:[{x:0,z:0},{x:0,z:10}]}];
 const split=splitLinesForTest(lines,key);assert.equal(split.length,3);
 const crossing=splitLinesForTest([{key:'a',points:[{x:-10,z:0},{x:10,z:0}]},{key:'b',points:[{x:0,z:-10},{x:0,z:10}]}],key);assert.equal(crossing.length,2);
 const profiles=split.map(l=>waterwayProfile(l.points,1.5,()=>5,{start:5,end:5}));assert.ok(profiles.every(p=>p.status==='resolved'));assert.ok(profiles.every(p=>p.levelAt(0)===5 && p.levelAt(p.total)===5));
});
import {splitWaterLines as splitLinesForTest} from '../src/core/waterLines.js';

test('le polygone fluvial et son ruban partagent exactement les cotes contraintes',()=> {
 const path=[{x:0,z:0},{x:40,z:0}],shapes=[[rect(0,-6,40,12)]],sample=(x,z)=>3-x*.025-Math.abs(z)*.015;
 const axis={key:'axe',kind:'river',points:path,halfWidth:1.5,phaseM:0,profile:waterwayProfile(path,1.5,sample)};
 const first=axis.profile.levelAt(0),last=axis.profile.levelAt(axis.profile.total);
 // Les ancres sont placées à la vraie rive afin de rendre la contrainte réalisable.
 axis.profile=waterwayProfile(path,1.5,sample,{start:first-.0675,end:last-.0675});
 constrainPolygonAxes([axis],[{profile:{status:'pending'},shapes}],sample);
 assert.equal(axis.profile.status,'resolved');near(axis.profile.levelAt(0),first-.0675);near(axis.profile.levelAt(40),last-.0675);
 const sections=riverSections(shapes,[axis],THREE.ShapeUtils.triangulateShape,sample);assert.equal(sections.status,'resolved');
 const index=new WaterSurfaceIndex(sections.candidates);
 for(let x=1;x<40;x+=.5)near(index.sample(x,0).levelM,axis.profile.levelAt(x));
});

test('la grille marine borne les arêtes et partage les sommets de frontière sans atténuation artificielle',()=> {
 const make=(key,x,w)=>({key,kind:'ocean',profile:{status:'resolved',levelAt:()=>0},shapes:[[rect(x,0,w,7)]],edges:[{a:{x:3.1,z:0},b:{x:3.1,z:7},kind:'tile'}]});
 const prepared={polygons:[make('a',0,3.1),make('b',3.1,6.9)],lines:[],resolvedKeys:new Set()};
 const index=placeWater(prepared,[],THREE.ShapeUtils.triangulateShape,{oceanStepM:1.25});
 near(index.triangles.reduce((s,t)=>s+area(t.points),0),70);
 const seam=key=>new Set(index.triangles.filter(t=>t.sourceKey===key).flatMap(t=>t.points).filter(p=>Math.abs(p.x-3.1)<1e-6).map(p=>p.z.toFixed(6)));
 assert.deepEqual(seam('a'),seam('b'));
 for(const t of index.triangles)for(let i=0;i<3;i++){const a=t.points[i],b=t.points[(i+1)%3];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<=1.25+1e-6);}
 const bands=addWaterBands(index);assert.ok(bands.triangles.flatMap(t=>t.points).filter(p=>Math.abs(p.x-3.1)<1e-6).every(p=>p.waveWeight===1));
});
