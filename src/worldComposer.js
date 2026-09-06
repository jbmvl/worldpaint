/*
 * worldComposer — l'orchestrateur du décor. Toutes les couches dépendent les
 * unes des autres (occupation du sol → terrain, arbres, herbe ; chaussée →
 * terrain, mobilier, herbe interdite) ; ce module est le seul endroit où
 * l'ordre de construction est écrit, et n'expose que trois verbes :
 *
 *   setCenter(lng, lat)   déplace la bulle    (relief, tuiles montées)
 *   refresh(lng, lat)     refait le décor     (tout ce qui vient du vectoriel)
 *   advance(delta, at)    fait vivre l'image  (file de plantation, herbe, vie)
 *
 * Ordre de génération : occupation du sol (tout le monde la lit) → eau
 * (publie sa cuvette, le terrain se creuse dessous comme sous une chaussée)
 * → chaussées (entaillent le terrain, publient l'emprise routière que le
 * reste du décor ne franchit pas) → voie ferrée (indépendante, suit le
 * terrain sans l'entailler, voir `railwayLayer.js`) → bâti (publie maisons et
 * empreintes) → voirie (après chaussées et bâti, un trottoir a besoin des
 * deux ; publie sa bande revêtue) → jardins (tirent clôtures et buissons des
 * maisons, lisent emprise et bande revêtue) → mobilier (tronçons + index des
 * chaussées, compte de bâtiments, emprise ferroviaire, lieux nommés) →
 * arbres (après la carte de classes et les chaussées) → herbe (après l'index
 * des chaussées) → cheminées (publiées par le mobilier, animées par `lifeLayer`).
 *
 * Une couche qui manque ne casse rien : elle se contente de ne rien poser.
 *
 * ## Le profil de paysage
 *
 * Avant tout ça, le compositeur répond pour tout le monde à une question que
 * personne ne se posait : **où sur la Terre sommes-nous ?** `refresh` recevait
 * une longitude et une latitude depuis toujours et les jetait après en avoir
 * tiré des mètres ; il en tire maintenant aussi un `landscape` — la famille
 * climatique et son code Köppen (`core/climate.js`), l'altitude et la pente
 * sous l'observateur.
 *
 * Ce n'est pas une couche et ça ne pose rien : c'est une **entrée**, lue par
 * celles qui choisissent un contenu dans une liste — peuplements, palettes de
 * bourg, cultures, bétail, couleur du sol.
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
import { collectBuiltUpAreas, collectPlaceNames, FabricIndex } from './layers/settlement.js';
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
   *        `resolveTheme`. Le compositeur la distribue sans la lire.
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
    /** Dernière part de nuit appliquée. `null` force la prochaine à passer. */
    this._night = null;
    /** Dernier vent appliqué, pour ne pas réécrire des uniformes inchangés. */
    this._wind = null;
    /** Dernier mouillé appliqué. Survit à une reconstruction. */
    this._wetness = null;

    // La carte de classes précède la bulle : les matériaux de terrain la reçoivent à leur construction.
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

    // La voie ferrée ne lit que les tuiles, comme l'eau, et ne dépend
    // d'aucune autre couche — voir `railwayLayer.js`.
    this.railways = new RailwayLayer({ THREE, scene, bubble, theme });
    // Façade d'emprise combinée (route + voie ferrée) pour les consommateurs
    // de `roads.index` (jardins, végétation, herbe, cultures). Un `get`, pas
    // une valeur figée : les deux index sont réécrits à chaque reconstruction.
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
    // Les jardins ne lisent pas les tuiles, seulement les maisons publiées par
    // le bâti, et les chaussées (une clôture ne se plante pas sur la rue).
    this.gardens = new GardenLayer({ THREE, scene, bubble, roads: this._infra, theme });
    // La voirie non plus : tronçons de chaussée, emprises habitées, empreintes du bâti.
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

    // Les cultures sèment sur la même carte que celle qui colore le sol : dépendent de `groundClass`, comme l'herbe.
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
    // La carte des cultures est le seul endroit où une culture est tirée : le
    // climat doit y être avant la prochaine rasterisation.
    this.groundClass.setClimate(family);
    // Le bétail non plus n'est pas le même partout.
    this.furniture.setClimate(family);
    // La couleur du sol, enfin — et elle se pose à trois endroits qui doivent
    // recevoir le **même** facteur : l'albédo lointain dans le shader, les
    // touffes d'herbe et les tiges de culture du premier plan. Les trois
    // passent par `soilWashFor`, et la redistribution est déclenchée plus bas
    // par `climateChanged`, la teinte étant écrite dans les instances.
    this.bubble.materials.setClimate(family);
    this.grass.setClimate(family);
    this.crops.setClimate(family);
    const wanted = this._wantedTiles(lng, lat);

    // La végétation suit les tuiles de la bulle, pas le vectoriel : se resynchronise même sans autre changement.
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
      // Une tuile absente du cache a échoué : il faut réessayer, sinon un incident réseau laisse un trou de décor.
      this.vectorTiles.missing(wanted) > 0;
    if (!force && !stale) return false;

    this._refreshing = true;
    try {
      await Promise.all(wanted.map((t) => this.vectorTiles.load(t.x, t.y, undefined)));
      if (this.disposed || this.bubble.disposed) return false;

      // 1. Occupation du sol — tout le reste la lit. Rasterisation coûteuse : refaite seulement si elle a glissé.
      const wasReady = this.groundClass.ready;
      // Le climat repeint la carte au même titre qu'un glissement : ce qui y
      // était semé l'a été avec l'assolement d'une autre région.
      if (classStale || climateChanged || force) {
        this.groundClass.rebuild(this.vectorTiles, wanted, here, this.bubble.frame);
        this.bubble.materials.syncGroundClass();
      }
      const classArrived = !wasReady && this.groundClass.ready;

      // 2. Eau — publie sa cuvette avant les chaussées (la nappe se calcule sur
      //    le terrain brut, mais le terrain doit connaître les deux avant de se mailler).
      this.water.rebuild(this.vectorTiles, wanted, here);
      this.bubble.setWaterCut(this.water.index);

      // 3. Chaussées — publient l'index et déclenchent le déblai du terrain.
      const hasRoads = this.roads.rebuild(this.vectorTiles, wanted, here);

      // 3 bis. Voie ferrée — ne dépend de rien, ne publie rien.
      this.railways.rebuild(this.vectorTiles, wanted, here);

      // 4. Bâti.
      this.buildings.rebuild(this.vectorTiles, wanted, here);

      // 4 bis. Voirie — après chaussées et bâti. Emprises habitées lues une
      //    seule fois ici (voirie et mobilier posent la même question).
      const builtUp = collectBuiltUpAreas(this.vectorTiles, wanted, this.bubble.frame);
      const fabric = new FabricIndex(this.buildings.footprints);
      const places = collectPlaceNames(this.vectorTiles, wanted, this.bubble.frame);
      this.streets.rebuild(this.roads.roadSegments, here, {
        builtUp,
        fabric,
        roadIndex: this.roads.index,
      });

      // 4 ter. Jardins — après le bâti (maisons) et la voirie (bande revêtue).
      this.gardens.rebuild(this.buildings.houses, here, this.streets.index);

      // 5. Mobilier — tronçons et index des chaussées, compte de bâtiments
      //    (`fabric`), emprise ferroviaire, lieux nommés (`places`).
      this.furniture.rebuild(
        this.vectorTiles,
        wanted,
        here,
        this.roads.roadSegments,
        this.roads.index,
        this.roads.junctions,
        builtUp,
        fabric,
        this.railways.index,
        places
      );

      // 6. Arbres — semis déterministe : seuls l'arrivée de la carte de classes
      //    et un changement de climat justifient de tout reprendre (ce qui est
      //    planté l'aurait été avec les essences d'une autre région).
      if (classArrived || climateChanged) this.vegetation.sync({ replant: true });

      // 7. Herbe — l'index des chaussées vient peut-être de changer.
      if (hasRoads || classStale || climateChanged || force) {
        this.grass.update(here.x, here.z, { force: true });
      }

      // 8. Cultures — même carte que le sol.
      if (classStale || climateChanged || force) this.crops.invalidate();
      this.crops.update(here.x, here.z, {
        force: hasRoads || classStale || climateChanged || force,
      });

      // 9. Cheminées à faire fumer.
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
   * Repose la question du climat et du relief.
   *
   * Appelée à chaque `refresh`, donc à chaque fois que l'observateur a bougé
   * assez pour justifier d'y regarder — jamais par image. Pas d'ancre ni de
   * seuil de distance ici : `climateAt` n'est qu'une lecture de tableau et
   * `_reliefAt` cinq altitudes déjà montées, moins cher que de maintenir un
   * cache qui doit lui-même savoir se périmer (voir l'historique : un cache en
   * mètres locaux, relatifs à un repère qui se recentre au loin, a longtemps
   * laissé une ville cherchée dans la démo garder le climat de la précédente).
   *
   * @returns {boolean} vrai si la **famille** climatique a changé — c'est le
   *          seul changement qui périme du décor déjà posé, une altitude qui
   *          glisse de dix mètres n'en périmant aucun.
   */
  _updateLandscape(lng, lat, here) {
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
   * Travail d'une image : les files étalées et ce qui bouge (une tuile
   * plantée, une tuile de terrain recousue par image au plus, pour éviter l'à-coup).
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
    // Ce que le mobilier a d'animé : les feux, et les deux lampes qui suivent l'observateur.
    this.furniture.advanceSignals(delta);
    this.furniture.advanceLamps(at);
    this.furniture.advanceRotor(delta);
  }

  /**
   * Allume ou éteint l'éclairage artificiel. Idempotent : une seule mesure de la nuit, celle du ciel.
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
   * Idempotent, comme `setNight`.
   *
   * @param {{amplitude:number, speed:number}} field Voir `windField` — le
   *        feuillage n'a besoin que de ça, il ne connaît pas de direction.
   * @param {Object} [weather] État météo résolu (`resolveWeather`) — sa force
   *        (`wind`) et sa direction (`windDirection`) pilotent le rotor des
   *        éoliennes et le cap des oiseaux.
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
   * Mouille le sol (terrain, chaussée, voirie). Bâtiments et mobilier restent secs.
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
    this.roads.dispose(); // avant la bulle : retire son déblai en partant
    this.roadMaterials.dispose();
    this.vectorTiles?.dispose();
    this.groundClass.dispose();
    this.bubble.dispose();
  }
}
