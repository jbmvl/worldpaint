/*
 * aerialFog — la perspective aérienne, à la place du brouillard plat de three.
 * ---------------------------------------------------------------------------
 * `THREE.FogExp2` mélange **une seule couleur, la même dans toutes les
 * directions** : au fond, tout converge vers cette couleur, qu'on regarde le
 * soleil, le dos au soleil, ou une crête qui se découpe sur du bleu franc. Avec
 * une palette claire — et elle doit l'être, puisque c'est aussi la couleur de
 * l'horizon — le lointain devient un blanc uniforme. C'est le défaut que le
 * forum three.js décrit depuis des années : « avec le fog par défaut, les
 * objets lointains deviennent une couleur unie au lieu de se fondre dans le
 * fond ».
 *
 * Ce module remplace ce mélange par deux choses, toutes deux tirées de la
 * littérature (« Colored fog », Inigo Quilez ; les fils du forum three.js sur
 * l'accord brouillard/ciel ; les notes de Rune Skovbo Johansen sur la
 * perspective atmosphérique) :
 *
 * 1. **la cible du mélange dépend de la direction regardée**. À l'horizontale
 *    c'est exactement la couleur de la palette — l'invariant du raccord de
 *    l'horizon et du fond du renderer est donc intact, au pixel près. En
 *    montant vers la voûte elle rejoint une couleur de ciel plus profonde, et
 *    en direction du soleil elle prend la teinte de la lumière du moment.
 * 2. **l'extinction est calculée par canal**, pondérée par la diffusion de
 *    Rayleigh (∝ 1/λ⁴) : le rouge s'efface avant le bleu. Un objet lointain
 *    bleuit donc *avant* de pâlir, ce qui est l'ordre observé dans la nature —
 *    et l'inverse d'un fondu vers le blanc, où les trois canaux partent
 *    ensemble.
 *
 * Ce que ce module **ne fait pas** : il ne choisit aucune couleur. Le ciel haut
 * et la teinte du soleil sont *dérivés* de la couleur d'ambiance fournie par
 * l'application (voir `aerialSkyColor`) — la direction artistique reste dans le
 * thème, comme partout ailleurs.
 *
 * ## Pourquoi une greffe dans les ShaderChunk de three
 *
 * Le brouillard s'applique à **toutes** les matières de la scène, et le moteur
 * n'en possède qu'une partie : le terrain, le bâti et les couches végétales
 * sont des matières standard de three. Il n'y a donc pas d'autre point d'entrée
 * que les chunks `fog_*` et les uniforms partagés.
 *
 * Trois pièges, tous vérifiés dans le code de three 0.185 :
 *
 * - **les uniforms doivent être des objets simples `{x, y, z}`**, pas des
 *   `THREE.Color`. `UniformsUtils.clone` recopie une `Color` (chaque matière
 *   aurait la sienne, à charger une par une), mais transmet un objet quelconque
 *   **par référence** — une seule écriture met alors tout l'écran à jour. Le
 *   téléversement, lui, se fait par `setValueV3f`, qui reconnaît un `.x`.
 * - **on écrit dans `ShaderLib`, pas dans `UniformsLib`.** `ShaderLib` est
 *   construit par fusion de `UniformsLib` à l'import de three : y ajouter une
 *   clé après coup n'atteindrait plus aucune matière.
 * - **le brouillard est composité après le tone mapping**, dans l'espace de
 *   sortie du renderer ; c'est pourquoi three convertit `fogColor` avant de le
 *   téléverser. Ces couleurs-ci suivent exactement la même conversion
 *   (`Color.getRGB(…, SRGBColorSpace)`, qui respecte `ColorManagement.enabled`).
 *   L'hypothèse est un renderer qui sort en sRGB — le défaut de three. Une
 *   application qui rendrait vers une cible linéaire verrait ces trois couleurs
 *   trop claires, mais elle verrait déjà `fogColor` autrement.
 *
 * Les uniforms sont **partagés par module three**, donc par page : un second
 * ciel monté dans la même page écrirait dans les mêmes. C'est déjà l'hypothèse
 * du reste du moteur (une bulle, un ciel).
 *
 * GLSL 1.00 : three ne passe en `#version 300 es` que sur demande explicite
 * d'une matière. Pas de `transpose()` ici — l'inverse de la rotation de
 * `viewMatrix` est écrit à la main.
 */

/** Longueurs d'onde moyennes retenues pour R, G, B, en nanomètres. */
const WAVELENGTHS = [600, 550, 450];

/**
 * Poids relatifs de la diffusion de Rayleigh, normalisés à une moyenne de 1.
 *
 * La normalisation n'est pas cosmétique : ces poids **multiplient la densité**
 * du brouillard. À moyenne 1, la distance de disparition d'ensemble reste celle
 * que règle `fogRadius` et la météo ; seule sa répartition entre les canaux
 * change. Une moyenne différente déplacerait l'horizon sans que rien ne le dise.
 */
export const RAYLEIGH = (() => {
  const raw = WAVELENGTHS.map((nm) => 1 / nm ** 4);
  const mean = (raw[0] + raw[1] + raw[2]) / 3;
  return raw.map((v) => v / mean);
})();

/**
 * Part de la pondération de Rayleigh réellement appliquée, de 0 (extinction
 * neutre, le brouillard plat d'avant) à 1 (Rayleigh pur).
 *
 * Elle n'est pas à 1 parce que l'air d'un paysage n'est pas que du Rayleigh :
 * la brume et la poussière diffusent, elles, à peu près également toutes les
 * couleurs. À 1, un lointain d'après-midi vire au bleu de carte postale.
 * **C'est le premier bouton à tourner** si l'effet paraît trop faible ou trop
 * fort.
 */
export const RAYLEIGH_STRENGTH = 0.55;

/** Part de Rayleigh appliquée à la *teinte* du ciel haut. Même bouton, autre usage. */
const SKY_TINT = 0.45;

/**
 * Profondeur du ciel haut, en part du canal le plus fort de la couleur
 * d'horizon. Sous 1, la voûte est plus sombre que l'horizon — ce qu'elle est
 * toujours dehors, et ce qui évite le défaut décrit par Johansen : un lointain
 * *plus clair* que le ciel derrière lui, qui n'existe pas dans la nature.
 */
const SKY_DEPTH = 0.92;

/**
 * Ouverture du lobe de diffusion vers l'avant. Exposant du cosinus entre le
 * regard et le soleil : plus il est grand, plus le réchauffement se resserre
 * autour du disque.
 */
const SUN_FOCUS = 6;

/** Mélange maximal vers la teinte du soleil, plein soleil regardé de face. */
const SUN_TINT = 0.75;

/** Courbure de la montée horizon → ciel haut. Sous 1, elle mord dès quelques degrés. */
const SKY_CURVE = 0.55;

const luma = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/**
 * Ramène une couleur sous un plafond, sans toucher à sa teinte.
 *
 * Le plafond est le canal le plus fort de la couleur de brouillard : aucune des
 * couleurs dérivées ici ne peut donc être *plus lumineuse* que le brouillard
 * lui-même. C'est la garantie qui empêche l'effet de reproduire, par un autre
 * chemin, le blanc qu'il corrige — et accessoirement la seule façon de rester
 * dans le gamut, une teinte poussée à luminance constante finissant toujours
 * par écrêter un canal.
 *
 * @param {[number,number,number]} rgb
 * @param {number} ceiling
 * @returns {[number,number,number]}
 */
function fitUnder(rgb, ceiling) {
  const peak = Math.max(rgb[0], rgb[1], rgb[2]);
  if (peak <= 0) return [0, 0, 0];
  const scale = ceiling / peak;
  return [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
}

/**
 * Couleur de l'air vers le haut de la voûte, dérivée de celle de l'horizon.
 *
 * C'est le même air, vu à travers moins d'épaisseur : sa teinte est celle de
 * l'horizon rendue à la diffusion de Rayleigh, et sa luminance est plus basse.
 * Aucune couleur n'est inventée — changer la palette déplace celle-ci avec elle.
 *
 * @param {[number,number,number]} fog Couleur d'horizon, linéaire.
 * @returns {[number,number,number]} Linéaire.
 */
export function aerialSkyColor(fog) {
  const tinted = fog.map((c, i) => c * (1 + (RAYLEIGH[i] - 1) * SKY_TINT));
  return fitUnder(tinted, Math.max(fog[0], fog[1], fog[2]) * SKY_DEPTH);
}

/**
 * Couleur de l'air regardé dans l'axe du soleil.
 *
 * Teinte de la lumière du moment, luminance bornée par celle du brouillard :
 * en regardant le soleil, l'air se **réchauffe**, il ne s'éclaircit pas. Un
 * halo plus lumineux que le fond redonnerait exactement le lavis blanc qu'on
 * cherche à faire disparaître.
 *
 * @param {[number,number,number]} fog Couleur d'horizon, linéaire.
 * @param {[number,number,number]} sun Couleur de la lumière directe, linéaire.
 * @returns {[number,number,number]} Linéaire.
 */
export function aerialSunColor(fog, sun) {
  return fitUnder(sun, Math.max(fog[0], fog[1], fog[2]));
}

/**
 * Force du réchauffement solaire, de 0 à `SUN_TINT`.
 *
 * Deux causes l'éteignent, pour la même raison : il n'y a plus de disque à
 * regarder. Un ciel entièrement bouché n'a pas de halo — c'est ce qui distingue
 * un couvert d'un ciel voilé —, et la nuit non plus.
 *
 * @param {number} overcast Part de ciel bouché, de 0 à 1 (`overcastOf`).
 * @param {number} nightMix Part de nuit, de 0 à 1.
 */
export function sunTintAmount(overcast, nightMix) {
  return SUN_TINT * (1 - overcast) * (1 - nightMix);
}

const PARS_FRAGMENT = `
	uniform vec3 uFogSky;
	uniform vec3 uFogSunColor;
	uniform vec3 uFogSunDir;
	uniform float uFogSunAmount;
	uniform vec3 uFogChannel;
	varying vec3 vFogRay;
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	vec3 fogRay = normalize( vFogRay );

	// Cible du mélange. À l'horizontale (fogRay.y == 0) elle vaut exactement
	// fogColor : le raccord avec le ciel et le fond du renderer sont ceux
	// d'avant, au pixel près. Tout le reste est ce que ce module ajoute.
	vec3 fogTarget = mix( fogColor, uFogSky, pow( clamp( fogRay.y, 0.0, 1.0 ), ${SKY_CURVE.toFixed(2)} ) );
	float fogSun = pow( max( dot( fogRay, uFogSunDir ), 0.0 ), ${SUN_FOCUS.toFixed(1)} ) * uFogSunAmount;
	fogTarget = mix( fogTarget, uFogSunColor, fogSun );

	#ifdef FOG_EXP2

		float fogReach = fogDensity * vFogDepth;
		vec3 fogFactor = 1.0 - exp( - uFogChannel * fogReach * fogReach );

	#else

		vec3 fogFactor = clamp( uFogChannel * smoothstep( fogNear, fogFar, vFogDepth ), 0.0, 1.0 );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTarget, fogFactor );

#endif
`;

const PARS_VERTEX = `
	varying vec3 vFogRay;
`;

const VERTEX = /* glsl */ `
	// Direction regardée, en repère monde. On la reconstruit depuis mvPosition
	// plutôt que depuis modelMatrix * transformed : la matrice d'une instance
	// n'entre que dans mvPosition, et tout le décor est instancié. La rotation
	// de viewMatrix étant orthonormée, sa transposée est son inverse — écrite à
	// la main, GLSL 1.00 n'ayant pas la fonction qui la donnerait.
	mat3 fogView = mat3( viewMatrix );
	vFogRay = vec3( dot( fogView[ 0 ], mvPosition.xyz ), dot( fogView[ 1 ], mvPosition.xyz ), dot( fogView[ 2 ], mvPosition.xyz ) );
`;

/** Marqueur de greffe : le nom d'un uniform qui n'existe que par ce module. */
const MARK = 'uFogSky';

/**
 * Greffe les chunks. Idempotent : deux mondes dans une page ne doublent pas la
 * déclaration des uniforms, ce qui ne compilerait pas.
 * @param {Object} THREE
 */
function patchChunks(THREE) {
  const chunk = THREE.ShaderChunk;
  if (chunk.fog_pars_fragment.includes(MARK)) return;

  chunk.fog_pars_vertex = chunk.fog_pars_vertex.replace(
    'varying float vFogDepth;',
    `varying float vFogDepth;\n${PARS_VERTEX}`
  );
  chunk.fog_vertex = chunk.fog_vertex.replace(
    'vFogDepth = - mvPosition.z;',
    `vFogDepth = - mvPosition.z;\n${VERTEX}`
  );
  chunk.fog_pars_fragment = chunk.fog_pars_fragment.replace(
    'varying float vFogDepth;',
    `varying float vFogDepth;\n${PARS_FRAGMENT}`
  );
  chunk.fog_fragment = FRAGMENT;
}

/** Un jeu d'uniforms partagés par module three. */
const registry = new WeakMap();

/**
 * Publie les uniforms dans toutes les matières de `ShaderLib` qui ont du
 * brouillard — donc dans toutes celles qui en auront, la copie étant faite au
 * moment où le programme est construit, pas à la création de la matière.
 * @param {Object} THREE
 */
function shareUniforms(THREE) {
  const existing = registry.get(THREE);
  if (existing) return existing;

  const shared = {
    uFogSky: { value: { x: 1, y: 1, z: 1 } },
    uFogSunColor: { value: { x: 1, y: 1, z: 1 } },
    uFogSunDir: { value: { x: 0, y: 1, z: 0 } },
    uFogSunAmount: { value: 0 },
    uFogChannel: {
      value: {
        x: 1 + (RAYLEIGH[0] - 1) * RAYLEIGH_STRENGTH,
        y: 1 + (RAYLEIGH[1] - 1) * RAYLEIGH_STRENGTH,
        z: 1 + (RAYLEIGH[2] - 1) * RAYLEIGH_STRENGTH,
      },
    },
  };

  for (const shader of Object.values(THREE.ShaderLib)) {
    if (!shader?.uniforms?.fogColor) continue;
    Object.assign(shader.uniforms, shared);
  }
  registry.set(THREE, shared);
  return shared;
}

/**
 * La perspective aérienne d'une scène : la greffe, et les trois couleurs à lui
 * repasser à chaque changement d'heure ou de météo.
 */
export class AerialFog {
  /** @param {Object} THREE Le module three de l'application. */
  constructor(THREE) {
    patchChunks(THREE);
    this.uniforms = shareUniforms(THREE);
    /** Couleur de travail : la conversion vers l'espace de sortie passe par elle. */
    this._color = new THREE.Color();
    this._space = THREE.SRGBColorSpace;
    this._encoded = { r: 0, g: 0, b: 0 };
  }

  /**
   * @param {Object} state
   * @param {[number,number,number]} state.skyColor Air vers le haut, linéaire.
   * @param {[number,number,number]} state.sunColor Air dans l'axe du soleil, linéaire.
   * @param {{x:number,y:number,z:number}} state.sunDir Direction du soleil, repère monde.
   * @param {number} state.sunAmount Force du réchauffement, de 0 à 1.
   */
  update({ skyColor, sunColor, sunDir, sunAmount }) {
    this._write(this.uniforms.uFogSky.value, skyColor);
    this._write(this.uniforms.uFogSunColor.value, sunColor);
    const dir = this.uniforms.uFogSunDir.value;
    dir.x = sunDir.x;
    dir.y = sunDir.y;
    dir.z = sunDir.z;
    this.uniforms.uFogSunAmount.value = sunAmount;
  }

  /**
   * Écrit une couleur linéaire dans un uniform, convertie **comme three
   * convertit `fogColor`** : le brouillard est composité après le tone mapping.
   */
  _write(target, rgb) {
    this._color.setRGB(rgb[0], rgb[1], rgb[2]);
    this._color.getRGB(this._encoded, this._space);
    target.x = this._encoded.r;
    target.y = this._encoded.g;
    target.z = this._encoded.b;
  }
}
