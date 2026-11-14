/* Prototypes d'arbres normalisés : la géométrie et l'atlas partagent les
 * mêmes volumes. Les lobes ont des sommets désalignés et une orientation
 * propre. Les fruits font partie de la même géométrie et de sa projection,
 * sans instance supplémentaire ; le peuplement choisit la variante et sa rotation spatiale.
 * Les niveaux lointains échantillonnent les mêmes lobes et gardent le repère
 * normalisé du volume complet ; aucun nouveau tirage ne déplace une houppe.
 */
import { Kit, seededUnit } from './kit.js';
import { defaultTheme } from '../themes/default.js';

export function treePrototype(variant, index = 0, look = defaultTheme.trees.volume, detail = 0) {
  const kit = new Kit();
  const reduced = detail > 0 ? new Kit() : null;
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
  // Sans fonds : l'un est au sol, l'autre dans la houppe.
  if (variant.trunk > 0) kit.cylinder({radiusBottom: variant.trunk * .45, radiusTop: variant.trunk * .24, height: profile.trunkHeight ?? .7, radial: 6, color: bark, cap: false});
  if (reduced && variant.trunk > 0) reduced.cylinder({radiusBottom: variant.trunk * .45, radiusTop: variant.trunk * .24, height: profile.trunkHeight ?? .7, radial: detail === 1 ? 4 : 3, color: bark, cap: false});
  if (variant.kind === 'palm') {
    palmCrown(kit, reduced, profile, leaf, random);
  } else if (fronds) {
    const base = .02;
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
      if (reduced) {
        reduced.tri([0, base, 0], left, right, leaf);
        reduced.tri(left, tip, right, leaf.map(v => v * 1.12));
      }
    }
  } else if (conifer) {
    // Des cônes pointus empilés, chacun deux fois plus haut que l'écart entre
    // deux étages : la moitié basse de chacun déborde de celui du dessus, et
    // c'est ce ressaut qui fait lire un sapin plutôt qu'un fuseau. Le dernier
    // dépasse seul, en pointe. `taper` : rayon du dernier rapporté au premier.
    const tiers = profile.tiers ?? 4;
    const taper = profile.taper ?? .3;
    const base = .12, step = .76 / tiers;
    for (let i=0; i<tiers; i++) {
      const y = base + i * step;
      const tier = {radiusBottom: .45 * (1 - (1 - taper) * i / (tiers - 1)), radiusTop: 0, height: i < tiers - 1 ? 2 * step : 1 - y, y, yaw: i * 2.1, color: leaf, colorTop: leaf.map(v=>v*1.15)};
      kit.cylinder({...tier, radial: 7});
      if (reduced) reduced.cylinder({...tier, radial: detail === 1 ? 5 : 3});
    }
  } else {
    const lobes = profile.lobes ?? (column ? 3 : 5);
    for (let j=0; j<lobes; j++) {
      const angle = j * 2.4;
      const radius = (column ? .1 : j ? .22 : .04) * (profile.spread ?? 1);
      const cx = Math.cos(angle)*radius;
      const cz = Math.sin(angle)*radius;
      const cy = column ? .43+j*.19 : (profile.crownY ?? (bush ? .3 : .62)) + (j ? random()*.1 : .1);
      // Des lobes petits devant leur écart laissent passer le jour (bouleau, olivier).
      const size = profile.lobeSize ?? 1;
      const rx = (column ? .25-j*.035 : j ? .25 : .32) * size;
      const ry = (column ? .25 : j ? .25 : .27) * (profile.rise ?? 1) * size;
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
      if (reduced) {
        const rows = detail === 1 ? [0, 1, 3, 4] : [0, 2, 4];
        const columns = detail === 1 ? [0, 1, 3, 4, 6] : [0, 2, 4, 6];
        for (let r = 0; r < rows.length - 1; r++) for (let a = 0; a < columns.length; a++) {
          const b = (a + 1) % columns.length;
          const color = (profile.tipColor && r === rows.length - 2 ? profile.tipColor : leaf).map(v => v * (1 + (rows[r] - 2) * (profile.colorVariation ?? .07)));
          if (r > 0) reduced.tri(points[rows[r]][columns[a]], points[rows[r + 1]][columns[a]], points[rows[r]][columns[b]], color);
          if (r < rows.length - 2) reduced.tri(points[rows[r]][columns[b]], points[rows[r + 1]][columns[a]], points[rows[r + 1]][columns[b]], color);
        }
      }
      if (variant.fruit) {
        const fruit = variant.fruit;
        for (let n = 0; n < fruit.perLobe; n++) {
          const point = points[2 + n % 2][(n * 2 + j) % segments];
          appendFruit(kit, point, fruit.radius, fruit.color);
        }
      }
      // Les charpentières ne se voient que de près : les niveaux lointains n'en ont pas.
      if(variant.trunk > 0 && !column && j>0) branch(kit, trunk, cy, cz, .025, bark);
    }
  }
  // Même boîte pour la projection et le volume, sans rognage de la houppe.
  let width=0, height=0, bottom=Infinity;
  for(let i=0;i<kit.positions.length;i+=3) {
    width=Math.max(width,Math.abs(kit.positions[i])*2,Math.abs(kit.positions[i+2])*2);
    height=Math.max(height,kit.positions[i+1]);
    bottom=Math.min(bottom,kit.positions[i+1]);
  }
  const result = reduced || kit;
  for(let i=0;i<result.positions.length;i+=3) {
    result.positions[i]/=width/.94; result.positions[i+1]=.005+(result.positions[i+1]-bottom)/(height-bottom)*.975; result.positions[i+2]/=width/.94;
  }
  return result;
}

/**
 * Couronne de palmier : des palmes qui montent puis retombent, les jeunes au
 * centre plus dressées, les vieilles dessous presque pendantes. C'est la
 * retombée qui fait lire un palmier ; dressées, elles font un plumeau.
 */
function palmCrown(kit, reduced, profile, leaf, random) {
  const base = profile.trunkHeight ?? .75;
  const count = profile.fronds ?? 14;
  const width = profile.bladeWidth ?? .06;
  for (let i = 0; i < count; i++) {
    const age = i / (count - 1);
    const angle = i * 2.4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const length = .36 + random() * .1 + age * .06;
    const rise = .16 - age * .1;
    const droop = .04 - age * .26 + random() * .05;
    const middle = [cos * length * .5, base + rise, sin * length * .5];
    const tip = [cos * length, base + droop, sin * length];
    const left = [middle[0] - sin * width, middle[1], middle[2] + cos * width];
    const right = [middle[0] + sin * width, middle[1], middle[2] - cos * width];
    const shade = leaf.map(v => v * (1.12 - age * .22));
    for (const target of reduced ? [kit, reduced] : [kit]) {
      target.tri([0, base, 0], left, right, shade);
      target.tri(left, tip, right, shade.map(v => v * 1.1));
    }
  }
}

/** Charpentière du tronc vers un lobe : un prisme triangulaire ouvert, ses bouts sont dans le tronc et dans la houppe. */
function branch(kit, fromY, toY, toZ, width, color) {
  const radius = width / Math.sqrt(3);
  kit.cylinder({radiusBottom: radius, radiusTop: radius, height: Math.hypot(toY - fromY, toZ), radial: 3, cap: false, y: fromY, tilt: Math.atan2(toZ, toY - fromY), color});
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
