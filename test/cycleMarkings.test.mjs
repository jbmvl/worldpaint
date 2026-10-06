/* Le vélo se lit dans chaque sens autorisé, sans sortir de la piste. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleGlyph, appendMarkingSymbols } from '../src/layers/roadMarkings.js';
import { RoadNetwork } from '../src/layers/roadNetwork.js';
import { createProfileBuffer } from '../src/layers/ribbonGeometry.js';
import { defaultTheme } from '../src/themes/default.js';

const path = Array.from({ length: 21 }, (_, i) => ({ x: i * 5, z: 0, distance: i * 5 }));
const platform = path.map((p) => 12 + p.distance * 0.1);
const glyph = cycleGlyph();
const taille = glyph.flat().length * 3;
const moyenne = (valeurs) => valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
const coordonnees = (positions, axe) => positions.filter((_, i) => i % 3 === axe);

function marquer(sens, plage = path, largeur = 1.1) {
  const buffer = createProfileBuffer();
  const segment = { profile: 'cycleway', halfWidth: largeur, path,
    oneway: Array.isArray(sens) ? sens : path.map(() => sens) };
  const run = { path: plage, platform: plage.map((p) => 12 + p.distance * 0.1), head: -1, tail: -1 };
  const nombre = RoadNetwork.prototype._appendMarkings.call(
    { theme: defaultTheme }, buffer, segment, run, null, [1, 1, 1]
  );
  return { buffer, nombre };
}

test('le vélo peint se lit face au cycliste et tient dans une demi-piste', () => {
  const roueArriere = glyph.slice(0, 12).flat();
  const roueAvant = glyph.slice(12, 24).flat();
  assert.ok(Math.abs(moyenne(roueArriere.map((v) => v.along)) -
    moyenne(roueAvant.map((v) => v.along))) < 1e-9, 'les roues sont en travers de la marche');
  assert.ok(Math.abs(moyenne(roueArriere.map((v) => v.across)) -
    moyenne(roueAvant.map((v) => v.across))) > 0.4);
  assert.ok(glyph.slice(24).flat().some((v) => v.along > 0.7), 'le haut du dessin est devant le cycliste');
  assert.ok(glyph.flat().every((v) => Math.abs(v.across) < 0.55));
});

test('une piste à double sens porte deux vélos opposés dans leurs moitiés droites', () => {
  const { buffer, nombre } = marquer(0);
  assert.equal(nombre, 6, 'deux vélos à 26, 52 et 78 mètres');
  assert.equal(buffer.positions.length, taille * 6);
  const aller = buffer.positions.slice(0, taille);
  const retour = buffer.positions.slice(taille, taille * 2);
  assert.ok(coordonnees(aller, 2).every((z) => z > 0 && z < 1.1));
  assert.ok(coordonnees(retour, 2).every((z) => z < 0 && z > -1.1));
  for (let i = 0; i < taille; i += 3) {
    assert.ok(Math.abs(aller[i] + retour[i] - 52) < 1e-9, 'rotation autour de la même abscisse');
    assert.ok(Math.abs(aller[i + 2] + retour[i + 2]) < 1e-9);
  }
  for (let i = 0; i < buffer.positions.length; i += 3) {
    assert.ok(Math.abs(buffer.positions[i + 1] - 12 - buffer.positions[i] * 0.1 - 0.032) < 1e-9,
      'chaque sommet suit la pente de la plate-forme');
  }
});

test('une piste à sens unique porte un vélo centré dans le sens autorisé, même inverse', () => {
  const aller = marquer(1);
  const retour = marquer(-1);
  assert.equal(aller.nombre, 3);
  assert.equal(retour.nombre, 3);
  for (let i = 0; i < taille; i += 3) {
    assert.ok(Math.abs(aller.buffer.positions[i] + retour.buffer.positions[i] - 52) < 1e-9);
    assert.ok(Math.abs(aller.buffer.positions[i + 2] + retour.buffer.positions[i + 2]) < 1e-9);
    assert.ok(Math.abs(aller.buffer.positions[i + 2]) < 0.55, 'vélo centré');
  }
});

test('le sens des vélos suit le tronçon entier après découpe et reste dans la largeur disponible', () => {
  const sens = path.map((p) => p.distance < 40 ? 0 : p.distance < 70 ? 1 : -1);
  const entier = marquer(sens);
  const coupe = marquer(sens, path.slice(8));
  assert.equal(entier.nombre, 4);
  assert.equal(coupe.nombre, 2);
  assert.deepEqual(coupe.buffer.positions, entier.buffer.positions.slice(2 * taille));
  assert.equal(marquer(0, path, 0.6).nombre, 0, 'deux vélos ne tiennent pas côte à côte');
  assert.equal(marquer(1, path, 0.6).nombre, 3, 'un vélo centré tient encore');
  const buffer = createProfileBuffer();
  appendMarkingSymbols(buffer, { path: path.slice(5, 6), decks: platform.slice(5, 6),
    polygons: glyph, halfWidth: 1.1, color: [1, 1, 1] });
  assert.equal(buffer.positions.length, 0, 'aucun vélo tronqué en bout de plage');
});
