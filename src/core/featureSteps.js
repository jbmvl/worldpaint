// Les sources de test peuvent ne proposer que la visite synchrone historique.
export function* visitFeatures(source, ...args) {
  if (source.forEachFeatureSteps) return yield* source.forEachFeatureSteps(...args);
  source.forEachFeature(...args);
  yield;
}
