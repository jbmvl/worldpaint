/*
 * lighthouseLight — le feu d'un phare : une lanterne blanche que l'éclairage
 * de la scène ne touche pas, son halo, et deux faisceaux opposés qui balaient
 * l'horizon.
 *
 * La tour est du mobilier ordinaire (`furnitureKit.lighthouse`), le feu non :
 * il est additif, sans profondeur ni brouillard, et il tourne à chaque image.
 * Il vit donc dans ses propres maillages, que `furnitureLayer` alimente à
 * chaque reconstruction et fait avancer par image.
 *
 * La rotation est dans le shader : un seul uniforme pour tous les phares, et
 * aucune matrice réécrite par image. Chaque phare garde son déphasage dans le
 * lacet de son instance — tiré de sa position au sol, donc le même d'une
 * reconstruction à l'autre.
 *
 * Pas de vraie lumière : le nombre de lumières entre dans la clé de programme
 * de tous les matériaux (voir `furnitureLayer.lampLights`). Le faisceau se
 * voit, il n'éclaire pas le sol.
 */

import { defaultTheme } from '../themes/default.js';
import { createGlowGeometry, createGlowMaterial, LIGHTHOUSE_LANTERN_M } from './furnitureKit.js';

/** Portée visible d'un faisceau, en mètres. */
export const LIGHTHOUSE_BEAM_LENGTH_M = 240;
/** Rayon du faisceau à la lanterne et à son extrémité, en mètres. */
const BEAM_NEAR_RADIUS_M = 0.6;
const BEAM_FAR_RADIUS_M = 13;
/** Pans du cône : assez pour qu'il ne se lise pas comme une lame vu de côté. */
const BEAM_SIDES = 6;
/** Verrière allumée : rayon (au ras de celle de la tour, juste devant) et hauteur, en mètres. */
const LANTERN_RADIUS_M = 1.34;
const LANTERN_HEIGHT_M = 2.3;
/** Diamètre du halo de la lanterne, en mètres. */
const LANTERN_GLOW_M = 16;

/** Angle du feu après `delta` secondes, pour un tour en `periodS`. Fonction pure. */
export function lighthouseAngle(angle, delta, periodS) {
  if (!Number.isFinite(delta) || !(periodS > 0)) return angle;
  return (angle + (delta / periodS) * Math.PI * 2) % (Math.PI * 2);
}

/**
 * Deux cônes ouverts, dos à dos le long de ±Z, origine à la lanterne.
 * `along` vaut 0 à la lanterne et 1 au bout : c'est lui qui éteint le faisceau.
 */
export function createLighthouseBeamGeometry(THREE) {
  const positions = [];
  const along = [];
  const start = 1.3;
  for (const dir of [1, -1]) {
    for (let i = 0; i < BEAM_SIDES; i++) {
      const a = (i / BEAM_SIDES) * Math.PI * 2;
      const b = ((i + 1) / BEAM_SIDES) * Math.PI * 2;
      const corner = (angle, radius, z) => [Math.cos(angle) * radius, Math.sin(angle) * radius, z * dir];
      const n0 = corner(a, BEAM_NEAR_RADIUS_M, start);
      const n1 = corner(b, BEAM_NEAR_RADIUS_M, start);
      const f0 = corner(a, BEAM_FAR_RADIUS_M, LIGHTHOUSE_BEAM_LENGTH_M);
      const f1 = corner(b, BEAM_FAR_RADIUS_M, LIGHTHOUSE_BEAM_LENGTH_M);
      positions.push(...n0, ...n1, ...f1, ...n0, ...f1, ...f0);
      along.push(0, 0, 1, 0, 1, 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  geometry.name = 'lighthouse-beam';
  return geometry;
}

/** Matière du faisceau : additive, éteinte vers son extrémité, tournée autour de Y dans le shader. */
export function createLighthouseBeamMaterial(THREE, { color }) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: 0 },
      uAngle: { value: 0 },
    },
    vertexShader: `
      attribute float along;
      uniform float uAngle;
      varying float vAlong;
      void main() {
        vAlong = along;
        float c = cos(uAngle);
        float s = sin(uAngle);
        vec4 local = vec4(position.x * c + position.z * s, position.y, position.z * c - position.x * s, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlong;
      void main() {
        float falloff = pow(max(0.0, 1.0 - vAlong), 1.7);
        if (falloff <= 0.002 || uOpacity <= 0.002) discard;
        gl_FragColor = vec4(uColor, falloff * uOpacity);
      }
    `,
  });
  material.name = 'lighthouse-beam';
  return material;
}

export class LighthouseLight {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.group Groupe du mobilier, qui porte les maillages.
   * @param {Object} [options.theme]
   */
  constructor({ THREE, group, theme = defaultTheme }) {
    this.THREE = THREE;
    this.group = group;
    const look = theme.furniture?.lighthouse ?? defaultTheme.furniture.lighthouse;
    this.periodS = look.periodS;
    this.beamOpacity = look.beamOpacity;
    this.beamGeometry = createLighthouseBeamGeometry(THREE);
    this.beamMaterial = createLighthouseBeamMaterial(THREE, { color: look.color });
    this.glowGeometry = createGlowGeometry(THREE);
    this.glowMaterial = createGlowMaterial(THREE, { color: look.color });
    this.lanternGeometry = new THREE.CylinderGeometry(LANTERN_RADIUS_M, LANTERN_RADIUS_M, LANTERN_HEIGHT_M, 8, 1, true);
    this.lanternGeometry.name = 'lighthouse-lantern';
    this.lanternMaterial = new THREE.MeshBasicMaterial({
      color: look.lantern,
      transparent: true,
      opacity: 0,
      fog: false,
      toneMapped: false,
    });
    this.lanternMaterial.name = 'lighthouse-lantern';
    this.lanternMesh = null;
    this.beamMesh = null;
    this.glowMesh = null;
    this._angle = 0;
    this._night = 0;
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
  }

  _mesh(existing, geometry, material, name, count) {
    if (existing && existing.instanceMatrix.count >= count) return existing;
    if (existing) {
      this.group.remove(existing);
      existing.dispose?.();
    }
    const mesh = new this.THREE.InstancedMesh(geometry, material, count + 2);
    mesh.name = name;
    // Additif et sans profondeur : après tout le reste, comme les halos.
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    mesh.visible = this._night > 0.01;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * (Ré)alimente les feux à partir des phares posés.
   * @param {Array<{x:number,y:number,z:number,yaw:number,scale:number}>} lighthouses
   */
  set(lighthouses) {
    const count = lighthouses.length;
    if (count === 0) {
      if (this.beamMesh) this.beamMesh.count = 0;
      if (this.glowMesh) this.glowMesh.count = 0;
      if (this.lanternMesh) this.lanternMesh.count = 0;
      return;
    }
    this.lanternMesh = this._mesh(this.lanternMesh, this.lanternGeometry, this.lanternMaterial, 'lighthouse-lantern', count);
    this.lanternMesh.renderOrder = 0;
    this.beamMesh = this._mesh(this.beamMesh, this.beamGeometry, this.beamMaterial, 'lighthouse-beam', count);
    this.glowMesh = this._mesh(this.glowMesh, this.glowGeometry, this.glowMaterial, 'lighthouse-glow', count);

    lighthouses.forEach((tower, index) => {
      const scale = tower.scale || 1;
      this._position.set(tower.x, tower.y + LIGHTHOUSE_LANTERN_M * scale, tower.z);
      this._quaternion.setFromAxisAngle(this._axis, tower.yaw || 0);
      this._scale.setScalar(scale);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.beamMesh.setMatrixAt(index, this._matrix);
      this.lanternMesh.setMatrixAt(index, this._matrix);
      // Le halo relit son rayon dans l'échelle de l'instance.
      this._quaternion.identity();
      this._scale.setScalar(LANTERN_GLOW_M * scale);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.glowMesh.setMatrixAt(index, this._matrix);
    });
    for (const mesh of [this.beamMesh, this.glowMesh, this.lanternMesh]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** @param {number} delta Secondes écoulées. */
  advance(delta) {
    if (this._night <= 0.01) return;
    this._angle = lighthouseAngle(this._angle, delta, this.periodS);
    this.beamMaterial.uniforms.uAngle.value = this._angle;
  }

  /** @param {number} mix 0 en plein jour, 1 en pleine nuit. */
  setNight(mix) {
    this._night = Math.min(1, Math.max(0, Number(mix) || 0));
    this.beamMaterial.uniforms.uOpacity.value = this._night * this.beamOpacity;
    this.glowMaterial.uniforms.uOpacity.value = this._night;
    this.lanternMaterial.opacity = this._night;
    for (const mesh of [this.beamMesh, this.glowMesh, this.lanternMesh]) if (mesh) mesh.visible = this._night > 0.01;
  }

  dispose() {
    for (const mesh of [this.beamMesh, this.glowMesh, this.lanternMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.beamMesh = null;
    this.glowMesh = null;
    this.lanternMesh = null;
    this.lanternGeometry.dispose();
    this.lanternMaterial.dispose();
    this.beamGeometry.dispose();
    this.beamMaterial.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
  }
}
