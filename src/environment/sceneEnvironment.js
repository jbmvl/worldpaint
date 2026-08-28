/*
 * sceneEnvironment — ciel, soleil et brouillard de la bulle.
 * ----------------------------------------------------------
 * Le ciel suit le modèle de Preetham (« A Practical Analytic Model for
 * Daylight », SIGGRAPH 1999) : diffusion de Rayleigh et de Mie calculées pour
 * la direction regardée, disque solaire et nuages procéduraux compris. three le
 * livre — inutile d'ajouter une dépendance. La bibliothèque visée au départ,
 * `@takram/three-atmosphere`, exige React, `@react-three/fiber` et `drei` en
 * peer-dependencies : inutilisable dans une application Vue.
 *
 * Les nuages (`cloudScale`, `cloudSpeed`, `cloudCoverage`, `cloudDensity`,
 * `time`) sont ceux, natifs, du `Sky.js` de three — ce module se contente
 * d'écrire dans les uniforms qu'il expose déjà, sans shader maison. Ils
 * n'existent que depuis three 0.183.0 : c'est pourquoi `peerDependencies.three`
 * l'exige au minimum dans `package.json`. Une application qui épingle une
 * version antérieure verra `this.uniforms.cloudScale` valoir `undefined` ici.
 *
 * Un dégradé peint à la main ne reproduit ni l'assombrissement du zénith, ni le
 * halo qui enfle autour d'un soleil rasant, ni le rougissement de l'horizon au
 * couchant — trois choses qu'un modèle physique donne gratuitement, et qui font
 * la moitié de la lecture d'une heure de la journée.
 *
 * Le brouillard n'est pas un effet de style : c'est lui qui fond la bordure du
 * terrain dans l'horizon, sinon la bulle se voit. Sa couleur vient d'une
 * **palette fournie par l'application** — et le ciel est **forcé à converger
 * vers elle** au ras de l'horizon, sinon la ligne de contact entre le terrain
 * lointain et le ciel se verrait comme une couture.
 *
 * L'application donne l'heure et la palette ; elle seule sait d'où vient sa
 * direction artistique (un thème, un style de carte 2D, un réglage joueur). Ce
 * module ne connaît que la forme `{ fog, nightZenith, nightHorizon }`.
 *
 * La nuit porte une lune et des étoiles, mais ni l'une ni les autres ne visent
 * le réalisme : la lune est un disque posé à l'opposé du soleil (pas sa vraie
 * position, qui dépend de sa phase), et les étoiles un semis fixe tiré d'un
 * hachage de la direction regardée, sans notion de constellation ni de rotation
 * du ciel. Le but est un repère de nuit qui n'est pas un noir uni, pas un
 * planétarium.
 *
 * **Le brouillard converge vers la nuit**, exactement comme il converge déjà
 * vers la palette de jour à l'horizon : `update()` calcule `nightMix` avant la
 * couleur de brouillard et la mélange dedans, sinon la voûte bascule sur sa
 * palette nocturne pendant que le brouillard — donc le fond du renderer, et le
 * raccord d'horizon du ciel, qui lisent la même couleur — reste éclairé de
 * jour. C'est ce qui faisait un ciel nocturne dont l'horizon restait blanc.
 *
 * **La météo arrive par le même chemin que l'heure**, et pour la même raison :
 * c'est un état, pas une direction artistique, et l'application seule sait d'où
 * il vient (un relevé, une simulation, un curseur). Ce module l'applique — au
 * ciel, au soleil, au brouillard, à la chute d'eau — mais ne va jamais la
 * chercher : `src/` ne fait aucune requête réseau, et une dépendance à un
 * service météo serait exactement la frontière moteur/application que le
 * CONTRIBUTING interdit de franchir. Voir `weather.js` pour ce que chaque
 * coefficient fait.
 */

import { skyParameters, lightingFor, sunlightColor } from './skyModel.js';
import {
  resolveWeather,
  weatherLighting,
  weatherSkyParameters,
  castsShadow,
  fogScale,
  fogColorFor,
  windField,
} from './weather.js';
import { Precipitation } from './precipitation.js';
import { Debris } from './debris.js';
import {
  sunDirection,
  snapToShadowTexels,
  SHADOW_RADIUS_M,
  SHADOW_DISTANCE_M,
  SHADOW_MIN_SUN_Y,
} from './shadowFrame.js';
import { defaultTheme } from '../themes/default.js';

// Ré-exportés pour que la scène n'ait qu'un seul point d'entrée sur l'ambiance.
export { sunDirection, SHADOW_RADIUS_M, SHADOW_LEAD_M } from './shadowFrame.js';
export { DEFAULT_WEATHER, resolveWeather, PRECIPITATION_TYPES } from './weather.js';

/**
 * Rayon du dôme. Volontairement modeste : le dôme suit la caméra, il est donc
 * toujours à cette distance exacte, et un far plane serré côté application
 * garde la précision du depth buffer confortable sans recourir au depth
 * logarithmique, capricieux sur certains GPU mobiles.
 */
export const SKY_RADIUS = 8000;

/**
 * Le ciel de Preetham est physique : il ne connaît pas les palettes horaires de
 * l'application. On le force donc à rejoindre la couleur du brouillard au ras de
 * l'horizon, là où un désaccord se verrait, en laissant la physique gouverner
 * tout le reste de la voûte.
 *
 * La bande de raccord est étroite (~10° d'élévation) et le poids n'est pas
 * total : à 0,7, le halo du soleil couchant survit au mélange alors qu'il
 * serait effacé à 1.
 */
const HORIZON_BLEND = 0.7;
const HORIZON_BAND = 0.18;

/**
 * Palette d'ambiance : les trois seules couleurs que ce module attend d'une
 * application. Elle vit dans le thème (`theme.sky`) ; ce nom en est l'alias
 * public, pour qui monte un `SceneEnvironment` sans passer par `createWorld`.
 *
 * @typedef {{fog: string, nightZenith: string, nightHorizon: string}} SkyPalette
 */
export const DEFAULT_SKY_PALETTE = defaultTheme.sky;

/**
 * Échelle du bruit de nuages.
 *
 * La valeur par défaut de three (0,0002) produit un motif si vaste qu'il couvre
 * tout le ciel d'une seule valeur : le seuil de couverture ne mord alors nulle
 * part et **aucun nuage n'apparaît**. Le shader multiplie ce facteur par mille
 * avant d'échantillonner son bruit ; il faut donc que le produit couvre
 * plusieurs unités sur l'étendue de la voûte pour qu'un motif se forme.
 */
const CLOUD_SCALE = 0.0015;
/**
 * Vitesse de dérive. Volontairement lente, et surtout appliquée à un temps
 * **relatif** : le shader travaille en float32, et une date epoch (1,8 · 10⁹)
 * multipliée puis portée à mille détruisait toute la précision du bruit — les
 * nuages n'avaient alors plus de forme du tout.
 */
const CLOUD_SPEED = 0.00002;

/** Distance à laquelle on pose le soleil : `vSunfade` lit son altitude. */
const SUN_DISTANCE = 400000;

/** Transition douce, décroissante quand `edge0 > edge1`. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const mix = (a, b, t) => a + (b - a) * t;

/** #rrggbb → [r, g, b] linéaires approximés (sRGB → linéaire, gamma 2.2). */
function hexToLinear(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return srgb.map((c) => Math.pow(c, 2.2));
}

export class SceneEnvironment {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Function} options.Sky Classe `Sky` de three, injectée plutôt
   *        qu'importée : un import statique ferait entrer three dans le lot de
   *        la scène et casserait son chargement paresseux.
   * @param {Object} options.scene
   * @param {number} [options.fogRadius] Distance de disparition, en mètres.
   * @param {number} [options.shadowMapSize] Côté de la carte d'ombres, en texels.
   * @param {Object} [options.weather] État météo de départ (voir `weather.js`).
   *        Omis, c'est le temps ordinaire — celui qui reproduit exactement le
   *        rendu d'avant l'existence de ce réglage.
   * @param {number} [options.cloudCoverage] Couverture nuageuse, de 0 à 1.
   *        Raccourci historique sur `weather.cloudCover`, gardé parce qu'il est
   *        déjà documenté dans l'API publique. `weather` prime s'il donne la clé.
   * @param {number} [options.cloudDensity] Idem, sur `weather.cloudDensity`.
   * @param {SkyPalette} [options.palette] Palette d'ambiance de départ. Elle
   *        fixe la couleur de fond avant le premier `update()` — un montage
   *        sur une palette nocturne ne doit pas flasher en blanc.
   * @param {[number,number,number]} [options.debrisTint] Couleur linéaire des
   *        feuilles/graminées emportées par le vent. Par défaut la teinte de
   *        feuillage du thème livré — ce module ne choisit pas une couleur à
   *        lui, il reprend celle de la direction artistique.
   */
  constructor({
    THREE,
    Sky,
    scene,
    fogRadius = 2200,
    shadowMapSize = 2048,
    cloudCoverage = undefined,
    cloudDensity = undefined,
    weather = null,
    palette = DEFAULT_SKY_PALETTE,
    debrisTint = defaultTheme.furniture.colors.leaf,
  }) {
    this.THREE = THREE;
    this.scene = scene;
    /** Dernière palette reçue : `update()` peut donc être appelé sans elle. */
    this.palette = palette;
    this.fogRadius = fogRadius;
    this.shadowMapSize = shadowMapSize;
    /**
     * Densité de brouillard par temps ordinaire. La météo la **multiplie** :
     * garder la valeur de référence évite qu'une averse qui va et vient
     * n'épaississe l'air un peu plus à chaque passage.
     */
    this.baseFogDensity = 1.7 / fogRadius;
    /** @type {Object} état météo résolu et gelé. Voir `weather.js`. */
    this.weather = resolveWeather({
      cloudCover: cloudCoverage,
      cloudDensity,
      ...(weather || {}),
    });
    this._shadowCenter = { x: 0, y: 0, z: 0 };
    /** Part de nuit, de 0 (plein jour) à 1. Lue par tout l'éclairage artificiel. */
    this.nightMix = 0;
    /**
     * Ce que le vent fait au feuillage, publié pour que les couches végétales
     * l'appliquent — même raison que `nightMix` : une seule mesure, donc pas
     * d'herbe qui se couche pendant que les arbres sont au calme.
     * @type {{amplitude:number, speed:number}}
     */
    this.wind = windField(this.weather);
    /** Part de sol mouillé, de 0 à 1. Lue par le terrain, la chaussée, la voirie. */
    this.wetness = this.weather.wetness;

    this.sky = new Sky();
    this.sky.name = 'sky-dome';
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.uniforms = this.sky.material.uniforms;
    this.uniforms.uHorizonColor = { value: new THREE.Color(palette.fog) };
    this.uniforms.uHorizonBlend = { value: HORIZON_BLEND };
    this.uniforms.uNightZenith = { value: new THREE.Color(palette.nightZenith) };
    this.uniforms.uNightHorizon = { value: new THREE.Color(palette.nightHorizon) };
    this.uniforms.uNightMix = { value: 0 };
    // À l'opposé du soleil : pas la vraie position de la lune (dont les
    // phases ne dépendent pas que de l'heure), mais elle se lève quand le
    // soleil se couche et inversement, ce qui suffit à ce qu'on lui demande.
    this.uniforms.uMoonDirection = { value: new THREE.Vector3(0, 1, 0) };
    this.uniforms.cloudScale.value = CLOUD_SCALE;
    this.uniforms.cloudSpeed.value = CLOUD_SPEED;
    this._sunPosition = new THREE.Vector3(0, 1, 0);
    /** Origine du temps des nuages : voir `CLOUD_SPEED`. */
    this._timeOrigin = null;

    // Greffe du raccord d'horizon, juste avant l'écriture du fragment — donc
    // avant le tone mapping, que la couleur du brouillard traverse elle aussi
    // en arrivant par le terrain. Les deux subissent la même courbe et se
    // rejoignent donc vraiment, et pas seulement sur le papier.
    const skyMaterial = this.sky.material;
    skyMaterial.fragmentShader = skyMaterial.fragmentShader
      .replace(
        'varying vec3 vWorldPosition;',
        `varying vec3 vWorldPosition;
         uniform vec3 uHorizonColor;
         uniform float uHorizonBlend;
         uniform vec3 uNightZenith;
         uniform vec3 uNightHorizon;
         uniform float uNightMix;
         uniform vec3 uMoonDirection;`
      )
      .replace(
        'cloudColor *= vSunE * 0.00002;',
        `// Correctif du calcul d'origine (three <= 0.185.1, dernière publiée à
         // ce jour) : ce facteur écrase cloudColor à environ 1/100e de la
         // luminance de texColor — un nuage rend alors bleu marine sombre au
         // lieu de gris clair, et plus la couverture ou la densité montent,
         // plus l'écran vire à ce bleu au lieu de blanchir. C'est corrigé en
         // amont (mrdoob/three.js#33942, « More realistic clouds »), mais pas
         // encore publié dans aucune version au moment où ce fichier est
         // écrit — voir CHANGELOG.md pour la date à laquelle relever ce
         // correctif une fois que ça l'est. En attendant, on reconstruit la
         // même idée avec ce que ce shader calcule déjà : Lin et Fex sont
         // l'ambiance et l'atténuation du ciel lui-même, donc un nuage reste
         // dans la même gamme de luminance que le ciel qui l'entoure, plutôt
         // que dans une échelle inventée qui n'avait plus de rapport avec lui.
         cloudColor = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) + vSunE * Fex * 0.0088 * sunInfluence;`
      )
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `// Le modèle de Preetham n'a pas de nuit : sous l'horizon, il ne rend
         // pratiquement rien. On bascule donc sur la palette nocturne fournie,
         // qui est sombre sans être noire — une nuit noire ne se distingue plus
         // d'un rendu en panne.
         vec3 night = mix(uNightHorizon, uNightZenith, pow(clamp(direction.y, 0.0, 1.0), 0.45));

         // Lune : un disque doux à l'opposé du soleil, sans souci de phase ou
         // de position réelle — un repère de nuit, pas un almanach.
         float moonDot = dot(direction, normalize(uMoonDirection));
         float moonDisc = smoothstep(0.9994, 0.9998, moonDot);
         float moonGlow = pow(clamp(moonDot, 0.0, 1.0), 300.0) * 0.6;
         night += vec3(0.85, 0.9, 1.0) * (moonDisc + moonGlow) * 2.2;

         // Étoiles : un semis fixe tiré du hachage de cloud noise déjà présent
         // dans ce shader, pas de tampon de points à monter pour un détail qui
         // ne sert qu'à casser le noir uni du zénith. Éteintes sous l'horizon
         // et tout près de lui — l'atmosphère les noierait de toute façon —,
         // et voilées à proportion du ciel couvert : approximatif (aucune
         // notion d'endroit du ciel réellement caché par un nuage), mais une
         // nuit dégagée et une nuit couverte doivent se distinguer même sans
         // lune.
         float starCell = hash(floor(direction.xz * 380.0 + direction.y * 190.0));
         float starTwinkle = 0.6 + 0.4 * sin(time * 4.0 + starCell * 62.0);
         float starPresence = step(0.9935, starCell) * smoothstep(0.05, 0.35, direction.y);
         float starVeil = 1.0 - cloudCoverage * cloudDensity * 0.85;
         night += vec3(starPresence * starTwinkle * starVeil);

         texColor = mix( texColor, night, uNightMix );

         // Raccord au brouillard, appliqué en dernier : de jour comme de nuit,
         // c'est lui qui garantit que l'horizon et le terrain lointain se
         // rejoignent au lieu de se découper l'un sur l'autre.
         float horizonWeight = uHorizonBlend * (1.0 - smoothstep(0.0, ${HORIZON_BAND.toFixed(2)}, direction.y));
         texColor = mix( texColor, uHorizonColor, horizonWeight );
         gl_FragColor = vec4( texColor, 1.0 );`
      );
    skyMaterial.needsUpdate = true;

    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_RADIUS_M;
    shadowCamera.right = SHADOW_RADIUS_M;
    shadowCamera.top = SHADOW_RADIUS_M;
    shadowCamera.bottom = -SHADOW_RADIUS_M;
    shadowCamera.near = 10;
    // La boîte doit contenir la lumière **et** tout le relief sous elle : en
    // montagne, le terrain de la boîte peut varier de plusieurs centaines de
    // mètres. La profondeur d'une caméra orthographique étant linéaire, une
    // marge large ne coûte pas de précision.
    shadowCamera.far = SHADOW_DISTANCE_M * 2;
    shadowCamera.updateProjectionMatrix();

    // Le terrain a des mailles de 18 m : un biais constant seul laisserait des
    // rayures sur les pentes. Le biais porté par la normale décolle l'échantillon
    // de la surface, ce qui traite les grandes faces obliques sans détacher les
    // ombres de contact des petits objets.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;

    scene.add(this.sun);
    scene.add(this.sun.target);

    // Ambiance hémisphérique généreuse plutôt qu'un second soleil dur : c'est
    // elle qui porte le ciel bleu réfléchi par le sol et le rebond chaud du
    // terrain, deux choses qu'une seule directionnelle ne sait pas donner.
    this.ambient = new THREE.HemisphereLight(0xcfe4ff, 0x4a4433, 1.1);
    scene.add(this.ambient);

    this.fog = new THREE.FogExp2(new THREE.Color(palette.fog), this.baseFogDensity);
    scene.fog = this.fog;

    /**
     * La chute d'eau. Montée même sans précipitation : ses tampons sont alloués
     * une fois pour toutes et ne coûtent rien tant qu'aucune goutte n'est tirée,
     * alors que la monter au premier orage ferait une saccade au moment précis
     * où l'on regarde le ciel.
     */
    this.precipitation = new Precipitation({ THREE, scene });
    this.precipitation.setWeather(this.weather);

    /**
     * Feuilles et graminées portées par le vent. Même raison de la monter
     * tout de suite que la pluie : rien n'est alloué au moment où le vent se
     * lève.
     */
    this._debrisBaseTint = debrisTint;
    this.debris = new Debris({ THREE, scene, tint: debrisTint });
    this.debris.setWeather(this.weather);
  }

  /**
   * Change le temps qu'il fait. Idempotent, et sans effet de bord sur la
   * palette : la météo module ce que la direction artistique a décidé, elle ne
   * le remplace jamais.
   *
   * @param {Object|null} weather Clés à substituer au temps ordinaire.
   */
  setWeather(weather) {
    this.weather = resolveWeather(weather);
    this.wind = windField(this.weather);
    this.wetness = this.weather.wetness;
    this.precipitation.setWeather(this.weather);
    this.debris.setWeather(this.weather);
  }

  /**
   * Fait tomber la pluie et recentre sa boîte. À appeler une fois par image.
   * Séparé d'`update()` parce que la chute avance en temps réel écoulé, quand
   * l'heure du ciel peut, elle, être simulée, figée ou accélérée.
   *
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,y:number,z:number}} at Position de l'observateur.
   */
  advance(delta, at) {
    this.precipitation.advance(delta);
    if (at) this.precipitation.follow(at);
    this.debris.advance(delta);
    if (at) this.debris.follow(at);
  }

  /** Garde le dôme centré sur la caméra : il ne doit jamais être « atteint ». */
  followCamera(camera) {
    this.sky.position.copy(camera.position);
  }

  /**
   * Recentre la boîte d'ombres sur un point, aligné sur la grille de texels.
   * @param {{x:number,y:number,z:number}} point Généralement devant l'observateur.
   */
  followShadow(point) {
    this._shadowCenter = snapToShadowTexels(
      point,
      this._sunDir || { x: 0, y: 1, z: 0 },
      SHADOW_RADIUS_M,
      this.shadowMapSize
    );
    this._placeSun();
  }

  /**
   * Pose la lumière au-dessus du centre d'ombres, dans la direction du soleil.
   * Une lumière directionnelle n'a pas de position au sens physique : seule
   * compte la direction position → cible. La position sert uniquement à placer
   * la caméra d'ombres, qui, elle, doit rester collée à ce qu'on regarde.
   */
  _placeSun() {
    const dir = this._sunDir;
    if (!dir) return;
    const c = this._shadowCenter;
    this.sun.position.set(
      c.x + dir.x * SHADOW_DISTANCE_M,
      c.y + Math.max(dir.y, 0.05) * SHADOW_DISTANCE_M,
      c.z + dir.z * SHADOW_DISTANCE_M
    );
    this.sun.target.position.set(c.x, c.y, c.z);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Applique l'ambiance : palette de l'application + soleil réel.
   *
   * @param {Object} options
   * @param {SkyPalette} [options.palette] Palette d'ambiance. Omise, la
   *        dernière reçue est reconduite : une application dont la DA ne change
   *        pas n'a rien à repasser à chaque image.
   * @param {Date}   options.date Heure à simuler.
   * @param {number} options.lat
   * @param {number} options.lng
   * @param {Object} [options.weather] Change le temps qu'il fait en vol. Omis,
   *        le dernier reçu est reconduit — une application dont la météo ne
   *        bouge pas n'a rien à repasser à chaque image.
   */
  update({ palette, date, lat, lng, weather = undefined }) {
    if (palette) this.palette = palette;
    if (weather !== undefined) this.setWeather(weather);

    const dir = sunDirection(date, lat, lng);
    this._sunDir = dir;

    // Calculée avant la couleur de brouillard, précisément parce qu'elle doit
    // la corriger : sans quoi la voûte bascule sur sa palette nocturne pendant
    // que l'horizon — brouillard, fond du renderer, raccord du ciel, qui
    // lisent tous la même couleur — reste éclairé de jour. Bien avant que le
    // soleil soit très bas, sinon le ciel resterait noir pendant tout le
    // crépuscule.
    const nightMix = smoothstep(0.06, -0.12, dir.y);
    this.nightMix = nightMix;
    this.uniforms.uNightMix.value = nightMix;
    // À l'opposé du soleil — voir l'en-tête du fichier sur ce que « lune »
    // veut dire ici.
    this.uniforms.uMoonDirection.value.set(-dir.x, -dir.y, -dir.z);

    // La palette dit de quelle couleur est l'air de ce monde, la météo à quel
    // point il est gris, et `nightMix` s'il fait encore jour. Le brouillard, le
    // fond du renderer et le raccord d'horizon du ciel lisent tous les trois
    // **cette** couleur corrigée : elle ne peut donc pas diverger d'une surface
    // à l'autre.
    const nightZenith = hexToLinear(this.palette.nightZenith);
    const nightHorizon = hexToLinear(this.palette.nightHorizon);
    const dayFogColor = fogColorFor(hexToLinear(this.palette.fog), this.weather);
    // C'est nightHorizon, pas nightZenith, qui doit s'y rejoindre : le
    // brouillard occupe la bande basse du ciel, là où la voûte nocturne
    // converge elle-même vers sa couleur d'horizon (voir le raccord plus bas).
    const fogColor = [
      mix(dayFogColor[0], nightHorizon[0], nightMix),
      mix(dayFogColor[1], nightHorizon[1], nightMix),
      mix(dayFogColor[2], nightHorizon[2], nightMix),
    ];

    this.fog.color.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.fog.density = this.baseFogDensity * fogScale(this.weather);
    this.uniforms.uHorizonColor.value.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.uniforms.uNightZenith.value.setRGB(nightZenith[0], nightZenith[1], nightZenith[2]);
    this.uniforms.uNightHorizon.value.setRGB(nightHorizon[0], nightHorizon[1], nightHorizon[2]);

    // Le modèle lit la **position** du soleil, pas seulement sa direction : son
    // altitude sert au calcul du fondu diurne.
    this._sunPosition.set(dir.x, dir.y, dir.z).multiplyScalar(SUN_DISTANCE);
    this.uniforms.sunPosition.value.copy(this._sunPosition);

    const sky = weatherSkyParameters(skyParameters(dir.y), this.weather);
    this.uniforms.turbidity.value = sky.turbidity;
    this.uniforms.rayleigh.value = sky.rayleigh;
    this.uniforms.mieCoefficient.value = sky.mieCoefficient;
    this.uniforms.mieDirectionalG.value = sky.mieDirectionalG;
    this.uniforms.cloudCoverage.value = this.weather.cloudCover;
    this.uniforms.cloudDensity.value = this.weather.cloudDensity;

    // Les nuages dérivent en fonction du temps **en jeu** — un replay accéléré
    // les fait filer —, mais compté depuis le montage de la scène. Une date
    // epoch passée telle quelle vaut 1,8 milliard : le shader travaille en
    // float32, où un tel nombre n'a plus aucune décimale utile, et le bruit des
    // nuages s'effondrait en une valeur constante.
    const seconds = date.getTime() / 1000;
    if (this._timeOrigin == null) this._timeOrigin = seconds;
    this.uniforms.time.value = seconds - this._timeOrigin;

    // `nightMix` (calculé plus haut, avant le brouillard) est publiée : c'est
    // elle qui allume les fenêtres, les lampadaires et les feux du vélo. Une
    // seule mesure de la nuit pour toute la scène, sinon le ciel et
    // l'éclairage basculeraient à des moments différents.

    // Soleil rasant : l'ombre d'un arbre dépasse la boîte et se coupe net, ce
    // qui se voit bien plus que son absence. Sous l'horizon, il n'y a rien à
    // projeter du tout. Sous un ciel entièrement bouché non plus : il n'y a
    // plus de disque solaire pour dessiner un contour net.
    this.sun.castShadow = dir.y > SHADOW_MIN_SUN_Y && castsShadow(this.weather);

    const light = weatherLighting(lightingFor(dir.y), this.weather);
    const [r, g, b] = sunlightColor(light.warmth, light.night);
    this.sun.color.setRGB(r, g, b);
    this.sun.intensity = light.sun;
    this.ambient.intensity = light.ambient;
    // L'ombre s'efface **en opacité** avant de s'éteindre en tout ou rien : sans
    // ça, le passage d'un nuage ferait disparaître d'un coup toutes les ombres
    // de la scène. `shadow.intensity` existe depuis three r165 ; on ne s'y fie
    // pas aveuglément, le `peerDependency` n'en garantit pas le détail.
    if (this.sun.shadow && 'intensity' in this.sun.shadow) {
      this.sun.shadow.intensity = light.shadow;
    }

    // La pluie prend la couleur de la lumière qui la traverse : grise sous
    // l'orage, presque éteinte de nuit. Le brouillard est la meilleure mesure
    // disponible de cette lumière de jour — c'est déjà lui qui donne le fond de
    // l'image — mais il ne sait rien de la nuit : la palette de brouillard ne
    // s'assombrit pas au coucher, c'est le ciel qui bascule sur sa palette
    // nocturne. Sans le second facteur, une averse de minuit tombait en blanc
    // vif sur une scène noire.
    const glow = 1 - this.nightMix * 0.72;
    this.precipitation.setTint({
      r: Math.min(1, fogColor[0] + 0.18) * glow,
      g: Math.min(1, fogColor[1] + 0.18) * glow,
      b: Math.min(1, fogColor[2] + 0.2) * glow,
    });

    // Même assombrissement nocturne, mais sans le rapprochement vers la
    // couleur du brouillard : une feuille n'est pas de l'eau, sa teinte reste
    // celle du feuillage du thème, seulement plus sombre la nuit.
    this.debris.setTint({
      r: this._debrisBaseTint[0] * glow,
      g: this._debrisBaseTint[1] * glow,
      b: this._debrisBaseTint[2] * glow,
    });

    this._placeSun();
  }

  /** Couleur de fond à donner au renderer (évite un flash noir au montage). */
  get clearColor() {
    return this.fog.color;
  }

  dispose() {
    this.precipitation.dispose();
    this.debris.dispose();
    this.scene.remove(this.sky);
    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    this.scene.remove(this.ambient);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sun.dispose?.();
    this.ambient.dispose?.();
    this.scene.fog = null;
  }
}
