/*
 * skyDome — la voûte, en propre. Remplace le `Sky.js` de three (modèle de
 * Preetham) par ce qu'un décor en aplats demande : deux couleurs peintes, une
 * rampe entre elles, et des nuages à bord franc.
 *
 * Le module ne choisit **aucune** couleur : l'horizon, le zénith, le nuage et
 * les deux couleurs de nuit lui arrivent de la palette (`themes/default.js`,
 * tranche `sky`) via `SceneEnvironment`. Ce qu'il décide est la géométrie du
 * ciel — où passe la rampe, où s'arrêtent les nuages, ce que le soleil ajoute.
 *
 * ## Ce que la bascule a coûté, et pourquoi on l'accepte
 *
 * Preetham donnait gratuitement le rougissement du couchant, l'assombrissement
 * du zénith et la couronne de Mie. Tout cela est maintenant peint ou approché
 * (`skyModel.skyParameters`). En échange la voûte tient dans la plage
 * d'affichage — elle n'exige plus de tone mapping pour ne pas être blanche —
 * et sa couleur est celle de la palette, pas celle qu'un calcul de diffusion a
 * bien voulu produire.
 *
 * ## Trois décisions à ne pas défaire par inadvertance
 *
 * 1. **Les nuages sont projetés sur un plan** (`direction.xz / direction.y`),
 *    pas plaqués sur la sphère : c'est ce qui les fait converger vers
 *    l'horizon comme une couche d'altitude, et non tourner autour du zénith.
 * 2. **Leur bord est court** (deux seuils séparés de quelques centièmes) :
 *    c'est tout ce qui sépare un aplat d'un nuage de brume. Élargir la
 *    transition « pour adoucir » redonne le dégradé qu'on est venu enlever.
 * 3. **La couverture répond sur toute sa course.** Le masque du `Sky.js` de
 *    three saturait vers 0,5, ce que la démo corrigeait par une table de
 *    calibrage ; le seuil est ici linéaire en `cloudCover`, et cette table n'a
 *    plus lieu d'être.
 *
 * Le contenu nocturne (lune en croissant, semis d'étoiles, étoile filante) est
 * repris tel quel de la greffe qui vivait dans `sceneEnvironment` : il était
 * déjà à nous, il n'avait rien de Preetham.
 */

/** Rayon du dôme (il suit la caméra, donc toujours à cette distance exacte). */
export const SKY_RADIUS = 8000;

/**
 * Largeur de la bande, en sinus d'élévation, sur laquelle la voûte rejoint la
 * couleur du brouillard, et poids maximal de ce raccord.
 *
 * Le poids n'est pas total : à 1, le halo d'un soleil rasant disparaîtrait
 * sous le brouillard au moment précis où il est le plus visible.
 */
const HORIZON_BAND = 0.18;
const HORIZON_BLEND = 0.7;

/** Échelle et dérive des nuages dans le plan projeté (unités arbitraires, réglées à l'œil). */
const CLOUD_SCALE = 0.55;
const CLOUD_DRIFT = 0.004;

const VERTEX = /* glsl */ `
  varying vec3 vRay;

  void main() {
    // Position du sommet en repère monde : le dôme suit la caméra, donc cette
    // position *est* la direction regardée, à la translation près.
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vRay = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vRay;

  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCloud;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uCurve;
  uniform float uSunset;
  uniform float uGlow;
  uniform float uGlowFocus;
  uniform float uCloudCover;
  uniform float uCloudDensity;
  uniform float uTime;

  uniform vec3 uNightZenith;
  uniform vec3 uNightHorizon;
  uniform vec3 uMoonDirection;
  uniform float uNightMix;

  uniform vec3 uFogColor;
  uniform float uHorizonBlend;

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
  }

  /** Bruit de valeur, interpolation lissée. */
  float valueNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  /** Quatre octaves : assez pour un contour découpé, pas assez pour du duvet. */
  float fbm( vec2 p ) {
    float sum = 0.0;
    float amp = 0.5;
    for ( int i = 0; i < 4; i ++ ) {
      sum += valueNoise( p ) * amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 direction = normalize( vRay );
    float up = clamp( direction.y, 0.0, 1.0 );

    // --- Le jour : deux couleurs et une rampe ---------------------------------
    vec3 color = mix( uHorizon, uZenith, pow( up, uCurve ) );

    // Le côté du soleil, lu à l'azimut seul : la bande basse se réchauffe de ce
    // côté-là et pas de l'autre, ce qui est la moitié de ce qui fait un soir.
    vec2 flatDir = normalize( vec2( direction.x, direction.z ) + 1e-6 );
    vec2 flatSun = normalize( vec2( uSunDirection.x, uSunDirection.z ) + 1e-6 );
    float toSun = max( dot( flatDir, flatSun ), 0.0 );
    float lowBand = 1.0 - smoothstep( 0.0, 0.4, up );
    color = mix( color, uSunColor, uSunset * toSun * toSun * lowBand );

    // Halo : ajouté, pas mélangé — c'est de la lumière en plus, pas une teinte.
    float glow = pow( max( dot( direction, uSunDirection ), 0.0 ), uGlowFocus );
    color += uSunColor * glow * uGlow;

    // --- Les nuages : une couche d'altitude, à bord franc ---------------------
    // Projection sur un plan horizontal : les nuages se resserrent vers
    // l'horizon au lieu de tourner autour du zénith.
    vec2 plane = direction.xz / max( direction.y, 0.05 );
    float field = fbm( plane * ${CLOUD_SCALE.toFixed(2)} + uTime * ${CLOUD_DRIFT.toFixed(3)} );

    // Seuil linéaire en couverture : la réglette répond sur toute sa course.
    float edge = mix( 0.78, 0.12, uCloudCover );
    float body = smoothstep( edge, edge + 0.05, field );
    float crown = smoothstep( edge + 0.10, edge + 0.15, field );
    // Pas de nuage sous l'horizon, ni collé dessus (la projection y diverge).
    body *= smoothstep( 0.015, 0.09, direction.y );

    // Deux tons : le corps ombré, la crête éclairée. Le nuage s'assombrit et
    // s'opacifie avec la densité, il ne grandit pas.
    vec3 cloudColor = mix( uCloud * mix( 0.92, 0.55, uCloudDensity ), uCloud, crown );
    color = mix( color, cloudColor, body * mix( 0.5, 1.0, uCloudDensity ) );

    // --- La nuit --------------------------------------------------------------
    vec3 night = mix( uNightHorizon, uNightZenith, pow( up, 0.45 ) );

    // Lune : un croissant (deux cercles en espace local, l'un mordant l'autre),
    // pas une vraie phase calculée depuis la date. right/up forment un repère
    // local perpendiculaire à la lune, où direction se projette en 2D pour une SDF.
    vec3 moonDir = normalize( uMoonDirection );
    vec3 moonUpHint = abs( moonDir.y ) > 0.99 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 );
    vec3 moonRight = normalize( cross( moonUpHint, moonDir ) );
    vec3 moonUp = cross( moonDir, moonRight );
    vec3 moonRel = direction - moonDir * dot( direction, moonDir );
    // Rayon angulaire choisi pour se voir, sans viser le réalisme (le vrai fait ~0,25°).
    vec2 moonLocal = vec2( dot( moonRel, moonRight ), dot( moonRel, moonUp ) ) / 0.02;
    float moonDisc = smoothstep( 0.05, -0.05, length( moonLocal ) - 1.0 );
    // Le second cercle mord le premier pour ne laisser qu'un croissant.
    float moonBite = smoothstep( -0.05, 0.05, length( moonLocal - vec2( 0.6, 0.15 ) ) - 1.05 );
    float moonShape = moonDisc * moonBite;
    float moonGlow = pow( clamp( dot( direction, moonDir ), 0.0, 1.0 ), 60.0 );
    night += vec3( 0.85, 0.9, 1.0 ) * ( moonShape * 0.9 + moonGlow * 0.18 );

    // Étoiles : un point rond par cellule d'une grille fine, pas la cellule
    // entière allumée par seuil (ça dessinerait des carrés). La grille vit dans
    // la projection équirectangulaire — indispensable : direction.xz s'effondre
    // vers zéro près du zénith et étirerait les cellules en traits.
    vec2 equirect = vec2(
      atan( direction.z, direction.x ) * 0.15915494 + 0.5,
      asin( clamp( direction.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5
    );
    vec2 starUv = equirect * vec2( 900.0, 450.0 );
    vec2 starId = floor( starUv );
    vec2 starLocal = fract( starUv ) - 0.5;
    float starSeed = hash( starId );
    vec2 starJitter = vec2( hash( starId + 11.7 ), hash( starId + 53.9 ) ) - 0.5;
    float starDist = length( starLocal - starJitter * 0.6 );
    float starSize = mix( 0.1, 0.2, fract( starSeed * 71.3 ) );
    float starPoint = smoothstep( starSize, 0.0, starDist );
    float starPresence = step( 0.9935, starSeed );
    float starVeil = 1.0 - uCloudCover * uCloudDensity * 0.85;
    float starMask = smoothstep( 0.05, 0.35, direction.y );
    night += vec3( starPresence * starPoint * starVeil * starMask ); // éclat fixe, pas de scintillement

    // Étoile filante : point net en tête, traînée qui s'amincit vers la queue.
    // Tirage par tranche de temps, sans réalité astronomique.
    float meteorSlot = floor( uTime / 9.0 );
    float meteorRoll = hash( vec2( meteorSlot, 4.7 ) );
    float meteorProgress = fract( uTime / 9.0 );
    if ( meteorRoll > 0.55 && meteorProgress < 0.22 && direction.y > 0.05 ) {
      vec2 meteorStart = vec2( hash( vec2( meteorSlot, 1.3 ) ), hash( vec2( meteorSlot, 8.1 ) ) * 0.5 + 0.05 );
      vec2 meteorDir = normalize( vec2( hash( vec2( meteorSlot, 2.9 ) ) - 0.5, hash( vec2( meteorSlot, 6.6 ) ) * 0.3 - 0.15 ) );
      float t = meteorProgress / 0.22;
      vec2 meteorHead = meteorStart + meteorDir * 0.12 * t;
      vec2 meteorTail = meteorHead - meteorDir * 0.045;
      vec2 seg = meteorHead - meteorTail;
      float segLen = max( length( seg ), 1e-5 );
      vec2 segDir = seg / segLen;
      float along = clamp( dot( equirect - meteorTail, segDir ), 0.0, segLen ) / segLen;
      vec2 closest = meteorTail + segDir * along * segLen;
      float meteorDist = length( equirect - closest );
      // Largeur et intensité décroissent vers la queue (along → 0).
      float meteorWidth = mix( 0.0015, 0.006, along );
      float meteorStreak = smoothstep( meteorWidth, 0.0, meteorDist ) * mix( 0.15, 1.0, along );
      float meteorFade = smoothstep( 0.0, 0.15, t ) * smoothstep( 1.0, 0.6, t );
      night += vec3( 1.0, 0.97, 0.92 ) * meteorStreak * meteorFade * 2.0;
    }

    color = mix( color, night, uNightMix );

    // Raccord au brouillard, appliqué en dernier : c'est ce qui garantit que
    // l'horizon et le terrain lointain se rejoignent sans couture visible.
    float horizonWeight = uHorizonBlend * ( 1.0 - smoothstep( 0.0, ${HORIZON_BAND.toFixed(2)}, direction.y ) );
    color = mix( color, uFogColor, horizonWeight );

    gl_FragColor = vec4( color, 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * La voûte : un maillage, ses uniforms, et rien d'autre. Les couleurs
 * arrivent en **linéaire** (comme celles que `sceneEnvironment` dérive de la
 * palette) ; la conversion vers l'espace de sortie est faite par le shader,
 * au même endroit et de la même façon que pour les matières de la scène.
 */
export class SkyDome {
  /** @param {Object} THREE Le module three de l'application. */
  constructor(THREE) {
    const color = (r, g, b) => ({ value: new THREE.Color(r, g, b) });

    this.uniforms = {
      uHorizon: color(0.8, 0.85, 0.9),
      uZenith: color(0.35, 0.55, 0.85),
      uCloud: color(1, 1, 1),
      uSunColor: color(1, 1, 1),
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uCurve: { value: 1 },
      uSunset: { value: 0 },
      uGlow: { value: 0 },
      uGlowFocus: { value: 40 },
      uCloudCover: { value: 0 },
      uCloudDensity: { value: 0 },
      uTime: { value: 0 },
      uNightZenith: color(0, 0, 0),
      uNightHorizon: color(0, 0, 0),
      uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
      uNightMix: { value: 0 },
      uFogColor: color(0.8, 0.85, 0.9),
      uHorizonBlend: { value: HORIZON_BLEND },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      // Le brouillard de la scène ne s'applique pas à la voûte : elle *est* la
      // couleur vers laquelle il fond (voir le raccord d'horizon ci-dessus).
      fog: false,
    });

    // Un cube suffit : tout est calculé depuis la direction regardée, donc
    // la forme du maillage ne se voit pas — et il coûte huit sommets.
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.scale.setScalar(SKY_RADIUS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
