/*
 * roadEdges — la rive de la chaussée, et la place qui reste au-delà.
 *
 * ## Pourquoi ce module existe
 *
 * Le lot précédent a fait du carrefour une **surface**. La chaussée est donc
 * désormais une seule chose : l'union des rubans et des surfaces de carrefour.
 * Sa frontière — sa **rive** — est un objet du modèle, et non plus une notion
 * que chaque couche redécouvrait pour son compte.
 *
 * Elle l'était pourtant : la bordure la déduisait de l'axe du tronçon (`axe ±
 * demi-largeur`), sans savoir qu'un carrefour en avait repris le relais ; le
 * refus de trottoir se posait par un sondage de la bande revêtue
 * (`pavementOnOtherRoad`) qui ne répondait que par oui ou non, et qui, aux
 * abords de tout carrefour, répondait oui sur vingt-cinq mètres — d'où des
 * trottoirs qui s'arrêtaient une demi-rue avant le coin.
 *
 * ## Ce que ce module répond
 *
 * Une question, et une seule : **combien de place y a-t-il entre ce point et
 * la prochaine chaussée ?** (`edgeClearance`). Une largeur, pas un booléen —
 * c'est ce qui permet à un trottoir de se rétrécir là où il est à l'étroit au
 * lieu de disparaître, et c'est ce que le comblement entre voies voisines
 * interrogera à son tour.
 *
 * Deux choses prennent de la place, et une seule les deux :
 *
 *   - un **ruban**, à sa demi-largeur près (la distance rendue est celle de la
 *     rive, pas de l'axe) ;
 *   - une **surface de carrefour**, dont on ne mesure pas la distance mais
 *     seulement l'intérieur. Elle est bordée par ses propres branches, qui
 *     sont des chaussées comme les autres et comptent déjà : ne lui demander
 *     que « suis-je dedans ? » évite de compter deux fois la même chaussée, et
 *     laisse une bordure venir se poser au ras d'un coin de rue.
 *
 * Le **niveau** est lu ligne par ligne : une chaussée qui passe au-dessus ne
 * prend pas de place au sol. C'est la même règle qu'ailleurs, celle du lot A.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne décide de rien. Savoir si un trottoir se pose là est une question de
 * lieu (bourg, bâti, devers) qui appartient à `streetLayer` ; ce module ne
 * répond que de la géométrie.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

import { distanceToSegment } from './roadGraph.js';
import { LEVEL_GROUND } from './roadWorks.js';

/**
 * Portée de la mesure, en mètres. Ce n'est pas une tolérance : c'est la
 * largeur au-delà de laquelle plus rien de ce qui borde une chaussée ne se
 * soucie de ce qu'il y a en face — le plus large trottoir du thème, caniveau
 * et jupe compris, tient dans trois mètres et demi.
 */
export const EDGE_REACH_M = 6;

/**
 * Place libre entre un point et la prochaine chaussée, en mètres, bornée par
 * `reach`. Zéro si le point est **sur** une chaussée ou dans un carrefour.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object} options
 * @param {Object|null} [options.roadIndex] `RoadIndex` des chaussées.
 * @param {Object|null} [options.areas] `JunctionAreas`.
 * @param {number} [options.level] Niveau de croisement du point interrogé.
 * @param {Function|null} [options.ignore] `(segment) => boolean` : les
 *        chaussées dont ce point **est** la rive, qui ne se comptent pas
 *        elles-mêmes.
 * @param {Function|null} [options.ignoreArea] `(index) => boolean` : idem pour
 *        les surfaces de carrefour.
 * @param {number} [options.reach]
 * @returns {number}
 */
export function edgeClearance(
  x,
  z,
  {
    roadIndex = null,
    areas = null,
    level = LEVEL_GROUND,
    ignore = null,
    ignoreArea = null,
    reach = EDGE_REACH_M,
  } = {}
) {
  if (areas && areas.length > 0) {
    const index = areas.indexAt(x, z, level);
    if (index >= 0 && !(ignoreArea && ignoreArea(index))) return 0;
  }
  if (!roadIndex || typeof roadIndex.forEachNear !== 'function') return reach;

  let best = reach;
  roadIndex.forEachNear(x - reach, z - reach, x + reach, z + reach, (segment, row) => {
    if (best <= 0) return;
    if (ignore && ignore(segment)) return;
    // Une chaussée d'un autre niveau passe au-dessus ou en dessous : elle ne
    // prend pas la place du sol.
    if ((segment.levels?.[row] ?? LEVEL_GROUND) !== level) return;
    const a = segment.path[row];
    const b = segment.path[row + 1];
    if (!a || !b) return;
    const room = distanceToSegment(x, z, a.x, a.z, b.x, b.z).distance - segment.halfWidth;
    if (room < best) best = room;
  });

  return best > 0 ? best : 0;
}

/**
 * Longueur d'une polyligne, en mètres.
 * @param {Array<{x:number,z:number}>} points
 * @returns {number}
 */
export function polylineLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/**
 * Repères de balayage constants le long d'une polyligne courte, pris une fois
 * pour toutes sur sa corde.
 *
 * Sert aux morceaux de rive qui **ne sont pas** portés par un tronçon (les
 * coins de rue), où la direction sortante est connue mais pas la tangente.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {{x:number,z:number}} outward Direction vers l'extérieur.
 * @returns {number} `+1` si l'extérieur est à gauche de la marche, `-1` sinon.
 */
export function outwardSide(points, outward) {
  if (!Array.isArray(points) || points.length < 2 || !outward) return 1;
  const a = points[0];
  const b = points[points.length - 1];
  let tx = b.x - a.x;
  let tz = b.z - a.z;
  const length = Math.hypot(tx, tz) || 1;
  tx /= length;
  tz /= length;
  // Perpendiculaire gauche de la marche, convention de `pathFrames`.
  return tz * outward.x - tx * outward.z >= 0 ? 1 : -1;
}
