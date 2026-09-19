/*
 * furniturePlacement — où va le mobilier, et pourquoi. Tout ce fichier est
 * pur, testable sans navigateur.
 *
 * Deux régimes : position réelle (le mobilier suit une géométrie OSM
 * effectivement servie) et position plausible (l'objet n'est pas dans les
 * tuiles — schéma OpenMapTiles, qui ne porte ni `barrier=hedge`,
 * `highway=street_lamp`, `power=tower`, `traffic_sign` ni
 * `highway=milestone` — mais sa présence se déduit de ce qui l'est).
 *
 * Le second régime doit être déterministe et ancré au sol : toutes les
 * graines dérivent d'une position absolue quantifiée (`positionSeed`), tous
 * les espacements se comptent depuis le premier sommet de la ligne d'origine
 * (pas depuis le tronçon découpé, qui bouge avec l'observateur).
 */

import { makeRandom } from '../materials/proceduralTextures.js';
import { cropForFarming, sharesFor } from '../core/regionInterpretation.js';

/** Pas de quantification des graines de position, en mètres. */
export const SEED_GRID_M = 0.5;

/** Graine déterministe attachée à un point du sol (indépendante de l'ordre de parcours). */
export function positionSeed(x, z, salt = 0) {
  const gx = Math.round(x / SEED_GRID_M) | 0;
  const gz = Math.round(z / SEED_GRID_M) | 0;
  let h = (gx * 73856093) ^ (gz * 19349663) ^ ((salt | 0) * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Tirage dans [0, 1[ attaché à un point du sol. Fonction pure. */
export function randomAt(x, z, salt = 0) {
  return positionSeed(x, z, salt) / 4294967296;
}

/**
 * Répartit des points à pas constant le long d'une polyligne ré-échantillonnée.
 * `startDistance` est comptée depuis le dernier nœud d'ancrage (voir
 * `roadGraph.js`), pas depuis le tronçon découpé qui bouge avec l'observateur.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {number} spacing  Écartement, en mètres.
 * @param {Object} [options]
 * @param {number} [options.startDistance] Décalage d'origine, en mètres.
 * @param {number} [options.phase] Décalage supplémentaire, en mètres.
 * @param {number} [options.margin] Marge morte aux deux bouts, en mètres.
 * @returns {Array<{x:number,z:number,tx:number,tz:number,distance:number,index:number}>}
 *          `distance` se compte dans le tronçon, `index` est le rang absolu —
 *          c'est lui qui doit servir à alterner un côté et l'autre.
 */
export function spacedAlongPath(path, spacing, { startDistance = 0, phase = 0, margin = 0 } = {}) {
  const out = [];
  if (!Array.isArray(path) || path.length < 2 || spacing <= 0) return out;

  const total = path[path.length - 1].distance;
  const first = Math.ceil((startDistance + phase + margin) / spacing);
  const last = Math.floor((startDistance + total - margin) / spacing);

  let cursor = 1;
  for (let n = first; n <= last; n++) {
    const target = n * spacing - startDistance - phase;
    while (cursor < path.length - 1 && path[cursor].distance < target) cursor++;

    const a = path[cursor - 1];
    const b = path[cursor];
    const span = b.distance - a.distance || 1;
    const t = Math.min(1, Math.max(0, (target - a.distance) / span));

    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const length = Math.hypot(tx, tz) || 1;
    out.push({
      x: a.x + tx * t,
      z: a.z + tz * t,
      tx: tx / length,
      tz: tz / length,
      distance: target,
      index: n,
      // La ligne d'où l'objet sort, pour ce qui a un tableau par ligne à lire
      // (la plate-forme, la courbure) : le pas du tracé n'étant pas constant,
      // elle ne se retrouve pas en divisant une distance.
      row: t < 0.5 ? cursor - 1 : cursor,
    });
  }
  return out;
}

/**
 * Vrai si un segment de contour longe le bord de sa tuile (les polygones
 * d'occupation du sol sont tranchés à chaque frontière, sinon on dessinerait
 * une haie sur des limites qui n'existent pas). Test en longitude/latitude,
 * avant toute projection, là où la frontière est une droite exacte.
 *
 * @param {number[]} a Point `[lng, lat]`.
 * @param {number[]} b
 * @param {{west:number,east:number,north:number,south:number}} bounds
 * @param {number} [tolerance] Part de la tuile tolérée (1/4096 = un pas de la
 *        grille interne du format MVT).
 */
export function isTileEdgeSegment(a, b, bounds, tolerance = 1.5 / 4096) {
  if (!bounds) return false;
  const spanLng = Math.abs(bounds.east - bounds.west);
  const spanLat = Math.abs(bounds.north - bounds.south);
  const epsLng = spanLng * tolerance;
  const epsLat = spanLat * tolerance;

  const onLng = (value) =>
    Math.abs(value - bounds.west) <= epsLng || Math.abs(value - bounds.east) <= epsLng;
  const onLat = (value) =>
    Math.abs(value - bounds.north) <= epsLat || Math.abs(value - bounds.south) <= epsLat;

  return (onLng(a[0]) && onLng(b[0])) || (onLat(a[1]) && onLat(b[1]));
}

/**
 * Découpe un anneau en tronçons de contour réel, en retirant les bords de
 * découpe. Un anneau qui n'en porte aucun ressort d'un seul tenant, refermé.
 *
 * @param {Array<number[]>} ring Anneau GeoJSON `[[lng, lat], …]`.
 * @param {Object} bounds Emprise de la tuile (`tileBounds`).
 * @param {number} [minPoints]
 * @returns {Array<Array<number[]>>}
 */
export function realBoundaryRuns(ring, bounds, minPoints = 2) {
  if (!Array.isArray(ring) || ring.length < 2) return [];

  const runs = [];
  let current = null;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (isTileEdgeSegment(a, b, bounds)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [a];
      runs.push(current);
    }
    current.push(b);
  }

  return runs.filter((run) => run.length >= minPoints);
}

/**
 * Le traitement de contour par défaut : le bocage français, et le repli de
 * tout pays qu'on ne connaît pas.
 *
 * Ce sont **exactement** les seuils qui étaient écrits en dur dans
 * `boundaryFurnitureFor` : sans région, rien ne change.
 *
 * - `stoneSlope` — pente à partir de laquelle on bâtit un mur plutôt que de
 *   clore. `stoneSlopeTilled` est la même pour une terre travaillée et pour la
 *   roche affleurante, où la pierre est déjà là : elle sort plus tôt ;
 * - `plough` et `pasture` — parts cumulées (voir `pickShare`), `null` valant
 *   « rien du tout », qui est le cas le plus fréquent en openfield.
 */
export const DEFAULT_BOUNDARY_MIX = {
  stoneSlope: 0.2,
  stoneSlopeTilled: 0.12,
  plough: [['hedge', 0.4], ['lowHedge', 0.22], [null, 0.38]],
  pasture: [['hedge', 0.2], ['woodFence', 0.38], ['barbedWire', 0.42]],
};

/**
 * Comment on borne un champ, par style de limite (`boundaryForMatrix`).
 *
 * C'est la trame du paysage agraire, et elle se lit de plus loin que la
 * couleur d'un mur : un bocage compartimente l'horizon en chambres de deux
 * cents mètres, un openfield le laisse filer, une terrasse le raye de lignes
 * de pierre. Tant que toutes les limites portaient la même haie, une plaine
 * castillane était un bocage normand jauni.
 *
 * Ce qui décide, dans l'ordre : la pierre est là où le sol en donne — pente,
 * causse, karst —, la haie vive là où il pleut et où l'élevage est ancien, le
 * bois là où la forêt est proche, et le rien partout où la terre est trop
 * grande ou trop pauvre pour qu'on la clôture.
 *
 * Un style absent retombe sur le bocage par défaut.
 */
export const BOUNDARY_MIXES = {
  bocage: DEFAULT_BOUNDARY_MIX,
  // Openfield : la plaine polonaise ou beauceronne ne se compartimente pas.
  openfield: {
    stoneSlope: 0.24,
    stoneSlopeTilled: 0.2,
    plough: [[null, 0.82], ['hedge', 0.1], ['lowHedge', 0.08]],
    pasture: [['barbedWire', 0.5], ['woodFence', 0.3], [null, 0.15], ['hedge', 0.05]],
  },
  // Terrasses, causses, Connemara : la pierre sort du premier pli de terrain,
  // et elle est partout.
  drystone: {
    stoneSlope: 0.05,
    stoneSlopeTilled: 0.04,
    plough: [['dryStoneWall', 0.5], [null, 0.4], ['lowHedge', 0.1]],
    pasture: [['dryStoneWall', 0.6], ['barbedWire', 0.25], [null, 0.15]],
  },
  // Là où le bois est la matière la moins chère, on clôt en bois.
  wood_fence: {
    stoneSlope: 0.28,
    stoneSlopeTilled: 0.24,
    plough: [[null, 0.75], ['lowHedge', 0.15], ['hedge', 0.1]],
    pasture: [['woodFence', 0.6], ['barbedWire', 0.25], [null, 0.15]],
  },
  // Une parcelle qu'on ne clôt pas, parce qu'il n'y a rien à retenir dedans.
  none: {
    stoneSlope: 0.12,
    stoneSlopeTilled: 0.1,
    plough: [[null, 0.85], ['dryStoneWall', 0.15]],
    pasture: [[null, 0.6], ['barbedWire', 0.25], ['dryStoneWall', 0.15]],
  },
};


/**
 * Traitement de contour d'une parcelle, d'après ses attributs OpenMapTiles.
 * Suit le paysage agraire réel : bocage sur les labours, clôture sur les
 * pâtures, muret là où le terrain est accidenté (`steepness`). Et là où le
 * pays le veut : le partage lui-même change d'un style à l'autre, voir
 * `BOUNDARY_MIXES`. Sans région, c'est le bocage français à la valeur près.
 *
 * @param {Object} properties Attributs de l'entité.
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour, en pente relative.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @param {string|null} [context.boundary] Style de limite (`boundaryForMatrix`).
 * @returns {string|null} clé de `FURNITURE_PROFILES`, ou `null`.
 */
export function boundaryFurnitureFor(
  properties = {},
  { steepness = 0, variant = 0, crop = null, boundary = null } = {}
) {
  const klass = properties.class;
  const subclass = properties.subclass;
  const mix = (boundary && BOUNDARY_MIXES[boundary]) || DEFAULT_BOUNDARY_MIX;

  // Rocher, éboulis, causse : rien à clore, mais de quoi bâtir.
  if (klass === 'rock') return steepness > mix.stoneSlopeTilled ? 'dryStoneWall' : null;
  if (klass === 'wood' || klass === 'wetland' || klass === 'sand' || klass === 'ice') return null;

  const isFarmland = klass === 'farmland';
  const isGrass = klass === 'grass' || subclass === 'meadow' || subclass === 'grassland';
  if (!isFarmland && !isGrass) return null;

  // Passé cette pente, la clôture cède la place au mur : c'est le paysage de
  // terrasses et de parcellaire de montagne. Où elle se situe est une affaire
  // de pays — sur un causse ou dans les Cyclades, la pierre sort du premier
  // pli de terrain.
  if (steepness > mix.stoneSlope) return 'dryStoneWall';

  if (isFarmland) {
    if (steepness > mix.stoneSlopeTilled) return 'dryStoneWall';
    // Une parcelle en culture ne se clôt pas (le blé, le maïs ne s'échappent pas).
    if (crop && crop !== 'plough') return null;
    return pickShare(mix.plough, variant);
  }

  return pickShare(mix.pasture, variant);
}

/**
 * L'assolement par défaut : celui de la France, et le repli de tout lieu sans
 * région. Parts cumulées dans l'ordre.
 *
 * C'étaient les seuils écrits en dur dans `cropFor` ; le colza y a pris sa
 * part depuis, parce qu'une plaine céréalière française en porte autant que de
 * tournesol. La lavande, elle, n'y est pas : c'est une culture de pays, pas un
 * repli.
 */
export const DEFAULT_CROP_MIX = [
  ['wheat', 0.3],
  ['plough', 0.16],
  ['maize', 0.14],
  ['rapeseed', 0.12],
  ['sunflower', 0.1],
  ['vineyard', 0.08],
  ['orchard', 0.06],
  ['plough', 0.04],
];


/**
 * Tire une valeur dans une table de parts cumulées. Fonction pure.
 *
 * Deux tables l'utilisent — l'assolement d'un champ et le traitement de sa
 * limite — écrites de la même façon pour la même raison : des choix qu'on
 * relit pays par pays, sans démêler une cascade de conditions.
 *
 * @param {Array<[*, number]>} mix Parts cumulées, dans l'ordre.
 * @param {number} variant Tirage dans [0, 1[ attaché au lieu.
 */
export function pickShare(mix, variant) {
  let sum = 0;
  for (const [value, share] of mix) {
    sum += share;
    if (variant < sum) return value;
  }
  return mix[mix.length - 1][0];
}

/**
 * Ce qui pousse dans un champ, d'après ses attributs, un tirage de parcelle et
 * l'assolement du pays. Le schéma OpenMapTiles ne dit jamais la culture (sauf
 * verger, vigne, pépinière) : le reste est déduit.
 *
 * Ce que dit la donnée passe avant le pays : une vigne cartographiée reste une
 * vigne, où qu'elle soit. Le pays ne décide que de ce qu'on ignore.
 *
 * L'assolement arrive en clair — la liste `farming` d'un dossier de région,
 * ordonnée du plus répandu au moins répandu — et ses parts se déduisent du rang
 * (`sharesFor`). Il n'y a pas de table intermédiaire : ce qui pousse dans un
 * pays est écrit dans le pays.
 *
 * @param {Object} properties
 * @param {number} variant Tirage dans [0, 1[ attaché à la parcelle.
 * @param {string[]|null} [farming] Assolement du pays (`region.farming`).
 * @returns {'wheat'|'maize'|'sunflower'|'vineyard'|'orchard'|'plough'|'lavender'|'rapeseed'|null}
 */
export function cropFor(properties = {}, variant = 0, farming = null) {
  const klass = properties.class;
  const subclass = properties.subclass;

  if (subclass === 'vineyard') return 'vineyard';
  if (subclass === 'orchard' || subclass === 'plant_nursery') return 'orchard';
  if (klass !== 'farmland') return null;

  const mix = farming?.length
    ? sharesFor(farming).map(([word, share]) => [cropForFarming(word), share])
    : DEFAULT_CROP_MIX;
  return pickShare(mix, variant);
}

/**
 * Mot d'assolement retenu pour un champ, tiré comme `cropFor` (même parts,
 * mêmes rangs) mais rendu **avant** sa traduction en culture de `CROP_KINDS`.
 *
 * Sert aux mots que l'assolement porte sans que `CROP_KINDS` sache les
 * peindre — la serre, qui n'est pas une texture mais une structure posée sur
 * la parcelle (`furniture/parcels.js`). `null` hors champ cultivé ou pays sans
 * assolement écrit.
 *
 * Fonction pure.
 */
export function farmingWordFor(properties = {}, variant = 0, farming = null) {
  const klass = properties.class;
  const subclass = properties.subclass;
  if (subclass === 'vineyard' || subclass === 'orchard' || subclass === 'plant_nursery') return null;
  if (klass !== 'farmland' || !farming?.length) return null;
  return pickShare(sharesFor(farming), variant);
}

/**
 * Cultures semées en rangs visibles, donc balayées et non semées en vrac.
 *
 * La lavande y est pour la même raison que la vigne : de loin c'est une
 * teinte (`cropAlbedo`), de près ce sont des lignes de petites haies, pas un
 * semis dru — c'est le rang qui la fait reconnaître, pas le buisson isolé.
 *
 * La serre n'est pas un semis du tout : c'est une structure. Elle emprunte le
 * même passage parce qu'un maraîchage sous serre couvre la parcelle de
 * tunnels côte à côte, sur le même principe géométrique qu'un rang de vigne —
 * un balayage le long du plus long côté, coupé aux vraies limites du champ.
 */
export const ROW_CROPS = new Set(['vineyard', 'orchard', 'lavender', 'greenhouse']);

/**
 * Les cultures, dans l'ordre de leur identifiant (`indice + 1`, zéro = aucune
 * culture). Peint dans la carte des cultures (`groundClassMap`) et relu par
 * le shader de terrain et `cropLayer` — l'ordre est gravé, le changer repeint
 * des champs d'une autre culture.
 */
export const CROP_KINDS = [
  'wheat',
  'maize',
  'sunflower',
  'plough',
  'vineyard',
  'orchard',
  'lavender',
  'rapeseed',
  'rice',
];

/**
 * Pas entre deux identifiants dans le canal rouge.
 *
 * Il était de 40, ce qui plafonnait à six cultures (7 × 40 dépasse 255). Neuf
 * cultures tiennent à 28 (9 × 28 = 252), avec trois de marge à l'arrondi de la
 * texture — c'est la dernière place : un dixième identifiant exige de baisser
 * le pas.
 */
export const CROP_ID_STEP = 28;

/** Identifiant d'une culture dans la carte, ou 0. Fonction pure. */
export function cropId(crop) {
  const index = CROP_KINDS.indexOf(crop);
  return index < 0 ? 0 : index + 1;
}

/** Culture portée par une valeur du canal rouge, ou `null`. Fonction pure. */
export function cropFromId(red) {
  const index = Math.round(red / CROP_ID_STEP) - 1;
  return CROP_KINDS[index] || null;
}

/**
 * Ce qui se sème à l'intérieur d'une parcelle. Densités volontairement
 * basses (un décor procédural surcharge facilement). `herd` sème du
 * troupeau, qui se regroupe (voir `clusterInRing`) plutôt que se répartir.
 *
 * @returns {{item:string, perHectare:number}|null}
 */
export function scatterFurnitureFor(properties = {}, { crop = null } = {}) {
  const klass = properties.class;
  const subclass = properties.subclass;

  if (klass === 'farmland' || crop) {
    // Un champ en culture n'a rien à semer par-dessus (couvert par `cropLayer`).
    if (crop && crop !== 'plough') return null;
    return { item: 'hay', perHectare: 0.4 };
  }
  // Pâture : c'est du bétail qu'on y attend, pas des bosquets.
  //
  // La densité a été relevée de 1,1 à 2,4 bêtes à l'hectare — au-dessus du
  // chargement réel d'une prairie laitière, et c'est voulu : les bêtes sont
  // groupées (`clusterInRing`), donc un pré n'en montre qu'une poignée au
  // même endroit, et la bulle n'en offre que 700 mètres. À 1,1, un bocage
  // entier ne portait qu'une trentaine de bêtes réparties sur une centaine de
  // parcelles : la moitié des prés étaient vides.
  if (klass === 'grass' || subclass === 'meadow' || subclass === 'grassland') {
    return { item: 'herd', perHectare: 2.4 };
  }
  // Bois : du bois de coupe, rangé en lisière. La densité se compte à
  // l'hectare comme le reste, mais l'ourlet en écarte l'essentiel (voir
  // `WOOD_PILE_EDGE_MIN`) — un massif compact en porte donc proportionnellement
  // moins qu'un bosquet, ce qui est juste : le tas est au bord, pas au milieu.
  if (klass === 'wood') {
    // Pseudo-objet, comme `herd` : la couche en tire deux choses, le bois rangé
    // en lisière et ce qui vit dedans. La densité annoncée est celle des tas.
    return { item: 'woodland', perHectare: 0.8 };
  }
  return null;
}

/**
 * Part de lisière (`groundClassMap.woodEdgeAt`) en deçà de laquelle on
 * n'empile pas de bois. Un tas de bois se fait là où le tracteur passe — au
 * bord du massif, jamais en son cœur.
 */
export const WOOD_PILE_EDGE_MIN = 0.35;

/**
 * Part d'ovins d'une pâture de plaine, par matrice de paysage. La pente disait
 * déjà l'essentiel — le mouton broute où la vache ne monte plus — mais rien du
 * pays : une plaine irlandaise et une plaine castillane ont la même pente et
 * pas le même troupeau. Une matrice absente garde `DEFAULT_SHEEP_ODDS`.
 */
export const HERD_SHEEP_ODDS = {
  // Bocage et prairie humide : le bovin, et c'est ce qui fait le paysage laitier.
  hedgerow_meadow: 0.28,
  wet_grassland: 0.26,
  openfield_cropland: 0.3,
  // Lande atlantique, fjell : le mouton, presque seul.
  moor_heath: 0.72,
  garrigue: 0.68,
  dry_scrub: 0.55,
  terraced_slope: 0.78,
  dry_steppe: 0.8,
  // En désert, la chèvre et le mouton tiennent seuls.
  desert_stone: 0.85,
  desert_sand: 0.85,
  boreal_taiga: 0.25,
  // Estive : la vache monte l'été, mais le mouton reste au-dessus d'elle.
  alpine_pasture: 0.55,
  bare_rock: 0.6,
};

/** Part d'ovins en l'absence de région connue : la valeur d'avant. */
export const DEFAULT_SHEEP_ODDS = 0.34;

/**
 * Bétail d'une pâture : espèce et taille du troupeau. Les bovins dominent en
 * plaine herbagère, les ovins en terrain sec ou accidenté. La pente tranche
 * d'abord, le pays déplace ensuite la bascule (`HERD_SHEEP_ODDS`).
 *
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché à la parcelle.
 * @param {string|null} [context.matrix] Matrice de paysage (`region.matrix`).
 * @returns {{item:string, spread:number}}
 */
export function herdFor({ steepness = 0, variant = 0, matrix = null } = {}) {
  // Estive ou parcellaire de montagne franc : la chèvre broute où le mouton ne monte plus.
  if (steepness > 0.34) {
    return variant < 0.5
      ? { item: 'goat', spread: 0.24 }
      : { item: 'sheep', spread: 0.3 };
  }
  const base = (matrix && HERD_SHEEP_ODDS[matrix]) ?? DEFAULT_SHEEP_ODDS;
  // Une pente moyenne fait déjà basculer vers l'ovin ; un pays à moutons ne
  // peut pas y basculer *moins* qu'une plaine à vaches, d'où le maximum.
  const sheepOdds = steepness > 0.14 ? Math.max(0.75, base) : base;
  if (variant < sheepOdds) {
    return { item: 'sheep', spread: 0.3 }; // troupeau serré, reconnaissable de loin
  }
  // Cheval ou âne, jamais en troupeau serré (dispersés sur toute la parcelle).
  if (variant > 0.92) return { item: 'horse', spread: 0.7 };
  if (variant > 0.85) return { item: 'donkey', spread: 0.6 };
  return { item: 'cow', spread: 0.55 };
}

/**
 * Robe d'une bête, tirée dans le nuancier de son espèce (`theme.fauna.coats`).
 *
 * Ancrée au lieu, comme tout le reste : la même bête, au même endroit, a la
 * même robe au passage suivant. Rend un blanc neutre plutôt que rien pour une
 * espèce sans nuancier — le matériau du vivant **multiplie** la teinte
 * d'instance dans la robe, et une bête sans teinte serait en plâtre.
 *
 * Fonction pure.
 *
 * @param {Object} coats Nuanciers par espèce.
 * @param {string} kind Espèce.
 * @param {number} x
 * @param {number} z
 * @returns {number[]} Triplet linéaire.
 */
export function coatFor(coats, kind, x, z) {
  const list = coats?.[kind];
  if (!Array.isArray(list) || list.length === 0) return [1, 1, 1];
  return list[Math.min(list.length - 1, Math.floor(randomAt(x, z, 233) * list.length))];
}

/**
 * Le gibier d'un bois, par matrice de paysage — la liste dans laquelle un
 * massif tire ce qu'il abrite. Un item répété pèse d'autant plus lourd (même
 * convention que les essences d'un peuplement) ; une liste vide veut dire qu'il
 * n'y a rien à voir, ce qui est le cas là où il n'y a pas de forêt.
 *
 * Ce ne sont pas des inventaires fauniques : ce sont les trois silhouettes que
 * le catalogue sait poser, réparties là où on les rencontre. Le renne remplace
 * le cervidé au nord, le sanglier domine au sud (une chênaie méditerranéenne
 * en est pleine, et le cerf y est rare).
 */
export const FOREST_GAME = {
  hedgerow_meadow: ['deer', 'doe', 'doe', 'boar'],
  wet_grassland: ['deer', 'doe', 'boar'],
  broadleaf_woodland: ['deer', 'doe', 'boar', 'boar'],
  conifer_forest: ['deer', 'doe', 'boar'],
  moor_heath: ['deer', 'doe'],
  garrigue: ['boar', 'boar', 'doe', 'deer'],
  dry_scrub: ['boar', 'doe', 'deer'],
  terraced_slope: ['boar', 'deer', 'doe'],
  dry_steppe: ['boar'],
  desert_stone: [],
  desert_sand: [],
  openfield_cropland: ['deer', 'doe', 'boar', 'boar'],
  boreal_taiga: ['reindeer', 'reindeer', 'doe', 'deer'],
  alpine_pasture: ['deer', 'doe'],
  bare_rock: [],
};

/** Le gibier d'un pays inconnu : un bois tempéré. */
export const DEFAULT_FOREST_GAME = ['deer', 'doe', 'boar'];

/**
 * Les carnassiers, par matrice de paysage.
 *
 * Ils sont tirés **à part** du gibier, et c'est le point. Mis dans la même
 * liste, un loup listé une fois sur six sortirait dans un bois sur six : on
 * en croiserait plusieurs par sortie, et il cesserait d'être un loup pour
 * devenir un décor. Ici, un massif tire d'abord s'il abrite un carnassier
 * (`PREDATOR_ODDS`), et seulement ensuite lequel.
 *
 * Le renard est partout ; le loup et l'ours sont là où ils sont revenus —
 * montagne, forêt continentale, taïga.
 */
export const FOREST_PREDATORS = {
  hedgerow_meadow: ['fox'],
  wet_grassland: ['fox'],
  moor_heath: ['fox'],
  garrigue: ['fox'],
  dry_scrub: ['fox'],
  terraced_slope: ['fox', 'fox', 'wolf'],
  dry_steppe: ['fox'],
  desert_stone: ['fox'],
  desert_sand: ['fox'],
  openfield_cropland: ['fox'],
  broadleaf_woodland: ['fox', 'fox', 'wolf'],
  conifer_forest: ['fox', 'fox', 'wolf'],
  boreal_taiga: ['fox', 'wolf', 'bear', 'bear'],
  alpine_pasture: ['fox', 'wolf', 'bear'],
  bare_rock: [],
};

/** Le carnassier d'un pays inconnu : le renard, le seul qui soit partout. */
export const DEFAULT_FOREST_PREDATORS = ['fox'];

/**
 * Part des massifs habités qui abritent un carnassier plutôt que du gibier.
 *
 * Basse, et à garder basse. Un renard qu'on aperçoit une fois par sortie est
 * un renard ; un renard par bois est un parc animalier.
 */
export const PREDATOR_ODDS = 0.14;

/**
 * Ce qu'un bois abrite : l'espèce, de combien elle se tient groupée, et si
 * elle va seule. Le sanglier va en compagnie serrée, le cervidé en hardes
 * lâches, le carnassier seul ou à deux.
 *
 * Fonction pure. Rend `null` là où il n'y a rien à poser.
 *
 * @param {Object} [context]
 * @param {number} [context.variant] Tirage dans [0, 1[ attaché au massif.
 * @param {number} [context.predatorDraw] Second tirage, indépendant : sans
 *        lui, « c'est un carnassier » et « lequel » seraient le même nombre,
 *        et un massif ne pourrait jamais abriter qu'un seul des deux.
 * @param {string|null} [context.matrix] Matrice de paysage (`region.matrix`).
 * @returns {{item:string, spread:number, solitary:boolean}|null}
 */
export function forestGameFor({ variant = 0, predatorDraw = 1, matrix = null } = {}) {
  if (predatorDraw < PREDATOR_ODDS) {
    const hunters = (matrix && FOREST_PREDATORS[matrix]) || DEFAULT_FOREST_PREDATORS;
    if (hunters.length > 0) {
      const item = hunters[Math.min(hunters.length - 1, Math.floor(variant * hunters.length))];
      return { item, spread: 0.5, solitary: true };
    }
  }
  const pool = (matrix && FOREST_GAME[matrix]) || DEFAULT_FOREST_GAME;
  if (pool.length === 0) return null;
  const item = pool[Math.min(pool.length - 1, Math.floor(variant * pool.length))];
  return { item, spread: item === 'boar' ? 0.2 : 0.34, solitary: false };
}

/**
 * Bêtes à l'hectare dans un bois. Relevée de 0,12 à 0,3 : à l'ancienne
 * valeur, il fallait un massif de huit hectares pour espérer une seule bête,
 * et deux massifs sur trois n'en portaient aucune — on pouvait traverser une
 * forêt entière sans rien voir, ce qui était le comportement décrit mais pas
 * celui qu'on veut.
 */
export const FOREST_GAME_PER_HECTARE = 0.3;

/** Bêtes au plus dans une compagnie de carnassiers : ils ne vont pas en horde. */
export const PREDATOR_MAX = 2;

/**
 * Part des bois où l'on ne voit rien du tout. Le gibier est ce qu'on aperçoit
 * une fois de temps en temps : en mettre dans tous les massifs en ferait un
 * parc animalier.
 *
 * Descendue de 0,65 à 0,42 en même temps que la densité montait : à deux
 * massifs vides sur trois **et** une bête pour huit hectares, un bois n'était
 * pratiquement jamais habité. Un massif sur deux qui l'est reste très
 * en-dessous de la réalité — un chevreuil ne se laisse pas voir — mais
 * au-dessus du seuil où l'on finit par croire que le décor n'en pose pas.
 */
export const FOREST_GAME_EMPTY_ODDS = 0.42;

/**
 * La pierre qui affleure, d'après la matière du sol et la pente — le seul
 * mobilier dont la présence est entièrement décidée par le terrain (rien
 * dans les tuiles ne dit « il y a un rocher ici »). Trois tailles, densité
 * croissante avec la part de minéral, tirage attaché au lieu.
 *
 * @param {Object} context
 * @param {number} [context.bare]      Part de sol nu/minéral, de 0 à 1.
 * @param {number} [context.steepness] Pente moyenne alentour.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @returns {{item:string, scale:number}|null}
 */
export function rockKindFor({ bare = 0, steepness = 0, variant = 0 } = {}) {
  // Une zone bâtie est aussi « sol nu » dans la carte de classes : la pente distingue un parking d'un éboulis.
  const mineral = bare > 0.55 && steepness > 0.06;
  const alpine = steepness > 0.28;
  if (!mineral && !alpine) return null;

  const density = Math.min(1, bare * 0.3 + Math.min(steepness, 0.5) * 0.8);
  if (variant > density) return null;

  const draw = variant / Math.max(density, 1e-3);
  if (draw < 0.12) return { item: 'rockOutcrop', scale: 0.75 + variant * 0.7 };
  if (draw < 0.42) return { item: 'rockBoulder', scale: 0.6 + variant * 0.9 };
  return { item: 'rockSmall', scale: 0.7 + variant * 1.6 };
}

/**
 * Choix d'un objet de biome pour un point donné, à partir de la table de sa
 * matière (`BIOME_DEBRIS`, catalog.js) — le pendant de `rockKindFor` pour les
 * matières hors minéral : un seul tirage sert à la fois de seuil d'acceptation
 * et de sélection dans la liste pondérée, comme `rockKindFor` le fait déjà.
 *
 * @param {Object|undefined} table Entrée `BIOME_DEBRIS[matière]` — absente si
 *        la matière n'est pas concernée.
 * @param {number} density Densité par maille (`perHa` × surface de la maille
 *        en hectares), comparée directement au tirage.
 * @param {number} [variant] Tirage dans [0, 1[ attaché au lieu.
 * @returns {{item:string, scale:number}|null}
 */
export function biomeDebrisKindFor(table, density, variant = 0) {
  if (!table || !(density > 0) || variant > density) return null;

  const draw = variant / Math.max(density, 1e-3);
  let acc = 0;
  for (const entry of table.items) {
    acc += entry.share;
    if (draw < acc) {
      const [min, max] = entry.scale;
      return { item: entry.item, scale: min + variant * (max - min) };
    }
  }
  return null;
}

/**
 * Style de lampadaire selon le contexte. Le clocher l'emporte sur
 * l'industriel si jamais les deux coïncidaient — un centre-ville autour
 * d'une église reste un centre-ville.
 *
 * @param {Object} context
 * @param {boolean} [context.nearChurch] Un lieu de culte relevé à moins d'un
 *        kilomètre (voir `furniture/pointsOfInterest.churchWithin`).
 * @param {boolean} [context.industrial] Le sol à cet endroit est peint
 *        `bare` — la matière des zones industrielles, commerciales et
 *        assimilées (voir `groundClassMap.surfaceAt`).
 * @returns {string} clé du catalogue.
 */
export function streetLampKindFor({ nearChurch = false, industrial = false } = {}) {
  if (nearChurch) return 'streetLampClassic';
  if (industrial) return 'streetLampLed';
  return 'streetLamp';
}

/** Classes `landuse` qui font une zone bâtie — donc éclairée. */
export const BUILT_UP_CLASSES = new Set([
  'residential',
  'commercial',
  'retail',
  'industrial',
  'suburb',
  'neighbourhood',
  'quarter',
]);

/**
 * Le mobilier qui accompagne une chaussée, par profil et par contexte. Les
 * espacements sont ceux du terrain (100 m pour les bornes hectométriques,
 * 1000 m pour la kilométrique) ; les autres sont desserrés d'environ un
 * tiers par rapport aux minimums réglementaires — un plan large paraît
 * saturé depuis la selle. `null` = pas de cet objet sur ce type de route.
 *
 * @param {string} profile  Clé de `ROAD_PROFILES`.
 * @param {Object} [context]
 * @param {boolean} [context.builtUp] La route traverse une zone bâtie.
 * @returns {Object} espacements en mètres, par objet.
 */
export function roadsideFurnitureFor(profile, { builtUp = false } = {}) {
  const plan = {
    lamp: null,
    utilityPole: null,
    milestone: null,
    kilometreStone: null,
    alignmentTree: null,
    sign: null,
    directionSign: null,
    hedge: false,
    guardrail: false,
    trafficLight: false,
  };

  switch (profile) {
    case 'express':
      // Ni éclairée ni plantée hors agglomération, mais bornée et protégée sur toute sa longueur.
      plan.kilometreStone = 1000;
      plan.directionSign = 1300;
      plan.guardrail = true;
      break;

    case 'major':
      plan.milestone = 100;
      plan.kilometreStone = 1000;
      plan.sign = 620;
      plan.directionSign = 1700;
      plan.guardrail = true;
      plan.trafficLight = builtUp;
      if (builtUp) plan.lamp = 38;
      else {
        plan.utilityPole = 62;
        plan.alignmentTree = 16;
      }
      break;

    case 'minor':
      plan.sign = 900;
      plan.guardrail = true;
      plan.trafficLight = builtUp;
      if (builtUp) plan.lamp = 44;
      else {
        plan.utilityPole = 68;
        plan.hedge = true;
      }
      break;

    case 'lane':
      if (builtUp) plan.lamp = 48;
      else plan.hedge = true;
      break;

    case 'track':
      plan.hedge = !builtUp;
      break;

    default: // cycleway, path : rien.
      break;
  }

  return plan;
}

/**
 * Chaussées qu'un panneau de priorité concerne : celles qu'un véhicule routier
 * emprunte. Une piste cyclable, un sentier et un chemin d'exploitation ont
 * leurs propres règles, et le mobilier routier ne les signale pas.
 */
export const PRIORITY_SIGN_PROFILES = new Set(['express', 'major', 'minor', 'lane']);

/**
 * Le panneau qu'une **portion** de route porte, d'après ce qui s'y passe : une
 * courbe, une agglomération, la classe de la chaussée.
 *
 * Il n'y a plus de cas « carrefour » ici, et c'est le lot : un carrefour ne
 * choisissait pas un panneau, il en **tirait un au hasard** entre stop,
 * cédez-le-passage et anneau, sur la seule foi qu'une intersection existait.
 * Aucune des trois n'était justifiée par la donnée. La priorité se décide
 * maintenant au carrefour (`roadJunctions.branchYields`), elle se pose à sa
 * bouche, et c'est le même fait qui la peint au sol.
 *
 * @param {Object} context
 * @param {number} [context.curvature] Courbure locale, en 1/m (voir `pathCurvature`).
 * @param {boolean} [context.builtUp]  La portion est en agglomération.
 * @param {string} [context.profile]   Classe de chaussée.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @returns {string} clé du catalogue.
 */
export function signKindFor({ curvature = 0, builtUp = false, profile = 'minor', variant = 0 } = {}) {
  if (curvature > 0.02) return 'signChevron';
  if (curvature > 0.009) return variant < 0.6 ? 'signWarning' : 'signChevron';

  if (builtUp) {
    if (variant < 0.3) return 'signCrossing';
    if (variant < 0.72) return 'signSpeedLimit';
    return 'signWarning';
  }

  if (profile === 'express' || profile === 'major') {
    if (variant < 0.3) return 'signPriority';
    if (variant < 0.58) return 'signNoOvertaking';
    if (variant < 0.82) return 'signSpeedLimit';
    return 'signWarning';
  }
  if (variant < 0.34) return 'signWarning';
  if (variant < 0.64) return 'signSpeedLimit';
  return 'signPriority';
}

/**
 * Courbure locale d'une polyligne échantillonnée, en 1/m — l'inverse du rayon
 * de courbure (0,02 = virage de 50 m de rayon). `span` compte : pris sur deux
 * échantillons voisins, il ne mesurerait que le bruit du tracé des tuiles.
 *
 * @param {Array<{x:number,z:number}>} path
 * @param {number} index
 * @param {number} [span] Demi-fenêtre, en échantillons.
 */
export function pathCurvature(path, index, span = 3) {
  return Math.abs(pathTurn(path, index, span));
}

/**
 * Même mesure, signée (négative à gauche de la marche, positive à droite) —
 * sert à poser les balises de virage à l'extérieur de la courbe.
 */
export function pathTurn(path, index, span = 3) {
  if (!Array.isArray(path) || path.length < 2 * span + 1) return 0;
  const a = path[Math.max(0, index - span)];
  const b = path[index];
  const c = path[Math.min(path.length - 1, index + span)];

  const ax = b.x - a.x;
  const az = b.z - a.z;
  const bx = c.x - b.x;
  const bz = c.z - b.z;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-3 || lb < 1e-3) return 0;

  // `atan2` reste juste jusqu'au demi-tour, là où `acos` perd sa précision près de zéro.
  const cross = (ax * bz - az * bx) / (la * lb);
  const dot = (ax * bx + az * bz) / (la * lb);
  return Math.atan2(cross, dot) / ((la + lb) / 2);
}

/** Courbure à partir de laquelle une rive nue appelle un parapet. */
export const CURVE_RAIL_CURVATURE = 0.012;

/**
 * Le parapet d'une rive, et de quelle matière — ou `null` s'il n'en faut pas.
 * Une glissière protège d'un vide, pas d'une pente : exige à la fois un vrai
 * surplomb (`drop`) et un versant franc ou une courbe (le MNT bruite le
 * devers de quelques pour cent partout, donc la seule pente ne suffit pas).
 * Matière suit la route : acier sur les grands axes, bois sur les petites.
 *
 * @returns {'steel'|'wood'|null}
 */
export function guardrailStyleFor({ profile = 'minor', slope = 0, curvature = 0, drop = 0 } = {}) {
  if (drop < GUARDRAIL_MIN_DROP_M) return null;
  const exposed = slope >= STEEP_CROSS_SLOPE || curvature >= CURVE_RAIL_CURVATURE;
  if (!exposed) return null;
  if (profile === 'express' || profile === 'major') return 'steel';
  if (profile === 'minor') return drop > 2.5 ? 'steel' : 'wood';
  if (profile === 'lane' || profile === 'track') return 'wood';
  return null;
}

/** Surplomb minimal de la rive aval pour qu'un parapet ait une raison d'être. */
export const GUARDRAIL_MIN_DROP_M = 0.9;

/**
 * Ce qui garnit le bas-côté d'une portion de route : une haie basse d'un seul
 * côté, ou rien (le cas le plus fréquent, et voulu — sinon un décor de
 * circuit). Un tirage ancré au nœud de la chaîne la donne à une portion sur trois environ.
 *
 * @returns {{verge:string|null, vergeSide:number}}
 */
export function roadsideVergeFor(profile, { builtUp = false, variant = 0 } = {}) {
  const none = { verge: null, vergeSide: 1 };
  if (builtUp) return none;
  if (profile === 'cycleway' || profile === 'path' || profile === 'express') return none;

  if (variant < 0.34) return { verge: 'lowHedge', vergeSide: variant < 0.17 ? 1 : -1 };
  return none;
}

/**
 * Cap d'un objet posé au bord d'une chaussée, en radians. Conventions :
 * chaque pièce du catalogue est modelée face à +Z (`furnitureKit`) ; une
 * rotation de lacet `θ` amène ce +Z sur `(sin θ, cos θ)` (`Kit.transform`,
 * `setFromAxisAngle(Y, θ)`) ; la perpendiculaire à gauche de la marche vaut
 * `(tz, -tx)`, `offset` positif de ce côté ; l'axe z pointe au sud, donc
 * « gauche de la marche » est la gauche du conducteur.
 *
 * @param {number} tx Tangente unitaire de la chaussée.
 * @param {number} tz
 * @param {number} offset Décalage latéral signé de l'objet, en mètres.
 * @param {string} [facing] `'along'` (dans l'axe de la route), `'road'` (tourné
 *        vers la chaussée), `'traffic'` (face au trafic de la voie voisine).
 * @returns {number} lacet, en radians.
 */
export function roadsideYaw(tx, tz, offset, facing = 'along') {
  if (facing === 'road') {
    // Perpendiculaire à gauche, retournée vers l'axe.
    const side = offset >= 0 ? 1 : -1;
    return Math.atan2(-side * tz, side * tx);
  }
  if (facing === 'traffic') {
    // Circulation à droite : un objet posé à droite fait face au trafic, donc regarde en arrière.
    const sense = offset < 0 ? -1 : 1;
    return Math.atan2(sense * tx, sense * tz);
  }
  return Math.atan2(tx, tz);
}

/**
 * Pente relative du terrain en travers d'une chaussée, et côté du versant —
 * la mesure qui déclenche le mur et la glissière. Rives élargies de quelques
 * mètres, sinon dominée par le bruit métrique du MNT.
 *
 * @param {number} left  Altitude à gauche de la marche.
 * @param {number} right Altitude à droite.
 * @param {number} span  Distance entre les deux points, en mètres.
 * @returns {{slope:number, uphill:number}} pente absolue, et côté du versant
 *          amont : `+1` à gauche de la marche, `-1` à droite.
 */
export function crossSlope(left, right, span) {
  const delta = left - right;
  return { slope: Math.abs(delta) / (span || 1), uphill: delta >= 0 ? 1 : -1 };
}

/** Pente en travers à partir de laquelle mur et glissière apparaissent. */
export const STEEP_CROSS_SLOPE = 0.14;
/** Surplomb de la plate-forme au-delà duquel un talus est nécessaire, en mètres. */
export const EMBANKMENT_MIN_DROP_M = 0.3;

/**
 * Découpe une suite de lignes en tronçons contigus où un prédicat est vrai.
 * Les tronçons trop courts sont écartés (une glissière de dix mètres au
 * milieu d'un plateau se lit comme un bug).
 *
 * @param {Array} rows       Échantillons.
 * @param {Function} keep    `(row, index) => boolean`.
 * @param {number} [minRun]  Longueur minimale, en échantillons.
 * @returns {Array<Array>} tronçons.
 */
export function contiguousRuns(rows, keep, minRun = 4) {
  const runs = [];
  let current = null;

  for (let i = 0; i < rows.length; i++) {
    if (keep(rows[i], i)) {
      if (!current) {
        current = [];
        runs.push(current);
      }
      current.push(rows[i]);
    } else {
      current = null;
    }
  }

  return runs.filter((run) => run.length >= minRun);
}

/**
 * Découpe une suite de lignes en portions homogènes pour une valeur lue au
 * passage (une chaîne peut entrer dans un village puis en ressortir). Les
 * portions trop courtes sont absorbées par la précédente (artefact du
 * découpage des polygones, pas un vrai village).
 *
 * @param {Array} rows        Échantillons.
 * @param {Function} valueOf  `(row, index) => valeur comparable par ===`.
 * @param {number} [minRun]   Longueur minimale d'une portion, en échantillons.
 * @returns {Array<{value: *, rows: Array}>}
 */
export function runsByValue(rows, valueOf, minRun = 4) {
  const runs = [];
  for (let i = 0; i < rows.length; i++) {
    const value = valueOf(rows[i], i);
    const current = runs[runs.length - 1];
    if (current && current.value === value) current.rows.push(rows[i]);
    else runs.push({ value, rows: [rows[i]] });
  }

  const out = [];
  for (const run of runs) {
    const previous = out[out.length - 1];
    if (previous && run.rows.length < minRun) {
      previous.rows.push(...run.rows);
      continue;
    }
    out.push(run);
  }
  return out;
}

/**
 * Aire d'un anneau métrique, en mètres carrés (valeur absolue). Fonction pure.
 * @param {Array<{x:number,z:number}>} ring
 */
export function ringAreaMeters(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z);
  }
  return Math.abs(sum / 2);
}

/** Centroïde des sommets d'un anneau — pas celui de sa surface. Fonction pure. */
export function ringCentroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  return { x: x / ring.length, z: z / ring.length };
}

/** Test d'appartenance à un anneau, par lancer de rayon. Fonction pure. */
export function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const zi = ring[i].z;
    const zj = ring[j].z;
    if (zi > z !== zj > z) {
      const t = (z - zi) / (zj - zi || 1);
      if (x < ring[i].x + t * (ring[j].x - ring[i].x)) inside = !inside;
    }
  }
  return inside;
}

/**
 * Sème des points à l'intérieur d'un anneau, par tirage rejeté dans sa boîte.
 * Graine dérivée du centre de la parcelle (stable d'une reconstruction à
 * l'autre). Nombre d'essais plafonné, pour une parcelle très découpée.
 *
 * @param {Array<{x:number,z:number}>} ring
 * @param {number} count
 * @param {number} seed
 * @param {number} [options.cluster] Resserrement : les tirages se regroupent
 *        autour d'un point au lieu de couvrir la boîte (un troupeau se tient
 *        ensemble).
 * @param {{x:number,z:number}|null} [options.focus] Point de regroupement
 *        imposé, au lieu du tirage. Sert à adosser un groupe à quelque chose
 *        — une route, en pratique (voir `furniture/parcelFauna.js`).
 *        Le tirage du point libre a lieu de toute façon, pour que la suite du
 *        semis soit la même avec et sans : une parcelle ne doit pas changer de
 *        semis selon qu'une route passe à côté.
 * @param {number} [options.reachM] Demi-côté de la boîte de tirage autour du
 *        point de regroupement, en mètres. Sans lui, le resserrement reste
 *        proportionnel à la parcelle — ce qui ne veut plus rien dire quand on
 *        veut se tenir à portée de vue d'un point précis.
 * @returns {Array<{x:number,z:number,rotation:number,variant:number}>}
 */
export function scatterInRing(ring, count, seed, { cluster = 0, focus = null, reachM = 0 } = {}) {
  const out = [];
  if (!Array.isArray(ring) || ring.length < 3 || count <= 0) return out;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  const random = makeRandom(seed);
  const attempts = count * 8;
  // Regroupement : les tirages se resserrent autour d'un point plutôt que couvrir toute la boîte (un troupeau se tient ensemble).
  const wandering = cluster > 0 ? { x: minX + random() * (maxX - minX), z: minZ + random() * (maxZ - minZ) } : null;
  const anchor = focus || wandering;
  const keep = cluster > 0 ? Math.min(1, Math.max(0.05, cluster)) : 1;
  const spanX = reachM > 0 ? reachM * 2 : (maxX - minX) * keep;
  const spanZ = reachM > 0 ? reachM * 2 : (maxZ - minZ) * keep;

  for (let i = 0; i < attempts && out.length < count; i++) {
    let x;
    let z;
    if (anchor) {
      x = anchor.x + (random() - 0.5) * spanX;
      z = anchor.z + (random() - 0.5) * spanZ;
    } else {
      x = minX + random() * (maxX - minX);
      z = minZ + random() * (maxZ - minZ);
    }
    if (!pointInRing(ring, x, z)) continue;
    out.push({ x, z, rotation: random() * Math.PI * 2, variant: random() });
  }
  return out;
}
