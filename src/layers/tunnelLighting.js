/* Lanternes instanciées et deux lumières locales sans ombres. Le budget ne
 * dépend pas du nombre de tunnels chargés : seules les deux plus proches éclairent. */
export class TunnelLighting {
  constructor(THREE, scene, look) {
    this.THREE = THREE; this.scene = scene; this.look = look; this.fixtures = [];
    this.lights = Array.from({length: 2}, () => {
      const light = new THREE.PointLight(new THREE.Color().setRGB(...look.color), 0, look.reachM, 2);
      light.visible = false;
      scene.add(light);
      return light;
    });
    this.geometry = new THREE.BoxGeometry(.55, .12, .28);
    this.material = new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(...look.color)});
    this.matrix = new THREE.Matrix4();
  }
  rebuild(fixtures) {
    this.fixtures = fixtures;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.mesh = new this.THREE.InstancedMesh(this.geometry, this.material, Math.max(1, fixtures.length));
    this.mesh.count = fixtures.length;
    fixtures.forEach((p, i) => { this.matrix.makeTranslation(p.x,p.y,p.z); this.mesh.setMatrixAt(i,this.matrix); });
    this.scene.add(this.mesh);
  }
  update(at) {
    const nearest = this.fixtures.map(p=>({p,d:Math.hypot(p.x-at.x,p.z-at.z,(p.y-(at.y??p.y))*.5)}))
      .filter(v=>v.d<this.look.reachM).sort((a,b)=>a.d-b.d).slice(0,2);
    this.lights.forEach((light,i)=>{
      const entry=nearest[i]; light.visible=!!entry;
      if(entry) { light.position.set(entry.p.x,entry.p.y-.25,entry.p.z); light.intensity=this.look.intensity; }
    });
  }
  dispose() {
    for(const light of this.lights) { this.scene.remove(light); light.dispose?.(); }
    if(this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.geometry.dispose(); this.material.dispose();
  }
}
