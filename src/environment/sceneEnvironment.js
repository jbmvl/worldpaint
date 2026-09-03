/*
 * sceneEnvironment — ciel, soleil et brouillard de la bulle. Le ciel suit le
 * modèle de Preetham (SIGGRAPH 1999), livré par three : diffusion de Rayleigh
 * et de Mie pour la direction regardée, disque solaire et nuages procéduraux
 * compris — un dégradé peint à la main ne reproduit ni l'assombrissement du
 * zénith, ni le halo au soleil rasant, ni le rougissement au couchant.
 * Les nuages sont ceux, natifs, du `Sky.js` de three (uniforms écrits, pas de
 * shader maison), disponibles depuis three 0.183.0.
 *
 * Le brouillard fond la bordure du terrain dans l'horizon (sinon la bulle se
 * voit), coloré par une palette fournie par l'application ; le ciel est forcé
 * à converger vers cette même couleur au ras de l'horizon, sinon la couture
 * se verrait. Cette couleur est celle de l'air à l'horizontale ; `aerialFog.js`
 * en dérive celle du haut de la voûte et celle de l'axe du soleil.
 *
 * L'application donne l'heure et la palette (forme `{ fog, nightZenith,
 * nightHorizon }`) ; elle seule sait d'où vient sa direction artistique.
 *
 * La nuit porte une lune (croissant stylisé, pas une vraie phase), des
 * étoiles (semis fixe de points) et une étoile filante occasionnelle — aucun
 * réalisme visé, juste un repère de nuit qui n'est ni un noir uni ni un
 * planétarium. Le hachage des étoiles se fait dans la projection
 * équirectangulaire `uv` (pas `direction.xz`, qui s'effondre près du zénith).
 * Chaque étoile est un point rond, pas une cellule entière allumée par
 * seuil ; l'étoile filante s'amincit vers la queue plutôt que de garder une
 * largeur uniforme.
 *
 * `update()` calcule `nightMix` avant la couleur de brouillard et la mélange
 * dedans, pour que la voûte et l'horizon basculent ensemble.
 *
 * La météo arrive par le même chemin que l'heure : un état, pas une direction
 * artistique. Ce module l'applique (ciel, soleil, brouillard, chute d'eau)
 * sans jamais aller la chercher — voir `weather.js`.
 */

import { skyParameters, lightingFor, sunlightColor } from './skyModel.js';
import {
  resolveWeather,
  weatherLighting,
  weatherSkyParameters,
  castsShadow,
  fogScale,
  fogColorFor,
  overcastOf,
  windField,
} from './weather.js';
import { AerialFog, aerialSkyColor, aerialSunColor, sunTintAmount } from './aerialFog.js';
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

/** Rayon du dôme (le dôme suit la caméra, donc toujours à cette distance exacte). */
export const SKY_RADIUS = 8000;

/**
 * Le ciel de Preetham est forcé à rejoindre la couleur du brouillard au ras
 * de l'horizon (bande étroite, ~10° d'élévation, poids non total à 0,7 pour
 * laisser survivre le halo du soleil couchant).
 */
const HORIZON_BLEND = 0.7;
const HORIZON_BAND = 0.18;

/**
 * Palette d'ambiance : les trois seules couleurs que ce module attend d'une
 * application (`theme.sky`, alias public pour qui monte un
 * `SceneEnvironment` sans `createWorld`).
 *
 * @typedef {{fog: string, nightZenith: string, nightHorizon: string}} SkyPalette
 */
export const DEFAULT_SKY_PALETTE = defaultTheme.sky;

/** Échelle du bruit de nuages (la valeur par défaut de three, 0,0002, couvre tout le ciel d'une seule valeur : aucun nuage n'apparaît). */
const CLOUD_SCALE = 0.0015;
/** Vitesse de dérive, appliquée à un temps relatif (une date epoch brute détruirait la précision du bruit en float32). */
const CLOUD_SPEED = 0.00002;

/** Distance à laquelle on pose le soleil : `vSunfade` lit son altitude. */
const SUN_DISTANCE = 400000;

/** Transition douce, décroissante quand `edge0 > edge1`. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const mix = (a, b, t) => a + (b - a) * t;

/** Plancher de teinte de la pluie, linéaire — 45 % en sRGB, sinon elle se confondait avec une chaussée mouillée sous ciel bouché. */
const RAIN_GREY_LINEAR = [0.1703, 0.1703, 0.1703];

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
   *        Raccourci historique sur `weather.cloudCover` ; `weather` prime s'il donne la clé.
   * @param {number} [options.cloudDensity] Idem, sur `weather.cloudDensity`.
   * @param {SkyPalette} [options.palette] Palette d'ambiance de départ (fixe
   *        la couleur de fond avant le premier `update()`).
   * @param {[number,number,number]} [options.debrisTint] Couleur linéaire des
   *        feuilles/graminées emportées par le vent, par défaut la teinte de
   *        feuillage du thème (éclaircie avant usage, voir plus bas).
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
    /** Densité de brouillard par temps ordinaire ; la météo la multiplie plutôt que la remplacer. */
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
    /** Ce que le vent fait au feuillage, publié pour les couches végétales — même raison que `nightMix`. @type {{amplitude:number, speed:number}} */
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
    // À l'opposé du soleil (pas la vraie position, mais elle se lève quand il se couche).
    this.uniforms.uMoonDirection = { value: new THREE.Vector3(0, 1, 0) };
    this.uniforms.cloudScale.value = CLOUD_SCALE;
    this.uniforms.cloudSpeed.value = CLOUD_SPEED;
    this._sunPosition = new THREE.Vector3(0, 1, 0);
    /** Origine du temps des nuages : voir `CLOUD_SPEED`. */
    this._timeOrigin = null;

    // Greffe du raccord d'horizon, avant l'écriture du fragment (avant le tone
    // mapping, que la couleur de brouillard traverse aussi en arrivant du terrain).
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
        `// Correctif du calcul d'origine (three <= 0.185.1) : ce facteur
         // écrasait cloudColor à ~1/100e de la luminance de texColor (nuage
         // bleu marine sombre au lieu de gris clair). Corrigé en amont
         // (mrdoob/three.js#33942) mais pas encore publié — voir CHANGELOG.md.
         // On reconstruit avec Lin/Fex (ambiance et atténuation du ciel déjà
         // calculées), pour qu'un nuage reste dans la gamme de luminance du ciel qui l'entoure.
         cloudColor = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) + vSunE * Fex * 0.0088 * sunInfluence;`
      )
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `// Le modèle de Preetham n'a pas de nuit : sous l'horizon, on bascule
         // sur la palette nocturne fournie, sombre sans être noire.
         vec3 night = mix(uNightHorizon, uNightZenith, pow(clamp(direction.y, 0.0, 1.0), 0.45));

         // Lune : un croissant (deux cercles en espace local, l'un mordant
         // l'autre), pas une vraie phase calculée depuis la date. right/up
         // forment un repère local perpendiculaire à la lune, où direction se
         // projette en 2D pour une SDF.
         vec3 moonDir = normalize(uMoonDirection);
         vec3 moonUpHint = abs(moonDir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
         vec3 moonRight = normalize(cross(moonUpHint, moonDir));
         vec3 moonUp = cross(moonDir, moonRight);
         vec3 moonRel = direction - moonDir * dot(direction, moonDir);
         // Rayon angulaire choisi pour se voir, sans viser le réalisme (le vrai fait ~0,25°).
         vec2 moonLocal = vec2(dot(moonRel, moonRight), dot(moonRel, moonUp)) / 0.02;
         float moonDisc = smoothstep(0.05, -0.05, length(moonLocal) - 1.0);
         // Le second cercle mord le premier pour ne laisser qu'un croissant (décalage fixe, pas une vraie phase).
         float moonBite = smoothstep(-0.05, 0.05, length(moonLocal - vec2(0.6, 0.15)) - 1.05);
         float moonShape = moonDisc * moonBite;
         // Halo large et faible sur l'astre entier, affaibli deux fois (trop lumineux au premier passage).
         float moonGlow = pow(clamp(dot(direction, moonDir), 0.0, 1.0), 60.0);
         night += vec3(0.85, 0.9, 1.0) * (moonShape * 0.9 + moonGlow * 0.18);

         // Étoiles : un point rond par cellule d'une grille fine, pas la
         // cellule entière allumée par seuil (ça dessinerait des carrés).
         // uv est la projection équirectangulaire de la direction regardée —
         // indispensable : direction.xz s'effondre vers zéro près du zénith et étire les cellules en traits.
         vec2 starUv = uv * vec2(900.0, 450.0);
         vec2 starId = floor(starUv);
         vec2 starLocal = fract(starUv) - 0.5;
         float starSeed = hash(starId);
         vec2 starJitter = vec2(hash(starId + 11.7), hash(starId + 53.9)) - 0.5;
         float starDist = length(starLocal - starJitter * 0.6);
         float starSize = mix(0.1, 0.2, fract(starSeed * 71.3));
         float starPoint = smoothstep(starSize, 0.0, starDist);
         float starPresence = step(0.9935, starSeed);
         float starVeil = 1.0 - cloudCoverage * cloudDensity * 0.85;
         float starMask = smoothstep(0.05, 0.35, direction.y);
         night += vec3(starPresence * starPoint * starVeil * starMask); // éclat fixe, pas de scintillement

         // Étoile filante : point net en tête, traînée qui s'amincit vers la
         // queue (pas une bande uniforme). Tirage par tranche de temps, sans réalité astronomique.
         float meteorSlot = floor(time / 9.0);
         float meteorRoll = hash(vec2(meteorSlot, 4.7));
         float meteorProgress = fract(time / 9.0);
         if (meteorRoll > 0.55 && meteorProgress < 0.22 && direction.y > 0.05) {
           vec2 meteorStart = vec2(hash(vec2(meteorSlot, 1.3)), hash(vec2(meteorSlot, 8.1)) * 0.5 + 0.05);
           vec2 meteorDir = normalize(vec2(hash(vec2(meteorSlot, 2.9)) - 0.5, hash(vec2(meteorSlot, 6.6)) * 0.3 - 0.15));
           float t = meteorProgress / 0.22;
           vec2 meteorHead = meteorStart + meteorDir * 0.12 * t;
           vec2 meteorTail = meteorHead - meteorDir * 0.045;
           vec2 seg = meteorHead - meteorTail;
           float segLen = max(length(seg), 1e-5);
           vec2 segDir = seg / segLen;
           float along = clamp(dot(uv - meteorTail, segDir), 0.0, segLen) / segLen;
           vec2 closest = meteorTail + segDir * along * segLen;
           float meteorDist = length(uv - closest);
           // Largeur et intensité décroissent vers la queue (along → 0).
           float meteorWidth = mix(0.0015, 0.006, along);
           float meteorStreak = smoothstep(meteorWidth, 0.0, meteorDist) * mix(0.15, 1.0, along);
           float meteorFade = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.6, t);
           night += vec3(1.0, 0.97, 0.92) * meteorStreak * meteorFade * 2.0;
         }

         texColor = mix( texColor, night, uNightMix );

         // Raccord au brouillard, appliqué en dernier (garantit que l'horizon et le terrain lointain se rejoignent).
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
    shadowCamera.far = SHADOW_DISTANCE_M * 2; // marge large, sans coût de précision (profondeur orthographique linéaire)
    shadowCamera.updateProjectionMatrix();

    // Biais porté par la normale : décolle l'échantillon des grandes faces obliques sans détacher les ombres de contact.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;

    scene.add(this.sun);
    scene.add(this.sun.target);

    // Ambiance hémisphérique généreuse plutôt qu'un second soleil dur (porte le ciel réfléchi et le rebond du terrain).
    this.ambient = new THREE.HemisphereLight(0xcfe4ff, 0x4a4433, 1.1);
    scene.add(this.ambient);

    this.fog = new THREE.FogExp2(new THREE.Color(palette.fog), this.baseFogDensity);
    scene.fog = this.fog;
    /** Monté avant la première image, pour que les matières du décor emportent ses uniforms. Voir `aerialFog.js`. */
    this.aerialFog = new AerialFog(THREE);
    this._publishAerialFog(
      fogColorFor(hexToLinear(palette.fog), this.weather),
      [1, 1, 1],
      { x: 0, y: 1, z: 0 },
      0
    );

    // Montée même sans précipitation : tampons alloués une fois pour toutes, pas de saccade au premier orage.
    this.precipitation = new Precipitation({ THREE, scene });
    this.precipitation.setWeather(this.weather);

    // Teinte de feuillage du thème mélangée à un gris moyen (45% sRGB) plutôt
    // que remplacée : la teinte brute se confondait avec le décor à la taille d'un point.
    const DEBRIS_GRAY_LINEAR = 0.1703;
    const lightenedDebrisTint = [
      mix(debrisTint[0], DEBRIS_GRAY_LINEAR, 0.75),
      mix(debrisTint[1], DEBRIS_GRAY_LINEAR, 0.75),
      mix(debrisTint[2], DEBRIS_GRAY_LINEAR, 0.75),
    ];
    this._debrisBaseTint = lightenedDebrisTint;
    this.debris = new Debris({ THREE, scene, tint: lightenedDebrisTint });
    this.debris.setWeather(this.weather);
  }

  /**
   * Change le temps qu'il fait. Sans effet de bord sur la palette : la météo
   * module ce que la direction artistique a décidé, elle ne le remplace jamais.
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
   * Fait tomber la pluie et recentre sa boîte. Séparé d'`update()` : la chute
   * avance en temps réel écoulé, l'heure du ciel peut être simulée ou figée.
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
   * @param {SkyPalette} [options.palette] Palette d'ambiance. Omise, la dernière reçue est reconduite.
   * @param {Date}   options.date Heure à simuler.
   * @param {number} options.lat
   * @param {number} options.lng
   * @param {Object} [options.weather] Change le temps qu'il fait en vol. Omis, le dernier reçu est reconduit.
   */
  update({ palette, date, lat, lng, weather = undefined }) {
    if (palette) this.palette = palette;
    if (weather !== undefined) this.setWeather(weather);

    const dir = sunDirection(date, lat, lng);
    this._sunDir = dir;

    // Calculée avant la couleur de brouillard, pour la corriger (sinon la
    // voûte bascule sur sa palette nocturne pendant que l'horizon reste
    // éclairé de jour). Bien avant que le soleil soit très bas, sinon le ciel resterait noir au crépuscule.
    const nightMix = smoothstep(0.06, -0.12, dir.y);
    this.nightMix = nightMix;
    this.uniforms.uNightMix.value = nightMix;
    this.uniforms.uMoonDirection.value.set(-dir.x, -dir.y, -dir.z);

    const nightZenith = hexToLinear(this.palette.nightZenith);
    const nightHorizon = hexToLinear(this.palette.nightHorizon);
    const dayFogColor = fogColorFor(hexToLinear(this.palette.fog), this.weather);
    // nightHorizon, pas nightZenith : le brouillard occupe la bande basse du ciel.
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

    // Le modèle lit la position du soleil, pas seulement sa direction.
    this._sunPosition.set(dir.x, dir.y, dir.z).multiplyScalar(SUN_DISTANCE);
    this.uniforms.sunPosition.value.copy(this._sunPosition);

    const sky = weatherSkyParameters(skyParameters(dir.y), this.weather);
    this.uniforms.turbidity.value = sky.turbidity;
    this.uniforms.rayleigh.value = sky.rayleigh;
    this.uniforms.mieCoefficient.value = sky.mieCoefficient;
    this.uniforms.mieDirectionalG.value = sky.mieDirectionalG;
    this.uniforms.cloudCoverage.value = this.weather.cloudCover;
    this.uniforms.cloudDensity.value = this.weather.cloudDensity;

    // Temps compté depuis le montage de la scène : une date epoch brute (1,8
    // milliard) détruirait la précision du bruit des nuages en float32.
    const seconds = date.getTime() / 1000;
    if (this._timeOrigin == null) this._timeOrigin = seconds;
    this.uniforms.time.value = seconds - this._timeOrigin;

    // Soleil rasant : l'ombre d'un arbre dépasserait la boîte et se coupe net.
    // Ciel entièrement bouché : plus de disque solaire pour un contour net.
    this.sun.castShadow = dir.y > SHADOW_MIN_SUN_Y && castsShadow(this.weather);

    const light = weatherLighting(lightingFor(dir.y), this.weather);
    const [r, g, b] = sunlightColor(light.warmth, light.night);
    this.sun.color.setRGB(r, g, b);
    this.sun.intensity = light.sun;
    this.ambient.intensity = light.ambient;

    // La perspective aérienne lit la couleur de jour, pas déjà mélangée à la
    // nuit : la part de nuit est appliquée ensuite, comme le fait la voûte.
    this._publishAerialFog(dayFogColor, [r, g, b], dir, nightMix);

    // L'ombre s'efface en opacité avant de s'éteindre en tout ou rien (sinon un nuage ferait tout disparaître d'un coup).
    if (this.sun.shadow && 'intensity' in this.sun.shadow) {
      this.sun.shadow.intensity = light.shadow;
    }

    // La pluie prend la couleur de la lumière qui la traverse, avec un second
    // facteur pour la nuit (le brouillard ne s'assombrit pas seul au coucher).
    // `RAIN_GREY_LINEAR` est un plancher, pas une teinte fixe.
    const glow = 1 - this.nightMix * 0.72;
    this.precipitation.setTint({
      r: Math.max(RAIN_GREY_LINEAR[0], Math.min(1, fogColor[0] + 0.18)) * glow,
      g: Math.max(RAIN_GREY_LINEAR[1], Math.min(1, fogColor[1] + 0.18)) * glow,
      b: Math.max(RAIN_GREY_LINEAR[2], Math.min(1, fogColor[2] + 0.2)) * glow,
    });

    // Même assombrissement nocturne, sans le rapprochement vers le brouillard (une feuille n'est pas de l'eau).
    this.debris.setTint({
      r: this._debrisBaseTint[0] * glow,
      g: this._debrisBaseTint[1] * glow,
      b: this._debrisBaseTint[2] * glow,
    });

    this._placeSun();
  }

  /**
   * Repasse à la perspective aérienne les trois couleurs qu'elle ne sait pas
   * dériver seule : l'air vers le haut, l'air dans l'axe du soleil, la part
   * de nuit. Vers le haut, la nuit vise `nightZenith`, pas `nightHorizon`
   * (déjà la couleur d'horizon du brouillard).
   *
   * @param {[number,number,number]} dayFog Couleur d'horizon de jour, linéaire.
   * @param {[number,number,number]} sunRgb Couleur de la lumière directe, linéaire.
   * @param {{x:number,y:number,z:number}} sunDir Direction du soleil.
   * @param {number} nightMix Part de nuit, de 0 à 1.
   */
  _publishAerialFog(dayFog, sunRgb, sunDir, nightMix) {
    const nightZenith = hexToLinear(this.palette.nightZenith);
    const sky = aerialSkyColor(dayFog);
    this.aerialFog.update({
      skyColor: [
        mix(sky[0], nightZenith[0], nightMix),
        mix(sky[1], nightZenith[1], nightMix),
        mix(sky[2], nightZenith[2], nightMix),
      ],
      sunColor: aerialSunColor(dayFog, sunRgb),
      sunDir,
      sunAmount: sunTintAmount(overcastOf(this.weather), nightMix),
    });
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
