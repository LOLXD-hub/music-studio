// Melody generator built on motif development: one idea, stated, sequenced, inverted, varied and resolved,
// with chord tones on strong beats, stepwise motion after leaps, breathing rests and a real cadence.

import { Rng } from '../engine/dsp/core.ts';
import { chordPcs, mod12, scaleLadder, scalePcs } from './pitch.ts';
import type { Key } from './pitch.ts';
import type { ChordSlot } from './progressions.ts';
import type { TNote } from './humanize.ts';

export type Contour = 'arch' | 'ascending' | 'descending' | 'wave' | 'inverted-arch' | 'plateau';

export interface MotifNote {
  /** Beat offset inside the bar. */
  off: number;
  dur: number;
  /** Scale steps relative to the motif start. */
  idx: number;
}

export interface MelodyOptions {
  key: Key;
  chords: ChordSlot[];
  /** Total length to fill, in beats. */
  beats: number;
  startBeat?: number;
  range?: [number, number];
  /** 0 sparse .. 1 busy. */
  density?: number;
  contour?: Contour;
  /** 0 stepwise .. 1 leapy. */
  leap?: number;
  seed?: number;
  /** Length of a phrase in beats; default two bars. */
  phraseBeats?: number;
  /** Phrase plan such as "AABA" or "ABAC", cycled. */
  form?: string;
  /** Probability of replacing a weak-beat note by a rest. */
  restProb?: number;
  cadence?: 'authentic' | 'half' | 'open' | 'none';
  beatsPerBar?: number;
  velocity?: number;
  /** 0..1 chance of anticipating a beat (syncopation). */
  syncopation?: number;
  motif?: MotifNote[];
}

const CELLS: Record<'sparse' | 'medium' | 'busy', number[][]> = {
  sparse: [[2, 1, 1], [3, 1], [1.5, 0.5, 2], [1, 1, 2], [2, 2], [1, 3]],
  medium: [[1, 0.5, 0.5, 1, 1], [1.5, 0.5, 1, 1], [0.75, 0.25, 1, 0.5, 0.5, 1], [1, 1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 0.5, 0.5, 1], [1.5, 0.5, 2]],
  busy: [[0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [0.75, 0.25, 0.5, 0.5, 0.5, 0.5, 1], [0.5, 0.25, 0.25, 0.5, 0.5, 1, 1], [0.25, 0.25, 0.5, 0.5, 1, 0.5, 0.5, 0.5]],
};

function contourFn(c: Contour, x: number): number {
  switch (c) {
    case 'ascending': return -1 + 2 * x;
    case 'descending': return 1 - 2 * x;
    case 'wave': return Math.sin(x * Math.PI * 2);
    case 'inverted-arch': return -Math.sin(x * Math.PI);
    case 'plateau': return x < 0.2 ? -0.6 + 3 * x : x > 0.85 ? 0 - (x - 0.85) * 4 : 0.0;
    default: return Math.sin(Math.min(1, x / 0.65) * Math.PI * 0.5) * (x < 0.65 ? 1 : 1 - (x - 0.65) / 0.35 * 1.4);
  }
}

function makeMotif(rng: Rng, bpb: number, density: number, leap: number): MotifNote[] {
  const tier = density < 0.33 ? 'sparse' : density < 0.7 ? 'medium' : 'busy';
  const cells = CELLS[tier];
  let rhythm = [...cells[rng.int(cells.length)]];
  // fit to the bar length
  let sum = rhythm.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - bpb) > 1e-6) {
    const out: number[] = [];
    let acc = 0;
    for (const d of rhythm) {
      if (acc + d >= bpb - 1e-6) break;
      out.push(d);
      acc += d;
    }
    out.push(Math.max(0.25, bpb - acc));
    rhythm = out;
    sum = bpb;
  }
  const notes: MotifNote[] = [];
  let off = 0;
  let idx = 0;
  let lastStep = 0;
  rhythm.forEach((dur, i) => {
    if (i > 0) {
      let step: number;
      if (Math.abs(lastStep) >= 3) step = -Math.sign(lastStep) * (1 + (rng.chance(0.3) ? 1 : 0));
      else {
        const r = rng.next();
        const leapP = 0.08 + leap * 0.32;
        if (r < leapP) step = (rng.chance(0.5) ? 1 : -1) * (3 + (rng.chance(0.35) ? 1 : 0));
        else if (r < leapP + 0.12) step = 0;
        else if (r < leapP + 0.12 + 0.2) step = (rng.chance(0.5) ? 1 : -1) * 2;
        else step = rng.chance(0.5) ? 1 : -1;
      }
      idx += step;
      lastStep = step;
    }
    notes.push({ off, dur, idx });
    off += dur;
  });
  return notes;
}

function transform(m: MotifNote[], kind: string, rng: Rng, shift = 0): MotifNote[] {
  let out = m.map((n) => ({ ...n }));
  switch (kind) {
    case 'sequence': out = out.map((n) => ({ ...n, idx: n.idx + shift })); break;
    case 'invert': out = out.map((n) => ({ ...n, idx: -n.idx + shift })); break;
    case 'vary': {
      // split one longer note, or shorten the tail and add a neighbour tone
      const i = out.findIndex((n) => n.dur >= 1);
      if (i >= 0 && rng.chance(0.7)) {
        const n = out[i];
        const h = n.dur / 2;
        out.splice(i, 1, { off: n.off, dur: h, idx: n.idx }, { off: n.off + h, dur: h, idx: n.idx + (rng.chance(0.5) ? 1 : -1) });
      } else if (out.length > 2) {
        const k = rng.int(out.length - 1) + 1;
        out[k] = { ...out[k], idx: out[k].idx + (rng.chance(0.5) ? 1 : -1) };
      }
      out = out.map((n) => ({ ...n, idx: n.idx + shift }));
      break;
    }
    case 'fragment': {
      const half = out.slice(0, Math.max(2, Math.ceil(out.length / 2)));
      const len = half[half.length - 1].off + half[half.length - 1].dur;
      const rest = out.reduce((a, n) => Math.max(a, n.off + n.dur), 0);
      out = [...half, ...half.map((n) => ({ ...n, off: n.off + len, idx: n.idx + 1 + shift }))].filter((n) => n.off < rest - 1e-6);
      break;
    }
    case 'augment': out = out.map((n) => ({ ...n, off: n.off * 1.0, dur: n.dur })); break;
  }
  return out;
}

export function generateMelody(o: MelodyOptions): TNote[] {
  const rng = new Rng(o.seed ?? 11);
  const bpb = o.beatsPerBar ?? 4;
  const [lo, hi] = o.range ?? [60, 84];
  const ladder = scaleLadder(o.key, lo, hi);
  if (ladder.length < 5) throw new Error('Melody range is too narrow for this scale.');
  const start = o.startBeat ?? o.chords[0]?.startBeat ?? 0;
  const end = start + o.beats;
  const phraseBeats = o.phraseBeats ?? bpb * 2;
  const density = o.density ?? 0.5;
  const contour = o.contour ?? 'arch';
  const baseMotif = o.motif ?? makeMotif(rng, bpb, density, o.leap ?? 0.3);
  const nPhrases = Math.ceil(o.beats / phraseBeats);
  const formDefault = nPhrases >= 4 ? 'AABA' : nPhrases === 3 ? 'ABA' : 'AB';
  const form = (o.form ?? formDefault).toUpperCase();
  const tonic = o.key.root;
  const pcs = new Set(scalePcs(o.key));
  const chordAt = (beat: number): ChordSlot | undefined => {
    let c: ChordSlot | undefined;
    for (const s of o.chords) if (s.startBeat <= beat + 1e-6) c = s;
    return c;
  };
  const midIdx = Math.floor(ladder.length / 2);
  const amp = Math.floor(ladder.length * 0.28);
  const clampIdx = (i: number) => (i < 0 ? -i : i > ladder.length - 1 ? 2 * (ladder.length - 1) - i : i);
  const nearestIdx = (m: number) => ladder.reduce((best, v, i) => (Math.abs(v - m) < Math.abs(ladder[best] - m) ? i : best), 0);
  const events: { t: number; d: number; idx: number; phraseEnd: boolean; strong: boolean }[] = [];
  const motifs: Record<string, MotifNote[]> = {};
  let prevIdx = midIdx;
  for (let ph = 0; ph < nPhrases; ph++) {
    const phStart = start + ph * phraseBeats;
    const label = form[ph % form.length];
    const nBars = Math.max(1, Math.round(phraseBeats / bpb));
    const x = nPhrases > 1 ? ph / (nPhrases - 1) : 0.5;
    const target = clampIdx(midIdx + Math.round(contourFn(contour, x) * amp) + (label === 'B' ? 2 : 0));
    // pick a start index near the target on a chord tone
    const c0 = chordAt(phStart);
    let startIdx = target;
    if (c0) {
      const cpcs = chordPcs(c0.chord);
      let best = startIdx;
      for (let d = 0; d < 5; d++) {
        const a = clampIdx(target + d);
        const b = clampIdx(target - d);
        if (cpcs.includes(mod12(ladder[a]))) { best = a; break; }
        if (cpcs.includes(mod12(ladder[b]))) { best = b; break; }
      }
      startIdx = best;
    }
    for (let b = 0; b < nBars; b++) {
      const barStart = phStart + b * bpb;
      if (barStart >= end - 1e-6) break;
      let m: MotifNote[];
      const lastBar = b === nBars - 1;
      if (b === 0) {
        if (!motifs[label]) motifs[label] = label === 'A' ? baseMotif : transform(baseMotif, 'invert', rng, 1);
        m = label === 'A' && ph > 0 && rng.chance(0.5) ? transform(baseMotif, 'vary', rng, 0) : motifs[label];
      } else if (lastBar) m = transform(baseMotif, rng.chance(0.5) ? 'vary' : 'sequence', rng, label === 'B' ? 1 : rng.chance(0.5) ? -1 : 0);
      else m = transform(baseMotif, label === 'B' ? 'fragment' : 'sequence', rng, rng.chance(0.5) ? 1 : -1);
      // anchor: bar >0 continues from where the previous bar ended
      const anchor = b === 0 ? startIdx : clampIdx(prevIdx + (rng.chance(0.5) ? 1 : -1) * (lastBar ? 1 : 0));
      m.forEach((n, k) => {
        const idx = clampIdx(anchor + n.idx);
        const t = barStart + n.off;
        if (t >= end - 1e-6) return;
        const dur = Math.min(n.dur, end - t);
        const posInBar = n.off;
        const strong = posInBar === 0 || (bpb === 4 && posInBar === 2) || (bpb === 3 && posInBar === 0);
        events.push({ t, d: dur, idx, phraseEnd: lastBar && k === m.length - 1, strong });
        prevIdx = idx;
      });
    }
  }
  // chord-tone snapping and syncopation
  const result: TNote[] = [];
  const vBase = o.velocity ?? 82;
  const restP = o.restProb ?? 0.06;
  let lastPitch = -1;
  let repeat = 0;
  events.forEach((e, i) => {
    let idx = e.idx;
    const c = chordAt(e.t);
    if (c && (e.strong || e.d >= 1.5)) {
      const cpcs = chordPcs(c.chord);
      if (!cpcs.includes(mod12(ladder[idx]))) {
        const nextE = events[i + 1];
        // allow a suspension: a held non-chord note that resolves down by step on the next beat
        const resolves = nextE && nextE.idx === idx - 1 && cpcs.includes(mod12(ladder[nextE.idx])) && e.d >= 1;
        if (!(resolves && rng.chance(0.4))) {
          for (let d = 1; d <= 2; d++) {
            const up = clampIdx(idx + d);
            const dn = clampIdx(idx - d);
            const prefer = e.idx >= (events[i - 1]?.idx ?? e.idx) ? [dn, up] : [up, dn];
            const hit = prefer.find((k) => cpcs.includes(mod12(ladder[k])));
            if (hit !== undefined) { idx = hit; break; }
          }
        }
      }
    }
    // limit leaps: pull back by an octave-equivalent step if too far from the previous pitch
    if (lastPitch >= 0 && Math.abs(ladder[idx] - lastPitch) > 9) {
      const alt = nearestIdx(lastPitch + Math.sign(ladder[idx] - lastPitch) * 5);
      if (!e.strong) idx = alt;
    }
    let pitch = ladder[idx];
    if (pitch === lastPitch) {
      repeat++;
      if (repeat >= 2) {
        pitch = ladder[clampIdx(idx + (rng.chance(0.5) ? 1 : -1))];
        repeat = 0;
      }
    } else repeat = 0;
    lastPitch = pitch;
    // rests on weak beats
    if (!e.strong && !e.phraseEnd && rng.chance(restP) && e.d <= 0.5) return;
    // anticipation / syncopation: pull a strong-beat note slightly early
    let t = e.t;
    let d = e.d;
    if (o.syncopation && !e.strong && e.d >= 0.5 && rng.chance(o.syncopation * 0.4) && t - start > 0.5) { t -= 0.5; d += 0.5; }
    const accent = e.strong ? 7 : 0;
    result.push({ t, d: d * 0.93, p: pitch, v: Math.round(vBase + accent + (rng.next() - 0.5) * 6) });
  });
  // cadence: land the last note on a stable tone and let it ring
  const cad = o.cadence ?? 'authentic';
  if (cad !== 'none' && result.length) {
    const last = result[result.length - 1];
    const lastChord = chordAt(last.t) ?? o.chords[o.chords.length - 1];
    const target = cad === 'authentic' ? tonic : cad === 'half' ? mod12(tonic + 7) : (chordPcs(lastChord.chord)[1] ?? tonic);
    let best = last.p;
    for (const m of ladder) if (mod12(m) === target && Math.abs(m - last.p) < Math.abs(best - last.p) || (best === last.p && mod12(m) === target)) best = m;
    last.p = best;
    last.d = Math.max(last.d, Math.min(end - last.t, bpb * 0.75)) * 0.97;
    const prev = result[result.length - 2];
    if (prev && cad === 'authentic' && Math.abs(prev.p - last.p) > 2) {
      const step = ladder.findIndex((m) => m === last.p);
      const approach = ladder[Math.max(0, Math.min(ladder.length - 1, step + (prev.p > last.p ? 1 : -1)))];
      if (pcs.has(mod12(approach))) prev.p = approach;
    }
  }
  // breathing room at phrase ends
  events.forEach((e) => {
    if (!e.phraseEnd) return;
    const n = result.find((r) => Math.abs(r.t - e.t) < 1e-6 || Math.abs(r.t + 0.5 - e.t) < 1e-6);
    if (n && e.t + e.d < end - 0.01) n.d = Math.min(n.d, Math.max(0.25, e.d - 0.4));
  });
  // dynamic arch across the whole line
  const total = Math.max(1, o.beats);
  for (const n of result) {
    const x = (n.t - start) / total;
    n.v = Math.max(1, Math.min(127, n.v + Math.round(Math.sin(x * Math.PI) * 8)));
  }
  return result;
}
