/*
 * Bouches rattachées aux arêtes du graphe, avant les ouvrages. Les intervalles
 * découpent uniquement leurs propres chaînes ; les cotes sont lues après les
 * terrassements. Ruban et dalle partagent les cinq sommets de chaque bouche.
 * La bouche suit toutes les arêtes de sa branche, même après une coupure de
 * chaîne ; une courte sortie se ferme sur son axe publié, sans extrapolation.
 * Une bouche seule ne retranche que le trajet jusqu'à son nœud d'origine :
 * la chaîne peut continuer ailleurs, après un coude ou un changement de classe.
 */
import { RIBBON_COLUMNS, slicePath } from './ribbonGeometry.js';
import { junctionTriangles } from './junctionTriangulation.js';
const JUNCTION_SEAM_COLUMNS = RIBBON_COLUMNS;
const intervalCache = new WeakMap();

/** Une branche peut traverser plusieurs chaînes ; sa bouche reste dans leurs axes publiés. */
export function boundJunctionBranches(junctions,segments) {
  const owners=new Map();
  for(const segment of segments)for(const edge of segment.graphEdges ?? []) {
    if(!owners.has(edge))owners.set(edge,new Set());
    owners.get(edge).add(segment);
  }
  for(const junction of junctions)for(const branch of junction.branches) {
    const origin=branch.path?.[0] ?? junction;
    const candidates=new Set([...(branch.edges ?? [branch.edge])].flatMap(edge=>[...(owners.get(edge) ?? [])]));
    let limit=-Infinity;
    for(const s of candidates)for(const p of s.path) {
      if(branch.path?.length && projection(branch.path,p).error>branch.halfWidth)continue;
      limit=Math.max(limit,(p.x-origin.x)*branch.x+(p.z-origin.z)*branch.z);
    }
    if(limit>0 && limit<(branch.mouthLimit ?? Infinity)) {
      branch.mouthLimit=limit;
      branch.boundedEnd=true;
    }
  }
}

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
      let owner = null, end = null;
      for (const segment of segments) {
        if (!segment.graphEdges?.has(mouth.edge) &&
            ![...(mouth.graphEdges ?? [])].some(edge=>segment.graphEdges?.has(edge))) continue;
        const hit = projection(segment.path, mouth.centre);
        if ((hit.row===0 && hit.rawT < -1e-6) || (hit.row===segment.path.length-2 && hit.rawT>1+1e-6)) {
          if(!end || hit.error<end.hit.error)end={segment,hit};
          continue;
        }
        if(hit.error>mouth.halfWidth)continue;
        if (!owner || hit.error < owner.hit.error) owner = { segment, hit };
      }
      // Une courte sortie entièrement prise par la dalle se ferme au bout
      // de sa propre chaîne ; elle n’emprunte jamais une voie voisine.
      if(!owner && end && end.hit.error<=mouth.halfWidth) {
        owner=end;
        const {segment,hit}=end,a=segment.path[hit.row],b=segment.path[hit.row+1];
        const length=Math.hypot(hit.dx,hit.dz),sign=hit.dx*mouth.direction.x+hit.dz*mouth.direction.z>=0?1:-1;
        mouth.direction={x:sign*hit.dx/length,z:sign*hit.dz/length};
        mouth.centre={x:a.x+(b.x-a.x)*hit.t,z:a.z+(b.z-a.z)*hit.t};
        Object.assign(mouth.left,{x:mouth.centre.x+mouth.direction.z*mouth.halfWidth,z:mouth.centre.z-mouth.direction.x*mouth.halfWidth});
        Object.assign(mouth.right,{x:mouth.centre.x-mouth.direction.z*mouth.halfWidth,z:mouth.centre.z+mouth.direction.x*mouth.halfWidth});
      }
      if (!owner) continue;
      const { segment, hit } = owner;
      const outward = hit.dx*mouth.direction.x+hit.dz*mouth.direction.z >= 0 ? 1 : -1;
      const originDistance = projection(segment.path, mouth.origin ?? area).distance;
      const seam = { area, index, rank, mouth, segment, ...hit, outward, originDistance };
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
    area.terrainCovered=area.mouths.every(mouth=>{
      const seam=mouth.seam;
      return seam && seam.segment.works?.[seam.row] && seam.segment.works?.[seam.row+1];
    });
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
  const cached=intervalCache.get(segment);
  if(cached?.path===segment.path && cached.seams===segment.junctionSeams)return cached.intervals;
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
    const covered=coveredDistances(segment.path,seams[0].area);
    const extent=seam=>covered.find(c=>c.from<=seam.distance+1e-4 && c.to>=seam.distance-1e-4);
    const from=left?.distance ?? Math.min(...seams.map(s=>Math.min(extent(s)?.from ?? s.distance,s.originDistance ?? s.distance)));
    const to=right?.distance ?? Math.max(...seams.map(s=>Math.max(extent(s)?.to ?? s.distance,s.originDistance ?? s.distance)));
    // Une union publie déjà les coutures extérieures de ses rubans intérieurs.
    // Les réinsérer à chaque encoche du contour doublerait leur dalle commune.
    const parts=seams[0].area.noeuds ? [{from,to}] : covered;
    for(const part of parts) {
      const low=Math.max(from,part.from),high=Math.min(to,part.to);
      if(high>low)intervals.push({from:low,to:high,index:seams[0].index,
        left:left && Math.abs(low-left.distance)<1e-4 ? left : null,
        right:right && Math.abs(high-right.distance)<1e-4 ? right : null});
    }
  }
  intervals.sort((a,b)=>a.from-b.from);
  intervalCache.set(segment,{path:segment.path,seams:segment.junctionSeams,intervals});
  return intervals;
}

// Une chaîne peut traverser la dalle et repartir après un coude : seule la
// composante couverte qui touche sa bouche appartient à ce carrefour.
function coveredDistances(path,area) {
  const {vertices,triangles}=junctionTriangles(area),pieces=[];
  const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
  for(let row=1;row<path.length;row++) {
    const p=path[row-1],q=path[row];
    for(const indices of triangles) {
      const tri=indices.map(i=>vertices[i]),sign=Math.sign(cross(...tri));
      let from=0,to=1;
      for(let i=0;i<3 && from<=to;i++) {
        const a=tri[i],b=tri[(i+1)%3],dp=sign*cross(a,b,p),dq=sign*cross(a,b,q);
        if(dp<0 && dq<0) {to=-1;break;}
        if((dp<0)!==(dq<0)) {
          const t=dp/(dp-dq);
          if(dp<0)from=Math.max(from,t);else to=Math.min(to,t);
        }
      }
      if(from<=to)pieces.push({from:p.distance+(q.distance-p.distance)*from,to:p.distance+(q.distance-p.distance)*to});
    }
  }
  const merged=[];
  for(const piece of pieces.sort((a,b)=>a.from-b.from)) {
    const last=merged.at(-1);
    if(last && piece.from<=last.to+1e-5)last.to=Math.max(last.to,piece.to);
    else merged.push({...piece});
  }
  return merged;
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
      const piece=slicePath(path,platform,span.from,span.to);
      if(!piece)continue;
      for(const [seam,row] of [[span.head,0],[span.tail,piece.path.length-1]])if(seam) {
        const boundary=seamBoundary(seam);
        piece.path[row]=boundary.point;piece.platform[row]=boundary.deck;
      }
      out.push({...piece,head:span.head?.index??-1,tail:span.tail?.index??-1});
    }
  }
  return out;
}
