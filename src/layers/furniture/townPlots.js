/*
 * townPlots — ce qui garnit un **vide** de l'habitat : le terrain que la donnée
 * laisse nu au milieu d'une ville, sans bâtiment, sans rue et sans vert relevé,
 * et les places piétonnes que la donnée relève (`townTrees.isSquare`).
 *
 * Un îlot entier sans bâtiment est presque toujours un îlot mal relevé, pas un
 * terrain vague ; le laisser nu donne une ville trouée. On y invente donc ce
 * qu'une ville met dans ses creux, selon la place libre et le sol :
 *
 * - une **piazza** quand le vide est large et pavé (`pavement`), ou qu'il est
 *   une place piétonne : une place minérale, pas un bosquet sur le pavé, dans
 *   l'une de quatre dispositions tirées par place (`PIAZZA_LAYOUTS` : anneau
 *   de bancs autour d'une fontaine, mail, quinconce, croix d'allées) — aucune
 *   ne suit la forme du vide, qui n'est connu que par son disque libre ;
 * - un **parc** quand le vide est large et ne l'est pas : arbres serrés aux
 *   essences de ville du pays, bancs tournés vers le milieu, massifs, bacs ;
 * - une **placette** quand il est juste assez grand (`PLACETTE_FREE_M`) : un
 *   arbre, un ou deux bancs dos au tronc, un bac à fleurs ;
 * - un **recoin** quand il ne tient qu'un disque de `NOOK_FREE_M` : un bac à
 *   fleurs, un banc à côté — de quoi meubler l'élargissement d'une ruelle sans
 *   y planter un arbre.
 *
 * Un point semé ne tombe presque jamais au milieu de son vide : il est d'abord
 * recentré (`centreInVoid`), poussé loin des obstacles que ses sondes touchent,
 * puis la place libre se mesure autour du centre trouvé. Sans ce recentrage,
 * une ville dense ne garnit que les vides où le tirage tombe par chance au
 * milieu. Deux points recentrés dans le même vide n'en font qu'un : un disque
 * libre qui en recoupe un plus grand est écarté.
 *
 * La place libre se mesure par sondes (bâtiment, chaussée, eau) sur quelques
 * cercles, pas par la seule distance au centre d'un bâtiment : un grand
 * bâtiment a son centre loin de ses façades. Un vide n'est garni que s'il est
 * entouré de bâti (`TOWN_BUILDINGS_MIN`) ou d'une grille de rues : l'emprise
 * résidentielle qui déborde sur les champs reste un champ. Une place piétonne
 * relevée n'a pas à le prouver. Le vert déjà relevé (parc, stade, cimetière)
 * n'est jamais repris : son sol n'est pas celui d'un quartier.
 *
 * Le semis suit une maille mondiale (`worldCellsIn`) et chaque tirage une
 * position quantifiée ; le choix entre deux vides qui se recoupent ne dépend
 * que d'eux, et les vides retenus sont posés du plus proche au plus lointain,
 * pour que les plafonds coupent au loin.
 */
import { worldCellsIn, randomAt } from '../../core/groundSeed.js';
import { pointInAreas } from '../settlement.js';
import { reachedRadius } from '../../core/decorReach.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, PLANTED_TREE } from './catalog.js';
import { pickShare, streetLampKindFor } from '../furniturePlacement.js';
import { lampHeadFor } from '../furnitureKit.js';
import { churchWithin } from './pointsOfInterest.js';
import { STREET_LAMP_CHURCH_RADIUS_M } from './roadsideFurniture.js';
import { plantedSpeciesShares, townSpeciesWords } from '../plantedTrees.js';
import { placeFauna } from './parcelFauna.js';

/** Pas de la maille des vides, en mètres : un point semé par maille, recentré ensuite dans son vide. */
export const PLOT_CELL_M = 40;
/** Rayons sondés, du plus court au plus long, et directions par rayon. */
export const PLOT_PROBE_RADII_M = [6, 10, 16, 22, 28];
const PLOT_PROBE_DIRECTIONS = 8;
/**
 * Pas de recentrage d'un point dans son vide, le gain sur la moyenne des sondes
 * (qui, plafonnées à la plus longue, sous-estiment la distance au centre) et
 * le déplacement sous lequel on s'arrête.
 */
const RECENTRE_STEPS = 2;
const RECENTRE_GAIN = 2;
const RECENTRE_SETTLE_M = 2;
/** Place libre qui fait un parc (ou une piazza), une placette, un recoin. */
export const PARK_FREE_M = 22;
export const PLACETTE_FREE_M = 10;
export const NOOK_FREE_M = 6;
/**
 * Part des vides de placette, et de recoin, réellement garnis : un quartier
 * n'a pas une placette tous les 30 m. Un seul tirage par maille pour les deux,
 * le recoin prenant la plus petite part.
 */
export const PLACETTE_SHARE = 0.55;
export const NOOK_SHARE = 0.5;
/** Écart du banc au bac d'un recoin. */
const NOOK_BENCH_OFFSET_M = 1.6;
/** Bâtiments exigés dans `TOWN_REACH_M` pour que le vide soit en ville. */
export const TOWN_BUILDINGS_MIN = 6;
export const TOWN_REACH_M = 90;
/** Un îlot sans bâtiment relevé reste en ville s'il est bordé de rues sur autant de côtés, à cette portée. */
export const STREET_BLOCK_SIDES = 3;
export const STREET_BLOCK_REACH_M = 70;
const STREET_BLOCK_STEP_M = 5;
/** Sols qu'un vide de quartier peut avoir : le revêtement d'une ville, l'habitat, ou rien de relevé. */
const PLOT_SURFACES = new Set(['pavement', 'settled', null]);

/** Piazza en anneau : bancs autour du centre, lampadaires et arbres sur le pourtour, à cet arc. */
const PIAZZA_BENCH_RING_M = 7;
const PIAZZA_BENCH_ARC_M = 7;
const PIAZZA_BENCH_SHARE = 0.75;
const PIAZZA_PLANTER_SHARE = 0.4;
const PIAZZA_LAMP_ARC_M = 30;
const PIAZZA_LAMPS_MAX = 4;
const PIAZZA_TREE_ARC_M = 10;
const PIAZZA_TREE_SHARE = 0.7;
/** Part des piazzas inventées qui ont une fontaine ; les autres ont un arbre au milieu. */
const PIAZZA_FOUNTAIN_SHARE = 0.35;
/** Recul du pourtour sur la place libre. */
const PIAZZA_RIM_INSET_M = 3;
/** Dispositions d'une piazza, tirées par place : aucune ne dépend de sa forme. */
export const PIAZZA_LAYOUTS = ['ring', 'mail', 'quincunx', 'cross'];
/** Mail : largeur de l'allée entre les deux rangées, pas des arbres, part plantée. */
const PIAZZA_MAIL_ALLEY_M = 10;
const PIAZZA_MAIL_STEP_M = 8;
const PIAZZA_MAIL_TREE_SHARE = 0.9;
/** Quinconce : pas, rayon dégagé au milieu, part plantée, plafond d'arbres, bancs au pied. */
const PIAZZA_QUINCUNX_STEP_M = 8;
const PIAZZA_QUINCUNX_HOLE_M = 5;
const PIAZZA_QUINCUNX_TREE_SHARE = 0.85;
const PIAZZA_QUINCUNX_TREES_MAX = 10;
const PIAZZA_QUINCUNX_BENCH_SHARE = 0.35;
/** Croix : distance au centre des bancs le long des allées. */
const PIAZZA_CROSS_BENCH_M = 6;
/** Formes qui font déjà le centre d'une place : on n'en ajoute pas une seconde. */
const CENTREPIECES = ['fountain', 'fountainWallace', 'monument'];

/** Arbres d'un parc inventé : maille plus serrée qu'un parc relevé, qui n'est qu'une pelouse. */
export const INVENTED_PARK_TREES = { cellM: 9, share: 0.5, clearanceM: 2, salt: 1401 };
/** Bancs d'un parc : un par portion d'anneau de cet arc, en mètres, et leur part. */
const PARK_BENCH_ARC_M = 14;
const PARK_BENCH_SHARE = 0.6;
/** Massifs et bacs d'un parc, par tirage sur la maille des arbres non plantée. */
const PARK_BUSH_SHARE = 0.18;
const PARK_PLANTER_SHARE = 0.08;
/** Bancs d'une placette (dos à l'arbre) et écart au tronc, bacs et leur écart. */
const PLACETTE_BENCH_OFFSET_M = 1.8;
const PLACETTE_PLANTER_OFFSET_M = 3.2;
/** Chance qu'un parc ou une placette ait une bête, et part de chiens. */
const PARK_PET_ODDS = 0.45;
const PLACETTE_PET_ODDS = 0.2;
const PLOT_DOG_SHARE = 0.35;
const PET_FLEE_ODDS = 1 / 3;

/**
 * Plus grand rayon sondé resté libre autour d'un point, ou 0 si le premier ne
 * l'est pas. Fonction pure : `blocked(x, z)` dit si un point est pris.
 *
 * @returns {number}
 */
export function freeRadiusAt(x, z, blocked, radii = PLOT_PROBE_RADII_M, directions = PLOT_PROBE_DIRECTIONS) {
  if (blocked(x, z)) return 0;
  let free = 0;
  for (const radius of radii) {
    for (let k = 0; k < directions; k++) {
      const a = (k / directions) * Math.PI * 2;
      if (blocked(x + Math.sin(a) * radius, z + Math.cos(a) * radius)) return free;
    }
    free = radius;
  }
  return free;
}

/** Vrai si, dans une des directions sondées, le vide est plus étroit que `width` d'une façade à l'autre. */
function narrowerThan(reach, width) {
  const half = reach.length / 2;
  for (let k = 0; k < half; k++) if (reach[k] + reach[k + half] < width) return true;
  return false;
}

/**
 * Recentre un point dans son vide : chaque pas le pousse du côté où ses sondes
 * vont le plus loin, et s'arrête quand il ne bouge plus. Rend le centre trouvé
 * et sa place libre, ou `null` si le point est pris. Un vide plus étroit que
 * `minFree` de part et d'autre, ou qu'aucune sonde ne traverse au-delà d'une
 * placette, n'est pas recentré : il ne tiendrait pas ce qu'on y cherche.
 * Fonction pure.
 *
 * @returns {{x:number, z:number, free:number}|null}
 */
export function centreInVoid(x, z, blocked, minFree = NOOK_FREE_M, radii = PLOT_PROBE_RADII_M, directions = PLOT_PROBE_DIRECTIONS) {
  if (blocked(x, z)) return null;
  const reach = new Array(directions);
  for (let step = 0; ; step++) {
    let free = Infinity, dx = 0, dz = 0;
    for (let k = 0; k < directions; k++) {
      const a = (k / directions) * Math.PI * 2;
      const sin = Math.sin(a), cos = Math.cos(a);
      let ray = 0;
      for (const radius of radii) {
        if (blocked(x + sin * radius, z + cos * radius)) break;
        ray = radius;
      }
      reach[k] = ray;
      if (ray < free) free = ray;
      dx += sin * ray;
      dz += cos * ray;
    }
    // Les sondes sous-estiment la largeur d'au plus un écart de rayons : on le lui accorde.
    if (step === 0 && (narrowerThan(reach, 2 * minFree - radii[0]) || Math.max(...reach) < PLACETTE_FREE_M)) return { x, z, free };
    dx *= RECENTRE_GAIN / directions;
    dz *= RECENTRE_GAIN / directions;
    // Un point qui tient déjà le plus grand des vides garnis n'a plus à bouger.
    if (step >= RECENTRE_STEPS || free >= PARK_FREE_M || dx * dx + dz * dz < RECENTRE_SETTLE_M * RECENTRE_SETTLE_M) return { x, z, free };
    // Un pas qui retombe sur un obstacle est raccourci de moitié, puis abandonné.
    if (!blocked(x + dx, z + dz)) { x += dx; z += dz; }
    else if (!blocked(x + dx / 2, z + dz / 2)) { x += dx / 2; z += dz / 2; }
    else return { x, z, free };
  }
}

/**
 * Vrai si des rues bordent le point sur au moins `STREET_BLOCK_SIDES` des
 * quatre côtés : l'îlot d'une grille de rues, que le bâti soit relevé ou non.
 * Fonction pure : `onRoad(x, z)` dit si un point est sur une chaussée.
 */
export function streetBlockAt(x, z, onRoad, reach = STREET_BLOCK_REACH_M) {
  let sides = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = STREET_BLOCK_STEP_M; d <= reach; d += STREET_BLOCK_STEP_M) {
      if (onRoad(x + dx * d, z + dz * d)) { sides++; break; }
    }
  }
  return sides >= STREET_BLOCK_SIDES;
}

/**
 * Ce que devient un vide selon sa place libre et son sol : `'piazza'`,
 * `'park'`, `'placette'`, `'nook'` ou `null`. Une place piétonne relevée est une piazza
 * dès qu'elle tient une placette. Fonction pure.
 */
export function plotKindFor(free, { paved = false, square = false } = {}) {
  if (square && free >= PLACETTE_FREE_M + 6) return 'piazza';
  if (free >= PARK_FREE_M) return paved || square ? 'piazza' : 'park';
  if (free >= PLACETTE_FREE_M) return 'placette';
  if (free >= NOOK_FREE_M) return 'nook';
  return null;
}

/** Octogone de rayon `radius` autour d'un point, anneau local. */
function octagon(x, z, radius) {
  const ring = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    ring.push({ x: x + Math.sin(a) * radius, z: z + Math.cos(a) * radius });
  }
  return ring;
}

/** Mailles de `PLOT_CELL_M` qui couvrent les anneaux, rognées à la portée. */
function cellsOver(frame, rings, here, radius) {
  const cells = [];
  for (const ring of rings) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    minX = Math.max(minX, here.x - radius);
    maxX = Math.min(maxX, here.x + radius);
    minZ = Math.max(minZ, here.z - radius);
    maxZ = Math.min(maxZ, here.z + radius);
    if (minX > maxX || minZ > maxZ) continue;
    cells.push(...worldCellsIn(frame, minX, minZ, maxX, maxZ, PLOT_CELL_M));
  }
  return cells;
}

/**
 * Les vides garnis de la fenêtre, triés par distance. `squares` : les places
 * piétonnes relevées, garnies sans avoir à prouver qu'elles sont en ville.
 *
 * @returns {Array<{x:number,z:number,free:number,kind:string,distance:number,square:boolean}>}
 */
function findPlots(layer, builtUp, squares, here, radius) {
  const { frame } = layer.bubble;
  const fabric = layer._fabric;
  if (!fabric?.count || !(builtUp?.length || squares.length)) return [];

  const blocked = (x, z) => fabric.covers(x, z, 1) || layer._onRoad(x, z) || layer._onWater(x, z);
  const probeReach = PLOT_PROBE_RADII_M.at(-1);
  const seen = new Set();
  const seeds = [];
  for (const cell of [...cellsOver(frame, squares, here, radius), ...cellsOver(frame, builtUp ?? [], here, radius)]) {
    const key = `${cell.id}:${cell.row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = cell.x + (0.1 + randomAt(frame, cell.x, cell.z, 1411) * 0.8) * cell.size;
    const z = cell.z + (0.1 + randomAt(frame, cell.x, cell.z, 1413) * 0.8) * cell.size;
    // Les sondes ne sortent pas de la portée : au-delà, le bâti n'est pas
    // construit, et un vide qui n'en est pas un y suivrait l'observateur.
    const distance = Math.hypot(x - here.x, z - here.z);
    if (distance + probeReach > radius) continue;
    const square = squares.length > 0 && pointInAreas(squares, x, z);
    if (!square && !pointInAreas(builtUp, x, z)) continue;
    if (blocked(x, z)) continue;
    if (!square && !PLOT_SURFACES.has(layer.groundClass?.surfaceAt?.(x, z) ?? null)) continue;
    if (!layer._openGround(x, z)) continue;
    if (!square && !(
      fabric.countWithin(x, z, TOWN_REACH_M, TOWN_BUILDINGS_MIN) >= TOWN_BUILDINGS_MIN ||
      (distance + STREET_BLOCK_REACH_M <= radius && streetBlockAt(x, z, (px, pz) => layer._onRoad(px, pz)))
    )) continue;
    seeds.push({ x, z, cell, square });
  }

  // Recentrés dans l'ordre de la maille mondiale, et non de la distance : un
  // point qui tombe dans un vide déjà trouvé y retournerait, on le saute, et
  // ce qui est sauté ne doit pas dépendre de l'observateur.
  seeds.sort((a, b) => a.cell.row - b.cell.row || a.cell.id - b.cell.id);
  const candidates = [];
  for (const { x: sx, z: sz, cell, square } of seeds) {
    if (candidates.some((c) => Math.hypot(c.x - sx, c.z - sz) < c.free)) continue;
    // Le sort de la maille est tiré avant le recentrage : un vide qui ne
    // serait garni qu'en placette ou en recoin, et que ce sort écarte, n'a pas
    // à être recentré — seule une place plus grande l'y ferait garder.
    const draw = randomAt(frame, cell.x, cell.z, 1417);
    const minFree = square || draw < NOOK_SHARE ? NOOK_FREE_M : draw < PLACETTE_SHARE ? PLACETTE_FREE_M : PARK_FREE_M;
    const centre = centreInVoid(sx, sz, blocked, minFree);
    if (!centre) continue;
    const { x, z, free } = centre;
    const distance = Math.hypot(x - here.x, z - here.z);
    if (distance + probeReach > radius) continue;
    if (!pointInAreas(square ? squares : builtUp, x, z)) continue;
    const paved = (layer.groundClass?.surfaceAt?.(x, z) ?? null) === 'pavement';
    const kind = plotKindFor(free, { paved, square });
    if (!kind) continue;
    if (!square && kind === 'placette' && draw >= PLACETTE_SHARE) continue;
    if (!square && kind === 'nook' && draw >= NOOK_SHARE) continue;
    candidates.push({ x, z, free, kind, distance, square });
  }

  // Deux disques libres qui se recoupent sont le même vide : le plus large
  // l'emporte, à égalité le plus à l'ouest puis au nord — rien qui dépende de
  // l'observateur ni de l'ordre des mailles.
  candidates.sort((a, b) => b.free - a.free || a.x - b.x || a.z - b.z);
  const found = [];
  for (const c of candidates) {
    if (found.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < f.free + c.free)) continue;
    found.push(c);
  }
  found.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  // Les recoins ont leur propre plafond : nombreux et proches, ils ne
  // doivent pas évincer les places plus lointaines.
  const nooks = found.filter((p) => p.kind === 'nook').slice(0, FURNITURE_LIMITS.townNooks);
  return [...found.filter((p) => p.kind !== 'nook').slice(0, FURNITURE_LIMITS.townPlots), ...nooks];
}

/**
 * Garnit les vides de l'habitat et les places piétonnes : piazzas, parcs
 * inventés et placettes.
 *
 * @param {Object} layer `FurnitureLayer`.
 * @param {Object} context Contexte de la reconstruction (`placements`, `here`).
 * @param {Array<Array<{x:number,z:number}>>} builtUp Emprises habitées.
 * @param {{rings?:Array, objects?:Array<{x:number,z:number}>}} [squares] Places
 *        piétonnes (`townTrees.buildTownSquares`) et ce qui y est déjà posé.
 * @returns {{piazzas:number, parks:number, placettes:number, nooks:number, trees:number, benches:number, lamps:number, fountains:number, planters:number, pets:number}}
 */
export function buildTownPlots(layer, context, builtUp, squares = {}) {
  const counts = { piazzas: 0, parks: 0, placettes: 0, nooks: 0, trees: 0, benches: 0, lamps: 0, fountains: 0, planters: 0, pets: 0 };
  const { placements, here } = context;
  const { frame } = layer.bubble;
  const plots = findPlots(layer, builtUp, squares.rings ?? [], here, reachedRadius(FURNITURE_RADIUS_M, layer.bubble));
  if (!plots.length) return counts;

  const mix = plantedSpeciesShares(townSpeciesWords(layer.region), layer.theme.trees);
  const fabric = layer._fabric;
  const taken = squares.objects ?? [];
  const clear = (x, z, clearance) =>
    !layer._onRoad(x, z) && !layer._onWater(x, z) && !fabric.covers(x, z, clearance) && layer._openGround(x, z) &&
    !taken.some((o) => Math.abs(o.x - x) < 2 && Math.abs(o.z - z) < 2);
  const plant = (x, z, salt) => {
    if (!mix.length) return null;
    const placed = layer._place(placements, PLANTED_TREE, {
      x,
      z,
      yaw: randomAt(frame, x, z, salt) * Math.PI * 2,
      scale: 0.9 + randomAt(frame, x, z, salt + 1) * 0.6,
    });
    if (placed) {
      placed.species = pickShare(mix, randomAt(frame, x, z, salt + 2));
      counts.trees++;
    }
    return placed;
  };
  const pet = (x, z, ring, odds) => {
    if (counts.pets >= FURNITURE_LIMITS.plotPets) return;
    if (randomAt(frame, x, z, 1451) >= odds) return;
    const kind = randomAt(frame, x, z, 1453) < PLOT_DOG_SHARE ? 'dog' : 'cat';
    const flee = kind === 'cat' && randomAt(frame, x, z, 1457) < PET_FLEE_ODDS;
    counts.pets += placeFauna(layer, kind, { x, z, ring, flee, keepOut: (px, pz) => fabric.covers(px, pz, 0.8) });
  };

  for (const plot of plots) {
    if (plot.kind !== 'piazza') continue;
    const { x: cx, z: cz, free } = plot;
    const turn = randomAt(frame, cx, cz, 1461) * Math.PI * 2;
    const rim = free - PIAZZA_RIM_INSET_M;
    // Repère de la place : `a` le long de son axe, `b` en travers.
    const ux = Math.sin(turn), uz = Math.cos(turn);
    const at = (a, b) => ({ x: cx + ux * a + uz * b, z: cz + uz * a - ux * b });
    const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const standing = [];
    const free2 = (p, gap) => !standing.some((o) => Math.abs(o.x - p.x) < gap && Math.abs(o.z - p.z) < gap);
    const put = (item, p, yaw, clearance = 1) => {
      if (!clear(p.x, p.z, clearance) || !free2(p, 1.6)) return null;
      const placed = layer._place(placements, item, { x: p.x, z: p.z, yaw });
      if (placed) standing.push(placed);
      return placed;
    };
    const bench = (p, yaw) => { if (put('bench', p, yaw, 1.5)) counts.benches++; };
    const planter = (p, yaw = turn) => { if (put('flowerPlanter', p, yaw)) counts.planters++; };
    const tree = (p, salt) => {
      if (!clear(p.x, p.z, 2) || !free2(p, 2.5)) return null;
      const placed = plant(p.x, p.z, salt);
      if (placed) standing.push(placed);
      return placed;
    };
    const lamp = (p, yaw) => {
      const kind = streetLampKindFor({ nearChurch: churchWithin(layer._churches, p.x, p.z, STREET_LAMP_CHURCH_RADIUS_M) });
      const placed = put(kind, p, yaw);
      if (!placed) return;
      const head = lampHeadFor(kind);
      layer._lampHeads.push({ x: placed.x + Math.sin(yaw) * head.reach, y: placed.y + head.height, z: placed.z + Math.cos(yaw) * head.reach });
      counts.lamps++;
    };
    // Le centre : une fontaine sur une place relevée et sur une part des
    // autres, sauf si la donnée en relève déjà une (ou un monument) ; un arbre sinon.
    const centre = () => {
      const hasCentre = CENTREPIECES.some((item) => (placements.get(item) || []).some((p) => Math.hypot(p.x - cx, p.z - cz) < free));
      if (hasCentre || !clear(cx, cz, 2)) return;
      if (plot.square || randomAt(frame, cx, cz, 1465) < PIAZZA_FOUNTAIN_SHARE) {
        const fountain = layer._place(placements, 'fountain', { x: cx, z: cz, yaw: turn });
        if (fountain) { standing.push(fountain); counts.fountains++; }
      } else tree({ x: cx, z: cz }, 1471);
    };
    const rimLamps = () => {
      const slots = Math.min(PIAZZA_LAMPS_MAX, Math.max(3, Math.round((Math.PI * 2 * rim) / PIAZZA_LAMP_ARC_M)));
      for (let k = 0; k < slots; k++) {
        const a = turn + ((k + 0.5) / slots) * Math.PI * 2;
        lamp({ x: cx + Math.sin(a) * rim, z: cz + Math.cos(a) * rim }, a + Math.PI);
      }
    };

    const layout = PIAZZA_LAYOUTS[Math.floor(randomAt(frame, cx, cz, 1475) * PIAZZA_LAYOUTS.length)];
    if (layout === 'ring') {
      // Anneau : bancs tournés vers le centre, bacs entre eux, arbres et lampadaires au pourtour.
      centre();
      const ring = Math.min(PIAZZA_BENCH_RING_M, free * 0.5);
      const slots = Math.max(4, Math.round((Math.PI * 2 * ring) / PIAZZA_BENCH_ARC_M));
      for (let k = 0; k < slots; k++) {
        const a = turn + (k / slots) * Math.PI * 2;
        const p = { x: cx + Math.sin(a) * ring, z: cz + Math.cos(a) * ring };
        const draw = randomAt(frame, p.x, p.z, 1463);
        if (draw < PIAZZA_BENCH_SHARE) bench(p, a + Math.PI);
        else if (draw < PIAZZA_BENCH_SHARE + (1 - PIAZZA_BENCH_SHARE) * PIAZZA_PLANTER_SHARE) planter(p, a);
      }
      rimLamps();
      const trees = Math.round((Math.PI * 2 * rim) / PIAZZA_TREE_ARC_M);
      for (let k = 0; k < trees; k++) {
        const a = turn + (k / trees) * Math.PI * 2;
        const p = { x: cx + Math.sin(a) * rim, z: cz + Math.cos(a) * rim };
        if (randomAt(frame, p.x, p.z, 1467) < PIAZZA_TREE_SHARE) tree(p, 1469);
      }
    } else if (layout === 'mail') {
      // Mail : une allée entre deux rangées d'arbres, bancs tournés vers elle
      // entre les troncs, lampadaires dans les rangées, un bac à chaque bout.
      const half = PIAZZA_MAIL_ALLEY_M / 2;
      const span = rim - 2;
      const steps = Math.floor((2 * span) / PIAZZA_MAIL_STEP_M);
      for (let i = 0; i <= steps; i++) {
        const a = -span + i * PIAZZA_MAIL_STEP_M;
        for (const side of [-1, 1]) {
          const trunk = at(a, side * half);
          if (randomAt(frame, trunk.x, trunk.z, 1477) < PIAZZA_MAIL_TREE_SHARE) tree(trunk, 1479);
          if (i === steps) continue;
          const gap = at(a + PIAZZA_MAIL_STEP_M / 2, side * (half - 1.5));
          if (i % 2 === 1 && side === (i % 4 === 1 ? 1 : -1)) lamp(at(a + PIAZZA_MAIL_STEP_M / 2, side * half), facing(gap, at(a + PIAZZA_MAIL_STEP_M / 2, 0)));
          else if (randomAt(frame, gap.x, gap.z, 1481) < PIAZZA_BENCH_SHARE) bench(gap, facing(gap, at(a + PIAZZA_MAIL_STEP_M / 2, 0)));
        }
      }
      planter(at(rim - 1, 0));
      planter(at(1 - rim, 0));
    } else if (layout === 'quincunx') {
      // Quinconce : des arbres en rangées décalées, le milieu dégagé pour le
      // centre, des bancs au pied d'une part d'entre eux, dos au tronc.
      centre();
      const step = PIAZZA_QUINCUNX_STEP_M;
      const rows = Math.floor((rim - 1) / (step * 0.87));
      let planted = 0;
      for (let j = -rows; j <= rows; j++) {
        const b = j * step * 0.87;
        const shift = (j & 1) * step / 2;
        for (let a = -Math.floor(rim / step) * step + shift; a <= rim; a += step) {
          const d = Math.hypot(a, b);
          if (d > rim - 1 || d < PIAZZA_QUINCUNX_HOLE_M || planted >= PIAZZA_QUINCUNX_TREES_MAX) continue;
          const trunk = at(a, b);
          if (randomAt(frame, trunk.x, trunk.z, 1483) >= PIAZZA_QUINCUNX_TREE_SHARE || !tree(trunk, 1485)) continue;
          planted++;
          if (randomAt(frame, trunk.x, trunk.z, 1487) < PIAZZA_QUINCUNX_BENCH_SHARE) {
            const yaw = facing(trunk, { x: cx, z: cz });
            bench({ x: trunk.x + Math.sin(yaw) * 1.8, z: trunk.z + Math.cos(yaw) * 1.8 }, yaw);
          }
        }
      }
      rimLamps();
    } else {
      // Croix : deux allées qui se croisent au centre, un lampadaire au bout de
      // chacune, un banc de part et d'autre près du centre, un arbre et un bac par quart.
      centre();
      for (let k = 0; k < 4; k++) {
        const a = turn + (k * Math.PI) / 2;
        const sa = Math.sin(a), ca = Math.cos(a);
        const along = (d, side) => ({ x: cx + sa * d + ca * side, z: cz + ca * d - sa * side });
        lamp(along(rim - 1, 2.5), a + Math.PI);
        const seat = along(PIAZZA_CROSS_BENCH_M, -2.5);
        bench(seat, facing(seat, along(PIAZZA_CROSS_BENCH_M, 0)));
        const q = a + Math.PI / 4;
        const sq = Math.sin(q), cq = Math.cos(q);
        tree({ x: cx + sq * rim * 0.6, z: cz + cq * rim * 0.6 }, 1489);
        if (rim >= 2 * PIAZZA_CROSS_BENCH_M) tree({ x: cx + sq * (rim - 1), z: cz + cq * (rim - 1) }, 1491);
        planter({ x: cx + sq * rim * 0.32, z: cz + cq * rim * 0.32 }, q);
      }
    }
    pet(cx, cz, octagon(cx, cz, rim), PLACETTE_PET_ODDS);
    counts.piazzas++;
  }

  // Les arbres d'un parc sont tirés sur une maille commune à tous les parcs :
  // deux disques voisins qui se recouvrent ne plantent pas deux fois la même maille.
  const parkCells = new Set();
  for (const plot of plots) {
    if (plot.kind === 'park') {
      const radius = plot.free - 4;
      const rule = INVENTED_PARK_TREES;
      for (const cell of worldCellsIn(frame, plot.x - radius, plot.z - radius, plot.x + radius, plot.z + radius, rule.cellM)) {
        const key = `${cell.id}:${cell.row}`;
        if (parkCells.has(key)) continue;
        const x = cell.x + randomAt(frame, cell.x, cell.z, rule.salt + 3) * cell.size;
        const z = cell.z + randomAt(frame, cell.x, cell.z, rule.salt + 5) * cell.size;
        if (Math.hypot(x - plot.x, z - plot.z) > radius) continue;
        parkCells.add(key);
        if (!clear(x, z, rule.clearanceM)) continue;
        const draw = randomAt(frame, cell.x, cell.z, rule.salt);
        if (draw < rule.share) plant(x, z, rule.salt + 10);
        else if (draw < rule.share + PARK_BUSH_SHARE) {
          layer._place(placements, 'bush', { x, z, yaw: draw * 40, scale: 0.7 + randomAt(frame, x, z, rule.salt + 7) * 0.5 });
        } else if (draw < rule.share + PARK_BUSH_SHARE + PARK_PLANTER_SHARE) {
          if (layer._place(placements, 'flowerPlanter', { x, z, yaw: draw * 40 })) counts.planters++;
        }
      }

      // Bancs sur un anneau à mi-rayon, tournés vers le milieu du parc.
      const ringRadius = radius * 0.55;
      const slots = Math.max(3, Math.round((Math.PI * 2 * ringRadius) / PARK_BENCH_ARC_M));
      const turn = randomAt(frame, plot.x, plot.z, 1431) * Math.PI * 2;
      for (let k = 0; k < slots; k++) {
        const a = turn + (k / slots) * Math.PI * 2;
        const x = plot.x + Math.sin(a) * ringRadius;
        const z = plot.z + Math.cos(a) * ringRadius;
        if (randomAt(frame, x, z, 1433) >= PARK_BENCH_SHARE || !clear(x, z, 1.5)) continue;
        if (layer._place(placements, 'bench', { x, z, yaw: a + Math.PI })) counts.benches++;
      }
      pet(plot.x, plot.z, octagon(plot.x, plot.z, radius), PARK_PET_ODDS);
      counts.parks++;
    }
  }

  for (const plot of plots) {
    if (plot.kind !== 'placette') continue;
    // Placette : l'arbre au milieu, les bancs dos au tronc, un bac un peu plus loin.
    if (!clear(plot.x, plot.z, 3)) continue;
    if (!plant(plot.x, plot.z, 1441)) continue;
    const turn = randomAt(frame, plot.x, plot.z, 1443) * Math.PI * 2;
    const benches = randomAt(frame, plot.x, plot.z, 1445) < 0.5 ? 1 : 2;
    for (let k = 0; k < benches; k++) {
      const a = turn + k * Math.PI;
      const x = plot.x + Math.sin(a) * PLACETTE_BENCH_OFFSET_M;
      const z = plot.z + Math.cos(a) * PLACETTE_BENCH_OFFSET_M;
      if (clear(x, z, 1) && layer._place(placements, 'bench', { x, z, yaw: a })) counts.benches++;
    }
    const b = turn + Math.PI / 2;
    const px = plot.x + Math.sin(b) * PLACETTE_PLANTER_OFFSET_M;
    const pz = plot.z + Math.cos(b) * PLACETTE_PLANTER_OFFSET_M;
    if (clear(px, pz, 1) && layer._place(placements, 'flowerPlanter', { x: px, z: pz, yaw: b })) counts.planters++;
    pet(plot.x, plot.z, octagon(plot.x, plot.z, plot.free - 2), PLACETTE_PET_ODDS);
    counts.placettes++;
  }

  for (const plot of plots) {
    if (plot.kind !== 'nook') continue;
    const { x, z } = plot;
    if (!clear(x, z, 1) || !layer._place(placements, 'flowerPlanter', { x, z, yaw: randomAt(frame, x, z, 1481) * Math.PI })) continue;
    counts.planters++;
    const a = randomAt(frame, x, z, 1483) * Math.PI * 2;
    const bx = x + Math.sin(a) * NOOK_BENCH_OFFSET_M;
    const bz = z + Math.cos(a) * NOOK_BENCH_OFFSET_M;
    // Le banc tourne le dos au bac, comme celui d'une placette au tronc.
    if (clear(bx, bz, 1) && layer._place(placements, 'bench', { x: bx, z: bz, yaw: a })) counts.benches++;
    counts.nooks++;
  }
  return counts;
}
