/*
 * Les voies d'un faisceau se rejoignent sur un plan commun : le profil en long
 * les lie en travers, dans la limite du terrassement consenti à chacune.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { pathFrames } from '../src/layers/ribbonGeometry.js';
import { facingRows } from '../src/layers/roadBundles.js';
import { gradeRoadNetwork } from '../src/layers/roadProfile.js';

function lane(x, fromZ, toZ, height, halfWidth = 1.8) {
  const path = [];
  for (let z = fromZ; z <= toZ; z += 5) path.push({ x, z, distance: z - fromZ });
  return { path, frames: pathFrames(path), halfWidth, platform: Float32Array.from(path, () => height) };
}

function grade(lanes, band) {
  gradeRoadNetwork(lanes, lanes.map(() => band), { facing: facingRows(lanes, new RoadIndex(lanes)) });
}

test('deux sens et leur piste se rejoignent sur un plan commun', () => {
  const lanes = [lane(0, 0, 200, 12), lane(4, 0, 200, 12.5, 1.1), lane(9, 0, 200, 13)];
  grade(lanes, { maxCut: 1, maxFill: 1 });
  const middle = lanes.map((segment) => segment.platform[20]);
  assert.ok(Math.max(...middle) - Math.min(...middle) < 0.02, `écart en travers : ${middle}`);
  for (const height of middle) assert.ok(height > 12 && height < 13);
});

test('une voie éloignée garde sa cote', () => {
  const lanes = [lane(0, 0, 200, 12), lane(30, 0, 200, 13)];
  assert.ok(facingRows(lanes, new RoadIndex(lanes)).every((own) => own === null));
  grade(lanes, { maxCut: 1, maxFill: 1 });
  assert.equal(lanes[0].platform[10], 12);
  assert.equal(lanes[1].platform[10], 13);
});

test('deux rues en terrasse restent chacune à sa cote', () => {
  const lanes = [lane(0, 0, 200, 12), lane(5, 0, 200, 20)];
  grade(lanes, { maxCut: 0.5, maxFill: 0.4 });
  for (const height of lanes[0].platform) assert.ok(height <= 12.4 + 1e-6);
  for (const height of lanes[1].platform) assert.ok(height >= 19.5 - 1e-6);
});

test('la voie qui dépasse sa voisine retrouve sa cote sans marche', () => {
  const lanes = [lane(0, 0, 100, 12), lane(5, 0, 200, 13)];
  grade(lanes, { maxCut: 1, maxFill: 1 });
  const { platform } = lanes[1];
  assert.ok(platform[10] < 12.6);
  for (let r = 21; r < platform.length; r++) assert.ok(platform[r] >= platform[r - 1] - 1e-6);
  assert.ok(Math.abs(platform[platform.length - 1] - 13) < 1e-6);
});

test('le résultat ne dépend pas de l’ordre des tronçons', () => {
  const build = () => [lane(0, 0, 200, 12.4), lane(4, 0, 200, 12, 1.1), lane(9, 20, 150, 13)];
  const forward = build();
  const backward = build().reverse();
  grade(forward, { maxCut: 1, maxFill: 1 });
  grade(backward, { maxCut: 1, maxFill: 1 });
  backward.reverse();
  forward.forEach((segment, i) => {
    segment.platform.forEach((height, r) => assert.ok(Math.abs(height - backward[i].platform[r]) < 1e-5));
  });
});
