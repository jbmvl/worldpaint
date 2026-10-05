/* Les surfaces de carrefour : coutures, recouvrements et formes réelles. */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { collectRoadSegments } from '../src/layers/roadNetwork.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import {
  JunctionAreas,
  areaCovers,
  junctionBoundaryAt,
  junctionRibbonRuns,
  junctionSurface,
  lowestDeckAround,
} from '../src/layers/roadJunctions.js';
import { unionRings, triangulateRings, ringArea } from '../src/layers/junctionPolygons.js';
import { buildCrossings } from '../src/layers/furniture/junctionFurniture.js';
import {
  buffersOf,
  heightIn,
  networkOf,
  networkOfJunctions,
  overlap,
  segmentOf,
  segmentsOf,
  trianglesOf,
} from './junctionWorld.mjs';

const voie = (points, width = 2.5, extra = {}) => ({
  profile: 'minor', halfWidth: width, points: points.map(([x, z]) => ({ x, z })), ...extra,
});
const matrice = {
  T: [voie([[-80, 0], [0, 0], [80, 0]]), voie([[0, 0], [0, 80]])],
  croix: [voie([[-80, 0], [0, 0], [80, 0]], 4), voie([[0, -80], [0, 0], [0, 80]])],
  courbe: [voie([[-80, 0], [0, 0], [3, 0], [10, 8], [50, 35]], 4), voie([[0, 0], [0, -65]])],
  proches: [voie([[-80, 0], [0, 0], [17, 0], [80, 0]]), voie([[0, 0], [0, -60]]), voie([[17, 0], [17, 60]])],
  tresProches: [voie([[-80, 0], [0, 0], [8, 0], [80, 0]]), voie([[0, 0], [0, -60]]), voie([[8, 0], [8, 60]])],
  fourche: [voie([[-80, 0], [0, 0]], 4.25), ...[-1, 1].map((sign) =>
    voie(Array.from({ length: 16 }, (_, i) => [i * 6, sign * (0.1 * i * 6 + 0.003 * (i * 6) ** 2)]), 2.5, { oneway: sign }))],
  boucle: [voie([[-80, 0], [0, 0]]), voie([[0, 0], [30, 0]]), voie([[0, 0], [27, -0.4], [30, 0]]), voie([[30, 0], [95, 30]]), voie([[30, 0], [70, -60]])],
  giratoire: [voie(Array.from({ length: 17 }, (_, i) => [20 * Math.cos((i * Math.PI) / 8), 20 * Math.sin((i * Math.PI) / 8)]), 4),
    ...[0, 1, 2, 3].map((i) => voie([[20 * Math.cos((i * Math.PI) / 2), 20 * Math.sin((i * Math.PI) / 2)], [100 * Math.cos((i * Math.PI) / 2), 100 * Math.sin((i * Math.PI) / 2)]]))],
};
const pente = (slope) => (x, z) => 30 + slope * (x + 0.3 * z);
const cle = (p) => p.map((v) => Math.round(v * 1000)).join(':');

function maillage(lignes, pas, slope, inverse = false) {
  const network = networkOf(lignes, { step: pas, deck: pente(slope), inverse });
  return { ...network, buffers: buffersOf(network) };
}

/** Faces finies, non dégénérées, tournées vers le ciel. */
function faces(buffers) {
  for (const buffer of buffers) {
    assert.ok(buffer && buffer.indices.length > 0, 'aucun maillage vide');
    assert.ok(buffer.positions.every(Number.isFinite), 'toutes les coordonnées sont finies');
    for (const [a, b, c] of trianglesOf(buffer)) {
      const orientation = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      assert.ok(orientation > 1e-7, `face dégénérée ou inversée ${JSON.stringify([a, b, c])}`);
    }
  }
}

/**
 * La bouche est étanche : de part et d'autre de la section, la surface puis le
 * ruban de la même chaussée, à la même cote sur la section.
 */
function coutures({ areas, buffers }) {
  const slabs = buffers.slice(0, areas.length).map(trianglesOf);
  const ribbons = buffers.slice(areas.length).flatMap(trianglesOf);
  areas.areas.forEach((area, index) => {
    for (const mouth of area.mouths) {
      for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const x = mouth.right.x + (mouth.left.x - mouth.right.x) * u;
        const z = mouth.right.z + (mouth.left.z - mouth.right.z) * u;
        const inside = slabs[index].map((t) => heightIn(t, x - mouth.direction.x * 0.01, z - mouth.direction.z * 0.01)).filter((h) => h !== null);
        const outside = ribbons.map((t) => heightIn(t, x + mouth.direction.x * 0.01, z + mouth.direction.z * 0.01)).filter((h) => h !== null);
        assert.equal(inside.length, 1, `la surface borde la bouche en ${x.toFixed(2)}, ${z.toFixed(2)}`);
        assert.ok(outside.length >= 1, `le ruban reprend en ${x.toFixed(2)}, ${z.toFixed(2)}`);
        // À un millimètre de part et d'autre : le ruban pose ses sommets en
        // Float32, à quelques centièmes de millimètre de la section.
        const slab = slabs[index].map((t) => heightIn(t, x - mouth.direction.x * 1e-3, z - mouth.direction.z * 1e-3)).find((h) => h !== null);
        const ribbon = ribbons.map((t) => heightIn(t, x + mouth.direction.x * 1e-3, z + mouth.direction.z * 1e-3)).filter((h) => h !== null);
        assert.ok(ribbon.some((h) => Math.abs(h - slab) < 2e-3), `sans marche : ${slab} contre ${ribbon}`);
      }
    }
  });
}

/** La surface ne double ni une autre surface ni un ruban. */
function sansRecouvrement({ areas, buffers }) {
  const triangles = buffers.flatMap((buffer, bi) => trianglesOf(buffer).map((points) => ({
    points, bi,
    minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[2])), maxZ: Math.max(...points.map((p) => p[2])),
  })));
  for (let i = 0; i < triangles.length; i++) {
    for (let j = i + 1; j < triangles.length; j++) {
      const a = triangles[i];
      const b = triangles[j];
      if (a.bi >= areas.length && b.bi >= areas.length) continue;
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ) continue;
      // Un centimètre carré : les rubans posent leurs sommets en Float32.
      const area = overlap(a.points, b.points);
      assert.ok(area < 1e-4, `recouvrement ${area} m² entre ${JSON.stringify(a.points)} et ${JSON.stringify(b.points)}`);
    }
  }
}

for (const [nom, lignes] of Object.entries(matrice)) {
  for (const slope of [0, 0.12]) {
    for (const pas of [2, 9]) {
      test(`${nom}, pente ${slope}, pas ${pas} : faces, coutures et recouvrements`, () => {
        const result = maillage(lignes, pas, slope);
        assert.ok(result.areas.length >= 1, 'une surface au moins');
        faces(result.buffers);
        coutures(result);
        sansRecouvrement(result);
      });
    }
  }

  test(`${nom} : ordre et sens des données indépendants des maillages`, () => {
    const signature = (result) => result.buffers.flatMap((buffer) => trianglesOf(buffer).map((t) => t.map(cle).sort().join('/'))).sort();
    assert.deepEqual(signature(maillage(lignes, 9, 0.12)), signature(maillage(lignes, 9, 0.12, true)));
  });

  test(`${nom} : bouches indépendantes du pas d’échantillonnage`, () => {
    const signature = (result) => result.areas.areas.flatMap((a) => a.mouths.map((m) => [m.left, m.right].map((p) => cle([p.x, p.y, p.z])).sort().join('/'))).sort();
    const fine = signature(maillage(lignes, 2, 0.12));
    const coarse = signature(maillage(lignes, 9, 0.12));
    assert.equal(fine.length, coarse.length);
    fine.forEach((key, i) => {
      const a = key.split(/[/:]/).map(Number);
      const b = coarse[i].split(/[/:]/).map(Number);
      assert.ok(a.every((v, k) => Math.abs(v - b[k]) <= 20), `${key} contre ${coarse[i]}`);
    });
  });

  test(`${nom} : seuls le contour et les îlots sont des bords de surface`, () => {
    const { areas, buffers } = maillage(lignes, 9, 0.12);
    areas.areas.forEach((area, index) => {
      const counts = new Map();
      const edge = (a, b) => [a, b].sort((p, q) => p - q).join(':');
      const { indices } = buffers[index];
      for (let i = 0; i < indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const key = edge(indices[i + k], indices[i + ((k + 1) % 3)]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const rank = new Map(area.vertices.map((p, i) => [p, i]));
      const border = new Set();
      for (const ring of [area.outline, ...area.holes]) {
        for (let i = 0; i < ring.length; i++) border.add(edge(rank.get(ring[i]), rank.get(ring[(i + 1) % ring.length])));
      }
      for (const key of border) assert.equal(counts.get(key), 1, `bord perdu ${key}`);
      for (const [key, count] of counts) assert.equal(count, border.has(key) ? 1 : 2, `trou intérieur ${key}`);
    });
  });
}

test('deux carrefours très proches partagent une surface, sans ruban entre eux', () => {
  const { areas, segments } = maillage(matrice.tresProches, 3, 0);
  assert.equal(areas.length, 1);
  assert.equal(areas.areas[0].nodes.length, 2, 'le graphe garde ses deux nœuds');
  assert.equal(areas.areas[0].mouths.length, 4);
  const through = segments.find((s) => s.path[0].x < 0 && s.path.at(-1).x > 50);
  assert.equal(junctionRibbonRuns(through, areas, [{ from: 0, to: through.path.length - 1 }]).length, 2);
});

test('une fourche se ferme sur la pointe de son îlot', () => {
  const { areas } = maillage(matrice.fourche, 3, 0);
  assert.equal(areas.length, 1);
  const [area] = areas.areas;
  assert.ok(area.fork, 'personne n’y cède le passage');
  assert.equal(area.mouths.length, 3);
  assert.equal(area.holes.length, 0);
  assert.equal(areaCovers(area, 40, 0), false, 'l’îlot reste dehors');
});

test('un tronc large qui se partage en voies plus étroites ne garde pas de marche à leur rive', () => {
  for (const sign of [1, -1]) {
    const { areas } = networkOf([
      voie([[-80, 0], [0, 0]], 4.25),
      voie([[0, 0], [30, sign], [90, 4 * sign]], 3),
      voie(Array.from({ length: 16 }, (_, i) => [i * 6, -sign * (0.05 * i * 6 + 0.002 * (i * 6) ** 2)]), 3),
    ]);
    assert.equal(areas.length, 1);
    const { outline } = areas.areas[0];
    const marches = outline.filter((p, i) => {
      const q = outline[(i + 1) % outline.length];
      return Math.max(p.x, q.x) < 5 && Math.min(p.x, q.x) > -0.3 && Math.abs(q.z - p.z) > 0.5 && Math.abs(q.x - p.x) < Math.abs(q.z - p.z);
    });
    assert.equal(marches.length, 0, `marche en travers de la rive (${sign})`);
  }
});

test('un giratoire garde son îlot et ne dessine plus son anneau', () => {
  const { areas, segments } = maillage(matrice.giratoire, 3, 0);
  assert.equal(areas.length, 1);
  const [area] = areas.areas;
  assert.ok(area.roundabout);
  assert.equal(area.holes.length, 1);
  assert.equal(areaCovers(area, 0, 0), false);
  assert.equal(area.mouths.length, 4);
  const anneau = segments.filter((s) => s.path.every((p) => Math.abs(Math.hypot(p.x, p.z) - 20) < 1));
  assert.ok(anneau.length > 0);
  for (const segment of anneau) assert.equal(junctionRibbonRuns(segment, areas, [{ from: 0, to: segment.path.length - 1 }]).length, 0);
});

for (const sortie of [[95, 0], [70, 40], [30, 80], [10, 40]]) {
  test(`une petite boucle à deux sorties vers ${sortie} : une surface, deux bouches`, () => {
    const lignes = [voie([[-80, 0], [0, 0]]), voie([[0, 0], [30, 0]]), voie([[0, 0], [15, -2], [30, 0]]), voie([[30, 0], sortie])];
    const result = maillage(lignes, 3, 0.1);
    assert.equal(result.junctions.length, 2, 'les deux nœuds restent dans le graphe');
    assert.equal(result.areas.length, 1, 'la boucle publie une surface commune');
    assert.equal(result.areas.areas[0].mouths.length, 2);
    faces(result.buffers);
    coutures(result);
    sansRecouvrement(result);
  });
}

test('une boucle souterraine garde ses deux sorties, sans surface étendue', () => {
  const lignes = [voie([[-80, 0], [0, 0]], 2.5, { works: 2, level: -1 }), voie([[0, 0], [3, 0]], 2.5, { works: 2, level: -1 }),
    voie([[0, 0], [1.5, -1], [3, 0]], 2.5, { works: 2, level: -1 }), voie([[3, 0], [60, 0]], 2.5, { works: 2, level: -1 })];
  const { areas } = networkOf(lignes, { deck: () => 17 });
  assert.equal(areas.length, 1);
  assert.equal(areas.areas[0].mouths.length, 2);
  assert.ok(areas.areas[0].outline.every((p) => p.x > -9 && p.x < 12));
});

test('une sortie en impasse de trois mètres est prise entière par la surface', () => {
  const { areas, segments } = networkOf([voie([[-80, 0], [0, 0]]), voie([[0, 0], [80, 0]]), voie([[0, 0], [0, 3]])], { deck: () => 17 });
  assert.equal(areas.length, 1);
  const impasse = segments.find((s) => s.path.at(-1).z === 3 || s.path[0].z === 3);
  assert.equal(junctionRibbonRuns(impasse, areas, [{ from: 0, to: impasse.path.length - 1 }]).length, 0);
  assert.equal(areas.areas[0].mouths.length, 2);
});

test('une fourche qui atteint un changement de classe garde des cotes partout', () => {
  const express = (points) => ({ ...voie(points), profile: 'express', halfWidth: 6 });
  const lines = [express([[160, -140], [0, 0]]), express([[0, 0], [-5, 1.5], [-15, 8], [-35, 17]]),
    express([[0, 0], [-28, 24], [-140, 120]]), voie([[-35, 17], [-70, 17]]), voie([[-35, 17], [-35, -35]])];
  for (const inverse of [false, true]) {
    const result = maillage(lines, 3, 0.05, inverse);
    assert.ok(result.areas.areas.every((a) => a.valid && a.vertices.every((p) => Number.isFinite(p.y))));
    faces(result.buffers);
    coutures(result);
  }
});

test('une fourche puis un T : une surface, quatre bouches extérieures, un seul feu', () => {
  const lignes = [[[-50, 0], [0, 0]], [[0, 0], [10, 1], [50, 5]], [[0, 0], [50, -5]], [[10, 1], [10, 40]]]
    .map((points) => ({ profile: 'major', halfWidth: 2.5, points: points.map(([x, z]) => ({ x, z })) }));
  const network = networkOf(lignes, { graph: { weld: 0.01, graft: 0.01 } });
  const { areas, junctions } = network;
  assert.equal(junctions.length, 2, 'le graphe conserve la fourche et le T');
  assert.equal(areas.length, 1, 'une surface couvre la rencontre des deux carrefours');
  assert.equal(areas.areas[0].mouths.length, 4, 'seules les branches extérieures gardent une bouche');
  const buffers = buffersOf(network);
  faces(buffers);
  coutures({ ...network, buffers });
  sansRecouvrement({ ...network, buffers });

  const positions = [];
  const layer = { _areas: areas, _signals: [], _place: (_p, item, at) => { positions.push({ item, ...at }); return at; } };
  const index = {
    query: (x, z) => {
      assert.equal(areaCovers(areas.areas[0], x, z), false, 'le feu se trouve en amont d’une bouche extérieure');
      return { x, z };
    },
    deckAt: () => 30,
  };
  const bati = [[[-100, -100], [100, -100], [100, 100], [-100, 100]].map(([x, z]) => ({ x, z }))];
  buildCrossings(layer, { placements: new Map(), here: { x: 0, z: 0 } }, junctions, index, bati);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].item, 'trafficLight');
});

test('les surfaces de niveaux distincts restent distinctes', () => {
  const lignes = [...matrice.T, voie([[1, -80], [1, 80]], 3, { level: 1, works: 1 })];
  const { areas, segments } = networkOf(lignes);
  assert.equal(areas.length, 1);
  assert.equal(areas.areas[0].mouths.length, 3);
  const pont = segments.find((s) => s.works.some((w) => w === 1));
  assert.equal(pont.junctionCuts.length, 0, 'le pont superposé n’ouvre aucune bouche');
  assert.equal(areas.covers(1, 0, 1), false);
});

test('une traversée reste découpée lorsque ses deux lignes sont dehors', () => {
  const { chains, junctions } = mergeRoadLines(matrice.T);
  const segments = segmentsOf(chains, { deck: () => 30 });
  const through = segments.find((s) => s.path[0].x < 0 && s.path.at(-1).x > 0);
  through.path = [through.path[0], through.path.at(-1)];
  through.frames = undefined;
  through.platform = Float32Array.of(30, 30);
  through.levels = new Int8Array(2);
  through.works = new Uint8Array(2);
  const areas = new JunctionAreas(junctions, segments);
  areas.updateDecks();
  assert.ok(through.junction.every((i) => i < 0), 'aucune ligne dans le carrefour');
  assert.equal(junctionRibbonRuns(through, areas, [{ from: 0, to: 1 }]).length, 2);
});

test('une voie qui ne part pas du carrefour conserve son ruban', () => {
  const { chains, junctions } = mergeRoadLines(matrice.T);
  const intruse = segmentOf([{ x: -30, z: 1 }, { x: 30, z: 1 }], 0.5, { deck: () => 30 });
  const areas = new JunctionAreas(junctions, [...segmentsOf(chains), intruse]);
  areas.updateDecks();
  assert.ok(intruse.junction.every((i) => i === -1));
  assert.equal(junctionRibbonRuns(intruse, areas, [{ from: 0, to: intruse.path.length - 1 }])[0].path.length, intruse.path.length);
});

test('la bouche porte la cote de la plate-forme, et le ruban s’y arrête', () => {
  const { areas, segments } = networkOf(matrice.T, { deck: pente(0.12) });
  const through = segments.find((s) => s.path[0].x < 0 && s.path.at(-1).x > 0);
  let keep = -1;
  for (let r = 0; r < through.path.length - 1; r++) if (through.junction[r] < 0 && through.junction[r + 1] >= 0) keep = r;
  const boundary = junctionBoundaryAt(through, areas, keep, keep + 1);
  const mouth = areas.areas[0].mouths.find((m) => m.segment === through && Math.abs(m.distance - boundary.point.distance) < 1e-9);
  assert.ok(mouth);
  assert.equal(boundary.point.section.left, mouth.left);
  assert.ok(Math.abs(boundary.deck - mouth.left.y) < 1e-4);
});

test('la cote finale d’une bouche peut appartenir à la transition d’un tunnel', () => {
  const frame = createLocalFrame(0, 47, 14);
  const lignes = [
    { points: [[-80, 0], [0, 0], [4, 0]], props: { class: 'minor' } },
    { points: [[4, 0], [42, 0]], props: { class: 'minor', layer: -1, brunnel: 'tunnel' } },
    { points: [[42, 0], [100, 0]], props: { class: 'minor' } },
    { points: [[0, 0], [0, -80]], props: { class: 'minor' } },
  ];
  const source = { forEachFeature(layer, tiles, callback) {
    if (layer !== 'transportation') return;
    for (const l of lignes) callback({ type: 'LineString', coordinates: l.points.map(([x, z]) => { const p = frame.toLngLat(x, z); return [p.lng, p.lat]; }) }, l.props);
  } };
  const { segments, areas } = collectRoadSegments(source, [], { x: 0, z: 0 }, frame, () => 50);
  areas.updateDecks();
  assert.equal(areas.length, 1);
  assert.ok(areas.areas[0].vertices.every((p) => Number.isFinite(p.y)));
  assert.ok(segments.some((s) => s.platform.some((y) => y < 49)), 'le déblai de tunnel reste en place');
  const buffers = buffersOf({ areas, segments });
  faces(buffers);
  coutures({ areas, buffers });
  sansRecouvrement({ areas, buffers });
});

test('les mêmes tuiles découpées, dupliquées et reçues à l’envers gardent les mêmes bouches', () => {
  const lignes = matrice.croix;
  const tuiles = lignes.flatMap((l) => l.points.slice(1).map((p, i) => ({ ...l, points: [l.points[i], p] })));
  const morceaux = [...tuiles, ...tuiles].reverse();
  const signature = (result) => result.areas.areas.flatMap((a) => a.mouths.map((m) => [m.left, m.right].map((p) => cle([p.x, p.y, p.z])).sort().join('/'))).sort();
  assert.deepEqual(signature(maillage(lignes, 9, 0.12)), signature(maillage(morceaux, 9, 0.12)));
});

const montreuil = JSON.parse(readFileSync(new URL('./fixtures/junction-contours-montreuil.json', import.meta.url)));
for (const { repere, junction, voisin } of montreuil) {
  test(`Montreuil ${repere} : une surface triangulée, sans recouvrement`, () => {
    const network = networkOfJunctions(voisin ? [junction, voisin] : [junction], { deck: () => 30 });
    assert.ok(network.areas.length >= 1, 'le carrefour reste présent');
    assert.ok(network.areas.areas.every((a) => a.valid), 'le contour réel est triangulable');
    const buffers = buffersOf(network);
    // Les polylignes relevées finissent sur des coudes serrés où le ruban se
    // replie de lui-même, loin du carrefour : seules les surfaces sont jugées.
    faces(buffers.slice(0, network.areas.length));
    coutures({ ...network, buffers });
    sansRecouvrement({ ...network, buffers });
  });
}

// --- La géométrie plane ------------------------------------------------------

const ring = (points) => points.map(([x, z]) => ({ x, z }));
const blendAt = (_parts, x, z) => ({ x, z });

test('l’union de deux bandes en croix donne un contour, sans trou', () => {
  const [union] = unionRings([ring([[-10, -2], [10, -2], [10, 2], [-10, 2]]), ring([[-2, -10], [2, -10], [2, 10], [-2, 10]])], blendAt);
  assert.equal(union.outline.length, 12);
  assert.equal(ringArea(union.outline), 144);
  assert.equal(union.holes.length, 0);
});

test('quatre bandes en carré laissent un îlot, et un îlot minuscule est comblé', () => {
  const square = (w) => [ring([[-10, -10], [10, -10], [10, -10 + w], [-10, -10 + w]]), ring([[10 - w, -10], [10, -10], [10, 10], [10 - w, 10]]),
    ring([[-10, 10 - w], [10, 10 - w], [10, 10], [-10, 10]]), ring([[-10, -10], [-10 + w, -10], [-10 + w, 10], [-10, 10]])];
  const [open] = unionRings(square(4), blendAt, { minHole: 2 });
  assert.equal(open.holes.length, 1);
  assert.equal(ringArea(open.holes[0]), -144);
  const [closed] = unionRings(square(9.5), blendAt, { minHole: 2 });
  assert.equal(closed.holes.length, 0, 'un trou d’un mètre carré n’est pas un îlot');
});

test('un anneau replié sur lui-même compte encore comme chaussée', () => {
  const eight = ring([[0, 0], [4, 4], [4, 0], [0, 4]]);
  const parts = unionRings([eight], blendAt);
  assert.equal(parts.length, 2, 'les deux boucles');
  assert.ok(parts.every((p) => ringArea(p.outline) > 0));
});

test('la triangulation d’un contour en U couvre sa surface sans triangle replié', () => {
  const u = ring([[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]]);
  const { triangles, valid } = triangulateRings(u);
  assert.ok(valid);
  assert.equal(triangles.length, u.length - 2);
  assert.ok(triangles.every((t) => ringArea(t) > 0));
  assert.equal(triangles.reduce((sum, t) => sum + ringArea(t), 0), 28);
});

test('le minimum de déblai existe aussi dans un triangle plat loin de ses sommets', () => {
  const vertices = ring([[0, 0], [20, 0], [0, 20]]).map((p) => ({ ...p, y: 20 }));
  assert.equal(lowestDeckAround({ vertices, triangles: [[0, 1, 2]] }, 3, 3, 0.1), 20);
});

test('la surface rendue et les cotes lues partagent leurs triangles', () => {
  const { areas } = networkOf(matrice.croix, { deck: pente(0.12) });
  const [area] = areas.areas;
  const mesh = junctionSurface(area, 0);
  for (const [a, b, c] of trianglesOf(mesh)) {
    const x = (a[0] + b[0] + c[0]) / 3;
    const z = (a[2] + b[2] + c[2]) / 3;
    assert.ok(Math.abs(areas.deckAt(x, z) - (a[1] + b[1] + c[1]) / 3) < 1e-6);
  }
});
