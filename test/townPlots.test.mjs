import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centreInVoid,
  freeRadiusAt,
  plotKindFor,
  NOOK_FREE_M,
  PARK_FREE_M,
  PLACETTE_FREE_M,
  PLOT_PROBE_RADII_M,
} from '../src/layers/furniture/townPlots.js';
import { POINT_ITEMS } from '../src/layers/furniture/catalog.js';
import { FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';

test('la place libre est le dernier cercle sondé sans obstacle', () => {
  // Un mur à 12 m à l'est : les cercles de 6 et 10 m passent, celui de 16 m non.
  const wall = (x) => x >= 12;
  assert.equal(freeRadiusAt(0, 0, wall), 10);
  assert.equal(freeRadiusAt(0, 0, () => false), PLOT_PROBE_RADII_M.at(-1));
  assert.equal(freeRadiusAt(0, 0, () => true), 0);
});

test('un point semé contre un mur est recentré dans son vide, et y trouve sa vraie place libre', () => {
  // Une cour de 60 m sur 60, murs à ±30 m : semé à 4 m du mur est, le point
  // ne tient pas même un recoin ; recentré, il tient un parc.
  const court = (x, z) => Math.abs(x) >= 30 || Math.abs(z) >= 30;
  assert.equal(freeRadiusAt(26, 0, court), 0);
  const centre = centreInVoid(26, 0, court);
  assert.ok(Math.abs(centre.x) < 8 && Math.abs(centre.z) < 8, `centre ${centre.x}, ${centre.z}`);
  assert.ok(centre.free >= PARK_FREE_M, `libre ${centre.free}`);
  assert.equal(centreInVoid(40, 0, court), null);
});

test('une ruelle trop étroite pour ce qu\'on y cherche n\'est pas recentrée', () => {
  // Ruelle de 16 m de large : elle tient un recoin, jamais un parc.
  const lane = (x) => Math.abs(x) >= 8;
  const seed = { x: 5, z: 0 };
  assert.deepEqual(centreInVoid(seed.x, seed.z, lane, PARK_FREE_M), { ...seed, free: 0 });
  assert.ok(centreInVoid(seed.x, seed.z, lane, NOOK_FREE_M).free >= NOOK_FREE_M);
});

test('un grand vide pavé ou une place piétonne fait une piazza, pas un parc', () => {
  assert.equal(plotKindFor(PARK_FREE_M, { paved: true }), 'piazza');
  assert.equal(plotKindFor(PARK_FREE_M, { square: true }), 'piazza');
  assert.equal(plotKindFor(PLACETTE_FREE_M, { paved: true }), 'placette');
  assert.equal(plotKindFor(PLACETTE_FREE_M - 1, { square: true }), 'nook');
});

test('un grand vide fait un parc, un vide moyen une placette, un petit un recoin, moins rien', () => {
  assert.equal(plotKindFor(PARK_FREE_M), 'park');
  assert.equal(plotKindFor(PARK_FREE_M - 1), 'placette');
  assert.equal(plotKindFor(PLACETTE_FREE_M), 'placette');
  assert.equal(plotKindFor(PLACETTE_FREE_M - 1), 'nook');
  assert.equal(plotKindFor(NOOK_FREE_M), 'nook');
  assert.equal(plotKindFor(NOOK_FREE_M - 1), null);
});

test('le bac à fleurs est une forme du catalogue posée', () => {
  assert.ok(POINT_ITEMS.includes('flowerPlanter'));
  assert.equal(typeof FURNITURE_BUILDERS.flowerPlanter, 'function');
});
