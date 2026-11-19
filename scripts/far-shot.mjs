#!/usr/bin/env node
/*
 * far-shot — photographie le banc du relief lointain (`demo/lab/far.html`)
 * pour une série de réglages : une image par réglage, passé tel quel à
 * `farLab.set()`. Chromium en rendu logiciel.
 *
 *   node scripts/far-shot.mjs <dossier> '[{"relief":"collines","wood":"conifer_forest","height":40}]' [lng=14.7&lat=37.95]
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir = 'far-shots', json = '[{}]', query = ''] = process.argv.slice(2);
const shots = JSON.parse(json);
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Installation globale (conteneurs de travail) : pas de dépendance au dépôt.
    try {
      const require = createRequire(join(process.execPath, '..', '..', 'lib', 'node_modules', '/'));
      return require('playwright');
    } catch {
      return import('./cdpBrowser.mjs');
    }
  }
}

const port = 4180 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['demo/server.mjs'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once('data', resolve));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('favicon.ico') && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/demo/lab/far.html?${query}`);
  await page.waitForFunction(() => window.farLabReady, null, { timeout: 600000 });
  for (const [i, shot] of shots.entries()) {
    const info = await page.evaluate((s) => window.farLab.set(s), shot);
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
