import { ADSR } from '../dsp/env.ts';
import { TWO_PI, clamp, mtof, panGains } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';
import { InstrumentBase, VoiceBase } from './base.ts';
import type { InstDef } from './base.ts';

// Algorithms: for each operator (1..4) the list of modulators feeding it, and which operators reach the output.
const ALGOS: { name: string; mods: number[][]; out: number[] }[] = [
  { name: 'Serial 4>3>2>1', mods: [[2], [3], [4], []], out: [1] },
  { name: 'Two stacks (4>3, 2>1)', mods: [[2], [], [4], []], out: [1, 3] },
  { name: 'Y (4>3>1, 2>1)', mods: [[2, 3], [], [4], []], out: [1] },
  { name: 'Triple mod (2,3,4>1)', mods: [[2, 3, 4], [], [], []], out: [1] },
  { name: 'Chain + solo (4>3>2, 1)', mods: [[], [3], [4], []], out: [1, 2] },
  { name: 'Four carriers', mods: [[], [], [], []], out: [1, 2, 3, 4] },
  { name: 'Chain 3>2>1 + solo 4', mods: [[2], [3], [], []], out: [1, 4] },
  { name: 'One mod, three carriers', mods: [[4], [4], [4], []], out: [1, 2, 3] },
];

const P: ParamDesc[] = [
  { id: 'alg', name: 'Algorithm', min: 0, max: ALGOS.length - 1, def: 1, options: ALGOS.map((a) => a.name), group: 'Global' },
  { id: 'fb', name: 'Operator 4 feedback', min: 0, max: 1, def: 0, group: 'Global' },
  { id: 'stereo', name: 'Stereo width', min: 0, max: 1, def: 0.3, group: 'Global' },
  { id: 'vel_sens', name: 'Velocity sensitivity', min: 0, max: 1, def: 0.7, group: 'Global' },
];
const DEF_OP = [
  { ratio: 1, level: 1, a: 0.002, d: 1.2, s: 0.0, r: 0.25 },
  { ratio: 1, level: 0.4, a: 0.002, d: 0.8, s: 0.0, r: 0.2 },
  { ratio: 1, level: 0.5, a: 0.002, d: 0.6, s: 0.0, r: 0.2 },
  { ratio: 14, level: 0.3, a: 0.001, d: 0.1, s: 0.0, r: 0.1 },
];
for (let o = 1; o <= 4; o++) {
  const d = DEF_OP[o - 1];
  P.push(
    { id: `o${o}_ratio`, name: `Op ${o} ratio`, min: 0.25, max: 16, def: d.ratio, group: `Operator ${o}` },
    { id: `o${o}_level`, name: `Op ${o} level / index`, min: 0, max: 1, def: d.level, group: `Operator ${o}` },
    { id: `o${o}_detune`, name: `Op ${o} detune`, min: -50, max: 50, def: 0, unit: 'cents', group: `Operator ${o}` },
    { id: `o${o}_a`, name: `Op ${o} attack`, min: 0.001, max: 2, def: d.a, unit: 's', log: true, group: `Operator ${o}` },
    { id: `o${o}_d`, name: `Op ${o} decay`, min: 0.01, max: 8, def: d.d, unit: 's', log: true, group: `Operator ${o}` },
    { id: `o${o}_s`, name: `Op ${o} sustain`, min: 0, max: 1, def: d.s, group: `Operator ${o}` },
    { id: `o${o}_r`, name: `Op ${o} release`, min: 0.01, max: 4, def: d.r, unit: 's', log: true, group: `Operator ${o}` },
    { id: `o${o}_vel`, name: `Op ${o} velocity`, min: 0, max: 1, def: o === 1 ? 0.3 : 0.8, group: `Operator ${o}` },
  );
}

class FMVoice extends VoiceBase {
  ph = new Float64Array(4);
  env: ADSR[];
  out = new Float64Array(4);
  fbPrev = 0;
  velN = 0.7;
  gL = 1;
  gR = 1;
  constructor(sr: number) {
    super();
    this.env = [new ADSR(sr), new ADSR(sr), new ADSR(sr), new ADSR(sr)];
  }
}

class FM extends InstrumentBase<FMVoice> {
  readonly type = 'fm';
  constructor(sr: number, _seed: number) {
    super(sr, P);
    this.addVoices(14, () => new FMVoice(sr));
  }
  protected startVoice(v: FMVoice, pitch: number, vel: number): void {
    const p = this.p;
    v.velN = vel / 127;
    v.ph.fill(0);
    v.fbPrev = 0;
    for (let o = 0; o < 4; o++) {
      const n = o + 1;
      v.env[o].setTimes(p[`o${n}_a`], p[`o${n}_d`], p[`o${n}_s`], p[`o${n}_r`]);
      v.env[o].reset();
      v.env[o].gateOn();
    }
    const [pl, pr] = panGains(clamp(((pitch - 60) / 48) * p.stereo, -1, 1));
    v.gL = pl * Math.SQRT2;
    v.gR = pr * Math.SQRT2;
  }
  protected releaseVoice(v: FMVoice): void {
    for (const e of v.env) e.gateOff();
  }
  protected renderVoice(v: FMVoice, L: Float32Array, R: Float32Array, s: number, e: number): void {
    const p = this.p;
    const alg = ALGOS[Math.round(p.alg)];
    const f0 = mtof(v.pitch) * Math.pow(2, (this.bend * 2) / 12);
    const inc: number[] = [];
    const lev: number[] = [];
    const isCar: boolean[] = [false, false, false, false];
    for (const c of alg.out) isCar[c - 1] = true;
    for (let o = 0; o < 4; o++) {
      const n = o + 1;
      inc.push((TWO_PI * f0 * p[`o${n}_ratio`] * Math.pow(2, p[`o${n}_detune`] / 1200)) / this.sr);
      const vs = p.vel_sens * p[`o${n}_vel`];
      const scale = 1 - vs + vs * v.velN;
      lev.push(p[`o${n}_level`] * scale * (isCar[o] ? 1 : 5.5));
    }
    const fb = p.fb * 3;
    const vol = this.volume * this.expression * 0.3;
    let idleAll = true;
    for (let i = s; i < e; i++) {
      // evaluate operators from 4 down to 1 so modulators come first
      for (let o = 3; o >= 0; o--) {
        let mod = 0;
        const list = alg.mods[o];
        for (let k = 0; k < list.length; k++) mod += v.out[list[k] - 1];
        if (o === 3) mod += v.fbPrev * fb;
        v.ph[o] += inc[o];
        if (v.ph[o] > TWO_PI) v.ph[o] -= TWO_PI;
        const y = Math.sin(v.ph[o] + mod) * v.env[o].tick() * lev[o];
        v.out[o] = y;
        if (o === 3) v.fbPrev = y;
      }
      let sum = 0;
      for (let k = 0; k < alg.out.length; k++) sum += v.out[alg.out[k] - 1];
      const y = sum * vol;
      L[i] += y * v.gL;
      R[i] += y * v.gR;
    }
    v.age += e - s;
    for (const c of alg.out) if (!v.env[c - 1].idle) idleAll = false;
    if (idleAll) v.active = false;
  }
}

export const fmDef: InstDef = {
  type: 'fm',
  name: 'FM synth (4-op)',
  category: 'synth',
  description: 'Four-operator FM with eight algorithms, per-operator envelopes and velocity sensitivity. Electric pianos, bells, bass and brass.',
  range: [24, 108],
  polyphony: 'poly',
  params: P,
  presets: {
    'FM electric piano': {
      alg: 1, o1_ratio: 1, o1_level: 0.9, o1_d: 2.6, o1_s: 0, o1_r: 0.3, o2_ratio: 1, o2_level: 0.3, o2_d: 1.4,
      o3_ratio: 1, o3_level: 0.35, o3_d: 0.9, o3_r: 0.25, o4_ratio: 14, o4_level: 0.36, o4_d: 0.07, o4_vel: 1, o2_vel: 0.9,
    },
    'FM tine piano (bright)': {
      alg: 1, o1_level: 0.9, o1_d: 2.2, o2_ratio: 1, o2_level: 0.45, o2_d: 1.1, o3_ratio: 1, o3_level: 0.3, o3_d: 0.7,
      o4_ratio: 7, o4_level: 0.5, o4_d: 0.12, o4_vel: 1,
    },
    'FM bell': {
      alg: 0, o1_ratio: 1, o1_level: 0.9, o1_d: 4, o1_r: 1.5, o2_ratio: 3.5, o2_level: 0.35, o2_d: 3, o3_ratio: 1.41, o3_level: 0.25, o3_d: 2, o4_ratio: 5.19, o4_level: 0.2, o4_d: 1.5,
    },
    'FM bass': {
      alg: 2, o1_ratio: 1, o1_level: 1, o1_d: 0.5, o1_s: 0.6, o1_r: 0.1, o2_ratio: 1, o2_level: 0.45, o2_d: 0.18, o2_s: 0.1, o3_ratio: 1, o3_level: 0.2, o3_d: 0.2, o4_ratio: 2, o4_level: 0.3, o4_d: 0.1, fb: 0.2,
    },
    'FM brass': {
      alg: 3, o1_ratio: 1, o1_level: 1, o1_a: 0.04, o1_d: 0.4, o1_s: 0.8, o1_r: 0.12, o2_ratio: 1, o2_level: 0.4, o2_a: 0.06, o2_d: 0.3, o2_s: 0.6,
      o3_ratio: 2, o3_level: 0.15, o3_a: 0.05, o3_s: 0.5, o4_ratio: 1, o4_level: 0.2, o4_a: 0.08, o4_s: 0.5, o2_vel: 1,
    },
    'FM marimba': {
      alg: 1, o1_ratio: 1, o1_level: 0.9, o1_d: 0.6, o1_r: 0.1, o2_ratio: 4, o2_level: 0.25, o2_d: 0.08, o3_ratio: 1, o3_level: 0.15, o3_d: 0.2, o4_ratio: 10, o4_level: 0.1, o4_d: 0.04,
    },
  },
  create: (sr, seed) => new FM(sr, seed),
};
