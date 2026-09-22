/*
 * elevationField — champ d'altitude continu à partir de tuiles DEM matricielles.
 * L'échantillonnage bilinéaire raisonne en espace de pixels global au zoom
 * courant, pas par tuile, pour qu'un point à la frontière de deux tuiles lise
 * les mêmes pixels des deux côtés (sinon crevasse visible à chaque jointure).
 *
 * La résolution d'une tuile n'est pas supposée : elle est relevée sur la
 * première image décodée. Une source qui sert du 512 lue comme du 256 donnerait
 * des altitudes fausses et non seulement grossières, le rééchantillonnage d'un
 * canevas moyennant des canaux qui encodent un nombre, pas une couleur.
 */

import { decodeTerrarium, decodeTerrainRgb, tileKey, fillTileUrl } from './tileMath.js';

/** Résolution supposée d'une tuile tant qu'aucune n'a été décodée. */
export const DEM_TILE_PIXELS = 256;

/**
 * Source par défaut : Terrain RGB de MapTiler. La clé est celle d'un compte de
 * test ; une application consommatrice passe la sienne par `elevation.url`.
 */
export const MAPTILER_TERRAIN_URL =
  'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=Zx2mAQIInk7YylLgVH0R';

const DECODERS = {
  terrarium: decodeTerrarium,
  'terrain-rgb': decodeTerrainRgb,
};

/**
 * Décode une image de tuile DEM en Float32Array d'altitudes (mètres), à la
 * résolution native de l'image. Passe par un canvas : c'est le seul moyen
 * portable de lire les pixels d'une image côté navigateur.
 */
function decodeTile(bitmap, encoding, size) {
  const decode = DECODERS[encoding] || decodeTerrarium;

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
   * @param {number} options.zoom      Zoom des tuiles DEM, indépendant de celui
   *        de la bulle qui les lit : c'est la résolution de la source qui le
   *        décide, pas la finesse de la maille.
   * @param {string} [options.url]     Gabarit d'URL.
   * @param {string} [options.encoding] 'terrain-rgb' (défaut) ou 'terrarium'.
   * @param {number} [options.maxTiles] Taille du cache LRU (défaut 64 tuiles,
   *        soit ~17 Mo : de quoi couvrir largement le bloc courant, le reste
   *        sert au recyclage quand l'observateur revient sur ses pas).
   */
  constructor({
    zoom,
    url = MAPTILER_TERRAIN_URL,
    encoding = 'terrain-rgb',
    maxTiles = 64,
  } = {}) {
    this.zoom = zoom;
    this.url = url;
    this.encoding = encoding;
    this.maxTiles = maxTiles;
    /** Relevée sur la première tuile décodée, jamais supposée ensuite. */
    this.tilePixels = DEM_TILE_PIXELS;
    /** @type {Map<string, Float32Array>} tuiles décodées (ordre = récence LRU) */
    this.tiles = new Map();
    /** @type {Map<string, Promise<Float32Array|null>>} chargements en vol */
    this.pending = new Map();
    this.disposed = false;
    this.revision = 0;
  }

  /** Nombre de pixels sur un côté du monde, au zoom courant. */
  get worldPixels() {
    return Math.pow(2, this.zoom) * this.tilePixels;
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
        // Un refus de la source rend un terrain plat, qui ne se lit pas comme
        // une panne : on le dit une fois, avec le code qui l'explique.
        if (!res.ok) {
          if (!this._warned) {
            this._warned = true;
            console.warn('[elevationField] source DEM refusée', res.status, key);
          }
          return null;
        }
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob);
        if (this.disposed) {
          bitmap.close?.();
          return null;
        }
        if (bitmap.width) this.tilePixels = bitmap.width;
        const heights = decodeTile(bitmap, this.encoding, this.tilePixels);
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
    this.revision++;
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
    const size = this.tilePixels;
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
    const size = this.tilePixels;
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
