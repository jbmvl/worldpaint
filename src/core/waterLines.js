/* Raccords du réseau hydrographique : les seuls nœuds sont des sommets MVT
 * partagés. Les calculs restent coupés aux frontières de tuiles et aux entrées
 * des lacs ; une intersection en projection ne crée aucune confluence. */
import {segmentDistance} from './waterGeometry.js';
export function splitWaterLines(lines,keyPoint,lakeCuts=[]) {
  const references=new Map();
  for(const line of lines)for(const p of line.points) {const key=keyPoint(p);let refs=references.get(key);if(!refs)references.set(key,refs=new Set());refs.add(line.key);}
  const out=[];
  for(const line of lines) {
    const points=[];
    for(let i=1;i<line.points.length;i++) {
      const a=line.points[i-1],b=line.points[i],cuts=[{t:0,p:a},{t:1,p:b}];
      for(const p of lakeCuts) {const hit=segmentDistance(p,a,b);if(hit.distance<1e-5 && hit.t>1e-8 && hit.t<1-1e-8)cuts.push({t:hit.t,p});}
      cuts.sort((a,b)=>a.t-b.t);if(!points.length)points.push(a);for(const cut of cuts.slice(1))if(Math.hypot(cut.p.x-points.at(-1).x,cut.p.z-points.at(-1).z)>1e-7)points.push(cut.p);
    }
    let run=[points[0]];
    for(let i=1;i<points.length;i++) {
      const p=points[i];run.push(p);
      if(i===points.length-1 || references.get(keyPoint(p))?.size>1 || lakeCuts.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<1e-5)) {
        const key=points.length===line.points.length && run.length===points.length?line.key:`${line.key}:section:${keyPoint(run[0])}:${keyPoint(run.at(-1))}`;
        out.push({...line,key,parentKey:line.key,points:run});run=[p];
      }
    }
  }
  return out.sort((a,b)=>a.key.localeCompare(b.key));
}
export function endpointFrames(lines,keyPoint) {
  const nodes=new Map();
  for(const line of lines)for(const head of [true,false]) {
    const p=head?line.points[0]:line.points.at(-1),q=head?line.points[1]:line.points.at(-2),key=keyPoint(p);
    let refs=nodes.get(key);if(!refs)nodes.set(key,refs=[]);refs.push({line,head,p,q});
  }
  const frames=new Map();
  for(const refs of nodes.values())if(refs.length===2) {
    const [a,b]=refs,dx=b.q.x-a.q.x,dz=b.q.z-a.q.z,length=Math.hypot(dx,dz);if(!length)continue;
    for(const ref of refs) {
      const direction=(ref.q.x-ref.p.x)*dx+(ref.q.z-ref.p.z)*dz,sign=(direction>=0?1:-1)*(ref.head?1:-1);
      let ends=frames.get(ref.line.key);if(!ends)frames.set(ref.line.key,ends={});ends[ref.head?'startFrame':'endFrame']=[dx/length*sign,dz/length*sign];
    }
  }
  return frames;
}
