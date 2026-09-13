/*
 * faunaCrossing — la traversée déclenchée : une bête qui débouche devant
 * l'observateur, au moment où une application le demande.
 *
 * C'est le seul contenu du décor qui ne soit pas une fonction du lieu. Tout le
 * reste se redessine identique au même endroit ; cette bête-ci n'est pas posée
 * dans le monde, elle est jouée par-dessus, et un passage ultérieur ne la
 * retrouvera pas. C'est la définition d'un événement.
 *
 * Le tracé se déduit du **regard**, pas de la route : la bête débouche d'un
 * côté du champ de vision, franchit la trajectoire de l'observateur et repart
 * de l'autre. C'est ce qui la rend utilisable sur une route comme sur un
 * chemin, et ce qui rend le résultat lisible — elle traverse ce qu'on regarde.
 *
 * Ici on décide de ce qui existe ; `faunaLayer` ne fait plus que le jouer.
 */

import { buildCircuit, DASH_SPAN_M } from './faunaMotion.js';
import { coatFor } from './furniturePlacement.js';
import { FAUNA_SPECIES } from '../models/fauna/index.js';

/**
 * Distance par défaut à laquelle une traversée coupe la trajectoire de
 * l'observateur, en mètres.
 *
 * Assez loin pour qu'on voie la bête arriver, assez près pour qu'on la voie
 * tout court. C'est un défaut, pas une règle : une application qui roule vite
 * la voudra plus loin, et c'est à elle de le dire.
 */
export const FAUNA_CROSS_AHEAD_M = 55;

/**
 * Compose une traversée, prête à être jouée — ou `null` si l'espèce est
 * inconnue, le regard nul, ou le sol illisible à cet endroit.
 *
 * @param {Object} options
 * @param {Object} options.bubble Instance `TerrainBubble`.
 * @param {Object} [options.coats] Nuancier des robes (`theme.fauna.coats`).
 * @param {string} options.kind Espèce (`FAUNA_SPECIES`).
 * @param {{x:number,z:number}} options.at Position de l'observateur.
 * @param {{x:number,z:number}} options.forward Direction du regard, à plat.
 * @param {number} [options.distanceM] Où la bête coupe la trajectoire.
 * @param {number} [options.side] De quel côté elle débouche : `1` ou `-1`.
 * @param {number} [options.spanM] Demi-longueur de la traversée, en mètres.
 * @param {number} [options.scale] Taille, `1` étant celle du modèle.
 * @returns {Object|null}
 */
export function planFaunaCrossing({
  bubble,
  coats = null,
  kind,
  at,
  forward,
  distanceM = FAUNA_CROSS_AHEAD_M,
  side = 1,
  spanM = DASH_SPAN_M,
  scale = 1,
} = {}) {
  const spec = FAUNA_SPECIES[kind];
  // Sans repère local, le sol se lit à zéro partout (`surfaceElevationAtLocal`
  // retombe sur son défaut) : la bête traverserait à l'altitude de la mer.
  if (!bubble?.frame || !spec || !at || !forward) return null;

  const gaze = Math.hypot(forward.x, forward.z);
  if (!(gaze > 1e-6)) return null;
  const ahead = { x: forward.x / gaze, z: forward.z / gaze };

  // Le milieu de la traversée est devant l'observateur, sur son axe de regard :
  // c'est là qu'elle doit être vue, pas là où il se trouve.
  const anchor = { x: at.x + ahead.x * distanceM, z: at.z + ahead.z * distanceM };
  // La perpendiculaire au regard, dans le plan du sol. Le signe décide du côté
  // d'où la bête débouche — les deux sont symétriques.
  const axis = { x: -ahead.z * Math.sign(side || 1), z: ahead.x * Math.sign(side || 1) };

  const circuit = buildCircuit({
    behaviour: 'dash',
    x: anchor.x,
    z: anchor.z,
    walkMS: spec.walkMS,
    runMS: spec.runMS,
    sampleY: (sx, sz) => bubble.surfaceElevationAtLocal(sx, sz, 0) * bubble.verticalScale,
    crossAxis: axis,
    // Aucune contrainte de terrain (`allow`) : une traversée déclenchée doit
    // passer, c'est tout son objet — exactement comme celle du décor.
    spanM,
  });
  if (!circuit) return null;

  return {
    kind,
    x: anchor.x,
    z: anchor.z,
    circuit,
    tint: coatFor(coats, kind, anchor.x, anchor.z),
    scale,
  };
}
