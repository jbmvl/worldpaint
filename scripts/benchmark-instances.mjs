/* Banc CPU reproductible des fenêtres d’herbe. Aucune mesure de FPS/GPU.
 * Un chemin de module optionnel permet de comparer un autre état du dépôt. */
import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { defaultTheme } from '../src/themes/default.js';
const source = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : '../src/layers/groundCover.js';
const { GroundCover } = await import(source);
const bubble = {
  frame: {}, surfaceGeneration: 0, verticalScale: 1, surfaceElevationAtLocal: () => 0,
  renderedSupportAtLocal: (x, z, out) => Object.assign(out, { y: 0, slopeX: 0, slopeZ: 0 }),
};
const cover = new GroundCover({ THREE, scene: new THREE.Scene(), bubble, groundClass: null, theme: defaultTheme });
const attributes = [cover.mesh.instanceMatrix, cover.mesh.instanceColor,
  ...Object.values(cover.geometry.attributes).filter(a => a.isInstancedBufferAttribute)];
const clear = () => { for (const a of attributes) a.clearUpdateRanges(); };
for (let x = -90; x <= 0; x += 9) { cover.update(x, 0); clear(); }
const times = []; let bytes = 0;
for (let x = 9; x <= 360; x += 9) {
  const versions = attributes.map(a => a.version);
  const start = performance.now(); cover.update(x, 0); times.push(performance.now() - start);
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    if (a.version !== versions[i]) bytes += a.updateRanges.length
      ? a.updateRanges.reduce((sum, range) => sum + range.count * a.array.BYTES_PER_ELEMENT, 0)
      : a.array.byteLength;
  }
  clear();
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ appels: times.length, instances: cover.mesh.count,
  medianeMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1),
  totalMs: times.reduce((sum, value) => sum + value, 0), octetsParMiseAJour: bytes / times.length,
}, null, 2));
cover.dispose();
