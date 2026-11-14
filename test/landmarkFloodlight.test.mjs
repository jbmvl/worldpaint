import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFloodlights, aimFloodlights, setFloodlightNight, installFloodlight, markFloodlit, FLOODLIT_MAX } from '../src/materials/landmarkFloodlight.js';

const repere = (x, kind = 'church') => ({ x, y: 0, z: 0, top: 12, size: 10, short: 5, angle: 0, kind });

test('les repères éclairés sont les plus proches, bornés, sans les simples tours', () => {
  const f = createFloodlights(THREE);
  const lit = aimFloodlights(f, [repere(500), repere(5, 'tall'), ...Array.from({ length: 12 }, (_, i) => repere(10 * (i + 1), i % 2 ? 'castle' : 'ruin'))], { x: 0, z: 0 });
  assert.equal(lit, FLOODLIT_MAX);
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

test('seuls les sommets des repères portent le bit, les autres le perdent', () => {
  const colors = Uint16Array.from([1, 1, 1, 2, 2, 3, 4, 4, 4, 5, 5, 5]);
  markFloodlit(colors, colors.length, [3, 9]);
  assert.deepEqual([colors[2], colors[5], colors[8], colors[11]], [0, 3, 5, 4]);
});
