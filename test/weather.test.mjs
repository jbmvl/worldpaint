/*
 * Tests de la météo : l'état résolu, et ce qu'il fait à la lumière.
 *
 * Deux choses valent d'être vérifiées ici plus qu'ailleurs.
 *
 * La première est l'**identité par temps ordinaire**. Toute la mécanique est
 * écrite pour qu'une application qui ne parle jamais de météo voie exactement le
 * paysage d'avant ; c'est une promesse qu'un coefficient mal placé casserait
 * sans que rien ne le signale, et qu'on ne verrait qu'à l'œil, sur une capture
 * d'avant/après que personne ne fait.
 *
 * La seconde est le **sens des variations**. Qu'un ciel bouché assombrisse le
 * soleil et remonte l'ambiance est ce qui distingue un couvert d'un coucher de
 * soleil ; une inversion produirait une image plausible, simplement fausse — le
 * genre d'erreur qu'on ne trouve pas en regardant.
 *
 * Aucune dépendance navigateur : trois stubs suffisent pour les particules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WEATHER,
  PRECIPITATION_TYPES,
  resolveWeather,
  overcastOf,
  weatherLighting,
  weatherSkyParameters,
  castsShadow,
  fogScale,
  fogColorFor,
  windField,
} from '../src/environment/weather.js';
import { lightingFor, skyParameters } from '../src/environment/skyModel.js';
import { Precipitation } from '../src/environment/precipitation.js';

const ORDINARY = resolveWeather();
const OVERCAST = resolveWeather({ cloudCover: 1, cloudDensity: 1 });

// --- L'état résolu -----------------------------------------------------------

test('sans rien, le temps résolu est le temps ordinaire', () => {
  assert.equal(ORDINARY.cloudCover, DEFAULT_WEATHER.cloudCover);
  assert.equal(ORDINARY.cloudDensity, DEFAULT_WEATHER.cloudDensity);
  assert.equal(ORDINARY.precipitation, 0);
  assert.equal(ORDINARY.wind, DEFAULT_WEATHER.wind);
  assert.equal(ORDINARY.haze, 0);
  assert.equal(ORDINARY.wetness, 0);
});

test('la surcharge se fait clé par clé, contrairement aux tranches de thème', () => {
  const w = resolveWeather({ haze: 0.5 });
  assert.equal(w.haze, 0.5);
  assert.equal(w.cloudCover, DEFAULT_WEATHER.cloudCover, 'le reste survit');
  assert.equal(w.wind, DEFAULT_WEATHER.wind);
});

test('tout est borné à [0, 1] et le résultat est gelé', () => {
  const w = resolveWeather({ cloudCover: 4, precipitation: -2, wind: Number.NaN });
  assert.equal(w.cloudCover, 1);
  assert.equal(w.precipitation, 0);
  assert.equal(w.wind, DEFAULT_WEATHER.wind, 'une valeur non finie retombe sur le défaut');
  assert.ok(Object.isFrozen(w));
});

test('un type de précipitation inconnu retombe sur la pluie', () => {
  assert.equal(resolveWeather({ precipitationType: 'grêle' }).precipitationType, 'rain');
  for (const type of PRECIPITATION_TYPES) {
    assert.equal(resolveWeather({ precipitationType: type }).precipitationType, type);
  }
});

test('le mouillé suit la pluie, jamais la neige', () => {
  assert.equal(resolveWeather({ precipitation: 0.8 }).wetness, 0.8);
  assert.equal(
    resolveWeather({ precipitation: 1, precipitationType: 'snow' }).wetness,
    0,
    'la neige blanchit le sol, elle ne le noircit pas'
  );
  assert.equal(
    resolveWeather({ precipitation: 0, wetness: 0.6 }).wetness,
    0.6,
    'un sol qui sèche après l’averse reste pilotable par l’application'
  );
});

// --- L'identité par temps ordinaire ------------------------------------------

test('par temps ordinaire, rien du rendu d’avant ne bouge', () => {
  assert.equal(overcastOf(ORDINARY), 0, 'aucun couvert au-dessus du ciel de référence');
  assert.equal(fogScale(ORDINARY), 1, 'le brouillard garde sa densité de montage');

  const palette = [0.8, 0.85, 0.9];
  assert.deepEqual(fogColorFor(palette, ORDINARY), palette, 'la palette passe intacte');

  const sky = skyParameters(0.5);
  assert.deepEqual(weatherSkyParameters(sky, ORDINARY), sky, 'Preetham inchangé sans brume');

  const light = lightingFor(0.5);
  const applied = weatherLighting(light, ORDINARY);
  assert.equal(applied.sun, light.sun);
  assert.equal(applied.ambient, light.ambient);
  assert.equal(applied.warmth, light.warmth);
  assert.equal(applied.shadow, 1, 'les ombres sont pleines');

  assert.deepEqual(windField(ORDINARY), { amplitude: 1, speed: 1 }, 'le vent réglé par le thème');
});

// --- Le sens des variations --------------------------------------------------

test('un ciel bouché éteint le soleil et remonte l’ambiance', () => {
  const light = lightingFor(0.5);
  const covered = weatherLighting(light, OVERCAST);

  assert.equal(overcastOf(OVERCAST), 1);
  assert.ok(covered.sun < light.sun * 0.2, 'la directionnelle s’efface presque entièrement');
  assert.ok(covered.ambient > light.ambient, 'la voûte devient la source');
  assert.ok(covered.shadow < 0.1, 'les ombres portées s’effacent');
});

test('la lumière diffusée par un nuage perd sa chaleur', () => {
  // Soleil rasant : c'est là que la chaleur est maximale, donc là qu'un
  // couchant orange sous un ciel bouché se verrait le plus.
  const grazing = lightingFor(0.05);
  assert.ok(grazing.warmth > 0.8, 'le soleil rasant est chaud, temps ordinaire');
  assert.ok(
    weatherLighting(grazing, OVERCAST).warmth < grazing.warmth * 0.2,
    'sous un couvert plein il ne l’est plus'
  );
});

test('la pluie assombrit au-delà du couvert qui la porte', () => {
  const light = lightingFor(0.5);
  const cover = { cloudCover: 0.8, cloudDensity: 0.8 };
  const dry = weatherLighting(light, resolveWeather(cover));
  const wet = weatherLighting(light, resolveWeather({ ...cover, precipitation: 1 }));
  assert.ok(wet.sun < dry.sun, 'sous l’averse il fait plus sombre qu’au seul compte des nuages');
});

test('l’ombre portée s’efface en douceur avant de s’éteindre', () => {
  assert.ok(castsShadow(ORDINARY));
  assert.ok(!castsShadow(OVERCAST), 'plus de disque solaire, plus de contour net');

  // Elle décroît continûment : un nuage qui passe ne doit pas faire disparaître
  // toutes les ombres de la scène d'une image à l'autre.
  const light = lightingFor(0.5);
  let previous = Infinity;
  for (const cover of [0.3, 0.5, 0.7, 0.9, 1]) {
    const shadow = weatherLighting(light, resolveWeather({ cloudCover: cover, cloudDensity: 1 })).shadow;
    assert.ok(shadow <= previous, `le couvert ${cover} ne rallume pas les ombres`);
    previous = shadow;
  }
});

test('chaque cause de mauvaise visibilité épaissit le brouillard', () => {
  assert.ok(fogScale(resolveWeather({ cloudCover: 1, cloudDensity: 1 })) > 1, 'un ciel bas');
  assert.ok(fogScale(resolveWeather({ precipitation: 1 })) > 1, 'une averse');
  assert.ok(fogScale(resolveWeather({ haze: 1 })) > 3, 'la brume, bien davantage');
});

test('le couvert éteint la teinte du brouillard sans la remplacer', () => {
  const palette = [0.2, 0.5, 0.95]; // un bleu franc
  const [r, g, b] = fogColorFor(palette, OVERCAST);

  const spreadBefore = Math.max(...palette) - Math.min(...palette);
  const spreadAfter = Math.max(r, g, b) - Math.min(r, g, b);
  assert.ok(spreadAfter < spreadBefore, 'la couleur se désature');
  assert.ok(b > r, 'mais la teinte du monde survit : le bleu reste le canal fort');
  assert.ok(g < palette[1], 'et l’ensemble s’assombrit');
});

test('la brume charge l’atmosphère, les nuages non', () => {
  const sky = skyParameters(0.5);
  const hazy = weatherSkyParameters(sky, resolveWeather({ haze: 1 }));
  assert.ok(hazy.turbidity > sky.turbidity, 'plus d’aérosols');
  assert.ok(hazy.rayleigh < sky.rayleigh, 'le bleu du zénith s’affadit');

  // Les nuages sont déjà rendus par le shader de nuages : les redoubler ici
  // blanchirait le ciel deux fois.
  assert.deepEqual(weatherSkyParameters(sky, OVERCAST), sky);
});

test('le vent pilote l’amplitude et la vitesse ensemble mais séparément', () => {
  const calm = windField(resolveWeather({ wind: 0 }));
  const gale = windField(resolveWeather({ wind: 1 }));

  assert.ok(calm.amplitude < 0.1, 'air immobile : le feuillage ne bouge presque plus');
  assert.ok(calm.speed < 0.5, 'et ce qui reste bouge lentement');
  assert.ok(gale.amplitude > 2, 'bourrasque : il fouette');
  assert.ok(gale.speed > 2, 'et vite');
  // Séparées, sans quoi l'herbe se coucherait au ralenti — ce qui se lit comme
  // un liquide, pas comme du vent.
  assert.notEqual(gale.amplitude, gale.speed);
});

// --- Les précipitations ------------------------------------------------------

/*
 * `three` n'est pas une dépendance de test (c'est un `peerDependency`, injecté
 * par l'application). Les quelques primitives que `Precipitation` utilise sont
 * assez simples pour être imitées, et ce qu'on veut vérifier — qui est visible,
 * combien de gouttes tombent, comment le temps se replie — ne dépend d'aucune
 * d'entre elles.
 */
function fakeTHREE() {
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.drawRange = { start: 0, count: Infinity };
    }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
    }
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    }
    dispose() {}
  }
  class Object3D {
    constructor() {
      this.children = [];
      this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    }
    add(child) {
      this.children.push(child);
    }
    remove(child) {
      this.children = this.children.filter((c) => c !== child);
    }
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
    }
  }
  return {
    Group: Object3D,
    LineSegments: Mesh,
    Points: Mesh,
    Vector2: class {
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
      set(x, y) { this.x = x; this.y = y; return this; }
      // `length` sert au test, pas au module.
      length() { return Math.hypot(this.x, this.y); }
    },
    Color: class {
      constructor(r = 1, g = 1, b = 1) { Object.assign(this, { r, g, b }); }
      setRGB(r, g, b) { Object.assign(this, { r, g, b }); return this; }
    },
    BufferGeometry,
    BufferAttribute,
    ShaderMaterial: class {
      constructor(options) { Object.assign(this, options); }
      dispose() {}
    },
  };
}

function mountPrecipitation() {
  const THREE = fakeTHREE();
  const scene = { children: [], add(o) { this.children.push(o); }, remove(o) { this.children = this.children.filter((c) => c !== o); } };
  return { field: new Precipitation({ THREE, scene }), scene };
}

test('sans précipitation, rien ne tombe', () => {
  const { field } = mountPrecipitation();
  field.setWeather(ORDINARY);
  assert.equal(field.rain.visible, false);
  assert.equal(field.snow.visible, false);
});

test('une seule forme tombe à la fois', () => {
  const { field } = mountPrecipitation();

  field.setWeather(resolveWeather({ precipitation: 0.5 }));
  assert.equal(field.rain.visible, true);
  assert.equal(field.snow.visible, false);

  field.setWeather(resolveWeather({ precipitation: 0.5, precipitationType: 'snow' }));
  assert.equal(field.rain.visible, false);
  assert.equal(field.snow.visible, true);
});

test('l’intensité tire plus de gouttes du même tampon', () => {
  const { field } = mountPrecipitation();
  const allocated = field.rain.geometry.attributes.aBase.array.length;

  field.setWeather(resolveWeather({ precipitation: 0.25 }));
  const light = field.rain.geometry.drawRange.count;
  field.setWeather(resolveWeather({ precipitation: 1 }));
  const heavy = field.rain.geometry.drawRange.count;

  assert.ok(heavy > light, 'une averse tire plus qu’une bruine');
  assert.equal(
    field.rain.geometry.attributes.aBase.array.length,
    allocated,
    'sans jamais réallouer le tampon GPU'
  );
});

test('le temps de chute se replie au lieu de croître indéfiniment', () => {
  const { field } = mountPrecipitation();
  field.advance(3599);
  const before = field.uniforms.uTime.value;
  field.advance(2);
  assert.ok(field.uniforms.uTime.value < before, 'la période est bouclée');
  assert.ok(field.uniforms.uTime.value >= 0);

  // Un delta absurde ne doit pas empoisonner l'uniforme pour le reste de la vie
  // de la scène : c'est arrivé une fois avec un onglet remis au premier plan.
  const sane = field.uniforms.uTime.value;
  field.advance(Number.NaN);
  assert.equal(field.uniforms.uTime.value, sane);
});

test('le vent penche la pluie et emporte la neige', () => {
  const { field } = mountPrecipitation();

  field.setWeather(resolveWeather({ precipitation: 0.6, wind: 0 }));
  assert.equal(field.uniforms.uWind.value.length(), 0, 'air immobile : chute verticale');

  field.setWeather(resolveWeather({ precipitation: 0.6, wind: 1 }));
  const rain = field.uniforms.uWind.value.length();
  assert.ok(rain > 0, 'la bourrasque incline le filet');

  field.setWeather(resolveWeather({ precipitation: 0.6, wind: 1, precipitationType: 'snow' }));
  assert.ok(
    field.uniforms.uWind.value.length() > rain,
    'un flocon se laisse emporter bien plus qu’une goutte'
  );
});

test('la libération retire la boîte de la scène', () => {
  const { field, scene } = mountPrecipitation();
  assert.equal(scene.children.length, 1);
  field.dispose();
  assert.equal(scene.children.length, 0);
});
