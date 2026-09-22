/* Régressions de streaming : le même tronçon conserve son origine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadContinuity } from '../src/layers/roadContinuity.js';
const chain = xs => ({ profile: 'minor', points: xs.map(x => ({ x, z: 0 })), anchors: xs.map(() => false), oneway: xs.map(() => 1) });
test('une route sans carrefour conserve son origine quand les tuiles prolongent sa tête', () => {
  const memory = new RoadContinuity();
  memory.resolve(chain([0, 100, 200]));
  const extended = memory.resolve(chain([-20, 0, 100, 200, 300]));
  assert.equal(extended.distance[2], 100);
  assert.deepEqual(extended.anchor, { x: 0, z: 0 });
});
test('le parcours inverse conserve le côté et le sens de circulation', () => {
  const memory = new RoadContinuity();
  memory.resolve(chain([0, 100, 200]));
  const reversed = chain([300, 200, 100, 0]);
  reversed.oneway.fill(-1);
  memory.resolve(reversed);
  assert.equal(reversed.points[0].x, 0);
  assert.ok(reversed.oneway.every(v => v === 1));
});
