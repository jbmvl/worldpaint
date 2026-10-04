import { MAX_WATER_REPAIR_M } from '../core/waterProfiles.js';
/* Remplacement local du rendu régulier : le support reste complet. Les
 * fragments gardent les sommets sources et leurs poids pour le grain GPU ;
 * les raccords sont coupés sur chaque triangle, diagonale b–c comprise. */
import {boundsOf,intersectConvex,subtractConvex,fan,barycentric,interpolate,TriangleGrid} from '../core/waterGeometry.js';
function clipSegment(a,b,triangle) {
  const wa=barycentricUnbounded(a,triangle),wb=barycentricUnbounded(b,triangle);if(!wa||!wb)return null;
  let lo=0,hi=1;
  for(let i=0;i<3;i++) {const d=wb[i]-wa[i];if(Math.abs(d)<1e-12){if(wa[i]<-1e-7)return null;}else if(d>0)lo=Math.max(lo,-wa[i]/d);else hi=Math.min(hi,-wa[i]/d);}
  if(hi-lo<1e-8)return null;return [interpolate(a,b,lo),interpolate(a,b,hi)];
}
function barycentricUnbounded(p,t) {
  const [a,b,c]=t,d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-12)return null;
  const x=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/d,y=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/d;return [x,y,1-x-y];
}
export function cutWaterTerrain(geometry,index,verticalScale=1) {
  const intact=[],fragments=[],banks=[],conflicts=[],p=geometry.getAttribute('position').array,n=geometry.getAttribute('normal').array,m=geometry.getAttribute('roadMask')?.array,indices=geometry.index.array;
  if (!index || !index.trianglesInBounds(boundsOf([{x:p[0],z:p[2]},{x:p[p.length-3],z:p[p.length-1]}])).length) return {intact:Array.from(indices),fragments,banks,conflicts};
  const sources=[];
  for(let k=0;k<indices.length;k+=3) {
    const ids=[indices[k],indices[k+1],indices[k+2]],source=ids.map(i=>({x:p[i*3],y:p[i*3+1],z:p[i*3+2],normal:[n[i*3],n[i*3+1],n[i*3+2]],mask:m?.[i]??0})),bounds=boundsOf(source),water=index?.trianglesInBounds(bounds)??[];
    let pieces=[source.map((v,i)=>({...v,weights:[i===0?1:0,i===1?1:0,i===2?1:0]}))],changed=false;
    for(const t of water) {
      if(!intersectConvex(source,t.points).length)continue;changed=true;pieces=pieces.flatMap(s=>subtractConvex(s,t.points));if(!pieces.length)break;
    }
    if(!changed)intact.push(...ids);else for(const points of pieces.flatMap(fan))fragments.push({source,points,waterSide:0});
    if(index?.boundarySegmentsInBounds(bounds).length)sources.push({points:source,source});
  }
  const sourceGrid=new TriangleGrid(sources),seen=new Set();
  for(const edge of index?.boundaries??[]) {
    if(edge.kind==='tile'||edge.kind==='internal')continue;
    for(const t of sourceGrid.inBounds(boundsOf([edge.a,edge.b]))) {
      const cut=clipSegment(edge.a,edge.b,t.source);if(!cut)continue;
      const points=cut.map(q=> {
        const weights=barycentricUnbounded(q,t.source),y=weights.reduce((sum,w,i)=>sum+w*t.source[i].y,0);
        return {...q,y,weights,normal:weights.map((_,c)=>weights.reduce((s,w,i)=>s+w*t.source[i].normal[c],0)),mask:weights.reduce((s,w,i)=>s+w*t.source[i].mask,0)};
      });
      const key=points.map(q=>`${Math.round(q.x*1e5)}/${Math.round(q.z*1e5)}`).sort().join(':');if(seen.has(key))continue;seen.add(key);
      if (points.some(p=>p.levelM-p.y/verticalScale>0.03 || p.y/verticalScale-p.levelM>MAX_WATER_REPAIR_M)) {
        conflicts.push({sourceKey:edge.triangle.sourceKey,status:'conflict',reason:'raccord incompatible avec le terrain affiché'});
      }
      const [a,b]=points,c={...a,y:a.levelM*verticalScale,waterSide:1},d={...b,y:b.levelM*verticalScale,waterSide:1};
      banks.push({source:t.source,points:[a,b,c],kind:edge.kind},{source:t.source,points:[b,d,c],kind:edge.kind});
    }
  }
  return {intact,fragments,banks,conflicts};
}
export function terrainFragmentGeometry(THREE,cut,grainAmplitude=0) {
  const attributes={position:[],normal:[],roadMask:[],sourceA:[],sourceB:[],sourceC:[],sourceNormalA:[],sourceNormalB:[],sourceNormalC:[],sourceRoadMasks:[],sourceWeights:[],waterSide:[]};
  for(const piece of [...cut.fragments,...cut.banks])for(const p of piece.points) {
    attributes.position.push(p.x,p.y,p.z);attributes.normal.push(...(p.normal??[0,1,0]));attributes.roadMask.push(p.mask??0);
    for(let i=0;i<3;i++) {const s=piece.source[i],letter='ABC'[i];attributes[`source${letter}`].push(s.x,s.y,s.z);attributes[`sourceNormal${letter}`].push(...s.normal);}
    attributes.sourceRoadMasks.push(...piece.source.map(s=>s.mask));attributes.sourceWeights.push(...p.weights);attributes.waterSide.push(p.waterSide??0);
  }
  const geometry=new THREE.BufferGeometry();
  for(const [name,values] of Object.entries(attributes))geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,['roadMask','waterSide'].includes(name)?1:3));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=grainAmplitude;
  return geometry;
}
