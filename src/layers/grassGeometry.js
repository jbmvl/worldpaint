/* Neuf brins fins répartis sur toute la maille, pas autour d'un pied commun.
 * Trois triangles par brin dessinent une lame courbée. La couleur est uniforme
 * sur sa hauteur ; le sol porte la masse verte au-delà de la portée du tapis.
 */
export const GRASS_BLADES_PER_PATCH = 9;
export function createGrassBlade(THREE, colors, width = .08, curve = .24) {
  const geometry = new THREE.BufferGeometry();
  const positions = [], normals = [], tint = [], indices = [], blades = [];
  const roots = [], vertexRoots = [];
  for (let i = 0; i < GRASS_BLADES_PER_PATCH; i++) {
    const x = ((i % 3) + .3 + (i * 7 % 11) / 11 * .4) / 3 - .5;
    const z = (Math.floor(i / 3) + .3 + (i * 5 % 13) / 13 * .4) / 3 - .5;
    roots.push([x,z]);
    const angle = i * 2.399963;
    const c = Math.cos(angle), s = Math.sin(angle);
    const h = .8 + (i * 7 % 9) * .025;
    const bend = curve * (.7 + (i % 3) * .15);
    const vertices = [[-width/2,0,0],[width/2,0,0],[-width*.3,h*.58,bend*.3],[width*.3,h*.58,bend*.3],[width*.1,h,bend]];
    const start = positions.length / 3;
    for (const [px,py,pz] of vertices) {
      positions.push(x+px*c+pz*s,py,z-px*s+pz*c);
      normals.push(0,1,0);
      blades.push(i);
      vertexRoots.push(x,z);
      tint.push(...(colors.palette?.[i % colors.palette.length] ?? colors.root));
    }
    indices.push(start,start+1,start+3,start,start+3,start+2,start+2,start+3,start+4);
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(tint,3));
  geometry.setAttribute('aBladeRoot',new THREE.Float32BufferAttribute(vertexRoots,2));
  geometry.setAttribute('aBlade',new THREE.Float32BufferAttribute(blades,1));
  geometry.userData.roots = roots;
  geometry.setIndex(indices);
  return geometry;
}
