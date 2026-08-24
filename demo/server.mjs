#!/usr/bin/env node
/*
 * server — petit serveur statique pour la démo, sans dépendance.
 * -----------------------------------------------------------------
 * La démo est du JavaScript de module (ES modules), donc `file://` ne suffit
 * pas : le navigateur refuse les imports relatifs sans serveur HTTP. Ce
 * script sert `demo/` et la racine du dépôt (pour que `../src/...` résolve),
 * rien de plus — pas de build, pas de framework, conformément à la
 * philosophie du projet.
 */

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const port = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = normalize(join(root, decodeURIComponent(url.pathname)));

  // Rien en dehors du dépôt : `../` ne sort pas de `root`.
  if (!path.startsWith(root)) {
    res.writeHead(403);
    res.end('403');
    return;
  }
  if (path === root || (existsSync(path) && statSync(path).isDirectory())) {
    path = join(path, 'index.html');
  }
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end('404: ' + url.pathname);
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(res);
});

server.listen(port, () => {
  console.log(`WorldPaint demo → http://localhost:${port}/demo/`);
});
