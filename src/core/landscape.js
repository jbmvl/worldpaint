/*
 * landscape — où sur la Terre sommes-nous, et sur quel terrain.
 *
 * Le profil du lieu : la région naturelle (`core/region.js`), l'altitude et la
 * pente sous l'observateur. Ce n'est ni une couche ni un thème et ça ne pose
 * rien — c'est une **entrée**, lue par tout ce qui choisit un contenu dans une
 * liste : peuplements, palettes de bourg, cultures, bétail, couleur du sol.
 *
 * Les deux ne se mêlent pas : la région dit à quoi ressemble le pays, le relief
 * quelle forme a le terrain sous les pieds. Le second ne corrige pas la
 * première — ce qui pousse réellement en altitude est relevé par le vectoriel,
 * qui ne met pas de forêt là où il n'y en a pas.
 *
 * La lecture est refaite à chaque `refresh` et jamais mémoïsée : elle ne coûte
 * qu'une boucle sur quelques centaines d'ancres et cinq altitudes déjà montées.
 * Un cache en mètres locaux, lui, se périme mal — le repère se ré-ancre au
 * loin, et une ville cherchée depuis une autre gardait la région de la
 * précédente.
 */

import { regionAt } from './region.js';

/** Demi-portée de la mesure de pente sous l'observateur, en mètres. */
export const RELIEF_SPAN_M = 60;

/**
 * Altitude et pente sous l'observateur, mesurées dans le MNT monté.
 *
 * Sur cent vingt mètres et non sur la maille : un MNT à trente mètres bruite
 * la pente de quelques pour cent partout, et c'est le versant qu'on veut, pas
 * le grain (même raison que `crossSlope` côté chaussée).
 *
 * @param {Object} bubble Instance `TerrainBubble`.
 * @param {{x:number,z:number}} here Position locale de l'observateur.
 * @returns {{elevation:number, slope:number}}
 */
export function reliefAt(bubble, here) {
  const at = (x, z) => bubble.surfaceElevationAtLocal(x, z);
  const span = RELIEF_SPAN_M * 2;
  const eastWest = (at(here.x + RELIEF_SPAN_M, here.z) - at(here.x - RELIEF_SPAN_M, here.z)) / span;
  const northSouth = (at(here.x, here.z - RELIEF_SPAN_M) - at(here.x, here.z + RELIEF_SPAN_M)) / span;
  return {
    elevation: at(here.x, here.z),
    slope: Math.hypot(eastWest, northSouth),
  };
}

/**
 * Le profil du lieu, ou `null` hors de toute région couverte.
 *
 * Une région imposée (`override`) prend la place de celle du lieu : elle ne le
 * décrit plus, elle le contredit exprès.
 *
 * @param {number} lng
 * @param {number} lat
 * @param {{x:number,z:number}} here
 * @param {Object} options
 * @param {Object} options.bubble Instance `TerrainBubble`.
 * @param {Object|null} [options.override] Dossier de région imposé.
 * @returns {{region:Object, relief:Object}|null}
 */
export function landscapeAt(lng, lat, here, { bubble, override = null }) {
  const relief = reliefAt(bubble, here);
  const region = override || regionAt(lng, lat);
  return region ? { region, relief } : null;
}
