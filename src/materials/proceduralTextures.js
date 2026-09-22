/*
 * proceduralTextures — les textures qu'on ne télécharge pas : la variation du
 * sol à grande échelle, les rides de l'eau, la section de route et le bord
 * rongé d'un chemin.
 *
 * Bruit déterministe et cyclique : même graine, même image, bords raccordés.
 *
 * ## Les surfaces sont lisses, et c'est une décision
 *
 * Aucune texture de ce fichier ne porte de **matière** : ni motif dessiné, ni
 * grain. Une surface est une couleur, et rien de plus. On y est venu par
 * étapes, en retirant à chaque fois quelque chose qui prétendait faire lire
 * un matériau et n'y arrivait pas :
 *
 * - les **motifs dessinés** (brins, cailloux, feuilles) : un objet peint dans
 *   une texture de quelques mètres passe sous le pixel d'écran à trente
 *   mètres, et il ne reste alors que le pavage de sa période. Son ombre,
 *   peinte, ne suivait pas le soleil ;
 * - une couche de **bruit « de détail »** qui constellait le sol de taches de
 *   1 à 2 m ;
 * - le **grain** lui-même, sur le sol comme sur la chaussée, sous toutes ses
 *   formes successives — période fixe, période calée sur l'écran, spectre
 *   nuageux puis spectre fin.
 *
 * Ce qui doit se voir est un **objet de la scène** — un arbre, une falaise,
 * une bordure de trottoir —, jamais un dessin dans une texture. Ne pas
 * réintroduire de grain ici : la question a été tranchée à l'œil, plusieurs
 * fois, et toujours dans le même sens.
 *
 * Reste `createRoadEdgeCanvas`, qui n'est **pas** une matière : c'est un
 * outil de découpe, jamais vu comme tel, qui ronge le bord d'un chemin de
 * terre.
 */

import { treePrototype, paintTreePrototype } from '../models/treeKit.js';
import { defaultTheme } from '../themes/default.js';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Bruit de valeur cyclique sur une grille `lattice × lattice`, échantillonné
 * en `size × size`. Le repli des indices sur la grille garantit que le bord
 * droit prolonge le bord gauche : la texture se répète sans couture.
 *
 * @returns {Float32Array} valeurs dans [0, 1], longueur size².
 */
export function tileableValueNoise(size, lattice, seed) {
  const random = makeRandom(seed);
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = random();

  const out = new Float32Array(size * size);
  const step = lattice / size;

  for (let y = 0; y < size; y++) {
    const gy = y * step;
    const y0 = Math.floor(gy);
    const fy = smoothstep(gy - y0);
    const y0w = y0 % lattice;
    const y1w = (y0 + 1) % lattice;

    for (let x = 0; x < size; x++) {
      const gx = x * step;
      const x0 = Math.floor(gx);
      const fx = smoothstep(gx - x0);
      const x0w = x0 % lattice;
      const x1w = (x0 + 1) % lattice;

      const a = grid[y0w * lattice + x0w];
      const b = grid[y0w * lattice + x1w];
      const c = grid[y1w * lattice + x0w];
      const d = grid[y1w * lattice + x1w];

      const top = a + (b - a) * fx;
      const bottom = c + (d - c) * fx;
      out[y * size + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/**
 * Somme d'octaves de bruit cyclique, normalisée dans [0, 1].
 * @param {number} size      Côté de la texture.
 * @param {number[]} lattices Tailles de grille (doivent diviser `size`).
 * @param {number} seed
 */
export function fractalNoise(size, lattices, seed) {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;

  lattices.forEach((lattice, index) => {
    const octave = tileableValueNoise(size, lattice, seed + index * 7919);
    for (let i = 0; i < out.length; i++) out[i] += octave[i] * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  });

  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * Étire un champ sur tout l'intervalle [0, 1].
 *
 * Une somme d'octaves est une moyenne : trois octaves n'occupent qu'un quart
 * de l'intervalle. Sans étirement, l'amplitude d'une nappe ne voudrait plus
 * dire ce que son réglage annonce.
 *
 * @param {Float32Array} field Modifié sur place, et rendu.
 */
export function stretchToUnit(field) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  // Un champ constant reste constant : l'étirer serait une division par zéro.
  if (!(span > 1e-6)) return field;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / span;
  return field;
}

/**
 * Nappe très basse fréquence, cyclable, sur toute l'amplitude.
 *
 * Deux emplois dans le shader de terrain, et tous deux la veulent lente :
 * faire dériver la couleur du sol le long d'une parcelle, et choisir la région
 * des deux relevés qui cassent la répétition de texture. Avec des octaves
 * fines, la couleur crépiterait au mètre et les deux relevés se mélangeraient
 * partout — le flou qu'on voulait éviter.
 */
/**
 * Le champ brut derrière `createMacroCanvas`, avant sa mise en image — même
 * taille, même graine par défaut. C'est ce que relit `poolShareAt`
 * (`groundClassMap.js`) pour savoir, côté CPU, où tombent les mêmes flaques
 * que le shader découpe : la texture est faite pour l'écran (huit bits par
 * canal, filtrée, mipmappée), le champ pour un calcul exact.
 */
export function macroNoiseField(size = 128, seed = 40213) {
  return { size, data: stretchToUnit(fractalNoise(size, [1, 2, 4], seed)) };
}

export function createMacroCanvas(size = 128, seed = 40213) {
  const { data: noise } = macroNoiseField(size, seed);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);

  for (let i = 0; i < noise.length; i++) {
    const value = Math.round(255 * noise[i]);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Carte de normales de rides, cyclable. C'est le reflet qui fait lire une
 * surface comme de l'eau (sans réflexion d'environnement, la ride reste le
 * seul moyen de faire accrocher le soleil). Normales dérivées du gradient
 * d'un bruit fractal cyclique, convention habituelle.
 */
export function createWaterNormalCanvas(size = 256, seed = 33107) {
  const height = fractalNoise(size, [8, 16, 32, 64], seed);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);

  // Amplitude modeste : des rides trop marquées donnent une tôle ondulée.
  const strength = 2.6;
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(-dx, -dy, 1);
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Atlas d'arbres : 4 × 4 silhouettes dans une seule texture, regroupées par
 * essence (`TREE_ESSENCES`) — quatre silhouettes suffisaient à casser le
 * clonage, mais donnaient partout la même forêt mélangée. Carré, pour que le
 * shader applique un seul facteur d'échelle (`foliageMaterial`).
 *
 * Les deux dernières cases sont le **tapis** du sous-bois : ronce, buisson
 * bas. Elles ne sont pas des arbres en réduction — c'est justement ce qui
 * manquait au sol d'un bois, où les seules silhouettes basses disponibles
 * étaient des arbustes, c'est-à-dire de petits arbres à tronc.
 *
 * Une case sans variante reste transparente : l'atlas peut grandir avant que
 * le thème le remplisse.
 */
export const TREE_ATLAS_COLS = 4;
export const TREE_ATLAS_ROWS = 4;

/** Décalages UV des seize cases, dans l'ordre des variantes. */
export const TREE_ATLAS_OFFSETS = (() => {
  const out = [];
  for (let index = 0; index < TREE_ATLAS_COLS * TREE_ATLAS_ROWS; index++) {
    const col = index % TREE_ATLAS_COLS;
    const row = Math.floor(index / TREE_ATLAS_COLS);
    // L'origine des UV est en bas.
    out.push([col / TREE_ATLAS_COLS, (TREE_ATLAS_ROWS - 1 - row) / TREE_ATLAS_ROWS]);
  }
  return out;
})();

/**
 * Houppe de feuillus : des amas de petits disques, pas une boule. Trois
 * choses la font lire comme un arbre : la houppe découpée en masses
 * distinctes (pas une boule pleine), la lumière toujours d'en haut à gauche,
 * et quelques branches visibles dans la houppe.
 */
function drawBroadleaf(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const centreY = 0.42;
  const shade = (lift, jitter = 16) => {
    const value = 46 + lift * 74 + random() * jitter;
    return `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
  };

  // Charpentières : trois traits qui montent du tronc dans la houppe.
  ctx.strokeStyle = 'rgba(74, 56, 38, 0.9)';
  ctx.lineWidth = size * 0.022;
  ctx.lineCap = 'round';
  for (const lean of [-0.6, 0, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * variant.crownBase);
    ctx.lineTo(size * (0.5 + lean * spread), size * (centreY + 0.06));
    ctx.stroke();
  }

  // Masses : quatre amas décentrés, chacun fait de petits disques.
  const clumps = 4;
  for (let c = 0; c < clumps; c++) {
    const angle = (c / clumps) * Math.PI * 2 + random();
    const distance = 0.45 + random() * 0.55;
    const mx = 0.5 + Math.cos(angle) * spread * distance;
    const my = centreY + Math.sin(angle) * spread * distance * 0.78;

    for (let i = 0; i < 22; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * spread * 0.52;
      const cx = size * (mx + Math.cos(a) * r);
      const cy = size * (my + Math.sin(a) * r * 0.8);
      // Éclairement : haut et gauche.
      const lift = Math.max(0, 1 - cy / (size * 0.7)) * 0.7 + (1 - cx / size) * 0.3;
      ctx.fillStyle = shade(lift);
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.035 + random() * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Silhouette en fuseau : peuplier, cyprès. Étroite et très verticale. */
function drawColumn(ctx, size, random, variant) {
  const { hue, spread } = variant;
  for (let i = 0; i < 90; i++) {
    const t = random();
    // Fuseau : large au tiers inférieur, pointu en haut.
    const width = spread * Math.sin(Math.pow(t, 0.7) * Math.PI) * (0.85 + random() * 0.3);
    const cx = size * (0.5 + (random() - 0.5) * width * 2);
    const cy = size * (0.94 - t * 0.9);
    const lift = t * 0.75 + (1 - cx / size) * 0.25;
    const value = 42 + lift * 78 + random() * 14;
    ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.028 + random() * 0.03), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Conifère : étages irréguliers, retombants, jamais deux de la même largeur. */
function drawConifer(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const stages = 9;
  for (let s = 0; s < stages; s++) {
    const t = s / (stages - 1);
    const cy = size * (0.9 - t * 0.82);
    const halfWidth = size * spread * (1 - t * 0.82) * (0.78 + random() * 0.44);
    const drop = size * 0.075;
    const lift = t * 0.8 + random() * 0.2;
    const value = 40 + lift * 66 + random() * 12;
    ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.beginPath();
    // Étage retombant : les branches d'un résineux plongent, elles ne sont pas
    // horizontales. C'est ce qui distingue un sapin d'une pile de triangles.
    ctx.moveTo(size * 0.5, cy - size * 0.14);
    ctx.lineTo(size * 0.5 + halfWidth, cy + drop);
    ctx.lineTo(size * 0.5 + halfWidth * 0.4, cy);
    ctx.lineTo(size * 0.5 - halfWidth * 0.4, cy);
    ctx.lineTo(size * 0.5 - halfWidth, cy + drop);
    ctx.closePath();
    ctx.fill();
  }
}

/** Taillis : une masse basse et large, sans tronc dégagé. */
function drawBushy(ctx, size, random, variant) {
  const { hue, spread } = variant;
  for (let i = 0; i < 130; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    const cx = size * (0.5 + Math.cos(a) * spread * r);
    const cy = size * (0.66 + Math.sin(a) * spread * r * 0.62);
    const lift = Math.max(0, 1 - cy / (size * 0.95)) * 0.75 + (1 - cx / size) * 0.25;
    const value = 44 + lift * 72 + random() * 16;
    ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.035 + random() * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Ronce : des cannes qui partent en arc et retombent, feuilles par trois. Elle
 * s'étale plus qu'elle ne monte — c'est le fourré qu'on contourne, celui des
 * lisières et des coupes.
 */
function drawBramble(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const canes = 5 + Math.floor(random() * 3);

  for (let c = 0; c < canes; c++) {
    const dir = c % 2 === 0 ? 1 : -1;
    const reach = spread * (0.9 + random() * 0.6) * dir;
    // L'arc reste sous le bord de la case, feuilles comprises : ce qui dépasse
    // se retrouve au pied de la silhouette voisine de l'atlas.
    const rise = 0.66 + random() * 0.2;
    const steps = 18;
    const atX = (t) => 0.5 + reach * t;
    const atY = (t) => 0.97 - rise * Math.sin(t * Math.PI * 0.86);

    ctx.strokeStyle = 'rgba(88, 66, 50, 0.8)';
    ctx.lineWidth = size * 0.011;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (s === 0) ctx.moveTo(size * atX(t), size * atY(t));
      else ctx.lineTo(size * atX(t), size * atY(t));
    }
    ctx.stroke();

    for (let s = 3; s <= steps; s += 2) {
      const t = s / steps;
      const x = atX(t);
      const y = atY(t);
      const lift = (1 - y) * 0.7 + (1 - x) * 0.3;
      const value = 38 + lift * 70 + random() * 16;
      ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
      // Trois folioles autour du point d'attache.
      for (const angle of [-0.9, 0, 0.9]) {
        const leaf = 0.055 * (0.6 + spread);
        ctx.beginPath();
        ctx.ellipse(
          size * (x + Math.sin(angle) * leaf * 1.2),
          size * (y - Math.cos(angle) * leaf * 0.9),
          size * leaf,
          size * leaf * 0.7,
          angle,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }
}

/**
 * Buisson bas à petites feuilles — houx, buis, ciste : une masse dense et
 * sombre, quelques tiges ligneuses visibles au pied. Il tient le milieu entre
 * la ronce et l'arbuste de `drawBushy`, qui, lui, est un petit arbre.
 */
function drawLowShrub(ctx, size, random, variant) {
  const { hue, spread } = variant;

  ctx.strokeStyle = 'rgba(80, 62, 46, 0.85)';
  ctx.lineWidth = size * 0.014;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.98);
    ctx.lineTo(size * (0.5 + (random() - 0.5) * spread), size * (0.5 + random() * 0.3));
    ctx.stroke();
  }

  for (let i = 0; i < 170; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    const x = 0.5 + Math.cos(a) * spread * r;
    const y = 0.6 + Math.sin(a) * 0.37 * r;
    const lift = (1 - y) * 0.72 + (1 - x) * 0.28;
    const value = 36 + lift * 74 + random() * 14;
    ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.beginPath();
    // Feuille, pas disque : c'est le petit format qui fait la densité.
    ctx.ellipse(size * x, size * y, size * 0.026, size * 0.016, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Ajonc, genêt : un buisson bas et compact, presque une boule d'épines, la
 * fleur jaune qui crève le tapis d'une lande. Plus dense et plus ras que
 * `drawLowShrub` — c'est ce qui doit se lire à cent mètres, pas le détail —
 * et semé de points francs pour la fleur, jamais de disques larges.
 */
function drawGorse(ctx, size, random, variant) {
  const { hue, spread } = variant;

  // La compacité vient de la taille réelle (`heightM`), pas de la case : le
  // panneau se remplit comme les autres, sans quoi il rendrait plus petit
  // que la hauteur qu'on lui donne.
  for (let i = 0; i < 150; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    const x = 0.5 + Math.cos(a) * spread * r;
    const y = 0.64 + Math.sin(a) * spread * r * 0.62;
    const lift = (1 - y) * 0.72 + (1 - x) * 0.28;
    const value = 40 + lift * 74 + random() * 14;
    ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.beginPath();
    ctx.arc(size * x, size * y, size * (0.02 + random() * 0.022), 0, Math.PI * 2);
    ctx.fill();
  }

  // La fleur : un jaune franc, minoritaire, jamais un lavage — l'ajonc fleurit
  // toute l'année, et c'est ce qui le distingue d'une masse verte quelconque.
  ctx.fillStyle = 'rgb(224, 196, 40)';
  const flowers = 10 + Math.floor(random() * 8);
  for (let i = 0; i < flowers; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * spread * 0.9;
    const x = size * (0.5 + Math.cos(a) * r);
    const y = size * (0.64 + Math.sin(a) * r * 0.62);
    ctx.beginPath();
    ctx.arc(x, y, size * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Buisson épineux étalé — le maquis. Plus de vide que de feuille : des
 * branches raides qui finissent en pointe, jamais une masse pleine comme
 * `drawBushy`. C'est le sol qui doit rester visible entre elles.
 */
function drawThornyScrub(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const branches = 9 + Math.floor(random() * 5);

  ctx.strokeStyle = 'rgba(70, 64, 48, 0.75)';
  ctx.lineWidth = size * 0.012;
  for (let b = 0; b < branches; b++) {
    // La première branche reste proche de la verticale : c'est elle qui
    // garantit que le buisson remplit sa case, les autres, jetées de côté,
    // font l'étalement. Aucune ne va au-delà d'un plancher commun, qui la
    // tient à l'intérieur — un seul et même clamp évite de recaler chaque
    // branche à la main selon le tirage.
    const a = b === 0 ? -Math.PI * 0.5 : -Math.PI * 0.5 + (random() - 0.5) * Math.PI * 0.95;
    const reach = b === 0 ? spread * 1.15 : spread * (0.55 + random() * 0.5);
    const x0 = size * 0.5;
    const y0 = size * 0.95;
    // Bornées, quel que soit l'angle tiré : une branche presque horizontale
    // ne doit pas mordre sur la case voisine, ce que le seul tirage de
    // l'angle ne garantit pas.
    const x1 = Math.min(Math.max(x0 + Math.cos(a) * size * reach, size * 0.08), size * 0.92);
    const y1 = Math.max(y0 + Math.sin(a) * size * reach * 1.1, size * 0.2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Une pointe d'épines par branche, clairsemée — jamais une touffe pleine.
    for (let i = 0; i < 5; i++) {
      const t = 0.45 + (i / 4) * 0.55;
      const x = x0 + (x1 - x0) * t + (random() - 0.5) * size * 0.03;
      const y = y0 + (y1 - y0) * t + (random() - 0.5) * size * 0.03;
      const lift = (1 - y / size) * 0.7 + (1 - x / size) * 0.3;
      const value = 42 + lift * 72 + random() * 16;
      ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
      ctx.beginPath();
      ctx.arc(x, y, size * (0.02 + random() * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Fougère : plusieurs frondes qui rayonnent d'un même pied, chacune une tige
 * courbe portée de petites folioles alternées. C'est le rayonnement qui la
 * distingue de `drawBramble` (des cannes qui retombent) — une fougère ne
 * grimpe pas, elle s'ouvre en éventail bas.
 */
function drawFern(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const fronds = 5 + Math.floor(random() * 3);

  for (let f = 0; f < fronds; f++) {
    // La fronde centrale reste verticale et va au bout de sa portée : c'est
    // elle qui garantit que la touffe remplit sa case. Les autres, en
    // éventail, font le rayonnement — bornées pour ne mordre ni le haut ni
    // les côtés voisins, quel que soit leur tirage.
    const guaranteed = f === 0;
    const a = guaranteed
      ? -Math.PI * 0.5
      : -Math.PI * 0.5 + ((f + 0.5) / fronds - 0.5) * Math.PI * 0.8 + (random() - 0.5) * 0.2;
    const reach = guaranteed ? spread * 1.8 : spread * (0.75 + random() * 0.35);
    const steps = 10;
    const at = (t) => ({
      x: Math.min(Math.max(0.5 + Math.cos(a) * reach * t, 0.08), 0.92),
      y: Math.max(0.97 + Math.sin(a) * reach * t * 1.05, 0.18),
    });

    ctx.strokeStyle = 'rgba(60, 78, 44, 0.8)';
    ctx.lineWidth = size * 0.01;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.97);
    for (let s = 1; s <= steps; s++) {
      const { x, y } = at(s / steps);
      ctx.lineTo(size * x, size * y);
    }
    ctx.stroke();

    for (let s = 2; s <= steps; s++) {
      const t = s / steps;
      const { x, y } = at(t);
      const lift = (1 - y) * 0.7 + (1 - x) * 0.3;
      const value = 40 + lift * 70 + random() * 14;
      ctx.fillStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
      // Deux folioles de part et d'autre de la tige, perpendiculaires à elle.
      const perp = a + Math.PI * 0.5;
      const leaf = size * 0.032 * (1 - t * 0.4);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          size * x + Math.cos(perp) * leaf * side,
          size * y + Math.sin(perp) * leaf * side,
          leaf,
          leaf * 0.42,
          perp,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }
}

/**
 * Oyat : une touffe de lames fines et raides, dressées puis retombantes en
 * pointe — la seule silhouette du catalogue sans masse de feuillage, juste
 * des traits. C'est ce qui doit se lire sur un sable presque nu.
 */
function drawMarram(ctx, size, random, variant) {
  const { hue, spread } = variant;
  const blades = 16 + Math.floor(random() * 10);

  for (let i = 0; i < blades; i++) {
    const lean = (random() - 0.5) * spread * 1.6;
    const height = 0.55 + random() * 0.4;
    const x0 = 0.5 + lean * 0.25;
    const y0 = 0.98;
    // Une lame raide qui retombe en pointe : deux segments, pas une courbe.
    const xMid = x0 + lean * 0.6;
    const yMid = y0 - height * 0.7;
    const xTip = x0 + lean;
    const yTip = y0 - height;

    const lift = height * 0.6 + (1 - x0) * 0.2;
    const value = 46 + lift * 70 + random() * 14;
    ctx.strokeStyle = `rgb(${Math.round(value * hue.r)}, ${Math.round(value * hue.g)}, ${Math.round(value * hue.b)})`;
    ctx.lineWidth = size * (0.009 - height * 0.003);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.lineTo(size * xMid, size * yMid);
    ctx.lineTo(size * xTip, size * yTip);
    ctx.stroke();
  }
}

const TREE_PAINTERS = {
  broadleaf: drawBroadleaf,
  column: drawColumn,
  conifer: drawConifer,
  bushy: drawBushy,
  bramble: drawBramble,
  lowShrub: drawLowShrub,
  gorse: drawGorse,
  thornyScrub: drawThornyScrub,
  fern: drawFern,
  marram: drawMarram,
};

/**
 * Atlas des silhouettes, fond transparent, une case par variante du thème.
 *
 * La case fait 160 px et non 128 : c'est ce qu'il faut pour qu'une houppe
 * découpée garde ses trous après le filtrage, et l'atlas entier tient dans une
 * texture de 640².
 */
export function createTreeAtlasCanvas(cell = 160, seed = 8821, variants = defaultTheme.trees.variants, volume = defaultTheme.trees.volume) {
  const width = cell * TREE_ATLAS_COLS;
  const height = cell * TREE_ATLAS_ROWS;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const random = makeRandom(seed);

  variants.forEach((variant, index) => {
    const col = index % TREE_ATLAS_COLS;
    const row = Math.floor(index / TREE_ATLAS_COLS);
    ctx.save();
    ctx.translate(col * cell, row * cell);

    if (index < 9) {
      paintTreePrototype(ctx, cell, treePrototype(variant, index, volume));
      ctx.restore();
      return;
    }
    // Tronc d'abord : la houppe le recouvre partiellement, ce qui évite
    // l'aspect « sucette sur un bâton ».
    const trunkWidth = cell * variant.trunk;
    ctx.fillStyle = '#5b4530';
    ctx.fillRect((cell - trunkWidth) / 2, cell * variant.crownBase, trunkWidth, cell * (1 - variant.crownBase));
    // Côté ombré du tronc.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect((cell - trunkWidth) / 2, cell * variant.crownBase, trunkWidth * 0.42, cell * (1 - variant.crownBase));

    (TREE_PAINTERS[variant.kind] || drawBroadleaf)(ctx, cell, makeRandom(seed + index * 131), variant);
    ctx.restore();
  });

  return canvas;
}

/** Couleur CSS depuis trois canaux flottants. */
function rgb(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Touffe d'herbe, pour le tout premier plan. Un brin n'a pas une épaisseur
 * constante (part large, finit en pointe), est plus clair à la pointe qu'au
 * pied, et il en faut beaucoup (`alphaTest` supprime les brins clairsemés).
 * Vert moyen : la teinte définitive vient de la couleur d'instance.
 */
function drawGrassTuft(ctx, size, random) {
  const blades = 34;
  for (let i = 0; i < blades; i++) {
    // Les brins du bord sont plus courts : une touffe est bombée, pas taillée
    // au carré.
    const baseX = size * (0.1 + random() * 0.8);
    const centred = 1 - Math.abs(baseX / size - 0.5) * 1.5;
    const height = size * (0.3 + random() * 0.62) * (0.55 + centred * 0.45);
    const lean = size * (random() - 0.5) * 0.55;
    const width = size * (0.028 + random() * 0.03);
    const tipX = baseX + lean;
    const tipY = size - height;
    const midX = baseX + lean * 0.3;
    const midY = size - height * 0.62;

    // Pied sombre, pointe claire : c'est ce dégradé qui donne du volume à une
    // silhouette qui n'en a pas.
    const shade = 0.72 + random() * 0.42;
    const gradient = ctx.createLinearGradient(baseX, size, tipX, tipY);
    gradient.addColorStop(0, rgb(46 * shade, 74 * shade, 32 * shade));
    gradient.addColorStop(1, rgb(104 * shade, 148 * shade, 62 * shade));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(baseX - width / 2, size);
    ctx.quadraticCurveTo(midX - width * 0.34, midY, tipX, tipY);
    ctx.quadraticCurveTo(midX + width * 0.34, midY, baseX + width / 2, size);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Décalages UV d'un atlas carré, dans l'ordre de dessin des cases (0 en haut
 * à gauche, puis vers la droite, puis vers le bas). Dérivé plutôt qu'écrit à
 * la main, pour rester d'accord avec un atlas qui change de taille.
 */
export function atlasOffsets(cols, rows) {
  const out = [];
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push([col / cols, 1 - (row + 1) / rows]);
  }
  return out;
}

/**
 * Répète un peintre de silhouette pour en faire une masse (au-delà de 30 m,
 * une touffe représente plusieurs mètres carrés). Rejoue le même peintre
 * plusieurs fois côte à côte plutôt qu'un second jeu à garder d'accord avec
 * le premier ; les sous-touffes se recouvrent largement pour un contour plein.
 */
function drawMass(ctx, size, random, paint, passes = 5, aspect = 1) {
  // La case est carrée, le panneau ne l'est pas : à `aspect` = 3, il sera trois
  // fois plus large que haut, et tout ce qui est peint ici s'y étalera d'autant.
  // On compense en peignant `aspect` fois plus de sous-touffes, chacune
  // resserrée d'autant : la plante retrouve ses proportions une fois étirée.
  const columns = Math.max(1, Math.round(passes * aspect));
  for (let i = 0; i < columns; i++) {
    const spreadX = (0.52 + random() * 0.42) / aspect;
    const spreadY = 0.72 + random() * 0.34;
    // Les sous-touffes sont réparties sur la largeur, avec un flottement : un
    // pas régulier se lirait comme une clôture.
    const center = ((i + 0.5) / columns) * size + (random() - 0.5) * (size * 0.14) / aspect;
    ctx.save();
    // La base reste posée sur y = size après l'échelle, sinon la masse flotte.
    ctx.translate(center - (size * spreadX) / 2, size * (1 - spreadY));
    ctx.scale(spreadX, spreadY);
    paint(ctx, size, random);
    ctx.restore();
  }
}

/**
 * Atlas des touffes : herbe nue, trois fleurissements, et leurs masses. Une
 * fleur pousse dedans l'herbe, pas à côté : quatre variantes tirées dans un
 * atlas par l'attribut d'instance déjà en place pour les arbres, sans appel
 * de rendu supplémentaire (`groundCover` choisit d'après la carte de
 * classes). Les cinq dernières cases sont les mêmes touffes agrégées
 * (`drawMass`) pour les bandes de distance, chaque fleurissement gardant la
 * sienne. `clumpAlt` est une seconde masse d'herbe nue, graine différente
 * (le cas le plus fréquent, pour ne pas se répéter en motif).
 */
export const GRASS_ATLAS_COLS = 3;
export const GRASS_ATLAS_ROWS = 3;

/**
 * Les neuf variantes, dans l'ordre des cases de l'atlas. Les quatre premières
 * sont les touffes de détail, les cinq suivantes leurs masses — `groundCover`
 * passe des unes aux autres par `grassMassVariant`.
 */
export const GRASS_VARIANTS = [
  'plain',
  'white',
  'yellow',
  'poppy',
  'clump',
  'clumpAlt',
  'clumpWhite',
  'clumpYellow',
  'clumpPoppy',
];

/** Décalages UV des neuf cases. */
export const GRASS_ATLAS_OFFSETS = atlasOffsets(GRASS_ATLAS_COLS, GRASS_ATLAS_ROWS);

/** Fleurs par variante : couleur, cœur, nombre, hauteur relative. */
const FLOWER_KINDS = {
  // Marguerites : quelques corolles blanches à cœur jaune, portées haut.
  white: { petal: '#f0efe6', heart: '#e2c25a', count: 7, radius: 0.055, reach: 0.72 },
  // Boutons d'or : plus petits, plus nombreux, plus bas dans la touffe.
  yellow: { petal: '#e8c94a', heart: '#c99f28', count: 9, radius: 0.042, reach: 0.55 },
  // Coquelicots : rares, hauts, et c'est leur rareté qui les fait remarquer.
  poppy: { petal: '#c4433a', heart: '#2a2320', count: 4, radius: 0.062, reach: 0.8 },
};

function drawFlowers(ctx, size, random, kind) {
  const spec = FLOWER_KINDS[kind];
  if (!spec) return;

  for (let i = 0; i < spec.count; i++) {
    const cx = size * (0.14 + random() * 0.72);
    const cy = size * (1 - spec.reach * (0.55 + random() * 0.45));
    const r = size * spec.radius * (0.8 + random() * 0.4);

    // Tige : sans elle, la fleur flotte au-dessus de la touffe.
    ctx.strokeStyle = 'rgb(76, 104, 52)';
    ctx.lineWidth = Math.max(1, size * 0.008);
    ctx.beginPath();
    ctx.moveTo(cx, size);
    ctx.quadraticCurveTo(cx + (random() - 0.5) * size * 0.06, (cy + size) / 2, cx, cy);
    ctx.stroke();

    // Corolle : cinq pétales, pas un disque — un disque se lit comme un point.
    ctx.fillStyle = spec.petal;
    for (let p = 0; p < 5; p++) {
      const angle = (p / 5) * Math.PI * 2 + random() * 0.3;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(angle) * r * 0.55, cy + Math.sin(angle) * r * 0.55, r * 0.6, r * 0.42, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = spec.heart;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Fleurissement porté par une case, ou `null` — le suffixe des masses est
 * retiré, une masse de marguerites reste faite de marguerites.
 */
function grassFlowerKind(variant) {
  if (variant === 'white' || variant === 'clumpWhite') return 'white';
  if (variant === 'yellow' || variant === 'clumpYellow') return 'yellow';
  if (variant === 'poppy' || variant === 'clumpPoppy') return 'poppy';
  return null;
}

/** Atlas 3 × 3 des touffes et de leurs masses, fond transparent. */
export function createGrassAtlasCanvas(cell = 128, seed = 3313) {
  const canvas = createCanvas(cell * GRASS_ATLAS_COLS, cell * GRASS_ATLAS_ROWS);
  const ctx = canvas.getContext('2d');

  GRASS_VARIANTS.forEach((variant, index) => {
    const col = index % GRASS_ATLAS_COLS;
    const row = Math.floor(index / GRASS_ATLAS_COLS);
    ctx.save();
    ctx.translate(col * cell, row * cell);
    // Une graine par case : deux touffes voisines de variantes différentes ne
    // doivent pas être la même touffe repeinte.
    const random = makeRandom(seed + index * 977);
    const flowers = grassFlowerKind(variant);

    if (variant.startsWith('clump')) {
      drawMass(ctx, cell, random, drawGrassTuft);
      // Les fleurs sont posées **après** la masse, à l'échelle de la case : à
      // l'intérieur de chaque sous-touffe elles seraient rétrécies au point de
      // ne plus être qu'un grain de couleur.
      if (flowers) drawFlowers(ctx, cell, random, flowers);
    } else {
      drawGrassTuft(ctx, cell, random);
      if (flowers) drawFlowers(ctx, cell, random, flowers);
    }
    ctx.restore();
  });

  return canvas;
}

/**
 * Atlas des cultures : blé, maïs, tournesol, chaume, lavande, colza. Des
 * touffes comme l'herbe (panneaux croisés, même matériau, même vent), à
 * l'échelle de la plante — `cropLayer` applique la hauteur, ici on ne dessine
 * que la silhouette.
 */
export const CROP_ATLAS_COLS = 4;
export const CROP_ATLAS_ROWS = 4;

/**
 * Les six cultures dessinées, puis leurs masses agrégées (`drawMass`,
 * `cropLayer`), pour rester identifiables à cent mètres. Douze cases pour une
 * grille 4×4 (les quatre dernières restent vides) ; le décalage d'atlas se lit
 * par `CROP_VARIANTS.indexOf`.
 *
 * Sans la lavande et le colza, une plaine de Beauce et un plateau de Sault
 * portent exactement les mêmes champs, et l'assolement du pays ne se voit
 * pas.
 */
export const CROP_VARIANTS = [
  'wheat',
  'maize',
  'sunflower',
  'stubble',
  'lavender',
  'rapeseed',
  'rice',
  'wheatMass',
  'maizeMass',
  'sunflowerMass',
  'stubbleMass',
  'lavenderMass',
  'rapeseedMass',
  'riceMass',
];

export const CROP_ATLAS_OFFSETS = atlasOffsets(CROP_ATLAS_COLS, CROP_ATLAS_ROWS);

/** Blé : des tiges droites serrées, chacune coiffée de son épi. */
function drawWheat(ctx, size, random) {
  for (let i = 0; i < 26; i++) {
    const baseX = size * (0.08 + random() * 0.84);
    const height = size * (0.68 + random() * 0.28);
    const lean = size * (random() - 0.5) * 0.16;
    const tipX = baseX + lean;
    const tipY = size - height;

    ctx.strokeStyle = `rgb(${190 + random() * 30 | 0}, ${168 + random() * 26 | 0}, ${96 + random() * 24 | 0})`;
    ctx.lineWidth = Math.max(1, size * 0.011);
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.4, size - height * 0.6, tipX, tipY);
    ctx.stroke();

    // Épi : un fuseau plus clair, c'est lui qui donne la couleur du champ.
    ctx.fillStyle = `rgb(${218 + random() * 24 | 0}, ${196 + random() * 22 | 0}, ${118 + random() * 26 | 0})`;
    ctx.beginPath();
    ctx.ellipse(tipX, tipY + size * 0.055, size * 0.022, size * 0.075, lean * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Maïs : quelques tiges épaisses et de longues feuilles retombantes. */
function drawMaize(ctx, size, random) {
  for (let i = 0; i < 4; i++) {
    const baseX = size * (0.2 + i * 0.2 + random() * 0.08);
    const height = size * (0.82 + random() * 0.16);

    ctx.strokeStyle = 'rgb(96, 122, 52)';
    ctx.lineWidth = size * 0.028;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.lineTo(baseX + (random() - 0.5) * size * 0.05, size - height);
    ctx.stroke();

    for (let f = 0; f < 5; f++) {
      const y = size - height * (0.25 + f * 0.16);
      const dir = f % 2 === 0 ? 1 : -1;
      const span = size * (0.12 + random() * 0.1) * dir;
      ctx.strokeStyle = `rgb(${104 + random() * 34 | 0}, ${140 + random() * 34 | 0}, ${58 + random() * 22 | 0})`;
      ctx.lineWidth = size * 0.02;
      ctx.beginPath();
      ctx.moveTo(baseX, y);
      ctx.quadraticCurveTo(baseX + span, y - size * 0.05, baseX + span * 1.5, y + size * 0.05);
      ctx.stroke();
    }
  }
}

/** Tournesol : la tige, deux feuilles, et le capitule qui fait tout. */
function drawSunflower(ctx, size, random) {
  for (let i = 0; i < 3; i++) {
    const baseX = size * (0.24 + i * 0.26 + random() * 0.06);
    const height = size * (0.72 + random() * 0.22);
    const headY = size - height;

    ctx.strokeStyle = 'rgb(84, 112, 50)';
    ctx.lineWidth = size * 0.026;
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.lineTo(baseX, headY + size * 0.08);
    ctx.stroke();

    for (const dir of [-1, 1]) {
      ctx.fillStyle = 'rgb(92, 126, 54)';
      ctx.beginPath();
      ctx.ellipse(baseX + dir * size * 0.07, size * (0.62 + random() * 0.14), size * 0.075, size * 0.04, dir * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const r = size * 0.085;
    ctx.fillStyle = '#e6bb3c';
    for (let p = 0; p < 10; p++) {
      const angle = (p / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(baseX + Math.cos(angle) * r * 0.8, headY + size * 0.08 + Math.sin(angle) * r * 0.8, r * 0.5, r * 0.3, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#6b4a26';
    ctx.beginPath();
    ctx.arc(baseX, headY + size * 0.08, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Chaume : ce qui reste après la moisson — des tiges coupées net. */
function drawStubble(ctx, size, random) {
  for (let i = 0; i < 30; i++) {
    const x = size * random();
    const height = size * (0.12 + random() * 0.16);
    ctx.strokeStyle = `rgb(${182 + random() * 34 | 0}, ${162 + random() * 28 | 0}, ${104 + random() * 26 | 0})`;
    ctx.lineWidth = Math.max(1, size * 0.012);
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + (random() - 0.5) * size * 0.04, size - height);
    ctx.stroke();
  }
}

/**
 * Lavande : des touffes en dôme, gris-vert, d'où partent des hampes fines. La
 * couleur du champ tient tout entière aux épis — la touffe seule est un buis.
 */
function drawLavender(ctx, size, random) {
  for (let i = 0; i < 5; i++) {
    const baseX = size * (0.12 + i * 0.19 + random() * 0.05);
    const bush = size * (0.09 + random() * 0.05);

    ctx.fillStyle = `rgb(${100 + random() * 22 | 0}, ${116 + random() * 20 | 0}, ${88 + random() * 18 | 0})`;
    ctx.beginPath();
    ctx.ellipse(baseX, size * 0.88, bush, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let s = 0; s < 7; s++) {
      const x = baseX + (random() - 0.5) * bush * 1.7;
      const lean = (random() - 0.5) * size * 0.09;
      const tip = size * (0.16 + random() * 0.22);

      ctx.strokeStyle = `rgb(${116 + random() * 22 | 0}, ${130 + random() * 20 | 0}, ${92 + random() * 18 | 0})`;
      ctx.lineWidth = Math.max(1, size * 0.006);
      ctx.beginPath();
      ctx.moveTo(x, size * 0.82);
      ctx.quadraticCurveTo(x + lean * 0.5, size * 0.5, x + lean, tip + size * 0.12);
      ctx.stroke();

      ctx.strokeStyle = `rgb(${112 + random() * 34 | 0}, ${92 + random() * 28 | 0}, ${162 + random() * 40 | 0})`;
      ctx.lineWidth = Math.max(1, size * 0.017);
      ctx.beginPath();
      ctx.moveTo(x + lean, tip + size * 0.13);
      ctx.lineTo(x + lean, tip);
      ctx.stroke();
    }
  }
}

/** Colza : des tiges serrées, chacune coiffée d'une grappe jaune. */
function drawRapeseed(ctx, size, random) {
  for (let i = 0; i < 16; i++) {
    const baseX = size * (0.06 + random() * 0.88);
    const height = size * (0.64 + random() * 0.32);
    const lean = size * (random() - 0.5) * 0.12;
    const tipX = baseX + lean;
    const tipY = size - height;

    ctx.strokeStyle = `rgb(${88 + random() * 28 | 0}, ${118 + random() * 28 | 0}, ${56 + random() * 22 | 0})`;
    ctx.lineWidth = Math.max(1, size * 0.01);
    ctx.beginPath();
    ctx.moveTo(baseX, size);
    ctx.quadraticCurveTo(baseX + lean * 0.4, size - height * 0.6, tipX, tipY);
    ctx.stroke();

    // La grappe : quelques fleurs serrées au sommet, et c'est tout ce qu'on voit
    // d'un champ de colza en avril.
    for (let f = 0; f < 5; f++) {
      ctx.fillStyle = `rgb(${228 + random() * 26 | 0}, ${202 + random() * 26 | 0}, ${44 + random() * 38 | 0})`;
      ctx.beginPath();
      ctx.arc(
        tipX + (random() - 0.5) * size * 0.055,
        tipY + random() * size * 0.09,
        size * 0.018,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

/**
 * Riz : des pieds repiqués en petites touffes, bien plus bas qu'un blé et sans
 * épi — c'est le vert soutenu de la feuille, pas une couleur de grain, qui
 * fait la rizière.
 */
function drawRice(ctx, size, random) {
  for (let i = 0; i < 9; i++) {
    const baseX = size * (0.08 + random() * 0.84);
    const baseY = size * (0.97 + random() * 0.03);

    for (let b = 0; b < 6; b++) {
      const height = size * (0.3 + random() * 0.24);
      const lean = size * (random() - 0.5) * 0.2;

      ctx.strokeStyle = `rgb(${64 + random() * 28 | 0}, ${146 + random() * 34 | 0}, ${64 + random() * 26 | 0})`;
      ctx.lineWidth = Math.max(1, size * 0.008);
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(baseX + lean * 0.5, baseY - height * 0.6, baseX + lean, baseY - height);
      ctx.stroke();
    }
  }
}

const CROP_PAINTERS = {
  wheat: drawWheat,
  maize: drawMaize,
  sunflower: drawSunflower,
  stubble: drawStubble,
  lavender: drawLavender,
  rapeseed: drawRapeseed,
  rice: drawRice,
};

/** Nombre de sous-touffes d'une masse, par culture (une case ne contient pas le même nombre de plantes selon la culture). */
const CROP_MASS_PASSES = { wheat: 3, maize: 6, sunflower: 6, stubble: 3, lavender: 4, rapeseed: 3, rice: 4 };

/**
 * Élancement du panneau sur lequel chaque masse sera plaquée : la largeur que
 * `cropLayer` lui donne divisée par sa hauteur, soit
 * `CROP_LOOK[culture].spread × 4 × CROP_MASS_SPREAD`. La masse est peinte
 * resserrée d'autant, pour ressortir droite une fois étirée — sans quoi un
 * capitule de tournesol est une galette et un épi de blé une barre.
 *
 * Ces nombres suivent donc `CROP_LOOK` et `CROP_MASS_SPREAD` : changer l'un
 * sans l'autre remet l'écrasement.
 */
export const CROP_MASS_ASPECT = {
  wheat: 2.8,
  maize: 1.9,
  sunflower: 2.6,
  stubble: 2.8,
  lavender: 3.6,
  rapeseed: 3.1,
  rice: 2.8,
};

/**
 * Atlas 3 × 3 des cultures et de leurs masses, fond transparent.
 *
 * La case est passée de 128 à 256 pixels : une masse resserrée contient deux à
 * trois fois plus de plantes qu'avant, et à 128 pixels un capitule de tournesol
 * n'y faisait plus que deux pixels de large.
 */
export function createCropAtlasCanvas(cell = 256, seed = 6607) {
  const canvas = createCanvas(cell * CROP_ATLAS_COLS, cell * CROP_ATLAS_ROWS);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';

  CROP_VARIANTS.forEach((variant, index) => {
    const col = index % CROP_ATLAS_COLS;
    const row = Math.floor(index / CROP_ATLAS_COLS);
    const base = variant.endsWith('Mass') ? variant.slice(0, -4) : variant;
    ctx.save();
    ctx.translate(col * cell, row * cell);
    const random = makeRandom(seed + index * 1289);
    if (variant.endsWith('Mass')) {
      drawMass(ctx, cell, random, CROP_PAINTERS[base], CROP_MASS_PASSES[base], CROP_MASS_ASPECT[base]);
    } else {
      CROP_PAINTERS[base](ctx, cell, random);
    }
    ctx.restore();
  });

  return canvas;
}

/** Longueur couverte par un cycle vertical de la texture, en mètres. */
export const ROAD_TEXTURE_LENGTH = 12;

/**
 * Hauteur des textures de chaussée, en pixels. Partagée par la section et son
 * masque de bord : les deux se superposent au texel près.
 */
export const ROAD_TEXTURE_ROWS = 512;

/**
 * Section de chaussée, dessinée d'après une description en mètres — la
 * largeur du profil est aussi celle du ruban, donc l'échelle est juste sur
 * toutes les classes de route. Axe horizontal en travers, vertical le long
 * (répété tous les `ROAD_TEXTURE_LENGTH` mètres).
 *
 * Elle n'a plus de graine : elle ne tire plus rien au hasard. Son grain — un
 * bruit par pixel, d'amplitude propre à chaque revêtement — a été retiré avec
 * celui du sol : une surface est une couleur, et une chaussée n'y fait pas
 * exception.
 *
 * **Le marquage n'est plus ici** non plus. Cette texture ne porte que le
 * revêtement, son accotement et ses ornières : les lignes de rive et l'axe sont
 * de la géométrie (`roadMarkings`), posée dans les mêmes morceaux que le
 * ruban. Peintes ici, elles ne pouvaient ni s'arrêter à une bouche de
 * carrefour, ni exister sur la surface d'un carrefour — qui n'a ni milieu ni
 * bords —, ni être posées en travers.
 *
 * @param {Object} profile
 * @param {number} profile.width       Largeur totale, accotements compris.
 * @param {number} [profile.shoulder]  Largeur d'un accotement en terre (0 = aucun).
 * @param {string} [profile.surface]   `asphalt` ou `dirt`.
 * @param {boolean} [profile.ruts]     Deux ornières claires (chemin d'exploitation).
 * @param {string} [profile.tint]      Remplace la couleur de base du revêtement.
 * @param {number} [profile.texture]   Côté horizontal de la texture, en pixels.
 */
export function createRoadCanvas(profile, roads = defaultTheme.roads) {
  const {
    width: meters,
    shoulder = 0,
    surface = 'asphalt',
    ruts = false,
    tint = null,
    texture = 128,
  } = profile;

  const width = texture;
  const height = ROAD_TEXTURE_ROWS;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const px = (m) => (m / meters) * width;
  const spec = roads.surfaces[surface] || roads.surfaces.asphalt;
  const pavement = tint || spec.base;

  // Accotement d'abord, chaussée par-dessus : la terre claire adoucit la
  // jonction avec le terrain, qui serait sinon une arête franche entre
  // asphalte et herbe. Sans accotement, le revêtement occupe toute la largeur.
  ctx.fillStyle = shoulder > 0 ? roads.shoulderColor : pavement;
  ctx.fillRect(0, 0, width, height);
  const inset = px(shoulder);
  if (inset > 0) {
    ctx.fillStyle = pavement;
    ctx.fillRect(inset, 0, width - 2 * inset, height);
  }

  // Ornières d'un chemin d'exploitation : deux bandes tassées, plus claires.
  if (ruts) {
    ctx.fillStyle = 'rgba(168, 156, 128, 0.55)';
    const rut = width * 0.16;
    ctx.fillRect(width * 0.22, 0, rut, height);
    ctx.fillRect(width * 0.62, 0, rut, height);
  }

  return canvas;
}

/**
 * Masque de bord d'un chemin : ce qu'il reste du ruban une fois que le sol l'a
 * rongé. Gris clair là où le chemin tient, noir là où il a cédé ; le matériau
 * le prend en `alphaMap` et tranche au seuil, donc rien n'est fondu — un texel
 * est du chemin ou du terrain.
 *
 * Un chemin de terre n'a pas de rive. Sa largeur est celle que les pas et les
 * roues ont tassée, et elle varie d'un mètre à l'autre : l'herbe remonte par
 * plaques, la terre déborde ailleurs. Le ruban, lui, est une bande d'exactement
 * `width` mètres, à bords droits — c'est cette droite-là que le masque mange.
 *
 * Ce qui ronge n'est pas une dent de scie mais un **bruit**, comparé à la
 * distance au bord : près de la rive presque tout tombe, un peu plus loin
 * presque rien, et entre les deux il reste des îlots détachés et des morsures.
 * C'est la forme d'un bord repris par la végétation, pas celle d'un tracé
 * découpé.
 *
 * Le masque est porté par une image à part, et **pas** par l'alpha de la
 * section : un canevas prémultiplie ses canaux, et un texel transparent y
 * perdrait sa couleur, que le filtrage étalerait ensuite en liseré noir tout
 * le long du chemin.
 *
 * Cyclique en hauteur comme la section, qu'il double au texel près. Le bout
 * libre d'un chemin relit le même masque en travers (`roadNetwork.gnawTips`).
 *
 * @param {Object} profile
 * @param {number} profile.width     Largeur du ruban, en mètres.
 * @param {number} profile.ragged    Profondeur rongée depuis chaque bord, en mètres.
 * @param {number} [profile.texture] Côté horizontal, en pixels.
 */
export function createRoadEdgeCanvas({ width: meters, ragged, texture = 64 }, seed = 20731) {
  const width = texture;
  const height = ROAD_TEXTURE_ROWS;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);

  // Deux octaves : le premier fait les plaques, le second leur donne un bord
  // irrégulier. Un octave seul rendrait des taches toutes de la même taille,
  // posées sur la grille de sa maille.
  const field = fractalNoise(height, [64, 128], seed);
  // Profondeur rongée, en pixels, et jamais moins d'un : un masque sans un
  // seul texel de jeu ne rongerait rien.
  const depth = Math.max(1, (ragged / meters) * width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, width - 1 - x) + 0.5;
      // Le champ est lu à l'endroit d'un côté, à l'envers de l'autre : les deux
      // bords d'un même chemin ne doivent pas se répondre.
      const noise = x * 2 < width ? field[y * height + x] : field[y * height + (height - 1 - x)];
      const value = noise < Math.min(1, edge / depth) ? 255 : 0;
      const i = (y * width + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}
