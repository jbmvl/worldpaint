import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { treePrototype } from '../src/models/treeKit.js';
import { defaultTheme } from '../src/themes/default.js';
import { VegetationLayer } from '../src/layers/vegetationLayer.js';
import { vegetationDetail } from '../src/layers/vegetationDetail.js';

test('le détail lointain réduit les facettes sans déplacer les sommets des lobes', () => {
  defaultTheme.trees.variants.forEach((variant, i) => {
    const full = treePrototype(variant, i);
    const medium = treePrototype(variant, i, defaultTheme.trees.volume, 1);
    const far = treePrototype(variant, i, defaultTheme.trees.volume, 2);
    assert.ok(far.positions.length <= medium.positions.length);
    assert.ok(medium.positions.length <= full.positions.length);
    assert.deepEqual(far.positions, treePrototype(variant, i, defaultTheme.trees.volume, 2).positions);
    for (const kit of [medium, far]) {
      for (let j = 0; j < kit.positions.length; j += 3) {
        assert.ok(Math.abs(kit.positions[j]) <= .5 && Math.abs(kit.positions[j + 2]) <= .5);
        assert.ok(kit.positions[j + 1] >= 0 && kit.positions[j + 1] <= 1);
        assert.ok(Math.hypot(...kit.normals.slice(j, j + 3)) > .99);
      }
    }
    if (!['conifer', 'fern', 'marram', 'palm'].includes(variant.kind)) {
      const vertices = new Set(Array.from({ length: full.positions.length / 3 }, (_, j) => full.positions.slice(j * 3, j * 3 + 3).join(':')));
      let shared = 0;
      for (let j = 0; j < far.positions.length; j += 3) if (vertices.has(far.positions.slice(j, j + 3).join(':'))) shared++;
      assert.ok(shared >= far.positions.length / 3 * .6, 'les lobes gardent leurs sommets ; seul le tronc change de section');
    }
  });
});

test('les seuils gardent le détail proche et évitent les bascules répétées', () => {
  assert.equal(vegetationDetail(500, 2), 0);
  assert.equal(vegetationDetail(650, 0), 0);
  assert.equal(vegetationDetail(670, 0), 1);
  assert.equal(vegetationDetail(550, 1), 1);
  assert.equal(vegetationDetail(530, 1), 0);
  assert.equal(vegetationDetail(1070, 0), 2);
  assert.equal(vegetationDetail(950, 2), 2);
  assert.equal(vegetationDetail(930, 2), 1);
});

test('un aller-retour ne transfère ni matrices ni couleurs et restitue le volume proche', () => {
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(), bubble: { frame: {} } });
  layer.setPlants('t', [{ variant: 0, x: 0, y: 0, z: 0, height: 10, aspect: .7, rotation: 0, color: [1, 1, 1] }]);
  const mesh = layer.meshes.get('t')[0];
  const matrix = mesh.instanceMatrix;
  const color = mesh.instanceColor;
  const sphere = mesh.boundingSphere;
  layer.update(1500, 0, { force: true });
  assert.equal(mesh.userData.treeDetail, 2);
  assert.equal(mesh.geometry, layer.detailPrototypes[2][0]);
  assert.equal(mesh.instanceMatrix, matrix);
  assert.equal(mesh.instanceColor, color);
  assert.equal(mesh.boundingSphere, sphere);
  layer.update(0, 0, { force: true });
  assert.equal(mesh.geometry, layer.prototypes[0]);
  layer.dispose();
});

test('un bloc dont une plante reste proche garde son volume complet', () => {
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(), bubble: { frame: {} } });
  layer.setPlants('t', [0, 240].map(x => ({ variant: 0, x, y: 0, z: 0, height: 10, aspect: .7, rotation: 0, color: [1, 1, 1] })));
  const mesh = layer.meshes.get('t')[0];
  layer.update(-500, 0, { force: true });
  assert.equal(mesh.userData.treeDetail, 0);
  layer.dispose();
});

test('la destruction libère chacun des prototypes une seule fois', () => {
  const layer = new VegetationLayer({ THREE, scene: new THREE.Scene(), bubble: { frame: {} } });
  const counts = layer.detailPrototypes.flat().map(g => { const c = { count: 0 }; g.addEventListener('dispose', () => c.count++); return c; });
  layer.dispose(); layer.dispose();
  assert.ok(counts.every(c => c.count === 1));
});
