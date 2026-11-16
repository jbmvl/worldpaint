/*
 * Front de mer : à moins de `SEAFRONT_PALM_M` de la mer, un arbre de ville est
 * un palmier dans un pays qui en plante ; jamais un arbre des champs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearSea } from '../src/layers/coast.js';
import { seafrontPalms, SEAFRONT_PALM_M, townSpeciesWords } from '../src/layers/plantedTrees.js';

// La mer au nord de z = 0, sur un kilomètre de côte.
const SEA = [[{ x: -1000, z: -2000 }, { x: 1000, z: -2000 }, { x: 1000, z: 0 }, { x: -1000, z: 0 }]];

test('la proximité de la mer se lit au rivage, pas au centre de la nappe', () => {
  const near = nearSea(SEA, SEAFRONT_PALM_M);
  assert.equal(near(0, 100), true);
  assert.equal(near(0, SEAFRONT_PALM_M - 1), true);
  assert.equal(near(0, SEAFRONT_PALM_M + 1), false);
  assert.equal(near(0, 3000), false);
  assert.equal(nearSea([], 250)(0, 0), false, 'sans mer, jamais');
});

test('le front de mer plante des palmiers en ville, et seulement là', () => {
  const region = { trees: ['olive', 'holm_oak'], planted: ['palm', 'stone_pine'] };
  assert.deepEqual(townSpeciesWords(region), ['palm', 'stone_pine']);
  assert.deepEqual(townSpeciesWords({ trees: ['oak', 'beech'] }), ['oak', 'beech']);
  const list = [
    { x: 0, z: 80, species: 'stone_pine', town: true },
    { x: 0, z: 900, species: 'stone_pine', town: true },
    { x: 50, z: 60, species: 'olive' },
  ];
  let built = 0;
  const changed = seafrontPalms(list, region, () => (built++, nearSea(SEA, SEAFRONT_PALM_M)));
  assert.equal(changed, 1);
  assert.deepEqual(list.map((p) => p.species), ['palm', 'stone_pine', 'olive']);
  assert.equal(built, 1, 'le test de proximité est bâti une fois');
  // Un pays qui ne plante pas de palmier n'en voit pas, même au bord de l'eau.
  const north = [{ x: 0, z: 80, species: 'oak', town: true }];
  assert.equal(seafrontPalms(north, { trees: ['oak', 'beech'] }, () => nearSea(SEA, SEAFRONT_PALM_M)), 0);
  assert.equal(north[0].species, 'oak');
});
