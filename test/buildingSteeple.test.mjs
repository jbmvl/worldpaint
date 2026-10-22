/*
 * La flèche ferme le clocher par des pans sortants ; son fond regarde le sol,
 * pour ne pas disputer le dessus de la tour vu d'en haut tout en bouchant le
 * débord vu d'en bas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingLayer, towerSide, towerRise } from '../src/layers/buildingLayer.js';

test('la flèche du clocher regarde dehors et ne double pas le dessus de la tour', () => {
  for (const angle of [0, 0.43, Math.PI / 2]) {
    const box = { cx: 37, cz: -28, short: 6, long: 16, angle };
    const base = 11, top = 25;
    const height = Math.max(6, top - base) + towerRise(box);
    const walls = { positions: [], normals: [], colors: [] };
    const layer = { _pushKitAt: BuildingLayer.prototype._pushKitAt };
    BuildingLayer.prototype._appendSteeple.call(layer, walls, { wall: [1, 1, 1], roof: [0, 0, 0] }, box, base, top);
    let dessus = 0, dessous = 0, pans = 0;
    for (let i = 0; i < walls.positions.length; i += 9) {
      const ys = [1, 4, 7].map(j => walls.positions[i + j] - base);
      if (ys.every(y => Math.abs(y - height) < 1e-9)) walls.normals[i + 1] > 0 ? dessus++ : dessous++;
      if (!ys.some(y => y > height + 1e-9)) continue;
      pans++;
      assert.ok(walls.normals[i + 1] > 0, 'chaque pan regarde vers le ciel');
      const sommet = ys.indexOf(Math.max(...ys));
      const cx = walls.positions[i + sommet * 3], cz = walls.positions[i + sommet * 3 + 2];
      const dx = (walls.positions[i] + walls.positions[i + 3] + walls.positions[i + 6]) / 3 - cx;
      const dz = (walls.positions[i + 2] + walls.positions[i + 5] + walls.positions[i + 8]) / 3 - cz;
      assert.ok(dx * walls.normals[i] + dz * walls.normals[i + 2] > 0, 'chaque pan regarde hors de la flèche');
      assert.ok(Math.abs(Math.max(...ys) - height - towerSide(box) * 1.5) < 1e-9);
    }
    assert.equal(dessus, 2, 'seul le dessus de la tour regarde le ciel à la base');
    assert.equal(dessous, 2, 'le fond de la flèche regarde le sol');
    assert.equal(pans, 4);
  }
});
