/*
 * lifeLayer — ce qui bouge dans le ciel.
 * --------------------------------------
 * Tout le reste du décor est reconstruit tous les 250 mètres parcourus et
 * immobile entre deux reconstructions : c'est ce qui le rend abordable, et c'est
 * aussi ce qui lui donne son aspect de maquette. Une campagne juste mais
 * parfaitement figée se lit comme une photographie en volume.
 *
 * Cette couche porte ce qui doit être animé **par image** et qui n'a pas de
 * place au sol :
 *
 * - des **oiseaux**, qui dérivent haut au-dessus de l'observateur, tous dans
 *   le sens du vent (`setWindDirection`) — un corvidé partout, un rapace qui
 *   tourne en rond au-dessus d'un relief de montagne ou de rebord venteux
 *   (`setRelief`, `RAPTOR_SLOPE_THRESHOLD`, `RAPTOR_ELEVATION_M`) ;
 * - des **montgolfières**, plus haut et bien plus lentement, chacune avec ses
 *   deux couleurs propres ;
 * - la **fumée** des cheminées, publiée par `furnitureLayer.chimneys`.
 *
 * Les bêtes ont leur propre couche (`faunaLayer`), et pas par commodité : un
 * oiseau suit l'observateur et personne ne peut le vérifier, une vache est
 * dans un pré et tout le monde peut le vérifier. Voir plus bas.
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
 * mouvement dans un ciel autrement vide. Une montgolfière suit le même
 * principe, à son échelle : quelques-unes, hautes, lentes, jamais instanciées
 * — chacune porte ses deux couleurs propres, ce qu'un `InstancedMesh`
 * partagé ne sait pas faire sans un second tampon de teinte, et leur nombre
 * ne le justifie pas.
 */

import { defaultTheme } from '../themes/default.js';
import { Kit } from '../models/kit.js';

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

/**
 * Seuils de relief (`core/landscape.js`) au-delà desquels le corvidé cède la
 * place au rapace. La pente capture aussi bien un versant alpin qu'un rebord
 * côtier venteux ; l'altitude rattrape un plateau d'altitude à pente douce.
 * Ce n'est pas la région qui décide : elle ne connaît ni l'une ni l'autre
 * (voir `core/region.js`).
 */
export const RAPTOR_SLOPE_THRESHOLD = 0.12;
export const RAPTOR_ELEVATION_M = 900;

/**
 * Rayon de la boîte où se dispersent les centres d'orbite, en mètres. Plus
 * serré que `BIRD_SPREAD_M` : un rapace qui tourne doit rester dans le champ,
 * là où un corvidé qui dérive traverse simplement le ciel.
 */
export const RAPTOR_SPREAD_M = 80;
/** Hauteur d'orbite, en mètres au-dessus de l'observateur. */
export const RAPTOR_HEIGHT_MIN = 30;
export const RAPTOR_HEIGHT_MAX = 70;
/** Rayon d'orbite, en mètres. */
export const RAPTOR_ORBIT_MIN_M = 22;
export const RAPTOR_ORBIT_MAX_M = 50;
/** Vitesse angulaire, en radians par seconde — un tour complet en une à deux minutes. */
export const RAPTOR_ANGULAR_SPEED_MIN = 0.09;
export const RAPTOR_ANGULAR_SPEED_MAX = 0.16;
/** Envergure, en mètres — un rapace plane avec de bien plus grandes ailes qu'un corvidé. */
export const RAPTOR_SPAN_M = 1.9;
/** Fréquence du frémissement des ailes en vol plané, cycles par seconde — bien plus lente qu'un battement. */
export const RAPTOR_FLAP_HZ = 0.35;
/** Amplitude et fréquence du gain d'altitude porté par une ascendance thermique. */
export const RAPTOR_BOB_M = 5;
export const RAPTOR_BOB_HZ = 0.05;

/**
 * Silhouette de rapace : ailes larges et peu coudées — un vol plané, pas un
 * battement —, queue en éventail. C'est la queue qui distingue un rapace d'un
 * corvidé vu de dessous ; les deux n'ont, sinon, que deux triangles.
 *
 * Même repère que `createBirdGeometry` : vole vers +Z, ailes sur X, dièdre
 * porté par Y.
 */
export function createRaptorGeometry(THREE) {
  const positions = new Float32Array([
    // Aile gauche : plus large et moins coudée que le corvidé.
    0, 0, 0.1, -0.62, 0.05, -0.02, 0, 0, -0.16,
    // Aile droite.
    0, 0, 0.1, 0, 0, -0.16, 0.62, 0.05, -0.02,
    // Queue en éventail, déployée en vol plané.
    -0.09, 0, -0.16, 0.09, 0, -0.16, 0, 0, -0.34,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.name = 'raptor';
  return geometry;
}

/**
 * Position d'un rapace à un instant donné. Fonction pure — même principe que
 * `birdAt`, mais il tourne autour d'un centre au lieu de dériver : c'est ce
 * qui fait un rapace en vol de reconnaissance plutôt qu'un corvidé pressé.
 * Le centre suit l'observateur, comme tout le reste de cette couche.
 *
 * @param {Object} bird Paramètres propres au rapace (voir `LifeLayer._buildFlock`).
 * @param {number} time Secondes écoulées.
 * @param {{x:number,y:number,z:number}} centre Position de l'observateur.
 * @returns {{x:number,y:number,z:number,heading:number,flap:number}}
 */
export function raptorAt(bird, time, centre) {
  const angle = bird.orbitPhase + time * bird.angularSpeed;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const x = centre.x + bird.baseX + ca * bird.radius;
  const z = centre.z + bird.baseZ + sa * bird.radius;
  // Une ascendance thermique fait gagner puis reperdre un peu d'altitude —
  // un rapace ne tourne pas à plat comme un manège.
  const y = centre.y + bird.height + Math.sin(time * bird.bobHz + bird.phase) * RAPTOR_BOB_M;
  // Tangente au cercle, dans le sens de `angularSpeed` : c'est la direction
  // de vol réelle, pas une orientation vers le centre.
  const sign = Math.sign(bird.angularSpeed) || 1;
  return {
    x,
    y,
    z,
    heading: Math.atan2(-sa * sign, ca * sign),
    flap: 0.85 + 0.15 * Math.sin(time * Math.PI * RAPTOR_FLAP_HZ + bird.phase),
  };
}

/** Montgolfières en vol. */
export const BALLOON_COUNT = 5;
/** Altitude de la nacelle, en mètres au-dessus de l'observateur — bien plus haut qu'un vol d'oiseaux. */
export const BALLOON_HEIGHT_MIN = 90;
export const BALLOON_HEIGHT_MAX = 240;
/** Demi-côté de la boîte de dérive, en mètres — voir `BIRD_SPREAD_M`. */
export const BALLOON_SPREAD_M = 520;
/** Vitesse de dérive le long du vent, en mètres par seconde — un ballon va au rythme du vent, pas plus vite. */
export const BALLOON_SPEED_MIN = 0.5;
export const BALLOON_SPEED_MAX = 1.6;
/** Rayon de l'enveloppe, en mètres. */
export const BALLOON_RADIUS_MIN_M = 7;
export const BALLOON_RADIUS_MAX_M = 10;
/** Amplitude du tangage vertical, en mètres — une montgolfière n'est jamais tout à fait stable en altitude. */
export const BALLOON_BOB_M = 2.2;
/** Fréquence de ce tangage, en cycles par seconde. */
export const BALLOON_BOB_HZ = 0.045;
/** Vitesse de rotation propre, en radians par seconde — une nacelle tourne lentement sur elle-même en vol. */
export const BALLOON_SPIN_RAD_S = 0.05;
/** Fuseaux (gores) de l'enveloppe, en couleurs alternées. */
const BALLOON_PANELS = 10;
/** Anneaux verticaux échantillonnés le long du profil. */
const BALLOON_RING_STEPS = 12;

/**
 * Profil de l'enveloppe (rayon relatif, 0 à 1) par hauteur relative (0 au
 * col, 1 au sommet) — un ballon plutôt qu'une sphère : évasé vite, arrondi au
 * sommet, resserré à un col étroit où s'attachent les suspentes.
 */
const BALLOON_PROFILE = [
  { y: 0, r: 0.08 },
  { y: 0.1, r: 0.52 },
  { y: 0.32, r: 0.92 },
  { y: 0.58, r: 1 },
  { y: 0.82, r: 0.72 },
  { y: 0.97, r: 0.28 },
  { y: 1, r: 0.02 },
];

/** Rayon relatif du profil à une hauteur relative donnée. Fonction pure. */
function balloonRadiusAt(t) {
  let i = 0;
  while (i < BALLOON_PROFILE.length - 2 && BALLOON_PROFILE[i + 1].y < t) i++;
  const a = BALLOON_PROFILE[i];
  const b = BALLOON_PROFILE[i + 1];
  const span = b.y - a.y || 1;
  const f = Math.min(1, Math.max(0, (t - a.y) / span));
  return a.r + (b.r - a.r) * f;
}

/**
 * Géométrie d'une montgolfière : enveloppe en fuseaux de deux couleurs
 * alternées, panier flush sous le col. Pas de calotte aux deux bouts — le col
 * est masqué par le panier, le sommet ne se voit jamais d'en dessous depuis
 * le sol.
 *
 * Le repère : origine au col (où s'attache le panier), +Y vers le haut.
 */
export function createBalloonGeometry(THREE, { radius, height, colorA, colorB, basket }) {
  const k = new Kit();
  let previous = null;

  for (let s = 0; s <= BALLOON_RING_STEPS; s++) {
    const t = s / BALLOON_RING_STEPS;
    const r = balloonRadiusAt(t) * radius;
    const y = t * height;
    const ring = [];
    for (let p = 0; p <= BALLOON_PANELS; p++) {
      const a = (p / BALLOON_PANELS) * Math.PI * 2;
      ring.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    if (previous) {
      for (let p = 0; p < BALLOON_PANELS; p++) {
        const color = p % 2 === 0 ? colorA : colorB;
        k.quad(previous[p], previous[p + 1], ring[p + 1], ring[p], color);
      }
    }
    previous = ring;
  }

  const basketSize = radius * 0.62;
  k.box({ width: basketSize, height: basketSize, depth: basketSize, y: -basketSize, color: basket });

  return k.toGeometry(THREE, 'balloon');
}

/**
 * Position et lacet propre d'une montgolfière à un instant donné. Fonction
 * pure — même principe que `birdAt` : dérive le long du vent, repli en
 * boucle dans une boîte centrée sur l'observateur.
 *
 * @param {Object} balloon Paramètres propres au ballon (voir le constructeur).
 * @param {number} time Secondes écoulées.
 * @param {{x:number,y:number,z:number}} centre Position de l'observateur.
 * @param {number} windDirection Direction du vent, en radians.
 * @returns {{x:number,y:number,z:number,spin:number}}
 */
export function balloonAt(balloon, time, centre, windDirection = 0) {
  const dx = Math.cos(windDirection);
  const dz = Math.sin(windDirection);
  const travel = time * balloon.speed;
  const x = centre.x + wrap(balloon.baseX + dx * travel, BALLOON_SPREAD_M);
  const z = centre.z + wrap(balloon.baseZ + dz * travel, BALLOON_SPREAD_M);
  const bob = Math.sin(time * BALLOON_BOB_HZ * Math.PI * 2 + balloon.phase) * BALLOON_BOB_M;
  const y = centre.y + balloon.height + bob;
  return { x, y, z, spin: time * BALLOON_SPIN_RAD_S + balloon.phase };
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
    this.theme = theme;
    this.disposed = false;
    this.time = 0;
    this._night = 0;
    this._windDirection = 0;

    this.group = new THREE.Group();
    this.group.name = 'life';
    scene.add(this.group);

    // --- Oiseaux ------------------------------------------------------------
    // Deux géométries tenues en même temps, une seule affichée : `setRelief`
    // bascule l'une pour l'autre plutôt que de tenir deux `InstancedMesh` —
    // il n'y a jamais qu'un seul vol à la fois (voir l'en-tête du fichier).
    this._corvidGeometry = createBirdGeometry(THREE);
    this._raptorGeometry = createRaptorGeometry(THREE);
    this._birdSpecies = 'corvid';
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
    this.birds = new THREE.InstancedMesh(this._corvidGeometry, this.birdMaterial, BIRD_COUNT);
    this.birds.name = 'birds';
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    // Aucun oiseau tant que la première image n'a pas placé les matrices :
    // sinon le vol apparaît empilé à l'origine de la scène le temps d'une image.
    this.birds.count = 0;
    this.group.add(this.birds);

    this._flock = this._buildFlock(this._birdSpecies);

    // --- Montgolfières --------------------------------------------------------
    // Pas d'`InstancedMesh` : trop peu de ballons pour le justifier, et chacun
    // porte ses deux couleurs propres, ce qu'une géométrie partagée ne sait
    // pas faire sans un second tampon de teinte — voir l'en-tête du fichier.
    this.balloonMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    this.balloonMaterial.name = 'balloon';
    this._balloons = [];
    this._balloonMeshes = [];
    this._balloonsVisible = true;
    const palette = theme.life.balloonColors;
    for (let i = 0; i < BALLOON_COUNT; i++) {
      const a = draw(i * 71 + 1);
      const b = draw(i * 73 + 2);
      const c = draw(i * 79 + 3);
      const [colorA, colorB] = palette[Math.floor(draw(i * 83 + 4) * palette.length) % palette.length];
      const radius = BALLOON_RADIUS_MIN_M + c * (BALLOON_RADIUS_MAX_M - BALLOON_RADIUS_MIN_M);
      const geometry = createBalloonGeometry(THREE, {
        radius,
        height: radius * 2.5,
        colorA,
        colorB,
        basket: theme.life.balloonBasket,
      });
      const mesh = new THREE.Mesh(geometry, this.balloonMaterial);
      mesh.name = 'balloon';
      mesh.frustumCulled = false;
      // Hors champ tant que la première image n'a pas placé le ballon — même
      // raison que `this.birds.count = 0` : sans ça, il apparaît un instant à
      // l'origine de la scène.
      mesh.position.set(0, -100000, 0);
      this.group.add(mesh);
      this._balloonMeshes.push(mesh);
      this._balloons.push({
        baseX: (draw(i * 41 + 8) * 2 - 1) * BALLOON_SPREAD_M,
        baseZ: (draw(i * 43 + 9) * 2 - 1) * BALLOON_SPREAD_M,
        height: BALLOON_HEIGHT_MIN + a * (BALLOON_HEIGHT_MAX - BALLOON_HEIGHT_MIN),
        speed: BALLOON_SPEED_MIN + b * (BALLOON_SPEED_MAX - BALLOON_SPEED_MIN),
        phase: draw(i * 29 + 5) * Math.PI * 2,
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
   * Tire le peuplement du flock : les paramètres de dérive au vent pour un
   * corvidé, ceux d'une orbite pour un rapace. Deux tirages distincts, pas un
   * seul rendu conditionnel — la forme des deux vols n'a rien de commun.
   * @param {'corvid'|'raptor'} species
   */
  _buildFlock(species) {
    const flock = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
      const a = draw(i * 7 + 1);
      const b = draw(i * 13 + 2);
      const c = draw(i * 19 + 3);
      if (species === 'raptor') {
        flock.push({
          // Centre d'orbite dans la boîte de dispersion — voir `RAPTOR_SPREAD_M`.
          baseX: (draw(i * 41 + 8) * 2 - 1) * RAPTOR_SPREAD_M,
          baseZ: (draw(i * 43 + 9) * 2 - 1) * RAPTOR_SPREAD_M,
          height: RAPTOR_HEIGHT_MIN + a * (RAPTOR_HEIGHT_MAX - RAPTOR_HEIGHT_MIN),
          radius: RAPTOR_ORBIT_MIN_M + b * (RAPTOR_ORBIT_MAX_M - RAPTOR_ORBIT_MIN_M),
          // Sens de rotation tiré : deux rapaces ne tournent pas forcément dans le même sens.
          angularSpeed:
            (draw(i * 47 + 10) < 0.5 ? -1 : 1) *
            (RAPTOR_ANGULAR_SPEED_MIN + c * (RAPTOR_ANGULAR_SPEED_MAX - RAPTOR_ANGULAR_SPEED_MIN)),
          orbitPhase: draw(i * 29 + 5) * Math.PI * 2,
          phase: draw(i * 31 + 6) * Math.PI * 2,
          bobHz: RAPTOR_BOB_HZ * (0.8 + draw(i * 59 + 13) * 0.4),
          scale: RAPTOR_SPAN_M * (0.85 + draw(i * 53 + 12) * 0.4),
        });
      } else {
        flock.push({
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
    }
    return flock;
  }

  /**
   * Le relief décide de l'espèce : un rapace qui tourne en rond au-dessus
   * d'une pente ou d'une altitude de montagne (`RAPTOR_SLOPE_THRESHOLD`,
   * `RAPTOR_ELEVATION_M`), un corvidé qui dérive au vent partout ailleurs. Un
   * seul vol à la fois — ce n'est pas un ajout, c'est un remplacement.
   * @param {{elevation:number, slope:number}|null} relief
   */
  setRelief(relief) {
    if (this.disposed) return;
    const montane = !!relief && (relief.slope > RAPTOR_SLOPE_THRESHOLD || relief.elevation > RAPTOR_ELEVATION_M);
    const species = montane ? 'raptor' : 'corvid';
    if (species === this._birdSpecies) return;
    this._birdSpecies = species;
    this.birds.geometry = species === 'raptor' ? this._raptorGeometry : this._corvidGeometry;
    this.birdMaterial.color.set(species === 'raptor' ? this.theme.life.raptor : this.theme.life.bird);
    this._flock = this._buildFlock(species);
  }

  /**
   * Règle l'ambiance nocturne : les oiseaux se posent, la fumée s'assombrit.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    this._night = Math.min(1, Math.max(0, Number(mix) || 0));
    // Les oiseaux ne volent pas la nuit, et un vol en silhouette sur un ciel
    // sombre ne se verrait de toute façon pas. Une montgolfière vole à la
    // même heure — c'est un vol à vue.
    this.birds.visible = this._night < 0.45;
    this._balloonsVisible = this._night < 0.45;
    for (const mesh of this._balloonMeshes) mesh.visible = this._balloonsVisible;
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
    this._advanceBalloons(at);
    this._advanceSmoke();
  }

  _advanceBirds(at) {
    if (!this.birds.visible) return;
    const centre = { x: at.x, y: at.y, z: at.z };
    const raptor = this._birdSpecies === 'raptor';

    this._flock.forEach((bird, index) => {
      const at = raptor ? raptorAt(bird, this.time, centre) : birdAt(bird, this.time, centre, this._windDirection);
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

  _advanceBalloons(at) {
    if (!this._balloonsVisible) return;
    const centre = { x: at.x, y: at.y, z: at.z };

    this._balloons.forEach((balloon, index) => {
      const state = balloonAt(balloon, this.time, centre, this._windDirection);
      const mesh = this._balloonMeshes[index];
      mesh.position.set(state.x, state.y, state.z);
      this._euler.set(0, state.spin, 0);
      mesh.quaternion.setFromEuler(this._euler);
    });
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
    this._corvidGeometry.dispose();
    this._raptorGeometry.dispose();
    this.birdMaterial.dispose();
    for (const mesh of this._balloonMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.balloonMaterial.dispose();
    this._balloonMeshes = [];
    this._balloons = [];
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
