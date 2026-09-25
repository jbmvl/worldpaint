/*
 * railwayLayer — les voies ferrées : ballast et deux rails, balayés le long
 * des tronçons `transportation` dont `class === 'rail'` (`roadNetwork` les
 * ignore déjà, `ROAD_CLASSES` n'a pas d'entrée `rail`).
 *
 * Le ballast est un ruban texturé (`appendRibbon` + `createRoadCanvas`,
 * revêtement `ballast`), comme une chaussée — pas une section colorée, qui
 * rendait une bande plate sans grain. Les rails, eux, restent une section
 * colorée (fils d'acier fins, pas de surface à texturer).
 *
 * Publie son propre `RoadIndex` (comme `streetLayer`), transmis au mobilier
 * par `worldComposer` pour qu'aucun objet ne se pose sur la voie, et les voies
 * de circulation (`tracks`, cote de la voie relevée comprise) que
 * `trainLayer` fait parcourir : les tronçons recousus par `mergeRoadLines`
 * par-delà les bords de tuile, voies de service (garage, faisceau,
 * embranchement) exclues.
 *
 * Ces mêmes voies portent une caténaire : un poteau à potence tous les
 * `CATENARY_SPAN_M` (voir `catenaryMasts` pour ce qui fixe leur position), un
 * fil de contact qui suit la voie et un porteur qui pend entre deux poteaux.
 * Les tuiles ne disent pas si une ligne est électrifiée : toute voie hors
 * service en porte une.
 *
 * Simplification assumée : la voie n'entaille pas le terrain (pas de
 * plate-forme, déblai/remblai, mur) — le ballast suit le MNT point par point,
 * relevé de `RAILWAY_LIFT_M`, comme un cours d'eau linéaire. Lui donner les
 * mêmes ouvrages que `roadNetwork` reste à faire.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import {
  resamplePath,
  createProfileBuffer,
  appendProfile,
  createRibbonBuffer,
  appendRibbon,
  pathFrames,
  toColoredGeometry,
  toGeometry,
} from './ribbonGeometry.js';
import { createRoadCanvas, ROAD_TEXTURE_LENGTH } from '../materials/proceduralTextures.js';
import { RoadIndex, ROAD_INDEX_MARGIN_M, knownCoverage, mergeRoadLines } from './roadGraph.js';
import { defaultTheme } from '../themes/default.js';
import { Kit } from '../models/kit.js';

/** Couche source des tuiles vectorielles — celle des chaussées aussi. */
export const RAILWAY_SOURCE_LAYER = 'transportation';
/** Portée maximale autour de l'observateur, en mètres. */
export const RAILWAY_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const RAILWAY_REBUILD_M = 250;
/** Pas de ré-échantillonnage le long d'une voie, en mètres. */
export const RAILWAY_SAMPLE_M = 6;
/** Demi-écartement des rails, en mètres — proche de la voie normale (1,435 m). */
export const RAILWAY_GAUGE_HALF_M = 0.72;
/** Demi-largeur du ballast, rails compris — c'est aussi la demi-largeur du corridor. */
export const RAILWAY_BALLAST_HALF_M = 1.75;
/** Relèvement de toute la voie (ballast, rails, voies des trains) au-dessus du MNT, en mètres. */
export const RAILWAY_LIFT_M = 0.4;

/** Hauteur du dessus du rail au-dessus du ballast relevé, en mètres (voir `railProfileFor`). */
export const RAILWAY_RAIL_TOP_M = 0.22;
/** Portée entre deux poteaux de caténaire, en mètres. */
export const CATENARY_SPAN_M = 54;
/** Écart du poteau à l'axe de la voie, en mètres — hors du ballast. */
export const CATENARY_MAST_OFFSET_M = 2.8;
/** Hauteurs au-dessus du rail : fil de contact, porteur aux appuis, flèche du porteur. */
export const CATENARY_CONTACT_M = 5.5;
export const CATENARY_MESSENGER_M = 6.7;
export const CATENARY_SAG_M = 0.9;

/** Section d'un fil de caténaire. Fonction pure du nuancier. */
export function catenaryWireProfile(C = defaultTheme.furniture.colors) {
  return [
    { across: -0.025, up: 0, color: C.steelDark },
    { across: 0, up: 0.025, color: C.steelDark },
    { across: 0.025, up: 0, color: C.steelDark },
    { across: 0, up: -0.025, color: C.steelDark },
  ];
}

/**
 * Poteaux d'une voie recousue : un tous les `CATENARY_SPAN_M`, comptés depuis
 * le point de la voie le plus proche de `origin` (l'origine du repère de la
 * bulle). Ni les bouts de la voie chargée ni le sens de la polyligne ne
 * déplacent un poteau. Fonction pure.
 *
 * @returns {Array<{x:number, z:number, tx:number, tz:number, s:number}>}
 *          Position, tangente unitaire dans le sens normalisé, abscisse.
 */
export function catenaryMasts(points, origin = { x: 0, z: 0 }) {
  if (!Array.isArray(points) || points.length < 2) return [];
  let best = Infinity;
  let bestSegment = 0;
  let bestT = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-12;
    const t = Math.min(1, Math.max(0, ((origin.x - a.x) * dx + (origin.z - a.z) * dz) / len2));
    const d = Math.hypot(a.x + dx * t - origin.x, a.z + dz * t - origin.z);
    if (d < best) {
      best = d;
      bestSegment = i;
      bestT = t;
    }
  }
  const ta = points[bestSegment];
  const tb = points[bestSegment + 1];
  const flip = Math.abs(tb.x - ta.x) > 1e-6 ? tb.x < ta.x : tb.z < ta.z;
  const path = flip ? points.slice().reverse() : points;
  const segment = flip ? points.length - 2 - bestSegment : bestSegment;
  const t = flip ? 1 - bestT : bestT;

  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  const length = distances[distances.length - 1];
  const ref = distances[segment] + (distances[segment + 1] - distances[segment]) * t;

  const masts = [];
  let i = 0;
  for (let k = Math.ceil(-ref / CATENARY_SPAN_M); ref + k * CATENARY_SPAN_M <= length; k++) {
    const at = ref + k * CATENARY_SPAN_M;
    while (i < path.length - 2 && distances[i + 1] < at) i++;
    const a = path[i];
    const b = path[i + 1];
    const span = distances[i + 1] - distances[i] || 1e-6;
    const f = Math.min(1, Math.max(0, (at - distances[i]) / span));
    masts.push({
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      tx: (b.x - a.x) / span,
      tz: (b.z - a.z) / span,
      s: at,
      path,
      distances,
    });
  }
  return masts;
}

/** Points d'une polyligne entre deux abscisses, au pas `step`, bornes comprises. */
function pathBetween(path, distances, from, to, step) {
  const out = [];
  const count = Math.max(1, Math.ceil((to - from) / step));
  let i = 0;
  for (let n = 0; n <= count; n++) {
    const at = from + ((to - from) * n) / count;
    while (i < path.length - 2 && distances[i + 1] < at) i++;
    const span = distances[i + 1] - distances[i] || 1e-6;
    const f = Math.min(1, Math.max(0, (at - distances[i]) / span));
    out.push({
      x: path[i].x + (path[i + 1].x - path[i].x) * f,
      z: path[i].z + (path[i + 1].z - path[i].z) * f,
      distance: at - from,
    });
  }
  return out;
}

/**
 * Pose la caténaire d'une voie recousue : poteaux et potences dans `kit`, fil
 * de contact et porteur dans `wires`. `track` est la voie ré-échantillonnée
 * (publiée dans `tracks`), `sampleElevation` rend la cote du ballast relevé.
 * Un poteau se met du côté que le ballast d'une autre voie (`index`) laisse
 * libre, et manque quand aucun ne l'est — une voie médiane de faisceau ; le
 * porteur ne se tend qu'entre deux poteaux posés.
 */
export function appendCatenary(kit, wires, chain, track, sampleElevation, colors, wireProfile, index = null) {
  appendProfile(wires, {
    path: track,
    profile: wireProfile,
    sampleElevation,
    lift: RAILWAY_RAIL_TOP_M + CATENARY_CONTACT_M,
    closed: true,
  });

  let previous = null;
  for (const mast of catenaryMasts(chain)) {
    // Normale à gauche du sens normalisé, comme `pathFrames`.
    const nx = mast.tz;
    const nz = -mast.tx;
    const side = [1, -1].find((s) => !index?.covers(
      mast.x + nx * s * CATENARY_MAST_OFFSET_M,
      mast.z + nz * s * CATENARY_MAST_OFFSET_M,
      0.3
    ));
    if (!side) {
      previous = null;
      continue;
    }
    const px = nx * side;
    const pz = nz * side;
    const yaw = Math.atan2(mast.tx, mast.tz);
    const rail = sampleElevation(mast.x, mast.z) + RAILWAY_RAIL_TOP_M;
    const mx = mast.x + px * CATENARY_MAST_OFFSET_M;
    const mz = mast.z + pz * CATENARY_MAST_OFFSET_M;
    const foot = sampleElevation(mx, mz) - RAILWAY_LIFT_M - 0.3;
    kit.box({ width: 0.24, height: rail + CATENARY_MESSENGER_M + 0.4 - foot, depth: 0.24, x: mx, y: foot, z: mz, yaw, color: colors.steel });
    // Potence : deux bras jusqu'à l'aplomb de la voie, au porteur et au fil de contact.
    const ax = mast.x + px * CATENARY_MAST_OFFSET_M * 0.5;
    const az = mast.z + pz * CATENARY_MAST_OFFSET_M * 0.5;
    for (const h of [CATENARY_MESSENGER_M, CATENARY_CONTACT_M]) {
      kit.box({ width: CATENARY_MAST_OFFSET_M + 0.2, height: 0.1, depth: 0.1, x: ax, y: rail + h - 0.05, z: az, yaw, color: colors.steelDark });
    }

    // Porteur : une parabole depuis le poteau précédent, qui suit la courbe de la voie.
    if (previous) {
      const curve = pathBetween(mast.path, mast.distances, previous.s, mast.s, RAILWAY_SAMPLE_M);
      const heights = new Float32Array(curve.length);
      for (let r = 0; r < curve.length; r++) {
        const t = r / (curve.length - 1);
        heights[r] = sampleElevation(curve[r].x, curve[r].z) + RAILWAY_RAIL_TOP_M
          + CATENARY_MESSENGER_M - CATENARY_SAG_M * 4 * t * (1 - t);
      }
      appendProfile(wires, { path: curve, profile: wireProfile, sampleElevation, baseHeights: heights, closed: true, smoothRadius: 0 });
    }
    previous = mast;
  }
}

/** Section balayée d'un seul rail : un fil d'acier en léger relief. Fonction pure du nuancier. */
export function railProfileFor(C = defaultTheme.furniture.colors) {
  return [
    { across: -0.07, up: 0.1, color: C.rock },
    { across: -0.03, up: 0.22, color: C.steelDark },
    { across: 0.03, up: 0.22, color: C.steelDark },
    { across: 0.07, up: 0.1, color: C.rock },
  ];
}

export class RailwayLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.railProfile = railProfileFor(theme.furniture.colors);
    this.wireProfile = catenaryWireProfile(theme.furniture.colors);

    // Ballast texturé comme une chaussée (revêtement `ballast` du thème, sans accotement ni ligne peinte).
    const canvas = createRoadCanvas(
      { width: RAILWAY_BALLAST_HALF_M * 2, texture: 64, surface: 'ballast' },
      theme.roads
    );
    this.ballastTexture = new THREE.CanvasTexture(canvas);
    this.ballastTexture.colorSpace = THREE.SRGBColorSpace;
    this.ballastTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.ballastTexture.wrapT = THREE.RepeatWrapping;
    this.ballastTexture.anisotropy = 8;
    this.ballastMaterial = new THREE.MeshLambertMaterial({
      map: this.ballastTexture,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.ballastMaterial.name = 'railway-ballast';

    this.railMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.railMaterial.name = 'railway-rail';

    this.group = new THREE.Group();
    this.group.name = 'railway';
    scene.add(this.group);

    this.ballastMesh = null;
    this.ballastGeometry = null;
    this.railMesh = null;
    this.railGeometry = null;
    this.catenaryMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.catenaryMaterial.name = 'railway-catenary';
    this.catenaryMesh = null;
    this.count = 0;
    this._anchor = null;
    this._frame = null;

    /** Emprise ferroviaire, au même format que celle des routes (`RoadIndex`). @type {Object|null} */
    this.index = null;
    /** Voies parcourues par les trains, altitude du sol comprise. @type {Array<Array<{x,y,z}>>} */
    this.tracks = [];
  }

  /**
   * Part d'un rectangle sur laquelle la voie a quelque chose à dire — même
   * contrat que `RoadNetwork.knownCoverageOf`, avec le rayon effectivement
   * parcouru (voir `rebuild`).
   */
  knownCoverageOf(minX, minZ, maxX, maxZ) {
    if (this._frame !== this.bubble?.frame) return 0;
    const radius = Math.min(RAILWAY_RADIUS_M, this.bubble?.radiusMeters || RAILWAY_RADIUS_M);
    return knownCoverage(minX, minZ, maxX, maxZ, this._anchor, radius);
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= RAILWAY_REBUILD_M;
  }

  /**
   * Reconstruit la voie depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si quelque chose a été posé.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const radius = Math.min(RAILWAY_RADIUS_M, this.bubble.radiusMeters || RAILWAY_RADIUS_M);
    const { origin, scale, zoom } = this.bubble.frame;
    const sampleElevation = (x, z) =>
      this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale + RAILWAY_LIFT_M;

    const ballastBuffer = createRibbonBuffer();
    const railBuffer = createProfileBuffer();
    /** @type {Array<{path: Array, halfWidth: number}>} pour l'index de corridor. */
    const segments = [];
    const mainLines = [];
    const colors = this.theme.furniture.colors;
    const masts = new Kit(colors);

    source.forEachFeature(RAILWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (properties.class !== 'rail') return;
      // Un tunnel n'a rien à faire en surface (un pont, faute de tablier
      // modélisé, suit simplement le terrain comme le reste de la voie).
      if (properties.brunnel === 'tunnel') return;

      const lines =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : [];

      for (const line of lines) {
        if (!Array.isArray(line) || line.length < 2) continue;
        const local = [];
        for (const [lng, lat] of line) {
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          local.push({
            x: (lngToTileX(lng, zoom) - origin.x) * scale,
            z: (latToTileY(lat, zoom) - origin.y) * scale,
          });
        }
        if (local.length < 2) continue;
        if (!local.some((p) => Math.hypot(p.x - here.x, p.z - here.z) <= radius)) continue;

        const path = resamplePath(local, RAILWAY_SAMPLE_M);
        if (path.length < 2) continue;

        appendRibbon(ballastBuffer, {
          path,
          halfWidth: RAILWAY_BALLAST_HALF_M,
          sampleElevation,
          textureLength: ROAD_TEXTURE_LENGTH,
          level: false, // suit le terrain point par point, voir l'en-tête
        });

        const frames = pathFrames(path);
        for (const side of [-1, 1]) {
          const rail = path.map((p, r) => ({
            x: p.x + frames[r * 4 + 2] * side * RAILWAY_GAUGE_HALF_M,
            z: p.z + frames[r * 4 + 3] * side * RAILWAY_GAUGE_HALF_M,
          }));
          appendProfile(railBuffer, {
            path: rail,
            profile: this.railProfile,
            sampleElevation,
            closed: true,
          });
        }

        segments.push({ path, halfWidth: RAILWAY_BALLAST_HALF_M });
        if (!properties.service) {
          mainLines.push({ profile: 'rail', halfWidth: RAILWAY_BALLAST_HALF_M, points: local });
        }
      }
    });

    // Plafond à la construction ; la marge réelle se choisit par requête (voir `RoadIndex.query`).
    this.index = segments.length > 0 ? new RoadIndex(segments, { margin: ROAD_INDEX_MARGIN_M }) : null;
    this.tracks = [];
    for (const chain of mergeRoadLines(mainLines).chains) {
      const track = resamplePath(chain.points, RAILWAY_SAMPLE_M);
      if (track.length < 2) continue;
      appendCatenary(masts, railBuffer, chain.points, track, sampleElevation, colors, this.wireProfile, this.index);
      this.tracks.push(track.map((p) => ({ x: p.x, y: sampleElevation(p.x, p.z), z: p.z })));
    }

    this._apply(ballastBuffer, railBuffer);
    this._applyCatenary(masts);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return this.count > 0;
  }

  _apply(ballastBuffer, railBuffer) {
    const { THREE } = this;

    const ballastGeometry = toGeometry(THREE, ballastBuffer);
    const railGeometry = toColoredGeometry(THREE, railBuffer);
    this.count = ballastBuffer.indices.length / 3;

    if (!ballastGeometry) {
      if (this.ballastMesh) {
        this.group.remove(this.ballastMesh);
        this.ballastMesh.geometry.dispose();
        this.ballastMesh = null;
      }
      this.ballastGeometry = null;
    } else if (this.ballastMesh) {
      this.ballastMesh.geometry.dispose();
      this.ballastMesh.geometry = ballastGeometry;
      this.ballastGeometry = ballastGeometry;
    } else {
      this.ballastMesh = new THREE.Mesh(ballastGeometry, this.ballastMaterial);
      this.ballastMesh.name = 'railway';
      this.ballastMesh.matrixAutoUpdate = false;
      this.ballastMesh.updateMatrix();
      this.group.add(this.ballastMesh);
      this.ballastGeometry = ballastGeometry;
    }

    if (!railGeometry) {
      if (this.railMesh) {
        this.group.remove(this.railMesh);
        this.railMesh.geometry.dispose();
        this.railMesh = null;
      }
      this.railGeometry = null;
    } else if (this.railMesh) {
      this.railMesh.geometry.dispose();
      this.railMesh.geometry = railGeometry;
      this.railGeometry = railGeometry;
    } else {
      this.railMesh = new THREE.Mesh(railGeometry, this.railMaterial);
      this.railMesh.name = 'railway';
      this.railMesh.matrixAutoUpdate = false;
      this.railMesh.updateMatrix();
      this.group.add(this.railMesh);
      this.railGeometry = railGeometry;
    }
  }

  _applyCatenary(kit) {
    if (this.catenaryMesh) {
      this.group.remove(this.catenaryMesh);
      this.catenaryMesh.geometry.dispose();
      this.catenaryMesh = null;
    }
    if (kit.vertexCount === 0) return;
    this.catenaryMesh = new this.THREE.Mesh(kit.toGeometry(this.THREE, 'railway-catenary'), this.catenaryMaterial);
    this.catenaryMesh.name = 'railway-catenary';
    this.catenaryMesh.matrixAutoUpdate = false;
    this.catenaryMesh.updateMatrix();
    this.group.add(this.catenaryMesh);
  }

  dispose() {
    this.disposed = true;
    this.catenaryMesh?.geometry.dispose();
    this.catenaryMaterial.dispose();
    this.catenaryMesh = null;
    this.ballastMesh?.geometry.dispose();
    this.railMesh?.geometry.dispose();
    this.ballastMaterial.dispose();
    this.railMaterial.dispose();
    this.ballastTexture.dispose();
    this.scene.remove(this.group);
    this.ballastMesh = null;
    this.railMesh = null;
    this.ballastGeometry = null;
    this.railGeometry = null;
  }
}
