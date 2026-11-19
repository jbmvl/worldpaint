/*
 * standThinning — l'éclaircie qui tient le budget d'arbres d'une tuile sans
 * marche à sa limite.
 *
 * Chaque tuile a sa part gardée : le budget rapporté au semis qu'elle attend.
 * En un point, la part retenue est la plus faible de celles des tuiles
 * voisines, chacune relevée de la distance qui l'en sépare (`rampM` pour
 * remonter de 0 à 1). Au bord commun, deux tuiles lisent donc la même valeur,
 * et la densité d'une tuile clairsemée descend en pente vers sa voisine
 * éclaircie au lieu de sauter. Jamais au-dessus de la part de la tuile
 * elle-même : le budget est tenu en espérance, sans arbre de plus.
 *
 * La part d'une tuile ne dépend que de ce que le sol y porte (le semis
 * attendu, pas le semis tiré), jamais de l'ordre de semis ni de l'observateur.
 */

/** Part gardée d'une tuile qui attend `expected` plantes pour `budget` places. */
export function keptShare(expected, budget) {
  return expected > budget ? budget / expected : 1;
}

/**
 * Part gardée en un point de la scène. `shareOf(tx, ty)` rend la part de la
 * tuile d'indices (tx, ty), dans le repère des tuiles de `frame`
 * (`frame.origin`, `frame.scale`).
 */
export function thinningShareAt(frame, x, z, shareOf, rampM = frame.scale / 2) {
  const u = frame.origin.x + x / frame.scale;
  const v = frame.origin.y + z / frame.scale;
  const tx = Math.floor(u);
  const ty = Math.floor(v);
  let best = shareOf(tx, ty);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const gapX = dx < 0 ? u - tx : dx > 0 ? tx + 1 - u : 0;
      const gapY = dy < 0 ? v - ty : dy > 0 ? ty + 1 - v : 0;
      const slack = (Math.hypot(gapX, gapY) * frame.scale) / rampM;
      if (slack >= best) continue;
      best = Math.min(best, shareOf(tx + dx, ty + dy) + slack);
    }
  }
  return best;
}
