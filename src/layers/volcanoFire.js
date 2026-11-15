/*
 * volcanoFire — le feu des volcans actifs (`core/volcanoes.js`) : la lueur du
 * cratère, des gerbes de lave projetées, des coulées qui descendent les
 * pentes, et le panache de fumée au-dessus.
 *
 * Un volcan se voit de loin : il vit donc sur le relief lointain
 * (`farRelief`), pas dans le rayon du détail, et ne monte qu'avec lui — pas
 * de nappe, pas de pente sur laquelle faire couler la lave. Le feu passe le
 * brouillard (un rougeoiement se voit dans la brume), atténué seulement au
 * bord de la nappe ; la fumée, elle, s'y fond à moitié.
 *
 * Tout bouge dans les shaders : un seul uniforme de temps, aucune matrice
 * réécrite par image. Les tirages viennent de l'identifiant du volcan, jamais
 * de sa position dans le repère : le même volcan crache pareil d'un recentrage
 * à l'autre.
 *
 * Pas de vraie lumière : comme les phares (`lighthouseLight`), le feu se voit,
 * il n'éclaire pas le sol.
 */

import { defaultTheme } from '../themes/default.js';
import { ACTIVE_VOLCANOES } from '../core/volcanoes.js';

/** Rayon de recherche du cratère autour du sommet relevé, et pas de la grille, en mètres. */
export const CRATER_SEARCH_M = 700;
const CRATER_STEP_M = 25;
/** Distance du centre du cratère où naît une coulée : sur la lèvre, pas au fond. */
const FLOW_SOURCE_M = 70;
/** Pas, longueur maximale et largeur d'une coulée, en mètres. */
const FLOW_STEP_M = 20;
export const FLOW_MAX_M = 2200;
const FLOW_WIDTH_M = 26;
/** Décollement des coulées au-dessus du sol affiché, en mètres. */
const FLOW_LIFT_M = 2.5;
/** Écart de cap qu'une coulée s'autorise d'un pas à l'autre, de part et d'autre. */
const FLOW_TURN = Math.PI / 3;
/** Pas sans descendre avant qu'une coulée s'arrête : la lave s'étale puis se fige. */
const FLOW_FLAT_STEPS = 3;

/** Gerbes : vitesse de sortie (m/s), gravité, période des salves (s). */
const SPARK_SPEED = [28, 62];
const GRAVITY = 9.81;
const SPARK_PERIOD_S = 2 * SPARK_SPEED[1] / GRAVITY + 1;
const SPARKS_PER_VOLCANO = 220;
const SPARK_SIZE_M = 9;
/** Taille apparente minimale d'une gerbe ou d'une bouffée, en part de sa distance : quelques pixels au loin. */
const MIN_ANGULAR_SIZE = 0.0028;
/** Panache : hauteur, durée de vie d'une bouffée, nombre et taille des bouffées. */
const PLUME_HEIGHT_M = 1300;
const PLUME_PERIOD_S = 70;
const PUFFS_PER_VOLCANO = 64;
const PUFF_SIZE_M = 170;
/** Lueur du cratère : diamètre du cœur et du halo, en mètres. */
const CRATER_GLOW_M = 320;
const CRATER_HALO_M = 1100;
/** Distances (m) où le feu commence et finit de s'éteindre, en part du rayon de la nappe. */
const FADE_START = 0.75;
const FADE_END = 1.25;

/** Tirage déterministe dans [0, 1) pour un volcan, un rang et un usage. */
export function volcanoRandom(id, index, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ index, 2246822519);
  h = Math.imul(h ^ (h >>> 15), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Volcans de la liste à moins de `radius` du point `here`, en mètres locaux. */
export function volcanoesWithin(frame, here, radius, list = ACTIVE_VOLCANOES) {
  const found = [];
  for (const volcano of list) {
    const p = frame.toLocal(volcano.lng, volcano.lat);
    if (Math.hypot(p.x - here.x, p.z - here.z) <= radius) found.push({ ...volcano, x: p.x, z: p.z });
  }
  return found;
}

/**
 * Point le plus haut du relief autour du sommet relevé : le cratère, à la
 * finesse près du relief lu. `null` si le relief y manque entièrement.
 */
export function craterSite(p, elevationAt, searchM = CRATER_SEARCH_M) {
  let site = null;
  for (let dz = -searchM; dz <= searchM; dz += CRATER_STEP_M) {
    for (let dx = -searchM; dx <= searchM; dx += CRATER_STEP_M) {
      const distance = Math.hypot(dx, dz);
      if (distance > searchM) continue;
      const h = elevationAt(p.x + dx, p.z + dz);
      if (!Number.isFinite(h)) continue;
      if (!site || h > site.h || (h === site.h && distance < site.distance)) site = { x: p.x + dx, z: p.z + dz, h, distance };
    }
  }
  return site && { x: site.x, z: site.z, h: site.h };
}

/**
 * Une coulée : de `start`, suit la plus forte pente dans un cône autour de
 * son cap, jusqu'à `maxM` ou jusqu'à ne plus descendre. Points `{x, z, h,
 * along}`, `along` en mètres depuis la source.
 */
export function traceLavaFlow(start, heading, elevationAt, { maxM = FLOW_MAX_M, stepM = FLOW_STEP_M } = {}) {
  const h0 = elevationAt(start.x, start.z);
  if (!Number.isFinite(h0)) return [];
  const points = [{ x: start.x, z: start.z, h: h0, along: 0 }];
  let lowest = h0;
  let flat = 0;
  let cap = heading;
  while (points.length * stepM < maxM) {
    const last = points[points.length - 1];
    let best = null;
    for (let k = -3; k <= 3; k++) {
      const angle = cap + (k / 3) * FLOW_TURN;
      const x = last.x + Math.sin(angle) * stepM;
      const z = last.z + Math.cos(angle) * stepM;
      const h = elevationAt(x, z);
      if (!Number.isFinite(h)) continue;
      // Un rien de préférence pour le cap tenu : sans elle, la coulée tremble sur un versant régulier.
      const score = h + Math.abs(k) * 0.05;
      if (!best || score < best.score) best = { x, z, h, angle, score };
    }
    if (!best) break;
    if (best.h < lowest - 0.2) {
      lowest = best.h;
      flat = 0;
    } else if (++flat >= FLOW_FLAT_STEPS) break;
    cap = best.angle;
    points.push({ x: best.x, z: best.z, h: best.h, along: last.along + stepM });
  }
  return points;
}

/** Nombre de coulées d'un volcan selon son activité. */
export function flowCount(activity) {
  return Math.max(1, Math.round(1 + activity * 3));
}

const NOISE_GLSL = `
  float vfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vfNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vfHash(i), vfHash(i + vec2(1.0, 0.0)), u.x), mix(vfHash(i + vec2(0.0, 1.0)), vfHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/** Panneau face caméra, à la taille apparente plancher : commun aux gerbes, à la lueur et au panache. */
const BILLBOARD_GLSL = `
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying vec2 vUv;
  varying float vFade;
  vec4 billboard(vec3 centre, float size) {
    vec4 mv = modelViewMatrix * vec4(centre, 1.0);
    float dist = -mv.z;
    size = max(size, dist * ${MIN_ANGULAR_SIZE.toFixed(5)}) * step(0.001, size);
    mv.xy += position.xy * size;
    vUv = uv;
    vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(mv.xyz));
    return projectionMatrix * mv;
  }
`;

const vec3Of = (THREE, c) => new THREE.Vector3(...c);

function fadeUniforms() {
  return { uFadeNear: { value: 1e9 }, uFadeFar: { value: 2e9 } };
}

/** Gerbes : chaque gerbe suit sa parabole, par salves dont la phase vient de son tirage. */
export function createSparkMaterial(THREE, look) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      ...fadeUniforms(),
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uHot: { value: vec3Of(THREE, look.lava.yellow) },
      uWarm: { value: vec3Of(THREE, look.lava.orange) },
      uCool: { value: vec3Of(THREE, look.lava.red) },
    },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec4 aSeed;
      uniform float uTime;
      varying float vLife;
      ${BILLBOARD_GLSL}
      void main() {
        float age = fract(uTime / ${SPARK_PERIOD_S.toFixed(3)} + aSeed.w) * ${SPARK_PERIOD_S.toFixed(3)};
        float speed = aSeed.z;
        vec3 p = aOrigin + vec3(aSeed.x, 1.0, aSeed.y) * speed * age;
        p.y -= 0.5 * ${GRAVITY.toFixed(2)} * age * age;
        vLife = age / (2.0 * speed / ${GRAVITY.toFixed(2)});
        float size = ${SPARK_SIZE_M.toFixed(1)} * (1.0 - 0.45 * clamp(vLife, 0.0, 1.0)) * step(vLife, 1.1);
        gl_Position = billboard(p, size);
      }
    `,
    fragmentShader: `
      uniform float uGlow;
      uniform vec3 uHot;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      varying float vLife;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float core = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
        vec3 colour = mix(uHot, uWarm, smoothstep(0.0, 0.35, vLife));
        colour = mix(colour, uCool, smoothstep(0.35, 0.95, vLife));
        float alpha = core * vFade * uGlow * (1.0 - smoothstep(0.9, 1.1, vLife));
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(colour * alpha, alpha);
      }
    `,
  });
  material.name = 'volcano-sparks';
  return material;
}

/** Lueur du cratère : un halo additif qui palpite. */
export function createCraterGlowMaterial(THREE, look) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      ...fadeUniforms(),
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uColor: { value: vec3Of(THREE, look.glow) },
    },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec4 aSeed;
      uniform float uTime;
      varying float vPulse;
      varying float vStrength;
      ${BILLBOARD_GLSL}
      void main() {
        vPulse = 0.82 + 0.1 * sin(uTime * 1.9 + aSeed.w * 6.283) + 0.08 * sin(uTime * 5.3 + aSeed.w * 17.0);
        vStrength = aSeed.z;
        gl_Position = billboard(aOrigin, aSeed.x);
      }
    `,
    fragmentShader: `
      uniform float uGlow;
      uniform vec3 uColor;
      varying float vPulse;
      varying float vStrength;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float alpha = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r)) * vPulse * vStrength * vFade * uGlow;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(uColor * alpha, alpha);
      }
    `,
  });
  material.name = 'volcano-glow';
  return material;
}

/** Panache : des bouffées qui montent en s'élargissant, poussées par le vent du volcan. */
export function createPlumeMaterial(THREE, look) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...fadeUniforms(),
      uTime: { value: 0 },
      uNight: { value: 0 },
      uDark: { value: vec3Of(THREE, look.smoke.dark) },
      uLight: { value: vec3Of(THREE, look.smoke.light) },
      uFire: { value: vec3Of(THREE, look.glow) },
      uOpacity: { value: look.smoke.opacity },
    },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec4 aSeed;
      attribute vec3 aDrift;
      uniform float uTime;
      varying float vAge;
      varying float vSeed;
      ${BILLBOARD_GLSL}
      void main() {
        vAge = fract(uTime / ${PLUME_PERIOD_S.toFixed(1)} + aSeed.w);
        vSeed = aSeed.w;
        float rise = 1.0 - (1.0 - vAge) * (1.0 - vAge);
        vec3 p = aOrigin + vec3(0.0, rise * aDrift.z, 0.0);
        p.xz += aDrift.xy * vAge + aSeed.xy * (40.0 + 260.0 * vAge);
        gl_Position = billboard(p, aSeed.z * (0.35 + 2.2 * sqrt(vAge)));
      }
    `,
    fragmentShader: `
      uniform float uNight;
      uniform vec3 uDark;
      uniform vec3 uLight;
      uniform vec3 uFire;
      uniform float uOpacity;
      varying float vAge;
      varying float vSeed;
      varying vec2 vUv;
      varying float vFade;
      ${NOISE_GLSL}
      void main() {
        vec2 q = vUv - 0.5;
        float r = length(q) * 2.0;
        float lumps = vfNoise(q * 5.0 + vSeed * 31.0) * 0.45 + 0.55;
        float alpha = (1.0 - smoothstep(0.35, 1.0, r)) * lumps;
        alpha *= smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge)) * uOpacity;
        // Moitié du brouillard seulement : un panache se lit plus loin que le versant qui le porte.
        alpha *= 0.5 + 0.5 * vFade;
        if (alpha < 0.004) discard;
        vec3 colour = mix(uDark, uLight, smoothstep(0.1, 0.8, vAge) * (1.0 - uNight * 0.7));
        // Le dessous du panache, la nuit, rougeoie de la lave qu'il surplombe.
        colour = mix(colour, uFire * 0.9, uNight * pow(1.0 - vAge, 4.0) * 0.85);
        gl_FragColor = vec4(colour, alpha);
      }
    `,
  });
  material.name = 'volcano-plume';
  return material;
}

/** Coulées : un ruban posé sur la pente, croûte sombre fendue de lave qui avance. */
export function createLavaMaterial(THREE, look) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: {
      ...fadeUniforms(),
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uCrust: { value: vec3Of(THREE, look.lava.crust) },
      uRed: { value: vec3Of(THREE, look.lava.red) },
      uOrange: { value: vec3Of(THREE, look.lava.orange) },
      uYellow: { value: vec3Of(THREE, look.lava.yellow) },
    },
    vertexShader: `
      attribute float aAlong;
      attribute float aSide;
      attribute float aLength;
      uniform float uFadeNear;
      uniform float uFadeFar;
      varying float vAlong;
      varying float vSide;
      varying float vLength;
      varying float vFade;
      void main() {
        vAlong = aAlong;
        vSide = aSide;
        vLength = aLength;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(mv.xyz));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uGlow;
      uniform vec3 uCrust;
      uniform vec3 uRed;
      uniform vec3 uOrange;
      uniform vec3 uYellow;
      varying float vAlong;
      varying float vSide;
      varying float vLength;
      varying float vFade;
      ${NOISE_GLSL}
      void main() {
        float t = vAlong / max(vLength, 1.0);
        float edge = abs(vSide);
        float flow = vfNoise(vec2(vAlong * 0.035 - uTime * 0.5, vSide * 2.2)) * 0.6
          + vfNoise(vec2(vAlong * 0.11 - uTime * 1.1, vSide * 5.0)) * 0.4;
        float heat = (1.0 - t * 0.8) * (1.0 - smoothstep(0.35, 1.0, edge));
        heat *= 0.45 + 0.85 * flow;
        vec3 colour = mix(uCrust, uRed, smoothstep(0.12, 0.35, heat));
        colour = mix(colour, uOrange, smoothstep(0.35, 0.6, heat));
        colour = mix(colour, uYellow, smoothstep(0.7, 0.95, heat));
        colour *= mix(1.0, uGlow, smoothstep(0.12, 0.4, heat));
        // Bords effilochés, et la langue qui s'amincit au front de la coulée.
        float alpha = (1.0 - smoothstep(0.7, 1.0, edge + flow * 0.25)) * (1.0 - smoothstep(0.92, 1.0, t)) * vFade;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(colour, alpha);
      }
    `,
  });
  material.name = 'volcano-lava';
  return material;
}

/** Ruban d'une coulée : deux sommets par point, attributs pour le shader. */
export function lavaRibbon(points, elevationAt, width = FLOW_WIDTH_M) {
  const positions = [];
  const along = [];
  const side = [];
  const index = [];
  const length = points.length ? points[points.length - 1].along : 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const norm = Math.hypot(dx, dz) || 1;
    const nx = -dz / norm;
    const nz = dx / norm;
    const t = length > 0 ? points[i].along / length : 0;
    // Étroite à la source, large sur le versant, en pointe au front.
    const half = width * 0.5 * (0.45 + 0.55 * Math.min(1, t * 4)) * (1 - 0.5 * t * t);
    for (const s of [-1, 1]) {
      const x = points[i].x + nx * half * s;
      const z = points[i].z + nz * half * s;
      const h = elevationAt(x, z);
      positions.push(x, (Number.isFinite(h) ? Math.max(h, points[i].h) : points[i].h) + FLOW_LIFT_M, z);
      along.push(points[i].along);
      side.push(s);
    }
    if (i > 0) {
      const k = (i - 1) * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  return { positions, along, side, index, length };
}

export class VolcanoFire {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} [options.theme]
   * @param {Array} [options.volcanoes] Volcans actifs (`core/volcanoes.js`).
   */
  constructor({ THREE, scene, theme = defaultTheme, volcanoes = ACTIVE_VOLCANOES }) {
    this.THREE = THREE;
    this.list = volcanoes;
    this.look = theme.volcanoes ?? defaultTheme.volcanoes;
    this.group = new THREE.Group();
    this.group.name = 'volcans';
    scene.add(this.group);
    this.materials = {
      lava: createLavaMaterial(THREE, this.look),
      sparks: createSparkMaterial(THREE, this.look),
      glow: createCraterGlowMaterial(THREE, this.look),
      plume: createPlumeMaterial(THREE, this.look),
    };
    this.meshes = [];
    this._time = 0;
    this.setNight(0);
  }

  /** Nombre de volcans à l'image. */
  get count() {
    return this._count ?? 0;
  }

  /**
   * Recompose les volcans autour de `here`, dans `radius`.
   * @param {Object} options
   * @param {Object} options.frame Repère local.
   * @param {{x:number, z:number}} options.here Centre de la nappe.
   * @param {number} options.radius Demi-côté de la nappe, en mètres.
   * @param {(x:number, z:number) => number} options.elevationAt Altitude affichée, `NaN` hors relief.
   */
  build({ frame, here, radius, elevationAt }) {
    this.clear();
    const volcanoes = [];
    for (const volcano of volcanoesWithin(frame, here, radius, this.list)) {
      const crater = craterSite(volcano, elevationAt);
      if (crater) volcanoes.push({ ...volcano, crater });
    }
    this._count = volcanoes.length;
    if (!volcanoes.length) return;

    for (const material of Object.values(this.materials)) {
      material.uniforms.uFadeNear.value = radius * FADE_START;
      material.uniforms.uFadeFar.value = radius * FADE_END;
    }
    this._buildLava(volcanoes, elevationAt);
    this._buildParticles('sparks', volcanoes, SPARKS_PER_VOLCANO, (v, i, put) => {
      const spread = 0.12 + 0.28 * volcanoRandom(v.id, i, 3);
      const angle = volcanoRandom(v.id, i, 4) * Math.PI * 2;
      const speed = SPARK_SPEED[0] + (SPARK_SPEED[1] - SPARK_SPEED[0]) * volcanoRandom(v.id, i, 5) * (0.5 + 0.5 * v.activity);
      // Quatre salves par période, chacune un peu étalée : des explosions, pas une fontaine continue.
      const phase = Math.floor(volcanoRandom(v.id, i, 6) * 4) / 4 + volcanoRandom(v.id, i, 7) * 0.05;
      const jitter = 25 * volcanoRandom(v.id, i, 8);
      put([v.crater.x + Math.cos(angle) * jitter, v.crater.h, v.crater.z + Math.sin(angle) * jitter],
        [Math.cos(angle) * spread, Math.sin(angle) * spread, speed, phase]);
    }, (v) => Math.round(SPARKS_PER_VOLCANO * (0.3 + 0.7 * v.activity)));
    this._buildParticles('glow', volcanoes, 2, (v, i, put) => {
      put([v.crater.x, v.crater.h + (i ? 60 : 25), v.crater.z],
        [i ? CRATER_HALO_M : CRATER_GLOW_M, 0, (i ? 0.45 : 1) * (0.5 + 0.5 * v.activity), volcanoRandom(v.id, i, 9)]);
    });
    const driftAngle = (v) => volcanoRandom(v.id, 0, 10) * Math.PI * 2;
    this._buildParticles('plume', volcanoes, PUFFS_PER_VOLCANO, (v, i, put) => {
      const a = volcanoRandom(v.id, i, 11) * Math.PI * 2;
      const r = volcanoRandom(v.id, i, 12);
      put([v.crater.x, v.crater.h + 40, v.crater.z],
        [Math.cos(a) * r, Math.sin(a) * r, PUFF_SIZE_M * (0.6 + 0.8 * volcanoRandom(v.id, i, 13)) * (0.5 + 0.5 * v.activity), (i + volcanoRandom(v.id, i, 14) * 0.8) / PUFFS_PER_VOLCANO],
        [Math.sin(driftAngle(v)) * 900, Math.cos(driftAngle(v)) * 900, PLUME_HEIGHT_M * (0.5 + 0.5 * v.activity)]);
    });
  }

  _buildLava(volcanoes, elevationAt) {
    const { THREE } = this;
    const positions = [];
    const along = [];
    const side = [];
    const lengths = [];
    const index = [];
    for (const v of volcanoes) {
      const flows = flowCount(v.activity);
      const first = volcanoRandom(v.id, 0, 1) * Math.PI * 2;
      for (let f = 0; f < flows; f++) {
        const heading = first + (f / flows) * Math.PI * 2 + (volcanoRandom(v.id, f, 2) - 0.5) * 0.8;
        const start = { x: v.crater.x + Math.sin(heading) * FLOW_SOURCE_M, z: v.crater.z + Math.cos(heading) * FLOW_SOURCE_M };
        const points = traceLavaFlow(start, heading, elevationAt, { maxM: FLOW_MAX_M * (0.4 + 0.6 * v.activity) });
        if (points.length < 4) continue;
        const ribbon = lavaRibbon(points, elevationAt);
        const offset = positions.length / 3;
        positions.push(...ribbon.positions);
        along.push(...ribbon.along);
        side.push(...ribbon.side);
        for (let k = 0; k < ribbon.along.length; k++) lengths.push(ribbon.length);
        for (const k of ribbon.index) index.push(k + offset);
      }
    }
    if (!index.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    geometry.setAttribute('aLength', new THREE.Float32BufferAttribute(lengths, 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.materials.lava);
    mesh.name = 'volcano-lava';
    mesh.renderOrder = 2;
    this._add(mesh);
  }

  /**
   * Panneaux instanciés : `fill(volcan, rang, put)` donne origine, tirage et
   * dérive de chaque instance ; `countOf(volcan)` en borne le nombre.
   */
  _buildParticles(kind, volcanoes, perVolcano, fill, countOf = () => perVolcano) {
    const { THREE } = this;
    const origins = [];
    const seeds = [];
    const drifts = [];
    for (const v of volcanoes) {
      const n = Math.min(perVolcano, countOf(v));
      for (let i = 0; i < n; i++) {
        fill(v, i, (origin, seed, drift = [0, 0, 0]) => {
          origins.push(...origin);
          seeds.push(...seed);
          drifts.push(...drift);
        });
      }
    }
    const count = origins.length / 3;
    if (!count) return;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quad.index);
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(new Float32Array(origins), 3));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
    geometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(new Float32Array(drifts), 3));
    geometry.instanceCount = count;
    const mesh = new THREE.Mesh(geometry, this.materials[kind]);
    mesh.name = `volcano-${kind}`;
    // Positions calculées dans le shader : la sphère englobante de la géométrie ne veut rien dire.
    mesh.frustumCulled = false;
    // Après le reste, comme les halos ; la fumée par-dessus le feu qu'elle voile.
    mesh.renderOrder = kind === 'plume' ? 9 : 8;
    this._add(mesh);
  }

  _add(mesh) {
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  /** Retire tous les volcans de l'image. */
  clear() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
    this._count = 0;
  }

  /** @param {number} delta Secondes écoulées. */
  advance(delta) {
    if (!this.meshes.length || !Number.isFinite(delta)) return;
    // Bouclé sur une longue période commune : la précision du flottant du shader tient.
    this._time = (this._time + delta) % (SPARK_PERIOD_S * PLUME_PERIOD_S * 4);
    for (const material of Object.values(this.materials)) material.uniforms.uTime.value = this._time;
  }

  /** @param {number} mix 0 en plein jour, 1 en pleine nuit. */
  setNight(mix) {
    const night = Math.min(1, Math.max(0, Number(mix) || 0));
    const glow = this.look.day + (this.look.night - this.look.day) * night;
    this.materials.lava.uniforms.uGlow.value = glow;
    this.materials.sparks.uniforms.uGlow.value = glow;
    this.materials.glow.uniforms.uGlow.value = glow * (0.35 + 0.65 * night);
    this.materials.plume.uniforms.uNight.value = night;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
