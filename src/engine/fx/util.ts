import { Biquad } from '../dsp/filters.ts';
import { dbToGain, panGains } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

const GP: ParamDesc[] = [
  { id: 'gain', name: 'Gain', min: -36, max: 24, def: 0, unit: 'dB' },
  { id: 'pan', name: 'Pan', min: -1, max: 1, def: 0 },
  { id: 'invert', name: 'Phase invert', min: 0, max: 1, def: 0, options: ['Off', 'On'] },
  { id: 'mono', name: 'Mono', min: 0, max: 1, def: 0, options: ['Off', 'On'] },
];

class Utility extends FxBase {
  private g = 1;
  constructor(sr: number) {
    super(sr, GP);
    this.g = dbToGain(this.p.gain);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const target = dbToGain(this.p.gain) * (this.p.invert >= 1 ? -1 : 1);
    const [pl, pr] = panGains(this.p.pan);
    const centre = Math.SQRT1_2;
    const step = (target - this.g) / Math.max(1, e - s);
    let g = this.g;
    for (let i = s; i < e; i++) {
      g += step;
      let l = L[i];
      let r = R[i];
      if (this.p.mono >= 1) l = r = 0.5 * (l + r);
      L[i] = l * g * (pl / centre);
      R[i] = r * g * (pr / centre);
    }
    this.g = target;
  }
}

export const utilityDef: FxDef = {
  type: 'utility',
  name: 'Utility',
  category: 'utility',
  description: 'Gain, pan, polarity and mono switch.',
  params: GP,
  create: (sr) => new Utility(sr),
};

const WP: ParamDesc[] = [
  { id: 'width', name: 'Width', min: 0, max: 2, def: 1.2, group: 'Stereo' },
  { id: 'mono_below', name: 'Mono below', min: 20, max: 400, def: 120, unit: 'Hz', log: true, group: 'Stereo' },
  { id: 'haas', name: 'Haas delay', min: 0, max: 25, def: 0, unit: 'ms', group: 'Stereo' },
];

class Widener extends FxBase {
  private lpS = new Biquad();
  private buf = new Float32Array(2048);
  private w = 0;
  constructor(sr: number) {
    super(sr, WP);
    this.update();
  }
  protected override update(): void {
    this.lpS.set('lp', this.p.mono_below, 0.707, 0, this.sr);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const width = this.p.width;
    const haas = Math.round((this.p.haas * this.sr) / 1000);
    for (let i = s; i < e; i++) {
      const m = 0.5 * (L[i] + R[i]);
      let sd = 0.5 * (L[i] - R[i]);
      const low = this.lpS.tick(sd);
      sd = (sd - low) * width; // side below the crossover is folded to mono
      let l = m + sd;
      let r = m - sd;
      if (haas > 0) {
        this.buf[this.w] = r;
        r = this.buf[(this.w - haas + 2048) & 2047];
        this.w = (this.w + 1) & 2047;
      }
      L[i] = l;
      R[i] = r;
    }
  }
}

export const widenerDef: FxDef = {
  type: 'widener',
  name: 'Stereo widener',
  category: 'utility',
  description: 'Mid/side width control. Everything below the crossover stays mono so the low end remains solid.',
  params: WP,
  create: (sr) => new Widener(sr),
};
