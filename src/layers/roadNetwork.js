/*
 * roadNetwork — le réseau routier, pas seulement la route de l'observateur.
 * Les chaussées viennent de la couche `transportation` (`class` pour la
 * largeur et le revêtement, `brunnel` pour tunnels et ponts, `layer` pour le
 * niveau de croisement), livrées en morceaux coupés à chaque frontière de
 * tuile. `roadGraph.js` les recoud avant qu'on en fasse quoi que ce soit.
 *
 * Le niveau (`segment.levels`, un entier par ligne) n'est **pas** une
 * altitude et rien ici n'en déduit de hauteur — voir `roadWorks.js`. Il ne
 * sert qu'à dire si deux chaussées qui se touchent en plan se rencontrent
 * vraiment ; le graphe s'en sert pour ne plus souder ce qui se survole, et
 * `crossedDeckAt` pour ne jamais donner de gabarit à ce qui passe au-dessus
 * d'une travée plutôt qu'en dessous.
 *
 * Un ouvrage d'art n'est pas une classe de route : c'est un état de la
 * chaussée, ligne par ligne (`roadWorks.js`). Il traverse donc ce module comme
 * un tableau parallèle au tracé — `segment.works` —, et non comme un profil de
 * plus. Trois conséquences ici :
 *
 *   - le tunnel n'est plus jeté à la lecture des tuiles (il l'était : la route
 *     s'arrêtait net au pied de la colline). Il reste dans le graphe, garde la
 *     numérotation du mobilier, et c'est le **ruban** qui saute ses lignes ;
 *   - la plate-forme d'une travée est tendue entre ses appuis
 *     (`levelWorkSpans`) au lieu d'épouser le fond de vallée. Elle passe après
 *     l'aplanissement du profil en long (`flattenGrade`) et non avant : les
 *     appuis d'un pont sont la route telle qu'elle sera vraiment, terrassement
 *     compris. C'est tout ce qu'il faut pour que les deux systèmes s'entendent
 *     — le terrassier tend la pente dans la bande qu'un ouvrage rattrape, le
 *     tablier prend le relais là où plus rien ne tient au sol ;
 *   - ce qu'un pont ne doit pas toucher lui vient de deux sources : le plancher
 *     (le terrain, majoré d'une revanche là où le sol est de l'eau) est donné
 *     de l'extérieur, par la carte d'occupation du sol ; le
 *     gabarit — la chaussée qu'il enjambe — se lit ici, et ne peut pas l'être
 *     ailleurs, puisqu'il faut que **tous** les tronçons soient dressés pour
 *     savoir lequel passe sous lequel. D'où les deux passes de
 *     `collectRoadSegments`.
 *
 * ## Le marquage
 *
 * La chaussée pose aussi son **marquage** (`roadMarkings`), et il ne peut pas
 * être posé ailleurs : il se pose plage dessinable par plage dessinable, sur
 * les mêmes morceaux que le ruban, ce qui est la seule façon qu'il s'arrête où
 * la chaussée s'arrête — au pied d'un tunnel comme à la bouche d'un carrefour.
 * Il tient dans un seul maillage pour tout le réseau : une couleur, pas de
 * texture, rien qui dépende de la classe de la route une fois le trait choisi.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import {
  mergeRoadLines,
  RoadIndex,
  knownCoverage,
  stitchPlatforms,
} from './roadGraph.js';
import {
  JunctionAreas,
  branchYields,
  markJunctionRows,
  junctionCentreDeck,
  junctionRibbonRuns,
  junctionSurface,
} from './roadJunctions.js';
import {
  MARKING_BAR_M,
  MARKING_LIFT_M,
  MOUTH_CROSSING_M,
  approachLane,
  appendMarkingBar,
  appendMarkingLine,
  markingLinesFor,
  sectionAtDistance,
} from './roadMarkings.js';
import { ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../terrain/roadCut.js';
import {
  workCodeFor,
  roadLevelFor,
  resampleWorks,
  resampleLevels,
  levelWorkSpans,
  drawableRuns,
  bridgeFreeboardFor,
  BRIDGE_CROSSING_COS,
  LEVEL_GROUND,
} from './roadWorks.js';
import {
  resamplePath,
  createRibbonBuffer,
  createProfileBuffer,
  appendRibbon,
  toGeometry,
  toColoredGeometry,
  pathFrames,
  levelRow,
  flattenGrade,
} from './ribbonGeometry.js';
import { srgb } from '../core/color.js';
import { ROAD_TEXTURE_LENGTH, createRoadCanvas } from '../materials/proceduralTextures.js';
import { defaultTheme } from '../themes/default.js';

/** Graines distinctes : deux profils voisins ne doivent pas avoir le même grain. */
const ROAD_JUNCTION_SEED = 6101;
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
 * Revêtements dont une surface de carrefour peut être faite : ceux que portent
 * les profils de chaussée. Le ballast n'en est pas — c'est une voie ferrée.
 */
export function junctionSurfaces(roads = defaultTheme.roads) {
  const used = new Set();
  for (const profile of Object.values(roads.profiles)) used.add(profile.surface || 'asphalt');
  return [...used].filter((surface) => roads.surfaces[surface]).sort();
}

/**
 * Matériaux de chaussée : un par profil (sept appels de rendu, prix d'un
 * marquage qui ne s'étire pas), plus **un par revêtement** pour les surfaces
 * de carrefour.
 *
 * Un carrefour ne peut pas porter la matière d'un ruban, et ce n'est pas une
 * question de coût : la texture d'un profil est dessinée à l'échelle de sa
 * largeur, alors qu'une surface de carrefour n'a ni milieu, ni bords, ni sens
 * de marche. Elle prend donc le même revêtement et le même grain, sans plus.
 *
 * Le marquage, lui, n'est plus dans aucune des deux textures : il est de la
 * géométrie (`roadMarkings`), posée dans les mêmes morceaux que le ruban, donc
 * découpée par les carrefours sans règle supplémentaire. D'où une troisième
 * matière, sans texture : celle de la peinture.
 */
export function createRoadMaterials(THREE, roads = defaultTheme.roads) {
  const entries = {};
  const junctions = {};

  for (const surface of junctionSurfaces(roads)) {
    const texture = new THREE.CanvasTexture(
      createRoadCanvas({ width: 8, surface, shoulder: 0, texture: 128 }, ROAD_JUNCTION_SEED, roads)
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    // Répétée dans les deux sens : les UV d'un carrefour sont pris au sol.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    const material = new THREE.MeshLambertMaterial({
      map: texture,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    material.name = `junction-${surface}`;
    entries[`junction:${surface}`] = { texture, material };
    junctions[surface] = material;
  }

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

  // Le marquage : une seule matière pour tout ce qui est peint au sol, sans
  // texture — un trait blanc n'a pas de grain. Son décalage de profondeur est
  // le double de celui de la chaussée : il doit gagner contre elle, sur
  // laquelle il est posé, comme elle gagne contre le terrain.
  const markings = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });
  markings.name = 'road-markings';

  return {
    /** @type {Record<string, Object>} matériau par clé de profil. */
    byProfile: Object.fromEntries(
      Object.entries(roads.profiles).map(([k]) => [k, entries[k].material])
    ),
    /** @type {Record<string, Object>} matériau de surface de carrefour, par revêtement. */
    junctions,
    /** @type {Object} matériau du marquage au sol. */
    markings,
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
      // Le marquage se mouille moins que le bitume : la peinture est fermée,
      // l'eau y fait un film au lieu d'y entrer. Même écart que le trottoir.
      const paint = 1 - wet * 0.3;
      markings.color.setRGB(paint, paint, paint + wet * 0.04);
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
      markings.dispose();
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
 * Terrassement consenti pour aplanir le profil en long (`flattenGrade`), en
 * mètres : ce dont la plate-forme s'autorise à s'écarter du terrain dressé
 * section par section.
 *
 * En rase campagne, presque rien — la route colle au sol, et c'est ce qu'on y
 * voit. Sur un versant, en revanche, elle ne le suit plus : le terrassier
 * tend sa pente et l'ouvrage rattrape la différence (la falaise du déblai en
 * amont, le mur de soutènement en aval). Sans cette bande, une route de
 * corniche ondulerait au rythme du bruit du MNT, chaque section étant dressée
 * pour elle-même.
 *
 * Le déblai est plus généreux que le remblai : entailler un versant coûte
 * moins cher que le porter, et se voit moins.
 */
export const ROAD_GRADE_CUT_FLAT_M = 0.5;
export const ROAD_GRADE_CUT_STEEP_M = 4;
export const ROAD_GRADE_FILL_FLAT_M = 0.4;
export const ROAD_GRADE_FILL_STEEP_M = 3;
/** Devers entre lesquels on passe d'un régime à l'autre. */
export const ROAD_GRADE_FLAT_SLOPE = 0.05;
export const ROAD_GRADE_STEEP_SLOPE = 0.3;

/**
 * Terrassement consenti à un devers donné, en mètres. Fonction pure.
 *
 * @param {number} slope Pente en travers, en valeur absolue.
 * @returns {{cut:number, fill:number}} enfoncement et exhaussement tolérés.
 */
export function gradeAllowance(slope) {
  const span = ROAD_GRADE_STEEP_SLOPE - ROAD_GRADE_FLAT_SLOPE;
  const t = Math.min(1, Math.max(0, ((slope || 0) - ROAD_GRADE_FLAT_SLOPE) / span));
  const eased = t * t * (3 - 2 * t);
  return {
    cut: ROAD_GRADE_CUT_FLAT_M + (ROAD_GRADE_CUT_STEEP_M - ROAD_GRADE_CUT_FLAT_M) * eased,
    fill: ROAD_GRADE_FILL_FLAT_M + (ROAD_GRADE_FILL_STEEP_M - ROAD_GRADE_FILL_FLAT_M) * eased,
  };
}

/**
 * Hiérarchie des profils, par largeur décroissante. Elle n'ordonne plus que le
 * **dessin** : deux chaussées que la donnée dit sans rencontre (aucun nœud
 * partagé, aucun niveau différent — c'est-à-dire une erreur de saisie) doivent
 * bien se départager, et la plus large gagne.
 *
 * Elle ne départage plus les carrefours, et c'est tout le sujet : chaque
 * profil se décollait de deux centimètres de plus que le précédent, plus un
 * millimètre tiré au hasard du lieu, parce que deux rubans s'y recouvraient
 * franchement. Ils ne se recouvrent plus — `roadJunctions` leur donne une
 * surface commune, et **toutes** les chaussées s'arrêtent à sa bouche. Le
 * décollement est donc redevenu le même pour toutes (`ROAD_LIFT_M`), ce qui
 * est aussi la condition pour que la bouche d'une petite rue affleure la
 * surface du carrefour au lieu de passer deux centimètres dessous.
 */
export const ROAD_PROFILE_ORDER = ['express', 'major', 'minor', 'lane', 'track', 'cycleway', 'path'];

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
 * `subclass` affine `class` : piste cyclable, sentier et escalier partagent la
 * même classe `path`.
 *
 * Un tunnel n'est plus écarté ici : il porte son code d'ouvrage (`works`) et
 * traverse le graphe comme le reste de sa route, pour que la chaîne, ses
 * ancres et son mobilier ne se coupent pas au pied de la colline. C'est le
 * ruban qui saute ses lignes, et `bridgeLayer` qui pose ses têtes.
 */
export function roadStyleFor(properties = {}, profiles = defaultTheme.roads.profiles) {
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
    works: workCodeFor(properties.brunnel),
    level: roadLevelFor(properties),
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
      lines.push({
        profile: style.profile,
        halfWidth: style.halfWidth,
        points,
        works: style.works,
        level: style.level,
      });
    }
  });

  return lines;
}

/**
 * Distance depuis le nœud d'ancrage, sommet par sommet, et rang de ce nœud.
 *
 * L'ancrage est un carrefour ou un changement de classe — un point que la
 * donnée porte, et que le découpage ignore. C'est de lui que se comptent les
 * bornes, les lampadaires et les arbustes d'une haie, et c'est lui qui tire le
 * côté de la ligne téléphonique et l'essence d'un alignement : il ne doit donc
 * dépendre en rien de l'endroit d'où l'on regarde.
 *
 * Le nœud retenu est **le dernier rencontré**, et à défaut **le premier à
 * venir** : une chaîne commence là où la donnée s'arrête, c'est-à-dire au bord
 * mouvant des tuiles chargées, et ses premières lignes n'ont donc rien de
 * stable derrière elles. Se rabattre en avant leur donne un nœud réel ; la
 * distance y est alors négative, ce que `spacedAlongPath` traite sans rien de
 * particulier (c'est une phase, pas une longueur). Une chaîne sans aucun nœud
 * — une voie isolée dans toute la fenêtre — retombe sur son premier sommet,
 * faute de mieux.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {Array<boolean>} anchors
 * @returns {{distance: Float64Array, anchorIndex: Int32Array}}
 */
export function anchorDistances(points, anchors) {
  const rows = points.length;
  const distance = new Float64Array(rows);
  const anchorIndex = new Int32Array(rows);
  const travelled = new Float64Array(rows);

  for (let i = 1; i < rows; i++) {
    travelled[i] =
      travelled[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }

  let behind = -1;
  for (let i = 0; i < rows; i++) {
    if (anchors?.[i]) behind = i;
    anchorIndex[i] = behind;
  }

  let ahead = -1;
  for (let i = rows - 1; i >= 0; i--) {
    if (anchors?.[i]) ahead = i;
    if (anchorIndex[i] < 0) anchorIndex[i] = ahead;
  }

  for (let i = 0; i < rows; i++) {
    if (anchorIndex[i] < 0) anchorIndex[i] = 0;
    distance[i] = travelled[i] - travelled[anchorIndex[i]];
  }

  return { distance, anchorIndex };
}

/**
 * Ce qu'une travée doit passer en gabarit à chacune de ses lignes : la
 * chaussée qu'elle enjambe, ou rien.
 *
 * C'est la seule chose qui relève un tablier au-dessus de ses appuis, avec le
 * plancher. Le terrain, lui, ne compte pas : un pont franchit un pré à
 * l'altitude du pré, et le relever de cinq mètres parce qu'il y a de l'herbe
 * dessous met la campagne sur pilotis.
 *
 * Deux garde-fous, sans quoi une travée se relèverait au-dessus d'elle-même :
 * le tronçon qui la porte est exclu de la recherche (sa propre culée est
 * inscrite dans l'index, à distance nulle de sa première ligne), et une
 * chaussée qui suit la même direction n'est pas croisée — c'est la route
 * d'approche, ou la même route à un autre découpage.
 *
 * @param {RoadIndex} index   Index bâti sur tous les tronçons dressés.
 * @param {Object} segment    Le tronçon qui porte la travée.
 * @param {number} si         Son rang dans les tronçons de l'index.
 * @param {number} [cos]      Cosinus de non-croisement (`BRIDGE_CROSSING_COS`).
 * @returns {Function} `(x, z, r) => altitude de la chaussée croisée`, `NaN`
 *          s'il n'y en a pas.
 */
export function crossedDeckAt(index, segment, si, cos = BRIDGE_CROSSING_COS) {
  return (x, z, r) => {
    const hit = index.query(x, z, 0, (_, oi) => oi !== si);
    if (!hit) return NaN;

    // Une travée ne se relève que sur ce qu'elle passe **au-dessus**. Une
    // chaussée d'un niveau supérieur passe au-dessus d'elle : lui laisser du
    // gabarit reviendrait à la pousser dans le tablier qui la franchit.
    const mine = segment.levels?.[r] ?? LEVEL_GROUND;
    const theirs = hit.segment.levels?.[hit.row] ?? LEVEL_GROUND;
    if (theirs > mine) return NaN;

    const a = hit.segment.path[hit.row];
    const b = hit.segment.path[hit.row + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dot =
      ((b.x - a.x) / length) * segment.frames[r * 4] +
      ((b.z - a.z) / length) * segment.frames[r * 4 + 1];
    if (Math.abs(dot) > cos) return NaN;

    const deck = index.deckAt(hit);
    return deck == null ? NaN : deck;
  };
}

/**
 * Extrait les tronçons de chaussée d'un jeu de tuiles, ré-échantillonnés et
 * dressés de niveau. Contrat entre la chaussée et son mobilier : les deux ont
 * besoin exactement des mêmes tronçons. `platform` porte l'altitude de
 * plate-forme, déjà aplanie en long (`flattenGrade`) puis tendue sur les
 * travées (`levelWorkSpans`) — c'est elle, et non le terrain, que suivent la
 * falaise du déblai, le mur de soutènement et le tablier d'un pont.
 * `anchor`/`startDistance` se comptent depuis le dernier nœud d'ancrage, pas
 * le début du tronçon découpé.
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
 * @param {Object} [options]
 * @param {Function} [options.floorAt] `(x, z) => altitude plancher`, en mètres
 *        de scène — le terrain, majoré d'une revanche au-dessus de l'eau.
 *        Une travée s'y pose sans garde : elle ne descend pas
 *        dessous, mais rien ne la relève au-dessus. Absente, les travées
 *        restent exactement tendues entre leurs appuis.
 *
 * Les carrefours sortent d'ici avec les tronçons (ils viennent du même graphe).
 *
 * @returns {{segments: Array<Object>, junctions: Array<Object>}} tronçons
 *          `{profile, halfWidth, path, startDistance, anchor, platform, edges,
 *          works}` et carrefours dans la portée demandée.
 */
export function collectRoadSegments(
  source,
  tiles,
  here,
  frame,
  sampleElevation,
  radius = ROAD_RADIUS_M,
  roads = defaultTheme.roads,
  { floorAt = null } = {}
) {
  const out = [];
  let anyWorks = false; // vrai dès qu'un tronçon porte un ouvrage
  const { chains, junctions } = mergeRoadLines(collectRoadLines(source, tiles, frame, roads));
  // Les carrefours deviennent des surfaces, en plan, avant tout le reste : ce
  // sont elles qui diront où chaque ruban s'arrête. Les chaînes, elles, ne sont
  // plus coupées — la chaussée traverse le carrefour dans les données, et seul
  // son ruban s'interrompt (voir l'en-tête de `roadJunctions`).
  const areas = new JunctionAreas(junctions);

  for (const chain of chains) {
    const { distance: sinceAnchor, anchorIndex } = anchorDistances(chain.points, chain.anchors);

    for (const run of clipToRadius(chain.points, here.x, here.z, radius)) {
      const path = resamplePath(run.points, ROAD_SAMPLE_M);
      if (path.length < 2) continue;

      // Les drapeaux d'ouvrage suivent le découpage : `clipToRadius` rend une
      // tranche contiguë de la chaîne, à partir de `startIndex`.
      const runWorks = resampleWorks(
        run.points,
        chain.works?.slice(run.startIndex, run.startIndex + run.points.length),
        path
      );
      // Le niveau de croisement suit le même découpage : c'est lui qui dira,
      // plus loin, si deux chaussées qui se touchent en plan se rencontrent.
      const runLevels = resampleLevels(
        run.points,
        chain.levels?.slice(run.startIndex, run.startIndex + run.points.length),
        path
      );

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
      // Aplanissement du profil en long, borné par ce que l'ouvrage tient à
      // cet endroit : le devers dit s'il y a un versant, donc une falaise et
      // un mur, pour rattraper l'écart au terrain.
      const maxCut = new Float32Array(rows);
      const maxFill = new Float32Array(rows);
      for (let r = 0; r < rows; r++) {
        const slope = Math.abs(edges[r * 2] - edges[r * 2 + 1]) / (probe * 2);
        const allowance = gradeAllowance(slope);
        maxCut[r] = allowance.cut;
        maxFill[r] = allowance.fill;
      }
      // Rien à retrancher à la bande de terrassement sur une ligne d'ouvrage :
      // ce que l'aplanissement y calcule est de toute façon réécrit par la
      // seconde passe, et chaque ligne étant bornée autour de son propre
      // terrain, une ligne de pont n'entraîne pas ses voisines au fond de la
      // vallée.
      flattenGrade(platform, { maxCut, maxFill });
      if (!anyWorks && runWorks.some((code) => code !== 0)) anyWorks = true;

      out.push({
        profile: chain.profile,
        halfWidth: chain.halfWidth,
        path,
        frames,
        startDistance: sinceAnchor[run.startIndex],
        anchor: chain.points[anchorIndex[run.startIndex]],
        platform,
        edges,
        works: runWorks,
        levels: runLevels,
        probeSpan: probe * 2,
      });
    }
  }

  // Les lignes prises par un carrefour, une fois les tronçons ré-échantillonnés.
  // Le ruban les sautera ; tout le reste (emprise, déblai, couture, mobilier,
  // trottoirs) continue de lire une route entière.
  if (areas.length > 0) {
    for (const segment of out) {
      segment.junction = markJunctionRows(segment, areas);
      // De quelles chaussées chaque aire est faite : ce qui borde un coin de
      // rue ne doit pas compter les branches du carrefour comme un obstacle.
      areas.noteFeeder(segment);
    }
  }

  // Passe 2 : les travées, une fois tous les tronçons dressés.
  //
  // Dans cet ordre-là, et pas l'inverse : la corde d'un pont se tend entre ses
  // appuis **tels qu'ils seront vraiment**, terrassement compris (aplanir après
  // reviendrait à rendre le tablier au terrain). Et il faut le réseau entier
  // pour savoir ce qu'une travée enjambe : la chaussée qui passe dessous est un
  // tronçon comme un autre, construit par la même boucle.
  if (anyWorks) {
    // Marge nulle : n'est croisée que la chaussée réellement survolée, pas son
    // accotement. L'index n'inscrit pas les lignes d'ouvrage, donc un pont ne
    // se relève jamais au-dessus d'un autre pont — ni au-dessus du sien.
    const grade = new RoadIndex(out, { margin: 0 });
    for (let si = 0; si < out.length; si++) {
      const segment = out[si];
      if (!segment.works.some((code) => code !== 0)) continue;
      levelWorkSpans(segment.path, segment.platform, segment.works, {
        clearanceAt: crossedDeckAt(grade, segment, si),
        floorAt,
      });
    }
  }

  return {
    segments: out,
    junctions: junctions.filter((j) => Math.hypot(j.x - here.x, j.z - here.z) <= radius),
    areas,
  };
}

export class RoadNetwork {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble    Instance `TerrainBubble`.
   * @param {{byProfile:Record<string,Object>, junctions:Record<string,Object>}}
   *        options.materials Retour de `createRoadMaterials`.
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
    /** @type {Record<string, Object|null>} un maillage de carrefours par revêtement. */
    this.junctionMeshes = {};
    /** @type {Object|null} maillage du marquage au sol. */
    this.markingMesh = null;
    /** Traits de marquage posés à la dernière reconstruction. */
    this.markings = 0;
    /** Surfaces de carrefour posées à la dernière reconstruction. */
    this.crossings = 0;
    /** Aires des carrefours (contours, bouches). @type {Object|null} */
    this.junctionAreas = null;
    /** Tronçons de la dernière reconstruction : le mobilier s'y branche pour la même plate-forme. @type {Array<Object>} */
    this.roadSegments = [];
    /** Index spatial des chaussées construites (herbe, recouture des carrefours). @type {RoadIndex|null} */
    this.index = null;
    /** Carrefours de la dernière reconstruction (un feu n'a de sens qu'à un carrefour). @type {Array<Object>} */
    this.junctions = [];
  }

  /**
   * Part d'un rectangle sur laquelle le réseau a quelque chose à dire : le
   * disque de `ROAD_RADIUS_M` autour du point où il a été construit. Ce qui
   * sème d'après l'emprise (la végétation) s'en sert pour savoir qu'il en sait
   * maintenant plus qu'à la plantation — voir `knownCoverage`.
   */
  knownCoverageOf(minX, minZ, maxX, maxZ) {
    if (this._frame !== this.bubble?.frame) return 0;
    return knownCoverage(minX, minZ, maxX, maxZ, this._anchor, ROAD_RADIUS_M);
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
   * @param {Object} [options]
   * @param {Object|null} [options.groundClass] Instance `GroundClassMap`, seule
   *        à savoir où est l'eau (elle en est la matière du sol) : un pont doit
   *        s'en dégager.
   */
  rebuild(source, tiles, here, { groundClass = null } = {}) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const { bubble } = this;
    // Terrain naturel, déblai exclu : la plate-forme décide de l'entaille, elle ne peut pas en dépendre.
    const sampleElevation = (x, z) => bubble.rawSurfaceElevationAtLocal(x, z, 0) * bubble.verticalScale;
    // Le plancher d'une travée : le terrain, majoré d'une revanche au-dessus
    // de l'eau. Ce n'est pas un gabarit — rien ne passe sous un pont de
    // rivière — mais une cote sous laquelle le tablier n'a rien à faire.
    const floorAt = (x, z, span) => {
      const ground = sampleElevation(x, z);
      if (groundClass?.coverAt(x, z) !== 'water') return ground;
      // La revanche suit la portée de l'ouvrage : c'est le seul indice
      // disponible sur ce qu'il franchit (voir `bridgeFreeboardFor`).
      return ground + bridgeFreeboardFor(span);
    };

    const { segments: collected, junctions, areas } = collectRoadSegments(
      source,
      tiles,
      here,
      bubble.frame,
      sampleElevation,
      ROAD_RADIUS_M,
      this.theme.roads,
      { floorAt }
    );
    // La marge doit couvrir toute la portée du déblai, raccord compris ;
    // laissée à sa valeur par défaut, l'entaille finissait en marche verticale.
    const index = new RoadIndex(collected, { margin: ROAD_CUT_M + ROAD_CUT_BLEND_M });
    stitchPlatforms(collected, index);

    const buffers = {};
    const markingBuffer = createProfileBuffer();
    const paint = srgb(this.theme.roads.markingColor);
    let segments = 0;
    let junctionsDrawn = 0;
    let markings = 0;

    for (const segment of collected) {
      if (!buffers[segment.profile]) buffers[segment.profile] = createRibbonBuffer();

      // Deux raisons, et une seule mécanique, de ne pas dessiner une ligne : le
      // tunnel (la route continue sous la colline) et le carrefour (la surface
      // commune prend le relais). Dans les deux cas la chaîne reste entière,
      // c'est le ruban qui se pose en morceaux. Les distances de texture sont
      // celles du tracé entier : le marquage ne se décale ni au ressortir d'un
      // tunnel ni au sortir d'un carrefour.
      const drawable = drawableRuns(segment.works, segment.path.length);
      for (const run of junctionRibbonRuns(segment, areas, drawable)) {
        const added = appendRibbon(buffers[segment.profile], {
          path: run.path,
          halfWidth: segment.halfWidth,
          sampleElevation,
          platform: run.platform,
          lift: ROAD_LIFT_M,
          textureLength: ROAD_TEXTURE_LENGTH, // pas au sol constant, quelle que soit la largeur
        });
        if (added) segments++;
        // Le marquage se pose sur la **même** plage que le ruban : il hérite
        // donc de sa découpe — tunnels et carrefours — sans règle à lui.
        markings += this._appendMarkings(markingBuffer, segment, run, areas, paint);
      }
    }

    // Les surfaces de carrefour, une fois les plate-formes cousues : un
    // carrefour prend l'altitude des chaussées qui y aboutissent, il n'en a pas
    // à lui. Une cote par bouche, relevée là où le ruban s'arrête : c'est ce
    // qui fait que la dalle et les rubans se rejoignent sans marche, sur un
    // versant comme à plat. Une aire dont aucune bouche ne porte d'altitude
    // (toutes hors de portée) n'est simplement pas posée.
    const junctionBuffers = {};
    for (const area of areas.areas) {
      const decks = area.mouths.map((mouth) => {
        const deck = index.deckAt(index.query(mouth.centre.x, mouth.centre.z, 1));
        return deck == null ? NaN : deck;
      });
      const centre = junctionCentreDeck(decks);
      if (!Number.isFinite(centre)) continue;
      // Retenues sur l'aire, sans le décollement : la voirie borde ce carrefour
      // et doit s'aligner sur les mêmes cotes, comme un trottoir de tronçon
      // s'aligne sur sa plate-forme. `deck` reste la cote du nœud — ce qui n'a
      // qu'un point à poser s'en contente ; `decks` sert à qui suit une rive.
      area.decks = decks;
      area.deck = centre;
      const surface = this._surfaceOf(area.profile);
      if (!junctionBuffers[surface]) junctionBuffers[surface] = createRibbonBuffer();
      const buffer = junctionBuffers[surface];
      const piece = junctionSurface(area, decks.map((deck) => deck + ROAD_LIFT_M), {
        textureLength: ROAD_TEXTURE_LENGTH,
        base: buffer.positions.length / 3,
      });
      if (!piece) continue;
      buffer.positions.push(...piece.positions);
      buffer.uvs.push(...piece.uvs);
      buffer.indices.push(...piece.indices);
      junctionsDrawn++;
    }

    this.roadSegments = collected;
    this.junctions = junctions;
    this.junctionAreas = areas;
    this.index = index;
    this.segments = segments;
    this.crossings = junctionsDrawn;
    this.markings = markings;
    // L'emprise entaillée, c'est la chaussée entière : les rubans et les dalles
    // de carrefour, qui débordent d'eux.
    this.bubble.setRoadCut(segments > 0 ? index : null, areas);
    // Tous les profils sont visités, y compris ceux sans géométrie cette fois : leur ancien maillage doit disparaître.
    for (const profile of ROAD_PROFILE_ORDER) {
      this._applyBuffer(profile, buffers[profile] || createRibbonBuffer());
    }
    for (const surface of Object.keys(this.materials.junctions || {})) {
      this._applyJunctionBuffer(surface, junctionBuffers[surface] || createRibbonBuffer());
    }
    this._applyMarkings(markingBuffer);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    this._surface = this.bubble.surfaceGeneration;
    return segments > 0;
  }

  /**
   * Le marquage d'une plage dessinable.
   *
   * Deux familles, et rien d'autre :
   *
   *   - les **lignes longitudinales** que le profil de la chaussée porte
   *     (`markingLinesFor`), sur toute la plage. Elles s'arrêtent donc pile où
   *     le ruban s'arrête, bouche de carrefour comprise ;
   *   - la **ligne d'effet** aux bouts qui butent sur un carrefour, et
   *     seulement du côté qui doit céder le passage (`branchYields`). Elle est
   *     posée au-delà de la profondeur réservée à une traversée
   *     (`MOUTH_CROSSING_M`) : c'est l'ordre réel d'un débouché, et c'est ce
   *     qui fait que la voirie peut y poser un passage piétons sans que les
   *     deux se recouvrent.
   *
   * Elle ne couvre que la **moitié droite** de la chaussée : c'est la voie qui
   * arrive, l'autre est celle qui repart. Le côté se déduit du sens dans lequel
   * on aborde le carrefour, donc du bout de la plage concerné.
   *
   * @returns {number} traits posés.
   */
  _appendMarkings(buffer, segment, run, areas, paint) {
    const spec = this.theme.roads.profiles[segment.profile];
    // Rien de peint sur une chaussée qui ne l'est pas : la terre ne porte pas
    // de marquage, et un chemin d'exploitation n'en a jamais eu.
    if (!spec || (spec.surface || 'asphalt') !== 'asphalt') return 0;

    const { path, platform } = run;
    if (!path || path.length < 2) return 0;
    const frames = pathFrames(path);
    const lift = ROAD_LIFT_M + MARKING_LIFT_M;
    let laid = 0;

    for (const line of markingLinesFor(spec, segment.halfWidth)) {
      laid += appendMarkingLine(buffer, {
        path,
        decks: platform,
        frames,
        offset: line.offset,
        dash: line.dash,
        color: paint,
        lift,
        startDistance: segment.startDistance || 0,
      });
    }

    // La demi-largeur peinte exclut l'accotement, qui n'est pas de la chaussée.
    const half = segment.halfWidth - (spec.shoulder || 0);
    if (!(half > 0)) return laid;

    for (const end of [
      { index: run.head, at: path[0].distance, forward: true },
      { index: run.tail, at: path[path.length - 1].distance, forward: false },
    ]) {
      const area = end.index >= 0 ? areas?.areas?.[end.index] : null;
      if (!area || !branchYields(area, segment.halfWidth)) continue;

      // S'éloigner du carrefour, c'est remonter la plage depuis sa tête et la
      // descendre depuis sa queue.
      const sign = end.forward ? 1 : -1;
      const near = sectionAtDistance(path, platform, frames, end.at + sign * MOUTH_CROSSING_M);
      const far = sectionAtDistance(
        path,
        platform,
        frames,
        end.at + sign * (MOUTH_CROSSING_M + MARKING_BAR_M)
      );
      // Plage trop courte pour porter la ligne d'effet à sa place : mieux vaut
      // ne rien peindre que la poser au milieu d'un carrefour.
      if (!near || !far) continue;

      laid += appendMarkingBar(buffer, {
        near,
        far,
        ...approachLane(half, end.forward),
        color: paint,
        lift,
      });
    }

    return laid;
  }

  /** Le marquage au sol, en un maillage : une seule matière pour tout le réseau. */
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

    const mesh = new THREE.Mesh(geometry, this.materials.markings);
    mesh.name = 'road-markings';
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    // Après les rubans **et** après les surfaces de carrefour : le marquage
    // est ce qu'on peint en dernier sur une chaussée, dans le rendu comme sur
    // le terrain.
    mesh.renderOrder = 1 + ROAD_PROFILE_ORDER.length + 2;
    this.scene.add(mesh);
    this.markingMesh = mesh;
  }

  /** Revêtement d'un profil : celui de sa surface de carrefour. */
  _surfaceOf(profile) {
    const surfaces = this.materials.junctions || {};
    const key = this.theme.roads.profiles[profile]?.surface || 'asphalt';
    return surfaces[key] ? key : 'asphalt';
  }

  /**
   * Les surfaces de carrefour d'un revêtement, en un maillage. Séparé des
   * rubans parce que la matière l'est : un carrefour n'a pas de marquage peint.
   */
  _applyJunctionBuffer(surface, buffer) {
    const { THREE } = this;
    const geometry = toGeometry(THREE, buffer);
    const existing = this.junctionMeshes[surface];

    if (!geometry) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        this.junctionMeshes[surface] = null;
      }
      return;
    }

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.materials.junctions[surface]);
    mesh.name = `road-junction-${surface}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    // Après tous les rubans : la surface d'un carrefour est ce qui les relie,
    // elle se pose donc par-dessus leurs bouches et non l'inverse.
    mesh.renderOrder = 1 + ROAD_PROFILE_ORDER.length + 1;
    this.scene.add(mesh);
    this.junctionMeshes[surface] = mesh;
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

    const mesh = new THREE.Mesh(geometry, this.materials.byProfile[profile]);
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
    this.junctionAreas = null;
    this.bubble?.setRoadCut?.(null); // sinon un changement d'observateur laisse des tranchées vides
    for (const store of [this.meshes, this.junctionMeshes]) {
      for (const key of Object.keys(store)) {
        const mesh = store[key];
        if (!mesh) continue;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        store[key] = null;
      }
    }
    if (this.markingMesh) {
      this.scene.remove(this.markingMesh);
      this.markingMesh.geometry.dispose();
      this.markingMesh = null;
    }
  }
}
