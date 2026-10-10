import test from 'node:test';
import assert from 'node:assert/strict';

import { RoadIndex } from '../src/layers/roadGraph.js';
import {
  WORK_BRIDGE,
  DECK_SHADOW_MARGIN_M,
  DECK_UNDERSIDE_M,
  deckCeilingAt,
  isDeckRow,
} from '../src/layers/roadWorks.js';

/** Une route est-ouest : au sol jusqu'à x = 0, puis un pont à 12 m. */
function road() {
  const path = [];
  const platform = [];
  const works = [];
  for (let x = -40; x <= 40; x += 10) {
    path.push({ x, z: 0 });
    platform.push(x >= 0 ? 12 : 0);
    works.push(x >= 0 ? WORK_BRIDGE : 0);
  }
  return { halfWidth: 3, path, platform, works: Uint8Array.from(works) };
}

test('sous un tablier, le plafond est le dessous du pont ; ailleurs, le ciel', () => {
  const index = new RoadIndex([road()], { margin: DECK_SHADOW_MARGIN_M, keep: isDeckRow });

  assert.equal(deckCeilingAt(index, 20, 0), 12 - DECK_UNDERSIDE_M, 'sous le pont');
  assert.equal(deckCeilingAt(index, 20, 5, 3), 12 - DECK_UNDERSIDE_M, 'une houppe qui déborde sous la rive');
  assert.equal(deckCeilingAt(index, 20, 5), Infinity, 'un tronc à côté du pont');
  assert.equal(deckCeilingAt(index, -20, 0), Infinity, 'la chaussée au sol ne plafonne rien');
  assert.equal(deckCeilingAt(null, 20, 0), Infinity, 'sans réseau');
});

test('une chaussée suspendue sans étiquette de pont plafonne aussi', () => {
  const segment = road();
  segment.works = new Uint8Array(segment.path.length);
  segment.supports = Uint8Array.from(segment.platform, (h) => (h > 0 ? 1 : 0));
  const index = new RoadIndex([segment], { margin: DECK_SHADOW_MARGIN_M, keep: isDeckRow });
  assert.equal(deckCeilingAt(index, 20, 0), 12 - DECK_UNDERSIDE_M);
});
