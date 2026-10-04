import { EARTH_CIRCUMFERENCE } from '../core/tileMath.js';
/* Couche de rendu seulement : construit un lot préparé, l'échange d'un bloc,
 * anime un temps persistant et libère ses propres ressources. */
import {createWaterMaterial,createWaterTexture,WATER_PROFILE_DEFAULTS} from '../materials/waterMaterial.js';
export class WaterLayer {
  constructor({THREE,scene,theme}) {
    this.THREE=THREE;this.theme=theme;this.time={value:0};this.group=new THREE.Group();this.group.name='eau';scene.add(this.group);this.meshes=[];this.index=null;this.texture=null;
  }
  prepare(index,frame,verticalScale=1) {
    const {THREE}=this,byKind=new Map(),meshes=[];
    if(!this.texture && index.triangles.length)this.texture=createWaterTexture(THREE);
    const mercatorScale=EARTH_CIRCUMFERENCE/2**frame.zoom,geoScale=mercatorScale/frame.scale,geoOrigin=[frame.origin.x*mercatorScale,frame.origin.y*mercatorScale];
    try {
      for(const t of index.triangles) {let list=byKind.get(t.kind);if(!list)byKind.set(t.kind,list=[]);list.push(t);}
      for(const [kind,triangles] of byKind) {
        const attributes={position:[],normal:[],alongM:[],acrossM:[],flow:[],flowKnown:[],waveWeight:[],foamAcross:[],shoreM:[],phaseBlendM:[]};
        for(const t of triangles)for(const p of t.points) {
          attributes.position.push(p.x,p.levelM*verticalScale,p.z);attributes.normal.push(0,1,0);
          attributes.flow.push(p.flowX??0,p.flowZ??0);
          for(const name of ['alongM','acrossM','flowKnown','waveWeight','foamAcross','shoreM','phaseBlendM'])attributes[name].push(p[name]??(name==='foamAcross'?1:0));
        }
        const geometry=new THREE.BufferGeometry();for(const [name,data] of Object.entries(attributes))geometry.setAttribute(name,new THREE.Float32BufferAttribute(data,name==='position'||name==='normal'?3:name==='flow'?2:1));
        geometry.computeBoundingBox();geometry.computeBoundingSphere();
        const amplitude=(this.theme.water?.profiles?.[kind]?.amplitudeM??WATER_PROFILE_DEFAULTS.amplitudeM)*verticalScale*1.5;
        if(geometry.boundingBox){geometry.boundingBox.min.y-=amplitude;geometry.boundingBox.max.y+=amplitude;}if(geometry.boundingSphere)geometry.boundingSphere.radius+=amplitude;
        const material=createWaterMaterial(THREE,{kind,theme:this.theme,texture:this.texture,time:this.time,geoOrigin,geoScale,verticalScale}),mesh=new THREE.Mesh(geometry,material);
        mesh.name=`eau-${kind}`;mesh.receiveShadow=true;meshes.push(mesh);
      }
      return {index,frame,meshes};
    } catch(e) {this.discard({meshes});throw e;}
  }
  discard(prepared) {for(const mesh of prepared.meshes){mesh.geometry.dispose();mesh.material.dispose();}}
  publish(prepared) {
    this.clear();this.meshes=prepared.meshes;this.index=prepared.index;this.frame=prepared.frame;
    for(const mesh of this.meshes)this.group.add(mesh);
  }
  advance(delta) {this.time.value+=Math.max(0,delta);}
  setTime(time) {this.time.value=time;}
  clear() {for(const mesh of this.meshes)this.group.remove(mesh);this.discard({meshes:this.meshes});this.meshes=[];this.index=null;}
  dispose() {this.clear();this.texture?.dispose();this.texture=null;this.group.parent?.remove(this.group);}
}
