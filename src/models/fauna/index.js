/*
 * fauna — le catalogue du vivant, et ce qui le fait bouger.
 * ---------------------------------------------------------
 * Rassemble les modèles (`livestock`, `wildlife`), les constantes de
 * locomotion de chaque espèce, et le matériau qui anime les membres dans le
 * shader.
 *
 * ## Ce qui est ici et ce qui n'y est pas
 *
 * Ici : la **forme** et ce qui s'en déduit mécaniquement — la foulée d'une
 * bête tient à la longueur de ses pattes, l'angle de broutage à celle de son
 * encolure. Ailleurs : où la bête se pose (`furniturePlacement`), ce qu'elle
 * décide de faire (`faunaMotion`), et sa robe (`theme.fauna.coats`).
 *
 * ## L'angle de broutage n'est pas un réglage
 *
 * Il est **calculé** à partir du pivot d'encolure et du museau déclarés par
 * le modèle (`grazeAngleFor`). C'est délibéré : à chaque fois qu'une encolure
 * a été retouchée, un angle tenu à la main aurait cessé d'être juste sans que
 * rien ne le signale — sauf une vache broutant trente centimètres au-dessus
 * de l'herbe, ce qui ne se voit qu'à l'œil et trop tard. Ne pas le remplacer
 * par une constante.
 *
 * ## L'animation vit dans le shader
 *
 * Voir l'en-tête d'`animalKit` pour le pourquoi. Ici, le comment : chaque
 * instance porte `aMotion = (phase, swing, head)` —
 *
 * - `phase` : où en est la foulée, en radians, avancée par `faunaLayer` au
 *   prorata du chemin **réellement** parcouru (sinon les pattes patinent) ;
 * - `swing` : l'amplitude du balancier, en radians. Nulle, la bête est
 *   immobile ; c'est donc aussi le curseur marche/galop ;
 * - `head` : le tangage de l'encolure, en radians. Nul, la tête est haute.
 *
 * Trois flottants par bête et par image, un seul appel de dessin par espèce.
 */

import { defaultTheme } from '../../themes/default.js';
import { LIMB_ATTRIBUTE, PIVOT_ATTRIBUTE, COAT_ATTRIBUTE, MOTION_ATTRIBUTE } from '../animalKit.js';
import { cow, sheep, goat, horse, donkey, chicken } from './livestock.js';
import { deer, doe, reindeer, boar, fox, wolf, bear } from './wildlife.js';

/** Les modèles, par espèce. */
export const FAUNA_BUILDERS = { cow, sheep, goat, horse, donkey, chicken, deer, doe, reindeer, boar, fox, wolf, bear };

/** Les espèces du catalogue, dans l'ordre du fichier. */
export const FAUNA_KINDS = Object.keys(FAUNA_BUILDERS);

/**
 * Hauteur à laquelle le museau doit descendre pour qu'on lise « elle broute »,
 * en mètres. Pas zéro : l'herbe du décor fait dix à vingt centimètres
 * (`theme.grass`), un museau au ras du sol s'y enfonce.
 */
export const GRAZE_TARGET_M = 0.09;

/**
 * Rabattement maximal d'une encolure, en radians. Au-delà, la tête traverse
 * le poitrail — un tour de cou qu'aucune bête ne fait et que rien ici
 * n'empêcherait autrement.
 */
export const GRAZE_MAX_RAD = 2.0;

/**
 * Angle de rabattement qui amène le museau à `target`, en radians.
 *
 * Le museau décrit un cercle autour du pivot d'encolure. Sa hauteur vaut
 * `pivot.y + R·cos(θ + φ)` avec `R` la distance pivot→museau et `φ` son
 * inclinaison au repos : l'angle cherché s'en tire en forme close, sans
 * balayage. Quand l'encolure est trop courte pour atteindre la cible, on rend
 * l'angle qui descend le plus bas — une bête qui tend le cou au maximum, ce
 * qui reste juste, plutôt qu'une bête qui ne bouge pas.
 *
 * Fonction pure.
 *
 * @param {{headPivot:number[]|null, muzzlePoint:number[]|null}} model
 * @param {number} [target] Hauteur visée pour le museau, en mètres.
 * @returns {number} Angle dans [0, `GRAZE_MAX_RAD`].
 */
export function grazeAngleFor(model, target = GRAZE_TARGET_M) {
  const pivot = model?.headPivot;
  const muzzle = model?.muzzlePoint;
  if (!pivot || !muzzle) return 0;

  const dy = muzzle[1] - pivot[1];
  const dz = muzzle[2] - pivot[2];
  const reach = Math.hypot(dy, dz);
  if (reach <= 1e-6) return 0;

  const phase = Math.atan2(dz, dy);
  const wanted = (target - pivot[1]) / reach;
  // Hors de [-1, 1] : la cible est hors d'atteinte, l'angle du plus bas est
  // celui qui met le museau à l'opposé exact du pivot.
  const angle = wanted < -1 ? Math.PI - phase : Math.acos(Math.max(-1, Math.min(1, wanted))) - phase;
  return Math.max(0, Math.min(GRAZE_MAX_RAD, angle));
}

/**
 * Ce qu'il faut savoir d'une espèce pour la faire marcher.
 *
 * - `family`  décide des conduites possibles (voir `faunaMotion`) ;
 * - `strideM` est la distance parcourue en un cycle complet de foulée. C'est
 *   elle qui accorde les pattes au déplacement : trop courte, la bête
 *   trottine sur place ; trop longue, elle patine ;
 * - `swingRad` est l'ouverture du balancier au pas. Le galop la multiplie ;
 * - `walkMS` / `runMS` sont les allures, en mètres par seconde ;
 * - `roam`    étire ou resserre le rayon des circuits (`faunaMotion`). Les
 *   conduites sont décrites en mètres absolus, ce qui va pour du bétail et
 *   pas du tout pour une poule : la même « marche » de vingt mètres emmène
 *   une vache au bout de son pré et une poule à l'autre bout du hameau.
 *
 * Les valeurs viennent des proportions du modèle, pas d'un catalogue
 * zoologique : ce qui compte est qu'un pas fasse avancer d'une longueur de
 * patte, et une longueur de patte se lit dans le fichier d'à côté.
 */
export const FAUNA_SPECIES = {
  cow: { roam: 1, family: 'grazer', strideM: 1.5, swingRad: 0.4, walkMS: 1.0, runMS: 3.4 },
  sheep: { roam: 0.85, family: 'grazer', strideM: 0.85, swingRad: 0.45, walkMS: 0.8, runMS: 3.0 },
  goat: { roam: 0.85, family: 'grazer', strideM: 0.85, swingRad: 0.48, walkMS: 0.85, runMS: 3.2 },
  horse: { roam: 1.25, family: 'grazer', strideM: 2.0, swingRad: 0.42, walkMS: 1.5, runMS: 6.5 },
  donkey: { roam: 1, family: 'grazer', strideM: 1.4, swingRad: 0.42, walkMS: 1.2, runMS: 4.5 },
  // La poule n'a que deux pattes et picore au lieu de brouter : sa foulée est
  // courte et rapide, et elle ne quitte pas la cour — d'où le plus petit
  // rayon d'errance du catalogue, et de loin.
  chicken: { roam: 0.18, family: 'fowl', strideM: 0.32, swingRad: 0.55, walkMS: 0.45, runMS: 1.6 },

  deer: { roam: 1.2, family: 'cervid', strideM: 1.6, swingRad: 0.46, walkMS: 1.2, runMS: 7.0 },
  doe: { roam: 1.2, family: 'cervid', strideM: 1.45, swingRad: 0.46, walkMS: 1.2, runMS: 7.0 },
  reindeer: { roam: 1.2, family: 'cervid', strideM: 1.7, swingRad: 0.44, walkMS: 1.2, runMS: 6.0 },
  boar: { roam: 0.9, family: 'boar', strideM: 1.0, swingRad: 0.42, walkMS: 0.9, runMS: 5.5 },

  // Les carnivores ne broutent pas : leur tête plonge pour flairer, moins bas
  // et bien moins longtemps. `faunaMotion` en tire des conduites différentes.
  fox: { roam: 1.1, family: 'canid', strideM: 0.8, swingRad: 0.58, walkMS: 1.0, runMS: 6.0 },
  wolf: { roam: 1.4, family: 'canid', strideM: 1.4, swingRad: 0.56, walkMS: 1.4, runMS: 8.0 },
  bear: { roam: 1.2, family: 'bear', strideM: 1.5, swingRad: 0.34, walkMS: 1.1, runMS: 5.5 },
};

/**
 * Les géométries du catalogue, plus l'angle de broutage propre à chacune.
 *
 * @returns {{geometries:Object, grazeRad:Object}}
 */
export function createFaunaGeometries(THREE, colors = defaultTheme.fauna.colors) {
  const geometries = {};
  const grazeRad = {};
  for (const [name, build] of Object.entries(FAUNA_BUILDERS)) {
    const model = build(colors);
    geometries[name] = model.toGeometry(THREE, `fauna-${name}`);
    grazeRad[name] = grazeAngleFor(model);
  }
  return { geometries, grazeRad };
}

/**
 * Le matériau du vivant : lambertien à couleurs de sommet, comme le mobilier,
 * plus deux choses que le mobilier n'a pas.
 *
 * ## L'articulation
 *
 * Chaque sommet tourne autour du pivot de son membre, d'un angle déduit de
 * `aMotion`. Position **et** normale : sans la seconde, une patte pliée
 * garde l'éclairage de la patte droite et le mouvement se voit à peine.
 *
 * ## La teinte d'instance, mais pas partout
 *
 * three multiplie `instanceColor` dans **toute** la couleur de sommet dès que
 * `setColorAt` a servi une fois. Ici c'est faux : une vache brune n'a pas de
 * sabots bruns, ni un cerf des bois fauves. `aCoat` rétablit la couleur brute
 * là où la robe ne porte pas — les sommets de robe, eux, sont des gris que la
 * teinte transforme en couleur (voir `robe`).
 *
 * Un maillage sans `setColorAt` retomberait sur ces gris et rendrait des
 * bêtes en plâtre : `faunaLayer` teinte donc **toutes** ses instances, sans
 * exception.
 */
export function createFaunaMaterial(THREE) {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Les volumes sont fermés et orientés : pas besoin des deux faces, et une
    // seule évite qu'une patte s'éclaire à travers le flanc.
    side: THREE.FrontSide,
  });
  material.name = 'fauna';

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float ${LIMB_ATTRIBUTE};
         attribute vec3 ${PIVOT_ATTRIBUTE};
         attribute float ${COAT_ATTRIBUTE};
         attribute vec3 ${MOTION_ATTRIBUTE};

         mat3 faunaRotX(float a) {
           float c = cos(a), s = sin(a);
           return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
         }
         mat3 faunaRotZ(float a) {
           float c = cos(a), s = sin(a);
           return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
         }

         mat3 faunaJointRotation() {
           float phase = ${MOTION_ATTRIBUTE}.x;
           float swing = ${MOTION_ATTRIBUTE}.y;
           float head  = ${MOTION_ATTRIBUTE}.z;

           // Le tronc ne tourne pas : c'est lui le repère de tous les autres.
           if (${LIMB_ATTRIBUTE} < 0.5) return mat3(1.0);

           float pitch = 0.0;
           float roll = 0.0;

           if (${LIMB_ATTRIBUTE} < 4.5) {
             // Les diagonales vont ensemble : antérieure gauche avec
             // postérieure droite. C'est l'allure de tout quadrupède au pas,
             // et la seule qui ne se lise pas comme un jouet mécanique.
             float opposed = (${LIMB_ATTRIBUTE} < 1.5 || ${LIMB_ATTRIBUTE} > 3.5) ? 0.0 : PI;
             // L'arrière-main pousse, l'avant-main porte : elle ouvre plus.
             float gain = (${LIMB_ATTRIBUTE} > 2.5) ? 1.15 : 1.0;
             pitch = swing * gain * sin(phase + opposed);
           } else if (${LIMB_ATTRIBUTE} < 5.5) {
             // L'encolure : le rabattement voulu, plus le hochement du pas.
             pitch = head + swing * 0.1 * sin(phase * 2.0 + 0.6);
           } else if (${LIMB_ATTRIBUTE} < 6.5) {
             // La queue balaie même à l'arrêt — c'est ce qui distingue une
             // bête au pré d'une statue de bête au pré.
             roll = 0.16 * sin(phase * 0.8 + 1.7) + swing * 0.45 * sin(phase);
             pitch = -swing * 0.3;
           } else {
             // Les oreilles : le seul mouvement visible d'une bête qui broute.
             roll = 0.26 * sin(phase * 2.7 + 0.4) * (0.35 + swing);
           }
           return faunaRotZ(roll) * faunaRotX(pitch);
         }`
      )
      // La teinte d'instance ne porte que sur la robe. `color` est l'attribut
      // brut, encore intact à ce point du chunk.
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
         #ifdef USE_INSTANCING_COLOR
           vColor.xyz = mix(color.xyz, vColor.xyz, ${COAT_ATTRIBUTE});
         #endif`
      )
      // Les deux greffes sont **autonomes** : chacune recalcule la rotation
      // plutôt que de partager une variable. C'est délibéré et ça vaut ses
      // quelques sinus par sommet — dans le shader du `MeshBasicMaterial`,
      // `<beginnormal_vertex>` est déjà enfermé dans un `#if`, et une
      // variable déclarée là ne serait pas en portée à `<begin_vertex>`. On
      // ne peut pas garantir que celui du lambertien ne le sera jamais, et
      // l'échec serait une erreur de compilation, pas un rendu approximatif.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         objectNormal = faunaJointRotation() * objectNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed = ${PIVOT_ATTRIBUTE} + faunaJointRotation() * (transformed - ${PIVOT_ATTRIBUTE});`
      );
  };
  material.customProgramCacheKey = () => 'fauna';

  return material;
}
