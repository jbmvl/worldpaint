/*
 * debris — feuilles et brins arrachés par le vent, dans une boîte qui suit
 * l'observateur.
 * -----------------------------------------------------------------------------
 * Même construction que `precipitation.js`, pour la même raison : un détail
 * qui n'existe que devant les yeux n'a pas besoin d'exister à l'échelle du
 * paysage. Une boîte de quelques dizaines de mètres, attachée à la caméra,
 * contient toutes les particules, et chacune y dérive en boucle — horizontale
 * ici, puisque rien ne tombe : ça vole ou ça traîne au sol.
 *
 * **Un seul champ pilote tout : `weather.wind`.** Pas de vent faible/fort à
 * seuils nets : `lift` (0 au sol, 1 pleinement emporté) est une transition
 * continue, sinon le passage d'un état à l'autre se voit comme un décrochage.
 * Au sol, une particule ne fait que frémir sur place ; en l'air, elle dérive
 * et tournoie avec le vent.
 *
 * **Éteint dès qu'il pleut ou qu'il neige** : `precipitation.js` porte déjà
 * l'eau, et une feuille qui vole dans une averse ne se lit pas, elle brouille.
 *
 * **Un point, pas une géométrie orientée.** La demande était explicite : « un
 * point/losange suffit ». Le fragment shader dessine un losange (norme L1)
 * plutôt qu'un disque — c'est ce qui le distingue de la neige à l'œil, sans
 * ajouter une seule géométrie.
 */

import { windAxis } from './weather.js';

const SPREAD_M = 20;
/** Hauteur maximale atteinte pleinement emporté, en mètres. */
const HEIGHT_M = 3.2;
/** Nombre maximal de particules. Volontairement modeste : « quelques ». */
const MAX_DEBRIS = 900;

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

function debrisGeometry(THREE) {
  const random = seeded(0xc2b2ae35);
  const base = new Float32Array(MAX_DEBRIS * 3);
  const phase = new Float32Array(MAX_DEBRIS);

  for (let i = 0; i < MAX_DEBRIS; i++) {
    base[i * 3] = (random() * 2 - 1) * SPREAD_M;
    // Proclivité à s'envoler, propre à chaque particule : à `lift` égal,
    // certaines montent plus haut que d'autres — sans ça, un vent fort
    // soulèverait toutes les feuilles à exactement la même hauteur, ce qui
    // se lit comme une nappe plutôt qu'un tourbillon.
    base[i * 3 + 1] = random();
    base[i * 3 + 2] = (random() * 2 - 1) * SPREAD_M;
    phase[i] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.length), 3));
  geometry.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  return geometry;
}

function debrisMaterial(THREE) {
  const uniforms = {
    uTime: { value: 0 },
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
    vertexShader: `
      attribute vec3 aBase;
      attribute float aPhase;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uLift;

      void main() {
        // Frémissement au sol, amplitude de vol en l'air : la même formule
        // mélangée par lift, pas deux branches — c'est ce qui rend la
        // transition continue.
        float settle = sin(uTime * 1.3 + aPhase) * 0.05;
        float airborne = aBase.y * ${HEIGHT_M.toFixed(1)} * (0.5 + 0.5 * sin(uTime * 0.4 + aPhase));
        float y = mix(settle, airborne, uLift);

        // Dérive horizontale le long du vent, repliée en boucle dans la
        // boîte — même principe que la chute verticale de la pluie, sur
        // l'axe qui a du sens ici : rien ne tombe, ça se déplace au sol.
        float speed = mix(0.1, 1.0, uLift);
        float wx = mod(aBase.x + uWind.x * uTime * speed + ${SPREAD_M.toFixed(1)}, ${(2 * SPREAD_M).toFixed(1)}) - ${SPREAD_M.toFixed(1)};
        float wz = mod(aBase.z + uWind.y * uTime * speed + ${SPREAD_M.toFixed(1)}, ${(2 * SPREAD_M).toFixed(1)}) - ${SPREAD_M.toFixed(1)};

        // Tournoiement, nul au sol, marqué en l'air.
        float swirl = uLift * 0.5;
        vec3 p = vec3(
          wx + sin(uTime * 0.9 + aPhase * 1.7) * swirl,
          y,
          wz + cos(uTime * 0.8 + aPhase * 2.1) * swirl
        );

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Taille en perspective, comme la neige — mais un peu plus grand :
        // une feuille se voit plus qu'un flocon à distance égale.
        gl_PointSize = clamp(70.0 / max(-mv.z, 1.0), 1.5, 8.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      void main() {
        // Losange (norme L1) plutôt que disque : c'est ce qui le distingue
        // de la neige à l'œil, sans géométrie orientée.
        vec2 pc = gl_PointCoord - vec2(0.5);
        float d = abs(pc.x) + abs(pc.y);
        float alpha = smoothstep(0.5, 0.3, d);
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(uTint, uOpacity * alpha);
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
   *        référence — la teinte du feuillage du thème courant, pas une
   *        couleur inventée ici : ce module ne connaît pas la direction
   *        artistique de l'application, voir `sceneEnvironment.js`.
   */
  constructor({ THREE, scene, tint = [0.3, 0.42, 0.2] }) {
    this.THREE = THREE;
    this.scene = scene;

    const { material, uniforms } = debrisMaterial(THREE);
    this.uniforms = uniforms;
    this.uniforms.uTint.value.setRGB(tint[0], tint[1], tint[2]);

    this.points = new THREE.Points(debrisGeometry(THREE), material);
    this.points.name = 'debris';
    // La boîte est recentrée à chaque image sur la caméra — la culler sur une
    // sphère calculée à l'origine la ferait disparaître dès qu'on s'en éloigne.
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
    // La pluie et la neige portent déjà l'eau : une feuille qui vole dans une
    // averse ne se lirait pas, elle brouillerait le rendu de la pluie.
    const active = weather.precipitation <= 0 && weather.wind > 0;
    this.points.visible = active;
    if (!active) return;

    // Racine carrée, comme l'intensité de la pluie : le compte visible croît
    // plus vite que l'impression de vent, sinon la moitié de la course de la
    // réglette ne se voit pas.
    const count = Math.round(MAX_DEBRIS * Math.sqrt(weather.wind));
    this.points.geometry.setDrawRange(0, count);

    // Transition douce entre « au sol » et « emporté » — voir l'en-tête. Le
    // seuil bas (0.3) est volontairement au-dessus de la brise ordinaire du
    // temps par défaut (0.25) : à vent faible ou ordinaire, `lift` doit valoir
    // exactement 0, sinon une particule reste visiblement soulevée en l'air
    // sans qu'aucun vent notable ne le justifie à l'œil.
    this.uniforms.uLift.value = this.THREE.MathUtils.smoothstep(weather.wind, 0.3, 0.8);
    // Même diagonale de référence que la pluie et la neige, pivotée par la
    // même direction — voir `windAxis` dans `weather.js`.
    const [wx, wz] = windAxis([weather.wind * 2.6, weather.wind * 1.1], weather);
    this.uniforms.uWind.value.set(wx, wz);
    this.uniforms.uOpacity.value = 0.35 + weather.wind * 0.35;
  }

  /** Teinte des particules — voir `Precipitation.setTint`, même raison. */
  setTint(color) {
    this.uniforms.uTint.value.setRGB(color.r, color.g, color.b);
  }

  /** Fait dériver. À appeler une fois par image, avec le delta en secondes. */
  advance(delta) {
    if (!Number.isFinite(delta)) return;
    this.uniforms.uTime.value = (this.uniforms.uTime.value + delta) % 3600;
  }

  /**
   * Recentre la boîte au sol, sous l'observateur.
   *
   * @param {{x:number,y:number,z:number}} position Un point **au niveau du
   *        sol**, pas la position de la caméra elle-même : ce module ajoute
   *        au plus `HEIGHT_M` par-dessus `position.y`, donc lui passer la
   *        hauteur des yeux ferait flotter les feuilles en l'air, à hauteur
   *        de caméra — vu une fois, ça ne se voit pas comme une brise, ça se
   *        voit comme un bug. Trouver ce niveau de sol (par exemple en
   *        lançant un rayon vers le bas sur le terrain) est à
   *        l'application : ce module n'a pas connaissance du relief.
   *
   *        `x` et `z` se recentrent sur une maille du monde, pas en continu —
   *        même raison que `Precipitation.follow` : sans ça, les feuilles
   *        collées à la caméra ne défilent jamais, et se lisent comme un
   *        artefact d'écran plutôt que comme des objets de la scène.
   */
  follow(position) {
    const step = SPREAD_M / 3;
    const x = Math.round(position.x / step) * step;
    const z = Math.round(position.z / step) * step;
    this.points.position.set(x, position.y, z);
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
