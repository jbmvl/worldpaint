/*
 * world — la porte d'entrée du générateur. `createWorld` monte ensemble le
 * champ d'altitude, le `WorldComposer` et — si demandé — le ciel, une fois
 * pour toutes.
 *
 * Ne crée jamais le renderer, la scène, la caméra ni une boucle de rendu, et
 * ne décide pas de la position de l'observateur : c'est l'application qui
 * possède la scène et mène le temps. `createWorld` est un raccourci ; monter
 * `WorldComposer` directement reste possible.
 *
 * Cinq verbes : setCenter, refresh, advance, updateSky (seulement si un ciel
 * a été demandé), dispose.
 */

import { ElevationField } from './core/elevationField.js';
import { WorldComposer, WORLD_ATTRIBUTION } from './worldComposer.js';
import { SceneEnvironment, SKY_RADIUS, SHADOW_LEAD_M } from './environment/sceneEnvironment.js';
import { tileSizeMeters } from './core/tileMath.js';
import { resolveTheme } from './themes/theme.js';
import { defaultTheme } from './themes/default.js';

/**
 * Réglages de la bulle. Zoom 15 : assez fin pour le relief à hauteur d'homme,
 * assez large pour qu'un bloc de 3×3 tuiles couvre plus loin que le brouillard.
 * La finesse de maille décroît par anneau (détail au centre, silhouette autour).
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
 * @param {Object} options.THREE  Le module three de l'application (jamais importé ici).
 * @param {Object} options.scene  La scène qui recevra le décor.
 * @param {ElevationField|{url?: string, encoding?: string, maxTiles?: number}} [options.elevation]
 *        Relief. Un objet de réglages monte un `ElevationField` par défaut
 *        (tuiles Terrarium d'AWS Open Data, sans clé). Une instance déjà
 *        construite est utilisée telle quelle et n'est pas libérée par `dispose()`.
 * @param {{tiles: string[], maxZoom?: number}|null} [options.vector]
 *        Tuiles vectorielles OpenMapTiles. Absentes, le décor se réduit au relief nu.
 * @param {Object} [options.view] Voir `DEFAULT_VIEW`.
 * @param {Object|null} [options.theme] Direction artistique — tranches
 *        entières qui remplacent celles de `defaultTheme`, voir `resolveTheme`.
 * @param {Object|null} [options.sky] Ciel, soleil et brouillard. `null` (le
 *        défaut) n'en pose aucun. Sinon `{ Sky }` est obligatoire : la classe
 *        `three/examples/jsm/objects/Sky.js`.
 * @param {Object} [options.sky.Sky]
 * @param {{fog: string, nightZenith: string, nightHorizon: string}} [options.sky.palette]
 * @param {number} [options.sky.fogRadius] Défaut : le demi-côté de la bulle.
 * @param {number} [options.sky.shadowMapSize]
 * @param {Object} [options.sky.weather] Temps qu'il fait au montage (voir
 *        `environment/weather.js`) — un état, repassé à `updateSky`, pas une direction artistique.
 * @param {number} [options.sky.cloudCoverage] Raccourci sur `weather.cloudCover`.
 * @param {number} [options.sky.cloudDensity] Raccourci sur `weather.cloudDensity`.
 * @param {number} [options.sky.latitude] Latitude pour le rayon de brouillard par défaut. Défaut : 45.
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
  // Contrôlé avant toute allocation, pour ne pas laisser un compositeur non libéré.
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
      // Teinte du feuillage du thème courant, pas inventée par l'environnement.
      debrisTint: resolved.furniture.colors.leaf,
    });
  }

  return new World({ composer, environment, elevation: field, ownsElevation, theme: resolved });
}

/**
 * Le paysage monté. Une façade : ce qui a besoin d'aller plus loin passe par
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
    // Animée en temps réel écoulé, contrairement à `updateSky` qui ne connaît qu'une date.
    this.environment?.advance(delta, at);
  }

  /**
   * Avance l'heure du ciel et rend de quoi peindre le reste de l'image. Les
   * gestes vont dans cet ordre : dôme recalé sur la caméra, soleil replacé,
   * nuit propagée aux fenêtres/lampadaires, vent et mouillé propagés au
   * décor, puis boîte d'ombre posée devant l'observateur.
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
   *        `null` sans ciel. Rendu pour que l'application applique la même
   *        mesure à ses propres objets (phares, véhicule, enseigne).
   */
  updateSky({ camera, date, lng, lat, shadowAt = null, palette = undefined, weather = undefined }) {
    const env = this.environment;
    if (!env) return null;
    env.followCamera(camera);
    env.update({ palette, date, lat, lng, weather });
    this.composer.setNight(env.nightMix);
    this.composer.setWind(env.wind, env.weather);
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
