/*
 * Contrôle des chaussées revêtues affichées : sondages sur les triangles des rubans
 * et des dalles, comparés aux triangles chargés du terrain. Les chaussées
 * couvertes sont exclues : leur toit n'est pas un obstacle sur la chaussée.
 * Les chemins non terrassés ne participent pas à la mesure du déblai routier.
 * Les axes conservés sont aussi comparés aux triangles dessinés : l'absence
 * d'une chaussée n'est pas détectable en sondant seulement ce qui est rendu.
 * Aucun changement du monde ; le rapport conserve les points à regarder.
 */
import { tunnelAt } from '/src/layers/transportTunnels.js';

export function auditRoads(world, { radius = 700, tolerance = .002 } = {}) {
  const { roads, bubble } = world.composer;
  const breaches = [], invalid = [], missingMouths = [];
  let samples = 0, covered = 0, triangles = 0;
  const support = {};
  const mouths = world.composer.bridges.tunnelMouths.slice(0,24);
  const masked = (x,y,z) => mouths.some(m => {
    const dx=x-m.x,dz=z-m.z,along=dx*m.dx+dz*m.dz,lateral=-dx*m.dz+dz*m.dx;
    const height=y-m.y-along*m.slope;
    if(along<=-m.apron || along>=18 || Math.abs(lateral)>=m.radius || height<=.02) return false;
    const step=Math.PI/(m.steps??7),angle=Math.acos(Math.max(-1,Math.min(1,lateral/m.radius)));
    const a=Math.min(Math.floor(angle/step),(m.steps??7)-1)*step;
    const lx=Math.cos(a)*m.radius,ly=Math.sin(a)*m.radius,rx=Math.cos(a+step)*m.radius,ry=Math.sin(a+step)*m.radius;
    const roof=m.roofHeight || 1+.85*(ly+(ry-ly)*Math.max(0,Math.min(1,(lateral-lx)/(rx-lx))));
    return height<roof;
  });
  const weights = [[1/3,1/3,1/3], [.8,.1,.1], [.1,.8,.1], [.1,.1,.8], [.45,.45,.1], [.45,.1,.45], [.1,.45,.45]];
  for (const [family, meshes] of [['ribbon', roads.meshes], ['junction', roads.junctionMeshes]]) {
    for (const [profile, mesh] of Object.entries(meshes)) {
      if (family === 'junction' && profile !== 'asphalt') continue;
      if (!mesh || family === 'ribbon' && !roads.theme.roads.profiles[profile]?.surface && ['path','track','steps'].includes(profile)) continue;
      if (family === 'ribbon' && (roads.theme.roads.profiles[profile]?.surface ?? 'asphalt') !== 'asphalt') continue;
      const p = mesh.geometry.attributes.position.array, index = mesh.geometry.index.array;
      for (let i=0;i<index.length;i+=3) {
        const points = Array.from(index.slice(i,i+3), j=>({x:p[j*3],y:p[j*3+1],z:p[j*3+2]}));
        if (points.some(v=>![v.x,v.y,v.z].every(Number.isFinite))) { invalid.push({family,profile,triangle:i/3}); continue; }
        if (points.every(v=>Math.hypot(v.x,v.z)>radius)) continue;
        triangles++;
        for(const w of weights) {
          const at = key=>points.reduce((sum,v,j)=>sum+v[key]*w[j],0);
          const x=at('x'),z=at('z'),deck=at('y');
          if (Math.hypot(x,z)>radius) continue;
          if(tunnelAt(roads.roadSegments,x,z)) {covered++;continue;}
          const tunnel=roads.elevationIndex.queryAll(x,z,.1).some(({segment:s,row,t,distance})=>
            distance<=s.halfWidth+.1 && s.works?.[row]===2 && s.works?.[row+1]===2 &&
            Math.abs(s.platform[row]+(s.platform[row+1]-s.platform[row])*t-deck)<.1);
          if(tunnel) {covered++;continue;}
          if(!bubble.renderedSupportAtLocal(x,z,support)) continue;
          if(masked(x,support.y,z)) {covered++;continue;}
          samples++;
          const gap=support.y-deck;
          if(gap>tolerance) breaches.push({family,profile,x,z,gap,deck,ground:support.y});
        }
      }
    }
  }
  for(const a of roads.junctionAreas.areas) {
    if(Math.hypot(a.x,a.z)>radius)continue;
    for(const [i,m] of a.mouths.entries()) if(!m.seam) missingMouths.push({x:a.x,z:a.z,profile:a.profile,mouth:i});
  }
  breaches.sort((a,b)=>b.gap-a.gap);
  return { radius, tolerance, triangles, samples, covered, breaches, invalid, missingMouths,
    coverage: auditRoadCoverage(world,{radius}),
    segments:roads.roadSegments.length, junctions:roads.crossings,
    profiles:roads.roadSegments.reduce((out,s)=>(out[s.profile]=(out[s.profile]??0)+1,out),{}) };
}

export function auditRoadCoverage(world,{radius=700}={}) {
  const roads=world.composer.roads,cells=new Map(),step=24,missing=[],profiles={};
  let samples=0;
  const key=(x,z)=>`${Math.floor(x/step)},${Math.floor(z/step)}`;
  for(const [family,meshes] of [['ribbon',roads.meshes],['junction',roads.junctionMeshes]])for(const [profile,mesh] of Object.entries(meshes)) {
    if(!mesh || (family==='junction' ? profile!=='asphalt' : (roads.theme.roads.profiles[profile]?.surface ?? 'asphalt')!=='asphalt'))continue;
    const positions=mesh.geometry.attributes.position.array,index=mesh.geometry.index.array;
    for(let i=0;i<index.length;i+=3) {
      const tri=Array.from(index.slice(i,i+3),j=>({x:positions[j*3],z:positions[j*3+2]}));
      const xs=tri.map(p=>p.x),zs=tri.map(p=>p.z);
      for(let x=Math.floor(Math.min(...xs)/step);x<=Math.floor(Math.max(...xs)/step);x++)
        for(let z=Math.floor(Math.min(...zs)/step);z<=Math.floor(Math.max(...zs)/step);z++) {
          const at=`${x},${z}`;
          if(!cells.has(at))cells.set(at,[]);
          cells.get(at).push(tri);
        }
    }
  }
  const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
  for(const [si,segment] of roads.roadSegments.entries()) {
    if(!segment.paved)continue;
    profiles[segment.profile]??={samples:0,missing:0};
    for(let row=1;row<segment.path.length;row++) {
      const a=segment.path[row-1],b=segment.path[row],point={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      if(Math.hypot(point.x,point.z)>radius)continue;
      samples++;profiles[segment.profile].samples++;
      const hit=(cells.get(key(point.x,point.z)) ?? []).some(tri=>{
        const sides=tri.map((p,i)=>cross(p,tri[(i+1)%3],point));
        if(Math.abs(cross(...tri))<1e-8)return false;
        return Math.min(...sides)>=-1e-5 || Math.max(...sides)<=1e-5;
      });
      if(!hit) {
        profiles[segment.profile].missing++;
        missing.push({...point,profile:segment.profile,segment:si,row:row-1});
      }
    }
  }
  return {radius,samples,missing,profiles};
}
