import { Biquad } from '../dsp/filters.ts';
import { dbToGain } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { FxBase } from './base.ts';
import type { FxDef } from './base.ts';

// ---------------------------------------------------------------- compressor

const CP: ParamDesc[] = [
  { id: 'threshold', name: 'Threshold', min: -60, max: 0, def: -18, unit: 'dB', group: 'Main' },
  { id: 'ratio', name: 'Ratio', min: 1, max: 20, def: 3, group: 'Main' },
  { id: 'attack', name: 'Attack', min: 0.1, max: 200, def: 15, unit: 'ms', log: true, group: 'Main' },
  { id: 'release', name: 'Release', min: 10, max: 2000, def: 140, unit: 'ms', log: true, group: 'Main' },
  { id: 'knee', name: 'Knee', min: 0, max: 24, def: 6, unit: 'dB', group: 'Main' },
  { id: 'makeup', name: 'Makeup', min: -12, max: 24, def: 0, unit: 'dB', group: 'Output' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, def: 1, group: 'Output' },
  { id: 'detect', name: 'Detector', min: 0, max: 1, def: 0, options: ['Peak', 'RMS'], group: 'Sidechain' },
  { id: 'sc_hp', name: 'Sidechain high-pass', min: 20, max: 500, def: 20, unit: 'Hz', log: true, group: 'Sidechain' },
];

class Compressor extends FxBase {
  private env = 0;
  private gr = 0;
  private aC = 0;
  private rC = 0;
  private dC = 0;
  private scL = new Biquad();
  private scR = new Biquad();
  private scA: Float32Array | null = null;
  private scB: Float32Array | null = null;
  private lastGr = 0;
  constructor(sr: number) {
    super(sr, CP);
    this.update();
  }
  protected override update(): void {
    const sr = this.sr;
    this.aC = 1 - Math.exp(-1 / (this.p.attack * 0.001 * sr));
    this.rC = 1 - Math.exp(-1 / (this.p.release * 0.001 * sr));
    this.dC = 1 - Math.exp(-1 / (0.005 * sr));
    this.scL.set('hp', this.p.sc_hp, 0.707, 0, sr);
    this.scR.set('hp', this.p.sc_hp, 0.707, 0, sr);
  }
  override setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    this.scA = L;
    this.scB = R;
  }
  override meter(): number {
    return this.lastGr;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const { threshold, ratio, knee, makeup, mix, detect, sc_hp } = this.p;
    const slope = 1 / ratio - 1;
    const mk = dbToGain(makeup);
    const useSc = this.scA !== null && this.scB !== null;
    const hpOn = sc_hp > 21;
    let gr = this.gr;
    let env = this.env;
    let worst = 0;
    for (let i = s; i < e; i++) {
      let dl = useSc ? this.scA![i] : L[i];
      let dr = useSc ? this.scB![i] : R[i];
      if (hpOn) {
        dl = this.scL.tick(dl);
        dr = this.scR.tick(dr);
      }
      let level: number;
      if (detect >= 1) {
        env += (0.5 * (dl * dl + dr * dr) - env) * this.dC;
        level = Math.sqrt(env);
      } else {
        level = Math.max(Math.abs(dl), Math.abs(dr));
      }
      const inDb = 20 * Math.log10(level + 1e-9);
      const over = inDb - threshold;
      let target: number;
      if (2 * over < -knee) target = 0;
      else if (2 * Math.abs(over) <= knee) {
        const x = over + knee / 2;
        target = (slope * x * x) / (2 * Math.max(knee, 1e-6));
      } else target = slope * over;
      gr += (target - gr) * (target < gr ? this.aC : this.rC);
      if (gr < worst) worst = gr;
      const g = Math.pow(10, gr / 20) * mk;
      L[i] = L[i] * (1 - mix) + L[i] * g * mix;
      R[i] = R[i] * (1 - mix) + R[i] * g * mix;
    }
    this.gr = Math.abs(gr) < 1e-6 ? 0 : gr;
    this.env = env < 1e-20 ? 0 : env;
    this.lastGr = worst;
  }
  override reset(): void {
    this.gr = 0;
    this.env = 0;
    this.scL.reset();
    this.scR.reset();
  }
}

export const compressorDef: FxDef = {
  type: 'compressor',
  name: 'Compressor',
  category: 'dynamics',
  description:
    'Feed-forward compressor with soft knee, peak or RMS detection and a sidechain input. Set `sidechain` to a track id to key it from that track (kick ducking a bass or pad).',
  params: CP,
  presets: {
    'Gentle glue': { threshold: -20, ratio: 2, attack: 30, release: 200, knee: 10, makeup: 1.5 },
    'Drum punch': { threshold: -16, ratio: 4, attack: 25, release: 90, knee: 4, makeup: 3 },
    'Leveler': { threshold: -22, ratio: 3.5, attack: 8, release: 120, knee: 8, makeup: 4 },
    'Sidechain pump': { threshold: -30, ratio: 8, attack: 1, release: 180, knee: 2, makeup: 0 },
    'Parallel crush': { threshold: -35, ratio: 12, attack: 1, release: 80, knee: 0, makeup: 8, mix: 0.35 },
  },
  create: (sr) => new Compressor(sr),
};

// ---------------------------------------------------------------- limiter

const LP: ParamDesc[] = [
  { id: 'ceiling', name: 'Ceiling', min: -12, max: 0, def: -0.3, unit: 'dB' },
  { id: 'gain', name: 'Input gain', min: -12, max: 24, def: 0, unit: 'dB' },
  { id: 'release', name: 'Release', min: 5, max: 1000, def: 80, unit: 'ms', log: true },
];

/**
 * Lookahead brickwall limiter. The audio is delayed by W samples. The gain needed for each sample is
 * min-filtered over the window and averaged over W samples, so the gain is already low when the peak arrives.
 */
class Limiter extends FxBase {
  private W: number;
  private dl: Float32Array;
  private dr: Float32Array;
  private req: Float32Array;
  private envRing: Float32Array;
  private wd = 0;
  private wr = 0;
  private sum: number;
  private env = 1;
  private relC = 0;
  private lastGr = 0;
  constructor(sr: number) {
    super(sr, LP);
    this.W = Math.max(16, Math.round(0.0025 * sr));
    this.dl = new Float32Array(this.W);
    this.dr = new Float32Array(this.W);
    this.req = new Float32Array(this.W + 1).fill(1);
    this.envRing = new Float32Array(this.W).fill(1);
    this.sum = this.W;
    this.update();
  }
  protected override update(): void {
    this.relC = 1 - Math.exp(-1 / (this.p.release * 0.001 * this.sr));
  }
  override meter(): number {
    return this.lastGr;
  }
  override tail(): number {
    return 0.01;
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const ceil = dbToGain(this.p.ceiling);
    const inG = dbToGain(this.p.gain);
    const W = this.W;
    const reqLen = W + 1;
    let worst = 1;
    for (let i = s; i < e; i++) {
      const xl = L[i] * inG;
      const xr = R[i] * inG;
      const peak = Math.max(Math.abs(xl), Math.abs(xr));
      this.req[this.wr] = peak > ceil ? ceil / peak : 1;
      this.wr = (this.wr + 1) % reqLen;
      let m = 1;
      for (let k = 0; k < reqLen; k++) if (this.req[k] < m) m = this.req[k];
      if (m < this.env) this.env = m;
      else this.env += (m - this.env) * this.relC;
      const idx = this.wd;
      this.sum += this.env - this.envRing[idx];
      this.envRing[idx] = this.env;
      const g = this.sum / W;
      let ol = this.dl[idx] * g;
      let or = this.dr[idx] * g;
      this.dl[idx] = xl;
      this.dr[idx] = xr;
      this.wd = (idx + 1) % W;
      if (ol > ceil) ol = ceil;
      else if (ol < -ceil) ol = -ceil;
      if (or > ceil) or = ceil;
      else if (or < -ceil) or = -ceil;
      L[i] = ol;
      R[i] = or;
      if (g < worst) worst = g;
    }
    this.lastGr = 20 * Math.log10(Math.max(worst, 1e-6));
  }
  override reset(): void {
    this.dl.fill(0);
    this.dr.fill(0);
    this.req.fill(1);
    this.envRing.fill(1);
    this.sum = this.W;
    this.env = 1;
  }
}

export const limiterDef: FxDef = {
  type: 'limiter',
  name: 'Limiter',
  category: 'dynamics',
  description: 'Lookahead brickwall limiter. Put it last on the master to hold peaks under the ceiling and raise loudness.',
  params: LP,
  presets: {
    Transparent: { ceiling: -0.5, gain: 0, release: 120 },
    'Loud master': { ceiling: -0.3, gain: 5, release: 60 },
  },
  create: (sr) => new Limiter(sr),
};

// ---------------------------------------------------------------- gate

const GP: ParamDesc[] = [
  { id: 'threshold', name: 'Threshold', min: -80, max: 0, def: -45, unit: 'dB' },
  { id: 'attack', name: 'Attack', min: 0.1, max: 50, def: 1, unit: 'ms', log: true },
  { id: 'hold', name: 'Hold', min: 0, max: 500, def: 40, unit: 'ms' },
  { id: 'release', name: 'Release', min: 5, max: 1500, def: 120, unit: 'ms', log: true },
  { id: 'range', name: 'Range', min: -80, max: 0, def: -60, unit: 'dB' },
];

class Gate extends FxBase {
  private g = 0;
  private holdLeft = 0;
  private open = false;
  constructor(sr: number) {
    super(sr, GP);
  }
  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const thr = dbToGain(this.p.threshold);
    const floor = dbToGain(this.p.range);
    const aC = 1 - Math.exp(-1 / (this.p.attack * 0.001 * this.sr));
    const rC = 1 - Math.exp(-1 / (this.p.release * 0.001 * this.sr));
    const holdS = this.p.hold * 0.001 * this.sr;
    let g = this.g;
    for (let i = s; i < e; i++) {
      const lvl = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (lvl > thr) {
        this.open = true;
        this.holdLeft = holdS;
      } else if (this.holdLeft > 0) this.holdLeft--;
      else this.open = false;
      const target = this.open ? 1 : floor;
      g += (target - g) * (target > g ? aC : rC);
      L[i] *= g;
      R[i] *= g;
    }
    this.g = g;
  }
  override reset(): void {
    this.g = 0;
    this.open = false;
    this.holdLeft = 0;
  }
}

export const gateDef: FxDef = {
  type: 'gate',
  name: 'Gate',
  category: 'dynamics',
  description: 'Noise gate with hold. Closes the signal when it falls below the threshold.',
  params: GP,
  create: (sr) => new Gate(sr),
};
