import { ADSR } from '../dsp/env.ts';
import { Noise, TWO_PI, mtof, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { DelayLine } from '../dsp/delay.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

// Drawbar footages 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'
const HARM = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];

const P: ParamDesc[] = [
  ...HARM.map<ParamDesc>((_, i) => ({
    id: 'd' + (i + 1),
    name: ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"][i],
    min: 0, max: 8, def: [8, 8, 8, 0, 0, 0, 0, 0, 0][i], step: 1, group: 'Drawbars',
  })),
  { id: 'perc', name: 'Percussion', min: 0, max: 2, def: 0, options: ['Off', '2nd harmonic', '3rd harmonic'], group: 'Percussion' },
  { id: 'perc_decay', name: 'Percussion decay', min: 0, max: 1, def: 0, options: ['Fast', 'Slow'], group: 'Percussion' },
  { id: 'click', name: 'Key click', min: 0, max: 1, def: 0.35, group: 'Character' },
  { id: 'drive', name: 'Overdrive', min: 0, max: 1, def: 0.15, group: 'Character' },
  { id: 'leslie', name: 'Leslie', min: 0, max: 2, def: 1, options: ['Off', 'Slow', 'Fast'], group: 'Leslie' },
  { id: 'leslie_depth', name: 'Leslie depth', min: 0, max: 1, def: 0.6, group: 'Leslie' },
];

class OrganVoice extends VoiceBase {
  ph = new Float64Array(10);
  env: ADSR;
  percEnv = 0;
  clickEnv = 0;
  noise: Noise;
  lpClick = 0;
  constructor(sr: number, seed: number) {
    super();
    this.env = new ADSR(sr);
    this.env.setTimes(0.004, 0.1, 1, 0.035);
    this.noise = new Noise(seed);
  }
}

class Organ extends InstrumentBase<OrganVoice> {
  readonly type = 'organ';
  private scratchL = new Float32Array(16384);
  private scratchR = new Float32Array(16384);
  private dlL: DelayLine;
  private dlR: DelayLine;
  private lesPh = 0;
  private lesRate = 0.8;
  private gains = new Float64Array(9);
  constructor(sr: number, seed: number) {
    super(sr, P);
    this.addVoices(20, () => new OrganVoice(sr, seed + 13));
    this.dlL = new DelayLine(Math.ceil(0.01 * sr));
    this.dlR = new DelayLine(Math.ceil(0.01 * sr));
    this.updateGains();
  }
  private updateGains(): void {
    for (let i = 0; i < 9; i++) {
      const d = this.p['d' + (i + 1)];
      this.gains[i] = d > 0 ? Math.pow(10, ((d - 8) * 3) / 20) : 0;
    }
  }
  protected override onParam(id: string): void {
    if (id[0] === 'd' && id.length === 2) this.updateGains();
  }
  protected startVoice(v: OrganVoice, pitch: number, vel: number): void {
    v.ph.fill(0);
    v.env.reset();
    v.env.gateOn();
    v.percEnv = this.p.perc > 0.5 ? 1 : 0;
    v.clickEnv = this.p.click;
    v.lpClick = 0;
  }
  protected releaseVoice(v: OrganVoice): void {
    v.env.gateOff();
  }
  protected renderVoice(v: OrganVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const f0 = mtof(v.pitch) * Math.pow(2, this.bend * 2 / 12);
    const sr = this.sr;
    const p = this.p;
    const gains = this.gains;
    const percHarm = p.perc >= 1.5 ? 3 : 2;
    const percCoef = Math.exp(-1 / (sr * (p.perc_decay >= 1 ? 0.5 : 0.16)));
    const vol = this.volume * this.expression * 0.22;
    let acc = 0;
    for (let i = s; i < e; i++) {
      let sum = 0;
      for (let h = 0; h < 9; h++) {
        const g = gains[h];
        if (g === 0) continue;
        const fh = f0 * HARM[h];
        if (fh > sr * 0.45) continue;
        v.ph[h] += fh / sr;
        if (v.ph[h] >= 1) v.ph[h] -= 1;
        sum += Math.sin(TWO_PI * v.ph[h]) * g;
      }
      if (v.percEnv > 0.001) {
        const fh = f0 * percHarm;
        if (fh < sr * 0.45) {
          v.ph[9] += fh / sr;
          if (v.ph[9] >= 1) v.ph[9] -= 1;
          sum += Math.sin(TWO_PI * v.ph[9]) * v.percEnv * 0.9;
        }
        v.percEnv *= percCoef;
      }
      if (v.clickEnv > 0.002) {
        v.lpClick += 0.35 * (v.noise.white() - v.lpClick);
        sum += v.lpClick * v.clickEnv * 0.7;
        v.clickEnv *= 0.992;
      }
      const y = sum * v.env.tick() * vol;
      acc += y * y;
      L[i] += y;
      R[i] += y;
    }
    v.age += e - s;
    if (v.env.idle) v.active = false;
    void acc;
  }
  override process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const sl = this.scratchL;
    const sr_ = this.scratchR;
    sl.fill(0, s, e);
    sr_.fill(0, s, e);
    for (const v of this.voices) if (v.active) this.renderVoice(v, sl, sr_, s, e);
    const drive = this.p.drive;
    const mode = Math.round(this.p.leslie);
    const target = mode === 2 ? 6.6 : mode === 1 ? 0.75 : 0;
    const depth = this.p.leslie_depth;
    const g = 1 + drive * 10;
    for (let i = s; i < e; i++) {
      let x = sl[i];
      if (drive > 0.01) x = fastTanh(x * g) / Math.sqrt(g);
      if (mode === 0) {
        L[i] += x;
        R[i] += x;
        continue;
      }
      // the rotor speeds up and slows down gradually, like the real cabinet
      this.lesRate += (target - this.lesRate) * 0.00004;
      this.lesPh += (TWO_PI * this.lesRate) / this.sr;
      if (this.lesPh > TWO_PI) this.lesPh -= TWO_PI;
      this.dlL.write(x);
      this.dlR.write(x);
      const modL = Math.sin(this.lesPh);
      const modR = Math.sin(this.lesPh + Math.PI * 0.5);
      const base = 0.003 * this.sr;
      const wob = 0.0007 * this.sr * depth;
      const yl = this.dlL.readCubic(base + wob * modL) * (1 - 0.3 * depth * (0.5 + 0.5 * modL));
      const yr = this.dlR.readCubic(base + wob * modR) * (1 - 0.3 * depth * (0.5 + 0.5 * modR));
      L[i] += yl;
      R[i] += yr;
    }
  }
}

export const organDef: InstDef = {
  type: 'organ',
  name: 'Tonewheel organ',
  category: 'keys',
  description: 'Drawbar organ with percussion, key click, overdrive and a rotary speaker that ramps between slow and fast.',
  range: [36, 96],
  polyphony: 'poly',
  params: P,
  presets: {
    'Jazz 888000000': {},
    'Rock 888800000': { d4: 8, drive: 0.4, leslie: 'Fast' },
    'Gospel full': { d1: 8, d2: 8, d3: 8, d4: 8, d5: 6, d6: 8, d7: 4, d8: 5, d9: 6, leslie: 'Slow', drive: 0.25 },
    'Mellow 008000000': { d1: 0, d2: 0, d3: 8, d4: 3, perc: 'Off', drive: 0, leslie: 'Slow' },
    'Percussive 888000000+3rd': { perc: '3rd harmonic', perc_decay: 'Fast', d4: 3 },
  },
  create: (sr, seed) => new Organ(sr, seed),
};
