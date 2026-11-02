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
import { tileRequest } from './tileRequest.js';

/** Résolution supposée d'une tuile tant qu'aucune n'a été décodée. */
export const DEM_TILE_PIXELS = 256;

/**
 * Source par défaut : Terrain RGB de MapTiler. La clé est celle d'un compte de
 * test ; une application consommatrice passe la sienne par `elevation.url`.
 */
export const MAPTILER_TERRAIN_URL =
  'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=Zx2mAQIInk7YylLgVH0R';

/** Repli par défaut : Terrarium d'AWS Open Data, sans clé ni quota, mais ~30 m et mer à +3–9 m sur les côtes. */
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * Réponses qui disent que la source ne servira plus (clé, quota) : on bascule
 * sur le repli. Un 404 ne concerne qu'une tuile et ne fait pas basculer.
 */
const REFUSED = new Set([401, 403, 429]);

/** Délai avant de redemander une tuile en échec : chaque relève la redemandait, quota épuisé ou non. */
export const DEM_RETRY_MS = 60000;

const DECODERS = {
  terrarium: decodeTerrarium,
  'terrain-rgb': decodeTerrainRgb,
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
   * @param {{url: string, encoding: string}|null} [options.fallback] Source
   *        prise dès que la principale refuse de servir (401, 403, 429, ou
   *        requête bloquée). Défaut : Terrarium. `null` : aucun repli.
   * @param {number} [options.maxTiles] Taille du cache LRU (défaut 64 tuiles,
   *        soit ~17 Mo : de quoi couvrir largement le bloc courant, le reste
   *        sert au recyclage quand l'observateur revient sur ses pas).
   */
  constructor({
    zoom,
    url = MAPTILER_TERRAIN_URL,
    encoding = 'terrain-rgb',
    fallback = { url: TERRARIUM_URL, encoding: 'terrarium' },
    maxTiles = 64,
    timeoutMs = 15000,
    _sources = null,
  } = {}) {
    this.zoom = zoom;
    /**
     * Sources dans l'ordre et celle en service, partagées avec les champs
     * d'autres zooms (`atZoom`) : le relief lointain bascule avec la bulle.
     */
    this._sources = _sources || {
      list: [{ url, encoding }, ...(fallback && fallback.url !== url ? [fallback] : [])],
      index: 0,
      warned: false,
    };
    this._sourceIndex = this._sources.index;
    this.maxTiles = maxTiles;
    this.timeoutMs = timeoutMs;
    this._abort = new AbortController();
    /** Relevée sur la première tuile décodée, jamais supposée ensuite. */
    this.tilePixels = DEM_TILE_PIXELS;
    /** @type {Map<string, Float32Array>} tuiles décodées (ordre = récence LRU) */
    this.tiles = new Map();
    /** @type {Map<string, Promise<Float32Array|null>>} chargements en vol */
    this.pending = new Map();
    /** @type {Map<string, number>} tuiles en échec et l'instant de l'échec */
    this.failed = new Map();
    this.disposed = false;
    this.revision = 0;
  }

  /** Gabarit d'URL de la source en service. */
  get url() {
    return this._sources.list[this._sources.index].url;
  }

  get encoding() {
    return this._sources.list[this._sources.index].encoding;
  }

  /** Un champ de la même source à un autre zoom, avec son propre cache. */
  atZoom(zoom) {
    return new this.constructor({ zoom, maxTiles: this.maxTiles, timeoutMs: this.timeoutMs, _sources: this._sources });
  }

  /** Nombre de pixels sur un côté du monde, au zoom courant. */
  get worldPixels() {
    return Math.pow(2, this.zoom) * this.tilePixels;
  }

  has(x, y) {
    this._adoptSource();
    return this.tiles.has(tileKey(this.zoom, x, y));
  }

  /** Charge une tuile (idempotent). Résout `null` si la tuile est indisponible. */
  async load(x, y, signal) {
    if (this.disposed || signal?.aborted) return null;
    this._adoptSource();
    const key = tileKey(this.zoom, x, y);
    const cached = this.tiles.get(key);
    if (cached) {
      // Rafraîchit la récence LRU.
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && now() - failedAt < DEM_RETRY_MS) return null;

    const task = (async () => {
      const request = tileRequest({ signal, lifetime: this._abort.signal, timeoutMs: this.timeoutMs });
      try {
        // Une passe par source : la principale, puis le repli si elle refuse.
        for (;;) {
          const index = this._sources.index;
          const { url, encoding } = this._sources.list[index];
          let res;
          try {
            res = await fetch(fillTileUrl(url, this.zoom, x, y), {
              signal: request.signal,
              mode: 'cors',
              credentials: 'omit',
            });
          } catch (e) {
            // Un refus sans en-têtes CORS n'arrive que sous cette forme.
            if (e?.name !== 'AbortError' && this._fallBack(index, e?.message || e)) continue;
            throw e;
          }
          if (!res.ok) {
            if (REFUSED.has(res.status) && this._fallBack(index, res.status)) continue;
            this._fail(key);
            // Un terrain plat ne se lit pas comme une panne : on le dit une fois.
            if (!this._warned) {
              this._warned = true;
              console.warn('[elevationField] source DEM refusée', res.status, key);
            }
            return null;
          }
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          if (this.disposed || request.signal.aborted) {
            bitmap.close?.();
            return null;
          }
          // Bascule pendant le téléchargement : la tuile vient de l'ancienne source.
          if (index !== this._sources.index) {
            bitmap.close?.();
            continue;
          }
          this._adoptSource();
          if (bitmap.width) this.tilePixels = bitmap.width;
          const heights = decodeTile(bitmap, encoding, this.tilePixels);
          bitmap.close?.();
          this.failed.delete(key);
          this._store(key, heights);
          return heights;
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          this._fail(key);
          console.warn('[elevationField] tuile DEM indisponible', key, e?.message || e);
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

  /**
   * Passe à la source suivante si `index` est encore celle en service.
   * Vrai s'il faut réessayer : bascule faite ici ou déjà faite ailleurs.
   */
  _fallBack(index, reason) {
    const sources = this._sources;
    if (sources.index !== index) return true;
    if (index + 1 >= sources.list.length) return false;
    sources.index = index + 1;
    if (!sources.warned) {
      sources.warned = true;
      console.warn('[elevationField] source DEM refusée (' + reason + '), repli sur', sources.list[sources.index].url);
    }
    return true;
  }

  /**
   * Une source à la place d'une autre : tout le cache part. Deux MNT n'ont ni
   * la même résolution ni les mêmes cotes ; mêlés, ils se recoudraient en
   * marches. Les mailles déjà construites gardent leur relief.
   */
  _adoptSource() {
    if (this._sourceIndex === this._sources.index) return;
    this._sourceIndex = this._sources.index;
    this.tiles.clear();
    this.failed.clear();
    this.tilePixels = DEM_TILE_PIXELS;
    this._last = null;
    this.revision++;
  }

  _fail(key) {
    this.failed.delete(key);
    this.failed.set(key, now());
    while (this.failed.size > this.maxTiles * 4) this.failed.delete(this.failed.keys().next().value);
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

    // Les quatre pixels dans une même tuile : une seule recherche de tuile.
    const world = Math.pow(2, this.zoom) * size;
    if (y0 >= 0 && y0 + 1 < world) {
      const wrappedX = ((x0 % world) + world) % world;
      const lx = wrappedX % size;
      const ly = y0 % size;
      if (lx + 1 < size && ly + 1 < size) {
        const tile = this._tileAt((wrappedX - lx) / size, (y0 - ly) / size);
        if (!tile) return fallback;
        const i = ly * size + lx;
        const top = tile[i] + (tile[i + 1] - tile[i]) * fx;
        const bottom = tile[i + size] + (tile[i + size + 1] - tile[i + size]) * fx;
        return top + (bottom - top) * fy;
      }
    }

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
    const tile = this._tileAt(tx, ty);
    if (!tile) return null;

    return tile[(gy - ty * size) * size + (wrappedX - tx * size)];
  }

  /** Pixels d'une tuile chargée, ou `undefined`. */
  _tileAt(tx, ty) {
    // Les lectures se suivent presque toujours dans la même tuile : la clé
    // texte et la `Map` coûtaient plus que l'interpolation.
    let last = this._last;
    if (!last) last = this._last = { tx: NaN, ty: NaN, revision: NaN, tile: null };
    if (last.tx !== tx || last.ty !== ty || last.revision !== this.revision) {
      last.tx = tx;
      last.ty = ty;
      last.revision = this.revision;
      last.tile = this.tiles.get(tileKey(this.zoom, tx, ty));
    }
    return last.tile;
  }

  dispose() {
    this.disposed = true;
    this._abort.abort();
    this._last = null;
    this.tiles.clear();
    this.pending.clear();
  }
}
