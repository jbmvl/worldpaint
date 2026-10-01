/* Description des arbres isolés : les familles de mobilier gardent la décision
 * de placement ; les dimensions et variantes viennent du thème. Le compositeur
 * transmet ces descriptions au rendu commun des arbres et du sous-bois.
 */
import { randomAt } from './furniturePlacement.js';

export function plantedTree(item, p, trees) {
  const look = trees.plantations[item];
  if (!look) return null;
  const draw = salt => randomAt(p.x, p.z, salt);
  const variant = look.variants[Math.floor(draw(1201) * look.variants.length)];
  const shade = .88 + draw(1213) * .24;
  return { x: p.x, y: p.y, z: p.z, variant,
    height: look.height * p.scale * (.9 + draw(1207) * .2),
    aspect: look.aspect * (.9 + draw(1211) * .2),
    rotation: draw(1217) * Math.PI * 2,
    color: [shade, shade, shade] };
}
