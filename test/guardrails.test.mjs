/* Les protections suivent le danger de chaque rive, même sur une petite route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardrailStyleFor, pathTurn } from '../src/layers/furniturePlacement.js';
import { buildParapets, buildRoadsideRelief, measureRoom } from '../src/layers/furniture/roadsideRelief.js';
import { createProfileBuffer } from '../src/layers/ribbonGeometry.js';
import { furnitureSpecsFor } from '../src/layers/furnitureKit.js';

function banc({ profile = 'major', sens = 1, courbe = false } = {}) {
  const path = Array.from({ length: 13 }, (_, i) => {
    const a = i * .1;
    return courbe ? { x: 50 * Math.cos(a), z: sens * 50 * Math.sin(a), distance: i * 5 }
      : { x: i * 5, z: 0, distance: i * 5 };
  });
  const segment = { path, platform: new Float32Array(path.length).fill(100), halfWidth: 3, profile };
  const rows = path.map((p, r) => ({ ...p, r, slope: 0, uphill: 1, drop: 0, perch: 0,
    curvature: Math.abs(pathTurn(path, r)), turn: Math.sign(pathTurn(path, r)) }));
  const buffers = Object.fromEntries(['guardrailBeam', 'woodRail', 'woodRailTop'].map(k => [k, createProfileBuffer()]));
  const placements = [];
  const layer = { specs: furnitureSpecsFor(), _place: (_, kind, p) => placements.push({ kind, ...p }) };
  const context = { buffers, placements, sampleElevation: () => 100 };
  return { layer, context, segment, rows };
}

test('les routes protègent les courbes sans exiger de ravin, les dessertes et pistes restent plus rares', () => {
  for (const profile of ['express', 'major', 'minor']) {
    assert.ok(guardrailStyleFor({ profile, curvature: .02 }));
    assert.equal(guardrailStyleFor({ profile, slope: .4, drop: .2 }), null);
    assert.ok(guardrailStyleFor({ profile, slope: .3, drop: 2 }));
  }
  for (const profile of ['lane', 'track']) {
    assert.equal(guardrailStyleFor({ profile, curvature: .02 }), null);
    assert.equal(guardrailStyleFor({ profile, curvature: .02, drop: 1 }), 'wood');
    assert.equal(guardrailStyleFor({ profile, slope: .3, drop: 2 }), 'wood');
  }
  assert.equal(guardrailStyleFor({ profile: 'path', curvature: .1, slope: 1, drop: 10 }), null);
});

test('la lisse suit l’extérieur du virage dans les deux sens de parcours', () => {
  for (const sens of [-1, 1]) {
    const b = banc({ courbe: true, sens });
    buildParapets(b.layer, b.context, b.segment, b.rows);
    assert.ok(b.context.placements.length > 0);
    for (const p of b.context.placements) {
      assert.ok(Math.hypot(p.x, p.z) > 53, 'poteaux à l’extérieur du cercle');
      assert.equal(p.y, 100, 'pieds à la cote de la plate-forme');
    }
  }
});

test('un court virage de moins de six lignes garde sa protection', () => {
  const b = banc({ courbe: true });
  buildParapets(b.layer, b.context, b.segment, b.rows.slice(4, 7));
  assert.ok(b.context.buffers.guardrailBeam.positions.length > 0);
});

test('le vide intérieur et le virage extérieur protègent leurs rives respectives', () => {
  const b = banc();
  const rows = b.rows.map(p => ({ ...p, curvature: .02, turn: 1, slope: .3, drop: 4, perch: -1 }));
  buildParapets(b.layer, b.context, b.segment, rows);
  assert.ok(b.context.placements.some(p => p.z > 3));
  assert.ok(b.context.placements.some(p => p.z < -3));
});

test('un changement de dévers ne fait jamais traverser la chaussée à la lisse', () => {
  const b = banc();
  const rows = b.rows.map((p, i) => ({ ...p, slope: .3, drop: 4, perch: -1, uphill: i < 6 ? 1 : -1 }));
  buildParapets(b.layer, b.context, b.segment, rows);
  assert.ok(b.context.placements.filter(p => p.x < 25).every(p => p.z > 3));
  assert.ok(b.context.placements.filter(p => p.x > 30).every(p => p.z < -3));
  assert.ok(b.context.placements.length > 0);
});

test('une bouche interrompt la rambarde sans la reporter sur l’autre rive', () => {
  const b = banc();
  const rows = b.rows.map((p, i) => ({ ...p, slope: .3, drop: 4, perch: -1,
    room: { 1: 12, '-1': i >= 5 && i <= 7 ? 0 : 12 } }));
  buildParapets(b.layer, b.context, b.segment, rows);
  assert.ok(b.context.placements.length > 0);
  assert.ok(b.context.placements.every(p => p.z > 3 && (p.x <= 20 || p.x >= 40)));
});

test('la construction du relief laisse les petites routes recevoir leur garde-corps', () => {
  for (const profile of ['lane', 'track']) {
    const b = banc({ profile });
    buildRoadsideRelief(b.layer, b.context, b.segment, b.rows.map(p => ({ ...p, slope: .3, drop: 2, perch: -1 })));
    assert.ok(b.context.buffers.woodRail.positions.length > 0, profile);
    assert.ok(b.context.placements.length > 0, profile);
  }
});


test('hors des carrefours, la place libre ne devient pas un îlot fermé', () => {
  const b = banc({ courbe: true });
  b.layer._areas = { length: 1, indexAt: (x, z) => x > 1000 && z > 1000 ? 0 : -1 };
  measureRoom(b.layer, b.segment, b.rows);
  for (const row of b.rows) {
    assert.equal(row.room[1], 12);
    assert.equal(row.room[-1], 12);
  }
  buildParapets(b.layer, b.context, b.segment, b.rows);
  assert.ok(b.context.buffers.guardrailBeam.positions.length > 0);
});
