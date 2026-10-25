import test from 'node:test';
import assert from 'node:assert/strict';
import { batPassAt, BAT_PERIOD_S, BAT_PASS_S } from '../src/layers/batFlight.js';
import { sowFireflies, fireflyAt, FIREFLY_MAX } from '../src/layers/fireflies.js';
import { roostNear, launchFlock, buildStarlings, starlingAt, STARLING_FLIGHT_S } from '../src/layers/starlings.js';

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

test('un vol d’étourneaux sort d’un dortoir boisé, puis disparaît', () => {
  const frame = frameAt(0);
  assert.equal(roostNear(frame, { x: 0, z: 0 }, () => 0), null);
  let roost = null;
  for (let x = 0; !roost && x < 4000; x += 30) roost = roostNear(frame, { x, z: 0 }, () => 1);
  assert.ok(roost, 'un dortoir au moins sur 4 km de bois');
  const flock = launchFlock(roost, 0, { x: roost.x - 30, z: roost.z }, 100);
  const birds = buildStarlings();
  const mid = birds.map((b) => starlingAt(b, flock, 105)).filter(Boolean);
  assert.ok(mid.length > birds.length / 2);
  assert.ok(mid.every((s) => s.x > roost.x - 10), 'il s’éloigne de l’observateur');
  assert.equal(birds.map((b) => starlingAt(b, flock, 100 + STARLING_FLIGHT_S)).filter(Boolean).length, 0);
});
