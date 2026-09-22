/* Un enrichissement des données ne redessine pas une silhouette connue. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stableStand } from '../src/layers/stableStand.js';
test('un arbre conserve son identité et sa place dans le budget lors des compléments', () => {
  const a={x:1,z:2,height:12,variant:3,thin:.8};
  const b={x:4,z:5,height:8,variant:0,thin:.9};
  const c={x:6,z:7,height:20,variant:2,thin:.1};
  assert.deepEqual(stableStand([a,b],[{...a,height:25,variant:1},c],2),[a,b]);
  assert.deepEqual(stableStand([a],[c],2),[a,c]);
  assert.deepEqual(stableStand([a,b],[c],2,p=>p.x!==1),[b,c]);
});
test('la sélection initiale ne dépend pas de l’ordre des candidats', () => {
  const a=[{x:1,z:0,thin:.7},{x:2,z:0,thin:.2},{x:3,z:0,thin:.3}];
  assert.deepEqual(stableStand([],a,2),stableStand([],a.toReversed(),2));
});
