/* Déformation partagée par le terrain et les plantes : même matière, pente,
 * masque routier, bruit et fondu. Les racines interpolent les sommets déformés,
 * jamais le bruit au milieu d’un triangle. La déformation indépendante de
 * la caméra est partagée avec la passe de préparation des appuis. */
import { LOW_POLY_GRAIN_GLSL } from './lowPolyGrain.js';
import { SURFACE_KINDS, SURFACE_ID_STEP, CLASS_PIXELS } from './groundClassMap.js';
export const TERRAIN_GRAIN_GLSL = `
           uniform float uGrainCellM;
           uniform float uGrainAmplitudeM;
           uniform vec2 uGrainFadeM;
           uniform sampler2D uSurfaceMap;
           uniform vec2 uSurfaceOrigin;
           uniform float uSurfaceSize;
           uniform float uSurfaceEnabled;
           uniform float uUnclassified;
           uniform float uSurfaceGrainCell[${SURFACE_KINDS.length}];
           uniform float uSurfaceGrainAmplitude[${SURFACE_KINDS.length}];
           uniform vec2 uSlopeRange;
           uniform vec2 uRockGrain;
           ${LOW_POLY_GRAIN_GLSL}

           /* Identifiant de matière au texel le plus proche — pas de lissage :
            * le grain est un déplacement géométrique, pas un contour, une
            * marche d'un texel à la limite de deux matières ne s'y voit pas
            * comme elle le ferait sur un aplat de couleur. textureLod et non
            * texture2D : au sommet il n'y a pas de dérivée, donc pas de niveau
            * implicite — three réécrit texture2D en texture, que GLSL ES 3.00
            * refuse dans cette étape. La carte n'a de toute façon qu'un seul
            * niveau (pas de mipmap). */
           float grainSurfaceIdAt(vec2 uv) {
             vec2 texel = floor(uv * ${CLASS_PIXELS}.0);
             float id = floor(
               textureLod(uSurfaceMap, (texel + 0.5) / ${CLASS_PIXELS}.0, 0.0).r * 255.0
                 / ${SURFACE_ID_STEP}.0 + 0.5
             );
             return id < 0.5 ? uUnclassified : id;
           }
vec3 terrainDisplacement(vec3 point, vec3 sourceNormal, float roadMask, out float steep, out float grain) {
           // Grain low poly : la matière est lue au pied du sommet, au texel
           // le plus proche — pas de lissage, le grain est un déplacement
           // géométrique, et la cubique du fragment ne sert qu'au tracé du
           // contour.
           vec3 grainPos = (modelMatrix * vec4(point, 1.0)).xyz;
           // La cellule et l'amplitude viennent de la matière au pied du
           // sommet, comme l'albédo — hors carte ou hors carreau, celle du
           // repli (uUnclassified), jamais un réglage neutre à part.
           float grainId = uUnclassified;
           if (uSurfaceEnabled > 0.5) {
             vec2 grainUv = (grainPos.xz - uSurfaceOrigin) / uSurfaceSize;
             if (grainUv.x > 0.0 && grainUv.x < 1.0 && grainUv.y > 0.0 && grainUv.y < 1.0) {
               grainId = grainSurfaceIdAt(grainUv);
             }
           }
           float grainCellM = uGrainCellM;
           float grainAmplitudeM = uGrainAmplitudeM;
           for (int i = 1; i <= ${SURFACE_KINDS.length}; i++) {
             if (float(i) == grainId) {
               grainCellM = uSurfaceGrainCell[i - 1];
               grainAmplitudeM = uSurfaceGrainAmplitude[i - 1];
             }
           }

           // Une paroi est de la roche, quoi qu'en dise la carte : la pente
           // la décrit là où la carte plane ne le peut pas. Même intervalle
           // que la teinte de roche du fragment, pour que la couleur et le
           // relief arrivent ensemble.
           vec3 grainNormal = normalize(mat3(modelMatrix) * sourceNormal);
           steep = smoothstep(uSlopeRange.x, uSlopeRange.y, 1.0 - clamp(grainNormal.y, 0.0, 1.0));
           grainCellM = mix(grainCellM, uRockGrain.x, steep);
           grainAmplitudeM = mix(grainAmplitudeM, uRockGrain.y, steep);

           // Pas d'accent grave ici : literal de gabarit. Le plan du bruit se
           // choisit dans le repere de la position locale, la pente dans celui
           // de la scene : deux normales, deux reperes.
           vec3 grainAxis = normalize(sourceNormal);
           grain = grainAmplitudeM * (1.0 - roadMask);
           return grainAxis * lowPolyBump(point, grainAxis, grainCellM, grainAmplitudeM) * (1.0 - roadMask);
}
vec3 terrainDisplaced(vec3 point, vec3 sourceNormal, float roadMask, out float steep, out float grain) {
  vec3 displacement = terrainDisplacement(point, sourceNormal, roadMask, steep, grain);
  float fade = lowPolyFade((modelMatrix * vec4(point, 1.0)).xyz, cameraPosition, uGrainFadeM.x, uGrainFadeM.y);
  grain *= fade;
  return point + displacement * fade;
}
`;
