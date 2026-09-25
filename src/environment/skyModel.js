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
    mieCoefficient: mix(0.008, 0.002, day),
    // Plus la lumière rase, plus le halo autour du soleil est resserré et vif.
    mieDirectionalG: mix(0.9, 0.85, day),
  };
}

/*
 * Réplique JS du shader de `Sky.js` (three 0.185) et du tone mapping ACES de
 * three : le brouillard doit prendre la luminance que le ciel *affiche*, pas
 * celle d'une palette fixe. À garder aligné sur three si ses constantes bougent.
 */
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const SKY_FLOOR = [0, 0.0003, 0.00075];

function preethamSunIntensity(cosZenith) {
  const c = Math.min(1, Math.max(-1, cosZenith));
  return 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(c)) / 1.5));
}

/**
 * Radiance du ciel de Preetham (sans nuages ni disque solaire), linéaire,
 * avant tone mapping.
 *
 * @param {number} sunY Hauteur du soleil (composante verticale).
 * @param {number} dirY Hauteur de la direction regardée.
 * @param {number} azimuth Écart horizontal entre regard et soleil, en radians.
 * @param {{turbidity:number, rayleigh:number, mieCoefficient:number, mieDirectionalG:number}} params
 * @returns {[number,number,number]}
 */
export function preethamRadiance(sunY, dirY, azimuth, params) {
  const sunXZ = Math.sqrt(Math.max(0, 1 - sunY * sunY));
  const dirXZ = Math.sqrt(Math.max(0, 1 - dirY * dirY));
  const sunE = preethamSunIntensity(sunY);
  // `sunPosition.y / 450000` du shader, pour un soleil posé à 400 000.
  const sunfade = 1 - clamp01(1 - Math.exp((sunY * 400000) / 450000));
  const betaR = TOTAL_RAYLEIGH.map((v) => v * (params.rayleigh - (1 - sunfade)));
  const mie = 0.434 * 0.2 * params.turbidity * 10e-18;
  const betaM = MIE_CONST.map((v) => v * mie * params.mieCoefficient);

  const zenith = Math.acos(Math.max(0, dirY));
  const inverse = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const cosTheta = dirXZ * sunXZ * Math.cos(azimuth) + dirY * sunY;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = params.mieDirectionalG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5));
  const grazing = clamp01(Math.pow(1 - sunY, 5));

  return [0, 1, 2].map((i) => {
    const fex = Math.exp(-(betaR[i] * 8.4e3 * inverse + betaM[i] * 1.25e3 * inverse));
    const phase = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    const lin = Math.pow(sunE * phase * (1 - fex), 1.5) * mix(1, Math.sqrt(sunE * phase * fex), grazing);
    return (lin + 0.1 * fex) * 0.04 + SKY_FLOOR[i];
  });
}

const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const applyMatrix = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/**
 * `ACESFilmicToneMapping` de three, linéaire vers linéaire affichable.
 * @param {[number,number,number]} rgb
 * @param {number} exposure `renderer.toneMappingExposure`.
 */
export function acesFilmic(rgb, exposure) {
  const fitted = applyMatrix(ACES_IN, rgb.map((c) => (c * exposure) / 0.6)).map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.432951) + 0.238081;
    return a / b;
  });
  return applyMatrix(ACES_OUT, fitted).map(clamp01);
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
