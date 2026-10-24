/*
 * Le déterminisme spatial : le même sol rend les mêmes tirages, quel que soit
 * le repère local — donc quel que soit le point de départ de l'observateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalFrame } from '../src/core/tileMath.js';
import {
  positionSeed,
  cellRandomAt,
  worldCellsIn,
  worldCellsAround,
  uniformWorldGrid,
  hash32,
  randomStream,
} from '../src/core/groundSeed.js';
import { coverBandCells, coverBand } from '../src/layers/coverBands.js';
import { fillCropCell, CROP_BANDS, CROP_TUFT_STRIDE } from '../src/layers/cropLayer.js';
import { buildBiomeDebris } from '../src/layers/furniture/biomeDebris.js';

// Le départ de la démo, un départ à 3 km à l'est, un autre à 25 km au nord-ouest
// (au-delà de la distance de recentrage du repère).
const HOME = { lng: -0.145, lat: 47.131 };
const FRAMES = [
  createLocalFrame(HOME.lng, HOME.lat, 15),
  createLocalFrame(HOME.lng + 0.04, HOME.lat, 15),
  createLocalFrame(HOME.lng - 0.25, HOME.lat + 0.16, 15),
];
const local = (frame, { lng, lat }) => frame.toLocal(lng, lat);

/** Des points au sol autour du départ, en degrés, tirés d'une suite fixe. */
function groundPoints(count, spreadDeg = 0.02) {
  const random = randomStream(7);
  return Array.from({ length: count }, () => ({
    lng: HOME.lng + (random() - 0.5) * spreadDeg,
    lat: HOME.lat + (random() - 0.5) * spreadDeg,
  }));
}

test('une graine de lieu ne dépend pas du repère', () => {
  for (const p of groundPoints(500)) {
    const seeds = FRAMES.map((frame) => {
      const { x, z } = local(frame, p);
      return positionSeed(frame, x, z, 41);
    });
    assert.ok(seeds.every((s) => s === seeds[0]), `${p.lng}, ${p.lat} : ${seeds.join(' / ')}`);
  }
});

test('un tirage de maille ne dépend pas du repère', () => {
  for (const step of [22, 140, 420]) {
    for (const p of groundPoints(300)) {
      const draws = FRAMES.map((frame) => {
        const { x, z } = local(frame, p);
        return cellRandomAt(frame, x, z, step, 131);
      });
      assert.ok(draws.every((d) => d === draws[0]), `pas ${step} m`);
    }
  }
});

test('les mailles mondiales tombent au même endroit du sol dans tous les repères', () => {
  const box = (frame) => {
    const c = local(frame, HOME);
    return worldCellsIn(frame, c.x - 300, c.z - 300, c.x + 300, c.z + 300, 22);
  };
  const [reference, ...others] = FRAMES.map((frame) => {
    const cells = new Map();
    for (const cell of box(frame)) cells.set(`${cell.id}:${cell.row}`, frame.toLngLat(cell.x, cell.z));
    return cells;
  });
  for (const cells of others) {
    let shared = 0;
    for (const [key, corner] of cells) {
      const same = reference.get(key);
      if (!same) continue;
      shared++;
      assert.ok(Math.abs(same.lng - corner.lng) < 1e-9 && Math.abs(same.lat - corner.lat) < 1e-9, key);
    }
    assert.ok(shared > 0.9 * reference.size, `mailles communes : ${shared} sur ${reference.size}`);
  }
});

test('une maille mondiale a le pas demandé, et ses voisines la bordent sans recouvrement', () => {
  const frame = FRAMES[0];
  for (const step of [2.2, 22, 140, 320, 420]) {
    for (const cell of worldCellsIn(frame, -50, -50, 50, 50, step)) {
      assert.ok(Math.abs(cell.size - step) / step < 0.02, `pas ${step} : côté ${cell.size}`);
    }
  }
  const cells = worldCellsIn(frame, -500, -500, 500, 500, 22);
  const keys = new Set(cells.map((c) => `${c.id}:${c.row}`));
  assert.equal(keys.size, cells.length, 'une maille par identifiant');
  const covered = cells.reduce((sum, c) => sum + c.size * c.size, 0);
  assert.ok(covered >= 1000 * 1000, 'le rectangle est couvert');
});

test('les mailles d’une passe sont triées du plus proche au plus lointain', () => {
  const cells = worldCellsAround(FRAMES[0], { x: 12, z: -7 }, 200, 22);
  for (let i = 1; i < cells.length; i++) assert.ok(cells[i].distance >= cells[i - 1].distance);
});

test('les cultures poussent aux mêmes points du sol, d’où que l’on parte', () => {
  // Repères alignés est-ouest : même échelle, donc même disque en mètres.
  const [a, b] = FRAMES;
  const band = CROP_BANDS[0];
  const tufts = (frame) => {
    const c = local(frame, HOME);
    const out = new Map();
    const buffer = new Float32Array(band.perCell * CROP_TUFT_STRIDE);
    for (const cell of coverBandCells(frame, [coverBand({ ...band, to: 20 })], c.x, c.z)) {
      fillCropCell(buffer, cell, band.perCell, band.salt);
      const { lng, lat } = frame.toLngLat(buffer[0], buffer[1]);
      out.set(`${cell.id}:${cell.row}`, { lng, lat, size: buffer[3] });
    }
    return out;
  };
  const first = tufts(a);
  const second = tufts(b);
  assert.ok(first.size > 50);
  for (const [key, tuft] of first) {
    const other = second.get(key);
    if (!other) continue;
    // Les touffes sont rangées en simple précision : quelques millimètres près.
    assert.ok(Math.abs(other.lng - tuft.lng) < 1e-7 && Math.abs(other.lat - tuft.lat) < 1e-7, key);
    assert.equal(other.size, tuft.size, key);
  }
});

test('le mobilier semé tombe aux mêmes points du sol, d’où que l’on parte', () => {
  const [a, b] = FRAMES;
  const sow = (frame) => {
    const placed = [];
    const layer = {
      bubble: { frame },
      counts: {},
      groundClass: { surfaceAt: () => 'heath' },
      _onRoad: () => false,
      _place(_placements, item, at) {
        placed.push({ item, yaw: at.yaw, ...frame.toLngLat(at.x, at.z) });
        return null;
      },
    };
    buildBiomeDebris(layer, { here: local(frame, HOME), placements: {} }, null);
    return placed;
  };
  const first = sow(a);
  const second = sow(b);
  assert.ok(first.length > 0, 'la lande porte quelque chose');
  // Le bord du disque peut garder ou perdre une maille d'un repère à l'autre :
  // on compare ce qui est commun aux deux.
  const key = (p) => `${p.lng.toFixed(7)}:${p.lat.toFixed(7)}`;
  const index = new Map(second.map((p) => [key(p), p]));
  let common = 0;
  for (const p of first) {
    const q = index.get(key(p));
    if (!q) continue;
    common++;
    assert.equal(q.item, p.item);
    assert.equal(q.yaw, p.yaw);
  }
  assert.ok(common >= 0.95 * first.length, `${common} objets communs sur ${first.length}`);
});

test('le hachage commun mélange chacun de ses arguments', () => {
  assert.equal(hash32(1, 2, 3), hash32(1, 2, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(2, 1, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(1, 2, 4));
  assert.notEqual(hash32(0, 0, 0), hash32(0, 0, 1));
});

test('la grille uniforme et le parcours complet rendent les mêmes mailles', () => {
  const frame = FRAMES[0];
  const step = 2.2;
  const grid = uniformWorldGrid(frame, -60, 60, step);
  assert.ok(grid, 'grille uniforme au départ de la démo');
  const viaGrid = new Map();
  for (let J = grid.line(-50); J <= grid.line(50); J++) {
    for (let I = grid.column(-50); I <= grid.column(50); I++) {
      const c = grid.cell(I, J);
      viaGrid.set(`${c.id}:${c.row}`, c);
    }
  }
  let compared = 0;
  for (const c of worldCellsIn(frame, -40, -40, 40, 40, step)) {
    const same = viaGrid.get(`${c.id}:${c.row}`);
    assert.ok(same, `${c.id}:${c.row}`);
    assert.ok(Math.abs(same.x - c.x) < 1e-6 && Math.abs(same.z - c.z) < 1e-6);
    compared++;
  }
  assert.ok(compared > 1000);
});
