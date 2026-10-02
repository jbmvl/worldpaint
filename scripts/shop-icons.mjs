#!/usr/bin/env node
/*
 * shop-icons — extrait du paquet `@tabler/icons` (dépendance de développement)
 * les seules icônes que nomme le thème (`SHOPFRONT_ICONS`,
 * `SHOPFRONT_ICON_DEFAULT`), et les écrit dans `src/materials/shopIcons.js`.
 * Le moteur ne charge ainsi ni le paquet entier ni le réseau.
 *
 *   node scripts/shop-icons.mjs
 *
 * À relancer après tout changement de nom d'icône dans le thème.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHOPFRONT_ICONS, SHOPFRONT_ICON_DEFAULT } from '../src/themes/default.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = `${root}node_modules/@tabler/icons/`;
const nodes = JSON.parse(readFileSync(`${pkg}tabler-nodes-outline.json`, 'utf8'));
const { version } = JSON.parse(readFileSync(`${pkg}package.json`, 'utf8'));

const names = [...new Set([...Object.values(SHOPFRONT_ICONS), SHOPFRONT_ICON_DEFAULT])].sort();
const icons = {};
for (const name of names) {
  const icon = nodes[name];
  if (!icon) throw new Error(`Icône Tabler inconnue : ${name}`);
  icons[name] = icon.map(([tag, attrs]) => {
    // Le paquet ne livre que des `path` ; un autre élément casserait `Path2D`.
    if (tag !== 'path') throw new Error(`${name} : élément ${tag} non pris en charge`);
    return attrs.d;
  });
}

const body = Object.entries(icons)
  .map(([name, paths]) => `  '${name}': [\n${paths.map((d) => `    '${d}',`).join('\n')}\n  ],`)
  .join('\n');

writeFileSync(
  `${root}src/materials/shopIcons.js`,
  `/*
 * shopIcons — tracés des pictogrammes d'enseigne, extraits de Tabler Icons
 * ${version} (contour, grille 24 × 24, trait de 2, bouts ronds) par
 * \`scripts/shop-icons.mjs\` : ne pas éditer à la main. Chaque icône est une
 * liste de chemins SVG, que \`LabelAtlas.placeSign\` trace en \`Path2D\`.
 *
 * Tabler Icons — MIT License, Copyright (c) 2020-2026 Paweł Kuna.
 */

export const SHOP_ICON_VIEWBOX = 24;
export const SHOP_ICON_STROKE = 2;

export const SHOP_ICONS = {
${body}
};
`
);
console.log(`${names.length} icônes écrites dans src/materials/shopIcons.js`);
