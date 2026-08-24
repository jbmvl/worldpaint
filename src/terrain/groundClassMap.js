/*
 * groundClassMap — l'occupation du sol, rasterisée pour toute la scène.
 * ----------------------------------------------------------------------
 * C'est la **source unique** de ce dont le sol est fait. Les tuiles
 * vectorielles le disent en clair (`landcover`, `landuse`, `park`) ; on les
 * rasterise dans un carré centré sur l'observateur, et trois consommateurs y
 * lisent la même donnée au même endroit :
 *
 *   • le shader de terrain, qui compose la matière (`terrainMaterial`) ;
 *   • la végétation, qui plante ses arbres dans les bois (`vegetationLayer`) ;
 *   • l'herbe et le mobilier, qui ne poussent que sur du végétal.
 *
 * Une seule lecture, donc aucune contradiction possible entre la texture du sol
 * et ce qui s'y trouve planté. Aucune donnée supplémentaire à télécharger : ce
 * sont les tuiles déjà chargées pour les routes et le bâti.
 *
 * Encodage — un canal par matière, l'alpha portant la **couverture** :
 *
 *   R = herbe      G = bois      B = culture      alpha = classé
 *   alpha nul → non classé (l'appelant décide de son repli)
 *   alpha plein, R = G = B = 0 → sol nu, minéral ou bâti
 *
 * Le filtrage linéaire de la texture fait le reste : les lisières se fondent sur
 * quelques mètres au lieu de se découper au couteau, ce qui est plus juste que
 * la donnée elle-même — une lisière de bois n'est pas une ligne.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { cropFor, cropId, cropFromId, randomAt, CROP_ID_STEP } from '../layers/furniturePlacement.js';

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
 * Les valeurs de `class` sont celles que filtrent les styles `outdoors-*.json`
 * du projet : `landcover` porte rock, sand, wetland, wood, grass, farmland ;
 * `landuse` porte cemetery, railway, residential et le reste du bâti ; `park`
 * est une couche à part.
 *
 * Fonction pure.
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
    if (
      klass === 'residential' ||
      klass === 'suburb' ||
      klass === 'neighbourhood' ||
      klass === 'quarter' ||
      klass === 'industrial' ||
      klass === 'commercial' ||
      klass === 'retail' ||
      klass === 'railway' ||
      klass === 'quarry'
    ) {
      return 'bare';
    }
    return null;
  }

  return null;
}

/**
 * Couleur de remplissage d'une matière. L'alpha vaut toujours 255 : c'est lui
 * qui distingue « classé sol nu » de « pas classé du tout », deux situations
 * que le shader ne traite pas pareil.
 */
export const CLASS_FILL = {
  grass: 'rgba(255, 0, 0, 1)',
  wood: 'rgba(0, 255, 0, 1)',
  farmland: 'rgba(0, 0, 255, 1)',
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
   */
  constructor({ THREE }) {
    this.THREE = THREE;
    this.canvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    // La carte est relue par le CPU après chaque rasterisation — c'est elle qui
    // décide aussi où poussent les arbres et l'herbe.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    // Les canaux portent des poids, pas une couleur : aucune conversion.
    this.texture.colorSpace = THREE.NoColorSpace;
    // Sans ce réglage, three retourne l'image et la carte serait en miroir sur
    // l'axe nord-sud — une erreur qui ne se voit qu'aux lisières, donc tard.
    this.texture.flipY = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    // Carte des **cultures** : même carré, même repère, mais un identifiant de
    // culture dans le rouge au lieu de poids de matière. Elle partage donc
    // `uClassOrigin` et `uClassSize` avec la carte de classes — un seul repère,
    // aucun risque de décalage entre la matière du sol et ce qui y pousse.
    this.cropCanvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.cropCtx = this.cropCanvas.getContext('2d', { willReadFrequently: true });

    this.cropTexture = new THREE.CanvasTexture(this.cropCanvas);
    this.cropTexture.colorSpace = THREE.NoColorSpace;
    this.cropTexture.flipY = false;
    this.cropTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cropTexture.wrapT = THREE.ClampToEdgeWrapping;
    // **Au plus proche**, contrairement à la carte de classes. Le rouge y porte
    // un identifiant, pas une quantité : interpoler entre « blé » et « maïs »
    // donnerait « tournesol » sur toute la limite entre les deux champs. Et
    // c'est d'ailleurs plus juste — une limite de parcelle est une ligne nette,
    // là où une lisière de bois n'en est pas une.
    this.cropTexture.minFilter = THREE.NearestFilter;
    this.cropTexture.magFilter = THREE.NearestFilter;
    this.cropTexture.generateMipmaps = false;

    /** Coin nord-ouest du carré couvert, en mètres locaux. */
    this.origin = new THREE.Vector2(0, 0);
    this.size = CLASS_AREA_M;
    this.count = 0;

    /** Copie CPU, relue par la végétation. `null` tant que rien n'a été peint. */
    this._data = null;
    this._cropData = null;

    this._anchor = null;
    this._frame = null;
    this.disposed = false;
  }

  /**
   * Matières présentes en un point, ou `null` hors carte ou non classé.
   *
   * C'est la même donnée que celle lue par le shader, au même endroit : la
   * végétation plantée et la texture du sol ne peuvent donc pas se contredire.
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
    // Alpha nul : la donnée ne dit rien ici, et l'appelant doit se rabattre sur
    // ce qu'il sait faire sans elle.
    if (data[i + 3] === 0) return null;

    const grass = data[i] / 255;
    const wood = data[i + 1] / 255;
    const farmland = data[i + 2] / 255;
    return { grass, wood, farmland, bare: Math.max(0, 1 - grass - wood - farmland) };
  }

  /**
   * Part de végétal au sol, de 0 à 1, ou `null` si la donnée se tait. C'est
   * l'entrée de l'herbe et des alignements d'arbres.
   *
   * Une culture porte de l'herbe une partie de l'année seulement : elle compte,
   * mais pour moitié.
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
   * Culture portée par un point, ou `null` — hors carte, hors champ, ou culture
   * qu'on ne sait pas nommer.
   *
   * C'est la **seule** réponse à la question « qu'est-ce qui pousse ici ». Le
   * shader de terrain lit la même carte au même endroit pour en tirer la
   * couleur du champ, `cropLayer` pour y semer ses tiges, et le mobilier pour
   * savoir qu'un champ en culture ne se clôt pas.
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

    // Transparent, donc « non classé » partout tant qu'une entité n'a pas
    // peint : l'absence de donnée est une information, et elle doit se
    // distinguer du sol nu.
    ctx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);
    // Idem pour les cultures : rien de peint signifie « pas un champ », et le
    // shader se rabat alors sur le brun de labour.
    this.cropCtx.clearRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);

    let painted = 0;

    // L'ordre compte : `landuse` d'abord (les grandes emprises urbaines), puis
    // `landcover` (bois et prairies s'y superposent), puis `park` en dernier —
    // un parc dans une zone résidentielle doit rester un parc.
    for (const sourceLayer of CLASS_SOURCE_LAYERS) {
      source.forEachFeature(sourceLayer, tiles, (geometry, properties) => {
        const kind = groundClassFor(sourceLayer, properties);
        if (!kind) return;

        ctx.fillStyle = CLASS_FILL[kind];
        for (const rings of classPolygons(geometry)) {
          if (!Array.isArray(rings) || rings.length === 0) continue;

          // Le tracé est construit une fois et rempli deux fois : la matière
          // dans la carte de classes, la culture dans la sienne. Refaire le
          // chemin coûterait un second parcours de tous les anneaux de toutes
          // les entités des vingt-cinq tuiles.
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
              // Le centre sert de graine à la culture, et seul l'anneau
              // extérieur compte : un trou ne déplace pas le champ.
              if (ring === rings[0]) {
                sumX += localX;
                sumZ += localZ;
                counted++;
              }
            }
            path.closePath();
          }

          // Règle pair-impair : les anneaux intérieurs d'un polygone GeoJSON
          // sont des trous, et c'est exactement ce qu'elle produit.
          ctx.fill(path, 'evenodd');
          painted++;

          if (kind !== 'farmland') {
            // `park` est la seule couche peinte **après** `landcover` : elle
            // seule peut recouvrir un champ. Sans cet effacement, un parc posé
            // sur de la terre agricole garderait sa culture dans la carte, et
            // `cropLayer` y sèmerait du blé — le shader, lui, ne s'y tromperait
            // pas, puisque la teinte est pondérée par la part de culture.
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
          // La culture est tirée **ici et nulle part ailleurs**, à partir du
          // centre de la parcelle : le tirage est ancré au sol, donc la même
          // parcelle porte toujours la même chose, et la teinte au loin ne peut
          // pas contredire les tiges de près.
          const id = cropId(cropFor(properties, randomAt(sumX / counted, sumZ / counted, 43)));
          if (!id) continue;
          this.cropCtx.fillStyle = `rgba(${id * CROP_ID_STEP}, 0, 0, 1)`;
          this.cropCtx.fill(path, 'evenodd');
        }
      });
    }

    this.count = painted;
    this.origin.set(originX, originZ);
    this.texture.needsUpdate = true;
    this.cropTexture.needsUpdate = true;

    // Relecture unique, à la rasterisation : `sampleAt` est appelé des milliers
    // de fois par tuile plantée, et un `getImageData` par appel serait ruineux.
    try {
      this._data = ctx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS).data;
    } catch (e) {
      this._data = null;
      console.warn('[groundClassMap] relecture impossible', e?.message || e);
    }
    // La carte des cultures est relue en entier, comme celle des matières et
    // pour la même raison : `cropAt` est interrogé des milliers de fois par
    // redistribution du semis, et le mobilier l'interroge jusqu'à sept cents
    // mètres. Les deux relectures partagent alors exactement la même
    // indexation, ce qui est le principal intérêt de les garder jumelles.
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
