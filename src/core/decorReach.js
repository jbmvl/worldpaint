/*
 * decorReach — les distances qui règlent l'apparition du décor.
 *
 * Le décor se refait d'un bloc, toutes couches ensemble, à chaque pas de
 * `DECOR_STEP_M` de l'observateur (`worldComposer`). Ce qui est peint à moins
 * de `NEAR_M` ne doit pas changer à la relève : chaque couche construit donc
 * son détail sur au moins `DECOR_STABLE_RADIUS_M` autour du point de
 * reconstruction, et un plafond ne retire jamais rien en deçà. La même donnée
 * reconstruite deux fois donnant le même résultat, la relève y est invisible.
 *
 * En ville, le détail se resserre : son rayon s'arrête là où le cumul des murs
 * bâtis autour du point de reconstruction atteint `DETAIL_WALL_BUDGET_M`
 * (`budgetedRadius`), et en rase campagne il garde toute sa portée. Le pas de
 * relève et la zone stable se resserrent avec lui, dans les mêmes proportions
 * (`decorStepFor`) : l'observateur ne s'approche jamais du bord du détail.
 */

/** Zone proche : ce qui y est peint ne se repeint pas. */
export const NEAR_M = 500;
/** Déplacement de l'observateur avant de refaire le décor. */
export const DECOR_STEP_M = 250;
/** Portée minimale du détail de chaque couche (marge de 50 m pour l'observateur qui avance pendant la relève). */
export const DECOR_STABLE_RADIUS_M = NEAR_M + DECOR_STEP_M + 50;

/** Marge de la zone stable pour l'observateur qui avance pendant la relève, en mètres. */
const RELIEF_MARGIN_M = DECOR_STABLE_RADIUS_M - NEAR_M - DECOR_STEP_M;

/**
 * Longueur de murs bâtis que le détail s'autorise autour de l'observateur, en
 * mètres : un centre-ville l'atteint en quelques centaines de mètres, un
 * village jamais.
 */
export const DETAIL_WALL_BUDGET_M = 60000;
/** Largeur des couronnes où les murs sont comptés, et pas du rayon qui en sort. */
export const DETAIL_RING_M = 50;
/** Rayon en deçà duquel le budget ne resserre plus le détail, si dense que soit le lieu. */
export const DETAIL_MIN_RADIUS_M = 300;

/**
 * Rayon du détail que le budget de murs autorise : le bord intérieur de la
 * couronne où le cumul le dépasse, jamais moins que `DETAIL_MIN_RADIUS_M`.
 *
 * @param {number[]} rings Longueur de murs par couronne de `DETAIL_RING_M`, de
 *        la plus proche à la plus lointaine (`wallLengthsByDistance`).
 * @param {number} [budget] `Infinity` ou zéro : aucun resserrement.
 * @returns {number} Rayon en mètres, `Infinity` si le budget n'est pas atteint.
 */
export function budgetedRadius(rings, budget = DETAIL_WALL_BUDGET_M) {
  if (!(budget > 0) || !Number.isFinite(budget)) return Infinity;
  let walls = 0;
  for (let i = 0; i < rings.length; i++) {
    walls += rings[i] || 0;
    if (walls > budget) return Math.max(DETAIL_MIN_RADIUS_M, i * DETAIL_RING_M);
  }
  return Infinity;
}

/**
 * Pas de relève d'un détail de rayon `radius` : celui qui garde entre le
 * rayon, la zone stable et le pas les proportions de `DECOR_STABLE_RADIUS_M`,
 * `NEAR_M` et `DECOR_STEP_M`. Jamais plus long que `DECOR_STEP_M`.
 */
export function decorStepFor(radius) {
  if (!(radius < DECOR_STABLE_RADIUS_M)) return DECOR_STEP_M;
  return Math.max(DETAIL_RING_M, (radius - RELIEF_MARGIN_M) * DECOR_STEP_M / (NEAR_M + DECOR_STEP_M));
}

/** Marge du terrain, des tuiles vectorielles et du sol autour de la portée : facteur, puis mètres. */
export const REACH_MARGIN = 1.25;
export const REACH_MARGIN_M = 60;

/**
 * Rayon d'une couche, plafonné à la portée du décor (`createWorld({ reach })`
 * ou `detail.radius`). Sans portée, ou face à une bulle qui n'en déclare pas,
 * le rayon propre de la couche reste intact : la portée ne rallonge jamais rien.
 *
 * @param {number} radius Rayon propre de la couche, en mètres.
 * @param {{reachMeters?: number, decorReachMeters?: number}|null} [bubble]
 */
export function reachedRadius(radius, bubble) {
  const reach = bubble?.decorReachMeters ?? bubble?.reachMeters;
  return Number.isFinite(reach) && reach > 0 ? Math.min(radius, reach) : radius;
}
