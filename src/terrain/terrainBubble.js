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
 * Le déblai des chaussées (`setRoadCut`) perturbe ce relief naturel : une
 * route est taillée dans le versant, pas posée dessus, et l'entaille est une
 * fonction pure de la position au sol, donc les tuiles voisines s'accordent au bord.
 */

import { createLocalFrame, tilesAround, tileKey, lngLatToTile } from '../core/tileMath.js';
import { DEM_TILE_PIXELS } from '../core/elevationField.js';
import { TerrainMaterialFactory } from './terrainMaterial.js';
import { defaultTheme } from '../themes/default.js';
import { cutElevationAt, ROAD_CUT_M, ROAD_CUT_BLEND_M, ROAD_CUT_MAX_RING } from './roadCut.js';
import { cutWaterElevationAt, WATER_CUT_MAX_RING } from './waterCut.js';

/** Un pixel DEM, en unités de tuile : pas d'échantillonnage du gradient. */
const GRADIENT_STEP_TILES = 1 / DEM_TILE_PIXELS;

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
    blockSize = 5,
    segmentsByRing = [192, 96, 48],
    verticalScale = 1,
    groundClass = null,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.scene = scene;
    this.elevation = elevation;
    this.zoom = zoom;
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

    this.materials = new TerrainMaterialFactory({ THREE, groundClass, look: theme.terrain });

    /** Index des chaussées construites (`RoadIndex`), ou `null` — voir `setRoadCut`. */
    this._roadCut = null;
    /** Cuvette des nappes d'eau (`WaterIndex`), ou `null`, même rôle — voir `setWaterCut`. */
    this._waterCut = null;
    /** Incrémenté à chaque publication d'index : périme les mailles déjà creusées. */
    this._cutGeneration = 0;
  }

  /**
   * Finesse de maille d'une tuile, d'après son anneau. L'anneau central
   * descend à ~4,4 m, au plus près de la résolution native du MNT
   * (~3,3 m/pixel au zoom 15), les anneaux suivants relâchent.
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

    // Le relief d'abord : une maille construite sans ses voisines aurait des bords faux.
    await Promise.all(
      wanted.map((w) => this.elevation.load(w.x, w.y, this._abort.signal))
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
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.elevation.has(x + dx, y + dy)) return false;
      }
    }
    return true;
  }

  /** Altitude brute du MNT sous un point géographique, en mètres. */
  getElevation(lng, lat, fallback = 0) {
    const t = lngLatToTile(lng, lat, this.zoom);
    return this.elevation.sampleTile(t.x, t.y, fallback);
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

    const sample = (i, j) => this.elevation.sampleTile(i / n, j / n, fallback);
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
   * Publie l'index des chaussées et remet en file les tuiles à entailler. Les
   * tuiles passent par la file drainée une par image, sinon recreuser toutes
   * les mailles d'un coup produirait un à-coup net.
   *
   * @param {Object|null} index Instance `RoadIndex`, ou `null` pour ne rien creuser.
   */
  setRoadCut(index) {
    if (this.disposed) return;
    this._roadCut = index || null;
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
    return this._roadCutAt(x, z, this._waterCutAt(x, z, raw));
  }

  /**
   * Creuse la cuvette d'une nappe d'eau (profil dans `cutWaterElevationAt`,
   * pur et testé). L'eau passe avant la route : un pont franchit une rivière,
   * il ne la bouche pas — l'ordre inverse aurait rempli l'entaille routière
   * avec le lit de la rivière qu'elle enjambe.
   */
  _waterCutAt(x, z, raw) {
    const index = this._waterCut;
    if (!index) return raw;

    const hit = index.query(x, z);
    if (!hit) return raw;

    // L'altitude de nappe est en unités de scène (exagération verticale
    // comprise) ; `raw` est en unités de MNT. On compare dans le même espace.
    const scale = this.verticalScale || 1;
    return cutWaterElevationAt(raw, hit.level / scale, hit.distance);
  }

  /** Creuse le déblai d'une chaussée. Profil dans `cutElevationAt`, pur et testé. */
  _roadCutAt(x, z, raw) {
    const index = this._roadCut;
    if (!index) return raw;

    const hit = index.query(x, z, ROAD_CUT_M + ROAD_CUT_BLEND_M);
    if (!hit) return raw;
    const deck = index.deckAt(hit);
    if (deck == null) return raw;

    // La plate-forme est en unités de scène (déjà multipliée par l'exagération
    // verticale) ; `raw` est en unités de MNT. On compare dans le même espace.
    const scale = this.verticalScale || 1;
    return cutElevationAt(raw, deck / scale, hit.distance, hit.segment.halfWidth);
  }

  /**
   * Publie la cuvette d'eau et remet en file les tuiles à creuser. Même mécanique que `setRoadCut`.
   * @param {Object|null} index Instance `WaterIndex`, ou `null` pour ne rien creuser.
   */
  setWaterCut(index) {
    if (this.disposed) return;
    this._waterCut = index && index.ready ? index : null;
    this._cutGeneration++;
    for (const tile of this.tiles.values()) {
      if (tile.ring > Math.max(ROAD_CUT_MAX_RING, WATER_CUT_MAX_RING)) continue;
      if (!this._rebuildQueue.includes(tile.key)) this._rebuildQueue.push(tile.key);
    }
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
    // Un nouvel index (chaussées ou nappes) périme le terrassement déjà creusé.
    if (
      tile.ring <= Math.max(ROAD_CUT_MAX_RING, WATER_CUT_MAX_RING) &&
      tile.cutGeneration !== this._cutGeneration
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

    const scale = this.frame.scale;
    const stepMeters = GRADIENT_STEP_TILES * scale;
    // Les terrassements ne s'appliquent qu'aux tuiles proches (au-delà, la requête d'index ne rendrait rien).
    const carving =
      (!!this._roadCut && tile.ring <= ROAD_CUT_MAX_RING) ||
      (!!this._waterCut && tile.ring <= WATER_CUT_MAX_RING);
    // Gradient pris sur le terrain entaillé, sinon l'éclairage du fond du déblai serait celui du versant.
    const cut = carving ? (x, z, raw) => this.cutElevation(x, z, raw) : (x, z, raw) => raw;

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
        if (j === 0) raw = this._edgeElevation(u, edge.north, (a) => this.elevation.sampleTile(tile.x + a, tile.y));
        else if (j === n) raw = this._edgeElevation(u, edge.south, (a) => this.elevation.sampleTile(tile.x + a, tile.y + 1));
        else if (i === 0) raw = this._edgeElevation(v, edge.west, (a) => this.elevation.sampleTile(tile.x, tile.y + a));
        else if (i === n) raw = this._edgeElevation(v, edge.east, (a) => this.elevation.sampleTile(tile.x + 1, tile.y + a));
        else raw = this.elevation.sampleTile(tx, ty);

        // Le déblai est une fonction du seul point du sol, donc la couture des bords reste exacte.
        const h = cut(local.x, local.z, raw) * this.verticalScale;

        positions[idx * 3] = local.x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = local.z;

        // Gradient central : continu au travers des frontières de tuiles.
        const hE = cut(local.x + stepMeters, local.z, this.elevation.sampleTile(tx + GRADIENT_STEP_TILES, ty)) * this.verticalScale;
        const hW = cut(local.x - stepMeters, local.z, this.elevation.sampleTile(tx - GRADIENT_STEP_TILES, ty)) * this.verticalScale;
        const hS = cut(local.x, local.z + stepMeters, this.elevation.sampleTile(tx, ty + GRADIENT_STEP_TILES)) * this.verticalScale;
        const hN = cut(local.x, local.z - stepMeters, this.elevation.sampleTile(tx, ty - GRADIENT_STEP_TILES)) * this.verticalScale;

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
    this._waterCut = null;
    this._rebuildQueue.length = 0;
    this._clearTiles();
    this.materials.dispose();
    this.scene.remove(this.group);
  }
}
