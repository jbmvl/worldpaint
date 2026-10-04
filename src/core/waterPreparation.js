import { splitWaterLines, endpointFrames } from './waterLines.js';
/* Préparation des objets et profils avant la carte du sol. Le compositeur
 * fournit les lecteurs géographiques ; les sections transversales restent
 * finies afin de ne jamais atteindre l'autre bras d'un méandre. */
import {groupWaterPolygons,componentEdges} from './waterFeatures.js';
import {lakeProfile,waterwayProfile,OCEAN_LEVEL_M,MAX_WATER_REPAIR_M} from './waterProfiles.js';
import {boundsOf,pointInRings,segmentDistance,intersectConvex,fan,area,partitionTriangles,TriangleGrid,cross} from './waterGeometry.js';
import {lngToTileX,latToTileY,tileXToLng,tileYToLat} from './tileMath.js';
import {subdividePath,pathFrames} from '../layers/ribbonGeometry.js';
const localRings=(fragment,frame)=>fragment.rings.map(r=>r.map(p=>frame.toLocal(...p)));
const keyPoint=(p,frame)=> {const g=frame.toLngLat(p.x,p.z);return `${Math.round(lngToTileX(g.lng,14)*4096)}/${Math.round(latToTileY(g.lat,14)*4096)}`;};
function pixelsFor(shapes,frame,grid,factor=1) {
  const {zoom,pixels}=grid,size=pixels*factor,points=shapes.flat(2).map(p=>frame.toLngLat(p.x,p.z));
  const tx=points.map(p=>lngToTileX(p.lng,zoom)*size),ty=points.map(p=>latToTileY(p.lat,zoom)*size),out=[];
  for(let y=Math.ceil(Math.min(...ty)-0.5);y<=Math.floor(Math.max(...ty)-0.5);y++)for(let x=Math.ceil(Math.min(...tx)-0.5);x<=Math.floor(Math.max(...tx)-0.5);x++) {
    const p=frame.toLocal(tileXToLng((x+0.5)/size,zoom),tileYToLat((y+0.5)/size,zoom));
    p.pixelM=frame.scale*2**(frame.zoom-zoom)/size;out.push(p);
  }
  return out;
}
function pointInside(p,shapes) {return shapes.some(r=>pointInRings(p,r));}
function pointInsideInclusive(p,shapes) {
  return pointInside(p,shapes) || shapes.some(rings=>rings.some(ring=>ring.some((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length]).distance<1e-7)));
}
/* L'intervalle qui contient l'axe est seul retenu. Une île ou la terre entre
 * deux bras coupe la section, même si une autre nappe est plus loin. */
export function waterCrossSection(p,px,pz,shapes) {
  const hits=[];
  for(const rings of shapes)for(const ring of rings)for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,det=px*dz-pz*dx;
    if(Math.abs(det)<1e-9)continue;
    const t=((a.x-p.x)*dz-(a.z-p.z)*dx)/det,u=((a.x-p.x)*pz-(a.z-p.z)*px)/det;
    if(u>=-1e-7 && u<=1+1e-7)hits.push(t);
  }
  hits.sort((a,b)=>a-b);
  const unique=hits.filter((t,i)=>i===0 || t-hits[i-1]>1e-5);
  for(let i=1;i<unique.length;i++) {
    const a=unique[i-1],b=unique[i];if(a>1e-5 || b< -1e-5)continue;
    const m=(a+b)/2;if(!pointInsideInclusive({x:p.x+px*m,z:p.z+pz*m},shapes))continue;
    return [{x:p.x+px*a,z:p.z+pz*a},{x:p.x+px*b,z:p.z+pz*b}];
  }
  return null;
}
function clipAxis(path,shapes) {
  const runs=[];let run=[];
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z,ts=[0,1];
    for(const rings of shapes)for(const ring of rings)for(let j=0;j<ring.length;j++) {
      const c=ring[j],d=ring[(j+1)%ring.length],ex=d.x-c.x,ez=d.z-c.z,det=dx*ez-dz*ex;
      if(Math.abs(det)<1e-9)continue;
      const t=((c.x-a.x)*ez-(c.z-a.z)*ex)/det,u=((c.x-a.x)*dz-(c.z-a.z)*dx)/det;
      if(t>1e-8 && t<1-1e-8 && u>=0 && u<=1)ts.push(t);
    }
    ts.sort((a,b)=>a-b);
    for(let k=1;k<ts.length;k++) {
      const lo=ts[k-1],hi=ts[k],mid=(lo+hi)/2;
      if(!pointInside({x:a.x+dx*mid,z:a.z+dz*mid},shapes)) {if(run.length>1)runs.push(run);run=[];continue;}
      const p={x:a.x+dx*lo,z:a.z+dz*lo,distance:a.distance+(b.distance-a.distance)*lo},q={x:a.x+dx*hi,z:a.z+dz*hi,distance:a.distance+(b.distance-a.distance)*hi};
      if(!run.length)run.push(p);run.push(q);
    }
  }
  if(run.length>1)runs.push(run);return runs;
}
export function riverSections(shapes,axes,triangulateShape,sampleDem) {
  const polygonTriangles=shapes.flatMap(r=>importTriangulate(r,triangulateShape)),polygonIndex=new TriangleGrid(polygonTriangles),candidates=[],profiles=[];
  for(const axis of axes)for(const run of clipAxis(axis.profile.stations??subdividePath(axis.points,4),shapes)) {
    const stations=run.map(p=>({...p,distance:p.distance-run[0].distance})),frames=pathFrames(stations),sections=[];
    for(let i=0;i<stations.length;i++) {
      const p=stations[i],section=waterCrossSection(p,frames[i*4+2],frames[i*4+3],shapes);
      if(!section)return {status:'conflict',reason:'section fluviale ambiguë'};
      sections.push(section);
    }
    const offset=run[0].distance;
    // Les vraies rives du polygone bornent le profil utilisé aussi par le ruban.
    const bankSamples=stations.map((p,i)=>sections[i].map(q=>sampleDem(q.x,q.z)));
    const initial=axis.profile.status==='resolved'?axis.profile:waterwayProfile(run,axis.halfWidth,sampleDem);
    if(initial.status!=='resolved')return initial;
    let profile;
    if(axis.profile.status==='resolved') {
      // La section polygonale lit le profil complet du ruban, sans relisser un bief.
      const levels=stations.map(p=>initial.levelAt(offset+p.distance));
      if(levels.some((h,i)=>bankSamples[i].some(b=>!Number.isFinite(b))))return {status:'incomplete',reason:'rive sans MNT'};
      if(levels.some((h,i)=>bankSamples[i].some(b=>h>b+1e-6 || b-h>MAX_WATER_REPAIR_M)))return {status:'conflict',reason:'profil partagé incompatible avec les rives polygonales'};
      profile={...initial,total:stations.at(-1).distance,levelAt:s=>initial.levelAt(offset+s)};
    } else {
      profile=waterwayProfile(stations,axis.halfWidth,sampleDem,{start:Math.min(initial.levelAt(0),...bankSamples[0]),end:Math.min(initial.levelAt(initial.total),...bankSamples.at(-1)),bankSamples});
      if(profile.status!=='resolved')return profile;
    }
    profiles.push(profile);
    for(let i=1;i<stations.length;i++) {
      const prev=sections[i-1],next=sections[i],quad=[prev[0],prev[1],next[1],next[0]],d0=stations[i-1].distance,d1=stations[i].distance;
      if(area(quad)<1e-8)continue;
      // Chaque section est une contrainte locale, jamais une bande infinie.
      const convex=fan(quad);
      for(const part of convex)for(const triangle of polygonIndex.inBounds(boundsOf(part))) {
        const intersection=intersectConvex(triangle,part);
        for(const points of fan(intersection)) {
          const mapped=points.map(p=> {
            const a=Math.abs(cross(prev[0],prev[1],p))/Math.hypot(prev[1].x-prev[0].x,prev[1].z-prev[0].z),b=Math.abs(cross(next[0],next[1],p))/Math.hypot(next[1].x-next[0].x,next[1].z-next[0].z),t=a/(a+b||1),s=d0+(d1-d0)*t;
            const along=offset+s,sign=profile.reversed?-1:1;
            return {...p,levelM:profile.levelAt(s),phaseBlendM:Math.min(s,profile.total-s),alongM:sign*along+axis.phaseM,acrossM:segmentDistance(p,stations[i-1],stations[i]).distance,flowX:frames[(i-1)*4]*sign,flowZ:frames[(i-1)*4+1]*sign,flowKnown:profile.flowKnown?1:0};
          });
          candidates.push({points:mapped,sourceKey:axis.key,priority:0,kind:axis.kind});
        }
      }
    }
  }
  if(!candidates.length)return {status:'incomplete',reason:'polygone fluvial sans axe exploitable'};
  const accepted=partitionTriangles(candidates),wanted=polygonTriangles.reduce((s,t)=>s+area(t),0),actual=accepted.reduce((s,t)=>s+area(t.points),0);
  if(Math.abs(wanted-actual)>Math.max(0.02,wanted*1e-5))return {status:'conflict',reason:'sections fluviales sans couverture complète',missingAreaM2:wanted-actual};
  return {status:'resolved',candidates:accepted,profiles};
}
import {triangulateRings as importTriangulate} from './waterGeometry.js';
export function constrainPolygonAxes(lines,polygons,sampleLocal,sharedFrames=new Map()) {
  // Toutes les vraies rives polygonales contraignent le profil complet avant
  // sa publication : les ancres de confluence et de lac restent fixées.
  for(const line of lines)if(line.profile.status==='resolved') {
    const original=line.profile;
    const bankSamples=original.stations.map((p,i)=> {
      const samples=[original.banks[i]];
      for(const poly of polygons)if(poly.profile.status==='pending' && pointInsideInclusive(p,poly.shapes)) {
        const section=waterCrossSection(p,original.frames[i*4+2],original.frames[i*4+3],poly.shapes);
        if(section)samples.push(...section.map(q=>sampleLocal(q.x,q.z)));
      }
      return samples;
    });
    if(bankSamples.some((values,i)=>values.some(h=>!Number.isFinite(h) || original.levels[i]>h+1e-6 || h-original.levels[i]>MAX_WATER_REPAIR_M))) {
      const shared=sharedFrames.get(line.key);
      line.profile=waterwayProfile(original.stations,line.halfWidth,sampleLocal,{start:original.levels[0],end:original.levels.at(-1),...shared,bankSamples});
    }
  }
}
export function prepareWater(features,{frame,sampleDem,grid,waterways,triangulateShape}) {
  const sampleLocal=(x,z)=> {const g=frame.toLngLat(x,z);return sampleDem(g.lng,g.lat);};
  const polygons=[],lines=[],diagnostics=[],resolvedKeys=new Set();
  for(const group of groupWaterPolygons(features.polygons)) {
    const shapes=group.fragments.map(f=>localRings(f,frame)),edges=componentEdges(group,frame),shore=edges.filter(e=>e.kind==='shore');
    let profile;
    if(group.kind==='ocean')profile={status:'resolved',levelM:OCEAN_LEVEL_M,levelAt:()=>OCEAN_LEVEL_M,flowKnown:false};
    else if(['lake','pond','reservoir','basin'].includes(group.kind))profile=lakeProfile(shapes,sampleLocal,{pixels:pixelsFor(shapes,frame,grid),fallbackPixels:()=>pixelsFor(shapes,frame,grid,4),shore,complete:!group.fragments.some(f=>f.incomplete) && !edges.some(e=>e.kind==='tile')});
    else profile={status:'pending'};
    polygons.push({...group,shapes,edges,profile});
  }
  // La cote d'un nœud est partagée par tous ses bras, même à travers une tuile.
  const nodes=new Map();let localLines=[];
  for(const line of features.lines) {
    const points=line.points.map(p=>frame.toLocal(...p)),halfWidth=(waterways[line.kind]??0)/2;
    if(!halfWidth)continue;
    localLines.push({...line,points,halfWidth});
  }
  const lakeCuts=[];
  for(const poly of polygons)if(poly.profile.status==='resolved' && poly.kind!=='ocean')for(const line of localLines)for(const run of clipAxis(subdividePath(line.points,4),poly.shapes))lakeCuts.push(run[0],run.at(-1));
  localLines=splitWaterLines(localLines,p=>keyPoint(p,frame),lakeCuts);
  const sharedFrames=endpointFrames(localLines,p=>keyPoint(p,frame));
  for(const line of localLines)for(const p of [line.points[0],line.points.at(-1)]) {
    const key=keyPoint(p,frame);if(nodes.has(key))continue;
    const lakeLevels=polygons.filter(poly=>poly.profile.status==='resolved' && poly.kind!=='ocean' && (pointInside(p,poly.shapes) || poly.edges.some(e=>segmentDistance(p,e.a,e.b).distance<1e-5))).map(poly=>poly.profile.levelM);
    nodes.set(key,{level:lakeLevels.length?lakeLevels[0]:sampleLocal(p.x,p.z),conflict:lakeLevels.some(h=>Math.abs(h-lakeLevels[0])>1e-5)});
  }
  for(const line of localLines) {
    const start=nodes.get(keyPoint(line.points[0],frame)),end=nodes.get(keyPoint(line.points.at(-1),frame));
    const profile=start.conflict||end.conflict?{status:'conflict',reason:'plans d’eau incompatibles au nœud'}:waterwayProfile(line.points,line.halfWidth,sampleLocal,{start:start.level,end:end.level,...sharedFrames.get(line.key)});
    const g=line.points[0],geographic=frame.toLngLat(g.x,g.z),sign=profile.reversed?-1:1;
    // Phase spatiale fixe ; le shader fond son extrémité avec le repère mondial.
    const phaseM=(Math.round(lngToTileX(geographic.lng,14)*4096)*0.731+Math.round(latToTileY(geographic.lat,14)*4096)*0.317)%4096;
    lines.push({...line,profile,phaseM:sign*phaseM});
  }
  constrainPolygonAxes(lines,polygons,sampleLocal,sharedFrames);
  for(const poly of polygons) {
    if(poly.profile.status==='pending') {
      const axes=lines.filter(l=>['river','stream','canal','drain','ditch'].includes(l.kind));
      const result=riverSections(poly.shapes,axes,triangulateShape,sampleLocal);poly.profile=result;
      if(result.status==='resolved')poly.candidates=result.candidates.map(t=>({...t,sourceKey:poly.key,kind:poly.kind}));
    }
    if(poly.profile.status==='resolved')for(const f of poly.fragments)resolvedKeys.add(f.key);
    else diagnostics.push({sourceKey:poly.key,kind:poly.kind,...poly.profile});
  }
  for(const line of lines) {
    if(line.profile.status==='resolved')resolvedKeys.add(line.key);
    else diagnostics.push({sourceKey:line.key,kind:line.kind,...line.profile});
  }
  updateResolvedWaterKeys({polygons,lines,resolvedKeys});
  return {polygons,lines,buildings:features.buildings,resolvedKeys,diagnostics,frame};
}

export function updateResolvedWaterKeys(prepared) {
  const {polygons,lines,resolvedKeys}=prepared;
  resolvedKeys.clear();
  for(const poly of polygons)if(poly.profile.status==='resolved')for(const f of poly.fragments)resolvedKeys.add(f.key);
  for(const line of lines)if(line.profile.status==='resolved')resolvedKeys.add(line.key);
  const paintGroups=new Map();
  for(const item of [...polygons.flatMap(p=>p.fragments.map(f=>({...f,status:p.profile.status}))),...lines.map(l=>({...l,status:l.profile.status}))]) {
    if(!item.paintKey)continue;let statuses=paintGroups.get(item.paintKey);if(!statuses)paintGroups.set(item.paintKey,statuses=[]);statuses.push(item.status);
  }
  for(const [key,statuses] of paintGroups)if(statuses.every(s=>s==='resolved'))resolvedKeys.add(key);
}
export function rejectWaterObjects(prepared,conflicts) {
  const rejected=new Map(conflicts.map(d=>[d.sourceKey,d]));
  for(const item of [...prepared.polygons,...prepared.lines])if(rejected.has(item.key)) {
    item.profile=rejected.get(item.key);prepared.diagnostics.push({kind:item.kind,...item.profile});
  }
  updateResolvedWaterKeys(prepared);
}

export function waterFallbacks(prepared) {
  return [...prepared.polygons.filter(p=>p.profile.status!=='resolved').flatMap(p=>p.fragments),...prepared.lines.filter(l=>l.profile.status!=='resolved')];
}
