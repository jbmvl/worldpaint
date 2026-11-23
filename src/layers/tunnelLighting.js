import { createGlowGeometry, createGlowMaterial } from './furnitureKit.js';

/* Lanternes instanciées et leurs halos, sans aucune vraie lumière : allumer ou
 * éteindre une lumière change le nombre de lumières de la scène, et three
 * recompile alors tous les matériaux éclairés (gel net à l'entrée du tunnel).
 * Le halo est celui des lampadaires, même programme GPU, toujours allumé. */
export class TunnelLighting {
  constructor(THREE, scene, look) {
    this.THREE = THREE; this.scene = scene; this.look = look; this.fixtures = [];
    this.geometry = new THREE.BoxGeometry(.55, .12, .28);
    this.material = new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(...look.color)});
    this.glowGeometry = createGlowGeometry(THREE);
    this.glowMaterial = createGlowMaterial(THREE, {color: look.color});
    this.glowMaterial.uniforms.uOpacity.value = 1;
    this.matrix = new THREE.Matrix4();
  }
  rebuild(fixtures) {
    const {THREE} = this;
    this.fixtures = fixtures;
    this._clear();
    const count = Math.max(1, fixtures.length);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.glow = new THREE.InstancedMesh(this.glowGeometry, this.glowMaterial, count);
    this.glow.name = 'tunnel-lamp-glow';
    // Comme les halos des lampadaires : additif sans profondeur, peint après le reste.
    this.glow.renderOrder = 8;
    this.glow.frustumCulled = false;
    this.mesh.count = this.glow.count = fixtures.length;
    const halo = new THREE.Matrix4().makeScale(this.look.haloM, this.look.haloM, this.look.haloM);
    fixtures.forEach((p, i) => {
      this.matrix.makeTranslation(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this.matrix);
      // Le shader lit le rayon du halo dans l'échelle de l'instance.
      this.glow.setMatrixAt(i, this.matrix.clone().multiply(halo));
    });
    this.scene.add(this.mesh, this.glow);
  }
  _clear() {
    for (const mesh of [this.mesh, this.glow]) if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
    this.mesh = this.glow = null;
  }
  dispose() {
    this._clear();
    this.geometry.dispose(); this.material.dispose();
    this.glowGeometry.dispose(); this.glowMaterial.dispose();
  }
}
