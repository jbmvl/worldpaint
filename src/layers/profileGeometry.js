// Les géométries balayées se convertissent par lots ; aucun passage Three.js
// sur le tampon entier ne doit retenir la page pendant une reconstruction.
import { releaseAfterUpload } from './facetBuffers.js';

const VERTICES_PER_STEP = 2048;
const VALUES_PER_STEP = VERTICES_PER_STEP * 3;

function* copyValues(source, target, scale = 0, minimum = 0) {
  for (let start = 0; start < source.length; start += VALUES_PER_STEP) {
    const end = Math.min(source.length, start + VALUES_PER_STEP);
    for (let i = start; i < end; i++) {
      const value = scale ? Math.round(source[i] * scale) : source[i];
      target[i] = scale ? Math.max(minimum, Math.min(scale, value)) : value;
    }
    yield;
  }
}

export function* geometryBoundsSteps(THREE, geometry) {
  const positions = geometry.attributes.position.array;
  if (!positions.length) { geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0); return; }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let start = 0; start < positions.length; start += VALUES_PER_STEP) {
    const end = Math.min(positions.length, start + VALUES_PER_STEP);
    for (let i = start; i < end; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    yield;
  }
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  let radiusSquared = 0;
  for (let start = 0; start < positions.length; start += VALUES_PER_STEP) {
    const end = Math.min(positions.length, start + VALUES_PER_STEP);
    for (let i = start; i < end; i += 3) {
      const x = positions[i] - center.x, y = positions[i + 1] - center.y, z = positions[i + 2] - center.z;
      radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
    }
    yield;
  }
  geometry.boundingSphere = new THREE.Sphere(center, Math.sqrt(radiusSquared));
}

/** Mêmes triangles, normales et encodages que toColoredGeometry + packColoredGeometry. */
export function* coloredProfileGeometrySteps(THREE, buffer, { flat = false, packed = false } = {}) {
  if (!buffer.positions.length) return null;
  const count = flat ? buffer.indices.length : buffer.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const colors = buffer.colors ? new Float32Array(count * 3) : null;
  const normals = new Float32Array(count * 3);
  let unitColors = true;
  for (let start = 0; start < count; start += VERTICES_PER_STEP) {
    const end = Math.min(count, start + VERTICES_PER_STEP);
    for (let i = start; i < end; i++) {
      const from = (flat ? buffer.indices[i] : i) * 3;
      for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = buffer.positions[from + k];
        if (colors) {
          const tone = Math.fround(buffer.colors[from + k]);
          colors[i * 3 + k] = tone;
          if (!(tone >= 0 && tone <= 1)) unitColors = false;
        }
      }
    }
    yield;
  }
  let index = null;
  if (!flat) {
    let wide = false;
    for (let start = 0; start < buffer.indices.length; start += VALUES_PER_STEP) {
      const end = Math.min(buffer.indices.length, start + VALUES_PER_STEP);
      for (let i = start; i < end; i++) if (buffer.indices[i] >= 65535) wide = true;
      yield;
    }
    index = new (wide ? Uint32Array : Uint16Array)(buffer.indices.length);
    yield* copyValues(buffer.indices, index);
  }
  const triangles = flat ? count : index.length;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let start = 0; start < triangles; start += VALUES_PER_STEP) {
    const end = Math.min(triangles, start + VALUES_PER_STEP);
    for (let i = start; i < end; i += 3) {
      const ai = (flat ? i : index[i]) * 3;
      const bi = (flat ? i + 1 : index[i + 1]) * 3;
      const ci = (flat ? i + 2 : index[i + 2]) * 3;
      a.fromArray(positions, ai); b.fromArray(positions, bi); c.fromArray(positions, ci);
      cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
      for (const at of [ai, bi, ci]) {
        normals[at] += cb.x; normals[at + 1] += cb.y; normals[at + 2] += cb.z;
      }
    }
    yield;
  }
  for (let start = 0; start < normals.length; start += VALUES_PER_STEP) {
    const end = Math.min(normals.length, start + VALUES_PER_STEP);
    for (let i = start; i < end; i += 3) {
      a.fromArray(normals, i).normalize(); a.toArray(normals, i);
    }
    yield;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (packed) {
    const encoded = new Int8Array(normals.length);
    yield* copyValues(normals, encoded, 127, -127);
    geometry.setAttribute('normal', new THREE.BufferAttribute(encoded, 3, true));
  } else geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors && packed && unitColors) {
    const encoded = new Uint16Array(colors.length);
    yield* copyValues(colors, encoded, 65535);
    geometry.setAttribute('color', new THREE.BufferAttribute(encoded, 3, true));
  } else if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
  yield* geometryBoundsSteps(THREE, geometry);
  return packed ? releaseAfterUpload(geometry) : geometry;
}

/** Rubans texturés : mêmes attributs que toGeometry, convertis par lots. */
export function* ribbonProfileGeometrySteps(THREE, buffer) {
  const geometry = yield* coloredProfileGeometrySteps(THREE, buffer);
  if (!geometry) return null;
  for (const [name, values] of [['uv', buffer.uvs], ['tipUv', buffer.tips]]) {
    if (!values) continue;
    const output = new Float32Array(values.length);
    yield* copyValues(values, output);
    geometry.setAttribute(name, new THREE.BufferAttribute(output, 2));
  }
  return geometry;
}

/** Réserve déjà encodée : garde ses tableaux et calcule les normales par lots. */
export function* storedProfileGeometrySteps(THREE, store) {
  const positions = store.positions.data.subarray(0, store.positions.length);
  const indices = store.indices.data.subarray(0, store.indices.length);
  const geometry = yield* coloredProfileGeometrySteps(THREE, { positions, indices }, { packed: true });
  if (!geometry) return null;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(store.colors.data.subarray(0, store.colors.length), 3, true));
  return releaseAfterUpload(geometry);
}
