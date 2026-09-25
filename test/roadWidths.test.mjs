import test from 'node:test';
import assert from 'node:assert/strict';
import { fitParallelRoadWidths } from '../src/layers/roadWidths.js';
import { absorbParallelLines } from '../src/layers/roadBundles.js';
import { mergeRoadLines } from '../src/layers/roadGraph.js';

const voie = (z, halfWidth = 4, profile = 'major', longueur = 100) => ({
  profile, halfWidth, points: [{ x: 0, z }, { x: longueur, z }],
});
const ordre = { order: ['major', 'minor', 'lane'] };

test('deux chaussées partagent leur écart proportionnellement à leurs largeurs', () => {
  const routes = [voie(0), voie(6)];
  fitParallelRoadWidths(routes);
  assert.deepEqual(routes.map((r) => r.halfWidth), [3, 3]);
  const mixte = [voie(0), voie(4, 1, 'cycleway')];
  fitParallelRoadWidths(mixte);
  assert.deepEqual(mixte.map((r) => r.halfWidth), [3.2, 0.8]);
});

test('les contraintes de trois voies ne dépendent ni de leur ordre ni de leur sens', () => {
  const calcul = (inverse) => {
    const routes = [voie(0), voie(6), voie(10, 2, 'cycleway')];
    if (inverse) { routes.reverse(); for (const r of routes) r.points.reverse(); }
    fitParallelRoadWidths(routes);
    return routes.sort((a, b) => a.points[0].z - b.points[0].z).map((r) => r.halfWidth);
  };
  assert.deepEqual(calcul(false), calcul(true));
});

test('un croisement même rasant, un raccord et un voisinage bref ne réduisent pas les routes', () => {
  for (const autre of [
    { ...voie(0), points: [{ x: 0, z: -5 }, { x: 100, z: 5 }] },
    { ...voie(0), points: [{ x: 0, z: 0 }, { x: 100, z: 4 }] },
    voie(6, 4, 'major', 10),
    voie(10),
  ]) {
    const routes = [voie(0), autre];
    fitParallelRoadWidths(routes);
    assert.deepEqual(routes.map((r) => r.halfWidth), [4, 4]);
  }
});

test('les ouvrages et les niveaux différents ne partagent pas leur largeur', () => {
  for (const supplement of [{ works: [1, 1] }, { works: [2, 2] }, { levels: [1, 1] }]) {
    const routes = [voie(0), { ...voie(6), ...supplement }];
    fitParallelRoadWidths(routes);
    assert.deepEqual(routes.map((r) => r.halfWidth), [4, 4]);
  }
});

test('les bouches du carrefour suivent la largeur de leur chaîne', () => {
  const route = { ...voie(0), points: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }] };
  const branche = { profile: 'lane', halfWidth: 2, points: [{ x: 50, z: 0 }, { x: 50, z: -30 }] };
  const { chains, junctions } = mergeRoadLines([route, voie(6), branche]);
  fitParallelRoadWidths(chains, junctions);
  assert.equal(junctions.length, 1);
  assert.equal(junctions[0].halfWidth, 3);
  assert.deepEqual(junctions[0].branches.filter((b) => b.profile === 'major').map((b) => b.halfWidth), [3, 3]);
});

test('l’absorption cherche toute la largeur voisine au-delà des mailles', () => {
  const grande = voie(25, 10), petite = voie(10, 1, 'lane');
  assert.deepEqual(absorbParallelLines([grande, petite], ordre), [grande]);
});

test('l’absorption protège aussi les ouvrages sans différence de niveau', () => {
  for (const works of [1, 2]) {
    for (const pontPrincipal of [false, true]) {
      const grande = { ...voie(0), works: pontPrincipal ? works : 0 };
      const petite = { ...voie(4, 1, 'lane'), works: pontPrincipal ? 0 : works };
      assert.equal(absorbParallelLines([grande, petite], ordre).length, 2);
    }
  }
});

test('deux bouts couverts ne suffisent pas à absorber un long intervalle vide', () => {
  const petite = voie(4, 1, 'lane');
  const debut = voie(0, 4, 'major', 10);
  const fin = { ...debut, points: [{ x: 90, z: 0 }, { x: 100, z: 0 }] };
  assert.equal(absorbParallelLines([debut, fin, petite], ordre).length, 3);
});

test('une chaîne mixte conserve aussi la largeur de ses approches d’ouvrage', () => {
  const pont = { ...voie(6), points: [{ x: 0, z: 6 }, { x: 50, z: 6 }, { x: 100, z: 6 }], works: [0, 1, 1] };
  const routes = [voie(0), pont];
  fitParallelRoadWidths(routes);
  assert.deepEqual(routes.map((r) => r.halfWidth), [4, 4]);
});

test('des sommets intermédiaires en face des sondes ne coupent pas le longement', () => {
  const routes = [voie(0), { ...voie(6), points: [0, 2.5, 7.5, 12.5, 17.5, 22.5, 100].map((x) => ({ x, z: 6 })) }];
  fitParallelRoadWidths(routes);
  assert.deepEqual(routes.map((r) => r.halfWidth), [3, 3]);
});

test('de la tuile au ruban : la largeur publiée respecte l’écart et reste positive', async () => {
  const { collectRoadSegments } = await import('../src/layers/roadNetwork.js');
  const { createLocalFrame } = await import('../src/core/tileMath.js');
  const frame = createLocalFrame(2.35, 48.85, 15);
  const at = (x, z) => [2.35 + x * 0.0000135, 48.85 - z * 0.000009];
  const source = {
    forEachFeature(layer, tiles, callback) {
      if (layer !== 'transportation') return;
      for (const z of [0, 6]) callback(
        { type: 'LineString', coordinates: [at(-100, z), at(100, z)] },
        { class: 'primary' }
      );
    },
  };
  const { segments, junctions } = collectRoadSegments(source, [], { x: 0, z: 0 }, frame, () => 0);
  assert.equal(segments.length, 2);
  assert.equal(junctions.length, 0);
  const ecart = Math.abs(segments[0].path[0].z - segments[1].path[0].z);
  assert.ok(Math.abs(segments[0].halfWidth + segments[1].halfWidth - ecart) < 1e-6);
  for (const segment of segments) {
    assert.ok(segment.halfWidth > 0);
    assert.ok([...segment.platform].every(Number.isFinite));
  }
});

test('une approche convergente sans sommet commun ne rétrécit pas toute la chaîne', () => {
  for (const debut of [0.1, 4.1]) {
    for (const inverse of [false, true]) {
      const routes = [voie(0), { ...voie(0), points: [{ x: 0, z: debut }, { x: 100, z: 7.5 }] }];
      if (inverse) { routes.reverse(); routes.forEach((route) => route.points.reverse()); }
      fitParallelRoadWidths(routes);
      assert.deepEqual(routes.map((route) => route.halfWidth), [4, 4]);
    }
  }
});

test('des axes presque confondus ne constituent pas deux chaussées à rétrécir', () => {
  const routes = [voie(0), voie(0.1)];
  fitParallelRoadWidths(routes);
  assert.deepEqual(routes.map((route) => route.halfWidth), [4, 4]);
});

test('une zone de carrefour seule ne justifie pas un partage des largeurs', () => {
  const routes = [voie(0, 4, 'major', 20), voie(6, 4, 'major', 20)];
  const junctions = [{ x: 10, z: 0, level: 0, halfWidth: 20, profile: 'major',
    branches: [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, z]) => ({
      x, z, halfWidth: 20, profile: 'major',
      path: [{ x: 10, z: 0 }, { x: 10 + x * 50, z: z * 50 }],
    })),
  }];
  fitParallelRoadWidths(routes, junctions);
  assert.deepEqual(routes.map((route) => route.halfWidth), [4, 4]);
});

test('une convergence invalide aussi une portion parallèle antérieure de la même paire', () => {
  for (const inverse of [false, true]) {
    const routes = [voie(0), { ...voie(0), points: [
      { x: 0, z: 6 }, { x: 50, z: 6 }, { x: 100, z: 0.1 },
    ] }];
    if (inverse) { routes.reverse(); routes.forEach((route) => route.points.reverse()); }
    fitParallelRoadWidths(routes);
    assert.deepEqual(routes.map((route) => route.halfWidth), [4, 4]);
  }
});
