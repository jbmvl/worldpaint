import { InstanceCells } from './instanceCells.js';
import { COVER_ATTRIBUTE, installCoverTransition, paddedCoverBands } from '../materials/coverTransition.js';
/*
 * Les cultures lisent l'assolement de la carte du sol. Chaque bande possède
 * un semis ancré au sol, chargé au-delà de sa portée visible. La transition
 * est évaluée à chaque image par le matériau, sans changer la hauteur ou
 * tirer à nouveau la présence à mesure que le cycliste avance.
 */

import {
  makeRandom,
  createCropAtlasCanvas,
  CROP_ATLAS_COLS,
  CROP_ATLAS_OFFSETS,
  CROP_VARIANTS,
} from '../materials/proceduralTextures.js';
import {
  createFoliageMaterial,
  createCrossedQuads,
  advanceFoliageWind,
  setFoliageWind,
  ATLAS_ATTRIBUTE,
} from '../materials/foliageMaterial.js';
import { defaultTheme } from '../themes/default.js';
import { soilWashFor } from '../core/regionInterpretation.js';
import { CORRIDOR_MARGIN_M, inCorridor } from './roadCorridor.js';
import {
  coverBand,
  coverBandRing,
  coverBandFade,
  coverBandDistance,
  coverHeightFade,
  coverMassDensity,
  coverBandsRadius,
} from './coverBands.js';

/**
 * Les trois échelles d'un champ.
 *
 * La bande 0 reprend exactement le semis d'origine — maille de 1,6 m, neuf
 * tirages —, les deux suivantes agrègent. `rise` y est plus retenu que pour
 * l'herbe : un maïs fait déjà deux mètres et demi, et le rehausser autant qu'une
 * touffe en ferait un mur.
 *
 * `massBias` l'est aussi, et pour la même raison. Une culture dont la densité
 * est basse l'est parce que sa case d'atlas contient déjà plusieurs pieds
 * (quatre maïs contre vingt-six tiges de blé) : la relever comme on relève une
 * prairie à demi verte redonnait au maïs un mur opaque à cinquante mètres,
 * c'est-à-dire exactement ce que `CROP_LOOK` avait réglé pour l'éviter. Le blé,
 * déjà à `density: 1`, n'est pas concerné — c'est lui qui dimensionne le
 * plafond.
 *
 * Ce sont des budgets et des règles de composition, donc du moteur et non du
 * thème (voir `CONTRIBUTING.md`). Ce qui reste au thème, c'est ce que porte le
 * champ : hauteur, largeur, densité et teinte par culture (`CROP_LOOK`).
 */

/**
 * Élargissement commun aux deux bandes de masse.
 *
 * Il était de 2,4 puis 4,5, et c'était le défaut le plus visible du champ
 * lointain : la case d'atlas est **carrée**, donc étirée d'autant sur le
 * panneau — un capitule de tournesol y devenait une galette quatre fois plus
 * large que haute. Une seule valeur pour les deux bandes permet de dessiner la
 * masse une fois pour l'élancement auquel elle sera vue
 * (`CROP_MASS_ASPECT`, dans `proceduralTextures`), et le passage d'une bande à
 * l'autre ne change plus les proportions de la plante.
 *
 * La bande lointaine y perd de la surface par instance ; ses tirages par maille
 * passent de deux à trois pour la rendre.
 */
export const CROP_MASS_SPREAD = 3.2;

/**
 * Les bandes se recouvrent largement — quatorze et seize mètres, contre six et
 * dix. C'est ce qui règle la mue trop visible à l'approche : le semis de détail
 * et la masse coexistent sur une quinzaine de mètres au lieu de six, donc le
 * champ change de facture le temps qu'on parcoure la distance, et non le temps
 * qu'on fasse deux pas.
 */
export const CROP_BANDS = [
  coverBand({ from: 0, to: 34, cell: 1.6, perCell: 9, fadeOut: 14, salt: 0 }),
  coverBand({
    from: 20,
    to: 74,
    cell: 3.2,
    perCell: 3,
    spread: CROP_MASS_SPREAD,
    rise: 1.2,
    massBias: 0.25,
    fadeIn: 14,
    fadeOut: 16,
    salt: 1,
  }),
  coverBand({
    from: 58,
    to: 140,
    cell: 6.4,
    perCell: 3,
    spread: CROP_MASS_SPREAD,
    rise: 1.35,
    massBias: 0.45,
    fadeIn: 16,
    // Long fondu de sortie : le champ s'éclaircit sur ses soixante derniers
    // mètres, où la teinte du sol prend le relais.
    fadeOut: 63,
    salt: 2,
  }),
];

/** Portée semée autour de l'observateur, en mètres — le bord de la dernière bande. */
export const CROP_RADIUS_M = coverBandsRadius(CROP_BANDS);
/** Côté de la maille d'ancrage de la bande de détail, en mètres. Celui de l'herbe : même semis. */
export const CROP_CELL_M = CROP_BANDS[0].cell;
/** Touffes tirées par maille de détail. */
export const CROP_PER_CELL = CROP_BANDS[0].perCell;
/**
 * Nombre maximal de touffes. Voir `GRASS_COUNT` : c'est un garde-fou.
 *
 * Le pire cas est le blé, seule culture à `density: 1` — mesuré à 13 452 sur
 * champ plein, pour une portée de cent quarante mètres.
 */
export const CROP_COUNT = 32000;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const CROP_REBUILD_M = 10;
/**
 * Part de la portée à partir de laquelle le champ s'éclaircit : le fondu de
 * sortie de la dernière bande, exprimé en part du rayon.
 */
export const CROP_FADE_FROM = 1 - CROP_BANDS[CROP_BANDS.length - 1].fadeOut / CROP_RADIUS_M;
/**
 * Plancher de hauteur en bord de bande, en part de la hauteur nominale —
 * même correctif que `GRASS_HEIGHT_FADE_FLOOR` : la présence continue de se
 * raréfier, mais les tiges qui restent ne rapetissent plus jusqu'à s'éteindre.
 */
export const CROP_HEIGHT_FADE_FLOOR = 0.6;
/**
 * Amplitude du vent dans un champ. Plus fort que dans les arbres, plus faible
 * que dans l'herbe : un champ de blé ondule, c'est même le seul mouvement d'un
 * paysage d'été.
 *
 * C'était 0,26, exprimé en part de la **largeur** du panneau. Depuis que
 * l'amplitude se mesure sur la hauteur (voir `foliageMaterial`), la valeur est
 * ramenée à l'élancement moyen d'une tige de près — `look.spread × 4`, soit
 * environ 0,8. Le premier plan bouge donc comme avant, et les masses
 * lointaines cessent de balayer plusieurs mètres.
 */
export const CROP_WIND_STRENGTH = 0.21;

/** Compensation d'alpha à distance — voir `GRASS_COVERAGE_RANGE`. */
export const CROP_COVERAGE_RANGE = [26, 115];
export const CROP_COVERAGE_GAIN = 2.2;

/** Nombre de valeurs décrivant une touffe dans le tampon de maille. */
export const CROP_TUFT_STRIDE = 5;

/**
 * Rétrécissement d'une touffe selon sa distance à l'observateur — pilote
 * combien de tiges restent. Même formule que `grassEdgeFade`. Fonction pure.
 */
export function cropEdgeFade(distance, radius = CROP_RADIUS_M, from = CROP_FADE_FROM) {
  const start = radius * from;
  if (distance <= start) return 1;
  const fade = 1 - (distance - start) / (radius - start);
  return fade < 0 ? 0 : fade;
}

/**
 * Rétrécissement de la **hauteur** seule, avec un plancher — voir
 * `grassHeightFade`. Fonction pure.
 */
export function cropHeightFade(
  distance,
  radius = CROP_RADIUS_M,
  from = CROP_FADE_FROM,
  floor = CROP_HEIGHT_FADE_FLOOR
) {
  return coverHeightFade(cropEdgeFade(distance, radius, from), floor);
}

/**
 * Mailles d'un disque d'une seule échelle, de la plus proche à la plus
 * lointaine — le semis d'avant les bandes. Comme `grassCellRing`, délègue à
 * `coverBandRing` plutôt que de garder un second parcours. Fonction pure.
 */
export function cropCellRing(radius, cell) {
  return coverBandRing([coverBand({ from: 0, to: radius * (1 + 1e-12), cell, perCell: 0 })]);
}

/**
 * Remplit le tampon d'une maille. Même invariant que l'herbe : la graine ne
 * dépend que de la maille, et le nombre de tirages consommés est constant.
 * Le **sel** distingue les bandes, sans quoi deux échelles sèmeraient les mêmes
 * tiges aux mêmes endroits. Fonction pure.
 */
export function fillCropCell(out, gx, gz, cell = CROP_CELL_M, perCell = CROP_PER_CELL, salt = 0) {
  const random = makeRandom((gx * 83492791) ^ (gz * 19349663) ^ (salt * 2654435761));
  const originX = gx * cell;
  const originZ = gz * cell;

  for (let i = 0; i < perCell; i++) {
    const at = i * CROP_TUFT_STRIDE;
    out[at] = originX + random() * cell;
    out[at + 1] = originZ + random() * cell;
    out[at + 2] = random(); // présence
    out[at + 3] = random(); // taille
    out[at + 4] = random(); // rotation
  }
  return out;
}

/**
 * Vrai si le panneau d'une masse, de demi-largeur `reach`, reste dans la même
 * culture et hors de l'emprise routière. Une masse lointaine fait plusieurs
 * mètres de large : posée en lisière, elle déborde sur la route ou le champ
 * voisin. Les quatre directions cardinales suffisent, le panneau étant en croix.
 * Fonction pure.
 */
export function cropMassFits(groundClass, index, crop, x, z, reach) {
  if (inCorridor(index, x, z, CORRIDOR_MARGIN_M + reach)) return false;
  return (
    groundClass.cropAt(x + reach, z) === crop &&
    groundClass.cropAt(x - reach, z) === crop &&
    groundClass.cropAt(x, z + reach) === crop &&
    groundClass.cropAt(x, z - reach) === crop
  );
}

export class CropLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — c'est elle
   *        qui dit quelle culture porte chaque point, pour cette couche comme
   *        pour le shader de terrain.
   * @param {Object} [options.roads] Instance `RoadNetwork` — le blé ne pousse
   *        pas sur le bitume, et un champ traversé par une route en garde la
   *        trace dans les tuiles bien après que la route a été construite.
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass,
    roads = null,
    count = CROP_COUNT,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.roads = roads;
    /**
     * Matrice de paysage du lieu, ou `null`. Elle ne décide pas *quelle*
     * culture pousse — ça, c'est `cropFor`, dans la carte de classes — mais de
     * quelle couleur elle est, du même facteur que le sol sous elle.
     */
    this.matrix = null;
    this._wash = soilWashFor(null, theme.soils);
    this.disposed = false;
    this._anchor = null;
    this._instanceCells = new InstanceCells();
    this._frame = null;
    this._bands = CROP_BANDS;
    this._cells = coverBandRing(paddedCoverBands(this._bands, CROP_REBUILD_M));
    // Une seule allocation, dimensionnée sur la bande la plus fournie.
    const widest = Math.max(...this._bands.map((band) => band.perCell));
    this._tufts = new Float32Array(widest * CROP_TUFT_STRIDE);

    this.texture = new THREE.CanvasTexture(createCropAtlasCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = createCrossedQuads(THREE);
    this._coverBands = new Float32Array(count * 4);
    this.geometry.setAttribute(COVER_ATTRIBUTE, new THREE.InstancedBufferAttribute(this._coverBands, 4).setUsage(THREE.DynamicDrawUsage));
    this._atlasOffsets = new Float32Array(count * 2);
    this.geometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._atlasOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      wind: true,
      windStrength: CROP_WIND_STRENGTH,
      atlas: true,
      tiles: CROP_ATLAS_COLS,
      coverage: true,
      coverageRange: CROP_COVERAGE_RANGE,
      coverageGain: CROP_COVERAGE_GAIN,
      groundLowPoly: true,
      cacheKey: 'foliage-crop-cover-v4-lowpoly',
    });

    installCoverTransition(this.material, THREE);

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'crops';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    this._color = new THREE.Color();
  }

  setMaxAnisotropy(value) {
    this.texture.anisotropy = Math.min(value || 4, 8);
    this.texture.needsUpdate = true;
  }

  /** Fait avancer le vent. À appeler une fois par image. */
  advance(delta) {
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo. Un champ est ce qui rend le vent le plus
   * lisible de loin : la vague y court sur cent mètres.
   * @param {{amplitude:number, speed:number}} field
   */
  setWind(field) {
    setFoliageWind(this.material, field);
  }

  /**
   * Signale que la carte des cultures a changé : ce qui est semé dessus n'est
   * plus valable. Appelé après chaque re-rasterisation de `groundClassMap`.
   */
  /**
   * Pose la région du lieu ; seule sa matrice sert ici.
   *
   * @param {Object|null} region
   * @returns {boolean} vrai si elle a changé — la teinte étant écrite dans les
   *          instances, l'appelant doit alors redistribuer.
   */
  setRegion(region) {
    const next = region?.matrix ?? null;
    if (next === this.matrix) return false;
    this.matrix = next;
    this._wash = soilWashFor(next, this.theme.soils);
    return true;
  }

  invalidate() {
    this._anchor = null;
  }

  /**
   * Redistribue les touffes si l'observateur s'est assez éloigné.
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame || !this.groundClass?.cropReady) return false;

    this.material.userData.coverObserver.value.set(x, z);
    const frameChanged = this._frame !== this.bubble.frame;
    if (!force && !frameChanged && this._anchor) {
      if (Math.hypot(x - this._anchor.x, z - this._anchor.z) < CROP_REBUILD_M) return false;
    }

    this._instanceCells.begin(this.bubble.frame, this.bubble.surfaceGeneration, this.roads?.index, force);
    this._scatter(x, z);
    this._anchor = { x, z };
    this._frame = this.bubble.frame;
    return true;
  }

  _scatter(centerX, centerZ) {
    const { bubble, roads, mesh } = this;
    const capacity = mesh.instanceMatrix.count;
    const index = roads?.index || null;
    const bands = this._bands;
    // Un centre arrondi **par bande** : chaque grille garde son propre pas, donc
    // les mailles retenues ne dépendent que du sol.
    const bases = bands.map((band) => ({
      x: Math.round(centerX / band.cell),
      z: Math.round(centerZ / band.cell),
    }));
    const tufts = this._tufts;
    let placed = 0;
    const streams = [[mesh.instanceMatrix.array,16],[mesh.instanceColor.array,3],[this._coverBands,4],[this._atlasOffsets,2]];

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const band = bands[cell.band];
      const base = bases[cell.band];
      const gx = base.x + cell.gx;
      const gz = base.z + cell.gz;
      const cacheKey = `${cell.band}:${gx}:${gz}`;
      const retained = this._instanceCells.read(cacheKey, streams, placed, capacity);
      if (retained !== null) { placed += retained; continue; }
      const cellStart = placed;
      const cellX = (gx + 0.5) * band.cell;
      const cellZ = (gz + 0.5) * band.cell;
      const crop = this.groundClass.cropAt(cellX, cellZ);
      if (!crop) continue;
      const look = this.theme.crops[crop];
      if (!look) continue;

      const fade = coverBandFade(coverBandDistance(centerX, centerZ, cellX, cellZ), band);

      // La hauteur ne suit pas le fondu jusqu'à zéro : c'est la densité qui
      // passe la main d'une bande à l'autre, pas la taille.
      const heightFade = 1;
      // À distance, une instance représente plusieurs mètres carrés de champ :
      // une culture peu dense au pied (le maïs, quatre pieds par case) y est une
      // masse continue, sinon un champ de maïs se troue à cent mètres alors
      // qu'un champ de blé reste plein.
      const density = coverMassDensity(look.density, band);

      fillCropCell(tufts, gx, gz, band.cell, band.perCell, band.salt);
      // Passé la bande de détail, c'est la **masse** de la culture qui est
      // tirée : un champ de maïs reste identifiable comme du maïs.
      const atlas = cell.band > 0 ? `${look.atlas}Mass` : look.atlas;
      const offset = CROP_ATLAS_OFFSETS[CROP_VARIANTS.indexOf(atlas)];

      for (let i = 0; i < band.perCell && placed < capacity; i++) {
        const at = i * CROP_TUFT_STRIDE;
        if (tufts[at + 2] > density) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        // Un champ borde la route, il ne la recouvre pas. La marge n'est plus
        // choisie ici : c'est l'emprise routière (`roadCorridor`), commune à
        // l'herbe, aux haies, aux clôtures et aux jardins.
        if (inCorridor(index, x, z)) continue;

        const height = look.height * (0.82 + tufts[at + 3] * 0.36) * heightFade * band.rise;
        // Élargi, pas élevé : c'est la largeur qui ferme les trous entre masses.
        const width = height * look.spread * 4 * band.spread;
        if (cell.band > 0 && !cropMassFits(this.groundClass, index, crop, x, z, width / 2)) continue;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(width, height, width);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(placed, this._matrix);

        const shade = 0.86 + tufts[at + 3] * 0.24;
        // Même facteur que celui appliqué à `cropAlbedo` par le shader de
        // terrain : le champ lointain et les tiges du premier plan sont la
        // même culture, ils ne peuvent pas prendre deux couleurs.
        const wash = this._wash.farmland;
        this._color.setRGB(
          look.tint[0] * shade * wash[0],
          look.tint[1] * shade * wash[1],
          look.tint[2] * shade * wash[2]
        );
        mesh.setColorAt(placed, this._color);

        this._coverBands.set([band.from, band.to, band.fadeIn, band.fadeOut], placed * 4);
        this._atlasOffsets[placed * 2] = offset[0];
        this._atlasOffsets[placed * 2 + 1] = offset[1];
        placed++;
      }
      if (placed < capacity) this._instanceCells.write(cacheKey, streams, cellStart, placed);
    }

    this._instanceCells.end();
    this.geometry.getAttribute(COVER_ATTRIBUTE).needsUpdate = true;
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.geometry.getAttribute(ATLAS_ATTRIBUTE).needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._instanceCells.clear();
    this.scene.remove(this.mesh);
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
