/* Un complément de données ajoute des arbres, sans remodeler ceux déjà semés.
 * Le corridor reste prioritaire : une route nouvellement connue retire ce
 * qu'elle recouvre. La mémoire est limitée aux tuiles actives du peuplement.
 */
export function stableStand(previous, candidates, limit, allowed = () => true) {
  const key = p => `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`;
  const retained = new Map();
  for (const p of previous || []) if (allowed(p)) retained.set(key(p), p);
  const newcomers = candidates.filter(p => !retained.has(key(p)) && allowed(p));
  newcomers.sort((a, b) => a.thin - b.thin || a.x - b.x || a.z - b.z);
  for (const p of newcomers) {
    if (retained.size >= limit) break;
    retained.set(key(p), p);
  }
  return [...retained.values()];
}
