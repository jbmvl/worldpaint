import test from 'node:test';
import assert from 'node:assert/strict';
import { VectorTileSource } from '../src/core/vectorTileSource.js';
import { ElevationField } from '../src/core/elevationField.js';

test('le vectoriel accepte un transport partagé et conserve son cache décodé', async () => {
  let calls = 0;
  const source = new VectorTileSource({ tiles: ['https://tiles/{z}/{x}/{y}.pbf'], fetchTile: async (url, { signal }) => {
    calls++;
    assert.equal(url, 'https://tiles/14/2/3.pbf');
    assert.equal(signal.aborted, false);
    return new Response(new Uint8Array());
  } });
  const [a, b] = await Promise.all([source.load(2, 3), source.load(2, 3)]);
  assert.equal(a, b);
  assert.equal(await source.load(2, 3), a);
  assert.equal(calls, 1);
  source.dispose();
  assert.equal(await source.load(2, 3), null);
  assert.equal(calls, 1);
});

function blocked(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new DOMException('annulé', 'AbortError'));
    else signal.addEventListener('abort', () => reject(new DOMException('annulé', 'AbortError')), { once: true });
  });
}

test('la fermeture et le signal appelant interrompent les tuiles vectorielles', async () => {
  const source = new VectorTileSource({ tiles: ['https://tiles/{z}/{x}/{y}'], fetchTile: blocked });
  const a = source.load(0, 0);
  const external = new AbortController();
  const b = source.load(1, 0, external.signal);
  external.abort();
  assert.equal(await b, null);
  source.dispose();
  assert.equal(await a, null);
  assert.equal(source.pending.size, 0);
});

test('une tuile vectorielle lente est interrompue et reste réessayable', async () => {
  const source = new VectorTileSource({ tiles: ['https://tiles/{z}/{x}/{y}'], fetchTile: blocked, timeoutMs: 5 });
  assert.equal(await source.load(0, 0), null);
  assert.equal(source.pending.size, 0);
  assert.equal(source.tiles.size, 0);
  source.dispose();
});

test('le DEM est annulé à la fermeture et son délai se propage au relief lointain', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = blocked;
  t.after(() => { globalThis.fetch = original; });
  const field = new ElevationField({ zoom: 14, timeoutMs: 5 });
  const distant = field.atZoom(10);
  const request = field.load(0, 0);
  field.dispose();
  assert.equal(await request, null);
  assert.equal(await distant.load(0, 0), null);
  distant.dispose();
});

/*
 * Repli du MNT : une source qui refuse (clé, quota) passe la main à Terrarium,
 * pour la bulle comme pour le relief lointain ; une tuile en échec n'est pas
 * redemandée à chaque relève.
 */
const PRIMARY = 'https://primary/{z}/{x}/{y}.webp';
const BACKUP = 'https://backup/{z}/{x}/{y}.png';

/** Réseau simulé : `answer(url)` rend un statut, ou lève. Décodage factice à `size` pixels. */
function fakeNetwork(t, answer, size = 4) {
  const saved = {
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    warn: console.warn,
  };
  const calls = [];
  const warnings = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const status = answer(url);
    return new Response(status === 200 ? new Uint8Array([size]) : null, { status });
  };
  globalThis.createImageBitmap = async (blob) => ({ width: new Uint8Array(await blob.arrayBuffer())[0], close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext() {
      return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(this.w * this.h * 4) }) };
    }
  };
  console.warn = (...args) => warnings.push(args.join(' '));
  t.after(() => {
    globalThis.fetch = saved.fetch;
    globalThis.createImageBitmap = saved.createImageBitmap;
    globalThis.OffscreenCanvas = saved.OffscreenCanvas;
    console.warn = saved.warn;
  });
  return { calls, warnings };
}

const fieldOf = (options = {}) => new ElevationField({
  zoom: 14,
  url: PRIMARY,
  encoding: 'terrain-rgb',
  fallback: { url: BACKUP, encoding: 'terrarium' },
  ...options,
});

for (const status of [401, 403, 429]) {
  test(`un ${status} de la source principale bascule sur le repli, relief lointain compris`, async (t) => {
    const net = fakeNetwork(t, (url) => (url.startsWith('https://primary') ? status : 200));
    const field = fieldOf();
    const far = field.atZoom(9);
    assert.ok(await field.load(1, 2));
    assert.deepEqual(net.calls, ['https://primary/14/1/2.webp', 'https://backup/14/1/2.png']);
    assert.equal(field.url, BACKUP);
    assert.ok(await far.load(0, 0));
    assert.deepEqual(net.calls.slice(2), ['https://backup/9/0/0.png']);
    assert.equal(net.warnings.length, 1);
    field.dispose();
    far.dispose();
  });
}

test('une requête bloquée (refus sans CORS) bascule aussi sur le repli', async (t) => {
  const net = fakeNetwork(t, (url) => {
    if (url.startsWith('https://primary')) throw new TypeError('Failed to fetch');
    return 200;
  });
  const field = fieldOf();
  assert.ok(await field.load(0, 0));
  assert.equal(net.calls.at(-1), 'https://backup/14/0/0.png');
  field.dispose();
});

test('un 404 ne fait pas basculer et la tuile n’est pas redemandée tout de suite', async (t) => {
  const net = fakeNetwork(t, () => 404);
  const field = fieldOf();
  assert.equal(await field.load(3, 3), null);
  assert.equal(await field.load(3, 3), null);
  // Le 404 fait chercher les parentes, absentes elles aussi, une seule fois.
  assert.deepEqual(net.calls, ['https://primary/14/3/3.webp', 'https://primary/13/1/1.webp', 'https://primary/12/0/0.webp', 'https://primary/11/0/0.webp', 'https://primary/10/0/0.webp']);
  assert.equal(field.url, PRIMARY);
  field.dispose();
});

test('sans repli, un refus rend null une fois sans boucler', async (t) => {
  const net = fakeNetwork(t, () => 403);
  const field = fieldOf({ fallback: null });
  assert.equal(await field.load(0, 0), null);
  assert.equal(await field.load(0, 0), null);
  assert.equal(net.calls.length, 1);
  field.dispose();
});

test('la bascule vide le cache : deux MNT ne se mêlent pas', async (t) => {
  let refuse = false;
  fakeNetwork(t, (url) => (url.startsWith('https://primary') ? (refuse ? 403 : 200) : 200));
  const field = fieldOf();
  assert.ok(await field.load(0, 0));
  assert.equal(field.tilePixels, 4);
  refuse = true;
  assert.ok(await field.load(5, 5));
  assert.equal(field.has(0, 0), false, 'la tuile de l’ancienne source est partie');
  assert.equal(field.has(5, 5), true);
  field.dispose();
});

test('par défaut, Mapterhorn puis MapTiler puis Terrarium', async () => {
  const { MAPTERHORN_URL, MAPTILER_TERRAIN_URL, TERRARIUM_URL } = await import('../src/core/elevationField.js');
  const field = new ElevationField({ zoom: 14 });
  assert.deepEqual(field._sources.list.map((s) => [s.url, s.encoding]), [
    [MAPTERHORN_URL, 'terrarium'],
    [MAPTILER_TERRAIN_URL, 'terrain-rgb'],
    [TERRARIUM_URL, 'terrarium'],
  ]);
  field.dispose();
});

test('plusieurs replis se prennent dans l’ordre, un refus après l’autre', async (t) => {
  const net = fakeNetwork(t, (url) => (url.startsWith('https://primary') || url.startsWith('https://backup') ? 403 : 200));
  const field = fieldOf({ fallback: [{ url: BACKUP, encoding: 'terrarium' }, { url: 'https://last/{z}/{x}/{y}.png', encoding: 'terrarium' }] });
  assert.ok(await field.load(0, 0));
  assert.deepEqual(net.calls, ['https://primary/14/0/0.webp', 'https://backup/14/0/0.png', 'https://last/14/0/0.png']);
  assert.equal(field.url, 'https://last/{z}/{x}/{y}.png');
  field.dispose();
});

test('une tuile absente (404) est découpée dans sa parente de la même source', async (t) => {
  const net = fakeNetwork(t, (url) => (url.includes('/14/') || url.includes('/13/') ? 404 : 200));
  const field = fieldOf();
  const heights = await field.load(5, 6);
  assert.ok(heights, 'la parente du 12 couvre la tuile');
  assert.equal(field.tilePixels, 4);
  assert.deepEqual(net.calls, ['https://primary/14/5/6.webp', 'https://primary/13/2/3.webp', 'https://primary/12/1/1.webp']);
  assert.ok(await field.load(4, 6));
  assert.equal(net.calls.filter((url) => url.includes('/12/')).length, 1, 'la parente sert ses autres enfants');
  assert.equal(field.url, PRIMARY, 'un 404 ne fait pas changer de source');
  field.dispose();
});

test('le recadrage d’une parente prend le bon quart, centres de pixels alignés, sans facettes', async () => {
  const { cropParent } = await import('../src/core/elevationField.js');
  // Parente de 16 pixels, altitude = abscisse + 2 × ordonnée : une pente régulière.
  const size = 16;
  const parent = Float32Array.from({ length: size * size }, (_, i) => (i % size) + 2 * Math.floor(i / size));
  const child = cropParent(parent, size, 1, 1, 0);
  // Le quart droit du haut : le pixel enfant (i, j) a son centre en x = 8 + (i + 0,5)/2 − 0,5 de la parente.
  for (const [i, j] of [[4, 4], [8, 6], [10, 12]]) {
    const x = 8 + (i + 0.5) / 2 - 0.5;
    const y = (j + 0.5) / 2 - 0.5;
    assert.ok(Math.abs(child[j * size + i] - (x + 2 * y)) < 1e-4, `pixel ${i},${j}`);
  }
  // Une marche d'un pixel parent est adoucie, sans dépasser ses deux paliers.
  const step = Float32Array.from({ length: size * size }, (_, i) => ((i % size) < 12 ? 0 : 10));
  const smooth = cropParent(step, size, 1, 1, 0);
  const row = Array.from(smooth.slice(5 * size, 6 * size));
  assert.ok(row.every((v) => v >= -1e-6 && v <= 10 + 1e-6));
  assert.ok(row.filter((v) => v > 0.1 && v < 9.9).length >= 3, 'le passage s’étale sur plusieurs pixels');
});
