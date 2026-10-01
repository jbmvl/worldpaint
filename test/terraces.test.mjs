import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultTheme } from '../src/themes/default.js';
import {
  BuildingLayer,
  terraceChairs,
  TERRACE_CHAIR_COUNT,
  TERRACE_CHAIR_RADIUS_M,
  TERRACE_SEAT_HEIGHT_M,
} from '../src/layers/buildingLayer.js';

/** Couche réduite à ce que `_appendTerrace` lit : le thème, l'index routier, le puits. */
function layerWith(roadIndex = null) {
  const layer = Object.create(BuildingLayer.prototype);
  layer.theme = defaultTheme;
  layer._roadIndex = roadIndex;
  layer._terraceSink = [];
  return layer;
}

const walls = () => ({ positions: [], normals: [], colors: [] });

test('chaque table de terrasse posée est publiée avec ses chaises et la façade', () => {
  const layer = layerWith();
  const length = defaultTheme.shopfront.terraceSpacingM * 3;
  layer._appendTerrace(walls(), { x: 0, y: 0 }, { x: length, y: 0 }, 0, 1, () => 2, 0, 'cafe');

  const tables = layer._terraceSink;
  assert.equal(tables.length, 3);
  for (const t of tables) {
    assert.equal(t.kind, 'cafe');
    assert.deepEqual(t.facing, { x: 0, z: 1 });
    assert.ok(Math.abs(t.z - defaultTheme.shopfront.terraceDepthM) < 1e-9, 'reculée du mur vers la rue');
    assert.equal(t.y, 2);
    assert.ok(t.top > t.chairs[0].y, 'le plateau est plus haut que l’assise');
    assert.equal(t.chairs.length, TERRACE_CHAIR_COUNT);
  }
});

test('une table qui mordrait sur la chaussée n’est ni posée ni publiée', () => {
  const layer = layerWith({ query: () => true });
  const w = walls();
  layer._appendTerrace(w, { x: 0, y: 0 }, { x: 5, y: 0 }, 0, 1, () => 0, 0, 'restaurant');
  assert.equal(layer._terraceSink.length, 0);
  assert.equal(w.positions.length, 0);
});

test('les assises entourent la table à la hauteur de la galette', () => {
  const chairs = terraceChairs(10, 1, -4);
  for (const c of chairs) {
    assert.ok(Math.abs(Math.hypot(c.x - 10, c.z + 4) - TERRACE_CHAIR_RADIUS_M) < 1e-9);
    assert.equal(c.y, 1 + TERRACE_SEAT_HEIGHT_M);
  }
});
