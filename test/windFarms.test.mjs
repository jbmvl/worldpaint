/* Les éoliennes se posent en parcs alignés sur les crêtes, jamais sur un versant ni en forêt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindFarms, buildLandmarks, WIND_FARM_SPACING_M } from '../src/layers/furniture/landmarks.js';
import { FURNITURE_LIMITS } from '../src/layers/furniture/catalog.js';
import { testFrame as frame } from './testFrame.mjs';

function construire(elevationAt, { wood = () => 0, here = { x: 0, z: 0 } } = {}) {
  const placements = new Map([['windTurbine', []], ['pylon', []]]);
  const layer = {
    bubble: { frame, radiusMeters: 2400, surfaceElevationAtLocal: (x, z, fallback) => elevationAt(x, z) ?? fallback },
    counts: {},
    _onRoad: () => false,
    _onWater: () => false,
    _openGround: (x, z) => wood(x, z) < 0.35,
    _turbineYaw: () => 0,
    _place(_placements, item, p) {
      const list = placements.get(item);
      if (list.length >= (p.limit ?? Infinity)) return null;
      const entry = { x: p.x, z: p.z };
      list.push(entry);
      return entry;
    },
  };
  const context = { here, placements };
  buildWindFarms(layer, context, [], []);
  buildLandmarks(layer, context, [], []);
  return { turbines: placements.get('windTurbine'), pylons: placements.get('pylon'), layer };
}

// Une crête qui court d'est en ouest le long de z = 0, en pente douce de part et d'autre.
const crete = (x, z) => 500 - z * z * 0.002 - x * x * 0.000005;

test('les éoliennes d’une crête s’y alignent, par parcs de deux à quatre', () => {
  const { turbines, layer } = construire(crete);
  assert.ok(turbines.length >= 2, `${turbines.length} éoliennes`);
  assert.ok(turbines.length <= FURNITURE_LIMITS.windTurbines);
  assert.equal(layer._turbines.length, turbines.length);
  for (const t of turbines) assert.ok(Math.abs(t.z) <= 60, `machine à z = ${t.z}`);
  // Chaque machine a une voisine à l'écart d'un parc, le long de la crête.
  for (const t of turbines) {
    const voisine = Math.min(...turbines.filter((o) => o !== t).map((o) => Math.hypot(o.x - t.x, o.z - t.z)));
    assert.ok(voisine < WIND_FARM_SPACING_M * 1.3, `voisine à ${voisine} m`);
  }
});

test('un versant régulier ne porte aucune éolienne', () => {
  assert.equal(construire((x, z) => 500 + z * 0.15).turbines.length, 0);
});

test('une crête boisée n’en porte pas', () => {
  assert.equal(construire(crete, { wood: () => 1 }).turbines.length, 0);
});

test('les machines ne dépendent pas de la place de l’observateur', () => {
  const ici = construire(crete).turbines;
  const ailleurs = construire(crete, { here: { x: 300, z: 0 } }).turbines;
  const cle = (t) => `${t.x.toFixed(3)},${t.z.toFixed(3)}`;
  const partagees = ici.filter((t) => Math.hypot(t.x - 300, t.z) < 1500 && Math.hypot(t.x, t.z) < 1500);
  const autres = new Set(ailleurs.map(cle));
  for (const t of partagees) assert.ok(autres.has(cle(t)), cle(t));
});

test('un pylône ne se pose pas au pied d’une éolienne', () => {
  const { turbines, pylons } = construire(crete);
  for (const p of pylons) for (const t of turbines) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) >= 110);
});
