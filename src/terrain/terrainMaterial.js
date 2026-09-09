/*
 * terrainMaterial — la matière du sol. `groundClassMap` rasterise l'occupation
 * du sol autour de l'observateur ; ce shader y lit la part d'herbe, de bois,
 * de culture et de sol nu, et compose la matière correspondante.
 *
 * ## Une matière = une couleur, plus un grain
 *
 * C'est la règle du module, et elle a été chèrement acquise. **La couleur
 * d'une matière vient de son albédo, et de lui seul ; le grain ne porte
 * aucune teinte.** Il y avait trois textures de sol qui, elles, en portaient
 * une — un vert d'herbe, un brun de limon, une litière — et qui dessinaient
 * en plus des objets : des brins, des cailloux avec leur ombre peinte, des
 * feuilles mortes. Trois défauts tenaient ensemble là-dedans :
 *
 * - un objet de trois centimètres passe sous le pixel d'écran vers trente
 *   mètres ; au-delà il ne restait de ces motifs que le pavage de leur
 *   période, qu'il fallait ensuite masquer (deux relevés décalés par matière,
 *   technique d'Íñigo Quílez : six lectures de texture par pixel, dépensées à
 *   cacher un défaut que les motifs créaient eux-mêmes) ;
 * - l'ombre des cailloux était peinte dans la texture, donc figée : elle ne
 *   suivait pas le soleil ;
 * - une matière sans texture propre ne pouvait qu'emprunter celle d'une
 *   autre. Sable, lande, éboulis et trottoir avaient tous le grain du limon
 *   labouré, à la teinte près — et la teinte est le seul levier qui restait
 *   pour les distinguer, alors que ce n'est pas elle qui les sépare.
 *
 * Ce qui doit se voir de loin est un **objet de la scène** — un arbre, une
 * falaise —, pas un dessin dans une texture. Ne pas réintroduire de motif ici.
 *
 * Reste donc un seul relevé de grain, sans motif ni couleur
 * (`createGrainCanvas`), et une matière s'ajoute désormais en ajoutant un
 * albédo. Le grain change d'échelle avec la distance (période fine près,
 * octave large loin). La pente au-delà de 30° vire à la roche.
 *
 * Trois choses sortent le sol de l'aplat, et elles tiennent ensemble :
 *
 * - le grain **incline la normale** (dérivées d'écran, Mikkelsen) : sans ça
 *   un sol reste une peinture. Aucun relevé de plus, et l'effet s'éteint au
 *   loin où le mip a lissé ;
 * - **deux matières s'interpénètrent** au lieu de se fondre : les poids sont
 *   repondérés par la hauteur du grain puis seuillés (`blendWidth`). Un
 *   mélange linéaire donne une bande dégradée de cinq mètres, une aquarelle.
 *   C'est ce mécanisme qui impose **trois champs de grain** et non un seul :
 *   un grain commun serait un facteur commun, qui s'annule à la
 *   normalisation. Ils tiennent dans les trois canaux d'une seule lecture ;
 * - une **variation macro** de deux cents mètres en luminosité et en chaleur,
 *   qui monte avec la distance — un albédo constant par classe est ce qui
 *   donne l'aplat de carte routière, et le grain, au mètre, n'y peut rien.
 *   Depuis que les textures ne dessinent plus rien, c'est la seule structure
 *   qui subsiste sur un sol lointain.
 *
 * Une couverture peut en outre **assourdir** le grain (`uCoverGrain`), et une
 * seule le fait : le revêtement urbain. Le sol d'une ville n'est pas une terre
 * plus grise, c'est une dalle — elle garde quelque chose du grain du bitume
 * voisin, en plus sourd. Sa couleur ne vient pas d'ici mais de la voirie
 * (`townStyle.pavementTone`), pour qu'une bordure de trottoir et le sol qu'elle
 * borde ne puissent pas diverger.
 *
 * Et trois choses tiennent les **limites** entre surfaces, dont le défaut
 * commun était le carreau de 2,7 m des cartes du sol, lisible en marches
 * d'escalier dès que deux matières contrastent :
 *
 * - la **frange** (`edgeWarp`) : le sol est lu quelques mètres à côté, d'un
 *   déplacement continu tiré de deux canaux du grain, lus d'un coup. La limite
 *   reste où elle est, au mètre près, mais perd l'angle droit du carreau ;
 * - les **couvertures s'interpolent** (`surfaceAt`) : un identifiant ne se
 *   mélange pas, mais l'appartenance à une couverture, si. Les quatre
 *   carreaux voisins sont lus au plus proche et ce sont leurs appartenances
 *   qu'on mélange — le sable rejoint l'herbe par une rampe, comme les
 *   matières le font déjà par le filtrage linéaire de leur carte ;
 * - la **rive** : le sol au contact de l'eau est mouillé, du même film d'eau
 *   que la pluie y met (`wetGround`). C'est ce qui fait une berge plutôt
 *   qu'une découpe.
 *
 * Greffé sur `MeshLambertMaterial` via `onBeforeCompile` plutôt qu'écrit en
 * shader complet, pour garder l'éclairage/brouillard/tone mapping de three.
 */

import {
  createDetailCanvas,
  createGrainCanvas,
  createMacroCanvas,
} from '../materials/proceduralTextures.js';
import { CROP_KINDS, CROP_ID_STEP } from '../layers/furniturePlacement.js';
import {
  COVER_KINDS,
  COVER_ID_STEP,
  WATER_COVER_ID,
  PAVEMENT_COVER_ID,
  CLASS_PIXELS,
} from './groundClassMap.js';
import { pavementTone } from '../layers/townStyle.js';
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
   * @param {Object} [options.streets] Tranche `streets` du thème. Le sol d'une
   *        ville est du trottoir, et sa teinte ne peut pas être décidée deux
   *        fois : la bordure la lit là aussi (`townStyle.pavementTone`).
   */
  constructor({ THREE, look = {}, soils = null, streets = null, groundClass = null }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
    this.soils = soils || defaultTheme.soils;
    this.streets = streets || defaultTheme.streets;
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
    // Un seul grain pour toutes les matières : ses trois canaux portent trois
    // champs indépendants, lus d'un coup (voir `createGrainCanvas`).
    this.grainTexture = repeated(createGrainCanvas());
    // Rides : la même carte que celle qui servait la nappe d'eau, du temps où
    // l'eau était une surface posée sur le terrain.
    this.waterRippleTexture = repeated(createWaterNormalCanvas());

    this.material = this._create();
  }

  get textures() {
    return [
      this.detailTexture,
      this.macroTexture,
      this.grainTexture,
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
   * pas, une lande dit déjà son pays — sauf une, le revêtement urbain, qui
   * n'est pas une matière relevée mais une convention de pays : le nord coule
   * du béton gris, le Midi pose de la pierre claire, la steppe un enrobé
   * poussiéreux. Elle est lue à la même source que la bordure de trottoir.
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
    this._uniforms.uCoverAlbedo.value[PAVEMENT_COVER_ID - 1].set(
      ...pavementTone(this._climate, this.streets)
    );
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
      uGrainMap: { value: this.grainTexture },
      uGrainScale: { value: look.grainScaleM },
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
      // Le revêtement urbain n'a pas d'albédo dans `coverAlbedo` et n'en aura
      // pas : il vient de la voirie, par climat (`setClimate`). Posé ici aussi,
      // parce que `setClimate` ne fait rien tant que la famille n'a pas changé
      // — et au montage elle vaut déjà `null`.
      uCoverAlbedo: {
        value: COVER_KINDS.map((kind) =>
          kind === 'pavement'
            ? new THREE.Vector3(...pavementTone(null, this.streets))
            : new THREE.Vector3(...((look.coverAlbedo || {})[kind] || look.grassAlbedo))
        ),
      },
      // Force du grain d'une couverture, de 0 (aplat) à 1 (le grain du sol
      // qu'elle remplace). Une seule s'en écarte : le revêtement urbain.
      uCoverGrain: {
        value: COVER_KINDS.map((kind) =>
          kind === 'pavement' ? (this.streets.pavementGrain ?? 1) : 1
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
      /** La rive : part de sol mouillé au contact de l'eau. */
      uShoreWet: { value: look.shoreWet },
      /** La frange : (amplitude du déplacement, période du bruit), en mètres. */
      uEdgeWarp: { value: new THREE.Vector2(look.edgeWarpM, look.edgeWarpScaleM) },
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
           uniform sampler2D uGrainMap;
           uniform float uGrainScale;
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
           uniform float uCoverGrain[${COVER_KINDS.length}];
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
           uniform vec2 uEdgeWarp;

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
            * Déplacement du point de lecture du sol, en mètres — la frange.
            *
            * Les deux cartes du sol ont un pas de 2,7 m, et une limite lue à
            * l'endroit exact est donc celle du carreau : l'escalier à 45°
            * qu'on voit entre le sable et l'herbe, ou au bord de l'eau. Lire
            * quelques mètres à côté, d'un déplacement continu tiré du grain à
            * une période bien plus large, garde la limite à sa place au mètre
            * près et lui retire son angle droit.
            *
            * Deux canaux du grain, lus d'un coup : la carte de grain range
            * trois champs indépendants dans R, G et B. C'était deux relevés
            * décalés du même bruit gris, du temps où il n'y avait pas de bruit
            * à plusieurs canaux. Pas d'accent grave ici : ce commentaire vit
            * dans un littéral de gabarit, qu'il refermerait.
            *
            * Conséquence assumée : ce qui lit ces cartes au sol (l'herbe, la
            * végétation) ne connaît pas ce déplacement. La peinture et les
            * touffes ne suivent donc pas la même limite au mètre près — elles
            * la brouillent chacune de leur côté, sur la même largeur.
            */
           vec2 edgeWarp(vec2 world) {
             vec2 shift = texture2D(uGrainMap, world / uEdgeWarp.y).rg;
             return (shift - 0.5) * 2.0 * uEdgeWarp.x;
           }

           /* Identifiant de couverture porté par un carreau (0 = aucune). */
           float coverIdAt(vec2 texel) {
             vec4 fine = texture2D(uCropMap, (texel + 0.5) / ${CLASS_PIXELS}.0);
             return floor(fine.g * 255.0 / ${COVER_ID_STEP}.0 + 0.5);
           }

           /*
            * Ce que la carte des couvertures dit en un point : la couleur de
            * couverture, la part de sol qu'elle couvre, et la part d'eau.
            *
            * Une couverture est un **identifiant** peint dans un canal : il se
            * relit au plus proche, sans quoi l'interpolation inventerait une
            * matière entre deux (entre le sable et l'eau, il n'y a rien).
            * D'où le défaut : le contour d'une couverture suivait le carreau
            * de la carte — deux mètres et demi de côté — et se lisait comme un
            * escalier, alors que les lisières des matières, elles, sont
            * filtrées linéairement et se fondent.
            *
            * On interpole donc le **résultat du test**, pas l'identifiant :
            * les quatre carreaux voisins sont lus au plus proche, chacun est
            * d'une couverture ou d'une autre, et ce sont ces appartenances
            * qu'on mélange. Le sable arrive alors sur l'herbe par une rampe
            * d'un carreau, de la largeur du fondu que la carte des matières a
            * déjà — et la berge de même.
            *
            * L'eau est tenue à part de la part de couverture, et la part de
            * couverture est rapportée à ce qui n'est **pas** de l'eau : sinon
            * une plage se dénaturerait en gravier à l'approche de la mer,
            * faute de sable dans les carreaux mouillés.
            *
            * Limite assumée : le contour passe par les centres des carreaux.
            * Il ne retrouve pas la position du polygone **dans** un carreau —
            * il faudrait pour cela une carte peinte avec son antialiasing. Ce
            * qui disparaît ici est la marche d'escalier, pas le pas de la carte.
            */
           void surfaceAt(
             vec2 uv, out vec3 coverAlbedo, out float coverShare, out float coverGrain, out float water
           ) {
             vec2 grid = uv * ${CLASS_PIXELS}.0 - 0.5;
             vec2 corner = floor(grid);
             vec2 f = grid - corner;
             vec4 weight = vec4(
               (1.0 - f.x) * (1.0 - f.y),
               f.x * (1.0 - f.y),
               (1.0 - f.x) * f.y,
               f.x * f.y
             );
             vec4 ids = vec4(
               coverIdAt(corner),
               coverIdAt(corner + vec2(1.0, 0.0)),
               coverIdAt(corner + vec2(0.0, 1.0)),
               coverIdAt(corner + vec2(1.0, 1.0))
             );

             vec4 wet = step(abs(ids - ${WATER_COVER_ID}.0), vec4(0.5));
             water = dot(wet, weight);
             float land = max(1.0 - water, 1e-4);

             coverAlbedo = vec3(0.0);
             coverShare = 0.0;
             coverGrain = 0.0;
             for (int i = 1; i <= ${COVER_KINDS.length}; i++) {
               if (i != ${WATER_COVER_ID}) {
                 vec4 hit = step(abs(ids - float(i)), vec4(0.5)) * weight;
                 float share = (hit.x + hit.y + hit.z + hit.w) / land;
                 coverShare += share;
                 coverAlbedo += uCoverAlbedo[i - 1] * share;
                 // Le grain d'une couverture, mélangé comme sa couleur : une
                 // dalle de trottoir a le grain du bitume en plus sourd, une
                 // lande a celui de la terre entier.
                 coverGrain += uCoverGrain[i - 1] * share;
               }
             }
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
             // Lue à la frange (voir edgeWarp) : le déplacement vaut pour
             // les deux cartes, sans quoi la matière et la couverture d'un
             // même point ne parleraient plus du même endroit.
             vec2 classUv = (vScenePos.xz + edgeWarp(vScenePos.xz) - uClassOrigin) / uClassSize;
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

             // Bruit macro : deux cents mètres de période. Il fait dériver la
             // couleur d'un bout à l'autre d'une parcelle — et c'est, depuis
             // que les textures ne portent plus de motif, la seule chose qui
             // reste à voir sur un sol lointain.
             float macro = texture2D(uMacroMap, vScenePos.xz / uMacro.x).r;

             // Le grain, en une lecture : trois champs indépendants, un par
             // matière. Il ne porte aucune couleur — l'albédo la porte seul —
             // il module la luminosité et incline la normale.
             vec3 grain = texture2D(uGrainMap, vScenePos.xz / uGrainScale).rgb;

             // Interpénétration des matières. Chaque matière porte sa propre
             // « hauteur » de grain, c'est-à-dire ce qui dépasse. On repondère
             // les poids par elle, puis on ne garde que ce qui reste dans
             // uBlendWidth du plus fort. La lisière suit alors la forme du
             // grain au lieu d'être un dégradé, et une matière minoritaire
             // disparaît franchement au lieu de teinter l'autre de moitié.
             //
             // Trois champs distincts, et c'est la raison d'être des trois
             // canaux : un grain commun serait un facteur commun, qui
             // s'annulerait à la normalisation deux lignes plus bas. Le sol nu
             // partage celui de la culture, comme il partageait sa texture.
             vec4 height = vec4(grain.r, grain.g, grain.b, grain.b);
             vec4 lifted = w * (0.35 + height);
             float peak = max(max(lifted.x, lifted.y), max(lifted.z, lifted.w));
             lifted = max(lifted - (peak - uBlendWidth), 0.0);
             // Au loin, la carte de classes est plus fine que le pixel :
             // trancher là-bas ferait crépiter la lisière d'une image à
             // l'autre. On y revient donc au fondu doux.
             w = mix(lifted / max(lifted.x + lifted.y + lifted.z + lifted.w, 1e-4), w, far);

             // Le grain retenu : celui des matières effectivement présentes.
             // Scalaire, et c'est le fond de ce chantier — une texture de sol
             // ne teinte plus rien. La couleur vient de l'albédo de la matière,
             // qui est la seule chose qui se lise encore à cent mètres.
             float structure = dot(height, w);
             // Le grain s'efface avec la distance.
             float texMod = mix(structure * 2.0, 1.0, far);
             vec3 modulation = vec3(texMod) * (0.7 + noise * 0.6);

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
               // Sa part est **interpolée** (voir surfaceAt) : deux
               // couvertures voisines, ou une couverture et le sol ordinaire,
               // se rejoignent sur une rampe d'un carreau au lieu de se
               // couper au carreau. C'est la limite herbe/sable qui se lisait
               // en marches d'escalier.
               //
               // L'eau est écartée de ce mélange : elle n'est pas une matière
               // de plus mais une surface qui remplace le sol, et elle est
               // reprise plus bas avec sa rive. La laisser ici peindrait le
               // sol en couleur d'eau **avant** ce fondu, et la berge irait
               // d'une eau grainée vers une eau lisse au lieu d'aller de la
               // terre à l'eau.
               vec3 coverAlbedo;
               float coverShare;
               float coverGrain;
               surfaceAt(classUv, coverAlbedo, coverShare, coverGrain, gWater);
               grassAlbedo = mix(grassAlbedo, coverAlbedo, coverShare);
               bareAlbedo = mix(bareAlbedo, coverAlbedo, coverShare);

               // Une couverture peut aussi **assourdir** le grain, et une seule
               // le fait : le revêtement urbain. Le sol d'une ville n'est pas
               // une terre plus grise, c'est une dalle — elle garde le grain du
               // bitume voisin, en plus faible, sinon le trottoir serait un
               // aplat au milieu d'une rue grainée. La modulation se ramène
               // vers le neutre, et le relief de grain avec elle.
               float grainKeep = mix(1.0, coverGrain, coverShare);
               modulation = mix(vec3(1.0), modulation, grainKeep);
               structure = mix(0.5, structure, grainKeep);
             }

             // Après les couvertures : c'est là seulement que la structure du
             // grain est définitive (le revêtement urbain l'assourdit), et
             // c'est elle que lit la perturbation de normale, plus bas dans le
             // shader de three. Pas d'accent grave dans ce commentaire : il
             // vit dans un littéral de gabarit, qu'il refermerait.
             grainHeight = structure;

             vec3 albedo =
               grassAlbedo * w.x +
               uWoodAlbedo * w.y +
               farmAlbedo * w.z +
               bareAlbedo * w.w;

             vec3 base = albedo * modulation;

             float slope = 1.0 - clamp(vSceneNormal.y, 0.0, 1.0);
             float rock = smoothstep(uSlopeRange.x, uSlopeRange.y, slope) * uRockStrength * (1.0 - gWater);
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
