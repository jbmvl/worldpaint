/* Les économies portent sur le travail effectué, jamais sur la sélection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTheme } from '../src/themes/default.js';
import { GenerationBudget } from '../src/core/generationBudget.js';
import { WorldComposer } from '../src/worldComposer.js';
import { DECOR_STEP_M } from '../src/core/decorReach.js';
import { testFrame } from './testFrame.mjs';

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
    setPlants() {}, update() {}, sync() {}, invalidate() {}, setRelief() {}, setSeaDistance() {}, setAnimals() {}, setTractors() {}, setTracks() {}, setVerges() {} });
  const composer = Object.assign(Object.create(WorldComposer.prototype), {
    disposed: false, _refreshing: false, root: {}, theme: defaultTheme, landscape: { region: {} },
    _updateLandscape: () => false, _distributeRegion() {}, _wantedTiles: () => [{ x: 1, y: 2 }],
    vectorTiles: { missing: () => 0, load: async () => null, forEachFeature() {} },
    bubble: { processRebuildQueue: () => false, setWaterRelief: () => calls.push('eau'), surfaceGeneration: 0, frame: { ...testFrame, toLocal: () => ({ ...here }) }, materials: { syncGroundClass() {} } },
    groundClass: layer('sol'), cliffs: layer('falaises'), roads: layer('routes'), bridges: layer('ponts'),
    railways: layer('rails'), buildings: layer('bâti'), streets: layer('rues'), gardens: layer('jardins'),
    furniture: layer('mobilier'), vegetation: layer('arbres'), crops: layer('cultures'),
    life: layer('vie'), fauna: layer('faune'), tractors: layer('tracteurs'), trains: layer('trains'),
  });
  composer.buildings.footprints = [];
  return { composer, calls, here };
}

const TOUT = ['falaises','eau','sol','routes','ponts','rails','bâti','rues','jardins','mobilier'];

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

test('le profilage des pauses mesure l’attente seule, sans le travail CPU', async () => {
  let now=0;
  const waits=[];
  const budget=new GenerationBudget({milliseconds:8,now:()=>now,pause:async()=>{now+=20;},onPause:ms=>waits.push(ms)});
  now=7;await budget.checkpoint();assert.deepEqual(waits,[]);
  now=9;await budget.checkpoint();assert.deepEqual(waits,[20]);
  now=38;await budget.checkpoint();assert.deepEqual(waits,[20,20]);
});
