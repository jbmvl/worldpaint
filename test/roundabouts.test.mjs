import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoadLines } from '../src/layers/roadGraph.js';
import { JunctionAreas, junctionSurface, branchYields, pointInOutline } from '../src/layers/roadJunctions.js';
import { roadStyleFor } from '../src/layers/roadNetwork.js';

const RAYON = 20;
const cap = (deg, r) => ({ x: Math.sin((deg * Math.PI) / 180) * r, z: -Math.cos((deg * Math.PI) / 180) * r });

/** Un anneau de 16 côtés et des branches soudées à ses sommets, comme la tuile les livre. */
function giratoire(branches = [0, 90, 200], sommets = 16) {
  const anneau = [];
  for (let i = 0; i <= sommets; i++) anneau.push(cap((i * 360) / sommets, RAYON));
  const lignes = [{ profile: 'major', halfWidth: 4, points: anneau }];
  for (const deg of branches) {
    lignes.push({ profile: 'minor', halfWidth: 2.5, points: [cap(deg, RAYON), cap(deg, RAYON + 150)] });
  }
  return lignes;
}

test('un anneau et ses branches font un seul carrefour, centré sur l’anneau', () => {
  const { junctions } = mergeRoadLines(giratoire([0, 90, 180, 270]));
  assert.equal(junctions.length, 1);
  const [giro] = junctions;
  assert.ok(giro.roundabout);
  assert.ok(Math.hypot(giro.x, giro.z) < 0.5);
  assert.equal(giro.branches.length, 4);
  assert.ok(giro.branches.every((b) => b.profile === 'minor'), 'l’anneau n’est pas une branche');
});

test('un pâté de maisons carré n’est pas un giratoire', () => {
  const carre = [{ x: -30, z: -30 }, { x: 30, z: -30 }, { x: 30, z: 30 }, { x: -30, z: 30 }, { x: -30, z: -30 }];
  const lignes = [
    { profile: 'minor', halfWidth: 2.5, points: carre },
    { profile: 'minor', halfWidth: 2.5, points: [{ x: 30, z: 0 }, { x: 150, z: 0 }] },
  ];
  lignes[0].points.splice(2, 0, { x: 30, z: 0 });
  const { junctions } = mergeRoadLines(lignes);
  assert.ok(junctions.every((j) => !j.roundabout));
});

test('l’aire d’un giratoire est une couronne : l’îlot n’en est pas', () => {
  const { junctions } = mergeRoadLines(giratoire());
  const aires = new JunctionAreas(junctions);
  assert.equal(aires.length, 1);
  const [aire] = aires.areas;
  assert.equal(aire.mouths.length, 3);
  assert.equal(aires.covers(0, 0), false, 'centre de l’îlot');
  const surAnneau = cap(45, RAYON);
  assert.equal(aires.covers(surAnneau.x, surAnneau.z), true, 'chaussée de l’anneau');
  const dehors = cap(45, RAYON + 12);
  assert.equal(aires.covers(dehors.x, dehors.z), false, 'pré entre deux branches');
  // Chaque bouche cède le passage à l’anneau, quelle que soit sa largeur.
  assert.ok(aire.mouths.every((m) => branchYields(aire, m.halfWidth)));
});

test('la dalle d’un giratoire ne couvre pas son îlot', () => {
  const [aire] = new JunctionAreas(mergeRoadLines(giratoire()).junctions).areas;
  const dalle = junctionSurface(aire, 0);
  const { positions, indices } = dalle;
  for (let t = 0; t < indices.length; t += 3) {
    const cx = (positions[indices[t] * 3] + positions[indices[t + 1] * 3] + positions[indices[t + 2] * 3]) / 3;
    const cz = (positions[indices[t] * 3 + 2] + positions[indices[t + 1] * 3 + 2] + positions[indices[t + 2] * 3 + 2]) / 3;
    assert.ok(Math.hypot(cx, cz) > RAYON - 6, `triangle ${t / 3} dans l’îlot`);
  }
});

test('le giratoire ne dépend pas de l’ordre ni du sens des lignes', () => {
  const [a] = mergeRoadLines(giratoire()).junctions;
  const inverse = giratoire().reverse().map((l) => ({ ...l, points: [...l.points].reverse() }));
  const [b] = mergeRoadLines(inverse).junctions;
  assert.ok(b.roundabout);
  assert.equal(a.branches.length, b.branches.length);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01);
});

test('un sens unique porte la largeur d’un sens, sauf la voie rapide', () => {
  assert.equal(roadStyleFor({ class: 'primary' }).halfWidth, 4.25);
  assert.equal(roadStyleFor({ class: 'primary', oneway: 1 }).halfWidth, 2.5);
  assert.equal(roadStyleFor({ class: 'minor', oneway: -1 }).halfWidth, 1.8);
  assert.equal(roadStyleFor({ class: 'motorway', oneway: 1 }).halfWidth, roadStyleFor({ class: 'motorway' }).halfWidth);
});

const jambeZ = (x) => 0.1 * x + 0.003 * x * x;

/** Une route à double sens qui se dédouble en deux sens uniques courbes. */
function dedoublement() {
  const jambe = (cote) => {
    const points = [];
    for (let i = 0; i <= 15; i++) {
      const x = i * 6;
      points.push({ x, z: cote * jambeZ(x) });
    }
    return points;
  };
  return [
    { profile: 'major', halfWidth: 4.25, points: [{ x: -150, z: 0 }, { x: 0, z: 0 }] },
    { profile: 'major', halfWidth: 2.5, oneway: 1, points: jambe(1) },
    { profile: 'major', halfWidth: 2.5, oneway: -1, points: jambe(-1) },
  ];
}

test('une route qui se dédouble : les chaînes s’arrêtent à la fourche, chacune à sa largeur', () => {
  const { chains } = mergeRoadLines(dedoublement());
  assert.equal(chains.length, 3, 'le tronc ne se prolonge pas sur une jambe');
  for (const chain of chains) {
    assert.ok(chain.points.every((p) => chain.halfWidth === (p.x < 0 ? 4.25 : 2.5) || p.x === 0));
  }
});

test('la fourche couvre les jambes jusqu’à leur séparation, sur leur tracé courbe', () => {
  const { junctions } = mergeRoadLines(dedoublement());
  const aires = new JunctionAreas(junctions);
  assert.equal(aires.length, 1);
  const [aire] = aires.areas;
  assert.equal(aire.mouths.length, 3);
  // Les axes s'écartent de 5 m vers x ≈ 17 m.
  const jambes = aire.mouths.filter((m) => m.centre.x > 1);
  assert.equal(jambes.length, 2);
  for (const bouche of jambes) {
    assert.ok(bouche.centre.x > 15 && bouche.centre.x < 22, `bouche à ${bouche.centre.x.toFixed(1)} m`);
    // Posée sur la jambe, pas sur son rayon.
    const attendu = Math.sign(bouche.centre.z) * jambeZ(bouche.centre.x);
    assert.ok(Math.abs(bouche.centre.z - attendu) < 0.3, 'sur le tracé');
  }
  // Les deux jambes sont couvertes avant la séparation, l'îlot après ne l'est pas.
  assert.ok(aires.covers(10, jambeZ(10)));
  assert.ok(aires.covers(10, -jambeZ(10)));
  assert.equal(pointInOutline(aire.outline, 40, 0), false, 'îlot');
});
