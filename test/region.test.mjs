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
import { regionAt, regionById, regionWithWord, MAX_REACH_KM } from '../src/core/region.js';
import {
  VOCABULARIES,
  MATRIX_KINDS,
  FARMING_KINDS,
  TREE_KINDS,
  BOUNDARY_STYLES,
  surfaceForMatrix,
  plantedSurfaceForMatrix,
  gapSurfaceForMatrix,
  boundaryForMatrix,
  cropForFarming,
  unknownWords,
  unsupportedWords,
} from '../src/core/regionInterpretation.js';
import { SURFACE_KINDS } from '../src/terrain/groundClassMap.js';
import { CROP_KINDS } from '../src/layers/furniturePlacement.js';
import { defaultTheme } from '../src/themes/default.js';

/** Les peuplements que le thème décrit réellement, et pas une liste en dur. */
const STANDS = new Set(defaultTheme.forests.map((forest) => forest.name));

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

    assert.equal(typeof region.building, 'string', `une seule palette de bâti : ${where}`);
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
    const entry = defaultTheme.trees.species[word];
    assert.ok(entry, `${word} : aucune entrée dans theme.trees.species`);
    assert.ok(entry.stand === undefined || STANDS.has(entry.stand), `${word} : peuplement inconnu ${entry.stand}`);
    assert.ok(entry.variants.length >= 1, `${word} : aucune silhouette`);
    for (const index of entry.variants) assert.ok(defaultTheme.trees.variants[index], `${word} : silhouette ${index} absente`);
    assert.ok(entry.planted?.height > 0 && entry.planted?.aspect > 0, `${word} : arbre planté sans cotes`);
  }
});

test('un mot inconnu ne traduit rien plutôt que n’importe quoi', () => {
  assert.equal(surfaceForMatrix('oak_forest'), null);
  assert.equal(boundaryForMatrix('oak_forest'), null);
  assert.equal(cropForFarming('beetroot'), null);
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

test('les pays voisins se partagent leurs lieux de part et d’autre de la frontière', () => {
  const lieux = [
    [-9.14, 38.72, 'oeste'], [-8.61, 41.15, 'minho'], [-7.93, 37.02, 'litoral_algarve'],
    [-16.92, 32.65, 'madeira'], [-25.67, 37.74, 'acores'],
    [12.5, 41.9, 'campagna_romana'], [12.33, 45.44, 'laguna_veneta'],
    [13.36, 38.12, 'conca_oro'], [9.11, 39.22, 'campidano'], [11.34, 44.49, 'pianura_emiliana'],
    [14.51, 46.05, 'bassin_ljubljana'], [16.44, 43.51, 'dalmatie_centrale'],
    [17.81, 43.34, 'basse_herzegovine'], [19.85, 45.26, 'backa'], [21.16, 42.66, 'plaine_kosovo'],
    [19.26, 42.44, 'zeta_skadar'], [21.43, 42.0, 'bassin_skopje'],
    // Les voisins déjà écrits gardent leurs villes de frontière.
    [7.27, 43.7, 'maures'], [6.64, 44.9, 'alpes_sud'], [-6.97, 38.88, 'dehesa_extremena'],
    [-8.72, 42.24, 'rias_baixas'], [9.16, 41.42, 'corse'], [21.23, 45.75, 'plaine_de_louest_roumain'],
    [18.23, 46.07, 'transdanubie'],
  ];
  for (const [lng, lat, id] of lieux) assert.equal(regionAt(lng, lat)?.id, id, `${lng}, ${lat}`);
});

test('le semis du bâti suit la mesure, pays par pays', () => {
  const seme = (id) => regionById(id).sparse?.includes('buildings') ?? false;
  for (const id of ['minho', 'chianti', 'salento', 'kras', 'lika', 'bosnie_centrale', 'sumadija', 'plaine_kosovo', 'durmitor', 'pelagonie']) {
    assert.equal(seme(id), true, id);
  }
  for (const id of ['pianura_lombarda', 'dolomiti', 'liguria', 'anjou']) assert.equal(seme(id), false, id);
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

test('un mot imposé ne change que son champ, le reste du pays tient', () => {
  const base = REGIONS[0];
  const worded = regionWithWord(base, 'matrix', 'broadleaf_woodland');
  assert.equal(worded.matrix, 'broadleaf_woodland');
  assert.equal(worded.stone, base.stone);
  assert.deepEqual(worded.trees, base.trees);
});

test('un mot imposé à un champ à liste en devient le seul tirage', () => {
  const worded = regionWithWord(REGIONS[0], 'trees', 'larch');
  assert.deepEqual(worded.trees, ['larch']);
});

test('un mot hors du vocabulaire fermé n’est pas imposé', () => {
  assert.equal(regionWithWord(REGIONS[0], 'matrix', 'jungle_imaginaire'), null);
  assert.equal(regionWithWord(REGIONS[0], 'couleur', 'oak'), null);
  assert.equal(regionWithWord(null, 'matrix', 'marsh'), null);
});

test('une matrice boisée se plante dans la carte du sol et ne laisse pas sa matière aux trous', () => {
  for (const matrix of ['broadleaf_woodland', 'conifer_forest', 'boreal_taiga']) {
    assert.equal(plantedSurfaceForMatrix(matrix), 'wood', matrix);
    assert.equal(gapSurfaceForMatrix(matrix), null, matrix);
  }
  assert.equal(plantedSurfaceForMatrix('hedgerow_meadow'), null);
  assert.equal(gapSurfaceForMatrix('hedgerow_meadow'), 'grass');
  assert.equal(gapSurfaceForMatrix('inconnu'), null);
});
