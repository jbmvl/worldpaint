/*
 * lowPolyForest — la géométrie en volume d'une essence de forêt.
 * -----------------------------------------------------------------
 * `vegetationLayer` plantait des arbres de bois en panneaux croisés (deux
 * quadrilatères texturés) : quatre triangles, un atlas peint, une silhouette
 * qui se lit bien mais reste un cutout — elle se trahit dès qu'on la longe.
 * Ce module construit à la place un petit volume facetté, dans le même style
 * « low poly » que les arbres de bord de route (`furnitureKit.Kit.treeBroad`,
 * `.treeConifer`) : tronc balayé, houppe en plusieurs masses irrégulières à
 * normales de face — jamais lissées. **C'est littéralement le même modèle** :
 * même méthode (`Kit.rock`, `Kit.cylinder`), même nuancier de feuillage
 * (`theme.furniture.colors` — `leafDeep`, `leafOlive`, `leafSpring`,
 * `leafBlue`), adapté à un budget de triangles plus serré parce qu'une tuile
 * en plante des centaines là où une route en plante une poignée.
 *
 * ## Plusieurs masses, pas une boule
 *
 * Une houppe faite d'un seul volume facetté se lit comme un caillou vert :
 * `treeBroad` le corrige en superposant trois rochers décentrés, et ce module
 * fait de même en plus modeste (deux) pour les feuillus et les buissons — le
 * conifère, lui, reprend la structure à trois étages de `treeConifer`, qui
 * est **le** modèle d'un sapin dans ce nuancier : un fût, puis des étages qui
 * rétrécissent et se referment en pointe.
 *
 * ## La couleur : le nuancier du mobilier, pas l'ancien atlas
 *
 * Une première version dérivait la teinte de chaque essence de la formule de
 * luminance des anciens peintres d'atlas (46 à 120 sur 255, hue multiplicatif
 * proche de 1) — beaucoup trop sombre et trop resserré : neuf essences
 * rendaient des verts quasi identiques, et aucune ne s'approchait de la masse
 * verte franche d'un `treeBroad`. Chaque essence pioche donc maintenant dans
 * les mêmes quatre feuillages que le mobilier (`ESSENCE_LEAF_PAIRS`), avec une
 * rotation propre à chaque case du kit pour qu'aucune des neuf ne porte
 * exactement le même mélange. La variété **entre arbres d'une même essence**
 * reste le rôle de la teinte d'instance (`vegetationLayer.foliageTint`), qui
 * multiplie cette base — les deux ne se contredisent pas, ils se superposent
 * comme ils le faisaient avant avec l'atlas peint.
 */

import { Kit } from './furnitureKit.js';
import { defaultTheme } from '../themes/default.js';

/** Segments radiaux du tronc — un pilier, jamais la silhouette d'un arbre. */
const TRUNK_RADIAL = 5;
/** Écorce : reprise du mobilier (`furnitureKit.treeBroad`/`treeConifer`). */
const TRUNK_COLOR_KEY = 'bark';

/**
 * Paires (pied, sommet) par essence, dans l'ordre de `TREE_VARIANTS` — une ou
 * plusieurs par essence selon le nombre de masses que son genre pose
 * (`buildEssenceGeometry`). Toutes puisées dans `theme.furniture.colors`,
 * jamais des couleurs propres à ce module : c'est ce qui garde un feuillu de
 * forêt et un feuillu de bord de route dans le même nuancier.
 */
const ESSENCE_LEAF_PAIRS = [
  // 0-2 : feuillus — deux masses décentrées, comme `treeBroad` (réduit de
  // trois à deux : une tuile en plante des centaines, une route une poignée).
  [
    ['leafDeep', 'leafOlive'],
    ['leafOlive', 'leafSpring'],
  ],
  [
    ['leafBlue', 'leafOlive'],
    ['leafOlive', 'leafSpring'],
  ],
  [
    ['leafDeep', 'leafSpring'],
    ['leafOlive', 'leafSpring'],
  ],
  // 3-4 : fuseaux — une seule masse, étroite et haute.
  [['leafOlive', 'leafSpring']],
  [['leafBlue', 'leafSpring']],
  // 5-6 : conifères — trois étages, la structure de `treeConifer` reprise
  // telle quelle (voir sa note : « fût droit, trois étages de plus en plus
  // courts »).
  [
    ['leafDeep', 'leafBlue'],
    ['leafBlue', 'leafDeep'],
    ['leafDeep', 'leafOlive'],
  ],
  [
    ['leafBlue', 'leafDeep'],
    ['leafDeep', 'leafBlue'],
    ['leafBlue', 'leafOlive'],
  ],
  // 7-8 : buissonnants — deux masses basses, sans fût dégagé.
  [
    ['leafDeep', 'leafOlive'],
    ['leafOlive', 'leafSpring'],
  ],
  [
    ['leafBlue', 'leafOlive'],
    ['leafOlive', 'leafSpring'],
  ],
];

/**
 * Construit le volume d'une essence, normalisé : pied du tronc à `y = 0`,
 * sommet de la houppe à `y = 1`, emprise en plan de l'ordre de ±0,5. Une
 * instance l'échelonne ensuite comme elle échelonnait un panneau
 * (`_scale.set(height * aspect, height, height * aspect)`) : le rapport
 * largeur/hauteur reste donc le même levier qu'avant.
 *
 * @param {Object} THREE
 * @param {Object} variant Entrée de `TREE_VARIANTS` (`kind`, `trunk`,
 *        `crownBase`, `spread`).
 * @param {number} index Indice du variant dans `TREE_VARIANTS` — choisit sa
 *        paire de feuillage (`ESSENCE_LEAF_PAIRS`) et sème le bruit du
 *        contour, pour que deux essences voisines ne partagent ni la même
 *        couleur ni le même contour.
 * @param {Object} [colors] `theme.furniture.colors`.
 */
export function buildEssenceGeometry(THREE, variant, index, colors = defaultTheme.furniture.colors) {
  const k = new Kit(colors);
  const pairs = (ESSENCE_LEAF_PAIRS[index] || ESSENCE_LEAF_PAIRS[0]).map(([foot, tip]) => [
    colors[foot] || colors.leafDeep,
    colors[tip] || colors.leafSpring,
  ]);
  const trunkTop = Math.min(0.85, Math.max(0.12, variant.crownBase * 0.82));
  const trunkRadius = 0.05 + variant.trunk * 0.24;
  const crownHeight = 1 - trunkTop;
  const radius = Math.max(0.2, variant.spread * 1.35);
  const seed = 4001 + index * 97;

  k.cylinder({
    radiusBottom: trunkRadius,
    radiusTop: trunkRadius * 0.72,
    height: trunkTop,
    radial: TRUNK_RADIAL,
    color: colors[TRUNK_COLOR_KEY] || colors.wood,
    cap: false,
  });

  if (variant.kind === 'conifer') {
    // Trois étages qui rétrécissent et plongent, exactement la structure de
    // `Kit.treeConifer` : c'est **le** modèle d'un sapin dans ce nuancier.
    const heights = [crownHeight * 0.42, crownHeight * 0.34, crownHeight * 0.24];
    const radii = [radius, radius * 0.68, radius * 0.38];
    let y = trunkTop;
    heights.forEach((h, i) => {
      const isLast = i === heights.length - 1;
      const [foot, tip] = pairs[i] || pairs[pairs.length - 1];
      k.cylinder({
        radiusBottom: radii[i],
        radiusTop: isLast ? 0 : radii[i + 1] * 1.05,
        height: h,
        radial: 7,
        y,
        color: foot,
        colorTop: tip,
        cap: false,
      });
      y += h;
    });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  if (variant.kind === 'bushy') {
    // Pas de tronc dégagé : les masses partent quasiment du sol, comme un
    // taillis. Le tronc déjà posé reste utile — il ancre la base — mais la
    // houppe le recouvre presque entièrement.
    const base = Math.max(0, trunkTop - crownHeight * 0.3);
    const full = 1 - base;
    const [foot0, tip0] = pairs[0];
    const [foot1, tip1] = pairs[1] || pairs[0];
    k.rock({ radius: radius * 0.95, height: full * 0.85, sides: 6, rings: 1, seed, y: base, color: foot0, colorTop: tip0 });
    k.rock({
      radius: radius * 0.68,
      height: full * 0.7,
      sides: 5,
      rings: 1,
      seed: seed + 41,
      x: radius * 0.4,
      z: radius * 0.28,
      y: base + full * 0.18,
      color: foot1,
      colorTop: tip1,
    });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  if (variant.kind === 'column') {
    // Fuseau étroit et haut : une seule masse, mais plusieurs anneaux pour
    // garder le profil pointu d'un peuplier.
    const [foot, tip] = pairs[0];
    k.rock({ radius: radius * 0.62, height: crownHeight, sides: 5, rings: 2, seed, y: trunkTop, color: foot, colorTop: tip });
    return k.toGeometry(THREE, `lowpoly-tree-${index}`);
  }

  // Feuillu : deux masses décentrées, comme `treeBroad` réduit à deux —
  // c'est ce qui évite la boule verte unique et donne du volume à la houppe.
  const [foot0, tip0] = pairs[0];
  const [foot1, tip1] = pairs[1] || pairs[0];
  k.rock({ radius, height: crownHeight, sides: 6, rings: 1, seed, y: trunkTop, color: foot0, colorTop: tip0 });
  k.rock({
    radius: radius * 0.72,
    height: crownHeight * 0.82,
    sides: 5,
    rings: 1,
    seed: seed + 41,
    x: radius * 0.55,
    z: -radius * 0.35,
    y: trunkTop + crownHeight * 0.22,
    color: foot1,
    colorTop: tip1,
  });
  return k.toGeometry(THREE, `lowpoly-tree-${index}`);
}

/**
 * Construit un volume par essence du thème, dans l'ordre de `variants`. Une
 * seule fois par instance de couche : les géométries sont ensuite partagées
 * par toutes les tuiles, comme le fait déjà `furnitureLayer` pour son
 * catalogue de mobilier.
 * @returns {Array<Object>} une géométrie par entrée de `variants`.
 */
export function buildEssenceGeometries(THREE, variants, colors = defaultTheme.furniture.colors) {
  return variants.map((variant, index) => buildEssenceGeometry(THREE, variant, index, colors));
}

/**
 * Un seul rocher facetté, sans tronc, pour le **semis de sous-bois** —
 * la ronce, la fougère, la pousse qu'on ne nomme pas mais qui remplit le pied
 * d'un massif. Volontairement bon marché (une quinzaine de triangles) : c'est
 * ce qui autorise à en poser plusieurs milliers par tuile sans que le budget
 * de rendu de la forêt n'explose, là où une essence entière (`buildEssenceGeometry`)
 * en coûte le triple. Un feuillage détaillé ne se justifie pas pour une masse
 * qu'on ne voit jamais qu'en tas, au ras du sol et souvent à l'ombre des houppes.
 *
 * Plusieurs variantes (`buildScatterGeometries`), pour la même raison qu'un
 * atlas en portait plusieurs : un semis dense d'un seul contour se répète à
 * l'œil, quelques milliers de fois le même rocher redevient un décalque.
 *
 * @param {number} index Distingue le contour d'une variante à l'autre.
 */
export function buildScatterGeometry(THREE, index, colors = defaultTheme.furniture.colors) {
  const k = new Kit(colors);
  const pairs = [
    [colors.leafDeep, colors.leafOlive],
    [colors.leafBlue, colors.leafOlive],
    [colors.leafOlive, colors.leafSpring],
  ];
  const [foot, tip] = pairs[index % pairs.length];
  k.rock({
    radius: 0.55,
    height: 0.95,
    sides: 5,
    rings: 1,
    seed: 7001 + index * 53,
    color: foot,
    colorTop: tip,
  });
  return k.toGeometry(THREE, `lowpoly-scatter-${index}`);
}

/** Trois contours de semis, dans le même style — voir `buildScatterGeometry`. */
export function buildScatterGeometries(THREE, colors = defaultTheme.furniture.colors, count = 3) {
  return Array.from({ length: count }, (_, index) => buildScatterGeometry(THREE, index, colors));
}
