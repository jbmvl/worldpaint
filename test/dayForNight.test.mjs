/*
 * Nuit américaine : un réglage qui éclaire la nuit sans en faire un jour.
 *
 * Trois promesses à tenir. À 0, rien ne bouge (une application qui n'en parle
 * pas voit la nuit d'avant). De jour, rien ne bouge non plus. La nuit, la
 * lumière vient de la lune, avec ses ombres, et le ciel s'éclaircit en gardant
 * la teinte de la palette.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lightingFor,
  liftNightColor,
  DAY_FOR_NIGHT_ZENITH_LUMINANCE,
} from '../src/environment/skyModel.js';
import { SceneEnvironment } from '../src/environment/sceneEnvironment.js';

const luminance = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

test('à 0, l’éclairage est celui d’avant, à toute heure', () => {
  for (const sunY of [-0.6, -0.1, -0.03, 0, 0.1, 0.5, 0.9]) {
    assert.deepEqual(lightingFor(sunY, 0), lightingFor(sunY));
  }
});

test('de jour, la nuit américaine ne change rien', () => {
  for (const sunY of [0, 0.2, 0.5, 0.9]) {
    assert.deepEqual(lightingFor(sunY, 1), lightingFor(sunY, 0));
  }
});

test('la nuit, elle relève soleil et ambiance, sans dépasser midi', () => {
  const night = lightingFor(-0.5, 0);
  const american = lightingFor(-0.5, 1);
  const noon = lightingFor(0.9, 0);
  assert.ok(american.sun > night.sun * 2, 'la lune éclaire franchement');
  assert.ok(american.ambient > night.ambient);
  assert.ok(american.sun < noon.sun && american.ambient < noon.ambient, 'reste une nuit');
  assert.equal(american.nightBlend, 1, 'la nuit reste la nuit pour les lumières artificielles');
  const half = lightingFor(-0.5, 0.5);
  assert.ok(half.sun > night.sun && half.sun < american.sun, 'progressif');
});

test('le ciel de nuit s’éclaircit en gardant sa teinte, sans jamais s’assombrir', () => {
  const navy = [0.0021, 0.0037, 0.008];
  const lifted = liftNightColor(navy, DAY_FOR_NIGHT_ZENITH_LUMINANCE, 1);
  assert.ok(Math.abs(luminance(lifted) - DAY_FOR_NIGHT_ZENITH_LUMINANCE) < 1e-9);
  assert.ok(Math.abs(lifted[2] / lifted[0] - navy[2] / navy[0]) < 1e-9, 'même teinte');

  assert.deepEqual(liftNightColor(navy, DAY_FOR_NIGHT_ZENITH_LUMINANCE, 0), navy);
  const bright = [0.3, 0.5, 0.8];
  assert.deepEqual(liftNightColor(bright, DAY_FOR_NIGHT_ZENITH_LUMINANCE, 1), bright, 'jamais assombri');
  const black = liftNightColor([0, 0, 0], DAY_FOR_NIGHT_ZENITH_LUMINANCE, 1);
  assert.ok(luminance(black) > 0, 'un noir pur se relève aussi');
});

async function environment() {
  const THREE = await import('three');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  return new SceneEnvironment({ THREE, Sky, scene: new THREE.Scene(), fogRadius: 1000 });
}

// Minuit d'été à Paris : soleil bien sous l'horizon.
const MIDNIGHT = { date: new Date('2026-07-01T23:00:00Z'), lat: 48.85, lng: 2.35 };
const NOON = { date: new Date('2026-07-01T12:00:00Z'), lat: 48.85, lng: 2.35 };

test('la nuit, la lumière directe passe à la lune et porte des ombres', async () => {
  const env = await environment();
  env.update({ ...MIDNIGHT, dayForNight: 0 });
  const dark = { intensity: env.sun.intensity, shadows: env.sun.castShadow, fog: env.fog.color.clone() };
  assert.equal(dark.shadows, false);

  env.update({ ...MIDNIGHT, dayForNight: 1 });
  assert.ok(env.sun.intensity > dark.intensity * 2);
  assert.ok(env.sun.position.y > env.sun.target.position.y, 'éclairé d’en haut, pas d’en dessous');
  assert.equal(env.sun.castShadow, true);
  assert.ok(env.uniforms.uStarGain.value < 1, 'moins d’étoiles sous un ciel éclairci');
  assert.ok(luminance(env.fog.color.toArray()) > luminance(dark.fog.toArray()), 'l’horizon s’éclaircit');
  assert.ok(env.nightMix > 0.99, 'la nuit reste la nuit');

  env.update(MIDNIGHT);
  assert.equal(env.dayForNight, 1, 'omis, le réglage est reconduit');
  env.dispose();
});

test('de jour, l’environnement est identique avec ou sans nuit américaine', async () => {
  const env = await environment();
  env.update({ ...NOON, dayForNight: 0 });
  const before = { intensity: env.sun.intensity, position: env.sun.position.clone(), fog: env.fog.color.clone() };
  env.update({ ...NOON, dayForNight: 1 });
  assert.equal(env.sun.intensity, before.intensity);
  assert.ok(env.sun.position.equals(before.position));
  assert.ok(env.fog.color.equals(before.fog));
  env.dispose();
});
