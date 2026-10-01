/* Franchissements complets : topologie, profils et terrain partagé, sans WebGL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRoadSegments } from '../src/layers/roadNetwork.js';
import { collectCrossingRails, stitchBridgeAccesses } from '../src/layers/transportCrossings.js';
import { TransportEarthworks } from '../src/terrain/transportEarthworks.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';
import { RoadIndex } from '../src/layers/roadGraph.js';

const frame = createLocalFrame(0, 45, 15);
const terrain = () => 50;
const way = (properties, points) => ({ properties, geometry: { type: 'LineString',
  coordinates: points.map(([x, z]) => { const p = frame.toLngLat(x, z); return [p.lng, p.lat]; }) } });
function fixture({ rail = false, motorway = false, bridge = true, dense = false, passage = false, reverse = false, high = false, parallel = false, double = false, observer = 0, access = false, neighbour = false, tunnelPassage = false } = {}) {
  const features = [
    way({ class: 'minor' }, [[-300, 0], [-16, 0]]),
    way({ class: 'minor', ...(bridge ? { brunnel: 'bridge', layer: 1 } : {}) }, [[-16, 0], [16, 0]]),
    way({ class: 'minor' }, [[16, 0], [300, 0]]),
    way({ class: rail ? 'rail' : motorway ? 'motorway' : 'primary', ...(high ? { layer: 2 } : {}) }, parallel ? [[-700, 20], [700, 20]] : [[0, -700], [0, 700]]),
    way({ class: 'path' }, [[25, 0], [100, 15]]),
  ];
  if (dense) for (const x of [30, 65]) features.push(way({ class: 'minor' }, [[x, 0], [x, 130]]));
  if (tunnelPassage) features.push(
    way({ class: 'minor' }, [[-150,150],[-16,150]]),
    way({ class: 'minor', brunnel:'tunnel', layer:-1 }, [[-16,150],[16,150]]),
    way({ class: 'minor' }, [[16,150],[150,150]]),
  );
  if (passage) features.push(way({ class: 'minor' }, [[-50, 150], [50, 150]]));
  if (access) features.push(way({ class: 'cycleway' }, [[16, 0], [35, 70]]));
  if (neighbour) features.push(way({ class: 'minor' }, [[12, 70], [12, 200]]));
  if (double) features.push(
    way({ class: 'minor' }, [[-300, 200], [-16, 200]]),
    way({ class: 'minor', brunnel: 'bridge', layer: 1 }, [[-16, 200], [16, 200]]),
    way({ class: 'minor' }, [[16, 200], [300, 200]]),
  );
  if (reverse) features.reverse();
  const source = { forEachFeature(layer, tiles, visit) { if (layer === 'transportation') for (const f of features) visit(f.geometry, f.properties); } };
  const rails = collectCrossingRails(source, [], frame, terrain);
  const result = collectRoadSegments(source, [], { x: observer, z: 0 }, frame, terrain, 900, undefined, { railwaySegments: rails, bench: 6 });
  const earth = new TransportEarthworks([...result.segments, ...rails], { bench: 6 });
  return { ...result, rails, earth };
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.03, `${message}: ${a} / ${b}`);

test('un pont routier creuse uniquement les rails inférieurs et garde ses accès', () => {
  const f = fixture({ rail: true });
  assert.equal(f.crossings.length, 1);
  assert.equal(f.crossings[0].reason, 'rail');
  assert.ok(f.crossings[0].cut > 8);
  for (const s of f.segments) for (const h of s.platform) near(h, 50, 'route et chemin inchangés');
  near(f.earth.sample(0, 0, 50).elevation, 41.5, 'fond de tranchée');
  near(f.earth.sample(80, 0, 50).elevation, 50, 'parcelle hors tranchée');
  near(f.earth.sample(0, 650, 50).elevation, 50, 'raccord lointain');
});

test('un passage à niveau isolé ne déclenche aucune tranchée', () => {
  const f = fixture({ rail: true, bridge: false });
  assert.equal(f.crossings.length, 0);
  near(f.earth.sample(0, 0, 50).elevation, 50, 'terrain au croisement');
});

test('la tranchée rejoint le niveau naturel avant le passage à niveau voisin', () => {
  const f = fixture({ rail: true, passage: true });
  near(f.earth.sample(0, 150, 50).elevation, 50, 'passage protégé');
  near(f.earth.sample(0, 0, 50).elevation, 41.5, 'gabarit conservé sous le pont');
});

test('une autoroute partage le dégagement avec le remblai supérieur', () => {
  const f = fixture({ motorway: true });
  assert.equal(f.crossings[0].reason, 'autoroute');
  assert.ok(f.crossings[0].lift > 3);
  assert.ok(f.crossings[0].cut > 0 && f.crossings[0].cut <= 1.5);
  assert.ok(f.earth.sample(35, 8, 50).elevation > 51, 'le terrain porte aussi le bord de la route');
  near(f.earth.sample(35, 80, 50).elevation, 50, 'le remblai reste local');
  assert.ok(f.earth.sample(0, 0, 50).elevation < 49, 'le creux reste ouvert sous le pont');
  const path = f.segments.find((s) => s.profile === 'path');
  for (const h of path.platform) near(h, 50, 'aucune propagation de rampe au chemin');
});

test('les carrefours voisins préservent le niveau supérieur même sur autoroute', () => {
  const f = fixture({ motorway: true, dense: true });
  assert.equal(f.crossings[0].reason, 'carrefours');
  near(f.crossings[0].lift, 0, 'pas de relèvement des rues');
  near(f.crossings[0].cut, 5.5, 'déblai du passage inférieur');
});

test('un niveau supérieur ne devient pas un obstacle inférieur', () => {
  const f = fixture({ high: true });
  assert.equal(f.crossings.length, 0);
});

test('le relief corrigé est indépendant de l’ordre des entités et ne se cumule pas', () => {
  const a = fixture({ motorway: true }), b = fixture({ motorway: true, reverse: true }), c = fixture({ motorway: true });
  for (let x = -120; x <= 120; x += 8) for (let z = -60; z <= 60; z += 8) {
    near(a.earth.sample(x, z, 50).elevation, b.earth.sample(x, z, 50).elevation, 'ordre des données');
    near(a.earth.sample(x, z, 50).elevation, c.earth.sample(x, z, 50).elevation, 'reconstruction');
  }
});

test('terrain et pose des objets lisent le même remblai, avec exagération verticale', () => {
  const f = fixture({ motorway: true });
  const bubble = Object.create(TerrainBubble.prototype);
  bubble.verticalScale = 2;
  Object.defineProperty(bubble, 'cutBenchM', { value: 6 });
  bubble._earthworks = new TransportEarthworks(f.segments, { bench: 6, scale: 2 });
  bubble._roadCut = new RoadIndex(f.segments.filter((s) => s.paved), { margin: 11 });
  const result = bubble.cutElevation(35, 8, 25);
  bubble.verticalScale = 1;
  bubble._earthworks = f.earth;
  near(result * 2, bubble.cutElevation(35, 8, 50), 'même cote en unités de scène');
});


test('une voie proche mais parallèle au pont ne déclenche pas de creusement', () => {
  const f = fixture({ rail: true, parallel: true });
  assert.equal(f.crossings.length, 0);
  near(f.earth.sample(0, 20, 50).elevation, 50, 'voie voisine intacte');
});

test('deux ponts voisins partagent une tranchée sans additionner les profondeurs', () => {
  const f = fixture({ rail: true, double: true });
  assert.equal(f.crossings.length, 2);
  near(f.earth.sample(0, 0, 50).elevation, 41.5, 'premier passage');
  near(f.earth.sample(0, 200, 50).elevation, 41.5, 'second passage');
  assert.ok(Math.min(...f.rails.flatMap((s) => [...s.platform])) >= 41.49);
});

test('déplacer l’observateur conserve les profils du même franchissement', () => {
  const a = fixture({ rail: true }), b = fixture({ rail: true, observer: 80 });
  for (let z = -300; z <= 300; z += 7) {
    near(a.earth.sample(0, z, 50).elevation, b.earth.sample(0, z, 50).elevation, 'altitude stable');
  }
});


test('la piste qui rejoint la culée reste un accès et ne devient pas une tranchée', () => {
  const f = fixture({ rail: true, access: true });
  assert.equal(f.crossings.length, 1);
  assert.ok(f.crossings.every((c) => c.rail));
  for (const segment of f.segments) for (const height of segment.platform) near(height, 50, 'accès conservés');
});

test('un accès cyclable séparé rejoint exactement la cote du tablier', () => {
  const bridge = { path: [{ x: -5, z: 0, distance: 0 }, { x: 5, z: 0, distance: 10 }],
    works: [1, 1], platform: new Float32Array([50.4, 50.4]) };
  const access = { path: [{ x: 5, z: 0, distance: 0 }, { x: 5, z: 40, distance: 40 }],
    platform: new Float32Array([50, 50]) };
  stitchBridgeAccesses([bridge, access]);
  near(access.platform[0], bridge.platform[1], 'raccord sans marche');
  near(access.platform[1], 50, 'la correction reste locale');
});

test('la tranchée ferroviaire conserve le sol sous une route parallèle voisine', () => {
  const f = fixture({ rail: true, neighbour: true });
  near(f.earth.sample(12, 120, 50).elevation, 50, 'sol sous la route voisine');
  assert.ok(f.earth.sample(0, 120, 50).elevation < 45, 'le fond ferroviaire reste dégagé');
  assert.ok(f.earth.sample(12, 120, 50).supported, 'le soutien est intégré au terrain');
});


test('la tranchée d’un pont ne se propage pas sur le rail qui porte un tunnel voisin', () => {
  const f=fixture({rail:true,tunnelPassage:true});
  near(f.earth.sample(0,0,50).elevation,41.5,'le premier pont garde son passage libre');
  near(f.earth.sample(0,150,50).elevation,50,'la voie supérieure reste au terrain naturel');
  const tunnel=f.segments.flatMap(s=>s.tunnelStructures??[])[0];
  assert.equal(tunnel.kind,'underpass');
  near(tunnel.platform[0],44.5,'un seul dégagement est ménagé, sans cumuler les creux');
});
