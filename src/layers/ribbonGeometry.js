/*
 * ribbonGeometry — plaquer une bande sur le terrain, le long d'une polyligne.
 * Chaussées, cours d'eau, haies, murs et glissières ont le même problème
 * géométrique ; seules la section et la source des polylignes changent.
 *
 * Trois exigences : plusieurs colonnes en travers (sinon un côté en l'air sur
 * un devers), altitude prise sur la surface affichée (le MNT continu n'est
 * échantillonné que tous les 18 m), lissage longitudinal (le MNT est bruité
 * au mètre, pas une route). Une chaussée y ajoute une quatrième qui remplace
 * la première : dressée de niveau en travers (voir `levelRow`).
 *
 * `appendProfile` généralise le ruban à une section quelconque le long de la
 * même polyligne (haie, muret, glissière, remblai, caténaire). `appendVariableWall`
 * couvre le seul cas restant : une hauteur qui change le long du tracé.
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
 * Moyenne glissante sur l'altitude, colonne par colonne.
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
 * Rend un profil d'altitude monotone vers l'aval (minimum courant dans le
 * sens de la descente) — contrainte physique d'un cours d'eau, meilleure que
 * `smoothColumns` qui peut relever un passage encaissé au-dessus de ses
 * propres berges. Le sens de parcours vient des altitudes des deux
 * extrémités (pas de la numérisation OSM, peu fiable) : on descend depuis la
 * plus haute.
 *
 * @param {Float32Array|number[]} heights Une altitude par ligne du ruban.
 * @returns {Float32Array} profil descendant, même longueur.
 */
export function monotoneDownstream(heights) {
  const n = heights.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  const forward = heights[0] >= heights[n - 1];
  let running = Infinity;
  for (let k = 0; k < n; k++) {
    const r = forward ? k : n - 1 - k;
    const h = heights[r];
    if (Number.isFinite(h) && h < running) running = h;
    out[r] = Number.isFinite(running) ? running : h;
  }
  return out;
}

/**
 * Repères de balayage le long d'une polyligne : tangente unitaire et
 * perpendiculaire à gauche de la marche, dans le plan horizontal. Tangente
 * par différence centrée (une différence avant ferait vibrer la largeur du
 * ruban dans les virages serrés).
 *
 * Retourne `{tx, tz, px, pz}` entrelacés, quatre nombres par ligne.
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
 * Dressée à mi-hauteur de la section (`deck`) : un terrassier équilibre
 * déblai et remblai, donc la route est en partie encaissée en amont (mur qui
 * monte jusqu'au terrain, `furnitureLayer`) et en partie portée en aval (mur
 * qui descend, glissière dessus). Retenir le point haut éviterait le déblai
 * mais mettrait toute la chaussée en surplomb continu — pas fidèle à une
 * route de montagne mi-taillée mi-portée. Le terrain amont qui déborde est
 * donc entaillé (`terrainBubble.setRoadCut`).
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
    // Moyenne des deux rives, pas l'axe (échantillon unique, bruit du MNT).
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
    let deck = 0;
    if (level) {
      if (platform) deck = platform[r];
      else deck = levelRow(path, r, frames, halfWidth, sampleElevation).deck;
    }

    for (let c = 0; c < columns; c++) {
      const u = c / (columns - 1);
      const offset = (u - 0.5) * 2 * halfWidth;
      const x = path[r].x + px * offset;
      const z = path[r].z + pz * offset;
      const index = r * columns + c;
      points[index * 2] = x;
      points[index * 2 + 1] = z;
      heights[index] = (level ? deck : sampleElevation(x, z)) + lift;
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
 * Brique de tout le mobilier linéaire : haie, muret, glissière, mur de
 * soutènement, talus, câble ne diffèrent que par leur section.
 *
 * Section décrite en mètres dans un repère (travers, hauteur) : `across`
 * compte positivement à gauche de la marche, `up` part du sol. Chaque sommet
 * porte sa couleur (dégradé pied/crête sans texture).
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
 *        une valeur par ligne (hauteur qui respire le long du tracé, sans
 *        quoi la section constante se lit comme un tube extrudé).
 * @param {Float32Array|number[]} [options.scaleAcross] Facteur appliqué à
 *        `across`, une valeur par ligne (dilate la section sans déplacer l'axe).
 * @param {Float32Array|number[]} [options.lateralJitter] Décalage de
 *        `offset`, une valeur par ligne, en mètres — déplace l'axe lui-même
 *        (ondule en plan, pas seulement en coupe).
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
    lateralJitter = null,
  }
) {
  const rows = path?.length ?? 0;
  const cols = profile?.length ?? 0;
  if (rows < 2 || cols < 2) return false;

  const frames = pathFrames(path);
  const base = buffer.positions.length / 3;

  // Lissée avant usage, sinon le muret suit le bruit métrique du MNT.
  const ground = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    if (baseHeights) {
      ground[r] = baseHeights[r] + lift;
      continue;
    }
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const off = offset + (lateralJitter ? lateralJitter[r] : 0);
    ground[r] = sampleElevation(path[r].x + px * off, path[r].z + pz * off) + lift;
  }
  smoothColumns(ground, rows, 1, smoothRadius);

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const off = offset + (lateralJitter ? lateralJitter[r] : 0);
    const ax = path[r].x + px * off;
    const az = path[r].z + pz * off;

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

  // Bouchons : une haie coupée net laisserait voir son intérieur.
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
 * Balaie un mur de hauteur variable le long d'une polyligne — ce
 * qu'`appendProfile` (section fixe) ne sait pas faire, alors qu'un mur de
 * soutènement fait deux mètres ici et vingt centimètres cinquante mètres
 * plus loin. Parallélépipède balayé avec une arase débordante (`coping`) qui
 * fait lire « ouvrage » plutôt que « boîte ».
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

  let tallest = 0;
  for (let r = 0; r < rows; r++) tallest = Math.max(tallest, top[r] - base[r]);
  if (tallest < minHeight) return false;

  const frames = pathFrames(path);
  const start = buffer.positions.length / 3;
  const half = thickness / 2;
  // Six sommets par ligne en anneau : pied, arase débordante, dessus, retour.
  const across = [-half, -half - coping, -half - coping, half + coping, half + coping, half];
  const colors = [colorFoot, colorTop, colorTop, colorTop, colorTop, colorFoot];
  const cols = across.length;

  for (let r = 0; r < rows; r++) {
    const px = frames[r * 4 + 2];
    const pz = frames[r * 4 + 3];
    const ax = path[r].x + px * offset;
    const az = path[r].z + pz * offset;
    // Hauteur plancher : évite les faces dégénérées au milieu du balayage.
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

  const lastRow = start + (rows - 1) * cols;
  for (let c = 1; c < cols - 1; c++) {
    buffer.indices.push(start, start + c + 1, start + c);
    buffer.indices.push(lastRow, lastRow + c, lastRow + c + 1);
  }

  return true;
}

/**
 * Convertit un accumulateur de sections en `BufferGeometry` colorée.
 *
 * @param {boolean} [options.flat] Normales par face plutôt que moyennées
 *        (nécessaire pour qu'un tracé facetté, `hedgeGeometry.facetJitter`,
 *        garde ses arêtes visibles ; `false` pour l'ombrage lissé attendu par
 *        muret, glissière, remblai, câble).
 * @returns {Object|null} `null` si rien n'a été accumulé.
 */
export function toColoredGeometry(THREE, buffer, { flat = false } = {}) {
  if (buffer.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
  geometry.setIndex(buffer.indices);
  // `toNonIndexed` duplique les sommets : plus rien à moyenner, donc une normale par face.
  const flattened = flat ? geometry.toNonIndexed() : geometry;
  flattened.computeVertexNormals();
  flattened.computeBoundingSphere();
  return flattened;
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
