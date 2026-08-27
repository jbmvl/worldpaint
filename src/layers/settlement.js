/*
 * settlement — ce que la donnée sait d'une agglomération, et ce qu'elle ignore.
 * ---------------------------------------------------------------------------
 * Deux questions se posent partout dans le décor, et elles n'ont pas la même
 * réponse :
 *
 *   1. « suis-je dans un périmètre habité ? »  → les emprises `landuse` ;
 *   2. « y a-t-il des maisons ici ? »          → les empreintes de `building`.
 *
 * Les confondre est exactement ce qui produit un décor faux. Un
 * `landuse=residential` est un **périmètre administratif** : il englobe le
 * centre-bourg, mais aussi les prés qui l'entourent, les fonds de jardin, les
 * terrains à bâtir et les chemins qui n'ont jamais vu un trottoir. Décider quoi
 * que ce soit de physique sur ce seul critère revient à peindre une commune
 * entière de la couleur de sa mairie.
 *
 * D'où ce module, et sa séparation en deux :
 *
 *   • `collectBuiltUpAreas` / `pointInAreas` répondent à la question 1. C'est
 *     un **droit** : le trottoir, l'éclairage, les feux n'ont de sens que dans
 *     un périmètre habité, et rien de tout ça ne se pose hors de lui.
 *   • `FabricIndex` répond à la question 2. C'est un **fait** : elle compte les
 *     bâtiments réellement présents autour d'un point, à la distance qu'on lui
 *     demande. Le droit ouvre la possibilité, le fait la confirme.
 *
 * Une rue ne se compose donc que là où les deux concordent. C'est ce qui
 * distingue la traversée d'un village — bâtie des deux côtés, donc bordée — de
 * la route qui longe le terrain de foot du même village : même `landuse`, même
 * classe de chaussée, et pourtant pas la même rue.
 *
 * Rien ici n'est de la direction artistique : ce module ne décide d'aucune
 * couleur et d'aucune cote. Il ne dit que ce que la géographie porte.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { BUILT_UP_CLASSES } from './furniturePlacement.js';

/**
 * Emprises habitées d'un jeu de tuiles, en anneaux métriques.
 *
 * `BUILT_UP_CLASSES` vit dans `furniturePlacement` parce que le mobilier s'en
 * servait le premier ; le tri est le même ici, et le dédoubler ferait diverger
 * deux définitions de « en ville » qui doivent rester une seule.
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

/** Anneaux extérieurs d'une géométrie surfacique GeoJSON. Fonction pure. */
export function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((rings) => rings[0]).filter(Boolean);
  return [];
}

/**
 * Vrai si le point tombe dans l'une des emprises. Lancer de rayon pair-impair,
 * anneau par anneau. Fonction pure.
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
 * Index spatial des empreintes bâties : combien de bâtiments autour d'un point.
 *
 * Une maille plutôt qu'un parcours linéaire parce que la question est posée
 * plusieurs milliers de fois par reconstruction — deux fois par ligne de
 * chaussée, une par côté —, et qu'un village en compte quelques centaines.
 *
 * L'index ne retient qu'un centre par bâtiment : ni sa forme, ni sa taille. Ce
 * qu'on lui demande n'est pas « qu'y a-t-il là » mais « est-ce bâti », et un
 * centre suffit à cette question-là.
 */
export class FabricIndex {
  /**
   * @param {Array<{x:number,z:number}>} footprints Centres publiés par
   *        `buildingLayer`. Une liste vide donne un index qui répond zéro
   *        partout, ce qui est la bonne réponse quand rien n'est bâti.
   */
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
   * Nombre de bâtiments dans un disque, plafonné.
   *
   * Le plafond n'est pas une optimisation : les appelants ne demandent jamais
   * « combien » mais « au moins deux ? », et compter les quarante bâtiments
   * d'un centre-bourg pour répondre à ça serait du travail jeté.
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
