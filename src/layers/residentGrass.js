/* Les mailles d’herbe gardent leurs emplacements dans un tampon dense.
 * La recherche des entrées/sorties porte sur les mailles, pas sur chaque brin.
 * Les fleurs lisent l’ordre de sélection, indépendant de cet ordre de stockage.
 */
export class ResidentGrass {
  constructor(attributes) {
    this.attributes = attributes;
    this.cells = new Set();
    this.owners = [];
    this.dirty = new Uint8Array(attributes[0].count);
  }
  sync(selected) {
    const wanted = new Set(selected);
    const attributes = this.attributes, owners = this.owners, dirty = this.dirty;
    dirty.fill(0);
    for (const cell of this.cells) {
      if (wanted.has(cell)) continue;
      for (let i = 0; i < cell.count; i++) {
        const slot = cell.slots[i], last = owners.length - 1;
        if (slot !== last) {
          for (const a of attributes) a.array.copyWithin(slot * a.itemSize, last * a.itemSize, (last + 1) * a.itemSize);
          const moved = owners[last];
          owners[slot] = moved;
          moved.cell.slots[moved.index] = slot;
          dirty[slot] = 1;
        }
        owners.pop();
      }
      this.cells.delete(cell);
    }
    for (const cell of selected) {
      if (this.cells.has(cell)) continue;
      const start = owners.length;
      cell.slots = new Uint32Array(cell.count);
      for (let i = 0; i < cell.count; i++) {
        cell.slots[i] = start + i;
        owners.push({ cell, index: i });
      }
      for (let i = 0; i < attributes.length; i++) attributes[i].array.set(cell.data[i], start * attributes[i].itemSize);
      dirty.fill(1, start, owners.length);
      this.cells.add(cell);
    }
    for (let start = 0; start < owners.length;) {
      if (!dirty[start]) { start++; continue; }
      let end = start + 1;
      while (end < owners.length && dirty[end]) end++;
      for (const a of attributes) {
        a.addUpdateRange(start * a.itemSize, (end - start) * a.itemSize);
        a.needsUpdate = true;
      }
      start = end;
    }
    return owners.length;
  }
  clear() { this.cells.clear(); this.owners.length = 0; }
}
