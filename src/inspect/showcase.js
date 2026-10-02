/*
 * showcase — les mots du vocabulaire fermé des régions, prêts pour le
 * sélecteur de l'afficheur. L'afficheur ne dessine rien lui-même : il impose
 * un mot à la région en vigueur (`world.setRegionWord`) et c'est le vrai
 * monde qui se reconstruit. Ce module n'en fournit que la liste et les
 * intitulés français.
 *
 * Un mot marqué `unsupported` (voir `core/regionInterpretation.js`) reste dans
 * la liste : c'est le repli qu'il montre, et le taire cacherait ce qui manque
 * au moteur.
 */

import { VOCABULARIES } from '../core/regionInterpretation.js';

/** Les champs de l'afficheur, dans l'ordre où le panneau les propose. */
export const SHOWCASE_FIELDS = Object.freeze([
  { field: 'matrix', label: 'Terrain' },
  { field: 'stone', label: 'Couleur de pierre' },
  { field: 'building', label: 'Bâti' },
  { field: 'farming', label: 'Cultures' },
  { field: 'trees', label: 'Arbres' },
]);

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
    light_stone_flat_tile: 'Pierre claire, tuile plate',
    light_stone_curved_tile: 'Pierre claire, tuile canal',
    light_stone_slate: 'Pierre claire, ardoise',
    light_stone_stone_slab: 'Pierre claire, lauze',
    light_stone_thatch: 'Pierre claire, chaume',
    light_stone_terrace: 'Pierre claire, toit-terrasse',
    dark_stone_flat_tile: 'Pierre sombre, tuile plate',
    dark_stone_curved_tile: 'Pierre sombre, tuile canal',
    dark_stone_slate: 'Pierre sombre, ardoise',
    dark_stone_stone_slab: 'Pierre sombre, lauze',
    granite_flat_tile: 'Granit, tuile plate',
    granite_curved_tile: 'Granit, tuile canal',
    granite_slate: 'Granit, ardoise',
    granite_stone_slab: 'Granit, lauze',
    red_brick_flat_tile: 'Brique rouge, tuile plate',
    red_brick_slate: 'Brique rouge, ardoise',
    red_brick_thatch: 'Brique rouge, chaume',
    pale_brick_flat_tile: 'Brique pâle, tuile plate',
    pale_brick_curved_tile: 'Brique pâle, tuile canal',
    half_timber_flat_tile: 'Colombage, tuile plate',
    half_timber_curved_tile: 'Colombage, tuile canal',
    whitewash_curved_tile: 'Chaux blanchie, tuile canal',
    whitewash_slate: 'Chaux blanchie, ardoise',
    whitewash_terrace: 'Chaux blanchie, toit-terrasse',
    rendered_curved_tile: 'Enduit, tuile canal',
    rendered_thatch: 'Enduit, chaume',
    timber_stone_slab: 'Bois, lauze',
    adobe_curved_tile: 'Torchis (adobe), tuile canal',
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

/**
 * Les valeurs possibles d'un champ de région, avec leur intitulé.
 *
 * @param {'matrix'|'stone'|'building'|'farming'|'trees'} field
 * @returns {Array<{value: string, label: string, unsupported: boolean, note: string|null}>}
 */
export function showcaseEntries(field) {
  return Object.entries(VOCABULARIES[field] ?? {}).map(([value, def]) => ({
    value,
    label: TRANSLATIONS[field]?.[value] || value,
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
  }));
}
