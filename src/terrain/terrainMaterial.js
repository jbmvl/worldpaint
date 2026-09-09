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
 * albédo. La pente au-delà de 30° vire à la roche.
 *
 * ## Le grain se règle en pixels d'écran, pas en mètres
 *
 * Une période fixe en mètres a un seul bon point de vue, et se trompe partout
 * ailleurs : trop grosse au ras du sol, où l'on voit la trame de la carte ;
 * noyée dans le mip à dix mètres, où la route redevient un plastique lisse.
 * `grainAt` renverse donc le réglage — on dit combien de **pixels d'écran**
 * doit couvrir un texel (`grainPixels`), et la période en mètres s'en déduit
 * par fragment. La période saute par échelons de facteur deux, avec un fondu
 * entre voisins : dans un échelon elle est constante, donc le grain reste
 * accroché au sol au lieu de glisser sous les pas. `grainScaleM` n'est plus
 * la finesse du grain mais l'ancrage de cette échelle.
 *
 * Le corollaire compte autant : la carte de grain n'est plus lue au même
 * endroit selon la distance, donc **rien qui doive tenir en place ne peut la
 * lire ainsi**. `edgeWarp`, qui place les limites de parcelles, garde sa
 * période fixe pour cette raison.
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
  SURFACE_KINDS,
  SURFACE_ID_STEP,
  WATER_ID,
  PAVEMENT_ID,
  CLASS_PIXELS,
} from './groundClassMap.js';
import { pavementTone } from '../layers/townStyle.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';
import { soilWashFor } from '../core/climate.js';

/** Couleur d'une matière qu'un thème ne décrit pas : un gris de terre neutre. */
const FALLBACK_ALBEDO = [0.18, 0.17, 0.15];

/**
 * Côté du relevé de grain, en texels. Le shader en a besoin : c'est lui qui
 * convertit « tant de pixels d'écran par texel » en une période en mètres.
 * D'où la constante ici plutôt que le défaut de `createGrainCanvas`, pour que
 * les deux ne puissent pas diverger.
 */
const GRAIN_TEXELS = 512;

/**
 * Anisotropie garantie de la carte de grain. Le shader s'en sert comme d'un
 * budget : une empreinte de pixel deux fois plus longue que large est encore
 * rattrapée par le filtrage, on peut donc lire plus fin que son grand côté.
 * `setMaxAnisotropy` peut la monter ; il ne faut pas la descendre.
 */
const GRAIN_ANISOTROPY = 4;

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
  constructor({ THREE, look = {}, soils = null, surfaces = null, streets = null, groundClass = null }) {
    this.THREE = THREE;
    this.look = { ...defaultTheme.terrain, ...look };
    this.soils = soils || defaultTheme.soils;
    /** Table des matières du sol, une ligne par matière (`SURFACE_LOOK`). */
    this.surfaces = surfaces || defaultTheme.surfaces;
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
      texture.anisotropy = GRAIN_ANISOTROPY;
      return texture;
    };

    this.detailTexture = repeated(createDetailCanvas());
    this.macroTexture = repeated(createMacroCanvas());
    // Un seul grain pour toutes les matières : ses trois canaux portent trois
    // champs indépendants, lus d'un coup (voir `createGrainCanvas`).
    this.grainTexture = repeated(createGrainCanvas(GRAIN_TEXELS));
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
    const wash = soilWashFor(this._climate, this.soils);
    const scale = (albedo, by) => albedo.map((v, i) => v * by[i]);

    // Une matière déclare le lavage qu'elle prend, ou aucun. C'était quatre
    // affectations nommées, plus un cas particulier pour le trottoir ; c'est
    // maintenant une colonne de la table.
    SURFACE_KINDS.forEach((kind, i) => {
      const look = this.surfaces[kind] || {};
      const uniform = this._uniforms.uSurfaceAlbedo.value[i];
      if (look.climate === 'pavement') {
        uniform.set(...pavementTone(this._climate, this.streets));
        return;
      }
      const base = look.albedo || FALLBACK_ALBEDO;
      uniform.set(...(look.climate ? scale(base, wash[look.climate]) : base));
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
      uDetailMap: { value: this.detailTexture },
      uDetailScale: { value: new THREE.Vector2(look.detailScaleNear, look.detailScaleFar) },
      uDetailRange: { value: new THREE.Vector2(look.detailNear, look.detailFar) },
      uGrainMap: { value: this.grainTexture },
      uGrainScale: { value: look.grainScaleM },
      // Combien de pixels d'écran doit couvrir un texel de grain. C'est ce
      // réglage-là, et plus la période en mètres, qui décide de la finesse
      // qu'on voit ; la période s'en déduit par fragment (voir `grainAt`).
      uGrainPixels: { value: look.grainPixels },
      // (période en mètres, amplitude en luminosité, dérive chaud/froid).
      uMacroMap: { value: this.macroTexture },
      uMacro: {
        value: new THREE.Vector3(look.macroScaleM, look.macroStrength, look.macroWarmth),
      },
      uBlendWidth: { value: look.blendWidth },
      uGrainRelief: { value: look.grainRelief },
      // Une matière = une couleur. Le tableau est indexé par l'identifiant
      // peint dans la carte, moins un.
      uSurfaceAlbedo: {
        value: SURFACE_KINDS.map(
          (kind) => new THREE.Vector3(...(this.surfaces[kind]?.albedo || FALLBACK_ALBEDO))
        ),
      },
      // Lequel des trois champs de la carte de grain chaque matière emploie,
      // sous forme de sélecteur : le produit scalaire en tire le bon canal sans
      // indexer un vecteur par une variable, ce que toutes les versions de GLSL
      // n'acceptent pas.
      uSurfaceGrain: {
        value: SURFACE_KINDS.map((kind) => {
          const field = Math.min(2, Math.max(0, Math.round(this.surfaces[kind]?.grain ?? 0)));
          return new THREE.Vector3(field === 0 ? 1 : 0, field === 1 ? 1 : 0, field === 2 ? 1 : 0);
        }),
      },
      // Part du grain qu'une matière conserve, de 0 (aplat) à 1. Une seule s'en
      // écarte : le trottoir, qui est une dalle et pas une terre plus grise.
      uSurfaceGrainKeep: {
        value: SURFACE_KINDS.map((kind) => this.surfaces[kind]?.grainKeep ?? 1),
      },
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
           uniform float uGrainPixels;
           uniform sampler2D uMacroMap;
           uniform vec3 uMacro;
           uniform float uBlendWidth;
           uniform float uGrainRelief;
           uniform sampler2D uSurfaceMap;
           uniform vec2 uSurfaceOrigin;
           uniform float uSurfaceSize;
           uniform float uSurfaceEnabled;
           uniform float uUnclassified;
           uniform vec3 uCropAlbedo[${CROP_KINDS.length}];
           uniform vec3 uSurfaceAlbedo[${SURFACE_KINDS.length}];
           uniform vec3 uSurfaceGrain[${SURFACE_KINDS.length}];
           uniform float uSurfaceGrainKeep[${SURFACE_KINDS.length}];
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

           /*
            * Le grain, lu a une periode choisie pour l'ecran.
            *
            * Une periode fixe en metres ne peut pas convenir. A 1,2 cm par
            * texel le grain vaut quelques pixels a trois metres et il est
            * deja noye dans le mip a dix : la route redevient lisse
            * exactement la ou on la regarde, et la trame de la carte se lit
            * au premier plan. On choisit donc la periode par fragment, pour
            * qu'un texel couvre toujours a peu pres uGrainPixels pixels
            * d'ecran, quelle que soit la distance.
            *
            * Elle ne varie pas continument mais par echelons de facteur deux,
            * ancres sur uGrainScale, avec un fondu entre deux echelons
            * voisins. Dans un echelon la periode est constante en metres,
            * donc le grain reste accroche au sol ; une periode strictement
            * continue le ferait glisser sous les pas. Cout : deux lectures au
            * lieu d'une, la ou le chantier precedent en avait rendu six.
            *
            * L'empreinte d'un pixel n'est pas un carre : sur une route vue de
            * bout elle est longue dans l'axe du regard. Se caler sur son grand
            * cote eteindrait le grain precisement dans ce cas ; on se cale sur
            * le petit, dans la limite de l'anisotropie que la carte porte,
            * qui est ce que le filtrage sait rattraper.
            *
            * Consequence assumee : la lisiere entre deux matieres, dont la
            * dentelure est decoupee dans ce grain, se redessine plus fine
            * quand on s'approche. Elle reste au meme endroit au metre pres —
            * c'est edgeWarp qui la place, et lui lit la carte a une periode
            * fixe, sans quoi une parcelle changerait de forme avec le regard.
            *
            * Bornes : hors de [-2, 6] echelons, soit 1,5 m a 384 m de
            * periode, on retombe sur une periode fixe. En haut c'est du sol
            * lointain, ou le grain s'efface de toute facon ; en bas c'est le
            * nez colle au sol, ou l'agrandir encore ne montrerait que du
            * flou d'interpolation.
            */
           vec3 grainAt(vec2 world) {
             vec2 fw = fwidth(world);
             float span = max(max(fw.x, fw.y), 1e-6);
             float px = max(min(fw.x, fw.y), span / ${GRAIN_ANISOTROPY}.0);
             float level = clamp(
               log2(px * uGrainPixels * ${GRAIN_TEXELS}.0 / uGrainScale), -2.0, 6.0
             );
             float rung = floor(level);
             vec2 uv = world / (uGrainScale * exp2(rung));
             return mix(
               texture2D(uGrainMap, uv).rgb,
               texture2D(uGrainMap, uv * 0.5).rgb,
               level - rung
             );
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

           /*
            * Ce que la carte dit en un point : la couleur du sol, son grain,
            * ce qu'il en reste, et la part d'eau.
            *
            * Une matière est un **identifiant**, relu au plus proche : sans
            * quoi l'interpolation inventerait une matière entre deux, et entre
            * le sable et l'eau il n'y a rien. Mais un contour qui suit le texel
            * de 2,7 m se lit en escalier. On interpole donc le **resultat du
            * test**, pas l'identifiant : les quatre texels voisins sont lus au
            * plus proche, chacun est d'une matière ou d'une autre, et ce sont
            * ces appartenances qu'on mélange. Le sable arrive sur l'herbe par
            * une rampe d'un texel, et la berge de même.
            *
            * Ce mécanisme servait les seules couvertures, la carte des poids
            * fondant les quatre autres matières par son filtrage lineaire.
            * Depuis qu'il n'y a plus qu'une carte d'identifiants, il est le cas
            * general — et il porte du meme coup l'interpenetration : chaque
            * voisin est repondere par la hauteur du grain de **sa** matiere,
            * puis on ne garde que ce qui reste dans uBlendWidth du plus fort.
            * La lisiere suit alors la forme du grain au lieu d'etre un degrade.
            *
            * D'ou les trois champs de grain : deux matieres qui partagent le
            * leur ont un facteur commun, qui s'annule a la normalisation, et
            * leur lisiere retombe sur le fondu lineaire. La table les repartit
            * pour que ce cas soit rare (voir SURFACE_LOOK).
            *
            * L'eau est tenue a part : elle ne se melange pas, elle remplace.
            *
            * Limite assumee : le contour passe par les centres des texels. Il
            * ne retrouve pas la position du polygone **dans** un texel. Ce qui
            * disparait ici est la marche d'escalier, pas le pas de la carte.
            *
            * Pas d'accent grave ni d'accent sur les majuscules dans ce bloc :
            * il vit dans un litteral de gabarit.
            */
           void surfaceAt(
             vec2 uv, vec3 grain, float far, vec3 farmAlbedo,
             out vec3 albedo, out float grainHere, out float grainKeep, out float water
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
               surfaceIdAt(corner),
               surfaceIdAt(corner + vec2(1.0, 0.0)),
               surfaceIdAt(corner + vec2(0.0, 1.0)),
               surfaceIdAt(corner + vec2(1.0, 1.0))
             );

             // Premiere passe : la hauteur du grain de chaque voisin.
             vec4 height = vec4(0.0);
             for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
               vec4 hit = step(abs(ids - float(i)), vec4(0.5));
               height += hit * dot(grain, uSurfaceGrain[i - 1]);
             }

             // Interpenetration. Au loin, la carte est plus fine que le pixel :
             // trancher la-bas ferait crepiter la lisiere d'une image a
             // l'autre, on y revient donc au fondu doux.
             vec4 lifted = weight * (0.35 + height);
             float peak = max(max(lifted.x, lifted.y), max(lifted.z, lifted.w));
             lifted = max(lifted - (peak - uBlendWidth), 0.0);
             lifted = mix(lifted / max(lifted.x + lifted.y + lifted.z + lifted.w, 1e-4), weight, far);

             // Seconde passe : la couleur, le grain retenu, l'eau.
             //
             // L'eau est tenue hors du melange, et les parts sont rapportees a
             // ce qui n'est **pas** de l'eau. Elle n'est pas une matiere de
             // plus mais une surface qui remplace le sol, reprise plus bas avec
             // sa rive : peindre sa couleur ici, avant ce fondu, ferait aller
             // la berge d'une eau grainee vers une eau lisse au lieu d'aller de
             // la terre a l'eau. Et sans le rapport, une plage se denaturerait
             // en gravier a l'approche de la mer, faute de sable dans les
             // texels mouilles.
             water = dot(step(abs(ids - ${WATER_ID}.0), vec4(0.5)), lifted);
             float land = max(1.0 - water, 1e-4);

             albedo = vec3(0.0);
             grainHere = 0.0;
             grainKeep = 0.0;
             for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
               if (i != ${WATER_ID}) {
                 vec4 hit = step(abs(ids - float(i)), vec4(0.5));
                 float share = dot(hit, lifted) / land;
                 // La culture remplace la couleur de la terre labouree, et elle
                 // seule : c'est un second axe, pas une matiere de plus.
                 vec3 tone = i == ${SURFACE_KINDS.indexOf('farmland') + 1}
                   ? farmAlbedo
                   : uSurfaceAlbedo[i - 1];
                 albedo += tone * share;
                 grainKeep += uSurfaceGrainKeep[i - 1] * share;
                 grainHere += dot(hit, lifted * height) / land;
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
             // La carte porte un identifiant de matiere par texel, et celui de
             // la culture dans le canal voisin. Lue a la frange (voir
             // edgeWarp) : le deplacement vaut pour les deux canaux, qui sont
             // ceux du meme texel.
             vec2 surfaceUv = (vScenePos.xz + edgeWarp(vScenePos.xz) - uSurfaceOrigin) / uSurfaceSize;
             // Hors du carre couvert, la texture est bornee au bord : lire
             // quand meme y etalerait la lisiere sur des kilometres.
             float inMap = uSurfaceEnabled > 0.5 &&
                 surfaceUv.x > 0.0 && surfaceUv.x < 1.0 &&
                 surfaceUv.y > 0.0 && surfaceUv.y < 1.0 ? 1.0 : 0.0;

             float dist = distance(vScenePos, cameraPosition);
             float far = smoothstep(uDetailRange.x, uDetailRange.y, dist);
             float near = texture2D(uDetailMap, vScenePos.xz / uDetailScale.x).r;
             float coarse = texture2D(uDetailMap, vScenePos.xz / uDetailScale.y).r;
             float noise = mix(near, coarse, far);

             // Bruit macro : deux cents metres de periode. Il fait deriver la
             // couleur d'un bout a l'autre d'une parcelle — et c'est, depuis
             // que les textures ne portent plus de motif, la seule chose qui
             // reste a voir sur un sol lointain.
             float macro = texture2D(uMacroMap, vScenePos.xz / uMacro.x).r;

             // Le grain : trois champs independants, a la periode que
             // l'ecran demande (voir grainAt). Il ne porte aucune couleur —
             // l'albedo la porte seul — il module la luminosite, incline la
             // normale, et decoupe la dentelure des lisieres.
             vec3 grain = grainAt(vScenePos.xz);

             // La culture : un second axe, qui remplace la couleur de la terre
             // labouree la ou il est peint. Lu au plus proche, d'ou l'arrondi
             // et non un seuil — une valeur interpolee n'aurait aucun sens.
             // L'indexation passe par une boucle a bornes constantes, seule
             // forme d'acces a un tableau d'uniformes que toutes les versions
             // de GLSL acceptent.
             vec3 farmAlbedo = uSurfaceAlbedo[${SURFACE_KINDS.indexOf('farmland')}];
             if (inMap > 0.5) {
               int crop = int(
                 floor(texture2D(uSurfaceMap, surfaceUv).g * 255.0 / ${CROP_ID_STEP}.0 + 0.5)
               ) - 1;
               for (int i = 0; i < ${CROP_KINDS.length}; i++) {
                 if (i == crop) farmAlbedo = uCropAlbedo[i];
               }
             }

             // Tout le sol en un appel : la couleur, le grain de la matiere,
             // ce qu'elle en garde, et la part d'eau. C'etaient trois
             // mecanismes — un melange de quatre poids, une boucle de
             // couvertures, une substitution de culture — pour une seule
             // question.
             vec3 albedo = uSurfaceAlbedo[${SURFACE_KINDS.indexOf('grass')}];
             float structure = 0.5;
             float grainKeep = 1.0;
             if (inMap > 0.5) {
               surfaceAt(surfaceUv, grain, far, farmAlbedo, albedo, structure, grainKeep, gWater);
             } else {
               // Hors carte : la matiere de repli, avec le grain de son champ.
               for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
                 if (float(i) == uUnclassified) {
                   albedo = uSurfaceAlbedo[i - 1];
                   structure = dot(grain, uSurfaceGrain[i - 1]);
                 }
               }
             }

             // Le grain s'efface avec la distance. Scalaire, et c'est le fond
             // du chantier precedent : une texture de sol ne teinte plus rien.
             float texMod = mix(structure * 2.0, 1.0, far);
             vec3 modulation = vec3(texMod) * (0.7 + noise * 0.6);

             // Variation macro. Centree sur 1 : elle etale la luminosite sans
             // la deplacer, et fait deriver la teinte vers le chaud dans les
             // zones claires. Elle monte **avec la distance**, et c'est une
             // contrainte : les touffes instanciees ne la connaissent pas,
             // donc a portee de semis le sol doit rester la couleur sur
             // laquelle elles sont calees.
             float macroSigned = (macro - 0.5) * far;
             modulation *= (1.0 + macroSigned * uMacro.y) *
               vec3(1.0 + macroSigned * uMacro.z, 1.0, 1.0 - macroSigned * uMacro.z);

             // Une matiere peut assourdir le grain, et une seule le fait : le
             // trottoir. Le sol d'une ville n'est pas une terre plus grise,
             // c'est une dalle — elle garde quelque chose du grain du bitume
             // voisin, en plus sourd, sinon elle serait un aplat au milieu
             // d'une rue grainee.
             modulation = mix(vec3(1.0), modulation, grainKeep);
             structure = mix(0.5, structure, grainKeep);

             // Apres cela seulement le grain est definitif, et c'est lui que
             // lit la perturbation de normale, plus bas dans le shader de
             // three. Pas d'accent grave dans ce bloc : litteral de gabarit.
             grainHeight = structure;

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
