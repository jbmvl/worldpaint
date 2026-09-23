/* Chaque brin garde son appui exact, même si sa maille croise une arête du
 * terrain. La correction vient après le vent : elle ne doit pas faire bouger
 * un pied ni modifier l'amplitude de flexion calculée depuis sa hauteur. */
export function installGrassRoots(material) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aBlade;
      attribute vec3 aRootLift0;
      attribute vec3 aRootLift1;
      attribute vec3 aRootLift2;`)
      .replace('#include <project_vertex>', `
      vec3 rootBank = aBlade < 2.5 ? aRootLift0 : (aBlade < 5.5 ? aRootLift1 : aRootLift2);
      float rootSlot = mod(aBlade, 3.0);
      float rootLift = rootSlot < .5 ? rootBank.x : (rootSlot < 1.5 ? rootBank.y : rootBank.z);
      transformed.y += rootLift / max(length(instanceMatrix[1].xyz), 0.0001);
      #include <project_vertex>`);
  };
  material.customProgramCacheKey = () => `${key()}-individual-roots-v1`;
}
