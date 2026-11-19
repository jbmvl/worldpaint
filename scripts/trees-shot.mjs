#!/usr/bin/env node
/*
 * trees-shot — photographie le banc des arbres (`demo/lab/trees.html`) pour une
 * série de réglages, sans passer par la démo.
 *
 *   node scripts/trees-shot.mjs <dossier> '[{"variant":15},{"variant":15,"eye":[3,5,6],"at":[0,10,0]}]'
 *
 * Chaque réglage est passé à `treesLab.set()` ; `eye` et `at` posent la caméra.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir = 'trees-shots', json = '[{}]'] = process.argv.slice(2);
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
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('favicon.ico') && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/demo/lab/trees.html`);
  await page.waitForFunction(() => window.treesLabReady, null, { timeout: 30000 });
  for (const [i, shot] of shots.entries()) {
    const info = await page.evaluate((s) => (window.treesLab.set(s), s.eye && (window.treesLab.camera.position.set(...s.eye), window.treesLab.camera.lookAt(...s.at), window.treesLab.renderer.render(window.treesLab.scene, window.treesLab.camera)), null), shot);
    const file = join(outDir, `${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file, JSON.stringify(shot), JSON.stringify(info));
  }
  if (errors.length) console.error('Erreurs de page :\n' + errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}
