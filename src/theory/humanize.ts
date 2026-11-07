// Making notated music sound played: timing drift, velocity shape, strums, legato, pedal and expression curves.
// All times are in beats (quarter notes). `bpm` converts the millisecond options.

import { Rng } from '../engine/dsp/core.ts';

export interface TNote {
  /** Start in beats. */
  t: number;
  /** Duration in beats. */
  d: number;
  /** MIDI pitch. */
  p: number;
  /** Velocity 1..127. */
  v: number;
  art?: string;
}

export interface CCPointB {
  t: number;
  v: number;
}

export interface HumanizeOptions {
  bpm: number;
  seed?: number;
  /** Standard deviation of per-note timing error, ms. 4-10 is natural. */
  timing?: number;
  /** Amplitude of slow timing drift, ms. Makes the whole part breathe. */
  drift?: number;
  /** Velocity jitter (std dev). */
  velocity?: number;
  /** Mean shift of the part against the beat: negative = ahead, positive = behind (laid back). */
  tendencyMs?: number;
  /** Velocity added on strong beats; beatsPerBar defaults to 4. */
  accent?: number;
  beatsPerBar?: number;
  /** Duration jitter, 0..1 relative. */
  lengthVar?: number;
  /** Louder notes arrive slightly earlier, ms per 10 velocity above 64. */
  coupling?: number;
  /** Keep notes that start together moving together (chords). Default true. */
  keepChords?: boolean;
  /** Do not move notes that start exactly on this beat (downbeat anchor). */
  anchorFirst?: boolean;
}

function smoothNoise(seed: number): (t: number) => number {
  const r = new Rng(seed);
  const comps = [0, 1, 2].map((i) => ({ f: 1 / (3.7 + i * 2.9 + r.next() * 2), ph: r.next() * Math.PI * 2, a: 1 / (1 + i * 0.8) }));
  const norm = comps.reduce((a, c) => a + c.a, 0);
  return (t) => comps.reduce((a, c) => a + Math.sin(Math.PI * 2 * (c.f * t) + c.ph) * c.a, 0) / norm;
}

export function humanize(notes: TNote[], o: HumanizeOptions): TNote[] {
  const rng = new Rng(o.seed ?? 1);
  const msToBeats = (ms: number) => (ms / 1000) * (o.bpm / 60);
  const noise = smoothNoise((o.seed ?? 1) * 7 + 3);
  const bpb = o.beatsPerBar ?? 4;
  const keep = o.keepChords !== false;
  const jitterCache = new Map<number, number>();
  const first = notes.length ? Math.min(...notes.map((n) => n.t)) : 0;
  return notes.map((n) => {
    const key = Math.round(n.t * 960);
    let jitter: number;
    if (keep && jitterCache.has(key)) jitter = jitterCache.get(key)! + rng.gauss() * 1.2;
    else {
      jitter = rng.gauss() * (o.timing ?? 6);
      jitterCache.set(key, jitter);
    }
    let ms = jitter + noise(n.t) * (o.drift ?? 0) + (o.tendencyMs ?? 0);
    ms -= ((n.v - 64) / 10) * (o.coupling ?? 0);
    const posInBar = ((n.t % bpb) + bpb) % bpb;
    let vel = n.v + rng.gauss() * (o.velocity ?? 5);
    if (o.accent) {
      const strong = posInBar < 0.01 ? 1 : Math.abs(posInBar - bpb / 2) < 0.01 ? 0.6 : Math.abs(posInBar - Math.round(posInBar)) < 0.01 ? 0.25 : 0;
      vel += o.accent * strong;
    }
    const anchored = o.anchorFirst && Math.abs(n.t - first) < 1e-6;
    const dt = anchored ? 0 : msToBeats(ms);
    const lv = 1 + (rng.next() - 0.5) * 2 * (o.lengthVar ?? 0);
    return { ...n, t: Math.max(0, n.t + dt), d: Math.max(0.03, n.d * lv - Math.min(0, dt) * 0), v: Math.max(1, Math.min(127, Math.round(vel))) };
  });
}

/** Push every off-beat note later to swing it. amount 0 = straight, 0.33 = triplet swing (grid is the subdivision in beats). */
export function applySwing(notes: TNote[], amount: number, grid = 0.5): TNote[] {
  const pair = grid * 2;
  return notes.map((n) => {
    const pos = ((n.t % pair) + pair) % pair;
    if (Math.abs(pos - grid) < 0.02) return { ...n, t: n.t + amount * grid };
    return n;
  });
}

export function quantize(notes: TNote[], grid: number, strength = 1): TNote[] {
  return notes.map((n) => {
    const q = Math.round(n.t / grid) * grid;
    return { ...n, t: n.t + (q - n.t) * strength };
  });
}

/** Spread notes that start together over a few milliseconds, like a strummed or rolled chord. */
export function strum(notes: TNote[], o: { bpm: number; spreadMs?: number; direction?: 'down' | 'up' | 'alt'; seed?: number; velocityTaper?: number }): TNote[] {
  const rng = new Rng(o.seed ?? 5);
  const groups = new Map<number, TNote[]>();
  for (const n of notes) {
    const k = Math.round(n.t * 480);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }
  const out: TNote[] = [];
  let gi = 0;
  for (const [, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    g.sort((a, b) => a.p - b.p);
    const dir = o.direction === 'alt' ? (gi % 2 === 0 ? 'down' : 'up') : o.direction ?? 'down';
    const order = dir === 'down' ? g : [...g].reverse();
    const spread = ((o.spreadMs ?? 18) / 1000) * (o.bpm / 60);
    order.forEach((n, i) => {
      const off = g.length > 1 ? (i / (g.length - 1)) * spread * (0.85 + rng.next() * 0.3) : 0;
      const taper = 1 - (o.velocityTaper ?? 0.08) * (i / Math.max(1, g.length - 1));
      out.push({ ...n, t: n.t + off, d: Math.max(0.03, n.d - off), v: Math.round(n.v * taper) });
    });
    gi++;
  }
  return out;
}

/** Extend each note to meet the next note of a monophonic line, as a bow or breath would. */
export function legato(notes: TNote[], o: { bpm: number; overlapMs?: number; amount?: number }): TNote[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.p - b.p);
  const ov = ((o.overlapMs ?? 25) / 1000) * (o.bpm / 60);
  const amt = o.amount ?? 1;
  return sorted.map((n, i) => {
    const next = sorted.slice(i + 1).find((m) => m.t > n.t + 0.02);
    if (!next) return n;
    const gap = next.t - (n.t + n.d);
    if (gap > 0 && gap < 0.75) return { ...n, d: n.d + gap * amt + ov * amt };
    if (gap <= 0) return { ...n, d: Math.max(n.d, next.t - n.t + ov * amt) };
    return n;
  });
}

/** Cut notes short to a fraction of their length (staccato feel) without changing onsets. */
export function shorten(notes: TNote[], factor: number): TNote[] {
  return notes.map((n) => ({ ...n, d: Math.max(0.05, n.d * factor) }));
}

/** Arch dynamics over each phrase: gentle crescendo to ~65% then decrescendo. */
export function phraseDynamics(notes: TNote[], o: { phraseBeats: number; depth?: number; peak?: number }): TNote[] {
  const depth = o.depth ?? 10;
  const peak = o.peak ?? 0.65;
  return notes.map((n) => {
    const x = (n.t % o.phraseBeats) / o.phraseBeats;
    const shape = x < peak ? x / peak : 1 - (x - peak) / (1 - peak) * 0.9;
    return { ...n, v: Math.max(1, Math.min(127, Math.round(n.v + (shape - 0.55) * 2 * depth))) };
  });
}

/** In homophonic textures (piano, guitar) make the top voice speak and keep inner voices behind. */
export function voiceBalance(notes: TNote[], o: { melodyBoost?: number; bassBoost?: number; innerCut?: number } = {}): TNote[] {
  const groups = new Map<number, TNote[]>();
  for (const n of notes) {
    const k = Math.round(n.t * 240);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }
  const out: TNote[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.p - b.p);
    g.forEach((n, i) => {
      let v = n.v;
      if (g.length > 1) {
        if (i === g.length - 1) v += o.melodyBoost ?? 7;
        else if (i === 0) v += o.bassBoost ?? 2;
        else v -= o.innerCut ?? 5;
      }
      out.push({ ...n, v: Math.max(1, Math.min(127, v)) });
    });
  }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}

/** Sustain pedal for a chord progression: down just after the chord lands, up just before the next, so harmonies do not blur. */
export function pedalChanges(chordStarts: number[], endBeat: number, bpm: number): CCPointB[] {
  const lift = (60 / 1000) * (bpm / 60);
  const pts: CCPointB[] = [];
  chordStarts.forEach((s, i) => {
    const next = chordStarts[i + 1] ?? endBeat;
    pts.push({ t: Math.max(0, s - lift * 0.3), v: 0 });
    pts.push({ t: s + lift * 0.5, v: 127 });
    pts.push({ t: Math.max(s + 0.1, next - lift), v: 127 });
  });
  pts.push({ t: endBeat, v: 0 });
  return pts;
}

/** Expression (CC11) arch for each phrase so long notes swell and fade like a breathing player. */
export function expressionArch(startBeat: number, endBeat: number, phraseBeats: number, o: { low?: number; high?: number; step?: number } = {}): CCPointB[] {
  const low = o.low ?? 78;
  const high = o.high ?? 120;
  const step = o.step ?? 0.5;
  const pts: CCPointB[] = [];
  for (let t = startBeat; t < endBeat; t += step) {
    const x = ((t - startBeat) % phraseBeats) / phraseBeats;
    const shape = x < 0.62 ? Math.sin((x / 0.62) * Math.PI * 0.5) : Math.cos(((x - 0.62) / 0.38) * Math.PI * 0.5) * 0.85 + 0.15 * (1 - (x - 0.62) / 0.38);
    pts.push({ t, v: Math.round(low + (high - low) * shape) });
  }
  return pts;
}

/**
 * Tempo give-and-take baked into note times: slow down into phrase ends and recover.
 * amount 0.02-0.06 is tasteful for classical and ballads.
 */
export function rubato(notes: TNote[], o: { phraseBeats: number; amount?: number; seed?: number }): TNote[] {
  const amt = o.amount ?? 0.03;
  const warp = (t: number) => {
    const ph = Math.floor(t / o.phraseBeats);
    const x = (t - ph * o.phraseBeats) / o.phraseBeats;
    // cumulative stretch: a small push in the first half, a larger pull at the end
    const stretch = amt * (Math.sin(x * Math.PI * 0.5) * 0.4 - (x > 0.7 ? 0 : 0) + (x > 0.75 ? ((x - 0.75) / 0.25) * 1.2 : 0));
    return t + stretch * o.phraseBeats;
  };
  return notes.map((n) => {
    const a = warp(n.t);
    const b = warp(n.t + n.d);
    return { ...n, t: a, d: Math.max(0.03, b - a) };
  });
}

/** Add a bar of ghost notes or grace notes before the main note, for guitar and keys. */
export function graceNotes(notes: TNote[], o: { probability: number; seed?: number; bpm: number }): TNote[] {
  const rng = new Rng(o.seed ?? 3);
  const out: TNote[] = [];
  const g = (45 / 1000) * (o.bpm / 60);
  for (const n of notes) {
    if (n.d >= 0.5 && rng.chance(o.probability)) {
      const below = n.p - (rng.chance(0.7) ? 1 : 2);
      out.push({ t: Math.max(0, n.t - g * 1.2), d: g * 1.2, p: below, v: Math.max(1, n.v - 22) });
    }
    out.push(n);
  }
  return out;
}

/** Merge CC points so values change smoothly and there are no redundant events. */
export function thinCC(pts: CCPointB[], minDelta = 2): CCPointB[] {
  const out: CCPointB[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.v - p.v) >= minDelta || p.t - last.t > 4) out.push(p);
  }
  return out;
}
