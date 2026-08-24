/*
 * color — passer d'un nuancier à des intensités.
 * ----------------------------------------------
 * Un fichier pour une fonction, et c'est voulu : le thème et le mobilier en
 * ont tous les deux besoin, et les faire dépendre l'un de l'autre pour ça
 * créerait un cycle entre la direction artistique et le code qui la lit.
 */

/**
 * Convertit une couleur sRGB en espace linéaire, où three attend les couleurs
 * de sommet. Sans cette conversion, tout le décor sort délavé — les valeurs
 * d'un nuancier sont des valeurs sRGB, pas des intensités.
 * @param {string} hex `#rrggbb`
 * @returns {number[]} `[r, g, b]` linéaires.
 */
export function srgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [channel((value >> 16) & 255), channel((value >> 8) & 255), channel(value & 255)];
}
