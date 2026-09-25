/* Le semis doit toucher la surface triangulée, pas une surface bilinéaire
 * différente. Le modelé procédural reste actif dans les prairies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { meshSupport } from '../src/terrain/meshSupport.js';
import { GroundCover } from '../src/layers/groundCover.js';
import { defaultTheme } from '../src/themes/default.js';
const geometry = () => new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1,1,2,1],3));
test('l’appui respecte les deux triangles et leur arête commune',()=>{
 const g=geometry();
 assert.equal(meshSupport(g,1,0,0,1,.25,.25).y,0);
 assert.equal(meshSupport(g,1,0,0,1,.5,.5).y,0);
 assert.equal(meshSupport(g,1,0,0,1,.75,.75).y,1);
 assert.equal(meshSupport(g,1,0,0,1,.75,.75).slopeX,2);
 g.dispose();
});
test('chaque racine se recale sur son triangle sans modifier les autres instances',()=>{
 const g=geometry(),scene=new THREE.Scene();
 const bubble={frame:{},surfaceGeneration:0,verticalScale:1,surfaceElevationAtLocal:()=>-10,
   renderedSupportAtLocal:(x,z,out)=>meshSupport(g,1,0,0,1,(x%1+1)%1,(z%1+1)%1,out)};
 const cover=new GroundCover({THREE,scene,bubble,groundClass:null,count:2000});
 cover.update(0,0);
 const matrix=new THREE.Matrix4();
 for(let i=0;i<100;i++) {
  cover.mesh.getMatrixAt(i,matrix);
  for(let blade=0;blade<9;blade++) {
   const [x,z]=cover.geometry.userData.roots[blade];
   const root=new THREE.Vector3(x,0,z).applyMatrix4(matrix);
   root.y+=cover._rootOffsets[Math.floor(blade/3)][i*3+blade%3];
   assert.ok(Math.abs(root.y-bubble.renderedSupportAtLocal(root.x,root.z).y)<1e-5);
  }
 }
 const before=cover.mesh.instanceMatrix.array.slice();
 bubble.surfaceGeneration++;
 assert.equal(cover.update(0,0),true,'une surface reconstruite invalide les appuis même à l’arrêt');
 assert.deepEqual(cover.mesh.instanceMatrix.array,before);
 cover.dispose();g.dispose();
});
test('les sols agricoles conservent leurs bosses procédurales',()=>{
 for(const kind of ['grass','farmland']) assert.equal(defaultTheme.surfaces[kind].grainAmplitudeM,1.4);
 for(const kind of ['settled','pavement']) assert.equal(defaultTheme.surfaces[kind].grainAmplitudeM,0,`${kind} : le sol du bâti reste plan`);
 assert.ok(defaultTheme.surfaces.heath.grainAmplitudeM>0,'la lande garde son modelé');
});
