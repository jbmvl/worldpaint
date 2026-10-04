/* Profils hydrologiques en mètres MNT. Ni LOD, ni caméra, ni échelle verticale
 * ne participent aux cotes. Un jeu de références incomplet reste un repli. */
import {subdividePath,pathFrames} from '../layers/ribbonGeometry.js';
import {pointInRings,segmentDistance} from './waterGeometry.js';
export const WATERWAY_STEP_M=4;
// Hypothèse de référence des sources actuelles, distincte des eaux continentales.
export const OCEAN_LEVEL_M=0;
// Garde conservatrice : les données ne justifient pas une incision plus forte.
export const MAX_WATER_REPAIR_M=2;
export const median=values=> {const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:NaN;};
export function lakeProfile(rings,sampleDem,{pixels=null,shore=[],complete=true,fineStep=0.25,fallbackPixels=null}={}) {
  if(!complete)return {status:'incomplete',reason:'composante ouverte'};
  const shapes=Array.isArray(rings[0]?.[0])?rings:[rings],inside=p=>shapes.some(r=>pointInRings(p,r));
  let samples=[];
  if(pixels)for(const p of pixels) {
    if(!inside(p))continue;
    const radius=p.pixelM??1;
    if(shore.some(e=>segmentDistance(p,e.a,e.b).distance<radius))continue;
    const h=sampleDem(p.x,p.z);if(!Number.isFinite(h))return {status:'incomplete',reason:'pixels MNT absents'};samples.push(h);
  }
  if(!samples.length && fallbackPixels)for(const p of typeof fallbackPixels==='function'?fallbackPixels():fallbackPixels) {
    if(!inside(p))continue;const h=sampleDem(p.x,p.z);
    if(!Number.isFinite(h))return {status:'incomplete',reason:'pixels MNT absents'};samples.push(h);
  }
  if(!samples.length && !fallbackPixels) {
    const flat=shapes.flat(2),minX=Math.min(...flat.map(p=>p.x)),maxX=Math.max(...flat.map(p=>p.x)),minZ=Math.min(...flat.map(p=>p.z)),maxZ=Math.max(...flat.map(p=>p.z));
    for(let x=Math.ceil(minX/fineStep)*fineStep;x<maxX;x+=fineStep)for(let z=Math.ceil(minZ/fineStep)*fineStep;z<maxZ;z+=fineStep) {
      if(!inside({x,z}))continue;const h=sampleDem(x,z);if(!Number.isFinite(h))return {status:'incomplete',reason:'pixels MNT absents'};samples.push(h);
    }
  }
  if(!samples.length)return {status:'incomplete',reason:'aucun échantillon intérieur'};
  const shoreSamples=[];
  for(const e of shore)for(const p of subdividePath([e.a,e.b],e.pixelM??4)) {const h=sampleDem(p.x,p.z);if(!Number.isFinite(h))return {status:'incomplete',reason:'rive sans MNT'};shoreSamples.push(h);}
  const proposed=median(samples),level=Math.min(proposed,...shoreSamples);
  if(proposed-level>MAX_WATER_REPAIR_M || shoreSamples.some(h=>Math.abs(h-level)>MAX_WATER_REPAIR_M))return {status:'conflict',reason:'réparation de rive supérieure à 2 m',proposed,level,shoreRange:[Math.min(...shoreSamples),Math.max(...shoreSamples)]};
  return {status:'resolved',levelM:level,proposed,deviations:samples.map(h=>h-level),flowKnown:false,levelAt:()=>level};
}
export function isotonic(values,weights=values.map(()=>1),decreasing=true) {
  const blocks=[],sign=decreasing?-1:1;
  for(let i=0;i<values.length;i++) {
    blocks.push({start:i,end:i,weight:weights[i],sum:values[i]*sign*weights[i]});
    while(blocks.length>1 && blocks.at(-2).sum/blocks.at(-2).weight>blocks.at(-1).sum/blocks.at(-1).weight) {
      const b=blocks.pop(),a=blocks.pop();blocks.push({start:a.start,end:b.end,weight:a.weight+b.weight,sum:a.sum+b.sum});
    }
  }
  const out=[];for(const b of blocks)for(let i=b.start;i<=b.end;i++)out[i]=b.sum/b.weight*sign;return out;
}
/** PAVA borné : une rive limite son bloc, sans transformer un sondage bas
 * isolé en contrainte arbitraire sur tous les sommets aval. */
export function boundedIsotonic(values,weights,lower,upper,decreasing=true) {
  const sign=decreasing?-1:1,blocks=[];
  for(let i=0;i<values.length;i++) {
    const lo=decreasing?-upper[i]:lower[i],hi=decreasing?-lower[i]:upper[i];
    if(lo>hi+1e-8)return null;
    const b={start:i,end:i,weight:weights[i],sum:values[i]*sign*weights[i],lo,hi};
    b.mean=Math.max(lo,Math.min(hi,b.sum/b.weight));blocks.push(b);
    while(blocks.length>1 && blocks.at(-2).mean>blocks.at(-1).mean+1e-10) {
      const b=blocks.pop(),a=blocks.pop(),merged={start:a.start,end:b.end,weight:a.weight+b.weight,sum:a.sum+b.sum,lo:Math.max(a.lo,b.lo),hi:Math.min(a.hi,b.hi)};
      if(merged.lo>merged.hi+1e-8)return null;
      merged.mean=Math.max(merged.lo,Math.min(merged.hi,merged.sum/merged.weight));blocks.push(merged);
    }
  }
  const out=[];for(const b of blocks)for(let i=b.start;i<=b.end;i++)out[i]=b.mean*sign;return out;
}
export function waterwayProfile(path,halfWidth,sampleDem,anchors={}) {
  const stations=subdividePath(path,WATERWAY_STEP_M);if(stations.length<2)return {status:'incomplete',reason:'axe vide'};
  for(const [index,key] of [[0,'startFrame'],[stations.length-1,'endFrame']]) {
    const tangent=anchors[key];if(!tangent)continue;
    const p=stations[index],px=tangent[1]*halfWidth,pz=-tangent[0]*halfWidth;
    p.section={left:{x:p.x+px,z:p.z+pz},right:{x:p.x-px,z:p.z-pz}};
  }
  const frames=pathFrames(stations),raw=[],banks=[];
  for(let i=0;i<stations.length;i++) {
    const p=stations[i],px=frames[i*4+2]*halfWidth,pz=frames[i*4+3]*halfWidth;
    const values=[sampleDem(p.x,p.z),sampleDem(p.x-px,p.z-pz),sampleDem(p.x+px,p.z+pz)];
    if(values.some(h=>!Number.isFinite(h)))return {status:'incomplete',reason:'pixels MNT absents'};
    const bank=anchors.bankSamples?.[i]??values.slice(1);
    if(bank.some(h=>!Number.isFinite(h)))return {status:'incomplete',reason:'rive sans MNT'};
    raw.push(median(values));banks.push(Math.min(...bank));
  }
  const first=anchors.start??raw[0],last=anchors.end??raw.at(-1),noise=median(raw.slice(1).map((h,i)=>Math.abs(h-raw[i]))),flowKnown=Math.abs(first-last)>Math.max(0.15,noise*2);
  const smooth=raw.map((h,i)=>median(raw.slice(Math.max(0,i-2),i+3)));
  smooth[0]=first;smooth[smooth.length-1]=last;
  const weights=stations.map((p,i)=>(stations[Math.min(i+1,stations.length-1)].distance-stations[Math.max(0,i-1)].distance)/2||1);
  const ascending=last>first,lo=Math.min(first,last),hi=Math.max(first,last);
  let levels=smooth.map((h,i)=>i===0?first:i===smooth.length-1?last:Math.min(h,banks[i]));
  if(flowKnown) {
    if(banks.some(h=>h<lo-1e-6))return {status:'conflict',reason:'ancres incompatibles avec les rives'};
    const lower=levels.map((_,i)=>i===0?first:i===levels.length-1?last:lo);
    const upper=banks.map((h,i)=>i===0?first:i===levels.length-1?last:Math.min(hi,h));
    levels=boundedIsotonic(smooth,weights,lower,upper,!ascending);
    if(!levels)return {status:'conflict',reason:'ancres et rives incompatibles'};
  }
  if(levels.some((h,i)=>h>banks[i]+1e-6 || banks[i]-h>MAX_WATER_REPAIR_M))return {status:'conflict',reason:'profil incompatible avec les rives',raw,banks,levels};
  for(let i=0;i<stations.length;i++)stations[i].levelM=levels[i];
  const total=stations.at(-1).distance;
  const levelAt=s=> {
    if(s<=0)return levels[0];if(s>=total)return levels.at(-1);
    let lo=0,hi=stations.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(stations[m].distance>s)hi=m;else lo=m;}
    const t=(s-stations[lo].distance)/(stations[hi].distance-stations[lo].distance);return levels[lo]+(levels[hi]-levels[lo])*t;
  };
  return {status:'resolved',stations,frames,raw,levels,banks,flowKnown,reversed:ascending,levelAt,total};
}
