/* Les fleurs restent une strate distincte : leur couleur ne dépend pas de
 * celle du tapis d'herbe. Elles reprennent ses placements et ses exclusions,
 * en conservant les instances des mailles communes à deux fenêtres. */
import { ResidentInstances } from './residentInstances.js';
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
      this.residents.push(new ResidentInstances([mesh.instanceMatrix, geometry.attributes[COVER_ATTRIBUTE]]));
      return mesh;
    });
  }
  syncCells(cells) {
    const wanted = this.meshes.map(() => []);
    for (const cell of cells) {
      if (!cell.flowers) {
        cell.flowers = [];
        for (let i = 0; i < cell.count; i++) {
          const variant = cell.data[4][i] - 1;
          if (this.meshes[variant]) cell.flowers.push({ cell, index: i, variant });
        }
      }
      for (const flower of cell.flowers) {
        const list = wanted[flower.variant];
        if (list.length < CAPACITY) list.push(flower);
      }
    }
    for (let variant = 0; variant < this.meshes.length; variant++) {
      const mesh = this.meshes[variant];
      mesh.count = this.residents[variant].sync(wanted[variant], ({ cell, index }, slot) => {
        const matrix = mesh.instanceMatrix.array;
        matrix.set(cell.data[0].subarray(index * 16, (index + 1) * 16), slot * 16);
        for (const column of [0, 2]) for (let row = 0; row < 3; row++) matrix[slot * 16 + column * 4 + row] *= .5;
        mesh.geometry.attributes[COVER_ATTRIBUTE].array.set(cell.data[2].subarray(index * 4, (index + 1) * 4), slot * 4);
      });
    }
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
