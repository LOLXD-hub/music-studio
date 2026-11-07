// Parsing of the units agents and humans type: positions, lengths, note lists in a compact text notation.

import { MeterMap, PPQ } from '../engine/project.ts';
import type { SigPoint } from '../engine/project.ts';
import { noteToMidi, midiToName } from '../theory/pitch.ts';
import type { TNote } from '../theory/humanize.ts';

export type Pos = number | string;

/**
 * A position on the timeline, in beats from the start (0-based).
 * Numbers are beats. Strings: "5:1" = bar 5 beat 1 (1-based), "5" = bar 5, "bar 5", "5:2.5", "3.5b" = 3.5 beats.
 */
export function parsePos(v: Pos | undefined, sig: SigPoint[], fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return v;
  const s = v.trim().toLowerCase();
  const meter = new MeterMap(sig);
  let m = /^(?:bar\s*)?(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return meter.tickOf(parseFloat(m[1]), parseFloat(m[2])) / PPQ;
  m = /^(?:bar|b)\s*(\d+)$/.exec(s);
  if (m) return meter.tickOf(parseInt(m[1], 10), 1) / PPQ;
  m = /^(\d+(?:\.\d+)?)\s*beats?$/.exec(s) ?? /^(\d+(?:\.\d+)?)b$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^(\d+)$/.exec(s);
  if (m) return meter.tickOf(parseInt(m[1], 10), 1) / PPQ;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  throw new Error(`Cannot read position "${v}". Use beats (number) or "bar:beat" such as "5:1".`);
}

/** A length in beats: number, "2 bars", "1.5 beats", "1/4", "1/8" (note values). */
export function parseLen(v: Pos | undefined, sig: SigPoint[], at = 0, fallback = 4): number {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return v;
  const s = v.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(?:bars?|bar)$/.exec(s);
  if (m) {
    const meter = new MeterMap(sig);
    return (parseFloat(m[1]) * meter.barTicksAt(at * PPQ)) / PPQ;
  }
  m = /^(\d+(?:\.\d+)?)\s*(?:beats?|b)$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return (4 * parseInt(m[1], 10)) / parseInt(m[2], 10);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  throw new Error(`Cannot read length "${v}". Use beats (number) or "2 bars".`);
}

export function beatsPerBarAt(sig: SigPoint[], beat = 0): number {
  return new MeterMap(sig).barTicksAt(beat * PPQ) / PPQ;
}

export function barOfBeat(sig: SigPoint[], beat: number): { bar: number; beat: number } {
  return new MeterMap(sig).position(beat * PPQ);
}

const DUR_LETTERS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125, x: 1 / 3 };

function parseDur(tok: string): number {
  let t = tok.trim();
  let mult = 1;
  while (t.endsWith('.')) {
    mult *= 1.5;
    t = t.slice(0, -1);
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return ((4 * parseInt(frac[1], 10)) / parseInt(frac[2], 10)) * mult;
  if (DUR_LETTERS[t] !== undefined) return DUR_LETTERS[t] * mult;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Bad duration "${tok}". Use beats (1, 0.5) or letters w h q e s (e.g. q.).`);
  return n * mult;
}

/**
 * Compact note text. Examples:
 *   "C4:1 E4:0.5 G4:0.5 r:1 [C4 E4 G4]:2@80"
 *   "C4:q E4:e G4:e. r:q Bb3:h!stac"
 * Token = pitch[:dur][@velocity][!articulation]. `r` or `-` is a rest, `[..]` is a chord, a trailing `~` ties to the next
 * note of the same pitch. Duration is sticky: omitted durations repeat the previous one. Bar lines `|` are ignored.
 * Returns notes with start in beats from 0.
 */
export function parseNoteText(text: string, defaults: { dur?: number; vel?: number } = {}): TNote[] {
  const out: TNote[] = [];
  let t = 0;
  let dur = defaults.dur ?? 1;
  let vel = defaults.vel ?? 90;
  const src = text.replace(/\|/g, ' ').replace(/\[([^\]]*)\]/g, (_m, inner: string) => '[' + inner.trim().split(/\s+/).join(',') + ']');
  const toks = src.split(/\s+/).filter(Boolean);
  const pendingTie = new Map<number, TNote>();
  for (const raw of toks) {
    let tok = raw;
    let art: string | undefined;
    const bang = tok.indexOf('!');
    if (bang >= 0) {
      art = tok.slice(bang + 1);
      tok = tok.slice(0, bang);
    }
    let v = vel;
    const at = tok.indexOf('@');
    if (at >= 0) {
      v = parseInt(tok.slice(at + 1), 10);
      tok = tok.slice(0, at);
      vel = v;
    }
    let d = dur;
    const colon = tok.lastIndexOf(':');
    let head = tok;
    if (colon >= 0) {
      d = parseDur(tok.slice(colon + 1));
      head = tok.slice(0, colon);
      dur = d;
    }
    let tie = false;
    if (head.endsWith('~')) {
      tie = true;
      head = head.slice(0, -1);
    }
    if (head === 'r' || head === '-' || head === 'R') {
      t += d;
      continue;
    }
    const names = head.startsWith('[') ? head.slice(1, -1).split(',') : [head];
    for (const nm of names) {
      const p = noteToMidi(nm);
      const prev = pendingTie.get(p);
      if (prev) {
        prev.d += d;
        if (!tie) pendingTie.delete(p);
        continue;
      }
      const n: TNote = { t, d, p, v, art };
      out.push(n);
      if (tie) pendingTie.set(p, n);
    }
    t += d;
  }
  return out;
}

/** Render notes (beats) as compact text, one line per bar. Notes are absolute beats; bar numbers are 1-based. */
export function notesToText(notes: TNote[], sig: SigPoint[], opts: { from?: number; to?: number } = {}): string {
  const meter = new MeterMap(sig);
  const sorted = [...notes].filter((n) => (opts.from === undefined || n.t >= opts.from - 1e-6) && (opts.to === undefined || n.t < opts.to - 1e-6)).sort((a, b) => a.t - b.t || a.p - b.p);
  const lines: string[] = [];
  let curBar = -1;
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) lines.push(`bar ${curBar}: ${cur.join(' ')}`);
    cur = [];
  };
  let i = 0;
  while (i < sorted.length) {
    const n = sorted[i];
    const pos = meter.position(Math.round(n.t * PPQ));
    if (pos.bar !== curBar) {
      flush();
      curBar = pos.bar;
    }
    // group simultaneous notes into a chord
    const group = [n];
    while (i + group.length < sorted.length && Math.abs(sorted[i + group.length].t - n.t) < 0.02 && Math.abs(sorted[i + group.length].d - n.d) < 0.05) group.push(sorted[i + group.length]);
    const name = group.length > 1 ? '[' + group.map((g) => midiToName(g.p)).join(' ') + ']' : midiToName(n.p);
    const at = +pos.beat.toFixed(3);
    cur.push(`${name}@${at}:${+n.d.toFixed(3)}${n.v !== 90 ? 'v' + n.v : ''}${n.art ? '!' + n.art : ''}`);
    i += group.length;
  }
  flush();
  return lines.join('\n');
}
