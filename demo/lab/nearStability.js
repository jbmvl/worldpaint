/*
 * nearStability — ce qui change à proximité de l'observateur quand il avance.
 *
 * Sert le banc des lieux (`placeLab.walk`). Deux mesures, prises au même pas :
 *
 *   - l'image : la vue rendue depuis le nouveau point avec le décor encore
 *     construit pour l'ancien, puis la même vue après mise à jour complète
 *     (recentrage, `refresh`, files vidées). Le plan lointain de la caméra est
 *     ramené au rayon de proximité : seul ce qui est près peut différer ;
 *   - la géométrie, couche par couche : sommets et instances dans le rayon,
 *     comptés et hachés, pour dire *qui* a changé.
 *
 * Ce qui bouge de lui-même (bêtes, trains, oiseaux, spectateurs, tracteurs) et
 * les lumières qui suivent l'observateur sont éteints pendant la mesure : on
 * cherche ce que la construction repeint, pas ce qui s'anime.
 */

const ANIMATED = new Set(['life', 'fauna', 'tractors', 'trains', 'spectators']);

/** Éteint ce qui s'anime ; rend une fonction qui le rallume. */
export function muteAnimated(root) {
  const muted = [];
  root.traverse((o) => {
    if ((ANIMATED.has(o.name) || o.isPointLight) && o.visible) {
      o.visible = false;
      muted.push(o);
    }
  });
  return () => { for (const o of muted) o.visible = true; };
}

function visible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function layerName(o, root, names) {
  if (names.has(o)) return names.get(o);
  const parent = o.parent && o.parent !== root ? `${o.parent.name}/` : '';
  // Les clés de tuile (« vegetation-15:16234:11502 ») regroupées sous leur couche.
  return parent + (o.name || o.type).replace(/-?\d+[:/-]\d+.*$/, '');
}

/**
 * Empreinte de la géométrie visible à moins de `radius` de (x, z), par couche.
 * `names` nomme les maillages anonymes (objet → couche).
 * @returns {Object<string,{n:number,h:number}>}
 */
export function geometrySnapshot(root, x, z, radius, names = new Map()) {
  const out = {};
  const r2 = radius * radius;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine) || !visible(o)) return;
    const position = o.geometry?.getAttribute('position');
    if (!position) return;
    const entry = out[layerName(o, root, names)] ??= { n: 0, h: 0 };
    const add = (px, py, pz, extra = 0) => {
      entry.n++;
      entry.h = (entry.h + Math.round(px * 10) * 7 + Math.round(py * 10) * 13 + Math.round(pz * 10) * 17 + extra) % 1e9;
    };
    if (o.isInstancedMesh) {
      const a = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        const px = a[i * 16 + 12], pz = a[i * 16 + 14];
        if ((px - x) ** 2 + (pz - z) ** 2 <= r2) add(px, a[i * 16 + 13], pz, Math.round(a[i * 16] * 100));
      }
      return;
    }
    const m = o.matrixWorld.elements;
    const arr = position.array, stride = position.itemSize;
    const range = o.geometry.drawRange;
    const end = Math.min(position.count, range.start + (Number.isFinite(range.count) ? range.count : position.count));
    for (let i = range.start; i < end; i++) {
      const lx = arr[i * stride], ly = arr[i * stride + 1], lz = arr[i * stride + 2];
      const px = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const pz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      if ((px - x) ** 2 + (pz - z) ** 2 > r2) continue;
      add(px, m[1] * lx + m[5] * ly + m[9] * lz + m[13], pz);
    }
  });
  return out;
}

/** Couches dont l'empreinte diffère : `{ couche: [avant, après] }` en éléments comptés. */
export function compareSnapshots(before, after) {
  const changed = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key] ?? { n: 0, h: 0 };
    const b = after[key] ?? { n: 0, h: 0 };
    if (a.n !== b.n || a.h !== b.h) changed[key] = [a.n, b.n];
  }
  return changed;
}

/** Rend `scene` vue par `camera` dans une cible hors écran et en rend les pixels. */
export function readView(THREE, renderer, scene, camera, target) {
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  const pixels = new Uint8Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
  return pixels;
}

/** Part des pixels dont une composante s'écarte de plus de `tolerance`. */
export function pixelChange(a, b, tolerance = 10) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tolerance || Math.abs(a[i + 1] - b[i + 1]) > tolerance || Math.abs(a[i + 2] - b[i + 2]) > tolerance) changed++;
  }
  return changed / (a.length / 4);
}
