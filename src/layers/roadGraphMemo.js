/*
 * roadGraphMemo — ce que le réseau lit dans les tuiles, gardé d'une
 * reconstruction à la suivante.
 *
 * Lignes, chaînes et carrefours ne dépendent que des tuiles décodées, du
 * repère et du thème : un observateur qui avance sans changer de tuiles relit
 * le même graphe, et le décor se refait bien plus souvent que les tuiles ne
 * changent. Ce qui dépend de lui (portée, largeurs partagées, cotes) se
 * recalcule à chaque fois, sur des copies : le partage des largeurs et
 * `RoadContinuity` écrivent sur les chaînes et les carrefours qu'ils reçoivent.
 *
 * Une source qui ne publie pas ses tuiles décodées (`entriesOf`) n'est jamais
 * reconnue : rien n'est gardé, tout est relu.
 */

const copyChain = (chain) => ({
  ...chain,
  points: chain.points.slice(),
  anchors: chain.anchors?.slice(),
  works: chain.works?.slice(),
  levels: chain.levels?.slice(),
  oneway: chain.oneway?.slice(),
});

const copyJunction = (junction) => ({ ...junction, branches: junction.branches.map((branch) => ({ ...branch })) });

export class RoadGraphMemo {
  constructor() {
    this._entries = null;
    this._frame = null;
    this._theme = null;
    this._urban = false;
    this._kept = new Map();
  }

  /**
   * Oublie ce qui est gardé si les tuiles, le repère, le thème ou la présence
   * d'une ville ont changé. Rend faux quand la source ne se laisse pas reconnaître.
   */
  _recognise(source, tiles, frame, roads, urban) {
    const entries = source?.entriesOf?.(tiles);
    if (!entries) return false;
    const same =
      this._entries &&
      this._frame === frame &&
      this._theme === roads &&
      this._urban === !!urban?.any &&
      this._entries.length === entries.length &&
      entries.every((entry, i) => entry === this._entries[i]);
    if (!same) {
      this._entries = entries;
      this._frame = frame;
      this._theme = roads;
      this._urban = !!urban?.any;
      this._kept.clear();
    }
    return true;
  }

  _keep(name, context, build) {
    if (!this._recognise(...context)) return build();
    if (!this._kept.has(name)) this._kept.set(name, build());
    return this._kept.get(name);
  }

  /** Chaînes et carrefours du graphe, en copies que l'appelant peut modifier. */
  graph(context, build) {
    const { chains, junctions } = this._keep('graph', context, build);
    return { chains: chains.map(copyChain), junctions: junctions.map(copyJunction) };
  }

  /** Emprises bâties lues pour les tunnels : jamais modifiées, rendues telles quelles. */
  tunnelBuildings(context, build) {
    return this._keep('tunnelBuildings', context, build);
  }
}
