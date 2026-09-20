/*
 * lowPolyGrain — la fonction seule d'un essai de grain low poly géométrique
 * pour le sol : un bruit de valeur qui bosselle la position, une normale
 * reprise par dérivées d'écran pour lire des facettes plutôt qu'un dégradé
 * lissé. Voir la branche d'essai pour le rendu constaté.
 *
 * **Non câblé.** Rien dans `worldComposer` ni `terrainMaterial` n'importe ce
 * fichier : c'est la fonction à brancher, pas une couche qui tourne. La
 * brancher pose deux questions que ce fichier ne tranche pas :
 *
 * - **où lire la matière.** `terrainMaterial.js` ne connaît la matière du sol
 *   (`uSurfaceMap`) qu'au fragment, par une cubique de Catmull-Rom coûteuse.
 *   Le grain, lui, doit être choisi **au sommet**, avant de bosseler la
 *   position — une lecture au texel le plus proche suffit, la cubique ne sert
 *   qu'au tracé du contour.
 * - **où vivent cellule et amplitude.** Ce sont des réglages artistiques :
 *   par la règle du projet, ils vont dans le thème (`themes/default.js`, une
 *   entrée par `SURFACE_KINDS`, avec un repli neutre), jamais en dur dans le
 *   shader. Ce fichier n'expose qu'une fonction à deux paramètres ; la table
 *   qui les fournit par matière reste à écrire côté appelant.
 *
 * Un essai relevé sur le terrain a donné les ordres de grandeur suivants (à
 * affiner à l'œil, pas à prendre pour acquis) :
 *
 * | Matière       | cellM   | amplitudeM |
 * |---------------|---------|------------|
 * | roche, éboulis | ~6      | ~1.4       |
 * | lande, herbe basse | ~1.5 | ~0.2      |
 *
 * Une cellule large et une amplitude forte se lisent comme une ondulation
 * (des « collines », pas des facettes) : c'est le bon réglage pour une paroi
 * rocheuse, pas pour un sol bas.
 *
 * Purement visuel : ça ne touche à aucune lecture d'altitude ailleurs dans le
 * moteur (routes, bâti, haies, `cliffCut`, placement). Un objet posé au niveau
 * naturel ne suit pas la bosse et peut sembler flotter ou s'enfoncer à son
 * pied — à vérifier au raccord une fois câblé.
 */

/**
 * Fonctions GLSL du bruit et de la normale plate, à coller dans un shader.
 *
 * - `lowPolyNoise(vec2 p)` — bruit de valeur continu, C¹, dans `[0, 1]`.
 * - `lowPolyBump(vec3 posLocal, float cellM, float amplitudeM)` — décalage à
 *   ajouter à la composante verticale d'une position **locale** (avant
 *   `modelMatrix`), à partir de ses deux composantes horizontales.
 *
 * Usage type, dans `onBeforeCompile` :
 *
 * ```glsl
 * // #include <begin_vertex>, avant de calculer vScenePos :
 * transformed.y += lowPolyBump(transformed, uGrainCellM, uGrainAmplitudeM);
 *
 * // #include <normal_fragment_begin>, à la place de la normale analytique :
 * vec3 flatNormal = normalize(cross(dFdx(vScenePos), dFdy(vScenePos)));
 * if (dot(flatNormal, vSceneNormal) < 0.0) flatNormal = -flatNormal;
 * vec3 worldNormal = flatNormal;
 * ```
 *
 * `cellM` et `amplitudeM` à 0 désactive le grain (bruit non nul mais
 * multiplié par une amplitude nulle) : une matière sans entrée dans la table
 * du thème doit retomber sur ce cas, pas sur les valeurs de la roche.
 */
export const LOW_POLY_GRAIN_GLSL = `
float lowPolyHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float lowPolyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = lowPolyHash(i);
  float b = lowPolyHash(i + vec2(1.0, 0.0));
  float c = lowPolyHash(i + vec2(0.0, 1.0));
  float d = lowPolyHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float lowPolyBump(vec3 posLocal, float cellM, float amplitudeM) {
  if (cellM <= 0.0 || amplitudeM <= 0.0) return 0.0;
  return (lowPolyNoise(posLocal.xz / cellM) - 0.5) * 2.0 * amplitudeM;
}
`;
