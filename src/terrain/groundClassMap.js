/*
 * groundClassMap — l'occupation du sol, rasterisée pour toute la scène.
 * ----------------------------------------------------------------------
 * C'est la **source unique** de ce dont le sol est fait. Les tuiles
 * vectorielles le disent en clair (`landcover`, `landuse`, `park` — et, pour
 * la ripisylve, `waterway`, tracé et non rempli) ; on les rasterise dans un
 * carré centré sur l'observateur, et trois consommateurs y lisent la même
 * donnée au même endroit :
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
 * Les poids sont des **parts**, pas des étiquettes : une entité peut en peindre
 * plusieurs à la fois, et c'est ce qui permet de décrire un sol mêlé sans
 * inventer une matière pour chaque mélange. Le lotissement en est le cas type —
 * voir `groundClassFor`.
 *
 * Le filtrage linéaire de la texture fait le reste : les lisières se fondent sur
 * quelques mètres au lieu de se découper au couteau, ce qui est plus juste que
 * la donnée elle-même — une lisière de bois n'est pas une ligne.
 *
 * ## La seconde carte : ce qui pousse, et de quelle sorte
 *
 * Quatre matières ne suffisent pas à distinguer une lande écossaise d'une
 * prairie normande : les deux sont de l'herbe, et les tuiles le disent pourtant
 * — la couche `landcover` porte une `subclass` qui vaut `heath`, `scrub`,
 * `wetland`, `scree`, `dune`… Cette information était lue puis jetée.
 *
 * Elle vit maintenant dans la **carte des cultures**, qui n'utilisait qu'un de
 * ses canaux :
 *
 *   R = identifiant de culture   (blé, maïs… — voir `CROP_KINDS`)
 *   G = identifiant de couverture (lande, maquis, marais… — `COVER_KINDS`)
 *   alpha = peint
 *
 * Deux identifiants indépendants dans la même image, au même repère, filtrée au
 * plus proche : une parcelle porte une culture **ou** une couverture, jamais un
 * mélange des deux, et les deux se lisent d'un seul échantillonnage.
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
 * Les valeurs de `class` sont celles que filtrent les styles `outdoors-*.json`
 * du projet : `landcover` porte rock, sand, wetland, wood, grass, farmland ;
 * `landuse` porte cemetery, railway, residential et le reste du bâti ; `park`
 * est une couche à part.
 *
 * ## Pourquoi `residential` n'est pas du sol nu
 *
 * Toutes les emprises bâties partageaient la matière `bare`, et c'est **faux**
 * pour la moitié d'entre elles. `landuse=residential` ne décrit pas une surface
 * minérale : il décrit un périmètre administratif dans lequel le sol réel est,
 * en France, majoritairement **de l'herbe** — pelouses, jardins de devant,
 * bandes entre les maisons. Le minéral d'un lotissement ne couvre que la
 * chaussée, ses abords et les cours, c'est-à-dire quelques mètres de part et
 * d'autre d'un tracé que le vectoriel donne par ailleurs, en clair, dans la
 * couche `transportation`. Peindre tout le périmètre en gris, c'était donc
 * répondre à la question « qu'y a-t-il au sol ? » avec la réponse à « qui
 * habite ici ? » — d'où l'aplat.
 *
 * Un quartier prend donc `settled` : une part d'herbe dominante et une part de
 * minéral, et le minéral vraiment visible est **composé** par `streetLayer` le
 * long des chaussées, là où il est.
 *
 * Une zone d'activité, elle, reste `bare` : un parking de zone commerciale, une
 * plate-forme industrielle, une emprise ferroviaire, une carrière sont
 * réellement minéraux sur toute leur surface. C'est la même donnée, mais elle
 * ne dit pas la même chose selon la classe, et les confondre était le défaut.
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

/**
 * Part d'herbe d'un quartier d'habitation.
 *
 * Deux tiers : c'est l'ordre de grandeur du non-bâti et non-revêtu dans un
 * lotissement français, jardins compris. Le tiers restant reste minéral, ce qui
 * garde au sol une teinte plus sourde que la prairie voisine — un quartier n'est
 * pas un pré, il est seulement beaucoup plus vert que ne le disait le gris.
 */
export const SETTLED_GRASS = 0.66;

/**
 * Couleur de remplissage d'une matière. L'alpha vaut toujours 255 : c'est lui
 * qui distingue « classé sol nu » de « pas classé du tout », deux situations
 * que le shader ne traite pas pareil.
 *
 * `settled` est le seul remplissage **partiel** : ce n'est pas une matière de
 * plus dans le shader, c'est un mélange d'herbe et de minéral écrit dans le
 * canal rouge. Rien à ajouter en aval — le complément à 1 y est déjà lu comme
 * du sol nu, et l'herbe et le mobilier y lisent leur part de vert.
 */
export const CLASS_FILL = {
  grass: 'rgba(255, 0, 0, 1)',
  wood: 'rgba(0, 255, 0, 1)',
  farmland: 'rgba(0, 0, 255, 1)',
  settled: `rgba(${Math.round(SETTLED_GRASS * 255)}, 0, 0, 1)`,
  bare: 'rgba(0, 0, 0, 1)',
};

/**
 * Les couvertures, dans l'ordre de leur identifiant.
 *
 * Même contrat que `CROP_KINDS`, et les mêmes précautions : l'identifiant vaut
 * `indice + 1`, il est **peint** dans le canal vert de la carte des cultures, et
 * relu des deux côtés — par le shader de terrain, qui en tire la couleur du sol
 * jusqu'à l'horizon, et par l'herbe et la végétation, qui décident de ce qui y
 * pousse. L'ordre est donc gravé : le changer repeint une lande en éboulis.
 *
 * Les trois premières sont **végétales** (peintes sur de l'herbe), les quatre
 * suivantes **minérales** (peintes sur du sol nu).
 */
export const COVER_KINDS = ['heath', 'scrub', 'wetland', 'alpine', 'scree', 'rock', 'sand'];

/** Pas entre deux identifiants dans le canal vert. */
export const COVER_ID_STEP = 30;

/**
 * Couverture décrite par une entité surfacique, ou `null`.
 *
 * Seule la couche `landcover` en porte : `landuse` décrit qui occupe le sol,
 * pas de quoi il est fait, et `park` est un usage, pas une matière. Les valeurs
 * de `subclass` sont celles du schéma OpenMapTiles, qui y recopie le tag OSM
 * d'origine (`natural`, `landuse`, `leisure` ou `wetland`).
 *
 * Fonction pure.
 */
export function coverFor(sourceLayer, properties = {}) {
  if (sourceLayer !== 'landcover') return null;
  const klass = properties.class;
  const subclass = properties.subclass;

  if (klass === 'wetland') return 'wetland';
  if (klass === 'sand') return 'sand';
  // L'éboulis et la dalle sont deux paysages différents : l'un est une pente de
  // cailloux qui bouge, l'autre un plateau de pierre. Les confondre était le
  // défaut du gris unique.
  if (klass === 'rock') return subclass === 'scree' ? 'scree' : 'rock';
  if (klass === 'grass') {
    if (subclass === 'heath') return 'heath';
    if (subclass === 'scrub' || subclass === 'shrubbery') return 'scrub';
    // `fell` est la pelouse d'altitude au-dessus de la limite forestière ;
    // `tundra` en est l'équivalent boréal.
    if (subclass === 'fell' || subclass === 'tundra') return 'alpine';
  }
  return null;
}

/** Identifiant d'une couverture dans la carte, ou 0. Fonction pure. */
export function coverId(cover) {
  const index = COVER_KINDS.indexOf(cover);
  return index < 0 ? 0 : index + 1;
}

/** Couverture portée par une valeur du canal vert, ou `null`. Fonction pure. */
export function coverFromId(green) {
  const index = Math.round(green / COVER_ID_STEP) - 1;
  return COVER_KINDS[index] || null;
}

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
    /**
     * Famille climatique du lieu, ou `null`. La carte des cultures est le seul
     * endroit où une culture est tirée (voir `cropFor`), donc c'est ici que le
     * climat doit arriver — pas dans `cropLayer`, qui ne fait que relire.
     */
    this.climate = null;
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
    /**
     * Numéro de rasterisation, incrémenté à chaque repeinte.
     *
     * Il sert à ceux qui **gardent** ce qu'ils ont lu ici : la végétation plante
     * une tuile une fois pour toutes, et doit pouvoir savoir que la carte sur
     * laquelle elle s'est appuyée n'est plus celle-ci.
     */
    this.revision = 0;

    /** Copie CPU, relue par la végétation. `null` tant que rien n'a été peint. */
    this._data = null;
    this._cropData = null;

    this._anchor = null;
    this._frame = null;
    this.disposed = false;
  }

  /**
   * Pose la famille climatique du lieu. Le compositeur repeint la carte quand
   * elle change : ce qui a été semé sous un autre climat n'est plus valable.
   * @param {string|null} family
   */
  setClimate(family) {
    this.climate = family || null;
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

  /**
   * Couverture portée par un point, ou `null` — hors carte, ou couverture
   * ordinaire (une prairie n'en est pas une : c'est le cas par défaut).
   *
   * Lue dans le canal **vert** de la carte des cultures, au même repère et au
   * même échantillonnage que la culture elle-même. C'est la seule réponse à la
   * question « de quelle sorte est ce sol » : le shader de terrain y prend sa
   * couleur, l'herbe sa hauteur, la végétation ses arbustes.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null}
   */
  coverAt(x, z) {
    const data = this._cropData;
    if (!data) return null;

    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return null;

    const i = (pz * CLASS_PIXELS + px) * 4;
    if (data[i + 3] === 0) return null;
    return coverFromId(data[i + 1]);
  }

  /** Vrai dès qu'une carte des cultures **et des couvertures** a été relue. */
  get cropReady() {
    return this._cropData !== null;
  }

  /** Vrai dès qu'une rasterisation a été relue : avant, personne ne sait rien. */
  get ready() {
    return this._data !== null;
  }

  /**
   * Part d'un rectangle, en mètres locaux, sur laquelle la carte a quelque chose
   * à dire : de 0 (rien, hors carte, ou carte d'un autre repère) à 1 (tout).
   *
   * Ce n'est pas une question oiseuse. Le carré couvert fait 4 km de côté et
   * suit l'observateur par sauts de 400 m ; la bulle, elle, monte des tuiles de
   * plus d'un kilomètre en anneau. Une tuile de coin déborde donc régulièrement,
   * et ce qu'on y sème est semé sur une carte muette. Sans cette mesure, une
   * forêt dont l'emprise tombait juste après le bord au moment où sa tuile a été
   * plantée ne poussait **jamais** — et une autre fois, au même endroit, si.
   *
   * Fonction pure vis-à-vis de la carte : elle ne lit que son cadrage.
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

          // Couverture fine — lande, maquis, marais, éboulis. Elle vit dans le
          // canal vert de la carte des cultures (voir l'en-tête).
          const cover = coverId(coverFor(sourceLayer, properties));

          if (kind !== 'farmland') {
            // `park` est la seule couche peinte **après** `landcover` : elle
            // seule peut recouvrir un champ. Sans cet effacement, un parc posé
            // sur de la terre agricole garderait sa culture dans la carte, et
            // `cropLayer` y sèmerait du blé — le shader, lui, ne s'y tromperait
            // pas, puisque la teinte est pondérée par la part de culture. Le
            // même effacement vaut pour la couverture : un parc n'est pas une
            // lande, même tracé sur une lande.
            if (sourceLayer === 'park') {
              this.cropCtx.save();
              this.cropCtx.globalCompositeOperation = 'destination-out';
              this.cropCtx.fillStyle = '#000';
              this.cropCtx.fill(path, 'evenodd');
              this.cropCtx.restore();
            } else if (cover) {
              this.cropCtx.fillStyle = `rgba(0, ${cover * COVER_ID_STEP}, 0, 1)`;
              this.cropCtx.fill(path, 'evenodd');
            }
            continue;
          }
          if (counted === 0) continue;
          // La culture est tirée **ici et nulle part ailleurs**, à partir du
          // centre de la parcelle : le tirage est ancré au sol, donc la même
          // parcelle porte toujours la même chose, et la teinte au loin ne peut
          // pas contredire les tiges de près.
          const id = cropId(
            cropFor(properties, randomAt(sumX / counted, sumZ / counted, 43), this.climate)
          );
          if (!id && !cover) continue;
          this.cropCtx.fillStyle = `rgba(${id * CROP_ID_STEP}, ${cover * COVER_ID_STEP}, 0, 1)`;
          this.cropCtx.fill(path, 'evenodd');
        }
      });
    }

    // Ripisylve : une bande de bois tracée le long des cours d'eau linéaires
    // (`waterway`) — pas un polygone du vectoriel, une **ligne**, peinte en
    // trait épais. Elle vit dans la même carte que n'importe quel autre bois,
    // donc elle est plantée par `vegetationLayer` avec les mêmes silhouettes
    // qu'une vraie forêt : c'est ce qui la distingue d'un alignement planté
    // (les platanes de bord de route, qui restent du mobilier ponctuel — voir
    // `furnitureLayer._applyRoadsidePlan`, `plan.alignmentTree`).
    //
    // Après les polygones, volontairement : le lit d'un ruisseau qui traverse
    // un champ de blé doit y remplacer la culture, pas l'inverse.
    {
      const waterways = this.theme.water.waterways;
      const bufferM = this.theme.water.riparianBufferM ?? 0;
      if (bufferM > 0) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = CLASS_FILL.wood;
        this.cropCtx.save();
        // `destination-out` : le lit efface la culture qui s'y trouvait, comme
        // le fait déjà `park` plus haut pour la même raison — un champ de blé
        // ne pousse pas sous un bosquet.
        this.cropCtx.globalCompositeOperation = 'destination-out';
        this.cropCtx.fillStyle = '#000';
        this.cropCtx.lineCap = 'round';
        this.cropCtx.lineJoin = 'round';

        source.forEachFeature('waterway', tiles, (geometry, properties) => {
          if (properties.brunnel === 'tunnel') return;
          if (properties.intermittent === 1 || properties.intermittent === true) return;
          // Un fossé n'a pas de ripisylve.
          if (properties.class === 'ditch') return;
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
            // Le trait ci-dessus est centré sur l'axe du cours d'eau, donc sa
            // moitié intérieure recouvre le lit lui-même — sans quoi la
            // ripisylve n'aurait pas sa largeur voulue sur chaque rive. Il
            // faut donc reprendre le lit : sans ce second trait, un large
            // cours d'eau se retrouve planté d'arbres jusqu'en son milieu,
            // qui poussent alors sous l'eau plutôt que sur la berge.
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

    // Le lit d'un grand cours d'eau (la Loire, par exemple) est un **polygone**
    // (`water`), pas seulement le trait `waterway` : la largeur de theme par
    // classe (`WATERWAY_CLASSES`) décrit un ruisseau, pas un fleuve, et la
    // ripisylve tracée ci-dessus autour de l'axe se retrouve alors plaquée à
    // quelques mètres du centre — en pleine eau, à des centaines de mètres de
    // la vraie berge. On efface donc, après coup, tout ce qui a été peint sous
    // l'emprise réelle de l'eau, quelle qu'en soit l'origine (ligne ou
    // polygone) : la vraie berge est ce contour-là, pas la largeur de theme.
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
