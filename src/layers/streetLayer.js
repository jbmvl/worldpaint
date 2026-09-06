/*
 * streetLayer — la voirie : caniveau, bordure, trottoir. Ce qui distingue une
 * route de campagne d'une rue de village n'est pas le revêtement, c'est la
 * bordure. Cette couche compose donc, le long des chaussées qui le méritent :
 *
 *     chaussée │ caniveau │ bordure │ trottoir │ jupe
 *              └ creux    └ marche  └ plat     └ enterré
 *
 * Pas de trottoir sur simple `landuse=residential` (qui contient aussi prés
 * et chemins non bordés) : trois conditions tenues ensemble, ligne par ligne
 * et côté par côté — la chaussée s'y prête (desserte/traversée, pas voie
 * rapide/chemin/sentier), le périmètre l'autorise (emprise habitée), le bâti
 * le confirme (`FabricIndex`, pour distinguer une traversée de bourg de la
 * route qui longe le stade du même bourg). S'ajoutent : pas de trottoir sur
 * devers marqué (déjà un mur côté mobilier), et pas de trottoir empiétant sur
 * une chaussée voisine (sondé à l'endroit réel, sa propre chaussée exceptée).
 *
 * Chaque côté est jugé séparément sur un disque de bâti centré à 15 m de
 * l'axe : une rue bâtie d'un seul côté n'a de trottoir que de ce côté, et le
 * critère ne dépend que de coordonnées au sol (stable au découpage).
 *
 * Le trottoir reçoit le `platform` du tronçon et le décollement exact de la
 * chaussée (`roadLiftFor`) : il ne peut pas diverger de la rue, même sur un
 * dos-d'âne ou un raccord de carrefour.
 */

import { appendProfile, createProfileBuffer, toColoredGeometry } from './ribbonGeometry.js';
import { roadLiftFor } from './roadNetwork.js';
import { RoadIndex } from './roadGraph.js';
import { contiguousRuns, crossSlope, randomAt, STEEP_CROSS_SLOPE } from './furniturePlacement.js';
import { pointInAreas } from './settlement.js';
import { inCorridor } from './roadCorridor.js';
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
/** Lignes contiguës exigées : en deçà, c'est un artefact du découpage. */
export const STREET_MIN_RUN = 5;

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

  const foot = halfWidth - 0.06; // léger recouvrement : pas de fente à la rive
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
 * Vrai si le trottoir de ce côté-ci empiéterait sur une autre chaussée
 * (fréquent quand deux rues se longent ou se rejoignent en Y). Sondé là où le
 * trottoir irait réellement, sa propre chaussée exceptée, sur la bande la
 * plus large qu'il pourrait porter (refuser un trottoir de trop est le seul
 * sens d'erreur qui ne se voit pas). Interroge la chaussée stricte, pas
 * l'emprise : une jupe qui mord l'accotement voisin est enterrée, invisible.
 *
 * @param {Object} at Point de l'axe (`x`, `z`), sa perpendiculaire (`px`, `pz`),
 *        la demi-largeur de la chaussée, le côté, et le tronçon qui la porte.
 * @param {Object|null} roadIndex `RoadIndex` des chaussées.
 * @param {Object} [streets] Section `streets` du thème.
 * @returns {boolean}
 */
export function pavementOnOtherRoad(
  { x, z, px, pz, halfWidth, side, segment = null },
  roadIndex,
  streets = defaultTheme.streets
) {
  if (!roadIndex) return false;
  const band = pavementBand({ halfWidth, walkWidth: streets.walkWidth[1], side }, streets);
  const others = segment ? (other) => other !== segment : null;
  const inner = band.offset - side * band.halfWidth;
  const outer = band.offset + side * band.halfWidth;
  for (const offset of [inner, band.offset, outer]) {
    if (inCorridor(roadIndex, x + px * offset, z + pz * offset, 0, others)) return true;
  }
  return false;
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
    /** Bande revêtue, au format de `RoadIndex` (l'herbe l'interroge comme la chaussée). @type {RoadIndex|null} */
    this.index = null;

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Le caniveau recouvre volontairement la rive de la chaussée de six cm ;
      // le décalage de profondeur tranche en faveur de la bordure.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.material.name = 'streets';
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
   * @param {Object} [context.roadIndex] `RoadIndex` des chaussées : un trottoir
   *        ne se pose pas sur la rue d'à côté.
   * @returns {boolean} vrai si de la voirie a été posée.
   */
  rebuild(
    roadSegments = [],
    here = { x: 0, z: 0 },
    { builtUp = [], fabric = null, roadIndex = null } = {}
  ) {
    if (this.disposed || !this.bubble?.frame) return false;

    const buffer = createProfileBuffer();
    const bands = [];
    let built = 0;

    // Sans emprise habitée ni bâti relevé, la couche ne pose rien.
    if (builtUp.length > 0 && fabric && fabric.count > 0) {
      for (const segment of roadSegments) {
        if (!STREET_PROFILES.has(segment.profile)) continue;
        built += this._buildSegment(buffer, bands, segment, here, builtUp, fabric, roadIndex);
      }
    }

    this.count = built;
    this.index = bands.length > 0 ? new RoadIndex(bands, { margin: 0 }) : null;
    this._apply(buffer);
    return built > 0;
  }

  /** Les deux côtés d'un tronçon. @returns {number} portions posées. */
  _buildSegment(buffer, bands, segment, here, builtUp, fabric, roadIndex = null) {
    const { path, platform, edges, probeSpan, halfWidth, profile } = segment;
    const rows = path.length;
    if (rows < STREET_MIN_RUN || !platform || !edges) return 0;

    const frames = segment.frames;
    const lift = roadLiftFor(profile);
    const streets = this.theme.streets;
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
        builtUp: inReach && pointInAreas(builtUp, point.x, point.z),
        slope: inReach ? crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan).slope : 0,
      });
    }

    for (const side of [1, -1]) {
      const qualifies = (row) => {
        if (!row.inReach || !row.builtUp) return false;
        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];

        const onRoad = pavementOnOtherRoad(
          { x: row.x, z: row.z, px, pz, halfWidth, side, segment },
          roadIndex,
          streets
        );
        if (onRoad) return false;

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

      for (const run of contiguousRuns(shared, qualifies, STREET_MIN_RUN)) {
        this._appendKerb(buffer, bands, { run, segment, side, lift, streets, halfWidth });
        built++;
      }
    }

    return built;
  }

  /** Une portion continue de bordure et son trottoir. */
  _appendKerb(buffer, bands, { run, segment, side, lift, streets, halfWidth }) {
    const { platform } = segment;
    const runPath = run.map((row) => ({ x: row.x, z: row.z }));
    const deck = new Float32Array(run.map((row) => platform[row.r]));

    // Largeur et revêtement tirés au premier point de la portion (ancrés au sol).
    const anchor = run[0];
    const walkWidth = walkWidthAt(anchor.x, anchor.z, streets);
    const tones = streetSurfaceAt(anchor.x, anchor.z, streets);

    appendProfile(buffer, {
      path: runPath,
      profile: kerbProfile({ halfWidth, walkWidth, side, tones }, streets),
      sampleElevation: null,
      baseHeights: deck,
      lift,
      // Déjà lissée par `collectRoadSegments` : relisser arrondirait la bordure aux carrefours.
      smoothRadius: 0,
    });

    const band = pavementBand({ halfWidth, walkWidth, side }, streets);
    const frames = segment.frames;
    bands.push({
      path: run.map((row, i) => {
        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];
        return {
          x: runPath[i].x + px * band.offset,
          z: runPath[i].z + pz * band.offset,
        };
      }),
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

  /**
   * Mouille trottoirs et caniveaux (un peu moins sombre que la chaussée : une
   * dalle boit l'eau, le bitume la garde en surface).
   * @param {number} value De 0 (sec) à 1 (trempé).
   */
  setWetness(value) {
    const wet = Math.min(1, Math.max(0, value || 0));
    const shade = 1 - wet * 0.3;
    this.material.color.setRGB(shade, shade, shade + wet * 0.04);
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
    this.material.dispose();
  }
}
