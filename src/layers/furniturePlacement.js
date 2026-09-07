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
 * tout climat qu'on ne connaît pas.
 *
 * Ce sont **exactement** les seuils qui étaient écrits en dur dans
 * `boundaryFurnitureFor` : sans climat, rien ne change.
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
 * Comment on borne un champ, par famille climatique.
 *
 * C'est la trame du paysage agraire, et elle se lit de plus loin que la
 * couleur d'un mur : un bocage compartimente l'horizon en chambres de deux
 * cents mètres, un openfield le laisse filer, une terrasse méditerranéenne le
 * raye de lignes de pierre. Tant que toutes les limites portaient la même
 * haie, une plaine castillane était un bocage normand jauni.
 *
 * Ce qui décide, dans l'ordre : la pierre est là où le sol en donne — pente,
 * causse, karst —, la haie vive là où il pleut et où l'élevage est ancien, le
 * bois là où la forêt est proche, et le rien partout où la terre est trop
 * grande ou trop pauvre pour qu'on la clôture.
 *
 * Une famille absente retombe sur le bocage par défaut.
 */
export const BOUNDARY_MIXES = {
  oceanic: DEFAULT_BOUNDARY_MIX,
  // Highlands, Connemara, Islande : le mur de pierre sèche est le paysage.
  oceanicUpland: {
    stoneSlope: 0.06,
    stoneSlopeTilled: 0.04,
    plough: [['dryStoneWall', 0.45], ['hedge', 0.2], ['lowHedge', 0.1], [null, 0.25]],
    pasture: [['dryStoneWall', 0.5], ['hedge', 0.12], ['woodFence', 0.18], ['barbedWire', 0.2]],
  },
  // Openfield : la plaine polonaise ou beauceronne ne se compartimente pas.
  continental: {
    stoneSlope: 0.24,
    stoneSlopeTilled: 0.2,
    plough: [[null, 0.82], ['hedge', 0.1], ['lowHedge', 0.08]],
    pasture: [['barbedWire', 0.5], ['woodFence', 0.3], [null, 0.15], ['hedge', 0.05]],
  },
  // Là où le bois est la matière la moins chère, on clôt en bois.
  boreal: {
    stoneSlope: 0.28,
    stoneSlopeTilled: 0.24,
    plough: [[null, 0.75], ['lowHedge', 0.15], ['hedge', 0.1]],
    pasture: [['woodFence', 0.6], ['barbedWire', 0.25], [null, 0.15]],
  },
  // Pas de haie vive : il n'y a pas assez d'eau pour l'entretenir.
  mediterranean: {
    stoneSlope: 0.08,
    stoneSlopeTilled: 0.06,
    plough: [[null, 0.6], ['dryStoneWall', 0.3], ['lowHedge', 0.1]],
    pasture: [['dryStoneWall', 0.45], ['barbedWire', 0.3], [null, 0.25]],
  },
  mediterraneanCool: {
    stoneSlope: 0.12,
    stoneSlopeTilled: 0.1,
    plough: [[null, 0.5], ['dryStoneWall', 0.22], ['hedge', 0.16], ['lowHedge', 0.12]],
    pasture: [['dryStoneWall', 0.3], ['hedge', 0.15], ['woodFence', 0.2], ['barbedWire', 0.35]],
  },
  // Terrasses : la pierre sort du premier pli de terrain, et elle est partout.
  mediterraneanMontane: {
    stoneSlope: 0.05,
    stoneSlopeTilled: 0.04,
    plough: [['dryStoneWall', 0.5], [null, 0.4], ['lowHedge', 0.1]],
    pasture: [['dryStoneWall', 0.6], ['barbedWire', 0.25], [null, 0.15]],
  },
  semiArid: {
    stoneSlope: 0.1,
    stoneSlopeTilled: 0.08,
    plough: [[null, 0.75], ['dryStoneWall', 0.2], ['lowHedge', 0.05]],
    pasture: [['barbedWire', 0.4], ['dryStoneWall', 0.3], [null, 0.3]],
  },
  // Une parcelle qu'on ne clôt pas, parce qu'il n'y a rien à retenir dedans.
  arid: {
    stoneSlope: 0.12,
    stoneSlopeTilled: 0.1,
    plough: [[null, 0.85], ['dryStoneWall', 0.15]],
    pasture: [[null, 0.6], ['barbedWire', 0.25], ['dryStoneWall', 0.15]],
  },
  // Alpage : le muret de pierre et la barrière de mélèze, à parts égales.
  alpine: {
    stoneSlope: 0.06,
    stoneSlopeTilled: 0.06,
    plough: [['dryStoneWall', 0.4], ['woodFence', 0.2], [null, 0.4]],
    pasture: [['woodFence', 0.45], ['dryStoneWall', 0.3], [null, 0.25]],
  },
  // Rien ne se clôt sur un glacier.
  glacial: {
    stoneSlope: 0.5,
    stoneSlopeTilled: 0.5,
    plough: [[null, 1]],
    pasture: [[null, 1]],
  },
};

/**
 * Traitement de contour d'une parcelle, d'après ses attributs OpenMapTiles.
 * Suit le paysage agraire réel : bocage sur les labours, clôture sur les
 * pâtures, muret là où le terrain est accidenté (`steepness`). Et là où le
 * pays le veut : le partage lui-même change d'un climat à l'autre, voir
 * `BOUNDARY_MIXES`. Sans climat, c'est le bocage français à la valeur près.
 *
 * @param {Object} properties Attributs de l'entité.
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour, en pente relative.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @param {string|null} [context.climate] Famille climatique.
 * @returns {string|null} clé de `FURNITURE_PROFILES`, ou `null`.
 */
export function boundaryFurnitureFor(
  properties = {},
  { steepness = 0, variant = 0, crop = null, climate = null } = {}
) {
  const klass = properties.class;
  const subclass = properties.subclass;
  const mix = (climate && BOUNDARY_MIXES[climate]) || DEFAULT_BOUNDARY_MIX;

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
 * L'assolement par défaut : celui de la France, et le repli de tout climat
 * inconnu. Parts cumulées dans l'ordre — ce sont exactement les seuils qui
 * étaient écrits en dur dans `cropFor`.
 */
export const DEFAULT_CROP_MIX = [
  ['wheat', 0.34],
  ['plough', 0.18],
  ['maize', 0.16],
  ['sunflower', 0.1],
  ['vineyard', 0.08],
  ['orchard', 0.06],
  ['plough', 0.08],
];

/**
 * L'assolement, par famille climatique. Pas de la statistique agricole : ce
 * qu'il faut pour qu'un champ ne mente pas — une vigne en Laponie se remarque,
 * la proportion exacte de blé dans un canton, non.
 *
 * Les cultures disponibles sont celles de `CROP_KINDS` et rien d'autre : leur
 * ordre est un encodage gravé dans une image, donc ajouter une lavande demande
 * un atlas, pas une ligne ici. `orchard` porte l'olivier comme le pommier.
 *
 * Une famille absente retombe sur l'assolement par défaut.
 */
export const CROP_MIXES = {
  oceanic: [['wheat', 0.34], ['plough', 0.22], ['maize', 0.24], ['orchard', 0.1], ['sunflower', 0.06], ['vineyard', 0.04]],
  // Les hautes terres atlantiques : de l'orge, du fourrage, des prés retournés.
  oceanicUpland: [['plough', 0.55], ['wheat', 0.3], ['maize', 0.1], ['orchard', 0.05]],
  continental: [['wheat', 0.42], ['plough', 0.22], ['maize', 0.18], ['sunflower', 0.1], ['orchard', 0.06], ['vineyard', 0.02]],
  // Au nord, ni maïs ni tournesol : la saison est trop courte.
  boreal: [['plough', 0.55], ['wheat', 0.4], ['orchard', 0.05]],
  mediterranean: [['vineyard', 0.26], ['orchard', 0.26], ['wheat', 0.2], ['plough', 0.18], ['sunflower', 0.1]],
  mediterraneanCool: [['wheat', 0.26], ['vineyard', 0.22], ['plough', 0.2], ['orchard', 0.18], ['sunflower', 0.14]],
  mediterraneanMontane: [['plough', 0.4], ['wheat', 0.25], ['orchard', 0.25], ['vineyard', 0.1]],
  semiArid: [['plough', 0.4], ['wheat', 0.25], ['orchard', 0.25], ['vineyard', 0.1]],
  // En désert, une parcelle cultivée est irriguée : du verger ou de la terre
  // nue, jamais un champ de blé à perte de vue.
  arid: [['plough', 0.7], ['orchard', 0.2], ['wheat', 0.1]],
  // En altitude, la parcelle « agricole » est presque toujours du pré.
  alpine: [['plough', 0.7], ['wheat', 0.25], ['orchard', 0.05]],
  glacial: [['plough', 1]],
};

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
 * le climat. Le schéma OpenMapTiles ne dit jamais la culture (sauf verger,
 * vigne, pépinière) : le reste est déduit.
 *
 * Ce que dit la donnée passe avant le climat : une vigne cartographiée reste
 * une vigne, où qu'elle soit. Le climat ne décide que de ce qu'on ignore.
 *
 * @param {Object} properties
 * @param {number} variant Tirage dans [0, 1[ attaché à la parcelle.
 * @param {string|null} [climate] Famille climatique (`core/climate.js`).
 * @returns {'wheat'|'maize'|'sunflower'|'vineyard'|'orchard'|'plough'|null}
 */
export function cropFor(properties = {}, variant = 0, climate = null) {
  const klass = properties.class;
  const subclass = properties.subclass;

  if (subclass === 'vineyard') return 'vineyard';
  if (subclass === 'orchard' || subclass === 'plant_nursery') return 'orchard';
  if (klass !== 'farmland') return null;

  return pickShare((climate && CROP_MIXES[climate]) || DEFAULT_CROP_MIX, variant);
}

/** Cultures semées en rangs visibles, donc balayées et non semées en vrac. */
export const ROW_CROPS = new Set(['vineyard', 'orchard']);

/**
 * Les cultures, dans l'ordre de leur identifiant (`indice + 1`, zéro = aucune
 * culture). Peint dans la carte des cultures (`groundClassMap`) et relu par
 * le shader de terrain et `cropLayer` — l'ordre est gravé, le changer repeint
 * des champs d'une autre culture.
 */
export const CROP_KINDS = ['wheat', 'maize', 'sunflower', 'plough', 'vineyard', 'orchard'];

/** Pas entre deux identifiants dans le canal rouge. */
export const CROP_ID_STEP = 40;

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
  if (klass === 'grass' || subclass === 'meadow' || subclass === 'grassland') {
    return { item: 'herd', perHectare: 1.1 };
  }
  // Bois : du bois de coupe, rangé en lisière. La densité se compte à
  // l'hectare comme le reste, mais l'ourlet en écarte l'essentiel (voir
  // `WOOD_PILE_EDGE_MIN`) — un massif compact en porte donc proportionnellement
  // moins qu'un bosquet, ce qui est juste : le tas est au bord, pas au milieu.
  if (klass === 'wood') {
    return { item: 'woodPile', perHectare: 0.8 };
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
 * Part d'ovins d'une pâture de plaine, par famille climatique. La pente disait
 * déjà l'essentiel — le mouton broute où la vache ne monte plus — mais rien du
 * pays : une plaine irlandaise et une plaine castillane ont la même pente et
 * pas le même troupeau. Une famille absente garde `DEFAULT_SHEEP_ODDS`.
 */
export const HERD_SHEEP_ODDS = {
  // Prairie humide : le bovin, et c'est ce qui fait le paysage laitier.
  oceanic: 0.28,
  // Lande écossaise, fjells : le mouton, presque seul.
  oceanicUpland: 0.72,
  mediterranean: 0.68,
  mediterraneanCool: 0.55,
  mediterraneanMontane: 0.78,
  semiArid: 0.8,
  // En steppe sèche, la chèvre et le mouton tiennent seuls.
  arid: 0.85,
  continental: 0.3,
  boreal: 0.25,
  // Estive : la vache monte l'été, mais le mouton reste au-dessus d'elle.
  alpine: 0.55,
  glacial: 0.6,
};

/** Part d'ovins en l'absence de climat connu : la valeur d'avant. */
export const DEFAULT_SHEEP_ODDS = 0.34;

/**
 * Bétail d'une pâture : espèce et taille du troupeau. Les bovins dominent en
 * plaine herbagère, les ovins en terrain sec ou accidenté. La pente tranche
 * d'abord, le climat déplace ensuite la bascule (`HERD_SHEEP_ODDS`).
 *
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché à la parcelle.
 * @param {string|null} [context.climate] Famille climatique.
 * @returns {{item:string, spread:number}}
 */
export function herdFor({ steepness = 0, variant = 0, climate = null } = {}) {
  // Estive ou parcellaire de montagne franc : la chèvre broute où le mouton ne monte plus.
  if (steepness > 0.34) {
    return variant < 0.5
      ? { item: 'goat', spread: 0.24 }
      : { item: 'sheep', spread: 0.3 };
  }
  const base = (climate && HERD_SHEEP_ODDS[climate]) ?? DEFAULT_SHEEP_ODDS;
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
 * Le panneau qu'on pose à cet endroit, d'après ce qui s'y passe (une courbe,
 * un carrefour, une entrée d'agglomération), pas un tirage uniforme entre formes.
 *
 * @param {Object} context
 * @param {number} [context.curvature] Courbure locale, en 1/m (voir `pathCurvature`).
 * @param {boolean} [context.builtUp]  La portion est en agglomération.
 * @param {boolean} [context.junction] Un carrefour est proche.
 * @param {string} [context.profile]   Classe de chaussée.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @returns {string} clé du catalogue.
 */
export function signKindFor({ curvature = 0, builtUp = false, junction = false, profile = 'minor', variant = 0 } = {}) {
  // Un carrefour prime sur tout le reste.
  if (junction) {
    if (variant < 0.32) return 'signStop';
    if (variant < 0.72) return 'signYield';
    return 'signRoundabout';
  }
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
 * @returns {Array<{x:number,z:number,rotation:number,variant:number}>}
 */
export function scatterInRing(ring, count, seed, { cluster = 0 } = {}) {
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
  const focus = cluster > 0 ? { x: minX + random() * (maxX - minX), z: minZ + random() * (maxZ - minZ) } : null;
  const keep = cluster > 0 ? Math.min(1, Math.max(0.05, cluster)) : 1;

  for (let i = 0; i < attempts && out.length < count; i++) {
    let x;
    let z;
    if (focus) {
      x = focus.x + (random() - 0.5) * (maxX - minX) * keep;
      z = focus.z + (random() - 0.5) * (maxZ - minZ) * keep;
    } else {
      x = minX + random() * (maxX - minX);
      z = minZ + random() * (maxZ - minZ);
    }
    if (!pointInRing(ring, x, z)) continue;
    out.push({ x, z, rotation: random() * Math.PI * 2, variant: random() });
  }
  return out;
}
