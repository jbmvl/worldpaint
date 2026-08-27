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
 * L'altitude retenue est un **quantile bas** du terrain, jamais la moyenne (qui
 * poserait la nappe à la hauteur des berges, donc sous elles) ni le minimum
 * (qui suffirait à un seul point aberrant pour enterrer tout un lac). Elle se
 * lit sur le contour du polygone **et** sur une grille intérieure
 * (`waterSurfaceLevel`) : le contour seul n'échantillonne que la berge. Un
 * point sans donnée (hors des tuiles de terrain actuellement chargées) est
 * ignoré plutôt que traité comme une altitude de zéro, qui écraserait la
 * nappe entière au niveau de la mer.
 *
 * Le long d'un cours d'eau linéaire, la même idée prend une forme plus forte :
 * le profil est rendu **monotone vers l'aval** (`monotoneDownstream`). Une
 * rivière ne remonte pas, et cet a priori vaut mieux que n'importe quel
 * lissage — un lissage par moyenne relève les passages encaissés au-dessus de
 * leurs propres berges.
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

/**
 * Portée maximale autour de l'observateur, en mètres. C'est un plafond, pas
 * la portée effective : `rebuild` le resserre sur le rayon réel de la bulle
 * de terrain quand celui-ci est plus petit (latitudes élevées), pour ne
 * jamais construire de l'eau au-delà du relief chargé.
 */
export const WATER_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const WATER_REBUILD_M = 250;
/** Pas de ré-échantillonnage le long d'un cours d'eau, en mètres. */
export const WATER_SAMPLE_M = 8;
/**
 * Enfoncement d'un cours d'eau **linéaire** sous l'altitude trouvée, en mètres.
 *
 * Il ne concerne plus les nappes : celles-ci reposent dans une cuvette creusée
 * pour elles dans le terrain (`waterCut`), qui garantit l'émersion de la berge
 * bien mieux qu'une marge ne l'a jamais fait. Les cours d'eau linéaires, eux,
 * font de 1,2 à 9 m de large — sous la maille de terrain ou à peine dessus — et
 * ne peuvent pas être creusés sans refaire l'échec du fossé de route. Cette
 * marge reste donc leur seule protection, avec ses limites connues.
 */
export const WATER_SINK_M = 0.15;
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;
/**
 * Nombre maximal de points échantillonnés à l'intérieur d'un polygone pour en
 * tirer l'altitude. Le contour seul peut être percé : le MNT reste bruité par
 * endroits au-dessus de l'eau (radar, végétation de rive), et rien ne borne le
 * milieu d'un grand lac si on ne regarde que sa rive. Le pas de grille dérive
 * de ce plafond et de la surface du polygone (voir `interiorSamples`), donc le
 * coût reste borné même pour un grand lac.
 */
export const WATER_LEVEL_MAX_SAMPLES = 200;
/**
 * Rang du quantile qui décide de l'altitude d'une nappe (voir
 * `waterSurfaceLevel`). Cinq pour cent : assez bas pour rester sous la berge,
 * assez haut pour qu'un point aberrant isolé — et le MNT en a — ne suffise pas
 * à couler la nappe entière.
 */
export const WATER_LEVEL_QUANTILE = 0.05;
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

/**
 * Vrai si un point est dans le contour et hors de tous les trous. S'appuie
 * sur `pointInRing` (`furniturePlacement.js`) plutôt que d'en refaire une
 * copie. Fonction pure.
 */
export function pointInPolygon(x, z, outer, holes) {
  if (!pointInRing(outer, x, z)) return false;
  for (const hole of holes) {
    if (pointInRing(hole, x, z)) return false;
  }
  return true;
}

/**
 * Grille de points strictement intérieurs à un polygone (contour et trous en
 * coordonnées locales). Le pas s'ajuste à la surface de la boîte englobante
 * pour tenir sous `maxSamples` : un grand lac n'est pas sondé plus finement
 * qu'une mare, seulement sur davantage de points.
 *
 * La grille est ancrée sur l'origine du repère local, pas sur la boîte
 * englobante du polygone : deux lacs voisins tirent leurs échantillons des
 * mêmes lignes de grille, et le résultat ne dépend ni de l'ordre des sommets
 * ni de la position de l'observateur — l'invariant de déterminisme spatial du
 * projet. Fonction pure.
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
 * encadrants. Ne modifie pas le tableau reçu. Fonction pure.
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
 * trous et grille intérieure — pas le contour seul, qui ne dit rien du milieu
 * d'un grand lac.
 *
 * L'estimateur est un **quantile bas**, et non le minimum. Les deux erreurs à
 * éviter tirent en sens contraire, et le minimum n'en évite qu'une :
 *
 * - poser la nappe trop **haut** la fait percer par le fond. C'est ce que
 *   faisait le contour seul, qui n'échantillonne que la berge — le point haut
 *   du lac par définition ;
 * - poser la nappe trop **bas** l'enterre entièrement. C'est ce que fait le
 *   minimum dès qu'un seul point est bruité, et le MNT l'est : radar sur
 *   l'eau, végétation de rive. Le défaut empire à mesure qu'on échantillonne
 *   mieux, ce qui est le signe d'un mauvais estimateur.
 *
 * Un quantile écarte les deux : il faut plusieurs points bas concordants pour
 * le faire descendre, et la berge est trop minoritaire pour le remonter.
 *
 * `sampleGround` peut rendre `NaN` pour un point sans donnée (hors tuiles
 * chargées) : ces points sont ignorés plutôt que de compter pour une altitude
 * de zéro, qui écraserait la nappe entière au niveau de la mer. Fonction pure.
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
 *
 * Deux règles, dans cet ordre. **En travers**, la section prend le plus bas de
 * ce qu'elle rencontre — l'axe et les deux rives : une surface d'eau posée à la
 * hauteur moyenne de ses berges les recouvrirait. **Le long du cours**, le
 * profil est rendu monotone vers l'aval (`monotoneDownstream`) : une rivière ne
 * remonte pas, et cet a priori remplace avantageusement le lissage qui occupait
 * cette place — une moyenne glissante relève les passages encaissés au-dessus
 * de leurs propres berges.
 *
 * `sampleElevation` peut rendre `NaN` hors des tuiles chargées. Une lacune est
 * comblée par le dernier point connu — un plateau, comme `elevationField` en
 * pose déjà un à ses propres bords : « mieux vaut un plateau qu'une falaise
 * fantôme ». Compter ces points pour zéro, en revanche, coucherait tout l'aval
 * au niveau de la mer, le minimum courant se chargeant de propager la faute.
 *
 * Fonction pure vis-à-vis de `sampleElevation`.
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
    // Le plus bas de la section : l'axe et les deux rives.
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
    // Pas de décalage de profondeur, contrairement à la chaussée. Celle-ci est
    // vraiment coplanaire au terrain et n'a pas d'autre recours ; la nappe,
    // elle, se tient soixante centimètres au-dessus d'un lit creusé pour elle
    // (`waterCut`). Deux surfaces franchement séparées n'ont pas à se disputer
    // le pixel, et un décalage ajouté par-dessus ne ferait que déplacer le
    // problème d'un type d'eau à l'autre.
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
    /**
     * Cuvette publiée à l'usage du terrain (`WaterIndex`), ou `null` avant la
     * première construction. C'est la seule chose que cette couche publie —
     * elle ne lit toujours que les tuiles.
     * @type {WaterIndex|null}
     */
    this.index = null;
  }

  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    // La maille de terrain a changé de finesse : elle a capté des pointes du
    // MNT qu'elle sautait, donc le sol a monté sous une nappe calculée sur
    // l'ancienne résolution. C'est le défaut qu'on voit en s'approchant.
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

    // La bulle de terrain rétrécit avec la latitude (`scale` dépend de
    // cos(lat)) : au-delà d'environ 65°, son rayon passe sous 900 m. Sans ce
    // plafond, une surface d'eau pourrait se construire là où le terrain n'a
    // pas encore chargé — de l'eau flottant au-delà du relief affiché.
    const radius = Math.min(WATER_RADIUS_M, this.bubble.radiusMeters || WATER_RADIUS_M);

    const mesh = { positions: [], normals: [], uvs: [] };
    /** @type {Array<{rings: Array, level: number}>} nappes, pour la cuvette. */
    const surfaces = [];

    this._appendPolygons(source, tiles, here, radius, mesh, surfaces);
    this._appendWaterways(source, tiles, here, radius, mesh);

    // La cuvette que le terrain devra creuser. Seules les **nappes** y entrent :
    // un cours d'eau linéaire fait de 1,2 à 9 m de large, sous la maille de
    // terrain ou à peine dessus, et le creuser échouerait comme a échoué le
    // fossé de route (voir `waterCut`).
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

    // Altitude **naturelle** du terrain, terrassements exclus.
    //
    // `rawSurfaceElevationAtLocal` et non `surfaceElevationAtLocal`, pour la
    // raison exacte qui fait que la plate-forme d'une chaussée se calcule elle
    // aussi sur le terrain brut : la cuvette dérive du niveau de l'eau, le
    // niveau de l'eau ne peut donc pas dériver de la cuvette. Lire le terrain
    // déjà creusé ferait descendre la nappe d'un lit à chaque reconstruction,
    // indéfiniment. Accessoirement, un déblai routier passant près d'une rive
    // n'a aucune raison de baisser le niveau du lac.
    //
    // `NaN` en cas de tuile non chargée, jamais 0 : un sommet hors bulle ne
    // doit pas prétendre que le lac est au niveau de la mer.
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

        // La mer est à zéro par définition : lui chercher un niveau sur un
        // polygone qui couvre plusieurs tuiles n'aurait aucun sens. Elle est
        // creusée comme les autres, donc elle n'a plus besoin d'être enfoncée
        // sous le trait de côte pour se voir.
        let level;
        if (properties.class === 'ocean') {
          level = 0;
        } else {
          level = waterSurfaceLevel(outer, holeRings, sampleGround);
          if (!Number.isFinite(level)) continue;
        }

        const contour = outer.map((p) => new THREE.Vector2(p.x, p.z));
        const holes = holeRings.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.z)));

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

        // La cuvette n'est déclarée qu'**après** la triangulation, jamais
        // avant : une nappe que la triangulation refuse n'est pas dessinée, et
        // creuser le terrain sous une eau absente laisserait un trou nu.
        //
        // La nappe est posée au niveau calculé, sans enfoncement : c'est le lit
        // creusé sous elle qui garantit désormais que la berge émerge, et il le
        // fait de soixante centimètres au lieu de quinze — franchement au-dessus
        // du bruit du MNT comme de l'erreur de la maille.
        surfaces.push({ rings: [outer, ...holeRings], level });
        built++;
      }
    });
  }

  _appendWaterways(source, tiles, here, radius, mesh) {
    const { bubble } = this;
    const buffer = createRibbonBuffer();
    // `NaN` et non zéro : un point hors des tuiles chargées doit être une
    // lacune que `waterwayProfile` comble, pas une altitude de zéro que le
    // minimum courant propagerait ensuite jusqu'à l'embouchure.
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
        // Tracé entièrement hors des tuiles chargées : rien à poser.
        if (!platform) continue;

        appendRibbon(buffer, {
          path,
          halfWidth: style.halfWidth,
          sampleElevation,
          lift: -WATER_SINK_M,
          // Le profil est calculé ici, puis imposé : `level: true` avec une
          // `platform` fournie pose toute la section à une altitude unique.
          // C'est le chemin déjà emprunté par la chaussée, qui dresse elle
          // aussi sa plate-forme avant de la passer au ruban.
          platform,
          level: true,
          // Aucun lissage : `appendRibbon` en passe un par défaut, utile à une
          // chaussée mais destructeur ici — une moyenne glissante remonterait
          // les sections basses et annulerait la monotonie qu'on vient
          // d'imposer.
          smoothRadius: 0,
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
