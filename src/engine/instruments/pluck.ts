import { Biquad } from '../dsp/filters.ts';
import { Noise, clamp, mtof, panGains, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

/**
 * Extended Karplus-Strong string: noise excitation shaped by pick position and brightness, a loop with
 * low-pass damping and an all-pass fractional delay for accurate tuning.
 */
export class KSString {
  private buf: Float32Array;
  private n = 1;
  private idx = 0;
  private prev = 0;
  private apX = 0;
  private apY = 0;
  private eta = 0;
  private d = 0.2;
  private rho = 0.999;
  private maxLen: number;
  constructor(maxLen: number) {
    this.maxLen = maxLen;
    this.buf = new Float32Array(maxLen + 4);
  }
  /**
   * freq in Hz, t60 in seconds, damping 0..1 (loop low-pass), pickPos 0..0.5, bright 0..1 excitation brightness.
   * `noise` supplies the excitation so renders stay deterministic.
   */
  pluck(freq: number, sr: number, t60: number, damping: number, pickPos: number, bright: number, amp: number, noise: Noise): void {
    const d = clamp(0.02 + damping * 0.44, 0.0, 0.48);
    const total = sr / freq;
    const dl = total - d;
    const n = Math.max(4, Math.min(this.maxLen, Math.floor(dl - 0.5)));
    const frac = dl - n;
    this.n = n;
    this.eta = (1 - frac) / (1 + frac);
    this.d = d;
    this.rho = Math.min(0.99995, Math.exp(-6.9078 / (freq * Math.max(0.05, t60))));
    this.idx = 0;
    this.prev = 0;
    this.apX = 0;
    this.apY = 0;
    // excitation: white noise -> brightness low-pass -> pick-position comb
    const ex = new Float32Array(n);
    let lp = 0;
    const c = clamp(0.08 + bright * 0.9, 0.05, 0.98);
    for (let i = 0; i < n; i++) {
      lp += c * (noise.white() - lp);
      ex[i] = lp;
    }
    const pk = Math.max(1, Math.round(pickPos * n));
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const v = ex[i] - (i >= pk ? ex[i - pk] : 0);
      this.buf[i] = v;
      rms += v * v;
    }
    const g = (amp * 0.9) / Math.sqrt(rms / n + 1e-9);
    for (let i = 0; i < n; i++) this.buf[i] *= g;
  }
  /** Per-note tweak after plucking: make the string die faster (muting). */
  setLoss(rho: number): void {
    this.rho = Math.min(this.rho, rho);
  }
  tick(): number {
    const out = this.buf[this.idx];
    const lp = (1 - this.d) * out + this.d * this.prev;
    this.prev = out;
    const ap = this.eta * lp + this.apX - this.eta * this.apY;
    this.apX = lp;
    this.apY = ap;
    this.buf[this.idx] = ap * this.rho;
    if (++this.idx >= this.n) this.idx = 0;
    return out;
  }
}

class PluckVoice extends VoiceBase {
  string: KSString;
  noise = new Noise(5);
  gL = 1;
  gR = 1;
  relGain = 1;
  relCoef = 1;
  releasing = false;
  fade = 0;
  constructor(maxLen: number) {
    super();
    this.string = new KSString(maxLen);
  }
}

const BODIES: Record<string, [string, number, number, number][]> = {
  none: [],
  acoustic: [['peak', 98, 3, 5], ['peak', 205, 3, 4], ['peak', 410, 2, 2], ['peak', 1100, 1.2, -2], ['highshelf', 5500, 0.7, -2]],
  nylon: [['peak', 110, 3, 5], ['peak', 220, 2.5, 3], ['peak', 480, 1.6, 2], ['highshelf', 4000, 0.7, -4]],
  harp: [['peak', 140, 1.5, 3], ['peak', 320, 1.4, 2.5], ['peak', 900, 1, 1], ['highshelf', 7000, 0.7, -1]],
  resonator: [['peak', 420, 2, 6], ['peak', 1200, 1.5, 4], ['peak', 2800, 1, 3]],
  electric: [['peak', 120, 1, 2], ['peak', 2400, 1.1, 3], ['highshelf', 6000, 0.7, -5]],
};
const BODY_NAMES = Object.keys(BODIES);

const PARAMS: ParamDesc[] = [
  { id: 'decay', name: 'Decay', min: 0.2, max: 4, def: 1, group: 'String' },
  { id: 'damping', name: 'Damping', min: 0, max: 1, def: 0.35, group: 'String' },
  { id: 'pick_pos', name: 'Pick position', min: 0.04, max: 0.5, def: 0.2, group: 'String' },
  { id: 'bright', name: 'Pluck brightness', min: 0, max: 1, def: 0.6, group: 'String' },
  { id: 'ring', name: 'Let ring', min: 0, max: 1, def: 0.3, group: 'String' },
  { id: 'body_type', name: 'Body', min: 0, max: BODY_NAMES.length - 1, def: 1, options: BODY_NAMES, group: 'Body' },
  { id: 'body', name: 'Body amount', min: 0, max: 1, def: 0.8, group: 'Body' },
  { id: 'pickup', name: 'Pickup position', min: 0, max: 1, def: 0, group: 'Body' },
  { id: 'drive', name: 'Amp drive', min: 0, max: 1, def: 0, group: 'Body' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.35, group: 'Output' },
  { id: 'low_t60', name: 'Sustain (low notes)', min: 0.5, max: 15, def: 5, unit: 's', group: 'String' },
  { id: 'high_t60', name: 'Sustain (high notes)', min: 0.2, max: 8, def: 1.8, unit: 's', group: 'String' },
];

class PluckedStrings extends InstrumentBase<PluckVoice> {
  readonly type = 'plucked';
  private scratchL = new Float32Array(16384);
  private scratchR = new Float32Array(16384);
  private bodyL: Biquad[] = [];
  private bodyR: Biquad[] = [];
  private pickL = new Biquad();
  private pickR = new Biquad();
  private nz: Noise;
  constructor(sr: number, seed: number) {
    super(sr, PARAMS);
    this.nz = new Noise(seed + 11);
    const maxLen = Math.ceil(sr / 24) + 8;
    this.addVoices(14, () => new PluckVoice(maxLen));
    this.voices.forEach((v, i) => (v.noise = new Noise(seed * 31 + i * 17 + 1)));
    this.buildBody();
  }
  protected override onParam(id: string): void {
    if (id === 'body_type' || id === 'body' || id === 'pickup') this.buildBody();
  }
  private buildBody(): void {
    const defs = BODIES[BODY_NAMES[Math.round(this.p.body_type)]];
    this.bodyL = [];
    this.bodyR = [];
    for (const [t, f, q, g] of defs) {
      const a = new Biquad();
      a.set(t as 'peak', f, q, g * this.p.body, this.sr);
      const b = new Biquad();
      b.set(t as 'peak', f, q, g * this.p.body, this.sr);
      this.bodyL.push(a);
      this.bodyR.push(b);
    }
    // pickup position: a comb-like notch around the pickup, approximated by a peaking cut
    const pu = this.p.pickup;
    if (pu > 0.01) {
      const f = 900 + pu * 2200;
      this.pickL.set('peak', f, 1.4, 4 * pu, this.sr);
      this.pickR.set('peak', f, 1.4, 4 * pu, this.sr);
    } else {
      this.pickL.set('peak', 1000, 1, 0, this.sr);
      this.pickR.set('peak', 1000, 1, 0, this.sr);
    }
  }
  protected startVoice(v: PluckVoice, pitch: number, vel: number, art?: string): void {
    const p = this.p;
    const f0 = mtof(pitch);
    const velN = vel / 127;
    const t = clamp(p.low_t60 * Math.pow(p.high_t60 / p.low_t60, clamp((pitch - 36) / 60, 0, 1)), 0.1, 20) * p.decay;
    let damping = p.damping + (pitch - 60) * 0.0012;
    let t60 = t;
    if (art === 'mute') {
      t60 *= 0.2;
      damping += 0.2;
    } else if (art === 'stac') t60 *= 0.5;
    v.string.pluck(f0, this.sr, t60, clamp(damping, 0, 1), p.pick_pos, clamp(p.bright * (0.45 + velN * 0.75), 0, 1), 0.18 + 0.82 * Math.pow(velN, 1.2), v.noise);
    v.relGain = 1;
    v.releasing = false;
    v.relCoef = 1;
    v.fade = 0;
    const [pl, pr] = panGains(clamp(((pitch - 60) / 40) * p.stereo, -1, 1));
    v.gL = pl * Math.SQRT2;
    v.gR = pr * Math.SQRT2;
  }
  protected releaseVoice(v: PluckVoice): void {
    const relT = 0.05 + this.p.ring * 2.6;
    v.relCoef = Math.exp(-6.9078 / (relT * this.sr));
    v.releasing = true;
  }
  protected renderVoice(v: PluckVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    let acc = 0;
    const gL = v.gL * this.volume;
    const gR = v.gR * this.volume;
    for (let i = s; i < e; i++) {
      let x = v.string.tick();
      if (v.releasing) {
        v.relGain *= v.relCoef;
        x *= v.relGain;
      }
      acc += x * x;
      L[i] += x * gL;
      R[i] += x * gR;
    }
    v.age += e - s;
    if (v.age > this.sr * 0.05 && acc / Math.max(1, e - s) < 1e-11) v.active = false;
    if (v.releasing && v.relGain < 1e-4) v.active = false;
  }
  override process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const sl = this.scratchL;
    const sr_ = this.scratchR;
    sl.fill(0, s, e);
    sr_.fill(0, s, e);
    for (const v of this.voices) if (v.active) this.renderVoice(v, sl, sr_, s, e);
    for (const f of this.bodyL) f.run(sl, s, e);
    for (const f of this.bodyR) f.run(sr_, s, e);
    if (this.p.pickup > 0.01) {
      this.pickL.run(sl, s, e);
      this.pickR.run(sr_, s, e);
    }
    const drive = this.p.drive;
    for (let i = s; i < e; i++) {
      let l = sl[i];
      let r = sr_[i];
      if (drive > 0.01) {
        const g = 1 + drive * 14;
        l = fastTanh(l * g) / Math.sqrt(g);
        r = fastTanh(r * g) / Math.sqrt(g);
      }
      L[i] += l;
      R[i] += r;
    }
  }
}

export const pluckedDef: InstDef = {
  type: 'plucked',
  name: 'Plucked strings',
  category: 'plucked',
  description:
    'Karplus-Strong string model with pick position, damping, body resonances and let-ring control. Presets cover acoustic and nylon guitar, electric guitar, bass and harp. Use art "mute" for palm muting.',
  range: [28, 100],
  polyphony: 'poly',
  params: PARAMS,
  articulations: ['mute', 'stac'],
  presets: {
    'Acoustic guitar (steel)': { body_type: 'acoustic', body: 0.85, damping: 0.3, decay: 1, low_t60: 4.5, high_t60: 1.6, ring: 0.25 },
    'Nylon guitar': { body_type: 'nylon', body: 0.9, damping: 0.55, bright: 0.4, pick_pos: 0.25, low_t60: 3.5, high_t60: 1.2, ring: 0.35 },
    'Electric guitar (clean)': { body_type: 'electric', body: 0.9, pickup: 0.5, damping: 0.25, pick_pos: 0.16, low_t60: 5.5, high_t60: 2.4, bright: 0.7, stereo: 0.2 },
    'Electric guitar (crunch)': { body_type: 'electric', body: 0.9, pickup: 0.4, drive: 0.55, damping: 0.22, low_t60: 6, high_t60: 3, bright: 0.8, stereo: 0.2 },
    'Finger bass': { body_type: 'none', damping: 0.55, pick_pos: 0.3, bright: 0.25, low_t60: 2.6, high_t60: 1.2, ring: 0.1, stereo: 0, pickup: 0.3 },
    'Picked bass': { body_type: 'none', damping: 0.4, pick_pos: 0.15, bright: 0.75, low_t60: 2.2, high_t60: 1, ring: 0.1, stereo: 0, pickup: 0.5 },
    'Harp': { body_type: 'harp', body: 0.8, damping: 0.18, bright: 0.45, pick_pos: 0.3, low_t60: 9, high_t60: 3.5, ring: 0.9, stereo: 0.6 },
    'Banjo-ish': { body_type: 'resonator', body: 0.8, damping: 0.1, bright: 0.95, pick_pos: 0.1, low_t60: 1.4, high_t60: 0.6, ring: 0.1 },
  },
  create: (sr, seed) => new PluckedStrings(sr, seed),
};
