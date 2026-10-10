/*
 * Les baies religieuses et les tours de château suivent l’empreinte réelle.
 * Le thème porte leurs proportions ; aucune grille de fenêtres d’habitation
 * ni volume de château indépendant ne recouvre le bâtiment.
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
    kit.cylinder({ radiusBottom: radius, radiusTop: radius, height, radial: 10, color: look.wall });
    kit.cylinder({ radiusBottom: radius * 1.15, radiusTop: 0, height: radius * profile.roofRatio, radial: 10, y: height, color: look.roof });
    towers.push({ x, z, kit });
  }
  return towers;
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
