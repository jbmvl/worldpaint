/*
 * coverBands — les échelles auxquelles se lit une couverture végétale.
 * --------------------------------------------------------------------
 * L'herbe et les cultures semaient chacune un disque : une maille unique, une
 * densité unique, et un fondu de bord qui rapetissait les touffes jusqu'à les
 * éteindre. Le résultat était une masse pleine sur quarante mètres, puis plus
 * rien — le sol reprenait la main d'un coup, et c'est ce qu'on voyait depuis la
 * route.
 *
 * Le défaut n'était pas le nombre d'objets, c'était l'échelle : **une touffe
 * lointaine ne doit pas être une touffe proche en plus petit.** Passé quelques
 * dizaines de mètres, on ne distingue plus un brin d'un autre, et vouloir en
 * dessiner un par brin coûte cher pour produire, à l'écran, un piqueté qui
 * disparaît au premier mip.
 *
 * Une **bande** est donc une distance à laquelle on décide combien de sol une
 * instance représente :
 *
 *   bande 0   la plante      maille serrée, beaucoup de tirages, taille réelle
 *   bande 1   la touffe      maille moyenne, peu de tirages, panneau élargi
 *   bande 2   la masse       maille large, un ou deux tirages, panneau large
 *
 * Le nombre d'instances par anneau reste alors à peu près constant quand la
 * distance croît, au lieu de croître comme la surface : c'est ce qui permet de
 * tripler la portée pour moitié moins d'instances qu'un disque uniforme.
 *
 * ## Ce qui doit rester vrai
 *
 * - **Chaque bande a sa propre grille, ancrée au sol.** Une bande quantifie les
 *   positions par sa maille et tire sa graine des seules coordonnées de maille,
 *   plus un sel propre à la bande — sans ce sel, la bande 0 et la bande 1
 *   sèmeraient les mêmes touffes aux mêmes endroits pour peu que leurs indices
 *   coïncident. Avancer ajoute des mailles devant, il ne redistribue rien.
 * - **Les bandes se recouvrent, et le passage de l'une à l'autre est un fondu
 *   de densité, jamais de taille.** Dans la zone commune, la bande intérieure
 *   perd ses instances pendant que l'extérieure gagne les siennes, une à une et
 *   toujours dans le même ordre (le tirage de présence est stable). Un fondu de
 *   taille était exactement le défaut d'origine : la végétation s'éteignait au
 *   lieu de passer la main.
 *
 * Ce module ne dessine rien et ne connaît ni l'herbe ni le blé : il ne sait que
 * découper l'espace. Ce qui pousse dans chaque maille reste l'affaire de
 * `groundCover` et de `cropLayer`.
 */

/**
 * Fabrique une bande.
 *
 * @param {Object} spec
 * @param {number} spec.from    Distance à laquelle la bande commence, en mètres.
 * @param {number} spec.to      Distance à laquelle elle s'arrête.
 * @param {number} spec.cell    Côté de sa maille, en mètres.
 * @param {number} spec.perCell Tirages par maille.
 * @param {number} [spec.spread] Élargissement du panneau. Une masse est plus
 *        **large** que haute : c'est la largeur qui ferme les trous entre
 *        instances, et l'élever autant donnerait une prairie en escalier.
 * @param {number} [spec.rise]  Rehaussement du panneau, volontairement modeste.
 * @param {number} [spec.massBias] Part de densité rendue à une couverture
 *        partielle. À distance, une instance représente plusieurs mètres carrés :
 *        une prairie à demi verte y est une masse continue un peu clairsemée,
 *        pas une maille sur deux vide. Zéro laisse la densité telle quelle.
 * @param {number} [spec.fadeIn]  Longueur du fondu d'entrée, en mètres.
 * @param {number} [spec.fadeOut] Longueur du fondu de sortie.
 * @param {number} [spec.salt]    Sel de graine propre à la bande.
 */
export function coverBand({
  from,
  to,
  cell,
  perCell,
  spread = 1,
  rise = 1,
  massBias = 0,
  fadeIn = 0,
  fadeOut = 0,
  salt = 0,
}) {
  return { from, to, cell, perCell, spread, rise, massBias, fadeIn, fadeOut, salt };
}

/**
 * Mailles de toutes les bandes, de la plus proche à la plus lointaine.
 *
 * L'ordre compte, et pour la même raison qu'avant les bandes : si le plafond
 * d'instances est atteint, ce qui se perd doit être au bord — où une instance
 * de moins ne se voit pas — et non un quartier entier tiré au hasard de l'ordre
 * de parcours. Fonction pure.
 *
 * @param {Array} bands Bandes, telles que rendues par `coverBand`.
 * @returns {Array<{gx:number, gz:number, distance:number, band:number}>}
 *          indices de maille **dans la grille de leur bande** (à multiplier par
 *          `bands[band].cell`), distance au centre, et bande d'origine.
 */
export function coverBandRing(bands) {
  const out = [];
  for (let band = 0; band < bands.length; band++) {
    const { from, to, cell } = bands[band];
    const span = Math.ceil(to / cell);
    for (let gz = -span; gz <= span; gz++) {
      for (let gx = -span; gx <= span; gx++) {
        // Distance prise au centre de la maille : c'est là que la couverture
        // est lue, et c'est ce qui décide de la bande et du fondu.
        const dx = (gx + 0.5) * cell;
        const dz = (gz + 0.5) * cell;
        const distance = Math.hypot(dx, dz);
        if (distance < from || distance >= to) continue;
        out.push({ gx, gz, distance, band });
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Part de la densité d'une bande retenue à une distance donnée : 1 en plein
 * milieu, et un fondu linéaire à chacun de ses deux bords.
 *
 * Dans une zone de recouvrement, la somme des deux bandes vaut à peu près 1 :
 * la couverture ne se creuse pas au passage. Fonction pure.
 */
export function coverBandFade(distance, band) {
  let fade = 1;
  if (band.fadeIn > 0) fade = Math.min(fade, (distance - band.from) / band.fadeIn);
  if (band.fadeOut > 0) fade = Math.min(fade, (band.to - distance) / band.fadeOut);
  if (fade < 0) return 0;
  return fade > 1 ? 1 : fade;
}

/**
 * Rétrécissement de la **hauteur**, avec un plancher.
 *
 * La densité, elle, peut tomber à zéro — c'est elle qui fait passer la main
 * d'une bande à l'autre. La hauteur, non : une instance qui survit au tri de
 * densité doit rester perceptible, sinon la couverture s'éteint au lieu de
 * s'éclaircir. C'est le correctif qui a précédé les bandes, et il reste vrai
 * à l'intérieur de chacune. Fonction pure.
 */
export function coverHeightFade(fade, floor) {
  return floor + (1 - floor) * fade;
}

/**
 * Densité corrigée du biais de masse de la bande — voir `spec.massBias`.
 * Une couverture pleine reste pleine : le biais ne fait que relever les
 * couvertures partielles, donc il ne déplace jamais le pire cas qui dimensionne
 * les plafonds. Fonction pure.
 */
export function coverMassDensity(density, band) {
  if (!band.massBias) return density;
  return density + (1 - density) * band.massBias;
}

/** Portée d'un jeu de bandes, en mètres : le bord de la plus lointaine. */
export function coverBandsRadius(bands) {
  let radius = 0;
  for (const band of bands) if (band.to > radius) radius = band.to;
  return radius;
}
