/*
 * steepGap — le versant que personne ne laboure.
 *
 * Là où la carte se tait et où la matrice déclare une matière de pente
 * (`gapSteepSurfaceForMatrix`), le trou change de matière au-delà d'une pente
 * (`theme.terrain.gapSteep.grade`, en pente relative, tangente). La décision
 * est prise **une fois**, par la carte du sol qui la peint : le shader, la
 * végétation et le mobilier relisent la matière peinte ; `steepGapAt` refait
 * le même calcul pour qui doit savoir d'où vient cette matière.
 *
 * La pente se lit sur le MNT pur, en différences centrées d'un pas de
 * lecture (`STEEP_GAP_STEP_M`) de part et d'autre : ni la maille de terrain
 * (son pas suit l'anneau, donc la caméra), ni le déblai (posé après la carte).
 * Un écart plus court relirait la marche bilinéaire de chaque pixel du MNT, et
 * la limite sortirait en damier. Écart et pas étant égaux, la peinture lit
 * une altitude par nœud et prend la pente chez ses voisins.
 *
 * Le fondu est un seuil qui varie entre les deux bornes selon un bruit de
 * valeur posé sur la grille mondiale (`STEEP_GAP_NOISE_PER_TILE`) : un versant
 * qui se redresse se pique de broussaille avant d'en être couvert. La limite
 * est l'isoligne du champ « pente − seuil », tracée par carrés de
 * `STEEP_GAP_STEP_M` : elle ne suit aucune grille. Le champ peint est gardé
 * (`SteepGapField`) : qui demande ensuite « ce point est-il sur le versant ? »
 * relit la même interpolation que le tracé.
 */

import { SEED_ZOOM, hashUnit } from '../core/groundSeed.js';

/** Pas de lecture du champ, et demi-écart des différences centrées, en mètres. */
export const STEEP_GAP_STEP_M = 16;
/** Mailles du bruit du seuil par tuile z15 (≈ 40 m à 37° de latitude). */
const STEEP_GAP_NOISE_PER_TILE = 24;
const STEEP_GAP_SALT = 0x5c4b;

/** Pente relative au point, d'après le MNT de part et d'autre. NaN hors MNT. */
export function gradeAt(elevationAt, x, z, span = STEEP_GAP_STEP_M) {
  const gx = (elevationAt(x + span, z) - elevationAt(x - span, z)) / (2 * span);
  const gz = (elevationAt(x, z + span) - elevationAt(x, z - span)) / (2 * span);
  return Math.hypot(gx, gz);
}

/** Bruit de valeur lissé dans [0, 1], ancré à la grille mondiale z15. Pur. */
export function worldValueNoise(frame, x, z, perTile, salt) {
  const toSeed = 2 ** (SEED_ZOOM - frame.zoom);
  const u = (frame.origin.x + x / frame.scale) * toSeed * perTile;
  const v = (frame.origin.y + z / frame.scale) * toSeed * perTile;
  const i = Math.floor(u), j = Math.floor(v);
  const fu = u - i, fv = v - j;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = hashUnit(i, j, salt), b = hashUnit(i + 1, j, salt);
  const c = hashUnit(i, j + 1, salt), d = hashUnit(i + 1, j + 1, salt);
  return a + (b - a) * su + (c - a + (a - b - c + d) * su) * sv;
}

/**
 * Marge du point sur le seuil : positive sur un versant cédé à la matière de
 * pente. Fonction pure du sol.
 *
 * @param {number[]} range `[début, fin]` du fondu, en pente relative.
 */
export function steepGapMargin(frame, elevationAt, range, x, z) {
  return marginOf(frame, range, gradeAt(elevationAt, x, z), x, z);
}

function marginOf(frame, range, grade, x, z) {
  if (!(grade >= 0)) return -1;
  const draw = worldValueNoise(frame, x, z, STEEP_GAP_NOISE_PER_TILE, STEEP_GAP_SALT);
  return grade - (range[0] + (range[1] - range[0]) * draw);
}

/** Vrai si le point est sur un versant cédé à la matière de pente. */
export function steepGapAt(frame, elevationAt, range, x, z) {
  return steepGapMargin(frame, elevationAt, range, x, z) > 0;
}

/*
 * Parts positives d'un carré (marching squares), coins dans l'ordre
 * nord-ouest, nord-est, sud-est, sud-ouest. Rend le polygone en fractions du
 * carré, ou null s'il est vide.
 */
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
function positivePart(m) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const a = m[k], b = m[(k + 1) % 4];
    const [ax, az] = CORNERS[k], [bx, bz] = CORNERS[(k + 1) % 4];
    if (a > 0) out.push(ax, az);
    if ((a > 0) !== (b > 0)) {
      const t = a / (a - b);
      out.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  return out.length >= 6 ? out : null;
}

/**
 * Le champ des marges peint sur une grille locale de `step` : les nœuds,
 * puis la marge en un point quelconque par interpolation bilinéaire — celle
 * que suit l'isoligne du tracé.
 */
export class SteepGapField {
  constructor(minX, minZ, cols, rows, step = STEEP_GAP_STEP_M) {
    Object.assign(this, { minX, minZ, cols, rows, step });
    this.margins = new Float32Array((cols + 1) * (rows + 1)).fill(-1);
  }

  marginAt(x, z) {
    const u = (x - this.minX) / this.step, v = (z - this.minZ) / this.step;
    if (!(u >= 0 && v >= 0 && u <= this.cols && v <= this.rows)) return -1;
    const i = Math.min(this.cols - 1, Math.floor(u)), j = Math.min(this.rows - 1, Math.floor(v));
    const fu = u - i, fv = v - j, w = this.cols + 1, m = this.margins;
    const top = m[j * w + i] * (1 - fu) + m[j * w + i + 1] * fu;
    const bottom = m[(j + 1) * w + i] * (1 - fu) + m[(j + 1) * w + i + 1] * fu;
    return top * (1 - fv) + bottom * fv;
  }
}

/** Lignes de nœuds lues entre deux étapes. */
const ROWS_PER_STEP = 16;

/**
 * Remplit `field` (marges aux nœuds, une altitude lue par nœud), puis visite
 * les morceaux cédés à la matière de pente : `fillRect(x, z, w, h)` pour un
 * carré plein, `fillPolygon(points)` (mètres locaux, x et z alternés) pour une
 * isoligne. Générateur : une étape toutes les `ROWS_PER_STEP` lignes.
 *
 * @param {SteepGapField} field
 */
export function* steepGapPieces(frame, elevationAt, range, field, { fillRect, fillPolygon }) {
  const { minX, minZ, cols, rows, step, margins } = field;
  const w = cols + 1;
  // Une bordure d'un nœud autour de la grille : les différences centrées du bord.
  const ew = cols + 3;
  const heights = new Float32Array(ew * (rows + 3));
  for (let j = 0; j < rows + 3; j++) {
    for (let i = 0; i < ew; i++) heights[j * ew + i] = elevationAt(minX + (i - 1) * step, minZ + (j - 1) * step);
    if (j % ROWS_PER_STEP === 0) yield;
  }
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const c = (j + 1) * ew + i + 1;
      const grade = Math.hypot(heights[c + 1] - heights[c - 1], heights[c + ew] - heights[c - ew]) / (2 * step);
      margins[j * w + i] = marginOf(frame, range, grade, minX + i * step, minZ + j * step);
    }
  }
  yield;
  const m = [0, 0, 0, 0];
  for (let j = 0; j < rows; j++) {
    const z = minZ + j * step;
    for (let i = 0; i < cols; i++) {
      m[0] = margins[j * w + i]; m[1] = margins[j * w + i + 1]; m[2] = margins[(j + 1) * w + i + 1]; m[3] = margins[(j + 1) * w + i];
      const x = minX + i * step;
      if (m[0] > 0 && m[1] > 0 && m[2] > 0 && m[3] > 0) { fillRect(x, z, step, step); continue; }
      if (m[0] <= 0 && m[1] <= 0 && m[2] <= 0 && m[3] <= 0) continue;
      const part = positivePart(m);
      if (!part) continue;
      for (let k = 0; k < part.length; k += 2) {
        part[k] = x + part[k] * step;
        part[k + 1] = z + part[k + 1] * step;
      }
      fillPolygon(part);
    }
    if (j % ROWS_PER_STEP === 0) yield;
  }
}
