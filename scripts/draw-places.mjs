#!/usr/bin/env node
/*
 * draw-places — tire au sort des lieux à contrôler : un point au hasard dans
 * des zones pentues, fluviales, lacustres ou côtières, gardé seulement si sa
 * tuile porte assez de chaussée (routes, chemins) et, hors montagne, de l'eau.
 * Le lieu est recentré sur un point de chaussée, au plus près de l'eau quand il
 * y en a : c'est depuis la route qu'on regarde. Rend la liste que lit
 * `scripts/slope-bench.mjs`.
 *
 *   node scripts/draw-places.mjs [--graine 1] [--par 4] [--sortes relief,riviere,lac,cote] > lieux.json
 *
 * La graine rend le même tirage ; seules les tuiles vectorielles (OpenFreeMap)
 * sont lues, pas le relief : la pente d'un lieu se juge ensuite au banc.
 */
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
let seed = Number(flag('graine', 1)) >>> 0 || 1;
const perKind = Number(flag('par', 4));
const kinds = flag('sortes', 'relief,riviere,lac,cote').split(',');
const ZOOM = 14;
const TRIES = 40;
/** Écart minimal entre deux lieux tirés : pas deux fois le même versant. */
const APART_M = 5000;

/** Emprises [ouest, sud, est, nord] où tirer, par sorte. */
const ZONES = {
  relief: [
    [5.6, 44.6, 7.2, 46.2], // Alpes françaises
    [-1.2, 42.6, 2.4, 43.1], // Pyrénées
    [2.4, 44.2, 3.6, 45.4], // Massif central
    [9.5, 46.2, 12.2, 47.0], // Alpes centrales
    [-5.2, 43.0, -4.4, 43.3], // Picos de Europa
    [13.6, 46.2, 14.4, 46.6], // Alpes juliennes
  ],
  riviere: [
    [1.0, 44.7, 1.6, 44.95], // Dordogne
    [3.0, 44.1, 3.6, 44.4], // gorges du Tarn
    [7.55, 49.9, 7.8, 50.2], // Rhin moyen
    [6.6, 46.95, 7.1, 47.4], // Doubs
    [-0.3, 47.2, 1.0, 47.45], // Loire
    [14.2, 48.35, 15.2, 48.45], // Wachau
    [-8.0, 41.05, -7.4, 41.25], // Douro
  ],
  lac: [
    [6.1, 45.75, 6.3, 45.92], // Annecy
    [5.8, 45.62, 5.95, 45.82], // Bourget
    [10.6, 45.55, 10.9, 45.9], // Garde
    [9.05, 45.8, 9.45, 46.15], // Côme
    [8.3, 46.95, 8.65, 47.07], // Quatre-Cantons
    [6.5, 46.38, 6.95, 46.52], // Léman nord
    [13.4, 47.53, 13.7, 47.75], // Salzkammergut
  ],
  cote: [
    [-4.8, 47.75, -3.6, 48.1], // Finistère sud
    [-1.8, 43.35, -1.5, 43.5], // côte basque
    [-5.7, 50.0, -4.8, 50.3], // Cornouailles
    [-9.3, 42.6, -8.8, 43.3], // Galice
    [14.4, 40.58, 14.75, 40.67], // côte amalfitaine
    [6.9, 43.4, 7.5, 43.75], // Riviera
    [9.3, 42.2, 9.6, 43.0], // Cap Corse, côte est
  ],
};

const ROAD_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'minor', 'track', 'path', 'service']);
const WATER_CLASSES = { riviere: ['river'], lac: ['lake'], cote: ['ocean'] };

function random() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const tileOf = (lng, lat) => {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)];
};

const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const template = tilejson.tiles[0];

async function readTile(x, y) {
  const res = await fetch(template.replace('{z}', ZOOM).replace('{x}', x).replace('{y}', y));
  if (!res.ok) return null;
  return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
}

const features = (tile, layer, x, y) => {
  const l = tile.layers[layer];
  return l ? Array.from({ length: l.length }, (_, i) => l.feature(i).toGeoJSON(x, y, ZOOM)) : [];
};
const lines = (geometry) => (geometry.type.startsWith('Multi') ? geometry.coordinates : [geometry.coordinates]);
const points = (geometry) => {
  const c = geometry.type === 'Polygon' || geometry.type === 'MultiLineString' ? geometry.coordinates.flat()
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(2) : geometry.type === 'LineString' ? geometry.coordinates : [];
  return c;
};
const metres = ([a, b], [c, d]) => Math.hypot((c - a) * 111320 * Math.cos((b * Math.PI) / 180), (d - b) * 110540);

/** Un lieu de la sorte voulue, ou null si le point tiré ne convient pas. */
async function judge(kind, lng, lat) {
  const [x, y] = tileOf(lng, lat);
  const tile = await readTile(x, y).catch(() => null);
  if (!tile) return null;
  const roads = features(tile, 'transportation', x, y).filter((f) => ROAD_CLASSES.has(f.properties.class));
  const km = roads.reduce((sum, f) => sum + lines(f.geometry).reduce((s, line) => s + line.slice(1).reduce((t, p, i) => t + metres(line[i], p), 0), 0), 0) / 1000;
  if (km < 3) return null;
  const vertices = roads.filter((f) => f.properties.class !== 'service').flatMap((f) => lines(f.geometry).flat());
  if (!vertices.length) return null;
  const want = WATER_CLASSES[kind];
  if (!want) return { centre: vertices[Math.floor(random() * vertices.length)], km };
  const water = [
    ...features(tile, 'water', x, y).filter((f) => want.includes(f.properties.class)),
    ...(kind === 'riviere' ? features(tile, 'waterway', x, y).filter((f) => f.properties.class === 'river') : []),
  ].flatMap((f) => points(f.geometry));
  if (water.length < 4) return null;
  // Le point de chaussée le plus proche de l'eau, parmi un échantillon tiré.
  let best = null;
  for (let i = 0; i < 200; i++) {
    const v = vertices[Math.floor(random() * vertices.length)];
    let d = Infinity;
    for (let j = 0; j < water.length; j += Math.ceil(water.length / 400)) d = Math.min(d, metres(v, water[j]));
    if (d > 20 && (!best || d < best.d)) best = { v, d };
  }
  return best && best.d < 250 ? { centre: best.v, km, eau: Math.round(best.d) } : null;
}

const places = [];
for (const kind of kinds) {
  let found = 0;
  for (let tries = 0; found < perKind && tries < perKind * TRIES; tries++) {
    const zones = ZONES[kind];
    const [w, s, e, n] = zones[Math.floor(random() * zones.length)];
    const lng = w + random() * (e - w);
    const lat = s + random() * (n - s);
    const hit = await judge(kind, lng, lat);
    if (!hit || places.some((p) => metres([p.lng, p.lat], hit.centre) < APART_M)) continue;
    found++;
    const [plng, plat] = hit.centre.map((v) => +v.toFixed(5));
    const name = `pente-${kind}-${found}-${Math.abs(Math.round(plng * 100))}-${Math.round(plat * 100)}`;
    places.push({ name, lng: plng, lat: plat, sorte: kind, km: +hit.km.toFixed(1), ...(hit.eau ? { eau: hit.eau } : {}) });
    console.error(`${name}  ${plat},${plng}  ${hit.km.toFixed(1)} km${hit.eau ? `, eau à ${hit.eau} m` : ''}`);
  }
}
console.log(JSON.stringify({ graine: Number(flag('graine', 1)), places }, null, 2));
