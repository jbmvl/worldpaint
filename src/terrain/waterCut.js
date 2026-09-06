/*
 * waterCut — la cuvette creusée sous les nappes d'eau. Même geste que
 * `roadCut`, pour la même raison : un lac occupe un creux du relief plutôt que
 * d'être posé dessus, sinon terrain et eau s'intersectent.
 *
 * Cotes ici et pas dans la couche d'eau car `waterIndex` (construit la
 * cuvette) et `terrainBubble` (la creuse) doivent s'accorder exactement.
 *
 * La maille de terrain (4,42 m au centre de la bulle, 8,85 m dans l'anneau
 * suivant) rend mal un creux étroit : une intersection de 30 cm sur 11 m ne
 * passe qu'à 91-100 %. D'où deux contraintes : le lit doit être bien plus
 * profond que cette erreur, et on ne creuse que les nappes, jamais les cours
 * d'eau linéaires (trop étroits pour la maille — le partage `water`/`waterway`
 * des tuiles vectorielles tombe justement sur ce partage large/étroit).
 */

/** Profondeur du lit sous la nappe, en mètres (~4x l'erreur de la maille, pour que la berge émerge). */
export const WATER_BED_M = 0.6;

/** Largeur du raccord qui ramène la cuvette au terrain naturel, en mètres. */
export const WATER_CUT_BLEND_M = 11;

/** Anneau de tuiles au-delà duquel on ne creuse plus (les nappes ne portent qu'à `WATER_RADIUS_M`). */
export const WATER_CUT_MAX_RING = 1;

/**
 * Altitude du terrain sous une nappe d'eau, à `distance` de la rive : le lit
 * sous la nappe, intact au-delà du raccord, en `smoothstep` entre les deux.
 * Ne fait jamais monter le terrain (un lac dont le MNT place déjà le fond
 * sous le lit reste tel quel).
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
