// Campagne sèche du Midi : versant non cultivé, arbres isolés du trou, canne de Provence.
import test from 'node:test';
import assert from 'node:assert/strict';

import { gapSteepSurfaceForMatrix, gapSurfaceForMatrix } from '../src/core/regionInterpretation.js';
import { worldCellsIn } from '../src/core/groundSeed.js';
import { steepGapAt, steepGapMargin, steepGapPieces, SteepGapField } from '../src/terrain/steepGap.js';
import { gapTreeChance, gapTreeIn, GAP_TREE_CELL_M } from '../src/layers/furniture/gapTrees.js';
import { caneBrakeShareFor, caneBrakeRuns, caneClumpsAlong, CANE_BRAKE_SHARES } from '../src/layers/furniturePlacement.js';
import { FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';
import { resamplePath } from '../src/layers/ribbonGeometry.js';
import { coverBushesAt } from '../src/layers/vegetationLayer.js';
import { regionAt } from '../src/core/region.js';
import { defaultTheme } from '../src/themes/default.js';
import { autumnTheme } from '../src/themes/autumn.js';

// Deux repères du même sol, d'origines différentes : un point du monde y a
// d'autres coordonnées locales.
const ZOOM = 14, SCALE = 2445;
const frameA = { zoom: ZOOM, scale: SCALE, origin: { x: 8900.2, y: 6440.7 } };
const frameB = { zoom: ZOOM, scale: SCALE, origin: { x: 8900.65, y: 6440.35 } };
const toWorld = (f, x, z) => ({ X: (f.origin.x + x / SCALE) * SCALE, Z: (f.origin.y + z / SCALE) * SCALE });
const toLocal = (f, X, Z) => ({ x: (X / SCALE - f.origin.x) * SCALE, z: (Z / SCALE - f.origin.y) * SCALE });

/** Un versant dont la pente monte vers l'est, défini en mètres du monde. */
const slopeOf = (f, grade) => (x, z) => toWorld(f, x, z).X * grade;
const range = defaultTheme.terrain.gapSteep.grade;

test('seule une matrice sèche cède son trou en pente à la broussaille', () => {
  assert.equal(gapSteepSurfaceForMatrix('dry_cropland'), 'maquis');
  assert.equal(gapSteepSurfaceForMatrix('dry_pasture'), 'maquis');
  assert.equal(gapSteepSurfaceForMatrix('hedgerow_meadow'), null);
  assert.equal(gapSteepSurfaceForMatrix('broadleaf_woodland'), null, 'une matrice plantée n’a pas de trou à elle');
  assert.equal(gapSteepSurfaceForMatrix('inconnu'), null);
});

test('le versant raide se lit au-delà du fondu, jamais en deçà', () => {
  const at = (grade) => steepGapAt(frameA, slopeOf(frameA, grade), range, 100, 200);
  assert.equal(at(0), false, 'plat');
  assert.equal(at(range[0] * 0.9), false, 'sous le fondu');
  assert.equal(at(range[1] * 1.1), true, 'au-dessus du fondu');
  // Dans le fondu, une part seulement du versant change de matière.
  const elevation = slopeOf(frameA, (range[0] + range[1]) / 2);
  let steep = 0;
  for (let i = 0; i < 400; i++) if (steepGapAt(frameA, elevation, range, (i % 20) * 37, Math.floor(i / 20) * 41)) steep++;
  assert.ok(steep > 60 && steep < 340, `part piquée ${steep}/400`);
});

test('le versant raide est le même vu de deux points de départ', () => {
  const grade = (range[0] + range[1]) / 2;
  for (let i = 0; i < 200; i++) {
    const X = 21_760_000 + i * 13.7, Z = 15_747_000 + (i % 17) * 29.3;
    const a = toLocal(frameA, X, Z), b = toLocal(frameB, X, Z);
    assert.equal(
      steepGapAt(frameA, slopeOf(frameA, grade), range, a.x, a.z),
      steepGapAt(frameB, slopeOf(frameB, grade), range, b.x, b.z),
      `point ${i}`
    );
  }
});

test('la peinture du versant ne suit pas une grille : pleins sur la pente, rien au plat', () => {
  const count = (grade) => {
    let rects = 0, polygons = 0;
    const field = new SteepGapField(0, 0, 8, 8);
    const steps = steepGapPieces(frameA, slopeOf(frameA, grade), range, field, {
      fillRect: () => rects++,
      fillPolygon: (points) => { polygons++; assert.ok(points.length >= 6); },
    });
    for (const _ of steps);
    return { rects, polygons };
  };
  assert.deepEqual(count(0.05), { rects: 0, polygons: 0 });
  assert.deepEqual(count(0.6), { rects: 64, polygons: 0 });
  const mixed = count((range[0] + range[1]) / 2);
  assert.ok(mixed.polygons > 0, 'la limite est une isoligne');
});

test('le champ peint redonne aux nœuds la marge que calcule la règle pure', () => {
  // Un relief qui n'est pas un plan : la pente varie d'un nœud à l'autre.
  const elevation = (x, z) => { const { X, Z } = toWorld(frameA, x, z); return 40 * Math.sin(X / 90) + 25 * Math.cos(Z / 70); };
  const field = new SteepGapField(-64, 32, 10, 10);
  for (const _ of steepGapPieces(frameA, elevation, range, field, { fillRect() {}, fillPolygon() {} }));
  for (let j = 0; j <= 10; j += 3) {
    for (let i = 0; i <= 10; i += 3) {
      const x = -64 + i * 16, z = 32 + j * 16;
      assert.ok(Math.abs(field.marginAt(x, z) - steepGapMargin(frameA, elevation, range, x, z)) < 1e-5, `nœud ${i},${j}`);
    }
  }
  assert.equal(field.marginAt(-1000, 0), -1, 'hors du champ : pas de versant');
});

test('la densité d’arbres isolés se règle à l’hectare, et vaut zéro sans entrée', () => {
  assert.equal(gapTreeChance(0), 0);
  assert.equal(gapTreeChance(undefined), 0);
  assert.ok(Math.abs(gapTreeChance(0.5) - 0.5 * GAP_TREE_CELL_M ** 2 / 10000) < 1e-9);
  assert.equal(gapTreeChance(100), 1);
  // Seules les matrices sèches, le maquis et la garrigue à palmier nain en portent par défaut.
  for (const [matrix, look] of Object.entries(defaultTheme.soils)) {
    if (look.scatteredTreesPerHa) assert.ok(['dry_cropland', 'dry_pasture', 'terraced_slope', 'macchia', 'palm_garrigue'].includes(matrix), matrix);
  }
});

test('un arbre isolé est tiré du sol : même place et même essence vus de deux points', () => {
  const mix = [['olive', 0.6], ['holm_oak', 0.4]];
  const X0 = 21_760_000, Z0 = 15_747_000;
  const treesOf = (f) => {
    const a = toLocal(f, X0, Z0), b = toLocal(f, X0 + 2000, Z0 + 2000);
    return worldCellsIn(f, a.x, a.z, b.x, b.z, GAP_TREE_CELL_M)
      .map((cell) => gapTreeIn(f, cell, 0.3, mix))
      .filter(Boolean)
      .map((t) => { const w = toWorld(f, t.x, t.z); return `${w.X.toFixed(2)},${w.Z.toFixed(2)},${t.species}`; })
      .sort();
  };
  const a = treesOf(frameA), b = treesOf(frameB);
  assert.ok(a.length > 100, `${a.length} arbres`);
  // Les bords du carré peuvent couper une maille différemment : on compare le cœur.
  const inner = (list) => list.filter((s) => { const [X, Z] = s.split(',').map(Number); return X > X0 + 100 && X < X0 + 1900 && Z > Z0 + 100 && Z < Z0 + 1900; });
  assert.deepEqual(inner(a), inner(b));
  assert.ok(new Set(a.map((s) => s.split(',')[2])).size === 2, 'les deux essences sortent');
});

test('la canne de Provence ne pousse que dans les matrices méditerranéennes', () => {
  for (const matrix of ['hedgerow_meadow', 'openfield_cropland', 'boreal_taiga', 'conifer_forest']) {
    assert.equal(caneBrakeShareFor(matrix, 'road'), 0, matrix);
    assert.equal(caneBrakeShareFor(matrix, 'water'), 0, matrix);
  }
  for (const matrix of ['dry_cropland', 'dry_pasture', 'garrigue']) {
    assert.ok(caneBrakeShareFor(matrix, 'water') > caneBrakeShareFor(matrix, 'road'), `${matrix} : l’eau d’abord`);
  }
  for (const [matrix, shares] of Object.entries(CANE_BRAKE_SHARES)) {
    assert.ok(shares.road >= 0 && shares.road <= 1 && shares.water > 0 && shares.water <= 1, matrix);
  }
});

test('la canne pousse en tronçons, les mêmes à chaque passage', () => {
  const line = [{ x: 0, z: 0 }, { x: 1200, z: 300 }];
  const path = resamplePath(line, 6);
  const runs = caneBrakeRuns(frameA, path);
  const kept = runs.reduce((sum, run) => sum + run[run.length - 1].distance - run[0].distance, 0);
  const total = path[path.length - 1].distance;
  assert.ok(runs.length >= 4, `${runs.length} tronçons`);
  assert.ok(kept > total * 0.15 && kept < total * 0.7, `part plantée ${(kept / total).toFixed(2)}`);
  assert.deepEqual(caneBrakeRuns(frameA, path), runs);
});

test('l’herbe sèche a la même couleur en été et en automne', () => {
  for (const matrix of ['dry_cropland', 'terraced_slope']) {
    const summer = defaultTheme.surfaces.grass.albedo.map((v, i) => v * defaultTheme.soils[matrix].grass[i]);
    const autumn = autumnTheme.surfaces.grass.albedo.map((v, i) => v * autumnTheme.soils[matrix].grass[i]);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(summer[i] - autumn[i]) < 0.01, `${matrix}[${i}] : ${summer[i]} / ${autumn[i]}`);
  }
});

test('la pâture sèche reverdit en automne', () => {
  const [r, g, b] = autumnTheme.surfaces.grass.albedo.map((v, i) => v * autumnTheme.soils.dry_pasture.grass[i]);
  assert.ok(g > r && r > b, `herbe ${[r, g, b].map((v) => v.toFixed(3))}`);
});

test('un pays sec est paille : le rouge au-dessus du vert, des plaques minoritaires', () => {
  for (const matrix of ['dry_cropland', 'dry_pasture']) {
    const look = defaultTheme.soils[matrix];
    const [r, g, b] = defaultTheme.surfaces.grass.albedo.map((v, i) => v * look.grass[i]);
    assert.ok(r > g && g > b, `${matrix} : fond ${[r, g, b].map((v) => v.toFixed(3))}`);
    assert.ok(look.grassPatch.strength > 0 && look.grassPatch.strength <= 0.6, `${matrix} : force ${look.grassPatch.strength}`);
    assert.ok(look.gapBushes > 0 && look.gapBushes < defaultTheme.surfaces.scrub.bushes, `${matrix} : piqueté, pas un maquis`);
  }
});

test('les terrasses restent herbeuses : l’herbe domine, le chaume la casse en plaques', () => {
  const look = defaultTheme.soils.terraced_slope;
  const [r, g, b] = defaultTheme.surfaces.grass.albedo.map((v, i) => v * look.grass[i]);
  assert.ok(g > r && r > b, `herbe ${[r, g, b].map((v) => v.toFixed(3))}`);
  const [pr, pg, pb] = look.grassPatch.albedo;
  assert.ok(pr > pg && pg > pb, `plaque ${look.grassPatch.albedo}`);
});

test('le trou d’un pays sec porte les arbustes du pays, la carte relevée garde les siens', () => {
  const ground = (surface) => ({
    region: { matrix: 'dry_cropland' },
    surfaceAt: () => surface,
    coverAt: () => surface ?? 'grass',
    steepGapAt: () => false,
    steepGapSurface: 'scrub',
  });
  const gap = coverBushesAt(ground(null), 0, 0);
  assert.equal(gap.density, defaultTheme.soils.dry_cropland.gapBushes);
  assert.equal(gap.essence, 'thornyScrub');
  assert.equal(coverBushesAt(ground('grass'), 0, 0).density, 0, 'un pré relevé reste un pré');
  const bocage = { ...ground(null), region: { matrix: 'hedgerow_meadow' } };
  assert.equal(coverBushesAt(bocage, 0, 0).density, 0, 'sans entrée, rien');
});

test('le relief calcaire du nord-ouest sicilien est une pâture, pas un seminativo', () => {
  assert.equal(regionAt(13.139, 37.684)?.id, 'monti_sicani');
  assert.equal(regionAt(13.3, 37.81)?.id, 'monti_sicani', 'Corleone');
  assert.equal(regionAt(14.06, 37.49)?.id, 'sicilia_interna', 'Caltanissetta');
  assert.equal(regionAt(13.36, 38.12)?.id, 'conca_oro', 'Palerme');
});

test('un massif de canne est un fourré de touffes, du côté demandé, ancré au sol', () => {
  const X0 = 21_760_000, Z0 = 15_747_000;
  const runIn = (f) => {
    const a = toLocal(f, X0, Z0);
    return resamplePath([{ x: a.x, z: a.z }, { x: a.x + 60, z: a.z }], 6);
  };
  const clumpsOf = (f) => caneClumpsAlong(f, runIn(f), 3).map((c) => {
    const w = toWorld(f, c.x, c.z);
    return `${w.X.toFixed(3)},${w.Z.toFixed(3)},${c.scale.toFixed(4)}`;
  });
  const a = clumpsOf(frameA);
  assert.deepEqual(a, clumpsOf(frameB), 'même massif vu de deux points de départ');
  // Deux rangées au moins par pas de 1,5 m, moins les manques.
  assert.ok(a.length > 60 && a.length < 130, `${a.length} touffes sur 60 m`);
  // Marche vers +x : un décalage positif pose le massif côté -z (gauche de la marche).
  const local = caneClumpsAlong(frameA, runIn(frameA), 3);
  const axisZ = runIn(frameA)[0].z;
  assert.ok(local.every((c) => c.z < axisZ - 1), 'tout le massif du côté demandé');
});

test('la touffe de canne a la taille d’une canne : 3 à 4 m, plus haute qu’un homme', () => {
  const ys = FURNITURE_BUILDERS.caneClump().positions.filter((_, i) => i % 3 === 1);
  const top = Math.max(...ys);
  assert.ok(top > 3 && top < 4.6, `sommet ${top.toFixed(2)} m`);
});

test('le maquis fermé : sa matière dans le trou, ses amas, son couvert vu de loin', () => {
  assert.equal(gapSurfaceForMatrix('macchia'), 'maquis');
  assert.equal(gapSteepSurfaceForMatrix('macchia'), null);
  const ground = { region: { matrix: 'macchia' }, surfaceAt: () => null, coverAt: () => 'maquis', steepGapAt: () => false };
  const look = coverBushesAt(ground, 0, 0, defaultTheme);
  assert.equal(look.essence, 'macchia');
  // Le couvert est porté par le sol : pas plus d'amas que sur un versant piqueté.
  assert.ok(look.density <= defaultTheme.terrain.gapSteep.bushes);
  // Plus fermé que le maquis sec, moins qu'un bois.
  const share = (kind) => defaultTheme.surfaces[kind].canopy.share;
  assert.ok(share('scrub') < share('maquis') && share('maquis') < share('wood'));
  assert.equal(regionAt(15.249, 37.972)?.matrix, 'macchia', 'les Peloritani');
});

test('les promontoires de l’ouest sicilien : garrigue à palmier nain, au bord de mer seulement', () => {
  assert.equal(regionAt(12.8, 38.09)?.matrix, 'palm_garrigue', 'le Zingaro');
  assert.equal(regionAt(12.33, 37.93)?.matrix, 'palm_garrigue', 'Favignana');
  assert.equal(regionAt(12.44, 37.8)?.id, 'sicilia_occidentale', 'Marsala reste au Trapanese');
  const ground = { region: { matrix: 'palm_garrigue' }, surfaceAt: () => null, coverAt: () => 'scrub', steepGapAt: () => false };
  const look = coverBushesAt(ground, 0, 0, defaultTheme);
  assert.equal(look.essence, 'palmGarrigue');
  // Moins d'instances que la broussaille de la garrigue ordinaire.
  assert.ok(look.density < defaultTheme.surfaces.scrub.bushes);
  const kinds = defaultTheme.trees.essences.palmGarrigue.map((i) => defaultTheme.trees.variants[i].kind);
  assert.ok(kinds.includes('palm') && kinds.includes('tussock'));
  // Sur une broussaille relevée par la carte, même essence, densité de la matière.
  const mapped = coverBushesAt({ ...ground, surfaceAt: () => 'scrub' }, 0, 0, defaultTheme);
  assert.equal(mapped.essence, 'palmGarrigue');
  assert.equal(mapped.density, defaultTheme.surfaces.scrub.bushes);
});

test('la canne ne dépend pas de l’endroit où commence le tracé : même massifs sur une route recoupée', () => {
  const line = [{ x: 0, z: 0 }, { x: 900, z: 200 }];
  const whole = resamplePath(line, 3);
  // La même route, coupée 137 m plus loin, comme le fait la portée autour d'un autre observateur.
  const cut = whole.filter((p) => p.distance >= 137).map((p) => ({ ...p, distance: p.distance - 137 }));
  const clumpsOf = (path, startDistance) => caneBrakeRuns(frameA, path)
    .flatMap((run) => caneClumpsAlong(frameA, run, 3, undefined, { startDistance }))
    .filter((c) => c.x > 300)
    .map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)},${c.scale.toFixed(4)}`);
  const a = clumpsOf(whole, 0);
  assert.ok(a.length > 50, `${a.length} touffes`);
  assert.deepEqual(clumpsOf(cut, 137), a);
});

test('un massif de canne monte aux bouts : touffes petites à la pointe, pleines au milieu', () => {
  const run = resamplePath([{ x: 0, z: 0 }, { x: 60, z: 0 }], 6);
  const clumps = caneClumpsAlong(frameA, run, 3);
  const at = (lo, hi) => clumps.filter((c) => c.x >= lo && c.x < hi).map((c) => c.scale);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const tip = at(0, 1.5), middle = at(20, 40);
  assert.ok(Math.max(...tip) < 0.6, `pointe ${tip.map((v) => v.toFixed(2))}`);
  assert.ok(mean(middle) > 0.85, `milieu ${mean(middle).toFixed(2)}`);
});
