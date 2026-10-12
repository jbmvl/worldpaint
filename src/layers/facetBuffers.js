/**
 * Les tampons des maillages fusionnés à facettes (bâti, fenêtres, jardins,
 * voirie de rue) : ce qu'ils pèsent pendant qu'on les remplit, et une fois en
 * scène.
 *
 * Trois décisions à ne pas défaire :
 *
 * - **on accumule dans le format final.** Un million de sommets poussés dans
 *   des tableaux JS coûte huit octets par nombre, puis une copie : c'est ce
 *   pic, pas ce qui reste en scène, qui fait tuer l'onglet sur un téléphone ;
 * - **normale sur un octet signé, couleur sur seize bits.** Une normale de
 *   facette tolère 1/127 ; une couleur linéaire sombre, non — sur huit bits,
 *   le pas vaut un cinquième d'une teinte à 0,02 ;
 * - **la copie côté page est rendue après l'envoi au GPU.** Personne ne relit
 *   ces maillages : ni lancer de rayon, ni couche. Un maillage qu'on relit
 *   (le terrain, l'herbe) ne passe pas par `releaseAfterUpload` ;
 * - **un tampon se taille sur la construction précédente.** Grandir par
 *   doublement laisse une copie à chaque palier, et le ramasse-miettes ne les
 *   rend pas avant la fin de la reconstruction.
 */

const NORMAL_SCALE = 127;
const COLOR_SCALE = 65535;
// Marge sur la longueur attendue : d'un pas de l'observateur à l'autre, un maillage change peu.
const HEADROOM = 1.125;

/** Tableau typé qui grandit, avec le `push` et le `length` d'un tableau. */
export class GrowingArray {
  /**
   * @param {Function} Type Constructeur du tableau typé.
   * @param {number} [scale] Facteur d'encodage d'une valeur normalisée ; 0 : valeur brute.
   * @param {number} [expected] Longueur attendue, celle de la construction précédente.
   */
  constructor(Type, scale = 0, expected = 0) {
    this.Type = Type;
    this.scale = scale;
    this.data = new Type(Math.max(4096, Math.ceil(expected * HEADROOM)));
    this.length = 0;
    this._min = scale && Type === Int8Array ? -scale : 0;
  }

  /** Garantit la place de `extra` valeurs de plus. */
  reserve(extra) {
    const needed = this.length + extra;
    if (needed <= this.data.length) return;
    const grown = new this.Type(Math.max(needed, this.data.length * 2));
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }

  push() {
    // `arguments`, pas un paramètre de reste : celui-ci alloue un tableau par appel.
    const values = arguments;
    this.reserve(values.length);
    const { data, scale } = this;
    let at = this.length;
    if (scale === 0) {
      for (let i = 0; i < values.length; i++) data[at++] = values[i];
    } else {
      const min = this._min;
      for (let i = 0; i < values.length; i++) {
        const v = Math.round(values[i] * scale);
        data[at++] = v < min ? min : v > scale ? scale : v;
      }
    }
    this.length = at;
  }
}

/**
 * Accumulateur d'un maillage à facettes : positions, normales et couleurs, trois nombres par sommet.
 *
 * @param {number} [expected] `positions.length` de la construction précédente.
 */
export function createFacetBuffer(expected = 0) {
  return {
    positions: new GrowingArray(Float32Array, 0, expected),
    normals: new GrowingArray(Int8Array, NORMAL_SCALE, expected),
    colors: new GrowingArray(Uint16Array, COLOR_SCALE, expected),
  };
}

/**
 * Réserve indexée d'un maillage de sections balayées (`createProfileBuffer`),
 * au format final. Les couches y versent leur accumulateur par lots : les
 * fonctions de `ribbonGeometry` relisent le leur par indice, ce qu'un tableau
 * typé qui grandit ne permet pas, mais un lot reste petit.
 *
 * @param {{positions:{length:number}, indices:{length:number}}|null} [previous] Réserve de la construction précédente.
 */
export function createProfileStore(previous = null) {
  const values = previous?.positions.length ?? 0;
  return {
    positions: new GrowingArray(Float32Array, 0, values),
    colors: new GrowingArray(Uint16Array, COLOR_SCALE, values),
    indices: new GrowingArray(Uint32Array, 0, previous?.indices.length ?? 0),
  };
}

/** Verse un accumulateur de sections dans la réserve, et le vide. */
export function drainProfileBuffer(store, buffer) {
  const { positions, colors, indices } = buffer;
  const base = store.positions.length / 3;
  store.positions.reserve(positions.length);
  store.positions.data.set(positions, store.positions.length);
  store.positions.length += positions.length;
  store.colors.reserve(colors.length);
  const tones = store.colors.data;
  let at = store.colors.length;
  for (let i = 0; i < colors.length; i++) {
    // Arrondi d'un flottant simple d'abord : la teinte encodée ne dépend pas du lot.
    const v = Math.round(Math.fround(colors[i]) * COLOR_SCALE);
    tones[at++] = v < 0 ? 0 : v > COLOR_SCALE ? COLOR_SCALE : v;
  }
  store.colors.length = at;
  store.indices.reserve(indices.length);
  const index = store.indices.data;
  at = store.indices.length;
  for (let i = 0; i < indices.length; i++) index[at++] = base + indices[i];
  store.indices.length = at;
  positions.length = 0;
  colors.length = 0;
  indices.length = 0;
}

/** La géométrie d'une réserve de `createProfileStore`, normales lissées ; `null` si elle est vide. */
export function profileStoreGeometry(THREE, store) {
  if (store.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(store.positions.data.subarray(0, store.positions.length), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(store.colors.data.subarray(0, store.colors.length), 3, true));
  geometry.setIndex(new THREE.BufferAttribute(store.indices.data.subarray(0, store.indices.length), 1));
  geometry.computeVertexNormals();
  geometry.setAttribute('normal', encoded(THREE, geometry.attributes.normal, Int8Array, NORMAL_SCALE));
  geometry.computeBoundingSphere();
  return releaseAfterUpload(geometry);
}

function sameVertex(positions, normals, colors, a, b) {
  for (let k = 0; k < 3; k++) {
    if (positions[a * 3 + k] !== positions[b * 3 + k] || normals[a * 3 + k] !== normals[b * 3 + k] ||
      colors[a * 3 + k] !== colors[b * 3 + k]) return false;
  }
  return true;
}

function moveVertex(positions, normals, colors, from, to) {
  if (from === to) return;
  for (let k = 0; k < 3; k++) {
    positions[to * 3 + k] = positions[from * 3 + k];
    normals[to * 3 + k] = normals[from * 3 + k];
    colors[to * 3 + k] = colors[from * 3 + k];
  }
}

/**
 * Indexe sur place une liste de triangles : deux triangles consécutifs qui
 * partagent une arête — un pan, posé en deux triangles — gardent quatre
 * sommets au lieu de six. L'ordre des triangles ne change pas.
 *
 * @returns {{count: number, index: Uint16Array|Uint32Array}} Sommets gardés, et l'index.
 */
export function indexFacetPairs(positions, normals, colors, vertexCount) {
  const index = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(vertexCount);
  const shared = [0, 0, 0];
  let written = 0;
  let k = 0;
  let read = 0;
  while (read + 2 < vertexCount) {
    let matches = 0;
    if (read + 5 < vertexCount) {
      for (let b = 0; b < 3; b++) {
        shared[b] = -1;
        for (let a = 0; a < 3 && shared[b] < 0; a++) {
          if (sameVertex(positions, normals, colors, read + a, read + 3 + b)) shared[b] = a;
        }
        if (shared[b] >= 0) matches++;
      }
    }
    for (let a = 0; a < 3; a++) {
      moveVertex(positions, normals, colors, read + a, written + a);
      index[k++] = written + a;
    }
    if (matches !== 2) {
      written += 3;
      read += 3;
      continue;
    }
    for (let b = 0; b < 3; b++) {
      if (shared[b] >= 0) {
        index[k++] = written + shared[b];
      } else {
        moveVertex(positions, normals, colors, read + 3 + b, written + 3);
        index[k++] = written + 3;
      }
    }
    written += 4;
    read += 6;
  }
  return { count: written, index: index.subarray(0, k) };
}

/** La géométrie indexée d'un accumulateur de `createFacetBuffer`, sphère englobante calculée. */
export function facetGeometry(THREE, buffer) {
  const positions = buffer.positions.data;
  const normals = buffer.normals.data;
  const colors = buffer.colors.data;
  const { count, index } = indexFacetPairs(positions, normals, colors, buffer.positions.length / 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, count * 3), 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, count * 3), 3, true));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return releaseAfterUpload(geometry);
}

/**
 * Resserre une géométrie colorée faite ailleurs, comme celles d'ici : normale
 * sur un octet, couleur sur seize bits tant qu'elle tient dans [0, 1], copie
 * rendue après l'envoi au GPU.
 */
export function packColoredGeometry(THREE, geometry) {
  const { normal, color } = geometry.attributes;
  if (normal) geometry.setAttribute('normal', encoded(THREE, normal, Int8Array, NORMAL_SCALE));
  if (color && color.array.every((v) => v >= 0 && v <= 1)) geometry.setAttribute('color', encoded(THREE, color, Uint16Array, COLOR_SCALE));
  return releaseAfterUpload(geometry);
}

function encoded(THREE, attribute, Type, scale) {
  const source = attribute.array;
  const min = Type === Int8Array ? -scale : 0;
  const array = new Type(source.length);
  for (let i = 0; i < source.length; i++) {
    const v = Math.round(source[i] * scale);
    array[i] = v < min ? min : v > scale ? scale : v;
  }
  return new THREE.BufferAttribute(array, attribute.itemSize, true);
}

function dropArray() {
  this.array = null;
}

/** Rend la copie côté page de chaque tampon une fois celui-ci envoyé au GPU. */
export function releaseAfterUpload(geometry) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  for (const attribute of Object.values(geometry.attributes)) attribute.onUpload(dropArray);
  geometry.index?.onUpload(dropArray);
  return geometry;
}
