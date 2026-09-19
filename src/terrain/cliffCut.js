/*
 * cliffCut — la marche de terrain sous une falaise relevée, cotes partagées en
 * un seul endroit.
 *
 * `terrainBubble` écrase le relief (`cliffElevation`), `furniture/cliffs` pose
 * la paroi rocheuse dessus : les deux doivent lire les mêmes cotes, d'où le
 * fichier séparé plutôt qu'une constante logée chez l'un des deux — même
 * raison que `roadCut`.
 *
 * Le MNT ne sait pas qu'une falaise est verticale : il l'étale en rampe sur
 * toute sa largeur (une falaise de mer de quatre-vingts mètres se lit sur une
 * centaine de mètres de pente douce). Ce qu'on fait ici n'est donc pas une
 * correction de la donnée mais une **synthèse** : la dénivelée mesurée est
 * conservée, sa distance est comprimée.
 */

/**
 * Distances, en mètres, auxquelles on cherche le pied et l'arase de part et
 * d'autre du trait. La bonne n'est pas connue d'avance : elle vaut la largeur
 * de la rampe sur laquelle le MNT a étalé la falaise, et cette largeur est
 * proportionnelle à la dénivelée. Sondé trop près, on ne capte qu'une part de
 * la chute — sur une rampe de quatre-vingt-dix mètres, lire à vingt-quatre n'en
 * rend que la moitié ; sondé trop loin, on aplatit du versant qui n'y est pour
 * rien.
 *
 * `cliffLayer` retient la plus courte qui capte la chute entière.
 */
export const CLIFF_PROBE_M = [24, 36, 48, 60, 72];

/** Sonde par défaut, et plancher : en deçà, le raccord serait une arête. */
export const CLIFF_BLEND_M = CLIFF_PROBE_M[0];

/**
 * Dénivelée minimale pour qu'un trait relevé devienne une marche, en mètres.
 *
 * `natural=cliff` est posé dans OSM sur tout ce qui casse, y compris un talus
 * de bord de route d'un mètre. En deçà de ce seuil, la marche écraserait
 * quarante-huit mètres de terrain (deux fois le raccord) pour une dénivelée
 * que le MNT ne distingue pas de son propre bruit.
 */
export const CLIFF_MIN_HEIGHT_M = 5;

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Altitude du terrain à `across` mètres du trait de falaise — compté positif
 * vers le **haut** de la falaise, la convention OSM mettant le haut à gauche
 * du sens de tracé.
 *
 * Le profil : le terrain ne monte pas au-dessus du pied sous le trait, ne
 * descend pas sous l'arase au-delà de la paroi, et passe de l'un à l'autre sur
 * `face` mètres. Ne dépend que de la position au sol, donc deux tuiles
 * voisines s'accordent au bord sans se consulter.
 *
 * @param {number} raw    Altitude naturelle, en mètres.
 * @param {number} foot   Altitude du pied, lue à `blend` en contrebas.
 * @param {number} crest  Altitude de l'arase, lue à `blend` au-dessus.
 * @param {number} across Distance signée au trait, en mètres.
 * @param {number} face   Largeur au sol de la paroi, en mètres.
 * @param {number} [blend] Distance de la sonde, donc du raccord.
 * @returns {number} altitude retenue.
 */
export function cliffElevationAt(raw, foot, crest, across, face, blend = CLIFF_BLEND_M) {
  if (!(crest - foot >= CLIFF_MIN_HEIGHT_M) || !(face > 0)) return raw;

  // Distance au-delà de la paroi, d'un côté comme de l'autre.
  const out = across < 0 ? -across : Math.max(0, across - face);
  if (out >= blend) return raw;

  // Le pied et l'arase sont des **bornes**, pas des consignes : on ne ramène
  // pas le terrain à elles, on l'empêche seulement de les franchir. Le tirer
  // vers la rampe du MNT le ferait bomber sous la falaise avant de retomber,
  // puisque cette rampe est justement ce qu'on supprime. Lues au bord du
  // raccord, les deux bornes y valent le terrain naturel : la reprise est
  // continue sans avoir rien à fondre.
  const base = Math.min(raw, foot);
  const cap = Math.max(raw, crest);

  if (across <= 0) return base;
  if (across >= face) return cap;
  return base + (cap - base) * smooth(across / face);
}

/**
 * Largeur au sol de la paroi : une falaise se tient presque droite, mais pas
 * tout à fait, et jamais en lame. Bornée par le haut pour qu'une très grande
 * dénivelée ne fasse pas un versant de plus.
 *
 * @param {number} height     Dénivelée pied-arase, en mètres.
 * @param {Object} spec       Réglages de thème (`batter`, `minReach`, `maxReach`).
 */
export function cliffFaceWidth(height, { batter, minReach, maxReach }) {
  return Math.min(Math.max(height * batter, minReach), maxReach);
}
