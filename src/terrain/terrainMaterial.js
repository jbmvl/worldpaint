/*
 * terrainMaterial — la matière du sol. `groundClassMap` rasterise l'occupation
 * du sol autour de l'observateur ; ce shader y lit la part d'herbe, de bois,
 * de culture et de sol nu, et compose la matière correspondante.
 *
 * Structure (grain, textures procédurales moyennées à 0,5) et couleur
 * (albédos linéaires) sont séparées. Le grain change d'échelle avec la
 * distance (période fine près, octave large loin). La pente au-delà de 30°
 * vire à la roche.
 *
 * Quatre choses le sortent de l'aplat, et elles tiennent ensemble :
 *
 * - le grain **incline la normale** (dérivées d'écran, Mikkelsen) : sans ça
 *   un sol reste une peinture, c'est l'ombre d'un caillou qui fait la matière.
 *   Aucun relevé de plus, et l'effet s'éteint au loin où le mip a lissé ;
 * - **aucune texture ne se répète à sa période** : deux relevés décalés,
 *   choisis par un bruit cent fois plus large, fondus là où ils se ressemblent
 *   (technique d'Íñigo Quílez). Une période de 2,6 m dessine sinon une grille
 *   lisible jusqu'à l'horizon ;
 * - **deux matières s'interpénètrent** au lieu de se fondre : les poids sont
 *   repondérés par la hauteur du grain puis seuillés (`blendWidth`). Un
 *   mélange linéaire donne une bande dégradée de cinq mètres, une aquarelle ;
 * - une **variation macro** de deux cents mètres en luminosité et en chaleur,
 *   qui monte avec la distance — un albédo constant par classe est ce qui
 *   donne l'aplat de carte routière, et le grain, au mètre, n'y peut rien.
 *
 * Greffé sur `MeshLambertMaterial` via `onBeforeCompile` plutôt qu'écrit en
 * shader complet, pour garder l'éclairage/brouillard/tone mapping de three.
 */

import {
  createDetailCanvas,
  createGroundDetailCanvas,
  createMacroCanvas,
} from '../materials/proceduralTextures.js';
import { CROP_KINDS, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import { COVER_KINDS, COVER_ID_STEP, WATER_COVER_ID, CLASS_PIXELS } from './groundClassMap.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';
import { soilWashFor } from '../core/climate.js';

/** Fabrique du matériau de terrain. Un seul matériau pour toute la bulle. */
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

    // Textures de grain (pas de couleur) : espace linéaire.
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
    // Rides : la même carte que celle qui servait la nappe d'eau, du temps où
    // l'eau était une surface posée sur le terrain.
    this.waterRippleTexture = repeated(createWaterNormalCanvas());

    this.material = this._create();
  }

  get textures() {
    return [
      this.detailTexture,
      this.macroTexture,
      this.grassTexture,
      this.soilTexture,
      this.woodTexture,
      this.waterRippleTexture,
    ];
  }

  /**
   * Fait dériver les rides de l'eau. Deux vitesses inégales : à vitesses
   * égales on lit une image qui glisse, pas une surface qui bouge.
   * @param {number} seconds Temps écoulé.
   */
  advanceWater(seconds) {
    const flow = this._uniforms?.uWaterFlow?.value;
    if (!flow) return;
    flow.x = (flow.x + seconds * 0.013) % 1;
    flow.y = (flow.y + seconds * 0.021) % 1;
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
   * Applique la correction de sol d'une famille climatique — le seul endroit
   * où le sol lointain apprend le pays. Les touffes et les tiges du premier
   * plan lisent le même facteur par `soilWashFor` : voir `SOIL_LOOK` sur
   * pourquoi c'est un facteur et pas une palette. Les couvertures ne bougent
   * pas, une lande dit déjà son pays.
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
   * Mouille le sol.
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
      // Partage le repère de la carte de classes (même origine, même côté).
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
      // L'eau. Elle ne se mélange pas aux autres matières : là où la
      // couverture le dit, elle remplace tout — couleur, grain, relief.
      uWaterAlbedo: {
        value: new THREE.Vector3(...((look.coverAlbedo || {}).water || [0.02, 0.045, 0.06])),
      },
      uWaterSheenColor: { value: new THREE.Vector3(...look.waterSheenColor) },
      uWaterSheen: { value: look.waterSheen },
      uWaterRipples: { value: this.waterRippleTexture },
      uWaterRipple: { value: new THREE.Vector2(look.waterRippleM, look.waterRippleRelief) },
      /** Dérive des rides, en cycles. Deux vitesses inégales : sinon on lit un glissement. */
      uWaterFlow: { value: new THREE.Vector2(0, 0) },
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
           uniform vec3 uWaterAlbedo;
           uniform vec3 uWaterSheenColor;
           uniform float uWaterSheen;
           uniform sampler2D uWaterRipples;
           uniform vec2 uWaterRipple;
           uniform vec2 uWaterFlow;

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
           }

           /* Vrai (1.0) si le carreau donné de la carte des cultures porte de l'eau. */
           float waterAtTexel(vec2 texel) {
             vec4 fine = texture2D(uCropMap, (texel + 0.5) / ${CLASS_PIXELS}.0);
             int cover = int(floor(fine.g * 255.0 / ${COVER_ID_STEP}.0 + 0.5)) - 1;
             return cover == ${WATER_COVER_ID - 1} ? 1.0 : 0.0;
           }

           /*
            * Part d'eau en un point, de 0 à 1.
            *
            * La couverture est un **identifiant** peint dans un canal : il se
            * relit au plus proche, sans quoi l'interpolation inventerait une
            * matière entre deux (entre le sable et l'eau, il n'y a rien).
            * D'où le défaut : le contour de l'eau suivait le carreau de la
            * carte — deux mètres et demi de côté — et se lisait comme un
            * escalier, alors que les lisières des matières, elles, sont
            * filtrées linéairement et se fondent.
            *
            * On interpole donc le **résultat du test**, pas l'identifiant :
            * les quatre carreaux voisins sont lus au plus proche, chacun est
            * eau ou ne l'est pas, et c'est ce booléen qu'on mélange. La berge
            * devient une rampe d'un carreau, de la largeur du fondu que la
            * carte des matières a déjà.
            *
            * Limite assumée : le contour passe par les centres des carreaux.
            * Il ne retrouve pas la position du polygone **dans** un carreau —
            * il faudrait pour cela une carte de couverture d'eau à part,
            * peinte avec son antialiasing. Ce qui disparaît ici est la marche
            * d'escalier, pas le pas de la carte.
            */
           float waterShareAt(vec2 uv) {
             vec2 grid = uv * ${CLASS_PIXELS}.0 - 0.5;
             vec2 corner = floor(grid);
             vec2 f = grid - corner;
             float s00 = waterAtTexel(corner);
             float s10 = waterAtTexel(corner + vec2(1.0, 0.0));
             float s01 = waterAtTexel(corner + vec2(0.0, 1.0));
             float s11 = waterAtTexel(corner + vec2(1.0, 1.0));
             return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
           }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           // Hors du bloc : la perturbation de normale, plus bas dans le
           // shader de three, lit ce grain-là — le relever une seconde fois
           // coûterait autant que tout le reste du sol. Même raison pour la
           // part d'eau : décidée ici, relue là-bas.
           float grainHeight = 0.5;
           float gWater = 0.0;
           {
             // La carte de classes porte un poids par canal, et dans son
             // alpha la couverture (alpha nul = donnée absente, pas sol nu).
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
             // (herbe, bois, culture, sol nu) : le sol nu est le complément.
             vec4 vectorWeights = vec4(cls.rgb, max(0.0, 1.0 - cls.r - cls.g - cls.b));
             vec4 w = mix(uUnclassified, vectorWeights, cls.a);
             w /= max(w.x + w.y + w.z + w.w, 1e-4);

             // Grain projeté en coordonnées monde (pas de découpage visible).
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

             // Le grain s'efface avec la distance.
             vec3 structure = grass * w.x + wood * w.y + soil * (w.z + w.w);
             grainHeight = dot(structure, vec3(0.3333));
             vec3 texMod = mix(structure * 2.0, vec3(1.0), far);
             float texLuma = max(dot(texMod, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
             // Part de teinte propre à la texture ; le reste reste neutre pour nuancer l'albédo sans s'y ajouter.
             vec3 modulation = mix(vec3(texLuma), texMod, 0.45) * (0.7 + noise * 0.6);

             // Variation macro. Centrée sur 1 : elle étale la luminosité sans
             // la déplacer, et fait dériver la teinte vers le chaud dans les
             // zones claires. Elle monte **avec la distance**, et c'est une
             // contrainte : les touffes instanciées ne la connaissent pas,
             // donc à portée de semis le sol doit rester la couleur sur
             // laquelle elles sont calées. Le grain porte le près, la nappe
             // le loin, sur la même rampe.
float macroSigned = (macro - 0.5) * far;
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
               //
               // L'eau est écartée de la boucle : elle n'est pas une matière
               // de plus à mélanger mais une surface qui remplace le sol, et
               // elle est reprise plus bas avec son propre fondu. La laisser
               // ici peindrait le sol en couleur d'eau **avant** ce fondu, et
               // la berge se fondrait d'une eau grainée vers une eau lisse au
               // lieu d'aller de la terre à l'eau.
               int cover = int(floor(fine.g * 255.0 / ${COVER_ID_STEP}.0 + 0.5)) - 1;
               for (int i = 0; i < ${COVER_KINDS.length}; i++) {
                 if (i == cover && i != ${WATER_COVER_ID - 1}) {
                   grassAlbedo = uCoverAlbedo[i];
                   bareAlbedo = uCoverAlbedo[i];
                 }
               }
               // L'eau n'est pas une matière de plus à mélanger : c'est une
               // surface qui remplace le sol. Elle est donc retenue à part,
               // pour court-circuiter grain, roche et sol mouillé — et lue
               // par interpolation du test (voir waterShareAt), sinon son
               // contour est celui du carreau de la carte.
               gWater = waterShareAt(classUv);
             }

             vec3 albedo =
               grassAlbedo * w.x +
               uWoodAlbedo * w.y +
               farmAlbedo * w.z +
               bareAlbedo * w.w;

             vec3 base = albedo * modulation;

             float slope = 1.0 - clamp(vSceneNormal.y, 0.0, 1.0);
             float rock = smoothstep(uSlopeRange.x, uSlopeRange.y, slope) * uRockStrength * (1.0 - gWater);
             base = mix(base, base * uRockColor, rock);

             // Sol mouillé : le film d'eau assombrit et sature (multi-réflexion
             // interne). Sans objet sur l'eau elle-même.
             if (uWetness > 0.0) {
               float wetLuma = dot(base, vec3(0.2126, 0.7152, 0.0722));
               vec3 saturated = wetLuma + (base - wetLuma) * 1.35;
               base = mix(base, saturated * 0.62, uWetness * (1.0 - gWater));
             }

             if (gWater > 0.001) {
               // Ce qui fait lire un plan d'eau, ce n'est pas sa couleur
               // propre — elle est presque noire — c'est qu'il **renvoie le
               // ciel d'autant plus qu'on le regarde de biais**. D'où un
               // Fresnel sur la normale ridée : sombre à l'aplomb, clair au
               // ras, et scintillant entre les deux parce que chaque ride
               // change l'angle.
               vec3 toEye = normalize(cameraPosition - vScenePos);
               vec3 ripple = texture2D(uWaterRipples, vScenePos.xz / uWaterRipple.x + uWaterFlow).xyz * 2.0 - 1.0;
               vec3 wavy = normalize(vSceneNormal + vec3(ripple.x, 0.0, ripple.z) * uWaterRipple.y);
               float grazing = 1.0 - clamp(dot(wavy, toEye), 0.0, 1.0);
               float sheen = pow(grazing, 3.0) * uWaterSheen;
               vec3 water = mix(uWaterAlbedo, uWaterSheenColor, clamp(sheen, 0.0, 1.0));
               // Fondu et non remplacement : c'est la berge. gWater vaut 1
               // dès le second carreau, donc le plan d'eau lui-même n'est pas
               // mélangé — seule sa bordure l'est.
               base = mix(base, water, gWater);
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
             //
             // Les dérivées se prennent **hors de toute branche** : sur l'eau
             // comme sur le sol. Une dérivée d'écran prise dans une condition
             // que les pixels voisins ne suivent pas ensemble n'a pas de
             // valeur définie, et la frontière d'une berge est exactement
             // l'endroit où ils divergent.
             vec3 worldNormal = normalize(vSceneNormal);
             vec3 dpdx = dFdx(vScenePos);
             vec3 dpdy = dFdy(vScenePos);
             float dhdx = dFdx(grainHeight);
             float dhdy = dFdy(grainHeight);

             vec3 across = cross(dpdy, worldNormal);
             vec3 along = cross(worldNormal, dpdx);
             float det = dot(dpdx, across);
             vec3 bumped = worldNormal;
             if (abs(det) > 1e-6) {
               bumped = normalize(worldNormal - uGrainRelief * (across * dhdx + along * dhdy) / det);
             }

             // Sur l'eau, le relief n'est pas le grain du sol mais la ride.
             // Deux relevés à des vitesses inégales : un seul se lirait comme
             // une image qui glisse.
             vec3 a = texture2D(uWaterRipples, vScenePos.xz / uWaterRipple.x + uWaterFlow).xyz * 2.0 - 1.0;
             vec3 b = texture2D(uWaterRipples, vScenePos.zx / (uWaterRipple.x * 0.6) - uWaterFlow * 1.7).xyz * 2.0 - 1.0;
             vec3 wavy = normalize(worldNormal + vec3(a.x + b.x, 0.0, a.z + b.z) * uWaterRipple.y);

             normal = normalize((viewMatrix * vec4(mix(bumped, wavy, gWater), 0.0)).xyz);
           }`
        );
    };

    // Clé constante pour éviter une recompilation à chaque matériau.
    material.customProgramCacheKey = () => 'terrain-bubble-v12';
    return material;
  }

  dispose() {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
