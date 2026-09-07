/*
 * waterIndex — où l'eau est, et à quelle altitude (question posée par point au
 * sol : nappe ? à quelle hauteur ?).
 *
 * Une nappe est une surface, pas une ligne : contrairement à `RoadIndex`, la
 * question « suis-je dedans ? » ne se répond pas localement. On paie donc une
 * fois à la construction — rasterisation par balayage de lignes — pour que la
 * requête ne soit plus qu'une lecture de case.
 *
 * L'index ne sert plus à creuser le terrain (l'eau ne le touche plus, voir
 * `waterLayer`) : il ne reste que le seul usage qui demande vraiment de savoir
 * ce qu'il y a sous un point, la garde d'un tablier de pont au-dessus de la
 * nappe qu'il franchit (`roadNetwork`). D'où la disparition de la
 * transformation de distance qui propageait la rive vers l'extérieur : hors de
 * l'eau, il n'y a plus rien à dire.
 */

/** Côté d'une case, en mètres (ordre de la maille de terrain la plus fine, 4,42 m). */
export const WATER_INDEX_CELL_M = 4;

/** Plafond du nombre de cases : garde contre une emprise absurde, pas un réglage. */
export const WATER_INDEX_MAX_CELLS = 1 << 21;

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
 * Les nappes d'eau, rasterisées : leur altitude, case par case.
 */
export class WaterIndex {
  /**
   * @param {Array<{rings: Array<Array<{x:number,z:number}>>, levelAt: Function}>} surfaces
   *        Une entrée par nappe : le contour puis ses trous, et son altitude en
   *        un point — une fonction, car une rivière descend d'un bief à l'autre.
   * @param {Object} [options]
   * @param {number} [options.cell] Côté d'une case, en mètres.
   */
  constructor(surfaces, { cell = WATER_INDEX_CELL_M } = {}) {
    this.cell = cell;
    this.nx = 0;
    this.nz = 0;
    this.level = null;

    const usable = (surfaces || []).filter(
      (s) => s && typeof s.levelAt === 'function' && Array.isArray(s.rings) && s.rings[0]?.length >= 3
    );
    if (usable.length === 0) return;

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

    const nx = Math.ceil((maxX - minX) / cell) + 1;
    const nz = Math.ceil((maxZ - minZ) / cell) + 1;
    if (!(nx > 0) || !(nz > 0) || nx * nz > WATER_INDEX_MAX_CELLS) return;

    this.originX = minX;
    this.originZ = minZ;
    this.nx = nx;
    this.nz = nz;
    this.level = new Float32Array(nx * nz).fill(NaN);

    for (const surface of usable) this._rasterize(surface);
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
          const value = surface.levelAt(this.originX + (i + 0.5) * cell, z);
          if (!Number.isFinite(value)) continue;
          const index = j * nx + i;
          // Deux nappes superposées : la plus basse commande.
          if (!(this.level[index] <= value)) this.level[index] = value;
        }
      }
    }
  }

  /**
   * Nappe qui commande en un point, ou `null` s'il n'y en a aucune.
   * Lecture de la case la plus proche, sans interpolation.
   *
   * @returns {{level:number}|null}
   */
  query(x, z) {
    if (!this.ready) return null;
    const i = Math.round((x - this.originX) / this.cell - 0.5);
    const j = Math.round((z - this.originZ) / this.cell - 0.5);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return null;

    const value = this.level[j * this.nx + i];
    if (!Number.isFinite(value)) return null;
    return { level: value };
  }
}
