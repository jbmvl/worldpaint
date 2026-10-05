import { TERRAIN_GRAIN_GLSL } from './terrainGrainShader.js';
import { installTunnelMouths } from './tunnelMouths.js';
/*
 * terrainMaterial — la matière du sol. `groundClassMap` rasterise l'occupation
 * du sol autour de l'observateur ; ce shader y lit la part d'herbe, de bois,
 * de culture et de sol nu, et compose la matière correspondante.
 *
 * ## Une matière est une couleur, et rien d'autre
 *
 * C'est la règle du module, et elle a été chèrement acquise — on y est venu
 * en retirant, une par une, toutes les couches qui prétendaient faire lire un
 * matériau. Elles sont énumérées ici parce que chacune paraît, isolément, une
 * bonne idée, et qu'aucune ne survit à un regard :
 *
 * - **trois textures de sol dessinées** (herbe, limon, litière) portant des
 *   brins, des cailloux avec leur ombre peinte, des feuilles mortes. Un objet
 *   de trois centimètres passe sous le pixel d'écran vers trente mètres : au
 *   delà il ne restait que le pavage de leur période, qu'il fallait masquer à
 *   son tour (deux relevés décalés par matière, technique d'Íñigo Quílez : six
 *   lectures par pixel dépensées à cacher un défaut que les motifs créaient
 *   eux-mêmes). Et l'ombre peinte ne suivait pas le soleil ;
 * - une couche de **bruit « de détail »** à 8 m puis 45 m de période, qui
 *   constellait le sol de taches de 1 à 2 m à ±30 % de luminosité ;
 * - un **grain** unique, sans motif ni couleur, pour toutes les matières.
 *   Essayé à période fixe, puis à période calée sur l'écran (un texel pour
 *   trois pixels, par échelons de facteur deux). La seconde forme lit toujours
 *   au premier niveau de mip, or c'est le mip qui éteignait le relief au
 *   loin : forcé à zéro partout, il rendait un fourmillement qui suivait
 *   l'observateur, et ses échelons — des anneaux autour de la caméra —
 *   faisaient choisir n'importe quel mip sur la ligne où ils sautent. Revenu à
 *   une période fixe, le spectre corrigé, l'amplitude divisée par trois : il
 *   restait trop marqué ;
 * - le **relief** tiré de ce grain par dérivées d'écran (Mikkelsen, « Bump
 *   Mapping Unparametrized Surfaces on the GPU »). Parti avec lui : un relief
 *   sans relevé d'altitude n'a pas d'échelle verticale propre.
 *
 * Ce qui doit se voir est un **objet de la scène** — un arbre, une falaise,
 * une bordure de trottoir —, jamais un dessin dans une texture. Ne rien
 * réintroduire ici : la question a été tranchée à l'œil, plusieurs fois, et
 * toujours dans le même sens.
 *
 * ## Ce qui reste, en tout et pour tout
 *
 * Un albédo par matière, et une **variation macro** de deux cents mètres en
 * luminosité et en chaleur, qui monte avec la distance — un albédo constant
 * par classe donne l'aplat de carte routière, et c'est la seule chose qui
 * subsiste à voir sur un sol lointain. La pente au-delà de 30° vire à la
 * roche. Une matière s'ajoute en ajoutant une couleur ; celle où l'eau affleure
 * (`standingWater`) y gagne des flaques, découpées par un bruit et rendues comme
 * l'eau — le même bruit, relu côté CPU par `poolShareAt` (`groundClassMap.js`),
 * pour que l'herbe et le sous-bois sachent où elle affleure. Une culture peut
 * porter la même notion sur son propre axe (`cropStandingWater`, `uCropWater`) :
 * c'est la lame d'eau d'une rizière, indépendante de la matière `farmland`
 * qu'elle recouvre.
 *
 * Une matière peut en outre porter des **plaques** d'une seconde couleur
 * (`patch: { albedo, strength }`) — la bruyère en fleur d'une lande —, découpées
 * par le bruit des flaques à une échelle de quelques dizaines de mètres.
 *
 * Cette variation macro n'est pas la même partout (`macro`, `macroNear` de
 * `SURFACE_LOOK`) : un stade tondu n'est pas aussi marbré qu'une tourbière.
 * `macro` multiplie l'amplitude par matière ; `macroNear` relève le plancher
 * de la rampe de distance (`detailNear` → `detailFar`) pour les matières dont
 * le marbrage doit rester visible à portée d'observation — sans lui,
 * l'amplitude est quasi nulle à cent mètres (`far` y vaut 0,03). Les deux sont
 * accumulés par part dans la même boucle que `standingWater`, jamais tranchés
 * sur la matière dominante : un texel à cheval sur deux matières marbre selon
 * leur mélange, pas selon celle qui l'emporte.
 *
 * Trois choses tiennent les **limites** entre surfaces, dont le défaut commun
 * est le carreau de 2,7 m de la carte du sol, lisible en marches d'escalier
 * dès que deux matières contrastent. C'est là que tout se joue : quand une
 * surface est un aplat, ce qu'on regarde est son contour.
 *
 * - le **trait** : la carte arrive avec ses limites déjà redessinées
 *   (`surfaceContours.js`) — chaque texel porte sa distance au trait le plus
 *   proche et la matière d'en face. `surfaceAt` interpole cette distance,
 *   signée par la matière, sur seize texels par une cubique de Catmull-Rom :
 *   elle reproduit exactement un trait droit, et garde continu un filet d'eau
 *   d'un texel qui ne se touche que par les coins. Puis on tranche : la
 *   matière la plus forte l'emporte, sur la largeur d'un pixel d'écran ;
 * - les **segments** : la lecture de la carte est déplacée par `edgeWarp`, un
 *   champ de vecteurs linéaire dans chaque triangle d'un réseau fixe au monde
 *   (`edgeStepM`, `edgeJitterM` du thème). Un trait droit lu à travers lui
 *   reste droit dans chaque triangle et casse à chaque arête : le contour
 *   devient une suite de segments de deux mètres, à quelques décimètres du
 *   tracé. Parce que le déplacement est linéaire par morceaux et appliqué à
 *   un trait déjà dessiné, il casse le trait sans le denteler ; et parce qu'il
 *   déplace la lecture plutôt que le trait, les deux berges d'un ruisseau
 *   bougent ensemble ;
 * - la **rive** : le sol au contact de l'eau est mouillé, du même film d'eau
 *   que la pluie y met (`wetGround`). C'est ce qui fait une berge plutôt
 *   qu'une découpe.
 *
 * Greffé sur `MeshLambertMaterial` via `onBeforeCompile` plutôt qu'écrit en
 * shader complet, pour garder l'éclairage/brouillard/tone mapping de three.
 *
 * ## Le grain low poly, lui, déforme le sommet
 *
 * Ce que la section précédente écarte est un grain **de texture** — un
 * relief lu dans une image, sans échelle verticale propre. `lowPolyGrain.js`
 * est autre chose : un déplacement du sommet du maillage, en mètres réels, et
 * une normale reprise sur cette position déformée. Éteint avec la distance
 * (`uGrainFadeM`) là où la maille n'est plus assez fine pour le porter — voir
 * `lowPolyGrain.js` pour le détail.
 *
 * Cellule et amplitude viennent de la matière au pied du sommet
 * (`grainCellM`/`grainAmplitudeM` de `SURFACE_LOOK`) : une lande porte de
 * petites touffes, un pré alpin des colinettes bien plus larges, un éboulis
 * un jumelage de blocs — une matière qui ne les déclare pas reprend le
 * réglage de repli (`LOW_POLY_GRAIN_DEFAULTS`). L'identifiant est relu au
 * texel le plus proche, sans le lissage de `surfaceAt` : c'est un
 * déplacement géométrique, pas un contour, une marche à la limite de deux
 * matières n'y a pas besoin d'être adoucie. L'herbe (`groundCover.js`) lit la
 * même paire par instance, à l'endroit où elle pousse ; les cultures
 * (`cropLayer.js`) et le mobilier n'existent que sur des matières non
 * branchées ici et suivent le réglage de repli. Les arbres n'en tiennent pas
 * compte.
 *
 * Éteint aussi dans l'emprise routière (`roadMask`, un attribut par sommet
 * écrit par `terrainBubble.js` à partir de `roadCutMaskAt`) : le sommet y a
 * déjà été recreusé au ras de la chaussée (`roadCut.js`), et le grain ne doit
 * pas repousser dessus — sans quoi il recouvrirait la plate-forme qu'on vient
 * d'excaver pour elle.
 */

import { createMacroCanvas } from '../materials/proceduralTextures.js';
import { CROP_KINDS, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import {
  SURFACE_KINDS,
  SURFACE_ID_STEP,
  WATER_ID,
  PAVEMENT_ID,
  CLASS_PIXELS,
  CROP_LABEL_BASE,
  FARMLAND_ID,
  POOL_NOISE_STRETCH,
  POOL_SCALE_RATIO,
  POOL_EDGE_SOFTNESS,
} from './groundClassMap.js';
import { CONTOUR_REACH_TEXELS } from './surfaceContours.js';
import { pavementTone } from '../layers/townStyle.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';
import { LOW_POLY_GRAIN_GLSL, LOW_POLY_GRAIN_DEFAULTS } from './lowPolyGrain.js';
import { soilWashFor, gapSurfaceForMatrix, stoneTintFor } from '../core/regionInterpretation.js';

/** Période du bruit des plaques (`patch` d'une matière), en mètres. */
const PATCH_SCALE_M = 38;

/** Couleur d'une matière qu'un thème ne décrit pas : un gris de terre neutre. */
const FALLBACK_ALBEDO = [0.18, 0.17, 0.15];


/** Fabrique du matériau de terrain. Un seul matériau pour toute la bulle. */
export class TerrainMaterialFactory {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} [options.look] Tranche `terrain` du thème.
   * @param {Object} [options.soils] Tranche `soils` du thème.
   * @param {Object} [options.stones] Tranche `stones` du thème.
   * @param {Object} [options.groundClass] Instance `GroundClassMap`. Absente,
   *        tout le sol prend la matière de repli.
   * @param {Object} [options.streets] Tranche `streets` du thème. Le sol d'une
   *        ville est du trottoir, et sa teinte ne peut pas être décidée deux
   *        fois : la bordure la lit là aussi (`townStyle.pavementTone`).
   */
  constructor({
    THREE,
    look = {},
    soils = null,
    stones = null,
    surfaces = null,
    streets = null,
    groundClass = null,
  }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
    this.soils = soils || defaultTheme.soils;
    this.stones = stones || defaultTheme.stones;
    /** Table des matières du sol, une ligne par matière (`SURFACE_LOOK`). */
    this.surfaces = surfaces || defaultTheme.surfaces;
    this.streets = streets || defaultTheme.streets;
    this.groundClass = groundClass || null;
    /** Matrice et géologie appliquées aux albédos. `null` = aucune correction. */
    this._matrix = null;
    this._stone = null;

    // Bruit et variation (pas de couleur) : espace linéaire.
    const repeated = (canvas) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = 4;
      return texture;
    };

    this.macroTexture = repeated(createMacroCanvas());
    // Sans retournement : `poolShareAt` (groundClassMap.js) relit le même
    // champ côté CPU pour savoir où tombent les flaques, et les deux lectures
    // ne peuvent tomber sur le même texel que si aucune des deux n'inverse
    // l'axe vertical à sa manière.
    this.macroTexture.flipY = false;
    // Rides : la même carte que celle qui servait la nappe d'eau, du temps où
    // l'eau était une surface posée sur le terrain.
    this.waterRippleTexture = repeated(createWaterNormalCanvas());

    this.material = this._create();
    this.setTunnelMouths = installTunnelMouths(THREE, this.material);
  }

  get textures() {
    return [
      this.macroTexture,
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
    this._uniforms.uSurfaceOrigin.value.copy(map.origin);
    this._uniforms.uSurfaceSize.value = map.size;
  }

  setMaxAnisotropy(value) {
    for (const texture of this.textures) {
      texture.anisotropy = Math.min(value || 4, 8);
      texture.needsUpdate = true;
    }
  }

  /**
   * Applique au sol lointain ce que le pays lui fait — le seul endroit où il
   * l'apprend. Deux corrections s'y croisent, sur deux axes :
   *
   * - le **lavage de la matrice** (`soilWashFor`) sur l'herbe, les champs et la
   *   terre nue. Les touffes et les tiges du premier plan lisent le même
   *   facteur : voir `SOIL_LOOK` sur pourquoi c'est un facteur et pas une
   *   palette ;
   * - la **teinte de la géologie** (`stoneTintFor`) sur la roche du socle —
   *   la dalle et l'éboulis, que la pente reprend sur les parois. Une seule
   *   fois : `uRockColor` module la matière déjà teintée et reste neutre. Le mobilier bâti en
   *   pierre lit le même facteur, sans quoi un causse blanc porterait des
   *   murets gris.
   *
   * Les autres couvertures ne bougent pas, une lande dit déjà son pays — sauf
   * une, le revêtement urbain, qui n'est pas une matière relevée mais une
   * convention de pays : le nord coule du béton gris, le Midi pose de la pierre
   * claire, la steppe un enrobé poussiéreux (`townStyle.pavementTone`).
   */
  setRegion(region) {
    const matrix = region?.matrix ?? null;
    const stoneKind = region?.stone ?? null;
    if (!this._uniforms || (matrix === this._matrix && stoneKind === this._stone)) return;
    this._matrix = matrix;
    this._stone = stoneKind;

    // Ce que le pays met là où la carte se tait. C'est la lecture la plus
    // lourde de conséquences du dossier de région : en rase campagne, le
    // vectoriel se tait sur la plus grande part du sol.
    const fill = gapSurfaceForMatrix(matrix) ?? this.look.unclassified;
    this._uniforms.uUnclassified.value = Math.max(0, SURFACE_KINDS.indexOf(fill)) + 1;

    const wash = soilWashFor(this._matrix, this.soils);
    const stone = stoneTintFor(stoneKind, this.stones);
    const scale = (albedo, by) => albedo.map((v, i) => v * by[i]);

    // Une matière déclare le lavage qu'elle prend, ou aucun. C'était quatre
    // affectations nommées, plus un cas particulier pour le trottoir ; c'est
    // maintenant une colonne de la table.
    SURFACE_KINDS.forEach((kind, i) => {
      const look = this.surfaces[kind] || {};
      const uniform = this._uniforms.uSurfaceAlbedo.value[i];
      if (look.wash === 'pavement') {
        uniform.set(...pavementTone(this._matrix, this.streets));
        return;
      }
      const base = look.stone
        ? scale(look.albedo || FALLBACK_ALBEDO, stone)
        : look.albedo || FALLBACK_ALBEDO;
      uniform.set(...(look.wash ? scale(base, wash[look.wash]) : base));
    });

    CROP_KINDS.forEach((kind, i) => {
      const base = this.look.cropAlbedo[kind] || this.surfaces.farmland.albedo;
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

  get grainUniforms() { return this._uniforms; }

  _create() {
    const { THREE, look } = this;
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const uniforms = {
      uDetailRange: { value: new THREE.Vector2(look.detailNear, look.detailFar) },
      // (période en mètres, amplitude en luminosité, dérive chaud/froid).
      uMacroMap: { value: this.macroTexture },
      uMacro: {
        value: new THREE.Vector3(look.macroScaleM, look.macroStrength, look.macroWarmth),
      },
      // Une matière = une couleur. Le tableau est indexé par l'identifiant
      // peint dans la carte, moins un.
      uSurfaceAlbedo: {
        value: SURFACE_KINDS.map(
          (kind) => new THREE.Vector3(...(this.surfaces[kind]?.albedo || FALLBACK_ALBEDO))
        ),
      },
      // Part du sol sous l'eau, par matière, dans l'ordre des identifiants.
      uSurfaceWater: {
        value: SURFACE_KINDS.map((kind) => this.surfaces[kind]?.standingWater ?? 0),
      },
      // Amplitude de la variation macro par matière (1 = comportement neutre)
      // et plancher de sa rampe de distance (0 = éteinte à portée d'un semis).
      uSurfaceMacro: {
        value: SURFACE_KINDS.map((kind) => this.surfaces[kind]?.macro ?? 1),
      },
      uSurfaceMacroNear: {
        value: SURFACE_KINDS.map((kind) => this.surfaces[kind]?.macroNear ?? 0),
      },
      // Plaques d'une seconde couleur dans une matière (`patch`) : la couleur,
      // et dans w sa force (0 = aucune plaque).
      uSurfacePatch: {
        value: SURFACE_KINDS.map((kind) => {
          const patch = this.surfaces[kind]?.patch;
          return new THREE.Vector4(...(patch?.albedo ?? [0, 0, 0]), patch?.strength ?? 0);
        }),
      },
      // Grain low poly par matière (`lowPolyGrain.js`) : une matière que
      // `SURFACE_LOOK` ne couvre pas reprend le réglage de repli.
      uSurfaceGrainCell: {
        value: SURFACE_KINDS.map(
          (kind) => this.surfaces[kind]?.grainCellM ?? LOW_POLY_GRAIN_DEFAULTS.cellM
        ),
      },
      uSurfaceGrainAmplitude: {
        value: SURFACE_KINDS.map(
          (kind) => this.surfaces[kind]?.grainAmplitudeM ?? LOW_POLY_GRAIN_DEFAULTS.amplitudeM
        ),
      },
      uPoolScale: { value: look.poolScaleM },
      // Matière retenue là où la donnée se tait.
      uUnclassified: { value: Math.max(0, SURFACE_KINDS.indexOf(look.unclassified)) + 1 },
      // (côté du réseau triangulaire, amplitude) du déplacement des limites.
      // Un trait droit croise en moyenne une arête du réseau tous les 0,45 côté.
      uEdgeJitter: { value: new THREE.Vector2(look.edgeStepM / 0.4535, look.edgeJitterM) },
      uSurfaceMap: { value: this.groundClass ? this.groundClass.texture : null },
      uSurfaceOrigin: { value: new THREE.Vector2(0, 0) },
      uSurfaceSize: { value: 1 },
      uSurfaceEnabled: { value: this.groundClass ? 1 : 0 },
      uCropAlbedo: {
        value: CROP_KINDS.map(
          (kind) =>
            new THREE.Vector3(...(look.cropAlbedo[kind] || this.surfaces.farmland.albedo))
        ),
      },
      // Lame d'eau par culture, sur le même principe que `uSurfaceWater` mais
      // pour le second axe : zéro partout sauf le riz.
      uCropWater: {
        value: CROP_KINDS.map((kind) => look.cropStandingWater?.[kind] ?? 0),
      },
      // L'eau ne se mélange pas aux autres matières : là où la carte le dit,
      // elle remplace tout — couleur, grain, relief.
      uWaterAlbedo: {
        value: new THREE.Vector3(...(this.surfaces.water?.albedo || [0.02, 0.045, 0.06])),
      },
      uWaterSheenColor: { value: new THREE.Vector3(...look.waterSheenColor) },
      uWaterSheen: { value: look.waterSheen },
      uWaterRipples: { value: this.waterRippleTexture },
      uWaterRipple: { value: new THREE.Vector2(look.waterRippleM, look.waterRippleRelief) },
      /** La rive : part de sol mouillé au contact de l'eau. */
      uShoreWet: { value: look.shoreWet },
      /** Dérive des rides, en cycles. Deux vitesses inégales : sinon on lit un glissement. */
      uWaterFlow: { value: new THREE.Vector2(0, 0) },
      uRockColor: { value: new THREE.Vector3(...look.rockColor) },
      uSlopeRange: { value: new THREE.Vector2(look.slopeStart, look.slopeEnd) },
      uRockStrength: { value: look.rockStrength },
      /**
       * Le grain de la roche des fortes pentes, forcé quelle que soit la
       * matière lue. Une carte du sol est **plane** : une paroi verticale n'y
       * occupe qu'un liseré de quelques texels, que la cubique du contour noie
       * dans ce qui l'entoure, et la matière lue s'y étire en hauteur. La
       * pente, elle, décrit la paroi exactement — c'est déjà par elle que la
       * teinte de roche arrive (`uSlopeRange`), et le grain la suit.
       *
       * L'albédo, lui, n'a pas d'uniforme à part : la roche régionalisée est
       * déjà dans `uSurfaceAlbedo`, et la dupliquer ici la figerait au montage.
       */
      uRockGrain: {
        value: new THREE.Vector2(
          this.surfaces.rock?.grain?.cellM ?? 0,
          this.surfaces.rock?.grain?.amplitudeM ?? 0
        ),
      },
      /** Sol mouillé, de 0 à 1. Piloté par la météo, jamais par le thème. */
      uWetness: { value: 0 },
      // Grain low poly géométrique (`lowPolyGrain.js`) : repli hors carte ou
      // hors matière connue (`uUnclassified`) — `foliageMaterial.js` lit les
      // mêmes valeurs par défaut pour que l'herbe et les cultures suivent.
      uGrainCellM: { value: LOW_POLY_GRAIN_DEFAULTS.cellM },
      uGrainAmplitudeM: { value: LOW_POLY_GRAIN_DEFAULTS.amplitudeM },
      uGrainFadeM: {
        value: new THREE.Vector2(
          LOW_POLY_GRAIN_DEFAULTS.fadeStartM,
          LOW_POLY_GRAIN_DEFAULTS.fadeEndM
        ),
      },
    };
    this._uniforms = uniforms;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vScenePos;
           varying vec3 vSceneNormal;
           varying float vGrain;
           varying float vSteep;
           attribute float roadMask;
           ${TERRAIN_GRAIN_GLSL}`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed = terrainDisplaced(transformed, objectNormal, roadMask, vSteep, vGrain);
           vScenePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vSceneNormal = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vScenePos;
           varying vec3 vSceneNormal;
           varying float vGrain;
           varying float vSteep;
           uniform vec2 uDetailRange;
           uniform sampler2D uMacroMap;
           uniform vec3 uMacro;
           uniform sampler2D uSurfaceMap;
           uniform vec2 uSurfaceOrigin;
           uniform float uSurfaceSize;
           uniform float uSurfaceEnabled;
           uniform float uUnclassified;
           uniform vec2 uEdgeJitter;
           uniform vec3 uCropAlbedo[${CROP_KINDS.length}];
           uniform float uCropWater[${CROP_KINDS.length}];
           uniform vec3 uSurfaceAlbedo[${SURFACE_KINDS.length}];
           uniform float uSurfaceWater[${SURFACE_KINDS.length}];
           uniform float uSurfaceMacro[${SURFACE_KINDS.length}];
           uniform float uSurfaceMacroNear[${SURFACE_KINDS.length}];
           uniform vec4 uSurfacePatch[${SURFACE_KINDS.length}];
           // Part de plaque au fragment, decidee une fois avant de lire le sol.
           float gPatch = 0.0;
           uniform float uPoolScale;
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
           uniform float uShoreWet;
           uniform float uGrainCellM;
           uniform float uGrainAmplitudeM;
           uniform vec2 uGrainFadeM;
           ${LOW_POLY_GRAIN_GLSL}

           /*
            * Sol mouillé : le film d'eau assombrit et sature (réflexions
            * internes dans la pellicule). Deux causes, une seule matière —
            * la pluie (uWetness) et la rive.
            */
           vec3 wetGround(vec3 base, float amount) {
             float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
             vec3 saturated = luma + (base - luma) * 1.35;
             return mix(base, saturated * 0.62, clamp(amount, 0.0, 1.0));
           }

           /*
            * Etiquette d'un texel : sa matiere, ou CROP_BASE + culture pour un
            * champ cultive (voir drawSurfaceContoursSteps). Le repli la ou la
            * donnee se tait.
            */
           float surfaceLabel(vec4 texel) {
             float id = floor(texel.r * 255.0 / ${SURFACE_ID_STEP}.0 + 0.5);
             float crop = floor(texel.g * 255.0 / ${CROP_ID_STEP}.0 + 0.5);
             if (id < 0.5) return uUnclassified;
             return id == ${FARMLAND_ID}.0 && crop > 0.5 ? ${CROP_LABEL_BASE}.0 + crop : id;
           }

           /* Etiquette d'en face portee par l'alpha, -1 si aucun trait n'est a portee. */
           float acrossLabel(vec4 texel) {
             float label = floor(texel.a * 255.0 + 0.5) - 1.0;
             return label == 0.0 ? uUnclassified : label;
           }

           /* Ce qu'une etiquette met au sol. */
           void labelLook(
             float label, out vec3 albedo, out float isWater, out float standing,
             out float macroAmp, out float macroNear
           ) {
             float id = label >= ${CROP_LABEL_BASE}.0 ? ${FARMLAND_ID}.0 : label;
             for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
               if (float(i) == id) {
                 albedo = mix(uSurfaceAlbedo[i - 1], uSurfacePatch[i - 1].rgb, uSurfacePatch[i - 1].a * gPatch);
                 standing = uSurfaceWater[i - 1];
                 macroAmp = uSurfaceMacro[i - 1];
                 macroNear = uSurfaceMacroNear[i - 1];
               }
             }
             // La culture remplace la couleur de la terre labouree et sa lame
             // d'eau, et elles seules.
             for (int i = 0; i < ${CROP_KINDS.length}; i++) {
               if (float(i + 1) == label - ${CROP_LABEL_BASE}.0) {
                 albedo = uCropAlbedo[i];
                 standing = uCropWater[i];
               }
             }
             isWater = id == ${WATER_ID}.0 ? 1.0 : 0.0;
           }

           /*
            * Deplacement de la lecture de la carte, en metres : un vecteur tire
            * au hasard dans un disque a chaque noeud d'un reseau equilateral
            * fixe au monde, interpole lineairement dans chaque triangle. Une
            * limite droite, lue a travers lui, reste droite dans chaque
            * triangle et casse a chaque arete : une suite de segments. Les
            * deux berges d'un ruisseau bougent ensemble, sa largeur reste.
            */
           vec2 edgeNodeValue(vec2 node) {
             uvec2 q = uvec2(ivec2(node) + 65536);
             uint h = q.x * 1597334677u ^ q.y * 3812015801u;
             h ^= h >> 16;
             h *= 2246822519u;
             h ^= h >> 13;
             uint g = h * 3266489917u;
             g ^= g >> 15;
             float angle = float(h >> 8) / 16777216.0 * 6.2831853;
             float radius = sqrt(float(g >> 8) / 16777216.0);
             return radius * vec2(cos(angle), sin(angle));
           }

           vec2 edgeWarp(vec2 p) {
             // Biais du reseau triangulaire (celui du bruit simplexe) ; un
             // pas de 0.8165 dans le repere biaise fait un cote de 1.
             vec2 q = p * (0.81649658 / uEdgeJitter.x);
             q += (q.x + q.y) * 0.36602540;
             vec2 cell = floor(q);
             vec2 f = q - cell;
             vec2 middle = f.x > f.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
             vec3 w = f.x > f.y
               ? vec3(1.0 - f.x, f.x - f.y, f.y)
               : vec3(1.0 - f.y, f.y - f.x, f.x);
             return (w.x * edgeNodeValue(cell)
                   + w.y * edgeNodeValue(cell + middle)
                   + w.z * edgeNodeValue(cell + 1.0)) * uEdgeJitter.y;
           }

           /* Poids de Catmull-Rom entre les deux points du milieu. */
           vec4 splineWeights(float t) {
             float t2 = t * t;
             float t3 = t2 * t;
             return 0.5 * vec4(
               -t3 + 2.0 * t2 - t,
               3.0 * t3 - 5.0 * t2 + 2.0,
               -3.0 * t3 + 4.0 * t2 + t,
               t3 - t2
             );
           }

           vec4 surfaceTexel(vec2 corner, vec2 offset) {
             return texture2D(uSurfaceMap, (corner + offset + 0.5) / ${CLASS_PIXELS}.0);
           }

           /*
            * Distance signee d'une etiquette sur une ligne du voisinage :
            * positive dans les texels de cette etiquette, negative ailleurs.
            */
           float rowScore(float label, vec4 own, vec4 reach, vec4 wx) {
             return dot(wx, mix(-reach, reach, vec4(equal(own, vec4(label)))));
           }

           /*
            * Ce que la carte dit en un point : la couleur du sol, et la part
            * d'eau.
            *
            * Chaque texel porte sa matiere, sa distance au trait le plus
            * proche et la matiere d'en face (surfaceContours.js). La distance,
            * signee par la matiere, s'interpole sur seize texels par une
            * cubique de Catmull-Rom : elle reproduit exactement une fonction
            * lineaire, donc un trait droit, sans rien de la grille ; et
            * contrairement a l'interpolation bilineaire, elle garde continu un
            * filet d'eau d'un texel qui ne se touche que par les coins. Les
            * deux matieres les plus fortes se partagent le point.
            *
            * Le contour est tranche, pas fondu : sur la largeur d'un pixel
            * d'ecran, seule derivee d'ecran du shader.
            *
            * Pas d'accent grave ni d'accent sur les majuscules dans ce bloc :
            * il vit dans un litteral de gabarit.
            */
           void surfaceAt(
             vec2 uv, out vec3 albedo, out float water,
             out float standing, out float macroAmp, out float macroNear
           ) {
             vec2 grid = uv * ${CLASS_PIXELS}.0 - 0.5;
             vec2 corner = floor(grid);
             vec2 f = grid - corner;
             float texelM = uSurfaceSize / ${CLASS_PIXELS}.0;
             float reachM = ${CONTOUR_REACH_TEXELS}.0 * texelM;

             vec4 own[4];
             vec4 reach[4];
             vec4 across = vec4(-1.0);
             for (int j = 0; j < 4; j++) {
               vec4 a = surfaceTexel(corner, vec2(-1.0, float(j - 1)));
               vec4 b = surfaceTexel(corner, vec2(0.0, float(j - 1)));
               vec4 c = surfaceTexel(corner, vec2(1.0, float(j - 1)));
               vec4 d = surfaceTexel(corner, vec2(2.0, float(j - 1)));
               own[j] = vec4(surfaceLabel(a), surfaceLabel(b), surfaceLabel(c), surfaceLabel(d));
               reach[j] = vec4(a.b, b.b, c.b, d.b) * reachM;
               if (j == 1) { across.x = acrossLabel(b); across.y = acrossLabel(c); }
               if (j == 2) { across.z = acrossLabel(b); across.w = acrossLabel(c); }
             }
             vec4 wx = splineWeights(f.x);
             vec4 wz = splineWeights(f.y);

             // Les deux etiquettes de plus forte distance signee, parmi celles
             // du carre central et celles d'en face : une matiere qui n'est
             // que dans l'anneau exterieur n'est pas ici, elle est a cote.
             float first = -1.0;
             float firstScore = -1e6;
             float second = -1.0;
             float secondScore = -1e6;
             for (int k = 0; k < 8; k++) {
               float label = k < 2 ? own[1][k + 1] : k < 4 ? own[2][k - 1] : across[k - 4];
               if (label < 0.0 || label == first || label == second) continue;
               float score = wz.x * rowScore(label, own[0], reach[0], wx)
                           + wz.y * rowScore(label, own[1], reach[1], wx)
                           + wz.z * rowScore(label, own[2], reach[2], wx)
                           + wz.w * rowScore(label, own[3], reach[3], wx);
               if (score > firstScore) {
                 second = first;
                 secondScore = firstScore;
                 first = label;
                 firstScore = score;
               } else if (score > secondScore) {
                 second = label;
                 secondScore = score;
               }
             }

             float isWater;
             labelLook(first, albedo, isWater, standing, macroAmp, macroNear);
             water = isWater;
             if (second < 0.0) return;

             vec3 albedoB;
             float isWaterB, standingB, macroAmpB, macroNearB;
             labelLook(second, albedoB, isWaterB, standingB, macroAmpB, macroNearB);
             float edge = 0.5 * (firstScore - secondScore);
             float keep = smoothstep(-1.0, 1.0, edge / clamp(0.5 * fwidth(edge), 0.005, 0.5 * texelM));

             // L'eau est tenue hors du melange : elle ne se teinte pas, elle
             // remplace le sol, reprise plus bas avec sa rive. Ce qui n'est
             // pas de l'eau garde la couleur de la terre seule.
             water = mix(isWaterB, isWater, keep);
             float landA = keep * (1.0 - isWater);
             float landB = (1.0 - keep) * (1.0 - isWaterB);
             if (landA + landB < 1e-4) { landA = keep; landB = 1.0 - keep; }
             float land = landA + landB;
             albedo = (albedo * landA + albedoB * landB) / land;
             standing = (standing * landA + standingB * landB) / land;
             macroAmp = (macroAmp * landA + macroAmpB * landB) / land;
             macroNear = (macroNear * landA + macroNearB * landB) / land;
           }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           // Hors du bloc : la part d'eau est decidee ici et relue plus bas,
           // dans la perturbation de normale — la ride de l'eau est le seul
           // relief qui reste au sol.
           float gWater = 0.0;
           {
             // La carte porte un identifiant de matiere par texel, et celui de
             // la culture dans le canal voisin. Lue a l'endroit exact : c'est
             // l'interpolation de surfaceAt qui donne sa forme au contour, et
             // rien ne deplace plus la lecture.
             vec2 surfaceUv = (vScenePos.xz - uSurfaceOrigin) / uSurfaceSize;
             // Hors du carre couvert, la texture est bornee au bord : lire
             // quand meme y etalerait la lisiere sur des kilometres.
             float inMap = uSurfaceEnabled > 0.5 &&
                 surfaceUv.x > 0.0 && surfaceUv.x < 1.0 &&
                 surfaceUv.y > 0.0 && surfaceUv.y < 1.0 ? 1.0 : 0.0;

             // Distance a l'observateur, ramenee sur [0, 1] : elle fait monter
             // la variation macro, et elle seule.
             float dist = distance(vScenePos, cameraPosition);
             float far = smoothstep(uDetailRange.x, uDetailRange.y, dist);

             // Bruit macro : deux cents metres de periode. Il fait deriver la
             // couleur d'un bout a l'autre d'une parcelle — et c'est, le sol
             // n'ayant plus ni motif ni grain, la seule chose qui reste a voir
             // sur un sol lointain.
             float macro = texture2D(uMacroMap, vScenePos.xz / uMacro.x).r;

             // Les plaques : deux lectures du meme bruit a des echelles
             // incommensurables, axes permutes, comme les flaques.
             gPatch = smoothstep(0.46, 0.52, 0.5 + ${POOL_NOISE_STRETCH} * (
               texture2D(uMacroMap, vScenePos.xz / ${PATCH_SCALE_M}.0).r -
               texture2D(uMacroMap, vScenePos.zx / ${Math.round(PATCH_SCALE_M * 1.7)}.0).r
             ));

             // Tout le sol en un appel : la couleur, et la part d'eau.
             vec3 albedo = uSurfaceAlbedo[${SURFACE_KINDS.indexOf('grass')}];
             float standing = 0.0;
             float macroAmp = 1.0;
             float macroNear = 0.0;
             if (inMap > 0.5) {
               // Lue a travers le deplacement des limites (edgeWarp) : c'est lui qui
               // casse le trait en segments.
               surfaceAt(
                 surfaceUv + edgeWarp(vScenePos.xz) / uSurfaceSize,
                 albedo, gWater, standing, macroAmp, macroNear
               );
             } else {
               // Hors carte : la matiere de repli.
               for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
                 if (float(i) == uUnclassified) {
                   albedo = mix(uSurfaceAlbedo[i - 1], uSurfacePatch[i - 1].rgb, uSurfacePatch[i - 1].a * gPatch);
                   standing = uSurfaceWater[i - 1];
                   macroAmp = uSurfaceMacro[i - 1];
                   macroNear = uSurfaceMacroNear[i - 1];
                 }
               }
             }

             // Les flaques d'un sol ou l'eau affleure. Le bruit est la
             // difference de deux lectures a des echelles incommensurables,
             // axes permutes : symetrique autour de 0.5, et sans periode
             // lisible. Etire de 1.25, la part mouillee suit la part demandee
             // a six points pres entre 5 et 90 %. Tranche la, la flaque prend
             // le rendu de l'eau et sa rive.
             if (standing > 0.001) {
               float poolNoise = 0.5 + ${POOL_NOISE_STRETCH} * (
                 texture2D(uMacroMap, vScenePos.xz / uPoolScale).r -
                 texture2D(uMacroMap, vScenePos.zx / (uPoolScale * ${POOL_SCALE_RATIO})).r
               );
               float poolEdge = 1.0 - standing;
               float pool = smoothstep(poolEdge - ${POOL_EDGE_SOFTNESS}, poolEdge + ${POOL_EDGE_SOFTNESS}, poolNoise);
               gWater += (1.0 - gWater) * pool;
             }

             // Il ne reste plus rien a moduler qu'a l'echelle du paysage : une
             // surface est une couleur.
             vec3 modulation = vec3(1.0);

             // Variation macro. Centree sur 1 : elle etale la luminosite sans
             // la deplacer, et fait deriver la teinte vers le chaud dans les
             // zones claires. Elle monte **avec la distance**, et c'est une
             // contrainte : les touffes instanciees ne la connaissent pas,
             // donc a portee de semis le sol doit rester la couleur sur
             // laquelle elles sont calees.
             //
             // macroNear releve ce plancher pour une matiere donnee : sans
             // lui, far vaut 0,03 a cent metres et la variation y est deja
             // eteinte. macroAmp multiplie l'amplitude elle-meme — un stade
             // tondu n'a pas a etre aussi marbre qu'une tourbiere.
             float macroSigned = (macro - 0.5) * max(far, macroNear) * macroAmp;
             modulation *= (1.0 + macroSigned * uMacro.y) *
               vec3(1.0 + macroSigned * uMacro.z, 1.0, 1.0 - macroSigned * uMacro.z);

             // Pas d'accent grave dans ce bloc : litteral de gabarit.
             vec3 base = albedo * modulation;

             // La roche des fortes pentes, en deux temps. D'abord la matière
             // elle-meme : multiplier une herbe par un gris ne donne pas de la
             // roche, ca donne une herbe sombre — et c'est ce qu'on lisait sur
             // une paroi, la carte plane n'ayant pu y poser que de l'herbe
             // etiree. La pente, elle, decrit la paroi.
             float rock = vSteep * uRockStrength * (1.0 - gWater);
             // Pas d'accent grave ici : literal de gabarit. La roche du
             // socle, telle que setRegion l'a deja teintee par la geologie du
             // pays : un uniforme a part serait fige au montage, et rendrait
             // la meme falaise du calcaire au granite.
             base = mix(base, uSurfaceAlbedo[${SURFACE_KINDS.indexOf('rock')}], rock);
             // Puis la teinte, qui module ce que la matiere a donne.
             base = mix(base, base * uRockColor, rock);

             // Pluie : le sol se mouille. Sans objet sur l'eau elle-même.
             if (uWetness > 0.0) base = wetGround(base, uWetness * (1.0 - gWater));

             // La rive. Le sol au contact de l'eau est trempé, et c'est ce
             // qui fait une berge plutôt qu'une découpe : l'eau n'arrive pas
             // sur du sable sec ou de l'herbe sèche, elle arrive sur ce
             // qu'elle vient de quitter. Aucune couleur de plus, donc — la
             // même matière, mouillée d'autant plus que le bord approche.
             //
             // La bande vit dans la rampe de gWater : elle monte à
             // l'approche de l'eau et s'éteint sous elle, là où il ne reste
             // plus de sol à voir. Elle ne tient donc qu'un carreau — la
             // laisse de mer d'une grande plage, qui court sur des dizaines
             // de mètres, demanderait une distance à l'eau que la carte ne
             // porte pas.
             float shore =
               smoothstep(0.0, 0.35, gWater) * (1.0 - smoothstep(0.4, 0.9, gWater)) * uShoreWet;
             if (shore > 0.0) base = wetGround(base, shore);

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
             // Grain low poly : normale plate tirée des dérivées d'écran de
             // la position déjà bosselée (voir <begin_vertex>), mélangée à la
             // normale analytique. Là où la position a été bosselée, celle-ci
             // décrit la surface d'avant la bosse et rendrait un versant lisse
             // sous un relief qui, lui, ondule — les dérivées d'écran rendent
             // la facette réellement dessinée. vGrain (amplitude déjà
             // multipliée par le fondu de distance et l'emprise routière côté
             // sommet) fait le partage : nulle, la bosse ne s'est pas produite
             // et les dérivées ne rendraient que le facettage de la maille du
             // terrain — c'est la normale analytique qui vaut.
             vec3 worldNormal = vSceneNormal;
             if (vGrain > 0.0) {
               float grainFade = lowPolyFade(vScenePos, cameraPosition, uGrainFadeM.x, uGrainFadeM.y);
               vec3 flatNormal = normalize(cross(dFdx(vScenePos), dFdy(vScenePos)));
               if (dot(flatNormal, vSceneNormal) < 0.0) flatNormal = -flatNormal;
               worldNormal = normalize(mix(vSceneNormal, flatNormal, grainFade));
             }
             vec3 a = texture2D(uWaterRipples, vScenePos.xz / uWaterRipple.x + uWaterFlow).xyz * 2.0 - 1.0;
             vec3 b = texture2D(uWaterRipples, vScenePos.zx / (uWaterRipple.x * 0.6) - uWaterFlow * 1.7).xyz * 2.0 - 1.0;
             vec3 wavy = normalize(worldNormal + vec3(a.x + b.x, 0.0, a.z + b.z) * uWaterRipple.y);

             normal = normalize((viewMatrix * vec4(mix(worldNormal, wavy, gWater), 0.0)).xyz);
           }`
        );
    };

    // Clé constante pour éviter une recompilation à chaque matériau.
    material.customProgramCacheKey = () => 'terrain-bubble-v19-cliff-grain';
    return material;
  }

  dispose() {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
