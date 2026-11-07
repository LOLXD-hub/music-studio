// Shared DSP helpers. Pure TypeScript, no DOM or Node APIs, so the same code runs
// inside an AudioWorklet, a worker thread and plain Node.

export const PI = Math.PI;
export const TWO_PI = Math.PI * 2;

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f: number): number => 69 + 12 * Math.log2(f / 440);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));
export const centsToRatio = (c: number): number => Math.pow(2, c / 1200);

/** Kill denormals in long feedback paths. */
export const flush = (x: number): number => (x > 1e-18 || x < -1e-18 ? x : 0);

/** Cheap rational tanh approximation, accurate enough for saturation. */
export function fastTanh(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Deterministic PRNG (mulberry32) with a few helpers. Every render is reproducible from a seed. */
export class Rng {
  private a: number;
  private spare: number | null = null;
  constructor(seed: number = 1) {
    this.a = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    let t = (this.a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  bipolar(): number {
    return this.next() * 2 - 1;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(TWO_PI * v);
    return m * Math.cos(TWO_PI * v);
  }
  /** Fork a child generator so sub-systems do not disturb each other's sequence. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

/** Fast white / pink / brown noise source, independent from Rng for speed. */
export class Noise {
  private s: number;
  private p0 = 0;
  private p1 = 0;
  private p2 = 0;
  private p3 = 0;
  private p4 = 0;
  private p5 = 0;
  private p6 = 0;
  private brown = 0;
  constructor(seed: number = 12345) {
    this.s = (seed >>> 0) || 2463534242;
  }
  white(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 2147483648 - 1;
  }
  pink(): number {
    const w = this.white();
    this.p0 = 0.99886 * this.p0 + w * 0.0555179;
    this.p1 = 0.99332 * this.p1 + w * 0.0750759;
    this.p2 = 0.969 * this.p2 + w * 0.153852;
    this.p3 = 0.8665 * this.p3 + w * 0.3104856;
    this.p4 = 0.55 * this.p4 + w * 0.5329522;
    this.p5 = -0.7616 * this.p5 - w * 0.016898;
    const out = this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + w * 0.5362;
    this.p6 = w * 0.115926;
    return out * 0.11;
  }
  brownian(): number {
    this.brown = (this.brown + 0.02 * this.white()) / 1.02;
    return this.brown * 3.5;
  }
}

/** One-pole smoother for control values. */
export class Smoother {
  value: number;
  target: number;
  private coef: number;
  constructor(value: number, tauSec: number, sampleRate: number) {
    this.value = value;
    this.target = value;
    this.coef = 1 - Math.exp(-1 / Math.max(1e-6, tauSec * sampleRate));
  }
  set(v: number): void {
    this.target = v;
  }
  jump(v: number): void {
    this.value = v;
    this.target = v;
  }
  next(): number {
    this.value += (this.target - this.value) * this.coef;
    return this.value;
  }
}

/** Equal-power pan law, pan in -1..1. */
export function panGains(pan: number): [number, number] {
  const a = (clamp(pan, -1, 1) + 1) * 0.25 * PI;
  return [Math.cos(a), Math.sin(a)];
}

export function zero(buf: Float32Array, start: number, end: number): void {
  buf.fill(0, start, end);
}

/** Parameter descriptor shared by instruments and effects (UI and MCP both read it). */
export interface ParamDesc {
  id: string;
  name: string;
  min: number;
  max: number;
  def: number;
  step?: number;
  unit?: string;
  /** If set, the value is an index into this list and may also be given as a string. */
  options?: string[];
  group?: string;
  /** Logarithmic scaling hint for sliders. */
  log?: boolean;
}

export function resolveParam(desc: ParamDesc | undefined, v: number | string): number {
  if (typeof v === 'string') {
    if (desc?.options) {
      const i = desc.options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
      if (i >= 0) return i;
    }
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : desc?.def ?? 0;
  }
  if (!desc) return v;
  return clamp(v, desc.min, desc.max);
}
