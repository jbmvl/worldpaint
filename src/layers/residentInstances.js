/* Stockage dense des instances : une identité conservée garde son emplacement.
 * Un retrait comble son trou avec la dernière instance ; seuls ces déplacements
 * et les ajouts sont transférés au GPU. L'ordre de sélection reste à l'appelant.
 */
export class ResidentInstances {
  constructor(attributes) {
    this.attributes = attributes;
    this.slots = new Map();
    this.keys = [];
  }
  sync(wanted, write) {
    const retained = new Set(wanted);
    const dirty = new Set();
    for (let slot = this.keys.length - 1; slot >= 0; slot--) {
      const key = this.keys[slot];
      if (retained.has(key)) continue;
      const last = this.keys.length - 1;
      if (slot !== last) {
        for (const attribute of this.attributes) {
          const stride = attribute.itemSize;
          attribute.array.copyWithin(slot * stride, last * stride, (last + 1) * stride);
        }
        const moved = this.keys[last];
        this.keys[slot] = moved;
        this.slots.set(moved, slot);
        dirty.add(slot);
      }
      this.keys.pop();
      this.slots.delete(key);
    }
    for (const key of wanted) {
      if (this.slots.has(key)) continue;
      const slot = this.keys.length;
      write(key, slot);
      this.keys.push(key);
      this.slots.set(key, slot);
      dirty.add(slot);
    }
    const changed = [...dirty].filter(i => i < this.keys.length).sort((a, b) => a - b);
    for (const attribute of this.attributes) {
      // Les plages non encore rendues restent valides si deux mises à jour se suivent.
      let start = -1, end = -1;
      const flush = () => { if (start >= 0) attribute.addUpdateRange(start * attribute.itemSize, (end - start + 1) * attribute.itemSize); };
      for (const slot of changed) {
        if (slot === end + 1) { end = slot; if (start < 0) start = slot; }
        else { flush(); start = end = slot; }
      }
      flush();
      if (changed.length) attribute.needsUpdate = true;
    }
    return this.keys.length;
  }
  clear() { this.slots.clear(); this.keys.length = 0; }
}
