import test from 'node:test';
import assert from 'node:assert/strict';
import { contourSurface, traceChains, CONTOUR_REACH_TEXELS } from '../src/terrain/surfaceContours.js';
import {
  drawSurfaceContoursSteps,
  CROP_LABEL_BASE,
  FARMLAND_ID,
  SURFACE_ID_STEP,
  surfaceId,
} from '../src/terrain/groundClassMap.js';
import { CROP_ID_STEP } from '../src/layers/furniturePlacement.js';
import { finishGeneration } from '../src/core/generationSteps.js';

/** Carte d'étiquettes `n × n` remplie par `at(x, y)` au centre de chaque texel. */
function paint(n, at) {
  const labels = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) labels[y * n + x] = at(x + 0.5, y + 0.5);
  return labels;
}

/** Distance signée d'une étiquette au centre d'un texel, comme la lit le shader. */
const signed = (labels, result, n, label) => (x, y) =>
  (labels[y * n + x] === label ? 1 : -1) * result.distance[y * n + x];

/** Catmull-Rom de la distance signée, comme `surfaceAt` (grille : centres de texels aux entiers). */
function cubicAt(score, gx, gy) {
  const weights = (t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return [0.5 * (-t3 + 2 * t2 - t), 0.5 * (3 * t3 - 5 * t2 + 2), 0.5 * (-3 * t3 + 4 * t2 + t), 0.5 * (t3 - t2)];
  };
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  const wx = weights(gx - cx);
  const wy = weights(gy - cy);
  let sum = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) sum += wx[i] * wy[j] * score(cx - 1 + i, cy - 1 + j);
  return sum;
}

test('une limite en escalier redevient une droite', () => {
  // Pente de 1/7 : l'escalier le plus long, celui qui se voyait le plus.
  // Une parcelle entière dans la carte : au bord de la carte, les bouts de
  // chaîne sont épinglés.
  const n = 96;
  const line = (x) => 30.3 + x / 7;
  const labels = paint(n, (x, y) => (y > line(x) && y < 80 && x > 4 && x < 92 ? 2 : 1));
  const result = contourSurface(labels, n);
  const score = signed(labels, result, n, 2);

  let worst = 0;
  for (let x = 16; x < n - 16; x += 0.25) {
    // Zéro de la distance interpolée le long d'une verticale.
    let y = line(x) - 3;
    let previous = cubicAt(score, x - 0.5, y - 0.5);
    for (; y < line(x) + 3; y += 0.01) {
      const value = cubicAt(score, x - 0.5, y - 0.5);
      if (previous < 0 && value >= 0) break;
      previous = value;
    }
    worst = Math.max(worst, Math.abs(y - line(x)));
  }
  assert.ok(worst < 0.2, `le trait s'écarte de ${worst.toFixed(3)} texel de la droite`);
});

test('un coin de parcelle reste vif, un étang reste rond', () => {
  const n = 64;
  const labels = paint(n, (x, y) => {
    if (Math.hypot(x - 44, y - 20) < 9) return 3;
    return x > 8 && x < 30 && y > 30 && y < 56 ? 2 : 1;
  });
  const chains = traceChains(labels, n);
  assert.equal(chains.length, 2, 'deux boucles, aucune jonction');
  assert.ok(chains.every((c) => c.closed));

  const result = contourSurface(labels, n);
  // Le coin (8, 30) : un texel juste dedans reste dedans, un juste dehors reste dehors.
  assert.equal(labels[30 * n + 8], 2);
  assert.equal(labels[29 * n + 8], 1);
  assert.equal(labels[30 * n + 7], 1);
  // L'étang : tout centre à plus d'un demi-texel du cercle garde son côté.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - 44, y + 0.5 - 20);
      if (Math.abs(r - 9) > 0.5) assert.equal(labels[y * n + x] === 3, r < 9, `texel ${x},${y}`);
    }
  }
  assert.ok(result.distance.every((d) => d >= 0 && d <= CONTOUR_REACH_TEXELS));
});

test('un filet d’un texel en diagonale reste continu', () => {
  // Un fossé ne se touche que par les coins : le coin en damier n'est pas une
  // jonction, le filet y passe.
  const n = 32;
  const labels = paint(n, (x, y) => (Math.floor(x) === Math.floor(y) && x > 4 && x < 28 ? 2 : 1));
  const chains = traceChains(labels, n);
  assert.equal(chains.length, 1, 'une seule boucle autour du filet');

  const result = contourSurface(labels, n);
  const score = signed(labels, result, n, 2);
  for (let k = 8; k < 24; k++) {
    // Au coin partagé par deux texels d'eau successifs.
    assert.ok(cubicAt(score, k + 0.5, k + 0.5) > 0.05, `le filet tient au coin ${k}`);
  }
});

test('un texel isolé survit, et la matière d’en face est connue', () => {
  const n = 16;
  const labels = paint(n, (x, y) => (Math.floor(x) === 7 && Math.floor(y) === 7 ? 5 : 1));
  const result = contourSurface(labels, n);
  assert.equal(labels[7 * n + 7], 5);
  assert.equal(result.other[7 * n + 7], 1);
  assert.equal(result.other[7 * n + 8], 5);
  assert.equal(result.other[0], -1, 'loin de tout trait, personne en face');
});

test('le tracé ne dépend que du sol : une carte décalée trace la même chose, décalée', () => {
  const n = 80;
  const shape = (x, y) =>
    Math.hypot(x - 30, y - 34) < 12 || (y > 50 + x / 5 && y < 66 && x > 20 && x < 60) ? 2 : 1;
  const a = paint(n, shape);
  const b = paint(n, (x, y) => shape(x - 5, y - 3));
  const ra = contourSurface(a, n);
  const rb = contourSurface(b, n);
  for (let y = 10; y < 70; y++) {
    for (let x = 10; x < 70; x++) {
      const p = y * n + x;
      const q = (y + 3) * n + x + 5;
      assert.equal(b[q], a[p]);
      assert.ok(Math.abs(rb.distance[q] - ra.distance[p]) < 1e-5, `distance au texel ${x},${y}`);
    }
  }
});

test('la carte du sol porte la distance au trait et la matière d’en face, culture comprise', () => {
  // Deux parcelles de cultures différentes ont une limite à elles.
  const n = 32;
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      if (x < 16) {
        data[i] = surfaceId('grass') * SURFACE_ID_STEP;
      } else {
        data[i] = FARMLAND_ID * SURFACE_ID_STEP;
        data[i + 1] = (y < 16 ? 1 : 2) * CROP_ID_STEP;
      }
      data[i + 3] = 255;
    }
  }
  finishGeneration(drawSurfaceContoursSteps(data, n));

  const at = (x, y) => (y * n + x) * 4;
  // Le texel de blé au bord du pré : à un demi-texel du trait, le pré en face.
  assert.ok(Math.abs((data[at(16, 8) + 2] / 255) * CONTOUR_REACH_TEXELS - 0.5) < CONTOUR_REACH_TEXELS / 255);
  assert.equal(data[at(16, 8) + 3] - 1, surfaceId('grass'));
  // Le texel de la première culture au bord de la seconde : la seconde en face.
  assert.equal(data[at(24, 15) + 3] - 1, CROP_LABEL_BASE + 2);
  // Rouge et vert inchangés là où rien ne bouge.
  assert.equal(data[at(24, 15)], FARMLAND_ID * SURFACE_ID_STEP);
  assert.equal(data[at(24, 15) + 1], CROP_ID_STEP);
  // Loin de tout trait, personne en face.
  assert.equal(data[at(4, 4) + 3], 0);
});
