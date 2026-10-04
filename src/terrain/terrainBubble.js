import { cutWaterTerrain, terrainFragmentGeometry } from './waterTerrainCut.js';
import { GenerationBudget } from '../core/generationBudget.js';
import { finishGeneration } from '../core/generationSteps.js';
/*
 * terrainBubble — la « bulle » de terrain qui suit l'observateur. Bloc carré
 * de tuiles centré sur l'observateur (geometry clipmap, Losasso & Hoppe,
 * SIGGRAPH 2004), rechargé tuile par tuile au franchissement d'une frontière.
 *
 * Ne porte que le relief : transforme le MNT en mailles, répond aux
 * questions d'altitude. Ce qui se pose dessus est décidé ailleurs
 * (`worldComposer`). Normales calculées analytiquement depuis le champ
 * d'altitude (pas `computeVertexNormals()`), pour un gradient continu d'une
 * tuile à l'autre. Les tuiles neuves rendent la main entre deux maillages
 * après le budget CPU ; les changements de finesse passent par la file.
 *
 * Deux choses perturbent le relief lu, dans cet ordre : la marche des falaises
 * (`setCliffCut`, qui comprime en paroi la rampe que le MNT étale), puis les
 * terrassements locaux des franchissements (remblais et tranchées), puis le
 * déblai des chaussées (`setRoadCut` — une route est taillée dans le versant,
 * pas posée dessus). La falaise façonne le terrain naturel, la route entaille
 * ce qu'elle trouve. Les deux sont des fonctions pures de la position au sol,
 * donc les tuiles voisines s'accordent au bord sans se consulter.
 * Le fond plat du déblai ne peut pas être plus étroit qu'une maille, sans quoi
 * aucun sommet n'y tombe et le triangle enjambe la chaussée (`cutBenchM`).
 * Toutes les rues et dalles voisines participent au déblai ; leurs plis
 * imposent la cote basse à portée de la maille, même sous une rue plus haute.
 * Chaque sommet porte aussi l'emprise routière (`roadMask`, `roadCutMaskAt`) :
 * ce que `terrainMaterial.js` ajoute après coup à la position — le grain low
 * poly — doit s'y éteindre, sans quoi il recreuserait par-dessus une chaussée
 * qu'on vient de tailler pour elle.
 *
 * L'eau remplace seulement le rendu dans son emprise. La grille complète
 * reste le support des appuis et des tunnels ; les niveaux viennent du MNT.
 *
 * Le MNT porte son propre zoom, réglé sur la résolution de sa source et non
 * sur la finesse de la maille. La bulle convertit donc ses coordonnées de
 * tuile chaque fois qu'elle le lit (`_sample`) ou le charge (`_demTiles`).
 */

import { meshSupport } from './meshSupport.js';
import {
  createLocalFrame,
  tilesAround,
  tilesCovering,
  tileKey,
  lngLatToTile,
  tileSizeMeters,
} from '../core/tileMath.js';
import { REACH_MARGIN, REACH_MARGIN_M } from '../core/decorReach.js';
import { DEM_TILE_PIXELS } from '../core/elevationField.js';
import { TerrainMaterialFactory } from './terrainMaterial.js';
import { defaultTheme } from '../themes/default.js';
import {
  cutElevationAt,
  lowestRoadDeckAt,
  cutBenchAt,
  roadCutMaskAt,
  ROAD_CUT_BLEND_M,
  ROAD_CUT_MAX_RING,
} from './roadCut.js';

/** Au-delà, l'approximation métrique du repère local dérive : on ré-ancre. */
const REANCHOR_DISTANCE_M = 20000;
/** Temps CPU par image accordé à la reconstruction d'une tuile en file. */
const TERRAIN_REBUILD_BUDGET_MS = 4;


export class TerrainBubble {
  /**
   * @param {Object} options
   * @param {Object} options.THREE           Module three.js (importé dynamiquement).
   * @param {Object} options.scene           Scène d'accueil.
   * @param {Object} options.elevation       Instance `ElevationField`.
   * @param {number} options.zoom            Zoom des tuiles.
   * @param {number} [options.blockSize]     Côté du bloc, en tuiles (impair).
   * @param {number[]} [options.segmentsByRing] Mailles par tuile et par côté,
   *        anneau par anneau. Le bord commun à deux finesses est rééchantillonné
   *        sur la plus grossière (`_buildMesh`), quel que soit leur rapport.
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
    reach = Infinity,
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
    /** Portée du décor autour de l'observateur, en mètres (`createWorld({ reach })`). */
    this._reach = Number.isFinite(reach) && reach > 0 ? reach : Infinity;
    /** Disque de la portée autour du dernier centre, `null` sans portée : le déblai s'y limite. */
    this._reachDisc = null;

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
    this._pendingBuild = null;

    /**
     * Numéro de surface, incrémenté chaque fois que la maille de terrain a
     * fini de changer de finesse — signal qu'attendent l'eau et les routes,
     * qui posent quelque chose sur le sol et gardent le résultat. Sans lui,
     * une tuile qui se rapproche voit sa maille s'affiner et le terrain
     * monter localement, recouvrant une nappe calculée sur l'ancienne résolution.
     */
    this._surfaceGeneration = 0;
    this._waterGeneration = 0;
    this._waterSurface = null;
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
    /** Index des chemins de terre, grain éteint sans déblai — voir `setRoadCut`. */
    this._unpaved = null;
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

  /**
   * Largeur du fond plat de l'entaille, en mètres — la cote que tout ce qui
   * borde une chaussée doit lire (`roadCut.cutBenchAt`). Tirée de la maille la
   * plus grossière qui soit creusée, donc constante tant que la bulle l'est.
   */
  get cutBenchM() {
    if (!this.frame) return cutBenchAt(0);
    return cutBenchAt(this.frame.scale / this.segmentsForRing(ROAD_CUT_MAX_RING));
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

  /**
   * Portée demandée au décor, en mètres, ou `Infinity` : les couches la
   * combinent à leur propre rayon par `Math.min`, sans jamais l'étendre.
   */
  get reachMeters() {
    return this._reach;
  }

  /** Rayon approximatif de la bulle, en mètres. */
  get radiusMeters() {
    if (!this.frame) return 0;
    return (this.blockSize / 2) * this.frame.scale;
  }

  /**
   * Positionne (ou repositionne) la bulle autour d'un point géographique.
   * Idempotent : ne fait rien tant que l'observateur reste dans la tuile centrale.
   * @param {Object} [options]
   * @param {boolean} [options.meshes] Faux : les tuiles neuves attendent dans
   *        la file au lieu d'être maillées tout de suite — pour qui refait le
   *        décor aussitôt, dont le déblai les remaillerait de toute façon.
   * @param {number} [options.budgetMs] Temps CPU entre deux pauses.
   * @returns {Promise<boolean>} vrai si la bulle a bougé.
   */
  async setCenter(lng, lat, { meshes = true, budgetMs } = {}) {
    if (this.disposed) return false;

    const t = lngLatToTile(lng, lat, this.zoom);
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);

    const needsFrame = !this.frame || this._frameTooFar(lng, lat);
    if (needsFrame) {
      this._clearTiles();
      this.frame = createLocalFrame(lng, lat, this.zoom);
    }
    if (Number.isFinite(this._reach)) {
      const here = this.frame.toLocal(lng, lat);
      const radius = this._reach * REACH_MARGIN + REACH_MARGIN_M;
      this._reachDisc = { x: here.x, z: here.z, radius2: radius * radius };
    }
    if (!needsFrame && this._centerTile && this._centerTile.x === cx && this._centerTile.y === cy) {
      return false;
    }
    this._centerTile = { x: cx, y: cy };

    const generation = ++this._generation;
    const wanted = this._withinReach(tilesAround(t.x, t.y, this.blockSize, this.zoom), t, lat);
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
    this._cancelPendingBuild();
    const budget = new GenerationBudget(budgetMs ? { milliseconds: budgetMs } : undefined);
    for (const tile of this.tiles.values()) {
      if (!meshes) {
        this._rebuildQueue.push(tile.key);
        continue;
      }
      const now = !tile.mesh || (tile.edgeIncomplete && this._neighboursLoaded(tile.x, tile.y));
      if (!now && this._meshOutdated(tile)) this._rebuildQueue.push(tile.key);
      for (const _ of now ? this._buildMeshSteps(tile) : []) {
        await budget.checkpoint();
        if (this.disposed || generation !== this._generation) return true;
      }
      await budget.checkpoint();
      if (this.disposed || generation !== this._generation) return true;
    }

    // Rien à recoudre : la surface est déjà stable, on la clôt tout de suite.
    this._settleSurface();

    return true;
  }

  /**
   * Une scène figée (`reach`) ne monte que les tuiles de terrain qui touchent
   * sa portée, marge comprise : au-delà, le brouillard les cache déjà. Le
   * maillage d'une tuile ne lit que le MNT de ses voisines, pas leur maillage.
   * La tuile centrale reste toujours.
   */
  _withinReach(wanted, t, lat) {
    if (!Number.isFinite(this._reach)) return wanted;
    const span = (this._reach * REACH_MARGIN + REACH_MARGIN_M) / tileSizeMeters(this.zoom, lat);
    const world = Math.pow(2, this.zoom);
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    const delta = (a, b) => ((((a - b) % world) + world + world / 2) % world) - world / 2;
    const gap = (offset, at) => Math.max(offset - at, at - (offset + 1), 0);
    return wanted.filter((w) => {
      const fx = t.x - cx;
      const fy = t.y - cy;
      const dx = delta(w.x, cx);
      const dy = w.y - cy;
      return (dx === 0 && dy === 0) || Math.hypot(gap(dx, fx), gap(dy, fy)) <= span;
    });
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
  getElevation(lng, lat, fallback = 0, { strict = false } = {}) {
    const t = lngLatToTile(lng, lat, this.zoom);
    return strict ? this.elevation.sampleTileStrict(t.x * this._demScale, t.y * this._demScale) : this._sample(t.x, t.y, fallback);
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

  /** Appui sur la géométrie chargée, en mètres de scène, hors déplacement GPU. */
  plantSupportTiles(x, z, radius) {
    const selected = [];
    for (const tile of this.tiles.values()) {
      const geometry = tile.supportGeometry ?? tile.mesh?.geometry;
      if (!geometry) continue;
      const p = geometry.attributes.position.array;
      const size = p[tile.segments * 3] - p[0];
      if (x+radius < p[0] || x-radius > p[0]+size || z+radius < p[2] || z-radius > p[2]+size) continue;
      selected.push({ key: tile.key, geometry, segments: tile.segments, size });
    }
    return selected;
  }

  renderedSupportAtLocal(x, z, out = {}) {
    if (!this.frame) return null;
    const { origin, scale } = this.frame;
    const tx = Math.floor(origin.x + x / scale), tz = Math.floor(origin.y + z / scale);
    const tile = this.tiles.get(tileKey(this.zoom, tx, tz));
    return meshSupport(tile?.supportGeometry ?? tile?.mesh?.geometry, tile?.segments,
      (tx-origin.x)*scale, (tz-origin.y)*scale, scale, x, z, out);
  }

  /**
   * Idem, à partir de coordonnées métriques locales, déblai compris — c'est
   * cette variante que tout le décor doit employer. Le calcul des
   * plate-formes de chaussée passe par `naturalElevationAtLocal` : le
   * déblai dérive de la plate-forme, pas l'inverse.
   */
  surfaceElevationAtLocal(x, z, fallback = 0) {
    if (!this.frame) return fallback;
    return this.cutElevation(x, z, this.rawSurfaceElevationAtLocal(x, z, fallback));
  }

  /**
   * Altitude du MNT, sans la marche des falaises ni le déblai. Seule la couche
   * des falaises doit la lire : c'est sur elle qu'elle mesure la marche.
   */
  rawSurfaceElevationAtLocal(x, z, fallback = 0) {
    if (!this.frame) return fallback;
    const { origin, scale } = this.frame;
    return this.surfaceElevationAtTile(origin.x + x / scale, origin.y + z / scale, fallback);
  }

  /**
   * Terrain naturel : le MNT, falaises comprises, **avant** déblai. C'est sur
   * lui que se dressent les plates-formes : au pied d'une falaise, une route
   * posée sur la rampe que le MNT étale flotterait au-dessus du sol affiché.
   */
  naturalElevationAtLocal(x, z, fallback = 0) {
    const raw = this.rawSurfaceElevationAtLocal(x, z, fallback);
    return this._cliffCut ? this._cliffCut.elevationAt(x, z, raw) : raw;
  }

  /**
   * Publie l'emprise des chaussées et remet en file les tuiles à entailler. Les
   * tuiles passent par la file drainée une par image, sinon recreuser toutes
   * les mailles d'un coup produirait un à-coup net.
   *
   * Deux choses à entailler, et non une seule : les rubans (`index`) et les
   * **dalles de carrefour** (`areas`). Une dalle déborde des rubans qui
   * l'alimentent — ses arcs de raccordement bombent au-delà de leurs rives —,
   * si bien qu'une entaille tirée des seuls rubans laisse le terrain remonter
   * dans les coins d'un carrefour et passer par-dessus sa chaussée. Les deux
   * s'entaillent au même profil, fond plat et raccord compris.
   *
   * @param {Object|null} index Instance `RoadIndex`, ou `null` pour ne rien creuser.
   * @param {Object|null} [areas] Instance `JunctionAreas`, cotes posées.
   * @param {Object|null} [earthworks] Terrassements des franchissements.
   * @param {Object|null} [unpavedIndex] `RoadIndex` des chemins de terre : le
   *        sol n'y est pas entaillé, seul le grain low poly s'y éteint.
   */
  setRoadCut(index, areas = null, earthworks = null, unpavedIndex = null) {
    if (this.disposed) return;
    this._roadCut = index || null;
    this._unpaved = unpavedIndex || null;
    this._earthworks = earthworks;
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

  /**
   * Creuse le déblai d'une chaussée. Profil dans `cutElevationAt`, pur et testé.
   *
   * Plusieurs chaussées et dalles peuvent porter sur un même sommet. Le
   * terrain doit passer sous toutes, donc on retient la plus basse des
   * entailles à portée plutôt que de s'arrêter à la plus proche.
   */
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
    // Au-delà de la portée, aucune chaussée n'est posée : rien à creuser.
    const disc = this._reachDisc;
    if (disc && (x - disc.x) ** 2 + (z - disc.z) ** 2 > disc.radius2) return { elevation: raw, mask: 0 };
    let earth = this._earthworks?.sample(x, z, raw) ?? { elevation: raw, mask: 0 };
    raw = earth.elevation;
    const unpaved = this._unpaved?.query(x, z, this.cutBenchM + ROAD_CUT_BLEND_M);
    if (unpaved) {
      const mask = roadCutMaskAt(unpaved.distance, unpaved.segment.halfWidth, this.cutBenchM);
      earth = { ...earth, mask: Math.max(earth.mask, mask) };
    }
    const index = this._roadCut;
    if (!index) return earth;

    // La plate-forme est en unités de scène (déjà multipliée par l'exagération
    // verticale) ; `raw` est en unités de MNT. On compare dans le même espace.
    const scale = this.verticalScale || 1;
    const bench = this.cutBenchM;
    const reach = bench + ROAD_CUT_BLEND_M;
    let elevation = raw;
    let mask = earth.mask;

    // Toutes les chaussées à portée, pas la plus proche : en ville, le sommet
    // le plus proche d'une rue tombe souvent dans le fond plat de sa voisine,
    // plus basse, et la corde du terrain passerait par-dessus celle-ci.
    // Être sous une chaussée ne dispense pas de creuser pour sa voisine :
    // les mêmes sommets portent les triangles qui traversent les deux.
    // La dalle n'a pas de demi-largeur : son fond plat se mesure depuis son
    // contour, à sa cote la plus basse sur une diagonale de maille (`bench`),
    // sans quoi la corde du terrain passe au-dessus de ses plis.
    const slabs = this._junctions?.deckSamplesNear?.(x, z, reach, null, bench) ??
      [this._junctions?.deckNear(x, z, reach, undefined, bench)].filter(Boolean);
    const hits = index.queryAll(x, z, reach);
    const cuts = [];
    for (const hit of hits) {
      // Un sommet au-delà du seuil appartient aussi aux triangles de l'accès,
      // dans le dégagement du portail ; la galerie elle-même reste exclue.
      const at = index.deckAt(hit) ?? (hit.covered ?
        hit.segment.platform[hit.row]+(hit.segment.platform[hit.row+1]-hit.segment.platform[hit.row])*hit.t : null);
      if (at == null) continue;
      const deck = Math.min(at, lowestRoadDeckAt(hit, bench));
      cuts.push({ deck: deck / scale, distance: hit.distance, halfWidth: hit.segment.halfWidth });
      mask = Math.max(mask, roadCutMaskAt(hit.distance, hit.segment.halfWidth, bench));
    }
    for (const slab of slabs) {
      cuts.push({ deck: slab.deck / scale, distance: slab.distance, halfWidth: 0 });
      mask = Math.max(mask, roadCutMaskAt(slab.distance, 0, bench));
    }
    elevation = cuts.reduce((low, c) => Math.min(low,
      cutElevationAt(raw, c.deck, c.distance, c.halfWidth, bench)), elevation);
    // Le rail supérieur garde son appui prescrit au-dessus d’une galerie.
    // Un appui routier ne peut pas relever les triangles de la rue basse.
    if (Number.isFinite(earth.railSupport)) elevation = Math.max(elevation, earth.railSupport);
    return { elevation, mask };
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
    if (tile.waterGeneration !== this._waterGeneration && (tile.hadWater || this._waterTouches(tile))) return true;
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

  /**
   * Fait avancer la reconstruction d'une tuile périmée dans la limite de
   * `budgetMs` ; une tuile au plus s'achève par appel. La tuile garde sa
   * géométrie jusqu'au bout, et une reconstruction dont l'entaille, la
   * falaise ou le MNT ont changé en route est reprise du début.
   * @returns {boolean} vrai s'il reste du travail ou qu'une tuile vient d'aboutir.
   */
  processRebuildQueue(budgetMs = TERRAIN_REBUILD_BUDGET_MS) {
    if (this.disposed) return false;
    const deadline = performance.now() + budgetMs;
    while (!this._pendingBuild) {
      if (this._rebuildQueue.length === 0) return false;
      const tile = this.tiles.get(this._rebuildQueue.shift());
      if (tile && this._meshOutdated(tile)) {
        this._pendingBuild = { tile, steps: this._buildMeshSteps(tile), state: this._buildState() };
      } else {
        this._settleSurface();
      }
    }
    const pending = this._pendingBuild;
    if (this.tiles.get(pending.tile.key) !== pending.tile || pending.state !== this._buildState()) {
      this._cancelPendingBuild();
      if (this.tiles.has(pending.tile.key)) this._rebuildQueue.unshift(pending.tile.key);
      return true;
    }
    while (!pending.steps.next().done) {
      if (performance.now() >= deadline) return true;
    }
    this._pendingBuild = null;
    this._settleSurface();
    return true;
  }

  /** Ce dont dépend une maille en cours : s'il change, elle est à reprendre. */
  _buildState() {
    return `${this._cutGeneration}:${this._cliffGeneration}:${this._waterGeneration}:${this._generation}:${this.elevation?.revision}`;
  }

  _cancelPendingBuild() {
    this._pendingBuild?.steps.return();
    this._pendingBuild = null;
  }

  _buildMesh(tile) {
    finishGeneration(this._buildMeshSteps(tile));
  }

  /** `_buildMesh` en étapes, une par ligne de sommets ; la tuile n'est touchée qu'à la dernière. */
  *_buildMeshSteps(tile) {
    const { THREE } = this;
    const n = this.segmentsForTile(tile.x, tile.y);
    const count = (n + 1) * (n + 1);

    const edge = this._edgeSegmentsFor(tile, n);
    const revision = this.elevation?.revision;
    const signature = `${n}:${edge.north}:${edge.south}:${edge.west}:${edge.east}:${revision}:${this._gradientStep}`;
    const cached = revision != null && tile.demCache?.signature === signature && tile.demCache.source === this.elevation;
    const samples = cached ? tile.demCache.samples : new Float64Array(count * 5);

    // Tampons neufs, même quand la géométrie est reprise : ceux de la tuile
    // affichée sont lus (appuis des plantes) tant que celle-ci n'est pas finie.
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
    const carving = !!(this._roadCut || this._unpaved) && tile.ring <= ROAD_CUT_MAX_RING;
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
        if (cached) raw = samples[idx * 5];
        else if (j === 0) raw = this._edgeElevation(u, edge.north, (a) => this._sample(tile.x + a, tile.y));
        else if (j === n) raw = this._edgeElevation(u, edge.south, (a) => this._sample(tile.x + a, tile.y + 1));
        else if (i === 0) raw = this._edgeElevation(v, edge.west, (a) => this._sample(tile.x, tile.y + a));
        else if (i === n) raw = this._edgeElevation(v, edge.east, (a) => this._sample(tile.x + 1, tile.y + a));
        else raw = this._sample(tx, ty);

        if (!cached) {
          samples[idx * 5] = raw;
          samples[idx * 5 + 1] = this._sample(tx + this._gradientStep, ty);
          samples[idx * 5 + 2] = this._sample(tx - this._gradientStep, ty);
          samples[idx * 5 + 3] = this._sample(tx, ty + this._gradientStep);
          samples[idx * 5 + 4] = this._sample(tx, ty - this._gradientStep);
        }
        // Le déblai est une fonction du seul point du sol, donc la couture des bords reste exacte.
        const atVertex = cutWithMask(local.x, local.z, raw);
        const h = atVertex.elevation * this.verticalScale;

        positions[idx * 3] = local.x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = local.z;
        roadMask[idx] = atVertex.mask;

        // Gradient central : continu au travers des frontières de tuiles.
        const hE = cut(local.x + stepMeters, local.z, samples[idx * 5 + 1]) * this.verticalScale;
        const hW = cut(local.x - stepMeters, local.z, samples[idx * 5 + 2]) * this.verticalScale;
        const hS = cut(local.x, local.z + stepMeters, samples[idx * 5 + 3]) * this.verticalScale;
        const hN = cut(local.x, local.z - stepMeters, samples[idx * 5 + 4]) * this.verticalScale;

        let nx = -(hE - hW) / (2 * stepMeters);
        let nz = -(hS - hN) / (2 * stepMeters);
        const len = Math.hypot(nx, 1, nz) || 1;
        normals[idx * 3] = nx / len;
        normals[idx * 3 + 1] = 1 / len;
        normals[idx * 3 + 2] = nz / len;
      }
      yield;
    }

    if (!cached && revision != null) tile.demCache = { signature, samples, source: this.elevation };
    const previousGeometry = tile.supportGeometry ?? tile.mesh?.geometry;
    const reuse = (previousGeometry?.getAttribute?.('position') ?? previousGeometry?.attributes?.position)?.count === count;
    const indices = reuse ? previousGeometry.index.array : new (count > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
    let k = 0;
    if (!reuse) for (let j = 0; j < n; j++) {
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
    {
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('roadMask', new THREE.BufferAttribute(roadMask, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    geometry.computeBoundingSphere();

    const prepared = this._prepareWaterTile(tile, geometry, this._waterSurface);
    if (reuse) {
      for (const name of ['position', 'normal', 'roadMask']) {
        previousGeometry.getAttribute(name).array = geometry.getAttribute(name).array;
        previousGeometry.getAttribute(name).needsUpdate = true;
      }
      previousGeometry.computeBoundingSphere();
      geometry.attributes = {};
      geometry.setIndex(null);
      geometry.dispose();
      if (prepared.render === geometry) prepared.render = previousGeometry;
      prepared.support = previousGeometry;
      for (const name of ['position', 'normal', 'roadMask']) prepared.render.setAttribute(name, previousGeometry.getAttribute(name));
    }
    this._publishWaterTile(tile, prepared);
    // Une maille qui change de finesse déplace la surface ; un simple recreusement
    // non, sinon chaussées → entaille → surface → chaussées tourne sans fin.
    const previousEdge = tile.edgeSegments;
    if (
      tile.segments !== n || !previousEdge ||
      previousEdge.north !== edge.north || previousEdge.south !== edge.south ||
      previousEdge.west !== edge.west || previousEdge.east !== edge.east
    ) {
      this._surfaceDirty = true;
    }
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

  get waterGeneration() { return this._waterGeneration; }

  _waterTouches(tile, index = this._waterSurface) {
    if (!index || !this.frame) return false;
    const a = this.frame.tileToLocal(tile.x, tile.y), b = this.frame.tileToLocal(tile.x+1, tile.y+1);
    return index.trianglesInBounds({ minX:a.x, minZ:a.z, maxX:b.x, maxZ:b.z }).length > 0;
  }

  _prepareWaterTile(tile, support, index) {
    if (!this._waterTouches(tile,index)) return {support,render:support,fragments:null,hadWater:false};
    const cut = cutWaterTerrain(support, index, this.verticalScale);
    const render = new this.THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'roadMask']) render.setAttribute(name, support.getAttribute(name));
    const Type = support.getAttribute('position').count > 65535 ? Uint32Array : Uint16Array;
    render.setIndex(new this.THREE.BufferAttribute(new Type(cut.intact), 1));
    render.boundingSphere = support.boundingSphere;
    const uniforms = this.materials.grainUniforms;
    const amplitude = 2*Math.max(0,...(uniforms?.uSurfaceGrainAmplitude?.value??[]),uniforms?.uRockGrain?.value?.y??0);
    const fragments = cut.fragments.length || cut.banks.length ? terrainFragmentGeometry(this.THREE,cut,amplitude) : null;
    return { support, render, fragments, conflicts:cut.conflicts, hadWater: this._waterTouches(tile,index) };
  }

  _disposeRender(geometry) {
    // Le support possède les attributs partagés ; seul l'index est libéré ici.
    geometry.attributes = {};
    geometry.dispose();
  }

  _publishWaterTile(tile, prepared) {
    const { THREE } = this;
    if (tile.mesh) {
      if (tile.mesh.geometry !== tile.supportGeometry && tile.mesh.geometry !== prepared.support) this._disposeRender(tile.mesh.geometry);
      if (tile.supportGeometry && tile.supportGeometry !== prepared.support) tile.supportGeometry.dispose();
      tile.mesh.geometry = prepared.render;
    } else {
      tile.mesh = new THREE.Mesh(prepared.render,this.materials.material);
      tile.mesh.name = `terrain-${tile.key}`;
      tile.mesh.matrixAutoUpdate = false;
      tile.mesh.receiveShadow = true;
      tile.mesh.updateMatrix();
      this.group.add(tile.mesh);
    }
    if (tile.waterFragments) {
      this.group.remove(tile.waterFragments);
      tile.waterFragments.geometry.dispose();
      tile.waterFragments = null;
    }
    if (prepared.fragments) {
      tile.waterFragments = new THREE.Mesh(prepared.fragments,this.materials.fragmentMaterial);
      tile.waterFragments.name = `berges-${tile.key}`;
      tile.waterFragments.receiveShadow = true;
      this.group.add(tile.waterFragments);
    }
    tile.supportGeometry = prepared.support;
    tile.hadWater = prepared.hadWater;
    tile.waterGeneration = this._waterGeneration;
  }

  /** Prépare tout le lot sans ouvrir de trou ; return() libère un lot annulé. */
  *prepareWaterSurfaceSteps(index) {
    const entries = []; let completed = false;
    try {
      for (const tile of this.tiles.values()) {
        if (!tile.supportGeometry || !(tile.hadWater || this._waterTouches(tile,index))) continue;
        entries.push({ tile, prepared:this._prepareWaterTile(tile,tile.supportGeometry,index) });
        yield;
      }
      completed = true;
      return entries;
    } finally {
      if (!completed) this.discardWaterSurface(entries);
    }
  }

  discardWaterSurface(entries) {
    for (const {prepared} of entries) { if (prepared.render !== prepared.support) this._disposeRender(prepared.render); prepared.fragments?.dispose(); }
  }

  setWaterSurface(index, prepared = null) {
    if (this.disposed) return;
    const previous = this._waterSurface;
    this._waterSurface = index;
    this._waterGeneration++;
    if (prepared) for (const entry of prepared) this._publishWaterTile(entry.tile,entry.prepared);
    else for (const tile of this.tiles.values()) if (tile.hadWater || this._waterTouches(tile,index) || this._waterTouches(tile,previous)) {
      if (!this._rebuildQueue.includes(tile.key)) this._rebuildQueue.push(tile.key);
    }
  }

  _disposeTile(tile) {
    tile.demCache = null;
    if (!tile.mesh) return;
    this.group.remove(tile.mesh);
    if (tile.mesh.geometry !== tile.supportGeometry) this._disposeRender(tile.mesh.geometry);
    (tile.supportGeometry ?? tile.mesh.geometry).dispose();
    if (tile.waterFragments) {this.group.remove(tile.waterFragments);tile.waterFragments.geometry.dispose();}
    tile.waterFragments = null;
    tile.supportGeometry = null;
    tile.mesh = null;
  }

  _clearTiles() {
    this._cancelPendingBuild();
    for (const tile of this.tiles.values()) this._disposeTile(tile);
    this.tiles.clear();
    this._waterSurface = null;
    this._waterGeneration++;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._abort.abort();
    this._roadCut = null;
    this._unpaved = null;
    this._junctions = null;
    this._rebuildQueue.length = 0;
    this._clearTiles();
    this.materials.dispose();
    this.scene.remove(this.group);
  }
}
