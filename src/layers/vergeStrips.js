/*
 * vergeStrips — la bande de terre entre une chaussée et la haie qui la borde.
 * Module pur, testable sous Node.
 *
 * Une haie de bas-côté clôt le champ : la culture est derrière elle, jamais
 * entre elle et la route. Le mobilier publie ces bandes, les cultures les
 * lisent ; ni l'un ni l'autre ne lit l'autre couche.
 *
 * Une bande est un tronçon de l'axe de la chaussée et un décalage signé,
 * celui de la haie (même convention que `appendProfile` : normale `(tz, -tx)`).
 * Elle couvre de l'axe jusqu'au dos de la haie, `pad` compris.
 */

/** Maille de l'index, en mètres : de l'ordre d'une bande entière en travers. */
const VERGE_CELL_M = 8;

export class VergeStrips {
  constructor() {
    this._cells = new Map();
    this.size = 0;
  }

  /**
   * @param {Array<{x:number,z:number}>} path Axe de la chaussée, là où court la haie.
   * @param {number} offset Décalage signé de l'axe de la haie.
   * @param {number} [pad] Demi-épaisseur de la haie, ajoutée au-delà de son axe.
   */
  add(path, offset, pad = 0) {
    if (!Array.isArray(path) || path.length < 2 || !offset) return;
    const side = Math.sign(offset);
    const reach = Math.abs(offset) + pad;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const strip = { ax: a.x, az: a.z, tx: dx / length, tz: dz / length, length, side, reach };
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / VERGE_CELL_M);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / VERGE_CELL_M);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / VERGE_CELL_M);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / VERGE_CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx}:${cz}`;
          let list = this._cells.get(key);
          if (!list) this._cells.set(key, (list = []));
          list.push(strip);
        }
      }
      this.size++;
    }
  }

  /** Vrai si le point est entre une chaussée et sa haie. */
  covers(x, z) {
    const list = this._cells.get(`${Math.floor(x / VERGE_CELL_M)}:${Math.floor(z / VERGE_CELL_M)}`);
    if (!list) return false;
    for (const s of list) {
      const px = x - s.ax;
      const pz = z - s.az;
      const along = px * s.tx + pz * s.tz;
      if (along < 0 || along > s.length) continue;
      const lateral = (px * s.tz - pz * s.tx) * s.side;
      if (lateral >= 0 && lateral <= s.reach) return true;
    }
    return false;
  }
}
