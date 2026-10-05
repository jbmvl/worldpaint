/*
 * Terrassements des franchissements : remblais doux et tranchées dans la même
 * maille, avec les mêmes matières que le terrain environnant. Les altitudes
 * sont absolues et issues du relief naturel ; les reconstructions ne cumulent
 * jamais les corrections. Le fond du passage inférieur reste libre ; les
 * chaussées voisines gardent un appui de terrain à leur propre altitude.
 */
import { RoadIndex } from '../layers/roadGraph.js';
import { ROAD_CUT_BLEND_M, ROAD_CUT_M, roadCutMaskAt } from './roadCut.js';

const smooth = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;
/** Vrai si un tronçon plus proche de la liste est déjà celui du rang `i` : seule sa ligne la plus proche compte. */
/** Même question sur un relevé à plat (`RoadIndex.collect`), sans ordre : à distance égale, le premier relevé l'emporte. */
const closerOnSegment = (segments, distances, count, i) => {
  for (let j = 0; j < count; j++) {
    if (j !== i && segments[j] === segments[i] && (distances[j] < distances[i] || (distances[j] === distances[i] && j < i))) return true;
  }
  return false;
};
const alreadyMet = (hits, i) => {
  for (let j = 0; j < i; j++) if (hits[j].segment === hits[i].segment) return true;
  return false;
};

export class TransportEarthworks {
  constructor(segments, { bench = 1.2, scale = 1 } = {}) {
    this.bench = bench;
    this.scale = scale || 1;
    this.reach = bench + ROAD_CUT_BLEND_M;
    this.segments = [];
    for (const segment of segments) {
      if (!segment.crossingBase) continue;
      let changed = false;
      const delta = Float32Array.from(segment.platform, (h, r) => h - segment.crossingBase[r]);
      for (let r = 0; r < delta.length; r++) {
        if (!segment.works?.[r] && Math.abs(delta[r]) > 0.001) changed = true;
        if (delta[r] > 0) this.reach = Math.max(this.reach, bench + Math.max(12, delta[r] * 4.5));
      }
      if (changed) this.segments.push({ ...segment, delta });
    }
    this.index = new RoadIndex(this.segments, { margin: this.reach });
    this.supports = new RoadIndex(segments.filter((s) => s.paved || s.profile === 'rail'), { margin: bench + ROAD_CUT_BLEND_M });
  }

  sample(x, z, raw) {
    const count = this.index.collect(x, z, this.reach);
    if (count === 0) return { elevation: raw, mask: 0, supported: false };
    const { segments, rows, ts, distances, decks } = this.index.found;
    let fill = raw, cut = Infinity, mask = 0, lowerRoom = Infinity;
    for (let i = 0; i < count; i++) {
      const s = segments[i], r = rows[i], t = ts[i], distance = distances[i];
      if (closerOnSegment(segments, distances, count, i)) continue;
      const delta = lerp(s.delta[r], s.delta[r + 1], t);
      const deck = decks[i];
      if (deck !== deck || Math.abs(delta) < 0.001) continue;
      const edge = s.halfWidth + this.bench;
      const blend = delta > 0 ? Math.max(12, delta * 4.5) : ROAD_CUT_BLEND_M;
      const weight = 1 - smooth((distance - edge) / blend);
      if (!weight) continue;
      const target = lerp(raw, deck / this.scale, weight);
      if (delta > 0) fill = Math.max(fill, target);
      else {
        cut = Math.min(cut, target);
        lowerRoom = Math.min(lowerRoom, Math.max(0, distance - s.halfWidth));
      }
      mask = Math.max(mask, roadCutMaskAt(distance, s.halfWidth, this.bench));
    }
    let elevation = Math.min(fill, cut), supported = false;
    if (cut < raw) {
      const supports = this.supports.queryAll(x, z, this.bench + ROAD_CUT_BLEND_M);
      for (let i = 0; i < supports.length; i++) {
        const hit = supports[i];
        const { segment: s, row: r, t, distance } = hit;
        if (alreadyMet(supports, i)) continue;
        const rail = s.profile === 'rail';
        if (!rail && lowerRoom <= 0) continue;
        const deck = this.supports.deckAt(hit);
        const base = s.crossingBase && lerp(s.crossingBase[r], s.crossingBase[r + 1], t);
        if (base == null || (!rail && deck < base - 0.001) || deck / this.scale <= elevation) continue;
        // Un rail garde son profil prescrit, y compris au-dessus d’un tunnel.
        // Une route voisine se raccorde hors du fond de la tranchée.
        const edge = s.halfWidth + (rail ? ROAD_CUT_M : Math.min(this.bench, lowerRoom / 2));
        const weight = (1 - smooth((distance - edge) / ROAD_CUT_BLEND_M)) * (rail ? 1 : smooth(lowerRoom / this.bench));
        const target = lerp(Math.min(fill, cut), deck / this.scale, weight);
        if (target > elevation + 0.001) { elevation = target; supported = true; }
      }
    }
    return { elevation, mask, supported };
  }
}
