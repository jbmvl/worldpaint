#!/usr/bin/env node
/*
 * roadside-views — tire au sort des routes revêtues dans chaque région d'une
 * emprise, enregistre chaque lieu (`capture-place.mjs`, réseau ouvert) et le
 * photographie au banc des lieux depuis la chaussée, à hauteur d'une caméra
 * de Street View, dans l'axe de la route : de quoi poser la même vue à côté
 * d'une photo réelle.
 *
 *   node scripts/roadside-views.mjs <dossier> [--emprise 12.3,36.5,15.7,38.35]
 *     [--par 3] [--graine 1] [--date 10-15] [--heure 15] [--hauteur 3] [--plongee 6]
 *     [--saison automne]
 *
 * Une région compte si une de ses ancres tombe dans l'emprise ; un point tiré
 * n'est gardé que si `regionAt` le range bien dans cette région. Rend dans le
 * dossier une image par vue et `vues.json` (lieu, région, point, cap), que
 * l'on rejoue dans Street View. `--tirage-seul` s'arrête à `vues.json`, pour
 * n'y garder que les points couverts par Street View ; un `vues.json` présent
 * dans le dossier est repris tel quel au lieu d'un nouveau tirage.
 *
 * Avec une clé de l'API Street View (`GOOGLE_MAPS_KEY`), un point n'est gardé
 * que s'il a un panorama à moins de 50 m pris l'un des mois `--mois`
 * (défaut 9,10,11) ; la vue se pose sur le panorama, prend sa date, et la
 * photo réelle est enregistrée à côté (`<lieu>-sv.jpg`, même cap, même plongée,
 * même champ horizontal). L'API ne donne que le panorama le plus récent. Les lieux s'écrivent dans `demo/lab/places/`
 * du dépôt courant : lancer depuis une copie pour ne pas l'encombrer.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { REGIONS } from '../src/core/regions.js';
import { regionAt } from '../src/core/region.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const [w, s, e, n] = flag('emprise', '12.3,36.5,15.7,38.35').split(',').map(Number);
const perRegion = Number(flag('par', 3));
let seed = Number(flag('graine', 1)) >>> 0 || 1;
const date = flag('date', '10-15');
const hour = Number(flag('heure', 15));
const height = Number(flag('hauteur', 3));
const pitch = Number(flag('plongee', 6));
const season = flag('saison', 'automne');
const months = flag('mois', '9,10,11').split(',').map(Number);
const KEY = process.env.GOOGLE_MAPS_KEY;
const SV = 'https://maps.googleapis.com/maps/api/streetview';
/** Le panorama le plus proche s'il est d'un mois voulu, ou null. */
async function panorama(lng, lat) {
  const res = await fetch(`${SV}/metadata?location=${lat},${lng}&radius=50&source=outdoor&key=${KEY}`).catch(() => null);
  const meta = res?.ok ? await res.json() : null;
  if (meta?.status !== 'OK' || !meta.date) return null;
  const month = Number(meta.date.split('-')[1]);
  return months.includes(month) ? { id: meta.pano_id, date: meta.date, lng: meta.location.lng, lat: meta.location.lat } : null;
}
const [outDir] = args;
if (!outDir) {
  console.error('usage : node scripts/roadside-views.mjs <dossier> [--emprise o,s,e,n] [--par 3] [--graine 1]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const ZOOM = 14;
const TRIES = KEY ? 150 : 60;
const APART_M = 4000;
// Les routes que les voitures de Street View parcourent ; l'autoroute est close.
const PAVED = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

function random() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const tileOf = (lng, lat) => {
  const k = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * k), Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * k)];
};
const metres = ([a, b], [c, d]) => Math.hypot((c - a) * 111320 * Math.cos((b * Math.PI) / 180), (d - b) * 110540);

const template = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles[0];
async function roadsAround(lng, lat) {
  const [x, y] = tileOf(lng, lat);
  const res = await fetch(template.replace('{z}', ZOOM).replace('{x}', x).replace('{y}', y)).catch(() => null);
  if (!res?.ok) return [];
  const layer = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.transportation;
  if (!layer) return [];
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i).toGeoJSON(x, y, ZOOM);
    if (!PAVED.has(f.properties.class) || f.properties.brunnel === 'tunnel') continue;
    const lines = f.geometry.type.startsWith('Multi') ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) for (let j = 1; j < line.length; j++) {
      if (metres(line[j - 1], line[j]) > 15) out.push([line[j - 1], line[j], f.properties.class]);
    }
  }
  return out;
}

/** Cap d'un tronçon en degrés, 0 vers le nord. */
const bearing = ([a, b], [c, d]) =>
  ((Math.atan2((c - a) * Math.cos((b * Math.PI) / 180), d - b) * 180) / Math.PI + 360) % 360;

const drawOnly = args.includes('--tirage-seul');
if (drawOnly) args.splice(args.indexOf('--tirage-seul'), 1);
const listed = join(outDir, 'vues.json');

const regions = REGIONS.filter((r) => r.anchors.some(([x, y]) => x > w && x < e && y > s && y < n));
const views = existsSync(listed) ? JSON.parse(readFileSync(listed, 'utf8')) : [];
for (const region of views.length ? [] : regions) {
  const anchors = region.anchors.filter(([x, y]) => x > w && x < e && y > s && y < n);
  const reachKm = region.reachKm ?? 15;
  let found = 0;
  for (let tries = 0; found < perRegion && tries < perRegion * TRIES; tries++) {
    const [ax, ay] = anchors[Math.floor(random() * anchors.length)];
    const r = reachKm * Math.sqrt(random()), t = random() * 2 * Math.PI;
    const lng = ax + (r * Math.cos(t)) / (111.32 * Math.cos((ay * Math.PI) / 180));
    const lat = ay + (r * Math.sin(t)) / 110.54;
    if (regionAt(lng, lat)?.id !== region.id) continue;
    const roads = await roadsAround(lng, lat);
    if (!roads.length) continue;
    const [a, b, cls] = roads[Math.floor(random() * roads.length)];
    // Un sommet du tracé, sur l'axe de la chaussée : le milieu d'une corde en courbe tombe à côté.
    let mid = a;
    if (regionAt(...mid)?.id !== region.id) continue;
    if (views.some((v) => metres([v.lng, v.lat], mid) < APART_M)) continue;
    const pano = KEY ? await panorama(...mid) : null;
    if (KEY && !pano) continue;
    if (pano) mid = [pano.lng, pano.lat];
    found++;
    const heading = Math.round(bearing(a, b));
    views.push({ lieu: `sv-${region.id}-${Math.round(mid[0] * 1000)}-${Math.round(mid[1] * 1000)}`, region: region.id, matrix: region.matrix, route: cls,
      lng: +mid[0].toFixed(5), lat: +mid[1].toFixed(5), cap: heading, ...(pano ? { pano: pano.id, prise: pano.date } : {}) });
    console.error(`${region.id} ${found} : ${mid[1].toFixed(5)},${mid[0].toFixed(5)} cap ${heading} (${cls})${pano ? ` ${pano.date}` : ''}`);
  }
}
writeFileSync(listed, JSON.stringify(views, null, 2));
if (drawOnly) process.exit(0);

for (const v of views) {
  if (!existsSync(join('demo', 'lab', 'places', v.lieu, 'place.json'))) {
    spawnSync(process.execPath, ['scripts/capture-place.mjs', v.lieu, String(v.lng), String(v.lat)], { stdio: 'inherit' });
  }
  if (v.pano && KEY && !existsSync(join(outDir, `${v.lieu}-sv.jpg`))) {
    const res = await fetch(`${SV}?size=640x400&pano=${v.pano}&heading=${v.cap}&pitch=${-pitch}&fov=90&key=${KEY}`).catch(() => null);
    if (res?.ok) writeFileSync(join(outDir, `${v.lieu}-sv.jpg`), Buffer.from(await res.arrayBuffer()));
  }
  // Le 15 du mois de la prise de vue réelle, sinon `--date`. 64° vertical sur 960×600 : 90° horizontal.
  const day = v.prise ? `${v.prise.split('-')[1]}-15` : date;
  const shot = [{ x: 0, z: 0, yawDeg: v.cap, pitchDeg: pitch, height, date: day, hour, fov: 64 }];
  const dir = join(outDir, v.lieu);
  // La saison de la prise de vue réelle : l'automne de septembre à novembre, l'été sinon.
  const theme = v.prise ? ([9, 10, 11].includes(Number(v.prise.split('-')[1])) ? 'automne' : '') : season;
  spawnSync(process.execPath, ['scripts/place-shot.mjs', dir, JSON.stringify(shot), v.lieu, theme], { stdio: 'inherit' });
  if (existsSync(join(dir, '00.png'))) renameSync(join(dir, '00.png'), join(outDir, `${v.lieu}.png`));
}
