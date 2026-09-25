/* Cache des mailles de couverture : les mailles communes évitent de sonder
 * à nouveau routes, sol et emprises. Le mode résident publie leurs identités
 * sans recopier leurs attributs ; le mode compact les écrit dans l’ordre lu.
 * Seules les mailles de la fenêtre courante sont retenues.
 */
export class InstanceCells {
  constructor({ resident = false } = {}) { this.cells=new Map(); this.resident=resident; }
  begin(frame, surface, roads, force) {
    if(force || this.frame!==frame || this.surface!==surface || this.roads!==roads) this.cells.clear();
    this.frame=frame;this.surface=surface;this.roads=roads;this.used=new Set(); this.selected=[];
  }
  read(key, streams, offset, capacity) {
    this.used.add(key);
    const cell=this.cells.get(key);
    if(!cell || cell.count+offset>capacity) return null;
    if (this.resident) this.selected.push(cell);
    else streams.forEach(([array,stride],i)=>array.set(cell.data[i],offset*stride));
    return cell.count;
  }
  write(key, streams, from, to, complete = true) {
    const cell={count:to-from,data:streams.map(([array,stride])=>array.slice(from*stride,to*stride))};
    if (this.resident) {
      this.selected.push(cell);
    }
    if (complete) this.cells.set(key,cell);
    else this.cells.delete(key);
  }
  end() { for(const key of this.cells.keys()) if(!this.used.has(key)) this.cells.delete(key); }
  clear() {this.cells.clear(); this.selected=[]; this.used?.clear();}
}
