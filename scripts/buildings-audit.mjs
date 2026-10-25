#!/usr/bin/env node
/*
 * buildings-audit — le semis du bâti (`layers/buildingInfill.js`) confronté au
 * bâti réel, sans navigateur.
 *
 *   node scripts/buildings-audit.mjs [site ...] [--json <fichier>] [--dims '<cotes JSON>']
 *
 * `--dims` remplace des cotes de `INFILL_DIMENSIONS` le temps d'une mesure.
 *
 * Chaque site de `demo/lab/infill/` est un carré de 2 km tiré d'Overture Maps :
 * routes et `landuse` OSM, bâtiments OSM et bâtiments détectés (Microsoft,
 * Google). Le semis reçoit ce que la démo recevrait — les bâtiments OSM seuls —
 * et son résultat est comparé à l'ensemble, qui fait office de vérité.
 *
 * Mesuré dans l'emprise résidentielle, à plus de 150 m du bord du carré :
 *   - maisons de premier rang par 100 m de rue bâtie (un côté), vérité contre
 *     OSM seul et contre OSM + semis ;
 *   - rappel : part des maisons réelles absentes d'OSM qu'une maison semée
 *     occupe (centre à moins de 15 m) ;
 *   - fantômes : part des bâtiments semés sans bâtiment réel à moins de 20 m ;
 *   - recul, longueur, largeur, part pignon sur rue : semis contre vérité ;
 *   - durée du semis.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalFrame, lngToTileX, latToTileY } from '../src/core/tileMath.js';
import { RoadIndex } from '../src/layers/roadGraph.js';
import { ROAD_CLASSES } from '../src/layers/roadNetwork.js';
import { ROAD_PROFILES } from '../src/themes/default.js';
import { planInfill, INFILL_STREET_PROFILES, INFILL_DIMENSIONS } from '../src/layers/buildingInfill.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'demo', 'lab', 'infill');
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const dimsAt = args.indexOf('--dims');
const dimsOverride = dimsAt >= 0 ? JSON.parse(args.splice(dimsAt, 2)[1]) : {};
const wanted = args.length ? args : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

const ROAD_CLASS_ALIASES = { residential: 'minor', unclassified: 'minor', living_street: 'minor' };
const INNER_M = 850;
const FRONT_M = 25;
const GROUP_M = 12;

const quant = (values, qs = [0.25, 0.5, 0.75]) => {
  if (!values.length) return qs.map(() => null);
  const s = [...values].sort((a, b) => a - b);
  return qs.map((q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] * 10) / 10);
};

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) / (b.z - a.z || 1)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Rectangle d'aire minimale (côtés de l'enveloppe convexe) : longueur, largeur, axe long. */
function orientedSize(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.3) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const u = p.x * ux + p.z * uz, v = -p.x * uz + p.z * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const du = u1 - u0, dv = v1 - v0;
      best = { area, length: Math.max(du, dv), width: Math.min(du, dv), ax: du >= dv ? ux : -uz, az: du >= dv ? uz : ux };
    }
  }
  return best;
}

/** Rue la plus proche d'un anneau : distance de l'anneau à l'axe, point, direction, côté. */
function nearestStreet(streets, ring, cx, cz) {
  let best = null;
  streets.forEach((s, si) => {
    let along = 0;
    for (let i = 1; i < s.path.length; i++) {
      const a = s.path[i - 1], b = s.path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const t = Math.max(0, Math.min(len, (cx - a.x) * ux + (cz - a.z) * uz));
      const d = Math.hypot(cx - (a.x + ux * t), cz - (a.z + uz * t));
      if (!best || d < best.centre) best = { centre: d, street: si, ux, uz, along: along + t, px: a.x + ux * t, pz: a.z + uz * t, side: Math.sign((cx - a.x) * -uz + (cz - a.z) * ux), a, len };
      along += len;
    }
  });
  if (!best) return null;
  // Recul : du sommet le plus proche à l'axe du segment retenu.
  const { a, ux, uz, len } = best;
  best.setback = Math.min(...ring.map((p) => {
    const t = Math.max(0, Math.min(len, (p.x - a.x) * ux + (p.z - a.z) * uz));
    return Math.hypot(p.x - (a.x + ux * t), p.z - (a.z + uz * t));
  }));
  return best;
}

/** Maisons de premier rang : le plus grand bâtiment de chaque groupe de 12 m le long d'un côté de rue. */
function frontHouses(items) {
  const lines = new Map();
  for (const it of items) {
    if (!it.near || it.near.setback >= FRONT_M) continue;
    const key = `${it.near.street},${it.near.side}`;
    (lines.get(key) ?? lines.set(key, []).get(key)).push(it);
  }
  const houses = [];
  for (const list of lines.values()) {
    list.sort((p, q) => p.near.along - q.near.along);
    let group = [];
    for (const it of list) {
      if (group.length && it.near.along - group[group.length - 1].near.along >= GROUP_M) {
        houses.push(group.reduce((m, g) => (g.size.area > m.size.area ? g : m)));
        group = [];
      }
      group.push(it);
    }
    if (group.length) houses.push(group.reduce((m, g) => (g.size.area > m.size.area ? g : m)));
  }
  return houses;
}

function audit(name) {
  const site = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const [lng, lat] = site.center;
  const frame = createLocalFrame(lng, lat, 15);
  const local = ([x, y]) => ({ x: (lngToTileX(x, frame.zoom) - frame.origin.x) * frame.scale, z: (latToTileY(y, frame.zoom) - frame.origin.y) * frame.scale });
  const centre = local(site.center);

  const streets = [];
  for (const [cls, coords] of site.roads) {
    const profile = ROAD_CLASSES[cls] ?? ROAD_CLASSES[ROAD_CLASS_ALIASES[cls]];
    if (!profile) continue;
    streets.push({ profile, halfWidth: ROAD_PROFILES[profile].width / 2, path: coords.map(local), works: [] });
  }
  const builtUp = site.landuse.map(([, ring]) => ring.map(local));
  const builtUpClasses = site.landuse.map(([cls]) => cls);
  const greens = site.landuse.filter(([cls]) => ['cemetery', 'pitch', 'playground', 'stadium'].includes(cls)).map(([, ring]) => ring.map(local));
  const roadIndex = new RoadIndex(streets);
  const all = site.buildings.map(([osm, ring]) => {
    const r = ring.map(local);
    const cx = r.reduce((s, p) => s + p.x, 0) / r.length, cz = r.reduce((s, p) => s + p.z, 0) / r.length;
    return { osm: !!osm, ring: r, x: cx, z: cz };
  });
  const real = all.filter((b) => b.osm).map((b) => ({ footprint: b.ring }));

  const t0 = performance.now();
  const synthetic = planInfill({ frame, streets, builtUp, builtUpClasses, greens, real, roadIndex, here: centre, radius: 1500, dimensions: { ...INFILL_DIMENSIONS, ...dimsOverride } });
  const ms = performance.now() - t0;

  const residential = builtUp.filter((_, i) => builtUpClasses[i] === 'residential');
  const inside = (b) => Math.abs(b.x - centre.x) < INNER_M && Math.abs(b.z - centre.z) < INNER_M && residential.some((r) => pointInRing(r, b.x, b.z));
  const eligible = streets.filter((s) => INFILL_STREET_PROFILES.has(s.profile));
  const describe = (b) => ({ ...b, size: orientedSize(b.ring), near: nearestStreet(eligible, b.ring, b.x, b.z) });

  const truth = all.filter(inside).map(describe);
  const osm = truth.filter((b) => b.osm);
  const seeded = synthetic.filter(inside).map(describe);
  const truthFront = frontHouses(truth);
  const osmFront = frontHouses(osm);
  const mixFront = frontHouses([...osm, ...seeded]);
  const seededFront = frontHouses(seeded);

  // Longueur de rue bâtie : celle qui a une maison réelle de premier rang à moins de 30 m.
  let builtLength = 0;
  const builtCells = new Set();
  const cellOf = (x, z) => `${Math.round(x / 3)},${Math.round(z / 3)}`;
  for (const s of eligible) {
    for (let i = 1; i < s.path.length; i++) {
      const a = s.path[i - 1], b = s.path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let k = 0.5; k < len; k += 1) {
        const x = a.x + ((b.x - a.x) * k) / len, z = a.z + ((b.z - a.z) * k) / len;
        if (Math.abs(x - centre.x) > INNER_M || Math.abs(z - centre.z) > INNER_M) continue;
        if (truthFront.some((h) => Math.abs(h.x - x) < 30 && Math.abs(h.z - z) < 30 && Math.hypot(h.x - x, h.z - z) < 30)) {
          builtLength += 1;
          builtCells.add(cellOf(x, z));
        }
      }
    }
  }
  const per100 = (n) => Math.round((n / Math.max(1, builtLength * 2)) * 10000) / 100;
  // Une maison compte sur la rue bâtie si son pied de façade y tombe.
  const onBuilt = (h) => [-3, 0, 3].some((dx) => [-3, 0, 3].some((dz) => builtCells.has(cellOf(h.near.px + dx, h.near.pz + dz))));

  const missing = truthFront.filter((h) => !h.osm);
  const recall = missing.filter((h) => seeded.some((s) => Math.hypot(s.x - h.x, s.z - h.z) < 15)).length;
  const isPhantom = (s) => !truth.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 20);
  const phantoms = seeded.filter(isPhantom).length;
  const seededHouses = seeded.filter((b) => b.kind === 'house');
  const phantomHouses = seededHouses.filter(isPhantom);
  const gable = (list) => {
    const withAngle = list.filter((h) => h.size && h.near);
    if (!withAngle.length) return null;
    const g = withAngle.filter((h) => Math.abs(h.size.ax * h.near.ux + h.size.az * h.near.uz) < Math.cos((70 * Math.PI) / 180)).length;
    return Math.round((100 * g) / withAngle.length);
  };

  return {
    site: name,
    batimentsReels: truth.length,
    batimentsOsm: osm.length,
    batimentsSemes: seeded.length,
    maisonsSemees: seeded.filter((b) => b.kind === 'house').length,
    annexesSemees: seeded.filter((b) => b.kind === 'annex').length,
    rueBatieKm: Math.round(builtLength / 10) / 100,
    maisonsPar100m: { verite: per100(truthFront.filter(onBuilt).length), osm: per100(osmFront.filter(onBuilt).length), osmEtSemis: per100(mixFront.filter(onBuilt).length) },
    semisHorsRueBatiePct: seededFront.length ? Math.round((100 * seededFront.filter((h) => !onBuilt(h)).length) / seededFront.length) : null,
    rappelPct: missing.length ? Math.round((100 * recall) / missing.length) : null,
    fantomesPct: seeded.length ? Math.round((100 * phantoms) / seeded.length) : null,
    maisonsFantomesPct: seededHouses.length ? Math.round((100 * phantomHouses.length) / seededHouses.length) : null,
    maisonsFantomesSurRueBatiePct: phantomHouses.length ? Math.round((100 * phantomHouses.filter((h) => h.near && onBuilt(h)).length) / phantomHouses.length) : null,
    recul: { verite: quant(truthFront.map((h) => h.near.setback)), semis: quant(seededFront.map((h) => h.near.setback)) },
    longueur: { verite: quant(truthFront.map((h) => h.size.length)), semis: quant(seededFront.map((h) => h.size.length)) },
    largeur: { verite: quant(truthFront.map((h) => h.size.width)), semis: quant(seededFront.map((h) => h.size.width)) },
    pignonPct: { verite: gable(truthFront), semis: gable(seededFront) },
    semisMs: Math.round(ms),
    _rappel: recall,
    _manquantes: missing.length,
    _fantomes: phantoms,
  };
}

const rows = wanted.map(audit);
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const mean = (f) => Math.round((rows.reduce((s, r) => s + (f(r) ?? 0), 0) / rows.filter((r) => f(r) !== null).length) * 100) / 100;
const total = {
  sites: rows.length,
  batimentsReels: sum('batimentsReels'),
  batimentsOsm: sum('batimentsOsm'),
  batimentsSemes: sum('batimentsSemes'),
  maisonsPar100m: { verite: mean((r) => r.maisonsPar100m.verite), osm: mean((r) => r.maisonsPar100m.osm), osmEtSemis: mean((r) => r.maisonsPar100m.osmEtSemis) },
  semisHorsRueBatiePct: mean((r) => r.semisHorsRueBatiePct),
  // Rappel et fantômes : pondérés par site, sur l'ensemble des maisons.
  rappelPct: Math.round(100 * sum('_rappel') / Math.max(1, sum('_manquantes'))),
  fantomesPct: Math.round(100 * sum('_fantomes') / Math.max(1, sum('batimentsSemes'))),
  semisMsMax: Math.max(...rows.map((r) => r.semisMs)),
};
for (const r of rows) console.log(JSON.stringify(r));
console.log('\nTOTAL', JSON.stringify(total, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total, rows }, null, 1) + '\n');
