/*
 * roadGraph — recoudre les chaussées entre elles avant de les dessiner.
 * ---------------------------------------------------------------------
 * Une tuile vectorielle ne livre pas des routes : elle livre des **morceaux**.
 * Le format découpe chaque entité à la frontière de la tuile, avec une marge de
 * recouvrement de quelques mètres ; OpenStreetMap découpe en plus les chemins à
 * chaque changement d'attribut ; et une même route revient donc trois ou quatre
 * fois, coupée à des endroits qui n'ont aucune réalité au sol.
 *
 * Dessiner ces morceaux tels quels se voit, et de six façons différentes :
 *
 * 1. deux rubans coplanaires **superposés** dans la bande de recouvrement, qui
 *    se disputent le pixel ;
 * 2. un **décroché d'altitude** à chaque couture — chaque morceau dresse sa
 *    plate-forme et la lisse pour son compte, et les deux bouts ne tombent pas
 *    à la même hauteur ;
 * 3. le **marquage** qui repart de zéro, donc des pointillés à contretemps ;
 * 4. le mobilier espacé qui **redémarre** sa numérotation, donc deux lampadaires
 *    à trois mètres l'un de l'autre ;
 * 5. la haie ou la ligne téléphonique qui **change de côté** d'un morceau à
 *    l'autre, puisque le côté se tire au sort une fois par morceau ;
 * 6. une glissière **interrompue** au milieu d'un versant raide, parce que le
 *    tronçon suivant était trop court pour en mériter une.
 *
 * D'où ce module, entièrement pur : il reconstitue le graphe routier — nœuds
 * soudés, arêtes dédoublonnées — puis en extrait les plus longues chaînes
 * continues possibles, celle qui va tout droit gardant la priorité à un
 * carrefour. Les chaussées sont ensuite recousues **en altitude** les unes aux
 * autres : une voie qui débouche sur une plus large vient épouser la hauteur de
 * celle-ci sur ses derniers mètres, au lieu de l'aborder en marche d'escalier.
 *
 * ## Le point d'ancrage, et pourquoi il n'est pas le début de la chaîne
 *
 * Tout ce qui s'espace le long d'une route — bornes, lampadaires, poteaux — se
 * compte depuis une origine. Prendre le début de la chaîne serait le choix
 * naturel et le mauvais : une chaîne s'arrête là où s'arrêtent les tuiles
 * chargées, à deux kilomètres de là, et ce bout-là bouge à chaque fois que le
 * jeu de tuiles change. Toutes les bornes glisseraient alors d'un coup.
 *
 * L'origine est donc prise au dernier **nœud d'ancrage** rencontré : un
 * carrefour, un cul-de-sac, un changement de classe. Ces nœuds-là existent dans
 * la donnée, ils ne dépendent ni du découpage en tuiles ni de la position 
 * de l'observateur, et la distance qui les sépare d'un point donné ne change jamais.
 */

/** Distance en deçà de laquelle deux sommets sont le même nœud, en mètres. */
export const NODE_WELD_M = 1.2;
/**
 * Distance maximale d'un raccord entre deux bouts libres, en mètres.
 *
 * Elle couvre la marge de recouvrement des tuiles : le format laisse déborder
 * les lignes de quelques mètres de part et d'autre de la frontière, si bien que
 * les deux moitiés d'une route ne se touchent pas — elles se chevauchent, bout
 * contre bout, sans partager le moindre sommet.
 */
export const LOOSE_JOIN_M = 8;
/** Écart latéral toléré sur un raccord lâche, en mètres. */
export const LOOSE_OFFSET_M = 2.5;
/** Cosinus de l'angle de virage au-delà duquel on ne prolonge plus une chaîne. */
export const CONTINUE_COS = Math.cos((72 * Math.PI) / 180);
/** Cosinus de l'angle toléré entre deux bouts libres qu'on recoud. */
export const COLLINEAR_COS = Math.cos((40 * Math.PI) / 180);

/** Décalage de cellule : les coordonnées locales sont signées. */
const CELL_BIAS = 1 << 14;

/** Clé numérique d'une cellule de grille. Fonction pure. */
export function cellKey(cx, cz) {
  return (cx + CELL_BIAS) * 32768 + (cz + CELL_BIAS);
}

/**
 * Index de nœuds soudés : deux sommets distants de moins que la tolérance sont
 * le même nœud, et le premier arrivé impose sa position.
 *
 * Une simple quantification ne suffirait pas — deux sommets à dix centimètres
 * l'un de l'autre peuvent tomber de part et d'autre d'une frontière de grille.
 * On regarde donc les neuf cellules voisines et on compare des distances.
 */
class NodeIndex {
  constructor(tolerance = NODE_WELD_M) {
    this.tolerance = tolerance;
    this.cell = Math.max(tolerance, 0.01);
    this.cells = new Map();
    this.xs = [];
    this.zs = [];
  }

  get size() {
    return this.xs.length;
  }

  /** Identifiant du nœud à cette position, créé au besoin. */
  idFor(x, z) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bestDistance = this.tolerance * this.tolerance;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.cells.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const id of bucket) {
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

/** Ajoute une arête au graphe, en écartant les doublons entre tuiles. */
function addEdge(state, a, b, profile, halfWidth) {
  if (a === b) return;
  const rank = profileRank(state, profile);
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  // Un nœud tient sur 21 bits pour un million de sommets, donc la clé reste un
  // entier exact bien en deçà de 2^53.
  const key = (low * 2097152 + high) * 16 + rank;
  if (state.seen.has(key)) return;
  state.seen.add(key);

  const index = state.edges.length;
  state.edges.push({ a, b, profile, rank, halfWidth });
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
 */
function appendChain(out, anchorsOut, points, anchors) {
  if (out.length === 0) {
    out.push(...points);
    anchorsOut.push(...anchors);
    return;
  }

  const head = out[out.length - 1];
  const heading = direction(out[out.length - 2].x, out[out.length - 2].z, head.x, head.z);
  let start = 0;
  if (heading) {
    while (
      start < points.length - 2 &&
      (points[start].x - head.x) * heading.x + (points[start].z - head.z) * heading.z <= 0.25
    ) {
      start++;
    }
  }

  for (let i = start; i < points.length; i++) {
    out.push(points[i]);
    anchorsOut.push(anchors[i]);
  }
}

/** Suit les appariements de bouts libres et concatène ce qui va ensemble. */
function assembleChains(chains, partner) {
  const visited = new Uint8Array(chains.length);
  const merged = [];

  const walk = (startEnd) => {
    const points = [];
    const anchors = [];
    let end = startEnd;

    for (;;) {
      const c = end >> 1;
      const at = end & 1;
      if (visited[c]) break;
      visited[c] = 1;
      const chain = chains[c];
      // Entrer par le bout `at` revient à parcourir la chaîne dans ce sens-là.
      const ordered = at === 0 ? chain.points : chain.points.slice().reverse();
      const orderedAnchors = at === 0 ? chain.anchors : chain.anchors.slice().reverse();
      appendChain(points, anchors, ordered, orderedAnchors);

      const exit = c * 2 + (1 - at);
      const next = partner[exit];
      if (next < 0) break;
      end = next;
    }

    if (points.length >= 2) {
      merged.push({ profile: chains[startEnd >> 1].profile, halfWidth: chains[startEnd >> 1].halfWidth, points, anchors });
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
 * Fusionne des polylignes de chaussée en chaînes continues.
 *
 * @param {Array<{profile:string, halfWidth:number, points:Array<{x:number,z:number}>}>} lines
 *        Polylignes métriques, telles qu'elles sortent des tuiles.
 * @param {Object} [options]
 * @returns {Array<{profile:string, halfWidth:number, points:Array, anchors:Array<boolean>}>}
 *          Chaînes fusionnées. `anchors[i]` marque les sommets qui peuvent
 *          servir d'origine stable : carrefours, culs-de-sac, extrémités.
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
    seen: new Set(),
    adjacency: new Map(),
    degree: new Map(),
    ranks: new Map(),
  };

  for (const line of lines || []) {
    const points = line?.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    let previous = nodes.idFor(points[0].x, points[0].z);
    for (let i = 1; i < points.length; i++) {
      const id = nodes.idFor(points[i].x, points[i].z);
      addEdge(state, previous, id, line.profile, line.halfWidth);
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
    chains.push({
      profile: edge.profile,
      halfWidth: edge.halfWidth,
      points: ids.map((id) => ({ x: nodes.xs[id], z: nodes.zs[id] })),
      // Un nœud de degré deux est un simple sommet de la ligne ; tout le reste
      // — embranchement, croisement, cul-de-sac, changement de classe — est un
      // point d'ancrage, et ne bouge pas d'une reconstruction à l'autre.
      anchors: ids.map((id, i) => i === 0 || i === last || (degree.get(id) || 0) !== 2),
    });
  }

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
    }
  }

  return joined;
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
 * Index spatial des chaussées construites.
 *
 * Deux usages, une seule structure : savoir si un point tombe sur une chaussée
 * — c'est ce qui empêche l'herbe de pousser sur le bitume —, et retrouver
 * l'altitude de la chaussée qui passe là — c'est ce qui permet de recoudre une
 * voie sur une autre.
 *
 * Chaque arête est inscrite dans toutes les cellules que couvre sa boîte
 * élargie de sa demi-largeur **et** de la marge de requête. Une interrogation
 * n'a donc qu'une seule cellule à lire.
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

      for (let r = 0; r < path.length - 1; r++) {
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
   * Vrai si une chaussée **pourrait** couvrir un point de cette boîte.
   *
   * C'est un test grossier, et volontairement : il ne lit que l'occupation des
   * cellules, sans calculer la moindre distance. Une réponse fausse est
   * possible dans un sens seulement — il peut rendre vrai là où rien ne
   * couvre —, jamais dans l'autre : si toutes les cellules survolées sont
   * vides, aucun point de la boîte n'est sur une chaussée, puisque `query` ne
   * consulte jamais que la cellule du point demandé.
   *
   * Il existe pour une raison de coût. Découper une polyligne demande de la
   * sonder au mètre (`roadCorridor`), et en rase campagne l'immense majorité
   * de ces sondages porte sur du vide. Écarter d'un coup un tronçon entier
   * évite de les payer un par un.
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

  /** Altitude de plate-forme au point touché par `query`. */
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

/**
 * Écart d'altitude au-delà duquel deux chaussées qui se croisent ne se
 * rejoignent pas : c'est un pont ou un passage inférieur, pas un carrefour.
 */
export const STITCH_MAX_STEP_M = 2.5;
/** Longueur du raccordement en altitude, en lignes de ré-échantillonnage. */
export const STITCH_RAMP_ROWS = 3;

/**
 * Vrai si `a` l'emporte sur `b` à un carrefour : la plus large gagne.
 *
 * À largeur égale — deux départementales qui se croisent — il faut quand même
 * trancher, et trancher **de la même façon à chaque reconstruction**. L'ordre
 * des tronçons ne le permet pas : il change dès que le découpage change, et la
 * voie qui s'incline serait l'une puis l'autre, à un mètre près, tous les
 * 250 mètres. Le nœud d'ancrage, lui, ne bouge pas.
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
 * Recoud les plate-formes entre elles aux carrefours.
 *
 * Chaque chaussée dresse sa plate-forme pour son compte, en retenant le point
 * haut de sa section. Deux voies qui se croisent n'aboutissent donc pas à la
 * même altitude au point de croisement — l'écart atteint la trentaine de
 * centimètres sur un versant, et la voie secondaire aborde la principale par
 * une marche.
 *
 * La règle est celle du terrain : **c'est la plus large qui commande**. Une
 * départementale qui débouche sur une nationale vient épouser le profil de la
 * nationale sur ses derniers mètres, jamais l'inverse. Le raccord se fait en
 * rampe sur quelques lignes, sinon on remplacerait la marche par un ressaut.
 *
 * Au-delà de `STITCH_MAX_STEP_M`, le croisement n'en est pas un : c'est un pont
 * ou un souterrain, et les deux chaussées se laissent tranquilles.
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

    for (let r = 0; r < rows; r++) {
      const hit = index.query(path[r].x, path[r].z, 0, (other, oi) =>
        oi !== si && dominates(other, oi, segment, si)
      );
      if (!hit) continue;
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
      if (nearest[r] < 0 || distance[r] > rampRows) continue;
      const fade = 1 - distance[r] / (rampRows + 1);
      platform[r] += delta[nearest[r]] * fade;
    }
    touched++;
  }

  return touched;
}
