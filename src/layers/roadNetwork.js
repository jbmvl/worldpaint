/*
 * roadNetwork — le réseau routier, pas seulement la route de l'observateur.
 * -------------------------------------------------------------------
 * Les chaussées viennent de la couche `transportation` des tuiles
 * vectorielles, avec leurs attributs OpenMapTiles : `class` donne la largeur et
 * le revêtement, `brunnel` distingue tunnels et ponts. Le schéma n'est pas
 * deviné — il se lit dans les filtres des styles `outdoors-*.json`, que
 * l'application utilise déjà.
 *
 * Les tuiles ne livrent pas des routes mais des morceaux de routes, coupés à
 * chaque frontière et à chaque changement d'attribut. `roadGraph.js` les
 * recoud avant qu'on en fasse quoi que ce soit : c'est lui qui décide ce qui
 * est une seule et même chaussée, et à quelle altitude deux voies qui se
 * croisent doivent se rejoindre.
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

/**
 * Matériaux de chaussée, un par profil. Sept appels de rendu au lieu d'un
 * atlas : c'est le prix d'un marquage qui ne s'étire pas, et il est modeste
 * devant ce qu'il évite.
 */
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
      // Chaussée et terrain sont quasi coplanaires : sans décalage de
      // profondeur, ils se disputent le pixel et la route clignote.
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
     * Mouille la chaussée.
     *
     * Le bitume est ce qui change le plus visiblement sous la pluie, et le
     * changement est presque entièrement un assombrissement : le film d'eau
     * emprisonne la lumière au lieu de la renvoyer. On passe par `material.color`,
     * qui multiplie la texture de chaussée, plutôt que par la texture elle-même
     * — le marquage au sol reste net et rien n'est à redessiner. La teinte
     * dessinée dans `createRoadCanvas`, elle, n'est pas touchée : c'est le
     * thème, et la météo ne fait que la moduler.
     *
     * @param {number} value De 0 (sec) à 1 (trempé).
     */
    setWetness(value) {
      const wet = Math.min(1, Math.max(0, value || 0));
      // Légèrement moins sombre dans le bleu : une chaussée mouillée renvoie le
      // ciel, elle ne vire pas au brun.
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
 * Hiérarchie des profils, **par largeur décroissante**.
 *
 * Elle sert à départager les carrefours : deux rubans coplanaires se disputent
 * le pixel, et le décalage de profondeur ne tranche pas entre eux. Deux
 * centimètres d'écart par rang suffisent à donner la priorité à la voie la plus
 * large, sans se voir sous un angle rasant. Le premier rang reste à
 * `ROAD_LIFT_M`, hauteur à laquelle roule l'observateur.
 *
 * C'est bien la largeur qui ordonne, pas l'importance administrative : à un
 * croisement, c'est la chaussée la plus large qui doit passer par-dessus, quel
 * que soit son classement. Un chemin d'exploitation est plus large qu'une piste
 * cyclable et vient donc avant elle.
 */
export const ROAD_PROFILE_ORDER = ['express', 'major', 'minor', 'lane', 'track', 'cycleway', 'path'];
const ROAD_RANK_STEP_M = 0.02;

/**
 * Décollement d'un profil : les voies secondaires passent sous les grandes.
 *
 * `tieBreak`, dans [0, 1[, départage deux chaussées **de même profil** qui se
 * croisent — deux départementales, par exemple. Sans lui, leurs rubans sont
 * exactement coplanaires au croisement et le pixel se met à clignoter. Le
 * décalage vaut au plus la moitié d'un rang, donc la hiérarchie des profils
 * reste intacte, et cinq millimètres ne se voient pas sous un angle rasant.
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
 * Style de chaussée d'une entité, ou `null` si elle ne doit pas être dessinée.
 *
 * Un tunnel est écarté : le MNT ne connaît pas le relief au-dessus, donc le
 * dessiner en surface poserait une route en travers d'une montagne. Rails,
 * transports guidés et lignes de ferry n'ont rien à faire dans un revêtement,
 * et un escalier encore moins dans un ruban continu.
 *
 * `subclass` affine `class` : le schéma range piste cyclable, sentier et
 * escalier sous la même classe `path`, et seule la sous-classe les sépare.
 *
 * Fonction pure.
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
 *
 * Une chaussée qui traverse la bulle de part en part ne doit pas être écartée
 * parce que ses extrémités sont dehors, ni conservée entière parce qu'un point
 * est dedans : il faut la couper. Fonction pure.
 *
 * Chaque tronçon rapporte la distance parcourue **avant** son premier point,
 * dans la ligne d'origine, et l'indice de ce premier point. C'est ce qui permet
 * au mobilier espacé — bornes, lampadaires, poteaux — de rester à sa place
 * quand le découpage se déplace avec l'observateur : sans ça, chaque
 * reconstruction repartirait de zéro et tout glisserait de quelques mètres,
 * tous les 250 mètres.
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
        // On garde le point précédent, dehors : sans lui le tronçon
        // commencerait pile sur la frontière du disque, bord franc à l'appui.
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
 *
 * Étape séparée parce qu'elle est incomplète en soi : ce qui en sort, ce sont
 * des morceaux — la même route revient d'une tuile à l'autre, coupée à des
 * endroits qui n'existent pas au sol. C'est `mergeRoadLines` qui en fait des
 * chaussées.
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
 * Distance depuis le dernier nœud d'ancrage, sommet par sommet.
 *
 * Le mobilier espacé se compte depuis une origine, et cette origine ne peut pas
 * être le début de la chaîne : une chaîne s'arrête là où s'arrêtent les tuiles
 * chargées, et ce bout-là bouge. Elle est donc prise au dernier carrefour ou
 * cul-de-sac rencontré — un point que la donnée porte, que le découpage ignore,
 * et qui ne bouge jamais. Fonction pure.
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
 * dressés de niveau.
 *
 * Cette fonction est le **contrat** entre la chaussée et son mobilier. Les deux
 * ont besoin exactement des mêmes tronçons — le ruban pour les dessiner, le
 * mobilier pour border ceux qui surplombent le vide —, et les recalculer deux
 * fois ferait diverger l'un de l'autre au premier réglage modifié.
 *
 * `platform` porte l'altitude de la plate-forme ligne par ligne, déjà lissée :
 * c'est sur elle que se posent glissières et bornes, pas sur le terrain nu.
 *
 * `anchor` et `startDistance` se comptent depuis le dernier nœud d'ancrage, pas
 * depuis le début du tronçon découpé : c'est ce qui fixe les lampadaires au sol
 * et fixe le côté de la haie.
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
 * Les carrefours sortent d'ici avec les tronçons, et pour la même raison : ils
 * viennent du graphe, et les recalculer ailleurs les ferait tomber ailleurs.
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
  // Rogner avant de ré-échantillonner : les distances d'ancrage et la
  // plate-forme se comptent sur la chaîne telle qu'elle sera dessinée, pas sur
  // celle qui traversait encore le carrefour.
  const chains = trimAtJunctions(merged, junctions);

  for (const chain of chains) {
    const { distance: sinceAnchor, anchorIndex } = anchorDistances(chain.points, chain.anchors);

    for (const run of clipToRadius(chain.points, here.x, here.z, radius)) {
      const path = resamplePath(run.points, ROAD_SAMPLE_M);
      if (path.length < 2) continue;

      const frames = pathFrames(path);
      const rows = path.length;
      const platform = new Float32Array(rows);
      // Rives élargies : mesurée sur la seule largeur de la chaussée, la
      // pente en travers serait dominée par le bruit métrique du MNT.
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
    /**
     * Tronçons de la dernière reconstruction, tels que `collectRoadSegments`
     * les a produits. Le mobilier de bord de route s'y branche : il lui faut
     * exactement la même plate-forme que celle sur laquelle roule l'observateur.
     * @type {Array<Object>}
     */
    this.roadSegments = [];
    /**
     * Index spatial des chaussées construites. L'herbe s'en sert pour ne pas
     * pousser sur le bitume, et la recouture des carrefours pour savoir quelle
     * chaussée passe où.
     * @type {RoadIndex|null}
     */
    this.index = null;
    /**
     * Carrefours de la dernière reconstruction, relevés sur le graphe routier.
     * Publiés parce qu'un feu tricolore n'a de sens qu'à un carrefour, et que
     * le mobilier n'a pas le graphe — il n'a que des tronçons déjà découpés,
     * où un croisement ne se lit plus.
     * @type {Array<Object>}
     */
    this.junctions = [];
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    // Même raison que pour l'eau : une maille de terrain qui s'affine remonte
    // sous une plate-forme dressée à l'ancienne résolution, et le versant
    // amont finit par recouvrir la chaussée.
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
    // Terrain **naturel**, déblai exclu : la plate-forme décide de l'entaille,
    // elle ne peut donc pas en dépendre. La lire sur le terrain déjà entaillé
    // ferait descendre la route un peu plus à chaque reconstruction.
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
    // L'index vient avant la recouture, qui s'en sert, et reste disponible
    // ensuite : c'est lui qui dit à l'herbe où est le bitume, et au terrain où
    // il doit être entaillé.
    //
    // La marge doit couvrir toute la portée du déblai, raccord compris. Laissée
    // à sa valeur par défaut, elle tronquait le raccord à trois mètres de la
    // rive : l'entaille se terminait alors par une marche verticale au tiers de
    // sa profondeur, tout le long de la route.
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
        // Les marquages gardent leur pas au sol quelle que soit la largeur de
        // la chaussée : sans ça, une nationale aurait des pointillés deux fois
        // plus longs qu'un chemin.
        textureLength: ROAD_TEXTURE_LENGTH,
      });
      if (added) segments++;
    }

    this.roadSegments = collected;
    this.junctions = junctions;
    this.index = index;
    this.segments = segments;
    // Le terrain doit maintenant être taillé le long de ces chaussées-là. La
    // recreuse passe par la file de la bulle, une tuile par image.
    this.bubble.setRoadCut(segments > 0 ? index : null);
    // Tous les profils sont visités, y compris ceux sans géométrie cette
    // fois-ci : leur maillage précédent doit disparaître.
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
    // Après le terrain, et dans l'ordre de la hiérarchie : à un carrefour, la
    // voie la plus importante se dessine par-dessus la plus modeste.
    mesh.renderOrder = 1 + (ROAD_PROFILE_ORDER.length - ROAD_PROFILE_ORDER.indexOf(profile));
    this.scene.add(mesh);
    this.meshes[profile] = mesh;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.roadSegments = [];
    this.index = null;
    // Le terrain ne doit plus être entaillé par des chaussées qui n'existent
    // plus : sans ça, un changement d'observateur laisserait des tranchées vides.
    this.bubble?.setRoadCut?.(null);
    for (const profile of Object.keys(this.meshes)) {
      const mesh = this.meshes[profile];
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes[profile] = null;
    }
  }
}
