/*
 * skyModel — la forme du ciel et l'éclairage assorti, en fonction de la
 * hauteur du soleil. Pur et testable : aucune couleur n'est décidée ici, ce
 * sont des *quantités* (courbure du dégradé, force du halo, intensités).
 *
 * ## Pourquoi ce n'est plus Preetham
 *
 * Le modèle de Preetham, livré par three, calcule la diffusion de Rayleigh et
 * de Mie pour chaque direction regardée. Il est juste, et c'est précisément le
 * problème : il produit un ciel continu, dont la luminance monte très au-delà
 * de 1 et qui n'existe donc qu'à travers un tone mapping. Un décor en aplats
 * demande l'inverse — deux couleurs, une rampe entre elles, et une luminance
 * qui reste dans la plage d'affichage pour que la teinte sorte telle qu'elle a
 * été peinte.
 *
 * Ce qu'on perd en le retirant est réel et assumé : l'assombrissement du
 * zénith avec l'épaisseur d'air, le rougissement physique du couchant, la
 * couronne de Mie. Ce qui les remplace est peint : la palette donne les deux
 * couleurs (`sky.fog` à l'horizon, `sky.zenith` en haut), ce module donne la
 * façon dont elles se rejoignent et ce que le soleil y ajoute.
 *
 * ## L'éclairage tient dans la plage d'affichage
 *
 * Le rig montait volontairement au-dessus de 1 (soleil 1,75 + ambiance 1,2 au
 * zénith) parce qu'un tone mapping filmique reprenait ensuite la main. Il ne
 * le fait plus : soleil et ambiance somment à un peu plus de 1 sur une face
 * tournée vers le haut, ce qui rend l'albédo à peu près tel qu'il est peint.
 * Le rapport entre les deux (environ 2 pour 1) est ce qui décide de la
 * profondeur des ombres, et c'est le seul contraste dont dispose un décor sans
 * spéculaire.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/**
 * La forme du dégradé, pour une hauteur de soleil donnée.
 *
 * @param {number} sunY Composante verticale de la direction du soleil, dans [-1, 1].
 * @returns {{curve:number, sunset:number, glow:number, glowFocus:number}}
 *   - `curve` : exposant de la rampe horizon → zénith. Sous 1 la couleur de
 *     zénith mord dès quelques degrés (ciel plat de plein jour) ; au-dessus,
 *     la bande d'horizon monte haut, ce qui est ce que fait un soir.
 *   - `sunset` : part de la couleur de la lumière versée dans la bande basse,
 *     du côté du soleil seulement. Nulle quand il est haut.
 *   - `glow` : force du halo autour du disque, ajoutée (pas mélangée).
 *   - `glowFocus` : exposant du cosinus qui le resserre. Grand = petit halo.
 */
export function skyParameters(sunY) {
  const day = smoothstep(0, 0.25, sunY);
  const high = smoothstep(0, 0.3, sunY);

  return {
    curve: mix(1.35, 0.62, high),
    sunset: mix(0.55, 0, day),
    // Le halo reste modeste : c'est un aplat, pas une couronne de diffusion.
    glow: mix(0.22, 0.07, day),
    glowFocus: mix(22, 48, day),
  };
}

/**
 * Éclairage assorti : intensités du soleil et de l'ambiance, et chaleur de la
 * lumière directe. La nuit reste éclairée au-dessus du physiquement juste
 * (lueur froide) pour garder le relief lisible.
 *
 * Les intensités sont calées pour un rendu **sans tone mapping** : sur une
 * face tournée vers le haut en plein jour, soleil et ambiance somment à 1,06,
 * et l'ambiance seule — ce que reçoit une face à l'ombre — en fait 0,48. Un
 * décor éclairé au-delà de ça n'écrête pas doucement, il devient blanc.
 *
 * @param {number} sunY
 * @returns {{sun:number, ambient:number, warmth:number, night:boolean}}
 */
export function lightingFor(sunY) {
  if (sunY <= -0.1) {
    return { sun: 0.1, ambient: 0.26, warmth: 1, night: true };
  }
  const elevation = Math.max(sunY, 0);
  const daylight = Math.min(1, elevation * 3);
  return {
    sun: 0.1 + daylight * 0.48,
    ambient: 0.28 + daylight * 0.2,
    // 1 au ras de l'horizon, 0 quand le soleil est haut.
    warmth: 1 - Math.min(1, elevation * 2.5),
    night: false,
  };
}

/**
 * Couleur de la lumière directe, du blanc de midi au chaud rasant.
 *
 * L'écart chaud/froid est le tiers de ce qu'il était : un aplat porte sa
 * teinte tout entière, et une lumière franchement orange la repeignait au
 * lieu de l'éclairer — un pré vert passait au kaki au moindre soleil bas.
 *
 * @returns {[number, number, number]}
 */
export function sunlightColor(warmth, night = false) {
  if (night) return [0.5, 0.6, 0.85];
  return [1, 0.97 - warmth * 0.16, 0.92 - warmth * 0.26];
}
