/*
 * waterLayer — lacs, rivières et bras de mer.
 * --------------------------------------------
 * Les tuiles vectorielles portent déjà tout ce qu'il faut : la couche `water`
 * donne les surfaces (polygones), la couche `waterway` les cours d'eau trop
 * étroits pour en être un (lignes). Rien de plus à télécharger.
 *
 * Une seule chose est vraiment délicate, et elle décide de tout : **l'eau est
 * horizontale**. Posée sur le MNT comme le sont la route ou le terrain, une
 * surface d'eau remonterait les collines et un lac deviendrait une nappe
 * bosselée. Chaque surface est donc plaquée à une altitude unique, et chaque
 * section transversale de rivière à la sienne — un cours d'eau descend le long
 * de son cours, jamais en travers.
 *
 * L'altitude retenue est le **minimum** rencontré, jamais la moyenne : une
 * nappe posée à la hauteur moyenne de ses berges les recouvrirait.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { resamplePath, createRibbonBuffer, appendRibbon } from './ribbonGeometry.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';

/** Couches source des tuiles vectorielles. */
export const WATER_SOURCE_LAYER = 'water';
export const WATERWAY_SOURCE_LAYER = 'waterway';

/** Portée autour de l'observateur, en mètres. */
export const WATER_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const WATER_REBUILD_M = 250;
/** Pas de ré-échantillonnage le long d'un cours d'eau, en mètres. */
export const WATER_SAMPLE_M = 8;
/**
 * Enfoncement de la nappe sous l'altitude minimale trouvée, en mètres. Le MNT
 * lit à peu près le niveau de l'eau au-dessus d'un lac ; un léger enfoncement
 * garantit que la berge émerge au lieu de se disputer le pixel avec la nappe.
 */
export const WATER_SINK_M = 0.15;
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;
/**
 * Mètres couverts par un cycle de la carte de rides. Les coordonnées de texture
 * sont prises dans le **monde** et non sur la surface : une nappe triangulée
 * n'a pas de paramétrage naturel, et une projection monde garantit en prime que
 * les rides ne s'étirent pas sur les grands lacs.
 */
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

/**
 * Vrai si une surface d'eau doit être dessinée. Les piscines sont écartées :
 * à cette échelle elles produisent des confettis bleus dans les jardins.
 * Fonction pure.
 */
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
 * Vrai si la boîte englobante d'un anneau rencontre le carré de portée.
 *
 * Un test sur les seuls sommets serait faux dans le cas qui compte le plus :
 * un grand lac dont l'observateur longe la rive a tous ses sommets hors de portée
 * et devrait pourtant être dessiné. Fonction pure.
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

/** Matériau d'eau, avec ses rides animées. */
export function createWaterMaterial(THREE) {
  const normalMap = new THREE.CanvasTexture(createWaterNormalCanvas());
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  // La répétition est portée par les coordonnées de texture, calculées en
  // mètres monde : rien à régler ici.
  normalMap.repeat.set(1, 1);

  const material = new THREE.MeshPhongMaterial({
    color: 0x2f5f78,
    specular: 0xbfe4f2,
    shininess: 96,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    // Légèrement translucide : on devine le fond près de la berge, ce qui
    // adoucit la ligne de contact avec le terrain.
    transparent: true,
    opacity: 0.88,
    // L'eau reste une surface : elle doit s'écrire dans la profondeur, sinon
    // les arbres de la rive lui passeraient au travers.
    depthWrite: true,
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
  }

  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= WATER_REBUILD_M;
  }

  /**
   * Reconstruit surfaces et cours d'eau depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si de l'eau a été produite.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const mesh = { positions: [], normals: [], uvs: [] };

    this._appendPolygons(source, tiles, here, mesh);
    this._appendWaterways(source, tiles, here, mesh);

    this.count = mesh.positions.length / 9;
    this._apply(mesh);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
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

  _appendPolygons(source, tiles, here, mesh) {
    const { THREE, bubble } = this;
    let built = 0;

    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (built >= WATER_MAX_POLYGONS) return;
      if (!isDrawableWater(properties)) return;

      for (const rings of waterPolygons(geometry)) {
        if (built >= WATER_MAX_POLYGONS) break;
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const outer = this._toLocal(rings[0]);
        if (outer.length < 3) continue;
        if (!boundsIntersect(outer, here.x, here.z, WATER_RADIUS_M)) continue;

        // La mer est à zéro par définition : lui chercher un minimum sur un
        // polygone qui couvre plusieurs tuiles n'aurait aucun sens.
        let level;
        if (properties.class === 'ocean') {
          level = 0;
        } else {
          level = Infinity;
          for (const p of outer) {
            const ground = bubble.surfaceElevationAtLocal(p.x, p.z) * bubble.verticalScale;
            if (ground < level) level = ground;
          }
          if (!Number.isFinite(level)) continue;
          level -= WATER_SINK_M;
        }

        const contour = outer.map((p) => new THREE.Vector2(p.x, p.z));
        const holes = [];
        for (let i = 1; i < rings.length; i++) {
          const hole = this._toLocal(rings[i]);
          if (hole.length >= 3) holes.push(hole.map((p) => new THREE.Vector2(p.x, p.z)));
        }

        // Triangulation par oreilles : une géométrie dégénérée la fait échouer,
        // et un lac manquant vaut mieux qu'une scène sans eau.
        let faces = [];
        try {
          faces = THREE.ShapeUtils.triangulateShape(contour, holes) || [];
        } catch (e) {
          faces = [];
        }
        if (faces.length === 0) continue;

        // `triangulateShape` indexe le contour puis les trous, bout à bout.
        const all = contour.concat(...holes);
        // Ordre inversé : notre plan (x, z) est de chiralité opposée au plan
        // (x, y) usuel, donc l'ordre naturel donnerait une nappe qui regarde
        // vers le bas.
        for (const [i0, i1, i2] of faces) {
          for (const index of [i0, i2, i1]) {
            const p = all[index];
            if (!p) continue;
            this._vertex(mesh, p.x, level, p.y);
          }
        }
        built++;
      }
    });
  }

  _appendWaterways(source, tiles, here, mesh) {
    const { bubble } = this;
    const buffer = createRibbonBuffer();
    const sampleElevation = (x, z) => bubble.surfaceElevationAtLocal(x, z, 0) * bubble.verticalScale;

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
        if (!boundsIntersect(local, here.x, here.z, WATER_RADIUS_M)) continue;

        const path = resamplePath(local, WATER_SAMPLE_M);
        if (path.length < 2) continue;
        appendRibbon(buffer, {
          path,
          halfWidth: style.halfWidth,
          sampleElevation,
          lift: -WATER_SINK_M,
          flatCrossSection: true,
          // Une rivière suit le terrain réel, contrairement à la chaussée qui
          // se dresse de niveau : sans ce `level: false`, `appendRibbon`
          // planterait tout le lit à l'altitude par défaut de `levelRow`.
          level: false,
          // Fenêtre longue : un cours d'eau ne monte pas et ne descend pas par
          // à-coups, même quand le MNT le prétend.
          smoothRadius: 4,
        });
      }
    });

    // Le ruban vit dans un accumulateur indexé ; la nappe, elle, est en
    // triangles nus. On déplie plutôt que de mêler deux conventions.
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
    // Sans coordonnées de texture, la carte de rides ne serait jamais
    // échantillonnée et l'eau redeviendrait un plan bleu uni.
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
      // Après le terrain et les chaussées : la nappe est translucide, elle doit
      // se composer sur ce qui est déjà là.
      mesh.renderOrder = 2;
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
