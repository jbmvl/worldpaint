/*
 * domesticFauna — le chat et le chien du bâti, pas ceux du pré ou du bois.
 *
 * Contrairement au troupeau (`parcelFauna.placeHerd`), qui vit sur une
 * parcelle agricole, un animal domestique se pose devant une **maison** — la
 * liste que `buildingLayer` publie pour `gardenLayer`, reprise ici pour la
 * même raison : c'est le seul endroit où une maison, sa forme et sa position
 * existent ensemble.
 *
 * Trois choses distinguent ces bêtes du reste de la faune :
 *
 * - elles ne se posent que là où le lieu nommé le plus proche (`settlement`)
 *   le justifie — un chat en petite ville (`place=town`), un chat ou un chien
 *   en hameau (`place=hamlet`) — jamais en pleine campagne ni en grande ville ;
 * - un chat sur trois est « craintif » (`flee`) : `faunaLayer` le fait fuir
 *   quand l'observateur passe à portée. Le tirage se fait ici, une fois pour
 *   toutes, sur la position de la maison — pas à chaque approche, ce qui
 *   romprait le déterminisme spatial du projet ;
 * - ni leur point de pose ni leur circuit n'entrent dans une maison, la leur
 *   ou une voisine : une bête cachée par un toit coûte sans rien montrer.
 */

import { nearestNamedPlace } from '../settlement.js';
import { placeFauna } from './parcelFauna.js';
import { randomAt } from '../furniturePlacement.js';
import { FURNITURE_LIMITS } from './catalog.js';

/** Portée de recherche du lieu nommé le plus proche d'une maison, en mètres. */
export const PET_PLACE_REACH_M = 900;

/** Part des maisons d'une petite ville qui abritent un chat. */
export const TOWN_CAT_ODDS = 0.06;

/** Part des maisons d'un hameau qui abritent un chat ou un chien. */
export const HAMLET_PET_ODDS = 0.11;

/** Part de chiens parmi les animaux d'un hameau, le reste étant des chats. */
export const HAMLET_DOG_SHARE = 0.35;

/**
 * Part des chats qui s'enfuient à l'approche de l'observateur (voir
 * `faunaLayer._checkFlee`). Tirée par maison, une fois pour toutes : ce n'est
 * pas qu'un chat fuit une fois sur trois qu'on le croise, c'est qu'un chat sur
 * trois est de ceux qui fuient.
 */
export const PET_FLEE_ODDS = 1 / 3;

/** Écart à la façade, en mètres. */
export const PET_DOORSTEP_M = [2, 6];

/** Marge autour d'un mur en deçà de laquelle une bête est tenue pour dedans. */
export const PET_WALL_CLEAR_M = 0.8;

/**
 * Vrai si le point tombe dans le rectangle orienté d'une maison, marge
 * comprise. Toutes les maisons comptent, pas seulement celle de la bête : en
 * tissu serré, la cour de l'une est souvent le salon de sa voisine.
 */
export function insideAnyHouse(houses, x, z, clear = PET_WALL_CLEAR_M) {
  for (const { box } of houses) {
    if (!box) continue;
    const dx = x - box.cx;
    const dz = z - box.cz;
    const reach = box.long + box.short + clear;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
    const cos = Math.cos(box.angle);
    const sin = Math.sin(box.angle);
    const u = dx * cos + dz * sin;
    const v = -dx * sin + dz * cos;
    if (Math.abs(u) <= box.long + clear && Math.abs(v) <= box.short + clear) return true;
  }
  return false;
}

/** Pas d'échantillonnage le long d'un trajet, en mètres. */
const PET_PATH_STEP_M = 0.5;

/** Vrai si aucun point du circuit, trajets compris, n'est refusé par `blocked`. */
export function circuitClear(circuit, blocked, step = PET_PATH_STEP_M) {
  const { stations } = circuit;
  for (let i = 0; i < stations.length; i++) {
    const from = stations[i];
    const to = stations[(i + 1) % stations.length];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      if (blocked(from.x + (to.x - from.x) * u, from.z + (to.z - from.z) * u)) return false;
    }
  }
  return true;
}

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

    // Devant l'un des deux longs pans, à quelques mètres de la façade : le
    // demi-côté court seul ne suffit pas à sortir le long des pignons.
    const box = house.box;
    const angle = box?.angle || 0;
    const [minM, maxM] = PET_DOORSTEP_M;
    const across = (box?.short || 4) + minM + randomAt(house.x, house.z, 347) * (maxM - minM);
    const along = (randomAt(house.x, house.z, 341) * 2 - 1) * (box?.long || 4);
    const side = randomAt(house.x, house.z, 343) < 0.5 ? -1 : 1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = house.x + along * cos - side * across * sin;
    const pz = house.z + along * sin + side * across * cos;
    if (layer._onRoad(px, pz)) continue;
    if (insideAnyHouse(houses, px, pz)) continue;

    const flee = kind === 'cat' && randomAt(house.x, house.z, 353) < PET_FLEE_ODDS;
    const scale = 0.85 + randomAt(house.x, house.z, 359) * 0.3;
    const keepOut = (sx, sz) => insideAnyHouse(houses, sx, sz);
    if (!placeFauna(layer, kind, { x: px, z: pz, scale, flee, keepOut })) continue;
    // `keepOut` ne voit que les stations : un trajet qui les relie peut encore
    // couper l'angle d'une maison, et la bête est alors retirée.
    if (!circuitClear(layer.fauna[layer.fauna.length - 1].circuit, keepOut)) {
      layer.fauna.pop();
      continue;
    }
    placed++;
  }

  return placed;
}
