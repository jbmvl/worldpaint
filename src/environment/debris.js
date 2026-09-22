/* Feuilles volantes : petites surfaces pliées en rotation, entraînées par
 * le même vent que la végétation. Un seul maillage, sans points écran.
 * Le fondu des bords de la boîte masque son recyclage spatial.
 */

import { defaultTheme } from '../themes/default.js';
import { windAxis } from './weather.js';

export const DEBRIS_SPREAD_M = 60;
const SPREAD_M = DEBRIS_SPREAD_M;
/** Hauteur maximale atteinte pleinement emporté, en mètres. */
const HEIGHT_M = 3.2;
/** Nombre maximal de particules. Volontairement modeste : « quelques ». */
export const MAX_DEBRIS = 180;
export const DEBRIS_WIND_START = 0.3;

/** Générateur graine, façon mulberry32 — voir `precipitation.js`. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function debrisGeometry(THREE, look) {
  const random = seeded(0xc2b2ae35);
  const base=[], phase=[], positions=[];
  const { lengthM, widthM, foldM } = look;
  const a=[0,0,-lengthM/2], b=[widthM/2,0,0], c=[0,0,lengthM/2], d=[-widthM/2,0,0], e=[0,foldM,0];
  for(let i=0;i<MAX_DEBRIS;i++) {
    const origin=[(random()*2-1)*SPREAD_M,random(),(random()*2-1)*SPREAD_M];
    const angle=random()*Math.PI*2;
    const scale=.7+random()*.7;
    for(const v of [a,b,e,b,c,e,c,d,e,d,a,e]) {
      positions.push(...v.map(n=>n*scale)); base.push(...origin); phase.push(angle);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('aBase',new THREE.BufferAttribute(new Float32Array(base),3));
  geometry.setAttribute('aPhase',new THREE.BufferAttribute(new Float32Array(phase),1));
  geometry.setAttribute('aGround',new THREE.BufferAttribute(new Float32Array(phase.length),1));
  return geometry;
}

function debrisMaterial(THREE) {
  const uniforms = {
    uTime: { value: 0 },
    uTravel: { value: new THREE.Vector2() },
    uCenter: { value: new THREE.Vector2() },
    /** Direction et force du vent au sol — même vecteur que la pluie/neige. */
    uWind: { value: new THREE.Vector2(0, 0) },
    /** 0 au sol, 1 pleinement emporté. Voir l'en-tête. */
    uLift: { value: 0 },
    uTint: { value: new THREE.Color(0.3, 0.42, 0.2) },
    uOpacity: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aBase;
      attribute float aPhase;
      attribute float aGround;
      uniform vec2 uTravel;
      uniform vec2 uCenter;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uLift;
      varying float vLeafLight;
      varying float vEdge;

      void main() {
        float airborne = aBase.y * ${HEIGHT_M.toFixed(1)} * (0.65 + 0.35 * sin(uTime * 0.7 + aPhase));
        float y = aGround + 0.025 + airborne * uLift;
        // Le déplacement intégré et le centre se compensent en coordonnées monde.
        float wx = mod(aBase.x + uTravel.x - uCenter.x + ${SPREAD_M.toFixed(1)}, ${(2 * SPREAD_M).toFixed(1)}) - ${SPREAD_M.toFixed(1)};
        float wz = mod(aBase.z + uTravel.y - uCenter.y + ${SPREAD_M.toFixed(1)}, ${(2 * SPREAD_M).toFixed(1)}) - ${SPREAD_M.toFixed(1)};

        // Tournoiement, nul au sol, marqué en l'air.
        float swirl = uLift * 0.5;
        vec3 p = vec3(
          wx + sin(uTime * 0.9 + aPhase * 1.7) * swirl,
          y,
          wz + cos(uTime * 0.8 + aPhase * 2.1) * swirl
        );

        float roll = uLift * (uTime * 2.5 + aPhase);
        float pitch = sin(uTime*2.3+aPhase) * uLift * 0.9;
        vec3 leaf = vec3(position.x*cos(roll)-position.y*sin(roll),position.x*sin(roll)+position.y*cos(roll),position.z);
        leaf.yz = mat2(cos(pitch),-sin(pitch),sin(pitch),cos(pitch))*leaf.yz;
        vLeafLight = 0.75+0.25*abs(cos(roll));
        vEdge = 1.0-smoothstep(${(SPREAD_M-4).toFixed(1)},${SPREAD_M.toFixed(1)},max(abs(wx),abs(wz)));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p+leaf,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      varying float vLeafLight;
      varying float vEdge;
      void main() {
        gl_FragColor = vec4(uTint*vLeafLight, uOpacity*vEdge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  return { material, uniforms };
}

/**
 * Feuilles et graminées arrachées par le vent. Une seule instance, montée
 * même sans vent — comme `Precipitation`, pour ne rien allouer au moment
 * précis où le vent se lève.
 */
export class Debris {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {[number,number,number]} [options.tint] Couleur linéaire de
   *        référence (teinte du feuillage du thème — voir `sceneEnvironment.js`).
   */
  constructor({ THREE, scene, tint = [0.3, 0.42, 0.2], look = defaultTheme.leaves }) {
    this.THREE = THREE;
    this.scene = scene;

    const { material, uniforms } = debrisMaterial(THREE);
    this.uniforms = uniforms;
    this.uniforms.uTint.value.setRGB(tint[0], tint[1], tint[2]);

    this.points = new THREE.Mesh(debrisGeometry(THREE, look), material);
    this.points.name = 'debris';
    // Les coordonnées locales suivent la fenêtre, les positions monde restent fixes.
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 9;

    scene.add(this.points);
  }

  /**
   * Accorde les particules sur l'état météo.
   * @param {Object} weather État résolu (`resolveWeather`).
   */
  setWeather(weather) {
    // Éteint dès qu'il pleut ou neige (précipitation.js porte déjà l'eau).
    const active = weather.precipitation <= 0 && weather.wind > DEBRIS_WIND_START;
    this.points.visible = active;
    if (!active) {
      this.uniforms.uWind.value.set(0, 0);
      this.uniforms.uLift.value = 0;
      this.points.geometry.setDrawRange(0, 0);
      return;
    }

    const strength = (weather.wind - DEBRIS_WIND_START) / (1 - DEBRIS_WIND_START);
    this.points.geometry.setDrawRange(0, Math.round(MAX_DEBRIS * strength) * 12);
    this.uniforms.uLift.value = this.THREE.MathUtils.smoothstep(weather.wind, 0.45, 1);
    const speed = 0.12 + 8 * strength * strength;
    const [wx, wz] = windAxis([speed / Math.hypot(1, .45), speed * .45 / Math.hypot(1, .45)], weather);
    this.uniforms.uWind.value.set(wx, wz);
    this.uniforms.uOpacity.value = Math.min(1, strength * 5) * 0.85;
  }

  /** Teinte des particules — voir `Precipitation.setTint`. */
  setTint(color) {
    this.uniforms.uTint.value.setRGB(color.r, color.g, color.b);
  }

  /** Fait dériver. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.uniforms.uTime.value += delta;
    const travel = this.uniforms.uTravel.value, wind = this.uniforms.uWind.value;
    travel.set((travel.x + wind.x * delta) % (2 * SPREAD_M), (travel.y + wind.y * delta) % (2 * SPREAD_M));
  }

  /** Déplace la fenêtre sans déplacer les feuilles et échantillonne leur sol. */
  follow(position, sampleGround = null) {
    this.uniforms.uCenter.value.set(position.x, position.z);
    this.points.position.set(position.x, 0, position.z);
    if (!this.points.visible) return;
    const base = this.points.geometry.attributes.aBase.array;
    const ground = this.points.geometry.attributes.aGround;
    const travel = this.uniforms.uTravel.value;
    const wrap = v => ((v + SPREAD_M) % (2 * SPREAD_M) + 2 * SPREAD_M) % (2 * SPREAD_M) - SPREAD_M;
    for (let i = 0; i < this.points.geometry.drawRange.count; i += 12) {
      const x = position.x + wrap(base[i * 3] + travel.x - position.x);
      const z = position.z + wrap(base[i * 3 + 2] + travel.y - position.z);
      const y = sampleGround?.(x, z) ?? position.y;
      ground.array.fill(y, i, i + 12);
    }
    ground.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
