/*
 * ribbonGeometry — plaquer une bande sur le terrain, le long d'une polyligne.
 * ---------------------------------------------------------------------------
 * Chaussées, cours d'eau, haies, murs et glissières ont exactement le même
 * problème géométrique ; seules la section et la source des polylignes changent.
 *
 * Trois exigences, dans l'ordre où elles se voient si on les rate :
 *
 * 1. **Plusieurs colonnes en travers.** Sur un devers, une bande à deux bords
 *    seulement aurait un côté en l'air et l'autre enterré.
 * 2. **L'altitude prise sur la surface affichée**, pas sur le MNT continu : la
 *    maille de terrain ne l'échantillonne que tous les dix-huit mètres.
 * 3. **Un lissage longitudinal.** Le MNT reste bruité à l'échelle du mètre ;
 *    une route ne l'est pas.
 *
 * S'y ajoute une quatrième exigence, qui contredit la première et la remplace :
 * une chaussée est **dressée de niveau en travers**. Un terrassier ne pose pas
 * l'asphalte en suivant le devers naturel du versant, il taille en amont et
 * remblaie en aval. Voir `levelRow` plus bas.
 *
 * `appendProfile` généralise le ruban : au lieu d'une bande plate, il balaie une
 * **section quelconque** le long de la même polyligne. Haie, muret, glissière,
 * remblai et caténaire ne sont que des sections différentes — un seul balayage,
 * une seule tangente, un seul lissage.
 *
 * `appendVariableWall` couvre le seul cas que `appendProfile` ne sait pas
 * traiter : un ouvrage dont la **hauteur change** le long du tracé, ce qu'est
 * tout mur de soutènement.
 */

/**
 * Ré-échantillonne une polyligne métrique à pas constant.
 * @param {Array<{x:number,z:number}>} points
 * @param {number} spacing
 * @returns {Array<{x:number,z:number,distance:number}>}
 */
export function resamplePath(points, spacing) {
  if (!points || points.length < 2 || spacing <= 0) return [];

  const out = [{ x: points[0].x, z: points[0].z, distance: 0 }];
  let carry = 0; // distance déjà parcourue depuis le dernier échantillon posé
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x;
    const az = points[i - 1].z;
    const bx = points[i].x;
    const bz = points[i].z;
    const segment = Math.hypot(bx - ax, bz - az);
    if (segment === 0) continue;

    let offset = spacing - carry;
    while (offset <= segment) {
      const t = offset / segment;
      total += spacing;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, distance: total });
      offset += spacing;
    }
    carry = segment - (offset - spacing);
  }

  return out;
}

/**
 * Moyenne glissante sur l'altitude, colonne par colonne. Exportée pour être
 * testée : une erreur d'indice ici tord la route sans rien casser d'autre.
 *
 * @param {Float32Array|number[]} heights Altitudes, `rows × cols` en ligne d'abord.
 * @param {number} rows
 * @param {number} cols
 * @param {number} [radius] Demi-fenêtre, en échantillons.
 */
export function smoothColumns(heights, rows, cols, radius = 2) {
  if (rows < 2 * radius + 1) return heights;
  const smoothed = new Float32Array(rows * cols);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let sum = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const rr = r + k;
        if (rr < 0 || rr >= rows) continue;
        sum += heights[(rr * cols + c)];
        n++;
      }
      smoothed[r * cols + c] = sum / n;
    }
  }

  for (let i = 0; i < smoothed.length; i++) heights[i] = smoothed[i];
  return heights;
}

/**
 * Repères de balayage le long d'une polyligne : tangente unitaire et
 * perpendiculaire **à gauche de la marche**, dans le plan horizontal.
 *
 * La tangente est prise par différence centrée et non par différence avant :
 * une différence avant ferait vibrer la largeur du ruban dans les virages
 * serrés, là où deux échantillons consécutifs ne sont plus alignés.
 *
 * Fonction pure. Retourne `{tx, tz, px, pz}` entrelacés, quatre nombres par
 * ligne, pour éviter d'allouer un objet par échantillon.
 *
 * @param {Array<{x:number,z:number}>} path
 * @returns {Float64Array} longueur `4 × path.length`.
 */
export function pathFrames(path) {
  const rows = path?.length ?? 0;
  const out = new Float64Array(rows * 4);

  for (let r = 0; r < rows; r++) {
    const prev = path[Math.max(0, r - 1)];
    const next = path[Math.min(rows - 1, r + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    out[r * 4] = tx;
    out[r * 4 + 1] = tz;
    out[r * 4 + 2] = tz; // px
    out[r * 4 + 3] = -tx; // pz
  }
  return out;
}

/**
 * Altitude de la plate-forme d'une chaussée sur une section en travers.
 *
 * La plate-forme est dressée **à mi-hauteur** de la section (`deck`), et c'est
 * la seule position juste : un terrassier équilibre le déblai et le remblai. La
 * route est donc en partie encaissée du côté amont et en partie portée du côté
 * aval, ce qui appelle de chaque côté son ouvrage :
 *
 * - en **amont**, le terrain dépasse la chaussée : c'est le déblai, et il se
 *   tient par un **mur** qui monte de la rive jusqu'au terrain (`furnitureLayer`) ;
 * - en **aval**, la chaussée surplombe le terrain : c'est le remblai, et il se
 *   tient par un mur qui descend de la rive jusqu'au terrain, avec la glissière
 *   posée dessus.
 *
 * Retenir le point haut de la section éviterait au terrain de manger la rive
 * amont, mais poserait toute la chaussée en surplomb sur un remblai continu,
 * alors qu'une route de montagne est mi-taillée mi-portée. Le terrain qui
 * déborde en amont est donc traité pour ce qu'il est — un déblai — et
 * **entaillé** le long de la chaussée (`terrainBubble.setRoadCut`).
 *
 * Fonction pure.
 *
 * @param {Array<{x:number,z:number}>} path
 * @param {number} r          Indice de ligne.
 * @param {Float64Array} frames Repères (`pathFrames`).
 * @param {number} halfWidth
 * @param {Function} sampleElevation `(x, z) => altitude`.
 * @returns {{left:number, right:number, deck:number}} altitudes des deux rives
 *          et de la plate-forme retenue.
 */
export function levelRow(path, r, frames, halfWidth, sampleElevation) {
  const px = frames[r * 4 + 2];
  const pz = frames[r * 4 + 3];
  const { x, z } = path[r];

  const left = sampleElevation(x + px * halfWidth, z + pz * halfWidth);
  const right = sampleElevation(x - px * halfWidth, z - pz * halfWidth);
  return {
    left,
    right,
    // Moyenne des deux rives, et non l'axe : l'axe est un échantillon unique,
    // donc porteur du bruit métrique du MNT, là où la moyenne des rives décrit
    // la section entière.
    deck: (left + right) * 0.5,
  };
}

/** Accumulateur de géométrie : plusieurs rubans finissent dans un seul maillage. */
export function createRibbonBuffer() {
  return { positions: [], uvs: [], indices: [] };
}

/** Accumulateur de sections balayées : positions et couleurs, pas d'UV. */
export function createProfileBuffer() {
  return { positions: [], colors: [], indices: [] };
}

/**
 * Ajoute un ruban à l'accumulateur.
 *
 * @param {Object} buffer          Résultat de `createRibbonBuffer()`.
 * @param {Object} options
 * @param {Array} options.path     Polyligne ré-échantillonnée (`resamplePath`).
 * @param {number} options.halfWidth
 * @param {Function} options.sampleElevation `(x, z) => altitude en mètres`.
 * @param {number} [options.lift]  Décollement au-dessus de la surface.
 * @param {number} [options.textureLength] Mètres couverts par un cycle vertical.
 * @param {number} [options.columns]
 * @param {number} [options.smoothRadius]
 * @param {boolean} [options.flatCrossSection] Met toute une section transversale
 *        à l'altitude la plus basse qu'elle rencontre. C'est ce qu'il faut pour
 *        l'eau : une rivière descend le long de son cours, jamais en travers.
 * @param {boolean} [options.level] Dresse la section de niveau en travers
 *        (`levelRow`). Vrai par défaut : c'est le comportement d'une chaussée.
 * @param {Float32Array} [options.platform] Altitudes de plate-forme déjà
 *        calculées et lissées, une par ligne — évite de refaire l'échantillonnage
 *        quand l'appelant en a besoin par ailleurs (talus, glissières).
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendRibbon(
  buffer,
  {
    path,
    halfWidth,
    sampleElevation,
    lift = 0,
    textureLength = 12,
    columns = 5,
    smoothRadius = 2,
    flatCrossSection = false,
    level = true,
    platform = null,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || columns < 2) return false;

  const base = buffer.positions.length / 3;
  const frames = pathFrames(path);
  const heights = new Float32Array(rows * columns);
  const points = new Float32Array(rows * columns * 2); // x, z entrelacés

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    // Plate-forme dressée de niveau : une seule altitude pour toute la section.
    let deck = 0;
    if (level) {
      if (platform) deck = platform[r];
      else deck = levelRow(path, r, frames, halfWidth, sampleElevation).deck;
    }

    for (let c = 0; c < columns; c++) {
      const u = c / (columns - 1);
      // La première colonne porte l'offset négatif : u = 0 tombe donc à droite.
      // La section de chaussée étant symétrique, le côté est sans conséquence.
      const offset = (u - 0.5) * 2 * halfWidth;
      const x = path[r].x + px * offset;
      const z = path[r].z + pz * offset;
      const index = r * columns + c;
      points[index * 2] = x;
      points[index * 2 + 1] = z;
      heights[index] = (level ? deck : sampleElevation(x, z)) + lift;
    }
  }

  if (flatCrossSection) {
    // Le minimum, pas la moyenne : une surface d'eau posée à la hauteur moyenne
    // de ses berges les recouvrirait.
    for (let r = 0; r < rows; r++) {
      let lowest = Infinity;
      for (let c = 0; c < columns; c++) lowest = Math.min(lowest, heights[r * columns + c]);
      for (let c = 0; c < columns; c++) heights[r * columns + c] = lowest;
    }
  }

  smoothColumns(heights, rows, columns, smoothRadius);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const index = r * columns + c;
      buffer.positions.push(points[index * 2], heights[index], points[index * 2 + 1]);
      buffer.uvs.push(c / (columns - 1), path[r].distance / textureLength);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = base + r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  return true;
}

/**
 * Balaie une section quelconque le long d'une polyligne posée sur le terrain.
 *
 * C'est la brique de tout le mobilier linéaire. Une haie, un muret de pierre
 * sèche, une glissière, un mur de soutènement, un talus de remblai et un câble
 * de ligne haute tension ne diffèrent que par leur section — la tangente, la
 * perpendiculaire, le suivi du sol et le lissage sont les mêmes.
 *
 * La section est décrite en mètres dans un repère (travers, hauteur) attaché à
 * la polyligne : `across` compte positivement **à gauche de la marche**, `up`
 * part du sol. Chaque sommet porte sa couleur, ce qui donne un dégradé le long
 * de la section (pied sombre, crête éclairée) sans texture ni seconde passe.
 *
 * @param {Object} buffer  Résultat de `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.path Polyligne ré-échantillonnée.
 * @param {Array<{across:number, up:number, color:number[]}>} options.profile
 *        Section, dans l'ordre du parcours. Au moins deux sommets.
 * @param {Function} options.sampleElevation `(x, z) => altitude en mètres`.
 * @param {number} [options.offset]  Décalage latéral de l'axe de balayage.
 * @param {number} [options.lift]    Décollement au-dessus du sol.
 * @param {Float32Array} [options.baseHeights] Altitudes imposées, une par ligne
 *        (mobilier posé sur une plate-forme plutôt que sur le terrain nu).
 * @param {boolean} [options.closed] La section est un anneau : on referme le
 *        dernier sommet sur le premier et on bouche les deux extrémités.
 * @param {number} [options.smoothRadius]
 * @param {Float32Array|number[]} [options.scaleUp] Facteur appliqué à `up`,
 *        **une valeur par ligne**. C'est ce qui donne à une haie une hauteur qui
 *        respire le long du tracé : une section rigoureusement constante sur
 *        deux cents mètres est ce qui la fait lire comme un tube extrudé, et
 *        aucune variation de couleur ne rattrape ça. La section garde sa forme,
 *        seule son échelle verticale bouge.
 * @param {Float32Array|number[]} [options.scaleAcross] Facteur appliqué à
 *        `across`, une valeur par ligne. Le pendant en travers du précédent :
 *        une haie épaissit et s'amincit le long de son tracé, et deux flancs
 *        rigoureusement parallèles sont l'autre moitié de la lecture « ruban ».
 *        Il ne déplace pas l'axe, il dilate la section autour de lui.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendProfile(
  buffer,
  {
    path,
    profile,
    sampleElevation,
    offset = 0,
    lift = 0,
    baseHeights = null,
    closed = false,
    smoothRadius = 2,
    scaleUp = null,
    scaleAcross = null,
  }
) {
  const rows = path?.length ?? 0;
  const cols = profile?.length ?? 0;
  if (rows < 2 || cols < 2) return false;

  const frames = pathFrames(path);
  const base = buffer.positions.length / 3;

  // Altitude du pied, ligne par ligne, lissée avant d'être utilisée : sans ça
  // un muret suit le bruit métrique du MNT et ondule comme une chenille.
  const ground = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    if (baseHeights) {
      ground[r] = baseHeights[r] + lift;
      continue;
    }
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    ground[r] = sampleElevation(path[r].x + px * offset, path[r].z + pz * offset) + lift;
  }
  smoothColumns(ground, rows, 1, smoothRadius);

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const ax = path[r].x + px * offset;
    const az = path[r].z + pz * offset;

    const rise = scaleUp ? scaleUp[r] : 1;
    const spread = scaleAcross ? scaleAcross[r] : 1;
    for (let c = 0; c < cols; c++) {
      const p = profile[c];
      const wide = p.across * spread;
      buffer.positions.push(ax + px * wide, ground[r] + p.up * rise, az + pz * wide);
      buffer.colors.push(p.color[0], p.color[1], p.color[2]);
    }
  }

  const span = closed ? cols : cols - 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < span; c++) {
      const c1 = (c + 1) % cols;
      const a = base + r * cols + c;
      const b = base + r * cols + c1;
      const d = base + (r + 1) * cols + c;
      const e = base + (r + 1) * cols + c1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  // Bouchons : une haie coupée net laisse voir son intérieur, ce qui trahit
  // immédiatement le tube. Un éventail sur la section suffit à la fermer.
  if (closed && cols >= 3) {
    const lastRow = base + (rows - 1) * cols;
    for (let c = 1; c < cols - 1; c++) {
      buffer.indices.push(base, base + c + 1, base + c);
      buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
    }
  }

  return true;
}

/**
 * Balaie un mur **de hauteur variable** le long d'une polyligne.
 *
 * `appendProfile` ne sait pas faire : sa section est la même sur toute la
 * longueur. Or c'est exactement ce dont un ouvrage de terrassement a besoin —
 * un mur de soutènement fait deux mètres là où le versant l'exige et vingt
 * centimètres cinquante mètres plus loin. Passer une section fixe donnait le
 * muret qui émerge du talus puis s'y enfonce, ce qui ne ressemble à rien.
 *
 * Le mur est un simple parallélépipède balayé : un pied, une arase, et une
 * arase légèrement débordante quand `coping` est donné — c'est ce couronnement
 * qui fait lire « ouvrage » plutôt que « boîte ».
 *
 * Fonction pure.
 *
 * @param {Object} buffer  Résultat de `createProfileBuffer()`.
 * @param {Object} options
 * @param {Array<{x:number,z:number}>} options.path
 * @param {Float32Array|number[]} options.base Altitude du pied, par ligne.
 * @param {Float32Array|number[]} options.top  Altitude de l'arase, par ligne.
 * @param {number} [options.offset]    Décalage latéral de l'axe du mur.
 * @param {number} [options.thickness] Épaisseur, en mètres.
 * @param {number} [options.coping]    Débord du couronnement, en mètres.
 * @param {number[]} options.colorFoot Couleur du pied, RVB linéaire.
 * @param {number[]} options.colorTop  Couleur de l'arase.
 * @param {number} [options.minHeight] En deçà, la ligne est ignorée.
 * @returns {boolean} vrai si de la géométrie a été produite.
 */
export function appendVariableWall(
  buffer,
  {
    path,
    base,
    top,
    offset = 0,
    thickness = 0.5,
    coping = 0.06,
    colorFoot,
    colorTop,
    minHeight = 0.12,
  }
) {
  const rows = path?.length ?? 0;
  if (rows < 2 || !base || !top) return false;

  // Un mur qui ne fait nulle part sa hauteur minimale n'a pas lieu d'être.
  let tallest = 0;
  for (let r = 0; r < rows; r++) tallest = Math.max(tallest, top[r] - base[r]);
  if (tallest < minHeight) return false;

  const frames = pathFrames(path);
  const start = buffer.positions.length / 3;
  const half = thickness / 2;
  // Six sommets par ligne, parcourus en anneau : pied extérieur, arase
  // extérieure débordante, dessus, arase intérieure débordante, pied intérieur,
  // et retour. Le débord est porté par deux sommets et non par un chanfrein :
  // à cette taille, une arête franche accroche mieux la lumière.
  const across = [-half, -half - coping, -half - coping, half + coping, half + coping, half];
  const colors = [colorFoot, colorTop, colorTop, colorTop, colorTop, colorFoot];
  const cols = across.length;

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const ax = path[r].x + px * offset;
    const az = path[r].z + pz * offset;
    // Hauteur plancher : une ligne à hauteur nulle refermerait le mur sur
    // lui-même et produirait des faces dégénérées au milieu du balayage.
    const foot = base[r];
    const crest = Math.max(top[r], foot + minHeight);
    const ups = [foot, crest - coping, crest, crest, crest - coping, foot];

    for (let c = 0; c < cols; c++) {
      buffer.positions.push(ax + px * across[c], ups[c], az + pz * across[c]);
      buffer.colors.push(colors[c][0], colors[c][1], colors[c][2]);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = start + r * cols + c;
      const b = start + r * cols + c1;
      const d = start + (r + 1) * cols + c;
      const e = start + (r + 1) * cols + c1;
      buffer.indices.push(a, d, b, b, d, e);
    }
  }

  // Bouchons aux deux bouts : un mur coupé net laisse voir son intérieur.
  const lastRow = start + (rows - 1) * cols;
  for (let c = 1; c < cols - 1; c++) {
    buffer.indices.push(start, start + c + 1, start + c);
    buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
  }

  return true;
}

/**
 * Convertit un accumulateur de sections en `BufferGeometry` colorée.
 * @returns {Object|null} `null` si rien n'a été accumulé.
 */
export function toColoredGeometry(THREE, buffer) {
  if (buffer.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
  geometry.setIndex(buffer.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Convertit l'accumulateur en `BufferGeometry`.
 * @returns {Object|null} `null` si rien n'a été accumulé.
 */
export function toGeometry(THREE, buffer) {
  if (buffer.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
  geometry.setIndex(buffer.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
