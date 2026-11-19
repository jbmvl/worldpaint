/*
 * roadsideWild — les plantes naturalisées du pays (`naturalized` du dossier
 * de région) au bord des routes, en ville comme en campagne : c'est de la
 * route qu'on voit le figuier de Barbarie, l'agave, l'euphorbe.
 *
 * Le semis ne suit pas la chaîne : une maille mondiale (`WILD_CELL_M`) porte
 * un point, et ce point n'est candidat que s'il tombe dans la bande de
 * bas-côté d'une chaussée. Rien ne dépend donc du découpage du réseau ni de
 * l'observateur. Un côté déjà pris par une haie ou un muret n'en porte pas.
 *
 * Les candidats sont posés des plus proches aux plus lointains : le plafond
 * coupe au bord de la portée.
 */

import { eachWorldCell, hashUnit } from '../../core/groundSeed.js';
import { NATURALIZED_KINDS } from '../../core/regionInterpretation.js';
import { naturalizedScale } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M, NATURALIZED_SOWING } from './catalog.js';

/** Pas de la maille qui porte un point candidat, en mètres. */
const WILD_CELL_M = 10;
/** Bande de bas-côté, comptée depuis la rive de la chaussée, en mètres. */
const WILD_BAND_M = [1.2, 4.5];
/** En ville, le bas-côté sauvage est plus rare. */
const WILD_TOWN_SHARE = 0.5;
/** Écart aux façades, en mètres. */
const WILD_BUILDING_CLEARANCE_M = 1.5;

/** Points candidats par kilomètre de route, les deux côtés ensemble. */
const CANDIDATES_PER_KM = 2 * (1000 / WILD_CELL_M) * ((WILD_BAND_M[1] - WILD_BAND_M[0]) / WILD_CELL_M);

/**
 * Formes que le pays sème au bord des routes, avec la borne cumulée de leur
 * tirage par point candidat. `null` s'il n'en déclare pas.
 */
export function roadsideWildFor(region) {
  if (!region?.naturalized?.length) return null;
  const items = [];
  let upTo = 0;
  for (const word of region.naturalized) {
    for (const item of NATURALIZED_KINDS[word]?.items ?? []) {
      const sowing = NATURALIZED_SOWING[item];
      if (!sowing?.roadPerKm) continue;
      upTo += sowing.roadPerKm / CANDIDATES_PER_KM;
      items.push({ item, upTo, scale: sowing.scale });
    }
  }
  return items.length ? items : null;
}

/**
 * Rassemble les candidats d'une portion de route. `seen` : les mailles déjà
 * retenues par une autre portion, pour qu'un point ne soit posé qu'une fois.
 */
export function appendRoadsideWild(layer, candidates, seen, { path, halfWidth, profile, inTown, taken, segment }) {
  if (profile === 'express' || profile === 'cycleway') return;
  const items = roadsideWildFor(layer.region);
  if (!items) return;
  const { frame } = layer.bubble;
  const inner = halfWidth + WILD_BAND_M[0], outer = halfWidth + WILD_BAND_M[1];
  const share = inTown ? WILD_TOWN_SHARE : 1;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) continue;
    const tx = dx / length, tz = dz / length;
    eachWorldCell(frame,
      Math.min(a.x, b.x) - outer, Math.min(a.z, b.z) - outer,
      Math.max(a.x, b.x) + outer, Math.max(a.z, b.z) + outer,
      WILD_CELL_M, (id, row, cx, cz, size) => {
        const key = `${id},${row}`;
        if (seen.has(key)) return;
        const x = cx + hashUnit(id, row, 601) * size, z = cz + hashUnit(id, row, 603) * size;
        const along = (x - a.x) * tx + (z - a.z) * tz;
        if (along < 0 || along >= length) return;
        // Positif à gauche de la marche, comme les décalages de `_placeBeside`.
        const lateral = (x - a.x) * tz - (z - a.z) * tx;
        const away = Math.abs(lateral);
        if (away < inner || away > outer) return;
        seen.add(key);
        if (taken.includes(Math.sign(lateral))) return;
        const draw = hashUnit(id, row, 607) / share;
        const pick = items.find((w) => draw < w.upTo);
        if (!pick) return;
        candidates.push({
          item: pick.item, x, z,
          yaw: hashUnit(id, row, 609) * Math.PI * 2,
          scale: naturalizedScale(pick.scale, hashUnit(id, row, 611)),
          own: segment,
        });
      });
  }
}

/** Pose les candidats rassemblés, des plus proches aux plus lointains, jusqu'au plafond. */
export function placeRoadsideWild(layer, context) {
  const { here, placements, roadsideWild } = context;
  for (const c of roadsideWild) c.distance = Math.hypot(c.x - here.x, c.z - here.z);
  roadsideWild.sort((a, b) => a.distance - b.distance);
  let placed = 0;
  for (const c of roadsideWild) {
    if (placed >= FURNITURE_LIMITS.roadsideWild || c.distance > FURNITURE_RADIUS_M) break;
    if (layer._onRoad(c.x, c.z) || layer._onWater(c.x, c.z) || !layer._openGround(c.x, c.z)) continue;
    if (layer._fabric?.covers?.(c.x, c.z, WILD_BUILDING_CLEARANCE_M)) continue;
    if (layer._place(placements, c.item, { x: c.x, z: c.z, yaw: c.yaw, scale: c.scale })) placed++;
  }
  return placed;
}
