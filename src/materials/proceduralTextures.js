/*
 * proceduralTextures — les textures qu'on ne télécharge pas.
 * ----------------------------------------------------------
 * Deux besoins que le réseau ne peut pas couvrir :
 *
 * 1. Le **détail de proximité**. Une orthophoto à 1,7 m/px vue depuis 5 m du
 *    sol est grossie une trentaine de fois : il ne reste que des taches
 *    floues. Aucune source d'imagerie ne résoudra ça — la parade classique en
 *    rendu de terrain est de multiplier la photo par une texture de détail à
 *    haute fréquence, qui rend au premier plan un grain crédible sans
 *    prétendre décrire le réel.
 *
 * 2. La **section de route**. Un ruban d'asphalte avec ses bandes et ses
 *    accotements se dessine plus simplement qu'il ne se télécharge.
 *
 * Le bruit est déterministe et cyclique : même graine, même image, et les
 * bords se raccordent, donc la répétition ne montre pas de couture.
 */

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
 * Texture de détail : bruit fractal gris, centré sur 0,5, destinée à être
 * appliquée en multiplication douce sur la couleur du terrain.
 */
export function createDetailCanvas(size = 256, seed = 20260816) {
  const noise = fractalNoise(size, [4, 8, 16, 32, 64], seed);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);

  for (let i = 0; i < noise.length; i++) {
    // Recentre autour de 0,5 et resserre : le détail module, il ne domine pas.
    const value = Math.round(255 * (0.5 + (noise[i] - 0.5) * 0.9));
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Dessine un élément et ses huit copies décalées d'une période.
 *
 * C'est ce qui rend cyclable une texture faite de traits : un brin d'herbe qui
 * dépasse à droite doit réapparaître à gauche, sinon la répétition montre une
 * couture nette tous les deux mètres. Neuf appels au lieu d'un, sur une texture
 * construite une seule fois — le coût est nul et la correction est exacte.
 */
function drawWrapped(ctx, size, draw) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * size, dy * size);
      draw(ctx);
      ctx.restore();
    }
  }
}

/**
 * Ramène la luminance moyenne d'une image à 0,5.
 *
 * Ces textures sont des **modulations**, pas des couleurs : le shader multiplie
 * la photo par leur double. Une moyenne qui ne vaut pas exactement 0,5
 * assombrirait ou éclaircirait tout le terrain, et le réglage se ferait alors
 * en tâtonnant sur la luminosité au lieu de porter sur la matière.
 */
function normalizeMean(ctx, width, height, target = 0.5) {
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const mean = sum / (data.length / 4);
  if (mean <= 0) return;
  const gain = (target * 255) / mean;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * gain);
    data[i + 1] = Math.min(255, data[i + 1] * gain);
    data[i + 2] = Math.min(255, data[i + 2] * gain);
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Texture de sol en couleur, cyclable : herbe ou terre.
 *
 * Le bruit fractal gris qui tenait ce rôle donnait du grain mais aucune
 * matière — à trois mètres, une orthophoto modulée par du gris ressemble à une
 * vitre sale. Ce qui manque de près, ce sont des **objets de taille connue** :
 * des brins, des cailloux. Ils ne prétendent pas décrire le sol réel, ils lui
 * rendent son échelle.
 *
 * Les valeurs sont des facteurs de modulation en espace linéaire, pas des
 * couleurs sRGB : seule compte leur variation relative.
 *
 * @param {'grass'|'soil'} kind
 */
export function createGroundDetailCanvas(kind = 'grass', size = 256, seed = 91711) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const random = makeRandom(seed);

  // Fond : bruit fractal cyclable, teinté selon la matière.
  const noise = fractalNoise(size, [4, 8, 16, 32], seed + 13);
  const image = ctx.createImageData(size, size);
  const palette = {
    soil: { dark: [86, 68, 48], light: [156, 132, 100] },
    // Sous-bois : plus sombre et plus rouge que la terre nue — de la feuille
    // morte, pas du limon.
    forest: { dark: [54, 42, 28], light: [104, 84, 54] },
    grass: { dark: [58, 84, 38], light: [126, 152, 74] },
  }[kind] || { dark: [58, 84, 38], light: [126, 152, 74] };

  for (let i = 0; i < noise.length; i++) {
    const t = noise[i];
    for (let c = 0; c < 3; c++) {
      image.data[i * 4 + c] = palette.dark[c] + (palette.light[c] - palette.dark[c]) * t;
    }
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  if (kind === 'forest') {
    // Feuilles mortes : des taches allongées, orientées au hasard, qui se
    // recouvrent. C'est le recouvrement qui fait la litière — des feuilles
    // isolées donneraient un confetti.
    for (let i = 0; i < 700; i++) {
      const x = random() * size;
      const y = random() * size;
      const long = size * (0.012 + random() * 0.026);
      const angle = random() * Math.PI;
      const warm = random();
      const shade = 60 + random() * 70;
      ctx.fillStyle = `rgb(${Math.round(shade * (1 + warm * 0.35))}, ${Math.round(shade * 0.82)}, ${Math.round(shade * 0.5)})`;
      drawWrapped(ctx, size, (c) => {
        c.save();
        c.translate(x, y);
        c.rotate(angle);
        c.beginPath();
        c.ellipse(0, 0, long, long * 0.42, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      });
    }
  } else if (kind === 'soil') {
    // Cailloux : quelques centaines, de tailles très inégales. Une taille
    // unique se lirait comme un motif.
    for (let i = 0; i < 260; i++) {
      const x = random() * size;
      const y = random() * size;
      const r = size * (0.004 + Math.pow(random(), 3) * 0.022);
      const shade = 120 + random() * 90;
      const angle = random() * Math.PI;
      ctx.fillStyle = `rgb(${Math.round(shade)}, ${Math.round(shade * 0.94)}, ${Math.round(shade * 0.84)})`;
      drawWrapped(ctx, size, (c) => {
        c.save();
        c.translate(x, y);
        c.rotate(angle);
        c.beginPath();
        c.ellipse(0, 0, r, r * (0.6 + random() * 0.4), 0, 0, Math.PI * 2);
        c.fill();
        // Ombre courte du côté opposé : un caillou plat ne se voit pas.
        c.fillStyle = 'rgba(40, 32, 24, 0.35)';
        c.beginPath();
        c.ellipse(r * 0.35, r * 0.35, r * 0.8, r * 0.5, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      });
    }
  } else {
    // Brins : orientés au hasard, groupés en touffes. Une répartition uniforme
    // donnerait un tapis, pas une prairie.
    const clumps = 90;
    for (let t = 0; t < clumps; t++) {
      const cx = random() * size;
      const cy = random() * size;
      const blades = 8 + Math.floor(random() * 10);
      for (let b = 0; b < blades; b++) {
        const x = cx + (random() - 0.5) * size * 0.06;
        const y = cy + (random() - 0.5) * size * 0.06;
        const length = size * (0.012 + random() * 0.022);
        const angle = random() * Math.PI * 2;
        const shade = 70 + random() * 90;
        ctx.strokeStyle = `rgb(${Math.round(shade * 0.62)}, ${Math.round(shade)}, ${Math.round(shade * 0.42)})`;
        ctx.lineWidth = Math.max(1, size * 0.004);
        ctx.lineCap = 'round';
        drawWrapped(ctx, size, (c) => {
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
          c.stroke();
        });
      }
    }
  }

  normalizeMean(ctx, size, size);
  return canvas;
}

/**
 * Carte de normales de rides, cyclable.
 *
 * C'est le reflet qui fait lire une surface comme de l'eau, pas sa couleur : un
 * plan bleu uni ressemble à du plastique peint. Sans réflexion d'environnement,
 * la ride reste le seul moyen de faire accrocher le soleil — d'où une carte de
 * normales plutôt qu'une texture de couleur.
 *
 * Les normales sont dérivées du gradient d'un bruit fractal cyclique, encodées
 * dans la convention habituelle (0,5 = pente nulle, bleu = vers le haut).
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
 * Atlas d'arbres : 3 × 3 silhouettes dans une seule texture.
 *
 * ## Pourquoi neuf et pas quatre
 *
 * Quatre suffisaient à ce qu'un bois ne soit pas un clonage. Elles ne
 * suffisaient pas à ce qu'il y ait **plusieurs sortes de bois** : une pinède,
 * une chênaie, une ripisylve et un taillis ne se distinguent pas par leur
 * densité mais par l'essence qui les compose, et quatre silhouettes tirées au
 * hasard donnaient partout la même forêt mélangée.
 *
 * Les neuf cases sont donc regroupées par **essence** (`TREE_ESSENCES`), et
 * `vegetationLayer` tire d'abord un type de peuplement, puis une silhouette
 * dedans. C'est ce qui fait qu'un versant est en résineux et le fond de vallon
 * en feuillus, au lieu d'un mélange uniforme.
 *
 * L'atlas reste **carré** : le décalage UV est appliqué par le shader avec un
 * seul facteur d'échelle (`foliageMaterial`), et une grille non carrée
 * demanderait deux.
 */
export const TREE_ATLAS_COLS = 3;
export const TREE_ATLAS_ROWS = 3;

/** Décalages UV des neuf cases, dans l'ordre des variantes. */
export const TREE_ATLAS_OFFSETS = (() => {
  const out = [];
  for (let index = 0; index < TREE_ATLAS_COLS * TREE_ATLAS_ROWS; index++) {
    const col = index % TREE_ATLAS_COLS;
    const row = Math.floor(index / TREE_ATLAS_COLS);
    // L'origine des UV est en bas : la première case dessinée en haut du canevas
    // porte donc le plus grand `v`.
    out.push([col / TREE_ATLAS_COLS, (TREE_ATLAS_ROWS - 1 - row) / TREE_ATLAS_ROWS]);
  }
  return out;
})();

/**
 * Houppe de feuillus : des amas de petits disques, pas une boule.
 *
 * Trois choses la font lire comme un arbre plutôt que comme un plot, et elles
 * se voient toutes les trois si on les rate :
 *
 * - la houppe est **découpée** — trois ou quatre masses distinctes qui se
 *   recouvrent partiellement, avec du ciel entre elles. Une houppe pleine est
 *   une boule verte ;
 * - la lumière vient **d'en haut à gauche**, toujours : c'est le gradient qui
 *   donne du volume à une silhouette qui n'en a pas ;
 * - quelques **branches** sortent du tronc dans la houppe. On ne les distingue
 *   pas, mais leur absence se remarque.
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

const TREE_PAINTERS = {
  broadleaf: drawBroadleaf,
  column: drawColumn,
  conifer: drawConifer,
  bushy: drawBushy,
};

/**
 * Atlas de neuf silhouettes d'arbres, fond transparent.
 *
 * La case fait 160 px et non 128 : c'est ce qu'il faut pour qu'une houppe
 * découpée garde ses trous après le filtrage, et l'atlas entier tient encore
 * dans une texture de 480².
 */
export function createTreeAtlasCanvas(cell = 160, seed = 8821, variants = defaultTheme.trees.variants) {
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

    // Tronc d'abord : la houppe le recouvre partiellement, ce qui évite
    // l'aspect « sucette sur un bâton ».
    const trunkWidth = cell * variant.trunk;
    ctx.fillStyle = '#5b4530';
    ctx.fillRect((cell - trunkWidth) / 2, cell * variant.crownBase, trunkWidth, cell * (1 - variant.crownBase));
    // Côté ombré du tronc.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect((cell - trunkWidth) / 2, cell * variant.crownBase, trunkWidth * 0.42, cell * (1 - variant.crownBase));

    (TREE_PAINTERS[variant.kind] || drawBroadleaf)(ctx, cell, random, variant);
    ctx.restore();
  });

  return canvas;
}

/** Couleur CSS depuis trois canaux flottants. */
function rgb(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Touffe d'herbe, pour le tout premier plan.
 *
 * Trois exigences, chacune visible si on la rate :
 *
 * - un brin n'a **pas une épaisseur constante** : il part large et finit en
 *   pointe. Tracé au trait, il se lit comme un fil de fer vert ;
 * - un brin est **plus clair à la pointe** qu'au pied, qui est à l'ombre de la
 *   touffe. Sans ce dégradé, la touffe est une tache plate ;
 * - il en faut **beaucoup** : `alphaTest` supprime tout ce qui est à moitié
 *   transparent, et quatorze brins ne laissent qu'un peigne clairsemé.
 *
 * Les brins sont donc des **surfaces** fuselées remplies d'un dégradé. Le vert
 * reste volontairement
 * moyen : la teinte définitive vient de la couleur d'instance, qui varie d'une
 * touffe à l'autre.
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
 * Atlas des touffes : herbe nue, et trois fleurissements.
 *
 * ## Pourquoi un atlas plutôt qu'une seconde couche
 *
 * Une couche de fleurs séparée voudrait dire un second maillage instancié, un
 * second semis, un second parcours de mailles. Or une fleur ne pousse pas à côté
 * de l'herbe : elle pousse **dedans**. Quatre variantes d'une même touffe, tirées
 * dans un atlas par l'attribut d'instance déjà en place pour les arbres, coûtent
 * exactement zéro appel de rendu de plus.
 *
 * Le partage entre les quatre n'est pas uniforme et ne doit pas l'être : c'est
 * `groundCover` qui choisit, d'après ce que dit la carte de classes — le
 * coquelicot en lisière de culture, la marguerite et le bouton d'or en prairie.
 */
export const GRASS_ATLAS_COLS = 2;
export const GRASS_ATLAS_ROWS = 2;

/** Les quatre variantes, dans l'ordre des cases de l'atlas. */
export const GRASS_VARIANTS = ['plain', 'white', 'yellow', 'poppy'];

/** Décalages UV des quatre cases. */
export const GRASS_ATLAS_OFFSETS = [
  [0, 0.5],
  [0.5, 0.5],
  [0, 0],
  [0.5, 0],
];

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

/** Atlas 2 × 2 des touffes, fond transparent. */
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
    drawGrassTuft(ctx, cell, random);
    if (variant !== 'plain') drawFlowers(ctx, cell, random, variant);
    ctx.restore();
  });

  return canvas;
}

/**
 * Atlas des cultures : blé, maïs, tournesol, chaume.
 *
 * Ce sont des touffes comme l'herbe — panneaux croisés, même matériau, même
 * vent —, mais à l'échelle de la plante : un maïs fait deux mètres cinquante,
 * un blé un mètre, un chaume vingt centimètres. C'est `cropLayer` qui applique
 * la hauteur ; ici on ne dessine que la silhouette.
 */
export const CROP_ATLAS_COLS = 2;
export const CROP_ATLAS_ROWS = 2;

/** Les quatre cultures dessinées, dans l'ordre des cases. */
export const CROP_VARIANTS = ['wheat', 'maize', 'sunflower', 'stubble'];

export const CROP_ATLAS_OFFSETS = [
  [0, 0.5],
  [0.5, 0.5],
  [0, 0],
  [0.5, 0],
];

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

const CROP_PAINTERS = { wheat: drawWheat, maize: drawMaize, sunflower: drawSunflower, stubble: drawStubble };

/** Atlas 2 × 2 des cultures, fond transparent. */
export function createCropAtlasCanvas(cell = 128, seed = 6607) {
  const canvas = createCanvas(cell * CROP_ATLAS_COLS, cell * CROP_ATLAS_ROWS);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';

  CROP_VARIANTS.forEach((variant, index) => {
    const col = index % CROP_ATLAS_COLS;
    const row = Math.floor(index / CROP_ATLAS_COLS);
    ctx.save();
    ctx.translate(col * cell, row * cell);
    CROP_PAINTERS[variant](ctx, cell, makeRandom(seed + index * 1289));
    ctx.restore();
  });

  return canvas;
}

/** Longueur couverte par un cycle vertical de la texture, en mètres. */
export const ROAD_TEXTURE_LENGTH = 12;

/**
 * Section de chaussée, dessinée d'après une description en mètres.
 *
 * La description compte autant que le dessin : c'est **elle** qui fixe la
 * correspondance entre la texture et la largeur du ruban. Une section unique
 * étirée sur toutes les classes de route donnait des accotements de deux
 * mètres sur une autoroute et des pointillés minuscules sur un chemin. Ici la
 * largeur du profil est aussi celle du ruban, donc l'échelle est juste partout.
 *
 * L'axe horizontal traverse la chaussée, l'axe vertical la parcourt — répété
 * tous les `ROAD_TEXTURE_LENGTH` mètres, ce qui produit les pointillés.
 *
 * @param {Object} profile
 * @param {number} profile.width       Largeur totale, accotements compris.
 * @param {number} [profile.shoulder]  Largeur d'un accotement en terre (0 = aucun).
 * @param {boolean} [profile.edgeLines] Lignes de rive continues.
 * @param {boolean} [profile.centerDash] Axe en pointillés.
 * @param {string} [profile.surface]   `asphalt` ou `dirt`.
 * @param {boolean} [profile.ruts]     Deux ornières claires (chemin d'exploitation).
 * @param {string} [profile.tint]      Remplace la couleur de base du revêtement.
 * @param {number} [profile.texture]   Côté horizontal de la texture, en pixels.
 */
export function createRoadCanvas(profile, seed = 4711, roads = defaultTheme.roads) {
  const {
    width: meters,
    shoulder = 0,
    edgeLines = false,
    centerDash = false,
    surface = 'asphalt',
    ruts = false,
    tint = null,
    texture = 128,
  } = profile;

  const width = texture;
  const height = 512;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const random = makeRandom(seed);

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

  // Grain : sans lui, la chaussée est une bande de plastique.
  const grain = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const jitter = (random() - 0.5) * spec.grain;
    grain.data[i] = Math.min(255, Math.max(0, grain.data[i] + jitter));
    grain.data[i + 1] = Math.min(255, Math.max(0, grain.data[i + 1] + jitter));
    grain.data[i + 2] = Math.min(255, Math.max(0, grain.data[i + 2] + jitter));
  }
  ctx.putImageData(grain, 0, 0);

  const edge = Math.max(1, px(0.12));

  if (edgeLines) {
    ctx.fillStyle = 'rgba(233, 231, 222, 0.82)';
    ctx.fillRect(inset + px(0.35), 0, edge, height);
    ctx.fillRect(width - inset - px(0.35) - edge, 0, edge, height);
  }

  // Axe central : 3 m de trait, 3 m de vide sur les 12 m du cycle.
  if (centerDash) {
    const dash = (3 / ROAD_TEXTURE_LENGTH) * height;
    ctx.fillStyle = 'rgba(236, 232, 214, 0.78)';
    const center = width / 2 - edge / 2;
    for (let y = 0; y < height; y += dash * 2) {
      ctx.fillRect(center, y, edge, dash);
    }
  }

  return canvas;
}
