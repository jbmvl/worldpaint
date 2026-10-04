/* Géométrie de l'eau : différences exactes de convexes, interpolation des
 * attributs et index local. Le rendu injecte sa triangulation ; aucune copie
 * de THREE ni décision d'altitude ne vit ici. */
export const WATER_GEOMETRY_EPS = 1e-8;
export const cross = (a, b, p) => (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
export function signedArea(points) {
  return points.reduce((s,p,i) => {const q=points[(i+1)%points.length]; return s+p.x*q.z-p.z*q.x;},0)/2;
}
export const area = p => Math.abs(signedArea(p));
export function boundsOf(points) {
  return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
}
export const overlap = (a,b) => a.minX<=b.maxX+WATER_GEOMETRY_EPS && a.maxX>=b.minX-WATER_GEOMETRY_EPS && a.minZ<=b.maxZ+WATER_GEOMETRY_EPS && a.maxZ>=b.minZ-WATER_GEOMETRY_EPS;
export function interpolate(a,b,t) {
  const p={};
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {
    if(typeof a[key]==='number' && typeof b[key]==='number')p[key]=a[key]+(b[key]-a[key])*t;
    else if(Array.isArray(a[key]) && Array.isArray(b[key]))p[key]=a[key].map((v,i)=>v+(b[key][i]-v)*t);
    else p[key]=a[key]??b[key];
  }
  return p;
}
function clean(points) {
  const out=points.filter((p,i)=>Math.hypot(p.x-points[(i+points.length-1)%points.length].x,p.z-points[(i+points.length-1)%points.length].z)>WATER_GEOMETRY_EPS);
  return out.length>=3 && area(out)>WATER_GEOMETRY_EPS ? out : [];
}
export function splitHalfPlane(subject, distance) {
  const inside=[],outside=[];
  for(let i=0;i<subject.length;i++) {
    const a=subject[i],b=subject[(i+1)%subject.length],da=distance(a),db=distance(b);
    if(da>=0)inside.push(a); else outside.push(a);
    if((da>0 && db<0)||(da<0 && db>0)) {
      const p=interpolate(a,b,da/(da-db)); inside.push(p); outside.push(p);
    } else if(da===0)outside.push(a);
  }
  return {inside:clean(inside),outside:clean(outside)};
}
export function intersectConvex(subject,clip) {
  let kept=subject; const sign=signedArea(clip)>=0?1:-1;
  for(let i=0;i<clip.length && kept.length;i++) {
    const a=clip[i],b=clip[(i+1)%clip.length]; kept=splitHalfPlane(kept,p=>sign*cross(a,b,p)).inside;
  }
  return kept;
}
export function subtractConvex(subject,clip) {
  if(!overlap(boundsOf(subject),boundsOf(clip)) || !intersectConvex(subject,clip).length)return [subject];
  let kept=subject; const outside=[],sign=signedArea(clip)>=0?1:-1;
  for(let i=0;i<clip.length && kept.length;i++) {
    const a=clip[i],b=clip[(i+1)%clip.length],split=splitHalfPlane(kept,p=>sign*cross(a,b,p));
    if(split.outside.length)outside.push(split.outside); kept=split.inside;
  }
  return outside;
}
export function fan(points) {
  const out=[];
  for(let i=1;i+1<points.length;i++) {
    const t=[points[0],points[i],points[i+1]];
    if(area(t)>WATER_GEOMETRY_EPS)out.push(signedArea(t)>0?[t[0],t[2],t[1]]:t);
  }
  return out;
}
export function triangulateRings(rings,triangulateShape) {
  const prepared=rings.map(r=>r.length>1 && Math.hypot(r[0].x-r.at(-1).x,r[0].z-r.at(-1).z)<WATER_GEOMETRY_EPS?r.slice(0,-1):r.slice()).filter(r=>r.length>=3);
  if(!prepared.length)return [];
  // ShapeUtils attend x/y ; l'orientation finale x/z pointe toujours vers +y.
  const vector=p=>({x:p.x,y:p.z,equals(q){return this.x===q.x && this.y===q.y;}});
  const contour=prepared[0].map(vector),holes=prepared.slice(1).map(r=>r.map(vector));
  const vertices=prepared.flat();
  return triangulateShape(contour,holes).flatMap(indices=>fan(indices.map(i=>vertices[i])));
}
export function barycentric(p,triangle) {
  const [a,b,c]=triangle,d=cross(a,b,c);
  if(Math.abs(d)<WATER_GEOMETRY_EPS)return null;
  const weights=[cross(b,c,p)/d,cross(c,a,p)/d,cross(a,b,p)/d];
  return weights.every(w=>w>=-1e-7)?weights:null;
}
export function pointInRings(p,rings) {
  let inside=false;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}
export function segmentDistance(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
  return {distance:Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t),t,x:a.x+dx*t,z:a.z+dz*t};
}
export class TriangleGrid {
  constructor(triangles=[],cell=8) {this.cell=cell;this.buckets=new Map();this.triangles=[];for(const t of triangles)this.add(t);}
  _keys(bounds) {
    const out=[];for(let x=Math.floor(bounds.minX/this.cell);x<=Math.floor(bounds.maxX/this.cell);x++)for(let z=Math.floor(bounds.minZ/this.cell);z<=Math.floor(bounds.maxZ/this.cell);z++)out.push(`${x}/${z}`);return out;
  }
  add(triangle) {
    const index=this.triangles.length,bounds=boundsOf(triangle.points??triangle);this.triangles.push(triangle);
    for(const key of this._keys(bounds)) {let bucket=this.buckets.get(key);if(!bucket)this.buckets.set(key,bucket=[]);bucket.push(index);}
  }
  inBounds(bounds) {
    const ids=new Set();for(const key of this._keys(bounds))for(const i of this.buckets.get(key)??[])ids.add(i);
    return [...ids].sort((a,b)=>a-b).map(i=>this.triangles[i]).filter(t=>overlap(bounds,boundsOf(t.points??t)));
  }
}
export function partitionTriangles(candidates,protections=[]) {
  const accepted=[],index=new TriangleGrid(),obstacles=new TriangleGrid(protections);
  const sorted=candidates.slice().sort((a,b)=>(a.priority??0)-(b.priority??0)||a.sourceKey.localeCompare(b.sourceKey)||JSON.stringify(a.points).localeCompare(JSON.stringify(b.points)));
  for(const candidate of sorted) {
    let pieces=[candidate.points];
    for(const clip of [...index.inBounds(boundsOf(candidate.points)),...obstacles.inBounds(boundsOf(candidate.points))]) {
      pieces=pieces.flatMap(p=>subtractConvex(p,clip.points??clip));if(!pieces.length)break;
    }
    for(const points of pieces.flatMap(fan)) {const t={...candidate,points};accepted.push(t);index.add(t);}
  }
  return accepted;
}
/* Chaque arête est coupée aux extrémités voisines : deux triangles peuvent
 * partager seulement une partie d'un bord après une différence. */
export function boundarySegments(triangles,classify=()=> 'shore') {
  const edges=triangles.flatMap(t=>(t.points??t).map((a,i)=>({a,b:(t.points??t)[(i+1)%3],triangle:t})));
  const index=new TriangleGrid(edges.map(e=>({points:[e.a,e.b,e.b],edge:e}))),parts=new Map();
  const key=p=>`${Math.round(p.x*1e6)}/${Math.round(p.z*1e6)}`;
  for(const edge of edges) {
    const ts=[0,1],length=Math.hypot(edge.b.x-edge.a.x,edge.b.z-edge.a.z);
    if(length<1e-7)continue;
    for(const near of index.inBounds(boundsOf([edge.a,edge.b])))for(const p of [near.edge.a,near.edge.b]) {
      const hit=segmentDistance(p,edge.a,edge.b);
      if(hit.distance<1e-6 && hit.t>1e-8 && hit.t<1-1e-8)ts.push(hit.t);
    }
    ts.sort((a,b)=>a-b);
    for(let i=1;i<ts.length;i++) {
      if((ts[i]-ts[i-1])*length<1e-6)continue;
      const a=interpolate(edge.a,edge.b,ts[i-1]),b=interpolate(edge.a,edge.b,ts[i]);
      const ka=key(a),kb=key(b),k=ka<kb?`${ka}:${kb}`:`${kb}:${ka}`;
      const part=parts.get(k);if(part)part.count++;else parts.set(k,{a,b,count:1,triangle:edge.triangle});
    }
  }
  return [...parts.values()].filter(p=>p.count===1).map(p=>({...p,kind:classify(p)}));
}
