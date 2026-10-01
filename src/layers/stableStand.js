/* Un complément de données ajoute des arbres, sans remodeler ceux déjà semés.
 * Le corridor reste prioritaire : une route nouvellement connue retire ce
 * qu'elle recouvre. La mémoire est limitée aux tuiles actives du peuplement.
 * Le tri par tirage ne sert qu'à départager les nouveaux venus quand le
 * plafond est atteint ; en deçà, tout le monde entre.
 */
const key = p => Math.round(p.x * 1000) * 67108864 + Math.round(p.z * 1000);

export function stableStand(previous, candidates, limit, allowed = () => true) {
  const retained = new Map();
  for (const p of previous || []) if (allowed(p)) retained.set(key(p), p);
  const newcomers = candidates.filter(p => !retained.has(key(p)) && allowed(p));
  if (retained.size + newcomers.length > limit) {
    newcomers.sort((a, b) => a.thin - b.thin || a.x - b.x || a.z - b.z);
    newcomers.length = Math.max(0, limit - retained.size);
  }
  for (const p of newcomers) retained.set(key(p), p);
  return [...retained.values()];
}
