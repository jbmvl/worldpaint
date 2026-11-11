/* Le terrassier comble les ravins lus sous la chaussée et laisse les vraies pentes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeRoadNetwork, ROAD_WAVE_FILL_M, ROAD_TREND_MAX_M } from '../src/layers/roadProfile.js';

const STEP = 5;
const line = (f, { from = 0, to = 600, z = 0, works = null } = {}) => {
  const path = [];
  for (let x = from; x <= to; x += STEP) path.push({ x, z, distance: x - from });
  return { path, platform: Float32Array.from(path, (p) => f(p.x)), works };
};
// Bande de rase campagne : la route colle au sol.
const band = { maxCut: 0.5, maxFill: 0.4 };
const grade = (s) => Math.max(...s.platform.slice(1).map((h, r) => Math.abs(h - s.platform[r]) / STEP));
const gully = (x, at = 300, depth = 12, half = 35) => (Math.abs(x - at) < half ? depth * Math.cos(((x - at) / half) * (Math.PI / 2)) ** 2 : 0);
const grade1 = (s) => gradeRoadNetwork(s, s.map(() => band), { waveStepM: STEP });

test('un ravin lu sous la route est comblé', () => {
  const s = line((x) => 0.03 * x - gully(x));
  grade1([s]);
  assert.ok(grade(s) < 0.2, `pente ${grade(s)}`);
  assert.ok(s.platform[60] > 0.03 * 300 - 2, 'le fond du ravin est relevé');
});

test('une pente régulière, même raide, ne bouge pas', () => {
  const s = line((x) => 0.18 * x);
  const before = s.platform.slice();
  grade1([s]);
  s.platform.forEach((h, r) => assert.ok(Math.abs(h - before[r]) < 0.01));
});

test('un sommet arrondi aux flancs praticables garde sa cote', () => {
  const s = line((x) => 20 * Math.cos(((x - 300) / 300) * Math.PI));
  grade1([s]);
  // Arrondi du raccordement en angle saillant : un mètre, pas la fermeture d'un plateau.
  assert.ok(Math.abs(s.platform[60] - 20) <= band.maxCut + 1, `sommet ${s.platform[60]}`);
});

test('le bas d’une rampe qui finit en cul-de-sac reste au sol', () => {
  const s = line((x) => 0.3 * x, { to: 200 });
  grade1([s]);
  assert.ok(Math.abs(s.platform[0]) < 0.01);
});

test('le comblement est borné', () => {
  const s = line((x) => -gully(x, 300, 30, 40));
  grade1([s]);
  assert.ok(s.platform[60] >= -30 && s.platform[60] <= -30 + ROAD_WAVE_FILL_M + ROAD_TREND_MAX_M + 0.01);
});

test('le ravin se comble à travers un carrefour', () => {
  // Deux tronçons qui se rejoignent au fond du ravin, plus une rue qui en part.
  const a = line((x) => 0.02 * x - gully(x), { to: 300 });
  const b = line((x) => 0.02 * x - gully(x), { from: 300, to: 600 });
  const side = { path: [], platform: null };
  for (let z = 0; z <= 200; z += STEP) side.path.push({ x: 300, z, distance: z });
  side.platform = Float32Array.from(side.path, (p) => 0.02 * 300 - gully(300 + p.z));
  grade1([a, b, side]);
  const node = a.platform[a.platform.length - 1];
  assert.equal(node, b.platform[0], 'un nœud partagé garde une seule cote');
  assert.ok(node > 0.02 * 300 - 2, `carrefour relevé : ${node}`);
  assert.ok(grade(side) < 0.25, `rue latérale : ${grade(side)}`);
});

test('un pont ne se comble pas', () => {
  const works = new Uint8Array(121).fill(0);
  for (let r = 50; r <= 70; r++) works[r] = 1;
  const s = line((x) => -gully(x), { works });
  grade1([s]);
  assert.ok(s.platform[60] < -11, 'le tablier garde sa cote');
});

test('sans pas déclaré, l’aplanissement ne change pas', () => {
  const s = line((x) => -gully(x));
  gradeRoadNetwork([s], [band]);
  assert.ok(s.platform[60] < -11);
});

test('un ravin plus large que son pont est comblé des deux côtés, au-delà de la borne', () => {
  // Pont relevé de 15 m au fond d'un ravin de 30 m de creux et 80 m de large.
  const works = new Uint8Array(121).fill(0);
  for (let r = 59; r <= 61; r++) works[r] = 1;
  const s = line((x) => 0.02 * x - gully(x, 300, 30, 40), { works });
  grade1([s]);
  // Contre le pont, le ravin a plus de 25 m de creux : la chaussée reste au bord.
  for (const r of [57, 58, 62, 63]) {
    assert.ok(s.platform[r] > 0.02 * 5 * r - 3, `ligne ${r} relevée : ${s.platform[r]}`);
  }
  assert.ok(grade(s) < 0.15, `pente ${grade(s)}`);
});

test('une route qui descend en pente douce vers un pont bas n’est pas relevée', () => {
  const works = new Uint8Array(121).fill(0);
  for (let r = 58; r <= 62; r++) works[r] = 1;
  const valley = (x) => -0.08 * Math.min(Math.abs(x - 300), 200);
  const s = line(valley, { works });
  const before = s.platform.slice();
  grade1([s]);
  for (const r of [40, 50, 56, 64, 70]) assert.ok(Math.abs(s.platform[r] - before[r]) < 0.6, `ligne ${r}`);
});

test('une bosse courte du relief est lissée, la pente de fond gardée', () => {
  // Bosse d'1,5 m sur une vingtaine de mètres, sur une rampe à 10 %.
  const s = line((x) => 0.1 * x + 1.5 * Math.exp(-(((x - 300) / 10) ** 2)));
  grade1([s]);
  const chord = (r) => Math.abs(s.platform[r + 4] - s.platform[r]) / 20;
  const worst = Math.max(...Array.from({ length: s.platform.length - 4 }, (_, r) => chord(r)));
  assert.ok(worst < 0.12, `pente sur 20 m : ${worst}`);
});

test('un lacet échantillonné serré est lissé en mètres, pas en lignes', () => {
  // Deux jambes presque plates et un gradin de 5 m dans le virage, lignes au mètre.
  const path = [];
  for (let d = 0; d <= 300; d += d >= 120 && d < 180 ? 1 : 5) path.push({ x: d, z: 0, distance: d });
  const ground = (d) => 0.02 * d - 5 / (1 + Math.exp(-(d - 150) / 3));
  const s = { path, platform: Float32Array.from(path, (p) => ground(p.distance)) };
  grade1([s]);
  let worst = 0;
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 1; j < path.length && path[j].distance - path[i].distance <= 20; j++) {
      if (path[j].distance - path[i].distance >= 19.5) worst = Math.max(worst, Math.abs(s.platform[j] - s.platform[i]) / 20);
    }
  }
  assert.ok(worst < 0.12, `pente sur 20 m : ${worst}`);
});
