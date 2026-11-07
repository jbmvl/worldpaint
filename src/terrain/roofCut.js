/*
 * roofCut — ramène au sol un bâtiment que le MNT a pris pour du relief.
 * Même un MNT de sol nu garde par endroits le toit d'un immeuble haut que le
 * relevé n'a pas su classer (+44 m sous une tour près de la gare de Nantes) ;
 * le bâti s'élève ensuite sur ce cône.
 *
 * La correction n'a lieu que sous une emprise `building` d'OSM : à la seule
 * lecture du MNT, une citadelle aux murs verticaux ressemble trop à une tour.
 * Le sol y est le plan ajusté sur un anneau de sondes autour de l'emprise ;
 * il remplace le relief lu quand le quart le plus haut de l'emprise dépasse ce
 * plan de plus de `ROOF_SPIKE_M`. On ne fait que baisser.
 *
 * Fonction pure de la position (emprise et MNT), comme les autres
 * déformations : deux tuiles voisines s'accordent sans se consulter.
 */

/** Hauteur au-dessus du sol alentour (quart le plus haut de l'emprise) à partir de laquelle le MNT porte un toit. */
export const ROOF_SPIKE_M = 6;
/** Emprise en deçà de laquelle on ne cherche pas : une maison ne laisse pas de cône. */
export const ROOF_MIN_AREA_M2 = 150;
/** Raccord, en mètres, entre le sol rendu sous l'emprise et le relief lu autour : un pixel du MNT. */
export const ROOF_BLEND_M = 4;
/** Distances des sondes de sol à l'emprise. */
const RING_M = [6, 12];

const CELL = 64;
const key = (x, z) => x * 67108864 + z;
const smooth = (t) => t * t * (3 - 2 * t);

function inside(ring, x, z) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) yes = !yes;
  }
  return yes;
}

function edgeDistance(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const ex = x - a.x - t * dx;
    const ez = z - a.z - t * dz;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

/** Plan des moindres carrés `h = a + b·x + c·z` sur des sondes `[x, z, h]`, centré sur (cx, cz). */
function fitPlane(samples, cx, cz) {
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (const [x0, z0, h] of samples) {
    const x = x0 - cx;
    const z = z0 - cz;
    n++; sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h;
  }
  if (n < 3) return null;
  // Normales centrées : la pente se lit sur les écarts à la moyenne.
  const mx = sx / n, mz = sz / n, mh = sh / n;
  const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz;
  const cxh = sxh / n - mx * mh, czh = szh / n - mz * mh;
  const det = cxx * czz - cxz * cxz;
  const b = Math.abs(det) > 1e-9 ? (cxh * czz - czh * cxz) / det : 0;
  const c = Math.abs(det) > 1e-9 ? (czh * cxx - cxh * cxz) / det : 0;
  return { cx, cz, a: mh - b * mx - c * mz, b, c };
}

const planeAt = (p, x, z) => p.a + p.b * (x - p.cx) + p.c * (z - p.cz);

function quantile(values, part) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * part)] : NaN;
}

/**
 * Le sol d'une emprise si le MNT y porte un toit, ou `null`. `ring` est le
 * contour extérieur en mètres locaux ; `elevationAt(x, z)` lit le MNT brut.
 */
export function roofGround(ring, elevationAt) {
  let area = 0;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
    minX = Math.min(minX, ring[i].x); maxX = Math.max(maxX, ring[i].x);
    minZ = Math.min(minZ, ring[i].z); maxZ = Math.max(maxZ, ring[i].z);
  }
  const signed = area / 2;
  if (Math.abs(signed) < ROOF_MIN_AREA_M2) return null;
  // Aire signée positive : l'extérieur est à droite du sens de parcours, normale (dz, -dx).
  const outward = signed > 0 ? 1 : -1;

  // Tri rapide avant l'anneau complet : presque aucune emprise ne porte de
  // toit dans le MNT, et l'anneau coûte une cinquantaine de lectures.
  const cx0 = (minX + maxX) / 2;
  const cz0 = (minZ + maxZ) / 2;
  let peak = -Infinity;
  for (const [fx, fz] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
    const x = cx0 + fx * (maxX - minX);
    const z = cz0 + fz * (maxZ - minZ);
    if (inside(ring, x, z)) peak = Math.max(peak, elevationAt(x, z));
  }
  const far = RING_M[RING_M.length - 1];
  const floor = Math.min(
    elevationAt(minX - far, cz0), elevationAt(maxX + far, cz0),
    elevationAt(cx0, minZ - far), elevationAt(cx0, maxZ + far),
  );
  if (!(peak - floor > ROOF_SPIKE_M)) return null;

  // Sondes de sol, tout autour, à distance fixe de chaque côté.
  let perimeter = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) perimeter += Math.hypot(ring[i].x - ring[j].x, ring[i].z - ring[j].z);
  const spacing = Math.max(6, perimeter / 24);
  const ground = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const nx = (outward * (b.z - a.z)) / length;
    const nz = (-outward * (b.x - a.x)) / length;
    for (let s = spacing / 2; s < length; s += spacing) {
      const px = a.x + ((b.x - a.x) * s) / length;
      const pz = a.z + ((b.z - a.z) * s) / length;
      for (const d of RING_M) {
        const x = px + nx * d;
        const z = pz + nz * d;
        const h = elevationAt(x, z);
        if (Number.isFinite(h)) ground.push([x, z, h]);
      }
    }
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let plane = fitPlane(ground, cx, cz);
  if (!plane) return null;
  // Les sondes tombées sur le toit d'un voisin sont écartées, puis le plan refait.
  const low = ground.filter(([x, z, h]) => h - planeAt(plane, x, z) < 2);
  plane = fitPlane(low.length >= 6 ? low : ground, cx, cz) ?? plane;

  // Le relief sous l'emprise, sur une grille d'au plus une trentaine de sondes.
  const step = Math.max(3, Math.sqrt(Math.abs(signed) / 30));
  const above = [];
  for (let z = minZ + step / 2; z < maxZ; z += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (!inside(ring, x, z)) continue;
      const h = elevationAt(x, z);
      if (Number.isFinite(h)) above.push(h - planeAt(plane, x, z));
    }
  }
  // Le quart le plus haut : un grand ensemble ne garde souvent le toit d'un relevé que sur une partie de son emprise.
  if (!above.length || quantile(above, 0.75) <= ROOF_SPIKE_M) return null;
  return { ring, plane, box: { minX, minZ, maxX, maxZ } };
}

/**
 * Anneaux extérieurs `building` d'une tuile décodée assez grands pour porter
 * un toit dans le MNT, en entiers de tuile : gardés tant que la tuile l'est.
 */
const ringsByTile = new WeakMap();

function buildingRings(entry) {
  let rings = ringsByTile.get(entry);
  if (rings) return rings;
  rings = [];
  const layer = entry.tile.layers?.building;
  // Côté de la tuile au sol, à sa latitude : l'emprise minimale en unités de tuile.
  const n = Math.PI * (1 - (2 * (entry.y + 0.5)) / Math.pow(2, entry.z));
  const side = (40075016.686 * Math.cos(Math.atan(Math.sinh(n)))) / Math.pow(2, entry.z);
  const minArea = (ROOF_MIN_AREA_M2 / (side * side)) * (layer?.extent ?? 1) ** 2;
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    let geometry;
    try {
      geometry = layer.feature(i).loadGeometry();
    } catch (e) {
      continue;
    }
    for (const ring of geometry) {
      if (ring.length < 4) continue;
      let area = 0;
      for (let k = 0; k < ring.length; k++) {
        const next = ring[(k + 1) % ring.length];
        area += ring[k].x * next.y - next.x * ring[k].y;
      }
      // Une cour (anneau intérieur) a une aire négative ; une maison est trop petite.
      if (area / 2 < minArea) continue;
      const points = new Int16Array(ring.length * 2);
      for (let k = 0; k < ring.length; k++) {
        points[k * 2] = ring[k].x;
        points[k * 2 + 1] = ring[k].y;
      }
      rings.push(points);
    }
  }
  ringsByTile.set(entry, rings);
  return rings;
}

export class RoofCut {
  /**
   * @param {Object} options
   * @param {Object} options.frame   Repère local.
   * @param {(x: number, z: number) => number} options.elevationAt MNT brut, en mètres locaux.
   */
  constructor({ frame, elevationAt }) {
    this.frame = frame;
    this.elevationAtRaw = elevationAt;
    this.cuts = [];
    this.grid = new Map();
  }

  rebuild(source, tiles) {
    for (const _ of this.rebuildSteps(source, tiles));
  }

  /**
   * Lit les emprises `building` des tuiles ; rend la main toutes les 32
   * emprises analysées. Les anneaux sont lus en coordonnées de tuile, sans
   * passer par GeoJSON, et gardés par tuile décodée : une relève ne refait que
   * la lecture du relief.
   */
  *rebuildSteps(source, tiles) {
    this.cuts = [];
    this.grid = new Map();
    const found = [];
    const analyse = (outer) => {
      const cut = roofGround(outer, this.elevationAtRaw);
      if (cut) found.push(cut);
    };
    if (source.entriesOf) {
      const { frame } = this;
      let n = 0;
      for (const entry of source.entriesOf(tiles)) {
        const k = Math.pow(2, frame.zoom - entry.z);
        const extent = entry.tile.layers.building?.extent ?? 4096;
        for (const points of buildingRings(entry)) {
          const outer = [];
          for (let i = 0; i < points.length; i += 2) {
            outer.push({
              x: ((entry.x + points[i] / extent) * k - frame.origin.x) * frame.scale,
              z: ((entry.y + points[i + 1] / extent) * k - frame.origin.y) * frame.scale,
            });
          }
          analyse(outer);
          if (++n % 32 === 0) yield;
        }
      }
    } else {
      source.forEachFeature('building', tiles, (geometry) => {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
        for (const rings of polygons) {
          const outer = rings[0]?.map(([lng, lat]) => this.frame.toLocal(lng, lat));
          if (outer && outer.length >= 3) analyse(outer);
        }
      });
    }
    for (const cut of found) {
      this.cuts.push(cut);
      const { minX, minZ, maxX, maxZ } = cut.box;
      for (let gz = Math.floor((minZ - ROOF_BLEND_M) / CELL); gz <= Math.floor((maxZ + ROOF_BLEND_M) / CELL); gz++) {
        for (let gx = Math.floor((minX - ROOF_BLEND_M) / CELL); gx <= Math.floor((maxX + ROOF_BLEND_M) / CELL); gx++) {
          const k = key(gx, gz);
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(cut);
        }
      }
    }
  }

  get count() {
    return this.cuts.length;
  }

  /** Altitude corrigée au point (x, z), `raw` étant celle du MNT. */
  elevationAt(x, z, raw) {
    const cuts = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cuts) return raw;
    let level = raw;
    for (const cut of cuts) {
      const { minX, minZ, maxX, maxZ } = cut.box;
      if (x < minX - ROOF_BLEND_M || x > maxX + ROOF_BLEND_M || z < minZ - ROOF_BLEND_M || z > maxZ + ROOF_BLEND_M) continue;
      const floor = planeAt(cut.plane, x, z);
      if (raw <= floor) continue;
      if (inside(cut.ring, x, z)) {
        level = Math.min(level, floor);
        continue;
      }
      const d = edgeDistance(cut.ring, x, z);
      if (d < ROOF_BLEND_M) level = Math.min(level, floor + (raw - floor) * smooth(d / ROOF_BLEND_M));
    }
    return level;
  }

  touches(minX, minZ, maxX, maxZ) {
    for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
      for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) if (this.grid.has(key(x, z))) return true;
    }
    return false;
  }
}
