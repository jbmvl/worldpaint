/* Transitions de couverture continues : la caméra ne modifie jamais le semis.
 * Le bruit est attaché à la surface, pour éviter un motif qui nage à l'écran.
 */
export const COVER_ATTRIBUTE = 'aCoverBand';
export function installCoverTransition(material, THREE) {
  const observer = { value: new THREE.Vector2() };
  material.userData.coverObserver = observer;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    previous?.(shader);
    shader.uniforms.uCoverObserver = observer;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aCoverBand;
      uniform vec2 uCoverObserver;
      varying float vCoverFade;
      varying vec3 vCoverPoint;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 coverAnchor = instanceMatrix[3].xz;
      float coverDistance = distance(coverAnchor, uCoverObserver);
      float coverIn = aCoverBand.z > 0.0 ? clamp((coverDistance-aCoverBand.x)/aCoverBand.z,0.0,1.0) : 1.0;
      float coverOut = aCoverBand.w > 0.0 ? clamp((aCoverBand.y-coverDistance)/aCoverBand.w,0.0,1.0) : 1.0;
      vCoverFade = min(coverIn, coverOut);
      vCoverPoint = (instanceMatrix * vec4(position,1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vCoverFade;
      varying vec3 vCoverPoint;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      vec3 coverCell = floor(vCoverPoint * 24.0);
      float coverThreshold = fract(sin(dot(coverCell,vec3(12.9898,78.233,37.719)))*43758.5453);
      if (vCoverFade <= coverThreshold) discard;`);
  };
  const cacheKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${cacheKey()}-continuous-cover-v1`;
}

export function paddedCoverBands(bands, travel) {
  return bands.map(b => ({ ...b, from: Math.max(0, b.from-travel-b.cell*2), to: b.to+travel+b.cell*2 }));
}
