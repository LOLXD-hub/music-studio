import { DelayLine } from '../dsp/delay.ts';
import { Biquad, SVF } from '../dsp/filters.ts';
import { Noise, TWO_PI, flush, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

// ---------------------------------------------------------------- delay

const SYNC = ['Off', '1/1', '1/2', '1/4', '1/4 dotted', '1/4 triplet', '1/8', '1/8 dotted', '1/8 triplet', '1/16'];
const SYNC_BEATS = [0, 4, 2, 1, 1.5, 2 / 3, 0.5, 0.75, 1 / 3, 0.25];

const DP: ParamDesc[] = [
  { id: 'sync', name: 'Tempo sync', min: 0, max: SYNC.length - 1, def: 0, options: SYNC, group: 'Time' },
  { id: 'time_l', name: 'Left time', min: 1, max: 2000, def: 350, unit: 'ms', log: true, group: 'Time' },
  { id: 'time_r', name: 'Right time', min: 1, max: 2000, def: 350, unit: 'ms', log: true, group: 'Time' },
  { id: 'feedback', name: 'Feedback', min: 0, max: 0.95, def: 0.4, group: 'Main' },
  { id: 'pingpong', name: 'Ping-pong', min: 0, max: 1, def: 0, options: ['Off', 'On'], group: 'Main' },
  { id: 'lowcut', name: 'Low cut', min: 20, max: 2000, def: 120, unit: 'Hz', log: true, group: 'Tone' },
  { id: 'highcut', name: 'High cut', min: 500, max: 20000, def: 5500, unit: 'Hz', log: true, group: 'Tone' },
  { id: 'wobble', name: 'Tape wobble', min: 0, max: 1, def: 0.1, group: 'Tone' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 0.25, group: 'Output' },
];

class StereoDelay extends FxBase {
  private dl: DelayLine;
  private dr: DelayLine;
  private hpL = new Biquad();
  private hpR = new Biquad();
  private lpL = new Biquad();
  private lpR = new Biquad();
  private bpm = 120;
  private lfo = 0;
  private tL = 0;
  private tR = 0;
  constructor(sr: number) {
    super(sr, DP);
    this.dl = new DelayLine(Math.ceil(2.2 * sr));
    this.dr = new DelayLine(Math.ceil(2.2 * sr));
    this.update();
    this.tL = this.targetL();
    this.tR = this.targetR();
  }
  setTempo(bpm: number): void {
    this.bpm = bpm;
  }
  private targetL(): number {
    const b = SYNC_BEATS[Math.round(this.p.sync)];
    return b > 0 ? (b * 60 * this.sr) / this.bpm : (this.p.time_l * this.sr) / 1000;
  }
  private targetR(): number {
    const b = SYNC_BEATS[Math.round(this.p.sync)];
    return b > 0 ? (b * 60 * this.sr) / this.bpm : (this.p.time_r * this.sr) / 1000;
  }
  protected override update(): void {
    this.hpL.set('hp', this.p.lowcut, 0.707, 0, this.sr);
    this.hpR.set('hp', this.p.lowcut, 0.707, 0, this.sr);
    this.lpL.set('lp', this.p.highcut, 0.707, 0, this.sr);
    this.lpR.set('lp', this.p.highcut, 0.707, 0, this.sr);
  }
  override tail(): number {
    const f = Math.min(0.95, this.p.feedback);
    const t = (this.tL / this.sr) || 0.35;
    return Math.min(12, t * (Math.log(0.001) / Math.log(Math.max(0.05, f))));
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { feedback, pingpong, wobble, mix } = this.p;
    const tgtL = this.targetL();
    const tgtR = this.targetR();
    const slew = 0.0004;
    const wob = wobble * 0.0015 * this.sr; // up to ~1.5 ms of pitch wander
    for (let i = s; i < e; i++) {
      this.tL += (tgtL - this.tL) * slew;
      this.tR += (tgtR - this.tR) * slew;
      this.lfo += (TWO_PI * 0.55) / this.sr;
      if (this.lfo > TWO_PI) this.lfo -= TWO_PI;
      const m = Math.sin(this.lfo) * wob;
      const rl = this.dl.readCubic(Math.max(2, this.tL + m));
      const rr = this.dr.readCubic(Math.max(2, this.tR - m));
      let fl = this.lpL.tick(this.hpL.tick(rl)) * feedback;
      let fr = this.lpR.tick(this.hpR.tick(rr)) * feedback;
      const inL = L[i];
      const inR = R[i];
      if (pingpong >= 1) {
        this.dl.write(flush(0.5 * (inL + inR) + fr));
        this.dr.write(flush(fl));
      } else {
        this.dl.write(flush(inL + fl));
        this.dr.write(flush(inR + fr));
      }
      L[i] = inL + rl * mix;
      R[i] = inR + rr * mix;
    }
  }
  override reset(): void {
    this.dl.clear();
    this.dr.clear();
    this.hpL.reset(); this.hpR.reset(); this.lpL.reset(); this.lpR.reset();
  }
}

export const delayDef: FxDef = {
  type: 'delay',
  name: 'Delay',
  category: 'time',
  description: 'Stereo delay with tempo sync, ping-pong, filtered feedback and tape wobble.',
  params: DP,
  presets: {
    'Slapback': { sync: 0, time_l: 110, time_r: 120, feedback: 0.12, mix: 0.2, highcut: 4500 },
    'Dotted eighth echo': { sync: 7, feedback: 0.38, mix: 0.22, highcut: 5000 },
    'Ping-pong quarter': { sync: 3, pingpong: 1, feedback: 0.45, mix: 0.25 },
    'Tape echo': { sync: 0, time_l: 380, time_r: 380, feedback: 0.5, wobble: 0.5, highcut: 3500, mix: 0.3 },
  },
  create: (sr) => new StereoDelay(sr),
};

// ---------------------------------------------------------------- chorus

const CHP: ParamDesc[] = [
  { id: 'rate', name: 'Rate', min: 0.05, max: 6, def: 0.7, unit: 'Hz', log: true },
  { id: 'depth', name: 'Depth', min: 0, max: 12, def: 3.2, unit: 'ms' },
  { id: 'delay', name: 'Delay', min: 4, max: 40, def: 17, unit: 'ms' },
  { id: 'voices', name: 'Voices', min: 1, max: 4, def: 3, step: 1 },
  { id: 'spread', name: 'Stereo spread', min: 0, max: 1, def: 1 },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 0.4 },
];

class Chorus extends FxBase {
  private dl: DelayLine;
  private dr: DelayLine;
  private ph = 0;
  constructor(sr: number) {
    super(sr, CHP);
    this.dl = new DelayLine(Math.ceil(0.08 * sr));
    this.dr = new DelayLine(Math.ceil(0.08 * sr));
  }
  override tail(): number {
    return 0.05;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { rate, depth, delay, spread, mix } = this.p;
    const voices = Math.max(1, Math.round(this.p.voices));
    const dS = (depth * this.sr) / 1000;
    const bS = (delay * this.sr) / 1000;
    const inc = rate / this.sr;
    const norm = 1 / Math.sqrt(voices);
    for (let i = s; i < e; i++) {
      this.ph += inc;
      if (this.ph >= 1) this.ph -= 1;
      this.dl.write(L[i]);
      this.dr.write(R[i]);
      let wl = 0;
      let wr = 0;
      for (let v = 0; v < voices; v++) {
        const pv = this.ph + v / voices;
        const m = Math.sin(TWO_PI * pv);
        const a = this.dl.readCubic(Math.max(2, bS + dS * m));
        const b = this.dr.readCubic(Math.max(2, bS + dS * Math.sin(TWO_PI * (pv + 0.25 * spread))));
        // alternate voices left/right
        const pan = voices === 1 ? 0.5 : (v / (voices - 1)) * spread + (1 - spread) * 0.5;
        wl += a * (1 - pan) * 1.4 + b * (1 - pan) * 0.0;
        wr += b * pan * 1.4 + a * pan * 0.0;
        if (voices === 1) { wl = a; wr = b; }
      }
      L[i] = L[i] * (1 - 0.3 * mix) + wl * norm * mix;
      R[i] = R[i] * (1 - 0.3 * mix) + wr * norm * mix;
    }
  }
  override reset(): void {
    this.dl.clear();
    this.dr.clear();
  }
}

export const chorusDef: FxDef = {
  type: 'chorus',
  name: 'Chorus',
  category: 'modulation',
  description: 'Multi-voice chorus. Thickens and widens guitars, pads and electric pianos.',
  params: CHP,
  presets: {
    'Subtle widen': { rate: 0.4, depth: 2, mix: 0.3 },
    'Lush ensemble': { rate: 0.9, depth: 5, voices: 4, mix: 0.5 },
    'Vintage 80s': { rate: 1.3, depth: 4, delay: 12, voices: 2, mix: 0.55 },
  },
  create: (sr) => new Chorus(sr),
};

// ---------------------------------------------------------------- flanger

const FP: ParamDesc[] = [
  { id: 'rate', name: 'Rate', min: 0.02, max: 5, def: 0.25, unit: 'Hz', log: true },
  { id: 'depth', name: 'Depth', min: 0, max: 1, def: 0.7 },
  { id: 'delay', name: 'Delay', min: 0.2, max: 8, def: 1.8, unit: 'ms' },
  { id: 'feedback', name: 'Feedback', min: -0.95, max: 0.95, def: 0.55 },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 0.5 },
];

class Flanger extends FxBase {
  private dl: DelayLine;
  private dr: DelayLine;
  private ph = 0;
  private fl = 0;
  private fr = 0;
  constructor(sr: number) {
    super(sr, FP);
    this.dl = new DelayLine(Math.ceil(0.02 * sr));
    this.dr = new DelayLine(Math.ceil(0.02 * sr));
  }
  override tail(): number {
    return 0.3;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { rate, depth, delay, feedback, mix } = this.p;
    const base = (delay * this.sr) / 1000;
    for (let i = s; i < e; i++) {
      this.ph += rate / this.sr;
      if (this.ph >= 1) this.ph -= 1;
      const ml = 0.5 + 0.5 * Math.sin(TWO_PI * this.ph);
      const mr = 0.5 + 0.5 * Math.sin(TWO_PI * (this.ph + 0.25));
      const tl = Math.max(1.5, base * (1 + depth * 3 * ml));
      const tr = Math.max(1.5, base * (1 + depth * 3 * mr));
      this.dl.write(flush(L[i] + this.fl * feedback));
      this.dr.write(flush(R[i] + this.fr * feedback));
      this.fl = this.dl.readCubic(tl);
      this.fr = this.dr.readCubic(tr);
      L[i] = L[i] * (1 - mix * 0.5) + this.fl * mix;
      R[i] = R[i] * (1 - mix * 0.5) + this.fr * mix;
    }
  }
  override reset(): void {
    this.dl.clear();
    this.dr.clear();
    this.fl = this.fr = 0;
  }
}

export const flangerDef: FxDef = {
  type: 'flanger',
  name: 'Flanger',
  category: 'modulation',
  description: 'Short modulated delay with feedback, the classic jet-plane sweep.',
  params: FP,
  create: (sr) => new Flanger(sr),
};

// ---------------------------------------------------------------- phaser

const PHP: ParamDesc[] = [
  { id: 'rate', name: 'Rate', min: 0.02, max: 8, def: 0.35, unit: 'Hz', log: true },
  { id: 'depth', name: 'Depth', min: 0, max: 1, def: 0.8 },
  { id: 'center', name: 'Center', min: 150, max: 5000, def: 900, unit: 'Hz', log: true },
  { id: 'stages', name: 'Stages', min: 2, max: 12, def: 6, step: 2 },
  { id: 'feedback', name: 'Feedback', min: 0, max: 0.92, def: 0.4 },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 0.5 },
];

class Phaser extends FxBase {
  private zl = new Float64Array(12);
  private zr = new Float64Array(12);
  private ph = 0;
  private fbL = 0;
  private fbR = 0;
  constructor(sr: number) {
    super(sr, PHP);
  }
  override tail(): number {
    return 0.2;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { rate, depth, center, feedback, mix } = this.p;
    const stages = Math.min(12, Math.round(this.p.stages / 2) * 2);
    let aL = 0;
    let aR = 0;
    for (let i = s; i < e; i++) {
      this.ph += rate / this.sr;
      if (this.ph >= 1) this.ph -= 1;
      if (((i - s) & 15) === 0) {
        const fl = center * Math.pow(2, depth * 2 * Math.sin(TWO_PI * this.ph));
        const fr = center * Math.pow(2, depth * 2 * Math.sin(TWO_PI * (this.ph + 0.2)));
        const tl = Math.tan((Math.PI * Math.min(fl, this.sr * 0.45)) / this.sr);
        const tr = Math.tan((Math.PI * Math.min(fr, this.sr * 0.45)) / this.sr);
        aL = (tl - 1) / (tl + 1);
        aR = (tr - 1) / (tr + 1);
      }
      let xl = L[i] + this.fbL * feedback;
      let xr = R[i] + this.fbR * feedback;
      for (let k = 0; k < stages; k++) {
        const yl = aL * xl + this.zl[k];
        this.zl[k] = xl - aL * yl;
        xl = yl;
        const yr = aR * xr + this.zr[k];
        this.zr[k] = xr - aR * yr;
        xr = yr;
      }
      this.fbL = flush(xl);
      this.fbR = flush(xr);
      L[i] = L[i] * (1 - mix * 0.5) + xl * mix * 0.5;
      R[i] = R[i] * (1 - mix * 0.5) + xr * mix * 0.5;
    }
  }
  override reset(): void {
    this.zl.fill(0);
    this.zr.fill(0);
    this.fbL = this.fbR = 0;
  }
}

export const phaserDef: FxDef = {
  type: 'phaser',
  name: 'Phaser',
  category: 'modulation',
  description: 'All-pass phaser with up to 12 stages. Slow rates suit pads and electric piano.',
  params: PHP,
  create: (sr) => new Phaser(sr),
};

// ---------------------------------------------------------------- tremolo / auto-pan

const TP: ParamDesc[] = [
  { id: 'rate', name: 'Rate', min: 0.1, max: 20, def: 4.5, unit: 'Hz', log: true },
  { id: 'depth', name: 'Depth', min: 0, max: 1, def: 0.5 },
  { id: 'shape', name: 'Shape', min: 0, max: 2, def: 0, options: ['Sine', 'Triangle', 'Square'] },
  { id: 'pan', name: 'Auto-pan', min: 0, max: 1, def: 0 },
];

class Tremolo extends FxBase {
  private ph = 0;
  private sm = 0;
  constructor(sr: number) {
    super(sr, TP);
  }
  private wave(p: number): number {
    const sh = Math.round(this.p.shape);
    if (sh === 0) return Math.sin(TWO_PI * p);
    if (sh === 1) return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    return fastTanh(Math.sin(TWO_PI * p) * 6);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { rate, depth, pan } = this.p;
    for (let i = s; i < e; i++) {
      this.ph += rate / this.sr;
      if (this.ph >= 1) this.ph -= 1;
      const a = this.wave(this.ph) * 0.5 + 0.5;
      const b = this.wave((this.ph + 0.5) % 1) * 0.5 + 0.5;
      const gl = 1 - depth * (1 - (pan > 0 ? a : a));
      const gr = 1 - depth * (1 - (pan > 0 ? b * pan + a * (1 - pan) : a));
      L[i] *= gl;
      R[i] *= gr;
    }
  }
}

export const tremoloDef: FxDef = {
  type: 'tremolo',
  name: 'Tremolo / Auto-pan',
  category: 'modulation',
  description: 'Amplitude modulation. Turn Auto-pan up to make the left and right channels pulse against each other.',
  params: TP,
  create: (sr) => new Tremolo(sr),
};

// ---------------------------------------------------------------- lo-fi

const LF: ParamDesc[] = [
  { id: 'wow', name: 'Wow', min: 0, max: 1, def: 0.3, group: 'Tape' },
  { id: 'flutter', name: 'Flutter', min: 0, max: 1, def: 0.2, group: 'Tape' },
  { id: 'tone', name: 'Tone', min: 1000, max: 16000, def: 5200, unit: 'Hz', log: true, group: 'Tape' },
  { id: 'lowcut', name: 'Low cut', min: 20, max: 600, def: 60, unit: 'Hz', log: true, group: 'Tape' },
  { id: 'sat', name: 'Saturation', min: 0, max: 1, def: 0.25, group: 'Tape' },
  { id: 'crackle', name: 'Vinyl crackle', min: 0, max: 1, def: 0.2, group: 'Noise' },
  { id: 'hiss', name: 'Hiss', min: 0, max: 1, def: 0.1, group: 'Noise' },
  { id: 'bits', name: 'Bit depth', min: 6, max: 16, def: 14, step: 1, group: 'Digital' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 1, group: 'Output' },
];

class LoFi extends FxBase {
  private dl: DelayLine;
  private dr: DelayLine;
  private lpL = new Biquad();
  private lpR = new Biquad();
  private hpL = new Biquad();
  private hpR = new Biquad();
  private noise = new Noise(777);
  private wowPh = 0;
  private flPh = 0;
  private crack = 0;
  constructor(sr: number) {
    super(sr, LF);
    this.dl = new DelayLine(Math.ceil(0.05 * sr));
    this.dr = new DelayLine(Math.ceil(0.05 * sr));
    this.update();
  }
  protected override update(): void {
    this.lpL.set('lp', this.p.tone, 0.8, 0, this.sr);
    this.lpR.set('lp', this.p.tone, 0.8, 0, this.sr);
    this.hpL.set('hp', this.p.lowcut, 0.7, 0, this.sr);
    this.hpR.set('hp', this.p.lowcut, 0.7, 0, this.sr);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { wow, flutter, sat, crackle, hiss, mix } = this.p;
    const levels = Math.pow(2, Math.round(this.p.bits) - 1);
    const base = 0.012 * this.sr;
    const drive = 1 + sat * 5;
    for (let i = s; i < e; i++) {
      this.wowPh += 0.55 / this.sr;
      this.flPh += 6.3 / this.sr;
      const mod = Math.sin(TWO_PI * this.wowPh) * wow * 0.0012 * this.sr + Math.sin(TWO_PI * this.flPh) * flutter * 0.00015 * this.sr;
      this.dl.write(L[i]);
      this.dr.write(R[i]);
      let l = this.dl.readCubic(base + mod);
      let r = this.dr.readCubic(base + mod * 0.97);
      l = fastTanh(l * drive) / drive;
      r = fastTanh(r * drive) / drive;
      l = Math.round(l * levels) / levels;
      r = Math.round(r * levels) / levels;
      l = this.hpL.tick(this.lpL.tick(l));
      r = this.hpR.tick(this.lpR.tick(r));
      let n = this.noise.white() * hiss * 0.012;
      if (crackle > 0) {
        if (this.noise.white() > 1 - 0.0012 * crackle * 8) this.crack = (this.noise.white() * 0.5 + 0.5) * 0.18 * crackle;
        n += this.crack * this.noise.white();
        this.crack *= 0.82;
      }
      L[i] = L[i] * (1 - mix) + (l + n) * mix;
      R[i] = R[i] * (1 - mix) + (r + n * 0.9) * mix;
    }
  }
  override reset(): void {
    this.dl.clear();
    this.dr.clear();
  }
}

export const lofiDef: FxDef = {
  type: 'lofi',
  name: 'Lo-fi tape',
  category: 'distortion',
  description: 'Wow and flutter, tape saturation and roll-off, vinyl crackle, hiss and bit reduction in one box.',
  params: LF,
  presets: {
    'Dusty tape': { wow: 0.35, flutter: 0.25, tone: 4200, crackle: 0.3, hiss: 0.15, sat: 0.35, bits: 13 },
    'Subtle warmth': { wow: 0.08, flutter: 0.05, tone: 9000, crackle: 0, hiss: 0.03, sat: 0.2, bits: 16, mix: 0.7 },
    'Broken cassette': { wow: 0.8, flutter: 0.6, tone: 2800, crackle: 0.4, hiss: 0.3, sat: 0.5, bits: 10 },
  },
  create: (sr) => new LoFi(sr),
};

// ---------------------------------------------------------------- multimode filter

const FLP: ParamDesc[] = [
  { id: 'type', name: 'Type', min: 0, max: 3, def: 0, options: ['Low-pass', 'High-pass', 'Band-pass', 'Notch'] },
  { id: 'cutoff', name: 'Cutoff', min: 40, max: 18000, def: 2400, unit: 'Hz', log: true },
  { id: 'res', name: 'Resonance', min: 0.5, max: 12, def: 1.2 },
  { id: 'drive', name: 'Drive', min: 0, max: 1, def: 0 },
  { id: 'lfo_rate', name: 'LFO rate', min: 0.05, max: 12, def: 0.4, unit: 'Hz', log: true },
  { id: 'lfo_depth', name: 'LFO depth', min: 0, max: 1, def: 0 },
  { id: 'env_amt', name: 'Envelope follower', min: 0, max: 1, def: 0 },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 1 },
];

class FilterFx extends FxBase {
  private fl: SVF;
  private fr: SVF;
  private ph = 0;
  private env = 0;
  constructor(sr: number) {
    super(sr, FLP);
    this.fl = new SVF(sr);
    this.fr = new SVF(sr);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { cutoff, res, drive, lfo_rate, lfo_depth, env_amt, mix } = this.p;
    const type = Math.round(this.p.type);
    const g = 1 + drive * 4;
    for (let i = s; i < e; i++) {
      if (((i - s) & 15) === 0) {
        this.ph += (16 * lfo_rate) / this.sr;
        if (this.ph >= 1) this.ph -= 1;
        const mod = Math.sin(TWO_PI * this.ph) * lfo_depth * 2.5 + Math.min(1, this.env * 6) * env_amt * 3;
        const fc = cutoff * Math.pow(2, mod);
        this.fl.set(fc, res);
        this.fr.set(fc, res);
      }
      const xl = L[i];
      const xr = R[i];
      this.env += (Math.max(Math.abs(xl), Math.abs(xr)) - this.env) * 0.002;
      let yl: number;
      let yr: number;
      this.fl.tick(fastTanh(xl * g) / (g > 1 ? Math.sqrt(g) : 1));
      this.fr.tick(fastTanh(xr * g) / (g > 1 ? Math.sqrt(g) : 1));
      if (type === 0) { yl = this.fl.lp; yr = this.fr.lp; }
      else if (type === 1) { yl = this.fl.hp; yr = this.fr.hp; }
      else if (type === 2) { yl = this.fl.bp; yr = this.fr.bp; }
      else { yl = this.fl.lp + this.fl.hp; yr = this.fr.lp + this.fr.hp; }
      L[i] = xl * (1 - mix) + yl * mix;
      R[i] = xr * (1 - mix) + yr * mix;
    }
  }
  override reset(): void {
    this.fl.reset();
    this.fr.reset();
  }
}

export const filterDef: FxDef = {
  type: 'filter',
  name: 'Filter',
  category: 'filter',
  description: 'Resonant multimode filter with LFO and envelope follower. Automate the cutoff for sweeps and builds.',
  params: FLP,
  create: (sr) => new FilterFx(sr),
};
