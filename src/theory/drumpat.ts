// Drum pattern generator. Patterns are step grids with velocity digits (1-9, '.' = silence).
// Each bar is varied from the base groove so the part never sounds like a pasted loop, and phrases end with fills.

import { Rng } from '../engine/dsp/core.ts';
import type { TNote } from './humanize.ts';

export const DRUM = {
  kick: 36, sidestick: 37, snare: 38, clap: 39, rimshot: 40, tomFloorLo: 41, hatClosed: 42, tomFloor: 43, hatPedal: 44, tomLo: 45, hatOpen: 46,
  tomLoMid: 47, tomHiMid: 48, crash: 49, tomHi: 50, ride: 51, rideBell: 53, tambourine: 54, cowbell: 56, crash2: 57, shaker: 70, claves: 75,
} as const;

interface Style {
  name: string;
  /** Steps per beat (4 = sixteenth grid, 3 = triplet grid). */
  spb: number;
  kick: string;
  snare: string;
  hat: string;
  open?: string;
  ride?: string;
  side?: string;
  clap?: string;
  extra?: { pitch: number; pat: string }[];
  /** Ghost snare candidates (step indices). */
  ghosts?: number[];
  /** Extra kick candidates. */
  kickAdds?: number[];
  swing?: number;
  tempo: [number, number];
  desc: string;
}

// 16-step bars (4/4). 9 = hard, 7 = medium, 5 = soft, 3 = ghost.
const STYLES: Record<string, Style> = {
  rock: { name: 'rock', spb: 4, kick: '9.......9.7.....', snare: '....9.......9...', hat: '9.5.9.5.9.5.9.5.', ghosts: [7, 15], kickAdds: [14], tempo: [90, 140], desc: 'Backbeat on 2 and 4, eighth-note hats.' },
  pop: { name: 'pop', spb: 4, kick: '9.....7.7.9.....', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.5.', ghosts: [15], kickAdds: [14], tempo: [90, 130], desc: 'Syncopated kick, snare on 2 and 4.' },
  'four-on-floor': { name: 'four-on-floor', spb: 4, kick: '9...9...9...9...', snare: '', clap: '....9.......9...', hat: '5.7.5.7.5.7.5.7.', open: '..9...9...9...9.', tempo: [118, 132], desc: 'House/dance: kick every beat, offbeat open hat, clap on 2 and 4.' },
  house: { name: 'house', spb: 4, kick: '9...9...9...9...', snare: '', clap: '....9.......9...', hat: '3.7.3.7.3.7.3.7.', open: '..9...9...9...9.', extra: [{ pitch: DRUM.shaker, pat: '5.35.35.5.35.355' }], tempo: [120, 128], desc: 'Four on the floor with shaker 16ths.' },
  techno: { name: 'techno', spb: 4, kick: '9...9...9...9...', snare: '', clap: '', hat: '..7...7...7...7.', open: '..9...9...9...9.', extra: [{ pitch: DRUM.rimshot, pat: '.5..5.5...5..5.5' }], tempo: [125, 145], desc: 'Driving kick, offbeat hat, syncopated rim.' },
  disco: { name: 'disco', spb: 4, kick: '9...9...9...9...', snare: '....9.......9...', hat: '5.7.5.7.5.7.5.7.', open: '..9...9...9...9.', ghosts: [7, 11, 15], tempo: [110, 125], desc: 'Four on the floor, open hat on the off-beat, ghosted snare 16ths.' },
  hiphop: { name: 'hiphop', spb: 4, kick: '9..7..7...7.9...', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.7.', ghosts: [10, 15], swing: 0.12, tempo: [78, 98], desc: 'Boom-bap: heavy snare, behind-the-beat kicks, slightly swung hats.' },
  trap: { name: 'trap', spb: 4, kick: '9.......9.......', snare: '........9.......', hat: '7.7.7.7.7.7.7.7.', open: '', kickAdds: [3, 6, 10, 11, 14], tempo: [130, 160], desc: 'Half-time: snare on beat 3, rolling hats, sparse kick.' },
  lofi: { name: 'lofi', spb: 4, kick: '9.....7.7.9.....', snare: '....9.......9...', hat: '5.3.5.3.5.3.5.3.', ghosts: [7, 15], swing: 0.17, tempo: [60, 90], desc: 'Dusty, swung, soft hats, relaxed backbeat.' },
  ballad: { name: 'ballad', spb: 4, kick: '9.......7.......', snare: '', side: '........9.......', hat: '5.3.5.3.5.3.5.3.', tempo: [55, 85], desc: 'Half-time feel with side stick on 3.' },
  reggae: { name: 'reggae', spb: 4, kick: '........9.......', snare: '', side: '........9.......', hat: '9.5.9.5.9.5.9.5.', extra: [{ pitch: DRUM.hatClosed, pat: '..7...7...7...7.' }], tempo: [65, 85], desc: 'One-drop: kick and rim on beat 3.' },
  funk: { name: 'funk', spb: 4, kick: '9..7..9...9.7...', snare: '....9..3.3.39..3', hat: '9.5.7.5.9.5.7.5.', open: '', ghosts: [2, 7, 10, 15], kickAdds: [11, 14], tempo: [90, 120], desc: 'Syncopated kick, ghost-note snare, 16th hats.' },
  breakbeat: { name: 'breakbeat', spb: 4, kick: '9.....9...9.....', snare: '....9.......9.3.', hat: '9.5.9.5.9.5.9.5.', tempo: [120, 140], desc: 'Broken, syncopated kick with a ghost before the backbeat.' },
  dnb: { name: 'dnb', spb: 4, kick: '9.........9.....', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.5.', ghosts: [7, 14], tempo: [165, 178], desc: 'Two-step: kick on 1 and the "and" of 3, snare on 2 and 4.' },
  punk: { name: 'punk', spb: 4, kick: '9...9...9...9...', snare: '....9.......9...', hat: '9.9.9.9.9.9.9.9.', tempo: [160, 200], desc: 'Straight and fast.' },
  metal: { name: 'metal', spb: 4, kick: '9.9.9.9.9.9.9.9.', snare: '....9.......9...', hat: '9...9...9...9...', ride: '', tempo: [120, 200], desc: 'Double kick, backbeat snare, quarter-note crash/hat.' },
  bossa: { name: 'bossa', spb: 4, kick: '9.....7.9.....7.', snare: '', side: '9..9..9...9.9...', hat: '7.5.7.5.7.5.7.5.', tempo: [110, 140], desc: 'Bossa nova: syncopated bass drum and a 3-2 side-stick clave.' },
  jazz: { name: 'jazz', spb: 3, kick: '5..5..5..5..', snare: '', hat: '', ride: '9..7.9.9..7.9', side: '', extra: [{ pitch: DRUM.hatPedal, pat: '...7.....7..' }], ghosts: [2, 5, 8, 11], swing: 0, tempo: [100, 220], desc: 'Swing ride (triplet grid), hi-hat on 2 and 4, feathered kick, comping snare.' },
  shuffle: { name: 'shuffle', spb: 3, kick: '9.....9.....', snare: '...9.....9..', hat: '9.99.99.99.9', tempo: [80, 130], desc: 'Triplet shuffle for blues and rock-and-roll.' },
  waltz: { name: 'waltz', spb: 4, kick: '9...........', snare: '', side: '....7...7...', hat: '5.3.5.3.5.3.', tempo: [80, 140], desc: '3/4: kick on 1, light snare/side stick on 2 and 3.' },
  half: { name: 'half', spb: 4, kick: '9.......9.......', snare: '........9.......', hat: '7.5.7.5.7.5.7.5.', kickAdds: [10, 14], tempo: [70, 100], desc: 'Half-time groove.' },
};

export const DRUM_STYLES = Object.keys(STYLES);

export function drumStyleInfo(): { style: string; description: string; tempo: [number, number]; stepsPerBeat: number }[] {
  return Object.values(STYLES).map((s) => ({ style: s.name, description: s.desc, tempo: s.tempo, stepsPerBeat: s.spb }));
}

const VEL = (ch: string): number => (ch === '.' || ch === ' ' ? 0 : { '9': 112, '8': 104, '7': 94, '6': 86, '5': 76, '4': 66, '3': 52, '2': 42, '1': 34 }[ch] ?? 80);

export interface DrumOptions {
  style: string;
  bars: number;
  beatsPerBar?: number;
  /** 0 = sparse, 1 = full. */
  intensity?: number;
  seed?: number;
  /** A fill is played at the end of every N-th bar (0 = never). */
  fillEvery?: number;
  /** Crash on the first bar and after each fill. */
  crashOnDownbeats?: boolean;
  /** Use the ride instead of closed hats (for choruses). */
  useRide?: boolean;
  /** Override swing 0..0.33. */
  swing?: number;
  /** Time offset of the first bar, in beats. */
  startBeat?: number;
  /** How much each bar is varied from the groove, 0..1. */
  variation?: number;
  halftime?: boolean;
}

function hits(pat: string, spb: number, bar: number, bpb: number, pitch: number, out: TNote[], vmul = 1, dur = 0.12, gate = 1, steps?: number): void {
  const total = steps ?? bpb * spb;
  for (let i = 0; i < Math.min(pat.length, total); i++) {
    const v = VEL(pat[i]);
    if (v) out.push({ t: bar * bpb + i / spb, d: dur, p: pitch, v: Math.max(1, Math.min(127, Math.round(v * vmul))) });
  }
  void gate;
}

export function generateDrums(o: DrumOptions): TNote[] {
  const st = STYLES[o.style];
  if (!st) throw new Error(`Unknown drum style "${o.style}". Known: ${DRUM_STYLES.join(', ')}.`);
  const rng = new Rng(o.seed ?? 4);
  const bpb = o.beatsPerBar ?? (st.name === 'waltz' ? 3 : 4);
  const spb = st.spb;
  const steps = bpb * spb;
  const inten = o.intensity ?? 0.6;
  const variation = o.variation ?? 0.5;
  const out: TNote[] = [];
  const startBeat = o.startBeat ?? 0;
  const fillEvery = o.fillEvery ?? 4;
  const swing = o.swing ?? st.swing ?? 0;
  const pad = (p: string) => (p + '.'.repeat(steps)).slice(0, steps);
  for (let bar = 0; bar < o.bars; bar++) {
    const bn: TNote[] = [];
    const isFillBar = fillEvery > 0 && (bar + 1) % fillEvery === 0 && bar < o.bars - 0;
    let kick = pad(st.kick);
    let snare = pad(st.snare);
    let hat = pad(st.hat);
    let open = st.open ? pad(st.open) : '';
    const half = !!o.halftime;
    if (half) {
      kick = pad(st.kick.slice(0, Math.floor(steps / 2)).split('').map((c, i) => (i === 0 || i === 8 ? c : '.')).join(''));
      snare = '........9.......'.slice(0, steps).padEnd(steps, '.');
    }
    // variation: kick pickups, ghost notes, hat accents, dropped notes
    const kickArr = kick.split('');
    if (st.kickAdds && variation > 0) for (const s of st.kickAdds) if (s < steps && kickArr[s] === '.' && rng.chance(0.28 * variation * (0.4 + inten))) kickArr[s] = '6';
    if (bar % 4 === 3 && rng.chance(0.5 * variation)) kickArr[Math.min(steps - 2, steps - 2)] = kickArr[steps - 2] === '.' ? '6' : kickArr[steps - 2];
    for (let i = 4; i < steps; i++) if (kickArr[i] === '7' && rng.chance(0.18 * variation)) kickArr[i] = '.';
    kick = kickArr.join('');
    const snArr = snare.split('');
    if (st.ghosts && variation > 0) for (const s of st.ghosts) if (s < steps && snArr[s] === '.' && rng.chance(0.35 * variation * inten)) snArr[s] = '3';
    snare = snArr.join('');
    // hats: density follows intensity (thin the pattern when sparse, add 16ths when full)
    const hatArr = hat.split('');
    if (inten < 0.35) for (let i = 0; i < steps; i++) if (i % (spb) !== 0 && spb === 4 && i % 4 !== 0) hatArr[i] = '.';
    if (inten > 0.8 && spb === 4 && st.hat) for (let i = 1; i < steps; i += 2) if (hatArr[i] === '.' && rng.chance(0.45)) hatArr[i] = '3';
    for (let i = 0; i < steps; i++) if (hatArr[i] !== '.' && rng.chance(0.06 * variation)) hatArr[i] = '.';
    hat = hatArr.join('');
    const useRide = o.useRide && !st.ride;
    const sw = swing;
    const emit = (pat: string, pitch: number, vm = 1, dur = 0.12) => {
      for (let i = 0; i < Math.min(pat.length, steps); i++) {
        const v = VEL(pat[i]);
        if (!v) continue;
        let t = i / spb;
        // swing the off-beat sixteenths (and eighths in a 2-step grid)
        if (spb === 4 && sw > 0 && i % 2 === 1) t += (sw / 4) * 1.0;
        bn.push({ t: bar * bpb + t, d: dur, p: pitch, v: Math.max(1, Math.min(127, Math.round(v * vm + (rng.next() - 0.5) * 6))) });
      }
    };
    emit(kick, DRUM.kick, 1, 0.2);
    emit(snare, DRUM.snare, 1, 0.2);
    if (st.clap) emit(pad(st.clap), DRUM.clap, 1, 0.2);
    if (st.side) emit(pad(st.side), DRUM.sidestick, 1, 0.12);
    if (useRide || st.ride) emit(st.ride ? pad(st.ride) : hat, DRUM.ride, 0.9, 0.3);
    else emit(hat, DRUM.hatClosed, 1, 0.08);
    if (open) emit(open, DRUM.hatOpen, 1, 0.3);
    if (st.extra) for (const e of st.extra) emit(pad(e.pat), e.pitch, 0.85, 0.12);
    // fills at the end of phrases
    if (isFillBar && inten > 0.15) {
      const fillStart = bpb - (rng.chance(0.5) ? 1 : 2);
      for (let k = bn.length - 1; k >= 0; k--) if (bn[k].t - bar * bpb >= fillStart - 1e-6 && bn[k].p !== DRUM.kick && bn[k].p !== DRUM.crash) bn.splice(k, 1);
      const kind = rng.int(3);
      const stepsF = Math.round((bpb - fillStart) * spb);
      for (let i = 0; i < stepsF; i++) {
        const frac = i / Math.max(1, stepsF - 1);
        const t = bar * bpb + fillStart + i / spb;
        let pitch: number;
        if (kind === 0) pitch = DRUM.snare;
        else if (kind === 1) pitch = [DRUM.tomHi, DRUM.tomHiMid, DRUM.tomLoMid, DRUM.tomLo, DRUM.tomFloor][Math.min(4, Math.floor(frac * 4.99))];
        else pitch = i % 2 ? DRUM.snare : [DRUM.tomHiMid, DRUM.tomLo][i % 4 === 0 ? 0 : 1];
        if (kind === 2 && i % 3 === 1) continue;
        bn.push({ t, d: 0.15, p: pitch, v: Math.round(62 + frac * 52 + (rng.next() - 0.5) * 8) });
      }
    }
    if (o.crashOnDownbeats && (bar === 0 || (fillEvery > 0 && bar % fillEvery === 0 && bar > 0 && inten > 0.5))) {
      bn.push({ t: bar * bpb, d: 1, p: DRUM.crash, v: 100 });
      // the kick under the crash
      if (!bn.some((n) => n.p === DRUM.kick && Math.abs(n.t - bar * bpb) < 1e-6)) bn.push({ t: bar * bpb, d: 0.2, p: DRUM.kick, v: 108 });
    }
    // jazz: feathered kick and comping
    if (st.name === 'jazz') {
      const beats = bpb;
      for (let b = 0; b < beats; b++) if (rng.chance(0.18 * inten)) bn.push({ t: bar * bpb + b + 2 / 3, d: 0.1, p: DRUM.snare, v: 36 + Math.round(rng.next() * 18) });
    }
    for (const n of bn) out.push({ ...n, t: n.t + startBeat });
  }
  return out;
}

/** Kick positions (in beats within a bar) of a style, so a bass line can lock to them. */
export function kickPositions(style: string, bpb = 4): number[] {
  const st = STYLES[style];
  if (!st) return [0, 2];
  const res: number[] = [];
  for (let i = 0; i < Math.min(st.kick.length, bpb * st.spb); i++) if (VEL(st.kick[i]) >= 90) res.push(i / st.spb);
  return res.length ? res : [0];
}
