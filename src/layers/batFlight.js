/*
 * batFlight — les passages de chauves-souris, la nuit.
 * ----------------------------------------------------
 * Comme les oiseaux de `lifeLayer`, ils suivent l'observateur : personne ne
 * peut vérifier où chasse une pipistrelle. Ce qu'on cherche, c'est le vol
 * heurté qui traverse le champ **de temps en temps**, pas un essaim permanent :
 * le temps est découpé en fenêtres de `BAT_PERIOD_S`, et chacune porte ou non
 * un passage, tiré de son seul indice.
 *
 * Un passage est une petite troupe qui traverse le cercle de l'observateur en
 * ligne droite, à basse hauteur ; chaque bête y ajoute ses crochets propres,
 * des sommes de sinus rapides à phases tirées une fois pour toutes.
 */

import { hashUnit } from '../core/groundSeed.js';

export const BAT_COUNT = 6;
/** Une fenêtre de temps porte au plus un passage. */
export const BAT_PERIOD_S = 40;
/** Part des fenêtres qui en portent un. */
export const BAT_ODDS = 0.6;
export const BAT_PASS_S = 13;
export const BAT_SPEED_M_S = 7;
export const BAT_HEIGHT_MIN = 3;
export const BAT_HEIGHT_MAX = 9;
/** Écart latéral de la ligne de passage à l'observateur, en mètres. */
export const BAT_OFFSET_MAX_M = 10;
export const BAT_SPAN_M = 0.45;
export const BAT_FLAP_HZ = 9;
const SALT = 7121;

/**
 * Silhouette de chauve-souris : ailes membraneuses au bord de fuite festonné
 * entre les doigts. Même repère que `createBirdGeometry` : vole vers +Z, ailes
 * sur X, dièdre porté par Y.
 */
export function createBatGeometry(THREE) {
  const wing = (s) => [
    // Le bras et la membrane jusqu'au premier doigt, puis la main.
    0, 0, 0.08, s * 0.22, 0.06, 0.1, 0, 0, -0.1,
    s * 0.22, 0.06, 0.1, s * 0.2, 0.03, -0.12, 0, 0, -0.1,
    s * 0.22, 0.06, 0.1, s * 0.5, 0.02, 0.02, s * 0.36, 0.02, -0.08,
    s * 0.22, 0.06, 0.1, s * 0.36, 0.02, -0.08, s * 0.2, 0.03, -0.12,
  ];
  const positions = new Float32Array([...wing(-1), ...wing(1)]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.name = 'bat';
  return geometry;
}

/**
 * Le passage de la fenêtre qui contient `time`, ou `null`. Pur.
 * @returns {{start:number, heading:number, offset:number, height:number}|null}
 */
export function batPassAt(time) {
  const window = Math.floor(time / BAT_PERIOD_S);
  if (hashUnit(window, SALT) >= BAT_ODDS) return null;
  const start = window * BAT_PERIOD_S + hashUnit(window, SALT + 1) * (BAT_PERIOD_S - BAT_PASS_S);
  if (time < start || time >= start + BAT_PASS_S) return null;
  return {
    start,
    heading: hashUnit(window, SALT + 2) * Math.PI * 2,
    offset: (hashUnit(window, SALT + 3) * 2 - 1) * BAT_OFFSET_MAX_M,
    height: BAT_HEIGHT_MIN + hashUnit(window, SALT + 4) * (BAT_HEIGHT_MAX - BAT_HEIGHT_MIN),
  };
}

/** Position d'une chauve-souris d'un passage, sans cap. Pur. */
function batPoint(bat, pass, time, centre) {
  const dx = Math.sin(pass.heading);
  const dz = Math.cos(pass.heading);
  // Le milieu du passage tombe au droit de l'observateur.
  const along = (time - pass.start - BAT_PASS_S / 2) * BAT_SPEED_M_S - bat.lag;
  const p = bat.phases;
  const side = pass.offset + bat.side + 2.6 * Math.sin(time * 1.9 + p[0]) + 1.2 * Math.sin(time * 5.3 + p[1]);
  const lift = 1.6 * Math.sin(time * 2.4 + p[2]) + 0.6 * Math.sin(time * 6.1 + p[3]);
  return {
    x: centre.x + dx * along + dz * side,
    y: centre.y + pass.height + bat.height + lift,
    z: centre.z + dz * along - dx * side,
  };
}

/**
 * Position, cap et battement d'une chauve-souris. Pur.
 * @returns {{x:number,y:number,z:number,heading:number,flap:number}}
 */
export function batAt(bat, pass, time, centre) {
  const here = batPoint(bat, pass, time, centre);
  const next = batPoint(bat, pass, time + 0.05, centre);
  return {
    ...here,
    heading: Math.atan2(next.x - here.x, next.z - here.z),
    flap: 0.3 + 0.7 * Math.abs(Math.sin(time * Math.PI * BAT_FLAP_HZ * bat.beat + bat.phases[4])),
  };
}

/** La troupe : écarts et phases propres à chaque bête, tirés une fois pour toutes. */
export function buildBats() {
  const bats = [];
  for (let i = 0; i < BAT_COUNT; i++) {
    const r = (k) => hashUnit(i, SALT + 10 + k);
    bats.push({
      lag: r(0) * 14,
      side: (r(1) * 2 - 1) * 4,
      height: (r(2) * 2 - 1) * 2,
      beat: 0.85 + r(3) * 0.3,
      scale: BAT_SPAN_M * (0.85 + r(4) * 0.35),
      phases: [r(5), r(6), r(7), r(8), r(9)].map((v) => v * Math.PI * 2),
    });
  }
  return bats;
}
