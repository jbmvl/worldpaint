/*
 * domesticFauna — le chat et le chien du bâti, pas ceux du pré ou du bois.
 *
 * Contrairement au troupeau (`parcelFauna.placeHerd`), qui vit sur une
 * parcelle agricole, un animal domestique se pose devant une **maison** — la
 * liste que `buildingLayer` publie pour `gardenLayer`, reprise ici pour la
 * même raison : c'est le seul endroit où une maison, sa forme et sa position
 * existent ensemble.
 *
 * Deux choses distinguent ces bêtes du reste de la faune :
 *
 * - elles ne se posent que là où le lieu nommé le plus proche (`settlement`)
 *   le justifie — un chat en petite ville (`place=town`), un chat ou un chien
 *   en hameau (`place=hamlet`) — jamais en pleine campagne ni en grande ville ;
 * - un chat sur trois est « craintif » (`flee`) : `faunaLayer` le fait fuir
 *   quand l'observateur passe à portée. Le tirage se fait ici, une fois pour
 *   toutes, sur la position de la maison — pas à chaque approche, ce qui
 *   romprait le déterminisme spatial du projet.
 */

import { nearestNamedPlace } from '../settlement.js';
import { placeFauna } from './parcelFauna.js';
import { randomAt } from '../furniturePlacement.js';
import { FURNITURE_LIMITS } from './catalog.js';

/** Portée de recherche du lieu nommé le plus proche d'une maison, en mètres. */
export const PET_PLACE_REACH_M = 900;

/** Part des maisons d'une petite ville qui abritent un chat. */
export const TOWN_CAT_ODDS = 0.12;

/** Part des maisons d'un hameau qui abritent un chat ou un chien. */
export const HAMLET_PET_ODDS = 0.22;

/** Part de chiens parmi les animaux d'un hameau, le reste étant des chats. */
export const HAMLET_DOG_SHARE = 0.35;

/**
 * Part des chats qui s'enfuient à l'approche de l'observateur (voir
 * `faunaLayer._checkFlee`). Tirée par maison, une fois pour toutes : ce n'est
 * pas qu'un chat fuit une fois sur trois qu'on le croise, c'est qu'un chat sur
 * trois est de ceux qui fuient.
 */
export const PET_FLEE_ODDS = 1 / 3;

/** Écart au pas de porte, en mètres — la bête ne se pose pas dans les murs. */
export const PET_DOORSTEP_M = [2, 6];

/**
 * Pose un chat ou un chien devant les maisons d'une petite ville ou d'un
 * hameau.
 *
 * @param {Object} layer `FurnitureLayer`, déjà pourvu de `_places`.
 * @param {Array<{x:number,z:number,box:Object}>} houses Publiées par
 *        `buildingLayer` (`this.buildings.houses`).
 * @returns {number} Bêtes posées.
 */
export function buildDomesticFauna(layer, houses) {
  if (!Array.isArray(houses) || houses.length === 0) return 0;
  let placed = 0;

  for (const house of houses) {
    if (placed >= FURNITURE_LIMITS.pets) break;

    const place = nearestNamedPlace(layer._places, house.x, house.z, PET_PLACE_REACH_M);
    if (!place) continue;

    let kind;
    if (place.class === 'town') {
      if (randomAt(house.x, house.z, 331) >= TOWN_CAT_ODDS) continue;
      kind = 'cat';
    } else if (place.class === 'hamlet') {
      if (randomAt(house.x, house.z, 331) >= HAMLET_PET_ODDS) continue;
      kind = randomAt(house.x, house.z, 337) < HAMLET_DOG_SHARE ? 'dog' : 'cat';
    } else {
      continue;
    }

    // Un point dans la cour plutôt qu'au centre de la maison : à quelques
    // mètres de la façade, dans une direction tirée au sort.
    const angle = randomAt(house.x, house.z, 341) * Math.PI * 2;
    const [minM, maxM] = PET_DOORSTEP_M;
    const reach = (house.box?.short || 4) + minM + randomAt(house.x, house.z, 347) * (maxM - minM);
    const px = house.x + Math.cos(angle) * reach;
    const pz = house.z + Math.sin(angle) * reach;
    if (layer._onRoad(px, pz)) continue;

    const flee = kind === 'cat' && randomAt(house.x, house.z, 353) < PET_FLEE_ODDS;
    const scale = 0.85 + randomAt(house.x, house.z, 359) * 0.3;
    placed += placeFauna(layer, kind, { x: px, z: pz, scale, flee });
  }

  return placed;
}
