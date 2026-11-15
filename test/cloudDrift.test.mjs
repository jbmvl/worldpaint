/*
 * Dérive des nuages : le vent la pousse, le temps écoulé l'avance, l'heure
 * simulée n'y est pour rien.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SceneEnvironment } from '../src/environment/sceneEnvironment.js';

async function environment(weather = null) {
  const THREE = await import('three');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  const env = new SceneEnvironment({ THREE, Sky, scene: new THREE.Scene(), fogRadius: 1000 });
  if (weather) env.setWeather(weather);
  return env;
}

const offset = (env) => [env.uniforms.uCloudOffset.value.x, env.uniforms.uCloudOffset.value.y];
const NOON = { date: new Date('2026-07-01T10:00:00Z'), lat: 48.85, lng: 2.35 };

test('le shader du ciel lit le décalage des nuages, pas le temps', async () => {
  const env = await environment();
  const shader = env.sky.material.fragmentShader;
  assert.ok(shader.includes('cloudUV += uCloudOffset;'));
  assert.ok(!shader.includes('time * cloudSpeed'));
});

test('une heure figée ne fige pas les nuages', async () => {
  const env = await environment();
  env.update(NOON);
  env.advance(10);
  const first = offset(env);
  env.update(NOON);
  env.advance(10);
  const second = offset(env);
  assert.ok(Math.hypot(second[0] - first[0], second[1] - first[1]) > 0);
});

test('les nuages vont où va le vent, plus vite quand il forcit', async () => {
  const east = await environment({ wind: 0.25, windDirection: 0 });
  const west = await environment({ wind: 0.25, windDirection: Math.PI });
  const gale = await environment({ wind: 1, windDirection: 0 });
  for (const env of [east, west, gale]) env.advance(60);
  const [ex, ez] = offset(east), [wx, wz] = offset(west), [gx, gz] = offset(gale);
  assert.ok(Math.abs(ex + wx) < 1e-12 && Math.abs(ez + wz) < 1e-12, 'vent opposé, dérive opposée');
  assert.ok(Math.hypot(gx, gz) > 2 * Math.hypot(ex, ez), 'la tempête pousse plus de deux fois plus vite');
});
