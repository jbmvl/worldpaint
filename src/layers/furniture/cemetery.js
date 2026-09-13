/*
 * cemetery — l'habillage d'un site `landuse=cemetery` : le mur d'enceinte, le
 * portail qui le perce, le carré de tombes et le robinet d'entretien. La croix
 * centrale, elle, est posée par `parcels` comme repère du site.
 *
 * Tout est ancré au **centroïde du site**, jamais à l'ordre des sommets de
 * l'anneau ni à la position de l'observateur : la même parcelle rend le même
 * mur, le même portail au même endroit et le même carré de tombes.
 */

import { resamplePath } from '../ribbonGeometry.js';
import { CEMETERY_GATE_SPAN_M } from '../furnitureKit.js';
import { pointInRing, randomAt } from '../furniturePlacement.js';

/**
 * Pas de ré-échantillonnage du mur d'enceinte d'un cimetière, en mètres — plus
 * fin que `BOUNDARY_SAMPLE_M` : c'est sur ce pas que se règle la largeur de la
 * brèche laissée pour le portail (`CEMETERY_GATE_SPAN_M`), qui ne tolère pas
 * l'à-peu-près d'un échantillonnage à six mètres.
 */
export const CEMETERY_WALL_SAMPLE_M = 2;

/**
 * Habille un site de cimetière reconnu (`landuse=cemetery`, voir
 * `urbanLanduseKind`) : le mur d'enceinte, le portail qui le perce, les
 * tombes qu'il protège, et le robinet qu'on y trouve toujours pour
 * l'entretien.
 *
 * La croix centrale reste posée par l'appelant, comme avant cette
 * fonction : c'était le seul repère du site, il ne bouge pas. Ce qui suit
 * est ce qui manquait pour qu'on y entre — un cimetière qu'on ne peut ni
 * enjamber ni franchir ne se lit pas comme un lieu, seulement comme une
 * étiquette posée sur de l'herbe.
 *
 * Tout est ancré au **centroïde du site** (`centre`), jamais à l'ordre des
 * sommets de l'anneau ni à la position de l'observateur : la même parcelle
 * doit rendre le même mur, le même portail au même endroit et le même
 * carré de tombes, qu'on l'aborde par le nord ou par le sud, aujourd'hui ou
 * dans une heure.
 */
export function buildCemetery(layer, context, ring, centre) {
  const { buffers, placements, sampleElevation } = context;

  // L'anneau GeoJSON est déjà fermé (premier sommet répété en fin de
  // liste) ; on ne le referme qu'au cas où un appelant futur en fournirait
  // un qui ne le soit pas.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closedRing = first.x === last.x && first.z === last.z ? ring : [...ring, first];
  const wallPath = resamplePath(closedRing, CEMETERY_WALL_SAMPLE_M);
  // Un site trop petit ou dégénéré ne porte ni mur ni portail : la croix
  // déjà posée par l'appelant reste son seul repère.
  if (wallPath.length < 12) return;

  // Angle du portail dans la brèche : tiré une fois pour tout le site,
  // jamais recalculé au passage — c'est l'invariant qui garantit que deux
  // reconstructions percent le même mur au même endroit.
  const gateAngle = randomAt(centre.x, centre.z, 211) * Math.PI * 2;
  let gateIndex = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < wallPath.length; i++) {
    const p = wallPath[i];
    let diff = Math.abs(Math.atan2(p.z - centre.z, p.x - centre.x) - gateAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      gateIndex = i;
    }
  }
  const gatePoint = wallPath[gateIndex];

  // Rotation du contour sur ce point : la brèche s'ouvre alors aux deux
  // bouts du tableau plutôt qu'au milieu, et se découpe par simple recul
  // depuis chaque extrémité — pas de modulo à chaque pas.
  const rotated = wallPath.slice(gateIndex).concat(wallPath.slice(0, gateIndex));
  const halfGate = CEMETERY_GATE_SPAN_M / 2 + 0.6;
  let cut = 1;
  while (cut < rotated.length && Math.hypot(rotated[cut].x - gatePoint.x, rotated[cut].z - gatePoint.z) < halfGate) {
    cut++;
  }
  let cutEnd = rotated.length - 1;
  while (
    cutEnd > cut &&
    Math.hypot(rotated[cutEnd].x - gatePoint.x, rotated[cutEnd].z - gatePoint.z) < halfGate
  ) {
    cutEnd--;
  }
  const wallArc = rotated.slice(cut, cutEnd + 1);
  // La brèche mange tout le pourtour rééchantillonné : un site trop exigu
  // pour porter à la fois un mur et un portail n'en porte aucun des deux,
  // plutôt qu'un portail posé sans mur pour le percer.
  if (wallArc.length < 2) return;

  layer._appendDryStoneWall(buffers.dryStoneWall, wallArc, sampleElevation);

  // Portail : face tournée vers l'extérieur du site, donc vers qui arrive.
  const before = wallPath[(gateIndex - 1 + wallPath.length) % wallPath.length];
  const after = wallPath[(gateIndex + 1) % wallPath.length];
  let tx = after.x - before.x;
  let tz = after.z - before.z;
  const tlen = Math.hypot(tx, tz) || 1;
  tx /= tlen;
  tz /= tlen;
  let nx = tz;
  let nz = -tx;
  const outward = Math.hypot(gatePoint.x + nx - centre.x, gatePoint.z + nz - centre.z);
  const inward = Math.hypot(gatePoint.x - nx - centre.x, gatePoint.z - nz - centre.z);
  if (outward < inward) {
    nx = -nx;
    nz = -nz;
  }
  layer._place(placements, 'cemeteryGate', { x: gatePoint.x, z: gatePoint.z, yaw: Math.atan2(nx, nz) });

  // Tombes : une vraie grille, pas un semis — c'est l'alignement en carrés
  // qui fait lire un cimetière, et un vrai cimetière est plein, pas semé au
  // hasard sur son herbe. La grille suit un cap tiré une fois pour tout le
  // site (`heading`) ; ses deux axes sont calés sur les cotes de la tombe
  // elle-même (`cemeteryTomb`, 0,95 × 2,05 m), au pas près du plot voisin,
  // pas au petit bonheur d'un rejet aléatoire dans la boîte englobante.
  const heading = randomAt(centre.x, centre.z, 223) * Math.PI * 2;
  const alongX = Math.cos(heading);
  const alongZ = Math.sin(heading);
  // Perpendiculaire à `heading`, direct : c'est l'axe de profondeur de la
  // tombe (tête-pied), donc celui des rangs.
  const acrossX = -alongZ;
  const acrossZ = alongX;
  const tombYaw = Math.atan2(acrossX, acrossZ);
  const plotSpacing = 1.35; // largeur d'une tombe (0,95 m) + une allée étroite
  const rowSpacing = 2.4; // profondeur d'une tombe (2,05 m) + une allée étroite
  const wallMargin = 1.6; // dégagement au pied du mur, où rien ne tient
  // Case vide, comme `HEDGE_SHAPES.hedge.gapChance` : une grille pleine se
  // lit comme une grille, pas comme un cimetière — une concession vendue,
  // une tombe qu'on a fini de relever. Le même tirage réduit d'autant le
  // compte total, ce qui est aussi tout ce qu'on lui demande.
  const tombGapChance = 0.5;
  // Clairière au portail : sans elle, la grille recouvre l'entrée elle-même
  // et referme d'une tombe ce que le mur venait d'ouvrir. Le robinet s'y
  // pose aussi, juste à côté du passage plutôt que dessus.
  const gateClearance = 3.6;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of ring) {
    const u = (p.x - centre.x) * alongX + (p.z - centre.z) * alongZ;
    const v = (p.x - centre.x) * acrossX + (p.z - centre.z) * acrossZ;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  // Un site n'épuise pas à lui seul le budget partagé de l'espèce
  // (`FURNITURE_LIMITS.points`) : au-delà, un cimetière hors norme cesse
  // simplement de se remplir, il ne prive pas les autres sites du reste de
  // la bulle.
  const tombCap = 500;
  let tombs = 0;
  for (let v = minV + wallMargin; v <= maxV - wallMargin && tombs < tombCap; v += rowSpacing) {
    for (let u = minU + wallMargin; u <= maxU - wallMargin && tombs < tombCap; u += plotSpacing) {
      const x = centre.x + alongX * u + acrossX * v;
      const z = centre.z + alongZ * u + acrossZ * v;
      if (Math.hypot(x - gatePoint.x, z - gatePoint.z) < gateClearance) continue;
      if (!pointInRing(ring, x, z)) continue;
      if (layer._onRoad(x, z)) continue;
      if (randomAt(x, z, 239) < tombGapChance) continue;

      // Deux pierres plutôt qu'une répétée à l'identique — voir
      // `cemeteryTombFlat`. Le tirage est ancré à la position du plot, donc
      // stable d'une reconstruction à l'autre.
      const draw = randomAt(x, z, 227);
      layer._place(placements, draw < 0.65 ? 'cemeteryTomb' : 'cemeteryTombFlat', {
        x,
        z,
        yaw: tombYaw,
        scale: 0.94 + draw * 0.1,
      });
      tombs++;
    }
  }

  // Robinet : posé près du portail, à l'écart du passage — jamais loin de
  // l'entrée dans un vrai cimetière, et la clairière ci-dessus lui garantit
  // une place libre.
  const tapYaw = randomAt(centre.x, centre.z, 233) * Math.PI * 2;
  const tapX = gatePoint.x - nx * 2.4 + tx * 2.6;
  const tapZ = gatePoint.z - nz * 2.4 + tz * 2.6;
  if (pointInRing(ring, tapX, tapZ) && !layer._onRoad(tapX, tapZ)) {
    layer._place(placements, 'cemeteryTap', { x: tapX, z: tapZ, yaw: tapYaw });
  }
}
