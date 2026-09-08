/*
 * hedgeGeometry — une haie lue comme un balayage modulé, ponctué d'arbustes.
 * Un balayage à section constante (`appendProfile`) tient à cent mètres mais
 * se lit comme un tube extrudé à dix mètres — le défaut n'est pas dans la
 * section, il est dans le fait qu'une haie n'est pas une section balayée.
 *
 * Une haie est d'abord une masse continue et irrégulière (hauteur, largeur,
 * silhouette qui varient sans arrêt), ponctuée d'accents. D'où deux moitiés :
 * `hedgeModulation` module le balayage ligne par ligne (porte la haie de loin
 * comme de près) ; `hedgeClumps`/`appendHedgeClump` posent quelques arbustes
 * espacés dans le champ proche seulement — trop nombreux ou trop serrés, ils
 * redonnent le défaut qu'ils corrigent. Le balayage reste dominant même de
 * près (`coreScale` proche de 1) : rien ne bascule d'une silhouette à l'autre.
 *
 * L'arbuste réemploie la masse facettée du buisson de jardin
 * (`gardenLayer.appendBush`) et de la houppe isolée (`furnitureKit.Kit.rock`),
 * rendue anisotrope et écrite dans l'accumulateur du balayage (pas de matière
 * ni de tirage en plus). Tirages ancrés au sol (`randomAt`) partout.
 *
 * Grain low poly : `hedgeModulation` module en continu (courbe lisse même
 * finement échantillonnée), `facetJitter` fait l'inverse (tirage indépendant
 * par ligne, sans corrélation) — associé à un maillage non lissé, ça donne de
 * vraies arêtes. L'espacement des arêtes vient du pas de ré-échantillonnage
 * du tracé (`HEDGE_SAMPLE_M`), pas d'un réglage de cette fonction.
 *
 * Les bouts, enfin. Une haie s'arrêtait sur le bouchon plat que pose
 * `appendProfile` — sa section entière tranchée net, ce qui se lit comme un
 * tube coupé. Elle rentre maintenant en museau : `hedgeNosePath` ajoute des
 * lignes dans les derniers mètres (à soixante-quinze centimètres de pas,
 * l'arrondi tiendrait sur une ligne et demie) et `hedgeEndTaper` y resserre
 * toute la section en quart d'ellipse — tangente verticale au bout, donc un
 * bout **rond** et non conique. Les arbustes rentrent avec lui
 * (`hedgeNoseFactor`), sinon le dernier accent ressortirait du museau et
 * rendrait la coupe franche. Le facettage, lui, est calculé après la
 * densification et sur les mêmes lignes : le museau a le grain du corps de la
 * haie, il n'est pas une calotte lisse rapportée.
 */

import { randomAt, spacedAlongPath } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Pas de ré-échantillonnage d'une haie, en mètres — double emploi assumé avec
 * l'espacement des arêtes facettées (`facetJitter`).
 */
export const HEDGE_SAMPLE_M = 0.75;

/**
 * Jusqu'où une haie est détaillée, par famille — un budget, pas un choix
 * esthétique, donc hors thème (où vivent les cotes de l'arbuste lui-même).
 */
export const HEDGE_DETAIL = {
  hedge: { detailRadiusM: 135, fadeM: 45 },
  lowHedge: { detailRadiusM: 75, fadeM: 25 },
};

/**
 * Réglages complets d'une famille de haie : ses cotes (thème) et son budget de détail.
 * @param {string} kind `hedge` ou `lowHedge`.
 * @param {Object} [shapes] Tranche `theme.furniture.hedges`.
 */
export function hedgeStyleFor(kind, shapes = defaultTheme.furniture.hedges) {
  const shape = shapes?.[kind] ?? defaultTheme.furniture.hedges[kind];
  return { ...shape, ...HEDGE_DETAIL[kind] };
}

/** Réglages par défaut, prêts à l'emploi — le repli de toutes les fonctions. */
export const HEDGE_STYLES = {
  hedge: hedgeStyleFor('hedge'),
  lowHedge: hedgeStyleFor('lowHedge'),
};

/** Mélange linéaire de deux couleurs. */
function blend(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Interpolation linéaire bornée. */
function mix(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * k;
}

/**
 * Part de « champ proche » en un point : 1 tout près, 0 au-delà de la portée
 * de détail. Sans observateur (`here` nul), traitée comme lointaine.
 */
export function hedgeNearness(x, z, here, style) {
  if (!here) return 0;
  const distance = Math.hypot(x - here.x, z - here.z);
  const outer = style.detailRadiusM;
  const inner = Math.max(0, outer - style.fadeM);
  if (distance >= outer) return 0;
  if (distance <= inner) return 1;
  return (outer - distance) / (outer - inner);
}

/**
 * Hauteur et largeur relatives du balayage, ligne par ligne. Trois choses
 * superposées : le relief (deux ondes de périodes incommensurables, tirées du
 * sol), la largeur (même idée en travers), et l'effacement de près (sous les
 * arbustes, le balayage n'est plus la silhouette mais la masse sombre qui
 * bouche le fond — le laisser à pleine hauteur dépasserait leur tête).
 *
 * @param {Array<{x:number,z:number}>} path Polyligne ré-échantillonnée.
 * @param {Object} [options]
 * @param {number} [options.offset] Décalage latéral de l'axe de balayage.
 * @param {{x:number,z:number}|null} [options.here] Position de l'observateur.
 * @param {Object} [options.style] Entrée de `HEDGE_STYLES`.
 * @returns {{up: Float32Array, across: Float32Array}} un facteur par ligne.
 */
export function hedgeModulation(path, { offset = 0, here = null, style = HEDGE_STYLES.hedge } = {}) {
  const rows = path?.length ?? 0;
  const up = new Float32Array(rows);
  const across = new Float32Array(rows);

  for (let r = 0; r < rows; r++) {
    const { x, z } = path[r];
    const s = x * 0.21 + z * 0.13 + offset;
    // Périodes courtes et longues : la longue donne les bouts taillés à des
    // dates différentes, la courte donne le grain d'arbuste.
    const tall =
      Math.sin(s * 0.9) * 0.42 + Math.sin(s * 0.31 + 1.7) * 0.34 + Math.sin(s * 2.3 + 0.6) * 0.24;
    const wide = Math.sin(s * 1.4 + 2.1) * 0.6 + Math.sin(s * 0.47 + 0.4) * 0.4;

    const near = hedgeNearness(x, z, here, style);
    up[r] = (0.76 + (tall * 0.5 + 0.5) * 0.48) * mix(1, style.coreScale, near);
    across[r] = (0.84 + (wide * 0.5 + 0.5) * 0.34) * mix(1, style.coreWidth, near);
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
 * Séparé parce que le balayage l'applique ligne par ligne et les arbustes
 * arbuste par arbuste — un accent posé au ras du bout doit rentrer avec le
 * museau, sinon il en ressort et le bout redevient franc.
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

/** Sel réservé aux arêtes facettées, décalé de celui des arbustes (`hedgeClumps` va jusqu'à `salt + 18`). */
const FACET_SALT_OFFSET = 30;

/**
 * Bruit indépendant par ligne du balayage, sans rapport avec ses voisines
 * (contrairement aux ondes de `hedgeModulation`, qui restent une courbe).
 * C'est ce bruit qui fait les arêtes. Reste modeste par construction
 * (`upAmp`, `acrossAmp`, `lateralM`) : il casse le tube, il ne redessine pas
 * la silhouette de `hedgeModulation`.
 *
 * @param {Array<{x:number,z:number}>} path Polyligne ré-échantillonnée ; son
 *        pas fixe l'espacement des arêtes (voir `HEDGE_SAMPLE_M`).
 * @param {number} salt Sel de la haie ou du rang appelant (`style.salt`, ou un
 *        sel dédié pour un mobilier qui n'a pas de style).
 * @param {Object} [options]
 * @param {number} [options.upAmp] Amplitude relative sur la hauteur (0.09 = ±9 %).
 * @param {number} [options.acrossAmp] Amplitude relative sur la largeur.
 * @param {number} [options.lateralM] Débattement latéral de l'axe, en mètres.
 * @returns {{up: Float32Array, across: Float32Array, lateral: Float32Array}}
 */
export function facetJitter(path, salt, { upAmp = 0.09, acrossAmp = 0.09, lateralM = 0.05 } = {}) {
  const rows = path?.length ?? 0;
  const up = new Float32Array(rows);
  const across = new Float32Array(rows);
  const lateral = new Float32Array(rows);

  for (let r = 0; r < rows; r++) {
    const { x, z } = path[r];
    up[r] = 1 + (randomAt(x, z, salt + FACET_SALT_OFFSET) - 0.5) * 2 * upAmp;
    across[r] = 1 + (randomAt(x, z, salt + FACET_SALT_OFFSET + 1) - 0.5) * 2 * acrossAmp;
    lateral[r] = (randomAt(x, z, salt + FACET_SALT_OFFSET + 2) - 0.5) * 2 * lateralM;
  }

  return { up, across, lateral };
}

/**
 * Les quelques arbustes qui accentuent une haie, le long de son tracé.
 * Espacés (`spacingM` très supérieur au diamètre d'un arbuste), et glissant
 * le long du tracé et de l'axe plutôt que posés pile sur l'écartement nominal
 * (sinon plantation en pot). Trois irrégularités en plus des tailles : une
 * part sautée (`gapChance`), une part échappée (`standardChance`, un
 * baliveau plus haut), chacun tourné sur lui-même.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {Object} [options]
 * @param {number} [options.offset] Décalage latéral de l'axe.
 * @param {{x:number,z:number}|null} [options.here] Position de l'observateur.
 * @param {Object} [options.style] Entrée de `HEDGE_STYLES`.
 * @param {number} [options.startDistance] Distance déjà parcourue avant le
 *        premier point du tronçon, depuis son nœud d'ancrage (sans elle, les
 *        arbustes glisseraient d'une reconstruction à l'autre).
 * @param {number} [options.limit] Plafond d'arbustes rendus.
 * @returns {Array<Object>} arbustes, dans l'ordre du tracé.
 */
export function hedgeClumps(
  path,
  { offset = 0, here = null, style = HEDGE_STYLES.hedge, startDistance = 0, limit = Infinity } = {}
) {
  const out = [];
  if (!here || limit <= 0) return out;

  const salt = style.salt;
  const total = path?.[path.length - 1]?.distance ?? 0;
  // Un arbuste tient de la place le long du tracé : pour qu'il reste **dans**
  // le museau, il commence à rentrer une demi-longueur d'arbuste plus tôt que
  // le balayage.
  const reach = style.noseM > 0 ? Math.min(style.noseM + style.alongM[1], total * 0.45) : 0;

  // Aucune marge aux deux bouts : deux tronçons consécutifs se rejoignent.
  for (const point of spacedAlongPath(path, style.spacingM, { startDistance, margin: 0 })) {
    if (out.length >= limit) break;
    const px = point.tz;
    const pz = -point.tx;

    // Tirage pris sur la position nominale, avant glissement.
    const slide = (randomAt(point.x, point.z, salt) - 0.5) * style.spacingM * 0.7;
    const side = (randomAt(point.x, point.z, salt + 2) - 0.5) * 2 * style.lateralM;
    const lateral = offset + side;

    const x = point.x + point.tx * slide + px * lateral;
    const z = point.z + point.tz * slide + pz * lateral;

    if (hedgeNearness(x, z, here, style) <= 0) continue;
    if (randomAt(point.x, point.z, salt + 4) < style.gapChance) continue;

    const grown = randomAt(point.x, point.z, salt + 6) < style.standardChance;
    const nose = hedgeNoseFactor(Math.min(point.distance + slide, total - point.distance - slide), reach);
    const scale = (grown ? style.standardScale : 1) * nose;
    const height =
      (style.heightM[0] + randomAt(point.x, point.z, salt + 8) * (style.heightM[1] - style.heightM[0])) * scale;
    // Un arbuste échappé grossit aussi en plan (moins vite qu'en hauteur, sinon effet sucette).
    const along =
      (style.alongM[0] + randomAt(point.x, point.z, salt + 10) * (style.alongM[1] - style.alongM[0])) *
      (grown ? 1.25 : 1) *
      nose;
    const acrossRadius =
      (style.acrossM[0] + randomAt(point.x, point.z, salt + 12) * (style.acrossM[1] - style.acrossM[0])) *
      (grown ? 1.18 : 1) *
      nose;

    out.push({
      x,
      z,
      // Repère de l'arbuste : allongé le long de la marche, mince en travers.
      ax: point.tx,
      az: point.tz,
      px,
      pz,
      height,
      along,
      across: acrossRadius,
      sides: style.sides,
      phase: randomAt(point.x, point.z, salt + 14) * Math.PI * 2, // déphasage du contour
      seed: salt + Math.floor(randomAt(point.x, point.z, salt + 16) * 4096),
      tone: randomAt(point.x, point.z, salt + 18), // teinte propre, sinon aplat de vert
    });
  }

  return out;
}

/**
 * Écrit un arbuste dans un accumulateur de sections (`createProfileBuffer`).
 * Trois couronnes et une pointe (pied étroit, ventre débordant, épaule
 * rentrante, sommet décalé — un apex centré donnerait un cône).
 *
 * @param {Object} buffer Accumulateur (`createProfileBuffer`).
 * @param {Object} clump  Un élément de `hedgeClumps`.
 * @param {Object} options
 * @param {number} options.ground Altitude du pied.
 * @param {Object} [options.colors] Feuillage du thème (`theme.furniture.colors`).
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendHedgeClump(buffer, clump, { ground, colors = defaultTheme.furniture.colors }) {
  const { x, z, ax, az, px, pz, height, along, across, sides, phase, seed, tone } = clump;
  if (!Number.isFinite(ground) || !(height > 0) || sides < 3) return false;

  const base = buffer.positions.length / 3;
  // Pied sombre, crête éclairée, décalés par la teinte propre à l'arbuste.
  const foot = blend(colors.leafDeep, colors.leafBlue, tone * 0.7);
  const crown = blend(colors.leafOlive, colors.leafSpring, tone);
  const belly = blend(foot, crown, 0.5);

  /** Cotes et rayons relatifs des trois couronnes : pied, ventre, épaule (haute et large pour éviter l'effet cône). */
  const levels = [
    { t: 0.02, r: 0.66, color: foot },
    { t: 0.42, r: 1, color: belly },
    { t: 0.78, r: 0.74, color: crown },
  ];

  for (const level of levels) {
    for (let i = 0; i < sides; i++) {
      const angle = phase + (i / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Bruit pris sur le sommet lui-même (stable d'une reconstruction à l'autre).
      const jitter = 0.74 + randomAt(x + cos * along, z + sin * across, seed + i) * 0.52;
      const ra = along * level.r * jitter;
      const rc = across * level.r * jitter;
      const dx = ax * cos * ra + px * sin * rc;
      const dz = az * cos * ra + pz * sin * rc;
      const lift = height * level.t * (0.86 + randomAt(x + dx, z + dz, seed + 64 + i) * 0.3);
      buffer.positions.push(x + dx, ground + lift, z + dz);
      buffer.colors.push(level.color[0], level.color[1], level.color[2]);
    }
  }

  const leanA = (randomAt(x, z, seed + 128) - 0.5) * along * 0.7;
  const leanC = (randomAt(x, z, seed + 130) - 0.5) * across * 0.6;
  buffer.positions.push(x + ax * leanA + px * leanC, ground + height, z + az * leanA + pz * leanC);
  buffer.colors.push(crown[0], crown[1], crown[2]);
  const apex = base + levels.length * sides;

  for (let l = 0; l < levels.length - 1; l++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = base + l * sides + i;
      const b = base + l * sides + j;
      const c = base + (l + 1) * sides + i;
      const d = base + (l + 1) * sides + j;
      buffer.indices.push(a, c, b, b, c, d);
    }
  }
  const top = base + (levels.length - 1) * sides;
  for (let i = 0; i < sides; i++) {
    buffer.indices.push(top + i, apex, top + ((i + 1) % sides));
  }

  return true;
}

/**
 * Pose les arbustes d'une haie dans son propre maillage (même accumulateur
 * que le balayage : une haie reste une seule géométrie, une matière, un appel de dessin).
 * @returns {number} nombre d'arbustes posés.
 */
export function appendHedgeClumps(
  buffer,
  {
    path,
    offset = 0,
    here = null,
    style = HEDGE_STYLES.hedge,
    sampleElevation,
    lift = 0,
    colors,
    startDistance = 0,
    limit = Infinity,
  }
) {
  const clumps = hedgeClumps(path, { offset, here, style, startDistance, limit });
  let placed = 0;
  for (const clump of clumps) {
    const ground = sampleElevation(clump.x, clump.z) + lift;
    if (appendHedgeClump(buffer, clump, { ground, colors })) placed++;
  }
  return placed;
}
