/*
 * hedgeGeometry — une haie lue comme un balayage modulé.
 * Un balayage à section constante (`appendProfile`) tient à cent mètres mais
 * se lit comme un tube extrudé à dix mètres — le défaut n'est pas dans la
 * section, il est dans le fait qu'une haie n'est pas une section balayée.
 *
 * Une haie est une masse continue et irrégulière : `hedgeModulation` en fait
 * varier sans arrêt la hauteur et la largeur, ligne par ligne, de loin comme
 * de près. Aucun volume n'y est ajouté : des arbustes posés dessus ajoutaient
 * du bruit sans rien dire de plus de la haie. Tirages ancrés au sol partout.
 *
 * Grain low poly : `hedgeModulation` module en continu (courbe lisse même
 * finement échantillonnée), `hedgeFacets` fait l'inverse — le tirage
 * indépendant par ligne de `facetJitter`, commun au mobilier balayé.
 * L'espacement des arêtes vient du pas de ré-échantillonnage du tracé
 * (`HEDGE_SAMPLE_M`).
 *
 * Les bouts rentrent en museau plutôt que sur le bouchon plat que pose
 * `appendProfile` : `hedgeNosePath` ajoute des lignes dans les derniers mètres
 * (à soixante-quinze centimètres de pas, l'arrondi tiendrait sur une ligne et
 * demie) et `hedgeEndTaper` y resserre toute la section en quart d'ellipse —
 * tangente verticale au bout, donc un bout **rond** et non conique. Le
 * facettage est calculé après la densification et sur les mêmes lignes : le
 * museau a le grain du corps de la haie, il n'est pas une calotte lisse
 * rapportée.
 */

import { facetJitter } from './facetJitter.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Pas de ré-échantillonnage d'une haie, en mètres — double emploi assumé avec
 * l'espacement des arêtes facettées (`hedgeFacets`).
 */
export const HEDGE_SAMPLE_M = 0.75;

/**
 * Cotes d'une famille de haie, prises au thème.
 * @param {string} kind `hedge` ou `lowHedge`.
 * @param {Object} [shapes] Tranche `theme.furniture.hedges`.
 */
export function hedgeStyleFor(kind, shapes = defaultTheme.furniture.hedges) {
  return shapes?.[kind] ?? defaultTheme.furniture.hedges[kind];
}

/** Réglages par défaut, prêts à l'emploi — le repli de toutes les fonctions. */
export const HEDGE_STYLES = {
  hedge: hedgeStyleFor('hedge'),
  lowHedge: hedgeStyleFor('lowHedge'),
};

/**
 * Hauteur et largeur relatives du balayage, ligne par ligne : le relief (ondes
 * de périodes incommensurables, tirées du sol) et la largeur (même idée en
 * travers).
 *
 * @param {Array<{x:number,z:number}>} path Polyligne ré-échantillonnée.
 * @param {Object} [options]
 * @param {number} [options.offset] Décalage latéral de l'axe de balayage.
 * @returns {{up: Float32Array, across: Float32Array}} un facteur par ligne.
 */
export function hedgeModulation(path, { offset = 0 } = {}) {
  const rows = path?.length ?? 0;
  const up = new Float32Array(rows);
  const across = new Float32Array(rows);

  for (let r = 0; r < rows; r++) {
    const { x, z } = path[r];
    const s = x * 0.21 + z * 0.13 + offset;
    // Périodes courtes et longues : la longue donne les bouts taillés à des
    // dates différentes, la courte donne le grain.
    const tall =
      Math.sin(s * 0.9) * 0.42 + Math.sin(s * 0.31 + 1.7) * 0.34 + Math.sin(s * 2.3 + 0.6) * 0.24;
    const wide = Math.sin(s * 1.4 + 2.1) * 0.6 + Math.sin(s * 0.47 + 0.4) * 0.4;
    up[r] = 0.76 + (tall * 0.5 + 0.5) * 0.48;
    across[r] = 0.84 + (wide * 0.5 + 0.5) * 0.34;
  }

  return { up, across };
}

/**
 * Ce qui reste de section au tout bout d'une haie, en part de sa section
 * courante. Pas zéro : un anneau réduit à un point rend des triangles plats,
 * dont la normale n'existe pas — et l'ombrage plat d'une haie la lit.
 */
export const HEDGE_NOSE_FLOOR = 0.08;

/**
 * Abscisses des lignes ajoutées dans un bout, en part de sa longueur.
 *
 * Un bout de haie fait un mètre, le tracé est ré-échantillonné tous les
 * soixante-quinze centimètres : sans ces lignes-là, l'arrondi tiendrait sur une
 * ligne et demie, c'est-à-dire sur rien. Resserrées vers la pointe, là où la
 * courbe tourne le plus.
 */
const HEDGE_NOSE_STEPS = [0.05, 0.14, 0.27, 0.45, 0.68];

/** Point d'un tracé à une abscisse curviligne donnée. */
function pointAtDistance(path, distance) {
  const rows = path.length;
  for (let r = 1; r < rows; r++) {
    const a = path[r - 1];
    const b = path[r];
    const span = b.distance - a.distance;
    if (distance > b.distance || span <= 1e-9) continue;
    const t = (distance - a.distance) / span;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, distance };
  }
  return { ...path[rows - 1], distance: path[rows - 1].distance };
}

/**
 * Ajoute des lignes dans les deux bouts d'un tracé de haie, sans toucher au
 * reste ni à sa longueur.
 *
 * C'est la moitié du bout arrondi : `hedgeEndTaper` donne la courbe, celle-ci
 * donne de quoi la dessiner. Séparées parce que la première est une forme et la
 * seconde un pas d'échantillonnage — et parce que le facettage, tiré du sol par
 * `randomAt` sur une maille de cinquante centimètres, doit voir les lignes
 * ajoutées comme les autres : c'est ce qui garde au bout le même grain qu'au
 * corps de la haie, au lieu d'une calotte lisse posée dessus.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path Tracé ré-échantillonné.
 * @param {number} noseM Longueur d'un bout, en mètres.
 * @returns {Array<{x:number,z:number,distance:number}>}
 */
export function hedgeNosePath(path, noseM) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !(noseM > 0)) return path || [];
  const total = path[rows - 1].distance;
  // Une haie courte n'a pas de corps : les deux bouts se partagent tout.
  const nose = Math.min(noseM, total * 0.45);
  if (!(nose > 0)) return path;

  const cuts = [];
  for (const step of HEDGE_NOSE_STEPS) cuts.push(nose * step, total - nose * step);

  const merged = [...path];
  for (const distance of cuts) merged.push(pointAtDistance(path, distance));
  merged.sort((a, b) => a.distance - b.distance);

  // Deux lignes confondues rendent une bande de triangles plats : on garde la
  // première venue.
  const out = [merged[0]];
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].distance - out[out.length - 1].distance > 1e-3) out.push(merged[i]);
  }
  return out;
}

/**
 * Le bout arrondi : facteur de section par ligne, 1 au corps de la haie et un
 * quart d'ellipse sur les derniers `noseM` mètres.
 *
 * Une haie s'arrêtait au couteau, sur un bouchon plat — la section entière
 * tranchée net. Un quart d'ellipse et non une rampe : sa tangente est verticale
 * au bout, donc le bout est **rond** et non conique, ce qui est la différence
 * entre une haie taillée et un crayon.
 *
 * Le même facteur porte la hauteur et la largeur : ce qui rentre, c'est toute
 * la section, sans quoi le bout serait un mur mince au lieu d'un museau.
 *
 * @param {Array<{distance:number}>} path Tracé, `distance` renseignée.
 * @param {number} noseM Longueur d'un bout, en mètres.
 * @param {number} [floor] Section résiduelle à la pointe (`HEDGE_NOSE_FLOOR`).
 * @returns {Float32Array} un facteur par ligne.
 */
export function hedgeEndTaper(path, noseM, floor = HEDGE_NOSE_FLOOR) {
  const rows = path?.length ?? 0;
  const out = new Float32Array(rows).fill(1);
  if (rows < 2 || !(noseM > 0)) return out;

  const total = path[rows - 1].distance;
  const nose = Math.min(noseM, total * 0.45);
  if (!(nose > 0)) return out;

  for (let r = 0; r < rows; r++) {
    out[r] = hedgeNoseFactor(Math.min(path[r].distance, total - path[r].distance), nose, floor);
  }
  return out;
}

/**
 * Le quart d'ellipse lui-même : 0 (plancher) à la pointe, 1 passé `noseM`.
 *
 * @param {number} edgeDistance Distance au bout le plus proche, en mètres.
 * @param {number} noseM
 * @param {number} [floor]
 */
export function hedgeNoseFactor(edgeDistance, noseM, floor = HEDGE_NOSE_FLOOR) {
  if (!(noseM > 0)) return 1;
  const t = Math.min(1, Math.max(0, edgeDistance / noseM));
  return floor + (1 - floor) * Math.sqrt(t * (2 - t));
}

/** Sel réservé aux arêtes facettées, décalé du sel de la famille. */
const FACET_SALT_OFFSET = 30;

/**
 * Le grain d'une haie (`facetJitter`) : hauteur et largeur relatives, et
 * débattement latéral de l'axe en mètres. Modeste par construction : il casse
 * le tube, il ne redessine pas la silhouette de `hedgeModulation`.
 */
export const HEDGE_FACETS = { up: [0.91, 1.09], across: [0.91, 1.09], lateral: [-0.05, 0.05] };

/**
 * Bruit indépendant par ligne du balayage d'une haie, ou d'un rang qui en a
 * la section (vigne, lavande).
 * @param {Array<{x:number,z:number}>} path Polyligne ré-échantillonnée.
 * @param {number} salt Sel de la haie ou du rang appelant (`style.salt`, ou un
 *        sel dédié pour un mobilier qui n'a pas de style).
 * @returns {{up: Float32Array, across: Float32Array, lateral: Float32Array}}
 */
export function hedgeFacets(path, salt) {
  return facetJitter(path, salt + FACET_SALT_OFFSET, HEDGE_FACETS);
}
