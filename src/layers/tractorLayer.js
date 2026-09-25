/*
 * tractorLayer — les tracteurs qui travaillent un champ cultivé.
 * -------------------------------------------------------------------------
 * Troisième couche animée par image, sœur de `lifeLayer` et `faunaLayer`,
 * mais ni l'une ni l'autre : un tracteur n'est pas du ciel — il est ancré au
 * sol, dans **ce** champ, vérifiable comme une bête (voir l'en-tête de
 * `faunaLayer` sur cette distinction) — et il n'est pas une bête : rien en
 * lui n'est articulé, une seule matrice par image suffit, là où une bête en
 * coûte quatre flottants de plus pour la foulée. Le loger dans l'une des deux
 * couches existantes aurait été trahir ce que chacune de leurs noms promet.
 *
 * Le tracé (deux points, avec leur altitude) est composé une fois par
 * `furniture/parcels.js`, qui seul a lu les tuiles et sait où est un vrai
 * champ en labour ; cette couche ne fait que le rejouer, en aller-retour,
 * comme un passage de labour plutôt qu'un circuit fermé.
 *
 * La poussière qu'il soulève se déduit du même tracé : une bouffée d'âge `a`
 * est partie de l'arrière du tracteur là où il était il y a `a` secondes, et
 * dérive depuis au vent. Aucun état à tenir, et un demi-tour laisse le nuage
 * là où il a été levé.
 */

import { defaultTheme } from '../themes/default.js';
import { Kit } from '../models/kit.js';

/** Tracteurs animés au plus — les plus proches d'abord. */
export const TRACTOR_ANIMATED_MAX = 12;
/** Enfoncement dans le sol, en mètres — même raison que pour la faune. */
export const TRACTOR_SINK_M = 0.03;
/** Bouffées de poussière entretenues par tracteur. */
export const DUST_PUFFS = 16;
/** Durée de vie d'une bouffée, en secondes. */
export const DUST_LIFE_S = 9;
/** Taille d'une bouffée à sa naissance et en fin de vie, en mètres. */
export const DUST_SIZE_M = [1.6, 11];
/** Ascension et dérive au vent, en mètres par seconde. */
export const DUST_RISE_MS = 0.3;
export const DUST_DRIFT_MS = 0.9;
/** Recul du point d'émission derrière le centre du tracteur, en mètres. */
const DUST_BEHIND_M = 1.8;

/**
 * Une bouffée de poussière à un instant donné. Fonction pure.
 *
 * @param {Object} tractor Voir `fieldVehicleAt`.
 * @param {number} time Secondes écoulées.
 * @param {number} p Rang de la bouffée, de 0 à `DUST_PUFFS - 1`.
 * @param {number} [windDirection] Direction du vent, en radians — même
 *        convention que les oiseaux (`lifeLayer.birdAt`).
 * @returns {{x:number,y:number,z:number,size:number,age:number}}
 */
export function dustPuffAt(tractor, time, p, windDirection = 0) {
  // Les bouffées se partagent la durée de vie : le nuage est continu.
  const shifted = time + (p / DUST_PUFFS) * DUST_LIFE_S;
  const age = ((shifted % DUST_LIFE_S) + DUST_LIFE_S) % DUST_LIFE_S;
  const born = fieldVehicleAt(tractor, time - age);
  const t = age / DUST_LIFE_S;
  // Écart latéral propre à la bouffée, stable d'une vie à l'autre : sans lui,
  // le nuage s'aligne en chapelet sur le passage.
  const spread = Math.sin(p * 12.9898 + 78.233) * 0.5;
  const drift = DUST_DRIFT_MS * age;
  return {
    x: born.x - Math.sin(born.heading) * DUST_BEHIND_M + Math.cos(windDirection) * drift + Math.cos(born.heading) * spread * age * 0.6,
    y: born.y + 0.5 + DUST_RISE_MS * age,
    z: born.z - Math.cos(born.heading) * DUST_BEHIND_M + Math.sin(windDirection) * drift - Math.sin(born.heading) * spread * age * 0.6,
    size: DUST_SIZE_M[0] + (DUST_SIZE_M[1] - DUST_SIZE_M[0]) * Math.sqrt(t),
    age,
  };
}

/**
 * Position et cap d'un tracteur à un instant donné, sur un aller-retour entre
 * deux points — un passage de labour, pas un circuit fermé. Fonction pure.
 *
 * La distance parcourue suit une onde triangulaire : la vitesse reste
 * constante sur tout le trajet et le cap bascule net à chaque bout, comme un
 * tracteur qui fait demi-tour en bout de champ plutôt que de ralentir en
 * douceur.
 *
 * @param {Object} tractor `{a, b, headingForward, speed, phase}` — voir
 *        `furniture/parcels.placeTractor`.
 * @param {number} time Secondes écoulées.
 * @returns {{x:number,y:number,z:number,heading:number}}
 */
export function fieldVehicleAt(tractor, time) {
  const { a, b, headingForward, speed, phase } = tractor;
  const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1e-6;
  const cycle = span * 2;
  const travelled = (((time + phase) * speed) % cycle + cycle) % cycle;
  const forward = travelled <= span;
  const t = forward ? travelled / span : (cycle - travelled) / span;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: forward ? headingForward : headingForward + Math.PI,
  };
}

/**
 * Gabarit bas de gamme : châssis, capot effilé, cabine, deux grandes roues
 * arrière, deux petites à l'avant, un échappement. Le repère est celui de
 * tout le catalogue : origine au sol, +Y vers le haut, +Z vers l'avant.
 */
function createTractorKit(colors) {
  const k = new Kit(colors);
  const rearRadius = 0.78;
  const rearWidth = 0.36;
  const frontRadius = 0.46;
  const frontWidth = 0.28;

  // Roues : un cylindre couché sur le flanc (`roll`), recentré sur son axe —
  // voir la note de `Kit.cylinder` : après un quart de tour la piste va de
  // `x = 0` à `x = -largeur`, d'où le décalage d'un demi-largeur.
  for (const side of [-1, 1]) {
    k.cylinder({
      radiusBottom: rearRadius,
      radiusTop: rearRadius,
      height: rearWidth,
      radial: 10,
      x: side * 0.95 + rearWidth / 2,
      y: rearRadius,
      z: -0.85,
      roll: Math.PI / 2,
      color: colors.black,
    });
    k.cylinder({
      radiusBottom: frontRadius,
      radiusTop: frontRadius,
      height: frontWidth,
      radial: 8,
      x: side * 0.8 + frontWidth / 2,
      y: frontRadius,
      z: 1.55,
      roll: Math.PI / 2,
      color: colors.black,
    });
  }

  const deckY = rearRadius * 0.55;
  k.box({ width: 1.15, height: 0.5, depth: 2.5, y: deckY, z: 0.15, color: colors.red });
  // Capot moteur, effilé vers l'avant.
  k.taper({
    width: 0.95,
    depth: 0.85,
    height: 0.55,
    widthTop: 0.7,
    depthTop: 0.6,
    y: deckY,
    z: 1.5,
    color: colors.red,
  });
  // Cabine : montants sombres, vitrage teinté — le seul endroit du tracteur qui ne soit pas carrosserie.
  k.box({ width: 1.05, height: 0.95, depth: 1.0, y: deckY + 0.5, z: -0.35, color: colors.steelDark, colorTop: colors.blue });
  // Échappement, sur le flanc du capot.
  k.cylinder({ radiusBottom: 0.06, radiusTop: 0.06, height: 0.85, radial: 6, x: 0.4, y: deckY + 0.5, z: 0.85, color: colors.steelDark });

  return k;
}

export class TractorLayer {
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
    this.time = 0;

    this.group = new THREE.Group();
    this.group.name = 'tractors';
    scene.add(this.group);

    this.geometry = createTractorKit(theme.furniture.colors).toGeometry(THREE, 'tractor');
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'tractor';
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, TRACTOR_ANIMATED_MAX);
    this.mesh.name = 'tractors';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // Aucun tracteur tant que la première image n'a pas placé les matrices.
    this.mesh.count = 0;
    this.group.add(this.mesh);

    this.dustGeometry = new THREE.PlaneGeometry(1, 1);
    this.dustMaterial = createDustMaterial(THREE, theme.life.dust);
    this.dust = new THREE.InstancedMesh(this.dustGeometry, this.dustMaterial, TRACTOR_ANIMATED_MAX * DUST_PUFFS);
    this.dust.name = 'tractor-dust';
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dust.frustumCulled = false;
    this.dust.count = 0;
    this.group.add(this.dust);
    this._windDirection = 0;

    /** @type {Array<Object>} tracteurs publiés par `furnitureLayer`. */
    this._tractors = [];

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  /**
   * Retient les tracteurs à animer : les plus proches de l'observateur.
   * @param {Array<Object>} list Publiés par `furnitureLayer.tractors`.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   */
  setTractors(list, here) {
    if (this.disposed) return;
    const all = Array.isArray(list) ? list.slice() : [];
    all.sort(
      (a, b) =>
        Math.hypot(a.a.x - here.x, a.a.z - here.z) - Math.hypot(b.a.x - here.x, b.a.z - here.z)
    );
    this._tractors = all.slice(0, TRACTOR_ANIMATED_MAX);
    // Première pose immédiate, comme les bêtes : sans elle, les tracteurs
    // restent une image empilés à l'origine de la scène.
    this._writeFrame();
  }

  /** Avance l'animation d'une image. @param {number} delta Secondes écoulées. */
  advance(delta) {
    if (this.disposed || !Number.isFinite(delta)) return;
    this.time = (this.time + delta) % 3600;
    this._writeFrame();
  }

  /** @param {number} direction Direction du vent, en radians. */
  setWindDirection(direction) {
    this._windDirection = Number.isFinite(direction) ? direction : 0;
  }

  /** La poussière s'assombrit avec la nuit, comme la fumée. @param {number} mix 0 à 1. */
  setNight(mix) {
    const night = Math.min(1, Math.max(0, Number(mix) || 0));
    this.dustMaterial.uniforms.uTint.value = 0.35 + (1 - night) * 0.65;
  }

  _writeFrame() {
    // Taille fixe : pas de variation d'échelle d'un tracteur à l'autre.
    this._scale.setScalar(1);
    this._tractors.forEach((tractor, index) => {
      const at = fieldVehicleAt(tractor, this.time);
      this._position.set(at.x, at.y - TRACTOR_SINK_M, at.z);
      this._euler.set(0, at.heading, 0);
      this._quaternion.setFromEuler(this._euler);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(index, this._matrix);
    });
    this.mesh.count = this._tractors.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._writeDust();
  }

  _writeDust() {
    let index = 0;
    this._quaternion.identity();
    for (const tractor of this._tractors) {
      for (let p = 0; p < DUST_PUFFS; p++) {
        const puff = dustPuffAt(tractor, this.time, p, this._windDirection);
        this._position.set(puff.x, puff.y, puff.z);
        this._scale.setScalar(puff.size);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.dust.setMatrixAt(index++, this._matrix);
      }
    }
    this.dust.count = index;
    this.dust.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.mesh);
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.group.remove(this.dust);
    this.dust.dispose?.();
    this.dustGeometry.dispose();
    this.dustMaterial.dispose();
    this._tractors = [];
    this.scene.remove(this.group);
  }
}

/**
 * Bouffée de poussière : panneau face caméra, même construction que la fumée
 * de `lifeLayer`. L'opacité se lit sur la taille de l'instance, qui croît avec
 * l'âge : une bouffée qui s'étale se dilue.
 */
function createDustMaterial(THREE, tint) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTint: { value: 1 },
      uDust: { value: new THREE.Vector3(...tint) },
      uSize: { value: new THREE.Vector2(DUST_SIZE_M[0], DUST_SIZE_M[1]) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vSize;
      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vSize = length(instanceMatrix[0].xyz);
        centre.xy += position.xy * vSize;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: `
      uniform float uTint;
      uniform vec3 uDust;
      uniform vec2 uSize;
      varying vec2 vUv;
      varying float vSize;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float falloff = pow(max(0.0, 1.0 - r), 1.6);
        float t = clamp((vSize - uSize.x) / (uSize.y - uSize.x), 0.0, 1.0);
        // Dense au ras des roues, un voile en fin de vie.
        float alpha = falloff * (1.0 - t) * 0.38;
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(uDust * uTint, alpha);
      }
    `,
  });
  material.name = 'tractor-dust';
  return material;
}
