/*
 * terrainBubble — la « bulle » de terrain qui suit l'observateur.
 * ------------------------------------------------------------
 * Objectif : ne jamais construire le monde, seulement le voisinage immédiat
 * de l'observateur ciblé (quelques kilomètres), et faire glisser ce voisinage avec
 * lui. C'est l'idée du geometry clipmap (Losasso & Hoppe, SIGGRAPH 2004),
 * exprimée ici dans l'espace des tuiles : un bloc carré de tuiles centré sur
 * l'observateur, rechargé tuile par tuile quand il franchit une frontière.
 *
 * La bulle ne porte que le **relief** : elle transforme le MNT en mailles et
 * répond aux questions d'altitude. Ce qui se pose dessus est décidé ailleurs
 * (`worldComposer`), et la matière du sol vient d'un seul matériau partagé
 * (`terrainMaterial`), piloté par l'occupation du sol vectorielle.
 *
 * Les normales ne sont **pas** calculées par `computeVertexNormals()` mais
 * analytiquement depuis le champ d'altitude : le gradient est continu d'une
 * tuile à l'autre, donc l'éclairage ne trahit pas les jointures.
 *
 * Une seule chose vient perturber ce relief naturel : le **déblai des
 * chaussées** (`setRoadCut`). Une route n'est pas posée sur le versant, elle y
 * est taillée ; sans entaille, la seule parade au terrain qui recouvre la rive
 * amont était de remonter toute la plate-forme, ce qui posait la route en
 * surplomb. L'entaille est une fonction pure de la position au sol, donc les
 * tuiles voisines s'accordent toujours au bord.
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
   *        anneau par anneau. Rapport 2 d'un anneau au suivant : c'est ce qui
   *        rend le raccord de bord exact (cf. `_buildMesh`).
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
     * Numéro de **surface**, incrémenté chaque fois que la maille de terrain a
     * fini de changer de finesse. C'est le signal qu'attendent ceux qui posent
     * quelque chose *sur* le sol et gardent le résultat : l'eau et les routes.
     *
     * Sans lui, le défaut est structurel et se voit en marchant. L'anneau 0
     * maille à 4,4 m, l'anneau 1 à 8,8 m : une tuile qui se rapproche voit sa
     * maille doubler de finesse et capter des pointes du MNT qu'elle sautait
     * jusque-là. Le terrain **monte** alors localement, de l'ordre du mètre —
     * et une nappe d'eau calculée sur l'ancienne résolution se retrouve
     * recouverte. Or ni `WaterLayer` ni `RoadNetwork` ne pouvaient s'en
     * apercevoir : ils ne surveillaient que le repère local, qui ne change que
     * tous les vingt kilomètres, et une distance parcourue de quelques
     * centaines de mètres qui n'a rien à voir avec le franchissement d'une
     * frontière de tuile.
     */
    this._surfaceGeneration = 0;
    /** Vrai dès qu'une maille a changé de finesse, tant que la file n'est pas vide. */
    this._surfaceDirty = false;

    this.materials = new TerrainMaterialFactory({
      THREE,
      groundClass,
      look: theme.terrain,
      air: theme.air,
    });

    /**
     * Index des chaussées construites (`RoadIndex`), ou `null`. C'est lui qui
     * dit où le terrain doit être entaillé — voir `setRoadCut`.
     */
    this._roadCut = null;
    /**
     * Cuvette des nappes d'eau (`WaterIndex`), ou `null`. Même rôle que
     * `_roadCut` : elle dit où le terrain doit se creuser — voir `setWaterCut`.
     */
    this._waterCut = null;
    /** Incrémenté à chaque publication d'index : périme les mailles déjà creusées. */
    this._cutGeneration = 0;
  }

  /**
   * Finesse de maille d'une tuile, d'après son anneau.
   *
   * Le MNT Terrarium fait 256 pixels par tuile, soit ~3,3 m au sol au zoom 15.
   * Une maille uniforme à 48 segments n'en échantillonnait qu'un point sur cinq
   * : le terrain sous l'observateur était plat parce qu'on jetait quatre
   * cinquièmes de l'altitude qu'on avait déjà téléchargée. L'anneau central
   * descend donc à ~4,4 m, au plus près de la résolution native, et les anneaux
   * suivants relâchent — c'est le clipmap appliqué à la finesse, pas seulement
   * au découpage.
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
   * Numéro de la surface affichée. Change quand la maille a fini de se
   * réajuster, et seulement à ce moment-là : ce qui est posé dessus n'a aucune
   * raison d'être refait pendant que la file se draine, tuile par tuile.
   */
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
    // bords faux. On charge tout le bloc, puis on construit.
    await Promise.all(
      wanted.map((w) => this.elevation.load(w.x, w.y, this._abort.signal))
    );
    if (this.disposed || generation !== this._generation) return true;

    // Une tuile sans géométrie est construite tout de suite — il n'y a rien à
    // afficher à sa place. Une tuile dont seule la finesse a changé garde la
    // sienne et passe par la file : elle est déjà lisible.
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
   * Altitude de la **surface effectivement affichée**, et non du MNT continu.
   *
   * La différence compte : la maille de terrain n'échantillonne le MNT que tous
   * les `1/segments` de tuile. Un objet posé sur le MNT continu — la route, 
   * l'observateur — flotterait au-dessus des bosses et s'enfoncerait dans les creux.
   * On interpole donc entre les mêmes sommets que ceux de la maille.
   *
   * @param {number} tx Abscisse de tuile fractionnaire.
   * @param {number} ty Ordonnée de tuile fractionnaire.
   */
  surfaceElevationAtTile(tx, ty, fallback = 0) {
    // La finesse dépend de la tuile : demander la surface avec la mauvaise
    // résolution ferait flotter la route et l'observateur au-dessus des bosses,
    // exactement le défaut que cette méthode existe pour éviter. Reste un écart
    // résiduel dans la seule bande de mailles collée à une frontière d'anneau,
    // où la géométrie est recousue sur la résolution du voisin (`_buildMesh`) :
    // quelques centimètres, absorbés par le lissage longitudinal des rubans.
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
   * Idem, à partir de coordonnées métriques locales, **déblai compris**.
   *
   * C'est cette variante que tout le décor doit employer : elle rend la
   * hauteur du sol tel qu'il est affiché. Le calcul des plate-formes de
   * chaussée, lui, passe par `rawSurfaceElevationAtLocal` — le déblai dérive de
   * la plate-forme, la plate-forme ne peut donc pas dériver du déblai.
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
   * Publie l'index des chaussées et remet en file les tuiles à entailler.
   *
   * Appelé après chaque reconstruction du réseau routier. Les tuiles ne sont pas
   * refaites sur place : elles passent par la file drainée une par image, sinon
   * recreuser neuf mailles de trente-sept mille sommets d'un coup produirait un
   * à-coup net tous les 250 mètres parcourus.
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
   * Altitude entaillée en un point : le terrain descend jusqu'à la plate-forme
   * de la chaussée qui passe là, et remonte progressivement ensuite.
   *
   * Ce niveau-ci ne fait que l'interrogation spatiale ; le profil de l'entaille
   * lui-même est dans `cutElevationAt`, qui est pur et testé.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @param {number} raw Altitude naturelle, en mètres (échelle du MNT).
   */
  cutElevation(x, z, raw) {
    return this._roadCutAt(x, z, this._waterCutAt(x, z, raw));
  }

  /**
   * Creuse la cuvette d'une nappe d'eau. Le profil lui-même est dans
   * `cutWaterElevationAt`, qui est pur et testé.
   *
   * L'eau passe **avant** la route, et l'ordre n'est pas indifférent : un pont
   * franchit une rivière, il ne la bouche pas. `cutElevationAt` ne fait jamais
   * monter le terrain, donc une plate-forme dressée au-dessus d'un lit creusé
   * le laisse creusé — l'ordre inverse aurait rempli l'entaille routière avec
   * le lit de la rivière qu'elle enjambe.
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
   * Publie la cuvette d'eau et remet en file les tuiles à creuser. Même
   * mécanique que `setRoadCut`, et pour la même raison : creuser neuf mailles
   * d'un coup ferait un à-coup net.
   *
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
   * Altitude d'un point de bord, échantillonnée à la résolution `m`.
   *
   * C'est la couture entre deux anneaux de finesse différente. Sans elle, un
   * bord à 192 sommets face à un bord à 96 s'écarterait de la droite que trace
   * le voisin entre deux de ses sommets : une fente ouverte sur le ciel, tout
   * le long de la frontière. En échantillonnant les deux côtés sur la
   * résolution la plus grossière, les deux bords coïncident exactement — pas
   * approximativement.
   *
   * Quand `m` vaut la finesse de la tuile, `t * m` est entier et l'appel rend
   * l'échantillon direct : la fonction peut donc s'appliquer sans condition.
   */
  _edgeElevation(t, m, sampleAt) {
    const g = t * m;
    const k = Math.floor(g);
    const f = g - k;
    if (f <= 0) return sampleAt(k / m);
    return sampleAt(k / m) * (1 - f) + sampleAt((k + 1) / m) * f;
  }

  /**
   * Résolution retenue sur chaque bord : celle du voisin s'il est plus
   * grossier, la nôtre sinon. C'est toujours le plus grossier qui commande.
   */
  _edgeSegmentsFor(tile, n) {
    return {
      north: Math.min(n, this.segmentsForTile(tile.x, tile.y - 1)),
      south: Math.min(n, this.segmentsForTile(tile.x, tile.y + 1)),
      west: Math.min(n, this.segmentsForTile(tile.x - 1, tile.y)),
      east: Math.min(n, this.segmentsForTile(tile.x + 1, tile.y)),
    };
  }

  /**
   * Vrai si la géométrie d'une tuile ne correspond plus à ce qu'elle devrait
   * être. Le déplacement de l'observateur change l'anneau des tuiles, donc leur
   * finesse — et celle de leurs voisines, donc la couture des bords.
   */
  _meshOutdated(tile) {
    if (!tile.mesh || !tile.edgeSegments) return true;
    const n = this.segmentsForTile(tile.x, tile.y);
    if (tile.segments !== n) return true;
    // Un nouvel index — chaussées ou nappes — périme le terrassement déjà
    // creusé dans la maille.
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

  /**
   * Reconstruit au plus une tuile périmée. Appelé une fois par image : recoudre
   * les vingt-cinq tuiles d'un coup au franchissement d'une frontière ferait
   * un à-coup net, alors que l'étalement ne coûte que quelques images de
   * géométrie transitoirement grossière.
   */
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

    // Pas de coordonnées de texture : la matière du sol est projetée en
    // coordonnées monde par le shader, elle n'a rien à faire d'un dépliage par
    // tuile — et un attribut de moins, c'est 300 ko de moins par tuile fine.
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const scale = this.frame.scale;
    const stepMeters = GRADIENT_STEP_TILES * scale;
    // Les terrassements ne s'appliquent qu'aux tuiles proches : au-delà, ni
    // chaussée ni nappe ne sont construites, et la requête d'index ne rendrait
    // jamais rien.
    const carving =
      (!!this._roadCut && tile.ring <= ROAD_CUT_MAX_RING) ||
      (!!this._waterCut && tile.ring <= WATER_CUT_MAX_RING);
    // Le gradient est pris sur le terrain **entaillé** : sans cela, l'éclairage
    // du fond du déblai serait celui du versant qu'on vient d'y creuser.
    const cut = carving ? (x, z, raw) => this.cutElevation(x, z, raw) : (x, z, raw) => raw;

    for (let j = 0; j <= n; j++) {
      const v = j / n;
      const ty = tile.y + v;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const tx = tile.x + u;
        const idx = j * (n + 1) + i;

        const local = this.frame.tileToLocal(tx, ty);

        // Bords : recousus sur la résolution du voisin. Les coins tombent sur
        // un sommet de grille dans les deux directions, ils sont donc
        // insensibles à l'ordre des tests.
        let raw;
        if (j === 0) raw = this._edgeElevation(u, edge.north, (a) => this.elevation.sampleTile(tile.x + a, tile.y));
        else if (j === n) raw = this._edgeElevation(u, edge.south, (a) => this.elevation.sampleTile(tile.x + a, tile.y + 1));
        else if (i === 0) raw = this._edgeElevation(v, edge.west, (a) => this.elevation.sampleTile(tile.x, tile.y + a));
        else if (i === n) raw = this._edgeElevation(v, edge.east, (a) => this.elevation.sampleTile(tile.x + 1, tile.y + a));
        else raw = this.elevation.sampleTile(tx, ty);

        // Le déblai est une fonction du seul point du sol : deux tuiles voisines
        // en tirent la même valeur au même endroit, donc la couture des bords
        // reste exacte.
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
      // Le terrain reçoit les ombres mais n'en projette pas : ses mailles
      // font 18 m, et une face aussi grande s'auto-ombre en rayures avant de
      // produire quoi que ce soit d'utile.
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      tile.mesh = mesh;
      this.group.add(mesh);
    }
    // Une maille qui change de finesse déplace la surface : ce qui est posé
    // dessus devra se refaire, mais une fois la file drainée seulement.
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
