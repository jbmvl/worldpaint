/*
 * vectorTileSource — les tuiles vectorielles, chargées pour la bulle.
 * -------------------------------------------------------------------
 * Le chargement est piloté par la **bulle** : c'est elle qui sait quelles
 * tuiles couvrent la scène, à sa portée et sous sa caméra à elle.
 *
 * L'application ne fournit qu'un gabarit d'URL (`{z}/{x}/{y}`) et un zoom
 * maximal. D'où elle les tient — un TileJSON, une carte 2D qui tourne à côté,
 * une constante — ne regarde pas ce module.
 *
 * Le décodage passe par `@mapbox/vector-tile`, l'implémentation de référence du
 * format. `VectorTileFeature.toGeoJSON(x, y, z)` rend la géométrie en
 * longitude/latitude, donc rien à reprojeter à la main.
 */

// pbf 5 et @mapbox/vector-tile 3 sont des modules ESM à exports nommés : pas
// d'import par défaut, contrairement à leurs versions CommonJS d'avant.
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { tileKey, fillTileUrl, tileXToLng, tileYToLat } from './tileMath.js';

/** Zoom visé. 14 est le maximum servi par la plupart des jeux OpenMapTiles. */
export const VECTOR_ZOOM = 14;

/**
 * Emprise géographique d'une tuile, en longitude/latitude.
 *
 * Elle sert à reconnaître les **bords de découpe** : les polygones d'occupation
 * du sol sont tranchés à la frontière de chaque tuile, et un contour suivi
 * naïvement dessinerait donc une haie le long d'une limite qui n'existe pas —
 * un quadrillage régulier en travers de la campagne, impossible à ne pas voir
 * une fois qu'on l'a remarqué. Fonction pure.
 *
 * @returns {{west:number, east:number, north:number, south:number}}
 */
export function tileBounds(x, y, z) {
  return {
    west: tileXToLng(x, z),
    east: tileXToLng(x + 1, z),
    north: tileYToLat(y, z),
    south: tileYToLat(y + 1, z),
  };
}

/**
 * Couvre un bloc de tuiles d'un zoom par les tuiles d'un zoom inférieur.
 * Fonction pure : c'est le genre de décalage de bits qu'on croit évident et
 * qu'on écrit à l'envers une fois sur deux.
 *
 * @param {number} x    Abscisse de tuile au zoom `fromZoom`.
 * @param {number} y
 * @param {number} half Demi-côté du bloc, en tuiles du zoom `fromZoom`.
 * @param {number} fromZoom
 * @param {number} toZoom Zoom cible, inférieur ou égal.
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function coveringTiles(x, y, half, fromZoom, toZoom) {
  const zoom = Math.min(fromZoom, toZoom);
  const shift = fromZoom - zoom;
  const minX = (x - half) >> shift;
  const maxX = (x + half) >> shift;
  const minY = (y - half) >> shift;
  const maxY = (y + half) >> shift;
  const span = Math.pow(2, zoom);

  const out = [];
  for (let ty = minY; ty <= maxY; ty++) {
    if (ty < 0 || ty >= span) continue;
    for (let tx = minX; tx <= maxX; tx++) {
      out.push({ x: ((tx % span) + span) % span, y: ty, z: zoom });
    }
  }
  return out;
}

export class VectorTileSource {
  /**
   * @param {Object} options
   * @param {string[]} options.tiles   Gabarits d'URL.
   * @param {number} options.zoom      Zoom des tuiles à charger.
   * @param {number} [options.maxTiles] Cache LRU.
   */
  constructor({ tiles, zoom = VECTOR_ZOOM, maxTiles = 24 }) {
    this.templates = tiles;
    this.zoom = zoom;
    this.maxTiles = maxTiles;
    /** @type {Map<string, Object|null>} tuiles décodées (null = indisponible) */
    this.tiles = new Map();
    this.pending = new Map();
    this.disposed = false;
  }

  /** Charge une tuile. Résout `null` si elle est indisponible (trou toléré). */
  async load(x, y, signal) {
    const key = tileKey(this.zoom, x, y);
    if (this.tiles.has(key)) {
      const cached = this.tiles.get(key);
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }
    if (this.pending.has(key)) return this.pending.get(key);

    const template = this.templates[Math.abs(x + y) % this.templates.length];
    const task = (async () => {
      try {
        const res = await fetch(fillTileUrl(template, this.zoom, x, y), {
          signal,
          mode: 'cors',
          credentials: 'omit',
        });
        // 404 sur une tuile sans donnée : c'est normal, pas une erreur, et le
        // vide se met en cache. Tout autre code est un incident passager —
        // le mettre en cache condamnerait cette tuile à rester vide jusqu'à son
        // éviction, et un trou de bâti au milieu d'une ville n'a alors plus
        // aucune explication visible.
        if (!res.ok) {
          if (res.status === 404) this._store(key, null);
          return null;
        }
        const buffer = await res.arrayBuffer();
        if (this.disposed) return null;
        const tile = new VectorTile(new PbfReader(new Uint8Array(buffer)));
        this._store(key, { tile, x, y, z: this.zoom });
        return this.tiles.get(key);
      } catch (e) {
        // Idem : une coupure réseau ne doit pas se graver dans le cache.
        if (e?.name !== 'AbortError') {
          console.warn('[vectorTiles] tuile indisponible', key, e?.message || e);
        }
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, task);
    return task;
  }

  /** Nombre de tuiles de la liste qui ne sont pas encore en cache. */
  missing(tiles) {
    let count = 0;
    for (const { x, y } of tiles) {
      if (!this.tiles.has(tileKey(this.zoom, x, y))) count++;
    }
    return count;
  }

  _store(key, value) {
    this.tiles.set(key, value);
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.keys().next().value;
      this.tiles.delete(oldest);
    }
  }

  /**
   * Parcourt les entités d'une couche source, sur les tuiles données.
   * `callback(geometry, properties, bounds)` reçoit la géométrie en
   * longitude/latitude, et l'emprise de la tuile dont elle provient.
   *
   * Les entités sont découpées par les tuiles : une même route ou une même
   * bâtisse revient d'une tuile à l'autre. C'est à l'appelant de dédoublonner
   * s'il en a besoin — et, pour les contours, d'écarter les bords de découpe à
   * l'aide de `bounds`.
   */
  forEachFeature(sourceLayer, tiles, callback) {
    for (const { x, y } of tiles) {
      const entry = this.tiles.get(tileKey(this.zoom, x, y));
      if (!entry) continue;
      const layer = entry.tile.layers?.[sourceLayer];
      if (!layer) continue;

      // Une seule emprise par tuile : la recalculer par entité coûterait deux
      // projections inverses sur des milliers d'appels.
      const bounds = tileBounds(entry.x, entry.y, entry.z);

      for (let i = 0; i < layer.length; i++) {
        let geojson;
        try {
          geojson = layer.feature(i).toGeoJSON(entry.x, entry.y, entry.z);
        } catch (e) {
          continue;
        }
        if (geojson?.geometry) callback(geojson.geometry, geojson.properties || {}, bounds);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.tiles.clear();
    this.pending.clear();
  }
}
