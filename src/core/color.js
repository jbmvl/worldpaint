/*
 * color — passer d'un nuancier à des intensités.
 * Isolé ici pour éviter un cycle entre thème et mobilier.
 */

/**
 * Convertit une couleur sRGB (nuancier) en linéaire (attendu par three).
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
