/*
 * lifeLayer — ce qui bouge.
 * -------------------------
 * Tout le reste du décor est reconstruit tous les 250 mètres parcourus et
 * immobile entre deux reconstructions : c'est ce qui le rend abordable, et c'est
 * aussi ce qui lui donne son aspect de maquette. Une campagne juste mais
 * parfaitement figée se lit comme une photographie en volume.
 *
 * Cette couche porte donc le peu qui doit être animé **par image**, et
 * uniquement lui :
 *
 * - des **oiseaux**, qui dérivent haut au-dessus de l'observateur, tous dans
 *   le sens du vent (`setWindDirection`) ;
 * - la **fumée** des cheminées, publiée par `furnitureLayer.chimneys`.
 *
 * ## Pourquoi si peu d'objets
 *
 * Parce que l'animation coûte une écriture de matrice par image et par objet,
 * là où le mobilier n'en coûte qu'une par reconstruction. Vingt oiseaux et cent
 * bouffées de fumée, ce sont cent vingt matrices par image : négligeable. Deux
 * mille brins d'herbe animés, ce serait la moitié du budget d'une image — d'où
 * le vent de `groundCover`, qui vit entièrement dans un shader.
 *
 * ## Pourquoi les oiseaux ne sont pas attachés au sol
 *
 * Ils suivent l'observateur, et c'est assumé. Un vol d'oiseaux ancré au monde
 * serait dépassé en dix secondes à trente kilomètres par heure, et il faudrait
 * en semer partout pour qu'il en reste un dans le champ. Ce qu'on cherche n'est
 * pas la position d'un oiseau — personne ne peut la vérifier —, c'est du
 * mouvement dans un ciel autrement vide.
 */

import { defaultTheme } from '../themes/default.js';

/** Oiseaux dans le vol. */
export const BIRD_COUNT = 22;
/**
 * Hauteur et rayon du vol.
 *
 * Ils étaient calibrés pour des rapaces : quarante-cinq à cent quinze mètres de
 * haut, jusqu'à deux cents mètres de rayon. À ces distances-là un oiseau fait un
 * pixel et demi — le vol existait, mais on ne le *voyait* pas, ce qui est la
 * seule chose qu'on lui demande. Il est donc descendu à la hauteur d'un vol de
 * corvidés au-dessus d'un champ, et son envergure a suivi : ce qui est plus
 * près paraît plus grand, mais pas assez.
 */
export const BIRD_HEIGHT_MIN = 16;
export const BIRD_HEIGHT_MAX = 52;
/**
 * Demi-côté de la boîte dans laquelle les oiseaux dérivent, en mètres — même
 * principe que `precipitation.js` et `debris.js` : une boîte attachée à
 * l'observateur, où chaque oiseau se replie en boucle plutôt que de s'éloigner
 * indéfiniment dans le vent.
 */
export const BIRD_SPREAD_M = 95;
/** Vitesse de dérive le long du vent, en mètres par seconde. */
export const BIRD_SPEED_MIN = 3;
export const BIRD_SPEED_MAX = 9;
/** Envergure d'un oiseau, en mètres (la géométrie mesure 1 de large). */
export const BIRD_SPAN_M = 1.15;
/** Battement d'ailes : cycles par seconde. */
export const BIRD_FLAP_HZ = 2.6;

/** Bouffées de fumée entretenues par cheminée. */
export const PUFF_PER_CHIMNEY = 9;
/** Cheminées animées au plus — les plus proches d'abord. */
export const SMOKE_MAX_CHIMNEYS = 6;
/** Durée de vie d'une bouffée, en secondes. */
export const PUFF_LIFE_S = 5.5;
/** Vitesse d'ascension et dérive au vent, en mètres par seconde. */
export const PUFF_RISE_MS = 1.15;
export const PUFF_DRIFT_MS = 0.75;

/**
 * Silhouette d'oiseau : deux ailes en V, vues de dessous.
 *
 * Deux triangles. C'est un choix, pas une économie : à cinquante mètres et
 * au-dessus du regard, un oiseau *est* une paire d'ailes en mouvement, et rien
 * d'autre n'y est perceptible. Les ailes battent par mise à l'échelle sur l'axe
 * transversal, ce qui ne demande aucune géométrie supplémentaire.
 *
 * Le repère : l'oiseau vole vers +Z, les ailes s'étendent sur X, et le dièdre
 * est porté par Y.
 */
export function createBirdGeometry(THREE) {
  const positions = new Float32Array([
    // Aile gauche : emplanture, bout d'aile relevé, bord de fuite.
    0, 0, 0.12, -0.5, 0.14, -0.06, 0, 0, -0.14,
    // Aile droite.
    0, 0, 0.12, 0, 0, -0.14, 0.5, 0.14, -0.06,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.name = 'bird';
  return geometry;
}

/** Repli en boucle dans `[-spread, spread]`, sans le saut que ferait `%` sur un négatif. */
function wrap(v, spread) {
  return (((v + spread) % (spread * 2)) + spread * 2) % (spread * 2) - spread;
}

/**
 * Position d'un oiseau à un instant donné. Fonction pure.
 *
 * Ils ne tournent plus : ils dérivent le long du vent, tous dans le même cap —
 * « un oiseau ne vole pas contre le vent pour le plaisir » —, et se replient en
 * boucle dans une boîte centrée sur l'observateur quand ils en sortent, comme
 * la pluie et les débris (voir `precipitation.js`). Chaque oiseau garde sa
 * propre origine dans la boîte, sa propre vitesse et sa propre phase, tirées
 * une fois pour toutes : deux oiseaux ne sont donc jamais synchrones — la seule
 * chose qui trahirait immédiatement un vol procédural.
 *
 * @param {Object} bird  Paramètres propres à l'oiseau (voir le constructeur).
 * @param {number} time  Secondes écoulées.
 * @param {{x:number,y:number,z:number}} centre Position de l'observateur.
 * @param {number} windDirection Direction du vent, en radians
 *        (`weather.windDirection`) — le cap de vol, commun à tout le vol.
 * @returns {{x:number,y:number,z:number,heading:number,flap:number}}
 */
export function birdAt(bird, time, centre, windDirection = 0) {
  const dx = Math.cos(windDirection);
  const dz = Math.sin(windDirection);
  const travel = time * bird.speed;
  const x = centre.x + wrap(bird.baseX + dx * travel, BIRD_SPREAD_M);
  const z = centre.z + wrap(bird.baseZ + dz * travel, BIRD_SPREAD_M);
  // Altitude fixe, sans ondulation : chaque oiseau vole à plat, à sa propre
  // hauteur.
  const y = centre.y + bird.height;
  return {
    x,
    y,
    z,
    // Le cap est celui du vent, le même pour tout le vol : `+Z` de la
    // silhouette doit s'y aligner, d'où l'ordre des arguments.
    heading: Math.atan2(dx, dz),
    // Battement : jamais symétrique, l'aile remonte plus vite qu'elle descend.
    flap: 0.35 + 0.65 * Math.abs(Math.sin(time * Math.PI * BIRD_FLAP_HZ * bird.beat + bird.phase)),
  };
}

/** Tirage déterministe dans [0, 1[ à partir d'un entier. Fonction pure. */
function draw(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class LifeLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.time = 0;
    this._night = 0;
    this._windDirection = 0;

    this.group = new THREE.Group();
    this.group.name = 'life';
    scene.add(this.group);

    // --- Oiseaux ------------------------------------------------------------
    this.birdGeometry = createBirdGeometry(THREE);
    this.birdMaterial = new THREE.MeshBasicMaterial({
      // Un oiseau vu d'en dessous est une silhouette : il est plus sombre que
      // le ciel quelle que soit l'heure, et un éclairage lambertien ne lui
      // apporterait rien qu'on puisse voir.
      color: theme.life.bird,
      side: THREE.DoubleSide,
      // Pas de brouillard : à cent mètres au-dessus de l'observateur ils seraient
      // effacés par une brume calibrée pour l'horizon, pas pour le ciel.
      fog: false,
      transparent: true,
      opacity: 0.85,
    });
    this.birdMaterial.name = 'bird';
    this.birds = new THREE.InstancedMesh(this.birdGeometry, this.birdMaterial, BIRD_COUNT);
    this.birds.name = 'birds';
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    // Aucun oiseau tant que la première image n'a pas placé les matrices :
    // sinon le vol apparaît empilé à l'origine de la scène le temps d'une image.
    this.birds.count = 0;
    this.group.add(this.birds);

    this._flock = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
      const a = draw(i * 7 + 1);
      const b = draw(i * 13 + 2);
      const c = draw(i * 19 + 3);
      this._flock.push({
        // Origine dans la boîte de dérive — voir `BIRD_SPREAD_M`.
        baseX: (draw(i * 41 + 8) * 2 - 1) * BIRD_SPREAD_M,
        baseZ: (draw(i * 43 + 9) * 2 - 1) * BIRD_SPREAD_M,
        height: BIRD_HEIGHT_MIN + a * (BIRD_HEIGHT_MAX - BIRD_HEIGHT_MIN),
        speed: BIRD_SPEED_MIN + b * (BIRD_SPEED_MAX - BIRD_SPEED_MIN),
        phase: draw(i * 29 + 5) * Math.PI * 2,
        beat: 0.75 + draw(i * 31 + 6) * 0.5,
        scale: BIRD_SPAN_M * (0.85 + c * 0.6),
      });
    }

    // --- Fumée --------------------------------------------------------------
    this.smokeGeometry = new THREE.PlaneGeometry(1, 1);
    this.smokeMaterial = createSmokeMaterial(THREE, theme.life.smoke);
    this.smoke = new THREE.InstancedMesh(
      this.smokeGeometry,
      this.smokeMaterial,
      SMOKE_MAX_CHIMNEYS * PUFF_PER_CHIMNEY
    );
    this.smoke.name = 'chimney-smoke';
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.group.add(this.smoke);

    /** @type {Array<{x:number,y:number,z:number}>} cheminées retenues. */
    this._chimneys = [];

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  /**
   * Retient les cheminées à animer : les plus proches de l'observateur, et pas plus
   * que le maillage n'en porte. Une ferme à huit cents mètres derrière le
   * brouillard n'a pas besoin de fumer.
   *
   * @param {Array<{x:number,y:number,z:number}>} chimneys
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   */
  setChimneys(chimneys, here) {
    if (this.disposed) return;
    const list = Array.isArray(chimneys) ? chimneys.slice() : [];
    list.sort(
      (a, b) =>
        Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z)
    );
    this._chimneys = list.slice(0, SMOKE_MAX_CHIMNEYS);
  }

  /**
   * Règle le cap du vol : les oiseaux ne vont que dans le sens du vent.
   * @param {number} direction Direction du vent, en radians (`weather.windDirection`).
   */
  setWindDirection(direction) {
    this._windDirection = Number.isFinite(direction) ? direction : 0;
  }

  /**
   * Règle l'ambiance nocturne : les oiseaux se posent, la fumée s'assombrit.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    this._night = Math.min(1, Math.max(0, Number(mix) || 0));
    // Les oiseaux ne volent pas la nuit, et un vol en silhouette sur un ciel
    // sombre ne se verrait de toute façon pas.
    this.birds.visible = this._night < 0.45;
    this.smokeMaterial.uniforms.uTint.value = 0.55 + (1 - this._night) * 0.45;
  }

  /**
   * Avance l'animation d'une image.
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,y:number,z:number}} at Point observé, dans la scène :
   *        les oiseaux tournent autour de lui. C'est l'application qui le
   *        fournit — le décor ne sait pas ce qui l'occupe.
   */
  advance(delta, at) {
    if (this.disposed || !Number.isFinite(delta) || !at) return;
    // Remis dans une plage courte : un temps qui croît indéfiniment finit par
    // perdre sa précision, et les orbites se mettent à saccader.
    this.time = (this.time + delta) % 3600;
    this._advanceBirds(at);
    this._advanceSmoke();
  }

  _advanceBirds(at) {
    if (!this.birds.visible) return;
    const centre = { x: at.x, y: at.y, z: at.z };

    this._flock.forEach((bird, index) => {
      const at = birdAt(bird, this.time, centre, this._windDirection);
      this._position.set(at.x, at.y, at.z);
      this._euler.set(0, at.heading, 0);
      this._quaternion.setFromEuler(this._euler);
      // L'envergure porte le battement, la longueur non : c'est l'aile qui bat.
      this._scale.set(bird.scale * at.flap, bird.scale, bird.scale);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.birds.setMatrixAt(index, this._matrix);
    });

    this.birds.count = this._flock.length;
    this.birds.instanceMatrix.needsUpdate = true;
  }

  _advanceSmoke() {
    const chimneys = this._chimneys;
    if (chimneys.length === 0) {
      this.smoke.count = 0;
      return;
    }

    let index = 0;
    for (let c = 0; c < chimneys.length; c++) {
      const source = chimneys[c];
      // Décalage propre à la cheminée : deux colonnes de fumée synchrones se
      // repèrent instantanément.
      const offset = draw(c * 41 + 11) * PUFF_LIFE_S;

      for (let p = 0; p < PUFF_PER_CHIMNEY; p++) {
        // Chaque bouffée occupe une tranche de la durée de vie : la colonne est
        // continue, et une bouffée qui meurt en haut réapparaît en bas.
        const age = (this.time + offset + (p / PUFF_PER_CHIMNEY) * PUFF_LIFE_S) % PUFF_LIFE_S;
        const t = age / PUFF_LIFE_S;
        const wander = draw(c * 53 + p * 7 + 13) - 0.5;

        this._position.set(
          source.x + PUFF_DRIFT_MS * age + wander * age * 0.5,
          source.y + PUFF_RISE_MS * age,
          source.z + PUFF_DRIFT_MS * age * 0.4 + wander * age * 0.35
        );
        this._quaternion.identity();
        // La bouffée grossit en se diluant : c'est la seule chose qui fait lire
        // « fumée » plutôt que « chapelet de boules ».
        const size = 0.7 + t * 3.4;
        this._scale.setScalar(size);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.smoke.setMatrixAt(index, this._matrix);
        index++;
      }
    }

    this.smoke.count = index;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.birds);
    this.group.remove(this.smoke);
    this.birds.dispose?.();
    this.smoke.dispose?.();
    this.birdGeometry.dispose();
    this.birdMaterial.dispose();
    this.smokeGeometry.dispose();
    this.smokeMaterial.dispose();
    this._chimneys = [];
    this.scene.remove(this.group);
  }
}

/**
 * Matériau des bouffées de fumée : panneau face caméra, dégradé radial calculé.
 *
 * L'opacité décroît avec la **taille** de l'instance plutôt qu'avec un âge
 * passé en attribut : la taille est déjà dans la matrice, elle y est lisible, et
 * ça évite un second tampon d'instance à tenir à jour. Une bouffée qui grossit
 * est une bouffée qui se dilue — la relation est physique, pas un raccourci.
 */
function createSmokeMaterial(THREE, tint) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Même raison que pour le halo des lampadaires : le panneau est dressé dans
    // l'espace de la vue, son enroulement dépend donc de la projection.
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTint: { value: 1 },
      uSmoke: { value: new THREE.Vector3(...tint) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vSize;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vSize = length(instanceMatrix[0].xyz);
        #else
          vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vSize = 1.0;
        #endif
        centre.xy += position.xy * vSize;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: `
      uniform float uTint;
      uniform vec3 uSmoke;
      varying vec2 vUv;
      varying float vSize;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float falloff = pow(max(0.0, 1.0 - r), 1.8);
        // Une bouffée jeune est dense et petite ; à quatre mètres elle n'est
        // plus qu'un voile.
        float density = clamp(1.25 - vSize * 0.3, 0.0, 1.0);
        float alpha = falloff * density * 0.42;
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(uSmoke * uTint, alpha);
      }
    `,
  });
  material.name = 'chimney-smoke';
  return material;
}
