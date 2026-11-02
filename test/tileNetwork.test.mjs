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
  assert.deepEqual(net.calls, ['https://primary/14/3/3.webp']);
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
