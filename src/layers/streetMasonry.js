/*
 * streetMasonry — joints des dalles de caniveau et des éléments de bordure.
 *
 * Les joints sont peints par la matière de la voirie, pas posés en triangles.
 * Chaque sommet d'une bordure porte un repère (`streetJoint`) : son abscisse
 * le long du réseau, sa distance à la rive de la chaussée et sa hauteur dans
 * la section. Le fragment en déduit le pas (dalle de caniveau ou bloc de
 * béton) et sa distance au joint le plus proche.
 *
 * Deux décisions à ne pas défaire :
 *
 * - **pas de géométrie par joint.** Un joint de 8 mm par dalle découpait le
 *   caniveau en milliers de triangles par rue : neuf sommets sur dix de la
 *   voirie d'un bourg, pour un trait qui passe sous le pixel à quelques mètres.
 *   C'était le plus gros maillage du décor, et un pic de tableaux au montage ;
 * - **la ligne garde sa largeur vraie.** Plus fine qu'un pixel, elle n'est pas
 *   grossie : sa couverture s'éclaircit d'autant (`JOINT_FRAGMENT`), comme le
 *   ferait un suréchantillonnage. Au loin, le caniveau prend la teinte moyenne
 *   des dalles et de leurs joints, sans scintiller.
 *
 * La phase suit l'abscisse du réseau ; un coin de rue sans abscisse s'ancre à
 * sa position quantifiée. Seules les faces au niveau du support (`up` nul :
 * caniveau, contact, dessus du béton) portent des joints.
 */
import { srgb } from '../core/color.js';

/** Repère d'un sommet sans joint (chaussée, comblement, face verticale du béton). */
export const NO_JOINT = Object.freeze([0, -1, 0]);

/**
 * Abscisse de chaque sommet de la polyligne : celle du réseau quand le point
 * la porte, sinon une abscisse ancrée sur la position quantifiée du départ.
 */
export function abscissesVoirie(points) {
  const abscisses = [];
  let distance = Math.round(points[0].x * 10) / 10 + Math.round(points[0].z * 10) / 10;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    abscisses.push(Number.isFinite(points[i].distance) ? points[i].distance : distance);
  }
  return abscisses;
}

/**
 * Repères des sommets d'une section posée par `appendProfile` (ligne par
 * ligne, colonne par colonne) : trois nombres par sommet, ajoutés à `cible`.
 */
export function reperesJoints(cible, { points, profil, demiLargeur }) {
  const abscisses = abscissesVoirie(points);
  for (let r = 0; r < points.length; r++) {
    for (const sommet of profil) {
      cible.push(abscisses[r], Math.abs(sommet.across) - demiLargeur, sommet.up);
    }
  }
}

/** Complète les repères jusqu'à `sommets` sommets avec `NO_JOINT`. */
export function completerReperes(cible, sommets) {
  while (cible.length < sommets * 3) cible.push(NO_JOINT[0], NO_JOINT[1], NO_JOINT[2]);
}

// Couverture d'un trait de largeur vraie `w` (m) à distance `d` de son axe,
// sur un pixel qui couvre `px` mètres d'abscisse : bord adouci d'un pixel,
// trait plus fin qu'un pixel éclairci d'autant au lieu d'être grossi.
const JOINT_FRAGMENT = `
if (vStreetJoint.y >= 0.0 && vStreetJoint.z > -0.001) {
  float jointStep = vStreetJoint.y < uJointStyle.x ? uJointStyle.y : uJointStyle.z;
  float jointPx = max(fwidth(vStreetJoint.x), 1e-5);
  float jointDist = abs(fract(vStreetJoint.x / jointStep + 0.5) - 0.5) * jointStep;
  float jointDrawn = max(uJointStyle.w, jointPx);
  float jointCover = (1.0 - smoothstep(0.5 * (jointDrawn - jointPx), 0.5 * (jointDrawn + jointPx), jointDist))
    * (uJointStyle.w / jointDrawn);
  diffuseColor.rgb = mix(diffuseColor.rgb, uJointColor * diffuse, jointCover);
}`;

/**
 * Fait peindre les joints par une matière à couleurs de sommet (la voirie).
 * La teinte du joint suit la couleur de la matière (mouillure).
 */
export function peindreJoints(material, style) {
  const tone = srgb(style.joint ?? style.gutter);
  const uniforms = {
    uJointColor: { value: [tone[0], tone[1], tone[2]] },
    uJointStyle: { value: [style.gutterWidth, style.gutterSlabLength, style.kerbBlockLength, style.jointWidth] },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uJointColor = uniforms.uJointColor;
    shader.uniforms.uJointStyle = uniforms.uJointStyle;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 streetJoint;\nvarying vec3 vStreetJoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStreetJoint = streetJoint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStreetJoint;\nuniform vec3 uJointColor;\nuniform vec4 uJointStyle;')
      .replace('#include <color_fragment>', `#include <color_fragment>${JOINT_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'street-joints';
  return material;
}
