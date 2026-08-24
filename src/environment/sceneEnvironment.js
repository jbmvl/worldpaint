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
 */

import { skyParameters, lightingFor, sunlightColor } from './skyModel.js';
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
   * @param {number} [options.cloudCoverage] Couverture nuageuse, de 0 à 1. Rien
   *        ne la fait varier pour l'instant : une application qui connaît la
   *        météo du lieu la fixe au montage, la valeur par défaut tient lieu de
   *        ciel ordinaire.
   * @param {number} [options.cloudDensity] Opacité des nuages, de 0 à 1.
   * @param {SkyPalette} [options.palette] Palette d'ambiance de départ. Elle
   *        fixe la couleur de fond avant le premier `update()` — un montage
   *        sur une palette nocturne ne doit pas flasher en blanc.
   */
  constructor({
    THREE,
    Sky,
    scene,
    fogRadius = 2200,
    shadowMapSize = 2048,
    cloudCoverage = 0.42,
    cloudDensity = 0.55,
    palette = DEFAULT_SKY_PALETTE,
  }) {
    this.THREE = THREE;
    this.scene = scene;
    /** Dernière palette reçue : `update()` peut donc être appelé sans elle. */
    this.palette = palette;
    this.fogRadius = fogRadius;
    this.shadowMapSize = shadowMapSize;
    this.cloudCoverage = cloudCoverage;
    this.cloudDensity = cloudDensity;
    this._shadowCenter = { x: 0, y: 0, z: 0 };
    /** Part de nuit, de 0 (plein jour) à 1. Lue par tout l'éclairage artificiel. */
    this.nightMix = 0;

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
         uniform float uNightMix;`
      )
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `// Le modèle de Preetham n'a pas de nuit : sous l'horizon, il ne rend
         // pratiquement rien. On bascule donc sur la palette nocturne fournie,
         // qui est sombre sans être noire — une nuit noire ne se distingue plus
         // d'un rendu en panne.
         vec3 night = mix(uNightHorizon, uNightZenith, pow(clamp(direction.y, 0.0, 1.0), 0.45));
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

    this.fog = new THREE.FogExp2(new THREE.Color(palette.fog), 1.7 / fogRadius);
    scene.fog = this.fog;
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
   */
  update({ palette, date, lat, lng }) {
    if (palette) this.palette = palette;
    const fogColor = hexToLinear(this.palette.fog);
    const nightZenith = hexToLinear(this.palette.nightZenith);
    const nightHorizon = hexToLinear(this.palette.nightHorizon);

    this.fog.color.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.uniforms.uHorizonColor.value.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.uniforms.uNightZenith.value.setRGB(nightZenith[0], nightZenith[1], nightZenith[2]);
    this.uniforms.uNightHorizon.value.setRGB(nightHorizon[0], nightHorizon[1], nightHorizon[2]);

    const dir = sunDirection(date, lat, lng);
    this._sunDir = dir;

    // Le modèle lit la **position** du soleil, pas seulement sa direction : son
    // altitude sert au calcul du fondu diurne.
    this._sunPosition.set(dir.x, dir.y, dir.z).multiplyScalar(SUN_DISTANCE);
    this.uniforms.sunPosition.value.copy(this._sunPosition);

    const sky = skyParameters(dir.y);
    this.uniforms.turbidity.value = sky.turbidity;
    this.uniforms.rayleigh.value = sky.rayleigh;
    this.uniforms.mieCoefficient.value = sky.mieCoefficient;
    this.uniforms.mieDirectionalG.value = sky.mieDirectionalG;
    this.uniforms.cloudCoverage.value = this.cloudCoverage;
    this.uniforms.cloudDensity.value = this.cloudDensity;

    // Les nuages dérivent en fonction du temps **en jeu** — un replay accéléré
    // les fait filer —, mais compté depuis le montage de la scène. Une date
    // epoch passée telle quelle vaut 1,8 milliard : le shader travaille en
    // float32, où un tel nombre n'a plus aucune décimale utile, et le bruit des
    // nuages s'effondrait en une valeur constante.
    const seconds = date.getTime() / 1000;
    if (this._timeOrigin == null) this._timeOrigin = seconds;
    this.uniforms.time.value = seconds - this._timeOrigin;

    // Bascule vers la nuit : complète bien avant que le soleil soit très bas,
    // sinon le ciel resterait noir pendant tout le crépuscule.
    this.uniforms.uNightMix.value = smoothstep(0.06, -0.12, dir.y);
    // Publiée : c'est elle qui allume les fenêtres, les lampadaires et les feux
    // du vélo. Une seule mesure de la nuit pour toute la scène, sinon le ciel et
    // l'éclairage basculeraient à des moments différents.
    this.nightMix = this.uniforms.uNightMix.value;

    // Soleil rasant : l'ombre d'un arbre dépasse la boîte et se coupe net, ce
    // qui se voit bien plus que son absence. Sous l'horizon, il n'y a rien à
    // projeter du tout.
    this.sun.castShadow = dir.y > SHADOW_MIN_SUN_Y;

    const light = lightingFor(dir.y);
    const [r, g, b] = sunlightColor(light.warmth, light.night);
    this.sun.color.setRGB(r, g, b);
    this.sun.intensity = light.sun;
    this.ambient.intensity = light.ambient;

    this._placeSun();
  }

  /** Couleur de fond à donner au renderer (évite un flash noir au montage). */
  get clearColor() {
    return this.fog.color;
  }

  dispose() {
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
