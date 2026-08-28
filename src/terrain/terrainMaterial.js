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
   * @param {Object} [options.groundClass] Instance `GroundClassMap`. Absente,
   *        tout le sol prend la matière de repli.
   */
  constructor({ THREE, look = {}, groundClass = null }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
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
           uniform float uRockStrength;`
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
        );
    };

    // Clé constante : sans elle, three recompilerait le programme à chaque
    // matériau qui le demande.
    material.customProgramCacheKey = () => 'terrain-bubble-v8';
    return material;
  }

  dispose() {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
