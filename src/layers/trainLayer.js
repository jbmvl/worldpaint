/*
 * trainLayer — les trains qui roulent sur la voie ferrée.
 * -------------------------------------------------------------------------
 * Couche animée par image, comme `tractorLayer` : les voies publiées par
 * `railwayLayer` (qui seul a lu les tuiles) sont parcourues ici, sans rien
 * reconstruire.
 *
 * Un train naît quand une voie apparaît près de l'observateur
 * (`setTracks`, à chaque reconstruction de la voie ferrée), une fois sur
 * `1 / TRAIN_SPAWN_CHANCE`, un peu en amont du point le plus proche pour
 * qu'il passe devant. Il ne suit pas un horaire : il roule sur sa **route**,
 * une polyligne qu'il porte lui-même, jusqu'à ce qu'elle s'arrête ou qu'il
 * soit loin.
 *
 * La route ne dépend pas du découpage de la voie en tronçons publiés : à
 * chaque reconstruction, le train garde ce qu'il a derrière lui et reprend
 * devant lui la voie neuve qui passe sous sa tête ; au bout d'une voie, il
 * enchaîne sur celle qui y commence dans son prolongement (un aiguillage, un
 * tunnel, un bord de tuile recousu autrement).
 *
 * Phares et baies éclairées sont une géométrie à part, posée avec les mêmes
 * matrices que les caisses. Les phares restent allumés jour et nuit ; les
 * baies, sous un matériau additif, suivent la nuit comme les fenêtres du bâti.
 */

import { defaultTheme } from '../themes/default.js';
import { Kit, seededUnit } from '../models/kit.js';

/** Trains en circulation au plus. */
export const TRAIN_MAX = 2;
/** Part des apparitions de voie qui font naître un train (1 : à chaque fois). */
export const TRAIN_SPAWN_CHANCE = 0.25;
/** Une voie plus loin que ça de l'observateur ne fait pas naître de train, en mètres. */
export const TRAIN_SPAWN_SIGHT_M = 500;
/** Recul de la naissance en amont du point le plus proche de l'observateur, en mètres. */
export const TRAIN_SPAWN_LEAD_M = 350;
/** Au-delà de cette distance de l'observateur, un train est retiré, en mètres. */
export const TRAIN_DROP_M = 1400;
/** Voitures derrière la locomotive. */
export const TRAIN_COACHES = 3;
/** Vitesse de croisière, en m/s (~ 80 km/h). */
export const TRAIN_SPEED_MPS = 22;
/** Longueur hors tout d'une voiture ou de la locomotive, en mètres. */
export const TRAIN_CAR_LENGTH_M = 16;
/** Jeu entre deux voitures, en mètres. */
export const TRAIN_CAR_GAP_M = 0.8;
/** Hauteur du dessus du rail au-dessus de la cote publiée, en mètres (voir `railProfileFor`). */
export const TRAIN_RAIL_TOP_M = 0.22;
/** Écart toléré entre la route d'un train et une voie qui la prolonge, en mètres. */
export const TRAIN_JOIN_M = 3;

const CAR_PITCH_M = TRAIN_CAR_LENGTH_M + TRAIN_CAR_GAP_M;
/** Entraxe des bogies : c'est sur eux que la caisse prend son cap et sa pente. */
const BOGIE_HALF_M = TRAIN_CAR_LENGTH_M * 0.35;
/** Cosinus minimal entre deux voies qui se prolongent. */
const JOIN_COS = Math.cos((35 * Math.PI) / 180);
/** Pas de quantification de la graine d'apparition, en mètres. */
const SPAWN_CELL_M = 50;

/** Longueur d'une rame, locomotive comprise. */
export function trainLength() {
  return (TRAIN_COACHES + 1) * CAR_PITCH_M - TRAIN_CAR_GAP_M;
}

/** Distances cumulées d'une polyligne. */
function cumulate(points) {
  const d = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    d[i] = d[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return d;
}

/** Projection d'un point sur une polyligne : abscisse, écart, sommet de départ du segment. */
export function projectOnPath(points, distances, x, z) {
  let best = { s: 0, gap: Infinity, segment: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-12;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const gap = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (gap < best.gap) best = { s: distances[i] + (distances[i + 1] - distances[i]) * t, gap, segment: i };
  }
  return best;
}

/** Point d'une polyligne à une abscisse donnée, ou `null` hors de ses bornes. */
export function pointAlong(points, distances, s) {
  if (!(s >= 0 && s <= distances[distances.length - 1])) return null;
  let lo = 0;
  let hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - distances[lo]) / (distances[hi] - distances[lo] || 1e-6);
  const a = points[lo];
  const b = points[hi];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

/** Un train dont la route est `points`, tête à l'abscisse `head`. */
function trainOn(points, head) {
  const distances = cumulate(points);
  return { points, distances, head };
}

/**
 * Fait naître un train sur une voie proche de l'observateur, ou `null`.
 * Le sens et le tirage viennent du point de la voie le plus proche,
 * quantifié. Fonction pure.
 */
export function spawnTrain(track, here, chance = TRAIN_SPAWN_CHANCE) {
  if (!Array.isArray(track) || track.length < 2) return null;
  const distances = cumulate(track);
  const near = projectOnPath(track, distances, here.x, here.z);
  if (near.gap > TRAIN_SPAWN_SIGHT_M) return null;
  const p = pointAlong(track, distances, near.s);
  const random = seededUnit(
    ((Math.floor(p.x / SPAWN_CELL_M) * 73856093) ^ (Math.floor(p.z / SPAWN_CELL_M) * 19349663)) >>> 0
  );
  if (random() >= chance) return null;

  const forward = random() < 0.5;
  const points = forward ? track : track.slice().reverse();
  const length = distances[distances.length - 1];
  const s = forward ? near.s : length - near.s;
  const head = Math.min(length, Math.max(trainLength(), s - TRAIN_SPAWN_LEAD_M));
  if (length < trainLength()) return null;
  return trainOn(points, head);
}

/** Tangente unitaire d'une route à une abscisse. */
function tangentAt(points, distances, s) {
  const a = pointAlong(points, distances, Math.max(0, s - 3));
  const b = pointAlong(points, distances, Math.min(distances[distances.length - 1], s + 3));
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

/**
 * Remet la route d'un train sur les voies neuves : ce qu'il a derrière lui
 * est gardé, ce qu'il a devant est repris sur la voie qui passe sous sa tête,
 * dans son sens de marche. Rend le train inchangé si aucune voie ne passe
 * sous lui. Fonction pure.
 */
export function reattachTrain(train, tracks) {
  const at = pointAlong(train.points, train.distances, train.head);
  if (!at) return train;
  const heading = tangentAt(train.points, train.distances, train.head);
  let best = null;
  for (const track of tracks) {
    if (!Array.isArray(track) || track.length < 2) continue;
    const distances = cumulate(track);
    const hit = projectOnPath(track, distances, at.x, at.z);
    if (hit.gap > TRAIN_JOIN_M || (best && hit.gap >= best.hit.gap)) continue;
    best = { track, distances, hit };
  }
  if (!best) return train;

  const t = tangentAt(best.track, best.distances, best.hit.s);
  const forward = t.x * heading.x + t.z * heading.z >= 0;
  const ahead = forward
    ? best.track.slice(best.hit.segment + 1)
    : best.track.slice(0, best.hit.segment + 1).reverse();
  // Derrière la tête, de quoi porter la rame, plus un sommet pour que la queue ne tombe pas hors de la route.
  const keep = trainLength() + 20;
  let from = train.points.findIndex((_, i) => train.head - train.distances[i] <= keep);
  let to = train.points.findIndex((_, i) => train.distances[i] >= train.head);
  if (to < 0) to = train.points.length;
  from = Math.max(0, (from < 0 ? to : from) - 1);
  const behind = train.points.slice(from, to);
  const points = [...behind, at, ...ahead.filter((p) => Math.hypot(p.x - at.x, p.z - at.z) > 0.01)];
  if (points.length < 2) return train;
  const distances = cumulate(points);
  return { points, distances, head: distances[behind.length] };
}

/**
 * Prolonge la route d'un train par une voie qui commence ou finit à son bout,
 * dans son prolongement. Rend `null` s'il n'en trouve aucune. Fonction pure.
 */
export function extendTrain(train, tracks) {
  const n = train.points.length;
  const end = train.points[n - 1];
  const before = train.points[n - 2];
  const len = Math.hypot(end.x - before.x, end.z - before.z) || 1;
  const dir = { x: (end.x - before.x) / len, z: (end.z - before.z) / len };
  for (const track of tracks) {
    if (!Array.isArray(track) || track.length < 2) continue;
    for (const reversed of [false, true]) {
      const path = reversed ? track.slice().reverse() : track;
      const a = path[0];
      const b = path[1];
      if (Math.hypot(a.x - end.x, a.z - end.z) > TRAIN_JOIN_M) continue;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      if (((b.x - a.x) * dir.x + (b.z - a.z) * dir.z) / l < JOIN_COS) continue;
      const points = [...train.points, ...path.slice(1)];
      return { points, distances: cumulate(points), head: train.head };
    }
  }
  return null;
}

/**
 * Pose de chaque voiture : centre au rail, cap et pente tirés des deux
 * bogies. Une voiture dont un bogie sort de la route est omise. Fonction pure.
 *
 * @returns {Array<{car:number, x:number, y:number, z:number, heading:number, pitch:number}>}
 */
export function trainCars(train) {
  const cars = [];
  for (let car = 0; car <= TRAIN_COACHES; car++) {
    const centre = train.head - car * CAR_PITCH_M - TRAIN_CAR_LENGTH_M / 2;
    const front = pointAlong(train.points, train.distances, centre + BOGIE_HALF_M);
    const back = pointAlong(train.points, train.distances, centre - BOGIE_HALF_M);
    if (!front || !back) continue;
    const dx = front.x - back.x;
    const dy = front.y - back.y;
    const dz = front.z - back.z;
    cars.push({
      car,
      x: (front.x + back.x) / 2,
      y: (front.y + back.y) / 2,
      z: (front.z + back.z) / 2,
      heading: Math.atan2(dx, dz),
      pitch: -Math.atan2(dy, Math.hypot(dx, dz)),
    });
  }
  return cars;
}

/** Bogies et châssis communs à la locomotive et aux voitures. */
function underframe(k, colors) {
  const half = TRAIN_CAR_LENGTH_M / 2;
  for (const z of [-BOGIE_HALF_M, BOGIE_HALF_M]) {
    k.box({ width: 2.2, height: 0.75, depth: 2.6, z, color: colors.black });
  }
  k.box({ width: 2.7, height: 0.35, depth: TRAIN_CAR_LENGTH_M - 0.4, y: 0.75, z: 0, color: colors.steelDark });
  return half;
}

/** Locomotive : caisse pleine, cabine vitrée aux deux bouts. Origine au rail, +Z vers l'avant. */
function createLocomotiveKit(colors) {
  const k = new Kit(colors);
  const half = underframe(k, colors);
  k.box({ width: 2.9, height: 2.9, depth: TRAIN_CAR_LENGTH_M - 1.6, y: 1.1, color: colors.red });
  for (const side of [-1, 1]) {
    k.taper({
      width: 2.9,
      depth: 0.8,
      height: 2.9,
      depthTop: 0.4,
      shiftZ: -side * 0.2,
      y: 1.1,
      z: side * (half - 0.4),
      color: colors.red,
    });
    // Pare-brise : une bande sombre au haut du bout.
    k.box({ width: 2.3, height: 0.9, depth: 0.1, y: 2.9, z: side * (half - 0.35), color: colors.black });
  }
  k.box({ width: 2.4, height: 0.3, depth: TRAIN_CAR_LENGTH_M - 4, y: 4.0, color: colors.steelDark });
  return k;
}

/** Voiture voyageurs : caisse claire, bandeau de baies, toit arrondi. */
function createCoachKit(colors) {
  const k = new Kit(colors);
  underframe(k, colors);
  const depth = TRAIN_CAR_LENGTH_M - 0.4;
  k.box({ width: 2.9, height: 1.1, depth, y: 1.1, color: colors.white });
  k.box({ width: 2.92, height: 0.9, depth: depth - 1.2, y: 2.2, color: colors.black });
  k.box({ width: 2.9, height: 0.9, depth, y: 2.2, color: colors.white });
  k.box({ width: 2.9, height: 0.3, depth, y: 3.1, color: colors.blue });
  k.barrelRoof({ width: 2.9, depth, rise: 0.45, y: 3.4, color: colors.steel });
  return k;
}

/** Phares de la locomotive : deux bas, un haut, à l'avant (+Z) seulement. */
function createLocomotiveLightsKit(colors) {
  const k = new Kit(colors);
  const half = TRAIN_CAR_LENGTH_M / 2;
  for (const x of [-0.9, 0.9]) {
    k.box({ width: 0.4, height: 0.3, depth: 0.12, x, y: 1.45, z: half - 0.02, color: colors.lampLed });
  }
  k.box({ width: 0.4, height: 0.3, depth: 0.12, y: 3.5, z: half - 0.33, color: colors.lampLed });
  return k;
}

/** Baies de voiture : une boîte par baie, qui ne dépasse du bandeau sombre que sur les flancs. */
function createCoachLightsKit(colors) {
  const k = new Kit(colors);
  const span = TRAIN_CAR_LENGTH_M - 2.2;
  const bays = 8;
  const pitch = span / bays;
  for (let i = 0; i < bays; i++) {
    const z = -span / 2 + pitch * (i + 0.5);
    k.box({ width: 2.96, height: 0.7, depth: pitch * 0.72, y: 2.3, z, color: colors.lampWarm });
  }
  return k;
}

export class TrainLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} [options.theme]
   */
  constructor({ THREE, scene, theme = defaultTheme }) {
    this.THREE = THREE;
    this.scene = scene;
    this.disposed = false;

    this.group = new THREE.Group();
    this.group.name = 'trains';
    scene.add(this.group);

    const colors = theme.furniture.colors;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'train';
    this.locomotives = this._instanced(createLocomotiveKit(colors).toGeometry(THREE, 'train'), TRAIN_MAX);
    this.coaches = this._instanced(createCoachKit(colors).toGeometry(THREE, 'train'), TRAIN_MAX * TRAIN_COACHES);

    this.lightMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.lightMaterial.name = 'train-lights';
    // Les phares restent allumés de jour : un matériau plein, sans éclairage, que la nuit ne règle pas.
    this.headlightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.headlightMaterial.name = 'train-headlights';
    this.locomotiveLights = this._instanced(
      createLocomotiveLightsKit(colors).toGeometry(THREE, 'train-lights'), TRAIN_MAX, this.headlightMaterial);
    this.coachLights = this._instanced(
      createCoachLightsKit(colors).toGeometry(THREE, 'train-lights'), TRAIN_MAX * TRAIN_COACHES, this.lightMaterial);
    this.locomotiveLights.name = this.coachLights.name = 'train-lights';
    this.coachLights.visible = false;

    /** @type {Array<Array<{x,y,z}>>} voies publiées par `railwayLayer`. */
    this._tracks = [];
    /** @type {Array<Object>} trains en circulation. */
    this._trains = [];

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  _instanced(geometry, max, material = this.material) {
    const mesh = new this.THREE.InstancedMesh(geometry, material, max);
    mesh.name = 'trains';
    mesh.instanceMatrix.setUsage(this.THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Reçoit les voies reconstruites : remet chaque train sur sa voie, puis en
   * fait naître un sur chaque voie proche qui n'en porte pas.
   * @param {Array<Array<{x,y,z}>>} tracks Publiées par `railwayLayer.tracks`.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {number} [chance] Part des voies qui font naître un train.
   */
  setTracks(tracks, here, chance = TRAIN_SPAWN_CHANCE) {
    if (this.disposed) return;
    this._tracks = Array.isArray(tracks) ? tracks : [];
    this._trains = this._trains.map((train) => reattachTrain(train, this._tracks));
    for (const track of this._tracks) {
      if (this._trains.length >= TRAIN_MAX) break;
      if (this._trains.some((train) => this._runsOn(train, track))) continue;
      const train = spawnTrain(track, here, chance);
      if (train) this._trains.push(train);
    }
    this._writeFrame();
  }

  /** Vrai si la tête ou la queue du train est sur cette voie. */
  _runsOn(train, track) {
    const distances = cumulate(track);
    for (const s of [train.head, train.head - trainLength()]) {
      const p = pointAlong(train.points, train.distances, s);
      if (p && projectOnPath(track, distances, p.x, p.z).gap <= TRAIN_JOIN_M) return true;
    }
    return false;
  }

  /** Allume les baies des voitures. @param {number} mix Part de nuit, de 0 à 1. */
  setNight(mix) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));
    this.lightMaterial.opacity = value;
    this.coachLights.visible = value > 0.01;
  }

  /**
   * Avance les trains d'une image, les prolonge au bout de leur route et
   * retire ceux qui n'ont plus de voie ou sont trop loin.
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,z:number}} [at] Position de l'observateur.
   */
  advance(delta, at = null) {
    if (this.disposed || !Number.isFinite(delta)) return;
    const next = [];
    for (let train of this._trains) {
      train = { ...train, head: train.head + delta * TRAIN_SPEED_MPS };
      const end = train.distances[train.distances.length - 1];
      if (train.head + CAR_PITCH_M > end) train = extendTrain(train, this._tracks) ?? train;
      const tail = train.head - trainLength();
      if (tail > train.distances[train.distances.length - 1]) continue;
      const p = pointAlong(train.points, train.distances, Math.max(0, tail));
      if (at && p && Math.hypot(p.x - at.x, p.z - at.z) > TRAIN_DROP_M) continue;
      next.push(train);
    }
    this._trains = next;
    this._writeFrame();
  }

  _writeFrame() {
    let locomotives = 0;
    let coaches = 0;
    for (const train of this._trains) {
      for (const car of trainCars(train)) {
        this._position.set(car.x, car.y + TRAIN_RAIL_TOP_M, car.z);
        this._euler.set(car.pitch, car.heading, 0);
        this._quaternion.setFromEuler(this._euler);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        if (car.car === 0) {
          this.locomotives.setMatrixAt(locomotives, this._matrix);
          this.locomotiveLights.setMatrixAt(locomotives++, this._matrix);
        } else {
          this.coaches.setMatrixAt(coaches, this._matrix);
          this.coachLights.setMatrixAt(coaches++, this._matrix);
        }
      }
    }
    this.locomotives.count = this.locomotiveLights.count = locomotives;
    this.coaches.count = this.coachLights.count = coaches;
    for (const mesh of [this.locomotives, this.coaches, this.locomotiveLights, this.coachLights]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.locomotives, this.coaches, this.locomotiveLights, this.coachLights]) {
      this.group.remove(mesh);
      mesh.dispose?.();
      mesh.geometry.dispose();
    }
    this.material.dispose();
    this.lightMaterial.dispose();
    this.headlightMaterial.dispose();
    this._tracks = [];
    this._trains = [];
    this.scene.remove(this.group);
  }
}
