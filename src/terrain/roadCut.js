/*
 * roadCut — le déblai des chaussées, cotes partagées en un seul endroit.
 *
 * `terrainBubble` creuse la maille (`cutElevationAt`), `roadNetwork` en tire la
 * marge de son index spatial, `furnitureLayer` y dresse la falaise de la
 * tranchée, `roadCorridor` y lit l'emprise : tous doivent s'accorder
 * exactement, d'où le fichier séparé plutôt qu'une constante logée chez l'un
 * d'eux.
 *
 * Deux largeurs, parce que deux choses différentes se jouent au même endroit :
 *
 * - **l'emprise** (`ROAD_CUT_M`) — l'accotement excavé tel qu'un terrassier le
 *   laisse. C'est ce que le paysage garde libre ;
 * - **le fond plat que la maille sait tenir** (`cutBenchAt`). L'entaille n'est
 *   creusée qu'aux sommets de la maille du terrain. Un fond plat plus étroit
 *   qu'une maille peut n'en contenir aucun : le triangle enjambe alors la
 *   chaussée, et sa corde passe au-dessus. Sur un versant à 60 %, une maille de
 *   9,3 m et un fond plat de 1,2 m mettent jusqu'à 3,9 m de terrain par-dessus
 *   la route. Le fond plat creusé vaut donc au moins une maille.
 */

/** Largeur de l'emprise au-delà de la chaussée (accotement excavé), en mètres. */
export const ROAD_CUT_M = 1.2;

/**
 * Largeur du fond plat de l'entaille, en mètres : au moins l'emprise, au moins
 * une maille de terrain.
 *
 * Le pas donné est celui de la maille **la plus grossière qui soit creusée**,
 * et non celui de la tuile où l'on creuse : un fond plat qui suivrait l'anneau
 * changerait de largeur quand l'observateur avance, et le terrain se remettrait
 * à percer la chaussée au gré de la caméra.
 *
 * @param {number} meshStepM Pas de cette maille, en mètres.
 */
export function cutBenchAt(meshStepM) {
  return Math.max(ROAD_CUT_M, meshStepM || 0);
}

/**
 * Largeur du raccord qui ramène l'entaille au terrain naturel, en mètres.
 * Sans lui le déblai finirait en marche verticale visible dans la maille.
 */
export const ROAD_CUT_BLEND_M = 5;

/** Anneau de tuiles au-delà duquel on ne creuse plus (le réseau ne porte qu'à `ROAD_RADIUS_M`). */
export const ROAD_CUT_MAX_RING = 1;

/**
 * Altitude du terrain entaillé, à `distance` de l'axe d'une chaussée : plate
 * sous la chaussée, intacte au-delà du raccord, en `smoothstep` entre les
 * deux. Ne fait jamais monter le terrain (un remblai se tient par un mur, pas
 * par une bosse de terrain).
 *
 * @param {number} raw       Altitude naturelle.
 * @param {number} platform  Altitude de la plate-forme de la chaussée.
 * @param {number} distance  Distance du point à l'axe de la chaussée, en mètres.
 * @param {number} halfWidth Demi-largeur de la chaussée, en mètres.
 * @param {number} [bench]   Largeur du fond plat au-delà de la chaussée
 *        (`cutBenchAt`). À défaut, la seule emprise.
 * @returns {number} altitude retenue.
 */
export function cutElevationAt(raw, platform, distance, halfWidth, bench = ROAD_CUT_M) {
  if (!(platform < raw)) return raw;

  const edge = halfWidth + bench;
  if (distance <= edge) return platform;

  const t = Math.min(1, (distance - edge) / ROAD_CUT_BLEND_M);
  const eased = t * t * (3 - 2 * t);
  return platform + (raw - platform) * eased;
}
