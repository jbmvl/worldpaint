/*
 * vegetationLayer — les arbres, en volumes low poly instanciés.
 * ----------------------------------------------------------------
 * Les arbres poussent là où la carte d'occupation du sol dit « bois »
 * (`groundClassMap`) : un polygone de bois vaut 1, une prairie 0, donc les
 * lisières sont nettes. C'est la même donnée que celle lue par le shader du
 * terrain, au même endroit — la texture du sol et ce qui y pousse ne peuvent
 * pas se contredire.
 *
 * Chaque arbre est un petit volume facetté (`lowPolyForest.js`) — tronc balayé,
 * houppe en masse irrégulière —, dans le même style que les arbres de bord de
 * route et les buissons de jardin (`furnitureKit.Kit.rock`). Un panneau croisé
 * texturé se lit bien de face et se trahit dès qu'on le longe ; un volume ne
 * ment jamais sous aucun angle. Neuf essences (`theme.trees.variants`), plus
 * une rotation, une échelle et une teinte propres à chaque instance : un bois
 * cesse ainsi de ressembler à un clonage.
 *
 * Le prix, c'est le triangle : une quarantaine par arbre contre quatre pour un
 * panneau croisé — deux masses décentrées par houppe (voir
 * `lowPolyForest.buildEssenceGeometry`), pas une boule facettée unique, sans
 * quoi la houppe manque de la masse verte qu'un vrai feuillu porte.
 * `MAX_TREES_PER_TILE` a donc été redescendu à la bascule vers le volume —
 * voir sa note — pour garder un budget de rendu comparable par tuile ; le
 * semis de sous-bois, bien moins cher, reprend ce que les arbres perdent en
 * effectif (voir `MAX_UNDERSTORY_PER_TILE`).
 *
 * Elles ne sont pas tirées uniformément : une maille de terrain fixe un
 * **peuplement** (`FOREST_TYPES`), et c'est lui qui décide des essences, de la
 * hauteur et de la densité. Un mélange uniforme d'essences est exactement ce
 * qu'on ne voit jamais dehors.
 *
 * Un peuplement se plante en **strates**, et c'est ce qui lui donne du volume :
 * beaucoup de tiges moyennes, quelques dominants qui dépassent, et un **semis
 * de sous-bois** compté en plus des arbres — trois échelles au lieu d'une. Ce
 * semis n'est plus une essence à part entière : c'est un rocher facetté bon
 * marché (`lowPolyForest.buildScatterGeometry`, une quinzaine de triangles),
 * posé en nombre pour qu'un massif se lise plein au ras du sol et pas seulement
 * par ses houppes — c'est ce qui manque le plus **de près**, où l'œil est au
 * niveau du sous-bois et non de la canopée. Sa densité a son propre plafond
 * (`MAX_UNDERSTORY_PER_TILE`), séparé de celui des arbres : un semis bon marché
 * ne doit pas être rationné par le budget d'une essence qui coûte le triple.
 *
 * La couleur d'un arbre dérive par **bosquets** de quelques dizaines de mètres
 * (`foliageTint`) : c'est ce qui fait un massif peint plutôt qu'un aplat vert.
 * Elle se superpose à la teinte propre de l'essence, déjà portée par son volume
 * (`lowPolyForest.buildEssenceGeometry`, puisée dans le même nuancier que les
 * arbres de bord de route) — les deux se multiplient, jamais un aplat unique.
 *
 * La plantation est mise en file et étalée sur plusieurs images : composer deux
 * mille matrices dans la même image se verrait comme un à-coup. Une tuile peut
 * planter jusqu'à neuf maillages d'arbres — un par essence présente — plus
 * quelques-uns de semis, là où un seul suffisait aux panneaux croisés : c'est
 * le coût d'avoir une couleur de volume propre à chaque essence plutôt qu'un
 * décalage d'atlas par instance.
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

import { makeRandom } from '../materials/proceduralTextures.js';
import { randomAt } from './furniturePlacement.js';
import { buildEssenceGeometries, buildScatterGeometries } from './lowPolyForest.js';
import { createFoliageVolumeMaterial, advanceFoliageWind, setFoliageWind } from '../materials/foliageMaterial.js';
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
 *
 * Recalé à la bascule du panneau croisé (quatre triangles) vers le volume low
 * poly (`lowPolyForest.js`, autour de quarante triangles avec ses deux masses
 * décentrées par houppe) : c'est le même ordre de grandeur de triangles par
 * tuile qu'avant, pas la forêt éclaircie par goût — voir `MAX_UNDERSTORY_PER_TILE`
 * pour le semis de sous-bois, qui compense en nombre ce que les arbres perdent
 * en effectif.
 */
export const MAX_TREES_PER_TILE = 900;
/**
 * Plafond de semis de sous-bois par tuile — séparé de `MAX_TREES_PER_TILE`
 * parce qu'un rocher de semis coûte le tiers d'un arbre (`buildScatterGeometry`) :
 * le rationner avec le même budget que les arbres viderait le sous-bois avant
 * que le sol n'en soit couvert. C'est ce plafond-ci qui porte le remplissage
 * « de près » qu'un simple compte d'arbres ne donne jamais.
 */
export const MAX_UNDERSTORY_PER_TILE = 3000;
/**
 * Garde-fou de collecte : on ne construit jamais plus que cela d'objets
 * intermédiaires, même si la carte de classes annonçait un continent boisé.
 */
export const PLACEMENT_HARD_CAP = (MAX_TREES_PER_TILE + MAX_UNDERSTORY_PER_TILE) * 4;
/** Anneau au-delà duquel on ne plante plus (le brouillard s'en charge). */
export const VEGETATION_MAX_RING = 1;
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
/** Hauteur du semis de sous-bois, en mètres. */
export const BUSH_MIN_HEIGHT = 1.1;
export const BUSH_MAX_HEIGHT = 3.2;
/** Largeur d'un rocher de semis, en part de sa hauteur : plus large que haut. */
export const BUSH_ASPECT = 1.15;
/**
 * Facteur appliqué à `type.understory` (`FOREST_TYPES`) pour compter le semis
 * de sous-bois. Au-delà de 1 parce que ce semis n'est plus une essence à part
 * — juste un rocher bon marché (`lowPolyForest.buildScatterGeometry`) — et
 * peut donc se permettre d'être nettement plus nombreux que ne le voudrait la
 * part d'arbustes d'un peuplement, pour remplir un massif au ras du sol.
 */
export const UNDERSTORY_BOOST = 2.4;
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
/**
 * Amplitude de la dérive d'un bosquet à l'autre, sur l'axe chaud-froid.
 *
 * Relevée de 0,2 à 0,25 au passage au volume : l'atlas peint portait déjà une
 * bonne part de la variété d'un arbre à l'autre dans sa silhouette même, ce
 * qu'un volume aux essences moins nombreuses par tuile ne fait plus autant —
 * sans quoi un bois entier se lit comme une seule teinte. Plafonnée à 0,25 et
 * pas plus haut : au-delà, `clampChannel` écrête le canal chaud avant que le
 * froid n'ait fini de descendre, et la dérive cesse d'être symétrique autour
 * de la teinte moyenne.
 */
export const CLUMP_TINT_SPREAD = 0.25;
/** Écart de teinte d'un arbre à l'autre, dans un même bosquet. Même note que `CLUMP_TINT_SPREAD`. */
export const TREE_TINT_SPREAD = 0.22;

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

/** Variantes ouvertes à un peuplement, dans l'ordre de ses essences. */
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

    // Un volume par essence, plus quelques contours de semis bon marché,
    // construits une fois pour toutes et partagés par toutes les tuiles —
    // exactement comme `furnitureLayer` partage son catalogue de mobilier
    // entre tous ses maillages instanciés.
    this.geometries = buildEssenceGeometries(THREE, theme.trees.variants);
    this.scatterGeometries = buildScatterGeometries(THREE, theme.furniture.colors);
    // Couleurs de sommet, éclairage lambertien, `DoubleSide` pour les
    // quelques facettes qu'un contour irrégulier peut laisser mal orientées —
    // et le vent d'`injectFoliageWind`, seul artifice de feuillage qu'un
    // volume à vraies normales garde du panneau qu'il remplace.
    this.material = createFoliageVolumeMaterial({ THREE, wind: true, cacheKey: 'foliage-volume-forest-v1' });

    /** @type {Map<string, Object>} groupe de maillages instanciés, par clé de tuile */
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

  /** Sans texture, plus rien à filtrer — méthode gardée en repli inerte : */
  setMaxAnisotropy() {}

  /**
   * Fait avancer le vent dans les houppes. À appeler une fois par image.
   * Même fonction que le feuillage en panneau (`injectFoliageWind` porte le
   * même calcul) : un volume au tronc ancré à `y = 0` balance sa cime pour la
   * même raison qu'un panneau balance sa pointe.
   */
  advance(delta) {
    advanceFoliageWind(this.material, delta);
  }

  /**
   * Accorde le vent sur la météo. Voir `createFoliageMaterial` : l'amplitude
   * de référence est un réglage d'art propre à cette couche, la météo ne fait
   * que la multiplier.
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
    const group = this.meshes.get(key);
    if (!group) return;
    this.group.remove(group);
    // Les géométries d'essence sont partagées entre toutes les tuiles
    // (`this.geometries`, construites une seule fois) : seul le maillage
    // instancié de cette tuile-ci lui appartient en propre.
    for (const mesh of group.children) mesh.dispose?.();
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

    const collectedTrees = [];
    const collectedScatter = [];
    const cap = PLACEMENT_HARD_CAP;
    for (let cy = 0; cy < VEGETATION_CELLS && collectedTrees.length + collectedScatter.length < cap; cy++) {
      for (let cx = 0; cx < VEGETATION_CELLS && collectedTrees.length + collectedScatter.length < cap; cx++) {
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

        for (let i = 0; i < count; i++) {
          const x = originX + (cx + random()) * cellSize;
          const z = originZ + (cy + random()) * cellSize;
          const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
          collectedTrees.push({
            x,
            y,
            z,
            height: treeHeight(type, random(), random()),
            aspect: TREE_ASPECT + (random() - 0.5) * 2 * TREE_ASPECT_JITTER,
            rotation: random() * Math.PI,
            // Teinte : celle du peuplement, dérivée par bosquet puis par arbre.
            // Un bois dont tous les arbres ont exactement le même vert se lit
            // comme un aplat, quelle que soit la finesse des silhouettes.
            tint: 0.78 + random() * 0.46,
            hue: type.tint,
            jitter: random(),
            variant: variants[Math.floor(random() * variants.length) % variants.length],
          });
        }

        // Le semis de sous-bois se compte **en plus** des arbres, et sans
        // rapport avec leurs essences : c'est un remplissage au sol, pas une
        // strate d'arbustes identifiée. Multiplié par rapport à
        // `type.understory` (voir `FOREST_TYPES`) parce qu'un rocher de semis
        // coûte le tiers d'un arbre — voir `MAX_UNDERSTORY_PER_TILE`.
        const scatterCount = Math.floor(count * (type.understory || 0) * UNDERSTORY_BOOST + random());
        for (let i = 0; i < scatterCount; i++) {
          const x = originX + (cx + random()) * cellSize;
          const z = originZ + (cy + random()) * cellSize;
          const y = bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
          collectedScatter.push({
            x,
            y,
            z,
            height: BUSH_MIN_HEIGHT + random() * (BUSH_MAX_HEIGHT - BUSH_MIN_HEIGHT),
            aspect: BUSH_ASPECT,
            rotation: random() * Math.PI,
            // Plus sombre que la houppe : le sous-bois est à son ombre.
            tint: 0.6 + random() * 0.4,
            hue: type.tint,
            jitter: random(),
            variant: Math.floor(random() * this.scatterGeometries.length) % this.scatterGeometries.length,
          });
        }
      }
    }

    const trees = thinPlacements(collectedTrees, MAX_TREES_PER_TILE);
    const scatter = thinPlacements(collectedScatter, MAX_UNDERSTORY_PER_TILE);
    if (trees.length === 0 && scatter.length === 0) return;

    const tileGroup = new THREE.Group();
    tileGroup.name = `vegetation-${tile.key}`;

    // Un `InstancedMesh` ne porte qu'une seule géométrie : les arbres et le
    // semis sont donc groupés par variante, chacune vers son propre maillage.
    // Une tuile en bois mêlé peut ainsi poser jusqu'à neuf maillages d'arbres,
    // une tuile en futaie pure n'en pose que deux ou trois — c'est le nombre
    // de variantes réellement tirées qui décide, jamais un maximum fixe.
    this._addGrouped(tileGroup, tile.key, trees, this.geometries, 'tree');
    this._addGrouped(tileGroup, tile.key, scatter, this.scatterGeometries, 'scatter');

    this.group.add(tileGroup);
    this.meshes.set(tile.key, tileGroup);
  }

  /** Groupe des placements par variante et pose un `InstancedMesh` par groupe. */
  _addGrouped(tileGroup, tileKey, placements, geometries, label) {
    if (placements.length === 0) return;
    const { THREE } = this;
    const byVariant = new Map();
    for (const item of placements) {
      const bucket = byVariant.get(item.variant);
      if (bucket) bucket.push(item);
      else byVariant.set(item.variant, [item]);
    }

    for (const [variant, items] of byVariant) {
      const geometry = geometries[variant];
      if (!geometry) continue;

      const mesh = new THREE.InstancedMesh(geometry, this.material, items.length);
      mesh.name = `vegetation-${tileKey}-${label}-${variant}`;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.castShadow = true;
      // Un bois s'ombre lui-même : sans réception, tous les troncs seraient
      // également éclairés et le volume disparaîtrait.
      mesh.receiveShadow = true;

      items.forEach((item, index) => {
        this._position.set(item.x, item.y, item.z);
        this._quaternion.setFromAxisAngle(this._axis, item.rotation);
        // Largeur proportionnelle à la hauteur : un arbre haut est aussi large.
        // Le rapport varie d'un individu à l'autre, sans quoi deux arbres de
        // même hauteur sont exactement le même volume à deux échelles près.
        this._scale.set(item.height * item.aspect, item.height, item.height * item.aspect);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(index, this._matrix);
        const [r, g, b] = foliageTint(item.hue, item.x, item.z, item.tint, item.jitter);
        this._color.setRGB(r, g, b);
        mesh.setColorAt(index, this._color);
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      tileGroup.add(mesh);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this._planted.clear();
    this._blind.clear();
    for (const group of this.meshes.values()) {
      this.group.remove(group);
      for (const mesh of group.children) mesh.dispose?.();
    }
    this.meshes.clear();
    this.scene.remove(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const geometry of this.scatterGeometries) geometry.dispose();
    this.material.dispose();
  }
}
