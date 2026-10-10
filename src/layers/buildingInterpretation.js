/*
 * Les tuiles de bâti peuvent conserver l’emprise d’une muraille sans son tag.
 * On ne déduit un mur que d’une bande longue et étroite, droite ou sinueuse :
 * un bâtiment compact ou une simple maison mitoyenne reste du bâti ordinaire.
 * La largeur moyenne 2A/P reste lisible lorsque le contour tourne.
 */
import { ringArea, orientedBox } from './roofGeometry.js';
import { pointInRing } from './furniturePlacement.js';

/** Emprise au-dessous de laquelle un bâti voisin d'un arrêt est son abri, en mètres carrés. */
export const TRANSIT_SHELTER_MAX_AREA_M2 = 15;
/** Distance d'un arrêt en deçà de laquelle une petite emprise est son abri, en mètres. */
export const TRANSIT_SHELTER_REACH_M = 25;

/** Vrai pour un point `poi` qui est un arrêt de bus ou de tramway. */
export function isTransitStop(properties) {
  const { class: klass, subclass } = properties ?? {};
  return klass === 'bus' || subclass === 'bus_stop' || subclass === 'bus_station' || subclass === 'tram_stop';
}

/**
 * Vrai pour l'emprise d'un abri d'arrêt. Les tuiles de bâti ne portent pas le
 * type de la construction : un abri s'y reconnaît à sa taille et à l'arrêt
 * qu'il borde. Le mobilier pose le sien (`furniture/pointsOfInterest`) ;
 * extrudé, celui-ci deviendrait une maison de cinq mètres sur le trottoir.
 *
 * @param {{x:number, z:number, area:number}} candidate Centre et aire de l'emprise.
 * @param {Array<{x:number, z:number}>} stops Arrêts relevés.
 */
export function isTransitShelter(candidate, stops) {
  if (!(candidate.area > 0) || candidate.area > TRANSIT_SHELTER_MAX_AREA_M2) return false;
  return stops.some((stop) => Math.hypot(stop.x - candidate.x, stop.z - candidate.z) <= TRANSIT_SHELTER_REACH_M);
}

export function isWallFootprint(footprint, box = orientedBox(footprint)) {
  if (!box || !footprint?.length) return false;
  const perimeter = footprint.reduce((sum, p, i) => {
    const q = footprint[(i + 1) % footprint.length];
    return sum + Math.hypot(q.x - p.x, q.z - p.z);
  }, 0);
  if (perimeter <= 0) return false;
  const width = 2 * ringArea(footprint) / perimeter;
  if (width <= 0.1) return false;
  const straight = box.short * 2 <= 2.5 && box.long * 2 >= 25;
  const winding = width <= 2.5 && perimeter / 2 >= 40 && box.fill < 0.5
    || width <= 3.2 && perimeter / 2 >= 80 && box.fill < 0.3;
  return straight || winding;
}

/** Épaisseur intérieure d’un pan : le premier bord opposé, pas la boîte du château entier. */
export function facadeThickness(footprint, a, b, share = 0.5) {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 1e-6) return Infinity;
  const p = { x:a.x + (b.x-a.x)*share, z:a.z + (b.z-a.z)*share };
  let dx = -(b.z-a.z)/length, dz = (b.x-a.x)/length;
  if (!pointInRing(footprint,p.x+dx*0.05,p.z+dz*0.05)) { dx=-dx;dz=-dz; }
  let nearest = Infinity;
  for (let i=0;i<footprint.length;i++) {
    const q=footprint[i], r=footprint[(i+1)%footprint.length];
    const ex=r.x-q.x, ez=r.z-q.z;
    const cross=dx*ez-dz*ex;
    if(Math.abs(cross)<1e-9)continue;
    const ox=q.x-p.x, oz=q.z-p.z;
    const t=(ox*ez-oz*ex)/cross, u=(ox*dz-oz*dx)/cross;
    if(t>0.05&&u>=-1e-6&&u<=1+1e-6)nearest=Math.min(nearest,t);
  }
  return nearest;
}
