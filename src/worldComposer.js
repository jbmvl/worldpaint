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
 *   2. **chaussées** — elles entaillent le terrain et publient leur index ;
 *   3. **eau, bâti** — indépendants, ils ne lisent que les tuiles ; le bâti
 *      publie au passage ses **maisons** et l'ensemble de ses **empreintes** ;
 *   3 bis. **voirie** — après les chaussées *et* le bâti, parce qu'un trottoir
 *      demande les deux : la plate-forme sur laquelle il se pose, et les
 *      maisons qui prouvent que c'est une rue. Elle publie sa bande revêtue,
 *      que l'herbe et les jardins lisent pour ne pas la traverser ;
 *   3 ter. **jardins** — après le bâti, dont ils reçoivent les maisons, et
 *      après la voirie, dont ils reçoivent la bande revêtue ; eux ne lisent
 *      aucune tuile ;
 *   4. **mobilier** — il lui faut les tronçons *et* l'index des chaussées :
 *      murs et glissières se posent sur la plate-forme exacte sur laquelle
 *      roule l'observateur, et les feux n'ont de sens qu'aux carrefours ;
 *   5. **arbres** — après la carte de classes, qui décide où est le bois ;
 *   6. **herbe** — après l'index des chaussées, pour ne pas pousser sur le
 *      bitume ;
 *   7. **cheminées** — publiées par le mobilier, animées par `lifeLayer`.
 *
 * Une couche qui manque ne casse rien : chacune se contente de ne rien poser.
 */

import { TerrainBubble } from './terrain/terrainBubble.js';
import { GroundClassMap } from './terrain/groundClassMap.js';
import { RoadNetwork, createRoadMaterials } from './layers/roadNetwork.js';
import { WaterLayer, createWaterMaterial } from './layers/waterLayer.js';
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
import { defaultTheme } from './themes/default.js';

/**
 * Crédit des données affichées. Le décor vient d'OpenStreetMap via les tuiles
 * vectorielles de la carte, le relief des tuiles Terrarium.
 */
export const WORLD_ATTRIBUTION = '© OpenStreetMap contributors — relief AWS Terrain Tiles';

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

    // La carte de classes précède la bulle : les matériaux de terrain la
    // reçoivent à leur construction, et le même objet d'uniformes est partagé
    // par toutes les tuiles.
    this.groundClass = new GroundClassMap({ THREE });

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
    // et qu'ils passent par ici — voir l'ordre de génération plus haut.
    this.gardens = new GardenLayer({ THREE, scene, bubble, theme });
    // La voirie ne lit aucune tuile non plus : elle reçoit les tronçons de
    // chaussée, les emprises habitées et les empreintes du bâti. C'est pour ça
    // qu'elle passe par ici — voir l'ordre de génération plus haut.
    this.streets = new StreetLayer({ THREE, scene, bubble, theme });

    this.vegetation = new VegetationLayer({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      theme,
    });
    this.vegetation.setMaxAnisotropy(maxAnisotropy);
    this.grass = new GroundCover({
      THREE,
      scene,
      bubble,
      groundClass: this.groundClass,
      roads: this.roads,
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
      roads: this.roads,
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
    const wanted = this._wantedTiles(lng, lat);

    // La végétation suit les tuiles de la bulle et non le vectoriel : elle se
    // resynchronise même quand rien d'autre n'a bougé. L'appel est idempotent
    // et ne coûte qu'un parcours des vingt-cinq tuiles montées.
    this.vegetation.sync();

    const classStale = this.groundClass.needsRebuild(here.x, here.z, this.bubble.frame);
    const stale =
      classStale ||
      this.roads.needsRebuild(here.x, here.z) ||
      this.buildings.needsRebuild(here.x, here.z) ||
      this.water.needsRebuild(here.x, here.z) ||
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

      // 2. Chaussées — elles publient l'index et déclenchent le déblai du terrain.
      const hasRoads = this.roads.rebuild(this.vectorTiles, wanted, here);

      // 3. Eau et bâti — indépendants.
      this.water.rebuild(this.vectorTiles, wanted, here);
      this.buildings.rebuild(this.vectorTiles, wanted, here);

      // 3 bis. Voirie — après les chaussées et le bâti. Les emprises habitées
      //    sont lues **une fois** ici : la voirie et le mobilier posent la même
      //    question au même moment, et deux lectures pourraient diverger.
      const builtUp = collectBuiltUpAreas(this.vectorTiles, wanted, this.bubble.frame);
      const fabric = new FabricIndex(this.buildings.footprints);
      this.streets.rebuild(this.roads.roadSegments, here, { builtUp, fabric });

      // 3 ter. Jardins — après le bâti, dont ils reçoivent les maisons, et après
      //    la voirie, dont ils reçoivent la bande revêtue : une clôture ne
      //    traverse pas un trottoir. Ils ne lisent aucune tuile.
      this.gardens.rebuild(this.buildings.houses, here, this.streets.index);

      // 4. Mobilier — il lui faut les tronçons de chaussée et leur index.
      this.furniture.rebuild(
        this.vectorTiles,
        wanted,
        here,
        this.roads.roadSegments,
        this.roads.index,
        builtUp
      );

      // 5. Arbres — les tuiles déjà plantées le restent : à donnée égale, le
      //    semis est déterministe, les replanter ne ferait que clignoter. Seule
      //    l'arrivée de la carte de classes justifie de tout reprendre.
      if (classArrived) this.vegetation.sync({ replant: true });

      // 6. Herbe — l'index des chaussées vient de changer, ce qui est semé
      //    peut se trouver sur une route qu'on ne connaissait pas encore.
      if (hasRoads || classStale || force) this.grass.update(here.x, here.z, { force: true });

      // 7. Cultures — même carte que le sol : il suffit de resemer quand elle a
      //    été repeinte, ou quand l'index des chaussées a bougé sous le semis.
      if (classStale || force) this.crops.invalidate();
      this.crops.update(here.x, here.z, { force: hasRoads || classStale || force });

      // 8. Cheminées à faire fumer : le mobilier sait où sont les fermes, mais
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
    // Avant la bulle : la couche routière lui retire son déblai en partant.
    this.roads.dispose();
    this.roadMaterials.dispose();
    this.vectorTiles?.dispose();
    this.groundClass.dispose();
    this.bubble.dispose();
  }
}
