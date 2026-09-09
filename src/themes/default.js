/*
 * defaultTheme — la direction artistique livrée avec le moteur. Décide du
 * quoi (couleurs, formes) ; le reste de `src/` décide du comment (où poser
 * un arbre, quand replanter une tuile).
 *
 * N'y vont pas, malgré les apparences : les plafonds/portées (budgets
 * d'images par seconde, pas des goûts), les règles de composition
 * (`TOWN_PATCH_M`, `FOREST_PATCH_M`, lecture des lisières — des trouvailles
 * du moteur), les encodages (`CROP_KINDS`, grille de l'atlas d'arbres — des
 * contrats entre deux morceaux de code).
 *
 * Seul thème existant aujourd'hui : une campagne européenne, plutôt
 * française, vue depuis une route — assumé.
 *
 * On n'a pas à le modifier pour en changer : une application donne ses
 * tranches à `createWorld({ theme })` (voir `resolveTheme`).
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
   * Finesse du grain du sol, en **pixels d'écran par texel**.
   *
   * C'est le réglage à toucher pour rendre un sol plus ou moins granuleux, et
   * une période en mètres ne pouvait pas jouer ce rôle : elle donne un grain
   * juste à une seule distance. Trop grosse au ras du sol, elle laisse voir la
   * trame de la carte ; à dix mètres le mip l'a déjà lissée et la route
   * redevient un plastique. En pixels d'écran, la même finesse tient à toutes
   * les distances — trois pixels de côté, c'est du bitume vu de la hauteur
   * d'un homme.
   *
   * Monter la valeur grossit le grain (et coûte moins cher en filtrage) ;
   * descendre sous ~2 le fait crépiter, l'échantillonnage n'ayant plus de quoi
   * le tenir.
   */
  grainPixels: 3,
  /**
   * Ancrage de l'échelle du grain, en mètres.
   *
   * Ce n'est plus la finesse du grain — `grainPixels` la porte — mais le
   * barreau zéro de l'échelle de périodes que `grainAt` gravit par facteurs de
   * deux : 1,5 m, 3 m, 6 m, 12 m… Y toucher décale tous les barreaux d'un
   * coup, sans rien changer à la finesse vue ; c'est un réglage de phase, pas
   * d'aspect. Six mètres pour 512 texels font 1,2 cm au barreau zéro.
   */
  grainScaleM: 6,
  /**
   * Variation macro : période en mètres, amplitude en luminosité, dérive
   * chaud/froid.
   *
   * C'est ce qui empêche une prairie d'être un aplat. Le grain travaille au
   * mètre et ne se voit plus à cent ; passé cette distance, un albédo constant
   * par classe donne une carte routière — un vert uni jusqu'à l'horizon. Deux
   * cents mètres est l'échelle à laquelle un sol change réellement : un
   * versant plus sec, un creux plus gras, une parcelle fauchée l'an dernier.
   *
   * `macroStrength` porte la luminosité (0,3 = ±15 % au loin), `macroWarmth`
   * fait dériver la teinte vers le chaud dans les zones claires et vers le
   * froid dans les sombres — c'est la moitié de l'effet, et la moins voyante.
   *
   * « Au loin », parce que l'amplitude monte sur la rampe `detailNear` →
   * `detailFar` : à portée des touffes instanciées, qui ne connaissent pas
   * cette variation, le sol doit garder la couleur sur laquelle elles ont été
   * calées.
   */
  macroScaleM: 190,
  macroStrength: 0.3,
  macroWarmth: 0.07,
  /**
   * Largeur du raccord entre deux matières, en part de poids.
   *
   * Zéro donnerait une frontière au pixel de la carte de classes, un
   * escalier ; un demi redonnerait le fondu linéaire d'avant. Autour de 0,15,
   * la transition tient dans la largeur du grain : la prairie déborde dans les
   * creux du labour et réciproquement, ce qui est ce que fait une lisière.
   */
  blendWidth: 0.15,
  /**
   * Force du relief tiré du grain, en pente apparente.
   *
   * Au-delà de 1, le sol se met à moutonner sous une lumière rasante : le
   * grain n'est pas un relevé d'altitude, il n'a pas d'échelle verticale
   * propre, et on ne peut donc que le doser à l'œil.
   */
  grainRelief: 0.45,
  /**
   * Matière retenue là où le vectoriel ne dit rien — un nom de `SURFACE_LOOK`,
   * là où c'étaient quatre poids. L'herbe est de loin le pari le plus souvent
   * gagnant en rase campagne : un accotement, une friche, une banquette en sont.
   *
   * C'est aussi le réglage qui décide de la couleur d'une **grande** part du
   * sol : la donnée se tait souvent, et elle se tait d'autant plus qu'on
   * s'éloigne des pays bien relevés.
   */
  unclassified: 'grass',
  /**
   * Albédo par culture, dans l'ordre de `CROP_KINDS`. Une culture n'est pas une
   * matière : c'est un second axe, qui remplace la couleur de `farmland` là où
   * il est peint. Il a son propre canal, et il marche — on n'y touche pas.
   *
   * Ces valeurs ne sont pas choisies à l'œil : elles sont calées sur la couleur
   * que rend le motif instancié qui pousse dessus (`cropLayer`), sans quoi le
   * sol et ce qui y pousse divergent à la jointure premier plan/lointain — ce qui rend un champ
   * visible de loin (les tiges instanciées ne portent que les 50 premiers
   * mètres). `vineyard`/`orchard` n'ont pas de motif propre à `cropLayer`
   * (rang de vigne et alignement d'arbres, via `furnitureLayer`) : leur
   * albédo est calé sur les mêmes couleurs de feuillage. Le labour garde
   * l'albédo de `farmland` (`SURFACE_LOOK`), repli de toute culture inconnue.
   */
  cropAlbedo: {
    wheat: [0.566, 0.439, 0.092],
    maize: [0.123, 0.251, 0.027],
    sunflower: [0.258, 0.243, 0.022],
    plough: [0.431, 0.331, 0.08],
    vineyard: [0.168, 0.246, 0.069],
    orchard: [0.153, 0.219, 0.061],
    // Un champ de lavande vu de loin n'est pas violet vif : c'est un gris
    // bleuté que le feuillage tire vers le vert entre les rangs.
    lavender: [0.132, 0.118, 0.176],
    // Le colza en fleur, en revanche, est la tache la plus saturée d'un
    // paysage de printemps — plus jaune encore qu'un blé mûr.
    rapeseed: [0.604, 0.522, 0.061],
  },
  /** Teinte de roche sur les fortes pentes. */
  rockColor: [0.72, 0.68, 0.62],
  slopeStart: 0.22,
  slopeEnd: 0.62,
  rockStrength: 0.75,

  /**
   * L'eau, quand le sol en est fait (couverture `water`). Trois réglages, et
   * c'est le second qui fait qu'on lit de l'eau : un plan d'eau est sombre vu
   * du dessus et clair vu de biais, parce qu'il renvoie le ciel d'autant plus
   * qu'on le regarde rasant.
   */
  waterSheenColor: [0.42, 0.52, 0.6],
  /** Force du ciel renvoyé au ras (Fresnel). */
  waterSheen: 1.0,
  /** Mètres couverts par un cycle de rides. */
  waterRippleM: 9,
  /** Amplitude du relief de rides — c'est elle qui fait scintiller. */
  waterRippleRelief: 0.35,
  /**
   * La rive : part de sol mouillé au contact de l'eau, de 0 (rien) à 1.
   *
   * Une berge n'est pas une ligne où le sol s'arrête et l'eau commence : c'est
   * une bande de sol trempé, plus sombre et plus saturée, que l'eau recouvre
   * de moins en moins. Le film d'eau agit ici comme la pluie
   * (`setWetness`) — même formule, une autre cause.
   */
  shoreWet: 0.8,
  /**
   * Déplacement du point où le sol est lu, en mètres — la « frange ».
   *
   * Les cartes du sol ont un pas de 2,7 m. Lues à l'endroit exact, leurs
   * limites sont celles du carreau : un escalier à 45°, lisible comme tel dès
   * que deux matières contrastent (le sable et l'herbe, l'eau et n'importe
   * quoi). On lit donc le sol quelques mètres à côté, d'un déplacement tiré
   * d'un bruit à l'échelle de `edgeWarpScaleM` : la limite garde sa place au
   * mètre près mais perd son angle droit.
   *
   * Ce n'est pas un flou : rien n'est fondu, c'est la même limite, déplacée
   * point par point. Ce qui la fond, c'est le filtrage de la carte des
   * matières et l'interpolation des couvertures.
   *
   * Au-delà de trois mètres environ, la déformation se voit pour elle-même :
   * un bord droit (un mur de champ, un quai) se met à onduler.
   */
  edgeWarpM: 2.4,
  /** Période du bruit de frange, en mètres. Trop courte, la limite frise ; trop longue, elle se contente de glisser. */
  edgeWarpScaleM: 17,
};

// --- Les arbres ----------------------------------------------------------------
/**
 * Les treize silhouettes, décrites une fois. `hue` module la teinte de base
 * (peu saturée, la variation finale venant de la couleur d'instance).
 * `crownBase` fixe où commence la houppe (tronc dégagé d'une futaie vs
 * taillis qui part du sol) ; `trunk` à zéro, il n'y a pas de tronc du tout.
 *
 * Les quatre dernières sont le **tapis du sous-bois**, et elles portent deux
 * champs que les arbres n'ont pas : `heightM`, la taille réelle de la plante,
 * et `aspect`, sa largeur en part de sa hauteur. Un arbre tire sa hauteur de
 * son peuplement ; une fougère, elle, fait ce qu'elle fait — sans ça, la
 * fourchette commune des buissons lui donnait trois mètres.
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
  // Le tapis : ni tronc, ni houppe, et sa taille lui appartient.
  { kind: 'fern', hue: { r: 0.5, g: 1, b: 0.42 }, trunk: 0, crownBase: 1, spread: 0.42,
    heightM: [0.5, 1.1], aspect: 1.5 },
  { kind: 'fern', hue: { r: 0.6, g: 1, b: 0.48 }, trunk: 0, crownBase: 1, spread: 0.36,
    heightM: [0.6, 1.3], aspect: 1.3 },
  { kind: 'bramble', hue: { r: 0.46, g: 0.94, b: 0.42 }, trunk: 0, crownBase: 1, spread: 0.25,
    heightM: [0.7, 1.6], aspect: 1.7 },
  { kind: 'lowShrub', hue: { r: 0.36, g: 0.88, b: 0.4 }, trunk: 0, crownBase: 1, spread: 0.4,
    heightM: [1.2, 2.4], aspect: 1 },
];
/**
 * Les essences, par indices de variantes. C'est ce que lit `vegetationLayer`
 * pour composer un peuplement : un bois n'est pas un tirage uniforme dans treize
 * silhouettes, c'est deux ou trois essences qui dominent.
 *
 * `undergrowth` n'est l'essence d'aucun peuplement : c'est le tapis du sol,
 * semé par le seul sous-étage (`understoryStrata`). De loin, la strate basse
 * reste faite d'arbustes — une fougère de quatre-vingts centimètres à un
 * kilomètre coûte une instance et ne se voit pas.
 */
export const TREE_ESSENCES = {
  broadleaf: [0, 1, 2],
  column: [3, 4],
  conifer: [5, 6],
  bushy: [7, 8],
  undergrowth: [9, 10, 11, 12],
};

// --- Les peuplements -----------------------------------------------------------
/**
 * Les peuplements. Une forêt tirée uniformément dans neuf silhouettes n'est
 * pas une forêt : le contraste entre un versant résineux et un fond de
 * vallon feuillu se lit de loin, pas le détail d'une houppe. Chaque
 * peuplement fixe les essences, la hauteur, un facteur de densité, et la
 * part de sous-bois (comptée en plus des arbres, pas à leur place — un bois
 * sans strate basse se lit comme une colonnade). Tiré d'une maille de
 * `FOREST_PATCH_M`, donc ancré au lieu.
 *
 * `climates` dit où le peuplement a le droit d'exister : le pin d'Alep ne
 * pousse pas en Finlande, et sans ça la Laponie est identique à la Provence
 * quelle que soit la finesse des silhouettes. Un peuplement sans `climates`
 * pousse partout — un thème d'avant les climats se comporte comme avant.
 */
export const FOREST_TYPES = [
  {
    // Futaie de feuillus : de grands arbres, largement espacés, sous-bois clair.
    // Chêne, hêtre, frêne — le bois de plaine tempérée.
    name: 'futaie',
    climates: ['oceanic', 'continental', 'mediterraneanCool'],
    essences: ['broadleaf', 'broadleaf', 'column'],
    minHeight: 12,
    maxHeight: 22,
    density: 0.95,
    // Une futaie entretenue est dégagée au sol : c'est même ce qui la définit.
    understory: 0.12,
    tint: [0.95, 1, 0.86],
  },
  {
    // Pinède : haute, sombre, dense et serrée. Les Landes, la Sologne — une
    // plantation de pin maritime ou sylvestre, pas un bois spontané.
    name: 'pinede',
    climates: ['oceanic', 'continental', 'mediterraneanCool'],
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
    climates: [
      'oceanic',
      'oceanicUpland',
      'mediterranean',
      'mediterraneanCool',
      'mediterraneanMontane',
      'continental',
    ],
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
    climates: ['oceanic', 'continental', 'mediterraneanCool'],
    essences: ['broadleaf', 'conifer', 'bushy', 'column'],
    minHeight: 7,
    maxHeight: 16,
    density: 1.3,
    // Le bois où l'on ne passe pas en ligne droite : ronces et jeunes pousses.
    understory: 0.34,
    tint: [0.92, 1, 0.86],
  },
  {
    // Pinède méditerranéenne : pin d'Alep et pin parasol, clairsemés, sur un
    // sol de garrigue qu'on voit entre les troncs. C'est le contraire d'une
    // pinède landaise — l'ombre y est trouée, pas continue.
    name: 'pinède méditerranéenne',
    climates: ['mediterranean', 'semiArid'],
    essences: ['conifer', 'conifer', 'bushy'],
    minHeight: 7,
    maxHeight: 14,
    density: 0.85,
    // La garrigue pousse sous les pins : ciste, romarin, chêne kermès.
    understory: 0.45,
    tint: [1.02, 0.95, 0.72],
  },
  {
    // Chênaie verte : basse, dense, sombre, feuillage persistant. Le bois
    // méditerranéen qui n'est pas une pinède.
    name: 'chênaie verte',
    climates: ['mediterranean', 'mediterraneanCool'],
    essences: ['broadleaf', 'bushy', 'broadleaf'],
    minHeight: 6,
    maxHeight: 11,
    density: 1.25,
    understory: 0.4,
    tint: [0.95, 0.98, 0.74],
  },
  {
    // Pin noir et sapin de montagne méditerranéenne : Olympe, Apennins,
    // sierras. Haut, droit, sur un sol sec et caillouteux.
    name: 'pinède de montagne',
    climates: ['mediterraneanMontane'],
    essences: ['conifer', 'conifer', 'column'],
    minHeight: 11,
    maxHeight: 20,
    density: 1.05,
    understory: 0.2,
    tint: [0.88, 0.98, 0.8],
  },
  {
    // Taïga : épicéas serrés, très hauts, presque rien au sol. C'est la forêt
    // la plus uniforme d'Europe, et cette uniformité *est* son identité.
    name: 'taïga',
    climates: ['boreal'],
    essences: ['conifer', 'conifer', 'conifer', 'column'],
    minHeight: 9,
    maxHeight: 18,
    density: 1.5,
    understory: 0.18,
    tint: [0.8, 1, 0.94],
  },
  {
    // Bétulaie : bouleaux clairs et bas, la forêt de la limite — celle du
    // nord, celle de l'altitude, celle du vent.
    name: 'bétulaie',
    climates: ['boreal', 'oceanicUpland', 'alpine', 'glacial'],
    essences: ['column', 'bushy', 'broadleaf'],
    minHeight: 4,
    maxHeight: 11,
    density: 1.1,
    understory: 0.35,
    tint: [1.02, 1.02, 0.78],
  },
  {
    // Pessière subalpine : épicéas et mélèzes en pente, de plus en plus espacés
    // à mesure qu'on monte vers la limite forestière.
    name: 'pessière subalpine',
    climates: ['alpine'],
    essences: ['conifer', 'conifer', 'column'],
    minHeight: 8,
    maxHeight: 16,
    density: 1.2,
    understory: 0.16,
    tint: [0.82, 0.96, 0.88],
  },
  {
    // Bosquet sec : ce qui tient debout en steppe et en désert espagnol — des
    // pins rabougris et des buissons, très espacés. La densité basse n'est pas
    // une économie, c'est le paysage.
    name: 'bosquet sec',
    climates: ['semiArid', 'arid'],
    essences: ['bushy', 'bushy', 'conifer'],
    minHeight: 3,
    maxHeight: 8,
    density: 0.55,
    understory: 0.55,
    tint: [1.06, 0.94, 0.66],
  },
  {
    // Bois rabougri de côte venteuse : les arbres n'y montent pas, ils
    // s'étalent. L'Écosse, les îles, les caps.
    name: 'bois rabougri',
    climates: ['oceanicUpland'],
    essences: ['bushy', 'broadleaf', 'bushy'],
    minHeight: 3,
    maxHeight: 7,
    density: 0.85,
    understory: 0.5,
    tint: [0.95, 1, 0.82],
  },
];

// --- L’herbe et les fleurs -----------------------------------------------------
/** Hauteur des touffes, en mètres (une prairie non fauchée monte au genou). */
export const GRASS_MIN_HEIGHT = 0.3;
export const GRASS_MAX_HEIGHT = 0.8;
/** Largeur d'une touffe, en part de sa hauteur. */
export const GRASS_ASPECT = 0.62;
/** Part des touffes qui portent des fleurs, en pleine prairie (volontairement basse : un pré n'est pas un parterre). */
export const FLOWER_SHARE = 0.16;
/** Part de fleurs en lisière de culture, où poussent les coquelicots (lue directement dans la carte de classes filtrée). */
export const POPPY_SHARE = 0.42;

/**
 * Ce que devient l'herbe **sous les arbres**. Un sol de forêt n'est pas une
 * prairie plus sombre : c'est une litière où pousse une herbe rase, clairsemée
 * et sans éclat, parce que la lumière ne descend pas jusque-là.
 *
 * - `green` : ce qu'un bois plein vaut de végétal pour `groundCover`. Sans lui,
 *   la part de bois ne comptait pour rien et le sol d'un bois restait la seule
 *   texture du terrain, jusque sous le nez de l'observateur ;
 * - `height` et `density` multiplient la taille et le nombre des touffes ;
 * - `tint` multiplie leur couleur, canal par canal — assombrie et réchauffée
 *   vers la litière. C'est le raccord avec l'albédo de `wood`, qui peint le même sol
 *   au loin, qui décide de ces trois nombres : ils se règlent à l'œil, sur
 *   place, en regardant le sol entre les troncs.
 */
export const WOODLAND_FLOOR = {
  green: 0.55,
  height: 0.5,
  density: 0.7,
  // Le même déplacement que l'albédo de `wood`, et il n'a pas le choix : les deux
  // peignent le même sol, l'un au loin et l'autre sous le nez. Le facteur est
  // à mi-chemin de son ancienne valeur et du neutre, comme l'albédo est à
  // mi-chemin de celui de l'herbe.
  tint: [0.99, 0.91, 0.87],
};

// --- Les cultures --------------------------------------------------------------
/**
 * Hauteur et silhouette de chaque culture. `atlas` désigne la case de
 * l'atlas, `height` la hauteur en mètres, `density` la part des tirages
 * retenus — pas égale entre cultures : une touffe ne représente pas la même
 * chose selon la plante (l'atlas dessine 26 tiges de blé par case, contre 4
 * pieds de maïs), donc la densité est baissée d'autant.
 */
export const CROP_LOOK = {
  wheat: { atlas: 'wheat', height: 0.95, spread: 0.22, density: 1, tint: [1.02, 0.94, 0.62] },
  maize: { atlas: 'maize', height: 2.4, spread: 0.15, density: 0.22, tint: [0.82, 1, 0.62] },
  sunflower: { atlas: 'sunflower', height: 1.7, spread: 0.2, density: 0.3, tint: [0.96, 0.98, 0.6] },
  plough: { atlas: 'stubble', height: 0.3, spread: 0.22, density: 0.72, tint: [1, 0.94, 0.74] },
  // La lavande est un buisson bas et large, pas une tige : d'où un `spread`
  // presque égal à sa hauteur. La teinte laisse passer le violet des épis, que
  // le lavage de sol méditerranéen (jaunissant) écraserait sinon.
  lavender: { atlas: 'lavender', height: 0.6, spread: 0.28, density: 0.4, tint: [0.94, 0.9, 1.06] },
  // Le colza : une masse serrée et haute, la seule culture dont la fleur, et
  // non le feuillage, fait la couleur du champ.
  rapeseed: { atlas: 'rapeseed', height: 1.3, spread: 0.24, density: 0.85, tint: [1.02, 0.98, 0.56] },
};

// --- Le sol d'un pays ---------------------------------------------------------
/**
 * Ce que le climat fait à la couleur du sol, par famille.
 *
 * ## Pourquoi des facteurs et pas des couleurs
 *
 * Un sol est peint **deux fois** : par le shader de terrain, qui en donne
 * l'albédo lointain, et par les touffes et les tiges instanciées qui poussent
 * dessus, qui en donnent le premier plan. Les deux sont déjà calés l'un sur
 * l'autre (voir l'albédo de `grass` dans `SURFACE_LOOK`), et ce calage est ce qui empêche
 * de voir un disque de couleur différente autour de l'observateur.
 *
 * Deux palettes séparées — une pour le sol, une pour les plantes — le
 * défairaient au premier climat. Un **facteur multiplicatif** appliqué aux
 * deux, en espace linéaire, le préserve par construction : quoi que vaille
 * l'albédo de base, le sol et ce qui y pousse bougent du même rapport.
 *
 * ## Comment les lire
 *
 * Trois facteurs, canal par canal, en espace linéaire :
 *
 * - `grass` — la prairie, sol **et** touffes. Une fleur, elle, garde sa
 *   couleur : un coquelicot d'Andalousie est rouge, pas rouge fois trois ;
 * - `bare` — la terre nue et le minéral non couvert ;
 * - `farmland` — les champs, sol, albédo par culture **et** tiges.
 *
 * Et deux nombres, qui ne sont pas des couleurs mais qui font autant :
 *
 * - `grassDensity` — combien de touffes restent. C'est **ce qui rend un pays
 *   sec nu**. Un sol jauni couvert d'une prairie continue reste une prairie
 *   jaunie ; ce qui fait une steppe, c'est la terre qu'on voit entre les
 *   touffes, et rien d'autre ne la montre ;
 * - `grassHeight` — leur taille. Une pelouse d'altitude et une friche
 *   atlantique n'ont pas la même couleur, mais elles se distinguent d'abord à
 *   la hauteur.
 *
 * Ces deux-là multiplient ce que la couverture du sol décide déjà
 * (`SURFACE_LOOK`) : une lande écossaise est rase parce que c'est une lande,
 * *et* un peu plus rase parce qu'elle est en pays venté.
 *
 * Les matières relevées ne sont pas touchées (colonne `climate` à `null`) : une lande, un maquis
 * ou un éboulis disent déjà leur pays, les teinter une seconde fois le dirait
 * deux fois.
 *
 * ## Ce qui est vrai et ce qui est un choix
 *
 * Vrai : une herbe sèche est **plus claire** qu'une herbe verte — la
 * réflectance d'une paille tourne autour de 0,25, celle d'une herbe grasse
 * autour de 0,08. C'est pour ça que les facteurs méditerranéens dépassent
 * largement 1 : ils n'éclaircissent pas une couleur, ils changent de matière.
 * Vrai aussi : la terre noire d'Ukraine est sombre, le podzol nordique gris,
 * le karst grec presque blanc.
 *
 * Choix : l'amplitude. Elle a été réglée sans jamais voir le rendu — c'est
 * exactement le genre de valeur qu'un graphiste doit reprendre en regardant
 * (voir `docs/climats.md`). Ce qui ne se reprend pas sans y penser, c'est le
 * plafond : au-delà de 3,5 environ, la touffe du premier plan sature et vire
 * au blanc, parce que sa couleur d'instance multiplie une texture déjà
 * éclairée. Un test le vérifie.
 *
 * Une famille absente vaut « pas de correction » : c'est le comportement
 * d'avant que ce tableau existe, et celui de l'océanique, sur lequel tout le
 * reste du thème a été réglé.
 */
export const SOIL_LOOK = {
  /** Highlands, Islande, côtes norvégiennes : tourbe, basalte, herbe rase. */
  oceanicUpland: {
    grass: [0.92, 0.95, 1.02],
    bare: [0.78, 0.8, 0.86],
    farmland: [0.95, 0.97, 1.0],
    grassDensity: 0.85,
    grassHeight: 0.7,
  },
  /** Plaine d'Europe centrale : terre noire, et l'herbe de l'océanique. */
  continental: {
    grass: [1.02, 1.0, 0.94],
    bare: [0.8, 0.74, 0.66],
    farmland: [0.95, 0.9, 0.82],
    grassDensity: 1.0,
    grassHeight: 1.0,
  },
  /** Taïga : podzol gris, granite, prairie froide. */
  boreal: {
    grass: [0.9, 0.96, 0.98],
    bare: [0.85, 0.86, 0.9],
    farmland: [0.92, 0.94, 0.95],
    grassDensity: 0.8,
    grassHeight: 0.8,
  },
  /** Provence, Grèce, Italie : le pré est jaune huit mois sur douze. */
  mediterranean: {
    grass: [2.2, 1.35, 2.6],
    bare: [1.5, 1.25, 0.95],
    farmland: [1.25, 1.1, 0.85],
    grassDensity: 0.55,
    grassHeight: 0.7,
  },
  /** Arrière-pays portugais, Galice : la même chose de moitié. */
  mediterraneanCool: {
    grass: [1.6, 1.2, 1.8],
    bare: [1.3, 1.15, 0.95],
    farmland: [1.12, 1.05, 0.92],
    grassDensity: 0.75,
    grassHeight: 0.85,
  },
  /** Montagnes sèches : karst pâle, pelouse brûlée. */
  mediterraneanMontane: {
    grass: [1.8, 1.25, 2.0],
    bare: [1.45, 1.35, 1.2],
    farmland: [1.15, 1.08, 0.95],
    grassDensity: 0.6,
    grassHeight: 0.65,
  },
  /** Èbre, Castille, Murcie : la steppe. */
  semiArid: {
    grass: [2.8, 1.5, 3.2],
    bare: [1.7, 1.4, 1.0],
    farmland: [1.35, 1.15, 0.8],
    grassDensity: 0.3,
    grassHeight: 0.55,
  },
  /** Tabernas, Bardenas : plus d'herbe verte du tout. */
  arid: {
    grass: [3.0, 1.55, 3.4],
    bare: [1.85, 1.5, 1.05],
    farmland: [1.4, 1.18, 0.8],
    grassDensity: 0.15,
    grassHeight: 0.45,
  },
  /** Au-dessus de la forêt : pelouse rase jaune-vert, roche claire. */
  alpine: {
    grass: [1.35, 1.1, 1.5],
    bare: [1.3, 1.3, 1.35],
    grassDensity: 0.5,
    grassHeight: 0.4,
  },
  /** Névé et moraine. */
  glacial: {
    grass: [1.2, 1.15, 1.3],
    bare: [2.2, 2.3, 2.5],
    grassDensity: 0.1,
    grassHeight: 0.35,
  },
};

// --- Les matières du sol ------------------------------------------------------
/**
 * **Toutes** les matières du sol, sur un pied d'égalité, et c'est tout ce
 * qu'une matière est : une couleur, un champ de grain, et ce qu'elle laisse
 * pousser.
 *
 * Il y avait deux catégories, et la différence était un accident d'histoire.
 * Quatre « matières » vivaient dans les canaux d'une carte de poids parce que
 * chacune avait sa texture dessinée (herbe, limon, litière) ; neuf
 * « couvertures » vivaient dans un identifiant et n'avaient qu'une teinte,
 * empruntant la texture d'une matière. Une plage avait donc le grain d'un
 * labour, et la teinte était le seul levier restant pour l'en distinguer —
 * alors que ce n'est pas la teinte qui les sépare. Depuis qu'il n'y a plus
 * qu'un grain pour tout le décor, plus rien ne justifiait la hiérarchie : il
 * n'y a plus qu'une liste, et on y ajoute une matière en ajoutant une ligne.
 *
 * - `albedo` : la couleur, en linéaire. C'est la seule chose qui se lise encore
 *   à cent mètres, donc la seule qui compte vraiment ;
 * - `grain` : lequel des trois champs de la carte de grain cette matière
 *   emploie (voir `createGrainCanvas`). Deux matières souvent voisines doivent
 *   en prendre deux différents, sans quoi leur lisière perd
 *   l'interpénétration et redevient un fondu linéaire. Trois champs pour
 *   quatorze matières : la table les répartit au mieux, et une collision ne
 *   coûte que cette lisière-là ;
 * - `climate` : quel lavage climatique s'applique (`SOIL_LOOK`), ou `null`. Une
 *   lande, un maquis, un éboulis disent déjà leur pays ; les teinter une
 *   seconde fois le dirait deux fois ;
 * - `grainKeep` : part du grain conservée, de 0 (aplat) à 1. Une seule matière
 *   s'en écarte ;
 * - `grassHeight`, `grassDensity`, `grassTint` multiplient la taille, le
 *   nombre et la teinte des touffes (`groundCover`) ; `bushes` est une densité
 *   d'arbustes semés hors des bois par `vegetationLayer` — c'est ce qui fait
 *   exister un maquis, ni prairie ni forêt mais un fourré bas.
 *
 * Un champ absent vaut le neutre : la table ne décrit que les écarts. Une
 * matière peinte de la bonne couleur mais couverte d'une prairie de quatre-
 * vingts centimètres reste une prairie, d'où la strate basse ici et pas ailleurs.
 */
export const SURFACE_LOOK = {
  // --- Le végétal ordinaire -------------------------------------------------
  grass: { albedo: [0.051, 0.135, 0.017], grain: 0, climate: 'grass' },
  // Un sol de forêt est une litière, pas un pré : à mi-chemin de l'herbe. Le
  // climat ne le lave pas — une hêtraie se ressemble d'un pays à l'autre.
  wood: { albedo: [0.047, 0.096, 0.019], grain: 1, climate: null },
  farmland: { albedo: [0.431, 0.331, 0.08], grain: 2, climate: 'farmland' },
  // Lotissement : pelouses tondues et allées. C'était un mélange peint dans un
  // canal (deux tiers d'herbe, un tiers de minéral) ; c'est désormais une
  // matière, et son albédo est la moyenne exacte que ce mélange rendait — la
  // reprendre à l'œil est une décision à part, pas un effet de bord de la fusion.
  settled: { albedo: [0.125, 0.176, 0.088], grain: 1, climate: 'grass' },

  // --- Les couvertures végétales --------------------------------------------
  // Bruyère et molinie sèche : brun-pourpre, la couleur d'un moor. Rase, dense,
  // et elle ne porte quasiment pas d'arbre.
  heath: {
    albedo: [0.159, 0.122, 0.08],
    grain: 2,
    climate: null,
    grassHeight: 0.45,
    grassDensity: 0.95,
    grassTint: [1.02, 0.84, 0.76],
    bushes: 0.3,
  },
  // Maquis et garrigue : olive poussiéreux, jamais le vert d'un pré. Peu
  // d'herbe, beaucoup d'arbustes — l'inverse exact d'une prairie.
  scrub: {
    albedo: [0.147, 0.171, 0.08],
    grain: 1,
    climate: null,
    grassHeight: 0.55,
    grassDensity: 0.4,
    grassTint: [1.04, 0.94, 0.7],
    bushes: 0.9,
  },
  // Marais, tourbière, roselière : le vert le plus profond du décor, et la
  // seule couverture plus haute qu'une prairie.
  wetland: {
    albedo: [0.072, 0.107, 0.048],
    grain: 1,
    climate: null,
    grassHeight: 1.4,
    grassDensity: 1,
    grassTint: [0.86, 1.04, 0.82],
    bushes: 0.08,
  },
  // Pelouse d'altitude et toundra : vert jaune, rase et continue.
  alpine: {
    albedo: [0.205, 0.254, 0.107],
    grain: 2,
    climate: null,
    grassHeight: 0.4,
    grassDensity: 0.9,
    grassTint: [0.94, 1.02, 0.78],
    bushes: 0.04,
  },

  // --- Le minéral -----------------------------------------------------------
  bare: { albedo: [0.27, 0.255, 0.225], grain: 0, climate: 'bare' },
  // L'éboulis et la dalle sont deux paysages : une pente de cailloux qui bouge,
  // un plateau de pierre. Les confondre était le défaut du gris unique.
  scree: {
    albedo: [0.323, 0.292, 0.254],
    grain: 1,
    climate: null,
    grassHeight: 0.3,
    grassDensity: 0.06,
    grassTint: [1, 0.96, 0.88],
    bushes: 0,
  },
  rock: {
    albedo: [0.371, 0.332, 0.27],
    grain: 2,
    climate: null,
    grassHeight: 0.35,
    grassDensity: 0.1,
    grassTint: [1, 0.96, 0.88],
    bushes: 0.02,
  },
  sand: {
    albedo: [0.624, 0.539, 0.361],
    grain: 1,
    climate: null,
    grassHeight: 0.6,
    grassDensity: 0.08,
    grassTint: [1.06, 0.98, 0.72],
    bushes: 0.05,
  },

  // --- Les deux matières à part ---------------------------------------------
  // Le revêtement urbain. Sa couleur ne vient pas d'ici mais de la voirie
  // (`townStyle.pavementTone`), pour qu'une bordure de trottoir et le sol
  // qu'elle borde ne puissent pas diverger : l'albédo posé ici n'est qu'un
  // repli. Seule matière qui assourdit le grain — une ville n'est pas une terre
  // plus grise, c'est une dalle, qui garde du grain du bitume voisin en plus sourd.
  pavement: {
    albedo: [0.31, 0.3, 0.28],
    grain: 0,
    climate: 'pavement',
    grainKeep: 0.55,
    grassDensity: 0,
    bushes: 0,
  },
  // L'eau, et c'est la seule matière que le shader traite à part : elle ne se
  // mélange pas aux autres, elle les remplace, et ce qui la fait lire est son
  // reflet (`waterSheen`), pas son albédo — presque noir. Rien n'y pousse, et
  // ce n'est pas un réglage d'aspect : une touffe sortant de la Seine se
  // verrait de loin.
  water: {
    albedo: [0.021, 0.045, 0.06],
    grain: 0,
    climate: null,
    grassHeight: 0,
    grassDensity: 0,
    bushes: 0,
  },
};

// --- Les bourgs ----------------------------------------------------------------
/**
 * Les palettes. Chacune porte deux ou trois tons de mur, deux tons de toit,
 * deux tons de volet, et les formes de toit admises (deux ou trois, jamais
 * plus). Le volet est le seul endroit du bâti où une vraie couleur est
 * admise (mur et toit varient peu, donnés par la carrière et la tuilerie du
 * coin) : le bleu de Provence, le rouge d'Alsace, le vert de Bretagne.
 *
 * `climates` restreint la palette aux familles où elle est plausible : les
 * huit premières sont françaises, et sans ça un village polonais et un
 * village andalou sont tirés dans la même liste. Une palette sans `climates`
 * reste tirée partout.
 *
 * `pitch` remplace la pente de toit par défaut pour ce bourg-là, et ce n'est
 * pas un détail : un toit-terrasse andalou, une tuile canal presque plate et
 * un pignon balte à quarante degrés ne sont pas trois teintes, ce sont trois
 * pays — et la silhouette se lit de plus loin que la couleur.
 */
export const TOWN_PALETTES = [
  {
    name: 'calcaire',
    climates: ['oceanic', 'continental', 'mediterraneanCool'],
    walls: ['#e6ddc9', '#dcd2bb', '#efe8d8'],
    roofs: ['#b0654a', '#9c5a44'],
    shutters: ['#93a6ab', '#c6bfab'],
    roofShapes: ['gable', 'hip'],
  },
  {
    name: 'ocre',
    climates: ['mediterranean', 'mediterraneanCool', 'semiArid', 'arid'],
    walls: ['#e8cfa8', '#dcbe94', '#f0dcc0'],
    roofs: ['#c07b4c', '#ab6a45'],
    shutters: ['#7d8fae', '#7c8a5c'],
    roofShapes: ['gable', 'hip', 'flat'],
    // Tuile canal : la pente la plus faible qui tienne encore une tuile.
    pitch: 0.42,
  },
  {
    name: 'granit',
    climates: ['oceanic', 'oceanicUpland'],
    walls: ['#cfcdc6', '#c0bfba', '#dcdad3'],
    roofs: ['#6a6f78', '#585d66'],
    shutters: ['#3f5a78', '#3d5a4a'],
    roofShapes: ['gable', 'pyramid'],
    // L'ardoise se pose raide : elle glisse, et il pleut.
    pitch: 0.75,
  },
  {
    name: 'brique',
    climates: ['oceanic', 'continental'],
    walls: ['#d9a98e', '#c8977d', '#e4bda6'],
    roofs: ['#8d5f4c', '#7a5041'],
    shutters: ['#415c48', '#d5cab2'],
    roofShapes: ['gable', 'hip'],
    pitch: 0.7,
  },
  {
    name: 'colombage',
    climates: ['oceanic', 'continental'],
    walls: ['#efe6d4', '#e3d6c0', '#d8c8ae'],
    roofs: ['#8a5a49', '#6f4b3f'],
    shutters: ['#8e4034', '#405c3f'],
    roofShapes: ['gable', 'gable', 'hip'],
    pitch: 0.8,
  },
  {
    name: 'chaux',
    climates: ['mediterranean', 'mediterraneanCool', 'semiArid'],
    walls: ['#eeeae0', '#e3ded2', '#f4f1e9'],
    roofs: ['#a9713f', '#8f6039'],
    shutters: ['#9fb2b6', '#93a37c'],
    roofShapes: ['gable', 'flat'],
    pitch: 0.42,
  },
  {
    name: 'ardoise',
    climates: ['oceanic', 'oceanicUpland', 'continental'],
    walls: ['#dfe0dd', '#d0d2cf', '#eceded'],
    roofs: ['#5b626b', '#4c525a'],
    shutters: ['#dbd8cf', '#6d7f92'],
    roofShapes: ['gable', 'pyramid', 'hip'],
    pitch: 0.75,
  },
  {
    name: 'lauze',
    climates: ['alpine', 'mediterraneanMontane', 'oceanicUpland'],
    walls: ['#d5cbb8', '#c5bba7', '#e0d7c6'],
    roofs: ['#77726a', '#655f57'],
    shutters: ['#6f5a42', '#4c5f4a'],
    roofShapes: ['gable', 'hip'],
    // La lauze est lourde : la charpente ne la porte pas en pente forte.
    pitch: 0.6,
  },
  {
    // Bois rouge de Scandinavie : rouge de Falun, encadrements blancs, toit
    // sombre et raide. C'est le village nordique en une couleur.
    name: 'bois rouge',
    climates: ['boreal', 'oceanicUpland', 'glacial'],
    // Rouge de Falun **délavé**. Le vrai est bien plus sombre et plus saturé,
    // mais la règle pastel de ce fichier (voir l'en-tête de `townStyle`) tient
    // tout le nuancier ensemble, et un mur qui la casse fait basculer le décor
    // du côté du jouet. C'est un arbitrage d'auteur, pas une approximation.
    walls: ['#c07a63', '#b8705c', '#c98a70'],
    roofs: ['#4a4f55', '#3f444a'],
    shutters: ['#e8e4da', '#d8d2c4'],
    roofShapes: ['gable', 'hip'],
    // La neige doit glisser, sinon elle reste et le toit descend.
    pitch: 0.85,
  },
  {
    // Bois goudronné sombre : chalet d'altitude et ferme nordique. Le même
    // matériau que le rouge de Falun, vieilli au lieu d'être peint.
    name: 'bois vieilli',
    climates: ['boreal', 'alpine'],
    // Bois gris de vieillissement plutôt que bois goudronné : même raison que
    // ci-dessus, le goudron sort de la plage claire du nuancier.
    walls: ['#bb9d74', '#c7aa83', '#b39468'],
    roofs: ['#5d5f5a', '#4c4e4a'],
    shutters: ['#e0d8c6', '#8c5b3a'],
    roofShapes: ['gable', 'hip'],
    pitch: 0.75,
  },
  {
    // Badigeon andalou : chaux vive, toit presque plat, volets francs. Le seul
    // endroit d'Europe où le mur est plus clair que le ciel.
    name: 'badigeon',
    climates: ['arid', 'semiArid', 'mediterranean'],
    walls: ['#f4f2ea', '#eae7dc', '#faf8f2'],
    roofs: ['#c07a4e', '#a96a45'],
    shutters: ['#3f6f8e', '#2f5a4a'],
    roofShapes: ['flat', 'gable'],
    // Il ne pleut pas : le toit n'a presque pas besoin de pente.
    pitch: 0.25,
  },
  {
    // Brique et pignon droit : Baltique, Pologne, Prusse. Le pignon sur rue est
    // ce qui distingue une ville hanséatique d'un bourg français.
    name: 'brique balte',
    climates: ['continental', 'boreal'],
    walls: ['#c08670', '#b87f66', '#cb9580'],
    roofs: ['#6a4a3e', '#7b5747'],
    shutters: ['#4a5f4a', '#d9d2c2'],
    roofShapes: ['gable', 'hip'],
    pitch: 0.85,
  },
  {
    // Pierre grecque : moellon clair et tuile romaine, sur les montagnes du
    // sud. Ni le blanc des Cyclades, ni l'ocre de Provence.
    name: 'pierre grecque',
    climates: ['mediterraneanMontane', 'mediterranean'],
    walls: ['#ddd4c1', '#cfc5b0', '#e8e0d0'],
    roofs: ['#b06a44', '#96593a'],
    shutters: ['#3d6b86', '#7a6a4a'],
    roofShapes: ['gable', 'hip'],
    pitch: 0.45,
  },
  {
    // Crépi alpin : mur clair, large débord, toit peu pentu chargé de pierres.
    // Le contraire du chalet à pignon raide qu'on imagine.
    name: 'crépi alpin',
    climates: ['alpine'],
    walls: ['#efe8d8', '#e2dac8', '#f5f0e4'],
    roofs: ['#7a736a', '#66605a'],
    shutters: ['#7d4a33', '#3f5a4a'],
    roofShapes: ['gable', 'hip'],
    pitch: 0.45,
  },
];

// --- Les bâtiments qui ont une fonction ----------------------------------------
/**
 * Ce qu'un bâtiment devient quand on sait à quoi il sert (la fonction vient
 * de la couche `poi`, nommée par `buildingLayer.buildingPersonalityFor`).
 *
 * Trois registres qui ne se mélangent pas : `wall`/`roof`/`shape`
 * remplacent la palette du bourg (bâti hors matériau du pays — hôpital,
 * grande surface) ; `front` ne remplace rien, c'est le bandeau de
 * rez-de-chaussée d'un commerce ; `spire`/`dome`/`minaret` sont des volumes
 * ajoutés à l'empreinte. Une personnalité peut n'en porter qu'un (une église
 * garde les murs de son bourg, ne se reconnaît qu'à son clocher).
 */
export const BUILDING_PERSONALITIES = {
  church: { spire: { wall: '#d3ccba', roof: '#4f555d' } }, // pierre de taille et ardoise, autre matériau que les maisons autour
  mosque: { shape: 'flat', dome: '#4f8792', minaret: '#efe9db' }, // coupole sur terrasse, flotterait sur un rampant
  hospital: { wall: '#eceff0', roof: '#c2c8ca', shape: 'flat' },
  retail: { wall: '#d8d4cb', roof: '#71767b', shape: 'flat' },
  bakery: { front: '#7d4a2a' }, // bois verni foncé
  shop: { front: '#3f5560' }, // se lit à sa valeur, pas sa teinte
};

/**
 * Devanture : proportions de la façade commerçante, sur le seul pan le plus
 * long de l'empreinte (`buildingLayer._appendBuilding`) — les autres pans
 * gardent le bandeau plein. `doorWidthM` reste large : la vitrine sert d'entrée.
 */
export const SHOPFRONT_WINDOW_WIDTH_M = 1.1;
export const SHOPFRONT_DOOR_WIDTH_M = 1.7;
export const SHOPFRONT_MARGIN_M = 0.45;
export const SHOPFRONT_GAP_M = 0.3;
export const SHOPFRONT_SILL_M = 0.15;
/** Hauteur réservée à l'enseigne, au sommet du bandeau — voir `SHOPFRONT_HEIGHT_M`. */
export const SHOPFRONT_FASCIA_HEIGHT_M = 0.6;
export const SHOPFRONT_FASCIA_GAP_M = 0.14;

/**
 * Pictogramme de l'enseigne perpendiculaire (`buildingLayer.appendShopSignBlade`),
 * par classe brute de point d'intérêt (`properties.class`, pas le `kind` déjà
 * agrégé de `buildingPersonalityFor`). Un émoji en un seul point de code
 * chacun : `materials/labelAtlas.js` ne sait pas recomposer une séquence à
 * variateur ou à jointure.
 */
export const SHOPFRONT_EMOJI = {
  bakery: '🥖',
  alcohol_shop: '🍷',
  bar: '🍺',
  beer: '🍺',
  butcher: '🥩',
  cafe: '☕',
  restaurant: '🍽',
  fast_food: '🍔',
  hairdresser: '💇',
  pharmacy: '💊',
  bank: '🏦',
  bicycle: '🚲',
  clothing_store: '👕',
  ice_cream: '🍦',
  laundry: '🧺',
  music: '🎵',
  post: '📮',
  grocery: '🛒',
};
/** Repli d'une classe non répertoriée, ou d'un commerce sans point d'intérêt
 *  matché (`class` absent) : la façade, sans autre indice. */
export const SHOPFRONT_EMOJI_DEFAULT = '🏪';

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
 * Profils de chaussée, du plus grand au plus petit. Le marquage donne
 * l'échelle : une départementale portant les pointillés d'une nationale se
 * lirait comme une nationale rétrécie. `width` sert deux fois (section et
 * largeur du ruban), donc les deux ne peuvent pas diverger.
 *
 * `edgeLines` et `centerDash` disent ce que la classe **porte**, et c'est bien
 * une description du pays. Ils ne sont plus dessinés dans la texture : c'est
 * `roadMarkings` qui les lit et pose les lignes en géométrie, à la même place
 * qu'avant — en deçà de l'accotement pour la rive, sur l'axe pour l'autre.
 */
export const ROAD_PROFILES = {
  express: { width: 12, shoulder: 1.2, edgeLines: true, centerDash: true, texture: 256 },
  major: { width: 8.5, shoulder: 0, edgeLines: true, centerDash: true, texture: 128 },
  minor: { width: 5, shoulder: 0, edgeLines: true, centerDash: false, texture: 128 },
  lane: { width: 3.6, shoulder: 0, edgeLines: false, centerDash: false, texture: 64 },
  // `symbol` dit ce que la classe porte **peint au sol**, au même titre
  // qu'`edgeLines` : le vélo n'est pas une décoration, c'est la seule chose
  // qui distingue une piste cyclable d'une allée de service de même largeur.
  cycleway: { width: 2.2, shoulder: 0, edgeLines: false, centerDash: false, symbol: 'cycle', tint: '#56565c', texture: 64 },
  track: { width: 3, shoulder: 0, surface: 'dirt', ruts: true, texture: 64 },
  path: { width: 1.4, shoulder: 0, surface: 'dirt', texture: 64 },
};
/** Revêtements : couleur de base et amplitude du grain. */
export const ROAD_SURFACES = {
  asphalt: { base: '#4a4a4e', grain: 26 },
  dirt: { base: '#8a7d63', grain: 34 },
  ballast: { base: '#847d70', grain: 46 }, // pierre concassée, grain le plus fort des trois

};
/** Terre claire de l'accotement. */
export const ROAD_SHOULDER_COLOR = '#8c8168';

/**
 * Blanc de marquage — un seul, pour tout ce qui est peint au sol.
 *
 * Il a existé deux fois : ici pour les hachures de comblement, et dans
 * `createRoadCanvas` pour les lignes de rive et l'axe, à deux nuances près et
 * sous une opacité. La texture n'en porte plus aucune : rive, axe, ligne
 * d'effet, passage piétons et hachures sont de la géométrie, et tous lisent
 * cette valeur-ci. Elle est donc devenue le seul réglage du marquage — et le
 * marquage est devenu **opaque**, là où la texture le mêlait au bitume à
 * quatre cinquièmes.
 */
export const ROAD_MARKING_COLOR = '#e9e7de';

// --- Les ouvrages d'art ---------------------------------------------------------
/**
 * Les familles d'ouvrage : de quoi sont faits les ponts et les têtes de tunnel
 * d'un pays. Même principe que `TOWN_PALETTES` — le bâti d'une région est
 * régulier, et un pont l'est plus encore qu'une maison : les ouvrages d'une
 * vallée sortent du même bureau d'études et de la même carrière. La famille se
 * tire donc sur la même maille que la palette du bourg (`worksStyleAt`), pas
 * par ouvrage.
 *
 * Trois registres, qui se lisent de loin à leur silhouette plus qu'à leur
 * couleur : la maçonnerie porte épais sur des piles trapues, le béton porte
 * mince sur des piles-voiles, l'acier porte mince sur des fûts fins.
 *
 * Cotes en mètres. `deck.overhang` est le débord de la corniche au-delà de la
 * rive de la chaussée ; `pier.span` la part de la largeur du tablier que
 * couvre la pile (1 = toute la largeur) ; `parapet.kind` ne change que la
 * silhouette (`wall` plein, `rail` mince et haut).
 */
export const WORKS_STYLES = [
  {
    name: 'maçonnerie',
    deck: { thickness: 1.3, overhang: 0.55, edgeDepth: 0.5, color: '#8f8879', edge: '#b3aa97' },
    pier: { spacing: 26, thickness: 2.2, span: 0.55, colorFoot: '#7d766a', colorTop: '#9c9484' },
    abutment: { thickness: 2.6, colorFoot: '#7d766a', colorTop: '#9c9484' },
    parapet: { kind: 'wall', height: 0.95, thickness: 0.42, coping: 0.07, color: '#a49b89', colorTop: '#c0b6a1' },
    portal: { face: '#8b8477', arch: '#2c2a27', crown: 1.6, jamb: 2.4 },
  },
  {
    name: 'béton',
    deck: { thickness: 0.95, overhang: 0.8, edgeDepth: 0.32, color: '#8d8d8a', edge: '#b8b7b2' },
    pier: { spacing: 34, thickness: 1.5, span: 0.42, colorFoot: '#8a8a87', colorTop: '#a5a5a1' },
    abutment: { thickness: 2, colorFoot: '#8a8a87', colorTop: '#a5a5a1' },
    parapet: { kind: 'wall', height: 0.82, thickness: 0.3, coping: 0.05, color: '#adaca7', colorTop: '#c6c5bf' },
    portal: { face: '#9a9a96', arch: '#2a2b2d', crown: 1.4, jamb: 2 },
  },
  {
    name: 'acier',
    deck: { thickness: 0.7, overhang: 0.6, edgeDepth: 0.55, color: '#5c625f', edge: '#7d837f' },
    pier: { spacing: 30, thickness: 1.1, span: 0.3, colorFoot: '#6d6f6d', colorTop: '#8a8c89' },
    abutment: { thickness: 1.8, colorFoot: '#82807a', colorTop: '#9d9b94' },
    parapet: { kind: 'rail', height: 1.15, thickness: 0.11, coping: 0.05, color: '#7f8683', colorTop: '#9aa19d' },
    portal: { face: '#8e8c86', arch: '#26282a', crown: 1.3, jamb: 2.1 },
  },
];

// --- La voirie -----------------------------------------------------------------
/**
 * La section d'une rue, côté trottoir : caniveau, bordure, trottoir
 * légèrement surélevé, dans cet ordre depuis la chaussée. Cotes du terrain,
 * volontairement basses (le trottoir doit se lire comme une marche, pas un
 * quai). `surfaces` varie par bourg (`streetSurfaceAt`), pas par trottoir.
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
   * Le **rebord**, un par bourg : `kerb` la bordure, `joint` le bord arrière —
   * toujours plus sombre, parce qu'il est à l'ombre du mur ou de la haie qui le
   * suit. Du ciment, dans les quatre cas : une commune coule ses bordures d'un
   * coup, et une bordure est du béton à peu près partout.
   *
   * Le **dessus** du trottoir n'est plus ici, et c'est le lot : il vient de
   * `pavement`, par climat. Un trottoir de ville se prolonge maintenant dans le
   * sol lui-même (couverture `pavement` de `groundClassMap`), et le sol est
   * peint par un shader qui n'a qu'un albédo par couverture pour toute la
   * bulle. Une teinte tirée par bourg, sur une maille de 1400 m, se lirait donc
   * comme une frontière au milieu de la ville. Ce que le pays change, en
   * revanche, le shader sait le dire.
   */
  surfaces: [
    { name: 'béton balayé', kerb: '#c0bbaf', joint: '#948d80' },
    { name: 'enrobé clair', kerb: '#b3aea3', joint: '#797570' },
    { name: 'pavé de grès', kerb: '#b5ac9a', joint: '#847b6c' },
    { name: 'béton désactivé', kerb: '#b8b1a2', joint: '#8b8374' },
  ],
  /**
   * Le dessus du trottoir, par famille climatique — et, par la même valeur, le
   * sol revêtu de la ville entière (voir `townStyle.pavementTone`).
   *
   * Une seule table pour les deux, parce qu'il n'y a pas deux surfaces : la
   * bordure borde le sol, elle ne borde pas un ruban de trottoir posé sur un
   * autre sol. Deux valeurs divergentes se liraient comme une bande de couleur
   * le long de chaque bordure.
   *
   * Ce que le climat change n'est pas un caprice : le nord pose du béton gris,
   * le Midi de la pierre claire qui blanchit au soleil, la steppe et le désert
   * un enrobé qui prend la poussière du pays. `default` est l'océanique, sur
   * lequel le reste du thème est réglé.
   */
  /**
   * Force du grain du revêtement, de 0 (aplat) à 1 (le grain du sol qu'il
   * remplace). Une dalle n'est pas lisse — elle garde quelque chose du grain
   * du bitume voisin — mais elle l'a plus sourd qu'une terre : à 1, un
   * trottoir se lirait comme une allée de gravier.
   */
  pavementGrain: 0.55,
  pavement: {
    default: '#9b968c',
    oceanic: '#9b968c',
    oceanicUpland: '#93918c',
    mediterranean: '#b3a992',
    mediterraneanCool: '#aaa190',
    mediterraneanMontane: '#a9a08e',
    semiArid: '#b2a68f',
    arid: '#bdae94',
    continental: '#9a968e',
    boreal: '#8f8d89',
    alpine: '#98958f',
    glacial: '#93938f',
  },
};

// --- L’eau ---------------------------------------------------------------------
/** Largeur de la ripisylve, ajoutée de part et d'autre du lit dans la carte de classes (`groundClassMap`, voir `WATERWAY_CLASSES`). */
export const RIPARIAN_BUFFER_M = 7;

/**
 * Largeur des cours d'eau linéaires, en mètres, par `class` OpenMapTiles.
 * Les grands fleuves sont déjà des polygones dans la couche `water` ; ce qui
 * reste ici est trop étroit pour l'être.
 */
export const WATERWAY_CLASSES = {
  river: 9,
  canal: 6,
  stream: 3,
  drain: 1.6,
  ditch: 1.2,
};

// --- Ce qui vit ----------------------------------------------------------------
/**
 * Les deux seules couleurs de la couche vivante. L'oiseau est une silhouette
 * (indépendante de l'éclairage) ; la fumée est donnée telle qu'elle sort du
 * shader, sans conversion.
 */
export const LIFE_COLORS = {
  bird: '#2b2f36',
  smoke: [0.86, 0.85, 0.83],
};

// --- Les bêtes -----------------------------------------------------------------
/** Convertit un nuancier de robes `{espèce: ['#rrggbb', …]}` en linéaire. */
function mapCoats(table) {
  const out = {};
  for (const [kind, list] of Object.entries(table)) out[kind] = list.map(srgb);
  return out;
}

/**
 * Ce qui, sur une bête, ne change pas d'un individu à l'autre.
 *
 * La robe, elle, est teintée par instance (voir `FAUNA_COATS`) : ces
 * couleurs-ci sont celles qui doivent **résister** à la teinte, faute de quoi
 * on obtient des vaches à sabots bruns et des cerfs à bois fauves.
 */
export const FAUNA_COLORS = {
  hoof: srgb('#2e2a24'),
  claw: srgb('#3a342c'),
  muzzle: srgb('#c2938c'), // mufle rose-gris du bovin
  nose: srgb('#2a2724'),
  horn: srgb('#b6aa8e'),
  antler: srgb('#8f8067'),
  eye: srgb('#141312'),
  tusk: srgb('#ded6c4'),
  comb: srgb('#a3372f'), // crête et caroncule de la poule
  beak: srgb('#c9a13f'), // bec et pattes, la même corne jaune
  udder: srgb('#d3a49d'),
  mane: srgb('#3a322a'), // crins : crinière et queue du cheval
};

/**
 * Les robes, par espèce — une liste dans laquelle chaque bête tire la sienne.
 *
 * Une seule robe par espèce était le plus visible des défauts d'un troupeau
 * engendré : dix vaches rigoureusement identiques ne se lisent pas comme dix
 * vaches. Les listes restent courtes et **plausibles pour l'espèce** : ce sont
 * les robes qu'on rencontre, pas un nuancier. Un item répété pèse d'autant
 * plus lourd dans le tirage (même convention que les essences d'arbre).
 *
 * Ces couleurs multiplient le modelé du modèle (voir `robe`) : donner ici la
 * couleur du flanc en pleine lumière suffit, les ombres suivent.
 *
 * Converties en linéaire à la définition, comme tout le reste du nuancier :
 * elles partent telles quelles dans `setColorAt`, qui n'applique aucune
 * conversion.
 */
export const FAUNA_COATS = mapCoats({
  // Pie noire, froment, brune des Alpes, et la blanche du Charolais.
  cow: ['#ded7cb', '#ded7cb', '#a5714a', '#8d6a52', '#e6e0d2'],
  // La toison va du blanc sale au gris ; le brun est celui des races de lande.
  sheep: ['#ddd6c8', '#ddd6c8', '#cfc6b4', '#a8977f', '#7d6f5e'],
  goat: ['#cbbfa8', '#8a6f52', '#5d534a', '#ddd6c8'],
  // Alezan d'abord, puis bai, puis gris et noir — l'ordre des prés.
  horse: ['#8a5a3a', '#8a5a3a', '#6b4630', '#9a958c', '#4a423c'],
  donkey: ['#9a9488', '#9a9488', '#7d766c', '#b3ab9c'],
  chicken: ['#c9c2b4', '#a5714a', '#8d5a45', '#d8d2c4', '#4a423a'],

  // Le fauve du cervidé change avec la saison : roux l'été, gris l'hiver.
  deer: ['#a5714a', '#a5714a', '#8f6a4c', '#7f6e5c'],
  doe: ['#a5714a', '#9c7052', '#8f6a4c'],
  reindeer: ['#9a9082', '#8a7f70', '#b0a798'],
  boar: ['#3d3630', '#3d3630', '#4a423a', '#5a4f42'],
  fox: ['#b4602c', '#b4602c', '#a55a30', '#c47038'],
  wolf: ['#8a8378', '#6f685e', '#9c9488', '#5a544c'],
  bear: ['#5a4432', '#5a4432', '#4a3728', '#7a5c42'],
});

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
  chestnut: srgb('#8a5a3a'), // robe alezane du cheval, se détache de l'herbe
  donkeyGrey: srgb('#9a9488'), // robe grise de l'âne, plus claire et froide que le cheval
  // Le gibier : trois robes qui doivent se détacher d'un sous-bois sombre sans
  // être des taches — un chevreuil fluo dans un bois se voit de trop loin.
  fawn: srgb('#a5714a'), // robe fauve du cervidé
  bristle: srgb('#3d3630'), // soies du sanglier, plus froides et plus sombres qu'un cuir
  antler: srgb('#8f8067'), // bois et andouillers, gris-beige
  feather: srgb('#c9c2b4'),
  comb: srgb('#a3372f'),
  linen: srgb('#e6e2d8'),
  cloth: srgb('#7fa6c4'),
  clothWarm: srgb('#c98f74'),
  signalGreen: srgb('#2f8a4a'),
  signalAmber: srgb('#d09a2a'),
  black: srgb('#22262b'),

  // Verres de feu tricolore au repos (couleur assombrie derrière le verre, pas noir).
  redDark: srgb('#3a1f1e'),
  amberDark: srgb('#3a2f1a'),
  greenDark: srgb('#1c3226'),

  // --- Feuillages -----------------------------------------------------------
  // Plusieurs verts peu saturés : se croisent avec la couleur d'instance, ne doivent pas déjà être poussés.
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
 * Les trois couleurs d'ambiance. `fog` teinte le brouillard et le raccord
 * d'horizon du ciel (doivent rester identiques, sinon couture visible).
 * `nightZenith`/`nightHorizon` remplacent Preetham sous l'horizon.
 */
export const SKY_PALETTE = {
  fog: '#e8eef3',
  nightZenith: '#0d1428', // une nuit sombre, pas noire (voir sceneEnvironment.js)

  nightHorizon: '#1c2c4c',

  /**
   * L'air d'un pays.
   *
   * Le brouillard est la couleur la plus déterminante du décor : il décide de
   * la distance apparente et de l'heure qu'il fait. C'est aussi ce qui distingue
   * le plus immédiatement deux régions à la même heure — l'air d'une côte
   * atlantique est laiteux et bleu, celui d'une plaine castillane est chaud et
   * poussiéreux, celui d'un col alpin est presque transparent.
   *
   * Ce n'est **pas** la météo, qui reste un état fourni par l'application
   * (`environment/weather.js`) : la palette dit de quelle couleur est l'air de
   * ce pays, la météo dit combien il y en a aujourd'hui.
   *
   * Une variante ne redit que ce qu'elle change ; le reste vient des valeurs
   * ci-dessus. Une famille absente garde la palette de base, qui est celle
   * d'avant que les variantes existent.
   */
  variants: [
    {
      name: 'atlantique',
      climates: ['oceanicUpland'],
      // Plus gris et plus dense : c'est un air chargé d'eau, pas une brume.
      fog: '#dfe6ea',
    },
    {
      name: 'midi',
      climates: ['mediterranean', 'mediterraneanCool'],
      fog: '#eeeadf',
    },
    {
      name: 'poussière',
      climates: ['semiArid', 'arid'],
      fog: '#efe6d6',
      // Une nuit de pays sec est plus chaude et plus claire : il n'y a pas de
      // couche d'eau pour l'éteindre.
      nightHorizon: '#2a2b40',
    },
    {
      name: 'continental',
      climates: ['continental'],
      fog: '#e9eef1',
    },
    {
      name: 'boréal',
      climates: ['boreal', 'glacial'],
      fog: '#e6edf2',
      nightZenith: '#0b1226',
    },
    {
      name: 'altitude',
      climates: ['alpine', 'mediterraneanMontane'],
      // L'air y est le plus clair d'Europe : le lointain reste lisible bien
      // plus loin qu'ailleurs, et c'est ce qui fait la montagne.
      fog: '#e2ecf4',
    },
  ],
};

/**
 * Ce qui fait la silhouette d'une haie, par famille. Un balayage modulé porte
 * l'essentiel de la lecture (crête et flancs qui respirent), ponctué
 * d'arbustes en accent, espacés (`spacingM` >> `alongM`) pour ne pas
 * redonner l'effet de tube qu'ils corrigent. La géométrie exécute ces cotes
 * (`hedgeGeometry`) ; le budget de détail vit là-bas.
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
    /**
     * Longueur du bout arrondi, en mètres. Une haie s'arrêtait au couteau, sur
     * la section entière tranchée net ; elle rentre maintenant sur cette
     * longueur-là, en quart d'ellipse (`hedgeGeometry.hedgeEndTaper`). À peu
     * près la largeur de la haie : c'est le rayon d'un bout taillé.
     */
    noseM: 1.1,
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
    noseM: 0.7,
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
    woodFloor: WOODLAND_FLOOR,
  },
  crops: CROP_LOOK,
  surfaces: SURFACE_LOOK,
  soils: SOIL_LOOK,
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
  shopfront: {
    windowWidthM: SHOPFRONT_WINDOW_WIDTH_M,
    doorWidthM: SHOPFRONT_DOOR_WIDTH_M,
    marginM: SHOPFRONT_MARGIN_M,
    gapM: SHOPFRONT_GAP_M,
    sillM: SHOPFRONT_SILL_M,
    fasciaHeightM: SHOPFRONT_FASCIA_HEIGHT_M,
    fasciaGapM: SHOPFRONT_FASCIA_GAP_M,
    emoji: SHOPFRONT_EMOJI,
    emojiDefault: SHOPFRONT_EMOJI_DEFAULT,
  },
  roads: {
    profiles: ROAD_PROFILES,
    surfaces: ROAD_SURFACES,
    shoulderColor: ROAD_SHOULDER_COLOR,
    markingColor: ROAD_MARKING_COLOR,
  },
  works: WORKS_STYLES,
  streets: STREET_LOOK,
  water: { waterways: WATERWAY_CLASSES, riparianBufferM: RIPARIAN_BUFFER_M },
  furniture: { colors: FURNITURE_COLORS, hedges: HEDGE_SHAPES },
  life: LIFE_COLORS,
  fauna: { colors: FAUNA_COLORS, coats: FAUNA_COATS },
  sky: SKY_PALETTE,
});
