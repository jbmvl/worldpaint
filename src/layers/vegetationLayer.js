/*
 * vegetationLayer — les arbres, en instances.
 * -------------------------------------------
 * Les arbres poussent là où la carte d'occupation du sol dit « bois »
 * (`groundClassMap`) : un polygone de bois vaut 1, une prairie 0, donc les
 * lisières sont nettes. C'est la même donnée que celle lue par le shader du
 * terrain, au même endroit — la texture du sol et ce qui y pousse ne peuvent
 * pas se contredire.
 *
 * `groundClassMap` ignore la voirie : un bois traverse une route sans que le
 * polygone qui le décrit s'interrompe, exactement comme sur le terrain. C'est
 * donc cette couche, et pas la carte de classes, qui doit refuser de planter
 * dans l'emprise (`roadCorridor`) — la même frontière que respectent l'herbe,
 * les cultures et les haies.
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
 * Un peuplement se plante en **strates**, et c'est ce qui lui donne du volume :
 * beaucoup de tiges moyennes, quelques dominants qui dépassent, et un sous-bois
 * de buissons compté en plus des arbres — trois échelles au lieu d'une. Sa
 * couleur, elle, dérive par **bosquets** de quelques dizaines de mètres
 * (`foliageTint`) : c'est ce qui fait un massif peint plutôt qu'un aplat vert.
 *
 * La plantation est mise en file et étalée sur plusieurs images : composer deux
 * mille matrices dans la même image se verrait comme un à-coup.
 *
 * Deux décisions à ne pas défaire :
 *
 * - le plafond d'une tuile **éclaircit** (`thinPlacements`), il ne rogne pas.
 *   S'arrêter de planter au milieu du parcours des mailles laissait le sud
 *   d'une tuile nu au milieu d'un massif ;
 * - une tuile semée alors que la carte de classes ne couvrait pas toute son
 *   emprise est retenue comme telle (`_blind`), et resemée quand la carte en
 *   sait davantage. Sans cela, une forêt dont la tuile était plantée avant que
 *   la carte ne l'atteigne ne poussait jamais — au même endroit, une fois oui,
 *   une fois non, selon l'ordre d'arrivée.
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
/**
 * Plafond global d'une tuile.
 *
 * Ce n'est pas un goût, c'est un budget : au-delà, la composition des matrices
 * se voit à l'image. Il ne **rogne** plus le semis pour autant — un plafond
 * atteint au milieu du parcours des mailles laissait le sud d'une tuile
 * entièrement nu alors que son nord était en forêt. C'est `thinPlacements` qui
 * s'en charge, en éclaircissant partout au lieu de couper quelque part.
 */
export const MAX_TREES_PER_TILE = 7000;
/**
 * Garde-fou de collecte : on ne construit jamais plus que cela d'objets
 * intermédiaires, même si la carte de classes annonçait un continent boisé.
 */
export const PLACEMENT_HARD_CAP = MAX_TREES_PER_TILE * 4;
/** Anneau au-delà duquel on ne plante plus (le brouillard s'en charge). */
export const VEGETATION_MAX_RING = 1;
/** Hauteur des arbres, en mètres. */
export const TREE_MIN_HEIGHT = 6;
export const TREE_MAX_HEIGHT = 15;
/** En deçà de cette part de boisé, la cellule ne reçoit aucun arbre. */
export const WOOD_SCORE_MIN = 0.22;
/**
 * Exposant de la courbe de densité. Au-dessus de 1, les scores moyens donnent
 * peu d'arbres et les scores forts en donnent beaucoup : c'est ce qui creuse la
 * différence entre une lisière et un sous-bois.
 *
 * Il reste au-dessus de 1 pour cette raison, mais moins haut qu'avant : la
 * filtration linéaire de la carte de classes étale un score moyen sur toute la
 * périphérie d'un massif, et un exposant trop fort vidait ces bords-là — un
 * petit bois, qui n'est *que* de la périphérie, en ressortait squelettique.
 */
export const WOOD_DENSITY_CURVE = 1.25;

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

// --- Les strates ---------------------------------------------------------------
/**
 * Exposant de la loi des hauteurs à l'intérieur d'un peuplement.
 *
 * Au-dessus de 1, le tirage se tasse vers la hauteur minimale : beaucoup de
 * jeunes tiges, quelques arbres faits. Un tirage uniforme entre `minHeight` et
 * `maxHeight` donne au contraire une houppe moyenne partout, et un massif qui
 * se lit comme une haie taillée vu de loin.
 */
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
/**
 * Côté de la maille qui fait dériver la teinte, en mètres.
 *
 * Bien plus fin que le peuplement : à l'intérieur d'un même bois, on veut des
 * **paquets** de verts différents — un versant qui jaunit, un fond de vallon qui
 * bleuit. C'est ce qui distingue une peinture d'un aplat, et une teinte tirée
 * arbre par arbre ne le donne pas : elle se moyenne à distance et le massif
 * redevient uni.
 */
export const CLUMP_TINT_M = 55;
/** Amplitude de la dérive d'un bosquet à l'autre, sur l'axe chaud-froid. */
export const CLUMP_TINT_SPREAD = 0.2;
/** Écart de teinte d'un arbre à l'autre, dans un même bosquet. */
export const TREE_TINT_SPREAD = 0.13;

/**
 * Teinte d'un feuillage : celle du peuplement, dérivée par bosquet puis par
 * arbre. Fonction pure et **ancrée au lieu** — deux arbres voisins portent des
 * verts voisins, et les mêmes à chaque reconstruction.
 *
 * La dérive de bosquet joue sur l'axe chaud-froid : le rouge et le bleu partent
 * en sens contraires, ce qui parcourt le vert du jaune paille au vert-de-gris
 * sans jamais le désaturer. Monter les deux ensemble n'aurait fait que du gris.
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
 * Éclaircit un semis trop nombreux **sans le rogner**.
 *
 * Le plafond d'une tuile ne peut pas être appliqué en s'arrêtant de planter :
 * les mailles sont parcourues du nord au sud, et s'arrêter en route laisse une
 * moitié de tuile nue au milieu d'un massif. On garde donc un point sur *n*,
 * régulièrement dans l'ordre du parcours : la densité baisse partout de la même
 * façon, et la forêt reste une forêt sur toute son emprise.
 *
 * Fonction pure, déterministe, et qui rend exactement `max` éléments.
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

/**
 * Silhouettes de la strate basse. Ce sont les buissons de l'atlas, quel que
 * soit le peuplement : un sous-bois n'est pas une miniature de sa futaie, c'est
 * une autre plante — noisetier, ronce, houx.
 */
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
    /**
     * Tuiles plantées **à l'aveugle** sur une part de leur emprise, avec la
     * couverture dont elles disposaient alors — de 0 (aucune carte, ou une carte
     * d'un autre repère) à moins de 1. Elles repartent en file dès que la carte
     * en sait davantage sur elles.
     *
     * C'est la réponse au « parfois oui, parfois non » : rien ne garantit que la
     * carte de classes couvre déjà une tuile au moment où la file l'atteint, et
     * une tuile plantée sans elle restait nue pour toujours.
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
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo. La houppe reste la partie la plus discrète du
   * décor à bouger : c'est le facteur qui change, jamais le fait qu'un arbre
   * balance dix fois moins qu'une touffe d'herbe.
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
      // Semée à l'aveugle sur une part de son emprise, et la carte en sait
      // maintenant plus qu'alors : on recommence. La condition est bien « plus
      // qu'alors » et non « incomplète », sinon une tuile de coin, qui déborde
      // structurellement du carré, serait replantée à chaque repeinte. Les
      // tuiles semées en connaissance de cause, elles, ne bougent plus — le
      // semis étant déterministe, les replanter ne ferait que clignoter.
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

  /**
   * Part de l'emprise d'une tuile dont la carte de classes peut parler, ici et
   * maintenant. Zéro tant qu'il n'y a pas de carte, ou tant qu'elle appartient
   * encore au repère précédent — dans ce dernier cas, ses coordonnées ne
   * veulent rien dire pour cette tuile.
   */
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

    // Graine dérivée des coordonnées de la tuile : les mêmes arbres repoussent
    // au même endroit si la tuile est rechargée.
    const random = makeRandom((tile.x * 73856093) ^ (tile.y * 19349663));

    const cellSize = frame.scale / VEGETATION_CELLS;
    const originX = (tile.x - frame.origin.x) * frame.scale;
    const originZ = (tile.y - frame.origin.y) * frame.scale;

    // Ce que la carte de classes sait de cette tuile est-il complet ? La réponse
    // se prend **avant** de semer, et se retient : c'est elle qui décidera de
    // recommencer, plus tard, quand la carte en saura davantage.
    const covered = this._coverageOf(tile);
    if (covered < 1) this._blind.set(tile.key, covered);

    const bushes = understoryVariants(this.theme.trees.essences);

    const collected = [];
    for (let cy = 0; cy < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cy++) {
      for (let cx = 0; cx < VEGETATION_CELLS && collected.length < PLACEMENT_HARD_CAP; cx++) {
        const centreX = originX + (cx + 0.5) * cellSize;
        const centreZ = originZ + (cy + 0.5) * cellSize;
        const score = groundClass.woodAt(centreX, centreZ);
        // Le peuplement décide de la densité autant que des essences : un
        // taillis est serré, une futaie clairsemée, et c'est ce contraste qui se
        // lit de loin.
        const type = forestTypeAt(centreX, centreZ, this.theme.forests);
        const count = treesForScore(score, TREES_PER_CELL * type.density, random());
        if (count === 0) continue;
        const variants = variantsFor(type, this.theme.trees.essences);
        // Le sous-bois se compte **en plus** des arbres : il épaissit le pied du
        // massif au lieu de prendre la place d'une houppe. Arrondi stochastique,
        // pour la même raison qu'au-dessus — sans lui, une part de 0,12 ne
        // donnerait jamais aucun buisson.
        const understory = Math.floor(count * (type.understory || 0) + random());

        for (let i = 0; i < count + understory; i++) {
          const bush = i >= count;
          const x = originX + (cx + random()) * cellSize;
          const z = originZ + (cy + random()) * cellSize;
          // Le bois ne s'arrête pas au bord de la route : c'est à la plantation,
          // pas à la carte de classes, de refuser l'emprise (voir l'en-tête).
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
            // Teinte : celle du peuplement, dérivée par bosquet puis par arbre.
            // Un bois dont tous les arbres ont exactement le même vert se lit
            // comme un aplat, quelle que soit la finesse des silhouettes. Le
            // sous-bois, lui, est plus sombre : il est à l'ombre des houppes.
            tint: (bush ? 0.66 : 0.84) + random() * 0.28,
            hue: type.tint,
            jitter: random(),
            variant: pool[Math.floor(random() * pool.length) % pool.length],
          });
        }
      }
    }

    if (collected.length === 0) return;
    const placements = thinPlacements(collected, MAX_TREES_PER_TILE);

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
      // Le rapport varie d'un arbre à l'autre, sans quoi deux arbres de même
      // hauteur sont exactement la même image à deux échelles près.
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
