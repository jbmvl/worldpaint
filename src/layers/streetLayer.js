/*
 * streetLayer — bordures en béton et caniveaux des rues habitées.
 * Le support porte tout le sol piéton : aucune dalle ni jupe ne le recouvre.
 * Le béton a une section constante, son dessus suit le support ; le caniveau
 * incliné rejoint la rive exacte de la chaussée, avec les repères du réseau.
 * Les joints suivent les dalles ; une ligne sombre marque le pied du béton.
 * En ville, le masque urbain suffit ; dans les villages, le bâti confirme
 * chaque côté. Les bouches interrompent les bordures, les coins les prolongent.
 * Les traversées lisent les deux rives ; les comblements lisent leur emprise.
 */
import { finishGeneration } from '../core/generationSteps.js';
import { appendProfile, createProfileBuffer, pathFrames, toColoredGeometry } from './ribbonGeometry.js';
import { ajouterJointsVoirie } from './streetMasonry.js';
import { ROAD_LIFT_M } from './roadNetwork.js';
import { RoadIndex } from './roadGraph.js';
import { contiguousRuns, crossSlope, STEEP_CROSS_SLOPE } from './furniturePlacement.js';
import { pointInAreas } from './settlement.js';
import { edgeClearance, outwardSide, polylineLength } from './roadEdges.js';
import { junctionBoundaryAt, outlineDeckAt } from './roadJunctions.js';
import { appendGapSurface, appendZebra, collectRoadGaps, gapIsSeam } from './roadBundles.js';
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
 * Vrai si un côté de chaussée mérite sa bordure, à cet endroit.
 * @param {Object} context
 * @param {boolean} context.builtUp    La ligne est dans une emprise habitée.
 * @param {boolean} context.urban      Le masque urbain autorise les deux rives.
 * @param {number} context.buildings   Bâtiments comptés du côté examiné.
 * @param {number} context.crossSlope  Pente en travers, sans dimension.
 * @returns {boolean}
 */
export function kerbQualifies({ builtUp = false, urban = false, buildings = 0, crossSlope = 0 } = {}) {
  if (urban) return true;
  if (!builtUp) return false;
  if (buildings < STREET_FABRIC_MIN) return false;
  return Math.abs(crossSlope) <= STREET_MAX_CROSS_SLOPE;
}

/** Section du caniveau et du béton ; les hauteurs sont relatives au support. */
export function kerbProfile({ halfWidth, side, tones }, streets = defaultTheme.streets) {
  const lip = halfWidth + streets.gutterWidth;
  const outer = lip + streets.kerbWidth;
  const section = [
    { across: halfWidth, up: 0, color: tones.gutter },
    { across: lip - Math.min(streets.contactWidth || 0, streets.gutterWidth), up: 0, color: tones.gutter },
    { across: lip - Math.min(streets.contactWidth || 0, streets.gutterWidth), up: 0, color: tones.joint },
    { across: lip, up: 0, color: tones.joint },
    { across: lip, up: 0, color: tones.kerb },
    { across: outer, up: 0, color: tones.kerb },
    { across: outer, up: -streets.kerbHeight, color: tones.kerb },
    { across: lip, up: -streets.kerbHeight, color: tones.kerb },
  ];
  const signed = section.map((vertex) => ({ ...vertex, across: vertex.across * side }));
  return side >= 0 ? signed : signed.reverse();
}

/** Seuls le caniveau et le béton excluent les plantes et les clôtures. */
export function pavementBand({ halfWidth, side }, streets = defaultTheme.streets) {
  const width = streets.gutterWidth + streets.kerbWidth;
  return { offset: side * (halfWidth + width / 2), halfWidth: width / 2 };
}

/** La section en béton ne se rétrécit pas entre deux chaussées. */
export function kerbFits(room, streets = defaultTheme.streets) {
  return room >= streets.gutterWidth + streets.kerbWidth;
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
      // Les comblements partagent le décalage de profondeur des chaussées.
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
   * @param {Object} [context.urban] Masque urbain publié par la composition.
   * @returns {boolean} vrai si de la voirie a été posée.
   */
  rebuild(...args) { return finishGeneration(this.rebuildSteps(...args)); }

  /** `rebuild` en étapes : une par tronçon et par carrefour, maillages publiés à la fin. */
  *rebuildSteps(
    roadSegments = [],
    here = { x: 0, z: 0 },
    { builtUp = [], fabric = null, roadIndex = null, areas = null, urban = null } = {}
  ) {
    if (this.disposed || !this.bubble?.frame) return false;

    const buffer = createProfileBuffer();
    const marks = createProfileBuffer();
    const bands = [];
    // Les bouches atteintes par un trottoir, côté par côté : une traversée se
    // peint là où il y en a un **des deux** côtés, et nulle part ailleurs.
    const mouths = new Map();
    let built = 0;

    // Le masque urbain reste utilisable même si le relevé du bâti est incomplet.
    if (builtUp.length > 0 || urban?.any) {
      const context = { here, builtUp, fabric, roadIndex, areas, mouths, urban };
      for (const segment of roadSegments) {
        if (!STREET_PROFILES.has(segment.profile)) continue;
        built += this._buildSegment(buffer, bands, segment, context);
        yield;
      }
      // Les coins de rue, après les tronçons : ils bordent la même rive, mais
      // le morceau que porte le carrefour, pas celui que porte une chaussée.
      built += yield* this._buildCorners(buffer, bands, context);
    }

    // Les traversées, une fois les deux rives connues.
    this.crossings = this._buildCrossings(marks, mouths, areas);
    yield;

    // La bande revêtue est publiée avant le comblement, parce que le
    // comblement l'interroge : là où un trottoir tient, il vaut mieux qu'un
    // zébra, et un vide déjà occupé n'est plus un vide.
    this.index = bands.length > 0 ? new RoadIndex(bands, { margin: 0 }) : null;

    // Les vides de faisceau, partout — un longement de piste cyclable n'attend
    // pas d'être en bourg pour laisser deux mètres d'herbe au milieu du bitume.
    this.fills = this._buildFills(buffer, roadSegments, here, roadIndex, areas);
    yield;

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
      // Une couture — deux chaussées du même profil, donc les deux sens d'une
      // même route — se comble en revêtement plein. Le zébra dirait « ne
      // roulez pas ici », ce qui est faux, et ses hachures couvriraient le
      // marquage, qui est la seule chose qui rende un boulevard lisible.
      if (gapIsSeam(gap)) {
        bands += appendGapSurface(buffer, gap, { color: ground, lift: ROAD_LIFT_M });
        continue;
      }
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
  _buildSegment(buffer, bands, segment, { here, builtUp, fabric, roadIndex, areas, mouths, urban }) {
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
        urban: inReach && !!urban?.covers(point.x, point.z),
        slope: inReach ? crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan).slope : 0,
      });
    }

    for (const side of [1, -1]) {
      // Place libre au-delà de la rive, ligne par ligne : mesurée une fois,
      // relue par la qualification et par la largeur du trottoir.
      const room = new Float64Array(rows).fill(-1);
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
        if (!row.inReach || (!row.builtUp && !row.urban) || row.inJunction || segment.works?.[row.r]) return false;
        if (!row.urban && Math.abs(row.slope) > STREET_MAX_CROSS_SLOPE) return false;

        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];
        // Le caniveau et la bordure doivent tenir ensemble.
        if (!kerbFits(roomAt(row), streets)) return false;

        // Disque de lecture du bâti, posé du côté examiné.
        const reach = side * (halfWidth + STREET_PROBE_M);
        return kerbQualifies({
          builtUp: row.builtUp,
          urban: row.urban,
          buildings: fabric?.countWithin(
            row.x + px * reach,
            row.z + pz * reach,
            STREET_FABRIC_RADIUS_M,
            STREET_FABRIC_MIN
          ) ?? 0,
          crossSlope: row.slope,
        });
      };

      for (const run of contiguousRuns(shared, qualifies, 1)) {
        const rail = this._railFor(segment, run, areas);
        if (polylineLength(rail.points) <= 0) continue;
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
      points.push({ ...head.point, distance: head.point.distance + (segment.startDistance || 0) });
      decks.push(head.deck);
      rows.push(first);
    }
    for (const row of run) {
      points.push({ ...path[row.r], distance: path[row.r].distance + (segment.startDistance || 0) });
      decks.push(platform[row.r]);
      rows.push(row.r);
    }
    const tail = areas ? junctionBoundaryAt(segment, areas, last, last + 1) : null;
    if (tail) {
      points.push({ ...tail.point, distance: tail.point.distance + (segment.startDistance || 0) });
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
   * Même qualification que les tronçons. Le caniveau lit les cotes de la
   * dalle sommet par sommet ; le béton lit celles du support.
   *
   * @returns {number} coins posés.
   */
  *_buildCorners(buffer, bands, { here, builtUp, fabric, roadIndex, areas, urban }) {
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
        const inTown = !!urban?.covers(mid.x, mid.z);
        if (!inTown && !pointInAreas(builtUp, mid.x, mid.z)) continue;

        const room = edgeClearance(
          mid.x,
          mid.z,
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
        if (!kerbFits(room, streets)) continue;

        const buildings = fabric?.countWithin(
          mid.x + edge.outward.x * STREET_PROBE_M,
          mid.z + edge.outward.z * STREET_PROBE_M,
          STREET_FABRIC_RADIUS_M,
          STREET_FABRIC_MIN
        ) ?? 0;
        if (!kerbQualifies({ builtUp: true, urban: inTown, buildings, crossSlope: 0 })) continue;

        const side = outwardSide(points, edge.outward);
        // Sommet par sommet, comme la dalle : sur un versant, un coin de rue
        // relie deux bouches qui ne sont pas à la même hauteur, et une bordure
        // posée à plat y ferait une marche contre l'une des deux.
        const decks = Float32Array.from(points, (point) => {
          const deck = area.decks ? outlineDeckAt(point, area.decks) : area.deck;
          // Une branche hors de portée du réseau n'a pas de cote : le coin
          // retombe sur celle du nœud plutôt que de porter un `NaN`.
          return Number.isFinite(deck) ? deck : area.deck;
        });
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
        });
        built++;
      }
      yield;
    }

    return built;
  }

  /** Le caniveau relie la chaussée au support, le béton reste affleurant. */
  _appendKerb(buffer, bands, { points, decks, frames, side, halfWidth, room, streets }) {
    if (!kerbFits(room, streets)) return;
    const anchor = points[0];
    const tones = streetSurfaceAt(anchor.x, anchor.z, streets);
    const profile = kerbProfile({ halfWidth, side, tones }, streets);
    const used = frames || pathFrames(points);
    const start = buffer.positions.length;
    appendProfile(buffer, {
      path: points, profile, baseHeights: decks, lift: 0,
      frames: used, smoothRadius: 0,
    });
    for (let r = 0; r < points.length; r++) {
      const pied = side * (halfWidth + streets.gutterWidth);
      const supportPied = this.bubble.surfaceElevationAtLocal(
        points[r].x + used[r * 4 + 2] * pied,
        points[r].z + used[r * 4 + 3] * pied
      ) * this.bubble.verticalScale + 0.003;
      for (let c = 0; c < profile.length; c++) {
        const at = start + (r * profile.length + c) * 3;
        const vertex = profile[c];
        const largeur = Math.abs(vertex.across) - halfWidth;
        if (largeur <= streets.gutterWidth && vertex.up === 0) {
          const t = largeur / streets.gutterWidth;
          buffer.positions[at + 1] = (decks[r] + ROAD_LIFT_M) * (1 - t) + supportPied * t;
        } else {
          const ground = this.bubble.surfaceElevationAtLocal(
            buffer.positions[at], buffer.positions[at + 2]
          ) * this.bubble.verticalScale;
          // Décollement millimétrique pour éviter la concurrence avec le support.
          buffer.positions[at + 1] = ground + 0.003 + vertex.up;
        }
      }
    }
    ajouterJointsVoirie(buffer, {
      debut: start, points, profil: profile, demiLargeur: halfWidth, style: streets, couleur: tones.joint,
    });
    const band = pavementBand({ halfWidth, side }, streets);
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
