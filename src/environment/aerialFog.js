/*
 * aerialFog — la perspective aérienne, à la place du brouillard plat de three.
 * `THREE.FogExp2` mélange une seule couleur dans toutes les directions : avec
 * une palette claire, le lointain devient un blanc uniforme.
 *
 * Ce module remplace ce mélange par deux choses : la cible du mélange dépend
 * de la direction regardée (couleur de palette à l'horizontale, ciel plus
 * profond vers la voûte, teinte solaire vers le soleil) et l'extinction est
 * calculée par canal, pondérée par la diffusion de Rayleigh (∝ 1/λ⁴) — le
 * rouge s'efface avant le bleu, comme dans la nature. Aucune couleur n'est
 * choisie ici : ciel haut et teinte solaire sont dérivés de l'ambiance
 * fournie par l'application (`aerialSkyColor`).
 *
 * Greffé dans les `ShaderChunk` de three (seul point d'entrée pour toucher
 * toutes les matières de la scène, y compris les matières standard).
 * Trois pièges vérifiés sur three 0.185 : les uniforms doivent être des
 * objets simples `{x,y,z}` (pas `THREE.Color`, transmis par référence) ;
 * on écrit dans `ShaderLib`, pas `UniformsLib` (fusionné trop tôt) ; le
 * brouillard est composité après le tone mapping, donc ces couleurs suivent
 * la même conversion sRGB que `fogColor`.
 *
 * Uniforms partagés par module three (donc par page). GLSL 1.00 : pas de
 * `transpose()`, l'inverse de la rotation de `viewMatrix` est écrit à la main.
 */

/** Longueurs d'onde moyennes retenues pour R, G, B, en nanomètres. */
const WAVELENGTHS = [600, 550, 450];

/**
 * Poids relatifs de la diffusion de Rayleigh, normalisés à une moyenne de 1
 * (ces poids multiplient la densité du brouillard — une moyenne différente
 * déplacerait l'horizon).
 */
export const RAYLEIGH = (() => {
  const raw = WAVELENGTHS.map((nm) => 1 / nm ** 4);
  const mean = (raw[0] + raw[1] + raw[2]) / 3;
  return raw.map((v) => v / mean);
})();

/**
 * Part de la pondération de Rayleigh réellement appliquée, de 0 (extinction
 * neutre) à 1 (Rayleigh pur — brume et poussière diffusant plutôt
 * uniformément, 1 virerait au bleu de carte postale).
 */
export const RAYLEIGH_STRENGTH = 0.55;

/** Part de Rayleigh appliquée à la *teinte* du ciel haut. Même bouton, autre usage. */
const SKY_TINT = 0.45;

/** Profondeur du ciel haut, en part du canal le plus fort de la couleur d'horizon (sous 1, la voûte est plus sombre que l'horizon). */
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
 * Ramène une couleur sous un plafond, sans toucher à sa teinte (empêche les
 * couleurs dérivées d'être plus lumineuses que le brouillard lui-même).
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
 * Couleur de l'air vers le haut de la voûte, dérivée de celle de l'horizon
 * (même air, vu à travers moins d'épaisseur : teinte Rayleigh, luminance plus basse).
 *
 * @param {[number,number,number]} fog Couleur d'horizon, linéaire.
 * @returns {[number,number,number]} Linéaire.
 */
export function aerialSkyColor(fog) {
  const tinted = fog.map((c, i) => c * (1 + (RAYLEIGH[i] - 1) * SKY_TINT));
  return fitUnder(tinted, Math.max(fog[0], fog[1], fog[2]) * SKY_DEPTH);
}

/**
 * Couleur de l'air regardé dans l'axe du soleil : teinte de la lumière du
 * moment, luminance bornée par celle du brouillard (l'air se réchauffe, il
 * ne s'éclaircit pas).
 *
 * @param {[number,number,number]} fog Couleur d'horizon, linéaire.
 * @param {[number,number,number]} sun Couleur de la lumière directe, linéaire.
 * @returns {[number,number,number]} Linéaire.
 */
export function aerialSunColor(fog, sun) {
  return fitUnder(sun, Math.max(fog[0], fog[1], fog[2]));
}

/**
 * Force du réchauffement solaire, de 0 à `SUN_TINT`. Éteinte par un ciel
 * entièrement bouché ou par la nuit : plus de disque à regarder.
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

	// Cible du mélange. À l'horizontale (fogRay.y == 0) elle vaut exactement fogColor.
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
	// Direction regardée, en repère monde, reconstruite depuis mvPosition (la
	// matrice d'instance n'entre que là). Transposée de viewMatrix écrite à la
	// main (orthonormée, donc son inverse) : GLSL 1.00 n'a pas la fonction dédiée.
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

/** Publie les uniforms dans toutes les matières de `ShaderLib` qui ont du brouillard. @param {Object} THREE */
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
