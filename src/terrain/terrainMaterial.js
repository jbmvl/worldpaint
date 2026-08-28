/*
 * terrainMaterial — la matière du sol.
 * ------------------------------------
 * Le sol n'est pas photographié : il est **décrit**. `groundClassMap` rasterise
 * l'occupation du sol des tuiles vectorielles autour de l'observateur ; ce shader y
 * lit, en chaque point, la part d'herbe, de bois, de culture et de sol nu, et
 * compose la matière correspondante.
 *
 * Trois principes, et tout le reste en découle :
 *
 *   • **structure et couleur sont séparées**. Les textures procédurales ne
 *     portent que le grain — leur moyenne est calée à 0,5 à la construction,
 *     donc doublées elles valent 1 et ne déplacent aucune luminosité. La
 *     couleur vient des albédos, en espace linéaire. Employer une texture de
 *     grain comme albédo donnait un albédo moyen de 1, c'est-à-dire de la neige.
 *   • **le grain change d'échelle avec la distance**. De près, une période de
 *     quelques mètres ; au loin, une octave large. Une seule période
 *     scintillerait à l'horizon et se répéterait sous les roues.
 *   • **la pente vire à la roche**. Un versant à plus de 30° ne porte pas de
 *     prairie, et c'est ce qui donne le relief de montagne.
 *
 * Tout ça est greffé sur `MeshLambertMaterial` par `onBeforeCompile` plutôt
 * qu'écrit en shader complet : l'éclairage, le brouillard et le tone mapping
 * restent gérés par three.
 *
 * ## La seconde moitié du brouillard
 *
 * Ce fichier porte aussi le terme de **lumière rendue par l'air** — les
 * faisceaux qu'on voit entre les troncs au soleil rasant. Ce n'est pas un objet
 * ajouté à la scène : c'est un terme ajouté *après* le brouillard, et fait des
 * mêmes uniformes que lui (`fogColor`, `fogDensity`). Le brouillard retire du
 * contraste, celui-ci en rend : les deux moitiés d'un même air.
 *
 * Il est ici, sur le sol, et nulle part ailleurs, pour une raison de méthode :
 * c'est la plus grande surface d'une vue de forêt, donc celle qui dit le plus
 * vite si la direction tient. L'étendre aux autres matières est une décision à
 * prendre en regardant le résultat, pas d'avance.
 *
 * Trois choses à ne pas défaire :
 *
 *   • le motif est tiré dans le **plan perpendiculaire au soleil** (voir
 *     `environment/aerialLight.js`). C'est ce qui le rend constant le long du
 *     rayon, donc étiré en colonne, sans aucune marche dans le volume. Le tirer
 *     en coordonnées monde ordinaires donnerait des taches, pas des faisceaux ;
 *   • il est évalué au **milieu** du trajet œil → fragment, pas au fragment :
 *     c'est l'air traversé qui s'allume, pas la surface d'arrivée ;
 *   • il est multiplié par le canal « bois » de la carte de classes, lu au même
 *     endroit. Sans ce facteur, l'effet devient un filtre posé sur toute
 *     l'image au lieu d'appartenir à la forêt.
 */

import { createDetailCanvas, createGroundDetailCanvas } from '../materials/proceduralTextures.js';
import { CROP_KINDS, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Fabrique du matériau de terrain. **Un seul matériau** pour toute la bulle :
 * les tuiles ne diffèrent plus par leur texture, donc rien ne justifie de les
 * distinguer — un programme GPU, un jeu d'uniformes, et déplacer la carte de
 * classes est une écriture.
 */
export class TerrainMaterialFactory {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} [options.look] Tranche `terrain` du thème.
   * @param {Object} [options.air] Tranche `air` du thème : ce que l'atmosphère
   *        renvoie vers l'œil. `strength` à 0 rend le sol d'avant.
   * @param {Object} [options.groundClass] Instance `GroundClassMap`. Absente,
   *        tout le sol prend la matière de repli.
   */
  constructor({ THREE, look = {}, air = {}, groundClass = null }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
    this.air = { ...defaultTheme.air, ...air };
    this.groundClass = groundClass || null;

    // Ces textures **modulent** : elles portent du grain, pas des couleurs, et
    // doivent donc rester en espace linéaire.
    const repeated = (canvas) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = 4;
      return texture;
    };

    this.detailTexture = repeated(createDetailCanvas());
    this.grassTexture = repeated(createGroundDetailCanvas('grass', 256, 91711));
    this.soilTexture = repeated(createGroundDetailCanvas('soil', 256, 60413));
    this.woodTexture = repeated(createGroundDetailCanvas('forest', 256, 77201));

    this.material = this._create();
  }

  get textures() {
    return [this.detailTexture, this.grassTexture, this.soilTexture, this.woodTexture];
  }

  /** Recale les uniformes sur la carte de classes après une re-rasterisation. */
  syncGroundClass() {
    const map = this.groundClass;
    if (!map || !this._uniforms) return;
    this._uniforms.uClassOrigin.value.copy(map.origin);
    this._uniforms.uClassSize.value = map.size;
  }

  setMaxAnisotropy(value) {
    for (const texture of this.textures) {
      texture.anisotropy = Math.min(value || 4, 8);
      texture.needsUpdate = true;
    }
  }

  /**
   * Mouille le sol. Un seul uniforme pour toute la bulle : il n'y a qu'un
   * matériau de terrain, donc pas de tuile qui pourrait rester sèche.
   * @param {number} value De 0 (sec) à 1 (détrempé).
   */
  setWetness(value) {
    if (!this._uniforms) return;
    this._uniforms.uWetness.value = Math.min(1, Math.max(0, value || 0));
  }

  /**
   * Accorde la lumière rendue par l'air sur le soleil du moment.
   *
   * Appelé une fois par image par `world.updateSky` : c'est de l'**état**, au
   * même titre que le mouillé, et il n'a donc rien à faire dans le thème — le
   * thème ne dit que l'intensité de référence, ici c'est l'heure qui parle.
   *
   * @param {Object|null} state Voir `SceneEnvironment.aerialLight`. `null`, ou
   *        une intensité nulle, éteint le terme : le sol retrouve exactement le
   *        rendu d'avant.
   */
  setAerialLight(state) {
    const uniforms = this._uniforms;
    if (!uniforms) return;
    if (!state || !(state.intensity > 0) || !(this.air.strength > 0)) {
      uniforms.uAirStrength.value = 0;
      return;
    }
    // L'heure donne la part (0 à 1), le thème l'intensité de référence : deux
    // décisions distinctes, qui ne se mélangent qu'ici.
    uniforms.uAirStrength.value = state.intensity * this.air.strength;
    uniforms.uAirSun.value.set(state.sun[0], state.sun[1], state.sun[2]);
    uniforms.uAirRight.value.set(state.right[0], state.right[1], state.right[2]);
    uniforms.uAirUp.value.set(state.up[0], state.up[1], state.up[2]);
    uniforms.uAirTint.value.set(state.tint[0], state.tint[1], state.tint[2]);
  }

  _create() {
    const { THREE, look } = this;
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const uniforms = {
      uDetailMap: { value: this.detailTexture },
      uDetailScale: { value: new THREE.Vector2(look.detailScaleNear, look.detailScaleFar) },
      uDetailRange: { value: new THREE.Vector2(look.detailNear, look.detailFar) },
      uGrassMap: { value: this.grassTexture },
      uSoilMap: { value: this.soilTexture },
      uWoodMap: { value: this.woodTexture },
      uGroundScale: {
        value: new THREE.Vector3(look.groundScaleGrass, look.groundScaleSoil, look.groundScaleWood),
      },
      uGrassAlbedo: { value: new THREE.Vector3(...look.grassAlbedo) },
      uWoodAlbedo: { value: new THREE.Vector3(...look.woodAlbedo) },
      uFarmlandAlbedo: { value: new THREE.Vector3(...look.farmlandAlbedo) },
      uBareAlbedo: { value: new THREE.Vector3(...look.bareAlbedo) },
      uUnclassified: { value: new THREE.Vector4(...look.unclassifiedWeights) },
      uClassMap: { value: this.groundClass ? this.groundClass.texture : null },
      uClassOrigin: { value: new THREE.Vector2(0, 0) },
      uClassSize: { value: 1 },
      uClassEnabled: { value: this.groundClass ? 1 : 0 },
      // La carte des cultures partage le repère de la carte de classes : même
      // origine, même côté, mêmes bornes. Un seul jeu d'uniformes de cadrage,
      // donc aucune façon de les désynchroniser.
      uCropMap: { value: this.groundClass ? this.groundClass.cropTexture : null },
      uCropAlbedo: {
        value: CROP_KINDS.map((kind) => new THREE.Vector3(...(look.cropAlbedo[kind] || look.farmlandAlbedo))),
      },
      uRockColor: { value: new THREE.Vector3(...look.rockColor) },
      uSlopeRange: { value: new THREE.Vector2(look.slopeStart, look.slopeEnd) },
      uRockStrength: { value: look.rockStrength },
      /** Sol mouillé, de 0 à 1. Piloté par la météo, jamais par le thème. */
      uWetness: { value: 0 },
      // Lumière rendue par l'air. `uAirStrength` à 0 court-circuite tout le
      // terme : c'est l'état de départ, et celui d'un thème qui n'en veut pas.
      uAirStrength: { value: 0 },
      uAirSun: { value: new THREE.Vector3(0, 1, 0) },
      uAirRight: { value: new THREE.Vector3(1, 0, 0) },
      uAirUp: { value: new THREE.Vector3(0, 0, 1) },
      uAirTint: { value: new THREE.Vector3(1, 1, 1) },
      uAirScale: { value: this.air.scaleM },
      uAirRarity: { value: this.air.rarity },
      uAirPhaseG: { value: this.air.phaseG },
    };
    this._uniforms = uniforms;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vScenePos;
           varying vec3 vSceneNormal;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vScenePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vSceneNormal = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vScenePos;
           varying vec3 vSceneNormal;
           uniform sampler2D uDetailMap;
           uniform vec2 uDetailScale;
           uniform vec2 uDetailRange;
           uniform sampler2D uGrassMap;
           uniform sampler2D uSoilMap;
           uniform sampler2D uWoodMap;
           uniform vec3 uGroundScale;
           uniform vec3 uGrassAlbedo;
           uniform vec3 uWoodAlbedo;
           uniform vec3 uFarmlandAlbedo;
           uniform vec3 uBareAlbedo;
           uniform vec4 uUnclassified;
           uniform sampler2D uClassMap;
           uniform vec2 uClassOrigin;
           uniform float uClassSize;
           uniform float uClassEnabled;
           uniform sampler2D uCropMap;
           uniform vec3 uCropAlbedo[${CROP_KINDS.length}];
           uniform vec3 uRockColor;
           uniform vec2 uSlopeRange;
           uniform float uRockStrength;
           uniform float uWetness;
           uniform float uAirStrength;
           uniform vec3 uAirSun;
           uniform vec3 uAirRight;
           uniform vec3 uAirUp;
           uniform vec3 uAirTint;
           uniform float uAirScale;
           uniform float uAirRarity;
           uniform float uAirPhaseG;

           // Bruit de valeur, deux lignes, sans texture : le motif des trouées
           // n'a pas besoin de plus, et une texture de plus serait une texture
           // à charger, à filtrer et à libérer.
           float airHash(vec2 p) {
             return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
           }
           float airNoise(vec2 p) {
             vec2 i = floor(p);
             vec2 f = fract(p);
             vec2 u = f * f * (3.0 - 2.0 * f);
             return mix(mix(airHash(i), airHash(i + vec2(1.0, 0.0)), u.x),
                        mix(airHash(i + vec2(0.0, 1.0)), airHash(i + vec2(1.0, 1.0)), u.x), u.y);
           }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           {
             // Matières présentes ici. La carte de classes porte un poids par
             // canal et, dans son alpha, la couverture : alpha nul signifie
             // « la donnée ne dit rien », et non « sol nu ».
             vec2 classUv = (vScenePos.xz - uClassOrigin) / uClassSize;
             vec4 cls = vec4(0.0);
             if (uClassEnabled > 0.5 &&
                 classUv.x > 0.0 && classUv.x < 1.0 &&
                 classUv.y > 0.0 && classUv.y < 1.0) {
               cls = texture2D(uClassMap, classUv);
             }
             // (herbe, bois, culture, sol nu). Le sol nu est le complément :
             // classé, mais aucun des trois.
             vec4 vectorWeights = vec4(cls.rgb, max(0.0, 1.0 - cls.r - cls.g - cls.b));
             vec4 w = mix(uUnclassified, vectorWeights, cls.a);
             w /= max(w.x + w.y + w.z + w.w, 1e-4);

             // Grain, projeté en coordonnées monde : il ne suit ni les tuiles
             // ni la pente, donc il ne trahit aucun découpage.
             float dist = distance(vScenePos, cameraPosition);
             float far = smoothstep(uDetailRange.x, uDetailRange.y, dist);
             float near = texture2D(uDetailMap, vScenePos.xz / uDetailScale.x).r;
             float coarse = texture2D(uDetailMap, vScenePos.xz / uDetailScale.y).r;
             float noise = mix(near, coarse, far);

             vec3 grass = texture2D(uGrassMap, vScenePos.xz / uGroundScale.x).rgb;
             vec3 soil = texture2D(uSoilMap, vScenePos.xz / uGroundScale.y).rgb;
             vec3 wood = texture2D(uWoodMap, vScenePos.xz / uGroundScale.z).rgb;

             // Le grain de matière s'efface avec la distance, où il n'est plus
             // qu'un scintillement : au loin il ne reste que l'octave large.
             vec3 structure = grass * w.x + wood * w.y + soil * (w.z + w.w);
             vec3 texMod = mix(structure * 2.0, vec3(1.0), far);
             float texLuma = max(dot(texMod, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
             // On ne garde qu'une part de la teinte propre à la texture : le
             // reste de la variation est neutre, sinon la teinte du grain
             // s'ajouterait à celle de l'albédo au lieu de la nuancer.
             vec3 modulation = mix(vec3(texLuma), texMod, 0.45) * (0.7 + noise * 0.6);

             // Culture du champ. Le rouge porte un identifiant, lu au plus
             // proche — d'où l'arrondi, et non un seuil : une valeur
             // interpolée n'aurait aucun sens. L'indexation passe par une
             // boucle à bornes constantes, seule forme d'accès à un tableau
             // d'uniformes que toutes les versions de GLSL acceptent.
             vec3 farmAlbedo = uFarmlandAlbedo;
             if (uClassEnabled > 0.5 && w.z > 0.001) {
               float red = texture2D(uCropMap, classUv).r;
               int crop = int(floor(red * 255.0 / ${CROP_ID_STEP}.0 + 0.5)) - 1;
               for (int i = 0; i < ${CROP_KINDS.length}; i++) {
                 if (i == crop) farmAlbedo = uCropAlbedo[i];
               }
             }

             vec3 albedo =
               uGrassAlbedo * w.x +
               uWoodAlbedo * w.y +
               farmAlbedo * w.z +
               uBareAlbedo * w.w;

             vec3 base = albedo * modulation;

             // Pente : au-delà, ce n'est plus un sol mais un versant.
             float slope = 1.0 - clamp(vSceneNormal.y, 0.0, 1.0);
             float rock = smoothstep(uSlopeRange.x, uSlopeRange.y, slope) * uRockStrength;
             base = mix(base, base * uRockColor, rock);

             // Sol mouillé. Un film d'eau **assombrit et sature** : la lumière
             // qui entre dans le sol s'y réfléchit plusieurs fois au lieu d'en
             // ressortir du premier coup, donc il en revient moins, et ce qui en
             // revient est plus coloré. C'est pour ça qu'une terre mouillée est
             // brune profonde et une terre sèche beige pâle — le même effet, et
             // pas un choix de teinte : on ne remplace aucune couleur du thème,
             // on ne fait que jouer sur le chemin de la lumière dedans.
             if (uWetness > 0.0) {
               float wetLuma = dot(base, vec3(0.2126, 0.7152, 0.0722));
               vec3 saturated = wetLuma + (base - wetLuma) * 1.35;
               base = mix(base, saturated * 0.62, uWetness);
             }

             diffuseColor.rgb = max(base, vec3(0.0));
           }`
        )
        // Après le brouillard, et pas à sa place : le brouillard *retire* du
        // contraste, cette part-là en *ajoute*. Le mélange de three a déjà tiré
        // le fragment vers `fogColor` quand on arrive ici ; il ne reste qu'à
        // rendre à l'air la lumière qu'il renvoie. `fogColor` et `fogDensity`
        // sont ceux que le brouillard vient d'employer — l'air ne peut donc pas
        // diverger de la brume, il en est la seconde moitié.
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
           #ifdef USE_FOG
           if (uAirStrength > 0.0) {
             vec3 toEye = cameraPosition - vScenePos;
             float pathLength = length(toEye);
             vec3 look = -toEye / max(pathLength, 1e-4);

             // Henyey-Greenstein, ramenée à 1 dans l'axe du soleil : c'est elle
             // qui fait que l'effet n'existe qu'en regardant vers le soleil, et
             // s'éteint dès qu'on lui tourne le dos. Sans elle, la scène
             // entière serait lavée d'un voile clair uniforme.
             float g = uAirPhaseG;
             float denom = 1.0 + g * g - 2.0 * g * dot(look, uAirSun);
             float phase = pow(1.0 - g, 3.0) / max(pow(denom, 1.5), 1e-4);

             // Le motif est tiré au **milieu** du trajet : c'est l'air traversé
             // qui s'allume, pas la surface d'arrivée. Ses coordonnées sont
             // celles du plan perpendiculaire au soleil (voir
             // environment/aerialLight.js) : constant le long du rayon, donc
             // étiré en colonne sans aucune marche dans le volume.
             vec3 midPoint = vScenePos + toEye * 0.5;
             vec2 sunPlane = vec2(dot(midPoint, uAirRight), dot(midPoint, uAirUp)) / uAirScale;
             float pattern = airNoise(sunPlane) * 0.65 + airNoise(sunPlane * 2.7) * 0.35;
             float beam = smoothstep(uAirRarity, 1.0, pattern);

             // Le bois, lu dans la carte de classes au même endroit : hors
             // couvert il n'y a rien pour découper la lumière, donc pas de
             // faisceau. C'est ce qui attache l'effet à la forêt au lieu d'en
             // faire un filtre posé sur toute l'image.
             float canopy = 0.0;
             vec2 airUv = (midPoint.xz - uClassOrigin) / uClassSize;
             if (uClassEnabled > 0.5 &&
                 airUv.x > 0.0 && airUv.x < 1.0 &&
                 airUv.y > 0.0 && airUv.y < 1.0) {
               vec4 airClass = texture2D(uClassMap, airUv);
               canopy = airClass.g * airClass.a;
             }

             // L'épaisseur d'air réellement traversée : sans brume devant, il
             // n'y a rien pour porter le faisceau. Recalculée depuis les
             // uniformes du brouillard plutôt que reprise à la variable locale
             // du chunk de three — celle-ci est un détail d'implémentation,
             // ceux-là sont l'interface du matériau.
             #ifdef FOG_EXP2
               float haze = 1.0 - exp(-fogDensity * fogDensity * pathLength * pathLength);
             #else
               float haze = 1.0;
             #endif

             float shaft = beam * canopy * phase * saturate(haze) * uAirStrength;
             gl_FragColor.rgb += fogColor * uAirTint * shaft;
           }
           #endif`
        );
    };

    // Clé constante : sans elle, three recompilerait le programme à chaque
    // matériau qui le demande.
    material.customProgramCacheKey = () => 'terrain-bubble-v9';
    return material;
  }

  dispose() {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
