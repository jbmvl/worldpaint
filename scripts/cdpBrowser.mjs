/*
 * cdpBrowser — le sous-ensemble de Playwright dont `costs-bench` se sert, sur
 * Chrome sans tête piloté par son protocole de débogage : le banc tourne là où
 * Playwright n'est pas installé. `CHROME_PATH` remplace le chemin de l'exécutable.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) {
        const { ok, ko } = this.waiting.get(m.id); this.waiting.delete(m.id);
        m.error ? ko(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) for (const h of this.handlers.get(m.method) ?? []) h(m.params);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((ok, ko) => { this.waiting.set(id, { ok, ko }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, h) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(h); }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  return new Session(ws);
}

class Page {
  constructor(s) {
    this.s = s; this.listeners = { pageerror: [], response: [], requestfinished: [] }; this.urls = new Map();
    s.on('Runtime.exceptionThrown', (p) => this.listeners.pageerror.forEach((f) => f({ message: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text })));
    s.on('Network.responseReceived', (p) => { this.urls.set(p.requestId, p.response.url); this.listeners.response.forEach((f) => f({ status: () => p.response.status, url: () => p.response.url })); });
    s.on('Network.loadingFinished', (p) => { const url = this.urls.get(p.requestId); if (url) this.listeners.requestfinished.forEach((f) => f({ url: () => url, sizes: async () => ({ responseBodySize: p.encodedDataLength }) })); });
  }
  on(event, f) { this.listeners[event]?.push(f); }
  /** Le banc ne sert que des tuiles locales : rien à filtrer. */
  async route() {}
  context() { return { newCDPSession: async () => this.s }; }
  async goto(url) {
    const loaded = new Promise((ok) => this.s.on('Page.loadEventFired', ok));
    await this.s.send('Page.navigate', { url });
    await loaded;
  }
  async evaluate(fn, arg) {
    const call = arg === undefined ? '' : JSON.stringify(arg);
    const r = await this.s.send('Runtime.evaluate', { expression: `(${fn})(${call})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async screenshot({ path }) {
    const { data } = await this.s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }
  async waitForFunction(fn, _arg, { timeout = 30000 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await this.evaluate(fn).catch(() => false)) return; await sleep(100); }
    throw new Error('waitForFunction : délai dépassé');
  }
}

export const chromium = {
  async launch({ args = [] } = {}) {
    const port = 9500 + Math.floor(Math.random() * 400);
    const profile = mkdtempSync(join(tmpdir(), 'cale-'));
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', ...args, 'about:blank'], { stdio: 'ignore' });
    let version;
    for (let i = 0; i < 100 && !version; i++) { await sleep(100); version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
    return {
      async newPage({ viewport } = {}) {
        const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
        const s = await connect(target.webSocketDebuggerUrl);
        const page = new Page(s);
        await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Network.enable');
        if (viewport) await s.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
        return page;
      },
      async close() { proc.kill('SIGKILL'); await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch {} },
    };
  },
};
export default { chromium };
