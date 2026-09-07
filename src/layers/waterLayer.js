/*
 * waterLayer — lacs, rivières et bras de mer, tirés des couches `water`
 * (polygones) et `waterway` (lignes trop étroites pour un polygone).
 *
 * L'eau est plane en travers : d'une rive à l'autre, une nappe est à une
 * altitude unique, sinon elle remonterait les collines.
 *
 * ## L'eau s'ajuste au terrain, jamais l'inverse
 *
 * Le terrain n'est plus creusé sous les nappes. Une cuvette rabattait tout un
 * polygone sur une seule cote : sur une pente, c'était une gorge taillée dans
 * le versant. La rive n'est donc plus le contour du polygone, c'est la courbe
 * où le terrain croise le niveau de l'eau — et c'est le test de profondeur qui
 * la dessine, au pixel près, en cachant la nappe partout où le sol lui passe
 * devant. Rien à découper, rien à terrasser.
 *
 * Tout se joue alors sur le choix du niveau (`reachLevels`), pris entre deux
 * contraintes qui vont en sens inverse :
 *
 *   - **couvrir le fond** : sous un quantile haut des altitudes intérieures, le
 *     MNT ressort en îlots et le lac se troue (c'est ce que la cuvette
 *     masquait) ;
 *   - **ne pas déborder** : au-dessus du point bas du contour — l'exutoire —
 *     l'eau inonde les berges. Un lac ne monte pas plus haut que son exutoire.
 *
 * On retient le plus bas des deux.
 *
 * ## Le long, ça descend : les biefs
 *
 * Un seul plan horizontal ne convient qu'à une nappe ramassée. Une rivière
 * portée par un polygone descend une pente : à plat, ou bien elle inonde
 * l'amont, ou bien elle se réduit à une flaque à l'aval. On découpe donc les
 * polygones allongés en **biefs** le long de leur axe principal, un niveau par
 * bief selon la règle ci-dessus, et le profil est rendu monotone vers l'aval
 * (`monotoneDownstream`) : plane d'une rive à l'autre, jamais remontante — la
 * règle même du hydro-flattening des MNT. Entre deux biefs, le niveau est
 * interpolé, sans marche.
 *
 * Un polygone ramassé n'a qu'un bief, et retrouve exactement le plan
 * horizontal d'un lac : c'est le même mécanisme, pas un cas particulier.
 *
 * Les cours d'eau linéaires suivent la même règle de monotonie, sur leur
 * tracé plutôt que sur un axe reconstruit (`waterwayProfile`), et la même
 * marge au-dessus du sol (`WATER_SURFACE_MARGIN_M`).
 *
 * Une limite assumée : le niveau n'est évalué qu'aux sommets du polygone, et
 * la carte graphique interpole entre eux. Un très long côté sans sommet
 * intermédiaire rend donc le profil en corde, pas en courbe.
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
 * Hauteur d'eau au-dessus du sol que le MNT donne, en mètres.
 *
 * Le MNT ne décrit pas le fond d'un lac : sous une nappe, le sol qu'il donne
 * **est** la surface de l'eau. Posée exactement dessus, la nappe se retrouve
 * coplanaire au terrain qui la cache — et le terrain gagne les égalités (voir
 * `createWaterMaterial`) : il ne reste qu'un liseré d'eau au fond du bruit du
 * MNT, quelques centimètres sous le sol.
 *
 * Cette marge l'en fait sortir. Elle ne noie rien : n'est inondé que ce qui
 * était déjà à quelques centimètres du niveau, c'est-à-dire la nappe
 * elle-même. Les berges, qui montent, cachent toujours ce qui passe derrière.
 */
export const WATER_SURFACE_MARGIN_M = 0.2;
/** Nombre maximal de surfaces retenues par reconstruction. */
export const WATER_MAX_POLYGONS = 300;
/** Nombre maximal de points échantillonnés à l'intérieur d'un polygone pour en tirer l'altitude (voir `interiorSamples`). */
export const WATER_LEVEL_MAX_SAMPLES = 200;
/**
 * Part du fond que la nappe doit couvrir : rang du quantile des altitudes
 * intérieures qui donne le **plancher** du niveau. À 0,9, un dixième du fond
 * émerge — le MNT le plus haut du polygone, ses îlots et ses berges internes.
 */
export const WATER_FILL_QUANTILE = 0.9;
/**
 * Rang du quantile des altitudes du **contour** qui donne le plafond du
 * niveau : l'exutoire. Bas, mais pas le minimum, qu'un seul sommet aberrant
 * suffirait à coucher.
 */
export const WATER_OUTLET_QUANTILE = 0.1;
/** Longueur d'un bief, en mètres : le pas auquel une rivière a le droit de descendre. */
export const WATER_REACH_M = 60;
/** Allongement (longueur ÷ largeur) à partir duquel une nappe descend en biefs plutôt que de rester plane. */
export const WATER_REACH_RATIO = 3;
/** Plafond du nombre de biefs : garde contre un polygone démesuré, pas un réglage. */
export const WATER_MAX_REACHES = 64;
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
 * Quantile d'une série, par interpolation linéaire entre les deux rangs
 * encadrants. Ne modifie pas le tableau reçu.
 *
 * @param {number[]} values Série quelconque, non triée.
 * @param {number} q        Rang visé, de 0 (minimum) à 1 (maximum).
 * @returns {number} `Infinity` si la série est vide.
 */
export function quantile(values, q) {
  if (!values.length) return Infinity;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Direction du plus grand étalement d'un nuage de points (vecteur propre
 * dominant de sa matrice de covariance) : l'axe d'une rivière, le long duquel
 * elle descend.
 *
 * Le signe est fixé, pas laissé au hasard du calcul : le même polygone doit
 * rendre le même axe d'une reconstruction à l'autre, sous peine de faire
 * changer le paysage sans que rien n'ait bougé.
 *
 * @param {Array<{x:number,z:number}>} points
 * @returns {{x:number, z:number}} vecteur unitaire.
 */
export function principalAxis(points) {
  const n = points.length;
  if (n < 2) return { x: 1, z: 0 };

  let mx = 0;
  let mz = 0;
  for (const p of points) {
    mx += p.x;
    mz += p.z;
  }
  mx /= n;
  mz /= n;

  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dz = p.z - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }

  // Valeur propre dominante d'une 2x2 symétrique, forme fermée.
  const half = (sxx + szz) / 2;
  const gap = Math.sqrt(Math.max(0, half * half - (sxx * szz - sxz * sxz)));
  const lambda = half + gap;

  // Deux expressions du même vecteur propre : la seconde rattrape le cas où la
  // première s'annule (nuage aligné sur un axe du repère).
  let vx = lambda - szz;
  let vz = sxz;
  if (Math.abs(vx) + Math.abs(vz) < 1e-12) {
    vx = sxz;
    vz = lambda - sxx;
  }
  const length = Math.hypot(vx, vz);
  if (!(length > 0)) return { x: 1, z: 0 };

  const sign = vx !== 0 ? Math.sign(vx) : Math.sign(vz) || 1;
  return { x: (vx / length) * sign, z: (vz / length) * sign };
}

/**
 * Altitude de chaque bief, de l'amont à l'aval, par la règle plancher/plafond
 * appliquée aux seuls échantillons du bief.
 *
 * Un bief sans échantillon — un polygone étranglé, une lacune de MNT — est
 * comblé par son voisin connu plutôt que laissé à zéro. Le profil obtenu est
 * ensuite rendu monotone : une rivière ne remonte pas.
 *
 * @param {Array<{t:number,h:number}>} bottom Échantillons intérieurs, abscisse le long de l'axe et altitude.
 * @param {Array<{t:number,h:number}>} rim    Idem, sur le contour.
 * @param {number} tMin  Abscisse du début du premier bief.
 * @param {number} span  Longueur totale couverte par les biefs.
 * @param {number} count Nombre de biefs.
 * @returns {Float32Array|null} `null` si aucun bief n'a d'altitude.
 */
export function reachLevels(bottom, rim, tMin, span, count) {
  const bottoms = Array.from({ length: count }, () => []);
  const rims = Array.from({ length: count }, () => []);
  const bin = (t) => Math.min(count - 1, Math.max(0, Math.floor(((t - tMin) / span) * count)));

  for (const p of bottom) bottoms[bin(p.t)].push(p.h);
  for (const p of rim) rims[bin(p.t)].push(p.h);

  const levels = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const fill = quantile(bottoms[b].length ? bottoms[b] : rims[b], WATER_FILL_QUANTILE);
    const outlet = quantile(rims[b], WATER_OUTLET_QUANTILE);
    // `Infinity` quand le bief est vide : une lacune, que `fillGaps` comblera.
    levels[b] = Math.min(fill, outlet);
  }

  if (!fillGaps(levels)) return null;
  return monotoneDownstream(levels);
}

/**
 * Altitude de l'eau en tout point d'une nappe : un plan horizontal pour une
 * nappe ramassée, un profil descendant le long de l'axe pour une nappe
 * allongée (voir l'en-tête du module).
 *
 * `sampleGround` peut rendre `NaN` pour un point sans donnée : ignoré plutôt
 * que compté pour une altitude de zéro.
 *
 * @param {Array<{x:number,z:number}>} outer
 * @param {Array<Array<{x:number,z:number}>>} holes
 * @param {(x:number, z:number) => number} sampleGround
 * @returns {{levelAt:(x:number,z:number)=>number, reaches:number}|null}
 *          `null` si aucun échantillon n'a de donnée.
 */
export function waterLevelField(outer, holes, sampleGround, maxInteriorSamples = WATER_LEVEL_MAX_SAMPLES) {
  const collect = (points, into) => {
    for (const p of points) {
      const h = sampleGround(p.x, p.z);
      if (Number.isFinite(h)) into.push({ x: p.x, z: p.z, h });
    }
    return into;
  };

  // Le contour d'un trou est une rive comme une autre : il peut être l'exutoire.
  const rim = collect(outer, []);
  for (const hole of holes) collect(hole, rim);
  const bottom = collect(interiorSamples(outer, holes, maxInteriorSamples), []);
  if (!rim.length && !bottom.length) return null;

  // L'axe se lit sur la grille intérieure, régulière, plutôt que sur un
  // contour dont les sommets se pressent dans les méandres.
  const axis = principalAxis(bottom.length >= 4 ? bottom : outer);

  // Emprise du polygone dans le repère de l'axe : longueur et largeur.
  let tMin = Infinity;
  let tMax = -Infinity;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const p of outer) {
    const t = p.x * axis.x + p.z * axis.z;
    const s = p.x * -axis.z + p.z * axis.x;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }
  const span = tMax - tMin;
  const width = sMax - sMin;

  const elongated = span >= 2 * WATER_REACH_M && span >= WATER_REACH_RATIO * width;
  const count = elongated
    ? Math.min(WATER_MAX_REACHES, Math.max(2, Math.round(span / WATER_REACH_M)))
    : 1;

  const project = (points) => points.map((p) => ({ t: p.x * axis.x + p.z * axis.z, h: p.h }));

  // Les deux bouts d'un polygone allongé sont des coupes en travers du cours
  // d'eau — là où la tuile ou l'entité s'arrête —, pas des berges : leur
  // contour est au niveau de l'eau, pas au-dessus. Les compter comme exutoire
  // coucherait le premier et le dernier bief sur le fond, et l'eau y
  // disparaîtrait sous le terrain. Une nappe d'un seul bief, elle, est bordée
  // de rives sur tout son tour : rien à écarter.
  const margin = count > 1 ? span / count / 2 : 0;
  const banks = project(rim).filter((p) => p.t >= tMin + margin && p.t <= tMax - margin);

  const levels = reachLevels(project(bottom), banks, tMin, span || 1, count);
  if (!levels) return null;
  // Le MNT donne la surface de l'eau, pas son fond : il faut en sortir.
  for (let b = 0; b < levels.length; b++) levels[b] += WATER_SURFACE_MARGIN_M;

  if (count === 1) {
    const level = levels[0];
    return { levelAt: () => level, reaches: 1 };
  }

  // Interpolation entre centres de biefs : le profil descend sans marche, et
  // reste monotone puisqu'il interpole une suite monotone.
  const levelAt = (x, z) => {
    const u = (((x * axis.x + z * axis.z) - tMin) / span) * count - 0.5;
    if (u <= 0) return levels[0];
    if (u >= count - 1) return levels[count - 1];
    const i = Math.floor(u);
    return levels[i] + (levels[i + 1] - levels[i]) * (u - i);
  };
  return { levelAt, reaches: count };
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
    // Le terrain gagne les égalités : c'est lui qui découpe le trait de côte,
    // et sur un fond que la nappe rase de quelques centimètres, sans ce
    // décalage les deux surfaces se disputeraient le pixel.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
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

    // Altitude naturelle, terrassements exclus : une nappe se cale sur le
    // relief, pas sur le déblai d'une route qui la longe. `NaN`, jamais 0, sur
    // une tuile non chargée.
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
        let field;
        if (properties.class === 'ocean') {
          // Le zéro marin, remonté de la même marge : le MNT met la mer à zéro
          // lui aussi, et une mer coplanaire au rivage ne se verrait pas.
          field = { levelAt: () => WATER_SURFACE_MARGIN_M };
        } else {
          field = waterLevelField(outer, holeRings, sampleGround);
          if (!field) continue;
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
            // `Vector2` du plan (x, z) : son `y` est notre `z`.
            this._vertex(mesh, p.x, field.levelAt(p.x, p.y), p.y);
          }
        }

        // Déclarée après la triangulation seulement (une nappe refusée ne doit pas relever un tablier de pont).
        surfaces.push({ rings: [outer, ...holeRings], levelAt: field.levelAt });
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
          lift: WATER_SURFACE_MARGIN_M,
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
