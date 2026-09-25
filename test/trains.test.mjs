/* Les trains : naissance près de l'observateur, route suivie par-delà les tronçons publiés. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  spawnTrain,
  reattachTrain,
  extendTrain,
  trainCars,
  trainLength,
  TrainLayer,
  TRAIN_COACHES,
  TRAIN_MAX,
  TRAIN_SPAWN_LEAD_M,
  TRAIN_SPAWN_SIGHT_M,
  TRAIN_SPEED_MPS,
} from '../src/layers/trainLayer.js';

const straight = (from, to, y = 100, z = 50) => {
  const points = [];
  for (let x = from; x <= to; x += 6) points.push({ x, y, z });
  return points;
};

test('un train naît en amont de l’observateur, rame entière sur la voie, et pas sur une voie lointaine', () => {
  const train = spawnTrain(straight(-1200, 1200), { x: 0, z: 0 });
  assert.ok(train, 'une voie à 50 m fait naître un train');
  const cars = trainCars(train);
  assert.equal(cars.length, TRAIN_COACHES + 1);
  const head = cars[0];
  assert.ok(Math.abs(Math.abs(head.x) - TRAIN_SPAWN_LEAD_M) < TRAIN_SPAWN_LEAD_M * 0.2 + 20, 'en amont du point le plus proche');
  assert.ok(Math.sin(head.heading) * head.x < 0, 'tourné vers l’observateur');
  assert.equal(spawnTrain(straight(-600, 600, 100, TRAIN_SPAWN_SIGHT_M + 100), { x: 0, z: 0 }), null);
});

test('reconstruit, la voie ne fait ni sauter ni reculer le train', () => {
  const train = spawnTrain(straight(-600, 600), { x: 0, z: 0 });
  const before = trainCars(train);
  // La même voie, prolongée des deux côtés et publiée dans l’autre sens.
  const moved = reattachTrain(train, [straight(-1800, 1800).reverse()]);
  const after = trainCars(moved);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(after[i].x - before[i].x) < 1e-6, 'même position');
    assert.ok(Math.abs(Math.sin(after[i].heading) - Math.sin(before[i].heading)) < 1e-6, 'même sens');
  }
  const ahead = moved.distances[moved.distances.length - 1] - moved.head;
  assert.ok(ahead > 1000, 'la route devant lui vient de la voie prolongée');
});

test('au bout de sa route, le train enchaîne sur la voie qui la prolonge', () => {
  const first = straight(-600, 0);
  const next = straight(0, 600).reverse(); // publiée dans l’autre sens
  const branch = straight(0, 400).map((p) => ({ ...p, z: 50 + p.x })); // à 45°, hors prolongement
  const distances = first.map((p) => p.x - first[0].x);
  const train = { points: first, distances, head: 590 };
  const extended = extendTrain(train, [branch, next]);
  assert.ok(extended, 'prolongé par la voie droite');
  const end = extended.points[extended.points.length - 1];
  assert.equal(end.x, 600);
  assert.equal(end.z, 50, 'pas par l’embranchement');
  assert.equal(extended.head, train.head, 'sans bouger la tête');
  assert.equal(trainCars(extended).length, TRAIN_COACHES + 1);
  assert.equal(extendTrain({ ...train, points: first.slice().reverse() }, [branch, next]), null, 'rien au-delà de l’autre bout');
});

test('la couche fait rouler ses trains et les retire loin de l’observateur', () => {
  const scene = new THREE.Scene();
  const layer = new TrainLayer({ THREE, scene });
  const tracks = Array.from({ length: TRAIN_MAX + 3 }, (_, i) => straight(-1500, 1500, 100, 10 + i * 40));
  layer.setTracks(tracks, { x: 0, z: 0 });
  assert.equal(layer._trains.length, TRAIN_MAX, 'plafonné');
  layer.setTracks(tracks, { x: 0, z: 0 });
  assert.equal(layer._trains.length, TRAIN_MAX, 'pas de second train sur une voie déjà parcourue');
  const x0 = trainCars(layer._trains[0])[0].x;
  layer.advance(1, { x: 0, z: 0 });
  assert.ok(Math.abs(Math.abs(trainCars(layer._trains[0])[0].x - x0) - TRAIN_SPEED_MPS) < 1e-6, 'avance à sa vitesse');
  for (let i = 0; i < 200; i++) layer.advance(1, { x: 0, z: 0 });
  assert.equal(layer._trains.length, 0, 'sortis de la voie ou trop loin');
  layer.dispose();
  assert.equal(scene.children.length, 0);
});

test('phares et baies suivent les caisses ; les baies ne s’allument que la nuit', () => {
  const layer = new TrainLayer({ THREE, scene: new THREE.Scene() });
  layer.setTracks([straight(-2000, 2000)], { x: 0, z: 0 });
  assert.equal(layer.locomotiveLights.count, layer.locomotives.count);
  assert.equal(layer.coachLights.count, layer.coaches.count);
  assert.ok(layer.coaches.count > 0, 'un train est en ligne');
  assert.equal(layer.coachLights.visible, false, 'baies éteintes en plein jour');
  assert.equal(layer.locomotiveLights.visible, true, 'phares allumés même de jour');
  layer.setNight(1);
  assert.equal(layer.coachLights.visible, true);
  assert.equal(layer.lightMaterial.opacity, 1);
  layer.dispose();
});

function close(actual, expected, eps = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= eps, `${message} : ${actual} ≠ ${expected}`);
}

test('la voie ferrée publie ses voies recousues, sans les voies de service', async () => {
  const { RailwayLayer, railProfileFor, catenaryWireProfile, RAILWAY_LIFT_M } = await import('../src/layers/railwayLayer.js');
  const { tileXToLng, tileYToLat } = await import('../src/core/tileMath.js');
  const zoom = 14;
  const scale = 100;
  const bubble = {
    frame: { origin: { x: 1000, y: 1000 }, scale, zoom },
    radiusMeters: 900,
    verticalScale: 1,
    surfaceElevationAtLocal: () => 100,
  };
  const at = (x, z) => [tileXToLng(1000 + x / scale, zoom), tileYToLat(1000 + z / scale, zoom)];
  const features = [
    [{ type: 'LineString', coordinates: [at(-300, 0), at(0, 0)] }, { class: 'rail' }],
    [{ type: 'LineString', coordinates: [at(0, 0), at(300, 0)] }, { class: 'rail' }],
    [{ type: 'LineString', coordinates: [at(-100, 30), at(100, 30)] }, { class: 'rail', service: 'siding' }],
  ];
  const source = { forEachFeature: (_layer, _tiles, fn) => features.forEach(([g, p]) => fn(g, p)) };
  // Sans canevas en Node : on saute la texture du ballast, seule la donnée publiée compte ici.
  const layer = Object.assign(Object.create(RailwayLayer.prototype), {
    disposed: false,
    bubble,
    theme: (await import('../src/themes/default.js')).defaultTheme,
    railProfile: railProfileFor(),
    wireProfile: catenaryWireProfile(),
    _apply() {},
    _applyCatenary() {},
  });
  layer.rebuild(source, [], { x: 0, z: 0 });
  assert.equal(layer.tracks.length, 1, 'deux tronçons de tuile, une seule voie ; le garage est écarté');
  const xs = layer.tracks[0].map((p) => p.x);
  close(Math.min(...xs), -300, 0.5);
  close(Math.max(...xs), 300, 0.5);
  assert.ok(layer.tracks[0].every((p) => p.y === 100 + RAILWAY_LIFT_M), 'altitude de la voie relevée portée par chaque point');
});

test('les poteaux de caténaire ne bougent ni avec les bouts de la voie ni avec son sens', async () => {
  const { catenaryMasts, CATENARY_SPAN_M } = await import('../src/layers/railwayLayer.js');
  const line = (from, to) => [{ x: from, z: 50 }, { x: from + (to - from) * 0.3, z: 60 }, { x: to, z: 50 }];
  const key = (m) => `${m.x.toFixed(6)},${m.z.toFixed(6)}`;
  const short = catenaryMasts(line(-400, 400)).map(key);
  const reversed = catenaryMasts(line(-400, 400).reverse()).map(key);
  assert.deepEqual(reversed, short, 'même poteaux dans les deux sens');

  const masts = catenaryMasts([{ x: -1000, z: 50 }, { x: 1000, z: 50 }]);
  const inner = catenaryMasts([{ x: -300, z: 50 }, { x: 700, z: 50 }]);
  for (const m of inner) assert.ok(masts.some((n) => Math.abs(n.x - m.x) < 1e-6), 'un poteau de la voie courte existe sur la longue');
  for (let i = 1; i < masts.length; i++) close(masts[i].x - masts[i - 1].x, CATENARY_SPAN_M, 1e-6, 'portée régulière');
});
