/*
 * Les baies religieuses, les tours et le couronnement d’un château suivent
 * l’empreinte réelle. Le thème porte leurs proportions ; aucune grille de
 * fenêtres d’habitation ni volume de château indépendant ne recouvre le
 * bâtiment.
 */
import { pushLabelQuad, LABEL_PX_PER_M, labelFontPxForCellHeight } from '../materials/labelAtlas.js';
import { srgb } from '../core/color.js';
import { Kit } from './furnitureKit.js';
import { pointInRing } from './furniturePlacement.js';

export function appendChurchWindows(openings, walls, a, b, nx, nz, base, eaves, ground, look) {
  if (!look) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const count = length < look.widthM * 3 ? 0 : Math.max(1, Math.floor(length / look.spacingM));
  const half = look.widthM / 2;
  const glass = srgb(look.glass);
  for (let i = 0; i < count && openings.panes < openings.budget; i++) {
    const along = length * (i + 1) / (count + 1);
    const floor = Math.max(base, ...ground.y);
    const sill = floor + look.sillM;
    const head = Math.min(eaves - 0.4, sill + look.heightM);
    if (head - sill < half * 2) continue;
    const shoulder = head - half;
    const point = (u, y) => [a.x + (b.x - a.x) * u / length + nx * 0.075, y, a.y + (b.y - a.y) * u / length + nz * 0.075];
    const vertices = [point(along - half, sill), point(along + half, sill), point(along + half, shoulder), point(along, head), point(along - half, shoulder)];
    for (let j = 1; j < vertices.length - 1; j++) {
      for (const v of [vertices[0], vertices[j + 1], vertices[j]]) {
        walls.positions.push(...v);
        walls.normals.push(nx, 0, nz);
        walls.colors.push(...glass);
      }
    }
    openings.panes++;
  }
}

export function castleTowers(footprint, box, base, top, look) {
  const profile = look.towers;
  if (!profile) return [];
  const radius = Math.max(profile.minRadiusM, Math.min(profile.maxRadiusM, box.short * profile.radiusRatio));
  const towers = [];
  const ux = Math.cos(box.angle), uz = Math.sin(box.angle);
  for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const corner = { x: box.cx + u * box.long * ux - v * box.short * uz, z: box.cz + u * box.long * uz + v * box.short * ux };
    const vertex = footprint.reduce((best, p) => Math.hypot(p.x - corner.x, p.z - corner.z) < Math.hypot(best.x - corner.x, best.z - corner.z) ? p : best);
    const dx = box.cx - vertex.x, dz = box.cz - vertex.z;
    const distance = Math.hypot(dx, dz) || 1;
    const x = vertex.x + dx / distance * radius, z = vertex.z + dz / distance * radius;
    if (!pointInRing(footprint, x, z) || towers.some(t => Math.hypot(t.x - x, t.z - z) < radius * 2)) continue;
    const height = top - base + profile.riseM;
    const kit = new Kit();
    if (profile.form === 'square') {
      kit.box({ width: radius * 2, height, depth: radius * 2, yaw: -box.angle, color: look.wall });
      if (look.crown) {
        const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: (a * ux - b * uz) * radius, z: (a * uz + b * ux) * radius }));
        appendBattlements(kit, ring, height, look.crown, look.wall);
      }
    } else {
      kit.cylinder({ radiusBottom: radius, radiusTop: radius, height, radial: 10, color: look.wall });
      kit.cylinder({ radiusBottom: radius * 1.15, radiusTop: 0, height: radius * profile.roofRatio, radial: 10, y: height, color: look.roof });
    }
    towers.push({ x, z, kit });
  }
  return towers;
}

/**
 * Couronnement d’un mur au sommet `top` de l’anneau `ring` ({x, z}, dans
 * le repère de `kit`) : sur chaque pan, un parapet qui déborde du nu du mur
 * sur des consoles — le mâchicoulis —, puis des merlons. Les merlons partent
 * du milieu du pan : le motif ne dépend que de la géométrie, pas du sens de
 * parcours.
 */
export function appendBattlements(kit, ring, top, crown, wall) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a.x * b.z - b.x * a.z;
  }
  const side = area > 0 ? 1 : -1;
  const { thicknessM: thickness, overhangM: overhang, parapetM: parapet, merlonM: merlon, gapM: gap, merlonHeightM: merlonHeight } = crown;
  const offset = overhang - thickness / 2;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < merlon) continue;
    const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
    const nx = uz * side, nz = -ux * side;
    const at = (along, out) => ({ x: (a.x + b.x) / 2 + ux * along + nx * out, z: (a.z + b.z) / 2 + uz * along + nz * out });
    const frame = { ux, uz, nx, nz };
    // Prolongé du débord aux deux bouts : les parapets de deux pans se rejoignent à l’angle.
    const low = top - (overhang > 0 ? parapet * 0.45 : 0);
    block(kit, frame, at(0, offset), length + overhang * 2, thickness, low, top + (overhang > 0 ? parapet * 0.55 : parapet), wall, overhang > 0);
    const crest = top + (overhang > 0 ? parapet * 0.55 : parapet);
    const step = merlon + gap;
    const half = Math.floor((length / 2 - merlon / 2) / step);
    for (let k = -half; k <= half; k++) block(kit, frame, at(k * step, offset), merlon, thickness, crest, crest + merlonHeight, wall, false);
    if (overhang > 0 && crown.corbelM > 0) {
      const count = Math.floor(length / crown.corbelSpacingM / 2);
      for (let k = -count; k <= count; k++) {
        block(kit, frame, at(k * crown.corbelSpacingM, overhang / 2), 0.35, overhang, low - crown.corbelM, low, crown.shade, true, false);
      }
    }
  }
}

/**
 * Pavé le long d’un pan (`ux, uz` le long, `nx, nz` vers l’extérieur), sans
 * les faces qu’on ne voit jamais : le dessous quand il repose, le dessus et le
 * dos d’une console collée sous le parapet et contre le mur.
 */
function block(kit, { ux, uz, nx, nz }, c, width, depth, y0, y1, color, bottom, closed = true) {
  const p = (u, n, y) => [c.x + ux * u * width / 2 + nx * n * depth / 2, y, c.z + uz * u * width / 2 + nz * n * depth / 2];
  const face = (q, outward) => {
    const [a, b, d] = q;
    const cross = [
      (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]),
    ];
    if (cross[0] * outward[0] + cross[1] * outward[1] + cross[2] * outward[2] < 0) q.reverse();
    kit.quad(q[0], q[1], q[2], q[3], color);
  };
  face([p(-1, 1, y0), p(1, 1, y0), p(1, 1, y1), p(-1, 1, y1)], [nx, 0, nz]);
  if (closed) face([p(-1, -1, y0), p(1, -1, y0), p(1, -1, y1), p(-1, -1, y1)], [-nx, 0, -nz]);
  face([p(1, -1, y0), p(1, 1, y0), p(1, 1, y1), p(1, -1, y1)], [ux, 0, uz]);
  face([p(-1, -1, y0), p(-1, 1, y0), p(-1, 1, y1), p(-1, -1, y1)], [-ux, 0, -uz]);
  if (closed) face([p(-1, -1, y1), p(1, -1, y1), p(1, 1, y1), p(-1, 1, y1)], [0, 1, 0]);
  if (bottom) face([p(-1, -1, y0), p(1, -1, y0), p(1, 1, y0), p(-1, 1, y0)], [0, -1, 0]);
}

export function appendRetailSign(walls, labels, atlas, a, b, nx, nz, floor, name, look) {
  if (!name || !look.sign) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const width = Math.min(look.sign.widthM, length - 1);
  if (width <= 0) return;
  const height = look.sign.heightM;
  const ux = (b.x - a.x) / length, uz = (b.y - a.y) / length;
  const cx = (a.x + b.x) / 2 + nx * 0.12, cz = (a.y + b.y) / 2 + nz * 0.12;
  const bottom = floor + look.sign.bottomM;
  const left = { x:cx - ux * width/2, y:cz - uz * width/2 };
  const right = { x:cx + ux * width/2, y:cz + uz * width/2 };
  const vertices = [[left.x,bottom,left.y],[left.x,bottom+height,left.y],[right.x,bottom,right.y],[right.x,bottom+height,right.y]];
  for(const i of [0,1,2,2,1,3]) {
    walls.positions.push(...vertices[i]);walls.normals.push(nx,0,nz);walls.colors.push(...look.front);
  }
  const uv = atlas.place(name,{
    maxWidthPx:width * LABEL_PX_PER_M,
    maxFontPx:labelFontPxForCellHeight(height * 0.8 * LABEL_PX_PER_M),
    color:look.sign.ink,
  });
  if (!uv) return;
  const halfWidth = Math.min(width,uv.widthPx/LABEL_PX_PER_M)/2;
  const textHeight = Math.min(height,uv.heightPx/LABEL_PX_PER_M);
  pushLabelQuad(labels,
    {x:cx - ux*halfWidth + nx*0.02,y:cz - uz*halfWidth + nz*0.02},
    {x:cx + ux*halfWidth + nx*0.02,y:cz + uz*halfWidth + nz*0.02},
    bottom+(height-textHeight)/2,bottom+(height+textHeight)/2,uv);
}
