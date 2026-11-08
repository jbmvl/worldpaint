#!/usr/bin/env node
/*
 * slope-bench — banc de pente : enregistre des lieux tirés ailleurs (une liste
 * JSON `{ places: [{ name, lng, lat }] }`, par exemple les tronçons raides des
 * itinéraires de Dot Racing), les rejoue sur le banc des lieux et relève chaque
 * endroit où la chaussée est trop raide ou casse sa pente
 * (`demo/lab/slopeSpots.js`). Le bilan compte les endroits par contexte, pour
 * corriger une famille de cas plutôt qu'un lieu.
 *
 *   node scripts/slope-bench.mjs <lieux.json> [--limit 10] [--out relevé.jsonl]
 *   node scripts/slope-bench.mjs --bilan relevé.jsonl     // refait le bilan sans rejouer
 *
 * Les lieux vont dans `demo/lab/places/<nom>/` (les `pente-*` ne sont pas
 * versionnés) et ne sont enregistrés qu'une fois.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './cdpBrowser.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const placesDir = new URL('../demo/lab/places/', import.meta.url).pathname;

function run(cmd, cmdArgs, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

function bilan(rows) {
  const ok = rows.filter((r) => !r.erreur);
  const km = ok.reduce((sum, r) => sum + (r.km ?? 0), 0);
  const spots = ok.flatMap((r) => r.endroits.map((e) => ({ ...e, lieu: r.lieu, sorte: r.sorte })));
  const tags = new Map();
  const combos = new Map();
  for (const s of spots) {
    for (const t of s.contexte) tags.set(t, (tags.get(t) ?? 0) + 1);
    const key = s.contexte.filter((t) => t !== 'rupture').sort().join(' + ') || 'aucun';
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  const share = (n) => `${((100 * n) / (spots.length || 1)).toFixed(0)} %`.padStart(5);
  console.log(`\n${ok.length} lieux rejoués (${rows.length - ok.length} en erreur), ${km.toFixed(0)} km de chaussée, ${spots.length} endroits (${(spots.length / (km || 1)).toFixed(1)} / km)`);
  for (const sorte of ['raide', 'plat']) {
    const mine = ok.filter((r) => r.sorte === sorte);
    const n = mine.reduce((sum, r) => sum + r.endroits.length, 0);
    const k = mine.reduce((sum, r) => sum + (r.km ?? 0), 0);
    if (mine.length) console.log(`  lieux ${sorte.padEnd(5)} : ${mine.length}, ${(n / (k || 1)).toFixed(1)} endroits / km`);
  }
  console.log('\nPar trait (un endroit en porte plusieurs) :');
  for (const [t, n] of [...tags].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(20)} ${String(n).padStart(5)} ${share(n)}`);
  console.log('\nPar combinaison (hors rupture) :');
  for (const [t, n] of [...combos].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${share(n)} ${String(n).padStart(5)}  ${t}`);
  console.log('\nPires endroits :');
  for (const s of spots.sort((a, b) => Math.abs(b.pente) - Math.abs(a.pente)).slice(0, 12)) {
    console.log(`  ${String(s.pente).padStart(6)} % (sol ${s.sol} %, rupture ${s.rupture})  ${s.lieu} x=${s.x} z=${s.z}  ${s.lat},${s.lng}  ${s.profil}  ${s.contexte.join(' ')}`);
  }
}

if (args.includes('--bilan')) {
  bilan(readFileSync(flag('bilan'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  process.exit(0);
}

const listFile = args.find((a) => !a.startsWith('--') && a !== flag('limit') && a !== flag('out'));
if (!listFile) {
  console.error('usage : node scripts/slope-bench.mjs <lieux.json> [--limit N] [--out relevé.jsonl]');
  process.exit(1);
}
const limit = Number(flag('limit', Infinity));
const out = flag('out', join('reports', `pentes-${new Date().toISOString().slice(0, 10)}.jsonl`));
const places = JSON.parse(readFileSync(listFile, 'utf8')).places.slice(0, limit);

// Enregistrement, quatre lieux à la fois (réseau).
const missing = places.filter((p) => !existsSync(join(placesDir, p.name, 'place.json')));
for (let i = 0; i < missing.length; i += 4) {
  await Promise.all(missing.slice(i, i + 4).map(async (p) => {
    const { code, out: log } = await run(process.execPath, ['scripts/capture-place.mjs', p.name, String(p.lng), String(p.lat), p.name]);
    console.log(`enregistré ${p.name}${code ? ` (échec : ${log.trim().split('\n').pop()})` : ''}`);
  }));
}

const port = 4180 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['demo/server.mjs'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once('data', resolve));
const browser = await chromium.launch({ args: ['--window-size=640,400', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
writeFileSync(out, '');
const rows = [];
try {
  for (const p of places) {
    const sorte = p.name.includes('-plat-') ? 'plat' : 'raide';
    let row;
    const t = Date.now();
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
      await page.goto(`http://localhost:${port}/demo/lab/place.html?lieu=${encodeURIComponent(p.name)}`);
      await page.waitForFunction(() => window.placeLabReady === true, null, { timeout: 180000 });
      const res = await page.evaluate(() => ({ endroits: placeLab.slopeSpots(), km: +placeLab.roads().km }));
      row = { lieu: p.name, sorte, km: res.km, endroits: res.endroits, s: Math.round((Date.now() - t) / 1000) };
      await page.s.send('Page.close').catch(() => {});
    } catch (err) {
      row = { lieu: p.name, sorte, erreur: err.message.split('\n')[0], endroits: [] };
    }
    rows.push(row);
    appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`${p.name.padEnd(18)} ${row.erreur ? `erreur : ${row.erreur}` : `${row.km} km, ${row.endroits.length} endroits, ${row.s} s`}`);
  }
} finally {
  await browser.close();
  server.kill();
}
bilan(rows);
console.log(`\nrelevé : ${out}`);
