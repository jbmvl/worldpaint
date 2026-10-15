/*
 * vectorTileSource — tuiles vectorielles chargées pour la bulle. Le chargement
 * est piloté par la bulle ; l'application fournit les URL, le zoom maximal et
 * peut partager son transport. Décodage via `@mapbox/vector-tile`, dont `toGeoJSON` rend
 * directement la géométrie en longitude/latitude. Les marges des routes et
 * bâtiments sont retirées pour ne pas construire deux fois leurs surfaces.
 */

// pbf 5 et @mapbox/vector-tile 3 sont des modules ESM à exports nommés : pas
// d'import par défaut, contrairement à leurs versions CommonJS d'avant.
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { tileKey, fillTileUrl, tileXToLng, tileYToLat } from './tileMath.js';
import { tileRequest } from './tileRequest.js';
import { geometryInTile } from './tileGeometry.js';

/** Zoom visé. 14 est le maximum servi par la plupart des jeux OpenMapTiles. */
export const VECTOR_ZOOM = 14;

/**
 * Emprise géographique d'une tuile, en longitude/latitude. Sert à reconnaître
 * les bords de découpe des polygones d'occupation du sol (tranchés à la
 * frontière de chaque tuile), pour ne pas dessiner de haie le long d'une
 * limite qui n'existe pas.
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
   * @param {Function} [options.fetchTile] Transport compatible fetch, partagé par l'application.
   * @param {number} [options.timeoutMs] Délai réseau maximal.
   */
  constructor({ tiles, zoom = VECTOR_ZOOM, maxTiles = 24, fetchTile = (...args) => fetch(...args), timeoutMs = 15000 }) {
    this.templates = tiles;
    this.zoom = zoom;
    this.maxTiles = maxTiles;
    /** @type {Map<string, Object|null>} tuiles décodées (null = indisponible) */
    this.tiles = new Map();
    this.pending = new Map();
    this.disposed = false;
    this.fetchTile = fetchTile;
    this.timeoutMs = timeoutMs;
    this._abort = new AbortController();
  }

  /** Charge une tuile. Résout `null` si elle est indisponible (trou toléré). */
  async load(x, y, signal) {
    if (this.disposed || signal?.aborted) return null;
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
      const request = tileRequest({ signal, lifetime: this._abort.signal, timeoutMs: this.timeoutMs });
      try {
        const res = await this.fetchTile(fillTileUrl(template, this.zoom, x, y), {
          signal: request.signal,
          mode: 'cors',
          credentials: 'omit',
        });
        if (this.disposed || request.signal.aborted) return null;
        // 404 = tuile sans donnée, normal, mis en cache ; tout autre code est
        // un incident passager qu'on ne veut pas figer en cache.
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
        request.release();
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
   * longitude/latitude et l'emprise de la tuile d'origine.
   *
   * Routes et bâtiments sont limités à l’emprise de leur tuile. Les autres
   * couches conservent leur marge ; `bounds` permet d’écarter les bords de découpe.
   *
   * `keep(properties)`, s'il est donné, écarte une entité avant que sa
   * géométrie ne soit décodée : une couche `poi` de ville en compte des
   * dizaines de milliers, dont on ne garde que quelques classes.
   */
  forEachFeature(sourceLayer, tiles, callback, keep = null) {
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
          const feature = layer.feature(i);
          if (keep && !keep(feature.properties || {})) continue;
          geojson = feature.toGeoJSON(entry.x, entry.y, entry.z);
        } catch (e) {
          continue;
        }
        if (!geojson?.geometry) continue;
        const geometry = sourceLayer === 'transportation' || sourceLayer === 'building'
          ? geometryInTile(geojson.geometry, bounds) : geojson.geometry;
        if (geometry) callback(geometry, geojson.properties || {}, bounds);
      }
    }
  }

  /**
   * Tuiles en cache de la liste, telles que décodées (`{ tile, x, y, z }`) :
   * pour qui lit une couche en coordonnées de tuile, sans la convertir.
   */
  entriesOf(tiles) {
    const entries = [];
    for (const { x, y } of tiles) {
      const entry = this.tiles.get(tileKey(this.zoom, x, y));
      if (entry) entries.push(entry);
    }
    return entries;
  }

  dispose() {
    this.disposed = true;
    this._abort.abort();
    this.tiles.clear();
    this.pending.clear();
  }
}
