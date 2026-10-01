#!/usr/bin/env node
/*
 * place-walk — fait marcher l'observateur sur le banc des lieux
 * (`demo/lab/place.html`) et imprime, pas à pas, ce qui s'est repeint à moins
 * de `radius` mètres de lui : part des pixels changés (vue à hauteur d'homme
 * et vue plongeante), couches dont la géométrie a changé, pire tâche.
 *
 *   node scripts/place-walk.mjs '{"toX":2000,"step":50}' [lieu]
 *
 * Les réglages sont passés tels quels à `placeLab.walk()`.
 * Chromium en rendu logiciel : les durées sont à lire entre elles, pas comme
 * celles d'une vraie carte graphique.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [json = '{}', place = 'station-montreuil-bellay'] = process.argv.slice(2);
const options = JSON.parse(json);

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
  await page.goto(`http://localhost:${port}/demo/lab/place.html?lieu=${encodeURIComponent(place)}`);
  await page.waitForFunction(() => window.placeLabReady, null, { timeout: 600000 });
  const { steps, summary } = await page.evaluate((o) => window.placeLab.walk(o), options);
  for (const s of steps) {
    const layers = Object.keys(s.layers).join(', ') || '—';
    console.log(`${String(s.d).padStart(5)} m  ${s.rebuilt ? 'refait ' : '       '} vue ${(s.eye * 100).toFixed(2)} %  plongée ${(s.high * 100).toFixed(2)} %  pire tâche ${s.worstTaskMs} ms  ${layers}`);
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (errors.length) console.error('Erreurs de page :\n' + errors.join('\n'));
  await browser.close();
  server.kill();
}
