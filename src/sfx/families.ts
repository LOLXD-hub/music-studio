// Sound-effect families. Each family is a parametric recipe: the catalog samples its parameter ranges
// (stratified, seeded) to make dozens of distinct sounds from one idea.

import type { Layer, Recipe, Traj } from './synth.ts';
import { Rng } from '../engine/dsp/core.ts';
import { makeHit } from '../engine/instruments/drums.ts';

export interface PDef {
  k: string;
  min: number;
  max: number;
  /** Adjective used in the name when the value is near the minimum / maximum. */
  lo: string;
  hi: string;
  log?: boolean;
  /** Round to an integer. */
  int?: boolean;
  label?: string;
}

export interface Family {
  id: string;
  title: string;
  category: string;
  folder: string;
  tags: string[];
  variants: number;
  params: PDef[];
  build?: (p: Record<string, number>) => Recipe;
  /** Direct renderer for sounds that are not layer recipes (drum hits). */
  custom?: (p: Record<string, number>, sr: number, seed: number) => { L: Float32Array; R: Float32Array };
  /** Fixed list of parameter sets (named), instead of sampling. */
  fixed?: { name: string; params: Record<string, number> }[];
}

const P = (k: string, min: number, max: number, lo: string, hi: string, o: Partial<PDef> = {}): PDef => ({ k, min, max, lo, hi, ...o });
const T = (a: number, b?: number, o: Partial<Traj> = {}): Traj => ({ a, b, ...o });

type LayerIn = Omit<Layer, 'env'> & { env: Layer['env'] };
const mk = (l: LayerIn): Layer => l;

const FAMILIES: Family[] = [];
const fam = (id: string, title: string, category: string, folder: string, tags: string[], variants: number, params: PDef[], build: Family['build']): void => {
  FAMILIES.push({ id, title, category, folder, tags, variants, params, build });
};

// =============================================================== IMPACTS
fam('impact-sub', 'Sub Boom', 'Impacts', 'Impacts/Booms', ['impact', 'boom', 'sub', 'cinematic', 'hit'], 14, [P('pitch', 34, 72, 'deep', 'mid', { log: true }), P('len', 0.6, 2.4, 'short', 'long'), P('click', 0, 1, 'soft', 'punchy'), P('wet', 0, 1, 'dry', 'wet')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(p.pitch * 3.2, p.pitch, { time: 0.1, curve: 0.5 }), amp: 1, env: { attack: 0.002, decay: p.len } }),
    mk({ src: 'sine', f: T(p.pitch * 6, p.pitch * 2, { time: 0.08 }), amp: 0.3, env: { attack: 0.001, decay: p.len * 0.25 } }),
    mk({ src: 'brown', amp: 0.5, env: { attack: 0.001, decay: 0.3 }, filter: { type: 'lp', f: T(900, 90, { time: 0.3 }) } }),
    mk({ src: 'noise', amp: p.click * 0.8, env: { attack: 0.0005, decay: 0.012 }, filter: { type: 'hp', f: T(2200) } }),
  ],
  post: { reverb: { size: 1.2, decay: 1 + p.len, mix: p.wet * 0.4 }, lp: 9000, peakDb: -2 },
}));

fam('impact-cinematic', 'Cinematic Hit', 'Impacts', 'Impacts/Cinematic', ['impact', 'cinematic', 'trailer', 'hit', 'epic'], 14, [P('pitch', 38, 90, 'low', 'high', { log: true }), P('len', 1.2, 3.6, 'short', 'long'), P('ring', 0, 1, 'dry', 'metallic'), P('noise', 0.2, 1, 'clean', 'crashing')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(p.pitch * 3, p.pitch, { time: 0.12, curve: 0.5 }), amp: 1, env: { attack: 0.002, decay: p.len * 0.9 } }),
    mk({ src: 'noise', amp: p.noise * 0.55, env: { attack: 0.001, decay: p.len * 0.5 }, filter: { type: 'lp', f: T(7000, 300, { time: p.len * 0.5 }) }, stereo: 1 }),
    mk({ src: 'metal', f: T(p.pitch * 5), partials: 10, spread: 1.2, amp: p.ring * 0.35, env: { attack: 0.002, decay: p.len }, filter: { type: 'hp', f: T(500) }, stereo: 0.3 }),
    mk({ src: 'brown', amp: 0.4, env: { attack: 0.01, decay: p.len }, filter: { type: 'lp', f: T(250) } }),
  ],
  post: { reverb: { size: 1.7, decay: 2.5 + p.len, mix: 0.35, damp: 0.6 }, widen: 1.3, peakDb: -2 },
}));

fam('impact-metal', 'Metal Hit', 'Impacts', 'Impacts/Metal', ['impact', 'metal', 'clang', 'hit'], 14, [P('pitch', 140, 900, 'low', 'high', { log: true }), P('hard', 0, 1, 'dull', 'ringing'), P('len', 0.4, 3, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'metal', f: T(p.pitch), partials: 11, spread: 1 + p.hard, amp: 0.9, env: { attack: 0.001, decay: p.len * (0.4 + p.hard * 0.6) }, filter: { type: 'lp', f: T(2500 + p.hard * 9000) } }),
    mk({ src: 'noise', amp: 0.5, env: { attack: 0.0005, decay: 0.02 }, filter: { type: 'bp', f: T(p.pitch * 6), q: 1.2 } }),
  ],
  post: { reverb: { size: 0.8, decay: 0.8 + p.len * 0.4, mix: 0.2 }, peakDb: -3 },
}));

fam('impact-wood', 'Wood Knock', 'Impacts', 'Impacts/Wood', ['impact', 'wood', 'knock', 'foley'], 12, [P('pitch', 180, 900, 'low', 'high', { log: true }), P('len', 0.07, 0.45, 'tight', 'resonant'), P('hollow', 0, 1, 'solid', 'hollow')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'modal', f: T(p.pitch), modes: [[1, 1, 1], [2.27 + p.hollow * 0.4, 0.55, 0.55], [4.1, 0.3, 0.35], [6.6, 0.15, 0.2]], amp: 0.9, env: { attack: 0.0005, decay: p.len } }),
    mk({ src: 'noise', amp: 0.4, env: { attack: 0.0003, decay: 0.012 }, filter: { type: 'bp', f: T(p.pitch * 4), q: 1 } }),
  ],
  post: { reverb: { size: 0.5, decay: 0.5, mix: 0.12 }, peakDb: -3 },
}));

fam('impact-stone', 'Stone Thud', 'Impacts', 'Impacts/Stone', ['impact', 'stone', 'thud', 'rock'], 10, [P('pitch', 55, 180, 'low', 'mid', { log: true }), P('len', 0.2, 0.9, 'short', 'long'), P('crack', 0, 1, 'dull', 'cracking')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(p.pitch * 1.8, p.pitch, { time: 0.05 }), amp: 1, env: { attack: 0.001, decay: p.len * 0.8 } }),
    mk({ src: 'noise', amp: 0.6, env: { attack: 0.0005, decay: 0.08 }, filter: { type: 'lp', f: T(2500 + p.crack * 4000, 200, { time: 0.1 }) } }),
    mk({ src: 'noise', amp: p.crack * 0.6, env: { attack: 0.0003, decay: 0.015 }, filter: { type: 'hp', f: T(3000) } }),
  ],
  post: { reverb: { size: 0.9, decay: 1, mix: 0.18 }, peakDb: -2 },
}));

fam('door-slam', 'Door Slam', 'Impacts', 'Impacts/Doors', ['door', 'slam', 'impact', 'foley'], 10, [P('weight', 0, 1, 'light', 'heavy'), P('len', 0.6, 2, 'short', 'long'), P('rattle', 0, 1, 'solid', 'rattly')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(120 - p.weight * 60, 45, { time: 0.08 }), amp: 1, env: { attack: 0.001, decay: 0.35 + p.weight * 0.4 } }),
    mk({ src: 'noise', amp: 0.7, env: { attack: 0.0005, decay: 0.12 + p.weight * 0.1 }, filter: { type: 'lp', f: T(2800, 250, { time: 0.15 }) } }),
    mk({ src: 'metal', f: T(380 + p.rattle * 400), partials: 8, amp: p.rattle * 0.35, env: { delay: 0.01, attack: 0.001, decay: 0.5 }, filter: { type: 'hp', f: T(600) } }),
  ],
  post: { reverb: { size: 1.1, decay: 1.2 + p.len * 0.5, mix: 0.25 }, peakDb: -2 },
}));

fam('punch', 'Body Punch', 'Impacts', 'Impacts/Hits', ['punch', 'hit', 'impact', 'fight'], 10, [P('pitch', 80, 200, 'low', 'mid', { log: true }), P('len', 0.12, 0.38, 'short', 'long'), P('snap', 0, 1, 'dull', 'sharp')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(p.pitch * 2, p.pitch * 0.6, { time: 0.06 }), amp: 1, env: { attack: 0.001, decay: p.len } }),
    mk({ src: 'noise', amp: 0.6, env: { attack: 0.0005, decay: 0.05 }, filter: { type: 'bp', f: T(1200 + p.snap * 3000), q: 0.8 } }),
  ],
  post: { reverb: { size: 0.5, decay: 0.4, mix: 0.1 }, peakDb: -2 },
}));

fam('orch-stab', 'Stab Chord', 'Impacts', 'Impacts/Stabs', ['stab', 'orchestra', 'hit', 'cinematic'], 10, [P('pitch', 110, 440, 'low', 'high', { log: true }), P('len', 0.35, 1.3, 'short', 'long'), P('dark', 0, 1, 'bright', 'dark')], (p) => ({
  length: p.len,
  layers: [1, 1.5, 2, 3].map((r, i) => mk({ src: 'saw', f: T(p.pitch * r), detune: 12, amp: 0.45 / (1 + i * 0.3), env: { attack: 0.006, decay: p.len }, filter: { type: 'lp', f: T(7000 - p.dark * 5500, 800 + 600 * (1 - p.dark), { time: p.len }) } })).concat([mk({ src: 'noise', amp: 0.2, env: { attack: 0.001, decay: 0.12 }, filter: { type: 'bp', f: T(2500), q: 0.6 } })]),
  post: { reverb: { size: 1.3, decay: 1.8, mix: 0.3 }, widen: 1.2, peakDb: -3 },
}));

// =============================================================== EXPLOSIONS
fam('explosion', 'Explosion', 'Explosions', 'Explosions/Blasts', ['explosion', 'blast', 'boom', 'bomb'], 14, [P('size', 0, 1, 'small', 'huge'), P('len', 1, 4.5, 'short', 'long'), P('bright', 0, 1, 'dull', 'crisp'), P('rumble', 0, 1, 'tight', 'rumbling')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.9, env: { attack: 0.002, decay: p.len * 0.6 }, filter: { type: 'lp', f: T(3500 + p.bright * 7000, 90 + p.size * 40, { time: p.len * 0.7 }) }, stereo: 1 }),
    mk({ src: 'brown', amp: 0.8 + p.rumble * 0.5, env: { attack: 0.01, decay: p.len }, filter: { type: 'lp', f: T(300, 60, { time: p.len }) } }),
    mk({ src: 'sine', f: T(90 - p.size * 30, 26, { time: 0.5 }), amp: 0.9, env: { attack: 0.003, decay: p.len * 0.7 } }),
    mk({ src: 'noise', amp: 0.4, env: { attack: 0.0005, decay: 0.03 }, filter: { type: 'hp', f: T(2500) } }),
  ],
  post: { reverb: { size: 1 + p.size, decay: 1.2 + p.len * 0.5, mix: 0.25 }, peakDb: -1.5 },
}));

fam('blast-distant', 'Distant Blast', 'Explosions', 'Explosions/Distant', ['explosion', 'distant', 'blast', 'war'], 8, [P('dist', 0, 1, 'near', 'far'), P('len', 2, 5, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'brown', amp: 1, env: { attack: 0.04 + p.dist * 0.2, decay: p.len * 0.7 }, filter: { type: 'lp', f: T(500 - p.dist * 300, 70, { time: p.len }) } }),
    mk({ src: 'sine', f: T(60, 30, { time: 0.8 }), amp: 0.8, env: { attack: 0.05, decay: p.len * 0.6 } }),
  ],
  post: { reverb: { size: 2, decay: 3 + p.dist * 2, mix: 0.4 }, peakDb: -3 },
}));

fam('bomb-whistle', 'Falling Bomb', 'Explosions', 'Explosions/Blasts', ['bomb', 'whistle', 'explosion', 'war'], 8, [P('len', 1, 3, 'short', 'long'), P('pitch', 1200, 3200, 'low', 'high', { log: true })], (p) => ({
  length: p.len + 1.8,
  layers: [
    mk({ src: 'sine', f: T(p.pitch, p.pitch * 0.35, { time: p.len }), vib: { rate: 7, depth: 30 }, amp: 0.35, env: { attack: 0.05, decay: p.len * 0.95, shape: 'hann', peak: 0.2 } }),
    mk({ src: 'noise', amp: 0.9, env: { delay: p.len, attack: 0.002, decay: 1.5 }, filter: { type: 'lp', f: T(5000, 100, { time: 1.4 }) }, stereo: 1 }),
    mk({ src: 'sine', f: T(80, 28, { time: 0.4 }), amp: 1, env: { delay: p.len, attack: 0.003, decay: 1.4 } }),
  ],
  post: { reverb: { size: 1.5, decay: 2, mix: 0.25 }, peakDb: -2 },
}));

fam('debris', 'Debris Rumble', 'Explosions', 'Explosions/Debris', ['debris', 'rubble', 'rumble', 'collapse'], 6, [P('len', 1.5, 4, 'short', 'long'), P('size', 0.3, 1, 'fine', 'chunky')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.8, grains: { rate: 40 + p.size * 30, decay: 0.01 + p.size * 0.03 }, env: { attack: 0.01, decay: p.len }, filter: { type: 'bp', f: T(900 * (1.4 - p.size), 400, { time: p.len }), q: 0.6 }, stereo: 1 }),
    mk({ src: 'brown', amp: 0.6, env: { attack: 0.02, decay: p.len }, filter: { type: 'lp', f: T(200) } }),
  ],
  post: { reverb: { size: 1, decay: 1.2, mix: 0.2 }, peakDb: -3 },
}));

// =============================================================== TRANSITIONS
fam('whoosh', 'Whoosh', 'Transitions', 'Transitions/Whooshes', ['whoosh', 'swoosh', 'transition', 'movement'], 18, [P('dur', 0.25, 1.4, 'quick', 'slow'), P('pitch', 400, 3200, 'low', 'high', { log: true }), P('dir', 0, 1, 'falling', 'rising'), P('width', 0.2, 1, 'narrow', 'wide'), P('body', 0, 1, 'airy', 'full')], (p) => {
  const a = p.dir > 0.5 ? p.pitch * 0.3 : p.pitch * 1.6;
  const b = p.dir > 0.5 ? p.pitch * 1.6 : p.pitch * 0.3;
  return {
    length: p.dur,
    layers: [
      mk({ src: 'noise', amp: 0.8, env: { decay: p.dur, shape: 'hann', peak: p.dir > 0.5 ? 0.7 : 0.35 }, filter: { type: 'bp', f: T(a, b), q: 0.7 + (1 - p.width) * 1.5 }, stereo: 1 }),
      mk({ src: 'pink', amp: 0.5 * p.body, env: { decay: p.dur, shape: 'hann', peak: p.dir > 0.5 ? 0.7 : 0.35 }, filter: { type: 'lp', f: T(a * 0.5, b * 0.5) }, stereo: 1 }),
    ],
    post: { reverb: { size: 0.8, decay: 0.7, mix: 0.12 }, peakDb: -3 },
  };
});

fam('swish', 'Swish', 'Transitions', 'Transitions/Whooshes', ['swish', 'swipe', 'short', 'movement'], 10, [P('dur', 0.07, 0.24, 'tiny', 'short'), P('pitch', 800, 5000, 'low', 'high', { log: true }), P('dir', 0, 1, 'falling', 'rising')], (p) => ({
  length: p.dur,
  layers: [mk({ src: 'noise', amp: 0.9, env: { decay: p.dur, shape: 'hann', peak: 0.5 }, filter: { type: 'bp', f: T(p.dir > 0.5 ? p.pitch * 0.5 : p.pitch * 1.5, p.dir > 0.5 ? p.pitch * 1.5 : p.pitch * 0.5), q: 1.1 }, stereo: 1 })],
  post: { peakDb: -4 },
}));

fam('riser-noise', 'Noise Riser', 'Transitions', 'Transitions/Risers', ['riser', 'build', 'tension', 'sweep'], 12, [P('len', 1.5, 6, 'short', 'long'), P('start', 200, 900, 'low', 'mid', { log: true }), P('end', 5000, 15000, 'mid', 'high', { log: true }), P('q', 0.5, 3, 'broad', 'tonal')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.9, env: { decay: p.len, shape: 'hann', peak: 0.97 }, filter: { type: 'bp', f: T(p.start, p.end, { curve: 1.6 }), q: p.q }, stereo: 1 }),
    mk({ src: 'saw', f: T(p.start * 0.3, p.start * 2.2, { curve: 2 }), amp: 0.14, detune: 20, env: { decay: p.len, shape: 'hann', peak: 0.97 }, filter: { type: 'lp', f: T(800, 9000, { curve: 2 }) } }),
  ],
  post: { reverb: { size: 1, decay: 1.2, mix: 0.15 }, peakDb: -3 },
}));

fam('riser-synth', 'Synth Riser', 'Transitions', 'Transitions/Risers', ['riser', 'synth', 'build', 'edm'], 12, [P('len', 2, 6, 'short', 'long'), P('pitch', 90, 420, 'low', 'high', { log: true }), P('detune', 5, 45, 'tight', 'wide'), P('rise', 1.5, 5, 'gentle', 'steep')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch, p.pitch * p.rise, { curve: 1.4 }), detune: p.detune, amp: 0.6, env: { decay: p.len, shape: 'hann', peak: 0.97 }, filter: { type: 'lp', f: T(300, 9000, { curve: 1.5 }), q: 1.5 } }),
    mk({ src: 'saw', f: T(p.pitch * 1.5, p.pitch * 1.5 * p.rise, { curve: 1.4 }), detune: -p.detune, amp: 0.4, env: { decay: p.len, shape: 'hann', peak: 0.97 }, filter: { type: 'lp', f: T(300, 9000, { curve: 1.5 }), q: 1.5 } }),
    mk({ src: 'noise', amp: 0.3, env: { decay: p.len, shape: 'hann', peak: 0.97 }, filter: { type: 'hp', f: T(1000, 9000, { curve: 2 }) }, stereo: 1 }),
  ],
  post: { reverb: { size: 1.2, decay: 1.5, mix: 0.18 }, widen: 1.3, peakDb: -3 },
}));

fam('downlifter', 'Downlifter', 'Transitions', 'Transitions/Risers', ['downlifter', 'fall', 'release', 'sweep'], 10, [P('len', 1, 4, 'short', 'long'), P('start', 4000, 14000, 'mid', 'high', { log: true }), P('q', 0.5, 3, 'broad', 'tonal')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.9, env: { attack: 0.01, decay: p.len, shape: 'hann', peak: 0.04 }, filter: { type: 'bp', f: T(p.start, 150, { curve: 0.6 }), q: p.q }, stereo: 1 }),
    mk({ src: 'saw', f: T(800, 60, { curve: 0.7 }), amp: 0.25, detune: 15, env: { decay: p.len, shape: 'hann', peak: 0.04 }, filter: { type: 'lp', f: T(6000, 200) } }),
  ],
  post: { reverb: { size: 1.2, decay: 1.5, mix: 0.2 }, peakDb: -3 },
}));

fam('reverse-cymbal', 'Reverse Cymbal', 'Transitions', 'Transitions/Risers', ['cymbal', 'reverse', 'riser', 'swell'], 10, [P('len', 0.8, 3.5, 'short', 'long'), P('tone', 0, 1, 'dark', 'bright')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'metal', f: T(380 + p.tone * 400), partials: 14, spread: 1.5, amp: 0.5, env: { decay: p.len, shape: 'hann', peak: 0.96 }, filter: { type: 'hp', f: T(2000, 6000 + p.tone * 4000) } }),
    mk({ src: 'noise', amp: 0.7, env: { decay: p.len, shape: 'hann', peak: 0.96 }, filter: { type: 'hp', f: T(3000 + p.tone * 3000, 8000, { curve: 1.5 }) }, stereo: 1 }),
  ],
  post: { reverb: { size: 0.9, decay: 0.8, mix: 0.1 }, peakDb: -3 },
}));

fam('tape-stop', 'Tape Stop', 'Transitions', 'Transitions/Glitch', ['tape', 'stop', 'slowdown', 'glitch'], 8, [P('len', 0.4, 2, 'quick', 'slow'), P('pitch', 180, 800, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch, 18, { curve: 0.55 }), detune: 8, amp: 0.7, env: { attack: 0.002, decay: p.len * 0.9 }, filter: { type: 'lp', f: T(4000, 150, { time: p.len }) } }),
    mk({ src: 'square', f: T(p.pitch * 2, 30, { curve: 0.55 }), amp: 0.25, env: { attack: 0.002, decay: p.len * 0.8 }, filter: { type: 'lp', f: T(3000, 120) } }),
  ],
  post: { peakDb: -3 },
}));

fam('rewind', 'Tape Rewind', 'Transitions', 'Transitions/Glitch', ['tape', 'rewind', 'fast', 'whir'], 6, [P('len', 0.4, 1.6, 'quick', 'long'), P('pitch', 400, 1600, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch * 0.3, p.pitch * 2.4, { curve: 0.8 }), amp: 0.5, vib: { rate: 38, depth: 160 }, env: { decay: p.len, shape: 'hann', peak: 0.85 }, filter: { type: 'bp', f: T(1500, 5000), q: 1.4 } }),
    mk({ src: 'noise', amp: 0.4, env: { decay: p.len, shape: 'hann', peak: 0.85 }, filter: { type: 'bp', f: T(3000, 7000), q: 0.8 }, stereo: 1 }),
  ],
  post: { peakDb: -3 },
}));

fam('stutter', 'Stutter Glitch', 'Transitions', 'Transitions/Glitch', ['glitch', 'stutter', 'digital', 'idm'], 10, [P('rate', 6, 36, 'slow', 'fast'), P('len', 0.3, 1.2, 'short', 'long'), P('pitch', 120, 900, 'low', 'high', { log: true }), P('crush', 0, 1, 'smooth', 'crushed')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'square', f: T(p.pitch, p.pitch * 0.5, { curve: 0.5 }), amp: 0.5, gate: { rate: p.rate, duty: 0.45 }, crush: { bits: 12 - p.crush * 7, down: 1 + Math.round(p.crush * 8) }, env: { attack: 0.001, decay: p.len } }),
    mk({ src: 'noise', amp: 0.18, gate: { rate: p.rate, duty: 0.2 }, env: { attack: 0.001, decay: p.len * 0.8 }, filter: { type: 'hp', f: T(3000) } }),
  ],
  post: { delay: { time: 0.12, feedback: 0.3, mix: 0.15 }, peakDb: -3 },
}));

fam('sweep-tonal', 'Tonal Sweep', 'Transitions', 'Transitions/Sweeps', ['sweep', 'tonal', 'transition', 'fm'], 8, [P('len', 0.5, 2.5, 'quick', 'slow'), P('pitch', 200, 1200, 'low', 'high', { log: true }), P('dir', 0, 1, 'falling', 'rising')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'fm', f: T(p.dir > 0.5 ? p.pitch : p.pitch * 4, p.dir > 0.5 ? p.pitch * 4 : p.pitch), ratio: 1.5, index: T(1, 5), amp: 0.55, env: { decay: p.len, shape: 'hann', peak: p.dir > 0.5 ? 0.8 : 0.2 } }),
    mk({ src: 'sine', f: T(p.dir > 0.5 ? p.pitch * 2 : p.pitch * 8, p.dir > 0.5 ? p.pitch * 8 : p.pitch * 2), amp: 0.25, env: { decay: p.len, shape: 'hann', peak: p.dir > 0.5 ? 0.8 : 0.2 } }),
  ],
  post: { reverb: { size: 1.2, decay: 1.4, mix: 0.25 }, peakDb: -3 },
}));

// =============================================================== SCI-FI
fam('laser', 'Laser Zap', 'Sci-Fi', 'Sci-Fi/Lasers & Weapons', ['laser', 'zap', 'sci-fi', 'weapon'], 16, [P('pitch', 800, 4200, 'low', 'high', { log: true }), P('drop', 0.3, 0.97, 'shallow', 'deep'), P('len', 0.1, 0.6, 'snappy', 'long'), P('grit', 0, 1, 'clean', 'gritty')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: p.grit > 0.5 ? 'square' : 'saw', f: T(p.pitch, Math.max(40, p.pitch * (1 - p.drop)), { time: p.len * 0.9, curve: 0.65 }), detune: 10, amp: 0.7, drive: p.grit * 3, env: { attack: 0.001, decay: p.len * 0.8 } }),
    mk({ src: 'noise', amp: 0.15, env: { attack: 0.0005, decay: 0.04 }, filter: { type: 'hp', f: T(3500) } }),
  ],
  post: { delay: { time: 0.07, feedback: 0.3, mix: 0.18 }, peakDb: -3 },
}));

fam('blaster', 'Blaster Shot', 'Sci-Fi', 'Sci-Fi/Lasers & Weapons', ['blaster', 'shot', 'sci-fi', 'weapon'], 12, [P('pitch', 250, 1400, 'low', 'high', { log: true }), P('len', 0.15, 0.6, 'short', 'long'), P('crunch', 0, 1, 'smooth', 'crunchy')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch * 2, p.pitch * 0.4, { time: p.len * 0.5, curve: 0.5 }), amp: 0.7, drive: 1 + p.crunch * 4, env: { attack: 0.001, decay: p.len * 0.7 }, filter: { type: 'lp', f: T(7000, 900, { time: p.len }) } }),
    mk({ src: 'noise', amp: 0.7, env: { attack: 0.0005, decay: 0.07 }, filter: { type: 'bp', f: T(2500), q: 0.6 } }),
    mk({ src: 'sine', f: T(180, 50, { time: 0.1 }), amp: 0.7, env: { attack: 0.001, decay: 0.15 } }),
  ],
  post: { reverb: { size: 0.8, decay: 0.7, mix: 0.18 }, peakDb: -2 },
}));

fam('charge-up', 'Charge Up', 'Sci-Fi', 'Sci-Fi/Energy', ['charge', 'power', 'sci-fi', 'build'], 10, [P('len', 0.6, 3, 'quick', 'slow'), P('pitch', 100, 600, 'low', 'high', { log: true }), P('shimmer', 0, 1, 'smooth', 'shimmering')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(p.pitch, p.pitch * 6, { curve: 1.6 }), amp: 0.6, env: { decay: p.len, shape: 'hann', peak: 0.96 } }),
    mk({ src: 'fm', f: T(p.pitch * 2, p.pitch * 10, { curve: 1.6 }), ratio: 2, index: T(0.5, 4), amp: 0.3, env: { decay: p.len, shape: 'hann', peak: 0.96 } }),
    mk({ src: 'noise', amp: 0.25, env: { decay: p.len, shape: 'hann', peak: 0.96 }, filter: { type: 'bp', f: T(500, 8000, { curve: 1.8 }), q: 2 }, am: { rate: 14 + p.shimmer * 40, depth: p.shimmer * 0.6 }, stereo: 1 }),
  ],
  post: { reverb: { size: 1, decay: 1, mix: 0.15 }, peakDb: -3 },
}));

fam('power-down', 'Power Down', 'Sci-Fi', 'Sci-Fi/Energy', ['power', 'down', 'sci-fi', 'shutdown'], 10, [P('len', 0.6, 3, 'quick', 'slow'), P('pitch', 150, 1200, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch, 25, { curve: 0.5 }), detune: 10, amp: 0.55, env: { attack: 0.01, decay: p.len * 0.9 }, filter: { type: 'lp', f: T(6000, 100, { curve: 0.5 }) } }),
    mk({ src: 'sine', f: T(p.pitch * 0.5, 20, { curve: 0.5 }), amp: 0.6, env: { attack: 0.01, decay: p.len * 0.9 } }),
  ],
  post: { reverb: { size: 1, decay: 1, mix: 0.12 }, peakDb: -3 },
}));

fam('force-field', 'Force Field Hum', 'Sci-Fi', 'Sci-Fi/Energy', ['shield', 'hum', 'sci-fi', 'energy'], 10, [P('len', 1, 4, 'short', 'long'), P('pitch', 70, 320, 'low', 'high', { log: true }), P('mod', 3, 32, 'slow', 'fast', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch), detune: 14, amp: 0.5, ring: { f: p.mod * 8, depth: 0.5 }, am: { rate: p.mod, depth: 0.4 }, env: { attack: 0.08, decay: p.len, shape: 'exp', sustain: 0.8 }, filter: { type: 'lp', f: T(2500, 1200, { time: p.len }), q: 2 } }),
    mk({ src: 'sine', f: T(p.pitch * 2.01), amp: 0.2, am: { rate: p.mod * 1.3, depth: 0.5 }, env: { attack: 0.1, decay: p.len, sustain: 0.8 } }),
  ],
  post: { reverb: { size: 1.2, decay: 1.3, mix: 0.2 }, widen: 1.2, peakDb: -4 },
}));

fam('teleport', 'Teleport', 'Sci-Fi', 'Sci-Fi/Energy', ['teleport', 'warp', 'sci-fi', 'transition'], 10, [P('len', 0.5, 2, 'quick', 'slow'), P('pitch', 300, 1400, 'low', 'high', { log: true }), P('chop', 6, 40, 'smooth', 'chopped', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'fm', f: T(p.pitch * 0.4, p.pitch * 3, { curve: 1.3 }), ratio: 3.01, index: T(2, 8), amp: 0.5, gate: { rate: p.chop, duty: 0.6 }, env: { decay: p.len, shape: 'hann', peak: 0.6 } }),
    mk({ src: 'noise', amp: 0.3, env: { decay: p.len, shape: 'hann', peak: 0.6 }, filter: { type: 'bp', f: T(1000, 9000), q: 1 }, stereo: 1 }),
  ],
  post: { reverb: { size: 1.3, decay: 1.6, mix: 0.3 }, widen: 1.4, peakDb: -3 },
}));

fam('alien-chirp', 'Alien Chirp', 'Sci-Fi', 'Sci-Fi/Creatures', ['alien', 'chirp', 'creature', 'sci-fi'], 12, [P('pitch', 600, 3000, 'low', 'high', { log: true }), P('len', 0.2, 0.9, 'short', 'long'), P('wobble', 0, 1, 'steady', 'wobbly')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'fm', f: T(p.pitch * 0.7, p.pitch * 1.4, { curve: 0.7 }), ratio: 2.7 + p.wobble, index: T(3, 1), vib: { rate: 12 + p.wobble * 20, depth: 200 + p.wobble * 600 }, amp: 0.7, env: { attack: 0.01, decay: p.len * 0.8 }, filter: { type: 'bp', f: T(p.pitch * 1.5), q: 1.2 } }),
  ],
  post: { reverb: { size: 0.9, decay: 0.9, mix: 0.2 }, peakDb: -3 },
}));

fam('servo', 'Robot Servo', 'Sci-Fi', 'Sci-Fi/Machines', ['robot', 'servo', 'motor', 'sci-fi'], 10, [P('pitch', 150, 800, 'low', 'high', { log: true }), P('len', 0.2, 1.2, 'short', 'long'), P('buzz', 0, 1, 'smooth', 'buzzy')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'square', f: T(p.pitch, p.pitch * 1.6, { curve: 0.8 }), pw: 0.3, amp: 0.4, am: { rate: 30 + p.buzz * 90, depth: 0.5 * p.buzz }, env: { attack: 0.02, decay: p.len, shape: 'hann', peak: 0.3 }, filter: { type: 'bp', f: T(p.pitch * 3), q: 1.5 } }),
    mk({ src: 'noise', amp: 0.1, env: { attack: 0.02, decay: p.len, shape: 'hann', peak: 0.3 }, filter: { type: 'bp', f: T(2500), q: 1 } }),
  ],
  post: { peakDb: -4 },
}));

fam('computer-beeps', 'Computer Beeps', 'Sci-Fi', 'Sci-Fi/Computers', ['computer', 'beep', 'data', 'sci-fi'], 12, [P('count', 3, 9, 'few', 'many', { int: true }), P('pitch', 500, 2600, 'low', 'high', { log: true }), P('speed', 0.04, 0.12, 'fast', 'slow'), P('range', 0.5, 2, 'narrow', 'wide')], (p) => {
  const r = new Rng(Math.round(p.pitch * 7 + p.count));
  const layers: Layer[] = [];
  for (let i = 0; i < p.count; i++) {
    const f = p.pitch * Math.pow(2, (r.next() - 0.5) * p.range);
    layers.push(mk({ src: r.chance(0.5) ? 'square' : 'sine', f: T(f), amp: 0.4, pw: 0.5, env: { delay: i * p.speed, attack: 0.002, hold: p.speed * 0.5, decay: 0.012 } }));
  }
  return { length: p.count * p.speed + 0.05, layers, post: { reverb: { size: 0.5, decay: 0.4, mix: 0.1 }, peakDb: -4 } };
});

fam('scanner', 'Scanner Sweep', 'Sci-Fi', 'Sci-Fi/Computers', ['scanner', 'radar', 'sweep', 'sci-fi'], 8, [P('len', 0.6, 2.4, 'short', 'long'), P('pitch', 300, 1400, 'low', 'high', { log: true }), P('sweeps', 1, 3, 'one', 'several', { int: true })], (p) => {
  const layers: Layer[] = [];
  const seg = p.len / p.sweeps;
  for (let i = 0; i < p.sweeps; i++) {
    const up = i % 2 === 0;
    layers.push(mk({ src: 'sine', f: T(up ? p.pitch : p.pitch * 4, up ? p.pitch * 4 : p.pitch, { time: seg }), amp: 0.5, env: { delay: i * seg, decay: seg, shape: 'hann', peak: 0.5 } }));
  }
  return { length: p.len, layers, post: { delay: { time: 0.15, feedback: 0.35, mix: 0.2 }, reverb: { size: 0.9, decay: 0.8, mix: 0.12 }, peakDb: -4 } };
});

fam('sci-alarm', 'Sci-Fi Alarm', 'Sci-Fi', 'Sci-Fi/Computers', ['alarm', 'alert', 'sci-fi', 'warning'], 8, [P('pitch', 300, 900, 'low', 'high', { log: true }), P('rate', 1, 4, 'slow', 'fast'), P('len', 1, 3, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'saw', f: T(p.pitch), vib: { rate: p.rate, depth: 500 }, amp: 0.5, env: { attack: 0.01, decay: p.len, sustain: 0.8, hold: p.len * 0.5 }, filter: { type: 'lp', f: T(3500), q: 1.2 } })],
  post: { reverb: { size: 0.8, decay: 0.7, mix: 0.12 }, peakDb: -3 },
}));

// =============================================================== UI
fam('ui-click', 'UI Click', 'UI & Interface', 'UI & Interface/Clicks', ['ui', 'click', 'button', 'interface'], 16, [P('pitch', 1500, 7000, 'low', 'high', { log: true }), P('len', 0.01, 0.05, 'tiny', 'soft'), P('body', 0, 1, 'thin', 'full')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.6, env: { attack: 0.0003, decay: p.len }, filter: { type: 'bp', f: T(p.pitch), q: 1.6 } }),
    mk({ src: 'sine', f: T(p.pitch * 0.35, p.pitch * 0.18, { time: p.len }), amp: 0.5 + p.body * 0.5, env: { attack: 0.0005, decay: p.len * 1.4 } }),
  ],
  post: { peakDb: -5 },
}));

fam('ui-tap', 'Soft Tap', 'UI & Interface', 'UI & Interface/Clicks', ['ui', 'tap', 'soft', 'touch'], 10, [P('pitch', 150, 800, 'low', 'high', { log: true }), P('len', 0.04, 0.16, 'tiny', 'soft')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch * 1.5, p.pitch, { time: 0.02 }), amp: 0.9, env: { attack: 0.001, decay: p.len } }), mk({ src: 'noise', amp: 0.12, env: { attack: 0.0005, decay: 0.01 }, filter: { type: 'bp', f: T(p.pitch * 6), q: 1 } })],
  post: { peakDb: -5 },
}));

fam('ui-toggle', 'Toggle Switch', 'UI & Interface', 'UI & Interface/Clicks', ['ui', 'toggle', 'switch', 'on', 'off'], 10, [P('pitch', 500, 1500, 'low', 'high', { log: true }), P('dir', 0, 1, 'off', 'on')], (p) => {
  const a = p.pitch;
  const b = p.pitch * (p.dir > 0.5 ? 1.5 : 0.667);
  return {
    length: 0.18,
    layers: [mk({ src: 'sine', f: T(a), amp: 0.6, env: { attack: 0.001, decay: 0.06 } }), mk({ src: 'sine', f: T(b), amp: 0.6, env: { delay: 0.05, attack: 0.001, decay: 0.08 } }), mk({ src: 'noise', amp: 0.1, env: { attack: 0.0003, decay: 0.008 }, filter: { type: 'hp', f: T(3500) } })],
    post: { reverb: { size: 0.4, decay: 0.3, mix: 0.1 }, peakDb: -5 },
  };
});

fam('ui-notify', 'Notification Chime', 'UI & Interface', 'UI & Interface/Notifications', ['ui', 'notification', 'chime', 'alert', 'message'], 16, [P('pitch', 500, 1300, 'low', 'high', { log: true }), P('interval', 3, 9, 'close', 'wide', { int: true }), P('notes', 2, 3, 'two', 'three', { int: true }), P('len', 0.3, 0.9, 'short', 'long')], (p) => {
  const layers: Layer[] = [];
  const step = 0.11;
  const ratios = [1, Math.pow(2, p.interval / 12), Math.pow(2, (p.interval + 4) / 12)];
  for (let i = 0; i < p.notes; i++) {
    const f = p.pitch * ratios[i];
    layers.push(mk({ src: 'sine', f: T(f), amp: 0.5, env: { delay: i * step, attack: 0.004, decay: p.len } }), mk({ src: 'tri', f: T(f * 2.0), amp: 0.12, env: { delay: i * step, attack: 0.002, decay: p.len * 0.5 } }));
  }
  return { length: p.len + p.notes * step, layers, post: { reverb: { size: 0.9, decay: 0.9, mix: 0.2 }, peakDb: -5 } };
});

fam('ui-success', 'Success Sting', 'UI & Interface', 'UI & Interface/Notifications', ['ui', 'success', 'win', 'complete', 'positive'], 10, [P('pitch', 400, 900, 'low', 'high', { log: true }), P('len', 0.4, 1, 'short', 'long'), P('sparkle', 0, 1, 'plain', 'sparkly')], (p) => {
  const layers: Layer[] = [0, 4, 7, 12].map((s, i) => mk({ src: 'sine', f: T(p.pitch * Math.pow(2, s / 12)), amp: 0.45, env: { delay: i * 0.07, attack: 0.004, decay: p.len } }));
  layers.push(mk({ src: 'metal', f: T(p.pitch * 6), partials: 6, amp: p.sparkle * 0.3, env: { delay: 0.2, attack: 0.001, decay: 0.5 }, filter: { type: 'hp', f: T(3000) } }));
  return { length: p.len + 0.3, layers, post: { reverb: { size: 1, decay: 1.1, mix: 0.22 }, peakDb: -5 } };
});

fam('ui-error', 'Error Buzz', 'UI & Interface', 'UI & Interface/Notifications', ['ui', 'error', 'fail', 'negative', 'warning'], 10, [P('pitch', 90, 260, 'low', 'high', { log: true }), P('len', 0.2, 0.6, 'short', 'long'), P('dis', 0.3, 1, 'mild', 'dissonant')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'square', f: T(p.pitch), pw: 0.4, amp: 0.4, env: { attack: 0.003, hold: p.len * 0.3, decay: p.len * 0.5 }, filter: { type: 'lp', f: T(1800) } }),
    mk({ src: 'saw', f: T(p.pitch * (1 + 0.06 * p.dis)), amp: 0.35, env: { delay: 0.01, attack: 0.003, hold: p.len * 0.3, decay: p.len * 0.5 }, filter: { type: 'lp', f: T(1500) } }),
    mk({ src: 'square', f: T(p.pitch * 0.75), pw: 0.4, amp: 0.3, env: { delay: p.len * 0.45, attack: 0.003, decay: p.len * 0.4 }, filter: { type: 'lp', f: T(1400) } }),
  ],
  post: { peakDb: -5 },
}));

fam('ui-swipe', 'Swipe', 'UI & Interface', 'UI & Interface/Gestures', ['ui', 'swipe', 'slide', 'gesture'], 8, [P('len', 0.08, 0.3, 'tiny', 'soft'), P('pitch', 1200, 5000, 'low', 'high', { log: true }), P('dir', 0, 1, 'left', 'right')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.7, env: { decay: p.len, shape: 'hann', peak: 0.4 }, filter: { type: 'bp', f: T(p.pitch * (p.dir > 0.5 ? 0.6 : 1.4), p.pitch * (p.dir > 0.5 ? 1.4 : 0.6)), q: 0.9 }, pan: p.dir > 0.5 ? 0.3 : -0.3, stereo: 0.7 })],
  post: { peakDb: -6 },
}));

fam('ui-pop', 'Bubble Pop', 'UI & Interface', 'UI & Interface/Gestures', ['ui', 'pop', 'bubble', 'drop'], 10, [P('pitch', 300, 1100, 'low', 'high', { log: true }), P('len', 0.05, 0.18, 'tiny', 'soft'), P('rise', 1.4, 3, 'gentle', 'steep')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch, p.pitch * p.rise, { time: p.len * 0.5, curve: 0.5 }), amp: 0.9, env: { attack: 0.001, decay: p.len } }), mk({ src: 'noise', amp: 0.1, env: { attack: 0.0003, decay: 0.006 }, filter: { type: 'bp', f: T(2500), q: 1 } })],
  post: { reverb: { size: 0.4, decay: 0.3, mix: 0.08 }, peakDb: -5 },
}));

fam('ui-key', 'Keystroke', 'UI & Interface', 'UI & Interface/Typing', ['ui', 'key', 'typing', 'keyboard'], 8, [P('pitch', 1200, 4000, 'low', 'high', { log: true }), P('thud', 0, 1, 'light', 'heavy'), P('len', 0.025, 0.08, 'tiny', 'soft')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.7, env: { attack: 0.0003, decay: p.len * 0.5 }, filter: { type: 'bp', f: T(p.pitch), q: 1.2 } }), mk({ src: 'sine', f: T(180 - p.thud * 70, 90), amp: 0.3 + p.thud * 0.6, env: { attack: 0.0005, decay: p.len * 1.6 } })],
  post: { peakDb: -6 },
}));

// =============================================================== GAME / RETRO
fam('coin', 'Coin', 'Game & Retro', 'Game & Retro/Pickups', ['coin', 'pickup', '8-bit', 'game', 'retro'], 10, [P('pitch', 700, 1700, 'low', 'high', { log: true }), P('len', 0.15, 0.55, 'short', 'long'), P('jump', 3, 12, 'close', 'wide', { int: true })], (p) => ({
  length: p.len + 0.08,
  layers: [mk({ src: 'square', f: T(p.pitch), pw: 0.5, amp: 0.4, env: { attack: 0.001, hold: 0.06, decay: 0.01 } }), mk({ src: 'square', f: T(p.pitch * Math.pow(2, p.jump / 12)), pw: 0.5, amp: 0.4, env: { delay: 0.07, attack: 0.001, hold: p.len * 0.4, decay: p.len * 0.5 } })],
  post: { peakDb: -4 },
}));

fam('jump', 'Jump', 'Game & Retro', 'Game & Retro/Movement', ['jump', 'hop', '8-bit', 'game'], 10, [P('pitch', 180, 600, 'low', 'high', { log: true }), P('len', 0.12, 0.42, 'short', 'long'), P('rise', 1.5, 3, 'gentle', 'steep')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'square', f: T(p.pitch, p.pitch * p.rise, { curve: 0.6 }), pw: 0.5, amp: 0.45, env: { attack: 0.001, hold: p.len * 0.5, decay: p.len * 0.4 } })],
  post: { peakDb: -4 },
}));

fam('powerup', 'Power-Up', 'Game & Retro', 'Game & Retro/Pickups', ['powerup', 'bonus', '8-bit', 'game'], 10, [P('pitch', 250, 700, 'low', 'high', { log: true }), P('steps', 4, 8, 'short', 'long', { int: true }), P('speed', 0.04, 0.09, 'fast', 'slow')], (p) => {
  const major = [0, 4, 7, 12, 16, 19, 24, 28];
  const layers: Layer[] = [];
  for (let i = 0; i < p.steps; i++) layers.push(mk({ src: 'square', f: T(p.pitch * Math.pow(2, major[i] / 12)), pw: 0.25, amp: 0.35, vib: { rate: 9, depth: 25 }, env: { delay: i * p.speed, attack: 0.001, hold: p.speed * 0.7, decay: 0.03 } }));
  return { length: p.steps * p.speed + 0.1, layers, post: { peakDb: -4 } };
});

fam('retro-hit', 'Retro Hit', 'Game & Retro', 'Game & Retro/Impacts', ['hit', 'damage', '8-bit', 'game'], 10, [P('pitch', 120, 700, 'low', 'high', { log: true }), P('len', 0.08, 0.35, 'short', 'long'), P('crush', 0, 1, 'clean', 'crushed')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.6, crush: { bits: 8 - p.crush * 4, down: 2 + Math.round(p.crush * 6) }, env: { attack: 0.001, decay: p.len * 0.6 }, filter: { type: 'lp', f: T(5000, 600, { time: p.len }) } }), mk({ src: 'square', f: T(p.pitch * 2, p.pitch * 0.5, { time: p.len }), pw: 0.5, amp: 0.4, env: { attack: 0.001, decay: p.len * 0.8 } })],
  post: { peakDb: -3 },
}));

fam('retro-explosion', 'Retro Explosion', 'Game & Retro', 'Game & Retro/Impacts', ['explosion', '8-bit', 'game', 'retro'], 10, [P('len', 0.4, 1.6, 'short', 'long'), P('crush', 0, 1, 'clean', 'crushed')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.8, crush: { bits: 6 - p.crush * 2, down: 3 + Math.round(p.crush * 6) }, env: { attack: 0.002, decay: p.len * 0.9 }, filter: { type: 'lp', f: T(6000, 120, { time: p.len }) } }), mk({ src: 'square', f: T(110, 30, { time: p.len * 0.7 }), amp: 0.4, env: { attack: 0.001, decay: p.len * 0.6 } })],
  post: { peakDb: -3 },
}));

fam('retro-laser', 'Retro Laser', 'Game & Retro', 'Game & Retro/Weapons', ['laser', 'shoot', '8-bit', 'game'], 10, [P('pitch', 600, 3000, 'low', 'high', { log: true }), P('len', 0.08, 0.3, 'short', 'long'), P('wobble', 0, 1, 'straight', 'wobbly')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'square', f: T(p.pitch, p.pitch * 0.12, { time: p.len, curve: 0.7 }), pw: 0.5, vib: { rate: 30, depth: p.wobble * 400 }, amp: 0.45, env: { attack: 0.001, hold: p.len * 0.2, decay: p.len * 0.6 } })],
  post: { peakDb: -4 },
}));

fam('levelup', 'Level Up', 'Game & Retro', 'Game & Retro/Jingles', ['level', 'win', 'fanfare', '8-bit', 'game'], 8, [P('pitch', 220, 520, 'low', 'high', { log: true }), P('speed', 0.07, 0.14, 'fast', 'slow')], (p) => {
  const notes = [0, 4, 7, 12, 7, 12, 16];
  const layers = notes.map((s, i) => mk({ src: 'square', f: T(p.pitch * Math.pow(2, s / 12)), pw: 0.5, amp: 0.35, env: { delay: i * p.speed, attack: 0.001, hold: p.speed * (i === notes.length - 1 ? 4 : 0.7), decay: i === notes.length - 1 ? 0.25 : 0.02 } }));
  return { length: notes.length * p.speed + 0.5, layers, post: { peakDb: -4 } };
});

fam('gameover', 'Game Over', 'Game & Retro', 'Game & Retro/Jingles', ['game over', 'lose', 'fail', '8-bit', 'game'], 8, [P('pitch', 200, 500, 'low', 'high', { log: true }), P('speed', 0.14, 0.3, 'fast', 'slow')], (p) => {
  const notes = [7, 5, 3, 0];
  const layers = notes.map((s, i) => mk({ src: 'square', f: T(p.pitch * Math.pow(2, s / 12)), pw: 0.5, amp: 0.35, env: { delay: i * p.speed, attack: 0.002, hold: p.speed * (i === 3 ? 3 : 0.8), decay: i === 3 ? 0.3 : 0.04 }, vib: i === 3 ? { rate: 6, depth: 30 } : undefined }));
  return { length: notes.length * p.speed + 0.8, layers, post: { peakDb: -4 } };
});

fam('menu-blip', 'Menu Blip', 'Game & Retro', 'Game & Retro/Menu', ['menu', 'select', 'blip', '8-bit', 'game'], 8, [P('pitch', 400, 1400, 'low', 'high', { log: true }), P('len', 0.04, 0.14, 'tiny', 'short'), P('dir', 0, 1, 'down', 'up')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'square', f: T(p.pitch, p.pitch * (p.dir > 0.5 ? 1.5 : 0.7), { time: p.len }), pw: 0.5, amp: 0.4, env: { attack: 0.001, hold: p.len * 0.6, decay: p.len * 0.3 } })],
  post: { peakDb: -5 },
}));

// =============================================================== FOLEY
fam('footstep', 'Footstep', 'Foley', 'Foley/Footsteps', ['footstep', 'step', 'walk', 'foley'], 18, [P('surface', 0, 1, 'hard floor', 'gravel'), P('weight', 0, 1, 'light', 'heavy'), P('len', 0.12, 0.35, 'quick', 'slow')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'sine', f: T(110 - p.weight * 50, 50, { time: 0.05 }), amp: 0.5 + p.weight * 0.5, env: { attack: 0.001, decay: 0.09 } }),
    mk({ src: 'noise', amp: 0.5, env: { attack: 0.0006, decay: 0.03 + (1 - p.surface) * 0.01 }, filter: { type: 'bp', f: T(1800 + (1 - p.surface) * 2500), q: 0.8 } }),
    mk({ src: 'noise', amp: 0.4 * p.surface, grains: { rate: 220, decay: 0.006 }, env: { attack: 0.002, decay: p.len }, filter: { type: 'hp', f: T(1800) }, stereo: 0.6 }),
  ],
  post: { reverb: { size: 0.5, decay: 0.4, mix: 0.08 }, peakDb: -4 },
}));

fam('knock', 'Door Knock', 'Foley', 'Foley/Doors', ['knock', 'door', 'foley'], 10, [P('count', 2, 4, 'two', 'four', { int: true }), P('pitch', 150, 500, 'low', 'high', { log: true }), P('gap', 0.11, 0.3, 'fast', 'slow'), P('weight', 0, 1, 'light', 'heavy')], (p) => {
  const r = new Rng(Math.round(p.pitch));
  const layers: Layer[] = [];
  for (let i = 0; i < p.count; i++) {
    const d = i * p.gap * (0.9 + r.next() * 0.25);
    layers.push(mk({ src: 'modal', f: T(p.pitch * (1 + (r.next() - 0.5) * 0.04)), modes: [[1, 1, 1], [2.3, 0.5, 0.5], [4.2, 0.25, 0.3]], amp: 0.8, env: { delay: d, attack: 0.0005, decay: 0.12 + p.weight * 0.1 } }), mk({ src: 'noise', amp: 0.35, env: { delay: d, attack: 0.0003, decay: 0.015 }, filter: { type: 'bp', f: T(p.pitch * 5), q: 1 } }));
  }
  return { length: p.count * p.gap + 0.3, layers, post: { reverb: { size: 0.6, decay: 0.5, mix: 0.12 }, peakDb: -3 } };
});

fam('switch', 'Switch Click', 'Foley', 'Foley/Mechanical', ['switch', 'click', 'button', 'foley'], 8, [P('pitch', 1000, 4000, 'low', 'high', { log: true }), P('len', 0.03, 0.12, 'tight', 'loose')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.7, env: { attack: 0.0003, decay: 0.008 }, filter: { type: 'bp', f: T(p.pitch), q: 1.5 } }), mk({ src: 'noise', amp: 0.6, env: { delay: p.len * 0.55, attack: 0.0003, decay: 0.01 }, filter: { type: 'bp', f: T(p.pitch * 0.7), q: 1.5 } }), mk({ src: 'sine', f: T(260, 120), amp: 0.3, env: { attack: 0.0005, decay: p.len * 0.8 } })],
  post: { peakDb: -4 },
}));

fam('cloth', 'Cloth Rustle', 'Foley', 'Foley/Cloth & Paper', ['cloth', 'rustle', 'fabric', 'foley'], 8, [P('len', 0.2, 1.2, 'short', 'long'), P('pitch', 1500, 6000, 'soft', 'crisp', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.8, grains: { rate: 45, decay: 0.02 }, env: { attack: 0.02, decay: p.len, shape: 'hann', peak: 0.4 }, filter: { type: 'bp', f: T(p.pitch), q: 0.5 }, stereo: 1 })],
  post: { peakDb: -6 },
}));

fam('glass-clink', 'Glass Clink', 'Foley', 'Foley/Glass', ['glass', 'clink', 'toast', 'foley'], 10, [P('pitch', 1800, 5200, 'low', 'high', { log: true }), P('len', 0.15, 0.8, 'short', 'ringing')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'modal', f: T(p.pitch), modes: [[1, 1, 1], [2.32, 0.5, 0.7], [4.25, 0.3, 0.5], [6.63, 0.15, 0.3]], amp: 0.8, env: { attack: 0.0005, decay: p.len } }), mk({ src: 'noise', amp: 0.25, env: { attack: 0.0003, decay: 0.008 }, filter: { type: 'hp', f: T(5000) } })],
  post: { reverb: { size: 0.6, decay: 0.7, mix: 0.18 }, peakDb: -4 },
}));

fam('keys-jingle', 'Keys Jingle', 'Foley', 'Foley/Metal', ['keys', 'jingle', 'metal', 'foley'], 8, [P('len', 0.4, 1.4, 'short', 'long'), P('pitch', 2000, 5000, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'metal', f: T(p.pitch), partials: 10, amp: 0.6, grains: { rate: 22, decay: 0.05 }, env: { attack: 0.001, decay: p.len }, filter: { type: 'hp', f: T(1500) }, stereo: 0.5 })],
  post: { reverb: { size: 0.5, decay: 0.5, mix: 0.1 }, peakDb: -5 },
}));

fam('paper', 'Paper Crumple', 'Foley', 'Foley/Cloth & Paper', ['paper', 'crumple', 'foley'], 8, [P('len', 0.3, 1.6, 'short', 'long'), P('density', 60, 240, 'sparse', 'dense', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.9, grains: { rate: p.density, decay: 0.008 }, env: { attack: 0.01, decay: p.len, shape: 'hann', peak: 0.3 }, filter: { type: 'hp', f: T(2200) }, stereo: 1 })],
  post: { peakDb: -5 },
}));

fam('heartbeat', 'Heartbeat', 'Foley', 'Foley/Body', ['heartbeat', 'pulse', 'body', 'horror'], 8, [P('bpm', 48, 120, 'slow', 'fast'), P('beats', 2, 6, 'few', 'many', { int: true }), P('weight', 0, 1, 'soft', 'heavy')], (p) => {
  const period = 60 / p.bpm;
  const layers: Layer[] = [];
  for (let i = 0; i < p.beats; i++) {
    const t = i * period;
    layers.push(mk({ src: 'sine', f: T(70, 40, { time: 0.08 }), amp: 0.9, env: { delay: t, attack: 0.004, decay: 0.12 } }), mk({ src: 'sine', f: T(62, 36, { time: 0.08 }), amp: 0.6, env: { delay: t + period * 0.22, attack: 0.004, decay: 0.1 } }), mk({ src: 'brown', amp: 0.15 * p.weight, env: { delay: t, attack: 0.005, decay: 0.1 }, filter: { type: 'lp', f: T(300) } }));
  }
  return { length: p.beats * period + 0.2, layers, post: { reverb: { size: 0.6, decay: 0.5, mix: 0.1 }, peakDb: -3 } };
});

fam('breath', 'Breath', 'Foley', 'Foley/Body', ['breath', 'inhale', 'exhale', 'body'], 8, [P('len', 0.5, 2, 'short', 'long'), P('dir', 0, 1, 'exhale', 'inhale'), P('tone', 600, 1800, 'dark', 'bright', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'pink', amp: 0.9, env: { decay: p.len, shape: 'hann', peak: p.dir > 0.5 ? 0.8 : 0.3 }, filter: { type: 'bp', f: T(p.tone, p.tone * 1.3), q: 0.9 }, stereo: 0.4 }), mk({ src: 'noise', amp: 0.2, env: { decay: p.len, shape: 'hann', peak: p.dir > 0.5 ? 0.8 : 0.3 }, filter: { type: 'bp', f: T(p.tone * 2.6), q: 1 } })],
  post: { peakDb: -6 },
}));

// =============================================================== NATURE
fam('wind', 'Wind Gust', 'Nature', 'Nature/Wind', ['wind', 'gust', 'weather', 'ambience'], 12, [P('len', 2, 7, 'short', 'long'), P('pitch', 220, 1100, 'low', 'high', { log: true }), P('howl', 0, 1, 'soft', 'howling')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'pink', amp: 0.9, env: { decay: p.len, shape: 'hann', peak: 0.45 }, filter: { type: 'bp', f: T(p.pitch * 0.7, p.pitch * 1.4, { curve: 1.2 }), q: 0.9 + p.howl * 3 }, stereo: 1 }),
    mk({ src: 'sine', f: T(p.pitch * 1.6, p.pitch * 1.9), vib: { rate: 0.6, depth: 90 }, amp: 0.1 * p.howl, env: { decay: p.len, shape: 'hann', peak: 0.5 } }),
  ],
  post: { reverb: { size: 1.4, decay: 1.6, mix: 0.18 }, peakDb: -5 },
}));

fam('rain', 'Rain', 'Nature', 'Nature/Water', ['rain', 'weather', 'ambience', 'water'], 10, [P('len', 3, 8, 'short', 'long'), P('density', 200, 1400, 'light', 'heavy', { log: true }), P('bright', 0, 1, 'dull', 'bright')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.7, grains: { rate: p.density, decay: 0.004 }, env: { attack: 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'hp', f: T(1500 + p.bright * 3000) }, stereo: 1 }),
    mk({ src: 'pink', amp: 0.35, env: { attack: 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(3200 + p.bright * 2000), q: 0.4 }, stereo: 1 }),
  ],
  post: { reverb: { size: 1, decay: 1, mix: 0.1 }, peakDb: -6 },
}));

fam('thunder', 'Thunder', 'Nature', 'Nature/Weather', ['thunder', 'storm', 'weather', 'rumble'], 10, [P('len', 2.5, 7, 'short', 'long'), P('dist', 0, 1, 'close', 'far'), P('rolls', 1, 4, 'one', 'several', { int: true })], (p) => {
  const r = new Rng(Math.round(p.len * 100));
  const layers: Layer[] = [];
  for (let i = 0; i < p.rolls; i++) {
    const d = i * (p.len / (p.rolls + 1)) * (0.7 + r.next() * 0.5);
    layers.push(mk({ src: 'brown', amp: 0.9 / (1 + i * 0.4), env: { delay: d, attack: 0.05 + p.dist * 0.4, decay: p.len * 0.55 }, filter: { type: 'lp', f: T(600 - p.dist * 350, 70, { time: p.len }) }, stereo: 1 }));
  }
  layers.push(mk({ src: 'noise', amp: 0.7 * (1 - p.dist), env: { attack: 0.002, decay: 0.4 }, filter: { type: 'lp', f: T(4000, 300, { time: 0.4 }) }, stereo: 1 }));
  return { length: p.len, layers, post: { reverb: { size: 2, decay: 3, mix: 0.3 }, peakDb: -2 } };
});

fam('waves', 'Ocean Wave', 'Nature', 'Nature/Water', ['ocean', 'wave', 'sea', 'water', 'ambience'], 8, [P('len', 3, 8, 'short', 'long'), P('bright', 0, 1, 'deep', 'foamy')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'pink', amp: 0.9, env: { decay: p.len, shape: 'hann', peak: 0.55 }, filter: { type: 'lp', f: T(700, 2600 + p.bright * 3000, { time: p.len * 0.55 }), q: 0.7 }, stereo: 1 }),
    mk({ src: 'noise', amp: 0.35, env: { decay: p.len, shape: 'hann', peak: 0.6 }, filter: { type: 'hp', f: T(4000) }, stereo: 1 }),
  ],
  post: { reverb: { size: 1.2, decay: 1.5, mix: 0.12 }, peakDb: -5 },
}));

fam('fire', 'Fire Crackle', 'Nature', 'Nature/Fire', ['fire', 'crackle', 'campfire', 'ambience'], 8, [P('len', 2, 6, 'short', 'long'), P('density', 12, 70, 'sparse', 'busy', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.9, grains: { rate: p.density, decay: 0.01 }, env: { attack: 0.05, decay: p.len, sustain: 0.9, hold: p.len * 0.7 }, filter: { type: 'bp', f: T(3500), q: 0.5 }, stereo: 1 }),
    mk({ src: 'brown', amp: 0.5, env: { attack: 0.1, decay: p.len, sustain: 0.8, hold: p.len * 0.6 }, filter: { type: 'lp', f: T(380) } }),
  ],
  post: { reverb: { size: 0.8, decay: 0.8, mix: 0.1 }, peakDb: -5 },
}));

fam('water-drop', 'Water Drop', 'Nature', 'Nature/Water', ['water', 'drop', 'drip', 'bubble'], 14, [P('pitch', 500, 2200, 'low', 'high', { log: true }), P('len', 0.1, 0.5, 'short', 'long'), P('rise', 1.5, 3.2, 'gentle', 'steep')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch, p.pitch * p.rise, { time: p.len * 0.3, curve: 0.5 }), amp: 0.8, env: { attack: 0.002, decay: p.len } }), mk({ src: 'noise', amp: 0.08, env: { attack: 0.0005, decay: 0.01 }, filter: { type: 'bp', f: T(p.pitch * 3), q: 1.5 } })],
  post: { reverb: { size: 0.8, decay: 0.9, mix: 0.2 }, peakDb: -4 },
}));

fam('stream', 'Stream Babble', 'Nature', 'Nature/Water', ['stream', 'river', 'water', 'ambience'], 6, [P('len', 3, 8, 'short', 'long'), P('bright', 0, 1, 'deep', 'sparkling')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'pink', amp: 0.7, env: { attack: 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(900 + p.bright * 900), q: 0.5 }, am: { rate: 3.2, depth: 0.4 }, stereo: 1 }),
    mk({ src: 'noise', amp: 0.4, grains: { rate: 150, decay: 0.006 }, env: { attack: 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(2800 + p.bright * 2500), q: 1.2 }, stereo: 1 }),
  ],
  post: { peakDb: -6 },
}));

fam('birds', 'Bird Chirp', 'Nature', 'Nature/Animals', ['bird', 'chirp', 'tweet', 'forest', 'animal'], 12, [P('pitch', 2200, 5600, 'low', 'high', { log: true }), P('notes', 2, 5, 'few', 'many', { int: true }), P('speed', 0.06, 0.16, 'fast', 'slow')], (p) => {
  const r = new Rng(Math.round(p.pitch));
  const layers: Layer[] = [];
  for (let i = 0; i < p.notes; i++) {
    const f = p.pitch * (0.85 + r.next() * 0.4);
    const up = r.chance(0.6);
    layers.push(mk({ src: 'fm', f: T(f, f * (up ? 1.5 : 0.7), { time: p.speed * 0.8 }), ratio: 1, index: T(1.2, 0.2), amp: 0.5, env: { delay: i * p.speed * 1.3, attack: 0.004, decay: p.speed * 0.9 } }));
  }
  return { length: p.notes * p.speed * 1.3 + 0.1, layers, post: { reverb: { size: 1.2, decay: 1.2, mix: 0.2 }, peakDb: -5 } };
});

fam('crickets', 'Crickets', 'Nature', 'Nature/Animals', ['crickets', 'night', 'insects', 'ambience'], 6, [P('len', 3, 8, 'short', 'long'), P('pitch', 3800, 5600, 'low', 'high', { log: true }), P('rate', 40, 100, 'slow', 'fast')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch), amp: 0.5, am: { rate: p.rate, depth: 1 }, gate: { rate: 3.2, duty: 0.55 }, env: { attack: 0.5, decay: p.len, sustain: 0.9, hold: p.len * 0.6 } })],
  post: { reverb: { size: 1.2, decay: 1.2, mix: 0.2 }, peakDb: -9 },
}));

fam('cave-drip', 'Cave Drip', 'Nature', 'Nature/Water', ['cave', 'drip', 'water', 'reverb'], 6, [P('pitch', 500, 1800, 'low', 'high', { log: true }), P('len', 0.2, 0.6, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch, p.pitch * 2.3, { time: p.len * 0.2, curve: 0.5 }), amp: 0.8, env: { attack: 0.002, decay: p.len } })],
  post: { reverb: { size: 2.2, decay: 4, mix: 0.6, damp: 0.5 }, delay: { time: 0.22, feedback: 0.35, mix: 0.2 }, peakDb: -5 },
}));

// =============================================================== MECHANICAL
fam('motor', 'Motor Spin-up', 'Mechanical', 'Mechanical/Motors', ['motor', 'spin', 'machine', 'engine'], 10, [P('len', 1, 4, 'short', 'long'), P('pitch', 40, 200, 'low', 'high', { log: true }), P('whine', 0, 1, 'dull', 'whining')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch * 0.4, p.pitch * 2.4, { curve: 0.7 }), detune: 6, amp: 0.6, env: { attack: 0.02, decay: p.len, sustain: 0.8, hold: p.len * 0.6 }, filter: { type: 'lp', f: T(300, 2200, { curve: 0.7 }), q: 1.4 } }),
    mk({ src: 'square', f: T(p.pitch * 4, p.pitch * 24, { curve: 0.7 }), pw: 0.2, amp: 0.1 + p.whine * 0.15, env: { attack: 0.05, decay: p.len, sustain: 0.7, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(1000, 6000), q: 3 } }),
    mk({ src: 'noise', amp: 0.12, env: { attack: 0.05, decay: p.len, sustain: 0.8, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(900), q: 0.7 } }),
  ],
  post: { reverb: { size: 0.8, decay: 0.6, mix: 0.1 }, peakDb: -4 },
}));

fam('engine', 'Engine Idle', 'Mechanical', 'Mechanical/Engines', ['engine', 'idle', 'vehicle', 'motor'], 10, [P('len', 2, 5, 'short', 'long'), P('rpm', 600, 2500, 'slow', 'fast', { log: true }), P('rough', 0, 1, 'smooth', 'rough')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'square', f: T(p.rpm / 60 * 2), pw: 0.15, amp: 0.7, vib: { rate: 3, depth: 25 + p.rough * 120 }, env: { attack: 0.1, decay: p.len, sustain: 0.9, hold: p.len * 0.7 }, filter: { type: 'lp', f: T(380 + p.rpm * 0.2), q: 1.2 } }),
    mk({ src: 'brown', amp: 0.5 + p.rough * 0.3, env: { attack: 0.1, decay: p.len, sustain: 0.9, hold: p.len * 0.7 }, filter: { type: 'lp', f: T(260) }, am: { rate: p.rpm / 60 * 2, depth: 0.4 } }),
    mk({ src: 'noise', amp: 0.1, env: { attack: 0.1, decay: p.len, sustain: 0.9, hold: p.len * 0.7 }, filter: { type: 'bp', f: T(1800), q: 0.6 } }),
  ],
  post: { reverb: { size: 0.9, decay: 0.7, mix: 0.1 }, peakDb: -5 },
}));

fam('ratchet', 'Ratchet Clicks', 'Mechanical', 'Mechanical/Gears', ['ratchet', 'gear', 'click', 'mechanical'], 8, [P('rate', 10, 40, 'slow', 'fast'), P('len', 0.3, 1.5, 'short', 'long'), P('pitch', 1200, 4000, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.8, gate: { rate: p.rate, duty: 0.12 }, env: { attack: 0.0005, decay: p.len }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 0.7, { time: p.len }), q: 1.8 } }), mk({ src: 'sine', f: T(150), amp: 0.2, gate: { rate: p.rate, duty: 0.15 }, env: { attack: 0.0005, decay: p.len } })],
  post: { peakDb: -4 },
}));

fam('siren', 'Siren', 'Mechanical', 'Mechanical/Alarms', ['siren', 'alarm', 'emergency', 'alert'], 10, [P('pitch', 500, 1200, 'low', 'high', { log: true }), P('rate', 0.3, 2.4, 'slow', 'fast'), P('len', 2, 5, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'saw', f: T(p.pitch), vib: { rate: p.rate, depth: 400 }, amp: 0.5, env: { attack: 0.1, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'lp', f: T(3500), q: 1 } })],
  post: { reverb: { size: 1.2, decay: 1.2, mix: 0.18 }, peakDb: -4 },
}));

fam('fan', 'Fan Hum', 'Mechanical', 'Mechanical/Hum', ['fan', 'hum', 'air', 'ventilation'], 8, [P('len', 3, 8, 'short', 'long'), P('speed', 0, 1, 'slow', 'fast')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'pink', amp: 0.7, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(500 + p.speed * 900), q: 0.5 }, stereo: 0.6 }), mk({ src: 'sine', f: T(110 + p.speed * 90), amp: 0.12, am: { rate: 6 + p.speed * 14, depth: 0.3 }, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.6 } })],
  post: { peakDb: -7 },
}));

fam('machine-hum', 'Machine Hum', 'Mechanical', 'Mechanical/Hum', ['machine', 'hum', 'electric', 'transformer'], 8, [P('len', 3, 8, 'short', 'long'), P('pitch', 50, 120, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [1, 2, 3, 4, 6].map((h, i) => mk({ src: 'sine', f: T(p.pitch * h * (1 + i * 0.0007)), amp: 0.4 / h, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.6 } })).concat([mk({ src: 'noise', amp: 0.04, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.6 }, filter: { type: 'bp', f: T(2000), q: 1 } })]),
  post: { peakDb: -7 },
}));

fam('clock', 'Clock Tick', 'Mechanical', 'Mechanical/Clocks', ['clock', 'tick', 'tock', 'time'], 8, [P('rate', 0.8, 2.5, 'slow', 'fast'), P('count', 4, 10, 'few', 'many', { int: true }), P('pitch', 1800, 4200, 'low', 'high', { log: true })], (p) => {
  const layers: Layer[] = [];
  for (let i = 0; i < p.count; i++) layers.push(mk({ src: 'modal', f: T(p.pitch * (i % 2 ? 0.85 : 1)), modes: [[1, 1, 1], [2.7, 0.4, 0.5]], amp: 0.7, env: { delay: i / p.rate, attack: 0.0003, decay: 0.03 } }), mk({ src: 'noise', amp: 0.3, env: { delay: i / p.rate, attack: 0.0003, decay: 0.006 }, filter: { type: 'bp', f: T(p.pitch * 1.5), q: 1.5 } }));
  return { length: p.count / p.rate + 0.1, layers, post: { reverb: { size: 0.5, decay: 0.4, mix: 0.08 }, peakDb: -5 } };
});

fam('steam', 'Steam Hiss', 'Mechanical', 'Mechanical/Pneumatic', ['steam', 'hiss', 'air', 'release'], 8, [P('len', 0.4, 2.4, 'short', 'long'), P('pitch', 3000, 9000, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.9, env: { attack: 0.01, decay: p.len, shape: 'hann', peak: 0.1 }, filter: { type: 'hp', f: T(p.pitch * 0.4, p.pitch * 0.8, { time: p.len }) }, stereo: 1 })],
  post: { reverb: { size: 0.8, decay: 0.7, mix: 0.1 }, peakDb: -5 },
}));

fam('piston', 'Hydraulic Piston', 'Mechanical', 'Mechanical/Pneumatic', ['piston', 'hydraulic', 'machine', 'thump'], 8, [P('pitch', 60, 160, 'low', 'high', { log: true }), P('len', 0.3, 1.1, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch * 1.6, p.pitch, { time: 0.06 }), amp: 0.9, env: { attack: 0.001, decay: 0.16 } }), mk({ src: 'noise', amp: 0.6, env: { delay: 0.01, attack: 0.002, decay: p.len }, filter: { type: 'hp', f: T(3500) }, stereo: 1 }), mk({ src: 'metal', f: T(420), partials: 6, amp: 0.15, env: { attack: 0.001, decay: 0.2 }, filter: { type: 'hp', f: T(500) } })],
  post: { reverb: { size: 0.9, decay: 0.8, mix: 0.15 }, peakDb: -3 },
}));

fam('horn', 'Horn Honk', 'Mechanical', 'Mechanical/Alarms', ['horn', 'honk', 'vehicle', 'car'], 8, [P('pitch', 200, 520, 'low', 'high', { log: true }), P('len', 0.3, 1.3, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'saw', f: T(p.pitch), detune: 4, amp: 0.5, env: { attack: 0.01, hold: p.len * 0.6, decay: 0.06 }, filter: { type: 'lp', f: T(2400), q: 1.2 } }), mk({ src: 'saw', f: T(p.pitch * 1.26), detune: -4, amp: 0.45, env: { attack: 0.01, hold: p.len * 0.6, decay: 0.06 }, filter: { type: 'lp', f: T(2400), q: 1.2 } })],
  post: { reverb: { size: 0.8, decay: 0.7, mix: 0.1 }, peakDb: -3 },
}));

// =============================================================== MAGIC
fam('sparkle', 'Sparkle', 'Magic & Fantasy', 'Magic & Fantasy/Sparkles', ['sparkle', 'magic', 'glitter', 'fairy'], 12, [P('len', 0.5, 2.6, 'short', 'long'), P('pitch', 1800, 6000, 'low', 'high', { log: true }), P('density', 8, 40, 'sparse', 'dense', { log: true })], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'metal', f: T(p.pitch), partials: 8, amp: 0.7, grains: { rate: p.density, decay: 0.12 }, env: { attack: 0.005, decay: p.len, shape: 'hann', peak: 0.2 }, filter: { type: 'hp', f: T(1500) }, stereo: 1 }),
    mk({ src: 'sine', f: T(p.pitch * 1.5), amp: 0.2, grains: { rate: p.density * 0.6, decay: 0.2 }, env: { attack: 0.005, decay: p.len, shape: 'hann', peak: 0.2 }, stereo: 1 }),
  ],
  post: { reverb: { size: 1.3, decay: 1.8, mix: 0.3 }, delay: { time: 0.18, feedback: 0.3, mix: 0.15 }, widen: 1.4, peakDb: -5 },
}));

fam('spell', 'Spell Cast', 'Magic & Fantasy', 'Magic & Fantasy/Spells', ['spell', 'magic', 'cast', 'fantasy'], 12, [P('len', 0.6, 2.6, 'quick', 'long'), P('pitch', 300, 1400, 'low', 'high', { log: true }), P('shimmer', 0, 1, 'smooth', 'shimmering')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.6, env: { decay: p.len, shape: 'hann', peak: 0.75 }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 6, { curve: 1.4 }), q: 1.4 }, stereo: 1 }),
    mk({ src: 'fm', f: T(p.pitch, p.pitch * 2.5, { curve: 1.2 }), ratio: 2.01, index: T(1, 4), amp: 0.35, am: { rate: 6 + p.shimmer * 20, depth: p.shimmer * 0.5 }, env: { decay: p.len, shape: 'hann', peak: 0.75 } }),
    mk({ src: 'metal', f: T(p.pitch * 5), partials: 8, amp: 0.2 * p.shimmer, env: { delay: p.len * 0.7, attack: 0.002, decay: p.len * 0.5 }, filter: { type: 'hp', f: T(2500) } }),
  ],
  post: { reverb: { size: 1.4, decay: 2, mix: 0.3 }, widen: 1.3, peakDb: -4 },
}));

fam('magic-chime', 'Magic Chime', 'Magic & Fantasy', 'Magic & Fantasy/Chimes', ['chime', 'magic', 'bell', 'fantasy'], 10, [P('pitch', 700, 2200, 'low', 'high', { log: true }), P('len', 0.8, 2.6, 'short', 'long'), P('glide', 0.5, 2, 'small', 'large')], (p) => ({
  length: p.len,
  layers: [0, 4, 7, 12].map((s, i) => mk({ src: 'metal', f: T(p.pitch * Math.pow(2, s / 12)), partials: 6, spread: 0.5, amp: 0.4, env: { delay: i * 0.08 * p.glide, attack: 0.001, decay: p.len }, filter: { type: 'lp', f: T(9000) } })),
  post: { reverb: { size: 1.3, decay: 2, mix: 0.3 }, peakDb: -4 },
}));

fam('heal', 'Heal', 'Magic & Fantasy', 'Magic & Fantasy/Spells', ['heal', 'restore', 'magic', 'positive'], 8, [P('pitch', 250, 700, 'low', 'high', { log: true }), P('len', 0.8, 2.2, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [0, 4, 7, 12, 16].map((s, i) => mk({ src: 'tri', f: T(p.pitch * Math.pow(2, s / 12)), amp: 0.35, vib: { rate: 5.5, depth: 12 }, env: { delay: i * 0.1, attack: 0.04, decay: p.len, shape: 'hann', peak: 0.35 } })).concat([mk({ src: 'metal', f: T(p.pitch * 8), partials: 6, amp: 0.15, env: { delay: 0.3, attack: 0.002, decay: 0.9 }, filter: { type: 'hp', f: T(3000) } })]),
  post: { reverb: { size: 1.4, decay: 2, mix: 0.3 }, peakDb: -5 },
}));

fam('curse', 'Dark Curse', 'Magic & Fantasy', 'Magic & Fantasy/Spells', ['curse', 'dark', 'spell', 'evil'], 8, [P('pitch', 80, 300, 'low', 'high', { log: true }), P('len', 0.8, 2.6, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch * 2, p.pitch * 0.5, { curve: 0.6 }), detune: 30, amp: 0.55, ring: { f: p.pitch * 1.5, depth: 0.5 }, env: { attack: 0.03, decay: p.len }, filter: { type: 'lp', f: T(2800, 200, { time: p.len }), q: 2 } }),
    mk({ src: 'noise', amp: 0.25, env: { attack: 0.02, decay: p.len * 0.7 }, filter: { type: 'bp', f: T(900, 150, { time: p.len }), q: 2 }, stereo: 1 }),
  ],
  post: { reverb: { size: 1.5, decay: 2.2, mix: 0.3 }, peakDb: -3 },
}));

fam('portal', 'Portal Swirl', 'Magic & Fantasy', 'Magic & Fantasy/Portals', ['portal', 'swirl', 'magic', 'warp'], 8, [P('len', 1, 4, 'short', 'long'), P('pitch', 200, 900, 'low', 'high', { log: true }), P('swirl', 2, 12, 'slow', 'fast')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.6, env: { attack: 0.2, decay: p.len, shape: 'hann', peak: 0.5 }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 5), q: 2.5 }, am: { rate: p.swirl, depth: 0.6 }, stereo: 1 }),
    mk({ src: 'fm', f: T(p.pitch * 0.5, p.pitch), ratio: 1.01, index: T(2, 6), amp: 0.3, am: { rate: p.swirl * 0.5, depth: 0.5 }, env: { attack: 0.2, decay: p.len, shape: 'hann', peak: 0.5 } }),
  ],
  post: { reverb: { size: 1.6, decay: 2.2, mix: 0.3 }, widen: 1.5, peakDb: -4 },
}));

// =============================================================== MUSICAL FX
fam('cymbal-swell', 'Cymbal Swell', 'Music FX', 'Music FX/Cymbals', ['cymbal', 'swell', 'crash', 'build'], 8, [P('len', 1, 4, 'short', 'long'), P('tone', 0, 1, 'dark', 'bright')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'metal', f: T(330 + p.tone * 220), partials: 14, spread: 1.4, amp: 0.55, env: { decay: p.len, shape: 'hann', peak: 0.7 }, filter: { type: 'hp', f: T(1800) } }), mk({ src: 'noise', amp: 0.55, env: { decay: p.len, shape: 'hann', peak: 0.7 }, filter: { type: 'hp', f: T(4000 + p.tone * 3000) }, stereo: 1 })],
  post: { reverb: { size: 1.1, decay: 1.5, mix: 0.2 }, peakDb: -4 },
}));

fam('vinyl', 'Vinyl Crackle', 'Music FX', 'Music FX/Textures', ['vinyl', 'crackle', 'lofi', 'texture'], 8, [P('len', 3, 8, 'short', 'long'), P('density', 4, 40, 'sparse', 'busy', { log: true }), P('hiss', 0, 1, 'clean', 'hissy')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'noise', amp: 0.8, grains: { rate: p.density, decay: 0.004 }, env: { attack: 0.05, decay: p.len, sustain: 0.95, hold: p.len * 0.8 }, filter: { type: 'hp', f: T(1500) }, stereo: 1 }),
    mk({ src: 'pink', amp: 0.06 + p.hiss * 0.12, env: { attack: 0.05, decay: p.len, sustain: 0.95, hold: p.len * 0.8 }, filter: { type: 'hp', f: T(2500) }, stereo: 1 }),
    mk({ src: 'brown', amp: 0.05, env: { attack: 0.05, decay: p.len, sustain: 0.95, hold: p.len * 0.8 }, filter: { type: 'lp', f: T(120) } }),
  ],
  post: { peakDb: -10 },
}));

fam('sub-drop', 'Sub Drop', 'Music FX', 'Music FX/Drops', ['sub', 'drop', 'bass', 'impact', 'edm'], 10, [P('pitch', 60, 120, 'low', 'high', { log: true }), P('len', 0.6, 2.6, 'short', 'long'), P('drive', 0, 1, 'clean', 'dirty')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch, 24, { curve: 0.45 }), amp: 1, drive: p.drive * 3, env: { attack: 0.003, decay: p.len } }), mk({ src: 'noise', amp: 0.2, env: { attack: 0.001, decay: 0.05 }, filter: { type: 'lp', f: T(1500) } })],
  post: { peakDb: -2 },
}));

fam('bass-drop', 'Bass Drop', 'Music FX', 'Music FX/Drops', ['bass', 'drop', 'edm', 'dubstep', 'impact'], 8, [P('pitch', 50, 110, 'low', 'high', { log: true }), P('len', 0.8, 2.6, 'short', 'long'), P('growl', 0, 1, 'smooth', 'growling')], (p) => ({
  length: p.len,
  layers: [
    mk({ src: 'saw', f: T(p.pitch * 2, p.pitch * 0.5, { curve: 0.5 }), detune: 18, amp: 0.7, drive: 1 + p.growl * 4, env: { attack: 0.005, decay: p.len }, filter: { type: 'lp', f: T(2800, 200, { time: p.len }), q: 2 + p.growl * 4 } }),
    mk({ src: 'sine', f: T(p.pitch, 28, { curve: 0.5 }), amp: 0.8, env: { attack: 0.003, decay: p.len } }),
  ],
  post: { peakDb: -2 },
}));

fam('gong', 'Gong', 'Music FX', 'Music FX/Metal', ['gong', 'metal', 'bell', 'cinematic'], 8, [P('pitch', 70, 200, 'low', 'high', { log: true }), P('len', 3, 9, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'metal', f: T(p.pitch), partials: 12, spread: 1.6, amp: 0.8, env: { attack: 0.005, decay: p.len }, filter: { type: 'lp', f: T(6000, 1500, { time: p.len }) } }), mk({ src: 'noise', amp: 0.25, env: { attack: 0.01, decay: p.len * 0.3 }, filter: { type: 'bp', f: T(1800), q: 0.5 }, stereo: 1 })],
  post: { reverb: { size: 1.6, decay: 3, mix: 0.25 }, peakDb: -3 },
}));

fam('bell-toll', 'Bell Toll', 'Music FX', 'Music FX/Metal', ['bell', 'toll', 'church', 'ring'], 10, [P('pitch', 150, 600, 'low', 'high', { log: true }), P('len', 3, 8, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'modal', f: T(p.pitch), modes: [[0.5, 0.5, 1.2], [1, 1, 1], [1.183, 0.7, 0.8], [1.506, 0.55, 0.7], [2, 0.9, 0.55], [2.514, 0.35, 0.35], [3.011, 0.3, 0.3], [4.166, 0.2, 0.2]], amp: 0.9, env: { attack: 0.002, decay: p.len } }), mk({ src: 'noise', amp: 0.2, env: { attack: 0.0005, decay: 0.03 }, filter: { type: 'bp', f: T(p.pitch * 6), q: 1 } })],
  post: { reverb: { size: 1.5, decay: 2.5, mix: 0.25 }, peakDb: -3 },
}));

fam('bowl', 'Singing Bowl', 'Music FX', 'Music FX/Metal', ['bowl', 'meditation', 'singing', 'tibetan'], 6, [P('pitch', 180, 620, 'low', 'high', { log: true }), P('len', 4, 10, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch), amp: 0.7, am: { rate: 1.7, depth: 0.25 }, env: { attack: 0.01, decay: p.len } }), mk({ src: 'sine', f: T(p.pitch * 1.006), amp: 0.5, env: { attack: 0.01, decay: p.len * 0.9 } }), mk({ src: 'sine', f: T(p.pitch * 2.74), amp: 0.2, env: { attack: 0.01, decay: p.len * 0.5 } })],
  post: { reverb: { size: 1.2, decay: 2.2, mix: 0.25 }, peakDb: -4 },
}));

fam('drone-dark', 'Dark Drone', 'Music FX', 'Music FX/Drones', ['drone', 'dark', 'ambient', 'texture', 'cinematic'], 8, [P('len', 6, 12, 'short', 'long'), P('pitch', 32, 90, 'low', 'high', { log: true }), P('movement', 0.05, 0.6, 'static', 'moving', { log: true })], (p) => ({
  length: p.len,
  layers: [1, 1.5, 2, 3.01].map((r, i) => mk({ src: 'saw', f: T(p.pitch * r), detune: 14 + i * 4, amp: 0.4 / (1 + i * 0.4), am: { rate: p.movement * (1 + i * 0.3), depth: 0.4 }, env: { attack: p.len * 0.25, decay: p.len, sustain: 0.9, hold: p.len * 0.4 }, filter: { type: 'lp', f: T(400 + i * 200, 900 + i * 300, { time: p.len }), q: 1.2 }, stereo: 0 })),
  post: { reverb: { size: 1.8, decay: 4, mix: 0.4 }, widen: 1.4, peakDb: -4 },
}));

fam('drone-light', 'Light Drone', 'Music FX', 'Music FX/Drones', ['drone', 'light', 'ambient', 'pad', 'shimmer'], 8, [P('len', 6, 12, 'short', 'long'), P('pitch', 110, 330, 'low', 'high', { log: true }), P('shimmer', 0, 1, 'smooth', 'shimmering')], (p) => ({
  length: p.len,
  layers: [1, 2, 3, 5].map((r, i) => mk({ src: i % 2 ? 'sine' : 'tri', f: T(p.pitch * r), detune: 6, amp: 0.4 / (1 + i * 0.5), vib: { rate: 0.3 + i * 0.17, depth: 8 }, am: { rate: 0.2 + p.shimmer * (i + 1) * 0.4, depth: 0.2 + p.shimmer * 0.3 }, env: { attack: p.len * 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.3 } })),
  post: { reverb: { size: 1.7, decay: 4, mix: 0.45 }, widen: 1.4, peakDb: -5 },
}));

fam('noise-texture', 'Noise Texture', 'Music FX', 'Music FX/Textures', ['noise', 'texture', 'ambient', 'wash'], 8, [P('len', 3, 8, 'short', 'long'), P('pitch', 300, 5000, 'dark', 'bright', { log: true }), P('q', 0.5, 4, 'broad', 'tonal')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.8, env: { attack: p.len * 0.3, decay: p.len, sustain: 0.9, hold: p.len * 0.3 }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 1.6, { time: p.len }), q: p.q }, stereo: 1 })],
  post: { reverb: { size: 1.4, decay: 2, mix: 0.3 }, widen: 1.3, peakDb: -6 },
}));

fam('brass-swell', 'Brass Swell', 'Music FX', 'Music FX/Swells', ['brass', 'swell', 'cinematic', 'build'], 6, [P('pitch', 70, 220, 'low', 'high', { log: true }), P('len', 1.5, 4, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [1, 1.5, 2].map((r, i) => mk({ src: 'saw', f: T(p.pitch * r), detune: 9 + i * 3, amp: 0.4, env: { decay: p.len, shape: 'hann', peak: 0.75 }, filter: { type: 'lp', f: T(400, 4200, { curve: 1.4, time: p.len * 0.75 }), q: 1.4 } })),
  post: { reverb: { size: 1.5, decay: 2.2, mix: 0.3 }, peakDb: -4 },
}));

// =============================================================== ALARMS & SIGNALS
const DTMF: [string, number, number][] = [['1', 697, 1209], ['2', 697, 1336], ['3', 697, 1477], ['4', 770, 1209], ['5', 770, 1336], ['6', 770, 1477], ['7', 852, 1209], ['8', 852, 1336], ['9', 852, 1477], ['*', 941, 1209], ['0', 941, 1336], ['#', 941, 1477]];
FAMILIES.push({
  id: 'dtmf', title: 'Phone Key', category: 'Alarms & Signals', folder: 'Alarms & Signals/Phone', tags: ['dtmf', 'phone', 'keypad', 'dial'], variants: DTMF.length, params: [],
  fixed: DTMF.map(([k, a, b]) => ({ name: `Phone Key ${k}`, params: { f1: a, f2: b } })),
  build: (p) => ({ length: 0.18, layers: [mk({ src: 'sine', f: T(p.f1), amp: 0.5, env: { attack: 0.003, hold: 0.12, decay: 0.01 } }), mk({ src: 'sine', f: T(p.f2), amp: 0.5, env: { attack: 0.003, hold: 0.12, decay: 0.01 } })], post: { peakDb: -4 } }),
});

fam('phone-ring', 'Phone Ring', 'Alarms & Signals', 'Alarms & Signals/Phone', ['phone', 'ring', 'telephone', 'call'], 6, [P('rate', 16, 26, 'slow', 'fast'), P('len', 1, 2.4, 'short', 'long'), P('pitch', 380, 520, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch), amp: 0.5, am: { rate: p.rate, depth: 0.9 }, env: { attack: 0.005, hold: p.len * 0.8, decay: 0.05 } }), mk({ src: 'sine', f: T(p.pitch * 1.15), amp: 0.5, am: { rate: p.rate, depth: 0.9 }, env: { attack: 0.005, hold: p.len * 0.8, decay: 0.05 } })],
  post: { peakDb: -4 },
}));

fam('beep', 'Beep', 'Alarms & Signals', 'Alarms & Signals/Beeps', ['beep', 'tone', 'signal', 'alert'], 14, [P('pitch', 300, 3200, 'low', 'high', { log: true }), P('len', 0.05, 0.6, 'short', 'long'), P('count', 1, 3, 'single', 'triple', { int: true }), P('square', 0, 1, 'pure', 'harsh')], (p) => {
  const layers: Layer[] = [];
  for (let i = 0; i < p.count; i++) layers.push(mk({ src: p.square > 0.5 ? 'square' : 'sine', f: T(p.pitch), amp: 0.5, env: { delay: i * (p.len + 0.06), attack: 0.003, hold: p.len, decay: 0.012 } }));
  return { length: p.count * (p.len + 0.06) + 0.03, layers, post: { peakDb: -4 } };
});

fam('doorbell', 'Doorbell', 'Alarms & Signals', 'Alarms & Signals/Bells', ['doorbell', 'chime', 'ding-dong', 'bell'], 8, [P('pitch', 400, 900, 'low', 'high', { log: true }), P('len', 0.8, 2.2, 'short', 'long'), P('interval', 3, 8, 'close', 'wide', { int: true })], (p) => ({
  length: p.len + 0.5,
  layers: [mk({ src: 'modal', f: T(p.pitch * Math.pow(2, p.interval / 12)), modes: [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.3]], amp: 0.7, env: { attack: 0.002, decay: p.len } }), mk({ src: 'modal', f: T(p.pitch), modes: [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.3]], amp: 0.7, env: { delay: 0.5, attack: 0.002, decay: p.len } })],
  post: { reverb: { size: 0.8, decay: 1, mix: 0.15 }, peakDb: -4 },
}));

fam('sonar', 'Sonar Ping', 'Alarms & Signals', 'Alarms & Signals/Beeps', ['sonar', 'ping', 'submarine', 'radar'], 8, [P('pitch', 600, 2200, 'low', 'high', { log: true }), P('len', 0.3, 1.2, 'short', 'long')], (p) => ({
  length: p.len + 1.2,
  layers: [mk({ src: 'sine', f: T(p.pitch), amp: 0.7, env: { attack: 0.004, decay: p.len } })],
  post: { delay: { time: 0.45, feedback: 0.45, mix: 0.4 }, reverb: { size: 1.4, decay: 1.5, mix: 0.25 }, peakDb: -4 },
}));

fam('morse', 'Morse Code', 'Alarms & Signals', 'Alarms & Signals/Beeps', ['morse', 'code', 'signal', 'telegraph'], 6, [P('pitch', 500, 900, 'low', 'high', { log: true }), P('speed', 0.05, 0.1, 'fast', 'slow')], (p) => {
  const r = new Rng(Math.round(p.pitch));
  const layers: Layer[] = [];
  let t = 0;
  for (let i = 0; i < 12; i++) {
    const dash = r.chance(0.4);
    const d = p.speed * (dash ? 3 : 1);
    layers.push(mk({ src: 'sine', f: T(p.pitch), amp: 0.5, env: { delay: t, attack: 0.003, hold: d, decay: 0.008 } }));
    t += d + p.speed * (r.chance(0.2) ? 3 : 1);
  }
  return { length: t + 0.05, layers, post: { peakDb: -4 } };
});

fam('buzzer', 'Buzzer', 'Alarms & Signals', 'Alarms & Signals/Buzzers', ['buzzer', 'wrong', 'quiz', 'alarm'], 8, [P('pitch', 80, 240, 'low', 'high', { log: true }), P('len', 0.3, 1.2, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'square', f: T(p.pitch), pw: 0.35, amp: 0.5, env: { attack: 0.005, hold: p.len * 0.8, decay: 0.03 }, filter: { type: 'lp', f: T(2200), q: 1 } }), mk({ src: 'saw', f: T(p.pitch * 1.01), amp: 0.3, env: { attack: 0.005, hold: p.len * 0.8, decay: 0.03 }, filter: { type: 'lp', f: T(1800) } })],
  post: { peakDb: -4 },
}));

// =============================================================== CARTOON
fam('boing', 'Boing', 'Cartoon', 'Cartoon/Springs', ['boing', 'spring', 'bounce', 'cartoon'], 10, [P('pitch', 150, 520, 'low', 'high', { log: true }), P('len', 0.4, 1.2, 'short', 'long'), P('wob', 8, 22, 'slow', 'fast')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch * 2, p.pitch * 0.7, { curve: 0.6 }), vib: { rate: p.wob, depth: 650 }, amp: 0.8, env: { attack: 0.003, decay: p.len } }), mk({ src: 'sine', f: T(p.pitch * 4, p.pitch * 1.4, { curve: 0.6 }), vib: { rate: p.wob, depth: 650 }, amp: 0.15, env: { attack: 0.003, decay: p.len * 0.6 } })],
  post: { reverb: { size: 0.4, decay: 0.3, mix: 0.06 }, peakDb: -4 },
}));

fam('slide-whistle', 'Slide Whistle', 'Cartoon', 'Cartoon/Whistles', ['whistle', 'slide', 'cartoon', 'swoop'], 8, [P('pitch', 400, 1200, 'low', 'high', { log: true }), P('len', 0.3, 1.2, 'quick', 'slow'), P('dir', 0, 1, 'down', 'up')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.dir > 0.5 ? p.pitch : p.pitch * 4, p.dir > 0.5 ? p.pitch * 4 : p.pitch, { curve: 0.8 }), vib: { rate: 6.5, depth: 25 }, amp: 0.7, env: { attack: 0.02, hold: p.len * 0.6, decay: p.len * 0.2 } }), mk({ src: 'pink', amp: 0.05, env: { attack: 0.02, hold: p.len * 0.6, decay: p.len * 0.2 }, filter: { type: 'bp', f: T(2500), q: 2 } })],
  post: { reverb: { size: 0.5, decay: 0.4, mix: 0.08 }, peakDb: -4 },
}));

fam('bonk', 'Bonk', 'Cartoon', 'Cartoon/Impacts', ['bonk', 'cartoon', 'hit', 'wood'], 8, [P('pitch', 120, 420, 'low', 'high', { log: true }), P('len', 0.1, 0.4, 'short', 'long')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch * 2.2, p.pitch, { time: 0.04 }), amp: 0.9, env: { attack: 0.001, decay: p.len } }), mk({ src: 'modal', f: T(p.pitch * 2), modes: [[1, 1, 1], [2.4, 0.5, 0.5], [4.5, 0.3, 0.3]], amp: 0.5, env: { attack: 0.0005, decay: p.len * 0.6 } })],
  post: { peakDb: -3 },
}));

fam('cork-pop', 'Cork Pop', 'Cartoon', 'Cartoon/Impacts', ['pop', 'cork', 'bottle', 'cartoon'], 8, [P('pitch', 300, 900, 'low', 'high', { log: true }), P('len', 0.06, 0.2, 'tiny', 'short')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch * 0.6, p.pitch * 1.8, { time: p.len * 0.4, curve: 0.5 }), amp: 0.9, env: { attack: 0.001, decay: p.len } }), mk({ src: 'noise', amp: 0.25, env: { attack: 0.0004, decay: 0.012 }, filter: { type: 'bp', f: T(p.pitch * 4), q: 1 } })],
  post: { reverb: { size: 0.4, decay: 0.3, mix: 0.1 }, peakDb: -4 },
}));

fam('splat', 'Splat', 'Cartoon', 'Cartoon/Impacts', ['splat', 'squish', 'cartoon', 'wet'], 8, [P('len', 0.15, 0.55, 'short', 'long'), P('wet', 0, 1, 'dry', 'gooey')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.8, env: { attack: 0.001, decay: p.len }, filter: { type: 'lp', f: T(3000 - p.wet * 1500, 250, { time: p.len }), q: 1 + p.wet * 2 } }), mk({ src: 'sine', f: T(180, 60, { time: 0.08 }), amp: 0.5, env: { attack: 0.001, decay: 0.12 } })],
  post: { peakDb: -4 },
}));

fam('zip', 'Zip', 'Cartoon', 'Cartoon/Movement', ['zip', 'zoom', 'fast', 'cartoon'], 8, [P('len', 0.1, 0.4, 'quick', 'long'), P('pitch', 400, 3000, 'low', 'high', { log: true }), P('dir', 0, 1, 'down', 'up')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.dir > 0.5 ? p.pitch : p.pitch * 5, p.dir > 0.5 ? p.pitch * 5 : p.pitch), amp: 0.5, env: { decay: p.len, shape: 'hann', peak: 0.6 } }), mk({ src: 'noise', amp: 0.4, env: { decay: p.len, shape: 'hann', peak: 0.6 }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 4), q: 1 }, stereo: 1 })],
  post: { peakDb: -4 },
}));

fam('squeak', 'Squeak', 'Cartoon', 'Cartoon/Creatures', ['squeak', 'mouse', 'toy', 'cartoon'], 8, [P('pitch', 1500, 4200, 'low', 'high', { log: true }), P('len', 0.05, 0.25, 'tiny', 'long'), P('bend', 0.6, 1.8, 'falling', 'rising')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'fm', f: T(p.pitch, p.pitch * p.bend, { curve: 0.7 }), ratio: 1.5, index: T(2, 0.4), amp: 0.7, env: { attack: 0.004, decay: p.len } })],
  post: { reverb: { size: 0.4, decay: 0.3, mix: 0.08 }, peakDb: -5 },
}));

// =============================================================== HORROR
fam('horror-drone', 'Horror Drone', 'Horror', 'Horror/Drones', ['horror', 'drone', 'dark', 'tension', 'cinematic'], 8, [P('len', 5, 10, 'short', 'long'), P('pitch', 40, 110, 'low', 'high', { log: true }), P('dis', 0.3, 1, 'tense', 'dissonant')], (p) => ({
  length: p.len,
  layers: [1, 1.0595 + p.dis * 0.03, 1.5, 1.414].map((r, i) => mk({ src: i % 2 ? 'saw' : 'tri', f: T(p.pitch * r), detune: 10 + i * 5, amp: 0.4 / (1 + i * 0.3), am: { rate: 0.15 + i * 0.09, depth: 0.5 }, env: { attack: p.len * 0.35, decay: p.len, sustain: 0.9, hold: p.len * 0.3 }, filter: { type: 'lp', f: T(500 + p.dis * 400, 1400, { time: p.len }), q: 1.5 } })),
  post: { reverb: { size: 1.8, decay: 4, mix: 0.4 }, widen: 1.3, peakDb: -4 },
}));

fam('scrape', 'Metal Scrape', 'Horror', 'Horror/Textures', ['scrape', 'metal', 'horror', 'texture'], 8, [P('len', 0.6, 3, 'short', 'long'), P('pitch', 600, 3200, 'low', 'high', { log: true }), P('q', 2, 10, 'rough', 'screechy')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.7, crush: { bits: 10, down: 2 }, env: { decay: p.len, shape: 'hann', peak: 0.35 }, filter: { type: 'bp', f: T(p.pitch, p.pitch * 1.8, { curve: 0.8 }), q: p.q }, stereo: 0.5 }), mk({ src: 'metal', f: T(p.pitch * 0.7), partials: 8, amp: 0.2, env: { decay: p.len, shape: 'hann', peak: 0.35 }, filter: { type: 'hp', f: T(900) } })],
  post: { reverb: { size: 1.2, decay: 1.4, mix: 0.2 }, peakDb: -4 },
}));

fam('creak', 'Creak', 'Horror', 'Horror/Textures', ['creak', 'door', 'wood', 'horror', 'squeak'], 8, [P('len', 0.6, 2.4, 'short', 'long'), P('pitch', 80, 300, 'low', 'high', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'square', f: T(p.pitch * 0.5, p.pitch * 1.6, { curve: 1.2 }), pw: 0.12, amp: 0.6, vib: { rate: 17, depth: 160 }, env: { decay: p.len, shape: 'hann', peak: 0.5 }, filter: { type: 'bp', f: T(p.pitch * 6, p.pitch * 12), q: 4 } }), mk({ src: 'noise', amp: 0.1, env: { decay: p.len, shape: 'hann', peak: 0.5 }, filter: { type: 'bp', f: T(1500), q: 3 } })],
  post: { reverb: { size: 1.1, decay: 1.2, mix: 0.18 }, peakDb: -4 },
}));

fam('horror-stinger', 'Horror Stinger', 'Horror', 'Horror/Stingers', ['horror', 'stinger', 'jump scare', 'hit'], 10, [P('pitch', 90, 400, 'low', 'high', { log: true }), P('len', 0.8, 2.4, 'short', 'long'), P('dis', 0.4, 1, 'harsh', 'clustered')], (p) => ({
  length: p.len,
  layers: [0, 1, 6, 11].map((s, i) => mk({ src: 'saw', f: T(p.pitch * Math.pow(2, (s * p.dis) / 12)), detune: 20, amp: 0.4, env: { attack: 0.003, decay: p.len }, filter: { type: 'lp', f: T(5000, 600, { time: p.len }) } })).concat([mk({ src: 'noise', amp: 0.5, env: { attack: 0.001, decay: 0.25 }, filter: { type: 'bp', f: T(3000), q: 0.6 }, stereo: 1 }), mk({ src: 'sine', f: T(60, 30, { time: 0.3 }), amp: 0.9, env: { attack: 0.002, decay: 0.6 } })]),
  post: { reverb: { size: 1.4, decay: 2, mix: 0.3 }, peakDb: -2 },
}));

fam('whispers', 'Whisper Texture', 'Horror', 'Horror/Textures', ['whisper', 'breath', 'horror', 'ghost'], 6, [P('len', 3, 8, 'short', 'long'), P('tone', 1200, 3200, 'dark', 'bright', { log: true })], (p) => ({
  length: p.len,
  layers: [mk({ src: 'noise', amp: 0.7, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.5 }, filter: { type: 'bp', f: T(p.tone, p.tone * 1.2, { time: p.len }), q: 2.5 }, am: { rate: 3.7, depth: 0.7 }, stereo: 1 }), mk({ src: 'noise', amp: 0.4, env: { attack: 0.4, decay: p.len, sustain: 0.9, hold: p.len * 0.5 }, filter: { type: 'bp', f: T(p.tone * 1.8), q: 3 }, am: { rate: 5.1, depth: 0.7 }, stereo: 1 })],
  post: { reverb: { size: 1.5, decay: 2.2, mix: 0.35 }, peakDb: -7 },
}));

fam('tension-pulse', 'Tension Pulse', 'Horror', 'Horror/Drones', ['tension', 'pulse', 'suspense', 'low'], 6, [P('len', 4, 9, 'short', 'long'), P('pitch', 35, 80, 'low', 'high', { log: true }), P('rate', 0.6, 2.2, 'slow', 'fast')], (p) => ({
  length: p.len,
  layers: [mk({ src: 'sine', f: T(p.pitch), amp: 0.9, am: { rate: p.rate, depth: 0.8 }, env: { attack: 0.5, decay: p.len, sustain: 0.9, hold: p.len * 0.5 } }), mk({ src: 'saw', f: T(p.pitch * 2), amp: 0.2, am: { rate: p.rate, depth: 0.9 }, env: { attack: 0.5, decay: p.len, sustain: 0.9, hold: p.len * 0.5 }, filter: { type: 'lp', f: T(300) } })],
  post: { reverb: { size: 1.4, decay: 2, mix: 0.25 }, peakDb: -4 },
}));

// =============================================================== DRUM ONE-SHOTS (rendered with the drum kit voices)
const KIT_LABELS = ['acoustic', 'tight', 'jazz', 'rock', '808', '909', 'lo-fi'];
function drumFamily(id: string, title: string, kind: string, variants: number, tags: string[], folder: string): void {
  FAMILIES.push({
    id, title, category: 'Drums & Percussion', folder: 'Drums & Percussion/' + folder, tags: ['drum', 'one-shot', ...tags], variants,
    params: [P('kit', 0, 6, 'acoustic', 'lo-fi', { int: true, label: 'kit' }), P('tune', -4, 4, 'low', 'high'), P('decay', 0.7, 1.6, 'short', 'long'), P('vel', 70, 127, 'soft', 'hard', { int: true })],
    custom: (p, sr, seed) => {
      const rng = new Rng(seed);
      const hit = makeHit(kind, Math.round(p.vel), sr, rng, { kit: Math.round(p.kit), tune: p.tune, decay: p.decay, hatBright: 0.5 }, 0.5);
      const frames = Math.round(sr * (kind.includes('crash') || kind.includes('ride') || kind === 'china' ? 4 : kind === 'hat_o' ? 1.2 : 1.2));
      const L = new Float32Array(frames);
      const R = new Float32Array(frames);
      hit.render(L, R, 0, frames);
      let pk = 0;
      for (let i = 0; i < frames; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      const g = pk > 0 ? 0.7 / pk : 1;
      let last = frames - 1;
      while (last > 100 && Math.abs(L[last]) * g < 3e-4 && Math.abs(R[last]) * g < 3e-4) last--;
      const keep = Math.min(frames, last + 200);
      const oL = new Float32Array(keep);
      const oR = new Float32Array(keep);
      for (let i = 0; i < keep; i++) {
        const fade = i > keep - 200 ? (keep - i) / 200 : 1;
        oL[i] = L[i] * g * fade;
        oR[i] = R[i] * g * fade;
      }
      return { L: oL, R: oR };
    },
  });
}
drumFamily('kick', 'Kick', 'kick', 20, ['kick', 'bass drum'], 'Kicks');
drumFamily('snare', 'Snare', 'snare', 18, ['snare'], 'Snares');
drumFamily('rimshot', 'Rimshot', 'rimshot', 6, ['rim', 'snare'], 'Snares');
drumFamily('sidestick', 'Side Stick', 'sidestick', 6, ['side stick', 'rim'], 'Snares');
drumFamily('hat-closed', 'Closed Hat', 'hat_c', 12, ['hat', 'hi-hat', 'closed'], 'Hats');
drumFamily('hat-open', 'Open Hat', 'hat_o', 10, ['hat', 'hi-hat', 'open'], 'Hats');
drumFamily('clap', 'Clap', 'clap', 10, ['clap'], 'Claps');
drumFamily('tom-low', 'Floor Tom', 'tom1', 6, ['tom', 'floor'], 'Toms');
drumFamily('tom-mid', 'Rack Tom', 'tom4', 6, ['tom', 'rack'], 'Toms');
drumFamily('crash', 'Crash Cymbal', 'crash', 8, ['cymbal', 'crash'], 'Cymbals');
drumFamily('ride', 'Ride Cymbal', 'ride', 6, ['cymbal', 'ride'], 'Cymbals');
drumFamily('tamb', 'Tambourine', 'tamb', 6, ['tambourine', 'percussion'], 'Percussion');
drumFamily('shaker', 'Shaker', 'shaker', 6, ['shaker', 'percussion'], 'Percussion');
drumFamily('cowbell', 'Cowbell', 'cowbell', 6, ['cowbell', 'percussion'], 'Percussion');
drumFamily('conga', 'Conga', 'conga_hi', 6, ['conga', 'percussion'], 'Percussion');
drumFamily('bongo', 'Bongo', 'bongo_hi', 6, ['bongo', 'percussion'], 'Percussion');
drumFamily('claves', 'Claves', 'claves', 4, ['claves', 'percussion'], 'Percussion');
drumFamily('wood-block', 'Wood Block', 'wood_hi', 4, ['woodblock', 'percussion'], 'Percussion');

export const SFX_FAMILIES: Family[] = FAMILIES;
export { KIT_LABELS };
