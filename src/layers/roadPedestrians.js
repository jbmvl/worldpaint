/*
 * Les trottoirs cartographiés ne sont pas des chaussées supplémentaires.
 * Les cheminements piétons urbains qui longent une rue restent portés par
 * le sol ; les allées indépendantes, escaliers et pistes cyclables restent
 * dans le réseau. Le filtrage précède le graphe et conserve les niveaux.
 */
import { absorbParallelLines } from './roadBundles.js';

export function removeRoadsideFootways(lines, urban) {
  if (!urban?.any) return lines;
  const candidates = lines.map(line => line.footway ? { ...line, profile: 'footway', original: line } : line);
  return absorbParallelLines(candidates, {
    order: ['express', 'major', 'minor', 'lane', 'footway'],
    absorbable: new Set(['footway']),
    gapMax: 2.5,
    share: .9,
    where: (x,z) => urban.nearCity ? urban.nearCity(x,z) : urban.covers(x,z),
  }).map(line => line.original ?? line);
}
