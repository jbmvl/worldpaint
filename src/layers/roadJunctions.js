/*
 * roadJunctions — un carrefour est une **surface**, pas un point.
 *
 * ## Ce qui se passait avant
 *
 * Le graphe savait depuis toujours où sont les carrefours (`collectJunctions`,
 * un nœud de degré trois), mais il n'en tirait qu'un rayon de coupe : la voie
 * la plus étroite s'arrêtait sur un **cercle** centré sur le nœud, cinquante
 * centimètres en deçà de la rive de la plus large, et rentrait donc sous elle.
 * La surface du carrefour n'était construite nulle part : c'était le
 * recouvrement de deux rubans, départagé par deux centimètres de décollement
 * et un ordre de dessin.
 *
 * Trois défauts en découlaient directement, et aucun n'était corrigeable là où
 * il se voyait :
 *
 *   - deux voies de **même largeur** ne se rognaient pas du tout (il n'y avait
 *     pas de dominante), donc leurs deux rubans se superposaient entièrement ;
 *   - un cercle coupe une rive courbe en deux points différents : l'extrémité
 *     du ruban étroit était une arête droite en travers d'une rive oblique,
 *     d'où les pointes et les triangles ;
 *   - il n'y avait aucun raccord d'angle. Une branche arrivant à vingt degrés
 *     produisait un coin en lame de couteau.
 *
 * ## Ce que fait ce module
 *
 * Il construit, en plan, le **contour** de la chaussée d'un carrefour à partir
 * des branches qui y participent — leur direction sortante et leur
 * demi-largeur, que le graphe publie déjà. Rien n'y est propre à trois ou
 * quatre branches : la construction est la même à N branches, quels que soient
 * les angles.
 *
 *   1. les branches sont triées par azimut ;
 *   2. deux branches voisines donnent un **coin** : l'intersection de la rive
 *      droite de l'une et de la rive gauche de l'autre ;
 *   3. ce coin est **raccordé par un arc** — le rayon de bordure d'un vrai
 *      carrefour. Un coin franc entre deux rives est une faute de géométrie
 *      routière, pas une approximation ;
 *   4. chaque branche pose sa **bouche** au-delà de ses deux coins : la section
 *      en travers où son ruban reprend. C'est là que la chaussée s'arrête, et
 *      c'est vrai de **toutes** les branches, la plus large comprise.
 *
 * Le contour est donc : bouche, arc, bouche, arc… en tournant. Il est fermé,
 * convexe par construction en dehors des arcs, et il n'y a plus un seul ruban
 * qui en recouvre un autre.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne coupe pas les chaînes. La chaussée **continue** de traverser le
 * carrefour dans les données — c'est son ruban seul qui s'arrête à la bouche,
 * exactement comme le ruban saute un tunnel alors que la route continue sous
 * la colline (`roadWorks.drawableRuns`). C'est ce qui fait que l'emprise, le
 * déblai du terrain, la couture des plate-formes, l'espacement du mobilier et
 * les trottoirs continuent de lire une route entière : le carrefour ajoute une
 * surface, il ne perce pas de trou dans le réseau.
 *
 * Il ne connaît pas non plus l'altitude : tout est en plan. Le carrefour prend
 * la cote de la chaussée qui y passe, une fois les plate-formes dressées et
 * cousues — c'est-à-dire bien plus tard.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

import { LEVEL_GROUND } from './roadWorks.js';

/**
 * Rayon de raccordement d'un coin, en part de la plus étroite des deux
 * demi-largeurs qui s'y rejoignent. Cote de tracé routier, pas de goût — c'est
 * le rayon qu'impose le braquage d'un véhicule, comme `BRIDGE_CLEARANCE_M` est
 * le gabarit qu'impose un camion : elle reste dans le moteur.
 */
export const JUNCTION_CORNER_RATIO = 1.2;
/** Bornes de ce rayon, en mètres. */
export const JUNCTION_CORNER_MIN_M = 1.2;
export const JUNCTION_CORNER_MAX_M = 7;

/** Sommets d'un arc de raccordement. Quatre suffisent à ne plus lire un coin. */
export const JUNCTION_ARC_STEPS = 4;

/**
 * Recul de la bouche au-delà du dernier point de tangence, en mètres. Sans lui
 * la bouche passerait pile par la tangente, et le ruban repartirait sur une
 * section que l'arc touche déjà.
 */
export const JUNCTION_MOUTH_MARGIN_M = 0.4;

/**
 * Débord maximal d'un coin, en largeurs cumulées des deux branches.
 *
 * Deux branches presque parallèles ont un coin à l'infini : leurs rives ne se
 * rencontrent qu'à `(wa + wb) / sin(angle)`. Cette borne dit donc deux choses
 * à la fois, et c'est délibéré — elle est aussi **le seuil au-delà duquel deux
 * branches n'en sont plus qu'une** (`sin(angle) < 1 / REACH`, soit une
 * vingtaine de degrés). En deçà, il n'y a pas de coin à construire parce qu'il
 * n'y a pas d'angle de rue : une voie qui repart dans la même direction est
 * une bouche de plus sur la même façade, pas une branche de plus autour du
 * carrefour. Les fusionner est la seule façon d'éviter un contour qui se
 * replie sur lui-même — et de ne pas avoir deux constantes qui disent la même
 * chose sans le dire.
 */
export const JUNCTION_CORNER_REACH = 3;

/** Angle au-delà duquel deux rives sont dans le prolongement l'une de l'autre. */
const STRAIGHT_COS = Math.cos((172 * Math.PI) / 180);

/** Côté d'une cellule de l'index des carrefours, en mètres. */
export const JUNCTION_CELL_M = 24;

/** Décalage de cellule : les coordonnées locales sont signées. */
const CELL_BIAS = 1 << 14;

/** Clé numérique d'une cellule. Fonction pure. */
function cellKey(cx, cz) {
  return (cx + CELL_BIAS) * 32768 + (cz + CELL_BIAS);
}

/**
 * Intersection de deux droites `(a, da)` et `(b, db)`, ou `null` si elles sont
 * parallèles. Rend aussi les abscisses sur chacune, dont on a besoin pour
 * savoir jusqu'où reculer la bouche.
 */
function intersectLines(ax, az, dax, daz, bx, bz, dbx, dbz) {
  const cross = dax * dbz - daz * dbx;
  if (Math.abs(cross) < 1e-9) return null;
  const ta = ((bx - ax) * dbz - (bz - az) * dbx) / cross;
  const tb = ((bx - ax) * daz - (bz - az) * dax) / cross;
  return { x: ax + dax * ta, z: az + daz * ta, ta, tb };
}

/**
 * Le coin entre deux branches voisines, et son arc de raccordement.
 *
 * Le coin est l'intersection de la rive **droite** de la première et de la
 * rive **gauche** de la seconde (les deux qui se font face dans le secteur
 * qui les sépare). L'arc y est inscrit : tangent aux deux rives, il bombe vers
 * le secteur, ce qui **ajoute** de la chaussée dans l'angle — c'est bien le
 * sens d'un rayon de bordure, qui élargit le tourne-à-droite au lieu de le
 * rogner.
 *
 * @param {{x:number,z:number}} node Le nœud du carrefour.
 * @param {{x:number,z:number,halfWidth:number}} a Branche, direction sortante unitaire.
 * @param {{x:number,z:number,halfWidth:number}} b Branche suivante en azimut.
 * @param {Object} [options]
 * @returns {{points:Array<{x:number,z:number}>, ta:number, tb:number}|null}
 *          sommets de l'arc dans le sens `a → b`, et l'abscisse le long de
 *          chaque branche au-delà de laquelle sa bouche doit se poser.
 */
export function junctionCorner(node, a, b, { steps = JUNCTION_ARC_STEPS } = {}) {
  // Perpendiculaire gauche de la marche, convention de `pathFrames`.
  const pa = { x: a.z, z: -a.x };
  const pb = { x: b.z, z: -b.x };

  // Rive droite de `a` (côté du secteur), rive gauche de `b`.
  const a0 = { x: node.x - pa.x * a.halfWidth, z: node.z - pa.z * a.halfWidth };
  const b0 = { x: node.x + pb.x * b.halfWidth, z: node.z + pb.z * b.halfWidth };

  const hit = intersectLines(a0.x, a0.z, a.x, a.z, b0.x, b0.z, b.x, b.z);
  const reach = (a.halfWidth + b.halfWidth) * JUNCTION_CORNER_REACH;

  // Rives parallèles : les deux branches se prolongent (une route droite qu'une
  // troisième aborde). La rive continue tout droit, et il n'y a pas de coin.
  if (!hit || !Number.isFinite(hit.ta) || Math.abs(hit.ta) > reach || Math.abs(hit.tb) > reach) {
    const mid = { x: (a0.x + b0.x) / 2, z: (a0.z + b0.z) / 2 };
    return { points: [mid], ta: 0, tb: 0 };
  }

  const corner = { x: hit.x, z: hit.z };
  const cos = a.x * b.x + a.z * b.z;

  // Deux branches opposées : la rive est droite, un arc n'y a rien à faire.
  if (cos <= STRAIGHT_COS) return { points: [corner], ta: hit.ta, tb: hit.tb };

  const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
  const half = angle / 2;
  const radius = Math.min(
    JUNCTION_CORNER_MAX_M,
    Math.max(JUNCTION_CORNER_MIN_M, Math.min(a.halfWidth, b.halfWidth) * JUNCTION_CORNER_RATIO)
  );

  const tangent = radius / Math.tan(half);
  const sin = Math.sin(half);
  // Bissectrice des deux directions sortantes : le centre de l'arc est dessus.
  let bx = a.x + b.x;
  let bz = a.z + b.z;
  const length = Math.hypot(bx, bz);
  if (!(length > 1e-9) || !Number.isFinite(tangent) || tangent > reach) {
    return { points: [corner], ta: hit.ta, tb: hit.tb };
  }
  bx /= length;
  bz /= length;

  const centre = { x: corner.x + (bx * radius) / sin, z: corner.z + (bz * radius) / sin };
  const from = { x: corner.x + a.x * tangent, z: corner.z + a.z * tangent };
  const to = { x: corner.x + b.x * tangent, z: corner.z + b.z * tangent };

  const startAngle = Math.atan2(from.z - centre.z, from.x - centre.x);
  let sweep = Math.atan2(to.z - centre.z, to.x - centre.x) - startAngle;
  // Le petit arc : entre deux tangentes, c'est toujours celui-là.
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const at = startAngle + (sweep * i) / steps;
    points.push({ x: centre.x + Math.cos(at) * radius, z: centre.z + Math.sin(at) * radius });
  }

  // La bouche doit se poser au-delà du point de tangence, pas du coin.
  return { points, ta: hit.ta + tangent, tb: hit.tb + tangent };
}

/**
 * Construit l'aire d'un carrefour : le contour de sa chaussée, et la bouche de
 * chaque branche.
 *
 * @param {Object} junction Carrefour publié par `mergeRoadLines`.
 * @param {Object} [options]
 * @returns {{x:number, z:number, level:number, profile:string, halfWidth:number,
 *          outline:Array<{x:number,z:number}>, mouths:Array<Object>,
 *          radius:number}|null} `null` si le carrefour n'a pas de quoi en faire
 *          une surface (moins de trois branches utilisables).
 */
export function junctionArea(junction, options = {}) {
  const { margin = JUNCTION_MOUTH_MARGIN_M } = options;
  const raw = junction?.branches;
  if (!Array.isArray(raw) || raw.length < 3) return null;

  // Triées par azimut : c'est ce qui rend « la branche suivante » bien définie,
  // et donc la construction indépendante du nombre de branches.
  const branches = mergeParallelBranches(
    raw
      .filter((b) => Number.isFinite(b?.x) && Number.isFinite(b?.z) && b.halfWidth > 0)
      .map((b) => ({ ...b, angle: Math.atan2(b.z, b.x) }))
      .sort((a, b) => a.angle - b.angle)
  );
  // Moins de trois bouches : ce n'est pas un carrefour mais un embranchement
  // rasant, où deux voies repartent ensemble. Il n'y a pas de surface à
  // construire, et prétendre le contraire poserait un polygone replié.
  if (branches.length < 3) return null;

  const node = { x: junction.x, z: junction.z };
  const count = branches.length;
  const corners = new Array(count);
  const reach = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const corner = junctionCorner(node, branches[i], branches[next], options);
    corners[i] = corner;
    if (corner.ta > reach[i]) reach[i] = corner.ta;
    if (corner.tb > reach[next]) reach[next] = corner.tb;
  }

  const outline = [];
  const mouths = [];

  for (let i = 0; i < count; i++) {
    const branch = branches[i];
    // La bouche se pose au-delà du plus lointain de ses deux raccords : c'est
    // la seule façon qu'elle ne coupe aucun des deux.
    const t = Math.max(reach[i], branch.halfWidth * 0.5) + margin;
    const p = { x: branch.z, z: -branch.x };
    const centre = { x: node.x + branch.x * t, z: node.z + branch.z * t };
    const left = { x: centre.x + p.x * branch.halfWidth, z: centre.z + p.z * branch.halfWidth };
    const right = { x: centre.x - p.x * branch.halfWidth, z: centre.z - p.z * branch.halfWidth };

    // Le contour entre par la rive gauche de la branche et ressort par la
    // droite : c'est le sens dans lequel le tri par azimut le fait tourner.
    outline.push(left, right);
    // Puis l'arc qui la relie à la suivante.
    for (const point of corners[i].points) outline.push(point);

    mouths.push({
      profile: branch.profile,
      halfWidth: branch.halfWidth,
      direction: { x: branch.x, z: branch.z },
      distance: t,
      centre,
      left,
      right,
    });
  }

  let radius = 0;
  for (const point of outline) {
    radius = Math.max(radius, Math.hypot(point.x - node.x, point.z - node.z));
  }

  return {
    x: junction.x,
    z: junction.z,
    level: junction.level ?? LEVEL_GROUND,
    profile: junction.profile,
    halfWidth: junction.halfWidth,
    degree: junction.degree,
    outline,
    mouths,
    radius,
  };
}

/**
 * Fond les branches voisines qui repartent dans la même direction.
 *
 * Le critère est celui du débord d'un coin (`JUNCTION_CORNER_REACH`), lu à
 * l'envers : deux rives qui ne se rencontrent qu'au-delà de la portée admise
 * ne se rencontrent pas du tout, donc il n'y a pas d'angle de rue entre elles.
 * La branche fondue garde la plus grande demi-largeur (elle doit couvrir les
 * deux) et la direction de la plus large (c'est elle qui commande l'axe).
 *
 * Deux branches **opposées** ne fondent jamais : leur produit scalaire est
 * négatif. C'est une route droite qu'une troisième aborde, et sa rive doit
 * rester droite d'un bout à l'autre du carrefour.
 *
 * @param {Array<Object>} sorted Branches triées par azimut.
 * @returns {Array<Object>}
 */
export function mergeParallelBranches(sorted, reach = JUNCTION_CORNER_REACH) {
  if (!Array.isArray(sorted) || sorted.length < 2) return sorted || [];
  const limit = 1 / Math.max(reach, 1e-6);

  let branches = sorted;
  for (let guard = 0; guard < sorted.length; guard++) {
    let merged = null;
    for (let i = 0; i < branches.length; i++) {
      const a = branches[i];
      const b = branches[(i + 1) % branches.length];
      if (a === b) continue;
      const dot = a.x * b.x + a.z * b.z;
      if (dot <= 0) continue; // opposées : une route droite, pas deux branches
      if (Math.abs(a.x * b.z - a.z * b.x) >= limit) continue;

      const wide = a.halfWidth >= b.halfWidth ? a : b;
      const fused = { ...wide, halfWidth: Math.max(a.halfWidth, b.halfWidth) };
      merged = branches.filter((branch) => branch !== a && branch !== b);
      // Réinséré à sa place dans l'ordre des azimuts.
      merged.push(fused);
      merged.sort((p, q) => p.angle - q.angle);
      break;
    }
    if (!merged) break;
    branches = merged;
  }

  return branches;
}

/**
 * Vrai si un point est dans un contour. Lancer de rayon, la méthode habituelle :
 * le contour peut être concave dès qu'un arc y entre.
 *
 * @param {Array<{x:number,z:number}>} outline
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function pointInOutline(outline, x, z) {
  if (!Array.isArray(outline) || outline.length < 3) return false;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a.z > z) === (b.z > z)) continue;
    if (x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Les aires des carrefours, avec un index de cellules pour ne pas les
 * comparer toutes à chaque ligne de chaque tronçon.
 *
 * Une aire est inscrite dans toutes les cellules que couvre son disque
 * circonscrit : une interrogation ne lit qu'une cellule.
 */
export class JunctionAreas {
  /**
   * @param {Array<Object>} junctions Carrefours publiés par `mergeRoadLines`.
   * @param {Object} [options]
   */
  constructor(junctions = [], options = {}) {
    const { cell = JUNCTION_CELL_M } = options;
    this.cell = cell;
    /** @type {Array<Object>} */
    this.areas = [];
    /** @type {Map<number, number[]>} */
    this.buckets = new Map();

    for (const junction of junctions) {
      const area = junctionArea(junction, options);
      if (!area) continue;
      const index = this.areas.length;
      this.areas.push(area);

      const minX = Math.floor((area.x - area.radius) / cell);
      const maxX = Math.floor((area.x + area.radius) / cell);
      const minZ = Math.floor((area.z - area.radius) / cell);
      const maxZ = Math.floor((area.z + area.radius) / cell);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const key = cellKey(cx, cz);
          const bucket = this.buckets.get(key);
          if (bucket) bucket.push(index);
          else this.buckets.set(key, [index]);
        }
      }
    }
  }

  get length() {
    return this.areas.length;
  }

  /**
   * Rang de l'aire qui couvre ce point **à ce niveau**, ou `-1`. Le niveau
   * compte autant que la position : une chaussée qui passe au-dessus d'un
   * carrefour n'y entre pas.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} [level]
   * @returns {number}
   */
  indexAt(x, z, level = LEVEL_GROUND) {
    const bucket = this.buckets.get(cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!bucket) return -1;
    for (const index of bucket) {
      const area = this.areas[index];
      if (area.level !== level) continue;
      if (pointInOutline(area.outline, x, z)) return index;
    }
    return -1;
  }

  /** Vrai si un point tombe dans un carrefour de ce niveau. */
  covers(x, z, level = LEVEL_GROUND) {
    return this.indexAt(x, z, level) >= 0;
  }
}

/** Pas de dichotomie pour poser un sommet sur le contour (≈ 1 mm sur 5 m). */
export const JUNCTION_BISECT_STEPS = 12;

/**
 * Marque, ligne par ligne, le carrefour dans lequel un tronçon entre.
 *
 * Le niveau est lu ligne par ligne : une bretelle qui survole un carrefour le
 * traverse en plan sans y entrer, et son ruban ne doit pas s'y interrompre.
 *
 * @param {Object} segment  Tronçon (`path`, `levels`).
 * @param {JunctionAreas} areas
 * @returns {Int32Array} rang de l'aire par ligne, `-1` hors carrefour.
 */
export function markJunctionRows(segment, areas) {
  const rows = segment?.path?.length ?? 0;
  const out = new Int32Array(rows).fill(-1);
  if (!areas || areas.length === 0) return out;

  for (let r = 0; r < rows; r++) {
    const level = segment.levels?.[r] ?? LEVEL_GROUND;
    out[r] = areas.indexAt(segment.path[r].x, segment.path[r].z, level);
  }
  return out;
}

/** Point interpolé entre deux lignes, distances et plate-forme comprises. */
function between(path, platform, a, b, t) {
  return {
    point: {
      x: path[a].x + (path[b].x - path[a].x) * t,
      z: path[a].z + (path[b].z - path[a].z) * t,
      distance: path[a].distance + (path[b].distance - path[a].distance) * t,
    },
    deck: platform[a] + (platform[b] - platform[a]) * t,
  };
}

/**
 * Sommet posé exactement sur le contour d'un carrefour, entre une ligne gardée
 * (`keep`, dehors) et une ligne écartée (`drop`, dedans).
 *
 * Sans lui, le ruban s'arrêterait à la dernière ligne de ré-échantillonnage
 * hors du carrefour, c'est-à-dire jusqu'à cinq mètres trop tôt : un trou, ou —
 * si on gardait la ligne suivante — un ruban qui déborde sur la surface du
 * carrefour. C'est exactement la dichotomie que faisait l'ancien rognage, mais
 * contre le contour réel plutôt que contre un cercle.
 */
function boundaryTowards(path, platform, keep, drop, outline, steps) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const x = path[keep].x + (path[drop].x - path[keep].x) * mid;
    const z = path[keep].z + (path[drop].z - path[keep].z) * mid;
    if (pointInOutline(outline, x, z)) hi = mid;
    else lo = mid;
  }
  return between(path, platform, keep, drop, (lo + hi) / 2);
}

/**
 * Les morceaux de ruban qu'un tronçon doit dessiner, carrefours retirés.
 *
 * Prend les plages déjà dessinables (`roadWorks.drawableRuns` : tout sauf les
 * tunnels) et en retire les lignes prises par un carrefour, en posant les deux
 * extrémités **exactement sur son contour**. La chaussée s'arrête donc pile à
 * la bouche, et la surface du carrefour reprend sans recouvrement ni fente.
 *
 * @param {Object} segment Tronçon, avec `junction` (voir `markJunctionRows`).
 * @param {JunctionAreas} areas
 * @param {Array<{from:number,to:number}>} runs Plages dessinables.
 * @param {Object} [options]
 * @returns {Array<{path:Array<{x:number,z:number,distance:number}>, platform:Float32Array}>}
 */
export function junctionRibbonRuns(segment, areas, runs, { steps = JUNCTION_BISECT_STEPS } = {}) {
  const { path, platform } = segment;
  const junction = segment.junction;
  const out = [];
  if (!path || !platform) return out;

  const outlineAt = (r) => {
    const index = junction ? junction[r] : -1;
    return index >= 0 ? areas.areas[index].outline : null;
  };

  const emit = (from, to) => {
    const points = [];
    const decks = [];

    // Entrée : si la ligne précédente est dans un carrefour, on part de son bord.
    const before = from > 0 ? outlineAt(from - 1) : null;
    if (before) {
      const edge = boundaryTowards(path, platform, from, from - 1, before, steps);
      points.push(edge.point);
      decks.push(edge.deck);
    }

    for (let r = from; r <= to; r++) {
      points.push(path[r]);
      decks.push(platform[r]);
    }

    const after = to < path.length - 1 ? outlineAt(to + 1) : null;
    if (after) {
      const edge = boundaryTowards(path, platform, to, to + 1, after, steps);
      points.push(edge.point);
      decks.push(edge.deck);
    }

    if (points.length < 2) return;
    out.push({ path: points, platform: Float32Array.from(decks) });
  };

  for (const run of runs || []) {
    let start = -1;
    for (let r = run.from; r <= run.to + 1; r++) {
      const free = r <= run.to && (!junction || junction[r] < 0);
      if (free && start < 0) start = r;
      else if (!free && start >= 0) {
        emit(start, r - 1);
        start = -1;
      }
    }
  }

  return out;
}

/**
 * Triangule le contour d'un carrefour en éventail depuis son nœud.
 *
 * L'éventail suffit et n'a pas besoin d'être défendu par une triangulation
 * générale : le contour est étoilé vu du nœud par construction — chaque bouche
 * lui fait face, et les arcs bombent vers l'extérieur.
 *
 * @param {Object} area   Aire rendue par `junctionArea`.
 * @param {number} deck   Altitude de la chaussée du carrefour.
 * @param {Object} [options]
 * @returns {{positions:number[], uvs:number[], indices:number[]}|null}
 */
export function junctionSurface(area, deck, { textureLength = 12, base = 0 } = {}) {
  const outline = area?.outline;
  if (!Array.isArray(outline) || outline.length < 3 || !Number.isFinite(deck)) return null;

  const positions = [area.x, deck, area.z];
  // UV pris au sol : le carrefour n'a ni sens de marche ni largeur, donc pas
  // d'axe le long duquel dérouler une texture. Le grain suffit, et deux
  // carrefours voisins n'y tombent pas au même endroit.
  const uvs = [area.x / textureLength, area.z / textureLength];
  const indices = [];

  for (const point of outline) {
    positions.push(point.x, deck, point.z);
    uvs.push(point.x / textureLength, point.z / textureLength);
  }

  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    indices.push(base, base + 1 + next, base + 1 + i);
  }

  return { positions, uvs, indices };
}
