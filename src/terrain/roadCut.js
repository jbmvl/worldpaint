/*
 * roadCut — le déblai des chaussées, décrit en un seul endroit.
 * ------------------------------------------------------------
 * Une route n'est pas posée sur un versant, elle y est **taillée** : on
 * excave en amont, on remblaie en aval, et la plate-forme reste plane en
 * travers à mi-hauteur de la section.
 *
 * Ce fichier ne contient que les trois cotes de cette entaille, et il existe
 * pour une raison : trois modules distincts en dépendent et doivent s'accorder
 * **exactement**.
 *
 * - `terrainBubble` creuse la maille de terrain (`cutElevation`) ;
 * - `roadNetwork` en tire la marge de son index spatial, qui doit porter au
 *   moins aussi loin que le raccord — sinon celui-ci se tronque en marche ;
 * - `furnitureLayer` pose le mur qui habille la tranchée, et il doit le poser
 *   au bord du fond plat, pas au milieu du raccord ;
 * - `ribbonGeometry.levelRow` documente pourquoi la plate-forme est à
 *   mi-hauteur, ce qui n'est tenable que parce que l'entaille existe.
 *
 * Les mettre chez l'un des trois obligerait les deux autres à l'importer, et
 * une constante de terrassement rangée dans un module de mobilier finirait par
 * être dupliquée « en attendant ».
 */

/**
 * Largeur du fond plat de l'entaille, au-delà de la rive de la chaussée, en
 * mètres. C'est l'accotement excavé.
 */
export const ROAD_CUT_M = 1.2;

/**
 * Largeur du raccord qui ramène l'entaille au terrain naturel, en mètres.
 *
 * Il compte autant que l'entaille elle-même : sans lui, le déblai se
 * terminerait par une marche verticale dans la maille de terrain, à un mètre de
 * la route, et cette marche se verrait bien plus que le défaut qu'on corrige.
 * Cinq mètres, c'est aussi l'ordre de grandeur d'une maille de terrain au
 * centre de la bulle (4,4 m) : plus court, le raccord ne serait porté par aucun
 * sommet et n'existerait pas.
 */
export const ROAD_CUT_BLEND_M = 5;

/**
 * Anneau de tuiles au-delà duquel on ne creuse plus.
 *
 * Le réseau routier ne porte qu'à 900 m (`ROAD_RADIUS_M`) : au-delà, l'index ne
 * rendrait jamais rien et on paierait la requête pour rien, sur les mailles les
 * plus nombreuses.
 */
export const ROAD_CUT_MAX_RING = 1;

/**
 * Altitude du terrain entaillé, en un point situé à `distance` de l'axe d'une
 * chaussée.
 *
 * Trois régimes, et le troisième est celui qui compte :
 *
 * 1. sous la chaussée et son accotement excavé, le terrain **est** la
 *    plate-forme ;
 * 2. au-delà du raccord, il est intact ;
 * 3. entre les deux, il remonte en `smoothstep` — une interpolation linéaire y
 *    laisserait deux arêtes vives, une à chaque bout du raccord, et la maille de
 *    terrain les rendrait toutes les deux visibles.
 *
 * L'entaille ne fait **jamais monter** le terrain : du côté aval la plate-forme
 * domine le sol, et c'est un remblai — il se tient par un mur, pas par une
 * bosse de terrain surgie de nulle part.
 *
 * Fonction pure.
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
