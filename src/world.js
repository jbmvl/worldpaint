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
 * a été demandé), dispose. Plus un sixième, à part : `crossFauna`, qui ne
 * construit ni n'avance rien — il déclenche un événement (voir
 * `WorldComposer.crossFauna`). `cheer` est son pendant au bord de la route.
 *
 * `roadPositionAt`, `roadSnapAt` et `roadsideAt` ne sont ni l'un ni l'autre :
 * des questions, pas des actions — à quelle altitude passe la chaussée sous ce
 * point (remblai, pont) plutôt que le terrain nu que suit déjà
 * `bubble.toScenePosition`, où est son axe pour qui doit y rester, et où est
 * son bord pour qui pose un objet à côté.
 */

import { ElevationField } from './core/elevationField.js';
import { WorldComposer, WORLD_ATTRIBUTION, FAUNA_CROSS_AHEAD_M } from './worldComposer.js';
import {
  platformPositionAt,
  platformSideAt,
  platformSnapAt,
  ROAD_SNAP_RADIUS_M,
} from './layers/roadNetwork.js';
import { tunnelAt } from './layers/transportTunnels.js';
import {
  SceneEnvironment,
  SKY_RADIUS,
  SKY_LAYER,
  SHADOW_LEAD_M,
  skyPaletteFor,
} from './environment/sceneEnvironment.js';
import { tileSizeMeters } from './core/tileMath.js';
import { resolveTheme } from './themes/theme.js';
import { defaultTheme } from './themes/default.js';

/**
 * Réglages de la bulle. Zoom 15 : assez fin pour le relief à hauteur d'homme,
 * assez large pour qu'un bloc de 3×3 tuiles couvre plus loin que le brouillard.
 * La finesse de maille décroît par anneau (détail au centre, silhouette autour).
 * Les anneaux entaillés font exception et gardent la maille fine : c'est le plus
 * grossier d'entre eux qui fixe la largeur du fond plat du déblai
 * (`roadCut.cutBenchAt`), et un fond plat large se lit comme une terrasse.
 */
export const DEFAULT_VIEW = {
  zoom: 15,
  blockSize: 3,
  segmentsByRing: [192, 192, 48],
  maxAnisotropy: 4,
};

/**
 * Zoom des tuiles du MNT, distinct de celui de la bulle : c'est le zoom
 * maximal que sert la source qui le décide, pas la finesse de la maille.
 * MapTiler s'arrête au 14 ; demander plus fin ne rendrait que des 404.
 *
 * Une autre source se règle par `elevation.zoom` ; la bulle s'y adapte.
 */
export const DEFAULT_ELEVATION_ZOOM = 14;

/**
 * Monte un paysage dans une scène three.js existante.
 *
 * @param {Object} options
 * @param {Object} options.THREE  Le module three de l'application (jamais importé ici).
 * @param {Object} options.scene  La scène qui recevra le décor.
 * @param {ElevationField|{zoom?: number, url?: string, encoding?: string, maxTiles?: number}} [options.elevation]
 *        Relief. Un objet de réglages monte un `ElevationField` par défaut
 *        (tuiles Terrarium d'AWS Open Data, sans clé, au `DEFAULT_ELEVATION_ZOOM`).
 *        Une instance déjà construite est utilisée telle quelle et n'est pas
 *        libérée par `dispose()`.
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
 * @param {number} [options.sky.toneMappingExposure] Celle du renderer (ACES). Défaut : 0,5.
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
    ? new ElevationField({ zoom: DEFAULT_ELEVATION_ZOOM, ...elevation })
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
      toneMappingExposure: sky.toneMappingExposure,
      cloudCoverage: sky.cloudCoverage,
      cloudDensity: sky.cloudDensity,
      weather: sky.weather,
      palette: sky.palette || resolved.sky,
      // Teinte du feuillage du thème courant, pas inventée par l'environnement.
      debrisTint: resolved.furniture.colors.leaf,
      leaves: resolved.leaves,
    });
  }

  return new World({
    composer,
    environment,
    elevation: field,
    ownsElevation,
    theme: resolved,
    // Le pays n'a le droit de teinter l'air que si l'application n'a pas
    // choisi sa propre palette : entre le pays et l'auteur, c'est l'auteur.
    skyFollowsRegion: !sky?.palette,
  });
}

/**
 * Le paysage monté. Une façade : ce qui a besoin d'aller plus loin passe par
 * `composer`, `bubble` ou `environment`, qui ne sont pas cachés.
 */
export class World {
  constructor({
    composer,
    environment,
    elevation,
    ownsElevation,
    theme = defaultTheme,
    skyFollowsRegion = true,
  }) {
    this.composer = composer;
    this._skyFollowsRegion = skyFollowsRegion;
    /** Matrice pour laquelle `_skyPalette` a été composée. */
    this._skyMatrix = undefined;
    this._skyPalette = null;
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

  /**
   * Position de scène au point `(lng, lat)`, sur la plate-forme de la
   * chaussée qui y passe — remblai et pont compris — ou sur le terrain nu
   * ailleurs. `heightAboveGround` a le même sens que pour
   * `bubble.toScenePosition`, dont c'est le pendant conscient de la route :
   * celui-là suit toujours le terrain, y compris sous un viaduc ou sur un
   * pont, puisqu'il ne connaît pas les chaussées.
   *
   * À un croisement en dénivelé, deux chaussées peuvent recouvrir le même
   * point en plan. `aheadLng`/`aheadLat` — un point à quelques mètres, dans
   * le sens du déplacement — départage en faveur de celle dont le tracé va
   * dans cette direction : l'autre est celle qu'on franchit, pas celle qu'on
   * suit. Sans eux, la plus proche l'emporte.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {number} [heightAboveGround]
   * @param {{aheadLng?: number, aheadLat?: number}} [options]
   * @returns {{x:number, y:number, z:number}}
   */
  roadPositionAt(lng, lat, heightAboveGround = 0, { aheadLng, aheadLat } = {}) {
    const bubble = this.composer.bubble;
    if (!bubble?.frame) return { x: 0, y: heightAboveGround, z: 0 };

    const here = bubble.frame.toLocal(lng, lat);
    let ahead = null;
    if (aheadLng != null && aheadLat != null) {
      const there = bubble.frame.toLocal(aheadLng, aheadLat);
      ahead = { x: there.x - here.x, z: there.z - here.z };
    }

    const deck = platformPositionAt(this.composer.roads, here.x, here.z, ahead);
    if (deck == null) return bubble.toScenePosition(lng, lat, heightAboveGround);
    return { x: here.x, y: deck + heightAboveGround, z: here.z };
  }

  /**
   * Point de l'axe de la chaussée rendue le plus proche d'une position — ce
   * qu'il faut à un mobile qui suit sa propre polyligne et doit malgré tout
   * rester sur le bitume. Voir `platformSnapAt` : les deux tracés ne coupent
   * pas les virages de la même façon.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {Object} [options]
   * @param {number} [options.aheadLng] Point visé, pour écarter la transversale
   *        d'un carrefour au profit de la chaussée qu'on suit.
   * @param {number} [options.aheadLat]
   * @param {number} [options.radius] Portée de la recherche, en mètres.
   * @returns {{lng:number, lat:number, distanceM:number}|null} `null` hors de
   *          portée de toute chaussée — au consommateur de garder son tracé.
   */
  roadSnapAt(lng, lat, { aheadLng, aheadLat, radius = ROAD_SNAP_RADIUS_M } = {}) {
    const bubble = this.composer.bubble;
    if (!bubble?.frame) return null;

    const here = bubble.frame.toLocal(lng, lat);
    let ahead = null;
    if (aheadLng != null && aheadLat != null) {
      const there = bubble.frame.toLocal(aheadLng, aheadLat);
      ahead = { x: there.x - here.x, z: there.z - here.z };
    }

    const hit = platformSnapAt(this.composer.roads, here.x, here.z, ahead, radius);
    if (!hit) return null;
    const at = bubble.frame.toLngLat(hit.x, hit.z);
    return { lng: at.lng, lat: at.lat, distanceM: hit.distance };
  }

  /**
   * Point du bord de la chaussée la plus proche, en unités de scène, avec
   * l'orientation de la route — de quoi poser un objet de l'application à côté
   * de la route, tourné vers elle. Voir `platformSideAt` pour `side` et
   * `offset`. L'altitude est celle de la plate-forme si le point y tombe
   * encore (remblai, pont), celle du terrain sinon.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {Object} [options]
   * @param {number} [options.side] `1` à droite du sens de marche, `-1` à
   *        gauche, `0` (défaut) du côté où se trouve le point demandé.
   * @param {number} [options.offset] Mètres au-delà du bord de la chaussée.
   * @param {number} [options.heightAboveGround]
   * @param {number} [options.aheadLng] Point visé : fixe le sens de marche.
   * @param {number} [options.aheadLat]
   * @param {number} [options.radius] Portée de la recherche, en mètres.
   * @returns {{x:number, y:number, z:number, tangent:{x:number, z:number},
   *            normal:{x:number, z:number}, halfWidth:number, profile:string,
   *            distanceM:number}|null} `normal` va de la route vers le point.
   *          `null` hors de portée de toute chaussée.
   */
  roadsideAt(
    lng,
    lat,
    { side = 0, offset = 0, heightAboveGround = 0, aheadLng, aheadLat, radius = ROAD_SNAP_RADIUS_M } = {}
  ) {
    const bubble = this.composer.bubble;
    if (!bubble?.frame) return null;

    const here = bubble.frame.toLocal(lng, lat);
    let ahead = null;
    if (aheadLng != null && aheadLat != null) {
      const there = bubble.frame.toLocal(aheadLng, aheadLat);
      ahead = { x: there.x - here.x, z: there.z - here.z };
    }

    const roads = this.composer.roads;
    const edge = platformSideAt(roads, here.x, here.z, { side, offset, ahead, radius });
    if (!edge) return null;
    const deck = platformPositionAt(roads, edge.x, edge.z, edge.tangent);
    const ground = deck ?? this.composer.groundElevationAt(edge.x, edge.z);
    return {
      x: edge.x,
      y: ground + heightAboveGround,
      z: edge.z,
      tangent: edge.tangent,
      normal: edge.normal,
      halfWidth: edge.halfWidth,
      profile: edge.profile,
      distanceM: edge.distance,
    };
  }

  /**
   * Tables de terrasse posées à moins de `radius` mètres de `(lng, lat)` —
   * restaurant, bar ou café —, de la plus proche à la plus lointaine. De quoi
   * attabler un personnage de l'application : chaque table vient avec ses
   * chaises (centre de l'assise) et la normale sortante de la façade qui la
   * porte. Positions de scène ; `[]` tant que le bâti n'a pas été construit
   * dans le repère courant.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {number} [radius]
   * @returns {Array<{x:number, y:number, z:number, top:number, distanceM:number,
   *          facing:{x:number, z:number}, kind:string,
   *          chairs:Array<{x:number, y:number, z:number}>}>}
   */
  terracesNear(lng, lat, radius = 40) {
    const buildings = this.composer.buildings;
    const frame = this.composer.bubble?.frame;
    if (!frame || !buildings?.terraces?.length || buildings._frame !== frame) return [];
    const here = frame.toLocal(lng, lat);
    const found = [];
    for (const table of buildings.terraces) {
      const distanceM = Math.hypot(table.x - here.x, table.z - here.z);
      if (distanceM <= radius) found.push({ ...table, distanceM });
    }
    return found.sort((p, q) => p.distanceM - q.distanceM);
  }

  /**
   * Points d'eau posés à moins de `radius` mètres de `(lng, lat)` — fontaines
   * (`fountain`, `fountainWallace`) et robinets de cimetière (`cemeteryTap`) —,
   * du plus proche au plus lointain : de quoi conduire un personnage de
   * l'application à son bord. `radiusM` est le rayon du bord, depuis le centre
   * (ils sont de révolution : aucun côté n'est « devant »). Positions de
   * scène ; `[]` tant que le mobilier n'a pas été construit dans le repère
   * courant.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {number} [radius]
   * @returns {Array<{x:number, y:number, z:number, kind:string,
   *          radiusM:number, distanceM:number}>}
   */
  fountainsNear(lng, lat, radius = 40) {
    const furniture = this.composer.furniture;
    const frame = this.composer.bubble?.frame;
    if (!frame || !furniture?.fountains?.length || furniture._frame !== frame) return [];
    const here = frame.toLocal(lng, lat);
    const found = [];
    for (const fountain of furniture.fountains) {
      const distanceM = Math.hypot(fountain.x - here.x, fountain.z - here.z);
      if (distanceM <= radius) found.push({ ...fountain, distanceM });
    }
    return found.sort((p, q) => p.distanceM - q.distanceM);
  }

  /**
   * Devanture de commerce la plus proche de `(lng, lat)`, à moins de `radius`
   * mètres : le point du pied de son mur le plus proche, la normale sortante
   * (vers la rue) et la direction du pan. De quoi adosser un objet de
   * l'application au mur d'une boutique. `null` sans devanture à portée ou
   * tant que le bâti n'a pas été construit dans le repère courant.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {number} [radius]
   * @returns {{x:number, y:number, z:number, facing:{x:number, z:number},
   *          tangent:{x:number, z:number}, length:number, along:number,
   *          kind:string|null, distanceM:number}|null} `along` situe le point
   *          sur le pan, depuis son début ; `length` est celle du pan.
   */
  shopfrontNear(lng, lat, radius = 40) {
    const buildings = this.composer.buildings;
    const frame = this.composer.bubble?.frame;
    if (!frame || !buildings?.shopfronts?.length || buildings._frame !== frame) return null;
    const here = frame.toLocal(lng, lat);
    let best = null;
    for (const front of buildings.shopfronts) {
      const dx = front.b.x - front.a.x;
      const dz = front.b.z - front.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const tx = dx / length;
      const tz = dz / length;
      const along = Math.min(length, Math.max(0, (here.x - front.a.x) * tx + (here.z - front.a.z) * tz));
      const x = front.a.x + tx * along;
      const z = front.a.z + tz * along;
      const distanceM = Math.hypot(here.x - x, here.z - z);
      if (distanceM > radius || (best && distanceM >= best.distanceM)) continue;
      best = { x, y: front.y, z, facing: front.facing, tangent: { x: tx, z: tz }, length, along, kind: front.kind, distanceM };
    }
    return best;
  }

  /** Couleur de fond à donner au renderer, ou `null` sans ciel. */
  get clearColor() {
    return this.environment ? this.environment.clearColor : null;
  }

  /** Déplace la bulle de terrain. @returns {Promise<boolean>} vrai si elle a bougé. */
  setCenter(lng, lat) {
    return this.composer.setCenter(lng, lat);
  }

  /**
   * Branche les tuiles vectorielles d'un monde monté sans elles — typiquement
   * pour montrer le ciel avant que leur source soit connue. Sans effet si une
   * source est déjà branchée. Le prochain `refresh` doit être forcé.
   *
   * @param {{tiles: string[], maxZoom?: number}} vector
   * @returns {boolean} vrai si la source a été branchée.
   */
  setVector(vector) {
    return this.composer.setVectorConfig(vector);
  }

  /**
   * Impose une région au décor, ou rend la main à la géographie (`null`). Voir
   * `WorldComposer.setRegion` : le décor cesse alors de suivre le lieu, ce qui
   * est le seul moyen de comparer deux pays sur le même terrain. Le prochain
   * `refresh` doit être forcé.
   *
   * @param {string|null} id Un identifiant de `REGIONS`.
   * @returns {boolean} vrai si l'intention a changé.
   */
  setRegion(id) {
    return this.composer.setRegion(id);
  }

  /**
   * Remplace un seul mot de la région en vigueur, ou la rend entière
   * (`null`). Voir `WorldComposer.setRegionWord`. Le prochain `refresh` doit
   * être forcé.
   *
   * @param {string|null} field Un champ de `VOCABULARIES` (`matrix`, `stone`…).
   * @param {string} [value] Un mot de ce champ.
   * @returns {boolean} vrai si l'intention a changé.
   */
  setRegionWord(field, value) {
    return this.composer.setRegionWord(field, value);
  }

  /** Active les mesures CPU par couche ; le rendu GPU reste à mesurer par le renderer. */
  setProfiling(enabled = true) { this.composer.metrics.enabled = enabled; }

  get generationStats() { return this.composer.metrics.snapshot(); }

  resetGenerationStats() { this.composer.metrics.reset(); }

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
    this.environment?.advance(delta, at, (x, z) => this.composer.groundElevationAt(x, z));
  }

  /**
   * Déclenche la traversée d'une bête devant l'observateur.
   *
   * Le seul geste du moteur qui ne soit pas une fonction du lieu : c'est un
   * événement que l'application choisit, pas un décor qu'elle retrouvera au
   * passage suivant. Voir `WorldComposer.crossFauna` pour les réglages.
   *
   * @param {Object} options `{ kind, at, forward, distanceM, side, spanM, scale }`.
   * @returns {Object|null} La bête lancée, ou `null`.
   */
  crossFauna(options) {
    return this.composer.crossFauna(options);
  }

  /**
   * Range un groupe de spectateurs qui encouragent au bord de la route la plus
   * proche de `(lng, lat)`, face à la chaussée. Un événement, comme
   * `crossFauna` : il s'oublie une fois l'observateur passé au large, sans
   * qu'il faille le retirer. Voir `WorldComposer.cheer`.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {Object} [options]
   * @param {number} [options.count] Spectateurs, 24 au plus.
   * @param {number} [options.side] `1` à droite du sens de marche, `-1` à
   *        gauche, `0` (défaut) des deux côtés.
   * @param {number} [options.spreadM] Longueur de route occupée, en mètres.
   * @param {number} [options.aheadLng] Point visé : fixe le sens de marche.
   * @param {number} [options.aheadLat]
   * @returns {Object|null} Le groupe (`composer.spectators.cancel` pour
   *          l'interrompre), ou `null` sans chaussée à portée.
   */
  cheer(lng, lat, { aheadLng, aheadLat, ...options } = {}) {
    const frame = this.composer.bubble?.frame;
    if (!frame) return null;
    const at = frame.toLocal(lng, lat);
    let ahead = null;
    if (aheadLng != null && aheadLat != null) {
      const there = frame.toLocal(aheadLng, aheadLat);
      ahead = { x: there.x - at.x, z: there.z - at.z };
    }
    return this.composer.cheer({ ...options, at, ahead });
  }

  /**
   * Chaussée et intrados de la voûte au point de scène `(x, z)`, ou `null`
   * hors de tout tunnel ou passage couvert. Voir `tunnelAt`.
   * @returns {{floor:number, roof:number, kind:string}|null}
   */
  tunnelAt(x, z) {
    return tunnelAt(this.composer.roads?.roadSegments, x, z);
  }

  /**
   * Garde le sujet visible : les arbres entre `from` (la caméra) et `to`
   * s'effacent par tramage. À rappeler à chaque image ; `null` désactive.
   * Voir `WorldComposer.setSightline`.
   */
  setSightline(from, to, options) {
    this.composer.setSightline(from, to, options);
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
   * @param {number} [options.dayForNight] Nuit américaine, de 0 à 1 — voir
   *        `SceneEnvironment.update`. Omise, la dernière valeur est reconduite.
   * @returns {{nightMix: number, wetness: number, weather: Object, clearColor: Object}|null}
   *        `null` sans ciel. Rendu pour que l'application applique la même
   *        mesure à ses propres objets (phares, véhicule, enseigne).
   */
  updateSky({ camera, date, lng, lat, shadowAt = null, palette = undefined, weather = undefined, dayForNight = undefined }) {
    const env = this.environment;
    if (!env) return null;
    env.followCamera(camera);
    // L'air n'a pas la même couleur partout : laiteux et bleu sur une côte
    // atlantique, chaud et poussiéreux en Castille, presque transparent en
    // altitude. C'est la couleur la plus déterminante du décor, donc elle suit
    // le pays — sauf si l'application en impose une, ici ou au montage.
    env.update({ palette: palette ?? this._regionSky(), date, lat, lng, weather, dayForNight });
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

  /**
   * Palette d'ambiance du pays courant, ou `undefined` — auquel cas
   * l'environnement garde celle qu'il a déjà (voir `skyPaletteFor`).
   *
   * Mémorisée par matrice : `updateSky` est appelée à chaque image, et composer
   * un objet par image pour une valeur qui change tous les deux kilomètres
   * serait du gaspillage pur.
   */
  _regionSky() {
    if (!this._skyFollowsRegion) return undefined;
    const matrix = this.composer.landscape?.region?.matrix ?? null;
    if (matrix !== this._skyMatrix) {
      this._skyMatrix = matrix;
      this._skyPalette = skyPaletteFor(matrix, this.theme.sky);
    }
    return this._skyPalette ?? undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.environment?.dispose();
    this.composer.dispose();
    if (this._ownsElevation) this.elevation.dispose();
  }
}

export { SKY_RADIUS, SKY_LAYER, SHADOW_LEAD_M, WORLD_ATTRIBUTION, FAUNA_CROSS_AHEAD_M };
