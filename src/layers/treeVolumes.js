/* Premier plan volumétrique d'un peuplement. Les placements appartiennent
 * à vegetationLayer ; cette couche de rendu ne tire aucune essence au sort.
 * Le budget borne les volumes, jamais la présence : les plans dont l'attribut
 * de transition est confié ici restent visibles sans volume de remplacement.
 * Les arbres retenus gardent leurs matrices ; seuls les ajouts et retraits
 * modifient les attributs GPU et les transitions du peuplement.
 */
import { ResidentInstances } from './residentInstances.js';
import { treePrototype } from '../models/treeKit.js';
import { createFoliageMaterial, advanceFoliageWind, setFoliageWind } from '../materials/foliageMaterial.js';
import { COVER_ATTRIBUTE, installCoverTransition } from '../materials/coverTransition.js';
export const TREE_NEAR_FROM = 120;
export const TREE_NEAR_TO = 190;
export const TREE_VOLUME_BUDGET = 2048;
const RANGE = TREE_NEAR_TO + 12;

export class TreeVolumes {
  constructor(THREE, group, theme) {
    this.THREE = THREE;
    this.group = group;
    this.tiles = new Map();
    this.batches = [];
    this.selected = [];
    this.residents = [];
    this.material = createFoliageMaterial({ THREE, map: null, wind: true, windStrength: .028, uprightNormals: false, cacheKey: 'tree-volume-v2' });
    installCoverTransition(this.material, THREE);
    for (let variant = 0; variant < Math.min(9, theme.trees.variants.length); variant++) {
      const geometry = treePrototype(theme.trees.variants[variant], variant, theme.trees.volume).toGeometry(THREE, 'tree-volume');
      geometry.computeVertexNormals();
      const bands = new Float32Array(TREE_VOLUME_BUDGET * 4);
      for (let i = 0; i < TREE_VOLUME_BUDGET; i++) bands.set([0, TREE_NEAR_TO, 0, TREE_NEAR_TO - TREE_NEAR_FROM], i * 4);
      geometry.setAttribute(COVER_ATTRIBUTE, new THREE.InstancedBufferAttribute(bands, 4));
      const mesh = new THREE.InstancedMesh(geometry, this.material, TREE_VOLUME_BUDGET);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      mesh.customDepthMaterial.onBeforeCompile = this.material.onBeforeCompile;
      mesh.customDepthMaterial.customProgramCacheKey = () => 'tree-volume-depth-wind-v2';
      group.add(mesh);
      this.batches.push(mesh);
      mesh.setColorAt(0, new THREE.Color());
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.residents.push(new ResidentInstances([mesh.instanceMatrix, mesh.instanceColor]));
    }
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color();
  }

  set(key, placements, bands = null) {
    if (placements?.length) {
      const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const p of placements) {
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.minZ = Math.min(bounds.minZ, p.z);
        bounds.maxZ = Math.max(bounds.maxZ, p.z);
      }
      const tile = { placements, bands, bounds };
      tile.entries = placements.map((p, index) => ({ tile, index, p, distance: 0 }));
      this.tiles.set(key, tile);
    } else this.tiles.delete(key);
    this.anchor = null;
  }

  update(x, z) {
    this.material.userData.coverObserver.value.set(x, z);
    if (this.anchor && Math.hypot(x - this.anchor.x, z - this.anchor.z) < 8) return;
    this.anchor = { x, z };
    const candidates = [];
    for (const tile of this.tiles.values()) {
      const b = tile.bounds;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      for (let index = 0; index < tile.placements.length; index++) {
        const p = tile.placements[index];
        if (!this.batches[p.variant]) continue;
        const distance = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (distance <= RANGE * RANGE) {
          const entry = tile.entries[index];
          entry.distance = distance;
          candidates.push(entry);
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.p.x - b.p.x || a.p.z - b.p.z || a.p.variant - b.p.variant);
    const previous = new Set(this.selected);
    this.selected = candidates.slice(0, TREE_VOLUME_BUDGET);
    const next = new Set(this.selected);
    const bandsChanged = new Set();
    const setBand = (entry, near) => {
      const { tile, index } = entry;
      if (!tile.bands) return;
      tile.bands.array.set(near ? [TREE_NEAR_FROM, 1e7, TREE_NEAR_TO - TREE_NEAR_FROM, 0] : [0, 1e7, 0, 0], index * 4);
      tile.bands.addUpdateRange(index * 4, 4);
      bandsChanged.add(tile.bands);
    };
    for (const entry of previous) if (!next.has(entry)) setBand(entry, false);
    for (const entry of next) if (!previous.has(entry)) setBand(entry, true);
    for (const attribute of bandsChanged) attribute.needsUpdate = true;
    const wanted = this.batches.map(() => []);
    for (const entry of this.selected) wanted[entry.p.variant].push(entry);
    for (let variant = 0; variant < this.batches.length; variant++) {
      const mesh = this.batches[variant];
      mesh.count = this.residents[variant].sync(wanted[variant], ({ p }, slot) => {
        this.position.set(p.x, p.y, p.z);
        this.scale.set(p.height * p.aspect, p.height, p.height * p.aspect);
        this.rotation.setFromAxisAngle(this.axis, p.rotation);
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(slot, this.matrix);
        this.color.setRGB(...p.color);
        mesh.setColorAt(slot, this.color);
      });
    }
  }

  advance(delta) { advanceFoliageWind(this.material, delta); }
  setWind(field) { setFoliageWind(this.material, field); }
  dispose() {
    for (const mesh of this.batches) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.customDepthMaterial.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.tiles.clear();
    for (const resident of this.residents) resident.clear();
    this.selected = [];
  }
}
