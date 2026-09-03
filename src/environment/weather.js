/*
 * weather — l'état météorologique, et ce qu'il fait à la lumière. Un ciel
 * couvert change de source (voûte plutôt que disque solaire) : ombres
 * effacées, lumière neutre, relief moins modelé.
 *
 * Fonctions pures, ne rendent rien et ne tiennent aucun objet three.
 *
 * État (pas une direction artistique) : ne vit pas dans `themes/default.js`,
 * change en cours de route comme l'heure, arrive par `updateSky`. Surchargé
 * clé par clé (contrairement aux tranches de thème), car c'est un relevé
 * partiel plutôt qu'une œuvre remplacée en bloc.
 *
 * `DEFAULT_WEATHER` reprend les valeurs de nuages qui étaient figées au
 * montage : une application qui ne parle jamais de météo voit le même
 * paysage qu'avant, au bit près.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** Les deux formes de précipitation qu'on sait rendre. */
export const PRECIPITATION_TYPES = ['rain', 'snow'];

/** Le ciel ordinaire : quelques nuages, une brise, pas d'eau. */
export const DEFAULT_WEATHER = Object.freeze({
  /** Part du ciel occupée par des nuages, de 0 (dégagé) à 1 (bouché). */
  cloudCover: 0.42,
  /** Opacité de ces nuages, de 0 (voile) à 1 (masse noire). */
  cloudDensity: 0.55,
  /** Intensité des précipitations, de 0 (rien) à 1 (averse). */
  precipitation: 0,
  /** `'rain'` ou `'snow'`. Sans effet tant que `precipitation` vaut 0. */
  precipitationType: 'rain',
  /** Force du vent, de 0 (air immobile) à 1 (bourrasque). */
  wind: 0.25,
  /** Direction du vent, en radians. Fait pivoter la diagonale de référence de chaque module — voir `windAxis`. */
  windDirection: 0,
  /** Brume au sol, indépendante de la pluie, de 0 à 1. */
  haze: 0,
  /**
   * Mouillé au sol, de 0 à 1. Omis, il suit l'averse en cours. Laissé
   * explicite car le séchage après la pluie n'a pas d'état ici — c'est à
   * l'application de l'intégrer.
   */
  wetness: null,
});

/** Ombre portée par le ciel ordinaire (`cover × density`) : seuil sous lequel aucune modulation d'éclairage. */
const CLEAR_SKY_SHADE = DEFAULT_WEATHER.cloudCover * DEFAULT_WEATHER.cloudDensity;

/** Au-delà de ce couvert, le soleil n'a plus de disque : plus d'ombres portées. */
const SHADOW_CUTOFF_OVERCAST = 0.92;

/**
 * Complète et borne un état météo partiel.
 *
 * @param {Object|null} [weather] Clés à substituer au temps ordinaire.
 * @returns {Object} l'état complet, gelé (lu par le ciel, les matériaux et la
 *          végétation dans la même image).
 */
export function resolveWeather(weather = null) {
  const w = weather || {};
  const precipitation = clamp01(finite(w.precipitation, DEFAULT_WEATHER.precipitation));
  const type = PRECIPITATION_TYPES.includes(w.precipitationType)
    ? w.precipitationType
    : DEFAULT_WEATHER.precipitationType;

  return Object.freeze({
    cloudCover: clamp01(finite(w.cloudCover, DEFAULT_WEATHER.cloudCover)),
    cloudDensity: clamp01(finite(w.cloudDensity, DEFAULT_WEATHER.cloudDensity)),
    precipitation,
    precipitationType: type,
    wind: clamp01(finite(w.wind, DEFAULT_WEATHER.wind)),
    // Un angle, pas une part : pas de clamp01.
    windDirection: finite(w.windDirection, DEFAULT_WEATHER.windDirection),
    haze: clamp01(finite(w.haze, DEFAULT_WEATHER.haze)),
    // La neige ne mouille pas la chaussée tant qu'elle tient.
    wetness: clamp01(finite(w.wetness, type === 'snow' ? 0 : precipitation)),
  });
}

/**
 * Part de ciel bouché, de 0 (le temps ordinaire ou mieux) à 1 (couvert plein).
 * Mesure unique dont dépend tout le reste de l'éclairage (ciel, soleil,
 * ambiance, brouillard) — même raisonnement que `nightMix` pour la nuit.
 *
 * @param {Object} weather État résolu.
 */
export function overcastOf(weather) {
  return smoothstep(CLEAR_SKY_SHADE, 0.85, weather.cloudCover * weather.cloudDensity);
}

/**
 * Éclairage corrigé par la météo, à partir de celui que le soleil seul dicte
 * (`lightingFor`). Sous un ciel couvert la directionnelle s'efface et
 * l'hémisphérique monte (la source devient la voûte plutôt que le disque
 * solaire), et la chaleur s'en va (lumière diffusée, neutre).
 *
 * @param {{sun:number, ambient:number, warmth:number, night:boolean}} light
 * @param {Object} weather État résolu.
 * @returns {{sun:number, ambient:number, warmth:number, night:boolean, shadow:number}}
 *          `shadow` est l'opacité des ombres portées, de 0 à 1.
 */
export function weatherLighting(light, weather) {
  const overcast = overcastOf(weather);
  // L'averse assombrit au-delà du couvert qui la porte.
  const gloom = clamp01(overcast + weather.precipitation * 0.25 * (1 - overcast));

  return {
    sun: light.sun * mix(1, 0.15, gloom),
    ambient: light.ambient * mix(1, 1.4, gloom),
    warmth: light.warmth * (1 - overcast * 0.85),
    night: light.night,
    shadow: 1 - overcast * 0.95,
  };
}

/**
 * Le soleil projette-t-il encore ? Voir `SHADOW_CUTOFF_OVERCAST`.
 * @param {Object} weather État résolu.
 */
export function castsShadow(weather) {
  return overcastOf(weather) < SHADOW_CUTOFF_OVERCAST;
}

/**
 * Facteur multiplicatif sur la densité du brouillard. Trois causes
 * additionnées : ciel bas, pluie (plus fort), et brume (variable à part, le
 * petit matin sans nuage). Le coefficient de la brume est calé pour qu'à
 * `haze = 1` la distance caractéristique du brouillard tombe vers 70-80 m.
 *
 * @param {Object} weather État résolu.
 * @returns {number} 1 par temps ordinaire, davantage ensuite.
 */
export function fogScale(weather) {
  const overcast = overcastOf(weather);
  return 1 + overcast * 0.4 + weather.precipitation * 1.3 + weather.haze * 18;
}

/**
 * Couleur de brouillard corrigée par la météo, en linéaire. Désature vers sa
 * propre luminance plutôt que vers un gris arbitraire, pour que la teinte du
 * décor s'éteigne sans changer (un ciel bouché bleu clair serait l'erreur la
 * plus visible ici).
 *
 * @param {[number,number,number]} rgb Couleur de la palette, linéaire.
 * @param {Object} weather État résolu.
 * @returns {[number,number,number]}
 */
export function fogColorFor(rgb, weather) {
  const overcast = overcastOf(weather);
  // Brume et couvert désaturent chacun indépendamment ; max plutôt qu'addition
  // pour ne pas empiler deux brouillards en un gris trop profond.
  const grey = Math.max(overcast * 0.75, weather.haze * 0.85);
  if (grey <= 0) return [rgb[0], rgb[1], rgb[2]];

  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  // Assombrissement léger, et seulement depuis le couvert (une brume seule ne noircit pas).
  const shade = mix(1, 0.72, overcast * clamp01(0.4 + weather.precipitation * 0.6));
  return [
    mix(rgb[0], luma, grey) * shade,
    mix(rgb[1], luma, grey) * shade,
    mix(rgb[2], luma, grey) * shade,
  ];
}

/**
 * Correction des coefficients de Preetham par la météo. Seule la turbidité
 * bouge, et seulement avec la brume (les nuages sont déjà rendus par le
 * shader de `Sky` de three).
 *
 * @param {{turbidity:number, rayleigh:number, mieCoefficient:number, mieDirectionalG:number}} sky
 * @param {Object} weather État résolu.
 */
export function weatherSkyParameters(sky, weather) {
  return {
    ...sky,
    turbidity: sky.turbidity * (1 + weather.haze * 1.6),
    // Le bleu franc du zénith s'affadit avec la brume.
    rayleigh: sky.rayleigh * (1 - weather.haze * 0.35),
  };
}

/**
 * Ce que le vent fait au feuillage : une amplitude et une vitesse, relatives
 * au réglage du thème pour chaque famille de plante. Séparées car une brise
 * ondule lentement et peu, une bourrasque fouette vite et loin (piloter la
 * seule amplitude donnerait un mouvement de liquide, pas de vent). Par temps
 * ordinaire les deux valent 1.
 *
 * @param {Object} weather État résolu.
 * @returns {{amplitude:number, speed:number}}
 */
export function windField(weather) {
  const base = DEFAULT_WEATHER.wind;
  // Deux pentes autour du temps ordinaire.
  const t = weather.wind <= base ? weather.wind / base : 1 + (weather.wind - base) / (1 - base);
  return {
    amplitude: mix(0.05, 1, Math.min(t, 1)) * (t > 1 ? mix(1, 2.6, t - 1) : 1),
    speed: mix(0.35, 1, Math.min(t, 1)) * (t > 1 ? mix(1, 2.2, t - 1) : 1),
  };
}

/**
 * Fait pivoter la diagonale de référence d'un module par la direction du
 * vent. Chaque module garde son propre vecteur (`axis`, réglé à l'œil) ;
 * `windDirection` ne le remplace pas, il pivote le plan (à 0, rend `axis` tel quel).
 *
 * @param {[number,number]} axis Diagonale de référence du module appelant,
 *        déjà mise à l'échelle de son intensité (vent ou dérive).
 * @param {Object} weather État résolu.
 * @returns {[number,number]}
 */
export function windAxis(axis, weather) {
  const theta = weather.windDirection;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [axis[0] * c - axis[1] * s, axis[0] * s + axis[1] * c];
}
