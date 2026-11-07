import { Biquad } from '../dsp/filters.ts';
import { Noise, Rng, TWO_PI, clamp, mtof, panGains } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

const MAXR = 96;

/** A bank of damped sinusoid resonators (modal synthesis). Amplitude lives in the initial state. */
class ModalVoice extends VoiceBase {
  n = 0;
  y1 = new Float64Array(MAXR);
  y2 = new Float64Array(MAXR);
  c1 = new Float64Array(MAXR);
  c2 = new Float64Array(MAXR);
  cw = new Float64Array(MAXR);
  rr = new Float64Array(MAXR);
  gL = 1;
  gR = 1;
  hamAmp = 0;
  hamDecay = 0;
  hamLp = 0;
  hamCoef = 0.5;
  hamLeft = 0;
  releasing = false;
  relSec = 0.2;
  noise = new Noise(1);

  addMode(freq: number, amp: number, t60: number, sr: number): void {
    if (this.n >= MAXR || freq >= sr * 0.46 || amp < 1e-5) return;
    const w = (TWO_PI * freq) / sr;
    const r = Math.exp(-6.9078 / (Math.max(0.02, t60) * sr));
    const j = this.n++;
    this.cw[j] = Math.cos(w);
    this.rr[j] = r;
    this.c1[j] = 2 * r * this.cw[j];
    this.c2[j] = r * r;
    this.y1[j] = amp * r * Math.sin(w);
    this.y2[j] = 0;
  }

  /** Switch every mode to a fast decay, like a damper touching the strings. */
  damp(relSec: number, sr: number): void {
    const rrel = Math.exp(-6.9078 / (Math.max(0.01, relSec) * sr));
    for (let j = 0; j < this.n; j++) {
      const r = Math.min(this.rr[j], rrel);
      this.rr[j] = r;
      this.c1[j] = 2 * r * this.cw[j];
      this.c2[j] = r * r;
    }
    this.releasing = true;
    this.relSec = relSec;
  }
}

abstract class ModalInstrument extends InstrumentBase<ModalVoice> {
  protected scratchL = new Float32Array(16384);
  protected scratchR = new Float32Array(16384);
  protected rng: Rng;
  protected bodyL: Biquad[] = [];
  protected bodyR: Biquad[] = [];
  constructor(sr: number, params: ParamDesc[], seed: number, voices: number) {
    super(sr, params);
    this.rng = new Rng(seed);
    this.addVoices(voices, () => new ModalVoice());
    for (let i = 0; i < this.voices.length; i++) this.voices[i].noise = new Noise(seed + i * 77 + 3);
  }
  protected renderVoice(v: ModalVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const n = v.n;
    const { y1, y2, c1, c2 } = v;
    const gL = v.gL * this.volume;
    const gR = v.gR * this.volume;
    let acc = 0;
    for (let i = s; i < e; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        const y = c1[j] * y1[j] - c2[j] * y2[j];
        y2[j] = y1[j];
        y1[j] = y;
        sum += y;
      }
      if (v.hamLeft > 0) {
        v.hamLeft--;
        v.hamLp += v.hamCoef * (v.noise.white() - v.hamLp);
        sum += v.hamLp * v.hamAmp;
        v.hamAmp *= v.hamDecay;
      }
      acc += sum * sum;
      L[i] += sum * gL;
      R[i] += sum * gR;
    }
    v.age += e - s;
    if (v.age > this.sr * 0.06 && acc / Math.max(1, e - s) < 1e-11 && v.hamLeft <= 0) {
      v.active = false;
    }
    if (v.releasing && v.age > this.sr * (v.relSec * 4 + 0.3)) v.active = false;
  }
  protected releaseVoice(v: ModalVoice): void {
    v.damp(this.releaseTime(v.pitch), this.sr);
  }
  protected abstract releaseTime(pitch: number): number;
  protected applyBody(L: Float32Array, R: Float32Array, s: number, e: number): void {
    for (const f of this.bodyL) f.run(L, s, e);
    for (const f of this.bodyR) f.run(R, s, e);
  }
  override process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const sl = this.scratchL;
    const sr_ = this.scratchR;
    sl.fill(0, s, e);
    sr_.fill(0, s, e);
    for (const v of this.voices) if (v.active) this.renderVoice(v, sl, sr_, s, e);
    this.applyBody(sl, sr_, s, e);
    this.postProcess(sl, sr_, s, e);
    for (let i = s; i < e; i++) {
      L[i] += sl[i];
      R[i] += sr_[i];
    }
  }
  protected postProcess(_L: Float32Array, _R: Float32Array, _s: number, _e: number): void {}
}

// ------------------------------------------------------------------------ piano

const PIANO_PARAMS: ParamDesc[] = [
  { id: 'brightness', name: 'Brightness', min: -1, max: 1, def: 0, group: 'Tone' },
  { id: 'hammer', name: 'Hammer noise', min: 0, max: 1, def: 0.5, group: 'Tone' },
  { id: 'body', name: 'Soundboard', min: 0, max: 1, def: 0.7, group: 'Tone' },
  { id: 'decay', name: 'Decay', min: 0.3, max: 2.5, def: 1, group: 'Strings' },
  { id: 'detune', name: 'String detune', min: 0, max: 12, def: 1.1, unit: 'cents', group: 'Strings' },
  { id: 'inharm', name: 'Inharmonicity', min: 0, max: 3, def: 1, group: 'Strings' },
  { id: 'release', name: 'Damper time', min: 0.3, max: 3, def: 1, group: 'Strings' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.55, group: 'Output' },
  { id: 'tune', name: 'Tuning', min: -50, max: 50, def: 0, unit: 'cents', group: 'Output' },
];

class Piano extends ModalInstrument {
  readonly type = 'piano';
  constructor(sr: number, seed: number) {
    super(sr, PIANO_PARAMS, seed, 24);
    this.buildBody();
  }
  protected override onParam(id: string): void {
    if (id === 'body' || id === 'brightness') this.buildBody();
  }
  private buildBody(): void {
    const b = this.p.body;
    const defs: [string, number, number, number][] = [
      ['peak', 95, 1.3, 3 * b],
      ['peak', 230, 1.0, 2.2 * b],
      ['peak', 560, 0.8, -1.6 * b],
      ['peak', 2900, 0.7, 2 * b],
      ['highshelf', 6500, 0.7, 3 * this.p.brightness - 1.5 * b],
    ];
    this.bodyL = [];
    this.bodyR = [];
    for (const [t, f, q, g] of defs) {
      const a = new Biquad();
      a.set(t as 'peak', f, q, g, this.sr);
      const c = new Biquad();
      c.set(t as 'peak', f, q, g, this.sr);
      this.bodyL.push(a);
      this.bodyR.push(c);
    }
  }
  protected releaseTime(pitch: number): number {
    return (0.07 + 0.5 * Math.exp(-0.05 * (pitch - 21))) * this.p.release;
  }
  protected startVoice(v: ModalVoice, pitch: number, vel: number): void {
    const sr = this.sr;
    const p = this.p;
    v.n = 0;
    v.releasing = false;
    const f0 = mtof(pitch) * Math.pow(2, p.tune / 1200);
    const velN = vel / 127;
    const B = clamp(0.00004 * Math.exp(0.062 * (pitch - 21)), 0.00008, 0.012) * p.inharm;
    const T0 = clamp(22 * Math.exp(-0.043 * (pitch - 21)), 1.3, 24) * p.decay;
    const strike = 0.113 + (pitch > 72 ? 0.02 : 0);
    const tilt = Math.max(0.012, 0.21 - 0.18 * Math.pow(velN, 0.8) - 0.045 * p.brightness);
    const detuneRatio = (p.detune / 1200) * Math.LN2;
    let sumSq = 0;
    const modes: [number, number, number][] = [];
    for (let k = 1; k <= 48; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > sr * 0.45) break;
      const a = Math.abs(Math.sin(Math.PI * k * strike)) * Math.pow(k, -0.62) * Math.exp(-(k - 1) * tilt);
      if (a < 0.004) continue;
      const tk = Math.max(0.1, T0 / (1 + 0.55 * Math.pow(k - 1, 1.2)));
      const d = detuneRatio * (0.5 + this.rng.next() * 0.9);
      modes.push([fk * (1 - d), a * 0.62, tk * 0.5]);
      modes.push([fk * (1 + d * 1.15), a * 0.5, tk * 1.55]);
      sumSq += a * a * 0.62 * 0.62 + a * a * 0.25;
    }
    const level = (0.5 / Math.sqrt(Math.max(1e-6, sumSq))) * Math.pow(velN, 1.55);
    for (const [f, a, t] of modes) v.addMode(f, a * level, t, sr);
    const [pl, pr] = panGains(clamp(((pitch - 60) / 48) * p.stereo, -1, 1));
    v.gL = pl * Math.SQRT2;
    v.gR = pr * Math.SQRT2;
    // hammer thump + felt noise
    v.hamLeft = Math.round(sr * 0.012);
    v.hamAmp = 0.05 * Math.pow(velN, 1.4) * p.hammer * (1 + (pitch < 40 ? 0.5 : 0));
    v.hamDecay = Math.exp(-1 / (0.0035 * sr));
    v.hamCoef = clamp(0.12 + velN * 0.45 + p.brightness * 0.15, 0.05, 0.9);
    v.hamLp = 0;
  }
}

export const pianoDef: InstDef = {
  type: 'piano',
  name: 'Piano',
  category: 'keys',
  description:
    'Modal piano: inharmonic partials, two detuned strings per note with a double-slope decay, hammer noise, damper release and a soundboard EQ. Sustain pedal (CC64) works.',
  range: [21, 108],
  polyphony: 'poly',
  params: PIANO_PARAMS,
  articulations: [],
  presets: {
    'Concert grand': {},
    'Upright': { brightness: -0.15, hammer: 0.8, decay: 0.6, detune: 2.2, stereo: 0.3, body: 1 },
    'Bright studio': { brightness: 0.55, hammer: 0.4, decay: 0.9, stereo: 0.6 },
    'Felt / mellow': { brightness: -0.75, hammer: 0.15, decay: 0.8, body: 0.9, stereo: 0.4 },
    'Honky-tonk': { brightness: 0.3, detune: 7, inharm: 1.8, hammer: 0.9, decay: 0.7 },
  },
  create: (sr, seed) => new Piano(sr, seed),
};

// ------------------------------------------------------------------------ mallets

interface MalletType {
  ratios: number[];
  gains: number[];
  decay: number[];
  t60: (pitch: number) => number;
  knock: number;
  knockHz: number;
}

const MALLETS: Record<string, MalletType> = {
  marimba: {
    ratios: [1, 3.99, 10.2], gains: [1, 0.38, 0.12], decay: [1, 0.3, 0.1],
    t60: (p) => clamp(2.4 * Math.exp(-0.04 * (p - 36)), 0.25, 3), knock: 0.5, knockHz: 1300,
  },
  vibraphone: {
    ratios: [1, 4.0, 10.0], gains: [1, 0.22, 0.07], decay: [1, 0.22, 0.1],
    t60: (p) => clamp(7 * Math.exp(-0.035 * (p - 53)), 1.2, 9), knock: 0.2, knockHz: 2500,
  },
  glockenspiel: {
    ratios: [1, 2.756, 5.404, 8.933], gains: [1, 0.55, 0.3, 0.16], decay: [1, 0.55, 0.3, 0.16],
    t60: (p) => clamp(4.5 * Math.exp(-0.03 * (p - 72)), 0.9, 4.5), knock: 0.35, knockHz: 6000,
  },
  celesta: {
    ratios: [1, 2.76, 5.4], gains: [1, 0.2, 0.06], decay: [1, 0.4, 0.15],
    t60: (p) => clamp(3.2 * Math.exp(-0.03 * (p - 72)), 0.8, 3.2), knock: 0.25, knockHz: 4000,
  },
  'tubular bells': {
    ratios: [0.5, 1, 1.183, 1.506, 2, 2.514, 3.011, 4.166], gains: [0.45, 0.9, 0.6, 0.5, 1, 0.36, 0.28, 0.18],
    decay: [1.1, 1, 0.8, 0.7, 0.6, 0.35, 0.3, 0.2],
    t60: (p) => clamp(9 * Math.exp(-0.03 * (p - 60)), 2, 11), knock: 0.4, knockHz: 3000,
  },
  kalimba: {
    ratios: [1, 5.4, 15.3], gains: [1, 0.12, 0.03], decay: [1, 0.15, 0.05],
    t60: (p) => clamp(2.2 * Math.exp(-0.03 * (p - 60)), 0.5, 2.4), knock: 0.5, knockHz: 2200,
  },
  'music box': {
    ratios: [1, 6.27, 17.55], gains: [1, 0.14, 0.04], decay: [1, 0.18, 0.06],
    t60: (p) => clamp(1.3 * Math.exp(-0.025 * (p - 72)), 0.4, 1.4), knock: 0.3, knockHz: 5000,
  },
};
const MALLET_NAMES = Object.keys(MALLETS);

const MALLET_PARAMS: ParamDesc[] = [
  { id: 'type', name: 'Instrument', min: 0, max: MALLET_NAMES.length - 1, def: 0, options: MALLET_NAMES },
  { id: 'hardness', name: 'Mallet hardness', min: 0.3, max: 1.4, def: 0.9 },
  { id: 'decay', name: 'Decay', min: 0.3, max: 3, def: 1 },
  { id: 'motor', name: 'Motor depth', min: 0, max: 1, def: 0.5 },
  { id: 'motor_rate', name: 'Motor rate', min: 0, max: 9, def: 4.5, unit: 'Hz' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.5 },
];

class Mallet extends ModalInstrument {
  readonly type = 'mallet';
  private lfo = 0;
  constructor(sr: number, seed: number) {
    super(sr, MALLET_PARAMS, seed, 16);
  }
  protected releaseTime(pitch: number): number {
    const t = MALLETS[MALLET_NAMES[Math.round(this.p.type)]];
    return Math.round(this.p.type) === 1 ? 0.35 : Math.min(0.5, t.t60(pitch) * 0.2);
  }
  protected startVoice(v: ModalVoice, pitch: number, vel: number): void {
    const sr = this.sr;
    const t = MALLETS[MALLET_NAMES[Math.round(this.p.type)]];
    v.n = 0;
    v.releasing = false;
    const f0 = mtof(pitch);
    const velN = vel / 127;
    const base = t.t60(pitch) * this.p.decay;
    const hard = this.p.hardness * (0.7 + 0.5 * velN);
    let sumSq = 0;
    const list: [number, number, number][] = [];
    for (let k = 0; k < t.ratios.length; k++) {
      const g = t.gains[k] * Math.pow(hard, k * 1.2);
      list.push([f0 * t.ratios[k] * (1 + (this.rng.next() - 0.5) * 0.0006), g, base * t.decay[k]]);
      sumSq += g * g;
    }
    const level = (0.42 / Math.sqrt(sumSq)) * Math.pow(velN, 1.3);
    for (const [f, a, t60] of list) v.addMode(f, a * level, t60, sr);
    const [pl, pr] = panGains(clamp(((pitch - 60) / 40) * this.p.stereo, -1, 1));
    v.gL = pl * Math.SQRT2;
    v.gR = pr * Math.SQRT2;
    v.hamLeft = Math.round(sr * 0.02);
    v.hamAmp = 0.1 * t.knock * Math.pow(velN, 1.2);
    v.hamDecay = Math.exp(-1 / (0.004 * sr));
    v.hamCoef = clamp((2 * Math.PI * t.knockHz) / sr, 0.05, 0.95);
    v.hamLp = 0;
  }
  protected override postProcess(L: Float32Array, R: Float32Array, s: number, e: number): void {
    if (Math.round(this.p.type) !== 1 || this.p.motor < 0.01 || this.p.motor_rate < 0.1) return;
    const depth = this.p.motor * 0.45;
    for (let i = s; i < e; i++) {
      this.lfo += (TWO_PI * this.p.motor_rate) / this.sr;
      if (this.lfo > TWO_PI) this.lfo -= TWO_PI;
      const g = 1 - depth + depth * Math.sin(this.lfo);
      L[i] *= g;
      R[i] *= 1 - depth + depth * Math.sin(this.lfo + 0.6);
    }
  }
}

export const malletDef: InstDef = {
  type: 'mallet',
  name: 'Mallet & bells',
  category: 'percussion',
  description:
    'Modal bars and bells: marimba, vibraphone (with motor), glockenspiel, celesta, tubular bells, kalimba, music box.',
  range: [36, 108],
  polyphony: 'poly',
  params: MALLET_PARAMS,
  presets: {
    Marimba: { type: 'marimba' },
    Vibraphone: { type: 'vibraphone' },
    Glockenspiel: { type: 'glockenspiel', decay: 0.8 },
    Celesta: { type: 'celesta' },
    'Tubular bells': { type: 'tubular bells' },
    Kalimba: { type: 'kalimba' },
    'Music box': { type: 'music box' },
  },
  create: (sr, seed) => new Mallet(sr, seed),
};
