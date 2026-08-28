/*
 * world — la porte d'entrée du générateur.
 * -----------------------------------------
 * `worldComposer` sait dans quel ordre fabriquer un paysage, mais il ne sait
 * pas d'où vient le relief ni ce qu'il y a dans le ciel. Trois objets sont donc
 * toujours montés ensemble par une application : le champ d'altitude, le
 * compositeur, et — si elle en veut un — le ciel. `createWorld` fait ce montage
 * une fois pour toutes, pour qu'une application n'ait pas à réapprendre l'ordre.
 *
 * Ce que cette fonction **ne fait pas**, et ne fera jamais :
 *
 *   - elle ne crée pas le renderer, ni la scène, ni la caméra ;
 *   - elle ne tient pas de boucle de rendu ;
 *   - elle ne décide pas où se trouve l'observateur.
 *
 * C'est l'application qui possède la scène et qui mène le temps. Le générateur
 * ne fait qu'habiller ce qu'on lui désigne. Il en découle une conséquence utile :
 * une application peut se passer de `createWorld` et monter `WorldComposer`
 * elle-même — c'est un raccourci, pas un passage obligé.
 *
 * ## Les cinq verbes
 *
 *   setCenter(lng, lat)          déplace la bulle de terrain
 *   refresh(lng, lat, {force})   refait le décor vectoriel
 *   advance(delta, at)           fait vivre l'image
 *   updateSky({...})             avance l'heure ; rend de quoi peindre le fond
 *   dispose()                    libère tout ce qui a été alloué
 *
 * `updateSky` n'existe que si un ciel a été demandé. Sans ciel, le générateur
 * ne pose aucune lumière : l'application éclaire la scène comme elle l'entend.
 */

import { ElevationField } from './core/elevationField.js';
import { WorldComposer, WORLD_ATTRIBUTION } from './worldComposer.js';
import { SceneEnvironment, SKY_RADIUS, SHADOW_LEAD_M } from './environment/sceneEnvironment.js';
import { tileSizeMeters } from './core/tileMath.js';
import { resolveTheme } from './themes/theme.js';
import { defaultTheme } from './themes/default.js';

/**
 * Réglages de la bulle. Le zoom 15 est le seul qui tienne les deux bouts :
 * assez fin pour que le MNT donne du relief à hauteur d'homme, assez large pour
 * qu'un bloc de 3×3 tuiles couvre plus loin que ce qu'on voit avant le
 * brouillard. La finesse de maille décroît par anneau — l'anneau du centre
 * porte le détail, les huit autres portent la silhouette.
 */
export const DEFAULT_VIEW = {
  zoom: 15,
  blockSize: 3,
  segmentsByRing: [192, 96, 48],
  maxAnisotropy: 4,
};

/**
 * Monte un paysage dans une scène three.js existante.
 *
 * @param {Object} options
 * @param {Object} options.THREE  Le module three de l'application. Il n'est
 *        jamais importé ici : deux copies de three dans une même page ne
 *        partagent ni leurs constantes ni leurs prototypes.
 * @param {Object} options.scene  La scène qui recevra le décor.
 * @param {ElevationField|{url?: string, encoding?: string, maxTiles?: number}} [options.elevation]
 *        Relief. Un objet de réglages monte un `ElevationField` par défaut
 *        (tuiles Terrarium d'AWS Open Data, sans clé). Une instance déjà
 *        construite est utilisée telle quelle — et n'est alors **pas** libérée
 *        par `dispose()`, puisqu'elle ne nous appartient pas.
 * @param {{tiles: string[], maxZoom?: number}|null} [options.vector]
 *        Tuiles vectorielles OpenMapTiles : gabarits d'URL `{z}/{x}/{y}` et
 *        zoom maximal servi. Absentes, le décor se réduit au relief nu — ce
 *        qui est un état valide, pas une erreur.
 * @param {Object} [options.view] Voir `DEFAULT_VIEW`.
 * @param {Object|null} [options.theme] Direction artistique. Les tranches
 *        données remplacent celles de `defaultTheme`, entières — voir
 *        `resolveTheme`. C'est le seul endroit où l'on change la direction
 *        artistique d'un monde : le thème résolu descend jusqu'aux couches, et
 *        rien ne le tient ailleurs, donc deux mondes de thèmes différents
 *        cohabitent dans la même page sans se voir.
 * @param {Object|null} [options.sky] Ciel, soleil et brouillard. `null` (le
 *        défaut) n'en pose aucun. Sinon `{ Sky }` est obligatoire : la classe
 *        `three/examples/jsm/objects/Sky.js`, que l'application importe pour
 *        garder trois dans un seul bundle.
 * @param {Object} [options.sky.Sky]
 * @param {{fog: string, nightZenith: string, nightHorizon: string}} [options.sky.palette]
 * @param {number} [options.sky.fogRadius] Défaut : le demi-côté de la bulle.
 * @param {number} [options.sky.shadowMapSize]
 * @param {Object} [options.sky.weather] Temps qu'il fait au montage (voir
 *        `environment/weather.js`). C'est un **état**, pas une direction
 *        artistique : il n'a rien à faire dans `theme`, il change en cours de
 *        route et se repasse à `updateSky`. Le moteur ne va jamais le chercher
 *        lui-même — d'où il vient (un relevé, une simulation, un curseur) ne
 *        regarde que l'application.
 * @param {number} [options.sky.cloudCoverage] Raccourci sur `weather.cloudCover`.
 * @param {number} [options.sky.cloudDensity] Raccourci sur `weather.cloudDensity`.
 * @param {number} [options.sky.latitude] Latitude servant à calculer le rayon
 *        de brouillard par défaut (une tuile n'a pas la même taille au sol à
 *        Oslo et à Lagos). Défaut : 45.
 * @returns {World}
 */
export function createWorld({
  THREE,
  scene,
  elevation = {},
  vector = null,
  view = {},
  theme = null,
  sky = null,
}) {
  if (!THREE) throw new Error('createWorld: THREE manquant');
  if (!scene) throw new Error('createWorld: scene manquante');
  // Contrôlé avant toute allocation : un montage à moitié fait qui remonte une
  // erreur laisse derrière lui un compositeur que personne ne libérera.
  if (sky && !sky.Sky) {
    throw new Error('createWorld: sky.Sky manquant (three/examples/jsm/objects/Sky.js)');
  }

  const settings = { ...DEFAULT_VIEW, ...view };
  const resolved = resolveTheme(theme);

  const ownsElevation = !(elevation instanceof ElevationField);
  const field = ownsElevation
    ? new ElevationField({ zoom: settings.zoom, ...elevation })
    : elevation;

  const composer = new WorldComposer({
    THREE,
    scene,
    elevation: field,
    zoom: settings.zoom,
    blockSize: settings.blockSize,
    segmentsByRing: settings.segmentsByRing,
    vectorConfig: vector,
    maxAnisotropy: settings.maxAnisotropy,
    theme: resolved,
  });

  let environment = null;
  if (sky) {
    const latitude = Number.isFinite(sky.latitude) ? sky.latitude : 45;
    environment = new SceneEnvironment({
      THREE,
      Sky: sky.Sky,
      scene,
      fogRadius:
        sky.fogRadius ?? (settings.blockSize / 2) * tileSizeMeters(settings.zoom, latitude),
      shadowMapSize: sky.shadowMapSize,
      cloudCoverage: sky.cloudCoverage,
      cloudDensity: sky.cloudDensity,
      weather: sky.weather,
      palette: sky.palette || resolved.sky,
      // Les feuilles emportées par le vent prennent la teinte de feuillage du
      // thème courant : ce n'est pas une couleur que l'environnement invente.
      debrisTint: resolved.furniture.colors.leaf,
    });
  }

  return new World({ composer, environment, elevation: field, ownsElevation, theme: resolved });
}

/**
 * Le paysage monté. Une façade, et rien de plus : chaque verbe se lit en une
 * ligne dans le corps de la classe. Ce qui a besoin d'aller plus loin passe par
 * `composer`, `bubble` ou `environment`, qui ne sont pas cachés.
 */
export class World {
  constructor({ composer, environment, elevation, ownsElevation, theme = defaultTheme }) {
    this.composer = composer;
    /** Le thème résolu de ce monde. En lecture seule : il est gelé. */
    this.theme = theme;
    this.environment = environment;
    this.elevation = elevation;
    this._ownsElevation = ownsElevation;
    this.attribution = WORLD_ATTRIBUTION;
    this.disposed = false;
  }

  /** Repère local de la bulle, ou `null` avant le premier centrage. */
  get frame() {
    return this.composer.frame;
  }

  /** La bulle de terrain : altitudes du sol, conversion lng/lat ↔ scène. */
  get bubble() {
    return this.composer.bubble;
  }

  /** Carte d'occupation du sol, lue par l'étiquetage des cultures. */
  get groundClass() {
    return this.composer.groundClass;
  }

  /** Couleur de fond à donner au renderer, ou `null` sans ciel. */
  get clearColor() {
    return this.environment ? this.environment.clearColor : null;
  }

  /** Déplace la bulle de terrain. @returns {Promise<boolean>} vrai si elle a bougé. */
  setCenter(lng, lat) {
    return this.composer.setCenter(lng, lat);
  }

  /** Refait le décor vectoriel autour d'un point. @returns {Promise<boolean>} */
  refresh(lng, lat, options) {
    return this.composer.refresh(lng, lat, options);
  }

  /**
   * Travail d'une image : files de plantation, herbe, animations.
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,y:number,z:number}} at Point observé, en unités de scène.
   */
  advance(delta, at) {
    this.composer.advance(delta, at);
    // La chute d'eau avance en temps **réel écoulé**, alors que l'heure du ciel
    // peut être simulée, figée ou accélérée : elle est donc animée ici et pas
    // dans `updateSky`, qui ne connaît qu'une date.
    this.environment?.advance(delta, at);
  }

  /**
   * Avance l'heure du ciel et rend de quoi peindre le reste de l'image.
   *
   * Les gestes vont ensemble et dans cet ordre : le dôme se recale sur la
   * caméra, le soleil se replace, la nuit se propage aux fenêtres et aux
   * lampadaires, le vent et le mouillé se propagent au décor, puis la boîte
   * d'ombre se pose devant l'observateur. Les séparer, c'est se garantir une
   * image où le décor est allumé et le ciel non, ou une route trempée sous un
   * ciel dégagé.
   *
   * @param {Object} options
   * @param {Object} options.camera  Caméra de l'application (le dôme la suit).
   * @param {Date} options.date      Heure représentée.
   * @param {number} options.lng
   * @param {number} options.lat
   * @param {{x:number,y:number,z:number}} [options.shadowAt] Centre de la boîte
   *        d'ombre. Défaut : la position de la caméra.
   * @param {Object} [options.palette] Change la direction artistique en vol.
   * @param {Object} [options.weather] Change le temps qu'il fait en vol. Omis,
   *        le dernier reçu est reconduit.
   * @returns {{nightMix: number, wetness: number, weather: Object, clearColor: Object}|null}
   *        `null` sans ciel. La part de nuit et le mouillé sont rendus pour que
   *        l'application les applique à ses propres objets (des phares, un
   *        véhicule, une enseigne) au même instant que nous — c'est tout
   *        l'intérêt d'une mesure unique.
   */
  updateSky({ camera, date, lng, lat, shadowAt = null, palette = undefined, weather = undefined }) {
    const env = this.environment;
    if (!env) return null;
    env.followCamera(camera);
    env.update({ palette, date, lat, lng, weather });
    this.composer.setNight(env.nightMix);
    this.composer.setWind(env.wind);
    this.composer.setWetness(env.wetness);
    env.followShadow(shadowAt || camera.position);
    return {
      nightMix: env.nightMix,
      wetness: env.wetness,
      weather: env.weather,
      clearColor: env.clearColor,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.environment?.dispose();
    this.composer.dispose();
    if (this._ownsElevation) this.elevation.dispose();
  }
}

export { SKY_RADIUS, SHADOW_LEAD_M, WORLD_ATTRIBUTION };
