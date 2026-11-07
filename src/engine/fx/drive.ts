import { Biquad, DcBlock } from '../dsp/filters.ts';
import { dbToGain, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

/** 2x oversampler using a short windowed-sinc half-band FIR, enough to tame aliasing from waveshapers. */
class Oversampler2x {
  private static taps: Float64Array = (() => {
    const n = 24;
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = i - (n - 1) / 2;
      const sinc = x === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
      h[i] = sinc * w;
    }
    return h;
  })();
  private upHist = new Float64Array(24);
  private dnHist = new Float64Array(24);
  private upPos = 0;
  private dnPos = 0;
  private fir(hist: Float64Array, pos: number): number {
    const h = Oversampler2x.taps;
    let acc = 0;
    for (let k = 0; k < 24; k++) acc += h[k] * hist[(pos - k + 24) % 24];
    return acc;
  }
  /** Run `shape` at 2x for one input sample. */
  process(x: number, shape: (v: number) => number): number {
    const push = (h: Float64Array, p: number, v: number) => {
      h[p] = v;
    };
    // upsample: zero-stuff + filter (gain 2 to keep level)
    this.upPos = (this.upPos + 1) % 24;
    push(this.upHist, this.upPos, x);
    const a = this.fir(this.upHist, this.upPos) * 2;
    this.upPos = (this.upPos + 1) % 24;
    push(this.upHist, this.upPos, 0);
    const b = this.fir(this.upHist, this.upPos) * 2;
    const sa = shape(a);
    const sb = shape(b);
    // downsample: filter both and keep every second sample
    this.dnPos = (this.dnPos + 1) % 24;
    push(this.dnHist, this.dnPos, sa);
    this.dnPos = (this.dnPos + 1) % 24;
    push(this.dnHist, this.dnPos, sb);
    return this.fir(this.dnHist, this.dnPos);
  }
}

const DR: ParamDesc[] = [
  { id: 'type', name: 'Type', min: 0, max: 5, def: 0, options: ['Soft (tanh)', 'Hard clip', 'Tube', 'Wave fold', 'Tape', 'Fuzz'] },
  { id: 'drive', name: 'Drive', min: 0, max: 40, def: 10, unit: 'dB' },
  { id: 'tone', name: 'Tone', min: 500, max: 18000, def: 7000, unit: 'Hz', log: true },
  { id: 'bias', name: 'Bias', min: 0, max: 1, def: 0 },
  { id: 'output', name: 'Output', min: -24, max: 12, def: -3, unit: 'dB' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 1 },
];

class Distortion extends FxBase {
  private osL = new Oversampler2x();
  private osR = new Oversampler2x();
  private toneL = new Biquad();
  private toneR = new Biquad();
  private dcL = new DcBlock();
  private dcR = new DcBlock();
  private shaper: (v: number) => number = (v) => fastTanh(v);
  constructor(sr: number) {
    super(sr, DR);
    this.update();
  }
  protected override update(): void {
    this.toneL.set('lp', this.p.tone, 0.707, 0, this.sr);
    this.toneR.set('lp', this.p.tone, 0.707, 0, this.sr);
    const bias = this.p.bias * 0.35;
    switch (Math.round(this.p.type)) {
      case 1: this.shaper = (v) => (v > 1 ? 1 : v < -1 ? -1 : v); break;
      case 2: this.shaper = (v) => (v > 0 ? fastTanh(v + bias) : fastTanh(v * 0.65 + bias) * 1.25); break;
      case 3: this.shaper = (v) => Math.sin(v * 1.5707963 * 1.4); break;
      case 4: this.shaper = (v) => fastTanh(v * 0.9 + bias * 0.3) * 1.05; break;
      case 5: this.shaper = (v) => Math.sign(v + bias * 0.2) * (1 - Math.exp(-Math.abs(v) * 2.2)); break;
      default: this.shaper = (v) => fastTanh(v + bias);
    }
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const g = dbToGain(this.p.drive);
    const out = dbToGain(this.p.output);
    const mix = this.p.mix;
    const sh = this.shaper;
    const pre = g > 1 ? 1 / Math.sqrt(g) : 1;
    for (let i = s; i < e; i++) {
      const dl = L[i];
      const dr = R[i];
      let yl = this.osL.process(dl * g, sh);
      let yr = this.osR.process(dr * g, sh);
      yl = this.dcL.tick(yl) * pre;
      yr = this.dcR.tick(yr) * pre;
      yl = this.toneL.tick(yl) * out;
      yr = this.toneR.tick(yr) * out;
      L[i] = dl * (1 - mix) + yl * mix;
      R[i] = dr * (1 - mix) + yr * mix;
    }
  }
}

export const distortionDef: FxDef = {
  type: 'distortion',
  name: 'Distortion',
  category: 'distortion',
  description: 'Oversampled waveshaper: soft clip, hard clip, tube, wave fold, tape and fuzz. Low drive adds warmth, high drive is a effect.',
  params: DR,
  presets: {
    'Warm saturation': { type: 4, drive: 6, tone: 9000, output: -2 },
    'Tube crunch': { type: 2, drive: 14, bias: 0.4, tone: 6000 },
    'Guitar fuzz': { type: 5, drive: 24, tone: 4500, output: -8 },
    'Bass grit': { type: 0, drive: 12, tone: 3500, mix: 0.5 },
  },
  create: (sr) => new Distortion(sr),
};

// ---------------------------------------------------------------- bitcrusher

const BC: ParamDesc[] = [
  { id: 'bits', name: 'Bits', min: 1, max: 16, def: 8, step: 1 },
  { id: 'rate', name: 'Rate reduction', min: 1, max: 64, def: 4, step: 1 },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 1 },
];

class Bitcrusher extends FxBase {
  private hl = 0;
  private hr = 0;
  private cnt = 0;
  constructor(sr: number) {
    super(sr, BC);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const levels = Math.pow(2, Math.round(this.p.bits) - 1);
    const div = Math.round(this.p.rate);
    const mix = this.p.mix;
    for (let i = s; i < e; i++) {
      if (this.cnt === 0) {
        this.hl = Math.round(L[i] * levels) / levels;
        this.hr = Math.round(R[i] * levels) / levels;
      }
      this.cnt = (this.cnt + 1) % div;
      L[i] = L[i] * (1 - mix) + this.hl * mix;
      R[i] = R[i] * (1 - mix) + this.hr * mix;
    }
  }
}

export const bitcrusherDef: FxDef = {
  type: 'bitcrusher',
  name: 'Bitcrusher',
  category: 'distortion',
  description: 'Bit depth and sample-rate reduction for retro game and lo-fi textures.',
  params: BC,
  create: (sr) => new Bitcrusher(sr),
};
