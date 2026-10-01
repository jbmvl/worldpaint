/*
 * Triangles communs au rendu, aux altitudes et au déblai. Un contour simple
 * conserve toutes ses arêtes, y compris les subdivisions des bouches.
 * Un échec est publié comme invalide, jamais remplacé par un éventail qui
 * traverse le contour. Les validations strictes appartiennent aux tests.
 */
const cache = new WeakMap();
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);

function simple(outline) {
  const n=outline.length;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    if(j===i+1 || (i===0 && j===n-1))continue;
    const a=outline[i],b=outline[(i+1)%n],c=outline[j],d=outline[(j+1)%n];
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    if(abC*abD>1e-16 || cdA*cdB>1e-16)continue;
    if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-1e-9 || Math.max(c.x,d.x)<Math.min(a.x,b.x)-1e-9 ||
      Math.max(a.z,b.z)<Math.min(c.z,d.z)-1e-9 || Math.max(c.z,d.z)<Math.min(a.z,b.z)-1e-9)continue;
    return false;
  }
  return true;
}

export function junctionTriangles(area) {
  const previous=cache.get(area);
  const outline=area.outline,n=outline.length;
  if(previous?.outlineLength===n)return previous;
  const vertices=[{x:area.x,z:area.z},...outline],triangles=[];
  let valid=n>=3 && simple(outline);
  if(valid && area.island?.length===n) {
    vertices.push(...area.island);
    for(let i=0;i<n;i++) {
      const next=(i+1)%n;
      triangles.push([n+1+i,1+next,1+i],[n+1+i,n+1+next,1+next]);
    }
  } else if(valid) {
    const signed=outline.reduce((sum,p,i)=>sum+p.x*outline[(i+1)%n].z-p.z*outline[(i+1)%n].x,0);
    const sign=signed<0?-1:1;
    if(outline.every((p,i)=>sign*cross(vertices[0],p,outline[(i+1)%n])>1e-9)) {
      for(let i=0;i<n;i++)triangles.push([0,1+(i+1)%n,1+i]);
    } else {
      const ring=Array.from({length:n},(_,i)=>i+1);
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
        if(!found)break;
      }
      valid=ring.length===3 && sign*cross(...ring.map(i=>vertices[i]))>1e-9;
      if(valid)triangles.push([ring[0],ring[2],ring[1]]);
    }
  }
  for(const triangle of triangles) {
    const orientation=cross(...triangle.map(i=>vertices[i]));
    if(!Number.isFinite(orientation) || Math.abs(orientation)<1e-9)valid=false;
    if(orientation>0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
  }
  if(!valid)triangles.length=0;
  const result={vertices,triangles,valid,outlineLength:n};
  cache.set(area,result);return result;
}
