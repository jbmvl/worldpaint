/* Les joints suivent le profil posé et l'abscisse du réseau, même après découpage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ajouterJointsVoirie } from '../src/layers/streetMasonry.js';
import { createProfileBuffer } from '../src/layers/ribbonGeometry.js';

function poser(debut, fin, cote = 1) {
  const tampon = createProfileBuffer();
  const profil = [0, 0.32, 0.32, 0.52].map((across) => ({ across: across * cote, up: 0 }));
  if (cote < 0) profil.reverse();
  for (const x of [debut, fin]) {
    for (const p of profil) tampon.positions.push(x, x * 0.04 + Math.abs(p.across) * 0.2, -p.across);
  }
  tampon.colors = new Array(tampon.positions.length).fill(1);
  const avant = tampon.positions.length;
  ajouterJointsVoirie(tampon, {
    debut: 0,
    points: [{ x: debut, z: 0, distance: debut }, { x: fin, z: 0, distance: fin }],
    profil, demiLargeur: 0,
    style: { gutterWidth: 0.32, gutterSlabLength: 0.6, kerbBlockLength: 1, jointWidth: 0.008 },
    couleur: [0.1, 0.1, 0.1],
  });
  return { tampon, joints: tampon.positions.slice(avant) };
}

test('les joints restent sur le caniveau incliné et dans son emprise, à droite comme à gauche', () => {
  for (const cote of [1, -1]) {
    const { tampon, joints } = poser(0.1, 2.9, cote);
    assert.ok(joints.length > 0);
    for (let i = 0; i < joints.length; i += 3) {
      const [x, y, z] = joints.slice(i, i + 3);
      assert.ok(x >= 0.1 && x <= 2.9);
      assert.ok(Math.abs(z) <= 0.52);
      assert.ok(Math.abs(y - (x * 0.04 + Math.abs(z) * 0.2 + 0.001)) < 1e-9);
    }
    assert.equal(tampon.colors.length, tampon.positions.length);
    assert.ok(tampon.indices.every((i) => i < tampon.positions.length / 3));
  }
});

test('le découpage d’une rue conserve la phase des joints des dalles et du béton', () => {
  const entier = poser(0.1, 2.9).joints;
  const morceau = poser(0.9, 2.2).joints;
  const limites = (positions) => {
    const valeurs = new Set();
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      if (x > 0.91 && x < 2.19) valeurs.add(x.toFixed(6));
    }
    return [...valeurs].sort();
  };
  // Les sommets de triangulation peuvent différer ; les limites de chaque joint restent fixes.
  const attendues = [0.996, 1.004, 1.196, 1.204, 1.796, 1.804, 1.996, 2.004];
  for (const x of attendues) {
    assert.ok(limites(entier).includes(x.toFixed(6)));
    assert.ok(limites(morceau).includes(x.toFixed(6)));
  }
  assert.deepEqual(poser(0.9, 2.2).tampon, poser(0.9, 2.2).tampon);
});
