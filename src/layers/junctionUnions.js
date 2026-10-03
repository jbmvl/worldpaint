/*
 * Une fourche peut atteindre le carrefour suivant avant que ses voies se
 * séparent. Leurs dalles partagent alors un contour, sans fusion du graphe.
 * Seules les unions sans îlot et conservant chaque bouche extérieure entière
 * sont retenues ; une section extrapolée doit retrouver un vrai axe du groupe.
 */
import { junctionTriangles } from './junctionTriangulation.js';
const cle = p => `${Math.round(p.x*1e7)},${Math.round(p.z*1e7)}`;
const produit = (ax,az,bx,bz) => ax*bz-az*bx;
const dedans = (contour,p) => {
  let oui=false;
  for(let i=0,j=contour.length-1;i<contour.length;j=i++) {
    const a=contour[i],b=contour[j];
    if((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)oui=!oui;
  }
  return oui;
};

function contourCommun(aires) {
  const segments=aires.flatMap(a=>a.outline.map((p,i)=>({p,q:a.outline[(i+1)%a.outline.length],coupes:[0,1]})));
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++) {
    const a=segments[i],b=segments[j],ux=a.q.x-a.p.x,uz=a.q.z-a.p.z,vx=b.q.x-b.p.x,vz=b.q.z-b.p.z;
    const det=produit(ux,uz,vx,vz),dx=b.p.x-a.p.x,dz=b.p.z-a.p.z;
    if(Math.abs(det)>1e-10) {
      const t=produit(dx,dz,vx,vz)/det,u=produit(dx,dz,ux,uz)/det;
      if(t>=-1e-9 && t<=1+1e-9 && u>=-1e-9 && u<=1+1e-9) {
        a.coupes.push(Math.max(0,Math.min(1,t)));b.coupes.push(Math.max(0,Math.min(1,u)));
      }
    } else if(Math.abs(produit(dx,dz,ux,uz))<1e-8) {
      for(const [s,r] of [[a,b],[b,a]]) {
        const sx=s.q.x-s.p.x,sz=s.q.z-s.p.z,l=sx*sx+sz*sz;
        if(l<1e-12)continue;
        for(const p of [r.p,r.q]) {
          const t=((p.x-s.p.x)*sx+(p.z-s.p.z)*sz)/l;
          if(t>0 && t<1)s.coupes.push(t);
        }
      }
    }
  }
  const aretes=new Map();
  for(const {p,q,coupes} of segments) {
    coupes.sort((a,b)=>a-b);
    const dx=q.x-p.x,dz=q.z-p.z,longueur=Math.hypot(dx,dz);
    if(longueur<1e-8)continue;
    const point=t=>({x:p.x+dx*t,z:p.z+dz*t});
    for(let i=1;i<coupes.length;i++) {
      if((coupes[i]-coupes[i-1])*longueur<1e-7)continue;
      const milieu=point((coupes[i]+coupes[i-1])/2),epsilon=Math.min(1e-5,(coupes[i]-coupes[i-1])*longueur/10);
      const gauche={x:milieu.x-dz/longueur*epsilon,z:milieu.z+dx/longueur*epsilon};
      const droite={x:milieu.x+dz/longueur*epsilon,z:milieu.z-dx/longueur*epsilon};
      const g=aires.some(a=>dedans(a.outline,gauche)),d=aires.some(a=>dedans(a.outline,droite));
      if(g===d)continue;
      const a=point(g?coupes[i-1]:coupes[i]),b=point(g?coupes[i]:coupes[i-1]);
      const key=cle(a),fin=cle(b),ancienne=aretes.get(key);
      if(ancienne && cle(ancienne.q)!==fin)return null;
      aretes.set(key,{p:a,q:b});
    }
  }
  if(aretes.size<3)return null;
  const debut=[...aretes.keys()].sort()[0],contour=[];
  let courant=debut;
  while(aretes.has(courant)) {
    const {p,q}=aretes.get(courant);aretes.delete(courant);contour.push(p);courant=cle(q);
    if(courant===debut)break;
  }
  return courant===debut && aretes.size===0 ? contour : null;
}

function axeDeBouche(bouche,groupe) {
  for(const {junction} of groupe)for(const branche of junction.branches) {
    if(branche.profile!==bouche.profile || Math.abs(branche.halfWidth-bouche.halfWidth)>1e-6)continue;
    for(let i=1;i<(branche.path?.length ?? 0);i++) {
      const a=branche.path[i-1],b=branche.path[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);
      if(l<1e-8)continue;
      const t=((bouche.centre.x-a.x)*dx+(bouche.centre.z-a.z)*dz)/(l*l);
      if(t<0 || t>1)continue;
      if(Math.hypot(a.x+dx*t-bouche.centre.x,a.z+dz*t-bouche.centre.z)<1e-5 &&
        (dx*bouche.direction.x+dz*bouche.direction.z)/l>1-1e-6)return branche.edge;
    }
  }
  return null;
}

function aireCommune(groupe) {
  const contour=contourCommun(groupe.map(e=>e.area));
  if(!contour)return null;
  const rangs=new Map(contour.map((p,i)=>[cle(p),i])),bouches=[];
  for(const {area} of groupe)for(const bouche of area.mouths) {
    const dx=bouche.right.x-bouche.left.x,dz=bouche.right.z-bouche.left.z,longueur=Math.hypot(dx,dz);
    const frontiere=contour.some((a,i)=>{
      const b=contour[(i+1)%contour.length];
      if(Math.abs(produit(dx,dz,a.x-bouche.left.x,a.z-bouche.left.z))/longueur>1e-6 ||
        Math.abs(produit(dx,dz,b.x-bouche.left.x,b.z-bouche.left.z))/longueur>1e-6)return false;
      const ta=((a.x-bouche.left.x)*dx+(a.z-bouche.left.z)*dz)/(longueur*longueur);
      const tb=((b.x-bouche.left.x)*dx+(b.z-bouche.left.z)*dz)/(longueur*longueur);
      return Math.min(1,Math.max(ta,tb))-Math.max(0,Math.min(ta,tb))>1e-6;
    });
    if(!frontiere)continue;
    const gauche=rangs.get(cle(bouche.left)),droite=rangs.get(cle(bouche.right));
    if(gauche===undefined || droite!==(gauche+1)%contour.length)return null;
    const edge=axeDeBouche(bouche,groupe);
    if(!edge)return null;
    bouches.push({...bouche,edge,left:contour[gauche],right:contour[droite],rang:gauche});
  }
  if(bouches.length<3)return null;
  bouches.sort((a,b)=>a.rang-b.rang);
  const edges=bouches.map((bouche,i)=>{
    Object.assign(bouche.left,{from:i,to:i,blend:0});Object.assign(bouche.right,{from:i,to:i,blend:0});
    const suivant=(i+1)%bouches.length,fin=bouches[suivant].left,points=[bouche.right];
    let rang=(bouche.rang+2)%contour.length;
    while(contour[rang]!==fin) {points.push(contour[rang]);rang=(rang+1)%contour.length;}
    points.push(fin);
    const distances=[0];
    for(let j=1;j<points.length;j++)distances.push(distances[j-1]+Math.hypot(points[j].x-points[j-1].x,points[j].z-points[j-1].z));
    for(let j=1;j<points.length-1;j++)Object.assign(points[j],{from:i,to:suivant,blend:distances[j]/(distances.at(-1)||1)});
    const a=points[0],b=points.at(-1),l=Math.hypot(b.x-a.x,b.z-a.z)||1;
    return {from:i,to:suivant,points,outward:{x:(b.z-a.z)/l,z:-(b.x-a.x)/l}};
  });
  const noeuds=new Set(groupe.map(e=>cle(e.junction))),ringEdges=new Set();
  for(const {junction} of groupe)for(const branche of junction.branches) {
    const bout=branche.path?.at(-1);
    if(bout && noeuds.has(cle(bout)))for(const edge of branche.edges ?? [])ringEdges.add(edge);
  }
  const origine=groupe[0].area,dominante=groupe.reduce((a,b)=>a.area.halfWidth>=b.area.halfWidth?a:b).area;
  const aire={...origine,fork:false,noeuds:groupe.map(e=>e.junction),degree:bouches.length,profile:dominante.profile,halfWidth:dominante.halfWidth,mouths:bouches,outline:contour,edges,ringEdges,
    radius:Math.max(...contour.map(p=>Math.hypot(p.x-origine.x,p.z-origine.z)))};
  return junctionTriangles(aire).valid ? aire : null;
}

export function unirAiresFourches(entrees) {
  const groupes=entrees.map((_,i)=>i),position=new Map(entrees.map((e,i)=>[`${e.junction.level}:${cle(e.junction)}`,i]));
  const racine=i=>groupes[i]===i?i:(groupes[i]=racine(groupes[i]));
  for(const [i,{junction,area}] of entrees.entries()) {
    if(!area.fork || junction.link || junction.roundabout)continue;
    for(const bouche of area.mouths) {
      const branche=junction.branches.find(b=>b.edge===bouche.edge);
      if(!branche || !(bouche.distance>branche.mouthLimit))continue;
      const bout=branche.path?.at(-1);
      if(!bout)continue;
      const j=position.get(`${junction.level}:${cle(bout)}`);
      if(j===undefined || entrees[j].junction.link || entrees[j].junction.roundabout)continue;
      if([...(branche.edges ?? [])].some(edge=>edge.works))continue;
      groupes[racine(j)]=racine(i);
    }
  }
  const lots=new Map();
  for(const [i,entree]of entrees.entries()) {
    const r=racine(i);if(!lots.has(r))lots.set(r,[]);lots.get(r).push(entree);
  }
  return [...lots.values()].flatMap(groupe=>{
    if(groupe.length===1)return [groupe[0].area];
    const aire=aireCommune(groupe);
    return aire?[aire]:groupe.map(e=>e.area);
  });
}
