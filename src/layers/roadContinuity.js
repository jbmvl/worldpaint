/*
 * Mémoire des abscisses routières dans un repère de génération. Une extension
 * de la fenêtre vectorielle ne redéfinit ni l'origine ni le sens d'une route
 * déjà vue. La mémoire est indépendante des maillages jetables du rendu.
 */
export class RoadContinuity {
  constructor() {
    this.vertices = new Map();
  }

  resolve(chain) {
    const key = (p, i) => `${chain.profile}:${chain.levels?.[i] ?? 0}:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`;
    let match = -1;
    let saved;
    for (let i = 0; i < chain.points.length; i++) {
      const entry = this.vertices.get(key(chain.points[i], i));
      if (entry) { match = i; saved = entry; break; }
    }
    if (saved) {
      const a = chain.points[Math.max(0, match - 1)];
      const b = chain.points[Math.min(chain.points.length - 1, match + 1)];
      if ((b.x - a.x) * saved.dx + (b.z - a.z) * saved.dz < 0) {
        for (const name of ['points', 'anchors', 'works', 'levels', 'oneway']) chain[name]?.reverse();
        if (chain.oneway) chain.oneway = chain.oneway.map(v => -v);
        match = chain.points.length - 1 - match;
      }
    }
    const distance = new Float64Array(chain.points.length);
    for (let i = 1; i < distance.length; i++) {
      distance[i] = distance[i - 1] + Math.hypot(chain.points[i].x - chain.points[i - 1].x, chain.points[i].z - chain.points[i - 1].z);
    }
    const anchor = saved?.anchor ?? { ...chain.points[chain.anchors?.findIndex(Boolean) >= 0 ? chain.anchors.findIndex(Boolean) : 0] };
    const originIndex = saved ? match : Math.max(0, chain.anchors?.findIndex(Boolean) ?? 0);
    const offset = (saved?.distance ?? 0) - distance[originIndex];
    for (let i = 0; i < distance.length; i++) {
      distance[i] += offset;
      const a = chain.points[Math.max(0, i - 1)];
      const b = chain.points[Math.min(distance.length - 1, i + 1)];
      const id = key(chain.points[i], i);
      if (!this.vertices.has(id)) this.vertices.set(id, { distance: distance[i], anchor, dx: b.x - a.x, dz: b.z - a.z });
    }
    return { distance, anchor };
  }
}
