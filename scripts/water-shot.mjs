#!/usr/bin/env node
/* Capture le banc d'eau avec les vrais modules, sans réseau extérieur.
 * node scripts/water-shot.mjs <dossier> '[{"case":"lac","pitchDeg":12}]'
 * PLAYWRIGHT_MODULE et CHROMIUM_PATH permettent un runtime hors du dépôt. */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir = 'water-shots', json = '[{}]'] = process.argv.slice(2);
const shots = JSON.parse(json);
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try {
    return await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  } catch {
    // Installation globale (conteneurs de travail) : pas de dépendance au dépôt.
    const require = createRequire(join(process.execPath, '..', '..', 'lib', 'node_modules', '/'));
    return require('playwright');
  }
}

const { chromium } = await loadPlaywright();
const port = 4180 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['demo/server.mjs'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve,reject) => {server.stdout.once('data',resolve);server.once('exit',code=>reject(new Error(`Serveur arrêté : ${code}`)));});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.route('**/*',route=>route.request().url().startsWith(`http://localhost:${port}/`)?route.continue():route.abort());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('favicon.ico') && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/demo/lab/water.html`);
  await page.waitForFunction(() => window.waterLabReady, null, { timeout: 240000 });
  for (const [i, shot] of shots.entries()) {
    const info = await page.evaluate((s) => window.waterLab.set(s), shot);
    const file = join(outDir, `${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file, JSON.stringify(shot), JSON.stringify(info));
  }
} finally {
  // Aussi quand le banc ne démarre pas : c'est là qu'on en a besoin.
  if (errors.length) console.error('Erreurs de page :\n' + errors.join('\n'));
  await browser.close();
  server.kill();
}
if(errors.length)process.exitCode=1;
