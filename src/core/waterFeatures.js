import { VectorTileSource } from './vectorTileSource.js';
/* Objets hydrologiques conservés hors du LRU vectoriel. Les marges MVT sont
 * coupées avant toute identité, raccord ou sondage ; les IDs ne joignent
 * jamais une ligne à un polygone. La classification est fournie par l'appelant. */
import {lngToTileX,latToTileY,tileXToLng,tileYToLat} from './tileMath.js';
import {intersectConvex,segmentDistance,signedArea} from './waterGeometry.js';
export const WATER_COMPONENT_TILE_LIMIT=64;
const tileKey=t=>`${t.z}/${t.x}/${t.y}`;
const quantize=v=>Math.round(v*1e7)/1e7;
const pointKey=p=>`${quantize(p[0])},${quantize(p[1])}`;
function canonicalRing(ring) {
  const points=ring.map(pointKey);if(points[0]===points.at(-1))points.pop();
  const variants=[];
  for(const run of [points,points.slice().reverse()]) {let best=0;for(let i=1;i<run.length;i++)if(run[i]<run[best])best=i;variants.push([...run.slice(best),...run.slice(0,best)].join(';'));}
  return variants.sort()[0]??'';
}
export function waterFeatureKey(layer,id,geometry) {
  const lineKey=points=>{const a=points.map(pointKey).join(';'),b=points.slice().reverse().map(pointKey).join(';');return a<b?a:b;};
  const parts=geometry.type==='LineString'?[lineKey(geometry.coordinates)]:geometry.type==='MultiLineString'?geometry.coordinates.map(lineKey):geometry.type==='Polygon'?[geometry.coordinates.map(canonicalRing).join('|')]:geometry.coordinates.map(r=>r.map(canonicalRing).join('|'));
  return `${layer}:${id??'sans-id'}:${parts.sort().join('||')}`;
}
const geo=(p,z)=>[tileXToLng(p.x,z),tileYToLat(p.z,z)];
const toGrid=(p,t,extent)=>({x:Math.round(lngToTileX(p[0],t.z)*extent*1e6)/1e6,z:Math.round(latToTileY(p[1],t.z)*extent*1e6)/1e6});
function clippedRings(rings,t,extent) {
  const x=t.x*extent,z=t.y*extent,square=[{x,z},{x:x+extent,z},{x:x+extent,z:z+extent},{x,z:z+extent}];
  const out=[],edgeKinds=[];
  for(const ring of rings) {
    let original=ring.map(p=>toGrid(p,t,extent));if(original.length>1 && original[0].x===original.at(-1).x && original[0].z===original.at(-1).z)original.pop();
    if(original.length<3)continue;
    const cut=intersectConvex(original,square);if(!cut.length)continue;
    const kinds=cut.map((a,i)=> {
      const b=cut[(i+1)%cut.length],mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      const boundary=(Math.abs(a.x-x)<1e-5 && Math.abs(b.x-x)<1e-5)||(Math.abs(a.x-x-extent)<1e-5 && Math.abs(b.x-x-extent)<1e-5)||(Math.abs(a.z-z)<1e-5 && Math.abs(b.z-z)<1e-5)||(Math.abs(a.z-z-extent)<1e-5 && Math.abs(b.z-z-extent)<1e-5);
      return boundary?'tile':original.some((p,j)=>segmentDistance(mid,p,original[(j+1)%original.length]).distance<1e-5)?'shore':'tile';
    });
    out.push(cut.map(p=>geo({x:p.x/extent,z:p.z/extent},t.z)));edgeKinds.push(kinds);
  }
  return {rings:out,edgeKinds};
}
function clippedLines(points,t,extent) {
  const runs=[];let run=[];const x=t.x*extent,z=t.y*extent;
  for(let i=1;i<points.length;i++) {
    const a=toGrid(points[i-1],t,extent),b=toGrid(points[i],t,extent),dx=b.x-a.x,dz=b.z-a.z;let lo=0,hi=1;
    for(const [p,q] of [[-dx,a.x-x],[dx,x+extent-a.x],[-dz,a.z-z],[dz,z+extent-a.z]]) {
      if(p===0) {if(q<0)hi=-1;continue;}
      const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);
    }
    if(lo>=hi) {if(run.length>1)runs.push(run);run=[];continue;}
    const first=geo({x:(a.x+dx*lo)/extent,z:(a.z+dz*lo)/extent},t.z),last=geo({x:(a.x+dx*hi)/extent,z:(a.z+dz*hi)/extent},t.z);
    if(run.length && pointKey(run.at(-1))!==pointKey(first)) {if(run.length>1)runs.push(run);run=[];}
    if(!run.length)run.push(first);run.push(last);
    if(hi<1) {runs.push(run);run=[];}
  }
  if(run.length>1)runs.push(run);return runs;
}
export function collectWaterFeatures(source,tiles,{waterSurfaceFor,waterwayStyleFor,waterways}) {
  const polygons=[],lines=[],buildings=[];
  for(const layer of ['water','waterway','building'])source.forEachFeature(layer,tiles,(geometry,properties,bounds,metadata={})=> {
    const t=metadata.tile??tiles.find(t=>Math.abs(tileXToLng(t.x,t.z)-bounds?.west)<1e-6),extent=metadata.extent??4096,id=metadata.id??null;
    if(!t)return;
    if(layer==='waterway') {
      if(!waterwayStyleFor(properties,waterways))return;
      const paths=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
      for(const path of paths)for(const points of clippedLines(path,t,extent))lines.push({key:waterFeatureKey(layer,id,{type:'LineString',coordinates:points}),kind:properties.class,points,sourceId:id,tile:t,extent,paintKey:waterFeatureKey(layer,id,geometry)});
      return;
    }
    if(layer==='water' && waterSurfaceFor(properties)!=='water')return;
    // Une hauteur totale n'établit pas que tout le volume est hors du sol.
    if(layer==='building' && (Number(properties.min_height)>0 || Number(properties.render_min_height)>0 || Number(properties.building_min_level)>0))return;
    const shapes=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
    for(const shape of shapes) {
      const cut=clippedRings(shape,t,extent);if(!cut.rings.length)continue;
      if(layer==='building')buildings.push({rings:cut.rings,properties});
      else polygons.push({...cut,key:waterFeatureKey(layer,id,{type:'Polygon',coordinates:cut.rings}),kind:properties.class,sourceId:id,tile:t,extent,paintKey:waterFeatureKey(layer,id,geometry)});
    }
  });
  polygons.sort((a,b)=>a.key.localeCompare(b.key));lines.sort((a,b)=>a.key.localeCompare(b.key));
  return {polygons,lines,buildings};
}
export function groupWaterPolygons(polygons) {
  const groups=new Map();
  for(const p of polygons) {const key=p.sourceId==null?p.key:`water:${p.kind}:${p.sourceId}`;let g=groups.get(key);if(!g)groups.set(key,g={key,kind:p.kind,sourceId:p.sourceId,fragments:[]});if(!g.fragments.some(f=>f.key===p.key))g.fragments.push(p);}
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
export function componentEdges(component,frame) {
  const edges=component.fragments.flatMap(f=>f.rings.flatMap((ring,r)=>ring.map((p,i)=>({a:frame.toLocal(...p),b:frame.toLocal(...ring[(i+1)%ring.length]),kind:f.edgeKinds[r][i],fragment:f}))));
  const out=[];
  for(const edge of edges) {
    if(edge.kind!=='tile') {out.push(edge);continue;}
    let intervals=[[0,1]];
    for(const other of edges) {
      if(other===edge || other.fragment.tile.x===edge.fragment.tile.x && other.fragment.tile.y===edge.fragment.tile.y)continue;
      const dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,d=dx*dx+dz*dz;
      if(Math.abs((other.a.x-edge.a.x)*dz-(other.a.z-edge.a.z)*dx)>1e-5*Math.sqrt(d) || Math.abs((other.b.x-edge.a.x)*dz-(other.b.z-edge.a.z)*dx)>1e-5*Math.sqrt(d))continue;
      const ta=((other.a.x-edge.a.x)*dx+(other.a.z-edge.a.z)*dz)/d,tb=((other.b.x-edge.a.x)*dx+(other.b.z-edge.a.z)*dz)/d,lo=Math.min(ta,tb),hi=Math.max(ta,tb);
      intervals=intervals.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b]]:[[a,Math.max(a,lo)],[Math.min(b,hi),b]].filter(([a,b])=>b-a>1e-8));
    }
    for(const [a,b] of intervals)out.push({...edge,a:{x:edge.a.x+(edge.b.x-edge.a.x)*a,z:edge.a.z+(edge.b.z-edge.a.z)*a},b:{x:edge.a.x+(edge.b.x-edge.a.x)*b,z:edge.a.z+(edge.b.z-edge.a.z)*b}});
  }
  return out;
}
export class WaterFeatureCollector {
  constructor(classification) {this.classification=classification;this.cache=new Map();this.neighbours=null;}
  async collect(source,tiles,frame,alive=()=>true) {
    const initial=collectWaterFeatures(source,tiles,this.classification),needed=new Set(tiles.map(tileKey));
    if(source.templates && !this.neighbours)this.neighbours=new VectorTileSource({tiles:source.templates,zoom:source.zoom,maxTiles:1});
    const neighbourSource=this.neighbours??source;
    for(const tile of tiles)this.cache.set(tileKey(tile),collectWaterFeatures(source,[tile],this.classification));
    const groups=groupWaterPolygons(initial.polygons),completed=[];
    for(const group of groups) {
      if(!['lake','pond','reservoir','basin'].includes(group.kind)) {completed.push(...group.fragments);continue;}
      const visited=new Set(group.fragments.map(f=>tileKey(f.tile)));let missing=false;
      while(true) {
        const edges=componentEdges(group,frame).filter(e=>e.kind==='tile');if(!edges.length)break;
        if(group.sourceId==null) {missing=true;break;}
        const requests=new Map();
        for(const e of edges) {
          const mid=frame.toLngLat((e.a.x+e.b.x)/2,(e.a.z+e.b.z)/2),t=e.fragment.tile,tx=lngToTileX(mid.lng,t.z),ty=latToTileY(mid.lat,t.z);
          const n={...t};if(Math.abs(tx-t.x)<1e-7)n.x--;else if(Math.abs(tx-t.x-1)<1e-7)n.x++;else if(Math.abs(ty-t.y)<1e-7)n.y--;else n.y++;
          if(!visited.has(tileKey(n)))requests.set(tileKey(n),n);
        }
        if(!requests.size) {missing=true;break;}
        for(const [key,t] of [...requests].sort(([a],[b])=>a.localeCompare(b))) {
          if(visited.size>=WATER_COMPONENT_TILE_LIMIT || !alive()) {missing=true;break;}
          visited.add(key);needed.add(key);
          let extracted=this.cache.get(key);
          if(!extracted) {await neighbourSource.load(t.x,t.y);if(!alive())return null;extracted=collectWaterFeatures(neighbourSource,[t],this.classification);this.cache.set(key,extracted);}
          for(const p of extracted.polygons)if(p.sourceId===group.sourceId && p.kind===group.kind && !group.fragments.some(f=>f.key===p.key))group.fragments.push(p);
        }
        if(missing)break;
      }
      for(const p of group.fragments)completed.push({...p,incomplete:missing});
    }
    // Les objets du lot gardent leurs fragments ; les voyages ne grossissent pas le cache.
    for(const key of this.cache.keys())if(!needed.has(key))this.cache.delete(key);
    return {...initial,polygons:completed};
  }
  clear() {this.cache.clear();this.neighbours?.dispose();this.neighbours=null;}
}
