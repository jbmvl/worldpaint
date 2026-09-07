/*
 * waterLayer — où est l'eau, et à quelle altitude. Ce module ne dessine plus
 * rien : il n'existe pas de surface d'eau dans la scène.
 *
 * ## Pourquoi il n'y a plus de nappe
 *
 * Trois tentatives ont échoué, toutes pour la même raison. Creuser une cuvette
 * sous chaque nappe ouvrait une gorge dès que le polygone descendait une
 * pente. Poser une nappe plane à un niveau tiré du MNT la laissait quelques
 * centimètres sous le sol. La plaquer sur le terrain marchait de près, mais
 * pas de loin : la nappe lisait l'altitude dans le champ du MNT quand le
 * terrain, lui, est maillé plus grossièrement à mesure qu'il s'éloigne — deux
 * lectures de la même chose, qui divergent de plusieurs mètres sur un versant
 * raide. Un lac de montagne passait dessous et disparaissait.
 *
 * La cause commune : **le MNT ne décrit pas le fond d'un lac**. Sous une
 * nappe, l'altitude qu'il donne *est* la surface de l'eau. Terrain et eau sont
 * donc la même surface, et vouloir en poser une seconde par-dessus revient à
 * demander laquelle des deux l'emporte — question qui n'a pas de réponse.
 *
 * ## Une seule surface
 *
 * L'eau est donc devenue une **matière du terrain**, comme la lande ou
 * l'éboulis : `groundClassMap` peint les nappes et les lits de cours d'eau
 * dans la carte des couvertures, `terrainMaterial` les rend — couleur propre
 * presque noire, ciel renvoyé au ras, rides animées. Un seul relief, une seule
 * lecture d'altitude, aucun conflit de profondeur possible, et le lit d'un
 * cours d'eau se voit exactement là où la carte le dit.
 *
 * Ce qui reste ici : l'index qui répond « y a-t-il de l'eau sous ce point, et
 * à quelle hauteur », dont les ponts ont besoin pour dégager leur travée
 * (`roadNetwork`). Rien d'autre.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { WaterIndex } from './waterIndex.js';
import { defaultTheme } from '../themes/default.js';

/** Couches source des tuiles vectorielles. */
export const WATER_SOURCE_LAYER = 'water';
export const WATERWAY_SOURCE_LAYER = 'waterway';

/** Portée maximale autour de l'observateur, en mètres (plafond ; `rebuild` la resserre sur le rayon réel de la bulle). */
export const WATER_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const WATER_REBUILD_M = 250;
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;

/**
 * Demi-largeur d'un cours d'eau linéaire, ou `null` s'il n'a pas de surface
 * d'eau visible. Un cours d'eau souterrain n'en a pas ; un cours d'eau
 * intermittent, la plupart du temps, non plus. Fonction pure.
 */
export function waterwayStyleFor(properties = {}, waterways = defaultTheme.water.waterways) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.intermittent === 1 || properties.intermittent === true) return null;
  const width = waterways[properties.class];
  return width ? { halfWidth: width / 2 } : null;
}

/** Vrai si une surface d'eau compte (les piscines produisent des confettis bleus à cette échelle). */
export function isDrawableWater(properties = {}) {
  if (properties.brunnel === 'tunnel') return false;
  return properties.class !== 'swimming_pool';
}

/**
 * Anneaux d'une géométrie surfacique, contour puis trous.
 * @returns {Array<Array<Array<[number, number]>>>} une entrée par polygone.
 */
export function waterPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/**
 * Vrai si la boîte englobante d'un anneau rencontre le carré de portée
 * (un test sur les seuls sommets manquerait un grand lac longé par la rive).
 */
export function boundsIntersect(points, centerX, centerZ, radius) {
  if (!points.length) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return (
    minX <= centerX + radius &&
    maxX >= centerX - radius &&
    minZ <= centerZ + radius &&
    maxZ >= centerZ - radius
  );
}

/**
 * Recense les nappes autour de l'observateur et publie l'index qui dit, sous
 * un point donné, à quelle altitude est l'eau.
 */
export class WaterLayer {
  /**
   * @param {Object} options
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} [options.theme]
   */
  constructor({ bubble, theme = defaultTheme }) {
    this.theme = theme;
    this.bubble = bubble;
    this.disposed = false;
    /** Nombre de nappes retenues à la dernière reconstruction. */
    this.count = 0;
    this._anchor = null;
    this._frame = null;
    /** Nappes publiées à l'usage des ponts (`WaterIndex`), ou `null` avant la première construction. @type {WaterIndex|null} */
    this.index = null;
  }

  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= WATER_REBUILD_M;
  }

  /**
   * Reconstruit l'index depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si de l'eau a été trouvée.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const bubble = this.bubble;
    // La bulle rétrécit avec la latitude : sans ce plafond, l'index porterait au-delà du relief chargé.
    const radius = Math.min(WATER_RADIUS_M, bubble.radiusMeters || WATER_RADIUS_M);

    // Altitude naturelle, terrassements exclus : la cote de l'eau est celle du
    // sol sous elle (c'est tout l'objet de ce module), pas celle du déblai
    // d'une route qui la longe.
    const levelAt = (x, z) => {
      const h = bubble.rawSurfaceElevationAtLocal(x, z, NaN);
      return Number.isFinite(h) ? h * bubble.verticalScale : NaN;
    };

    const surfaces = [];
    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (surfaces.length >= WATER_MAX_POLYGONS) return;
      if (!isDrawableWater(properties)) return;

      for (const rings of waterPolygons(geometry)) {
        if (surfaces.length >= WATER_MAX_POLYGONS) break;
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const outer = this._toLocal(rings[0]);
        if (outer.length < 3) continue;
        if (!boundsIntersect(outer, here.x, here.z, radius)) continue;

        const holes = [];
        for (let i = 1; i < rings.length; i++) {
          const hole = this._toLocal(rings[i]);
          if (hole.length >= 3) holes.push(hole);
        }

        surfaces.push({ rings: [outer, ...holes], levelAt });
      }
    });

    this.index = new WaterIndex(surfaces);
    this.count = surfaces.length;
    this._anchor = { x: here.x, z: here.z };
    this._frame = bubble.frame;
    return this.count > 0;
  }

  /** Passage lng/lat → mètres locaux. */
  _toLocal(ring) {
    const { origin, scale, zoom } = this.bubble.frame;
    const points = [];
    for (const [lng, lat] of ring) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      });
    }
    return points;
  }

  dispose() {
    this.disposed = true;
    this.index = null;
  }
}
