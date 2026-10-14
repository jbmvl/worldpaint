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
