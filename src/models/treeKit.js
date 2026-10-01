/* Prototypes d'arbres normalisés : la géométrie et l'atlas partagent les
 * mêmes volumes. Les lobes ont des sommets désalignés et une orientation
 * propre. Les fruits font partie de la même géométrie et de sa projection,
 * sans instance supplémentaire ; le peuplement choisit la variante et sa rotation spatiale.
 */
import { Kit, seededUnit } from './kit.js';
import { defaultTheme } from '../themes/default.js';

export function treePrototype(variant, index = 0, look = defaultTheme.trees.volume) {
  const kit = new Kit();
  const random = seededUnit(7901 + index * 131);
  const hue = variant.hue;
  const bark = variant.bark || look.bark;
  const profile = variant.volume || {};
  const leaf = look.leaf.map((v,i) => v * [hue.r,hue.g,hue.b][i]);
  const column = variant.kind === 'column';
  const conifer = variant.kind === 'conifer';
  const bush = variant.kind === 'bushy' || variant.heightM;
  const fronds = ['fern', 'marram', 'palm'].includes(variant.kind);
  const trunk = bush ? .18 : conifer ? .23 : column ? .3 : .4;
  if (variant.trunk > 0) kit.cylinder({radiusBottom: variant.trunk * .45, radiusTop: variant.trunk * .24, height: profile.trunkHeight ?? .7, radial: 6, color: bark});
  if (fronds) {
    const base = variant.kind === 'palm' ? .7 : .02;
    for (let i = 0; i < (profile.fronds ?? 9); i++) {
      const angle = i * 2.4;
      const length = .3 + random() * .2;
      const tip = [Math.cos(angle) * length, base + .15 + random() * .25, Math.sin(angle) * length];
      const middle = [tip[0] * .5, tip[1] + .12, tip[2] * .5];
      const width = profile.bladeWidth ?? .035;
      const left = [middle[0] - Math.sin(angle) * width, middle[1], middle[2] + Math.cos(angle) * width];
      const right = [middle[0] + Math.sin(angle) * width, middle[1], middle[2] - Math.cos(angle) * width];
      kit.tri([0, base, 0], left, right, leaf);
      kit.tri(left, tip, right, leaf.map(v => v * 1.12));
    }
  } else if (conifer) {
    for (let i=0; i<4; i++) {
      kit.cylinder({radiusBottom: .43-i*.085, radiusTop: .025, height: .4-i*.035, radial: 7, y: .16+i*.15, color: leaf, colorTop: leaf.map(v=>v*1.15)});
    }
  } else {
    const lobes = profile.lobes ?? (column ? 3 : 5);
    for (let j=0; j<lobes; j++) {
      const angle = j * 2.4;
      const radius = (column ? .1 : j ? .22 : .04) * (profile.spread ?? 1);
      const cx = Math.cos(angle)*radius;
      const cz = Math.sin(angle)*radius;
      const cy = column ? .43+j*.19 : (profile.crownY ?? (bush ? .3 : .62)) + (j ? random()*.1 : .1);
      const rx = column ? .25-j*.035 : j ? .25 : .32;
      const ry = (column ? .25 : j ? .25 : .27) * (profile.rise ?? 1);
      const segments=7, rings=4;
      const points=[];
      const lacet = random() * Math.PI * 2;
      const roulis = random() * Math.PI * 2;
      const cosL = Math.cos(lacet), sinL = Math.sin(lacet);
      const cosR = Math.cos(roulis), sinR = Math.sin(roulis);
      for(let r=0;r<=rings;r++) {
        const pole = r === 0 || r === rings;
        const row=[];
        for(let a=0;a<segments;a++) {
          const latitude=-Math.PI/2+(r+(pole ? 0 : (random()-.5)*.7))*Math.PI/rings;
          const azimuth=(a+(pole ? 0 : (random()-.5)*.7))*Math.PI*2/segments;
          const jitter=.88+random()*.22;
          const x = pole ? 0 : Math.cos(azimuth)*Math.cos(latitude)*jitter;
          const y = Math.sin(latitude);
          const z = pole ? 0 : Math.sin(azimuth)*Math.cos(latitude)*jitter;
          const xr = x*cosR-y*sinR, yr = x*sinR+y*cosR;
          row.push([cx+(xr*cosL-z*sinL)*rx, cy+yr*ry, cz+(xr*sinL+z*cosL)*rx]);
        }
        points.push(row);
      }
      for(let r=0;r<rings;r++) for(let a=0;a<segments;a++) {
        const b=(a+1)%segments;
        const color=(profile.tipColor && r === rings - 1 ? profile.tipColor : leaf).map(v=>v*(1 + (r - 2) * (profile.colorVariation ?? .07)));
        if(r>0 && r<rings-1 && random()<.5) {
          kit.tri(points[r][a],points[r+1][a],points[r+1][b],color);
          kit.tri(points[r][a],points[r+1][b],points[r][b],color);
        } else {
          if(r>0) kit.tri(points[r][a],points[r+1][a],points[r][b],color);
          if(r<rings-1) kit.tri(points[r][b],points[r+1][a],points[r+1][b],color);
        }
      }
      if (variant.fruit) {
        const fruit = variant.fruit;
        for (let n = 0; n < fruit.perLobe; n++) {
          const point = points[2 + n % 2][(n * 2 + j) % segments];
          appendFruit(kit, point, fruit.radius, fruit.color);
        }
      }
      if(variant.trunk > 0 && !column && j>0) kit.strutYZ({from:{y:trunk,z:0},to:{y:cy,z:cz},width:.025,color:bark});
    }
  }
  // Même boîte pour la projection et le volume, sans rognage de la houppe.
  let width=0, height=0, bottom=Infinity;
  for(let i=0;i<kit.positions.length;i+=3) {
    width=Math.max(width,Math.abs(kit.positions[i])*2,Math.abs(kit.positions[i+2])*2);
    height=Math.max(height,kit.positions[i+1]);
    bottom=Math.min(bottom,kit.positions[i+1]);
  }
  for(let i=0;i<kit.positions.length;i+=3) {
    kit.positions[i]/=width/.94; kit.positions[i+1]=.005+(kit.positions[i+1]-bottom)/(height-bottom)*.975; kit.positions[i+2]/=width/.94;
  }
  return kit;
}

function appendFruit(kit, [x, y, z], radius, color) {
  const top = [x, y + radius, z], bottom = [x, y - radius, z];
  const ring = [[x + radius,y,z], [x,y,z + radius], [x - radius,y,z], [x,y,z - radius]];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    kit.tri(top, ring[next], ring[i], color);
    kit.tri(bottom, ring[i], ring[next], color.map(v => v * .75));
  }
}

/** Projection orthographique des mêmes faces, sans moteur WebGL ni asset. */
export function paintTreePrototype(ctx, size, prototype) {
  const {positions:p,colors:c}=prototype;
  const faces=[];
  for(let i=0;i<p.length;i+=9) faces.push(i);
  faces.sort((a,b)=>(p[a+2]+p[a+5]+p[a+8])-(p[b+2]+p[b+5]+p[b+8]));
  const srgb=v=>Math.round(255*(v<=.0031308 ? v*12.92 : 1.055*Math.pow(v,1/2.4)-.055));
  for(const i of faces) {
    ctx.fillStyle=`rgb(${srgb(c[i])},${srgb(c[i+1])},${srgb(c[i+2])})`;
    ctx.beginPath();
    ctx.moveTo((p[i]+.5)*size,(1-p[i+1])*size);
    ctx.lineTo((p[i+3]+.5)*size,(1-p[i+4])*size);
    ctx.lineTo((p[i+6]+.5)*size,(1-p[i+7])*size);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .65; ctx.stroke();
  }
}
