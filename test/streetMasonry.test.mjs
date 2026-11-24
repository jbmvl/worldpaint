/* Les joints sont peints par la matière : repères par sommet, phase du réseau, aucun triangle de plus. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_JOINT, abscissesVoirie, completerReperes, peindreJoints, reperesJoints } from '../src/layers/streetMasonry.js';
import { createProfileStore, drainProfileBuffer } from '../src/layers/facetBuffers.js';
import { STREET_LOOK } from '../src/themes/default.js';

const profil = [
  { across: 4, up: 0 }, { across: 4.295, up: 0 }, { across: 4.32, up: 0 }, { across: 4.52, up: 0 }, { across: 4.52, up: -0.2 },
];

test('les repères suivent l’abscisse du réseau, la distance à la rive et la hauteur de chaque sommet', () => {
  const points = [{ x: 0, z: 0, distance: 120.5 }, { x: 3, z: 4, distance: 125.5 }];
  const reperes = [];
  reperesJoints(reperes, { points, profil, demiLargeur: 4 });
  assert.equal(reperes.length, points.length * profil.length * 3);
  // Ligne par ligne, colonne par colonne, comme `appendProfile`.
  assert.deepEqual(reperes.slice(0, 3), [120.5, 0, 0]);
  assert.ok(Math.abs(reperes[3 * 3 + 1] - 0.52) < 1e-9);
  assert.deepEqual(reperes.slice(4 * 3, 4 * 3 + 3).map((v) => +v.toFixed(6)), [120.5, 0.52, -0.2]);
  assert.equal(reperes[profil.length * 3], 125.5);
  // Une rive gauche (abscisses négatives) donne les mêmes distances.
  const gauche = [];
  reperesJoints(gauche, { points, profil: profil.map((p) => ({ ...p, across: -p.across })), demiLargeur: 4 });
  assert.deepEqual(gauche, reperes);
});

test('un coin de rue sans abscisse s’ancre à sa position quantifiée : un morceau garde la phase du tout', () => {
  const tout = abscissesVoirie([{ x: 10.04, z: 2.01 }, { x: 13.04, z: 6.01 }, { x: 16.04, z: 10.01 }]);
  assert.deepEqual(tout.map((v) => +v.toFixed(6)), [12, 17, 22]);
  const reseau = abscissesVoirie([{ x: 0, z: 0, distance: 40 }, { x: 1, z: 0 }]);
  assert.equal(reseau[0], 40);
});

test('la réserve verse les repères avec les sommets, et le repère neutre là où il n’y en a pas', () => {
  const store = createProfileStore(null, { marks: { attribute: 'streetJoint', fallback: NO_JOINT } });
  // Un comblement sans repère, puis une section de bordure.
  const buffer = { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], colors: [0, 0, 0, 0, 0, 0, 0, 0, 0], indices: [0, 1, 2], marks: [] };
  completerReperes(buffer.marks, 3);
  buffer.positions.push(2, 0, 0, 3, 0, 0);
  buffer.colors.push(0, 0, 0, 0, 0, 0);
  buffer.marks.push(7, 0.1, 0, 7, 0.4, 0);
  drainProfileBuffer(store, buffer);
  // Un lot sans repère du tout.
  drainProfileBuffer(store, { positions: [5, 0, 0], colors: [0, 0, 0], indices: [], marks: [] });
  const marks = Array.from(store.marks.data.subarray(0, store.marks.length)).map((v) => +v.toFixed(6));
  assert.deepEqual(marks, [...NO_JOINT, ...NO_JOINT, ...NO_JOINT, 7, 0.1, 0, 7, 0.4, 0, ...NO_JOINT]);
  assert.equal(store.marks.length, store.positions.length);
  assert.equal(store.markAttribute, 'streetJoint');
  // Sans repères demandés, la réserve n'en porte pas.
  assert.equal(createProfileStore().marks, undefined);
});

test('la matière peint les joints sur les faces au niveau du support, à leur largeur vraie', () => {
  const material = { };
  peindreJoints(material, STREET_LOOK);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n}',
  };
  material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('attribute vec3 streetJoint;'));
  assert.ok(shader.vertexShader.includes('vStreetJoint = streetJoint;'));
  assert.ok(shader.fragmentShader.includes('fwidth(vStreetJoint.x)'));
  assert.ok(shader.fragmentShader.indexOf('#include <color_fragment>') < shader.fragmentShader.indexOf('jointCover'));
  assert.deepEqual(shader.uniforms.uJointStyle.value, [STREET_LOOK.gutterWidth, STREET_LOOK.gutterSlabLength, STREET_LOOK.kerbBlockLength, STREET_LOOK.jointWidth]);
  assert.equal(material.customProgramCacheKey(), 'street-joints');
});
