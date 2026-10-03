/* Les boucles couvertes gardent leurs deux sorties, même sans troisième bouche libre. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, junctionArea, junctionRibbonRuns, junctionSurface } from '../src/layers/roadJunctions.js';
import { bindJunctionSeams, updateJunctionSeams } from '../src/layers/junctionSeams.js';
import { junctionTriangles } from '../src/layers/junctionTriangulation.js';
import { appendRibbon, createRibbonBuffer, subdividePath } from '../src/layers/ribbonGeometry.js';

const voie = points => ({ profile: 'minor', halfWidth: 2.5, points: points.map(([x,z]) => ({x,z})) });
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
