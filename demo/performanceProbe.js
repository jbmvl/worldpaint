/* Relevé opt-in par ?mesure=1 : arrêt, trajet rectiligne, reconstruction.
 * Les intervalles d’images incluent l’attente GPU ; le temps JS ne l’isole pas.
 * Une interruption longue invalide le relevé au lieu de devenir un faux à-coup.
 */
export class PerformanceProbe {
  constructor() {
    this.requested = new URLSearchParams(location.search).has('mesure');
    this.enabled = this.requested;
    this.samples = [];
    this.cpu = [];
    this.phase = -1;
    this.date = new Date(2026, 5, 21, 13);
  }
  begin(timestamp, camera, world) {
    if (!this.enabled || !world) return;
    if (this.start == null) {
      this.start = timestamp;
      this.origin = camera.position.clone();
      world.setProfiling(true);
    }
    if (this.previous != null && timestamp - this.previous > 1000) {
      console.log('[worldpaint mesure]', 'Relevé interrompu : pause de plus d’une seconde. Recharger pour recommencer.');
      this.enabled = false;
      return;
    }
    const elapsed = (timestamp - this.start) / 1000;
    const phase = elapsed < 5 ? 0 : elapsed < 15 ? 1 : elapsed < 30 ? 2 : 3;
    if (phase !== this.phase) {
      if (this.phase > 0) this.report(world);
      this.samples.length = 0;
      this.cpu.length = 0;
      world.resetGenerationStats();
      this.phase = phase;
      this.previous = null;
      if (phase === 3) {
        const here = world.frame.toLngLat(camera.position.x, camera.position.z);
        world.refresh(here.lng, here.lat, { force: true }).then(result => {
          this.report(world);
          console.log('[worldpaint mesure]', JSON.stringify({ reconstructionTerminee: result }));
          this.enabled = false;
        }).catch(error => { console.error('[worldpaint mesure]', error); this.enabled = false; });
      }
    }
    if (phase === 2) camera.position.x = this.origin.x + Math.min(elapsed - 15, 15) * 22;
    if (this.previous != null && this.samples.length < 12000) this.samples.push(timestamp - this.previous);
    this.previous = timestamp;
    this.frameStart = performance.now();
  }
  end(renderer) {
    if (!this.enabled || this.frameStart == null) return;
    if (this.cpu.length < 12000) this.cpu.push(performance.now() - this.frameStart);
    this.render = { appels: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
  report(world) {
    const summary = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return { medianeMs: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1) };
    };
    console.log('[worldpaint mesure]', JSON.stringify({
      phase: ['chauffe', 'immobile', 'déplacement', 'reconstruction'][this.phase],
      images: this.samples.length, intervalles: summary(this.samples), cpu: summary(this.cpu),
      plusDe50Ms: this.samples.filter(t => t > 50).length, rendu: this.render,
      couches: world.generationStats,
    }));
  }
}
