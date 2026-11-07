import { TWO_PI, PI, clamp, fastTanh, flush } from './core.ts';

export type BiquadType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';

/** RBJ biquad, transposed direct form II. One instance per channel. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private z1 = 0;
  private z2 = 0;

  set(type: BiquadType, fc: number, q: number, gainDb: number, sampleRate: number): void {
    fc = clamp(fc, 10, sampleRate * 0.49);
    q = Math.max(0.05, q);
    const w0 = (TWO_PI * fc) / sampleRate;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (type) {
      case 'lp':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'bp':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cw; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'allpass':
        b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    const inv = 1 / a0;
    this.b0 = b0 * inv;
    this.b1 = b1 * inv;
    this.b2 = b2 * inv;
    this.a1 = a1 * inv;
    this.a2 = a2 * inv;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** In-place block processing. */
  run(buf: Float32Array, start: number, end: number): void {
    let z1 = this.z1;
    let z2 = this.z2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = start; i < end; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = flush(z1);
    this.z2 = flush(z2);
  }

  /** Magnitude response, used for EQ curve drawing and tests. */
  magnitudeAt(f: number, sampleRate: number): number {
    const w = (TWO_PI * f) / sampleRate;
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2;
    const ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2;
    const di = -(this.a1 * s1 + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** Topology-preserving state variable filter (Simper). Stable under fast cutoff modulation. */
export class SVF {
  lp = 0;
  bp = 0;
  hp = 0;
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private sampleRate: number;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.set(1000, 0.7);
  }
  set(fc: number, q: number): void {
    this.g = Math.tan((PI * clamp(fc, 10, this.sampleRate * 0.45)) / this.sampleRate);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  tick(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = flush(2 * v1 - this.ic1);
    this.ic2 = flush(2 * v2 - this.ic2);
    this.bp = v1;
    this.lp = v2;
    this.hp = x - this.k * v1 - v2;
    return v2;
  }
  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }
}

/** Four-pole transistor-ladder style low-pass with saturation and resonance. */
export class Ladder {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private g = 0.1;
  private res = 0;
  private sampleRate: number;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }
  set(fc: number, resonance: number): void {
    const f = clamp(fc, 20, this.sampleRate * 0.45);
    this.g = 1 - Math.exp((-TWO_PI * f) / this.sampleRate);
    this.res = clamp(resonance, 0, 1.2) * 4;
  }
  tick(x: number, drive = 1): number {
    const fb = this.res * this.s3 * (1 - 0.15 * this.g);
    const u = fastTanh((x * drive - fb) * 0.9);
    this.s0 += this.g * (u - fastTanh(this.s0));
    this.s1 += this.g * (fastTanh(this.s0) - fastTanh(this.s1));
    this.s2 += this.g * (fastTanh(this.s1) - fastTanh(this.s2));
    this.s3 += this.g * (fastTanh(this.s2) - fastTanh(this.s3));
    this.s0 = flush(this.s0);
    this.s1 = flush(this.s1);
    this.s2 = flush(this.s2);
    this.s3 = flush(this.s3);
    return this.s3;
  }
  reset(): void {
    this.s0 = this.s1 = this.s2 = this.s3 = 0;
  }
}

export class OnePole {
  private z = 0;
  private a = 0;
  private sampleRate: number;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }
  setCutoff(fc: number): void {
    this.a = 1 - Math.exp((-TWO_PI * clamp(fc, 1, this.sampleRate * 0.49)) / this.sampleRate);
  }
  /** Set by time constant in seconds. */
  setTau(sec: number): void {
    this.a = 1 - Math.exp(-1 / Math.max(1e-6, sec * this.sampleRate));
  }
  lp(x: number): number {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  hp(x: number): number {
    this.z += this.a * (x - this.z);
    return x - this.z;
  }
  reset(v = 0): void {
    this.z = v;
  }
  get value(): number {
    return this.z;
  }
}

export class DcBlock {
  private x1 = 0;
  private y1 = 0;
  tick(x: number): number {
    const y = x - this.x1 + 0.995 * this.y1;
    this.x1 = x;
    this.y1 = flush(y);
    return y;
  }
}

/** Parallel formant resonators for vowel and body-resonance modelling. */
export class FormantBank {
  private f: Biquad[] = [];
  private gains: number[] = [];
  private sampleRate: number;
  constructor(sampleRate: number, count: number) {
    this.sampleRate = sampleRate;
    for (let i = 0; i < count; i++) {
      this.f.push(new Biquad());
      this.gains.push(1);
    }
  }
  set(i: number, fc: number, bandwidth: number, gain: number): void {
    this.f[i].set('bp', fc, fc / Math.max(10, bandwidth), 0, this.sampleRate);
    this.gains[i] = gain;
  }
  tick(x: number): number {
    let y = 0;
    for (let i = 0; i < this.f.length; i++) y += this.f[i].tick(x) * this.gains[i];
    return y;
  }
  reset(): void {
    for (const f of this.f) f.reset();
  }
}
