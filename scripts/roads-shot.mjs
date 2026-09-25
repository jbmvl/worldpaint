#!/usr/bin/env node
/*
 * roads-shot — photographie le banc de la voirie (`demo/lab/roads.html`) pour
 * une série de réglages, sans passer par la démo : sert à regarder ponts,
 * remblais d'accès et carrefours hors tuiles réelles.
 *
 *   node scripts/roads-shot.mjs <dossier> '[{"scene":"pont"},{"scene":"pente","yawDeg":90}]'
 *
 * Chaque réglage est passé tel quel à `roadsLab.set()` ; une image par
 * réglage, et les cotes des bouches du carrefour visé sont imprimées.
 * Chromium en rendu logiciel.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir = 'roads-shots', json = '[{}]'] = process.argv.slice(2);
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
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('favicon.ico') && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/demo/lab/roads.html`);
  await page.waitForFunction(() => window.roadsLabReady, null, { timeout: 60000 });
  for (const [i, shot] of shots.entries()) {
    const info = await page.evaluate((s) => window.roadsLab.set(s), shot);
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
