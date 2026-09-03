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
 * Traitement de contour d'une parcelle, d'après ses attributs OpenMapTiles.
 * Suit le paysage agraire réel : bocage sur les labours, clôture sur les
 * pâtures, muret là où le terrain est accidenté (`steepness`).
 *
 * @param {Object} properties Attributs de l'entité.
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour, en pente relative.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché au lieu.
 * @returns {string|null} clé de `FURNITURE_PROFILES`, ou `null`.
 */
export function boundaryFurnitureFor(properties = {}, { steepness = 0, variant = 0, crop = null } = {}) {
  const klass = properties.class;
  const subclass = properties.subclass;

  // Rocher, éboulis, causse : rien à clore, mais de quoi bâtir.
  if (klass === 'rock') return steepness > 0.12 ? 'dryStoneWall' : null;
  if (klass === 'wood' || klass === 'wetland' || klass === 'sand' || klass === 'ice') return null;

  const isFarmland = klass === 'farmland';
  const isGrass = klass === 'grass' || subclass === 'meadow' || subclass === 'grassland';
  if (!isFarmland && !isGrass) return null;

  // Au-delà de 20 % de pente moyenne, la clôture cède la place au mur : c'est
  // le paysage de terrasses et de parcellaire de montagne.
  if (steepness > 0.2) return 'dryStoneWall';

  if (isFarmland) {
    if (steepness > 0.12) return 'dryStoneWall';
    // Une parcelle en culture ne se clôt pas (le blé, le maïs ne s'échappent pas).
    if (crop && crop !== 'plough') return null;
    // Reste le labour. Deux limites sur cinq seulement portent une haie (openfield).
    if (variant < 0.4) return 'hedge';
    if (variant < 0.62) return 'lowHedge';
    return null;
  }

  // Pâture : bois ou barbelé, tiré une fois pour toute la parcelle.
  if (variant < 0.2) return 'hedge';
  return variant < 0.58 ? 'woodFence' : 'barbedWire';
}

/**
 * Ce qui pousse dans un champ, d'après ses attributs et un tirage de
 * parcelle. Le schéma OpenMapTiles ne dit jamais la culture (sauf verger,
 * vigne, pépinière) : le reste est déduit, à peu près selon l'assolement
 * français (céréales d'abord, puis prairie temporaire et labour).
 *
 * @returns {'wheat'|'maize'|'sunflower'|'vineyard'|'orchard'|'plough'|null}
 */
export function cropFor(properties = {}, variant = 0) {
  const klass = properties.class;
  const subclass = properties.subclass;

  if (subclass === 'vineyard') return 'vineyard';
  if (subclass === 'orchard' || subclass === 'plant_nursery') return 'orchard';
  if (klass !== 'farmland') return null;

  if (variant < 0.34) return 'wheat';
  if (variant < 0.52) return 'plough';
  if (variant < 0.68) return 'maize';
  if (variant < 0.78) return 'sunflower';
  if (variant < 0.86) return 'vineyard';
  if (variant < 0.92) return 'orchard';
  return 'plough';
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
  return null;
}

/**
 * Bétail d'une pâture : espèce et taille du troupeau. Les bovins dominent en
 * plaine herbagère, les ovins en terrain sec ou accidenté.
 *
 * @param {Object} [context]
 * @param {number} [context.steepness] Pente moyenne alentour.
 * @param {number} [context.variant]   Tirage dans [0, 1[ attaché à la parcelle.
 * @returns {{item:string, spread:number}}
 */
export function herdFor({ steepness = 0, variant = 0 } = {}) {
  // Estive ou parcellaire de montagne franc : la chèvre broute où le mouton ne monte plus.
  if (steepness > 0.34) {
    return variant < 0.5
      ? { item: 'goat', spread: 0.24 }
      : { item: 'sheep', spread: 0.3 };
  }
  const sheepOdds = steepness > 0.14 ? 0.75 : 0.34;
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
