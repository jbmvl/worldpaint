/* Banc reproductible sans réseau géographique. Les lectures GPU comparent
 * l'éclairage à celui d'un Lambert témoin ; elles ne notent pas l'esthétique. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GroundCover } from '../src/layers/groundCover.js';
import { meshSupport } from '../src/terrain/meshSupport.js';
import { createFoliageMaterial } from '../src/materials/foliageMaterial.js';
import { defaultTheme } from '../src/themes/default.js';
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
const errors=[];
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].join('\n'));
function lightingCheck(wrongSpace = false) {
  const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,.4));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(2,3,4);scene.add(sun);
  const geometry=new THREE.PlaneGeometry(1,1);
  const colors=[];for(let i=0;i<geometry.attributes.normal.count;i++){geometry.attributes.normal.setXYZ(i,0,1,0);colors.push(.1,.3,.05);}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const reference=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  const foliage=createFoliageMaterial({THREE,map:null,wind:false,cacheKey:'grass-lab-lighting'});
  if (wrongSpace) {
    const compile=foliage.onBeforeCompile;
    foliage.onBeforeCompile=shader=>{
      compile(shader);
      shader.fragmentShader=shader.fragmentShader.replace('normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0))','vec3(0.0, 1.0, 0.0)');
    };
    foliage.customProgramCacheKey=()=> 'grass-lab-negative-control';
  }
  const left=new THREE.Mesh(geometry,reference),right=new THREE.Mesh(geometry,foliage);
  left.position.x=-.65;right.position.x=.65;scene.add(left,right);
  const camera=new THREE.OrthographicCamera(-2,2,1,-1,.1,20);
  const target=new THREE.WebGLRenderTarget(128,64),pixels=new Uint8Array(128*64*4);
  let maxDifference=0,empty=false;
  for(const elevation of [0,2,5]) {
    camera.position.set(0,elevation,4);camera.lookAt(0,0,0);
    renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,128,64,pixels);
    const a=(32*128+43)*4,b=(32*128+85)*4;
    empty ||= pixels[a]+pixels[a+1]+pixels[a+2]===0;
    for(let c=0;c<3;c++)maxDifference=Math.max(maxDifference,Math.abs(pixels[a+c]-pixels[b+c]));
  }
  renderer.setRenderTarget(null);target.dispose();geometry.dispose();reference.dispose();foliage.dispose();
  return {maxDifference,pass:!empty&&maxDifference<=2};
}
const lighting=lightingCheck();
const negativeControl=lightingCheck(true);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2e8');scene.fog=new THREE.Fog('#cfe2e8',65,140);
scene.add(new THREE.HemisphereLight('#e5f2ff','#738459',1.8));
const sun=new THREE.DirectionalLight('#fff5dc',2.2);sun.position.set(20,35,10);scene.add(sun);
const size=120,n=48,positions=[],indices=[];
for(let j=0;j<=n;j++)for(let i=0;i<=n;i++) {
 const x=i*size/n,z=j*size/n;
 positions.push(x,Math.sin(x*.16)*.8+Math.cos(z*.23)*.5+Math.max(0,x-65)*.15,z);
}
for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+1,c=a+n+1,d=c+1;indices.push(a,c,b,b,c,d);}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
const soil=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:new THREE.Color().setRGB(...defaultTheme.surfaces.grass.albedo)}));scene.add(soil);
const bubble={frame:{},verticalScale:1,surfaceGeneration:0,
 renderedSupportAtLocal:(x,z,out)=>meshSupport(geometry,n,0,0,size,x,z,out),
 surfaceElevationAtLocal:(x,z)=>meshSupport(geometry,n,0,0,size,x,z).y};
const groundClass={surfaceAt:()=> 'grass',sampleAt:(x,z)=>({grass:x>=0&&x<=size&&z>=0&&z<=size?1:0,wood:0,farmland:0,bare:0})};
const cover=new GroundCover({THREE,scene,bubble,groundClass});cover.update(60,60);
let rootError=0;const matrix=new THREE.Matrix4(),root=new THREE.Vector3();
for(let i=0;i<Math.min(1000,cover.mesh.count);i++){
 cover.mesh.getMatrixAt(i,matrix);
 cover.geometry.userData.roots.forEach(([x,z],blade)=>{
  root.set(x,0,z).applyMatrix4(matrix);root.y+=cover._rootOffsets[Math.floor(blade/3)][i*3+blade%3];
  rootError=Math.max(rootError,Math.abs(root.y-bubble.renderedSupportAtLocal(root.x,root.z).y));
 });
}
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,250);camera.position.set(60,3.5,69);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(60,.5,55);controls.maxPolarAngle=Math.PI*.49;controls.update();
let moving=false;document.querySelector('#walk').onclick=e=>{moving=!moving;e.target.textContent=moving?'Arrêter':'Avancer';};
document.querySelector('#sun').onclick=()=>{sun.position.x=-sun.position.x;};
document.querySelector('#grass').onchange=e=>{cover.mesh.visible=e.target.checked;for(const m of cover.flowers.meshes)m.visible=e.target.checked;};
const setWind=()=>cover.setWind({amplitude:+document.querySelector('#wind').value,speed:1,direction:[1,.45]});
document.querySelector('#wind').oninput=setWind;setWind();
let lastTime=performance.now(),reported=false;
renderer.setAnimationLoop(()=>{
 const now=performance.now(),dt=Math.min((now-lastTime)/1000,.1);lastTime=now;
 if(moving){const dz=-dt*8.33;camera.position.z+=dz;controls.target.z+=dz;if(camera.position.z<15){camera.position.z+=70;controls.target.z+=70;}}
 cover.advance(dt);cover.update(camera.position.x,camera.position.z);controls.update();renderer.render(scene,camera);
 if(!reported){
  document.querySelector('#checks').textContent=JSON.stringify({gpuErrors:errors,lighting:{maxChannelDifference:lighting.maxDifference,pass:lighting.pass && negativeControl.maxDifference>2,negativeControlDifference:negativeControl.maxDifference},rootErrorMetres:rootError,rootsPass:rootError<.0001,patches:cover.mesh.count,flowers:cover.flowers.meshes.reduce((n,m)=>n+m.count,0)},null,2);
  reported=true;
 }
});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
