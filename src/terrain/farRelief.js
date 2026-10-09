/*
 * farRelief — le relief lointain : la silhouette des versants au-delà de la
 * bulle, là où le pays en a. Une seule nappe, lue dans un MNT plus grossier
 * que celui de la bulle, d'une seule couleur — celle que le pays met là où la
 * carte se tait. Ni matière, ni entaille, ni décor : à cette distance, seule
 * la forme se lit, et la perspective aérienne fait le reste.
 *
 * La nappe est calée sur les tuiles de la bulle et trouée là où la bulle a une
 * tuile maillée. Les deux reliefs ne sortent pas du même MNT : au bord de la
 * bulle, la nappe prend la cote de la surface affichée, un rien dessous
 * (`FAR_EDGE_DROP_M`) pour ne pas la percer entre deux de ses sommets, puis
 * passe d'une maille sous la bulle en plongeant (`FAR_SKIRT_DROP_M`). Le
 * raccord est fermé sans être cousu.
 *
 * C'est le relief lu qui dit si la nappe sert : sous `FAR_RELIEF_MIN_M`
 * d'amplitude, elle ne se monte pas, et `farness` reste à zéro — c'est lui
 * que le brouillard suit pour s'écarter (`World.advance`). La mesure ne coûte
 * rien de plus que les altitudes qu'il fallait lire de toute façon.
 */

import { tilesCovering } from '../core/tileMath.js';

/** Écart entre le zoom de la bulle et celui du MNT lointain : une tuile de MNT en couvre trente-deux de côté. */
export const FAR_DEM_ZOOM_DROP = 5;
/** Mailles par tuile de la bulle et par côté : un pixel du MNT lointain. */
export const FAR_CELLS_PER_TILE = 8;
/** Plongée de la nappe sous la bulle, en mètres. */
export const FAR_SKIRT_DROP_M = 120;
/** Retrait de la nappe sous la surface de la bulle, à son bord, en mètres. */
export const FAR_EDGE_DROP_M = 3;
/** Rôle d'un sommet de la grille : au large, au bord de la bulle, ou dessous. */
export const FAR_OPEN = 0;
export const FAR_EDGE = 1;
export const FAR_SUNK = 2;
/** Amplitude du relief, en mètres, sous laquelle le lointain ne sert à rien. */
export const FAR_RELIEF_MIN_M = 200;
/** Amplitude à partir de laquelle le brouillard s'écarte jusqu'au bord de la nappe. */
export const FAR_RELIEF_FULL_M = 500;

/** Part du lointain qu'une amplitude de relief justifie, de 0 (plaine) à 1 (montagne). */
export function farnessOf(amplitude) {
  const t = Math.min(1, Math.max(0, (amplitude - FAR_RELIEF_MIN_M) / (FAR_RELIEF_FULL_M - FAR_RELIEF_MIN_M)));
  return t * t * (3 - 2 * t);
}

/**
 * Mailles gardées et rôle des sommets d'une grille de `n` mailles de côté.
 * Un sommet est sous la bulle quand ses quatre mailles sont couvertes, à son
 * bord quand une partie l'est ; une maille tombe quand ses quatre sommets sont
 * dessous, ou qu'un seul manque d'altitude.
 *
 * @param {number} n
 * @param {(i:number, j:number) => boolean} covered Maille sous une tuile maillée de la bulle.
 * @param {Float32Array} heights `(n + 1)²` altitudes, `NaN` où le MNT manque.
 * @returns {{role: Uint8Array, index: Uint32Array}}
 */
export function farGrid(n, covered, heights) {
  const side = n + 1;
  const under = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) under[j * n + i] = covered(i, j) ? 1 : 0;
  const at = (i, j) => (i >= 0 && j >= 0 && i < n && j < n ? under[j * n + i] : 0);

  const role = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const under = at(i - 1, j - 1) + at(i, j - 1) + at(i - 1, j) + at(i, j);
      role[j * side + i] = under === 4 ? FAR_SUNK : under ? FAR_EDGE : FAR_OPEN;
    }
  }
  const sunk = (v) => role[v] === FAR_SUNK;

  const index = new Uint32Array(n * n * 6);
  let count = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      if (sunk(a) && sunk(b) && sunk(c) && sunk(d)) continue;
      if (Number.isNaN(heights[a] + heights[b] + heights[c] + heights[d])) continue;
      index[count++] = a; index[count++] = c; index[count++] = b;
      index[count++] = b; index[count++] = c; index[count++] = d;
    }
  }
  return { role, index: index.slice(0, count) };
}

export class FarRelief {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble     La bulle : repère, tuile centrale, tuiles maillées, surface affichée.
   * @param {Object} options.elevation  `ElevationField` du lointain. La nappe en devient propriétaire.
   * @param {number} options.blockSize  Côté de la nappe, en tuiles de la bulle (impair).
   */
  constructor({ THREE, scene, bubble, elevation, blockSize }) {
    this.THREE = THREE;
    this.bubble = bubble;
    this.elevation = elevation;
    this.blockSize = blockSize | 1;
    /** Amplitude du relief lu sous la nappe, en mètres. */
    this.amplitude = 0;
    /** Part du lointain que ce relief justifie (`farnessOf`). */
    this.farness = 0;
    this.disposed = false;

    this.material = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'relief lointain';
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._abort = new AbortController();
    /** Ce que la nappe montée reflète, et ce qu'un chargement en vol prépare. */
    this._signature = null;
    this._pending = null;
    /** Altitudes de la grille, gardées tant que la tuile centrale ne change pas. */
    this._heights = null;
    this._heightsKey = null;
  }

  /** Demi-côté de la nappe, en mètres. */
  get radiusMeters() {
    return this.bubble.frame ? (this.blockSize / 2) * this.bubble.frame.scale : 0;
  }

  /** @param {{x:number, y:number, z:number}|null} albedo Couleur linéaire du sol du pays. */
  setColor(albedo) {
    if (albedo) this.material.color.setRGB(albedo.x, albedo.y, albedo.z);
  }

  /**
   * Recale la nappe sur la bulle. Ne fait rien tant que ni le repère, ni la
   * tuile centrale, ni les tuiles maillées n'ont changé : s'appelle à chaque image.
   */
  async sync() {
    const { bubble } = this;
    const centre = bubble.centerTile;
    if (this.disposed || !bubble.frame || !centre) return;

    const frame = bubble.frame;
    const half = (this.blockSize - 1) / 2;
    const x0 = centre.x - half;
    const y0 = centre.y - half;
    const meshed = new Set();
    let stamp = 0;
    for (const tile of bubble.tiles.values()) {
      if (!tile.mesh) continue;
      const i = tile.x - x0;
      const j = tile.y - y0;
      meshed.add(j * this.blockSize + i);
      stamp += (i + 1) * 31 + (j + 1) * 1009;
    }
    const signature = `${frame.originLng}/${frame.originLat}/${x0}/${y0}/${meshed.size}/${stamp}`;
    if (signature === this._signature || signature === this._pending) return;
    this._pending = signature;

    const key = `${frame.originLng}/${frame.originLat}/${x0}/${y0}`;
    if (key !== this._heightsKey) {
      const wanted = tilesCovering(x0, y0, this.blockSize, bubble.zoom, this.elevation.zoom);
      await Promise.all(wanted.map((t) => this.elevation.load(t.x, t.y, this._abort.signal)));
      if (this.disposed || this._pending !== signature) return;
      this._readHeights(x0, y0);
      this._heightsKey = key;
    }

    this._build(frame, x0, y0, meshed);
    this._signature = signature;
    this._pending = null;
  }

  _readHeights(x0, y0) {
    const cells = FAR_CELLS_PER_TILE;
    const side = this.blockSize * cells + 1;
    const k = Math.pow(2, this.elevation.zoom - this.bubble.zoom);
    const heights = new Float32Array(side * side);
    let low = Infinity;
    let high = -Infinity;
    for (let j = 0; j < side; j++) {
      const ty = (y0 + j / cells) * k;
      for (let i = 0; i < side; i++) {
        const h = this.elevation.sampleTile((x0 + i / cells) * k, ty, NaN);
        heights[j * side + i] = h;
        if (h < low) low = h;
        if (h > high) high = h;
      }
    }
    this._heights = heights;
    this.amplitude = high > low ? high - low : 0;
    this.farness = farnessOf(this.amplitude);
  }

  _build(frame, x0, y0, meshed) {
    const { THREE, mesh } = this;
    mesh.visible = this.farness > 0;
    if (!mesh.visible) return;

    const cells = FAR_CELLS_PER_TILE;
    const n = this.blockSize * cells;
    const side = n + 1;
    const heights = this._heights;
    const covered = (i, j) => meshed.has(Math.floor(j / cells) * this.blockSize + Math.floor(i / cells));
    const { role, index } = farGrid(n, covered, heights);

    const origin = frame.tileToLocal(x0, y0);
    const step = frame.scale / cells;
    const vertical = this.bubble.verticalScale || 1;
    const positions = new Float32Array(side * side * 3);
    for (let j = 0, v = 0, p = 0; j < side; j++) {
      for (let i = 0; i < side; i++, v++) {
        const x = origin.x + i * step;
        const z = origin.z + j * step;
        let h = heights[v];
        if (role[v] === FAR_SUNK) h -= FAR_SKIRT_DROP_M;
        else if (role[v] === FAR_EDGE) h = this.bubble.surfaceElevationAtLocal(x, z, h) - FAR_EDGE_DROP_M;
        positions[p++] = x;
        positions[p++] = Number.isNaN(h) ? 0 : h * vertical;
        positions[p++] = z;
      }
    }

    const activeCells = new Uint8Array(n * n);
    for (let k = 0; k < index.length; k += 6) {
      const a = index[k];
      activeCells[Math.floor(a / side) * n + a % side] = 1;
    }
    this._surface = { x: origin.x, z: origin.z, step, n, cells: activeCells, positions };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  /** Appui sur les triangles affichés, sans relire ni charger le MNT. */
  positionAt(x, z, lift = 0) {
    const grid = this._surface;
    if (!this.mesh.visible || !grid) return null;
    const gx = (x - grid.x) / grid.step, gz = (z - grid.z) / grid.step;
    const i = Math.floor(gx), j = Math.floor(gz);
    if (i < 0 || j < 0 || i >= grid.n || j >= grid.n || !grid.cells[j * grid.n + i]) return null;
    const u = gx - i, v = gz - j;
    const a = j * (grid.n + 1) + i, b = a + 1, c = a + grid.n + 1, d = c + 1;
    const h = (k) => grid.positions[k * 3 + 1];
    const y = u + v <= 1
      ? h(a) * (1 - u - v) + h(b) * u + h(c) * v
      : h(b) * (1 - v) + h(c) * (1 - u) + h(d) * (u + v - 1);
    return { x, y: y + lift, z };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._surface = null;
    this._abort.abort();
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.elevation.dispose();
  }
}
