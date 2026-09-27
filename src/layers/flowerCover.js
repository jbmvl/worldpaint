/* Les fleurs restent une strate distincte : leur couleur ne dépend pas de
 * celle du tapis d'herbe. Elles reprennent ses placements et ses exclusions,
 * en conservant les instances des mailles communes à deux fenêtres. */
import { ResidentGrass } from './residentGrass.js';
import { Kit } from '../models/kit.js';
import { createFoliageMaterial, advanceFoliageWind, setFoliageWind } from '../materials/foliageMaterial.js';
import { COVER_ATTRIBUTE, installCoverTransition } from '../materials/coverTransition.js';
const CAPACITY = 8192;
export class FlowerCover {
  constructor(THREE, scene, look) {
    this.scene = scene;
    this.residents = [];
    this.material = createFoliageMaterial({ THREE, map: null, wind: true, windStrength: .1, cacheKey: 'flowers-v1' });
    installCoverTransition(this.material, THREE, { mode: 'alpha' });
    this.meshes = look.petals.map((color, variant) => {
      const k = new Kit();
      k.quad([-.012,0,0],[.012,0,0],[.008,1,0],[-.008,1,0],look.stem);
      k.quad([0,0,-.012],[0,0,.012],[0,1,.008],[0,1,-.008],look.stem);
      const petals = variant === 2 ? 4 : 6;
      const point = i => {
        const angle = i * Math.PI / petals;
        const radius = i % 2 ? .065 : .15;
        return [Math.cos(angle)*radius,.98,Math.sin(angle)*radius];
      };
      for (let i = 0; i < petals*2; i++) k.tri([0,1,0],point(i+1),point(i),color);
      for (let i = 0; i < 6; i++) {
        const a=i*Math.PI/3,b=(i+1)*Math.PI/3;
        k.tri([0,1.005,0],[Math.cos(b)*.04,1.005,Math.sin(b)*.04],[Math.cos(a)*.04,1.005,Math.sin(a)*.04],look.centres[variant]);
      }
      const geometry = k.toGeometry(THREE);
      const bands = new Float32Array(CAPACITY * 4);
      geometry.setAttribute(COVER_ATTRIBUTE, new THREE.InstancedBufferAttribute(bands, 4));
      const mesh = new THREE.InstancedMesh(geometry, this.material, CAPACITY);
      mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
      scene.add(mesh);
      this.residents.push(new ResidentGrass([mesh.instanceMatrix, geometry.attributes[COVER_ATTRIBUTE]]));
      return mesh;
    });
  }
  syncCells(cells) {
    const wanted = this.meshes.map(() => []);
    const counts = this.meshes.map(() => 0);
    for (const cell of cells) {
      cell.flowers ??= this._flowersOf(cell);
      for (let variant = 0; variant < this.meshes.length; variant++) {
        const flowers = cell.flowers[variant];
        if (!flowers || counts[variant] + flowers.count > CAPACITY) continue;
        wanted[variant].push(flowers);
        counts[variant] += flowers.count;
      }
    }
    for (let variant = 0; variant < this.meshes.length; variant++) {
      this.meshes[variant].count = this.residents[variant].sync(wanted[variant]);
    }
  }
  /** Les fleurs d’une maille d’herbe, rangées par variante comme une maille à part. */
  _flowersOf(cell) {
    const [matrices, , bands, , variants] = cell.data;
    const indices = this.meshes.map(() => []);
    for (let i = 0; i < cell.count; i++) indices[variants[i] - 1]?.push(i);
    return indices.map((list) => {
      if (!list.length) return null;
      const matrix = new Float32Array(list.length * 16), band = new Float32Array(list.length * 4);
      list.forEach((index, k) => {
        matrix.set(matrices.subarray(index * 16, (index + 1) * 16), k * 16);
        for (const column of [0, 2]) for (let row = 0; row < 3; row++) matrix[k * 16 + column * 4 + row] *= .5;
        band.set(bands.subarray(index * 4, (index + 1) * 4), k * 4);
      });
      return { count: list.length, data: [matrix, band] };
    });
  }
  update(x, z) { this.material.userData.coverObserver.value.set(x, z); }
  advance(delta) { advanceFoliageWind(this.material, delta); }
  setWind(field) { setFoliageWind(this.material, field); }
  dispose() {
    for (const mesh of this.meshes) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose();
    for (const resident of this.residents) resident.clear();
  }
}
