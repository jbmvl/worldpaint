/*
 * precipitation — la pluie et la neige, dans une boîte qui suit l'observateur.
 * -----------------------------------------------------------------------------
 * Une averse n'a pas besoin d'exister ailleurs que devant les yeux. On ne
 * simule donc rien à l'échelle du paysage : une boîte de quelques dizaines de
 * mètres, attachée à la caméra, contient toutes les gouttes, et chacune y
 * retombe en boucle. C'est la façon de faire des jeux depuis toujours, pour la
 * raison qui la rend juste : au-delà de cette distance, une goutte fait moins
 * d'un pixel.
 *
 * **Tout le mouvement est dans le sommet.** Un seul uniforme de temps avance
 * par image ; aucune position n'est réécrite depuis le CPU. C'est ce qui permet
 * plusieurs milliers de gouttes sans budget d'animation, et c'est le même
 * principe que le vent du feuillage (`foliageMaterial`).
 *
 * **L'intensité ne change pas la taille du tampon, seulement ce qu'on en tire.**
 * Les positions sont allouées une fois pour le maximum, et `setDrawRange` décide
 * combien de gouttes tombent réellement. Faire varier la géométrie ferait
 * réallouer un buffer GPU chaque fois que la pluie forcit.
 *
 * **Les positions sont tirées d'un générateur graine, pas de `Math.random`.**
 * L'invariant de déterminisme du projet vise le paysage, pas l'atmosphère — une
 * goutte n'est pas un arbre, elle ne se retrouve pas au même endroit d'une
 * visite à l'autre et personne ne le remarquerait. Mais un semis reproductible
 * ne coûte rien ici et évite d'avoir à se demander, plus tard, si ce
 * `Math.random()` là est celui qui casse la règle.
 *
 * Ce que ça ne fait pas, délibérément : les gouttes ne sont pas éclairées, ne
 * reçoivent pas le brouillard de la scène (la boîte est cent fois plus courte
 * que sa portée) et ne rebondissent nulle part. Elles sont teintées par
 * `setTint`, que l'ambiance appelle pour qu'une averse de nuit soit sombre.
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

/**
 * Générateur graine, façon mulberry32. Tiré d'une constante et non de l'horloge :
 * deux montages successifs sèment la même averse, ce qui rend un écart de rendu
 * reproductible.
 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deux sommets par goutte : la tête et la queue du filet. Ils partagent la même
 * position de base — sans quoi la queue franchirait le haut de la boîte une
 * image avant la tête, et le filet se retournerait d'un bout à l'autre du ciel.
 * `aTail` dit lequel des deux on est.
 */
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
  // `position` doit exister : three s'en sert pour la sphère englobante et pour
  // le nombre de sommets. On la laisse nulle, le shader n'en lit rien.
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

/**
 * Chute en boucle, commune aux deux formes : la goutte descend de `uSpeed`
 * mètres par seconde et réapparaît en haut. Le modulo est pris sur la hauteur de
 * la boîte, donc la boucle est invisible tant que la boîte dépasse du champ.
 */
const FALL_CHUNK = `
  float fallHeight(vec3 base, float time, float speed, float height) {
    return mod(base.y - time * speed, height) - height * 0.35;
  }
`;

function rainMaterial(THREE, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    // Une goutte ne cache pas ce qu'il y a derrière et n'a pas d'ordre entre
    // gouttes : écrire la profondeur ferait clignoter le filet suivant.
    depthWrite: false,
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
        // Le filet est tiré vers l'amont de la chute : c'est l'inclinaison, et
        // elle seule, qui dit qu'il y a du vent. Les têtes, elles, ne dérivent
        // pas — la boîte suit la caméra, et un déplacement horizontal d'ensemble
        // ne se lit pas contre un décor qui défile.
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
        // Le flottement est ce qui distingue un flocon d'une goutte lente : deux
        // ondes déphasées par flocon, d'amplitude croissante avec le vent.
        float flutter = 0.35 + length(uWind) * 0.9;
        vec3 p = vec3(
          aBase.x + sin(uTime * 0.7 + aPhase) * flutter + uWind.x * 2.0,
          y,
          aBase.z + cos(uTime * 0.55 + aPhase * 1.7) * flutter + uWind.y * 2.0
        );
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Taille en perspective : un flocon proche est gros, un flocon lointain
        // tient dans un pixel. Sans ça, la neige forme un voile uniforme.
        gl_PointSize = clamp(90.0 / max(-mv.z, 1.0), 1.0, 9.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      void main() {
        // Disque adouci calculé dans le fragment : pas de texture à charger,
        // et le bord ne crénelle pas comme le ferait un carré.
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
    // La boîte est recentrée à chaque image sur la caméra : la culler sur une
    // sphère calculée à l'origine la ferait disparaître dès qu'on s'en éloigne.
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
    // Racine carrée : le compte de gouttes visibles croît beaucoup plus vite que
    // l'impression de pluie. Linéaire, une averse à mi-course paraissait déjà
    // maximale et le reste de la course ne se voyait plus.
    const count = Math.round(max * Math.sqrt(intensity));
    mesh.geometry.setDrawRange(0, snowing ? count : count * 2);

    // Le vent penche la pluie et emporte la neige, selon `weather.windDirection`.
    const drift = weather.wind * (snowing ? 2.2 : 1.1);
    const [wx, wz] = windAxis([drift * 0.85, drift * 0.35], weather);
    this.uniforms.uWind.value.set(wx, wz);
    // Une averse portée par le vent tombe plus vite : la composante horizontale
    // s'ajoute à la verticale.
    this.uniforms.uSpeed.value =
      (snowing ? SNOW_SPEED : RAIN_SPEED) * (1 + weather.wind * (snowing ? 0.4 : 0.5));
    this.uniforms.uOpacity.value = snowing
      ? 0.35 + intensity * 0.5
      : 0.16 + intensity * 0.28;
  }

  /**
   * Teinte des gouttes. C'est l'ambiance qui la donne : sous un orage la pluie
   * est grise, de nuit elle est presque éteinte, et une averse restée blanche
   * dans une scène nocturne se lit comme un défaut d'affichage.
   *
   * @param {{r:number,g:number,b:number}} color
   */
  setTint(color) {
    this.uniforms.uTint.value.setRGB(color.r, color.g, color.b);
  }

  /** Fait tomber. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    if (!Number.isFinite(delta)) return;
    // Remis dans une plage courte : le shader travaille en float32, et un temps
    // qui croît indéfiniment finit par faire saccader la chute. La période est
    // choisie multiple de la hauteur de boîte sur la vitesse la plus lente pour
    // que le repli ne se voie pas.
    this.uniforms.uTime.value = (this.uniforms.uTime.value + delta) % 3600;
  }

  /**
   * Recentre la boîte à proximité de l'observateur — sans jamais la coller
   * exactement dessus.
   *
   * Une boîte qui suit la position exacte de la caméra à chaque image se lit
   * comme un rideau plaqué à l'écran : rien à l'intérieur ne défile jamais
   * par rapport au regard, seule la chute verticale bouge. En la recentrant
   * sur une maille du monde — même principe que la grille des repères
   * d'horizon dans `furnitureLayer` — la boîte reste fixe entre deux pas, et
   * l'observateur la traverse comme il traverserait un vrai volume de pluie :
   * les gouttes proches défilent plus vite que les lointaines, ce qui est la
   * parallaxe qui manquait. Le pas est un tiers du rayon de la boîte : assez
   * fin pour que l'observateur n'en sorte jamais vraiment, assez grossier
   * pour que le défilement se sente.
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
