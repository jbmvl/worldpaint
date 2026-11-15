/* Le feu des volcans actifs : cratère retrouvé dans le relief, lave qui descend, tirages stables. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  VolcanoFire, craterSite, traceLavaFlow, volcanoesWithin, volcanoRandom, lavaRibbon, flowCount, FLOW_MAX_M,
} from '../src/layers/volcanoFire.js';
import { ACTIVE_VOLCANOES } from '../src/core/volcanoes.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import { defaultTheme } from '../src/themes/default.js';

/** Un cône de 1200 m au sommet en (cx, cz), pente 0,3. */
const cone = (cx, cz) => (x, z) => 1200 - Math.hypot(x - cx, z - cz) * 0.3;

test('le cratère est retrouvé au sommet du relief, pas au point relevé', () => {
  const site = craterSite({ x: 0, z: 0 }, cone(210, -140));
  assert.ok(Math.hypot(site.x - 210, site.z + 140) < 25);
  assert.equal(craterSite({ x: 0, z: 0 }, () => NaN), null);
});

test('une coulée descend toujours et s’arrête au replat', () => {
  const elevationAt = (x, z) => Math.max(400, cone(0, 0)(x, z));
  const flow = traceLavaFlow({ x: 70, z: 0 }, Math.PI / 2, elevationAt);
  assert.ok(flow.length > 10);
  for (let i = 1; i < flow.length; i++) assert.ok(flow[i].h <= flow[i - 1].h + 1e-9);
  assert.ok(flow[flow.length - 1].along <= FLOW_MAX_M);
  // Le cône atteint le replat à 2667 m du sommet : la coulée, bornée plus tôt, ne le dépasse pas.
  assert.ok(Math.hypot(flow.at(-1).x, flow.at(-1).z) < 2700);
  // Partie vers l'est, elle y reste : la plus forte pente d'un cône est radiale.
  assert.ok(flow.at(-1).x > 0 && Math.abs(flow.at(-1).z) < flow.at(-1).x * 0.3);
});

test('une coulée sur du plat ne part pas', () => {
  assert.ok(traceLavaFlow({ x: 0, z: 0 }, 0, () => 100).length <= 4);
  assert.deepEqual(traceLavaFlow({ x: 0, z: 0 }, 0, () => NaN), []);
});

test('le ruban d’une coulée a deux sommets par point, au-dessus du sol', () => {
  const elevationAt = cone(0, 0);
  const points = traceLavaFlow({ x: 70, z: 0 }, Math.PI / 2, elevationAt);
  const ribbon = lavaRibbon(points, elevationAt);
  assert.equal(ribbon.positions.length, points.length * 6);
  assert.equal(ribbon.index.length, (points.length - 1) * 6);
  for (let i = 0; i < points.length * 2; i++) {
    const [x, y, z] = ribbon.positions.slice(i * 3, i * 3 + 3);
    assert.ok(y > elevationAt(x, z));
  }
});

test('le Vésuve est trouvé depuis Naples, pas depuis Paris', () => {
  const naples = createLocalFrame(14.25, 40.85, 15);
  const found = volcanoesWithin(naples, naples.toLocal(14.25, 40.85), 20000);
  assert.deepEqual(found.map((v) => v.id), ['vesuvio']);
  const paris = createLocalFrame(2.35, 48.85, 15);
  assert.equal(volcanoesWithin(paris, { x: 0, z: 0 }, 20000).length, 0);
});

test('les tirages dépendent du volcan et du rang, jamais de l’appel', () => {
  assert.equal(volcanoRandom('etna', 3, 7), volcanoRandom('etna', 3, 7));
  assert.notEqual(volcanoRandom('etna', 3, 7), volcanoRandom('etna', 4, 7));
  assert.notEqual(volcanoRandom('etna', 3, 7), volcanoRandom('hekla', 3, 7));
  for (let i = 0; i < 200; i++) {
    const r = volcanoRandom('vesuvio', i, 1);
    assert.ok(r >= 0 && r < 1);
  }
  assert.ok(flowCount(1) > flowCount(0.4));
  assert.ok(ACTIVE_VOLCANOES.every((v) => v.activity > 0 && v.activity <= 1));
});

test('le feu se monte sur le relief autour du volcan et se retire', () => {
  const scene = new THREE.Scene();
  const fire = new VolcanoFire({ THREE, scene, theme: defaultTheme });
  const frame = createLocalFrame(14.25, 40.85, 15);
  const vesuvio = frame.toLocal(14.4260, 40.8216);
  fire.build({ frame, here: { x: 0, z: 0 }, radius: 20000, elevationAt: cone(vesuvio.x + 120, vesuvio.z) });
  assert.equal(fire.count, 1);
  const names = fire.meshes.map((m) => m.name).sort();
  assert.deepEqual(names, ['volcano-glow', 'volcano-lava', 'volcano-plume', 'volcano-sparks']);
  fire.advance(1.5);
  fire.setNight(1);
  assert.ok(fire.materials.sparks.uniforms.uGlow.value > 1);
  fire.clear();
  assert.equal(fire.meshes.length, 0);
  fire.build({ frame, here: { x: 0, z: 0 }, radius: 2000, elevationAt: cone(0, 0) });
  assert.equal(fire.count, 0);
  fire.dispose();
  assert.equal(scene.children.length, 0);
});
