/*
 * townStyle — ce que le pays impose au bâti et aux ouvrages : couleur, forme,
 * matériau, à l'échelle de la région et non de l'objet.
 *
 * Les tuiles OpenMapTiles ne portent que `render_height`/`render_min_height`/
 * `hide_3d` sur le bâti : ni matériau, ni couleur de toit, ni forme n'y
 * survivent. La palette du bâti est donc celle que le dossier de région
 * nomme (`region.building`, clé de `theme.towns`) : une seule par pays, la
 * même pour toutes ses maisons, qui ne varient entre elles que de quelques
 * pour cent de clarté.
 *
 * Couleurs linéaires, prêtes pour les attributs de sommet, volontairement pastel.
 *
 * Rebord de voirie et famille d'ouvrage d'art, eux, se tirent sur une maille
 * de terrain (`TOWN_PATCH_M`), chacun avec sa graine.
 *
 * Le **dessus** du trottoir (`pavementTone`) est tiré du **pays**, pas de la
 * maille. Ce n'est plus la couleur d'un objet mais celle du sol — en ville le
 * revêtement va de la chaussée aux façades (`groundClassMap`, couverture
 * `pavement`) —, et le sol est peint par un shader qui n'a qu'un albédo par
 * couverture pour toute la bulle. Un tirage sur la maille s'y lirait comme une
 * frontière de 1400 mètres au milieu de la ville.
 */

import { srgb } from '../core/color.js';
import { cellRandomAt, positionSeed, randomAt } from '../core/groundSeed.js';
import { sharesFor, wallOfBuilding } from '../core/regionInterpretation.js';
import { pickShare } from './furniturePlacement.js';
import { defaultTheme } from '../themes/default.js';

/** Côté de la maille qui décide du rebord de voirie et de la famille d'ouvrage, en mètres. */
export const TOWN_PATCH_M = 1400;

/** Les palettes d'un thème, couleurs converties en linéaire (mémorisées par thème). */
const LINEAR_CACHE = new WeakMap();

function linearTowns(towns) {
  let out = LINEAR_CACHE.get(towns);
  if (!out) {
    out = {};
    for (const [name, palette] of Object.entries(towns)) {
      out[name] = {
        name,
        wall: srgb(palette.wall),
        roof: srgb(palette.roof),
        shutter: srgb(palette.shutter),
        roofShapes: palette.roofShapes,
        pitch: palette.pitch,
      };
    }
    LINEAR_CACHE.set(towns, out);
  }
  return out;
}

/**
 * Palette du bâti d'un pays : celle que son dossier nomme. Sans pays, ou pour
 * un thème qui ne porte pas cette clé, la première du nuancier — une palette
 * entière, jamais un mélange.
 *
 * @param {Object} [towns] Tranche `theme.towns`.
 * @param {Object|null} [region] Dossier de région.
 */
export function townPaletteFor(towns = defaultTheme.towns, region = null) {
  const palettes = linearTowns(towns);
  return palettes[region?.building] ?? palettes[Object.keys(palettes)[0]];
}

const LINEAR_WALLS = new WeakMap();

/**
 * Ton de mur, linéaire, d'un mot de `WALL_KINDS` : celui de la première
 * palette du thème qui le porte, ou `null` si aucune ne le porte.
 */
export function wallToneFor(towns = defaultTheme.towns, wall) {
  let out = LINEAR_WALLS.get(towns);
  if (!out) {
    out = {};
    for (const palette of Object.values(linearTowns(towns))) {
      const word = wallOfBuilding(palette.name);
      if (word && !out[word]) out[word] = palette.wall;
    }
    LINEAR_WALLS.set(towns, out);
  }
  return out[wall] ?? null;
}

/** Parts d'une liste de mots, mémorisées par liste (un dossier de région est figé). */
const SHARES_CACHE = new WeakMap();
function cachedShares(words) {
  let shares = SHARES_CACHE.get(words);
  if (!shares) SHARES_CACHE.set(words, (shares = sharesFor(words)));
  return shares;
}

/**
 * Revêtement de voirie de la maille qui contient un point (une commune refait
 * sa voirie d'un coup).
 *
 * @param {Object} frame Repère local.
 * @param {number} x
 * @param {number} z
 * @param {Object} [streets] Tranche `theme.streets`.
 * @returns {{name:string, kerb:number[], gutter:number[], joint:number[]}}
 */
export function streetSurfaceAt(frame, x, z, streets = defaultTheme.streets) {
  const surfaces = linearStreets(streets);
  const draw = cellRandomAt(frame, x, z, TOWN_PATCH_M, 191);
  const rebord = surfaces[Math.min(surfaces.length - 1, Math.floor(draw * surfaces.length))];
  return rebord;
}

/** Teinte linéaire du support revêtu, choisie par matrice de paysage. */
export function pavementTone(matrix, streets = defaultTheme.streets) {
  const table = linearPavement(streets);
  return table[matrix] || table.default;
}

const LINEAR_STREETS = new WeakMap();
const LINEAR_PAVEMENT = new WeakMap();

function linearStreets(streets) {
  let out = LINEAR_STREETS.get(streets);
  if (!out) {
    const gutter = srgb(streets.gutter);
    out = streets.surfaces.map((surface) => ({
      name: surface.name,
      kerb: srgb(surface.kerb),
      gutter,
      joint: srgb(streets.joint ?? streets.gutter),
    }));
    LINEAR_STREETS.set(streets, out);
  }
  return out;
}

function linearPavement(streets) {
  let out = LINEAR_PAVEMENT.get(streets);
  if (!out) {
    out = {};
    for (const [matrix, hex] of Object.entries(streets.pavement || {})) out[matrix] = srgb(hex);
    // Un thème sans table retombe sur un gris de béton plutôt que sur `undefined`.
    if (!out.default) out.default = srgb('#9b968c');
    LINEAR_PAVEMENT.set(streets, out);
  }
  return out;
}

/**
 * Habillage d'un bâtiment : les tons de la palette du pays, la forme du toit
 * et la nature de maison. Le mur prend une des nuances du thème
 * (`facadeTints`), toutes tirées de la couleur du pays — une rue se lit
 * alors comme une suite de façades, sans que le village devienne une
 * collection —, puis quelques pour cent de vieillissement.
 *
 * `x`, `z` sont les coordonnées locales du bâtiment.
 *
 * @param {Object} frame Repère local.
 * @param {number} x
 * @param {number} z
 * @param {Object} [context]
 * @param {number} [context.area]   Emprise au sol, en m².
 * @param {number} [context.height] Hauteur, en mètres.
 * @param {Object|null} [region] Dossier de région.
 * @param {Array<number[]>|null} [tints] Nuances de façade, facteurs RVB linéaires.
 * @returns {{wall:number[], roof:number[], shutter:number[], shape:string,
 *           pitch:number|undefined, house:boolean, shutters:boolean,
 *           palette:string}}
 */
export function buildingStyleAt(
  frame,
  x,
  z,
  { area = 100, height = 7 } = {},
  towns = defaultTheme.towns,
  region = null,
  tints = defaultTheme.facadeTints
) {
  const palette = townPaletteFor(towns, region);
  const seed = positionSeed(frame, x, z, 151);

  // Les murs du pays, quand son dossier en liste plusieurs : le premier est
  // celui de la palette, les autres prennent le ton de leur propre matériau.
  const wallWord = region?.walls?.length > 1 ? pickShare(cachedShares(region.walls), randomAt(frame, x, z, 179)) : null;
  const base = (wallWord && wallWord !== wallOfBuilding(palette.name) && wallToneFor(towns, wallWord)) || palette.wall;

  // Modulation tirée du lieu : ±6 % pour le crépi, ±3 % pour le volet peint (vieillit moins vite).
  const shade = 0.94 + randomAt(frame, x, z, 157) * 0.12;
  const tint = tints?.length ? tints[Math.floor(randomAt(frame, x, z, 159) * tints.length)] : null;
  const wall = base.map((c, i) => Math.min(1, c * shade * (tint ? tint[i] : 1)));
  const roof = palette.roof.map((c) => Math.min(1, c * (0.95 + randomAt(frame, x, z, 163) * 0.1)));
  const shutter = palette.shutter.map((c) => Math.min(1, c * (0.97 + randomAt(frame, x, z, 167) * 0.06)));

  const house = isHouse({ area, height });
  return {
    wall,
    roof,
    shutter,
    shape: roofShapeFor(palette, { area, height, seed, variant: randomAt(frame, x, z, 181) }, region?.roofs),
    // Pente propre au pays, ou rien — auquel cas l'appelant garde celle du
    // thème. La silhouette d'un toit se lit de plus loin que sa couleur.
    pitch: palette.pitch,
    house,
    shutters: house && randomAt(frame, x, z, 173) < SHUTTER_SHARE,
    palette: palette.name,
  };
}

/**
 * Pente des toits : celle de la palette, ou du thème si elle n'en impose pas,
 * corrigée par le mot de pays (`region.roofPitch`). Rend la tranche
 * `theme.roofs` elle-même quand rien ne change : une allocation par bâtiment
 * serait payée sur toute une ville.
 *
 * @param {number|undefined} pitch Pente de la palette (`buildingStyleAt`).
 * @param {Object|null} region
 * @param {Object} roofs Tranche `theme.roofs`.
 */
export function roofsFor(pitch, region, roofs = defaultTheme.roofs) {
  const factor = roofs.pitchFactors?.[region?.roofPitch] ?? 1;
  const value = (pitch ?? roofs.pitch) * factor;
  return value === roofs.pitch ? roofs : { ...roofs, pitch: value };
}

/**
 * Hauteur d'un bâtiment de ville dont la donnée ne dit rien, d'après les
 * niveaux du pays (`region.townStoreys`, `[min, max]`) : un nombre de niveaux
 * tiré du lieu, ou `null` quand le pays n'en déclare pas.
 *
 * @param {Object} frame Repère local.
 * @param {number} x
 * @param {number} z
 * @param {Object|null} region
 * @param {number} levelM Hauteur d'un niveau, en mètres.
 */
export function townHeightFor(frame, x, z, region, levelM) {
  const storeys = region?.townStoreys;
  if (!storeys) return null;
  const [min, max] = storeys;
  return (min + Math.floor(randomAt(frame, x, z, 197) * (max - min + 1))) * levelM;
}

/** Part des maisons qui portent des volets. */
export const SHUTTER_SHARE = 0.76;

/**
 * Maison, par opposition à immeuble ou bâtiment d'activité (d'après hauteur
 * et emprise). Sert aux volets (`buildingStyleAt`) et au jardin (`gardenLayer`).
 */
export function isHouse({ area = 100, height = 7 } = {}) {
  return height <= HOUSE_MAX_HEIGHT_M && area <= HOUSE_MAX_AREA_M2;
}

/** Au-delà, c'est un immeuble : trois niveaux et des combles. */
export const HOUSE_MAX_HEIGHT_M = 11.5;
/** Au-delà, c'est une exploitation ou un équipement, pas une maison. */
export const HOUSE_MAX_AREA_M2 = 320;

/**
 * Forme du toit, d'après la palette du pays et la taille du bâtiment (la
 * taille tranche avant le tirage). Un pays qui classe ses toits (`roofs`, du
 * plus répandu au moins répandu) tire dans ce classement, à la part du rang
 * (`variant` dans [0, 1)) ; sinon la palette tranche (`seed`).
 */
export function roofShapeFor(palette, { area = 100, height = 7, seed = 0, variant = 0 } = {}, roofs = null) {
  if (height > 16 || area > 900) return 'flat';

  const shape = roofs?.length
    ? pickShare(cachedShares(roofs), variant)
    : palette.roofShapes[seed % palette.roofShapes.length];
  // Pyramide sur une emprise très allongée = tente de cirque : on préfère la faîtière.
  if (shape === 'pyramid' && area > 240) return 'hip';
  return shape;
}

const LINEAR_WORKS = new WeakMap();

/** Une famille d'ouvrage, ses couleurs converties en linéaire (mémorisée par thème). */
function linearWorks(works) {
  let out = LINEAR_WORKS.get(works);
  if (!out) {
    out = works.map((style) => ({
      ...style,
      deck: { ...style.deck, color: srgb(style.deck.color), edge: srgb(style.deck.edge) },
      pier: {
        ...style.pier,
        colorFoot: srgb(style.pier.colorFoot),
        colorTop: srgb(style.pier.colorTop),
      },
      abutment: {
        ...style.abutment,
        colorFoot: srgb(style.abutment.colorFoot),
        colorTop: srgb(style.abutment.colorTop),
      },
      parapet: {
        ...style.parapet,
        color: srgb(style.parapet.color),
        colorTop: srgb(style.parapet.colorTop),
      },
      portal: { ...style.portal, face: srgb(style.portal.face), arch: srgb(style.portal.arch) },
    }));
    LINEAR_WORKS.set(works, out);
  }
  return out;
}

/**
 * Famille d'ouvrage d'art du pays qui contient un point : de quoi sont faits
 * ses ponts et ses têtes de tunnel.
 *
 * Ancrée au lieu, sur la maille de terrain : les deux culées d'un même pont
 * tirent la même famille, et une reconstruction ne rebâtit pas l'ouvrage dans
 * un autre matériau. Graine distincte de celle de la voirie.
 *
 * @param {Object} frame Repère local.
 * @param {number} x
 * @param {number} z
 * @param {Array<Object>} [works] Tranche `theme.works`.
 * @returns {Object} La famille, couleurs en linéaire.
 */
export function worksStyleAt(frame, x, z, works = defaultTheme.works) {
  const styles = linearWorks(works);
  const draw = cellRandomAt(frame, x, z, TOWN_PATCH_M, 233);
  return styles[Math.min(styles.length - 1, Math.floor(draw * styles.length))];
}
