/**
 * cellMeshes — un grand maillage fusionné, dessiné par cases.
 *
 * Le bâti et la voirie d'une ville sont chacun un seul maillage de plusieurs
 * centaines de milliers de triangles, qui couvre toute la portée du détail.
 * D'un seul tenant, il part au GPU en entier à chaque image, et une seconde
 * fois dans la carte d'ombres, alors que la caméra n'en voit qu'un secteur et
 * que l'ombre n'en couvre qu'un carré de deux cents mètres.
 *
 * Les triangles sont donc rangés par case du sol dans l'index, et chaque case
 * reçoit son maillage : une plage de l'index et sa sphère englobante, que
 * three.js élague hors champ, caméra comme soleil.
 *
 * Deux décisions à ne pas défaire :
 *
 * - **les cases partagent les tampons.** Sommets et index restent uniques, au
 *   format de `facetBuffers` : seul l'ordre de l'index change, et rien n'est
 *   copié en plus sur le GPU ;
 * - **la case n'est pas une donnée du décor.** Elle ne décide que de ce qui est
 *   envoyé au GPU : la taille et l'origine des cases ne changent pas l'image.
 */

/** Côté d'une case, en mètres : quelques cases dans le carré d'ombre, quelques dizaines dans la portée du détail. */
export const MESH_CELL_M = 96;

/**
 * Range l'index d'une géométrie par case du sol (centre de chaque triangle) et
 * rend une géométrie par case, aux tampons partagés. À appeler avant l'envoi
 * au GPU : les positions sont relues.
 *
 * @returns {Array<Object>} Géométries de case ; la géométrie reçue ne sert plus.
 */
export function splitByCells(THREE, geometry, cellM = MESH_CELL_M) {
  const index = geometry.index;
  const positions = geometry.attributes.position.array;
  const source = index.array;
  const triangles = source.length / 3;
  const slotOf = new Map();
  const slots = new Uint16Array(triangles);
  const cells = [];
  let lastKey = NaN;
  let slot = 0;
  for (let t = 0; t < triangles; t++) {
    const a = source[t * 3] * 3;
    const b = source[t * 3 + 1] * 3;
    const c = source[t * 3 + 2] * 3;
    const cx = Math.floor((positions[a] + positions[b] + positions[c]) / (3 * cellM));
    const cz = Math.floor((positions[a + 2] + positions[b + 2] + positions[c + 2]) / (3 * cellM));
    const key = cx * 65536 + cz;
    // Deux triangles voisins dans l'index le sont presque toujours au sol.
    if (key !== lastKey) {
      lastKey = key;
      slot = slotOf.get(key);
      if (slot === undefined) {
        slot = cells.length;
        slotOf.set(key, slot);
        cells.push({ count: 0, start: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      }
    }
    slots[t] = slot;
    const cell = cells[slot];
    cell.count++;
    grow(cell, positions, a);
    grow(cell, positions, b);
    grow(cell, positions, c);
  }

  let start = 0;
  for (const cell of cells) {
    cell.start = start;
    start += cell.count;
    cell.count = 0;
  }
  const sorted = new source.constructor(source.length);
  for (let t = 0; t < triangles; t++) {
    const cell = cells[slots[t]];
    const to = (cell.start + cell.count++) * 3;
    sorted[to] = source[t * 3];
    sorted[to + 1] = source[t * 3 + 1];
    sorted[to + 2] = source[t * 3 + 2];
  }
  source.set(sorted);

  return cells.map((cell) => {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) part.setAttribute(name, attribute);
    part.setIndex(index);
    part.setDrawRange(cell.start * 3, cell.count * 3);
    const { min, max } = cell;
    part.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2),
      Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
    );
    return part;
  });
}

function grow(cell, positions, at) {
  for (let k = 0; k < 3; k++) {
    const v = positions[at + k];
    if (v < cell.min[k]) cell.min[k] = v;
    if (v > cell.max[k]) cell.max[k] = v;
  }
}

/** Les maillages de case d'une couche, sous un groupe à son nom. */
export class CellMeshes {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.material
   * @param {string} options.name Nom du groupe et de ses maillages.
   * @param {boolean} [options.castShadow]
   */
  constructor({ THREE, scene, material, name, castShadow = false }) {
    this.THREE = THREE;
    this.scene = scene;
    this.material = material;
    this.castShadow = castShadow;
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.matrixAutoUpdate = false;
  }

  /** Remplace les maillages par ceux de `geometry` ; `null` les retire. */
  set(geometry) {
    const { THREE, group } = this;
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear();
    if (!geometry) {
      this.scene.remove(group);
      return;
    }
    for (const part of splitByCells(THREE, geometry)) {
      const mesh = new THREE.Mesh(part, this.material);
      mesh.name = group.name;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (!group.parent) this.scene.add(group);
  }

  dispose() {
    this.set(null);
  }
}
