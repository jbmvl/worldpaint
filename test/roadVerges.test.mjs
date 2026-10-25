import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paintRoadVerges,
  surfaceId,
  surfaceSignature,
  SURFACE_ID_STEP,
  FARMLAND_ID,
} from '../src/terrain/groundClassMap.js';

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
