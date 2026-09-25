/* Comparaison numérique GPU : interpolation directe et atlas préparé doivent
 * produire les mêmes appuis, même après changement de relief ou de matière. */
import * as THREE from 'three';
import { PlantSupportAtlas, PLANT_SUPPORT_GLSL } from '../../src/terrain/plantSupportAtlas.js';
import { TERRAIN_GRAIN_GLSL } from '../../src/terrain/terrainGrainShader.js';
import { SURFACE_KINDS } from '../../src/terrain/groundClassMap.js';

const renderer = new THREE.WebGLRenderer();
renderer.setSize(16, 1);
const uniform = value => ({ value });
const uniforms = {
  uGrainCellM: uniform(6), uGrainAmplitudeM: uniform(1.4), uGrainFadeM: uniform(new THREE.Vector2(40, 90)),
  uSurfaceMap: uniform(null), uSurfaceOrigin: uniform(new THREE.Vector2()), uSurfaceSize: uniform(100),
  uSurfaceEnabled: uniform(0), uUnclassified: uniform(1),
  uSurfaceGrainCell: uniform(SURFACE_KINDS.map(() => 6)),
  uSurfaceGrainAmplitude: uniform(SURFACE_KINDS.map(() => 1.4)),
  uSlopeRange: uniform(new THREE.Vector2(.2, .8)), uRockGrain: uniform(new THREE.Vector2(3, 2)),
};
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,1,0, 10,2,0, 0,3,10, 10,5,10], 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,1,0, -.2,.97,0, 0,.97,-.2, -.2,.94,-.2], 3));
geometry.setAttribute('roadMask', new THREE.Float32BufferAttribute([0,.4,.8,1], 1));
const tile = { key: 'sol', geometry, segments: 1, size: 10 };
const atlas = new PlantSupportAtlas(THREE, uniforms);
const matrix = new THREE.Matrix4();
const scene = new THREE.Scene(), camera = new THREE.Camera();
camera.position.set(0, 20, 0);
const material = new THREE.ShaderMaterial({
  uniforms: { ...atlas.uniforms, uTestMatrix: uniform(matrix) },
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform mat4 uTestMatrix;
    #define modelMatrix uTestMatrix
    ${TERRAIN_GRAIN_GLSL}
    ${PLANT_SUPPORT_GLSL}
    void main() {
      float x = (gl_FragCoord.x - .5) / 15.0 * 9.8 + .1;
      vec3 point, normal;
      bool found = plantSupport(vec2(x, 3.3), point, normal);
      gl_FragColor = vec4(point, found ? 1.0 : 0.0);
    }`,
  depthTest: false, depthWrite: false,
});
const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
plane.frustumCulled = false;
scene.add(plane);
const target = new THREE.WebGLRenderTarget(16, 1, { type: THREE.FloatType, depthBuffer: false });
const sample = () => {
  renderer.setRenderTarget(target); renderer.render(scene, camera);
  const values = new Float32Array(64);
  renderer.readRenderTargetPixels(target, 0, 0, 16, 1, values);
  renderer.setRenderTarget(null);
  return values;
};
try {
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Cibles flottantes indisponibles : comparaison GPU non exécutée');
  let maxError = 0;
  for (let revision = 0; revision < 3; revision++) {
    geometry.attributes.position.array[1] += .25;
    uniforms.uSurfaceGrainAmplitude.value[0] += .3;
    if (revision === 2) matrix.makeTranslation(2, 4, -3);
    atlas.sync([tile], revision);
    atlas.prepare(renderer, matrix);
    if (atlas.uniforms.uPlantBaked.value !== 1) throw new Error('Atlas non préparé');
    for (const y of [20, 65, 110]) {
      camera.position.y = y;
      const baked = sample();
      atlas.uniforms.uPlantBaked.value = 0;
      const direct = sample();
      atlas.uniforms.uPlantBaked.value = 1;
      for (let i = 0; i < baked.length; i++) {
        if (!Number.isFinite(baked[i]) || !Number.isFinite(direct[i])) throw new Error('Appui non fini');
        maxError = Math.max(maxError, Math.abs(baked[i] - direct[i]));
        if (i % 4 === 3 && baked[i] !== 1) throw new Error('Triangle non trouvé');
      }
    }
  }
  if (maxError > 1e-5) throw new Error(`Écart GPU ${maxError}`);
  const result = { comparaisons: 144, ecartMax: maxError };
  console.log('[appuis GPU]', JSON.stringify(result));
  document.querySelector('#result').textContent = JSON.stringify(result);
} catch (error) {
  document.querySelector('#result').textContent = error.message;
  console.error(error);
} finally {
  atlas.dispose(); target.dispose(); geometry.dispose(); plane.geometry.dispose(); material.dispose(); renderer.dispose();
}
