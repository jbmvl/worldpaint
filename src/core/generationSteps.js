/* Les mêmes étapes servent à la reconstruction immédiate d’une couche et à
 * son pilotage coopératif par le compositeur. Seul ce dernier choisit les pauses. */
export function finishGeneration(steps) {
  let result;
  do { result = steps.next(); } while (!result.done);
  return result.value;
}
