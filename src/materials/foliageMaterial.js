/*
 * foliageMaterial — matériau commun aux arbres et à l'herbe.
 * ----------------------------------------------------------
 * Deux corrections qu'un `MeshLambertMaterial` nu ne sait pas faire.
 *
 * **La normale.** Un panneau de feuillage est vu des deux côtés, donc rendu en
 * `DoubleSide` — et three retourne alors la normale sur les faces arrière. Une
 * moitié des quadrilatères se retrouve éclairée par en dessous, c'est-à-dire
 * noire. C'est exactement ce qui donnait des arbres entièrement sombres et une
 * barre noire au milieu des autres. On force donc la normale vers le haut,
 * quelle que soit la face : un feuillage est éclairé par le ciel, pas par
 * l'orientation arbitraire de son panneau.
 *
 * Cette verticale est juste pour le soleil et fausse pour tout ce qui éclaire
 * d'à côté — un phare de vélo arrive à l'horizontale et ne touchait donc rien.
 * D'où **deux** normales, séparées par famille de lumière dans
 * `foliageLightsChunk` : penchée vers la caméra pour les lampes proches,
 * verticale pour le soleil et le ciel.
 *
 * **L'atlas.** Un décalage UV par instance permet de tirer une silhouette
 * différente dans une même texture, sans multiplier les appels de rendu.
 *
 * Le découpage passe par `alphaTest`, jamais par la transparence : pas de tri
 * par profondeur, donc pas de végétation qui clignote l'une derrière l'autre.
 *
 * **Le vent**, enfin, pour l'herbe seulement. Une touffe immobile n'est pas une
 * touffe d'herbe : c'est un décalque. Le mouvement se fait dans le sommet, à
 * partir de la position de l'instance — deux ondes de périodes différentes, une
 * phase tirée du sol, et une amplitude qui croît en carré de la hauteur pour
 * que le pied reste planté. Rien à réécrire par image : un seul uniforme
 * avance.
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
 * Chunk d'éclairage modifié : une normale par famille de lumière.
 *
 * Le feuillage est éclairé avec une normale strictement verticale (voir plus
 * bas) — ce qui est juste pour le soleil et le ciel, et faux pour tout ce qui
 * éclaire d'à côté. Un phare de vélo est à 70 cm du sol : sa lumière arrive sur
 * un arbre presque à l'horizontale, `dot(vertical, direction)` vaut ~0, et le
 * faisceau traversait la végétation sans la toucher. C'est ce qui se voyait :
 * la route s'allumait, les arbres restaient dans le noir.
 *
 * On penche donc la normale vers la caméra — c'est-à-dire vers l'observateur, donc
 * vers ses feux, puisque la caméra le suit — le temps des boucles ponctuelle et
 * projecteur, puis on la redresse avant le soleil et l'ambiance hémisphérique.
 * Le rendu de jour est ainsi **inchangé**, au bit près.
 *
 * Le chunk est pris dans le three installé, jamais recopié : une mise à jour de
 * la bibliothèque le suit. Si l'un des deux points d'ancrage disparaît, on rend
 * l'inclusion d'origine — la végétation redevient insensible aux lampes, ce qui
 * est laid mais jamais cassé.
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
  cacheKey,
}) {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    // **Indispensable**, et ça n'a rien d'évident : `setColorAt` ne suffit pas.
    // three ne définit `USE_COLOR` que d'après `material.vertexColors`, et c'est
    // ce define — pas `USE_INSTANCING_COLOR` — qui conditionne l'application de
    // `vColor` dans le fragment. Sans lui, la couleur d'instance est calculée,
    // transmise… et jetée : tous les arbres d'un bois sortaient exactement du
    // même vert, et toutes les touffes d'herbe aussi. `createCrossedQuads` porte
    // pour cette raison un attribut de couleur blanc, qui ne fait que laisser
    // passer la teinte d'instance.
    vertexColors: true,
  });

  const windUniforms = wind
    ? { uWindTime: { value: 0 }, uWindStrength: { value: windStrength } }
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
             // Position de l'instance : la phase est tirée du sol, donc deux
             // touffes voisines ne penchent pas exactement ensemble, et une
             // touffe donnée penche toujours de la même façon.
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

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         // Feuillage : éclairé par le ciel, jamais par l'orientation du panneau.
         normal = vec3(0.0, 1.0, 0.0);`
      )
      // Les lampes proches, elles, ont besoin d'une normale penchée : sans quoi
      // le phare du vélo passe au travers des arbres.
      .replace('#include <lights_fragment_begin>', foliageLightsChunk(THREE));
  };

  material.customProgramCacheKey = () => cacheKey;
  return material;
}

/**
 * Matériau de profondeur assorti, pour que le feuillage projette une ombre
 * **découpée**.
 *
 * three dérive automatiquement un matériau de profondeur des matériaux ordinaires
 * et y reporte `map` et `alphaTest` — la découpe serait donc correcte pour un
 * feuillage sans atlas. Mais le décalage UV par instance vit dans un
 * `onBeforeCompile`, que cette dérivation ne connaît pas : chaque panneau
 * projetterait l'atlas entier, soit quatre arbres écrasés dans l'ombre d'un
 * seul. Il faut donc rejouer l'injection ici.
 *
 * Le shader de profondeur de three inclut `<uv_vertex>` et `<map_fragment>` :
 * `vMapUv` y existe, et l'injection est la même mot pour mot.
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
