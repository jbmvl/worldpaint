/*
 * Bouches rattachées aux arêtes du graphe, avant les ouvrages. Les intervalles
 * découpent uniquement leurs propres chaînes ; les cotes sont lues après les
 * terrassements. Ruban et dalle partagent les cinq sommets de chaque bouche.
 */
import { RIBBON_COLUMNS } from './ribbonGeometry.js';
const JUNCTION_SEAM_COLUMNS = RIBBON_COLUMNS;

function projection(path, point) {
  let best = null;
  for (let row = 0; row < path.length - 1; row++) {
    const a = path[row], b = path[row + 1], dx = b.x-a.x, dz = b.z-a.z;
    const rawT=((point.x-a.x)*dx+(point.z-a.z)*dz)/(dx*dx+dz*dz || 1);
    const t = Math.max(0, Math.min(1, rawT));
    const error = Math.hypot(a.x+dx*t-point.x, a.z+dz*t-point.z);
    if (!best || error < best.error) best = { row, t, rawT, error, distance: a.distance+(b.distance-a.distance)*t, dx, dz };
  }
  return best;
}

export function bindJunctionSeams(segments, areas) {
  for (const segment of segments) { segment.junctionSeams = []; segment.junctionRing = -1; }
  for (const [index, area] of areas.areas.entries()) {
    if (area.ringEdges) for (const segment of segments) {
      if (segment.graphEdges?.size && [...segment.graphEdges].every(edge=>area.ringEdges.has(edge))) {
        segment.junctionRing=index;
        areas.feeders[index].add(segment);
      }
    }
    for (const [rank, mouth] of area.mouths.entries()) {
      if (!mouth.edge) continue;
      let owner = null;
      for (const segment of segments) {
        if (!segment.graphEdges?.has(mouth.edge)) continue;
        const hit = projection(segment.path, mouth.centre);
        if ((hit.row===0 && hit.rawT < -1e-6) || (hit.row===segment.path.length-2 && hit.rawT>1+1e-6)) continue;
        if (!owner || hit.error < owner.hit.error) owner = { segment, hit };
      }
      if (!owner) continue;
      const { segment, hit } = owner;
      const outward = hit.dx*mouth.direction.x+hit.dz*mouth.direction.z >= 0 ? 1 : -1;
      const seam = { area, index, rank, mouth, segment, ...hit, outward };
      mouth.seam = seam;
      segment.junctionSeams.push(seam);
      areas.feeders[index].add(segment);
      const boundary = Array.from({length:JUNCTION_SEAM_COLUMNS}, (_,i) => {
        const t=i/(JUNCTION_SEAM_COLUMNS-1);
        return i===0 ? mouth.left : i===JUNCTION_SEAM_COLUMNS-1 ? mouth.right : {
          x:mouth.left.x+(mouth.right.x-mouth.left.x)*t,
          z:mouth.left.z+(mouth.right.z-mouth.left.z)*t, from:rank,to:rank,blend:0,
        };
      });
      mouth.boundary = boundary;
      const at=area.outline.indexOf(mouth.left);
      if (at>=0 && area.outline[(at+1)%area.outline.length]===mouth.right) {
        if (area.island) {
          const a=area.island[at], b=area.island[(at+1)%area.island.length];
          area.island.splice(at+1,0,...boundary.slice(1,-1).map((p,i)=>({
            ...p,x:a.x+(b.x-a.x)*(i+1)/(JUNCTION_SEAM_COLUMNS-1),z:a.z+(b.z-a.z)*(i+1)/(JUNCTION_SEAM_COLUMNS-1),
          })));
        }
        area.outline.splice(at+1,0,...boundary.slice(1,-1));
      }
    }
  }
}

export function updateJunctionSeams(areas) {
  for (const area of areas.areas) {
    area.decks=area.mouths.map(mouth=>{
      const seam=mouth.seam;
      if (!seam) return NaN;
      const {segment,row,t}=seam;
      const deck=Math.fround(segment.platform[row]+(segment.platform[row+1]-segment.platform[row])*t);
      for (const point of mouth.boundary) point.y=deck;
      return deck;
    });
    const finite=area.decks.filter(Number.isFinite);
    area.deck=finite.reduce((sum,y)=>sum+y,0)/finite.length;
  }
}

export function seamBoundary(seam) {
  const {mouth,segment,row,t,outward}=seam;
  const deck=Math.fround(segment.platform[row]+(segment.platform[row+1]-segment.platform[row])*t);
  const section = { left: outward>0 ? mouth.left : mouth.right, right: outward>0 ? mouth.right : mouth.left,
    vertices:outward>0 ? mouth.boundary.slice().reverse() : mouth.boundary };
  return { point:{...mouth.centre,distance:seam.distance,section}, deck, seam };
}

export function seamIntervals(segment) {
  if (segment.junctionRing>=0) return [{from:segment.path[0].distance,to:segment.path.at(-1).distance,index:segment.junctionRing}];
  const intervals=[];
  const groups=new Map();
  for(const seam of segment.junctionSeams || []) {
    if(!groups.has(seam.index)) groups.set(seam.index,[]);
    groups.get(seam.index).push(seam);
  }
  for(const seams of groups.values()) {
    const negative=seams.filter(s=>s.outward<0), positive=seams.filter(s=>s.outward>0);
    const left=negative.sort((a,b)=>a.distance-b.distance)[0];
    const right=positive.sort((a,b)=>b.distance-a.distance)[0];
    intervals.push({from:left?.distance ?? segment.path[0].distance,to:right?.distance ?? segment.path.at(-1).distance,left,right});
  }
  return intervals.sort((a,b)=>a.from-b.from);
}

export function seamRibbonRuns(segment, runs) {
  const intervals=seamIntervals(segment), out=[];
  const {path,platform}=segment;
  for(const run of runs || []) {
    let spans=[{from:path[run.from].distance,to:path[run.to].distance,head:null,tail:null}];
    for(const cut of intervals) spans=spans.flatMap(span=>{
      if(cut.to<=span.from || cut.from>=span.to) return [span];
      const pieces=[];
      if(cut.from>span.from) pieces.push({...span,to:cut.from,tail:cut.left});
      if(cut.to<span.to) pieces.push({...span,from:cut.to,head:cut.right});
      return pieces;
    });
    for(const span of spans) {
      const points=[], decks=[];
      if(span.head) {const b=seamBoundary(span.head);points.push(b.point);decks.push(b.deck);}
      for(let r=run.from;r<=run.to;r++) if(path[r].distance>=span.from && path[r].distance<=span.to &&
        !(span.head && Math.abs(path[r].distance-span.from)<1e-8) && !(span.tail && Math.abs(path[r].distance-span.to)<1e-8)) {
        points.push(path[r]);decks.push(platform[r]);
      }
      if(span.tail) {const b=seamBoundary(span.tail);points.push(b.point);decks.push(b.deck);}
      if(points.length>1) out.push({path:points,platform:Float32Array.from(decks),head:span.head?.index??-1,tail:span.tail?.index??-1});
    }
  }
  return out;
}
