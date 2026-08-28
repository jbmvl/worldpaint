/*
 * La surface publique.
 * ---------------------
 * Ce fichier ne teste pas du paysage : il teste le contrat. Un symbole qui
 * disparaît de `index.js` casse une application sans qu'aucun test de géométrie
 * ne bouge, et c'est exactement le genre de rupture qu'on ne voit qu'une fois
 * publiée.
 *
 * `World` est monté ici sur un compositeur en carton : la façade doit déléguer,
 * rien d'autre, et cela se vérifie sans WebGL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/index.js';
import { World, createWorld, DEFAULT_VIEW } from '../src/world.js';

/** Ce qu'une application a le droit d'attendre à la version 0.1. */
const CONTRACT = [
  'createWorld',
  'World',
  'DEFAULT_VIEW',
  'WorldComposer',
  'WORLD_ATTRIBUTION',
  'ElevationField',
  'TERRARIUM_URL',
  'VectorTileSource',
  'SceneEnvironment',
  'DEFAULT_SKY_PALETTE',
  'lngLatToTile',
  'tileSizeMeters',
  'createLocalFrame',
  'collectSceneLabels',
  'forestTypeAt',
  'ROAD_LIFT_M',
  'createGlowGeometry',
  'createGlowMaterial',
];

test('la surface publique expose tout ce qui est annoncé', () => {
  for (const name of CONTRACT) {
    assert.ok(api[name] !== undefined, `export manquant : ${name}`);
  }
});

test('la bulle par défaut est un bloc impair, une finesse par anneau', () => {
  assert.equal(DEFAULT_VIEW.blockSize % 2, 1, 'un bloc pair n’a pas de tuile centrale');
  assert.equal(DEFAULT_VIEW.segmentsByRing.length, Math.ceil(DEFAULT_VIEW.blockSize / 2) + 1);
  const rings = DEFAULT_VIEW.segmentsByRing;
  for (let i = 1; i < rings.length; i++) {
    assert.ok(rings[i] <= rings[i - 1], 'la maille doit se relâcher en s’éloignant');
  }
});

test('createWorld refuse de monter sans scène ni three', () => {
  assert.throws(() => createWorld({ scene: {} }), /THREE/);
  assert.throws(() => createWorld({ THREE: {} }), /scene/);
});

test('createWorld exige la classe Sky dès qu’un ciel est demandé', () => {
  // On n’arrive jamais jusqu’au ciel sans scène : le contrôle est donc lu ici
  // à travers le message, pas à travers un montage complet.
  assert.throws(() => createWorld({ THREE: {}, scene: {}, sky: {} }), /Sky/);
});

/** Compositeur en carton : il note ce qu'on lui demande. */
function fakeComposer() {
  const calls = [];
  return {
    calls,
    frame: 'frame',
    bubble: 'bubble',
    groundClass: 'groundClass',
    setCenter: (...a) => (calls.push(['setCenter', ...a]), true),
    refresh: (...a) => (calls.push(['refresh', ...a]), true),
    advance: (...a) => calls.push(['advance', ...a]),
    setNight: (...a) => calls.push(['setNight', ...a]),
    setWind: (...a) => calls.push(['setWind', ...a]),
    setWetness: (...a) => calls.push(['setWetness', ...a]),
    setAerialLight: (...a) => calls.push(['setAerialLight', ...a]),
    dispose: () => calls.push(['dispose']),
  };
}

test('la façade délègue sans rien ajouter', () => {
  const composer = fakeComposer();
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  assert.equal(world.frame, 'frame');
  assert.equal(world.bubble, 'bubble');
  assert.equal(world.groundClass, 'groundClass');

  world.setCenter(2.35, 48.85);
  world.refresh(2.35, 48.85, { force: true });
  world.advance(0.016, { x: 1, y: 2, z: 3 });

  assert.deepEqual(composer.calls, [
    ['setCenter', 2.35, 48.85],
    ['refresh', 2.35, 48.85, { force: true }],
    ['advance', 0.016, { x: 1, y: 2, z: 3 }],
  ]);
});

test('sans ciel, updateSky ne rend rien et n’allume rien', () => {
  const composer = fakeComposer();
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });
  assert.equal(world.updateSky({ camera: {}, date: new Date(), lng: 0, lat: 0 }), null);
  assert.equal(world.clearColor, null);
  assert.equal(composer.calls.length, 0, 'aucun décor ne doit basculer en nuit sans ciel');
});

test('avec un ciel, updateSky recale le dôme avant de propager la nuit', () => {
  const composer = fakeComposer();
  const order = [];
  const environment = {
    nightMix: 0.4,
    wetness: 0.25,
    wind: { amplitude: 1, speed: 1 },
    aerialLight: { intensity: 0.5 },
    weather: 'météo',
    clearColor: 'bleu',
    followCamera: () => order.push('followCamera'),
    update: (o) => order.push(['update', o.lat, o.lng]),
    followShadow: (p) => order.push(['followShadow', p]),
    dispose: () => order.push('dispose'),
  };
  const world = new World({ composer, environment, elevation: null, ownsElevation: false });

  const out = world.updateSky({
    camera: { position: { x: 9, y: 9, z: 9 } },
    date: new Date(0),
    lng: 2,
    lat: 48,
    shadowAt: { x: 1, y: 0, z: 2 },
  });

  assert.deepEqual(out, {
    nightMix: 0.4,
    wetness: 0.25,
    weather: 'météo',
    clearColor: 'bleu',
  });
  assert.deepEqual(order, [
    'followCamera',
    ['update', 48, 2],
    ['followShadow', { x: 1, y: 0, z: 2 }],
  ]);
  // La boîte d'ombre se pose **après** que le décor a reçu l'ambiance : une
  // image où la route est trempée et le ciel encore dégagé n'existe jamais.
  assert.deepEqual(composer.calls, [
    ['setNight', 0.4],
    ['setWind', { amplitude: 1, speed: 1 }],
    ['setWetness', 0.25],
    ['setAerialLight', { intensity: 0.5 }],
  ]);
});

test('sans point d’ombre, la boîte se pose sur la caméra', () => {
  const composer = fakeComposer();
  let shadow = null;
  const environment = {
    nightMix: 0,
    wetness: 0,
    wind: { amplitude: 1, speed: 1 },
    weather: null,
    clearColor: 'gris',
    followCamera: () => {},
    update: () => {},
    followShadow: (p) => (shadow = p),
  };
  const world = new World({ composer, environment, elevation: null, ownsElevation: false });
  const position = { x: 5, y: 6, z: 7 };
  world.updateSky({ camera: { position }, date: new Date(0), lng: 0, lat: 0 });
  assert.equal(shadow, position);
});

test('dispose ne libère le relief que s’il nous appartient', () => {
  const log = [];
  const field = { dispose: () => log.push('elevation') };

  const borrowed = new World({
    composer: { dispose: () => log.push('composer') },
    environment: null,
    elevation: field,
    ownsElevation: false,
  });
  borrowed.dispose();
  borrowed.dispose(); // idempotent
  assert.deepEqual(log, ['composer']);

  log.length = 0;
  const owned = new World({
    composer: { dispose: () => log.push('composer') },
    environment: { dispose: () => log.push('environment') },
    elevation: field,
    ownsElevation: true,
  });
  owned.dispose();
  assert.deepEqual(log, ['environment', 'composer', 'elevation']);
});

/*
 * Le thème.
 * ---------
 * Deux choses seulement, et elles sont l'une et l'autre des garde-fous de
 * frontière plutôt que des tests de rendu : la vue groupée doit désigner les
 * mêmes objets que les constantes (sinon un artiste modifie une copie et ne
 * voit rien changer), et les budgets ne doivent pas y entrer par la porte de
 * derrière (un thème n'a pas à pouvoir faire tomber la fréquence d'images).
 */

import { defaultTheme } from '../src/themes/default.js';
import {
  TERRAIN_LOOK,
  TOWN_PALETTES,
  FOREST_TYPES,
  CROP_LOOK,
  ROAD_PROFILES,
  FURNITURE_COLORS,
} from '../src/themes/default.js';

test('la vue groupée du thème ne recopie rien', () => {
  assert.equal(defaultTheme.terrain, TERRAIN_LOOK);
  assert.equal(defaultTheme.towns, TOWN_PALETTES);
  assert.equal(defaultTheme.forests, FOREST_TYPES);
  assert.equal(defaultTheme.crops, CROP_LOOK);
  assert.equal(defaultTheme.roads.profiles, ROAD_PROFILES);
  assert.equal(defaultTheme.furniture.colors, FURNITURE_COLORS);
});

test('le thème ne porte ni plafond ni portée', () => {
  const flat = JSON.stringify(defaultTheme);
  for (const forbidden of ['MAX_COUNT', 'RADIUS_M', 'REBUILD_M', 'limits', 'maxCount']) {
    assert.ok(!flat.includes(forbidden), `budget dans le thème : ${forbidden}`);
  }
});

test('chaque palette de bourg propose deux ou trois formes de toit', () => {
  // La règle est du moteur, le nombre est de la composition : un bourg qui
  // offre les cinq formes cesse d'être un bourg et devient un catalogue.
  for (const palette of TOWN_PALETTES) {
    assert.ok(palette.roofShapes.length >= 2 && palette.roofShapes.length <= 3, palette.name);
    assert.ok(palette.walls.length >= 2, palette.name);
    assert.ok(palette.roofs.length >= 2, palette.name);
  }
});
