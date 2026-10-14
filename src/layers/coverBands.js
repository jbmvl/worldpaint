/*
 * coverBands — les échelles auxquelles se lit une couverture végétale.
 *
 * Une bande est une distance à laquelle on décide combien de sol une instance
 * représente (maille serrée/taille réelle près, maille large/panneau élargi
 * loin) : le nombre d'instances par anneau reste à peu près constant avec la
 * distance, au lieu de croître comme la surface.
 *
 * Chaque bande a sa propre grille mondiale (`core/groundSeed.worldCellsIn` ;
 * graine = maille + sel propre à la bande, pour ne pas semer deux fois la même
 * touffe). Les bandes se recouvrent et le passage de l'une à l'autre est un fondu de *densité*,
 * jamais de taille — une touffe lointaine n'est pas une touffe proche en plus
 * petit.
 *
 * Ce module ne dessine rien et ne connaît ni l'herbe ni le blé : il découpe
 * l'espace. Ce qui pousse dans chaque maille est l'affaire de `groundCover`
 * et `cropLayer`.
 */

import { eachWorldCell, uniformWorldGrid } from '../core/groundSeed.js';

/**
 * Fabrique une bande.
 *
 * @param {Object} spec
 * @param {number} spec.from    Distance à laquelle la bande commence, en mètres.
 * @param {number} spec.to      Distance à laquelle elle s'arrête.
 * @param {number} spec.cell    Côté de sa maille, en mètres.
 * @param {number} spec.perCell Tirages par maille.
 * @param {number} [spec.spread] Élargissement du panneau (une masse est plus
 *        large que haute — c'est la largeur qui ferme les trous entre instances).
 * @param {number} [spec.rise]  Rehaussement du panneau, volontairement modeste.
 * @param {number} [spec.massBias] Part de densité rendue à une couverture
 *        partielle, pour qu'une prairie à demi verte reste une masse continue
 *        clairsemée plutôt qu'une maille sur deux vide. Zéro = densité telle quelle.
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

const rings = new WeakMap();

/** Décalages de mailles de toutes les bandes, triés par distance au centre de la maille de base ; calculés une fois. */
function ringOf(bands) {
  let ring = rings.get(bands);
  if (ring) return ring;
  ring = [];
  for (let band = 0; band < bands.length; band++) {
    const { from, to, cell } = bands[band];
    const span = Math.ceil(to / cell);
    for (let dj = -span; dj <= span; dj++) {
      for (let di = -span; di <= span; di++) {
        const distance = Math.hypot(di * cell, dj * cell);
        if (distance >= from && distance < to) ring.push({ di, dj, distance, band });
      }
    }
  }
  ring.sort((a, b) => a.distance - b.distance || a.band - b.band || a.dj - b.dj || a.di - b.di);
  rings.set(bands, ring);
  return ring;
}

/**
 * Mailles mondiales de toutes les bandes autour de (`centerX`, `centerZ`),
 * triées de la plus proche à la plus lointaine (si le plafond d'instances est
 * atteint, ce qui se perd doit être au bord). La distance se compte depuis la
 * maille qui contient le centre, dans chaque bande.
 *
 * @param {Object} frame Repère local.
 * @param {Array} bands Bandes, telles que rendues par `coverBand`.
 * @returns {{length:number, at:(k:number)=>Object}} Itérable de mailles
 *          `{id, row, x, z, size, distance, band}` : maille mondiale (voir
 *          `eachWorldCell`), distance, et bande d'origine.
 */
export function coverBandCells(frame, bands, centerX, centerZ) {
  const grids = bands.map((b) => uniformWorldGrid(frame, centerZ - b.to - 2 * b.cell, centerZ + b.to + 2 * b.cell, b.cell));
  if (grids.every(Boolean)) {
    const bases = grids.map((g) => [g.column(centerX), g.line(centerZ)]);
    const ring = ringOf(bands);
    // Liste paresseuse : une passe interrompue par son budget ne paie que les
    // mailles qu'elle a atteintes.
    const at = (k) => {
      const { di, dj, distance, band } = ring[k];
      const cell = grids[band].cell(bases[band][0] + di, bases[band][1] + dj);
      cell.distance = distance;
      cell.band = band;
      return cell;
    };
    return {
      length: ring.length,
      at,
      *[Symbol.iterator]() { for (let k = 0; k < ring.length; k++) yield at(k); },
    };
  }
  // Une rangée de tuiles change de compte de mailles sous le disque : la grille
  // n'y est plus uniforme, on la parcourt telle quelle.
  const out = [];
  for (let band = 0; band < bands.length; band++) {
    const { from, to, cell } = bands[band];
    eachWorldCell(frame, centerX - to, centerZ - to, centerX + to, centerZ + to, cell, (id, row, x, z, size) => {
      const distance = Math.hypot(x + size / 2 - centerX, z + size / 2 - centerZ);
      if (distance >= from && distance < to) out.push({ id, row, x, z, size, distance, band });
    });
  }
  return out.sort((a, b) => a.distance - b.distance || a.band - b.band || a.row - b.row || a.id - b.id);
}

/**
 * Part de la densité d'une bande retenue à une distance donnée : 1 en plein
 * milieu, fondu linéaire à chacun des deux bords (la somme de deux bandes qui
 * se recouvrent vaut à peu près 1).
 */
export function coverBandFade(distance, band) {
  let fade = 1;
  if (band.fadeIn > 0) fade = Math.min(fade, (distance - band.from) / band.fadeIn);
  if (band.fadeOut > 0) fade = Math.min(fade, (band.to - distance) / band.fadeOut);
  if (fade < 0) return 0;
  return fade > 1 ? 1 : fade;
}

/**
 * Distance d'une maille au véritable observateur.
 *
 * La liste des mailles est dressée autour de l'observateur au début d'une
 * passe. Le fondu, lui, ne doit pas hériter de ce centre figé : entre deux
 * redistributions, une même masse doit occuper le même niveau de
 * détail pour sa distance réelle à l'observateur, pas pour sa place dans une
 * fenêtre discrète devenue périmée.
 */
export function coverBandDistance(centerX, centerZ, cellX, cellZ) {
  return Math.hypot(cellX - centerX, cellZ - centerZ);
}

/**
 * Rétrécissement de la **hauteur**, avec un plancher — contrairement à la
 * densité, elle ne doit jamais tomber à zéro sous peine que la couverture
 * s'éteigne au lieu de s'éclaircir.
 */
export function coverHeightFade(fade, floor) {
  return floor + (1 - floor) * fade;
}

/** Densité corrigée du biais de masse de la bande — voir `spec.massBias`. */
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
