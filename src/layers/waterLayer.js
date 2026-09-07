/*
 * waterLayer — lacs, rivières et bras de mer, tirés des couches `water`
 * (polygones) et `waterway` (lignes trop étroites pour un polygone).
 *
 * ## Pourquoi l'altitude de l'eau ne se calcule pas
 *
 * Deux tentatives ont échoué, et elles échouaient pour la même raison.
 * Creuser une cuvette sous chaque nappe ouvrait une gorge dès que le polygone
 * descendait une pente. Poser une nappe plane à un niveau tiré du MNT la
 * laissait quelques centimètres sous le sol — et une marge pour l'en sortir
 * n'aurait fait que la faire flotter ailleurs.
 *
 * La cause est dans la donnée : **le MNT ne décrit pas le fond d'un lac**.
 * Sous une nappe, l'altitude qu'il donne *est* la surface de l'eau. Terrain et
 * eau sont donc la même altitude, au bruit près, et aucune comparaison de
 * hauteurs ne peut dire lequel des deux l'emporte en un point : le résultat
 * n'est qu'un tirage au sort à l'échelle du pixel.
 *
 * ## Ce qui fonctionne : deux sources, deux questions
 *
 * L'étendue de l'eau ne se déduit pas du relief, elle est **dans la carte** —
 * c'est le polygone. Son altitude, elle, est **dans le MNT**. Chacun répond à
 * la question qu'il sait traiter :
 *
 *   - où y a-t-il de l'eau ? le polygone, et rien d'autre ;
 *   - à quelle hauteur ? le terrain, point par point.
 *
 * La nappe est donc **plaquée sur le terrain** : chaque sommet prend
 * l'altitude du sol sous lui, et un décalage de profondeur négatif lui donne
 * la victoire sur le terrain qu'elle recouvre — le même geste qu'une chaussée
 * (`roadNetwork`), pour la même raison. Il n'y a plus d'intersection à
 * trouver, plus de niveau à choisir, plus de marge : l'eau ne peut ni
 * s'enterrer ni flotter, puisqu'elle *est* la surface du sol, peinte en eau.
 *
 * Le prix, assumé : une nappe n'est plus rigoureusement horizontale, elle
 * épouse le bruit du MNT. Un lac que la donnée d'altitude rend bosselé sera
 * bosselé. C'est le seul défaut qui reste, et il ne fait jamais disparaître
 * l'eau ni apparaître de falaise.
 *
 * Les triangles du polygone sont redécoupés avant d'être plaqués
 * (`subdivideTriangle`) : un triangle de cent mètres ne suivrait pas le sol,
 * il le traverserait.
 */


import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { resamplePath, createRibbonBuffer, appendRibbon } from './ribbonGeometry.js';
import { createWaterNormalCanvas } from '../materials/proceduralTextures.js';
import { WaterIndex } from './waterIndex.js';
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
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;
/**
 * Longueur d'arête au-delà de laquelle un triangle de nappe est recoupé, en
 * mètres. De l'ordre de la maille de terrain la plus fine (4,42 m) : plus
 * grossier, la nappe coupe à travers les bosses au lieu de les épouser.
 */
export const WATER_DRAPE_EDGE_M = 8;
/**
 * Plafond du nombre de triangles produits par le placage, pour une
 * reconstruction entière. Une garde contre un lac démesuré, pas un réglage :
 * au-delà, les triangles restent grossiers plutôt que de disparaître.
 */
export const WATER_DRAPE_MAX_TRIANGLES = 30000;
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

/**
 * Recoupe un triangle jusqu'à ce qu'aucune arête ne dépasse `maxEdge`, en
 * partageant à chaque fois la plus longue en son milieu. L'orientation est
 * conservée, donc la nappe continue de regarder vers le haut.
 *
 * Le budget est une garde, pas un réglage : épuisé, on rend le triangle tel
 * quel — une nappe un peu raide vaut mieux qu'une nappe absente.
 *
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @param {{x:number,z:number}} c
 * @param {number} maxEdge Longueur d'arête visée, en mètres.
 * @param {{left:number}} budget Nombre de triangles encore autorisés, décrémenté sur place.
 * @returns {Array<Array<{x:number,z:number}>>} triangles, dans l'ordre de parcours d'origine.
 */
export function subdivideTriangle(a, b, c, maxEdge = WATER_DRAPE_EDGE_M, budget = { left: Infinity }) {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const longest = Math.max(ab, bc, ca);

  if (!(longest > maxEdge) || budget.left <= 1) return [[a, b, c]];
  budget.left -= 1;

  // Sommets renommés pour que (p, q) soit la plus longue arête : couper
  // (p, q, r) en (p, m, r) et (m, q, r) garde le sens de parcours.
  let p = a;
  let q = b;
  let r = c;
  if (bc === longest) {
    p = b;
    q = c;
    r = a;
  } else if (ca === longest) {
    p = c;
    q = a;
    r = b;
  }

  const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
  return [
    ...subdivideTriangle(p, m, r, maxEdge, budget),
    ...subdivideTriangle(m, q, r, maxEdge, budget),
  ];
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
    // La nappe gagne les égalités, comme une chaussée : elle est plaquée sur
    // le terrain, exactement à son altitude, et c'est le polygone — pas une
    // comparaison de hauteurs — qui dit jusqu'où elle va.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
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
    /** Nappes publiées à l'usage des ponts (`WaterIndex`), ou `null` avant la première construction. @type {WaterIndex|null} */
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
    /** @type {Array<{rings: Array, levelAt: Function}>} nappes retenues, pour l'index. */
    const surfaces = [];

    this._appendPolygons(source, tiles, here, radius, mesh, surfaces);
    this._appendWaterways(source, tiles, here, radius, mesh);

    // Ce que les ponts interrogeront pour dégager leur travée (`roadNetwork`).
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
   * @param {Array} surfaces Accumulateur des nappes retenues, pour l'index que
   *        les ponts interrogeront (`WaterIndex`).
   */
  _appendPolygons(source, tiles, here, radius, mesh, surfaces) {
    const { THREE, bubble } = this;
    let built = 0;
    const budget = { left: WATER_DRAPE_MAX_TRIANGLES };

    // Altitude naturelle, terrassements exclus : une nappe se plaque sur le
    // relief, pas sur le déblai d'une route qui la longe. `NaN`, jamais 0, sur
    // une tuile non chargée — un sommet sans sol n'a pas d'altitude à prendre.
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
        // Ordre inversé : chiralité opposée du plan (x, z), sinon la nappe
        // regarderait vers le bas. Les `Vector2` sont du plan (x, z) : leur
        // `y` est notre `z`.
        const all = contour.concat(...holes);
        for (const [i0, i1, i2] of faces) {
          const corners = [];
          for (const index of [i0, i2, i1]) {
            const p = all[index];
            if (p) corners.push({ x: p.x, z: p.y });
          }
          if (corners.length < 3) continue;

          // Recoupé avant d'être plaqué : un grand triangle traverserait le sol.
          for (const [a, b, c] of subdivideTriangle(...corners, WATER_DRAPE_EDGE_M, budget)) {
            const ya = sampleGround(a.x, a.z);
            const yb = sampleGround(b.x, b.z);
            const yc = sampleGround(c.x, c.z);
            // Un triangle dont un sommet n'a pas de sol est sauté : il serait
            // rendu à l'altitude zéro, c'est-à-dire au niveau de la mer.
            if (!Number.isFinite(ya) || !Number.isFinite(yb) || !Number.isFinite(yc)) continue;
            this._vertex(mesh, a.x, ya, a.z);
            this._vertex(mesh, b.x, yb, b.z);
            this._vertex(mesh, c.x, yc, c.z);
          }
        }

        // Déclarée après la triangulation seulement (une nappe refusée ne doit
        // pas relever un tablier de pont). L'altitude de l'eau sous un point
        // est celle du sol : c'est tout l'objet de ce module.
        surfaces.push({ rings: [outer, ...holeRings], levelAt: sampleGround });
        built++;
      }
    });
  }

  _appendWaterways(source, tiles, here, radius, mesh) {
    const { bubble } = this;
    const buffer = createRibbonBuffer();
    // Le sol tel qu'il est affiché, déblai compris : un ruisseau qui longe une
    // route entaillée descend avec elle. Zéro en dernier recours — un ruban de
    // huit mètres de large ne peut pas sauter un sommet sans se déchirer.
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
        if (!boundsIntersect(local, here.x, here.z, radius)) continue;

        const path = resamplePath(local, WATER_SAMPLE_M);
        if (path.length < 2) continue;

        // Plaqué sur le sol, comme les nappes et pour la même raison : un
        // profil calculé — fût-il monotone vers l'aval — enterre le ruban dès
        // que le MNT remonte, et le fait flotter dès qu'il redescend.
        appendRibbon(buffer, {
          path,
          halfWidth: style.halfWidth,
          sampleElevation,
          lift: 0,
          level: false,
          smoothRadius: 0,
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
