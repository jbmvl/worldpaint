/*
 * terrainMaterial — la matière du sol.
 * ------------------------------------
 * Le sol n'est pas photographié : il est **décrit**. `groundClassMap` rasterise
 * l'occupation du sol des tuiles vectorielles autour de l'observateur ; ce shader y
 * lit, en chaque point, la part d'herbe, de bois, de culture et de sol nu, et
 * compose la matière correspondante.
 *
 * Six principes, et tout le reste en découle :
 *
 *   • **structure et couleur sont séparées**. Les textures procédurales ne
 *     portent que le grain — leur moyenne est calée à 0,5 à la construction,
 *     donc doublées elles valent 1 et ne déplacent aucune luminosité. La
 *     couleur vient des albédos, en espace linéaire. Employer une texture de
 *     grain comme albédo donnait un albédo moyen de 1, c'est-à-dire de la neige.
 *   • **le grain change d'échelle avec la distance**. De près, une période de
 *     quelques mètres ; au loin, une octave large. Une seule période
 *     scintillerait à l'horizon et se répéterait sous les roues.
 *   • **le grain incline la normale**. Une texture qui ne fait qu'assombrir
 *     laisse un sol peint : c'est l'ombre portée d'un brin ou d'un caillou,
 *     donc la réponse à la lumière rasante, qui le fait lire comme une
 *     matière. La pente locale se tire des dérivées d'écran du grain déjà
 *     échantillonné — aucun relevé de plus, et l'effet s'éteint tout seul au
 *     loin, là où le mip a lissé le grain.
 *   • **aucune texture ne se répète à sa période**. Deux relevés décalés,
 *     choisis par un bruit cent fois plus large, se fondent l'un dans l'autre
 *     là où ils se ressemblent (technique d'Íñigo Quílez). Sans ça, une
 *     période de deux mètres soixante dessine une grille lisible jusqu'à
 *     l'horizon, et c'est le premier défaut qu'on voit d'un terrain.
 *   • **deux matières s'interpénètrent, elles ne se fondent pas**. Un mélange
 *     linéaire entre prairie et labour donne une bande dégradée de cinq
 *     mètres qui se lit comme une aquarelle. La transition est donc tranchée
 *     par le grain lui-même : la matière dominante déborde dans les creux de
 *     l'autre. C'est aussi ce qui fait qu'un champ apparaît avec un bord, et
 *     que les tiges instanciées qui s'y posent tombent sur la bonne couleur.
 *   • **la pente vire à la roche**. Un versant à plus de 30° ne porte pas de
 *     prairie, et c'est ce qui donne le relief de montagne.
 *
 * S'y ajoute une **variation macro** : une modulation très basse fréquence,
 * de l'ordre de deux cents mètres, en luminosité et en chaleur. Une plaine
 * n'a pas la même couleur d'un bout à l'autre, et un albédo constant par
 * classe est ce qui donne l'aplat de carte routière — c'est le défaut que le
 * grain, qui travaille au mètre, ne peut pas corriger.
 *
 * Tout ça est greffé sur `MeshLambertMaterial` par `onBeforeCompile` plutôt
 * qu'écrit en shader complet : l'éclairage, le brouillard et le tone mapping
 * restent gérés par three.
 */

import {
  createDetailCanvas,
  createGroundDetailCanvas,
  createMacroCanvas,
} from '../materials/proceduralTextures.js';
import { CROP_KINDS, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import { COVER_KINDS, COVER_ID_STEP } from './groundClassMap.js';
import { defaultTheme } from '../themes/default.js';
import { soilWashFor } from '../core/climate.js';

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
   * @param {Object} [options.soils] Tranche `soils` du thème.
   * @param {Object} [options.groundClass] Instance `GroundClassMap`. Absente,
   *        tout le sol prend la matière de repli.
   */
  constructor({ THREE, look = {}, soils = null, groundClass = null }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
    this.soils = soils || defaultTheme.soils;
    this.groundClass = groundClass || null;
    /** Famille appliquée aux albédos. `null` = aucune correction. */
    this._climate = null;

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
    this.macroTexture = repeated(createMacroCanvas());
    this.grassTexture = repeated(createGroundDetailCanvas('grass', 256, 91711));
    this.soilTexture = repeated(createGroundDetailCanvas('soil', 256, 60413));
    this.woodTexture = repeated(createGroundDetailCanvas('forest', 256, 77201));

    this.material = this._create();
  }

  get textures() {
    return [
      this.detailTexture,
      this.macroTexture,
      this.grassTexture,
      this.soilTexture,
      this.woodTexture,
    ];
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
   * Applique la correction de sol d'une famille climatique.
   *
   * Trois albédos et deux tableaux d'albédos réécrits d'un coup : c'est peu
   * cher (une poignée de vecteurs, jamais par image) et surtout c'est **le
   * seul endroit** où le sol lointain apprend le pays. Les touffes et les
   * tiges du premier plan lisent le même facteur par `soilWashFor` — voir
   * `themes/default.js`, `SOIL_LOOK`, sur pourquoi c'est un facteur et pas une
   * palette.
   *
   * Les couvertures ne bougent pas : une lande ou un maquis disent déjà leur
   * pays.
   *
   * @param {string|null} family
   */
  setClimate(family) {
    if (!this._uniforms || family === this._climate) return;
    this._climate = family || null;
    const { look } = this;
    const wash = soilWashFor(this._climate, this.soils);
    const scale = (albedo, by) => albedo.map((v, i) => v * by[i]);

    this._uniforms.uGrassAlbedo.value.set(...scale(look.grassAlbedo, wash.grass));
    this._uniforms.uBareAlbedo.value.set(...scale(look.bareAlbedo, wash.bare));
    this._uniforms.uFarmlandAlbedo.value.set(...scale(look.farmlandAlbedo, wash.farmland));
    CROP_KINDS.forEach((kind, i) => {
      const base = look.cropAlbedo[kind] || look.farmlandAlbedo;
      this._uniforms.uCropAlbedo.value[i].set(...scale(base, wash.farmland));
    });
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
      // (période en mètres, amplitude en luminosité, dérive chaud/froid).
      uMacroMap: { value: this.macroTexture },
      uMacro: {
        value: new THREE.Vector3(look.macroScaleM, look.macroStrength, look.macroWarmth),
      },
      uBlendWidth: { value: look.blendWidth },
      uGrainRelief: { value: look.grainRelief },
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
      // Couvertures — même mécanique que les cultures, dans l'autre canal de la
      // même carte. Le repli est l'albédo d'herbe : une couverture qu'un thème
      // ne décrit pas se peint comme une prairie, ce qui est le comportement
      // d'avant qu'elles existent.
      uCoverAlbedo: {
        value: COVER_KINDS.map(
          (kind) => new THREE.Vector3(...((look.coverAlbedo || {})[kind] || look.grassAlbedo))
        ),
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
           uniform sampler2D uMacroMap;
           uniform vec3 uMacro;
           uniform float uBlendWidth;
           uniform float uGrainRelief;
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
           uniform vec3 uCoverAlbedo[${COVER_KINDS.length}];
           uniform vec3 uRockColor;
           uniform vec2 uSlopeRange;
           uniform float uRockStrength;
           uniform float uWetness;

           /*
            * Relevé d'une texture cyclique **sans que sa période se voie**.
            *
            * Deux relevés de la même image, décalés chacun d'un vecteur tiré
            * d'un indice de région, fondus l'un dans l'autre. Le fondu est
            * biaisé par l'écart entre les deux relevés : il
            * passe donc de préférence là où ils se ressemblent, et la couture
            * n'a rien à cacher. C'est la première des techniques d'Íñigo
            * Quílez sur la répétition de texture — deux relevés au lieu de
            * neuf, ce qui est le seul coût qu'un sol peut se permettre.
            *
            * Limite connue et assumée : au passage d'une région à l'autre,
            * le décalage saute, donc le niveau de mip calculé sur une ligne
            * de pixels est faux. Sur une photo ça se verrait ; sur du grain
            * dont on ne garde que la variation, non.
            *
            * L'indice de région vient du bruit macro, dont la période est
            * cent fois plus large : le motif ne se répète donc plus tous les
            * trois mètres mais tous les deux cents, à quoi s'ajoute que les
            * deux relevés ne se répètent pas ensemble.
            */
           vec3 noTile(sampler2D tex, vec2 uv, float region) {
             float l = region * 8.0;
             float i = floor(l);
             float f = fract(l);
             vec2 offA = sin(vec2(3.0, 7.0) * i);
             vec2 offB = sin(vec2(3.0, 7.0) * (i + 1.0));
             vec3 a = texture2D(tex, uv + offA).rgb;
             vec3 b = texture2D(tex, uv + offB).rgb;
             float d = dot(a - b, vec3(0.3333));
             return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * d));
           }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           // Hors du bloc : la perturbation de normale, plus bas dans le
           // shader de three, lit ce grain-là — le relever une seconde fois
           // coûterait autant que tout le reste du sol.
           float grainHeight = 0.5;
           {
             // Matières présentes ici. La carte de classes porte un poids par
             // canal et, dans son alpha, la couverture : alpha nul signifie
             // « la donnée ne dit rien », et non « sol nu ».
             vec2 classUv = (vScenePos.xz - uClassOrigin) / uClassSize;
             vec4 cls = vec4(0.0);
             // Hors du carré couvert, la texture est bornée au bord : lire quand
             // même y étalerait la lisière sur des kilomètres.
             float inClass = uClassEnabled > 0.5 &&
                 classUv.x > 0.0 && classUv.x < 1.0 &&
                 classUv.y > 0.0 && classUv.y < 1.0 ? 1.0 : 0.0;
             if (inClass > 0.5) {
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

             // Bruit macro : deux cents mètres de période. Il sert deux fois —
             // à choisir la région des relevés sans répétition, et à faire
             // dériver la couleur d'un bout à l'autre d'une parcelle.
             float macro = texture2D(uMacroMap, vScenePos.xz / uMacro.x).r;

             vec3 grass = noTile(uGrassMap, vScenePos.xz / uGroundScale.x, macro);
             vec3 soil = noTile(uSoilMap, vScenePos.xz / uGroundScale.y, macro);
             vec3 wood = noTile(uWoodMap, vScenePos.xz / uGroundScale.z, macro);

             // Interpénétration des matières. Chaque relevé porte sa propre
             // « hauteur » — la luminance de son grain, c'est-à-dire ce qui
             // dépasse : un brin, un caillou, une feuille. On repondère les
             // poids par elle, puis on ne garde que ce qui reste dans
             // uBlendWidth du plus fort. La lisière suit alors la forme du
             // grain au lieu d'être un dégradé, et une matière minoritaire
             // disparaît franchement au lieu de teinter l'autre de moitié.
             vec4 height = vec4(
               dot(grass, vec3(0.3333)),
               dot(wood, vec3(0.3333)),
               dot(soil, vec3(0.3333)),
               dot(soil, vec3(0.3333))
             );
             vec4 lifted = w * (0.35 + height);
             float peak = max(max(lifted.x, lifted.y), max(lifted.z, lifted.w));
             lifted = max(lifted - (peak - uBlendWidth), 0.0);
             // Au loin, la carte de classes est plus fine que le pixel :
             // trancher là-bas ferait crépiter la lisière d'une image à
             // l'autre. On y revient donc au fondu doux.
             w = mix(lifted / max(lifted.x + lifted.y + lifted.z + lifted.w, 1e-4), w, far);

             // Le grain de matière s'efface avec la distance, où il n'est plus
             // qu'un scintillement : au loin il ne reste que l'octave large.
             vec3 structure = grass * w.x + wood * w.y + soil * (w.z + w.w);
             grainHeight = dot(structure, vec3(0.3333));
             vec3 texMod = mix(structure * 2.0, vec3(1.0), far);
             float texLuma = max(dot(texMod, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
             // On ne garde qu'une part de la teinte propre à la texture : le
             // reste de la variation est neutre, sinon la teinte du grain
             // s'ajouterait à celle de l'albédo au lieu de la nuancer.
             vec3 modulation = mix(vec3(texLuma), texMod, 0.45) * (0.7 + noise * 0.6);

             // Variation macro. Centrée sur 1 : elle ne déplace aucune
             // luminosité moyenne, elle l'étale. La dérive de teinte va vers
             // le chaud dans les zones claires — un sol qui a pris le soleil
             // est plus jaune, pas seulement plus lumineux.
             float macroSigned = macro - 0.5;
             modulation *= (1.0 + macroSigned * uMacro.y) *
               vec3(1.0 + macroSigned * uMacro.z, 1.0, 1.0 - macroSigned * uMacro.z);

             // Culture du champ. Le rouge porte un identifiant, lu au plus
             // proche — d'où l'arrondi, et non un seuil : une valeur
             // interpolée n'aurait aucun sens. L'indexation passe par une
             // boucle à bornes constantes, seule forme d'accès à un tableau
             // d'uniformes que toutes les versions de GLSL acceptent.
             vec3 farmAlbedo = uFarmlandAlbedo;
             vec3 grassAlbedo = uGrassAlbedo;
             vec3 bareAlbedo = uBareAlbedo;
             if (inClass > 0.5) {
               vec4 fine = texture2D(uCropMap, classUv);
               if (w.z > 0.001) {
                 int crop = int(floor(fine.r * 255.0 / ${CROP_ID_STEP}.0 + 0.5)) - 1;
                 for (int i = 0; i < ${CROP_KINDS.length}; i++) {
                   if (i == crop) farmAlbedo = uCropAlbedo[i];
                 }
               }
               // Couverture. Elle remplace l'herbe **et** le minéral, et non
               // l'un des deux : une lande, un maquis ou un éboulis ne sont pas
               // une prairie un peu terne ni un parking, ce sont d'autres
               // matières. Chacune n'est peinte que sur l'une des deux, donc
               // remplacer les deux ne mélange rien.
               int cover = int(floor(fine.g * 255.0 / ${COVER_ID_STEP}.0 + 0.5)) - 1;
               for (int i = 0; i < ${COVER_KINDS.length}; i++) {
                 if (i == cover) {
                   grassAlbedo = uCoverAlbedo[i];
                   bareAlbedo = uCoverAlbedo[i];
                 }
               }
             }

             vec3 albedo =
               grassAlbedo * w.x +
               uWoodAlbedo * w.y +
               farmAlbedo * w.z +
               bareAlbedo * w.w;

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
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
           {
             // Relief de grain. Un sol qui ne fait que changer de couleur
             // reste une peinture : ce qui le fait lire comme une matière,
             // c'est que la lumière rasante y accroche — l'ombre d'un caillou
             // du côté opposé au soleil, un pré qui se ternit quand on le
             // regarde dans le contre-jour.
             //
             // La pente se tire des dérivées d'écran du grain déjà relevé
             // (Mikkelsen, « Bump Mapping Unparametrized Surfaces on the
             // GPU ») : aucun relevé de plus, aucune tangente à transporter,
             // et l'effet s'éteint tout seul au loin, là où le mip a lissé le
             // grain. C'est aussi sa limite — le grain n'est pas un relevé
             // d'altitude, donc l'amplitude se dose à l'œil et rien de plus.
             //
             // Le calcul se fait en **coordonnées monde**, parce que c'est là
             // que vit le grain ; la normale de three, elle, est en espace
             // vue. D'où le passage par viewMatrix — mélanger les deux repères
             // donnerait un relief qui tourne avec la caméra.
             vec3 worldNormal = normalize(vSceneNormal);
             vec3 dpdx = dFdx(vScenePos);
             vec3 dpdy = dFdy(vScenePos);
             vec3 across = cross(dpdy, worldNormal);
             vec3 along = cross(worldNormal, dpdx);
             float det = dot(dpdx, across);
             if (abs(det) > 1e-6) {
               vec3 gradient = (across * dFdx(grainHeight) + along * dFdy(grainHeight)) / det;
               vec3 bumped = normalize(worldNormal - uGrainRelief * gradient);
               normal = normalize((viewMatrix * vec4(bumped, 0.0)).xyz);
             }
           }`
        );
    };

    // Clé constante : sans elle, three recompilerait le programme à chaque
    // matériau qui le demande.
    material.customProgramCacheKey = () => 'terrain-bubble-v10';
    return material;
  }

  dispose() {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
