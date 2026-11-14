import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { splitByCells, MESH_CELL_M } from '../src/layers/cellMeshes.js';

/** Un carré de deux triangles au sol, de côté `size`, coin en (x, z). */
function quad(positions, indices, x, z, size = 4) {
  const base = positions.length / 3;
  positions.push(x, 0, z, x + size, 0, z, x + size, 3, z + size, x, 3, z + size);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function geometryOf(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  return geometry;
}

const triangleKeys = (index, start, count) => {
  const keys = [];
  for (let i = start; i < start + count; i += 3) keys.push(`${index[i]},${index[i + 1]},${index[i + 2]}`);
  return keys;
};

test('un maillage fusionné est rangé par case, sans perdre ni copier un triangle', () => {
  const positions = [];
  const indices = [];
  // Trois cases, visitées dans le désordre.
  const spots = [[10, 10], [10 + 3 * MESH_CELL_M, 10], [20, 20], [10, 10 - 2 * MESH_CELL_M], [30 + 3 * MESH_CELL_M, 30]];
  for (const [x, z] of spots) quad(positions, indices, x, z);
  const before = triangleKeys(indices, 0, indices.length).sort();
  const geometry = geometryOf(positions, indices);

  const parts = splitByCells(THREE, geometry);

  assert.equal(parts.length, 3, 'une géométrie par case occupée');
  const index = geometry.index.array;
  const ranges = parts.map((part) => part.drawRange).sort((a, b) => a.start - b.start);
  let at = 0;
  for (const range of ranges) {
    assert.equal(range.start, at, 'les plages se suivent sans trou ni recouvrement');
    at += range.count;
  }
  assert.equal(at, index.length);
  assert.deepEqual(triangleKeys(index, 0, index.length).sort(), before, 'mêmes triangles, autre ordre');

  for (const part of parts) {
    assert.equal(part.index, geometry.index, 'index partagé');
    assert.equal(part.attributes.position, geometry.attributes.position, 'sommets partagés');
    const { start, count } = part.drawRange;
    const { center, radius } = part.boundingSphere;
    for (let i = start; i < start + count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index[i]);
      assert.ok(v.distanceTo(center) <= radius + 1e-6, 'la sphère de la case contient ses sommets');
    }
    assert.ok(radius < MESH_CELL_M, 'la sphère reste à l’échelle de la case');
  }
});

test('un triangle à cheval sur deux cases va à celle de son centre, en entier', () => {
  const positions = [];
  const indices = [];
  quad(positions, indices, MESH_CELL_M - 1, 5, 4);
  const geometry = geometryOf(positions, indices);
  const parts = splitByCells(THREE, geometry);
  const total = parts.reduce((n, part) => n + part.drawRange.count, 0);
  assert.equal(total, 6);
  for (const part of parts) assert.equal(part.drawRange.count % 3, 0);
});
