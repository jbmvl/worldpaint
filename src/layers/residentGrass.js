/* Les mailles d’herbe gardent leurs emplacements dans un tampon dense.
 * Les trous laissés par les mailles sortantes sont comblés par la queue, par
 * séries contiguës ; les plages transférées au GPU sont fusionnées quand peu
 * d’instances les séparent, un appel de transfert coûtant plus que ces octets.
 * Les fleurs lisent l’ordre de sélection, indépendant de cet ordre de stockage.
 */
const MERGE_GAP = 256;

export class ResidentGrass {
  constructor(attributes, capacity = attributes[0].count) {
    this.attributes = attributes;
    this.cells = new Set();
    this.owners = new Array(capacity);
    this.indices = new Uint32Array(capacity);
    this.removed = new Uint8Array(capacity);
    this.count = 0;
  }
  sync(selected) {
    const wanted = new Set(selected);
    const { attributes, owners, indices, removed } = this;
    const count = this.count;
    let live = count;
    for (const cell of this.cells) {
      if (wanted.has(cell)) continue;
      for (let i = 0; i < cell.count; i++) removed[cell.slots[i]] = 1;
      live -= cell.count;
      this.cells.delete(cell);
    }
    const ranges = [];
    for (let hole = 0, source = live; ;) {
      while (hole < live && !removed[hole]) hole++;
      if (hole >= live) break;
      while (removed[source]) source++;
      let run = 1;
      while (hole + run < live && removed[hole + run] && source + run < count && !removed[source + run]) run++;
      for (const a of attributes) a.array.copyWithin(hole * a.itemSize, source * a.itemSize, (source + run) * a.itemSize);
      for (let k = 0; k < run; k++) {
        const cell = owners[source + k], index = indices[source + k];
        owners[hole + k] = cell;
        indices[hole + k] = index;
        cell.slots[index] = hole + k;
      }
      addRange(ranges, hole, run);
      hole += run;
      source += run;
    }
    removed.fill(0, 0, count);
    owners.fill(undefined, live, count);
    let end = live;
    for (const cell of selected) {
      if (this.cells.has(cell)) continue;
      cell.slots = new Uint32Array(cell.count);
      for (let i = 0; i < cell.count; i++) {
        cell.slots[i] = end + i;
        owners[end + i] = cell;
        indices[end + i] = i;
      }
      for (let i = 0; i < attributes.length; i++) attributes[i].array.set(cell.data[i], end * attributes[i].itemSize);
      addRange(ranges, end, cell.count);
      end += cell.count;
      this.cells.add(cell);
    }
    for (const [start, length] of ranges) {
      for (const a of attributes) a.addUpdateRange(start * a.itemSize, length * a.itemSize);
    }
    if (ranges.length) for (const a of attributes) a.needsUpdate = true;
    this.count = end;
    return end;
  }
  clear() {
    this.cells.clear();
    this.owners.fill(undefined, 0, this.count);
    this.count = 0;
  }
}

function addRange(ranges, start, length) {
  const last = ranges.at(-1);
  if (last && start <= last[0] + last[1] + MERGE_GAP) last[1] = Math.max(last[1], start + length - last[0]);
  else if (length > 0) ranges.push([start, length]);
}
