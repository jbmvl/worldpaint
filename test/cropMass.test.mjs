import test from 'node:test';
import assert from 'node:assert/strict';
import { cropMassFits } from '../src/layers/cropLayer.js';

// Un champ de blé pour x < 10, rien au-delà.
const groundClass = { cropAt: (x) => (x < 10 ? 'wheat' : null) };

test('une masse de culture ne déborde pas du champ', () => {
  assert.equal(cropMassFits(groundClass, null, 'wheat', 0, 0, 3), true);
  assert.equal(cropMassFits(groundClass, null, 'wheat', 8, 0, 3), false);
  assert.equal(cropMassFits(groundClass, null, 'maize', 0, 0, 3), false);
});

test('une masse de culture reste hors de l’emprise routière, largeur comprise', () => {
  // Route le long de x = 5 : couvre ce qui est à moins de `margin` de la ligne.
  const index = { covers: (x, z, margin) => Math.abs(x - 5) <= margin };
  assert.equal(cropMassFits(groundClass, index, 'wheat', 0, 0, 1), true);
  assert.equal(cropMassFits(groundClass, index, 'wheat', 0, 0, 4), false);
});
