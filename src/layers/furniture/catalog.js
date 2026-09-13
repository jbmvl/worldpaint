/*
 * catalog — ce que le mobilier sait poser, et combien.
 *
 * Les formes ponctuelles, les matières linéaires, les plafonds et les quelques
 * portées que toutes les familles de mobilier partagent. Une famille qui n'a
 * de sens que pour elle-même garde sa constante chez elle ; ce qui est ici est
 * lu par au moins deux d'entre elles, ou par le coordinateur.
 *
 * Ajouter une forme au catalogue de `furnitureKit` ne suffit pas à la poser :
 * tant qu'elle n'est pas dans `POINT_ITEMS` (ou `LINEAR_KINDS` pour une
 * matière balayée), rien ne l'instancie.
 */

/** Portée du mobilier autour de l'observateur, en mètres. */
export const FURNITURE_RADIUS_M = 700;

/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const FURNITURE_REBUILD_M = 250;
/** Pas de ré-échantillonnage des contours de parcelles, en mètres. */
export const BOUNDARY_SAMPLE_M = 6;
/**
 * Pas du muret de pierre sèche, plus fin que le contour qui le porte : c'est
 * lui qui espace les arêtes de son grain (`facetJitter`).
 */
export const DRY_STONE_WALL_SAMPLE_M = 1.5;
/** Longueur minimale d'un contour retenu, en mètres. */
export const BOUNDARY_MIN_LENGTH_M = 30;

/** Décollement du mobilier au-dessus du sol : il s'ancre, il ne flotte pas. */
export const FURNITURE_SINK_M = 0.08;

/**
 * Toute la signalisation du catalogue, dans un seul endroit.
 *
 * Deux règles y puisent : `signKindFor` pour ce qu'une portion de route porte,
 * et `buildJunctionSigns` pour ce qu'une bouche de carrefour porte. Toutes
 * deux ne rendent que des clés de cette liste : ajouter un panneau au
 * catalogue et l'oublier ici le rendrait silencieusement invisible.
 *
 * `signStop` et `signRoundabout` ne sont posés par aucune des deux : la donnée
 * ne dit ni où l'arrêt est obligatoire, ni où il y a un anneau, et les tirer
 * au sort — ce que faisait `signKindFor` — revenait à poser un panneau parce
 * qu'une intersection existe. Les modèles restent au catalogue ; leur sort est
 * à décider, pas à trancher au passage.
 */
export const SIGN_ITEMS = [
  'signWarning',
  'signStop',
  'signYield',
  'signPriority',
  'signSpeedLimit',
  'signNoOvertaking',
  'signRoundabout',
  'signCrossing',
  'signChevron',
  'signDirection',
  'signPlaceName',
];

/**
 * Panneau d'entrée d'agglomération : à quelle distance il va chercher son
 * nom (`settlement.nearestNamedPlace`), et à quelle distance il exige une
 * vraie grappe de bâtiments (`FabricIndex.countWithin`) avant de se
 * planter — les deux conditions sont nécessaires, sinon ce panneau se posait
 * à l'entrée de n'importe quel `landuse=residential` (un périmètre
 * administratif, pas une agglomération).
 */

/**
 * Plafonds. Ils ne sont pas décoratifs : une commune de bocage dense peut
 * offrir plusieurs centaines de contours dans la bulle, et rien n'oblige à les
 * dessiner tous pour que le paysage se lise.
 */

export const FURNITURE_LIMITS = {
  boundaries: 180,
  // Un bocage dense peut offrir plusieurs centaines de prés et de champs dans
  // les 700 m de portée — voir `FURNITURE_RADIUS_M` — et ce plafond, atteint
  // en cours de tuile plutôt que par distance, en écartait certains au hasard
  // de l'ordre d'arrivée plutôt que par éloignement réel.
  scatter: 640,
  points: 1100,
  farmBuildings: 32,
  landmarks: 12,
  // Un feu tricolore ne se voit qu'aux carrefours d'une agglomération, et une
  // agglomération traversée n'en compte pas vingt-quatre. Le plafond précédent
  // ne plafonnait rien : c'est la règle de détection qui en posait trop.
  trafficLights: 8,
  rocks: 200,
  vineRows: 90,
  /**
   * Bêtes posées sur toute la bulle. Plus haut que ce que `faunaLayer` anime
   * (`FAUNA_ANIMATED_MAX`), et c'est voulu : la couche garde les plus proches
   * de l'observateur, et elle ne peut le faire que si on lui en propose plus
   * qu'elle n'en retient. Chaque bête coûte ici son circuit — quelques
   * sondages de relief —, pas une matrice par image.
   */
  fauna: 420,
  // Chats et chiens de maison, comptés à part du reste de la faune : une
  // petite ville de plusieurs centaines de maisons ne doit pas à elle seule
  // remplir le budget `fauna` et évincer le bétail des prés voisins.
  pets: 60,
  // Antennes de sommet : posées sur les vrais sommets relevés dans les
  // tuiles (`mountain_peak`), donc bornées par leur rareté propre — la bulle
  // n'en contient jamais des dizaines.
  peakLandmarks: 6,
  // Phares : plus rares encore. Un littoral n'en porte pas un tous les
  // kilomètres, et la bulle ne montre jamais plus qu'un tronçon de côte.
  coastLandmarks: 3,
  // Arbres de crête : de vrais repères, pas un boisement — une poignée dans
  // toute la bulle, jamais un semis.
  ridgeTrees: 40,
  // Repères urbains posés sur une emprise landuse (cimetière, zone
  // industrielle, stade, foire) : un par polygone, donc rarement nombreux.
  urbanLandmarks: 14,
  // Arbustes de haie. Ils ne coûtent ni matière ni appel de dessin de plus —
  // ils s'écrivent dans le maillage de la haie —, mais un bocage dense mis
  // bout à bout fait des kilomètres de limite, et il n'y a aucune raison d'en
  // détailler plus que ce que la caméra a sous les yeux.
  hedgeClumps: 3600,
};

/** Formes ponctuelles du catalogue, dans l'ordre où on les instancie. */
export const POINT_ITEMS = [
  'streetLamp',
  'utilityPole',
  'pylon',
  'radioMast',
  'windTurbine',
  'lighthouse',
  'guardrailPost',
  'fencePostWood',
  'fencePostConcrete',
  'trafficLight',
  'milestone',
  'busShelter',
  'fountain',
  'lavoir',
  'hayBaleRound',
  'hayBaleSquare',
  'woodPile',
  'barn',
  'silo',
  'hangar',
  'greenhouse',
  'windmill',
  'watermill',
  'waterTower',
  'laundryLine',
  // Les animaux ne sont plus ici : ils bougent, donc ils sont publiés pour
  // `faunaLayer` (voir `this.fauna`) au lieu d'être instanciés comme du
  // mobilier immobile.
  'bush',
  'treeBroad',
  'treeConifer',
  'treeRound',
  'treeColumnar',
  'treeOval',
  'vineStock',
  'rockSmall',
  'rockBoulder',
  'rockOutcrop',
  'monument',
  'castle',
  'tower',
  'cemeteryCross',
  'cemeteryGate',
  'cemeteryTomb',
  'cemeteryTombFlat',
  'cemeteryTap',
  'factoryChimney',
  'ferrisWheel',
  'stadium',
  ...SIGN_ITEMS,
];

/** Matières linéaires : une géométrie fusionnée par matière. */
export const LINEAR_KINDS = [
  'hedge',
  'lowHedge',
  'vineRow',
  'lavenderRow',
  'dryStoneWall',
  'rockCut',
  'fillWall',
  'guardrailBeam',
  'woodRail',
  'woodRailTop',
  'embankment',
  'wire',
];

/**
 * Matières facettées (`facetJitter`) : leur ombrage doit rester plat, sinon
 * les arêtes voulues sont moyennées et disparaissent à l'écran. Tout le reste
 * de `LINEAR_KINDS` garde l'ombrage lissé (glissière, câble).
 */
export const FLAT_SHADED_LINEAR_KINDS = new Set([
  'hedge',
  'lowHedge',
  'vineRow',
  'lavenderRow',
  'dryStoneWall',
  'rockCut',
  'fillWall',
  'embankment',
]);
