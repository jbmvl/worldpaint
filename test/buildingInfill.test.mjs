/*
 * buildingInfill — le semis du bâti mal relevé : où il a le droit de bâtir,
 * ce qu'il ne recouvre jamais, et qu'il rend le même village quel que soit le
 * point de départ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalFrame } from '../src/core/tileMath.js';
import { REGIONS } from '../src/core/regions.js';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { inCorridor } from '../src/layers/roadCorridor.js';
import { planInfill, infillAllowed, quantile, SPARSE_BUILDINGS, INFILL_DIMENSIONS } from '../src/layers/buildingInfill.js';

const LNG = 24.65;
const LAT = 45.25;
const frameA = createLocalFrame(LNG, LAT, 15);
const frameB = createLocalFrame(LNG + 0.013, LAT, 15);
// Décalage exact entre les deux repères (même latitude, donc même échelle).
const SHIFT_X = (frameA.origin.x - frameB.origin.x) * frameA.scale;

const line = (x0, z0, x1, z1, step = 10) => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));
};
const square = (cx, cz, h) => [
  { x: cx - h, z: cz - h }, { x: cx + h, z: cz - h }, { x: cx + h, z: cz + h }, { x: cx - h, z: cz + h },
];
const rect = (cx, cz, hx, hz) => [
  { x: cx - hx, z: cz - hz }, { x: cx + hx, z: cz - hz }, { x: cx + hx, z: cz + hz }, { x: cx - hx, z: cz + hz },
];

/** Un village : une rue est-ouest, une rue nord-sud, un étang, un cimetière, un tronçon relevé. */
function village(dx = 0) {
  const move = (ring) => ring.map((p) => ({ x: p.x + dx, z: p.z }));
  const streets = [
    { profile: 'minor', halfWidth: 3, path: line(-300 + dx, 0, 300 + dx, 0), works: [] },
    { profile: 'minor', halfWidth: 3, path: line(dx, -300, dx, 300), works: [] },
  ];
  const real = [];
  for (let x = -240; x <= -60; x += 22) real.push({ footprint: move(rect(x, 14, 5, 6)) });
  return {
    streets,
    builtUp: [move(square(0, 0, 250))],
    builtUpClasses: ['residential'],
    greens: [move(square(-150, -60, 25))],
    pond: { x: 100 + dx, z: 60, r: 25 },
    real,
    roadIndex: new RoadIndex(streets),
    here: { x: dx, z: 0 },
  };
}

function plan(v, frame, extra = {}) {
  return planInfill({
    frame,
    streets: v.streets,
    builtUp: v.builtUp,
    builtUpClasses: v.builtUpClasses,
    greens: v.greens,
    real: v.real,
    roadIndex: v.roadIndex,
    blocked: (x, z) => Math.hypot(x - v.pond.x, z - v.pond.z) < v.pond.r,
    here: v.here,
    radius: 1500,
    ...extra,
  });
}

function pointIn(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}
function overlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.z - p.z, nz = p.x - q.x;
      const pa = a.map((c) => c.x * nx + c.z * nz), pb = b.map((c) => c.x * nx + c.z * nz);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
    }
  }
  return true;
}

test('seules les régions qui disent leur bâti mal relevé autorisent le semis', () => {
  assert.equal(infillAllowed(null), false);
  assert.equal(infillAllowed({ sparse: [] }), false);
  assert.equal(infillAllowed({ sparse: [SPARSE_BUILDINGS] }), true);
  for (const region of REGIONS) {
    for (const word of region.sparse ?? []) assert.equal(word, SPARSE_BUILDINGS, `mot sparse inconnu : ${region.id}`);
  }
  const allowed = REGIONS.filter(infillAllowed).map((r) => r.id);
  assert.ok(allowed.includes('transylvanie') && allowed.includes('grande_plaine_hongroise') && allowed.includes('tatras'));
  for (const id of ['flandre', 'zahorie']) {
    const region = REGIONS.find((r) => r.id === id);
    if (region) assert.equal(infillAllowed(region), id === 'zahorie', id);
  }
});

test('un quantile suit sa table, bornes comprises', () => {
  const t = INFILL_DIMENSIONS.length;
  assert.equal(quantile(t, 0), t[0]);
  assert.equal(quantile(t, 0.5), t[3]);
  assert.equal(quantile(t, 1), t[6]);
});

test('les maisons semées ne recouvrent ni bâtiment, ni chaussée, ni eau, ni vert urbain', () => {
  const v = village();
  const out = plan(v, frameA);
  const houses = out.filter((b) => b.kind === 'house');
  assert.ok(houses.length > 30, `village trop vide : ${houses.length} maisons`);
  for (const b of out) {
    for (const p of b.ring) {
      assert.ok(!inCorridor(v.roadIndex, p.x, p.z), 'coin sur une chaussée');
      assert.ok(pointIn(v.builtUp[0], p.x, p.z), 'coin hors emprise habitée');
      assert.ok(Math.hypot(p.x - v.pond.x, p.z - v.pond.z) >= v.pond.r, 'coin dans l’étang');
      assert.ok(!pointIn(v.greens[0], p.x, p.z), 'coin dans le cimetière');
    }
    for (const r of v.real) assert.ok(!overlap(b.ring, r.footprint), 'recouvre un bâtiment relevé');
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) assert.ok(!overlap(out[i].ring, out[j].ring), 'deux bâtiments semés se recouvrent');
  }
});

test('un quartier relevé ne reçoit rien, en face comme entre ses maisons', () => {
  const v = village();
  const out = plan(v, frameA);
  const intruders = out.filter((b) => b.x > -230 && b.x < -70 && Math.abs(b.z) < 50);
  assert.deepEqual(intruders.map((b) => [Math.round(b.x), Math.round(b.z)]), []);
  // Loin du tronçon relevé, la même rue est semée.
  assert.ok(out.some((b) => b.x > 100 && Math.abs(b.z) < 50));
});

test('une rue entièrement vide d’un lieu relevé ailleurs reste vide', () => {
  const v = village();
  // Les deux rives de la rue est-ouest relevées sur toute leur longueur.
  const real = [];
  for (let x = -240; x <= 240; x += 24) real.push({ footprint: rect(x, 14, 5, 6) }, { footprint: rect(x, -14, 5, 6) });
  const out = plan({ ...v, real }, frameA);
  assert.ok(out.every((b) => Math.abs(b.z) > 60), 'semé entre des maisons relevées');
});

test('le même sol rend le même village, d’où que parte l’observateur', () => {
  const key = (b, dx) => `${b.kind}:${Math.round((b.x - dx) * 2)},${Math.round(b.z * 2)}`;
  const a = plan(village(0), frameA).map((b) => key(b, 0)).sort();
  const b = plan(village(SHIFT_X), frameB).map((b) => key(b, SHIFT_X)).sort();
  assert.ok(a.length > 30);
  assert.deepEqual(b, a);
});

test('un point d’intérêt sans empreinte reçoit la sienne, et lui seul', () => {
  const v = village();
  const anchors = [
    { x: 60, z: -40, kind: 'church' },
    { x: -150, z: 18, kind: 'shop' },      // dans un bâtiment relevé
    { x: 150, z: -30, kind: 'shop' },
    { x: 200, z: -200, kind: 'castle' },   // jamais semé
  ];
  const out = plan(v, frameA, { anchors });
  const churches = out.filter((b) => b.kind === 'church');
  assert.equal(churches.length, 1);
  assert.ok(pointIn(churches[0].ring, 60, -40));
  // Axe est-ouest : deux côtés horizontaux.
  const [p, q] = churches[0].ring;
  assert.ok(Math.abs(p.z - q.z) < 1e-6 || Math.abs(p.x - q.x) < 1e-6);
  assert.equal(out.filter((b) => b.kind === 'shop').length, 1);
  assert.ok(pointIn(out.find((b) => b.kind === 'shop').ring, 150, -30));
  assert.equal(out.filter((b) => b.kind === 'castle').length, 0);
  // Une maison semée ne porte jamais de fonction.
  assert.ok(out.every((b) => ['house', 'annex', 'church', 'shop'].includes(b.kind)));
});

test('sans rue habitable ni emprise résidentielle, rien n’est semé', () => {
  const v = village();
  const tracks = v.streets.map((s) => ({ ...s, profile: 'track' }));
  assert.equal(plan({ ...v, streets: tracks, roadIndex: new RoadIndex(tracks) }, frameA).length, 0);
  assert.equal(plan({ ...v, builtUpClasses: ['industrial'] }, frameA).length, 0);
});
