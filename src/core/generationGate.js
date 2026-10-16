// Une reconstruction suspendue garde son générateur, sans minuteur de polling.
export class GenerationGate {
  constructor() { this.paused = false; this.disposed = false; this.waiters = new Set(); }
  setPaused(paused) {
    this.paused = !!paused;
    if (!this.paused) this._release();
  }
  wait() {
    if (!this.paused || this.disposed) return Promise.resolve(!this.disposed);
    return new Promise(resolve => this.waiters.add(resolve));
  }
  _release() {
    for (const resolve of this.waiters) resolve(!this.disposed);
    this.waiters.clear();
  }
  dispose() { this.disposed = true; this._release(); }
}
