/* Cache des mailles de couverture : le chargement d'une bande recopie les
 * instances communes au lieu de sonder à nouveau routes, sol et emprises.
 * Seules les mailles de la fenêtre courante sont retenues.
 */
export class InstanceCells {
  constructor() { this.cells=new Map(); }
  begin(frame, surface, roads, force) {
    if(force || this.frame!==frame || this.surface!==surface || this.roads!==roads) this.cells.clear();
    this.frame=frame;this.surface=surface;this.roads=roads;this.used=new Set();
  }
  read(key, streams, offset, capacity) {
    this.used.add(key);
    const cell=this.cells.get(key);
    if(!cell || cell.count+offset>capacity) return null;
    streams.forEach(([array,stride],i)=>array.set(cell.data[i],offset*stride));
    return cell.count;
  }
  write(key, streams, from, to) {
    this.cells.set(key,{count:to-from,data:streams.map(([array,stride])=>array.slice(from*stride,to*stride))});
  }
  end() { for(const key of this.cells.keys()) if(!this.used.has(key)) this.cells.delete(key); }
  clear() {this.cells.clear();}
}
