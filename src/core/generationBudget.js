/* Les étapes de génération rendent la main après le budget CPU. Le délai
 * après requestAnimationFrame laisse le navigateur peindre avant la suite.
 * Hors navigateur, les mêmes étapes restent exécutables sans boucle de rendu.
 */
function pauseGeneration() {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
      let frame;
      const finish = () => { clearTimeout(fallback); cancelAnimationFrame(frame); resolve(); };
      const fallback = setTimeout(finish, 50);
      frame = requestAnimationFrame(() => setTimeout(finish, 0));
    } else setTimeout(resolve, 0);
  });
}
export class GenerationBudget {
  constructor({ milliseconds = 8, now = () => performance.now(), pause = pauseGeneration } = {}) {
    this.milliseconds = milliseconds;
    this.now = now;
    this.pause = pause;
    this.start = now();
  }
  async checkpoint() {
    if (this.now() - this.start < this.milliseconds) return;
    await this.pause();
    this.start = this.now();
  }
}
