/*
 * L'entrée courbe d'un giratoire appartient à sa dalle jusqu'au premier
 * raccord complet avec l'anneau. Son enveloppe radiale garde une couronne
 * triangulable sans replier les secteurs ni suivre une desserte extérieure.
 * Les bouches restent entières : une entrée qui les dépasse n'impose aucun
 * élargissement au contour.
 */
export function enveloppesEntrees(centre,rayon,bouches,branches) {
  const polygones=[];
  for(const bouche of bouches) {
    const branche=branches.find(b=>b.path?.[0]===bouche.origin);
    const chemin=branche?.path;
    if(!chemin?.length)continue;
    let ligne=-1,erreur=Infinity;
    for(let i=1;i<chemin.length;i++) {
      const a=chemin[i-1],b=chemin[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((bouche.centre.x-a.x)*dx+(bouche.centre.z-a.z)*dz)/(dx*dx+dz*dz || 1)));
      const ecart=Math.hypot(a.x+dx*t-bouche.centre.x,a.z+dz*t-bouche.centre.z);
      if(ecart<erreur) {erreur=ecart;ligne=i-1;}
    }
    const sections=[[bouche.left,bouche.right]];
    for(let i=ligne;i>=0;i--) {
      const p=chemin[i],avant=chemin[Math.max(0,i-1)],apres=chemin[i+1];
      const longueur=Math.hypot(apres.x-avant.x,apres.z-avant.z) || 1;
      const nx=(apres.z-avant.z)/longueur,nz=-(apres.x-avant.x)/longueur;
      const section=[1,-1].map(s=>({x:p.x+s*nx*bouche.halfWidth,z:p.z+s*nz*bouche.halfWidth}));
      sections.push(section);
      if(section.every(q=>Math.hypot(q.x-centre.x,q.z-centre.z)<=rayon))break;
    }
    if(!sections.at(-1).every(q=>Math.hypot(q.x-centre.x,q.z-centre.z)<=rayon))continue;
    for(let i=1;i<sections.length;i++)polygones.push([sections[i-1][0],sections[i-1][1],sections[i][1],sections[i][0]]);
  }
  const aretes=polygones.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%p.length]]));
  const angle=p=>Math.atan2(p.z-centre.z,p.x-centre.x);
  const rayonA=azimut=>{
    const dx=Math.cos(azimut),dz=Math.sin(azimut);
    let distance=rayon;
    for(const [a,b] of aretes) {
      const ax=a.x-centre.x,az=a.z-centre.z,ex=b.x-a.x,ez=b.z-a.z;
      const determinant=dx*ez-dz*ex;
      if(Math.abs(determinant)<1e-9)continue;
      const r=(ax*ez-az*ex)/determinant,t=(ax*dz-az*dx)/determinant;
      if(t>=-1e-8 && t<=1+1e-8)distance=Math.max(distance,r);
    }
    return distance;
  };
  const angles=polygones.flatMap(p=>p.map(angle));
  for(const [a,b] of aretes) {
    const ax=a.x-centre.x,az=a.z-centre.z,dx=b.x-a.x,dz=b.z-a.z;
    const aa=dx*dx+dz*dz,bb=2*(ax*dx+az*dz),cc=ax*ax+az*az-rayon*rayon;
    const discriminant=bb*bb-4*aa*cc;
    if(!(aa>0) || discriminant<0)continue;
    for(const t of [(-bb-Math.sqrt(discriminant))/(2*aa),(-bb+Math.sqrt(discriminant))/(2*aa)])
      if(t>0 && t<1)angles.push(angle({x:a.x+dx*t,z:a.z+dz*t}));
  }
  const controles=[...angles,...bouches.flatMap(b=>[angle(b.left),angle(b.right)])];
  for(const bouche of bouches)for(const azimut of controles) {
    const a=bouche.left,b=bouche.right,dx=Math.cos(azimut),dz=Math.sin(azimut);
    const ax=a.x-centre.x,az=a.z-centre.z,ex=b.x-a.x,ez=b.z-a.z;
    const determinant=dx*ez-dz*ex;
    if(Math.abs(determinant)<1e-9)continue;
    const r=(ax*ez-az*ex)/determinant,t=(ax*dz-az*dx)/determinant;
    if(r>0 && t>=-1e-8 && t<=1+1e-8 && rayonA(azimut)>Math.max(rayon,r)+.01)return null;
  }
  return {angles,rayonA};
}
