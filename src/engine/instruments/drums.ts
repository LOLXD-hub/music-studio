import { SVF } from '../dsp/filters.ts';
import { Noise, Rng, TWO_PI, clamp, fastTanh, panGains } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

/** A single synthesized drum strike. The same classes render the drum kit and the sound-effects library. */
export abstract class Hit {
  kind = '';
  active = true;
  t = 0;
  gL = 1;
  gR = 1;
  gain = 1;
  group = 0;
  protected sr: number;
  private fade = 1;
  private fadeCoef = 1;
  private choking = false;
  constructor(sr: number) {
    this.sr = sr;
  }
  abstract next(): number;
  choke(): void {
    this.choking = true;
    this.fadeCoef = Math.exp(-6.9 / (0.006 * this.sr));
  }
  render(L: Float32Array, R: Float32Array, s: number, e: number): void {
    for (let i = s; i < e; i++) {
      if (!this.active) return;
      let x = this.next() * this.gain;
      if (this.choking) {
        this.fade *= this.fadeCoef;
        x *= this.fade;
        if (this.fade < 0.001) this.active = false;
      }
      L[i] += x * this.gL;
      R[i] += x * this.gR;
      this.t++;
    }
  }
}

const decayCoef = (sec: number, sr: number): number => Math.exp(-6.9078 / (Math.max(0.001, sec) * sr));

// ------------------------------------------------------------------ pitched / membrane

export interface ToneSpec {
  f0: number;
  f1: number;
  pd: number;
  T: number;
  drive?: number;
  click?: number;
  clickHz?: number;
  lp?: number;
  square?: boolean;
  partials?: [number, number, number][];
  noiseAtk?: number;
  noiseHz?: number;
  noiseT?: number;
}

export class ToneHit extends Hit {
  private phase = 0;
  private pe = 1;
  private pCoef: number;
  private env = 1;
  private coef: number;
  private drive: number;
  private clickEnv = 0;
  private clickLp = 0;
  private clickCoef = 0;
  private lpState = 0;
  private lpC: number;
  private ph: Float64Array;
  private pEnv: Float64Array;
  private pCo: Float64Array;
  private noise: Noise;
  private nEnv = 0;
  private nCoef = 0;
  private nBp: SVF | null = null;
  private spec: ToneSpec;
  constructor(sr: number, spec: ToneSpec, noiseSeed: number) {
    super(sr);
    this.spec = spec;
    this.noise = new Noise(noiseSeed);
    this.pCoef = decayCoef(Math.max(0.002, spec.pd), sr);
    this.coef = decayCoef(spec.T, sr);
    this.drive = spec.drive ?? 1;
    this.clickEnv = spec.click ?? 0;
    this.clickCoef = decayCoef(0.004, sr);
    this.lpC = 1 - Math.exp((-TWO_PI * (spec.lp ?? 12000)) / sr);
    const parts = spec.partials ?? [];
    this.ph = new Float64Array(parts.length);
    this.pEnv = new Float64Array(parts.length).fill(1);
    this.pCo = new Float64Array(parts.length);
    parts.forEach((p, i) => (this.pCo[i] = decayCoef(spec.T * p[2], sr)));
    if (spec.noiseAtk) {
      this.nEnv = spec.noiseAtk;
      this.nCoef = decayCoef(spec.noiseT ?? 0.03, sr);
      this.nBp = new SVF(sr);
      this.nBp.set(spec.noiseHz ?? 2000, 0.8);
    }
  }
  next(): number {
    const sp = this.spec;
    const f = sp.f1 + (sp.f0 - sp.f1) * this.pe;
    this.pe *= this.pCoef;
    this.phase += (TWO_PI * f) / this.sr;
    if (this.phase > TWO_PI) this.phase -= TWO_PI;
    let b = Math.sin(this.phase);
    if (sp.square) b = fastTanh(b * 6);
    const parts = sp.partials;
    if (parts) {
      for (let i = 0; i < parts.length; i++) {
        this.ph[i] += (TWO_PI * f * parts[i][0]) / this.sr;
        if (this.ph[i] > TWO_PI) this.ph[i] -= TWO_PI;
        b += Math.sin(this.ph[i]) * parts[i][1] * this.pEnv[i];
        this.pEnv[i] *= this.pCo[i];
      }
    }
    if (this.drive > 1) b = fastTanh(b * this.drive) / fastTanh(this.drive * 0.8);
    let out = b * this.env;
    this.env *= this.coef;
    if (this.clickEnv > 0.001) {
      const n = this.noise.white();
      this.clickLp += 0.6 * (n - this.clickLp);
      out += (n - this.clickLp) * this.clickEnv * 0.6;
      this.clickEnv *= this.clickCoef;
    }
    if (this.nBp && this.nEnv > 0.001) {
      this.nBp.tick(this.noise.white());
      out += this.nBp.bp * this.nEnv;
      this.nEnv *= this.nCoef;
    }
    this.lpState += this.lpC * (out - this.lpState);
    if (this.env < 1e-4 && this.nEnv < 1e-3) this.active = false;
    return this.lpState;
  }
}

// ------------------------------------------------------------------ snare

export interface SnareSpec {
  f: number;
  toneLvl: number;
  toneT: number;
  noiseLvl: number;
  noiseHz: number;
  noiseQ: number;
  noiseT: number;
  snap: number;
  rim?: number;
  sizzle?: number;
}

export class SnareHit extends Hit {
  private p1 = 0;
  private p2 = 0;
  private pe = 1;
  private pCoef: number;
  private tEnv = 1;
  private tCoef: number;
  private nEnv = 1;
  private nCoef: number;
  private nBp: SVF;
  private hp: SVF;
  private noise: Noise;
  private snapEnv: number;
  private snapCoef: number;
  private rimEnv: number;
  private rimPh = 0;
  private spec: SnareSpec;
  constructor(sr: number, spec: SnareSpec, seed: number) {
    super(sr);
    this.spec = spec;
    this.noise = new Noise(seed);
    this.pCoef = decayCoef(0.03, sr);
    this.tCoef = decayCoef(spec.toneT, sr);
    this.nCoef = decayCoef(spec.noiseT, sr);
    this.nBp = new SVF(sr);
    this.nBp.set(spec.noiseHz, spec.noiseQ);
    this.hp = new SVF(sr);
    this.hp.set(6500, 0.7);
    this.snapEnv = spec.snap;
    this.snapCoef = decayCoef(0.006, sr);
    this.rimEnv = spec.rim ?? 0;
  }
  next(): number {
    const s = this.spec;
    const f = s.f * (1 + 0.07 * this.pe);
    this.pe *= this.pCoef;
    this.p1 += (TWO_PI * f) / this.sr;
    this.p2 += (TWO_PI * f * 1.63) / this.sr;
    if (this.p1 > TWO_PI) this.p1 -= TWO_PI;
    if (this.p2 > TWO_PI) this.p2 -= TWO_PI;
    const tone = (Math.sin(this.p1) + Math.sin(this.p2) * 0.45) * this.tEnv * s.toneLvl;
    this.tEnv *= this.tCoef;
    const n = this.noise.white();
    this.nBp.tick(n);
    this.hp.tick(n);
    const wires = (this.nBp.bp * 1.4 + this.hp.hp * (s.sizzle ?? 0.25)) * this.nEnv * s.noiseLvl;
    this.nEnv *= this.nCoef;
    let snap = 0;
    if (this.snapEnv > 0.001) {
      snap = n * this.snapEnv * 0.5;
      this.snapEnv *= this.snapCoef;
    }
    let rim = 0;
    if (this.rimEnv > 0.001) {
      this.rimPh += (TWO_PI * 410) / this.sr;
      rim = Math.sin(this.rimPh) * this.rimEnv;
      this.rimEnv *= decayCoef(0.05, this.sr);
    }
    if (this.nEnv < 1e-4 && this.tEnv < 1e-4) this.active = false;
    return tone + wires + snap + rim;
  }
}

// ------------------------------------------------------------------ hi-hat

const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

export interface HatSpec {
  T: number;
  metal: number;
  noise: number;
  hz: number;
  scale: number;
}

export class HatHit extends Hit {
  private ph = new Float64Array(6);
  private env = 1;
  private coef: number;
  private bp: SVF;
  private hp: SVF;
  private noise: Noise;
  private tick = 0.5;
  private spec: HatSpec;
  constructor(sr: number, spec: HatSpec, seed: number) {
    super(sr);
    this.spec = spec;
    this.noise = new Noise(seed);
    this.coef = decayCoef(spec.T, sr);
    this.bp = new SVF(sr);
    this.bp.set(spec.hz, 1.1);
    this.hp = new SVF(sr);
    this.hp.set(Math.min(spec.hz * 0.75, 9000), 0.7);
    for (let i = 0; i < 6; i++) this.ph[i] = (seed * (i + 3) * 0.137) % 1;
  }
  next(): number {
    const sp = this.spec;
    let m = 0;
    for (let i = 0; i < 6; i++) {
      this.ph[i] += (METAL[i] * sp.scale) / this.sr;
      if (this.ph[i] >= 1) this.ph[i] -= 1;
      m += this.ph[i] < 0.5 ? 1 : -1;
    }
    const n = this.noise.white();
    const x = m * 0.16 * sp.metal + n * sp.noise;
    this.bp.tick(x);
    this.hp.tick(this.bp.bp * 1.5 + x * 0.3);
    let out = this.hp.hp * this.env;
    this.env *= this.coef;
    if (this.tick > 0.001) {
      out += n * this.tick * 0.35;
      this.tick *= 0.985;
    }
    if (this.env < 5e-4) this.active = false;
    return out * 0.7;
  }
}

// ------------------------------------------------------------------ cymbal

export interface CymbalSpec {
  T: number;
  lo: number;
  hi: number;
  partials: number;
  noise: number;
  ping?: number;
}

export class CymbalHit extends Hit {
  private n = 0;
  private y1: Float64Array;
  private y2: Float64Array;
  private c1: Float64Array;
  private c2: Float64Array;
  private noise: Noise;
  private nEnv: number;
  private nCoef: number;
  private hp: SVF;
  private mod = 0;
  private modRate: number;
  constructor(sr: number, spec: CymbalSpec, seed: number) {
    super(sr);
    const rng = new Rng(seed);
    this.noise = new Noise(seed + 1);
    const N = spec.partials;
    this.y1 = new Float64Array(N);
    this.y2 = new Float64Array(N);
    this.c1 = new Float64Array(N);
    this.c2 = new Float64Array(N);
    this.n = N;
    for (let i = 0; i < N; i++) {
      const f = spec.lo * Math.pow(spec.hi / spec.lo, rng.next());
      const w = (TWO_PI * f) / sr;
      const t = spec.T * (0.25 + 0.9 * rng.next()) * (1 - 0.5 * (f / spec.hi));
      const r = decayCoef(t, sr);
      this.c1[i] = 2 * r * Math.cos(w);
      this.c2[i] = r * r;
      const a = (0.25 + 0.75 * rng.next()) / Math.sqrt(N) * (spec.ping && f < spec.lo * 3 ? 1 + spec.ping : 1);
      this.y1[i] = a * r * Math.sin(w);
    }
    this.nEnv = spec.noise;
    this.nCoef = decayCoef(spec.T * 0.7, sr);
    this.hp = new SVF(sr);
    this.hp.set(Math.max(3500, spec.lo * 2), 0.7);
    this.modRate = 6 + rng.next() * 5;
  }
  next(): number {
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      const y = this.c1[i] * this.y1[i] - this.c2[i] * this.y2[i];
      this.y2[i] = this.y1[i];
      this.y1[i] = y;
      sum += y;
    }
    this.mod += (TWO_PI * this.modRate) / this.sr;
    const shimmer = 1 + 0.12 * Math.sin(this.mod);
    this.hp.tick(this.noise.white());
    const wash = this.hp.hp * this.nEnv * shimmer;
    this.nEnv *= this.nCoef;
    if (this.t > 20 && this.nEnv < 3e-4 && Math.abs(sum) < 2e-4) this.active = false;
    return (sum * 2.6 + wash * 0.5) * 0.6;
  }
}

// ------------------------------------------------------------------ clap, shaker

export class ClapHit extends Hit {
  private noise: Noise;
  private bp: SVF;
  private hp: SVF;
  private times: number[];
  private tailEnv = 0;
  private tailCoef: number;
  private burstEnv = 0;
  private burstCoef: number;
  private nextBurst = 0;
  private level: number;
  constructor(sr: number, seed: number, hz: number, tail: number, spread: number) {
    super(sr);
    const rng = new Rng(seed);
    this.noise = new Noise(seed + 5);
    this.bp = new SVF(sr);
    this.bp.set(hz, 1.2);
    this.hp = new SVF(sr);
    this.hp.set(500, 0.7);
    this.times = [0, 0.009, 0.017, 0.026].map((t, i) => Math.round((t * spread + (i ? (rng.next() - 0.5) * 0.003 : 0)) * sr));
    this.burstCoef = decayCoef(0.012, sr);
    this.tailCoef = decayCoef(tail, sr);
    this.level = 1;
  }
  next(): number {
    const t = this.t;
    for (let i = 0; i < this.times.length; i++) if (t === this.times[i]) {
      this.burstEnv = i === this.times.length - 1 ? 0.8 : 1;
      if (i === this.times.length - 1) this.tailEnv = 0.9;
    }
    const n = this.noise.white();
    this.bp.tick(n);
    this.hp.tick(this.bp.bp);
    const out = this.hp.hp * (this.burstEnv + this.tailEnv * 0.55);
    this.burstEnv *= this.burstCoef;
    this.tailEnv *= this.tailCoef;
    if (t > this.times[3] && this.tailEnv < 5e-4 && this.burstEnv < 5e-4) this.active = false;
    return out * 1.6;
  }
}

export class ShakerHit extends Hit {
  private noise: Noise;
  private bp: SVF;
  private env = 0;
  private att: number;
  private coef: number;
  private rising = true;
  private jingle: Float64Array | null;
  private jPh: Float64Array;
  private jEnv = 1;
  private jCoef: number;
  constructor(sr: number, seed: number, hz: number, attack: number, T: number, jingle: boolean) {
    super(sr);
    this.noise = new Noise(seed);
    this.bp = new SVF(sr);
    this.bp.set(hz, 1.4);
    this.att = 1 / Math.max(2, attack * sr);
    this.coef = decayCoef(T, sr);
    this.jingle = jingle ? Float64Array.from([5420, 6370, 7730, 9120]) : null;
    this.jPh = new Float64Array(4);
    this.jCoef = decayCoef(T * 1.6, sr);
  }
  next(): number {
    if (this.rising) {
      this.env += this.att;
      if (this.env >= 1) this.rising = false;
    } else this.env *= this.coef;
    this.bp.tick(this.noise.white());
    let out = this.bp.bp * this.env;
    if (this.jingle) {
      let j = 0;
      for (let i = 0; i < 4; i++) {
        this.jPh[i] += (TWO_PI * this.jingle[i]) / this.sr;
        j += Math.sin(this.jPh[i]) * 0.04;
      }
      out += j * this.jEnv * (this.rising ? this.env : 1);
      this.jEnv *= this.jCoef;
    }
    if (!this.rising && this.env < 5e-4) this.active = false;
    return out * 1.4;
  }
}

// ------------------------------------------------------------------ kit construction

const KITS = ['Acoustic', 'Tight studio', 'Jazz', 'Rock', '808', '909', 'Lo-fi'];
const K = { ACOUSTIC: 0, TIGHT: 1, JAZZ: 2, ROCK: 3, E808: 4, E909: 5, LOFI: 6 };

export const GM_DRUMS: Record<number, string> = {
  35: 'kick', 36: 'kick', 37: 'sidestick', 38: 'snare', 39: 'clap', 40: 'rimshot', 41: 'tom1', 42: 'hat_c', 43: 'tom2',
  44: 'hat_p', 45: 'tom3', 46: 'hat_o', 47: 'tom4', 48: 'tom5', 49: 'crash', 50: 'tom6', 51: 'ride', 52: 'china',
  53: 'ride_bell', 54: 'tamb', 55: 'splash', 56: 'cowbell', 57: 'crash2', 59: 'ride', 60: 'bongo_hi', 61: 'bongo_lo',
  62: 'conga_mute', 63: 'conga_hi', 64: 'conga_lo', 69: 'shaker', 70: 'shaker', 75: 'claves', 76: 'wood_hi', 77: 'wood_lo', 82: 'shaker',
};

const PAN: Record<string, number> = {
  kick: 0, snare: -0.08, rimshot: -0.08, sidestick: -0.1, clap: 0.05, hat_c: -0.35, hat_p: -0.35, hat_o: -0.35,
  tom1: 0.5, tom2: 0.4, tom3: 0.15, tom4: -0.1, tom5: -0.3, tom6: -0.45, crash: -0.5, crash2: 0.45, ride: 0.5,
  ride_bell: 0.5, china: 0.55, splash: -0.55, tamb: 0.3, cowbell: -0.25, shaker: 0.35, bongo_hi: 0.3, bongo_lo: 0.2,
  conga_mute: -0.3, conga_hi: -0.4, conga_lo: -0.3, claves: 0.25, wood_hi: 0.3, wood_lo: 0.2,
};

export interface KitOptions {
  kit: number;
  tune: number;
  decay: number;
  hatBright: number;
}

/** Build one hit. `vel` is 1..127; randomness comes from `rng` so a seed reproduces the exact same performance. */
export function makeHit(kind: string, vel: number, sr: number, rng: Rng, o: KitOptions, variation = 0.5): Hit {
  const v = vel / 127;
  const vr = (amt: number): number => 1 + (rng.next() - 0.5) * 2 * amt * variation;
  const kit = o.kit;
  const tune = Math.pow(2, o.tune / 12);
  const dm = o.decay;
  const seed = Math.floor(rng.next() * 1e9);
  let hit: Hit;
  const lvl = Math.pow(v, 1.15);
  switch (kind) {
    case 'kick': {
      const table: ToneSpec[] = [
        { f0: 135, f1: 52, pd: 0.022, T: 0.34, drive: 1.5, click: 0.35, clickHz: 3500, lp: 7500, partials: [[1.95, 0.12, 0.3]] },
        { f0: 150, f1: 58, pd: 0.016, T: 0.22, drive: 1.8, click: 0.5, lp: 9000, partials: [[2.1, 0.08, 0.25]] },
        { f0: 120, f1: 64, pd: 0.02, T: 0.24, drive: 1.2, click: 0.18, lp: 5200 },
        { f0: 140, f1: 48, pd: 0.026, T: 0.4, drive: 1.8, click: 0.45, lp: 8500, partials: [[2.0, 0.1, 0.3]] },
        { f0: 175, f1: 46, pd: 0.07, T: 1.05, drive: 1.3, click: 0.04, lp: 4500 },
        { f0: 220, f1: 56, pd: 0.035, T: 0.42, drive: 2.4, click: 0.4, lp: 9000 },
        { f0: 130, f1: 55, pd: 0.02, T: 0.26, drive: 2.0, click: 0.2, lp: 3800 },
      ];
      const s = { ...table[kit] };
      s.f0 *= tune * (0.85 + 0.25 * v) * vr(0.02);
      s.f1 *= tune * vr(0.015);
      s.T *= dm * vr(0.06);
      hit = new ToneHit(sr, s, seed);
      hit.gain = 0.95 * lvl;
      break;
    }
    case 'snare':
    case 'rimshot':
    case 'sidestick': {
      if (kind === 'sidestick') {
        hit = new ToneHit(sr, { f0: 520 * tune, f1: 480 * tune, pd: 0.01, T: 0.06 * dm, drive: 1, click: 0.8, partials: [[2.2, 0.5, 0.5]], lp: 8000 }, seed);
        hit.gain = 0.7 * lvl;
        break;
      }
      const table: SnareSpec[] = [
        { f: 188, toneLvl: 0.5, toneT: 0.12, noiseLvl: 0.85, noiseHz: 2300, noiseQ: 0.8, noiseT: 0.2, snap: 0.5 },
        { f: 205, toneLvl: 0.45, toneT: 0.09, noiseLvl: 0.75, noiseHz: 2800, noiseQ: 0.9, noiseT: 0.13, snap: 0.6 },
        { f: 172, toneLvl: 0.45, toneT: 0.14, noiseLvl: 0.6, noiseHz: 2000, noiseQ: 0.7, noiseT: 0.17, snap: 0.3 },
        { f: 195, toneLvl: 0.6, toneT: 0.14, noiseLvl: 0.95, noiseHz: 2400, noiseQ: 0.7, noiseT: 0.26, snap: 0.6 },
        { f: 185, toneLvl: 0.7, toneT: 0.1, noiseLvl: 0.7, noiseHz: 3200, noiseQ: 0.6, noiseT: 0.2, snap: 0.2, sizzle: 0.5 },
        { f: 205, toneLvl: 0.55, toneT: 0.09, noiseLvl: 0.95, noiseHz: 3300, noiseQ: 0.6, noiseT: 0.22, snap: 0.55, sizzle: 0.5 },
        { f: 180, toneLvl: 0.5, toneT: 0.1, noiseLvl: 0.7, noiseHz: 2100, noiseQ: 0.8, noiseT: 0.15, snap: 0.3 },
      ];
      const s = { ...table[kit] };
      s.f *= tune * vr(0.015);
      s.noiseT *= dm * (0.8 + 0.35 * v) * vr(0.06);
      s.toneT *= dm;
      s.noiseLvl *= 0.55 + 0.65 * v;
      if (kind === 'rimshot') s.rim = 0.55 * v;
      hit = new SnareHit(sr, s, seed);
      hit.gain = 0.9 * lvl;
      break;
    }
    case 'hat_c':
    case 'hat_p':
    case 'hat_o': {
      const open = kind === 'hat_o';
      const base = kind === 'hat_c' ? 0.05 : kind === 'hat_p' ? 0.09 : 0.55;
      const e = kit === K.E808 || kit === K.E909;
      const s: HatSpec = {
        T: base * dm * (0.8 + 0.3 * v) * vr(0.1) * (kit === K.JAZZ ? 1.3 : 1),
        metal: e ? 1.2 : 0.55,
        noise: e ? 0.2 : 0.75,
        hz: (kit === K.JAZZ ? 7500 : 9000) * (0.85 + 0.3 * o.hatBright) * (0.85 + 0.25 * v),
        scale: tune * (e ? 1 : 0.9) * vr(0.01),
      };
      hit = new HatHit(sr, s, seed);
      hit.gain = (0.75 + 0.2 * (open ? 1 : 0)) * lvl;
      hit.group = 1;
      break;
    }
    case 'crash':
    case 'crash2':
    case 'splash':
    case 'china':
    case 'ride':
    case 'ride_bell': {
      const spec: CymbalSpec =
        kind === 'ride' ? { T: 1.9 * dm, lo: 380, hi: 7500, partials: 16, noise: 0.28, ping: 1.2 }
        : kind === 'ride_bell' ? { T: 1.5 * dm, lo: 700, hi: 5200, partials: 12, noise: 0.08, ping: 2.5 }
        : kind === 'splash' ? { T: 0.8 * dm, lo: 500, hi: 9500, partials: 16, noise: 0.5 }
        : kind === 'china' ? { T: 1.6 * dm, lo: 420, hi: 8200, partials: 18, noise: 0.6 }
        : { T: (kind === 'crash' ? 2.8 : 2.2) * dm, lo: kind === 'crash' ? 330 : 420, hi: 9000, partials: 20, noise: 0.62 };
      hit = new CymbalHit(sr, spec, seed + (kind === 'crash2' ? 99 : 0));
      hit.gain = (kind === 'ride' ? 0.55 : 0.7) * lvl;
      break;
    }
    case 'clap': {
      const e = kit === K.E808 || kit === K.E909;
      hit = new ClapHit(sr, seed, 1250 * tune * (e ? 1.1 : 1), (e ? 0.2 : 0.12) * dm, e ? 1 : 1.2);
      hit.gain = 0.8 * lvl;
      break;
    }
    case 'tom1':
    case 'tom2':
    case 'tom3':
    case 'tom4':
    case 'tom5':
    case 'tom6': {
      const base = { tom1: 78, tom2: 92, tom3: 112, tom4: 132, tom5: 158, tom6: 188 }[kind] as number;
      const e = kit === K.E808 || kit === K.E909;
      hit = new ToneHit(sr, {
        f0: base * tune * (1.5 + 0.2 * v), f1: base * tune * vr(0.015), pd: 0.05, T: (e ? 0.5 : 0.36) * dm * vr(0.06), drive: 1.2,
        click: 0.25, partials: e ? [] : [[1.58, 0.2, 0.5], [2.14, 0.1, 0.35]], lp: 9000, noiseAtk: 0.35 * v, noiseHz: 2500, noiseT: 0.02,
      }, seed);
      hit.gain = 0.85 * lvl;
      break;
    }
    case 'tamb':
      hit = new ShakerHit(sr, seed, 8200, 0.004, 0.16 * dm, true);
      hit.gain = 0.5 * lvl;
      break;
    case 'shaker':
      hit = new ShakerHit(sr, seed, 6500, 0.012, 0.07 * dm, false);
      hit.gain = 0.45 * lvl;
      break;
    case 'cowbell':
      hit = new ToneHit(sr, { f0: 560 * tune, f1: 556 * tune, pd: 0.01, T: 0.32 * dm, square: true, partials: [[1.49, 0.8, 0.9]], lp: 6000, click: 0.15 }, seed);
      hit.gain = 0.4 * lvl;
      break;
    case 'claves':
      hit = new ToneHit(sr, { f0: 2600 * tune, f1: 2500 * tune, pd: 0.01, T: 0.05 * dm, click: 0.4, partials: [[1.5, 0.15, 0.6]] }, seed);
      hit.gain = 0.6 * lvl;
      break;
    case 'wood_hi':
    case 'wood_lo':
      hit = new ToneHit(sr, { f0: (kind === 'wood_hi' ? 1700 : 1150) * tune, f1: (kind === 'wood_hi' ? 1650 : 1100) * tune, pd: 0.01, T: 0.08 * dm, click: 0.3, partials: [[2.4, 0.2, 0.4]] }, seed);
      hit.gain = 0.55 * lvl;
      break;
    case 'bongo_hi':
    case 'bongo_lo':
    case 'conga_mute':
    case 'conga_hi':
    case 'conga_lo': {
      const base = { bongo_hi: 420, bongo_lo: 310, conga_mute: 230, conga_hi: 270, conga_lo: 200 }[kind] as number;
      const mute = kind === 'conga_mute';
      hit = new ToneHit(sr, {
        f0: base * tune * 1.12, f1: base * tune, pd: 0.03, T: (mute ? 0.08 : 0.26) * dm, drive: 1.1, click: 0.3,
        partials: [[1.59, 0.25, 0.4], [2.14, 0.1, 0.3]], lp: 7000, noiseAtk: 0.25 * v, noiseHz: 3000, noiseT: 0.012,
      }, seed);
      hit.gain = 0.8 * lvl;
      break;
    }
    default:
      hit = new ToneHit(sr, { f0: 200, f1: 100, pd: 0.03, T: 0.2 }, seed);
      hit.gain = 0.5 * lvl;
  }
  hit.kind = kind;
  const [pl, pr] = panGains(clamp(PAN[kind] ?? 0, -1, 1));
  hit.gL = pl * Math.SQRT2;
  hit.gR = pr * Math.SQRT2;
  return hit;
}

// ------------------------------------------------------------------ instrument

class DrumVoice extends VoiceBase {
  hit: Hit | null = null;
}

const P: ParamDesc[] = [
  { id: 'kit', name: 'Kit', min: 0, max: KITS.length - 1, def: 0, options: KITS, group: 'Kit' },
  { id: 'tune', name: 'Tuning', min: -12, max: 12, def: 0, unit: 'st', group: 'Kit' },
  { id: 'decay', name: 'Decay', min: 0.4, max: 2.5, def: 1, group: 'Kit' },
  { id: 'hat_bright', name: 'Hi-hat brightness', min: 0, max: 1, def: 0.5, group: 'Kit' },
  { id: 'variation', name: 'Round-robin variation', min: 0, max: 1, def: 0.5, group: 'Kit' },
  { id: 'kick_vol', name: 'Kick level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'snare_vol', name: 'Snare level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'hat_vol', name: 'Hi-hat level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'tom_vol', name: 'Tom level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'cym_vol', name: 'Cymbal level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'perc_vol', name: 'Percussion level', min: 0, max: 2, def: 1, group: 'Mixer' },
  { id: 'width', name: 'Stereo width', min: 0, max: 1, def: 0.8, group: 'Mixer' },
];

class DrumKit extends InstrumentBase<DrumVoice> {
  readonly type = 'drums';
  private rng: Rng;
  constructor(sr: number, seed: number) {
    super(sr, P);
    this.rng = new Rng(seed);
    this.addVoices(32, () => new DrumVoice());
  }
  protected startVoice(v: DrumVoice, pitch: number, vel: number): void {
    const kind = GM_DRUMS[pitch];
    if (!kind) {
      v.hit = null;
      v.active = false;
      return;
    }
    const p = this.p;
    const opt: KitOptions = { kit: Math.round(p.kit), tune: p.tune, decay: p.decay, hatBright: p.hat_bright };
    const hit = makeHit(kind, vel, this.sr, this.rng, opt, p.variation);
    const vol = kind.startsWith('kick') ? p.kick_vol : kind === 'snare' || kind === 'rimshot' || kind === 'sidestick' || kind === 'clap' ? p.snare_vol
      : kind.startsWith('hat') ? p.hat_vol : kind.startsWith('tom') ? p.tom_vol : /crash|ride|china|splash/.test(kind) ? p.cym_vol : p.perc_vol;
    hit.gain *= vol;
    // narrow the image with the width control
    const w = p.width;
    hit.gL = 1 + (hit.gL - 1) * w;
    hit.gR = 1 + (hit.gR - 1) * w;
    if (kind === 'hat_c' || kind === 'hat_p') {
      for (const o of this.voices) if (o.active && o.hit && o.hit.kind === 'hat_o') o.hit.choke();
    }
    v.hit = hit;
    // drums ring on their own; the key being released does not matter
    v.held = false;
  }
  protected releaseVoice(): void {
    /* one-shot */
  }
  protected renderVoice(v: DrumVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    if (!v.hit) {
      v.active = false;
      return;
    }
    v.hit.render(L, R, s, e);
    v.age += e - s;
    if (!v.hit.active) v.active = false;
  }
  override noteOff(): void {
    /* ignore */
  }
}

export const drumsDef: InstDef = {
  type: 'drums',
  name: 'Drum kit',
  category: 'drums',
  description:
    'Synthesized drum kit on the General MIDI map: 36 kick, 38 snare, 37 side stick, 39 clap, 42/44/46 hats, 41/43/45/47/48/50 toms, 49/57 crash, 51 ride, 53 ride bell, 54 tambourine, 56 cowbell, 60-64 bongos and congas, 69/70 shakers, 75-77 claves and blocks. Every hit is rendered fresh (random micro-variation), velocity changes the tone and not just the volume.',
  range: [35, 82],
  polyphony: 'poly',
  params: P,
  presets: {
    'Acoustic kit': { kit: 'Acoustic' },
    'Tight studio kit': { kit: 'Tight studio' },
    'Jazz kit': { kit: 'Jazz', decay: 1.1 },
    'Rock kit': { kit: 'Rock' },
    '808 kit': { kit: '808' },
    '909 kit': { kit: '909' },
    'Lo-fi kit': { kit: 'Lo-fi', tune: -1 },
  },
  create: (sr, seed) => new DrumKit(sr, seed),
};
