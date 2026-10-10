/*
 * waterRelief — niveaux de l'eau et raccord terrestre des berges.
 * Les lacs partagent une cote entre tous leurs morceaux ; les rivières lisent
 * un champ d'altitude lissé sur leur axe, puis le reportent en travers du lit.
 * Le MNT brut reste la seule source de hauteur. Ni le déblai routier, ni la
 * finesse de la maille, ni l'observateur ne participent à cette estimation.
 * Les segments de berge sont indexés dans leur bande de raccord : une sonde
 * ne projette pas sur tout le contour d'une nappe pour trouver sa rive.
 * Le terrain sonde ce module cinq fois par sommet : l'appartenance à une nappe
 * ne lit que les arêtes de sa bande de latitude, et l'axe le plus proche se
 * cherche de proche en proche dans une grille, pas dans toute la rivière.
 * Une nappe tronquée sans cote connue attend son contour complet : choisir
 * un niveau sur le seul fragment visible ferait monter le lac en avançant.
 */
import { classPolygons, waterSurfaceFor, waterwayStyleFor } from './surfaceClassification.js';

const CELL = 128;
const PROFILE_STEP = 32;
const BANK_BLEND = 16;
const BAND = 8;
const clamp = t => Math.max(0, Math.min(1, t));
const smooth = t => t * t * (3 - 2 * t);
// Clé entière d'une cellule : exacte tant que |z| < 2^25.
const key = (x, z) => x * 67108864 + z;

function projection(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x-a.x)*dx + (z-a.z)*dz) / (dx*dx + dz*dz || 1));
  const px = a.x + t*dx, pz = a.z + t*dz;
  return { x: px, z: pz, distance: Math.hypot(x-px, z-pz) };
}

/** Arêtes d'un contour rangées par bande de z : seules celles-là peuvent couper le rayon d'une sonde. */
function edgeBands(rings) {
  const bands = new Map();
  for (const ring of rings) for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
    const a=ring[i], b=ring[j];
    if (a.z===b.z) continue;
    const last=Math.floor(Math.max(a.z,b.z)/BAND);
    for (let row=Math.floor(Math.min(a.z,b.z)/BAND); row<=last; row++) {
      let edges=bands.get(row);
      if (!edges) bands.set(row, edges=[]);
      edges.push(a.x,a.z,b.x,b.z);
    }
  }
  return bands;
}

function inside(x, z, bands) {
  const edges = bands.get(Math.floor(z/BAND));
  if (!edges) return false;
  let yes = false;
  for (let k=0; k<edges.length; k+=4) {
    const ax=edges[k], az=edges[k+1], bz=edges[k+3];
    if ((az>z)!==(bz>z) && x<(edges[k+2]-ax)*(z-az)/(bz-az)+ax) yes=!yes;
  }
  return yes;
}

function bounds(points) {
  let minX=Infinity, minZ=Infinity, maxX=-Infinity, maxZ=-Infinity;
  for (const p of points) {
    minX=Math.min(minX,p.x); minZ=Math.min(minZ,p.z);
    maxX=Math.max(maxX,p.x); maxZ=Math.max(maxZ,p.z);
  }
  return {minX,minZ,maxX,maxZ};
}

function nearBox(x,z,b,margin=0) {
  return x>=b.minX-margin && x<=b.maxX+margin && z>=b.minZ-margin && z<=b.maxZ+margin;
}

/** Grille des axes d'une rivière, sans marge, et son emprise en cellules. */
function axisCells(axes) {
  const cells=new Map();
  let minX=Infinity, minZ=Infinity, maxX=-Infinity, maxZ=-Infinity;
  for(const axis of axes) {
    addToGrid(cells,axis,axis.box,0);
    minX=Math.min(minX,Math.floor(axis.box.minX/CELL)); maxX=Math.max(maxX,Math.floor(axis.box.maxX/CELL));
    minZ=Math.min(minZ,Math.floor(axis.box.minZ/CELL)); maxZ=Math.max(maxZ,Math.floor(axis.box.maxZ/CELL));
  }
  return {cells,minX,minZ,maxX,maxZ};
}

function quantile(values, part) {
  values.sort((a,b)=>a-b);
  return values.length ? values[Math.floor((values.length-1)*part)] : NaN;
}

function addToGrid(grid, item, box, margin) {
  for(let z=Math.floor((box.minZ-margin)/CELL);z<=Math.floor((box.maxZ+margin)/CELL);z++)
    for(let x=Math.floor((box.minX-margin)/CELL);x<=Math.floor((box.maxX+margin)/CELL);x++) {
      const k=key(x,z);
      let entries=grid.get(k);
      if(!entries) grid.set(k,entries=[]);
      entries.push(item);
    }
}

export class WaterRelief {
  constructor({ source, tiles, frame, elevationAt, waterways, benchM = 8 }) {
    this.benchM=benchM;
    this.grid=new Map();
    this.axisGrid=new Map();
    this.axisCells=new WeakMap();
    this.elevationAt=elevationAt;
    // La grille de sondage reste ancrée au monde quand le repère est recentré.
    this.originX=frame.origin.x*frame.scale;
    this.originZ=frame.origin.y*frame.scale;
    const groups=new Map(), axes=[];
    const coverage=[];
    const local=([lng,lat])=>frame.toLocal(lng,lat);
    source.forEachFeature('water',tiles,(geometry,properties,tileBounds)=>{
      if(waterSurfaceFor(properties)!=='water') return;
      const pieces=classPolygons(geometry).map(rings=>rings.map(r=>r.map(local)));
      for(const rings of pieces) {
        if(!rings[0]?.length) continue;
        const b=bounds(rings.flat());
        const id=properties.id == null ? JSON.stringify(rings) : `${properties.class}:${properties.id}`;
        let group=groups.get(id);
        if(!group) {
          group={kind:properties.class, pieces:[], axes:[], level:NaN};
          groups.set(id,group);
        }
        const banks=new Map();
        for(const ring of rings) for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
          const edge={a:ring[j],b:ring[i]};
          addToGrid(banks,edge,bounds([edge.a,edge.b]),benchM+BANK_BLEND);
        }
        const piece={rings,box:b,group,banks,bands:edgeBands(rings)};
        group.pieces.push(piece);
      }
      if(tileBounds) {
        const a=frame.toLocal(tileBounds.west,tileBounds.north), b=frame.toLocal(tileBounds.east,tileBounds.south);
        coverage.push(bounds([a,b]));
      }
    });
    source.forEachFeature('waterway',tiles,(geometry,properties)=>{
      const style=waterwayStyleFor(properties,waterways);
      if(!style) return;
      const lines=geometry.type==='LineString' ? [geometry.coordinates] : geometry.type==='MultiLineString' ? geometry.coordinates : [];
      for(const line of lines) {
        const points=line.map(local);
        for(let i=1;i<points.length;i++) {
          let a=points[i-1],b=points[i];
          if(a.x>b.x || (a.x===b.x && a.z>b.z)) [a,b]=[b,a];
          if(Math.hypot(a.x-b.x,a.z-b.z)<0.01) continue;
          axes.push({a,b,halfWidth:style.halfWidth,box:bounds([a,b])});
        }
      }
    });
    axes.sort((a,b)=>a.a.x-b.a.x || a.a.z-b.a.z || a.b.x-b.b.x || a.b.z-b.b.z || a.halfWidth-b.halfWidth);
    for (const axis of axes) {
      axis.parent=axis;
      addToGrid(this.axisGrid,axis,axis.box,256);
    }
    const root=axis=>{
      while(axis.parent!==axis) { axis.parent=axis.parent.parent;axis=axis.parent; }
      return axis;
    };
    for(const axis of axes) for(const p of [axis.a,axis.b]) {
      const neighbors=this.axisGrid.get(key(Math.floor(p.x/CELL),Math.floor(p.z/CELL))) || [];
      for(const other of neighbors) {
        if(other===axis || !nearBox(p.x,p.z,other.box,1)) continue;
        if(projection(p.x,p.z,other.a,other.b).distance<1) root(axis).parent=root(other);
      }
    }
    for(const axis of axes) {
      const r=root(axis);
      r.component ||= {profiles:new Map()};
      axis.component=r.component;
    }
    for(const group of groups.values()) {
      if(group.kind==='ocean') group.level=0;
      else if(group.kind==='river' || group.kind==='canal') {
        group.axes=axes.filter(axis=>group.pieces.some(p=>{
          for(const t of [0,0.5,1]) {
            const x=axis.a.x+(axis.b.x-axis.a.x)*t, z=axis.a.z+(axis.b.z-axis.a.z)*t;
            if(nearBox(x,z,p.box) && inside(x,z,p.bands)) return true;
          }
          return false;
        }));
      } else {
        const complete=!coverage.length || group.pieces.every(p=>p.rings.every(r=>r.every(v=>
          [[-1,0],[1,0],[0,-1],[0,1]].every(([dx,dz])=>coverage.some(b=>nearBox(v.x+dx,v.z+dz,b))))));
        if(complete) group.level=this.lakeLevel(group);
      }
      if(Number.isFinite(group.level) || group.axes.length) for(const piece of group.pieces)
        addToGrid(this.grid,{piece,group},piece.box,benchM+BANK_BLEND);
    }
    // Les traits prolongent les polygones là où le cours d'eau est trop étroit
    // pour être surfacique. Une nappe reste prioritaire sur ces traits.
    for(const axis of axes) addToGrid(this.grid,{axis},axis.box,axis.halfWidth+benchM+BANK_BLEND);
    this.count=groups.size+axes.length;
  }

  lakeLevel(group) {
    const values=[], seen=new Set();
    for(const p of group.pieces) {
      const b=p.box;
      for(let gz=Math.ceil((b.minZ+this.originZ)/16);gz*16-this.originZ<b.maxZ;gz++)
        for(let gx=Math.ceil((b.minX+this.originX)/16);gx*16-this.originX<b.maxX;gx++) {
          const k=key(gx,gz),x=gx*16-this.originX,z=gz*16-this.originZ;
          if(seen.has(k) || !inside(x,z,p.bands)) continue;
          seen.add(k);
          const h=this.elevationAt(x,z);
          if(!Number.isFinite(h)) return NaN;
          values.push(h);
        }
    }
    // Les petites mares peuvent tenir entre quatre sondes de la grille.
    if(!values.length) {
      let anchor=null;
      for(const p of group.pieces) for(const v of p.rings[0])
        if(!anchor || v.x<anchor.x || (v.x===anchor.x && v.z<anchor.z)) anchor=v;
      if(anchor) return this.elevationAt(anchor.x,anchor.z);
    }
    return quantile(values,0.25);
  }

  profileAt(x,z,component) {
    const profiles=component.profiles;
    const gx=(x+this.originX)/PROFILE_STEP, gz=(z+this.originZ)/PROFILE_STEP;
    const ix=Math.floor(gx), iz=Math.floor(gz), tx=gx-ix, tz=gz-iz;
    const sample=(i,j)=>{
      const k=key(i,j);
      if(profiles.has(k)) return profiles.get(k);
      const x=i*PROFILE_STEP-this.originX, z=j*PROFILE_STEP-this.originZ;
      const near=this.nearestAxis(x,z,component);
      if(!near) return NaN;
      const {a,b}=near.axis;
      const length=Math.hypot(b.x-a.x,b.z-a.z), dx=(b.x-a.x)/length, dz=(b.z-a.z)/length;
      const samples=[];
      // Le profil sonde le lit : une moyenne autour du lit lirait ses talus.
      for(let d=-256;d<=256;d+=32) {
        const hit=this.nearestAxis(near.x+dx*d,near.z+dz*d,component);
        if(!hit) return NaN;
        const elevation=this.elevationAt(hit.x,hit.z);
        if(!Number.isFinite(elevation)) return NaN;
        const t=(hit.x-near.x)*dx+(hit.z-near.z)*dz;
        samples.push({t,elevation});
      }
      const meanT=samples.reduce((sum,p)=>sum+p.t,0)/samples.length;
      const meanH=samples.reduce((sum,p)=>sum+p.elevation,0)/samples.length;
      let numerator=0,denominator=0;
      for(const p of samples) {
        numerator+=(p.t-meanT)*(p.elevation-meanH);
        denominator+=(p.t-meanT)**2;
      }
      const slope=denominator ? numerator/denominator : 0;
      const h=quantile(samples.map(p=>p.elevation-slope*p.t),0.25);
      profiles.set(k,h);
      return h;
    };
    const a=sample(ix,iz),b=sample(ix+1,iz),c=sample(ix,iz+1),d=sample(ix+1,iz+1);
    return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
  }

  nearestAxis(x,z,component) {
    const axes=this.axisGrid.get(key(Math.floor(x/CELL),Math.floor(z/CELL))) || [];
    let best=null;
    for(const axis of axes) {
      if(component && axis.component!==component) continue;
      const hit=projection(x,z,axis.a,axis.b);
      if(!best || hit.distance<best.distance-1e-7 || (Math.abs(hit.distance-best.distance)<1e-7 && (hit.x<best.x || (hit.x===best.x && hit.z<best.z)))) best={...hit,axis};
    }
    return best;
  }

  axisLevel(x,z,axes) {
    let index=this.axisCells.get(axes);
    if(!index) this.axisCells.set(axes,index=axisCells(axes));
    const {cells}=index;
    const cx=Math.floor(x/CELL), cz=Math.floor(z/CELL);
    const reach=Math.max(cx-index.minX,index.maxX-cx,cz-index.minZ,index.maxZ-cz);
    // Marge du point dans sa cellule : un axe absent des anneaux déjà lus est au moins à cette distance, plus un anneau.
    const margin=Math.min(x-cx*CELL,(cx+1)*CELL-x,z-cz*CELL,(cz+1)*CELL-z);
    let best=null;
    const visit=(ix,iz)=>{
      const list=cells.get(key(ix,iz));
      if(!list) return;
      for(const axis of list) {
        if(best && !nearBox(x,z,axis.box,best.distance+1e-7)) continue;
        const hit=projection(x,z,axis.a,axis.b);
        if(!best || hit.distance<best.distance-1e-7 || (Math.abs(hit.distance-best.distance)<1e-7 && (hit.x<best.x || (hit.x===best.x && hit.z<best.z)))) best={...hit,axis};
      }
    };
    for(let ring=0;ring<=reach;ring++) {
      if(best && best.distance+1e-7<margin+(ring-1)*CELL) break;
      if(ring===0) { visit(cx,cz); continue; }
      for(let i=-ring;i<=ring;i++) { visit(cx+i,cz-ring); visit(cx+i,cz+ring); }
      for(let j=1-ring;j<ring;j++) { visit(cx-ring,cz+j); visit(cx+ring,cz+j); }
    }
    return best ? this.profileAt(best.x,best.z,best.axis.component) : NaN;
  }

  sample(x,z,raw) {
    const cell=key(Math.floor(x/CELL),Math.floor(z/CELL));
    const entries=this.grid.get(cell);
    if(!entries) return {elevation:raw,mask:0};
    let height=Infinity,weight=0,insideWater=false,inWater=false;
    for(const {piece,group,axis} of entries) {
      let distance,level;
      if(piece) {
        if(!nearBox(x,z,piece.box,this.benchM+BANK_BLEND)) continue;
        if(inside(x,z,piece.bands)) distance=0;
        else {
          distance=Infinity;
          const banks=piece.banks.get(cell) || [];
          for(const edge of banks)
            distance=Math.min(distance,projection(x,z,edge.a,edge.b).distance);
        }
        if(distance>this.benchM+BANK_BLEND) continue;
        level=Number.isFinite(group.level) ? group.level : this.axisLevel(x,z,group.axes);
      } else {
        const hit=projection(x,z,axis.a,axis.b);
        distance=Math.max(0,hit.distance-axis.halfWidth);
        if(distance>this.benchM+BANK_BLEND) continue;
        level=this.profileAt(hit.x,hit.z,axis.component);
      }
      if(!Number.isFinite(level)) continue;
      inWater ||= distance===0;
      // Une cote de nappe l'emporte sur un axe voisin ou traversant un lac.
      if(piece && distance===0) {
        if(!insideWater) {height=Infinity;weight=0;insideWater=true;}
        height=Math.min(height,level);weight=1;
      } else if(!insideWater) {
        const w=1-smooth(clamp((distance-this.benchM)/BANK_BLEND));
        const h=raw+(level-raw)*w;
        if(w>0) {height=Math.min(height,h);weight=Math.max(weight,w);}
      }
    }
    return {elevation:weight ? height : raw,mask:weight,inWater};
  }

  elevationAtPoint(x,z,raw) { return this.sample(x,z,raw).elevation; }

  touches(minX,minZ,maxX,maxZ) {
    for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)
      for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)
        if(this.grid.has(key(x,z))) return true;
    return false;
  }
}
