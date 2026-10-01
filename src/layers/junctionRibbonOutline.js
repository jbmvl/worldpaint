/*
 * Contour extérieur de rubans qui se recouvrent à une fourche aveugle.
 * Les arêtes sont découpées à leurs intersections ; seules celles séparant
 * chaussée et extérieur sont retenues. Aucune largeur ni connexion n'est créée.
 */
const cross=(a,b)=>a.x*b.z-a.z*b.x;
const inside=(ring,p)=>{
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)result=!result;
  }
  return result;
};
const key=p=>`${Math.round(p.x*1e7)}:${Math.round(p.z*1e7)}`;

export function junctionRibbonOutline(ribbons) {
  const edges=ribbons.flatMap(ring=>ring.map((a,i)=>({a,b:ring[(i+1)%ring.length],cuts:[0,1]})));
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++) {
    const a=edges[i],b=edges[j],u={x:a.b.x-a.a.x,z:a.b.z-a.a.z},v={x:b.b.x-b.a.x,z:b.b.z-b.a.z},w={x:b.a.x-a.a.x,z:b.a.z-a.a.z};
    const det=cross(u,v);
    if(Math.abs(det)>1e-10) {
      const t=cross(w,v)/det,s=cross(w,u)/det;
      if(t>=0 && t<=1 && s>=0 && s<=1){a.cuts.push(t);b.cuts.push(s);}
    } else if(Math.abs(cross(w,u))<1e-8) {
      for(const [edge,other,d]of [[a,b,u],[b,a,v]])for(const p of [other.a,other.b]) {
        const t=((p.x-edge.a.x)*d.x+(p.z-edge.a.z)*d.z)/(d.x*d.x+d.z*d.z || 1);
        if(t>0 && t<1)edge.cuts.push(t);
      }
    }
  }
  const boundary=new Map(),vertices=new Map();
  const vertex=p=>{const k=key(p);if(!vertices.has(k))vertices.set(k,p);return vertices.get(k)};
  for(const {a,b,cuts}of edges) {
    cuts.sort((a,b)=>a-b);
    const at=t=>t===0?a:t===1?b:{...a,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
    for(let i=1;i<cuts.length;i++) {
      if(cuts[i]-cuts[i-1]<1e-9)continue;
      const p=at(cuts[i-1]),q=at(cuts[i]),dx=q.x-p.x,dz=q.z-p.z,length=Math.hypot(dx,dz);
      if(length<1e-8)continue;
      const middle={x:(p.x+q.x)/2,z:(p.z+q.z)/2},epsilon=Math.min(1e-6,length*.01);
      const left={x:middle.x-dz/length*epsilon,z:middle.z+dx/length*epsilon};
      const right={x:middle.x+dz/length*epsilon,z:middle.z-dx/length*epsilon};
      if(ribbons.some(r=>inside(r,left)) && !ribbons.some(r=>inside(r,right)))
        boundary.set(key(p),{a:vertex(p),b:vertex(q)});
    }
  }
  const first=boundary.values().next().value;
  if(!first)return [];
  const outline=[],start=key(first.a);let current=first;
  for(let guard=0;guard<=boundary.size;guard++) {
    outline.push(current.a);
    const next=key(current.b);
    if(next===start)return outline;
    current=boundary.get(next);
    if(!current)return [];
  }
  return [];
}
