/*
 * Interprétation des tunnels : passage bâti, passage inférieur court ou galerie
 * sous le relief. Les chaussées restent distinctes dans une enveloppe commune
 * lorsque leurs entrées, directions et niveaux concordent. La couverture se
 * mesure sur le terrain naturel ; seuls les accès sont excavés à ciel ouvert.
 */
import { WORK_TUNNEL, workRuns, raiseApproaches, BRIDGE_CLEARANCE_M } from './roadWorks.js';
import { intersection } from './transportCrossings.js';
import { RoadIndex } from './roadGraph.js';
import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { pointInAreas } from './settlement.js';
import { worksStyleAt } from './townStyle.js';
import { vaultProfile, PORTAL_CLEARANCE_M } from './tunnelGeometry.js';
import { defaultTheme } from '../themes/default.js';

export function collectTunnelBuildings(source, tiles, frame) {
  const polygons = [];
  source.forEachFeature('building', tiles, geometry => {
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const rings of parts) polygons.push(rings.map(ring => ring.map(([lng, lat]) => ({
      x: (lngToTileX(lng, frame.zoom) - frame.origin.x) * frame.scale,
      z: (latToTileY(lat, frame.zoom) - frame.origin.y) * frame.scale,
    }))));
  });
  return polygons;
}
const lerp = (a, b, t) => a + (b - a) * t;
const inBuilding = (polygons, p) => polygons.some(rings => pointInAreas([rings[0]], p.x, p.z) && !pointInAreas(rings.slice(1), p.x, p.z));

function coordinate(record, p) {
  const dx = p.x - record.a.x, dz = p.z - record.a.z;
  return { along: dx * record.dx + dz * record.dz, across: -dx * record.dz + dz * record.dx };
}
function compatible(a, b) {
  if (a.kind !== b.kind || a.level !== b.level || !a.complete || !b.complete) return false;
  if (Math.abs(a.dx * b.dx + a.dz * b.dz) < .985) return false;
  const ends = [coordinate(a, b.a), coordinate(a, b.b)].sort((p,q) => p.along-q.along);
  if (Math.abs(ends[0].along) > 6 || Math.abs(ends[1].along-a.length) > 6) return false;
  if (Math.max(...ends.map(p => Math.abs(p.across))) > a.segment.halfWidth+b.segment.halfWidth+3) return false;
  const heights = r => [r.segment.platform[r.run.from], r.segment.platform[r.run.to]].sort((x,y)=>x-y);
  return heights(a).every((h,i) => Math.abs(h-heights(b)[i]) <= 1.5);
}

export function resolveTunnelProfiles(segments, rails, elevation, { buildings = [], centres = [], theme = defaultTheme } = {}) {
  for (const segment of segments) segment.tunnelStructures = [];
  const tunnels = segments.filter(s=>s.works?.includes(WORK_TUNNEL));
  if (!tunnels.length) return 0;
  const index = new RoadIndex([...segments, ...rails], { margin: 0, includeWorks: true });
  const records = [];
  const before = new Map(tunnels.map(s=>[s,s.platform.slice()]));
  for (const segment of tunnels) {
    for (const run of workRuns(segment.works, WORK_TUNNEL)) {
      const a = segment.path[run.from], b = segment.path[run.to];
      const length = Math.hypot(b.x-a.x,b.z-a.z);
      if (length < .01) continue;
      const crossings = [];
      for (let r=run.from; r<run.to; r++) {
        const p=segment.path[r],q=segment.path[r+1];
        index.forEachNear(Math.min(p.x,q.x),Math.min(p.z,q.z),Math.max(p.x,q.x),Math.max(p.z,q.z),(upper,row)=>{
          if (upper===segment || upper.works?.[row]===WORK_TUNNEL || upper.works?.[row+1]===WORK_TUNNEL) return;
          if ((upper.levels?.[row]??0)<(segment.levels?.[r]??-1)) return;
          const hit=intersection(p,q,upper.path[row],upper.path[row+1]);
          if (hit) crossings.push({ height:lerp(upper.platform[row],upper.platform[row+1],hit.u), ...hit });
        });
      }
      const middle=segment.path[Math.floor((run.from+run.to)/2)];
      const kind=length<=40 && inBuilding(buildings,middle) ? 'building' : length<=80 && crossings.length ? 'underpass' : 'tunnel';
      records.push({segment,run,a,b,length,dx:(b.x-a.x)/length,dz:(b.z-a.z)/length,kind,crossings,
        level:segment.levels?.[run.from]??-1,complete:run.from>0 && run.to<segment.path.length-1});
    }
  }
  records.sort((a,b)=>a.a.x-b.a.x || a.a.z-b.a.z || a.b.x-b.b.x || a.b.z-b.b.z);
  const groups=[];
  for (const record of records) {
    // Une galerie courbe ne devient pas une corde qui couperait son virage.
    const straight = record.segment.path.slice(record.run.from,record.run.to+1).every(p=>Math.abs(coordinate(record,p).across)<.5);
    const group=straight && groups.find(g=>g.every(other=>other.straight && compatible(other,record)));
    record.straight=straight;
    if (group) group.push(record); else groups.push([record]);
  }
  const seeds=[];
  for (const group of groups) {
    const ref=group[0];
    let path, halfWidth=ref.segment.halfWidth;
    if (group.length===1) path=ref.segment.path.slice(ref.run.from,ref.run.to+1).map(p=>({...p,distance:p.distance-ref.a.distance}));
    else {
      let left=Infinity,right=-Infinity,start=Infinity,end=-Infinity;
      for (const member of group) for (const p of member.segment.path.slice(member.run.from,member.run.to+1)) {
        const c=coordinate(ref,p);
        left=Math.min(left,c.across-member.segment.halfWidth);right=Math.max(right,c.across+member.segment.halfWidth);
        start=Math.min(start,c.along);end=Math.max(end,c.along);
      }
      const across=(left+right)/2;halfWidth=(right-left)/2;
      const steps=Math.max(1,Math.ceil((end-start)/4));
      path=Array.from({length:steps+1},(_,i)=>{const along=lerp(start,end,i/steps);return {
        x:ref.a.x+ref.dx*along-ref.dz*across,z:ref.a.z+ref.dz*along+ref.dx*across,distance:along-start};});
    }
    const total=path.at(-1).distance;
    const ends=new Map(group.map(m=>[m,[m.segment.platform[m.run.from],m.segment.platform[m.run.to]]]));
    const floorAt=p=>Math.min(...group.map(m=>{
      const t=Math.max(0,Math.min(1,coordinate(m,p).along/m.length));
      return lerp(...ends.get(m),t);
    }));
    const platform=Float32Array.from(path,floorAt);
    const style=worksStyleAt(path[0].x,path[0].z,theme.works);
    const roofHeight=ref.kind==='underpass' ? BRIDGE_CLEARANCE_M-style.deck.thickness : Math.max(...vaultProfile(halfWidth,style.portal).map(p=>p.up));
    let depth=0;
    if (ref.kind==='underpass') {
      for(const member of group) for(const crossing of member.crossings) depth=Math.max(depth,floorAt(crossing)+roofHeight+style.deck.thickness-crossing.height);
    } else if (ref.kind==='tunnel' && total>30 && ref.complete) {
      for(let i=1;i<path.length-1;i++) depth=Math.max(depth,platform[i]+roofHeight+.5-elevation(path[i].x,path[i].z));
    }
    depth=Math.max(0,depth);
    for(let i=0;i<platform.length;i++) platform[i]-=depth;
    for(const member of group) {
      const s=member.segment;
      s.crossingBase ??= s.platform.slice();
      s.tunnelAccess = depth > 0 || group.length > 1;
      for(let r=member.run.from;r<=member.run.to;r++) s.platform[r]=floorAt(s.path[r])-depth;
      for(const row of [member.run.from,member.run.to]) {
        const lift=Math.max(0,before.get(s)[row]-s.platform[row]);
        // Un passage court rejoint rapidement ses rives ; le smoothstep
        // limite sa pente de pointe à 12 %, sans étendre toute la dépression.
        const reach=ref.kind==='underpass' ? Math.max(12,1.5*lift/.12) : undefined;
        seeds.push({segment:segments.indexOf(s),row,lift,reach,followChain:true});
      }
    }
    ref.segment.tunnelStructures.push({path,platform,halfWidth,kind:ref.kind,roofHeight,members:group.length,
      tunnelPortals:[group.every(m=>m.run.from>0),group.every(m=>m.run.to<m.segment.path.length-1)]});
  }
  raiseApproaches(segments,seeds,{centres,direction:-1});
  return groups.length;
}

/**
 * Chaussée et intrados de la voûte au point `(x, z)`, ou `null` hors de tout
 * ouvrage couvert. Ce que lit une caméra qui doit rester sous la voûte : le
 * terrain au-dessus n'est plus un plancher.
 * @returns {{floor:number, roof:number, kind:string}|null}
 */
export function tunnelAt(segments, x, z) {
  let best = null;
  let bestGap = Infinity;
  for (const segment of segments ?? []) {
    for (const s of segment.tunnelStructures ?? []) {
      const reach = s.halfWidth + PORTAL_CLEARANCE_M;
      for (let i = 1; i < s.path.length; i++) {
        const a = s.path[i - 1], b = s.path[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length2 = dx * dx + dz * dz;
        if (!length2) continue;
        const t = ((x - a.x) * dx + (z - a.z) * dz) / length2;
        if (t < 0 || t > 1) continue;
        const gap = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        if (gap > reach || gap >= bestGap) continue;
        bestGap = gap;
        const floor = lerp(s.platform[i - 1], s.platform[i], t);
        best = { floor, roof: floor + s.roofHeight, kind: s.kind };
      }
    }
  }
  return best;
}
