/*
 * groundCover — l'herbe du tout premier plan.
 * -------------------------------------------
 * Un sol texturé reste plat : sous la caméra, il manque quelque chose qui ait
 * une hauteur et qui défile. C'est le rôle de ce disque de touffes instanciées,
 * semé sur les quarante mètres qui entourent l'observateur.
 *
 * Deux règles gouvernent tout le module :
 *
 * - **Les touffes sont ancrées au sol, pas à l'observateur.** Une maille fixe de
 *   deux mètres, une graine dérivée des seules coordonnées de la maille : une
 *   touffe garde sa position, sa hauteur et sa teinte d'une redistribution à
 *   l'autre, et avancer ne fait qu'ajouter des mailles devant et retirer celles
 *   de derrière. Semer autour de l'observateur faisait au contraire sauter les neuf
 *   mille touffes à chaque changement de graine.
 * - **Le bitume est écarté par l'index du réseau routier** (`roadGraph.js`),
 *   c'est-à-dire par la géométrie même sur laquelle roule l'observateur. Les
 *   polygones d'occupation du sol, eux, ne découpent pas les chaussées : une
 *   prairie traversée par une départementale y est verte sur toute sa surface.
 *
 * Restent deux choix qui tiennent le coût : un **seul** maillage instancié
 * jamais réalloué — on réécrit les matrices en place et on ajuste `count` —, et
 * le vent qui vit entièrement dans le shader, un uniforme avancé par image.
 */

import {
  createGrassAtlasCanvas,
  GRASS_ATLAS_COLS,
  GRASS_ATLAS_OFFSETS,
  GRASS_VARIANTS,
} from '../materials/proceduralTextures.js';
import { createFoliageMaterial, createCrossedQuads, ATLAS_ATTRIBUTE } from '../materials/foliageMaterial.js';
import { makeRandom } from '../materials/proceduralTextures.js';
import { CORRIDOR_MARGIN_M, inCorridor } from './roadCorridor.js';
import { defaultTheme } from '../themes/default.js';

/** Rayon du disque d'herbe autour de l'observateur, en mètres. */
export const GRASS_RADIUS_M = 38;
/**
 * Nombre maximal de touffes.
 *
 * Le plafond n'est pas la densité : la densité se règle par la maille, et le
 * plafond n'est là que pour borner le pire cas (prairie pleine, sans route ni
 * bâti pour trouer le semis). S'il est atteint, ce qui se perd est au bord du
 * disque, où les touffes sont déjà minuscules — c'est tout l'intérêt de semer
 * de la plus proche maille à la plus lointaine.
 */
export const GRASS_COUNT = 13000;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const GRASS_REBUILD_M = 8;
/** Côté de la maille d'ancrage au sol, en mètres. */
export const GRASS_CELL_M = 1.6;
/** Touffes tirées par maille. La couverture décide de celles qui poussent. */
export const GRASS_PER_CELL = 10;
/** Part de végétal en deçà de laquelle rien ne pousse (bitume, roche, eau). */
export const GRASS_GREEN_MIN = 0.25;
/**
 * Débord toléré au-delà de la chaussée, en mètres : l'accotement reste nu.
 *
 * Ce n'est plus une valeur propre à l'herbe. C'est **l'emprise routière**
 * (`roadCorridor`), la même frontière que respectent les haies, les clôtures,
 * les jardins et les cultures : le terrain est terrassé jusque-là, donc rien
 * n'y pousse. Conservée sous son ancien nom parce qu'elle est publique.
 */
export const GRASS_ROAD_MARGIN_M = CORRIDOR_MARGIN_M;
/** Part du rayon à partir de laquelle les touffes rapetissent. */
export const GRASS_FADE_FROM = 0.6;

/**
 * Variante de touffe à semer en un point, d'après ce que dit la carte de
 * classes et un tirage attaché à la touffe.
 *
 * Fonction pure. Rend un indice dans `GRASS_VARIANTS` (0 = herbe nue).
 *
 * @param {{grass:number, farmland:number}|null} sample
 * @param {number} draw Tirage dans [0, 1[ propre à la touffe.
 */
export function grassVariantFor(sample, draw, grass = defaultTheme.grass) {
  if (!sample) return 0;

  // Bord de champ : herbe **et** culture au même endroit. C'est là et
  // seulement là que le coquelicot pousse.
  const edge = sample.grass > 0.2 && sample.farmland > 0.2;
  if (edge) return draw < grass.poppyShare ? GRASS_VARIANTS.indexOf('poppy') : 0;

  if (draw >= grass.flowerShare) return 0;
  // En prairie : marguerites et boutons d'or, à peu près à parts égales.
  return draw < grass.flowerShare * 0.5
    ? GRASS_VARIANTS.indexOf('white')
    : GRASS_VARIANTS.indexOf('yellow');
}

/**
 * Mailles du disque, de la plus proche à la plus lointaine.
 *
 * L'ordre compte : si le plafond de touffes est atteint, ce qui se perd doit
 * être au bord du disque — où les touffes sont déjà minuscules — et non un
 * quartier entier tiré au hasard de l'ordre de parcours. Fonction pure.
 *
 * @param {number} radius Rayon, en mètres.
 * @param {number} cell   Côté d'une maille, en mètres.
 * @returns {Array<{gx:number, gz:number, distance:number}>} indices de maille
 *          absolus (à multiplier par `cell`) et distance au centre.
 */
export function grassCellRing(radius, cell) {
  const span = Math.ceil(radius / cell);
  const out = [];
  for (let gz = -span; gz <= span; gz++) {
    for (let gx = -span; gx <= span; gx++) {
      // Distance prise au centre de la maille : c'est là que le score de
      // végétal est lu, et c'est ce qui décide du fondu de bord.
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

/** Nombre de valeurs décrivant une touffe dans le tampon de maille. */
export const GRASS_TUFT_STRIDE = 7;

/**
 * Remplit le tampon des touffes d'une maille : position, présence, taille,
 * rotation, teinte.
 *
 * **Invariant** : le nombre de tirages consommés est constant, et la graine ne
 * dépend que des coordonnées de la maille. Une maille rend donc toujours
 * exactement les mêmes touffes, quels que soient l'ordre des appels et la
 * position de l'observateur — c'est ce qui fait qu'avancer ajoute des touffes devant
 * au lieu de redistribuer tout le disque. Si un filtre venait sauter un tirage,
 * toutes les touffes suivantes de la maille changeraient de place et l'herbe se
 * remettrait à sauter.
 *
 * Fonction pure, écrite dans un tampon fourni : neuf mille objets jetables par
 * redistribution ne coûteraient rien d'utile.
 *
 * @param {Float32Array} out Longueur `GRASS_PER_CELL × GRASS_TUFT_STRIDE`.
 * @param {number} gx Indice de maille (absolu, pas relatif à l'observateur).
 * @param {number} gz
 * @param {number} [cell] Côté de la maille, en mètres.
 * @returns {Float32Array} le tampon fourni.
 */
export function fillGrassCell(out, gx, gz, cell = GRASS_CELL_M) {
  const random = makeRandom((gx * 73856093) ^ (gz * 19349663));
  const originX = gx * cell;
  const originZ = gz * cell;

  for (let i = 0; i < GRASS_PER_CELL; i++) {
    const at = i * GRASS_TUFT_STRIDE;
    out[at] = originX + random() * cell;
    out[at + 1] = originZ + random() * cell;
    out[at + 2] = random(); // présence
    out[at + 3] = random(); // taille
    out[at + 4] = random(); // rotation
    out[at + 5] = random(); // teinte
    out[at + 6] = random(); // fleurissement
  }

  return out;
}

/**
 * Rétrécissement d'une touffe selon sa distance à l'observateur.
 *
 * Le disque se termine en fondu plutôt que par une frontière nette d'herbe
 * coupée au couteau — et c'est aussi ce qui rend l'apparition d'une maille
 * invisible : une touffe qui entre dans le disque entre à taille nulle.
 * Fonction pure.
 */
export function grassEdgeFade(distance, radius = GRASS_RADIUS_M, from = GRASS_FADE_FROM) {
  const start = radius * from;
  if (distance <= start) return 1;
  const fade = 1 - (distance - start) / (radius - start);
  return fade < 0 ? 0 : fade;
}

export class GroundCover {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble     Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — c'est elle
   *        qui dit où il y a du végétal.
   * @param {Object} [options.roads]    Instance `RoadNetwork` — l'herbe ne pousse
   *        pas sur ses chaussées.
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass,
    roads = null,
    count = GRASS_COUNT,
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
    this._cells = grassCellRing(GRASS_RADIUS_M, GRASS_CELL_M);
    this._tufts = new Float32Array(GRASS_PER_CELL * GRASS_TUFT_STRIDE);

    this.texture = new THREE.CanvasTexture(createGrassAtlasCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = createCrossedQuads(THREE);
    // Le décalage d'atlas est une donnée **d'instance** : il faut donc le tampon
    // sur la géométrie, alloué une fois pour toutes comme les matrices — l'herbe
    // est le seul maillage de la scène qui n'est jamais réalloué.
    this._atlasOffsets = new Float32Array(count * 2);
    this.geometry.setAttribute(
      ATLAS_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(this._atlasOffsets, 2).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      wind: true,
      atlas: true,
      tiles: GRASS_ATLAS_COLS,
      cacheKey: 'foliage-grass-flowers-v2',
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'ground-cover';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // toujours autour de la caméra
    // L'herbe reçoit l'ombre mais n'en projette pas : neuf mille touffes de
    // trente centimètres coûteraient une passe d'ombres entière pour un gain
    // qu'on ne verrait pas.
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

  /** Fait avancer le vent. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    const wind = this.material?.userData?.wind;
    if (!wind || !Number.isFinite(delta)) return;
    // Remis dans [0, 1000[ : un temps qui croît indéfiniment finit par perdre
    // sa précision en flottant simple, et le vent se met à saccader.
    wind.uWindTime.value = (wind.uWindTime.value + delta) % 1000;
  }

  /**
   * Redistribue les touffes si l'observateur s'est assez éloigné.
   * @param {number} x Position locale de l'observateur.
   * @param {number} z
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return false;

    const frameChanged = this._frame !== this.bubble.frame;
    if (!force && !frameChanged && this._anchor) {
      if (Math.hypot(x - this._anchor.x, z - this._anchor.z) < GRASS_REBUILD_M) return false;
    }

    this._scatter(x, z);
    this._anchor = { x, z };
    this._frame = this.bubble.frame;
    return true;
  }

  /** Sème le disque, maille par maille. */
  _scatter(centerX, centerZ) {
    const { bubble, groundClass, roads, mesh } = this;
    const capacity = mesh.instanceMatrix.count;
    const index = roads?.index || null;
    // Le centre est arrondi à la maille : le disque semé se déplace par pas de
    // deux mètres, donc l'ensemble des mailles retenues ne dépend que du sol.
    const baseX = Math.round(centerX / GRASS_CELL_M);
    const baseZ = Math.round(centerZ / GRASS_CELL_M);
    const tufts = this._tufts;
    const grass = this.theme.grass;
    let placed = 0;

    for (const cell of this._cells) {
      if (placed >= capacity) break;

      const gx = baseX + cell.gx;
      const gz = baseZ + cell.gz;

      const sample = groundClass?.sampleAt(
        (gx + 0.5) * GRASS_CELL_M,
        (gz + 0.5) * GRASS_CELL_M
      );
      // Même lecture que `greenAt`, mais on garde l'échantillon complet : c'est
      // la présence simultanée d'herbe et de culture qui signale un bord de
      // champ, donc un coquelicot.
      const green = sample ? Math.min(1, sample.grass + sample.farmland * 0.5) : null;
      if (green == null || green < GRASS_GREEN_MIN) continue;

      const fade = grassEdgeFade(cell.distance);
      if (fade <= 0.05) continue;

      fillGrassCell(tufts, gx, gz);

      for (let i = 0; i < GRASS_PER_CELL && placed < capacity; i++) {
        const at = i * GRASS_TUFT_STRIDE;
        // La couverture décide de la densité, pas de la position : une prairie
        // à demi verte donne une touffe sur deux, aux mêmes endroits.
        if (tufts[at + 2] > green * fade) continue;

        const x = tufts[at];
        const z = tufts[at + 1];
        if (inCorridor(index, x, z, GRASS_ROAD_MARGIN_M)) continue;

        const tint = tufts[at + 5];
        const height =
          (grass.minHeight + tufts[at + 3] * (grass.maxHeight - grass.minHeight)) *
          // Plus l'herbe est dense, plus elle est haute : une pelouse rase et
          // une friche ne se distinguent pas autrement.
          (0.72 + green * 0.28) *
          fade;
        const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;

        this._position.set(x, y, z);
        this._quaternion.setFromAxisAngle(this._axis, tufts[at + 4] * Math.PI);
        this._scale.set(height * grass.aspect, height, height * grass.aspect);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(placed, this._matrix);
        // Teinte par touffe : sans elle, un tapis de clones. Le jaune monte là
        // où la couverture faiblit — bord de champ, herbe sèche, passage.
        // Teintes resserrées depuis que la couleur d'instance est réellement
        // appliquée (voir `foliageMaterial`) : les valeurs d'avant avaient été
        // réglées à l'aveugle sur un canal qui n'arrivait pas au fragment, et
        // telles quelles elles viraient au jaune paille.
        const dry = (1 - green) * 0.5 + tint * 0.35;
        this._color.setRGB(0.82 + dry * 0.26, 0.96 + tint * 0.09, 0.74 - dry * 0.2);
        mesh.setColorAt(placed, this._color);

        // Fleurissement : la variante d'atlas est décidée par le sol, pas par un
        // tirage libre — coquelicots en lisière de culture, marguerites et
        // boutons d'or en prairie.
        const [u, v] = GRASS_ATLAS_OFFSETS[grassVariantFor(sample, tufts[at + 6], this.theme.grass)];
        this._atlasOffsets[placed * 2] = u;
        this._atlasOffsets[placed * 2 + 1] = v;
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
