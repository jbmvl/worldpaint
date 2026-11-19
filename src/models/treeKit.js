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
  const fronds = ['fern', 'marram', 'tussock', 'palm'].includes(variant.kind);
  const trunk = bush ? .18 : conifer ? .23 : column ? .3 : .4;
  // Sans fonds : l'un est au sol, l'autre dans la houppe.
  if (variant.trunk > 0 && profile.fork) {
    // Fût court, puis charpentières penchées qui s'écartent vers la houppe :
    // c'est la fourche, et non un mât, qui fait lire l'olivier.
    const forkY = profile.trunkHeight ?? .2;
    const limb = Math.max(.1, (profile.crownY ?? .6) - forkY);
    const tilt = profile.forkTilt ?? .4;
    const turn = random() * Math.PI * 2;
    // Tirés une fois : le niveau lointain garde les mêmes charpentières.
    const tilts = Array.from({ length: profile.fork }, () => tilt * (.8 + random() * .4));
    for (const target of reduced ? [kit, reduced] : [kit]) {
      const radial = target === kit ? 6 : detail === 1 ? 4 : 3;
      target.cylinder({radiusBottom: variant.trunk * .5, radiusTop: variant.trunk * .38, height: forkY + .02, radial, color: bark, cap: false});
      for (let k = 0; k < profile.fork; k++) {
        target.cylinder({
          radiusBottom: variant.trunk * .3, radiusTop: variant.trunk * .16, height: limb / Math.cos(tilt), radial, cap: false,
          y: forkY, tilt: tilts[k], yaw: turn + k * Math.PI * 2 / profile.fork, color: bark,
        });
      }
    }
  } else {
    if (variant.trunk > 0) kit.cylinder({radiusBottom: variant.trunk * .45, radiusTop: variant.trunk * .24, height: profile.trunkHeight ?? .7, radial: 6, color: bark, cap: false});
    if (reduced && variant.trunk > 0) reduced.cylinder({radiusBottom: variant.trunk * .45, radiusTop: variant.trunk * .24, height: profile.trunkHeight ?? .7, radial: detail === 1 ? 4 : 3, color: bark, cap: false});
  }
  if (variant.kind === 'palm') {
    palmCrown(kit, reduced, profile, leaf, random, detail);
  } else if (fronds) {
    groundFronds(kit, reduced, variant.kind, profile, leaf, random, detail);
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
      if(variant.trunk > 0 && !column && !profile.fork && j>0) branch(kit, trunk, cy, cz, .025, bark);
    }
  }
  // Même boîte pour la projection et le volume, sans rognage de la houppe.
  // Les folioles d'un niveau lointain, plus larges, peuvent déborder du plein détail : la boîte les couvre tous deux.
  let width=0, height=0, bottom=Infinity;
  for (const {positions} of reduced ? [kit, reduced] : [kit]) for(let i=0;i<positions.length;i+=3) {
    width=Math.max(width,Math.abs(positions[i])*2,Math.abs(positions[i+2])*2);
    height=Math.max(height,positions[i+1]);
    bottom=Math.min(bottom,positions[i+1]);
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
 * `fan` : palmes en éventail au bout d'un pétiole (palmier nain).
 */
function palmCrown(kit, reduced, profile, leaf, random, detail) {
  const base = profile.trunkHeight ?? .75;
  const count = profile.fronds ?? 14;
  const width = profile.bladeWidth ?? .06;
  for (let i = 0; i < count; i++) {
    const age = i / (count - 1);
    const angle = i * 2.4;
    const length = .36 + random() * .1 + age * .06;
    const rise = .16 - age * .1;
    const droop = .04 - age * .26 + random() * .05;
    const roll = (random() - .5) * .6;
    const shade = leaf.map(v => v * (1.12 - age * .22));
    const frond = { origin: [0, base, 0], angle, length, rise, droop, width, roll, color: shade };
    for (const target of reduced ? [kit, reduced] : [kit]) {
      const level = target === kit ? 0 : detail;
      if (profile.fan) fanFrond(target, frond, level);
      else pinnateFrond(target, { ...frond, hang: .45, rounded: level < 2 }, FROND_SEGMENTS >> level);
    }
  }
}

/** Frondes qui partent du sol : fougère pennée, ou lames arquées d'une touffe. */
function groundFronds(kit, reduced, kind, profile, leaf, random, detail) {
  const fern = kind === 'fern';
  const width = profile.bladeWidth ?? .035;
  for (let i = 0; i < (profile.fronds ?? 9); i++) {
    const length = fern ? .38 + random() * .14 : .3 + random() * .2;
    const rise = fern ? .13 + random() * .12 : .2 + random() * .2;
    // Une fronde qui passerait sous l'attache soulèverait la touffe : la boîte se cale sur le point le plus bas.
    const droop = fern ? .01 + random() * .05 : rise * (.3 + random() * .8);
    const frond = { origin: [0, .02, 0], angle: i * 2.4, length, rise, droop, bend: fern ? .3 : .2, width, roll: (random() - .5) * .6, color: leaf };
    for (const target of reduced ? [kit, reduced] : [kit]) {
      const level = target === kit ? 0 : detail;
      if (fern) pinnateFrond(target, { ...frond, hang: .3 }, FROND_SEGMENTS >> level);
      else bladeFrond(target, frond, Math.max(1, BLADE_SEGMENTS >> level));
    }
  }
}

/** Segments de rachis au plein détail ; chaque niveau lointain en divise le nombre par deux. */
const FROND_SEGMENTS = 8;
const BLADE_SEGMENTS = 6;

/**
 * Point du rachis à `t` : une courbe de Bézier qui monte de `rise` à mi-longueur
 * et finit à `droop` au-dessus de l'attache ; les mêmes `t` d'un niveau à l'autre.
 * Un `bend` faible fait partir la fronde droite vers le haut avant de s'arquer.
 */
function frondPoint({ origin, angle, length, rise, droop, bend = .38 }, t) {
  const lift = 2 * rise - droop / 2;
  const r = 2 * t * (1 - t) * length * bend + t * t * length;
  const y = 2 * t * (1 - t) * lift + t * t * droop;
  return [origin[0] + Math.cos(angle) * r, origin[1] + y, origin[2] + Math.sin(angle) * r];
}

/**
 * Palme pennée : des folioles en dents de scie de part et d'autre du rachis,
 * chacune un triangle qui part d'un segment et pend vers l'avant. Les creux
 * entre deux pointes découpent la silhouette en plume. `rounded` : folioles
 * lancéolées en trois faces au lieu d'une, pour les palmes vues de près.
 */
function pinnateFrond(target, frond, segments = FROND_SEGMENTS) {
  const { angle, width, roll, hang, color, rounded } = frond;
  const side = [-Math.sin(angle), 0, Math.cos(angle)];
  const points = Array.from({ length: segments + 1 }, (_, k) => frondPoint(frond, k / segments));
  for (let k = 0; k < segments; k++) {
    const t = (k + .5) / segments;
    const tip = frondPoint(frond, Math.min(1, (k + 1.4) / segments));
    // Nulle au pétiole et à la pointe, sans jamais l'être tout à fait : pas de triangle plat.
    const w = width * Math.max(.12, Math.sin(Math.PI * Math.min(1, t * 1.08)) ** .6);
    const tone = 1.1 - t * .2;
    for (const s of [1, -1]) {
      const drop = hang + roll * s;
      const leaflet = [tip[0] + side[0] * w * s, tip[1] - w * drop, tip[2] + side[2] * w * s];
      const shade = color.map(v => v * tone * (s > 0 ? 1 : .9));
      const face = (a, b, c) => s > 0 ? target.tri(a, b, c, shade) : target.tri(a, c, b, shade);
      if (!rounded) { face(points[k], points[k + 1], leaflet); continue; }
      // Foliole lancéolée : ses deux bords se bombent à mi-longueur et elle s'arque moins que sa pointe.
      const along = (p, f, bulge) => [
        p[0] + (leaflet[0] - p[0]) * f + side[0] * w * bulge * s,
        p[1] + (leaflet[1] - p[1]) * f * .7,
        p[2] + (leaflet[2] - p[2]) * f + side[2] * w * bulge * s,
      ];
      const back = along(points[k], .5, .12), front = along(points[k + 1], .55, -.08);
      face(points[k], points[k + 1], front);
      face(points[k], front, back);
      face(back, front, leaflet);
    }
  }
}

/** Lame arquée d'une touffe : un ruban qui s'effile vers sa pointe. */
function bladeFrond(target, frond, segments = BLADE_SEGMENTS) {
  const { angle, width, roll, color } = frond;
  const side = [-Math.sin(angle), 0, Math.cos(angle)];
  const edge = (t, s) => {
    const p = frondPoint(frond, t);
    const w = width * Math.max(.1, Math.min(.35 + t * 3, (1 - t) * 1.25)) * s;
    return [p[0] + side[0] * w, p[1] + w * roll, p[2] + side[2] * w];
  };
  for (let k = 0; k < segments; k++) {
    const t0 = k / segments, t1 = (k + 1) / segments;
    const tone = color.map(v => v * (.92 + t1 * .2));
    target.quad(edge(t0, -1), edge(t0, 1), edge(t1, 1), edge(t1, -1), tone);
  }
}

/**
 * Palme en éventail : un pétiole, puis des lames qui rayonnent dans le plan
 * de la palme, chacune pliée en gouttière ; les lames du bord retombent.
 */
function fanFrond(target, frond, level) {
  const { angle, length, width, roll, color } = frond;
  const stem = { ...frond, length: length * .4, rise: .05 + frond.rise * .6, droop: .08 + frond.rise, bend: .25 };
  const heart = frondPoint(stem, 1);
  const side = [-Math.sin(angle), 0, Math.cos(angle)];
  const lean = .9 + frond.droop * 2.5;
  const forward = [Math.cos(angle) * Math.cos(lean), Math.sin(lean), Math.sin(angle) * Math.cos(lean)];
  const stemBase = frondPoint(stem, 0);
  target.tri(stemBase, [heart[0] + side[0] * .008, heart[1], heart[2] + side[2] * .008], [heart[0] - side[0] * .008, heart[1], heart[2] - side[2] * .008], color.map(v => v * .85));
  const blades = [9, 5, 4][level] ?? 4;
  const radius = length * .5;
  for (let b = 0; b < blades; b++) {
    const phi = (b / (blades - 1) - .5) * 2.4 + roll * .3;
    const d = forward.map((f, j) => f * Math.cos(phi) + side[j] * Math.sin(phi));
    const tip = [heart[0] + d[0] * radius, heart[1] + d[1] * radius - radius * .35 * Math.sin(phi) ** 2, heart[2] + d[2] * radius];
    const half = width * 1.4 / blades;
    const across = [-d[2], 0, d[0]];
    const mid = t => [heart[0] + (tip[0] - heart[0]) * t, heart[1] + (tip[1] - heart[1]) * t, heart[2] + (tip[2] - heart[2]) * t];
    const m = mid(.45);
    const tone = color.map(v => v * (1.05 - Math.abs(phi) * .08));
    const left = [m[0] - across[0] * half, m[1] - half * .5, m[2] - across[2] * half];
    const right = [m[0] + across[0] * half, m[1] - half * .5, m[2] + across[2] * half];
    target.tri(heart, left, tip, tone);
    if (level < 2) target.tri(heart, tip, right, tone.map(v => v * .9));
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
