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
 *
 * ## Le fossé, et pourquoi il est large
 *
 * Le fossé a longtemps été un ruban en V de deux mètres posé sur le sol. Il ne
 * s'est jamais vu, et il ne pouvait pas se voir : la maille de terrain est
 * **opaque**, une géométrie qui passe dessous est invisible, et ce V était
 * entièrement à l'intérieur du sol — seules ses deux lèvres, à cinq et deux
 * centimètres, en dépassaient.
 *
 * Le corriger en creusant le V dans le terrain ne marche pas non plus, et c'est
 * mesurable : la maille fait 4,42 m au centre de la bulle et 8,85 m dans
 * l'anneau suivant. Une chute de cinquante centimètres sur un mètre y demande
 * des mailles d'un demi-mètre, soit près de trois millions de sommets pour la
 * seule tuile centrale. Et quelle que soit la cuvette qu'on creuse, la maille
 * se tient de neuf à quatorze centimètres **au-dessus** de la surface
 * analytique — donc au-dessus des lèvres du V, qui restent enterrées, et de
 * façon variable le long de la route selon l'endroit où tombent les sommets.
 *
 * Ce que la maille sait porter, en revanche, c'est une cuvette **large et
 * molle** : trente centimètres sur onze mètres sont rendus à 91-100 % dans la
 * tuile centrale, quelle que soit la phase du réseau. C'est donc ce que le
 * fossé est devenu — une dépression du sol, et non plus un objet posé dessus.
 * La profondeur est petite ; c'est la largeur que la maille impose, pas un
 * choix de dessin.
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
 * Profondeur du fossé, en mètres.
 *
 * Petite, et volontairement : ce qu'on veut lire est un bas-côté qui descend,
 * pas une tranchée. Elle est aussi ce que la maille rend fidèlement à cette
 * largeur-là — voir l'en-tête.
 */
export const DITCH_DEPTH_M = 0.3;
/** Largeur de la descente, depuis le bord du fond plat du déblai, en mètres. */
export const DITCH_SLOPE_M = 2.8;
/** Largeur du fond du fossé, en mètres. */
export const DITCH_FLOOR_M = 3;
/**
 * Largeur de la remontée au terrain naturel, en mètres.
 *
 * Elle ne peut pas être plus courte : c'est elle qui fait que la cuvette est
 * portée par des sommets au lieu d'être moyennée entre deux. Raccourcir la
 * cuvette de trois mètres fait tomber la profondeur rendue de 91 % à 58 %, et
 * cette perte n'est pas uniforme — le fossé se creuserait et se comblerait le
 * long de la route.
 */
export const DITCH_BLEND_M = 5;

/**
 * Portée totale du terrassement au-delà de la rive d'une chaussée, en mètres.
 *
 * C'est la marge que doit couvrir l'index des chaussées : au-delà, la requête
 * ne rendrait rien et le terrassement se terminerait par une marche.
 */
export const ROAD_CUT_REACH_M = Math.max(
  ROAD_CUT_M + ROAD_CUT_BLEND_M,
  ROAD_CUT_M + DITCH_SLOPE_M + DITCH_FLOOR_M + DITCH_BLEND_M
);

/**
 * Creusement du fossé en un point, en mètres — une valeur positive à
 * **retrancher** au terrain.
 *
 * Le fossé commence là où finit le fond plat du déblai : l'accotement excavé
 * reste plan, c'est une surface sur laquelle on s'arrête, pas une berge.
 *
 * Fonction pure.
 *
 * @param {number} distance  Distance du point à l'axe de la chaussée, en mètres.
 * @param {number} halfWidth Demi-largeur de la chaussée, en mètres.
 * @returns {number} profondeur à retrancher, positive ou nulle.
 */
export function ditchDropAt(distance, halfWidth) {
  const beyond = distance - (halfWidth + ROAD_CUT_M);
  if (beyond <= 0) return 0;

  if (beyond < DITCH_SLOPE_M) {
    const t = beyond / DITCH_SLOPE_M;
    return DITCH_DEPTH_M * t * t * (3 - 2 * t);
  }

  const out = beyond - DITCH_SLOPE_M - DITCH_FLOOR_M;
  if (out <= 0) return DITCH_DEPTH_M;
  if (out >= DITCH_BLEND_M) return 0;

  const t = out / DITCH_BLEND_M;
  return DITCH_DEPTH_M * (1 - t * t * (3 - 2 * t));
}

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
 * Le fossé se **retranche** de ce résultat, et non l'inverse. C'est ce qui le
 * rend juste dans les deux situations : en déblai il descend sous le talus
 * qu'on vient de tailler, en remblai comme en terrain plat il descend sous le
 * sol naturel. Dans les deux cas c'est un creux, jamais une bosse.
 *
 * Fonction pure.
 *
 * @param {number} raw       Altitude naturelle.
 * @param {number} platform  Altitude de la plate-forme de la chaussée.
 * @param {number} distance  Distance du point à l'axe de la chaussée, en mètres.
 * @param {number} halfWidth Demi-largeur de la chaussée, en mètres.
 * @param {boolean} [ditch]  Vrai si un fossé court de ce côté-ci de la route.
 * @returns {number} altitude retenue.
 */
export function cutElevationAt(raw, platform, distance, halfWidth, ditch = false) {
  const drop = ditch ? ditchDropAt(distance, halfWidth) : 0;

  if (!(platform < raw)) return raw - drop;

  const edge = halfWidth + ROAD_CUT_M;
  if (distance <= edge) return platform;

  const t = Math.min(1, (distance - edge) / ROAD_CUT_BLEND_M);
  const eased = t * t * (3 - 2 * t);
  return platform + (raw - platform) * eased - drop;
}
