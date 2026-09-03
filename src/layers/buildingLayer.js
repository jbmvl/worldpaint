/*
 * buildingLayer — le bâti, extrudé depuis les tuiles vectorielles.
 * ------------------------------------------------------------------
 * Traverser un village qui n'existe qu'en photo était le manque le plus
 * visible.
 *
 * Les empreintes viennent de la couche `building` des tuiles vectorielles,
 * chargées par `vectorTileSource` **pour la bulle** — et non par interrogation
 * d'une carte 2D voisine, qui ne rendrait que ce que sa propre fenêtre a
 * chargé. La portée du décor ne dépend ainsi que du décor.
 *
 * ## La fonction du bâtiment
 *
 * La couche `building` ne porte que des hauteurs : ni matériau, ni forme de
 * toit, ni fonction. La fonction vient donc d'ailleurs — de la couche `poi`,
 * dont chaque point désigne un bâtiment existant. Elle n'ajoute jamais de
 * volume **à côté** de l'empreinte : elle transforme celle qui contient le
 * point (couleur, forme de toit, devanture) et lui greffe au besoin un clocher
 * ou un minaret. Voir `buildingPersonalityFor` pour le classement,
 * `sortPersonalities` pour la raison du tri, et `theme.personalities` pour ce
 * que chaque fonction donne à voir.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { srgb } from '../core/color.js';
import { buildingStyleAt } from './townStyle.js';
import { orientedBox, roofTriangles, roofRise, ringArea } from './roofGeometry.js';
import { pointInRing } from './furniturePlacement.js';
import { Kit } from './furnitureKit.js';
import { defaultTheme } from '../themes/default.js';
import { LabelAtlas, pushLabelQuad, labelFontPxForCellHeight, LABEL_PX_PER_M } from '../materials/labelAtlas.js';

/** Couche vectorielle portant les empreintes. */
export const BUILDING_SOURCE_LAYER = 'building';
/** Couche vectorielle des points d'intérêt — voir `buildingPersonalityFor`. */
export const BUILDING_POI_SOURCE_LAYER = 'poi';

/**
 * Points d'intérêt classés retenus par reconstruction.
 *
 * Le plafond ne protège pas le rendu mais le temps de reconstruction : chaque
 * empreinte relit la liste entière. Il ne se voit que là où la donnée est
 * dense — au centre de Lyon, les neuf tuiles de la bulle portent plus de huit
 * mille points classés, presque tous des commerces. C'est précisément pour ces
 * endroits-là que `sortPersonalities` existe : le plafond doit tomber sur le
 * commerce du bout de la bulle, jamais sur l'église d'à côté.
 */
export const BUILDING_POI_MAX_COUNT = 600;

/**
 * Sous-classes `poi` qui font d'un bâtiment une grande surface.
 *
 * `department_store` est rangé sous `grocery` et `mall` sous `shop` : ce sont
 * deux classes différentes pour la même silhouette — une boîte en bardage au
 * milieu d'un parking.
 */
const RETAIL_SUBCLASSES = new Set(['mall', 'department_store', 'supermarket']);

/**
 * Classes `poi` qui posent une devanture au rez-de-chaussée.
 *
 * Le critère n'est pas « commerce » au sens du cadastre mais **façade sur
 * rue** : ce qui, au rez-de-chaussée d'un immeuble ordinaire, remplace le mur
 * par une vitrine et une enseigne. Un cabinet médical, un bureau ou une
 * bibliothèque n'en ont pas ; un café, une banque et un coiffeur en ont une.
 */
const SHOPFRONT_CLASSES = new Set([
  'alcohol_shop',
  'bank',
  'bar',
  'beer',
  'bicycle',
  'butcher',
  'cafe',
  'clothing_store',
  'fast_food',
  'grocery',
  'hairdresser',
  'ice_cream',
  'laundry',
  'music',
  'pharmacy',
  'post',
  'restaurant',
  'shop',
]);

/**
 * Ce qu'un point d'intérêt fait du bâtiment qui le contient, ou `null`.
 *
 * ## Pourquoi ici, et pas un objet posé par-dessus
 *
 * Un point d'intérêt désigne un vrai bâtiment ; poser un modèle séparé à ses
 * coordonnées revient à planter un décor **à côté** de ce bâtiment, que
 * l'empreinte réelle — plus grande, plus haute, ou juste mal centrée — finit
 * presque toujours par recouvrir. La bonne réponse est de donner au bâtiment
 * **qui existe déjà à cet endroit** une silhouette différente, pas d'en
 * ajouter un autre : c'est ce que fait `_appendBuilding`, qui lit ce classement
 * pour choisir la couleur, la forme du toit, la devanture, et — pour un lieu de
 * culte — un volume ajouté à la vraie empreinte plutôt qu'à côté.
 *
 * ## Le schéma, cette fois relevé et non supposé
 *
 * La version précédente cherchait la boulangerie sous `class: 'shop'` +
 * `subclass: 'bakery'`, et le grand magasin sous `class: 'shop'` : aucune des
 * deux n'existe, donc aucune des deux ne s'est jamais déclenchée. Les valeurs
 * ci-dessous sont **relevées** sur les tuiles réellement servies (OpenFreeMap,
 * schéma OpenMapTiles, z14), sur trois villes et un canton rural :
 *
 *     place_of_worship | christian, muslim, jewish
 *     hospital         | hospital, clinic
 *     bakery           | bakery
 *     grocery          | supermarket, department_store, deli, greengrocer…
 *     shop             | mall, clothes, optician… (une cinquantaine)
 *
 * Autrement dit `class` **est déjà** l'agrégat : la boulangerie y a sa propre
 * classe, le grand magasin est rangé sous l'épicerie, et `subclass` ne sert
 * qu'à distinguer la religion et la grande surface.
 *
 * Neuf points classés sur dix tombent dans une empreinte de la couche
 * `building`, relevé sur les mêmes tuiles. Le dixième est posé au centre d'une
 * parcelle, ou désigne un bâtiment absent de la donnée : il n'y a rien à
 * rattraper là, un bâtiment sans personnalité reste un bâtiment.
 *
 * Château, monument, tour, moulin, château d'eau, cheminée d'usine, grande
 * roue et stade restent du mobilier posé à part (`furnitureLayer`) : ce sont
 * de grandes structures visibles de loin, pas des bâtiments qu'une empreinte
 * ordinaire recouvrirait.
 *
 * Fonction pure.
 */
export function buildingPersonalityFor(properties = {}) {
  const klass = properties.class;
  const subclass = properties.subclass;
  if (klass === 'place_of_worship') return subclass === 'muslim' ? 'mosque' : 'church';
  if (klass === 'hospital') return 'hospital';
  if (RETAIL_SUBCLASSES.has(subclass)) return 'retail';
  if (klass === 'bakery') return 'bakery';
  if (SHOPFRONT_CLASSES.has(klass)) return 'shop';
  return null;
}

/**
 * Rang d'une personnalité quand il faut en écarter — petit d'abord.
 *
 * Un clocher se voit d'un kilomètre et il y en a un par village ; une devanture
 * se voit de la rue et il y en a deux mille par ville. Les traiter dans le même
 * ordre, c'est laisser les secondes manger le budget des premiers.
 */
export const BUILDING_PERSONALITY_RANK = {
  mosque: 0,
  church: 0,
  hospital: 1,
  retail: 2,
  bakery: 3,
  shop: 4,
};

/**
 * Trie les points d'intérêt classés et coupe au plafond : par rang d'abord,
 * par distance à l'observateur ensuite.
 *
 * C'est le pendant exact du tri des empreintes (voir `BUILDING_MAX_COUNT`), et
 * il manquait : les points étaient coupés **dans l'ordre des tuiles**, donc le
 * budget partait entier dans le coin nord-ouest de la bulle. En ville, il était
 * épuisé par les commerces de la première tuile avant d'avoir vu une seule
 * église — la fonctionnalité ne se déclenchait nulle part où l'on regardait.
 *
 * Fonction pure ; `list` n'est pas modifiée.
 *
 * @param {Array<{kind:string, distance:number}>} list
 * @param {number} [limit]
 */
export function sortPersonalities(list, limit = BUILDING_POI_MAX_COUNT) {
  const sorted = list.slice().sort((a, b) => {
    const ra = BUILDING_PERSONALITY_RANK[a.kind] ?? 99;
    const rb = BUILDING_PERSONALITY_RANK[b.kind] ?? 99;
    return ra === rb ? a.distance - b.distance : ra - rb;
  });
  if (sorted.length > limit) sorted.length = limit;
  return sorted;
}

/**
 * Habillage d'une personnalité, en couleurs **linéaires**, ou `null`.
 *
 * Les couleurs viennent du thème (`theme.personalities`) et non du nuancier du
 * mobilier : une devanture de boulangerie n'a rien à voir avec le bois d'un
 * banc, et les faire partager une valeur les ferait bouger ensemble.
 *
 * Mémorisé sur la tranche de thème elle-même, comme `townStyle` le fait pour
 * les palettes : la conversion coûte peu mais elle est appelée par bâtiment.
 */
const LINEAR_PERSONALITIES = new WeakMap();

export function personalityLookFor(kind, personalities = defaultTheme.personalities) {
  if (!kind || !personalities) return null;
  let table = LINEAR_PERSONALITIES.get(personalities);
  if (!table) {
    table = {};
    for (const [name, look] of Object.entries(personalities)) {
      table[name] = {
        wall: look.wall ? srgb(look.wall) : null,
        roof: look.roof ? srgb(look.roof) : null,
        shape: look.shape || null,
        front: look.front ? srgb(look.front) : null,
        spire: look.spire ? { wall: srgb(look.spire.wall), roof: srgb(look.spire.roof) } : null,
        dome: look.dome ? srgb(look.dome) : null,
        minaret: look.minaret ? srgb(look.minaret) : null,
      };
    }
    LINEAR_PERSONALITIES.set(personalities, table);
  }
  return table[kind] || null;
}

/**
 * Rayon autour de l'observateur au-delà duquel on ignore un bâtiment, en mètres.
 * La bulle porte à ~2 km ; au-delà de ce rayon, le brouillard a déjà fondu le
 * décor dans l'horizon.
 */
export const BUILDING_RADIUS_M = 1500;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const BUILDING_REBUILD_M = 200;
/** Hauteur retenue quand la donnée n'en porte aucune. */
export const BUILDING_DEFAULT_HEIGHT = 7;
/** Hauteur d'un niveau, quand seule `building:levels` est connue. */
export const BUILDING_LEVEL_HEIGHT = 3.2;
/** Plafond de sécurité : au-delà, la donnée est suspecte. */
export const BUILDING_MAX_HEIGHT = 120;
/**
 * Nombre maximal de bâtiments retenus par reconstruction.
 *
 * Le plafond ne protège pas le rendu — quinze cents empreintes font quelques
 * dizaines de milliers de sommets, ce qui n'est rien — mais le temps de
 * reconstruction. Il s'applique **après tri par distance** : appliqué dans
 * l'ordre d'arrivée, c'est-à-dire dans l'ordre des tuiles, il dépensait tout le
 * budget sur le coin nord-ouest de la bulle et laissait un trou juste à côté
 * de l'observateur.
 */
export const BUILDING_MAX_COUNT = 1500;

/**
 * Fenêtres allumées : portée, et plafond de panneaux.
 *
 * Une nuit sans fenêtre allumée est le moment où le décor cesse d'être crédible :
 * on traverse un village entier de blocs éteints. C'est aussi le seul éclairage
 * qui ne coûte rien — pas de lumière, pas d'ombre, juste des panneaux émissifs
 * qu'on n'allume que la nuit.
 *
 * La portée est bien plus courte que celle du bâti : à cinq cents mètres, une
 * fenêtre fait un quart de pixel, et il en faudrait des dizaines de milliers
 * pour couvrir toute la bulle.
 */
export const WINDOW_RADIUS_M = 420;
export const WINDOW_MAX_COUNT = 2600;

/**
 * Fenêtres **de jour** : portée, et plafond de baies.
 *
 * Elles sont une couche différente de celles de la nuit, et il faut le dire,
 * parce que ça ne se devine pas : la nuit, une fenêtre est une *lumière*, donc
 * un panneau additif, donc seulement celles qui sont allumées existent. Le
 * jour, une fenêtre est un *trou sombre* dans le mur — et elles existent
 * toutes. Un village de jour dont les murs sont lisses du sol à la gouttière
 * n'est pas un village, c'est un empilement de cartons, et c'était exactement
 * ce qu'on voyait.
 *
 * Ces baies-là vont donc dans la géométrie **opaque** du bâti, avec le mur
 * qu'elles percent : elles sont éclairées par le soleil comme lui, elles
 * s'assombrissent avec lui, et elles ne coûtent pas un appel de dessin de plus.
 *
 * La portée est plus courte que celle des fenêtres allumées : de jour, une baie
 * n'est qu'un contraste, et un contraste d'un demi-pixel n'est rien — là où une
 * fenêtre allumée dans la nuit se voit de loin.
 */
export const PANE_RADIUS_M = 300;
export const PANE_MAX_COUNT = 4200;

/** Débord de l'encadrement autour de la baie, en mètres. */
export const WINDOW_FRAME_M = 0.08;

/**
 * Le vitrage vu de dehors, de jour.
 *
 * Une vitre n'est pas noire et n'est pas uniforme : elle est sombre en bas, où
 * elle ne renvoie que l'intérieur de la pièce, et claire en haut, où elle
 * renvoie le ciel. Ce dégradé-là ne coûte rien — deux couleurs de sommet sur le
 * même quadrilatère — et c'est lui qui fait qu'une baie se lit comme du verre
 * plutôt que comme un rectangle de peinture.
 */
export const GLASS_DEEP = srgb('#39424c');
export const GLASS_SKY = srgb('#7f8d99');
/** L'encadrement : toujours plus clair que le mur, quel que soit le mur. */
export const WINDOW_FRAME_HEX = '#f2eee4';
export const WINDOW_FRAME_TINT = srgb(WINDOW_FRAME_HEX);
/**
 * Encre de l'enseigne peinte (`appendShopfront`) : le même ton que
 * l'encadrement des fenêtres, en CSS plutôt qu'en linéaire — c'est
 * `LabelAtlas` qui peint, au format que `CanvasRenderingContext2D` attend, et
 * `texture.colorSpace` qui reconvertit au moment de l'échantillonnage.
 */
export const SHOPFRONT_LABEL_INK = WINDOW_FRAME_HEX;

/**
 * Volets : largeur d'un battant en part de la baie, et part de fenêtres closes.
 *
 * Un battant ouvert vaut la moitié de la baie — c'est ce qu'il faut pour la
 * couvrir une fois refermé, et c'est ce qui donne au groupe « volet, fenêtre,
 * volet » sa proportion reconnaissable.
 *
 * Quelques fenêtres sont **fermées**, et elles comptent double : ce sont elles
 * qui donnent l'heure et la saison à une façade. Elles ne s'allument évidemment
 * pas la nuit.
 */
export const SHUTTER_WIDTH_RATIO = 0.5;
export const SHUTTER_CLOSED_SHARE = 0.14;
/**
 * Décollement du mur : encadrement, vitrage, volets. En mètres.
 *
 * Les trois plans sont espacés de trois à quatre centimètres, ce qui est plus
 * que ce qu'il faudrait pour l'œil et exactement ce qu'il faut pour le tampon
 * de profondeur : à trois cents mètres — la portée des baies — sa résolution
 * est de l'ordre du centimètre, et deux plans plus rapprochés que ça se
 * disputeraient le pixel. Les cotes restent plausibles : un volet **est** en
 * saillie sur une façade.
 */
export const WINDOW_LIFT_M = { frame: 0.04, glass: 0.075, shutter: 0.11 };

/**
 * Soubassement : hauteur de la plinthe, et sa part de la couleur du mur.
 *
 * Une vraie bande, avec une arête horizontale nette à sa cote — une arête ne
 * s'obtient pas en interpolant deux couleurs, elle s'obtient en posant deux
 * quadrilatères.
 */
export const PLINTH_HEIGHT_M = 0.62;
export const PLINTH_SHADE = 0.72;

/** Tirage déterministe dans [0, 1[ attaché à un lieu et à un rang. Pure. */
export function windowDraw(x, z, salt) {
  let h = (Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663) ^ ((salt | 0) * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Grille de fenêtres d'un pan de mur : rangs et niveaux effectivement posables.
 *
 * Fonction pure, et séparée parce que c'est le seul endroit où une erreur
 * d'arithmétique produirait des fenêtres à cheval sur l'arête d'un mur ou
 * flottant au-dessus de la gouttière.
 *
 * @param {number} length Longueur du pan, en mètres.
 * @param {number} height Hauteur du bâtiment, en mètres.
 * @returns {{columns:number, levels:number, spacing:number}}
 */
export function windowGrid(length, height, windows = defaultTheme.windows) {
  const spacing = windows.widthM * 2.6;
  // Une marge d'un demi-entraxe à chaque bout : une fenêtre n'est jamais au ras
  // de l'angle du mur.
  const columns = Math.floor((length - spacing) / spacing);
  const levels = Math.floor((height - windows.sillM - windows.heightM) / windows.levelM) + 1;
  return { columns: Math.max(0, columns), levels: Math.max(0, levels), spacing };
}

/**
 * Pousse un panneau vertical entre deux points au sol, dans un accumulateur.
 *
 * Tout ce qui est vertical dans cette couche passe par ici : un pan de mur, une
 * bande de soubassement, un encadrement, une vitre, un battant de volet, une
 * fenêtre allumée. C'est le même quadrilatère à chaque fois, et l'enroulement
 * est la seule chose délicate — notre plan (x, z) est de chiralité opposée au
 * plan (x, y) usuel, donc l'ordre « naturel » donnerait des faces visibles
 * seulement de l'intérieur du bâtiment.
 *
 * `a` et `b` portent leurs coordonnées au sol en `x` et `y` (l'axe `y` d'un
 * `Vector2` d'empreinte, qui est le `z` de la scène).
 *
 * @param {{positions:number[], normals:number[], colors:number[]}} buffer
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @param {number} bottom Cote basse.
 * @param {number} top    Cote haute.
 * @param {number} nx     Normale, composante x.
 * @param {number} nz     Normale, composante z.
 * @param {number[]} low  Couleur du bas.
 * @param {number[]} high Couleur du haut.
 */
export function pushPanel(buffer, a, b, bottom, top, nx, nz, low, high) {
  const corners = [
    [a.x, bottom, a.y, low],
    [b.x, top, b.y, high],
    [b.x, bottom, b.y, low],
    [a.x, bottom, a.y, low],
    [a.x, top, a.y, high],
    [b.x, top, b.y, high],
  ];
  for (const [x, y, z, color] of corners) {
    buffer.positions.push(x, y, z);
    buffer.normals.push(nx, 0, nz);
    buffer.colors.push(color[0], color[1], color[2]);
  }
}

/**
 * Cote du haut du soubassement, ou `null` s'il n'y a pas lieu d'en poser.
 *
 * Fonction pure. Deux cas l'écartent, et les deux se voient : une partie de
 * bâtiment **en surplomb** (`min_height`, un porche, un passage couvert) n'a pas
 * de plinthe parce qu'elle ne touche pas le sol, et un mur trop bas n'en a pas
 * non plus parce que la bande mangerait tout le mur — un abri de jardin
 * entièrement en soubassement ne ressemble à rien.
 *
 * @param {number} base      Assise du bâtiment, en mètres.
 * @param {number} minHeight Hauteur du dessous, en mètres.
 * @param {number} eaves     Cote de l'égout.
 * @returns {number|null}
 */
export function plinthTopFor(base, minHeight, eaves) {
  if (minHeight > 0.2) return null;
  const top = base + PLINTH_HEIGHT_M;
  return top < eaves - 1 ? top : null;
}

/**
 * Devanture : hauteur du bandeau de rez-de-chaussée d'un commerce.
 *
 * Un niveau, et pas moins : c'est ce qui distingue une vitrine d'un
 * soubassement, et c'est la seule échelle à laquelle un commerce se lise sans
 * repeindre l'immeuble entier.
 */
export const SHOPFRONT_HEIGHT_M = 3.05;

/**
 * Cote haute de la devanture, ou `null` s'il n'y a pas de rez-de-chaussée à
 * habiller. Même garde que le soubassement, en un peu plus large : un bandeau
 * de trois mètres sur un mur de trois mètres cinquante n'est plus un bandeau,
 * c'est le mur. Fonction pure.
 */
export function shopfrontTopFor(base, minHeight, eaves) {
  if (minHeight > 0.2) return null;
  const top = base + SHOPFRONT_HEIGHT_M;
  return top < eaves - 1.2 ? top : null;
}

/**
 * Proportions d'un clocher ou d'un minaret, en part du rectangle englobant du
 * bâtiment. Attention : `orientedBox` publie des **demi**-côtés, donc `short`
 * vaut la moitié de la largeur et `long` la moitié de la longueur.
 *
 * Ce sont des proportions et non des cotes parce qu'une cote fixe ne peut pas
 * être juste deux fois : la même tour est un mât sur une chapelle de campagne
 * et une allumette sur une collégiale.
 */
export const TOWER_SIDE_SHARE = 0.7;
export const TOWER_SIDE_MIN_M = 2.4;
export const TOWER_SIDE_MAX_M = 9;
export const TOWER_RISE_SHARE = 0.9;
export const TOWER_RISE_MIN_M = 6;
export const TOWER_RISE_MAX_M = 20;

/** Côté de la tour, jamais plus large que le bâtiment qui la porte. Pure. */
export function towerSide(box) {
  const side = Math.min(Math.max(box.short * TOWER_SIDE_SHARE, TOWER_SIDE_MIN_M), TOWER_SIDE_MAX_M);
  return Math.min(side, box.short * 1.8);
}

/** Ce que la tour dépasse le faîtage, en mètres. Pure. */
export function towerRise(box) {
  return Math.min(Math.max(box.long * TOWER_RISE_SHARE, TOWER_RISE_MIN_M), TOWER_RISE_MAX_M);
}

/**
 * Pied de la tour : vers un bout du grand axe, reculé d'assez pour que la tour
 * reste **dans** l'empreinte. Une tour qui déborde au bout de la nef est
 * exactement l'objet posé à côté que cette couche cherche à éviter.
 *
 * Fonction pure.
 */
export function towerFoot(box, side) {
  const reach = Math.max(0, box.long - side * 0.75);
  return { x: box.cx + Math.cos(box.angle) * reach, z: box.cz + Math.sin(box.angle) * reach };
}

/**
 * Hauteur d'un bâtiment d'après ses attributs, en mètres.
 * Fonction pure : les schémas de tuiles varient d'un fournisseur à l'autre, et
 * c'est exactement le genre d'endroit où une régression passe inaperçue.
 */
export function buildingHeight(properties = {}) {
  const candidates = [
    properties.render_height,
    properties.height,
    properties['building:height'],
  ];
  for (const raw of candidates) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.min(value, BUILDING_MAX_HEIGHT);
  }

  const levels = Number(properties.render_levels ?? properties.levels ?? properties['building:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(levels * BUILDING_LEVEL_HEIGHT, BUILDING_MAX_HEIGHT);
  }
  return BUILDING_DEFAULT_HEIGHT;
}

/** Hauteur du dessous du bâtiment (passages couverts, `min_height`). */
export function buildingMinHeight(properties = {}) {
  const value = Number(properties.render_min_height ?? properties.min_height ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, BUILDING_MAX_HEIGHT) : 0;
}

/**
 * Aire algébrique d'un anneau (formule du lacet). Le signe donne le sens de
 * parcours, dont dépend l'orientation des murs.
 * @param {Array<[number, number]>} ring
 */
export function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Centre approximatif d'un anneau, en moyenne de ses sommets. */
export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  // Le dernier point répète le premier dans un anneau GeoJSON fermé.
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/** Extrait les anneaux extérieurs d'une géométrie GeoJSON de bâtiment. */
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return [];
}

/**
 * Perce un pan de mur : encadrement, vitrage, volets — et, la nuit, la
 * lumière de celles qui sont allumées.
 *
 * ## Pourquoi tout n'est pas dans le même maillage
 *
 * Ce qui est **matière** — l'encadrement, la vitre, les volets — va dans la
 * géométrie opaque du bâti : c'est du mur, ça reçoit le soleil, ça
 * s'assombrit quand il tombe. Ce qui est **lumière** — la fenêtre allumée —
 * va dans le maillage additif, qui ne s'allume que la nuit. Mélanger les deux
 * donnerait soit des vitres qui brillent en plein jour, soit un village qui
 * ne s'allume jamais.
 *
 * ## Les décollements
 *
 * Les panneaux sont décollés du mur de quelques centimètres, en trois plans :
 * coplanaires, ils se disputeraient le pixel avec le mur et entre eux, et
 * clignoteraient. L'écart est trop petit pour se voir, et il est porté par la
 * normale du mur, donc il reste correct quelle que soit son orientation.
 *
 * ## Le déterminisme
 *
 * Quelle fenêtre est allumée, laquelle a ses volets tirés, de quelle teinte
 * est son ampoule : tout ne dépend **que de la position au sol et du rang**.
 * Le village garde donc les mêmes fenêtres allumées et les mêmes volets clos
 * d'une reconstruction à l'autre, là où un tirage libre les ferait clignoter
 * tous les 200 mètres parcourus.
 *
 * Fonction pure : elle ne lit que ses arguments, ce qui la rend testable sous
 * Node — et c'est le genre d'endroit où une erreur d'arithmétique produit une
 * fenêtre à cheval sur l'angle d'un mur ou un volet posé à l'envers.
 *
 * @param {Object} openings Budget : `{panes, budget, lit}`.
 * @param {Object} walls    Accumulateur de la géométrie opaque.
 * @param {{x:number, y:number}} a Début du pan, au sol.
 * @param {{x:number, y:number}} b Fin du pan, au sol.
 * @param {number} nx Normale sortante du mur, composante x.
 * @param {number} nz Normale sortante du mur, composante z.
 * @param {number} base      Assise du bâtiment.
 * @param {number} height    Hauteur du mur, de l'assise à l'égout.
 * @param {number} minHeight Hauteur du dessous (surplomb).
 * @param {Object} style    Habillage rendu par `buildingStyleAt`.
 * @param {Object} [look]   Dimensions de fenêtre du thème (`theme.windows`).
 * @param {Object} [options]
 * @param {boolean} [options.skipGroundLevel] Vrai si le rez-de-chaussée a déjà
 *        reçu sa propre devanture (`appendShopfront`) : le niveau 0 de la
 *        grille générique ne se pose alors pas par-dessus, seuls les étages
 *        au-dessus gardent leurs fenêtres ordinaires.
 */
export function appendOpenings(
  openings,
  walls,
  a,
  b,
  nx,
  nz,
  base,
  height,
  minHeight,
  style,
  look = defaultTheme.windows,
  { skipGroundLevel = false } = {}
) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const storeys = height - minHeight;
  if (length < 3 || storeys < look.sillM + look.heightM) return;

  const grid = windowGrid(length, storeys, look);
  const startLevel = skipGroundLevel ? 1 : 0;
  if (grid.columns === 0 || grid.levels <= startLevel) return;

  // Vecteur unitaire le long du mur, et sa normale déjà fournie.
  const ux = (b.x - a.x) / length;
  const uz = (b.y - a.y) / length;
  const half = look.widthM / 2;
  const frameHalf = half + WINDOW_FRAME_M;
  const shutterWidth = look.widthM * SHUTTER_WIDTH_RATIO;

  // Un point du mur, décalé le long de lui et décollé de lui.
  const at = (along, lift) => ({
    x: a.x + ux * along + nx * lift,
    z: a.y + uz * along + nz * lift,
  });

  for (let c = 0; c < grid.columns; c++) {
    const along = grid.spacing * (c + 1);

    for (let level = startLevel; level < grid.levels; level++) {
      if (openings.panes >= openings.budget) return;

      const anchor = at(along, 0);
      const sill = base + minHeight + look.sillM + level * look.levelM;
      const head = sill + look.heightM;
      const closed = style.shutters && windowDraw(anchor.x, anchor.z, level + 71) < SHUTTER_CLOSED_SHARE;

      // 1. L'encadrement : une bande claire tout autour de la baie. Sans lui,
      //    une fenêtre est un rectangle sombre collé sur un mur ; avec lui,
      //    c'est un percement. Il coûte un quadrilatère.
      const frame = at(along, WINDOW_LIFT_M.frame);
      pushPanel(
        walls,
        { x: frame.x - ux * frameHalf, y: frame.z - uz * frameHalf },
        { x: frame.x + ux * frameHalf, y: frame.z + uz * frameHalf },
        sill - WINDOW_FRAME_M,
        head + WINDOW_FRAME_M,
        nx,
        nz,
        WINDOW_FRAME_TINT,
        WINDOW_FRAME_TINT
      );

      // 2. Le vitrage — sauf volets clos, où il n'y a rien à voir derrière.
      if (!closed) {
        const glass = at(along, WINDOW_LIFT_M.glass);
        pushPanel(
          walls,
          { x: glass.x - ux * half, y: glass.z - uz * half },
          { x: glass.x + ux * half, y: glass.z + uz * half },
          sill,
          head,
          nx,
          nz,
          GLASS_DEEP,
          GLASS_SKY
        );
      }

      // 3. Les volets : deux battants, ouverts de part et d'autre de la baie,
      //    ou rabattus dessus. Seules les maisons en portent — un immeuble ou
      //    un hangar n'en a pas, et c'est ce qui les distingue de loin.
      if (style.shutters) {
        const leaf = at(along, WINDOW_LIFT_M.shutter);
        // Ouverts, les battants sont contre l'encadrement, dehors ; fermés,
        // ils se rejoignent au milieu de la baie.
        const inner = closed ? 0 : frameHalf;
        const outer = closed ? half : frameHalf + shutterWidth;
        // Les deux bornes sont **toujours** passées dans l'ordre croissant le
        // long du mur : l'enroulement de `pushPanel` en dépend, et un battant
        // pris à l'envers a sa face avant tournée vers l'intérieur — donc
        // supprimé par le tri des faces arrière, donc invisible.
        for (const [from, to] of [
          [-outer, -inner],
          [inner, outer],
        ]) {
          pushPanel(
            walls,
            { x: leaf.x + ux * from, y: leaf.z + uz * from },
            { x: leaf.x + ux * to, y: leaf.z + uz * to },
            sill - WINDOW_FRAME_M,
            head + WINDOW_FRAME_M,
            nx,
            nz,
            style.shutter,
            style.shutter
          );
        }
      }

      openings.panes++;

      // 4. La lumière. Une fenêtre aux volets clos ne s'allume pas : c'est
      //    précisément ce qu'on voit d'une rue de village la nuit.
      const lit = openings.lit;
      if (!lit || closed) continue;
      if (lit.positions.length / 9 >= WINDOW_MAX_COUNT) continue;
      const glow = at(along, WINDOW_LIFT_M.glass);
      if (windowDraw(glow.x, glow.z, level + 1) > look.litShare) continue;

      // Teinte de l'ampoule : du blanc froid au jaune franc, tirée par
      // fenêtre. Toutes de la même couleur, un village ressemble à un écran.
      const warmth = windowDraw(glow.x, glow.z, level + 41);
      const color = [0.95, 0.78 + warmth * 0.16, 0.42 + warmth * 0.3];
      pushPanel(
        lit,
        { x: glow.x - ux * half, y: glow.z - uz * half },
        { x: glow.x + ux * half, y: glow.z + uz * half },
        sill,
        head,
        nx,
        nz,
        color,
        color
      );
    }
  }
}

/**
 * Hauteur de case visée pour le nom peint sur une enseigne, en mètres — voir
 * `appendShopfront`. Nettement moins que `SHOPFRONT_FASCIA_HEIGHT_M` du
 * thème : de la marge reste au-dessus et en dessous du texte, sans quoi une
 * lettre haute (« É », un jambage) toucherait le bord du bandeau. La largeur
 * se réduit d'elle-même si le nom est trop long (`fitLabelText`), jamais la
 * hauteur — cette case est un plafond, pas une cible qu'on grossirait pour
 * l'atteindre.
 */
export const SHOPFRONT_LABEL_HEIGHT_M = 0.42;
export const SHOPFRONT_LABEL_MIN_HEIGHT_M = 0.14;

/**
 * Découpe un pan de devanture en baies et, si la place le permet, une large
 * baie d'entrée centrale — voir l'en-tête de `theme.shopfront` sur pourquoi
 * une baie plutôt qu'une porte.
 *
 * Fonction pure : les décalages (`offset`) sont comptés depuis le **milieu**
 * du pan, dans les deux sens, ce qui centre naturellement la composition sans
 * qu'`appendShopfront` ait à s'en soucier.
 *
 * @param {number} length Longueur du pan, en mètres.
 * @param {Object} [theme] `theme.shopfront`.
 * @returns {Array<{offset:number, halfWidth:number, door:boolean}>|null}
 *          `null` si même une seule baie ne tient pas sur ce pan.
 */
export function shopfrontLayout(length, theme = defaultTheme.shopfront) {
  const { windowWidthM, doorWidthM, marginM, gapM } = theme;
  const usable = length - marginM * 2;
  if (usable < windowWidthM) return null;

  const modules = [];
  if (usable >= doorWidthM) {
    modules.push({ offset: 0, halfWidth: doorWidthM / 2, door: true });
    for (const dir of [-1, 1]) {
      let edge = doorWidthM / 2 + gapM;
      while (edge + windowWidthM <= usable / 2) {
        modules.push({ offset: dir * (edge + windowWidthM / 2), halfWidth: windowWidthM / 2, door: false });
        edge += windowWidthM + gapM;
      }
    }
  } else {
    // Trop étroit pour une porte : uniquement des baies, comme un mur
    // ordinaire mais entièrement vitré.
    const count = Math.floor((usable + gapM) / (windowWidthM + gapM));
    if (count === 0) return null;
    const used = count * windowWidthM + (count - 1) * gapM;
    const start = -used / 2 + windowWidthM / 2;
    for (let i = 0; i < count; i++) {
      modules.push({ offset: start + i * (windowWidthM + gapM), halfWidth: windowWidthM / 2, door: false });
    }
  }
  return modules.sort((m1, m2) => m1.offset - m2.offset);
}

/**
 * Perce la devanture d'un commerce sur son pan de façade : des baies, une
 * large baie d'entrée si la place le permet (`shopfrontLayout`), et
 * l'enseigne peinte au-dessus — voir l'en-tête de `materials/labelAtlas.js`
 * pour pourquoi un nom passe par une texture plutôt que par la géométrie.
 *
 * Le rez-de-chaussée générique (`appendOpenings`) ne se pose pas ici : c'est
 * l'appelant qui décide, une fois qu'il sait si cette fonction a vraiment
 * dessiné quelque chose (voir sa valeur de retour).
 *
 * @param {Object} openings Budget de baies — le même que celui que lirait
 *        `appendOpenings` pour ce pan, partagé pour que la devanture compte
 *        dans le même plafond que le reste des fenêtres.
 * @param {Object} walls  Accumulateur de la géométrie opaque.
 * @param {Object} labels Accumulateur `{positions, uvs}` du texte peint.
 * @param {Object|null} atlas Instance `LabelAtlas`, ou `null` si les noms ne
 *        sont pas tenus à jour (repli sûr : le bandeau reste peint, sans nom).
 * @param {{x:number,y:number}} a Début du pan.
 * @param {{x:number,y:number}} b Fin du pan.
 * @param {number} nx Normale sortante, composante x.
 * @param {number} nz Normale sortante, composante z.
 * @param {number} base Assise du bâtiment.
 * @param {number} shopfrontTop Cote haute de la devanture (`shopfrontTopFor`).
 * @param {number} minHeight Hauteur du dessous (surplomb).
 * @param {string|null} name Nom du commerce, ou `null`.
 * @param {Object} [theme] `theme.shopfront`.
 * @returns {boolean} vrai si une devanture articulée a été posée — l'appelant
 *          s'en sert pour savoir si le rez-de-chaussée générique doit encore
 *          se poser par-dessus.
 */
export function appendShopfront(
  openings,
  walls,
  labels,
  atlas,
  a,
  b,
  nx,
  nz,
  base,
  shopfrontTop,
  minHeight,
  name,
  theme = defaultTheme.shopfront
) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const modules = shopfrontLayout(length, theme);
  if (!modules) return false;

  const ux = (b.x - a.x) / length;
  const uz = (b.y - a.y) / length;
  // Même convention que le `at()` interne d'`appendOpenings` : un point du
  // mur, décalé le long de lui et décollé de lui — `.z` porte le `y` du plan
  // (x, y) de l'empreinte, qui est le `z` de la scène.
  const at = (along, lift) => ({ x: a.x + ux * along + nx * lift, z: a.y + uz * along + nz * lift });

  const sill = base + minHeight + theme.sillM;
  const head = shopfrontTop - theme.fasciaHeightM - theme.fasciaGapM;
  if (head <= sill) return false;

  for (const module of modules) {
    if (openings && openings.panes >= openings.budget) break;
    const along = length / 2 + module.offset;
    const frameHalf = module.halfWidth + WINDOW_FRAME_M;

    const frame = at(along, WINDOW_LIFT_M.frame);
    pushPanel(
      walls,
      { x: frame.x - ux * frameHalf, y: frame.z - uz * frameHalf },
      { x: frame.x + ux * frameHalf, y: frame.z + uz * frameHalf },
      sill - WINDOW_FRAME_M,
      head + WINDOW_FRAME_M,
      nx,
      nz,
      WINDOW_FRAME_TINT,
      WINDOW_FRAME_TINT
    );

    const glass = at(along, WINDOW_LIFT_M.glass);
    pushPanel(
      walls,
      { x: glass.x - ux * module.halfWidth, y: glass.z - uz * module.halfWidth },
      { x: glass.x + ux * module.halfWidth, y: glass.z + uz * module.halfWidth },
      sill,
      head,
      nx,
      nz,
      GLASS_DEEP,
      GLASS_SKY
    );

    if (openings) openings.panes++;
  }

  // L'enseigne : peinte sur le bandeau déjà en place au-dessus des baies —
  // voir l'en-tête de `theme.shopfront`, il n'y a pas de panneau séparé à
  // ajouter, la couleur de la devanture couvre déjà toute la hauteur.
  if (atlas && labels && name) {
    const availableWidthM = length - theme.marginM * 2;
    const maxWidthPx = Math.max(1, availableWidthM * LABEL_PX_PER_M);
    const maxFontPx = labelFontPxForCellHeight(SHOPFRONT_LABEL_HEIGHT_M * LABEL_PX_PER_M);
    const minFontPx = labelFontPxForCellHeight(SHOPFRONT_LABEL_MIN_HEIGHT_M * LABEL_PX_PER_M);
    const uv = atlas.place(name, { maxWidthPx, maxFontPx, minFontPx, color: SHOPFRONT_LABEL_INK });
    if (uv) {
      const halfWidth = uv.widthPx / LABEL_PX_PER_M / 2;
      const textHeight = uv.heightPx / LABEL_PX_PER_M;
      const fasciaMid = shopfrontTop - theme.fasciaHeightM / 2;
      const centre = at(length / 2, WINDOW_LIFT_M.glass);
      pushLabelQuad(
        labels,
        { x: centre.x - ux * halfWidth, y: centre.z - uz * halfWidth },
        { x: centre.x + ux * halfWidth, y: centre.z + uz * halfWidth },
        fasciaMid - textHeight / 2,
        fasciaMid + textHeight / 2,
        uv
      );
    }
  }

  return true;
}

/** Pictogramme d'une classe `poi` brute, ou le repli générique. Fonction pure. */
export function shopfrontEmojiFor(klass, theme = defaultTheme.shopfront) {
  return theme.emoji[klass] || theme.emojiDefault;
}

/**
 * Côté du panneau, en mètres — le petit carré collé au mur, et le pictogramme
 * qui y est peint.
 */
export const BLADE_SIGN_SIZE_M = 0.9;
/** Distance du mur au centre du panneau, en mètres — la longueur du bras. */
export const BLADE_SIGN_REACH_M = 0.55;
/** Hauteur du centre du panneau au-dessus du sol, en mètres — dégagement piéton. */
export const BLADE_SIGN_HEIGHT_M = 2.55;
/** Décalage du panneau depuis le bord du pan, en mètres. */
export const BLADE_SIGN_INSET_M = 0.9;
/** Hauteur de casse visée pour le pictogramme, en mètres. */
export const BLADE_SIGN_ICON_HEIGHT_M = 0.8;
/**
 * Épaisseur du panneau, en mètres — deux faces réellement séparées, pas la
 * même face doublée sans épaisseur : posé de champ, un panneau de papier ne
 * se voit pas, un vrai panneau si, ne serait-ce que par l'arête qu'il montre
 * de biais.
 */
export const BLADE_SIGN_THICKNESS_M = 0.1;
/** Hauteur d'une tige de fixation, en mètres — un plat, pas une tringle ronde. */
export const BLADE_SIGN_ROD_HEIGHT_M = 0.05;
/** Retrait d'une tige depuis le bord haut ou bas du panneau, en mètres. */
export const BLADE_SIGN_ROD_INSET_M = 0.08;
/** Métal galvanisé des tiges — le même ton que le mobilier, voir
 *  `theme.furniture.colors.galvanised`. */
const BLADE_SIGN_ROD_COLOR = srgb('#b8bcc0');

/**
 * Enseigne en drapeau : un petit panneau planté perpendiculairement au mur,
 * porté par deux tiges plutôt que collé au mur — sans elles, rien ne dit
 * pourquoi il flotte là. Lisible par qui remonte le trottoir plutôt que par
 * qui fait face à la devanture : c'est la seule enseigne, réelle, à
 * s'adresser au piéton et non au client déjà arrêté devant la vitrine. Elle
 * porte un pictogramme (`shopfrontEmojiFor`) plutôt que le nom : à cette
 * distance et sous cet angle, une icône se lit, un nom ne se lirait pas.
 *
 * Posée près d'un bout du pan de façade plutôt qu'en son centre — une vraie
 * enseigne en drapeau ne bloque jamais l'entrée qu'elle signale.
 *
 * Panneau, tiges et pictogramme sont tous doublés, enroulement inversé, pour
 * se lire des deux sens de marche sur le trottoir : c'est `pushPanel` et
 * `pushLabelQuad` échangés en `a`/`b` qui font l'un l'exact revers de
 * l'autre — voir la note de `pushLabelQuad` sur ce que l'échange inverse.
 *
 * Ne dépend pas d'`appendShopfront` : une façade trop étroite pour une porte
 * garde son enseigne en drapeau, seule la devanture au sol s'efface.
 *
 * @param {Object} walls  Accumulateur de la géométrie opaque.
 * @param {Object} labels Accumulateur `{positions, uvs}` du texte peint.
 * @param {Object|null} atlas Instance `LabelAtlas`, ou `null` pour ne rien peindre.
 * @param {{x:number,y:number}} a Début du pan.
 * @param {{x:number,y:number}} b Fin du pan.
 * @param {number} nx Normale sortante, composante x.
 * @param {number} nz Normale sortante, composante z.
 * @param {number} base Assise du bâtiment.
 * @param {number} minHeight Hauteur du dessous (surplomb).
 * @param {string|null} klass Classe brute du point d'intérêt (`shopfrontEmojiFor`).
 * @param {Object} [theme] `theme.shopfront` — sa table `emoji`/`emojiDefault`.
 */
export function appendShopSignBlade(walls, labels, atlas, a, b, nx, nz, base, minHeight, klass, theme = defaultTheme.shopfront) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const inset = Math.min(BLADE_SIGN_INSET_M, length / 2);
  if (inset <= 0) return;

  const ux = (b.x - a.x) / length;
  const uz = (b.y - a.y) / length;
  const mountX = a.x + ux * inset;
  const mountZ = a.y + uz * inset;
  const mountY = base + minHeight + BLADE_SIGN_HEIGHT_M;

  const half = BLADE_SIGN_SIZE_M / 2;
  const inner = { x: mountX + nx * (BLADE_SIGN_REACH_M - half), y: mountZ + nz * (BLADE_SIGN_REACH_M - half) };
  const outer = { x: mountX + nx * (BLADE_SIGN_REACH_M + half), y: mountZ + nz * (BLADE_SIGN_REACH_M + half) };
  const bottom = mountY - half;
  const top = mountY + half;

  // Le panneau de fond : deux vraies faces, décollées le long de la tangente
  // du mur (`ux, uz`) — c'est cet axe-là que la normale géométrique de
  // chaque face regarde (voir la note de `pushLabelQuad`), donc c'est lui
  // qui donne l'épaisseur, pas la normale du mur (`nx, nz`), qui donne la
  // portée du bras.
  const halfThickness = BLADE_SIGN_THICKNESS_M / 2;
  const offset = (p, sign) => ({ x: p.x + ux * sign * halfThickness, y: p.y + uz * sign * halfThickness });
  const innerFront = offset(inner, -1);
  const outerFront = offset(outer, -1);
  const innerBack = offset(inner, 1);
  const outerBack = offset(outer, 1);
  pushPanel(walls, innerFront, outerFront, bottom, top, nx, nz, WINDOW_FRAME_TINT, WINDOW_FRAME_TINT);
  pushPanel(walls, outerBack, innerBack, bottom, top, -nx, -nz, WINDOW_FRAME_TINT, WINDOW_FRAME_TINT);

  // Deux tiges, du mur à la face intérieure du panneau, une près de chaque
  // bord — un plat fin plutôt qu'un rond, pour rester une paire de
  // `pushPanel` comme tout le reste de cette fonction.
  const rodHalf = BLADE_SIGN_ROD_HEIGHT_M / 2;
  const wallPoint = { x: mountX, y: mountZ };
  for (const rodY of [bottom + BLADE_SIGN_ROD_INSET_M, top - BLADE_SIGN_ROD_INSET_M]) {
    pushPanel(
      walls,
      wallPoint,
      inner,
      rodY - rodHalf,
      rodY + rodHalf,
      nx,
      nz,
      BLADE_SIGN_ROD_COLOR,
      BLADE_SIGN_ROD_COLOR
    );
    pushPanel(
      walls,
      inner,
      wallPoint,
      rodY - rodHalf,
      rodY + rodHalf,
      -nx,
      -nz,
      BLADE_SIGN_ROD_COLOR,
      BLADE_SIGN_ROD_COLOR
    );
  }

  if (!atlas || !labels) return;

  const emoji = shopfrontEmojiFor(klass, theme);
  const maxFontPx = labelFontPxForCellHeight(BLADE_SIGN_ICON_HEIGHT_M * LABEL_PX_PER_M);
  const uv = atlas.place(emoji, { maxWidthPx: maxFontPx * 2, maxFontPx, minFontPx: maxFontPx });
  if (!uv) return;

  // Centré sur la largeur du panneau (`BLADE_SIGN_REACH_M`), à sa propre
  // taille mesurée — pas à celle du panneau : un pictogramme carré étiré sur
  // un panneau plus large que haut se déformerait en ovale.
  const iconHalf = uv.widthPx / LABEL_PX_PER_M / 2;
  const iconHalfHeight = uv.heightPx / LABEL_PX_PER_M / 2;
  const iconInner = {
    x: mountX + nx * (BLADE_SIGN_REACH_M - iconHalf),
    y: mountZ + nz * (BLADE_SIGN_REACH_M - iconHalf),
  };
  const iconOuter = {
    x: mountX + nx * (BLADE_SIGN_REACH_M + iconHalf),
    y: mountZ + nz * (BLADE_SIGN_REACH_M + iconHalf),
  };

  // Décollé de chaque face du panneau — plus loin que son épaisseur, sans
  // quoi le pictogramme se disputerait le pixel avec la face qu'il recouvre,
  // même raison que `WINDOW_LIFT_M` ailleurs.
  const lift = halfThickness + 0.01;
  const iconInnerFront = { x: iconInner.x - ux * lift, y: iconInner.y - uz * lift };
  const iconOuterFront = { x: iconOuter.x - ux * lift, y: iconOuter.y - uz * lift };
  const iconInnerBack = { x: iconInner.x + ux * lift, y: iconInner.y + uz * lift };
  const iconOuterBack = { x: iconOuter.x + ux * lift, y: iconOuter.y + uz * lift };

  pushLabelQuad(labels, iconInnerFront, iconOuterFront, mountY - iconHalfHeight, mountY + iconHalfHeight, uv);
  pushLabelQuad(labels, iconOuterBack, iconInnerBack, mountY - iconHalfHeight, mountY + iconHalfHeight, uv);
}

export class BuildingLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.mesh = null;
    this.geometry = null;
    this._anchor = null;
    this._frame = null;
    this.count = 0;
    this.windowCount = 0;
    this.paneCount = 0;
    /**
     * Maisons de la dernière reconstruction, publiées pour `gardenLayer` :
     * leur centre et le rectangle orienté qui porte déjà leur toit.
     * @type {Array<{x:number,z:number,box:Object}>}
     */
    this.houses = [];
    /**
     * Centres de **tous** les bâtiments élevés, publiés pour `streetLayer`.
     *
     * Distinct de `houses`, et volontairement : la question posée par la voirie
     * n'est pas « où sont les maisons ? » mais « est-ce bâti ici ? », et une
     * grange, un atelier ou un immeuble y répondent aussi bien qu'un pavillon.
     * Un centre suffit — ni forme ni taille ne servent à cette question.
     * @type {Array<{x:number,z:number}>}
     */
    this.footprints = [];
    /**
     * Points d'intérêt classés de la dernière reconstruction — voir
     * `buildingPersonalityFor` — publiés pour l'étiquetage de mise au point
     * (`inspect/objectLabels`). Une église, une mosquée ou une boulangerie ne
     * sont **pas** un maillage à part (voir l'en-tête du fichier : la
     * personnalité redécore l'empreinte qui la contient, elle ne pose rien à
     * côté), donc rien dans la scène ne porte leur nom — seul ce tableau le
     * sait encore après coup.
     * @type {Array<{x:number,z:number,kind:string,distance:number}>}
     */
    this.personalities = [];

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Fenêtres allumées : un matériau à part, non éclairé et additif, dont
    // l'opacité suit l'heure. Un `MeshBasicMaterial` suffit — une fenêtre
    // allumée émet sa lumière, elle n'en reçoit pas.
    this.windowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Le brouillard s'applique : une fenêtre à trois cents mètres dans la
      // brume doit s'y noyer comme le mur qui la porte.
      fog: true,
    });
    this.windowMaterial.name = 'building-windows';
    this.windowMesh = null;
    this.windowGeometry = null;

    // Enseignes : un nom peint est une texture, pas une couleur de sommet —
    // voir l'en-tête de `materials/labelAtlas.js`. Éclairé comme le mur qui
    // le porte serait plus juste au crépuscule, mais une enseigne réelle est
    // presque toujours elle-même une source (vitrine éclairée, lettres
    // rétroéclairées) : rester non éclairé, comme les fenêtres allumées,
    // reste le plus honnête des deux raccourcis.
    this.labelAtlas = new LabelAtlas({ THREE, width: 2048, height: 1024 });
    this.labelMaterial = new THREE.MeshBasicMaterial({
      map: this.labelAtlas.texture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      fog: true,
    });
    this.labelMaterial.name = 'building-labels';
    this.labelMesh = null;
    this.labelGeometry = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= BUILDING_REBUILD_M;
  }

  /**
   * Reconstruit le bâti depuis les tuiles déjà décodées.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @returns {boolean} vrai si des bâtiments ont été produits.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;
    this._build(source, tiles, here);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return this.count > 0;
  }

  _build(source, tiles, here) {
    const { THREE, bubble } = this;
    const frame = bubble.frame;
    const { origin, scale, zoom } = frame;

    const walls = { positions: [], normals: [], colors: [] };
    const lamps = { positions: [], normals: [], colors: [] };
    const labels = { positions: [], uvs: [] };
    const houses = [];
    // Vidée avant d'être remplie : la géométrie qui référence ses cases
    // (`labels`, ci-dessus) est de toute façon intégralement refaite dans
    // cette même passe — voir l'en-tête de `LabelAtlas`.
    this.labelAtlas.reset();
    // Les empreintes sont découpées par les tuiles : une même bâtisse revient
    // d'une tuile à l'autre. On dédoublonne sur un centre au demi-mètre, croisé
    // avec le nombre de sommets — deux bâtisses voisines peuvent partager un
    // centre arrondi, pas une silhouette.
    const seen = new Set();
    const candidates = [];

    source.forEachFeature(BUILDING_SOURCE_LAYER, tiles, (geometry, properties) => {
      for (const ring of outerRings(geometry)) {
        if (!Array.isArray(ring) || ring.length < 4) continue;

        const [cLng, cLat] = ringCentroid(ring);
        const x = (lngToTileX(cLng, zoom) - origin.x) * scale;
        const z = (latToTileY(cLat, zoom) - origin.y) * scale;
        const distance = Math.hypot(x - here.x, z - here.z);
        if (distance > BUILDING_RADIUS_M) continue;

        const key = `${Math.round(x * 2)},${Math.round(z * 2)},${ring.length}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({ ring, properties, distance, x, z });
      }
    });

    // Points d'intérêt classés : voir `buildingPersonalityFor`. Collectés une
    // fois pour toute la reconstruction — chaque empreinte les relit ensuite
    // pour savoir si l'un d'eux tombe dedans (voir `_appendBuilding`).
    //
    // Tous les points à portée sont ramassés, puis triés et coupés : c'est le
    // tri qui décide de ce qui saute, jamais l'ordre des tuiles. Voir
    // `sortPersonalities`.
    const collected = [];
    source.forEachFeature(BUILDING_POI_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (geometry.type !== 'Point') return;
      const kind = buildingPersonalityFor(properties);
      if (!kind) return;
      const [lng, lat] = geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const x = (lngToTileX(lng, zoom) - origin.x) * scale;
      const z = (latToTileY(lat, zoom) - origin.y) * scale;
      const distance = Math.hypot(x - here.x, z - here.z);
      if (distance > BUILDING_RADIUS_M) return;
      collected.push({ x, z, kind, distance, name: properties.name || null, class: properties.class || null });
    });
    const personalities = sortPersonalities(collected);

    // Le tri est ce qui rend le plafond acceptable : ce qui saute est toujours
    // le plus lointain, jamais ce qui est sous les yeux.
    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates.length > BUILDING_MAX_COUNT) {
      console.info(
        `[buildingLayer] ${candidates.length} empreintes dans ${BUILDING_RADIUS_M} m, ` +
          `plafonnées à ${BUILDING_MAX_COUNT} — les plus lointaines sont écartées`
      );
      candidates.length = BUILDING_MAX_COUNT;
    }

    let built = 0;
    let panes = 0;
    const footprints = [];
    for (const candidate of candidates) {
      // Deux portées, et elles ne sont pas les mêmes : de jour la baie n'est
      // qu'un contraste dans un mur, de nuit c'est une lumière dans le noir. La
      // seconde porte donc bien plus loin que la première.
      const openings =
        candidate.distance <= PANE_RADIUS_M && panes < PANE_MAX_COUNT
          ? {
              panes: 0,
              lit: candidate.distance <= WINDOW_RADIUS_M && lamps.positions.length / 9 < WINDOW_MAX_COUNT
                ? lamps
                : null,
              budget: PANE_MAX_COUNT - panes,
            }
          : null;
      if (
        this._appendBuilding(candidate.ring, candidate.properties, walls, openings, houses, personalities, labels)
      ) {
        built++;
        footprints.push({ x: candidate.x, z: candidate.z });
      }
      if (openings) panes += openings.panes;
    }

    this.count = built;
    this.paneCount = panes;
    this.windowCount = lamps.positions.length / 9;
    this.houses = houses;
    this.footprints = footprints;
    this.personalities = personalities;
    this._applyWindows(lamps);
    this._applyLabels(labels);
    if (walls.positions.length === 0) {
      this._clearMesh();
      return;
    }

    const geometryBuffer = new THREE.BufferGeometry();
    geometryBuffer.setAttribute('position', new THREE.Float32BufferAttribute(walls.positions, 3));
    geometryBuffer.setAttribute('normal', new THREE.Float32BufferAttribute(walls.normals, 3));
    geometryBuffer.setAttribute('color', new THREE.Float32BufferAttribute(walls.colors, 3));
    geometryBuffer.computeBoundingSphere();

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometryBuffer;
    } else {
      const mesh = new THREE.Mesh(geometryBuffer, this.material);
      mesh.name = 'buildings';
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometryBuffer;
  }

  /**
   * @param {Object} walls Accumulateur de la géométrie opaque — murs, toits,
   *        et les baies de jour, qui sont du mur percé et non de la lumière.
   * @param {Object|null} openings Budget d'ouvertures, ou `null` pour un
   *        bâtiment trop lointain pour en mériter.
   * @param {Array} houses Maisons publiées pour la couche des jardins.
   * @param {Array|null} personalities Points d'intérêt classés
   *        (`buildingPersonalityFor`), pour donner sa personnalité au
   *        bâtiment dont l'empreinte les contient — voir plus bas.
   * @param {Object|null} labels Accumulateur `{positions, uvs}` des enseignes
   *        peintes (`appendShopfront`), ou `null` pour ne pas en poser.
   * @returns {boolean} vrai si le bâtiment a produit de la géométrie.
   */
  _appendBuilding(ring, properties, walls, openings = null, houses = null, personalities = null, labels = null) {
    const { THREE, bubble } = this;
    const { origin, scale, zoom } = bubble.frame;

    // Anneau en mètres locaux, sans le point de fermeture répété.
    const points = [];
    const closed =
      ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const last = closed ? ring.length - 1 : ring.length;
    for (let i = 0; i < last; i++) {
      const [lng, lat] = ring[i];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      points.push(new THREE.Vector2((lngToTileX(lng, zoom) - origin.x) * scale, (latToTileY(lat, zoom) - origin.y) * scale));
    }
    if (points.length < 3) return false;

    // Assise : le point le plus bas de l'empreinte. Sur une pente, poser le
    // bâtiment à l'altitude de son centre le ferait flotter d'un côté.
    // On retient aussi le point le plus haut : le toit doit le dépasser de
    // `height`, sinon sur un terrain montant le bâtiment paraît enfoncé dans
    // le sol du côté haut alors que ses murs, eux, partent bien de l'assise.
    let base = Infinity;
    let crest = -Infinity;
    for (const p of points) {
      const ground = bubble.surfaceElevationAtLocal(p.x, p.y) * bubble.verticalScale;
      if (ground < base) base = ground;
      if (ground > crest) crest = ground;
    }
    if (!Number.isFinite(base)) return false;

    const height = buildingHeight(properties);
    const minHeight = buildingMinHeight(properties);
    const bottom = base + minHeight - 0.6; // un peu enterré : pas de jour sous les murs
    const top = crest + height;

    // Sens de parcours : il détermine de quel côté regardent les murs.
    const area = ringSignedArea(points.map((p) => [p.x, p.y]));
    const ordered = area < 0 ? points.slice().reverse() : points;

    // Couleur et forme du toit : celles du **bourg**, avec une variation par
    // maison. Voir `townStyle` — les tuiles ne portent ni matériau ni forme de
    // toit, mais la vraie régularité du bâti n'est pas à l'échelle de la maison,
    // elle est à celle du pays.
    const footprint = ordered.map((p) => ({ x: p.x, z: p.y }));
    const box = orientedBox(footprint);
    const ground = ringArea(footprint);
    const style = buildingStyleAt(
      footprint[0].x,
      footprint[0].z,
      { area: ground, height },
      this.theme.towns
    );

    // Personnalité : le premier point d'intérêt qui tombe dans l'empreinte
    // l'emporte — voir `buildingPersonalityFor`. La liste est déjà triée par
    // rang, donc « le premier » veut dire le plus marquant : dans un bâtiment
    // qui porte à la fois une église et une boutique de souvenirs, c'est
    // l'église. Un bâtiment n'a qu'une personnalité.
    let personality = null;
    // Nom du point d'intérêt qui a donné sa personnalité au bâtiment — utile
    // seulement pour un commerce (voir `appendShopfront`), mais capturé ici
    // pour tous : c'est le même point, et le coût de garder son nom est nul.
    let personalityName = null;
    // Classe brute du point d'intérêt (`properties.class`, pas le `kind`
    // agrégé de `buildingPersonalityFor`) — c'est elle qui choisit le
    // pictogramme de l'enseigne perpendiculaire (`shopfrontEmojiFor`) : une
    // boulangerie et un bar sont tous deux `kind: 'shop'`, mais pas la même
    // enseigne.
    let personalityClass = null;
    if (personalities && box) {
      // Rejet grossier avant le test d'anneau : le rectangle englobant est déjà
      // calculé, et il écarte d'un coup la quasi-totalité des points. Sans lui,
      // le coût est le produit des deux plafonds — quinze cents empreintes par
      // six cents points, à chaque reconstruction.
      //
      // La somme des deux demi-côtés, et non le seul demi-grand-côté : un
      // rectangle en biais s'étend en x de `long·|cos θ| + short·|sin θ|`, donc
      // au plus de leur somme. Plus serré, le garde écarterait des points qui
      // sont réellement dedans.
      const reach = box.long + box.short;
      for (const p of personalities) {
        if (Math.abs(p.x - box.cx) > reach || Math.abs(p.z - box.cz) > reach) continue;
        if (pointInRing(footprint, p.x, p.z)) {
          personality = p.kind;
          personalityName = p.name || null;
          personalityClass = p.class || null;
          break;
        }
      }
    }
    const look = personalityLookFor(personality, this.theme.personalities);
    // Un habillage de fonction ne remplace que ce qu'il nomme : une église
    // garde les murs de son bourg, seul le clocher la désigne.
    const wallColor = look?.wall || style.wall;
    const roofColor = look?.roof || style.roof;

    // Publication des maisons : la couche des jardins en a besoin, et elle n'a
    // aucun moyen de les retrouver seule — c'est ici, et seulement ici, que
    // l'empreinte, l'assise et le rectangle orienté existent en même temps.
    // Rien n'est branché : `worldComposer` passe la liste, comme il passe les
    // cheminées du mobilier à `lifeLayer`.
    if (houses && box && style.house) {
      houses.push({ x: box.cx, z: box.cz, box });
    }

    // Un toit pentu prend sa hauteur **sur** le bâtiment, pas au-dessus : sinon
    // toutes les maisons grandissent d'un étage et le village change d'échelle.
    // L'égout descend donc de la hauteur du comble, dans la limite du
    // raisonnable — un bâtiment d'un seul niveau n'a pas de murs négatifs.
    const shape = look?.shape || (box && box.fill >= 0.62 ? style.shape : 'flat');
    const rise = shape === 'flat' ? 0 : roofRise(box.short, this.theme.roofs);
    const eaves = Math.max(bottom + 2.4, top - rise);

    // Bandeau bas : soubassement d'ordinaire, **devanture** pour un commerce.
    // Les deux occupent la même place et ne se cumulent donc pas — une vitrine
    // descend jusqu'au trottoir, elle ne repose pas sur une plinthe. Voir
    // `plinthTopFor` et `shopfrontTopFor` : il n'y en a ni sous un surplomb ni
    // sur un mur trop bas.
    const shopfrontTop = look?.front ? shopfrontTopFor(base, minHeight, eaves) : null;
    const plinthTop = shopfrontTop ?? plinthTopFor(base, minHeight, eaves);
    const plinthColor = shopfrontTop === null ? wallColor.map((c) => c * PLINTH_SHADE) : look.front;

    // Façade sur rue : le pan le plus long de l'empreinte, seul à recevoir la
    // devanture articulée (`appendShopfront`) — rien dans les tuiles ne dit
    // quel pan donne vraiment sur la rue, et le plus long est le choix le
    // moins arbitraire. Les autres pans gardent le simple bandeau coloré.
    let frontIndex = -1;
    if (shopfrontTop !== null) {
      let bestLength = -1;
      for (let i = 0; i < ordered.length; i++) {
        const pa = ordered[i];
        const pb = ordered[(i + 1) % ordered.length];
        const panLength = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (panLength > bestLength) {
          bestLength = panLength;
          frontIndex = i;
        }
      }
    }

    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % ordered.length];
      let nx = b.y - a.y;
      let nz = -(b.x - a.x);
      const length = Math.hypot(nx, nz) || 1;
      nx /= length;
      nz /= length;

      // Enroulement choisi pour que la face avant regarde vers l'extérieur :
      // notre plan (x, z) est de chiralité opposée au plan (x, y) usuel, donc
      // l'ordre « naturel » donnerait des murs visibles seulement de l'intérieur.
      if (plinthTop !== null) {
        pushPanel(walls, a, b, bottom, plinthTop, nx, nz, plinthColor, plinthColor);
        pushPanel(walls, a, b, plinthTop, eaves, nx, nz, wallColor, wallColor);
      } else {
        pushPanel(walls, a, b, bottom, eaves, nx, nz, wallColor, wallColor);
      }

      if (openings) {
        // Sur la façade : baies, large baie d'entrée et enseigne plutôt que la
        // grille résidentielle générique — voir `appendShopfront`. Si le pan
        // est trop étroit pour en tenir une seule, elle ne pose rien et le
        // rez-de-chaussée générique reprend la main, comme partout ailleurs.
        const devanture =
          i === frontIndex &&
          shopfrontTop !== null &&
          appendShopfront(
            openings,
            walls,
            labels,
            this.labelAtlas,
            a,
            b,
            nx,
            nz,
            base,
            shopfrontTop,
            minHeight,
            personalityName,
            this.theme.shopfront
          );
        appendOpenings(openings, walls, a, b, nx, nz, base, eaves - base, minHeight, style, this.theme.windows, {
          skipGroundLevel: devanture,
        });

        // Enseigne en drapeau : indépendante de la devanture au sol — une
        // façade trop étroite pour une porte garde son pictogramme.
        if (i === frontIndex && shopfrontTop !== null) {
          appendShopSignBlade(
            walls,
            labels,
            this.labelAtlas,
            a,
            b,
            nx,
            nz,
            base,
            minHeight,
            personalityClass,
            this.theme.shopfront
          );
        }
      }
    }

    if (shape === 'flat') {
      // Toit-terrasse : triangulation par oreilles, fournie par three. Une
      // empreinte dégénérée la fait échouer — un bâtiment sans toit vaut mieux
      // qu'une scène sans bâtiments.
      let faces = [];
      try {
        faces = THREE.ShapeUtils.triangulateShape(ordered, []) || [];
      } catch (e) {
        faces = [];
      }
      // Ordre inversé pour la même raison que les murs : la toiture doit
      // regarder le ciel.
      for (const [i0, i1, i2] of faces) {
        for (const index of [i0, i2, i1]) {
          const p = ordered[index];
          walls.positions.push(p.x, eaves, p.y);
          walls.normals.push(0, 1, 0);
          walls.colors.push(...roofColor);
        }
      }
    } else {
      // Comble : faîtière, croupe ou pyramide, bâti sur le rectangle englobant
      // orienté de l'empreinte (voir `roofGeometry`).
      const roof = roofTriangles(box, eaves, shape, this.theme.roofs);
      for (let i = 0; i < roof.positions.length; i += 3) {
        walls.positions.push(roof.positions[i], roof.positions[i + 1], roof.positions[i + 2]);
        walls.normals.push(roof.normals[i], roof.normals[i + 1], roof.normals[i + 2]);
        walls.colors.push(...roofColor);
      }
    }

    // Clocher, coupole, minaret : des volumes ajoutés à la **vraie** empreinte
    // plutôt que des objets posés à côté — voir `buildingPersonalityFor`.
    if (box && look) {
      if (look.spire) this._appendSteeple(walls, look.spire, box, base, top);
      if (look.dome || look.minaret) this._appendDomeAndMinaret(walls, look, box, base, eaves);
    }

    return true;
  }

  /**
   * Clocher : une tour carrée coiffée d'une flèche, greffée sur une empreinte
   * déjà bâtie.
   *
   * Trois choses le font tenir, et la version précédente les ratait toutes :
   *
   * 1. **il est dimensionné sur le bâtiment.** Une tour de 3,2 m de côté et de
   *    15 m de haut pour toutes les églises donnait un mât sur une chapelle et
   *    une allumette sur une collégiale. Côté et hauteur se lisent donc sur le
   *    rectangle englobant ;
   * 2. **il est orienté comme le bâtiment.** Une boîte non tournée sur une nef
   *    en biais se voit immédiatement, arêtes contre arêtes ;
   * 3. **la flèche tourne sur son axe.** `roll` bascule la pyramide de 45° dans
   *    le plan vertical — elle partait de travers. C'est `yaw` qu'il faut, et de
   *    45° pour poser les arêtes de la pyramide sur les angles de la tour.
   *
   * Le lacet vaut `-box.angle` : `Kit.transform` envoie le `+x` local sur
   * `(cos θ, −sin θ)` dans le plan `(x, z)`, et le grand axe du bâtiment est
   * `(cos angle, sin angle)`.
   *
   * Décalé vers un bout du grand axe plutôt que posé au centre du toit, qui se
   * lirait comme une cheminée. `Kit` (`furnitureKit.js`) est réutilisé plutôt
   * que de réécrire des primitives boîte/cylindre déjà éprouvées.
   */
  _appendSteeple(walls, spire, box, base, top) {
    const side = towerSide(box);
    const height = Math.max(6, top - base) + towerRise(box);
    const yaw = -box.angle;

    const kit = new Kit();
    kit.box({ width: side, height, depth: side, color: spire.wall, yaw });
    kit.cylinder({
      radiusBottom: side * 0.78,
      radiusTop: 0,
      height: side * 1.5,
      radial: 4,
      y: height,
      yaw: yaw + Math.PI / 4,
      color: spire.roof,
    });

    const { x, z } = towerFoot(box, side);
    this._pushKitAt(walls, kit, x, base, z);
  }

  /**
   * Coupole et minaret. La coupole est posée sur l'**égout** et non sur le
   * faîtage : le thème force la terrasse (`shape: 'flat'`) pour cette raison,
   * et les deux cotes sont alors confondues — mais s'appuyer sur le faîtage
   * ferait flotter la coupole dès qu'un thème rendrait le rampant.
   *
   * Le fût est un cylindre : son lacet ne se voit pas, seule sa position est
   * tournée avec le bâtiment (voir `towerFoot`).
   */
  _appendDomeAndMinaret(walls, look, box, base, eaves) {
    if (look.dome) {
      const radius = Math.max(1.5, Math.min(box.short * 0.75, 8));
      const dome = new Kit();
      // Deux tronçons plutôt qu'un cône tronqué : c'est le second, très
      // écrasé, qui donne la courbe — un cône seul se lit comme un chapeau.
      dome.cylinder({ radiusBottom: radius, radiusTop: radius * 0.72, height: radius * 0.5, radial: 14, color: look.dome });
      dome.cylinder({
        radiusBottom: radius * 0.72,
        radiusTop: 0,
        height: radius * 0.75,
        radial: 14,
        y: radius * 0.5,
        color: look.dome,
      });
      this._pushKitAt(walls, dome, box.cx, eaves, box.cz);
    }

    if (look.minaret) {
      const side = towerSide(box);
      const radius = Math.max(0.7, side * 0.3);
      const height = Math.max(8, eaves - base) + towerRise(box) * 1.4;
      const kit = new Kit();
      kit.cylinder({ radiusBottom: radius, radiusTop: radius * 0.8, height, radial: 10, color: look.minaret });
      // La galerie : l'anneau qui fait qu'un minaret n'est pas un poteau.
      kit.cylinder({
        radiusBottom: radius * 1.5,
        radiusTop: radius * 1.5,
        height: radius * 0.4,
        radial: 10,
        y: height,
        color: look.dome || look.minaret,
      });
      kit.cylinder({
        radiusBottom: radius * 0.8,
        radiusTop: 0,
        height: radius * 3,
        radial: 10,
        y: height + radius * 0.4,
        color: look.dome || look.minaret,
      });

      const { x, z } = towerFoot(box, side);
      this._pushKitAt(walls, kit, x, base, z);
    }
  }

  /** Ajoute les triangles d'un `Kit` à `walls`, translatés en un point du monde. */
  _pushKitAt(walls, kit, x, y, z) {
    for (let i = 0; i < kit.positions.length; i += 3) {
      walls.positions.push(kit.positions[i] + x, kit.positions[i + 1] + y, kit.positions[i + 2] + z);
    }
    for (let i = 0; i < kit.normals.length; i++) walls.normals.push(kit.normals[i]);
    for (let i = 0; i < kit.colors.length; i++) walls.colors.push(kit.colors[i]);
  }

  /** (Ré)alimente le maillage des fenêtres allumées. */
  _applyWindows(windows) {
    const { THREE } = this;

    if (windows.positions.length === 0) {
      this._clearWindows();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(windows.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(windows.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(windows.colors, 3));
    geometry.computeBoundingSphere();

    if (this.windowMesh) {
      this.windowGeometry?.dispose();
      this.windowMesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.windowMaterial);
      mesh.name = 'building-windows';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // Après les murs : un panneau additif sans écriture de profondeur doit
      // être dessiné une fois le mur en place.
      mesh.renderOrder = 6;
      mesh.visible = this.windowMaterial.opacity > 0.01;
      this.scene.add(mesh);
      this.windowMesh = mesh;
    }
    this.windowGeometry = geometry;
  }

  /**
   * (Ré)alimente le maillage des enseignes peintes — voir l'en-tête de
   * `materials/labelAtlas.js`. `labelAtlas.upload()` doit passer **après**
   * toutes les cases posées par cette même reconstruction (`_appendBuilding`,
   * via `appendShopfront`), donc après le remplissage de `labels` mais avant
   * que le maillage ne s'en serve.
   */
  _applyLabels(labels) {
    const { THREE } = this;
    this.labelAtlas.upload();

    if (labels.positions.length === 0) {
      this._clearLabels();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(labels.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(labels.uvs, 2));
    geometry.computeBoundingSphere();

    if (this.labelMesh) {
      this.labelGeometry?.dispose();
      this.labelMesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.labelMaterial);
      mesh.name = 'building-labels';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // Après les murs, comme les fenêtres : un panneau sans écriture de
      // profondeur doit être dessiné une fois le mur qui le porte en place.
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.labelMesh = mesh;
    }
    this.labelGeometry = geometry;
  }

  /**
   * Allume les fenêtres.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));
    this.windowMaterial.opacity = value;
    if (this.windowMesh) this.windowMesh.visible = value > 0.01;
  }

  _clearWindows() {
    if (!this.windowMesh) return;
    this.scene.remove(this.windowMesh);
    this.windowGeometry?.dispose();
    this.windowMesh = null;
    this.windowGeometry = null;
  }

  _clearLabels() {
    if (!this.labelMesh) return;
    this.scene.remove(this.labelMesh);
    this.labelGeometry?.dispose();
    this.labelMesh = null;
    this.labelGeometry = null;
  }

  _clearMesh() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.mesh = null;
    this.geometry = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearMesh();
    this._clearWindows();
    this._clearLabels();
    this.material.dispose();
    this.windowMaterial.dispose();
    this.labelMaterial.dispose();
    this.labelAtlas.dispose();
  }
}
