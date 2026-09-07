/*
 * roadWorks — les ouvrages d'art de la chaussée : ponts et tunnels.
 *
 * Une tuile vectorielle dit `brunnel` sur chaque tronçon `transportation`.
 * Jusqu'ici la chaussée n'en tirait qu'une chose : jeter les tunnels. Un pont
 * était donc une route ordinaire, dressée sur le MNT brut — c'est-à-dire
 * posée au fond de la vallée qu'elle est censée franchir, et sous la nappe
 * qu'elle est censée enjamber.
 *
 * Ce module est le seul endroit où l'on sait ce qu'est un ouvrage :
 *
 *   - `workCodeFor` traduit `brunnel` en code entier (les drapeaux voyagent
 *     dans des tableaux typés, pas des chaînes) ;
 *   - `resampleWorks` reporte les drapeaux du tracé brut sur le tracé
 *     ré-échantillonné ;
 *   - `levelWorkSpans` remplace la plate-forme d'une travée par une corde
 *     tendue entre ses deux appuis, relevée si elle ne dégage pas ce qu'elle
 *     franchit ;
 *   - `workRuns` découpe un tronçon en plages homogènes, pour tout le reste
 *     (le ruban qui saute un tunnel, le tablier qui suit un pont).
 *
 * Deux conventions dont dépend l'exactitude du découpage, décidées ici et
 * appliquées par `roadGraph` :
 *
 *   - un **sommet** porte le maximum des arêtes qui s'y rejoignent (une
 *     extrémité de pont est marquée pont) ;
 *   - un **intervalle** porte le minimum de ses deux sommets.
 *
 * Le couple rend exactement les arêtes d'origine, sans déborder d'un segment
 * sur la route d'approche — ce que ferait un simple maximum, en posant un
 * tablier sur cinquante mètres de remblai.
 *
 * ## Ce qu'une travée dégage, et ce qu'elle ne dégage pas
 *
 * Une travée est portée par ses appuis : son altitude est celle de la corde,
 * pas une hauteur au-dessus du sol. Le terrain qu'elle survole ne lui commande
 * donc **rien** — un pont qui traverse un pré reste au niveau du pré. Ce qui
 * la relève, ce sont les deux seules choses qui ne se contournent pas :
 *
 *   - un **obstacle à gabarit** (`clearanceAt`) : une chaussée croisée, sous
 *     laquelle il faut laisser passer un camion. `clearance` mètres au-dessus ;
 *   - un **plancher** (`floorAt`) : l'altitude sous laquelle la plate-forme
 *     n'a pas le droit de descendre — le terrain naturel (un tablier enterré
 *     n'est pas un tablier) et la nappe augmentée de sa revanche. Aucune garde
 *     au-dessus : on s'y pose, on ne le survole pas.
 *
 * Confondre les deux — relever de cinq mètres au-dessus de tout ce qui passe
 * sous la travée, terrain compris — jetait chaque pont de rase campagne en
 * l'air, sur des culées de la hauteur d'une maison.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

/** Chaussée ordinaire, posée sur le terrain. */
export const WORK_NONE = 0;
/** Pont : la plate-forme est portée, le terrain ne la commande plus. */
export const WORK_BRIDGE = 1;
/** Tunnel : rien en surface, mais la chaîne continue sous la colline. */
export const WORK_TUNNEL = 2;

/**
 * Garde libre exigée au-dessus d'un **obstacle à gabarit** — une chaussée
 * croisée —, en mètres, mesurée sous la **plate-forme** : épaisseur du tablier
 * comprise, donc plus généreuse que le gabarit routier seul. Cote d'ingénieur,
 * pas de goût : elle reste dans le moteur.
 *
 * Elle ne s'applique **pas** au terrain nu : un pont ne survole pas un pré de
 * cinq mètres, il le franchit à l'altitude de ses appuis (voir l'en-tête).
 */
export const BRIDGE_CLEARANCE_M = 5.5;

/**
 * Revanche au-dessus d'une nappe d'eau, en mètres, mesurée comme la garde :
 * sous la plate-forme. Le tablier pend en dessous (de soixante-dix centimètres
 * à un mètre trente selon la famille) : il reste donc à peu près un mètre d'air
 * entre l'eau et la sous-face, ce qu'a n'importe quel pont de campagne.
 *
 * Ce n'est pas un gabarit — rien ne passe sous un pont de rivière — mais une
 * revanche de crue : une travée posée sur l'eau à l'étiage y trempe à la
 * première pluie.
 */
export const BRIDGE_FREEBOARD_M = 2;

/**
 * Cosinus au-delà duquel deux chaussées superposées ne se croisent pas : elles
 * se suivent. Sert à distinguer le viaduc qui enjambe une nationale (à relever
 * du gabarit) de la travée qui prolonge sa propre route d'approche (à laisser
 * là où ses appuis la mettent). Trente degrés : une bretelle d'échangeur croise
 * plus franchement que ça.
 */
export const BRIDGE_CROSSING_COS = 0.87;

/**
 * Portée au-delà de laquelle on renonce à tendre une corde et on laisse la
 * chaussée suivre le terrain. Un `brunnel` mal posé sur des kilomètres (ça
 * existe) lancerait sinon un viaduc à travers toute la bulle.
 */
export const BRIDGE_MAX_SPAN_M = 420;

/** Longueur du remblai d'accès qui rattrape le relevage d'une travée, en mètres. */
export const BRIDGE_RAMP_M = 30;

/** Code d'ouvrage d'une entité vectorielle. Fonction pure. */
export function workCodeFor(brunnel) {
  if (brunnel === 'bridge') return WORK_BRIDGE;
  if (brunnel === 'tunnel') return WORK_TUNNEL;
  return WORK_NONE;
}

/**
 * Plages de lignes contiguës portant le même code. Une plage vaut `[from, to]`
 * inclus.
 *
 * @param {Uint8Array|number[]|null} works Un code par ligne.
 * @param {number} code Code recherché.
 * @returns {Array<{from:number, to:number}>}
 */
export function workRuns(works, code) {
  const runs = [];
  if (!works) return runs;
  let from = -1;

  for (let r = 0; r < works.length; r++) {
    const match = works[r] === code;
    if (match && from < 0) from = r;
    else if (!match && from >= 0) {
      runs.push({ from, to: r - 1 });
      from = -1;
    }
  }
  if (from >= 0) runs.push({ from, to: works.length - 1 });
  return runs;
}

/**
 * Plages de lignes que le ruban de chaussée doit dessiner : tout sauf les
 * tunnels. Un pont en fait partie — c'est la même chaussée, simplement portée.
 *
 * Le ruban avance d'une ligne **dans** le tunnel de chaque côté : sans ça il
 * s'arrête un pas d'échantillonnage avant la tête, et la chaussée disparaît
 * cinq mètres devant la bouche. On n'avance pas dans un tunnel d'une seule
 * ligne, où les deux morceaux se disputeraient la même bande.
 *
 * @param {Uint8Array|number[]|null} works
 * @param {number} rows Nombre de lignes du tronçon.
 * @returns {Array<{from:number, to:number}>}
 */
export function drawableRuns(works, rows) {
  if (!works) return rows >= 2 ? [{ from: 0, to: rows - 1 }] : [];

  const runs = [];
  let from = -1;
  for (let r = 0; r < rows; r++) {
    const solid = works[r] !== WORK_TUNNEL;
    if (solid && from < 0) from = r;
    else if (!solid && from >= 0) {
      runs.push({ from, to: r - 1 });
      from = -1;
    }
  }
  if (from >= 0) runs.push({ from, to: rows - 1 });

  /** Vrai si la ligne est un tunnel, et pas la dernière de ce tunnel-là. */
  const deepEnough = (r, step) =>
    works[r] === WORK_TUNNEL && works[r + step] === WORK_TUNNEL;

  for (const run of runs) {
    if (run.from > 1 && deepEnough(run.from - 1, -1)) run.from--;
    if (run.to < rows - 2 && deepEnough(run.to + 1, 1)) run.to++;
  }

  return runs.filter((run) => run.to > run.from);
}

/**
 * Reporte les drapeaux d'ouvrage d'une polyligne brute sur son tracé
 * ré-échantillonné. Chaque ligne reçoit le code de l'**intervalle** qui la
 * contient, c'est-à-dire le minimum de ses deux sommets (voir l'en-tête).
 *
 * @param {Array<{x:number,z:number}>} points Polyligne d'origine.
 * @param {Uint8Array|number[]|null} works Un code par sommet de `points`.
 * @param {Array<{distance:number}>} path Tracé ré-échantillonné, distances
 *        comptées depuis `points[0]` (c'est le contrat de `resamplePath`).
 * @returns {Uint8Array} un code par ligne de `path`.
 */
export function resampleWorks(points, works, path) {
  const rows = path?.length ?? 0;
  const out = new Uint8Array(rows);
  if (!works || !points || points.length < 2 || rows === 0) return out;

  // Abscisse curviligne des sommets d'origine, dans le même repère que `path`.
  const marks = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    marks[i] = marks[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }

  /** Code de l'intervalle `[i, i+1]` : le minimum de ses deux sommets. */
  const between = (i) => {
    const a = works[i] || 0;
    const b = works[i + 1] || 0;
    return a < b ? a : b;
  };

  let i = 0;
  for (let r = 0; r < rows; r++) {
    const d = path[r].distance;
    while (i < points.length - 2 && marks[i + 1] < d) i++;
    let code = between(i);
    // Une ligne tombée pile sur un sommet appartient aux deux intervalles : on
    // retient le plus fort, sinon la travée perdrait sa ligne de culée — celle
    // par laquelle le tablier rejoint le sol.
    if (d === marks[i + 1] && i + 1 <= points.length - 2) {
      const next = between(i + 1);
      if (next > code) code = next;
    }
    out[r] = code;
  }
  return out;
}

/**
 * Remplace la plate-forme des travées par une corde tendue entre leurs appuis.
 *
 * Une travée n'est plus commandée par le terrain : ses deux extrémités le
 * sont — la dernière ligne posée au sol de chaque côté — et tout ce qu'il y a
 * entre les deux s'interpole. Ces appuis sont lus **après** l'aplanissement du
 * profil en long (`ribbonGeometry.flattenGrade`), jamais avant : ce que le
 * tablier rejoint est la route telle qu'elle sera, terrassement compris, et
 * non le terrain brut que le terrassier vient de quitter. Si la corde ne dégage pas le gabarit au-dessus
 * de ce qu'elle franchit, on relève **toute** la travée d'un bloc (un tablier
 * reste droit ; il n'ondule pas pour éviter un rocher) et on rattrape la
 * différence par un remblai d'accès sur `ramp` mètres de part et d'autre —
 * remblai que `furnitureLayer` habillera de lui-même, puisque la plate-forme
 * y surplombe désormais le terrain.
 *
 * Un tunnel s'interpole comme un pont, mais sans gabarit : la corde traverse
 * la colline, ce qui est exactement ce qu'on lui demande. Elle ne sert pas au
 * ruban (qui saute ces lignes) mais aux têtes, qui doivent savoir où sortir.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {Float32Array} platform Altitudes de plate-forme, modifiées sur place.
 * @param {Uint8Array|number[]|null} works Un code par ligne.
 * @param {Object} [options]
 * @param {Function} [options.clearanceAt] `(x, z, r) => altitude d'un obstacle
 *        à gabarit`, dans les mêmes unités que `platform` — une chaussée
 *        croisée. Rend une valeur non finie là où il n'y a rien à dégager, ce
 *        qui est le cas courant : au-dessus d'un pré, d'un ravin ou d'un
 *        village, une travée n'a rien à passer.
 * @param {Function} [options.floorAt] `(x, z, r) => altitude plancher` : le
 *        terrain naturel, ou la nappe augmentée de sa revanche. La plate-forme
 *        s'y pose sans garde ; elle ne descend simplement pas dessous.
 * @param {number} [options.clearance] Garde au-dessus d'un obstacle à gabarit.
 * @param {number} [options.maxSpan]
 * @param {number} [options.ramp]
 * @returns {number} nombre de travées reprises.
 */
export function levelWorkSpans(
  path,
  platform,
  works,
  {
    clearanceAt = null,
    floorAt = null,
    clearance = BRIDGE_CLEARANCE_M,
    maxSpan = BRIDGE_MAX_SPAN_M,
    ramp = BRIDGE_RAMP_M,
  } = {}
) {
  const rows = path?.length ?? 0;
  if (!works || !platform || rows < 2) return 0;

  let levelled = 0;

  for (const code of [WORK_BRIDGE, WORK_TUNNEL]) {
    for (const run of workRuns(works, code)) {
      // Appuis : la dernière ligne au sol de chaque côté. Une travée qui sort
      // de la portée n'en a qu'un — elle reste alors de niveau plutôt que de
      // pencher vers un appui inventé.
      const low = Math.max(0, run.from - 1);
      const high = Math.min(rows - 1, run.to + 1);
      const before = run.from > 0 ? platform[low] : null;
      const after = run.to < rows - 1 ? platform[high] : null;
      if (before == null && after == null) continue;

      const span = path[high].distance - path[low].distance;
      if (!(span > 0) || span > maxSpan) continue;

      const a = before ?? after;
      const b = after ?? before;
      for (let r = run.from; r <= run.to; r++) {
        const t = (path[r].distance - path[low].distance) / span;
        platform[r] = a + (b - a) * t;
      }
      levelled++;

      if (code !== WORK_BRIDGE || (!clearanceAt && !floorAt)) continue;

      // Relevage d'un bloc : le plus exigeant des deux, sur toute la travée.
      let lift = 0;
      for (let r = run.from; r <= run.to; r++) {
        if (clearanceAt) {
          const gauge = clearanceAt(path[r].x, path[r].z, r);
          if (Number.isFinite(gauge)) lift = Math.max(lift, gauge + clearance - platform[r]);
        }
        if (floorAt) {
          const floor = floorAt(path[r].x, path[r].z, r);
          if (Number.isFinite(floor)) lift = Math.max(lift, floor - platform[r]);
        }
      }
      if (!(lift > 0)) continue;

      for (let r = run.from; r <= run.to; r++) platform[r] += lift;
      // Le remblai d'accès : la route retrouve son terrain sur `ramp` mètres,
      // en `smoothstep` (une rampe droite laisse une cassure à ses deux bouts).
      // Il s'arrête net sur la travée suivante : deux ponts qui se suivent de
      // près, le remblai de l'un ferait pencher le tablier de l'autre.
      for (const [start, step] of [[run.from - 1, -1], [run.to + 1, 1]]) {
        for (let r = start; r >= 0 && r < rows; r += step) {
          if (works[r]) break;
          const d = Math.abs(path[r].distance - path[start - step].distance);
          if (d >= ramp) break;
          const f = 1 - d / ramp;
          platform[r] += lift * f * f * (3 - 2 * f);
        }
      }
    }
  }

  return levelled;
}
