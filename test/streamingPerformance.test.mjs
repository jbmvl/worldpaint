/* Les économies portent sur le travail effectué, jamais sur la sélection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GroundCover } from '../src/layers/groundCover.js';
import { defaultTheme } from '../src/themes/default.js';
import { GenerationBudget } from '../src/core/generationBudget.js';
import { WorldComposer } from '../src/worldComposer.js';
import { DECOR_STEP_M } from '../src/core/decorReach.js';

const valeurs = (cover) => {
  const result = [];
  for (let i = 0; i < cover.mesh.count; i++) result.push(cover._residentAttributes.flatMap(a =>
    Array.from(a.array.subarray(i * a.itemSize, (i + 1) * a.itemSize))).join(','));
  return result.sort();
};
const bulle = () => ({ frame: {}, surfaceGeneration: 0, verticalScale: 1,
  surfaceElevationAtLocal: () => 0,
  renderedSupportAtLocal: (x, z, out) => Object.assign(out, { y: x * .02 + z * .03, slopeX: .02, slopeZ: .03 }),
});

for (const capacity of [2000, 60000]) test(`les ${capacity} places d’herbe retrouvent exactement un semis neuf après déplacement`, () => {
  const options = { THREE, scene: new THREE.Scene(), bubble: bulle(), groundClass: null, count: capacity };
  const moving = new GroundCover(options);
  moving.update(0, 0);
  moving.update(9, 0);
  moving.update(-9, 12);
  const fresh = new GroundCover({ ...options, scene: new THREE.Scene() });
  fresh.update(-9, 12);
  assert.equal(moving.mesh.count, fresh.mesh.count);
  assert.deepEqual(valeurs(moving), valeurs(fresh));
  const expected = valeurs(fresh);
  moving.update(-9, 12, { force: true });
  assert.deepEqual(valeurs(moving), expected);
  moving.dispose(); fresh.dispose();
});

test('une fenêtre identique ne transfère ni l’herbe ni les fleurs', () => {
  const cover = new GroundCover({ THREE, scene: new THREE.Scene(), bubble: bulle(), groundClass: null, count: 60000 });
  cover.update(0, 0);
  const attributes = [...cover._residentAttributes, ...cover.flowers.meshes.flatMap(m => [m.instanceMatrix, m.geometry.attributes.aCoverBand])];
  const versions = attributes.map(a => a.version);
  for (const a of attributes) a.clearUpdateRanges();
  cover._instanceCells.begin(cover.bubble.frame, 0, undefined, false);
  cover._startScatter(0, 0);
  cover._scatter();
  assert.deepEqual(attributes.map(a => a.version), versions);
  assert.ok(attributes.every(a => a.updateRanges.length === 0));
  cover.dispose();
});

test('le budget cède seulement après son seuil et repart après la pause', async () => {
  let now = 0, pauses = 0;
  const budget = new GenerationBudget({ now: () => now, pause: async () => { pauses++; now += 20; } });
  now = 7; await budget.checkpoint(); assert.equal(pauses, 0);
  now = 9; await budget.checkpoint(); assert.equal(pauses, 1);
  now = 30; await budget.checkpoint(); assert.equal(pauses, 1);
  now = 40; await budget.checkpoint(); assert.equal(pauses, 2);
});

function compositeur() {
  const calls = [], here = { x: 0, z: 0 };
  const layer = name => ({ rebuild: () => { calls.push(name); },
    setPlants() {}, update() {}, sync() {}, invalidate() {}, setRelief() {}, setAnimals() {}, setTractors() {}, setTracks() {}, setVerges() {} });
  const composer = Object.assign(Object.create(WorldComposer.prototype), {
    disposed: false, _refreshing: false, root: {}, landscape: { region: {} },
    _updateLandscape: () => false, _distributeRegion() {}, _wantedTiles: () => [{ x: 1, y: 2 }],
    vectorTiles: { missing: () => 0, load: async () => null, forEachFeature() {} },
    bubble: { processRebuildQueue: () => false, surfaceGeneration: 0, frame: { toLocal: () => ({ ...here }) }, materials: { syncGroundClass() {} } },
    groundClass: layer('sol'), cliffs: layer('falaises'), roads: layer('routes'), bridges: layer('ponts'),
    railways: layer('rails'), buildings: layer('bâti'), streets: layer('rues'), gardens: layer('jardins'),
    furniture: layer('mobilier'), vegetation: layer('arbres'), grass: layer('herbe'), crops: layer('cultures'),
    life: layer('vie'), fauna: layer('faune'), tractors: layer('tracteurs'), trains: layer('trains'),
  });
  composer.buildings.footprints = [];
  return { composer, calls, here };
}

const TOUT = ['falaises','sol','routes','ponts','rails','bâti','rues','jardins','mobilier'];

test('le décor se refait d’un bloc, une fois par pas de l’observateur', async () => {
  const { composer, calls, here } = compositeur();
  assert.equal(await composer.refresh(0, 0, { force: true }), true);
  assert.deepEqual(calls, TOUT);
  calls.length = 0;
  here.x = DECOR_STEP_M - 1;
  assert.equal(await composer.refresh(0, 0), false);
  assert.deepEqual(calls, [], 'en deçà du pas, rien ne se refait');
  here.x = DECOR_STEP_M;
  assert.equal(await composer.refresh(0, 0), true);
  assert.deepEqual(calls, TOUT, 'au pas, toutes les couches ensemble');
});

test('une surface de terrain changée refait tout le décor', async () => {
  const { composer, calls } = compositeur();
  await composer.refresh(0, 0, { force: true });
  calls.length = 0;
  assert.equal(await composer.refresh(0, 0), false);
  composer.bubble.surfaceGeneration++;
  assert.equal(await composer.refresh(0, 0), true);
  assert.deepEqual(calls, TOUT);
});

test('une tentative réseau sans donnée nouvelle ne relance pas la génération', async () => {
  const { composer, calls } = compositeur();
  await composer.refresh(0, 0, { force: true }); calls.length = 0;
  composer.vectorTiles.missing = () => 1;
  assert.equal(await composer.refresh(0, 0), false); assert.deepEqual(calls, []);
  const entry = {}; composer.vectorTiles.load = async () => entry;
  assert.equal(await composer.refresh(0, 0), true); assert.ok(calls.includes('sol'));
  assert.ok(calls.includes('routes'));
});

test('une destruction pendant une pause empêche toute étape suivante', async t => {
  const { composer, calls } = compositeur();
  t.mock.method(GenerationBudget.prototype, 'checkpoint', async () => { composer.disposed = true; });
  assert.equal(await composer.refresh(0, 0, { force: true }), false);
  assert.deepEqual(calls, []); assert.equal(composer._refreshing, false);
  assert.equal(composer._refreshTask, null);
});

test('le recentrage attend une reconstruction déjà en cours', async () => {
  const { composer } = compositeur();
  let release, centered = false;
  composer._refreshTask = new Promise(resolve => { release = resolve; });
  composer.bubble.setCenter = async () => { centered = true; return true; };
  const task = composer.setCenter(0, 0);
  await Promise.resolve(); assert.equal(centered, false);
  release(); assert.equal(await task, true); assert.equal(centered, true);
});

test('le compositeur ferme une couche suspendue avant de poursuivre après destruction', async t => {
  const { composer } = compositeur();
  let started = false, closed = false, published = false;
  composer.furniture.rebuildSteps = function* () {
    started = true;
    try { yield; published = true; } finally { closed = true; }
  };
  t.mock.method(GenerationBudget.prototype, 'checkpoint', async () => { if (started) composer.disposed = true; });
  assert.equal(await composer.refresh(0, 0, { force: true }), false);
  assert.equal(closed, true); assert.equal(published, false);
  assert.equal(composer._building, false); assert.equal(composer._incompleteRefresh, true);
});

test('les racines couvertes par l’atlas ne sondent pas neuf fois le terrain CPU', () => {
  let reads = 0;
  const bubble = bulle();
  const sample = bubble.renderedSupportAtLocal;
  bubble.renderedSupportAtLocal = (...args) => { reads++; return sample(...args); };
  bubble.plantSupportTiles = () => [];
  const terrainSupport = { sync() {}, install() {}, coversPatch: () => true, dispose() {} };
  const cover = new GroundCover({ THREE, scene: new THREE.Scene(), bubble, terrainSupport, groundClass: null, count: 2000 });
  cover.update(0, 0);
  assert.equal(reads, cover.mesh.count);
  assert.ok(cover._rootOffsets.every(a => a.every(value => value === 0)));
  cover.dispose();
});

test('un semis d’herbe étalé sur plusieurs appels rend le même semis qu’une passe unique', () => {
  const options = { THREE, scene: new THREE.Scene(), bubble: bulle(), groundClass: null, count: 60000 };
  const spread = new GroundCover({ ...options, scatterBudgetMs: 0 });
  spread.update(0, 0);
  let calls = 1;
  while (spread.pending) { spread.update(0, 0); calls++; }
  spread.update(9, 0);
  const shown = valeurs(spread);
  assert.ok(!spread.update(9, 0) && spread.pending, 'l’herbe affichée reste l’ancienne tant que la passe court');
  assert.deepEqual(valeurs(spread), shown);
  while (spread.pending) spread.update(9, 0);
  const fresh = new GroundCover({ ...options, scene: new THREE.Scene() });
  fresh.update(9, 0);
  assert.ok(calls > 10);
  assert.deepEqual(valeurs(spread), valeurs(fresh));
  spread.dispose(); fresh.dispose();
});


test('le terrain finit avant les plantations et les arbres sont repris après terrassement', async () => {
  const { composer, calls } = compositeur();
  let pending = 3;
  composer.bubble.processRebuildQueue = () => {
    calls.push('terrain');
    return pending-- > 0;
  };
  composer.vegetation.sync = (options) => {
    if (!options) return;
    assert.equal(options.resettle, true);
    calls.push('replantation');
  };
  assert.equal(await composer.refresh(0, 0, { force: true }), true);
  assert.ok(calls.indexOf('routes') < calls.indexOf('terrain'));
  assert.ok(calls.lastIndexOf('terrain') < calls.indexOf('bâti'));
  assert.ok(calls.lastIndexOf('terrain') < calls.indexOf('replantation'));
});
