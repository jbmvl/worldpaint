/* Ligne de mire dégagée : ce qui se trouve entre la caméra et le sujet qu'elle
 * suit s'efface par tramage, sans rien déplacer. Le tramage est en espace
 * écran : il reste fixe quand la caméra bouge, là où un grain du monde
 * scintillerait. Les ombres ne passent pas par ici — un arbre effacé garde la
 * sienne.
 */
export const SIGHTLINE_FROM_RADIUS_M = 3.5;
export const SIGHTLINE_TO_RADIUS_M = 1.2;
/** Part du rayon entièrement effacée ; le reste est le fondu. */
const SIGHTLINE_CORE = 0.55;

export function createSightline(THREE) {
  return {
    from: { value: new THREE.Vector3() },
    to: { value: new THREE.Vector3() },
    // x, y : rayons côté caméra et côté sujet ; z : 1 si la ligne est active.
    radius: { value: new THREE.Vector3(SIGHTLINE_FROM_RADIUS_M, SIGHTLINE_TO_RADIUS_M, 0) },
  };
}

/**
 * @param {Object|null} sightline Voir `createSightline`.
 * @param {{x:number,y:number,z:number}|null} from Caméra, `null` pour désactiver.
 * @param {{x:number,y:number,z:number}|null} to Sujet.
 */
export function setSightline(sightline, from, to, { fromRadius = SIGHTLINE_FROM_RADIUS_M, toRadius = SIGHTLINE_TO_RADIUS_M } = {}) {
  if (!sightline) return;
  if (!from || !to) {
    sightline.radius.value.z = 0;
    return;
  }
  sightline.from.value.set(from.x, from.y, from.z);
  sightline.to.value.set(to.x, to.y, to.z);
  sightline.radius.value.set(fromRadius, toRadius, 1);
}

export function installSightlineClearing(material, sightline) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    previous?.(shader);
    shader.uniforms.uSightFrom = sightline.from;
    shader.uniforms.uSightTo = sightline.to;
    shader.uniforms.uSightRadius = sightline.radius;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vSightPoint;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vSightPoint = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vSightPoint = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uSightFrom;
      uniform vec3 uSightTo;
      uniform vec3 uSightRadius;
      varying vec3 vSightPoint;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (uSightRadius.z > 0.5) {
        vec3 sightAxis = uSightTo - uSightFrom;
        float sightAlong = clamp(dot(vSightPoint - uSightFrom, sightAxis) / max(dot(sightAxis, sightAxis), 1e-4), 0.0, 1.0);
        float sightGap = distance(vSightPoint, uSightFrom + sightAxis * sightAlong);
        float sightReach = mix(uSightRadius.x, uSightRadius.y, sightAlong);
        float sightKeep = smoothstep(sightReach * ${SIGHTLINE_CORE.toFixed(2)}, sightReach, sightGap);
        float sightNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (sightKeep <= sightNoise) discard;
      }`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}-sightline-v1`;
}
