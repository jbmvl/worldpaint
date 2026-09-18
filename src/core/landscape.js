/*
 * landscape — où sur la Terre sommes-nous, et sur quel terrain.
 *
 * Le profil du lieu : la famille climatique et son code Köppen
 * (`core/climate.js`), l'altitude et la pente sous l'observateur. Ce n'est ni
 * une couche ni un thème et ça ne pose rien — c'est une **entrée**, lue par
 * tout ce qui choisit un contenu dans une liste : peuplements, palettes de
 * bourg, cultures, bétail, couleur du sol.
 *
 * La lecture est refaite à chaque `refresh` et jamais mémoïsée : elle ne coûte
 * qu'une lecture de tableau et cinq altitudes déjà montées. Un cache en mètres
 * locaux, eux, se périme mal — le repère se ré-ancre au loin, et une ville
 * cherchée depuis une autre gardait le climat de la précédente.
 */

import { climateAt, refineByRelief } from './climate.js';

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
 * Le profil du lieu, ou `null` hors de la fenêtre climatique.
 *
 * Le relief corrige la famille, jamais le code Köppen : celui-ci reste ce que
 * dit la donnée, et sert à comprendre ce qu'on regarde. Une famille imposée
 * (`override`) n'est corrigée par rien — elle ne décrit plus le lieu, elle le
 * contredit exprès — et son code Köppen est tu, parce qu'il décrivait le lieu
 * qu'on vient justement de cesser de suivre.
 *
 * @param {number} lng
 * @param {number} lat
 * @param {{x:number,z:number}} here
 * @param {Object} options
 * @param {Object} options.bubble Instance `TerrainBubble`.
 * @param {string|null} [options.override] Famille imposée par l'application.
 * @returns {{climate:{family:string, koppen:string|null}, relief:Object}|null}
 */
export function landscapeAt(lng, lat, here, { bubble, override = null }) {
  const relief = reliefAt(bubble, here);
  const climate = climateAt(lng, lat);
  const family = override || refineByRelief(climate?.family ?? null, relief);
  const koppen = override ? null : climate?.koppen ?? null;
  return family ? { climate: { family, koppen }, relief } : null;
}
