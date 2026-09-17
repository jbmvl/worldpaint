/*
 * sceneEnvironment — ciel, soleil et brouillard de la bulle. Le ciel est le
 * nôtre (`skyDome.js`) : deux couleurs peintes et une rampe entre elles, pas
 * le modèle de Preetham qu'on suivait jusqu'ici. Le pourquoi de la bascule,
 * et ce qu'elle coûte, sont dans l'en-tête de `skyModel.js` ; ce module ne
 * fait que passer à la voûte ce que la palette et l'heure lui dictent.
 *
 * La classe `Sky` de three n'est donc plus attendue : `createWorld` accepte
 * encore `sky.Sky` pour ne casser personne, mais ne la lit plus.
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
  weatherSkyGradient,
  castsShadow,
  fogScale,
  fogColorFor,
  overcastOf,
  windField,
} from './weather.js';
import { AerialFog, aerialSkyColor, aerialSunColor, sunTintAmount } from './aerialFog.js';
import { SkyDome, SKY_RADIUS } from './skyDome.js';
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

// Le rayon du dôme appartient au dôme ; réexporté parce qu'une application
// cadre sa caméra lointaine dessus.
export { SKY_RADIUS };

/**
 * Palette d'ambiance : les couleurs que ce module attend d'une application
 * (`theme.sky`, alias public pour qui monte un `SceneEnvironment` sans
 * `createWorld`).
 *
 * `fog` et les deux couleurs de nuit sont obligatoires. `zenith` et `cloud`
 * sont apparues avec le ciel peint (`skyDome.js`) et restent facultatives :
 * sans elles, elles sont dérivées de `fog` — une palette d'application écrite
 * avant ce changement continue de marcher, avec un ciel plus terne.
 *
 * @typedef {{fog: string, zenith?: string, cloud?: string, nightZenith: string, nightHorizon: string}} SkyPalette
 */
export const DEFAULT_SKY_PALETTE = defaultTheme.sky;

/**
 * Palette d'ambiance d'un climat, ou `null` s'il n'en a pas de propre.
 *
 * `null` compte : `update({ palette: undefined })` garde la dernière palette
 * reçue, donc une application qui a choisi la sienne ne se la fait pas
 * remplacer par le climat. Une variante ne redit que ce qu'elle change.
 */
export function skyPaletteFor(climate, sky = DEFAULT_SKY_PALETTE) {
  if (!climate || !Array.isArray(sky?.variants)) return null;
  const variant = sky.variants.find((entry) => entry?.climates?.includes(climate));
  if (!variant) return null;
  return {
    fog: variant.fog ?? sky.fog,
    zenith: variant.zenith ?? sky.zenith,
    cloud: variant.cloud ?? sky.cloud,
    nightZenith: variant.nightZenith ?? sky.nightZenith,
    nightHorizon: variant.nightHorizon ?? sky.nightHorizon,
  };
}

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
     * Densité de brouillard par temps ordinaire ; la météo la multiplie plutôt
     * que la remplacer.
     *
     * Trois fois moins qu'avant (c'était 1,7 / rayon). Un brouillard qui délave
     * le lointain est ce qui donne sa profondeur à un décor continu ; il fait
     * l'inverse sur un décor en aplats, où il ramène toutes les couleurs vers
     * la même et efface la seule chose qui tienne le lointain, la silhouette.
     * Assez pour que la bordure de la bulle ne se voie pas, pas davantage.
     */
    this.baseFogDensity = 0.55 / fogRadius;
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

    this.skyDome = new SkyDome(THREE);
    /** Le maillage de la voûte, exposé pour qui veut le retrouver dans la scène. */
    this.sky = this.skyDome.mesh;
    this.uniforms = this.skyDome.uniforms;
    scene.add(this.sky);

    const dayFog = hexToLinear(palette.fog);
    this.uniforms.uFogColor.value.setRGB(...dayFog);
    this.uniforms.uHorizon.value.setRGB(...dayFog);
    this.uniforms.uZenith.value.setRGB(...this._zenithOf(palette));
    this.uniforms.uCloud.value.setRGB(...this._cloudOf(palette));
    this.uniforms.uNightZenith.value.setRGB(...hexToLinear(palette.nightZenith));
    this.uniforms.uNightHorizon.value.setRGB(...hexToLinear(palette.nightHorizon));

    /** Origine du temps des nuages : une date epoch brute (1,8 milliard) détruirait la précision du bruit en float32. */
    this._timeOrigin = null;

    // Intensité de montage seulement : `update()` la remplace par `lightingFor`.
    this.sun = new THREE.DirectionalLight(0xffffff, 0.58);
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

    // Ambiance hémisphérique plutôt qu'un second soleil dur : elle porte le
    // ciel réfléchi et le rebond du terrain.
    //
    // Sa couleur haute est **franchement bleue**, et c'est tout ce qui colore
    // une ombre : sans spéculaire ni occlusion, une zone à l'ombre ne reçoit
    // rien d'autre que cette lampe. Le gris-bleu pâle d'avant donnait une ombre
    // grise, c'est-à-dire la même couleur en moins clair — le défaut le plus
    // visible d'un décor en aplats. La couleur basse est remontée pour la même
    // raison : à 0x4a4433 le dessous des volumes tombait presque au noir.
    this.ambient = new THREE.HemisphereLight(0x9ec6ff, 0x7a6a52, 0.48);
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

    // Soleil rasant : l'ombre d'un arbre dépasserait la boîte et se coupe net.
    // Ciel entièrement bouché : plus de disque solaire pour un contour net.
    this.sun.castShadow = dir.y > SHADOW_MIN_SUN_Y && castsShadow(this.weather);

    // Calculé avant la voûte : c'est la même couleur qui éclaire le décor et
    // qui réchauffe la bande d'horizon, sans quoi le couchant ne serait pas
    // celui du soleil qui l'éclaire.
    const light = weatherLighting(lightingFor(dir.y), this.weather);
    const [r, g, b] = sunlightColor(light.warmth, light.night);
    this.sun.color.setRGB(r, g, b);
    this.sun.intensity = light.sun;
    this.ambient.intensity = light.ambient;

    // La voûte. `uHorizon` prend la couleur de **jour** : la nuit est
    // appliquée ensuite par le shader (`uNightMix`), comme pour le reste du
    // ciel. `uFogColor`, elle, est le raccord au brouillard réel, donc déjà
    // mélangée à la nuit.
    this.uniforms.uHorizon.value.setRGB(dayFogColor[0], dayFogColor[1], dayFogColor[2]);
    this.uniforms.uFogColor.value.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.uniforms.uZenith.value.setRGB(...this._zenithOf(this.palette));
    this.uniforms.uCloud.value.setRGB(...this._cloudOf(this.palette));
    this.uniforms.uNightZenith.value.setRGB(nightZenith[0], nightZenith[1], nightZenith[2]);
    this.uniforms.uNightHorizon.value.setRGB(nightHorizon[0], nightHorizon[1], nightHorizon[2]);
    this.uniforms.uSunColor.value.setRGB(r, g, b);
    this.uniforms.uSunDirection.value.set(dir.x, dir.y, dir.z);

    const gradient = weatherSkyGradient(skyParameters(dir.y), this.weather);
    this.uniforms.uCurve.value = gradient.curve;
    this.uniforms.uSunset.value = gradient.sunset;
    this.uniforms.uGlow.value = gradient.glow;
    this.uniforms.uGlowFocus.value = gradient.glowFocus;
    this.uniforms.uCloudCover.value = this.weather.cloudCover;
    this.uniforms.uCloudDensity.value = this.weather.cloudDensity;

    // Temps compté depuis le montage de la scène : une date epoch brute (1,8
    // milliard) détruirait la précision du bruit des nuages en float32.
    const seconds = date.getTime() / 1000;
    if (this._timeOrigin == null) this._timeOrigin = seconds;
    this.uniforms.uTime.value = seconds - this._timeOrigin;

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
    // Le même zénith que la voûte, quand la palette en donne un : le lointain
    // regardé vers le haut et le ciel qui le surplombe sont le même air, et
    // deux valeurs voisines mais distinctes y feraient une couture.
    const sky = this._zenithOf(this.palette);
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

  /**
   * Couleur du zénith de jour, en linéaire. La palette la donne (`sky.zenith`) ;
   * une palette d'application qui n'en a pas la voit dérivée de sa couleur
   * d'horizon, comme le faisait la perspective aérienne avant que le ciel soit
   * peint — un thème d'avant cette clé se comporte comme avant.
   *
   * @param {SkyPalette} palette
   * @returns {[number,number,number]}
   */
  _zenithOf(palette) {
    return palette.zenith ? hexToLinear(palette.zenith) : aerialSkyColor(hexToLinear(palette.fog));
  }

  /**
   * Couleur du corps des nuages, en linéaire. À défaut, la couleur d'horizon
   * éclaircie : un nuage n'est jamais plus sombre que l'air qui l'entoure au
   * ras du sol.
   *
   * @param {SkyPalette} palette
   * @returns {[number,number,number]}
   */
  _cloudOf(palette) {
    if (palette.cloud) return hexToLinear(palette.cloud);
    const fog = hexToLinear(palette.fog);
    return fog.map((c) => Math.min(1, c * 1.08));
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
    this.skyDome.dispose();
    this.sun.dispose?.();
    this.ambient.dispose?.();
    this.scene.fog = null;
  }
}
