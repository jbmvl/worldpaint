/*
 * Contrôle de la voirie affichée : sondages sur les triangles des rubans
 * et des dalles, comparés aux triangles chargés du terrain. Les chaussées
 * couvertes sont exclues : leur toit n'est pas un obstacle sur la chaussée.
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
          const hit=roads.elevationIndex.query(x,z,0);
          if(hit && (hit.segment.works?.[hit.row] || hit.segment.works?.[hit.row+1])) {covered++;continue;}
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
    segments:roads.roadSegments.length, junctions:roads.crossings,
    profiles:roads.roadSegments.reduce((out,s)=>(out[s.profile]=(out[s.profile]??0)+1,out),{}) };
}
