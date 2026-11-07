/*
 * windowFamilies — quelle famille de baies porte un bâtiment, et ses cotes.
 *
 * La couche `building` ne dit pas ce qu'est un bâtiment, seulement sa
 * hauteur : la famille se déduit de ce qui est su ailleurs — maison ou non
 * (`townStyle`), toit plat, plus long côté, et ce que la carte du sol met
 * sous lui (`pavement` en ville, `bare` en zone d'activité). Les cotes sont
 * celles du thème (`windowFamilies`), tirées par bâtiment depuis son centre :
 * entraxe, ±12 % sur la baie, teinte d'encadrement, volets.
 *
 * Fonctions pures.
 */
import { randomAt } from '../core/groundSeed.js';
import { srgb } from '../core/color.js';
import { defaultTheme } from '../themes/default.js';

/** Hauteurs qui départagent les familles, en mètres. */
export const TOWER_HEIGHT_M = 28;
export const OFFICE_HEIGHT_M = 15;
export const SLAB_HEIGHT_M = 12;
export const SLAB_LENGTH_M = 30;
export const CITY_BLOCK_HEIGHT_M = 9;
export const WORKSHOP_MAX_HEIGHT_M = 14;

/**
 * @param {Object} building
 * @param {boolean} building.house   Maison (`townStyle.isHouse`).
 * @param {number}  building.height  Hauteur, en mètres.
 * @param {boolean} building.flat    Toit-terrasse.
 * @param {number}  building.length  Plus long côté du rectangle orienté.
 * @param {string|null} building.surface Matière de la carte du sol sous lui.
 * @returns {'house'|'townhouse'|'cityBlock'|'ribbon'|'curtain'|'workshop'}
 */
export function windowFamilyFor({ house = false, height = 0, flat = false, length = 0, surface = null } = {}) {
  const mineral = surface === 'bare';
  if (mineral && !house && height <= WORKSHOP_MAX_HEIGHT_M) return 'workshop';
  if (height >= TOWER_HEIGHT_M || (mineral && height >= OFFICE_HEIGHT_M)) return 'curtain';
  if (flat && height >= SLAB_HEIGHT_M && length >= SLAB_LENGTH_M) return 'ribbon';
  if (surface === 'pavement' && height >= CITY_BLOCK_HEIGHT_M) return 'cityBlock';
  if (house) return 'house';
  return 'townhouse';
}

/**
 * Les cotes de baie d'un bâtiment : `windows` du thème, la famille par-dessus,
 * puis les tirages du bâtiment.
 *
 * @returns {Object} un `look` pour `appendOpenings` / `appendGlazing`, plus
 *          `family`, `frameTint` (linéaire) et `shutters` (vrai, faux, ou
 *          `null` pour laisser la maison en décider).
 */
export function windowLookFor(frame, x, z, family, theme = defaultTheme) {
  const spec = theme.windowFamilies?.[family] ?? {};
  const draw = (salt) => randomAt(frame, x, z, salt);
  const jitter = theme.windowSizeJitter ?? 0;
  const scale = (value, salt) => value * (1 + (draw(salt) * 2 - 1) * jitter);
  const look = { ...theme.windows, ...spec, family };
  if (Array.isArray(spec.spacingM)) look.spacingM = spec.spacingM[Math.floor(draw(901) * spec.spacingM.length)];
  if (!spec.kind) {
    look.widthM = scale(look.widthM, 903);
    look.heightM = scale(look.heightM, 907);
  }
  const tones = theme.windowFrameTones;
  look.frameTint = tones?.length ? srgb(tones[Math.floor(draw(911) * tones.length)]) : null;
  look.shutters = spec.shutterShare == null ? null : draw(913) < spec.shutterShare;
  return look;
}
