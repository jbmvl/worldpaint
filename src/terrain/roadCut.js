/*
 * roadCut — le déblai des chaussées, cotes partagées en un seul endroit.
 *
 * `terrainBubble` creuse la maille (`cutElevation`), `roadNetwork` en tire la
 * marge de son index spatial, `furnitureLayer` y pose le mur de la tranchée,
 * `ribbonGeometry.levelRow` s'appuie dessus : les trois doivent s'accorder
 * exactement, d'où le fichier séparé plutôt qu'une constante logée chez l'un
 * des trois.
 */

/** Largeur du fond plat de l'entaille au-delà de la chaussée (accotement excavé), en mètres. */
export const ROAD_CUT_M = 1.2;

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
 * @returns {number} altitude retenue.
 */
export function cutElevationAt(raw, platform, distance, halfWidth) {
  if (!(platform < raw)) return raw;

  const edge = halfWidth + ROAD_CUT_M;
  if (distance <= edge) return platform;

  const t = Math.min(1, (distance - edge) / ROAD_CUT_BLEND_M);
  const eased = t * t * (3 - 2 * t);
  return platform + (raw - platform) * eased;
}
