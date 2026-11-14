#!/usr/bin/env node
/*
 * frame-bench — ce que coûte une image d'un lieu enregistré, bulle montée et
 * immobile, vue d'une caméra de poursuite (`demo/lab/frame.html`). Sur le GPU
 * de la machine : le temps rendu est celui d'une image, file GPU vidée.
 *
 *   node scripts/frame-bench.mjs [--lieu lyon] [--lng … --lat …] [--caps 8]
 *        [--detail 375] [--niveau full|light] [--dpr 2] [--ombre 2048] [--taille 1280x800]
 *        [--shot <fichier.png>] [--out <fichier.json>] [--sans-ablation]
 *        [--meteo sec|pluie-legere|forte-pluie|neige|orage|<JSON>]
 *
 * `--meteo` reprend ce que le jeu envoie (`sceneWeather.js` de 1230-bornes)
 * pour une famille de codes WMO ; un JSON passe un état arbitraire.
 *
 * Rend le temps d'image par cap, puis, sur le cap le plus cher, les appels et
 * triangles par couche et le temps gagné en éteignant chaque couche. Un Mac
 * n'est pas un téléphone : on y lit des proportions, pas des images par seconde.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from './cdpBrowser.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const [width, height] = flag('taille', '1280x800').split('x').map(Number);
const port = Number(process.env.PORT) || 4300 + Math.floor(Math.random() * 500);
const query = new URLSearchParams({ lieu: flag('lieu', 'lyon') });
const WEATHERS = {
  sec: { cloudCover: 0.5, cloudDensity: 0.5, precipitation: 0, wind: 0.3 },
  'pluie-legere': { cloudCover: 0.85, cloudDensity: 0.75, precipitation: 0.25, wind: 0.3 },
  'forte-pluie': { cloudCover: 0.85, cloudDensity: 0.75, precipitation: 0.9, wind: 0.5 },
  neige: { cloudCover: 0.8, cloudDensity: 0.65, precipitation: 0.5, precipitationType: 'snow', wind: 0.3 },
  orage: { cloudCover: 0.95, cloudDensity: 0.9, precipitation: 0.9, wind: 0.7 },
};
const meteo = flag('meteo', null);
if (meteo) query.set('meteo', JSON.stringify(WEATHERS[meteo] ?? JSON.parse(meteo)));
for (const name of ['lng', 'lat', 'detail', 'niveau', 'dpr', 'ombre', 'heure']) if (flag(name, null) != null) query.set(name, flag(name));

const server = spawn(process.execPath, [join(root, 'demo/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, ko) => { server.stdout.once('data', ok); server.once('exit', (code) => ko(Error(`serveur arrêté : ${code}`))); });
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/demo/lab/frame.html?${query}`);
  await page.waitForFunction(() => window.frameLabReady, null, { timeout: 60000 });
  await page.evaluate(() => window.frameLab.mount());
  const webgl = await page.evaluate(() => { const gl = window.frameLab.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
  const views = await page.evaluate((headings) => window.frameLab.measure({ headings }), Number(flag('caps', 8)));
  const cpu = await page.evaluate(() => window.frameLab.cpu());
  const falling = await page.evaluate(() => Object.fromEntries(['rain', 'snow'].map((n) => [n, { depth: window.frameLab.fragments(n), all: window.frameLab.fragments(n, { depth: false }) }])));
  const worst = views.reduce((a, b) => (b.ms > a.ms ? b : a));
  const breakdown = await page.evaluate((h) => window.frameLab.breakdown(h), worst.heading);
  const ablation = args.includes('--sans-ablation') ? null : await page.evaluate((h) => window.frameLab.ablate(h), worst.heading);
  if (flag('shot', null)) { await page.evaluate((h) => { window.frameLab.pose(h); window.frameLab.draw(); }, worst.heading); await page.screenshot({ path: resolve(flag('shot')) }); }

  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
  console.log(`${query.get('lieu')} (${query.get('niveau') ?? 'full'}) — météo ${meteo ?? 'par défaut'} — ${webgl}\n`);
  for (const [n, f] of Object.entries(falling)) if (f.all.fragments) console.log(`${n} : ${f.depth.fragments} fragments après test de profondeur (${(f.depth.fragments / f.depth.screen).toFixed(3)} par pixel d'écran, ${f.depth.pixels} pixels touchés), ${f.all.fragments} sans`);
  console.log(`CPU par image : advance ${cpu.advanceMs.toFixed(3)} ms (p95 ${cpu.advanceP95Ms.toFixed(3)}), updateSky ${cpu.updateSkyMs.toFixed(3)} ms\n`);
  console.log('| cap | image (ms) | appels | triangles |\n| ---: | ---: | ---: | ---: |');
  for (const v of views) console.log(`| ${v.heading}° | ${v.ms.toFixed(2)} | ${v.calls} | ${k(v.triangles)} |`);
  console.log(`\nCap ${worst.heading}° — par couche\n\n| couche | appels | triangles | appels (ombre) | triangles (ombre) |\n| --- | ---: | ---: | ---: | ---: |`);
  for (const r of breakdown.slice(0, 25)) console.log(`| ${r.layer} | ${r.draws} | ${k(r.triangles)} | ${r.shadowDraws} | ${k(r.shadowTriangles)} |`);
  const sum = (key) => breakdown.reduce((n, r) => n + r[key], 0);
  console.log(`| **total** | ${sum('draws')} | ${k(sum('triangles'))} | ${sum('shadowDraws')} | ${k(sum('shadowTriangles'))} |`);
  if (ablation) {
    console.log(`\nImage complète : ${ablation.fullMs.toFixed(2)} ms — gagné en éteignant\n\n| couche | objets | ms |\n| --- | ---: | ---: |`);
    for (const r of ablation.layers) console.log(`| ${r.layer} | ${r.objects} | ${r.savedMs.toFixed(2)} |`);
  }
  if (errors.length) console.log(`\nerreurs : ${errors.join(' | ')}`);
  const out = flag('out', null);
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), JSON.stringify({ webgl, meteo: query.get('meteo'), cpu, falling, views, breakdown, ablation, errors }, null, 2) + '\n'); }
} finally {
  await browser.close();
  server.kill();
}
