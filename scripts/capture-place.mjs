#!/usr/bin/env node
/*
 * capture-place — enregistre les tuiles d'un lieu réel (MNT et tuiles
 * vectorielles) dans `demo/lab/places/<nom>/`, pour que le banc des lieux
 * (`demo/lab/place.html`) le rejoue ensuite sans réseau.
 *
 *   node scripts/capture-place.mjs montreuil-bellay -0.1450 47.1310 "Montreuil-Bellay"
 *
 * Les sources sont celles de la démo : OpenFreeMap pour les tuiles vectorielles
 * (via son TileJSON), MapTiler pour le MNT. Si MapTiler refuse, le MNT vient
 * des tuiles Terrarium d'AWS Open Data. Ce qui n'a pu être lu est dit, et le
 * lieu reste utilisable avec ce qu'on a : un relief nu vaut mieux que rien.
 *
 * Couvre `--tuiles` tuiles de zoom 14 autour du point (défaut 1, soit 3×3) :
 * au moins ce que la bulle de la démo charge autour du point de départ.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const ring = Number(flag('tuiles', 1));
const [name, lngText, latText, label = name] = args;
if (!name || !Number.isFinite(Number(lngText)) || !Number.isFinite(Number(latText))) {
  console.error('usage : node scripts/capture-place.mjs <nom> <lng> <lat> [libellé] [--tuiles 1]');
  process.exit(1);
}
const lng = Number(lngText);
const lat = Number(latText);
const ZOOM = 14;

const tileOf = (lngDeg, latDeg, z) => {
  const n = 2 ** z;
  const rad = (latDeg * Math.PI) / 180;
  return {
    x: Math.floor(((lngDeg + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
};
const fill = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

const root = join('demo', 'lab', 'places', name);
const centre = tileOf(lng, lat, ZOOM);
const tiles = [];
for (let dy = -ring; dy <= ring; dy++) {
  for (let dx = -ring; dx <= ring; dx++) tiles.push({ x: centre.x + dx, y: centre.y + dy });
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Enregistre toutes les tuiles d'une source ; rend le nombre écrit. */
async function capture(kind, template, extension) {
  let written = 0;
  for (const { x, y } of tiles) {
    const url = fill(template, ZOOM, x, y);
    try {
      const bytes = await fetchBytes(url);
      const dir = join(root, kind, String(ZOOM), String(x));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${y}.${extension}`), bytes);
      written++;
    } catch (err) {
      console.warn(`[${kind}] ${ZOOM}/${x}/${y} : ${err.message}`);
    }
  }
  return written;
}

const manifest = { name, label, lng, lat, zoom: ZOOM, tiles: tiles.length };

// --- MNT ------------------------------------------------------------------
const DEM_SOURCES = [
  {
    url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=Zx2mAQIInk7YylLgVH0R',
    encoding: 'terrain-rgb',
    extension: 'webp',
  },
  {
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    encoding: 'terrarium',
    extension: 'png',
  },
];
for (const source of DEM_SOURCES) {
  const written = await capture('dem', source.url, source.extension);
  if (written === 0) continue;
  manifest.elevation = { encoding: source.encoding, extension: source.extension, source: new URL(source.url).host };
  console.log(`MNT : ${written}/${tiles.length} tuiles (${manifest.elevation.source})`);
  break;
}
if (!manifest.elevation) console.warn('MNT : aucune source joignable — le lieu sera plat.');

// --- Tuiles vectorielles ----------------------------------------------------
try {
  const res = await fetch('https://tiles.openfreemap.org/planet');
  if (!res.ok) throw new Error(`TileJSON : HTTP ${res.status}`);
  const tilejson = await res.json();
  const written = await capture('vector', tilejson.tiles[0], 'pbf');
  if (written > 0) {
    manifest.vector = { maxZoom: tilejson.maxzoom ?? ZOOM, source: new URL(tilejson.tiles[0]).host };
    console.log(`Tuiles vectorielles : ${written}/${tiles.length} (${manifest.vector.source})`);
  }
} catch (err) {
  console.warn(`Tuiles vectorielles : ${err.message}`);
}
if (!manifest.vector) console.warn('Tuiles vectorielles : aucune — le lieu n’aura ni route ni bâti.');

mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'place.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`→ ${join(root, 'place.json')}`);
