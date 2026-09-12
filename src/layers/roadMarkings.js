/*
 * roadMarkings — le marquage est de la géométrie, et il s'arrête là où la
 * chaussée s'arrête.
 *
 * ## Ce qui se passait avant
 *
 * Les lignes étaient **peintes dans la texture du ruban** : une bande blanche
 * à une abscisse fixe en travers du dessin, répétée le long. C'était commode
 * et c'était faux, pour trois raisons qu'aucun réglage ne rattrape :
 *
 *   - une surface de carrefour n'a ni milieu ni bords, donc elle ne peut pas
 *     porter cette texture. Le lot précédent lui a donc donné une matière sans
 *     aucune ligne — et un carrefour se retrouvait sans le moindre marquage,
 *     axe comme rive, alors que c'est précisément l'endroit où le marquage
 *     dit quelque chose ;
 *   - une ligne peinte ne sait pas s'arrêter. L'axe continuait jusqu'à la
 *     bouche et repartait de l'autre côté, y compris là où il n'y a plus de
 *     ligne à tracer ;
 *   - rien **en travers** n'était représentable : une ligne d'effet, un
 *     passage piétons ne sont pas des motifs qui se répètent le long de la
 *     route, ce sont des objets posés à un endroit.
 *
 * ## Ce que fait ce module
 *
 * Il pose le marquage en triangles, dans les **mêmes morceaux** que le ruban
 * (`roadWorks.drawableRuns` puis `roadJunctions.junctionRibbonRuns`). Il n'y a
 * donc aucune règle de découpe ici : le marquage est découpé par les tunnels
 * et par le contour des carrefours parce qu'il est posé sur les mêmes plages,
 * point. C'est la même figure que le ruban et que la bordure — une seule
 * découpe, lue par tout ce qui suit la chaussée.
 *
 * ## La rive traverse le carrefour, l'axe non
 *
 * Un carrefour restait pourtant nu : les rubans s'arrêtent à ses bouches, donc
 * le marquage aussi, et la dalle ne portait rien. Une rive s'y interrompait
 * ainsi tous les cent mètres en ville, ce qu'aucune route ne fait sur le
 * terrain — la ligne de rive d'un carrefour en T fait le tour de ses trois
 * côtés, sans discontinuité.
 *
 * `appendMarkingBorder` la pose, le long des **morceaux de contour** que le
 * carrefour publie déjà (`roadJunctions.junctionArea.edges` — ceux-là mêmes que
 * suit la bordure de trottoir). Ces morceaux commencent et finissent exactement
 * là où les rives de ruban s'arrêtent : un retrait constant les raccorde sans
 * qu'aucun des deux bouts ait à connaître l'autre.
 *
 * L'axe, lui, ne traverse pas : il n'y a pas de sens de marche dans un
 * carrefour, donc pas de milieu à marquer. Rien d'autre n'a été ajouté — pas de
 * ligne d'effet à égalité de largeur, pas de flèche, pas de zébra central.
 *
 * La phase des pointillés est tirée de l'**abscisse curviligne de la chaîne**
 * comptée depuis son ancre de graphe (`segment.startDistance`), et non du rang
 * du trait dans la boucle : deux reconstructions qui découpent la chaîne
 * ailleurs posent les traits aux mêmes endroits. Même invariant que les
 * hachures de comblement (`roadBundles.appendZebra`).
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne décide de rien : ni où un trait va (c'est le profil de la chaussée qui
 * le dit, `markingLinesFor`), ni quelle branche cède le passage (c'est le
 * carrefour qui le dit, `roadJunctions.branchYields`).
 *
 * ## Le pictogramme, et pourquoi il y en a un maintenant
 *
 * Ce module refusait tout pictogramme — flèche de rabattement, symbole
 * cycliste — au motif que la donnée ne porte ni nombre de voies ni affectation
 * de voie : en poser serait les inventer. L'argument tient toujours pour la
 * flèche, et il tombe pour le vélo : sur une entité de classe `cycleway`, ce
 * n'est pas *une voie parmi d'autres* qui est cyclable, c'est la chaussée
 * entière. Le pictogramme ne dit alors rien que la donnée ne dise déjà, et
 * sans lui une piste cyclable ne se distingue d'une allée de service que par
 * vingt centimètres de largeur — c'est-à-dire pas du tout.
 *
 * Un pictogramme est décrit en coordonnées **(le long, en travers)**, en
 * mètres, et posé par `appendMarkingSymbols` : chaque sommet cherche sa
 * section à son abscisse propre, donc le dessin suit la courbe et le devers de
 * la chaussée au lieu d'être une décalcomanie plane. Sa phase se tire de
 * l'abscisse de la chaîne, comme les pointillés : un vélo reste au même
 * endroit du terrain d'une reconstruction à l'autre.
 *
 * Module pur : aucun `three`, testable sous Node.
 */

import { pathFrames } from './ribbonGeometry.js';

/**
 * Largeur d'un trait, en mètres. Cote de marquage routier, reprise telle
 * quelle de la texture qu'elle remplace.
 */
export const MARKING_WIDTH_M = 0.12;

/**
 * Retrait du bord intérieur d'une ligne de rive au-delà de l'accotement, en
 * mètres. Même valeur que dans la texture : la ligne ne change pas de place,
 * elle change de nature.
 */
export const MARKING_EDGE_INSET_M = 0.35;

/** Trait et vide d'un axe discontinu, en mètres (cycle de six mètres). */
export const MARKING_DASH_M = 3;

/**
 * Largeur d'un marquage **en travers**, en mètres : ligne d'effet et bande de
 * passage piétons. Cote réglementaire, la même pour les deux.
 */
export const MARKING_BAR_M = 0.5;

/**
 * Décollement du marquage au-dessus du bitume, en mètres. Nécessité de rendu,
 * pas une épaisseur de peinture : sans lui, deux surfaces coplanaires se
 * disputent la profondeur.
 */
export const MARKING_LIFT_M = 0.012;

/**
 * Profondeur réservée à la bouche d'un carrefour, en mètres.
 *
 * C'est la place d'une traversée piétonne, et c'est pour ça que la constante
 * est ici plutôt que dans l'une des deux couches qui la lisent : la chaussée y
 * pose sa ligne d'effet **au-delà**, la voirie y pose la traversée **en deçà**,
 * et il faut que les deux parlent de la même longueur pour qu'elles ne se
 * marchent pas dessus. C'est aussi la disposition réelle d'un débouché : on
 * cède le passage avant le passage piétons, pas dessus.
 */
export const MOUTH_CROSSING_M = 2.5;

/**
 * Les lignes longitudinales que porte une chaussée, décalage compté depuis
 * l'axe (positif à gauche de la marche, convention de `pathFrames`).
 *
 * Ce que porte une classe de route est une description du pays, donc du thème
 * (`edgeLines`, `centerDash`) : ce module ne fait que la lire. La ligne de
 * rive se pose en deçà de l'accotement, qui n'est pas de la chaussée.
 *
 * @param {Object} spec Profil du thème (`theme.roads.profiles[...]`).
 * @param {number} halfWidth Demi-largeur du ruban, en mètres.
 * @returns {Array<{offset:number, dash:number}>} `dash` nul = trait continu.
 */
export function markingLinesFor(spec, halfWidth) {
  const out = [];
  if (!spec || !(halfWidth > 0)) return out;

  if (spec.edgeLines) {
    const shoulder = spec.shoulder || 0;
    const offset = halfWidth - shoulder - MARKING_EDGE_INSET_M - MARKING_WIDTH_M / 2;
    // Une chaussée dont l'accotement mange toute la largeur n'a pas de rive à
    // marquer : mieux vaut aucune ligne qu'une ligne posée sur la terre.
    if (offset > MARKING_WIDTH_M) {
      out.push({ offset, dash: 0 });
      out.push({ offset: -offset, dash: 0 });
    }
  }
  if (spec.centerDash) out.push({ offset: 0, dash: MARKING_DASH_M });

  return out;
}

/**
 * Section en travers interpolée entre deux lignes.
 * @returns {{x:number, z:number, deck:number, px:number, pz:number}}
 */
function sectionBetween(path, decks, frames, i, j, t) {
  const a = path[i];
  const b = path[j];
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    deck: decks[i] + (decks[j] - decks[i]) * t,
    // Les repères ne sont pas moyennés : la perpendiculaire de la ligne amont
    // est celle du ruban sur tout l'intervalle, et un marquage qui prendrait
    // une autre normale s'écarterait de la rive qu'il longe.
    px: frames[i * 4 + 2],
    pz: frames[i * 4 + 3],
  };
}

/**
 * Section posée à une abscisse curviligne donnée le long d'une plage, ou
 * `null` si l'abscisse tombe hors de la plage.
 *
 * Sert à reculer d'une longueur exacte depuis une bouche de carrefour : la
 * bouche est un sommet interpolé, pas une ligne de ré-échantillonnage, et le
 * pas au sol varie d'un intervalle à l'autre.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {ArrayLike<number>} decks
 * @param {ArrayLike<number>} frames
 * @param {number} target Abscisse voulue, dans le repère de `path`.
 * @returns {{x:number, z:number, deck:number, px:number, pz:number}|null}
 */
export function sectionAtDistance(path, decks, frames, target) {
  const rows = path?.length ?? 0;
  if (rows < 2) return null;
  if (target < path[0].distance || target > path[rows - 1].distance) return null;

  for (let i = 1; i < rows; i++) {
    const d0 = path[i - 1].distance;
    const d1 = path[i].distance;
    if (target > d1) continue;
    const span = d1 - d0;
    const t = span > 1e-9 ? (target - d0) / span : 0;
    return sectionBetween(path, decks, frames, i - 1, i, t);
  }
  return null;
}

/**
 * Un quadrilatère de marquage tendu entre deux sections, sur une plage de
 * décalages latéraux.
 *
 * Chaque section garde **sa** perpendiculaire et **sa** cote : un marquage
 * posé dans une courbe ou sur une pente suit la chaussée au lieu de la couper.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} a Section amont (`sectionAtDistance`).
 * @param {Object} b Section aval.
 * @param {number} from Décalage latéral du premier bord, en mètres.
 * @param {number} to   Décalage latéral du second bord.
 * @param {number[]} color Couleur linéaire.
 * @param {number} lift Décollement au-dessus de la plate-forme.
 */
export function appendMarkingQuad(buffer, a, b, from, to, color, lift) {
  const base = buffer.positions.length / 3;
  for (const [section, at] of [
    [a, from],
    [a, to],
    [b, from],
    [b, to],
  ]) {
    buffer.positions.push(
      section.x + section.px * at,
      section.deck + lift,
      section.z + section.pz * at
    );
    buffer.colors.push(color[0], color[1], color[2]);
  }
  // (a·from, a·to, b·from, b·to) : deux triangles, dans l'ordre exact du ruban
  // (`appendRibbon` : `a, d, b, b, d, e`, où `d` est la section suivante et
  // `b` la colonne suivante). Ce n'est pas une préférence de style : le sens
  // de parcours **est** l'orientation de la face, et l'ordre naturel — les
  // deux sommets d'une section, puis les deux de la suivante — donne une face
  // tournée vers le sol, donc noire. La perpendiculaire de `pathFrames` étant
  // toujours la même par rapport à la tangente, ce sens est constant : il n'y
  // a rien à mesurer à l'exécution ici, contrairement au comblement d'un vide,
  // où la marche et la direction du vide tournent dans les deux sens.
  buffer.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

/**
 * Une ligne longitudinale, continue ou discontinue.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number,distance:number}>} options.path Plage dessinable.
 * @param {ArrayLike<number>} options.decks Plate-forme, une cote par point.
 * @param {ArrayLike<number>} [options.frames] Repères du ruban ; recalculés sinon.
 * @param {number} options.offset Décalage latéral de l'axe du trait.
 * @param {number[]} options.color
 * @param {number} [options.width]
 * @param {number} [options.lift]
 * @param {number} [options.dash] Longueur d'un trait ; zéro = continu.
 * @param {number} [options.startDistance] Abscisse de la chaîne au premier point.
 * @returns {number} traits posés.
 */
export function appendMarkingLine(
  buffer,
  {
    path,
    decks,
    frames = null,
    offset,
    color,
    width = MARKING_WIDTH_M,
    lift = 0,
    dash = 0,
    startDistance = 0,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !decks || !color) return 0;
  const used = frames || pathFrames(path);
  const from = offset - width / 2;
  const to = offset + width / 2;
  let laid = 0;

  for (let i = 1; i < rows; i++) {
    const d0 = startDistance + path[i - 1].distance;
    const d1 = startDistance + path[i].distance;
    const span = d1 - d0;
    if (!(span > 1e-6)) continue;

    if (dash <= 0) {
      appendMarkingQuad(
        buffer,
        sectionBetween(path, decks, used, i - 1, i, 0),
        sectionBetween(path, decks, used, i - 1, i, 1),
        from,
        to,
        color,
        lift
      );
      laid++;
      continue;
    }

    // Les traits sont coupés sur les multiples de `dash` de l'abscisse de la
    // chaîne, et non sur les lignes de ré-échantillonnage : un cycle de six
    // mètres tombe donc toujours au même endroit du terrain, quel que soit le
    // pas d'échantillonnage et quel que soit le découpage de la chaîne.
    const first = Math.floor(d0 / dash);
    const last = Math.floor(d1 / dash);
    for (let k = first; k <= last; k++) {
      if (((k % 2) + 2) % 2 !== 0) continue;
      const lo = Math.max(d0, k * dash);
      const hi = Math.min(d1, (k + 1) * dash);
      if (!(hi - lo > 1e-6)) continue;
      appendMarkingQuad(
        buffer,
        sectionBetween(path, decks, used, i - 1, i, (lo - d0) / span),
        sectionBetween(path, decks, used, i - 1, i, (hi - d0) / span),
        from,
        to,
        color,
        lift
      );
      laid++;
    }
  }

  return laid;
}

/**
 * Retrait d'une ligne de rive au-delà de la rive, en mètres — la même cote que
 * `markingLinesFor` compte depuis l'axe, retournée par l'autre bout.
 *
 * Sert à prolonger la rive le long d'un contour de carrefour, qui n'a pas
 * d'axe : c'est ce qui garantit que les deux tombent au même endroit.
 *
 * @param {Object} spec Profil du thème.
 * @returns {number} `NaN` si la classe ne porte pas de ligne de rive.
 */
export function borderInsetFor(spec) {
  if (!spec?.edgeLines) return NaN;
  return (spec.shoulder || 0) + MARKING_EDGE_INSET_M + MARKING_WIDTH_M / 2;
}

/**
 * Une ligne continue posée le long d'un **morceau de contour**, en retrait vers
 * l'intérieur.
 *
 * C'est ce qui prolonge une ligne de rive au travers d'un carrefour : le
 * contour d'une aire (`roadJunctions.junctionArea`) n'est pas une chaussée — il
 * n'a ni axe ni largeur — mais c'est exactement la rive que les rubans
 * quittent et retrouvent, sommet pour sommet. Une ligne posée en retrait
 * constant de ce contour tombe donc pile dans le prolongement de celle du
 * ruban, sans qu'aucune des deux ait à connaître l'autre.
 *
 * Le retrait est donné **par sommet** : les deux bouts du morceau appartiennent
 * à deux branches, qui peuvent ne pas avoir le même accotement. Le trait passe
 * de l'un à l'autre en tournant, comme les cotes du contour.
 *
 * Un sommet sans retrait connu (`NaN`) est une branche qui ne porte pas de
 * ligne de rive : le trait prend celui de l'autre sur toute sa longueur plutôt
 * que de s'arrêter, parce que sur le terrain la rive d'une rue fait bien le
 * tour du coin quand elle croise une sortie de garage. Aucun retrait connu du
 * tout, et il n'y a pas de rive à prolonger : rien n'est posé.
 *
 * De quel côté est « l'intérieur » n'est pas déduit d'un sens de rotation
 * supposé : le contour tourne dans le sens que lui donne le tri des branches
 * par azimut, et la perpendiculaire de `pathFrames` en hérite. On le **mesure**
 * donc contre la normale sortante que le morceau publie — même règle que la
 * bordure de trottoir, qui borde le même contour.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.points Morceau de contour.
 * @param {ArrayLike<number>} options.decks Cote par sommet.
 * @param {ArrayLike<number>} options.insets Retrait par sommet, en mètres.
 * @param {{x:number,z:number}} options.outward Normale sortante du morceau.
 * @param {number[]} options.color
 * @param {number} [options.width]
 * @param {number} [options.lift]
 * @returns {number} traits posés.
 */
export function appendMarkingBorder(
  buffer,
  { points, decks, insets, outward, color, width = MARKING_WIDTH_M, lift = 0 }
) {
  const rows = points?.length ?? 0;
  if (rows < 2 || !decks || !insets || !outward || !color) return 0;

  let known = NaN;
  for (const inset of insets) {
    if (!Number.isFinite(inset)) continue;
    known = inset;
    break;
  }
  if (!Number.isFinite(known)) return 0;

  const frames = pathFrames(points);
  // Mesurée au milieu du morceau : la perpendiculaire est une rotation fixe de
  // la tangente, donc elle reste du même côté d'un bout à l'autre, mais un
  // sommet d'extrémité a une tangente moins franche qu'un sommet d'arc.
  const middle = Math.floor(rows / 2);
  const inward =
    frames[middle * 4 + 2] * outward.x + frames[middle * 4 + 3] * outward.z > 0 ? -1 : 1;

  // L'axe du trait, décalé sommet par sommet. On repasse ensuite par
  // `appendMarkingLine` sur cette polyligne-là plutôt que d'émettre les
  // quadrilatères ici : le sens des faces est alors celui de tout le reste du
  // marquage, sans rien à mesurer de plus.
  const path = [];
  const platform = [];
  let distance = 0;
  for (let i = 0; i < rows; i++) {
    const shift = inward * (Number.isFinite(insets[i]) ? insets[i] : known);
    const x = points[i].x + frames[i * 4 + 2] * shift;
    const z = points[i].z + frames[i * 4 + 3] * shift;
    if (i > 0) distance += Math.hypot(x - path[i - 1].x, z - path[i - 1].z);
    path.push({ x, z, distance });
    platform.push(decks[i]);
  }

  return appendMarkingLine(buffer, {
    path,
    decks: platform,
    offset: 0,
    color,
    width,
    lift,
    dash: 0,
  });
}

/**
 * Une ligne en travers, entre deux sections voisines.
 *
 * @param {Object} buffer
 * @param {Object} options
 * @param {Object} options.near Section amont (`sectionAtDistance`).
 * @param {Object} options.far  Section aval.
 * @param {number} options.from Décalage latéral du premier bord.
 * @param {number} options.to   Décalage latéral du second.
 * @param {number[]} options.color
 * @param {number} [options.lift]
 * @returns {number} traits posés.
 */
export function appendMarkingBar(buffer, { near, far, from, to, color, lift = 0 }) {
  if (!near || !far || !color) return 0;
  if (Math.abs(to - from) < 1e-6) return 0;
  appendMarkingQuad(buffer, near, far, from, to, color, lift);
  return 1;
}

/**
 * Les décalages latéraux de la voie qui **arrive** à un carrefour, sur le bout
 * de plage qui y bute.
 *
 * La convention de `pathFrames` met la gauche de la marche du **tracé** dans
 * les décalages positifs — c'est celle que suit tout le mobilier de bord de
 * route, posé à droite donc à décalage négatif. Reste que le conducteur qui
 * aborde le carrefour ne marche dans le sens du tracé qu'à un seul des deux
 * bouts : à la tête de la plage, le carrefour est **derrière**, donc il vient
 * à contre-sens, et sa droite est la gauche du tracé. Se tromper de bout pose
 * la ligne d'effet sur la voie d'en face, celle qui repart.
 *
 * @param {number} half Demi-largeur peinte, en mètres.
 * @param {boolean} atHead Vrai si le carrefour borne la tête de la plage.
 * @returns {{from:number, to:number}}
 */
export function approachLane(half, atHead) {
  return atHead ? { from: 0, to: half } : { from: -half, to: 0 };
}

/**
 * Un passage piétons : des bandes **dans le sens de la marche**, en travers de
 * la chaussée.
 *
 * Le rang d'une bande se tire du décalage latéral, donc de l'axe de la
 * chaussée : il ne dépend ni du sens de parcours, ni du côté par lequel on
 * arrive. Seules les bandes peintes sont maillées — le vide, c'est le bitume,
 * qui est déjà là.
 *
 * @param {Object} buffer
 * @param {Object} options
 * @param {Object} options.near Section du côté du carrefour.
 * @param {Object} options.far  Section de l'autre côté.
 * @param {number} options.halfWidth Demi-largeur peinte, en mètres.
 * @param {number[]} options.color
 * @param {number} [options.band] Largeur d'une bande (et du vide qui la suit).
 * @param {number} [options.lift]
 * @returns {number} bandes posées.
 */
export function appendCrossing(buffer, { near, far, halfWidth, color, band = MARKING_BAR_M, lift = 0 }) {
  if (!near || !far || !color || !(halfWidth > 0) || !(band > 0)) return 0;
  let laid = 0;
  const last = Math.ceil(halfWidth / band);

  for (let k = -last; k < last; k++) {
    if (((k % 2) + 2) % 2 !== 0) continue;
    const from = Math.max(-halfWidth, k * band);
    const to = Math.min(halfWidth, (k + 1) * band);
    if (!(to - from > 1e-6)) continue;
    appendMarkingQuad(buffer, near, far, from, to, color, lift);
    laid++;
  }

  return laid;
}

/**
 * Espacement de deux pictogrammes le long d'une chaussée, en mètres.
 *
 * Assez rapproché pour qu'on en voie un depuis n'importe où sur la piste,
 * assez espacé pour que la piste ne soit pas un tapis de vélos.
 */
export const MARKING_SYMBOL_SPACING_M = 26;

/** Épaisseur d'un trait de pictogramme, en mètres. */
export const GLYPH_STROKE_M = 0.07;

/**
 * Un trait de pictogramme : le quadrilatère qui joint deux points, épaissi de
 * part et d'autre de sa direction.
 *
 * @param {{along:number, across:number}} a
 * @param {{along:number, across:number}} b
 * @param {number} [thickness]
 * @returns {Array<{along:number, across:number}>} quatre sommets, dans l'ordre.
 */
export function glyphBar(a, b, thickness = GLYPH_STROKE_M) {
  let dx = b.along - a.along;
  let dy = b.across - a.across;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-6)) return [];
  dx /= length;
  dy /= length;
  const nx = -dy * (thickness / 2);
  const ny = dx * (thickness / 2);
  return [
    { along: a.along + nx, across: a.across + ny },
    { along: b.along + nx, across: b.across + ny },
    { along: b.along - nx, across: b.across - ny },
    { along: a.along - nx, across: a.across - ny },
  ];
}

/**
 * Un anneau de pictogramme (une roue), découpé en quadrilatères.
 *
 * Les sommets sortent dans le **sens horaire** du repère (le long, en travers),
 * comme ceux de `glyphBar` : c'est ce sens-là qu'`appendMarkingGlyph` retourne
 * en éventail pour obtenir des faces tournées vers le ciel. L'ordre naturel —
 * intérieur, extérieur, extérieur suivant, intérieur suivant — tourne dans
 * l'autre sens, et les deux roues seraient noires.
 *
 * @param {number} along Centre.
 * @param {number} across
 * @param {number} radius Rayon moyen, en mètres.
 * @param {number} [thickness] Épaisseur du cerclage.
 * @param {number} [sides] Facettes.
 * @returns {Array<Array<{along:number, across:number}>>}
 */
export function glyphRing(along, across, radius, thickness = GLYPH_STROKE_M, sides = 12) {
  const out = [];
  const inner = Math.max(0, radius - thickness / 2);
  const outer = radius + thickness / 2;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const b = ((k + 1) / sides) * Math.PI * 2;
    out.push([
      { along: along + Math.cos(a) * outer, across: across + Math.sin(a) * outer },
      { along: along + Math.cos(a) * inner, across: across + Math.sin(a) * inner },
      { along: along + Math.cos(b) * inner, across: across + Math.sin(b) * inner },
      { along: along + Math.cos(b) * outer, across: across + Math.sin(b) * outer },
    ]);
  }
  return out;
}

/**
 * Le vélo, vu de côté et couché sur la chaussée : deux roues, un cadre, une
 * selle et un guidon. Environ 1,55 m dans le sens de la marche pour 0,55 m en
 * travers — les cotes du pictogramme peint en France.
 *
 * Le sens de la marche est celui du **tracé**, faute de mieux : la donnée ne
 * dit pas dans quel sens on roule sur une piste, et une piste bidirectionnelle
 * n'aurait de toute façon pas de réponse.
 *
 * @returns {Array<Array<{along:number, across:number}>>} polygones convexes.
 */
export function cycleGlyph() {
  const rear = { along: -0.48, across: 0 };
  const front = { along: 0.48, across: 0 };
  const bracket = { along: -0.06, across: 0.02 };
  const saddle = { along: -0.2, across: 0.42 };
  const stem = { along: 0.3, across: 0.42 };

  return [
    ...glyphRing(rear.along, rear.across, 0.28),
    ...glyphRing(front.along, front.across, 0.28),
    glyphBar(rear, bracket), // base
    glyphBar(bracket, saddle), // tube de selle
    glyphBar(rear, saddle), // hauban
    glyphBar(bracket, stem), // tube diagonal
    glyphBar(saddle, stem), // tube horizontal
    glyphBar(stem, front), // fourche
    glyphBar({ along: -0.33, across: 0.44 }, { along: -0.09, across: 0.48 }, 0.09), // selle
    glyphBar({ along: 0.22, across: 0.5 }, { along: 0.38, across: 0.36 }, 0.07), // guidon
  ].filter((polygon) => polygon.length >= 3);
}

/**
 * Pose un pictogramme centré sur une abscisse de la plage.
 *
 * Chaque sommet est cherché à **son** abscisse (`sectionAtDistance`) puis
 * décalé de sa cote en travers : le dessin se couche sur la chaussée, courbe
 * et devers compris. Si l'un des sommets tombe hors de la plage, rien n'est
 * posé — un demi-vélo au bord d'un carrefour serait pire que pas de vélo.
 *
 * @param {Object} buffer Tampon `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number,distance:number}>} options.path
 * @param {ArrayLike<number>} options.decks
 * @param {ArrayLike<number>} options.frames
 * @param {number} options.at Abscisse du centre, dans le repère de `path`.
 * @param {Array<Array<{along:number, across:number}>>} options.polygons
 * @param {number[]} options.color
 * @param {number} [options.lift]
 * @param {number} [options.side] Décalage en travers du centre du pictogramme.
 * @returns {number} `1` si posé, `0` sinon.
 */
export function appendMarkingGlyph(
  buffer,
  { path, decks, frames, at, polygons, color, lift = 0, side = 0 }
) {
  if (!Array.isArray(polygons) || polygons.length === 0 || !color) return 0;

  // Une section par abscisse distincte, au millimètre : un pictogramme a une
  // trentaine de cotes le long pour cent quarante sommets.
  const sections = new Map();
  const sectionFor = (along) => {
    const key = Math.round((at + along) * 1000);
    if (sections.has(key)) return sections.get(key);
    const found = sectionAtDistance(path, decks, frames, key / 1000);
    sections.set(key, found);
    return found;
  };

  for (const polygon of polygons) {
    for (const vertex of polygon) {
      if (!sectionFor(vertex.along)) return 0;
    }
  }

  for (const polygon of polygons) {
    const base = buffer.positions.length / 3;
    for (const vertex of polygon) {
      const section = sectionFor(vertex.along);
      const across = vertex.across + side;
      buffer.positions.push(
        section.x + section.px * across,
        section.deck + lift,
        section.z + section.pz * across
      );
      buffer.colors.push(color[0], color[1], color[2]);
    }
    // Éventail : les polygones du pictogramme sont convexes par construction.
    // Le sens est celui d'`appendMarkingQuad` — la perpendiculaire de
    // `pathFrames` étant constante par rapport à la tangente, il n'y a rien à
    // mesurer, et l'ordre inverse donnerait une face tournée vers le sol.
    for (let k = 1; k < polygon.length - 1; k++) {
      buffer.indices.push(base, base + k + 1, base + k);
    }
  }

  return 1;
}

/**
 * Les pictogrammes d'une plage dessinable, espacés le long de la chaîne.
 *
 * La phase se tire de l'abscisse de la chaîne (`startDistance`) et non du rang
 * dans la boucle : même invariant que les pointillés et que les hachures de
 * comblement — deux reconstructions qui découpent la chaîne ailleurs posent
 * les vélos aux mêmes endroits du terrain.
 *
 * @param {Object} buffer
 * @param {Object} options
 * @param {Array<{x:number,z:number,distance:number}>} options.path
 * @param {ArrayLike<number>} options.decks
 * @param {ArrayLike<number>} [options.frames]
 * @param {Array<Array<{along:number, across:number}>>} options.polygons
 * @param {number[]} options.color
 * @param {number} [options.spacing]
 * @param {number} [options.lift]
 * @param {number} [options.startDistance]
 * @returns {number} pictogrammes posés.
 */
export function appendMarkingSymbols(
  buffer,
  {
    path,
    decks,
    frames = null,
    polygons,
    color,
    spacing = MARKING_SYMBOL_SPACING_M,
    lift = 0,
    startDistance = 0,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !decks || !(spacing > 0)) return 0;
  const used = frames || pathFrames(path);

  const first = startDistance + path[0].distance;
  const last = startDistance + path[rows - 1].distance;
  let laid = 0;

  for (let k = Math.ceil(first / spacing); k * spacing <= last; k++) {
    laid += appendMarkingGlyph(buffer, {
      path,
      decks,
      frames: used,
      at: k * spacing - startDistance,
      polygons,
      color,
      lift,
    });
  }

  return laid;
}
