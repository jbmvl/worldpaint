/*
 * surfaceClassification — ce qu'une entité de tuile dit du sol.
 *
 * La lecture du vectoriel, et rien d'autre : quelle matière une classe
 * `landuse` ou `landcover` désigne, quelle eau compte, ce qu'un cours d'eau
 * pose au sol. Toutes les fonctions sont pures — aucune carte, aucun canevas,
 * aucune position — ce qui les rend lisibles et testables seules.
 *
 * C'est ici qu'on vient pour changer ce qu'une classe OSM signifie ; comment la
 * matière est ensuite peinte, encodée et relue est l'affaire de
 * `groundClassMap.js`.
 */

import { defaultTheme } from '../themes/default.js';

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

/**
 * Matière d'une surface d'eau, ou `null` si elle ne compte pas (les piscines
 * produisent des confettis bleus à cette échelle). Une eau intermittente — un
 * étang qui s'assèche, une lagune de Camargue — est une vasière où l'eau
 * affleure, pas un plan d'eau. Fonction pure.
 */
export function waterSurfaceFor(properties = {}) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.class === 'swimming_pool') return null;
  return properties.intermittent === 1 || properties.intermittent === true ? 'mud' : 'water';
}

/**
 * Cours d'eau qui ne portent **pas** de ripisylve.
 *
 * Un fossé et un drain sont des traits creusés — en bord de champ, en bord de
 * route — et non des cours d'eau bordés d'arbres. Leur donner l'ourlet de sept
 * mètres plantait une bande de bois de quinze mètres, arbres compris, le long
 * de la moindre chaussée assainie : c'est l'origine des bosquets qui suivaient
 * les routes. Ils gardent leur lit, qui est un fait de la carte.
 */
export const BARE_WATERWAY_CLASSES = new Set(['ditch', 'drain']);

/**
 * Ce qu'un cours d'eau linéaire pose au sol, ou `null` s'il ne pose rien : sa
 * demi-largeur, et s'il est bordé d'arbres. Un cours d'eau souterrain n'a pas
 * de surface ; un cours d'eau intermittent, la plupart du temps, non plus.
 * Fonction pure.
 *
 * @returns {{halfWidth:number, riparian:boolean}|null}
 */
export function waterwayStyleFor(properties = {}, waterways = defaultTheme.water.waterways) {
  if (properties.brunnel === 'tunnel') return null;
  if (properties.intermittent === 1 || properties.intermittent === true) return null;
  const width = waterways[properties.class];
  if (!width) return null;
  return { halfWidth: width / 2, riparian: !BARE_WATERWAY_CLASSES.has(properties.class) };
}

/**
 * Classes `landuse` minérales de bout en bout. Un campus, un hôpital, une
 * emprise militaire, un zoo n'en font pas partie : ils mêlent pelouses, bois et
 * bâti, et c'est `landcover` qui dit ce qui pousse dedans.
 */
export const MINERAL_LANDUSE = new Set([
  'industrial',
  'commercial',
  'retail',
  'railway',
  'quarry',
  'construction',
  'parking',
  'garages',
  'bus_station',
  'dam',
]);

/**
 * Matière d'une entité surfacique, ou `null` si elle n'en décrit aucune.
 *
 * Une classe rend directement la matière la plus précise qu'elle décrive :
 * `landcover.class = 'sand'` rend « sable », pas « sol nu » à préciser ensuite.
 *
 * `landuse=residential` ne prend pas `bare` : c'est un périmètre administratif
 * où le sol réel est surtout de l'herbe (pelouses, jardins), le minéral ne
 * couvrant que la chaussée et ses abords (composés par `streetLayer`). D'où
 * `settled`. Une zone d'activité (industrielle, commerciale, ferroviaire,
 * carrière), elle, reste `bare` : réellement minérale partout.
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
    if (klass === 'wetland') {
      // Les tuiles servies ne transmettent presque jamais la sous-classe : un
      // marais, une tourbière, une mangrove arrivent tous en `wetland`.
      if (subclass === 'saltmarsh') return 'saltmarsh';
      if (subclass === 'tidalflat') return 'mud';
      return 'wetland';
    }
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
    if (klass === 'ice' || subclass === 'glacier' || subclass === 'ice_shelf') return 'ice';
    return null;
  }

  if (sourceLayer === 'landuse') {
    if (klass === 'cemetery' || klass === 'pitch' || klass === 'playground' || klass === 'stadium') {
      return 'grass';
    }
    if (klass === 'residential' || klass === 'suburb' || klass === 'neighbourhood' || klass === 'quarter') {
      return 'settled';
    }
    if (MINERAL_LANDUSE.has(klass)) return 'bare';
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
