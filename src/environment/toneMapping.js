/*
 * toneMapping — la courbe de sortie : ACES de three, puis un relevé de
 * saturation, dans le shader de chaque matériau (aucune passe plein écran).
 *
 * ACES écrase les tons moyens et les désature ; à l'exposition qu'exige le ciel
 * de Preetham, le sol de jour sortait presque noir. L'exposition remonte donc
 * le sol, la saturation rend la couleur que la courbe retire.
 *
 * Le moteur reproduit cette courbe sur le processeur (`acesFilmic`) pour
 * caler brouillard et raccord d'horizon sur ce que le ciel affiche : renderer
 * et `createWorld({ sky })` doivent recevoir les mêmes valeurs, d'où un seul
 * réglage, `TONE_MAPPING`, lu par les deux.
 */

export const TONE_MAPPING = Object.freeze({ exposure: 0.65, saturation: 1.15 });

/**
 * Règle le renderer sur la courbe du moteur. Réécrit le `CustomToneMapping`
 * de three, qui est global au module : tous les renderers de la page la
 * partagent.
 * @param {Object} THREE
 * @param {Object} renderer
 * @param {{exposure?: number, saturation?: number}} [tone]
 */
export function applyToneMapping(THREE, renderer, { exposure = TONE_MAPPING.exposure, saturation = TONE_MAPPING.saturation } = {}) {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const head = chunk.slice(0, chunk.indexOf('vec3 CustomToneMapping('));
  THREE.ShaderChunk.tonemapping_pars_fragment = `${head}vec3 CustomToneMapping( vec3 color ) {
	vec3 mapped = ACESFilmicToneMapping( color );
	float luma = dot( mapped, vec3( 0.2126, 0.7152, 0.0722 ) );
	return clamp( mix( vec3( luma ), mapped, ${Number(saturation).toFixed(4)} ), 0.0, 1.0 );
}
`;
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = exposure;
}
