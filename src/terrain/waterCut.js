/*
 * waterCut — la cuvette creusée sous les nappes d'eau.
 * ----------------------------------------------------
 * Même geste que `roadCut`, pour la même raison. Une chaussée n'est pas posée
 * sur le versant, elle y est taillée ; un lac n'est pas posé sur le relief, il
 * en occupe un creux. Tant que le terrain ignore l'eau, les deux surfaces
 * s'**intersectent** — et une intersection ne se corrige pas par un décalage,
 * qu'il soit géométrique ou de profondeur. C'est ce que `WATER_SINK_M` et le
 * décalage de polygone essayaient de faire, chacun à leur façon, sans pouvoir y
 * arriver : l'écart à rattraper varie de quelques centimètres à plusieurs
 * mètres d'un endroit à l'autre, et une constante ne suit pas.
 *
 * Ces cotes sont ici, et pas dans la couche d'eau, parce que deux modules
 * doivent s'accorder exactement dessus : `waterIndex` construit la cuvette et
 * `terrainBubble` la creuse. Les ranger chez l'un obligerait l'autre à
 * l'importer.
 *
 * ## Ce que la maille sait porter, et ce qui en découle
 *
 * Le projet a déjà mesuré cette limite en essayant de creuser un fossé de
 * route, essai abandonné (commits a4862e0 puis 329204a) : la maille de terrain
 * fait 4,42 m au centre de la bulle et 8,85 m dans l'anneau suivant, elle se
 * tient de 9 à 14 cm au-dessus de la surface analytique qu'on lui demande de
 * suivre, et **ce qu'elle rend fidèlement est une cuvette large et molle** —
 * trente centimètres sur onze mètres passent à 91-100 %.
 *
 * Deux conséquences, qui ne sont pas des choix :
 *
 * 1. le lit doit être franchement plus profond que l'erreur de la maille. Les
 *    quinze centimètres de `WATER_SINK_M` étaient du même ordre qu'elle, donc
 *    sans effet garanti ;
 * 2. **on ne creuse que les nappes**, jamais les cours d'eau linéaires. Un
 *    ruisseau fait 3 m de large, un fossé 1,2 m : creuser à cette échelle dans
 *    une maille de 4,42 m, c'est refaire le fossé et échouer pareil. Le partage
 *    des tuiles vectorielles entre surfaces (`water`) et lignes (`waterway`)
 *    tombe exactement sur le partage large/étroit dont la maille a besoin.
 */

/**
 * Profondeur du lit sous la nappe, en mètres.
 *
 * Choisie sur la mesure ci-dessus : quatre fois l'erreur de la maille, de sorte
 * que la berge émerge même là où la maille rend le creux le plus mal. En dessous
 * d'une quarantaine de centimètres, la garantie redeviendrait statistique.
 */
export const WATER_BED_M = 0.6;

/**
 * Largeur du raccord qui ramène la cuvette au terrain naturel, en mètres.
 *
 * C'est la largeur mesurée à laquelle la maille rend un creux à 91-100 %. Plus
 * court, le raccord ne serait porté par aucun sommet et la cuvette se
 * terminerait par une marche verticale à la rive — un défaut bien plus visible
 * que celui qu'on corrige.
 */
export const WATER_CUT_BLEND_M = 11;

/**
 * Anneau de tuiles au-delà duquel on ne creuse plus.
 *
 * Un seul anneau suffit à couvrir toute l'eau construite : les nappes ne
 * portent qu'à `WATER_RADIUS_M` (900 m), et l'anneau 1 s'étend à une tuile et
 * demie du centre du bloc, soit près de 1 300 m. Creuser plus loin coûterait
 * une requête par sommet sur les mailles les plus nombreuses, pour un terrain
 * où aucune nappe n'est dessinée.
 */
export const WATER_CUT_MAX_RING = 1;

/**
 * Altitude du terrain sous une nappe d'eau, à `distance` de la rive.
 *
 * Trois régimes, exactement comme `cutElevationAt` :
 *
 * 1. sous la nappe, le terrain **est** le lit ;
 * 2. au-delà du raccord, il est intact ;
 * 3. entre les deux, il remonte en `smoothstep` — une interpolation linéaire y
 *    laisserait deux arêtes vives que la maille rendrait toutes les deux.
 *
 * La cuvette ne fait **jamais monter** le terrain. Un lac dont le MNT place
 * déjà le fond sous le lit reste tel quel : on garantit que l'eau se voit, on
 * ne prétend pas connaître le relief mieux que la donnée.
 *
 * Fonction pure.
 *
 * @param {number} raw      Altitude naturelle, en mètres.
 * @param {number} level    Altitude de la nappe, en mètres.
 * @param {number} distance Distance du point à la rive, en mètres. Zéro sous la
 *        nappe, croissante vers l'extérieur.
 * @returns {number} altitude retenue.
 */
export function cutWaterElevationAt(raw, level, distance) {
  const bed = level - WATER_BED_M;
  if (!(bed < raw)) return raw;

  if (distance <= 0) return bed;
  if (distance >= WATER_CUT_BLEND_M) return raw;

  const t = distance / WATER_CUT_BLEND_M;
  const eased = t * t * (3 - 2 * t);
  return bed + (raw - bed) * eased;
}
