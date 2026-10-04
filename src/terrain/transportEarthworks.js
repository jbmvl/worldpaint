/*
 * Terrassements des franchissements : remblais doux et tranchées dans la même
 * maille, avec les mêmes matières que le terrain environnant. Les altitudes
 * sont absolues et issues du relief naturel ; les reconstructions ne cumulent
 * jamais les corrections. Le fond du passage inférieur reste libre ; les
 * chaussées voisines gardent un appui de terrain à leur propre altitude.
 * Un remblai voisin ne monte pas à travers un tablier. L'appui du rail
 * au-dessus d'une galerie est publié séparément et limité au franchissement.
 */
import { RoadIndex } from '../layers/roadGraph.js';
import { ROAD_CUT_BLEND_M, ROAD_CUT_M, roadCutMaskAt, lowestRoadDeckAt, cutElevationAt } from './roadCut.js';
import { WORK_BRIDGE } from '../layers/roadWorks.js';

const smooth = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;

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
    this.bridges = new RoadIndex(segments.filter(s=>s.works?.includes(WORK_BRIDGE)), {
      margin:bench+ROAD_CUT_BLEND_M,includeWorks:true,
    });
  }

  sample(x, z, raw) {
    let fill = raw, cut = Infinity, mask = 0, lowerRoom = Infinity;
    const visited = new Set();
    for (const hit of this.index.queryAll(x, z, this.reach)) {
      const { segment: s, row: r, t, distance } = hit;
      if (visited.has(s)) continue;
      visited.add(s);
      const delta = lerp(s.delta[r], s.delta[r + 1], t);
      const deck = this.index.deckAt(hit);
      if (deck == null || Math.abs(delta) < 0.001) continue;
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
    let elevation = Math.min(fill, cut), supported = false, railSupport = -Infinity;
    if (cut < raw) {
      const seen = new Set();
      for (const hit of this.supports.queryAll(x, z, this.bench + ROAD_CUT_BLEND_M)) {
        const { segment: s, row: r, t, distance } = hit;
        if (seen.has(s)) continue;
        seen.add(s);
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
        const along=lerp(s.path[r].distance,s.path[r+1].distance,t);
        if (rail && distance <= s.halfWidth + ROAD_CUT_M && s.tunnelSupports?.some(support=>
          Math.abs(along-support.distance)<=(support.halfWidth+this.bench)/support.sin))
          railSupport = Math.max(railSupport, target);
        if (target > elevation + 0.001) { elevation = target; supported = true; }
      }
    }
    if(elevation>raw)for(const hit of this.bridges.queryAll(x,z,this.bench+ROAD_CUT_BLEND_M)) {
      if(hit.segment.works[hit.row]!==WORK_BRIDGE || hit.segment.works[hit.row+1]!==WORK_BRIDGE)continue;
      const deck=lowestRoadDeckAt(hit,this.bench)/this.scale;
      elevation=Math.max(raw,cutElevationAt(elevation,deck,hit.distance,hit.segment.halfWidth,this.bench));
    }
    return { elevation, mask, supported, railSupport };
  }
}
