/*
 * worldComposer — l'orchestrateur du décor.
 * ------------------------------------------
 * Toutes les couches visuelles dépendent les unes des autres : l'occupation du
 * sol décide de la matière du terrain *et* des arbres *et* de l'herbe ; la
 * chaussée entaille le terrain *et* porte le mobilier *et* interdit l'herbe.
 * Laissées à se brancher entre elles, ces dépendances deviennent un plat de
 * nouilles où l'ordre de construction n'est écrit nulle part.
 *
 * Ce module est **le seul endroit** où cet ordre est écrit. Il possède la bulle
 * de terrain et toutes les couches, et n'expose que trois verbes :
 *
 *   setCenter(lng, lat)   déplace la bulle    (relief, tuiles montées)
 *   refresh(lng, lat)     refait le décor     (tout ce qui vient du vectoriel)
 *   advance(delta, at)    fait vivre l'image  (file de plantation, herbe, vie)
 *
 * ## L'ordre de génération, et pourquoi il est celui-là
 *
 *   1. **occupation du sol** — tout le monde la lit, personne ne la produit ;
 *   2. **eau** — elle passe avant tout ce qui touche au relief, parce qu'elle
 *      publie sa **cuvette** (`WaterIndex`) : le terrain se creuse sous chaque
 *      nappe, comme il se creuse sous une chaussée. Sans ça le terrain, maillé
 *      sur un MNT qui ignore l'eau, traverse les lacs — et aucun décalage ne
 *      rattrape une intersection. Elle ne lit toujours que les tuiles : elle
 *      publie, elle ne consomme rien ;
 *   3. **chaussées** — elles entaillent le terrain et publient leur index, qui
 *      est aussi l'**emprise routière** (`roadCorridor`) : la frontière que ni
 *      la haie, ni la clôture, ni le jardin, ni le champ, ni l'herbe, ni
 *      l'arbre n'ont le droit de franchir. C'est la seule relation spatiale
 *      que toutes les couches de décor partagent, et elle tient en une
 *      question — « ce point est-il sur la voirie ? » ;
 *   3 bis. **voie ferrée** — ne dépend de rien et ne publie rien : elle relit
 *      la même couche `transportation` que les chaussées, filtrée sur
 *      `class: rail`, et suit le terrain sans l'entailler (voir
 *      `railwayLayer.js` pour ce que cette simplification laisse de côté) ;
 *   4. **bâti** — il ne lit que les tuiles ; il publie au passage ses
 *      **maisons** et l'ensemble de ses **empreintes** ;
 *   4 bis. **voirie** — après les chaussées *et* le bâti, parce qu'un trottoir
 *      demande les deux : la plate-forme sur laquelle il se pose, et les
 *      maisons qui prouvent que c'est une rue. Elle publie sa bande revêtue,
 *      que l'herbe et les jardins lisent pour ne pas la traverser ;
 *   4 ter. **jardins** — ils tirent leurs clôtures et leurs buissons des
 *      maisons ; eux ne lisent aucune tuile, mais ils lisent l'emprise
 *      routière et la bande revêtue ;
 *   5. **mobilier** — il lui faut les tronçons *et* l'index des chaussées :
 *      murs et glissières se posent sur la plate-forme exacte sur laquelle
 *      roule l'observateur, et les feux n'ont de sens qu'aux carrefours ;
 *   6. **arbres** — après la carte de classes, qui décide où est le bois, et
 *      après les chaussées, dont le polygone de bois ne tient pas compte : un
 *      bois qu'une route traverse ne plante rien sur son emprise ;
 *   7. **herbe** — après l'index des chaussées, pour ne pas pousser sur le
 *      bitume ;
 *   8. **cheminées** — publiées par le mobilier, animées par `lifeLayer`.
 *
 * Une couche qui manque ne casse rien : chacune se contente de ne rien poser.
 *
 * ## Le profil de paysage
 *
 * Avant tout ça, le compositeur répond pour tout le monde à une question que
 * personne ne se posait : **où sur la Terre sommes-nous ?** `refresh` reçoit une
 * longitude et une latitude depuis toujours, et les jetait après en avoir tiré
 * des mètres. Il en tire maintenant aussi un `landscape` :
 *
 *   climate  la famille climatique et son code Köppen (`core/climate.js`)
 *   relief   l'altitude et la pente sous l'observateur
 *
 * Ce n'est pas une couche et ça ne pose rien : c'est une **entrée**, lue par
 * celles qui choisissent un contenu dans une liste — les peuplements, les
 * palettes de bourg, les cultures, le bétail. Il se recalcule sur sa propre
 * cadence (`LANDSCAPE_REBUILD_M`), bien plus lente que celle du décor : un
 * climat ne change pas tous les quatre cents mètres.
 */

import { TerrainBubble } from './terrain/terrainBubble.js';
import { GroundClassMap } from './terrain/groundClassMap.js';
import { RoadNetwork, createRoadMaterials } from './layers/roadNetwork.js';
import { WaterLayer, createWaterMaterial } from './layers/waterLayer.js';
import { RailwayLayer } from './layers/railwayLayer.js';
import { CombinedIndex } from './layers/roadGraph.js';
import { BuildingLayer } from './layers/buildingLayer.js';
import { GardenLayer } from './layers/gardenLayer.js';
import { StreetLayer } from './layers/streetLayer.js';
import { collectBuiltUpAreas, FabricIndex } from './layers/settlement.js';
import { VegetationLayer } from './layers/vegetationLayer.js';
import { GroundCover } from './layers/groundCover.js';
import { CropLayer } from './layers/cropLayer.js';
import { FurnitureLayer } from './layers/furnitureLayer.js';
import { LifeLayer } from './layers/lifeLayer.js';
import { VectorTileSource, coveringTiles, VECTOR_ZOOM } from './core/vectorTileSource.js';
import { lngLatToTile } from './core/tileMath.js';
import { climateAt, refineByRelief } from './core/climate.js';
import { crossSlope } from './layers/furniturePlacement.js';
import { defaultTheme } from './themes/default.js';

/**
 * Crédit des données affichées. Le décor vient d'OpenStreetMap via les tuiles
 * vectorielles de la carte, le relief des tuiles Terrarium.
 */
export const WORLD_ATTRIBUTION =
  '© OpenStreetMap contributors — relief AWS Terrain Tiles — climat Köppen-Geiger (Rubel et al.)';

/**
 * Déplacement de l'observateur avant de reposer la question du climat, en
 * mètres.
 *
 * Deux kilomètres : la grille climatique a des cellules d'une dizaine de
 * kilomètres, donc la recalculer à la cadence du décor (quatre cents mètres)
 * rendrait mille fois la même réponse. L'altitude, elle, change plus vite —
 * mais pas assez pour valoir une lecture par image.
 */
export const LANDSCAPE_REBUILD_M = 2000;

/** Demi-portée de la mesure de pente sous l'observateur, en mètres. */
const RELIEF_SPAN_M = 60;

export class WorldComposer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.elevation       Instance `ElevationField`.
   * @param {number} options.zoom            Zoom des tuiles de la bulle.
   * @param {number} options.blockSize       Côté du bloc, en tuiles (impair).
   * @param {number[]} options.segmentsByRing Finesse de maille par anneau.
   * @param {{tiles: string[], maxZoom: number}|null} [options.vectorConfig]
   *        Source des tuiles vectorielles : gabarits d'URL `{z}/{x}/{y}` et
   *        zoom maximal servi. Absente, le décor se réduit au relief nu.
   * @param {number} [options.maxAnisotropy] Capacité du renderer.
   * @param {Object} [options.theme] Direction artistique, déjà résolue par
   *        `resolveTheme`. Le compositeur ne la lit pas : il la distribue, et
   *        chaque couche y prend sa tranche. C'est ce qui fait qu'un thème se
   *        change en un endroit et que rien n'en garde une copie.
   */
  constructor({
    THREE,
    scene,
    elevation,
    zoom,
    blockSize,
    segmentsByRing,
    vectorConfig = null,
    maxAnisotropy = 4,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.disposed = false;
    this._refreshing = false;
    /**
     * Profil du lieu : climat et relief. `null` tant qu'aucun rafraîchissement
     * n'a eu lieu, et hors de la fenêtre couverte par la grille climatique —
     * auquel cas tout se peint comme avant qu'un climat existe.
     * @type {{climate: {family: string, koppen: string}, relief: {elevation: number, slope: number}}|null}
     */
    this.landscape = null;
    /** Position de la dernière lecture du profil, en mètres locaux. */
    this._landscapeAnchor = null;
    /** Dernière part de nuit appliquée. `null` force la prochaine à passer. */
    this._night = null;
    /** Dernier vent appliqué, pour ne pas réécrire des uniformes inchangés. */
    this._wind = null;
    /** Dernier mouillé appliqué. Survit à une reconstruction : les matériaux
     * de sol, de chaussée et de voirie sont montés une fois pour toutes. */
    this._wetness = null;

    // La carte de classes précède la bulle : les matériaux de terrain la
    // reçoivent à leur construction, et le même objet d'uniformes est partagé
    // par toutes les tuiles.
    this.groundClass = new GroundClassMap({ THREE, theme });

    this.bubble = new TerrainBubble({
      THREE,
      scene,
      elevation,
      groundClass: this.groundClass,
      zoom,
      blockSize,
      segmentsByRing,
      theme,
    });
    this.bubble.setMaxAnisotropy(maxAnisotropy);

    const bubble = this.bubble;
    this.roadMaterials = createRoadMaterials(THREE, theme.roads);
    this.roadMaterials.setMaxAnisotropy(maxAnisotropy);
    this.roads = new RoadNetwork({
      THREE,
      scene,
      bubble,
      materials: this.roadMaterials.byProfile,
      theme,
    });

    // La voie ferrée ne lit que les tuiles — comme l'eau — et ne dépend
    // d'aucune autre couche : elle ne creuse rien, ne publie rien, et rien ne
    // publie rien pour elle. Voir l'en-tête de `railwayLayer.js` pour ce que
    // cette simplification laisse de côté.
    this.railways = new RailwayLayer({ THREE, scene, bubble, theme });
    // Façade d'emprise combinée : route et voie ferrée, comme si elles n'en
    // formaient qu'une. Les consommateurs qui ne lisaient jusqu'ici que
    // `roads.index` (jardins, végétation, herbe, cultures) reçoivent cet objet
    // à la place de `this.roads` — ils ne touchent jamais à autre chose que
    // `.index`, donc rien d'autre ne change pour eux. Un `get` plutôt qu'une
    // valeur figée : les deux index sont réécrits à chaque reconstruction.
    const composer = this;
    this._infra = {
      get index() {
        return new CombinedIndex([composer.roads.index, composer.railways.index]);
      },
    };

    this.waterMaterial = createWaterMaterial(THREE);
    this.water = new WaterLayer({
      THREE,
      scene,
      bubble,
      material: this.waterMaterial.material,
      theme,
    });
    this.buildings = new BuildingLayer({ THREE, scene, bubble, theme });
    // Les jardins ne lisent pas les tuiles : ils ne connaissent que les maisons
    // que le bâti vient de publier. C'est pour ça qu'ils sont une couche à part
    // et qu'ils passent par ici — voir l'ordre de génération plus haut. Ils
    // reçoivent en revanche les chaussées, pour la même raison que l'herbe et
    // les cultures : une clôture ne se plante pas sur la rue.
    this.gardens = new GardenLayer({ THREE, scene, bubble, roads: this._infra, theme });
    // La voirie ne lit aucune tuile non plus : elle reçoit les tronçons de
    // chaussée, les emprises habitées et les empreintes du bâti. C'est pour ça
    // qu'elle passe par ici — voir l'ordre de génération plus haut.
    this.streets = new StreetLayer({ THREE, scene, bubble, theme });

    this.vegetation = new VegetationLayer({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      roads: this._infra,
      theme,
    });
    this.vegetation.setMaxAnisotropy(maxAnisotropy);
    this.grass = new GroundCover({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      roads: this._infra,
      streets: this.streets,
      theme,
    });
    this.grass.setMaxAnisotropy(maxAnisotropy);

    // Les cultures sèment sur la même carte que celle qui donne au sol sa
    // couleur de champ : elles ne dépendent donc que de `groundClass`, comme
    // l'herbe, et plus du tout du mobilier.
    this.crops = new CropLayer({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      roads: this._infra,
      theme,
    });
    this.crops.setMaxAnisotropy(maxAnisotropy);

    this.furniture = new FurnitureLayer({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      theme,
    });
    this.life = new LifeLayer({ THREE, scene, bubble, theme });

    this.vectorTiles = vectorConfig
      ? new VectorTileSource({
          tiles: vectorConfig.tiles,
          zoom: Math.min(VECTOR_ZOOM, vectorConfig.maxZoom),
        })
      : null;
  }

  /** Repère local de la bulle, ou `null` avant le premier centrage. */
  get frame() {
    return this.bubble.frame;
  }

  /** Déplace la bulle de terrain. @returns {Promise<boolean>} vrai si elle a bougé. */
  setCenter(lng, lat) {
    return this.bubble.setCenter(lng, lat);
  }

  /**
   * Refait le décor autour d'un point si quelque chose l'exige.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {Object} [options]
   * @param {boolean} [options.force] Reconstruit sans condition (montage,
   *        changement d'observateur).
   * @returns {Promise<boolean>} vrai si une reconstruction a eu lieu.
   */
  async refresh(lng, lat, { force = false } = {}) {
    if (this.disposed || this._refreshing || !this.vectorTiles || !this.bubble.frame) return false;

    const here = this.bubble.frame.toLocal(lng, lat);
    // Le profil se prend avant tout le reste, et même quand rien n'est périmé :
    // il ne coûte qu'une lecture de tableau et cinq altitudes, et ce qui le lit
    // le lit à la construction de son propre contenu.
    const climateChanged = this._updateLandscape(lng, lat, here);
    // Les essences d'un bois et la pierre d'un village dépendent du climat :
    // les couches doivent l'avoir en main avant de poser quoi que ce soit.
    const family = this.landscape?.climate?.family ?? null;
    this.vegetation.setClimate(family);
    this.buildings.setClimate(family);
    const wanted = this._wantedTiles(lng, lat);

    // La végétation suit les tuiles de la bulle et non le vectoriel : elle se
    // resynchronise même quand rien d'autre n'a bougé. L'appel est idempotent
    // et ne coûte qu'un parcours des vingt-cinq tuiles montées.
    this.vegetation.sync();

    const classStale = this.groundClass.needsRebuild(here.x, here.z, this.bubble.frame);
    const stale =
      classStale ||
      // Changer de climat change ce qu'il y a à poser, pas seulement où : le
      // décor est aussi périmé que s'il avait glissé de deux cent cinquante
      // mètres.
      climateChanged ||
      this.roads.needsRebuild(here.x, here.z) ||
      this.buildings.needsRebuild(here.x, here.z) ||
      this.water.needsRebuild(here.x, here.z) ||
      this.railways.needsRebuild(here.x, here.z) ||
      this.furniture.needsRebuild(here.x, here.z) ||
      // Une tuile absente du cache est une tuile qui a échoué : les erreurs
      // réseau ne s'y gravent plus, donc il faut réessayer. Sans ça, un
      // incident passager laisserait un trou de décor jusqu'au prochain
      // déplacement de 250 m — un trou sans explication visible.
      this.vectorTiles.missing(wanted) > 0;
    if (!force && !stale) return false;

    this._refreshing = true;
    try {
      await Promise.all(wanted.map((t) => this.vectorTiles.load(t.x, t.y, undefined)));
      if (this.disposed || this.bubble.disposed) return false;

      // 1. Occupation du sol — tout le reste la lit. Elle ne se refait que
      //    lorsqu'elle a vraiment glissé : c'est une rasterisation de 1536²
      //    suivie d'une relecture CPU, hors de question à chaque tuile chargée.
      const wasReady = this.groundClass.ready;
      if (classStale || force) {
        this.groundClass.rebuild(this.vectorTiles, wanted, here, this.bubble.frame);
        this.bubble.materials.syncGroundClass();
      }
      // Premier remplissage : ce qui a été planté avant elle l'a été à l'aveugle.
      const classArrived = !wasReady && this.groundClass.ready;

      // 2. Eau — elle publie sa cuvette et déclenche le creusement du terrain.
      //    Avant les chaussées : la nappe est calculée sur le terrain **brut**,
      //    donc elle ne dépend d'aucun terrassement, mais le terrain, lui, doit
      //    connaître les deux avant de se mailler.
      this.water.rebuild(this.vectorTiles, wanted, here);
      this.bubble.setWaterCut(this.water.index);

      // 3. Chaussées — elles publient l'index et déclenchent le déblai du terrain.
      const hasRoads = this.roads.rebuild(this.vectorTiles, wanted, here);

      // 3 bis. Voie ferrée — ne dépend de rien, ne publie rien : elle ne lit
      //    que les tuiles, comme l'eau.
      this.railways.rebuild(this.vectorTiles, wanted, here);

      // 4. Bâti.
      this.buildings.rebuild(this.vectorTiles, wanted, here);

      // 4 bis. Voirie — après les chaussées et le bâti. Les emprises habitées
      //    sont lues **une fois** ici : la voirie et le mobilier posent la même
      //    question au même moment, et deux lectures pourraient diverger.
      const builtUp = collectBuiltUpAreas(this.vectorTiles, wanted, this.bubble.frame);
      const fabric = new FabricIndex(this.buildings.footprints);
      this.streets.rebuild(this.roads.roadSegments, here, {
        builtUp,
        fabric,
        roadIndex: this.roads.index,
      });

      // 4 ter. Jardins — après le bâti, dont ils reçoivent les maisons, et après
      //    la voirie, dont ils reçoivent la bande revêtue : une clôture ne
      //    traverse pas un trottoir. Ils ne lisent aucune tuile.
      this.gardens.rebuild(this.buildings.houses, here, this.streets.index);

      // 5. Mobilier — il lui faut les tronçons de chaussée et leur index, le
      //    compte de bâtiments (`fabric`) pour distinguer un hameau d'un
      //    bourg, et l'emprise ferroviaire — un corridor au même titre que
      //    celui de la route (voir `railwayLayer.js`).
      this.furniture.rebuild(
        this.vectorTiles,
        wanted,
        here,
        this.roads.roadSegments,
        this.roads.index,
        this.roads.junctions,
        builtUp,
        fabric,
        this.railways.index
      );

      // 6. Arbres — les tuiles déjà plantées le restent : à donnée égale, le
      //    semis est déterministe, les replanter ne ferait que clignoter. Deux
      //    choses seulement justifient de tout reprendre : l'arrivée de la
      //    carte de classes, et un changement de climat — ce qui est planté
      //    l'aurait alors été avec les essences d'une autre région.
      if (classArrived || climateChanged) this.vegetation.sync({ replant: true });

      // 7. Herbe — l'index des chaussées vient de changer, ce qui est semé
      //    peut se trouver sur une route qu'on ne connaissait pas encore.
      if (hasRoads || classStale || force) this.grass.update(here.x, here.z, { force: true });

      // 8. Cultures — même carte que le sol : il suffit de resemer quand elle a
      //    été repeinte, ou quand l'index des chaussées a bougé sous le semis.
      if (classStale || force) this.crops.invalidate();
      this.crops.update(here.x, here.z, { force: hasRoads || classStale || force });

      // 9. Cheminées à faire fumer : le mobilier sait où sont les fermes, mais
      //    la fumée est animée par image.
      this.life.setChimneys(this.furniture.chimneys, here);

      // Maillages neufs : ils naissent éteints, il faut leur repasser l'heure.
      this._night = null;
      return true;
    } catch (e) {
      console.warn('[world] décor partiel', e?.message || e);
      return false;
    } finally {
      this._refreshing = false;
    }
  }

  /**
   * Repose la question du climat et du relief si l'observateur s'est assez
   * éloigné.
   *
   * @returns {boolean} vrai si la **famille** climatique a changé — c'est le
   *          seul changement qui périme du décor déjà posé, une altitude qui
   *          glisse de dix mètres n'en périmant aucun.
   */
  _updateLandscape(lng, lat, here) {
    const anchor = this._landscapeAnchor;
    if (
      anchor &&
      Math.hypot(here.x - anchor.x, here.z - anchor.z) < LANDSCAPE_REBUILD_M
    ) {
      return false;
    }
    this._landscapeAnchor = { x: here.x, z: here.z };

    const before = this.landscape?.climate?.family ?? null;
    const relief = this._reliefAt(here);
    const climate = climateAt(lng, lat);
    // Le relief corrige la famille, jamais le code Köppen : celui-ci reste ce
    // que dit la donnée, et sert à comprendre ce qu'on regarde.
    const family = refineByRelief(climate?.family ?? null, relief);
    this.landscape = family ? { climate: { family, koppen: climate.koppen }, relief } : null;
    return family !== before;
  }

  /** Altitude et pente sous l'observateur, mesurées dans le MNT monté. */
  _reliefAt(here) {
    const bubble = this.bubble;
    const at = (x, z) => bubble.surfaceElevationAtLocal(x, z);
    const span = RELIEF_SPAN_M * 2;
    // Mesurée sur cent vingt mètres et non sur la maille : un MNT à trente
    // mètres bruite la pente de quelques pour cent partout, et c'est le versant
    // qu'on veut, pas le grain (même raison que `crossSlope` côté chaussée).
    const eastWest = crossSlope(at(here.x + RELIEF_SPAN_M, here.z), at(here.x - RELIEF_SPAN_M, here.z), span);
    const northSouth = crossSlope(at(here.x, here.z - RELIEF_SPAN_M), at(here.x, here.z + RELIEF_SPAN_M), span);
    return {
      elevation: at(here.x, here.z),
      slope: Math.hypot(eastWest.slope, northSouth.slope),
    };
  }

  /** Tuiles vectorielles couvrant la bulle autour d'un point. */
  _wantedTiles(lng, lat) {
    const center = lngLatToTile(lng, lat, this.bubble.zoom);
    const half = Math.floor(this.bubble.blockSize / 2);
    return coveringTiles(
      Math.floor(center.x),
      Math.floor(center.y),
      half,
      this.bubble.zoom,
      this.vectorTiles.zoom
    );
  }

  /**
   * Travail d'une image : les files étalées et ce qui bouge.
   *
   * Une tuile plantée et une tuile de terrain recousue par image au plus —
   * composer deux mille matrices ou trente-sept mille sommets d'un coup se
   * verrait comme un à-coup.
   *
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,y:number,z:number}} at Position de l'observateur dans la scène.
   */
  advance(delta, at) {
    if (this.disposed) return;
    this.vegetation.processQueue();
    this.bubble.processRebuildQueue();
    this.waterMaterial.advance(delta);
    this.grass.advance(delta);
    this.grass.update(at.x, at.z);
    this.vegetation.advance(delta);
    this.crops.advance(delta);
    this.crops.update(at.x, at.z);
    this.life.advance(delta, at);
    // Ce que le mobilier a d'animé : les feux qui tournent, et les deux lampes
    // qui suivent l'observateur. Le reste de la couche est figé entre deux
    // reconstructions, et c'est ce qui la rend abordable.
    this.furniture.advanceSignals(delta);
    this.furniture.advanceLamps(at);
    this.furniture.advanceRotor(delta);
  }

  /**
   * Allume ou éteint l'éclairage artificiel. Idempotent : une seule mesure de
   * la nuit, celle du ciel, pour que rien ne bascule à contretemps.
   * @param {number} mix Part de nuit, de 0 à 1.
   */
  setNight(mix) {
    if (this.disposed || mix === this._night) return;
    this._night = mix;
    this.buildings.setNight(mix);
    this.furniture.setNight(mix);
    this.life.setNight(mix);
  }

  /**
   * Accorde le vent de toute la végétation, des éoliennes et des oiseaux.
   * Idempotent, et pour la même raison que `setNight` : une seule mesure,
   * celle du ciel, sinon l'herbe se coucherait pendant que le blé serait au
   * calme.
   *
   * @param {{amplitude:number, speed:number}} field Voir `windField` — le
   *        feuillage n'a besoin que de ça, il ne connaît pas de direction.
   * @param {Object} [weather] État météo résolu (`resolveWeather`) — sa force
   *        (`wind`) et sa direction (`windDirection`) pilotent le rotor des
   *        éoliennes et le cap des oiseaux, qui eux en ont besoin.
   */
  setWind(field, weather = null) {
    if (this.disposed || !field) return;
    const direction = weather ? weather.windDirection : 0;
    const force = weather ? weather.wind : 0;
    const unchanged =
      this._wind &&
      field.amplitude === this._wind.amplitude &&
      field.speed === this._wind.speed &&
      direction === this._wind.direction &&
      force === this._wind.force;
    if (unchanged) return;
    this._wind = { amplitude: field.amplitude, speed: field.speed, direction, force };
    this.grass.setWind(field);
    this.vegetation.setWind(field);
    this.crops.setWind(field);
    this.furniture.setWindDirection(direction, force);
    this.life.setWindDirection(direction);
  }

  /**
   * Mouille le sol : le terrain, la chaussée et la voirie. Les trois ensemble
   * — une route trempée au milieu d'un pré sec est la seule chose que l'œil
   * relèverait ici.
   *
   * Les bâtiments et le mobilier restent secs : une façade prend la pluie sur
   * une seule face, et l'assombrir entièrement serait plus faux que de ne rien
   * faire.
   *
   * @param {number} value De 0 (sec) à 1 (détrempé).
   */
  setWetness(value) {
    if (this.disposed || value === this._wetness) return;
    this._wetness = value;
    this.bubble.materials.setWetness(value);
    this.roadMaterials.setWetness(value);
    this.streets.setWetness(value);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.life.dispose();
    this.furniture.dispose();
    this.crops.dispose();
    this.grass.dispose();
    this.vegetation.dispose();
    this.gardens.dispose();
    this.streets.dispose();
    this.buildings.dispose();
    this.water.dispose();
    this.waterMaterial.dispose();
    this.railways.dispose();
    // Avant la bulle : la couche routière lui retire son déblai en partant.
    this.roads.dispose();
    this.roadMaterials.dispose();
    this.vectorTiles?.dispose();
    this.groundClass.dispose();
    this.bubble.dispose();
  }
}
