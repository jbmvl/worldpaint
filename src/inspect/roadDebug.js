/*
 * roadDebug — voir le réseau routier tel que le moteur le comprend, et non
 * tel qu'il le dessine.
 *
 * La question à laquelle ce module existe pour répondre est toujours la même :
 * **pourquoi ces deux voies ont-elles été raccordées, ou pas ?** Elle ne se
 * répond pas en regardant la chaussée finie — un ruban qui en recouvre un
 * autre et un ruban cousu au suivant ont exactement la même allure vue du
 * dessus. Il faut voir la couche d'en dessous : les axes, les nœuds
 * d'ancrage, les carrefours relevés sur le graphe, les branches qui y
 * arrivent, les niveaux de croisement, les plages d'ouvrage, les lignes que
 * la couture d'altitude a retouchées.
 *
 * ## Pur, comme le reste de `inspect/`
 *
 * Rien ici ne connaît `three` ni la scène : le module rend des **paires de
 * points colorées**, en mètres du repère local, et c'est l'application qui en
 * fait un `LineSegments` (voir `demo/main.js`). Même partage que
 * `objectLabels`, pour la même raison — la mise au point n'est pas une couche
 * du décor, et le moteur n'a pas à porter de matière qui ne sert qu'à la
 * regarder.
 *
 * ## Les groupes, et pourquoi ils sont séparés
 *
 * Tout afficher d'un coup ne se lit pas. Chaque famille est un groupe nommé,
 * que l'application allume seule ou avec d'autres :
 *
 *   - `axis`      l'axe de chaque tronçon, teinté par niveau de croisement ;
 *   - `edges`     ses deux rives — le contour de ce qui sera dessiné ;
 *   - `anchors`   les nœuds d'ancrage (carrefour, cul-de-sac, changement de
 *                 classe) : les points qui ne bougent pas d'une reconstruction
 *                 à l'autre, et depuis lesquels tout se compte ;
 *   - `junctions` les carrefours du graphe, à leur rayon dominant ;
 *   - `branches`  une flèche par branche sortante, ce qui rend visible d'un
 *                 coup d'œil un carrefour à qui il manque une branche ;
 *   - `works`     les plages de pont et de tunnel ;
 *   - `stitch`    les lignes dont la couture d'altitude a repris la
 *                 plate-forme, et de combien ;
 *   - `outlines`  le contour de la chaussée de chaque carrefour, tel que
 *                 `roadJunctions` le construit — c'est-à-dire exactement là où
 *                 chaque ruban s'arrête et où la surface commune prend le
 *                 relais ;
 *   - `bundles`   les vides de faisceau : un trait en travers, d'une rive à
 *                 l'autre, partout où deux voies sont jugées se **longer**
 *                 (`roadBundles`). C'est la seule façon de voir pourquoi deux
 *                 voies proches ont été groupées et deux autres non — six
 *                 conditions y entrent, et aucune ne se lit sur la géométrie
 *                 finie.
 *
 * Un croisement en XY sans rencontre (un passage supérieur) se lit alors
 * immédiatement : deux axes de couleurs différentes se coupent, et il n'y a
 * pas de marqueur de carrefour à leur intersection.
 */

import { WORK_BRIDGE, WORK_TUNNEL, LEVEL_GROUND } from '../layers/roadWorks.js';
import { collectRoadGaps } from '../layers/roadBundles.js';

/** Décollement des traits au-dessus de la plate-forme, en mètres (au-dessus du mobilier bas). */
export const ROAD_DEBUG_LIFT_M = 0.35;

/** Portée par défaut autour de l'observateur, en mètres. */
export const ROAD_DEBUG_RADIUS_M = 400;

/** Longueur d'une flèche de branche, en mètres. */
export const ROAD_DEBUG_BRANCH_M = 9;

/** Demi-côté d'une croix de nœud, en mètres. */
export const ROAD_DEBUG_NODE_M = 1.1;

/** Côtés du cercle qui matérialise un carrefour (assez pour lire un rayon). */
export const ROAD_DEBUG_CIRCLE_SIDES = 16;

/** Les groupes que ce module sait produire, dans l'ordre où ils se lisent. */
export const ROAD_DEBUG_KINDS = [
  'axis',
  'edges',
  'anchors',
  'junctions',
  'branches',
  'outlines',
  'bundles',
  'works',
  'stitch',
];

/** Couleurs des groupes, RVB linéaire dans [0, 1]. */
export const ROAD_DEBUG_COLORS = {
  axis: [0.35, 0.85, 1],
  edges: [0.16, 0.42, 0.55],
  anchors: [1, 0.86, 0.2],
  junctions: [1, 0.35, 0.45],
  branches: [1, 0.55, 0.2],
  outlines: [0.3, 1, 0.7],
  bundles: [1, 1, 0.35],
  bridge: [0.55, 1, 0.5],
  tunnel: [0.7, 0.45, 1],
  stitch: [1, 0.25, 0.9],
};

/**
 * Teinte d'un axe selon son niveau de croisement. Le sol garde la couleur de
 * base ; ce qui passe au-dessus se réchauffe, ce qui passe en dessous se
 * refroidit. C'est la seule façon de voir *sans cliquer* que deux tracés qui
 * se coupent ne sont pas au même étage.
 *
 * @param {number} level
 * @returns {number[]} RVB linéaire.
 */
export function levelTint(level = LEVEL_GROUND) {
  const base = ROAD_DEBUG_COLORS.axis;
  if (!level) return base;
  const t = Math.min(1, Math.abs(level) / 3);
  const target = level > 0 ? [1, 0.75, 0.25] : [0.35, 0.3, 0.75];
  return base.map((c, i) => c + (target[i] - c) * (0.35 + 0.65 * t));
}

/** Accumulateur d'un groupe de traits. */
function createGroup(kind) {
  return { kind, positions: [], colors: [] };
}

/** Ajoute un trait de `a` à `b`, à la couleur donnée. */
function pushLine(group, ax, ay, az, bx, by, bz, color) {
  group.positions.push(ax, ay, az, bx, by, bz);
  group.colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
}

/** Perpendiculaire gauche de la marche à la ligne `r`. Convention de `pathFrames`. */
function perpendicularAt(path, r) {
  const prev = path[Math.max(0, r - 1)];
  const next = path[Math.min(path.length - 1, r + 1)];
  const tx = next.x - prev.x;
  const tz = next.z - prev.z;
  const length = Math.hypot(tx, tz) || 1;
  return { px: tz / length, pz: -tx / length };
}

/**
 * Relève le réseau routier sous forme de traits, prêts à être versés dans une
 * géométrie de lignes.
 *
 * @param {Array<Object>} segments Tronçons publiés par `RoadNetwork.roadSegments`.
 * @param {Array<Object>} junctions Carrefours publiés par `RoadNetwork.junctions`.
 * @param {Object} [options]
 * @param {{x:number,z:number}|null} [options.here] Position de l'observateur ;
 *        sans elle, tout est relevé.
 * @param {number} [options.radius] Portée autour d'elle, en mètres.
 * @param {Object|null} [options.roadIndex] `RoadIndex` des chaussées : un
 *        carrefour n'a pas d'altitude à lui, elle se lit sur la chaussée qui y
 *        passe. Absent, les marqueurs de carrefour se posent à zéro.
 * @param {Object|null} [options.areas] `JunctionAreas` publiées par le réseau :
 *        sans elles, le contour des carrefours n'est pas tracé.
 * @param {number} [options.lift]
 * @param {Array<string>} [options.kinds] Groupes voulus.
 * @returns {{groups: Array<{kind:string, positions:number[], colors:number[]}>,
 *          counts: {segments:number, junctions:number, stitched:number,
 *          works:number, bundles:number, levels:number[]}}}
 */
export function collectRoadDebug(
  segments = [],
  junctions = [],
  {
    here = null,
    radius = ROAD_DEBUG_RADIUS_M,
    roadIndex = null,
    areas = null,
    lift = ROAD_DEBUG_LIFT_M,
    kinds = ROAD_DEBUG_KINDS,
  } = {}
) {
  const wanted = new Set(kinds);
  const groups = new Map();
  const groupFor = (kind) => {
    let group = groups.get(kind);
    if (!group) {
      group = createGroup(kind);
      groups.set(kind, group);
    }
    return group;
  };

  const inReach = (x, z) => !here || Math.hypot(x - here.x, z - here.z) <= radius;
  const counts = { segments: 0, junctions: 0, stitched: 0, works: 0, bundles: 0, levels: [] };
  const seenLevels = new Set();

  for (const segment of segments || []) {
    const path = segment?.path;
    if (!Array.isArray(path) || path.length < 2) continue;
    if (!inReach(path[0].x, path[0].z) && !inReach(path[path.length - 1].x, path[path.length - 1].z)) {
      continue;
    }
    counts.segments++;

    const { platform, halfWidth, works, levels, stitched } = segment;
    const height = (r) => (platform ? platform[r] : 0) + lift;

    for (let r = 0; r < path.length - 1; r++) {
      const a = path[r];
      const b = path[r + 1];
      if (!inReach(a.x, a.z)) continue;
      const level = levels?.[r] ?? LEVEL_GROUND;
      seenLevels.add(level);

      if (wanted.has('axis')) {
        pushLine(groupFor('axis'), a.x, height(r), a.z, b.x, height(r + 1), b.z, levelTint(level));
      }

      if (wanted.has('edges')) {
        const pa = perpendicularAt(path, r);
        const pb = perpendicularAt(path, r + 1);
        for (const side of [1, -1]) {
          pushLine(
            groupFor('edges'),
            a.x + pa.px * halfWidth * side,
            height(r),
            a.z + pa.pz * halfWidth * side,
            b.x + pb.px * halfWidth * side,
            height(r + 1),
            b.z + pb.pz * halfWidth * side,
            ROAD_DEBUG_COLORS.edges
          );
        }
      }

      // Les ouvrages sont surlignés au-dessus de l'axe : un pont et un tunnel
      // se lisent alors même quand le ruban ne les dessine pas (le tunnel).
      const code = works?.[r] || 0;
      if (code && wanted.has('works')) {
        const color = code === WORK_TUNNEL ? ROAD_DEBUG_COLORS.tunnel : ROAD_DEBUG_COLORS.bridge;
        pushLine(
          groupFor('works'),
          a.x, height(r) + 0.6, a.z,
          b.x, height(r + 1) + 0.6, b.z,
          color
        );
        if (code === WORK_BRIDGE || code === WORK_TUNNEL) counts.works++;
      }
    }

    // Les nœuds d'ancrage : ceux depuis lesquels le mobilier espacé se compte.
    // Un tronçon n'en porte qu'un, à son début (voir `anchorDistances`).
    if (wanted.has('anchors') && segment.anchor && inReach(segment.anchor.x, segment.anchor.z)) {
      const anchor = segment.anchor;
      const y = height(0);
      const arm = ROAD_DEBUG_NODE_M;
      const group = groupFor('anchors');
      pushLine(group, anchor.x - arm, y, anchor.z, anchor.x + arm, y, anchor.z, ROAD_DEBUG_COLORS.anchors);
      pushLine(group, anchor.x, y, anchor.z - arm, anchor.x, y, anchor.z + arm, ROAD_DEBUG_COLORS.anchors);
    }

    // Ce que la couture d'altitude a repris, et de combien : un trait vertical
    // dont la hauteur est le déplacement. Deux voies qui auraient dû être
    // cousues et ne l'ont pas été se lisent à l'absence de trait.
    if (wanted.has('stitch') && stitched) {
      const group = groupFor('stitch');
      for (let r = 0; r < path.length; r++) {
        const step = stitched[r];
        if (!step || !inReach(path[r].x, path[r].z)) continue;
        counts.stitched++;
        pushLine(
          group,
          path[r].x, height(r) - step, path[r].z,
          path[r].x, height(r), path[r].z,
          ROAD_DEBUG_COLORS.stitch
        );
      }
    }
  }

  for (const junction of junctions || []) {
    if (!junction || !inReach(junction.x, junction.z)) continue;
    counts.junctions++;
    const deck = roadIndex ? roadIndex.deckAt(roadIndex.query(junction.x, junction.z, 1)) : null;
    const y = (deck ?? 0) + lift + 0.2;

    if (wanted.has('junctions')) {
      const group = groupFor('junctions');
      const reach = Math.max(junction.halfWidth || 0, 1.5);
      let previous = null;
      for (let i = 0; i <= ROAD_DEBUG_CIRCLE_SIDES; i++) {
        const angle = (i / ROAD_DEBUG_CIRCLE_SIDES) * Math.PI * 2;
        const point = { x: junction.x + Math.cos(angle) * reach, z: junction.z + Math.sin(angle) * reach };
        if (previous) {
          pushLine(group, previous.x, y, previous.z, point.x, y, point.z, ROAD_DEBUG_COLORS.junctions);
        }
        previous = point;
      }
    }

    if (wanted.has('branches')) {
      const group = groupFor('branches');
      for (const branch of junction.branches || []) {
        pushLine(
          group,
          junction.x, y, junction.z,
          junction.x + branch.x * ROAD_DEBUG_BRANCH_M,
          y,
          junction.z + branch.z * ROAD_DEBUG_BRANCH_M,
          ROAD_DEBUG_COLORS.branches
        );
      }
    }
  }

  // Le contour des carrefours : la frontière exacte entre les rubans et la
  // surface commune. C'est le seul trait qui montre où la chaussée s'arrête.
  if (wanted.has('outlines') && areas) {
    const group = groupFor('outlines');
    for (const area of areas.areas || []) {
      if (!inReach(area.x, area.z)) continue;
      const deck = roadIndex ? roadIndex.deckAt(roadIndex.query(area.x, area.z, 1)) : null;
      const y = (deck ?? 0) + lift;
      const outline = area.outline;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        pushLine(group, a.x, y, a.z, b.x, y, b.z, ROAD_DEBUG_COLORS.outlines);
      }
    }
  }

  // Les faisceaux : un trait en travers de chaque vide, d'une rive à l'autre.
  // C'est la réponse à « pourquoi ces deux voies-là sont-elles considérées
  // comme se longeant, et ces deux-là non » — la question que pose le
  // comblement, et la seule qu'on ne peut pas lire sur la géométrie finale.
  if (wanted.has('bundles') && roadIndex) {
    const group = groupFor('bundles');
    for (const gap of collectRoadGaps(segments || [], { roadIndex, areas })) {
      for (const pair of gap.pairs) {
        if (!inReach(pair.near.x, pair.near.z)) continue;
        counts.bundles++;
        pushLine(
          group,
          pair.near.x, pair.near.deck + lift, pair.near.z,
          pair.far.x, pair.far.deck + lift, pair.far.z,
          ROAD_DEBUG_COLORS.bundles
        );
      }
    }
  }

  counts.levels = [...seenLevels].sort((a, b) => a - b);
  return { groups: ROAD_DEBUG_KINDS.filter((k) => groups.has(k)).map((k) => groups.get(k)), counts };
}
