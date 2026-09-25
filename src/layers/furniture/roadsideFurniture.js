/*
 * roadsideFurniture — ce qui accompagne une chaussée sur sa longueur :
 * éclairage, poteaux et ligne aérienne, bornes, panneaux, balises de virage,
 * panneau d'entrée d'agglomération, alignement d'arbres et haies de bas-côté.
 *
 * Le contexte est lu **ligne par ligne** et non au milieu du tronçon : une
 * chaîne traverse la bulle de part en part, entre dans le bourg et en ressort.
 * Les emprises habitées (`settlement.js`) servent d'interrupteur — en ville
 * une rue est éclairée et n'a ni poteau ni haie, dehors c'est l'inverse.
 *
 * Tout ce qui se pose au ras de la rive (`atKerb`) le fait à un décalage
 * compté depuis **sa** chaussée, et se retire quand ce décalage tombe sur la
 * chaussée d'en face (`_onOtherPavement`).
 */

import { appendProfile } from '../ribbonGeometry.js';
import { LEVEL_GROUND } from '../roadWorks.js';
import { nearestNamedPlace, pointInAreas } from '../settlement.js';
import { lampHeadFor } from '../furnitureKit.js';
import {
  spacedAlongPath,
  pickShare,
  pathTurn,
  roadsideVergeFor,
  roadsideFurnitureFor,
  signKindFor,
  streetLampKindFor,
  crossSlope,
  contiguousRuns,
  runsByValue,
  randomAt,
} from '../furniturePlacement.js';
import { churchWithin } from './pointsOfInterest.js';
import { FURNITURE_RADIUS_M } from './catalog.js';
import { alignmentShapeForTree, sharesFor } from '../../core/regionInterpretation.js';
import {
  buildRoadsideRelief,
  buildEmbankment,
  measureRoom,
  profileTakesGuardrail,
} from './roadsideRelief.js';

export const SIGN_PLACE_NAME_MAX_M = 450;
export const SIGN_PLACE_NAME_FABRIC_RADIUS_M = 80;
/**
 * Longueur minimale, en mètres, du passage hors agglomération qui doit
 * précéder une portion bâtie pour que son début compte comme une vraie
 * entrée de ville (voir `isSettlementEdgeRun`) : sans ce garde-fou, la
 * moindre coupure entre deux polygones `landuse` adjacents en ville
 * redémarrait une portion « bâtie », donc un panneau de plus, en plein centre.
 */
export const SIGN_PLACE_NAME_MIN_GAP_M = 150;

/**
 * Rayon, en mètres, dans lequel un lieu de culte relevé fait basculer
 * l'éclairage sur le modèle traditionnel (`streetLampKindFor`) — l'ordre de
 * grandeur d'un centre ancien, pas d'une paroisse entière.
 */
export const STREET_LAMP_CHURCH_RADIUS_M = 1000;

/**
 * Vrai si la portion précédente d'une chaîne (`runsByValue`) est un vrai
 * passage hors agglomération — la seule chose qui fasse du début de la
 * portion suivante une vraie entrée de ville plutôt qu'un artefact du
 * découpage des `landuse`. Sans portion précédente, le repli est négatif :
 * une chaîne redécoupée autour de l'observateur commence très souvent déjà en ville.
 *

 * @param {{value:boolean, rows:Array<{distance:number}>}|null} previous
 * @param {number} [minGapM]
 */
export function isSettlementEdgeRun(previous, minGapM = SIGN_PLACE_NAME_MIN_GAP_M) {
  if (!previous) return false;
  const gap = previous.rows[previous.rows.length - 1].distance - previous.rows[0].distance;
  return gap >= minGapM;
}
/** Largeur de texte utilisable sur la lame blanche du panneau, en mètres —
 *  voir `signPlaceName` dans `furnitureKit.js` (face large de 1,64 m). */
export const SIGN_PLACE_NAME_TEXT_WIDTH_M = 1.5;
/** Hauteur de case visée pour le nom peint, en mètres, et son plancher (marge de part et d'autre sur la lame de 0,4 m). */
export const SIGN_PLACE_NAME_LABEL_HEIGHT_M = 0.36;
export const SIGN_PLACE_NAME_LABEL_MIN_HEIGHT_M = 0.16;
/** Repère local du texte sur la lame — voir `signPlaceName` (`y: 1.85`, face
 *  avant à `plane: 0.04`) : un centimètre devant elle, pour ne pas se
 *  disputer le pixel avec le blanc peint qu'il recouvre. */
export const SIGN_PLACE_NAME_LABEL_Y_M = 1.85;
export const SIGN_PLACE_NAME_LABEL_Z_M = 0.05;
/** Encre du nom peint : noir légèrement adouci, comme la lettre d'un vrai
 *  panneau EB10 sur fond blanc. */
export const SIGN_PLACE_NAME_LABEL_INK = '#1c1c1c';

/**
 * Essences plantables en alignement de route, avec leur part du tirage.
 *
 * Le conifère reste rare (0,22, la valeur d'avant ce catalogue élargi) : un
 * alignement de sapins en plaine ne se voit à peu près jamais. Les quatre
 * feuillus se partagent le reste à parts à peu près égales, aucun ne devant
 * dominer ni disparaître : la variété tient à ce qu'une route sur cinq environ
 * choisisse chaque silhouette, pas à ce qu'une seule domine les autres.
 */
const DEFAULT_ALIGNMENT_SPECIES = [
  ['treeConifer', 0.22],
  ['treeBroad', 0.195],
  ['treeRound', 0.195],
  ['treeColumnar', 0.195],
  ['treeOval', 0.195],
];

/**
 * Choisit l'essence d'un alignement, tirée une fois pour toute la chaîne (voir
 * l'appelant) — jamais arbre par arbre, ce qui replanterait une haie de
 * platanes en sapins au hasard de chaque pied.
 *
 * Un alignement de bord de route est un objet **planté**, donc daté et situé :
 * le platane de nationale, le cyprès de mas, le bouleau de chemin nordique. Il
 * se voit de loin, il est répété sur des kilomètres, et c'est ce qui le rend
 * cher à laisser générique — une route de Crète bordée de sapins se remarque
 * plus vite qu'un bois mal composé.
 *
 * Les essences sont celles du pays, dans l'ordre où il les donne : la première
 * pèse à peu près la moitié de l'alignement (`sharesFor`). Elles passent par le
 * catalogue du mobilier, qui ne connaît que six silhouettes — `treeColumnar`
 * porte le cyprès et le peuplier, `treeRound` le pin parasol comme le tilleul,
 * `treeOval` l'olivier comme le bouleau, `treePalm` le seul mot qui la porte.
 * Sans région, c'est le mélange par défaut.
 */
function alignmentTreeSpeciesFor(x, z, trees = null) {
  const mix = trees?.length
    ? sharesFor(trees).map(([word, share]) => [alignmentShapeForTree(word), share])
    : DEFAULT_ALIGNMENT_SPECIES;
  return pickShare(mix, randomAt(x, z, 37));
}

/**
 * Le mobilier qui accompagne la chaussée.
 *
 * Trois passes sur chaque portion : le relief d'abord, qui décide des deux
 * murs et de la glissière ; le contexte ensuite, qui décide de l'éclairage,
 * des poteaux, des bornes, des panneaux, de l'alignement et de la haie ; le
 * talus enfin, qui comble ce que le mur n'a pas pris.
 *
 * La portée se mesure ligne par ligne et non au milieu du tronçon. Depuis que
 * les chaussées sont fusionnées, une chaîne traverse la bulle de part en part :
 * juger au milieu poserait du mobilier à neuf cents mètres, derrière le
 * brouillard — ou, pire, en écarterait une chaîne qui passe juste à côté 
 * de l'observateur mais dont le milieu tombe au loin.
 */
export function buildRoadside(layer, context, roadSegments, builtUp) {
  const { placements, here } = context;

  for (const segment of roadSegments) {
    const { path, platform, edges, probeSpan } = segment;
    const rows = path.length;
    if (rows < 4) continue;

    const rowsInfo = [];
    for (let r = 0; r < rows; r++) {
      const { slope, uphill } = crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan);
      // Terrain de part et d'autre, à quatre mètres au-delà de la rive : c'est
      // lui qui dit jusqu'où monte le mur amont et jusqu'où descend l'aval.
      const uphillGround = uphill > 0 ? edges[r * 2] : edges[r * 2 + 1];
      const downhillGround = uphill > 0 ? edges[r * 2 + 1] : edges[r * 2];
      const turn = pathTurn(path, r);
      rowsInfo.push({
        r,
        x: path[r].x,
        z: path[r].z,
        distance: path[r].distance,
        slope,
        uphill,
        // Courbure locale : c'est elle, autant que la pente, qui décide d'un
        // parapet. Une glissière protège d'une sortie de route, et on sort de
        // la route dans les virages. Le signe donne le côté extérieur, où se
        // posent les balises.
        curvature: Math.abs(turn),
        turn: Math.sign(turn),
        // Surplomb de la rive aval : c'est lui qui appelle le mur ou le talus.
        drop: platform[r] - downhillGround,
        // Surplomb de la rive **amont**. Négatif sur un versant — le terrain
        // y domine la route —, positif quand la plate-forme est au-dessus du
        // sol des deux côtés : ce n'est plus une route de versant, c'est un
        // remblai en pleine terre, et il lui faut un talus de chaque côté. La
        // rampe d'accès d'un pont est exactement ce cas-là.
        perch: platform[r] - uphillGround,
        // Hauteur du terrain au-dessus de la plate-forme, côté amont : la
        // tranchée que le déblai a creusée, et que le mur doit habiller.
        rise: uphillGround - platform[r],
        // Ouvrage d'art (`roadWorks.js`) : la plate-forme n'y est plus posée
        // sur le terrain.
        work: segment.works?.[r] || 0,
      });
    }

    // Une ligne d'ouvrage ne porte aucun mobilier de bord de route : ni
    // falaise de déblai (on n'entaille pas la colline au-dessus d'un
    // tunnel), ni mur de soutènement, ni talus (il n'y a pas de terrain à
    // retenir sous un tablier), ni haie, ni poteau, ni alignement d'arbres à
    // cinquante mètres du sol. Le pont a ses propres garde-corps, posés par
    // `bridgeLayer` avec son tablier.
    const inReach = (row) =>
      !row.work && Math.hypot(row.x - here.x, row.z - here.z) <= FURNITURE_RADIUS_M;
    for (const near of contiguousRuns(rowsInfo, inReach, 4)) {
      measureRoom(layer, segment, near);
      const walled = buildRoadsideRelief(layer, context, segment, near);
      buildRoadsideContext(layer, context, segment, near, builtUp);
      buildEmbankment(layer, context, segment, near, walled);
    }
  }

  layer.counts.points = layer._countPlacements(placements);
}

/**
 * Ce que porte ce type de route **à cet endroit**.
 *
 * Le contexte est lu ligne par ligne, pas au milieu du tronçon : une chaîne
 * fait plusieurs centaines de mètres et traverse le village avant d'en
 * ressortir. Juger au milieu donnerait des lampadaires en pleine campagne ou
 * une haie au milieu du bourg, sur toute sa longueur.
 *
 * Chaque portion garde la numérotation de la chaîne — les espacements se
 * comptent depuis le nœud d'ancrage, pas depuis le début de la portion —, donc
 * traverser une limite d'agglomération ne décale rien.
 */
export function buildRoadsideContext(layer, context, segment, rowsInfo, builtUp) {
  const { buffers, placements, sampleElevation, here } = context;
  const { platform, halfWidth, profile, startDistance, anchor } = segment;
  // Le côté de la haie et de la ligne téléphonique se tire au nœud
  // d'ancrage : il ne dépend donc ni du découpage ni de la position de
  // l'observateur, et ne change plus de bord d'une reconstruction à l'autre.
  const side = anchor || segment.path[0];

  // Matérialisé plutôt que parcouru au fil de l'eau : `isSettlementEdge`
  // (plus bas) a besoin de connaître la portion **précédente** — voir sa
  // raison d'être au-dessus de `SIGN_PLACE_NAME_MIN_GAP_M`.
  const runs = runsByValue(rowsInfo, (row) => pointInAreas(builtUp, row.x, row.z), 8);

  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const rows = run.rows;
    if (rows.length < 3) continue;
    const origin = rows[0].distance;
    const path = rows.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
    const deck = new Float32Array(rows.map((row) => platform[row.r]));

    const inTown = run.value;
    const plan = roadsideFurnitureFor(profile, { builtUp: inTown });
    const spacing = { startDistance: startDistance + origin, margin: 4 };

    const previous = r > 0 ? runs[r - 1] : null;
    const isSettlementEdge = isSettlementEdgeRun(previous);

    applyRoadsidePlan(layer, {
      plan,
      path,
      rows,
      platform: deck,
      halfWidth,
      side,
      spacing,
      profile,
      inTown,
      isSettlementEdge,
      buffers,
      placements,
      sampleElevation,
      segment,
      here,
    });
  }
}

/**
 * Pose un plan de mobilier de bord de route sur une portion homogène.
 *
 * `side` est le point d'ancrage de la chaîne : tout ce qui se range d'un seul
 * côté de la route — la ligne téléphonique, la haie — s'y tire au sort. Deux
 * portions d'une même chaîne rendent donc le même côté, ce qui évite la haie
 * qui saute d'un bord à l'autre à chaque limite d'agglomération.
 *
 * Tout ce qui se pose au ras de la rive (`atKerb`) le fait à un décalage compté
 * depuis **sa** chaussée. Le décalage est chez lui tant qu'il n'y a rien en
 * face ; à un carrefour et dans un faisceau, il tombe sur la chaussée
 * voisine, et l'objet n'est alors pas posé (`_onOtherPavement`).
 */
export function applyRoadsidePlan(layer, {
  plan,
  path,
  rows,
  platform,
  halfWidth,
  side,
  spacing,
  profile,
  inTown,
  isSettlementEdge = true,
  buffers,
  placements,
  sampleElevation,
  segment,
  here = null,
}) {
  // Le niveau de croisement de cette portion : ce qui la borde s'y heurte aux
  // chaussées du même niveau, pas à celle qui passe dessous.
  const level = segment?.levels?.[rows?.[0]?.r] ?? LEVEL_GROUND;

  if (plan.lamp) {
    for (const p of spacedAlongPath(path, plan.lamp, spacing)) {
      // Alternance d'un côté et de l'autre : deux rangées face à face
      // n'existent que sur les boulevards, et se voient comme une erreur.
      const lamp = p.index % 2 === 0 ? 1 : -1;
      const offset = lamp * (halfWidth + 0.9);
      // Style du lampadaire : classique près d'un clocher, LED sur sol
      // industriel (`bare`), le modèle courant partout ailleurs.
      const kind = streetLampKindFor({
        nearChurch: churchWithin(layer._churches, p.x, p.z, STREET_LAMP_CHURCH_RADIUS_M),
        industrial: layer.groundClass?.surfaceAt(p.x, p.z) === 'bare',
      });
      const placed = layer._placeBeside(placements, kind, p, offset, platform, {
        facing: 'road',
        onPlatform: true,
        atKerb: true,
        own: segment,
        level,
      });
      // Halo nocturne : accroché à la lanterne — au bout de la crosse, qui
      // avance au-dessus de la chaussée, ou au sommet d'un mât de style.
      if (placed) {
        const head = lampHeadFor(kind);
        const reach = -Math.sign(offset) * head.reach;
        layer._lampHeads.push({
          x: placed.x + p.tz * reach,
          y: placed.y + head.height,
          z: placed.z - p.tx * reach,
        });
      }
    }
  }

  if (plan.utilityPole) {
    const poleSide = randomAt(side.x, side.z, 11) < 0.5 ? 1 : -1;
    const offset = poleSide * (halfWidth + 2.2);
    const standing = [];
    for (const p of spacedAlongPath(path, plan.utilityPole, spacing)) {
      // Dans l'axe de la route, et non tourné vers elle : la traverse d'un
      // poteau est perpendiculaire aux fils qu'elle porte, donc à la ligne.
      // Tourné vers la chaussée, il présentait sa traverse en travers de la
      // route — un détail qu'on ne peut plus ne pas voir une fois repéré.
      const placed = layer._placeBeside(placements, 'utilityPole', p, offset, platform, {
        facing: 'along',
        atKerb: true,
        own: segment,
        level,
      });
      if (placed) standing.push(p);
    }
    // La ligne ne relie que les poteaux réellement plantés : un carrefour se
    // franchit d'une portée plus longue, il ne se traverse pas à mi-hauteur
    // sur un poteau qui n'existe pas.
    appendOverheadLine(layer, buffers.wire, standing, offset, sampleElevation, 8.35);
  }

  // Bornes hectométriques, sauf tous les dix rangs : là, c'est la borne
  // kilométrique qui prend la place, plus haute. Côté droit, comme sur le
  // terrain, donc décalage négatif (la gauche de la marche est positive).
  const kerb = -(halfWidth + 0.7);
  if (plan.milestone) {
    const every = plan.kilometreStone ? Math.round(plan.kilometreStone / plan.milestone) : 0;
    for (const p of spacedAlongPath(path, plan.milestone, spacing)) {
      if (every && p.index % every === 0) continue;
      layer._placeBeside(placements, 'milestone', p, kerb, platform, {
        facing: 'road',
        onPlatform: true,
        atKerb: true,
        own: segment,
        level,
      });
    }
  }
  if (plan.kilometreStone) {
    for (const p of spacedAlongPath(path, plan.kilometreStone, spacing)) {
      layer._placeBeside(placements, 'milestone', p, kerb, platform, {
        facing: 'road',
        scale: 1.7,
        onPlatform: true,
        atKerb: true,
        own: segment,
        level,
      });
    }
  }

  // Panneaux : ils s'adressent au conducteur qui arrive, donc ils regardent le
  // trafic et non la chaussée. Posés à droite, ils font face au sens de la
  // marche — c'est `roadsideYaw` qui tient la convention.
  //
  // Lequel poser dépend de ce qui se passe **à cet endroit** (`signKindFor`) :
  // une balise dans une courbe, un panneau de priorité en ligne droite, un
  // passage piétons en ville. Un seul type répété tous les six cents mètres se
  // lisait comme un motif dès le troisième.
  if (plan.sign) {
    for (const p of spacedAlongPath(path, plan.sign, spacing)) {
      const row = rows[p.row];
      const item = signKindFor({
        curvature: row?.curvature ?? 0,
        builtUp: inTown,
        profile,
        variant: randomAt(p.x, p.z, 71),
      });
      layer._placeBeside(placements, item, p, -(halfWidth + 1.1), platform, {
        facing: 'traffic',
        onPlatform: true,
        atKerb: true,
        own: segment,
        level,
      });
    }
  }

  // Balises de virage : elles ne se posent pas isolément mais **en série**
  // dans la courbe, ce qui est justement ce qui les fait lire comme telles.
  // Seulement sur les chaussées aménagées : un sentier de montagne n'en porte
  // pas, et il est fait à peu près uniquement de virages serrés.
  const curveMarkers = profileTakesGuardrail(profile)
    ? spacedAlongPath(path, 14, spacing)
    : [];
  for (const p of curveMarkers) {
    const row = rows[p.row];
    if (!row || row.curvature < 0.022) continue;
    // Extérieur de la courbe : la perpendiculaire gauche étant `(tz, -tx)`, un
    // virage à gauche a un `turn` négatif et son extérieur est donc du côté
    // des décalages négatifs. Le signe du virage *est* le côté à prendre.
    const outer = row.turn || 1;
    layer._placeBeside(placements, 'signChevron', p, outer * (halfWidth + 1), platform, {
      facing: 'traffic',
      onPlatform: true,
      atKerb: true,
      own: segment,
      level,
    });
  }

  // Bâtons de repère de neige : le bord de route se perd sous la neige dès
  // qu'elle tombe, et c'est justement là que ce jalon a sa raison d'être —
  // sur toute chaussée aménagée, en climat de montagne, plus rapprochés que
  // les poteaux de glissière puisqu'ils marquent la rive même où elle manque.
  if ((layer.climate === 'alpine' || layer.climate === 'glacial') && profileTakesGuardrail(profile)) {
    for (const p of spacedAlongPath(path, 9, spacing)) {
      const row = p.index % 2 === 0 ? 1 : -1;
      layer._placeBeside(placements, 'snowPole', p, row * (halfWidth + 0.5), platform, {
        facing: 'road',
        onPlatform: true,
        atKerb: true,
        own: segment,
        level,
      });
    }
  }


  // Entrée d'agglomération : un seul panneau, au tout début de la portion
  // bâtie — et seulement là où un vrai lieu nommé est à portée
  // (`nearestNamedPlace`), où `FabricIndex` confirme que des bâtiments
  // réels s'y trouvent déjà, et où `isSettlementEdge` dit que ce début est
  // une vraie entrée et non un artefact du découpage des `landuse` (voir
  // `SIGN_PLACE_NAME_MIN_GAP_M`). Un `landuse=residential` n'est qu'un
  // périmètre administratif (voir l'en-tête de `settlement.js`) : sans les
  // trois conditions, ce panneau se plantait à l'entrée de n'importe quel
  // pâté de maisons, jamais forcément une ville — et sans nom à y peindre.
  if (inTown && isSettlementEdge && path.length > 4 && plan.lamp) {
    const start = path[1];
    const place = nearestNamedPlace(layer._places, start.x, start.z, SIGN_PLACE_NAME_MAX_M);
    const hasFabric =
      place &&
      layer._fabric &&
      layer._fabric.countWithin(start.x, start.z, SIGN_PLACE_NAME_FABRIC_RADIUS_M, 1) > 0;
    if (place && hasFabric) {
      const tx = path[2].x - path[0].x;
      const tz = path[2].z - path[0].z;
      const length = Math.hypot(tx, tz) || 1;
      const placed = layer._placeBeside(
        placements,
        'signPlaceName',
        { x: start.x, z: start.z, tx: tx / length, tz: tz / length, distance: start.distance },
        -(halfWidth + 1.4),
        platform,
        { facing: 'traffic', onPlatform: true, atKerb: true, own: segment, level }
      );
      if (placed) {
        // Majuscules : la lettre d'un vrai panneau EB10 est capitale, pas
        // seulement une initiale — contrairement à une enseigne de devanture.
        layer._labelQuads.push({ x: placed.x, y: placed.y, z: placed.z, yaw: placed.yaw, name: place.name.toUpperCase() });
      }
    }
  }

  // Alignement d'arbres : pas systématique. Une route sur trois environ n'en
  // porte pas, ce qui évite qu'une route majeure hors agglomération en soit
  // toujours bordée sur toute sa longueur.
  if (plan.alignmentTree && randomAt(side.x, side.z, 47) < 0.7) {
    // L'essence est tirée **une fois pour la chaîne** : un alignement mêlant
    // platanes et sapins n'existe pas, c'est le propre d'un alignement d'être
    // planté le même jour.
    const species = alignmentTreeSpeciesFor(side.x, side.z, layer.region?.trees);
    for (const p of spacedAlongPath(path, plan.alignmentTree, spacing)) {
      const row = p.index % 2 === 0 ? 1 : -1;
      layer._placeBeside(placements, species, p, row * (halfWidth + 3.2), platform, {
        scale: 1.05 + randomAt(p.x, p.z, 3) * 0.5,
        // Un platane pousse au bord de la route qu'il borde — donc celle-ci
        // ne le gêne pas — mais pas au milieu de celle qui la croise.
        offRoad: true,
        // Et pas sous un bois : il s'y noierait dans les arbres déjà plantés
        // depuis la photo. Arbre par arbre, l'alignement s'interrompt donc
        // au bois et reprend après, au lieu d'exister ou non selon un point
        // pris au milieu du tronçon rendu.
        openGround: true,
        own: segment,
      });
    }
  }

  // Bas-côté : haie basse, haie de bocage. Le motif n'est donné qu'à une
  // portion sur trois environ : appliqué partout, il transforme la
  // campagne en circuit.
  const verge = roadsideVergeFor(profile, { builtUp: inTown, variant: randomAt(side.x, side.z, 83) });
  if (verge.verge) {
    layer._appendHedgerow(buffers.lowHedge, 'lowHedge', path, sampleElevation, {
      offset: verge.vergeSide * (halfWidth + 2.6),
      openGround: true,
      verge: true,
      own: segment,
    });
  }

  // La haie de bocage le long de la route reste, mais elle n'est plus
  // systématique : une petite route sur deux seulement en porte une, et
  // jamais du côté où court déjà la haie basse du bas-côté.
  if (plan.hedge && randomAt(side.x, side.z, 29) < 0.5) {
    const hedgeSide = verge.verge
      ? -verge.vergeSide
      : randomAt(side.x, side.z, 23) < 0.5 ? 1 : -1;
    layer._appendHedgerow(buffers.hedge, 'hedge', path, sampleElevation, {
      offset: hedgeSide * (halfWidth + 1.8),
      openGround: true,
      verge: true,
      own: segment,
    });
  }
}

/**
 * Câble de ligne aérienne entre poteaux consécutifs.
 *
 * La flèche est une parabole — l'approximation classique de la caténaire pour
 * de petites portées, et la seule différence visible avec un segment droit,
 * qui trahirait aussitôt le décor.
 *
 * La courbe est bâtie **déjà décalée** sur la ligne des poteaux, plutôt que
 * décalée au balayage : c'est ce qui garantit que l'altitude du câble est
 * prise sous le poteau et non sous l'axe de la route, laquelle peut être un
 * mètre plus haut sur un versant.
 */
export function appendOverheadLine(layer, buffer, poles, offset, sampleElevation, height) {
  for (let i = 1; i < poles.length; i++) {
    const a = poles[i - 1];
    const b = poles[i];
    // Extrémités reportées sur la ligne des poteaux.
    const ax = a.x + a.tz * offset;
    const az = a.z - a.tx * offset;
    const bx = b.x + b.tz * offset;
    const bz = b.z - b.tx * offset;

    const span = Math.hypot(bx - ax, bz - az);
    // Une portée absente (poteaux confondus) ou démesurée signale un trou
    // dans l'espacement, pas une ligne : mieux vaut ne rien tendre.
    if (span < 4 || span > 90) continue;

    const sag = Math.min(1.6, span * 0.028);
    const steps = 6;
    const curve = [];
    const heights = new Float32Array(steps + 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      curve.push({ x, z, distance: span * t });
      // Parabole normalisée : nulle aux appuis, maximale à mi-portée.
      heights[s] = sampleElevation(x, z) + height - sag * 4 * t * (1 - t);
    }

    appendProfile(buffer, {
      path: curve,
      profile: layer.specs.profiles.wire,
      sampleElevation,
      baseHeights: heights,
      closed: true,
      // Aucun lissage : la flèche *est* la forme voulue, la moyenner
      // l'aplatirait et rendrait le câble rectiligne.
      smoothRadius: 0,
    });
  }
}
