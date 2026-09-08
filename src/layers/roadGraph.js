/*
 * roadGraph — recoudre les chaussées entre elles avant de les dessiner. Une
 * tuile vectorielle livre des morceaux (découpés à la frontière de tuile et à
 * chaque changement d'attribut), et une même route revient plusieurs fois.
 * Non recousus, ça se voit : rubans superposés, décroché d'altitude aux
 * coutures, marquage à contretemps, mobilier espacé qui redémarre sa
 * numérotation, haie qui change de côté, glissière interrompue.
 *
 * Ce module reconstitue le graphe routier (nœuds soudés, arêtes
 * dédoublonnées), en extrait les plus longues chaînes continues (priorité à
 * ce qui va tout droit), puis recoud les chaussées en altitude entre elles.
 *
 * Le graphe est le seul endroit où un croisement existe comme tel (nœud de
 * degré trois) : `mergeRoadLines` publie la liste des carrefours avec les
 * chaînes, dont s'appuient le rognage des voies secondaires
 * (`trimAtJunctions`) et les feux tricolores. Les redécouvrir après coup en
 * cherchant où deux rubans se touchent en inventerait d'autres.
 *
 * Le mobilier espacé (bornes, lampadaires) se compte depuis le dernier nœud
 * d'ancrage rencontré (carrefour, cul-de-sac, changement de classe), pas
 * depuis le début de la chaîne : ce bout-là bouge avec le jeu de tuiles chargées.
 *
 * Les ouvrages d'art (`roadWorks.js`) voyagent ici comme un troisième tableau
 * parallèle aux sommets, à côté des points et des ancres. Ils ne sont pas dans
 * la clé d'arête, et c'est délibéré : une route reste **une seule chaîne** à
 * travers son pont, donc le mobilier ne recommence pas sa numérotation à
 * chaque culée. Un sommet porte le maximum des arêtes qui s'y rejoignent —
 * convention lue par `resampleWorks`, qui reprend le minimum par intervalle.
 *
 * ## Le niveau de croisement : un quatrième tableau, et une règle de soudure
 *
 * `layer` voyage de la même façon (`chain.levels`), mais il ne se contente pas
 * d'être transporté : il décide de la **soudure des nœuds** (`NodeIndex`).
 * Deux sommets ne deviennent le même nœud que s'ils sont au même niveau.
 *
 * C'est ce qui manquait pour distinguer les quatre situations que le plan
 * confondait en une (voir l'en-tête de `roadWorks.js`) : proximité XY,
 * croisement XY, connexion routière, séparation verticale. Le graphe ne
 * contient donc plus jamais de nœud à cheval sur deux niveaux, et tout ce qui
 * le lit — carrefours, rognage, couture d'altitude, feux — hérite de la
 * distinction sans avoir à porter de filtre. Un passage supérieur sans
 * `bridge` cesse d'être un carrefour, et il n'a pas fallu quatre exceptions
 * pour ça.
 */

import { WORK_NONE, LEVEL_GROUND } from './roadWorks.js';

/** Distance en deçà de laquelle deux sommets sont le même nœud, en mètres. */
export const NODE_WELD_M = 1.2;
/** Distance maximale d'un raccord entre deux bouts libres, en mètres (couvre la marge de recouvrement des tuiles). */
export const LOOSE_JOIN_M = 8;
/** Écart latéral toléré sur un raccord lâche, en mètres. */
export const LOOSE_OFFSET_M = 2.5;
/** Cosinus de l'angle de virage au-delà duquel on ne prolonge plus une chaîne. */
export const CONTINUE_COS = Math.cos((72 * Math.PI) / 180);
/** Cosinus de l'angle toléré entre deux bouts libres qu'on recoud. */
export const COLLINEAR_COS = Math.cos((40 * Math.PI) / 180);

/** De combien la voie secondaire s'arrête en deçà de la rive dominante, en mètres (rentre sous elle, `renderOrder` dans `roadNetwork`). */
export const JUNCTION_OVERLAP_M = 0.5;
/** Longueur en deçà de laquelle ce qui reste d'une voie rognée est abandonné (un moignon qui dépasse d'un carrefour). */
export const JUNCTION_MIN_RUN_M = 4;
/** Pas de dichotomie pour poser le sommet de coupe sur le cercle du carrefour (plus nombreux que `roadCorridor` : arête brute, longue). */
export const JUNCTION_BISECT_STEPS = 14;

/** Décalage de cellule : les coordonnées locales sont signées. */
const CELL_BIAS = 1 << 14;

/** Clé numérique d'une cellule de grille. Fonction pure. */
export function cellKey(cx, cz) {
  return (cx + CELL_BIAS) * 32768 + (cz + CELL_BIAS);
}

/**
 * Index de nœuds soudés : deux sommets distants de moins que la tolérance
 * **et au même niveau** sont le même nœud (le premier arrivé impose sa
 * position). Une simple quantification ne suffirait pas (frontière de
 * grille) : on regarde les neuf cellules voisines et on compare des distances.
 *
 * ## Pourquoi le niveau soude, plutôt que d'être filtré plus loin
 *
 * La tolérance de soudure existe pour recoller **le même nœud** livré par deux
 * tuiles voisines, dont la quantification diffère de quelques décimètres. Elle
 * ne dit rien de deux nœuds *distincts* qui se trouvent à un mètre l'un de
 * l'autre — et c'est exactement ce qui se passe sous un passage supérieur, où
 * les deux chaussées ne partagent aucun nœud dans la donnée. Soudés quand
 * même, ils formaient un nœud de degré quatre : un carrefour inventé, avec sa
 * voie rognée, sa couture d'altitude et son feu tricolore.
 *
 * Refuser la soudure entre niveaux différents règle les quatre d'un coup, et
 * en amont : le graphe ne contient plus jamais de nœud à cheval sur deux
 * niveaux, donc rien de ce qui le lit n'a de filtre à porter. C'est la seule
 * façon de le corriger comme une règle plutôt que comme quatre exceptions.
 *
 * ## La culée, et pourquoi elle tient quand même
 *
 * Un pont porte `layer=1` et sa route d'approche `layer=0` : leurs sommets de
 * culée ne se soudent donc plus, et la chaîne se coupe là. C'est
 * `joinLooseEnds` qui la recoud — deux bouts libres qui se font face, alignés,
 * de même profil : la définition exacte d'une culée. La route reste donc une
 * seule chaîne à travers son pont (le mobilier espacé ne redémarre pas sa
 * numérotation), et on n'a pas eu à percer un trou dans la règle pour ça.
 *
 * Un croisement au **même** niveau reste soudé comme avant : la règle ne
 * retire rien à une donnée qui ne dit rien.
 */
class NodeIndex {
  constructor(tolerance = NODE_WELD_M) {
    this.tolerance = tolerance;
    this.cell = Math.max(tolerance, 0.01);
    this.cells = new Map();
    this.xs = [];
    this.zs = [];
    /** Niveau de croisement du nœud : un nœud n'en a qu'un. @type {number[]} */
    this.levels = [];
  }

  get size() {
    return this.xs.length;
  }

  /**
   * Identifiant du nœud à cette position et à ce niveau, créé au besoin.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} [level] Niveau de croisement (`roadWorks.roadLevelFor`).
   */
  idFor(x, z, level = LEVEL_GROUND) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bestDistance = this.tolerance * this.tolerance;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const id of bucket) {
          if (this.levels[id] !== level) continue;
          const ex = this.xs[id] - x;
          const ez = this.zs[id] - z;
          const distance = ex * ex + ez * ez;
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = id;
          }
        }
      }
    }

    if (best >= 0) return best;

    const id = this.xs.length;
    this.xs.push(x);
    this.zs.push(z);
    this.levels.push(level);
    const key = cellKey(cx, cz);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(id);
    else this.cells.set(key, [id]);
    return id;
  }
}

/** Direction unitaire de `a` vers `b`, ou `null` si les deux se confondent. */
function direction(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (!length) return null;
  return { x: dx / length, z: dz / length };
}

/**
 * Prolonge une chaîne de nœuds tant qu'une arête inutilisée continue la marche.
 *
 * À un carrefour, plusieurs arêtes partent du même nœud : on retient celle qui
 * tourne le moins. C'est ce qui fait qu'une nationale traverse un croisement
 * sans se couper, et que la petite route qui s'y greffe reste une chaîne à
 * part.
 */
function extendChain(ids, { edges, adjacency, used, nodes, rank, continueCos }) {
  const visited = new Set(ids);

  for (;;) {
    const head = ids[ids.length - 1];
    const previous = ids[ids.length - 2];
    const heading = direction(nodes.xs[previous], nodes.zs[previous], nodes.xs[head], nodes.zs[head]);
    if (!heading) break;

    const candidates = adjacency.get(adjacencyKey(head, rank));
    if (!candidates) break;

    let best = -1;
    let bestScore = continueCos;
    let bestNode = -1;
    for (const index of candidates) {
      if (used[index]) continue;
      const edge = edges[index];
      const other = edge.a === head ? edge.b : edge.a;
      if (other === head) continue;
      const outgoing = direction(nodes.xs[head], nodes.zs[head], nodes.xs[other], nodes.zs[other]);
      if (!outgoing) continue;
      const score = heading.x * outgoing.x + heading.z * outgoing.z;
      if (score > bestScore) {
        bestScore = score;
        best = index;
        bestNode = other;
      }
    }

    if (best < 0) break;
    used[best] = 1;
    ids.push(bestNode);
    // Boucle refermée : le nœud est déjà dans la chaîne, on s'arrête après
    // l'avoir posé pour que l'anneau soit fermé et pas parcouru deux fois.
    if (visited.has(bestNode)) break;
    visited.add(bestNode);
  }
}

/**
 * Rang numérique d'un profil, attribué à la volée.
 *
 * Les clés du graphe sont des nombres et pas des chaînes : sur cinquante mille
 * sommets, `${profile}|${a}|${b}` coûte cinquante mille chaînes construites puis
 * hachées, soit le tiers du temps de la fusion.
 */
function profileRank(state, profile) {
  let rank = state.ranks.get(profile);
  if (rank === undefined) {
    rank = state.ranks.size;
    state.ranks.set(profile, rank);
  }
  return rank;
}

/** Clé d'adjacence : un nœud, pour un profil donné. */
function adjacencyKey(node, rank) {
  return node * 16 + rank;
}

/** Clé d'une arête entre deux nœuds, pour un profil donné. */
function edgeKey(a, b, rank) {
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  // Un nœud tient sur 21 bits pour un million de sommets, donc la clé reste un
  // entier exact bien en deçà de 2^53.
  return (low * 2097152 + high) * 16 + rank;
}

/**
 * Ajoute une arête au graphe, en écartant les doublons entre tuiles. Le
 * doublon garde l'ouvrage le plus fort : la même arête livrée deux fois par
 * deux tuiles ne doit pas perdre son pont selon l'ordre de lecture.
 */
function addEdge(state, a, b, profile, halfWidth, works = WORK_NONE, level = LEVEL_GROUND) {
  if (a === b) return;
  const rank = profileRank(state, profile);
  const key = edgeKey(a, b, rank);
  const seen = state.seen.get(key);
  if (seen !== undefined) {
    const edge = state.edges[seen];
    if (works > edge.works) edge.works = works;
    return;
  }

  const index = state.edges.length;
  state.seen.set(key, index);
  // Le niveau n'entre pas dans la clé : les nœuds sont déjà séparés par niveau
  // (`NodeIndex`), donc deux arêtes entre les mêmes nœuds sont du même niveau.
  state.edges.push({ a, b, profile, rank, halfWidth, works, level });
  for (const node of [a, b]) {
    const listKey = adjacencyKey(node, rank);
    const list = state.adjacency.get(listKey);
    if (list) list.push(index);
    else state.adjacency.set(listKey, [index]);
    state.degree.set(node, (state.degree.get(node) || 0) + 1);
  }
}

/**
 * Recolle les bouts libres qui se chevauchent sans se toucher.
 *
 * C'est le cas de toutes les frontières de tuile : la moitié amont déborde de
 * quelques mètres au-delà de la frontière, la moitié aval déborde d'autant en
 * deçà, et les deux extrémités se croisent au lieu de se rejoindre. Le raccord
 * n'est accepté que si les deux bouts se font franchement face et restent
 * alignés — sinon on recoudrait deux routes parallèles.
 */
function joinLooseEnds(chains, { join, offset, collinearCos }) {
  const count = chains.length;
  const partner = new Int32Array(count * 2).fill(-1);
  if (count < 2) return chains;

  const ends = [];
  const grid = new Map();
  const cell = Math.max(join, 1);

  for (let c = 0; c < count; c++) {
    const points = chains[c].points;
    const last = points.length - 1;
    for (const at of [0, 1]) {
      const tip = at === 0 ? points[0] : points[last];
      const inner = at === 0 ? points[1] : points[last - 1];
      const outward = direction(inner.x, inner.z, tip.x, tip.z);
      const index = c * 2 + at;
      ends[index] = outward ? { chain: c, x: tip.x, z: tip.z, dir: outward } : null;
      if (!outward) continue;
      const key = cellKey(Math.floor(tip.x / cell), Math.floor(tip.z / cell));
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  }

  for (let i = 0; i < ends.length; i++) {
    const a = ends[i];
    if (!a || partner[i] >= 0) continue;

    const cx = Math.floor(a.x / cell);
    const cz = Math.floor(a.z / cell);
    let best = -1;
    let bestDistance = join;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i || partner[j] >= 0) continue;
          const b = ends[j];
          if (!b || b.chain === a.chain) continue;
          if (chains[a.chain].profile !== chains[b.chain].profile) continue;

          const distance = Math.hypot(b.x - a.x, b.z - a.z);
          if (distance > bestDistance) continue;
          // Les deux bouts doivent se prolonger l'un l'autre : leurs directions
          // sortantes sont donc opposées, à quarante degrés près.
          if (a.dir.x * b.dir.x + a.dir.z * b.dir.z > -collinearCos) continue;
          // Et rester alignés : deux routes parallèles distantes de trois
          // mètres ne sont pas la même route.
          const lateral = Math.abs(a.dir.x * (b.z - a.z) - a.dir.z * (b.x - a.x));
          if (lateral > offset) continue;

          bestDistance = distance;
          best = j;
        }
      }
    }

    if (best < 0) continue;
    partner[i] = best;
    partner[best] = i;
  }

  return assembleChains(chains, partner);
}

/**
 * Ajoute une chaîne à la suite d'une autre, en retirant ce qui repart en
 * arrière. Sans cette coupe, la bande de recouvrement des tuiles produirait un
 * crochet de quelques mètres au raccord — un repli visible sur le ruban.
 *
 * Les tableaux parallèles aux sommets (ancres, ouvrages, niveaux) suivent le
 * même découpage : ils voyagent groupés plutôt qu'en arguments séparés, sans
 * quoi en ajouter un revient à retoucher chaque appel.
 */
function appendChain(out, run) {
  const { points, anchors, works, levels } = run;

  const copy = (from) => {
    for (let i = from; i < points.length; i++) {
      out.points.push(points[i]);
      out.anchors.push(anchors[i]);
      out.works.push(works[i]);
      out.levels.push(levels[i]);
    }
  };

  if (out.points.length === 0) {
    copy(0);
    return;
  }

  const head = out.points[out.points.length - 1];
  const previous = out.points[out.points.length - 2];
  const heading = direction(previous.x, previous.z, head.x, head.z);
  let start = 0;
  if (heading) {
    while (
      start < points.length - 2 &&
      (points[start].x - head.x) * heading.x + (points[start].z - head.z) * heading.z <= 0.25
    ) {
      start++;
    }
  }

  copy(start);
}

/** Suit les appariements de bouts libres et concatène ce qui va ensemble. */
function assembleChains(chains, partner) {
  const visited = new Uint8Array(chains.length);
  const merged = [];

  const walk = (startEnd) => {
    const out = { points: [], anchors: [], works: [], levels: [] };
    let end = startEnd;

    for (;;) {
      const c = end >> 1;
      const at = end & 1;
      if (visited[c]) break;
      visited[c] = 1;
      const chain = chains[c];
      // Entrer par le bout `at` revient à parcourir la chaîne dans ce sens-là.
      const flip = (array) => (at === 0 ? array : array.slice().reverse());
      appendChain(out, {
        points: flip(chain.points),
        anchors: flip(chain.anchors),
        works: flip(chain.works),
        levels: flip(chain.levels),
      });

      const exit = c * 2 + (1 - at);
      const next = partner[exit];
      if (next < 0) break;
      end = next;
    }

    if (out.points.length >= 2) {
      merged.push({
        profile: chains[startEnd >> 1].profile,
        halfWidth: chains[startEnd >> 1].halfWidth,
        points: out.points,
        anchors: out.anchors,
        works: out.works,
        levels: out.levels,
      });
    }
  };

  // Les chaînes ouvertes d'abord, en partant d'un bout non apparié : commencer
  // au milieu d'une suite la couperait en deux.
  for (let i = 0; i < partner.length; i++) {
    if (partner[i] < 0 && !visited[i >> 1]) walk(i);
  }
  for (let c = 0; c < chains.length; c++) {
    if (!visited[c]) walk(c * 2);
  }

  return merged;
}

/**
 * Relève les carrefours du graphe : les nœuds où plus de deux arêtes se
 * rejoignent (degré deux = simple changement de classe, pas un carrefour).
 * Ne voit pas les chaussées qui se croisent sans partager de nœud (un pont) —
 * volontaire : mieux vaut ignorer un vrai carrefour que rogner sous un viaduc.
 *
 * Un nœud étant désormais propre à un niveau (`NodeIndex`), un passage
 * supérieur n'en produit plus du tout, même quand ses deux chaussées se
 * frôlent à moins d'un mètre : il n'y a pas de rencontre à un croisement XY.
 *
 * @returns {Array<{x:number, z:number, degree:number, level:number,
 *          halfWidth:number, profile:string, branches:Array<{x:number,
 *          z:number, halfWidth:number, profile:string}>}>}
 *          Carrefours, direction sortante unitaire par branche. `halfWidth` et
 *          `profile` sont ceux de la branche dominante — la plus large.
 */
function collectJunctions({ edges, degree }, nodes) {
  const byNode = new Map();

  for (const edge of edges) {
    for (const node of [edge.a, edge.b]) {
      if ((degree.get(node) || 0) < 3) continue;
      const other = node === edge.a ? edge.b : edge.a;
      const heading = direction(nodes.xs[node], nodes.zs[node], nodes.xs[other], nodes.zs[other]);
      if (!heading) continue;

      let junction = byNode.get(node);
      if (!junction) {
        junction = {
          x: nodes.xs[node],
          z: nodes.zs[node],
          degree: degree.get(node),
          // Un nœud n'a qu'un niveau : celui des chaussées qui s'y rencontrent
          // vraiment. Ce qui passe au-dessus a son propre nœud, ailleurs.
          level: nodes.levels[node] ?? LEVEL_GROUND,
          halfWidth: 0,
          profile: null,
          branches: [],
        };
        byNode.set(node, junction);
      }
      junction.branches.push({
        x: heading.x,
        z: heading.z,
        halfWidth: edge.halfWidth,
        profile: edge.profile,
      });
      if (edge.halfWidth > junction.halfWidth) {
        junction.halfWidth = edge.halfWidth;
        junction.profile = edge.profile;
      }
    }
  }

  // Par identifiant de nœud croissant, donc dans l'ordre où les arêtes ont été
  // lues : deux reconstructions du même jeu de tuiles rendent la même liste.
  return [...byNode.keys()].sort((a, b) => a - b).map((node) => byNode.get(node));
}

/**
 * Fusionne des polylignes de chaussée en chaînes continues, et relève les
 * carrefours du graphe au passage (une propriété du graphe — nœud de degré
 * trois — qui n'existe qu'ici).
 *
 * @param {Array<{profile:string, halfWidth:number, points:Array<{x:number,z:number}>}>} lines
 *        Polylignes métriques, telles qu'elles sortent des tuiles.
 * @param {Object} [options]
 * @returns {{chains: Array<{profile:string, halfWidth:number, points:Array,
 *          anchors:Array<boolean>}>, junctions: Array<Object>}}
 *          `chains[].anchors[i]` marque les sommets qui peuvent servir
 *          d'origine stable : carrefours, culs-de-sac, extrémités.
 */
export function mergeRoadLines(lines, options = {}) {
  const {
    weld = NODE_WELD_M,
    join = LOOSE_JOIN_M,
    offset = LOOSE_OFFSET_M,
    continueCos = CONTINUE_COS,
    collinearCos = COLLINEAR_COS,
  } = options;

  const nodes = new NodeIndex(weld);
  const state = {
    edges: [],
    seen: new Map(),
    adjacency: new Map(),
    degree: new Map(),
    ranks: new Map(),
  };

  for (const line of lines || []) {
    const points = line?.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    const works = line.works || WORK_NONE;
    const level = line.level || LEVEL_GROUND;
    let previous = nodes.idFor(points[0].x, points[0].z, level);
    for (let i = 1; i < points.length; i++) {
      const id = nodes.idFor(points[i].x, points[i].z, level);
      addEdge(state, previous, id, line.profile, line.halfWidth, works, level);
      previous = id;
    }
  }

  const { edges, adjacency, degree } = state;
  const used = new Uint8Array(edges.length);
  const chains = [];

  for (let e = 0; e < edges.length; e++) {
    if (used[e]) continue;
    used[e] = 1;
    const edge = edges[e];
    const ids = [edge.a, edge.b];
    const context = { edges, adjacency, used, nodes, rank: edge.rank, continueCos };
    extendChain(ids, context);
    ids.reverse();
    extendChain(ids, context);

    const last = ids.length - 1;
    // Un sommet porte le maximum des arêtes de la chaîne qui s'y rejoignent :
    // les deux extrémités d'un pont sont marquées pont, et `resampleWorks`
    // retrouve l'arête exacte en reprenant le minimum par intervalle.
    const works = new Array(ids.length).fill(WORK_NONE);
    // Une chaîne brute ne peut pas enjamber deux niveaux : ses nœuds sont
    // séparés par niveau. Le tableau n'a de raison d'être que parce que
    // `joinLooseEnds` recoud ensuite une culée à sa route d'approche, et que
    // la chaîne qui en sort, elle, en traverse deux.
    const levels = new Array(ids.length).fill(edge.level ?? LEVEL_GROUND);
    for (let i = 1; i < ids.length; i++) {
      const between = state.edges[state.seen.get(edgeKey(ids[i - 1], ids[i], edge.rank))];
      const code = between ? between.works : WORK_NONE;
      if (code > works[i - 1]) works[i - 1] = code;
      if (code > works[i]) works[i] = code;
    }

    chains.push({
      profile: edge.profile,
      halfWidth: edge.halfWidth,
      works,
      levels,
      points: ids.map((id) => ({ x: nodes.xs[id], z: nodes.zs[id] })),
      // Un nœud de degré deux est un simple sommet de la ligne ; tout le reste
      // — embranchement, croisement, cul-de-sac, changement de classe — est un
      // point d'ancrage, et ne bouge pas d'une reconstruction à l'autre.
      anchors: ids.map((id, i) => i === 0 || i === last || (degree.get(id) || 0) !== 2),
    });
  }

  const junctions = collectJunctions(state, nodes);
  const joined = joinLooseEnds(chains, { join, offset, collinearCos });

  // Orientation canonique : deux reconstructions successives doivent parcourir
  // la même chaîne dans le même sens, sinon tout ce qui dépend du côté de la
  // marche — la haie, la ligne téléphonique — changerait de bord.
  for (const chain of joined) {
    const first = chain.points[0];
    const last = chain.points[chain.points.length - 1];
    if (first.x > last.x || (first.x === last.x && first.z > last.z)) {
      chain.points.reverse();
      chain.anchors.reverse();
      chain.works.reverse();
      chain.levels.reverse();
    }
  }

  return { chains: joined, junctions };
}

/**
 * Rogne les voies secondaires au bord de la chaussée dominante d'un
 * carrefour (sinon la petite route traverse le croisement au lieu de s'y
 * arrêter). Coupée sur un cercle centré sur le nœud, de rayon la
 * demi-largeur de la dominante. Deux voies de même largeur ne se rognent pas
 * l'une l'autre (pas de dominante). Seuls les carrefours qui sont un sommet
 * de la chaîne la coupent — un nœud simplement à portée est un pont ou deux
 * tuiles mal recoupées. Une ligne d'ouvrage n'est jamais rognée : une bretelle
 * d'échangeur passe **au-dessus** de l'autoroute dont elle partage un nœud
 * quelques dizaines de mètres plus loin, elle ne s'arrête pas à sa rive.
 *
 * Une chaîne peut en ressortir coupée en plusieurs, ou disparaître.
 *
 * @param {Array<Object>} chains    Chaînes issues de `mergeRoadLines`.
 * @param {Array<Object>} junctions Carrefours issus de `mergeRoadLines`.
 * @param {Object} [options]
 * @returns {Array<Object>} chaînes de même forme, rognées.
 */
export function trimAtJunctions(chains, junctions, options = {}) {
  const {
    overlap = JUNCTION_OVERLAP_M,
    minLength = JUNCTION_MIN_RUN_M,
    weld = NODE_WELD_M,
    steps = JUNCTION_BISECT_STEPS,
  } = options;

  if (!Array.isArray(chains)) return [];
  if (!Array.isArray(junctions) || junctions.length === 0) return chains;

  const cell = Math.max(weld, 1) * 4;
  const grid = new Map();
  for (let j = 0; j < junctions.length; j++) {
    const key = cellKey(Math.floor(junctions[j].x / cell), Math.floor(junctions[j].z / cell));
    const bucket = grid.get(key);
    if (bucket) bucket.push(j);
    else grid.set(key, [j]);
  }

  const out = [];

  for (const chain of chains) {
    const points = chain?.points;
    if (!Array.isArray(points) || points.length < 2) continue;

    // Les carrefours qui coupent *cette* chaîne : dominants, et posés sur un de
    // ses sommets.
    const centres = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const cx = Math.floor(point.x / cell);
      const cz = Math.floor(point.z / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            const junction = junctions[j];
            if (junction.halfWidth <= chain.halfWidth + 1e-3) continue;
            // Un carrefour ne rogne que ce qui le rencontre vraiment : une voie
            // qui passe au-dessus ou au-dessous n'est pas une branche.
            if ((junction.level ?? LEVEL_GROUND) !== (chain.levels?.[index] ?? LEVEL_GROUND)) continue;
            if (Math.hypot(junction.x - point.x, junction.z - point.z) > weld) continue;
            if (centres.some((c) => c.index === j)) continue;
            centres.push({ index: j, x: junction.x, z: junction.z, radius: Math.max(0, junction.halfWidth - overlap) });
          }
        }
      }
    }

    if (centres.length === 0) {
      out.push(chain);
      continue;
    }

    const covered = (x, z) =>
      centres.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius);

    /** Sommet posé sur la limite, en partant du côté conservé. */
    const boundary = (keep, drop) => {
      let lo = keep;
      let hi = drop;
      for (let i = 0; i < steps; i++) {
        const mid = { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 };
        if (covered(mid.x, mid.z)) hi = mid;
        else lo = mid;
      }
      return hi;
    };

    const runs = [];
    let run = null;
    for (let i = 0; i < points.length; i++) {
      // Un ouvrage ne se rogne pas : il ne touche pas la chaussée qu'il croise.
      const inside = !chain.works?.[i] && covered(points[i].x, points[i].z);
      if (!inside) {
        if (!run) {
          run = { points: [], anchors: [], works: [], levels: [] };
          // Entrée de plage : le sommet de coupe manquant est celui posé sur
          // la limite, entre le sommet écarté et celui-ci.
          if (i > 0) {
            const edge = boundary(points[i], points[i - 1]);
            run.points.push(edge);
            // Il vient du carrefour, donc d'un point que la donnée porte : il
            // fait une origine aussi stable que le nœud lui-même.
            run.anchors.push(true);
            run.works.push(chain.works?.[i] || WORK_NONE);
            run.levels.push(chain.levels?.[i] ?? LEVEL_GROUND);
          }
          runs.push(run);
        }
        run.points.push(points[i]);
        run.anchors.push(!!chain.anchors?.[i]);
        run.works.push(chain.works?.[i] || WORK_NONE);
        run.levels.push(chain.levels?.[i] ?? LEVEL_GROUND);
      } else if (run) {
        // Sortie de plage : la limite se cherche depuis le dernier sommet gardé.
        run.points.push(boundary(run.points[run.points.length - 1], points[i]));
        run.anchors.push(true);
        run.works.push(run.works[run.works.length - 1] || WORK_NONE);
        run.levels.push(run.levels[run.levels.length - 1] ?? LEVEL_GROUND);
        run = null;
      }
    }

    for (const candidate of runs) {
      if (candidate.points.length < 2) continue;
      let length = 0;
      for (let i = 1; i < candidate.points.length; i++) {
        length += Math.hypot(
          candidate.points[i].x - candidate.points[i - 1].x,
          candidate.points[i].z - candidate.points[i - 1].z
        );
      }
      if (length < minLength) continue;
      out.push({
        profile: chain.profile,
        halfWidth: chain.halfWidth,
        points: candidate.points,
        anchors: candidate.anchors,
        works: candidate.works,
        levels: candidate.levels,
      });
    }
  }

  return out;
}

/** Marge de requête au-delà de la chaussée couverte par l'index, en mètres. */
export const ROAD_INDEX_MARGIN_M = 3;
/** Côté d'une cellule de l'index, en mètres. */
export const ROAD_INDEX_CELL_M = 12;

/** Distance d'un point au segment `[a, b]`, et abscisse du projeté. Pure. */
export function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  let t = 0;
  if (lengthSq > 0) {
    t = ((x - ax) * dx + (z - az) * dz) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const px = ax + dx * t;
  const pz = az + dz * t;
  return { distance: Math.hypot(x - px, z - pz), t };
}

/**
 * Index spatial des chaussées construites. Deux usages : savoir si un point
 * tombe sur une chaussée (herbe), et retrouver l'altitude qui y passe
 * (recoudre une voie sur une autre). Chaque arête est inscrite dans toutes
 * les cellules que couvre sa boîte élargie, pour qu'une interrogation n'ait
 * qu'une seule cellule à lire.
 *
 * **Un ouvrage d'art n'y entre pas.** L'emprise est une empreinte au sol, et
 * là où la chaussée est portée ou enterrée, le sol appartient au paysage :
 * l'herbe pousse sous un viaduc, les arbres poussent au-dessus d'un tunnel, et
 * le terrain ne se creuse ni jusqu'à la dalle de l'un ni jusqu'au tablier de
 * l'autre. Une seule arête reste inscrite à chaque culée — celle qui joint le
 * sol à l'ouvrage —, pour que l'emprise ne s'interrompe pas avant le pont.
 */
export class RoadIndex {
  /**
   * @param {Array<Object>} segments Tronçons produits par `collectRoadSegments`.
   * @param {Object} [options]
   */
  constructor(segments, { cell = ROAD_INDEX_CELL_M, margin = ROAD_INDEX_MARGIN_M } = {}) {
    this.segments = segments || [];
    this.cell = cell;
    this.margin = margin;
    /** @type {Map<number, number[]>} paires (tronçon, ligne) mises à plat. */
    this.buckets = new Map();

    for (let s = 0; s < this.segments.length; s++) {
      const segment = this.segments[s];
      const path = segment?.path;
      if (!Array.isArray(path) || path.length < 2) continue;
      const reach = segment.halfWidth + margin;
      const works = segment.works;

      for (let r = 0; r < path.length - 1; r++) {
        if (works?.[r] && works[r + 1]) continue;
        const a = path[r];
        const b = path[r + 1];
        const minX = Math.floor((Math.min(a.x, b.x) - reach) / cell);
        const maxX = Math.floor((Math.max(a.x, b.x) + reach) / cell);
        const minZ = Math.floor((Math.min(a.z, b.z) - reach) / cell);
        const maxZ = Math.floor((Math.max(a.z, b.z) + reach) / cell);

        for (let cx = minX; cx <= maxX; cx++) {
          for (let cz = minZ; cz <= maxZ; cz++) {
            const key = cellKey(cx, cz);
            const bucket = this.buckets.get(key);
            if (bucket) bucket.push(s, r);
            else this.buckets.set(key, [s, r]);
          }
        }
      }
    }
  }

  /**
   * Chaussée la plus proche recouvrant le point, ou `null`.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} [margin] Élargissement de la chaussée, en mètres.
   * @param {Function} [accept] `(segment, index) => boolean`, pour ne retenir
   *        que certaines chaussées (une plus large que soi, par exemple).
   * @returns {{segment:Object, index:number, row:number, t:number, distance:number}|null}
   */
  query(x, z, margin = 0, accept = null) {
    const reach = Math.min(margin, this.margin);
    const bucket = this.buckets.get(cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!bucket) return null;

    let best = null;
    for (let i = 0; i < bucket.length; i += 2) {
      const index = bucket[i];
      const row = bucket[i + 1];
      const segment = this.segments[index];
      if (accept && !accept(segment, index)) continue;

      const a = segment.path[row];
      const b = segment.path[row + 1];
      const hit = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
      if (hit.distance > segment.halfWidth + reach) continue;
      if (best && hit.distance >= best.distance) continue;
      best = { segment, index, row, t: hit.t, distance: hit.distance };
    }
    return best;
  }

  /** Vrai si le point tombe sur une chaussée, marge comprise. */
  covers(x, z, margin = 0) {
    return this.query(x, z, margin) !== null;
  }

  /**
   * Chaussée la plus proche d'un point **à distance**, et le point de son axe
   * qui lui fait face.
   *
   * `query` répond à « suis-je dessus ? » et se borne donc à l'emprise. La
   * question posée ici est l'autre : « où est la route la plus proche ? »,
   * celle que se pose ce qui veut se **rapprocher** d'une chaussée sans y
   * monter — un troupeau qu'on veut voir depuis la route, par exemple. D'où
   * le balayage des cellules à portée plutôt que de la seule cellule du point.
   *
   * Le coût croît avec le carré de la portée : c'est une question qu'on pose
   * une fois par parcelle, pas une fois par objet.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} radius Portée de la recherche, en mètres.
   * @returns {{segment:Object, index:number, row:number, t:number,
   *           distance:number, x:number, z:number}|null}
   */
  nearestWithin(x, z, radius) {
    if (!(radius > 0)) return null;
    const span = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);

    let best = null;
    for (let ix = cx - span; ix <= cx + span; ix++) {
      for (let iz = cz - span; iz <= cz + span; iz++) {
        const bucket = this.buckets.get(cellKey(ix, iz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 2) {
          const index = bucket[i];
          const row = bucket[i + 1];
          const segment = this.segments[index];
          const a = segment.path[row];
          const b = segment.path[row + 1];
          const hit = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
          if (hit.distance > radius) continue;
          if (best && hit.distance >= best.distance) continue;
          best = {
            segment,
            index,
            row,
            t: hit.t,
            distance: hit.distance,
            x: a.x + (b.x - a.x) * hit.t,
            z: a.z + (b.z - a.z) * hit.t,
          };
        }
      }
    }
    return best;
  }

  /**
   * Vrai si une chaussée pourrait couvrir un point de cette boîte. Test
   * grossier (occupation des cellules, sans distance) : peut rendre vrai à
   * tort, jamais faux à tort. Évite de sonder au mètre (`roadCorridor`) un
   * tronçon entier de rase campagne.
   *
   * @param {number} minX
   * @param {number} minZ
   * @param {number} maxX
   * @param {number} maxZ
   * @returns {boolean}
   */
  mayCover(minX, minZ, maxX, maxZ) {
    const cx0 = Math.floor(minX / this.cell);
    const cx1 = Math.floor(maxX / this.cell);
    const cz0 = Math.floor(minZ / this.cell);
    const cz1 = Math.floor(maxZ / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        if (this.buckets.has(cellKey(cx, cz))) return true;
      }
    }
    return false;
  }

  /**
   * Altitude de plate-forme au point touché par `query`.
   *
   * Elle n'est jamais celle d'un ouvrage : l'index ne les inscrit pas (voir
   * l'en-tête de la classe). C'est ce qui empêche le terrain de se creuser
   * jusqu'à la dalle d'un tunnel, une voie de se recoudre sur le tablier qui
   * l'enjambe, et un feu tricolore de se poser à l'altitude du viaduc qui
   * survole son carrefour.
   */
  deckAt(hit) {
    if (!hit) return null;
    const { segment, row, t } = hit;
    const platform = segment.platform;
    if (!platform) return null;
    const a = platform[row];
    const b = platform[Math.min(platform.length - 1, row + 1)];
    return a + (b - a) * t;
  }
}

/** Sondages par côté du rectangle mesuré par `knownCoverage` (une grille 8 × 8). */
export const KNOWN_SAMPLES = 8;

/**
 * Part d'un rectangle qui tombe dans le disque où un réseau a été construit —
 * ce qu'il **sait**, à distinguer de ce qu'il **contient**. Hors de ce disque
 * un index ne répond pas « pas de route » : il ne répond rien, et qui sème
 * d'après lui (la végétation) doit pouvoir constater qu'il en sait davantage
 * qu'au moment où il a semé, sans quoi les arbres plantés sur une chaussée
 * ignorée y restent pour toujours.
 *
 * Mesurée par sondage régulier plutôt que par une aire exacte : le rectangle
 * est une tuile, la précision utile est celle d'un « ça a bougé ».
 *
 * Fonction pure.
 *
 * @param {number} minX Mètres locaux.
 * @param {number} minZ
 * @param {number} maxX
 * @param {number} maxZ
 * @param {{x:number,z:number}|null} anchor Centre du disque construit.
 * @param {number} radius Rayon de construction, en mètres.
 * @param {number} [samples] Sondages par côté.
 * @returns {number} de 0 (rien) à 1 (tout le rectangle).
 */
export function knownCoverage(minX, minZ, maxX, maxZ, anchor, radius, samples = KNOWN_SAMPLES) {
  if (!anchor || !(radius > 0) || !(maxX > minX) || !(maxZ > minZ)) return 0;
  const stepX = (maxX - minX) / samples;
  const stepZ = (maxZ - minZ) / samples;
  const reach = radius * radius;
  let inside = 0;
  for (let j = 0; j < samples; j++) {
    const z = minZ + (j + 0.5) * stepZ;
    for (let i = 0; i < samples; i++) {
      const x = minX + (i + 0.5) * stepX;
      const dx = x - anchor.x;
      const dz = z - anchor.z;
      if (dx * dx + dz * dz <= reach) inside++;
    }
  }
  return inside / (samples * samples);
}

/**
 * Plusieurs index d'emprise combinés, comme s'ils n'en faisaient qu'un.
 * Route et voie ferrée sont deux réseaux distincts, mais l'herbe, les
 * cultures, les jardins et le mobilier n'ont qu'une question à poser : « suis-je
 * dans une emprise, laquelle qu'elle soit ? ». `CombinedIndex` répond au même
 * contrat (`covers`, `query`, `mayCover`) que `RoadIndex`.
 */
export class CombinedIndex {
  /** @param {Array<Object|null|undefined>} indexes */
  constructor(indexes) {
    this.indexes = (indexes || []).filter(Boolean);
  }

  /** Vrai si le point tombe dans l'une des emprises, marge comprise. */
  covers(x, z, margin = 0) {
    return this.indexes.some((index) => index.covers(x, z, margin));
  }

  /** Emprise la plus proche recouvrant le point, toutes confondues. */
  query(x, z, margin = 0, accept = null) {
    let best = null;
    for (const index of this.indexes) {
      const hit = index.query(x, z, margin, accept);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** Emprise la plus proche à distance, toutes confondues. */
  nearestWithin(x, z, radius) {
    let best = null;
    for (const index of this.indexes) {
      const hit = index.nearestWithin?.(x, z, radius);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** Vrai si l'une des emprises pourrait couvrir un point de cette boîte. */
  mayCover(minX, minZ, maxX, maxZ) {
    return this.indexes.some((index) =>
      typeof index.mayCover === 'function' ? index.mayCover(minX, minZ, maxX, maxZ) : true
    );
  }
}

/**
 * Écart d'altitude au-delà duquel deux plate-formes ne se rejoignent pas.
 *
 * Ce n'est **plus** ce qui distingue un carrefour d'un passage supérieur — le
 * niveau de croisement s'en charge, en amont et sans deviner (`roadWorks`,
 * `NodeIndex`). Ce qui reste est le garde-fou qu'il aurait toujours dû être :
 * au-delà de deux mètres et demi, un raccord en trois lignes ferait une marche,
 * quelle que soit la raison de l'écart.
 */
export const STITCH_MAX_STEP_M = 2.5;
/** Longueur du raccordement en altitude, en lignes de ré-échantillonnage. */
export const STITCH_RAMP_ROWS = 3;

/**
 * Vrai si `a` l'emporte sur `b` à un carrefour : la plus large gagne. À
 * largeur égale, il faut trancher de la même façon à chaque reconstruction —
 * l'ordre des tronçons ne le permet pas (change avec le découpage), le nœud
 * d'ancrage si.
 */
function dominates(a, indexA, b, indexB) {
  if (a.halfWidth > b.halfWidth + 1e-6) return true;
  if (b.halfWidth > a.halfWidth + 1e-6) return false;

  const anchorA = a.anchor;
  const anchorB = b.anchor;
  if (anchorA && anchorB && (anchorA.x !== anchorB.x || anchorA.z !== anchorB.z)) {
    return anchorA.x !== anchorB.x ? anchorA.x < anchorB.x : anchorA.z < anchorB.z;
  }
  return indexA < indexB;
}

/**
 * Recoud les plate-formes entre elles aux carrefours. Chaque chaussée dresse
 * sa plate-forme pour son compte, donc deux voies qui se croisent
 * n'aboutissent pas à la même altitude sans ce raccord. La plus large
 * commande : une départementale épouse le profil de la nationale sur ses
 * derniers mètres, en rampe sur quelques lignes. Au-delà de
 * `STITCH_MAX_STEP_M`, ce n'est pas un carrefour mais un pont ou un souterrain.
 *
 * Une ligne d'ouvrage ne se recoud jamais, dans aucun des deux sens : ni la
 * bretelle d'échangeur sur l'autoroute qu'elle survole (elle redescendrait s'y
 * coller), ni l'inverse. C'est `deckAt` qui refuse de servir l'altitude d'un
 * ouvrage ; ici on refuse d'y toucher.
 *
 * Deux chaussées de **niveaux différents** ne se recousent pas davantage,
 * ouvrage ou pas : un passage supérieur sans `bridge` reste un croisement en
 * XY, pas une rencontre.
 *
 * @param {Array<Object>} segments Tronçons, dont les `platform` sont modifiées.
 * @param {RoadIndex} index        Index bâti sur ces mêmes tronçons.
 * @param {Object} [options]
 * @returns {number} nombre de tronçons retouchés.
 */
export function stitchPlatforms(segments, index, { maxStep = STITCH_MAX_STEP_M, rampRows = STITCH_RAMP_ROWS } = {}) {
  if (!Array.isArray(segments) || segments.length === 0 || !index) return 0;

  // De la plus large à la plus étroite : une voie déjà recousue sert de
  // référence à celle qui la rejoint, et jamais l'inverse.
  const order = segments.map((_, i) => i).sort((a, b) => {
    const wa = segments[a].halfWidth;
    const wb = segments[b].halfWidth;
    return wa === wb ? a - b : wb - wa;
  });

  let touched = 0;

  for (const si of order) {
    const segment = segments[si];
    const path = segment?.path;
    const platform = segment?.platform;
    if (!Array.isArray(path) || !platform || path.length < 2) continue;

    const rows = path.length;
    const delta = new Float32Array(rows);
    const anchored = new Uint8Array(rows);
    let count = 0;

    const works = segment.works;

    const levels = segment.levels;

    for (let r = 0; r < rows; r++) {
      if (works?.[r]) continue;
      const hit = index.query(path[r].x, path[r].z, 0, (other, oi) =>
        oi !== si && dominates(other, oi, segment, si)
      );
      if (!hit) continue;
      // Deux chaussées superposées ne se rejoignent pas : le croisement est en
      // XY seulement. `maxStep` reste ce qu'il aurait toujours dû être — un
      // garde-fou d'altitude —, et non le seul juge de la question.
      const mine = levels?.[r] ?? LEVEL_GROUND;
      const theirs = hit.segment.levels?.[hit.row] ?? LEVEL_GROUND;
      if (mine !== theirs) continue;
      const deck = index.deckAt(hit);
      if (deck == null) continue;
      const step = deck - platform[r];
      if (!Number.isFinite(step) || Math.abs(step) > maxStep) continue;
      delta[r] = step;
      anchored[r] = 1;
      count++;
    }

    if (!count) continue;

    // Distance à la ligne recousue la plus proche, dans les deux sens : c'est
    // elle qui étale le raccord au lieu de le concentrer sur une ligne.
    const nearest = new Int32Array(rows).fill(-1);
    const distance = new Int32Array(rows).fill(rows);
    for (let r = 0; r < rows; r++) {
      if (anchored[r]) {
        nearest[r] = r;
        distance[r] = 0;
      } else if (r > 0 && nearest[r - 1] >= 0) {
        nearest[r] = nearest[r - 1];
        distance[r] = distance[r - 1] + 1;
      }
    }
    for (let r = rows - 2; r >= 0; r--) {
      if (nearest[r + 1] >= 0 && distance[r + 1] + 1 < distance[r]) {
        nearest[r] = nearest[r + 1];
        distance[r] = distance[r + 1] + 1;
      }
    }

    for (let r = 0; r < rows; r++) {
      if (works?.[r]) continue;
      if (nearest[r] < 0 || distance[r] > rampRows) continue;
      const fade = 1 - distance[r] / (rampRows + 1);
      platform[r] += delta[nearest[r]] * fade;
    }
    touched++;
  }

  return touched;
}
