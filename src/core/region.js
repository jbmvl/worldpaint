/*
 * region — dans quelle région naturelle se trouve la scène.
 *
 * L'entrée qui dit *où sur la Terre* on est, et la seule : le vectoriel dit ce
 * qu'il y a au sol, le MNT quelle forme il a, la région à quoi ressemble le
 * pays. Ce module ne décide de rien, il répond à une question.
 *
 * ## Comment la région est choisie : l'ancre la plus proche
 *
 * Une région ne porte pas son contour, elle porte quelques **ancres** — des
 * points posés dans son épaisseur. La région d'un lieu est celle dont une ancre
 * est la plus proche, et rien d'autre. Le découpage qui en résulte est un
 * Voronoï : les limites tombent à mi-chemin entre deux ancres voisines.
 *
 * C'est volontaire, et c'est ce qui rend le fichier de régions tenable :
 *
 * - **une limite de région naturelle est floue de toute façon.** Personne ne
 *   sait où l'Anjou s'arrête ; poser deux points dedans est une affirmation
 *   qu'on peut tenir, tracer son contour non ;
 * - **on affine une région en lui ajoutant une ancre**, jamais en redessinant
 *   quoi que ce soit. Une vallée étroite, un littoral, un couloir en demandent
 *   trois ou quatre ; un plateau compact se contente d'une ;
 * - **c'est pur, synchrone et minuscule** — quelques centaines de points, une
 *   boucle, aucun index spatial, aucun réseau, donc testable sous `node --test`
 *   comme `tileMath`. Le jour où des contours fidèles seront nécessaires, c'est
 *   `regionAt` qu'on remplace, pas ses lecteurs.
 *
 * Le prix est connu : **une ancre déborde**. Entre deux régions voisines mal
 * ancrées, la limite peut passer plusieurs kilomètres à côté de la vraie. À
 * l'échelle d'une scène, ça déplace une frontière de paysage ; ça n'en invente
 * pas une.
 *
 * ## Pourquoi une portée maximale
 *
 * Sans elle, le point le plus éloigné du monde tomberait quand même sur une
 * région — la Pologne se peindrait en alsacien, l'Atlantique en breton. Au-delà
 * de `MAX_REACH_KM` de toute ancre, `regionAt` rend `null` : le décor se peint
 * alors comme il se peint sans région, ce qui est un état valide. Tout ce qui
 * la lit doit savoir s'en passer.
 *
 * ## Ce dont la région ne dépend pas
 *
 * Ni du relief, ni de l'altitude, ni de la position de l'observateur : une
 * position au sol entre, un dossier sort. Le relief décrit la forme du terrain,
 * pas le pays ; et ce qui pousse réellement à 2000 mètres est relevé par le
 * vectoriel, qui ne met pas de forêt là où il n'y en a pas.
 */

import { REGIONS } from './regions.js';

/**
 * Distance au-delà de laquelle aucune ancre ne compte, en kilomètres.
 *
 * L'ordre de grandeur de l'écart entre deux ancres voisines dans un pays
 * couvert : au-delà, on n'est plus dans une région mal ancrée, on est dehors.
 */
export const MAX_REACH_KM = 150;

/** Kilomètres par degré de latitude. La longitude se corrige par le cosinus. */
export const KM_PER_DEGREE = 111.32;

/** Ancres à plat, dressées à la première question. */
let anchors = null;

function anchorIndex() {
  if (anchors) return anchors;
  anchors = [];
  for (const region of REGIONS) {
    for (const [lng, lat] of region.anchors) anchors.push({ region, lng, lat });
  }
  return anchors;
}

/**
 * Le dossier de la région d'un point, ou `null` hors de portée.
 *
 * Fonction pure et synchrone.
 *
 * @param {number} lng
 * @param {number} lat
 * @returns {Object|null} Un dossier de `REGIONS`.
 */
export function regionAt(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  // Un degré de longitude vaut moins qu'un degré de latitude dès qu'on quitte
  // l'équateur : sans ce facteur, l'Espagne est cherchée avec la règle du Ghana.
  const shrink = Math.cos((lat * Math.PI) / 180);
  const reach = MAX_REACH_KM / KM_PER_DEGREE;
  const maxSquared = reach * reach;

  let best = null;
  let bestSquared = Infinity;
  for (const anchor of anchorIndex()) {
    const dx = (lng - anchor.lng) * shrink;
    const dz = lat - anchor.lat;
    const squared = dx * dx + dz * dz;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = anchor.region;
    }
  }
  return bestSquared <= maxSquared ? best : null;
}

/**
 * Le dossier d'une région par son identifiant, ou `null`.
 *
 * C'est par là qu'une application impose une région plutôt que de suivre la
 * position — pour comparer deux pays au même endroit, ou tenir un décor sous
 * une région choisie.
 */
export function regionById(id) {
  return REGIONS.find((region) => region.id === id) ?? null;
}
