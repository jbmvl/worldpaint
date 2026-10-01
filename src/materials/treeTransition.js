/* Une relève opaque, au même seuil pour les deux représentations et leurs
 * ombres. Le seuil spatial répartit les bascules sans perforer les houppes.
 * Le plan ne cède sa place que si le budget lui attribue un volume.
 */
export const TREE_NEAR_ATTRIBUTE = 'aTreeNear';
export const TREE_NEAR_FROM = 240;
export const TREE_NEAR_TO = 380;

export function installTreeTransition(material, THREE, { volume = false, observer = { value: new THREE.Vector2() } } = {}) {
  material.userData.treeObserver = observer;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    previous?.(shader);
    shader.uniforms.uTreeObserver = observer;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform vec2 uTreeObserver;
      ${volume ? '' : 'attribute float aTreeNear;'}
      varying float vTreeVisible;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 treeAnchor = instanceMatrix[3].xz;
      vec2 treeCell = floor(treeAnchor * 4.0);
      float treeDraw = fract(sin(dot(treeCell, vec2(12.9898, 78.233))) * 43758.5453);
      float treeThreshold = mix(${TREE_NEAR_FROM.toFixed(1)}, ${TREE_NEAR_TO.toFixed(1)}, treeDraw);
      float treeFar = step(treeThreshold, distance(treeAnchor, uTreeObserver));
      vTreeVisible = ${volume ? '1.0 - treeFar' : 'aTreeNear > 0.5 ? treeFar : 1.0'};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vTreeVisible;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (vTreeVisible < 0.5) discard;`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}-tree-solid-${volume}-v1`;
}
