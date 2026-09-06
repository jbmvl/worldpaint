/*
 * roadNetwork — le réseau routier, pas seulement la route de l'observateur.
 * Les chaussées viennent de la couche `transportation` (`class` pour la
 * largeur et le revêtement, `brunnel` pour tunnels et ponts), livrées en
 * morceaux coupés à chaque frontière de tuile. `roadGraph.js` les recoud
 * avant qu'on en fasse quoi que ce soit.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { mergeRoadLines, RoadIndex, stitchPlatforms, trimAtJunctions } from './roadGraph.js';
import { ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../terrain/roadCut.js';
import {
  resamplePath,
  createRibbonBuffer,
  appendRibbon,
  toGeometry,
  pathFrames,
  levelRow,
  smoothColumns,
} from './ribbonGeometry.js';
import { ROAD_TEXTURE_LENGTH, createRoadCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';

/** Graines distinctes : deux profils voisins ne doivent pas avoir le même grain. */
const ROAD_PROFILE_SEEDS = {
  express: 4711,
  major: 4801,
  minor: 4903,
  lane: 5009,
  cycleway: 5107,
  track: 5521,
  path: 5623,
};

/** Matériaux de chaussée, un par profil (sept appels de rendu, prix d'un marquage qui ne s'étire pas). */
export function createRoadMaterials(THREE, roads = defaultTheme.roads) {
  const entries = {};

  for (const [key, profile] of Object.entries(roads.profiles)) {
    const texture = new THREE.CanvasTexture(createRoadCanvas(profile, ROAD_PROFILE_SEEDS[key], roads));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    const material = new THREE.MeshLambertMaterial({
      map: texture,
      // Chaussée et terrain quasi coplanaires : sans décalage de profondeur, la route clignote.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    material.name = `road-${key}`;
    entries[key] = { texture, material };
  }

  return {
    /** @type {Record<string, Object>} matériau par clé de profil. */
    byProfile: Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, e.material])),
    /**
     * Mouille la chaussée, par `material.color` (multiplie la texture, le
     * marquage reste net et rien n'est à redessiner).
     * @param {number} value De 0 (sec) à 1 (trempé).
     */
    setWetness(value) {
      const wet = Math.min(1, Math.max(0, value || 0));
      // Légèrement moins sombre dans le bleu : une chaussée mouillée renvoie le ciel.
      const shade = 1 - wet * 0.42;
      for (const entry of Object.values(entries)) {
        entry.material.color.setRGB(shade, shade, shade + wet * 0.06);
      }
    },
    setMaxAnisotropy(value) {
      for (const entry of Object.values(entries)) {
        entry.texture.anisotropy = Math.min(value || 8, 16);
        entry.texture.needsUpdate = true;
      }
    },
    dispose() {
      for (const entry of Object.values(entries)) {
        entry.material.dispose();
        entry.texture.dispose();
      }
    },
  };
}

/** Pas de ré-échantillonnage le long d'une chaussée, en mètres. */
export const ROAD_SAMPLE_M = 5;
/** Portée du réseau autour de l'observateur, en mètres. */
export const ROAD_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const ROAD_REBUILD_M = 250;
/** Décollement au-dessus de la surface, en mètres. */
export const ROAD_LIFT_M = 0.14;
/**
 * Hiérarchie des profils, par largeur décroissante — départage les carrefours
 * (deux centimètres d'écart par rang, le premier restant à `ROAD_LIFT_M`).
 * C'est la largeur qui ordonne, pas l'importance administrative.
 */
export const ROAD_PROFILE_ORDER = ['express', 'major', 'minor', 'lane', 'track', 'cycleway', 'path'];
const ROAD_RANK_STEP_M = 0.02;

/**
 * Décollement d'un profil : les voies secondaires passent sous les grandes.
 * `tieBreak`, dans [0, 1[, départage deux chaussées de même profil qui se
 * croisent (au plus la moitié d'un rang, la hiérarchie reste intacte).
 */
export function roadLiftFor(profile, tieBreak = 0) {
  const rank = ROAD_PROFILE_ORDER.indexOf(profile);
  const jitter = Math.min(Math.max(tieBreak, 0), 1) * ROAD_RANK_STEP_M * 0.5;
  return ROAD_LIFT_M - Math.max(0, rank) * ROAD_RANK_STEP_M + jitter;
}

/**
 * Profil par `class` OpenMapTiles. Les valeurs de `class` sont celles que
 * filtrent les styles du projet : motorway, trunk, primary, secondary,
 * tertiary, minor, service, track, path, pedestrian, *_link, rail, transit,
 * ferry. Tout ce qui n'est pas ici n'est pas une chaussée.
 */
export const ROAD_CLASSES = {
  motorway: 'express',
  trunk: 'express',
  motorway_link: 'major',
  trunk_link: 'major',
  primary: 'major',
  primary_link: 'major',
  secondary: 'major',
  secondary_link: 'major',
  tertiary: 'minor',
  tertiary_link: 'minor',
  minor: 'minor',
  minor_road: 'minor',
  unclassified: 'minor',
  residential: 'minor',
  service: 'lane',
  pedestrian: 'lane',
  track: 'track',
  path: 'path',
  cycleway: 'cycleway',
};

/**
 * Style de chaussée d'une entité, ou `null` si elle ne doit pas être dessinée
 * (tunnel écarté : le MNT ne connaît pas le relief au-dessus). `subclass`
 * affine `class` : piste cyclable, sentier et escalier partagent la même
 * classe `path`.
 */
export function roadStyleFor(properties = {}, profiles = defaultTheme.roads.profiles) {
  if (properties.brunnel === 'tunnel') return null;

  let key = ROAD_CLASSES[properties.class];

  if (properties.class === 'path' || properties.class === 'cycleway') {
    const subclass = properties.subclass;
    if (subclass === 'steps') return null;
    if (subclass === 'cycleway' || properties.bicycle === 'designated') key = 'cycleway';
    else if (subclass === 'track') key = 'track';
  }

  const profile = key ? profiles[key] : null;
  if (!profile) return null;

  return {
    profile: key,
    halfWidth: profile.width / 2,
    paved: (profile.surface || 'asphalt') === 'asphalt',
  };
}

/** Extrait les polylignes d'une géométrie GeoJSON de chaussée. */
export function roadLines(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/**
 * Découpe une polyligne métrique en tronçons contigus tenant dans un rayon.
 * Chaque tronçon rapporte la distance parcourue avant son premier point (dans
 * la ligne d'origine) et l'indice de ce premier point, pour que le mobilier
 * espacé (bornes, lampadaires) reste à sa place quand le découpage se déplace
 * avec l'observateur.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {number} centerX
 * @param {number} centerZ
 * @param {number} radius
 * @returns {Array<{points: Array<{x:number,z:number}>, startDistance: number, startIndex: number}>}
 */
export function clipToRadius(points, centerX, centerZ, radius) {
  const runs = [];
  let current = null;
  let travelled = 0; // distance cumulée depuis le premier sommet de la ligne

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    const inside = Math.hypot(points[i].x - centerX, points[i].z - centerZ) <= radius;

    if (inside) {
      if (!current) {
        // On garde le point précédent, dehors, pour ne pas commencer pile sur la frontière du disque.
        const back = i > 0 ? 1 : 0;
        const step = back ? Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) : 0;
        current = { points: [], startDistance: travelled - step, startIndex: i - back };
        if (back) current.points.push(points[i - 1]);
        runs.push(current);
      }
      current.points.push(points[i]);
    } else if (current) {
      current.points.push(points[i]);
      current = null;
    }
  }

  return runs.filter((run) => run.points.length >= 2);
}

/**
 * Polylignes de chaussée d'un jeu de tuiles, projetées dans le repère local.
 * Ce qui en sort sont des morceaux — c'est `mergeRoadLines` qui en fait des chaussées.
 *
 * @param {Object} [roads] Tranche `theme.roads` (profils de chaussée).
 * @returns {Array<{profile:string, halfWidth:number, points:Array}>}
 */
export function collectRoadLines(source, tiles, frame, roads = defaultTheme.roads) {
  const { origin, scale, zoom } = frame;
  const lines = [];

  source.forEachFeature('transportation', tiles, (geometry, properties) => {
    const style = roadStyleFor(properties, roads.profiles);
    if (!style) return;

    for (const line of roadLines(geometry)) {
      if (!Array.isArray(line) || line.length < 2) continue;

      const points = [];
      for (const [lng, lat] of line) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        points.push({
          x: (lngToTileX(lng, zoom) - origin.x) * scale,
          z: (latToTileY(lat, zoom) - origin.y) * scale,
        });
      }
      if (points.length < 2) continue;
      lines.push({ profile: style.profile, halfWidth: style.halfWidth, points });
    }
  });

  return lines;
}

/**
 * Distance depuis le dernier nœud d'ancrage, sommet par sommet. L'ancrage est
 * pris au dernier carrefour ou cul-de-sac rencontré (un point stable, que le
 * découpage ignore), pas au début de la chaîne qui bouge avec les tuiles chargées.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {Array<boolean>} anchors
 * @returns {{distance: Float64Array, anchorIndex: Int32Array}}
 */
export function anchorDistances(points, anchors) {
  const rows = points.length;
  const distance = new Float64Array(rows);
  const anchorIndex = new Int32Array(rows);
  let travelled = 0;
  let anchorTravelled = 0;
  let anchor = 0;

  for (let i = 0; i < rows; i++) {
    if (i > 0) travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (anchors?.[i]) {
      anchor = i;
      anchorTravelled = travelled;
    }
    distance[i] = travelled - anchorTravelled;
    anchorIndex[i] = anchor;
  }

  return { distance, anchorIndex };
}

/**
 * Extrait les tronçons de chaussée d'un jeu de tuiles, ré-échantillonnés et
 * dressés de niveau. Contrat entre la chaussée et son mobilier : les deux ont
 * besoin exactement des mêmes tronçons. `platform` porte l'altitude de
 * plate-forme, déjà lissée. `anchor`/`startDistance` se comptent depuis le
 * dernier nœud d'ancrage, pas le début du tronçon découpé.
 *
 * @param {Object} source Instance `VectorTileSource`.
 * @param {Array} tiles   Tuiles à parcourir.
 * @param {{x:number,z:number}} here Position locale de l'observateur.
 * @param {Object} frame  Repère local de la bulle (`bubble.frame`).
 * @param {Function} sampleElevation `(x, z) => altitude en mètres`. Doit lire le
 *        terrain **naturel** : la plate-forme décide du déblai, elle ne peut
 *        donc pas être lue sur un terrain déjà entaillé.
 * @param {number} [radius]
 * @param {Object} [roads] Tranche `theme.roads` (profils de chaussée).
 * Les carrefours sortent d'ici avec les tronçons (ils viennent du même graphe).
 *
 * @returns {{segments: Array<Object>, junctions: Array<Object>}} tronçons
 *          `{profile, halfWidth, path, startDistance, anchor, platform, edges}`
 *          et carrefours dans la portée demandée.
 */
export function collectRoadSegments(
  source,
  tiles,
  here,
  frame,
  sampleElevation,
  radius = ROAD_RADIUS_M,
  roads = defaultTheme.roads
) {
  const out = [];
  const { chains: merged, junctions } = mergeRoadLines(collectRoadLines(source, tiles, frame, roads));
  // Rogner avant de ré-échantillonner : les distances doivent se compter sur la chaîne telle qu'elle sera dessinée.
  const chains = trimAtJunctions(merged, junctions);

  for (const chain of chains) {
    const { distance: sinceAnchor, anchorIndex } = anchorDistances(chain.points, chain.anchors);

    for (const run of clipToRadius(chain.points, here.x, here.z, radius)) {
      const path = resamplePath(run.points, ROAD_SAMPLE_M);
      if (path.length < 2) continue;

      const frames = pathFrames(path);
      const rows = path.length;
      const platform = new Float32Array(rows);
      // Rives élargies : sur la seule largeur de la chaussée, le bruit du MNT dominerait la pente mesurée.
      const probe = chain.halfWidth + 4;
      const edges = new Float32Array(rows * 2);

      for (let r = 0; r < rows; r++) {
        platform[r] = levelRow(path, r, frames, chain.halfWidth, sampleElevation).deck;
        const wide = levelRow(path, r, frames, probe, sampleElevation);
        edges[r * 2] = wide.left;
        edges[r * 2 + 1] = wide.right;
      }
      smoothColumns(platform, rows, 1, 2);

      out.push({
        profile: chain.profile,
        halfWidth: chain.halfWidth,
        path,
        frames,
        startDistance: sinceAnchor[run.startIndex],
        anchor: chain.points[anchorIndex[run.startIndex]],
        platform,
        edges,
        probeSpan: probe * 2,
      });
    }
  }

  return {
    segments: out,
    junctions: junctions.filter((j) => Math.hypot(j.x - here.x, j.z - here.z) <= radius),
  };
}

/**
 * Tirage stable dans [0, 1[ attaché à un point du sol. Il ne sert qu'à
 * départager deux rubans coplanaires, donc il n'a besoin que d'être stable et
 * bien réparti — pas d'être une bonne source d'aléa.
 */
function tieBreakAt(point) {
  if (!point) return 0;
  let h = (Math.round(point.x) * 73856093) ^ (Math.round(point.z) * 19349663);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export class RoadNetwork {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble    Instance `TerrainBubble`.
   * @param {Record<string, Object>} options.materials Matériau par clé de profil.
   */
  constructor({ THREE, scene, bubble, materials, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.segments = 0;
    this._anchor = null;
    this._frame = null;
    this._surface = -1;

    this.materials = materials;
    /** @type {Record<string, Object|null>} un maillage par profil rencontré. */
    this.meshes = {};
    /** Tronçons de la dernière reconstruction : le mobilier s'y branche pour la même plate-forme. @type {Array<Object>} */
    this.roadSegments = [];
    /** Index spatial des chaussées construites (herbe, recouture des carrefours). @type {RoadIndex|null} */
    this.index = null;
    /** Carrefours de la dernière reconstruction (un feu n'a de sens qu'à un carrefour). @type {Array<Object>} */
    this.junctions = [];
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    // Une maille de terrain qui s'affine remonte sous une plate-forme dressée à l'ancienne résolution.
    if (this._surface !== this.bubble?.surfaceGeneration) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= ROAD_REBUILD_M;
  }

  /**
   * Reconstruit le réseau depuis les tuiles déjà décodées.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const { bubble } = this;
    // Terrain naturel, déblai exclu : la plate-forme décide de l'entaille, elle ne peut pas en dépendre.
    const sampleElevation = (x, z) => bubble.rawSurfaceElevationAtLocal(x, z, 0) * bubble.verticalScale;

    const { segments: collected, junctions } = collectRoadSegments(
      source,
      tiles,
      here,
      bubble.frame,
      sampleElevation,
      ROAD_RADIUS_M,
      this.theme.roads
    );
    // La marge doit couvrir toute la portée du déblai, raccord compris ;
    // laissée à sa valeur par défaut, l'entaille finissait en marche verticale.
    const index = new RoadIndex(collected, { margin: ROAD_CUT_M + ROAD_CUT_BLEND_M });
    stitchPlatforms(collected, index);

    const buffers = {};
    let segments = 0;

    for (const segment of collected) {
      if (!buffers[segment.profile]) buffers[segment.profile] = createRibbonBuffer();
      const added = appendRibbon(buffers[segment.profile], {
        path: segment.path,
        halfWidth: segment.halfWidth,
        sampleElevation,
        platform: segment.platform,
        lift: roadLiftFor(segment.profile, tieBreakAt(segment.anchor)),
        textureLength: ROAD_TEXTURE_LENGTH, // pas au sol constant, quelle que soit la largeur
      });
      if (added) segments++;
    }

    this.roadSegments = collected;
    this.junctions = junctions;
    this.index = index;
    this.segments = segments;
    this.bubble.setRoadCut(segments > 0 ? index : null);
    // Tous les profils sont visités, y compris ceux sans géométrie cette fois : leur ancien maillage doit disparaître.
    for (const profile of ROAD_PROFILE_ORDER) {
      this._applyBuffer(profile, buffers[profile] || createRibbonBuffer());
    }
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    this._surface = this.bubble.surfaceGeneration;
    return segments > 0;
  }

  _applyBuffer(profile, buffer) {
    const { THREE } = this;
    const geometry = toGeometry(THREE, buffer);
    const existing = this.meshes[profile];

    if (!geometry) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        this.meshes[profile] = null;
      }
      return;
    }

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.materials[profile]);
    mesh.name = `road-${profile}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    // Après le terrain, dans l'ordre de la hiérarchie : la voie la plus importante se dessine par-dessus.
    mesh.renderOrder = 1 + (ROAD_PROFILE_ORDER.length - ROAD_PROFILE_ORDER.indexOf(profile));
    this.scene.add(mesh);
    this.meshes[profile] = mesh;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.roadSegments = [];
    this.index = null;
    this.bubble?.setRoadCut?.(null); // sinon un changement d'observateur laisse des tranchées vides
    for (const profile of Object.keys(this.meshes)) {
      const mesh = this.meshes[profile];
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes[profile] = null;
    }
  }
}
