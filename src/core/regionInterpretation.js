/*
 * regionInterpretation — ce qu'un mot de région signifie pour le moteur.
 *
 * Le pendant de `terrain/surfaceClassification.js`, pour l'autre source du
 * décor : celui-là dit ce qu'une classe OSM signifie, celui-ci ce qu'un mot de
 * `regions.js` signifie. C'est ici, et nulle part ailleurs, qu'on vient
 * changer la traduction.
 *
 * ## Pourquoi une traduction plutôt que des mots du moteur
 *
 * Le moteur parle OSM : `SURFACE_KINDS` est la liste des sous-classes
 * `landcover` d'OpenMapTiles, recopiée. Elle porte donc les distinctions d'une
 * taxonomie de cartographes — l'éboulis et la dalle séparés, la lande et le
 * maquis séparés, la lavande au même rang que le blé — et elle en manque
 * d'autres. Une description de région qui emploierait ces mots serait ligotée à
 * ce découpage : la moindre fusion de matières demanderait de réécrire le
 * fichier de régions.
 *
 * Le vocabulaire régional est donc **libre**. Il a le droit d'être plus
 * grossier que le moteur (un seul mot pour la dalle et l'éboulis) et plus fin
 * (`rice_terrace` là où il n'y a que `farmland`). La traduction absorbe
 * l'écart, dans les deux sens.
 *
 * ## Les mots que le moteur ne sait pas rendre
 *
 * Un mot porte `unsupported` quand le décor n'a rien de juste à mettre à sa
 * place. Il reste dans le vocabulaire : décrire l'Andalousie sans serre ou la
 * Camargue sans rizière serait décrire autre chose. Il rend un repli
 * volontairement **quelconque** — un champ labouré, pas une presque-rizière :
 * un repli plausible empêcherait à jamais de savoir si une scène est fausse par
 * la donnée ou par le moteur. La liste de ces mots, et le nombre de régions qui
 * les emploient, sort du test : c'est la feuille de route du contenu à faire.
 *
 * ## Deux vocabulaires sans consommateur
 *
 * `STONE_KINDS` et `BUILDING_KINDS` ne traduisent encore vers rien : la couleur
 * de la roche est une constante unique du thème et les palettes de bourg se
 * choisissent par le climat. Ils sont fermés et validés dès maintenant pour que
 * le fichier de régions se remplisse une seule fois ; ce qu'ils valent à l'œil
 * est une affaire de thème, et se branchera là.
 *
 * Toutes les fonctions sont pures.
 */

/**
 * Traitement des limites de parcelle qu'une matrice appelle.
 *
 * Un style, pas un mix : quelle clôture le pays emploie, pas dans quelles
 * proportions. Les parts sont une affaire de thème.
 */
export const BOUNDARY_STYLES = Object.freeze([
  'bocage',
  'openfield',
  'drystone',
  'wood_fence',
  'wire',
  'none',
]);

/**
 * La matrice : le paysage là où la carte se tait.
 *
 * C'est le champ qui porte le plus. Une scène de rase campagne n'est presque
 * que ça — le vectoriel décrit les bois, les champs et l'eau, et laisse le
 * reste sans réponse, d'autant plus qu'on s'éloigne des pays bien relevés.
 *
 * `surface` est une matière de `SURFACE_KINDS`, `boundary` un style ci-dessus.
 */
export const MATRIX_KINDS = Object.freeze({
  hedgerow_meadow: { surface: 'grass', boundary: 'bocage' },
  openfield_cropland: { surface: 'grass', boundary: 'openfield' },
  wet_grassland: { surface: 'grass', boundary: 'wire' },
  marsh: { surface: 'wetland', boundary: 'none' },
  moor_heath: { surface: 'heath', boundary: 'drystone' },
  broadleaf_woodland: { surface: 'wood', boundary: 'bocage' },
  conifer_forest: { surface: 'wood', boundary: 'wood_fence' },
  boreal_taiga: { surface: 'wood', boundary: 'wood_fence' },
  terraced_slope: { surface: 'scrub', boundary: 'drystone' },
  dry_scrub: { surface: 'scrub', boundary: 'drystone' },
  garrigue: { surface: 'scrub', boundary: 'drystone' },
  dry_steppe: { surface: 'bare', boundary: 'openfield' },
  alpine_pasture: { surface: 'alpine', boundary: 'wood_fence' },
  bare_rock: { surface: 'rock', boundary: 'none' },
  dune_coast: { surface: 'sand', boundary: 'none' },
  desert_stone: { surface: 'bare', boundary: 'none' },
  desert_sand: { surface: 'sand', boundary: 'none' },
  savanna: {
    surface: 'grass',
    boundary: 'none',
    unsupported: 'pas d’arbre isolé sur herbe sèche : rend une prairie rase',
  },
  tropical_forest: {
    surface: 'wood',
    boundary: 'none',
    unsupported: 'aucun peuplement à canopée fermée : rend un bois tempéré',
  },
  rice_terrace: {
    surface: 'farmland',
    boundary: 'drystone',
    unsupported: 'ni lame d’eau ni terrasse inondée : rend un champ',
  },
});

/**
 * La géologie dominante — la couleur de la pierre, quand elle sera lue : la
 * roche des fortes pentes, l'éboulis, le muret, le moellon.
 *
 * Une seule par région, et c'est assez : on ne cherche pas une carte
 * géologique, on cherche de quoi le pays est fait quand il affleure.
 */
export const STONE_KINDS = Object.freeze({
  limestone: {},
  chalk: {},
  granite: {},
  schist: {},
  sandstone: {},
  basalt: {},
  clay: {},
  alluvium: {},
  gypsum: {},
  laterite: { unsupported: 'aucune teinte de roche latéritique' },
  loess: { unsupported: 'aucune teinte de limon éolien' },
});

/**
 * Le bâti : un mur, puis un toit.
 *
 * Deux mots au plus, dans cet ordre. Le toit est le plus visible des deux à la
 * distance où le décor se regarde — sa pente se lit bien avant sa couleur — et
 * c'est pour ça qu'il a droit à un mot pour lui seul plutôt qu'à une nuance du
 * mur.
 */
export const BUILDING_KINDS = Object.freeze({
  // Murs.
  light_stone: {},
  dark_stone: {},
  granite: {},
  red_brick: {},
  pale_brick: {},
  half_timber: {},
  whitewash: {},
  rendered: {},
  timber: {},
  red_timber: {},
  adobe: { unsupported: 'aucune palette de terre crue' },
  // Toits.
  slate_roof: {},
  flat_tile_roof: {},
  curved_tile_roof: {},
  stone_slab_roof: {},
  flat_roof: {},
  thatch_roof: { unsupported: 'aucune couverture de chaume' },
  shingle_roof: { unsupported: 'aucune couverture de bardeau' },
  metal_roof: { unsupported: 'aucune couverture de tôle' },
});

/**
 * L'assolement dominant, du plus répandu au moins répandu.
 *
 * L'ordre **est** l'information : la part de chaque culture se déduit du rang,
 * pas d'un poids écrit à la main. Le vectoriel ne dit jamais ce qui pousse dans
 * un champ (sauf vigne, verger, pépinière) ; cette liste décide du reste, et
 * seulement du reste — une vigne cartographiée reste une vigne.
 *
 * `crop` est une culture de `CROP_KINDS`.
 */
export const FARMING_KINDS = Object.freeze({
  cereal: { crop: 'wheat' },
  maize: { crop: 'maize' },
  sunflower: { crop: 'sunflower' },
  rapeseed: { crop: 'rapeseed' },
  vineyard: { crop: 'vineyard' },
  orchard: { crop: 'orchard' },
  olive: { crop: 'orchard' },
  almond: { crop: 'orchard' },
  lavender: { crop: 'lavender' },
  fallow: { crop: 'plough' },
  rice: { crop: 'plough', unsupported: 'ni lame d’eau ni casier : rend un labour' },
  greenhouse: { crop: 'plough', unsupported: 'aucune serre : rend un labour' },
  cotton: { crop: 'plough', unsupported: 'aucun motif de coton : rend un labour' },
  sugarcane: { crop: 'maize', unsupported: 'rend un maïs, qui est trop bas' },
  tea: { crop: 'vineyard', unsupported: 'rend des rangs de vigne' },
  coffee: { crop: 'orchard', unsupported: 'rend un verger' },
  oil_palm: { crop: 'orchard', unsupported: 'aucune silhouette de palmier' },
});

/**
 * Les essences dominantes.
 *
 * Quatre silhouettes seulement sont dessinées (`broadleaf`, `column`,
 * `conifer`, `bushy`) : plusieurs espèces retombent sur la même, et c'est
 * assumé. Ce qui les sépare à l'écran est la hauteur et la teinte du
 * peuplement, qui sont du thème. Nommer l'espèce plutôt que la silhouette est
 * ce qui permet d'affiner plus tard sans toucher au fichier de régions.
 */
export const TREE_KINDS = Object.freeze({
  oak: { essence: 'broadleaf' },
  beech: { essence: 'broadleaf' },
  chestnut: { essence: 'broadleaf' },
  ash: { essence: 'broadleaf' },
  hornbeam: { essence: 'broadleaf' },
  alder: { essence: 'broadleaf' },
  holm_oak: { essence: 'broadleaf' },
  cork_oak: { essence: 'broadleaf' },
  birch: { essence: 'column' },
  poplar: { essence: 'column' },
  eucalyptus: { essence: 'column' },
  scots_pine: { essence: 'conifer' },
  maritime_pine: { essence: 'conifer' },
  aleppo_pine: { essence: 'conifer' },
  black_pine: { essence: 'conifer' },
  stone_pine: { essence: 'conifer' },
  spruce: { essence: 'conifer' },
  fir: { essence: 'conifer' },
  larch: { essence: 'conifer' },
  olive: { essence: 'bushy' },
  juniper: { essence: 'bushy' },
  acacia: { essence: 'bushy', unsupported: 'aucune silhouette de parasol épineux' },
  palm: { essence: 'column', unsupported: 'aucune silhouette de palmier' },
});

/** Les cinq vocabulaires, par champ du dossier de région. */
export const VOCABULARIES = Object.freeze({
  matrix: MATRIX_KINDS,
  stone: STONE_KINDS,
  building: BUILDING_KINDS,
  farming: FARMING_KINDS,
  trees: TREE_KINDS,
});

/** Champs qui portent une liste de mots plutôt qu'un seul. */
export const LIST_FIELDS = Object.freeze(['building', 'farming', 'trees']);

/**
 * Matière de `SURFACE_KINDS` que la matrice pose là où la carte se tait, ou
 * `null` si le mot est inconnu.
 */
export function surfaceForMatrix(matrix) {
  return MATRIX_KINDS[matrix]?.surface ?? null;
}

/** Style de limite de parcelle appelé par la matrice, ou `null`. */
export function boundaryForMatrix(matrix) {
  return MATRIX_KINDS[matrix]?.boundary ?? null;
}

/** Culture de `CROP_KINDS` qu'un mot d'assolement désigne, ou `null`. */
export function cropForFarming(word) {
  return FARMING_KINDS[word]?.crop ?? null;
}

/** Silhouette qu'une essence emprunte, ou `null`. */
export function essenceForTree(word) {
  return TREE_KINDS[word]?.essence ?? null;
}

/** Tous les mots d'un dossier de région, avec leur champ. Fonction pure. */
export function wordsOf(region) {
  const out = [];
  for (const field of Object.keys(VOCABULARIES)) {
    const value = region?.[field];
    if (typeof value === 'string') out.push({ field, word: value });
    else if (Array.isArray(value)) for (const word of value) out.push({ field, word });
  }
  return out;
}

/** Mots d'un dossier absents de leur vocabulaire — une erreur de donnée. */
export function unknownWords(region) {
  return wordsOf(region).filter(({ field, word }) => !(word in VOCABULARIES[field]));
}

/**
 * Mots d'un dossier que le moteur ne sait pas rendre, avec la raison. Ce n'est
 * pas une erreur : c'est ce qui reste à construire.
 */
export function unsupportedWords(region) {
  return wordsOf(region)
    .map(({ field, word }) => ({ field, word, note: VOCABULARIES[field][word]?.unsupported }))
    .filter((entry) => entry.note);
}
