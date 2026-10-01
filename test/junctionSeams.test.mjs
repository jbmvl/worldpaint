/* Couture des buffers : un millimètre couvre l'arrondi Float32 des coordonnées locales. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRoadSegments } from '../src/layers/roadNetwork.js';
import { updateJunctionSeams } from '../src/layers/junctionSeams.js';
import { junctionRibbonRuns, junctionSurface } from '../src/layers/roadJunctions.js';
import { appendRibbon, createRibbonBuffer } from '../src/layers/ribbonGeometry.js';
import { createLocalFrame } from '../src/core/tileMath.js';
const tolerance = .001;
const frame = createLocalFrame(0, 47, 14);
function reseau() {
  const lignes = [[[-80,0],[0,0],[3,0],[10,8],[50,35]], [[0,0],[0,-65]]];
  const source = { forEachFeature(layer, tiles, callback) {
    if (layer !== 'transportation') return;
    for (const points of lignes) callback({type:'LineString', coordinates:points.map(([x,z])=>{
      const p=frame.toLngLat(x,z); return [p.lng,p.lat];
    })}, {class:'minor'});
  }};
  const result=collectRoadSegments(source,[],{x:0,z:0},frame,(x,z)=>30+.1*x+.03*z);
  updateJunctionSeams(result.areas);
  return result;
}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('la branche courbe partage toute la frontière XYZ et sa subdivision avec la dalle',()=>{
  const {segments,areas}=reseau();
  const sommets=[];
  for(const segment of segments) for(const run of junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}])) {
    const buffer=createRibbonBuffer(); appendRibbon(buffer,{...run,halfWidth:segment.halfWidth,sampleElevation:()=>0});
    for(const row of [run.head>=0?0:-1,run.tail>=0?run.path.length-1:-1]) if(row>=0)
      for(let c=0;c<5;c++) sommets.push(buffer.positions.slice((row*5+c)*3,(row*5+c+1)*3));
  }
  for(const area of areas.areas) {
    const mesh=junctionSurface(area,area.decks);
    const vertices=Array.from({length:mesh.positions.length/3},(_,i)=>mesh.positions.slice(i*3,i*3+3));
    for(const [i,mouth] of area.mouths.entries()) for(const p of [mouth.left,mouth.right]) {
      const expected=[p.x,area.decks[i],p.z];
      const error=Math.min(...sommets.map(v=>distance(v,expected)));
      assert.ok(error<tolerance,`bouche ${i} : écart XYZ ${error} m en ${JSON.stringify(expected)}`);
    }
    for(const v of sommets) assert.ok(vertices.some(p=>distance(p,v)<tolerance),`sommet pendant ${JSON.stringify(v)}`);
  }
});

import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, markJunctionRows } from '../src/layers/roadJunctions.js';
import { bindJunctionSeams } from '../src/layers/junctionSeams.js';
import { subdividePath, pathFrames } from '../src/layers/ribbonGeometry.js';
const voie=(points,width=2.5,extra={})=>({profile:'minor',halfWidth:width,points:points.map(([x,z])=>({x,z})),...extra});
const matrice={
  T:[voie([[-80,0],[0,0],[80,0]]),voie([[0,0],[0,80]])],
  croix:[voie([[-80,0],[0,0],[80,0]],4),voie([[0,-80],[0,0],[0,80]])],
  courbe:[voie([[-80,0],[0,0],[3,0],[10,8],[50,35]],4),voie([[0,0],[0,-65]])],
  proches:[voie([[-80,0],[0,0],[17,0],[80,0]]),voie([[0,0],[0,-60]]),voie([[17,0],[17,60]])],
  tresProches:[voie([[-80,0],[0,0],[8,0],[80,0]]),voie([[0,0],[0,-60]]),voie([[8,0],[8,60]])],
  fourche:[voie([[-80,0],[0,0]],4.25),...[-1,1].map(sign=>voie(Array.from({length:16},(_,i)=>[i*6,sign*(.1*i*6+.003*(i*6)**2)]),2.5,{oneway:sign}))],
  boucle:[voie([[-80,0],[0,0]]),voie([[0,0],[30,0]]),voie([[0,0],[27,-.4],[30,0]]),voie([[30,0],[95,30]]),voie([[30,0],[70,-60]])],
  giratoire:[voie(Array.from({length:17},(_,i)=>[20*Math.cos(i*Math.PI/8),20*Math.sin(i*Math.PI/8)]),4),...[0,1,2,3].map(i=>voie([[20*Math.cos(i*Math.PI/2),20*Math.sin(i*Math.PI/2)],[100*Math.cos(i*Math.PI/2),100*Math.sin(i*Math.PI/2)]]))],
};
function maillage(lignes,pas,pente,inverse=false) {
  const input=inverse?lignes.slice().reverse().map(l=>({...l,points:l.points.slice().reverse()})):lignes;
  const {chains,junctions}=mergeRoadLines(input);
  const areas=new JunctionAreas(junctions);
  const segments=chains.map(chain=>{
    const path=subdividePath(chain.points,pas);
    return {...chain,path,frames:pathFrames(path),platform:Float32Array.from(path,p=>30+pente*(p.x+.3*p.z))};
  });
  bindJunctionSeams(segments,areas);
  for(const segment of segments) segment.junction=markJunctionRows(segment,areas);
  updateJunctionSeams(areas);
  const buffers=areas.areas.map(a=>junctionSurface(a,a.decks.map(y=>y+.02)));
  for(const segment of segments)for(const run of junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}])) {
    const buffer=createRibbonBuffer();appendRibbon(buffer,{...run,halfWidth:segment.halfWidth,sampleElevation:()=>0,lift:.02});buffers.push(buffer);
  }
  return {segments,areas,buffers};
}
const cle=p=>p.map(v=>Math.round(v/tolerance)).join(':');
function controle({areas,buffers}) {
  const edges=new Map();
  for(const buffer of buffers) {
    assert.ok(buffer);
    assert.ok(buffer.indices.length>0,'aucune dalle supprimée');
    assert.ok(buffer.positions.every(Number.isFinite),'toutes les coordonnées sont finies');
    const vertices=Array.from({length:buffer.positions.length/3},(_,i)=>buffer.positions.slice(i*3,i*3+3).map(Math.fround));
    for(let i=0;i<buffer.indices.length;i+=3) {
      const tri=buffer.indices.slice(i,i+3).map(j=>vertices[j]);
      const [a,b,c]=tri, orientation=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
      assert.ok(orientation>1e-7,`face dégénérée ou inversée ${JSON.stringify(tri)}`);
      for(let j=0;j<3;j++) {
        const p=tri[j],q=tri[(j+1)%3],key=[cle(p),cle(q)].sort().join('/');
        if(!edges.has(key)) edges.set(key,[]);
        edges.get(key).push({p,q,third:tri[(j+2)%3]});
      }
    }
  }
  for(const area of areas.areas)for(const [rank,mouth]of area.mouths.entries()) {
    assert.ok(mouth.seam,'la bouche appartient à une branche précise');
    const boundary=mouth.boundary.map(p=>[p.x,area.decks[rank]+.02,p.z].map(Math.fround));
    for(let i=1;i<boundary.length;i++) {
      const a=boundary[i-1],b=boundary[i],key=[cle(a),cle(b)].sort().join('/'),faces=edges.get(key);
      assert.equal(faces?.length,2,`deux faces sur la couture ${key}`);
      const side=p=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
      assert.ok(side(faces[0].third)*side(faces[1].third)<0,'une face de chaque côté');
    }
  }
}
for(const [nom,lignes] of Object.entries(matrice)) for(const pente of [0,.12]) for(const pas of [2,9]) {
  test(`${nom}, pente ${pente}, pas ${pas} : faces et arêtes de couture`,()=>controle(maillage(lignes,pas,pente)));
}

function intersection(a,b) {
  let polygon=a.map(p=>[p[0],p[2]]);
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const clip=b.map(p=>[p[0],p[2]]);
  for(let i=0;i<3;i++) {
    const u=clip[i],v=clip[(i+1)%3],out=[];
    for(let j=0;j<polygon.length;j++) {
      const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=cross(u,v,p),dq=cross(u,v,q);
      if(dp<=0) out.push(p);
      if((dp<0)!==(dq<0)) {const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    polygon=out;
  }
  return Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
}
function sansRecouvrement({buffers,areas}) {
  const triangles=buffers.flatMap((buffer,bi)=>Array.from({length:buffer.indices.length/3},(_,i)=>{
    const points=buffer.indices.slice(i*3,i*3+3).map(j=>buffer.positions.slice(j*3,j*3+3));
    return {points,bi,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[2])),maxZ:Math.max(...points.map(p=>p[2]))};
  }));
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++) {
    const a=triangles[i],b=triangles[j];
    if(a.bi>=areas.length && b.bi>=areas.length)continue;
    if(a.maxX<=b.minX || b.maxX<=a.minX || a.maxZ<=b.minZ || b.maxZ<=a.minZ)continue;
    const overlap=intersection(a.points,b.points);
    assert.ok(overlap<1e-5,`recouvrement ${overlap} m² entre ${JSON.stringify(a.points)} et ${JSON.stringify(b.points)}`);
  }
}
for(const [nom,lignes] of Object.entries(matrice)) test(`${nom} : aucun recouvrement intérieur des triangles de dalle`,()=>sansRecouvrement(maillage(lignes,9,.12)));

for(const [nom,lignes]of Object.entries(matrice)) test(`${nom} : ordre et sens des données indépendants des buffers`,()=>{
  const signature=result=>result.buffers.flatMap(buffer=>Array.from({length:buffer.indices.length/3},(_,i)=>
    buffer.indices.slice(i*3,i*3+3).map(j=>cle(buffer.positions.slice(j*3,j*3+3))).sort().join('/'))).sort();
  assert.deepEqual(signature(maillage(lignes,9,.12)),signature(maillage(lignes,9,.12,true)));
});

test('une traversée reste découpée lorsque les deux échantillons sont dehors',()=>{
  const {chains,junctions}=mergeRoadLines(matrice.T),areas=new JunctionAreas(junctions);
  const segments=chains.map(chain=>({...chain,path:subdividePath([chain.points[0],chain.points.at(-1)],1000),platform:Float32Array.of(30,30)}));
  bindJunctionSeams(segments,areas);updateJunctionSeams(areas);
  for(const segment of segments)segment.junction=markJunctionRows(segment,areas);
  const traversante=segments.find(s=>s.path[0].x<0 && s.path.at(-1).x>0);
  assert.ok(traversante.junction.every(i=>i<0));
  assert.equal(junctionRibbonRuns(traversante,areas,[{from:0,to:1}]).length,2);
});

test('une voie de même niveau qui ne nourrit pas l’aire conserve son ruban',()=>{
  const {areas}=maillage(matrice.T,2,0);
  const intruse={path:subdividePath([{x:-30,z:1},{x:30,z:1}],3),halfWidth:.5,graphEdges:new Set()};
  intruse.platform=new Float32Array(intruse.path.length).fill(30);
  bindJunctionSeams([intruse],areas);intruse.junction=markJunctionRows(intruse,areas);
  assert.ok(intruse.junction.every(i=>i===-1));
  assert.equal(junctionRibbonRuns(intruse,areas,[{from:0,to:intruse.path.length-1}])[0].path.length,intruse.path.length);
});

test('le pont superposé n’ouvre aucune bouche au niveau inférieur',()=>{
  const lignes=[...matrice.T,voie([[1,-80],[1,80]],3,{level:1,works:1})];
  const result=maillage(lignes,2,0);
  assert.equal(result.areas.length,1);
  assert.equal(result.areas.areas[0].mouths.length,3);
  const pont=result.segments.find(s=>s.works?.some(w=>w===1));
  assert.equal(pont.junctionSeams.length,0);
});

test('la cote finale d’une bouche peut appartenir à la transition d’un tunnel',()=>{
  const lignes=[
    {points:[[-80,0],[0,0],[4,0]],props:{class:'minor'}},
    {points:[[4,0],[42,0]],props:{class:'minor',layer:-1,brunnel:'tunnel'}},
    {points:[[42,0],[100,0]],props:{class:'minor'}},
    {points:[[0,0],[0,-80]],props:{class:'minor'}},
  ];
  const source={forEachFeature(layer,tiles,callback){if(layer!=='transportation')return;for(const l of lignes)callback({type:'LineString',coordinates:l.points.map(([x,z])=>{const p=frame.toLngLat(x,z);return[p.lng,p.lat]})},l.props)}};
  const {segments,areas}=collectRoadSegments(source,[],{x:0,z:0},frame,()=>50);
  updateJunctionSeams(areas);
  assert.equal(areas.length,1);
  assert.ok(areas.areas[0].decks.every(Number.isFinite));
  assert.ok(segments.some(s=>s.platform.some(y=>y<49)),'le déblai de tunnel reste en place');
  const buffers=areas.areas.map(a=>junctionSurface(a,a.decks.map(y=>y+.02)));
  for(const segment of segments)for(const run of junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}])){
    const buffer=createRibbonBuffer();appendRibbon(buffer,{...run,halfWidth:segment.halfWidth,sampleElevation:()=>50,lift:.02});buffers.push(buffer);
  }
  controle({areas,buffers});sansRecouvrement({areas,buffers});
});

for(const [nom,lignes]of Object.entries(matrice)) test(`${nom} : frontières indépendantes du pas d’échantillonnage`,()=>{
  const signature=result=>result.areas.areas.flatMap(a=>a.mouths.map((m,i)=>m.boundary.map(p=>cle([p.x,a.decks[i],p.z])).sort().join('/'))).sort();
  assert.deepEqual(signature(maillage(lignes,2,.12)),signature(maillage(lignes,9,.12)));
});

test('les mêmes tuiles découpées, dupliquées et reçues à l’envers gardent les coutures',()=>{
  const lignes=matrice.croix;
  const tuiles=lignes.flatMap(l=>l.points.slice(1).map((p,i)=>({...l,points:[l.points[i],p]})));
  const morceaux=[...tuiles,...tuiles].reverse();
  const signature=result=>result.areas.areas.flatMap(a=>a.mouths.map((m,i)=>m.boundary.map(p=>cle([p.x,a.decks[i],p.z])).sort().join('/'))).sort();
  assert.deepEqual(signature(maillage(lignes,9,.12)),signature(maillage(morceaux,9,.12)));
});

for(const [nom,lignes]of Object.entries(matrice)) test(`${nom} : seuls les contours déclarés sont des bords de dalle`,()=>{
  const {areas,buffers}=maillage(lignes,9,.12);
  for(const [ai,area]of areas.areas.entries()) {
    const buffer=buffers[ai],edges=new Map();
    const edge=(a,b)=>[a,b].sort((a,b)=>a-b).join(':');
    for(let i=0;i<buffer.indices.length;i+=3)for(let k=0;k<3;k++){
      const key=edge(buffer.indices[i+k],buffer.indices[i+(k+1)%3]);edges.set(key,(edges.get(key)??0)+1);
    }
    const border=new Set(),n=area.outline.length;
    for(let i=0;i<n;i++)border.add(edge(1+i,1+(i+1)%n));
    if(area.island)for(let i=0;i<n;i++)border.add(edge(n+1+i,n+1+(i+1)%n));
    for(const key of border)assert.equal(edges.get(key),1,`bord perdu ${key}`);
    for(const [key,count]of edges)assert.equal(count,border.has(key)?1:2,`trou intérieur ${key}`);
  }
});

import { readFileSync } from 'node:fs';
import { junctionArea } from '../src/layers/roadJunctions.js';
import { junctionTriangles } from '../src/layers/junctionTriangulation.js';
const contours=JSON.parse(readFileSync(new URL('./fixtures/junction-contours-montreuil.json',import.meta.url)));
for(const {repere,junction,voisin} of contours) test(`Montreuil ${repere} : les tangentes des bouches ne replient pas le contour`,()=>{
  const area=voisin ? new JunctionAreas([junction,voisin]).areas[0] : junctionArea(junction);
  assert.ok(area,'le carrefour reste présent');
  assert.equal(junctionTriangles(area).valid,true,'le contour réel doit être triangulable');
  const buffer=junctionSurface(area,30);
  controle({areas:{areas:[],length:1},buffers:[buffer]});
  sansRecouvrement({areas:{length:1},buffers:[buffer]});
});
