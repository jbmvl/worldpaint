/*
 * parcelFauna — qui vit dans une parcelle : le troupeau d'une pâture, le
 * gibier ou le carnassier d'un bois.
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
