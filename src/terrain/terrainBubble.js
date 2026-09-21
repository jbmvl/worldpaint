/*
 * terrainBubble — la « bulle » de terrain qui suit l'observateur. Bloc carré
 * de tuiles centré sur l'observateur (geometry clipmap, Losasso & Hoppe,
 * SIGGRAPH 2004), rechargé tuile par tuile au franchissement d'une frontière.
 *
 * Ne porte que le relief : transforme le MNT en mailles, répond aux
 * questions d'altitude. Ce qui se pose dessus est décidé ailleurs
 * (`worldComposer`). Normales calculées analytiquement depuis le champ
 * d'altitude (pas `computeVertexNormals()`), pour un gradient continu d'une
 * tuile à l'autre.
 *
 * Deux choses perturbent le relief lu, dans cet ordre : la marche des falaises
 * (`setCliffCut`, qui comprime en paroi la rampe que le MNT étale), puis le
 * déblai des chaussées (`setRoadCut` — une route est taillée dans le versant,
 * pas posée dessus). La falaise façonne le terrain naturel, la route entaille
 * ce qu'elle trouve. Les deux sont des fonctions pures de la position au sol,
 * donc les tuiles voisines s'accordent au bord sans se consulter.
 * Chaque sommet porte aussi l'emprise routière (`roadMask`, `roadCutMaskAt`) :
 * ce que `terrainMaterial.js` ajoute après coup à la position — le grain low
 * poly — doit s'y éteindre, sans quoi il recreuserait par-dessus une chaussée
 * qu'on vient de tailler pour elle.
 *
 * L'eau, elle, ne touche pas au relief : c'est une matière du sol, pas une
 * surface (`groundClassMap`).
 *
 * Le MNT porte son propre zoom, réglé sur la résolution de sa source et non
 * sur la finesse de la maille. La bulle convertit donc ses coordonnées de
 * tuile chaque fois qu'elle le lit (`_sample`) ou le charge (`_demTiles`).
 */

import {
  createLocalFrame,
  tilesAround,
  tilesCovering,
  tileKey,
  lngLatToTile,
} from '../core/tileMath.js';
import { DEM_TILE_PIXELS } from '../core/elevationField.js';
import { TerrainMaterialFactory } from './terrainMaterial.js';
import { defaultTheme } from '../themes/default.js';
import {
  cutElevationAt,
  roadCutMaskAt,
  ROAD_CUT_M,
  ROAD_CUT_BLEND_M,
  ROAD_CUT_MAX_RING,
} from './roadCut.js';

/** Au-delà, l'approximation métrique du repère local dérive : on ré-ancre. */
const REANCHOR_DISTANCE_M = 20000;


export class TerrainBubble {
  /**
   * @param {Object} options
   * @param {Object} options.THREE           Module three.js (importé dynamiquement).
   * @param {Object} options.scene           Scène d'accueil.
   * @param {Object} options.elevation       Instance `ElevationField`.
   * @param {number} options.zoom            Zoom des tuiles.
   * @param {number} [options.blockSize]     Côté du bloc, en tuiles (impair).
   * @param {number[]} [options.segmentsByRing] Mailles par tuile et par côté,
   *        anneau par anneau. Rapport 2 d'un anneau au suivant, pour un raccord de bord exact (cf. `_buildMesh`).
   * @param {number} [options.verticalScale] Exagération du relief (1 = réel).
   * @param {Object} [options.groundClass] Instance `GroundClassMap`, transmise
   *        au matériau : c'est elle qui décide la matière du sol.
   */
  constructor({
    THREE,
    scene,
    elevation,
    zoom,
    blockSize = 9,
    segmentsByRing = [192, 96, 48],
    verticalScale = 1,
    groundClass = null,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.scene = scene;
    this.elevation = elevation;
    this.zoom = zoom;
    /** Coordonnées de tuile de la bulle → celles du MNT. */
    this._demScale = Math.pow(2, elevation.zoom - zoom);
    this.blockSize = blockSize % 2 === 0 ? blockSize + 1 : blockSize;
    this.segmentsByRing = segmentsByRing;
    this.verticalScale = verticalScale;

    this.group = new THREE.Group();
    this.group.name = 'terrain-bubble';
    scene.add(this.group);

    /** @type {Map<string, Object>} tuiles montées */
    this.tiles = new Map();
    this.frame = null;
    this.disposed = false;
    this._abort = new AbortController();
    this._centerTile = null;
    /** Incrémenté à chaque recentrage : sert à ignorer les chargements périmés. */
    this._generation = 0;
    /** @type {string[]} tuiles dont la finesse a changé, à recoudre. */
    this._rebuildQueue = [];

    /**
     * Numéro de surface, incrémenté chaque fois que la maille de terrain a
     * fini de changer de finesse — signal qu'attendent l'eau et les routes,
     * qui posent quelque chose sur le sol et gardent le résultat. Sans lui,
     * une tuile qui se rapproche voit sa maille s'affiner et le terrain
     * monter localement, recouvrant une nappe calculée sur l'ancienne résolution.
     */
    this._surfaceGeneration = 0;
    /** Vrai dès qu'une maille a changé de finesse, tant que la file n'est pas vide. */
    this._surfaceDirty = false;

    this.materials = new TerrainMaterialFactory({
      THREE,
      groundClass,
      look: theme.terrain,
      soils: theme.soils,
      stones: theme.stones,
      surfaces: theme.surfaces,
      streets: theme.streets,
    });

    /** Index des chaussées construites (`RoadIndex`), ou `null` — voir `setRoadCut`. */
    this._roadCut = null;
    /** Dalles de carrefour (`JunctionAreas`), ou `null` — elles s'entaillent aussi. */
    this._junctions = null;
    /** Incrémenté à chaque publication d'index : périme les mailles déjà creusées. */
    this._cutGeneration = 0;

    /** Falaises taillées (`CliffIndex`), ou `null` — voir `setCliffCut`. */
    this._cliffCut = null;
    /** Même rôle que `_cutGeneration`, pour la marche des falaises. */
    this._cliffGeneration = 0;
  }

  /**
   * Finesse de maille d'une tuile, d'après son anneau. L'anneau central
   * descend à ~4,4 m, les anneaux suivants relâchent. La maille est plus fine
   * que la grille du MNT : entre deux pixels d'altitude, ce que porte le
   * sommet est l'interpolation, pas une mesure.
   */
  segmentsForRing(ring) {
    const list = this.segmentsByRing;
    return list[Math.min(Math.max(0, ring), list.length - 1)];
  }

  /** Anneau d'une tuile dans le bloc courant. */
  ringOf(x, y) {
    if (!this._centerTile) return this.segmentsByRing.length - 1;
    return Math.max(Math.abs(x - this._centerTile.x), Math.abs(y - this._centerTile.y));
  }

  /** Finesse de maille d'une tuile donnée. */
  segmentsForTile(x, y) {
    return this.segmentsForRing(this.ringOf(x, y));
  }

  /** Numéro de la surface affichée. Change quand la maille a fini de se réajuster, pas pendant que la file se draine. */
  get surfaceGeneration() {
    return this._surfaceGeneration;
  }

  /**
   * Clôt un réajustement de finesse : la file est vide, la surface est
   * stable, ceux qui posent dessus peuvent se refaire une fois.
   */
  _settleSurface() {
    if (!this._surfaceDirty || this._rebuildQueue.length > 0) return;
    this._surfaceDirty = false;
    this._surfaceGeneration++;
  }

  /** Rayon approximatif de la bulle, en mètres. */
  get radiusMeters() {
    if (!this.frame) return 0;
    return (this.blockSize / 2) * this.frame.scale;
  }

  /**
   * Positionne (ou repositionne) la bulle autour d'un point géographique.
   * Idempotent : ne fait rien tant que l'observateur reste dans la tuile centrale.
   * @returns {Promise<boolean>} vrai si la bulle a bougé.
   */
  async setCenter(lng, lat) {
    if (this.disposed) return false;

    const t = lngLatToTile(lng, lat, this.zoom);
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);

    const needsFrame = !this.frame || this._frameTooFar(lng, lat);
    if (!needsFrame && this._centerTile && this._centerTile.x === cx && this._centerTile.y === cy) {
      return false;
    }

    if (needsFrame) {
      this._clearTiles();
      this.frame = createLocalFrame(lng, lat, this.zoom);
    }
    this._centerTile = { x: cx, y: cy };

    const generation = ++this._generation;
    const wanted = tilesAround(t.x, t.y, this.blockSize, this.zoom);
    const wantedKeys = new Set(wanted.map((w) => tileKey(w.z, w.x, w.y)));

    // Démonte ce qui sort de la bulle.
    for (const [key, tile] of this.tiles) {
      if (!wantedKeys.has(key)) {
        this._disposeTile(tile);
        this.tiles.delete(key);
      }
    }

    // Enregistre les nouvelles tuiles (anneau mis à jour pour les anciennes).
    for (const w of wanted) {
      const key = tileKey(w.z, w.x, w.y);
      const existing = this.tiles.get(key);
      if (existing) {
        existing.ring = w.ring;
        continue;
      }
      this.tiles.set(key, { key, x: w.x, y: w.y, ring: w.ring, mesh: null, edgeIncomplete: true });
    }

    // Le relief d'abord : une maille construite sans ses voisines aurait des
    // bords faux. Le MNT étant plus grossier, plusieurs tuiles de la bulle
    // tombent dans la même : on dédoublonne sans défaire l'ordre de
    // `tilesAround`, qui sert d'abord ce que l'observateur a sous les roues.
    const demTiles = new Map();
    for (const w of wanted) {
      for (const d of this._demTiles(w.x, w.y)) {
        const key = tileKey(d.z, d.x, d.y);
        if (!demTiles.has(key)) demTiles.set(key, d);
      }
    }
    await Promise.all(
      [...demTiles.values()].map((d) => this.elevation.load(d.x, d.y, this._abort.signal))
    );
    if (this.disposed || generation !== this._generation) return true;

    // Une tuile sans géométrie est construite tout de suite ; une tuile dont
    // seule la finesse a changé garde la sienne et passe par la file.
    this._rebuildQueue.length = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.mesh) this._buildMesh(tile);
      else if (tile.edgeIncomplete && this._neighboursLoaded(tile.x, tile.y)) this._buildMesh(tile);
      else if (this._meshOutdated(tile)) this._rebuildQueue.push(tile.key);
    }

    // Rien à recoudre : la surface est déjà stable, on la clôt tout de suite.
    this._settleSurface();

    return true;
  }

  _frameTooFar(lng, lat) {
    if (!this.frame) return true;
    const p = this.frame.toLocal(lng, lat);
    return Math.hypot(p.x, p.z) > REANCHOR_DISTANCE_M;
  }

  _neighboursLoaded(x, y) {
    // L'échantillonnage d'un bord lit les pixels d'en face : il faut tout le
    // MNT qui couvre la tuile et ses huit voisines.
    return this._demTiles(x - 1, y - 1, 3).every((d) => this.elevation.has(d.x, d.y));
  }

  /**
   * Un pixel du MNT, en unités de tuile de la bulle : pas du gradient. Lu à
   * chaque maille et non figé, la résolution des tuiles n'étant connue qu'une
   * fois la première décodée.
   */
  get _gradientStep() {
    return 1 / ((this.elevation.tilePixels || DEM_TILE_PIXELS) * this._demScale);
  }

  /** Tuiles du MNT couvrant `span` tuiles de bulle à partir de (x, y). */
  _demTiles(x, y, span = 1) {
    return tilesCovering(x, y, span, this.zoom, this.elevation.zoom);
  }

  /** Altitude du MNT, en coordonnées de tuile **de la bulle**. */
  _sample(tx, ty, fallback = 0) {
    return this.elevation.sampleTile(tx * this._demScale, ty * this._demScale, fallback);
  }

  /** Altitude brute du MNT sous un point géographique, en mètres. */
  getElevation(lng, lat, fallback = 0) {
    const t = lngLatToTile(lng, lat, this.zoom);
    return this._sample(t.x, t.y, fallback);
  }

  /**
   * Altitude de la surface effectivement affichée, et non du MNT continu (un
   * objet posé sur le MNT continu flotterait au-dessus des bosses). Interpole
   * entre les mêmes sommets que ceux de la maille.
   *
   * @param {number} tx Abscisse de tuile fractionnaire.
   * @param {number} ty Ordonnée de tuile fractionnaire.
   */
  surfaceElevationAtTile(tx, ty, fallback = 0) {
    // Reste un écart résiduel dans la bande de mailles collée à une frontière
    // d'anneau, recousue à la résolution du voisin (`_buildMesh`) : quelques
    // centimètres, absorbés par le lissage longitudinal des rubans.
    const n = this.segmentsForTile(Math.floor(tx), Math.floor(ty));
    const gx = tx * n;
    const gy = ty * n;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;

    const sample = (i, j) => this._sample(i / n, j / n, fallback);
    const a = sample(i0, j0);
    const b = sample(i0 + 1, j0);
    const c = sample(i0, j0 + 1);
    const d = sample(i0 + 1, j0 + 1);

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }

  /**
   * Idem, à partir de coordonnées métriques locales, déblai compris — c'est
   * cette variante que tout le décor doit employer. Le calcul des
   * plate-formes de chaussée passe par `rawSurfaceElevationAtLocal` : le
   * déblai dérive de la plate-forme, pas l'inverse.
   */
  surfaceElevationAtLocal(x, z, fallback = 0) {
    if (!this.frame) return fallback;
    return this.cutElevation(x, z, this.rawSurfaceElevationAtLocal(x, z, fallback));
  }

  /** Altitude de la surface affichée **avant** déblai. */
  rawSurfaceElevationAtLocal(x, z, fallback = 0) {
    if (!this.frame) return fallback;
    const { origin, scale } = this.frame;
    return this.surfaceElevationAtTile(origin.x + x / scale, origin.y + z / scale, fallback);
  }

  /**
   * Publie l'emprise des chaussées et remet en file les tuiles à entailler. Les
   * tuiles passent par la file drainée une par image, sinon recreuser toutes
   * les mailles d'un coup produirait un à-coup net.
   *
   * Deux choses à entailler, et non une seule : les rubans (`index`) et les
   * **dalles de carrefour** (`areas`). Une dalle déborde des rubans qui
   * l'alimentent — ses arcs de raccordement bombent au-delà de leurs rives —,
   * si bien qu'une entaille tirée des seuls rubans laissait le terrain remonter
   * dans les coins d'un carrefour et passer par-dessus sa chaussée.
   *
   * @param {Object|null} index Instance `RoadIndex`, ou `null` pour ne rien creuser.
   * @param {Object|null} [areas] Instance `JunctionAreas`, cotes posées.
   */
  setRoadCut(index, areas = null) {
    if (this.disposed) return;
    this._roadCut = index || null;
    this._junctions = (index && areas) || null;
    this._cutGeneration++;
    for (const tile of this.tiles.values()) {
      if (tile.ring > ROAD_CUT_MAX_RING) continue;
      if (!this._rebuildQueue.includes(tile.key)) this._rebuildQueue.push(tile.key);
    }
  }

  /**
   * Altitude entaillée en un point : le terrain descend jusqu'à la
   * plate-forme de la chaussée qui passe là, remonte progressivement ensuite.
   * Ce niveau-ci ne fait que l'interrogation spatiale ; le profil est dans
   * `cutElevationAt`, pur et testé.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @param {number} raw Altitude naturelle, en mètres (échelle du MNT).
   */
  cutElevation(x, z, raw) {
    // La falaise d'abord : elle façonne le relief naturel, que la chaussée
    // entaille ensuite. L'ordre inverse taillerait la route dans la rampe que
    // la marche vient de supprimer.
    const stepped = this._cliffCut ? this._cliffCut.elevationAt(x, z, raw) : raw;
    return this._roadCutAt(x, z, stepped);
  }

  /**
   * Publie les falaises taillées (`CliffIndex`), ou `null`.
   *
   * Seules les tuiles qu'une falaise touche sont périmées — celles que la
   * nouvelle atteint, et celles que l'ancienne atteignait. Périmer tout le
   * bloc à chaque publication reconstruisait le terrain sans fin : la file
   * n'en rend qu'une par image, et la publication suivante arrivait avant
   * qu'elle ne soit vidée. Le décor entier ramait, falaise ou pas.
   */
  setCliffCut(index) {
    if (this.disposed) return;
    const previous = this._cliffCut;
    if (!previous && !index) return;

    this._cliffCut = index || null;
    this._cliffGeneration++;
    for (const tile of this.tiles.values()) {
      if (!tile.hadCliff && !this._cliffTouches(tile)) continue;
      if (!this._rebuildQueue.includes(tile.key)) this._rebuildQueue.push(tile.key);
    }
  }

  /** Vrai si une falaise publiée peut modifier cette tuile. */
  _cliffTouches(tile) {
    if (!this._cliffCut || !this.frame) return false;
    const a = this.frame.tileToLocal(tile.x, tile.y);
    const b = this.frame.tileToLocal(tile.x + 1, tile.y + 1);
    return this._cliffCut.touches(
      Math.min(a.x, b.x),
      Math.min(a.z, b.z),
      Math.max(a.x, b.x),
      Math.max(a.z, b.z)
    );
  }

  /** Creuse le déblai d'une chaussée. Profil dans `cutElevationAt`, pur et testé. */
  _roadCutAt(x, z, raw) {
    return this._roadCutWithMask(x, z, raw).elevation;
  }

  /**
   * Le déblai, et l'emprise routière au même point (`roadCutMaskAt`) — pour
   * que `_buildMesh` puisse éteindre ce qu'il ajoute après coup au sommet
   * (le grain low poly de `terrainMaterial.js`) sans recreuser une seconde
   * fois la chaussée à la main. Une seule interrogation de l'index par
   * sommet ; `_roadCutAt` s'appuie dessus pour garder sa propre signature.
   */
  _roadCutWithMask(x, z, raw) {
    const index = this._roadCut;
    if (!index) return { elevation: raw, mask: 0 };

    // La dalle d'un carrefour d'abord : c'est elle qui est dessinée là, et elle
    // déborde des rubans. Le sol y descend jusqu'à la dalle, sans raccord — ce
    // sont les rubans alentour qui ramènent l'entaille au terrain naturel.
    const slab = this._junctions?.deckAt(x, z);
    if (slab != null) {
      const scale = this.verticalScale || 1;
      return { elevation: Math.min(raw, slab / scale), mask: 1 };
    }

    const hit = index.query(x, z, ROAD_CUT_M + ROAD_CUT_BLEND_M);
    if (!hit) return { elevation: raw, mask: 0 };
    const deck = index.deckAt(hit);
    if (deck == null) return { elevation: raw, mask: 0 };

    // La plate-forme est en unités de scène (déjà multipliée par l'exagération
    // verticale) ; `raw` est en unités de MNT. On compare dans le même espace.
    const scale = this.verticalScale || 1;
    return {
      elevation: cutElevationAt(raw, deck / scale, hit.distance, hit.segment.halfWidth),
      mask: roadCutMaskAt(hit.distance, hit.segment.halfWidth),
    };
  }

  /** Position dans le repère local, posée sur la surface affichée. */
  toScenePosition(lng, lat, heightAboveGround = 0) {
    if (!this.frame) return { x: 0, y: heightAboveGround, z: 0 };
    const p = this.frame.toLocal(lng, lat);
    const t = lngLatToTile(lng, lat, this.zoom);
    const raw = this.surfaceElevationAtTile(t.x, t.y);
    const ground = this.cutElevation(p.x, p.z, raw) * this.verticalScale;
    return { x: p.x, y: ground + heightAboveGround, z: p.z };
  }

  /**
   * Altitude d'un point de bord, échantillonnée à la résolution `m` — la
   * couture entre deux anneaux de finesse différente. Sans elle, un bord à
   * 192 sommets face à un bord à 96 s'écarterait, laissant une fente ouverte
   * sur le ciel.
   */
  _edgeElevation(t, m, sampleAt) {
    const g = t * m;
    const k = Math.floor(g);
    const f = g - k;
    if (f <= 0) return sampleAt(k / m);
    return sampleAt(k / m) * (1 - f) + sampleAt((k + 1) / m) * f;
  }

  /** Résolution retenue sur chaque bord : celle du voisin s'il est plus grossier, la nôtre sinon. */
  _edgeSegmentsFor(tile, n) {
    return {
      north: Math.min(n, this.segmentsForTile(tile.x, tile.y - 1)),
      south: Math.min(n, this.segmentsForTile(tile.x, tile.y + 1)),
      west: Math.min(n, this.segmentsForTile(tile.x - 1, tile.y)),
      east: Math.min(n, this.segmentsForTile(tile.x + 1, tile.y)),
    };
  }

  /** Vrai si la géométrie d'une tuile ne correspond plus à ce qu'elle devrait être (anneau, finesse, ou couture de bord). */
  _meshOutdated(tile) {
    if (!tile.mesh || !tile.edgeSegments) return true;
    const n = this.segmentsForTile(tile.x, tile.y);
    if (tile.segments !== n) return true;
    // Un nouvel index de chaussées périme le terrassement déjà creusé.
    if (tile.ring <= ROAD_CUT_MAX_RING && tile.cutGeneration !== this._cutGeneration) return true;
    // Celui des falaises périme tous les anneaux — la marche se voit de loin —
    // mais seulement les tuiles qu'une falaise touche, ou touchait.
    if (
      tile.cliffGeneration !== this._cliffGeneration &&
      (tile.hadCliff || this._cliffTouches(tile))
    ) {
      return true;
    }
    const wanted = this._edgeSegmentsFor(tile, n);
    return (
      wanted.north !== tile.edgeSegments.north ||
      wanted.south !== tile.edgeSegments.south ||
      wanted.west !== tile.edgeSegments.west ||
      wanted.east !== tile.edgeSegments.east
    );
  }

  /** Reconstruit au plus une tuile périmée, une fois par image (recoudre tout d'un coup ferait un à-coup net). */
  processRebuildQueue() {
    if (this.disposed || this._rebuildQueue.length === 0) return false;
    const key = this._rebuildQueue.shift();
    const tile = this.tiles.get(key);
    if (tile && this._meshOutdated(tile)) this._buildMesh(tile);
    this._settleSurface();
    return true;
  }

  _buildMesh(tile) {
    const { THREE } = this;
    const n = this.segmentsForTile(tile.x, tile.y);
    const count = (n + 1) * (n + 1);

    const edge = this._edgeSegmentsFor(tile, n);

    // Pas de coordonnées de texture : la matière est projetée en coordonnées monde par le shader.
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    // Emprise routière par sommet : 1 recreusé pour la chaussée, 0 en terrain
    // naturel — lue par `terrainMaterial.js` pour éteindre le grain low poly
    // sur ce qui vient d'être excavé pour elle (voir `roadCutMaskAt`).
    const roadMask = new Float32Array(count);

    const scale = this.frame.scale;
    const stepMeters = this._gradientStep * scale;
    // Le déblai ne s'applique qu'aux tuiles proches (au-delà, la requête
    // d'index ne rendrait rien). La falaise, elle, se voit de loin : elle
    // taille tous les anneaux.
    const carving = !!this._roadCut && tile.ring <= ROAD_CUT_MAX_RING;
    // Tranché une fois pour la tuile entière : sans ça, chaque sommet
    // interrogeait l'index cinq fois pour s'entendre dire qu'il n'y a pas de
    // falaise ici, soit deux cent mille requêtes inutiles par tuile.
    const stepping = this._cliffTouches(tile);
    // Gradient pris sur le terrain façonné, sinon l'éclairage du fond du
    // déblai — ou de la paroi — serait celui du versant.
    const cut =
      carving || stepping
        ? (x, z, raw) => {
            const stepped = stepping ? this._cliffCut.elevationAt(x, z, raw) : raw;
            return carving ? this._roadCutAt(x, z, stepped) : stepped;
          }
        : (x, z, raw) => raw;
    const cutWithMask =
      carving || stepping
        ? (x, z, raw) => {
            const stepped = stepping ? this._cliffCut.elevationAt(x, z, raw) : raw;
            return carving ? this._roadCutWithMask(x, z, stepped) : { elevation: stepped, mask: 0 };
          }
        : (x, z, raw) => ({ elevation: raw, mask: 0 });

    for (let j = 0; j <= n; j++) {
      const v = j / n;
      const ty = tile.y + v;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const tx = tile.x + u;
        const idx = j * (n + 1) + i;

        const local = this.frame.tileToLocal(tx, ty);

        // Bords recousus sur la résolution du voisin.
        let raw;
        if (j === 0) raw = this._edgeElevation(u, edge.north, (a) => this._sample(tile.x + a, tile.y));
        else if (j === n) raw = this._edgeElevation(u, edge.south, (a) => this._sample(tile.x + a, tile.y + 1));
        else if (i === 0) raw = this._edgeElevation(v, edge.west, (a) => this._sample(tile.x, tile.y + a));
        else if (i === n) raw = this._edgeElevation(v, edge.east, (a) => this._sample(tile.x + 1, tile.y + a));
        else raw = this._sample(tx, ty);

        // Le déblai est une fonction du seul point du sol, donc la couture des bords reste exacte.
        const atVertex = cutWithMask(local.x, local.z, raw);
        const h = atVertex.elevation * this.verticalScale;

        positions[idx * 3] = local.x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = local.z;
        roadMask[idx] = atVertex.mask;

        // Gradient central : continu au travers des frontières de tuiles.
        const hE = cut(local.x + stepMeters, local.z, this._sample(tx + this._gradientStep, ty)) * this.verticalScale;
        const hW = cut(local.x - stepMeters, local.z, this._sample(tx - this._gradientStep, ty)) * this.verticalScale;
        const hS = cut(local.x, local.z + stepMeters, this._sample(tx, ty + this._gradientStep)) * this.verticalScale;
        const hN = cut(local.x, local.z - stepMeters, this._sample(tx, ty - this._gradientStep)) * this.verticalScale;

        let nx = -(hE - hW) / (2 * stepMeters);
        let nz = -(hS - hN) / (2 * stepMeters);
        const len = Math.hypot(nx, 1, nz) || 1;
        normals[idx * 3] = nx / len;
        normals[idx * 3 + 1] = 1 / len;
        normals[idx * 3 + 2] = nz / len;
      }
    }

    const indices = new (count > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        // Enroulement anti-horaire vu du dessus → normale géométrique vers +y.
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('roadMask', new THREE.BufferAttribute(roadMask, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    if (tile.mesh) {
      tile.mesh.geometry.dispose();
      tile.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.materials.material);
      mesh.name = `terrain-${tile.key}`;
      mesh.matrixAutoUpdate = false;
      // Reçoit les ombres mais n'en projette pas (des mailles de 18 m s'auto-ombreraient en rayures).
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      tile.mesh = mesh;
      this.group.add(mesh);
    }
    // Une maille qui change de finesse déplace la surface.
    if (tile.segments !== n) this._surfaceDirty = true;
    tile.segments = n;
    tile.edgeSegments = edge;
    tile.cutGeneration = this._cutGeneration;
    tile.cliffGeneration = this._cliffGeneration;
    tile.hadCliff = stepping;
    tile.edgeIncomplete = !this._neighboursLoaded(tile.x, tile.y);
  }

  /** Transmet l'anisotropie maximale du renderer (appelé une fois au montage). */
  setMaxAnisotropy(value) {
    this.materials.setMaxAnisotropy(value);
  }

  _disposeTile(tile) {
    if (!tile.mesh) return;
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh = null;
  }

  _clearTiles() {
    for (const tile of this.tiles.values()) this._disposeTile(tile);
    this.tiles.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._abort.abort();
    this._roadCut = null;
    this._junctions = null;
    this._rebuildQueue.length = 0;
    this._clearTiles();
    this.materials.dispose();
    this.scene.remove(this.group);
  }
}
