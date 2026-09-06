/*
 * build-climate-grid — fabrique la grille climatique embarquée.
 * -------------------------------------------------------------
 * **Script hors ligne.** Il ne fait pas partie du paquet publié (voir
 * `package.json`, champ `files`) et n'est jamais exécuté par le moteur : il
 * tourne une fois, à la main, et son résultat — `src/core/climateGrid.js` — est
 * versionné.
 *
 * Pourquoi une grille embarquée plutôt qu'une requête réseau : le climat est
 * petit, il ne change jamais, et il décide de *quel contenu existe* dans le
 * décor. Une tuile de relief manquante fait un plateau ; un climat manquant
 * ferait un paysage entier tiré dans la mauvaise liste. Voir l'en-tête de
 * `src/core/climate.js`.
 *
 * ## La source
 *
 * Une carte Köppen-Geiger mondiale, en PNG à niveaux de gris, un pixel par
 * cellule, projection équirectangulaire couvrant −180…180 en longitude et
 * 90…−90 en latitude, la valeur du pixel étant le numéro de zone.
 *
 * Celle utilisée pour la grille versionnée est `kmz_int_reshape.png` du paquet
 * Python `kgcpy` (BSD 3-Clause, CWRU SDLE Lab ; Franz Rubel — auteur de la carte
 * elle-même — est co-auteur du paquet), à 100 secondes d'arc :
 *
 *     pip download kgcpy --no-deps -d /tmp/kgc && unzip -o /tmp/kgc/kgcpy-*.whl -d /tmp/kgc
 *     node scripts/build-climate-grid.mjs /tmp/kgc/kgcpy/kmz_int_reshape.png
 *
 * `--numbering` choisit la table de numérotation de la source : c'est la seule
 * chose qui change d'une source à l'autre. `vienna` est celle de kgcpy (1…31
 * puis 32 = océan) ; `beck` est celle des cartes de Beck et al. (CC BY 4.0,
 * 1…30, sans code d'océan — le zéro y tient lieu de « pas de donnée »).
 *
 * ## Ce qui sort
 *
 * Un module ES contenant une chaîne base64 : des paires (valeur, longueur) —
 * un codage par plages, parce qu'une carte climatique est faite de grandes
 * régions homogènes et qu'un tableau brut pèserait vingt fois plus. Les valeurs
 * sont des **indices de `KOPPEN_CODES`** (`src/core/climate.js`), pas les
 * numéros de la source : le format du fichier ne dépend donc pas de la carte
 * d'origine, et changer de source ne change que ce script.
 */

import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

import { KOPPEN_CODES, GRID } from '../src/core/climate.js';

/** Numérotations connues, dans l'ordre des valeurs de pixel (1 = premier). */
const NUMBERINGS = {
  // kgcpy / Rubel : 31 zones puis l'océan.
  vienna: [
    'Af', 'Am', 'As', 'Aw', 'BSh', 'BSk', 'BWh', 'BWk', 'Cfa', 'Cfb', 'Cfc', 'Csa', 'Csb', 'Csc',
    'Cwa', 'Cwb', 'Cwc', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb',
    'Dwc', 'Dwd', 'EF', 'ET', null,
  ],
  // Beck et al. : 30 zones, l'océan n'a pas de code (pixel à zéro).
  beck: [
    'Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa',
    'Cfb', 'Cfc', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc',
    'Dfd', 'ET', 'EF',
  ],
};

/**
 * Décode un PNG à niveaux de gris, 8 bits, non entrelacé — le seul format que
 * ce script ait à lire, et qu'aucune dépendance n'est nécessaire pour ouvrir.
 */
function decodeGreyPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('ce n’est pas un PNG');

  let at = 8;
  let width = 0;
  let height = 0;
  const parts = [];

  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      const interlace = data[12];
      if (depth !== 8 || colour !== 0 || interlace !== 0) {
        throw new Error(`PNG attendu en gris 8 bits non entrelacé (reçu ${depth}/${colour}/${interlace})`);
      }
    } else if (type === 'IDAT') {
      parts.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const pixels = new Uint8Array(width * height);

  // Défiltrage ligne à ligne. Un canal par pixel, donc le voisin de gauche est
  // le pixel précédent : les cinq filtres du format se réduisent à ça.
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    const row = y * width;
    const previous = row - width;
    for (let x = 0; x < width; x++) {
      const value = raw[source + x];
      const left = x > 0 ? pixels[row + x - 1] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft = x > 0 && y > 0 ? pixels[previous + x - 1] : 0;
      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: throw new Error(`filtre PNG inconnu : ${filter}`);
      }
      pixels[row + x] = out & 0xff;
    }
    source += width;
  }

  return { width, height, pixels };
}

/** Valeur majoritaire d'une cellule de sortie, océan exclu. */
function majority(counts) {
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function main() {
  const [source, ...rest] = process.argv.slice(2);
  if (!source) {
    console.error('usage : node scripts/build-climate-grid.mjs <carte.png> [--numbering vienna|beck] [--out fichier]');
    process.exit(1);
  }
  const numberingName = rest.includes('--numbering')
    ? rest[rest.indexOf('--numbering') + 1]
    : 'vienna';
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : 'src/core/climateGrid.js';
  const numbering = NUMBERINGS[numberingName];
  if (!numbering) throw new Error(`numérotation inconnue : ${numberingName}`);

  const { width, height, pixels } = decodeGreyPng(readFileSync(source));
  const perDegreeX = width / 360;
  const perDegreeY = height / 180;

  // Table source → indice de `KOPPEN_CODES`, faite une fois.
  const remap = new Uint8Array(256);
  for (let i = 0; i < numbering.length; i++) {
    const code = numbering[i];
    const index = code ? KOPPEN_CODES.indexOf(code) : -1;
    if (code && index < 0) throw new Error(`code absent de KOPPEN_CODES : ${code}`);
    remap[i + 1] = index < 0 ? 0 : index + 1;
  }

  const values = new Uint8Array(GRID.cols * GRID.rows);
  // Quatre sous-échantillons par axe : la cellule de sortie couvre plusieurs
  // pixels source, et prendre le pixel central ferait basculer une région
  // entière sur un accident local.
  const steps = 4;

  for (let row = 0; row < GRID.rows; row++) {
    const north = GRID.north - row * GRID.step;
    for (let col = 0; col < GRID.cols; col++) {
      const west = GRID.west + col * GRID.step;
      const counts = new Map();
      for (let sy = 0; sy < steps; sy++) {
        const lat = north - ((sy + 0.5) / steps) * GRID.step;
        const y = Math.min(height - 1, Math.max(0, Math.floor((90 - lat) * perDegreeY)));
        for (let sx = 0; sx < steps; sx++) {
          const lng = west + ((sx + 0.5) / steps) * GRID.step;
          const x = Math.min(width - 1, Math.max(0, Math.floor((lng + 180) * perDegreeX)));
          const value = remap[pixels[y * width + x]];
          // L'océan ne vote pas : une cellule côtière doit rendre le climat de
          // sa terre, pas « pas de donnée ».
          if (value === 0) continue;
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
      values[row * GRID.cols + col] = majority(counts);
    }
  }

  // Codage par plages. Les longueurs tiennent sur un octet : au-delà, la plage
  // est coupée en deux, ce qui coûte deux octets tous les 255 et évite un
  // format à taille variable.
  const runs = [];
  let value = values[0];
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value && run < 255) {
      run++;
      continue;
    }
    runs.push(value, run);
    value = values[i];
    run = 1;
  }
  runs.push(value, run);

  const payload = Buffer.from(Uint8Array.from(runs)).toString('base64');
  const classified = values.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

  const file = `/*
 * climateGrid — la grille climatique embarquée. **Fichier généré.**
 * ------------------------------------------------------------------
 * Ne pas modifier à la main : refabriquer avec
 * \`node scripts/build-climate-grid.mjs\`, qui documente la source et la façon
 * de se la procurer.
 *
 * ${GRID.cols} × ${GRID.rows} cellules de ${GRID.step}° couvrant l'Europe
 * (${GRID.west}…${GRID.west + GRID.cols * GRID.step}° de longitude,
 * ${GRID.north - GRID.rows * GRID.step}…${GRID.north}° de latitude), soit
 * ${values.length} cellules dont ${classified} classées, codées par plages
 * (valeur, longueur) puis en base64. Les valeurs sont des indices de
 * \`KOPPEN_CODES\` décalés de un — zéro signifiant « pas de donnée ».
 *
 * ## Provenance et licence
 *
 * Carte source : \`kmz_int_reshape.png\` du paquet Python \`kgcpy\`, dérivée des
 * cartes Köppen-Geiger de Rubel et al. Redistribuée ici sous la licence du
 * paquet, reproduite comme elle l'exige :
 *
 *   BSD 3-Clause License
 *   Copyright (c) 2022, CWRU SDLE LAB
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *
 *   1. Redistributions of source code must retain the above copyright notice,
 *      this list of conditions and the following disclaimer.
 *   2. Redistributions in binary form must reproduce the above copyright
 *      notice, this list of conditions and the following disclaimer in the
 *      documentation and/or other materials provided with the distribution.
 *   3. Neither the name of the copyright holder nor the names of its
 *      contributors may be used to endorse or promote products derived from
 *      this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *   POSSIBILITY OF SUCH DAMAGE.
 */

/** Plages (valeur, longueur) de la grille, en base64. */
export const CLIMATE_GRID_RUNS =
  '${payload}';
`;

  writeFileSync(out, file);
  console.log(
    `${out} — ${values.length} cellules, ${classified} classées, ${runs.length / 2} plages, ` +
      `${(payload.length / 1024).toFixed(1)} ko de base64`
  );
}

main();
