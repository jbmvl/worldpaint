/*
 * soundscape — l'ambiance sonore, entièrement synthétisée : du bruit filtré,
 * aucun fichier, aucune requête réseau.
 *
 * Deux moitiés séparées exprès :
 * - `surroundingsAt` et `ambienceMix`, pures, disent combien chaque nappe
 *   doit sonner (météo, nuit, matière du sol autour de l'observateur,
 *   hauteur au-dessus du sol) ; elles se testent sans navigateur ;
 * - `Soundscape` tient les nœuds Web Audio et ne fait que suivre ces niveaux.
 *
 * Le `AudioContext` appartient à l'application, comme le renderer : les
 * navigateurs ne le laissent démarrer qu'après un geste de l'utilisateur, et
 * c'est elle qui sait quand ce geste a lieu.
 *
 * Le bruit est tiré d'une graine fixe : deux montages sonnent pareil.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Les nappes, dans l'ordre où `Soundscape` les monte. */
export const AMBIENCE_CHANNELS = ['wind', 'rain', 'leaves', 'water', 'town'];

/**
 * Rayons d'écoute du sol, en mètres, et le poids de chacun : un bois à
 * trente mètres s'entend plus qu'un bois à deux cents.
 */
const LISTEN_RINGS = [
  { radius: 0, weight: 3 },
  { radius: 30, weight: 2 },
  { radius: 90, weight: 1 },
  { radius: 200, weight: 0.5 },
];
const LISTEN_DIRECTIONS = 8;

/** Hauteur au-dessus du sol à laquelle les bruits du sol se taisent, en mètres. */
const GROUND_SILENT_ABOVE_M = 300;

/**
 * Ce qui entoure l'observateur, du point de vue de l'oreille : parts de bois,
 * d'eau et de ville, de 0 à 1. Rien hors carte.
 *
 * @param {Object|null} groundClass Une `GroundClassMap` (ou tout objet qui a `coverAt`).
 * @param {number} x Mètres locaux.
 * @param {number} z
 * @returns {{wood:number, water:number, town:number}}
 */
export function surroundingsAt(groundClass, x, z) {
  const shares = { wood: 0, water: 0, town: 0 };
  if (!groundClass) return shares;

  let total = 0;
  for (const { radius, weight } of LISTEN_RINGS) {
    const count = radius === 0 ? 1 : LISTEN_DIRECTIONS;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const cover = groundClass.coverAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
      if (cover == null) continue;
      total += weight;
      if (cover === 'wood') shares.wood += weight;
      else if (cover === 'water') shares.water += weight;
      else if (cover === 'pavement') shares.town += weight;
      else if (cover === 'settled') shares.town += weight * 0.5;
    }
  }
  if (total === 0) return shares;
  shares.wood /= total;
  shares.water /= total;
  shares.town /= total;
  return shares;
}

/**
 * Niveau de chaque nappe, de 0 à 1.
 *
 * @param {Object} options
 * @param {Object} options.weather État résolu (`resolveWeather`).
 * @param {number} [options.nightMix] 0 le jour, 1 la nuit.
 * @param {{wood:number, water:number, town:number}} [options.surroundings]
 * @param {number} [options.aboveGround] Hauteur de l'oreille au-dessus du sol, en mètres.
 * @returns {{wind:number, rain:number, leaves:number, water:number, town:number}}
 */
export function ambienceMix({ weather, nightMix = 0, surroundings = null, aboveGround = 0 }) {
  const around = surroundings || { wood: 0, water: 0, town: 0 };
  const ground = 1 - smoothstep(20, GROUND_SILENT_ABOVE_M, Math.max(0, aboveGround));
  const wind = clamp01(weather.wind);
  // La neige étouffe : pas de crépitement, et le reste s'assourdit.
  const snow = weather.precipitationType === 'snow' ? clamp01(weather.precipitation) : 0;
  const muffle = 1 - snow * 0.5;

  return Object.freeze({
    // En hauteur, plus rien ne fait écran : le vent prend le dessus.
    wind: clamp01((0.08 + 0.7 * wind * wind) * (1.4 - 0.4 * ground)),
    rain: weather.precipitationType === 'rain' ? clamp01(weather.precipitation) : 0,
    leaves: clamp01(around.wood * (0.15 + 0.85 * wind) * ground * muffle),
    water: clamp01(around.water * 1.5 * ground * muffle),
    town: clamp01(around.town * (1 - 0.6 * clamp01(nightMix)) * ground * muffle),
  });
}

/**
 * Timbre de chaque nappe : la source de bruit, le filtre, et la houle lente
 * qui l'empêche de sonner comme un souffle de radio.
 * `level` est le gain à pleine intensité ; `sway` la profondeur de la houle
 * (en part du gain) et `swayHz` sa fréquence ; `sweep` balaie la fréquence
 * du filtre de ± autant de hertz.
 */
const VOICES = {
  wind: { noise: 'brown', filter: 'lowpass', frequency: 420, q: 0.8, level: 0.9, sway: 0.45, swayHz: 0.09, sweep: 260, sweepHz: 0.13 },
  rain: { noise: 'white', filter: 'bandpass', frequency: 4200, q: 0.4, level: 0.35, sway: 0.08, swayHz: 0.31, sweep: 0, sweepHz: 0 },
  leaves: { noise: 'white', filter: 'bandpass', frequency: 2400, q: 0.7, level: 0.25, sway: 0.6, swayHz: 0.21, sweep: 600, sweepHz: 0.17 },
  water: { noise: 'white', filter: 'bandpass', frequency: 700, q: 1.2, level: 0.35, sway: 0.2, swayHz: 1.7, sweep: 250, sweepHz: 2.3 },
  town: { noise: 'brown', filter: 'lowpass', frequency: 160, q: 0.7, level: 0.5, sway: 0.15, swayHz: 0.05, sweep: 0, sweepHz: 0 },
};

/** Durée des boucles de bruit, en secondes : assez longue pour qu'on n'en entende pas le raccord. */
const NOISE_SECONDS = 6;

/** Temps de réponse des niveaux, en secondes : on traverse une lisière, on n'allume pas un interrupteur. */
const LEVEL_RAMP_S = 1.2;

function noiseBuffers(context) {
  const length = Math.floor(NOISE_SECONDS * context.sampleRate);
  const white = context.createBuffer(1, length, context.sampleRate);
  const brown = context.createBuffer(1, length, context.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  let seed = 0x2f6b1d3;
  let last = 0;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = seed / 2147483648 - 1;
    w[i] = n;
    last = (last + 0.02 * n) / 1.02;
    b[i] = last * 3.5;
  }
  return { white, brown };
}

/**
 * Les nappes sonores, branchées sur un `AudioContext` fourni par l'application.
 * À nourrir à chaque image (ou moins souvent) avec `update(world.ambienceAt(…))`.
 */
export class Soundscape {
  /**
   * @param {Object} options
   * @param {AudioContext} options.context
   * @param {AudioNode} [options.destination] Défaut : `context.destination`.
   * @param {number} [options.volume] Volume général, de 0 à 1.
   */
  constructor({ context, destination = context.destination, volume = 0.6 }) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = volume;
    this.master.connect(destination);

    const buffers = noiseBuffers(context);
    this._nodes = [];
    this.channels = {};
    AMBIENCE_CHANNELS.forEach((name, index) => {
      const voice = VOICES[name];
      const source = context.createBufferSource();
      source.buffer = buffers[voice.noise];
      source.loop = true;

      const filter = context.createBiquadFilter();
      filter.type = voice.filter;
      filter.frequency.value = voice.frequency;
      filter.Q.value = voice.q;

      const sway = context.createGain();
      sway.gain.value = 1;
      const level = context.createGain();
      level.gain.value = 0;

      source.connect(filter).connect(sway).connect(level).connect(this.master);
      this._lfo(voice.swayHz, voice.sway, sway.gain);
      if (voice.sweep) this._lfo(voice.sweepHz, voice.sweep, filter.frequency);
      // Chaque nappe part d'un autre endroit de la boucle : sinon deux nappes
      // du même bruit se répondraient.
      source.start(0, (index * NOISE_SECONDS) / AMBIENCE_CHANNELS.length);

      this._nodes.push(source, filter, sway, level);
      this.channels[name] = level;
    });
  }

  _lfo(hz, depth, param) {
    if (!hz || !depth) return;
    const osc = this.context.createOscillator();
    osc.frequency.value = hz;
    const gain = this.context.createGain();
    gain.gain.value = depth;
    osc.connect(gain).connect(param);
    osc.start();
    this._nodes.push(osc, gain);
  }

  /** Volume général, de 0 à 1. */
  set volume(value) {
    this.master.gain.setTargetAtTime(clamp01(value), this.context.currentTime, 0.1);
  }

  /** @param {{[channel: string]: number}} mix Voir `ambienceMix`. */
  update(mix) {
    const now = this.context.currentTime;
    for (const name of AMBIENCE_CHANNELS) {
      const target = clamp01(mix?.[name] ?? 0) * VOICES[name].level;
      this.channels[name].gain.setTargetAtTime(target, now, LEVEL_RAMP_S / 3);
    }
  }

  dispose() {
    for (const node of this._nodes) {
      if (typeof node.stop === 'function') node.stop();
      node.disconnect();
    }
    this.master.disconnect();
    this._nodes = [];
  }
}
