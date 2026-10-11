#!/usr/bin/env node
/*
 * roads-audit — mesure le réseau routier des lieux enregistrés sur le banc des
 * lieux (`demo/lab/place.html`, `placeLab.roads()`) : pentes, marches,
 * terrassement, bouches, chaussées superposées, empreinte du réseau.
 *
 *   node scripts/roads-audit.mjs [lieu ...]      // tous les lieux à tuiles vectorielles par défaut
 *   node scripts/roads-audit.mjs --json nantes   // une ligne JSON par lieu
 *
 * Chrome sans tête piloté par son protocole de débogage : aucune dépendance.
 * `CHROME_PATH` remplace le chemin de l'exécutable.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const json = args.includes('--json');
const asked = args.filter((a) => !a.startsWith('--'));
const placesDir = new URL('../demo/lab/places/', import.meta.url).pathname;
const places = asked.length ? asked : readdirSync(placesDir).filter((name) => existsSync(join(placesDir, name, 'vector'))).sort();

const CHROME =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!CHROME) throw new Error('Chrome introuvable : renseigner CHROME_PATH');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 4180 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['demo/server.mjs'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once('data', resolve));

const debugPort = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'roads-audit-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=960,600', 'about:blank'],
  { stdio: 'ignore' }
);

try {
  let target = null;
  for (let tries = 0; tries < 60 && !target; tries++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome ne répond pas');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let id = 0;
  const pending = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data.result ?? data);
      pending.delete(data.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? 'erreur de page');
    return answer.result?.value;
  };
  await send('Page.enable');

  for (const place of places) {
    await send('Page.navigate', { url: `http://localhost:${port}/demo/lab/place.html?lieu=${encodeURIComponent(place)}` });
    let ready = false;
    for (let tries = 0; tries < 2000 && !ready; tries++) {
      await sleep(300);
      ready = (await evaluate('window.placeLabReady === true').catch(() => false)) === true;
    }
    if (!ready) throw new Error(`${place} : le banc ne s'est pas monté`);
    const audit = await evaluate('placeLab.roads()');
    if (json) {
      console.log(JSON.stringify({ lieu: place, ...audit }));
      continue;
    }
    const share = (n) => (audit.lignesAuSol ? ((100 * n) / audit.lignesAuSol).toFixed(1) : '0') + ' %';
    console.log(
      [
        place.padEnd(26),
        `${audit.km} km`.padStart(8),
        `>12 % ${share(audit.plusDe12)}`.padStart(13),
        `>20 % ${share(audit.plusDe20)}`.padStart(13),
        `marches ${audit.marches}`.padStart(12),
        `gauches ${audit.carrefoursGauches}/${audit.carrefours}`.padStart(16),
        `bouches en marche ${audit.bouchesEnMarche}`.padStart(22),
        `terrassement p95 ${audit.terrassement.p95} m max ${audit.terrassement.max} m`.padStart(40),
        `superposé ${audit.superposeM} m`.padStart(17),
        audit.empreinte,
      ].join('  ')
    );
  }
  socket.close();
} finally {
  chrome.kill();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}
