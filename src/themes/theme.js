/*
 * theme — un thème complet à partir de ce qu'on donne.
 *
 * La surcharge se fait par tranche entière (pas de fusion profonde) :
 * `{ windows: { litShare: 0.6 } }` remplace toute la tranche `windows`, pas
 * seulement `litShare`. Pour n'en changer qu'une valeur :
 *   resolveTheme({ windows: { ...defaultTheme.windows, litShare: 0.6 } })
 * Le résultat est gelé.
 */

import { defaultTheme } from './default.js';

/**
 * @param {Object|null} [theme] Tranches à substituer au thème par défaut.
 * @returns {Object} Le thème complet, gelé.
 */
export function resolveTheme(theme = null) {
  if (!theme) return defaultTheme;
  const unknown = Object.keys(theme).filter((k) => !(k in defaultTheme));
  if (unknown.length) {
    // Sinon une faute de frappe passerait silencieusement au thème par défaut.
    throw new Error(`resolveTheme: tranche inconnue — ${unknown.join(', ')}`);
  }
  return Object.freeze({ ...defaultTheme, ...theme });
}
