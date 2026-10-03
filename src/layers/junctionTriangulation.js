/*
 * Triangles communs au rendu, aux altitudes et au déblai. Un contour simple
 * conserve toutes ses arêtes, y compris les subdivisions des bouches.
 * Un contour qui se recoupe — une bouche dont la tangente replie le bord —
 * perd sa plus petite boucle avant le découpage en oreilles : la dalle couvre
 * le reste plutôt que de laisser le terrain à nu. Une couronne de giratoire
 * se tend toujours de l'îlot au bord, quadrilatère par quadrilatère.
 * Un échec est publié comme invalide, jamais remplacé par un éventail qui
 * traverse le contour. Les validations strictes appartiennent aux tests.
 */
const cache = new WeakMap();
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);

/** Première paire d'arêtes non voisines qui se coupent, ou `null`. */
function crossing(outline) {
  const n=outline.length;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    if(j===i+1 || (i===0 && j===n-1))continue;
    const a=outline[i],b=outline[(i+1)%n],c=outline[j],d=outline[(j+1)%n];
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    if(abC*abD>1e-16 || cdA*cdB>1e-16)continue;
    if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-1e-9 || Math.max(c.x,d.x)<Math.min(a.x,b.x)-1e-9 ||
      Math.max(a.z,b.z)<Math.min(c.z,d.z)-1e-9 || Math.max(c.z,d.z)<Math.min(a.z,b.z)-1e-9)continue;
    return [i,j];
  }
  return null;
}

const area2 = (points) => Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%points.length].z-p.z*points[(i+1)%points.length].x,0));

/**
 * Rangs du contour qui forment un polygone simple : tant que deux arêtes se
 * coupent, la boucle qu'elles ferment est retirée si elle est la plus petite,
 * gardée seule sinon. `null` s'il ne reste pas de quoi faire un triangle.
 */
function untangle(outline) {
  let ring=outline.map((_,i)=>i);
  for(let pass=0;pass<outline.length && ring.length>=3;pass++) {
    const hit=crossing(ring.map(i=>outline[i]));
    if(!hit)return ring;
    const [i,j]=hit;
    const loop=ring.slice(i+1,j+1),rest=[...ring.slice(j+1),...ring.slice(0,i+1)];
    ring=area2(loop.map(k=>outline[k]))<area2(rest.map(k=>outline[k]))?rest:loop;
  }
  return null;
}

export function junctionTriangles(area) {
  const previous=cache.get(area);
  const outline=area.outline,n=outline.length;
  if(previous?.outlineLength===n)return previous;
  const vertices=[{x:area.x,z:area.z},...outline],triangles=[];
  const crown=n>=3 && area.island?.length===n;
  const kept=n>=3 && !crown ? untangle(outline) : null;
  let valid=crown || !!kept;
  if(crown) {
    vertices.push(...area.island);
    for(let i=0;i<n;i++) {
      const next=(i+1)%n;
      triangles.push([n+1+i,1+next,1+i],[n+1+i,n+1+next,1+next]);
    }
  } else if(valid) {
    const points=kept.map(i=>outline[i]);
    const m=points.length;
    const signed=points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%m].z-p.z*points[(i+1)%m].x,0);
    const sign=signed<0?-1:1;
    if(m===n && points.every((p,i)=>sign*cross(vertices[0],p,points[(i+1)%m])>1e-9)) {
      for(let i=0;i<n;i++)triangles.push([0,1+(i+1)%n,1+i]);
    } else {
      const ring=kept.map(i=>i+1);
      while(ring.length>3) {
        let found=false;
        for(let i=0;i<ring.length;i++) {
          const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length];
          if(sign*cross(vertices[a],vertices[b],vertices[c])<=1e-9)continue;
          const occupied=ring.some(j=>j!==a && j!==b && j!==c &&
            sign*cross(vertices[a],vertices[b],vertices[j])>=-1e-9 &&
            sign*cross(vertices[b],vertices[c],vertices[j])>=-1e-9 &&
            sign*cross(vertices[c],vertices[a],vertices[j])>=-1e-9);
          if(occupied)continue;
          triangles.push([a,c,b]);ring.splice(i,1);found=true;break;
        }
        if(!found) {
          // Un sommet aligné sur ses voisins (subdivision d'une bouche) n'est
          // jamais une oreille : il se retire sans triangle.
          const flat=ring.findIndex((b,i)=>Math.abs(cross(vertices[ring[(i+ring.length-1)%ring.length]],vertices[b],vertices[ring[(i+1)%ring.length]]))<=1e-9);
          if(flat<0)break;
          ring.splice(flat,1);
        }
      }
      valid=ring.length===3 && sign*cross(...ring.map(i=>vertices[i]))>1e-9;
      if(valid)triangles.push([ring[0],ring[2],ring[1]]);
    }
  }
  for(let t=triangles.length-1;t>=0;t--) {
    const triangle=triangles[t];
    const orientation=cross(...triangle.map(i=>vertices[i]));
    // Un quadrilatère de couronne aplati par un repli n'invalide pas l'anneau.
    if(crown && Math.abs(orientation)<1e-9) { triangles.splice(t,1); continue; }
    if(!Number.isFinite(orientation) || Math.abs(orientation)<1e-9)valid=false;
    if(orientation>0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
  }
  if(!valid)triangles.length=0;
  const result={vertices,triangles,valid,outlineLength:n};
  cache.set(area,result);return result;
}
