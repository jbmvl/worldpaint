/* Contours fournis par le compositeur : aucun accès aux couches. Les profils
 * construits priment où leur couverture est connue ; ailleurs les lignes
 * sources assurent une protection conservatrice, sans plafond de distance.
 * `bounds` écarte ce qui ne touche pas le carré où l'eau est posée. */
import {triangulateRings,fan,boundsOf,overlap,interpolate} from '../core/waterGeometry.js';
export function waterProtectionTriangles({buildings,frame,roadContours=[],railContours=[],junctionTriangles=[],sourceContours=[],knownCoverage=()=>0,bounds=null},triangulateShape) {
  const within=points=>!bounds || points.length>0 && overlap(boundsOf(points),bounds);
  const triangles=junctionTriangles.filter(within);
  for(const building of buildings) {
    const rings=building.rings.map(r=>r.map(p=>frame.toLocal(...p)));
    if(within(rings[0]??[]))triangles.push(...triangulateRings(rings,triangulateShape));
  }
  for(const contour of [...roadContours,...railContours])if(within(contour))triangles.push(...fan(contour));
  const outside=t=> {
    const b=boundsOf(t);if(knownCoverage(b.minX,b.minZ,b.maxX,b.maxZ)>=1-1e-9)return [];
    const lengths=t.map((p,i)=>Math.hypot(p.x-t[(i+1)%3].x,p.z-t[(i+1)%3].z)),edge=lengths.indexOf(Math.max(...lengths));
    if(Math.max(...lengths)<=8 || knownCoverage(b.minX,b.minZ,b.maxX,b.maxZ)<=0)return [t];
    const a=t[edge],c=t[(edge+1)%3],d=t[(edge+2)%3],mid=interpolate(a,c,0.5);return [...outside([a,mid,d]),...outside([mid,c,d])];
  };
  for(const contour of sourceContours)if(within(contour))for(const t of fan(contour))triangles.push(...outside(t));
  return triangles;
}
