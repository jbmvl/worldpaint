/*
 * climate — quel climat il fait à cet endroit du monde.
 * ------------------------------------------------------
 * Le décor sait déjà lire *ce qu'il y a* au sol (`groundClassMap`) et *quelle
 * forme* il a (`elevationField`). Il ne savait pas *où sur la Terre* il se
 * trouve : une forêt était tirée dans la même liste de peuplements en Laponie
 * et en Provence, un village dans la même liste de palettes en Pologne et en
 * Andalousie. Ce module apporte la troisième entrée, et rien d'autre : il ne
 * décide de rien, il répond à une question.
 *
 * ## Pourquoi une grille embarquée plutôt qu'une requête
 *
 * Le relief et le vectoriel se chargent par tuiles, en réseau, parce qu'ils
 * sont énormes et qu'on n'en voit qu'un kilomètre carré à la fois. Le climat est
 * l'inverse : il est minuscule, il ne change jamais, et il décide de **quel
 * contenu existe** dans le décor. Une tuile de relief manquante fait un
 * plateau ; un climat manquant ferait un paysage entier tiré dans la mauvaise
 * liste. Il est donc embarqué, et `climateAt` est **pure, synchrone, sans
 * réseau ni canevas** — ce qui la rend aussi testable sous `node --test`, comme
 * `tileMath`.
 *
 * ## Pourquoi l'Europe seulement, et pourquoi c'est grossier
 *
 * La grille couvre l'Europe et rend `null` ailleurs : hors fenêtre, tout
 * retombe sur le comportement d'avant, qui reste un état valide. Son pas de
 * 0,1° (une dizaine de kilomètres) est volontairement grossier, pour deux
 * raisons. La première est qu'une frontière climatique nette est acceptée :
 * traverser d'un coup est ce qu'on veut. La seconde est qu'une grille fine ne
 * ferait que réencoder l'altitude — dont on dispose déjà, au mètre, par le MNT.
 *
 * ## Ce que Köppen ne dira jamais
 *
 * Une lande écossaise et un bocage normand sont tous les deux `Cfb`. Ce qui les
 * sépare est ailleurs, et déjà là : la sous-classe d'occupation du sol
 * (`coverFor`, dans `groundClassMap`) et le relief. Le climat est une entrée
 * parmi trois, pas un oracle.
 */

import { CLIMATE_GRID_RUNS } from './climateGrid.js';

/**
 * Les codes Köppen-Geiger, dans l'ordre qui sert d'**encodage à la grille** :
 * une cellule porte `indice + 1`, et zéro signifie « pas de donnée ».
 *
 * L'ordre est donc gravé, comme celui de `CROP_KINDS` et de `COVER_KINDS` : le
 * changer sans refabriquer la grille repeint l'Espagne en Finlande. C'est
 * volontairement la liste **mondiale** complète, même si la moitié n'apparaît
 * pas en Europe — elle est la table de correspondance d'une source, pas une
 * liste de ce qu'on sait peindre.
 */
export const KOPPEN_CODES = [
  'Af', 'Am', 'As', 'Aw',
  'BSh', 'BSk', 'BWh', 'BWk',
  'Cfa', 'Cfb', 'Cfc', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc',
  'Dfa', 'Dfb', 'Dfc', 'Dfd', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd',
  'EF', 'ET',
];

/**
 * Les familles que le décor sait peindre.
 *
 * Ce ne sont pas les trente classes de Köppen : ce sont les regroupements qui
 * **changent quelque chose à l'écran** en Europe. Deux classes qui donnent la
 * même forêt et le même village n'ont aucune raison d'être distinguées ici, et
 * une classe qui n'existe pas en Europe n'a aucune raison d'y figurer.
 */
export const CLIMATE_FAMILIES = [
  /** Plaine atlantique : Bretagne, Normandie, Irlande, Benelux, Angleterre. */
  'oceanic',
  /** Océanique froid et venté : Highlands, côtes norvégiennes, Islande côtière. */
  'oceanicUpland',
  /** Méditerranéen à été sec et chaud : Provence, Espagne côtière, Italie, Grèce. */
  'mediterranean',
  /** Méditerranéen tempéré : Portugal intérieur, Galice, arrière-pays. */
  'mediterraneanCool',
  /** Steppe : vallée de l'Èbre, Castille sèche, Murcie. */
  'semiArid',
  /** Désert : Tabernas, Bardenas. */
  'arid',
  /** Continental : Pologne, Baltique, plaine d'Europe centrale, plaine du Pô. */
  'continental',
  /** Boréal : Scandinavie, Finlande, taïga. */
  'boreal',
  /** Au-dessus de la limite forestière, par l'altitude ou par la latitude. */
  'alpine',
  /** Montagne méditerranéenne : montagnes grecques, Apennins, sierras. */
  'mediterraneanMontane',
  /** Calottes et glaciers. */
  'glacial',
];

/**
 * Code Köppen → famille.
 *
 * Les choix qui ne vont pas de soi, et pourquoi :
 *
 * - `Cfa` (plaine du Pô, bassin danubien) va au **continental** et non au
 *   méditerranéen : ses étés sont chauds mais ses hivers ne le sont pas, et
 *   c'est un paysage de grandes cultures, pas d'oliviers ;
 * - `Ds*` (montagnes grecques, sierras, Apennins) a sa propre famille : ce sont
 *   des montagnes **sèches**, pins noirs et karst, que ni l'alpin ni le
 *   méditerranéen de plaine ne décrivent ;
 * - `ET` est l'au-dessus de la limite forestière, qu'on y arrive par l'altitude
 *   (Alpes) ou par la latitude (Laponie côtière) : dans les deux cas il n'y a
 *   plus d'arbre, de la roche et une pelouse rase ;
 * - les climats tropicaux et de mousson (`A*`, `Cw*`, `Dw*`) n'ont pas de
 *   famille : ils n'existent pas dans la fenêtre couverte, et prétendre les
 *   peindre serait mentir sur ce que le thème sait faire.
 */
export const FAMILY_OF_KOPPEN = Object.freeze({
  Cfb: 'oceanic',
  Cfc: 'oceanicUpland',
  Csa: 'mediterranean',
  Csb: 'mediterraneanCool',
  Csc: 'mediterraneanCool',
  BSh: 'semiArid',
  BSk: 'semiArid',
  BWh: 'arid',
  BWk: 'arid',
  Cfa: 'continental',
  Dfa: 'continental',
  Dfb: 'continental',
  Dfc: 'boreal',
  Dfd: 'boreal',
  Dsa: 'mediterraneanMontane',
  Dsb: 'mediterraneanMontane',
  Dsc: 'mediterraneanMontane',
  Dsd: 'mediterraneanMontane',
  ET: 'alpine',
  EF: 'glacial',
});

/**
 * Altitude à partir de laquelle un climat de plaine devient de la montagne, en
 * mètres.
 *
 * C'est la moitié manquante de Köppen, et elle est gratuite : le MNT est déjà
 * là, au mètre, alors que la grille climatique ne descend pas sous la dizaine
 * de kilomètres. Innsbruck est classée `Cfb` comme Rennes — la classification
 * dit vrai pour le fond de vallée, et faux pour tout ce qui le domine.
 *
 * Deux seuils, parce que la montagne ne commence pas à la même hauteur selon
 * l'endroit : l'étage montagnard méditerranéen (pin noir, sapin, chêne vert qui
 * s'arrête) prend dès mille mètres, là où il faut monter plus haut ailleurs
 * pour quitter la forêt de plaine.
 */
export const MONTANE_ELEVATION_M = 1000;
export const ALPINE_ELEVATION_M = 1200;

/**
 * Corrige une famille par le relief. Fonction pure.
 *
 * Deux règles, et seulement deux :
 *
 * - un climat méditerranéen en altitude est une **montagne méditerranéenne** —
 *   la Corse, la Sierra Nevada, l'Olympe ne sont pas des garrigues en pente ;
 * - tout le reste, assez haut, est **alpin**.
 *
 * Ce qui n'est pas corrigé : la montagne méditerranéenne (elle l'est déjà) et
 * le glaciaire (rien au-dessus).
 *
 * @param {string|null} family
 * @param {{elevation?: number}|null} relief
 * @returns {string|null} la famille, corrigée ou telle quelle.
 */
export function refineByRelief(family, relief) {
  if (!family) return family;
  const elevation = relief?.elevation;
  if (!Number.isFinite(elevation)) return family;
  if (family === 'glacial' || family === 'mediterraneanMontane') return family;

  if (family === 'mediterranean' || family === 'mediterraneanCool') {
    return elevation >= MONTANE_ELEVATION_M ? 'mediterraneanMontane' : family;
  }
  return elevation >= ALPINE_ELEVATION_M ? 'alpine' : family;
}

/**
 * Cadrage de la grille embarquée. Le script qui la fabrique lit ces valeurs :
 * les changer ici sans refabriquer la grille décale l'Europe entière.
 */
export const GRID = Object.freeze({
  /** Longitude du bord ouest, en degrés. */
  west: -25,
  /** Latitude du bord nord, en degrés. */
  north: 72,
  /** Côté d'une cellule, en degrés. */
  step: 0.1,
  cols: 700,
  rows: 380,
});

/**
 * Rayon de recherche d'une cellule classée, en cellules.
 *
 * Une route de bord de mer tombe régulièrement sur une cellule d'océan : la
 * côte réelle passe au milieu d'une cellule de dix kilomètres. Sans cette
 * recherche, le décor perdrait son climat par intermittence tout le long d'un
 * littoral — c'est-à-dire précisément là où on roule le plus.
 */
export const NEAREST_CELLS = 6;

/** Grille décodée, à la première question posée. */
let cells = null;

function decodeBase64(text) {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/**
 * La grille, décodée une fois. Paresseux : une application qui ne demande
 * jamais de climat ne paie pas les 266 000 octets.
 */
function grid() {
  if (cells) return cells;
  const runs = decodeBase64(CLIMATE_GRID_RUNS);
  const out = new Uint8Array(GRID.cols * GRID.rows);
  let at = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const value = runs[i];
    const length = runs[i + 1];
    out.fill(value, at, at + length);
    at += length;
  }
  cells = out;
  return cells;
}

/**
 * Valeur de la cellule la plus proche qui dise quelque chose, ou 0.
 * Fonction pure vis-à-vis de la grille.
 */
function nearestClassified(data, col, row) {
  const here = data[row * GRID.cols + col];
  if (here) return here;

  for (let radius = 1; radius <= NEAREST_CELLS; radius++) {
    let best = 0;
    let bestDistance = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Seulement le pourtour de l'anneau : l'intérieur a déjà été vu.
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = col + dx;
        const z = row + dz;
        if (x < 0 || z < 0 || x >= GRID.cols || z >= GRID.rows) continue;
        const value = data[z * GRID.cols + x];
        if (!value) continue;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = value;
        }
      }
    }
    if (best) return best;
  }
  return 0;
}

/**
 * Climat d'un point, ou `null` hors d'Europe et sur les grandes étendues d'eau.
 *
 * `null` n'est pas une erreur : c'est l'état dans lequel le décor se peint comme
 * il se peignait avant que le climat existe. Tout ce qui le lit doit savoir s'en
 * passer.
 *
 * Fonction pure et synchrone.
 *
 * @param {number} lng
 * @param {number} lat
 * @returns {{family: string, koppen: string}|null}
 */
export function climateAt(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const col = Math.floor((lng - GRID.west) / GRID.step);
  const row = Math.floor((GRID.north - lat) / GRID.step);
  if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return null;

  const value = nearestClassified(grid(), col, row);
  if (!value) return null;

  const koppen = KOPPEN_CODES[value - 1];
  const family = FAMILY_OF_KOPPEN[koppen];
  // Un climat sans famille est un climat qu'on ne sait pas peindre : mieux vaut
  // le dire en se taisant que peindre une taïga sous les tropiques.
  if (!family) return null;
  return { family, koppen };
}
