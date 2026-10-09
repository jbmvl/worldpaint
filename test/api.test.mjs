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
import { defaultTheme } from '../src/themes/default.js';
import { World, createWorld, DEFAULT_VIEW } from '../src/world.js';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { publishFountains } from '../src/layers/furniture/pointsOfInterest.js';

/** Ce qu'une application a le droit d'attendre à la version 0.1. */
const CONTRACT = [
  'createWorld',
  'World',
  'DEFAULT_VIEW',
  'WorldComposer',
  'WORLD_ATTRIBUTION',
  'ElevationField',
  'MAPTILER_TERRAIN_URL',
  'VectorTileSource',
  'SceneEnvironment',
  'DEFAULT_SKY_PALETTE',
  'SKY_LAYER',
  'lngLatToTile',
  'tileSizeMeters',
  'createLocalFrame',
  'collectSceneLabels',
  'forestTypeAt',
  'ROAD_LIFT_M',
  'TERRACE_SEAT_HEIGHT_M',
  'TERRACE_TABLE_HEIGHT_M',
  'createGlowGeometry',
  'createGlowMaterial',
  'createBalloonGeometry',
  'balloonRadiusAt',
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
    setVectorConfig: (...a) => (calls.push(['setVectorConfig', ...a]), true),
    refresh: (...a) => (calls.push(['refresh', ...a]), true),
    advance: (...a) => calls.push(['advance', ...a]),
    setNight: (...a) => calls.push(['setNight', ...a]),
    setWind: (...a) => calls.push(['setWind', ...a]),
    setWetness: (...a) => calls.push(['setWetness', ...a]),
    setWaterLight: (...a) => calls.push(['setWaterLight', ...a]),
    dispose: () => calls.push(['dispose']),
  };
}

test('la façade délègue sans rien ajouter', () => {
  const composer = fakeComposer();
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  assert.equal(world.frame, 'frame');
  assert.equal(world.bubble, 'bubble');
  assert.equal(world.groundClass, 'groundClass');

  world.setVector({ tiles: ['t'] });
  world.setCenter(2.35, 48.85);
  world.refresh(2.35, 48.85, { force: true });
  world.advance(0.016, { x: 1, y: 2, z: 3 });

  assert.deepEqual(composer.calls, [
    ['setVectorConfig', { tiles: ['t'] }],
    ['setCenter', 2.35, 48.85],
    ['refresh', 2.35, 48.85, { force: true }],
    ['advance', 0.016, { x: 1, y: 2, z: 3 }],
  ]);
});

test('roadPositionAt suit la plate-forme d’une chaussée, le terrain sinon', () => {
  // Repère jouet où 1° vaut 1 m : suffisant pour vérifier la délégation,
  // sans reconstruire un vrai repère local.
  const bubble = {
    frame: { toLocal: (lng, lat) => ({ x: lng, z: lat }) },
    toScenePosition: (lng, lat, height) => ({ x: lng, y: 1 + height, z: lat }),
  };
  const segment = {
    halfWidth: 2.5,
    path: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
    platform: new Float32Array([5, 5]),
  };
  const composer = fakeComposer();
  composer.bubble = bubble;
  composer.roads = { elevationIndex: new RoadIndex([segment], { includeWorks: true }) };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const onRoad = world.roadPositionAt(5, 0, api.ROAD_LIFT_M);
  assert.ok(Math.abs(onRoad.y - (5 + api.ROAD_LIFT_M)) < 1e-9, 'sur la chaussée, la plate-forme l’emporte sur le terrain');

  const offRoad = world.roadPositionAt(50, 50, api.ROAD_LIFT_M);
  assert.ok(Math.abs(offRoad.y - (1 + api.ROAD_LIFT_M)) < 1e-9, 'hors chaussée, retombe sur le terrain');
});

test('roadsideAt pose au bord, sur la plate-forme si elle y est encore, au terrain sinon', () => {
  const bubble = { frame: { toLocal: (lng, lat) => ({ x: lng, z: lat }) } };
  const segment = {
    profile: 'minor',
    halfWidth: 2.5,
    path: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
    platform: new Float32Array([5, 5]),
  };
  const composer = fakeComposer();
  composer.bubble = bubble;
  composer.roads = { elevationIndex: new RoadIndex([segment], { includeWorks: true }) };
  composer.groundElevationAt = () => 1;
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const edge = world.roadsideAt(5, 0, { side: 1, aheadLng: 6, aheadLat: 0, heightAboveGround: 2 });
  assert.equal(edge.z, 2.5, 'à droite en allant vers l’est : au sud');
  assert.equal(edge.y, 7, 'au bord, la plate-forme porte encore');
  assert.equal(edge.profile, 'minor');

  const far = world.roadsideAt(5, 0, { side: -1, offset: 10 });
  assert.equal(far.y, 1, 'loin du bord, le terrain');
  assert.equal(world.roadsideAt(5, 100), null, 'hors de portée, rien');
});

test('roadLaneAt rend la section en travers, axe en lng/lat', () => {
  const frame = { toLocal: (lng, lat) => ({ x: lng, z: lat }), toLngLat: (x, z) => ({ lng: x, lat: z }) };
  const segment = {
    profile: 'major',
    halfWidth: 4.25,
    path: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
    platform: new Float32Array([0, 0]),
  };
  const composer = fakeComposer();
  composer.bubble = { frame };
  composer.roads = { elevationIndex: new RoadIndex([segment], { includeWorks: true }) };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const lane = world.roadLaneAt(5, 1, { aheadLng: 6, aheadLat: 1 });
  assert.deepEqual(lane.axis, { lng: 5, lat: 0 });
  assert.equal(lane.offsetM, 1, 'au sud en allant vers l’est : à droite');
  assert.equal(lane.divided, true);
  assert.equal(lane.laneWidth, 4.25);
  assert.ok(Math.abs(lane.own.outer - (lane.usable - 1)) < 1e-9, 'plages depuis le point demandé');
  assert.equal(lane.opposite, null);
  assert.equal(world.roadLaneAt(5, 100), null, 'hors de portée, rien');
});

test('terracesNear rend les tables à portée, de la plus proche à la plus lointaine', () => {
  const frame = { toLocal: (lng, lat) => ({ x: lng, z: lat }) };
  const table = (x, z) => ({ x, y: 2, z, facing: { x: 0, z: 1 }, kind: 'cafe', chairs: [] });
  const composer = fakeComposer();
  composer.bubble = { frame };
  composer.buildings = { _frame: frame, terraces: [table(30, 0), table(5, 0), table(100, 0)] };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const near = world.terracesNear(0, 0, 40);
  assert.deepEqual(near.map((t) => t.distanceM), [5, 30]);
  assert.equal(near[0].kind, 'cafe');

  composer.buildings._frame = { toLocal: frame.toLocal };
  assert.deepEqual(world.terracesNear(0, 0, 40), [], 'bâti d’un autre repère : rien');
});

test('shopfrontNear rend le pied de mur de la devanture la plus proche', () => {
  const frame = { toLocal: (lng, lat) => ({ x: lng, z: lat }) };
  const front = (ax, bx, z, kind) => ({ a: { x: ax, z }, b: { x: bx, z }, facing: { x: 0, z: 1 }, y: 3, kind });
  const composer = fakeComposer();
  composer.bubble = { frame };
  composer.buildings = { _frame: frame, shopfronts: [front(0, 10, 0, 'bakery'), front(0, 10, -20, 'cafe')] };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const near = world.shopfrontNear(4, 3);
  assert.equal(near.kind, 'bakery');
  assert.deepEqual([near.x, near.y, near.z, near.distanceM, near.along], [4, 3, 0, 3, 4]);
  assert.deepEqual(near.tangent, { x: 1, z: 0 });
  assert.deepEqual(near.windows, [], 'sans fenêtre relevée : liste vide');
  assert.equal(world.shopfrontNear(14, 0).x, 10, 'borné au pan');
  assert.equal(world.shopfrontNear(4, 100), null, 'hors de portée');
  composer.buildings._frame = { toLocal: frame.toLocal };
  assert.equal(world.shopfrontNear(4, 3), null, 'bâti d’un autre repère : rien');
});

test('fountainsNear rend les fontaines à portée, de la plus proche à la plus lointaine', () => {
  const frame = { toLocal: (lng, lat) => ({ x: lng, z: lat }) };
  const composer = fakeComposer();
  composer.bubble = { frame };
  composer.furniture = {
    _frame: frame,
    fountains: [30, 5, 100].map((x) => ({ x, y: 1, z: 0, kind: 'fountain', radiusM: 1.25 })),
  };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });

  const near = world.fountainsNear(0, 0, 40);
  assert.deepEqual(near.map((f) => f.distanceM), [5, 30]);
  assert.equal(near[0].radiusM, 1.25);

  composer.furniture._frame = { toLocal: frame.toLocal };
  assert.deepEqual(world.fountainsNear(0, 0, 40), [], 'mobilier d’un autre repère : rien');
});

test('publishFountains reprend fontaines et robinet de cimetière, rayon mis à l’échelle', () => {
  const placements = new Map([
    ['fountain', [{ x: 1, y: 2, z: 3, scale: 2 }]],
    ['fountainWallace', [{ x: 4, y: 5, z: 6 }]],
    ['cemeteryTap', [{ x: 7, y: 8, z: 9 }]],
    ['busShelter', [{ x: 9, y: 9, z: 9 }]],
  ]);
  const found = publishFountains(placements);
  assert.deepEqual(found.map((f) => [f.kind, f.radiusM]), [['fountain', 2.5], ['fountainWallace', 0.42], ['cemeteryTap', 0.45]]);
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
    weather: 'météo',
    clearColor: 'bleu',
    waterLight: 'reflet du ciel',
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
    // `setWind` reçoit aussi la météo résolue : c'est elle qui porte la
    // direction du vent, dont le feuillage n'a pas besoin mais les éoliennes
    // et les oiseaux si — voir `WorldComposer.setWind`.
    ['setWind', { amplitude: 1, speed: 1 }, 'météo'],
    ['setWetness', 0.25],
    ['setWaterLight', 'reflet du ciel'],
  ]);
});

test('l’air prend la couleur du pays, sauf si l’application en a choisi une', () => {
  // La palette d'ambiance est la couleur la plus déterminante du décor. Elle
  // suit donc le pays — mais jamais contre le choix explicite d'une
  // application, ici ou au montage.
  const palettes = [];
  const environment = {
    nightMix: 0,
    wetness: 0,
    wind: { amplitude: 1, speed: 1 },
    weather: null,
    clearColor: null,
    followCamera: () => {},
    update: (o) => palettes.push(o.palette),
    followShadow: () => {},
    dispose: () => {},
  };
  const camera = { position: { x: 0, y: 0, z: 0 } };
  const shot = { camera, date: new Date(0), lng: 2, lat: 48 };

  const composer = fakeComposer();
  composer.landscape = {
    region: { id: 'tabernas', matrix: 'desert_stone' },
    relief: { elevation: 300, slope: 0 },
  };
  const world = new World({ composer, environment, elevation: null, ownsElevation: false });
  world.updateSky(shot);
  assert.equal(palettes[0].fog, defaultTheme.sky.variants.find((v) => v.name === 'poussière').fog);

  // Deux images de suite au même endroit ne recomposent pas la palette : elle
  // change tous les deux kilomètres, pas soixante fois par seconde.
  world.updateSky(shot);
  assert.equal(palettes[1], palettes[0], 'la palette est mémorisée par matrice');

  // Une palette passée à l'image l'emporte sur le pays.
  world.updateSky({ ...shot, palette: 'la mienne' });
  assert.equal(palettes[2], 'la mienne');

  // Un monde monté avec sa propre palette n'en reçoit jamais d'autre : le pays
  // ne rend rien, et l'environnement garde la sienne.
  const fixe = new World({
    composer,
    environment,
    elevation: null,
    ownsElevation: false,
    skyFollowsRegion: false,
  });
  fixe.updateSky(shot);
  assert.equal(palettes[3], undefined);

  // Hors de toute région, rien non plus.
  composer.landscape = null;
  world.updateSky(shot);
  assert.equal(palettes[4], undefined);
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

import {
  TERRAIN_LOOK,
  TOWN_PALETTES,
  FOREST_TYPES,
  CROP_LOOK,
  ROAD_PROFILES,
  WORKS_STYLES,
  FURNITURE_COLORS,
} from '../src/themes/default.js';

test('la vue groupée du thème ne recopie rien', () => {
  assert.equal(defaultTheme.terrain, TERRAIN_LOOK);
  assert.equal(defaultTheme.towns, TOWN_PALETTES);
  assert.equal(defaultTheme.forests, FOREST_TYPES);
  assert.equal(defaultTheme.crops, CROP_LOOK);
  assert.equal(defaultTheme.roads.profiles, ROAD_PROFILES);
  assert.equal(defaultTheme.works, WORKS_STYLES);
  assert.equal(defaultTheme.furniture.colors, FURNITURE_COLORS);
});

test('le thème ne porte ni plafond ni portée', () => {
  const flat = JSON.stringify(defaultTheme);
  for (const forbidden of ['MAX_COUNT', 'RADIUS_M', 'REBUILD_M', 'limits', 'maxCount']) {
    assert.ok(!flat.includes(forbidden), `budget dans le thème : ${forbidden}`);
  }
});

test('chaque famille d’ouvrage sait bâtir un pont entier et une tête de tunnel', () => {
  // Un thème incomplet ne se voit pas au premier coup d'œil : il se voit à un
  // tablier sans corniche ou à une pile sans couleur, cent mètres plus loin.
  for (const style of WORKS_STYLES) {
    for (const key of ['deck', 'pier', 'abutment', 'parapet', 'portal']) {
      assert.ok(style[key], `${style.name} : tranche ${key}`);
    }
    assert.ok(style.deck.thickness > 0 && style.deck.overhang > 0, style.name);
    assert.ok(style.pier.spacing > 0 && style.pier.span > 0 && style.pier.span <= 1, style.name);
    assert.ok(style.parapet.height > 0.7, `${style.name} : un parapet protège vraiment`);
    assert.ok(['wall', 'rail'].includes(style.parapet.kind), style.name);
  }
});

test('chaque palette de bourg propose deux ou trois formes de toit', () => {
  // La règle est du moteur, le nombre est de la composition : un bourg qui
  // offre les cinq formes cesse d'être un bourg et devient un catalogue.
  for (const [name, palette] of Object.entries(TOWN_PALETTES)) {
    assert.ok(palette.roofShapes.length >= 2 && palette.roofShapes.length <= 3, name);
    for (const key of ['wall', 'roof', 'shutter']) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${name} : un seul ton de ${key}`);
    }
  }
});

test('les tuiles vectorielles se branchent après coup, une seule fois', () => {
  // Le ciel se montre avant que la source des tuiles soit connue : le monde
  // est monté sans elle, puis la reçoit. Testé sur le prototype, sans WebGL.
  const composer = { disposed: false, vectorTiles: null };
  const plug = (config) => api.WorldComposer.prototype.setVectorConfig.call(composer, config);

  assert.equal(plug(null), false, 'rien à brancher');
  assert.equal(plug({ tiles: ['https://a/{z}/{x}/{y}.pbf'], maxZoom: 12 }), true);
  assert.equal(composer.vectorTiles.zoom, 12, 'le zoom maximal de la source est respecté');

  const first = composer.vectorTiles;
  assert.equal(plug({ tiles: ['https://b/{z}/{x}/{y}.pbf'], maxZoom: 14 }), false);
  assert.equal(composer.vectorTiles, first, 'le décor ne change pas de source en route');
});

test('le dôme occupe son propre calque, en plus du calque commun', async () => {
  // Une caméra réglée sur `SKY_LAYER` seul ne voit que le ciel : c'est ce qui
  // permet de le montrer pendant que le décor se construit.
  const THREE = await import('three');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  const scene = new THREE.Scene();
  const env = new api.SceneEnvironment({ THREE, Sky, scene, fogRadius: 1000 });

  const skyOnly = new THREE.Layers();
  skyOnly.set(api.SKY_LAYER);
  assert.ok(env.sky.layers.test(skyOnly), 'visible d’une caméra « ciel seul »');
  assert.ok(env.sky.layers.test(new THREE.Layers()), 'toujours visible d’une caméra ordinaire');
  assert.ok(!env.sun.layers.test(skyOnly), 'le reste n’y figure pas');
  env.dispose();
});

test('le ciel se peint avant le premier centrage, les tuiles se branchent ensuite', async () => {
  // C'est ce qui permet de montrer un ciel juste pendant le chargement : rien
  // dans `updateSky` ne doit supposer une bulle déjà posée ni un décor bâti.
  const THREE = await import('three');
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  // Les textures peintes au montage veulent un canevas : un 2D muet suffit.
  const anything = () => new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : anything()),
    apply: () => anything(),
    set: () => true,
  });
  const hadDocument = 'document' in globalThis;
  globalThis.document ??= {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
    createElementNS: () => ({ width: 0, height: 0, style: {}, getContext: () => anything() }),
  };
  const world = createWorld({ THREE, scene: new THREE.Scene(), sky: { Sky } });
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 20000);
  camera.layers.set(api.SKY_LAYER);

  assert.equal(world.frame, null);
  const paint = world.updateSky({ camera, date: new Date('2026-07-01T12:00:00Z'), lng: 2, lat: 48 });
  assert.ok(paint.nightMix < 0.5, 'midi en juillet à Paris');
  const water = world.composer.bubble.materials.grainUniforms;
  assert.ok(water.uWaterSunIntensity.value > 0, 'le soleil éclaire les rides le jour');
  assert.deepEqual(water.uWaterSheenColor.value.toArray(), world.environment.waterLight.horizon);
  const dayReflection = water.uWaterZenith.value.length();
  world.updateSky({ camera, date: new Date('2026-07-01T12:00:00Z'), lng: 2, lat: 48,
    weather: { cloudCover: 1, cloudDensity: 1 } });
  assert.equal(water.uWaterSunIntensity.value, 0, 'le couvert masque la traînée solaire');
  world.updateSky({ camera, date: new Date('2026-07-01T00:00:00Z'), lng: 2, lat: 48 });
  assert.equal(water.uWaterSunIntensity.value, 0, 'aucune traînée solaire la nuit');
  assert.ok(water.uWaterZenith.value.length() < dayReflection, 'le reflet suit l’obscurité du ciel');
  assert.equal(world.setVector({ tiles: ['https://a/{z}/{x}/{y}.pbf'], maxZoom: 14 }), true);
  world.dispose();
  if (!hadDocument) delete globalThis.document;
});

test('roadPositionAt pose un mobile sur le relief lointain hors bulle', () => {
  const composer = fakeComposer();
  composer.bubble = {
    zoom: 15, tiles: new Map(), frame: { toLocal: (lng, lat) => ({ x: lng, z: lat }) },
    toScenePosition: () => ({ x: 10, y: 0, z: 20 }),
  };
  composer.roads = null;
  composer.far = { positionAt: (x, z, lift) => ({ x, y: 500 + lift, z }) };
  const world = new World({ composer, environment: null, elevation: null, ownsElevation: false });
  assert.deepEqual(world.roadPositionAt(10, 20, 0.1), { x: 10, y: 500.1, z: 20 });
});
