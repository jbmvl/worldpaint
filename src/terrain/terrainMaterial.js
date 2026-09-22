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
 * Deux choses tiennent les **limites** entre surfaces, dont le défaut commun
 * est le carreau de 2,7 m de la carte du sol, lisible en marches d'escalier
 * dès que deux matières contrastent. C'est là que tout se joue : quand une
 * surface est un aplat, ce qu'on regarde est son contour.
 *
 * - le **contour est interpolé, puis tranché** (`surfaceAt`). Ce qui
 *   s'interpole est l'appartenance de chaque texel à une matière — un ou zéro,
 *   un identifiant ne s'interpolant pas —, sur seize texels et par une cubique
 *   de Catmull-Rom : le champ est C¹, donc son contour n'a plus d'angle. Sur
 *   quatre texels, un lissage bilinéaire n'a pas cette propriété et ses
 *   cassures retombent sur la grille. Puis on tranche : la matière la plus
 *   forte l'emporte, sur la largeur d'un pixel d'écran, sans dégradé. Ce que
 *   l'interpolation ne redresse pas, c'est l'ondulation d'un quart de texel
 *   autour du tracé réel : la carte ne dit pas où passe le polygone dans un
 *   texel, et aucun noyau ne l'invente ;
 * - la **rive** : le sol au contact de l'eau est mouillé, du même film d'eau
 *   que la pluie y met (`wetGround`). C'est ce qui fait une berge plutôt
 *   qu'une découpe.
 *
 * Ont été essayés et retirés, parce qu'ils travaillaient à côté du défaut : un
 * **bruit de lisière** qui déplaçait la lecture du sol de quelques mètres et
 * repondérait les matières voisines par son grain. Le contour y gagnait une
 * dentelure, jamais une courbe, et les deux mécanismes s'annulaient dans le
 * filtrage dès que leur champ passait sous le pixel. Le contour ne se brouille
 * pas, il se dessine.
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
  POOL_NOISE_STRETCH,
  POOL_SCALE_RATIO,
  POOL_EDGE_SOFTNESS,
} from './groundClassMap.js';
import { pavementTone } from '../layers/townStyle.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';
import { LOW_POLY_GRAIN_GLSL, LOW_POLY_GRAIN_DEFAULTS } from './lowPolyGrain.js';
import { soilWashFor, surfaceForMatrix, stoneTintFor } from '../core/regionInterpretation.js';

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
    /** Matrice appliquée aux albédos. `null` = aucune correction. */
    this._matrix = null;

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
   *   celle qui affleure en pente, la dalle et l'éboulis. Le mobilier bâti en
   *   pierre lit le même facteur, sans quoi un causse blanc porterait des
   *   murets gris.
   *
   * Les autres couvertures ne bougent pas, une lande dit déjà son pays — sauf
   * une, le revêtement urbain, qui n'est pas une matière relevée mais une
   * convention de pays : le nord coule du béton gris, le Midi pose de la pierre
   * claire, la steppe un enrobé poussiéreux. Elle est lue à la même source que
   * la bordure de trottoir.
   */
  setRegion(region) {
    const matrix = region?.matrix ?? null;
    if (!this._uniforms || matrix === this._matrix) return;
    this._matrix = matrix;

    // Ce que le pays met là où la carte se tait. C'est la lecture la plus
    // lourde de conséquences du dossier de région : en rase campagne, le
    // vectoriel se tait sur la plus grande part du sol.
    const fill = surfaceForMatrix(matrix) ?? this.look.unclassified;
    this._uniforms.uUnclassified.value = Math.max(0, SURFACE_KINDS.indexOf(fill)) + 1;

    const wash = soilWashFor(this._matrix, this.soils);
    const stone = stoneTintFor(region?.stone ?? null, this.stones);
    const scale = (albedo, by) => albedo.map((v, i) => v * by[i]);

    // La roche qui perce les fortes pentes : même géologie que la dalle et
    // l'éboulis d'à côté, donc même facteur.
    this._uniforms.uRockColor.value.set(...scale(this.look.rockColor, stone));

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
           uniform float uGrainCellM;
           uniform float uGrainAmplitudeM;
           uniform vec2 uGrainFadeM;
           uniform sampler2D uSurfaceMap;
           uniform vec2 uSurfaceOrigin;
           uniform float uSurfaceSize;
           uniform float uSurfaceEnabled;
           uniform float uUnclassified;
           uniform float uSurfaceGrainCell[${SURFACE_KINDS.length}];
           uniform float uSurfaceGrainAmplitude[${SURFACE_KINDS.length}];
           uniform vec2 uSlopeRange;
           uniform vec2 uRockGrain;
           attribute float roadMask;
           ${LOW_POLY_GRAIN_GLSL}

           /* Identifiant de matière au texel le plus proche — pas de lissage :
            * le grain est un déplacement géométrique, pas un contour, une
            * marche d'un texel à la limite de deux matières ne s'y voit pas
            * comme elle le ferait sur un aplat de couleur. textureLod et non
            * texture2D : au sommet il n'y a pas de dérivée, donc pas de niveau
            * implicite — three réécrit texture2D en texture, que GLSL ES 3.00
            * refuse dans cette étape. La carte n'a de toute façon qu'un seul
            * niveau (pas de mipmap). */
           float grainSurfaceIdAt(vec2 uv) {
             vec2 texel = floor(uv * ${CLASS_PIXELS}.0);
             float id = floor(
               textureLod(uSurfaceMap, (texel + 0.5) / ${CLASS_PIXELS}.0, 0.0).r * 255.0
                 / ${SURFACE_ID_STEP}.0 + 0.5
             );
             return id < 0.5 ? uUnclassified : id;
           }`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // Grain low poly : la matière est lue au pied du sommet, au texel
           // le plus proche — pas de lissage, le grain est un déplacement
           // géométrique, et la cubique du fragment ne sert qu'au tracé du
           // contour.
           vec3 grainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           // Le grain s'éteint dans l'emprise routière (roadMask, écrit par
           // terrainBubble.js à partir de roadCutMaskAt) : le sommet y a déjà
           // été recreusé pour la chaussée, il n'y repousse pas dessus.
           float grainFade =
             lowPolyFade(grainPos, cameraPosition, uGrainFadeM.x, uGrainFadeM.y) * (1.0 - roadMask);

           // La cellule et l'amplitude viennent de la matière au pied du
           // sommet, comme l'albédo — hors carte ou hors carreau, celle du
           // repli (uUnclassified), jamais un réglage neutre à part.
           float grainId = uUnclassified;
           if (uSurfaceEnabled > 0.5) {
             vec2 grainUv = (grainPos.xz - uSurfaceOrigin) / uSurfaceSize;
             if (grainUv.x > 0.0 && grainUv.x < 1.0 && grainUv.y > 0.0 && grainUv.y < 1.0) {
               grainId = grainSurfaceIdAt(grainUv);
             }
           }
           float grainCellM = uGrainCellM;
           float grainAmplitudeM = uGrainAmplitudeM;
           for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
             if (float(i) == grainId) {
               grainCellM = uSurfaceGrainCell[i - 1];
               grainAmplitudeM = uSurfaceGrainAmplitude[i - 1];
             }
           }

           // Une paroi est de la roche, quoi qu'en dise la carte : la pente
           // la décrit là où la carte plane ne le peut pas. Même intervalle
           // que la teinte de roche du fragment, pour que la couleur et le
           // relief arrivent ensemble.
           vec3 grainNormal = normalize(mat3(modelMatrix) * objectNormal);
           vSteep = smoothstep(uSlopeRange.x, uSlopeRange.y, 1.0 - clamp(grainNormal.y, 0.0, 1.0));
           grainCellM = mix(grainCellM, uRockGrain.x, vSteep);
           grainAmplitudeM = mix(grainAmplitudeM, uRockGrain.y, vSteep);

           // Pas d'accent grave ici : literal de gabarit. Le plan du bruit se
           // choisit dans le repere de la position locale, la pente dans celui
           // de la scene : deux normales, deux reperes.
           vec3 grainAxis = normalize(objectNormal);
           transformed += grainAxis * lowPolyBump(transformed, grainAxis, grainCellM, grainAmplitudeM) * grainFade;
           vGrain = grainAmplitudeM * grainFade;

           vScenePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vSceneNormal = grainNormal;`
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
           uniform vec3 uCropAlbedo[${CROP_KINDS.length}];
           uniform float uCropWater[${CROP_KINDS.length}];
           uniform vec3 uSurfaceAlbedo[${SURFACE_KINDS.length}];
           uniform float uSurfaceWater[${SURFACE_KINDS.length}];
           uniform float uSurfaceMacro[${SURFACE_KINDS.length}];
           uniform float uSurfaceMacroNear[${SURFACE_KINDS.length}];
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
            * Identifiant de matière porté par un texel, ou celui du repli là
            * où la donnée se tait.
            */
           float surfaceIdAt(vec2 texel) {
             float id = floor(
               texture2D(uSurfaceMap, (texel + 0.5) / ${CLASS_PIXELS}.0).r * 255.0
                 / ${SURFACE_ID_STEP}.0 + 0.5
             );
             return id < 0.5 ? uUnclassified : id;
           }

           /* Les quatre texels d'une ligne du voisinage, dans l'ordre des poids. */
           vec4 surfaceRow(vec2 corner, float row) {
             return vec4(
               surfaceIdAt(corner + vec2(-1.0, row)),
               surfaceIdAt(corner + vec2(0.0, row)),
               surfaceIdAt(corner + vec2(1.0, row)),
               surfaceIdAt(corner + vec2(2.0, row))
             );
           }

           /*
            * Poids d'une cubique de Catmull-Rom pour une position entre les
            * deux points du milieu. Interpolante, et c'est ce qui la fait
            * preferer a une B-spline : au centre d'un texel elle rend sa
            * valeur exacte, donc un ruisseau ou un sentier large d'un seul
            * texel survit. Une approximante les effacerait.
            */
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

           /*
            * Part d'une matiere dans le voisinage : son appartenance texel par
            * texel — un ou zero —, pesee par les seize poids de la spline.
            */
           float splineShare(
             float id, vec4 r0, vec4 r1, vec4 r2, vec4 r3, vec4 wx, vec4 wz
           ) {
             return wz.x * dot(step(abs(r0 - id), vec4(0.5)), wx)
                  + wz.y * dot(step(abs(r1 - id), vec4(0.5)), wx)
                  + wz.z * dot(step(abs(r2 - id), vec4(0.5)), wx)
                  + wz.w * dot(step(abs(r3 - id), vec4(0.5)), wx);
           }

           /*
            * Ce que la carte dit en un point : la couleur du sol, et la part
            * d'eau.
            *
            * Une matiere est un **identifiant**, relu au plus proche : sans
            * quoi l'interpolation inventerait une matiere entre deux, et entre
            * le sable et l'eau il n'y a rien. Ce qui s'interpole est
            * l'**appartenance** — chaque texel est d'une matiere ou d'une
            * autre, et ce sont ces un et ces zero qu'on lisse.
            *
            * Sur quatre texels, ce lissage est bilineaire : sa derivee saute a
            * chaque bord de texel, et le contour qui en sort est une ligne
            * brisee, dont les cassures retombent sur la grille. Sur seize, par
            * une cubique, le champ est C1 : le contour n'a plus d'angle, c'est
            * une courbe continue.
            *
            * Ce qu'il ne fait pas, et qu'aucun filtre ne peut faire : redresser
            * le trait. La carte ne dit pas ou passe le polygone dans un texel,
            * donc le contour ondule d'environ un quart de texel autour de sa
            * vraie place, quel que soit le noyau. Ce qui disparait est l'angle
            * droit, pas l'ondulation. Un noyau approximant (B-spline) la
            * reduirait d'un tiers, mais effacerait au passage un texel isole,
            * et c'est ce qui l'a fait ecarter.
            *
            * C'est le seul mecanisme de lisiere : ni bruit, ni deplacement de
            * la lecture, ni degrade entre deux couleurs.
            *
            * Le contour est **tranche**, pas fondu : on ne garde que la
            * matiere la plus forte, sur la largeur d'un pixel d'ecran. C'est
            * la seule derivee d'ecran du shader et elle ne fourmille pas — le
            * champ sous elle est lisse et fixe dans le monde, elle ne fait
            * qu'en donner l'epaisseur du trait. Sans elle, le contour
            * crenellerait au loin, ou il faudrait le fondre sur des metres.
            *
            * L'eau est tenue a part : elle ne se melange pas, elle remplace.
            *
            * Limite assumee : le contour ne peut pas retrouver la position du
            * polygone **dans** un texel. Ce qui disparait ici est la forme de
            * la grille, pas son pas.
            *
            * Pas d'accent grave ni d'accent sur les majuscules dans ce bloc :
            * il vit dans un litteral de gabarit.
            */
           void surfaceAt(
             vec2 uv, vec3 farmAlbedo, float cropWater, out vec3 albedo, out float water,
             out float standing, out float macroAmp, out float macroNear
           ) {
             vec2 grid = uv * ${CLASS_PIXELS}.0 - 0.5;
             vec2 corner = floor(grid);
             vec2 f = grid - corner;

             vec4 r0 = surfaceRow(corner, -1.0);
             vec4 r1 = surfaceRow(corner, 0.0);
             vec4 r2 = surfaceRow(corner, 1.0);
             vec4 r3 = surfaceRow(corner, 2.0);
             vec4 wx = splineWeights(f.x);
             vec4 wz = splineWeights(f.y);

             // Les candidats sont les quatre matieres du carre central : une
             // matiere qui n'est que dans l'anneau exterieur n'est pas ici,
             // elle est a cote.
             vec4 ids = vec4(r1.y, r1.z, r2.y, r2.z);
             vec4 share = vec4(
               splineShare(ids.x, r0, r1, r2, r3, wx, wz),
               splineShare(ids.y, r0, r1, r2, r3, wx, wz),
               splineShare(ids.z, r0, r1, r2, r3, wx, wz),
               splineShare(ids.w, r0, r1, r2, r3, wx, wz)
             );

             // L'epaisseur du trait : un pixel d'ecran, mesure en texels. Le
             // plancher garde un raccord de quelques centimetres au pied de
             // l'observateur, le plafond empeche un texel entier de se fondre
             // quand la carte passe sous le pixel.
             float aa = clamp(max(fwidth(grid.x), fwidth(grid.y)), 0.04, 1.0);
             float peak = max(max(share.x, share.y), max(share.z, share.w));
             vec4 lifted = smoothstep(-aa, 0.0, share - peak);
             lifted /= max(lifted.x + lifted.y + lifted.z + lifted.w, 1e-4);

             // L'eau est tenue hors du melange, et les parts sont rapportees a
             // ce qui n'est **pas** de l'eau. Elle n'est pas une matiere de
             // plus mais une surface qui remplace le sol, reprise plus bas avec
             // sa rive : peindre sa couleur ici ferait aller la berge d'une eau
             // texturee vers une eau lisse au lieu d'aller de la terre a l'eau.
             // Et sans le rapport, une plage se denaturerait en gravier a
             // l'approche de la mer, faute de sable dans les texels mouilles.
             water = dot(step(abs(ids - ${WATER_ID}.0), vec4(0.5)), lifted);
             float land = max(1.0 - water, 1e-4);

             albedo = vec3(0.0);
             standing = 0.0;
             macroAmp = 0.0;
             macroNear = 0.0;
             for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
               if (i != ${WATER_ID}) {
                 vec4 hit = step(abs(ids - float(i)), vec4(0.5));
                 float share = dot(hit, lifted) / land;
                 // La culture remplace la couleur de la terre labouree, et elle
                 // seule : c'est un second axe, pas une matiere de plus. La
                 // lame d'eau du riz suit la meme substitution : farmland ne
                 // porte pas d'eau propre, donc la remplacer ne perd rien.
                 bool isFarmland = i == ${SURFACE_KINDS.indexOf('farmland') + 1};
                 vec3 tone = isFarmland ? farmAlbedo : uSurfaceAlbedo[i - 1];
                 albedo += tone * share;
                 standing += (isFarmland ? cropWater : uSurfaceWater[i - 1]) * share;
                 macroAmp += uSurfaceMacro[i - 1] * share;
                 macroNear += uSurfaceMacroNear[i - 1] * share;
               }
             }
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

             // La culture : un second axe, qui remplace la couleur de la terre
             // labouree la ou il est peint. Lu au plus proche, d'ou l'arrondi
             // et non un seuil — une valeur interpolee n'aurait aucun sens.
             // L'indexation passe par une boucle a bornes constantes, seule
             // forme d'acces a un tableau d'uniformes que toutes les versions
             // de GLSL acceptent.
             vec3 farmAlbedo = uSurfaceAlbedo[${SURFACE_KINDS.indexOf('farmland')}];
             // Lame d'eau d'une culture — le riz, et lui seul aujourd'hui —
             // zero partout ou une matiere n'a pas encore ete peinte de riz.
             // Meme substitution que l'albedo, meme boucle : un axe de plus
             // dans le meme tableau d'uniformes, pas un canal de plus.
             float cropWater = 0.0;
             if (inMap > 0.5) {
               int crop = int(
                 floor(texture2D(uSurfaceMap, surfaceUv).g * 255.0 / ${CROP_ID_STEP}.0 + 0.5)
               ) - 1;
               for (int i = 0; i < ${CROP_KINDS.length}; i++) {
                 if (i == crop) {
                   farmAlbedo = uCropAlbedo[i];
                   cropWater = uCropWater[i];
                 }
               }
             }

             // Tout le sol en un appel : la couleur, et la part d'eau. C'etaient
             // trois mecanismes — un melange de quatre poids, une boucle de
             // couvertures, une substitution de culture — pour une seule
             // question.
             vec3 albedo = uSurfaceAlbedo[${SURFACE_KINDS.indexOf('grass')}];
             float standing = 0.0;
             float macroAmp = 1.0;
             float macroNear = 0.0;
             if (inMap > 0.5) {
               surfaceAt(surfaceUv, farmAlbedo, cropWater, albedo, gWater, standing, macroAmp, macroNear);
             } else {
               // Hors carte : la matiere de repli.
               for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
                 if (float(i) == uUnclassified) {
                   albedo = uSurfaceAlbedo[i - 1];
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
