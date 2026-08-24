/*
 * theme — un thème complet à partir de ce qu'on donne.
 * -----------------------------------------------------
 * Une seule fonction, et une seule règle : **la surcharge se fait par tranche
 * entière**. Passer `{ towns: [...] }` remplace les palettes de bourg et ne
 * touche à rien d'autre ; passer `{ windows: { litShare: 0.6 } }` remplace
 * *toute* la tranche des fenêtres, et les quatre autres valeurs disparaissent.
 *
 * C'est volontaire. Une fusion profonde a l'air commode et coûte cher : elle
 * rend impossible de *retirer* une valeur, elle se comporte différemment sur
 * les tableaux et sur les objets, et elle transforme la lecture d'un thème en
 * enquête. La façon d'en changer une seule est déjà écrite en JavaScript :
 *
 *   resolveTheme({ windows: { ...defaultTheme.windows, litShare: 0.6 } })
 *
 * Le résultat est gelé. Un thème partagé par une dizaine de couches qu'une
 * seule d'entre elles pourrait modifier serait une source de bogues qu'on ne
 * reproduit jamais.
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
    // Une tranche inconnue est presque toujours une faute de frappe, et elle
    // serait autrement parfaitement silencieuse : le décor sortirait avec la
    // direction artistique par défaut, sans que rien ne le signale.
    throw new Error(`resolveTheme: tranche inconnue — ${unknown.join(', ')}`);
  }
  return Object.freeze({ ...defaultTheme, ...theme });
}
