/*
 * Les ruines antiques : forme décidée par le nom puis par l'emprise, dessin
 * déterministe et posé sur l'emprise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingPersonalityFor } from '../src/layers/buildingLayer.js';
import { isAncientName, ruinFormFor, ruinKit } from '../src/layers/ruinGeometry.js';
import { orientedBox } from '../src/layers/roofGeometry.js';
import { createLocalFrame } from '../src/core/tileMath.js';

const frame = createLocalFrame(12.83, 37.58, 14);
const rect = (L, W, angle = 0.4, cx = 10, cz = -5) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: cx + (u * L / 2) * c - (v * W / 2) * s, z: cz + (u * L / 2) * s + (v * W / 2) * c }));
};
const look = { wall: [0.7, 0.6, 0.4], roof: [0.5, 0.4, 0.3] };
const extent = (kit) => {
  let maxY = -Infinity;
  for (let i = 1; i < kit.positions.length; i += 3) maxY = Math.max(maxY, kit.positions[i]);
  return maxY;
};

test('une ruine, ou un temple et un théâtre dits antiques, habillent leur bâtiment', () => {
  assert.equal(buildingPersonalityFor({ class: 'castle', subclass: 'ruins', name: 'Tempio C' }), 'ruin');
  assert.equal(buildingPersonalityFor({ class: 'attraction', subclass: 'attraction', name: 'Tempio della Concordia' }), 'ruin');
  assert.equal(buildingPersonalityFor({ class: 'theatre', subclass: 'theatre', name: 'Teatro Greco' }), 'ruin');
  assert.equal(buildingPersonalityFor({ class: 'theatre', subclass: 'theatre', name: 'Teatro Massimo' }), null);
  assert.equal(buildingPersonalityFor({ class: 'attraction', subclass: 'attraction', name: 'Latomia del Paradiso' }), null);
  assert.equal(buildingPersonalityFor({ class: 'castle', subclass: 'castle' }), 'castle');
  assert.equal(isAncientName('Anfiteatro romano'), true);
  assert.equal(isAncientName('Théâtre municipal'), false);
});

test('le nom décide de la forme, l’emprise à défaut', () => {
  const temple = orientedBox(rect(67, 24));
  assert.equal(ruinFormFor({ name: 'Tempio C', box: temple }), 'temple');
  assert.equal(ruinFormFor({ name: null, box: temple }), 'temple');
  assert.equal(ruinFormFor({ name: 'Agorà', box: orientedBox(rect(30, 25)) }), 'remains');
  assert.equal(ruinFormFor({ name: 'Teatro', box: orientedBox(rect(63, 35)) }), 'theatre');
  assert.equal(ruinFormFor({ name: 'Anfiteatro romano', box: orientedBox(rect(140, 119)) }), 'amphitheatre');
  // Trop petit pour son nom : murs arasés plutôt qu'un temple miniature.
  assert.equal(ruinFormFor({ name: 'Tempio B', box: orientedBox(rect(6, 4)) }), 'remains');
});

test('chaque forme produit des triangles, à la même place d’une reconstruction à l’autre', () => {
  for (const [form, L, W] of [['temple', 67, 24], ['theatre', 63, 35], ['amphitheatre', 140, 119], ['remains', 30, 25]]) {
    const footprint = rect(L, W);
    const box = orientedBox(footprint);
    const make = () => ruinKit({ form, footprint, box, look, frame, relief: 4, groundAt: (x, z) => z * 0.1 });
    const kit = make();
    assert.ok(kit.positions.length > 0, form);
    assert.equal(kit.positions.length % 9, 0, form);
    assert.ok(kit.positions.every(Number.isFinite), form);
    assert.deepEqual(make().positions, kit.positions, form);
    // Rien ne déborde loin de l'emprise.
    for (let i = 0; i < kit.positions.length; i += 3) {
      assert.ok(Math.hypot(kit.positions[i], kit.positions[i + 2]) <= Math.hypot(L, W) / 2 + 6, form);
    }
  }
});

test('un temple tient sur son podium et dépasse le point haut de la pente', () => {
  const footprint = rect(40, 17);
  const box = orientedBox(footprint);
  const kit = ruinKit({ form: 'temple', footprint, box, look, frame, relief: 3 });
  assert.ok(extent(kit) > 3 + 5, 'des colonnes au-dessus du crépis');
});

test('le théâtre s’adosse au côté qui monte', () => {
  const footprint = rect(60, 30, 0.3, 0, 0);
  const box = orientedBox(footprint);
  // Coordonnée en travers du grand côté : c'est elle qui dit de quel côté monte la cavea.
  const v = (x, z) => -x * Math.sin(box.angle) + z * Math.cos(box.angle);
  const crestSide = (groundAt) => {
    const kit = ruinKit({ form: 'theatre', footprint, box, look, frame, relief: 10, groundAt });
    // Moyenne des sommets au faîte : les extrémités du demi-cercle reviennent sur la scène.
    const top = extent(kit);
    let sum = 0;
    for (let i = 0; i < kit.positions.length; i += 3) if (kit.positions[i + 1] > top - 1e-6) sum += v(kit.positions[i], kit.positions[i + 2]);
    return Math.sign(sum);
  };
  assert.equal(crestSide(v), 1);
  assert.equal(crestSide((x, z) => -v(x, z)), -1);
});
