/*
 * labelAtlas — le nom d'un lieu, peint sur une texture plutôt que sculpté.
 * -------------------------------------------------------------------------
 * Deux endroits du décor portent désormais un vrai nom : le panneau d'entrée
 * d'agglomération (`furnitureLayer`) et l'enseigne d'une devanture de commerce
 * (`buildingLayer`). Aucun des deux ne peut le faire avec les outils
 * habituels du mobilier (`Kit`, en `src/layers/furnitureKit.js`) : un panneau
 * de signalisation est une géométrie **partagée** entre toutes ses instances
 * (voir l'en-tête de `furnitureKit.js`, §2 — c'est ce qui autorise
 * l'instanciation), et un texte, par nature, diffère d'une instance à
 * l'autre. Il faut donc un texte par **texture**, pas par sommet.
 *
 * D'où ce module : un atlas — un seul canvas, réparti en étagères au fur et à
 * mesure des demandes (`LabelAtlas.place`) — plutôt qu'une texture par nom.
 * Deux vrais sites d'appel le justifient (voir `CONTRIBUTING.md` sur
 * l'abstraction prématurée) ; un canvas par enseigne en ferait autant de
 * matériaux et autant d'appels de dessin qu'il y a de commerces à l'écran, ce
 * que le reste du moteur se refuse déjà (voir les plafonds `WINDOW_MAX_COUNT`,
 * `PANE_MAX_COUNT` de `buildingLayer.js`).
 *
 * Le fond de l'atlas reste transparent : seul l'encre du texte y est peinte.
 * La texture se pose donc **par-dessus** une géométrie déjà colorée (le
 * panneau blanc du signPlaceName, le bandeau de devanture), qui reste visible
 * tout autour — pas de fond à assortir, pas de bord à cacher.
 */

/** Police du texte peint : une chasse étroite aide à tenir un nom de ville
 *  large sur un panneau étroit ; le repli générique reste lisible partout où
 *  elle manque. */
export const LABEL_FONT_FAMILY = "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
/** Graisse du texte : gras partout, comme la lettre peinte d'une vraie enseigne. */
export const LABEL_FONT_WEIGHT = 700;
/** Interlettrage cible, en part de la taille de fonte — négatif, donc resserré. */
export const LABEL_LETTER_SPACING_RATIO = -0.03;
/** Marge autour du texte dans sa case d'atlas, en pixels. */
export const LABEL_PADDING_PX = 6;
/** Hauteur de ligne en part de la taille de fonte — laisse la place aux jambages. */
export const LABEL_LINE_HEIGHT_RATIO = 1.3;
/** Assise de la ligne de base dans sa case, en part de la taille de fonte. */
export const LABEL_BASELINE_RATIO = 0.78;
/**
 * Résolution interne de l'atlas, en pixels par mètre du monde.
 *
 * C'est la seule règle de conversion entre les deux univers de ce module —
 * les pixels du canvas, où `fitLabelText` choisit une taille de fonte, et les
 * mètres du monde, où le panneau final est posé. Elle est partagée entre les
 * deux sites d'appel (`furnitureLayer`, `buildingLayer`) : chacun choisit sa
 * largeur et sa fonte nominale en mètres, les convertit en pixels avec cette
 * même constante, et reconvertit la case obtenue dans l'autre sens — un seul
 * chiffre, aucun risque que les deux passes divergent.
 */
export const LABEL_PX_PER_M = 120;

/**
 * Taille de fonte qui donne une case de cette hauteur, padding et hauteur de
 * ligne compris.
 *
 * L'inverse de ce que fait `LabelAtlas.place` en interne pour calculer
 * `cellH` — nécessaire parce qu'un appelant raisonne en hauteur disponible
 * (celle du panneau ou du bandeau qui porte le texte), jamais en taille de
 * fonte : lui faire refaire ce calcul à la main désynchroniserait tôt ou tard
 * les deux formules. Fonction pure.
 *
 * @param {number} cellHeightPx Hauteur de case visée, en pixels.
 * @returns {number} Taille de fonte, en pixels.
 */
export function labelFontPxForCellHeight(cellHeightPx) {
  return Math.max(1, (cellHeightPx - LABEL_PADDING_PX * 2) / LABEL_LINE_HEIGHT_RATIO);
}

/**
 * Choisit la plus grande taille de fonte qui tient dans une largeur donnée,
 * avec un interlettrage négatif proportionnel à cette taille.
 *
 * Fonction pure : `measure(text, fontPx)` est injectée plutôt qu'appelée sur
 * un vrai canvas, ce qui la rend testable sous Node — voir `LabelAtlas.place`
 * pour l'appelant réel, qui branche `ctx.measureText`.
 *
 * La recherche descend pixel par pixel plutôt que par dichotomie : l'écart
 * entre `minFontPx` et `maxFontPx` reste toujours petit (quelques dizaines de
 * pixels, jamais un texte de studio de cinéma), et un nom ne se mesure
 * qu'une fois par reconstruction où il apparaît pour la première fois — voir
 * le cache de `LabelAtlas.place`.
 *
 * @param {Object} options
 * @param {string} options.text
 * @param {number} options.maxWidthPx Largeur disponible, en pixels.
 * @param {number} options.maxFontPx  Taille nominale — la plus grande qu'on
 *        essaiera, avant tout resserrement pour tenir dans la largeur.
 * @param {number} [options.minFontPx] Plancher : en dessous, le texte
 *        déborde plutôt que de devenir illisible.
 * @param {number} [options.letterSpacingRatio]
 * @param {(text:string, fontPx:number) => number} options.measure Largeur du
 *        texte **sans** interlettrage, à une taille de fonte donnée.
 * @returns {{fontPx:number, letterSpacingPx:number, widthPx:number}|null}
 *          `null` si `text` est vide.
 */
export function fitLabelText({
  text,
  maxWidthPx,
  maxFontPx,
  minFontPx = 10,
  letterSpacingRatio = LABEL_LETTER_SPACING_RATIO,
  measure,
}) {
  if (!text) return null;
  const widthAt = (fontPx) => {
    const spacing = fontPx * letterSpacingRatio;
    return { width: measure(text, fontPx) + spacing * Math.max(0, text.length - 1), spacing };
  };

  let fontPx = Math.max(minFontPx, maxFontPx);
  let fit = widthAt(fontPx);
  while (fontPx > minFontPx && fit.width > maxWidthPx) {
    fontPx -= 1;
    fit = widthAt(fontPx);
  }

  return { fontPx, letterSpacingPx: fit.spacing, widthPx: Math.max(fit.width, 1) };
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * Peint `text` avec un interlettrage donné, glyphe par glyphe.
 *
 * `CanvasRenderingContext2D.letterSpacing` existe dans les navigateurs
 * récents et suffirait seule, mais glyphe par glyphe fonctionne partout où
 * `fillText` et `measureText` existent — c'est aussi ce que `fitLabelText`
 * mesure déjà côté appelant, donc les deux passes restent cohérentes l'une
 * avec l'autre par construction.
 */
function drawSpacedText(ctx, text, x, y, letterSpacingPx) {
  let cursor = x;
  for (const glyph of text) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + letterSpacingPx;
  }
}

/**
 * Pousse un panneau texturé vertical entre deux points au sol, dans un
 * accumulateur `{positions, uvs}`.
 *
 * C'est l'équivalent de `pushPanel` (`buildingLayer.js`) pour une géométrie
 * qui porte une texture au lieu d'une couleur de sommet — sans normale : rien
 * de ce qui porte un nom peint n'est éclairé (voir l'en-tête du fichier), et
 * un matériau non éclairé n'en lit aucune. `a` et `b` sont déjà au bon
 * endroit dans le monde — décollement du mur, décalage sur le panneau —,
 * l'appelant en décide, exactement comme pour `pushPanel`.
 *
 * L'enroulement est le même que celui de `pushPanel` : le plan (x, z) de la
 * scène est de chiralité opposée au plan (x, y) usuel, et cet ordre-là est
 * celui qui regarde vers l'extérieur.
 *
 * `a` est le côté **droit** du texte pour qui regarde le panneau de face, `b`
 * son côté **gauche** — inversé par rapport à l'intuition, mais c'est ce
 * qu'impose la même chiralité que `pushPanel` : dans les deux appelants
 * (`buildingLayer.appendShopfront`, `furnitureLayer._applyLabels`), le point
 * qui regarde vers la droite du lecteur est aussi celui dont l'enroulement
 * doit porter la fin du texte. Se tromper dans ce sens **inverse le texte**
 * (lu de droite à gauche) sans forcément le rendre invisible, ce qui l'a
 * longtemps laissé passer inaperçu — voir le commit qui a introduit cette
 * note pour le repère complet.
 *
 * @param {{positions:number[], uvs:number[]}} buffer
 * @param {{x:number, y:number}} a Coin bas, côté droit du texte.
 * @param {{x:number, y:number}} b Coin bas, côté gauche du texte.
 * @param {number} bottom Cote basse, dans le monde.
 * @param {number} top    Cote haute, dans le monde.
 * @param {{u0:number,v0:number,u1:number,v1:number}} uv Case d'atlas.
 */
export function pushLabelQuad(buffer, a, b, bottom, top, uv) {
  const { u0, v0, u1, v1 } = uv;
  // u1 (fin du texte) sur `a` (droite), u0 (début) sur `b` (gauche) : voir la
  // note ci-dessus.
  const verts = [
    [a.x, bottom, a.y, u1, v1],
    [b.x, top, b.y, u0, v0],
    [b.x, bottom, b.y, u0, v1],
    [a.x, bottom, a.y, u1, v1],
    [a.x, top, a.y, u1, v0],
    [b.x, top, b.y, u0, v0],
  ];
  for (const [x, y, z, u, v] of verts) {
    buffer.positions.push(x, y, z);
    buffer.uvs.push(u, v);
  }
}

/**
 * Atlas de texte : un canvas, réparti en étagères au fil des demandes.
 *
 * `place(text, …)` rend un nom **une fois** (mémorisé par `text` + réglages)
 * et rend les coordonnées UV de sa case ; `reset()` vide les étagères en
 * début de reconstruction — la géométrie qui référence l'atlas est de toute
 * façon intégralement refaite au même moment (voir `buildingLayer._build` et
 * `furnitureLayer.rebuild`), donc les cases d'hier n'ont plus de lecteur.
 *
 * Rien ici n'est testable sous Node — `createCanvas` retombe sur
 * `document.createElement`, absent hors navigateur, exactement comme
 * `GroundClassMap` (`src/terrain/groundClassMap.js`). C'est `fitLabelText`,
 * pur, qui porte la couverture de test de la mise en page du texte.
 */
export class LabelAtlas {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {number} [options.width]
   * @param {number} [options.height]
   */
  constructor({ THREE, width = 1024, height = 512 } = {}) {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    // Un nom peint est une couleur d'auteur, comme le gazon ou l'asphalte —
    // voir `groundCover.js`, `roadNetwork.js` : même conversion sRGB.
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Repère direct plutôt que celui, retourné, de three : voir
    // `groundClassMap.js` sur la raison, ici sans conséquence géographique
    // mais gardée pour que les deux passes de coordonnées (mesure, pose du
    // panneau) s'accordent sans y repenser.
    this.texture.flipY = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this._cache = new Map();
    this._cursorX = 0;
    this._cursorY = 0;
    this._rowHeight = 0;
    this._dirty = false;
  }

  /** Vide les étagères avant une reconstruction — voir l'en-tête de la classe. */
  reset() {
    this._cache.clear();
    this._cursorX = 0;
    this._cursorY = 0;
    this._rowHeight = 0;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this._dirty = false;
  }

  /**
   * Rend `text`, ou retrouve sa case si déjà posée cette reconstruction.
   *
   * @param {string} text
   * @param {Object} options
   * @param {number} options.maxWidthPx Largeur disponible pour ce texte, en
   *        pixels — propre à l'appelant (un panneau d'entrée n'a pas la même
   *        largeur qu'une devanture).
   * @param {number} options.maxFontPx
   * @param {number} [options.minFontPx]
   * @param {string} [options.color] Couleur CSS de l'encre.
   * @returns {{u0:number,v0:number,u1:number,v1:number,widthPx:number,heightPx:number}|null}
   *          `null` si `text` est vide ou si l'atlas est plein — l'appelant
   *          garde alors son support (panneau, bandeau) sans texte, plutôt
   *          que d'échouer.
   */
  place(text, { maxWidthPx, maxFontPx, minFontPx = 10, color = '#1c1c1c' } = {}) {
    if (!text) return null;
    const key = `${text} ${maxWidthPx} ${maxFontPx} ${minFontPx} ${color}`;
    const cached = this._cache.get(key);
    if (cached) return cached;

    const measure = (t, fontPx) => {
      this.ctx.font = `${LABEL_FONT_WEIGHT} ${fontPx}px ${LABEL_FONT_FAMILY}`;
      return this.ctx.measureText(t).width;
    };
    const fit = fitLabelText({ text, maxWidthPx, maxFontPx, minFontPx, measure });
    if (!fit) return null;

    const cellW = Math.ceil(fit.widthPx) + LABEL_PADDING_PX * 2;
    const cellH = Math.ceil(fit.fontPx * LABEL_LINE_HEIGHT_RATIO) + LABEL_PADDING_PX * 2;

    if (this._cursorX + cellW > this.width) {
      this._cursorX = 0;
      this._cursorY += this._rowHeight;
      this._rowHeight = 0;
    }
    if (this._cursorY + cellH > this.height) return null;

    const x0 = this._cursorX;
    const y0 = this._cursorY;

    this.ctx.font = `${LABEL_FONT_WEIGHT} ${fit.fontPx}px ${LABEL_FONT_FAMILY}`;
    this.ctx.fillStyle = color;
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    const baselineY = y0 + LABEL_PADDING_PX + fit.fontPx * LABEL_BASELINE_RATIO;
    drawSpacedText(this.ctx, text, x0 + LABEL_PADDING_PX, baselineY, fit.letterSpacingPx);

    this._cursorX += cellW;
    this._rowHeight = Math.max(this._rowHeight, cellH);
    this._dirty = true;

    const uv = {
      u0: x0 / this.width,
      v0: y0 / this.height,
      u1: (x0 + cellW) / this.width,
      v1: (y0 + cellH) / this.height,
      widthPx: cellW,
      heightPx: cellH,
    };
    this._cache.set(key, uv);
    return uv;
  }

  /** À appeler une fois toutes les cases de la reconstruction posées. */
  upload() {
    if (this._dirty) this.texture.needsUpdate = true;
    this._dirty = false;
  }

  dispose() {
    this.texture.dispose();
  }
}
