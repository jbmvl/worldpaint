/*
 * settlement — ce que la donnée sait d'une agglomération, et ce qu'elle ignore.
 *
 * Deux questions distinctes : « suis-je dans un périmètre habité ? »
 * (`landuse`, périmètre administratif — englobe aussi prés et chemins sans
 * trottoir) et « y a-t-il des maisons ici ? » (empreintes `building`, un fait).
 * `collectBuiltUpAreas`/`pointInAreas` répondent à la première (un droit :
 * trottoir, éclairage, feux) ; `FabricIndex` à la seconde (un fait qui la
 * confirme). Une rue ne se compose que là où les deux concordent.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { BUILT_UP_CLASSES } from './furniturePlacement.js';

/**
 * Emprises habitées d'un jeu de tuiles, en anneaux métriques.
 * `BUILT_UP_CLASSES` vit dans `furniturePlacement` (premier utilisateur) : une
 * seule définition de « en ville » pour les deux modules.
 *
 * @param {Object} source Instance `VectorTileSource`.
 * @param {Array} tiles   Tuiles à parcourir.
 * @param {Object} frame  Repère local de la bulle.
 * @returns {Array<Array<{x:number,z:number}>>}
 */
export function collectBuiltUpAreas(source, tiles, frame) {
  const areas = [];
  if (!source || !frame) return areas;
  const { origin, scale, zoom } = frame;

  source.forEachFeature('landuse', tiles, (geometry, properties) => {
    if (!BUILT_UP_CLASSES.has(properties.class)) return;
    for (const ring of ringsOf(geometry)) {
      const local = [];
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        local.push({
          x: (lngToTileX(lng, zoom) - origin.x) * scale,
          z: (latToTileY(lat, zoom) - origin.y) * scale,
        });
      }
      if (local.length >= 3) areas.push(local);
    }
  });

  return areas;
}

/**
 * Classes `place` retenues comme de vraies agglomérations nommées. Exclut
 * `suburb`/`quarter`/`neighbourhood`/`island`, que la couche porte aussi mais
 * qui sont des quartiers d'une grande ville, pas des agglomérations séparées.
 */
export const SETTLEMENT_PLACE_CLASSES = new Set(['city', 'town', 'village', 'hamlet']);

/**
 * Points nommés d'un jeu de tuiles — villes, bourgs, villages, hameaux. Seule
 * source associant un nom à une agglomération (`landuse` n'en porte pas) —
 * voir `nearestNamedPlace`.
 *
 * @param {Object} source Instance `VectorTileSource`.
 * @param {Array} tiles   Tuiles à parcourir.
 * @param {Object} frame  Repère local de la bulle.
 * @returns {Array<{x:number,z:number,name:string,class:string}>}
 */
export function collectPlaceNames(source, tiles, frame) {
  const places = [];
  if (!source || !frame) return places;
  const { origin, scale, zoom } = frame;

  source.forEachFeature('place', tiles, (geometry, properties) => {
    if (geometry?.type !== 'Point') return;
    if (!SETTLEMENT_PLACE_CLASSES.has(properties.class)) return;
    const name = properties.name;
    if (!name) return;
    const [lng, lat] = geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    places.push({
      x: (lngToTileX(lng, zoom) - origin.x) * scale,
      z: (latToTileY(lat, zoom) - origin.y) * scale,
      name,
      class: properties.class,
    });
  });

  return places;
}

/**
 * Le lieu nommé le plus proche d'un point, dans un rayon donné, ou `null`.
 * Parcours linéaire : une bulle n'en porte jamais plus de quelques dizaines.
 *
 * @param {Array<{x:number,z:number,name:string}>} places
 * @param {number} x
 * @param {number} z
 * @param {number} maxDistance En mètres.
 * @returns {{name:string,distance:number}|null}
 */
export function nearestNamedPlace(places, x, z, maxDistance) {
  if (!places) return null;
  let best = null;
  let bestDistance = maxDistance;
  for (const place of places) {
    const distance = Math.hypot(place.x - x, place.z - z);
    if (distance <= bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best ? { name: best.name, distance: bestDistance } : null;
}

/** Anneaux extérieurs d'une géométrie surfacique GeoJSON. Fonction pure. */
export function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((rings) => rings[0]).filter(Boolean);
  return [];
}

/**
 * Vrai si le point tombe dans l'une des emprises (lancer de rayon pair-impair).
 *
 * @param {Array<Array<{x:number,z:number}>>} areas
 * @param {number} x
 * @param {number} z
 */
export function pointInAreas(areas, x, z) {
  if (!areas) return false;
  for (const ring of areas) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const zi = ring[i].z;
      const zj = ring[j].z;
      if (zi > z !== zj > z) {
        const t = (z - zi) / (zj - zi || 1);
        if (x < ring[i].x + t * (ring[j].x - ring[i].x)) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/** Côté d'une maille de l'index, en mètres. */
export const FABRIC_CELL_M = 32;

/**
 * Index spatial des empreintes bâties : combien de bâtiments autour d'un
 * point. Une maille plutôt qu'un parcours linéaire (la question est posée
 * plusieurs milliers de fois par reconstruction). Ne retient qu'un centre par
 * bâtiment — la question posée est « est-ce bâti », pas « qu'y a-t-il là ».
 */
export class FabricIndex {
  /** @param {Array<{x:number,z:number}>} footprints Centres publiés par `buildingLayer`. */
  constructor(footprints = []) {
    /** @type {Map<number, Array<{x:number,z:number}>>} */
    this.cells = new Map();
    this.count = 0;

    for (const point of footprints) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) continue;
      const key = cellKey(Math.floor(point.x / FABRIC_CELL_M), Math.floor(point.z / FABRIC_CELL_M));
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(point);
      else this.cells.set(key, [point]);
      this.count++;
    }
  }

  /**
   * Nombre de bâtiments dans un disque, plafonné (les appelants ne demandent
   * en général qu'un seuil, pas un compte exact).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} radius Rayon, en mètres.
   * @param {number} [limit] Arrêt dès ce compte atteint.
   * @returns {number}
   */
  countWithin(x, z, radius, limit = Infinity) {
    if (this.count === 0 || radius <= 0) return 0;
    const r2 = radius * radius;
    const minX = Math.floor((x - radius) / FABRIC_CELL_M);
    const maxX = Math.floor((x + radius) / FABRIC_CELL_M);
    const minZ = Math.floor((z - radius) / FABRIC_CELL_M);
    const maxZ = Math.floor((z + radius) / FABRIC_CELL_M);
    let found = 0;

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const point of bucket) {
          const dx = point.x - x;
          const dz = point.z - z;
          if (dx * dx + dz * dz > r2) continue;
          found++;
          if (found >= limit) return found;
        }
      }
    }
    return found;
  }
}

/** Clé de maille : deux entiers signés dans un seul nombre. */
function cellKey(cx, cz) {
  return cx * 73856093 + cz * 19349663;
}
