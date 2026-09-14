/*
 * ribbonGeometry — plaquer une bande sur le terrain, le long d'une polyligne.
 * Chaussées, cours d'eau, haies, murs et glissières ont le même problème
 * géométrique ; seules la section et la source des polylignes changent.
 *
 * Trois exigences : plusieurs colonnes en travers (sinon un côté en l'air sur
 * un devers), altitude prise sur la surface affichée (le MNT continu n'est
 * échantillonné que tous les 18 m), lissage longitudinal (le MNT est bruité
 * au mètre, pas une route). Une chaussée y ajoute une quatrième qui remplace
 * la première : dressée de niveau en travers (voir `levelRow`).
 *
 * Le lissage ne vaut que pour les altitudes relevées ici. Une plate-forme déjà
 * dressée arrive de l'extérieur et se pose telle quelle : elle est partagée
 * avec le déblai du terrain, les bordures, le marquage et le mobilier, et un
 * second lissage n'aurait déplacé que le ruban — sous le terrain, au sommet
 * d'une côte.
 *
 * `appendProfile` généralise le ruban à une section quelconque le long de la
 * même polyligne (haie, muret, glissière, remblai, caténaire). `appendVariableWall`
 * couvre le seul cas restant : une hauteur qui change le long du tracé, et
 * `appendRockCut` la falaise du déblai, qui n'est pas un mur et n'a donc ni
 * appareillage ni couronnement.
 *
 * Le profil en long, lui, ne se lisse pas comme le reste : `flattenGrade`
 * l'aplanit dans la limite du terrassement consenti, parce qu'une chaussée
 * dressée section par section suit le bruit du MNT au lieu de tendre une pente.
 *
 * En plan, le tracé demande la même chose : ce qui arrive des tuiles est une
 * ligne brisée, et cette brisure se lit sur tout ce qui suit la chaussée — la
 * rive, la bordure, le marquage. `roundCorners` y inscrit l'arc qui raccorde
 * les deux arêtes, et `subdividePath` le suit sans le repolygoniser, ce qu'un
 * pas constant ferait. Le pas d'un tracé n'est donc pas constant : une ligne
 * ne s'y retrouve pas en divisant une abscisse par le pas — c'est le point
 * posé le long du tracé qui dit de quelle ligne il sort.
 */

/**
 * Ré-échantillonne une polyligne métrique à pas constant.
 * @param {Array<{x:number,z:number}>} points
 * @param {number} spacing
 * @returns {Array<{x:number,z:number,distance:number}>}
 */
export function resamplePath(points, spacing) {
  if (!points || points.length < 2 || spacing <= 0) return [];

  const out = [{ x: points[0].x, z: points[0].z, distance: 0 }];
  let carry = 0; // distance déjà parcourue depuis le dernier échantillon posé
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x;
    const az = points[i - 1].z;
    const bx = points[i].x;
    const bz = points[i].z;
    const segment = Math.hypot(bx - ax, bz - az);
    if (segment === 0) continue;

    let offset = spacing - carry;
    while (offset <= segment) {
      const t = offset / segment;
      total += spacing;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, distance: total });
      offset += spacing;
    }
    carry = segment - (offset - spacing);
  }

  return out;
}

/**
 * Ré-échantillonne une polyligne sans en perdre un sommet : chaque arête est
 * divisée en parts égales d'au plus `spacing`. Le pas n'est donc pas constant,
 * et c'est ce qu'on lui demande — un arc décrit par des cordes courtes reste
 * un arc, là où un pas constant le repolygonise à son propre pas.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {number} spacing Pas maximal, en mètres.
 * @returns {Array<{x:number,z:number,distance:number}>}
 */
export function subdividePath(points, spacing) {
  if (!points || points.length < 2 || spacing <= 0) return [];

  const out = [{ x: points[0].x, z: points[0].z, distance: 0 }];
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x;
    const az = points[i - 1].z;
    const bx = points[i].x;
    const bz = points[i].z;
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 1e-9)) continue;

    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, distance: total + length * t });
    }
    total += length;
  }

  return out.length >= 2 ? out : [];
}

/**
 * Part de la plus courte des deux arêtes qu'un raccord peut prendre. Une
 * moitié : deux raccords voisins se rejoignent alors au milieu de l'arête
 * qu'ils partagent, et le tracé est tangent d'un bout à l'autre.
 */
export const CORNER_TANGENT_RATIO = 0.5;
/** Écart maximal entre un arc et la corde qui le représente, en mètres. */
export const CORNER_SAGITTA_M = 0.08;
/** Brisure en deçà de laquelle il n'y a pas de virage à raccorder. */
const CORNER_MIN_TURN = (2 * Math.PI) / 180;
/** Brisure au-delà de laquelle les deux arêtes se font face : l'arc n'y est plus défini. */
const CORNER_MAX_TURN = (170 * Math.PI) / 180;
/**
 * Longueur en deçà de laquelle un sommet n'est pas un virage, en mètres : la
 * tuile quantifie ses coordonnées, et deux sommets voisins à quelques
 * décimètres décrivent le pas de sa grille, pas le tracé.
 */
export const CORNER_MIN_STEP_M = 1;
/** Sommets d'un arc, au plus. */
const CORNER_MAX_STEPS = 12;

/**
 * L'arc inscrit dans la brisure `a → b → c`, tangent aux deux arêtes, ou
 * `null` s'il n'y a rien à raccorder. Fonction pure.
 */
function cornerArc(a, b, c, ratio, sagitta) {
  let ix = b.x - a.x;
  let iz = b.z - a.z;
  const lengthIn = Math.hypot(ix, iz);
  let ox = c.x - b.x;
  let oz = c.z - b.z;
  const lengthOut = Math.hypot(ox, oz);
  if (!(lengthIn > 0) || !(lengthOut > 0)) return null;
  ix /= lengthIn;
  iz /= lengthIn;
  ox /= lengthOut;
  oz /= lengthOut;

  const dot = Math.min(1, Math.max(-1, ix * ox + iz * oz));
  const turn = Math.acos(dot);
  if (turn < CORNER_MIN_TURN || turn > CORNER_MAX_TURN) return null;

  const tangent = ratio * Math.min(lengthIn, lengthOut);
  const radius = tangent / Math.tan(turn / 2);
  // Un arc qui passe à moins d'une flèche du sommet ne raccorde rien qu'on
  // puisse voir : la brisure tient déjà dans la tolérance qu'on s'accorde.
  if (radius * (1 / Math.cos(turn / 2) - 1) < sagitta) return null;

  // Normale du côté où le tracé tourne : la composante de la sortie
  // perpendiculaire à l'entrée. Le centre de l'arc est dessus.
  let nx = ox - ix * dot;
  let nz = oz - iz * dot;
  const normal = Math.hypot(nx, nz);
  if (!(normal > 0)) return null;
  nx /= normal;
  nz /= normal;

  const startX = b.x - ix * tangent;
  const startZ = b.z - iz * tangent;
  const centreX = startX + nx * radius;
  const centreZ = startZ + nz * radius;
  const vx = startX - centreX;
  const vz = startZ - centreZ;

  // Le pas d'angle vient de la flèche consentie, pas d'un nombre de sommets :
  // un grand rayon se décrit avec moins de cordes, à écart égal.
  const step = radius > sagitta ? 2 * Math.acos(1 - sagitta / radius) : turn;
  const steps = Math.min(CORNER_MAX_STEPS, Math.max(1, Math.ceil(turn / step)));
  const spin = ix * oz - iz * ox >= 0 ? 1 : -1;

  const arc = [];
  for (let k = 0; k <= steps; k++) {
    const angle = spin * turn * (k / steps);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    arc.push({ x: centreX + vx * cos - vz * sin, z: centreZ + vx * sin + vz * cos });
  }
  return arc;
}

/**
 * Arrondit les brisures d'une polyligne : chaque sommet est remplacé par l'arc
 * qui raccorde ses deux arêtes, comme le fait le tracé d'une route. Ce qui
 * arrive des tuiles est une ligne brisée — simplifiée puis quantifiée —, et
 * cette brisure se lit sur tout ce qui suit la chaussée : rive, bordure,
 * marquage, mobilier.
 *
 * Les sommets marqués par `keep` ne bougent pas : un arc y remplacerait un
 * angle voulu (un carrefour, une culée) par une courbe qui s'en écarte.
 *
 * @param {Array<{x:number,z:number}>} points
 * @param {Object} [options]
 * @param {ArrayLike<boolean>|null} [options.keep] Sommets à garder francs.
 * @param {number} [options.ratio]
 * @param {number} [options.sagitta]
 * @param {number} [options.minStep]
 * @returns {{points:Array<{x:number,z:number}>, source:Int32Array}} `source[i]`
 *          donne le sommet d'origine dont la ligne `i` est issue — ce qui
 *          permet de reporter les tableaux parallèles au tracé.
 */
export function roundCorners(
  points,
  {
    keep = null,
    ratio = CORNER_TANGENT_RATIO,
    sagitta = CORNER_SAGITTA_M,
    minStep = CORNER_MIN_STEP_M,
  } = {}
) {
  const count = points?.length ?? 0;
  const out = [];
  const source = [];
  // Deux raccords voisins se rejoignent au milieu de l'arête qu'ils partagent,
  // à quelques centimètres près : la fin de l'un et le début de l'autre sont la
  // même ligne, et deux lignes aussi proches n'en décrivent qu'une. Un sommet
  // franc, lui, passe quoi qu'il arrive — c'est la position qu'on lui garde.
  const merge = minStep / 4;
  const push = (x, z, index, rigid = false) => {
    const last = out[out.length - 1];
    if (!rigid && last && Math.hypot(last.x - x, last.z - z) < merge) return;
    out.push({ x, z });
    source.push(index);
  };

  if (count < 3) {
    for (let i = 0; i < count; i++) push(points[i].x, points[i].z, i, true);
    return { points: out, source: Int32Array.from(source) };
  }

  // Les sommets trop rapprochés sont écartés d'abord : un arc inscrit entre
  // deux arêtes de trente centimètres ne raccorde rien, et le ré-échantillonnage
  // qui suit garderait la brisure telle quelle.
  const kept = [0];
  for (let i = 1; i < count - 1; i++) {
    const last = points[kept[kept.length - 1]];
    if (!keep?.[i] && Math.hypot(points[i].x - last.x, points[i].z - last.z) < minStep) continue;
    kept.push(i);
  }
  // Le dernier sommet est un bout : c'est celui d'avant qui s'efface s'ils sont
  // trop proches, sinon le tracé finirait sur une arête de quelques centimètres.
  const tail = count - 1;
  while (kept.length > 1) {
    const previous = kept[kept.length - 1];
    if (keep?.[previous]) break;
    const gap = Math.hypot(points[tail].x - points[previous].x, points[tail].z - points[previous].z);
    if (gap >= minStep) break;
    kept.pop();
  }
  kept.push(tail);

  push(points[kept[0]].x, points[kept[0]].z, kept[0], true);
  for (let k = 1; k < kept.length - 1; k++) {
    const index = kept[k];
    const corner = points[index];
    const arc = keep?.[index]
      ? null
      : cornerArc(points[kept[k - 1]], corner, points[kept[k + 1]], ratio, sagitta);
    if (!arc) {
      push(corner.x, corner.z, index, Boolean(keep?.[index]));
      continue;
    }
    for (const point of arc) push(point.x, point.z, index);
  }
  const last = kept[kept.length - 1];
  push(points[last].x, points[last].z, last, true);

  return { points: out, source: Int32Array.from(source) };
}

/**
 * La portion d'une plage de ruban comprise entre deux distances, plate-forme
 * comprise, avec une ligne à chacune des distances `stops` qui y tombent. Les
 * distances restent celles du tracé : la texture ne glisse pas. Fonction pure.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {Float32Array|number[]} platform Une cote par ligne.
 * @param {number} from
 * @param {number} to
 * @param {number[]} [stops]
 * @returns {{path:Array<{x:number,z:number,distance:number}>, platform:Float32Array}|null}
 */
export function slicePath(path, platform, from, to, stops = []) {
  const rows = path?.length ?? 0;
  if (rows < 2) return null;
  const low = Math.max(from, path[0].distance);
  const high = Math.min(to, path[rows - 1].distance);
  if (!(high > low)) return null;

  const wanted = [low, high, ...stops.filter((d) => d > low && d < high)];
  for (const point of path) {
    if (point.distance > low && point.distance < high) wanted.push(point.distance);
  }
  wanted.sort((a, b) => a - b);

  const points = [];
  const decks = [];
  let row = 0;
  for (const distance of wanted) {
    if (points.length > 0 && distance - points[points.length - 1].distance < 1e-6) continue;
    while (row < rows - 2 && path[row + 1].distance < distance) row++;
    const a = path[row];
    const b = path[row + 1];
    const span = b.distance - a.distance;
    const t = span > 0 ? Math.min(1, Math.max(0, (distance - a.distance) / span)) : 0;
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, distance });
    decks.push(platform[row] + (platform[row + 1] - platform[row]) * t);
  }

  return points.length >= 2 ? { path: points, platform: Float32Array.from(decks) } : null;
}

/**
 * Moyenne glissante sur l'altitude, colonne par colonne.
 * @param {Float32Array|number[]} heights Altitudes, `rows × cols` en ligne d'abord.
 * @param {number} rows
 * @param {number} cols
 * @param {number} [radius] Demi-fenêtre, en échantillons.
 */
export function smoothColumns(heights, rows, cols, radius = 2) {
  if (rows < 2 * radius + 1) return heights;
  const smoothed = new Float32Array(rows * cols);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let sum = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const rr = r + k;
        if (rr < 0 || rr >= rows) continue;
        sum += heights[(rr * cols + c)];
        n++;
      }
      smoothed[r * cols + c] = sum / n;
    }
  }

  for (let i = 0; i < smoothed.length; i++) heights[i] = smoothed[i];
  return heights;
}


/**
 * Aplanit le profil en long d'une plate-forme, dans la limite du terrassement
 * consenti.
 *
 * Dressée section par section (`levelRow`), une chaussée épouse le bruit du
 * MNT : le long d'une côte, d'une rive de lac ou d'une gorge, les deux rives
 * sondées sautent d'un échantillon à l'autre et la plate-forme ondule. Un
 * terrassier fait l'inverse — il tend une pente et laisse l'ouvrage rattraper
 * la différence : l'entaille en amont, le mur en aval.
 *
 * Diffusion répétée (chaque ligne tirée vers la moyenne de ses voisines),
 * chaque passe ramenée dans la bande autorisée autour du profil d'origine.
 * C'est la bande qui décide de tout : nulle, la route colle au sol comme
 * avant ; large, elle s'en détache et l'ouvrage suit. La diffusion efface les
 * ondulations courtes sans toucher à la pente d'ensemble — mesuré à `strength`
 * 0,5 et quarante passes, sur un pas de 5 m : il reste 0 % d'une vague de
 * 40 m, 21 % d'une vague de 80 m, 94 % d'une pente de 400 m et 98 % d'une
 * pente de 800 m.
 *
 * Les deux extrémités ne bougent pas d'un pouce. Un tronçon finit soit à un
 * carrefour — où `stitchPlatforms` va le recoudre sur l'altitude de la voie
 * qu'il rejoint —, soit au bord de la portée, dans le brouillard, contre un
 * autre découpage du même tracé. Dans les deux cas il doit repartir de
 * l'altitude que le terrain lui donne, et un bord libre les ferait dériver
 * tous les deux vers l'horizontale.
 *
 * L'influence de ce bord s'éteint vite, mais pas instantanément : mesurée sur
 * un profil bruité redécoupé ailleurs, elle vaut 0,53 m à dix mètres du bord,
 * 0,11 m à trente, 0,01 m à cinquante et rien au-delà. Un redécoupage — qui
 * n'arrive qu'à la limite de la portée du réseau, à neuf cents mètres — ne
 * peut donc déplacer que cette frange, déjà noyée dans le brouillard.
 *
 * @param {Float32Array|number[]} heights Altitudes, une par ligne. Modifiées sur place.
 * @param {Object} options
 * @param {number|Float32Array|number[]} options.maxCut  Enfoncement toléré sous
 *        le profil d'origine, en mètres — scalaire ou une valeur par ligne.
 * @param {number|Float32Array|number[]} options.maxFill Exhaussement toléré au-dessus.
 * @param {number} [options.iterations]
 * @param {number} [options.strength] Part du chemin parcouru vers la moyenne, par passe.
 * @returns {Float32Array|number[]} `heights`, aplani.
 */
export function flattenGrade(heights, { maxCut = 0, maxFill = 0, iterations = 40, strength = 0.5 } = {}) {
  const rows = heights?.length ?? 0;
  if (rows < 3 || iterations <= 0) return heights;

  const raw = Float32Array.from(heights);
  const next = new Float32Array(rows);
  const bound = (v, r) => (typeof v === 'number' ? v : v?.[r] ?? 0);

  for (let k = 0; k < iterations; k++) {
    // Passe de Jacobi (toutes les lignes lues dans le même état) : en
    // Gauss-Seidel, le profil dériverait dans le sens du parcours.
    next[0] = heights[0];
    next[rows - 1] = heights[rows - 1];
    for (let r = 1; r < rows - 1; r++) {
      const eased = heights[r] + strength * ((heights[r - 1] + heights[r + 1]) * 0.5 - heights[r]);
      const floor = raw[r] - bound(maxCut, r);
      const ceiling = raw[r] + bound(maxFill, r);
      next[r] = Math.min(ceiling, Math.max(floor, eased));
    }
    for (let r = 0; r < rows; r++) heights[r] = next[r];
  }

  return heights;
}

/**
 * Repères de balayage le long d'une polyligne : tangente unitaire et
 * perpendiculaire à gauche de la marche, dans le plan horizontal. Tangente
 * par différence centrée (une différence avant ferait vibrer la largeur du
 * ruban dans les virages serrés).
 *
 * Retourne `{tx, tz, px, pz}` entrelacés, quatre nombres par ligne.
 *
 * @param {Array<{x:number,z:number}>} path
 * @returns {Float64Array} longueur `4 × path.length`.
 */
export function pathFrames(path) {
  const rows = path?.length ?? 0;
  const out = new Float64Array(rows * 4);

  for (let r = 0; r < rows; r++) {
    const prev = path[Math.max(0, r - 1)];
    const next = path[Math.min(rows - 1, r + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    out[r * 4] = tx;
    out[r * 4 + 1] = tz;
    out[r * 4 + 2] = tz; // px
    out[r * 4 + 3] = -tx; // pz
  }
  return out;
}

/**
 * Altitude de la plate-forme d'une chaussée sur une section en travers.
 *
 * Dressée à mi-hauteur de la section (`deck`) : un terrassier équilibre
 * déblai et remblai, donc la route est en partie encaissée en amont (falaise
 * taillée jusqu'au terrain, `furnitureLayer`) et en partie portée en aval (mur
 * qui descend, glissière dessus). Retenir le point haut éviterait le déblai
 * mais mettrait toute la chaussée en surplomb continu — pas fidèle à une
 * route de montagne mi-taillée mi-portée. Le terrain amont qui déborde est
 * donc entaillé (`terrainBubble.setRoadCut`).
 *
 * @param {Array<{x:number,z:number}>} path
 * @param {number} r          Indice de ligne.
 * @param {Float64Array} frames Repères (`pathFrames`).
 * @param {number} halfWidth
 * @param {Function} sampleElevation `(x, z) => altitude`.
 * @returns {{left:number, right:number, deck:number}} altitudes des deux rives
 *          et de la plate-forme retenue.
 */
export function levelRow(path, r, frames, halfWidth, sampleElevation) {
  const px = frames[r * 4 + 2];
  const pz = frames[r * 4 + 3];
  const { x, z } = path[r];

  const left = sampleElevation(x + px * halfWidth, z + pz * halfWidth);
  const right = sampleElevation(x - px * halfWidth, z - pz * halfWidth);
  return {
    left,
    right,
    // Moyenne des deux rives, pas l'axe (échantillon unique, bruit du MNT).
    deck: (left + right) * 0.5,
  };
}

/**
 * Accumulateur de géométrie : plusieurs rubans finissent dans un seul maillage.
 * `tips` y ajoute l'attribut des bouts rongés (voir `appendRibbon`).
 */
export function createRibbonBuffer({ tips = false } = {}) {
  const buffer = { positions: [], uvs: [], indices: [] };
  if (tips) buffer.tips = [];
  return buffer;
}

/** Accumulateur de sections balayées : positions et couleurs, pas d'UV. */
export function createProfileBuffer() {
  return { positions: [], colors: [], indices: [] };
}

/**
 * Ajoute un ruban à l'accumulateur.
 *
 * @param {Object} buffer          Résultat de `createRibbonBuffer()`.
 * @param {Object} options
 * @param {Array} options.path     Polyligne ré-échantillonnée (`resamplePath`).
 * @param {number} options.halfWidth
 * @param {Function} options.sampleElevation `(x, z) => altitude en mètres`.
 * @param {number} [options.lift]  Décollement au-dessus de la surface.
 * @param {number} [options.textureLength] Mètres couverts par un cycle vertical.
 * @param {number} [options.columns]
 * @param {number} [options.smoothRadius]
 * @param {boolean} [options.level] Dresse la section de niveau en travers
 *        (`levelRow`). Vrai par défaut : c'est le comportement d'une chaussée.
 * @param {Float32Array} [options.platform] Altitudes de plate-forme déjà
 *        calculées et lissées, une par ligne — évite de refaire l'échantillonnage
 *        quand l'appelant en a besoin par ailleurs (talus, glissières). Posées
 *        telles quelles : c'est la cote que tout le reste lit.
 * @param {{head:boolean, tail:boolean}} [options.tips] Bouts rongés, écrits
 *        dans l'accumulateur qui les porte : le masque du bord y est relu en
 *        travers sur une demi-largeur depuis le bout. Une ligne doit exister à
 *        cette distance (`slicePath`), sans quoi la morsure s'étire jusqu'à la
 *        suivante.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendRibbon(
  buffer,
  {
    path,
    halfWidth,
    sampleElevation,
    lift = 0,
    textureLength = 12,
    columns = 5,
    smoothRadius = 2,
    level = true,
    platform = null,
    tips = null,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || columns < 2) return false;

  const base = buffer.positions.length / 3;
  const frames = pathFrames(path);
  const heights = new Float32Array(rows * columns);
  const points = new Float32Array(rows * columns * 2); // x, z entrelacés

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    let deck = 0;
    if (level) {
      if (platform) deck = platform[r];
      else deck = levelRow(path, r, frames, halfWidth, sampleElevation).deck;
    }

    for (let c = 0; c < columns; c++) {
      const u = c / (columns - 1);
      const offset = (u - 0.5) * 2 * halfWidth;
      const x = path[r].x + px * offset;
      const z = path[r].z + pz * offset;
      const index = r * columns + c;
      points[index * 2] = x;
      points[index * 2 + 1] = z;
      heights[index] = (level ? deck : sampleElevation(x, z)) + lift;
    }
  }

  // Lissé seulement quand les altitudes viennent d'être relevées ici : c'est le
  // bruit du MNT qu'il s'agit d'amortir (le ballast d'une voie ferrée, qui suit
  // le sol point par point). Une plate-forme, elle, est déjà dressée et
  // **partagée** — le déblai du terrain, les bordures, le marquage et le
  // mobilier la lisent telle quelle. La relisser ici ne lissait que le ruban :
  // au sommet d'une côte, la moyenne glissante le faisait passer sous le
  // terrain entaillé à la cote de la plate-forme, et le sol traversait la
  // chaussée.
  if (!platform) smoothColumns(heights, rows, columns, smoothRadius);

  const width = halfWidth * 2;
  const start = path[0].distance;
  const end = path[rows - 1].distance;
  // Phase du bruit prise sur la position quantifiée du bout, et ramenée à un
  // cycle : deux chemins ne s'y rongent pas pareil.
  const phase = (point) =>
    (((Math.round(point.x) * 7.31 + Math.round(point.z) * 3.17) % textureLength) + textureLength) %
    textureLength;
  const headPhase = phase(path[0]);
  const tailPhase = phase(path[rows - 1]);

  for (let r = 0; r < rows; r++) {
    const fromHead = tips?.head ? path[r].distance - start : Infinity;
    const fromTail = tips?.tail ? end - path[r].distance : Infinity;
    // Zéro au-delà d'une demi-largeur du bout : le milieu du masque, qui est plein.
    const bite = Math.max(0, 0.5 - Math.min(fromHead, fromTail) / width);
    const tipPhase = fromHead <= fromTail ? headPhase : tailPhase;
    for (let c = 0; c < columns; c++) {
      const index = r * columns + c;
      const u = c / (columns - 1);
      buffer.positions.push(points[index * 2], heights[index], points[index * 2 + 1]);
      buffer.uvs.push(u, path[r].distance / textureLength);
      buffer.tips?.push(bite, (u * width + tipPhase) / textureLength);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = base + r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  return true;
}

/** Hauteur de contremarche visée, en mètres (norme du bâtiment : 16 à 18 cm). */
export const STEP_RISE_M = 0.17;

/**
 * Balaie un escalier le long d'une polyligne : la plate-forme continue
 * (`platform`, une cote par ligne, dressée comme pour `appendRibbon`) est
 * redécoupée en marches de hauteur constante — un vrai plan horizontal par
 * marche relié à la suivante par une face verticale, pas une rampe qui
 * l'imite.
 *
 * Le nombre de marches vient de la dénivelée totale entre les deux bouts du
 * tronçon, divisée par `STEP_RISE_M` et arrondie : c'est la seule cote qu'un
 * escalier OSM ne porte jamais, et elle fixe une contremarche régulière du
 * bas en haut, comme un escalier réel — le giron, lui, est ce que la longueur
 * du tracé laisse à chaque marche une fois leur nombre fixé.
 *
 * Repris de `appendRibbon` : les colonnes vont de la rive droite (u=0) à la
 * rive gauche (u=1) de la marche, dans le même ordre — un escalier partage
 * son buffer avec les rubans du même profil.
 *
 * @param {Object} buffer Résultat de `createRibbonBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number,distance:number}>} options.path Tracé
 *        continu de la volée (déjà ré-échantillonné, comme pour `appendRibbon`).
 * @param {number} options.halfWidth
 * @param {Float32Array} options.platform Cote de plate-forme continue, une
 *        par ligne de `path` : c'est elle qui donne la dénivelée à répartir en
 *        marches, pas le terrain brut revisité ligne à ligne.
 * @param {number} [options.lift] Décollement au-dessus de la plate-forme.
 * @param {number} [options.textureLength] Mètres couverts par un cycle de texture.
 * @param {number} [options.riseM] Hauteur de marche visée (`STEP_RISE_M`).
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendSteps(
  buffer,
  { path, halfWidth, platform, lift = 0, textureLength = 12, riseM = STEP_RISE_M }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !platform) return false;

  const start = path[0].distance;
  const end = path[rows - 1].distance;
  const span = end - start;
  if (!(span > 0)) return false;

  const frames = pathFrames(path);
  // Position et repère transverse à une distance quelconque du tracé continu —
  // c'est lui qui donne le sens de la marche ; les marches elles-mêmes n'en
  // portent pas, deux d'entre elles pouvant partager le même point du plan.
  const at = (distance) => {
    let row = 0;
    while (row < rows - 2 && path[row + 1].distance < distance) row++;
    const a = path[row];
    const b = path[row + 1];
    const span2 = b.distance - a.distance;
    const t = span2 > 0 ? Math.min(1, Math.max(0, (distance - a.distance) / span2)) : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      px: frames[row * 4 + 2] + (frames[(row + 1) * 4 + 2] - frames[row * 4 + 2]) * t,
      pz: frames[row * 4 + 3] + (frames[(row + 1) * 4 + 3] - frames[row * 4 + 3]) * t,
    };
  };

  const drop = platform[rows - 1] - platform[0];
  const steps = Math.max(1, Math.round(Math.abs(drop) / riseM));

  // Les deux arêtes d'une section, dans l'ordre de colonne d'`appendRibbon` :
  // rive droite (u=0) puis rive gauche (u=1).
  const edges = (point, height) => ({
    right: { x: point.x - point.px * halfWidth, y: height, z: point.z - point.pz * halfWidth },
    left: { x: point.x + point.px * halfWidth, y: height, z: point.z + point.pz * halfWidth },
  });

  const pushQuad = (a, b, va, vb) => {
    const i0 = buffer.positions.length / 3;
    buffer.positions.push(a.right.x, a.right.y, a.right.z);
    buffer.positions.push(a.left.x, a.left.y, a.left.z);
    buffer.positions.push(b.right.x, b.right.y, b.right.z);
    buffer.positions.push(b.left.x, b.left.y, b.left.z);
    buffer.uvs.push(0, va, 1, va, 0, vb, 1, vb);
    buffer.indices.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
    if (buffer.tips) for (let i = 0; i < 4; i++) buffer.tips.push(0, 0);
  };

  let point = at(start);
  let height = platform[0] + lift;
  let distance = start;

  for (let k = 1; k <= steps; k++) {
    const nextDistance = start + (span * k) / steps;
    const nextHeight = platform[0] + (drop * k) / steps + lift;
    const nextPoint = at(nextDistance);

    // Contremarche : face verticale à la position de la marche précédente.
    pushQuad(edges(point, height), edges(point, nextHeight), distance / textureLength, distance / textureLength);
    // Giron : plan horizontal jusqu'à la marche suivante.
    pushQuad(
      edges(point, nextHeight),
      edges(nextPoint, nextHeight),
      distance / textureLength,
      nextDistance / textureLength
    );

    point = nextPoint;
    height = nextHeight;
    distance = nextDistance;
  }

  return true;
}

/**
 * Balaie une section quelconque le long d'une polyligne posée sur le terrain.
 * Brique de tout le mobilier linéaire : haie, muret, glissière, mur de
 * soutènement, talus, câble ne diffèrent que par leur section.
 *
 * Section décrite en mètres dans un repère (travers, hauteur) : `across`
 * compte positivement à gauche de la marche, `up` part du sol. Chaque sommet
 * porte sa couleur (dégradé pied/crête sans texture).
 *
 * @param {Object} buffer  Résultat de `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.path Polyligne ré-échantillonnée.
 * @param {Array<{across:number, up:number, color:number[]}>} options.profile
 *        Section, dans l'ordre du parcours. Au moins deux sommets.
 * @param {Function} options.sampleElevation `(x, z) => altitude en mètres`.
 * @param {number} [options.offset]  Décalage latéral de l'axe de balayage.
 * @param {number} [options.lift]    Décollement au-dessus du sol.
 * @param {Float32Array} [options.baseHeights] Altitudes imposées, une par ligne
 *        (mobilier posé sur une plate-forme plutôt que sur le terrain nu).
 * @param {boolean} [options.closed] La section est un anneau : on referme le
 *        dernier sommet sur le premier et on bouche les deux extrémités.
 * @param {number} [options.smoothRadius]
 * @param {Float32Array|number[]} [options.scaleUp] Facteur appliqué à `up`,
 *        une valeur par ligne (hauteur qui respire le long du tracé, sans
 *        quoi la section constante se lit comme un tube extrudé).
 * @param {Float32Array|number[]} [options.scaleAcross] Facteur appliqué à
 *        `across`, une valeur par ligne (dilate la section sans déplacer l'axe).
 * @param {Float32Array|number[]} [options.lateralJitter] Décalage de
 *        `offset`, une valeur par ligne, en mètres — déplace l'axe lui-même
 *        (ondule en plan, pas seulement en coupe).
 * @param {Float64Array} [options.frames] Repères déjà connus (`pathFrames`),
 *        quatre nombres par ligne. À donner quand la section doit se poser
 *        **exactement** sur une rive déjà construite ailleurs : recalculés sur
 *        une portion, les repères de tête et de queue diffèrent de ceux du
 *        tracé entier, et la section s'en écarte de quelques millimètres.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendProfile(
  buffer,
  {
    path,
    profile,
    sampleElevation,
    offset = 0,
    lift = 0,
    baseHeights = null,
    closed = false,
    smoothRadius = 2,
    scaleUp = null,
    scaleAcross = null,
    lateralJitter = null,
    frames = null,
  }
) {
  const rows = path?.length ?? 0;
  const cols = profile?.length ?? 0;
  if (rows < 2 || cols < 2) return false;

  // Les repères peuvent être **donnés** : une bordure suit la rive d'une
  // chaussée, et cette rive est posée par le ruban à partir des repères du
  // tronçon **entier**. Les recalculer sur la seule portion bordurée les fait
  // diverger à ses deux bouts (un repère de tête n'a pas de voisin avant lui),
  // d'où une fente de quelques millimètres entre bitume et caniveau — celle
  // que six centimètres de recouvrement cachaient jusqu'ici.
  const framesUsed = frames || pathFrames(path);
  const base = buffer.positions.length / 3;

  // Lissée avant usage, sinon le muret suit le bruit métrique du MNT.
  const ground = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    if (baseHeights) {
      ground[r] = baseHeights[r] + lift;
      continue;
    }
    const px = framesUsed[r * 4 + 2];
    const pz = framesUsed[r * 4 + 3];
    const off = offset + (lateralJitter ? lateralJitter[r] : 0);
    ground[r] = sampleElevation(path[r].x + px * off, path[r].z + pz * off) + lift;
  }
  smoothColumns(ground, rows, 1, smoothRadius);

  for (let r = 0; r < rows; r++) {
    const px = framesUsed[r * 4 + 2];
    const pz = framesUsed[r * 4 + 3];
    const off = offset + (lateralJitter ? lateralJitter[r] : 0);
    const ax = path[r].x + px * off;
    const az = path[r].z + pz * off;

    const rise = scaleUp ? scaleUp[r] : 1;
    const spread = scaleAcross ? scaleAcross[r] : 1;
    for (let c = 0; c < cols; c++) {
      const p = profile[c];
      const wide = p.across * spread;
      buffer.positions.push(ax + px * wide, ground[r] + p.up * rise, az + pz * wide);
      buffer.colors.push(p.color[0], p.color[1], p.color[2]);
    }
  }

  const span = closed ? cols : cols - 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < span; c++) {
      const c1 = (c + 1) % cols;
      const a = base + r * cols + c;
      const b = base + r * cols + c1;
      const d = base + (r + 1) * cols + c;
      const e = base + (r + 1) * cols + c1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  // Bouchons : une haie coupée net laisserait voir son intérieur.
  if (closed && cols >= 3) {
    const lastRow = base + (rows - 1) * cols;
    for (let c = 1; c < cols - 1; c++) {
      buffer.indices.push(base, base + c + 1, base + c);
      buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
    }
  }

  return true;
}

/**
 * Balaie un mur de hauteur variable le long d'une polyligne — ce
 * qu'`appendProfile` (section fixe) ne sait pas faire, alors qu'un mur de
 * soutènement fait deux mètres ici et vingt centimètres cinquante mètres
 * plus loin. Parallélépipède balayé avec une arase débordante (`coping`) qui
 * fait lire « ouvrage » plutôt que « boîte ».
 *
 * @param {Object} buffer  Résultat de `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.path
 * @param {Float32Array|number[]} options.base Altitude du pied, par ligne.
 * @param {Float32Array|number[]} options.top  Altitude de l'arase, par ligne.
 * @param {number} [options.offset]    Décalage latéral de l'axe du mur.
 * @param {number} [options.thickness] Épaisseur, en mètres.
 * @param {number} [options.coping]    Débord du couronnement, en mètres.
 * @param {number[]} options.colorFoot Couleur du pied, RVB linéaire.
 * @param {number[]} options.colorTop  Couleur de l'arase.
 * @param {number} [options.minHeight] En deçà, la ligne est ignorée.
 * @param {Float32Array|number[]} [options.scaleAcross] Facteur de l'épaisseur,
 *        une valeur par ligne ; le couronnement garde son débord.
 * @param {Float32Array|number[]} [options.lateralJitter] Décalage de `offset`,
 *        une valeur par ligne, en mètres.
 * @param {Float32Array|number[]} [options.batter] Fruit, une valeur par ligne :
 *        écart du pied sous l'arase, en mètres, signé dans le repère de
 *        `offset`. Seul le parement de ce côté s'incline.
 * @param {boolean} [options.flat] Triangles désolidarisés : ombrage plat, même
 *        dans un maillage lissé ailleurs.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendVariableWall(
  buffer,
  {
    path,
    base,
    top,
    offset = 0,
    thickness = 0.5,
    coping = 0.06,
    colorFoot,
    colorTop,
    minHeight = 0.12,
    scaleAcross = null,
    lateralJitter = null,
    batter = null,
    flat = false,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !base || !top) return false;

  let tallest = 0;
  for (let r = 0; r < rows; r++) tallest = Math.max(tallest, top[r] - base[r]);
  if (tallest < minHeight) return false;

  const frames = pathFrames(path);
  const start = buffer.positions.length / 3;
  const firstIndex = buffer.indices.length;
  const colors = [colorFoot, colorTop, colorTop, colorTop, colorTop, colorFoot];
  const cols = colors.length;

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const off = offset + (lateralJitter ? lateralJitter[r] : 0);
    const ax = path[r].x + px * off;
    const az = path[r].z + pz * off;
    // Hauteur plancher : évite les faces dégénérées au milieu du balayage.
    const foot = base[r];
    const crest = Math.max(top[r], foot + minHeight);
    const half = (thickness / 2) * (scaleAcross ? scaleAcross[r] : 1);
    const lean = batter ? batter[r] : 0;
    // Six sommets par ligne en anneau : pied, arase débordante, dessus, retour.
    const across = [
      -half + Math.min(lean, 0),
      -half - coping,
      -half - coping,
      half + coping,
      half + coping,
      half + Math.max(lean, 0),
    ];
    const ups = [foot, crest - coping, crest, crest, crest - coping, foot];

    for (let c = 0; c < cols; c++) {
      buffer.positions.push(ax + px * across[c], ups[c], az + pz * across[c]);
      buffer.colors.push(colors[c][0], colors[c][1], colors[c][2]);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = start + r * cols + c;
      const b = start + r * cols + c1;
      const d = start + (r + 1) * cols + c;
      const e = start + (r + 1) * cols + c1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  const lastRow = start + (rows - 1) * cols;
  for (let c = 1; c < cols - 1; c++) {
    buffer.indices.push(start, start + c + 1, start + c);
    buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
  }

  if (flat) unweld(buffer, start, firstIndex);
  return true;
}

/**
 * Donne à chaque triangle écrit depuis `vertex` et `index` ses propres
 * sommets : `computeVertexNormals` n'a plus rien à moyenner, et ce morceau est
 * ombré à plat dans un maillage lissé ailleurs.
 */
function unweld(buffer, vertex, index) {
  const positions = buffer.positions.splice(vertex * 3);
  const colors = buffer.colors.splice(vertex * 3);
  for (let i = index; i < buffer.indices.length; i++) {
    const v = (buffer.indices[i] - vertex) * 3;
    buffer.positions.push(positions[v], positions[v + 1], positions[v + 2]);
    buffer.colors.push(colors[v], colors[v + 1], colors[v + 2]);
    buffer.indices[i] = vertex + i - index;
  }
}

/**
 * Balaie la falaise d'un déblai : la paroi qui tient le versant au-dessus
 * d'une chaussée taillée dedans.
 *
 * Ce n'est pas un mur, et la différence est toute la raison d'être de cette
 * fonction : pas d'appareillage, pas de couronnement débordant, pas de
 * parement d'épaisseur constante. Une paroi franche, cassée à mi-hauteur
 * (`crest`, `breakUp`), prolongée d'un dos rocheux (`shelf`) qui remonte
 * jusqu'au versant intact (`cap`), là où le déblai a fini de se raccorder
 * (`roadCut.ROAD_CUT_BLEND_M`).
 *
 * Ce dos n'est pas décoratif. Le terrain, lui, ne sait pas se tenir vertical :
 * la maille descend à quatre mètres et l'entaille remonte au naturel sur cinq
 * mètres de raccord, ce qui laisse un talus de terre là où un terrassier a
 * coupé de la roche. Le dos le couvre en s'appuyant dessus — il se tient entre
 * ce talus et la ligne du terrain naturel. Tendu jusqu'à cette ligne, il
 * coifferait la falaise d'une table de plusieurs mètres de large ; posé sur le
 * talus, il n'en serait qu'un placage. C'est l'appelant qui tranche, ligne par
 * ligne.
 *
 * Section fermée (la face, le dos, l'arrière enterré, la semelle) : ce qui est
 * enfoui ne se voit pas, mais un anneau ne laisse jamais voir l'intérieur
 * d'une paroi coupée net.
 *
 * ## Le grain low poly
 *
 * Toutes les cotes de la section sont données **par ligne**, tirées par
 * l'appelant (`facetJitter`) : l'arase avance et recule, la cassure monte,
 * descend et saille, le pied ondule. Une paroi rocheuse se lit à ses écailles.
 *
 * @param {Object} buffer  Résultat de `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.path
 * @param {Float32Array|number[]} options.base  Altitude du pied, par ligne.
 * @param {Float32Array|number[]} options.crest Altitude de l'arase, par ligne.
 * @param {Float32Array|number[]} [options.shelf] Altitude du dos, par ligne,
 *        lue à `shelfAt` — entre le talus qu'il couvre et le terrain naturel.
 * @param {Float32Array|number[]} [options.cap] Altitude à laquelle le dos
 *        rejoint le versant, par ligne. À défaut, celle de l'arase — mais le
 *        versant continue de monter derrière la paroi, et l'arase est dentelée
 *        quand lui ne l'est pas.
 * @param {number} [options.offset]   Décalage latéral du pied, signé.
 * @param {number} [options.side]     Côté du versant : `+1` à gauche de la marche.
 * @param {Float32Array|number[]} options.reach Fruit de la paroi, par ligne :
 *        recul horizontal du pied à l'arase, en mètres.
 * @param {number} [options.capReach] Recul du raccord au versant, en mètres.
 * @param {Float32Array|number[]} [options.capOut] Rallonge de ce recul, par
 *        ligne — vers le versant seulement : plus court, l'arrière flotterait
 *        au-dessus du raccord au lieu de s'y enfoncer.
 * @param {number} [options.shelfAt] Où se lit le dos, en part de sa largeur.
 * @param {Float32Array|number[]} [options.breakUp] Hauteur de la cassure, par
 *        ligne, en part de la paroi.
 * @param {Float32Array|number[]} [options.breakOut] Saillie de la cassure, par
 *        ligne, en part du fruit.
 * @param {Float32Array|number[]} [options.footOut] Débord du pied, par ligne, en
 *        mètres — vers le versant seulement : un pied tiré vers la chaussée
 *        mordrait sur l'accotement.
 * @param {number[]} options.colorFoot  Couleur du pied, RVB linéaire.
 * @param {number[]} options.colorBreak Couleur de la cassure, à mi-hauteur.
 * @param {number[]} options.colorTop   Couleur de l'arase.
 * @param {number} [options.minHeight]  En deçà, rien n'est engendré.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendRockCut(
  buffer,
  {
    path,
    base,
    crest,
    shelf = null,
    cap = null,
    offset = 0,
    side = 1,
    reach,
    capReach = 0,
    capOut = null,
    shelfAt = 0.45,
    breakUp = null,
    breakOut = null,
    footOut = null,
    colorFoot,
    colorBreak,
    colorTop,
    minHeight = 0.3,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !base || !crest || !reach) return false;

  let tallest = 0;
  for (let r = 0; r < rows; r++) tallest = Math.max(tallest, crest[r] - base[r]);
  if (tallest < minHeight) return false;

  const frames = pathFrames(path);
  const start = buffer.positions.length / 3;
  const colors = [colorFoot, colorBreak, colorTop, colorTop, colorBreak, colorFoot];
  const cols = colors.length;

  const at = (array, r, fallback) => (array ? array[r] : fallback);

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const foot = base[r];
    // Hauteur plancher : une ligne dégénérée au milieu du balayage replierait
    // la banquette sur la semelle.
    const top = Math.max(crest[r], foot + minHeight);
    const height = top - foot;
    const run = Math.max(reach[r], 0.1);
    // La banquette ne peut pas être en deçà de l'arase qu'elle prolonge.
    const back = Math.max(capReach + Math.max(0, at(capOut, r, 0)), run + 0.1);
    // Le raccord au versant : plus haut que l'arase dès que le versant
    // continue de monter derrière la paroi, ce qui est le cas ordinaire.
    const rear = Math.max(at(cap, r, top), foot + minHeight);
    // Le dos, borné par ses deux bords : au-dessus, la roche coifferait le
    // versant ; en dessous, elle plongerait sous le talus qu'elle couvre.
    const sag = Math.max(Math.min(at(shelf, r, rear), Math.max(top, rear)), foot);
    const lip = Math.max(0, at(footOut, r, 0));
    const across = [lip, run * at(breakOut, r, 0.45), run, run + (back - run) * shelfAt, back, back];
    // Cassure basse (0,58 par défaut) : une falaise taillée s'évase du pied
    // vers la crête, elle ne se plie pas au milieu.
    const ups = [foot, foot + height * at(breakUp, r, 0.58), top, sag, rear, foot];

    for (let c = 0; c < cols; c++) {
      const d = offset + side * across[c];
      buffer.positions.push(path[r].x + px * d, ups[c], path[r].z + pz * d);
      buffer.colors.push(colors[c][0], colors[c][1], colors[c][2]);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = start + r * cols + c;
      const b = start + r * cols + c1;
      const d = start + (r + 1) * cols + c;
      const e = start + (r + 1) * cols + c1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  const lastRow = start + (rows - 1) * cols;
  for (let c = 1; c < cols - 1; c++) {
    buffer.indices.push(start, start + c + 1, start + c);
    buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
  }

  return true;
}

/**
 * Convertit un accumulateur de sections en `BufferGeometry` colorée.
 *
 * @param {boolean} [options.flat] Normales par face plutôt que moyennées
 *        (nécessaire pour qu'un tracé facetté, `facetJitter`, garde ses
 *        arêtes visibles ; `false` pour l'ombrage lissé attendu par
 *        glissière, câble).
 * @returns {Object|null} `null` si rien n'a été accumulé.
 */
export function toColoredGeometry(THREE, buffer, { flat = false } = {}) {
  if (buffer.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
  geometry.setIndex(buffer.indices);
  // `toNonIndexed` duplique les sommets : plus rien à moyenner, donc une normale par face.
  const flattened = flat ? geometry.toNonIndexed() : geometry;
  flattened.computeVertexNormals();
  flattened.computeBoundingSphere();
  return flattened;
}

/**
 * Convertit l'accumulateur en `BufferGeometry`.
 * @returns {Object|null} `null` si rien n'a été accumulé.
 */
export function toGeometry(THREE, buffer) {
  if (buffer.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
  if (buffer.tips) geometry.setAttribute('tipUv', new THREE.Float32BufferAttribute(buffer.tips, 2));
  geometry.setIndex(buffer.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
