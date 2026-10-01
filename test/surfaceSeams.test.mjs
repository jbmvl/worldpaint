/* Frontières communes : concavité, altitudes et intersection avec le terrain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { junctionTriangles } from '../src/layers/junctionTriangulation.js';
import { junctionSurface, junctionDeckAt, lowestDeckAround, junctionBoundaryAt } from '../src/layers/roadJunctions.js';
import { appendTunnelSeams } from '../src/layers/tunnelSeams.js';
import { createProfileBuffer } from '../src/layers/ribbonGeometry.js';

const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function concave() {
  const points=[[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]];
  return {x:3,z:1,outline:points.map(([x,z],i)=>({x,z,from:i,to:i,blend:0})),decks:points.map(([x,z])=>20+x+z*.2)};
}

test('la triangulation concave conserve chaque bord sans triangle replié',()=>{
  const area=concave(),{vertices,triangles}=junctionTriangles(area);
  assert.equal(triangles.length,area.outline.length-2);
  const surface=triangles.reduce((sum,[a,b,c])=>sum+Math.abs(cross(vertices[a],vertices[b],vertices[c]))/2,0);
  assert.equal(surface,28,'aucun recouvrement et aucun manque dans le U');
  const edges=new Map();
  for(const triangle of triangles)for(let i=0;i<3;i++) {
    const key=[triangle[i],triangle[(i+1)%3]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);
  }
  for(let i=0;i<area.outline.length;i++) {
    const key=[i+1,(i+1)%area.outline.length+1].sort((a,b)=>a-b).join(':');
    assert.equal(edges.get(key),1,'chaque arête imposée appartient à une seule face');
  }
});

test('rendu et altitude lisent exactement les mêmes triangles concaves',()=>{
  const area=concave(),mesh=junctionSurface(area,area.decks);
  for(let i=0;i<mesh.indices.length;i+=3) {
    const points=mesh.indices.slice(i,i+3).map(k=>mesh.positions.slice(k*3,k*3+3));
    const centre=[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k],0)/3);
    assert.ok(Math.abs(junctionDeckAt(area,area.decks,centre[0],centre[2])-centre[1])<1e-9);
  }
  for(let i=0;i<area.outline.length;i++) {
    const a=area.outline[i],b=area.outline[(i+1)%area.outline.length];
    assert.ok(Math.abs(junctionDeckAt(area,area.decks,(a.x+b.x)/2,(a.z+b.z)/2)-(area.decks[i]+area.decks[(i+1)%area.decks.length])/2)<1e-9);
  }
});

test('une bouche découpée adopte la cote commune, même avec une plateforme différente',()=>{
  const area={x:0,z:0,outline:[[-2,-2],[2,-2],[2,2],[-2,2]].map(([x,z])=>({x,z})),decks:[30]};
  const segment={path:[{x:-4,z:0,distance:0},{x:0,z:0,distance:4}],platform:Float32Array.of(25,25),junction:Int32Array.of(-1,0)};
  const boundary=junctionBoundaryAt(segment,{areas:[area]},0,1);
  assert.equal(boundary.deck,30);
  assert.ok(Math.abs(boundary.point.x+2)<.001);
});

test('le minimum de déblai existe aussi dans un triangle plat loin de ses sommets',()=>{
  const area=concave();area.decks.fill(20);
  assert.equal(lowestDeckAround(area,1,3,.1),20);
});

function tile(n=1) {
  const positions=[],indices=[];
  for(let z=0;z<=n;z++)for(let x=0;x<=n;x++) {
    const px=-10+20*x/n,pz=-10+20*z/n;positions.push(px,3+.1*px-.05*pz,pz);
  }
  for(let z=0;z<n;z++)for(let x=0;x<n;x++) {
    const a=z*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,c,b,b,c,d);
  }
  return {segments:n,size:20,geometry:{attributes:{position:{array:positions}},index:{array:indices}}};
}
const mouth={x:0,z:0,y:0,dx:1,dz:0,slope:0,apron:6};
const profile=[[-2,0],[-2,5],[2,5],[2,0]].map(([across,up])=>({across,up,color:[.2,.2,.2]}));
function area3(buffer) {
  let total=0;
  for(let i=0;i<buffer.indices.length;i+=3) {
    const [a,b,c]=buffer.indices.slice(i,i+3).map(j=>buffer.positions.slice(j*3,j*3+3));
    const u=b.map((v,k)=>v-a[k]),v=c.map((w,k)=>w-a[k]);
    total+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
  }
  return total;
}

test('la couture du portail atteint les triangles du sol sans les dépasser',()=>{
  const buffer=createProfileBuffer();appendTunnelSeams(buffer,mouth,profile,[tile()]);
  assert.ok(Math.abs(area3(buffer)-42)<1e-8,'les deux parois et le front ferment tout le volume sous le sol');
  let contact=0;
  for(let i=0;i<buffer.positions.length;i+=3) {
    const [x,y,z]=buffer.positions.slice(i,i+3),ground=3+.1*x-.05*z;
    assert.ok(y<=ground+1e-9);
    if(Math.abs(y-ground)<1e-9)contact++;
  }
  assert.ok(contact>3,'les sommets de couture appartiennent au plan du terrain');
});

test('raffiner les triangles ne change pas la surface du raccord',()=>{
  const surfaces=[1,2,8].map(n=>{const buffer=createProfileBuffer();appendTunnelSeams(buffer,mouth,profile,[tile(n)]);return area3(buffer);});
  for(const surface of surfaces)assert.ok(Math.abs(surface-42)<1e-8);
});


test('un contour avec un sommet répété est invalide, sans éventail de secours',()=>{
  const area={x:1,z:1,outline:[[0,0],[4,0],[4,4],[0,4],[4,0]].map(([x,z])=>({x,z}))};
  assert.equal(junctionTriangles(area).valid,false);
  assert.equal(junctionTriangles(area).triangles.length,0);
});
