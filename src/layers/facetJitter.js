/*
 * facetJitter — le grain low poly d'une section balayée.
 *
 * Une section balayée à cotes constantes se lit comme un tube extrudé, quelle
 * que soit sa forme. Le remède est le même pour la haie, la falaise du déblai,
 * le mur de soutènement et le talus : chaque cote est tirée **par ligne**, sans
 * corrélation avec la ligne voisine, sur un maillage ombré à plat
 * (`furniture/catalog.FLAT_SHADED_LINEAR_KINDS`). Chaque quadrilatère devient
 * alors deux facettes franches ; l'espacement des arêtes est le pas du tracé.
 *
 * Tirages ancrés au sol (`randomAt`) : un tronçon redécoupé ailleurs garde son
 * grain. Le rang d'un canal fixe son sel — on en ajoute à la fin, on ne les
 * réordonne pas, sans quoi tout le grain est retiré au sort.
 */

import { randomAt } from './furniturePlacement.js';

/**
 * Un tirage uniforme par ligne et par canal, dans l'intervalle du canal.
 *
 * @param {Array<{x:number,z:number}>} path Tracé ; son pas fixe l'espacement des arêtes.
 * @param {number} salt Sel de l'appelant ; le canal de rang `k` tire sur `salt + k`.
 * @param {Record<string, [number, number]>} ranges Intervalle `[bas, haut]` de chaque canal.
 * @returns {Record<string, Float32Array>} un tableau par canal, une valeur par ligne.
 */
export function facetJitter(path, salt, ranges) {
  const rows = path?.length ?? 0;
  const out = {};
  let channel = 0;
  for (const [name, [low, high]] of Object.entries(ranges)) {
    const values = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      values[r] = low + randomAt(path[r].x, path[r].z, salt + channel) * (high - low);
    }
    out[name] = values;
    channel++;
  }
  return out;
}
