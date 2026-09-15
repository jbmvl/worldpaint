/*
 * showcase — isoler une valeur possible du vocabulaire des régions, plutôt
 * qu'un pays. Un outil de mise au point, comme `objectLabels.js` : le
 * sélecteur de région du panneau demande « à quoi ressemble l'Anjou », celui-
 * ci demande « à quoi ressemble `granite` », sans qu'il faille rouler jusqu'à
 * la région qui l'emploie.
 *
 * `core/regionInterpretation.js` porte déjà le vocabulaire fermé
 * (`VOCABULARIES`) et ce qu'un mot signifie pour le moteur ; ce module n'y
 * ajoute rien, il pioche dans le thème la couleur que chaque mot y prend
 * réellement — la même que celle que verrait qui roule jusqu'au bon pays.
 *
 * Un mot marqué `unsupported` (voir `regionInterpretation.js`) reste dans la
 * liste : c'est le repli qu'il montre, pas un décor inventé pour l'occasion —
 * taire le repli reviendrait à cacher ce qui manque au moteur.
 *
 * Fonctions pures, aucune dépendance à `THREE` : la construction des
 * maillages reste à qui affiche (voir `demo/showcase.js`).
 */

import { VOCABULARIES } from '../core/regionInterpretation.js';
import { VEGETAL_SURFACES } from '../terrain/groundClassMap.js';
import { defaultTheme } from '../themes/default.js';

/** Les catégories de l'afficheur, dans l'ordre où le panneau les propose. */
export const SHOWCASE_FIELDS = Object.freeze([
  { field: 'matrix', label: 'Terrain' },
  { field: 'stone', label: 'Couleur de pierre' },
  { field: 'building', label: 'Bâti (mur, toit)' },
  { field: 'farming', label: 'Cultures' },
  { field: 'trees', label: 'Arbres' },
]);

/**
 * Les champs qu'on ne montre pas en grille de vignettes mais en une seule
 * tuile pleine — le sol, et ce que la carte de classes y sème réellement
 * (touffes d'herbe, tiges de culture). Une couleur seule mentirait sur ce que
 * la matière ou la culture recouvre à l'œil.
 */
export const TILE_FIELDS = Object.freeze(new Set(['matrix', 'farming']));

/** Un mot dont personne ne s'occupe encore n'a pas de couleur. Gris neutre. */
const FALLBACK_ALBEDO = [0.3, 0.3, 0.3];

/**
 * Traduction du vocabulaire fermé, par champ. Les mots eux-mêmes
 * (`regions.js`) restent la clé stable — ce qu'on stocke, ce qu'on teste, ce
 * qu'on cite dans un dossier de région — cette table n'est qu'un habillage
 * pour le panneau, qui n'a pas à connaître l'anglais des classes OSM.
 */
const TRANSLATIONS = {
  matrix: {
    hedgerow_meadow: 'Bocage',
    openfield_cropland: 'Openfield (grande culture)',
    wet_grassland: 'Prairie humide',
    marsh: 'Marais',
    moor_heath: 'Lande',
    broadleaf_woodland: 'Bois de feuillus',
    conifer_forest: 'Forêt de conifères',
    boreal_taiga: 'Taïga boréale',
    terraced_slope: 'Coteau en terrasses',
    dry_scrub: 'Maquis sec',
    garrigue: 'Garrigue',
    dry_steppe: 'Steppe sèche',
    alpine_pasture: 'Alpage',
    bare_rock: 'Roche nue',
    dune_coast: 'Dune côtière',
    desert_stone: 'Désert de pierre',
    desert_sand: 'Désert de sable',
    savanna: 'Savane',
    tropical_forest: 'Forêt tropicale',
    rice_terrace: 'Rizière en terrasses',
  },
  stone: {
    limestone: 'Calcaire',
    chalk: 'Craie',
    granite: 'Granit',
    schist: 'Schiste',
    sandstone: 'Grès',
    basalt: 'Basalte',
    clay: 'Argile',
    alluvium: 'Alluvions',
    gypsum: 'Gypse',
    laterite: 'Latérite',
    loess: 'Lœss',
  },
  building: {
    light_stone: 'Pierre claire',
    dark_stone: 'Pierre sombre',
    granite: 'Granit',
    red_brick: 'Brique rouge',
    pale_brick: 'Brique pâle',
    half_timber: 'Colombage',
    whitewash: 'Chaux blanchie',
    rendered: 'Enduit',
    timber: 'Bois',
    red_timber: 'Bois rouge',
    adobe: 'Torchis (adobe)',
    slate_roof: "Toit d'ardoise",
    flat_tile_roof: 'Toit de tuile plate',
    curved_tile_roof: 'Toit de tuile canal',
    stone_slab_roof: 'Toit de lauze',
    flat_roof: 'Toit-terrasse',
    thatch_roof: 'Toit de chaume',
    shingle_roof: 'Toit de bardeaux',
    metal_roof: 'Toit de tôle',
  },
  farming: {
    cereal: 'Céréale',
    maize: 'Maïs',
    sunflower: 'Tournesol',
    rapeseed: 'Colza',
    vineyard: 'Vigne',
    orchard: 'Verger',
    olive: 'Oliveraie',
    almond: 'Amanderaie',
    lavender: 'Lavande',
    fallow: 'Jachère (labour)',
    rice: 'Riz',
    greenhouse: 'Serre',
    cotton: 'Coton',
    sugarcane: 'Canne à sucre',
    tea: 'Thé',
    coffee: 'Café',
    oil_palm: 'Palmier à huile',
  },
  trees: {
    oak: 'Chêne',
    beech: 'Hêtre',
    chestnut: 'Châtaignier',
    ash: 'Frêne',
    hornbeam: 'Charme',
    alder: 'Aulne',
    holm_oak: 'Chêne vert',
    cork_oak: 'Chêne-liège',
    birch: 'Bouleau',
    poplar: 'Peuplier',
    eucalyptus: 'Eucalyptus',
    scots_pine: 'Pin sylvestre',
    maritime_pine: 'Pin maritime',
    black_pine: 'Pin noir',
    stone_pine: 'Pin parasol',
    aleppo_pine: "Pin d'Alep",
    spruce: 'Épicéa',
    fir: 'Sapin',
    larch: 'Mélèze',
    olive: 'Olivier',
    juniper: 'Genévrier',
    acacia: 'Acacia',
    palm: 'Palmier',
  },
};

/** Le nom français d'un mot du vocabulaire, ou le mot lui-même à défaut. */
function translate(field, value) {
  return TRANSLATIONS[field]?.[value] || value;
}

/**
 * Ce que porterait une carte de classes réduite à une seule matière, partout —
 * la forme que lit `GroundCover` (`groundClassMap.sampleAt`). `wood` et
 * `farmland` sont leurs propres part ; les autres couvertures végétales
 * (`VEGETAL_SURFACES`) comptent comme de l'herbe, le reste comme du minéral nu.
 *
 * @param {string|null} surface Une matière de `theme.surfaces`.
 */
export function uniformGroundSample(surface) {
  if (VEGETAL_SURFACES.has(surface)) return { grass: 1, wood: 0, farmland: 0, bare: 0 };
  if (surface === 'wood') return { grass: 0, wood: 1, farmland: 0, bare: 0 };
  if (surface === 'farmland') return { grass: 0, wood: 0, farmland: 1, bare: 0 };
  return { grass: 0, wood: 0, farmland: 0, bare: 1 };
}

/**
 * Essence isolée à semer sur une matière boisée : le matériel réel — trois
 * mots renvoient à la même matière `wood`, mais on ne montre pas trois fois
 * la même silhouette. `null` : la matrice ne pose aucun couvert (voir plus
 * bas, elle décide du sol, jamais de la canopée — c'est le vectoriel qui la
 * pose, dans une vraie forêt).
 */
const WOOD_CANOPY = {
  broadleaf_woodland: 'treeBroad',
  conifer_forest: 'treeConifer',
  boreal_taiga: 'treeConifer',
  tropical_forest: 'treeBroad',
};

function matrixEntries(theme) {
  return Object.entries(VOCABULARIES.matrix).map(([value, def]) => ({
    value,
    label: translate('matrix', value),
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'tile',
    surface: def.surface,
    albedo: theme.surfaces[def.surface]?.albedo || FALLBACK_ALBEDO,
    // Litière au sol (`GroundCover`) et couvert (`WOOD_CANOPY`) sont deux
    // couches distinctes : la matrice ne dessine jamais d'arbre, un couvert de
    // secours en montre juste un pour qu'un mot boisé ne rende pas un sol nu.
    canopy: WOOD_CANOPY[value] || null,
  }));
}

function stoneEntries(theme) {
  const base = theme.terrain.rockColor || FALLBACK_ALBEDO;
  return Object.entries(VOCABULARIES.stone).map(([value, def]) => {
    const factor = theme.stones[value] || [1, 1, 1];
    return {
      value,
      label: translate('stone', value),
      unsupported: !!def.unsupported,
      note: def.unsupported || null,
      shape: 'block',
      albedo: base.map((c, i) => c * factor[i]),
    };
  });
}

/** Le premier village dont la palette cite ce mot, ou le premier du nuancier à défaut. */
function townFor(theme, word) {
  const matching = theme.towns.filter((palette) => !palette.materials || palette.materials.includes(word));
  return matching[0] || theme.towns[0];
}

function buildingEntries(theme) {
  return Object.entries(VOCABULARIES.building).map(([value, def]) => {
    const palette = townFor(theme, value);
    return {
      value,
      label: translate('building', value),
      unsupported: !!def.unsupported,
      note: def.unsupported || null,
      shape: 'house',
      // Le vocabulaire ne marque pas mur/toit à part : `_roof` suffit, c'est
      // la même convention que `regions.js` emploie déjà pour les nommer.
      part: value.endsWith('_roof') ? 'roof' : 'wall',
      wall: palette.walls[0],
      roof: palette.roofs[0],
      roofShape: palette.roofShapes[0],
    };
  });
}

/**
 * Trois cultures de `CROP_LOOK` n'ont pas de motif de tiges au sol : la vigne,
 * le verger et la lavande se plantent en **rangs**, posés par le mobilier
 * (`furniture/parcels.js`, `buildRows`) sur le contour d'une parcelle, pas
 * semés par `CropLayer` sur la carte de classes. Sans une parcelle réelle à
 * suivre, l'afficheur ne peut pas rejouer ce tracé — mais planter le même
 * repère isolé (échalas, arbre taillé, buisson) en rangs régulières montre
 * la même chose que `CropLayer` montre pour un blé ou un maïs : le motif, pas
 * la vraie géométrie de bord de parcelle.
 */
const ROW_CROPS = {
  vineyard: { kind: 'stakes', spacingX: 2.4, spacingZ: 3, areaM: 42 },
  orchard: { kind: 'trees', spacingX: 7, spacingZ: 6, areaM: 56 },
  lavender: { kind: 'bushes', spacingX: 1.4, spacingZ: 4, areaM: 30 },
};

function farmingEntries(theme) {
  return Object.entries(VOCABULARIES.farming).map(([value, def]) => ({
    value,
    label: translate('farming', value),
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'tile',
    // Nom du `CROP_LOOK` que porte ce mot — c'est lui que `groundClassMap.cropAt`
    // rendrait pour un champ de cette culture, et ce que `CropLayer` y sème.
    crop: def.crop,
    // Absent pour tout ce que `CropLayer` sait semer (blé, maïs...).
    rows: ROW_CROPS[def.crop] || null,
    albedo:
      theme.terrain.cropAlbedo?.[def.crop] ||
      theme.surfaces.farmland?.albedo ||
      FALLBACK_ALBEDO,
  }));
}

function treeEntries() {
  return Object.entries(VOCABULARIES.trees).map(([value, def]) => ({
    value,
    label: translate('trees', value),
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'tree',
    // Nom du bâtisseur isolé de `furnitureKit.js` (`treeBroad`, `treeRound`…) :
    // le même catalogue qui pose un arbre de crête ou d'alignement.
    alignment: def.alignment,
  }));
}

/**
 * Les valeurs possibles d'un champ de région, prêtes à afficher isolément.
 *
 * @param {'matrix'|'stone'|'building'|'farming'|'trees'} field
 * @param {Object} [theme] Direction artistique déjà résolue.
 * @returns {Array<Object>} Une entrée par mot du vocabulaire fermé.
 */
export function showcaseEntries(field, theme = defaultTheme) {
  switch (field) {
    case 'matrix':
      return matrixEntries(theme);
    case 'stone':
      return stoneEntries(theme);
    case 'building':
      return buildingEntries(theme);
    case 'farming':
      return farmingEntries(theme);
    case 'trees':
      return treeEntries();
    default:
      return [];
  }
}
