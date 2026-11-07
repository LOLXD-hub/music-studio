import { chordPcs, mod12 } from './pitch.ts';
import type { Chord } from './pitch.ts';

export interface VoicingOptions {
  /** MIDI range for all voices. */
  range?: [number, number];
  /** Number of voices, 3 to 6. */
  voices?: number;
  style?: 'close' | 'open' | 'spread' | 'shell' | 'rootless';
  /** Previous voicing, for smooth voice leading. */
  prev?: number[];
  /** Put the chord's bass note (slash bass, or the root) as the lowest voice. */
  bassInVoicing?: boolean;
}

function tonesFor(c: Chord, n: number, style: string): number[] {
  const pcs = c.iv.map((i) => mod12(c.root + i));
  const uniq = [...new Set(pcs)];
  const root = uniq[0];
  const rest = uniq.slice(1);
  // order of importance: third/seventh first (they define the chord), then fifth, then extensions
  const fifth = mod12(c.root + 7);
  const guide = rest.filter((p) => p !== fifth);
  const order = [root, ...guide, ...(uniq.includes(fifth) ? [fifth] : [])];
  let tones = [...order];
  if (style === 'rootless' && tones.length > 3) tones = tones.slice(1);
  if (style === 'shell') tones = [root, ...guide.slice(0, 2)];
  while (tones.length > n) {
    // drop the fifth first, then extensions from the top
    const fi = tones.indexOf(fifth);
    if (fi > 0 && tones.length > 3) tones.splice(fi, 1);
    else tones.pop();
  }
  const dbl = [root, fifth, ...guide];
  let i = 0;
  while (tones.length < n) tones.push(dbl[i++ % dbl.length]);
  return tones;
}

function candidates(tones: number[], lo: number, hi: number): number[][] {
  const options = tones.map((pc) => {
    const o: number[] = [];
    for (let m = lo; m <= hi; m++) if (mod12(m) === pc) o.push(m);
    return o;
  });
  if (options.some((o) => !o.length)) return [];
  const out: number[][] = [];
  const rec = (i: number, acc: number[]) => {
    if (i === options.length) {
      out.push([...acc].sort((a, b) => a - b));
      return;
    }
    for (const m of options[i]) {
      acc.push(m);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function cost(c: number[], prev: number[] | undefined, style: string, lo: number, hi: number): number {
  let cst = 0;
  const span = c[c.length - 1] - c[0];
  const centre = (lo + hi) / 2;
  const mean = c.reduce((a, b) => a + b, 0) / c.length;
  cst += Math.abs(mean - centre) * 0.25;
  const [sMin, sMax] = style === 'close' ? [4, 11] : style === 'open' ? [12, 21] : style === 'spread' ? [17, 30] : [6, 17];
  if (span < sMin) cst += (sMin - span) * 2;
  if (span > sMax) cst += (span - sMax) * 2.2;
  for (let i = 1; i < c.length; i++) {
    const gap = c[i] - c[i - 1];
    if (gap === 0) cst += 40;
    if (c[i - 1] < 55 && gap < 5) cst += (5 - gap) * 6; // mud in the low register
    if (gap > 14 && i > 1) cst += (gap - 14) * 1.5;
  }
  if (prev && prev.length) {
    const n = Math.min(prev.length, c.length);
    const pa = prev.slice(prev.length - n);
    const ca = c.slice(c.length - n);
    for (let i = 0; i < n; i++) cst += Math.abs(ca[i] - pa[i]) * (i === n - 1 ? 1.8 : 1);
    // parallel fifths/octaves between any two voices
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const ip = mod12(pa[j] - pa[i]);
      const ic = mod12(ca[j] - ca[i]);
      const di = ca[i] - pa[i];
      const dj = ca[j] - pa[j];
      if ((ip === 7 || ip === 0) && ip === ic && di !== 0 && di === dj) cst += 30;
      else if ((ip === 7 || ip === 0) && ip === ic && di !== 0 && Math.sign(di) === Math.sign(dj)) cst += 18;
    }
    // keep common tones in place
    const common = c.filter((m) => prev.includes(m)).length;
    cst -= common * 3;
  }
  return cst;
}

/** One chord, voiced inside a range, led smoothly from `prev`. Returns ascending MIDI notes. */
export function voiceChord(c: Chord, o: VoicingOptions = {}): number[] {
  const [lo, hi] = o.range ?? [48, 76];
  const n = Math.max(2, Math.min(6, o.voices ?? 4));
  const style = o.style ?? 'close';
  const tones = tonesFor(c, n, style);
  const cands = candidates(tones, lo, hi);
  if (!cands.length) {
    // fall back to the root-position stack
    return c.iv.slice(0, n).map((i) => lo + mod12(c.root - lo) + i);
  }
  let best = cands[0];
  let bestCost = Infinity;
  const bassPc = c.bass ?? c.root;
  for (const cand of cands) {
    let k = cost(cand, o.prev, style, lo, hi);
    if (o.bassInVoicing !== false && style !== 'rootless' && mod12(cand[0]) !== bassPc) k += 14;
    if (k < bestCost) {
      bestCost = k;
      best = cand;
    }
  }
  return best;
}

/** Voice a whole progression with continuous voice leading. */
export function voiceProgression(chords: Chord[], o: VoicingOptions = {}): number[][] {
  const out: number[][] = [];
  let prev = o.prev;
  for (const c of chords) {
    const v = voiceChord(c, { ...o, prev });
    out.push(v);
    prev = v;
  }
  return out;
}

/** A bass note for a chord in the given register (slash bass honoured). */
export function bassNote(c: Chord, lo = 31, hi = 52): number {
  const pc = c.bass ?? c.root;
  let best = lo;
  for (let m = lo; m <= hi; m++) if (mod12(m) === pc) best = m;
  // prefer the lowest comfortable octave, but stay out of the very bottom
  for (let m = lo + 4; m <= hi; m++) if (mod12(m) === pc) return m;
  return best;
}

export { chordPcs };
