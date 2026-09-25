/* Les plantes lisent les sommets des tuiles proches dans un atlas partagé.
 * Deux texels par sommet : position/masque routier, normale. Aucun relevé GPU
 * vers le CPU ni bruit recalculé au pied d’un brin. L’atlas ne se recharge que
 * lorsque les tuiles retenues ou leur génération changent. Une passe GPU
 * prépare la déformation de chaque sommet une fois ; seul son fondu de
 * distance est recalculé par les plantes. Sans cible flottante, calcul direct. */
import { TERRAIN_GRAIN_GLSL } from './terrainGrainShader.js';
const LIMIT = 16, WIDTH = 1024;
export class PlantSupportAtlas {
  constructor(THREE, grainUniforms) {
    this.THREE = THREE;
    this.uniforms = {
      ...grainUniforms,
      uPlantTerrain: { value: null },
      uPlantDisplacement: { value: null },
      uPlantBaked: { value: 0 },
      uPlantTileCount: { value: 0 },
      uPlantTiles: { value: Array.from({length:LIMIT},()=>new THREE.Vector4()) },
      uPlantOffsets: { value: Array(LIMIT).fill(0) },
    };
    this.texture = null;
  }
  sync(tiles, generation) {
    this.complete = tiles.length <= LIMIT;
    const selected = tiles.slice(0,LIMIT);
    const signature = selected.map(t=>t.key).join('|');
    if (signature===this.signature && generation===this.generation) return;
    this.signature=signature; this.generation=generation;
    const count=selected.reduce((n,t)=>n+t.geometry.attributes.position.count,0);
    const data=new Float32Array(WIDTH*Math.max(1,Math.ceil(count*2/WIDTH))*4);
    let offset=0;
    selected.forEach((tile,i)=>{
      const p=tile.geometry.attributes.position.array;
      const n=tile.geometry.attributes.normal.array;
      const mask=tile.geometry.attributes.roadMask?.array;
      this.uniforms.uPlantTiles.value[i].set(p[0],p[2],tile.size/tile.segments,tile.segments);
      this.uniforms.uPlantOffsets.value[i]=offset;
      for(let v=0;v<p.length/3;v++) {
        data.set([p[v*3],p[v*3+1],p[v*3+2],mask?.[v]??0,n[v*3],n[v*3+1],n[v*3+2],0],offset*4);
        offset+=2;
      }
    });
    this.uniforms.uPlantBaked.value = 0;
    this.texture?.dispose();
    this.texture=new this.THREE.DataTexture(data,WIDTH,data.length/(WIDTH*4),this.THREE.RGBAFormat,this.THREE.FloatType);
    this.texture.needsUpdate=true;
    this.uniforms.uPlantTerrain.value=this.texture;
    this.uniforms.uPlantTileCount.value=selected.length;
  }
  coversPatch(x, z, radius) {
    if (!this.complete) return false;
    for (let i = 0; i < this.uniforms.uPlantTileCount.value; i++) {
      const tile = this.uniforms.uPlantTiles.value[i];
      const size = tile.z * tile.w;
      if (x - radius >= tile.x && z - radius >= tile.y &&
        x + radius < tile.x + size && z + radius < tile.y + size) return true;
    }
    return false;
  }
  prepare(renderer, matrix) {
    if (!this.texture || this.disposed) return;
    const u = this.uniforms;
    if (!renderer.extensions.has('EXT_color_buffer_float')) { u.uPlantBaked.value = 0; return; }
    const values = [this.texture.version, u.uSurfaceMap.value?.version,
      u.uSurfaceOrigin.value.x, u.uSurfaceOrigin.value.y, u.uSurfaceSize.value,
      u.uSurfaceEnabled.value, u.uUnclassified.value, u.uGrainCellM.value,
      u.uGrainAmplitudeM.value, ...u.uSlopeRange.value, ...u.uRockGrain.value,
      ...u.uSurfaceGrainCell.value, ...u.uSurfaceGrainAmplitude.value, ...matrix.elements];
    if (renderer === this.bakedRenderer && this.texture === this.bakedTexture && u.uSurfaceMap.value === this.bakedSurface &&
      this.bakedValues && values.every((v, i) => v === this.bakedValues[i])) { u.uPlantBaked.value = 1; return; }
    const T = this.THREE;
    if (!this.bakeScene) {
      this.bakeScene = new T.Scene();
      this.bakeCamera = new T.Camera();
      this.bakeMaterial = new T.ShaderMaterial({
        uniforms: { ...u, uPlantModelMatrix: { value: new T.Matrix4() } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform mat4 uPlantModelMatrix;
          #define modelMatrix uPlantModelMatrix
          uniform sampler2D uPlantTerrain;
          ${TERRAIN_GRAIN_GLSL}
          void main() {
            int vertex = int(gl_FragCoord.y) * ${WIDTH} + int(gl_FragCoord.x);
            int index = vertex * 2;
            vec4 p = texelFetch(uPlantTerrain, ivec2(index % ${WIDTH}, index / ${WIDTH}), 0);
            vec3 n = texelFetch(uPlantTerrain, ivec2((index + 1) % ${WIDTH}, (index + 1) / ${WIDTH}), 0).xyz;
            float steep, grain;
            gl_FragColor = vec4(terrainDisplacement(p.xyz, n, p.w, steep, grain), 0.0);
          }`,
        depthTest: false, depthWrite: false, toneMapped: false,
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3));
      this.bakeMesh = new T.Mesh(geometry, this.bakeMaterial);
      this.bakeMesh.frustumCulled = false;
      this.bakeScene.add(this.bakeMesh);
    }
    const height = Math.ceil(this.texture.image.height / 2);
    if (!this.bakeTarget) this.bakeTarget = new T.WebGLRenderTarget(WIDTH, height, {
      type: T.FloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    else this.bakeTarget.setSize(WIDTH, height);
    this.bakeMaterial.uniforms.uPlantModelMatrix.value.copy(matrix);
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const autoReset = renderer.info.autoReset, xr = renderer.xr.enabled;
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
    try {
      renderer.info.autoReset = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(this.bakeTarget);
      renderer.render(this.bakeScene, this.bakeCamera);
      u.uPlantDisplacement.value = this.bakeTarget.texture;
      u.uPlantBaked.value = 1;
      this.bakedRenderer = renderer;
      this.bakedTexture = this.texture;
      this.bakedSurface = u.uSurfaceMap.value;
      this.bakedValues = values;
    } finally {
      renderer.setRenderTarget(target, face, level);
      renderer.info.autoReset = autoReset;
      renderer.xr.enabled = xr;
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeds;
    }
  }
  install(material, { roots = false } = {}) {
    const before=material.onBeforeCompile, key=material.customProgramCacheKey.bind(material);
    const onRender = material.onBeforeRender;
    const atlas = this;
    material.onBeforeRender = function(renderer, scene, camera, geometry, object, group) {
      onRender.call(this, renderer, scene, camera, geometry, object, group);
      atlas.prepare(renderer, object.matrixWorld);
    };
    material.onBeforeCompile=shader=>{
      before(shader); Object.assign(shader.uniforms,this.uniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        ${roots ? 'attribute vec2 aBladeRoot;' : ''}
        ${TERRAIN_GRAIN_GLSL}
        ${PLANT_SUPPORT_GLSL}`)
        .replace('#include <project_vertex>',`
        {
          vec3 localRoot=vec3(${roots?'aBladeRoot.x, 0.0, aBladeRoot.y':'0.0'});
          vec3 baseRoot=(instanceMatrix*vec4(localRoot,1.0)).xyz;
          vec3 targetRoot; vec3 supportNormal;
          if (plantSupport(baseRoot.xz,targetRoot,supportNormal)) {
            ${roots ? 'baseRoot.y += rootLift;' : ''}
            transformed += inverse(mat3(instanceMatrix)) * (targetRoot-baseRoot);
          }
        }
        #include <project_vertex>`);
    };
    material.customProgramCacheKey=()=>`${key()}-terrain-support-${roots}`;
  }
  dispose() {
    this.disposed = true;
    this.texture?.dispose();
    this.bakeTarget?.dispose();
    this.bakeMaterial?.dispose();
    this.bakeMesh?.geometry.dispose();
  }
}
export const PLANT_SUPPORT_GLSL = `
uniform sampler2D uPlantTerrain;
uniform sampler2D uPlantDisplacement;
uniform float uPlantBaked;
uniform int uPlantTileCount;
uniform vec4 uPlantTiles[${LIMIT}];
uniform float uPlantOffsets[${LIMIT}];
vec4 plantTexel(int i) { return texelFetch(uPlantTerrain,ivec2(i%${WIDTH},i/${WIDTH}),0); }
vec3 plantVertex(int i) {
  vec4 p=plantTexel(i);
  if (uPlantBaked > 0.5) {
    int vertex = i / 2;
    vec3 displacement = texelFetch(uPlantDisplacement, ivec2(vertex % ${WIDTH}, vertex / ${WIDTH}), 0).xyz;
    float fade = lowPolyFade((modelMatrix * vec4(p.xyz, 1.0)).xyz, cameraPosition, uGrainFadeM.x, uGrainFadeM.y);
    return p.xyz + displacement * fade;
  }
  vec3 n=plantTexel(i+1).xyz;
  float steep,grain;
  return terrainDisplaced(p.xyz,n,p.w,steep,grain);
}
bool plantSupport(vec2 root, out vec3 point, out vec3 faceNormal) {
  for(int tile=0;tile<${LIMIT};tile++) {
    if(tile>=uPlantTileCount) break;
    vec4 info=uPlantTiles[tile];
    vec2 uv=(root-info.xy)/info.z;
    if(any(lessThan(uv,vec2(0.0))) || any(greaterThanEqual(uv,vec2(info.w)))) continue;
    ivec2 cell=ivec2(floor(uv)); vec2 f=fract(uv);
    int row=int(info.w)+1;
    int a=int(uPlantOffsets[tile])+2*(cell.y*row+cell.x);
    vec3 b=plantVertex(a+2), c=plantVertex(a+row*2);
    if(f.x+f.y<=1.0) {
      vec3 p=plantVertex(a);
      point=p*(1.0-f.x-f.y)+b*f.x+c*f.y;
      faceNormal=normalize(cross(c-p,b-p));
    } else {
      vec3 d=plantVertex(a+row*2+2);
      point=d*(f.x+f.y-1.0)+b*(1.0-f.y)+c*(1.0-f.x);
      faceNormal=normalize(cross(c-b,d-b));
    }
    return true;
  }
  return false;
}
`;
