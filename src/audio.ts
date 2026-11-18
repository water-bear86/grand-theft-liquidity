import type { Mode } from "./game.ts";
import { VOICES, type VoiceCaption, type VoiceId } from "./voices.ts";

type Tone = [
  wave: OscillatorType,
  from: number,
  to: number,
  seconds: number,
  level: number,
  delay?: number,
];
type Texture = [
  band: BiquadFilterType,
  frequency: number,
  q: number,
  seconds: number,
  level: number,
  delay?: number,
];
interface Cue {
  tones?: Tone[];
  textures?: Texture[];
  duck?: number;
}

const CUES = {
  pump: {
    // A drawer click, then two ringing pitches. The thicker note survives small speakers.
    tones: [
      ["triangle", 192, 112, 0.14, 0.19],
      ["sine", 587.3, 587.3, 0.23, 0.19, 0.022],
      ["sine", 1440, 1350, 0.15, 0.07, 0.022],
      ["triangle", 880, 880, 0.26, 0.15, 0.095],
      ["sine", 2130, 2050, 0.18, 0.049, 0.095],
    ],
    textures: [["bandpass", 2350, 1.3, 0.075, 0.27]],
    duck: 0.31,
  },
  mission: {
    tones: [
      ["sine", 174, 85, 0.21, 0.28],
      ["triangle", 293.7, 293.7, 0.26, 0.21, 0.025],
      ["triangle", 329.6, 329.6, 0.25, 0.16, 0.095],
      ["triangle", 370, 370, 0.27, 0.16, 0.17],
      ["triangle", 440, 440, 0.44, 0.21, 0.263],
      ["sine", 880, 880, 0.41, 0.077, 0.263],
      ["sine", 587.3, 587.3, 0.43, 0.075, 0.263],
    ],
    textures: [["bandpass", 1400, 0.64, 0.12, 0.23]],
    duck: 0.61,
  },
  victory: {
    tones: [
      ["sine", 163, 76, 0.29, 0.29],
      ["triangle", 293.7, 293.7, 0.32, 0.23],
      ["triangle", 370, 370, 0.3, 0.19, 0.115],
      ["triangle", 440, 440, 0.32, 0.2, 0.23],
      ["triangle", 587.3, 587.3, 0.67, 0.22, 0.38],
      ["sine", 740, 740, 0.65, 0.13, 0.38],
      ["sine", 880, 880, 0.67, 0.12, 0.38],
      ["sine", 1174.6, 1174.6, 0.52, 0.064, 0.44],
      ["triangle", 146.8, 146.8, 0.64, 0.14, 0.38],
    ],
    textures: [
      ["bandpass", 1700, 0.54, 0.19, 0.24],
      ["highpass", 3100, 0.56, 0.28, 0.17, 0.38],
    ],
    duck: 0.92,
  },
  pickup: {
    tones: [
      ["sine", 494, 569, 0.12, 0.11],
      ["triangle", 740, 740, 0.24, 0.13, 0.095],
      ["sine", 1480, 1480, 0.25, 0.052, 0.095],
    ],
    duck: 0.21,
  },
  cooling: {
    tones: [
      ["triangle", 269, 236, 0.25, 0.15],
      ["sine", 194, 144, 0.29, 0.16, 0.12],
    ],
    duck: 0.31,
  },
  jump: {
    tones: [["triangle", 142, 327, 0.14, 0.062]],
    textures: [["bandpass", 650, 0.8, 0.096, 0.12]],
  },
  bump: {
    tones: [["sine", 118, 61, 0.12, 0.11]],
    textures: [["bandpass", 506, 0.7, 0.096, 0.2]],
  },
  buyer: {
    tones: [
      ["triangle", 153, 83, 0.2, 0.2],
      ["sine", 126, 56, 0.19, 0.18, 0.09],
    ],
    textures: [["bandpass", 990, 1.03, 0.13, 0.36]],
    duck: 0.34,
  },
  hype: {
    tones: [["triangle", 128, 334, 0.27, 0.12]],
    textures: [["bandpass", 1110, 0.56, 0.28, 0.28]],
  },
  cash: {
    tones: [
      ["sine", 149, 87, 0.16, 0.17],
      ["triangle", 554.4, 554.4, 0.22, 0.14, 0.04],
      ["triangle", 740, 740, 0.26, 0.14, 0.11],
      ["sine", 1174.6, 1174.6, 0.37, 0.11, 0.21],
    ],
    textures: [["bandpass", 2550, 0.75, 0.14, 0.29, 0.01]],
    duck: 0.47,
  },
  spread: {
    tones: [["triangle", 210, 92, 0.11, 0.12]],
    textures: [
      ["bandpass", 630, 1.66, 0.09, 0.25],
      ["lowpass", 440, 3.0, 0.12, 0.23, 0.024],
    ],
  },
  crumb: {
    tones: [
      ["triangle", 830, 535, 0.09, 0.097],
      ["sine", 1110, 765, 0.092, 0.06, 0.065],
    ],
    textures: [["bandpass", 1930, 1.12, 0.062, 0.16]],
  },
  peel: {
    textures: [
      ["bandpass", 1080, 0.74, 0.14, 0.44],
      ["highpass", 2390, 0.58, 0.13, 0.2, 0.033],
    ],
  },
  lid: {
    tones: [
      ["triangle", 686, 646, 0.13, 0.13],
      ["sine", 1420, 1328, 0.31, 0.11, 0.055],
      ["sine", 2120, 2100, 0.16, 0.047, 0.055],
    ],
    textures: [["bandpass", 1680, 0.79, 0.12, 0.24]],
  },
  crownHit: {
    tones: [
      ["triangle", 540, 496, 0.29, 0.17],
      ["sine", 1520, 1495, 0.37, 0.1],
    ],
    textures: [["bandpass", 1280, 1.12, 0.11, 0.23]],
    duck: 0.34,
  },
  crownMiss: {
    tones: [
      ["triangle", 426, 250, 0.16, 0.14],
      ["sine", 348, 167, 0.13, 0.12, 0.083],
    ],
    textures: [["bandpass", 780, 0.76, 0.15, 0.21]],
  },
} satisfies Record<string, Cue>;

export type AudioCue = keyof typeof CUES;
export const DEFAULT_MUSIC_VOLUME = 0.62;

interface Mixer {
  context: AudioContext;
  master: GainNode;
  music: GainNode;
  duck: GainNode;
  beach: GainNode;
  cues: GainNode;
  voice: GainNode;
  noise: AudioBuffer;
}

function buildMixer(context: AudioContext): Mixer {
  const master = context.createGain();
  const music = context.createGain();
  const duck = context.createGain();
  const beach = context.createGain();
  const cues = context.createGain();
  const voice = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -15;
  compressor.knee.value = 14;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.145;
  master.gain.value = music.gain.value = beach.gain.value = 0;
  voice.gain.value = 0.92;
  music.connect(duck);
  for (const bus of [duck, beach, cues, voice]) bus.connect(compressor);
  compressor.connect(master);
  master.connect(context.destination);

  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 19114;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = seed / 0x80000000 - 1;
  }
  return { context, master, music, duck, beach, cues, voice, noise };
}

function playTone(mixer: Mixer, at: number, recipe: Tone) {
  const [wave, from, to, seconds, level, delay = 0] = recipe;
  const time = at + delay;
  const { context, cues } = mixer;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(from, time);
  oscillator.frequency.exponentialRampToValueAtTime(to, time + seconds);
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + seconds);
  oscillator.connect(envelope);
  envelope.connect(cues);
  oscillator.start(time);
  oscillator.stop(time + seconds + 0.004);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
}

function playTexture(mixer: Mixer, at: number, recipe: Texture) {
  const [band, frequency, q, seconds, level, delay = 0] = recipe;
  const time = at + delay;
  const { context, cues, noise } = mixer;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = noise;
  filter.type = band;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + seconds);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(cues);
  source.start(time, (time * 7.357) % 0.58, seconds + 0.005);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
}

const LOOP_FILES = {
  music: "sunset-loop.mp3",
  beach: "shoreline-loop.mp3",
} as const;
type LoopId = keyof typeof LOOP_FILES;
const VOICE_IDS = Object.keys(VOICES) as VoiceId[];

export class GameAudio {
  muted = false;
  musicVolume = DEFAULT_MUSIC_VOLUME;
  caption: VoiceCaption | null = null;
  private mix: Mixer | null = null;
  private mode: Mode = "title";
  private shore = 0;
  private backgrounded = false;
  private loops: Partial<Record<LoopId, AudioBufferSourceNode>> = {};
  private loading = new Set<string>();
  private voices = new Map<VoiceId, AudioBuffer>();
  private cueUntil = 0;
  private pending: VoiceId | VoiceCaption | null = null;
  private line: { end: number; source: AudioBufferSourceNode | null } | null =
    null;
  private gainTargets = new Map<AudioParam, number>();

  unlock() {
    try {
      this.mix ??= buildMixer(new AudioContext());
    } catch {
      // The game can run and show captions when the browser cannot open an audio device.
      return;
    }
    const mix = this.mix;
    this.backgrounded = document.hidden;
    if (mix.context.state !== "running")
      void mix.context.resume().catch(() => {});
    for (const id of ["music", "beach"] as const) {
      if (this.loops[id]) continue;
      this.load(LOOP_FILES[id], (buffer) => {
        const source = mix.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(mix[id]);
        source.start();
        this.loops[id] = source;
      });
    }
    for (const id of VOICE_IDS) {
      if (!this.voices.has(id))
        this.load(`voice/${id}.mp3`, (buffer) => this.voices.set(id, buffer));
    }
    this.applyMix();
  }

  setMuted(value: boolean) {
    this.muted = value;
    this.applyMix();
  }

  setMusicVolume(value: number) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    this.applyMix();
  }

  setBackgrounded(value: boolean) {
    this.backgrounded = value;
    if (value) this.clearDialogue();
    this.applyMix();
  }

  update(mode: Mode, positionX: number) {
    this.mode = mode;
    this.shore =
      Math.round(Math.max(0, Math.min(1, (positionX + 12) / 37)) * 30) / 30;
    if (
      mode === "title" ||
      mode === "paused" ||
      mode === "result" ||
      this.backgrounded
    )
      this.clearDialogue();
    else this.updateDialogue(performance.now());
    this.applyMix();
  }

  play(kind: AudioCue) {
    const mixer = this.mix;
    if (
      !mixer ||
      this.muted ||
      this.backgrounded ||
      this.mode === "paused" ||
      mixer.context.state !== "running"
    )
      return;
    const cue: Cue = CUES[kind];
    if (cue.duck)
      this.cueUntil = Math.max(
        this.cueUntil,
        performance.now() + cue.duck * 1000,
      );
    this.applyMix();
    const at = mixer.context.currentTime + 0.009;
    for (const tone of cue.tones ?? []) playTone(mixer, at, tone);
    for (const texture of cue.textures ?? []) playTexture(mixer, at, texture);
  }

  speak(id: VoiceId) {
    if (this.backgrounded || this.pending || this.line) return false;
    this.pending = id;
    return true;
  }

  say(speaker: string, text: string) {
    this.clearDialogue();
    this.pending = { speaker, text };
  }

  clearDialogue() {
    this.pending = null;
    if (this.line?.source && this.mix)
      this.line.source.stop(this.mix.context.currentTime + 0.045);
    this.line = null;
    this.caption = null;
  }

  private load(file: string, accept: (buffer: AudioBuffer) => void) {
    if (!this.mix || this.loading.has(file)) return;
    const { context } = this.mix;
    this.loading.add(file);
    void fetch(`${import.meta.env.BASE_URL}audio/${file}`)
      .then((response) => {
        if (!response.ok) throw Error("Audio file unavailable");
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then(accept)
      .catch(() => {
        // A later Start or Resume retries missing audio. Gameplay continues in the meantime.
      })
      .finally(() => this.loading.delete(file));
  }

  private updateDialogue(now: number) {
    if (this.line && now >= this.line.end) {
      this.line = null;
      this.caption = null;
    }
    if (!this.pending || this.line || now < this.cueUntil) return;
    const id = this.pending;
    const line = typeof id === "string" ? VOICES[id] : id;
    const buffer = typeof id === "string" ? this.voices.get(id) : undefined;
    const mixer = this.mix;
    if (
      typeof id === "string" &&
      !buffer &&
      this.loading.has(`voice/${id}.mp3`) &&
      !this.muted
    )
      return;
    this.pending = null;
    let source = null;
    if (buffer && mixer?.context.state === "running" && !this.muted) {
      source = mixer.context.createBufferSource();
      source.buffer = buffer;
      source.connect(mixer.voice);
      const clip = source;
      clip.onended = () => clip.disconnect();
      clip.start();
    }
    const duration =
      buffer?.duration ?? Math.max(2.2, line.text.length * 0.058);
    this.line = { end: now + duration * 1000 + 100, source };
    this.caption = line;
  }

  private applyMix() {
    const mixer = this.mix;
    if (!mixer) return;
    const allowed =
      !this.backgrounded &&
      !this.muted &&
      this.mode !== "paused" &&
      this.mode !== "title";
    const playing = this.mode === "playing";
    const scene = this.mode === "task-scene";
    const menu = this.mode === "choice" || this.mode === "cashout";
    const score = playing ? 1 : scene ? 0.31 : menu ? 0.48 : 0;
    const beach = playing ? 1 : scene ? 0.27 : menu ? 0.48 : 0;
    const quietCue = this.cueUntil > performance.now();
    const duck = quietCue ? 0.26 : this.line ? 0.43 : 1;
    this.ramp(mixer.master.gain, allowed ? 0.85 : 0, 0.025);
    this.ramp(mixer.music.gain, score * 0.65 * this.musicVolume, 0.14);
    this.ramp(mixer.beach.gain, beach * (0.079 + this.shore * 0.34), 0.2);
    this.ramp(mixer.duck.gain, duck, duck === 1 ? 0.19 : 0.043);
    this.ramp(mixer.voice.gain, quietCue ? 0.64 : 0.92, 0.05);
  }

  private ramp(param: AudioParam, value: number, speed: number) {
    if (!this.mix || this.gainTargets.get(param) === value) return;
    this.gainTargets.set(param, value);
    const now = this.mix.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, speed);
  }
}
