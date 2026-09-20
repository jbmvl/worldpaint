/*
 * lowPolyGrain — grain low poly géométrique du sol : un bruit sur réseau
 * triangulaire bosselle la position, une normale reprise par dérivées d'écran
 * fait lire des facettes plutôt qu'un dégradé lissé.
 *
 * **Câblé dans `terrainMaterial.js`**, une cellule et une amplitude par
 * matière du sol (`SURFACE_LOOK.grainCellM`/`grainAmplitudeM`, repli sur le
 * réglage ci-dessous), et dans `foliageMaterial.js` côté herbe (`groundLowPoly`,
 * `groundGrainPerInstance`), pour que ce qui pousse suive la bosse plutôt que
 * de flotter sur l'ancien plan — les cultures et le mobilier n'existent que
 * sur des matières non branchées et lisent le seul réglage de repli.
 *
 * Purement visuel : ça ne touche à aucune lecture d'altitude ailleurs dans le
 * moteur (routes, bâti, haies, `cliffCut`, placement, mobilier ponctuel). Un
 * point posé au niveau naturel et qui ne lit pas `LOW_POLY_GRAIN_GLSL`
 * (aujourd'hui : tout `furnitureKit.js`, les arbres de `vegetationLayer.js`)
 * ne suit pas la bosse et peut sembler flotter ou s'enfoncer à son pied.
 *
 * Éteint dans l'emprise routière (`roadMask`, écrit par `terrainBubble.js` à
 * partir de `roadCutMaskAt`) : la géométrie y est déjà l'entaille exacte de
 * la chaussée (`roadCut.js`), et le grain ajouté après coup la recouvrirait.
 *
 * ## Le réseau est triangulaire, pas carré
 *
 * Un bruit de valeur sur grille carrée (bilinéaire ou lissé) se lit comme un
 * pavage de losanges coupés en deux — la diagonale du carré reste visible
 * quelle que soit la fonction de lissage, parce que les quatre coins d'une
 * cellule sont mélangés deux triangles à la fois. Le réseau ici est skewé à
 * la façon d'un bruit simplex (Gustavson) : chaque point n'est influencé que
 * par les trois sommets du triangle qui le contient, avec un dégradé propre à
 * chaque sommet (pas une valeur scalaire) — la diagonale du réseau ne se voit
 * plus parce qu'il n'y a plus de carré à couper.
 *
 * ## Le fondu de distance
 *
 * La maille du terrain grossit par anneaux (`terrainBubble.segmentsForRing`) :
 * au zoom 15, l'anneau central tient ~4-6 m entre sommets, le suivant ~9-13 m,
 * au-delà ~18-25 m. Une cellule de quelques mètres n'a de sens que là où la
 * maille est assez fine pour la porter ; plus loin, deux sommets voisins
 * tombent dans des cellules de bruit non corrélées et la bosse tremble au
 * lieu de se lire. `lowPolyFade` éteint donc l'amplitude avec la distance à
 * la caméra, bien avant la frontière d'anneau la plus proche possible (un
 * observateur peut être au bord de sa tuile).
 */

/**
 * Réglages par défaut, partagés par tous les appelants. Cellule et amplitude
 * en mètres, fondu en mètres (début, fin — l'amplitude est nulle au-delà).
 *
 * Ordres de grandeur relevés à l'essai sur une paroi rocheuse — c'est le repli
 * de `terrainMaterial.js` pour une matière que `SURFACE_LOOK` ne couvre pas
 * (`grainCellM`/`grainAmplitudeM`, voir `themes/default.js`), et le seul
 * réglage que lisent les appelants qui n'ont pas de matière à consulter
 * (`foliageMaterial.js` sans instanciation par matière).
 */
export const LOW_POLY_GRAIN_DEFAULTS = {
  cellM: 6.0,
  amplitudeM: 1.4,
  fadeStartM: 40.0,
  fadeEndM: 90.0,
};

/**
 * Fonctions GLSL du bruit, du fondu et de la normale plate, à coller dans un
 * shader (`onBeforeCompile`).
 *
 * - `lowPolyNoise(vec2 p)` — bruit sur réseau triangulaire, dans `[-1, 1]`.
 * - `lowPolyBump(vec2 xz, float cellM, float amplitudeM)` — décalage vertical
 *   à partir d'une position au sol (mêmes unités que `vScenePos.xz`).
 * - `lowPolyFade(vec3 worldPos, vec3 cameraPos, float startM, float endM)` —
 *   1 près de la caméra, 0 au-delà de `endM`.
 *
 * Usage terrain, dans `onBeforeCompile` :
 *
 * ```glsl
 * // #include <begin_vertex>, avant de calculer vScenePos :
 * vec3 grainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
 * float grainFade = lowPolyFade(grainPos, cameraPosition, uGrainFadeM.x, uGrainFadeM.y);
 * transformed.y += lowPolyBump(grainPos.xz, uGrainCellM, uGrainAmplitudeM) * grainFade;
 * vScenePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
 * vSceneNormal = normalize(mat3(modelMatrix) * objectNormal);
 *
 * // #include <normal_fragment_begin>, à la place de la normale analytique :
 * vec3 flatNormal = normalize(cross(dFdx(vScenePos), dFdy(vScenePos)));
 * if (dot(flatNormal, vSceneNormal) < 0.0) flatNormal = -flatNormal;
 * float grainFade = lowPolyFade(vScenePos, cameraPosition, uGrainFadeM.x, uGrainFadeM.y);
 * vec3 worldNormal = normalize(mix(vSceneNormal, flatNormal, grainFade));
 * ```
 *
 * Usage d'un objet posé (herbe, culture) : lire `lowPolyBump` à l'ancrage au
 * sol de l'instance (`instanceMatrix[3].xz`, jamais un sommet du panneau —
 * sans quoi le pied et la pointe ne bougeraient pas ensemble), diviser par
 * l'échelle verticale de l'instance avant de l'ajouter à `transformed.y` : le
 * décalage vertical voulu est en mètres du monde, pas en unité du panneau, et
 * l'instance le remet à l'échelle en le multipliant par sa propre hauteur.
 *
 * `cellM`/`amplitudeM` à 0 désactive le grain (repli neutre).
 */
export const LOW_POLY_GRAIN_GLSL = `
float lowPolyHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Dégradé unitaire du sommet du réseau, pas une valeur scalaire : c'est ce
// qui évite le pavage carré d'un bruit de valeur (voir l'en-tête).
vec2 lowPolyGrad(vec2 cell) {
  float a = lowPolyHash(cell) * 6.28318530718;
  return vec2(cos(a), sin(a));
}

// Bruit sur réseau triangulaire (construction simplex 2D) : le repère est
// skewé pour que les cellules soient des triangles équilatéraux, et chaque
// point ne lit que les trois sommets du triangle qui le contient.
float lowPolyNoise(vec2 p) {
  const float K1 = 0.366025404; // (sqrt(3) - 1) / 2
  const float K2 = 0.211324865; // (3 - sqrt(3)) / 6

  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;

  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(
    dot(a, lowPolyGrad(i)),
    dot(b, lowPolyGrad(i + o)),
    dot(c, lowPolyGrad(i + 1.0))
  );
  return clamp(dot(n, vec3(70.0)), -1.0, 1.0);
}

float lowPolyBump(vec2 xz, float cellM, float amplitudeM) {
  if (cellM <= 0.0 || amplitudeM <= 0.0) return 0.0;
  return lowPolyNoise(xz / cellM) * amplitudeM;
}

float lowPolyFade(vec3 worldPos, vec3 cameraPos, float startM, float endM) {
  return 1.0 - smoothstep(startM, endM, distance(worldPos, cameraPos));
}
`;
