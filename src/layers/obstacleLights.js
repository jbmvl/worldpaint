/*
 * Balises rouges des antennes et des éoliennes : un lot de halos face caméra,
 * occultés par le relief. Un diamètre minimal en pixels garde le flash lisible
 * à l'horizon. Aucun éclairage de scène ni matrice ne change par image : seul
 * l'éclat commun avance, avec la part de nuit donnée par le ciel.
 */
import { defaultTheme } from '../themes/default.js';
import { WIND_TURBINE_BEACON } from './furnitureKit.js';

export function obstacleFlash(seconds, look = defaultTheme.furniture.obstacleLight) {
  if (!Number.isFinite(seconds) || !(look.periodS > 0)) return 0;
  const t = ((seconds % look.periodS) + look.periodS) % look.periodS;
  if (t >= look.flashS) return 0;
  const bord = Math.min(t, look.flashS - t);
  const v = Math.min(1, Math.max(0, bord / look.fadeS));
  return v * v * (3 - 2 * v);
}

export class ObstacleLights {
  constructor({ THREE, group, theme = defaultTheme }) {
    this.THREE = THREE;
    this.group = group;
    this.look = theme.furniture?.obstacleLight ?? defaultTheme.furniture.obstacleLight;
    this.mast = theme.furniture?.radioMast ?? defaultTheme.furniture.radioMast;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Vector3(...this.look.color) },
        uOpacity: { value: 0 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uMinPixels: { value: this.look.minPixels },
      },
      vertexShader: `
        uniform vec2 uViewport;
        uniform float uMinPixels;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float diametre = length(instanceMatrix[0].xyz);
          float pixels = max(uMinPixels, diametre * projectionMatrix[1][1] * uViewport.y / max(0.01, -2.0 * centre.z));
          gl_Position = projectionMatrix * centre;
          gl_Position.xy += position.xy * pixels * 2.0 / uViewport * gl_Position.w;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float rayon = length(vUv - 0.5) * 2.0;
          float halo = pow(max(0.0, 1.0 - rayon), 2.0);
          float coeur = 1.0 - smoothstep(0.08, 0.3, rayon);
          float eclat = max(halo, coeur) * uOpacity;
          if (eclat < 0.002) discard;
          gl_FragColor = vec4(uColor, eclat);
        }
      `,
    });
    this.material.name = 'obstacle-light';
    this.mesh = null;
    this._seconds = 0;
    this._night = 0;
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._viewport = new THREE.Vector4();
  }

  set(masts, turbines) {
    const count = masts.length + turbines.length;
    if (!this.mesh && !count) return;
    if (!this.mesh || this.mesh.instanceMatrix.count < count) {
      if (this.mesh) {
        this.group.remove(this.mesh);
        this.mesh.dispose();
      }
      this.mesh = new this.THREE.InstancedMesh(this.geometry, this.material, count + 4);
      this.mesh.name = 'obstacle-lights';
      this.mesh.renderOrder = 8;
      this.mesh.frustumCulled = false;
      this.mesh.onBeforeRender = (renderer) => {
        renderer.getCurrentViewport(this._viewport);
        this.material.uniforms.uViewport.value.set(this._viewport.z, this._viewport.w);
      };
      this.group.add(this.mesh);
    }
    let index = 0;
    const pose = (objet, ancre) => {
      const echelle = objet.scale ?? 1, angle = objet.yaw ?? 0;
      this._position.set(
        objet.x + (ancre.x * Math.cos(angle) + ancre.z * Math.sin(angle)) * echelle,
        objet.y + (ancre.y + this.look.lensM / 2) * echelle,
        objet.z + (ancre.z * Math.cos(angle) - ancre.x * Math.sin(angle)) * echelle);
      this._scale.setScalar(this.look.diameterM * echelle);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(index++, this._matrix);
    };
    for (const mast of masts) pose(mast, { x: 0, y: this.mast.heightM + this.mast.spireM, z: 0 });
    for (const turbine of turbines) pose(turbine, WIND_TURBINE_BEACON);
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = count > 0 && this._night > 0.01;
  }

  advance(delta) {
    if (Number.isFinite(delta) && delta > 0) this._seconds = (this._seconds + delta) % this.look.periodS;
    this.material.uniforms.uOpacity.value = this._night * obstacleFlash(this._seconds, this.look);
  }

  setNight(mix) {
    this._night = Math.min(1, Math.max(0, Number(mix) || 0));
    if (this.mesh) this.mesh.visible = this.mesh.count > 0 && this._night > 0.01;
    this.advance(0);
  }

  dispose() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
