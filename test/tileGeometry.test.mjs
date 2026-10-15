import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryInTile } from '../src/core/tileGeometry.js';
import { VectorTileSource } from '../src/core/vectorTileSource.js';

const left = { west: 0, east: 10, south: 0, north: 10 };
const right = { west: 10, east: 20, south: 0, north: 10 };
const line = coordinates => ({ type: 'LineString', coordinates });
const polygon = coordinates => ({ type: 'Polygon', coordinates });
const square = (x0, y0, x1, y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];

test('route dans les marges de deux tuiles : deux portions jointives sans recouvrement', () => {
  const road = line([[8, 5], [12, 5]]);
  assert.deepEqual(geometryInTile(road, left).coordinates, [[[8,5],[10,5]]]);
  assert.deepEqual(geometryInTile(road, right).coordinates, [[[10,5],[12,5]]]);
  assert.deepEqual(road.coordinates, [[8,5],[12,5]]);
});

test('sortir puis rentrer dans une tuile ne crée pas de liaison artificielle', () => {
  const result = geometryInTile(line([[8,2],[12,2],[12,8],[8,8]]), left);
  assert.deepEqual(result.coordinates, [[[8,2],[10,2]],[[10,8],[8,8]]]);
});

test('une route sur la couture n’appartient qu’à une tuile', () => {
  const road = line([[10,2],[10,8]]);
  assert.ok(geometryInTile(road, left));
  assert.equal(geometryInTile(road, right), null);
  assert.equal(geometryInTile(line([[2,10],[8,10]]), left), null);
});

test('bâtiment dans le tampon voisin : la copie extérieure disparaît', () => {
  const building = polygon([square(8,2,9,4)]);
  assert.deepEqual(geometryInTile(building, left).coordinates, [building.coordinates]);
  assert.equal(geometryInTile(building, right), null);
});

test('bâtiment à cheval : les empreintes sont fermées et ne se chevauchent plus', () => {
  const building = polygon([square(8,2,12,8), square(9,3,11,4)]);
  for (const bounds of [left, right]) {
    const result = geometryInTile(building, bounds);
    assert.equal(result.coordinates[0].length, 2);
    for (const ring of result.coordinates[0]) {
      assert.deepEqual(ring[0], ring.at(-1));
      for (const [x,y] of ring) assert.ok(x >= bounds.west && x <= bounds.east && y >= 0 && y <= 10);
    }
  }
});

test('une empreinte tangente au bord ne devient pas un mur sans surface', () => {
  assert.equal(geometryInTile(polygon([square(10,2,12,8)]), left), null);
  assert.equal(geometryInTile(line([[-2,2],[0,0]]), left), null);
});

test('multi-géométries : seules les composantes intérieures restent', () => {
  assert.equal(geometryInTile({ type: 'MultiLineString', coordinates: [[[1,1],[2,2]],[[21,1],[22,2]]] }, left).coordinates.length, 1);
  assert.equal(geometryInTile({ type: 'MultiPolygon', coordinates: [[square(1,1,2,2)],[square(21,1,22,2)]] }, left).coordinates.length, 1);
});

test('la lecture réelle découpe routes et bâtiments, sans toucher aux autres couches', () => {
  const source = new VectorTileSource({ tiles: [], zoom: 1 });
  const geometry = line([[-10,10],[10,10]]);
  const layer = { length: 1, feature: () => ({ toGeoJSON: () => ({ geometry, properties: { class: 'primary' } }) }) };
  source.tiles.set('1/0/0', { x: 0, y: 0, z: 1, tile: { layers: { transportation: layer, waterway: layer } } });
  const roads = [], rivers = [];
  source.forEachFeature('transportation', [{x:0,y:0}], (g, p, bounds) => roads.push({ g, p, bounds }));
  source.forEachFeature('waterway', [{x:0,y:0}], g => rivers.push(g));
  assert.deepEqual(roads[0].g.coordinates, [[[-10,10],[0,10]]]);
  assert.equal(roads[0].p.class, 'primary');
  assert.equal(roads[0].bounds.east, 0);
  assert.equal(rivers[0], geometry);
  source.dispose();
});
