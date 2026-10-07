/* Passages nocturnes : continuité sphérique, cadences distinctes et horloge réelle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleNightTraffic } from '../src/environment/nightTraffic.js';
import { SceneEnvironment } from '../src/environment/sceneEnvironment.js';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function meteorTime() {
  for (let t = 0; t < 130; t += 0.01) {
    if (sampleNightTraffic(t).meteor?.gain > 0.99) return t;
  }
  throw new Error('Aucun météore');
}

test('directions finies et unitaires, éclats bornés sur une longue session', () => {
  for (let t = 0; t < 3600; t += 0.13) {
    for (const event of Object.values(sampleNightTraffic(t))) {
      if (!event) continue;
      assert.ok(Math.abs(Math.hypot(...event.head) - 1) < 1e-10);
      assert.ok(event.head[1] > 0, 'reste au-dessus de l’horizon');
      assert.ok(event.gain >= 0 && event.gain <= 1);
      if (event.tail) assert.ok(Math.abs(Math.hypot(...event.tail) - 1) < 1e-10);
    }
  }
});

test('un météore descend vite, reste bref et laisse une queue fine derrière lui', () => {
  const t = meteorTime();
  const a = sampleNightTraffic(t).meteor;
  const b = sampleNightTraffic(t + 0.01).meteor;
  assert.ok(b.head[1] < a.head[1]);
  const speed = distance(a.head, b.head) / 0.01;
  assert.ok(speed > 0.25 && speed < 0.5);
  assert.ok(distance(a.tail, a.head) > 0.03 && distance(a.tail, a.head) < 0.12);
  assert.ok(distance(a.tail, b.head) > distance(a.tail, a.head));
  assert.equal(sampleNightTraffic(t + 1).meteor, null);
});

test('satellite et avion restent lents et continus, seul l’avion clignote', () => {
  for (const kind of ['satellite', 'plane']) {
    const a = sampleNightTraffic(40)[kind];
    const b = sampleNightTraffic(40.01)[kind];
    const speed = distance(a.head, b.head) / 0.01;
    assert.ok(speed > 0.01 && speed < 0.03);
    assert.equal(a.gain, 1);
  }
  assert.equal(sampleNightTraffic(40).satellite.flash, undefined);
  assert.ok(sampleNightTraffic(41.01).plane.flash > 0.9);
  assert.equal(sampleNightTraffic(41.5).plane.flash, 0);
  assert.equal(sampleNightTraffic(80).satellite, null);
  assert.equal(sampleNightTraffic(140).plane, null);
});

test('les changements de créneau restent invisibles et les passages reproductibles', () => {
  for (const period of [13, 95, 145]) {
    const kind = period === 13 ? 'meteor' : period === 95 ? 'satellite' : 'plane';
    for (let slot = 1; slot < 20; slot++) {
      for (const offset of [-0.0001, 0, 0.0001]) {
        assert.ok((sampleNightTraffic(period * slot + offset)[kind]?.gain || 0) < 0.0001);
      }
    }
  }
  assert.deepEqual(sampleNightTraffic(41), sampleNightTraffic(41));
});

test('l’animation avance à heure figée et ne saute pas avec la date du jeu', () => {
  const env = new SceneEnvironment({ THREE, Sky, scene: new THREE.Scene() });
  const state = { date: new Date('2026-07-01T23:00:00Z'), lat: 48.85, lng: 2.35 };
  try {
    env.update(state);
    env.advance(40);
    const first = env.uniforms.uSatellite.value.clone();
    env.update(state);
    env.advance(0.1);
    assert.notDeepEqual(env.uniforms.uSatellite.value, first);
    const second = env.uniforms.uSatellite.value.clone();
    env.update({ ...state, date: new Date('2026-07-02T23:00:00Z') });
    env.advance(0);
    assert.deepEqual(env.uniforms.uSatellite.value, second);
    env.advance(Number.NaN);
    assert.ok(Number.isFinite(env._trafficTime));
  } finally { env.dispose(); }
});
