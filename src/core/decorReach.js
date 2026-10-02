/*
 * decorReach — les distances qui règlent l'apparition du décor.
 *
 * Le décor se refait d'un bloc, toutes couches ensemble, à chaque pas de
 * `DECOR_STEP_M` de l'observateur (`worldComposer`). Ce qui est peint à moins
 * de `NEAR_M` ne doit pas changer à la relève : chaque couche construit donc
 * son détail sur au moins `DECOR_STABLE_RADIUS_M` autour du point de
 * reconstruction, et un plafond ne retire jamais rien en deçà. La même donnée
 * reconstruite deux fois donnant le même résultat, la relève y est invisible.
 */

/** Zone proche : ce qui y est peint ne se repeint pas. */
export const NEAR_M = 500;
/** Déplacement de l'observateur avant de refaire le décor. */
export const DECOR_STEP_M = 250;
/** Portée minimale du détail de chaque couche (marge de 50 m pour l'observateur qui avance pendant la relève). */
export const DECOR_STABLE_RADIUS_M = NEAR_M + DECOR_STEP_M + 50;

/** Marge du terrain, des tuiles vectorielles et du sol autour de la portée : facteur, puis mètres. */
export const REACH_MARGIN = 1.25;
export const REACH_MARGIN_M = 60;

/**
 * Rayon d'une couche, plafonné à la portée du décor (`createWorld({ reach })`).
 * Sans portée, ou face à une bulle qui n'en déclare pas, le rayon propre de
 * la couche reste intact : la portée ne rallonge jamais rien.
 *
 * @param {number} radius Rayon propre de la couche, en mètres.
 * @param {{reachMeters?: number}|null} [bubble]
 */
export function reachedRadius(radius, bubble) {
  const reach = bubble?.reachMeters;
  return Number.isFinite(reach) && reach > 0 ? Math.min(radius, reach) : radius;
}
