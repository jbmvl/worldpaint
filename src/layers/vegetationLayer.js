/*
 * vegetationLayer — les arbres, en instances. Poussent là où
 * `groundClassMap` dit « bois » — même donnée que le shader du terrain,
 * jamais de contradiction. `groundClassMap` ignore la voirie (un bois
 * traverse une route sans s'interrompre) : c'est cette couche qui refuse de
 * planter dans l'emprise (`roadCorridor`).
 *
 * Chaque arbre est une paire de quadrilatères croisés (pas un modèle),
 * neuf silhouettes d'atlas, rotation/échelle/teinte propres à chaque
 * instance. Le peuplement (`FOREST_TYPES`, ancré à une maille de terrain)
 * décide des essences, hauteur, densité. Planté en strates (tiges moyennes,
 * dominants, sous-bois compté en plus) ; couleur dérivée par bosquets de
 * quelques dizaines de mètres (`foliageTint`).
 *
 * Plantation mise en file, une tuile par image (composer deux mille matrices
 * d'un coup se verrait comme un à-coup).
 *
 * Deux décisions à ne pas défaire : le plafond d'une tuile éclaircit
 * (`thinPlacements`), il ne rogne pas (sinon le sud d'une tuile resterait nu
 * au milieu d'un massif) ; une tuile semée alors que la carte de classes ne
 * couvrait pas toute son emprise est retenue comme telle (`_blind`) et
 * resemée quand la carte en sait davantage.
 */

import {
  makeRandom,
  createTreeAtlasCanvas,
  TREE_ATLAS_OFFSETS,
  TREE_ATLAS_COLS,
} from '../materials/proceduralTextures.js';
import { randomAt } from './furniturePlacement.js';
import { inCorridor } from './roadCorridor.js';
import {
  createFoliageMaterial,
  createFoliageDepthMaterial,
  createCrossedQuads,
  advanceFoliageWind,
  setFoliageWind,
  ATLAS_ATTRIBUTE,
} from '../materials/foliageMaterial.js';
import { defaultTheme } from '../themes/default.js';

/** Côté de la grille de plantation, par tuile (~36 m par cellule au zoom 15). */
export const VEGETATION_CELLS = 24;
/** Arbres au maximum par cellule. */
export const TREES_PER_CELL = 14;
/** Plafond global d'une tuile : un budget d'images, appliqué par éclaircissement (`thinPlacements`), pas par troncature. */
export const MAX_TREES_PER_TILE = 7000;
/** Garde-fou de collecte : jamais plus d'objets intermédiaires que cela, même sur un continent boisé annoncé. */
export const PLACEMENT_HARD_CAP = MAX_TREES_PER_TILE * 4;
/** Anneau au-delà duquel on ne plante plus (le brouillard s'en charge). */
export const VEGETATION_MAX_RING = 1;
/** Hauteur des arbres, en mètres. */
export const TREE_MIN_HEIGHT = 6;
export const TREE_MAX_HEIGHT = 15;
/** En deçà de cette part de boisé, la cellule ne reçoit aucun arbre. */
export const WOOD_SCORE_MIN = 0.22;
/** Exposant de la courbe de densité (au-dessus de 1, creuse la différence entre lisière et sous-bois). */
export const WOOD_DENSITY_CURVE = 1.25;

/**
 * Nombre d'arbres à poser dans une cellule, d'après sa part de boisé.
 * Arrondi stochastique : `floor(attendu + jitter)` a pour espérance
 * `attendu`, ce qui donne un semis irrégulier plutôt qu'un effet de verger.
 */
export function treesForScore(score, maxPerCell, jitter = 0) {
  if (score < WOOD_SCORE_MIN) return 0;
  const normalized = (score - WOOD_SCORE_MIN) / (1 - WOOD_SCORE_MIN);
  const expected = Math.pow(normalized, WOOD_DENSITY_CURVE) * maxPerCell;
  return Math.floor(expected + jitter);
}

// --- Les strates ---------------------------------------------------------------
/** Exposant de la loi des hauteurs (au-dessus de 1, tasse le tirage vers la hauteur minimale : jeunes tiges + quelques arbres faits). */
export const HEIGHT_CURVE = 1.35;
/** Part d'arbres **dominants**, ceux qui dépassent la houppe commune. */
export const EMERGENT_SHARE = 0.11;
/** Ce qu'un dominant ajoute à la hauteur du peuplement. */
export const EMERGENT_GAIN = 1.3;
/** Hauteur des buissons de sous-bois, en mètres. */
export const BUSH_MIN_HEIGHT = 1.1;
export const BUSH_MAX_HEIGHT = 3.2;
/** Largeur d'un buisson, en part de sa hauteur : il est plus large que haut. */
export const BUSH_ASPECT = 1.15;
/** Largeur d'un arbre, en part de sa hauteur, et l'écart d'un arbre à l'autre. */
export const TREE_ASPECT = 0.72;
export const TREE_ASPECT_JITTER = 0.18;

/**
 * Hauteur d'un arbre dans son peuplement. Fonction pure.
 *
 * @param {Object} type Peuplement (`FOREST_TYPES`).
 * @param {number} draw Tirage uniforme dans [0, 1[ — la strate.
 * @param {number} pick Second tirage : décide du statut de dominant.
 */
export function treeHeight(type, draw, pick) {
  const span = type.maxHeight - type.minHeight;
  const base = type.minHeight + Math.pow(draw, HEIGHT_CURVE) * span;
  return pick < EMERGENT_SHARE ? base * EMERGENT_GAIN : base;
}

// --- La teinte -----------------------------------------------------------------
/** Côté de la maille qui fait dériver la teinte, en mètres (plus fin que le peuplement, pour des paquets de verts différents). */
export const CLUMP_TINT_M = 55;
/** Amplitude de la dérive d'un bosquet à l'autre, sur l'axe chaud-froid. */
export const CLUMP_TINT_SPREAD = 0.2;
/** Écart de teinte d'un arbre à l'autre, dans un même bosquet. */
export const TREE_TINT_SPREAD = 0.13;

/**
 * Teinte d'un feuillage : celle du peuplement, dérivée par bosquet puis par
 * arbre, ancrée au lieu. La dérive de bosquet joue sur l'axe chaud-froid
 * (rouge et bleu en sens contraires) pour parcourir le vert sans le désaturer.
 *
 * @param {number[]} hue Teinte du peuplement, trois canaux.
 * @param {number} x Mètres locaux.
 * @param {number} z
 * @param {number} shade Facteur de clarté propre à l'arbre.
 * @param {number} jitter Tirage uniforme dans [0, 1[, propre à l'arbre.
 * @returns {number[]} trois canaux, à multiplier par la texture.
 */
export function foliageTint(hue, x, z, shade, jitter) {
  const gx = Math.floor(x / CLUMP_TINT_M) * CLUMP_TINT_M;
  const gz = Math.floor(z / CLUMP_TINT_M) * CLUMP_TINT_M;
  const drift = (randomAt(gx, gz, 197) - 0.5) * 2;
  const spread = (jitter - 0.5) * 2 * TREE_TINT_SPREAD;
  const warm = drift * CLUMP_TINT_SPREAD;
  return [
    clampChannel(hue[0] * shade * (1 + warm + spread)),
    clampChannel(hue[1] * shade * (1 - Math.abs(warm) * 0.25)),
    clampChannel(hue[2] * shade * (1 - warm - spread)),
  ];
}

function clampChannel(v) {
  return Math.max(0, Math.min(1.25, v));
}

/**
 * Éclaircit un semis trop nombreux sans le rogner : garde un point sur `n`,
 * régulièrement dans l'ordre du parcours, plutôt que de s'arrêter en route.
 * Déterministe, rend exactement `max` éléments.
 */
export function thinPlacements(list, max) {
  if (list.length <= max) return list;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (Math.floor(((i + 1) * max) / list.length) > Math.floor((i * max) / list.length)) {
      out.push(list[i]);
    }
  }
  return out;
}

/**
 * Gain de couverture en deçà duquel on ne replante pas une tuile semée à
 * l'aveugle : un carré qui glisse de quelques mètres n'apprend rien de neuf.
 */
export const BLIND_EPSILON = 0.02;

/** Côté de la maille qui décide du peuplement, en mètres. */
export const FOREST_PATCH_M = 420;

/** Peuplement d'un point du sol, ancré au lieu (une forêt garde ses essences quand la bulle se déplace). */
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

/** Silhouettes de la strate basse (les buissons de l'atlas, une autre plante que sa futaie — noisetier, ronce, houx). */
export function understoryVariants(essences = defaultTheme.trees.essences) {
  const bushy = essences.bushy || [];
  return bushy.length > 0 ? bushy : [0];
}

export class VegetationLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} options.groundClass Instance `GroundClassMap` — sans elle,
   *        rien ne pousse : on ne devine pas un bois.
   * @param {Object} [options.roads] Instance `RoadNetwork` — un arbre ne se
   *        plante pas sur la chaussée, même quand le polygone de bois la
   *        traverse.
   */
  constructor({
    THREE,
    scene,
    bubble,
    groundClass = null,
    roads = null,
    maxRing = VEGETATION_MAX_RING,
    theme = defaultTheme,
  }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.roads = roads;
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
      wind: true, // dix fois plus discret que dans l'herbe
      windStrength: 0.05,
      cacheKey: 'foliage-atlas-wind-v2',
    });
    this.depthMaterial = createFoliageDepthMaterial({
      THREE,
      map: this.texture,
      tiles: TREE_ATLAS_COLS,
      cacheKey: 'foliage-atlas-depth-v1',
    });

    /** @type {Map<string, Object>} maillages instanciés, par clé de tuile */
    this.meshes = new Map();
    /** Tuiles déjà traitées, y compris celles où rien n'a poussé (sinon reclassée à chaque image en rase campagne). @type {Set<string>} */
    this._planted = new Set();
    /**
     * Tuiles plantées à l'aveugle sur une part de leur emprise, avec la
     * couverture dont elles disposaient alors ; repartent en file dès que la
     * carte en sait davantage.
     * @type {Map<string, number>}
     */
    this._blind = new Map();
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

  /** Fait avancer le vent dans les houppes (l'ombre portée, elle, ne balance pas). */
  advance(delta) {
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo.
   * @param {{amplitude:number, speed:number}} field
   */
  setWind(field) {
    setFoliageWind(this.material, field);
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
      if (replant || !tile || tile.ring > this.maxRing) {
        this.remove(key);
        continue;
      }
      // « Plus qu'alors », pas « incomplète » : sinon une tuile de coin, qui
      // déborde structurellement du carré, serait replantée à chaque repeinte.
      const before = this._blind.get(key);
      if (before !== undefined && this._coverageOf(tile) > before + BLIND_EPSILON) {
        this.remove(key);
      }
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
    this._blind.delete(key);
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose?.();
    this.meshes.delete(key);
  }

  /** Part de l'emprise d'une tuile dont la carte de classes peut parler, ici et maintenant. */
  _coverageOf(tile) {
    const frame = this.bubble?.frame;
    if (!frame || !this.groundClass) return 0;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;
    return this.groundClass.coverageOf(
      originX,
      originZ,
      originX + frame.scale,
      originZ + frame.scale,
      frame
    );
  }

  _build(tile) {
    const { THREE, bubble, groundClass } = this;
    const frame = bubble.frame;
    if (!frame || !groundClass) return;
    const roadIndex = this.roads?.index || null;

    // Graine dérivée des coordonnées de la tuile.
    const random = makeRandom((tile.x * 73856093) ^ (tile.y * 19349663));

    const cellSize = frame.scale / VEGETATION_CELLS;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;

    // Prise avant de semer, et retenue pour décider de recommencer plus tard.
    const covered = this._coverageOf(tile);
    if (covered < 1) this._blind.set(tile.key, covered);

    const bushes = understoryVariants(this.theme.trees.essences);

    const collected = [];
    for (let cy = 0; cy < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cy++) {
      for (let cx = 0; cx < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cx++) {
        const centreX = originX + (cx + 0.5) * cellSize;
        const centreZ = originZ + (cy + 0.5) * cellSize;
        const score = groundClass.woodAt(centreX, centreZ);
        const type = forestTypeAt(centreX, centreZ, this.theme.forests);
        const count = treesForScore(score, TREES_PER_CELL * type.density, random());
        if (count === 0) continue;
        const variants = variantsFor(type, this.theme.trees.essences);
        // Le sous-bois se compte en plus des arbres (épaissit le pied du massif).
        const understory = Math.floor(count * (type.understory || 0) + random());

        for (let i = 0; i < count + understory; i++) {
          const bush = i >= count;
          const x = originX + (cx + random()) * cellSize;
          const z = originZ + (cy + random()) * cellSize;
          if (inCorridor(roadIndex, x, z)) continue;
          const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
          const height = bush
            ? BUSH_MIN_HEIGHT + random() * (BUSH_MAX_HEIGHT - BUSH_MIN_HEIGHT)
            : treeHeight(type, random(), random());
          const pool = bush ? bushes : variants;
          collected.push({
            x,
            y,
            z,
            height,
            aspect: bush
              ? BUSH_ASPECT
              : TREE_ASPECT + (random() - 0.5) * 2 * TREE_ASPECT_JITTER,
            rotation: random() * Math.PI,
            tint: (bush ? 0.66 : 0.84) + random() * 0.28, // sous-bois plus sombre : à l'ombre des houppes
            hue: type.tint,
            jitter: random(),
            variant: pool[Math.floor(random() * pool.length) % pool.length],
          });
        }
      }
    }

    if (collected.length === 0) return;
    const placements = thinPlacements(collected, MAX_TREES_PER_TILE);

    // Géométrie clonée par tuile : l'attribut d'atlas est une donnée d'instance.
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
    mesh.receiveShadow = true; // un bois s'ombre lui-même

    mesh.customDepthMaterial = this.depthMaterial;

    placements.forEach((tree, index) => {
      this._position.set(tree.x, tree.y, tree.z);
      this._quaternion.setFromAxisAngle(this._axis, tree.rotation);
      // Rapport largeur/hauteur variable, sinon deux arbres de même hauteur sont la même image à l'échelle près.
      this._scale.set(tree.height * tree.aspect, tree.height, tree.height * tree.aspect);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
      const [r, g, b] = foliageTint(tree.hue, tree.x, tree.z, tree.tint, tree.jitter);
      this._color.setRGB(r, g, b);
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
    this._blind.clear();
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
