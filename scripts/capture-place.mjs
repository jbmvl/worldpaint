#!/usr/bin/env node
/*
 * capture-place — enregistre les tuiles d'un lieu réel (MNT et tuiles
 * vectorielles) dans `demo/lab/places/<nom>/`, pour que le banc des lieux
 * (`demo/lab/place.html`) le rejoue ensuite sans réseau.
 *
 *   node scripts/capture-place.mjs montreuil-bellay -0.1450 47.1310 "Montreuil-Bellay"
 *
 * Les sources sont celles de la démo : OpenFreeMap pour les tuiles vectorielles
 * (via son TileJSON), Mapterhorn pour le MNT, puis MapTiler et Terrarium d'AWS
 * Open Data s'il refuse. Ce qui n'a pu être lu est dit, et le lieu reste
 * utilisable avec ce qu'on a : un relief nu vaut mieux que rien.
 *
 *   node scripts/capture-place.mjs lyon --mnt-seul   // refait le seul MNT d'un lieu enregistré
 *
 * Couvre `--tuiles` tuiles de zoom 14 autour du point (défaut 1, soit 3×3) :
 * au moins ce que la bulle de la démo charge autour du point de départ. Le MNT
 * du relief lointain est enregistré avec, à son zoom, sur toute la nappe.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEM_OVERZOOM_LEVELS } from '../src/core/elevationField.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const demOnly = args.includes('--mnt-seul');
if (demOnly) args.splice(args.indexOf('--mnt-seul'), 1);
const saved = demOnly ? JSON.parse(readFileSync(join('demo', 'lab', 'places', args[0], 'place.json'), 'utf8')) : null;
if (saved) args.splice(1, 0, String(saved.lng), String(saved.lat), saved.label);
const ring = Number(flag('tuiles', saved ? (Math.sqrt(saved.tiles) - 1) / 2 : 1));
const [name, lngText, latText, label = name] = args;
if (!name || !Number.isFinite(Number(lngText)) || !Number.isFinite(Number(latText))) {
  console.error('usage : node scripts/capture-place.mjs <nom> <lng> <lat> [libellé] [--tuiles 1]');
  process.exit(1);
}
const lng = Number(lngText);
const lat = Number(latText);
const ZOOM = 14;
/** Zoom du MNT, celui de la démo (`DEFAULT_ELEVATION_ZOOM`). */
const DEM_ZOOM = 13;

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

/**
 * Enregistre toutes les tuiles d'une source ; rend le nombre de tuiles
 * couvertes. Pour le MNT, une tuile absente (404) est remplacée par sa plus
 * proche parente, que le moteur découpe de même (`DEM_OVERZOOM_LEVELS`).
 */
async function capture(kind, template, extension, list = tiles, zoom = ZOOM) {
  let written = 0;
  let coarse = 0;
  for (const { x, y } of list) {
    for (let cut = 0; cut <= (kind === 'dem' ? DEM_OVERZOOM_LEVELS : 0); cut++) {
      const [z, tx, ty] = [zoom - cut, x >> cut, y >> cut];
      const res = await fetch(fill(template, z, tx, ty)).catch((err) => ({ ok: false, status: err.message }));
      if (res.status === 404 && kind === 'dem') continue;
      if (!res.ok) {
        console.warn(`[${kind}] ${z}/${tx}/${ty} : HTTP ${res.status}`);
        break;
      }
      const dir = join(root, kind, String(z), String(tx));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${ty}.${extension}`), new Uint8Array(await res.arrayBuffer()));
      written++;
      if (cut) coarse++;
      break;
    }
  }
  if (coarse) console.log(`[${kind}] ${coarse} tuile(s) du ${zoom} lues dans une parente`);
  return written;
}

const manifest = saved ?? { name, label, lng, lat, zoom: ZOOM, tiles: tiles.length };

// Le relief lointain lit un MNT plus grossier (`farRelief.js`), sur toute sa
// nappe : les tuiles de ce zoom qui couvrent `farBlockSize` tuiles de la bulle.
const VIEW_ZOOM = 15;
const FAR_ZOOM = VIEW_ZOOM - 5;
const FAR_BLOCK = 31;
const farTiles = [];
{
  const c = tileOf(lng, lat, VIEW_ZOOM);
  const k = 2 ** (VIEW_ZOOM - FAR_ZOOM);
  const half = (FAR_BLOCK - 1) / 2;
  for (let y = Math.floor((c.y - half - ring * 2) / k); y <= Math.floor((c.y + half + ring * 2 + 1) / k); y++) {
    for (let x = Math.floor((c.x - half - ring * 2) / k); x <= Math.floor((c.x + half + ring * 2 + 1) / k); x++) farTiles.push({ x, y });
  }
}

// --- MNT ------------------------------------------------------------------
const DEM_SOURCES = [
  { url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', encoding: 'terrarium', extension: 'webp' },
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
if (demOnly) {
  delete manifest.elevation;
  rmSync(join(root, 'dem'), { recursive: true, force: true });
}
for (const source of DEM_SOURCES) {
  const demTiles = [...new Map(tiles.map(({ x, y }) => {
    const k = 2 ** (ZOOM - DEM_ZOOM);
    return [`${Math.floor(x / k)}/${Math.floor(y / k)}`, { x: Math.floor(x / k), y: Math.floor(y / k) }];
  })).values()];
  const written = await capture('dem', source.url, source.extension, demTiles, DEM_ZOOM);
  if (written === 0) continue;
  manifest.elevation = { zoom: DEM_ZOOM, encoding: source.encoding, extension: source.extension, source: new URL(source.url).host };
  console.log(`MNT : ${written}/${demTiles.length} tuiles du ${DEM_ZOOM} (${manifest.elevation.source})`);
  const far = await capture('dem', source.url, source.extension, farTiles, FAR_ZOOM);
  console.log(`MNT lointain : ${far}/${farTiles.length} tuiles de zoom ${FAR_ZOOM}`);
  break;
}
if (!manifest.elevation) console.warn('MNT : aucune source joignable — le lieu sera plat.');

// --- Tuiles vectorielles ----------------------------------------------------
if (!demOnly) try {
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
