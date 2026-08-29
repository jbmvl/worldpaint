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
 * **Le vent**, enfin. Une touffe immobile n'est pas une touffe d'herbe : c'est
 * un décalque. Le mouvement se fait dans le sommet, à partir de la position de
 * l'instance — deux ondes de périodes différentes, une phase tirée du sol, et
 * une amplitude qui croît en carré de la hauteur pour que le pied reste planté.
 * Rien à réécrire par image : un seul uniforme avance.
 *
 * L'amplitude réglée à la construction (`windStrength`) est celle du **temps
 * ordinaire** — c'est une valeur d'art, propre à chaque famille de plante :
 * l'herbe se couche, le blé ondule, un arbre bouge à peine. La météo ne la
 * remplace pas, elle la **multiplie** (`setFoliageWind`), et la valeur de
 * référence est gardée à part pour qu'une bourrasque qui va et vient ne la
 * grignote pas à chaque passage.
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
 * Uniformes du vent, ou `null` si le matériau n'en porte pas — la forme que
 * `material.userData.wind` doit prendre pour que `advanceFoliageWind` et
 * `setFoliageWind` puissent s'en saisir, quel que soit le matériau qui les
 * porte (panneau croisé ou volume).
 */
function createFoliageWindUniforms(wind, windStrength) {
  if (!wind) return null;
  return {
    uWindTime: { value: 0 },
    uWindStrength: { value: windStrength },
    /** Amplitude du temps ordinaire. Ne bouge jamais : voir l'en-tête. */
    base: windStrength,
    /** Facteur de vitesse, appliqué par `advanceFoliageWind`. */
    speed: 1,
  };
}

/**
 * Injecte le balancement du vent dans un shader compilé, si `windUniforms`
 * en porte. Partagé par `createFoliageMaterial` (panneaux croisés) et
 * `createFoliageVolumeMaterial` (arbres en volume) : le calcul — hauteur
 * locale au carré, phase tirée de la position d'instance — ne dépend de rien
 * de propre au panneau, un sommet de maillage plein s'y prête tout autant.
 */
function injectFoliageWind(shader, windUniforms) {
  if (!windUniforms) return;
  shader.uniforms.uWindTime = windUniforms.uWindTime;
  shader.uniforms.uWindStrength = windUniforms.uWindStrength;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n uniform float uWindTime;\n uniform float uWindStrength;`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         // Position de l'instance : la phase est tirée du sol, donc deux
         // instances voisines ne penchent pas exactement ensemble, et une
         // instance donnée penche toujours de la même façon.
         #ifdef USE_INSTANCING
           vec2 anchor = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
         #else
           vec2 anchor = vec2(0.0);
         #endif
         float phase = anchor.x * 0.42 + anchor.y * 0.31;
         float sway = sin(uWindTime * 1.7 + phase) * 0.62 + sin(uWindTime * 3.1 + phase * 1.9) * 0.38;
         // En carré de la hauteur locale : le pied ne bouge pas, la pointe
         // fouette — vrai d'un panneau (hauteur portée par l'UV) comme d'un
         // volume (hauteur portée par la position, le tronc étant à y = 0).
         float bend = transformed.y * transformed.y * uWindStrength;
         transformed.x += sway * bend;
         transformed.z += sway * bend * 0.45;
       }`
    );
}

/**
 * Matériau d'un feuillage en **volume** : arbres de forêt en low poly
 * (`lowPolyForest.js`). À la différence de `createFoliageMaterial`, la
 * géométrie a de vraies faces et de vraies normales — pas de normale forcée
 * à la verticale, pas d'atlas, pas de découpe alpha. Seul le vent est
 * repris, avec le même calcul que le feuillage en panneau (voir
 * `injectFoliageWind`) : c'est ce qui manquait pour qu'une masse verte en
 * volume ne soit pas plus figée qu'une touffe d'herbe.
 *
 * @param {Object} options
 * @param {Object} options.THREE
 * @param {boolean} [options.wind] Anime le sommet des houppes.
 * @param {number} [options.windStrength] Amplitude, en part de la hauteur.
 * @param {string} options.cacheKey Clé de programme.
 * @returns {Object} matériau. `userData.wind` porte l'uniforme de temps quand
 *          le vent est actif.
 */
export function createFoliageVolumeMaterial({ THREE, wind = true, windStrength = 0.012, cacheKey }) {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Un contour irrégulier peut laisser une facette mal orientée ; une haie
    // ou un tronc balayé n'a pas d'intérieur, et une face manquante s'y
    // verrait comme un trou. Même choix que `furnitureKit.createFurnitureMaterial`.
    side: THREE.DoubleSide,
  });
  material.name = 'foliage-volume';

  const windUniforms = createFoliageWindUniforms(wind, windStrength);
  material.userData.wind = windUniforms;

  material.onBeforeCompile = (shader) => {
    injectFoliageWind(shader, windUniforms);
  };

  material.customProgramCacheKey = () => cacheKey;
  return material;
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

  const windUniforms = createFoliageWindUniforms(wind, windStrength);
  material.userData.wind = windUniforms;

  material.onBeforeCompile = (shader) => {
    injectFoliageWind(shader, windUniforms);

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
      // La distance est calculée au sommet : un varying de plus coûte moins que
      // de reconstruire la position monde dans le fragment, et la précision au
      // sommet suffit largement pour piloter un seuil.
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
             // Compense l'érosion du découpage à distance. Le mip moyenne
             // l'alpha d'une silhouette avec le vide qui l'entoure : une touffe
             // minifiée voit son alpha passer sous le seuil et **disparaît**,
             // au lieu de simplement rapetisser. On remonte donc l'alpha à
             // mesure qu'on s'éloigne, ce qui revient à baisser le seuil.
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
 * Fait avancer le vent d'un matériau de feuillage. Trois couches — l'herbe, les
 * arbres, les cultures — en avaient chacune leur copie mot pour mot ; c'est
 * assez de sites d'appel réels pour que la fonction existe, et le repli de la
 * phase est précisément le genre de détail qu'on ne veut corriger qu'une fois.
 *
 * @param {Object} material Matériau rendu par `createFoliageMaterial`.
 * @param {number} delta Secondes écoulées.
 */
export function advanceFoliageWind(material, delta) {
  const wind = material?.userData?.wind;
  if (!wind || !Number.isFinite(delta)) return;
  // Remis dans [0, 1000[ : un temps qui croît indéfiniment finit par perdre sa
  // précision en flottant simple, et le vent se met à saccader.
  wind.uWindTime.value = (wind.uWindTime.value + delta * wind.speed) % 1000;
}

/**
 * Accorde le vent d'un matériau sur la météo.
 *
 * L'amplitude et la vitesse sont pilotées séparément parce qu'elles ne disent
 * pas la même chose — voir `windField` dans `environment/weather.js`.
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
