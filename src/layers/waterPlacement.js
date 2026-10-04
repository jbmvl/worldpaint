/* Emprise finale de l'eau : les protections et la partition sont appliquées
 * une fois. Rendu, exclusions CPU et terrain lisent les mêmes triangles.
 * Sous une portée (`bounds`), seuls les triangles qui touchent ce carré sont
 * posés ; les cotes, calculées avant sur les objets entiers, n'en dépendent pas. */
import {EARTH_CIRCUMFERENCE} from '../core/tileMath.js';
import {appendRibbon,createRibbonBuffer} from './ribbonGeometry.js';
import {triangulateRings,intersectConvex,subtractConvex,partitionTriangles,boundarySegments,TriangleGrid,boundsOf,overlap,barycentric,segmentDistance,fan,interpolate} from '../core/waterGeometry.js';
function surfaceRevision(triangles) {
  let hash=2166136261;
  for(const t of triangles)for(const p of t.points)for(const value of [p.x,p.z,p.levelM])hash=Math.imul(hash^Math.round(value*1e5),16777619);
  return hash>>>0;
}
export class WaterSurfaceIndex {
  constructor(triangles=[],boundaries=[],resolvedKeys=new Set()) {
    this.triangles=triangles;this.grid=new TriangleGrid(triangles);this.boundaries=boundaries;this.resolvedKeys=resolvedKeys;this.revision=surfaceRevision(triangles);
    this.shoreGrid=new TriangleGrid(boundaries.map(edge=>({points:[edge.a,edge.b,edge.b],edge})));
    this.bounds=triangles.length?boundsOf(triangles.flatMap(t=>t.points)):null;
  }
  sample(x,z) {
    const p={x,z};for(const triangle of this.grid.inBounds({minX:x,maxX:x,minZ:z,maxZ:z})) {
      const weights=barycentric(p,triangle.points);if(!weights)continue;
      const value=key=>weights.reduce((s,w,i)=>s+w*(triangle.points[i][key]??0),0);
      return {levelM:value('levelM'),kind:triangle.kind,flowX:value('flowX'),flowZ:value('flowZ'),flowKnown:value('flowKnown')>0.5,sourceKey:triangle.sourceKey};
    }
    return null;
  }
  trianglesInBounds(bounds) {return this.grid.inBounds(bounds);}
  shoreSegmentsInBounds(bounds) {return this.shoreGrid.inBounds(bounds).map(t=>t.edge).filter(e=>e.kind==='shore');}
  boundarySegmentsInBounds(bounds) {return this.shoreGrid.inBounds(bounds).map(t=>t.edge);}
}
function oceanGrid(frame,maxStep) {
  const cell=maxStep/Math.SQRT2,mercatorScale=EARTH_CIRCUMFERENCE/2**(frame?.zoom??0),scale=frame?.scale?mercatorScale/frame.scale:1;
  // Une grille géographique commune impose les mêmes sommets aux tuiles voisines.
  return {cell,originX:frame?.origin?-(frame.origin.x*mercatorScale/scale)%cell:0,originZ:frame?.origin?-(frame.origin.y*mercatorScale/scale)%cell:0};
}
function subdivideOcean(points,{cell,originX,originZ},clip=null) {
  const bounds=boundsOf(points),triangles=[];
  if(clip) {bounds.minX=Math.max(bounds.minX,clip.minX);bounds.maxX=Math.min(bounds.maxX,clip.maxX);bounds.minZ=Math.max(bounds.minZ,clip.minZ);bounds.maxZ=Math.min(bounds.maxZ,clip.maxZ);}
  for(let ix=Math.floor((bounds.minX-originX)/cell);ix<=Math.floor((bounds.maxX-originX)/cell);ix++)for(let iz=Math.floor((bounds.minZ-originZ)/cell);iz<=Math.floor((bounds.maxZ-originZ)/cell);iz++) {
    const x=originX+ix*cell,z=originZ+iz*cell,a={x,z},b={x:x+cell,z},c={x,z:z+cell},d={x:x+cell,z:z+cell};
    for(const clip of [[a,c,b],[b,c,d]])triangles.push(...fan(intersectConvex(points,clip)));
  }
  return triangles;
}
export function placeWater(prepared,protections,triangulateShape,{oceanStepM,profiles={},bounds=null}={}) {
  const within=points=>!bounds || overlap(boundsOf(points),bounds);
  const shortest=Math.min(...(profiles.ocean?.wavelengths??[48,72]));
  const step=oceanStepM??shortest*Math.cos((prepared.frame?.originLat??0)*Math.PI/180)/8;
  if(!(step>0 && Number.isFinite(step)))throw new RangeError('Pas de subdivision marine invalide');
  const marineGrid=oceanGrid(prepared.frame,step);
  const candidates=[],sourceEdges=[];
  for(const poly of prepared.polygons) {
    if(poly.profile.status!=='resolved')continue;
    sourceEdges.push(...poly.edges);
    if(poly.candidates)candidates.push(...poly.candidates.filter(c=>within(c.points)));
    else for(const rings of poly.shapes)for(const t of triangulateRings(rings,triangulateShape)) {
      if(!within(t))continue;
      const points=t.map(p=>({...p,levelM:poly.profile.levelAt(),alongM:0,acrossM:0,flowX:0,flowZ:0,flowKnown:0}));
      for(const part of poly.kind==='ocean'?subdivideOcean(points,marineGrid,bounds):[points])candidates.push({points:part,kind:poly.kind,sourceKey:poly.key,priority:0});
    }
  }
  for(const line of prepared.lines) {
    const profile=line.profile;if(profile.status!=='resolved')continue;
    const buffer=createRibbonBuffer(),sign=profile.reversed?-1:1;
    appendRibbon(buffer,{path:profile.stations,halfWidth:line.halfWidth,platform:new Float32Array(profile.levels),level:true,lift:0,smoothRadius:0,columns:2,textureLength:1});
    const vertices=buffer.positions.reduce((out,_,i)=> {
      if(i%3)return out;const k=i/3,row=Math.floor(k/2);out.push({x:buffer.positions[i],z:buffer.positions[i+2],levelM:buffer.positions[i+1],acrossM:(buffer.uvs[k*2]-0.5)*line.halfWidth*2,alongM:sign*buffer.uvs[k*2+1]+line.phaseM,flowX:profile.frames[row*4]*sign,flowZ:profile.frames[row*4+1]*sign,flowKnown:profile.flowKnown?1:0,phaseBlendM:Math.min(profile.stations[row].distance,profile.total-profile.stations[row].distance)});return out;
    },[]);
    for(let i=0;i<buffer.indices.length;i+=3) {
      const points=buffer.indices.slice(i,i+3).map(j=>vertices[j]);
      if(within(points))candidates.push({points,kind:line.kind,sourceKey:line.key,priority:1});
    }
    for(let i=2;i<vertices.length;i+=2)for(const k of [0,1])sourceEdges.push({a:vertices[i-2+k],b:vertices[i+k],kind:'shore'});
    sourceEdges.push({a:vertices[0],b:vertices[1],kind:'tile'},{a:vertices.at(-2),b:vertices.at(-1),kind:'tile'});
  }
  const triangles=partitionTriangles(candidates,protections),edgeGrid=new TriangleGrid(sourceEdges.map(edge=>({points:[edge.a,edge.b,edge.b],edge}))),protectionGrid=new TriangleGrid(protections);
  const boundaries=boundarySegments(triangles,p=> {
    const mid={x:(p.a.x+p.b.x)/2,z:(p.a.z+p.b.z)/2},bounds={minX:mid.x-1e-5,maxX:mid.x+1e-5,minZ:mid.z-1e-5,maxZ:mid.z+1e-5};
    for(const obstacle of protectionGrid.inBounds(bounds))for(let i=0;i<3;i++)if(segmentDistance(mid,obstacle[i],obstacle[(i+1)%3]).distance<1e-5)return 'protection';
    const matches=edgeGrid.inBounds(bounds).map(t=>t.edge).filter(e=>segmentDistance(mid,e.a,e.b).distance<1e-5);
    if(matches.some(e=>e.kind==='shore'))return 'shore';
    return matches.some(e=>e.kind==='tile')?'tile':'internal';
  });
  return new WaterSurfaceIndex(triangles,boundaries,prepared.resolvedKeys);
}

/** La bande d'écume fait partie des triangles acceptés, sans couche coplanaire. */
export function addWaterBands(index,profiles={}) {
  const strips=[];
  for(const edge of index.boundaries) {
    if(edge.kind!=='shore')continue;
    const kind=edge.triangle.kind,look=profiles[kind]??{},width=look.foamWidthM??0;
    const slope=Math.abs(edge.b.levelM-edge.a.levelM)/(Math.hypot(edge.b.x-edge.a.x,edge.b.z-edge.a.z)||1);
    if(!width || kind!=='ocean' && (!['river','stream'].includes(kind) || slope<(look.foamSlope??0.015)))continue;
    const dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
    const mid={x:(edge.a.x+edge.b.x)/2,z:(edge.a.z+edge.b.z)/2},sign=index.sample(mid.x+nx*0.001,mid.z+nz*0.001)?1:-1;
    strips.push({edge,width,points:[edge.a,edge.b,{x:edge.b.x+nx*width*sign,z:edge.b.z+nz*width*sign},{x:edge.a.x+nx*width*sign,z:edge.a.z+nz*width*sign}]});
  }
  const stripGrid=new TriangleGrid(strips),boundaryGrid=index.shoreGrid,out=[];
  for(const t of index.triangles) {
    let rest=[t.points];const bands=[];
    for(const strip of stripGrid.inBounds(boundsOf(t.points))) {
      const next=[];
      for(const p of rest) {
        const inside=intersectConvex(p,strip.points);if(inside.length)bands.push({strip,points:inside});
        next.push(...subtractConvex(p,strip.points));
      }
      rest=next;
    }
    const wave=p=> {
      const reach=8,b={minX:p.x-reach,maxX:p.x+reach,minZ:p.z-reach,maxZ:p.z+reach};
      let distance=reach;for(const item of boundaryGrid.inBounds(b))if(['shore','protection'].includes(item.edge.kind))distance=Math.min(distance,segmentDistance(p,item.edge.a,item.edge.b).distance);
      return Math.min(1,distance/reach);
    };
    for(const points of rest.flatMap(fan))out.push({...t,points:points.map(p=>({...p,waveWeight:wave(p),foamAcross:1,shoreM:0}))});
    for(const band of bands)for(const points of fan(band.points))out.push({...t,points:points.map(p=> {
      const hit=segmentDistance(p,band.strip.edge.a,band.strip.edge.b);
      return {...p,waveWeight:wave(p),foamAcross:Math.min(1,hit.distance/band.strip.width),shoreM:hit.t*Math.hypot(band.strip.edge.b.x-band.strip.edge.a.x,band.strip.edge.b.z-band.strip.edge.a.z)+band.strip.edge.a.x*0.731+band.strip.edge.a.z*0.317};
    })});
  }
  return new WaterSurfaceIndex(out,index.boundaries,index.resolvedKeys);
}
