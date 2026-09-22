import { GenerationMetrics } from './inspect/generationMetrics.js';
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
 * Ordre de génération : « sommes-nous en ville ? » (`settlement.UrbanMask` :
 * ni une couche ni un thème, un prédicat de lieu, lu par la carte du sol qui y
 * peint son trottoir et par les chaussées qui y retranchent voies piétonnes et
 * voies redondantes) → occupation du sol (tout le monde la lit — l'eau en
 * fait partie, c'est une matière du sol) → chaussées (entaillent le terrain,
 * posent la surface des carrefours, publient l'emprise routière que le reste
 * du décor ne franchit pas) → ouvrages d'art (tabliers, piles, têtes de
 * tunnel : ne lisent que les tronçons publiés par les chaussées) → voie ferrée
 * (indépendante, suit le terrain sans l'entailler, voir `railwayLayer.js`) →
 * bâti (lit l'emprise, qui rabote ce qu'une empreinte pose sur la voie, et
 * l'emprise habitée, qui distingue une maison de ville — balcon, cheminée de
 * toit — d'une maison isolée ; publie maisons et empreintes) → voirie (après
 * chaussées et bâti, un trottoir a besoin des deux ; borde aussi les coins de rue des carrefours et
 * comble les vides de faisceau, dans cet ordre — là où un trottoir tient, il
 * vaut mieux qu'un zébra ; publie sa bande revêtue) → jardins (tirent clôtures et buissons des
 * maisons, lisent emprise et bande revêtue) → mobilier (tronçons + index des
 * chaussées, compte de bâtiments, emprise ferroviaire, lieux nommés) →
 * arbres (après la carte de classes et les chaussées : une tuile semée hors de
 * portée de l'index des chaussées se resème quand il va jusqu'à elle) → herbe
 * (après l'index des chaussées) → cheminées, bêtes et tracteurs (publiés par
 * le mobilier et le bâti, animés par `lifeLayer`, `faunaLayer` et
 * `tractorLayer`).
 *
 * Ces trois derniers sont la même figure et méritent qu'on la nomme : une
 * couche reconstruite tous les 250 mètres décide **ce qui existe** — elle
 * seule a lu les tuiles —, et une couche animée par image ne fait plus que le
 * jouer. C'est la seule façon d'avoir du mouvement dans un décor par ailleurs
 * entièrement figé sans payer une reconstruction par image.
 *
 * Une couche qui manque ne casse rien : elle se contente de ne rien poser.
 *
 * ## Le profil de paysage
 *
 * Avant tout ça, le compositeur répond pour tout le monde à une question que
 * personne ne se posait : **où sur la Terre sommes-nous ?** `refresh` recevait
 * une longitude et une latitude depuis toujours et les jetait après en avoir
 * tiré des mètres ; il en tire maintenant aussi un `landscape` — la région
 * naturelle (`core/region.js`), l'altitude et la pente sous l'observateur.
 *
 * Ce n'est pas une couche et ça ne pose rien : c'est une **entrée**, lue par
 * celles qui choisissent un contenu dans une liste — peuplements, palettes de
 * bourg, cultures, bétail, couleur du sol. La lecture elle-même est dans
 * `core/landscape.js` ; le compositeur ne fait que la distribuer
 * (`_distributeRegion`).
 */

import { TerrainBubble } from './terrain/terrainBubble.js';
import { GroundClassMap } from './terrain/groundClassMap.js';
import { RoadNetwork, createRoadMaterials } from './layers/roadNetwork.js';
import { RailwayLayer } from './layers/railwayLayer.js';
import { CliffLayer } from './layers/cliffLayer.js';
import { BridgeLayer } from './layers/bridgeLayer.js';
import { CombinedIndex } from './layers/roadGraph.js';
import { BuildingLayer } from './layers/buildingLayer.js';
import { GardenLayer } from './layers/gardenLayer.js';
import { StreetLayer } from './layers/streetLayer.js';
import { FabricIndex, readSettlement } from './layers/settlement.js';
import { VegetationLayer } from './layers/vegetationLayer.js';
import { GroundCover } from './layers/groundCover.js';
import { CropLayer } from './layers/cropLayer.js';
import { FurnitureLayer } from './layers/furnitureLayer.js';
import { LifeLayer } from './layers/lifeLayer.js';
import { FaunaLayer } from './layers/faunaLayer.js';
import { TractorLayer } from './layers/tractorLayer.js';
import { VectorTileSource, coveringTiles, VECTOR_ZOOM } from './core/vectorTileSource.js';
import { lngLatToTile } from './core/tileMath.js';
import { landscapeAt } from './core/landscape.js';
import { regionById } from './core/region.js';
import { planFaunaCrossing } from './layers/faunaCrossing.js';
import { defaultTheme } from './themes/default.js';

/**
 * Crédit des données affichées. Le décor vient d'OpenStreetMap via les tuiles
 * vectorielles de la carte, le relief des tuiles Terrarium.
 */
export const WORLD_ATTRIBUTION =
  '© OpenStreetMap contributors — relief AWS Terrain Tiles';

export { FAUNA_CROSS_AHEAD_M } from './layers/faunaCrossing.js';

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
     * La racine du décor. Toutes les couches et le relief y sont posés, et pas
     * directement dans la scène de l'application : c'est ce qui permet de
     * l'éteindre d'un bloc là où le monde n'est pas décrit (voir `refresh`).
     *
     * Le ciel, le soleil et le brouillard n'en font pas partie — ils vivent
     * dans `environment`, sur la scène de l'application. Hors couverture, on
     * voit donc le ciel et rien dessous, ce qui se lit comme « rien ici » et
     * non comme un écran noir.
     */
    this.root = new THREE.Group();
    this.root.name = 'worldpaint';
    scene.add(this.root);
    this._scene = scene;
    scene = this.root;
    /**
     * Profil du lieu : région et relief. `null` tant qu'aucun rafraîchissement
     * n'a eu lieu, et hors de toute région couverte — auquel cas le décor
     * s'éteint (voir `refresh`).
     * @type {{region: Object, relief: {elevation: number, slope: number}}|null}
     */
    this.landscape = null;
    /**
     * Région imposée, ou `null` pour suivre la géographie. Ce n'est pas un
     * réglage de décor mais un **outil** : voir `setRegion`.
     */
    this.regionOverride = null;
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
      materials: this.roadMaterials,
      theme,
    });

    // Les ouvrages d'art ne lisent aucune tuile : uniquement les tronçons
    // publiés par les chaussées, dont la plate-forme porte déjà les travées.
    this.bridges = new BridgeLayer({ THREE, scene, bubble, theme });

    // La voie ferrée ne lit que les tuiles, comme l'eau, et ne dépend
    // d'aucune autre couche — voir `railwayLayer.js`.
    this.railways = new RailwayLayer({ THREE, scene, bubble, theme });

    // Les falaises relevées : elles publient la marche que le terrain suit et
    // la bande que la carte du sol peint en roche, et posent la nappe de
    // paroi — les sommets qu'un champ de hauteurs ne peut pas porter sur une
    // face verticale. Elle est rendue avec le matériau du terrain, donc
    // creusée par le même grain que le reste du sol.
    this.cliffs = new CliffLayer({ THREE, scene, bubble, theme });
    // Façade d'emprise combinée (route + voie ferrée) pour les consommateurs
    // de `roads.index` (jardins, végétation, herbe, cultures). Un `get`, pas
    // une valeur figée : les deux index sont réécrits à chaque reconstruction.
    const composer = this;
    this._infra = {
      get index() {
        return new CombinedIndex([composer.roads.index, composer.railways.index]);
      },
      /**
       * Part d'un rectangle sur laquelle les deux réseaux ont quelque chose à
       * dire (la plus faible des deux : l'emprise n'est connue que là où les
       * deux le sont). La végétation s'en sert pour resemer une tuile qu'elle
       * avait semée hors de portée de l'index — voir `knownCoverage`.
       */
      knownCoverageOf(minX, minZ, maxX, maxZ) {
        return Math.min(
          composer.roads.knownCoverageOf(minX, minZ, maxX, maxZ),
          composer.railways.knownCoverageOf(minX, minZ, maxX, maxZ)
        );
      },
    };

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
    // Le vivant au sol : posé par le mobilier, animé ici (voir `faunaLayer`).
    this.fauna = new FaunaLayer({ THREE, scene, theme });
    // Les tracteurs au travail : posés par le mobilier, ancrés au sol comme
    // la faune, mais rien en eux n'est articulé — voir `tractorLayer.js`.
    this.tractors = new TractorLayer({ THREE, scene, theme });

    this.vectorTiles = vectorConfig
      ? new VectorTileSource({
          tiles: vectorConfig.tiles,
          zoom: Math.min(VECTOR_ZOOM, vectorConfig.maxZoom),
        })
      : null;
    this.metrics = new GenerationMetrics();
    for (const [object,method,label] of [
      [this.bubble,'_buildMesh','terrain'], [this.cliffs,'rebuild','falaises'],
      [this.roads,'rebuild','routes'], [this.buildings,'rebuild','batiments'],
      [this.furniture,'rebuild','mobilier'], [this.groundClass,'rebuild','carteSol'],
      [this.vegetation,'_build','forets'], [this.grass,'_scatter','herbe'],
      [this.crops,'_scatter','cultures'], [this.fauna,'advance','animationFaune'],
    ]) this.metrics.watch(object,method,label);
  }

  /** Repère local de la bulle, ou `null` avant le premier centrage. */
  get frame() {
    return this.bubble.frame;
  }

  /**
   * Impose une région, ou rend la main à la géographie (`null`).
   *
   * Le décor ne suit alors plus le lieu : c'est délibéré, et c'est le seul
   * moyen de comparer deux pays sur le **même** terrain — mêmes routes, mêmes
   * parcelles, même relief, tout le reste changé. Sans ça, comparer un Anjou
   * et une Alpujarra demande de se téléporter, donc de changer aussi de bâti,
   * de tracé et de pente, et on ne sait plus ce qui vient du pays.
   *
   * L'appelant doit ensuite reconstruire le décor (`refresh(..., { force:
   * true })`) : cette méthode ne fait que poser l'intention.
   *
   * @param {string|null} id Un identifiant de `REGIONS`, ou `null`.
   * @returns {boolean} vrai si l'intention a changé.
   */
  setRegion(id) {
    const next = id ? regionById(id) : null;
    if (next === this.regionOverride) return false;
    this.regionOverride = next;
    this._landscapeFrame = null;
    return true;
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
    const regionChanged = this._updateLandscape(lng, lat, here);
    const region = this.landscape?.region ?? null;

    // Hors de toute région couverte, le décor **s'éteint** au lieu de se peindre
    // générique. Un paysage tiré dans les listes par défaut ressemble à un
    // paysage, donc personne ne voit qu'il est faux : il montre une campagne
    // française au milieu du Sahara. Rien du tout se lit, lui, du premier coup
    // d'œil — et c'est la réponse honnête tant que le pays n'est pas écrit.
    //
    // On sort avant de charger quoi que ce soit : pas de tuile demandée, pas de
    // semis, pas de rasterisation. Ce qui avait été construit reste en mémoire
    // et se reconstruit en rentrant, `regionChanged` étant alors vrai.
    this.root.visible = region !== null;
    if (!region) return false;

    this._distributeRegion(region);
    // Le relief n'est pas la région (voir `core/region.js`) : c'est lui, et
    // lui seul, qui dit si le rapace remplace le corvidé.
    this.life.setRelief(this.landscape?.relief ?? null);
    const wanted = this._wantedTiles(lng, lat);

    // La végétation suit les tuiles de la bulle, pas le vectoriel : se resynchronise même sans autre changement.
    this.vegetation.sync();

    const classStale = this.groundClass.needsRebuild(here.x, here.z, this.bubble.frame);
    const stale =
      classStale ||
      // Changer de pays change ce qu'il y a à poser, pas seulement où : le
      // décor est aussi périmé que s'il avait glissé de deux cent cinquante
      // mètres.
      regionChanged ||
      this.roads.needsRebuild(here.x, here.z) ||
      this.buildings.needsRebuild(here.x, here.z) ||
      this.railways.needsRebuild(here.x, here.z) ||
      this.cliffs.needsRebuild(here.x, here.z) ||
      this.furniture.needsRebuild(here.x, here.z) ||
      // Une tuile absente du cache a échoué : il faut réessayer, sinon un incident réseau laisse un trou de décor.
      this.vectorTiles.missing(wanted) > 0;
    if (!force && !stale) return false;

    this._refreshing = true;
    try {
      await Promise.all(wanted.map((t) => this.vectorTiles.load(t.x, t.y, undefined)));
      if (this.disposed || this.bubble.disposed) return false;

      // 0. « Sommes-nous en ville ? » — avant tout le monde, parce que la carte
      //    du sol y peint son trottoir et que les chaussées en dépendent (voies
      //    piétonnes jetées, voies redondantes absorbées). Lu une seule fois
      //    ici, puis passé à la voirie et au mobilier, qui posaient la même
      //    question chacun de leur côté.
      const { builtUp, places, urban } = readSettlement(this.vectorTiles, wanted, this.bubble.frame);

      // 0 bis. Falaises — avant tout le monde. Elles façonnent le relief
      //    naturel que les chaussées entailleront ensuite (une route taillée
      //    dans la rampe que la marche supprime se retrouverait en l'air), et
      //    la carte du sol a besoin de leurs bandes pour y peindre la roche.
      const cliffsChanged = this.cliffs.needsRebuild(here.x, here.z) || force;
      if (cliffsChanged) this.cliffs.rebuild(this.vectorTiles, wanted, here);

      // 1. Occupation du sol — tout le reste la lit. Rasterisation coûteuse : refaite seulement si elle a glissé.
      const wasReady = this.groundClass.ready;
      // La région repeint la carte au même titre qu'un glissement : ce qui y
      // était semé l'a été avec l'assolement d'une autre région.
      if (classStale || regionChanged || force) {
        this.groundClass.rebuild(this.vectorTiles, wanted, here, this.bubble.frame, { urban });
        this.bubble.materials.syncGroundClass();
      }
      const classArrived = !wasReady && this.groundClass.ready;

      // 2. Chaussées — publient l'index et déclenchent le déblai du terrain.
      //    L'occupation du sol leur est passée : une travée doit sortir de
      //    l'eau qu'elle franchit (voir `roadWorks.levelWorkSpans`).
      const hasRoads = this.roads.rebuild(this.vectorTiles, wanted, here, {
        groundClass: this.groundClass,
        urban,
      });

      // 2 bis. Ouvrages d'art — après les chaussées, dont ils habillent les
      //    travées et les têtes de tunnel.
      this.bridges.rebuild(this.roads.roadSegments, here);

      // 2 ter. Voie ferrée — ne dépend de rien, ne publie rien.
      this.railways.rebuild(this.vectorTiles, wanted, here);

      // 4. Bâti — après les chaussées, dont l'emprise rabote ce qu'une
      //    empreinte pose sur la voie (la donnée en pose : le tracé de la route
      //    et le contour du bâti viennent de deux relevés différents).
      this.buildings.rebuild(this.vectorTiles, wanted, here, { roadIndex: this.roads.index, builtUp });

      // 4 bis. Voirie — après chaussées et bâti.
      const fabric = new FabricIndex(this.buildings.footprints);
      this.streets.rebuild(this.roads.roadSegments, here, {
        builtUp,
        fabric,
        // Le dessus du trottoir est celui du sol de la ville, et le sol tire sa
        // teinte du pays : les deux doivent lire la même (`pavementTone`).
        matrix: region?.matrix ?? null,
        roadIndex: this.roads.index,
        // Les surfaces de carrefour : elles arrêtent les rives de tronçon et
        // portent les coins de rue.
        areas: this.roads.junctionAreas,
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
        places,
        {
          // Les surfaces de carrefour : un panneau de priorité se pose à une
          // bouche, et la bouche n'existe que là.
          areas: this.roads.junctionAreas,
          // Maisons du bâti déjà posé — voir `furniture/domesticFauna.js`.
          houses: this.buildings.houses,
        }
      );

      // 6. Arbres — après les chaussées, dont l'emprise décide où le semis
      //    s'interrompt. `sync` remet en file les tuiles semées quand l'index
      //    n'allait pas jusqu'à elles ; seuls l'arrivée de la carte de classes
      //    et un changement de région justifient de tout reprendre (ce qui est
      //    planté l'aurait été avec les essences d'une autre région).
      this.vegetation.sync({ replant: classArrived || regionChanged });
      // Le sous-étage, lui, se refait d'un bloc : l'emprise vient de changer.
      this.vegetation.update(here.x, here.z, {
        force: hasRoads || classStale || regionChanged || force,
      });

      // 7. Herbe — l'index des chaussées vient peut-être de changer.
      if (hasRoads || classStale || regionChanged || force) {
        this.grass.update(here.x, here.z, { force: true });
      }

      // 8. Cultures — même carte que le sol.
      if (classStale || regionChanged || force) this.crops.invalidate();
      this.crops.update(here.x, here.z, {
        force: hasRoads || classStale || regionChanged || force,
      });

      // 9. Cheminées à faire fumer, bêtes et tracteurs à faire vivre. Publiés
      //    par le mobilier (fermes, labours) et le bâti (toits de ville), qui
      //    seuls ont lu les tuiles : ce sont les endroits où une couche
      //    animée par image reprend le travail d'une couche reconstruite
      //    tous les 250 mètres.
      this.life.setChimneys([...this.furniture.chimneys, ...this.buildings.chimneys], here);
      this.fauna.setAnimals(this.furniture.fauna, here);
      this.tractors.setTractors(this.furniture.tractors, here);

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
   * Passe le dossier de région à tout ce qui choisit un contenu dans une liste.
   * Avant toute construction : les essences d'un bois, la pierre d'un village,
   * l'assolement d'une carte de cultures et le bétail d'un pré doivent l'avoir
   * en main avant de poser quoi que ce soit.
   *
   * Chaque couche y prend ce qui la regarde — la matrice, les essences, les
   * matériaux — plutôt que de recevoir sept arguments dont elle ignore six.
   *
   * La couleur du sol se pose à trois endroits qui doivent recevoir le **même**
   * facteur (`soilWashFor`) : l'albédo lointain dans le shader, les touffes
   * d'herbe et les tiges de culture du premier plan. La redistribution, elle,
   * est déclenchée par `regionChanged` — la teinte est écrite dans les
   * instances.
   */
  _distributeRegion(region) {
    this.vegetation.setRegion(region);
    this.buildings.setRegion(region);
    this.groundClass.setRegion(region);
    this.furniture.setRegion(region);
    this.bubble.materials.setRegion(region);
    this.grass.setRegion(region);
    this.crops.setRegion(region);
  }

  /**
   * Repose la question de la région et du relief.
   *
   * Appelée à chaque `refresh`, donc à chaque fois que l'observateur a bougé
   * assez pour justifier d'y regarder — jamais par image. La lecture elle-même
   * est dans `core/landscape.js`, avec la raison pour laquelle elle n'est pas
   * mémoïsée.
   *
   * @returns {boolean} vrai si la **région** a changé — c'est le seul
   *          changement qui périme du décor déjà posé, une altitude qui glisse
   *          de dix mètres n'en périmant aucun.
   */
  _updateLandscape(lng, lat, here) {
    const before = this.landscape?.region ?? null;
    this.landscape = landscapeAt(lng, lat, here, {
      bubble: this.bubble,
      override: this.regionOverride || (this._landscapeFrame === this.bubble.frame ? before : null),
    });
    this._landscapeFrame = this.bubble.frame;
    return (this.landscape?.region ?? null) !== before;
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
   * Déclenche la traversée d'une bête devant l'observateur.
   *
   * C'est le seul endroit du moteur où une application peut demander qu'il se
   * passe **quelque chose**, à un instant qu'elle choisit. Le trajet lui-même
   * se compose dans `layers/faunaCrossing.js` ; ce verbe le confie à la couche
   * qui le joue.
   *
   * @param {Object} options Voir `planFaunaCrossing` : espèce, position et
   *        direction du regard de l'observateur, et les réglages du trajet.
   * @returns {Object|null} La bête lancée (à repasser à
   *          `fauna.cancelCrossing` pour l'interrompre), ou `null` si la
   *          traversée ne peut pas être composée.
   */
  crossFauna(options = {}) {
    if (this.disposed) return null;
    const beast = planFaunaCrossing({
      ...options,
      bubble: this.bubble,
      coats: this.theme.fauna?.coats,
    });
    return beast ? this.fauna.addCrossing(beast) : null;
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
    // Les rides de l'eau vivent dans le shader de terrain, avec elle.
    this.bubble.materials.advanceWater(delta);
    this.grass.advance(delta);
    this.grass.update(at.x, at.z);
    this.vegetation.advance(delta);
    this.vegetation.update(at.x, at.z);
    this.crops.advance(delta);
    this.crops.update(at.x, at.z);
    this.life.advance(delta, at);
    // La position sert à `faunaLayer` pour n'oublier une traversée déclenchée
    // qu'une fois l'observateur passé au large, et pour faire fuir une bête
    // marquée `flee` qui le voit approcher ; l'échantillonnage du relief lui
    // est nécessaire pour tracer cette fuite (voir `faunaLayer._checkFlee`).
    this.fauna.advance(delta, at, (x, z) => this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale);
    this.tractors.advance(delta);
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
    this.fauna.dispose();
    this.tractors.dispose();
    this.furniture.dispose();
    this.crops.dispose();
    this.grass.dispose();
    this.vegetation.dispose();
    this.gardens.dispose();
    this.streets.dispose();
    this.buildings.dispose();
    this.railways.dispose();
    this.bridges.dispose();
    this.cliffs.dispose(); // avant la bulle : retire sa marche en partant
    this.roads.dispose(); // avant la bulle : retire son déblai en partant
    this.roadMaterials.dispose();
    this.vectorTiles?.dispose();
    this.groundClass.dispose();
    this.bubble.dispose();
    this._scene?.remove(this.root);
  }
}
