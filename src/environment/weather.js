/*
 * weather — l'état météorologique, et ce qu'il fait à la lumière.
 * ---------------------------------------------------------------
 * Un ciel couvert n'est pas « un soleil moins fort ». C'est un changement de
 * *source* : la voûte entière remplace le disque solaire, les ombres portées
 * s'effacent, la lumière perd sa chaleur et le relief perd son modelé. C'est
 * l'un des leviers les plus économiques de la crédibilité d'un paysage, parce
 * que l'œil lit la cohérence globale d'un éclairage bien avant le détail des
 * formes.
 *
 * Ce module ne rend rien et ne tient aucun objet three : il ne fait que
 * traduire un état météo en coefficients. Toutes ses fonctions sont pures, donc
 * vérifiables sans navigateur — ce qui compte ici plus qu'ailleurs, puisqu'une
 * inversion entre « couvert » et « dégagé » ne se verrait autrement qu'à l'œil,
 * et seulement sous un certain angle de soleil.
 *
 * **La météo est un état, pas une direction artistique.** Elle ne vit donc pas
 * dans `themes/default.js` : elle change en cours de route, comme l'heure, et
 * arrive par le même chemin qu'elle (`updateSky`). Une palette dit de quelle
 * couleur est le brouillard de ce monde ; la météo dit combien il y en a
 * aujourd'hui. Deux questions différentes, deux entrées différentes.
 *
 * **La surcharge se fait clé par clé**, contrairement aux tranches de thème.
 * Ce n'est pas une incohérence : un thème est une œuvre qu'on remplace en
 * bloc, un état météo est un relevé dont on ne connaît parfois qu'une valeur
 * (« il pleut », sans rien savoir du vent). Exiger l'objet entier obligerait
 * chaque appelant à recopier les six autres clés à chaque image.
 *
 * **Le temps par défaut est exactement le rendu d'aujourd'hui.** `DEFAULT_WEATHER`
 * reprend les valeurs de nuages qui étaient jusqu'ici figées au montage, et
 * toutes les modulations ci-dessous sont écrites pour valoir *identité* sur cet
 * état. Une application qui ne parle jamais de météo voit donc le même paysage
 * qu'avant, au bit près ; l'assombrissement ne commence qu'au-dessus du ciel
 * ordinaire.
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

/**
 * Le ciel ordinaire : quelques nuages, une brise, pas d'eau.
 *
 * `cloudCover` et `cloudDensity` reprennent les valeurs qui étaient jusqu'ici
 * les défauts de `SceneEnvironment` — c'est ce qui garantit qu'activer la météo
 * ne change rien tant qu'on ne la touche pas.
 */
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
  /** Brume au sol, indépendante de la pluie, de 0 à 1. */
  haze: 0,
  /**
   * Mouillé au sol, de 0 à 1. Omis, il suit l'averse en cours.
   *
   * Il est laissé **explicite** parce qu'un sol ne sèche pas à la seconde où la
   * pluie cesse : une application qui veut cette traîne l'intègre elle-même,
   * avec sa propre constante de temps. La modéliser ici obligerait ce module à
   * garder un état entre deux images, et il n'en a aucun.
   */
  wetness: null,
});

/**
 * Ombre portée par le ciel ordinaire, sur l'échelle `cover × density`. Sert de
 * seuil : en dessous, aucune modulation d'éclairage. Voir l'en-tête.
 */
const CLEAR_SKY_SHADE = DEFAULT_WEATHER.cloudCover * DEFAULT_WEATHER.cloudDensity;

/**
 * Au-delà de ce niveau de couvert, le soleil n'a plus de disque : le laisser
 * projeter des ombres dessinerait des contours nets sous une lumière qui n'en a
 * plus. `shadow.intensity` les efface progressivement bien avant, mais le seuil
 * évite d'entretenir une passe d'ombres qui ne rend plus rien.
 */
const SHADOW_CUTOFF_OVERCAST = 0.92;

/**
 * Complète et borne un état météo partiel.
 *
 * @param {Object|null} [weather] Clés à substituer au temps ordinaire.
 * @returns {Object} l'état complet, gelé — il est lu par le ciel, les
 *          matériaux et la végétation dans la même image, et un état qu'une de
 *          ces lectures pourrait modifier serait indébogable.
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
    haze: clamp01(finite(w.haze, DEFAULT_WEATHER.haze)),
    // La neige ne mouille pas la chaussée tant qu'elle tient : le sol blanchit,
    // il ne noircit pas. On ne dérive donc le mouillé que de la pluie.
    wetness: clamp01(finite(w.wetness, type === 'snow' ? 0 : precipitation)),
  });
}

/**
 * Part de ciel bouché, de 0 (le temps ordinaire ou mieux) à 1 (couvert plein).
 *
 * C'est la mesure dont dépend tout le reste de l'éclairage, et elle est
 * volontairement *unique* : le ciel, le soleil, l'ambiance et le brouillard la
 * lisent tous, donc rien ne peut basculer à contretemps — même raisonnement que
 * `nightMix` pour la nuit.
 *
 * @param {Object} weather État résolu.
 */
export function overcastOf(weather) {
  return smoothstep(CLEAR_SKY_SHADE, 0.85, weather.cloudCover * weather.cloudDensity);
}

/**
 * Éclairage corrigé par la météo, à partir de celui que le soleil seul dicte
 * (`lightingFor`).
 *
 * Sous un ciel couvert la directionnelle s'efface presque entièrement et
 * l'hémisphérique monte : la source n'est plus le disque solaire mais la voûte.
 * La chaleur, elle, s'en va — une lumière diffusée par des kilomètres de nuage
 * est neutre, et un couchant orange derrière un ciel bouché est le genre
 * d'incohérence que l'œil relève tout de suite.
 *
 * @param {{sun:number, ambient:number, warmth:number, night:boolean}} light
 * @param {Object} weather État résolu.
 * @returns {{sun:number, ambient:number, warmth:number, night:boolean, shadow:number}}
 *          `shadow` est l'opacité des ombres portées, de 0 à 1.
 */
export function weatherLighting(light, weather) {
  const overcast = overcastOf(weather);
  // L'averse assombrit au-delà du couvert qui la porte : sous une pluie
  // battante, il fait plus sombre qu'il n'y paraît au seul compte des nuages.
  const gloom = clamp01(overcast + weather.precipitation * 0.25 * (1 - overcast));

  return {
    sun: light.sun * mix(1, 0.15, gloom),
    // La montée est modeste : l'ambiance porte déjà le ciel, et la doubler
    // délaverait le relief au lieu de l'adoucir.
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
 * Facteur multiplicatif sur la densité du brouillard.
 *
 * Trois causes distinctes, additionnées parce qu'elles se cumulent réellement :
 * un ciel bas rapproche l'horizon, la pluie le rapproche beaucoup plus, et la
 * brume est une variable à part — c'est elle qui fait le petit matin, sans un
 * nuage au ciel.
 *
 * @param {Object} weather État résolu.
 * @returns {number} 1 par temps ordinaire, davantage ensuite.
 */
export function fogScale(weather) {
  const overcast = overcastOf(weather);
  return 1 + overcast * 0.4 + weather.precipitation * 1.3 + weather.haze * 5.5;
}

/**
 * Couleur de brouillard corrigée par la météo, en linéaire.
 *
 * La palette de l'application dit de quelle couleur est l'air de ce monde ; la
 * météo dit seulement à quel point il est gris. On **désature vers sa propre
 * luminance** plutôt que vers un gris arbitraire : la teinte du décor survit,
 * elle s'éteint. Un ciel bouché bleu clair est l'erreur la plus visible qu'on
 * puisse faire ici, parce que le brouillard est aussi la couleur de fond et
 * qu'elle occupe la moitié de l'image.
 *
 * @param {[number,number,number]} rgb Couleur de la palette, linéaire.
 * @param {Object} weather État résolu.
 * @returns {[number,number,number]}
 */
export function fogColorFor(rgb, weather) {
  const overcast = overcastOf(weather);
  // La brume désature à elle seule : un ciel bleu bien dégagé au-dessus d'une
  // brume matinale n'empêche pas le brouillard d'être gris — la brume n'a pas
  // besoin d'un ciel couvert pour désaturer, contrairement à l'assombrissement
  // plus bas. Les deux causes sont prises au maximum plutôt qu'additionnées :
  // sous un ciel bas *et* brumeux, on lit un seul brouillard, pas deux qui
  // s'empilent en un gris plus profond qu'aucune des deux ne produirait seule.
  const grey = Math.max(overcast * 0.75, weather.haze * 0.85);
  if (grey <= 0) return [rgb[0], rgb[1], rgb[2]];

  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  // Assombrissement léger, et seulement depuis le couvert : un ciel couvert
  // est gris, pas noir, et une brume au sol sous un ciel dégagé est souvent
  // aussi claire que le ciel qu'elle voile, pas plus sombre.
  const shade = mix(1, 0.72, overcast * clamp01(0.4 + weather.precipitation * 0.6));
  return [
    mix(rgb[0], luma, grey) * shade,
    mix(rgb[1], luma, grey) * shade,
    mix(rgb[2], luma, grey) * shade,
  ];
}

/**
 * Correction des coefficients de Preetham par la météo.
 *
 * Seule la turbidité bouge, et seulement avec la brume : c'est le paramètre qui
 * dit combien l'air porte d'aérosols, donc exactement ce qu'est une brume. Les
 * nuages, eux, sont déjà rendus par le shader de nuages du `Sky` de three —
 * les redoubler par la turbidité blanchirait le ciel deux fois.
 *
 * @param {{turbidity:number, rayleigh:number, mieCoefficient:number, mieDirectionalG:number}} sky
 * @param {Object} weather État résolu.
 */
export function weatherSkyParameters(sky, weather) {
  return {
    ...sky,
    turbidity: sky.turbidity * (1 + weather.haze * 1.6),
    // Une atmosphère chargée diffuse moins sélectivement : le bleu franc du
    // zénith s'affadit avec la brume, et c'est le rayleigh qui le porte.
    rayleigh: sky.rayleigh * (1 - weather.haze * 0.35),
  };
}

/**
 * Ce que le vent fait au feuillage : une amplitude et une vitesse, toutes deux
 * relatives à ce que le thème a réglé pour chaque famille de plante.
 *
 * Elles sont **séparées** parce qu'elles ne disent pas la même chose. Une brise
 * fait onduler lentement et peu ; une bourrasque fouette vite et loin. Ne
 * piloter que l'amplitude donnerait de l'herbe qui se couche au ralenti, ce qui
 * se lit comme un liquide, pas comme du vent.
 *
 * Par temps ordinaire les deux valent 1 : le mouvement réglé dans les couches
 * (`windStrength` de l'herbe, des arbres, des cultures) reste intact.
 *
 * @param {Object} weather État résolu.
 * @returns {{amplitude:number, speed:number}}
 */
export function windField(weather) {
  const base = DEFAULT_WEATHER.wind;
  // Deux pentes autour du temps ordinaire : sous la brise de référence le
  // mouvement s'éteint vers zéro, au-dessus il enfle jusqu'à la bourrasque.
  const t = weather.wind <= base ? weather.wind / base : 1 + (weather.wind - base) / (1 - base);
  return {
    amplitude: mix(0.05, 1, Math.min(t, 1)) * (t > 1 ? mix(1, 2.6, t - 1) : 1),
    speed: mix(0.35, 1, Math.min(t, 1)) * (t > 1 ? mix(1, 2.2, t - 1) : 1),
  };
}
