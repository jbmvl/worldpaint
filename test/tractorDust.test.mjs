/* La poussière d'un tracteur : levée derrière lui, là où il est passé. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dustPuffAt, fieldVehicleAt, DUST_PUFFS, DUST_LIFE_S, DUST_SIZE_M } from '../src/layers/tractorLayer.js';

const tractor = {
  a: { x: 0, y: 100, z: 0 },
  b: { x: 200, y: 100, z: 0 },
  headingForward: Math.atan2(200, 0),
  speed: 1.5,
  phase: 0,
};

test('une bouffée naît derrière le tracteur et grandit en vieillissant', () => {
  const time = 40;
  const puffs = Array.from({ length: DUST_PUFFS }, (_, p) => dustPuffAt(tractor, time, p));
  const youngest = puffs.reduce((a, b) => (b.age < a.age ? b : a));
  const oldest = puffs.reduce((a, b) => (b.age > a.age ? b : a));
  assert.ok(youngest.size < oldest.size, 'la bouffée s’étale avec l’âge');
  for (const puff of puffs) {
    assert.ok(puff.age >= 0 && puff.age < DUST_LIFE_S);
    assert.ok(puff.size >= DUST_SIZE_M[0] - 1e-9 && puff.size <= DUST_SIZE_M[1] + 1e-9);
  }
  const at = fieldVehicleAt(tractor, time);
  assert.ok(youngest.x < at.x, 'la plus jeune est derrière le tracteur qui avance');
});

test('sans vent, une bouffée reste sur le passage où elle a été levée', () => {
  for (let t = 0; t < 30; t += 3) {
    const puff = dustPuffAt(tractor, t, 0, 0);
    const born = fieldVehicleAt(tractor, t - puff.age);
    // La dérive au vent (cap 0 : +X) et l'écart latéral sont les seuls écarts au point d'émission.
    assert.ok(Math.abs(puff.z - born.z) < 0.6 * puff.age + 1e-6);
  }
});
