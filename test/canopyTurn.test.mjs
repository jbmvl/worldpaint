/*
 * Le couvert d'un bois vu de loin ne roussit en automne qu'à proportion des
 * essences du pays qui changent de couleur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultTheme } from '../src/themes/default.js';
import { autumnTheme } from '../src/themes/autumn.js';
import { resolveTheme } from '../src/themes/theme.js';
import { forestComposition, turnedShare } from '../src/layers/vegetationLayer.js';

const autumn = resolveTheme(autumnTheme);
const share = (trees, theme) => turnedShare(forestComposition(trees, theme), theme.trees);

test("en été, aucun bois ne change de couleur", () => {
  assert.equal(share(['oak', 'beech', 'ash'], defaultTheme), 0);
});

test("en automne, un bois de chênes verts et de pins garde son couvert d'été", () => {
  assert.equal(share(['holm_oak', 'aleppo_pine', 'stone_pine'], autumn), 0);
});

test("en automne, une chênaie-hêtraie roussit tout entière", () => {
  assert.ok(Math.abs(share(['oak', 'beech', 'ash'], autumn) - 1) < 1e-9);
});

test("un bois mêlé roussit à proportion de ses essences qui virent", () => {
  const mixed = share(['oak', 'scots_pine', 'beech'], autumn);
  assert.ok(mixed > 0 && mixed < 1, String(mixed));
});

test("le couvert d'automne garde le vert d'été et déclare celui d'un bois qui roussit", () => {
  assert.deepEqual(autumn.surfaces.wood.canopy.albedo, defaultTheme.surfaces.wood.canopy.albedo);
  assert.equal(autumn.surfaces.wood.canopy.turned.length, 3);
});
