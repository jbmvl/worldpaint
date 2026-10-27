import test from 'node:test';
import assert from 'node:assert/strict';

import { buildingLandmark, LANDMARK_MIN_HEIGHT_M } from '../src/layers/buildingLayer.js';

const box = { cx: 10, cz: -4, long: 18, short: 6 };

test('un château, une église ou un rempart sont des repères, même bas', () => {
  for (const personality of ['castle', 'church', 'mosque', 'rampart']) {
    const landmark = buildingLandmark({ personality, name: 'Saint-Pierre', box, base: 2, top: 10 });
    assert.equal(landmark.kind, personality);
    assert.deepEqual([landmark.x, landmark.y, landmark.z, landmark.top, landmark.size], [10, 2, -4, 10, 18]);
    assert.equal(landmark.name, 'Saint-Pierre');
  }
});

test('un bâtiment ordinaire n’est un repère que très haut', () => {
  assert.equal(buildingLandmark({ personality: null, box, base: 0, top: 12 }), null);
  assert.equal(buildingLandmark({ personality: 'retail', box, base: 0, top: 12 }), null);
  assert.equal(buildingLandmark({ personality: null, box, base: 0, top: LANDMARK_MIN_HEIGHT_M }).kind, 'tall');
});

test('sans emprise ni cotes, pas de repère', () => {
  assert.equal(buildingLandmark({ personality: 'castle', box: null, base: 0, top: 10 }), null);
  assert.equal(buildingLandmark({ personality: 'castle', box, base: NaN, top: 10 }), null);
});
