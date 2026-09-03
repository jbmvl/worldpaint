/*
 * objectLabels — nommer ce qu'on a sous les yeux dans la scène 3D. Outil de
 * mise au point : le décor est engendré, la question devant lui est
 * « qu'est-ce que je regarde ».
 *
 * Quatre façons de répondre, sans recouvrement :
 * 1. les objets portent déjà leur nom (chaque couche nomme ses maillages) —
 *    on traverse le graphe et on traduit ; pour un `InstancedMesh`, on
 *    étiquette l'exemplaire le plus proche de la caméra ;
 * 2. les cultures n'ont pas d'objet : un champ est une plage de la carte des
 *    cultures, retrouvée par échantillonnage de `cropAt` puis agglomération
 *    des cases voisines ;
 * 3. les emprises `landuse`/`landcover` sont des classements de parcelle, pas
 *    des maillages — relues directement dans les tuiles vectorielles ;
 * 4. les bâtiments spéciaux (église, commerce…) partagent tous le maillage
 *    `buildings` (`buildingLayer` redécore, ne pose jamais à côté) :
 *    `BuildingLayer.personalities` est la seule trace de quel bâtiment est quoi.
 *
 * Tout ici est pur, testable sous Node — voir `test/world.test.mjs`.
 */

import { defaultTheme } from '../themes/default.js';
import { ringsOf } from '../layers/settlement.js';
import { ringAreaMeters } from '../layers/furniturePlacement.js';

/** Portée d'étiquetage, en mètres. Au-delà, l'étiquette ne désigne plus rien. */
export const LABEL_RADIUS_M = 130;
/** Nombre maximal d'étiquettes affichées, les plus proches d'abord. */
export const LABEL_MAX = 44;
/** Points échantillonnés au plus par maillage pour trouver le plus proche. */
export const LABEL_SAMPLES_PER_MESH = 1200;

/** Pas d'échantillonnage de la carte des cultures, en mètres. */
export const CROP_SAMPLE_STEP_M = 12;
/** Rayon échantillonné autour de la caméra, en mètres. */
export const CROP_SAMPLE_RADIUS_M = 220;
/** Cases minimales pour qu'une plage mérite une étiquette (≈ 3 cases). */
export const CROP_MIN_CELLS = 3;

/**
 * Noms lisibles, par nom exact de maillage.
 *
 * Ce qui n'y figure pas n'est pas caché : `labelForMeshName` rend alors le nom
 * brut. Un outil de mise au point qui tait ce qu'il ne connaît pas est un outil
 * qui ment sur l'état du décor.
 */
export const LABEL_EXACT = {
  buildings: 'bâtiment',
  'building-windows': 'fenêtres allumées',
  gardens: 'jardin (clôture et buissons)',
  streets: 'voirie (caniveau, bordure, trottoir)',
  water: 'eau',
  railway: 'voie ferrée',
  'ground-cover': 'herbe',
  crops: 'cultures (semis)',
  birds: 'oiseaux',
  'chimney-smoke': 'fumée',
  'furniture-lamp-glow': 'halo de lampadaire',
  'furniture-lamp-pool': 'nappe de lumière',
  'traffic-lens': 'feu (lentille)',
};

/** Noms lisibles par profil de chaussée. */
export const LABEL_ROADS = {
  express: 'voie rapide',
  major: 'route principale',
  minor: 'route secondaire',
  lane: 'voie communale',
  track: 'chemin',
  cycleway: 'piste cyclable',
  path: 'sentier',
};

/** Noms lisibles du mobilier — formes instanciées et ouvrages balayés. */
export const LABEL_FURNITURE = {
  // Instancié
  streetLamp: 'lampadaire',
  utilityPole: 'poteau électrique',
  pylon: 'pylône',
  radioMast: 'antenne relais',
  windTurbine: 'éolienne',
  lighthouse: 'phare',
  guardrailPost: 'poteau de glissière',
  signWarning: 'panneau danger',
  signStop: 'panneau stop',
  signYield: 'panneau cédez-le-passage',
  signPriority: 'panneau priorité',
  signSpeedLimit: 'panneau vitesse',
  signNoOvertaking: 'panneau interdiction de doubler',
  signRoundabout: 'panneau giratoire',
  signCrossing: 'panneau passage piéton',
  signDirection: 'panneau de direction',
  signPlaceName: 'panneau d’entrée de bourg',
  signChevron: 'balise de virage',
  milestone: 'borne',
  busShelter: 'abribus',
  fountain: 'fontaine',
  lavoir: 'lavoir',
  hayBaleRound: 'botte ronde',
  hayBaleSquare: 'botte carrée',
  woodPile: 'tas de bois',
  barn: 'grange',
  silo: 'silo',
  hangar: 'hangar',
  greenhouse: 'serre',
  windmill: 'moulin à vent',
  watermill: 'moulin à eau',
  waterTower: 'château d’eau',
  fencePostWood: 'piquet de bois',
  fencePostConcrete: 'piquet de béton',
  bush: 'buisson',
  treeBroad: 'arbre (feuillu)',
  treeConifer: 'arbre (résineux)',
  treeRound: 'arbre (boule)',
  treeColumnar: 'arbre (fuseau)',
  treeOval: 'arbre (dôme)',
  cow: 'vache',
  sheep: 'mouton',
  goat: 'chèvre',
  horse: 'cheval',
  donkey: 'âne',
  chicken: 'poule',
  laundryLine: 'étendage',
  trafficLight: 'feu tricolore',
  rockSmall: 'caillou',
  rockBoulder: 'bloc rocheux',
  rockOutcrop: 'affleurement',
  vineStock: 'cep',
  monument: 'monument',
  castle: 'château',
  tower: 'tour',
  cemeteryCross: 'croix de cimetière',
  cemeteryGate: 'portail de cimetière',
  cemeteryTomb: 'tombe',
  cemeteryTombFlat: 'tombe (dalle)',
  cemeteryTap: 'robinet de cimetière',
  factoryChimney: 'cheminée d’usine',
  ferrisWheel: 'grande roue',
  stadium: 'stade',
  // Balayé le long d'une polyligne
  hedge: 'haie',
  lowHedge: 'haie basse',
  vineRow: 'rang de vigne',
  dryStoneWall: 'muret de pierre',
  cutWall: 'mur de tranchée',
  fillWall: 'mur de soutènement',
  guardrailBeam: 'glissière',
  woodRail: 'clôture de bois',
  woodRailTop: 'clôture de bois (lisse haute)',
  embankment: 'talus',
  wire: 'câble',
};

/** Objets qu'on ne nomme pas : ils sont l'ambiance, pas le décor. */
export const LABEL_IGNORED = new Set(['sky-dome', 'sun']);

/**
 * Nom lisible d'un maillage, ou `null` s'il ne doit pas être étiqueté.
 * Fonction pure.
 *
 * @param {string} name Nom du maillage, tel que posé par sa couche.
 * @returns {string|null}
 */
export function labelForMeshName(name) {
  if (!name) return null;
  if (LABEL_IGNORED.has(name)) return null;

  if (LABEL_EXACT[name]) return LABEL_EXACT[name];

  if (name.startsWith('road-')) {
    const profile = name.slice(5);
    return LABEL_ROADS[profile] || `route (${profile})`;
  }
  if (name.startsWith('furniture-')) {
    const kind = name.slice(10);
    return LABEL_FURNITURE[kind] || `mobilier (${kind})`;
  }
  // Arbres : le peuplement est plus parlant que la tuile, et il est déduit du
  // lieu — c'est `labelForObject` qui le complète, faute de position ici.
  if (name.startsWith('vegetation-')) return 'arbres';
  if (name.startsWith('terrain-')) return `terrain ${name.slice(8)}`;

  return name;
}

/** Emprunté à la carte (🗺️) ou inventé par la procédure (🤖) : d'où vient le fait, pas la forme. */
export const LABEL_SOURCE_OSM = '🗺️';
export const LABEL_SOURCE_GENERATED = '🤖';

/** Maillages posés directement d'après une couche de la donnée — pas un tirage. */
const OSM_MESH_EXACT = new Set(['buildings', 'water', 'railway', 'streets']);

/**
 * Formes du catalogue mobilier posées d'après un point d'intérêt ou une
 * emprise `landuse` réels (voir `FurnitureLayer._poiItem` et
 * `_urbanLanduseKind`), jamais d'après un tirage.
 */
const OSM_FURNITURE_KINDS = new Set([
  'busShelter',
  'fountain',
  'lavoir',
  'monument',
  'castle',
  'tower',
  'ferrisWheel',
  'cemeteryCross',
  'factoryChimney',
  'stadium',
]);

/**
 * Source d'un maillage — carte ou procédure. Complément de `labelForMeshName`, pas son remplaçant.
 * @param {string} name Nom du maillage, tel que posé par sa couche.
 * @returns {string} `LABEL_SOURCE_OSM` ou `LABEL_SOURCE_GENERATED`.
 */
export function sourceForMeshName(name) {
  if (!name) return LABEL_SOURCE_GENERATED;
  if (OSM_MESH_EXACT.has(name)) return LABEL_SOURCE_OSM;
  if (name.startsWith('road-')) return LABEL_SOURCE_OSM;
  if (name.startsWith('terrain-')) return LABEL_SOURCE_OSM; // le relief vient du MNT, une mesure, pas un tirage

  if (name.startsWith('furniture-')) {
    return OSM_FURNITURE_KINDS.has(name.slice(10)) ? LABEL_SOURCE_OSM : LABEL_SOURCE_GENERATED;
  }
  return LABEL_SOURCE_GENERATED;
}

/** Nom lisible d'un peuplement forestier (`vegetationLayer.forestTypeAt`). */
export function labelForForestType(type, forests = defaultTheme.forests) {
  const known = forests.find((t) => t.name === type?.name);
  return known ? `arbres — ${known.name}` : 'arbres';
}

/** Nom lisible d'une culture. */
export const LABEL_CROPS = {
  wheat: 'blé',
  maize: 'maïs',
  sunflower: 'tournesol',
  plough: 'labour',
  vineyard: 'vigne',
  orchard: 'verger',
};

/**
 * Traduction de la classe `landuse`/`landcover` (schéma OpenMapTiles) — le
 * repli quand `subclass` ne précise rien.
 */
export const LABEL_PLACE_CLASS = {
  residential: 'zone résidentielle',
  commercial: 'zone commerciale',
  retail: 'zone commerciale',
  industrial: 'zone industrielle',
  suburb: 'périmètre habité',
  neighbourhood: 'périmètre habité',
  quarter: 'périmètre habité',
  farmland: 'terres agricoles',
  wood: 'bois',
  forest: 'forêt',
  grass: 'prairie',
  park: 'parc',
  cemetery: 'cimetière',
  military: 'zone militaire',
  quarry: 'carrière',
  wetland: 'zone humide',
  glacier: 'glacier',
  beach: 'plage',
  sand: 'sable',
  scrub: 'friche',
};

/**
 * Traduction du `subclass` — plus précis que `class` quand il est renseigné.
 * `farmyard`/`farm` sont traduits par honnêteté de vocabulaire mais
 * n'atteignent pas les tuiles OpenFreeMap en pratique (voir
 * `furnitureLayer._looksLikeFarmstead`, qui détecte par indice indirect).
 */
export const LABEL_PLACE_SUBCLASS = {
  farmyard: 'cour de ferme',
  farm: 'cour de ferme',
  allotments: 'jardins ouvriers',
  meadow: 'prairie',
  grassland: 'prairie',
  vineyard: 'vigne',
  orchard: 'verger',
  plant_nursery: 'pépinière',
  golf_course: 'golf',
  theme_park: 'parc d’attractions',
  stadium: 'stade',
  glacier: 'glacier',
  ice_shelf: 'banquise',
};

/**
 * Nom lisible d'une emprise `landuse`/`landcover`, ou `null` si ni `class` ni
 * `subclass` ne sont reconnus. Fonction pure.
 */
export function labelForPlace(klass, subclass) {
  return LABEL_PLACE_SUBCLASS[subclass] || LABEL_PLACE_CLASS[klass] || null;
}

/**
 * Applique une matrice 4×4 en colonne-major (three.js) à un point.
 * Fonction pure — évite d'importer three pour trois multiplications.
 */
export function applyMatrix(elements, x, y, z) {
  const e = elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
  return {
    x: (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
    y: (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
    z: (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  };
}

const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * Point d'un maillage instancié le plus proche d'un observateur.
 *
 * On lit les translations directement dans `instanceMatrix.array` : composer
 * un `Matrix4` par exemplaire coûterait une allocation par lampadaire, et il y
 * a seize mille touffes d'herbe. Un pas d'échantillonnage borne le coût sur les
 * couches semées, où mille exemplaires de plus ne changent pas la réponse.
 *
 * Fonction pure.
 *
 * @param {{count:number, instanceMatrix:{array:ArrayLike<number>}, matrixWorld:{elements:ArrayLike<number>}}} mesh
 * @param {{x:number,y:number,z:number}} eye
 * @param {number} [maxSamples]
 * @returns {{x:number,y:number,z:number}|null}
 */
export function nearestInstance(mesh, eye, maxSamples = LABEL_SAMPLES_PER_MESH) {
  const count = mesh.count ?? 0;
  const array = mesh.instanceMatrix?.array;
  if (!count || !array) return null;

  const stride = Math.max(1, Math.ceil(count / maxSamples));
  const world = mesh.matrixWorld?.elements;
  let best = null;
  let bestD = Infinity;

  for (let i = 0; i < count; i += stride) {
    const at = i * 16;
    let point = { x: array[at + 12], y: array[at + 13], z: array[at + 14] };
    if (world) point = applyMatrix(world, point.x, point.y, point.z);
    const d = distance2(point, eye);
    if (d < bestD) {
      bestD = d;
      best = point;
    }
  }
  return best;
}

/**
 * Point d'un maillage ordinaire le plus proche d'un observateur (le centre de
 * la sphère englobante ne convient pas pour une chaussée de 900 m de long).
 */
export function nearestVertex(mesh, eye, maxSamples = LABEL_SAMPLES_PER_MESH) {
  const position = mesh.geometry?.attributes?.position;
  const world = mesh.matrixWorld?.elements;
  if (!position?.array || !position.count) {
    if (!world) return null;
    return { x: world[12], y: world[13], z: world[14] };
  }

  const array = position.array;
  const itemSize = position.itemSize || 3;
  const stride = Math.max(1, Math.ceil(position.count / maxSamples));
  let best = null;
  let bestD = Infinity;

  for (let i = 0; i < position.count; i += stride) {
    const at = i * itemSize;
    let point = { x: array[at], y: array[at + 1], z: array[at + 2] };
    if (world) point = applyMatrix(world, point.x, point.y, point.z);
    const d = distance2(point, eye);
    if (d < bestD) {
      bestD = d;
      best = point;
    }
  }
  return best;
}

/**
 * Parcourt un graphe de scène et rend une étiquette par maillage visible dont
 * un point tombe dans la portée. Fonction pure.
 *
 * @param {Object} options
 * @param {{children:Array}} options.root Racine du graphe (la scène).
 * @param {{x:number,y:number,z:number}} options.eye Position de la caméra.
 * @param {number} [options.radius]
 * @param {number} [options.max]
 * @param {Set<string>} [options.skip] Noms à ne pas traverser (branche
 *        entière écartée) : ce qui s'étiquette autrement, et ce que
 *        l'application a ajouté à la scène.
 * @param {Function} [options.rename] `(name, point) => string` — dernier mot
 *        sur le texte, pour ce qui dépend du lieu (le peuplement d'un bois).
 * @returns {Array<{id:string, text:string, x:number, y:number, z:number, distance:number}>}
 */
export function collectSceneLabels({
  root,
  eye,
  radius = LABEL_RADIUS_M,
  max = LABEL_MAX,
  skip = new Set(),
  rename = null,
}) {
  const out = [];
  const radius2 = radius * radius;

  const walk = (object) => {
    if (!object || object.visible === false) return;
    if (object.name && skip.has(object.name)) return;

    if (object.isMesh || object.isInstancedMesh) {
      const text = labelForMeshName(object.name);
      if (text) {
        const point = object.isInstancedMesh
          ? nearestInstance(object, eye)
          : nearestVertex(object, eye);
        if (point) {
          const d2 = distance2(point, eye);
          if (d2 <= radius2) {
            out.push({
              id: `mesh:${object.name}:${object.id ?? out.length}`,
              text: rename ? rename(object.name, point) || text : text,
              source: sourceForMeshName(object.name),
              x: point.x,
              y: point.y,
              z: point.z,
              distance: Math.sqrt(d2),
            });
          }
        }
      }
    }

    const children = object.children;
    if (children) for (let i = 0; i < children.length; i++) walk(children[i]);
  };

  walk(root);
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, max);
}

/**
 * Agglomère les cases voisines de même culture en plages connexes (4-connexité).
 *
 * C'est l'étiquette « de groupe » demandée par les champs : une parcelle n'a
 * pas d'objet à nommer, elle n'est qu'une plage de la carte des cultures. Deux
 * champs de blé séparés par une route restent deux plages — la case de la route
 * ne porte pas de culture, donc elle coupe la connexité.
 *
 * Fonction pure.
 *
 * @param {Array<string|null>} kinds Grille ligne par ligne, `null` = pas de champ.
 * @param {number} cols
 * @param {number} rows
 * @param {number} [minCells] Plages plus petites ignorées.
 * @returns {Array<{kind:string, cells:number, col:number, row:number}>} `col`/`row`
 *          sont le barycentre de la plage, en cases fractionnaires.
 */
export function clusterCropGrid(kinds, cols, rows, minCells = CROP_MIN_CELLS) {
  const seen = new Uint8Array(cols * rows);
  const clusters = [];
  const queue = [];

  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || !kinds[start]) continue;
    const kind = kinds[start];

    seen[start] = 1;
    queue.length = 0;
    queue.push(start);
    let cells = 0;
    let sumCol = 0;
    let sumRow = 0;

    const pushNeighbour = (next) => {
      if (seen[next] || kinds[next] !== kind) return;
      seen[next] = 1;
      queue.push(next);
    };

    // Parcours en largeur : une file, pas de récursion — une plage de blé peut
    // couvrir toute la grille, et la pile d'appels n'est pas extensible.
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];
      const col = index % cols;
      const row = (index - col) / cols;
      cells++;
      sumCol += col;
      sumRow += row;

      if (col > 0) pushNeighbour(index - 1);
      if (col < cols - 1) pushNeighbour(index + 1);
      if (row > 0) pushNeighbour(index - cols);
      if (row < rows - 1) pushNeighbour(index + cols);
    }

    if (cells >= minCells) {
      clusters.push({ kind, cells, col: sumCol / cells, row: sumRow / cells });
    }
  }

  clusters.sort((a, b) => b.cells - a.cells);
  return clusters;
}

/**
 * Étiquettes des plages de culture autour d'un point. Échantillonnage et
 * altitude passés en fonctions : cette couche ne connaît ni `groundClassMap`
 * ni `terrainBubble`.
 *
 * @param {Object} options
 * @param {{x:number,z:number}} options.center Centre en mètres locaux.
 * @param {Function} options.cropAt `(x, z) => string|null`.
 * @param {Function} options.groundAt `(x, z) => number` altitude de scène.
 * @param {number} [options.step]
 * @param {number} [options.radius]
 * @param {number} [options.max]
 * @returns {Array<{id:string, text:string, x:number, y:number, z:number, distance:number}>}
 */
export function collectCropLabels({
  center,
  cropAt,
  groundAt,
  step = CROP_SAMPLE_STEP_M,
  radius = CROP_SAMPLE_RADIUS_M,
  max = 8,
}) {
  const span = Math.max(1, Math.round(radius / step));
  const cols = span * 2 + 1;
  const originX = center.x - span * step;
  const originZ = center.z - span * step;

  const kinds = new Array(cols * cols);
  for (let row = 0; row < cols; row++) {
    for (let col = 0; col < cols; col++) {
      kinds[row * cols + col] = cropAt(originX + col * step, originZ + row * step) || null;
    }
  }

  const clusters = clusterCropGrid(kinds, cols, cols);
  const labels = clusters.slice(0, max).map((cluster, index) => {
    const x = originX + cluster.col * step;
    const z = originZ + cluster.row * step;
    // Surface approchée : une case échantillonnée vaut un carré de `step`.
    const hectares = (cluster.cells * step * step) / 10000;
    return {
      id: `crop:${cluster.kind}:${index}`,
      text: `${LABEL_CROPS[cluster.kind] || cluster.kind} — ${hectares.toFixed(1)} ha`,
      source: LABEL_SOURCE_GENERATED, // la culture elle-même est toujours déduite d'un tirage

      x,
      y: groundAt(x, z) + 3,
      z,
      distance: Math.hypot(x - center.x, z - center.z),
    };
  });

  labels.sort((a, b) => a.distance - b.distance);
  return labels;
}

/** Pas et portée de l'étiquetage des emprises `landuse`/`landcover`. */
export const PLACE_RADIUS_M = 260;
/** Étiquettes d'emprise affichées au plus, les plus proches d'abord. */
export const PLACE_MAX = 10;

/**
 * Étiquettes des emprises `landuse`/`landcover` autour d'un point — le
 * pendant, pour les types de lieux, de `collectCropLabels`. Utile pour ce
 * qu'aucun mobilier ne rend visible avant d'être posé (une cour de ferme
 * reste une cour de ferme même sans grange ni serre).
 *
 * @param {Object} options
 * @param {{forEachFeature:Function}} options.source `VectorTileSource` de
 *        l'application — déjà chargée pour le décor, aucune requête de plus.
 * @param {Array<{x:number,y:number}>} options.tiles Tuiles à parcourir, au
 *        zoom de `source`.
 * @param {{toLocal(lng:number, lat:number):{x:number,z:number}}} options.frame
 *        Repère local de la bulle (`world.frame`).
 * @param {{x:number,z:number}} options.eye
 * @param {Function} options.groundAt `(x, z) => number` altitude de scène.
 * @param {number} [options.radius]
 * @param {number} [options.max]
 * @returns {Array<{id:string, text:string, x:number, y:number, z:number, distance:number}>}
 */
export function collectPlaceLabels({
  source,
  tiles,
  frame,
  eye,
  groundAt,
  radius = PLACE_RADIUS_M,
  max = PLACE_MAX,
}) {
  const out = [];
  if (!source || !tiles || !frame) return out;
  const radius2 = radius * radius;

  const handle = (geometry, properties) => {
    const text = labelForPlace(properties.class, properties.subclass);
    if (!text) return;

    for (const ring of ringsOf(geometry)) {
      const local = [];
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        local.push(frame.toLocal(lng, lat));
      }
      if (local.length < 3) continue;

      let x = 0;
      let z = 0;
      for (const p of local) {
        x += p.x;
        z += p.z;
      }
      x /= local.length;
      z /= local.length;

      const dx = x - eye.x;
      const dz = z - eye.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius2) continue;

      // Surface indicative : au-delà d'un dixième d'hectare, elle aide à
      // distinguer une vraie parcelle d'un polygone mal découpé en bord de
      // tuile.
      const hectares = ringAreaMeters(local) / 10000;
      out.push({
        id: `place:${properties.class || ''}:${properties.subclass || ''}:${Math.round(x)}:${Math.round(z)}`,
        text: hectares >= 0.1 ? `${text} — ${hectares.toFixed(1)} ha` : text,
        // `class`/`subclass` viennent tels quels de la tuile : c'est la carte
        // qui classe la parcelle, pas la procédure.
        source: LABEL_SOURCE_OSM,
        x,
        y: groundAt(x, z) + 2,
        z,
        distance: Math.sqrt(d2),
      });
    }
  };

  source.forEachFeature('landcover', tiles, handle);
  source.forEachFeature('landuse', tiles, handle);

  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, max);
}

/**
 * Nom lisible d'une personnalité de bâtiment (`buildingLayer.buildingPersonalityFor`).
 * `retail` (grandes surfaces) et `shop` (devanture ordinaire) restent
 * distincts : `BUILDING_PERSONALITY_RANK` s'appuie sur cette différence.
 */
export const LABEL_BUILDING_PERSONALITY = {
  church: 'église',
  mosque: 'mosquée',
  hospital: 'hôpital',
  bakery: 'boulangerie',
  retail: 'grande surface',
  shop: 'commerce',
};

/** Portée et nombre d'étiquettes de bâtiments spéciaux, au-delà des mêmes défauts que les objets. */
export const BUILDING_LABEL_RADIUS_M = 260;
export const BUILDING_LABEL_MAX = 12;

/**
 * Étiquettes des bâtiments spéciaux autour d'un point.
 *
 * @param {Object} options
 * @param {Array<{x:number,z:number,kind:string}>} options.buildings
 *        `BuildingLayer.personalities`, publié après chaque reconstruction.
 * @param {{x:number,z:number}} options.eye
 * @param {Function} options.groundAt `(x, z) => number` altitude de scène.
 * @param {number} [options.radius]
 * @param {number} [options.max]
 * @returns {Array<{id:string, text:string, x:number, y:number, z:number, distance:number}>}
 */
export function collectBuildingLabels({
  buildings,
  eye,
  groundAt,
  radius = BUILDING_LABEL_RADIUS_M,
  max = BUILDING_LABEL_MAX,
}) {
  const out = [];
  if (!buildings) return out;
  const radius2 = radius * radius;

  for (const building of buildings) {
    const text = LABEL_BUILDING_PERSONALITY[building.kind];
    if (!text) continue;

    const dx = building.x - eye.x;
    const dz = building.z - eye.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius2) continue;

    out.push({
      id: `building:${building.kind}:${Math.round(building.x)}:${Math.round(building.z)}`,
      text,
      // `buildingPersonalityFor` classe un vrai point d'intérêt : la carte
      // dit que ce bâtiment est une église, pas un tirage.
      source: LABEL_SOURCE_OSM,
      x: building.x,
      y: groundAt(building.x, building.z) + 3,
      z: building.z,
      distance: Math.sqrt(d2),
    });
  }

  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, max);
}
