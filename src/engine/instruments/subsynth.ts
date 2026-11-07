import { Ladder, SVF } from '../dsp/filters.ts';
import { Osc, WAVE_SAW, WAVE_SINE, WAVE_SQUARE, WAVE_TRI } from '../dsp/osc.ts';
import { ADSR } from '../dsp/env.ts';
import { Noise, Rng, TWO_PI, clamp, mtof, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

const MAXU = 7;
const WAVES = ['saw', 'square', 'triangle', 'sine'];
const waveOf = (i: number): number => [WAVE_SAW, WAVE_SQUARE, WAVE_TRI, WAVE_SINE][clamp(Math.round(i), 0, 3)];

const P: ParamDesc[] = [
  { id: 'osc1_wave', name: 'Osc 1 wave', min: 0, max: 3, def: 0, options: WAVES, group: 'Oscillators' },
  { id: 'osc1_oct', name: 'Osc 1 octave', min: -2, max: 2, def: 0, step: 1, group: 'Oscillators' },
  { id: 'osc1_fine', name: 'Osc 1 fine', min: -50, max: 50, def: 0, unit: 'cents', group: 'Oscillators' },
  { id: 'osc2_wave', name: 'Osc 2 wave', min: 0, max: 3, def: 0, options: WAVES, group: 'Oscillators' },
  { id: 'osc2_oct', name: 'Osc 2 octave', min: -2, max: 2, def: 0, step: 1, group: 'Oscillators' },
  { id: 'osc2_fine', name: 'Osc 2 fine', min: -50, max: 50, def: 7, unit: 'cents', group: 'Oscillators' },
  { id: 'osc2_level', name: 'Osc 2 level', min: 0, max: 1, def: 0.6, group: 'Oscillators' },
  { id: 'sub', name: 'Sub oscillator', min: 0, max: 1, def: 0, group: 'Oscillators' },
  { id: 'noise', name: 'Noise', min: 0, max: 1, def: 0, group: 'Oscillators' },
  { id: 'pw', name: 'Pulse width', min: 0.05, max: 0.5, def: 0.5, group: 'Oscillators' },
  { id: 'unison', name: 'Unison voices', min: 1, max: MAXU, def: 1, step: 1, group: 'Unison' },
  { id: 'detune', name: 'Unison detune', min: 0, max: 80, def: 14, unit: 'cents', group: 'Unison' },
  { id: 'spread', name: 'Stereo spread', min: 0, max: 1, def: 0.8, group: 'Unison' },
  { id: 'filter_type', name: 'Filter type', min: 0, max: 4, def: 0, options: ['Ladder 24 dB', 'Low-pass 12 dB', 'High-pass', 'Band-pass', 'Notch'], group: 'Filter' },
  { id: 'cutoff', name: 'Cutoff', min: 20, max: 18000, def: 3000, unit: 'Hz', log: true, group: 'Filter' },
  { id: 'res', name: 'Resonance', min: 0, max: 1, def: 0.2, group: 'Filter' },
  { id: 'env_amt', name: 'Filter envelope', min: -6, max: 6, def: 2, unit: 'oct', group: 'Filter' },
  { id: 'key_track', name: 'Key tracking', min: 0, max: 1, def: 0.4, group: 'Filter' },
  { id: 'vel_cutoff', name: 'Velocity to cutoff', min: 0, max: 1, def: 0.3, group: 'Filter' },
  { id: 'drive', name: 'Drive', min: 0, max: 1, def: 0, group: 'Filter' },
  { id: 'a', name: 'Amp attack', min: 0.001, max: 5, def: 0.005, unit: 's', log: true, group: 'Amp envelope' },
  { id: 'd', name: 'Amp decay', min: 0.01, max: 5, def: 0.3, unit: 's', log: true, group: 'Amp envelope' },
  { id: 's', name: 'Amp sustain', min: 0, max: 1, def: 0.7, group: 'Amp envelope' },
  { id: 'r', name: 'Amp release', min: 0.01, max: 6, def: 0.25, unit: 's', log: true, group: 'Amp envelope' },
  { id: 'fa', name: 'Filter attack', min: 0.001, max: 5, def: 0.005, unit: 's', log: true, group: 'Filter envelope' },
  { id: 'fd', name: 'Filter decay', min: 0.01, max: 5, def: 0.35, unit: 's', log: true, group: 'Filter envelope' },
  { id: 'fs', name: 'Filter sustain', min: 0, max: 1, def: 0.2, group: 'Filter envelope' },
  { id: 'fr', name: 'Filter release', min: 0.01, max: 6, def: 0.25, unit: 's', log: true, group: 'Filter envelope' },
  { id: 'lfo_rate', name: 'LFO rate', min: 0.05, max: 20, def: 5, unit: 'Hz', log: true, group: 'LFO' },
  { id: 'lfo_shape', name: 'LFO shape', min: 0, max: 3, def: 0, options: ['sine', 'triangle', 'square', 'saw'], group: 'LFO' },
  { id: 'lfo_dest', name: 'LFO target', min: 0, max: 4, def: 0, options: ['off', 'pitch', 'cutoff', 'pulse width', 'amp'], group: 'LFO' },
  { id: 'lfo_depth', name: 'LFO depth', min: 0, max: 1, def: 0.3, group: 'LFO' },
  { id: 'lfo_sync', name: 'LFO tempo sync', min: 0, max: 5, def: 0, options: ['free', '1/4', '1/8', '1/16', '1/2', '1 bar'], group: 'LFO' },
  { id: 'mono', name: 'Voice mode', min: 0, max: 1, def: 0, options: ['Poly', 'Mono legato'], group: 'Performance' },
  { id: 'glide', name: 'Glide', min: 0, max: 1000, def: 0, unit: 'ms', group: 'Performance' },
  { id: 'level', name: 'Level', min: 0, max: 1.5, def: 1, group: 'Performance' },
];

class SubVoice extends VoiceBase {
  o1: Osc[] = [];
  o2: Osc[] = [];
  sub = new Osc();
  detC = new Float64Array(MAXU);
  dt1 = new Float64Array(MAXU);
  dt2 = new Float64Array(MAXU);
  gL = new Float64Array(MAXU);
  gR = new Float64Array(MAXU);
  ladL: Ladder;
  ladR: Ladder;
  svfL: SVF;
  svfR: SVF;
  amp: ADSR;
  flt: ADSR;
  noise: Noise;
  lfoPh = 0;
  f0 = 440;
  target = 440;
  velN = 0.8;
  nU = 1;
  constructor(sr: number, seed: number) {
    super();
    for (let i = 0; i < MAXU; i++) {
      this.o1.push(new Osc());
      this.o2.push(new Osc());
    }
    this.ladL = new Ladder(sr);
    this.ladR = new Ladder(sr);
    this.svfL = new SVF(sr);
    this.svfR = new SVF(sr);
    this.amp = new ADSR(sr);
    this.flt = new ADSR(sr);
    this.noise = new Noise(seed);
  }
}

const SYNC_BEATS = [0, 1, 0.5, 0.25, 2, 4];

class SubSynth extends InstrumentBase<SubVoice> {
  readonly type = 'subsynth';
  private rng: Rng;
  constructor(sr: number, seed: number) {
    super(sr, P);
    this.rng = new Rng(seed);
    this.addVoices(16, () => new SubVoice(sr, Math.floor(this.rng.next() * 1e9)));
  }
  override noteOn(pitch: number, vel: number, art?: string): void {
    if (Math.round(this.p.mono) >= 1) {
      const cur = this.voices.find((v) => v.active && v.held);
      if (cur) {
        cur.pitch = pitch;
        cur.target = mtof(pitch);
        cur.velN = vel / 127;
        return;
      }
      for (const v of this.voices) if (v.active) this.releaseVoice(v);
    }
    super.noteOn(pitch, vel, art);
  }
  protected startVoice(v: SubVoice, pitch: number, vel: number): void {
    const p = this.p;
    v.velN = vel / 127;
    v.f0 = v.target = mtof(pitch);
    const nU = Math.max(1, Math.round(p.unison));
    v.nU = nU;
    for (let u = 0; u < nU; u++) {
      v.o1[u].reset(this.rng.next());
      v.o2[u].reset(this.rng.next());
      const x = nU === 1 ? 0 : u / (nU - 1) - 0.5;
      v.detC[u] = x * p.detune * 2;
      const a = (clamp(x * 2 * p.spread, -1, 1) + 1) * 0.25 * Math.PI;
      v.gL[u] = Math.cos(a) * Math.SQRT2;
      v.gR[u] = Math.sin(a) * Math.SQRT2;
    }
    v.sub.reset(0);
    v.lfoPh = 0;
    v.amp.setTimes(p.a, p.d, p.s, p.r);
    v.flt.setTimes(p.fa, p.fd, p.fs, p.fr);
    v.amp.reset();
    v.flt.reset();
    v.amp.gateOn();
    v.flt.gateOn();
    v.ladL.reset();
    v.ladR.reset();
    v.svfL.reset();
    v.svfR.reset();
  }
  protected releaseVoice(v: SubVoice): void {
    v.amp.gateOff();
    v.flt.gateOff();
  }
  protected renderVoice(v: SubVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const p = this.p;
    const sr = this.sr;
    const nU = v.nU;
    const w1 = waveOf(p.osc1_wave);
    const w2 = waveOf(p.osc2_wave);
    const pw = p.pw;
    const oct1 = Math.pow(2, Math.round(p.osc1_oct));
    const oct2 = Math.pow(2, Math.round(p.osc2_oct));
    const fine1 = p.osc1_fine;
    const fine2 = p.osc2_fine;
    const lvl2 = p.osc2_level;
    const subL = p.sub;
    const noiseL = p.noise;
    const ftype = Math.round(p.filter_type);
    const res = p.res;
    const norm = 0.5 / Math.sqrt(nU) / (1 + lvl2 * 0.6 + subL * 0.5);
    const glideC = p.glide > 0 ? 1 - Math.exp(-16 / (sr * p.glide * 0.001)) : 1;
    const syncB = SYNC_BEATS[Math.round(p.lfo_sync)];
    const lfoHz = syncB > 0 ? 1 / ((syncB * 60) / this.bpm) : p.lfo_rate;
    const lfoDest = Math.round(p.lfo_dest);
    const lfoShape = Math.round(p.lfo_shape);
    const lfoDepth = p.lfo_depth;
    const drive = 1 + p.drive * 6;
    const level = p.level * this.volume * this.expression * (0.35 + 0.65 * v.velN);
    let cutoff = p.cutoff;
    let pwNow = pw;
    let ampMod = 1;
    let age = v.age;
    let fenvLast = v.flt.level;
    for (let i = s; i < e; i++) {
      if (((i - s) & 15) === 0) {
        if (v.f0 !== v.target) v.f0 += (v.target - v.f0) * glideC;
        if (Math.abs(v.f0 - v.target) < 0.01) v.f0 = v.target;
        v.lfoPh += (lfoHz * 16) / sr;
        if (v.lfoPh >= 1) v.lfoPh -= 1;
        let lfo = 0;
        if (lfoDest > 0) {
          const ph = v.lfoPh;
          lfo = lfoShape === 0 ? Math.sin(TWO_PI * ph) : lfoShape === 1 ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : lfoShape === 2 ? (ph < 0.5 ? 1 : -1) : 2 * ph - 1;
          lfo *= lfoDepth;
        }
        const pitchMod = lfoDest === 1 ? lfo * 100 : 0;
        const bend = this.bend * 200;
        for (let u = 0; u < nU; u++) {
          const base = v.f0 * Math.exp(((v.detC[u] + pitchMod + bend) * Math.LN2) / 1200);
          v.dt1[u] = (base * oct1 * Math.exp((fine1 * Math.LN2) / 1200)) / sr;
          v.dt2[u] = (base * oct2 * Math.exp((fine2 * Math.LN2) / 1200)) / sr;
        }
        const fenv = fenvLast;
        const oct = p.env_amt * fenv + (lfoDest === 2 ? lfo * 3 : 0) + p.key_track * ((v.pitch - 60) / 12) + p.vel_cutoff * (v.velN - 0.6) * 2 + this.modWheel * 1.5;
        cutoff = clamp(p.cutoff * Math.pow(2, oct), 20, sr * 0.45);
        const q = 0.5 + res * res * 9;
        if (ftype === 0) {
          v.ladL.set(cutoff, res);
          v.ladR.set(cutoff, res);
        } else {
          v.svfL.set(cutoff, q);
          v.svfR.set(cutoff, q);
        }
        pwNow = lfoDest === 3 ? clamp(pw + lfo * 0.4, 0.06, 0.5) : pw;
        ampMod = lfoDest === 4 ? 1 - (0.5 + 0.5 * lfo) * lfoDepth : 1;
      }
      fenvLast = v.flt.tick();
      let sl = 0;
      let sr2 = 0;
      for (let u = 0; u < nU; u++) {
        let x = v.o1[u].tick(w1, v.dt1[u], pwNow);
        if (lvl2 > 0.001) x += v.o2[u].tick(w2, v.dt2[u], pwNow) * lvl2;
        sl += x * v.gL[u];
        sr2 += x * v.gR[u];
      }
      if (subL > 0.001) {
        const sb = v.sub.tick(WAVE_SINE, (v.dt1[0] * 0.5) / oct1) * subL;
        sl += sb;
        sr2 += sb;
      }
      if (noiseL > 0.001) {
        const n = v.noise.white() * noiseL;
        sl += n;
        sr2 += n;
      }
      sl *= norm;
      sr2 *= norm;
      let yl: number;
      let yr: number;
      if (ftype === 0) {
        yl = v.ladL.tick(sl, drive);
        yr = v.ladR.tick(sr2, drive);
      } else {
        v.svfL.tick(drive > 1 ? fastTanh(sl * drive) : sl);
        v.svfR.tick(drive > 1 ? fastTanh(sr2 * drive) : sr2);
        if (ftype === 1) { yl = v.svfL.lp; yr = v.svfR.lp; }
        else if (ftype === 2) { yl = v.svfL.hp; yr = v.svfR.hp; }
        else if (ftype === 3) { yl = v.svfL.bp; yr = v.svfR.bp; }
        else { yl = v.svfL.lp + v.svfL.hp; yr = v.svfR.lp + v.svfR.hp; }
      }
      const g = v.amp.tick() * level * ampMod * 2;
      L[i] += yl * g;
      R[i] += yr * g;
      age++;
    }
    v.age = age;
    if (v.amp.idle) v.active = false;
  }
}

export const subSynthDef: InstDef = {
  type: 'subsynth',
  name: 'Analog synth',
  category: 'synth',
  description:
    'Subtractive polysynth: two band-limited oscillators plus sub and noise, unison, ladder or state-variable filter, two ADSR envelopes, tempo-syncable LFO, glide and mono legato.',
  range: [12, 108],
  polyphony: 'poly',
  params: P,
  presets: {
    'Supersaw lead': { unison: 7, detune: 24, spread: 1, cutoff: 6500, env_amt: 1, res: 0.15, a: 0.01, d: 0.4, s: 0.75, r: 0.35, osc2_level: 0, filter_type: 'Low-pass 12 dB', mono: 'Mono legato', glide: 40 },
    'Warm pad': { osc1_wave: 'saw', osc2_wave: 'saw', osc2_fine: 12, unison: 4, detune: 18, cutoff: 1400, env_amt: 0.6, fa: 1.5, fd: 2, fs: 0.6, a: 1.1, d: 1, s: 0.85, r: 1.8, res: 0.1, key_track: 0.6 },
    'Sub bass': { osc1_wave: 'sine', osc2_wave: 'triangle', osc2_oct: -1, osc2_level: 0.4, osc2_fine: 0, cutoff: 700, env_amt: 0.5, a: 0.004, d: 0.3, s: 0.9, r: 0.12, res: 0, mono: 'Mono legato', glide: 30 },
    'Reese bass': { osc1_wave: 'saw', osc2_wave: 'saw', osc2_fine: 14, osc2_level: 0.9, unison: 3, detune: 14, cutoff: 650, res: 0.28, env_amt: 0.8, fs: 0.4, fd: 0.8, d: 0.5, s: 0.9, r: 0.15, mono: 'Mono legato', glide: 25, lfo_dest: 'cutoff', lfo_depth: 0.25, lfo_rate: 0.35 },
    'Pluck': { osc1_wave: 'saw', osc2_wave: 'square', osc2_level: 0.4, cutoff: 900, env_amt: 3.2, fd: 0.22, fs: 0, a: 0.002, d: 0.38, s: 0, r: 0.2, res: 0.18 },
    'Acid bass': { osc1_wave: 'saw', osc2_level: 0, cutoff: 480, res: 0.78, env_amt: 3.4, fd: 0.18, fs: 0.05, a: 0.002, d: 0.22, s: 0.5, r: 0.08, mono: 'Mono legato', glide: 70, drive: 0.35 },
    'Brass stab': { osc1_wave: 'saw', osc2_wave: 'saw', osc2_fine: 9, osc2_level: 0.8, unison: 3, detune: 12, cutoff: 700, env_amt: 3, fa: 0.04, fd: 0.35, fs: 0.3, a: 0.012, d: 0.4, s: 0.6, r: 0.18, res: 0.1 },
    'Analog strings': { osc1_wave: 'saw', osc2_wave: 'saw', osc2_fine: 8, unison: 5, detune: 20, spread: 1, cutoff: 3200, env_amt: 0, key_track: 0.5, a: 0.35, d: 0.5, s: 0.9, r: 0.8, lfo_dest: 'pitch', lfo_depth: 0.08, lfo_rate: 5.2 },
    'Soft lead': { osc1_wave: 'triangle', osc2_wave: 'sine', osc2_oct: 1, osc2_level: 0.35, cutoff: 3800, env_amt: 0.8, res: 0.05, a: 0.02, d: 0.3, s: 0.8, r: 0.3, mono: 'Mono legato', glide: 60, lfo_dest: 'pitch', lfo_depth: 0.1, lfo_rate: 5.4 },
    'Wobble bass': { osc1_wave: 'saw', osc2_wave: 'square', osc2_level: 0.5, osc2_oct: -1, cutoff: 500, res: 0.55, env_amt: 0, lfo_dest: 'cutoff', lfo_depth: 0.9, lfo_sync: '1/8', lfo_shape: 'sine', s: 1, r: 0.1, mono: 'Mono legato', glide: 20, drive: 0.4 },
    'Bell arp': { osc1_wave: 'sine', osc2_wave: 'triangle', osc2_oct: 2, osc2_level: 0.35, cutoff: 8000, env_amt: 0, a: 0.002, d: 0.9, s: 0, r: 0.6, res: 0 },
    'Sequence pluck bass': { osc1_wave: 'square', osc2_wave: 'saw', osc2_level: 0.5, osc2_oct: -1, pw: 0.35, cutoff: 600, env_amt: 2.6, fd: 0.16, fs: 0.05, a: 0.002, d: 0.24, s: 0.1, r: 0.1, res: 0.35, mono: 'Mono legato' },
  },
  create: (sr, seed) => new SubSynth(sr, seed),
};
