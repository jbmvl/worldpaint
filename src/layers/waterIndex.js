/*
 * waterIndex — où l'eau est, et à quelle altitude, pour qui creuse le terrain
 * (question posée par sommet de maille : eau ? à quelle hauteur ? à quelle
 * distance de la rive ?).
 *
 * Une nappe est une surface, pas une ligne : contrairement à `RoadIndex`, la
 * question « suis-je dedans ? » ne se répond pas localement. On paie donc une
 * fois à la construction — rasterisation par balayage de lignes, puis une
 * transformation de distance qui propage vers l'extérieur la distance à la
 * rive et l'altitude de la nappe la plus proche — pour que la requête ne soit
 * plus qu'une lecture de case.
 *
 * Pas de grille de l'ordre de la maille de terrain (4,42 m au mieux) : une
 * cuvette décrite plus finement ne serait pas rendue (voir `waterCut`).
 */

import { WATER_CUT_BLEND_M } from '../terrain/waterCut.js';

/** Côté d'une case, en mètres (ordre de la maille de terrain la plus fine, 4,42 m). */
export const WATER_INDEX_CELL_M = 4;

/** Plafond du nombre de cases : garde contre une emprise absurde, pas un réglage. */
export const WATER_INDEX_MAX_CELLS = 1 << 21;

/** Coûts de la transformation de distance, en cases. */
const STEP_ORTHOGONAL = 1;
const STEP_DIAGONAL = Math.SQRT2;

/**
 * Abscisses où une ligne horizontale traverse un anneau, en ordre croissant.
 * Demi-ouverture sur `z` (`min <= z < max`) pour qu'un sommet sur la ligne ne
 * soit compté qu'une fois.
 */
export function ringCrossings(ring, z) {
  const out = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const zMin = Math.min(a.z, b.z);
    const zMax = Math.max(a.z, b.z);
    if (z < zMin || z >= zMax) continue;
    out.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
  }
  return out.sort((p, q) => p - q);
}

/**
 * La cuvette d'eau, rasterisée : altitude de nappe et distance à la rive.
 */
export class WaterIndex {
  /**
   * @param {Array<{rings: Array<Array<{x:number,z:number}>>, level: number}>} surfaces
   *        Une entrée par nappe : le contour puis ses trous, et son altitude.
   * @param {Object} [options]
   * @param {number} [options.cell]  Côté d'une case, en mètres.
   * @param {number} [options.blend] Portée du raccord au-delà de la rive.
   */
  constructor(surfaces, { cell = WATER_INDEX_CELL_M, blend = WATER_CUT_BLEND_M } = {}) {
    this.cell = cell;
    this.blend = blend;
    this.nx = 0;
    this.nz = 0;
    this.level = null;
    this.distance = null;

    const usable = (surfaces || []).filter(
      (s) => s && Number.isFinite(s.level) && Array.isArray(s.rings) && s.rings[0]?.length >= 3
    );
    if (usable.length === 0) return;

    // Emprise : les nappes, élargies du raccord.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const surface of usable) {
      for (const p of surface.rings[0]) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
    }
    minX -= blend;
    minZ -= blend;
    maxX += blend;
    maxZ += blend;

    const nx = Math.ceil((maxX - minX) / cell) + 1;
    const nz = Math.ceil((maxZ - minZ) / cell) + 1;
    if (!(nx > 0) || !(nz > 0) || nx * nz > WATER_INDEX_MAX_CELLS) return;

    this.originX = minX;
    this.originZ = minZ;
    this.nx = nx;
    this.nz = nz;
    this.level = new Float32Array(nx * nz).fill(NaN);
    this.distance = new Float32Array(nx * nz).fill(Infinity);

    for (const surface of usable) this._rasterize(surface);
    this._spread();
  }

  /** Vrai si l'index a quelque chose à dire. */
  get ready() {
    return this.level !== null;
  }

  /** Marque les cases couvertes par une nappe (balayage de lignes, parité paire-impaire). */
  _rasterize(surface) {
    const { cell, nx, nz } = this;

    for (let j = 0; j < nz; j++) {
      const z = this.originZ + (j + 0.5) * cell;

      const crossings = [];
      for (const ring of surface.rings) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        for (const x of ringCrossings(ring, z)) crossings.push(x);
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);

      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil((crossings[k] - this.originX) / cell - 0.5));
        const to = Math.min(nx - 1, Math.floor((crossings[k + 1] - this.originX) / cell - 0.5));
        for (let i = from; i <= to; i++) {
          const index = j * nx + i;
          // Deux nappes superposées : la plus basse commande.
          if (!(this.level[index] <= surface.level)) this.level[index] = surface.level;
          this.distance[index] = 0;
        }
      }
    }
  }

  /**
   * Propage vers l'extérieur la distance à la rive et l'altitude de la nappe
   * la plus proche, par transformation de distance en deux passes (chanfrein).
   */
  _spread() {
    const { nx, nz, cell, blend, level, distance } = this;
    const reach = blend;

    const relax = (index, from, step) => {
      const d = distance[from] + step * cell;
      if (d < distance[index] && d <= reach) {
        distance[index] = d;
        level[index] = level[from];
      }
    };

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const index = j * nx + i;
        if (i > 0) relax(index, index - 1, STEP_ORTHOGONAL);
        if (j > 0) relax(index, index - nx, STEP_ORTHOGONAL);
        if (i > 0 && j > 0) relax(index, index - nx - 1, STEP_DIAGONAL);
        if (i + 1 < nx && j > 0) relax(index, index - nx + 1, STEP_DIAGONAL);
      }
    }

    for (let j = nz - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const index = j * nx + i;
        if (i + 1 < nx) relax(index, index + 1, STEP_ORTHOGONAL);
        if (j + 1 < nz) relax(index, index + nx, STEP_ORTHOGONAL);
        if (i + 1 < nx && j + 1 < nz) relax(index, index + nx + 1, STEP_DIAGONAL);
        if (i > 0 && j + 1 < nz) relax(index, index + nx - 1, STEP_DIAGONAL);
      }
    }
  }

  /**
   * Nappe qui commande en un point, ou `null` s'il n'y en a aucune à portée.
   * Lecture de la case la plus proche, sans interpolation.
   *
   * @returns {{level:number, distance:number}|null}
   */
  query(x, z) {
    if (!this.ready) return null;
    const i = Math.round((x - this.originX) / this.cell - 0.5);
    const j = Math.round((z - this.originZ) / this.cell - 0.5);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return null;

    const index = j * this.nx + i;
    const value = this.level[index];
    if (!Number.isFinite(value)) return null;
    return { level: value, distance: this.distance[index] };
  }
}
