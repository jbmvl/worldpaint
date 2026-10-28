import test from 'node:test';
import assert from 'node:assert/strict';
import { batPassAt, BAT_PERIOD_S, BAT_PASS_S } from '../src/layers/batFlight.js';
import { sowFireflies, fireflyAt, FIREFLY_MAX } from '../src/layers/fireflies.js';
import { roostNear, launchFlock, buildStarlings, starlingAt, STARLING_FLIGHT_S } from '../src/layers/starlings.js';
import { roostInCell } from '../src/layers/furniture/roosts.js';

const frameAt = (ox) => ({ zoom: 14, scale: 2445, origin: { x: 8000 + ox, y: 5800 } });

test('les chauves-souris ne passent que de temps en temps, jamais en continu', () => {
  let on = 0;
  const total = BAT_PERIOD_S * 50;
  for (let t = 0; t < total; t += 0.5) if (batPassAt(t)) on += 0.5;
  assert.ok(on > 0, 'au moins un passage');
  assert.ok(on <= 50 * BAT_PASS_S, 'au plus un passage par fenêtre');
});

test('les lucioles ne naissent que dans le bois, au même endroit du sol quel que soit le repère', () => {
  const flat = () => 10;
  assert.equal(sowFireflies(frameAt(0), { x: 0, z: 0 }, () => 0, flat).length, 0);
  const a = sowFireflies(frameAt(0), { x: 0, z: 0 }, () => 1, flat);
  assert.ok(a.length > 0 && a.length <= FIREFLY_MAX);
  // Même point du monde vu d'un repère décalé d'une tuile : mêmes lucioles, décalées.
  const shifted = frameAt(-1);
  const b = sowFireflies(shifted, { x: shifted.scale, z: 0 }, () => 1, flat);
  const key = (f, dx) => `${Math.round((f.x - dx) * 100)}:${Math.round(f.z * 100)}`;
  const set = new Set(a.map((f) => key(f, 0)));
  const common = b.filter((f) => set.has(key(f, shifted.scale))).length;
  assert.ok(common > a.length * 0.8, `${common} / ${a.length}`);
  // Lente : moins de 0,3 m/s, et toujours près de son point de semis.
  for (let t = 0; t < 60; t += 0.5) {
    const p = fireflyAt(a[0], t), q = fireflyAt(a[0], t + 0.5);
    assert.ok(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / 0.5 < 0.3);
    assert.ok(Math.hypot(p.x - a[0].x, p.z - a[0].z) <= 1);
  }
});

test('un dortoir se pose à la lisière qui fait face à la route, toujours le même', () => {
  // Une route sur l'axe z = 0, un bois au-delà de z = 60.
  const woodAt = (x, z) => (z > 60 ? 1 : 0);
  const nearestRoad = (x, z, r) => (Math.abs(z) <= r ? { x, z: 0, distance: Math.abs(z) } : null);
  const found = (frame, dx) => {
    const roosts = [];
    for (let x = -2000; x < 2000; x += 120) {
      for (const z of [0, 120]) {
        const cell = { x: x + dx, z, size: 120, row: 0, id: 0 };
        const r = roostInCell(frame, cell, woodAt, nearestRoad);
        if (r) roosts.push(r);
      }
    }
    return roosts;
  };
  const roosts = found(frameAt(0), 0);
  assert.ok(roosts.length > 0);
  for (const r of roosts) {
    assert.ok(r.z > 60 && r.z <= 64 + 1e-9, `lisière : ${r.z}`);
    assert.equal(r.roadZ, 0);
  }
  assert.equal(roostInCell(frameAt(0), { x: 0, z: 120, size: 120 }, () => 0, nearestRoad), null);
  assert.equal(roostInCell(frameAt(0), { x: 0, z: 120, size: 120 }, woodAt, () => null), null);
});

test('un vol d’étourneaux sort d’un dortoir boisé, puis disparaît', () => {
  const roost = { key: 'a', x: 10, z: 80, roadX: 10, roadZ: 0, seed: 0.5 };
  assert.equal(roostNear([roost], { x: 10, z: -100 }), null);
  assert.equal(roostNear([roost], { x: 30, z: 0 }), roost);
  const flock = launchFlock(roost, 0, { x: roost.x - 30, z: roost.z }, 100);
  const birds = buildStarlings();
  const mid = birds.map((b) => starlingAt(b, flock, 105)).filter(Boolean);
  assert.ok(mid.length > birds.length / 2);
  assert.ok(mid.every((s) => s.x > roost.x - 10), 'il s’éloigne de l’observateur');
  assert.equal(birds.map((b) => starlingAt(b, flock, 100 + STARLING_FLIGHT_S)).filter(Boolean).length, 0);
});

test('les hirondelles se posent sur quelques portées, toujours les mêmes, et s’égaillent à l’approche', async () => {
  const { perchesNear, flushes, launchSwallows, swallowAt, SWALLOW_FLIGHT_S, SWALLOW_SPAN_ODDS } = await import('../src/layers/swallows.js');
  const spans = [];
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 7 - 70;
    const z = Math.floor(i / 20) * 7 - 70;
    spans.push({ ax: x, ay: 8, az: z, bx: x + 40, by: 8.5, bz: z, sag: 1.1 });
  }
  const a = perchesNear(frameAt(0), { x: 0, z: 0 }, spans);
  assert.ok(a.length > 0 && a.length < spans.length * SWALLOW_SPAN_ODDS * 2, `${a.length}`);
  // Même portée vue d'un repère décalé d'une tuile : mêmes oiseaux.
  const shifted = frameAt(-1);
  const moved = spans.map((s) => ({ ...s, ax: s.ax + shifted.scale, bx: s.bx + shifted.scale }));
  const b = perchesNear(shifted, { x: shifted.scale, z: 0 }, moved);
  assert.deepEqual(b.map((p) => p.key), a.map((p) => p.key));
  // Sur le fil : entre ses appuis, sous la cote des appuis (la flèche).
  for (const bird of a.flatMap((p) => p.birds)) assert.ok(bird.y <= 8.5 && bird.y > 6.5, `${bird.y}`);
  const perch = a[0];
  assert.equal(flushes(perch, { x: perch.x + 500, z: perch.z }), false);
  assert.equal(flushes(perch, { x: perch.birds[0].x + 5, z: perch.birds[0].z }), true);
  // Envolées, elles tombent du fil, s'éloignent et montent, puis disparaissent.
  const bird = perch.birds[0];
  const flight = launchSwallows(perch, { x: perch.birds[0].x, z: perch.birds[0].z - 25 }, 100, 0);
  const early = swallowAt(bird, flight, 100.3 + bird.delay);
  assert.equal(early.perched, false);
  assert.ok(early.y < bird.y, `${early.y} ${bird.y}`);
  const s = swallowAt(bird, flight, 104);
  assert.equal(s.perched, false);
  assert.ok(s.y > bird.y && Math.hypot(s.x - bird.x, s.z - bird.z) > 20);
  assert.ok(s.z > bird.z, 'à l’opposé de l’observateur');
  assert.equal(swallowAt(bird, flight, 100 + SWALLOW_FLIGHT_S), null);
  // En vague : le bout de la rangée le plus éloigné de l'observateur part après.
  const row = a.find((p) => p.birds.length >= 5);
  const wave = launchSwallows(row, { x: row.birds[0].x, z: row.birds[0].z - 25 }, 0, 0);
  const last = row.birds[row.birds.length - 1];
  const leftAt = (b) => { let t = 0; while (swallowAt(b, wave, t)?.perched) t += 0.01; return t; };
  assert.ok(leftAt(last) - last.delay > leftAt(row.birds[0]) - row.birds[0].delay);
});

test('une rangée d’hirondelles appelée se pose sur la portée la plus proche hors d’envol, puis s’oublie une fois envolée', async () => {
  const THREE = await import('three');
  const { LifeLayer } = await import('../src/layers/lifeLayer.js');
  const { spanToCall, perchesNear, SWALLOW_FLUSH_M, SWALLOW_FLIGHT_S } = await import('../src/layers/swallows.js');
  const frame = frameAt(0);
  // Une portée sous les pieds, une à 80 m, une à 300 m ; aucune n'est habitée d'elle-même.
  const span = (x) => ({ ax: x - 20, ay: 8, az: 0, bx: x + 20, by: 8, bz: 0, sag: 1.1 });
  const wires = [0, 80, 300].map(span).filter((s) => perchesNear(frame, { x: (s.ax + s.bx) / 2, z: 0 }, [s]).length === 0);
  assert.equal(wires.length, 3, 'portées de l’essai habitées par le tirage : changer leurs abscisses');
  assert.equal(spanToCall(wires, { x: 0, z: 0 }), wires[1]);
  assert.equal(spanToCall([wires[0]], { x: 0, z: 0 }), wires[0]);
  assert.equal(spanToCall([], { x: 0, z: 0 }), null);

  const life = new LifeLayer({ THREE, scene: new THREE.Scene(), bubble: null });
  const ground = { frame, wires, roosts: [], woodAt: () => false, elevationAt: () => 0 };
  const here = { x: 0, y: 2, z: 0 };
  life.advance(1 / 30, here, ground);
  assert.equal(life.swallowsPerched.count, 0);
  const row = life.perchSwallows(here, ground);
  assert.ok(row && row.distanceM > SWALLOW_FLUSH_M && row.distanceM < 120, JSON.stringify(row));
  life.advance(1 / 30, here, ground);
  assert.equal(life.swallowsPerched.count, row.count);
  // L'observateur s'approche : la rangée s'envole, puis ne revient pas.
  const close = { x: row.x, y: 2, z: row.z };
  life.advance(1 / 30, close, ground);
  for (let t = 0; t <= SWALLOW_FLIGHT_S + 1; t += 0.5) life.advance(0.5, close, ground);
  assert.equal(life.swallowsPerched.count + life.swallowsFlying.count, 0);
  life.advance(1 / 30, here, ground);
  assert.equal(life.swallowsPerched.count, 0);
  life.dispose();
});

test('une hirondelle se pose sur le câble tel qu’il est dessiné, qui suit le relief', async () => {
  const { perchOnSpan } = await import('../src/layers/swallows.js');
  // Un câble qui enjambe une bosse : la corde entre appuis passe deux mètres plus bas.
  const heights = [8, 9, 10, 10, 10, 9, 8];
  const perch = perchOnSpan(frameAt(0), { ax: 0, ay: 8, az: 0, bx: 60, by: 8, bz: 0, sag: 0, heights });
  for (const bird of perch.birds) {
    const f = (bird.x / 60) * 6;
    const i = Math.min(5, Math.floor(f));
    assert.ok(Math.abs(bird.y - (heights[i] + (heights[i + 1] - heights[i]) * (f - i))) < 1e-9, `${bird.x} ${bird.y}`);
  }
});

test('un vol d’étourneaux appelé part d’une lisière, devant de préférence, et rien sans bois', async () => {
  const { treeToRaise } = await import('../src/layers/starlings.js');
  const frame = frameAt(0);
  // Deux bois : un derrière (z < -60), un devant (z > 90).
  const woodAt = (x, z) => (z < -60 || z > 90 ? 1 : 0);
  const ahead = treeToRaise(frame, { x: 0, z: 0 }, { woodAt, forward: { x: 0, z: 1 } });
  assert.ok(ahead && ahead.z > 90 && ahead.z < 110, JSON.stringify(ahead));
  const behind = treeToRaise(frame, { x: 0, z: 0 }, { woodAt, forward: { x: 0, z: -1 } });
  assert.ok(behind && behind.z < -60 && behind.z > -80, JSON.stringify(behind));
  assert.equal(treeToRaise(frame, { x: 0, z: 0 }, { woodAt: () => 0 }), null);
  // Un dortoir à portée passe avant tout bois.
  const roost = { x: 50, z: 50, roadX: 0, roadZ: 0, seed: 0.3, key: 'r' };
  assert.deepEqual(treeToRaise(frame, { x: 0, z: 0 }, { woodAt, roosts: [roost] }), { x: 50, z: 50, seed: 0.3 });
});
