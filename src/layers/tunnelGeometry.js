/* Section commune aux voûtes, à leur gabarit de couverture et aux portails. */
export const PORTAL_ARC_STEPS = 7;
export const PORTAL_CLEARANCE_M = 0.7;

/**
 * Section ouverte d'une voûte : piédroits et arc, sans radier ni bouchon.
 *
 * @param {number} halfWidth Demi-largeur de la chaussée.
 * @param {Object} portal Tranche `portal` d'une famille (couleurs linéaires).
 * @param {number} [steps]
 */
export function vaultProfile(halfWidth, portal, steps = PORTAL_ARC_STEPS) {
  const radius = halfWidth + PORTAL_CLEARANCE_M;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    // De la gauche vers la droite, comme les autres sections fermées.
    const angle = Math.PI * (1 - i / steps);
    out.push({
      across: radius * Math.cos(angle),
      // Piédroits droits sur le premier mètre, voûte au-dessus : un demi-cercle
      // pur pincerait la chaussée à ses deux rives.
      up: 1 + radius * Math.sin(angle) * 0.85,
      color: portal.arch,
    });
  }
  out.unshift({ across: -radius, up: 0, color: portal.arch });
  out.push({ across: radius, up: 0, color: portal.arch });
  return out;
}

