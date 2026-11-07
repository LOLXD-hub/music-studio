import { ADSR } from '../dsp/env.ts';
import { clamp, dbToGain, panGains } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

export interface SampleData {
  channels: Float32Array[];
  sampleRate: number;
}

export interface Zone {
  data: SampleData;
  /** MIDI note at which the sample plays at its original pitch. */
  root: number;
  lo: number;
  hi: number;
  velLo: number;
  velHi: number;
  /** Fine tune, cents. */
  tune: number;
  /** dB */
  gain: number;
  pan: number;
  /** Loop points in sample frames; omit for a one-shot. */
  loopStart?: number;
  loopEnd?: number;
  /** Per-zone envelope overrides (seconds), used by SoundFont import. */
  attack?: number;
  release?: number;
  /** Low-pass cutoff in Hz, used by SoundFont import. */
  cutoff?: number;
}

class SampleVoice extends VoiceBase {
  zone: Zone | null = null;
  pos = 0;
  rate = 1;
  env: ADSR;
  gL = 1;
  gR = 1;
  gain = 1;
  lp = 0;
  lpC = 1;
  lp2 = 0;
  constructor(sr: number) {
    super();
    this.env = new ADSR(sr);
  }
}

const P: ParamDesc[] = [
  { id: 'attack', name: 'Attack', min: 0.001, max: 4, def: 0.003, unit: 's', log: true },
  { id: 'decay', name: 'Decay', min: 0.01, max: 8, def: 0.5, unit: 's', log: true },
  { id: 'sustain', name: 'Sustain', min: 0, max: 1, def: 1 },
  { id: 'release', name: 'Release', min: 0.005, max: 6, def: 0.25, unit: 's', log: true },
  { id: 'vel_curve', name: 'Velocity curve', min: 0.3, max: 2.5, def: 1 },
  { id: 'vel_filter', name: 'Velocity darkens soft notes', min: 0, max: 1, def: 0.35 },
  { id: 'tune', name: 'Tuning', min: -100, max: 100, def: 0, unit: 'cents' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.4 },
  { id: 'mono', name: 'Mono', min: 0, max: 1, def: 0, options: ['Poly', 'Mono'] },
];

export class Sampler extends InstrumentBase<SampleVoice> {
  readonly type = 'sampler';
  zones: Zone[] = [];
  private scale = 0.7;
  constructor(sr: number, _seed: number) {
    super(sr, P);
    this.addVoices(24, () => new SampleVoice(sr));
  }
  setZones(zones: Zone[]): void {
    this.zones = zones;
  }
  private pickZone(pitch: number, vel: number): Zone | null {
    let best: Zone | null = null;
    for (const z of this.zones) {
      if (pitch >= z.lo && pitch <= z.hi && vel >= z.velLo && vel <= z.velHi) {
        if (!best || Math.abs(pitch - z.root) < Math.abs(pitch - best.root)) best = z;
      }
    }
    return best;
  }
  override noteOn(pitch: number, vel: number, art?: string): void {
    if (Math.round(this.p.mono) >= 1) for (const v of this.voices) if (v.active) this.releaseVoice(v);
    super.noteOn(pitch, vel, art);
  }
  protected startVoice(v: SampleVoice, pitch: number, vel: number): void {
    const z = this.pickZone(pitch, vel);
    if (!z) {
      v.active = false;
      return;
    }
    const p = this.p;
    v.zone = z;
    v.pos = 0;
    const cents = (pitch - z.root) * 100 + z.tune + p.tune;
    v.rate = Math.pow(2, cents / 1200) * (z.data.sampleRate / this.sr);
    const velN = Math.pow(vel / 127, p.vel_curve);
    v.gain = dbToGain(z.gain) * (0.25 + 0.75 * velN) * this.scale;
    const [pl, pr] = panGains(clamp(z.pan * p.stereo + (z.data.channels.length === 1 ? 0 : 0), -1, 1));
    v.gL = pl * Math.SQRT2;
    v.gR = pr * Math.SQRT2;
    v.env.setTimes(z.attack ?? p.attack, p.decay, p.sustain, z.release ?? p.release);
    v.env.reset();
    v.env.gateOn();
    const cutoff = z.cutoff ?? 18000;
    const soft = 1 - vel / 127;
    const fc = clamp(cutoff * Math.pow(2, -soft * p.vel_filter * 3), 400, this.sr * 0.45);
    v.lpC = 1 - Math.exp((-2 * Math.PI * fc) / this.sr);
    v.lp = 0;
    v.lp2 = 0;
  }
  protected releaseVoice(v: SampleVoice): void {
    v.env.gateOff();
  }
  protected renderVoice(v: SampleVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const z = v.zone;
    if (!z) {
      v.active = false;
      return;
    }
    const ch = z.data.channels;
    const a = ch[0];
    const b = ch.length > 1 ? ch[1] : ch[0];
    const n = a.length;
    const loopS = z.loopStart ?? -1;
    const loopE = z.loopEnd ?? -1;
    const looping = loopS >= 0 && loopE > loopS + 8;
    const vol = v.gain * this.volume * this.expression;
    let pos = v.pos;
    const rate = v.rate * Math.pow(2, (this.bend * 200) / 1200);
    for (let i = s; i < e; i++) {
      if (looping && pos >= loopE) pos -= loopE - loopS;
      if (pos >= n - 2) {
        v.active = false;
        break;
      }
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const im1 = i0 > 0 ? i0 - 1 : 0;
      const i2 = Math.min(n - 1, i0 + 1);
      const i3 = Math.min(n - 1, i0 + 2);
      // Catmull-Rom interpolation
      const c = (arr: Float32Array): number => {
        const y0 = arr[im1];
        const y1 = arr[i0];
        const y2 = arr[i2];
        const y3 = arr[i3];
        return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      };
      let xl = c(a);
      let xr = b === a ? xl : c(b);
      v.lp += v.lpC * (xl - v.lp);
      v.lp2 += v.lpC * (xr - v.lp2);
      xl = v.lp;
      xr = v.lp2;
      const g = v.env.tick() * vol;
      L[i] += xl * g * v.gL;
      R[i] += xr * g * v.gR;
      pos += rate;
    }
    v.pos = pos;
    v.age += e - s;
    if (v.env.idle && v.age > 8) v.active = false;
  }
}

export const samplerDef: InstDef = {
  type: 'sampler',
  name: 'Sampler',
  category: 'sampler',
  description:
    'Multi-zone sampler: key and velocity ranges, root note, loop points, envelope and low-pass. Load WAV/MP3/FLAC files or a SoundFont (.sf2) into it. This is the route to recorded, studio-grade instruments.',
  range: [0, 127],
  polyphony: 'poly',
  params: P,
  presets: { Default: {}, 'Pad (slow)': { attack: 0.8, release: 1.5 }, 'Pluck (short)': { attack: 0.002, sustain: 0, decay: 0.6 } },
  create: (sr, seed) => new Sampler(sr, seed),
};
