#!/usr/bin/env node
/*
 * slope-shot — photographie les endroits raides d'un lieu rejoué
 * (`demo/lab/slopeSpots.js`) : une vue d'ensemble en drone, puis pour chacun
 * des pires endroits une vue de coureur dans l'axe de la chaussée et une vue
 * de côté, basse, qui montre le profil. Complète `scripts/slope-bench.mjs`,
 * qui compte, par ce qui se voit.
 *
 *   node scripts/slope-shot.mjs <dossier> <lieu> [--pires 3] [--vues '<réglages JSON>']
 *
 * `--vues` ajoute des vues libres (réglages de `placeLab.set`). Rend dans le
 * dossier une image par vue et `vues.json`, qui décrit chacune.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const require = createRequire(join(process.execPath, '..', '..', 'lib', 'node_modules', '/'));
    return require('playwright');
  }
}
const { chromium } = await loadPlaywright();

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const worst = Number(flag('pires', 3));
const extra = JSON.parse(flag('vues', '[]'));
const [outDir, place] = args;
if (!outDir || !place) {
  console.error("usage : node scripts/slope-shot.mjs <dossier> <lieu> [--pires 3] [--vues '<réglages JSON>']");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const port = 4180 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['demo/server.mjs'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once('data', resolve));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const views = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`http://localhost:${port}/demo/lab/place.html?lieu=${encodeURIComponent(place)}`);
  await page.waitForFunction(() => window.placeLabReady === true, null, { timeout: 300000 });
  const plan = await page.evaluate(({ worst }) => {
    const spots = placeLab.slopeSpots().sort((a, b) => Math.abs(b.pente) - Math.abs(a.pente));
    // Cap de la chaussée au plus près de l'endroit : le coureur regarde dans l'axe.
    const heading = (x, z) => {
      let best = null;
      for (const s of placeLab.world.composer.roads.roadSegments) {
        if (!s.paved) continue;
        for (let i = 1; i < s.path.length; i++) {
          const a = s.path[i - 1], b = s.path[i];
          const d = Math.hypot((a.x + b.x) / 2 - x, (a.z + b.z) / 2 - z);
          if (!best || d < best.d) best = { d, dx: b.x - a.x, dz: b.z - a.z };
        }
      }
      return best ? (Math.atan2(best.dx, -best.dz) * 180) / Math.PI : 0;
    };
    // Les pires endroits, à plus de 60 m l'un de l'autre.
    const picked = [];
    for (const s of spots) {
      if (picked.length >= worst) break;
      if (picked.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 60)) continue;
      picked.push(s);
    }
    // Le point tiré est sur une chaussée : on y regarde aussi depuis la selle.
    const out = [
      { titre: 'ensemble', reglage: { x: 0, z: 0, yawDeg: 200, pitchDeg: 38, distance: 700 } },
      { titre: 'départ', reglage: { x: 0, z: 0, yawDeg: heading(0, 0), pitchDeg: 10, distance: 15 } },
    ];
    for (const s of picked) {
      const yaw = heading(s.x, s.z);
      // Le coureur arrive par le bas de la pente.
      const up = s.pente >= 0 ? yaw : yaw + 180;
      out.push({ titre: 'coureur', endroit: s, reglage: { x: s.x, z: s.z, yawDeg: up, pitchDeg: 10, distance: 15 } });
      // De côté, depuis le flanc qui descend : l'autre met la caméra dans le versant.
      const bubble = placeLab.world.composer.bubble;
      const side = (deg) => {
        const r = (deg * Math.PI) / 180;
        return bubble.naturalElevationAtLocal(s.x - Math.sin(r) * 50, s.z + Math.cos(r) * 50, Infinity);
      };
      const flank = side(yaw + 90) <= side(yaw - 90) ? yaw + 90 : yaw - 90;
      out.push({ titre: 'côté', endroit: s, reglage: { x: s.x, z: s.z, yawDeg: flank, pitchDeg: 6, distance: 50 } });
    }
    return { out, total: spots.length, km: +placeLab.roads().km };
  }, { worst });
  for (const v of [...plan.out, ...extra.map((r) => ({ titre: 'libre', reglage: r }))]) {
    const info = await page.evaluate((r) => placeLab.set(r), v.reglage);
    const file = `${String(views.length).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(outDir, file) });
    views.push({ file, ...v, info });
    console.log(file, v.titre, v.endroit ? `${v.endroit.pente} % (sol ${v.endroit.sol} %) ${v.endroit.contexte.join(' ')}` : '');
  }
  writeFileSync(join(outDir, 'vues.json'), JSON.stringify({ lieu: place, endroits: plan.total, km: plan.km, vues: views }, null, 2));
} finally {
  await browser.close();
  server.kill();
}
