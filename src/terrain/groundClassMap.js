/*
 * groundClassMap — l'occupation du sol, rasterisée pour toute la scène.
 * Source unique de ce dont le sol est fait : le shader de terrain
 * (`terrainMaterial`), la végétation (`vegetationLayer`) et l'herbe/le
 * mobilier lisent tous la même carte au même endroit, donc jamais de contradiction.
 *
 * ## Une carte, un identifiant par texel
 *
 *   R = identifiant de matière (`SURFACE_KINDS`)   0 = la donnée se tait
 *   G = identifiant de culture (`CROP_KINDS`)      0 = rien ne pousse
 *   alpha = toujours plein
 *
 * Il y en avait **deux**, et c'est la simplification de ce lot. Une carte
 * portait quatre poids interpolés linéairement (herbe, bois, culture, sol nu),
 * l'autre deux identifiants relus au plus proche (culture, couverture). Cette
 * frontière n'était pas une idée : une « matière » avait sa texture dessinée et
 * méritait donc un canal, une « couverture » n'avait qu'une teinte et
 * empruntait la texture d'une voisine. Depuis qu'il n'y a plus qu'un grain pour
 * tout le décor, la hiérarchie n'a plus d'objet — il n'y a qu'une liste de
 * quatorze matières, et on en ajoute une en ajoutant une ligne (trente et une
 * tiennent dans le canal).
 *
 * Ce que la fusion fait gagner, au-delà du nom :
 *
 * - **rien ne peut plus diverger.** Une case portait une matière dans une carte
 *   et une couverture sans rapport dans l'autre, et il fallait tenir les deux
 *   tracés d'accord à chaque passe ;
 * - **peindre une matière efface la culture** qui était dessous, gratuitement :
 *   c'est le même texel. La ripisylve y perd trois traits, dont un en
 *   `destination-out` dont c'était la seule raison d'être ;
 * - une texture au lieu de deux (9,4 Mo au lieu de 18,9), une rasterisation au
 *   lieu de deux, et quatre lectures par pixel au lieu de six.
 *
 * Le fondu des lisières, que le filtrage linéaire donnait gratuitement, est
 * reconstruit là où il est lu : le shader et `shareOf` lisent les **quatre
 * texels voisins** et mélangent leurs appartenances. Un identifiant ne
 * s'interpole pas — entre le sable et l'eau il n'y a rien — mais
 * l'appartenance à une matière, si. C'est ce que le shader faisait déjà pour
 * les couvertures ; c'est devenu le cas général.
 *
 * Le fond est **peint** et non effacé : un canevas transparent ferait porter
 * aux pixels de bord un alpha partiel, donc des canaux prémultipliés, donc un
 * identifiant divisé — relu comme une matière sans rapport tout le long des
 * lisières.
 *
 * ## Le bord d'un tracé ment, et on le lui reprend
 *
 * L'alpha plein ne suffit pas : **le canevas lisse le bord de ses tracés**, et
 * aucune API ne le débraye. Un texel de bord porte donc le mélange des deux
 * identifiants voisins, et un identifiant mélangé en désigne un **troisième** —
 * entre le bois et l'eau, c'est-à-dire tout le long de chaque cours d'eau,
 * quatre-vingt-dix pour cent de la rampe tombe sur une matière absente du lieu.
 * C'est ce qui semait du sable et du trottoir le long des ruisseaux, et qui les
 * faisait changer de place à chaque re-rasterisation.
 *
 * Deux pièces le défont, et elles ne servent qu'à ça :
 *
 * - le canal **bleu** porte une **signature** de la matière (`SURFACE_SIGNATURES`),
 *   choisie pour qu'aucun mélange ne puisse la contrefaire ;
 * - `repairSurfaceEdges`, passé sur la relecture, rend chaque texel non signé à
 *   la matière dont il est le plus proche — c'est-à-dire à celle qui couvre
 *   plus de la moitié de sa surface.
 *
 * La carte réparée est renvoyée au canevas : le shader lit la texture, la
 * végétation lit la copie, et les deux disent la même chose.
 *
 * L'eau est une matière comme les autres, et c'est la seule description de
 * l'eau dans la scène : il n'y a pas de plan d'eau posé sur le terrain, le sol
 * *est* l'eau là où la carte le dit.
 *
 * ## Le sol de la ville
 *
 * Une matière n'est pas relevée : `pavement` est **déduite**. Entre la
 * chaussée et les façades, un centre-ville n'a ni herbe ni sol nu, il a du
 * trottoir — et le dire ici plutôt qu'en géométrie est ce qui permet au
 * revêtement d'aller jusqu'aux murs, d'épouser n'importe quelle forme de bâti
 * et de ne laisser aucun trou, sans qu'aucune couche n'ait à connaître le
 * contour des bâtiments.
 *
 * Elle est peinte par sa propre passe (`_paintPavement`), à un rang précis :
 *
 *     landuse (occupation) → PAVEMENT → vert urbain → landcover
 *
 * Ce rang **est** la règle des parcs. Le revêtement recouvre `settled` (un
 * quartier d'habitation n'est pas deux tiers d'herbe en centre-ville) et se
 * fait recouvrir par tout ce qui décrit du vert — cimetière, stade et terrain
 * de jeu par le troisième temps, parc, bois et prairie par `landcover`. Un parc
 * en ville reste donc un parc, avec son herbe et ses allées de terre, sans
 * aucune règle de plus. Le vert urbain est en outre retiré du revêtement en
 * **trous** au moment de le peindre, et pas seulement recouvert après.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import {
  cropFor,
  cropId,
  cropFromId,
  randomAt,
  CROP_KINDS,
  CROP_ID_STEP,
} from '../layers/furniturePlacement.js';
import { URBAN_GREEN_LANDUSE } from '../layers/settlement.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Côté du carré couvert, en mètres. Il doit dépasser la portée du sol de
 * proximité (un kilomètre) **plus** la distance parcourue entre deux
 * rasterisations, sinon la matière s'arrêterait net avant la fin du fondu.
 */
export const CLASS_AREA_M = 4096;
/** Côté de la carte, en pixels. ~2,7 m par pixel : une lisière n'est pas un trait. */
export const CLASS_PIXELS = 1536;
/** Déplacement de l'observateur avant re-rasterisation, en mètres. */
export const CLASS_REBUILD_M = 400;

/**
 * Couches source lues, dans l'ordre de dessin (les dernières recouvrent).
 *
 * La couche `park` n'en fait **pas** partie, et c'est un piège de nommage : au
 * schéma OpenMapTiles elle ne contient aucun parc de ville, mais
 * `boundary=protected_area`, `boundary=national_park`, `leisure=nature_reserve`
 * — des périmètres de protection, souvent immenses (Natura 2000 couvre presque
 * tout le littoral français, la Camargue, les Landes). Un périmètre juridique
 * ne dit rien de la matière du sol. Le parc de ville, lui, arrive bien :
 * `leisure=park`, `garden`, `village_green`, `recreation_ground` et
 * `golf_course` sont rangés par le schéma dans `landcover`, classe `grass`.
 */
export const CLASS_SOURCE_LAYERS = ['landuse', 'landcover'];

/** Couches source de l'eau, dans les tuiles vectorielles. */
export const WATER_SOURCE_LAYER = 'water';
export const WATERWAY_SOURCE_LAYER = 'waterway';

/** Vrai si une surface d'eau compte (les piscines produisent des confettis bleus à cette échelle). */
export function isDrawableWater(properties = {}) {
  if (properties.brunnel === 'tunnel') return false;
  return properties.class !== 'swimming_pool';
}

/**
 * Demi-largeur d'un cours d'eau linéaire, ou `null` s'il n'a pas de surface
 * d'eau visible. Un cours d'eau souterrain n'en a pas ; un cours d'eau
 * intermittent, la plupart du temps, non plus. Fonction pure.
 */
export function waterwayStyleFor(properties = {}, waterways = defaultTheme.water.waterways) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.intermittent === 1 || properties.intermittent === true) return null;
  const width = waterways[properties.class];
  return width ? { halfWidth: width / 2 } : null;
}

/**
 * Distance à laquelle `woodEdgeAt` va chercher le dehors, en mètres. Plus
 * large que le fondu de la carte (2,7 m par pixel, filtré) pour ne pas prendre
 * le flou d'un bord pour le bord lui-même ; plus étroite que la profondeur d'un
 * ourlet, faute de quoi tout un bosquet serait sa propre lisière.
 */
export const WOOD_EDGE_REACH_M = 14;

/** Voisins sondés par `woodEdgeAt` : les quatre directions cardinales suffisent à couper un bord, quelle que soit son orientation. */
const WOOD_EDGE_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * **Toutes** les matières du sol, dans l'ordre de leur identifiant (qui vaut
 * `indice + 1` ; zéro veut dire « la donnée se tait »).
 *
 * Une seule liste, et c'est le fond de ce module. Il y avait deux catégories —
 * quatre « matières » en poids dans les canaux d'une carte, neuf
 * « couvertures » en identifiant dans une autre — et la frontière n'était pas
 * une idée mais un accident : une matière avait sa texture dessinée, une
 * couverture n'avait qu'une teinte et empruntait celle d'une voisine. Depuis
 * qu'il n'y a plus qu'un grain pour tout le décor, la hiérarchie n'a plus
 * d'objet. On ajoute une matière en ajoutant une ligne ici et une ligne dans
 * `SURFACE_LOOK`.
 *
 * **L'ordre est gravé** : l'identifiant est peint dans un canal 8 bits et relu
 * des deux côtés — par le shader de terrain, qui en tire la couleur du sol
 * jusqu'à l'horizon, et par l'herbe et la végétation, qui décident de ce qui y
 * pousse. Le changer repeint une lande en éboulis.
 *
 * L'ordre n'est pas arbitraire non plus : le canevas 2D lisse le bord de ses
 * tracés, et un pixel de bord porte donc un mélange des deux identifiants
 * voisins, relu comme celui qui en est le plus proche. Deux matières qui se
 * touchent souvent dans le monde sont donc rangées côte à côte ici, pour que ce
 * mélange tombe sur l'une des deux et non sur une troisième sans rapport.
 */
export const SURFACE_KINDS = [
  // Le végétal ordinaire, dans l'ordre où il se côtoie en rase campagne.
  'grass',
  'settled',
  'farmland',
  'wood',
  // Les couvertures végétales.
  'heath',
  'scrub',
  'alpine',
  'wetland',
  // Le minéral.
  'bare',
  'scree',
  'rock',
  'sand',
  // Les deux matières à part : l'une est déduite, l'autre remplace tout.
  'pavement',
  'water',
];

/**
 * Part d'herbe d'un lotissement, telle que la strate basse la voit (ordre de
 * grandeur du non-bâti et non-revêtu dans un lotissement français).
 *
 * Ce n'est plus un poids peint dans la carte — `settled` est une matière — mais
 * l'herbe a encore besoin de savoir qu'on y sème, et de combien.
 */
export const SETTLED_GRASS = 0.66;

/**
 * Pas entre deux identifiants dans le canal rouge.
 *
 * Huit, ce qui plafonne à trente et une matières — la liste en compte
 * quatorze, et cette marge est le point de la fusion : on peut désormais en
 * ajouter sans rien réorganiser. Le pas ne sert qu'à laisser à l'arrondi de
 * lecture de quoi encaisser le passage par un canevas 8 bits ; quatre niveaux
 * de part et d'autre suffisent, la valeur écrite étant exacte.
 */
export const SURFACE_ID_STEP = 8;

/**
 * Signature d'un identifiant, peinte dans le canal bleu.
 *
 * Elle existe pour une raison précise, et c'est le seul moyen qu'on ait de
 * distinguer un texel peint d'un texel inventé : **le canevas 2D lisse le bord
 * de ses tracés, et rien ne le désactive**. Un pixel de bord porte donc
 * `alpha x A + (1 - alpha) x B` — le mélange de deux identifiants voisins, relu
 * par `surfaceFromId` comme un **troisième**. Entre le bois (4) et l'eau (14),
 * c'est-à-dire tout le long de chaque cours d'eau, quatre-vingt-dix pour cent
 * de la rampe tombe sur une matière qui n'a jamais été peinte là : du sable,
 * de la roche, du trottoir, une lande. C'est ce qui semait des taches claires
 * le long des ruisseaux, et qui les faisait changer de place à chaque
 * re-rasterisation.
 *
 * Ranger les matières voisines côte à côte dans `SURFACE_KINDS` limite les
 * dégâts entre voisines ; ça ne peut rien pour l'eau, qui borde tout.
 *
 * Un mélange ne peut pas contrefaire ces valeurs : **aucun triplet de la table
 * n'est aligné**. Pour qu'un pixel de bord se fasse passer pour la matière C,
 * il faudrait que son rouge tombe sur celui de C *et* que son bleu tombe en
 * même temps sur la signature de C — or le bleu se mélange linéairement, et la
 * table est faite pour qu'il rate. L'écart minimal mesuré est de 8, très
 * au-dessus de l'arrondi du canevas ; un test le vérifie en balayant toutes les
 * couvertures possibles de toutes les paires.
 *
 * D'où les valeurs, qui n'ont aucun sens à l'unité : elles ont été cherchées
 * pour maximiser cet écart, sous la seule contrainte que le fond (identifiant
 * zéro) garde la signature zéro. En ajouter une pour une quinzième matière
 * demande de relancer cette recherche — le test dit sans ambiguïté si la valeur
 * choisie tient.
 *
 * Indexée par l'identifiant lui-même, fond compris.
 */
export const SURFACE_SIGNATURES = [0, 68, 163, 75, 226, 152, 251, 48, 12, 255, 176, 2, 225, 167, 49];

/** Signature d'un identifiant de matière. Fonction pure. */
export function surfaceSignature(id) {
  return SURFACE_SIGNATURES[id] ?? 0;
}

/**
 * Rang de l'eau, à partir de 1. Le shader en a besoin nommément : l'eau n'est
 * pas une matière de plus, elle remplace tout ce qui la précède.
 */
export const WATER_ID = SURFACE_KINDS.indexOf('water') + 1;

/** Rang du revêtement urbain, à partir de 1. Seule matière qui ne soit pas relevée mais déduite. */
export const PAVEMENT_ID = SURFACE_KINDS.indexOf('pavement') + 1;

/**
 * Les matières sur lesquelles il pousse de l'herbe.
 *
 * Ce n'est pas un jugement d'aspect mais la seule distinction que la strate
 * basse ait besoin de faire : une lande et un maquis sont rases et clairsemés,
 * mais c'est bien de l'herbe qui y pousse, et leur ligne de `SURFACE_LOOK` dit
 * ensuite de quelle taille et de quelle teinte. Ce qui n'est pas là ne porte
 * rien : ni le minéral, ni la dalle, ni l'eau.
 */
export const VEGETAL_SURFACES = new Set(['grass', 'heath', 'scrub', 'alpine', 'wetland']);

/** Identifiant d'une matière, ou 0 si on ne la connaît pas. Fonction pure. */
export function surfaceId(kind) {
  const index = SURFACE_KINDS.indexOf(kind);
  return index < 0 ? 0 : index + 1;
}

/** Matière portée par une valeur du canal rouge, ou `null`. Fonction pure. */
export function surfaceFromId(red) {
  const index = Math.round(red / SURFACE_ID_STEP) - 1;
  return SURFACE_KINDS[index] || null;
}

/**
 * Remplissage d'un texel : la matière dans le rouge, la culture dans le vert.
 *
 * Un seul remplissage là où il en fallait deux, dans deux canevas. C'est ce qui
 * rend impossible la divergence d'avant — une case pouvait porter une matière
 * dans une carte et une couverture sans rapport dans l'autre — et ce qui fait
 * qu'une matière peinte **efface la culture** qui était dessous, gratuitement.
 *
 * Alpha toujours plein : le fond est peint, pas effacé (voir `rebuild`).
 *
 * Le bleu porte la **signature** de la matière (voir `SURFACE_SIGNATURES`), qui
 * ne décrit rien du décor : elle certifie que ce texel a été peint et non
 * fabriqué par le lissage du canevas. C'est elle que `repairSurfaceEdges` relit.
 *
 * @param {string|null} kind Matière.
 * @param {number} [crop] Identifiant de culture (`cropId`), 0 pour aucune.
 */
export function surfaceFill(kind, crop = 0) {
  const id = surfaceId(kind);
  return `rgba(${id * SURFACE_ID_STEP}, ${crop * CROP_ID_STEP}, ${surfaceSignature(id)}, 1)`;
}

/**
 * Ce qu'une valeur de canal peut être, une fois pour toutes : la signature
 * attendue pour un rouge donné (-1 si ce rouge n'est aucun identifiant), et si
 * un vert tombe pile sur une culture connue.
 *
 * Deux tables de 256 entrées plutôt que des divisions par texel : la passe de
 * réparation lit deux millions et demi de texels à chaque re-rasterisation, et
 * elle est la seule chose qui s'ajoute entre la peinture et l'affichage. Elle y
 * gagne la moitié de son temps.
 */
const RED_TO_SIGNATURE = new Int16Array(256).fill(-1);
const GREEN_IS_CROP = new Uint8Array(256);
for (let id = 0; id <= SURFACE_KINDS.length; id++) {
  RED_TO_SIGNATURE[id * SURFACE_ID_STEP] = surfaceSignature(id);
}
for (let crop = 0; crop <= CROP_KINDS.length; crop++) GREEN_IS_CROP[crop * CROP_ID_STEP] = 1;

/** Voisins consultés pour réparer un texel de bord : les huit, une limite oblique ne laissant parfois que les diagonales. */
const REPAIR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Rend à chaque texel de bord la matière qui l'emporte, sur place.
 *
 * Le lissage du canevas mélange les identifiants de deux tracés voisins, et un
 * identifiant mélangé en désigne un troisième (voir `SURFACE_SIGNATURES`). On ne
 * peut pas l'éviter à la peinture — aucune API ne débraye l'antialiasing d'un
 * tracé — donc on le défait après coup : un texel qui ne porte pas de signature
 * valable reprend celle de son voisin peint le plus proche en rouge, à égalité
 * le plus proche en vert.
 *
 * « Le plus proche en rouge » **est** le seuil de couverture : entre deux
 * matières, un texel couvert à plus de la moitié par l'une porte un rouge plus
 * près de celui-là, et c'est elle qu'il reprend. La limite tombe donc au bon
 * demi-texel, au lieu d'inventer une matière absente du lieu.
 *
 * Deux passes, et c'est ce qui garantit le déterminisme : la première marque,
 * la seconde répare en ne lisant **que** des texels marqués peints, jamais un
 * texel déjà réparé. L'ordre de parcours ne change donc rien au résultat.
 *
 * Le vert (la culture) n'a pas de signature à lui — il n'y a plus de canal
 * libre — et n'est vérifié que par son pas : un mélange de deux cultures sur
 * vingt-huit passe encore au travers. C'est la limite connue de cette passe,
 * et elle ne touche que la limite entre deux parcelles de cultures différentes.
 *
 * @param {Uint8ClampedArray} data Canal par canal, quatre par texel.
 * @param {number} [pixels] Côté de la carte.
 * @returns {number} texels réparés.
 */
export function repairSurfaceEdges(data, pixels = CLASS_PIXELS) {
  const total = pixels * pixels;
  const painted = new Uint8Array(total);
  let suspects = 0;

  // Un texel est peint si son rouge tombe pile sur un identifiant, que son bleu
  // en porte la signature, et que son vert tombe pile sur une culture connue.
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (data[i + 2] === RED_TO_SIGNATURE[data[i]] && GREEN_IS_CROP[data[i + 1]] === 1) {
      painted[p] = 1;
    } else {
      suspects++;
    }
  }
  if (suspects === 0) return 0;

  let repaired = 0;
  for (let p = 0; p < total; p++) {
    if (painted[p]) continue;
    const i = p * 4;
    const x = p % pixels;
    const y = (p - x) / pixels;

    let bestScore = Infinity;
    let best = -1;
    for (const [dx, dy] of REPAIR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= pixels || ny >= pixels) continue;
      const q = ny * pixels + nx;
      if (!painted[q]) continue;
      const j = q * 4;
      // Le rouge décide, le vert départage : deux parcelles de la même matière
      // et de cultures différentes ne diffèrent que par lui.
      const score = Math.abs(data[j] - data[i]) * 1024 + Math.abs(data[j + 1] - data[i + 1]);
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }

    if (best >= 0) {
      data[i] = data[best];
      data[i + 1] = data[best + 1];
      data[i + 2] = data[best + 2];
    } else {
      // Aucun voisin peint : un trait plus étroit qu'un texel, entièrement fait
      // de bord. On arrondit, faute de mieux — c'est ce que faisait toute la
      // carte avant cette passe.
      const id = Math.min(SURFACE_KINDS.length, Math.round(data[i] / SURFACE_ID_STEP));
      const crop = Math.min(CROP_KINDS.length, Math.round(data[i + 1] / CROP_ID_STEP));
      data[i] = id * SURFACE_ID_STEP;
      data[i + 1] = crop * CROP_ID_STEP;
      data[i + 2] = surfaceSignature(id);
    }
    repaired++;
  }

  return repaired;
}

/**
 * Matière d'une entité surfacique, ou `null` si elle n'en décrit aucune.
 *
 * C'était deux fonctions — `groundClassFor` disait la matière grossière,
 * `coverFor` la précisait quand elle savait — et ce découpage était le
 * symptôme : `landcover.class = 'sand'` devait d'abord se déclarer « sol nu »
 * pour ensuite se corriger en « sable ». Il dit maintenant « sable » du premier
 * coup.
 *
 * `landuse=residential` ne prend pas `bare` : c'est un périmètre administratif
 * où le sol réel est surtout de l'herbe (pelouses, jardins), le minéral ne
 * couvrant que la chaussée et ses abords (composés par `streetLayer`). D'où
 * `settled`, qui était un mélange peint dans un canal et qui est désormais une
 * matière comme les autres. Une zone d'activité (industrielle, commerciale,
 * ferroviaire, carrière), elle, reste `bare` : réellement minérale partout.
 *
 * La couche `park` n'est pas lue, et c'est un piège de nommage : au schéma
 * OpenMapTiles elle ne porte aucun parc de ville mais des périmètres de
 * protection, souvent immenses (voir `CLASS_SOURCE_LAYERS`). Un périmètre
 * juridique ne dit rien de la matière du sol.
 *
 * Fonction pure.
 */
export function surfaceFor(sourceLayer, properties = {}) {
  const klass = properties.class;
  const subclass = properties.subclass;

  if (sourceLayer === 'landcover') {
    if (klass === 'wood') return 'wood';
    if (klass === 'farmland') return 'farmland';
    if (klass === 'wetland') return 'wetland';
    if (klass === 'sand') return 'sand';
    // L'éboulis et la dalle sont deux paysages : une pente de cailloux qui
    // bouge, un plateau de pierre. Les confondre était le défaut du gris unique.
    if (klass === 'rock') return subclass === 'scree' ? 'scree' : 'rock';
    if (klass === 'grass') {
      if (subclass === 'heath') return 'heath';
      if (subclass === 'scrub' || subclass === 'shrubbery') return 'scrub';
      // `fell` est la pelouse d'altitude au-dessus de la limite forestière ;
      // `tundra` en est l'équivalent boréal.
      if (subclass === 'fell' || subclass === 'tundra') return 'alpine';
      return 'grass';
    }
    // La glace n'a pas encore de matière à elle : elle passe pour du minéral.
    if (klass === 'ice' || subclass === 'glacier' || subclass === 'ice_shelf') return 'bare';
    return null;
  }

  if (sourceLayer === 'landuse') {
    if (klass === 'cemetery' || klass === 'pitch' || klass === 'playground' || klass === 'stadium') {
      return 'grass';
    }
    if (klass === 'residential' || klass === 'suburb' || klass === 'neighbourhood' || klass === 'quarter') {
      return 'settled';
    }
    if (klass === 'industrial' || klass === 'commercial' || klass === 'retail' || klass === 'railway' || klass === 'quarry') {
      return 'bare';
    }
    return null;
  }

  return null;
}

/** Anneaux d'une géométrie surfacique. */
export function classPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

export class GroundClassMap {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} [options.theme] Fournit `theme.water.waterways` (largeur
   *        des cours d'eau) et `theme.water.riparianBufferM` (largeur de la
   *        ripisylve) — voir `rebuild`.
   */
  constructor({ THREE, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    /**
     * Famille climatique du lieu, ou `null`. La carte des cultures est le seul
     * endroit où une culture est tirée (voir `cropFor`), donc c'est ici que le
     * climat doit arriver — pas dans `cropLayer`, qui ne fait que relire.
     */
    this.climate = null;
    // Une seule carte, un seul repère, un seul filtrage. Elle portait des
    // poids interpolés linéairement dans une carte et des identifiants relus au
    // plus proche dans une autre ; ce sont désormais deux canaux du même texel,
    // tous deux des identifiants, tous deux au plus proche. Le fondu des
    // lisières que le filtrage linéaire donnait gratuitement est reconstruit
    // par le shader, qui lit les quatre voisins et mélange leurs
    // appartenances — ce qu'il faisait déjà pour les couvertures.
    this.canvas = createCanvas(CLASS_PIXELS, CLASS_PIXELS);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace; // les canaux portent des identifiants, pas une couleur
    // Sans ce réglage, three retourne l'image et la carte serait en miroir nord-sud.
    this.texture.flipY = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    // Au plus proche : interpoler un identifiant inventerait une matière entre
    // deux, et entre le sable et l'eau il n'y a rien.
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    /** Coin nord-ouest du carré couvert, en mètres locaux. */
    this.origin = new THREE.Vector2(0, 0);
    this.size = CLASS_AREA_M;
    this.count = 0;
    /** Texels de bord rendus à leur matière à la dernière rasterisation (voir `repairSurfaceEdges`). */
    this.repaired = 0;
    /** Numéro de rasterisation, incrémenté à chaque repeinte (sert à qui garde ce qu'il a lu ici, ex. la végétation). */
    this.revision = 0;

    /** Copie CPU, relue par la végétation. `null` tant que rien n'a été peint. */
    this._data = null;

    this._anchor = null;
    this._frame = null;
    this.disposed = false;
  }

  /**
   * Pose la famille climatique du lieu. Le compositeur repeint la carte quand
   * elle change : ce qui a été semé sous un autre climat n'est plus valable.
   */
  setClimate(family) {
    this.climate = family || null;
  }

  /** Index du texel qui contient un point, ou -1 hors carte. */
  _texelAt(x, z) {
    const px = Math.floor(((x - this.origin.x) / this.size) * CLASS_PIXELS);
    const pz = Math.floor(((z - this.origin.y) / this.size) * CLASS_PIXELS);
    if (px < 0 || pz < 0 || px >= CLASS_PIXELS || pz >= CLASS_PIXELS) return -1;
    return (pz * CLASS_PIXELS + px) * 4;
  }

  /** Vrai si la carte couvre ce point. Distinct de « rien n'y pousse ». */
  hasDataAt(x, z) {
    return this._data !== null && this._texelAt(x, z) >= 0;
  }

  /**
   * Matière du sol en un point, ou `null` si la donnée se tait — la seule
   * réponse à « de quelle sorte est ce sol ». Le shader, l'herbe, la
   * végétation et les chaussées la lisent tous ici, donc jamais de contradiction.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null} Un nom de `SURFACE_KINDS`.
   */
  surfaceAt(x, z) {
    const data = this._data;
    if (!data) return null;
    const i = this._texelAt(x, z);
    if (i < 0) return null;
    return surfaceFromId(data[i]);
  }

  /**
   * Part d'une matière autour d'un point, de 0 à 1 — l'appartenance des quatre
   * texels voisins, pondérée bilinéairement.
   *
   * C'est le pendant CPU de ce que fait le shader, et il faut bien qu'il
   * existe : un identifiant ne s'interpole pas, mais l'appartenance à une
   * matière, si. Sans lui, une lisière de bois répondrait « bois » ou
   * « pas bois » au texel de 2,7 m, et les semis s'aligneraient sur ce damier.
   *
   * @param {string} kind Matière cherchée.
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {number} de 0 à 1, ou 0 hors carte.
   */
  shareOf(kind, x, z) {
    const data = this._data;
    if (!data) return 0;
    const wanted = surfaceId(kind) * SURFACE_ID_STEP;
    if (!wanted) return 0;

    const gx = ((x - this.origin.x) / this.size) * CLASS_PIXELS - 0.5;
    const gz = ((z - this.origin.y) / this.size) * CLASS_PIXELS - 0.5;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;

    let share = 0;
    for (let dz = 0; dz <= 1; dz++) {
      const pz = z0 + dz;
      if (pz < 0 || pz >= CLASS_PIXELS) continue;
      const weightZ = dz === 0 ? 1 - fz : fz;
      for (let dx = 0; dx <= 1; dx++) {
        const px = x0 + dx;
        if (px < 0 || px >= CLASS_PIXELS) continue;
        const red = data[(pz * CLASS_PIXELS + px) * 4];
        if (Math.abs(red - wanted) > SURFACE_ID_STEP / 2) continue;
        share += (dx === 0 ? 1 - fx : fx) * weightZ;
      }
    }
    return share;
  }

  /**
   * Parts des quatre matières que l'herbe et le mobilier savent lire, ou `null`
   * si la donnée se tait.
   *
   * Ces quatre-là n'ont plus rien de fondamental — ce sont quatre matières
   * parmi quatorze — mais elles restent les seules que la strate basse
   * distingue : l'herbe pousse, la litière pousse à moitié, le champ selon la
   * saison, le minéral pas. La forme est conservée pour ses lecteurs
   * (`grassGreenFor`, `woodEdgeAt`).
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {{grass:number, wood:number, farmland:number, bare:number}|null}
   */
  sampleAt(x, z) {
    if (!this._data) return null;
    if (this._texelAt(x, z) < 0) return null;

    // Le lotissement compte pour ce qu'il est : deux tiers d'herbe, un tiers de
    // minéral. C'était un poids peint dans un canal ; c'est maintenant une
    // matière, et la part se lit ici plutôt que dans la carte.
    let grass = this.shareOf('settled', x, z) * SETTLED_GRASS;
    for (const kind of VEGETAL_SURFACES) grass += this.shareOf(kind, x, z);
    const wood = this.shareOf('wood', x, z);
    const farmland = this.shareOf('farmland', x, z);
    return { grass, wood, farmland, bare: Math.max(0, 1 - grass - wood - farmland) };
  }

  /**
   * Part de végétal au sol, de 0 à 1, ou `null` si la donnée se tait —
   * l'entrée de l'herbe et des alignements d'arbres. Une culture ne compte
   * que pour moitié (herbe une partie de l'année seulement).
   */
  greenAt(x, z) {
    const sample = this.sampleAt(x, z);
    if (!sample) return null;
    return Math.min(1, sample.grass + sample.farmland * 0.5);
  }

  /** Part de bois en un point, de 0 à 1. */
  woodAt(x, z) {
    return this.shareOf('wood', x, z);
  }

  /**
   * Part de lisière en un point : combien ce bois-ci donne sur autre chose.
   * Zéro en plein bois comme en plein champ, maximal sur le bord.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @param {number} [reach] Distance à laquelle on va chercher le dehors.
   */
  woodEdgeAt(x, z, reach = WOOD_EDGE_REACH_M) {
    const here = this.woodAt(x, z);
    if (here <= 0) return 0;
    let outside = 0;
    for (const [dx, dz] of WOOD_EDGE_OFFSETS) {
      const nx = x + dx * reach;
      const nz = z + dz * reach;
      // Un voisin dont la carte ne dit rien n'est pas un dehors : sans ce
      // test, tout le pourtour du carré couvert serait une lisière, et le
      // sous-bois s'y ourlerait d'arbres qui n'ont rien à border.
      if (!this.hasDataAt(nx, nz)) continue;
      outside = Math.max(outside, here - this.woodAt(nx, nz));
    }
    return Math.max(0, Math.min(1, outside));
  }

  /**
   * Culture portée par un point, ou `null` (hors carte, hors champ, ou culture
   * qu'on ne sait pas nommer). Second axe, indépendant de la matière : un champ
   * de blé est du `farmland` **et** du blé.
   *
   * @param {number} x Mètres locaux.
   * @param {number} z
   * @returns {string|null}
   */
  cropAt(x, z) {
    const data = this._data;
    if (!data) return null;
    const i = this._texelAt(x, z);
    if (i < 0) return null;
    return cropFromId(data[i + 1]);
  }

  /** Vrai dès qu'une carte a été relue : la culture vit dans la même. */
  get cropReady() {
    return this._data !== null;
  }

  /** Vrai dès qu'une rasterisation a été relue : avant, personne ne sait rien. */
  get ready() {
    return this._data !== null;
  }

  /**
   * Part d'un rectangle, en mètres locaux, sur laquelle la carte a quelque
   * chose à dire : de 0 (rien, hors carte) à 1 (tout). Une tuile de coin
   * déborde régulièrement du carré couvert (qui suit l'observateur par sauts
   * de 400 m) ; sans cette mesure, une forêt tombant juste après le bord au
   * moment de sa plantation ne poussait jamais.
   */
  coverageOf(minX, minZ, maxX, maxZ, frame = null) {
    if (!this.ready) return 0;
    if (frame && this._frame !== frame) return 0;
    const area = (maxX - minX) * (maxZ - minZ);
    if (!(area > 0)) return 0;
    const overlapX = Math.min(maxX, this.origin.x + this.size) - Math.max(minX, this.origin.x);
    const overlapZ = Math.min(maxZ, this.origin.y + this.size) - Math.max(minZ, this.origin.y);
    if (overlapX <= 0 || overlapZ <= 0) return 0;
    return Math.min(1, (overlapX * overlapZ) / area);
  }

  needsRebuild(x, z, frame) {
    if (this._frame !== frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= CLASS_REBUILD_M;
  }

  /**
   * Le sol revêtu de la ville : entre la chaussée et les façades, un
   * centre-ville n'a pas de sol nu ni d'herbe, il a du trottoir.
   *
   * Trois termes, ceux du masque urbain (voir `settlement.UrbanMask`) : le
   * **disque** d'agglomération borne la portée et sert de découpe ; les
   * emprises **bâties** donnent la forme ; le **vert urbain** est retiré, et
   * l'est ici en trous d'un remplissage pair-impair plutôt qu'en effacement —
   * effacer creuserait aussi l'occupation du sol déjà peinte dessous.
   *
   * Une emprise à la fois, et non toutes en un tracé : deux emprises bâties
   * qui se recouvrent (un quartier dans une commune) s'annuleraient en
   * pair-impair, et la ville aurait un trou là où elle est le plus dense.
   *
   * Le revêtement s'écrit dans les deux cartes : sol nu dans celle des
   * matières (ni herbe ni semis n'y poussent, gratuitement), couverture
   * `pavement` dans celle des cultures, d'où le shader tire sa couleur.
   *
   * @returns {number} emprises revêtues.
   */
  _paintPavement(urban, originX, originZ, perMeter) {
    if (!urban?.any || !urban.builtUp?.length) return 0;
    const { ctx } = this;

    const ringPath = (ring, into = new Path2D()) => {
      for (let i = 0; i < ring.length; i++) {
        const px = (ring[i].x - originX) * perMeter;
        const pz = (ring[i].z - originZ) * perMeter;
        if (i === 0) into.moveTo(px, pz);
        else into.lineTo(px, pz);
      }
      into.closePath();
      return into;
    };

    // La découpe : les disques d'agglomération. Ce sont eux, et rien d'autre,
    // qui font qu'un village bâti ne se retrouve pas pavé jusqu'aux jardins.
    const discs = new Path2D();
    for (const disc of urban.discs) {
      discs.arc(
        (disc.x - originX) * perMeter,
        (disc.z - originZ) * perMeter,
        disc.radius * perMeter,
        0,
        Math.PI * 2
      );
      discs.closePath();
    }

    // Les trous, construits une fois : ils sont les mêmes pour chaque emprise.
    const greens = new Path2D();
    for (const ring of urban.greens || []) {
      if (Array.isArray(ring) && ring.length >= 3) ringPath(ring, greens);
    }

    ctx.save();
    ctx.clip(discs);
    // Un seul remplissage : le revêtement était une matière dans une carte et
    // une couverture dans l'autre, et il fallait que les deux restent d'accord.
    ctx.fillStyle = surfaceFill('pavement');
    let painted = 0;

    for (const ring of urban.builtUp) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const path = ringPath(ring);
      path.addPath(greens);
      ctx.fill(path, 'evenodd');
      painted++;
    }

    ctx.restore();
    return painted;
  }

  /**
   * Re-rasterise la carte autour d'un point.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Object} frame  Repère local de la bulle.
   * @param {Object} [options]
   * @param {Object|null} [options.urban] `UrbanMask` : le sol revêtu de la
   *        ville. Absent, aucune passe de revêtement — c'est le comportement de
   *        campagne, et celui d'avant ce lot.
   * @returns {boolean} vrai si des surfaces ont été peintes.
   */
  rebuild(source, tiles, here, frame, { urban = null } = {}) {
    if (this.disposed || !source || !frame) return false;

    const { ctx } = this;
    const half = CLASS_AREA_M / 2;
    const originX = here.x - half;
    const originZ = here.z - half;
    const perMeter = CLASS_PIXELS / CLASS_AREA_M;
    const { origin, scale, zoom } = frame;

    // Le fond est **peint**, pas effacé : identifiant zéro, alpha plein. Un
    // canevas transparent ferait porter aux pixels de bord d'un tracé un alpha
    // partiel, donc des canaux prémultipliés, donc un identifiant divisé —
    // relu comme une matière sans rapport tout le long des lisières.
    ctx.fillStyle = surfaceFill(null);
    ctx.fillRect(0, 0, CLASS_PIXELS, CLASS_PIXELS);

    let painted = 0;

    // L'ordre compte, et il compte maintenant à trois temps :
    //
    //   occupation du sol → revêtement urbain → vert urbain → landcover
    //
    // Le revêtement de ville recouvre `settled` (un quartier d'habitation
    // n'est pas deux tiers d'herbe en centre-ville), et le vert urbain
    // — cimetière, stade, terrain de jeu — le recouvre à son tour. Sans ce
    // troisième temps, un cimetière peint avant le revêtement dans l'ordre des
    // entités de la tuile disparaîtrait sous le bitume, et l'ordre des entités
    // dans une tuile n'est pas quelque chose dont on décide.
    //
    // Le vert urbain n'est donc pas relu : son tracé est **différé**, mis de
    // côté au passage et rejoué après le revêtement. Une seule traversée de
    // `landuse`, comme avant.
    const deferred = [];

    for (const sourceLayer of CLASS_SOURCE_LAYERS) {
      source.forEachFeature(sourceLayer, tiles, (geometry, properties) => {
        const kind = surfaceFor(sourceLayer, properties);
        if (!kind) return;
        const green = sourceLayer === 'landuse' && URBAN_GREEN_LANDUSE.has(properties.class);

        for (const rings of classPolygons(geometry)) {
          if (!Array.isArray(rings) || rings.length === 0) continue;

          // Tracé construit une fois, rempli deux fois (matière + culture).
          const path = new Path2D();
          let sumX = 0;
          let sumZ = 0;
          let counted = 0;

          for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            for (let i = 0; i < ring.length; i++) {
              const [lng, lat] = ring[i];
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
              const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
              const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
              if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
              // Centre = graine de la culture ; seul l'anneau extérieur compte.
              if (ring === rings[0]) {
                sumX += localX;
                sumZ += localZ;
                counted++;
              }
            }
            path.closePath();
          }

          // La culture, tirée ici et nulle part ailleurs, ancrée au sol
          // (centre de la parcelle) pour que la bulle qui repasse la retrouve.
          const crop =
            kind === 'farmland' && counted > 0
              ? cropId(
                  cropFor(properties, randomAt(sumX / counted, sumZ / counted, 43), this.climate)
                )
              : 0;

          if (green) {
            // Rejoué après le revêtement : voir plus haut.
            deferred.push({ path, fill: surfaceFill(kind, crop) });
            painted++;
            continue;
          }

          // Un seul remplissage pour la matière **et** sa culture : c'était
          // deux tracés dans deux canevas, qui pouvaient diverger.
          ctx.fillStyle = surfaceFill(kind, crop);
          ctx.fill(path, 'evenodd'); // anneaux intérieurs = trous
          painted++;
        }
      });

      // Le revêtement de ville et le vert qu'il ne recouvre pas, entre les
      // deux couches source : `landuse` vient de poser l'occupation, et
      // `landcover` posera par-dessus la matière réelle — un parc, un bois,
      // une prairie —, ce qui est exactement le rang qu'on veut leur laisser.
      if (sourceLayer === 'landuse') {
        painted += this._paintPavement(urban, originX, originZ, perMeter);
        for (const piece of deferred) {
          ctx.fillStyle = piece.fill;
          ctx.fill(piece.path, 'evenodd');
        }
      }
    }

    // Les cours d'eau linéaires (`waterway`, pas un polygone) : le lit, et
    // l'ourlet de bois qui le borde — la ripisylve, plantée par
    // `vegetationLayer` avec les mêmes silhouettes qu'une vraie forêt. Après
    // les polygones : le lit d'un ruisseau qui traverse un champ de blé doit y
    // remplacer la culture.
    //
    // Le lit se peint que la ripisylve existe ou non. Il dépendait de
    // `riparianBufferM` — un thème qui ne voulait pas d'ourlet perdait du même
    // coup tous ses ruisseaux — et le fossé, qui n'a pas d'ourlet, sortait
    // avant d'avoir eu son lit : sa largeur de thème ne servait à rien.
    {
      const waterways = this.theme.water.waterways;
      const bufferM = this.theme.water.riparianBufferM ?? 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      source.forEachFeature(WATERWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
        const style = waterwayStyleFor(properties, waterways);
        if (!style) return;
        const width = style.halfWidth * 2;
        // Un fossé n'a pas de ripisylve : c'est un trait creusé en bord de
        // champ, pas un cours d'eau bordé d'arbres.
        const riparianM = properties.class === 'ditch' ? 0 : bufferM;

        const lines =
          geometry.type === 'LineString'
            ? [geometry.coordinates]
            : geometry.type === 'MultiLineString'
              ? geometry.coordinates
              : [];
        const lineWidthPx = (width + riparianM * 2) * perMeter;

        for (const line of lines) {
          if (!Array.isArray(line) || line.length < 2) continue;
          const path = new Path2D();
          let started = false;
          for (const [lng, lat] of line) {
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
            const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
            const px = (localX - originX) * perMeter;
            const pz = (localZ - originZ) * perMeter;
            if (!started) {
              path.moveTo(px, pz);
              started = true;
            } else {
              path.lineTo(px, pz);
            }
          }
          if (!started) continue;

          // L'ourlet, puis le lit par-dessus : le trait est centré sur
          // l'axe, et sans reprise un large cours d'eau se retrouverait
          // planté d'arbres en son milieu.
          //
          // Deux traits, là où il en fallait cinq — dont un en
          // `destination-out` pour effacer, dans l'autre carte, la culture
          // que l'ourlet recouvrait. Peindre une matière efface désormais la
          // culture d'un même geste : elles sont deux canaux du même texel.
          if (riparianM > 0) {
            ctx.strokeStyle = surfaceFill('wood');
            ctx.lineWidth = lineWidthPx;
            ctx.stroke(path);
          }

          ctx.strokeStyle = surfaceFill('water');
          ctx.lineWidth = width * perMeter;
          ctx.stroke(path);
          painted++;
        }
      });

      ctx.restore();
    }

    // Le lit d'un grand cours d'eau est un polygone (`water`), pas seulement
    // le trait `waterway` (dont la largeur de thème décrit un ruisseau, pas un
    // fleuve). On reprend donc, après coup, tout ce qui a été peint sous
    // l'emprise réelle de l'eau — en sol nu, et non en effaçant : une case
    // effacée est « non classée », dont le repli est l'herbe pleine.
    source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (!isDrawableWater(properties)) return;
      for (const rings of classPolygons(geometry)) {
        if (!Array.isArray(rings) || rings.length === 0) continue;

        const path = new Path2D();
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            const localX = (lngToTileX(lng, zoom) - origin.x) * scale;
            const localZ = (latToTileY(lat, zoom) - origin.y) * scale;
            if (i === 0) path.moveTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
            else path.lineTo((localX - originX) * perMeter, (localZ - originZ) * perMeter);
          }
          path.closePath();
        }

        // Le lit d'un grand cours d'eau est un polygone (`water`), pas
        // seulement le trait `waterway`, dont la largeur de thème décrit un
        // ruisseau et pas un fleuve. C'est de là que le shader de terrain tire
        // le plan d'eau lui-même.
        ctx.save();
        ctx.fillStyle = surfaceFill('water');
        ctx.fill(path, 'evenodd');
        ctx.restore();
      }
    });

    this.count = painted;
    this.revision++;
    this.origin.set(originX, originZ);

    // Relecture unique, à la rasterisation (un `getImageData` par appel serait
    // ruineux) — et c'est aussi le seul moment où l'on peut défaire le lissage
    // du canevas, qui inventerait sinon une matière tout le long de chaque
    // limite (voir `repairSurfaceEdges`). La carte est renvoyée au canevas :
    // le shader lit la texture, pas cette copie, et les deux doivent dire la
    // même chose.
    try {
      const image = ctx.getImageData(0, 0, CLASS_PIXELS, CLASS_PIXELS);
      this.repaired = repairSurfaceEdges(image.data);
      if (this.repaired > 0) ctx.putImageData(image, 0, 0);
      this._data = image.data;
    } catch (e) {
      this._data = null;
      this.repaired = 0;
      console.warn('[groundClassMap] relecture impossible', e?.message || e);
    }
    this.texture.needsUpdate = true;
    this._anchor = { x: here.x, z: here.z };
    this._frame = frame;
    return painted > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._data = null;
    this.texture.dispose();
  }
}
