/*
 * Le relief lointain : il ne se monte qu'en pays de relief, se troue sous les
 * tuiles maillées de la bulle et plonge d'une maille dessous.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ElevationField } from '../src/core/elevationField.js';
import { createLocalFrame, lngLatToTile } from '../src/core/tileMath.js';
import {
  FarRelief,
  farGrid,
  farnessOf,
  FAR_CELLS_PER_TILE,
  FAR_DEM_ZOOM_DROP,
  FAR_RELIEF_MIN_M,
  FAR_RELIEF_FULL_M,
  FAR_SKIRT_DROP_M,
  FAR_EDGE_DROP_M,
  FAR_EDGE,
  FAR_SUNK,
} from '../src/terrain/farRelief.js';

const ZOOM = 15;
const LNG = 6.4;
const LAT = 45.2;

/** MNT calculé : un versant d'amplitude `amplitude` d'ouest en est sur une tuile de MNT. */
class Slope extends ElevationField {
  constructor(options) {
    super(options);
    this.amplitude = options.amplitude ?? Slope.amplitude;
  }
  async load(x, y) {
    const size = this.tilePixels;
    const heights = new Float32Array(size * size);
    for (let p = 0; p < heights.length; p++) heights[p] = 1000 + (this.amplitude * (p % size)) / size;
    this._store(`${this.zoom}/${x}/${y}`, heights);
    return heights;
  }
}

/** Cote de la surface affichée par la fausse bulle. */
const SURFACE_M = 777;

function bubbleAt(meshedRing = 1) {
  const frame = createLocalFrame(LNG, LAT, ZOOM);
  const t = lngLatToTile(LNG, LAT, ZOOM);
  const centre = { x: Math.floor(t.x), y: Math.floor(t.y) };
  const tiles = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      tiles.set(`${dx}/${dy}`, { x: centre.x + dx, y: centre.y + dy, mesh: ring <= meshedRing ? {} : null });
    }
  }
  return { frame, zoom: ZOOM, centerTile: centre, tiles, verticalScale: 1, surfaceElevationAtLocal: () => SURFACE_M };
}

function farWith(amplitude, bubble = bubbleAt()) {
  Slope.amplitude = amplitude;
  const scene = new THREE.Group();
  const far = new FarRelief({ THREE, scene, bubble, elevation: new Slope({ zoom: ZOOM - FAR_DEM_ZOOM_DROP }), blockSize: 15 });
  return { far, scene, bubble };
}

test('farnessOf : nul en plaine, plein en montagne, croissant entre les deux', () => {
  assert.equal(farnessOf(0), 0);
  assert.equal(farnessOf(FAR_RELIEF_MIN_M), 0);
  assert.equal(farnessOf(FAR_RELIEF_FULL_M), 1);
  assert.equal(farnessOf(4000), 1);
  const mid = farnessOf((FAR_RELIEF_MIN_M + FAR_RELIEF_FULL_M) / 2);
  assert.ok(mid > 0 && mid < 1);
});

test('farGrid : une maille tombe quand tout son voisinage est couvert, le bord couvert reste et plonge', () => {
  const n = 6;
  const heights = new Float32Array((n + 1) * (n + 1));
  // Mailles 1 à 4 couvertes : seules les quatre du centre (2 et 3) ont tout leur voisinage couvert.
  const covered = (i, j) => i >= 1 && i <= 4 && j >= 1 && j <= 4;
  const { role, index } = farGrid(n, covered, heights);
  assert.equal(index.length / 6, n * n - 4);
  const side = n + 1;
  assert.equal(role[0], 0, 'sommet au large');
  assert.equal(role[1 * side + 1], FAR_EDGE, 'sommet du bord de la bulle');
  assert.equal(role[2 * side + 2], FAR_SUNK, 'sommet une maille en dedans');
  assert.equal(role.filter((r) => r === FAR_SUNK).length, 9);
  assert.equal(role.filter((r) => r === FAR_EDGE).length, 16);
});

test('farGrid : une maille sans altitude tombe', () => {
  const heights = new Float32Array(9);
  heights[0] = NaN;
  assert.equal(farGrid(2, () => false, heights).index.length / 6, 3);
});

test('en plaine, la nappe ne se monte pas', async () => {
  const { far } = farWith(40);
  await far.sync();
  assert.equal(far.farness, 0);
  assert.equal(far.mesh.visible, false);
  assert.equal(far.mesh.geometry.index, null);
});

test('en montagne, la nappe se monte, trouée sous la bulle', async () => {
  const { far, bubble } = farWith(8000);
  await far.sync();
  assert.ok(far.amplitude > FAR_RELIEF_FULL_M);
  assert.equal(far.farness, 1);
  assert.equal(far.mesh.visible, true);
  const n = 15 * FAR_CELLS_PER_TILE;
  const hole = (3 * FAR_CELLS_PER_TILE - 2) ** 2;
  assert.equal(far.mesh.geometry.index.count / 6, n * n - hole);
  assert.ok(Math.abs(far.radiusMeters - 7.5 * bubble.frame.scale) < 1e-6);
});

test('la nappe ne se refait que si la bulle a changé', async () => {
  const { far, bubble } = farWith(8000, bubbleAt(0));
  await far.sync();
  const first = far.mesh.geometry;
  await far.sync();
  assert.equal(far.mesh.geometry, first);
  for (const tile of bubble.tiles.values()) tile.mesh = {};
  await far.sync();
  assert.notEqual(far.mesh.geometry, first);
  assert.ok(far.mesh.geometry.index.count < first.index.count);
});

test('sous la bulle, la nappe plonge de FAR_SKIRT_DROP_M', async () => {
  const flat = farWith(8000, bubbleAt(-1));
  await flat.far.sync();
  const holed = farWith(8000);
  await holed.far.sync();
  const side = 15 * FAR_CELLS_PER_TILE + 1;
  const centre = (side * (side - 1)) / 2 + (side - 1) / 2;
  const y = (far) => far.mesh.geometry.attributes.position.getY(centre);
  assert.ok(Math.abs(y(flat.far) - y(holed.far) - FAR_SKIRT_DROP_M) < 1e-3);
});

test('au bord de la bulle, la nappe prend la cote de la surface affichée, un rien dessous', async () => {
  const { far } = farWith(8000);
  await far.sync();
  const side = 15 * FAR_CELLS_PER_TILE + 1;
  const corner = 6 * FAR_CELLS_PER_TILE * (side + 1);
  assert.equal(far.mesh.geometry.attributes.position.getY(corner), SURFACE_M - FAR_EDGE_DROP_M);
});

test('la couleur est celle qu on lui passe, en linéaire', () => {
  const { far } = farWith(0);
  far.setColor({ x: 0.1, y: 0.2, z: 0.05 });
  assert.deepEqual(far.material.color.toArray().map((v) => +v.toFixed(3)), [0.1, 0.2, 0.05]);
});
