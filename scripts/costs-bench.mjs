#!/usr/bin/env node
/*
 * costs-bench — les trois coûts d'une version du moteur sur un lieu enregistré :
 * RAM, génération initiale, fluidité au mouvement (`demo/lab/costs.html`).
 *
 *   node scripts/costs-bench.mjs [--root <dépôt>] [--lieu station-montreuil-bellay]
 *        [--runs 3] [--out reports/costs.json] [--lng … --lat …] [--move 0]
 *        [--latence 100 --debit 20]
 *
 * `--root` désigne une autre copie du dépôt (un `git worktree` d'un commit
 * ancien) : la page du banc et le lieu y sont copiés s'ils manquent, et
 * `node_modules` y est relié. Chaque passe ouvre un navigateur neuf.
 *
 * RAM : tas JS retenu après GC forcé (CDP `HeapProfiler.collectGarbage` puis
 * `Runtime.getHeapUsage`), pic du tas pendant le travail (`performance.memory`
 * précis), et PSS cumulée des processus Chromium (pic et après GC), lue dans
 * `/proc` — Linux seulement. Les médianes des passes sont rendues.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const here = resolve(dirname(new URL(import.meta.url).pathname), '..');
const root = resolve(flag('root', here));
const lieu = flag('lieu', 'station-montreuil-bellay');
const runs = Number(flag('runs', 3));
const out = flag('out', null);
const lng = flag('lng', null), lat = flag('lat', null);
const withMove = flag('move', '1') !== '0';
// Réseau simulé (CDP) : latence en ms et débit descendant en Mbit/s, pour les tuiles comme en ligne.
const latency = Number(flag('latence', 0)), mbps = Number(flag('debit', 0));
const port = Number(process.env.PORT) || 4300 + Math.floor(Math.random() * 500);

if (root !== here) {
  cpSync(join(here, 'demo/lab/costs.html'), join(root, 'demo/lab/costs.html'));
  if (!existsSync(join(root, 'demo/lab/suncalc-global.js'))) cpSync(join(here, 'demo/lab/suncalc-global.js'), join(root, 'demo/lab/suncalc-global.js'));
  if (!existsSync(join(root, 'demo/lab/places', lieu))) cpSync(join(here, 'demo/lab/places', lieu), join(root, 'demo/lab/places', lieu), { recursive: true });
  if (!existsSync(join(root, 'node_modules'))) symlinkSync(join(here, 'node_modules'), join(root, 'node_modules'));
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  .catch(() => import('/opt/node-tools/node_modules/playwright/index.js'))
  .then((m) => m.default ?? m);

/** Le processus principal du navigateur, reconnu à un drapeau propre à la passe. */
function browserPid(marker) {
  const pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => {
    try { return readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').includes(marker); } catch { return false; }
  }).map(Number);
  return Math.min(...pids);
}

/** PSS cumulée (octets) du processus et de ses descendants. */
function pss(pid) {
  const children = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const ppid = Number(readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(d));
    } catch { /* processus disparu */ }
  }
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    try { total += Number(/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'))[1]) * 1024; } catch { /* idem */ }
    stack.push(...(children.get(p) ?? []));
  }
  return total;
}

const server = spawn(process.execPath, [join(root, 'demo/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, ko) => { server.stdout.once('data', ok); server.once('exit', (code) => ko(Error(`serveur arrêté : ${code}`))); });

const median = (values) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const passes = [];
try {
  for (let run = 0; run < runs; run++) {
    const marker = `--costs-bench-run=${process.pid}-${run}`;
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [marker, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
    });
    const pid = browserPid(marker);
    let peak = 0;
    const sampler = setInterval(() => { if (pid) peak = Math.max(peak, pss(pid)); }, 100);
    try {
      const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
      const errors = [], missing = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400) missing.push(new URL(r.url()).pathname); });
      await page.route('**/*', (r) => (new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort()));
      const cdp = await page.context().newCDPSession(page);
      if (latency || mbps) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: mbps ? mbps * 125000 : -1, uploadThroughput: -1 });
      }
      let tileBytes = 0, tileCount = 0;
      page.on('requestfinished', async (r) => { if (!/\/places\//.test(r.url())) return; tileCount++; tileBytes += (await r.sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize; });
      const heapAfterGc = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const query = new URLSearchParams({ lieu, ...(lng ? { lng } : {}), ...(lat ? { lat } : {}), ...(flag('precompile', null) ? { precompile: flag('precompile') } : {}) });
      await page.goto(`http://localhost:${port}/demo/lab/costs.html?${query}`);
      await page.waitForFunction(() => window.costsLabReady, null, { timeout: 120000 });
      const baseline = { heap: await heapAfterGc(), pss: pss(pid) };
      peak = 0;
      const mount = await page.evaluate(() => window.costsLab.mount());
      mount.pssPeakBytes = peak;
      console.error(`  génération ${Math.round(mount.totalMs)} ms (mountAt ${Math.round(mount.mountMs)} ms)`);
      mount.heapRetainedBytes = await heapAfterGc();
      mount.pssBytes = pss(pid);
      let move = null;
      if (withMove) {
        peak = 0;
        move = await page.evaluate(() => window.costsLab.move());
        move.pssPeakBytes = peak;
        move.heapRetainedBytes = await heapAfterGc();
        move.pssBytes = pss(pid);
      }
      const webgl = await page.evaluate(() => { const gl = window.costsLab.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
      passes.push({ baseline, mount, move, errors, missing, webgl, tiles: { count: tileCount, bytes: tileBytes } });
      console.error(`passe ${run + 1}/${runs} : génération ${Math.round(mount.totalMs)} ms, tas retenu ${(mount.heapRetainedBytes / 2 ** 20).toFixed(0)} Mo, image (trajet) p95 ${move?.run.frame.p95.toFixed(1) ?? '—'} ms${errors.length ? `, erreurs : ${errors.join(' | ')}` : ''}`);
    } finally {
      clearInterval(sampler);
      await browser.close();
    }
  }
} finally {
  server.kill();
}

const MB = (b) => (b == null ? null : Math.round(b / 2 ** 20));
const ms = (v) => (v == null ? null : Math.round(v * 10) / 10);
const pick = (f) => median(passes.map((p) => { try { return f(p); } catch { return null; } }));
const summary = {
  root, lieu, runs, date: new Date().toISOString(), reseau: { latenceMs: latency, debitMbps: mbps, tuiles: passes[0]?.tiles },
  machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, node: process.version, webgl: passes[0]?.webgl },
  ram: {
    tasRetenuApresMontageMo: MB(pick((p) => p.mount.heapRetainedBytes)),
    tasPicMontageMo: MB(pick((p) => p.mount.heapPeakBytes)),
    pssApresMontageMo: MB(pick((p) => p.mount.pssBytes)),
    pssPicMontageMo: MB(pick((p) => p.mount.pssPeakBytes)),
    tasRetenuApresTrajetMo: MB(pick((p) => p.move.heapRetainedBytes)),
    tasPicTrajetMo: MB(pick((p) => p.move.heapPeakBytes)),
    pssPicTrajetMo: MB(pick((p) => p.move.pssPeakBytes)),
    geometrieMo: MB(pick((p) => p.mount.bufferBytes)),
  },
  generation: {
    totalMs: Math.round(pick((p) => p.mount.totalMs)),
    createMs: Math.round(pick((p) => p.mount.createMs)),
    mountAtMs: Math.round(pick((p) => p.mount.mountMs)),
    filesMs: Math.round(pick((p) => p.mount.queuesMs)),
    premiereImageMs: Math.round(pick((p) => p.mount.firstFrameMs)),
    passesMs: passes.map((p) => Math.round(p.mount.totalMs)),
    couches: passes[Math.floor((passes.length - 1) / 2)]?.mount.layers,
  },
  fluidite: Object.fromEntries(['turn', 'run'].map((k) => [k === 'turn' ? 'tour' : 'trajet', {
    imageP50Ms: ms(pick((p) => p.move[k].frame.p50)), imageP95Ms: ms(pick((p) => p.move[k].frame.p95)),
    imageP99Ms: ms(pick((p) => p.move[k].frame.p99)), imageMaxMs: ms(pick((p) => p.move[k].frame.max)),
    imagesPlusDe16Ms: pick((p) => p.move[k].frame.over16), imagesPlusDe50Ms: pick((p) => p.move[k].frame.over50),
    advanceP95Ms: ms(pick((p) => p.move[k].advance.p95)), renderP95Ms: ms(pick((p) => p.move[k].render.p95)),
  }])),
  scene: { appels: pick((p) => p.mount.calls), triangles: pick((p) => p.mount.triangles), maillages: pick((p) => p.mount.meshes), recentrages: pick((p) => p.move.recenters), relevesFaites: pick((p) => p.move.refreshDone) },
  erreurs: [...new Set(passes.flatMap((p) => p.errors))],
  tuilesManquantes: [...new Set(passes.flatMap((p) => p.missing))],
};
if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), JSON.stringify({ summary, passes }, null, 2) + '\n'); }
console.log(JSON.stringify(summary, null, 2));
