/*
 * canopyRise — le dessus d'un couvert vu de loin. Au-delà d'une rampe de
 * distance, le sol d'une matière couverte monte vers ses feuillages, bosselé
 * en chou-fleur (bruit en valeur absolue, deux tailles de touffes) : de loin,
 * un bois se lit comme une masse moutonneuse, pas comme des arbres piqués sur
 * un sol.
 *
 * Le sol et les arbres lisent la même hauteur, au même endroit : un arbre de
 * cette matière y est planté de `sinkM` sous la surface, si bien que sa houppe
 * en émerge partout de la même façon. Sans quoi le couvert enterrait les
 * arbres vus de face et les laissait voir en crête — deux bois à la même
 * distance ne se ressemblaient pas.
 *
 * La hauteur dépend de la caméra : elle n'existe que dans les shaders, jamais
 * dans une altitude lue par le CPU. Nulle en deçà de la rampe, donc hors de la
 * boîte d'ombre.
 */

import { SURFACE_KINDS, SURFACE_ID_STEP, CLASS_PIXELS } from './groundClassMap.js';
import { LOW_POLY_GRAIN_GLSL } from './lowPolyGrain.js';

/** Les matières qui déclarent un relèvement (`canopy.riseM`). */
export function canopyRiseKinds(surfaces) {
  return SURFACE_KINDS.filter((kind) => surfaces[kind]?.canopy?.riseM > 0);
}

/**
 * Uniformes du relèvement. La carte des matières est **partagée** avec le sol
 * (mêmes objets `{ value }`), sous des noms propres : le GLSL ci-dessous se
 * colle tel quel dans un shader qui ne déclare pas ceux du terrain.
 *
 * @param {Object} THREE
 * @param {Object} surfaces `SURFACE_LOOK` du thème.
 * @param {Object} terrain Uniformes du sol (`uSurfaceMap`, `uSurfaceOrigin`,
 *        `uSurfaceSize`, `uSurfaceEnabled`, `uUnclassified`).
 */
export function canopyRiseUniforms(THREE, surfaces, terrain) {
  const kinds = canopyRiseKinds(surfaces);
  const wood = surfaces.wood?.canopy;
  return {
    uCanopyMap: terrain.uSurfaceMap,
    uCanopyMapOrigin: terrain.uSurfaceOrigin,
    uCanopyMapSize: terrain.uSurfaceSize,
    uCanopyMapOn: terrain.uSurfaceEnabled,
    uCanopyGap: terrain.uUnclassified,
    // Par matière : (hauteur, bosse, cellule de la bosse) en mètres, et dans w
    // l'enfoncement des arbres.
    uCanopyRise: {
      value: (kinds.length ? kinds : ['wood']).map((kind) => {
        const canopy = surfaces[kind]?.canopy;
        return new THREE.Vector4(canopy?.riseM ?? 0, canopy?.lumpM ?? 0, canopy?.lumpCellM ?? 1, canopy?.sinkM ?? 0);
      }),
    },
    uCanopyRiseRange: { value: new THREE.Vector2(wood?.riseNearM ?? 1e6, wood?.riseFarM ?? 1e6 + 1) },
  };
}

/**
 * GLSL du relèvement, pour un shader de sommet qui a déjà `cameraPosition`.
 * `canopyRiseAt(scene)` rend (hauteur sous la bosse, bosse, cellule,
 * enfoncement), déjà multipliés par la rampe sauf la cellule ;
 * `canopyLumps(p, cell)` la part de bosse en un point, de 0 à 1.
 * `withGrain` : faux si le shader colle déjà `LOW_POLY_GRAIN_GLSL`.
 */
export function canopyRiseGLSL(surfaces, { withGrain = true } = {}) {
  const kinds = canopyRiseKinds(surfaces);
  return `
${withGrain ? LOW_POLY_GRAIN_GLSL : ''}
uniform sampler2D uCanopyMap;
uniform vec2 uCanopyMapOrigin;
uniform float uCanopyMapSize;
uniform float uCanopyMapOn;
uniform float uCanopyGap;
uniform vec4 uCanopyRise[${Math.max(1, kinds.length)}];
uniform vec2 uCanopyRiseRange;

vec4 canopyRiseAt(vec3 scene) {
  float id = uCanopyGap;
  if (uCanopyMapOn > 0.5) {
    vec2 uv = (scene.xz - uCanopyMapOrigin) / uCanopyMapSize;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      vec2 texel = floor(uv * ${CLASS_PIXELS}.0);
      float raw = floor(textureLod(uCanopyMap, (texel + 0.5) / ${CLASS_PIXELS}.0, 0.0).r * 255.0 / ${SURFACE_ID_STEP}.0 + 0.5);
      id = raw < 0.5 ? uCanopyGap : raw;
    }
  }
  vec4 rise = vec4(0.0, 0.0, 1.0, 0.0);
  ${kinds.map((kind, k) => `if (id == ${SURFACE_KINDS.indexOf(kind) + 1}.0) rise = uCanopyRise[${k}];`).join('\n  ')}
  float fade = smoothstep(uCanopyRiseRange.x, uCanopyRiseRange.y, distance(scene, cameraPosition));
  return vec4(rise.xy * fade, rise.z, rise.w * fade);
}

// Deux tailles de touffes ; la valeur absolue du bruit fait des dômes séparés
// par des plis, ce qui se lit comme des houppes et non comme une houle.
float canopyLumps(vec2 p, float cell) {
  float big = abs(lowPolyNoise(p / cell));
  float small = abs(lowPolyNoise(p / (cell * 0.42) + 31.7));
  return clamp(1.6 * (0.7 * big + 0.3 * small), 0.0, 1.0);
}
`;
}

/** Clé de programme : les matières relevées sont écrites dans le GLSL. */
export function canopyRiseKey(surfaces) {
  return canopyRiseKinds(surfaces).join('-') || 'none';
}

/**
 * Plante les instances d'un matériau dans le couvert relevé : chacune monte de
 * la hauteur du couvert à son pied, moins `sinkM`. Appliqué juste avant la
 * projection, donc après le vent, qui lit la hauteur d'origine.
 *
 * @param {Object} material Matériau instancié (arbres).
 * @param {{uniforms: Object, surfaces: Object}} canopy `TerrainMaterials.canopyRise`.
 */
export function installCanopyRide(material, canopy) {
  if (!canopy || canopyRiseKinds(canopy.surfaces).length === 0) return;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, canopy.uniforms);
    const withGrain = !shader.vertexShader.includes('float lowPolyNoise(');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${canopyRiseGLSL(canopy.surfaces, { withGrain })}`)
      .replace('#include <project_vertex>', `#ifdef USE_INSTANCING
      {
        vec3 canopyAnchor = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        vec4 canopy = canopyRiseAt(canopyAnchor);
        float ride = max(0.0, canopy.x + canopy.y * canopyLumps(instanceMatrix[3].xz, canopy.z) - canopy.w);
        transformed.y += ride / length(instanceMatrix[1].xyz);
      }
      #endif
      #include <project_vertex>`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}-canopy-ride-${canopyRiseKey(canopy.surfaces)}`;
}
