/* Description des arbres plantés : les familles de mobilier gardent la
 * décision de placement ; l'arbre vient du thème. Le compositeur transmet ces
 * descriptions au rendu commun des arbres et du sous-bois.
 *
 * Un arbre planté porte son essence (`species`, un mot de `region.trees`) ou,
 * quand c'est l'usage qui le choisit et non le pays, sa plantation
 * (`plantation`, l'arbre d'un verger). L'essence se lit dans la même table
 * que la forêt (`theme.trees.species`), sur sa première silhouette : un
 * alignement est planté le même jour, et une silhouette par essence borne les
 * maillages d'un bloc au nombre d'essences du pays.
 */
import { randomAt } from '../core/groundSeed.js';
import { sharesFor } from '../core/regionInterpretation.js';

/**
 * Parts des essences à planter dans un pays, par rang (`sharesFor`) : celles
 * que le thème décrit, ou `trees.defaultSpecies` si le pays n'en nomme aucune.
 * Fonction pure ; elle alloue.
 *
 * @param {string[]|null} words Essences du pays (`region.trees`).
 * @param {Object} trees Tranche `theme.trees`.
 */
export function plantedSpeciesShares(words, trees) {
  const known = (list) => (Array.isArray(list) ? list.filter((word) => trees.species?.[word]) : []);
  const own = known(words);
  return sharesFor(own.length ? own : known(trees.defaultSpecies));
}

/**
 * Les essences plantées en ville : celles que le pays y plante (`region.planted`
 * — palmier et pin parasol d'un front de mer), sinon celles de ses bois. Les
 * alignements de campagne, eux, gardent les essences des bois. Pure.
 */
export function townSpeciesWords(region) {
  return region?.planted?.length ? region.planted : region?.trees ?? null;
}

/** Distance à la mer en deçà de laquelle un arbre de ville est un palmier, en mètres. */
export const SEAFRONT_PALM_M = 250;

/**
 * Front de mer : les arbres de ville (`town`) à moins de `SEAFRONT_PALM_M` de
 * la mer deviennent des palmiers, dans un pays qui en plante. Ni l'arbre isolé
 * des champs ni l'alignement de campagne : le palmier est un arbre
 * d'agrément. Écrit dans les placements ; rend le nombre d'arbres changés.
 *
 * @param {Array} list Placements `PLANTED_TREE`.
 * @param {Object|null} region
 * @param {() => ((x:number, z:number) => boolean)} nearSeaLazy Le test de
 *        proximité, construit seulement s'il y a un arbre à juger.
 */
export function seafrontPalms(list, region, nearSeaLazy) {
  if (!townSpeciesWords(region)?.includes('palm')) return 0;
  let near = null;
  let changed = 0;
  for (const p of list) {
    if (!p.town || p.species === 'palm') continue;
    near ??= nearSeaLazy();
    if (near(p.x, p.z)) {
      p.species = 'palm';
      changed++;
    }
  }
  return changed;
}

export function plantedTree(frame, p, trees) {
  const look = p.plantation ? trees.plantations?.[p.plantation] : speciesLook(trees.species?.[p.species]);
  if (!look) return null;
  const draw = salt => randomAt(frame, p.x, p.z, salt);
  const variant = look.variants[Math.floor(draw(1201) * look.variants.length)];
  const shade = .88 + draw(1213) * .24;
  return { x: p.x, y: p.y, z: p.z, variant,
    height: look.height * p.scale * (.9 + draw(1207) * .2),
    aspect: look.aspect * (.9 + draw(1211) * .2),
    rotation: draw(1217) * Math.PI * 2,
    color: [shade, shade, shade] };
}

const speciesLooks = new WeakMap();

/** L'arbre planté d'une essence, une fois par entrée du thème. */
function speciesLook(entry) {
  if (!entry?.planted) return null;
  let look = speciesLooks.get(entry);
  if (!look) speciesLooks.set(entry, (look = { variants: [entry.variants[0]], height: entry.planted.height, aspect: entry.planted.aspect }));
  return look;
}
