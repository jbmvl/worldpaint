/* Un brin facetté, pas une image de touffe. La trame répartit les pieds sur
 * toute la maille, chacun avec son propre décalage déterministe. */
export function createGrassBlade(THREE, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5,0,0, .5,0,0, .18,.55,.06, 0,1,.16],3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0,0,1,0],3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([...colors.root,...colors.root,...colors.tip,...colors.tip],3));
  geometry.setIndex([0,1,2,0,2,3]);
  return geometry;
}
