import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienceMix, surroundingsAt, Soundscape, AMBIENCE_CHANNELS } from '../src/environment/soundscape.js';
import { resolveWeather } from '../src/environment/weather.js';

/** Une carte du sol réduite à une règle : bois à l'ouest, eau à l'est au-delà de 50 m. */
const fakeGround = {
  coverAt(x) {
    if (x < 0) return 'wood';
    if (x > 50) return 'water';
    return 'grass';
  },
};

test('surroundingsAt : parts pondérées, rien hors carte', () => {
  const here = surroundingsAt(fakeGround, -10, 0);
  assert.ok(here.wood > 0.5, `bois ${here.wood}`);
  assert.ok(here.water > 0 && here.water < here.wood);
  assert.equal(here.town, 0);

  assert.deepEqual(surroundingsAt(null, 0, 0), { wood: 0, water: 0, town: 0 });
  assert.deepEqual(surroundingsAt({ coverAt: () => null }, 0, 0), { wood: 0, water: 0, town: 0 });
});

test('ambienceMix : la pluie suit l’averse, la neige ne crépite pas', () => {
  const rain = ambienceMix({ weather: resolveWeather({ precipitation: 0.6 }) });
  assert.equal(rain.rain, 0.6);
  const snow = ambienceMix({ weather: resolveWeather({ precipitation: 0.6, precipitationType: 'snow' }) });
  assert.equal(snow.rain, 0);
});

test('ambienceMix : le vent fait parler le bois, la hauteur fait taire le sol', () => {
  const surroundings = { wood: 1, water: 0.5, town: 0.5 };
  const calm = ambienceMix({ weather: resolveWeather({ wind: 0 }), surroundings });
  const gale = ambienceMix({ weather: resolveWeather({ wind: 1 }), surroundings });
  assert.ok(gale.leaves > calm.leaves * 3);
  assert.ok(gale.wind > calm.wind);

  const high = ambienceMix({ weather: resolveWeather({ wind: 0.5 }), surroundings, aboveGround: 500 });
  assert.equal(high.leaves, 0);
  assert.equal(high.water, 0);
  assert.equal(high.town, 0);
  assert.ok(high.wind > ambienceMix({ weather: resolveWeather({ wind: 0.5 }), surroundings }).wind);
});

test('ambienceMix : la ville se calme la nuit, tout reste entre 0 et 1', () => {
  const surroundings = { wood: 1, water: 1, town: 1 };
  const day = ambienceMix({ weather: resolveWeather({ wind: 1, precipitation: 1 }), surroundings });
  const night = ambienceMix({ weather: resolveWeather({ wind: 1, precipitation: 1 }), surroundings, nightMix: 1 });
  assert.ok(night.town < day.town);
  for (const name of AMBIENCE_CHANNELS) {
    assert.ok(day[name] >= 0 && day[name] <= 1, `${name} ${day[name]}`);
  }
});

/** Juste ce que `Soundscape` touche d'un `AudioContext`. */
function fakeContext() {
  const param = (value = 0) => ({ value, targets: [], setTargetAtTime(v) { this.targets.push(v); } });
  const node = (extra = {}) => ({
    connected: [],
    connect(to) { this.connected.push(to); return to; },
    disconnect() { this.connected = []; },
    ...extra,
  });
  const started = [];
  return {
    started,
    sampleRate: 8000,
    currentTime: 0,
    destination: node(),
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createOscillator: () => node({ frequency: param(), start() { started.push(this); }, stop() {} }),
    createBufferSource: () => node({ buffer: null, loop: false, start() { started.push(this); }, stop() {} }),
    createBuffer: (channels, length) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
}

test('Soundscape : une nappe par canal, muette au départ, qui suit update', () => {
  const context = fakeContext();
  const sound = new Soundscape({ context });
  assert.deepEqual(Object.keys(sound.channels), AMBIENCE_CHANNELS);
  for (const name of AMBIENCE_CHANNELS) assert.equal(sound.channels[name].gain.value, 0);

  sound.update({ wind: 1, rain: 0, leaves: 0.5, water: 0, town: 0 });
  assert.ok(sound.channels.wind.gain.targets.at(-1) > 0);
  assert.equal(sound.channels.rain.gain.targets.at(-1), 0);

  sound.dispose();
  assert.equal(sound.master.connected.length, 0);
});
