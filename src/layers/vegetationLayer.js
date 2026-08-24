/*
 * vegetationLayer — les arbres, en instances.
 * -------------------------------------------
 * Les arbres poussent là où la carte d'occupation du sol dit « bois »
 * (`groundClassMap`) : un polygone de bois vaut 1, une prairie 0, donc les
 * lisières sont nettes. C'est la même donnée que celle lue par le shader du
 * terrain, au même endroit — la texture du sol et ce qui y pousse ne peuvent
 * pas se contredire.
 *
 * Chaque arbre est une paire de quadrilatères croisés — pas un modèle. À la
 * distance où on les voit, une silhouette bien découpée vaut un tronc modélisé
 * et coûte quatre triangles au lieu de plusieurs centaines. Neuf silhouettes
 * tirées dans un atlas, plus une rotation, une échelle et une teinte propres à
 * chaque instance : un bois cesse alors de ressembler à un clonage.
 *
 * Elles ne sont pas tirées uniformément : une maille de terrain fixe un
 * **peuplement** (`FOREST_TYPES`), et c'est lui qui décide des essences, de la
 * hauteur et de la densité. Un mélange uniforme d'essences est exactement ce
 * qu'on ne voit jamais dehors.
 *
 * La plantation est mise en file et étalée sur plusieurs images : composer deux
 * mille matrices dans la même image se verrait comme un à-coup.
 */

import {
  makeRandom,
  createTreeAtlasCanvas,
  TREE_ATLAS_OFFSETS,
  TREE_ATLAS_COLS,
} from '../materials/proceduralTextures.js';
import { randomAt } from './furniturePlacement.js';
import {
  createFoliageMaterial,
  createFoliageDepthMaterial,
  createCrossedQuads,
  ATLAS_ATTRIBUTE,
} from '../materials/foliageMaterial.js';
import { defaultTheme } from '../themes/default.js';

/** Côté de la grille de plantation, par tuile (~36 m par cellule au zoom 15). */
export const VEGETATION_CELLS = 24;
/** Arbres au maximum par cellule. */
export const TREES_PER_CELL = 9;
/** Plafond global : au-delà, on arrête de planter. */
export const MAX_TREES_PER_TILE = 3000;
/** Anneau au-delà duquel on ne plante plus (le brouillard s'en charge). */
export const VEGETATION_MAX_RING = 1;
/** Hauteur des arbres, en mètres. */
export const TREE_MIN_HEIGHT = 6;
export const TREE_MAX_HEIGHT = 15;
/** En deçà de cette part de boisé, la cellule ne reçoit aucun arbre. */
export const WOOD_SCORE_MIN = 0.3;
/**
 * Exposant de la courbe de densité. Au-dessus de 1, les scores moyens donnent
 * peu d'arbres et les scores forts en donnent beaucoup : c'est ce qui creuse la
 * différence entre une lisière et un sous-bois.
 */
export const WOOD_DENSITY_CURVE = 1.5;

/**
 * Nombre d'arbres à poser dans une cellule, d'après sa part de boisé.
 *
 * L'arrondi est **stochastique** : `jitter` est un tirage uniforme dans [0, 1[
 * fourni par l'appelant, et `floor(attendu + jitter)` a pour espérance
 * `attendu`. Une densité attendue de 0,4 arbre donne donc un arbre dans 40 %
 * des cellules — un semis irrégulier — au lieu d'un arbre partout ou nulle
 * part, qui est exactement ce qui produisait un effet de verger.
 *
 * Fonction pure, déterministe à `jitter` fixé.
 */
export function treesForScore(score, maxPerCell, jitter = 0) {
  if (score < WOOD_SCORE_MIN) return 0;
  const normalized = (score - WOOD_SCORE_MIN) / (1 - WOOD_SCORE_MIN);
  const expected = Math.pow(normalized, WOOD_DENSITY_CURVE) * maxPerCell;
  return Math.floor(expected + jitter);
}

/** Côté de la maille qui décide du peuplement, en mètres. */
export const FOREST_PATCH_M = 420;

/**
 * Peuplement d'un point du sol. Fonction pure, et **ancrée au lieu** : c'est ce
 * qui fait qu'une forêt garde ses essences quand la bulle se déplace.
 */
export function forestTypeAt(x, z, forests = defaultTheme.forests) {
  const gx = Math.floor(x / FOREST_PATCH_M) * FOREST_PATCH_M;
  const gz = Math.floor(z / FOREST_PATCH_M) * FOREST_PATCH_M;
  const draw = randomAt(gx, gz, 131);
  return forests[Math.min(forests.length - 1, Math.floor(draw * forests.length))];
}

/** Variantes d'atlas ouvertes à un peuplement, dans l'ordre de ses essences. */
export function variantsFor(type, essences = defaultTheme.trees.essences) {
  const out = [];
  for (const essence of type.essences) out.push(...(essences[essence] || []));
  return out.length > 0 ? out : [0];
}

export class VegetationLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — sans elle,
   *        rien ne pousse : on ne devine pas un bois.
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass = null,
    maxRing = VEGETATION_MAX_RING,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.maxRing = maxRing;
    this.disposed = false;

    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    scene.add(this.group);

    this.texture = new THREE.CanvasTexture(
      createTreeAtlasCanvas(undefined, undefined, theme.trees.variants)
    );
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.baseGeometry = createCrossedQuads(THREE);
    this.material = createFoliageMaterial({
      THREE,
      map: this.texture,
      atlas: true,
      tiles: TREE_ATLAS_COLS,
      // Le vent, aussi, dans les arbres — mais dix fois plus discret que dans
      // l'herbe. Une houppe qui balance de trente centimètres à quinze mètres du
      // sol est ce qui distingue un décor vivant d'une maquette ; au-delà, un
      // arbre se met à onduler comme une algue.
      wind: true,
      windStrength: 0.05,
      cacheKey: 'foliage-atlas-wind-v2',
    });
    // Sans lui, chaque panneau projetterait l'atlas entier : quatre arbres
    // écrasés dans l'ombre d'un seul.
    this.depthMaterial = createFoliageDepthMaterial({
      THREE,
      map: this.texture,
      tiles: TREE_ATLAS_COLS,
      cacheKey: 'foliage-atlas-depth-v1',
    });

    /** @type {Map<string, Object>} maillages instanciés, par clé de tuile */
    this.meshes = new Map();
    /**
     * Tuiles déjà traitées, **y compris celles où rien n'a poussé**. Sans elle,
     * une tuile sans arbre serait remise en file à chaque synchronisation et
     * re-classée à chaque image : en rase campagne, tout le temps.
     * @type {Set<string>}
     */
    this._planted = new Set();
    /** @type {string[]} tuiles à planter, une par image */
    this.queue = [];

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

  /**
   * Fait avancer le vent dans les houppes. À appeler une fois par image.
   *
   * L'ombre portée, elle, ne balance pas : le matériau de profondeur ne rejoue
   * pas le déplacement du sommet. À cette amplitude — quelques dizaines de
   * centimètres au sommet d'un arbre de quinze mètres — l'écart entre l'arbre et
   * son ombre n'est pas perceptible, et lui faire suivre le vent coûterait une
   * seconde injection de shader dans la passe d'ombres.
   */
  advance(delta) {
    const wind = this.material?.userData?.wind;
    if (!wind || !Number.isFinite(delta)) return;
    wind.uWindTime.value = (wind.uWindTime.value + delta) % 1000;
  }

  /**
   * Accorde la couche sur l'état de la bulle : met en file les tuiles proches
   * pas encore plantées, retire celles qui sont sorties. Idempotent, et assez
   * bon marché pour être appelé à chaque recentrage.
   *
   * @param {boolean} [replant] Vrai quand la carte de classes vient d'arriver :
   *        ce qui a été planté avant elle l'a été à l'aveugle.
   */
  sync({ replant = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return;

    for (const key of [...this._planted]) {
      // Sortie de bulle, anneau devenu trop lointain, ou replantation forcée.
      const tile = this.bubble.tiles.get(key);
      if (replant || !tile || tile.ring > this.maxRing) this.remove(key);
    }

    this.queue.length = 0;
    for (const tile of this.bubble.tiles.values()) {
      if (tile.ring <= this.maxRing && !this._planted.has(tile.key)) this.queue.push(tile.key);
    }
  }

  /** Plante au plus une tuile. À appeler une fois par image. */
  processQueue() {
    if (this.disposed || this.queue.length === 0) return false;
    const key = this.queue.shift();
    const tile = this.bubble.tiles.get(key);
    if (!tile || this._planted.has(key)) return false;
    this._planted.add(key);
    try {
      this._build(tile);
    } catch (e) {
      console.warn('[vegetation] tuile non plantée', key, e?.message || e);
    }
    return true;
  }

  /** Retire les instances d'une tuile. */
  remove(key) {
    this._planted.delete(key);
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose?.();
    this.meshes.delete(key);
  }

  _build(tile) {
    const { THREE, bubble, groundClass } = this;
    const frame = bubble.frame;
    if (!frame || !groundClass) return;

    // Graine dérivée des coordonnées de la tuile : les mêmes arbres repoussent
    // au même endroit si la tuile est rechargée.
    const random = makeRandom((tile.x * 73856093) ^ (tile.y * 19349663));

    const cellSize = frame.scale / VEGETATION_CELLS;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;

    const placements = [];
    for (let cy = 0; cy < VEGETATION_CELLS && placements.length < MAX_TREES_PER_TILE; cy++) {
      for (let cx = 0; cx < VEGETATION_CELLS && placements.length < MAX_TREES_PER_TILE; cx++) {
        const centreX = originX + (cx + 0.5) * cellSize;
        const centreZ = originZ + (cy + 0.5) * cellSize;
        const score = groundClass.woodAt(centreX, centreZ);
        // Le peuplement décide de la densité autant que des essences : un
        // taillis est serré, une futaie clairsemée, et c'est ce contraste qui se
        // lit de loin.
        const type = forestTypeAt(centreX, centreZ, this.theme.forests);
        const count = treesForScore(score, TREES_PER_CELL * type.density, random());
        const variants = variantsFor(type, this.theme.trees.essences);

        for (let i = 0; i < count && placements.length < MAX_TREES_PER_TILE; i++) {
          const x = originX + (cx + random()) * cellSize;
          const z = originZ + (cy + random()) * cellSize;
          const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
          placements.push({
            x,
            y,
            z,
            height: type.minHeight + random() * (type.maxHeight - type.minHeight),
            rotation: random() * Math.PI,
            // Teinte : celle du peuplement, plus un écart par arbre. Un bois
            // dont tous les arbres ont exactement le même vert se lit comme un
            // aplat, quelle que soit la finesse des silhouettes.
            tint: 0.84 + random() * 0.28,
            hue: type.tint,
            variant: variants[Math.floor(random() * variants.length) % variants.length],
          });
        }
      }
    }

    if (placements.length === 0) return;

    // Géométrie clonée par tuile : l'attribut d'atlas est une donnée d'instance,
    // il ne peut pas vivre sur une géométrie partagée.
    const geometry = this.baseGeometry.clone();
    const offsets = new Float32Array(placements.length * 2);
    placements.forEach((tree, index) => {
      const [u, v] = TREE_ATLAS_OFFSETS[tree.variant];
      offsets[index * 2] = u;
      offsets[index * 2 + 1] = v;
    });
    geometry.setAttribute(ATLAS_ATTRIBUTE, new THREE.InstancedBufferAttribute(offsets, 2));

    const mesh = new THREE.InstancedMesh(geometry, this.material, placements.length);
    mesh.name = `vegetation-${tile.key}`;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true;
    // Un bois s'ombre lui-même : sans réception, tous les troncs seraient
    // également éclairés et le volume disparaîtrait.
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.depthMaterial;

    placements.forEach((tree, index) => {
      this._position.set(tree.x, tree.y, tree.z);
      this._quaternion.setFromAxisAngle(this._axis, tree.rotation);
      // Largeur proportionnelle à la hauteur : un arbre haut est aussi large.
      this._scale.set(tree.height * 0.72, tree.height, tree.height * 0.72);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
      this._color.setRGB(tree.tint * tree.hue[0], tree.tint * tree.hue[1], tree.tint * tree.hue[2]);
      mesh.setColorAt(index, this._color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();

    this.group.add(mesh);
    this.meshes.set(tile.key, mesh);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this._planted.clear();
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose?.();
    }
    this.meshes.clear();
    this.scene.remove(this.group);
    this.baseGeometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.texture.dispose();
  }
}
