// Accompaniment patterns (chords, arpeggios, bass lines). They take already voiced chords and return notes in beats.

import { Rng } from '../engine/dsp/core.ts';
import { chordPcs, mod12 } from './pitch.ts';
import type { Chord } from './pitch.ts';
import type { ChordSlot } from './progressions.ts';
import { strum } from './humanize.ts';
import type { TNote } from './humanize.ts';

export interface VoicedSlot {
  startBeat: number;
  beats: number;
  voicing: number[];
  chord: Chord;
}

export const COMP_STYLES = [
  'sustain', 'half', 'quarter', 'eighth', 'arp-up', 'arp-down', 'arp-updown', 'alberti', 'ballad', 'waltz', 'syncopated', 'offbeat',
  'pop-piano', 'strum-folk', 'strum-pop', 'pulse-16th', 'stabs', 'broken',
] as const;
export type CompStyle = (typeof COMP_STYLES)[number];

export interface CompOptions {
  style: CompStyle;
  beatsPerBar?: number;
  seed?: number;
  velocity?: number;
  bpm?: number;
}

type P = { t: number; d: number; i: number | number[]; v?: number };

/** Positions inside one bar. `i` indexes the voicing (negative counts from the top), arrays are chords. */
function barPattern(style: CompStyle, bpb: number, nVoices: number, rng: Rng): P[] {
  const all = Array.from({ length: nVoices }, (_, k) => k);
  const upper = all.slice(1);
  const out: P[] = [];
  const cyc = (seq: number[], step: number, dur: number, vel = 1) => {
    let k = 0;
    for (let t = 0; t < bpb - 1e-6; t += step) out.push({ t, d: dur, i: seq[k++ % seq.length], v: vel * (t % 1 === 0 ? 1 : 0.82) });
  };
  switch (style) {
    case 'sustain': out.push({ t: 0, d: bpb * 0.98, i: all }); break;
    case 'half': for (let t = 0; t < bpb - 1e-6; t += 2) out.push({ t, d: Math.min(2, bpb - t) * 0.95, i: all, v: t === 0 ? 1 : 0.85 }); break;
    case 'quarter': for (let t = 0; t < bpb - 1e-6; t += 1) out.push({ t, d: 0.9, i: all, v: t === 0 ? 1 : 0.85 }); break;
    case 'eighth': for (let t = 0; t < bpb - 1e-6; t += 0.5) out.push({ t, d: 0.45, i: all, v: t % 1 === 0 ? 1 : 0.75 }); break;
    case 'arp-up': cyc(all, 0.5, 0.95); break;
    case 'arp-down': cyc([...all].reverse(), 0.5, 0.95); break;
    case 'arp-updown': cyc([...all, ...all.slice(1, -1).reverse()], 0.5, 0.95); break;
    case 'alberti': cyc(nVoices >= 3 ? [0, 2, 1, 2] : [0, 1, 0, 1], 0.5, 0.5); break;
    case 'broken': cyc(nVoices >= 4 ? [0, 2, 1, 3, 2, 1] : [0, 1, 2, 1], 0.5, 0.7); break;
    case 'ballad':
      out.push({ t: 0, d: bpb * 0.97, i: 0, v: 0.95 });
      {
        const seq = upper.length > 1 ? [...upper, ...upper.slice(1, -1).reverse()] : upper;
        let k = 0;
        for (let t = 0.5; t < bpb - 1e-6; t += 0.5) out.push({ t, d: 1.1, i: seq[k++ % seq.length], v: 0.62 + (t % 1 === 0 ? 0.1 : 0) });
      }
      break;
    case 'waltz':
      out.push({ t: 0, d: 0.95, i: 0 });
      for (let t = 1; t < bpb - 1e-6; t += 1) out.push({ t, d: 0.85, i: upper.length ? upper : all, v: 0.72 });
      break;
    case 'syncopated': {
      const pos = bpb === 3 ? [0, 1.5] : [0, 1.5, 2.5, 3.5];
      pos.forEach((t, k) => out.push({ t, d: 0.4, i: all, v: k === 0 ? 1 : 0.8 }));
      break;
    }
    case 'offbeat': for (let t = 0.5; t < bpb; t += 1) out.push({ t, d: 0.3, i: upper.length ? upper : all, v: 0.85 }); break;
    case 'pop-piano':
      out.push({ t: 0, d: bpb / 2 * 0.95, i: 0, v: 0.95 }, { t: bpb / 2, d: bpb / 2 * 0.95, i: 0, v: 0.85 });
      for (let t = 0; t < bpb - 1e-6; t += 0.5) out.push({ t, d: 0.45, i: upper.length ? upper : all, v: t % 1 === 0 ? 0.85 : 0.62 });
      break;
    case 'strum-folk': {
      const pos = bpb === 3 ? [0, 1, 2] : [0, 1, 1.5, 2.5, 3, 3.5];
      pos.forEach((t, k) => out.push({ t, d: 0.5, i: all, v: k === 0 ? 1 : t % 1 === 0.5 ? 0.62 : 0.85 }));
      break;
    }
    case 'strum-pop': {
      const pos = bpb === 3 ? [0, 1.5, 2] : [0, 0.5, 1.5, 2, 3, 3.5];
      pos.forEach((t, k) => out.push({ t, d: 0.5, i: all, v: k === 0 ? 1 : 0.78 }));
      break;
    }
    case 'pulse-16th': cyc([0, 2, 1, 2, 0, 3 % nVoices, 1, 2], 0.25, 0.22); break;
    case 'stabs': {
      const sets = [[0, 0.75, 1.5, 2.5, 3.25], [0, 1.5, 2, 3.5], [0, 0.5, 1.5, 2.75, 3.5]];
      const pat = bpb === 4 ? sets[rng.int(sets.length)] : [0, 1.5];
      pat.forEach((t, k) => out.push({ t, d: 0.28, i: all, v: k === 0 ? 1 : 0.8 }));
      break;
    }
  }
  return out;
}

export function comp(slots: VoicedSlot[], o: CompOptions): TNote[] {
  const rng = new Rng(o.seed ?? 1);
  const bpb = o.beatsPerBar ?? 4;
  const base = o.velocity ?? 80;
  const notes: TNote[] = [];
  for (const s of slots) {
    const nV = s.voicing.length;
    for (let bar = 0; bar * bpb < s.beats - 1e-6; bar++) {
      const pat = barPattern(o.style, bpb, nV, rng);
      for (const p of pat) {
        const t = bar * bpb + p.t;
        if (t >= s.beats - 1e-6) continue;
        const dur = Math.min(p.d, s.beats - t);
        const idx = Array.isArray(p.i) ? p.i : [p.i];
        for (const k of idx) {
          const pitch = s.voicing[Math.max(0, Math.min(nV - 1, k < 0 ? nV + k : k))];
          const v = Math.round(base * (p.v ?? 1) + (rng.next() - 0.5) * 4);
          notes.push({ t: s.startBeat + t, d: dur, p: pitch, v: Math.max(1, Math.min(127, v)) });
        }
      }
    }
  }
  if ((o.style === 'strum-folk' || o.style === 'strum-pop') && o.bpm) return strum(notes, { bpm: o.bpm, direction: 'alt', spreadMs: 16, seed: o.seed });
  return notes;
}

// ------------------------------------------------------------------ bass

export const BASS_STYLES = [
  'root', 'root-fifth', 'eighths', 'octaves', 'walking', 'funk', 'disco', 'reggae', 'bossa', '808', 'pedal', 'arp', 'ballad', 'synthwave', 'half-time', 'kick-lock',
] as const;
export type BassStyle = (typeof BASS_STYLES)[number];

export interface BassOptions {
  style: BassStyle;
  range?: [number, number];
  beatsPerBar?: number;
  seed?: number;
  velocity?: number;
  /** Beat positions (within a bar) of the kick drum, used by 'kick-lock'. */
  kickBeats?: number[];
  /** Tonic pitch class for 'pedal'. */
  pedalPc?: number;
}

function near(prev: number | null, pc: number, lo: number, hi: number): number {
  const cands: number[] = [];
  for (let m = lo; m <= hi; m++) if (mod12(m) === pc) cands.push(m);
  if (!cands.length) return lo;
  if (prev === null) return cands.find((m) => m >= lo + 3) ?? cands[0];
  return cands.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
}

export function bassLine(slots: ChordSlot[], o: BassOptions): TNote[] {
  const rng = new Rng(o.seed ?? 2);
  const [lo, hi] = o.range ?? [28, 50];
  const bpb = o.beatsPerBar ?? 4;
  const vel = o.velocity ?? 88;
  const out: TNote[] = [];
  let prev: number | null = null;
  const add = (t: number, d: number, p: number, v: number, art?: string) => {
    out.push({ t, d, p, v: Math.max(1, Math.min(127, Math.round(v))), art });
    prev = p;
  };
  for (let si = 0; si < slots.length; si++) {
    const s = slots[si];
    const next = slots[si + 1];
    const c = s.chord;
    const rootPc = c.bass ?? c.root;
    const root = near(prev, rootPc, lo, hi);
    const fifthPc = mod12(c.root + 7);
    const fifth = near(root, fifthPc, lo, hi);
    const oct = root + 12 <= hi + 7 ? root + 12 : root - 12;
    const third = near(root, mod12(c.root + (c.iv.includes(3) ? 3 : 4)), lo, hi);
    const seventh = c.iv.some((i) => i === 10 || i === 11) ? near(root, mod12(c.root + (c.iv.includes(11) ? 11 : 10)), lo, hi) : fifth;
    const nextRoot = next ? near(root, next.chord.bass ?? next.chord.root, lo, hi) : root;
    const bars = Math.max(1, Math.round(s.beats / bpb));
    const barLen = s.beats / bars;
    for (let b = 0; b < bars; b++) {
      const t0 = s.startBeat + b * barLen;
      const last = b === bars - 1;
      const fillVar = rng.chance(0.25);
      switch (o.style) {
        case 'root': add(t0, barLen * 0.96, root, vel); break;
        case 'root-fifth':
          add(t0, barLen / 2 - 0.05, root, vel);
          add(t0 + barLen / 2, barLen / 2 - 0.05, fillVar ? oct : fifth, vel - 8);
          break;
        case 'ballad':
          add(t0, barLen - (last && next ? 1 : 0.1), root, vel);
          if (last && next && Math.abs(nextRoot - root) > 0) add(t0 + barLen - 1, 0.9, nextRoot + (nextRoot > root ? -1 : 1), vel - 14);
          break;
        case 'eighths':
          for (let k = 0; k < bpb * 2; k++) add(t0 + k * 0.5, 0.45, root, vel - (k % 2 ? 10 : 0));
          break;
        case 'synthwave':
          for (let k = 0; k < bpb * 2; k++) add(t0 + k * 0.5, 0.42, k === bpb * 2 - 1 && last ? oct : root, vel - (k % 2 ? 12 : 0));
          break;
        case 'octaves':
        case 'disco':
          for (let k = 0; k < bpb * 2; k++) add(t0 + k * 0.5, 0.45, k % 2 ? oct : root, vel - (k % 2 ? 6 : 0));
          break;
        case 'arp': {
          const seq = [root, fifth, oct, fifth];
          for (let k = 0; k < bpb * 2; k++) add(t0 + k * 0.5, 0.45, seq[k % 4], vel - (k % 2 ? 8 : 0));
          break;
        }
        case 'walking': {
          const beats = Math.round(bpb);
          const targets = [root];
          let cur = root;
          for (let k = 1; k < beats; k++) {
            if (k === beats - 1) {
              // chromatic or dominant approach to the next chord root
              const apr = last && next ? nextRoot + (rng.chance(0.5) ? -1 : 1) : (rng.chance(0.5) ? fifth : third);
              cur = apr < lo ? apr + 12 : apr > hi ? apr - 12 : apr;
            } else {
              const pool = [third, fifth, seventh, root + (rng.chance(0.3) ? 12 : 0)].filter((m) => m !== cur && m >= lo && m <= hi);
              // prefer small steps from the previous note
              pool.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur) + (rng.next() - 0.5) * 3);
              cur = pool[0] ?? fifth;
            }
            targets.push(cur);
          }
          targets.forEach((p, k) => add(t0 + k * (barLen / beats), (barLen / beats) * 0.92, p, vel - (k % 2 ? 6 : 0) + (k === 0 ? 4 : 0)));
          break;
        }
        case 'funk': {
          const pats = [[0, 0.75, 1.5, 2, 2.75, 3.5], [0, 1, 1.75, 2.5, 3, 3.75], [0, 0.5, 1.5, 2.25, 3, 3.5]];
          const pat = pats[(rng.int(pats.length) + b) % pats.length];
          pat.forEach((t, k) => {
            const pitch = k % 3 === 2 ? oct : k === pat.length - 1 && last ? nextRoot : k % 2 && rng.chance(0.4) ? fifth : root;
            add(t0 + t, k % 2 ? 0.2 : 0.4, pitch, vel - (k % 2 ? 12 : 0) + (k === 0 ? 8 : 0), k % 2 ? 'mute' : undefined);
          });
          break;
        }
        case 'reggae':
          add(t0, 0.9, root, vel);
          add(t0 + 1.5, 0.45, fifth, vel - 12);
          add(t0 + 2, 0.7, root, vel - 4);
          add(t0 + 3.25, 0.5, near(root, mod12(c.root + 10), lo, hi), vel - 14);
          break;
        case 'bossa':
          add(t0, 1.4, root, vel);
          add(t0 + 1.5, 0.45, fifth, vel - 10);
          add(t0 + 2, 1.4, root, vel - 4);
          add(t0 + 3.5, 0.45, fillVar ? third : fifth, vel - 10);
          break;
        case '808': {
          const longHit = barLen * (fillVar ? 0.5 : 0.62);
          add(t0, longHit, root, vel + 6);
          add(t0 + barLen * 0.625, 0.9, root, vel - 4);
          if (fillVar) add(t0 + barLen * 0.875, barLen * 0.12, fifth, vel - 8, 'slide');
          break;
        }
        case 'half-time':
          add(t0, 1.4, root, vel);
          add(t0 + 2.5, 1.2, last && next ? nextRoot : root, vel - 8);
          break;
        case 'pedal': {
          const pp = near(prev, o.pedalPc ?? c.root, lo, hi);
          for (let k = 0; k < bpb * 2; k++) add(t0 + k * 0.5, 0.45, pp, vel - (k % 2 ? 10 : 0));
          break;
        }
        case 'kick-lock': {
          const kicks = (o.kickBeats?.length ? o.kickBeats : [0, 2]).slice().sort((a, bb) => a - bb);
          kicks.forEach((t, k) => {
            const nxt = kicks[k + 1] ?? bpb;
            add(t0 + t, Math.min(1.5, nxt - t) * 0.9, k > 0 && rng.chance(0.18) ? fifth : root, vel - (k ? 6 : 0));
          });
          break;
        }
      }
    }
  }
  return out;
}

export { chordPcs };
