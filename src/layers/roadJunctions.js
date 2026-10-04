import { junctionLinks, junctionLinkArea } from './junctionLinks.js';
import { unirAiresFourches } from './junctionUnions.js';
import { seamIntervals, seamBoundary, seamRibbonRuns } from './junctionSeams.js';
import { junctionTriangles, junctionDistance } from './junctionTriangulation.js';
import { enveloppesEntrees } from './roundaboutEntries.js';
/*
 * roadJunctions — un carrefour est une **surface**, pas un point.
 *
 * La frontière porte les cotes communes aux rubans, à la dalle et au terrain.
 * Sa triangulation conserve les arêtes du contour, y compris lorsqu'un
 * carrefour concave n'est pas visible en entier depuis son nœud.
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
 * sa triangulation conserve les subdivisions des bouches.
 *
 * Les rayons donnent la profondeur initiale ; les bouches et les coins
 * suivent les tangentes des branches à cette profondeur. Une liaison courte
 * borne la profondeur à sa moitié pour conserver une chaussée entre nœuds.
 * `junctionSeams` rattache chaque bouche à son arête de graphe et publie les
 * mêmes sommets XYZ pour le ruban, la dalle, les bordures et les marquages.
 * Les tangentes parallèles relient les bouches directement : un coin
 * extrapolé pourrait replier le contour et perdre un accès.
 * L'extrémité provisoire d'une liaison couverte peut porter deux bouches :
 * `junctionLinks` prolonge ensuite son contour jusqu'à l'autre nœud.
 *
 * ## La fourche
 *
 * Trois branches dont deux se quittent sous un angle fermé ne font pas de coin
 * de rue : les deux rubans se recouvrent jusqu'à ce que leurs axes s'écartent.
 * `forkArea` couvre ce recouvrement en suivant leurs tracés, et pose la pointe
 * de l'îlot là où ils se séparent.
 * Lorsqu'elle atteint un voisin du graphe, `junctionUnions` réunit leurs
 * contours si toutes les bouches extérieures restent entières et sans îlot.
 *
 * ## Le giratoire
 *
 * Un giratoire arrive du graphe comme un seul carrefour, marqué `roundabout`
 * (voir `roadRoundabouts`). Son aire est une couronne (`roundaboutArea`) : le
 * cercle extérieur percé d'une bouche par branche, et un îlot (`island`) que
 * `areaCovers` exclut — l'herbe et les arbres y restent.
 * L'entrée suit le ruban courbe jusqu'à l'anneau ; son enveloppe radiale
 * conserve une couronne sans secteur replié.
 *
 * ## Qui cède le passage
 *
 * Un carrefour est aussi le seul endroit du modèle où une **priorité** a un
 * sens, et c'est donc ici qu'elle se décide (`branchYields`), une fois pour
 * toutes : le marquage au sol et le panneau la lisent, ils ne la recalculent
 * pas chacun de son côté. La donnée n'en porte aucune ; la largeur des
 * branches, si, et la règle de tracé qui en découle suffit — on cède le
 * passage à plus large que soi.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne coupe pas les chaînes. La chaussée **continue** de traverser le
 * carrefour dans les données — c'est son ruban seul qui s'arrête à la bouche,
 * y compris sous les tunnels. C'est ce qui fait que l'emprise, le
 * déblai du terrain, la couture des plate-formes, l'espacement du mobilier et
 * les trottoirs continuent de lire une route entière : le carrefour ajoute une
 * surface, il ne perce pas de trou dans le réseau.
 *
 * Il ne relève pas non plus l'altitude : tout se construit en plan. Les cotes
 * lui sont données bien plus tard, une fois les plate-formes dressées et
 * cousues, et il y en a **une par bouche** : sur un versant, les branches d'un
 * même carrefour n'arrivent pas à la même hauteur, et une dalle horizontale y
 * laisserait une marche de plusieurs dizaines de centimètres contre chaque
 * ruban. Chaque sommet du contour sait donc de quelles branches il tient sa
 * cote (`from`, `to`, `blend`, lus par `outlineDeckAt`), et la dalle est
 * gauche.
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
/**
 * Débord d'inscription d'une aire dans l'index, en mètres — et donc portée
 * maximale d'une interrogation au-delà du contour. Le déblai du terrain
 * interroge à `cutBenchM + ROAD_CUT_BLEND_M` du bord : sans ce débord, une
 * cellule voisine ne verrait pas l'aire et l'entaille s'arrêterait net.
 */
export const JUNCTION_REACH_M = 12;

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
  const originA = a.origin ?? node, originB = b.origin ?? node;
  const a0 = { x: originA.x - pa.x * a.halfWidth, z: originA.z - pa.z * a.halfWidth };
  const b0 = { x: originB.x + pb.x * b.halfWidth, z: originB.z + pb.z * b.halfWidth };

  const hit = intersectLines(a0.x, a0.z, a.x, a.z, b0.x, b0.z, b.x, b.z);
  const reach = (a.halfWidth + b.halfWidth) * JUNCTION_CORNER_REACH;

  // Rives parallèles : les deux branches se prolongent (une route droite qu'une
  // troisième aborde). La rive continue tout droit, et il n'y a pas de coin.
  if (!hit || !Number.isFinite(hit.ta) || Math.abs(hit.ta) > reach || Math.abs(hit.tb) > reach) {
    if(a.origin)return {points:[],ta:0,tb:0};
    const mid = { x: (a0.x + b0.x) / 2, z: (a0.z + b0.z) / 2 };
    return { points: [mid], ta: 0, tb: 0 };
  }

  if (a.origin && (hit.ta>(a.mouthLimit ?? Infinity) || hit.tb>(b.mouthLimit ?? Infinity)))
    return { points: [], ta: hit.ta, tb: hit.tb };
  const corner = { x: hit.x, z: hit.z };
  const cos = a.x * b.x + a.z * b.z;

  // Deux branches opposées : la rive est droite, un arc n'y a rien à faire.
  if (cos <= STRAIGHT_COS) return { points: [corner], ta: hit.ta, tb: hit.tb };

  const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
  const half = angle / 2;
  const radius = Math.max(0, Math.min(
    ((a.mouthLimit ?? Infinity)-hit.ta-JUNCTION_MOUTH_MARGIN_M)*Math.tan(half),
    ((b.mouthLimit ?? Infinity)-hit.tb-JUNCTION_MOUTH_MARGIN_M)*Math.tan(half),
    JUNCTION_CORNER_MAX_M,
    Math.max(JUNCTION_CORNER_MIN_M, Math.min(a.halfWidth, b.halfWidth) * JUNCTION_CORNER_RATIO)
  ));
  if (radius < 1e-6) return { points: [corner], ta: hit.ta, tb: hit.tb };

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
 * La section de la chaussée d'une branche à la profondeur `depth` du
 * carrefour : où elle passe, et la direction qu'elle y suit.
 *
 * La profondeur est comptée **le long du rayon** de la branche, et non le long
 * de sa polyligne. C'est ce qui garde la bouche au-delà des raccords d'angle,
 * qui sont eux construits sur les rayons : la bouche se déplace en travers
 * pour rejoindre la chaussée, jamais en avant ou en arrière.
 *
 * Sans polyligne (`branch.path`), la branche est son rayon et rien n'a changé.
 * Quand la polyligne s'arrête avant la profondeur voulue — une branche courte,
 * entre deux carrefours proches —, on prolonge sa dernière direction : c'est
 * la seule qu'on connaisse, et elle vaut mieux que le rayon d'origine.
 *
 * Fonction pure.
 *
 * @param {{x:number,z:number}} node Le nœud du carrefour.
 * @param {{x:number,z:number,path?:Array<{x:number,z:number}>}} branch
 * @param {number} depth Profondeur le long du rayon, en mètres.
 * @returns {{centre:{x:number,z:number}, direction:{x:number,z:number}}}
 */
export function branchSection(node, branch, depth) {
  const ray = { x: branch.x, z: branch.z };
  const along = (p) => (p.x - node.x) * ray.x + (p.z - node.z) * ray.z;
  const fallback = {
    centre: { x: node.x + ray.x * depth, z: node.z + ray.z * depth },
    direction: ray,
  };

  const path = branch.path;
  if (!Array.isArray(path) || path.length < 2) return fallback;

  const heading = (a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    return length > 1e-9 ? { x: dx / length, z: dz / length } : null;
  };

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const da = along(a);
    const db = along(b);
    if (db < depth || db - da < 1e-9) continue;
    const k = Math.min(1, Math.max(0, (depth - da) / (db - da)));
    return {
      centre: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k },
      direction: heading(a, b) || ray,
    };
  }

  // La polyligne finit en deçà : prolongement de sa dernière direction.
  const last = path[path.length - 1];
  const direction = heading(path[path.length - 2], last) || ray;
  const reach = direction.x * ray.x + direction.z * ray.z;
  if (!(reach > 1e-6)) return fallback;
  const extra = (depth - along(last)) / reach;
  return {
    centre: { x: last.x + direction.x * extra, z: last.z + direction.z * extra },
    direction,
  };
}

/**
 * Construit l'aire d'un carrefour : le contour de sa chaussée, et la bouche de
 * chaque branche.
 *
 * @param {Object} junction Carrefour publié par `mergeRoadLines`.
 * @param {Object} [options]
 * @returns {{x:number, z:number, level:number, profile:string, halfWidth:number,
 *          outline:Array<{x:number,z:number}>, mouths:Array<Object>,
 *          edges:Array<Object>, radius:number}|null} `null` si le carrefour n'a
 *          pas de quoi en faire une surface (moins de trois branches
 *          utilisables). `edges` porte les morceaux de rive — les coins de rue —
 *          que le carrefour ajoute entre deux bouches consécutives.
 */
export function junctionArea(junction, options = {}) {
  if (junction?.link) return junctionLinkArea(junction, branchSection, options.margin ?? JUNCTION_MOUTH_MARGIN_M, j=>junctionArea(j,options));
  if (junction?.roundabout) return roundaboutArea(junction, options);
  const { margin = JUNCTION_MOUTH_MARGIN_M } = options;
  const raw = junction?.branches;
  const minimum = junction?.extremiteLiaison ? 2 : 3;
  if (!Array.isArray(raw) || raw.length < minimum) return null;

  // Triées par azimut : c'est ce qui rend « la branche suivante » bien définie,
  // et donc la construction indépendante du nombre de branches.
  const sorted = raw
    .filter((b) => Number.isFinite(b?.x) && Number.isFinite(b?.z) && b.halfWidth > 0)
    .map((b) => ({ ...b, angle: Math.atan2(b.z, b.x) }))
    .sort((a, b) => a.angle - b.angle);
  const fork = forkOf(sorted);
  if (fork) {
    const area = forkArea(junction, fork, options);
    if (area) return area;
  }
  const branches = mergeParallelBranches(sorted);
  // Hors extrémité d'une liaison, deux bouches ne suffisent pas à décrire un
  // carrefour : des voies repartant ensemble replieraient son contour.
  if (branches.length < minimum) return null;

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

  const sections = new Array(count);
  for (let i = 0; i < count; i++) {
    const branch = branches[i];
    // La bouche se pose au-delà du plus lointain de ses deux raccords : c'est
    // la seule façon qu'elle ne coupe aucun des deux.
    const t = Math.min(branch.mouthLimit ?? Infinity, Math.max(reach[i], branch.halfWidth * 0.5) + margin);
    const section = branchSection(node, branch, t);
    sections[i] = { ...section, t };
  }
  for (let i=0;i<count;i++) {
    const tangent = k => {
      const section=sections[k];
      return { ...branches[k], ...section.direction, mouthLimit:section.t,
        origin:{x:section.centre.x-section.direction.x*section.t,z:section.centre.z-section.direction.z*section.t} };
    };
    corners[i]=junctionCorner(node,tangent(i),tangent((i+1)%count),options);
    if (corners[i].points.some(p=>sections.some(s=>(p.x-s.centre.x)*s.direction.x+(p.z-s.centre.z)*s.direction.z>1e-6)))
      corners[i].points=[];
  }

  const outline = [];
  const mouths = [];
  const corner = [];

  for (let i = 0; i < count; i++) {
    const branch = branches[i];
    const { t, centre, direction } = sections[i];
    const next = (i + 1) % count;
    const p = { x: direction.z, z: -direction.x };
    // `from`, `to`, `blend` : de quelles branches ce sommet tient sa cote (voir
    // `outlineDeckAt`). Une bouche est celle de sa branche ; un sommet d'arc est
    // entre deux, et passe de l'une à l'autre en tournant.
    const left = {
      x: centre.x + p.x * branch.halfWidth,
      z: centre.z + p.z * branch.halfWidth,
      from: i,
      to: i,
      blend: 0,
    };
    const right = {
      x: centre.x - p.x * branch.halfWidth,
      z: centre.z - p.z * branch.halfWidth,
      from: i,
      to: i,
      blend: 0,
    };

    // Le contour entre par la rive gauche de la branche et ressort par la
    // droite : c'est le sens dans lequel le tri par azimut le fait tourner.
    outline.push(left, right);
    // Puis l'arc qui la relie à la suivante.
    const arc = corners[i].points;
    for (let k = 0; k < arc.length; k++) {
      arc[k].from = i;
      arc[k].to = next;
      arc[k].blend = (k + 1) / (arc.length + 1);
      outline.push(arc[k]);
    }

    // Le morceau de rive que ce carrefour ajoute au réseau, entre la bouche de
    // cette branche et celle de la suivante : c'est le **coin de rue**, celui
    // le long duquel un trottoir tourne au lieu de traverser la chaussée. Il
    // est refermé plus bas, une fois toutes les bouches posées.
    corner.push({ from: i, to: next, arc, right });

    mouths.push({
      edge: branch.edge,
      graphEdges: branch.edges,
      origin: branch.path?.[0] ?? node,
      profile: branch.profile,
      halfWidth: branch.halfWidth,
      // Celle de la chaussée à la bouche, et non le rayon de la branche : ce
      // qui se pose à une bouche se pose en travers de la route qui y arrive.
      direction,
      distance: t,
      centre,
      left,
      right,
    });
  }

  // Chaque coin va de la rive droite d'une bouche à la rive gauche de la
  // suivante, en passant par l'arc : les deux extrémités sont **exactement**
  // les sommets où les rives de tronçon s'arrêtent, si bien que la rive de la
  // chaussée est continue d'un bout à l'autre du réseau. C'est ce qui permet à
  // deux choses de la suivre sans se concerter : la bordure de trottoir
  // (`streetLayer`) et la ligne de rive peinte (`roadMarkings`).
  const edges = corner.map((piece) => {
    const points = [piece.right, ...piece.arc, mouths[piece.to].left];
    const middle = points[Math.floor(points.length / 2)];
    let ox = middle.x - node.x;
    let oz = middle.z - node.z;
    const length = Math.hypot(ox, oz) || 1;
    return {
      from: piece.from,
      to: piece.to,
      points,
      // Vers l'extérieur du carrefour : le côté où se pose ce qui borde la
      // chaussée. Mesuré, pas déduit d'un sens de rotation supposé.
      outward: { x: ox / length, z: oz / length },
    };
  });

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
    edges,
    radius,
  };
}

/**
 * Angle maximal entre les deux branches d'une **fourche** : une chaussée qui
 * se sépare en deux — une route qui se dédouble en deux sens uniques, une
 * bretelle qui quitte une voie. Au-delà, c'est un embranchement ordinaire, et
 * ses rives se rencontrent assez tôt pour que coins et arcs suffisent.
 */
export const JUNCTION_FORK_ANGLE = (30 * Math.PI) / 180;
/**
 * Profondeur maximale où chercher la séparation des deux branches, en mètres.
 * Au-delà, elles sont dessinées comme une seule (`mergeParallelBranches`).
 */
export const JUNCTION_FORK_REACH_M = 90;
/** Pas de recherche de la séparation, et d'échantillonnage des rives, en mètres. */
const JUNCTION_FORK_STEP_M = 1.5;

/**
 * La fourche d'un carrefour, s'il en est une : trois branches, dont deux se
 * quittent sous un angle fermé (`a` puis `b` dans l'ordre des azimuts) et la
 * troisième (`trunk`) arrive en face d'elles.
 *
 * Fonction pure.
 */
export function forkOf(sorted) {
  if (!Array.isArray(sorted) || sorted.length !== 3) return null;
  for (let i = 0; i < 3; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % 3];
    const trunk = sorted[(i + 2) % 3];
    const cos = a.x * b.x + a.z * b.z;
    if (cos < Math.cos(JUNCTION_FORK_ANGLE)) continue;
    const bx = a.x + b.x;
    const bz = a.z + b.z;
    const length = Math.hypot(bx, bz) || 1;
    if ((trunk.x * bx + trunk.z * bz) / length > -0.5) continue;
    return { trunk, a, b };
  }
  return null;
}

/** Vrai si un carrefour du graphe est une fourche (voir `forkOf`). */
export function isForkJunction(junction) {
  const branches = junction?.branches;
  if (!Array.isArray(branches) || branches.length !== 3) return false;
  return !!forkOf(branches.map((b) => ({ ...b, angle: Math.atan2(b.z, b.x) })).sort((a, b) => a.angle - b.angle));
}

/**
 * L'aire d'une fourche.
 *
 * Les deux branches partent du même nœud, sur le même axe, et leurs rubans se
 * recouvrent tant que leurs axes ne sont pas écartés de la somme de leurs
 * demi-largeurs. Cette profondeur de séparation se cherche **sur leurs
 * tracés** (`branchSection`), pas sur leurs rayons : les deux moitiés d'une
 * route dédoublée s'écartent en courbe, et deux droites la manqueraient de
 * plusieurs mètres. Tout ce qui est en deçà est le carrefour :
 *
 *   - la bouche du tronc, tout près du nœud ;
 *   - de chaque côté, la rive extérieure de la branche, suivie le long de son
 *     tracé et passant de la demi-largeur du tronc à la sienne — la chaussée
 *     s'évase sans pincement là où la donnée fait partir les deux axes du
 *     même point ;
 *   - les bouches des deux branches, à la séparation ;
 *   - entre elles, la pointe de l'îlot.
 *
 * Rend `null` quand les branches ne se séparent pas dans `JUNCTION_FORK_REACH_M`.
 */
export function forkArea(junction, { trunk, a, b }, { margin = JUNCTION_MOUTH_MARGIN_M } = {}) {
  const node = { x: junction.x, z: junction.z };

  let separation = null;
  for (let d = JUNCTION_FORK_STEP_M; d <= JUNCTION_FORK_REACH_M; d += JUNCTION_FORK_STEP_M) {
    const pa = branchSection(node, a, d).centre;
    const pb = branchSection(node, b, d).centre;
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) >= a.halfWidth + b.halfWidth) {
      separation = d;
      break;
    }
  }
  if (separation === null) return null;

  const legDepth = separation + margin;
  const trunkDepth = trunk.halfWidth * 0.5 + margin;
  if ([a,b].some(branch=>branch.boundedEnd && legDepth>branch.mouthLimit) ||
      trunk.boundedEnd && trunkDepth>trunk.mouthLimit) return null;
  const left = (dir) => ({ x: dir.z, z: -dir.x });
  const mouthOf = (branch, depth) => {
    if(branch.endDegree>=3 && branch.path?.length) {
      const end=branch.path.at(-1);
      depth=Math.min(depth,(end.x-node.x)*branch.x+(end.z-node.z)*branch.z);
    }
    const { centre, direction } = branchSection(node, branch, depth);
    const p = left(direction);
    const w = branch.halfWidth;
    return {
      edge: branch.edge,
      graphEdges: branch.edges,
      origin: branch.path?.[0] ?? node,
      profile: branch.profile,
      halfWidth: w,
      direction,
      distance: depth,
      centre,
      left: { x: centre.x + p.x * w, z: centre.z + p.z * w },
      right: { x: centre.x - p.x * w, z: centre.z - p.z * w },
    };
  };
  // Rangs des bouches, pour les cotes : le tronc, puis les deux branches.
  const mouths = [mouthOf(trunk, trunkDepth), mouthOf(a, legDepth), mouthOf(b, legDepth)];
  mouths.forEach((mouth, i) => {
    Object.assign(mouth.left, { from: i, to: i, blend: 0 });
    Object.assign(mouth.right, { from: i, to: i, blend: 0 });
  });

  // Rive extérieure d'une branche (`side` : +1 gauche, -1 droite), du nœud à
  // sa bouche exclue ; sa demi-largeur passe de celle du tronc à la sienne.
  const rive = (branch, rank, side) => {
    const points = [];
    const depth=mouths[rank].distance;
    for (let d = 0; d < depth - 1e-6; d += JUNCTION_FORK_STEP_M) {
      const { centre, direction } = branchSection(node, branch, d);
      const p = left(direction);
      const k = Math.min(1, d / Math.min(separation,depth));
      const w = trunk.halfWidth + (branch.halfWidth - trunk.halfWidth) * k;
      points.push({
        x: centre.x + side * p.x * w,
        z: centre.z + side * p.z * w,
        from: 0,
        to: rank,
        blend: d / depth,
        normal: { x: side * p.x, z: side * p.z },
      });
    }
    return points;
  };
  const sideA = rive(a, 1, 1);
  const sideB = rive(b, 2, -1).reverse();
  for (const point of sideB) {
    point.from = 2;
    point.to = 0;
    point.blend = 1 - point.blend;
  }

  const [trunkMouth, mouthA, mouthB] = mouths;
  const nose = {
    x: (mouthA.right.x + mouthB.left.x) / 2,
    z: (mouthA.right.z + mouthB.left.z) / 2,
    from: 1,
    to: 2,
    blend: 0.5,
  };
  const outline = [
    trunkMouth.left,
    trunkMouth.right,
    ...sideA,
    mouthA.left,
    mouthA.right,
    nose,
    mouthB.left,
    mouthB.right,
    ...sideB,
  ];

  const outwardOf = (points, fallback) => {
    const middle = points[Math.floor(points.length / 2)];
    if (middle?.normal) return middle.normal;
    const ox = fallback.x - node.x;
    const oz = fallback.z - node.z;
    const length = Math.hypot(ox, oz) || 1;
    return { x: ox / length, z: oz / length };
  };
  const edges = [
    { from: 0, to: 1, points: [trunkMouth.right, ...sideA, mouthA.left], outward: outwardOf(sideA, mouthA.left) },
    { from: 1, to: 2, points: [mouthA.right, nose, mouthB.left], outward: outwardOf([], nose) },
    { from: 2, to: 0, points: [mouthB.right, ...sideB, trunkMouth.left], outward: outwardOf(sideB, mouthB.right) },
  ];

  let radius = 0;
  for (const point of outline) radius = Math.max(radius, Math.hypot(point.x - node.x, point.z - node.z));

  return {
    x: junction.x,
    z: junction.z,
    level: junction.level ?? LEVEL_GROUND,
    profile: junction.profile,
    halfWidth: junction.halfWidth,
    degree: junction.degree,
    fork: true,
    outline,
    mouths,
    edges,
    radius,
  };
}

/**
 * Évasement d'une entrée de giratoire, en mètres : la bouche d'une branche se
 * pose d'autant au-delà de l'anneau, et le contour la rejoint en biais.
 */
export const ROUNDABOUT_FLARE_M = 3;
/** Pas angulaire maximal du bord extérieur d'un giratoire. */
const ROUNDABOUT_ARC_STEP = (10 * Math.PI) / 180;

/**
 * Où la branche franchit le cercle de rayon `reach` autour de `centre`, et la
 * direction qu'elle y suit. Une branche courte se ferme à son bout réel,
 * sans inventer un prolongement au-delà de sa polyligne.
 */
function branchCrossing(centre, branch, reach) {
  const path = Array.isArray(branch.path) && branch.path.length >= 2 ? branch.path : null;
  const radial = (p) => Math.hypot(p.x - centre.x, p.z - centre.z);
  const heading = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return length > 1e-9 ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length } : { x: branch.x, z: branch.z };
  };
  if (!path) return null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const ra = radial(a);
    const rb = radial(b);
    if (rb < reach || rb - ra < 1e-9) continue;
    const k = Math.min(1, Math.max(0, (reach - ra) / (rb - ra)));
    return { centre: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }, direction: heading(a, b) };
  }
  const last = path[path.length - 1];
  const direction = heading(path[path.length - 2], last);
  return { centre: { x:last.x,z:last.z }, direction };
}

/**
 * L'aire d'un giratoire : une couronne. Le contour extérieur est le cercle de
 * l'anneau, percé d'une bouche par branche ; l'îlot (`island`) en est retiré,
 * et c'est la projection du contour sur le cercle intérieur, sommet pour
 * sommet — ce qui fait de la couronne une suite de quadrilatères.
 *
 * L'anneau n'a pas de bouche : son ruban est tout entier dans l'aire, et
 * seules les branches qui en sortent s'y arrêtent.
 */
export function roundaboutArea(junction) {
  const ring = junction.roundabout;
  const node = { x: junction.x, z: junction.z };
  const reach = ring.outer + ROUNDABOUT_FLARE_M;

  const mouths = [];
  for (const branch of junction.branches || []) {
    if (!(branch.halfWidth > 0)) continue;
    const crossing = branchCrossing(node, branch, reach);
    if (!crossing) continue;
    const { centre, direction } = crossing;
    const p = { x: direction.z, z: -direction.x };
    const w = branch.halfWidth;
    mouths.push({
      edge: branch.edge,
      graphEdges: branch.edges,
      origin: branch.path?.[0] ?? node,
      profile: branch.profile,
      halfWidth: w,
      direction,
      distance: reach,
      centre,
      left: { x: centre.x + p.x * w, z: centre.z + p.z * w },
      right: { x: centre.x - p.x * w, z: centre.z - p.z * w },
      angle: Math.atan2(centre.z - node.z, centre.x - node.x),
    });
  }
  if (mouths.length === 0) return null;
  mouths.sort((a, b) => a.angle - b.angle);
  const entrees=enveloppesEntrees(node,ring.outer,mouths,junction.branches);

  const angleOf = (p) => Math.atan2(p.z - node.z, p.x - node.x);
  const outline = [];
  const sectors = [];
  const count = mouths.length;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const mouth = mouths[i];
    Object.assign(mouth.left, { from: i, to: i, blend: 0 });
    Object.assign(mouth.right, { from: i, to: i, blend: 0 });
    outline.push(mouth.left, mouth.right);

    const start = angleOf(mouth.right);
    let sweep = angleOf(mouths[next].left) - start;
    while (sweep <= 0) sweep += Math.PI * 2;
    if (count === 1 && sweep < Math.PI) sweep += Math.PI * 2;
    const steps = Math.max(1, Math.ceil(sweep / ROUNDABOUT_ARC_STEP));
    const arc = [];
    const angles=Array.from({length:steps-1},(_,k)=>start+sweep*(k+1)/steps);
    for(let at of entrees?.angles ?? []) {
      while(at<=start)at+=Math.PI*2;
      if(at<start+sweep-1e-6)angles.push(at);
    }
    const azimuts=angles.sort((a,b)=>a-b).filter((a,i,l)=>!i || a-l[i-1]>1e-6);
    for (const at of azimuts) {
      const rayon=entrees?.rayonA(at) ?? ring.outer;
      arc.push({
        x: node.x + Math.cos(at) * rayon,
        z: node.z + Math.sin(at) * rayon,
        from: i,
        to: next,
        blend: (at-start)/sweep,
      });
    }
    outline.push(...arc);
    sectors.push({ from: i, to: next, mouth: mouth.left, points: [mouth.right, ...arc, mouths[next].left] });
  }

  const project = (p) => {
    const d = Math.hypot(p.x - node.x, p.z - node.z) || 1;
    const k = ring.inner / d;
    return { x: node.x + (p.x - node.x) * k, z: node.z + (p.z - node.z) * k, from: p.from, to: p.to, blend: p.blend };
  };
  const island = outline.map(project);

  // Deux rives par secteur : le bord extérieur, et celui de l'îlot qui lui
  // fait face — bouche comprise, l'îlot n'en a pas. Chacune a son extérieur,
  // mesuré depuis son milieu.
  const edges = [];
  for (const sector of sectors) {
    const middle = sector.points[Math.floor(sector.points.length / 2)];
    const ox = middle.x - node.x;
    const oz = middle.z - node.z;
    const length = Math.hypot(ox, oz) || 1;
    edges.push({ from: sector.from, to: sector.to, points: sector.points, outward: { x: ox / length, z: oz / length } });
    edges.push({
      from: sector.from,
      to: sector.to,
      points: [sector.mouth, ...sector.points].map(project),
      outward: { x: -ox / length, z: -oz / length },
    });
  }

  let radius = 0;
  for (const point of outline) radius = Math.max(radius, Math.hypot(point.x - node.x, point.z - node.z));

  return {
    x: junction.x,
    z: junction.z,
    level: junction.level ?? LEVEL_GROUND,
    profile: ring.profile,
    halfWidth: junction.halfWidth,
    degree: junction.degree,
    roundabout: true,
    outline,
    island,
    mouths,
    edges,
    radius,
  };
}

/**
 * Vrai si un point est sur la chaussée d'une aire : dans son contour, hors de
 * son îlot s'il en a un.
 */
export function areaCovers(area, x, z) {
  return junctionDistance(area,x,z).distance===0;
}

/**
 * Cote d'un sommet de contour, d'après celles des branches du carrefour.
 *
 * Un sommet de bouche prend la cote de sa branche — celle-là même où le ruban
 * s'arrête, si bien que les deux se rejoignent sans marche. Un sommet d'arc
 * est entre deux bouches, et passe de l'une à l'autre en tournant.
 *
 * Fonction pure.
 *
 * @param {{from:number,to:number,blend:number}} point Sommet du contour.
 * @param {Array<number>} decks Cote par branche, dans l'ordre des bouches.
 * @returns {number}
 */
export function outlineDeckAt(point, decks) {
  const from = decks[point?.from ?? 0];
  const to = decks[point?.to ?? 0];
  if (!Number.isFinite(from)) return to;
  if (!Number.isFinite(to)) return from;
  return from + (to - from) * (point.blend || 0);
}

/** Cote d'un sommet de dalle telle que `junctionSurface` la pose : le centre faute de bouche cotée. */
function slabVertexDeck(point, decks, centre) {
  const height = outlineDeckAt(point, decks);
  return Number.isFinite(height) ? height : centre;
}

/**
 * Cote de la dalle d'un carrefour en un point qu'elle couvre.
 *
 * La dalle lit la triangulation partagée avec son maillage : le point tombe dans un
 * triangle, et sa cote s'y interpole en
 * coordonnées barycentriques. Exacte sur les triangles du rendu, c'est ce qui
 * permet au déblai du terrain de descendre **sous la dalle** et non sous la
 * plus basse de ses bouches, ce qui creuserait une marche au ras d'un
 * carrefour de versant.
 *
 * Fonction pure.
 *
 * @param {Object} area  Aire rendue par `junctionArea`.
 * @param {Array<number>} decks Cote par bouche.
 * @param {number} x
 * @param {number} z
 * @returns {number} `NaN` si aucune bouche n'a de cote.
 */
export function junctionDeckAt(area, decks, x, z) {
  const centre = junctionCentreDeck(decks);
  const outline = area?.outline;
  if (!Number.isFinite(centre) || !Array.isArray(outline) || outline.length < 3) return centre;

  const {vertices,triangles}=junctionTriangles(area);
  const height=p=>p===vertices[0]?centre:slabVertexDeck(p,decks,centre);
  // La marge couvre la tolérance barycentrique d'un point posé sur une arête.
  const slack=1e-5;
  for(const [ci,ai,bi] of triangles) {
    const c=vertices[ci],a=vertices[ai],b=vertices[bi];
    if(x<Math.min(c.x,a.x,b.x)-slack || x>Math.max(c.x,a.x,b.x)+slack ||
      z<Math.min(c.z,a.z,b.z)-slack || z>Math.max(c.z,a.z,b.z)+slack) continue;
    const ax=a.x-c.x,az=a.z-c.z,bx=b.x-c.x,bz=b.z-c.z;
    const px=x-c.x,pz=z-c.z,det=ax*bz-az*bx;
    if(Math.abs(det)<1e-9)continue;
    const wa=(px*bz-pz*bx)/det,wb=(ax*pz-az*px)/det;
    if(wa>=-1e-8 && wb>=-1e-8 && wa+wb<=1+1e-8) return height(c)*(1-wa-wb)+height(a)*wa+height(b)*wb;
  }
  // La dichotomie d'un ruban peut tomber juste dehors : on lit sa frontière,
  // jamais la cote du centre à plusieurs mètres de cette bouche.
  let nearest=Infinity, boundary=centre;
  for(let i=0;i<outline.length;i++) {
    const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
    const distance=(x-a.x-t*dx)**2+(z-a.z-t*dz)**2;
    if(distance<nearest){nearest=distance;boundary=height(a)*(1-t)+height(b)*t;}
  }
  return boundary;
}

/**
 * Cote la plus basse de la dalle à moins de `radius` d'un point.
 *
 * La dalle est pliée aux arêtes de ses triangles ; sur un versant ces plis sont souvent
 * en creux : un triangle de terrain dont les sommets sont posés sur la dalle
 * la survole entre eux. Un sommet de terrain qui ne dépasse pas la dalle dans
 * tout le rayon d'une maille garde toute corde qui en part sous elle.
 *
 * Exacte : sur un triangle plan, le minimum dans le disque tombe sur un
 * sommet, là où une arête coupe le cercle, ou au point du cercle qui suit la
 * pente vers le bas.
 *
 * Fonction pure.
 *
 * @param {Object} area Aire portant ses `decks`.
 * @param {number} x
 * @param {number} z
 * @param {number} radius En mètres.
 * @returns {number} `Infinity` si la dalle ne tombe pas dans le disque.
 */
export function lowestDeckAround(area, x, z, radius) {
  const outline = area?.outline;
  const decks = area?.decks;
  if (!Array.isArray(outline) || outline.length < 3 || !decks) return Infinity;

  const centre = junctionCentreDeck(decks);
  const r2 = radius * radius;
  let lowest = Infinity;
  const keep = (h) => {
    if (h < lowest) lowest = h;
  };
  // Cote là où le segment (a, b) coupe le cercle.
  const crossings = (ax, az, ah, bx, bz, bh) => {
    const dx = bx - ax;
    const dz = bz - az;
    const fx = ax - x;
    const fz = az - z;
    const qa = dx * dx + dz * dz;
    if (qa < 1e-12) return;
    const qb = 2 * (fx * dx + fz * dz);
    const disc = qb * qb - 4 * qa * (fx * fx + fz * fz - r2);
    if (disc < 0) return;
    const root = Math.sqrt(disc);
    const t0 = (-qb - root) / (2 * qa);
    const t1 = (-qb + root) / (2 * qa);
    if (t0 >= 0 && t0 <= 1) keep(ah + (bh - ah) * t0);
    if (t1 >= 0 && t1 <= 1) keep(ah + (bh - ah) * t1);
  };

  const {vertices,triangles}=junctionTriangles(area);
  for (const [ci,ai,bi] of triangles) {
    const c=vertices[ci],a=vertices[ai],b=vertices[bi];
    if (
      Math.min(c.x, a.x, b.x) > x + radius || Math.max(c.x, a.x, b.x) < x - radius ||
      Math.min(c.z, a.z, b.z) > z + radius || Math.max(c.z, a.z, b.z) < z - radius
    ) continue;
    const cx=c.x,cz=c.z,ch=ci===0?centre:slabVertexDeck(c,decks,centre);
    if ((cx-x)**2+(cz-z)**2<=r2) keep(ch);
    const ah = slabVertexDeck(a, decks, centre);
    const bh = slabVertexDeck(b, decks, centre);
    if (!Number.isFinite(ah) || !Number.isFinite(bh)) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 <= r2) keep(ah);
    crossings(cx, cz, ch, a.x, a.z, ah);
    crossings(b.x, b.z, bh, cx, cz, ch);
    if ((b.x-x)**2+(b.z-z)**2<=r2) keep(bh);
    crossings(a.x, a.z, ah, b.x, b.z, bh);

    // Le point du cercle qui descend la pente du triangle, s'il y tombe.
    const ux = a.x - cx;
    const uz = a.z - cz;
    const vx = b.x - cx;
    const vz = b.z - cz;
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-9) continue;
    const gx = ((ah - ch) * vz - (bh - ch) * uz) / det;
    const gz = ((bh - ch) * ux - (ah - ch) * vx) / det;
    const slope = Math.hypot(gx, gz);
    const mx=x-cx,mz=z-cz;
    const ma=(mx*vz-mz*vx)/det,mb=(ux*mz-uz*mx)/det;
    if(ma>=0 && mb>=0 && ma+mb<=1)keep(ch+(ah-ch)*ma+(bh-ch)*mb);
    if (slope < 1e-12) continue;
    const px = x - (gx / slope) * radius - cx;
    const pz = z - (gz / slope) * radius - cz;
    const wa = (px * vz - pz * vx) / det;
    const wb = (ux * pz - uz * px) / det;
    if (wa >= 0 && wb >= 0 && wa + wb <= 1) keep(ch + (ah - ch) * wa + (bh - ch) * wb);
  }
  return lowest;
}

/**
 * Cote du nœud d'un carrefour : la moyenne de ses bouches.
 *
 * Ce n'est pas la cote de la chaussée dominante, et c'est délibéré. Sur un
 * versant, les bouches d'un même carrefour ne sont pas à la même hauteur — une
 * branche monte, l'autre descend —, et c'est la moyenne qui met le centre au
 * milieu de la dalle plutôt que sur l'une de ses rives.
 *
 * Fonction pure.
 *
 * @param {Array<number>} decks
 * @returns {number} `NaN` si aucune bouche n'a de cote.
 */
export function junctionCentreDeck(decks) {
  let sum = 0;
  let count = 0;
  for (const deck of decks || []) {
    if (!Number.isFinite(deck)) continue;
    sum += deck;
    count++;
  }
  return count ? sum / count : NaN;
}

/**
 * Vrai si une branche doit céder le passage au carrefour.
 *
 * La donnée ne porte aucune priorité : ni `highway=give_way`, ni panneau, ni
 * sens de circulation. Elle porte en revanche la **classe** de chaque branche,
 * donc sa largeur — et la règle de tracé qui en découle est générale : on cède
 * le passage à plus large que soi. Deux branches de même largeur ne cèdent ni
 * l'une ni l'autre, et c'est le bon résultat : une croisée de deux voies
 * identiques n'est pas marquée sur le terrain non plus.
 *
 * Cette règle est lue à deux endroits — le marquage au sol (`roadMarkings`) et
 * le panneau (`furnitureLayer`) — et il est essentiel que ce soit la même : un
 * cédez-le-passage peint sans panneau, ou l'inverse, se lit comme une faute.
 *
 * @param {{halfWidth:number}} area Aire de carrefour, ou carrefour de graphe :
 *        les deux portent la demi-largeur de leur branche dominante.
 * @param {number} halfWidth Demi-largeur de la branche examinée.
 * @returns {boolean}
 */
export function branchYields(area, halfWidth) {
  // On entre dans un giratoire en cédant le passage, quelle que soit sa largeur ;
  // une fourche ne croise rien, personne n'y cède.
  if (area?.roundabout) return halfWidth > 0;
  if (area?.fork || isForkJunction(area)) return false;
  const dominant = area?.halfWidth;
  if (!(dominant > 0) || !(halfWidth > 0)) return false;
  // Les largeurs viennent d'une table par classe : l'égalité y est exacte, et
  // l'epsilon ne fait que garder le calcul flottant de la trahir.
  return halfWidth < dominant - 1e-6;
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

// Boîte du contour, gardée sur l'aire ; les coutures (`junctionSeams.js`) l'allongent après coup.
function outlineBounds(area) {
  const outline = area.outline;
  if (area.bounds?.count === outline.length) return area.bounds;
  const box = { count: outline.length, minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  area.bounds = box;
  for (const p of outline) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.z < box.minZ) box.minZ = p.z;
    if (p.z > box.maxZ) box.maxZ = p.z;
  }
  return box;
}

/**
 * Distance d'un point au bord d'un contour, vers l'extérieur, et le point du
 * bord qui lui fait face. Zéro dedans. Fonction pure.
 *
 * @param {Array<{x:number,z:number}>} outline
 * @param {number} x
 * @param {number} z
 * @returns {{distance:number, x:number, z:number}}
 */
export function outlineDistance(outline, x, z) {
  if (!Array.isArray(outline) || outline.length < 3) return { distance: Infinity, x, z };
  if (pointInOutline(outline, x, z)) return { distance: 0, x, z };

  // Lu pour chaque sommet de terrain proche d'un carrefour : pas d'objet par arête.
  let bestSq = Infinity;
  let bestX = x;
  let bestZ = z;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const dx = outline[j].x - a.x;
    const dz = outline[j].z - a.z;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distanceSq = (x - px) ** 2 + (z - pz) ** 2;
    if (distanceSq >= bestSq) continue;
    bestSq = distanceSq;
    bestX = px;
    bestZ = pz;
  }
  return { distance: Math.sqrt(bestSq), x: bestX, z: bestZ };
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
    /**
     * Tronçons qui débouchent dans chaque aire.
     *
     * Une aire n'est pas un obstacle pour ce qui la borde : la bordure d'un
     * coin de rue est tangente aux rives de ses propres branches, et mesurer
     * la place disponible sans les écarter rendrait zéro partout. Il faut donc
     * savoir, aire par aire, de quelles chaussées elle est faite.
     * @type {Array<Set<Object>>}
     */
    this.feeders = [];

    const entrees=[];
    for (const junction of junctionLinks(junctions)) {
      const area = junctionArea(junction, options);
      if (!area) continue;
      area.ringEdges = junction.ringEdges;
      entrees.push({junction,area});
    }
    for (const area of unirAiresFourches(entrees)) {
      const index = this.areas.length;
      this.areas.push(area);
      this.feeders.push(new Set());

      // Disque circonscrit élargi de `JUNCTION_REACH_M` : une interrogation
      // faite au bord de l'aire ne lit qu'une cellule, et doit y trouver l'aire.
      const reach = area.radius + JUNCTION_REACH_M;
      const minX = Math.floor((area.x - reach) / cell);
      const maxX = Math.floor((area.x + reach) / cell);
      const minZ = Math.floor((area.z - reach) / cell);
      const maxZ = Math.floor((area.z + reach) / cell);
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
   * Retient qu'un tronçon débouche dans les aires que ses lignes traversent.
   * Appelé une fois par tronçon, juste après `markJunctionRows`.
   *
   * @param {Object} segment Tronçon portant déjà son tableau `junction`.
   */
  noteFeeder(segment) {
    const rows = segment?.junction;
    if (!rows) return;
    for (let r = 0; r < rows.length; r++) {
      const index = rows[r];
      if (index >= 0) this.feeders[index].add(segment);
    }
  }

  /** Vrai si ce tronçon débouche dans cette aire. */
  feeds(index, segment) {
    return index >= 0 && index < this.feeders.length && this.feeders[index].has(segment);
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
      if (areaCovers(area, x, z)) return index;
    }
    return -1;
  }

  /** Vrai si un point tombe dans un carrefour de ce niveau. */
  covers(x, z, level = LEVEL_GROUND) {
    return this.indexAt(x, z, level) >= 0;
  }

  /**
   * Cote de la dalle qui couvre ce point au sol, ou `null` — parce qu'aucun
   * carrefour n'y est, ou parce que celui qui y est n'a pas encore reçu ses
   * cotes (aire hors de portée du réseau construit).
   *
   * Le déblai du terrain s'en sert : la chaussée d'un carrefour déborde des
   * rubans qui l'alimentent — les arcs de raccordement bombent au-delà de leurs
   * rives —, donc l'entaille tirée des seuls rubans laisse le sol remonter dans
   * les coins, par-dessus la dalle.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} [level]
   * @returns {number|null}
   */
  deckAt(x, z, level = LEVEL_GROUND) {
    const index = this.indexAt(x, z, level);
    if (index < 0) return null;
    const area = this.areas[index];
    if (!area?.decks) return null;
    const deck = junctionDeckAt(area, area.decks, x, z);
    return Number.isFinite(deck) ? deck : null;
  }

  /**
   * Dalle la plus proche d'un point, et la distance à son bord — zéro dessus.
   *
   * `deckAt` répond « quelle dalle est **sous** ce point ? » et s'arrête donc
   * au contour. Le déblai du terrain pose l'autre question : « à quelle
   * distance de la dalle suis-je ? », parce qu'une dalle a le même fond plat
   * et le même raccord qu'un ruban. Sans eux, le terrain retombe d'un coup sur
   * elle au ras du contour, et la corde du triangle qui enjambe ce bord passe
   * par-dessus la chaussée du carrefour.
   *
   * La cote est relevée au point du bord qui fait face, jamais au point
   * lui-même : dehors, l'interpolation entre bouches n'a plus de sens.
   * Avec `spread`, c'est la plus basse de la dalle dans ce rayon
   * (`lowestDeckAround`).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} margin Portée de la recherche au-delà du contour, en
   *        mètres, bornée par `JUNCTION_REACH_M`.
   * @param {number} [level]
   * @param {number} [spread] Rayon où chercher la cote la plus basse, en mètres.
   * @returns {{deck:number, distance:number}|null}
   */
  deckNear(x, z, margin, level = LEVEL_GROUND, spread = 0) {
    return this.deckSamplesNear(x, z, margin, level, spread).sort((a,b)=>a.distance-b.distance)[0] ?? null;
  }

  deckSamplesNear(x, z, margin, level = LEVEL_GROUND, spread = 0) {
    const reach = Math.min(margin, JUNCTION_REACH_M);
    const bucket = this.buckets.get(cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!bucket) return [];

    const samples = [];
    for (const index of bucket) {
      const area = this.areas[index];
      if (!area.decks || (level===null ? area.terrainCovered : area.level!==level)) continue;
      const box = outlineBounds(area);
      if (x < box.minX - reach || x > box.maxX + reach || z < box.minZ - reach || z > box.maxZ + reach) continue;
      const near = junctionDistance(area, x, z);
      if (near.distance > reach) continue;
      let deck = junctionDeckAt(area, area.decks, near.x, near.z);
      if (spread > near.distance) deck = Math.min(deck, lowestDeckAround(area, x, z, spread));
      if (!Number.isFinite(deck)) continue;
      samples.push({ deck, distance: near.distance });
    }
    return samples;
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

  if (segment.junctionSeams) {
    for (const cut of seamIntervals(segment)) for (let r=0;r<rows;r++) {
      if (segment.path[r].distance>=cut.from && segment.path[r].distance<=cut.to)
        out[r]=cut.index ?? (cut.left ?? cut.right).index;
    }
    return out;
  }
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
function boundaryTowards(path, platform, keep, drop, area, steps) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const x = path[keep].x + (path[drop].x - path[keep].x) * mid;
    const z = path[keep].z + (path[drop].z - path[keep].z) * mid;
    if (areaCovers(area, x, z)) hi = mid;
    else lo = mid;
  }
  const boundary = between(path, platform, keep, drop, (lo + hi) / 2);
  if (area.decks) boundary.deck = junctionDeckAt(area,area.decks,boundary.point.x,boundary.point.z);
  return boundary;
}

/**
 * Le sommet exact où un tronçon franchit le contour d'un carrefour, entre une
 * ligne gardée et la ligne voisine qui, elle, est dedans.
 *
 * Exporté parce que le ruban n'est pas seul à s'arrêter là : la bordure et le
 * trottoir doivent finir sur la **même** section, sans quoi la rive de la
 * chaussée aurait deux bouts distants de cinq mètres.
 *
 * @param {Object} segment Tronçon portant `path`, `platform` et `junction`.
 * @param {JunctionAreas} areas
 * @param {number} keep Ligne hors carrefour.
 * @param {number} drop Ligne voisine, dans le carrefour.
 * @param {Object} [options]
 * @returns {{point:{x:number,z:number,distance:number}, deck:number}|null}
 */
export function junctionBoundaryAt(segment, areas, keep, drop, { steps = JUNCTION_BISECT_STEPS } = {}) {
  const rows = segment?.path?.length ?? 0;
  if (keep < 0 || drop < 0 || keep >= rows || drop >= rows) return null;
  const index = segment.junction?.[drop] ?? -1;
  if (index < 0 || !areas?.areas?.[index]) return null;
  if (segment.junctionSeams) {
    const seam=segment.junctionSeams.find(s=>s.index===index &&
      s.distance>=Math.min(segment.path[keep].distance,segment.path[drop].distance)-1e-8 &&
      s.distance<=Math.max(segment.path[keep].distance,segment.path[drop].distance)+1e-8);
    return seam ? seamBoundary(seam) : null;
  }
  return boundaryTowards(segment.path, segment.platform, keep, drop, areas.areas[index], steps);
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
 * @returns {Array<{path:Array<{x:number,z:number,distance:number}>,
 *          platform:Float32Array, head:number, tail:number}>} `head` et `tail`
 *          donnent le rang de l'aire qui borne chaque bout, `-1` s'il est libre.
 */
export function junctionRibbonRuns(segment, areas, runs, { steps = JUNCTION_BISECT_STEPS } = {}) {
  if (segment.junctionSeams) return seamRibbonRuns(segment, runs);
  const { path, platform } = segment;
  const junction = segment.junction;
  const out = [];
  if (!path || !platform) return out;

  const areaFor = (r) => {
    const index = junction ? junction[r] : -1;
    return index >= 0 ? areas.areas[index] : null;
  };

  const areaAt = (r) => (junction && r >= 0 && r < path.length ? junction[r] : -1);

  const emit = (from, to) => {
    const points = [];
    const decks = [];

    // Entrée : si la ligne précédente est dans un carrefour, on part de son bord.
    const before = from > 0 ? areaFor(from - 1) : null;
    if (before) {
      const edge = boundaryTowards(path, platform, from, from - 1, before, steps);
      points.push(edge.point);
      decks.push(edge.deck);
    }

    for (let r = from; r <= to; r++) {
      points.push(path[r]);
      decks.push(platform[r]);
    }

    const after = to < path.length - 1 ? areaFor(to + 1) : null;
    if (after) {
      const edge = boundaryTowards(path, platform, to, to + 1, after, steps);
      points.push(edge.point);
      decks.push(edge.deck);
    }

    if (points.length < 2) return;
    // Quel carrefour borne ce bout, et non pas seulement « il y en a un » :
    // ce qui se pose à une bouche — la ligne d'effet, la traversée — dépend de
    // ce que le carrefour dit de cette branche-là.
    out.push({
      path: points,
      platform: Float32Array.from(decks),
      head: before ? areaAt(from - 1) : -1,
      tail: after ? areaAt(to + 1) : -1,
    });
  };

  // Deux carrefours voisins peuvent prendre deux lignes consécutives sans se
  // toucher : la chaussée qui les sépare n'a alors aucune ligne libre, et le
  // sol passerait en travers de la route.
  const bridge = (a, b) => {
    const ia = areaAt(a);
    const ib = areaAt(b);
    if (ia < 0 || ib < 0 || ia === ib) return;
    const exit = boundaryTowards(path, platform, b, a, areas.areas[ia], steps);
    const entry = boundaryTowards(path, platform, a, b, areas.areas[ib], steps);
    if (entry.point.distance - exit.point.distance < 1e-3) return;
    out.push({
      path: [exit.point, entry.point],
      platform: Float32Array.of(exit.deck, entry.deck),
      head: ia,
      tail: ib,
    });
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
      if (r < run.to) bridge(r, r + 1);
    }
  }

  return out;
}

/**
 * Triangule la dalle en conservant ses bouches et leurs cotes. La topologie
 * est partagée avec les sondages du terrain, y compris sur un contour concave.
 *
 * @param {Object} area   Aire rendue par `junctionArea`.
 * @param {number|Array<number>} deck Altitude de la chaussée du carrefour :
 *        une cote par bouche, ou une seule pour une dalle plane.
 * @param {Object} [options]
 * @returns {{positions:number[], uvs:number[], indices:number[]}|null}
 */
export function junctionSurface(area, deck, { textureLength = 12, base = 0 } = {}) {
  const outline = area?.outline;
  if (!Array.isArray(outline) || outline.length < 3) return null;
  const decks = Array.isArray(deck) ? deck : null;
  const centre = decks ? junctionCentreDeck(decks) : deck;
  if (!Number.isFinite(centre)) return null;

  const positions = [area.x, centre, area.z];
  // UV pris au sol : le carrefour n'a ni sens de marche ni largeur, donc pas
  // d'axe le long duquel dérouler une texture. Le grain suffit, et deux
  // carrefours voisins n'y tombent pas au même endroit.
  const uvs = [area.x / textureLength, area.z / textureLength];
  const indices = [];

  for (const point of outline) {
    const height = decks ? outlineDeckAt(point, decks) : centre;
    positions.push(point.x, Number.isFinite(height) ? height : centre, point.z);
    uvs.push(point.x / textureLength, point.z / textureLength);
  }

  const island = area.island;
  if (Array.isArray(island) && island.length === outline.length) {
    // Une couronne : un quadrilatère par côté du contour, jusqu'à l'îlot.
    for (const point of island) {
      const height = decks ? outlineDeckAt(point, decks) : centre;
      positions.push(point.x, Number.isFinite(height) ? height : centre, point.z);
      uvs.push(point.x / textureLength, point.z / textureLength);
    }
  }
  for(const triangle of junctionTriangles(area).triangles) indices.push(...triangle.map(i=>base+i));

  return { positions, uvs, indices };
}
