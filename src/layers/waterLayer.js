/*
 * waterLayer — lacs, rivières et bras de mer, tirés des couches `water`
 * (polygones) et `waterway` (lignes trop étroites pour un polygone).
 *
 * L'eau est horizontale : chaque surface est plaquée à une altitude unique
 * (chaque section de rivière à la sienne), sinon elle remonterait les
 * collines. L'altitude retenue est un quantile bas du terrain — ni la
 * moyenne (poserait la nappe sous ses berges), ni le minimum (un seul point
 * aberrant enterrerait tout un lac) — lu sur le contour et une grille
 * intérieure (`waterSurfaceLevel`).
 *
 * Le long d'un cours d'eau linéaire, le profil est rendu monotone vers
 * l'aval (`monotoneDownstream`) : une rivière ne remonte pas, ce qui vaut
 * mieux qu'un lissage par moyenne (relève les passages encaissés au-dessus
 * de leurs propres berges).
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import {
  resamplePath,
  createRibbonBuffer,
  appendRibbon,
  pathFrames,
  monotoneDownstream,
} from './ribbonGeometry.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { WaterIndex } from './waterIndex.js';
import { pointInRing } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/** Couches source des tuiles vectorielles. */
export const WATER_SOURCE_LAYER = 'water';
export const WATERWAY_SOURCE_LAYER = 'waterway';

/** Portée maximale autour de l'observateur, en mètres (plafond ; `rebuild` la resserre sur le rayon réel de la bulle). */
export const WATER_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const WATER_REBUILD_M = 250;
/** Pas de ré-échantillonnage le long d'un cours d'eau, en mètres. */
export const WATER_SAMPLE_M = 8;
/**
 * Enfoncement d'un cours d'eau linéaire sous l'altitude trouvée, en mètres.
 * Ne concerne plus les nappes (creusées dans une cuvette, `waterCut`) : un
 * cours d'eau linéaire (1,2 à 9 m de large) ne peut pas être creusé sans
 * refaire l'échec du fossé de route — cette marge reste sa seule protection.
 */
export const WATER_SINK_M = 0.15;
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;
/** Nombre maximal de points échantillonnés à l'intérieur d'un polygone pour en tirer l'altitude (voir `interiorSamples`). */
export const WATER_LEVEL_MAX_SAMPLES = 200;
/** Rang du quantile qui décide de l'altitude d'une nappe (voir `waterSurfaceLevel`). */
export const WATER_LEVEL_QUANTILE = 0.05;
/** Mètres couverts par un cycle de la carte de rides (coordonnées de texture prises dans le monde, pas sur la surface). */
export const WATER_UV_SCALE_M = 12;

/**
 * Demi-largeur d'un cours d'eau linéaire, ou `null` s'il ne doit pas être
 * dessiné. Un cours d'eau souterrain n'a pas de surface ; un cours d'eau
 * intermittent, la plupart du temps, non plus. Fonction pure.
 */
export function waterwayStyleFor(properties = {}, waterways = defaultTheme.water.waterways) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.intermittent === 1 || properties.intermittent === true) return null;
  const width = waterways[properties.class];
  return width ? { halfWidth: width / 2 } : null;
}

/** Vrai si une surface d'eau doit être dessinée (les piscines produisent des confettis bleus à cette échelle). */
export function isDrawableWater(properties = {}) {
  if (properties.brunnel === 'tunnel') return false;
  return properties.class !== 'swimming_pool';
}

/**
 * Anneaux d'une géométrie surfacique, contour puis trous.
 * @returns {Array<Array<Array<[number, number]>>>} une entrée par polygone.
 */
export function waterPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/**
 * Vrai si la boîte englobante d'un anneau rencontre le carré de portée
 * (un test sur les seuls sommets manquerait un grand lac longé par la rive).
 */
export function boundsIntersect(points, centerX, centerZ, radius) {
  if (!points.length) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return (
    minX <= centerX + radius &&
    maxX >= centerX - radius &&
    minZ <= centerZ + radius &&
    maxZ >= centerZ - radius
  );
}

/** Vrai si un point est dans le contour et hors de tous les trous (s'appuie sur `pointInRing`). */
export function pointInPolygon(x, z, outer, holes) {
  if (!pointInRing(outer, x, z)) return false;
  for (const hole of holes) {
    if (pointInRing(hole, x, z)) return false;
  }
  return true;
}

/**
 * Grille de points strictement intérieurs à un polygone. Le pas s'ajuste à la
 * surface de la boîte englobante pour tenir sous `maxSamples`. Ancrée sur
 * l'origine du repère local, pas sur la boîte englobante du polygone : deux
 * lacs voisins tirent leurs échantillons des mêmes lignes de grille.
 */
export function interiorSamples(outer, holes, maxSamples = WATER_LEVEL_MAX_SAMPLES) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (!(width > 0) || !(depth > 0)) return [];

  const step = Math.sqrt((width * depth) / maxSamples) || 1;
  const startX = Math.ceil(minX / step) * step;
  const startZ = Math.ceil(minZ / step) * step;

  const points = [];
  for (let z = startZ; z <= maxZ; z += step) {
    for (let x = startX; x <= maxX; x += step) {
      if (pointInPolygon(x, z, outer, holes)) points.push({ x, z });
    }
  }
  return points;
}

/**
 * Quantile bas d'une série, par interpolation linéaire entre les deux rangs
 * encadrants. Ne modifie pas le tableau reçu.
 *
 * @param {number[]} values Série quelconque, non triée.
 * @param {number} q        Rang visé, de 0 (minimum) à 1 (maximum).
 * @returns {number} `Infinity` si la série est vide.
 */
export function lowQuantile(values, q = WATER_LEVEL_QUANTILE) {
  if (!values.length) return Infinity;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Altitude retenue pour une nappe d'eau, lue sur le terrain affiché : contour,
 * trous et grille intérieure (pas le contour seul, qui ne dit rien du milieu
 * d'un grand lac). Un quantile bas, ni la moyenne ni le minimum : trop haut
 * perce la nappe par le fond (le défaut du contour seul), trop bas l'enterre
 * (le défaut du minimum dès qu'un point du MNT est bruité).
 *
 * `sampleGround` peut rendre `NaN` pour un point sans donnée : ignoré plutôt
 * que compté pour une altitude de zéro.
 *
 * @param {Array<{x:number,z:number}>} outer
 * @param {Array<Array<{x:number,z:number}>>} holes
 * @param {(x:number, z:number) => number} sampleGround
 * @returns {number} `Infinity` si aucun échantillon n'a de donnée.
 */
export function waterSurfaceLevel(outer, holes, sampleGround, maxInteriorSamples = WATER_LEVEL_MAX_SAMPLES) {
  const heights = [];
  const consider = (p) => {
    const h = sampleGround(p.x, p.z);
    if (Number.isFinite(h)) heights.push(h);
  };

  for (const p of outer) consider(p);
  for (const hole of holes) for (const p of hole) consider(p);
  for (const p of interiorSamples(outer, holes, maxInteriorSamples)) consider(p);

  return lowQuantile(heights);
}

/**
 * Profil d'altitude d'un cours d'eau linéaire, une valeur par ligne du ruban.
 * En travers, la section prend le plus bas de ce qu'elle rencontre (axe et
 * deux rives). Le long du cours, le profil est rendu monotone vers l'aval
 * (`monotoneDownstream`). `sampleElevation` peut rendre `NaN` hors des tuiles
 * chargées : une lacune est comblée par le dernier point connu (un plateau),
 * jamais par zéro (coucherait tout l'aval au niveau de la mer).
 *

 * @param {Array<{x:number,z:number}>} path Tracé déjà ré-échantillonné.
 * @param {number} halfWidth
 * @param {(x:number, z:number) => number} sampleElevation
 * @returns {Float32Array|null} une altitude par point, ou `null` si le tracé
 *          entier est sans donnée — auquel cas il n'y a rien à dessiner.
 */
export function waterwayProfile(path, halfWidth, sampleElevation) {
  const frames = pathFrames(path);
  const n = path.length;
  const raw = new Float32Array(n);

  for (let r = 0; r < n; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const { x, z } = path[r];
    let lowest = Infinity;
    for (const [sx, sz] of [
      [x, z],
      [x + px * halfWidth, z + pz * halfWidth],
      [x - px * halfWidth, z - pz * halfWidth],
    ]) {
      const h = sampleElevation(sx, sz);
      if (Number.isFinite(h) && h < lowest) lowest = h;
    }
    raw[r] = lowest;
  }

  if (!fillGaps(raw)) return null;
  return monotoneDownstream(raw);
}

/**
 * Comble sur place les valeurs non finies par le dernier voisin connu, dans
 * les deux sens. Rend faux si la série n'a aucune valeur exploitable.
 */
function fillGaps(values) {
  let known = null;
  for (let r = 0; r < values.length; r++) {
    if (Number.isFinite(values[r])) known = values[r];
    else if (known !== null) values[r] = known;
  }
  if (known === null) return false;

  known = null;
  for (let r = values.length - 1; r >= 0; r--) {
    if (Number.isFinite(values[r])) known = values[r];
    else values[r] = known;
  }
  return true;
}

/** Matériau d'eau, avec ses rides animées. */
export function createWaterMaterial(THREE) {
  const normalMap = new THREE.CanvasTexture(createWaterNormalCanvas());
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.repeat.set(1, 1); // répétition portée par les coordonnées de texture, en mètres monde

  const material = new THREE.MeshPhongMaterial({
    color: 0x2f5f78,
    specular: 0xbfe4f2,
    shininess: 96,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true, // légèrement translucide : on devine le fond près de la berge
    opacity: 0.88,
    depthWrite: true, // sinon les arbres de la rive lui passeraient au travers
    // Pas de décalage de profondeur, contrairement à la chaussée : la nappe
    // se tient 60 cm au-dessus d'un lit creusé pour elle (`waterCut`).
  });
  material.name = 'water';

  return {
    material,
    normalMap,
    /** Fait dériver les rides. Deux vitesses inégales : sinon on lit un glissement. */
    advance(seconds) {
      normalMap.offset.x = (normalMap.offset.x + seconds * 0.013) % 1;
      normalMap.offset.y = (normalMap.offset.y + seconds * 0.021) % 1;
    },
    dispose() {
      material.dispose();
      normalMap.dispose();
    },
  };
}

export class WaterLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble   Instance `TerrainBubble`.
   * @param {Object} options.material Matériau partagé (`createWaterMaterial`).
   */
  constructor({ THREE, scene, bubble, material, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.material = material;
    this.disposed = false;
    this.count = 0;
    this.mesh = null;
    this.geometry = null;
    this._anchor = null;
    this._frame = null;
    this._surface = -1;
    /** Cuvette publiée à l'usage du terrain (`WaterIndex`), ou `null` avant la première construction. @type {WaterIndex|null} */
    this.index = null;
  }

  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    // La maille a changé de finesse : le sol a pu monter sous une nappe calculée sur l'ancienne résolution.
    if (this._surface !== this.bubble?.surfaceGeneration) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= WATER_REBUILD_M;
  }

  /**
   * Reconstruit surfaces et cours d'eau depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si de l'eau a été produite.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    // La bulle rétrécit avec la latitude : sans ce plafond, l'eau pourrait se construire au-delà du relief chargé.
    const radius = Math.min(WATER_RADIUS_M, this.bubble.radiusMeters || WATER_RADIUS_M);

    const mesh = { positions: [], normals: [], uvs: [] };
    /** @type {Array<{rings: Array, level: number}>} nappes, pour la cuvette. */
    const surfaces = [];

    this._appendPolygons(source, tiles, here, radius, mesh, surfaces);
    this._appendWaterways(source, tiles, here, radius, mesh);

    // Seules les nappes entrent dans la cuvette (voir `waterCut`).
    this.index = new WaterIndex(surfaces);

    this.count = mesh.positions.length / 9;
    this._apply(mesh);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    this._surface = this.bubble.surfaceGeneration;
    return this.count > 0;
  }

  /** Passage lng/lat → mètres locaux. */
  _toLocal(ring) {
    const { origin, scale, zoom } = this.bubble.frame;
    const points = [];
    for (const [lng, lat] of ring) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      });
    }
    return points;
  }

  /** Ajoute un sommet, coordonnées de texture comprises. */
  _vertex(mesh, x, y, z) {
    mesh.positions.push(x, y, z);
    mesh.normals.push(0, 1, 0);
    mesh.uvs.push(x / WATER_UV_SCALE_M, z / WATER_UV_SCALE_M);
  }

  /**
   * @param {Array} surfaces Accumulateur des nappes retenues, pour la cuvette
   *        que le terrain viendra creuser (`WaterIndex`).
   */
  _appendPolygons(source, tiles, here, radius, mesh, surfaces) {
    const { THREE, bubble } = this;
    let built = 0;

    // Altitude naturelle, terrassements exclus (même raison que la
    // plate-forme d'une chaussée : la cuvette dérive du niveau de l'eau, pas
    // l'inverse). `NaN`, jamais 0, sur une tuile non chargée.
    const sampleGround = (x, z) => {
      const h = bubble.rawSurfaceElevationAtLocal(x, z, NaN);
      return Number.isFinite(h) ? h * bubble.verticalScale : NaN;
    };

    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (built >= WATER_MAX_POLYGONS) return;
      if (!isDrawableWater(properties)) return;

      for (const rings of waterPolygons(geometry)) {
        if (built >= WATER_MAX_POLYGONS) break;
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const outer = this._toLocal(rings[0]);
        if (outer.length < 3) continue;
        if (!boundsIntersect(outer, here.x, here.z, radius)) continue;

        const holeRings = [];
        for (let i = 1; i < rings.length; i++) {
          const hole = this._toLocal(rings[i]);
          if (hole.length >= 3) holeRings.push(hole);
        }

        // La mer est à zéro par définition (chercher un niveau sur un polygone multi-tuiles n'aurait pas de sens).
        let level;
        if (properties.class === 'ocean') {
          level = 0;
        } else {
          level = waterSurfaceLevel(outer, holeRings, sampleGround);
          if (!Number.isFinite(level)) continue;
        }

        const contour = outer.map((p) => new THREE.Vector2(p.x, p.z));
        const holes = holeRings.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.z)));

        // Triangulation par oreilles : un lac manquant vaut mieux qu'une géométrie dégénérée.
        let faces = [];
        try {
          faces = THREE.ShapeUtils.triangulateShape(contour, holes) || [];
        } catch (e) {
          faces = [];
        }
        if (faces.length === 0) continue;

        // `triangulateShape` indexe le contour puis les trous, bout à bout.
        const all = contour.concat(...holes);
        // Ordre inversé : chiralité opposée du plan (x, z), sinon la nappe regarderait vers le bas.
        for (const [i0, i1, i2] of faces) {
          for (const index of [i0, i2, i1]) {
            const p = all[index];
            if (!p) continue;
            this._vertex(mesh, p.x, level, p.y);
          }
        }

        // Déclarée après la triangulation seulement (une nappe refusée ne creuse pas de trou nu).
        surfaces.push({ rings: [outer, ...holeRings], level });
        built++;
      }
    });
  }

  _appendWaterways(source, tiles, here, radius, mesh) {
    const { bubble } = this;
    const buffer = createRibbonBuffer();
    // `NaN`, pas zéro : une lacune que `waterwayProfile` comble, pas une altitude propagée jusqu'à l'embouchure.
    const sampleElevation = (x, z) => bubble.surfaceElevationAtLocal(x, z, NaN) * bubble.verticalScale;

    source.forEachFeature(WATERWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
      const style = waterwayStyleFor(properties, this.theme.water.waterways);
      if (!style) return;

      const lines =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : [];

      for (const line of lines) {
        if (!Array.isArray(line) || line.length < 2) continue;
        const local = this._toLocal(line);
        if (local.length < 2) continue;
        if (!boundsIntersect(local, here.x, here.z, radius)) continue;

        const path = resamplePath(local, WATER_SAMPLE_M);
        if (path.length < 2) continue;

        const platform = waterwayProfile(path, style.halfWidth, sampleElevation);
        if (!platform) continue; // tracé entièrement hors des tuiles chargées

        appendRibbon(buffer, {
          path,
          halfWidth: style.halfWidth,
          sampleElevation,
          lift: -WATER_SINK_M,
          platform, // profil calculé puis imposé, comme la plate-forme de chaussée
          level: true,
          smoothRadius: 0, // sinon le lissage par défaut annulerait la monotonie imposée
        });
      }
    });

    // Le ruban vit dans un accumulateur indexé, la nappe en triangles nus : on déplie.
    const { positions: rp, indices } = buffer;
    for (const index of indices) {
      this._vertex(mesh, rp[index * 3], rp[index * 3 + 1], rp[index * 3 + 2]);
    }
  }

  _apply({ positions, normals, uvs }) {
    const { THREE } = this;
    if (positions.length === 0) {
      this._clearMesh();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'water';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      mesh.renderOrder = 2; // après le terrain et les chaussées : nappe translucide

      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometry;
  }

  _clearMesh() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.mesh = null;
    this.geometry = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearMesh();
  }
}
