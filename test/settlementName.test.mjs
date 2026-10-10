/* Nom des panneaux : rang urbain, repli rural et indépendance de l'ordre des tuiles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementNameAt } from '../src/layers/settlement.js';

const lieu = (name, className, x) => ({ name, class: className, x, z: 0 });

test('le nom de la ville prime sur un hameau périphérique plus proche', () => {
  const places = [lieu('Les Écarts', 'hamlet', 30), lieu('Lyon', 'city', 2200)];
  assert.equal(settlementNameAt(places, 0, 0).name, 'Lyon');
});

test('un bourg à portée prime sur un village proche et une ville plus éloignée', () => {
  const places = [lieu('Les Prés', 'village', 20), lieu('Meyzieu', 'town', 1000), lieu('Lyon', 'city', 2500)];
  assert.equal(settlementNameAt(places, 0, 0).name, 'Meyzieu');
});

test('hors portée urbaine, le panneau garde le village ou hameau local', () => {
  assert.equal(settlementNameAt([lieu('Lyon', 'city', 3001), lieu('Dornas', 'village', 400)], 0, 0).name, 'Dornas');
  assert.equal(settlementNameAt([lieu('Bourg', 'town', 1201), lieu('Les Prés', 'hamlet', 40)], 0, 0).name, 'Les Prés');
  assert.equal(settlementNameAt([lieu('Dornas', 'village', 1201)], 0, 0), null);
});

test('les quartiers et les données absentes ne donnent aucun nom de panneau', () => {
  assert.equal(settlementNameAt([lieu('Bellecour', 'suburb', 0)], 0, 0), null);
  assert.equal(settlementNameAt(null, 0, 0), null);
  assert.equal(settlementNameAt([], 0, 0), null);
});

test('le choix reste identique à portée limite et en inversant les tuiles', () => {
  const places = [lieu('Alpha', 'city', 3000), lieu('Zêta', 'city', -3000)];
  assert.deepEqual(settlementNameAt(places, 0, 0), settlementNameAt(places.slice().reverse(), 0, 0));
  assert.ok(settlementNameAt([lieu('Bourg', 'town', 1200)], 0, 0));
});


test('un village-centre prime sur ses hameaux, sans étendre le masque urbain', () => {
  assert.equal(settlementNameAt([lieu('Village', 'village', 1000), lieu('Hameau', 'hamlet', 20)], 0, 0).name, 'Village');
  assert.equal(settlementNameAt([lieu('Village', 'village', 1201), lieu('Hameau', 'hamlet', 20)], 0, 0).name, 'Hameau');
});

test('les tuiles de Montreuil-Bellay donnent le village-centre à La Fosse', async () => {
  const { readFileSync } = await import('node:fs');
  const { VectorTile } = await import('@mapbox/vector-tile');
  const { PbfReader } = await import('pbf');
  const { VectorTileSource } = await import('../src/core/vectorTileSource.js');
  const { createLocalFrame } = await import('../src/core/tileMath.js');
  const { collectPlaceNames, nearestNamedPlace } = await import('../src/layers/settlement.js');
  const source = new VectorTileSource({ tiles: [], zoom: 14 });
  const tiles = [];
  for (let x = 8184; x <= 8186; x++) for (let y = 5753; y <= 5755; y++) {
    const file = new URL(`../demo/lab/places/station-montreuil-bellay/vector/14/${x}/${y}.pbf`, import.meta.url);
    const tile = new VectorTile(new PbfReader(readFileSync(file)));
    source._store(`14/${x}/${y}`, { tile, x, y, z: 14 });
    tiles.push({ x, y });
  }
  // Repère métrique centré sur le lieu-dit relevé à l'entrée sud.
  const lat = 47.123537993723176, lng = -0.15938758850097656;
  const frame = createLocalFrame(lng, lat, 14);
  const places = collectPlaceNames(source, tiles, frame);
  assert.equal(places.find(p => p.name === 'Montreuil-Bellay').class, 'village');
  assert.equal(places.find(p => p.name === 'La Fosse').class, 'hamlet');
  const selected = settlementNameAt(places, 0, 0);
  assert.equal(selected.name, 'Montreuil-Bellay');
  assert.ok(selected.distance > 450 && selected.distance < 1200);
  assert.deepEqual(selected, settlementNameAt(places.slice().reverse(), 0, 0));
  const stationFrame = createLocalFrame(-0.1514587, 47.1287929, 14);
  const stationPlaces = collectPlaceNames(source, tiles, stationFrame);
  // Position du panneau sud-ouest constatée sur le banc des lieux.
  assert.equal(nearestNamedPlace(stationPlaces, -412, 233, 450).name, 'La Fosse');
  assert.equal(settlementNameAt(stationPlaces, -412, 233).name, 'Montreuil-Bellay');
  source.dispose();
});
