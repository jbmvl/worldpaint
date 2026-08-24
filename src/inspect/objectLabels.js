/*
 * objectLabels — nommer ce qu'on a sous les yeux dans la scène 3D.
 * -----------------------------------------------------------------
 * Outil de mise au point : le décor est engendré, personne ne l'a posé à la
 * main, et la seule question qu'on se pose devant lui est « qu'est-ce que je
 * regarde, au juste ». Une haie ratée et un muret raté se ressemblent beaucoup ;
 * un champ de blé trop clair et un chaume, encore plus.
 *
 * Deux façons de répondre, et elles ne se recouvrent pas :
 *
 * 1. **Les objets** portent déjà leur nom — chaque couche nomme ses maillages
 *    (`furniture-streetLamp`, `road-major`, `vegetation-15/16594/11269`). Il
 *    suffit de traverser le graphe et de traduire. Pour un `InstancedMesh`, on
 *    étiquette **l'exemplaire le plus proche** de la caméra : une étiquette au
 *    centre de mille lampadaires ne désigne rien.
 * 2. **Les cultures** n'ont pas d'objet à nommer. Un champ n'est ni un maillage
 *    ni une instance : c'est une **plage de la carte des cultures**, lue par le
 *    shader du sol autant que par les tiges. On l'étiquette donc en la
 *    retrouvant — échantillonnage régulier de `cropAt`, puis agglomération des
 *    cases voisines de même culture. C'est le « groupe d'objets » du champ.
 *
 * Tout ici est **pur** : aucune dépendance à three.js, seulement la lecture de
 * propriétés (`matrixWorld.elements`, `instanceMatrix.array`, `geometry`). Les
 * fonctions sont donc testables sous Node — voir `test/world.test.mjs`.
 */

import { defaultTheme } from '../themes/default.js';

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
  'building-windows': 'fenêtres',
  water: 'eau',
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
  windTurbine: 'éolienne',
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
  fencePostWood: 'piquet de bois',
  fencePostConcrete: 'piquet de béton',
  bush: 'buisson',
  treeBroad: 'arbre (feuillu)',
  treeConifer: 'arbre (résineux)',
  cow: 'vache',
  sheep: 'mouton',
  chicken: 'poule',
  laundryLine: 'étendage',
  trafficLight: 'feu tricolore',
  rockSmall: 'caillou',
  rockBoulder: 'bloc rocheux',
  rockOutcrop: 'affleurement',
  fernClump: 'fougères',
  vineStock: 'cep',
  // Balayé le long d'une polyligne
  hedge: 'haie',
  lowHedge: 'haie basse',
  ditch: 'fossé',
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
 * Point d'un maillage ordinaire le plus proche d'un observateur.
 *
 * Le centre de la sphère englobante ne convient pas : une chaussée fait neuf
 * cents mètres de long, son centre est n'importe où et l'étiquette se poserait
 * dans un champ. On cherche donc le **sommet** le plus proche, par
 * échantillonnage — c'est la seule réponse qui désigne bien la portion qu'on a
 * sous les yeux.
 *
 * Fonction pure.
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
 * un point tombe dans la portée.
 *
 * Fonction pure : elle ne lit que des propriétés, n'en écrit aucune, et
 * n'appelle rien de three.js.
 *
 * @param {Object} options
 * @param {{children:Array}} options.root Racine du graphe (la scène).
 * @param {{x:number,y:number,z:number}} options.eye Position de la caméra.
 * @param {number} [options.radius]
 * @param {number} [options.max]
 * @param {Set<string>} [options.skip] Noms à ne pas traverser — la branche
 *        entière est écartée. Deux usages : ce qui s'étiquette autrement (les
 *        cultures, par plage plutôt que par touffe) et **ce que l'application a
 *        ajouté à la scène**. L'inspecteur ne connaît que le décor ; tout objet
 *        qui n'en vient pas se retire ici, et pas par une exception écrite dans
 *        le générateur.
 * @param {Function} [options.rename] `(name, point) => string` — dernier mot sur
 *        le texte, pour ce qui dépend du lieu (le peuplement d'un bois).
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
 * Étiquettes des plages de culture autour d'un point.
 *
 * L'échantillonnage et la lecture d'altitude sont passés en fonctions : cette
 * couche ne connaît ni `groundClassMap` ni `terrainBubble`, et se teste donc
 * avec deux fermetures.
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
      x,
      y: groundAt(x, z) + 3,
      z,
      distance: Math.hypot(x - center.x, z - center.z),
    };
  });

  labels.sort((a, b) => a.distance - b.distance);
  return labels;
}
