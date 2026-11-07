// Harmony analysis and a composition critic. It looks for the habits that make generated music sound generic:
// loops pasted for bars, flat velocities, a melody that ignores the chords, no arc, no breathing room.

import { identifyChord, mod12, parseKey, scalePcs, makeChord, chordPcs, SCALES } from './pitch.ts';
import type { Chord, Key } from './pitch.ts';
import type { TNote } from './humanize.ts';

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db + 1e-12);
}

/** Estimate the key from notes (duration-weighted pitch classes, Krumhansl-Schmuckler profiles). */
export function estimateKey(notes: TNote[]): { key: Key; score: number; alternatives: { key: Key; score: number }[] } | null {
  if (notes.length < 4) return null;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[mod12(n.p)] += Math.min(4, n.d) * (0.5 + n.v / 127);
  const cands: { key: Key; score: number }[] = [];
  for (let r = 0; r < 12; r++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - r + 12) % 12]);
    cands.push({ key: { root: r, mode: 'major' }, score: pearson(hist, rot(MAJOR_PROFILE)) });
    cands.push({ key: { root: r, mode: 'minor' }, score: pearson(hist, rot(MINOR_PROFILE)) });
  }
  cands.sort((a, b) => b.score - a.score);
  return { key: cands[0].key, score: cands[0].score, alternatives: cands.slice(1, 3) };
}

export interface ChordSegment {
  startBeat: number;
  beats: number;
  chord: Chord | null;
  confidence: number;
}

/** Name the harmony of a set of notes, one segment per bar (or half bar when the harmony moves faster). */
export function segmentChords(notes: TNote[], beatsPerBar: number, totalBeats: number, seg = 0): ChordSegment[] {
  const out: ChordSegment[] = [];
  const size = seg || beatsPerBar;
  for (let t = 0; t < totalBeats - 1e-6; t += size) {
    const inSeg = notes.filter((n) => n.t < t + size - 1e-6 && n.t + n.d > t + 1e-6);
    if (!inSeg.length) { out.push({ startBeat: t, beats: size, chord: null, confidence: 0 }); continue; }
    const pitches = inSeg.map((n) => n.p);
    const weights = inSeg.map((n) => {
      const overlap = Math.min(n.t + n.d, t + size) - Math.max(n.t, t);
      return overlap * (n.p < 55 ? 1.5 : 1) * (0.5 + n.v / 127);
    });
    const r = identifyChord(pitches, weights);
    out.push({ startBeat: t, beats: size, chord: r?.chord ?? null, confidence: r?.score ?? 0 });
  }
  return out;
}

const ROMAN_MAJOR = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const ROMAN_MINOR = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'];

export function romanOf(key: Key, c: Chord): string {
  const off = mod12(c.root - key.root);
  const minorKey = ['minor', 'dorian', 'phrygian', 'locrian', 'harmonic minor', 'melodic minor'].includes(key.mode);
  let n = (minorKey ? ROMAN_MINOR : ROMAN_MAJOR)[off];
  const minorish = ['min', 'm7', 'm7b5', 'dim', 'dim7', 'm6', 'm9', 'madd9', 'm11', 'm13', 'mMaj7'].includes(c.quality);
  if (minorish) n = n.toLowerCase();
  const suffix: Record<string, string> = { '7': '7', maj7: 'maj7', m7: '7', m7b5: 'ø7', dim: '°', dim7: '°7', '9': '9', maj9: 'maj9', m9: '9', sus4: 'sus4', sus2: 'sus2', '6': '6', add9: 'add9' };
  return n + (suffix[c.quality] ?? '');
}

// ---------------------------------------------------------------- critic

export type Category = 'harmony' | 'melody' | 'rhythm' | 'dynamics' | 'structure' | 'humanization' | 'orchestration';

export interface Finding {
  category: Category;
  severity: 'problem' | 'warn' | 'info';
  track?: string;
  bars?: [number, number];
  message: string;
  fix: string;
}

export interface CritTrack {
  name: string;
  /** melody | bass | chords | pad | drums | arp | counter | fx | other */
  role?: string;
  instrument?: string;
  range?: [number, number];
  notes: TNote[];
}

export interface CritInput {
  bpm: number;
  beatsPerBar: number;
  key?: Key;
  tracks: CritTrack[];
  totalBeats: number;
}

export interface Critique {
  score: Record<Category | 'overall', number>;
  findings: Finding[];
  strengths: string[];
  analysis: {
    estimatedKey?: string;
    declaredKey?: string;
    bars: number;
    chordsByBar: string[];
    romanByBar: string[];
    density: { bar: number; notes: number }[];
  };
}

const ACOUSTIC = new Set(['piano', 'plucked', 'wind_string', 'mallet', 'organ']);

function role(t: CritTrack): string {
  if (t.role) return t.role;
  const n = t.name.toLowerCase();
  if (t.instrument === 'drums' || /drum|perc|kit/.test(n)) return 'drums';
  if (/bass/.test(n)) return 'bass';
  if (/lead|melody|vocal|violin|flute|trumpet|solo/.test(n)) return 'melody';
  if (/pad|string|choir|ambient/.test(n)) return 'pad';
  if (/arp|pluck/.test(n)) return 'arp';
  return 'chords';
}

function barOf(t: number, bpb: number): number {
  return Math.floor(t / bpb) + 1;
}

function fingerprint(notes: TNote[], barStart: number, bpb: number): string {
  const inBar = notes.filter((n) => n.t >= barStart - 1e-6 && n.t < barStart + bpb - 1e-6).sort((a, b) => a.t - b.t || a.p - b.p);
  if (!inBar.length) return '';
  return inBar.map((n) => `${Math.round((n.t - barStart) * 16)}:${n.p}:${Math.round(n.d * 8)}`).join('|');
}

function std(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export function critique(input: CritInput): Critique {
  const bpb = input.beatsPerBar;
  const totalBars = Math.max(1, Math.ceil(input.totalBeats / bpb));
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const add = (f: Finding) => findings.push(f);
  const pitched = input.tracks.filter((t) => role(t) !== 'drums' && t.notes.length);
  const allPitched = pitched.flatMap((t) => t.notes);
  const est = estimateKey(allPitched);
  let key = input.key ?? est?.key;
  if (input.key && est && est.score > 0.7) {
    const a = scalePcs(input.key);
    const b = scalePcs(est.key);
    const shared = a.filter((x) => b.includes(x)).length;
    if (shared < 5) add({ category: 'harmony', severity: 'warn', message: `Declared key ${input.key.root}/${input.key.mode} does not match the notes, which look like ${est.key.root}/${est.key.mode} (score ${est.score.toFixed(2)}).`, fix: 'Check the project key or transpose the part that is out of key.' });
  }
  const keyPcs = key ? new Set(scalePcs(key)) : null;

  // chord analysis from all pitched tracks except bass-only and melody
  const harmonicTracks = pitched.filter((t) => ['chords', 'pad', 'arp', 'counter', 'other'].includes(role(t)));
  const harmNotes = (harmonicTracks.length ? harmonicTracks : pitched).flatMap((t) => t.notes);
  const bassNotes = pitched.filter((t) => role(t) === 'bass').flatMap((t) => t.notes);
  const chordSegs = segmentChords([...harmNotes, ...bassNotes], bpb, input.totalBeats);
  const chordsByBar = chordSegs.map((s) => (s.chord ? s.chord.symbol : '-'));
  const romanByBar = chordSegs.map((s) => (s.chord && key ? romanOf(key, s.chord) : '-'));

  // ---- per track
  for (const t of input.tracks) {
    const r = role(t);
    const n = t.notes;
    if (!n.length) continue;
    const isAcoustic = t.instrument ? ACOUSTIC.has(t.instrument) : r !== 'drums';
    // range
    if (t.range) {
      const out = n.filter((x) => x.p < t.range![0] || x.p > t.range![1]).length;
      if (out / n.length > 0.04) add({ category: 'orchestration', severity: 'warn', track: t.name, message: `${out} of ${n.length} notes lie outside the playable range of ${t.instrument ?? 'the instrument'} (${t.range[0]}-${t.range[1]}).`, fix: 'Transpose those passages by an octave or give the part to a different instrument.' });
    }
    // velocity flatness
    if (n.length >= 16) {
      const vs = n.map((x) => x.v);
      const sd = std(vs);
      const distinct = new Set(vs).size;
      if (sd < 2.5 || distinct <= 2) add({ category: 'humanization', severity: r === 'drums' ? 'info' : 'warn', track: t.name, message: `Velocity barely changes (std ${sd.toFixed(1)}, ${distinct} distinct values). The part will sound mechanical.`, fix: "Use compose action 'humanize' or shape accents: strong beats +8, off-beats -6, phrase peaks louder, ghost notes quieter." });
    }
    // grid lock
    if (n.length >= 24 && isAcoustic && r !== 'drums') {
      const onGrid = n.filter((x) => Math.abs(x.t * 4 - Math.round(x.t * 4)) < 0.004 * 4).length / n.length;
      if (onGrid > 0.96) add({ category: 'humanization', severity: 'warn', track: t.name, message: `${Math.round(onGrid * 100)}% of the note starts sit exactly on the 16th-note grid. A live player is never this exact.`, fix: "Apply 'humanize' with timing 5-9 ms and drift, or 'perform' for the instrument, which also adds idiomatic articulation." });
    }
    // repetition
    if (n.length >= 24 && totalBars >= 8) {
      const prints: string[] = [];
      for (let b = 0; b < totalBars; b++) prints.push(fingerprint(n, b * bpb, bpb));
      let run = 1;
      let maxRun = 1;
      let runStart = 0;
      let bestStart = 0;
      for (let b = 1; b < prints.length; b++) {
        if (prints[b] && prints[b] === prints[b - 1]) { run++; if (run > maxRun) { maxRun = run; bestStart = runStart; } }
        else { run = 1; runStart = b; }
      }
      const nonEmpty = prints.filter((p) => p);
      const distinct = new Set(nonEmpty).size;
      const limit = r === 'drums' || r === 'bass' || r === 'arp' ? 8 : r === 'melody' ? 2 : 4;
      if (maxRun > limit) add({ category: 'structure', severity: maxRun > limit * 2 ? 'warn' : 'info', track: t.name, bars: [bestStart + 1, bestStart + maxRun], message: `The same bar repeats ${maxRun} times in a row (bars ${bestStart + 1}-${bestStart + maxRun}). Exact repetition is what makes generated loops sound generic.`, fix: 'Vary every second or fourth bar: change a note or rhythm, move the voicing, add a pickup or a fill; let the part drop out for a bar.' });
      if (nonEmpty.length >= 8 && distinct / nonEmpty.length < 0.2 && r !== 'drums') add({ category: 'structure', severity: 'info', track: t.name, message: `Only ${distinct} different bars across ${nonEmpty.length} bars of material.`, fix: 'Introduce at least one contrasting section and a variation of the main pattern.' });
    }
    // melody
    if (r === 'melody' && n.length >= 8) {
      const s = [...n].sort((a, b) => a.t - b.t);
      const ints = s.slice(1).map((x, i) => x.p - s[i].p);
      const step = ints.filter((x) => Math.abs(x) >= 1 && Math.abs(x) <= 2).length / ints.length;
      const rep = ints.filter((x) => x === 0).length / ints.length;
      const leapBig = ints.filter((x) => Math.abs(x) > 7).length / ints.length;
      const range = Math.max(...s.map((x) => x.p)) - Math.min(...s.map((x) => x.p));
      if (rep > 0.3) add({ category: 'melody', severity: 'warn', track: t.name, message: `${Math.round(rep * 100)}% of the intervals are repeated notes. The line is static.`, fix: 'Move by step or by a chord-tone leap, and use rhythm (not repetition) to create interest.' });
      if (leapBig > 0.2) add({ category: 'melody', severity: 'warn', track: t.name, message: `${Math.round(leapBig * 100)}% of the intervals are larger than a fifth. The line is hard to sing and sounds random.`, fix: 'Follow a leap with a step in the opposite direction; keep most motion within a third.' });
      if (step < 0.35 && rep < 0.3) add({ category: 'melody', severity: 'info', track: t.name, message: 'Few stepwise moves; the melody mostly jumps.', fix: 'Add passing tones between chord tones.' });
      if (range < 6) add({ category: 'melody', severity: 'info', track: t.name, message: `Melodic range is only ${range} semitones.`, fix: 'Let the phrase climb to a peak note (an octave above the start in a chorus) and come back down.' });
      if (range > 26) add({ category: 'melody', severity: 'warn', track: t.name, message: `Melodic range of ${range} semitones is wider than most instruments and voices can manage.`, fix: 'Keep a phrase inside an octave and a half.' });
      // strong-beat chord tones
      let strong = 0;
      let strongOk = 0;
      for (const x of s) {
        const pos = ((x.t % bpb) + bpb) % bpb;
        if (pos < 0.01 || (bpb === 4 && Math.abs(pos - 2) < 0.01)) {
          const seg = chordSegs[Math.min(chordSegs.length - 1, Math.floor(x.t / bpb))];
          if (seg?.chord) {
            strong++;
            if (chordPcs(seg.chord).includes(mod12(x.p))) strongOk++;
          }
        }
      }
      if (strong >= 8 && strongOk / strong < 0.45) add({ category: 'melody', severity: 'warn', track: t.name, message: `Only ${Math.round((100 * strongOk) / strong)}% of the strong-beat melody notes are chord tones. The melody and chords fight each other.`, fix: 'Put chord tones on beats 1 and 3; use non-chord tones as passing or neighbour notes on weak beats.' });
      else if (strong >= 8 && strongOk / strong > 0.6) strengths.push(`${t.name}: strong beats land on chord tones (${Math.round((100 * strongOk) / strong)}%).`);
      // phrase endings
      const phraseBars = 4;
      let ends = 0;
      let endsOk = 0;
      for (let b = phraseBars; b <= totalBars; b += phraseBars) {
        const endBeat = b * bpb;
        const inLast = s.filter((x) => x.t < endBeat && x.t >= endBeat - bpb);
        if (!inLast.length) continue;
        const last = inLast[inLast.length - 1];
        ends++;
        const seg = chordSegs[Math.min(chordSegs.length - 1, Math.floor(last.t / bpb))];
        const stable = seg?.chord ? chordPcs(seg.chord).includes(mod12(last.p)) : true;
        if (stable && last.d >= 1) endsOk++;
      }
      if (ends >= 2 && endsOk / ends < 0.5) add({ category: 'melody', severity: 'info', track: t.name, message: 'Phrases do not come to rest: the last note of most 4-bar groups is short or not a chord tone.', fix: 'End phrases on a held chord tone (at least one beat) so the listener feels a breath.' });
      // breathing
      let tight = 0;
      for (let i = 1; i < s.length; i++) if (s[i].t - (s[i - 1].t + s[i - 1].d) < 0.05) tight++;
      if (s.length > 24 && tight / s.length > 0.97 && totalBars > 8) add({ category: 'melody', severity: 'info', track: t.name, message: 'The melody never rests.', fix: 'Leave a beat or two of silence at the end of each phrase.' });
      // out of key
      if (keyPcs) {
        const out = s.filter((x) => !keyPcs.has(mod12(x.p)) && x.d >= 0.5).length / s.length;
        if (out > 0.14) add({ category: 'harmony', severity: 'warn', track: t.name, message: `${Math.round(out * 100)}% of the longer melody notes are outside the key.`, fix: 'Check for wrong accidentals, or declare the intended modal colour in the key.' });
      }
    }
    // bass vs chords
    if (r === 'bass' && chordSegs.some((c) => c.chord)) {
      let hit = 0;
      let tot = 0;
      chordSegs.forEach((seg) => {
        if (!seg.chord) return;
        const first = n.filter((x) => x.t >= seg.startBeat - 0.01 && x.t < seg.startBeat + seg.beats).sort((a, b) => a.t - b.t)[0];
        if (!first) return;
        tot++;
        if (mod12(first.p) === (seg.chord.bass ?? seg.chord.root) || chordPcs(seg.chord).includes(mod12(first.p))) hit++;
      });
      if (tot >= 4 && hit / tot < 0.6) add({ category: 'harmony', severity: 'warn', track: t.name, message: `The bass plays a chord tone of the current chord at the start of only ${Math.round((100 * hit) / tot)}% of the bars.`, fix: 'Start each chord change on its root (or the slash bass), then move.' });
    }
  }

  // ---- chordal voice leading: parallel perfect intervals between outer voices
  for (const t of harmonicTracks) {
    const groups = new Map<number, TNote[]>();
    for (const n of t.notes) {
      const k = Math.round(n.t * 8);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(n);
    }
    const chords = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => a.p - b.p)).filter((g) => g.length >= 3);
    let par = 0;
    let first: number | undefined;
    for (let i = 1; i < chords.length; i++) {
      const a = chords[i - 1], b = chords[i];
      const ia = mod12(a[a.length - 1].p - a[0].p);
      const ib = mod12(b[b.length - 1].p - b[0].p);
      const topMove = b[b.length - 1].p - a[a.length - 1].p;
      const lowMove = b[0].p - a[0].p;
      if ((ia === 7 || ia === 0) && ia === ib && topMove !== 0 && Math.sign(topMove) === Math.sign(lowMove) && Math.abs(topMove) > 0) { par++; first ??= barOf(b[0].t, bpb); }
    }
    if (par >= 3) add({ category: 'harmony', severity: 'info', track: t.name, bars: first ? [first, first] : undefined, message: `${par} parallel fifths or octaves between the outer voices.`, fix: "Re-voice with theory voicing (action 'voice_lead'), which keeps common tones and avoids parallels." });
  }

  // ---- register clashes
  const lowTracks = pitched.filter((t) => t.notes.some((n) => n.p < 52));
  if (lowTracks.length >= 2) {
    for (let i = 0; i < lowTracks.length; i++) for (let j = i + 1; j < lowTracks.length; j++) {
      let clash = 0;
      for (const a of lowTracks[i].notes) {
        if (a.p >= 52) continue;
        for (const b of lowTracks[j].notes) {
          if (b.p >= 52 || b.t >= a.t + a.d || a.t >= b.t + b.d) continue;
          const d = Math.abs(a.p - b.p);
          if (d > 0 && d < 3) clash++;
        }
      }
      if (clash > 6) add({ category: 'orchestration', severity: 'warn', message: `${lowTracks[i].name} and ${lowTracks[j].name} play notes less than a minor third apart below middle C (${clash} times). That sounds muddy.`, fix: 'Move one part up an octave, thin the voicing below C3, or high-pass the track.' });
    }
  }

  // ---- structure and dynamics over time
  const perBar: number[] = new Array(totalBars).fill(0);
  const velBar: number[] = new Array(totalBars).fill(0);
  const velCnt: number[] = new Array(totalBars).fill(0);
  for (const t of input.tracks) {
    for (const n of t.notes) {
      const b = Math.min(totalBars - 1, Math.floor(n.t / bpb));
      perBar[b]++;
      velBar[b] += n.v;
      velCnt[b]++;
    }
  }
  const density = perBar.map((c, i) => ({ bar: i + 1, notes: c }));
  if (totalBars >= 16) {
    const win = 8;
    const avgs: number[] = [];
    for (let b = 0; b + win <= totalBars; b += win) avgs.push(perBar.slice(b, b + win).reduce((a, c) => a + c, 0) / win);
    if (avgs.length >= 2) {
      const m = avgs.reduce((a, b) => a + b, 0) / avgs.length;
      const rel = std(avgs) / Math.max(1, m);
      if (rel < 0.12) add({ category: 'structure', severity: 'warn', message: 'The note density is almost identical in every 8-bar block: no build, no breakdown, no arc.', fix: 'Plan sections: start sparse, add layers into the chorus, strip back for a bridge, and let the last section either peak or dissolve.' });
      else if (rel > 0.3) strengths.push('The arrangement has a clear energy arc between sections.');
    }
    const vAvg = velBar.map((v, i) => (velCnt[i] ? v / velCnt[i] : 0)).filter((v) => v > 0);
    if (vAvg.length >= 8 && Math.max(...vAvg) - Math.min(...vAvg) < 6) add({ category: 'dynamics', severity: 'warn', message: 'Average velocity stays within 6 units for the whole piece.', fix: 'Write dynamics: quiet verses (vel 55-70), loud choruses (90-110), crescendo into transitions.' });
  }
  if (input.tracks.filter((t) => t.notes.length).length >= 4 && totalBars >= 8) {
    const first = input.tracks.filter((t) => t.notes.some((n) => n.t < bpb)).length;
    if (first === input.tracks.filter((t) => t.notes.length).length) add({ category: 'structure', severity: 'info', message: 'Every instrument starts in the first bar.', fix: 'Introduce layers gradually, one every two to four bars.' });
  }
  // ending
  if (totalBars >= 4 && key) {
    const lastSeg = [...chordSegs].reverse().find((s) => s.chord);
    if (lastSeg?.chord && mod12(lastSeg.chord.root) !== key.root && !(lastSeg.chord.bass !== undefined && lastSeg.chord.bass === key.root)) {
      add({ category: 'harmony', severity: 'info', message: `The piece ends on ${lastSeg.chord.symbol}, not the tonic (${key.root}).`, fix: 'Resolve to the tonic chord unless the open ending is intentional.' });
    } else if (lastSeg?.chord) strengths.push('The piece resolves to the tonic.');
  }
  // drums
  const drums = input.tracks.find((t) => role(t) === 'drums');
  if (drums && drums.notes.length > 50 && totalBars >= 16) {
    const prints: string[] = [];
    for (let b = 0; b < totalBars; b++) prints.push(fingerprint(drums.notes.filter((n) => n.p !== 42 && n.p !== 44), b * bpb, bpb));
    const distinct = new Set(prints.filter((p) => p)).size;
    if (distinct <= 2) add({ category: 'rhythm', severity: 'warn', track: drums.name, message: 'The kick/snare/tom pattern uses only one or two distinct bars across the whole piece. No fills.', fix: "Generate drums with 'fillEvery' 4 and variation 0.4+, add crashes at section starts, and thin the pattern in quiet sections." });
    else if (distinct >= Math.min(8, totalBars / 2)) strengths.push('The drum part varies from bar to bar and has fills.');
    const hats = drums.notes.filter((n) => n.p === 42);
    if (hats.length > 32 && std(hats.map((h) => h.v)) < 3) add({ category: 'humanization', severity: 'info', track: drums.name, message: 'Hi-hat velocities are almost constant.', fix: 'Accent the downbeats and soften the off-beats; add open hats before backbeats.' });
  }
  // harmonic rhythm / loop diversity
  const uniqueRoman = new Set(romanByBar.filter((r) => r !== '-')).size;
  if (totalBars >= 24 && uniqueRoman <= 4) {
    const seq = romanByBar.join(',');
    const rep = seq.length > 0 && new Set(romanByBar.reduce<string[]>((acc, _, i) => (i % 4 === 0 ? [...acc, romanByBar.slice(i, i + 4).join(',')] : acc), [])).size <= 1;
    if (rep) add({ category: 'harmony', severity: 'info', message: `The same four chords (${romanByBar.slice(0, 4).join(' ')}) repeat for the entire piece.`, fix: 'Change the harmony in the bridge, use a pre-chorus that moves differently, or alter the last chord of every second loop.' });
  }
  if (key && est && uniqueRoman >= 5) strengths.push(`Harmonic variety: ${uniqueRoman} different chord functions.`);

  const penalty = { problem: 14, warn: 7, info: 2.5 };
  const score = { harmony: 100, melody: 100, rhythm: 100, dynamics: 100, structure: 100, humanization: 100, orchestration: 100, overall: 0 } as Critique['score'];
  for (const f of findings) score[f.category] = Math.max(25, score[f.category] - penalty[f.severity]);
  const cats = ['harmony', 'melody', 'rhythm', 'dynamics', 'structure', 'humanization', 'orchestration'] as const;
  score.overall = Math.round(cats.reduce((a, c) => a + score[c], 0) / cats.length);
  for (const c of cats) score[c] = Math.round(score[c]);
  findings.sort((a, b) => ({ problem: 0, warn: 1, info: 2 })[a.severity] - { problem: 0, warn: 1, info: 2 }[b.severity]);
  return {
    score, findings, strengths,
    analysis: {
      estimatedKey: est ? `${est.key.root}/${est.key.mode}` : undefined,
      declaredKey: input.key ? `${input.key.root}/${input.key.mode}` : undefined,
      bars: totalBars, chordsByBar, romanByBar, density,
    },
  };
}

export { parseKey, makeChord, SCALES };
