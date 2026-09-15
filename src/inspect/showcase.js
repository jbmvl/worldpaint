/*
 * showcase — isoler une valeur possible du vocabulaire des régions, plutôt
 * qu'un pays. Un outil de mise au point, comme `objectLabels.js` : le
 * sélecteur de région du panneau demande « à quoi ressemble l'Anjou », celui-
 * ci demande « à quoi ressemble `granite` », sans qu'il faille rouler jusqu'à
 * la région qui l'emploie.
 *
 * `core/regionInterpretation.js` porte déjà le vocabulaire fermé
 * (`VOCABULARIES`) et ce qu'un mot signifie pour le moteur ; ce module n'y
 * ajoute rien, il pioche dans le thème la couleur que chaque mot y prend
 * réellement — la même que celle que verrait qui roule jusqu'au bon pays.
 *
 * Un mot marqué `unsupported` (voir `regionInterpretation.js`) reste dans la
 * liste : c'est le repli qu'il montre, pas un décor inventé pour l'occasion —
 * taire le repli reviendrait à cacher ce qui manque au moteur.
 *
 * Fonctions pures, aucune dépendance à `THREE` : la construction des
 * maillages reste à qui affiche (voir `demo/showcase.js`).
 */

import { VOCABULARIES } from '../core/regionInterpretation.js';
import { defaultTheme } from '../themes/default.js';

/** Les catégories de l'afficheur, dans l'ordre où le panneau les propose. */
export const SHOWCASE_FIELDS = Object.freeze([
  { field: 'matrix', label: 'Terrain' },
  { field: 'stone', label: 'Couleur de pierre' },
  { field: 'building', label: 'Bâti (mur, toit)' },
  { field: 'farming', label: 'Cultures' },
  { field: 'trees', label: 'Arbres' },
]);

/** Un mot dont personne ne s'occupe encore n'a pas de couleur. Gris neutre. */
const FALLBACK_ALBEDO = [0.3, 0.3, 0.3];

function matrixEntries(theme) {
  return Object.entries(VOCABULARIES.matrix).map(([value, def]) => ({
    value,
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'plane',
    albedo: theme.surfaces[def.surface]?.albedo || FALLBACK_ALBEDO,
  }));
}

function stoneEntries(theme) {
  const base = theme.terrain.rockColor || FALLBACK_ALBEDO;
  return Object.entries(VOCABULARIES.stone).map(([value, def]) => {
    const factor = theme.stones[value] || [1, 1, 1];
    return {
      value,
      unsupported: !!def.unsupported,
      note: def.unsupported || null,
      shape: 'block',
      albedo: base.map((c, i) => c * factor[i]),
    };
  });
}

/** Le premier village dont la palette cite ce mot, ou le premier du nuancier à défaut. */
function townFor(theme, word) {
  const matching = theme.towns.filter((palette) => !palette.materials || palette.materials.includes(word));
  return matching[0] || theme.towns[0];
}

function buildingEntries(theme) {
  return Object.entries(VOCABULARIES.building).map(([value, def]) => {
    const palette = townFor(theme, value);
    return {
      value,
      unsupported: !!def.unsupported,
      note: def.unsupported || null,
      shape: 'house',
      // Le vocabulaire ne marque pas mur/toit à part : `_roof` suffit, c'est
      // la même convention que `regions.js` emploie déjà pour les nommer.
      part: value.endsWith('_roof') ? 'roof' : 'wall',
      wall: palette.walls[0],
      roof: palette.roofs[0],
      roofShape: palette.roofShapes[0],
    };
  });
}

function farmingEntries(theme) {
  return Object.entries(VOCABULARIES.farming).map(([value, def]) => ({
    value,
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'plane',
    albedo:
      theme.terrain.cropAlbedo?.[def.crop] ||
      theme.surfaces.farmland?.albedo ||
      FALLBACK_ALBEDO,
  }));
}

function treeEntries() {
  return Object.entries(VOCABULARIES.trees).map(([value, def]) => ({
    value,
    unsupported: !!def.unsupported,
    note: def.unsupported || null,
    shape: 'tree',
    // Nom du bâtisseur isolé de `furnitureKit.js` (`treeBroad`, `treeRound`…) :
    // le même catalogue qui pose un arbre de crête ou d'alignement.
    alignment: def.alignment,
  }));
}

/**
 * Les valeurs possibles d'un champ de région, prêtes à afficher isolément.
 *
 * @param {'matrix'|'stone'|'building'|'farming'|'trees'} field
 * @param {Object} [theme] Direction artistique déjà résolue.
 * @returns {Array<Object>} Une entrée par mot du vocabulaire fermé.
 */
export function showcaseEntries(field, theme = defaultTheme) {
  switch (field) {
    case 'matrix':
      return matrixEntries(theme);
    case 'stone':
      return stoneEntries(theme);
    case 'building':
      return buildingEntries(theme);
    case 'farming':
      return farmingEntries(theme);
    case 'trees':
      return treeEntries();
    default:
      return [];
  }
}
