import { TWO_PI } from './core.ts';

/** Two-sample polynomial band-limited step correction. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export const WAVE_SINE = 0;
export const WAVE_TRI = 1;
export const WAVE_SAW = 2;
export const WAVE_SQUARE = 3;

/** Band-limited oscillator: sine, triangle, saw, pulse. Phase is 0..1. */
export class Osc {
  phase = 0;
  private triState = 0;

  reset(phase = 0): void {
    this.phase = phase;
    this.triState = 0;
  }

  /** dt = frequency / sampleRate. pw is pulse width for the square wave. */
  tick(wave: number, dt: number, pw = 0.5): number {
    let p = this.phase;
    let out: number;
    switch (wave) {
      case WAVE_SINE:
        out = Math.sin(TWO_PI * p);
        break;
      case WAVE_SAW:
        out = 2 * p - 1;
        out -= polyBlep(p, dt);
        break;
      case WAVE_SQUARE: {
        out = p < pw ? 1 : -1;
        out += polyBlep(p, dt);
        let q = p - pw;
        if (q < 0) q += 1;
        out -= polyBlep(q, dt);
        break;
      }
      case WAVE_TRI:
      default: {
        // Integrate a band-limited square for an alias-free triangle.
        let sq = p < 0.5 ? 1 : -1;
        sq += polyBlep(p, dt);
        let q = p + 0.5;
        if (q >= 1) q -= 1;
        sq -= polyBlep(q, dt);
        this.triState = this.triState * 0.999 + sq * dt * 4;
        out = this.triState;
        break;
      }
    }
    p += dt;
    if (p >= 1) p -= 1;
    this.phase = p;
    return out;
  }
}

/** Cheap sine oscillator for LFOs and vibrato. */
export class Lfo {
  phase = 0;
  private sampleRate: number;
  constructor(sampleRate: number, phase = 0) {
    this.sampleRate = sampleRate;
    this.phase = phase;
  }
  /** Returns sine in -1..1. rate in Hz. */
  sine(rate: number): number {
    const v = Math.sin(TWO_PI * this.phase);
    this.phase += rate / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
  tri(rate: number): number {
    const p = this.phase;
    this.phase += rate / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;
    return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  }
}
