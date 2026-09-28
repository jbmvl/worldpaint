import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { planCheer, CHEER_MAX } from '../src/layers/spectatorPlacement.js';
import { SpectatorLayer, CHEER_FORGET_M, SPECTATOR_OUTFITS } from '../src/layers/spectatorLayer.js';
import { World } from '../src/world.js';

/** Route est-ouest de `halfWidth` de demi-largeur, de x = 0 à x = 200. */
function eastWestRoads(halfWidth = 3) {
  const path = [];
  for (let x = 0; x <= 200; x += 10) path.push({ x, z: 0, distance: x });
  const segment = { profile: 'minor', halfWidth, path, platform: new Float32Array(path.length) };
  return { elevationIndex: new RoadIndex([segment], { includeWorks: true }) };
}

const plan = (options = {}) =>
  planCheer({ roads: eastWestRoads(), groundAt: () => 2, x: 100, z: 5, seed: 42, outfits: 6, ...options });

test('les spectateurs se rangent sur l’accotement, jamais sur la chaussée', () => {
  const people = plan({ count: 12 });
  assert.equal(people.length, 12);
  for (const p of people) {
    assert.ok(Math.abs(p.z) >= 3 + 0.6 - 1e-9, `pieds sur le bitume : z = ${p.z}`);
    assert.ok(Math.abs(p.z) <= 3 + 0.6 + 1.6 + 1e-9, 'pas plus loin que le dernier rang');
    assert.equal(p.y, 2, 'posés sur le sol');
    assert.ok(p.outfit >= 0 && p.outfit < 6);
  }
  const xs = people.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 10, 'étalés le long de la route');
});

test('ils regardent la chaussée', () => {
  for (const p of plan({ count: 10 })) {
    // +Z du modèle après rotation : (sin yaw, cos yaw). Il doit pointer vers l'axe z = 0.
    const facingZ = Math.cos(p.yaw);
    assert.ok(Math.sign(facingZ) === -Math.sign(p.z), `dos à la route : z = ${p.z}, yaw = ${p.yaw}`);
  }
});

test('un côté imposé les range tous du même côté du sens de marche', () => {
  const east = { x: 1, z: 0 };
  assert.ok(plan({ side: 1, ahead: east }).every((p) => p.z > 0), 'à droite en allant vers l’est : au sud');
  assert.ok(plan({ side: -1, ahead: east }).every((p) => p.z < 0));
});

test('même lieu, même graine : même groupe ; sans route, personne', () => {
  assert.deepEqual(plan(), plan());
  assert.equal(plan({ count: 100 }).length, CHEER_MAX, 'le groupe est plafonné');
  assert.deepEqual(plan({ z: 500 }), [], 'hors de portée de toute chaussée');
});

test('la couche joue les groupes et oublie ceux qu’on a dépassés', () => {
  const layer = new SpectatorLayer({ THREE, scene: new THREE.Scene() });
  assert.equal(layer.outfitCount, SPECTATOR_OUTFITS);
  const frame = {};
  const group = layer.addGroup(plan({ count: 8 }), frame);
  layer.advance(0.1, { x: 100, z: 0 }, frame);
  const bodies = layer._bodies.reduce((sum, m) => sum + m.count, 0);
  const arms = layer._arms.reduce((sum, m) => sum + m.count, 0);
  assert.equal(bodies, 8);
  assert.equal(arms, 16, 'deux bras par spectateur');

  layer.advance(0.1, { x: 100 + CHEER_FORGET_M + 50, z: 0 }, frame);
  assert.equal(layer.groupCount, 0, 'passé au large, le groupe est oublié');

  layer.addGroup(plan(), frame);
  layer.advance(0.1, { x: 100, z: 0 }, {});
  assert.equal(layer.groupCount, 0, 'la bulle a changé de repère');

  layer.cancel(group);
  assert.equal(layer.addGroup([], frame), null, 'un groupe vide n’existe pas');
  layer.dispose();
});

test('world.cheer convertit le lieu et le sens de marche avant de déléguer', () => {
  const calls = [];
  const composer = {
    bubble: { frame: { toLocal: (lng, lat) => ({ x: lng, z: lat }) } },
    cheer: (options) => (calls.push(options), 'groupe'),
  };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });
  assert.equal(world.cheer(10, 20, { count: 5, aheadLng: 11, aheadLat: 20 }), 'groupe');
  assert.deepEqual(calls[0], { count: 5, at: { x: 10, z: 20 }, ahead: { x: 1, z: 0 } });

  composer.bubble.frame = null;
  assert.equal(world.cheer(10, 20), null, 'sans repère, rien');
});
