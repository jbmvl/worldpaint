/*
 * Couture du dégagement des portails sur les triangles du terrain affiché.
 * Les faces du passage sont découpées par les mêmes plans que le terrain :
 * leur bord supérieur est donc l'intersection commune, pas une hauteur sondée
 * à intervalles arbitraires. Seules les parties enterrées ferment le masque.
 */
function clip(polygon, distance) {
  const out=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);
    if(da>=-1e-9)out.push(a);
    if((da<0)!==(db<0)) {
      const t=da/(da-db);
      out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
    }
  }
  return out;
}

export function appendTunnelSeams(buffer, mouth, profile, tiles, floorDrop=0) {
  const {x,z,y,dx,dz,slope,apron}=mouth;
  const at=(p,along)=>({x:x+dx*along-dz*p.across,z:z+dz*along+dx*p.across,y:y+slope*along+p.up});
  const section=profile.map((p,i)=>({...p,up:i===0||i===profile.length-1?-floorDrop:p.up}));
  const faces=[];
  for(let i=1;i<section.length;i++) faces.push([at(section[i-1],-apron),at(section[i],-apron),at(section[i],0),at(section[i-1],0)]);
  faces.push(section.map(p=>at(p,-apron)));
  const points=faces.flat();
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
  let count=0;
  for(const tile of tiles) {
    const positions=tile.geometry.attributes.position.array,indices=tile.geometry.index.array;
    const n=tile.segments,step=tile.size/n,ox=positions[0],oz=positions[2];
    const loX=Math.max(0,Math.floor((minX-ox)/step)),hiX=Math.min(n-1,Math.floor((maxX-ox)/step));
    const loZ=Math.max(0,Math.floor((minZ-oz)/step)),hiZ=Math.min(n-1,Math.floor((maxZ-oz)/step));
    const vertex=i=>({x:positions[i*3],y:positions[i*3+1],z:positions[i*3+2]});
    for(let iz=loZ;iz<=hiZ;iz++)for(let ix=loX;ix<=hiX;ix++)for(let half=0;half<2;half++) {
      const offset=(iz*n+ix)*6+half*3;
      const triangle=[0,1,2].map(j=>vertex(indices[offset+j]));
      const [a,b,c]=triangle,ux=b.x-a.x,uz=b.z-a.z,vx=c.x-a.x,vz=c.z-a.z;
      const det=ux*vz-uz*vx;
      if(Math.abs(det)<1e-10)continue;
      const sign=Math.sign(det),gx=((b.y-a.y)*vz-(c.y-a.y)*uz)/det,gz=((c.y-a.y)*ux-(b.y-a.y)*vx)/det;
      for(const face of faces) {
        let polygon=face;
        for(let i=0;i<3 && polygon.length;i++) {
          const p=triangle[i],q=triangle[(i+1)%3];
          polygon=clip(polygon,v=>sign*((q.x-p.x)*(v.z-p.z)-(q.z-p.z)*(v.x-p.x)));
        }
        if(polygon.length<3)continue;
        polygon=clip(polygon,v=>a.y+gx*(v.x-a.x)+gz*(v.z-a.z)-v.y);
        if(polygon.length<3)continue;
        const base=buffer.positions.length/3;
        for(const p of polygon){buffer.positions.push(p.x,p.y,p.z);buffer.colors.push(...profile[0].color);}
        for(let j=1;j<polygon.length-1;j++){buffer.indices.push(base,base+j,base+j+1);count++;}
      }
    }
  }
  return count;
}
