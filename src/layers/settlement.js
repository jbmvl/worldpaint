/*
 * settlement — ce que la donnée sait d'une agglomération, et ce qu'elle ignore.
 *
 * Deux questions distinctes : « suis-je dans un périmètre habité ? »
 * (`landuse`, périmètre administratif — englobe aussi prés et chemins sans
 * trottoir) et « y a-t-il des maisons ici ? » (empreintes `building`, un fait).
 * `collectBuiltUpAreas`/`pointInAreas` répondent à la première (un droit :
 * trottoir, éclairage, feux) ; `FabricIndex` à la seconde (un fait qui la
 * confirme). Une rue ne se compose que là où les deux concordent.
 *
 * ## La ville, qui n'est pas le bourg
 *
 * Une troisième question s'y ajoute, et elle n'est ni l'une ni l'autre :
 * **sommes-nous en ville ?** Un village est bâti et n'est pas une ville ; ce
 * qui vaut en centre-ville — le sol entièrement revêtu, les trottoirs OSM
 * relevés voie par voie qu'il faut jeter — serait faux dans un hameau, où le
 * chemin de terre entre deux fermes est le paysage lui-même.
 *
 * `UrbanMask` répond à celle-là, et tient en trois termes :
 *
 *   1. un **disque** autour d'un `place` de classe `city` ou `town` — la seule
 *      chose que la donnée dise du rang d'une agglomération ;
 *   2. l'emprise **bâtie** (`landuse`), qui donne la forme, le disque ne
 *      donnant que la portée ;
 *   3. moins le **vert urbain** — parc, cimetière, stade, terrain de jeu, bois
 *      de ville. Un parc en ville reste un parc : son herbe et ses allées de
 *      terre ne sont pas un défaut de saisie.
 *
 * Le troisième terme est ce qui empêche la ville de tout absorber, et il est
 * lu deux fois : ici, en test de point, et par la carte d'occupation du sol,
 * en ordre de peinture (voir `groundClassMap`).
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
 * Classes `landuse` qui décrivent du vert **au milieu du bâti** : le sol y
 * reste du sol, quelle que soit la ville autour.
 *
 * `groundClassMap` les peint déjà en herbe ; la liste est reprise ici parce
 * que la question posée n'est pas la même — là-bas c'est une matière, ici
 * c'est un retrait de périmètre.
 */
export const URBAN_GREEN_LANDUSE = new Set(['cemetery', 'pitch', 'playground', 'stadium']);

/**
 * Classes `landcover` qui décrivent le vert d'une ville : le parc de ville
 * arrive par là (`leisure=park|garden|village_green|recreation_ground` sont
 * rangés en classe `grass` par le schéma OpenMapTiles — voir
 * `groundClassMap.CLASS_SOURCE_LAYERS`), le bois de ville aussi.
 */
export const URBAN_GREEN_LANDCOVER = new Set(['grass', 'wood', 'wetland']);

/**
 * Le vert urbain d'un jeu de tuiles, en anneaux métriques : ce qu'une ville
 * n'absorbe pas.
 *
 * @param {Object} source Instance `VectorTileSource`.
 * @param {Array} tiles   Tuiles à parcourir.
 * @param {Object} frame  Repère local de la bulle.
 * @returns {Array<Array<{x:number,z:number}>>}
 */
export function collectUrbanGreens(source, tiles, frame) {
  const areas = [];
  if (!source || !frame) return areas;
  const { origin, scale, zoom } = frame;

  const take = (layer, accept) => {
    source.forEachFeature(layer, tiles, (geometry, properties) => {
      if (!accept(properties.class)) return;
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
  };

  take('landuse', (klass) => URBAN_GREEN_LANDUSE.has(klass));
  take('landcover', (klass) => URBAN_GREEN_LANDCOVER.has(klass));

  return areas;
}

/**
 * Portée d'une agglomération autour de son point nommé, en mètres, par classe
 * `place`. Ce n'est pas un rayon d'agglomération — la donnée n'en porte
 * aucun — mais la distance au-delà de laquelle le point ne dit plus rien.
 * L'emprise bâtie donne la forme ; ceci ne donne que jusqu'où la chercher.
 *
 * Une classe absente de cette table (village, hameau) ne fait pas de ville :
 * c'est exactement la distinction qu'on cherchait.
 */
export const URBAN_PLACE_RADIUS_M = { city: 3000, town: 1200 };

/**
 * « Sommes-nous en ville ? » — voir l'en-tête du module.
 *
 * Ne collecte rien : on lui passe ce qui a déjà été lu pour d'autres raisons
 * (les emprises bâties servent aussi au mobilier et à la voirie, les lieux
 * nommés aux panneaux d'agglomération). Sans lieu de classe `city`/`town`
 * dans la fenêtre, `covers` répond non partout, et tout le décor retombe sur
 * le comportement de campagne.
 */
export class UrbanMask {
  /**
   * @param {Object} [options]
   * @param {Array<Array<{x:number,z:number}>>} [options.builtUp] `collectBuiltUpAreas`.
   * @param {Array<Array<{x:number,z:number}>>} [options.greens]  `collectUrbanGreens`.
   * @param {Array<{x:number,z:number,class:string}>} [options.places] `collectPlaceNames`.
   * @param {Object} [options.radii] Portées par classe (`URBAN_PLACE_RADIUS_M`).
   */
  constructor({ builtUp = [], greens = [], places = [], radii = URBAN_PLACE_RADIUS_M } = {}) {
    /** @type {Array<{x:number,z:number,radius:number}>} */
    this.discs = [];
    for (const place of places || []) {
      const radius = radii[place?.class];
      if (radius > 0) this.discs.push({ x: place.x, z: place.z, radius });
    }

    // Les anneaux sont **bornés aux disques**, et gardent leur boîte.
    //
    // Ce n'est pas une optimisation de confort : `covers` est posée par sommet
    // de ligne de chaussée, plusieurs milliers de fois par reconstruction, et
    // le vert relevé dans une fenêtre de quatre kilomètres compte tous les
    // bois et toutes les prairies qu'elle porte. Sans ce tri, chaque sommet
    // paierait un lancer de rayon sur des centaines d'anneaux dont aucun n'est
    // en ville. Ce qui reste tient en quelques dizaines.
    this.builtUp = keepNearDiscs(builtUp, this.discs);
    this.greens = keepNearDiscs(greens, this.discs);
    this._builtUpBoxes = this.builtUp.map(ringBox);
    this._greenBoxes = this.greens.map(ringBox);
  }

  /** Vrai si la fenêtre porte au moins une agglomération de rang urbain. */
  get any() {
    return this.discs.length > 0;
  }

  /** Vrai si le point est à portée d'une ville ou d'un bourg nommé. */
  nearCity(x, z) {
    for (const disc of this.discs) {
      if (Math.hypot(disc.x - x, disc.z - z) <= disc.radius) return true;
    }
    return false;
  }

  /**
   * Vrai si le point est en ville : à portée d'une agglomération, dans une
   * emprise bâtie, et hors du vert urbain.
   *
   * Les trois termes sont posés dans l'ordre de leur coût : quelques disques,
   * puis les emprises bâties, puis le vert — et chaque anneau est écarté par sa
   * boîte avant qu'on n'y lance un rayon.
   */
  covers(x, z) {
    if (this.discs.length === 0) return false;
    if (!this.nearCity(x, z)) return false;
    if (!inBoxedRings(this.builtUp, this._builtUpBoxes, x, z)) return false;
    return !inBoxedRings(this.greens, this._greenBoxes, x, z);
  }
}

/** Boîte englobante d'un anneau métrique. */
function ringBox(ring) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Les anneaux dont la boîte touche l'un des disques. */
function keepNearDiscs(rings, discs) {
  if (!Array.isArray(rings) || discs.length === 0) return [];
  return rings.filter((ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    const box = ringBox(ring);
    return discs.some(
      (disc) =>
        disc.x + disc.radius >= box.minX &&
        disc.x - disc.radius <= box.maxX &&
        disc.z + disc.radius >= box.minZ &&
        disc.z - disc.radius <= box.maxZ
    );
  });
}

/** `pointInAreas`, mais chaque anneau est écarté par sa boîte d'abord. */
function inBoxedRings(rings, boxes, x, z) {
  for (let i = 0; i < rings.length; i++) {
    const box = boxes[i];
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    if (pointInAreas([rings[i]], x, z)) return true;
  }
  return false;
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
