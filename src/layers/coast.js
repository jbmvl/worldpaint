/*
 * coast — à quelle distance est la mer.
 *
 * Une interprétation, pas une couche : elle lit les nappes `water` de classe
 * `ocean` des tuiles vectorielles et ne pose rien. Une rivière, un lac ou un
 * étang ne sont pas la mer — même règle que pour les phares
 * (`furniture/landmarks.js`).
 *
 * Une nappe recoupée par le bord d'une tuile garde ce bord dans son contour.
 * Il est en pleine eau : depuis la terre, le point de la nappe le plus proche
 * reste sur le vrai rivage, et la distance mesurée n'en est pas faussée.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { WATER_SOURCE_LAYER } from '../terrain/groundClassMap.js';
import { pointInRing } from './furniturePlacement.js';

/** Distance d'un point à un segment, en mètres. Fonction pure. */
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/**
 * Distance d'un point à la mer la plus proche, en mètres : 0 sur l'eau,
 * `Infinity` si aucun anneau n'est fourni. Fonction pure.
 *
 * @param {Array<Array<{x:number,z:number}>>} rings Contours extérieurs des nappes de mer.
 * @param {{x:number,z:number}} here
 */
export function seaDistance(rings, here) {
  let best = Infinity;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    if (pointInRing(ring, here.x, here.z)) return 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = segmentDistance(here.x, here.z, ring[j], ring[i]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Distance de l'observateur à la mer relevée dans les tuiles.
 *
 * @param {Object} source Source vectorielle (`forEachFeature`).
 * @param {Array} tiles Tuiles couvrant la bulle.
 * @param {Object} frame Repère de la bulle.
 * @param {{x:number,z:number}} here Position locale de l'observateur.
 * @returns {number} Mètres, `Infinity` sans mer dans les tuiles.
 */
export function seaDistanceAt(source, tiles, frame, here) {
  const { origin, scale, zoom } = frame;
  const rings = [];
  source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
    if (properties.class !== 'ocean') return;
    const outers =
      geometry.type === 'Polygon'
        ? [geometry.coordinates[0]]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates.map((polygon) => polygon[0])
          : [];
    for (const ring of outers) {
      if (!Array.isArray(ring)) continue;
      rings.push(
        ring.map(([lng, lat]) => ({
          x: (lngToTileX(lng, zoom) - origin.x) * scale,
          z: (latToTileY(lat, zoom) - origin.y) * scale,
        }))
      );
    }
  });
  return seaDistance(rings, here);
}
