import { Biquad } from '../dsp/filters.ts';
import { Allpass } from '../dsp/delay.ts';
import { TWO_PI, flush } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

const P: ParamDesc[] = [
  { id: 'size', name: 'Size', min: 0.3, max: 2.5, def: 1, group: 'Room' },
  { id: 'decay', name: 'Decay (RT60)', min: 0.1, max: 20, def: 2.2, unit: 's', log: true, group: 'Room' },
  { id: 'predelay', name: 'Pre-delay', min: 0, max: 250, def: 15, unit: 'ms', group: 'Room' },
  { id: 'damp', name: 'High damping', min: 0, max: 1, def: 0.5, group: 'Tone' },
  { id: 'diffusion', name: 'Diffusion', min: 0, max: 1, def: 0.7, group: 'Room' },
  { id: 'early', name: 'Early reflections', min: 0, max: 1, def: 0.5, group: 'Room' },
  { id: 'lowcut', name: 'Low cut', min: 20, max: 1000, def: 120, unit: 'Hz', log: true, group: 'Tone' },
  { id: 'highcut', name: 'High cut', min: 1000, max: 20000, def: 9000, unit: 'Hz', log: true, group: 'Tone' },
  { id: 'width', name: 'Width', min: 0, max: 1, def: 1, group: 'Output' },
  { id: 'mod', name: 'Modulation', min: 0, max: 1, def: 0.3, group: 'Room' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 0.25, group: 'Output' },
];

const N = 8;
const BASE_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 61.7, 67.9, 77.3];
const SIGN_L = [1, -1, 1, 1, -1, 1, -1, -1];
const SIGN_R = [1, 1, -1, 1, 1, -1, -1, 1];
const IN_SIGN = [1, -1, 1, -1, -1, 1, -1, 1];
// Early reflection taps (ms, gain, side) approximating a mid-sized room
const ER_TAPS: [number, number, number][] = [
  [4.1, 0.9, -1], [7.3, 0.8, 1], [11.9, 0.7, -1], [15.4, 0.62, 1], [19.7, 0.55, -1], [24.2, 0.5, 1],
  [29.8, 0.42, -1], [35.5, 0.36, 1], [41.3, 0.3, -1], [48.1, 0.25, 1],
];

/** 8-line feedback delay network with Hadamard mixing, input diffusion and early reflections. */
class Reverb extends FxBase {
  private lines: Float32Array[] = [];
  private wp: number[] = new Array(N).fill(0);
  private lens: number[] = new Array(N).fill(0);
  private fb: number[] = new Array(N).fill(0);
  private lp: number[] = new Array(N).fill(0);
  private lfo: number[] = [];
  private lfoInc: number[] = [];
  private pre: Float32Array;
  private pw = 0;
  private apL: Allpass[] = [];
  private y = new Float64Array(N);
  private hpL = new Biquad();
  private hpR = new Biquad();
  private lpL = new Biquad();
  private lpR = new Biquad();
  private dampA = 1;
  private maxLen: number;
  constructor(sr: number) {
    super(sr, P);
    this.maxLen = Math.ceil((BASE_MS[N - 1] * 2.5 * sr) / 1000) + 64;
    for (let i = 0; i < N; i++) {
      this.lines.push(new Float32Array(this.maxLen));
      this.lfo.push((i / N) * TWO_PI);
      this.lfoInc.push((TWO_PI * (0.17 + i * 0.043)) / sr);
    }
    this.pre = new Float32Array(Math.ceil(0.3 * sr));
    const apLens = [142, 107, 379, 277];
    for (const l of apLens) this.apL.push(new Allpass(Math.round((l * sr) / 44100), 0.6));
    this.update();
  }
  protected override update(): void {
    const sr = this.sr;
    const p = this.p;
    for (let i = 0; i < N; i++) {
      this.lens[i] = (BASE_MS[i] * p.size * sr) / 1000;
      this.fb[i] = Math.pow(10, (-3 * (this.lens[i] / sr)) / Math.max(0.05, p.decay));
    }
    this.dampA = 1 - p.damp * 0.88;
    this.hpL.set('hp', p.lowcut, 0.707, 0, sr);
    this.hpR.set('hp', p.lowcut, 0.707, 0, sr);
    this.lpL.set('lp', p.highcut, 0.707, 0, sr);
    this.lpR.set('lp', p.highcut, 0.707, 0, sr);
  }
  override tail(): number {
    return this.p.decay * 1.05 + this.p.predelay / 1000;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const p = this.p;
    const sr = this.sr;
    const mix = p.mix;
    const preLen = this.pre.length;
    const preD = Math.min(preLen - 2, Math.round((p.predelay * sr) / 1000));
    const modDepth = p.mod * 5;
    const diff = 0.25 + p.diffusion * 0.5;
    const erGain = p.early * 0.55;
    const width = p.width;
    const y = this.y;
    const maxLen = this.maxLen;
    const a = this.dampA;
    const erTapSamples = ER_TAPS.map((t) => Math.round((t[0] * p.size * sr) / 1000));
    for (let i = s; i < e; i++) {
      const dryL = L[i];
      const dryR = R[i];
      const inM = 0.5 * (dryL + dryR);
      this.pre[this.pw] = inM;
      const x = this.pre[(this.pw - preD + preLen) % preLen];
      // early reflections, taken from the pre-delay line
      let erL = 0;
      let erR = 0;
      if (erGain > 0.001) {
        for (let k = 0; k < ER_TAPS.length; k++) {
          const d = erTapSamples[k] + preD;
          const v = this.pre[(this.pw - d + preLen * 2) % preLen] * ER_TAPS[k][1];
          if (ER_TAPS[k][2] > 0) { erR += v; erL += v * 0.35; } else { erL += v; erR += v * 0.35; }
        }
      }
      this.pw = (this.pw + 1) % preLen;
      // diffusion
      let d = x;
      for (let k = 0; k < this.apL.length; k++) d = this.apL[k].tick(d);
      d *= 1 + diff * 0.2;
      // read FDN lines
      let outL = 0;
      let outR = 0;
      for (let k = 0; k < N; k++) {
        this.lfo[k] += this.lfoInc[k];
        if (this.lfo[k] > TWO_PI) this.lfo[k] -= TWO_PI;
        const delay = this.lens[k] + Math.sin(this.lfo[k]) * modDepth;
        const rp = this.wp[k] - delay;
        let ip = Math.floor(rp);
        const fr = rp - ip;
        ip = ((ip % maxLen) + maxLen) % maxLen;
        const ln = this.lines[k];
        const v0 = ln[ip];
        const v1 = ln[(ip + 1) % maxLen];
        let v = v0 + (v1 - v0) * fr;
        this.lp[k] += a * (v - this.lp[k]);
        v = flush(this.lp[k]) * this.fb[k];
        y[k] = v;
        outL += v * SIGN_L[k];
        outR += v * SIGN_R[k];
      }
      // Hadamard mix (orthonormal)
      for (let h = 1; h < N; h <<= 1) {
        for (let j = 0; j < N; j += h << 1) {
          for (let m = j; m < j + h; m++) {
            const u = y[m];
            const w = y[m + h];
            y[m] = u + w;
            y[m + h] = u - w;
          }
        }
      }
      const norm = 0.35355339;
      for (let k = 0; k < N; k++) {
        const ln = this.lines[k];
        ln[this.wp[k]] = flush(y[k] * norm + d * IN_SIGN[k] * 0.35);
        this.wp[k] = (this.wp[k] + 1) % maxLen;
      }
      let wl = outL * 0.35 + erL * erGain;
      let wr = outR * 0.35 + erR * erGain;
      // width
      const m = 0.5 * (wl + wr);
      const sd = 0.5 * (wl - wr) * width;
      wl = m + sd;
      wr = m - sd;
      wl = this.lpL.tick(this.hpL.tick(wl));
      wr = this.lpR.tick(this.hpR.tick(wr));
      L[i] = dryL * (1 - mix * 0.5) + wl * mix * 1.6;
      R[i] = dryR * (1 - mix * 0.5) + wr * mix * 1.6;
    }
  }
  override reset(): void {
    for (const l of this.lines) l.fill(0);
    this.pre.fill(0);
    this.lp.fill(0);
    for (const a of this.apL) a.clear();
    this.hpL.reset(); this.hpR.reset(); this.lpL.reset(); this.lpR.reset();
  }
}

export const reverbDef: FxDef = {
  type: 'reverb',
  name: 'Reverb',
  category: 'space',
  description: 'Algorithmic reverb (feedback delay network with early reflections). Use the presets for rooms, halls and plates.',
  params: P,
  presets: {
    'Small room': { size: 0.55, decay: 0.7, predelay: 4, damp: 0.6, early: 0.7, mix: 0.18, lowcut: 150, highcut: 8000 },
    'Studio room': { size: 0.8, decay: 1.1, predelay: 8, damp: 0.55, early: 0.6, mix: 0.2, lowcut: 130, highcut: 9000 },
    'Chamber': { size: 1.0, decay: 1.6, predelay: 12, damp: 0.5, early: 0.5, mix: 0.22, lowcut: 120, highcut: 9500 },
    'Concert hall': { size: 1.6, decay: 2.6, predelay: 24, damp: 0.45, early: 0.4, mix: 0.25, lowcut: 110, highcut: 10000 },
    'Cathedral': { size: 2.3, decay: 6.5, predelay: 38, damp: 0.55, early: 0.25, mix: 0.3, lowcut: 140, highcut: 7500 },
    'Plate': { size: 0.9, decay: 1.9, predelay: 2, damp: 0.3, early: 0.1, diffusion: 1, mix: 0.25, lowcut: 180, highcut: 12000, mod: 0.5 },
    'Dark ambient wash': { size: 2.0, decay: 9, predelay: 30, damp: 0.8, early: 0.1, mix: 0.4, lowcut: 200, highcut: 5000, mod: 0.6 },
  },
  create: (sr) => new Reverb(sr),
};
