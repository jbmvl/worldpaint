/*
 * cropLayer — ce qui pousse dans les champs.
 * ------------------------------------------
 * Un champ était un aplat de terre labourée, partout et en toute saison. C'est
 * juste une fois sur cinq : le reste du temps il porte du blé, du maïs, du
 * tournesol, du chaume. Et c'est ce qui donne à une campagne sa couleur — le
 * jaune d'un champ de blé se voit d'un kilomètre, bien plus loin qu'aucune haie.
 *
 * ## Où est la culture
 *
 * Nulle part ici. La culture est une propriété de la **parcelle** — tout le
 * champ porte la même chose, et le champ suivant porte autre chose —, et c'est
 * `groundClassMap` qui la rasterise, en même temps que l'occupation du sol et
 * dans le même repère. Cette couche ne fait qu'y lire (`groundClass.cropAt`).
 *
 * Ce n'est pas un détail d'implémentation, c'est **la** règle : la même carte
 * est lue par le shader de terrain, qui en tire la couleur du champ jusqu'à
 * l'horizon. Les tiges du premier plan et la teinte du lointain ne peuvent donc
 * pas se contredire — et elles se contrediraient, si chacun tirait sa culture
 * de son côté. C'est aussi ce qui donne la portée : cinquante mètres de tiges
 * posées sur deux kilomètres de couleur.
 *
 * ## Ce qui est semé
 *
 * Des touffes croisées, exactement comme l'herbe : même géométrie, même
 * matériau, même vent — un champ de blé qui ondule est ce qu'on voit en vrai, et
 * ça ne coûte rien puisque le shader le fait déjà. Seules changent l'échelle (un
 * maïs fait deux mètres et demi, un chaume vingt centimètres) et la silhouette,
 * tirée d'un atlas.
 *
 * Les **rangs** — vigne et verger — ne passent pas par ici : ils sont balayés
 * par `furnitureLayer`, parce qu'un rang est une ligne continue et non un semis.
 *
 * ## À quelle échelle
 *
 * En trois **bandes** (`coverBands.js`), comme l'herbe et pour la même raison :
 * au-delà de trente mètres, semer un pied par pied dessine quelque chose que
 * personne ne distingue et que le premier mip efface. Passé la bande de détail,
 * une instance représente donc plusieurs mètres carrés de champ, et l'atlas
 * fournit pour cela la **masse** de chaque culture — le blé agrégé reste du blé,
 * le maïs agrégé reste du maïs. L'identité agricole tient à cela : une masse
 * unique et neutre aurait rendu tous les champs identiques dès cinquante mètres.
 *
 * L'en-tête disait auparavant qu'au-delà de cinquante mètres « c'est la teinte
 * du sol qui porte le champ, et elle le fait bien ». C'était vrai contre
 * l'alternative d'alors — des tiges éparses —, et faux contre une masse : la
 * teinte porte la **couleur** du champ, pas sa matière, et un champ sans matière
 * se lit comme un aplat peint. Les deux travaillent maintenant ensemble, la
 * teinte au-delà de cent quarante mètres et la masse en deçà.
 *
 * La hauteur, elle, ne suit pas le fondu de présence : c'est la densité qui
 * passe la main d'une bande à l'autre, et `coverHeightFade` plancher la taille
 * de ce qui reste — sans quoi les tiges devenaient rares *et* minuscules, et
 * s'éteignaient juste avant de disparaître.
 */

import {
  makeRandom,
  createCropAtlasCanvas,
  CROP_ATLAS_COLS,
  CROP_ATLAS_OFFSETS,
  CROP_VARIANTS,
} from '../materials/proceduralTextures.js';
import { createFoliageMaterial, createCrossedQuads, ATLAS_ATTRIBUTE } from '../materials/foliageMaterial.js';
import { defaultTheme } from '../themes/default.js';
import { inCorridor } from './roadCorridor.js';
import {
  coverBand,
  coverBandRing,
  coverBandFade,
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
export const CROP_BANDS = [
  coverBand({ from: 0, to: 30, cell: 1.6, perCell: 9, fadeOut: 6, salt: 0 }),
  coverBand({
    from: 24,
    to: 72,
    cell: 3.2,
    perCell: 3,
    spread: 2.4,
    rise: 1.2,
    massBias: 0.25,
    fadeIn: 6,
    fadeOut: 10,
    salt: 1,
  }),
  coverBand({
    from: 62,
    to: 140,
    cell: 6.4,
    perCell: 2,
    spread: 4.5,
    rise: 1.35,
    massBias: 0.45,
    fadeIn: 10,
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
 * Le pire cas est le blé, seule culture à `density: 1` — mesuré à 12 762 sur
 * champ plein, pour une portée passée de quarante-huit à cent quarante mètres.
 */
export const CROP_COUNT = 15000;
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
    this.disposed = false;
    this._anchor = null;
    this._frame = null;
    this._bands = CROP_BANDS;
    this._cells = coverBandRing(this._bands);
    // Une seule allocation, dimensionnée sur la bande la plus fournie.
    const widest = Math.max(...this._bands.map((band) => band.perCell));
    this._tufts = new Float32Array(widest * CROP_TUFT_STRIDE);

    this.texture = new THREE.CanvasTexture(createCropAtlasCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = createCrossedQuads(THREE);
    this._atlasOffsets = new Float32Array(count * 2);
    this.geometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._atlasOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      wind: true,
      // Plus fort que dans les arbres, plus faible que dans l'herbe : un champ
      // de blé ondule, c'est même le seul mouvement d'un paysage d'été.
      windStrength: 0.26,
      atlas: true,
      tiles: CROP_ATLAS_COLS,
      coverage: true,
      coverageRange: CROP_COVERAGE_RANGE,
      coverageGain: CROP_COVERAGE_GAIN,
      cacheKey: 'foliage-crop-cover-v2',
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'crops';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
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
    const wind = this.material?.userData?.wind;
    if (!wind || !Number.isFinite(delta)) return;
    wind.uWindTime.value = (wind.uWindTime.value + delta) % 1000;
  }

  /**
   * Signale que la carte des cultures a changé : ce qui est semé dessus n'est
   * plus valable. Appelé après chaque re-rasterisation de `groundClassMap`.
   */
  invalidate() {
    this._anchor = null;
  }

  /**
   * Redistribue les touffes si l'observateur s'est assez éloigné.
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame || !this.groundClass?.cropReady) return false;

    const frameChanged = this._frame !== this.bubble.frame;
    if (!force && !frameChanged && this._anchor) {
      if (Math.hypot(x - this._anchor.x, z - this._anchor.z) < CROP_REBUILD_M) return false;
    }

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

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const band = bands[cell.band];
      const base = bases[cell.band];
      const gx = base.x + cell.gx;
      const gz = base.z + cell.gz;
      const crop = this.groundClass.cropAt((gx + 0.5) * band.cell, (gz + 0.5) * band.cell);
      if (!crop) continue;
      const look = this.theme.crops[crop];
      if (!look) continue;

      const fade = coverBandFade(cell.distance, band);
      if (fade <= 0.02) continue;
      // La hauteur ne suit pas le fondu jusqu'à zéro : c'est la densité qui
      // passe la main d'une bande à l'autre, pas la taille.
      const heightFade = coverHeightFade(fade, CROP_HEIGHT_FADE_FLOOR);
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
        if (tufts[at + 2] > density * fade) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        // Un champ borde la route, il ne la recouvre pas. La marge n'est plus
        // choisie ici : c'est l'emprise routière (`roadCorridor`), commune à
        // l'herbe, aux haies, aux clôtures et aux jardins.
        if (inCorridor(index, x, z)) continue;

        const height = look.height * (0.82 + tufts[at + 3] * 0.36) * heightFade * band.rise;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
        // Élargi, pas élevé : c'est la largeur qui ferme les trous entre masses.
        const width = height * look.spread * 4 * band.spread;

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(width, height, width);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(placed, this._matrix);

        const shade = 0.86 + tufts[at + 3] * 0.24;
        this._color.setRGB(look.tint[0] * shade, look.tint[1] * shade, look.tint[2] * shade);
        mesh.setColorAt(placed, this._color);

        this._atlasOffsets[placed * 2] = offset[0];
        this._atlasOffsets[placed * 2 + 1] = offset[1];
        placed++;
      }
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.geometry.getAttribute(ATLAS_ATTRIBUTE).needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
