/*
 * parcelFauna — qui vit dans une parcelle : le troupeau d'une pâture, le
 * gibier ou le carnassier d'un bois — et qui vit hors parcelle, sur les
 * grandes matières ouvertes (lande, pré salé, estive) qu'aucun contour ne
 * ferme (`buildOpenPastureFauna`).
 *
 * C'est le seul point où le mobilier et le vivant se touchent, et la frontière
 * y est nette : ici on décide de **ce qui existe** — cette espèce, à cet
 * endroit, faisant cela, de cette couleur — et `faunaLayer` ne fait plus que
 * le jouer. Le circuit interroge le relief une fois par station et plus jamais
 * ensuite, ce qui est la raison pour laquelle il se trace dans une couche qui
 * a déjà la bulle sous la main.
 */

import { FAUNA_SPECIES } from '../../models/fauna/index.js';
import { behaviourFor, buildCircuit, CROSS_REACH_M } from '../faunaMotion.js';
import {
  herdFor,
  forestGameFor,
  FOREST_GAME_PER_HECTARE,
  FOREST_GAME_EMPTY_ODDS,
  PREDATOR_MAX,
  scatterInRing,
  pointInRing,
  randomAt,
  positionSeed,
} from '../furniturePlacement.js';
import { pointInAreas } from '../settlement.js';
import { FURNITURE_LIMITS } from './catalog.js';

/**
 * Part des pâtures qu'on laisse vides. Descendue de 0,2 à 0,12 : les prés ne
 * sont pas tous occupés le même jour, mais un sur cinq était beaucoup pour un
 * bocage qu'on traverse en dix minutes.
 */
export const HERD_EMPTY_ODDS = 0.12;

/**
 * Portée de la recherche d'une route à laquelle adosser un groupe de bêtes,
 * en mètres.
 *
 * Le décor n'est pas regardé de partout : il est regardé depuis la route. Une
 * bête au fond d'un champ de quarante hectares est aussi coûteuse qu'une bête
 * au bord de la chaussée et ne sera jamais vue. On regroupe donc les troupeaux
 * et le gibier du côté de la route la plus proche, quand il y en a une à
 * portée — et on assume que c'est un peu arrangé : personne ne compare le
 * paysage à la parcelle réelle, tout le monde regarde ce qui passe.
 *
 * Le semis reste déterministe : la route la plus proche du centroïde d'une
 * parcelle ne dépend ni de l'ordre de parcours ni de l'observateur.
 */
export const ROADWARD_REACH_M = 55;

/**
 * Distance à laquelle un groupe adossé à une route se tient de sa rive, en
 * mètres. Assez pour ne pas paître sur l'accotement, assez peu pour être vu.
 */
export const ROADWARD_STANDOFF_M = 11;

/**
 * Demi-côté de la boîte où se sème un groupe adossé à une route, en mètres.
 *
 * Sans elle, le resserrement reste proportionnel à la parcelle et un troupeau
 * « près de la route » d'un openfield de six cents mètres de large s'étale
 * encore sur deux cents. C'est ce nombre-là qui fait que le regroupement veut
 * dire quelque chose.
 */
export const ROADWARD_SPREAD_M = 26;

/** Rayons du balayage grossier qui cherche une route à traverser (`crossingAt`). */
export const CROSS_PROBE_RAYS = 8;
/** Distance du balayage grossier, en mètres — au milieu de la portée de traversée. */
export const CROSS_PROBE_M = 13;
/** Sondages du balayage fin, une fois une route touchée. */
export const CROSS_PROBE_STEPS = 8;

/**
 * Met du bétail dans une pâture.
 *
 * Ce qui fait qu'un troupeau se lit comme un troupeau et pas comme un semis
 * d'objets, c'est qu'il est **groupé** (`scatterInRing({ cluster })`).
 *
 * Pas de cap commun : chaque bête tient celui de son propre circuit. Un
 * troupeau qui broute tout entier du même côté n'est acceptable que si rien ne
 * bouge.
 *
 * Une parcelle sur huit reste vide (`HERD_EMPTY_ODDS`) : les prés ne sont
 * pas tous occupés le même jour, et le décor y gagne en respiration.
 */
export function placeHerd(layer, ring, centre, variant, steepness, count) {
  if (randomAt(centre.x, centre.z, 53) < HERD_EMPTY_ODDS) return 0;

  const { item, spread } = herdFor({ steepness, variant, matrix: layer.region?.matrix ?? null });
  const seed = positionSeed(centre.x, centre.z, 61);
  const focus = roadwardFocus(layer, ring, centre);
  let placed = 0;

  // Un troupeau ne paît pas sur le bitume, ni sur le ballast.
  const semis = scatterInRing(ring, count, seed, {
    cluster: spread,
    focus,
    reachM: focus ? ROADWARD_SPREAD_M : 0,
  });
  for (const spot of layer._filterOffInfra(semis)) {
    placed += placeFauna(layer, item, { x: spot.x, z: spot.z, ring, scale: 0.9 + spot.variant * 0.22 });
  }
  return placed;
}

/**
 * Met du gibier — ou un carnassier — dans un bois.
 *
 * Trois choses le distinguent d'un troupeau au pré, et les trois comptent :
 * il est rare (deux massifs sur cinq n'en portent aucun,
 * `FOREST_GAME_EMPTY_ODDS`), il est groupé (compagnie de sangliers, harde de
 * cervidés), et il dépend du pays — le renne remplace le cervidé au nord, le
 * sanglier domine au sud.
 *
 * Un massif sur sept environ abrite un carnassier au lieu du gibier
 * (`PREDATOR_ODDS`). Il n'est alors ni compté à l'hectare ni groupé en
 * harde : un renard va seul, un loup à deux. C'est la raison du second
 * tirage — mêlé au premier, un loup listé une fois dans un répertoire de six
 * sortirait dans un bois sur six, et cesserait d'être un loup.
 *
 * Il n'est pas cantonné à l'ourlet, contrairement au bois de coupe : une bête
 * se tient où elle veut, et c'est en lisière qu'on la voit le mieux de toute
 * façon.
 */
export function placeForestGame(layer, ring, centre, variant, hectares) {
  if (randomAt(centre.x, centre.z, 83) < FOREST_GAME_EMPTY_ODDS) return 0;

  const game = forestGameFor({
    variant,
    predatorDraw: randomAt(centre.x, centre.z, 97),
    matrix: layer.region?.matrix ?? null,
  });
  if (!game) return 0;

  const jitter = randomAt(centre.x, centre.z, 87);
  // Un carnassier ne se compte pas à l'hectare : il y en a un, ou deux.
  const ceiling = game.solitary ? PREDATOR_MAX : 6;
  const count = game.solitary
    ? 1 + (jitter < 0.35 ? 1 : 0)
    : Math.min(ceiling, Math.floor(hectares * FOREST_GAME_PER_HECTARE + jitter));
  if (count <= 0) return 0;

  const seed = positionSeed(centre.x, centre.z, 91);
  // Le gibier aussi se tient du côté de la route : c'est en lisière qu'on le
  // voit, et la lisière qui compte est celle qu'on longe.
  const focus = roadwardFocus(layer, ring, centre);
  let placed = 0;

  const semis = scatterInRing(ring, count, seed, {
    cluster: game.spread,
    focus,
    reachM: focus ? ROADWARD_SPREAD_M : 0,
  });
  for (const spot of layer._filterOffInfra(semis)) {
    placed += placeFauna(layer, game.item, { x: spot.x, z: spot.z, ring, scale: 0.9 + spot.variant * 0.2 });
  }
  return placed;
}

/**
 * Point d'une parcelle où adosser un groupe de bêtes : à portée de vue de la
 * route la plus proche, du côté où la parcelle s'étend.
 *
 * Le calcul part du centroïde et non d'un tirage : c'est ce qui garantit que
 * la même parcelle rend le même point d'ancrage à chaque reconstruction. Il
 * s'écarte de la rive de `ROADWARD_STANDOFF_M` **vers le centroïde**, parce
 * qu'une route qui longe une parcelle la borde par un côté : le point qui
 * lui fait face, décalé vers l'intérieur, est dans la parcelle.
 *
 * Rend `null` — et le semis reprend son tirage libre — dans les trois cas où
 * l'ancrage n'aurait pas de sens : aucune route à portée, une route qui
 * passe pile sur le centroïde (aucune direction à suivre), un point qui
 * retombe hors de la parcelle (une parcelle en croissant, une route qui la
 * coupe en biais).
 *
 * Comme `crossingAt`, la réponse dépend de ce que l'index des chaussées
 * couvre : une parcelle collée au bord du bloc de tuiles pourrait ne pas
 * voir une route qui est juste au-delà. Routes et parcelles viennent des
 * mêmes tuiles, donc le cas est marginal — mais c'est bien là, et nulle part
 * ailleurs, qu'un troupeau pourrait se replacer d'une reconstruction à
 * l'autre.
 *
 * @returns {{x:number,z:number}|null}
 */
export function roadwardFocus(layer, ring, centre) {
  const hit = layer._roadIndex?.nearestWithin?.(centre.x, centre.z, ROADWARD_REACH_M);
  if (!hit) return null;

  const dx = centre.x - hit.x;
  const dz = centre.z - hit.z;
  const away = Math.hypot(dx, dz);
  if (away < 1e-3) return null;

  const standoff = hit.segment.halfWidth + ROADWARD_STANDOFF_M;
  const focus = { x: hit.x + (dx / away) * standoff, z: hit.z + (dz / away) * standoff };
  return pointInRing(ring, focus.x, focus.z) ? focus : null;
}

/**
 * Pose une bête : tire sa conduite, trace son circuit, choisit sa robe.
 *
 * C'est le seul point du projet où le mobilier et le vivant se touchent, et
 * la frontière y est nette : ici on décide de **ce qui existe** — cette
 * espèce, à cet endroit, faisant cela, de cette couleur —, et `faunaLayer`
 * ne fait plus que le jouer. Aucun état de la scène n'est lu ni écrit.
 *
 * Le circuit interroge le relief une fois par station et plus jamais
 * ensuite : c'est la raison pour laquelle cette fonction vit dans une
 * couche qui a déjà la bulle sous la main.
 *
 * @param {boolean} [options.flee] Voir `faunaLayer._checkFlee` : la bête
 *        s'échappe quand l'observateur passe à portée, au lieu de suivre son
 *        circuit jusqu'au bout.
 * @returns {number} 1 si la bête est posée, 0 sinon.
 */
export function placeFauna(layer, kind, { x, z, ring = null, scale = 1, flee = false }) {
  if (layer.fauna.length >= FURNITURE_LIMITS.fauna) return 0;
  const spec = FAUNA_SPECIES[kind];
  if (!spec) return 0;

  const crossing = crossingAt(layer, x, z);
  const behaviour = behaviourFor({
    family: spec.family,
    variant: randomAt(x, z, 227),
    nearRoad: crossing !== null,
    // Tirage distinct : sinon une bête proche d'une route traverserait ou
    // brouterait selon le même nombre, et les deux seraient corrélés.
    crossDraw: randomAt(x, z, 229),
  });

  const anchor = behaviour === 'cross' && crossing ? crossing.centre : { x, z };
  const circuit = buildCircuit({
    behaviour,
    x: anchor.x,
    z: anchor.z,
    walkMS: spec.walkMS,
    runMS: spec.runMS,
    roam: spec.roam,
    sampleY: (sx, sz) => layer.bubble.surfaceElevationAtLocal(sx, sz, 0) * layer.bubble.verticalScale,
    // La bête reste dans sa parcelle et hors de la chaussée. La traversée
    // est la seule exception, et elle passe par `crossAxis`, pas par ici.
    allow: (sx, sz) => !layer._onRoad(sx, sz) && (!ring || pointInRing(ring, sx, sz)),
    crossAxis: crossing?.axis || null,
  });
  if (!circuit) return 0;

  layer.fauna.push({
    kind,
    x: anchor.x,
    z: anchor.z,
    circuit,
    tint: layer._coatFor(kind, x, z),
    scale,
    flee,
  });
  return 1;
}

/**
 * Cherche une chaussée à traverser depuis un point, et rend de quoi la
 * franchir : le milieu du trajet (sur la route) et sa direction.
 *
 * Deux temps, et le premier existe pour le prix : un balayage grossier de
 * huit directions écarte en huit sondages la quasi-totalité des bêtes, qui
 * sont au milieu d'un champ. Seules celles qui ont touché quelque chose
 * paient le balayage fin. Sans ce filtre, une reconstruction dense
 * dépenserait des dizaines de milliers d'interrogations d'index pour
 * n'autoriser que quelques traversées.
 *
 * @returns {{centre:{x:number,z:number}, axis:{x:number,z:number}}|null}
 */
export function crossingAt(layer, x, z) {
  if (!layer._infraIndex) return null;

  for (let i = 0; i < CROSS_PROBE_RAYS; i++) {
    const angle = (i / CROSS_PROBE_RAYS) * Math.PI * 2;
    const ax = Math.cos(angle);
    const az = Math.sin(angle);
    if (!layer._onRoad(x + ax * CROSS_PROBE_M, z + az * CROSS_PROBE_M)) continue;

    // Touché : on remonte le rayon pour trouver l'entrée de l'emprise, et
    // on vise son milieu — une traversée qui commence sur la chaussée n'en
    // est pas une.
    for (let step = 1; step <= CROSS_PROBE_STEPS; step++) {
      const reach = (step / CROSS_PROBE_STEPS) * CROSS_REACH_M;
      const px = x + ax * reach;
      const pz = z + az * reach;
      if (layer._onRoad(px, pz)) return { centre: { x: px, z: pz }, axis: { x: ax, z: az } };
    }
    return { centre: { x: x + ax * CROSS_PROBE_M, z: z + az * CROSS_PROBE_M }, axis: { x: ax, z: az } };
  }
  return null;
}

// --- Le vivant hors parcelle -------------------------------------------------

/**
 * Matières ouvertes où un troupeau se tient sans clôture : lande, pré salé,
 * estive. Une lande ou un pré salé qui reste vide se remarque — c'est
 * précisément le genre de paysage où le mouton fait le décor.
 */
export const OPEN_PASTURE_KINDS = new Set(['heath', 'saltmarsh', 'alpine']);

/** Portée du semis, en mètres — plus courte que celle du mobilier ordinaire (voir `buildBiomeDebris`). */
export const OPEN_PASTURE_RADIUS_M = 400;
/** Pas de la grille de semis, en mètres : un groupe prend plus de place qu'un objet posé. */
export const OPEN_PASTURE_CELL_M = 70;
/**
 * Densité de groupes à l'hectare. Sciemment basse : « quelques moutons
 * dispersés », pas un troupeau à chaque maille — une lande ouverte se
 * reconnaît aussi à ce qu'elle laisse vide.
 */
export const OPEN_PASTURE_PER_HA = 0.06;
/** Bêtes par groupe, hors parcelle — plus petit qu'un troupeau de pré clos. */
export const OPEN_PASTURE_GROUP = [2, 4];
/** Demi-côté du carré où un groupe se disperse, en mètres — sans clôture réelle à lire. */
export const OPEN_PASTURE_HALF_M = 16;

/**
 * Carré centré sur un point, pour donner à `scatterInRing`/`placeHerd` une
 * limite là où aucun contour de parcelle n'existe. Ce n'est pas une clôture :
 * rien dans le paysage ne le justifierait sur une lande ouverte. C'est
 * seulement le patron géométrique que ces deux fonctions attendent déjà,
 * réduit à son plus petit format — la seule alternative étant de dupliquer
 * leur logique de dispersion pour un unique appelant.
 */
function grazingSquare(x, z, half) {
  return [
    { x: x - half, z: z - half },
    { x: x + half, z: z - half },
    { x: x + half, z: z + half },
    { x: x - half, z: z + half },
  ];
}

/**
 * Vivant hors parcelle : les mêmes troupeaux qu'une pâture close, mais posés
 * sur une grille ancrée au monde plutôt que dans un contour — lande, pré
 * salé, estive n'ont pas de clôture, et restaient vides pour cette seule
 * raison. Même patron que `buildBiomeDebris` (furniture/biomeDebris.js) :
 * grille, tirage constant par maille, refus du bâti et des chaussées.
 *
 * Réutilise `placeHerd` tel quel — choix de l'espèce (`herdFor`), tirage du
 * vide (`HERD_EMPTY_ODDS`), ancrage à la route la plus proche
 * (`roadwardFocus`) — sur un petit carré de dispersion (`grazingSquare`) qui
 * tient lieu du contour de parcelle qu'il n'y a pas. Le plafond est
 * `FURNITURE_LIMITS.fauna`, **partagé** avec le bétail de parcelle et le
 * gibier : un mouton de lande peut évincer une vache de pré si le budget est
 * déjà pris, et c'est un compromis délibéré plutôt qu'un budget à part, que
 * rien ne justifierait tant que la portée reste modeste.
 */
export function buildOpenPastureFauna(layer, context, builtUp) {
  if (!layer.groundClass) return;
  const { here } = context;
  const step = OPEN_PASTURE_CELL_M;
  const cellHa = (step * step) / 10000;
  const startX = Math.floor((here.x - OPEN_PASTURE_RADIUS_M) / step) * step;
  const startZ = Math.floor((here.z - OPEN_PASTURE_RADIUS_M) / step) * step;
  let placed = 0;

  for (let z = startZ; z <= here.z + OPEN_PASTURE_RADIUS_M; z += step) {
    for (let x = startX; x <= here.x + OPEN_PASTURE_RADIUS_M; x += step) {
      if (layer.fauna.length >= FURNITURE_LIMITS.fauna) {
        layer.counts.openPasture = placed;
        return;
      }

      const px = x + (randomAt(x, z, 491) - 0.5) * step * 0.8;
      const pz = z + (randomAt(x, z, 499) - 0.5) * step * 0.8;
      if (Math.hypot(px - here.x, pz - here.z) > OPEN_PASTURE_RADIUS_M) continue;
      if (pointInAreas(builtUp, px, pz)) continue;
      if (layer._onRoad(px, pz)) continue;

      const kind = layer.groundClass.surfaceAt?.(px, pz);
      if (!kind || !OPEN_PASTURE_KINDS.has(kind)) continue;

      // La rareté du semis, avant tout tirage propre à `placeHerd` : une
      // maille qualifiée sur beaucoup ne pose rien, et c'est voulu.
      if (randomAt(px, pz, 503) > cellHa * OPEN_PASTURE_PER_HA) continue;

      const variant = randomAt(px, pz, 509);
      const steepness = layer._steepnessAt(px, pz);
      const sizeDraw = randomAt(px, pz, 521);
      const count = OPEN_PASTURE_GROUP[0] + Math.floor(sizeDraw * (OPEN_PASTURE_GROUP[1] - OPEN_PASTURE_GROUP[0] + 1));

      const ring = grazingSquare(px, pz, OPEN_PASTURE_HALF_M);
      if (placeHerd(layer, ring, { x: px, z: pz }, variant, steepness, count) > 0) placed++;
    }
  }
  layer.counts.openPasture = placed;
}
