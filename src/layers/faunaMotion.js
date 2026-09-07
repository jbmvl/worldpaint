/*
 * faunaMotion — ce qu'une bête fait de son temps.
 * -----------------------------------------------
 * Tout le décor est reconstruit tous les 250 mètres et immobile entre deux
 * reconstructions. Les bêtes en sont sorties : elles sont les seules choses
 * posées au sol qui bougent d'une image à l'autre. Ce module dit **comment**,
 * et rien d'autre — il ne connaît ni three, ni la scène, ni les tuiles.
 *
 * ## Une seule mécanique : des haltes et des trajets
 *
 * Une bête suit un **circuit** : une petite boucle fermée de stations. À
 * chaque station elle s'arrête un moment (et baisse la tête, si son espèce
 * mange par terre) ; entre deux stations elle marche ou elle court.
 *
 * Ce modèle unique couvre tout ce qu'on voulait, sans cas particulier :
 *
 * - **brouter** : trois ou quatre stations à cinq mètres, de longues haltes ;
 * - **marcher dans un pré** : six stations à quinze mètres, des haltes brèves ;
 * - **courir** : une grande boucle, aucune halte ;
 * - **traverser la route** : deux stations de part et d'autre, une longue
 *   attente sur le bas-côté, et le trajet qui passe sur la chaussée ;
 * - **guetter** : une station et rien d'autre.
 *
 * ## Pourquoi tout est fonction pure du temps
 *
 * Le déterminisme spatial est un invariant du projet : la même donnée doit
 * rendre le même paysage. Une position intégrée image par image en sortirait
 * — deux passages au même endroit ne donneraient pas la même bête, et une
 * reconstruction du décor la ferait sauter.
 *
 * Position, cap **et distance parcourue** sont donc calculés à partir du seul
 * temps écoulé (`faunaStateAt`). La distance sert la foulée : elle est
 * intégrée en forme close, pas accumulée, ce qui garantit qu'une patte ne
 * patine jamais et qu'une reconstruction ne remet pas la foulée à zéro.
 *
 * Les altitudes des stations, elles, sont échantillonnées **une fois** à la
 * pose : le terrain ne change pas, et une bête qui interroge le relief à
 * chaque image coûterait plus cher que tout le reste de l'animation.
 */

import { randomAt } from './furniturePlacement.js';

/**
 * Les conduites, et ce qui les distingue.
 *
 * - `stations` : combien d'arrêts sur le circuit ;
 * - `radiusM`  : de quel rayon la boucle s'écarte du point de pose. C'est ce
 *   qui borne l'errance : une bête ne doit jamais quitter sa parcelle, et
 *   c'est plus sûr de la retenir court que de rattraper une fugue ;
 * - `dwellS`   : la halte, en secondes (fourchette) ;
 * - `feed`     : la part de la halte passée la tête baissée ;
 * - `run`      : le trajet se fait à l'allure vive et non au pas.
 */
export const FAUNA_BEHAVIOURS = {
  /** Brouter sur place : le fond du décor, ce que fait un pré au repos. */
  graze: { stations: 4, radiusM: 4.5, dwellS: [7, 16], feed: 0.88, run: false },
  /** Avancer en broutant : le même, mais qui traverse lentement la parcelle. */
  amble: { stations: 6, radiusM: 14, dwellS: [3, 8], feed: 0.7, run: false },
  /** Marcher franchement, sans manger — un déplacement, pas un repas. */
  walk: { stations: 6, radiusM: 20, dwellS: [0.5, 2], feed: 0.15, run: false },
  /** Courir : une grande boucle, aucune halte. Rare, et c'est ce qui fait qu'on la remarque. */
  run: { stations: 5, radiusM: 34, dwellS: [0, 0], feed: 0, run: true },
  /** Guetter : immobile, tête haute. Une bête sur cinq, sinon le pré grouille. */
  watch: { stations: 1, radiusM: 0, dwellS: [1, 1], feed: 0, run: false },
  /** Flairer : la halte d'un carnassier — brève, tête à mi-hauteur. */
  sniff: { stations: 5, radiusM: 16, dwellS: [2, 6], feed: 0.45, run: false },
  /** Picorer : de tout petits pas, des haltes courtes, la tête qui bat. */
  peck: { stations: 5, radiusM: 3, dwellS: [2, 5], feed: 0.8, run: false, peck: true },
  /**
   * Traverser : deux stations de part et d'autre d'un obstacle, une longue
   * attente sur chaque bas-côté. C'est la seule conduite dont le tracé est
   * imposé de l'extérieur (voir `crossAxis`) — les autres se referment sur
   * elles-mêmes autour du point de pose.
   */
  cross: { stations: 2, radiusM: 0, dwellS: [9, 26], feed: 0.35, run: false },
};

/**
 * Ce qu'une famille d'espèces sait faire, et à quelle fréquence. Un item
 * répété pèse d'autant plus lourd — même convention que les essences d'arbre
 * et le gibier d'un bois.
 *
 * Les proportions disent quelque chose de vrai : un pré est fait de bêtes qui
 * broutent, pas de bêtes qui courent. Trois vaches sur quatre ont la tête
 * dans l'herbe à tout instant, et c'est ce qui rend la quatrième — celle qui
 * relève la tête et vous regarde passer — remarquable.
 */
export const FAUNA_REPERTOIRE = {
  grazer: ['graze', 'graze', 'graze', 'graze', 'graze', 'amble', 'amble', 'watch'],
  fowl: ['peck', 'peck', 'peck', 'walk', 'watch'],
  cervid: ['graze', 'graze', 'amble', 'watch', 'watch', 'walk', 'run'],
  boar: ['graze', 'graze', 'amble', 'amble', 'walk'],
  canid: ['sniff', 'sniff', 'walk', 'walk', 'watch', 'run'],
  bear: ['graze', 'amble', 'amble', 'walk', 'watch'],
};

/** Conduites de repli, pour une famille qu'on ne connaîtrait pas. */
export const DEFAULT_REPERTOIRE = ['graze', 'amble', 'watch'];

/**
 * Part des bêtes assez près d'une route pour qu'on leur propose de la
 * traverser, et qui la traversent effectivement.
 *
 * Volontairement basse. Une traversée est un événement : elle vaut par sa
 * rareté, et un troupeau qui traverse en boucle est un manège.
 */
export const CROSS_ODDS = 0.18;

/** Distance à une route en deçà de laquelle une traversée a du sens, en mètres. */
export const CROSS_REACH_M = 22;

/** Demi-longueur du trajet de traversée, en mètres — de bas-côté à bas-côté. */
export const CROSS_SPAN_M = 9;

/** Durée du virage vers la station suivante, en fin de halte, en secondes. */
export const TURN_S = 1.6;

/** Montée et descente de l'encolure au début et à la fin d'une halte, en secondes. */
export const HEAD_RAMP_S = 1.1;

/** Battements par seconde de la tête d'une poule qui picore. */
export const PECK_HZ = 1.7;

/**
 * La conduite d'une bête : tirée dans le répertoire de sa famille, sauf près
 * d'une route où la traversée l'emporte parfois.
 *
 * Fonction pure — le tirage vient du lieu, jamais de l'ordre de parcours.
 *
 * @param {Object} context
 * @param {string} context.family Famille de l'espèce (`FAUNA_SPECIES`).
 * @param {number} context.variant Tirage dans [0, 1[ attaché à la bête.
 * @param {boolean} [context.nearRoad] Une route passe à portée.
 * @param {number} [context.crossDraw] Second tirage, indépendant du premier :
 *        sans lui, « traverse » et « broute » seraient corrélés au même
 *        nombre et une bête proche d'une route ne brouterait jamais.
 * @returns {string} Une clé de `FAUNA_BEHAVIOURS`.
 */
export function behaviourFor({ family, variant = 0, nearRoad = false, crossDraw = 1 }) {
  if (nearRoad && crossDraw < CROSS_ODDS) return 'cross';
  const pool = FAUNA_REPERTOIRE[family] || DEFAULT_REPERTOIRE;
  return pool[Math.min(pool.length - 1, Math.floor(variant * pool.length))];
}

/**
 * Trace le circuit d'une bête et en fige les altitudes.
 *
 * Les stations sont réparties sur une boucle fermée autour du point de pose,
 * à un rayon bruité : un cercle parfait se lit comme un manège, et c'est le
 * seul défaut qu'on ne peut plus rattraper une fois qu'on l'a vu.
 *
 * Une station refusée par `allow` (chaussée, ballast, hors parcelle) est
 * **ramenée vers le point de pose** plutôt que retirée : retirer changerait
 * le nombre de stations, donc la période, donc le circuit entier — pour une
 * bête au bord d'un champ, ça veut dire un circuit différent à chaque
 * reconstruction, c'est-à-dire une bête qui saute.
 *
 * @param {Object} options
 * @param {string} options.behaviour Clé de `FAUNA_BEHAVIOURS`.
 * @param {number} options.x Point de pose.
 * @param {number} options.z Point de pose.
 * @param {number} options.walkMS Allure de marche de l'espèce.
 * @param {number} options.runMS  Allure vive de l'espèce.
 * @param {number} [options.roam] Facteur de rayon propre à l'espèce
 *        (`FAUNA_SPECIES.roam`) : les conduites sont décrites en mètres
 *        absolus, calibrés sur du bétail, et une poule n'erre pas comme une
 *        vache.
 * @param {Function} options.sampleY `(x, z) => altitude`, appelé une fois par
 *        station et jamais ensuite.
 * @param {Function} [options.allow] `(x, z) => boolean`. Une station refusée
 *        est rapprochée du point de pose jusqu'à être acceptée, ou abandonnée
 *        sur place.
 * @param {{x:number,z:number}} [options.crossAxis] Direction de la traversée,
 *        normalisée — la perpendiculaire à la route. Obligatoire pour
 *        `cross`, ignorée ailleurs.
 * @returns {Object|null} Le circuit, ou `null` si le sol est illisible.
 */
export function buildCircuit({ behaviour, x, z, walkMS, runMS, roam = 1, sampleY, allow = null, crossAxis = null }) {
  const rule = FAUNA_BEHAVIOURS[behaviour] || FAUNA_BEHAVIOURS.graze;
  const speed = rule.run ? runMS : walkMS;

  const place = (px, pz) => {
    // Repli par paliers vers le point de pose : trois essais suffisent, et
    // l'échec final laisse la station à l'ancre, ce qui est toujours valide
    // puisque c'est là que la bête a été posée.
    if (allow) {
      for (const shrink of [1, 0.6, 0.3]) {
        const cx = x + (px - x) * shrink;
        const cz = z + (pz - z) * shrink;
        if (allow(cx, cz)) {
          px = cx;
          pz = cz;
          break;
        }
        if (shrink === 0.3) {
          px = x;
          pz = z;
        }
      }
    }
    const y = sampleY(px, pz);
    return Number.isFinite(y) ? { x: px, y, z: pz } : null;
  };

  const points = [];
  if (behaviour === 'cross' && crossAxis) {
    // La traversée n'entoure pas le point de pose, elle le franchit : une
    // station de chaque côté, sur la perpendiculaire à la chaussée. `allow`
    // ne s'y applique pas — c'est tout l'objet de la manœuvre.
    for (const side of [-1, 1]) {
      const px = x + crossAxis.x * CROSS_SPAN_M * side;
      const pz = z + crossAxis.z * CROSS_SPAN_M * side;
      const y = sampleY(px, pz);
      if (!Number.isFinite(y)) return null;
      points.push({ x: px, y, z: pz });
    }
  } else {
    const count = Math.max(1, rule.stations);
    for (let i = 0; i < count; i++) {
      const turn = (i / count) * Math.PI * 2 + randomAt(x, z, 211) * Math.PI * 2;
      // Rayon bruité par station : c'est ce qui casse le manège.
      const wobble = 0.45 + randomAt(x + i * 3.7, z - i * 2.9, 213) * 0.9;
      const radius = rule.radiusM * roam * wobble;
      const spot = place(x + Math.cos(turn) * radius, z + Math.sin(turn) * radius);
      if (!spot) return null;
      points.push(spot);
    }
  }

  const halts = points.map((p) => ({
    ...p,
    dwell: rule.dwellS[0] + randomAt(p.x, p.z, 217) * Math.max(0, rule.dwellS[1] - rule.dwellS[0]),
    heading: 0,
  }));

  // Points de passage intermédiaires : sans eux, l'altitude est interpolée en
  // ligne droite d'une station à l'autre et une bête qui traverse trente
  // mètres de pré vallonné passe sous la butte du milieu. Un point de passage
  // est une station dont la halte est nulle — le même mécanisme, sans cas
  // particulier à écrire.
  const stations = densify(halts, sampleY, points.length > 1);

  // Trajets, et cap tenu pendant chaque halte : celui de l'arrivée. Une bête
  // ne pivote pas sur place en attendant ; elle tourne au moment de repartir,
  // et c'est `faunaStateAt` qui s'en charge.
  const legs = [];
  let loopLength = 0;
  for (let i = 0; i < stations.length; i++) {
    const from = stations[i];
    const to = stations[(i + 1) % stations.length];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const bearing = length > 1e-6 ? Math.atan2(to.x - from.x, to.z - from.z) : 0;
    legs.push({ length, duration: length / Math.max(0.05, speed), bearing });
    loopLength += length;
    stations[(i + 1) % stations.length].heading = bearing;
  }
  // Circuit à une seule station : rien ne tourne, le cap est tiré au lieu.
  if (stations.length === 1) {
    stations[0].heading = randomAt(x, z, 219) * Math.PI * 2;
    legs.length = 0;
  }

  const period = stations.reduce((sum, s) => sum + s.dwell, 0) + legs.reduce((sum, l) => sum + l.duration, 0);

  return {
    behaviour,
    stations,
    legs,
    loopLength,
    speed,
    feed: rule.feed,
    peck: rule.peck === true,
    // Décalage propre à la bête : deux vaches voisines qui lèvent la tête
    // ensemble se repèrent instantanément.
    offset: randomAt(x, z, 223) * Math.max(1, period),
    period: Math.max(0.1, period),
  };
}

/** Repli en boucle dans [0, span[, sans le saut que `%` fait sur un négatif. */
function wrap(value, span) {
  return ((value % span) + span) % span;
}

/** Pas d'échantillonnage du sol le long d'un trajet, en mètres. */
export const TERRAIN_SAMPLE_M = 7;

/** Stations au plus sur un circuit, points de passage compris. */
export const CIRCUIT_MAX_STATIONS = 48;

/**
 * Insère les points de passage nécessaires pour que le sol soit suivi.
 *
 * Fonction pure à l'appel de `sampleY` près, qui lit le relief déjà construit
 * et ne le modifie pas.
 */
function densify(halts, sampleY, closed) {
  if (halts.length < 2) return halts;
  const out = [];
  let budget = CIRCUIT_MAX_STATIONS - halts.length;

  for (let i = 0; i < halts.length; i++) {
    const from = halts[i];
    const to = halts[(i + 1) % halts.length];
    out.push(from);
    if (!closed && i === halts.length - 1) break;

    const span = Math.hypot(to.x - from.x, to.z - from.z);
    const cuts = Math.min(budget, Math.max(0, Math.ceil(span / TERRAIN_SAMPLE_M) - 1));
    budget -= cuts;
    for (let c = 1; c <= cuts; c++) {
      const u = c / (cuts + 1);
      const px = from.x + (to.x - from.x) * u;
      const pz = from.z + (to.z - from.z) * u;
      const y = sampleY(px, pz);
      // Un sondage illisible ne vaut pas la peine d'abandonner le circuit :
      // sans ce point, la ligne droite reprend, ce qui est l'état d'avant.
      if (Number.isFinite(y)) out.push({ x: px, y, z: pz, dwell: 0, heading: 0 });
    }
  }
  return out;
}

/**
 * Où en est une bête, et ce qu'elle fait, à un instant donné. Fonction pure.
 *
 * @param {Object} circuit Rendu par `buildCircuit`.
 * @param {number} time Secondes écoulées.
 * @returns {{x:number,y:number,z:number,heading:number,speed:number,head:number,distance:number}}
 *          `head` est la part de rabattement de l'encolure, de 0 (haute) à 1 ;
 *          `distance` est le chemin parcouru depuis l'origine des temps, dont
 *          se déduit la foulée.
 */
export function faunaStateAt(circuit, time) {
  const { stations, legs, period, loopLength, speed } = circuit;
  const laps = Math.floor((time + circuit.offset) / period);
  let t = wrap(time + circuit.offset, period);
  let travelled = laps * loopLength;

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const leg = legs[i] || null;

    // --- La halte ---------------------------------------------------------
    if (t < station.dwell) {
      let heading = station.heading;
      // Le virage de fin de halte : la bête se tourne vers là où elle va
      // avant de s'y rendre, elle ne pivote pas en marchant.
      if (leg && station.dwell > TURN_S) {
        const left = station.dwell - t;
        if (left < TURN_S) {
          const turn = 1 - left / TURN_S;
          let delta = leg.bearing - heading;
          // Par le plus court chemin : sans ça une bête fait un tour complet
          // pour un écart de dix degrés qui passe par ±π.
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          heading += delta * turn;
        }
      }
      return {
        x: station.x,
        y: station.y,
        z: station.z,
        heading,
        speed: 0,
        head: headAt(circuit, t, station.dwell),
        distance: travelled,
      };
    }
    t -= station.dwell;

    // --- Le trajet --------------------------------------------------------
    if (!leg) break;
    if (t < leg.duration) {
      const to = stations[(i + 1) % stations.length];
      const u = leg.duration > 1e-6 ? t / leg.duration : 1;
      return {
        x: station.x + (to.x - station.x) * u,
        y: station.y + (to.y - station.y) * u,
        z: station.z + (to.z - station.z) * u,
        heading: leg.bearing,
        speed,
        head: 0,
        distance: travelled + leg.length * u,
      };
    }
    t -= leg.duration;
    travelled += leg.length;
  }

  // Le temps est retombé exactement sur la fin du circuit : la dernière
  // station est la bonne réponse, et c'est un cas qui arrive.
  const last = stations[stations.length - 1];
  return { x: last.x, y: last.y, z: last.z, heading: last.heading, speed: 0, head: 0, distance: travelled };
}

/**
 * Part de rabattement de l'encolure pendant une halte, de 0 à 1.
 *
 * L'encolure descend et remonte progressivement : une tête qui tombe d'un
 * coup au début de la halte se lit comme un raté d'animation, pas comme une
 * bête qui se met à brouter.
 */
function headAt(circuit, t, dwell) {
  const feeding = dwell * circuit.feed;
  if (feeding <= 0) return 0;
  // La pâture est centrée dans la halte : la bête arrive, baisse la tête,
  // mange, la relève avant de repartir.
  const start = (dwell - feeding) / 2;
  const into = t - start;
  if (into <= 0 || into >= feeding) return 0;

  const ramp = Math.min(HEAD_RAMP_S, feeding / 2);
  const rise = Math.min(1, into / ramp);
  const fall = Math.min(1, (feeding - into) / ramp);
  const level = Math.min(rise, fall);
  // La poule ne broute pas, elle frappe : sa tête bat au lieu de tenir.
  return circuit.peck ? level * (0.55 + 0.45 * Math.sin(into * Math.PI * 2 * PECK_HZ)) : level;
}
