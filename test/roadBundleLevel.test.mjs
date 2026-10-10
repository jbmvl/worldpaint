/*
 * Les voies d'un faisceau partagent un seul plan : la cote la plus basse du
 * profil en travers, rendue en rampe là où le longement cesse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { pathFrames } from '../src/layers/ribbonGeometry.js';
import { levelBundlePlatforms, LEVEL_RAMP_ROWS } from '../src/layers/roadBundles.js';

function lane(x, fromZ, toZ, height, halfWidth = 1.8) {
  const path = [];
  for (let z = fromZ; z <= toZ; z += 5) path.push({ x, z, distance: z - fromZ });
  return { path, frames: pathFrames(path), halfWidth, platform: Float32Array.from(path, () => height) };
}

test('deux sens et leur piste prennent la cote la plus basse', () => {
  const lanes = [lane(0, 0, 200, 12), lane(4, 0, 200, 12.5, 1.1), lane(9, 0, 200, 13)];
  assert.equal(levelBundlePlatforms(lanes, new RoadIndex(lanes)), 3);
  for (const segment of lanes) for (const height of segment.platform) assert.ok(Math.abs(height - 12) < 1e-6);
});

test('une voie éloignée garde sa cote', () => {
  const lanes = [lane(0, 0, 200, 12), lane(30, 0, 200, 13)];
  assert.equal(levelBundlePlatforms(lanes, new RoadIndex(lanes)), 0);
  assert.equal(lanes[1].platform[10], 13);
});

test('la voie qui dépasse sa voisine retrouve sa cote en rampe', () => {
  const lanes = [lane(0, 0, 100, 12), lane(5, 0, 200, 13)];
  levelBundlePlatforms(lanes, new RoadIndex(lanes));
  const { platform } = lanes[1];
  assert.ok(Math.abs(platform[10] - 12) < 1e-6);
  for (let r = 21; r < platform.length; r++) assert.ok(platform[r] >= platform[r - 1] - 1e-6);
  assert.ok(platform[21] < 13);
  assert.equal(platform[20 + LEVEL_RAMP_ROWS + 1], 13);
});

test('le résultat ne dépend pas de l’ordre des tronçons', () => {
  const build = () => [lane(0, 0, 200, 12.4), lane(4, 0, 200, 12, 1.1), lane(9, 20, 150, 13)];
  const forward = build();
  const backward = build().reverse();
  levelBundlePlatforms(forward, new RoadIndex(forward));
  levelBundlePlatforms(backward, new RoadIndex(backward));
  backward.reverse();
  forward.forEach((segment, i) => assert.deepEqual([...segment.platform], [...backward[i].platform]));
});
