#!/usr/bin/env node
/*
 * shop-shot — photographie le banc des devantures (`demo/lab/shop.html`) pour
 * une série de points de vue, sans passer par la démo : sert à voir de quel
 * côté se posent devanture, enseigne et terrasse.
 *
 *   node scripts/shop-shot.mjs <dossier> '[{"yawDeg":60,"pitchDeg":-28}]'
 *
 * Chaque réglage est passé tel quel à `shopLab.set()` ; une image par réglage.
 * Chromium en rendu logiciel.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir = 'shop-shots', json = '[{}]'] = process.argv.slice(2);
const shots = JSON.parse(json);
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Installation globale (conteneurs de travail) : pas de dépendance au dépôt.
    const require = createRequire(join(process.execPath, '..', '..', 'lib', 'node_modules', '/'));
    return require('playwright');
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
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('favicon.ico') && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/demo/lab/shop.html`);
  await page.waitForFunction(() => window.shopLabReady, null, { timeout: 30000 });
  for (const [i, shot] of shots.entries()) {
    const info = await page.evaluate((s) => window.shopLab.set(s), shot);
    const file = join(outDir, `${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file, JSON.stringify(shot), JSON.stringify(info));
  }
  if (errors.length) console.error('Erreurs de page :\n' + errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}
