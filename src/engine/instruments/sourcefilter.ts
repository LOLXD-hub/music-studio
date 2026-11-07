import { Biquad, SVF } from '../dsp/filters.ts';
import { Osc, WAVE_SAW, WAVE_SINE, WAVE_SQUARE, WAVE_TRI } from '../dsp/osc.ts';
import { ADSR } from '../dsp/env.ts';
import { Noise, Rng, TWO_PI, clamp, mtof, fastTanh } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';
import { KSString } from './pluck.ts';

const MAXU = 7;
const WAVES = ['saw', 'square', 'pulse', 'triangle', 'sine'];
const waveId = (i: number): number => [WAVE_SAW, WAVE_SQUARE, WAVE_SQUARE, WAVE_TRI, WAVE_SINE][clamp(Math.round(i), 0, 4)];

type BodyDef = [('peak' | 'highshelf' | 'lowshelf'), number, number, number][];

/** Fixed body / bell / throat resonances, applied as series peaking filters to the summed voices. */
const BODIES: Record<string, BodyDef> = {
  none: [],
  violin: [['peak', 290, 3, 4], ['peak', 460, 3, 3.5], ['peak', 590, 3, 2.5], ['peak', 1250, 1.5, 2], ['peak', 2900, 1.2, 4], ['peak', 4800, 1, 2]],
  viola: [['peak', 220, 3, 4], ['peak', 350, 3, 3.5], ['peak', 600, 2, 2.5], ['peak', 2200, 1.3, 3.5]],
  cello: [['peak', 100, 3, 4], ['peak', 185, 3, 3.5], ['peak', 300, 2.5, 2.5], ['peak', 520, 2, 2.5], ['peak', 1800, 1.3, 3]],
  bass: [['peak', 62, 3, 3], ['peak', 105, 3, 3.5], ['peak', 220, 2, 2.5], ['peak', 700, 1.5, 2]],
  trumpet: [['peak', 1100, 1.6, 4], ['peak', 2400, 1.3, 4.5], ['peak', 3700, 1, 3]],
  horn: [['peak', 350, 1.8, 4], ['peak', 900, 1.5, 2.5], ['highshelf', 3500, 0.7, -4]],
  trombone: [['peak', 550, 1.8, 5], ['peak', 1250, 1.4, 3], ['highshelf', 4500, 0.7, -3]],
  tuba: [['peak', 190, 2, 5], ['peak', 480, 1.8, 3.5], ['highshelf', 2500, 0.7, -6]],
  flute: [['peak', 650, 1.8, 3], ['peak', 2800, 1.1, 2], ['highshelf', 7000, 0.7, -2]],
  clarinet: [['peak', 420, 2.2, 4], ['peak', 1700, 1.3, 4], ['highshelf', 5000, 0.7, -4]],
  oboe: [['peak', 1100, 3.5, 7], ['peak', 2900, 2.5, 6], ['peak', 4600, 1, 2]],
  sax: [['peak', 700, 2.2, 4], ['peak', 1700, 1.6, 4], ['peak', 3200, 1.1, 2]],
  bassoon: [['peak', 450, 3, 6], ['peak', 1200, 2, 4], ['highshelf', 3500, 0.7, -5]],
  choir: [],
  pad: [],
};
const BODY_NAMES = Object.keys(BODIES);

// Vowel formants (Hz) for a mid-range voice: a, e, i, o, u
const VOWELS: [number, number, number][] = [
  [800, 1150, 2900], [400, 2000, 2800], [300, 2300, 3000], [450, 800, 2830], [325, 700, 2530],
];

const PARAMS: ParamDesc[] = [
  { id: 'wave_a', name: 'Wave A', min: 0, max: 4, def: 0, options: WAVES, group: 'Source' },
  { id: 'wave_b', name: 'Wave B', min: 0, max: 4, def: 1, options: WAVES, group: 'Source' },
  { id: 'mix_b', name: 'Wave B mix', min: 0, max: 1, def: 0, group: 'Source' },
  { id: 'pw', name: 'Pulse width', min: 0.05, max: 0.5, def: 0.5, group: 'Source' },
  { id: 'unison', name: 'Unison voices', min: 1, max: MAXU, def: 3, step: 1, group: 'Source' },
  { id: 'detune', name: 'Detune spread', min: 0, max: 60, def: 10, unit: 'cents', group: 'Source' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.7, group: 'Source' },
  { id: 'lp_ratio', name: 'Brightness (x f0)', min: 1, max: 60, def: 9, log: true, group: 'Filter' },
  { id: 'lp_min', name: 'Min cutoff', min: 80, max: 8000, def: 700, unit: 'Hz', log: true, group: 'Filter' },
  { id: 'lp_vel', name: 'Velocity to brightness', min: 0, max: 2, def: 0.8, group: 'Filter' },
  { id: 'lp_env', name: 'Dynamics to brightness', min: 0, max: 4, def: 1.2, unit: 'oct', group: 'Filter' },
  { id: 'res', name: 'Resonance', min: 0.5, max: 8, def: 0.8, group: 'Filter' },
  { id: 'bright', name: 'Tone offset', min: -2, max: 2, def: 0, unit: 'oct', group: 'Filter' },
  { id: 'attack', name: 'Attack', min: 0.002, max: 3, def: 0.12, unit: 's', log: true, group: 'Envelope' },
  { id: 'decay', name: 'Decay', min: 0.02, max: 3, def: 0.3, unit: 's', log: true, group: 'Envelope' },
  { id: 'sustain', name: 'Sustain', min: 0, max: 1, def: 0.9, group: 'Envelope' },
  { id: 'release', name: 'Release', min: 0.02, max: 4, def: 0.3, unit: 's', log: true, group: 'Envelope' },
  { id: 'vel_attack', name: 'Velocity shortens attack', min: 0, max: 1, def: 0.6, group: 'Envelope' },
  { id: 'vib_rate', name: 'Vibrato rate', min: 2, max: 9, def: 5.3, unit: 'Hz', group: 'Vibrato' },
  { id: 'vib_depth', name: 'Vibrato depth', min: 0, max: 60, def: 12, unit: 'cents', group: 'Vibrato' },
  { id: 'vib_delay', name: 'Vibrato delay', min: 0, max: 2, def: 0.3, unit: 's', group: 'Vibrato' },
  { id: 'vib_fade', name: 'Vibrato fade-in', min: 0.05, max: 2, def: 0.5, unit: 's', group: 'Vibrato' },
  { id: 'noise', name: 'Breath / bow noise', min: 0, max: 1, def: 0.05, group: 'Noise' },
  { id: 'noise_hz', name: 'Noise colour', min: 300, max: 12000, def: 3500, unit: 'Hz', log: true, group: 'Noise' },
  { id: 'scoop', name: 'Pitch scoop', min: -100, max: 0, def: 0, unit: 'cents', group: 'Pitch' },
  { id: 'scoop_time', name: 'Scoop time', min: 0.01, max: 0.3, def: 0.06, unit: 's', group: 'Pitch' },
  { id: 'mono', name: 'Mono legato', min: 0, max: 1, def: 0, options: ['Poly', 'Mono'], group: 'Pitch' },
  { id: 'glide', name: 'Legato glide', min: 0, max: 400, def: 60, unit: 'ms', group: 'Pitch' },
  { id: 'body', name: 'Body / bell model', min: 0, max: BODY_NAMES.length - 1, def: 0, options: BODY_NAMES, group: 'Body' },
  { id: 'body_amt', name: 'Body amount', min: 0, max: 1.6, def: 1, group: 'Body' },
  { id: 'vowel', name: 'Vowel (a e i o u)', min: 0, max: 4, def: 0, group: 'Body' },
  { id: 'formant_shift', name: 'Formant shift', min: 0.6, max: 1.6, def: 1, group: 'Body' },
  { id: 'drive', name: 'Drive', min: 0, max: 1, def: 0, group: 'Body' },
];

class SFVoice extends VoiceBase {
  oscA: Osc[] = [];
  oscB: Osc[] = [];
  detC = new Float64Array(MAXU);
  vibPh = new Float64Array(MAXU);
  vibMul = new Float64Array(MAXU);
  dt = new Float64Array(MAXU);
  gL = new Float64Array(MAXU);
  gR = new Float64Array(MAXU);
  lp: SVF;
  lp2: SVF;
  nbp: SVF;
  env: ADSR;
  noise: Noise;
  ks: KSString;
  pizz = false;
  trem = false;
  tremPh = 0;
  f0 = 440;
  target = 440;
  velN = 0.7;
  cutoff = 2000;
  chiff = 0;
  nU = 1;
  art = '';
  constructor(sr: number, seed: number) {
    super();
    for (let i = 0; i < MAXU; i++) {
      this.oscA.push(new Osc());
      this.oscB.push(new Osc());
    }
    this.lp = new SVF(sr);
    this.lp2 = new SVF(sr);
    this.nbp = new SVF(sr);
    this.env = new ADSR(sr);
    this.noise = new Noise(seed);
    this.ks = new KSString(Math.ceil(sr / 28) + 8);
  }
}

class SourceFilter extends InstrumentBase<SFVoice> {
  readonly type = 'wind_string';
  private rng: Rng;
  private scratchL = new Float32Array(16384);
  private scratchR = new Float32Array(16384);
  private bodyL: Biquad[] = [];
  private bodyR: Biquad[] = [];
  private exprS = 1;
  constructor(sr: number, seed: number, voices = 12) {
    super(sr, PARAMS);
    this.rng = new Rng(seed);
    this.addVoices(voices, () => new SFVoice(sr, Math.floor(this.rng.next() * 1e9)));
    this.buildBody();
  }
  protected override onParam(id: string): void {
    if (id === 'body' || id === 'body_amt' || id === 'vowel' || id === 'formant_shift') this.buildBody();
  }
  private buildBody(): void {
    const name = BODY_NAMES[Math.round(this.p.body)];
    let defs: BodyDef = BODIES[name];
    if (name === 'choir') {
      const v = clamp(this.p.vowel, 0, 4);
      const i = Math.min(3, Math.floor(v));
      const t = v - i;
      const fs = this.p.formant_shift;
      const a = VOWELS[i];
      const b = VOWELS[i + 1];
      const f = [0, 1, 2].map((k) => (a[k] + (b[k] - a[k]) * t) * fs);
      defs = [['peak', f[0], 5, 11], ['peak', f[1], 6, 8], ['peak', f[2], 6, 6], ['highshelf', 6000, 0.7, -8]];
    }
    this.bodyL = [];
    this.bodyR = [];
    for (const [t, f, q, g] of defs) {
      const a = new Biquad();
      a.set(t, f, q, g * this.p.body_amt, this.sr);
      const b = new Biquad();
      b.set(t, f, q, g * this.p.body_amt, this.sr);
      this.bodyL.push(a);
      this.bodyR.push(b);
    }
  }
  override noteOn(pitch: number, vel: number, art?: string): void {
    if (Math.round(this.p.mono) >= 1) {
      const cur = this.voices.find((v) => v.active && v.held);
      if (cur && !cur.pizz) {
        // legato: glide to the new pitch, no retrigger
        cur.pitch = pitch;
        cur.target = mtof(pitch);
        cur.velN = vel / 127;
        return;
      }
      for (const v of this.voices) if (v.active && v !== cur) this.releaseVoice(v);
    }
    super.noteOn(pitch, vel, art);
  }
  protected startVoice(v: SFVoice, pitch: number, vel: number, art?: string): void {
    const p = this.p;
    const velN = vel / 127;
    v.velN = velN;
    v.art = art ?? '';
    v.pizz = art === 'pizz';
    v.trem = art === 'trem';
    v.tremPh = this.rng.next();
    v.f0 = v.target = mtof(pitch);
    const nU = Math.max(1, Math.round(p.unison));
    v.nU = nU;
    for (let u = 0; u < nU; u++) {
      v.oscA[u].reset(this.rng.next());
      v.oscB[u].reset(this.rng.next());
      const x = nU === 1 ? 0 : u / (nU - 1) - 0.5;
      v.detC[u] = x * p.detune * (1 + (this.rng.next() - 0.5) * 0.3);
      v.vibPh[u] = this.rng.next() * TWO_PI;
      v.vibMul[u] = 1 + (this.rng.next() - 0.5) * 0.14;
      const pan = nU === 1 ? 0 : x * 2 * p.stereo;
      const a = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
      v.gL[u] = Math.cos(a) * Math.SQRT2;
      v.gR[u] = Math.sin(a) * Math.SQRT2;
    }
    let atk = p.attack * (1.5 - 1.0 * velN * p.vel_attack);
    let dec = p.decay;
    let sus = p.sustain;
    if (art === 'stac') {
      atk *= 0.45;
      dec = 0.14;
      sus = 0;
    } else if (art === 'acc') atk *= 0.35;
    if (art === 'pizz') v.env.setTimes(0.001, 1, 1, 0.08);
    else v.env.setTimes(Math.max(0.002, atk), dec, sus, p.release);
    v.env.reset();
    v.env.gateOn();
    v.lp.reset();
    v.lp2.reset();
    v.chiff = 1;
    if (v.pizz) {
      const f0 = v.f0;
      const t60 = clamp(1.6 * Math.exp(-0.02 * (pitch - 40)), 0.25, 1.8);
      v.ks.pluck(f0, this.sr, t60, 0.45, 0.18, 0.35 + velN * 0.4, 0.2 + velN * 0.8, v.noise);
    }
  }
  protected releaseVoice(v: SFVoice): void {
    if (v.pizz) {
      v.env.setTimes(0.002, 0.1, 0.0, 0.08);
    }
    v.env.gateOff();
  }
  protected renderVoice(v: SFVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const p = this.p;
    const sr = this.sr;
    const nU = v.nU;
    const waveA = waveId(p.wave_a);
    const waveB = waveId(p.wave_b);
    const pwA = Math.round(p.wave_a) === 2 ? p.pw : 0.5;
    const pwB = Math.round(p.wave_b) === 2 ? p.pw : 0.5;
    const mixB = p.mix_b;
    const norm = 1 / Math.sqrt(nU);
    const vol = this.volume;
    const ctl = 16;
    const glideC = p.glide > 0 ? 1 - Math.exp(-ctl / (sr * p.glide * 0.001)) : 1;
    const nz = p.noise;
    let acc = 0;
    const bright = Math.pow(2, p.bright);
    let vibAmt = 0;
    let amp = 0;
    let cutoffScale = 1;
    let age = v.age;
    for (let i = s; i < e; i++) {
      if (((i - s) & (ctl - 1)) === 0) {
        const tSec = age / sr;
        // glide towards the target pitch (legato)
        if (v.f0 !== v.target) v.f0 += (v.target - v.f0) * glideC;
        if (Math.abs(v.f0 - v.target) < 0.01) v.f0 = v.target;
        const vibEnv = clamp((tSec - p.vib_delay) / Math.max(0.01, p.vib_fade), 0, 1);
        vibAmt = (p.vib_depth * (0.4 + this.modWheel * 1.6) * vibEnv);
        const scoop = p.scoop * Math.exp(-tSec / p.scoop_time);
        const base = scoop + this.bend * 200;
        for (let u = 0; u < nU; u++) {
          v.vibPh[u] += (TWO_PI * p.vib_rate * v.vibMul[u] * ctl) / sr;
          if (v.vibPh[u] > TWO_PI) v.vibPh[u] -= TWO_PI;
          const cents = v.detC[u] + base + Math.sin(v.vibPh[u]) * vibAmt;
          v.dt[u] = (v.f0 * Math.exp((cents * Math.LN2) / 1200)) / sr;
        }
        // brightness: follows velocity, expression and the envelope level like a real instrument
        const lvl = Math.max(0.02, v.env.level);
        const oct = p.lp_vel * (v.velN * 2 - 1) + p.lp_env * (lvl - 1) + (this.exprS - 1) * 1.4 + Math.log2(bright);
        cutoffScale = Math.pow(2, oct);
        const fc = clamp(Math.max(p.lp_min, v.f0 * p.lp_ratio) * cutoffScale, 60, sr * 0.45);
        v.lp.set(fc, p.res);
        v.lp2.set(fc, p.res);
        v.nbp.set(clamp(p.noise_hz * (0.6 + 0.4 * cutoffScale), 200, sr * 0.45), 0.9);
      }
      let xl = 0;
      let xr = 0;
      if (v.pizz) {
        xl = xr = v.ks.tick() * v.env.tick();
      } else {
        let sl = 0;
        let sr2 = 0;
        for (let u = 0; u < nU; u++) {
          let val = v.oscA[u].tick(waveA, v.dt[u], pwA);
          if (mixB > 0.001) {
            const b = v.oscB[u].tick(waveB, v.dt[u] * 1.0005, pwB);
            val = val * (1 - mixB) + b * mixB;
          }
          sl += val * v.gL[u];
          sr2 += val * v.gR[u];
        }
        sl *= norm;
        sr2 *= norm;
        const envLvl = v.env.tick();
        amp = envLvl;
        let n = 0;
        if (nz > 0.001) {
          v.nbp.tick(v.noise.white());
          // breath/bow noise follows the envelope, with a short burst at the onset
          v.chiff *= 0.9992;
          n = v.nbp.bp * nz * (0.5 + 2.2 * v.chiff * v.velN) * 0.12 * Math.sqrt(Math.min(1, envLvl + 0.1));
        }
        v.lp.tick(sl * 0.5 + n);
        v.lp2.tick(sr2 * 0.5 + n);
        xl = v.lp.lp * 2 * amp;
        xr = v.lp2.lp * 2 * amp;
        if (v.trem) {
          v.tremPh += 9.6 / sr + 0.00004 * v.noise.white();
          const tg = 0.5 + 0.5 * Math.sin(TWO_PI * v.tremPh);
          xl *= tg;
          xr *= tg;
        }
      }
      const lvlOut = vol * this.exprS * (0.3 + 0.7 * Math.pow(v.velN, 1.2)) * 0.5;
      const yl = xl * lvlOut;
      const yr = xr * lvlOut;
      acc += yl * yl;
      L[i] += yl;
      R[i] += yr;
      age++;
    }
    v.age = age;
    if (v.env.idle && age > 8) v.active = false;
    else if (v.pizz && age > sr * 0.05 && acc / Math.max(1, e - s) < 1e-11) v.active = false;
  }
  override process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    const n = e - s;
    this.exprS += (this.expression - this.exprS) * (1 - Math.exp(-n / (this.sr * 0.03)));
    const sl = this.scratchL;
    const sr_ = this.scratchR;
    sl.fill(0, s, e);
    sr_.fill(0, s, e);
    for (const v of this.voices) if (v.active) this.renderVoice(v, sl, sr_, s, e);
    for (const f of this.bodyL) f.run(sl, s, e);
    for (const f of this.bodyR) f.run(sr_, s, e);
    const drive = this.p.drive;
    for (let i = s; i < e; i++) {
      let l = sl[i];
      let r = sr_[i];
      if (drive > 0.01) {
        const g = 1 + drive * 8;
        l = fastTanh(l * g) / Math.sqrt(g);
        r = fastTanh(r * g) / Math.sqrt(g);
      }
      L[i] += l;
      R[i] += r;
    }
  }
  override reset(): void {
    super.reset();
    for (const v of this.voices) v.env.reset();
    for (const f of [...this.bodyL, ...this.bodyR]) f.reset();
  }
}

const strSolo = { mono: 1, glide: 55, unison: 2, detune: 5, stereo: 0.25, sustain: 0.95, release: 0.22, vel_attack: 0.7, lp_vel: 0.9 };
const strSect = { mono: 0, unison: 6, detune: 26, stereo: 0.85, vib_depth: 10, vib_delay: 0.45, vib_fade: 0.7, attack: 0.2, release: 0.4, sustain: 0.96, noise: 0.04, lp_vel: 0.9 };
const brass = { wave_a: 'saw', wave_b: 'pulse', mix_b: 0.25, pw: 0.3, mono: 1, glide: 35, lp_vel: 1.4, lp_env: 2.4, sustain: 0.88, decay: 0.12, vib_depth: 7, vib_delay: 0.7, noise: 0.025, noise_hz: 3200, scoop: -35, scoop_time: 0.05 };

export const windStringDef: InstDef = {
  type: 'wind_string',
  name: 'Bowed, brass, wind & voice',
  category: 'strings',
  description:
    'Source-filter model for sustained instruments: bowed strings (solo and sections), brass, woodwinds, choir and pads. Brightness follows dynamics, vibrato fades in, solo presets play legato. Articulations: "stac", "pizz", "trem", "acc". Expression (CC11) and mod wheel (CC1, vibrato) are live.',
  range: [28, 108],
  polyphony: 'poly',
  params: PARAMS,
  articulations: ['stac', 'pizz', 'trem', 'acc'],
  presets: {
    'Violin (solo)': { ...strSolo, lp_ratio: 10, lp_min: 1800, attack: 0.09, vib_rate: 5.9, vib_depth: 22, vib_delay: 0.35, noise: 0.06, noise_hz: 4500, body: 'violin' },
    'Viola (solo)': { ...strSolo, lp_ratio: 9, lp_min: 1200, attack: 0.1, vib_rate: 5.5, vib_depth: 20, noise: 0.06, noise_hz: 3800, body: 'viola' },
    'Cello (solo)': { ...strSolo, lp_ratio: 8, lp_min: 700, attack: 0.12, vib_rate: 5.2, vib_depth: 18, noise: 0.07, noise_hz: 3000, body: 'cello' },
    'Double bass (solo)': { ...strSolo, lp_ratio: 7, lp_min: 380, attack: 0.15, vib_rate: 4.8, vib_depth: 10, noise: 0.07, noise_hz: 2200, body: 'bass' },
    'Violins (section)': { ...strSect, lp_ratio: 9, lp_min: 1700, body: 'violin' },
    'Violas (section)': { ...strSect, lp_ratio: 8, lp_min: 1100, body: 'viola' },
    'Cellos (section)': { ...strSect, lp_ratio: 7, lp_min: 650, unison: 5, body: 'cello' },
    'Basses (section)': { ...strSect, lp_ratio: 6, lp_min: 330, unison: 4, attack: 0.25, body: 'bass' },
    'String ensemble': { ...strSect, lp_ratio: 8, lp_min: 1100, unison: 7, detune: 34, body: 'violin', body_amt: 0.6 },
    'Trumpet': { ...brass, lp_ratio: 14, lp_min: 1300, attack: 0.045, release: 0.12, body: 'trumpet' },
    'French horn': { ...brass, lp_ratio: 6, lp_min: 520, attack: 0.085, release: 0.25, lp_env: 2.8, scoop: -28, body: 'horn' },
    'Trombone': { ...brass, lp_ratio: 8, lp_min: 600, attack: 0.07, release: 0.18, body: 'trombone', scoop: -45 },
    'Tuba': { ...brass, lp_ratio: 5, lp_min: 240, attack: 0.1, release: 0.2, vib_depth: 4, body: 'tuba', scoop: -20 },
    'Brass section': { ...brass, mono: 0, unison: 5, detune: 14, stereo: 0.6, lp_ratio: 11, lp_min: 1000, attack: 0.06, release: 0.18, body: 'trumpet', body_amt: 0.8 },
    'Flute': { wave_a: 'triangle', wave_b: 'sine', mix_b: 0.4, unison: 1, mono: 1, glide: 40, lp_ratio: 5, lp_min: 1800, lp_env: 1.4, attack: 0.07, release: 0.12, sustain: 0.95, vib_rate: 5.1, vib_depth: 14, vib_delay: 0.5, noise: 0.5, noise_hz: 5200, body: 'flute', stereo: 0 },
    'Clarinet': { wave_a: 'square', mix_b: 0, unison: 1, mono: 1, glide: 30, lp_ratio: 5, lp_min: 900, lp_env: 1.6, attack: 0.05, release: 0.1, sustain: 0.95, vib_depth: 6, vib_delay: 0.8, noise: 0.15, noise_hz: 3500, body: 'clarinet', stereo: 0 },
    'Oboe': { wave_a: 'saw', wave_b: 'pulse', mix_b: 0.3, pw: 0.2, unison: 1, mono: 1, glide: 30, lp_ratio: 10, lp_min: 1500, attack: 0.04, release: 0.1, vib_rate: 5.6, vib_depth: 16, vib_delay: 0.4, noise: 0.12, noise_hz: 4000, body: 'oboe', stereo: 0 },
    'Alto sax': { wave_a: 'saw', wave_b: 'pulse', mix_b: 0.35, pw: 0.35, unison: 1, mono: 1, glide: 40, lp_ratio: 9, lp_min: 1100, lp_env: 1.8, attack: 0.05, release: 0.14, vib_depth: 14, vib_delay: 0.5, noise: 0.14, noise_hz: 3600, scoop: -30, body: 'sax', stereo: 0 },
    'Bassoon': { wave_a: 'saw', unison: 1, mono: 1, glide: 40, lp_ratio: 6, lp_min: 500, attack: 0.07, release: 0.14, vib_depth: 8, vib_delay: 0.6, noise: 0.1, noise_hz: 2200, body: 'bassoon', stereo: 0 },
    'Choir (ahh)': { wave_a: 'saw', unison: 6, detune: 22, stereo: 0.9, mono: 0, lp_ratio: 12, lp_min: 1800, lp_env: 0.6, attack: 0.35, release: 0.7, sustain: 1, vib_depth: 9, vib_delay: 0.6, noise: 0.15, noise_hz: 2800, body: 'choir', vowel: 0 },
    'Choir (ooh)': { wave_a: 'saw', unison: 6, detune: 22, stereo: 0.9, mono: 0, lp_ratio: 10, lp_min: 1400, lp_env: 0.6, attack: 0.4, release: 0.8, sustain: 1, vib_depth: 9, vib_delay: 0.6, noise: 0.12, noise_hz: 2400, body: 'choir', vowel: 3.4 },
    'Soprano (solo)': { wave_a: 'saw', unison: 2, detune: 6, stereo: 0.2, mono: 1, glide: 70, lp_ratio: 10, lp_min: 2200, attack: 0.1, release: 0.3, vib_rate: 5.8, vib_depth: 24, vib_delay: 0.4, noise: 0.15, noise_hz: 3600, body: 'choir', vowel: 0, formant_shift: 1.35 },
    'Warm analog pad': { wave_a: 'saw', wave_b: 'square', mix_b: 0.25, unison: 6, detune: 24, stereo: 1, lp_ratio: 6, lp_min: 500, lp_env: 0, lp_vel: 0.2, attack: 0.9, release: 1.6, sustain: 1, vib_depth: 4, vib_delay: 0.2, noise: 0, body: 'pad' },
    'Glass pad': { wave_a: 'triangle', wave_b: 'sine', mix_b: 0.5, unison: 5, detune: 14, stereo: 1, lp_ratio: 16, lp_min: 2500, lp_env: 0.4, attack: 1.2, release: 2.4, sustain: 1, vib_depth: 6, vib_delay: 0.2, noise: 0.02, body: 'pad' },
  },
  create: (sr, seed) => new SourceFilter(sr, seed),
};
