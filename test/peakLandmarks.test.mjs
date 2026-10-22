/* Les antennes suivent les sommets du relief, jamais les cols de la même couche. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeakLandmarks, peakMastSite } from '../src/layers/furniture/landmarks.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import { randomAt } from '../src/core/groundSeed.js';
import { testFrame as frame } from './testFrame.mjs';

test('une antenne rejoint le sommet du MNT à proximité du point relevé', () => {
  const elevationAt = (x, z) => 500 - ((x - 43) ** 2 + (z + 27) ** 2) * 0.005;
  const site = peakMastSite({ x: 0, z: 0 }, { frame, elevationAt });
  assert.ok(site);
  assert.ok(Math.hypot(site.x - 43, site.z + 27) < 8);
  assert.ok(site.h > elevationAt(0, 0));
});

test('un col ou un versant ne devient pas un sommet au bord du disque de recherche', () => {
  for (const elevationAt of [(x, z) => 500 + x * x * 0.01 - z * z * 0.01, (x) => 500 + x * 0.2]) {
    assert.equal(peakMastSite({ x: 0, z: 0 }, { frame, elevationAt }), null);
  }
});

test('un sommet interdit ou un relief incomplet ne déplace pas une antenne vers le bas', () => {
  const elevationAt = (x, z) => 500 - (x * x + z * z) * 0.005;
  assert.equal(peakMastSite({ x: 0, z: 0 }, { frame, elevationAt, blocked: () => true }), null);
  assert.equal(peakMastSite({ x: 0, z: 0 }, { frame, elevationAt: () => NaN }), null);
  assert.equal(peakMastSite({ x: 0, z: 0 }, { frame, elevationAt: (x, z) => Math.hypot(x, z) > 120 ? NaN : elevationAt(x, z) }), null);
});

test('le recalage d’un sommet garde sa position géographique dans deux repères', () => {
  const autre = createLocalFrame(-0.105, 47.131, 15);
  const sommet = frame.toLngLat(43, -27);
  const sites = [frame, autre].map((repere) => {
    const p = repere.toLocal(-0.145, 47.131), haut = repere.toLocal(sommet.lng, sommet.lat);
    const site = peakMastSite(p, { frame: repere, elevationAt: (x, z) => 500 - ((x - haut.x) ** 2 + (z - haut.z) ** 2) * 0.005 });
    assert.ok(site);
    return repere.toLngLat(site.x, site.z);
  });
  assert.ok(Math.abs(sites[0].lng - sites[1].lng) < 1e-9);
  assert.ok(Math.abs(sites[0].lat - sites[1].lat) < 1e-9);
});

function sommetTire(x, z, classe = 'peak') {
  while (randomAt(frame, x, z, 131) > 0.35) x += 0.5;
  const { lng, lat } = frame.toLngLat(x, z);
  return { geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { class: classe }, x, z };
}

function construire(points, elevationAt, options = {}) {
  const poses = [];
  const layer = {
    bubble: { frame, naturalElevationAtLocal: elevationAt },
    _onRoad: options.onRoad ?? (() => false), _onWater: () => false,
    _place(_placements, item, p) { poses.push({ item, ...p }); },
  };
  const source = { forEachFeature(_name, _tiles, visit) { for (const p of points) visit(p.geometry, p.properties); } };
  buildPeakLandmarks(layer, { source, tiles: [], here: { x: 0, z: 0 }, placements: new Map() }, []);
  return poses;
}

test('la couche mountain_peak exclut explicitement cols, volcans et points sans classe', () => {
  const point = sommetTire(0, 0);
  const elevationAt = (x, z) => 500 - ((x - point.x) ** 2 + z * z) * 0.005;
  for (const classe of ['saddle', 'volcano', 'cliff', undefined]) {
    assert.equal(construire([{ ...point, properties: { class: classe } }], elevationAt).length, 0);
  }
  assert.equal(construire([point], elevationAt).length, 1);
  assert.equal(construire([point], elevationAt, { onRoad: () => true }).length, 0);
});

test('les doublons des tuiles ne multiplient pas les antennes et le plafond garde les plus proches', () => {
  const points = [-900, -300, 300, 900].flatMap((x) => [-600, 0, 600].map((z) => sommetTire(x, z)));
  const elevationAt = (x, z) => 1000 - Math.min(...points.map((p) => (x - p.x) ** 2 + (z - p.z) ** 2)) * 0.005;
  const poses = construire([...points, ...points], elevationAt);
  assert.equal(poses.length, 6);
  assert.deepEqual(poses, construire([...points].reverse(), elevationAt));
  assert.ok(poses.every((p) => Math.hypot(p.x, p.z) < 900));
});
