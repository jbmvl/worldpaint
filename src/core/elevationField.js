/*
 * elevationField — champ d'altitude continu à partir de tuiles DEM Terrarium
 * (AWS elevation-tiles-prod). L'échantillonnage bilinéaire raisonne en espace
 * de pixels global au zoom courant, pas par tuile, pour qu'un point à la
 * frontière de deux tuiles lise les mêmes pixels des deux côtés (sinon
 * crevasse visible à chaque jointure).
 */

import { decodeTerrarium, decodeTerrainRgb, tileKey, fillTileUrl } from './tileMath.js';

/** Résolution d'une tuile DEM Terrarium. */
export const DEM_TILE_PIXELS = 256;

/** Source par défaut : Mapzen Terrarium hébergé par AWS Open Data (gratuit, sans clé). */
export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const DECODERS = {
  terrarium: decodeTerrarium,
  'terrain-rgb': decodeTerrainRgb,
};

/**
 * Décode une image de tuile DEM en Float32Array d'altitudes (mètres).
 * Passe par un canvas : c'est le seul moyen portable de lire les pixels d'une
 * image côté navigateur.
 */
function decodeTile(bitmap, encoding) {
  const decode = DECODERS[encoding] || decodeTerrarium;
  const size = DEM_TILE_PIXELS;

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const heights = new Float32Array(size * size);
  for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
    heights[i] = decode(data[p], data[p + 1], data[p + 2]);
  }
  return heights;
}

export class ElevationField {
  /**
   * @param {Object} options
   * @param {number} options.zoom      Zoom des tuiles DEM.
   * @param {string} [options.url]     Gabarit d'URL.
   * @param {string} [options.encoding] 'terrarium' (défaut) ou 'terrain-rgb'.
   * @param {number} [options.maxTiles] Taille du cache LRU (défaut 64 tuiles,
   *        soit ~17 Mo : le bloc courant en compte 25, le reste sert au
   *        recyclage quand l'observateur revient sur ses pas).
   */
  constructor({ zoom, url = TERRARIUM_URL, encoding = 'terrarium', maxTiles = 64 } = {}) {
    this.zoom = zoom;
    this.url = url;
    this.encoding = encoding;
    this.maxTiles = maxTiles;
    /** @type {Map<string, Float32Array>} tuiles décodées (ordre = récence LRU) */
    this.tiles = new Map();
    /** @type {Map<string, Promise<Float32Array|null>>} chargements en vol */
    this.pending = new Map();
    this.disposed = false;
  }

  /** Nombre de pixels sur un côté du monde, au zoom courant. */
  get worldPixels() {
    return Math.pow(2, this.zoom) * DEM_TILE_PIXELS;
  }

  has(x, y) {
    return this.tiles.has(tileKey(this.zoom, x, y));
  }

  /** Charge une tuile (idempotent). Résout `null` si la tuile est indisponible. */
  async load(x, y, signal) {
    const key = tileKey(this.zoom, x, y);
    const cached = this.tiles.get(key);
    if (cached) {
      // Rafraîchit la récence LRU.
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }
    if (this.pending.has(key)) return this.pending.get(key);

    const task = (async () => {
      try {
        const res = await fetch(fillTileUrl(this.url, this.zoom, x, y), {
          signal,
          mode: 'cors',
          credentials: 'omit',
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob);
        if (this.disposed) {
          bitmap.close?.();
          return null;
        }
        const heights = decodeTile(bitmap, this.encoding);
        bitmap.close?.();
        this._store(key, heights);
        return heights;
      } catch (e) {
        if (e?.name !== 'AbortError') {
          console.warn('[elevationField] tuile DEM indisponible', key, e?.message || e);
        }
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, task);
    return task;
  }

  _store(key, heights) {
    this.tiles.set(key, heights);
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.keys().next().value;
      this.tiles.delete(oldest);
    }
  }

  /**
   * Altitude en mètres au point donné en **coordonnées de tuile fractionnaires**
   * du zoom courant. Interpolation bilinéaire continue d'une tuile à l'autre.
   * Retourne `fallback` si aucune tuile ne couvre le point.
   */
  sampleTile(tx, ty, fallback = 0) {
    const size = DEM_TILE_PIXELS;
    // Espace pixel global ; le centre du pixel i est à i + 0,5.
    const px = tx * size - 0.5;
    const py = ty * size - 0.5;

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;

    const h00 = this._pixel(x0, y0);
    const h10 = this._pixel(x0 + 1, y0);
    const h01 = this._pixel(x0, y0 + 1);
    const h11 = this._pixel(x0 + 1, y0 + 1);

    if (h00 === null && h10 === null && h01 === null && h11 === null) return fallback;

    // Un voisin manquant (bord du bloc chargé) est remplacé par un voisin connu
    // plutôt que par 0 : mieux vaut un plateau qu'une falaise fantôme.
    const known = h00 ?? h10 ?? h01 ?? h11;
    const a = h00 ?? known;
    const b = h10 ?? known;
    const c = h01 ?? known;
    const d = h11 ?? known;

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }

  /** Lit un pixel en espace global. `null` si sa tuile n'est pas chargée. */
  _pixel(gx, gy) {
    const size = DEM_TILE_PIXELS;
    const world = this.worldPixels;
    if (gy < 0 || gy >= world) return null;
    const wrappedX = ((gx % world) + world) % world;

    const tx = Math.floor(wrappedX / size);
    const ty = Math.floor(gy / size);
    const tile = this.tiles.get(tileKey(this.zoom, tx, ty));
    if (!tile) return null;

    return tile[(gy - ty * size) * size + (wrappedX - tx * size)];
  }

  dispose() {
    this.disposed = true;
    this.tiles.clear();
    this.pending.clear();
  }
}
