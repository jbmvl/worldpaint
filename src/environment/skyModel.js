/*
 * skyModel — coefficients du modèle de ciel de Preetham (three) et éclairage
 * assorti, en fonction de la hauteur du soleil. Pur et testable.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Coefficients de Preetham pour une hauteur de soleil donnée.
 * @param {number} sunY Composante verticale de la direction du soleil, dans [-1, 1].
 */
export function skyParameters(sunY) {
  const day = smoothstep(0, 0.25, sunY);
  const high = smoothstep(0, 0.3, sunY);

  return {
    turbidity: mix(8.5, 2.4, day),
    rayleigh: mix(3.4, 1.3, high),
    mieCoefficient: mix(0.013, 0.004, day),
    // Plus la lumière rase, plus le halo autour du soleil est resserré et vif.
    mieDirectionalG: mix(0.86, 0.79, day),
  };
}

/** Hauteur de soleil sous laquelle l'éclairage est entièrement nocturne. */
const NIGHT_SUN_Y = -0.1;
const NIGHT_LIGHT = { sun: 0.3, ambient: 0.62 };

/**
 * Éclairage assorti : intensités du soleil et de l'ambiance, et chaleur de la
 * lumière directe. La nuit reste éclairée au-dessus du physiquement juste
 * (lueur froide) pour garder le relief lisible.
 *
 * Entre le coucher et `NIGHT_SUN_Y`, le crépuscule glisse continûment vers la
 * nuit : un basculement net tomberait à une heure qui dépend de la vitesse de
 * descente du soleil, donc de la saison et de la latitude.
 *
 * @param {number} sunY
 * @returns {{sun:number, ambient:number, warmth:number, night:boolean, nightBlend:number}}
 *          `nightBlend` va de 0 (soleil levé) à 1 (nuit pleine).
 */
export function lightingFor(sunY) {
  const elevation = Math.max(sunY, 0);
  const daylight = Math.min(1, elevation * 3);
  const nightBlend = smoothstep(0, NIGHT_SUN_Y, sunY);
  return {
    sun: mix(0.25 + daylight * 1.5, NIGHT_LIGHT.sun, nightBlend),
    ambient: mix(0.5 + daylight * 0.7, NIGHT_LIGHT.ambient, nightBlend),
    // 1 au ras de l'horizon, 0 quand le soleil est haut.
    warmth: 1 - Math.min(1, elevation * 2.5),
    night: sunY <= NIGHT_SUN_Y,
    nightBlend,
  };
}

/**
 * Couleur de la lumière directe, du blanc de midi à l'orange rasant, puis au
 * bleu froid de la nuit.
 * @param {number} warmth
 * @param {number|boolean} [night] Part de nuit, de 0 à 1 (`true` vaut 1).
 * @returns {[number, number, number]}
 */
export function sunlightColor(warmth, night = 0) {
  const n = Number(night) || 0;
  const day = [1, 0.95 - warmth * 0.3, 0.85 - warmth * 0.45];
  return [mix(day[0], 0.5, n), mix(day[1], 0.6, n), mix(day[2], 0.85, n)];
}
