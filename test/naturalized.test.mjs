import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS } from '../src/core/regions.js';
import { NATURALIZED_KINDS } from '../src/core/regionInterpretation.js';
import { FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';
import { NATURALIZED_SOWING, ON_DEMAND_ITEMS, POINT_ITEMS } from '../src/layers/furniture/catalog.js';
import { naturalizedSowing } from '../src/layers/furniture/biomeDebris.js';
import { roadsideWildFor } from '../src/layers/furniture/roadsideWild.js';
import { naturalizedScale } from '../src/layers/furniturePlacement.js';

const region = (id) => REGIONS.find((r) => r.id === id);

test('chaque plante naturalisée a sa forme, son semis, et ne pèse que là où elle pousse', () => {
  for (const [word, { items }] of Object.entries(NATURALIZED_KINDS)) {
    for (const item of items) {
      assert.ok(FURNITURE_BUILDERS[item], `${word} : forme ${item} absente`);
      assert.ok(NATURALIZED_SOWING[item]?.perHa > 0, `${word} : semis de ${item} absent`);
      assert.ok(POINT_ITEMS.includes(item), `${word} : ${item} jamais instancié`);
      assert.ok(ON_DEMAND_ITEMS.has(item), `${word} : ${item} construit partout`);
    }
  }
});

test('le figuier de Barbarie se sème sur la pâture des Iblei, pas sur celle des Causses', () => {
  const iblei = naturalizedSowing(region('iblei'));
  assert.deepEqual([...iblei.surfaces], ['grass', 'maquis']);
  assert.deepEqual(iblei.items.map((w) => w.item), ['pricklyPear', 'treeSpurge']);
  assert.ok(iblei.items[0].upTo > 0 && iblei.items[0].upTo < 0.05);
  assert.equal(naturalizedSowing(region('causses')), null);
  assert.equal(naturalizedSowing(null), null);
});

test("l'euphorbe et l'agave, fleuri une fois sur huit, se sèment sur les coteaux en terrasses de l'Etna", () => {
  const etna = naturalizedSowing(region('etna'));
  assert.deepEqual([...etna.surfaces], ['grass', 'scrub']);
  assert.deepEqual(etna.items.map((w) => w.item), ['pricklyPear', 'treeSpurge', 'agave', 'agaveFlowering']);
  const bounds = etna.items.map((w) => w.upTo);
  assert.deepEqual(bounds, [...bounds].sort((a, b) => a - b));
  assert.ok(bounds.at(-1) < 0.15);
  assert.equal(naturalizedSowing(region('douro_vinhateiro')), null);
});

test('au bord des routes, seuls les pays qui les nomment sèment leurs plantes naturalisées', () => {
  const interna = roadsideWildFor(region('sicilia_interna'));
  assert.deepEqual(interna.map((w) => w.item), ['pricklyPear']);
  // Cinq pieds par kilomètre sur quelque soixante-dix points candidats.
  assert.ok(interna[0].upTo > 0.05 && interna[0].upTo < 0.1);
  assert.equal(roadsideWildFor(region('nebrodi')), null);
  assert.equal(roadsideWildFor(region('causses')), null);
  assert.equal(roadsideWildFor(null), null);
});

test("la taille d'une plante naturalisée couvre sa fourchette et penche vers les jeunes pieds", () => {
  const range = NATURALIZED_SOWING.pricklyPear.scale;
  assert.equal(naturalizedScale(range, 0), range[0]);
  assert.ok(Math.abs(naturalizedScale(range, 0.9999) - range[1]) < 1e-3);
  assert.ok(naturalizedScale(range, 0.5) < (range[0] + range[1]) / 2);
});
