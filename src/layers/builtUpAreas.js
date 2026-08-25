/*
 * builtUpAreas — où s'arrête la campagne.
 * --------------------------------------
 * C'est la seule information dont on dispose pour distinguer une rue d'une
 * route : la couche `landuse` du schéma OpenMapTiles, et ses classes
 * résidentielles ou commerciales. À l'intérieur, une voie est éclairée, n'a ni
 * poteau téléphonique ni haie, et surtout **pas de fossé** — un fossé de bord
 * de champ au milieu d'un bourg est le genre de détail qui trahit une carte
 * lue trop vite.
 *
 * Ce module existe parce que deux couches ont besoin de cette réponse et
 * doivent avoir la **même** : le mobilier, qui y décide de ce qu'il pose, et
 * le réseau routier, qui y décide si un tronçon porte un fossé — décision que
 * le terrain relit ensuite pour creuser (`roadCut`). La laisser privée au
 * mobilier obligerait la route à s'en inventer une autre, et le sol serait
 * creusé là où rien n'est dessiné.
 *
 * Volontairement sans état : deux appels sur les mêmes tuiles rendent les mêmes
 * anneaux, dans le même ordre.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { BUILT_UP_CLASSES } from './furniturePlacement.js';

/**
 * Emprises résidentielles et commerciales d'un jeu de tuiles, en anneaux
 * métriques dans le repère local.
 *
 * @param {Object} source Instance `VectorTileSource`.
 * @param {Array} tiles   Tuiles à parcourir.
 * @param {Object} frame  Repère local de la bulle (`bubble.frame`).
 * @returns {Array<Array<{x:number,z:number}>>}
 */
export function collectBuiltUpAreas(source, tiles, frame) {
  if (!source || !frame) return [];
  const areas = [];
  const { origin, scale, zoom } = frame;

  source.forEachFeature('landuse', tiles, (geometry, properties) => {
    if (!BUILT_UP_CLASSES.has(properties.class)) return;
    for (const ring of ringsOf(geometry)) {
      const local = ring.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));
      if (local.length >= 3) areas.push(local);
    }
  });

  return areas;
}

/** Anneaux extérieurs d'une géométrie surfacique. */
export function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]).filter(Boolean);
  return [];
}

/** Vrai si le point tombe dans l'une des emprises bâties. Fonction pure. */
export function inBuiltUpArea(areas, x, z) {
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
