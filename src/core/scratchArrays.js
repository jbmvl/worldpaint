/*
 * scratchArrays — tableaux de travail gardés d'une relève à l'autre.
 *
 * Une passe sur une carte de taille fixe (contours de la carte des sols :
 * 1536² texels) prend des dizaines de mégaoctets de tableaux qui ne lui
 * survivent pas. Rendus au ramasse-miettes à chaque relève, ils ne sont pas
 * rendus au système : sous WebKit, l'allocateur garde le plus haut niveau
 * atteint, et la page monte par paliers jusqu'à ce qu'iOS la tue. Gardés ici,
 * ils sont alloués une fois.
 *
 * Un jeu de tableaux ne sert qu'à une passe à la fois : celui qui le possède
 * (une carte, une couche) ne mène jamais deux générations de front.
 */
export class ScratchArrays {
  constructor() {
    this._arrays = new Map();
  }

  /**
   * Tableau de `length` éléments de `Type`, rempli de `fill`, repris tel quel
   * sous `key` s'il a déjà la bonne forme. Son contenu n'est valable que
   * jusqu'au prochain `take` de la même clé.
   */
  take(key, Type, length, fill = 0) {
    const kept = this._arrays.get(key);
    if (kept && kept.constructor === Type && kept.length === length) return kept.fill(fill);
    const array = new Type(length);
    if (fill !== 0) array.fill(fill);
    this._arrays.set(key, array);
    return array;
  }

  /** Rend tous les tableaux (au démontage). */
  clear() {
    this._arrays.clear();
  }
}
