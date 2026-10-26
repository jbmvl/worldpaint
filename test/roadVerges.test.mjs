import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paintRoadVerges,
  paintVergeStrips,
  CROP_LABEL_BASE,
  surfaceId,
  surfaceSignature,
  SURFACE_ID_STEP,
  FARMLAND_ID,
} from '../src/terrain/groundClassMap.js';
import { CROP_ID_STEP } from '../src/layers/furniturePlacement.js';
import { VergeStrips } from '../src/layers/vergeStrips.js';
import { CONTOUR_REACH_TEXELS } from '../src/terrain/surfaceContours.js';

function fill(pixels, kind, crop = 0) {
  const id = surfaceId(kind);
  const data = new Uint8ClampedArray(pixels * pixels * 4);
  for (let p = 0; p < pixels * pixels; p++) data.set([id * SURFACE_ID_STEP, crop, surfaceSignature(id), 255], p * 4);
  return data;
}

const idAt = (data, pixels, tx, ty) => data[(ty * pixels + tx) * 4] / SURFACE_ID_STEP;

test("l'emprise d'une chaussée rend le champ à l'herbe, pas au-delà", () => {
  const pixels = 40;
  const data = fill(pixels, 'farmland', 8);
  // Route est-ouest au milieu, texels d'un mètre.
  // Portée : 2,5 m de demi-largeur + 1,2 m d'emprise.
  const turned = paintRoadVerges(data, pixels, [0, 20, 40, 20, 3.7], { left: 0, top: 0, perMeter: 1 });
  assert.ok(turned > 0);
  // Centre à 3,5 m de l'axe : dans l'emprise (2,5 + 1,2).
  assert.equal(idAt(data, pixels, 10, 23), surfaceId('grass'));
  assert.equal(data[(23 * pixels + 10) * 4 + 1], 0, 'la culture est retirée');
  // Centre à 4,5 m : le champ.
  assert.equal(idAt(data, pixels, 10, 24), FARMLAND_ID);
});

test("l'emprise ne repeint que les cultures", () => {
  const pixels = 20;
  const data = fill(pixels, 'wood');
  paintRoadVerges(data, pixels, [0, 10, 20, 10, 4.2], { left: 0, top: 0, perMeter: 1 });
  assert.equal(idAt(data, pixels, 5, 10), surfaceId('wood'));
});

test("une haie de bas-côté rend le champ à l'herbe jusqu'à son dos, de son seul côté, sans nouveau tracé", () => {
  const pixels = 40;
  const crop = 3;
  const data = fill(pixels, 'farmland', crop * CROP_ID_STEP);
  for (let p = 0; p < pixels * pixels; p++) data.set([255, 0], p * 4 + 2);
  data.set([surfaceId('wood') * SURFACE_ID_STEP, 0], (16 * pixels + 30) * 4);
  const verges = new VergeStrips();
  // Route est-ouest en z = 20 ; haie à 4 m côté nord (décalage positif), 0,4 m de demi-épaisseur.
  verges.add([{ x: 0, z: 20 }, { x: 40, z: 20 }], 4, 0.4);
  const touched = paintVergeStrips(data, pixels, verges.strips, { left: 0, top: 0, perMeter: 1 });
  assert.ok(touched.length > 0);
  const at = (tx, ty) => (ty * pixels + tx) * 4;
  assert.equal(idAt(data, pixels, 10, 16), surfaceId('grass'), 'centre à 3,5 m : sous la bande');
  assert.equal(data[at(10, 16) + 3], CROP_LABEL_BASE + crop + 1, "en face, le champ");
  assert.ok(Math.abs(data[at(10, 16) + 2] - (0.9 / CONTOUR_REACH_TEXELS) * 255) <= 1, 'à 0,9 m du dos de la haie');
  assert.equal(idAt(data, pixels, 10, 15), FARMLAND_ID, 'centre à 4,5 m : derrière la haie');
  assert.ok(Math.abs(data[at(10, 15) + 2] - (0.1 / CONTOUR_REACH_TEXELS) * 255) <= 1, 'qui voit le trait à 0,1 m');
  assert.equal(data[at(10, 15) + 3], surfaceId('grass') + 1);
  assert.equal(idAt(data, pixels, 10, 22), FARMLAND_ID, "l'autre côté de la route garde son champ");
  assert.equal(idAt(data, pixels, 30, 16), surfaceId('wood'), 'seules les cultures changent');
});
