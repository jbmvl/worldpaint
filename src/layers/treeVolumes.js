/* Premier plan volumétrique d'un peuplement. Les placements appartiennent
 * à vegetationLayer ; cette couche de rendu ne tire aucune essence au sort.
 */
import { treePrototype } from '../models/treeKit.js';
import { createFoliageMaterial, advanceFoliageWind, setFoliageWind } from '../materials/foliageMaterial.js';
import { COVER_ATTRIBUTE, installCoverTransition } from '../materials/coverTransition.js';
export const TREE_NEAR_FROM = 120;
export const TREE_NEAR_TO = 190;
const CAPACITY = 8192;
export class TreeVolumes {
  constructor(THREE, group, theme) {
    this.THREE=THREE; this.group=group; this.tiles=new Map(); this.batches=[];
    this.material=createFoliageMaterial({THREE,map:null,wind:true,windStrength:.028,uprightNormals:false,cacheKey:'tree-volume-v1'});
    installCoverTransition(this.material,THREE,{mode:'alpha'});
    this.material.depthWrite = true;
    for(let variant=0;variant<Math.min(9,theme.trees.variants.length);variant++) {
      const geometry=treePrototype(theme.trees.variants[variant],variant,theme.trees.volume).toGeometry(THREE,'tree-volume');
      geometry.computeVertexNormals();
      const bands=new Float32Array(CAPACITY*4);
      for(let i=0;i<CAPACITY;i++) bands.set([0,TREE_NEAR_TO,0,TREE_NEAR_TO-TREE_NEAR_FROM],i*4);
      geometry.setAttribute(COVER_ATTRIBUTE,new THREE.InstancedBufferAttribute(bands,4));
      const mesh=new THREE.InstancedMesh(geometry,this.material,CAPACITY);
      mesh.renderOrder=2;
      mesh.count=0; mesh.frustumCulled=false; mesh.receiveShadow=true; mesh.castShadow=true;
      // La profondeur reçoit exactement le même fondu que la surface.
      mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      mesh.customDepthMaterial.onBeforeCompile = this.material.onBeforeCompile;
      mesh.customDepthMaterial.customProgramCacheKey = () => 'tree-volume-depth-wind-v1';
      group.add(mesh); this.batches.push(mesh);
    }
    this.matrix=new THREE.Matrix4(); this.position=new THREE.Vector3(); this.rotation=new THREE.Quaternion(); this.scale=new THREE.Vector3(); this.axis=new THREE.Vector3(0,1,0); this.color=new THREE.Color();
  }
  set(key, placements) { if(placements) this.tiles.set(key,placements); else this.tiles.delete(key); this.anchor=null; }
  update(x,z) {
    this.material.userData.coverObserver.value.set(x,z);
    if(this.anchor && Math.hypot(x-this.anchor.x,z-this.anchor.z)<8) return;
    this.anchor={x,z};
    for(const mesh of this.batches) mesh.count=0;
    for(const placements of this.tiles.values()) for(const p of placements) {
      const mesh=this.batches[p.variant];
      if(!mesh || Math.hypot(p.x-x,p.z-z)>TREE_NEAR_TO+12 || mesh.count>=CAPACITY) continue;
      this.position.set(p.x,p.y,p.z); this.scale.set(p.height*p.aspect,p.height,p.height*p.aspect);
      this.rotation.setFromAxisAngle(this.axis,p.rotation);
      this.matrix.compose(this.position,this.rotation,this.scale);
      mesh.setMatrixAt(mesh.count,this.matrix);
      this.color.setRGB(...p.color); mesh.setColorAt(mesh.count++,this.color);
    }
    for(const mesh of this.batches) {mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  advance(delta) {advanceFoliageWind(this.material,delta);}
  setWind(field) {setFoliageWind(this.material,field);}
  dispose() {for(const mesh of this.batches){this.group.remove(mesh);mesh.geometry.dispose();mesh.customDepthMaterial.dispose();mesh.dispose();}this.material.dispose();this.tiles.clear();}
}
