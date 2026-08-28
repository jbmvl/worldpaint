/*
 * aerialLight — la part de lumière qui reste dans l'air.
 * -------------------------------------------------------
 * Le brouillard de la scène ne sait faire qu'une chose : *retirer* du contraste
 * en tirant tout vers une couleur unique, la même dans toutes les directions.
 * C'est faux d'une manière très visible en forêt : l'air chargé ne fait pas que
 * voiler, il **renvoie** vers l'œil une part de la lumière du soleil qui le
 * traverse, et il en renvoie beaucoup plus quand on regarde vers le soleil que
 * quand on lui tourne le dos. C'est ce déséquilibre — pas un objet posé dans la
 * scène — qui donne des faisceaux entre les troncs.
 *
 * Ce module ne dessine rien. Il calcule les trois grandeurs dont un shader a
 * besoin pour ajouter cette part au brouillard **déjà** calculé, et rien de
 * plus :
 *
 *   • combien de lumière reste dans l'air à cette heure (`aerialLightIntensity`) ;
 *   • dans quel repère le motif des faisceaux doit être tiré (`sunBasis`).
 *
 * ## Pourquoi un repère perpendiculaire au soleil
 *
 * Un faisceau, c'est une trouée de canopée **prolongée le long du rayon**. Sa
 * section ne change pas sur toute sa longueur : c'est ce qui le distingue d'une
 * tache. Un motif tiré dans le plan perpendiculaire au soleil est donc, par
 * construction, constant le long de la direction du soleil — il s'étire en
 * colonne sans qu'on ait à intégrer quoi que ce soit le long d'un rayon.
 *
 * C'est le cœur de l'approximation : pas de marche dans le volume, une seule
 * évaluation de bruit, et le motif tourne tout seul avec le soleil au fil de la
 * journée puisque son repère est accroché à lui.
 *
 * ## Ce que la hauteur du soleil décide
 *
 * L'effet est maximal quand le soleil rase et disparaît quand il monte, pour
 * une raison physique : au ras de l'horizon la lumière traverse la couche basse
 * sur une distance bien plus longue, et surtout elle arrive **par le travers**
 * du regard, là où un faisceau se voit. Au zénith, le trajet est court et les
 * colonnes tombent à la verticale, donc dans l'axe du regard : il n'y a rien à
 * voir. Sous l'horizon, il n'y a plus de source du tout.
 *
 * Fonctions pures, donc testables sans navigateur — comme `skyModel` et
 * `shadowFrame`, et pour la même raison : une inversion entre le matin et midi
 * ne se verrait autrement qu'à l'œil, et seulement à la bonne heure.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Transition douce, décroissante quand `edge0 > edge1`. */
function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Intensité de la lumière restée dans l'air, de 0 à `strength`.
 *
 * Trois facteurs, tous nécessaires :
 *
 *   - `low`  : le soleil doit raser. À 0,45 de hauteur (~27°) il n'y a plus
 *              rien ; en dessous de 0,06 (~3,5°) l'effet est plein.
 *   - `up`   : au ras de l'horizon et en dessous, la source s'éteint. Sans ce
 *              facteur, `low` seul rendrait la nuit la plus lumineuse de toutes.
 *   - `sky`  : un ciel bouché n'a plus de disque solaire, donc plus de direction
 *              privilégiée. C'est la même condition que celle qui éteint les
 *              ombres portées, et pour la même raison.
 *
 * @param {Object} options
 * @param {number} options.sunY Composante verticale de la direction du soleil.
 * @param {number} [options.cloudCover] Couverture nuageuse, de 0 à 1.
 * @param {number} [options.strength] Intensité de référence du thème.
 * @returns {number}
 */
export function aerialLightIntensity({ sunY, cloudCover = 0, strength = 1 }) {
  const low = smoothstep(0.45, 0.06, sunY);
  const up = smoothstep(-0.01, 0.09, sunY);
  const sky = 1 - clamp01(cloudCover) * 0.9;
  return Math.max(0, strength) * low * up * sky;
}

/**
 * Deux axes unitaires perpendiculaires au soleil et entre eux.
 *
 * L'axe de référence évite le cas dégénéré du soleil au zénith, où le produit
 * vectoriel avec la verticale s'annule — même précaution que dans
 * `snapToShadowTexels`, et le même piège.
 *
 * @param {{x:number,y:number,z:number}} sunDir Direction *vers* le soleil.
 * @returns {{right:[number,number,number], up:[number,number,number]}}
 */
export function sunBasis(sunDir) {
  const f = normalize(sunDir || { x: 0, y: 1, z: 0 });
  const reference = Math.abs(f.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(reference, f));
  const up = cross(f, right);
  return {
    right: [right.x, right.y, right.z],
    up: [up.x, up.y, up.z],
  };
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
