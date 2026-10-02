/*
 * labelAtlas — le nom d'un lieu, peint sur une texture plutôt que sculpté.
 * Un panneau (`furnitureLayer`) et une enseigne de devanture (`buildingLayer`)
 * portent un texte qui diffère par instance, alors que leur géométrie est
 * partagée entre instances : il faut donc un texte par texture, pas par
 * sommet. D'où cet atlas — un seul canvas réparti en étagères
 * (`LabelAtlas.place`) — plutôt qu'un canvas par enseigne.
 *
 * Le fond de l'atlas reste transparent : la texture se pose par-dessus une
 * géométrie déjà colorée (panneau, bandeau), qui reste visible tout autour.
 * Seule exception, la carte d'enseigne (`placeSign`) peint son propre fond :
 * c'est toute la face du drapeau qui luit la nuit, pas seulement son encre.
 */

import { SHOP_ICONS, SHOP_ICON_VIEWBOX, SHOP_ICON_STROKE } from './shopIcons.js';

/** Police du texte peint (chasse étroite pour tenir un nom de ville large sur un panneau étroit). */
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
 * Résolution interne de l'atlas, en pixels par mètre du monde. Seule règle de
 * conversion entre pixels de canvas et mètres du monde, partagée entre les
 * deux sites d'appel (`furnitureLayer`, `buildingLayer`).
 */
export const LABEL_PX_PER_M = 120;

/**
 * Taille de fonte qui donne une case de cette hauteur, padding et hauteur de
 * ligne compris. Inverse du calcul de `cellH` dans `LabelAtlas.place`.
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
 * `measure(text, fontPx)` est injectée (testable sous Node) — voir
 * `LabelAtlas.place` pour l'appelant réel, qui branche `ctx.measureText`.
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
 * Peint `text` avec un interlettrage donné, glyphe par glyphe (plus portable
 * que `CanvasRenderingContext2D.letterSpacing`, cohérent avec `fitLabelText`).
 */
function drawSpacedText(ctx, text, x, y, letterSpacingPx) {
  let cursor = x;
  for (const glyph of text) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + letterSpacingPx;
  }
}

/** Marge intérieure d'une carte d'enseigne, en part de sa largeur. */
export const SIGN_CARD_MARGIN_RATIO = 0.1;
/** Part de la hauteur utile laissée au nom, sous le pictogramme. */
export const SIGN_CARD_NAME_RATIO = 0.24;
/** Rayon des coins de la carte, en part de sa largeur. */
export const SIGN_CARD_CORNER_RATIO = 0.08;

/**
 * Découpe d'une carte d'enseigne : le pictogramme, carré, en haut, et le nom
 * dessous sur toute la largeur utile. Sans nom, le pictogramme se centre.
 * Fonction pure, en pixels de la carte.
 *
 * @returns {{icon:{x:number,y:number,size:number}, name:{x:number,y:number,width:number,height:number}|null}}
 */
export function signCardLayout(widthPx, heightPx, hasName) {
  const margin = widthPx * SIGN_CARD_MARGIN_RATIO;
  const innerW = widthPx - margin * 2;
  const innerH = heightPx - margin * 2;
  const nameH = hasName ? innerH * SIGN_CARD_NAME_RATIO : 0;
  const size = Math.min(innerW, innerH - nameH - (hasName ? margin / 2 : 0));
  const iconY = hasName ? margin : (heightPx - size) / 2;
  return {
    icon: { x: (widthPx - size) / 2, y: iconY, size },
    name: hasName ? { x: margin, y: heightPx - margin - nameH, width: innerW, height: nameH } : null,
  };
}

/**
 * Pousse un panneau texturé vertical entre deux points au sol, dans un
 * accumulateur `{positions, uvs}`. Équivalent de `pushPanel`
 * (`buildingLayer.js`) mais sans normale (rien de peint n'est éclairé).
 *
 * Attention à la chiralité : `a` est le côté **droit** du texte pour qui
 * regarde le panneau de face, `b` son côté **gauche** — inversé par rapport à
 * l'intuition. Se tromper inverse le texte (lu de droite à gauche) sans le
 * rendre invisible, ce qui peut passer inaperçu.
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
  // u1 (fin du texte) sur `a` (droite), u0 (début) sur `b` (gauche).
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
 * `place(text, …)` rend un nom une fois (mémorisé) et rend les UV de sa
 * case ; `reset()` vide les étagères en début de reconstruction. Pas
 * testable sous Node (`createCanvas` retombe sur `document.createElement`) —
 * c'est `fitLabelText`, pur, qui porte la couverture de test.
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
    // Couleur d'auteur (comme le gazon ou l'asphalte) : conversion sRGB.
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Repère direct plutôt que celui, retourné, de three — voir `groundClassMap.js`.
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

  /** Vide les étagères avant une reconstruction. */
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
   *          `null` si `text` est vide ou si l'atlas est plein.
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

    const cell = this._reserve(cellW, cellH);
    if (!cell) return null;
    const { x0, y0 } = cell;

    this.ctx.font = `${LABEL_FONT_WEIGHT} ${fit.fontPx}px ${LABEL_FONT_FAMILY}`;
    this.ctx.fillStyle = color;
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    const baselineY = y0 + LABEL_PADDING_PX + fit.fontPx * LABEL_BASELINE_RATIO;
    drawSpacedText(this.ctx, text, x0 + LABEL_PADDING_PX, baselineY, fit.letterSpacingPx);

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

  /**
   * Réserve une case libre de l'étagère courante, ou `null` si l'atlas est plein.
   */
  _reserve(cellW, cellH) {
    if (this._cursorX + cellW > this.width) {
      this._cursorX = 0;
      this._cursorY += this._rowHeight;
      this._rowHeight = 0;
    }
    if (this._cursorY + cellH > this.height) return null;
    const cell = { x0: this._cursorX, y0: this._cursorY };
    this._cursorX += cellW;
    this._rowHeight = Math.max(this._rowHeight, cellH);
    this._dirty = true;
    return cell;
  }

  /**
   * Peint une carte d'enseigne pleine : fond arrondi, pictogramme Tabler
   * (`materials/shopIcons.js`) et, dessous, le nom. Mémorisée comme `place`.
   *
   * @param {Object} options
   * @param {string} options.icon Nom d'icône présent dans `SHOP_ICONS` ; une
   *        icône absente laisse la carte sans pictogramme.
   * @param {string|null} [options.name]
   * @param {number} options.widthPx
   * @param {number} options.heightPx
   * @param {string} options.background Couleur CSS du fond.
   * @param {string} options.ink Couleur CSS du trait et du texte.
   * @returns {{u0:number,v0:number,u1:number,v1:number,widthPx:number,heightPx:number}|null}
   */
  placeSign({ icon, name = null, widthPx, heightPx, background, ink }) {
    const cellW = Math.ceil(widthPx);
    const cellH = Math.ceil(heightPx);
    const key = `sign ${icon} ${name} ${cellW} ${cellH} ${background} ${ink}`;
    const cached = this._cache.get(key);
    if (cached) return cached;

    const cell = this._reserve(cellW, cellH);
    if (!cell) return null;
    const { x0, y0 } = cell;
    const ctx = this.ctx;
    const layout = signCardLayout(cellW, cellH, !!name);

    ctx.save();
    ctx.fillStyle = background;
    ctx.beginPath();
    // Retrait d'un pixel : le filtrage linéaire ne bave pas sur la case voisine.
    const corner = cellW * SIGN_CARD_CORNER_RATIO;
    ctx.roundRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2, corner);
    ctx.fill();

    const paths = SHOP_ICONS[icon];
    if (paths && typeof Path2D !== 'undefined') {
      const scale = layout.icon.size / SHOP_ICON_VIEWBOX;
      ctx.save();
      ctx.translate(x0 + layout.icon.x, y0 + layout.icon.y);
      ctx.scale(scale, scale);
      ctx.strokeStyle = ink;
      ctx.lineWidth = SHOP_ICON_STROKE;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const d of paths) ctx.stroke(new Path2D(d));
      ctx.restore();
    }

    if (layout.name) {
      const box = layout.name;
      const maxFontPx = Math.max(1, box.height / LABEL_LINE_HEIGHT_RATIO);
      const measure = (t, fontPx) => {
        ctx.font = `${LABEL_FONT_WEIGHT} ${fontPx}px ${LABEL_FONT_FAMILY}`;
        return ctx.measureText(t).width;
      };
      const fit = fitLabelText({ text: name, maxWidthPx: box.width, maxFontPx, minFontPx: Math.min(8, maxFontPx), measure });
      ctx.font = `${LABEL_FONT_WEIGHT} ${fit.fontPx}px ${LABEL_FONT_FAMILY}`;
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      // Un nom trop long pour le plancher de fonte est rogné à la carte, pas
      // laissé déborder sur la case voisine.
      ctx.beginPath();
      ctx.rect(x0 + box.x, y0 + box.y, box.width, box.height);
      ctx.clip();
      const left = x0 + box.x + Math.max(0, (box.width - fit.widthPx) / 2);
      drawSpacedText(ctx, name, left, y0 + box.y + box.height / 2, fit.letterSpacingPx);
    }
    ctx.restore();

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
