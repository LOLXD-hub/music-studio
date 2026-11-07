// Layered sound-effect synthesizer. A recipe is a list of layers (oscillator, noise, FM, modal metal ...),
// each with pitch and filter trajectories and an envelope, plus a short post chain. No samples are used.

import { SVF } from '../engine/dsp/filters.ts';
import { Osc, WAVE_SAW, WAVE_SINE, WAVE_SQUARE, WAVE_TRI } from '../engine/dsp/osc.ts';
import { Noise, Rng, TWO_PI, clamp, fastTanh } from '../engine/dsp/core.ts';
import { createFx } from '../engine/fx/index.ts';

export interface Traj {
  a: number;
  b?: number;
  /** Seconds to travel from a to b (default: the layer length). */
  time?: number;
  /** >1 slow start, <1 fast start. */
  curve?: number;
  /** Interpolate linearly instead of exponentially. */
  lin?: boolean;
}

export type Src = 'sine' | 'tri' | 'saw' | 'square' | 'noise' | 'pink' | 'brown' | 'fm' | 'metal' | 'modal' | 'impulse';

export interface Layer {
  src: Src;
  /** Frequency trajectory, Hz (oscillators, FM carrier, modal fundamental). */
  f?: Traj;
  /** Second oscillator detune in cents (adds thickness). */
  detune?: number;
  pw?: number;
  /** FM: modulator ratio and index trajectory. */
  ratio?: number;
  index?: Traj;
  /** Modal / metal: partial count, inharmonicity spread, partials list override. */
  partials?: number;
  spread?: number;
  modes?: [number, number, number][];
  amp: number;
  env: {
    delay?: number;
    attack?: number;
    hold?: number;
    /** Seconds to fall 60 dB after the hold. */
    decay: number;
    /** Level the envelope settles to before the release (pads). */
    sustain?: number;
    /** 'hann' makes a symmetric swell over `decay` seconds with the peak at `peak` (0..1). */
    shape?: 'exp' | 'hann';
    peak?: number;
  };
  filter?: { type: 'lp' | 'hp' | 'bp' | 'notch'; f: Traj; q?: number };
  am?: { rate: number; depth: number };
  vib?: { rate: number; depth: number };
  ring?: { f: number; depth: number };
  /** Hard stutter gate. */
  gate?: { rate: number; duty: number };
  drive?: number;
  crush?: { bits: number; down: number };
  pan?: number;
  /** 0 = same noise in both channels, 1 = independent. */
  stereo?: number;
  /** Random grain triggers per second: layer becomes a sparse burst texture (rain, fire, crackle). */
  grains?: { rate: number; decay: number; spread?: number };
}

export interface Post {
  reverb?: { size?: number; decay?: number; mix?: number; predelay?: number; damp?: number };
  delay?: { time: number; feedback: number; mix: number };
  drive?: number;
  lp?: number;
  hp?: number;
  widen?: number;
  /** Fade-out in seconds applied at the very end. */
  fadeOut?: number;
  /** Peak target in dBFS after normalizing. */
  peakDb?: number;
}

export interface Recipe {
  /** Length of the dry sound in seconds. */
  length: number;
  layers: Layer[];
  post?: Post;
}

function trajAt(tr: Traj, t: number, len: number): number {
  if (tr.b === undefined || tr.b === tr.a) return tr.a;
  const T = tr.time ?? len;
  let x = Math.min(1, t / Math.max(1e-4, T));
  if (tr.curve) x = Math.pow(x, tr.curve);
  if (tr.lin || tr.a <= 0 || tr.b <= 0) return tr.a + (tr.b - tr.a) * x;
  return tr.a * Math.pow(tr.b / tr.a, x);
}

function envAt(e: Layer['env'], t: number): number {
  t -= e.delay ?? 0;
  if (t < 0) return 0;
  if (e.shape === 'hann') {
    const x = t / Math.max(1e-4, e.decay);
    if (x >= 1) return 0;
    const pk = e.peak ?? 0.5;
    const u = x < pk ? (x / pk) * 0.5 : 0.5 + ((x - pk) / (1 - pk)) * 0.5;
    return Math.pow(Math.sin(Math.PI * u), 2);
  }
  const a = e.attack ?? 0.001;
  if (t < a) return t / a;
  const h = e.hold ?? 0;
  if (t < a + h) return 1;
  const k = Math.exp((-6.9078 * (t - a - h)) / Math.max(1e-4, e.decay));
  const s = e.sustain ?? 0;
  return s + (1 - s) * k;
}

function layerDuration(l: Layer): number {
  const e = l.env;
  if (e.shape === 'hann') return (e.delay ?? 0) + e.decay;
  return (e.delay ?? 0) + (e.attack ?? 0.001) + (e.hold ?? 0) + e.decay * 1.15;
}

const METAL_RATIOS = [1, 1.47, 1.98, 2.66, 3.44, 4.17, 5.4, 6.7, 8.1, 9.3, 11.2, 13.4];

function renderLayer(l: Layer, len: number, total: number, sr: number, rng: Rng, outL: Float32Array, outR: Float32Array): void {
  const n = Math.min(Math.floor(Math.min(total, layerDuration(l) + 0.01) * sr), outL.length);
  const nzL = new Noise(Math.floor(rng.next() * 1e9) + 1);
  const nzR = new Noise(Math.floor(rng.next() * 1e9) + 7);
  const o1 = new Osc();
  const o2 = new Osc();
  o1.reset(rng.next());
  o2.reset(rng.next());
  const lp = l.filter ? new SVF(sr) : null;
  const lp2 = l.filter ? new SVF(sr) : null;
  const pan = clamp(l.pan ?? 0, -1, 1);
  const pa = (pan + 1) * 0.25 * Math.PI;
  const gL = Math.cos(pa) * Math.SQRT2;
  const gR = Math.sin(pa) * Math.SQRT2;
  let phMod = rng.next();
  let ringPh = 0;
  let amPh = rng.next();
  let vibPh = rng.next();
  let hold = 0;
  let holdL = 0;
  let holdR = 0;
  let holdN = 0;
  // modal bank
  let ys1: Float64Array | null = null;
  let ys2: Float64Array | null = null;
  let c1: Float64Array | null = null;
  let c2: Float64Array | null = null;
  if (l.src === 'metal' || l.src === 'modal') {
    const base = l.f ? trajAt(l.f, 0, len) : 440;
    const list: [number, number, number][] = l.modes
      ? l.modes
      : Array.from({ length: l.partials ?? 8 }, (_, i) => {
          const spread = l.spread ?? 1;
          const r = l.src === 'metal' ? METAL_RATIOS[i % METAL_RATIOS.length] * (1 + (rng.next() - 0.5) * 0.16 * spread) + Math.floor(i / 12) : i + 1;
          return [r, Math.pow(0.78, i) * (0.6 + 0.4 * rng.next()), 1 / (1 + i * 0.45)] as [number, number, number];
        });
    ys1 = new Float64Array(list.length);
    ys2 = new Float64Array(list.length);
    c1 = new Float64Array(list.length);
    c2 = new Float64Array(list.length);
    list.forEach(([ratio, amp, dm], i) => {
      const f = base * ratio;
      if (f > sr * 0.45) return;
      const w = (TWO_PI * f) / sr;
      const r = Math.exp(-6.9078 / (Math.max(0.01, l.env.decay * dm) * sr));
      c1![i] = 2 * r * Math.cos(w);
      c2![i] = r * r;
      ys1![i] = amp * r * Math.sin(w);
    });
  }
  const grains = l.grains;
  let grainEnv = 0;
  const grainCoef = grains ? Math.exp(-6.9078 / (Math.max(0.0005, grains.decay) * sr)) : 0;
  const delaySamples = 0;
  void delaySamples;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const e = envAt(l.env, t);
    if (e <= 0 && l.env.shape !== 'hann' && t < (l.env.delay ?? 0)) continue;
    let x: number;
    let xr: number | null = null;
    let f = l.f ? trajAt(l.f, t - (l.env.delay ?? 0), len) : 440;
    if (l.vib) {
      vibPh += l.vib.rate / sr;
      f *= Math.pow(2, (l.vib.depth / 1200) * Math.sin(TWO_PI * vibPh));
    }
    switch (l.src) {
      case 'sine':
      case 'tri':
      case 'saw':
      case 'square': {
        const w = l.src === 'sine' ? WAVE_SINE : l.src === 'tri' ? WAVE_TRI : l.src === 'saw' ? WAVE_SAW : WAVE_SQUARE;
        const dt = Math.min(0.45, f / sr);
        x = o1.tick(w, dt, l.pw ?? 0.5);
        if (l.detune) x = 0.5 * (x + o2.tick(w, Math.min(0.45, (f * Math.pow(2, l.detune / 1200)) / sr), l.pw ?? 0.5));
        break;
      }
      case 'fm': {
        const idx = l.index ? trajAt(l.index, t - (l.env.delay ?? 0), len) : 2;
        phMod += (f * (l.ratio ?? 1)) / sr;
        if (phMod > 1) phMod -= 1;
        const ph = o1.phase + (f / sr);
        o1.phase = ph - Math.floor(ph);
        x = Math.sin(TWO_PI * o1.phase + idx * Math.sin(TWO_PI * phMod));
        break;
      }
      case 'noise': x = nzL.white(); xr = nzR.white(); break;
      case 'pink': x = nzL.pink() * 2.2; xr = nzR.pink() * 2.2; break;
      case 'brown': x = nzL.brownian() * 1.6; xr = nzR.brownian() * 1.6; break;
      case 'impulse': x = i === 0 ? 1 : 0; break;
      case 'metal':
      case 'modal': {
        let s = 0;
        for (let k = 0; k < ys1!.length; k++) {
          const y = c1![k] * ys1![k] - c2![k] * ys2![k];
          ys2![k] = ys1![k];
          ys1![k] = y;
          s += y;
        }
        x = s * 2;
        break;
      }
      default: x = 0;
    }
    if (grains) {
      if (rng.next() < grains.rate / sr) grainEnv = 0.4 + 0.6 * rng.next();
      grainEnv *= grainCoef;
      x *= grainEnv;
      if (xr !== null) xr *= grainEnv;
    }
    if (l.ring) {
      ringPh += l.ring.f / sr;
      const r = Math.sin(TWO_PI * ringPh);
      x = x * (1 - l.ring.depth) + x * r * l.ring.depth;
      if (xr !== null) xr = xr * (1 - l.ring.depth) + xr * r * l.ring.depth;
    }
    if (l.am) {
      amPh += l.am.rate / sr;
      const g = 1 - l.am.depth * (0.5 + 0.5 * Math.sin(TWO_PI * amPh));
      x *= g;
      if (xr !== null) xr *= g;
    }
    if (l.gate) {
      const ph = (t * l.gate.rate) % 1;
      const g = ph < l.gate.duty ? 1 : 0;
      x *= g;
      if (xr !== null) xr *= g;
    }
    if (l.crush) {
      holdN++;
      if (holdN >= l.crush.down) {
        holdN = 0;
        const lv = Math.pow(2, l.crush.bits - 1);
        hold = Math.round(x * lv) / lv;
        holdL = hold;
        holdR = xr !== null ? Math.round(xr * lv) / lv : hold;
      }
      x = holdL;
      if (xr !== null) xr = holdR;
    }
    if (l.drive) {
      const d = 1 + l.drive;
      x = fastTanh(x * d) / Math.sqrt(d);
      if (xr !== null) xr = fastTanh(xr * d) / Math.sqrt(d);
    }
    if (lp && lp2 && l.filter) {
      if ((i & 15) === 0) {
        const fc = clamp(trajAt(l.filter.f, t, len), 30, sr * 0.45);
        lp.set(fc, l.filter.q ?? 0.8);
        lp2.set(fc, l.filter.q ?? 0.8);
      }
      const ty = l.filter.type;
      lp.tick(x);
      x = ty === 'lp' ? lp.lp : ty === 'hp' ? lp.hp : ty === 'bp' ? lp.bp : lp.lp + lp.hp;
      if (xr !== null) {
        lp2.tick(xr);
        xr = ty === 'lp' ? lp2.lp : ty === 'hp' ? lp2.hp : ty === 'bp' ? lp2.bp : lp2.lp + lp2.hp;
      }
    }
    const st = l.stereo ?? 0;
    const a = l.amp * e;
    const left = x * a;
    const right = xr !== null ? (xr * st + x * (1 - st)) * a : left;
    outL[i] += left * gL;
    outR[i] += right * gR;
  }
}

function postProcess(L: Float32Array, R: Float32Array, sr: number, post: Post): { L: Float32Array; R: Float32Array } {
  let tail = 0;
  if (post.reverb) tail = Math.min(5, (post.reverb.decay ?? 1.5) * 1.05);
  if (post.delay) tail = Math.max(tail, Math.min(3, post.delay.time * 5));
  const extra = Math.round(tail * sr);
  const total = L.length + extra;
  const oL = new Float32Array(total);
  const oR = new Float32Array(total);
  oL.set(L);
  oR.set(R);
  const chain: ReturnType<typeof createFx>[] = [];
  if (post.hp) chain.push(createFx('eq', sr, { hp: post.hp }));
  if (post.lp) chain.push(createFx('eq', sr, { lp: post.lp }));
  if (post.drive) chain.push(createFx('distortion', sr, { type: 0, drive: post.drive, output: -post.drive * 0.4, tone: 9000 }));
  if (post.delay) chain.push(createFx('delay', sr, { sync: 0, time_l: post.delay.time * 1000, time_r: post.delay.time * 1000 * 1.07, feedback: post.delay.feedback, mix: post.delay.mix, highcut: 6000 }));
  if (post.reverb) chain.push(createFx('reverb', sr, { size: post.reverb.size ?? 1, decay: post.reverb.decay ?? 1.5, mix: post.reverb.mix ?? 0.3, predelay: post.reverb.predelay ?? 8, damp: post.reverb.damp ?? 0.5, lowcut: 100 }));
  if (post.widen) chain.push(createFx('widener', sr, { width: post.widen, mono_below: 120 }));
  for (const fx of chain) {
    if (!fx) continue;
    for (let i = 0; i < total; i += 512) {
      const e = Math.min(total, i + 512);
      fx.process(oL.subarray(i, e), oR.subarray(i, e), 0, e - i);
    }
  }
  return { L: oL, R: oR };
}

/** Render a recipe to stereo audio at the given sample rate. Deterministic for a seed. */
export function renderRecipe(r: Recipe, sr: number, seed: number): { L: Float32Array; R: Float32Array } {
  const rng = new Rng(seed);
  const total = r.length + Math.max(0, ...r.layers.map((l) => layerDuration(l) - r.length)) * 0 + 0.02;
  const frames = Math.ceil(Math.max(total, 0.03) * sr);
  let L: Float32Array = new Float32Array(frames);
  let R: Float32Array = new Float32Array(frames);
  for (const l of r.layers) renderLayer(l, r.length, r.length + 0.02, sr, rng.fork(), L, R);
  const post = r.post ?? {};
  const pp = postProcess(L, R, sr, post);
  L = pp.L;
  R = pp.R;
  // trim trailing near-silence, remove DC, fade the end
  const n = L.length;
  let last = n - 1;
  while (last > 8 && Math.abs(L[last]) < 2e-4 && Math.abs(R[last]) < 2e-4) last--;
  const keep = Math.min(n, last + Math.round(0.01 * sr));
  L = L.slice(0, keep);
  R = R.slice(0, keep);
  let dcL = 0, dcR = 0;
  for (let i = 0; i < keep; i++) { dcL += L[i]; dcR += R[i]; }
  dcL /= Math.max(1, keep); dcR /= Math.max(1, keep);
  let pk = 0;
  for (let i = 0; i < keep; i++) {
    L[i] -= dcL; R[i] -= dcR;
    pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  }
  const fade = Math.min(keep >> 1, Math.round((post.fadeOut ?? 0.008) * sr));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[keep - 1 - i] *= g;
    R[keep - 1 - i] *= g;
  }
  const target = Math.pow(10, (post.peakDb ?? -3) / 20);
  const g = pk > 1e-6 ? target / pk : 1;
  for (let i = 0; i < keep; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return { L, R };
}
