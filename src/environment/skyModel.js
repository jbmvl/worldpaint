/*
 * skyModel — paramètres atmosphériques et éclairage, en fonction du soleil.
 * -------------------------------------------------------------------------
 * Le rendu du ciel utilise le modèle de Preetham (« A Practical Analytic Model
 * for Daylight », SIGGRAPH 1999), qui est livré avec three. Ce module ne
 * calcule pas le ciel : il décide des **quatre coefficients** que le modèle
 * attend, et l'éclairage assorti, en fonction de la seule hauteur du soleil.
 *
 * Séparé pour être pur, donc testable — une inversion entre l'aube et le
 * crépuscule ne se verrait autrement qu'à l'œil, et sur une scène de nuit.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Coefficients de Preetham pour une hauteur de soleil donnée.
 *
 * Soleil haut : atmosphère claire, diffusion de Rayleigh modérée — le bleu
 * franc de midi. Soleil rasant : la lumière traverse bien plus d'air, le bleu
 * est diffusé hors du trajet et il ne reste que le rouge. C'est ce que
 * traduisent une turbidité et un coefficient de Mie plus élevés.
 *
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

/**
 * Éclairage assorti : intensités du soleil et de l'ambiance, et chaleur de la
 * lumière directe.
 *
 * La nuit n'est pas noire — elle est bleue et faible. Rendre le soleil à zéro
 * donnerait une scène plate et illisible ; on bascule donc sur une lueur froide
 * qui laisse deviner le relief.
 *
 * @param {number} sunY
 * @returns {{sun:number, ambient:number, warmth:number, night:boolean}}
 */
export function lightingFor(sunY) {
  if (sunY <= -0.1) {
    // Une nuit trop sombre n'a rien de réaliste : l'œil s'adapte, et une scène
    // où l'on ne distingue plus le relief se lit comme un rendu en panne. On
    // éclaire donc au-dessus du physiquement juste, comme le fait toute
    // photographie de nuit.
    return { sun: 0.3, ambient: 0.62, warmth: 1, night: true };
  }
  const elevation = Math.max(sunY, 0);
  const daylight = Math.min(1, elevation * 3);
  return {
    sun: 0.25 + daylight * 1.5,
    ambient: 0.5 + daylight * 0.7,
    // 1 au ras de l'horizon, 0 quand le soleil est haut.
    warmth: 1 - Math.min(1, elevation * 2.5),
    night: false,
  };
}

/**
 * Couleur de la lumière directe, du blanc de midi à l'orange rasant.
 * @returns {[number, number, number]}
 */
export function sunlightColor(warmth, night = false) {
  if (night) return [0.5, 0.6, 0.85];
  return [1, 0.95 - warmth * 0.3, 0.85 - warmth * 0.45];
}
