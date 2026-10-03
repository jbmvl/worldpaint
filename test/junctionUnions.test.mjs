/* Une fourche qui déborde un voisin garde une dalle unique et des coutures complètes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, junctionRibbonRuns, junctionSurface, areaCovers } from '../src/layers/roadJunctions.js';
import { bindJunctionSeams, updateJunctionSeams } from '../src/layers/junctionSeams.js';
import { appendRibbon, createRibbonBuffer, subdividePath } from '../src/layers/ribbonGeometry.js';
import { unirAiresFourches } from '../src/layers/junctionUnions.js';
import { buildCrossings } from '../src/layers/furniture/junctionFurniture.js';

const lignes = [[[-50,0],[0,0]],[[0,0],[10,1],[50,5]],[[0,0],[50,-5]],[[10,1],[10,40]]]
  .map(points=>({profile:'minor',halfWidth:2.5,points:points.map(([x,z])=>({x,z}))}));
const cle=p=>p.map(v=>Math.round(v*1000)).join(':');
const cote=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);

function recouvrement(a,b) {
  let polygone=a;
  for(let i=0;i<3;i++) {
    const u=b[i],v=b[(i+1)%3],suivant=[];
    for(let j=0;j<polygone.length;j++) {
      const p=polygone[j],q=polygone[(j+1)%polygone.length],dp=cote(u,v,p),dq=cote(u,v,q);
      if(dp<=0)suivant.push(p);
      if((dp<0)!==(dq<0)) {const t=dp/(dp-dq);suivant.push(p.map((x,k)=>x+(q[k]-x)*t));}
    }
    polygone=suivant;
  }
  return Math.abs(polygone.reduce((s,p,i)=>{const q=polygone[(i+1)%polygone.length];return s+p[0]*q[2]-p[2]*q[0];},0))/2;
}

function construire(pas,pente,inverse=false) {
  const donnees=inverse?lignes.slice().reverse().map(l=>({...l,points:l.points.slice().reverse()})):lignes;
  const {chains,junctions}=mergeRoadLines(donnees,{weld:.01,graft:.01});
  const areas=new JunctionAreas(junctions);
  assert.equal(junctions.length,2,'le graphe conserve la fourche et le T');
  assert.equal(areas.length,1,'une dalle couvre la rencontre des deux carrefours');
  const segments=chains.map(c=>{const path=subdividePath(c.points,pas);return {...c,path,platform:Float32Array.from(path,p=>30+pente*(p.x+.3*p.z))};});
  bindJunctionSeams(segments,areas);updateJunctionSeams(areas);
  const aire=areas.areas[0];
  assert.equal(aire.mouths.length,4,'seules les quatre branches extérieures gardent une bouche');
  assert.ok(aire.decks.every(Number.isFinite));
  const buffers=[junctionSurface(aire,aire.decks)];
  for(const segment of segments)for(const run of junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}])) {
    const buffer=createRibbonBuffer();appendRibbon(buffer,{...run,halfWidth:segment.halfWidth,sampleElevation:()=>0});buffers.push(buffer);
  }
  const triangles=buffers.flatMap((b,bi)=>Array.from({length:b.indices.length/3},(_,i)=>({bi,
    points:b.indices.slice(i*3,i*3+3).map(k=>b.positions.slice(k*3,k*3+3))})));
  const aretes=new Map();
  for(const {points} of triangles) {
    assert.ok(cote(points[0],points[1],points[2])<-1e-8,'toutes les faces sont orientées et non dégénérées');
    for(let i=0;i<3;i++) {
      const key=[cle(points[i]),cle(points[(i+1)%3])].sort().join('/');
      if(!aretes.has(key))aretes.set(key,[]);
      aretes.get(key).push(points[(i+2)%3]);
    }
  }
  for(const bouche of aire.mouths) {
    assert.ok(bouche.seam,'chaque bouche retrouve un axe réel du groupe');
    for(let i=1;i<bouche.boundary.length;i++) {
      const [a,b]=bouche.boundary.slice(i-1,i+1).map(p=>[p.x,p.y,p.z]);
      const faces=aretes.get([cle(a),cle(b)].sort().join('/'));
      assert.equal(faces?.length,2,'la dalle et le ruban partagent leur arête');
      assert.ok(cote(a,b,faces[0])*cote(a,b,faces[1])<0,'une face de chaque côté de la couture');
    }
  }
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++) {
    if(triangles[i].bi && triangles[j].bi)continue;
    assert.ok(recouvrement(triangles[i].points,triangles[j].points)<1e-6,'la dalle ne double ni une autre face ni un ruban');
  }
  return triangles.map(t=>t.points.map(cle).sort().join('/')).sort();
}

for(const pas of [2,9])for(const pente of [0,.12])test(`fourche puis T, pas ${pas}, pente ${pente} : frontières continues sans recouvrement`,()=>construire(pas,pente));
test('la surface composée ne dépend ni de l’ordre ni du sens des lignes',()=>assert.deepEqual(construire(9,.12),construire(9,.12,true)));

function contours(a,b,niveau=0) {
  const edge={},branche={edge,mouthLimit:1,path:[{x:0,z:0},{x:4,z:4}],edges:new Set([edge])};
  return [{junction:{x:0,z:0,level:0,branches:[branche]},area:{fork:true,outline:a.map(([x,z])=>({x,z})),
    mouths:[{edge,distance:2,left:{x:4,z:0},right:{x:4,z:4}}]}},
  {junction:{x:4,z:4,level:niveau,branches:[]},area:{outline:b.map(([x,z])=>({x,z})),mouths:[]}}];
}

test('l’union conserve l’îlot découvert entre les deux surfaces',()=>{
  const entrees=contours([[0,0],[4,0],[4,3],[3,3],[3,1],[1,1],[1,3],[0,3]],[[0,2],[4,2],[4,4],[0,4]]);
  assert.deepEqual(unirAiresFourches(entrees),entrees.map(e=>e.area));
});

test('une bouche partiellement recouverte ne perd pas la moitié de sa couture',()=>{
  const entrees=contours([[0,0],[4,0],[4,4],[0,4]],[[2,2],[6,2],[6,6],[2,6]]);
  assert.deepEqual(unirAiresFourches(entrees),entrees.map(e=>e.area));
});

test('les dalles de niveaux distincts restent distinctes',()=>{
  const entrees=contours([[0,0],[4,0],[4,4],[0,4]],[[2,2],[6,2],[6,6],[2,6]],1);
  assert.deepEqual(unirAiresFourches(entrees),entrees.map(e=>e.area));
});

test('le feu d’une surface commune borde un accès extérieur, pas sa liaison intérieure',()=>{
  const {junctions}=mergeRoadLines(lignes.map(l=>({...l,profile:'major'})),{weld:.01,graft:.01});
  const areas=new JunctionAreas(junctions),positions=[];
  const layer={_areas:areas,_signals:[],_place:(_p,item,at)=>{positions.push({item,...at});return at;}};
  const index={query:(x,z)=>{
    assert.equal(areaCovers(areas.areas[0],x,z),false,'le feu se trouve en amont de la bouche extérieure');
    return {x,z};
  },deckAt:()=>30};
  const bati=[[[ -100,-100],[100,-100],[100,100],[-100,100]].map(([x,z])=>({x,z}))];
  buildCrossings(layer,{placements:new Map(),here:{x:0,z:0}},junctions,index,bati);
  assert.equal(positions.length,1);
  assert.equal(positions[0].item,'trafficLight');
  assert.equal(layer._signalled.length,1);
  assert.equal(layer._signalled[0].x,areas.areas[0].x);
  assert.equal(layer._signalled[0].z,areas.areas[0].z);
});
