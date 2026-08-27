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

/**
 * Rayon semé autour de l'observateur, en mètres.
 *
 * Il a été **réduit** en même temps que la densité montait, et c'est le bon
 * échange : un champ semé jusqu'à quatre-vingt-quinze mètres à raison d'une
 * demi-tige au mètre carré ne se lit pas comme un champ, il se lit comme un
 * terrain vague piqué de brins. Mieux vaut un blé plein sur cinquante mètres —
 * au-delà, c'est la teinte du sol qui porte le champ, et elle le fait bien.
 */
export const CROP_RADIUS_M = 48;
/** Côté de la maille d'ancrage, en mètres. Celui de l'herbe : même semis. */
export const CROP_CELL_M = 1.6;
/** Touffes tirées par maille. */
export const CROP_PER_CELL = 9;
/** Nombre maximal de touffes. Voir `GRASS_COUNT` : c'est un garde-fou. */
export const CROP_COUNT = 16000;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const CROP_REBUILD_M = 10;
/** Part du rayon à partir de laquelle les touffes rapetissent. */
export const CROP_FADE_FROM = 0.55;

/** Nombre de valeurs décrivant une touffe dans le tampon de maille. */
export const CROP_TUFT_STRIDE = 5;

/**
 * Mailles du disque, de la plus proche à la plus lointaine. Même raison que pour
 * l'herbe : si le plafond est atteint, ce qui se perd doit être au bord.
 * Fonction pure.
 */
export function cropCellRing(radius, cell) {
  const span = Math.ceil(radius / cell);
  const out = [];
  for (let gz = -span; gz <= span; gz++) {
    for (let gx = -span; gx <= span; gx++) {
      const dx = (gx + 0.5) * cell;
      const dz = (gz + 0.5) * cell;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      out.push({ gx, gz, distance });
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Remplit le tampon d'une maille. Même invariant que l'herbe : la graine ne
 * dépend que de la maille, et le nombre de tirages consommés est constant.
 * Fonction pure.
 */
export function fillCropCell(out, gx, gz, cell = CROP_CELL_M) {
  const random = makeRandom((gx * 83492791) ^ (gz * 19349663));
  const originX = gx * cell;
  const originZ = gz * cell;

  for (let i = 0; i < CROP_PER_CELL; i++) {
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
    this._cells = cropCellRing(CROP_RADIUS_M, CROP_CELL_M);
    this._tufts = new Float32Array(CROP_PER_CELL * CROP_TUFT_STRIDE);

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
      cacheKey: 'foliage-crop-wind-v1',
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
    const baseX = Math.round(centerX / CROP_CELL_M);
    const baseZ = Math.round(centerZ / CROP_CELL_M);
    const tufts = this._tufts;
    let placed = 0;

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const gx = baseX + cell.gx;
      const gz = baseZ + cell.gz;
      const crop = this.groundClass.cropAt((gx + 0.5) * CROP_CELL_M, (gz + 0.5) * CROP_CELL_M);
      if (!crop) continue;
      const look = this.theme.crops[crop];
      if (!look) continue;

      // Même fondu que l'herbe : une touffe qui entre dans le disque entre à
      // taille nulle, donc son apparition ne se voit pas.
      const start = CROP_RADIUS_M * CROP_FADE_FROM;
      const fade = cell.distance <= start ? 1 : Math.max(0, 1 - (cell.distance - start) / (CROP_RADIUS_M - start));
      if (fade <= 0.05) continue;

      fillCropCell(tufts, gx, gz);
      const offset = CROP_ATLAS_OFFSETS[CROP_VARIANTS.indexOf(look.atlas)];

      for (let i = 0; i < CROP_PER_CELL && placed < capacity; i++) {
        const at = i * CROP_TUFT_STRIDE;
        if (tufts[at + 2] > look.density * fade) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        // Un champ borde la route, il ne la recouvre pas. La marge n'est plus
        // choisie ici : c'est l'emprise routière (`roadCorridor`), commune à
        // l'herbe, aux haies, aux clôtures et aux jardins.
        if (inCorridor(index, x, z)) continue;

        const height = look.height * (0.82 + tufts[at + 3] * 0.36) * fade;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(height * look.spread * 4, height, height * look.spread * 4);
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
