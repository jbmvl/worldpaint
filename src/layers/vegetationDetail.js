/* Le détail suit le point le plus proche du bloc, pas son centre : un arbre
 * proche garde son volume même dans un bloc qui s'étend au loin. Les marges
 * empêchent les allers-retours de maillage au voisinage d'un seuil. Les
 * seuils tiennent dans le rayon des objets (375 m dans Dot Racing) : au-delà
 * de 150 m, une houppe fait quelques dizaines de pixels de haut et ses
 * facettes ne se comptent plus — ombre portée comprise.
 */
export const VEGETATION_DETAIL_M = [150, 280];
export const VEGETATION_DETAIL_MARGIN_M = 20;

export function vegetationDetail(distance, previous = 0) {
  let level = previous;
  while (level < 2 && distance > VEGETATION_DETAIL_M[level] + VEGETATION_DETAIL_MARGIN_M) level++;
  while (level > 0 && distance < VEGETATION_DETAIL_M[level - 1] - VEGETATION_DETAIL_MARGIN_M) level--;
  return level;
}
