/*
 * lowPolyGrain — le grain géométrique du sol : un bruit de valeur qui bosselle
 * la position au sommet, et une normale reprise par dérivées d'écran pour lire
 * des facettes plutôt qu'un dégradé lissé.
 *
 * Branché par `terrainMaterial` : la matière est lue **au sommet**, au texel le
 * plus proche de `uSurfaceMap` (la cubique du fragment ne sert qu'au tracé du
 * contour, et arrive de toute façon trop tard pour bosseler une position).
 * Cellule et amplitude viennent du thème, une entrée `grain` par matière de
 * `SURFACE_KINDS` ; une matière sans entrée reste à zéro, donc lisse.
 *
 * La normale plate ne vaut **que là où l'amplitude est non nulle** (varying
 * `vGrain`). Ailleurs, la position n'ayant pas bougé, les dérivées d'écran ne
 * rendraient que le facettage de la maille du terrain, et c'est la normale
 * analytique qui décrit la surface.
 *
 * Une cellule large et une amplitude forte se lisent comme une ondulation
 * (des « collines », pas des facettes) : c'est le bon réglage pour une paroi
 * rocheuse, pas pour un sol bas.
 *
 * Purement visuel : aucune lecture d'altitude ailleurs dans le moteur n'en
 * tient compte (routes, bâti, haies, `cliffCut`, placement). Un objet posé au
 * niveau naturel ne suit pas la bosse et peut sembler flotter ou s'enfoncer à
 * son pied — c'est la limite connue, et la raison de garder l'amplitude
 * modeste hors des matières minérales.
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
