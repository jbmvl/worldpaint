/*
 * hedgeGeometry — une haie lue comme un balayage modulé, ponctué d'arbustes.
 * ----------------------------------------------------------------------------
 * Une haie balayée le long de sa polyligne (`appendProfile`) tient très bien à
 * cent mètres : la masse est là, la limite de parcelle se lit, le bocage se
 * dessine. Elle tient beaucoup moins bien à dix mètres, et le défaut est
 * toujours le même — c'est un **tube extrudé**. Sa section est constante, sa
 * crête est une ligne, son ombre est un ruban. Aucun réglage de la section ne
 * corrige ça, parce que le défaut n'est pas dans la section : il est dans le
 * fait qu'une haie n'est pas une section balayée.
 *
 * ## Ce qu'est une haie
 *
 * Une masse continue et irrégulière — hauteur qui respire, flancs qui
 * épaississent et s'amincissent, silhouette jamais lisse —, ponctuée çà et là
 * d'un arbuste qui dépasse ou d'un baliveau qu'on n'a pas coupé. **L'essentiel
 * de la lecture, de loin comme de près, vient de la première** : une haie
 * n'est presque jamais un rang régulier d'individus qu'on distingue un à un,
 * c'est une masse dont la crête et l'épaisseur varient sans arrêt. L'arbuste
 * n'est qu'un accent, pas la matière de la haie.
 *
 * D'où les deux moitiés de ce module, qui répondent chacune à un rôle :
 *
 * - `hedgeModulation` module le **balayage** — hauteur et largeur, ligne par
 *   ligne, sur des périodes courtes autant que longues. C'est ce qui porte
 *   la haie, de loin *et* de près, et c'est presque gratuit.
 * - `hedgeClumps` / `appendHedgeClump` posent quelques **arbustes**, dans le
 *   seul champ proche et **espacés** (`spacingM` très supérieur à `alongM`) :
 *   ce sont des accents qu'on remarque en passant, pas un rang qui recouvre le
 *   balayage. En poser trop, ou trop serrés, redonne le défaut qu'ils étaient
 *   censés corriger — une texture uniforme, faite de bosses au lieu d'être un
 *   tube.
 *
 * Le raccord entre les deux n'est pas un basculement : le balayage reste
 * dominant même dans le champ proche (`coreScale` proche de 1), et les
 * arbustes ne font qu'y ajouter un relief occasionnel. Rien ne bascule d'une
 * silhouette à l'autre en s'approchant.
 *
 * ## Ce qui est réemployé
 *
 * L'arbuste n'est pas une forme nouvelle : c'est la masse facettée irrégulière
 * qui sert déjà de buisson de jardin (`gardenLayer.appendBush`) et de houppe
 * d'arbre isolé (`furnitureKit.Kit.rock`). Ce qui change ici est qu'elle est
 * **anisotrope** — allongée le long du tracé, mince en travers — et qu'elle
 * s'écrit dans l'accumulateur de sections (`createProfileBuffer`), donc dans le
 * maillage de la haie elle-même : pas de matière de plus, pas de tirage de plus.
 *
 * Tous les tirages sont **ancrés au sol** (`randomAt`) : la même haie repousse
 * identique à elle-même d'une reconstruction à l'autre, comme tout le reste du
 * décor.
 *
 * ## Le grain low poly
 *
 * `hedgeModulation` module en continu : deux points voisins du balayage n'ont
 * jamais tout à fait la même hauteur, mais l'un se déduit de l'autre par une
 * courbe — donc lisse, aussi finement qu'on l'échantillonne. `facetJitter` fait
 * l'inverse : un tirage **indépendant par ligne**, sans corrélation avec ses
 * voisines. Associé à un maillage non lissé (`toColoredGeometry({ flat: true
 * })`, décidé par l'appelant), c'est ce qui donne de vraies arêtes plutôt
 * qu'une courbe adoucie — la matière qui manquait à la haie, au rang de vigne
 * et à leurs arbustes, tous trois lus jusqu'ici comme des tubes ou des boules
 * lisses. L'espacement des arêtes n'est pas un réglage de cette fonction : il
 * vient du pas de ré-échantillonnage du tracé (`HEDGE_SAMPLE_M`).
 */

import { randomAt, spacedAlongPath } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Pas de ré-échantillonnage d'une haie, en mètres.
 *
 * Double emploi assumé : c'est le pas d'un simple ruban, mais c'est aussi
 * l'espacement des arêtes facettées (`facetJitter`) — chaque ligne du balayage
 * reçoit un tirage indépendant, donc une ligne tous les 75 cm est une arête
 * tous les 75 cm. Le rang de vigne, qui n'a pas son propre pas, réemploie
 * celui-ci pour la même raison.
 */
export const HEDGE_SAMPLE_M = 0.75;

/**
 * Jusqu'où une haie est détaillée, par famille. C'est un **budget**, pas un
 * choix esthétique : il dit à quelle distance les arbustes cessent de payer
 * leurs triangles, et sur quelle largeur le balayage rend la main. Il reste
 * donc ici et non dans le thème, où vivent les cotes de l'arbuste lui-même.
 *
 * Une haie de bocage se détaille plus loin qu'une haie basse, simplement parce
 * qu'elle est plus haute et se voit de plus loin.
 */
export const HEDGE_DETAIL = {
  hedge: { detailRadiusM: 135, fadeM: 45 },
  lowHedge: { detailRadiusM: 75, fadeM: 25 },
};

/**
 * Réglages complets d'une famille de haie : ses cotes, tirées du thème, et son
 * budget de détail. Les deux ne se mélangent nulle part ailleurs.
 *
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
 * Part de « champ proche » en un point : 1 tout près, 0 au-delà de la portée de
 * détail. C'est elle qui baisse le balayage et qui décide où poser des arbustes.
 *
 * Fonction pure. Sans observateur (`here` nul), la haie est traitée comme
 * lointaine : c'est le comportement d'avant ce module, donc le repli sûr.
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
 * Hauteur et largeur relatives du balayage, ligne par ligne.
 *
 * Trois choses s'y superposent, et c'est voulu :
 *
 * 1. **Le relief** — deux ondes de périodes incommensurables tirées de la
 *    position au sol. Une haie n'a pas la même hauteur sur deux cents mètres :
 *    elle est taillée par bouts, trouée par un passage, plus haute là où un
 *    arbre s'y est installé.
 * 2. **La largeur** — la même idée en travers, sur d'autres périodes : une haie
 *    épaissit et s'amincit, et deux flancs rigoureusement parallèles sur deux
 *    cents mètres sont ce qui la fait lire comme un ruban.
 * 3. **L'effacement de près** — sous les arbustes, le balayage n'est plus la
 *    silhouette, il n'est que la masse sombre qui bouche le fond. Le laisser à
 *    pleine hauteur lui ferait dépasser la tête des arbustes en une crête lisse,
 *    et tout le travail serait perdu.
 *
 * Fonction pure, déterministe, ancrée au sol.
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
    // Périodes courtes autant que longues : la longue donne les bouts taillés
    // à des dates différentes, la courte donne le grain d'arbuste. Sans la
    // courte, la crête reste lisse sur vingt mètres, ce qui est la moitié du
    // défaut qu'on corrige ici.
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
 * Sel réservé aux arêtes facettées : décalé de celui des arbustes
 * (`hedgeClumps` va jusqu'à `salt + 18`) pour qu'aucun sommet ne tire deux
 * fois la même valeur pour deux raisons différentes.
 */
const FACET_SALT_OFFSET = 30;

/**
 * Bruit indépendant par ligne du balayage, sans rapport avec ses voisines —
 * contrairement aux ondes de `hedgeModulation`, qui restent une courbe quelle
 * que soit la finesse d'échantillonnage. C'est ce bruit-là qui fait les
 * arêtes : une échelle qui saute d'une ligne à l'autre, plutôt qu'une échelle
 * qui varie en douceur.
 *
 * Reste modeste par construction (`upAmp`, `acrossAmp`, `lateralM`) : il
 * casse le tube, il ne redessine pas la silhouette que porte déjà
 * `hedgeModulation`.
 *
 * Fonction pure, ancrée au sol (`randomAt`) comme le reste du module.
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
 *
 * Ce sont des **accents**, espacés (`spacingM`, très supérieur au diamètre
 * d'un arbuste) : la haie n'en est pas recouverte, elle en est ponctuée. C'est
 * ce qui les distingue d'un rang de plantation — un arbuste tous les six ou
 * sept mètres se remarque en passant, un arbuste tous les deux mètres devient
 * une texture, et c'est le défaut qu'on corrige en les espaçant.
 *
 * L'écartement nominal vient du style, mais aucun arbuste ne tombe dessus : il
 * glisse le long du tracé et de part et d'autre de l'axe — un alignement
 * rigoureux se lit comme une plantation en pot.
 *
 * Trois irrégularités, en plus des tailles :
 *
 * - une part d'arbustes est **sautée** (`gapChance`) — de vrais intervalles
 *   nus, où seul le balayage modulé porte la haie ;
 * - une part plus rare est **échappée** (`standardChance`), une fois et demie
 *   plus haute que ses voisins : c'est le baliveau qu'on n'a pas coupé ;
 * - chacun est **tourné** sur lui-même, donc deux arbustes de même taille n'ont
 *   pas la même silhouette.
 *
 * Fonction pure : elle décrit, elle ne dessine pas.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path
 * @param {Object} [options]
 * @param {number} [options.offset] Décalage latéral de l'axe.
 * @param {{x:number,z:number}|null} [options.here] Position de l'observateur.
 * @param {Object} [options.style] Entrée de `HEDGE_STYLES`.
 * @param {number} [options.startDistance] Distance déjà parcourue avant le
 *        premier point du tronçon, depuis son nœud d'ancrage. Sans elle, un
 *        tronçon de route redécoupé ailleurs recommencerait sa numérotation à
 *        zéro et **tous les arbustes glisseraient** d'une reconstruction à
 *        l'autre — la haie se replanterait sous les yeux de l'observateur.
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
  // Aucune marge aux deux bouts : deux tronçons consécutifs d'une même haie se
  // rejoignent, ils ne se laissent pas un blanc.
  for (const point of spacedAlongPath(path, style.spacingM, { startDistance, margin: 0 })) {
    if (out.length >= limit) break;
    // Perpendiculaire à gauche de la marche, comme partout ailleurs.
    const px = point.tz;
    const pz = -point.tx;

    // Glissement le long du tracé avant tout le reste : le tirage doit être pris
    // sur la position **nominale**, sinon deux reconstructions décalées d'un
    // demi-pas donneraient deux haies différentes.
    const slide = (randomAt(point.x, point.z, salt) - 0.5) * style.spacingM * 0.7;
    const side = (randomAt(point.x, point.z, salt + 2) - 0.5) * 2 * style.lateralM;
    const lateral = offset + side;

    const x = point.x + point.tx * slide + px * lateral;
    const z = point.z + point.tz * slide + pz * lateral;

    if (hedgeNearness(x, z, here, style) <= 0) continue;
    if (randomAt(point.x, point.z, salt + 4) < style.gapChance) continue;

    const grown = randomAt(point.x, point.z, salt + 6) < style.standardChance;
    const scale = grown ? style.standardScale : 1;
    const height =
      (style.heightM[0] + randomAt(point.x, point.z, salt + 8) * (style.heightM[1] - style.heightM[0])) * scale;
    // Un arbuste échappé grossit aussi en plan, et moins vite qu'en hauteur :
    // le faire monter seul donnerait une sucette plantée dans la haie.
    const along =
      (style.alongM[0] + randomAt(point.x, point.z, salt + 10) * (style.alongM[1] - style.alongM[0])) *
      (grown ? 1.25 : 1);
    const acrossRadius =
      (style.acrossM[0] + randomAt(point.x, point.z, salt + 12) * (style.acrossM[1] - style.acrossM[0])) *
      (grown ? 1.18 : 1);

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
      // Déphasage du contour : sans lui, tous les arbustes montrent la même
      // facette à la caméra et l'alignement redevient un peigne.
      phase: randomAt(point.x, point.z, salt + 14) * Math.PI * 2,
      seed: salt + Math.floor(randomAt(point.x, point.z, salt + 16) * 4096),
      // Teinte propre : un rang d'arbustes exactement du même vert est un
      // aplat, quelle que soit la finesse des silhouettes.
      tone: randomAt(point.x, point.z, salt + 18),
    });
  }

  return out;
}

/**
 * Écrit un arbuste dans un accumulateur de sections (`createProfileBuffer`).
 *
 * Trois couronnes et une pointe : pied étroit, ventre débordant, épaule
 * rentrante, sommet décalé. C'est la silhouette d'un arbuste taillé, et elle
 * suffit — personne n'en compte les facettes. Ce qui compte est qu'aucun ne
 * soit identique au voisin : les rayons et les cotes sont bruités par sommet.
 *
 * Le sommet n'est pas d'aplomb sur le centre : un apex centré donne un cône, et
 * un cône ne ressemble à rien de végétal.
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
  // Pied sombre, crête éclairée : la même règle que toutes les sections du
  // catalogue. La teinte propre à l'arbuste décale les deux du même écart.
  const foot = blend(colors.leafDeep, colors.leafBlue, tone * 0.7);
  const crown = blend(colors.leafOlive, colors.leafSpring, tone);
  const belly = blend(foot, crown, 0.5);

  /**
   * Cotes et rayons relatifs des trois couronnes : pied, ventre, épaule.
   *
   * L'épaule est haute et encore large : descendue ou resserrée, elle laisse la
   * pointe faire un cône, et un rang de cônes ne se lit pas comme une haie mais
   * comme une haie de cyprès taillés.
   */
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
      // Bruit pris sur le sommet lui-même : deux arbustes voisins ne peuvent pas
      // hériter du même contour, et le même sommet reste stable d'une
      // reconstruction à l'autre.
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

  // Sommet décalé dans le repère de l'arbuste, jamais d'aplomb sur le centre.
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
 * Pose les arbustes d'une haie dans son propre maillage.
 *
 * Ils vont dans le **même** accumulateur que le balayage : une haie reste une
 * seule géométrie, une seule matière, un seul appel de dessin. C'est ce qui
 * autorise à en poser quelques centaines sans rien coûter de plus qu'avant.
 *
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
