import { Biquad } from '../dsp/filters.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

const P: ParamDesc[] = [
  { id: 'hp', name: 'Low cut', min: 20, max: 1000, def: 20, unit: 'Hz', log: true, group: 'Cuts' },
  { id: 'hp_slope', name: 'Low cut slope', min: 0, max: 1, def: 0, options: ['12 dB', '24 dB'], group: 'Cuts' },
  { id: 'ls_f', name: 'Low shelf freq', min: 30, max: 500, def: 120, unit: 'Hz', log: true, group: 'Low' },
  { id: 'ls_g', name: 'Low shelf gain', min: -18, max: 18, def: 0, unit: 'dB', group: 'Low' },
  { id: 'b1_f', name: 'Band 1 freq', min: 40, max: 2000, def: 300, unit: 'Hz', log: true, group: 'Band 1' },
  { id: 'b1_g', name: 'Band 1 gain', min: -18, max: 18, def: 0, unit: 'dB', group: 'Band 1' },
  { id: 'b1_q', name: 'Band 1 Q', min: 0.2, max: 10, def: 1, group: 'Band 1' },
  { id: 'b2_f', name: 'Band 2 freq', min: 200, max: 8000, def: 1200, unit: 'Hz', log: true, group: 'Band 2' },
  { id: 'b2_g', name: 'Band 2 gain', min: -18, max: 18, def: 0, unit: 'dB', group: 'Band 2' },
  { id: 'b2_q', name: 'Band 2 Q', min: 0.2, max: 10, def: 1, group: 'Band 2' },
  { id: 'b3_f', name: 'Band 3 freq', min: 1000, max: 16000, def: 4000, unit: 'Hz', log: true, group: 'Band 3' },
  { id: 'b3_g', name: 'Band 3 gain', min: -18, max: 18, def: 0, unit: 'dB', group: 'Band 3' },
  { id: 'b3_q', name: 'Band 3 Q', min: 0.2, max: 10, def: 1, group: 'Band 3' },
  { id: 'hs_f', name: 'High shelf freq', min: 2000, max: 16000, def: 8000, unit: 'Hz', log: true, group: 'High' },
  { id: 'hs_g', name: 'High shelf gain', min: -18, max: 18, def: 0, unit: 'dB', group: 'High' },
  { id: 'lp', name: 'High cut', min: 2000, max: 20000, def: 20000, unit: 'Hz', log: true, group: 'Cuts' },
  { id: 'lp_slope', name: 'High cut slope', min: 0, max: 1, def: 0, options: ['12 dB', '24 dB'], group: 'Cuts' },
];

type Stage = { l: Biquad; r: Biquad; on: boolean };

class ParametricEQ extends FxBase {
  private hp: Stage[] = [];
  private lpf: Stage[] = [];
  private ls: Stage;
  private b1: Stage;
  private b2: Stage;
  private b3: Stage;
  private hs: Stage;
  constructor(sr: number) {
    super(sr, P);
    const mk = (): Stage => ({ l: new Biquad(), r: new Biquad(), on: false });
    this.hp = [mk(), mk()];
    this.lpf = [mk(), mk()];
    this.ls = mk();
    this.b1 = mk();
    this.b2 = mk();
    this.b3 = mk();
    this.hs = mk();
    this.update();
  }
  protected override update(): void {
    const sr = this.sr;
    const p = this.p;
    const set = (s: Stage, type: 'hp' | 'lp' | 'peak' | 'lowshelf' | 'highshelf', f: number, q: number, g: number, on: boolean) => {
      s.on = on;
      if (!on) return;
      s.l.set(type, f, q, g, sr);
      s.r.set(type, f, q, g, sr);
    };
    const q24 = 0.7071;
    set(this.hp[0], 'hp', p.hp, q24, 0, p.hp > 21);
    set(this.hp[1], 'hp', p.hp, q24, 0, p.hp > 21 && p.hp_slope >= 1);
    set(this.lpf[0], 'lp', p.lp, q24, 0, p.lp < 19900);
    set(this.lpf[1], 'lp', p.lp, q24, 0, p.lp < 19900 && p.lp_slope >= 1);
    set(this.ls, 'lowshelf', p.ls_f, 0.707, p.ls_g, Math.abs(p.ls_g) > 0.05);
    set(this.b1, 'peak', p.b1_f, p.b1_q, p.b1_g, Math.abs(p.b1_g) > 0.05);
    set(this.b2, 'peak', p.b2_f, p.b2_q, p.b2_g, Math.abs(p.b2_g) > 0.05);
    set(this.b3, 'peak', p.b3_f, p.b3_q, p.b3_g, Math.abs(p.b3_g) > 0.05);
    set(this.hs, 'highshelf', p.hs_f, 0.707, p.hs_g, Math.abs(p.hs_g) > 0.05);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const stages = [this.hp[0], this.hp[1], this.ls, this.b1, this.b2, this.b3, this.hs, this.lpf[0], this.lpf[1]];
    for (const st of stages) {
      if (!st.on) continue;
      st.l.run(L, s, e);
      st.r.run(R, s, e);
    }
  }
  /** Combined magnitude response in dB, for drawing the curve. */
  responseDb(f: number): number {
    let m = 1;
    for (const st of [this.hp[0], this.hp[1], this.ls, this.b1, this.b2, this.b3, this.hs, this.lpf[0], this.lpf[1]]) {
      if (st.on) m *= st.l.magnitudeAt(f, this.sr);
    }
    return 20 * Math.log10(Math.max(m, 1e-9));
  }
  override reset(): void {
    for (const st of [...this.hp, ...this.lpf, this.ls, this.b1, this.b2, this.b3, this.hs]) {
      st.l.reset();
      st.r.reset();
    }
  }
}

export const eqDef: FxDef = {
  type: 'eq',
  name: 'Parametric EQ',
  category: 'eq',
  description: 'Low/high cut, low and high shelves and three peaking bands. Use it to carve space for each instrument.',
  params: P,
  presets: {
    'Clean-up (cut mud)': { hp: 40, b1_f: 280, b1_g: -3, b1_q: 1.2 },
    'Vocal-like presence': { hp: 90, b2_f: 3000, b2_g: 2.5, b2_q: 0.9, hs_g: 2, hs_f: 10000 },
    'Warm & dark': { hs_g: -4, hs_f: 6000, ls_g: 2, ls_f: 150 },
    'Telephone': { hp: 500, lp: 3400, b2_f: 1500, b2_g: 4, b2_q: 0.7 },
    'Air': { hs_g: 3.5, hs_f: 11000 },
  },
  create: (sr) => new ParametricEQ(sr),
};

export { ParametricEQ };
