/*
 * defaultTheme — la direction artistique livrée avec le moteur.
 * -------------------------------------------------------------
 * Tout ce qui décide de **quoi** ressemble à quoi est ici. Le reste de `src/`
 * décide du **comment** : où poser un arbre, comment entailler un terrain,
 * quand replanter une tuile. Le partage se teste en une question — si on
 * supprime ceci, le moteur sait-il encore fabriquer un paysage, ou ne sait-il
 * plus que lequel ?
 *
 *   TOWN_PALETTES supprimé → il fait toujours des villages, sans savoir de
 *                            quelle couleur.            → thème
 *   townPaletteAt supprimé → il ne sait plus qu'un village a une couleur
 *                            cohérente.                 → moteur
 *
 * Ce qui n'est donc **pas** ici, malgré les apparences :
 *
 *   - les **plafonds** (`FURNITURE_LIMITS`, `GRASS_COUNT`, `BUILDING_MAX_COUNT`)
 *     et les **portées** (`*_RADIUS_M`, `*_REBUILD_M`) : ce sont des budgets
 *     d'images par seconde, pas des goûts. Un thème qui pourrait les changer
 *     pourrait faire tomber l'application à quatre images par seconde ;
 *   - les **règles de composition** (`TOWN_PATCH_M`, `FOREST_PATCH_M`,
 *     `GRASS_FADE_FROM`, la lecture des lisières dans la carte de classes) :
 *     ce sont les trouvailles du moteur, et elles doivent rester lisibles et
 *     améliorables par tout le monde ;
 *   - les **encodages** (`CROP_KINDS` et son identifiant peint dans le canal
 *     rouge, la grille 3×3 de l'atlas d'arbres) : ce sont des contrats entre
 *     deux morceaux de code, pas des choix d'apparence — même si la *liste*
 *     des cultures, elle, en est un. Ils attendent encore leur découplage.
 *
 * Ce thème est aussi le seul qui existe aujourd'hui. Il n'est pas un exemple
 * neutre : c'est une campagne européenne, plutôt française, vue depuis une
 * route, et c'est assumé — un moteur qui ne sait rien peindre n'intéresse
 * personne.
 *
 * **On n'a pas à le modifier pour en changer.** Une application donne ses
 * propres tranches à `createWorld({ theme })` ; le thème résolu descend
 * jusqu'aux couches, qui le gardent chacune sur leur instance. Ce qu'on lit ici
 * n'est que le point de départ, et le repli de toutes les fonctions publiques
 * appelées sans thème.
 */

import { srgb } from '../core/color.js';

// --- Le sol --------------------------------------------------------------------
/** Réglages de l'aspect du sol. Un seul endroit à toucher. */
export const TERRAIN_LOOK = {
  /**
   * Périodes du bruit de grain, en mètres : proche, puis lointaine. Le fondu
   * de l'une à l'autre court sur `detailNear` → `detailFar`.
   */
  detailScaleNear: 8,
  detailScaleFar: 45,
  detailNear: 60,
  detailFar: 420,
  /**
   * Périodes des textures de matière. Toutes différentes : deux textures
   * répétées au même pas se répéteraient ensemble, et la grille se verrait.
   */
  groundScaleGrass: 2.6,
  groundScaleSoil: 3.7,
  groundScaleWood: 3.1,
  /**
   * Matière retenue là où le vectoriel ne dit rien — ordre (herbe, bois,
   * culture, sol nu). L'herbe est de loin le pari le plus souvent gagnant en
   * rase campagne : un accotement, une friche, une banquette en sont.
   */
  unclassifiedWeights: [1, 0, 0, 0],
  /**
   * Albédos, en espace **linéaire**.
   *
   * `grassAlbedo` et `cropAlbedo` ne sont pas choisis à l'œil : ils sont
   * calés sur la couleur que rend réellement le motif instancié qui pousse
   * dessus (`groundCover`, `cropLayer`) — moyenne des pixels opaques de la
   * case d'atlas concernée (herbe : `clump` ; culture : la variante `*Mass`,
   * celle qui porte la bande de transition), passée en linéaire par la même
   * formule que `srgb()` (`core/color.js`), puis multipliée par la teinte
   * moyenne d'instance (`GRASS_LOOK`/`CROP_LOOK`, tirages à mi-plage). Sans
   * ce calage, le sol et ce qui y pousse divergent forcément : ils sont peints
   * par deux chemins qui ne se consultent pas, et l'écart se voit à la
   * jointure entre les tiges du premier plan et la teinte lointaine. Une
   * culture en plein soleil rend donc un albédo plus haut que ne le
   * laisserait supposer un repère « terre nue » — c'est la teinte de l'épi ou
   * de la fleur qui porte le champ, pas celle du sol qu'elle couvre.
   */
  grassAlbedo: [0.051, 0.135, 0.017],
  woodAlbedo: [0.042, 0.056, 0.02],
  farmlandAlbedo: [0.431, 0.331, 0.08],
  bareAlbedo: [0.27, 0.255, 0.225],
  /**
   * Albédo par culture, dans l'ordre de `CROP_KINDS`.
   *
   * C'est **ce qui rend un champ visible de loin**. Un champ de blé à huit
   * cents mètres n'est pas une texture d'épis — on n'en distingue aucun —,
   * c'est une couleur, et tant que toute culture était peinte du brun de labour
   * il n'y avait tout simplement rien à voir. Les tiges instanciées ne portent
   * que les cinquante premiers mètres ; au-delà, c'est cette ligne-ci qui
   * travaille, et elle porte jusqu'à deux kilomètres pour une lecture de
   * texture. `vineyard` et `orchard` n'ont pas de motif instancié propre à
   * `cropLayer` (ils passent par `furnitureLayer` — rang de vigne, alignement
   * d'arbres) : leur albédo est calé sur les mêmes couleurs de feuillage que
   * ce motif-là (`FURNITURE_COLORS.vineLeaf`, `.leafOlive`), pour la même
   * raison.
   *
   * Le labour garde `farmlandAlbedo`, qui reste le repli de tout champ dont on
   * ignore la culture.
   */
  cropAlbedo: {
    wheat: [0.566, 0.439, 0.092],
    maize: [0.123, 0.251, 0.027],
    sunflower: [0.258, 0.243, 0.022],
    plough: [0.431, 0.331, 0.08],
    vineyard: [0.168, 0.246, 0.069],
    orchard: [0.153, 0.219, 0.061],
  },
  /** Teinte de roche sur les fortes pentes. */
  rockColor: [0.72, 0.68, 0.62],
  slopeStart: 0.22,
  slopeEnd: 0.62,
  rockStrength: 0.75,
};

// --- Les arbres ----------------------------------------------------------------
/**
 * Les neuf silhouettes, décrites une fois.
 *
 * `hue` module la teinte de base ; elle reste volontairement peu saturée, la
 * variation finale venant de la couleur d'instance. `crownBase` fixe où
 * commence la houppe — c'est ce qui distingue un tronc de futaie, dégagé sur les
 * deux tiers de sa hauteur, d'un taillis qui part du sol.
 */
export const TREE_VARIANTS = [
  { kind: 'broadleaf', hue: { r: 0.62, g: 1, b: 0.46 }, trunk: 0.075, crownBase: 0.6, spread: 0.34 },
  { kind: 'broadleaf', hue: { r: 0.5, g: 1, b: 0.4 }, trunk: 0.095, crownBase: 0.68, spread: 0.36 },
  { kind: 'broadleaf', hue: { r: 0.72, g: 1, b: 0.5 }, trunk: 0.06, crownBase: 0.55, spread: 0.28 },
  { kind: 'column', hue: { r: 0.56, g: 1, b: 0.42 }, trunk: 0.05, crownBase: 0.9, spread: 0.16 },
  { kind: 'column', hue: { r: 0.68, g: 1, b: 0.52 }, trunk: 0.045, crownBase: 0.88, spread: 0.13 },
  { kind: 'conifer', hue: { r: 0.44, g: 1, b: 0.5 }, trunk: 0.06, crownBase: 0.86, spread: 0.3 },
  { kind: 'conifer', hue: { r: 0.38, g: 1, b: 0.44 }, trunk: 0.055, crownBase: 0.9, spread: 0.24 },
  { kind: 'bushy', hue: { r: 0.6, g: 1, b: 0.4 }, trunk: 0.05, crownBase: 0.86, spread: 0.4 },
  { kind: 'bushy', hue: { r: 0.74, g: 1, b: 0.46 }, trunk: 0.04, crownBase: 0.9, spread: 0.44 },
];
/**
 * Les essences, par indices de variantes. C'est ce que lit `vegetationLayer`
 * pour composer un peuplement : un bois n'est pas un tirage uniforme dans neuf
 * silhouettes, c'est deux ou trois essences qui dominent.
 */
export const TREE_ESSENCES = {
  broadleaf: [0, 1, 2],
  column: [3, 4],
  conifer: [5, 6],
  bushy: [7, 8],
};

// --- Les peuplements -----------------------------------------------------------
/**
 * Les peuplements.
 *
 * ## Pourquoi il en faut plusieurs
 *
 * Une forêt tirée uniformément dans neuf silhouettes n'est pas une forêt : c'est
 * un mélange, et le mélange est exactement ce qu'on ne voit jamais. Dans le
 * paysage réel, un versant est en résineux et le fond de vallon en feuillus ; un
 * taillis est bas et serré là où une futaie est haute et clairsemée. C'est ce
 * contraste-là qui se lit de loin, pas le détail d'une houppe.
 *
 * Chaque peuplement fixe donc quatre choses : les **essences** qui le composent
 * (indices de l'atlas), la **hauteur** de ses arbres, un **facteur de densité**,
 * et la part de **sous-bois** — les buissons de la strate basse, qui se comptent
 * en plus des arbres et non à leur place. Un bois sans strate basse se lit comme
 * une colonnade : on voit sous les houppes jusqu'au bout du massif.
 * Le type est tiré d'une maille de `FOREST_PATCH_M`, donc il change
 * de proche en proche mais reste le même sur toute une masse boisée — et il ne
 * dépend que du lieu, donc il ne change pas d'une reconstruction à l'autre.
 */
export const FOREST_TYPES = [
  {
    // Futaie de feuillus : de grands arbres, largement espacés, sous-bois clair.
    name: 'futaie',
    essences: ['broadleaf', 'broadleaf', 'column'],
    minHeight: 12,
    maxHeight: 22,
    density: 0.95,
    // Une futaie entretenue est dégagée au sol : c'est même ce qui la définit.
    understory: 0.12,
    tint: [0.95, 1, 0.86],
  },
  {
    // Pinède : haute, sombre, dense et serrée.
    name: 'pinede',
    essences: ['conifer', 'conifer', 'conifer', 'column'],
    minHeight: 11,
    maxHeight: 19,
    density: 1.45,
    // Sous les résineux, l'aiguille étouffe presque tout.
    understory: 0.08,
    tint: [0.84, 1, 0.92],
  },
  {
    // Taillis et bosquets : bas, très denses, c'est le fourré qu'on longe.
    name: 'taillis',
    essences: ['bushy', 'bushy', 'broadleaf'],
    minHeight: 3.5,
    maxHeight: 7,
    density: 1.75,
    // Un taillis *est* son sous-bois : la strate basse y pèse autant que la haute.
    understory: 0.55,
    tint: [1, 1, 0.8],
  },
  {
    // Bois mêlé : le cas le plus courant, et le seul où le mélange est juste.
    name: 'mixte',
    essences: ['broadleaf', 'conifer', 'bushy', 'column'],
    minHeight: 7,
    maxHeight: 16,
    density: 1.3,
    // Le bois où l'on ne passe pas en ligne droite : ronces et jeunes pousses.
    understory: 0.34,
    tint: [0.92, 1, 0.86],
  },
];

// --- L’herbe et les fleurs -----------------------------------------------------
/**
 * Hauteur des touffes, en mètres.
 *
 * Une prairie non fauchée monte au genou : trente centimètres au plus court,
 * quatre-vingts pour ce qui a poussé. Plus bas, la caméra survole un gazon —
 * et c'est le tapis ras, plus que la densité, qui trahissait le décalque.
 */
export const GRASS_MIN_HEIGHT = 0.3;
export const GRASS_MAX_HEIGHT = 0.8;
/** Largeur d'une touffe, en part de sa hauteur. */
export const GRASS_ASPECT = 0.62;
/**
 * Part des touffes qui portent des fleurs, en pleine prairie.
 *
 * Volontairement basse. Un pré n'est pas un parterre : ce qui le fait exister,
 * c'est **quelques** taches de couleur dans un tapis vert, et une densité de
 * fleurs qui paraît juste sur une image fixe devient un tapis persan dès qu'on
 * roule dedans.
 */
export const FLOWER_SHARE = 0.16;
/**
 * Part de fleurs en **lisière de culture**, où poussent les coquelicots.
 *
 * La lisière n'est pas cherchée : elle est **lue**. La carte de classes est
 * filtrée linéairement, donc un point exactement sur la limite d'un champ y
 * porte à la fois de l'herbe et de la culture. Un point qui porte les deux *est*
 * un bord de champ — il n'y a rien d'autre à calculer.
 */
export const POPPY_SHARE = 0.42;

// --- Les cultures --------------------------------------------------------------
/**
 * Hauteur et silhouette de chaque culture.
 *
 * `atlas` désigne la case de l'atlas, `height` la hauteur en mètres, `density`
 * la part des tirages retenus. Le blé est serré, le tournesol espacé — c'est ce
 * qui les distingue d'aussi loin qu'on les voit.
 *
 * Les densités se lisent avec la maille : neuf tirages par maille de 1,6 m font
 * 3,5 touffes au mètre carré à `density: 1`. Elles ne sont pas égales parce
 * qu'une touffe ne représente pas la même chose selon la plante — l'atlas
 * dessine vingt-six tiges de blé dans sa case, mais seulement quatre pieds de
 * maïs et trois tournesols. Un pied de maïs vaut donc quatre fois un brin de
 * blé, et sa densité est baissée d'autant : sans quoi le champ devient un mur
 * opaque qui coûte cher et ne ressemble à rien.
 */
export const CROP_LOOK = {
  wheat: { atlas: 'wheat', height: 0.95, spread: 0.22, density: 1, tint: [1.02, 0.94, 0.62] },
  maize: { atlas: 'maize', height: 2.4, spread: 0.15, density: 0.22, tint: [0.82, 1, 0.62] },
  sunflower: { atlas: 'sunflower', height: 1.7, spread: 0.2, density: 0.3, tint: [0.96, 0.98, 0.6] },
  plough: { atlas: 'stubble', height: 0.3, spread: 0.22, density: 0.72, tint: [1, 0.94, 0.74] },
};

// --- Les bourgs ----------------------------------------------------------------
/**
 * Les palettes.
 *
 * Chacune porte deux ou trois tons de mur, deux tons de toit, deux tons de
 * **volet**, et les **formes de toit** admises. Deux ou trois formes par
 * village, jamais plus : c'est le nombre qui fait qu'un bourg est varié sans
 * être un catalogue.
 *
 * ## Les volets
 *
 * Ils ne sont pas un détail parmi d'autres : c'est **la** couleur d'un village
 * français. Le mur et le toit sont donnés par la carrière et la tuilerie du
 * coin, donc ils varient peu et lentement ; le volet est peint, donc il est
 * franc, et c'est le seul endroit du bâti où une vraie couleur est admise. Le
 * bleu de Provence, le rouge d'Alsace, le vert sombre de Bretagne sont ce qu'on
 * reconnaît d'une façade avant d'en lire la pierre.
 *
 * Deux tons par bourg, comme pour les toits : plus, et la rue devient un
 * nuancier ; un seul, et c'est un lotissement.
 */
export const TOWN_PALETTES = [
  {
    name: 'calcaire',
    walls: ['#e6ddc9', '#dcd2bb', '#efe8d8'],
    roofs: ['#b0654a', '#9c5a44'],
    shutters: ['#93a6ab', '#c6bfab'],
    roofShapes: ['gable', 'hip'],
  },
  {
    name: 'ocre',
    walls: ['#e8cfa8', '#dcbe94', '#f0dcc0'],
    roofs: ['#c07b4c', '#ab6a45'],
    shutters: ['#7d8fae', '#7c8a5c'],
    roofShapes: ['gable', 'hip', 'flat'],
  },
  {
    name: 'granit',
    walls: ['#cfcdc6', '#c0bfba', '#dcdad3'],
    roofs: ['#6a6f78', '#585d66'],
    shutters: ['#3f5a78', '#3d5a4a'],
    roofShapes: ['gable', 'pyramid'],
  },
  {
    name: 'brique',
    walls: ['#d9a98e', '#c8977d', '#e4bda6'],
    roofs: ['#8d5f4c', '#7a5041'],
    shutters: ['#415c48', '#d5cab2'],
    roofShapes: ['gable', 'hip'],
  },
  {
    name: 'colombage',
    walls: ['#efe6d4', '#e3d6c0', '#d8c8ae'],
    roofs: ['#8a5a49', '#6f4b3f'],
    shutters: ['#8e4034', '#405c3f'],
    roofShapes: ['gable', 'gable', 'hip'],
  },
  {
    name: 'chaux',
    walls: ['#eeeae0', '#e3ded2', '#f4f1e9'],
    roofs: ['#a9713f', '#8f6039'],
    shutters: ['#9fb2b6', '#93a37c'],
    roofShapes: ['gable', 'flat'],
  },
  {
    name: 'ardoise',
    walls: ['#dfe0dd', '#d0d2cf', '#eceded'],
    roofs: ['#5b626b', '#4c525a'],
    shutters: ['#dbd8cf', '#6d7f92'],
    roofShapes: ['gable', 'pyramid', 'hip'],
  },
  {
    name: 'lauze',
    walls: ['#d5cbb8', '#c5bba7', '#e0d7c6'],
    roofs: ['#77726a', '#655f57'],
    shutters: ['#6f5a42', '#4c5f4a'],
    roofShapes: ['gable', 'hip'],
  },
];

// --- Les bâtiments qui ont une fonction ----------------------------------------
/**
 * Ce qu'un bâtiment devient quand on sait à quoi il sert.
 *
 * La couche `building` ne dit rien de la fonction (voir l'en-tête de
 * `townStyle`) : elle vient de la couche `poi`, et c'est
 * `buildingLayer.buildingPersonalityFor` qui la nomme. Ce qu'on en fait à
 * l'écran est ici, et nulle part ailleurs.
 *
 * Trois registres, et ils ne se mélangent pas :
 *
 * - `wall`, `roof`, `shape` **remplacent** la palette du bourg. Réservé à ce
 *   qui, dans la réalité, n'est pas bâti dans le matériau du pays : un hôpital
 *   et une grande surface sont en béton et en bardage d'un bout à l'autre de la
 *   France, quelle que soit la carrière du coin.
 * - `front` ne remplace rien : c'est le **bandeau de rez-de-chaussée**, la
 *   devanture, posée sur des murs qui gardent la couleur du bourg. C'est la
 *   bonne échelle pour un commerce — il occupe un niveau d'un immeuble, pas
 *   l'immeuble. Repeindre la façade entière faisait virer tout un centre ancien
 *   à la même couleur, ce qui se lisait comme une panne et non comme un
 *   commerce.
 * - `spire`, `dome`, `minaret` sont des **volumes ajoutés** à la vraie
 *   empreinte : un clocher n'est pas une couleur, c'est une silhouette, et
 *   c'est la seule chose qui se voie de l'autre bout du village.
 *
 * Une personnalité peut n'en porter qu'un : une église garde les murs de son
 * bourg — une église romane *est* bâtie dans la pierre du pays — et ne se
 * reconnaît qu'à son clocher.
 */
export const BUILDING_PERSONALITIES = {
  // Pierre de taille et ardoise : le clocher est l'ouvrage soigné du village,
  // pas son bâti courant, et il est presque partout d'un autre matériau que les
  // maisons autour.
  church: { spire: { wall: '#d3ccba', roof: '#4f555d' } },
  // La coupole se pose sur une terrasse : sur un rampant elle flotterait.
  mosque: { shape: 'flat', dome: '#4f8792', minaret: '#efe9db' },
  hospital: { wall: '#eceff0', roof: '#c2c8ca', shape: 'flat' },
  retail: { wall: '#d8d4cb', roof: '#71767b', shape: 'flat' },
  // Bois verni foncé : la devanture de boulangerie est le seul commerce dont la
  // façade soit un type reconnaissable en France.
  bakery: { front: '#7d4a2a' },
  // Peinture sombre, faiblement saturée : une devanture quelconque se lit à sa
  // valeur — un bandeau plus sombre que le mur — pas à sa teinte.
  shop: { front: '#3f5560' },
};

// --- Les toits -----------------------------------------------------------------
/**
 * Pente d'un toit, en part de sa demi-largeur.
 *
 * 0,55 vaut environ 29° — la pente d'une tuile canal du Midi. Les pays
 * d'ardoise montent bien plus haut, mais une pente forte sur un bâtiment large
 * donne un comble plus haut que ses murs, ce qui ne se voit qu'en Normandie.
 * Plafonné en mètres pour cette raison.
 */
export const ROOF_PITCH = 0.55;
export const ROOF_MAX_RISE_M = 4.2;
/** Débord de toiture, en mètres : c'est l'ombre du débord qui fait le toit. */
export const ROOF_OVERHANG_M = 0.45;

// --- Les fenêtres --------------------------------------------------------------
/** Dimensions d'une fenêtre, en mètres. */
export const WINDOW_WIDTH_M = 0.85;
export const WINDOW_HEIGHT_M = 1.15;
/** Hauteur d'un niveau, et hauteur d'allège du premier. */
export const WINDOW_LEVEL_M = 3.2;
export const WINDOW_SILL_M = 1.1;
/** Part des fenêtres allumées. Un village endormi n'est pas un village éteint. */
export const WINDOW_LIT_SHARE = 0.34;

// --- Les chaussées -------------------------------------------------------------
/**
 * Profils de chaussée, du plus grand au plus petit.
 *
 * Le marquage n'est pas un décor : c'est ce qui donne l'échelle. Une
 * départementale de cinq mètres portant les pointillés d'une nationale se lit
 * comme une nationale rétrécie. L'échelle descend donc par retraits successifs
 * — l'accotement en terre, puis l'axe central, puis les rives — jusqu'aux
 * voies non revêtues, qui n'ont jamais eu de marquage.
 *
 * `width` sert deux fois : elle dessine la section **et** fixe la largeur du
 * ruban. Les deux ne peuvent donc pas diverger.
 */
export const ROAD_PROFILES = {
  express: { width: 12, shoulder: 1.2, edgeLines: true, centerDash: true, texture: 256 },
  major: { width: 8.5, shoulder: 0, edgeLines: true, centerDash: true, texture: 128 },
  minor: { width: 5, shoulder: 0, edgeLines: true, centerDash: false, texture: 128 },
  lane: { width: 3.6, shoulder: 0, edgeLines: false, centerDash: false, texture: 64 },
  cycleway: { width: 2.2, shoulder: 0, edgeLines: false, centerDash: false, tint: '#56565c', texture: 64 },
  track: { width: 3, shoulder: 0, surface: 'dirt', ruts: true, texture: 64 },
  path: { width: 1.4, shoulder: 0, surface: 'dirt', texture: 64 },
};
/** Revêtements : couleur de base et amplitude du grain. */
export const ROAD_SURFACES = {
  asphalt: { base: '#4a4a4e', grain: 26 },
  dirt: { base: '#8a7d63', grain: 34 },
  // Ballast de voie ferrée : pierre concassée, le grain le plus fort des
  // trois — c'est un empierrement, pas une chaussée damée.
  ballast: { base: '#847d70', grain: 46 },
};
/** Terre claire de l'accotement. */
export const ROAD_SHOULDER_COLOR = '#8c8168';

// --- La voirie -----------------------------------------------------------------
/**
 * La section d'une rue, côté trottoir.
 *
 * Une rue de village n'est pas une route posée sur du gris : c'est une chaussée
 * **bordée**. De la chaussée vers les maisons, on rencontre toujours les mêmes
 * quatre choses, et dans cet ordre : le caniveau qui recueille l'eau, la
 * bordure qui tient la terre, le trottoir légèrement surélevé, puis ce qui
 * commence derrière — un mur, une haie, un jardin.
 *
 * Les cotes sont celles du terrain : une bordure de béton fait quatorze
 * centimètres de vue, un caniveau trente centimètres de large, un trottoir de
 * village entre 1,2 et 2,3 mètres. Elles sont **volontairement basses** : le
 * trottoir doit se lire comme une marche, pas comme un quai.
 *
 * `surfaces` porte la variation de matériau. Elle n'est pas tirée par trottoir
 * mais **par bourg** (voir `streetSurfaceAt`) : une commune refait sa voirie
 * d'un coup, donc toutes ses rues partagent le même revêtement, et c'est ce
 * partage-là qui se lit en traversant.
 */
export const STREET_LOOK = {
  /** Largeur du caniveau, en mètres, et sa profondeur sous la chaussée. */
  gutterWidth: 0.32,
  gutterDepth: 0.035,
  /** Vue de la bordure, en mètres, et le chanfrein de son nez. */
  kerbHeight: 0.14,
  kerbNose: 0.055,
  /** Largeur du trottoir : tirée dans cet écart, par portion. */
  walkWidth: [1.2, 2.3],
  /** Contre-pente du trottoir vers le caniveau, en mètres sur sa largeur. */
  walkFall: 0.025,
  /** Jupe arrière : de quoi enterrer le bord au lieu de le laisser en l'air. */
  skirtWidth: 0.35,
  skirtDepth: 0.3,
  /** Fond de caniveau : plus sombre que la chaussée, l'eau y stagne. */
  gutter: '#403e3b',
  /**
   * Revêtements, un par bourg. `walk` est le dessus, `kerb` la bordure, `joint`
   * le bord arrière — toujours plus sombre, parce qu'il est à l'ombre du mur ou
   * de la haie qui le suit.
   */
  surfaces: [
    { name: 'béton balayé', walk: '#bab4a6', kerb: '#c0bbaf', joint: '#948d80' },
    { name: 'enrobé clair', walk: '#98948c', kerb: '#b3aea3', joint: '#797570' },
    { name: 'pavé de grès', walk: '#a89f8e', kerb: '#b5ac9a', joint: '#847b6c' },
    { name: 'béton désactivé', walk: '#b0a897', kerb: '#b8b1a2', joint: '#8b8374' },
  ],
};

// --- L’eau ---------------------------------------------------------------------
/**
 * Largeur des cours d'eau linéaires, en mètres, par `class` OpenMapTiles.
 * Les grands fleuves sont déjà des polygones dans la couche `water` ; ce qui
 * reste ici est ce qui est trop étroit pour l'être.
 */
/**
 * Largeur de la ripisylve, en mètres, ajoutée de part et d'autre du lit
 * (voir `WATERWAY_CLASSES`) dans la carte de classes (`groundClassMap`) : le
 * cours d'eau y peint une bande de bois plutôt que le mobilier n'y plante des
 * arbres isolés. C'est ce qui distingue un bosquet naturel — une fine ligne
 * de forêt, plantée avec les mêmes silhouettes que n'importe quel autre bois
 * (`vegetationLayer`) — d'un alignement planté (les platanes de bord de
 * route, qui restent du mobilier).
 */
export const RIPARIAN_BUFFER_M = 7;

export const WATERWAY_CLASSES = {
  river: 9,
  canal: 6,
  stream: 3,
  drain: 1.6,
  ditch: 1.2,
};

// --- Ce qui vit ----------------------------------------------------------------
/**
 * Les deux seules couleurs de la couche vivante.
 *
 * L'oiseau est une **silhouette** : vu d'en dessous il est plus sombre que le
 * ciel à toute heure, et sa couleur ne dépend donc pas de l'éclairage. La fumée
 * est donnée telle qu'elle sort du shader, sans conversion — c'est une couleur
 * d'écran, pas un albédo.
 */
export const LIFE_COLORS = {
  bird: '#2b2f36',
  smoke: [0.86, 0.85, 0.83],
};

// --- Le mobilier ---------------------------------------------------------------
/** Nuancier du mobilier. Un seul endroit à toucher pour changer une matière. */
export const FURNITURE_COLORS = {
  steel: srgb('#9aa0a6'),
  steelDark: srgb('#6b7076'),
  galvanised: srgb('#b8bcc0'),
  wood: srgb('#7a5c3c'),
  woodPale: srgb('#a5835a'),
  concrete: srgb('#b9b5ac'),
  stone: srgb('#a09484'),
  stoneDark: srgb('#7d7264'),
  slate: srgb('#5b5f66'),
  tile: srgb('#a55b3f'),
  brick: srgb('#8d5a45'),
  plaster: srgb('#cdc4b4'),
  hay: srgb('#c9ac68'),
  hayDark: srgb('#9b8148'),
  leaf: srgb('#4a6b34'),
  leafDark: srgb('#33502a'),
  leafPale: srgb('#63834a'),
  white: srgb('#e9e6df'),
  red: srgb('#b3352f'),
  blue: srgb('#2f5fa8'),
  lamp: srgb('#d6d2c8'),
  water: srgb('#4d6b78'),
  corrugated: srgb('#8f9498'),
  hide: srgb('#e4ded4'),
  hideDark: srgb('#4a3a2f'),
  fleece: srgb('#ddd6c8'),
  muzzle: srgb('#c49a94'),
  // Robe alezane du cheval : `hideDark` — pensé pour la tache sombre de la
  // vache pie noire — l'engloutissait sur l'herbe, d'où le « cheval invisible,
  // trop sombre ». Un brun chaud et clair se détache, comme un vrai alezan.
  chestnut: srgb('#8a5a3a'),
  // Robe grise de l'âne, plus claire et plus froide que le cheval : c'est ce
  // qui les distingue en silhouette autant qu'en couleur.
  donkeyGrey: srgb('#9a9488'),
  feather: srgb('#c9c2b4'),
  comb: srgb('#a3372f'),
  linen: srgb('#e6e2d8'),
  cloth: srgb('#7fa6c4'),
  clothWarm: srgb('#c98f74'),
  signalGreen: srgb('#2f8a4a'),
  signalAmber: srgb('#d09a2a'),
  black: srgb('#22262b'),

  // Verres de feu tricolore au repos : un feu éteint n'est pas noir, c'est sa
  // propre couleur assombrie derrière le verre.
  redDark: srgb('#3a1f1e'),
  amberDark: srgb('#3a2f1a'),
  greenDark: srgb('#1c3226'),

  // --- Feuillages -----------------------------------------------------------
  // Plusieurs verts plutôt qu'un seul, et volontairement peu saturés : c'est ce
  // qui distingue un bosquet d'une masse verte. Les teintes se croisent avec la
  // couleur d'instance, donc elles ne doivent pas déjà être poussées.
  leafSpring: srgb('#86a95c'),
  leafOlive: srgb('#6d8146'),
  leafBlue: srgb('#4f7458'),
  leafDeep: srgb('#3e5c36'),
  fern: srgb('#5f7d42'),
  bramble: srgb('#55693a'),
  bark: srgb('#6d553c'),

  // --- Roche ---------------------------------------------------------------
  rock: srgb('#9e978a'),
  rockPale: srgb('#bab4a7'),
  rockDark: srgb('#6f6a60'),
  rockMoss: srgb('#7f8668'),

  // --- Signalisation -------------------------------------------------------
  signWhite: srgb('#ecebe4'),
  signRed: srgb('#b8322c'),
  signBlue: srgb('#2f5fa8'),
  signYellow: srgb('#e0b03a'),
  signGrey: srgb('#8d9298'),

  // --- Cultures ------------------------------------------------------------
  vineWood: srgb('#6b5540'),
  vineLeaf: srgb('#72884a'),
};

// --- Le ciel -------------------------------------------------------------------
/**
 * Les trois couleurs d'ambiance.
 *
 * - `fog` teinte le brouillard **et** le raccord d'horizon du ciel : les deux
 *   doivent être la même couleur, faute de quoi la ligne de contact entre le
 *   terrain lointain et le ciel se lit comme une couture ;
 * - `nightZenith` / `nightHorizon` remplacent le modèle de Preetham une fois le
 *   soleil sous l'horizon, qu'il ne sait pas rendre.
 *
 * C'est la couleur la plus déterminante du décor : elle décide de la distance
 * apparente et de l'heure qu'il fait.
 */
export const SKY_PALETTE = {
  fog: '#e8eef3',
  // Un ciel nocturne franchement noir ne se distingue plus d'un rendu en
  // panne — voir sceneEnvironment.js. Ces deux teintes restent une nuit
  // sombre, seulement plus loin du noir pur qu'avant.
  nightZenith: '#0d1428',
  nightHorizon: '#1c2c4c',
};

/**
 * Ce qui fait la silhouette d'une haie, par famille.
 *
 * Une haie n'est pas une section balayée : c'est un **balayage modulé**, dont
 * la crête et les flancs respirent le long du tracé, ponctué çà et là d'un
 * arbuste qui dépasse. Le balayage modulé porte l'essentiel de la lecture, de
 * loin comme de près — c'est lui qui fait l'irrégularité continue d'une haie.
 * L'arbuste n'est qu'un **accent**, un baliveau ou une touffe plus fournie
 * qu'on remarque en passant, pas un rang qui la recouvre. D'où `spacingM`
 * nettement plus large que `alongM` : les arbustes sont **espacés**, pas
 * jointifs — jointifs, ils redonnent le défaut qu'ils étaient censés corriger,
 * une texture uniforme, mais faite de bosses au lieu d'être un tube.
 *
 * Ces cotes décrivent l'arbuste et son rang — sa taille, son écartement, sa
 * part d'irrégularité. La géométrie les exécute (`hedgeGeometry`) ; jusqu'où
 * on la détaille est un budget de moteur et vit là-bas.
 */
export const HEDGE_SHAPES = {
  /** Haie de bocage : deux mètres, et un baliveau de loin en loin. */
  hedge: {
    /** Hauteur résiduelle du balayage entre deux arbustes. Reste haute : le
     * balayage modulé porte la haie, l'arbuste ne fait que dépasser dessus. */
    coreScale: 0.88,
    /** Largeur résiduelle du balayage entre deux arbustes. */
    coreWidth: 0.92,
    /** Écartement nominal des arbustes, en mètres — un accent tous les six ou
     * sept mètres, pas un rang continu. */
    spacingM: 6.5,
    /** Débattement latéral d'un arbuste autour de l'axe, en mètres. */
    lateralM: 0.3,
    /** Hauteur d'un arbuste, en mètres. */
    heightM: [1.35, 2.45],
    /** Demi-longueur le long du tracé, en mètres. */
    alongM: [1.6, 2.4],
    /** Demi-largeur en travers, en mètres. */
    acrossM: [0.65, 1.05],
    /** Facettes d'un arbuste. Six suffisent : ce sont les rayons qui varient. */
    sides: 6,
    /** Part d'arbustes sautés — de quoi laisser de vrais intervalles nus. */
    gapChance: 0.15,
    /** Part d'arbustes échappés, plus hauts que la taille. */
    standardChance: 0.07,
    standardScale: 1.45,
    /** Sel des tirages : deux familles ne doivent pas tirer la même chose. */
    salt: 601,
  },

  /** Haie basse de ronces et de fougères : le bord de fossé et de chemin. */
  lowHedge: {
    coreScale: 0.88,
    coreWidth: 0.92,
    spacingM: 4,
    lateralM: 0.22,
    heightM: [0.5, 0.95],
    alongM: [1, 1.5],
    acrossM: [0.48, 0.76],
    sides: 5,
    gapChance: 0.18,
    standardChance: 0.05,
    standardScale: 1.4,
    salt: 617,
  },
};

/**
 * Le thème, groupé. Les constantes ci-dessus sont le câblage interne ; cet
 * objet est la vue qu'on donne à qui veut changer le décor. Les deux désignent
 * exactement les mêmes valeurs — il n'y a pas de copie.
 */
export const defaultTheme = Object.freeze({
  terrain: TERRAIN_LOOK,
  trees: { variants: TREE_VARIANTS, essences: TREE_ESSENCES },
  forests: FOREST_TYPES,
  grass: {
    minHeight: GRASS_MIN_HEIGHT,
    maxHeight: GRASS_MAX_HEIGHT,
    aspect: GRASS_ASPECT,
    flowerShare: FLOWER_SHARE,
    poppyShare: POPPY_SHARE,
  },
  crops: CROP_LOOK,
  towns: TOWN_PALETTES,
  personalities: BUILDING_PERSONALITIES,
  roofs: { pitch: ROOF_PITCH, maxRiseM: ROOF_MAX_RISE_M, overhangM: ROOF_OVERHANG_M },
  windows: {
    widthM: WINDOW_WIDTH_M,
    heightM: WINDOW_HEIGHT_M,
    levelM: WINDOW_LEVEL_M,
    sillM: WINDOW_SILL_M,
    litShare: WINDOW_LIT_SHARE,
  },
  roads: { profiles: ROAD_PROFILES, surfaces: ROAD_SURFACES, shoulderColor: ROAD_SHOULDER_COLOR },
  streets: STREET_LOOK,
  water: { waterways: WATERWAY_CLASSES, riparianBufferM: RIPARIAN_BUFFER_M },
  furniture: { colors: FURNITURE_COLORS, hedges: HEDGE_SHAPES },
  life: LIFE_COLORS,
  sky: SKY_PALETTE,
});
