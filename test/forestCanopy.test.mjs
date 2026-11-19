/*
 * Le couvert vu de loin imite le bois du pays, et l'éclaircie d'une tuile ne
 * fait pas de marche à sa frontière.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultTheme } from '../src/themes/default.js';
import { forestComposition, forestStand } from '../src/layers/vegetationLayer.js';
import { keptShare, thinningShareAt } from '../src/layers/standThinning.js';

test('un bois de bosquets secs est plus bas et plus clair qu’une futaie', () => {
  const dry = forestStand(forestComposition(['olive', 'carob'], defaultTheme));
  const tall = forestStand(forestComposition(['beech', 'oak'], defaultTheme));
  assert.ok(dry.heightM < 8 && dry.density < 0.6, JSON.stringify(dry));
  assert.ok(tall.heightM > 12, JSON.stringify(tall));
});

test('la part gardée ne touche une tuile qu’au-delà de son budget', () => {
  assert.equal(keptShare(500, 7000), 1);
  assert.equal(keptShare(14000, 7000), 0.5);
});

test('la part gardée est continue d’une tuile à sa voisine', () => {
  const frame = { origin: { x: 100, y: 200 }, scale: 1000 };
  // Tuile dense à l'ouest, clairsemée à l'est.
  const shareOf = (tx) => (tx <= 100 ? 0.6 : 1);
  const left = thinningShareAt(frame, 999.9, 500, shareOf);
  const right = thinningShareAt(frame, 1000.1, 500, shareOf);
  assert.ok(Math.abs(left - right) < 1e-3, `${left} ≠ ${right}`);
  // Jamais au-dessus de la part de la tuile : pas un arbre de plus.
  assert.ok(Math.abs(left - 0.6) < 1e-3);
  assert.ok(Math.abs(thinningShareAt(frame, 500, 500, shareOf) - 0.6) < 1e-9);
  // La tuile clairsemée remonte en pente, et garde tout loin du bord.
  const mid = thinningShareAt(frame, 1100, 500, shareOf);
  assert.ok(mid > 0.6 && mid < 1, String(mid));
  assert.equal(thinningShareAt(frame, 1600, 500, shareOf), 1);
});
