import test from 'node:test';
import assert from 'node:assert/strict';
import { CROP_KINDS, CROP_ID_STEP, CROP_STAGE_OF, cropOf, cropStageFor, cropId, cropFromId, scatterFurnitureFor } from '../src/layers/furniturePlacement.js';
import { hedgeTints } from '../src/layers/hedgeGeometry.js';
import { autumnTheme, defaultTheme, resolveTheme } from '../src/index.js';

const frame = { zoom: 14, origin: { x: 8185, y: 5770 }, scale: 2445 };

test('un stade de saison reste la culture de sa parcelle', () => {
  for (const [stage, crop] of Object.entries(CROP_STAGE_OF)) {
    assert.ok(CROP_KINDS.includes(stage), `${stage} a son identifiant`);
    assert.equal(cropOf(cropFromId(cropId(stage) * CROP_ID_STEP)), crop);
  }
  assert.equal(cropOf('maize'), 'maize');
  assert.equal(cropOf(null), null);
});

test("sans stades, chaque champ montre sa culture", () => {
  for (const variant of [0, 0.4, 0.99]) {
    assert.equal(cropStageFor('wheat', variant, defaultTheme.cropStages), 'wheat');
    assert.equal(cropStageFor('wheat', variant, null), 'wheat');
  }
  assert.equal(cropStageFor(null, 0.5, autumnTheme.cropStages), null);
});

test("à l'automne, le blé moissonné porte un couvert ou sa levée, le labour reste labour", () => {
  const stages = autumnTheme.cropStages;
  assert.equal(cropStageFor('wheat', 0.1, stages), 'coverCrop');
  assert.equal(cropStageFor('wheat', 0.9, stages), 'wheatSprouts');
  assert.equal(cropStageFor('plough', 0.1, stages), 'plough');
  assert.equal(cropStageFor('maize', 0.9, stages), 'maize');
  const theme = resolveTheme(autumnTheme);
  assert.deepEqual(theme.terrain.cropAlbedo.coverCrop, theme.surfaces.grass.albedo, 'le couvert a le vert des prés');
  for (const [, mix] of Object.entries(stages)) {
    for (const [stage] of mix) {
      assert.ok(CROP_KINDS.includes(stage), `${stage} a son identifiant`);
      assert.ok(theme.terrain.cropAlbedo[stage], `${stage} a un albédo`);
    }
  }
  assert.equal(theme.crops.coverCrop, undefined, 'le couvert est un sol, sans touffes');
});

test("à l'automne, des citrouilles éparses dans les petites parcelles au ras du sol", () => {
  const pumpkins = autumnTheme.furniture.pumpkins;
  const field = { class: 'farmland' };
  assert.deepEqual(scatterFurnitureFor(field, { crop: 'coverCrop', look: 'coverCrop', pumpkins }), {
    item: 'pumpkin',
    perHectare: pumpkins.perHectare,
    maxHa: pumpkins.maxHa,
    perParcel: pumpkins.perParcel,
    roadsideM: pumpkins.roadsideM,
  });
  assert.notEqual(scatterFurnitureFor(field, { crop: 'maize', look: 'maize', pumpkins })?.item, 'pumpkin');
  assert.equal(scatterFurnitureFor(field, { crop: 'plough', look: 'plough' })?.item, 'hay', 'sans saison, le labour garde ses bottes');
  assert.equal(defaultTheme.furniture.pumpkins, null);
});

test("une haie sans palette garde sa couleur, une palette la teinte par plages ancrées au sol", () => {
  const path = Array.from({ length: 80 }, (_, i) => ({ x: i * 0.75, z: 3 }));
  assert.equal(hedgeTints(frame, path, null, 601), null);
  assert.equal(hedgeTints(frame, path, defaultTheme.furniture.hedgeTints, 601), null);

  const palette = autumnTheme.furniture.hedgeTints;
  const tints = hedgeTints(frame, path, palette, 601);
  assert.equal(tints.length, path.length * 3);
  const seen = new Set();
  for (let r = 0; r < path.length; r++) {
    const tint = [...tints.subarray(r * 3, r * 3 + 3)].map((v) => Math.fround(v));
    assert.ok(palette.some(([t]) => t.every((v, i) => Math.fround(v) === tint[i])), 'teinte de la palette');
    seen.add(tint.join());
  }
  assert.ok(seen.size > 1, 'soixante mètres de haie ne virent pas d’un bloc');

  // Une portion redécoupée garde ses teintes : elles tiennent au sol, pas au tracé.
  const part = hedgeTints(frame, path.slice(20, 40), palette, 601);
  assert.deepEqual([...part], [...tints.subarray(60, 120)]);
});
