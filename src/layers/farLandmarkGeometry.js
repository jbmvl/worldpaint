/*
 * farLandmarkGeometry — la silhouette d'un repère bâti vu de loin.
 *
 * Au-delà de la portée du bâti, une église, un château, une mosquée ou une
 * ruine ne se lisent plus que par leur masse : nef et clocher, corps et tours
 * d'angle, coupole et minaret, pans de murs. Aucune baie, aucune enseigne,
 * aucun éclairage : quelques dizaines de triangles par repère, versés dans un
 * tampon à facettes fusionné (`createFacetBuffer`).
 *
 * Décisions à ne pas défaire :
 *
 * - **les proportions du clocher et du minaret sont celles du bâti proche**
 *   (`towerSide`, `towerRise`, `towerFoot`) : au relais entre les deux portées,
 *   la silhouette ne doit pas changer de taille ;
 * - **sans emprise connue, le gabarit vient du thème** (`personalities.<kind>.far`),
 *   jamais d'une cote en dur ici ;
 * - **aucun tirage** : la silhouette ne dépend que de la donnée, le déterminisme
 *   spatial n'a donc pas de graine à garder.
 */
import { Kit } from '../models/kit.js';
import { appendCampanileTop, personalityLookFor, towerFoot, towerRise, towerSide } from './buildingLayer.js';
import { pushValues } from './facetBuffers.js';
import { ruinFormByName } from './ruinGeometry.js';

/** Personnalités qui ont une silhouette lointaine. */
export const FAR_LANDMARK_KINDS = new Set(['church', 'castle', 'mosque', 'ruin']);

/**
 * Rectangle orienté (demi-côtés, comme `orientedBox`) et hauteur à l'égout d'un
 * repère : son emprise publiée s'il en a une, le gabarit du thème sinon.
 *
 * @param {{x:number, z:number, size?:number, short?:number, angle?:number, y?:number, top?:number}} landmark
 * @param {{lengthM:number, widthM:number, eavesM:number}} gabarit
 */
export function farLandmarkBox(landmark, gabarit) {
  const sized = landmark.size > 0 && landmark.short > 0;
  const long = sized ? landmark.size : gabarit.lengthM / 2;
  const short = sized ? Math.min(landmark.short, long) : gabarit.widthM / 2;
  const height = Number.isFinite(landmark.top) && Number.isFinite(landmark.y) && landmark.top > landmark.y
    ? landmark.top - landmark.y
    : gabarit.eavesM;
  return { box: { cx: 0, cz: 0, long, short, angle: landmark.angle || 0 }, height };
}

function appendChurch(kit, box, height, look, wall) {
  const yaw = -box.angle;
  kit.box({ width: box.long * 2, height, depth: box.short * 2, color: wall, yaw });
  kit.gableRoof({ width: box.long * 2, depth: box.short * 2, height: box.short * 0.9, overhang: 0, color: look.roof || wall, gableColor: wall, y: height, yaw });
  const spire = look.spire || { wall, roof: look.roof || wall };
  const rise = Math.max(6, height) + towerRise(box);
  const side = towerSide(box, rise);
  const foot = towerFoot(box, side);
  kit.box({ width: side, height: rise, depth: side, color: spire.wall, x: foot.x, z: foot.z, yaw });
  if (spire.form === 'campanile') {
    appendCampanileTop(kit, side, rise, yaw, spire, foot.x, foot.z);
    return;
  }
  const rim = Array.from({ length: 4 }, (_, i) => {
    const angle = i * Math.PI / 2;
    return Kit.transform([Math.cos(angle) * side * 0.78, rise, Math.sin(angle) * side * 0.78], { yaw: yaw + Math.PI / 4, x: foot.x, z: foot.z });
  });
  const tip = [foot.x, rise + side * 1.5, foot.z];
  for (let i = 0; i < rim.length; i++) kit.tri(rim[(i + 1) % rim.length], rim[i], tip, spire.roof);
}

function appendCastle(kit, box, height, look, wall) {
  const yaw = -box.angle;
  kit.box({ width: box.long * 2, height, depth: box.short * 2, color: wall, yaw });
  const towers = look.towers;
  if (!towers) return;
  const radius = Math.max(towers.minRadiusM, Math.min(towers.maxRadiusM, box.short * towers.radiusRatio));
  const rise = height + towers.riseM;
  for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const [x, , z] = Kit.transform([u * (box.long - radius), 0, v * (box.short - radius)], { yaw });
    kit.cylinder({ radiusBottom: radius, radiusTop: radius, height: rise, radial: 6, color: wall, x, z });
    kit.cylinder({ radiusBottom: radius * 1.15, radiusTop: 0, height: radius * towers.roofRatio, radial: 6, y: rise, color: look.roof || wall, x, z, cap: false });
  }
}

function appendMosque(kit, box, height, look, wall) {
  const yaw = -box.angle;
  kit.box({ width: box.long * 2, height, depth: box.short * 2, color: wall, yaw });
  if (look.dome) {
    const radius = Math.max(1.5, Math.min(box.short * 0.75, 8));
    kit.cylinder({ radiusBottom: radius, radiusTop: radius * 0.72, height: radius * 0.5, radial: 8, y: height, color: look.dome, cap: false });
    kit.cylinder({ radiusBottom: radius * 0.72, radiusTop: 0, height: radius * 0.75, radial: 8, y: height + radius * 0.5, color: look.dome, cap: false });
  }
  if (look.minaret) {
    const side = towerSide(box);
    const radius = Math.max(0.7, side * 0.3);
    const rise = Math.max(8, height) + towerRise(box) * 1.4;
    const { x, z } = towerFoot(box, side);
    kit.cylinder({ radiusBottom: radius, radiusTop: radius * 0.8, height: rise, radial: 6, x, z, color: look.minaret });
    kit.cylinder({ radiusBottom: radius * 0.8, radiusTop: 0, height: radius * 3, radial: 6, x, y: rise, z, color: look.dome || look.minaret, cap: false });
  }
}

/** Part de chaque côté que les pans de murs d'une ruine gardent debout, et leur hauteur relative. */
const REMAINS_PIECES = [[0, 0.35, 1], [0.5, 0.8, 0.6]];
/** Colonnes d'un temple lointain par grand côté. */
const TEMPLE_FAR_COLUMNS = 6;

function appendRuin(kit, box, height, look, wall, name) {
  const yaw = -box.angle;
  const stone = look.roof || wall;
  if (ruinFormByName(name) === 'temple') {
    const podium = Math.max(1, height * 0.2);
    kit.box({ width: box.long * 2, height: podium, depth: box.short * 2, color: stone, yaw });
    const column = Math.max(0.8, Math.min(2.2, box.short * 2 / 9));
    for (const v of [-1, 1]) {
      for (let i = 0; i < TEMPLE_FAR_COLUMNS; i++) {
        const u = -box.long + column + (2 * box.long - 2 * column) * i / (TEMPLE_FAR_COLUMNS - 1);
        const [x, , z] = Kit.transform([u, 0, v * (box.short - column)], { yaw });
        kit.box({ width: column, height: height * 1.2, depth: column, color: wall, x, y: podium, z, yaw });
      }
    }
    return;
  }
  const thickness = Math.max(0.7, box.short * 0.08);
  const sides = [
    { from: [-box.long, -box.short], to: [box.long, -box.short] },
    { from: [box.long, -box.short], to: [box.long, box.short] },
    { from: [box.long, box.short], to: [-box.long, box.short] },
    { from: [-box.long, box.short], to: [-box.long, -box.short] },
  ];
  for (const { from, to } of sides) {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    for (const [start, end, share] of REMAINS_PIECES) {
      const mid = (start + end) / 2;
      const [x, , z] = Kit.transform([from[0] + dx * mid, 0, from[1] + dz * mid], { yaw });
      const along = Math.atan2(dz, dx);
      kit.box({ width: length * (end - start), height: height * share, depth: thickness, color: wall, x, z, yaw: yaw - along });
    }
  }
}

const APPEND = { church: appendChurch, castle: appendCastle, mosque: appendMosque, ruin: appendRuin };

/**
 * Le `Kit` d'un repère, au pied de son centre (origine au sol), ou `null`.
 *
 * @param {Object} landmark Repère, au format de `buildingLandmark` ; seul `kind` est requis.
 * @param {Object} [options]
 * @param {Object} [options.personalities] Tranche `theme.personalities`.
 * @param {number[]} [options.wall] Teinte linéaire de repli pour un repère sans mur au thème (la mosquée).
 */
export function farLandmarkKit(landmark, { personalities, wall = [0.7, 0.67, 0.6] } = {}) {
  if (!FAR_LANDMARK_KINDS.has(landmark?.kind)) return null;
  const look = personalityLookFor(landmark.kind, personalities);
  if (!look?.far) return null;
  const { box, height } = farLandmarkBox(landmark, look.far);
  const kit = new Kit();
  APPEND[landmark.kind](kit, box, height, look, look.wall || wall, landmark.name || null);
  return kit;
}

// Tampon de décalage réutilisé : la position d'un kit est versée par lots, sans tableau intermédiaire.
const SHIFTED = new Float64Array(3 * 3 * 64);

/**
 * Verse les silhouettes des repères dans un tampon à facettes, chacune posée
 * au sol à son pied (`groundAt`). Un repère sans silhouette est ignoré.
 *
 * @param {{positions, normals, colors}} buffer Accumulateur de `createFacetBuffer`.
 * @param {Array<Object>} landmarks
 * @param {Object} options Ceux de `farLandmarkKit`, plus `groundAt(x, z)`.
 * @returns {number} Repères versés.
 */
export function appendFarLandmarks(buffer, landmarks, { groundAt, ...options }) {
  let count = 0;
  for (const landmark of landmarks) {
    const kit = farLandmarkKit(landmark, options);
    if (!kit) continue;
    const y = Number.isFinite(landmark.y) ? landmark.y : groundAt(landmark.x, landmark.z);
    const source = kit.positions;
    for (let start = 0; start < source.length; start += SHIFTED.length) {
      const length = Math.min(SHIFTED.length, source.length - start);
      for (let i = 0; i < length; i += 3) {
        SHIFTED[i] = source[start + i] + landmark.x;
        SHIFTED[i + 1] = source[start + i + 1] + y;
        SHIFTED[i + 2] = source[start + i + 2] + landmark.z;
      }
      pushValues(buffer.positions, SHIFTED, length);
    }
    pushValues(buffer.normals, kit.normals);
    pushValues(buffer.colors, kit.colors);
    count++;
  }
  return count;
}
