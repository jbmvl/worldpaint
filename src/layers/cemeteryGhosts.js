/*
 * Fantômes de cimetière : quelques silhouettes blanches lumineuses, dôme et
 * ourlet ondulé, deux yeux sombres — un lot de quads face caméra, dessinés
 * entièrement dans le shader. Ils n'existent que la nuit : leur opacité suit
 * la part de nuit du ciel, et chacun apparaît puis s'efface sur son propre
 * cycle, ce qui les rend rares même dans un cimetière hanté.
 *
 * Le flottement (balancement, petite ronde) se calcule dans le shader à partir
 * d'une phase par instance : aucune matrice n'est réécrite par image.
 */
import { defaultTheme } from '../themes/default.js';

export class CemeteryGhosts {
  constructor({ THREE, group, theme = defaultTheme }) {
    this.THREE = THREE;
    this.group = group;
    this.look = theme.furniture?.ghost ?? defaultTheme.furniture.ghost;
    // Quad 1 × 1,3 : le corps occupe le milieu, la marge porte le halo.
    this.geometry = new THREE.PlaneGeometry(1, 1.3);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      fog: false, toneMapped: false,
      uniforms: {
        uBody: { value: new THREE.Vector3(...this.look.body) },
        uEyes: { value: new THREE.Vector3(...this.look.eyes) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uCycle: { value: this.look.cycleS },
        uShown: { value: this.look.shownShare },
        uBob: { value: this.look.bobM },
        uRound: { value: this.look.roundM },
      },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime, uCycle, uShown, uBob, uRound;
        varying vec2 vUv;
        varying float vFade;
        varying float vWave;
        void main() {
          vUv = uv;
          float t = uTime + aPhase * 97.0;
          vec3 ronde = vec3(cos(t * 0.21) * uRound, sin(t * 1.3) * uBob, sin(t * 0.21) * uRound);
          vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          centre.xyz += (viewMatrix * vec4(ronde, 0.0)).xyz;
          float taille = length(instanceMatrix[1].xyz);
          // Léger roulis : le fantôme penche vers où il va.
          float roulis = sin(t * 0.21) * 0.12;
          vec2 p = position.xy * taille;
          centre.xy += vec2(p.x * cos(roulis) - p.y * sin(roulis), p.x * sin(roulis) + p.y * cos(roulis));
          gl_Position = projectionMatrix * centre;
          float cycle = fract(t / uCycle);
          vFade = smoothstep(0.0, 0.12, cycle) * (1.0 - smoothstep(uShown - 0.12, uShown, cycle));
          vWave = t * 4.0;
        }
      `,
      fragmentShader: `
        uniform vec3 uBody, uEyes;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vFade;
        varying float vWave;
        void main() {
          vec2 p = vec2(vUv.x - 0.5, vUv.y * 1.3 - 0.65);
          // Dôme et jupe : distance signée au corps, ourlet ondulé en bas.
          float dome = length(p - vec2(0.0, 0.08)) - 0.3;
          float ourlet = -0.32 + 0.045 * sin(p.x * 31.0 + vWave);
          float jupe = max(abs(p.x) - 0.3, max(ourlet - p.y, p.y - 0.08));
          float d = min(dome, jupe);
          float corps = 1.0 - smoothstep(-0.008, 0.008, d);
          float halo = exp(-max(d, 0.0) * 16.0) * 0.55;
          vec2 oeil = vec2(abs(p.x) - 0.11, p.y - 0.1);
          float yeux = 1.0 - smoothstep(0.0, 0.012, length(oeil * vec2(1.0, 0.62)) - 0.042);
          vec3 couleur = mix(uBody, uEyes, yeux * corps);
          float alpha = max(corps * 0.92, halo) * uOpacity * vFade;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(couleur, alpha);
        }
      `,
    });
    this.material.name = 'cemetery-ghost';
    this.mesh = null;
    this._night = 0;
    this._matrix = new THREE.Matrix4();
  }

  /** @param {Array<{x:number,y:number,z:number,phase:number,scale?:number}>} ghosts */
  set(ghosts) {
    const count = ghosts.length;
    if (!this.mesh && !count) return;
    if (!this.mesh || this.mesh.instanceMatrix.count < count) {
      this._disposeMesh();
      const capacity = count + 4;
      this.geometry.setAttribute('aPhase', new this.THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      this.mesh = new this.THREE.InstancedMesh(this.geometry, this.material, capacity);
      this.mesh.name = 'cemetery-ghosts';
      this.mesh.renderOrder = 8;
      this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    const phases = this.geometry.getAttribute('aPhase');
    ghosts.forEach((g, i) => {
      const s = this.look.heightM * (g.scale ?? 1);
      this._matrix.makeScale(s, s, s).setPosition(g.x, g.y + this.look.floatM + s * 0.5, g.z);
      this.mesh.setMatrixAt(i, this._matrix);
      phases.setX(i, g.phase);
    });
    phases.needsUpdate = true;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._applyVisibility();
  }

  advance(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    // Modulo large : garde la précision du float du shader sans saut visible.
    this.material.uniforms.uTime.value = (this.material.uniforms.uTime.value + delta) % 3600;
  }

  setNight(mix) {
    this._night = Math.min(1, Math.max(0, Number(mix) || 0));
    const v = Math.min(1, Math.max(0, (this._night - this.look.fromNight) / (1 - this.look.fromNight)));
    this.material.uniforms.uOpacity.value = v * v * (3 - 2 * v);
    this._applyVisibility();
  }

  _applyVisibility() {
    if (this.mesh) this.mesh.visible = this.mesh.count > 0 && this.material.uniforms.uOpacity.value > 0.01;
  }

  _disposeMesh() {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = null;
  }

  dispose() {
    this._disposeMesh();
    this.geometry.dispose();
    this.material.dispose();
  }
}
