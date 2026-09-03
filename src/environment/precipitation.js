/*
 * precipitation — la pluie et la neige, dans une boîte qui suit l'observateur
 * (quelques dizaines de mètres, attachée à la caméra, gouttes en boucle —
 * au-delà, une goutte fait moins d'un pixel).
 *
 * Tout le mouvement est dans le sommet (un seul uniforme de temps, comme le
 * vent du feuillage). L'intensité change `setDrawRange`, pas la taille du
 * tampon (alloué une fois au maximum). Positions tirées d'un générateur
 * graine plutôt que `Math.random`, pour un semis reproductible.
 *
 * Délibérément absent : éclairage, brouillard de scène, rebond. Teintées par
 * `setTint` (l'ambiance) pour qu'une averse de nuit soit sombre.
 */

import { windAxis } from './weather.js';

/** Demi-côté de la boîte, en mètres. Au-delà, une goutte fait moins d'un pixel. */
const SPREAD_M = 26;
/** Hauteur de la boîte, en mètres. C'est la période de la boucle de chute. */
const HEIGHT_M = 34;
/** Nombre maximal de gouttes de pluie. Atteint à `precipitation = 1`. */
const MAX_DROPS = 7000;
/** Nombre maximal de flocons. Un flocon est plus gros et plus lent : il en faut moins. */
const MAX_FLAKES = 2600;
/** Longueur du filet d'une goutte, en mètres. C'est lui qui donne la vitesse à l'œil. */
const STREAK_M = 0.75;
/** Vitesse de chute, en m/s. La pluie tombe vite, la neige flotte. */
const RAIN_SPEED = 26;
const SNOW_SPEED = 1.6;

/** Générateur graine, façon mulberry32 (constante, pas l'horloge, pour un rendu reproductible). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deux sommets par goutte (tête et queue du filet), même position de base. `aTail` dit lequel des deux on est. */
function rainGeometry(THREE) {
  const random = seeded(0x9e3779b9);
  const base = new Float32Array(MAX_DROPS * 2 * 3);
  const tail = new Float32Array(MAX_DROPS * 2);

  for (let i = 0; i < MAX_DROPS; i++) {
    const x = (random() * 2 - 1) * SPREAD_M;
    const y = random() * HEIGHT_M;
    const z = (random() * 2 - 1) * SPREAD_M;
    for (let v = 0; v < 2; v++) {
      const o = (i * 2 + v) * 3;
      base[o] = x;
      base[o + 1] = y;
      base[o + 2] = z;
      tail[i * 2 + v] = v;
    }
  }

  const geometry = new THREE.BufferGeometry();
  // `position` doit exister (three s'en sert pour la sphère englobante), laissée nulle.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.length), 3));
  geometry.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geometry.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
  return geometry;
}

function snowGeometry(THREE) {
  const random = seeded(0x85ebca6b);
  const base = new Float32Array(MAX_FLAKES * 3);
  const phase = new Float32Array(MAX_FLAKES);

  for (let i = 0; i < MAX_FLAKES; i++) {
    base[i * 3] = (random() * 2 - 1) * SPREAD_M;
    base[i * 3 + 1] = random() * HEIGHT_M;
    base[i * 3 + 2] = (random() * 2 - 1) * SPREAD_M;
    phase[i] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.length), 3));
  geometry.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  return geometry;
}

/** Uniformes partagés par les deux matériaux. */
function sharedUniforms(THREE) {
  return {
    uTime: { value: 0 },
    uSpeed: { value: RAIN_SPEED },
    uHeight: { value: HEIGHT_M },
    /** Direction et force du vent au sol, dans le plan horizontal. */
    uWind: { value: new THREE.Vector2(0, 0) },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uOpacity: { value: 0.5 },
  };
}

/** Chute en boucle, commune aux deux formes : `uSpeed` m/s, modulo sur la hauteur de la boîte. */
const FALL_CHUNK = `
  float fallHeight(vec3 base, float time, float speed, float height) {
    return mod(base.y - time * speed, height) - height * 0.35;
  }
`;

function rainMaterial(THREE, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false, // pas d'ordre entre gouttes : écrire la profondeur ferait clignoter
    vertexShader: `
      attribute vec3 aBase;
      attribute float aTail;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uHeight;
      uniform vec2 uWind;
      ${FALL_CHUNK}
      void main() {
        vec3 p = vec3(aBase.x, fallHeight(aBase, uTime, uSpeed, uHeight), aBase.z);
        // Le filet est tiré vers l'amont de la chute : c'est l'inclinaison qui dit qu'il y a du vent.
        vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
        p -= dir * ${STREAK_M.toFixed(2)} * aTail;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uTint, uOpacity);
      }
    `,
  });
}

function snowMaterial(THREE, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 aBase;
      attribute float aPhase;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uHeight;
      uniform vec2 uWind;
      ${FALL_CHUNK}
      void main() {
        float y = fallHeight(aBase, uTime, uSpeed, uHeight);
        // Flottement : deux ondes déphasées par flocon, amplitude croissante avec le vent.
        float flutter = 0.35 + length(uWind) * 0.9;
        vec3 p = vec3(
          aBase.x + sin(uTime * 0.7 + aPhase) * flutter + uWind.x * 2.0,
          y,
          aBase.z + cos(uTime * 0.55 + aPhase * 1.7) * flutter + uWind.y * 2.0
        );
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Taille en perspective, sinon la neige forme un voile uniforme.
        gl_PointSize = clamp(90.0 / max(-mv.z, 1.0), 1.0, 9.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      void main() {
        // Disque adouci calculé dans le fragment : pas de texture à charger.
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.18, d);
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(uTint, uOpacity * alpha);
      }
    `,
  });
}

/**
 * Les précipitations de la scène. Une seule instance : elle porte la pluie
 * *et* la neige, et n'en montre qu'une à la fois.
 */
export class Precipitation {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   */
  constructor({ THREE, scene }) {
    this.THREE = THREE;
    this.scene = scene;
    this.uniforms = sharedUniforms(THREE);

    this.group = new THREE.Group();
    this.group.name = 'precipitation';
    // Recentrée à chaque image sur la caméra : pas de culling frustum.
    this.group.frustumCulled = false;

    this.rain = new THREE.LineSegments(rainGeometry(THREE), rainMaterial(THREE, this.uniforms));
    this.rain.name = 'rain';
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 10;

    this.snow = new THREE.Points(snowGeometry(THREE), snowMaterial(THREE, this.uniforms));
    this.snow.name = 'snow';
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.snow.renderOrder = 10;

    this.group.add(this.rain);
    this.group.add(this.snow);
    scene.add(this.group);
  }

  /**
   * Accorde la chute sur l'état météo.
   *
   * @param {Object} weather État résolu (`resolveWeather`).
   */
  setWeather(weather) {
    const snowing = weather.precipitationType === 'snow';
    const intensity = weather.precipitation;

    this.rain.visible = !snowing && intensity > 0;
    this.snow.visible = snowing && intensity > 0;

    if (intensity <= 0) return;

    const mesh = snowing ? this.snow : this.rain;
    const max = snowing ? MAX_FLAKES : MAX_DROPS;
    // Racine carrée : le compte visible croît plus vite que l'impression de pluie.
    const count = Math.round(max * Math.sqrt(intensity));
    mesh.geometry.setDrawRange(0, snowing ? count : count * 2);

    const drift = weather.wind * (snowing ? 2.2 : 1.1);
    const [wx, wz] = windAxis([drift * 0.85, drift * 0.35], weather);
    this.uniforms.uWind.value.set(wx, wz);
    this.uniforms.uSpeed.value =
      (snowing ? SNOW_SPEED : RAIN_SPEED) * (1 + weather.wind * (snowing ? 0.4 : 0.5));
    this.uniforms.uOpacity.value = snowing
      ? 0.35 + intensity * 0.5
      : 0.16 + intensity * 0.28;
  }

  /**
   * Teinte des gouttes, donnée par l'ambiance (grise sous un orage, presque éteinte la nuit).
   * @param {{r:number,g:number,b:number}} color
   */
  setTint(color) {
    this.uniforms.uTint.value.setRGB(color.r, color.g, color.b);
  }

  /** Fait tomber. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    if (!Number.isFinite(delta)) return;
    // Remis dans une plage courte (float32) pour éviter que la chute saccade.
    this.uniforms.uTime.value = (this.uniforms.uTime.value + delta) % 3600;
  }

  /**
   * Recentre la boîte à proximité de l'observateur, sans la coller
   * exactement dessus (recentrage sur une maille du monde, pour que la
   * traversée donne de la parallaxe plutôt qu'un rideau plaqué à l'écran).
   */
  follow(position) {
    const step = SPREAD_M / 3;
    const x = Math.round(position.x / step) * step;
    const z = Math.round(position.z / step) * step;
    this.group.position.set(x, position.y, z);
  }

  dispose() {
    this.scene.remove(this.group);
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.snow.geometry.dispose();
    this.snow.material.dispose();
  }
}
