/*
 * Tests de la perspective aérienne.
 *
 * Trois choses valent d'être tenues ici, parce qu'aucune ne se voit sur une
 * capture d'écran :
 *
 * - **la moyenne des poids de canal vaut 1.** Ces poids multiplient la densité
 *   du brouillard ; une moyenne qui dérive déplacerait la distance de
 *   disparition réglée par `fogRadius`, en silence, sous couvert d'un
 *   changement de teinte.
 * - **aucune couleur dérivée n'est plus lumineuse que le brouillard.** C'est
 *   toute la raison d'être du module : un halo ou un zénith plus clair que le
 *   fond reproduirait, par un autre chemin, le lavis blanc qu'on corrige.
 * - **à l'horizontale, la cible du mélange reste `fogColor`.** C'est l'invariant
 *   du raccord d'horizon, et il vit dans une chaîne de caractères GLSL que rien
 *   d'autre ne relit.
 *
 * Aucune dépendance navigateur : un stub de three suffit, on vérifie la
 * **source** des shaders et le partage des uniforms, pas leur exécution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AerialFog,
  RAYLEIGH,
  RAYLEIGH_STRENGTH,
  aerialSkyColor,
  aerialSunColor,
  sunTintAmount,
} from '../src/environment/aerialFog.js';

/** La couleur d'ambiance livrée, en linéaire approximé (gamma 2,2). */
const FOG = [0.8, 0.87, 0.93];
const peak = (c) => Math.max(c[0], c[1], c[2]);

// --- Les poids de canal ------------------------------------------------------

test('la pondération de Rayleigh est croissante du rouge au bleu', () => {
  assert.ok(RAYLEIGH[0] < RAYLEIGH[1], 'le rouge se diffuse moins que le vert');
  assert.ok(RAYLEIGH[1] < RAYLEIGH[2], 'le vert se diffuse moins que le bleu');
});

test('la moyenne des poids vaut 1 : la distance de disparition ne bouge pas', () => {
  const mean = (RAYLEIGH[0] + RAYLEIGH[1] + RAYLEIGH[2]) / 3;
  assert.ok(Math.abs(mean - 1) < 1e-12, `moyenne ${mean}`);
  // Le tempérament garde cette propriété : mix(1, poids, force) a la même
  // moyenne que les poids dès que celle-ci vaut 1.
  const tempered = RAYLEIGH.map((r) => 1 + (r - 1) * RAYLEIGH_STRENGTH);
  const temperedMean = (tempered[0] + tempered[1] + tempered[2]) / 3;
  assert.ok(Math.abs(temperedMean - 1) < 1e-12, `moyenne tempérée ${temperedMean}`);
});

// --- Les couleurs dérivées ---------------------------------------------------

test('le ciel haut est plus bleu et plus profond que l’horizon', () => {
  const sky = aerialSkyColor(FOG);
  assert.ok(sky[2] / sky[0] > FOG[2] / FOG[0], 'le bleu a pris le pas sur le rouge');
  assert.ok(peak(sky) < peak(FOG), 'la voûte est plus sombre que l’horizon');
  for (const c of sky) assert.ok(c >= 0 && c <= 1, `canal hors gamut : ${c}`);
});

test('l’axe du soleil se réchauffe sans s’éclaircir', () => {
  const sunset = aerialSunColor(FOG, [1, 0.65, 0.4]);
  assert.ok(sunset[0] / sunset[2] > FOG[0] / FOG[2], 'la teinte a viré au chaud');
  assert.ok(
    peak(sunset) <= peak(FOG) + 1e-12,
    'jamais plus lumineux que le brouillard — sinon c’est le blanc qu’on corrige'
  );
});

test('une lumière neutre ne teinte rien', () => {
  const noon = aerialSunColor(FOG, [1, 1, 1]);
  assert.ok(Math.abs(noon[0] - noon[2]) < 1e-12, 'aucune dominante inventée');
});

test('une couleur éteinte ne divise pas par zéro', () => {
  assert.deepEqual(aerialSunColor(FOG, [0, 0, 0]), [0, 0, 0]);
});

// --- L'extinction du réchauffement -------------------------------------------

test('le halo solaire s’éteint la nuit et sous un ciel bouché', () => {
  assert.ok(sunTintAmount(0, 0) > 0, 'plein jour, ciel dégagé');
  assert.equal(sunTintAmount(0, 1), 0, 'la nuit, il n’y a pas de soleil à regarder');
  assert.equal(sunTintAmount(1, 0), 0, 'sous un couvert plein, pas de disque non plus');
  assert.ok(sunTintAmount(0.5, 0) < sunTintAmount(0, 0), 'le couvert l’atténue avant de l’éteindre');
});

// --- La greffe dans three ----------------------------------------------------

/** Les chunks de brouillard de three, dans leur forme d'origine. */
function stubThree() {
  const uniforms = () => ({ fogColor: { value: {} }, fogDensity: { value: 0 } });
  return {
    SRGBColorSpace: 'srgb',
    Color: class {
      setRGB(r, g, b) {
        Object.assign(this, { r, g, b });
        return this;
      }
      getRGB(target) {
        // Le stub n'encode rien : ce qui se vérifie ici est le chemin, pas la
        // courbe de transfert, qui est celle de three.
        Object.assign(target, { r: this.r, g: this.g, b: this.b });
        return target;
      }
    },
    ShaderChunk: {
      fog_pars_vertex: '#ifdef USE_FOG\n\tvarying float vFogDepth;\n#endif',
      fog_vertex: '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n#endif',
      fog_pars_fragment:
        '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n#endif',
      fog_fragment: '#ifdef USE_FOG\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 0.0 );\n#endif',
    },
    ShaderLib: {
      lambert: { uniforms: uniforms() },
      standard: { uniforms: uniforms() },
      // Une matière sans brouillard ne doit pas se voir greffer d'uniforms.
      depth: { uniforms: { opacity: { value: 1 } } },
    },
  };
}

test('la greffe déclare le rayon regardé et n’écrase pas vFogDepth', () => {
  const THREE = stubThree();
  new AerialFog(THREE);
  assert.match(THREE.ShaderChunk.fog_pars_vertex, /varying vec3 vFogRay;/);
  assert.match(THREE.ShaderChunk.fog_vertex, /vFogDepth = - mvPosition\.z;/);
  assert.match(THREE.ShaderChunk.fog_vertex, /vFogRay = vec3\(/);
  assert.ok(
    !THREE.ShaderChunk.fog_vertex.includes('transpose('),
    'transpose() n’existe pas en GLSL 1.00, que three utilise par défaut'
  );
});

test('à l’horizontale, la cible du mélange reste fogColor', () => {
  const THREE = stubThree();
  new AerialFog(THREE);
  // mix(fogColor, uFogSky, pow(clamp(fogRay.y, 0, 1), …)) vaut fogColor quand
  // fogRay.y est nul : le raccord d'horizon et le fond du renderer sont ceux
  // d'avant. C'est cette ligne-là qui le garantit.
  assert.match(
    THREE.ShaderChunk.fog_fragment,
    /mix\(\s*fogColor,\s*uFogSky,\s*pow\(\s*clamp\(\s*fogRay\.y,\s*0\.0,\s*1\.0\s*\)/
  );
});

test('la greffe est idempotente : deux mondes ne redéclarent rien', () => {
  const THREE = stubThree();
  new AerialFog(THREE);
  const once = THREE.ShaderChunk.fog_pars_fragment;
  new AerialFog(THREE);
  assert.equal(THREE.ShaderChunk.fog_pars_fragment, once);
  const declarations = once.match(/uniform vec3 uFogSky;/g) || [];
  assert.equal(declarations.length, 1, 'une seule déclaration, sinon rien ne compile');
});

test('les uniforms sont partagés entre matières, et objets simples', () => {
  const THREE = stubThree();
  new AerialFog(THREE);
  const { lambert, standard, depth } = THREE.ShaderLib;
  assert.ok(lambert.uniforms.uFogSky, 'greffé sur une matière à brouillard');
  assert.equal(
    lambert.uniforms.uFogSky,
    standard.uniforms.uFogSky,
    'une seule écriture doit suffire pour tout l’écran'
  );
  assert.equal(depth.uniforms.uFogSky, undefined, 'rien à faire là où il n’y a pas de brouillard');
  // Un objet simple, pas une Color : c'est ce qui survit à UniformsUtils.clone
  // par référence. Le jour où ce serait une Color, chaque matière aurait la
  // sienne et plus rien ne suivrait l'heure.
  assert.equal(lambert.uniforms.uFogSky.value.constructor, Object);
  assert.equal(typeof lambert.uniforms.uFogSky.value.x, 'number');
});

test('update() écrit dans les uniforms partagés', () => {
  const THREE = stubThree();
  const fog = new AerialFog(THREE);
  fog.update({
    skyColor: [0.1, 0.2, 0.3],
    sunColor: [0.4, 0.5, 0.6],
    sunDir: { x: 0, y: 0.5, z: -1 },
    sunAmount: 0.42,
  });
  const shared = THREE.ShaderLib.standard.uniforms;
  assert.deepEqual(shared.uFogSky.value, { x: 0.1, y: 0.2, z: 0.3 });
  assert.deepEqual(shared.uFogSunColor.value, { x: 0.4, y: 0.5, z: 0.6 });
  assert.deepEqual(shared.uFogSunDir.value, { x: 0, y: 0.5, z: -1 });
  assert.equal(shared.uFogSunAmount.value, 0.42);
});
