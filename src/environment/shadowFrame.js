/*
 * shadowFrame — position du soleil et cadrage de la carte d'ombres.
 * ------------------------------------------------------------------
 * Séparé de `sceneEnvironment.js` pour deux raisons : c'est de la géométrie
 * pure, donc testable sans navigateur, et `sceneEnvironment` dépend des
 * palettes de la carte 2D, qui traînent tout Vue derrière elles.
 */

import SunCalc from 'suncalc';

/** Demi-côté de la boîte d'ombres, en mètres : resserrée autour de l'observateur. */
export const SHADOW_RADIUS_M = 110;
/** Avance de la boîte devant l'observateur (la caméra regarde vers l'avant). */
export const SHADOW_LEAD_M = 45;
/** Distance de la lumière à sa cible : au-delà, la boîte de profondeur clippe. */
export const SHADOW_DISTANCE_M = 800;
/** Sous cette hauteur de soleil, plus d'ombres (elles s'étirent hors boîte et se coupent net). */
export const SHADOW_MIN_SUN_Y = 0.08;

/**
 * Direction du soleil dans le repère de la scène (x est, y haut, z sud).
 * SunCalc donne azimut (depuis le sud, positif vers l'ouest) et altitude en
 * radians ; d'où x = -cos(alt)·sin(az), y = sin(alt), z = cos(alt)·cos(az).
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
 * Aligne le centre de la carte d'ombres sur sa grille de texels, pour éviter
 * le grouillement des bords d'ombre quand la lumière suit une caméra mobile.
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

  // Base orthonormée du repère de la lumière (référence alternative au zénith,
  // où le produit vectoriel avec la verticale s'annulerait).
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
