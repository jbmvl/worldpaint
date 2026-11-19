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
      assert.ok(Math.abs(Math.max(...ys) - height - towerSide(box, height) * 1.5) < 1e-9);
    }
    assert.equal(dessus, 2, 'seul le dessus de la tour regarde le ciel à la base');
    assert.equal(dessous, 2, 'le fond de la flèche regarde le sol');
    assert.equal(pans, 4);
  }
});

test('le campanile du pays se ferme d’un toit bas qui regarde le ciel, et la coupole coiffe le clocher', async () => {
  const { regionalLookFor, personalityLookFor } = await import('../src/layers/buildingLayer.js');
  const plain = personalityLookFor('church');
  assert.equal(regionalLookFor('church', null), plain, 'sans mot, l’église du thème');
  assert.equal(regionalLookFor('castle', { belfry: 'dome' }), personalityLookFor('castle'), 'le clocher ne change que l’église');
  const look = regionalLookFor('church', { belfry: 'dome' });
  assert.equal(look.spire.form, 'campanile');
  assert.ok(look.crossingDome, 'une coupole de croisée');
  assert.equal(look.windows, plain.windows, 'les baies restent celles de l’église');

  const box = { cx: 0, cz: 0, short: 6, long: 14, angle: 0.3 };
  const base = 0, top = 14;
  const height = Math.max(6, top - base) + towerRise(box);
  const walls = { positions: [], normals: [], colors: [] };
  const layer = { _pushKitAt: BuildingLayer.prototype._pushKitAt };
  BuildingLayer.prototype._appendSteeple.call(layer, walls, look.spire, box, base, top);
  let peak = -Infinity;
  for (let i = 1; i < walls.positions.length; i += 3) peak = Math.max(peak, walls.positions[i]);
  const side = towerSide(box, height);
  assert.ok(peak > height && peak < height + side * 0.6, `un toit bas, pas une flèche (${(peak - height).toFixed(2)} m)`);
  for (let i = 0; i < walls.positions.length; i += 9) {
    const ys = [1, 4, 7].map((j) => walls.positions[i + j]);
    if (ys.some((y) => y > height + side * 0.12 + 1e-6)) assert.ok(walls.normals[i + 1] > 0, 'le toit regarde le ciel');
  }

  const highest = (d) => {
    const w = { positions: [], normals: [], colors: [] };
    BuildingLayer.prototype._appendSteeple.call(layer, w, look.spire, box, base, top, d);
    let y = -Infinity;
    for (let i = 1; i < w.positions.length; i += 3) y = Math.max(y, w.positions[i]);
    return y;
  };
  assert.ok(highest(look.crossingDome) > highest(null) + side * 0.2, 'la coupole couronne le clocher');
  assert.equal(typeof BuildingLayer.prototype._appendCrossingDome, 'undefined', 'plus de volume ajouté dans l’empreinte de la nef');
});

test('le clocher crénelé du pays perd son toit sous les merlons du château', async () => {
  const { regionalLookFor, personalityLookFor, BuildingLayer } = await import('../src/layers/buildingLayer.js');
  const look = regionalLookFor('church', { belfry: 'crenellated' });
  assert.equal(look.spire.form, 'crenellated');
  assert.equal(look.crossingDome ?? null, null, 'pas de coupole');
  assert.equal(look.windows, personalityLookFor('church').windows);
  const box = { cx: 0, cz: 0, short: 6, long: 14, angle: 0.3 };
  const base = 0, top = 14;
  const height = Math.max(6, top - base) + towerRise(box);
  const walls = { positions: [], normals: [], colors: [] };
  BuildingLayer.prototype._appendSteeple.call({ _pushKitAt: BuildingLayer.prototype._pushKitAt }, walls, look.spire, box, base, top, null);
  let high = -Infinity;
  for (let i = 1; i < walls.positions.length; i += 3) high = Math.max(high, walls.positions[i]);
  const crown = look.spire.crown;
  assert.ok(Math.abs(high - (height + crown.parapetM * 0.55 + crown.merlonHeightM)) < 1e-9, 'les merlons sont le point le plus haut');
});
