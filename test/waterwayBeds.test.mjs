import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paintWaterwayBeds,
  repairSurfaceEdges,
  drawSurfaceContoursSteps,
  surfaceId,
  surfaceSignature,
  SURFACE_ID_STEP,
  CLASS_AREA_M,
  CLASS_PIXELS,
} from '../src/terrain/groundClassMap.js';
import { finishGeneration } from '../src/core/generationSteps.js';

const PER_METER = CLASS_PIXELS / CLASS_AREA_M;
const PIXELS = 60;
const AT = { left: 0, top: 0, perMeter: PER_METER };
const SIDE_M = PIXELS / PER_METER;

/**
 * Le trait du canevas, lissé comme il l'est : chaque texel mêle l'eau et le
 * bois au prorata de sa couverture, rouge et bleu compris.
 */
function strokedBed(widthM, angleDeg) {
  const water = surfaceId('water');
  const wood = surfaceId('wood');
  const a = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(a);
  const nz = Math.cos(a);
  const c = SIDE_M / 2;
  const data = new Uint8ClampedArray(PIXELS * PIXELS * 4);
  const ss = 8;
  for (let ty = 0; ty < PIXELS; ty++) {
    for (let tx = 0; tx < PIXELS; tx++) {
      let hit = 0;
      for (let i = 0; i < ss; i++) {
        for (let j = 0; j < ss; j++) {
          const x = (tx + (i + 0.5) / ss) / PER_METER - c;
          const z = (ty + (j + 0.5) / ss) / PER_METER - c;
          if (Math.abs(x * nx + z * nz) <= widthM / 2) hit++;
        }
      }
      const cover = hit / (ss * ss);
      const mix = (w, b) => Math.round(cover * w + (1 - cover) * b);
      data.set([
        mix(water * SURFACE_ID_STEP, wood * SURFACE_ID_STEP),
        0,
        mix(surfaceSignature(water), surfaceSignature(wood)),
        255,
      ], (ty * PIXELS + tx) * 4);
    }
  }
  const axis = [c - Math.cos(a) * c, c - Math.sin(a) * c, c + Math.cos(a) * c, c + Math.sin(a) * c];
  return { data, axis };
}

/**
 * Le lit relie-t-il, par des texels d'eau voisins (diagonales comprises), le
 * point de l'axe à 20 % de sa longueur à celui à 80 % ?
 */
function bedConnected(data, axis) {
  const water = surfaceId('water') * SURFACE_ID_STEP;
  const [ax, az, bx, bz] = axis;
  const texelAt = (t) => [Math.floor((ax + (bx - ax) * t) * PER_METER), Math.floor((az + (bz - az) * t) * PER_METER)];
  const isWater = (x, y) => x >= 0 && y >= 0 && x < PIXELS && y < PIXELS && data[(y * PIXELS + x) * 4] === water;
  const near = ([x, y]) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWater(x + dx, y + dy)) return [x + dx, y + dy];
    return null;
  };
  const from = near(texelAt(0.2));
  const to = near(texelAt(0.8));
  if (!from || !to) return false;
  const seen = new Set([from.join()]);
  const queue = [from];
  while (queue.length) {
    const [x, y] = queue.pop();
    if (x === to[0] && y === to[1]) return true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || !isWater(x + dx, y + dy)) continue;
        seen.add(k);
        queue.push([x + dx, y + dy]);
      }
    }
  }
  return false;
}

test('un ruisseau de 3 m tracé au canevas ne survit pas à la réparation', () => {
  // Le constat qui justifie `paintWaterwayBeds` : en diagonale, aucun texel
  // n'est entièrement couvert, et la réparation rend tout le lit au bois.
  const { data, axis } = strokedBed(3, 30);
  repairSurfaceEdges(data, PIXELS);
  assert.equal(bedConnected(data, axis), false);
});

for (const angle of [0, 7, 22.5, 30, 45, 63]) {
  test(`le lit d'un ruisseau de 3 m reste continu à ${angle}°, contours compris`, () => {
    const { data, axis } = strokedBed(3, angle);
    repairSurfaceEdges(data, PIXELS);
    const turned = paintWaterwayBeds(data, PIXELS, [...axis, 1.5], AT);
    assert.ok(turned > 0);
    assert.ok(bedConnected(data, axis));
    finishGeneration(drawSurfaceContoursSteps(data, PIXELS));
    assert.ok(bedConnected(data, axis));
  });
}

test("un lit plus étroit qu'un texel reste continu en diagonale", () => {
  const { data, axis } = strokedBed(0.6, 37);
  repairSurfaceEdges(data, PIXELS);
  paintWaterwayBeds(data, PIXELS, [...axis, 0.3], AT);
  assert.ok(bedConnected(data, axis));
});

test('le lit ne déborde pas au-delà de sa demi-largeur', () => {
  const wood = surfaceId('wood');
  const data = new Uint8ClampedArray(PIXELS * PIXELS * 4);
  for (let p = 0; p < PIXELS * PIXELS; p++) data.set([wood * SURFACE_ID_STEP, 0, surfaceSignature(wood), 255], p * 4);
  // Axe est-ouest au centre d'une rangée de texels, 4,5 m de demi-largeur.
  const z = (30.5) / PER_METER;
  paintWaterwayBeds(data, PIXELS, [0, z, SIDE_M, z, 4.5], AT);
  const water = surfaceId('water') * SURFACE_ID_STEP;
  for (let ty = 0; ty < PIXELS; ty++) {
    const centreM = Math.abs((ty + 0.5) / PER_METER - z);
    const red = data[(ty * PIXELS + 20) * 4];
    assert.equal(red === water, centreM <= 4.5, `rangée ${ty} à ${centreM.toFixed(2)} m`);
    if (red === water) assert.equal(data[(ty * PIXELS + 20) * 4 + 2], surfaceSignature(surfaceId('water')));
  }
});
