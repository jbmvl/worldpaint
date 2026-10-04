/* Les boucles couvertes gardent leurs deux sorties, même sans troisième bouche libre. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, junctionArea, junctionRibbonRuns, junctionSurface } from '../src/layers/roadJunctions.js';
import { bindJunctionSeams, updateJunctionSeams } from '../src/layers/junctionSeams.js';
import { junctionTriangles } from '../src/layers/junctionTriangulation.js';
import { appendRibbon, createRibbonBuffer, subdividePath } from '../src/layers/ribbonGeometry.js';

const voie = (points,works=0) => ({ profile: 'minor', halfWidth: 2.5, works, level:works?-1:0, points: points.map(([x,z]) => ({x,z})) });
const cle = point => point.map(value => Math.round(value * 1000)).join(':');
const arete = (a,b) => [cle(a),cle(b)].sort().join('/');

for (const sortie of [[95,0],[70,40],[30,80],[10,40]]) {
  test(`la boucle à deux sorties conserve ses coutures vers ${sortie}`, () => {
    const lignes = [voie([[-80,0],[0,0]]), voie([[0,0],[30,0]]),
      voie([[0,0],[15,-2],[30,0]]), voie([[30,0],sortie])];
    const signatures = [];
    for (const inverse of [false,true]) {
      const input = inverse ? lignes.slice().reverse().map(l => ({...l,points:l.points.slice().reverse()})) : lignes;
      const {chains,junctions} = mergeRoadLines(input);
      assert.equal(junctions.length,2,'les deux nœuds restent dans le graphe');
      assert.ok(junctions.every(j => j.branches.length === 3));
      const areas = new JunctionAreas(junctions);
      assert.equal(areas.length,1,'la boucle publie une surface commune');
      const segments = chains.map(chain => {
        const path = subdividePath(chain.points,3);
        return {...chain,path,platform:Float32Array.from(path,p => 30+.1*p.x+.03*p.z)};
      });
      bindJunctionSeams(segments,areas);
      updateJunctionSeams(areas);
      const area = areas.areas[0], mesh = junctionTriangles(area);
      assert.equal(area.mouths.length,2);
      assert.ok(mesh.valid);
      assert.ok(area.decks.every(Number.isFinite));
      const bords = new Map();
      for (const tri of mesh.triangles) for (let k=0;k<3;k++) {
        const key = [tri[k],tri[(k+1)%3]].sort((a,b)=>a-b).join(':');
        bords.set(key,(bords.get(key) ?? 0)+1);
      }
      for (let i=0;i<area.outline.length;i++) {
        const key = [i+1,1+(i+1)%area.outline.length].sort((a,b)=>a-b).join(':');
        assert.equal(bords.get(key),1,'la triangulation conserve tout le contour');
      }
      const buffers = [junctionSurface(area,area.decks)];
      for (const segment of segments) {
        const runs = junctionRibbonRuns(segment,areas,[{from:0,to:segment.path.length-1}]);
        if (segment.junctionRing >= 0) assert.equal(runs.length,0,'les deux voies intérieures ne doublent pas la dalle');
        for (const run of runs) {
          const buffer = createRibbonBuffer();
          appendRibbon(buffer,{...run,halfWidth:segment.halfWidth,sampleElevation:()=>0});
          buffers.push(buffer);
        }
      }
      const coutures = new Map();
      for (const buffer of buffers) for (let i=0;i<buffer.indices.length;i+=3) {
        const tri = buffer.indices.slice(i,i+3).map(k => buffer.positions.slice(k*3,k*3+3));
        for (let k=0;k<3;k++) {
          const key = arete(tri[k],tri[(k+1)%3]);
          coutures.set(key,(coutures.get(key) ?? 0)+1);
        }
      }
      for (const mouth of area.mouths) {
        assert.ok(mouth.seam);
        for (let i=1;i<mouth.boundary.length;i++) {
          const points = mouth.boundary.slice(i-1,i+1).map(p => [p.x,p.y,p.z]);
          assert.equal(coutures.get(arete(...points)),2,'la bouche partage chaque arête avec son ruban');
        }
      }
      signatures.push(area.outline.map(p => cle([p.x,p.y ?? 0,p.z])).sort());
    }
    assert.deepEqual(signatures[0],signatures[1]);
  });
}

test('deux branches ordinaires ne créent pas un carrefour', () => {
  assert.equal(junctionArea({x:0,z:0,branches:[{x:-1,z:0,halfWidth:2.5},{x:1,z:0,halfWidth:2.5}]}),null);
});

test('une boucle souterraine conserve ses sorties sans fourche extrapolée',()=>{
  const {chains,junctions}=mergeRoadLines([voie([[-80,0],[0,0]],2),voie([[0,0],[3,0]],2),
    voie([[0,0],[1.5,-1],[3,0]],2),voie([[3,0],[60,0]],2)]);
  const areas=new JunctionAreas(junctions);
  const segments=chains.map(chain=>({...chain,path:subdividePath(chain.points,3),
    platform:Float32Array.from(subdividePath(chain.points,3),()=>17)}));
  bindJunctionSeams(segments,areas);updateJunctionSeams(areas);
  assert.equal(areas.length,1);
  assert.equal(areas.areas[0].mouths.length,2);
  assert.ok(areas.areas[0].mouths.every(m=>m.seam));
  assert.ok(areas.areas[0].outline.every(p=>p.x>-5 && p.x<8));
});

test('une sortie en impasse de trois mètres porte une couture à son extrémité',()=>{
  const {chains,junctions}=mergeRoadLines([voie([[-80,0],[0,0]]),voie([[0,0],[80,0]]),voie([[0,0],[0,3]])]);
  const areas=new JunctionAreas(junctions);
  const segments=chains.map(chain=>({...chain,path:subdividePath(chain.points,3),
    platform:Float32Array.from(subdividePath(chain.points,3),()=>17)}));
  bindJunctionSeams(segments,areas);
  assert.ok(areas.areas[0].mouths.every(m=>m.seam));
});

test('une bouche de fourche retrouve la continuation après une coupure de chaîne',()=>{
  const {chains,junctions}=mergeRoadLines([voie([[-80,0],[0,0],[10,0],[80,0]]),
    voie([[0,0],[10,1],[80,20]])]);
  const branch=junctions[0].branches.find(b=>b.path.at(-1).x===80 && b.path.at(-1).z===0);
  const last=[...branch.edges].at(-1),segments=[];
  let continuation;
  for(const chain of chains) {
    const path=subdividePath(chain.points,3);
    if(chain.graphEdges.has(last)) {
      const split=path.findIndex(p=>p.x===10 && p.z===0);
      assert.ok(split>0);
      segments.push({...chain,graphEdges:new Set([...chain.graphEdges].filter(e=>e!==last)),path:path.slice(0,split+1),platform:new Float32Array(split+1).fill(17)});
      continuation={...chain,graphEdges:new Set([last]),path:path.slice(split),platform:new Float32Array(path.length-split).fill(17)};
      segments.push(continuation);
    } else segments.push({...chain,path,platform:new Float32Array(path.length).fill(17)});
  }
  const areas=new JunctionAreas(junctions);bindJunctionSeams(segments,areas);
  const mouth=areas.areas[0].mouths.find(m=>m.edge===branch.edge);
  assert.equal(mouth.seam?.segment,continuation);
});

test('une fourche qui atteint un changement de classe ferme sa bouche sur le vrai axe',()=>{
  const express=points=>({...voie(points),profile:'express',halfWidth:6});
  const lines=[express([[160,-140],[0,0]]),express([[0,0],[-5,1.5],[-15,8],[-35,17]]),
    express([[0,0],[-28,24],[-140,120]]),voie([[-35,17],[-70,17]]),voie([[-35,17],[-35,-35]])];
  for(const input of [lines,lines.slice().reverse()]) {
    const {chains,junctions}=mergeRoadLines(input);
    const segments=chains.map(chain=>({...chain,path:subdividePath(chain.points,3),
      platform:Float32Array.from(subdividePath(chain.points,3),()=>17)}));
    const areas=new JunctionAreas(junctions);bindJunctionSeams(segments,areas);updateJunctionSeams(areas);
    assert.ok(areas.areas.every(a=>a.mouths.every(m=>m.seam)));
    assert.ok(areas.areas.every(a=>a.decks.every(Number.isFinite)));
  }
});
