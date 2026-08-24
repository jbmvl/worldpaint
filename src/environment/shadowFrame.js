/*
 * shadowFrame — position du soleil et cadrage de la carte d'ombres.
 * ------------------------------------------------------------------
 * Séparé de `sceneEnvironment.js` pour deux raisons : c'est de la géométrie
 * pure, donc testable sans navigateur, et `sceneEnvironment` dépend des
 * palettes de la carte 2D, qui traînent tout Vue derrière elles.
 */

import SunCalc from 'suncalc';

/**
 * Demi-côté de la boîte d'ombres, en mètres. Une lumière directionnelle éclaire
 * un monde entier ; sa carte d'ombres, elle, n'a que quelques mégapixels. Toute
 * la finesse vient donc du resserrement de la boîte autour de ce qu'on regarde.
 */
export const SHADOW_RADIUS_M = 110;
/**
 * Avance de la boîte devant l'observateur. La caméra regarde vers l'avant : centrer
 * la boîte sur l'observateur gâcherait la moitié de la carte derrière lui.
 */
export const SHADOW_LEAD_M = 45;
/** Distance de la lumière à sa cible : au-delà, la boîte de profondeur clippe. */
export const SHADOW_DISTANCE_M = 800;
/**
 * Sous cette hauteur de soleil, plus d'ombres. Au ras de l'horizon elles
 * s'étirent au-delà de la boîte et se coupent net, ce qui se voit bien plus que
 * leur absence.
 */
export const SHADOW_MIN_SUN_Y = 0.08;

/**
 * Direction du soleil dans le repère de la scène (x est, y haut, z sud).
 *
 * SunCalc donne un azimut compté depuis le sud, positif vers l'ouest, et une
 * altitude en radians. Le cap depuis le nord vaut donc azimut + π ; en
 * projetant sur nos axes il reste :
 *   x = -cos(alt)·sin(az)   y = sin(alt)   z = cos(alt)·cos(az)
 */
export function sunDirection(date, lat, lng) {
  const { altitude, azimuth } = SunCalc.getPosition(date, lat, lng);
  const cosAlt = Math.cos(altitude);
  return {
    x: -cosAlt * Math.sin(azimuth),
    y: Math.sin(altitude),
    z: cosAlt * Math.cos(azimuth),
    altitude,
  };
}

/**
 * Aligne le centre de la carte d'ombres sur sa grille de texels.
 *
 * Sans ça, un centre qui glisse continûment fait recalculer la carte sur une
 * grille légèrement différente à chaque image : les bords d'ombre grouillent.
 * C'est le défaut le plus visible d'une lumière qui suit une caméra mobile, et
 * il se corrige en ne déplaçant le centre que par multiples entiers de texel,
 * dans le plan de la lumière.
 *
 * Fonction pure.
 *
 * @param {{x:number,y:number,z:number}} center  Centre souhaité.
 * @param {{x:number,y:number,z:number}} sunDir  Direction *vers* le soleil.
 * @param {number} radius   Demi-côté de la boîte, en mètres.
 * @param {number} mapSize  Côté de la carte d'ombres, en texels.
 * @returns {{x:number,y:number,z:number}} centre aligné.
 */
export function snapToShadowTexels(center, sunDir, radius, mapSize) {
  const texel = (2 * radius) / mapSize;
  if (!(texel > 0)) return { ...center };

  // Base orthonormée du repère de la lumière. L'axe de référence évite le cas
  // dégénéré du soleil au zénith, où le produit vectoriel avec la verticale
  // s'annule.
  const f = normalize(sunDir);
  const reference = Math.abs(f.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(reference, f));
  const up = cross(f, right);

  const alongRight = dot(center, right);
  const alongUp = dot(center, up);
  const shiftRight = Math.round(alongRight / texel) * texel - alongRight;
  const shiftUp = Math.round(alongUp / texel) * texel - alongUp;

  return {
    x: center.x + right.x * shiftRight + up.x * shiftUp,
    y: center.y + right.y * shiftRight + up.y * shiftUp,
    z: center.z + right.z * shiftRight + up.z * shiftUp,
  };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
