import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFloodlights, aimFloodlights, setFloodlightNight, installFloodlight, markFloodlit, FLOODLIT_MAX } from '../src/materials/landmarkFloodlight.js';

const repere = (x, kind = 'church') => ({ x, y: 0, z: 0, top: 12, size: 10, short: 5, angle: 0, kind });

test('les repères éclairés sont les plus proches, bornés, sans les simples tours', () => {
  const f = createFloodlights(THREE);
  const slots = aimFloodlights(f, [repere(500), repere(5, 'tall'), ...Array.from({ length: FLOODLIT_MAX + 4 }, (_, i) => repere(10 * (i + 1), i % 2 ? 'castle' : 'ruin'))], { x: 0, z: 0 });
  assert.equal(slots.size, FLOODLIT_MAX);
  assert.equal(f.lit, FLOODLIT_MAX);
  assert.deepEqual([...slots.values()].slice(0, 3), [1, 2, 3]);
  assert.equal(f.box.value[0].x, 10);
  assert.ok(f.box.value.every((b) => b.x !== 5 && b.x !== 500));
});

test('de jour, la boucle du shader ne tourne pas', () => {
  const f = createFloodlights(THREE);
  aimFloodlights(f, [repere(0)], { x: 0, z: 0 });
  setFloodlightNight(f, 0.1);
  assert.equal(f.count.value, 0);
  setFloodlightNight(f, 1);
  assert.equal(f.count.value, 1);
  assert.ok(f.color.value.w > 0);
});

test('le patch du matériau trouve ses points d’ancrage', () => {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  installFloodlight(material, createFloodlights(THREE));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vFloodPoint =/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \+= uFloodColor/);
});

test('les sommets d’un repère portent le rang de sa boîte, les autres 0', () => {
  const colors = Uint16Array.from([1, 1, 0x1f, 2, 2, 0x40, 4, 4, 0x45, 5, 5, 0x5f]);
  markFloodlit(colors, colors.length, [3, 9, 7]);
  assert.deepEqual([colors[2], colors[5], colors[8], colors[11]], [0, 0x47, 0x47, 0x40]);
});
