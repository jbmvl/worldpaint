/*
 * Deux nœuds peuvent borner une minuscule boucle entièrement couverte par
 * leurs chaussées. Ses deux branches ne s'écartent jamais : les prolonger
 * pour fabriquer une fourche inventerait un îlot au-delà du nœud suivant.
 * La surface conserve les deux rives extérieures et toutes les bouches libres,
 * même lorsqu'il n'en reste que deux. Les connexions du graphe et la largeur
 * des chaussées restent celles des branches.
 */
import { pathFrames, subdividePath } from './ribbonGeometry.js';
import { WORK_TUNNEL } from './roadWorks.js';

const same=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<1e-6;
const near=(point,path)=>{
  let distance=Infinity;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/(dx*dx+dz*dz || 1)));
    distance=Math.min(distance,Math.hypot(point.x-a.x-t*dx,point.z-a.z-t*dz));
  }
  return distance;
};

export function junctionLinks(junctions) {
  const used=new Set(), result=[];
  for(const node of junctions.slice().sort((a,b)=>a.x-b.x || a.z-b.z || a.level-b.level)) {
    if(used.has(node))continue;
    const branches=node.branches;
    let link=null;
    if(!node.roundabout && branches.length===3) for(let i=0;i<3 && !link;i++)for(let j=i+1;j<3 && !link;j++) {
      const a=branches[i],b=branches[j];
      if(!a.path?.length || !b.path?.length || !same(a.path.at(-1),b.path.at(-1)))continue;
      if(a.profile!==b.profile || a.halfWidth!==b.halfWidth)continue;
      const other=junctions.find(n=>n!==node && !used.has(n) && n.level===node.level && same(n,a.path.at(-1)));
      if(!other || other.roundabout || other.branches.length<3)continue;
      const back=other.branches.filter(branch=>branch.path?.length && same(branch.path.at(-1),node))
        .sort((a,b)=>a.x-b.x || a.z-b.z || a.path.length-b.path.length);
      if(back.length!==2)continue;
      const paths=[a,b].map(branch=>subdividePath(branch.path,.5));
      if(paths.some((path,k)=>path.some(p=>near(p,paths[1-k])>=a.halfWidth+b.halfWidth)))continue;
      const ouvrages=[a,b].flatMap(branch=>[...(branch.edges || [])].map(edge=>edge.works || 0));
      if(ouvrages.some(work=>work!==0) && !ouvrages.every(work=>work===WORK_TUNNEL))continue;
      const free=[branches.find(branch=>branch!==a && branch!==b),...other.branches.filter(branch=>!back.includes(branch))];
      link={...node,branches:free,link:{nodes:[node,other],branches:[a,b],back:back[0]},
        ringEdges:new Set([...(a.edges || []),...(b.edges || [])])};
      used.add(other);
    }
    used.add(node);result.push(link ?? node);
  }
  return result;
}

export function junctionLinkArea(junction, sectionAt, margin, buildArea) {
  const {nodes,branches,back}=junction.link;
  const area=buildArea({...nodes[1],extremiteLiaison:true,branches:[back,...junction.branches.slice(1)]});
  if (!area) return null;
  area.noeuds=nodes;
  const at=area.mouths.findIndex(m=>m.edge===back.edge);
  if(at<0)return null;
  const old=area.mouths[at],branch=junction.branches[0];
  const distance=branch.halfWidth*.5+margin;
  const {centre,direction}=sectionAt(nodes[0],branch,distance),w=branch.halfWidth;
  const point=side=>({x:centre.x+side*direction.z*w,z:centre.z-side*direction.x*w,from:at,to:at,blend:0});
  const mouth={edge:branch.edge,origin:nodes[0],profile:branch.profile,halfWidth:w,centre,direction,distance,left:point(1),right:point(-1)};
  const dx=nodes[1].x-nodes[0].x,dz=nodes[1].z-nodes[0].z;
  const side=branch=>branch.path.reduce((sum,p)=>sum+dx*(p.z-nodes[0].z)-dz*(p.x-nodes[0].x),0)/branch.path.length;
  const sorted=branches.slice().sort((a,b)=>side(a)-side(b));
  const rail=(branch,sign)=>{
    const path=subdividePath(branch.path,4),frames=pathFrames(path);
    const points=path.map((p,i)=>({x:p.x+sign*frames[i*4+2]*branch.halfWidth,z:p.z+sign*frames[i*4+3]*branch.halfWidth,
      from:at,to:at,blend:0}));
    const along=p=>(p.x-old.centre.x)*old.direction.x+(p.z-old.centre.z)*old.direction.z;
    const out=[];
    for(let i=0;i<points.length;i++) {
      const p=points[i];
      if(along(p)>=0)out.push(p);
      else if(i>0) {
        const a=points[i-1],t=along(a)/(along(a)-along(p));
        out.push({...p,x:a.x+(p.x-a.x)*t,z:a.z+(p.z-a.z)*t});break;
      }
    }
    return out;
  };
  const upper=rail(sorted[0],1),lower=rail(sorted[1],-1);
  const first=area.outline.indexOf(old.left);
  area.outline.splice(first,2,...lower.slice().reverse(),mouth.left,mouth.right,...upper);
  area.mouths[at]=mouth;
  area.edges=area.mouths.map((m,i)=>{
    const points=[m.right];
    let index=(area.outline.indexOf(m.right)+1)%area.outline.length;
    while(!area.mouths.some(other=>other.left===area.outline[index])) {
      points.push(area.outline[index]);index=(index+1)%area.outline.length;
    }
    const to=area.mouths.findIndex(other=>other.left===area.outline[index]);
    points.push(area.outline[index]);
    const middle=points[Math.floor(points.length/2)],length=Math.hypot(middle.x-area.x,middle.z-area.z)||1;
    return {from:i,to,points,outward:{x:(middle.x-area.x)/length,z:(middle.z-area.z)/length}};
  });
  area.radius=Math.max(...area.outline.map(p=>Math.hypot(p.x-area.x,p.z-area.z)));
  return area;
}
