/*
 * groundClassMap — l'occupation du sol, rasterisée pour toute la scène.
 * Source unique de ce dont le sol est fait : le shader de terrain
 * (`terrainMaterial`), la végétation (`vegetationLayer`) et l'herbe/le
 * mobilier lisent tous la même carte au même endroit, donc jamais de contradiction.
 *
 * Encodage — un canal par matière, l'alpha portant la couverture :
 *
 *   R = herbe      G = bois      B = culture      alpha = classé
 *   alpha nul → non classé (l'appelant décide de son repli)
 *   alpha plein, R = G = B = 0 → sol nu, minéral ou bâti
 *
 * Les poids sont des parts, pas des étiquettes : une entité peut en peindre
 * plusieurs à la fois (le lotissement en est le cas type — voir `groundClassFor`).
 * Filtrage linéaire : les lisières se fondent sur quelques mètres, ce qui est
 * plus juste que la donnée elle-même.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { cropFor, cropId, cropFromId, randomAt, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import { isDrawableWater } from '../layers/waterLayer.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Côté du carré couvert, en mètres. Il doit dépasser la portée du sol de
 * proximité (un kilomètre) **plus** la distance parcourue entre deux
 * rasterisations, sinon la matière s'arrêterait net avant la fin du fondu.
 */
export const CLASS_AREA_M = 4096;
/** Côté de la carte, en pixels. ~2,7 m par pixel : une lisière n'est pas un trait. */
export const CLASS_PIXELS = 1536;
/** Déplacement de l'observateur avant re-rasterisation, en mètres. */
export const CLASS_REBUILD_M = 400;

/** Couches source lues, dans l'ordre de dessin (les dernières recouvrent). */
export const CLASS_SOURCE_LAYERS = ['landuse', 'landcover', 'park'];

/**
 * Matière d'une entité surfacique, ou `null` si elle n'en décrit aucune.
 *
 * `landuse=residential` ne prend pas `bare` : c'est un périmètre
 * administratif où le sol réel est majoritairement de l'herbe (pelouses,
 * jardins), le minéral ne couvrant que la chaussée et ses abords (composés
 * séparément par `streetLayer`). D'où `settled` : part d'herbe dominante,
 * part de minéral. Une zone d'activité (industrielle, commerciale, ferroviaire,
 * carrière), elle, reste `bare` : réellement minérale sur toute sa surface.
 */
export function groundClassFor(sourceLayer, properties = {}) {
  const klass = properties.class;

  if (sourceLayer === 'park') return 'grass';

  if (sourceLayer === 'landcover') {
    if (klass === 'wood') return 'wood';
    if (klass === 'grass' || klass === 'wetland') return 'grass';
    if (klass === 'farmland') return 'farmland';
    if (klass === 'rock' || klass === 'sand' || klass === 'ice') return 'bare';
    // `glacier` et `ice_shelf` arrivent par la sous-classe.
    if (properties.subclass === 'glacier' || properties.subclass === 'ice_shelf') return 'bare';
    return null;
  }

  if (sourceLayer === 'landuse') {
    if (klass === 'cemetery' || klass === 'pitch' || klass === 'playground' || klass === 'stadium') {
      return 'grass';
    }
    if (klass === 'residential' || klass === 'suburb' || klass === 'neighbourhood' || klass === 'quarter') {
      return 'settled';
    }
    if (klass === 'industrial' || klass === 'commercial' || klass === 'retail' || klass === 'railway' || klass === 'quarry') {
      return 'bare';
    }
    return null;
  }

  return null;
}

/** Part d'herbe d'un quartier d'habitation (ordre de grandeur du non-bâti/non-revêtu dans un lotissement français). */
export const SETTLED_GRASS = 0.66;

/**
 * Couleur de remplissage d'une matière. L'alpha vaut toujours 255 (distingue
 * « classé sol nu » de « pas classé du tout »). `settled` est le seul
 * remplissage partiel : un mélange d'herbe et de minéral écrit dans le canal rouge.
 */
export const CLASS_FILL = {
  grass: 'rgba(255, 0, 0, 1)',
  wood: 'rgba(0, 255, 0, 1)',
  farmland: 'rgba(0, 0, 255, 1)',
  settled: `rgba(${Math.round(SETTLED_GRASS * 255)}, 0, 0, 1)`,
  bare: 'rgba(0, 0, 0, 1)',
};

/** Anneaux d'une géométrie surfacique. */
export function classPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

export class GroundClassMap {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} [options.theme] Fournit `theme.water.waterways` (largeur
   *        des cours d'eau) et `theme.water.riparianBufferM` (largeur de la
   *        ripisylve) — voir `rebuild`.
   */
  constructor({ THREE, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.canvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace; // les canaux portent des poids, pas une couleur
    // Sans ce réglage, three retourne l'image et la carte serait en miroir nord-sud.
    this.texture.flipY = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    // Carte des cultures : même carré, même repère, identifiant de culture
    // dans le rouge au lieu de poids de matière.
    this.cropCanvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.cropCtx = this.cropCanvas.getContext('2d', { willReadFrequently: true });

    this.cropTexture = new THREE.CanvasTexture(this.cropCanvas);
    this.cropTexture.colorSpace = THREE.NoColorSpace;
    this.cropTexture.flipY = false;
    this.cropTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cropTexture.wrapT = THREE.ClampToEdgeWrapping;
    // Au plus proche, contrairement à la carte de classes : le rouge porte un
    // identifiant, pas une quantité (interpoler donnerait une culture inventée).
    this.cropTexture.minFilter = THREE.NearestFilter;
    this.cropTexture.magFilter = THREE.NearestFilter;
    this.cropTexture.generateMipmaps = false;

    /** Coin nord-ouest du carré couvert, en mètres locaux. */
    this.origin = new THREE.Vector2(0, 0);
    this.size = CLASS_AREA_M;
    this.count = 0;
    /** Numéro de rasterisation, incrémenté à chaque repeinte (sert à qui garde ce qu'il a lu ici, ex. la végétation). */
    this.revision = 0;

    /** Copie CPU, relue par la végétation. `null` tant que rien n'a été peint. */
    this._data = null;
    this._cropData = null;

    this._anchor = null;
    this._frame = null;
    this.disposed = false;
  }

  /**
   * Matières présentes en un point, ou `null` hors carte ou non classé (même
   * donnée que celle lue par le shader, au même endroit).
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {{grass:number, wood:number, farmland:number, bare:number}|null}
   */
  sampleAt(x, z) {
    const data = this._data;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null; // la donnée ne dit rien ici

    const grass = data[i] / 255;
    const wood = data[i + 1] / 255;
    const farmland = data[i + 2] / 255;
    return { grass, wood, farmland, bare: Math.max(0, 1 - grass - wood - farmland) };
  }

  /**
   * Part de végétal au sol, de 0 à 1, ou `null` si la donnée se tait —
   * l'entrée de l'herbe et des alignements d'arbres. Une culture ne compte
   * que pour moitié (herbe une partie de l'année seulement).
   */
  greenAt(x, z) {
    const sample = this.sampleAt(x, z);
    if (!sample) return null;
    return Math.min(1, sample.grass + sample.farmland * 0.5);
  }

  /** Part de boisé, de 0 à 1. Zéro là où la donnée se tait : on ne devine pas un bois. */
  woodAt(x, z) {
    return this.sampleAt(x, z)?.wood ?? 0;
  }

  /**
   * Culture portée par un point, ou `null` (hors carte, hors champ, ou
   * culture qu'on ne sait pas nommer). Seule réponse à « qu'est-ce qui pousse
   * ici », lue aussi par le shader, `cropLayer`, et le mobilier.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null}
   */
  cropAt(x, z) {
    const data = this._cropData;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null;
    return cropFromId(data[i]);
  }

  /** Vrai dès qu'une carte des cultures a été relue. */
  get cropReady() {
    return this._cropData !== null;
  }

  /** Vrai dès qu'une rasterisation a été relue : avant, personne ne sait rien. */
  get ready() {
    return this._data !== null;
  }

  /**
   * Part d'un rectangle, en mètres locaux, sur laquelle la carte a quelque
   * chose à dire : de 0 (rien, hors carte) à 1 (tout). Une tuile de coin
   * déborde régulièrement du carré couvert (qui suit l'observateur par sauts
   * de 400 m) ; sans cette mesure, une forêt tombant juste après le bord au
   * moment de sa plantation ne poussait jamais.
   */
  coverageOf(minX, minZ, maxX, maxZ, frame = null) {
    if (!this.ready) return 0;
    if (frame && this._frame !== frame) return 0;
    const area = (maxX - minX) * (maxZ - minZ);
    if (!(area > 0)) return 0;
    const overlapX = Math.min(maxX, this.origin.x + this.size) - Math.max(minX, this.origin.x);
    const overlapZ = Math.min(maxZ, this.origin.y + this.size) - Math.max(minZ, this.origin.y);
    if (overlapX <= 0 || overlapZ <= 0) return 0;
    return Math.min(1, (overlapX * overlapZ) / area);
  }

  needsRebuild(x, z, frame) {
    if (this._frame !== frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= CLASS_REBUILD_M;
  }

  /**
   * Re-rasterise la carte autour d'un point.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Object} frame  Repère local de la bulle.
   * @returns {boolean} vrai si des surfaces ont été peintes.
   */
  rebuild(source, tiles, here, frame) {
    if (this.disposed || !source || !frame) return false;

    const { ctx } = this;
    const half = CLASS_AREA_M / 2;
    const originX = here.x - half;
    const originZ = here.z - half;
    const perMeter = CLASS_PIXELS / CLASS_AREA_M;
    const { origin, scale, zoom } = frame;

    // Transparent = non classé, distinct du sol nu.
    ctx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);
    this.cropCtx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);

    let painted = 0;

    // L'ordre compte : landuse (grandes emprises) puis landcover (bois/prairies
    // par-dessus) puis park en dernier (doit rester un parc en zone résidentielle).
    for (const sourceLayer of CLASS_SOURCE_LAYERS) {
      source.forEachFeature(sourceLayer, tiles, (geometry, properties) => {
        const kind = groundClassFor(sourceLayer, properties);
        if (!kind) return;

        ctx.fillStyle = CLASS_FILL[kind];
        for (const rings of classPolygons(geometry)) {
          if (!Array.isArray(rings) || rings.length === 0) continue;

          // Tracé construit une fois, rempli deux fois (matière + culture).
          const path = new Path2D();
          let sumX = 0;
          let sumZ = 0;
          let counted = 0;

          for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            for (let i = 0; i < ring.length; i++) {
              const [lng, lat] = ring[i];
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
              const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
              const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
              if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              // Centre = graine de la culture ; seul l'anneau extérieur compte.
              if (ring === rings[0]) {
                sumX += localX;
                sumZ += localZ;
                counted++;
              }
            }
            path.closePath();
          }

          ctx.fill(path, 'evenodd'); // anneaux intérieurs = trous
          painted++;

          if (kind !== 'farmland') {
            // `park` est la seule couche peinte après `landcover` : sans cet
            // effacement, un parc sur une terre agricole garderait sa culture.
            if (sourceLayer === 'park') {
              this.cropCtx.save();
              this.cropCtx.globalCompositeOperation = 'destination-out';
              this.cropCtx.fillStyle = '#000';
              this.cropCtx.fill(path, 'evenodd');
              this.cropCtx.restore();
            }
            continue;
          }
          if (counted === 0) continue;
          // Tirée ici et nulle part ailleurs, ancrée au sol (centre de la parcelle).
          const id = cropId(cropFor(properties, randomAt(sumX / counted, sumZ / counted, 43)));
          if (!id) continue;
          this.cropCtx.fillStyle = `rgba(${id * CROP_ID_STEP}, 0, 0, 1)`;
          this.cropCtx.fill(path, 'evenodd');
        }
      });
    }

    // Ripisylve : une bande de bois tracée le long des cours d'eau linéaires
    // (`waterway`, pas un polygone), plantée par `vegetationLayer` avec les
    // mêmes silhouettes qu'une vraie forêt. Après les polygones : le lit d'un
    // ruisseau qui traverse un champ de blé doit y remplacer la culture.
    {
      const waterways = this.theme.water.waterways;
      const bufferM = this.theme.water.riparianBufferM ?? 0;
      if (bufferM > 0) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = CLASS_FILL.wood;
        this.cropCtx.save();
        // Le lit efface la culture qui s'y trouvait (un champ ne pousse pas sous un bosquet).
        this.cropCtx.globalCompositeOperation = 'destination-out';
        this.cropCtx.fillStyle = '#000';
        this.cropCtx.lineCap = 'round';
        this.cropCtx.lineJoin = 'round';

        source.forEachFeature('waterway', tiles, (geometry, properties) => {
          if (properties.brunnel === 'tunnel') return;
          if (properties.intermittent === 1 || properties.intermittent === true) return;
          // Un fossé n'a pas de ripisylve.
          if (properties.class === 'ditch') return; // un fossé n'a pas de ripisylve
          const width = waterways[properties.class];
          if (!width) return;

          const lines =
            geometry.type === 'LineString'
              ? [geometry.coordinates]
              : geometry.type === 'MultiLineString'
                ? geometry.coordinates
                : [];
          const lineWidthPx = (width + bufferM * 2) * perMeter;

          for (const line of lines) {
            if (!Array.isArray(line) || line.length < 2) continue;
            const path = new Path2D();
            let started = false;
            for (const [lng, lat] of line) {
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
              const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
              const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
              const px = (localX - originX) * perMeter;
              const pz = (localZ - originZ) * perMeter;
              if (!started) {
                path.moveTo(px, pz);
                started = true;
              } else {
                path.lineTo(px, pz);
              }
            }
            if (!started) continue;

            ctx.lineWidth = lineWidthPx;
            ctx.stroke(path);
            // Le trait est centré sur l'axe : il faut reprendre le lit, sinon
            // un large cours d'eau se retrouve planté d'arbres en son milieu.
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = width * perMeter;
            ctx.stroke(path);
            ctx.restore();
            this.cropCtx.lineWidth = lineWidthPx;
            this.cropCtx.strokeStyle = '#000';
            this.cropCtx.stroke(path);
            painted++;
          }
        });

        this.cropCtx.restore();
      }
    }

    // Le lit d'un grand cours d'eau est un polygone (`water`), pas seulement
    // le trait `waterway` (dont la largeur de thème décrit un ruisseau, pas
    // un fleuve). On efface donc, après coup, tout ce qui a été peint sous
    // l'emprise réelle de l'eau.
    source.forEachFeature('water', tiles, (geometry, properties) => {
      if (!isDrawableWater(properties)) return;
      for (const rings of classPolygons(geometry)) {
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const path = new Path2D();
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
            const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
            if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
            else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
          }
          path.closePath();
        }

        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill(path, 'evenodd');
        ctx.restore();
      }
    });

    this.count = painted;
    this.revision++;
    this.origin.set(originX, originZ);
    this.texture.needsUpdate = true;
    this.cropTexture.needsUpdate = true;

    // Relecture unique, à la rasterisation (un `getImageData` par appel serait ruineux).
    try {
      this._data = ctx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS).data;
    } catch (e) {
      this._data = null;
      console.warn('[groundClassMap] relecture impossible', e?.message || e);
    }
    // Relue en entier, comme celle des matières, pour la même indexation.
    try {
      this._cropData = this.cropCtx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS).data;
    } catch (e) {
      this._cropData = null;
      console.warn('[groundClassMap] relecture des cultures impossible', e?.message || e);
    }
    this._anchor = { x: here.x, z: here.z };
    this._frame = frame;
    return painted > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._data = null;
    this._cropData = null;
    this.texture.dispose();
    this.cropTexture.dispose();
  }
}
