/*
 * foliageMaterial — matériau commun aux arbres et à l'herbe. Corrige trois
 * choses qu'un `MeshLambertMaterial` nu ne sait pas faire :
 *
 * - normale forcée vers le haut (un panneau `DoubleSide` a ses faces arrière
 *   retournées par three, donc éclairées par en dessous, donc noires), avec
 *   une inclinaison vers la caméra réservée aux lampes proches
 *   (`foliageLightsChunk`) — un phare arrivant à l'horizontale ne touchait
 *   sinon rien ;
 * - décalage UV par instance (atlas), pour varier la silhouette sans
 *   multiplier les appels de rendu ; découpage par `alphaTest`, pas par
 *   transparence, pour éviter le tri par profondeur ;
 * - vent animé au sommet (deux ondes, phase tirée du sol, amplitude en carré
 *   de la hauteur pour garder le pied planté). L'amplitude construite
 *   (`windStrength`) est le temps ordinaire ; la météo la multiplie
 *   (`setFoliageWind`) sans l'écraser.
 */

/** Nom de l'attribut d'instance portant le décalage d'atlas. */
export const ATLAS_ATTRIBUTE = 'aAtlasOffset';

/**
 * Inclinaison de la normale du feuillage vers la caméra, pour les lampes
 * proches seulement. 0,85 vaut environ 40°.
 */
const LAMP_LEAN = 0.85;

let leanWarned = false;

/**
 * Chunk d'éclairage modifié : une normale par famille de lumière. La normale
 * verticale du feuillage est juste pour le soleil et le ciel, mais fausse
 * pour une lumière proche et rasante (un phare de vélo à 70 cm du sol la
 * traversait sans la toucher) : on la penche vers la caméra le temps des
 * boucles ponctuelle/projecteur, puis on la redresse pour le soleil.
 *
 * Chunk pris dans le three installé, jamais recopié. Si l'un des deux points
 * d'ancrage disparaît, on rend l'inclusion d'origine (laid mais pas cassé).
 */
function foliageLightsChunk(THREE) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const beforeLamps = 'IncidentLight directLight;';
  const beforeSun = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';

  if (!chunk.includes(beforeLamps) || !chunk.includes(beforeSun)) {
    if (!leanWarned) {
      leanWarned = true;
      console.warn('[worldpaint] chunk d’éclairage inattendu — feuillage insensible aux lampes');
    }
    return '#include <lights_fragment_begin>';
  }

  return chunk
    .replace(
      beforeLamps,
      `${beforeLamps}
       // Lampes proches (phare et feu du vélo) : normale penchée vers la caméra.
       geometryNormal = normalize( geometryNormal + geometryViewDir * ${LAMP_LEAN.toFixed(2)} );`
    )
    .replace(
      beforeSun,
      `// Soleil, ciel, ambiance : le feuillage retrouve sa verticale.
       geometryNormal = normal;
       ${beforeSun}`
    );
}

/**
 * @param {Object} options
 * @param {Object} options.THREE
 * @param {Object} options.map      Texture de feuillage.
 * @param {boolean} [options.atlas] Active le décalage UV par instance.
 * @param {number} [options.tiles]  Nombre de cases par côté de l'atlas.
 * @param {boolean} [options.wind]  Anime le sommet des panneaux.
 * @param {number} [options.windStrength] Amplitude, en part de la largeur.
 * @param {boolean} [options.coverage] Compense l'érosion de l'alpha à distance
 *        (voir plus haut). Éteint par défaut : les arbres n'y gagnent rien et
 *        leur programme reste inchangé au bit près.
 * @param {number[]} [options.coverageRange] Distances, en mètres, sur
 *        lesquelles la compensation monte de zéro à `coverageGain`.
 * @param {number} [options.coverageGain] Facteur appliqué à l'alpha à pleine
 *        distance. 1 ne change rien ; 2 fait passer le seuil à un fragment deux
 *        fois moins couvrant.
 * @param {string} options.cacheKey Clé de programme (une par variante de shader).
 * @returns {Object} matériau. `userData.wind` porte l'uniforme de temps quand
 *          le vent est actif — c'est le seul point d'entrée de l'animation.
 */
export function createFoliageMaterial({
  THREE,
  map,
  atlas = false,
  tiles = 2,
  wind = false,
  windStrength = 0.35,
  coverage = false,
  coverageRange = [30, 120],
  coverageGain = 2.2,
  cacheKey,
}) {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    // Indispensable : `setColorAt` seul ne suffit pas, c'est `vertexColors`
    // qui définit `USE_COLOR` et fait passer `vColor` dans le fragment.
    // `createCrossedQuads` porte pour cette raison un attribut blanc, qui ne
    // fait que laisser passer la teinte d'instance.
    vertexColors: true,
  });

  const windUniforms = wind
    ? {
        uWindTime: { value: 0 },
        uWindStrength: { value: windStrength },
        /** Amplitude du temps ordinaire. Ne bouge jamais : voir l'en-tête. */
        base: windStrength,
        /** Facteur de vitesse, appliqué par `advanceFoliageWind`. */
        speed: 1,
      }
    : null;
  material.userData.wind = windUniforms;

  material.onBeforeCompile = (shader) => {
    if (windUniforms) {
      shader.uniforms.uWindTime = windUniforms.uWindTime;
      shader.uniforms.uWindStrength = windUniforms.uWindStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n uniform float uWindTime;\n uniform float uWindStrength;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             // Phase tirée de la position de l'instance : deux touffes voisines ne penchent pas ensemble.
             #ifdef USE_INSTANCING
               vec2 anchor = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
             #else
               vec2 anchor = vec2(0.0);
             #endif
             float phase = anchor.x * 0.42 + anchor.y * 0.31;
             float sway = sin(uWindTime * 1.7 + phase) * 0.62 + sin(uWindTime * 3.1 + phase * 1.9) * 0.38;
             // En carré de la hauteur : le pied ne bouge pas, la pointe fouette.
             float bend = transformed.y * transformed.y * uWindStrength;
             transformed.x += sway * bend;
             transformed.z += sway * bend * 0.45;
           }`
        );
    }

    if (atlas) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n attribute vec2 ${ATLAS_ATTRIBUTE};`)
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
           #ifdef USE_MAP
             vMapUv = vMapUv * ${(1 / tiles).toFixed(4)} + ${ATLAS_ATTRIBUTE};
           #endif`
        );
    }

    if (coverage) {
      // Distance calculée au sommet : moins cher qu'au fragment, précision suffisante pour un seuil.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n varying float vCoverDist;`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
           vCoverDist = -mvPosition.z;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n varying float vCoverDist;`)
        .replace(
          '#include <alphatest_fragment>',
          `{
             // Compense l'érosion du découpage à distance (le mip moyenne
             // l'alpha avec le vide autour, et la silhouette minifiée disparaît sous le seuil).
             float cover = smoothstep(${coverageRange[0].toFixed(1)}, ${coverageRange[1].toFixed(1)}, vCoverDist);
             diffuseColor.a = min(1.0, diffuseColor.a * mix(1.0, ${coverageGain.toFixed(2)}, cover));
           }
           #include <alphatest_fragment>`
        );
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         normal = vec3(0.0, 1.0, 0.0);`
      )
      .replace('#include <lights_fragment_begin>', foliageLightsChunk(THREE));
  };

  material.customProgramCacheKey = () => cacheKey;
  return material;
}

/**
 * Fait avancer le vent d'un matériau de feuillage.
 *
 * @param {Object} material Matériau rendu par `createFoliageMaterial`.
 * @param {number} delta Secondes écoulées.
 */
export function advanceFoliageWind(material, delta) {
  const wind = material?.userData?.wind;
  if (!wind || !Number.isFinite(delta)) return;
  // Remis dans [0, 1000[ pour ne pas perdre de précision en flottant simple.
  wind.uWindTime.value = (wind.uWindTime.value + delta * wind.speed) % 1000;
}

/**
 * Accorde le vent d'un matériau sur la météo — voir `windField` dans `environment/weather.js`.
 *
 * @param {Object} material Matériau rendu par `createFoliageMaterial`.
 * @param {{amplitude:number, speed:number}} field
 */
export function setFoliageWind(material, field) {
  const wind = material?.userData?.wind;
  if (!wind || !field) return;
  wind.uWindStrength.value = wind.base * field.amplitude;
  wind.speed = field.speed;
}

/**
 * Matériau de profondeur assorti, pour que le feuillage projette une ombre
 * découpée. Le décalage UV par instance vit dans un `onBeforeCompile` que la
 * dérivation automatique de three ne connaît pas (l'ombre projetterait l'atlas
 * entier) : on rejoue donc la même injection ici.
 */
export function createFoliageDepthMaterial({ THREE, map, tiles = 2, cacheKey }) {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n attribute vec2 ${ATLAS_ATTRIBUTE};`)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         #ifdef USE_MAP
           vMapUv = vMapUv * ${(1 / tiles).toFixed(4)} + ${ATLAS_ATTRIBUTE};
         #endif`
      );
  };

  material.customProgramCacheKey = () => cacheKey;
  return material;
}

/**
 * Deux quadrilatères croisés, base à y = 0, hauteur 1 et largeur 1.
 * Les normales pointent déjà vers le haut ; le shader s'assure que les faces
 * arrière ne les retournent pas.
 */
export function createCrossedQuads(THREE) {
  const h = 1;
  const w = 0.5;
  const positions = new Float32Array([
    -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
    0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const normals = new Float32Array(24);
  for (let i = 0; i < 8; i++) normals[i * 3 + 1] = 1;
  // Blanc partout : l'attribut n'est là que parce que `vertexColors` l'exige
  // (voir `createFoliageMaterial`). C'est la couleur d'instance qui teinte.
  const colors = new Float32Array(24).fill(1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}
