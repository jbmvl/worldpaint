/*
 * La couche régionale : le vocabulaire tient, et la traduction aussi.
 * ------------------------------------------------------------------
 * Le fichier de régions est de la donnée écrite à la main ou par un modèle,
 * pas du code : il n'a d'autre garde-fou que ce fichier. Trois choses s'y
 * vérifient, et ce sont les trois seules qui ne se voient pas à l'œil :
 *
 * - **un mot inconnu est une erreur.** C'est le seul endroit où une invention
 *   se signale ; sans ça, `oak_forest` au lieu de `broadleaf_woodland` passe et
 *   le décor se peint générique en silence ;
 * - **tout mot du vocabulaire se traduit** en un concept que le moteur connaît
 *   réellement — une matière de `SURFACE_KINDS`, une culture de `CROP_KINDS`,
 *   une silhouette que le thème dessine. Une traduction qui désigne dans le
 *   vide est la même panne, déplacée d'un fichier ;
 * - **les mots non rendus s'inventorient.** Ce n'est pas une erreur, c'est la
 *   liste de ce qui reste à construire, et elle doit rester lisible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { REGIONS } from '../src/core/regions.js';
import { regionAt, regionById, MAX_REACH_KM } from '../src/core/region.js';
import {
  VOCABULARIES,
  MATRIX_KINDS,
  FARMING_KINDS,
  TREE_KINDS,
  BOUNDARY_STYLES,
  surfaceForMatrix,
  boundaryForMatrix,
  cropForFarming,
  essenceForTree,
  unknownWords,
  unsupportedWords,
} from '../src/core/regionInterpretation.js';
import { SURFACE_KINDS } from '../src/terrain/groundClassMap.js';
import { CROP_KINDS } from '../src/layers/furniturePlacement.js';
import { defaultTheme } from '../src/themes/default.js';

/** Les silhouettes que le thème dessine réellement, et pas une liste en dur. */
const ESSENCES = new Set(defaultTheme.forests.flatMap((forest) => forest.essences));

test('chaque dossier de région est complet et n’emploie que le vocabulaire', () => {
  const seen = new Set();
  for (const region of REGIONS) {
    const where = region.id || region.name;
    assert.ok(region.id && !seen.has(region.id), `identifiant manquant ou répété : ${where}`);
    seen.add(region.id);
    assert.ok(region.name, `nom manquant : ${where}`);

    assert.ok(Array.isArray(region.anchors) && region.anchors.length > 0, `sans ancre : ${where}`);
    for (const anchor of region.anchors) {
      assert.ok(Array.isArray(anchor) && anchor.length === 2, `ancre mal formée : ${where}`);
      const [lng, lat] = anchor;
      // [lng, lat], dans cet ordre : l'inversion est l'erreur de saisie qui
      // déplace une région d'un continent sans rien casser d'autre.
      assert.ok(lng >= -180 && lng <= 180, `longitude hors plage : ${where}`);
      assert.ok(lat >= -90 && lat <= 90, `latitude hors plage : ${where}`);
    }

    for (const field of Object.keys(VOCABULARIES)) {
      assert.ok(region[field] !== undefined, `champ ${field} manquant : ${where}`);
    }
    assert.deepEqual(unknownWords(region), [], `mot hors vocabulaire : ${where}`);

    assert.ok(region.building.length <= 2, `plus de deux mots de bâti : ${where}`);
    assert.ok(region.farming.length >= 1 && region.farming.length <= 4, `assolement : ${where}`);
    assert.ok(region.trees.length >= 2 && region.trees.length <= 4, `essences : ${where}`);
  }
});

test('tout mot du vocabulaire se traduit en un concept que le moteur connaît', () => {
  const surfaces = new Set(SURFACE_KINDS);
  const crops = new Set(CROP_KINDS);
  const boundaries = new Set(BOUNDARY_STYLES);

  for (const matrix of Object.keys(MATRIX_KINDS)) {
    assert.ok(surfaces.has(surfaceForMatrix(matrix)), `matière inconnue pour ${matrix}`);
    assert.ok(boundaries.has(boundaryForMatrix(matrix)), `limite inconnue pour ${matrix}`);
  }
  for (const word of Object.keys(FARMING_KINDS)) {
    assert.ok(crops.has(cropForFarming(word)), `culture inconnue pour ${word}`);
  }
  for (const word of Object.keys(TREE_KINDS)) {
    assert.ok(ESSENCES.has(essenceForTree(word)), `silhouette inconnue pour ${word}`);
  }
});

test('un mot inconnu ne traduit rien plutôt que n’importe quoi', () => {
  assert.equal(surfaceForMatrix('oak_forest'), null);
  assert.equal(boundaryForMatrix('oak_forest'), null);
  assert.equal(cropForFarming('beetroot'), null);
  assert.equal(essenceForTree('baobab'), null);
  assert.deepEqual(unknownWords({ matrix: 'oak_forest' }), [{ field: 'matrix', word: 'oak_forest' }]);
});

test('la région se choisit par l’ancre la plus proche, et se tait au-delà', () => {
  assert.equal(regionAt(-0.55, 47.47)?.id, 'anjou');
  assert.equal(regionAt(4.36, 43.84)?.id, 'languedoc');
  assert.equal(regionAt(-5.98, 37.39)?.id, 'campina_guadalquivir');
  assert.equal(regionAt(-3.6, 37.18)?.id, 'vega_granada');

  // Hors couverture : le décor se peint sans région plutôt qu'en breton.
  assert.equal(regionAt(13.4, 52.5), null);
  assert.equal(regionAt(-74.0, 40.7), null);
  assert.equal(regionAt(NaN, 47), null);

  // Pure : deux lectures du même point donnent le même dossier.
  assert.equal(regionAt(-0.55, 47.47), regionAt(-0.55, 47.47));
  assert.equal(regionById('anjou')?.name, 'Anjou');
  assert.equal(regionById('nulle-part'), null);
});

test('aucune ancre n’est isolée au point de laisser un trou', () => {
  // Chaque région doit être atteignable depuis sa propre ancre : une ancre
  // avalée par une voisine est une région qui n'existe plus, en silence.
  for (const region of REGIONS) {
    const [lng, lat] = region.anchors[0];
    assert.equal(regionAt(lng, lat)?.id, region.id, `région inatteignable : ${region.id}`);
  }
  assert.ok(MAX_REACH_KM > 0);
});

test('les mots non rendus sont inventoriés, pas oubliés', () => {
  const counts = new Map();
  for (const region of REGIONS) {
    for (const { field, word, note } of unsupportedWords(region)) {
      assert.ok(note, `mot non rendu sans raison : ${field}/${word}`);
      const key = `${field}/${word}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const lines = [...counts].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key} (${n})`);
  console.log(`  mots employés mais pas encore rendus : ${lines.join(', ') || 'aucun'}`);
});
