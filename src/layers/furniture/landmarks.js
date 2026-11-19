import { finishGeneration } from '../../core/generationSteps.js';
/*
 * landmarks — les repères : ce qu'un bourg porte (moulin, château d'eau), les
 * pierres d'un sol minéral, et ce qui donne à l'horizon son échelle verticale
 * (éoliennes, pylônes, antennes de sommet, phares, arbres de crête).
 *
 * Deux origines, et elles ne se valent pas. Ce qui est **lu** dans la donnée —
 * un sommet, un trait de côte, un périmètre habité — ancre la recherche. Une
 * antenne rejoint le point haut du relief voisin ; un col n'en porte pas. Ce
 * qui est **semé** sur une grille — parc éolien, pylône, pierre, arbre de
 * crête — ne prétend pas l'être : la grille est ancrée au monde et non à l'observateur,
 * de sorte qu'un repère ne bouge pas d'une reconstruction à l'autre, et ne
 * s'efface pas non plus quand on s'en approche.
 */

import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { resamplePath } from '../ribbonGeometry.js';
import { WATER_SOURCE_LAYER } from '../../terrain/groundClassMap.js';
import { pointInAreas, ringsOf } from '../settlement.js';
import { rockKindFor, ringCentroid, pickShare } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, PLANTED_TREE } from './catalog.js';
import { plantedSpeciesShares } from '../plantedTrees.js';
import { reachedRadius } from '../../core/decorReach.js';
import { randomAt, worldCellsAround, worldCellsIn } from '../../core/groundSeed.js';
import { activeVolcanoNear } from '../../core/volcanoes.js';

/**
 * Seuils de taille d'un bourg, en bâtiments comptés autour de son centroïde
 * (`FabricIndex.countWithin`) — voir `buildVillageLandmarks`.
 */
export const VILLAGE_HAMLET_MAX_BUILDINGS = 20;
export const VILLAGE_TOWN_MAX_BUILDINGS = 150;

/** Portée des seuls repères d'horizon — ils n'existent que pour la profondeur. */
export const LANDMARK_RADIUS_M = 2400;
/**
 * Dégagement autour d'une éolienne ou d'un pylône, en mètres : aucun bâtiment
 * à moins de ça.
 *
 * Ces objets n'existent pas dans la donnée — ils sont posés sur une grille, là
 * où le relief est haut. Rien ne dit donc qu'ils tombent sur du vide, et c'est
 * ce que cette distance vérifie. Elle a remplacé une distance **à
 * l'observateur** (420 m), qui protégeait la même chose de la mauvaise
 * manière : en effaçant le repère au moment où on l'atteignait.
 */
export const LANDMARK_CLEARANCE_M = 55;
/** Même chose pour l'arbre de crête, qui tient moins de place. */
export const RIDGE_TREE_CLEARANCE_M = 25;

/** Portée des cailloux et blocs rocheux, en mètres (celle du reste du mobilier). */
export const ROCK_RADIUS_M = FURNITURE_RADIUS_M;
/**
 * Rayon où un phare cherche son point haut autour du point de côte tiré,
 * distance au rivage qu'il ne dépasse pas, et pas de la grille de recherche,
 * en mètres.
 */
export const LIGHTHOUSE_SEARCH_M = 500;
export const LIGHTHOUSE_SHORE_M = 120;
export const LIGHTHOUSE_GRID_M = 25;

/**
 * Le point le plus haut à portée d'un point de côte, sans s'éloigner du
 * rivage. Fonction pure.
 *
 * La recherche couvre un disque et non la seule normale au trait de côte : au
 * fond d'une anse, la hauteur est sur les côtés — les falaises qui encadrent
 * la plage —, pas derrière elle. La grille est ancrée au monde : deux points
 * de côte voisins trouvent le même sommet.
 *
 * @param {{x:number,z:number}} p Point de côte tiré.
 * @param {Array<{x:number,z:number}>} shore Trait de côte rééchantillonné.
 * @param {Object} options
 * @param {Object} options.frame Repère local, qui ancre la grille au monde.
 * @param {(x:number,z:number)=>number} options.elevationAt
 * @param {(x:number,z:number)=>boolean} [options.blocked] Bâti, chaussée, eau.
 * @returns {{x:number,z:number,h:number}|null}
 */
export function lighthouseSite(p, shore, { frame, elevationAt, blocked = () => false }) {
  const reach = LIGHTHOUSE_SEARCH_M + LIGHTHOUSE_SHORE_M;
  const near = shore.filter((s) => Math.abs(s.x - p.x) <= reach && Math.abs(s.z - p.z) <= reach);
  const R = LIGHTHOUSE_SEARCH_M;
  let site = null;
  for (const { x, z } of worldCellsIn(frame, p.x - R, p.z - R, p.x + R, p.z + R, LIGHTHOUSE_GRID_M)) {
    if (Math.hypot(x - p.x, z - p.z) > R) continue;
    const h = elevationAt(x, z);
    // Le seuil écarte un candidat encore sous l'eau.
    if (!Number.isFinite(h) || h < 0.6 || (site && h <= site.h)) continue;
    if (!near.some((s) => Math.hypot(s.x - x, s.z - z) <= LIGHTHOUSE_SHORE_M)) continue;
    if (blocked(x, z)) continue;
    site = { x, z, h };
  }
  return site;
}

/** Pas de la grille de semis des pierres, en mètres. */
export const ROCK_CELL_M = 14;

/**
 * Un repère par périmètre habité, choisi selon la taille du bourg :
 *
 * - **hameau isolé** (moins de vingt bâtiments) — moulin à vent ou moulin à
 *   eau : le genre d'ouvrage qu'on ne trouve précisément que là où il n'y a
 *   pas grand-chose d'autre ;
 * - **ville moyenne** (vingt à cent cinquante bâtiments) — un château d'eau,
 *   qui dessert justement ce format de commune. Un hameau de dix maisons
 *   n'en a pas les moyens, une vraie ville en a d'autres, plus imposants et
 *   non modélisés ici.
 *
 * Il se pose **au bord** du périmètre, jamais dedans. Sans `FabricIndex`
 * (`fabric` absent de `rebuild`), personne ne sait combien de bâtiments
 * compte le périmètre, et ce mobilier ne se pose pas — le bon repli, plutôt
 * que d'en semer un partout par défaut.
 */
export function buildVillageLandmarks(layer, context, builtUp) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  if (!layer._fabric || !builtUp) return;

  for (const ring of builtUp) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const centre = ringCentroid(ring);
    if (Math.hypot(centre.x - here.x, centre.z - here.z) > reachedRadius(FURNITURE_RADIUS_M, layer.bubble)) continue;

    let reach = 0;
    for (const p of ring) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
    // Un périmètre minuscule n'est pas un bourg — un fond de jardin
    // `landuse=residential` isolé, par exemple.
    if (reach < 20) continue;

    // Comptés jusqu'à cent cinquante : au-delà, ni le hameau isolé ni la
    // ville moyenne ne décrivent plus ce périmètre, et aucun des deux
    // repères n'y a sa place.
    const count = layer._fabric.countWithin(centre.x, centre.z, reach + 40, VILLAGE_TOWN_MAX_BUILDINGS);
    if (count === 0) continue;

    // Un seul repère par bourg, et pas dans tous les bourgs : sur le
    // tirage propre au lieu, la plupart n'en portent aucun.
    const draw = randomAt(frame, centre.x, centre.z, 151);
    let item = null;
    if (count < VILLAGE_HAMLET_MAX_BUILDINGS) {
      if (draw < 0.1) item = 'windmill';
      else if (draw < 0.16) item = 'watermill';
    } else if (count < VILLAGE_TOWN_MAX_BUILDINGS) {
      if (draw < 0.3) item = 'waterTower';
    }
    if (!item) continue;

    const angle = randomAt(frame, centre.x, centre.z, 153) * Math.PI * 2;
    const x = centre.x + Math.cos(angle) * reach * 1.25;
    const z = centre.z + Math.sin(angle) * reach * 1.25;
    // Le point tiré peut retomber dans le périmètre bâti voisin d'un hameau
    // à l'autre, ou sur la route qui le dessert : dans les deux cas, on
    // laisse tomber plutôt que de le replacer, pour ne pas déplacer le
    // repère d'une reconstruction à l'autre.
    if (pointInAreas(builtUp, x, z)) continue;
    if (layer._onRoad(x, z)) continue;

    layer._place(placements, item, { x, z, yaw: randomAt(frame, x, z, 157) * Math.PI * 2 });
  }
}

/**
 * Cailloux, blocs et affleurements, là où le sol est minéral.
 *
 * ## Pourquoi une grille et pas des parcelles
 *
 * Parce qu'il n'y a pas de parcelle : un éboulis n'est pas un polygone
 * `landcover=rock` bien découpé, c'est une **matière** qui apparaît à partir
 * d'une certaine altitude et d'une certaine pente. La carte de classes la
 * donne au pixel près, et la pente vient du MNT — d'où un semis sur grille
 * fixe, ancrée au monde et non à l'observateur, exactement comme les repères
 * d'horizon.
 *
 * Chaque maille consomme le **même nombre de tirages** quel que soit son
 * résultat : sans ça, une pierre changerait de place dès qu'une voisine
 * apparaît ou disparaît.
 */
export function buildRocks(...args) { return finishGeneration(buildRocksSteps(...args)); }

export function* buildRocksSteps(layer, context, builtUp) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  const step = ROCK_CELL_M;
  let placed = 0, visited = 0;

  for (const { x, z } of worldCellsAround(frame, here, reachedRadius(ROCK_RADIUS_M, layer.bubble), step)) {
    if (++visited % 32 === 0) yield;
    if (placed >= FURNITURE_LIMITS.rocks) break;
    const px = x + (randomAt(frame, x, z, 101) - 0.5) * step * 0.9;
    const pz = z + (randomAt(frame, x, z, 103) - 0.5) * step * 0.9;
    if (Math.hypot(px - here.x, pz - here.z) > reachedRadius(ROCK_RADIUS_M, layer.bubble)) continue;
    if (pointInAreas(builtUp, px, pz)) continue;
    // Un bloc erratique au milieu de la chaussée est le plus visible de
    // tous les défauts d'emprise : il est opaque et il est haut.
    if (layer._onRoad(px, pz)) continue;
    // La pente lue sous un plan d'eau est celle du MNT brut : un fond raide
    // passerait pour un éboulis.
    if (layer._onWater(px, pz)) continue;

    const sample = layer.groundClass?.sampleAt?.(px, pz);
    // Sans carte de classes, on ne devine pas un éboulis : la pente seule
    // mettrait des rochers sur toutes les prairies de montagne.
    if (!sample) continue;
    const kind = rockKindFor({
      bare: sample.bare,
      steepness: layer._steepnessAt(px, pz),
      variant: randomAt(frame, px, pz, 107),
    });
    if (!kind) continue;

    layer._place(placements, kind.item, {
      x: px,
      z: pz,
      yaw: randomAt(frame, px, pz, 109) * Math.PI * 2,
      scale: kind.scale,
    });
    placed++;
  }
  layer.counts.rocks = placed;
}

// --- Repères d'horizon ---------------------------------------------------

/**
 * Classes `park` où ni éolienne, ni pylône, ni antenne ne se pose.
 *
 * La classe de cette couche est le titre de protection en texte libre
 * (« wildlife_refuge » pour le Parco dell'Etna, « conservation » pour un parc
 * naturel régional, « Natura 2000 »…). Seuls les titres d'espace sauvage
 * l'interdisent : un parc régional ou un site Natura 2000 couvre des
 * campagnes entières, éoliennes comprises.
 */
export const WILD_RESERVE_CLASSES = new Set(['national_park', 'nature_reserve', 'wildlife_refuge', 'wilderness_preserve']);

/**
 * Les enclos historiques (`class=historic` : site archéologique, acropole,
 * nécropole). Leur point haut est souvent le monument lui-même : un phare
 * qui y monterait se planterait au milieu des ruines.
 */
export const HISTORIC_SITE_CLASS = 'historic';

/**
 * Les espaces protégés d'un jeu de tuiles, en anneaux métriques, lus en un
 * seul passage : `reserves` (espaces sauvages) et `historic` (enclos
 * historiques).
 */
export function collectProtectedAreas(source, tiles, frame) {
  const areas = { reserves: [], historic: [] };
  if (!source || !frame) return areas;
  const { origin, scale, zoom } = frame;
  const accept = (properties) => WILD_RESERVE_CLASSES.has(properties.class) || properties.class === HISTORIC_SITE_CLASS;
  source.forEachFeature('park', tiles, (geometry, properties) => {
    if (!accept(properties)) return;
    const into = properties.class === HISTORIC_SITE_CLASS ? areas.historic : areas.reserves;
    for (const ring of ringsOf(geometry)) {
      const local = [];
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        local.push({ x: (lngToTileX(lng, zoom) - origin.x) * scale, z: (latToTileY(lat, zoom) - origin.y) * scale });
      }
      if (local.length >= 3) into.push(local);
    }
  }, accept);
  return areas;
}

/** Maille d'un parc éolien, en mètres : un tirage, au plus un parc. */
export const WIND_FARM_CELL_M = 1200;
/** Part des mailles qui portent un parc, avant les refus du terrain. */
export const WIND_FARM_SHARE = 0.25;
/** Écart entre deux machines d'un parc, en mètres (environ trois rotors). */
export const WIND_FARM_SPACING_M = 280;
/** Pas de la recherche du point haut dans la maille, en mètres. */
const WIND_FARM_SEARCH_M = 100;
/** Points hauts essayés, du plus haut au moins haut, avant de renoncer à la maille. */
const WIND_FARM_ANCHOR_TRIES = 6;
/** Une machine ne descend pas de la crête : pas plus bas que l'ancre de tant de mètres. */
const WIND_FARM_DROP_M = 25;
/** Glissement latéral d'une machine pour rester sur la crête, en mètres. */
const WIND_FARM_SNAP_M = 60;

/**
 * Le sol accepte-t-il un repère d'horizon ici ? Hors bâti et son dégagement,
 * hors espace sauvage, chaussée et eau.
 */
function landmarkGround(layer, builtUp, reserves, x, z) {
  if (pointInAreas(builtUp, x, z) || pointInAreas(reserves, x, z)) return false;
  if (layer._onRoad(x, z)) return false;
  if (layer._fabric?.countWithin(x, z, LANDMARK_CLEARANCE_M, 1) > 0) return false;
  return !layer._onWater(x, z);
}

/**
 * Le site d'un parc dans une maille : le point le plus haut qui soit un point
 * haut, dégagé et hors bois. Chercher le sommet plutôt que tirer un point
 * au hasard est ce qui donne leurs éoliennes aux collines : un point tiré sur
 * un versant n'y est presque jamais un point haut.
 */
function windFarmAnchor(layer, cell, builtUp, reserves, elevationAt) {
  const candidates = [];
  for (const { x, z } of worldCellsIn(layer.bubble.frame, cell.x, cell.z,
    cell.x + cell.size, cell.z + cell.size, WIND_FARM_SEARCH_M)) {
    const px = x + WIND_FARM_SEARCH_M / 2, pz = z + WIND_FARM_SEARCH_M / 2;
    const h = elevationAt(px, pz);
    if (Number.isFinite(h)) candidates.push({ x: px, z: pz, h });
  }
  candidates.sort((a, b) => b.h - a.h || a.z - b.z || a.x - b.x);
  for (const c of candidates.slice(0, WIND_FARM_ANCHOR_TRIES)) {
    if (!layer._openGround(c.x, c.z) || !landmarkGround(layer, builtUp, reserves, c.x, c.z)) continue;
    if (isHighPoint(layer, c.x, c.z)) return c;
  }
  return null;
}

/**
 * Les machines d'un parc, alignées sur la direction qui reste la plus haute
 * autour de l'ancre (la crête, ou n'importe laquelle sur un plateau), chacune
 * glissée en travers vers le haut. Celles que le terrain refuse manquent ;
 * le parc n'existe qu'à deux machines au moins.
 */
export function windFarmSites(layer, anchor, { count, startAngle, elevationAt, accept }) {
  const spacing = WIND_FARM_SPACING_M;
  const half = (count - 1) / 2;
  let best = null;
  for (let k = 0; k < 8; k++) {
    const angle = startAngle + (k * Math.PI) / 8;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const t = (i - half) * spacing;
      sum += elevationAt(anchor.x + dx * t, anchor.z + dz * t);
    }
    if (Number.isFinite(sum) && (!best || sum > best.sum)) best = { sum, dx, dz };
  }
  if (!best) return [];

  const sites = [];
  for (let i = 0; i < count; i++) {
    const t = (i - half) * spacing;
    const bx = anchor.x + best.dx * t, bz = anchor.z + best.dz * t;
    let site = null;
    for (let s = -WIND_FARM_SNAP_M; s <= WIND_FARM_SNAP_M; s += 20) {
      const x = bx - best.dz * s, z = bz + best.dx * s;
      const h = elevationAt(x, z);
      if (Number.isFinite(h) && (!site || h > site.h)) site = { x, z, h };
    }
    if (site && site.h >= anchor.h - WIND_FARM_DROP_M && accept(site.x, site.z)) sites.push(site);
  }
  return sites.length >= 2 ? sites : [];
}

/**
 * Parcs éoliens, au loin.
 *
 * Ils ne sont pas dans les tuiles — `generator:source=wind` n'y survit pas —,
 * et ne prétendent donc pas être à leur vraie place. Ils donnent à l'horizon
 * une échelle verticale : sans eux, un brouillard sur un relief nu ne dit pas
 * si la crête est à un kilomètre ou à dix. Un parc tient sur une maille
 * mondiale, au point haut de la maille, en ligne de deux à quatre machines.
 */
export function buildWindFarms(layer, context, builtUp, reserves = null) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  const radius = reachedRadius(Math.min(LANDMARK_RADIUS_M, layer.bubble.radiusMeters || LANDMARK_RADIUS_M), layer.bubble);
  const elevationAt = (x, z) => layer.bubble.surfaceElevationAtLocal(x, z, NaN);
  const accept = (x, z) => Math.hypot(x - here.x, z - here.z) <= radius &&
    layer._openGround(x, z) && landmarkGround(layer, builtUp, reserves, x, z);
  // Reconstituée à chaque reconstruction ; `setWindDirection` la relit donc
  // pour orienter les éoliennes fraîchement posées, pas celles d'avant.
  layer._turbines = [];
  const limit = FURNITURE_LIMITS.windTurbines;

  for (const cell of worldCellsAround(frame, here, radius + WIND_FARM_CELL_M, WIND_FARM_CELL_M)) {
    if (randomAt(frame, cell.x, cell.z, 95) > WIND_FARM_SHARE) continue;
    const anchor = windFarmAnchor(layer, cell, builtUp, reserves, elevationAt);
    if (!anchor) continue;
    const count = randomAt(frame, cell.x, cell.z, 96) < 0.5 ? 3 : 4;
    const startAngle = randomAt(frame, cell.x, cell.z, 97) * Math.PI;
    const sites = windFarmSites(layer, anchor, { count, startAngle, elevationAt, accept });
    // Un parc entier ou rien : le plafond n'en coupe pas un en deux, et un
    // parc trop grand pour ce qui reste n'empêche pas un plus petit plus loin.
    if (sites.length === 0 || layer._turbines.length + sites.length > limit) continue;
    for (const s of sites) {
      const entry = layer._place(placements, 'windTurbine', { x: s.x, z: s.z, yaw: layer._turbineYaw(), limit });
      if (entry) layer._turbines.push(entry);
    }
  }
}

/**
 * Pylônes, au loin : même rôle d'échelle que les éoliennes, semés un par
 * maille sur les points hauts, à l'écart des machines déjà posées.
 */
export function buildLandmarks(layer, context, builtUp, reserves = null) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  const radius = reachedRadius(Math.min(LANDMARK_RADIUS_M, layer.bubble.radiusMeters || LANDMARK_RADIUS_M), layer.bubble);
  const step = 320;
  let placed = 0;
  const turbines = layer._turbines ?? [];

  // Grille ancrée sur le monde, pas sur l'observateur : les mailles visitées
  // changent, les tirages de chaque maille non.
  for (const { x, z } of worldCellsAround(frame, here, radius, step)) {
    if (placed >= FURNITURE_LIMITS.landmarks) break;
    const draw = randomAt(frame, x, z, 91);
    if (draw < 0.08 || draw > 0.14) continue;

    // Décalage dans la maille : une grille régulière se lit comme une grille.
    const px = x + (randomAt(frame, x, z, 92) - 0.5) * step * 0.8;
    const pz = z + (randomAt(frame, x, z, 93) - 0.5) * step * 0.8;
    if (Math.hypot(px - here.x, pz - here.z) > radius) continue;
    // Jamais une distance minimale à l'observateur : un repère qu'on voit à
    // deux kilomètres et qui s'efface quand on arrive dessus n'en est plus un.
    if (!landmarkGround(layer, builtUp, reserves, px, pz)) continue;
    if (turbines.some((t) => Math.hypot(t.x - px, t.z - pz) < LANDMARK_CLEARANCE_M * 2)) continue;
    if (!isHighPoint(layer, px, pz)) continue;

    layer._place(placements, 'pylon', { x: px, z: pz, yaw: randomAt(frame, px, pz, 94) * Math.PI * 2 });
    placed++;
  }
  layer.counts.landmarks = placed + turbines.length;
}

/**
 * Arbre isolé de ligne de crête : un repère de hauteur, à défaut d'une
 * vraie détection de crête.
 *
 * Rien dans le MNT ni dans les tuiles ne dit « ceci est une ligne de
 * crête ». La détection retenue est une approximation assumée : un point
 * haut par rapport à ses abords immédiats (`isHighPoint`, déjà utilisé
 * pour poser éoliennes et pylônes) et dégagé (`_openGround`). Un vrai calcul
 * suivrait la ligne de partage des eaux dans le MNT, ce qui reste à faire ;
 * ceci pose un arbre là où le relief est visiblement haut, pas
 * nécessairement sur l'arête exacte. Son essence est une de celles du pays,
 * aux parts de ses bois.
 */
export function buildRidgeTrees(layer, context, builtUp) {
  const { frame } = layer.bubble;
  const { here, placements } = context;
  const radius = reachedRadius(Math.min(LANDMARK_RADIUS_M, layer.bubble.radiusMeters || LANDMARK_RADIUS_M), layer.bubble);
  const step = 140;
  let placed = 0;
  const mix = plantedSpeciesShares(layer.region?.trees, layer.theme.trees);
  if (mix.length === 0) return;

  for (const { x, z } of worldCellsAround(frame, here, radius, step)) {
    if (placed >= FURNITURE_LIMITS.ridgeTrees) break;
    // Rare : un arbre de crête toutes les vingt à trente mailles environ,
    // jamais un par maille — sans quoi la grille se verrait.
    if (randomAt(frame, x, z, 181) > 0.035) continue;

    const px = x + (randomAt(frame, x, z, 182) - 0.5) * step * 0.8;
    const pz = z + (randomAt(frame, x, z, 183) - 0.5) * step * 0.8;
    if (Math.hypot(px - here.x, pz - here.z) > radius) continue;
    if (pointInAreas(builtUp, px, pz)) continue;
    // Même chose que pour les éoliennes : l'emprise routière et le bâti
    // disent déjà où l'arbre ne va pas, sans distance à l'observateur.
    if (layer._onRoad(px, pz)) continue;
    if (layer._fabric?.countWithin(px, pz, RIDGE_TREE_CLEARANCE_M, 1) > 0) continue;
    if (!layer._openGround(px, pz) || layer._onWater(px, pz)) continue;
    if (!isHighPoint(layer, px, pz)) continue;

    const tree = layer._place(placements, PLANTED_TREE, {
      x: px,
      z: pz,
      yaw: randomAt(frame, px, pz, 185) * Math.PI * 2,
      scale: 0.9 + randomAt(frame, px, pz, 186) * 0.5,
    });
    if (tree) tree.species = pickShare(mix, randomAt(frame, px, pz, 184));
    placed++;
  }
}

/** Vrai si le point domine ses alentours immédiats — une crête, pas un fond. */
export function isHighPoint(layer, x, z) {
  const here = layer.bubble.surfaceElevationAtLocal(x, z, 0);
  if (!Number.isFinite(here)) return false;
  let higher = 0;
  for (const [dx, dz] of [[-140, 0], [140, 0], [0, -140], [0, 140]]) {
    if (layer.bubble.surfaceElevationAtLocal(x + dx, z + dz, 0) > here + 4) higher++;
  }
  return higher === 0;
}

/** Recherche bornée autour du sommet nommé, sur une grille mondiale de 10 m. */
export const PEAK_SEARCH_M = 100;
// Le cratère se cherche à 700 m du sommet listé (`volcanoFire.CRATER_SEARCH_M`) ; marge pour ses lèvres.
const ACTIVE_VOLCANO_CLEARANCE_M = 1000;

export function peakMastSite(p, { frame, elevationAt, blocked = () => false }) {
  let site = null;
  for (const { x, z } of worldCellsIn(frame, p.x - PEAK_SEARCH_M, p.z - PEAK_SEARCH_M,
    p.x + PEAK_SEARCH_M, p.z + PEAK_SEARCH_M, 10)) {
    const distance = Math.hypot(x - p.x, z - p.z);
    if (distance > PEAK_SEARCH_M) continue;
    const h = elevationAt(x, z);
    if (!Number.isFinite(h)) continue;
    if (!site || h > site.h || (h === site.h && distance < site.distance)) site = { x, z, h, distance };
  }
  if (!site || blocked(site.x, site.z)) return null;
  // Le maximum d'un disque en pente est son bord, pas un sommet.
  for (const r of [20, 60, 140]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const h = elevationAt(site.x + Math.cos(angle) * r, site.z + Math.sin(angle) * r);
      if (!Number.isFinite(h) || h > site.h + 1) return null;
    }
  }
  return { x: site.x, z: site.z, h: site.h };
}

/** Antennes : seuls les points `class=peak` ancrent une pose, jamais les cols ni un volcan actif. */
export function buildPeakLandmarks(layer, context, builtUp, reserves = null) {
  const { frame } = layer.bubble;
  const { source, tiles, here, placements } = context;
  const { origin, scale, zoom } = frame;
  const sites = [];

  source.forEachFeature('mountain_peak', tiles, (geometry, properties) => {
    if (geometry.type !== 'Point' || properties.class !== 'peak') return;
    const [lng, lat] = geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    // Un cône en éruption ne porte pas d'antenne relais.
    if (activeVolcanoNear(lng, lat, ACTIVE_VOLCANO_CLEARANCE_M)) return;

    const x = (lngToTileX(lng, zoom) - origin.x) * scale;
    const z = (latToTileY(lat, zoom) - origin.y) * scale;
    if (Math.hypot(x - here.x, z - here.z) > LANDMARK_RADIUS_M) return;
    // Un sommet sur trois environ, tiré sur sa position : les équiper tous
    // ferait une forêt de mâts, ce qu'aucune ligne de crête ne porte.
    if (randomAt(frame, x, z, 131) > 0.35) return;

    const site = peakMastSite({ x, z }, {
      frame,
      elevationAt: (px, pz) => layer.bubble.naturalElevationAtLocal(px, pz, NaN),
      blocked: (px, pz) => pointInAreas(builtUp, px, pz) || pointInAreas(reserves, px, pz) || layer._onRoad(px, pz) || layer._onWater(px, pz) ||
        layer._fabric?.countWithin(px, pz, LANDMARK_CLEARANCE_M, 1) > 0,
    });
    if (!site || Math.hypot(site.x - here.x, site.z - here.z) > LANDMARK_RADIUS_M) return;
    sites.push(site);
  });
  sites.sort((a, b) => b.h - a.h || a.x - b.x || a.z - b.z);
  const uniques = sites.filter((site, i) => !sites.slice(0, i).some((s) => Math.hypot(s.x - site.x, s.z - site.z) < 20));
  uniques.sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z) || a.x - b.x || a.z - b.z);
  for (const { x, z } of uniques.slice(0, FURNITURE_LIMITS.peakLandmarks)) {
    layer._place(placements, 'radioMast', { x, z, yaw: randomAt(frame, x, z, 133) * Math.PI * 2 });
  }
}

/**
 * Phares : posés sur le trait de côte réel, jamais devinés — seule une
 * nappe `water` de classe `ocean` en fait un, une rivière ou un lac n'en
 * portent pas.
 *
 * Le trait de côte dit **où** il y a un phare, pas à quel endroit exact : il
 * monte au point le plus haut des environs resté près du rivage
 * (`lighthouseSite`), là où son feu porte — hors d'un bourg et hors d'un
 * enclos historique.
 */
export function buildCoastalLandmarks(layer, context, builtUp, historic = null) {
  const { source, tiles, here, placements, sampleElevation } = context;
  const { origin, scale, zoom } = layer.bubble.frame;
  const toLocal = (ring) =>
    ring.map(([lng, lat]) => ({
      x: (lngToTileX(lng, zoom) - origin.x) * scale,
      z: (latToTileY(lat, zoom) - origin.y) * scale,
    }));
  let placed = 0;

  source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
    if (placed >= FURNITURE_LIMITS.coastLandmarks) return;
    if (properties.class !== 'ocean') return;

    const rings =
      geometry.type === 'Polygon'
        ? [geometry.coordinates[0]]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates.map((r) => r[0]).filter(Boolean)
          : [];

    for (const ring of rings) {
      if (placed >= FURNITURE_LIMITS.coastLandmarks) break;
      if (!Array.isArray(ring) || ring.length < 3) continue;

      const path = resamplePath(toLocal(ring), 60);
      if (path.length < 3) continue;

      for (let i = 1; i < path.length - 1 && placed < FURNITURE_LIMITS.coastLandmarks; i++) {
        const p = path[i];
        if (Math.hypot(p.x - here.x, p.z - here.z) > LANDMARK_RADIUS_M) continue;

        // Un point de trait de côte sur quarante environ : un phare tous
        // les deux kilomètres et demi, pas un tous les soixante mètres.
        if (randomAt(layer.bubble.frame, p.x, p.z, 141) > 0.025) continue;

        const site = lighthouseSite(p, path, {
          frame: layer.bubble.frame,
          elevationAt: sampleElevation,
          blocked: (x, z) => pointInAreas(builtUp, x, z) || pointInAreas(historic, x, z) || layer._onRoad(x, z) || layer._onWater(x, z),
        });
        if (!site) continue;
        // Deux points de côte voisins montent au même sommet : un seul phare.
        if (layer._lighthouses.some((l) => Math.hypot(l.x - site.x, l.z - site.z) < LIGHTHOUSE_SEARCH_M)) continue;

        const entry = layer._place(placements, 'lighthouse', { x: site.x, z: site.z, yaw: randomAt(layer.bubble.frame, site.x, site.z, 143) * Math.PI * 2 });
        if (entry) layer._lighthouses.push(entry);
        placed++;
      }
    }
  });
}

