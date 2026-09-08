/*
 * streetLayer — la voirie : caniveau, bordure, trottoir. Ce qui distingue une
 * route de campagne d'une rue de village n'est pas le revêtement, c'est la
 * bordure. Cette couche compose donc, le long des chaussées qui le méritent :
 *
 *     chaussée │ caniveau │ bordure │ trottoir │ jupe
 *              └ creux    └ marche  └ plat     └ enterré
 *
 * ## La bordure suit la rive, et la rive est une seule chose
 *
 * Cette section se pose sur la **rive de la chaussée** (`roadEdges`), et cette
 * rive n'est plus « l'axe du tronçon plus sa demi-largeur » : c'est la
 * frontière de la surface roulable, rubans et surfaces de carrefour réunis.
 * Trois conséquences, et ce sont elles le lot :
 *
 *   - une portion de bordure **finit exactement sur la bouche** du carrefour
 *     où son ruban s'arrête (`junctionBoundaryAt`), et non à la dernière ligne
 *     de ré-échantillonnage, cinq mètres avant ;
 *   - le **coin de rue** est bordé à son tour : chaque carrefour publie les
 *     morceaux de rive qu'il ajoute entre deux bouches (`area.edges`), et le
 *     trottoir y tourne au lieu de traverser la chaussée. C'est la seule façon
 *     qu'un trottoir ne ressemble pas à un ruban posé en travers d'un
 *     carrefour ;
 *   - le trottoir est **interrompu à chaque bouche**. Il n'y passe pas : c'est
 *     là que la traversée se peint.
 *
 * ## La traversée
 *
 * Elle se pose là où un trottoir arrive **des deux côtés** de la même bouche,
 * et nulle part ailleurs. Ce n'est pas un raffinement : c'est la seule
 * condition qui distingue une traversée d'un carrefour de campagne, et c'est
 * la raison pour laquelle elle est peinte ici plutôt qu'avec le reste du
 * marquage (`roadMarkings`, posé par `roadNetwork`). Une chaussée ne sait pas
 * ce qui la borde ; cette couche vient de le décider.
 *
 * La chaussée lui réserve sa profondeur à la bouche (`MOUTH_CROSSING_M`) et
 * pose sa ligne d'effet au-delà : les deux ne se recouvrent pas, et c'est
 * l'ordre réel d'un débouché — on cède le passage avant le passage piétons.
 *
 * ## La place disponible, et non plus un refus
 *
 * Le trottoir occupe ce qui reste entre la bordure et la chaussée d'en face
 * (`edgeClearance`). Une largeur, pas un booléen : là où deux voies se
 * longent, il se rétrécit, et il ne disparaît que s'il ne tient plus. Le
 * sondage `pavementOnOtherRoad`, qui refusait tout un trottoir dès que sa
 * bande la plus large touchait une autre chaussée, disait oui sur vingt-cinq
 * mètres autour de chaque carrefour et coupait donc le trottoir juste là où
 * on le regarde.
 *
 * ## Le vide entre deux voies qui se longent
 *
 * Cette couche pose aussi le **comblement** des entre-deux de faisceau
 * (`roadBundles`) : la bande de terrain de deux mètres qui reste entre une
 * départementale et la piste cyclable qui la double, entre une contre-allée et
 * sa rue, entre deux sens séparés. Elle est ici et pas dans `roadNetwork`
 * parce qu'elle vient **après** le trottoir : là où un trottoir tient, il vaut
 * mieux qu'un zébra, et un vide déjà revêtu n'est plus un vide.
 *
 * Elle n'attend pas d'être en bourg — un longement de piste cyclable laisse de
 * l'herbe au milieu du bitume en rase campagne comme ailleurs.
 *
 * Pas de trottoir sur simple `landuse=residential` (qui contient aussi prés
 * et chemins non bordés) : trois conditions tenues ensemble, ligne par ligne
 * et côté par côté — la chaussée s'y prête (desserte/traversée, pas voie
 * rapide/chemin/sentier), le périmètre l'autorise (emprise habitée), le bâti
 * le confirme (`FabricIndex`, pour distinguer une traversée de bourg de la
 * route qui longe le stade du même bourg). S'y ajoute : pas de trottoir sur
 * devers marqué (déjà un mur côté mobilier).
 *
 * Ces mêmes conditions sont posées **au coin de rue** comme le long d'un
 * tronçon, au milieu du morceau de rive : une seule règle, évaluée sur chaque
 * morceau de la frontière, quel que soit ce qui le porte.
 *
 * Chaque côté est jugé séparément sur un disque de bâti centré à 15 m de
 * l'axe : une rue bâtie d'un seul côté n'a de trottoir que de ce côté, et le
 * critère ne dépend que de coordonnées au sol (stable au découpage).
 *
 * Le trottoir reçoit le `platform` du tronçon et le décollement exact de la
 * chaussée (`ROAD_LIFT_M`) : il ne peut pas diverger de la rue, même sur un
 * dos-d'âne ou un raccord de carrefour. Il reçoit aussi ses **repères**
 * (`pathFrames` du tronçon entier) : recalculés sur la portion, ils divergent
 * à ses deux bouts, et c'est cette divergence-là que six centimètres de
 * recouvrement du caniveau sur la chaussée cachaient. Le recouvrement est
 * parti, le décalage de profondeur qui l'arbitrait aussi : caniveau et bitume
 * partagent maintenant leurs sommets.
 */
import { appendProfile, createProfileBuffer, pathFrames, toColoredGeometry } from './ribbonGeometry.js';
import { ROAD_LIFT_M } from './roadNetwork.js';
import { RoadIndex } from './roadGraph.js';
import { contiguousRuns, crossSlope, randomAt, STEEP_CROSS_SLOPE } from './furniturePlacement.js';
import { pointInAreas } from './settlement.js';
import { edgeClearance, outwardSide, polylineLength } from './roadEdges.js';
import { junctionBoundaryAt } from './roadJunctions.js';
import { appendZebra, collectRoadGaps } from './roadBundles.js';
import {
  MARKING_LIFT_M,
  MOUTH_CROSSING_M,
  appendCrossing,
  sectionAtDistance,
} from './roadMarkings.js';
import { srgb } from '../core/color.js';
import { streetSurfaceAt } from './townStyle.js';
import { defaultTheme } from '../themes/default.js';

/** Chaussées qui peuvent porter un trottoir (dessertes ; pas de voie rapide, chemin, sentier ou piste cyclable). */
export const STREET_PROFILES = new Set(['major', 'minor', 'lane']);

/** Portée de la voirie, en mètres (doit dépasser la distance parcourue entre deux reconstructions, 250 m). */
export const STREET_RADIUS_M = 450;
/** Décalage du disque de lecture du bâti, au-delà de la rive. */
export const STREET_PROBE_M = 15;
/** Rayon de ce disque. Un front bâti de village tient dans trente mètres. */
export const STREET_FABRIC_RADIUS_M = 30;
/** Bâtiments exigés dans le disque. Deux : une maison isolée ne fait pas une rue. */
export const STREET_FABRIC_MIN = 2;
/** Devers au-delà duquel la bordure deviendrait un mur de soutènement — le seuil du mobilier, repris tel quel. */
export const STREET_MAX_CROSS_SLOPE = STEEP_CROSS_SLOPE;
/**
 * Longueur minimale d'une portion de bordure, en mètres.
 *
 * Une **longueur**, et non plus un compte de lignes (`STREET_MIN_RUN`, cinq
 * lignes de cinq mètres). Le compte de lignes disait deux choses à la fois :
 * le pas de ré-échantillonnage de la chaussée et la longueur en deçà de
 * laquelle un morceau de trottoir n'en est pas un. Depuis que les carrefours
 * découpent les rives, un pâté de maisons entre deux croisements proches fait
 * légitimement moins de vingt-cinq mètres, et le compte de lignes l'effaçait.
 *
 * Douze mètres : la façade d'une maison. En deçà, ce n'est pas un trottoir,
 * c'est un reste de découpage.
 */
export const STREET_MIN_LENGTH_M = 12;

/**
 * Vrai si un côté de chaussée mérite sa bordure, à cet endroit.
 * @param {Object} context
 * @param {boolean} context.builtUp    La ligne est dans une emprise habitée.
 * @param {number} context.buildings   Bâtiments comptés du côté examiné.
 * @param {number} context.crossSlope  Pente en travers, sans dimension.
 * @returns {boolean}
 */
export function kerbQualifies({ builtUp = false, buildings = 0, crossSlope = 0 } = {}) {
  if (!builtUp) return false;
  if (buildings < STREET_FABRIC_MIN) return false;
  return Math.abs(crossSlope) <= STREET_MAX_CROSS_SLOPE;
}

/** Largeur du trottoir en un point, en mètres (tirée du lieu, stable d'une reconstruction à l'autre). */
export function walkWidthAt(x, z, streets = defaultTheme.streets) {
  const [min, max] = streets.walkWidth;
  return min + randomAt(x, z, 197) * (max - min);
}

/**
 * Section d'une rue, d'un côté, en mètres dans le repère (travers, hauteur).
 * `up` se compte depuis la surface de la chaussée (zéro = bitume), pas le
 * terrain. `side` vaut +1 à gauche de la marche, -1 à droite (sommets émis en
 * ordre inverse à droite, pour garder le même sens de rotation).
 *
 * @param {Object} options
 * @param {number} options.halfWidth  Demi-largeur de la chaussée.
 * @param {number} options.walkWidth  Largeur du trottoir.
 * @param {number} options.side       +1 ou -1.
 * @param {Object} options.tones      Retour de `streetSurfaceAt`.
 * @param {Object} [streets]          Tranche `theme.streets`.
 * @returns {Array<{across:number, up:number, color:number[]}>}
 */
export function kerbProfile({ halfWidth, walkWidth, side, tones }, streets = defaultTheme.streets) {
  const { gutterWidth, gutterDepth, kerbHeight, kerbNose, walkFall, skirtWidth, skirtDepth } = streets;

  // Fil d'eau plus sombre que la bordure (là où l'eau et la terre s'accumulent).
  const gutterEdge = tones.gutter.map((c, i) => c * 0.5 + tones.kerb[i] * 0.12);
  // Face de bordure plus sombre que son dessus, sinon la marche disparaît sous un soleil haut.
  const kerbFace = tones.kerb.map((c) => c * 0.78);

  // La rive, exactement. Le caniveau mordait jusqu'ici six centimètres sur la
  // chaussée, et un décalage de profondeur arbitrait le recouvrement ; les
  // deux ne servaient qu'à cacher la fente que faisaient des repères de
  // balayage recalculés sur la portion. Les repères sont maintenant ceux du
  // tronçon, les sommets sont partagés, et il n'y a plus rien à cacher.
  const foot = halfWidth;
  const lip = halfWidth + gutterWidth;

  const section = [
    // Le recouvrement de la chaussée, au ras du bitume.
    { across: foot, up: -0.004, color: tones.gutter },
    // Le fil d'eau.
    { across: halfWidth + gutterWidth * 0.55, up: -gutterDepth, color: gutterEdge },
    // Le pied de bordure.
    { across: lip, up: -0.008, color: tones.gutter },
    // La face de bordure, verticale : c'est elle qui porte l'ombre.
    { across: lip, up: kerbHeight, color: kerbFace },
    // Le nez, chanfreiné.
    { across: lip + kerbNose, up: kerbHeight + 0.004, color: tones.kerb },
    // Le dessus du trottoir, en contre-pente vers le caniveau.
    { across: lip + kerbNose + walkWidth, up: kerbHeight + 0.004 + walkFall, color: tones.walk },
    // La jupe arrière, enterrée : un bord de trottoir en l'air se voit de loin.
    { across: lip + kerbNose + walkWidth + skirtWidth, up: -skirtDepth, color: tones.joint },
  ];

  const signed = section.map((vertex) => ({ ...vertex, across: vertex.across * side }));
  return side >= 0 ? signed : signed.reverse();
}

/** Décalage et demi-largeur de la bande revêtue, pour l'index publié (l'herbe ne pousse pas au travers du trottoir). */
export function pavementBand({ halfWidth, walkWidth, side }, streets = defaultTheme.streets) {
  const inner = halfWidth;
  const outer = halfWidth + streets.gutterWidth + streets.kerbNose + walkWidth;
  return { offset: side * ((inner + outer) / 2), halfWidth: (outer - inner) / 2 };
}

/**
 * Largeur de trottoir qui tient dans la place disponible, en mètres, ou zéro.
 *
 * `room` est la place libre au-delà de la rive (`edgeClearance`). Le caniveau,
 * le nez de bordure et la jupe arrière la prennent d'abord : ce sont des cotes
 * de la section, elles ne se négocient pas. Ce qui reste est le trottoir, et
 * il est plafonné à ce que le lieu voulait lui donner.
 *
 * La jupe compte comme une marge : enterrée, elle peut passer sous
 * l'accotement d'en face, mais lui laisser sa largeur évite qu'un trottoir
 * meure à ras du bitume voisin.
 *
 * @param {number} room     Place libre au-delà de la rive, en mètres.
 * @param {number} wanted   Largeur voulue par le lieu (`walkWidthAt`).
 * @param {Object} [streets] Tranche `theme.streets`.
 * @returns {number} zéro si le trottoir le plus étroit du thème n'y tient pas.
 */
export function walkWidthFor(room, wanted, streets = defaultTheme.streets) {
  const fixed = streets.gutterWidth + streets.kerbNose + streets.skirtWidth;
  const available = room - fixed;
  if (!(available >= streets.walkWidth[0])) return 0;
  return Math.min(wanted, available);
}

export class StreetLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} [options.theme] Direction artistique.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.mesh = null;
    this.geometry = null;
    /** Portions de trottoir posées lors de la dernière reconstruction. */
    this.count = 0;
    /** Bandes de hachures posées dans les vides de faisceau. */
    this.fills = 0;
    /** Traversées piétonnes peintes aux bouches de carrefour. */
    this.crossings = 0;
    /** Bande revêtue, au format de `RoadIndex` (l'herbe l'interroge comme la chaussée). @type {RoadIndex|null} */
    this.index = null;

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Le décalage de profondeur ne sert plus à arbitrer un recouvrement de
      // six centimètres du caniveau sur la chaussée — il n'y en a plus, les
      // deux partagent leurs sommets. Il protège le **comblement**, qui est
      // posé au ras du sol entre deux rives, comme la chaussée elle-même :
      // mêmes valeurs qu'elle, pour que les deux se tiennent pareil.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.material.name = 'streets';

    // Le marquage a sa matière à lui, et une seule raison de l'avoir : il est
    // peint **sur** la chaussée, donc il doit gagner contre elle en
    // profondeur, là où le trottoir est posé à côté d'elle et ne doit rien
    // gagner du tout. Mêmes valeurs que le marquage de `roadNetwork`, dont il
    // est la suite : une traversée et une ligne d'effet se touchent.
    this.markingMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.markingMaterial.name = 'street-markings';
    /** @type {Object|null} */
    this.markingMesh = null;
  }

  /**
   * Recompose la voirie à partir des tronçons de chaussée et de ce que la
   * géographie dit du lieu.
   *
   * @param {Array} roadSegments Tronçons publiés par `RoadNetwork`.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Object} [context]
   * @param {Array} [context.builtUp] Emprises habitées (`collectBuiltUpAreas`).
   * @param {Object} [context.fabric] `FabricIndex` du bâti publié.
   * @param {Object} [context.roadIndex] `RoadIndex` des chaussées : c'est lui
   *        qui dit combien de place il reste au-delà d'une rive.
   * @param {Object} [context.areas] `JunctionAreas` : les surfaces de
   *        carrefour, qui arrêtent les rives de tronçon et fournissent les
   *        coins de rue.
   * @returns {boolean} vrai si de la voirie a été posée.
   */
  rebuild(
    roadSegments = [],
    here = { x: 0, z: 0 },
    { builtUp = [], fabric = null, roadIndex = null, areas = null } = {}
  ) {
    if (this.disposed || !this.bubble?.frame) return false;

    const buffer = createProfileBuffer();
    const marks = createProfileBuffer();
    const bands = [];
    // Les bouches atteintes par un trottoir, côté par côté : une traversée se
    // peint là où il y en a un **des deux** côtés, et nulle part ailleurs.
    const mouths = new Map();
    let built = 0;

    // Sans emprise habitée ni bâti relevé, la couche ne pose rien.
    if (builtUp.length > 0 && fabric && fabric.count > 0) {
      const context = { here, builtUp, fabric, roadIndex, areas, mouths };
      for (const segment of roadSegments) {
        if (!STREET_PROFILES.has(segment.profile)) continue;
        built += this._buildSegment(buffer, bands, segment, context);
      }
      // Les coins de rue, après les tronçons : ils bordent la même rive, mais
      // le morceau que porte le carrefour, pas celui que porte une chaussée.
      built += this._buildCorners(buffer, bands, context);
    }

    // Les traversées, une fois les deux rives connues.
    this.crossings = this._buildCrossings(marks, mouths, areas);

    // La bande revêtue est publiée avant le comblement, parce que le
    // comblement l'interroge : là où un trottoir tient, il vaut mieux qu'un
    // zébra, et un vide déjà occupé n'est plus un vide.
    this.index = bands.length > 0 ? new RoadIndex(bands, { margin: 0 }) : null;

    // Les vides de faisceau, partout — un longement de piste cyclable n'attend
    // pas d'être en bourg pour laisser deux mètres d'herbe au milieu du bitume.
    this.fills = this._buildFills(buffer, roadSegments, here, roadIndex, areas);

    this.count = built;
    this._apply(buffer);
    this._applyMarkings(marks);
    return built > 0 || this.fills > 0;
  }

  /**
   * Comble les vides de faisceau : les entre-deux trop étroits entre deux
   * chaussées qui se longent (voir `roadBundles`).
   *
   * @returns {number} bandes de hachures posées.
   */
  _buildFills(buffer, roadSegments, here, roadIndex, areas) {
    if (!roadIndex || !Array.isArray(roadSegments) || roadSegments.length === 0) return 0;
    const roads = this.theme.roads;
    const paint = srgb(roads.markingColor);
    const ground = srgb(roads.surfaces.asphalt.base);
    const pavement = this.index;

    // Seules les chaussées revêtues font un faisceau : entre une route et le
    // chemin de terre qui la longe, il n'y a pas de vide de construction, il y
    // a de l'herbe.
    const paved = (segment) => {
      const profile = roads.profiles[segment.profile];
      return !!profile && (profile.surface || 'asphalt') === 'asphalt';
    };
    // Une chaîne peut faire neuf cents mètres : c'est une ligne sur dix qui
    // décide qu'elle est à portée, pas son premier point.
    const nearby = (segment) => {
      const path = segment.path;
      for (let r = 0; r < path.length; r += 10) {
        if (Math.hypot(path[r].x - here.x, path[r].z - here.z) <= STREET_RADIUS_M) return true;
      }
      return false;
    };
    const inReach = roadSegments.filter(
      (segment) => paved(segment) && segment.path?.length > 1 && nearby(segment)
    );

    let bands = 0;
    const gaps = collectRoadGaps(inReach, {
      roadIndex,
      areas,
      accept: paved,
      taken: pavement ? (x, z) => pavement.covers(x, z) : null,
    });
    for (const gap of gaps) {
      bands += appendZebra(buffer, gap, {
        paint,
        ground,
        lift: ROAD_LIFT_M,
        startDistance: gap.a.startDistance || 0,
      });
    }
    return bands;
  }

  /** Les deux côtés d'un tronçon. @returns {number} portions posées. */
  _buildSegment(buffer, bands, segment, { here, builtUp, fabric, roadIndex, areas, mouths }) {
    const { path, platform, edges, probeSpan, halfWidth } = segment;
    const rows = path.length;
    if (rows < 2 || !platform || !edges) return 0;

    const frames = segment.frames;
    const streets = this.theme.streets;
    const junction = segment.junction;
    let built = 0;

    // Périmètre et devers ne dépendent pas du côté : une seule lecture pour les deux.
    const shared = [];
    for (let r = 0; r < rows; r++) {
      const point = path[r];
      // Hors de portée, on ne lit rien (le lancer de rayon sur les emprises coûte trop cher).
      const inReach = Math.hypot(point.x - here.x, point.z - here.z) <= STREET_RADIUS_M;
      shared.push({
        r,
        x: point.x,
        z: point.z,
        inReach,
        // Une ligne prise par un carrefour n'a pas de rive à elle : c'est la
        // surface commune qui borde, et son coin de rue qui sera bordé.
        inJunction: junction ? junction[r] >= 0 : false,
        builtUp: inReach && pointInAreas(builtUp, point.x, point.z),
        slope: inReach ? crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan).slope : 0,
      });
    }

    for (const side of [1, -1]) {
      // Place libre au-delà de la rive, ligne par ligne : mesurée une fois,
      // relue par la qualification et par la largeur du trottoir.
      const room = new Float32Array(rows).fill(-1);
      const roomAt = (row) => {
        if (room[row.r] >= 0) return room[row.r];
        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];
        const at = side * halfWidth;
        const value = edgeClearance(row.x + px * at, row.z + pz * at, {
          roadIndex,
          areas,
          level: segment.levels?.[row.r] ?? 0,
          // Sa propre chaussée n'est pas un obstacle pour sa propre bordure.
          ignore: (other) => other === segment,
        });
        room[row.r] = value;
        return value;
      };

      const qualifies = (row) => {
        if (!row.inReach || !row.builtUp || row.inJunction) return false;
        if (Math.abs(row.slope) > STREET_MAX_CROSS_SLOPE) return false;

        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];
        // Il faut d'abord que le trottoir le plus étroit du thème y tienne.
        if (walkWidthFor(roomAt(row), streets.walkWidth[1], streets) <= 0) return false;

        // Disque de lecture du bâti, posé du côté examiné.
        const reach = side * (halfWidth + STREET_PROBE_M);
        return kerbQualifies({
          builtUp: true,
          buildings: fabric.countWithin(
            row.x + px * reach,
            row.z + pz * reach,
            STREET_FABRIC_RADIUS_M,
            STREET_FABRIC_MIN
          ),
          crossSlope: row.slope,
        });
      };

      for (const run of contiguousRuns(shared, qualifies, 1)) {
        const rail = this._railFor(segment, run, areas);
        if (polylineLength(rail.points) < STREET_MIN_LENGTH_M) continue;
        if (mouths) StreetLayer._noteMouths(mouths, segment, run, side, areas);
        // La largeur tient au point le plus à l'étroit de la portion : une
        // section constante ne peut pas déborder ailleurs qu'à son minimum.
        let narrowest = Infinity;
        for (const row of run) narrowest = Math.min(narrowest, roomAt(row));

        this._appendKerb(buffer, bands, {
          points: rail.points,
          decks: rail.decks,
          frames: rail.frames,
          side,
          halfWidth,
          room: narrowest,
          streets,
        });
        built++;
      }
    }

    return built;
  }

  /**
   * Le rail d'une portion : ses points, sa plate-forme et ses repères, avec
   * les deux bouts posés **sur le contour du carrefour** quand la portion y
   * bute. Sans ce prolongement, la bordure s'arrêterait à la dernière ligne de
   * ré-échantillonnage, jusqu'à cinq mètres avant la bouche où son ruban, lui,
   * s'arrête pile.
   */
  _railFor(segment, run, areas) {
    const { path, platform, frames } = segment;
    const points = [];
    const decks = [];
    const rows = [];

    const first = run[0].r;
    const last = run[run.length - 1].r;

    const head = areas ? junctionBoundaryAt(segment, areas, first, first - 1) : null;
    if (head) {
      points.push({ x: head.point.x, z: head.point.z });
      decks.push(head.deck);
      rows.push(first);
    }
    for (const row of run) {
      points.push({ x: path[row.r].x, z: path[row.r].z });
      decks.push(platform[row.r]);
      rows.push(row.r);
    }
    const tail = areas ? junctionBoundaryAt(segment, areas, last, last + 1) : null;
    if (tail) {
      points.push({ x: tail.point.x, z: tail.point.z });
      decks.push(tail.deck);
      rows.push(last);
    }

    // Le sommet ajouté emprunte le repère de la ligne dont il prolonge la
    // marche : la bouche est perpendiculaire à la branche, la tangente n'y a
    // pas bougé.
    const out = new Float64Array(rows.length * 4);
    for (let i = 0; i < rows.length; i++) {
      for (let k = 0; k < 4; k++) out[i * 4 + k] = frames[rows[i] * 4 + k];
    }
    return { points, decks: Float32Array.from(decks), frames: out };
  }

  /**
   * Relève les bouches de carrefour qu'une portion de trottoir vient toucher.
   *
   * Une portion touche une bouche par ses **bouts**, et seulement par eux :
   * c'est là que le trottoir s'arrête parce que la surface du carrefour prend
   * le relais (lot D). Le relevé est fait par côté, et la clé retient la
   * section — le couple (ligne gardée, ligne écartée) —, pas seulement le
   * carrefour : une chaussée qui traverse un carrefour y a deux bouches, et
   * elles ne se confondent pas.
   */
  static _noteMouths(mouths, segment, run, side, areas) {
    if (!areas) return;
    const rows = segment.path.length;
    const first = run[0].r;
    const last = run[run.length - 1].r;

    for (const [keep, drop] of [
      [first, first - 1],
      [last, last + 1],
    ]) {
      if (drop < 0 || drop >= rows) continue;
      const index = segment.junction?.[drop] ?? -1;
      if (index < 0) continue;
      const key = `${index}:${keep}:${drop}`;
      let entry = mouths.get(key);
      if (!entry) {
        entry = { segment, keep, drop, sides: new Set() };
        mouths.set(key, entry);
      }
      entry.sides.add(side);
    }
  }

  /**
   * Les traversées piétonnes.
   *
   * Une traversée ne se pose pas parce qu'un carrefour existe : elle se pose
   * là où **un trottoir arrive des deux côtés** de la chaussée, ce qui est
   * exactement ce qu'un piéton traverse d'un trottoir à l'autre. C'est la
   * raison pour laquelle elle est ici et non dans `roadNetwork` : la chaussée
   * ne sait pas ce qui la borde, la voirie si — et elle vient de le décider.
   *
   * Elle occupe la profondeur que la chaussée lui a réservée à la bouche
   * (`MOUTH_CROSSING_M`), en deçà de la ligne d'effet et non dessus.
   *
   * @returns {number} traversées peintes.
   */
  _buildCrossings(buffer, mouths, areas) {
    if (!areas || !mouths || mouths.size === 0) return 0;
    const roads = this.theme.roads;
    const paint = srgb(roads.markingColor);
    let painted = 0;

    for (const entry of mouths.values()) {
      // Les deux côtés, sans quoi il n'y a pas de traversée mais un trottoir
      // qui s'arrête devant un carrefour.
      if (entry.sides.size < 2) continue;

      const { segment, keep, drop } = entry;
      const spec = roads.profiles[segment.profile];
      const half = segment.halfWidth - (spec?.shoulder || 0);
      if (!(half > 0)) continue;

      const edge = junctionBoundaryAt(segment, areas, keep, drop);
      if (!edge) continue;

      // S'éloigner du carrefour, c'est aller vers la ligne gardée.
      const sign = keep < drop ? -1 : 1;
      const near = {
        x: edge.point.x,
        z: edge.point.z,
        deck: edge.deck,
        px: segment.frames[keep * 4 + 2],
        pz: segment.frames[keep * 4 + 3],
      };
      const far = sectionAtDistance(
        segment.path,
        segment.platform,
        segment.frames,
        edge.point.distance + sign * MOUTH_CROSSING_M
      );
      // Deux carrefours si proches que la traversée n'a pas la place de tenir
      // entre eux : elle ne se peint pas, plutôt que de déborder sur l'autre.
      if (!far) continue;

      const bands = appendCrossing(buffer, {
        near,
        far,
        halfWidth: half,
        color: paint,
        lift: ROAD_LIFT_M + MARKING_LIFT_M,
      });
      if (bands > 0) painted++;
    }

    return painted;
  }

  /**
   * Les coins de rue : les morceaux de rive qu'un carrefour ajoute entre deux
   * bouches consécutives.
   *
   * Mêmes conditions qu'ailleurs (bourg, bâti, place disponible), posées au
   * milieu du morceau — une seule règle, évaluée sur chaque morceau de la
   * frontière de la chaussée, quel que soit ce qui le porte. Le devers n'y est
   * pas mesuré : un carrefour est dressé à plat par la couture des
   * plate-formes, il n'a pas de pente en travers à lui.
   *
   * @returns {number} coins posés.
   */
  _buildCorners(buffer, bands, { here, builtUp, fabric, roadIndex, areas }) {
    if (!areas || areas.length === 0) return 0;
    const streets = this.theme.streets;
    let built = 0;

    for (let index = 0; index < areas.areas.length; index++) {
      const area = areas.areas[index];
      // Sans cote, l'aire est hors de portée du réseau : rien n'y est posé.
      if (!Number.isFinite(area.deck)) continue;
      if (!STREET_PROFILES.has(area.profile)) continue;
      if (Math.hypot(area.x - here.x, area.z - here.z) > STREET_RADIUS_M) continue;

      for (const edge of area.edges || []) {
        const points = edge.points;
        if (!Array.isArray(points) || points.length < 2) continue;
        const mid = points[Math.floor(points.length / 2)];
        if (!pointInAreas(builtUp, mid.x, mid.z)) continue;

        const probe = streets.gutterWidth + streets.kerbNose;
        const room = edgeClearance(
          mid.x + edge.outward.x * probe,
          mid.z + edge.outward.z * probe,
          {
            roadIndex,
            areas,
            level: area.level,
            // Ni le carrefour qu'on borde, ni les chaussées dont il est fait :
            // la bordure d'un coin est tangente à leurs rives par construction.
            ignore: (segment) => areas.feeds(index, segment),
            ignoreArea: (other) => other === index,
          }
        );
        const wanted = walkWidthAt(mid.x, mid.z, streets);
        const walkWidth = walkWidthFor(room, wanted, streets);
        if (walkWidth <= 0) continue;

        const buildings = fabric.countWithin(
          mid.x + edge.outward.x * STREET_PROBE_M,
          mid.z + edge.outward.z * STREET_PROBE_M,
          STREET_FABRIC_RADIUS_M,
          STREET_FABRIC_MIN
        );
        if (!kerbQualifies({ builtUp: true, buildings, crossSlope: 0 })) continue;

        const side = outwardSide(points, edge.outward);
        const decks = new Float32Array(points.length).fill(area.deck);
        this._appendKerb(buffer, bands, {
          points,
          decks,
          frames: null,
          side,
          // Le morceau **est** la rive : la section se compte depuis zéro, et
          // non depuis la demi-largeur d'une chaussée.
          halfWidth: 0,
          room,
          streets,
          walkWidth,
        });
        built++;
      }
    }

    return built;
  }

  /** Une portion continue de bordure et son trottoir. */
  _appendKerb(buffer, bands, { points, decks, frames, side, halfWidth, room, streets, walkWidth = null }) {
    // Largeur et revêtement tirés au premier point de la portion (ancrés au
    // sol) puis ramenés à ce qui tient dans la place disponible.
    const anchor = points[0];
    const width = walkWidth ?? walkWidthFor(room, walkWidthAt(anchor.x, anchor.z, streets), streets);
    if (width <= 0) return;
    const tones = streetSurfaceAt(anchor.x, anchor.z, streets);

    appendProfile(buffer, {
      path: points,
      profile: kerbProfile({ halfWidth, walkWidth: width, side, tones }, streets),
      sampleElevation: null,
      baseHeights: decks,
      lift: ROAD_LIFT_M,
      frames,
      // Déjà lissée par `collectRoadSegments` : relisser arrondirait la bordure aux carrefours.
      smoothRadius: 0,
    });

    const band = pavementBand({ halfWidth, walkWidth: width, side }, streets);
    const used = frames || pathFrames(points);
    bands.push({
      path: points.map((point, i) => ({
        x: point.x + used[i * 4 + 2] * band.offset,
        z: point.z + used[i * 4 + 3] * band.offset,
      })),
      halfWidth: band.halfWidth,
    });
  }

  _apply(buffer) {
    const { THREE } = this;
    const geometry = toColoredGeometry(THREE, buffer);

    if (!geometry) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh = null;
        this.geometry = null;
      }
      return;
    }

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'streets';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometry;
  }

  /** Le marquage de la voirie, dans son maillage à lui : ce n'est pas la même matière. */
  _applyMarkings(buffer) {
    const { THREE } = this;
    const geometry = toColoredGeometry(THREE, buffer);

    if (!geometry) {
      if (this.markingMesh) {
        this.scene.remove(this.markingMesh);
        this.markingMesh.geometry.dispose();
        this.markingMesh = null;
      }
      return;
    }

    if (this.markingMesh) {
      this.markingMesh.geometry.dispose();
      this.markingMesh.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.markingMaterial);
    mesh.name = 'street-markings';
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.markingMesh = mesh;
  }

  /**
   * Mouille trottoirs et caniveaux (un peu moins sombre que la chaussée : une
   * dalle boit l'eau, le bitume la garde en surface).
   * @param {number} value De 0 (sec) à 1 (trempé).
   */
  setWetness(value) {
    const wet = Math.min(1, Math.max(0, value || 0));
    const shade = 1 - wet * 0.3;
    this.material.color.setRGB(shade, shade, shade + wet * 0.04);
    this.markingMaterial.color.setRGB(shade, shade, shade + wet * 0.04);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.index = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
      this.geometry = null;
    }
    if (this.markingMesh) {
      this.scene.remove(this.markingMesh);
      this.markingMesh.geometry.dispose();
      this.markingMesh = null;
    }
    this.material.dispose();
    this.markingMaterial.dispose();
  }
}
