import { z, action, pos, len, track, round, PosS, TrackS, PitchS } from './toolkit.ts';
import type { Ctx, ToolDef } from './toolkit.ts';
import { PPQ } from '../engine/project.ts';
import type { Project, Track } from '../engine/project.ts';
import { getInstrumentDef } from '../engine/instruments/index.ts';
import {
  parseKey, keyName, scalePcs, scaleIntervals, SCALES, degreeToMidi, midiToName, noteToMidi, parseChord, romanToChord, chordMidi, chordPcs, identifyChord, pcName, mod12, QUALITIES,
} from '../theory/pitch.ts';
import type { Chord, Key } from '../theory/pitch.ts';
import { suggestProgressions, functionalProgression, reharmonize, PROGRESSIONS } from '../theory/progressions.ts';
import type { ChordSlot } from '../theory/progressions.ts';
import { voiceProgression, voiceChord } from '../theory/voicing.ts';
import { comp, bassLine, COMP_STYLES, BASS_STYLES } from '../theory/patterns.ts';
import { generateDrums, DRUM_STYLES, drumStyleInfo, kickPositions } from '../theory/drumpat.ts';
import { generateMelody } from '../theory/melody.ts';
import { humanize, strum, legato, phraseDynamics, voiceBalance, pedalChanges, expressionArch, graceNotes, thinCC } from '../theory/humanize.ts';
import type { TNote, CCPointB } from '../theory/humanize.ts';
import { FORMS, FORM_NAMES, planForm } from '../theory/form.ts';
import { estimateKey, segmentChords, romanOf, critique as critiqueNotes } from '../theory/critic.ts';
import type { CritTrack } from '../theory/critic.ts';
import * as ops from './ops.ts';
import { notesToText, barOfBeat } from './format.ts';
import { image } from './toolkit.ts';

interface Progression {
  slots: ChordSlot[];
  key?: Key;
  start: number;
  beats: number;
}

const ROMAN_RE = /^[b#♭♯]?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(?![a-z]*$)|^[b#♭♯]?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(?:[°øo+]|dim|maj|m7|7|9|11|13|sus|add|6|\/|$)/;

function parseProgressionTokens(input: string | string[]): string[] {
  return (Array.isArray(input) ? input : input.split(/[\s,|]+/)).map((s) => s.trim()).filter(Boolean);
}

function projectKey(ctx: Ctx, k?: string): Key | undefined {
  if (k) return parseKey(k);
  return ctx.studio.project.key;
}

/** Turn "Am:2 F:1 C G" or romans into chord slots starting at `start` beats. */
function buildProgression(ctx: Ctx, tokens: string[], key: Key | undefined, start: number, barsEach = 1): Progression {
  const p = ctx.studio.project;
  const bpb = ops.projectBeatsPerBar(p, start);
  const slots: ChordSlot[] = [];
  let beat = 0;
  for (const raw of tokens) {
    const [sym, dur] = raw.split(':');
    const bars = dur !== undefined ? parseFloat(dur) : barsEach;
    if (!Number.isFinite(bars) || bars <= 0) throw new Error(`Bad length in "${raw}". Use Am:2 for two bars.`);
    let chord: Chord;
    const isRoman = ROMAN_RE.test(sym) && !/^[A-G]/.test(sym);
    if (isRoman) {
      if (!key) throw new Error(`"${sym}" is a Roman numeral and needs a key. Pass key:"C major" or set the project key.`);
      chord = romanToChord(key, sym);
    } else chord = parseChord(sym);
    slots.push({ roman: isRoman ? sym : key ? romanOf(key, chord) : sym, chord, startBeat: beat, beats: bars * bpb });
    beat += bars * bpb;
  }
  return { slots, key, start, beats: beat };
}

function repeatToFill(prog: Progression, beats: number): Progression {
  if (!prog.slots.length || beats <= prog.beats + 1e-6) return { ...prog, slots: trimSlots(prog.slots, beats), beats };
  const out: ChordSlot[] = [];
  let beat = 0;
  while (beat < beats - 1e-6) {
    for (const s of prog.slots) {
      if (beat >= beats - 1e-6) break;
      out.push({ ...s, startBeat: beat, beats: Math.min(s.beats, beats - beat) });
      beat += s.beats;
    }
  }
  return { ...prog, slots: out, beats };
}

function trimSlots(slots: ChordSlot[], beats: number): ChordSlot[] {
  const out: ChordSlot[] = [];
  for (const s of slots) {
    if (s.startBeat >= beats - 1e-6) break;
    out.push({ ...s, beats: Math.min(s.beats, beats - s.startBeat) });
  }
  return out;
}

const slotsAt = (prog: Progression): ChordSlot[] => prog.slots.map((s) => ({ ...s, startBeat: s.startBeat + prog.start }));

const lastProg = new WeakMap<object, Progression>();

interface ProgArgs {
  progression?: string | string[];
  follow?: string;
  key?: string;
  start?: string | number;
  bars?: number;
  bars_each?: number;
}

/** Resolve a progression from explicit tokens, from the notes of another track, or from the last one used. */
function resolveProgression(ctx: Ctx, a: ProgArgs, defaultBars = 8): Progression {
  const p = ctx.studio.project;
  const key = projectKey(ctx, a.key);
  const start = a.start !== undefined ? pos(ctx, a.start) : lastProg.get(ctx.studio)?.start ?? 0;
  const bpb = ops.projectBeatsPerBar(p, start);
  let prog: Progression;
  if (a.follow) {
    const t = track(ctx, a.follow);
    const from = start;
    const notes = ops.getNotes(t, from, a.bars ? from + a.bars * bpb : undefined);
    if (!notes.length) throw new Error(`Track "${t.name}" has no notes${a.bars ? ' in that range' : ''} to follow.`);
    const end = a.bars ? from + a.bars * bpb : Math.max(...notes.map((n) => n.t + n.d));
    const segs = segmentChords(notes.map((n) => ({ ...n, t: n.t - from })), bpb, end - from);
    const slots: ChordSlot[] = [];
    for (const s of segs) {
      if (!s.chord) continue;
      const last = slots[slots.length - 1];
      if (last && last.chord.symbol === s.chord.symbol && Math.abs(last.startBeat + last.beats - s.startBeat) < 1e-6) last.beats += s.beats;
      else slots.push({ roman: key ? romanOf(key, s.chord) : s.chord.symbol, chord: s.chord, startBeat: s.startBeat, beats: s.beats });
    }
    prog = { slots, key, start, beats: end - from };
  } else if (a.progression) {
    prog = buildProgression(ctx, parseProgressionTokens(a.progression), key, start, a.bars_each ?? 1);
  } else {
    const last = lastProg.get(ctx.studio);
    if (!last) throw new Error('No progression given. Pass progression:"Am F C G" (or Roman numerals with a key), or follow:<track>.');
    prog = { ...last, start };
  }
  const bars = a.bars ?? Math.max(1, Math.round(prog.beats / bpb) || defaultBars);
  const out = repeatToFill(prog, bars * bpb);
  lastProg.set(ctx.studio, { ...out, start });
  return out;
}

const progFields = {
  progression: z.union([z.string(), z.array(z.string())]).optional().describe('Chords: symbols ("Am7 Dm7 G7 Cmaj7") or Roman numerals with a key ("i VI III VII"). "Am:2" lasts two bars. Omit to reuse the last progression.'),
  follow: TrackS.optional().describe('Take the harmony from the notes of this track instead.'),
  key: z.string().optional().describe('e.g. "A minor". Defaults to the project key.'),
  start: PosS.optional().describe('Where the part begins.'),
  bars: z.number().min(1).max(256).optional().describe('How many bars to fill; the progression repeats to fit.'),
  bars_each: z.number().min(0.25).optional().describe('Default bars per chord (1).'),
};

function range(r: [string | number, string | number] | undefined, fallback: [number, number]): [number, number] {
  return r ? [noteToMidi(r[0]), noteToMidi(r[1])] : fallback;
}

function instrumentRange(t: Track): [number, number] {
  const d = t.instrument ? getInstrumentDef(t.instrument.type) : undefined;
  return d?.range ?? [36, 96];
}

function writeNotes(ctx: Ctx, tname: string, notes: TNote[], opts: { replace?: boolean; clipName?: string } = {}): { clips: string[]; added: number } {
  let res = { clips: [] as string[], added: 0 };
  ctx.studio.mutate(`Compose on ${tname}`, (p) => {
    const t = ops.findTrack(p, tname);
    const lo = Math.min(...notes.map((n) => n.t));
    const hi = Math.max(...notes.map((n) => n.t + n.d));
    res = ops.addNotes(p, t, notes, { clipName: opts.clipName, replaceRange: opts.replace !== false ? [lo - 1e-6, hi + 1e-6] : undefined });
  });
  return res;
}

function roleOf(t: Track): CritTrack['role'] {
  const n = t.name.toLowerCase();
  const type = t.instrument?.type;
  if (type === 'drums' || /drum|perc/.test(n)) return 'drums';
  if (/bass/.test(n) || /bass/i.test(t.instrument?.preset ?? '')) return 'bass';
  if (/lead|melod|solo|violin \(solo\)|flute|trumpet|vocal|sax|oboe|clarinet/.test(n) || /\(solo\)|flute|oboe|sax|trumpet|clarinet|soprano/i.test(t.instrument?.preset ?? '')) return 'melody';
  if (/pad|string|choir|ambient|atmos/.test(n)) return 'pad';
  if (/arp|pluck|seq/.test(n)) return 'arp';
  return 'chords';
}

// ============================================================ theory
const GENRES: Record<string, { tempo: [number, number]; key: string; instruments: string[]; progressions: string[]; drums: string; bass: string; comp: string; tips: string }> = {
  pop: { tempo: [95, 125], key: 'major keys, C/G/D/A are common', instruments: ['piano or acoustic guitar for chords', 'bass guitar', 'drums', 'synth pad or strings', 'lead synth or violin for the hook'], progressions: ['I V vi IV', 'vi IV I V', 'I vi IV V'], drums: 'pop', bass: 'root-fifth', comp: 'pop-piano', tips: 'The chorus must be the highest and widest section. Keep the hook under 4 bars and repeat it with variation.' },
  rock: { tempo: [100, 150], key: 'E, A, D, G (guitar keys)', instruments: ['electric guitar crunch', 'finger or picked bass', 'rock drum kit', 'organ for fill'], progressions: ['I IV V IV', 'I bVII IV I', 'i bVII bVI bVII'], drums: 'rock', bass: 'eighths', comp: 'strum-pop', tips: 'Palm-muted verses, open chords in the chorus. Fill every 4 bars.' },
  lofi: { tempo: [65, 90], key: 'any, favour minor 7th and major 9th chords', instruments: ['felt or electric piano', 'soft bass', 'dusty drums', 'vinyl crackle (Lo-fi tape effect)'], progressions: ['Imaj9 vi9 ii9 V13', 'ii7 V7 Imaj7 vi7'], drums: 'lofi', bass: 'ballad', comp: 'ballad', tips: 'Swing the hats, lower velocity of ghost notes, keep the top note of chords stepwise, add tape wobble.' },
  jazz: { tempo: [90, 200], key: 'F, Bb, Eb, Ab (horn keys)', instruments: ['piano', 'upright bass (walking)', 'brushed or swing drums', 'saxophone or trumpet lead'], progressions: ['ii7 V7 Imaj7', 'Imaj7 vi7 ii7 V7', 'iiø7 V7b9 i7'], drums: 'jazz', bass: 'walking', comp: 'syncopated', tips: 'Walking bass with chromatic approach, rootless voicings, swing 2:1. Trade phrases between instruments.' },
  cinematic: { tempo: [60, 110], key: 'minor or modal (aeolian, dorian)', instruments: ['strings (sections)', 'french horns', 'piano', 'low brass', 'big drums or taiko-like toms', 'choir'], progressions: ['i bVI bIII bVII', 'i VII VI V', 'I bVII bVI V'], drums: 'half', bass: 'root', comp: 'sustain', tips: 'Long harmonic rhythm (2 bars per chord), build over 32+ bars, big dynamic range, silence before the climax.' },
  ambient: { tempo: [50, 90], key: 'major or Lydian, sparse notes', instruments: ['pads', 'bells or glockenspiel', 'long reverb', 'slow arps'], progressions: ['I II I vii', 'Imaj7 IVmaj7'], drums: 'none', bass: 'pedal', comp: 'sustain', tips: 'No beat needed. Layers enter every 4 bars, filter movement over 16+ bars, 6-10 second reverb.' },
  edm: { tempo: [120, 150], key: 'minor: Am, Fm, Cm', instruments: ['supersaw lead', 'sub bass', 'four-on-floor kick', 'clap', 'arp pluck', 'riser FX'], progressions: ['i VI III VII', 'vi IV I V'], drums: 'four-on-floor', bass: 'kick-lock', comp: 'pulse-16th', tips: 'Sidechain pads and bass to the kick. Build 8 bars with a riser and snare roll, drop with the hook.' },
  hiphop: { tempo: [70, 100], key: 'minor, repetitive loops', instruments: ['sampled-style keys', '808 bass', 'hip-hop drums', 'vinyl texture'], progressions: ['i VI III VII', 'i iv v i'], drums: 'hiphop', bass: '808', comp: 'ballad', tips: 'Lay the snare slightly behind. The 808 should follow the kick and slide into notes.' },
  folk: { tempo: [80, 130], key: 'G, D, C, A major', instruments: ['acoustic guitar (steel)', 'upright or picked bass', 'mandolin-like plucks', 'violin', 'light percussion'], progressions: ['I IV V I', 'I V vi IV', 'I IV I V'], drums: 'rock', bass: 'root-fifth', comp: 'strum-folk', tips: 'Arpeggiate verses, strum choruses, add a fiddle or flute counter-melody.' },
  orchestral: { tempo: [60, 120], key: 'any', instruments: ['violins, violas, cellos, basses (sections)', 'flute, oboe, clarinet', 'french horns, trumpets, trombones', 'timpani-like toms', 'harp'], progressions: ['I IV V I', 'i iv V i'], drums: 'none', bass: 'root', comp: 'sustain', tips: 'Write each section in its own range, double the melody an octave up in the climax, use pizzicato for contrast.' },
  funk: { tempo: [95, 120], key: 'E, A, D (dorian vamps)', instruments: ['clean guitar (muted)', 'slap-like picked bass', 'tight drums', 'clavinet-like fm keys', 'horn stabs'], progressions: ['i7 IV7', 'I7 IV7'], drums: 'funk', bass: 'funk', comp: 'stabs', tips: 'Everything is rhythm. Leave space. Bass locks with the kick, ghost notes on the snare.' },
  blues: { tempo: [60, 130], key: 'E, A, G, C', instruments: ['clean/crunch guitar', 'piano', 'bass', 'shuffle drums', 'harmonica-like lead'], progressions: ['I7 IV7 I7 V7 (12 bar)'], drums: 'shuffle', bass: 'walking', comp: 'syncopated', tips: 'Twelve bars, call and response. Use the blues scale over dominant chords.' },
};

const theoryTool: ToolDef = {
  name: 'theory',
  description: 'Music theory helpers: scales, chords, progressions, voicings, harmony analysis of what you wrote, genre guidance. Use these before writing notes.',
  actions: {
    scale: action({
      description: 'Notes of a scale/mode in a key, with diatonic chords and Roman numerals.',
      schema: z.object({ key: z.string().describe('e.g. "C major", "A dorian"'), octave: z.number().int().optional() }),
      run: (_c, a) => {
        const k = parseKey(a.key);
        const oct = a.octave ?? 4;
        const iv = scaleIntervals(k.mode);
        const notes = iv.map((_, i) => midiToName(degreeToMidi(k, i + 1, oct)));
        const diatonic = iv.length === 7 ? [1, 2, 3, 4, 5, 6, 7].map((d) => {
          const root = degreeToMidi(k, d, oct);
          const tri = [root, degreeToMidi(k, d + 2, oct), degreeToMidi(k, d + 4, oct)].map((m) => mod12(m));
          const id = identifyChord([root, degreeToMidi(k, d + 2, oct), degreeToMidi(k, d + 4, oct), degreeToMidi(k, d + 6, oct)]);
          return { degree: d, chord: id?.chord.symbol ?? '?', triadPitchClasses: tri.map((x) => pcName(x)) };
        }) : [];
        return { summary: `${keyName(k)}: ${notes.join(' ')}`, key: keyName(k), notes, pitchClasses: scalePcs(k).map((p) => pcName(p)), diatonicChords: diatonic, allScales: Object.keys(SCALES) };
      },
    }),
    chord: action({
      description: 'Notes of a chord symbol or a Roman numeral (needs key).',
      schema: z.object({ symbol: z.string(), key: z.string().optional(), octave: z.number().int().optional() }),
      run: (ctx, a) => {
        const k = projectKey(ctx, a.key);
        const isRoman = ROMAN_RE.test(a.symbol) && !/^[A-G]/.test(a.symbol);
        const c = isRoman ? romanToChord(k ?? (() => { throw new Error('Roman numerals need a key.'); })(), a.symbol) : parseChord(a.symbol);
        const m = chordMidi(c, a.octave ?? 3);
        return { summary: `${c.symbol}: ${m.map((x) => midiToName(x)).join(' ')}`, chord: c.symbol, midi: m, names: m.map((x) => midiToName(x)), pitchClasses: chordPcs(c).map((p) => pcName(p)) };
      },
    }),
    progression: action({
      description: 'Suggest chord progressions for a key, style and mood (and the cadence at the end). Returns options with Roman numerals, chords and why they work.',
      schema: z.object({ key: z.string().optional(), bars: z.number().int().min(1).max(64).optional(), style: z.string().optional().describe('pop, rock, jazz, lofi, cinematic, edm, folk, blues, bossa, neo-soul ...'), mood: z.string().optional().describe('dark, uplifting, melancholic, dreamy, epic, warm, tense ...'), count: z.number().int().min(1).max(6).optional(), seed: z.number().optional(), cadence: z.enum(['authentic', 'half', 'plagal', 'deceptive', 'open']).optional(), richness: z.enum(['triads', 'sevenths', 'extended']).optional() }),
      agent: 'thinking',
      run: (ctx, a) => {
        const key = projectKey(ctx, a.key);
        if (!key) throw new Error('Give a key (e.g. "A minor") or set the project key first.');
        const opts = suggestProgressions({ key, bars: a.bars ?? 8, style: a.style, mood: a.mood, count: a.count ?? 3, seed: a.seed ?? 1, cadence: a.cadence, richness: a.richness, beatsPerBar: ops.projectBeatsPerBar(ctx.studio.project) });
        return { summary: `${opts.length} progression options in ${keyName(key)}`, key: keyName(key), options: opts.map((o) => ({ name: o.name, romans: o.romans.join(' '), chords: o.chords.map((c) => `${c.chord.symbol}${c.beats !== 4 ? ':' + c.beats / ops.projectBeatsPerBar(ctx.studio.project) : ''}`).join(' '), bars: o.bars, why: o.rationale })), usage: 'Pass the "chords" string as `progression` to compose chords / bass / melody.' };
      },
    }),
    functional: action({
      description: 'Generate a goal-directed progression (tonic -> predominant -> dominant walk) with a chosen cadence. More varied than the stock loops.',
      schema: z.object({ key: z.string().optional(), bars: z.number().int().min(2).max(64), seed: z.number().optional(), chords_per_bar: z.number().min(0.5).max(4).optional(), cadence: z.enum(['authentic', 'half', 'plagal', 'deceptive', 'open']).optional(), richness: z.enum(['triads', 'sevenths', 'extended']).optional() }),
      agent: 'thinking',
      run: (ctx, a) => {
        const key = projectKey(ctx, a.key);
        if (!key) throw new Error('Give a key.');
        const o = functionalProgression(key, a.bars, a.seed ?? 1, { richness: a.richness, chordsPerBar: a.chords_per_bar, endCadence: a.cadence, beatsPerBar: ops.projectBeatsPerBar(ctx.studio.project) });
        return { summary: `${o.romans.join(' ')}`, romans: o.romans.join(' '), chords: o.chords.map((c) => c.chord.symbol).join(' ') };
      },
    }),
    reharmonize: action({
      description: 'Add colour to a progression with secondary dominants, tritone subs and ii-V approaches. Never changes the first chord.',
      schema: z.object({ progression: z.union([z.string(), z.array(z.string())]), key: z.string().optional(), level: z.number().min(0).max(1).optional(), seed: z.number().optional() }),
      run: (ctx, a) => {
        const key = projectKey(ctx, a.key);
        if (!key) throw new Error('Give a key.');
        const base = buildProgression(ctx, parseProgressionTokens(a.progression), key, 0, 1);
        const out = reharmonize(key, base.slots, a.level ?? 0.5, a.seed ?? 1);
        const bpb = ops.projectBeatsPerBar(ctx.studio.project);
        return { summary: `Reharmonized: ${out.map((s) => s.chord.symbol).join(' ')}`, chords: out.map((s) => `${s.chord.symbol}:${round(s.beats / bpb, 3)}`).join(' ') };
      },
    }),
    voicing: action({
      description: 'Voice chords with smooth voice leading in a range. Returns the notes of each chord.',
      schema: z.object({ progression: z.union([z.string(), z.array(z.string())]), key: z.string().optional(), range_lo: PitchS.optional(), range_hi: PitchS.optional(), voices: z.number().int().min(2).max(6).optional(), style: z.enum(['close', 'open', 'spread', 'shell', 'rootless']).optional() }),
      run: (ctx, a) => {
        const key = projectKey(ctx, a.key);
        const prog = buildProgression(ctx, parseProgressionTokens(a.progression), key, 0, 1);
        const v = voiceProgression(prog.slots.map((s) => s.chord), { range: [noteToMidi(a.range_lo ?? 48), noteToMidi(a.range_hi ?? 76)], voices: a.voices ?? 4, style: a.style });
        return { summary: v.map((n, i) => `${prog.slots[i].chord.symbol}: ${n.map((m) => midiToName(m)).join(' ')}`).join(' | '), voicings: v.map((n, i) => ({ chord: prog.slots[i].chord.symbol, notes: n.map((m) => midiToName(m)) })) };
      },
    }),
    analyze: action({
      description: 'Analyse what is written: estimated key, chord per bar, Roman numerals, and which notes are outside the key. Works on one track, or all pitched tracks.',
      schema: z.object({ track: TrackS.optional(), from: PosS.optional(), to: PosS.optional(), key: z.string().optional() }),
      agent: 'thinking',
      run: (ctx, a) => {
        const p = ctx.studio.project;
        const ts = a.track ? [ops.findTrack(p, a.track)] : p.tracks.filter((t) => t.kind === 'instrument' && t.instrument?.type !== 'drums');
        const from = a.from !== undefined ? pos(ctx, a.from) : 0;
        const to = a.to !== undefined ? pos(ctx, a.to) : undefined;
        const notes = ts.flatMap((t) => ops.getNotes(t, from, to));
        if (!notes.length) throw new Error('No notes to analyse.');
        const est = estimateKey(notes);
        const key = a.key ? parseKey(a.key) : p.key ?? est?.key;
        const bpb = ops.projectBeatsPerBar(p, from);
        const end = to ?? Math.max(...notes.map((n) => n.t + n.d));
        const segs = segmentChords(notes.map((n) => ({ ...n, t: n.t - from })), bpb, end - from);
        const bar0 = barOfBeat(p.sig, from).bar;
        const pcs = key ? new Set(scalePcs(key)) : null;
        const outOfKey = pcs ? notes.filter((n) => !pcs.has(mod12(n.p))).length : 0;
        return {
          summary: `Key ${key ? keyName(key) : '?'}; ${segs.filter((s) => s.chord).length} chord bars analysed.`,
          estimatedKey: est ? `${keyName(est.key)} (score ${round(est.score)})` : null, usedKey: key ? keyName(key) : null,
          chordsByBar: segs.map((s, i) => `${bar0 + i}: ${s.chord?.symbol ?? '-'}${key && s.chord ? ' (' + romanOf(key, s.chord) + ')' : ''}`),
          notesOutsideKey: outOfKey, totalNotes: notes.length,
        };
      },
    }),
    identify: action({
      description: 'Name the chord formed by some notes.',
      schema: z.object({ pitches: z.array(PitchS) }),
      run: (_c, a) => { const r = identifyChord(a.pitches.map(noteToMidi)); return { summary: r ? `${r.chord.symbol}` : 'No clear chord', chord: r?.chord.symbol ?? null, confidence: r ? round(r.score) : 0 }; },
    }),
    genre: action({
      description: 'Practical starting points for a genre: tempo range, instruments, progressions, drum and bass styles, tips.',
      schema: z.object({ genre: z.string().optional() }),
      run: (_c, a) => {
        if (!a.genre) return { summary: 'Genres', genres: Object.keys(GENRES), forms: FORM_NAMES, drumStyles: DRUM_STYLES, bassStyles: [...BASS_STYLES], compStyles: [...COMP_STYLES] };
        const g = GENRES[a.genre.toLowerCase()];
        if (!g) throw new Error(`Unknown genre. Known: ${Object.keys(GENRES).join(', ')}.`);
        return { summary: `${a.genre}: ${g.tempo[0]}-${g.tempo[1]} bpm`, ...g };
      },
    }),
    styles: action({
      description: 'Lists of drum styles (with descriptions), bass styles, chord pattern styles, forms and stock progressions.',
      schema: z.object({}),
      run: () => ({ summary: 'Styles', drumStyles: drumStyleInfo(), bassStyles: [...BASS_STYLES], compStyles: [...COMP_STYLES], forms: Object.fromEntries(FORM_NAMES.map((f) => [f, FORMS[f].description])), stockProgressions: PROGRESSIONS.map((p) => `${p.name}: ${p.numerals.join(' ')} (${p.mode})`), chordQualities: QUALITIES.map((q) => q.name) }),
    }),
  },
};

// ============================================================ compose
function pedalFor(t: Track, notes: TNote[], bpb: number, bpm: number): CCPointB[] {
  const segs = segmentChords(notes, bpb, Math.max(...notes.map((n) => n.t + n.d)) + 0.01);
  const starts: number[] = [];
  let lastSym = '';
  for (const s of segs) {
    const sym = s.chord?.symbol ?? '';
    if (sym !== lastSym) { starts.push(s.startBeat); lastSym = sym; }
  }
  void t;
  return pedalChanges(starts.length ? starts : [0], Math.max(...notes.map((n) => n.t + n.d)), bpm);
}

function performNotes(t: Track, notes: TNote[], bpm: number, bpb: number, seed: number, amount: number): { notes: TNote[]; cc: Record<number, CCPointB[]>; did: string[] } {
  const type = t.instrument?.type ?? 'piano';
  const preset = (t.instrument?.preset ?? '').toLowerCase();
  const did: string[] = [];
  const cc: Record<number, CCPointB[]> = {};
  let out = [...notes];
  const end = notes.length ? Math.max(...notes.map((n) => n.t + n.d)) : 0;
  const start = notes.length ? Math.min(...notes.map((n) => n.t)) : 0;
  const k = Math.max(0.2, amount);
  if (type === 'piano' || type === 'organ' || type === 'fm') {
    out = strum(out, { bpm, spreadMs: 11 * k, direction: 'down', seed });
    did.push('rolled chords slightly (low to high)');
    out = voiceBalance(out);
    did.push('shaped voicing: top voice up, inner voices back');
    out = humanize(out, { bpm, timing: 6 * k, drift: 8 * k, velocity: 5 * k, accent: 4, seed, beatsPerBar: bpb, coupling: 1.2 });
    did.push('human timing and velocity');
    if (type === 'piano') {
      cc[64] = pedalFor(t, notes, bpb, bpm);
      did.push('sustain pedal changes on each harmony');
    }
  } else if (type === 'wind_string') {
    const section = /section|ensemble|choir|pad|brass section/.test(preset) || /section|ensemble|choir|pad/.test(t.name.toLowerCase());
    out = legato(out, { bpm, overlapMs: section ? 45 : 28 });
    did.push('legato overlap between notes');
    out = humanize(out, { bpm, timing: (section ? 14 : 9) * k, drift: (section ? 16 : 12) * k, velocity: 6 * k, tendencyMs: 5, seed, beatsPerBar: bpb });
    did.push(`${section ? 'loose section' : 'soloist'} timing`);
    out = phraseDynamics(out, { phraseBeats: bpb * 2, depth: 8 * k });
    cc[11] = thinCC(expressionArch(start, end, bpb * (section ? 4 : 2), { low: section ? 84 : 76, high: 120 }), 2);
    did.push('expression (CC11) swells on every phrase');
    const vib: CCPointB[] = [];
    for (let b = start; b < end; b += 1) vib.push({ t: b, v: Math.round(38 + 22 * Math.sin((b - start) / (bpb * 2) * Math.PI) ** 2) });
    cc[1] = thinCC(vib, 3);
    did.push('vibrato depth (CC1) rising on long notes');
  } else if (type === 'plucked') {
    const bassy = /bass/.test(preset);
    if (!bassy) { out = strum(out, { bpm, spreadMs: 16 * k, direction: 'alt', seed }); did.push('strummed chords (alternating down/up)'); out = graceNotes(out, { probability: 0.05 * k, bpm, seed }); did.push('occasional grace notes'); }
    out = humanize(out, { bpm, timing: (bassy ? 5 : 7) * k, drift: 6 * k, velocity: 6 * k, accent: 5, seed, beatsPerBar: bpb });
    did.push('human timing and velocity');
  } else if (type === 'drums') {
    out = humanize(out, { bpm, timing: 4 * k, drift: 3 * k, velocity: 8 * k, accent: 6, seed, beatsPerBar: bpb, coupling: 0.8, keepChords: true });
    did.push('tight human timing, varied velocities');
  } else {
    out = humanize(out, { bpm, timing: 4 * k, drift: 4 * k, velocity: 5 * k, seed, beatsPerBar: bpb });
    did.push('light human timing and velocity');
  }
  return { notes: out, cc, did };
}

const composeTool: ToolDef = {
  name: 'compose',
  description: 'Generate and shape musical parts from a progression: chords, bass, drums, melody; then humanize and perform them. Everything is written as normal editable notes.',
  actions: {
    chords: action({
      description: 'Write a chord accompaniment (voice-led) with a pattern style: sustain, half, quarter, eighth, arp-up, arp-down, arp-updown, alberti, broken, ballad, waltz, syncopated, offbeat, pop-piano, strum-folk, strum-pop, pulse-16th, stabs.',
      schema: z.object({
        track: TrackS, ...progFields,
        style: z.enum(COMP_STYLES).optional(), voices: z.number().int().min(2).max(6).optional(), range_lo: PitchS.optional(), range_hi: PitchS.optional(), voicing: z.enum(['close', 'open', 'spread', 'shell', 'rootless']).optional(),
        velocity: z.number().min(1).max(127).optional(), seed: z.number().optional(), humanize: z.boolean().optional().describe('Apply gentle human timing right away.'), pedal: z.boolean().optional(),
      }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const prog = resolveProgression(ctx, a);
        const slots = slotsAt(prog);
        const bpb = ops.projectBeatsPerBar(ctx.studio.project, prog.start);
        const r = instrumentRange(t);
        const voiced = voiceProgression(slots.map((s) => s.chord), { range: range([a.range_lo ?? Math.max(r[0], 48), a.range_hi ?? Math.min(r[1], 74)], [48, 74]), voices: a.voices ?? 4, style: a.voicing });
        const vs = slots.map((s, i) => ({ startBeat: s.startBeat, beats: s.beats, voicing: voiced[i], chord: s.chord }));
        let notes = comp(vs, { style: a.style ?? 'sustain', beatsPerBar: bpb, seed: a.seed ?? 1, velocity: a.velocity ?? 74, bpm: ctx.studio.project.tempo[0].bpm });
        if (a.humanize) notes = humanize(notes, { bpm: ctx.studio.project.tempo[0].bpm, timing: 5, drift: 6, velocity: 4, seed: a.seed ?? 1, beatsPerBar: bpb });
        const res = writeNotes(ctx, t.id, notes);
        if (a.pedal) ctx.studio.mutate('Pedal', (p) => ops.setCC(p, ops.findTrack(p, t.id), 64, pedalFor(t, notes, bpb, ctx.studio.project.tempo[0].bpm).map((x) => ({ t: x.t, v: x.v }))));
        return { summary: `Wrote ${res.added} chord notes on ${t.name} (${slots.map((s) => s.chord.symbol).join(' ')}).`, chords: slots.map((s) => `${s.chord.symbol} (${s.roman})`), _tracks: [t.id] };
      },
    }),
    bass: action({
      description: 'Write a bass line that follows the progression. Styles: root, root-fifth, eighths, octaves, walking, funk, disco, reggae, bossa, 808, pedal, arp, ballad, synthwave, half-time, kick-lock.',
      schema: z.object({ track: TrackS, ...progFields, style: z.enum(BASS_STYLES).optional(), range_lo: PitchS.optional(), range_hi: PitchS.optional(), velocity: z.number().optional(), seed: z.number().optional(), kick_style: z.string().optional().describe('Drum style whose kick the bass should lock to (style kick-lock).'), humanize: z.boolean().optional() }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const prog = resolveProgression(ctx, a);
        const slots = slotsAt(prog);
        const bpb = ops.projectBeatsPerBar(ctx.studio.project, prog.start);
        const r = instrumentRange(t);
        let notes = bassLine(slots, { style: a.style ?? 'root-fifth', range: range(a.range_lo !== undefined || a.range_hi !== undefined ? [a.range_lo ?? 28, a.range_hi ?? 50] : undefined, [Math.max(r[0], 28), Math.min(Math.max(r[1], 45), 52)]), beatsPerBar: bpb, seed: a.seed ?? 2, velocity: a.velocity ?? 88, kickBeats: a.kick_style ? kickPositions(a.kick_style, bpb) : undefined, pedalPc: prog.key?.root });
        if (a.humanize) notes = humanize(notes, { bpm: ctx.studio.project.tempo[0].bpm, timing: 4, drift: 5, velocity: 5, seed: a.seed ?? 2, beatsPerBar: bpb });
        const res = writeNotes(ctx, t.id, notes);
        return { summary: `Wrote ${res.added} bass notes on ${t.name} (${a.style ?? 'root-fifth'}).`, _tracks: [t.id] };
      },
    }),
    drums: action({
      description: `Write a drum part on a drum-kit track. Styles: ${DRUM_STYLES.join(', ')}. Use \`sections\` to vary intensity over time: [{bars:4, intensity:0.3},{bars:8, intensity:0.9, ride:true}]. Every bar varies and phrases end with fills.`,
      schema: z.object({
        track: TrackS, style: z.string().optional(), start: PosS.optional(), bars: z.number().int().min(1).max(256).optional(), intensity: z.number().min(0).max(1).optional(), fill_every: z.number().int().min(0).max(16).optional(),
        variation: z.number().min(0).max(1).optional(), swing: z.number().min(0).max(0.33).optional(), crash: z.boolean().optional(), ride: z.boolean().optional(), halftime: z.boolean().optional(), seed: z.number().optional(),
        sections: z.array(z.object({ bars: z.number().int().min(1), intensity: z.number().min(0).max(1).optional(), style: z.string().optional(), ride: z.boolean().optional(), fill_every: z.number().int().optional(), halftime: z.boolean().optional() })).optional(),
      }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        if (t.instrument?.type !== 'drums') throw new Error(`"${t.name}" is not a drum-kit track. Create one with tracks add instrument:"drums".`);
        const p = ctx.studio.project;
        const start = a.start !== undefined ? pos(ctx, a.start) : 0;
        const bpb = ops.projectBeatsPerBar(p, start);
        const secs: { bars: number; intensity?: number; style?: string; ride?: boolean; fill_every?: number; halftime?: boolean }[] = a.sections ?? [{ bars: a.bars ?? 8, intensity: a.intensity, ride: a.ride, halftime: a.halftime }];
        const notes: TNote[] = [];
        let beat = start;
        secs.forEach((s, i) => {
          notes.push(...generateDrums({ style: s.style ?? a.style ?? 'rock', bars: s.bars, beatsPerBar: bpb, intensity: s.intensity ?? a.intensity ?? 0.6, seed: (a.seed ?? 4) + i * 13, fillEvery: s.fill_every ?? a.fill_every ?? 4, crashOnDownbeats: a.crash ?? true, useRide: s.ride ?? a.ride, swing: a.swing, startBeat: beat, variation: a.variation ?? 0.5, halftime: s.halftime ?? a.halftime }));
          beat += s.bars * bpb;
        });
        const res = writeNotes(ctx, t.id, notes);
        return { summary: `Wrote ${res.added} drum hits on ${t.name}, ${secs.reduce((x, s) => x + s.bars, 0)} bars of ${a.style ?? secs[0].style ?? 'rock'}.`, _tracks: [t.id] };
      },
    }),
    melody: action({
      description: 'Generate a melody from a motif developed over the chords: chord tones on strong beats, stepwise motion, phrase shape, cadence. A starting point you should edit; or write your own with notes add.',
      schema: z.object({
        track: TrackS, ...progFields, range_lo: PitchS.optional(), range_hi: PitchS.optional(), density: z.number().min(0).max(1).optional(), contour: z.enum(['arch', 'ascending', 'descending', 'wave', 'inverted-arch', 'plateau']).optional(), leap: z.number().min(0).max(1).optional(),
        phrase_bars: z.number().int().min(1).max(8).optional(), form: z.string().optional().describe('Phrase plan such as "AABA" or "ABAC".'), rests: z.number().min(0).max(0.4).optional(), cadence: z.enum(['authentic', 'half', 'open', 'none']).optional(), syncopation: z.number().min(0).max(1).optional(), seed: z.number().optional(), velocity: z.number().optional(),
      }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const prog = resolveProgression(ctx, a);
        const key = prog.key ?? projectKey(ctx, a.key);
        if (!key) throw new Error('A melody needs a key. Pass key or set the project key.');
        const bpb = ops.projectBeatsPerBar(ctx.studio.project, prog.start);
        const r = instrumentRange(t);
        const mid = Math.round((r[0] + r[1]) / 2);
        const rg: [number, number] = a.range_lo !== undefined || a.range_hi !== undefined ? [noteToMidi(a.range_lo ?? mid - 8), noteToMidi(a.range_hi ?? mid + 12)] : [Math.max(r[0], mid - 7), Math.min(r[1], mid + 12)];
        const notes = generateMelody({ key, chords: slotsAt(prog), beats: prog.beats, startBeat: prog.start, range: rg, density: a.density, contour: a.contour, leap: a.leap, seed: a.seed, phraseBeats: (a.phrase_bars ?? 2) * bpb, form: a.form, restProb: a.rests, cadence: a.cadence, beatsPerBar: bpb, velocity: a.velocity, syncopation: a.syncopation });
        const res = writeNotes(ctx, t.id, notes);
        return { summary: `Wrote a ${res.added}-note melody on ${t.name} in ${keyName(key)}.`, preview: notesToText(notes.slice(0, 24), ctx.studio.project.sig), _tracks: [t.id] };
      },
    }),
    humanize: action({
      description: 'Make a part less mechanical: timing jitter (ms), slow drift, velocity jitter, laid-back or pushed feel, accents on strong beats.',
      schema: z.object({ track: TrackS, from: PosS.optional(), to: PosS.optional(), timing_ms: z.number().min(0).max(40).optional(), drift_ms: z.number().min(0).max(40).optional(), velocity: z.number().min(0).max(30).optional(), tendency_ms: z.number().min(-30).max(30).optional().describe('Negative = ahead, positive = behind the beat.'), accent: z.number().min(0).max(30).optional(), length_var: z.number().min(0).max(1).optional(), seed: z.number().optional() }),
      mutates: true,
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const p = ctx.studio.project;
        const from = a.from !== undefined ? pos(ctx, a.from) : undefined;
        const to = a.to !== undefined ? pos(ctx, a.to) : undefined;
        const notes = ops.getNotes(t, from, to);
        if (!notes.length) throw new Error('No notes in that range.');
        const h = humanize(notes, { bpm: p.tempo[0].bpm, timing: a.timing_ms ?? 6, drift: a.drift_ms ?? 8, velocity: a.velocity ?? 6, tendencyMs: a.tendency_ms, accent: a.accent ?? 4, lengthVar: a.length_var ?? 0.05, seed: a.seed ?? 1, beatsPerBar: ops.projectBeatsPerBar(p), coupling: 1 });
        const map = new Map(notes.map((n, i) => [n.id, h[i]]));
        ctx.studio.mutate('Humanize', (pp) => { ops.mapNotes(ops.findTrack(pp, a.track), (n) => { const x = map.get(n.id); return x ? { t: x.t, d: x.d, v: x.v } : undefined; }); });
        return { summary: `Humanized ${notes.length} notes on ${t.name}.`, _tracks: [t.id] };
      },
    }),
    perform: action({
      description: 'Turn written notes into a performance for the track\'s instrument: pedal and rolled chords for piano, legato + expression + vibrato for strings and winds, strums for guitar, tight feel for drums.',
      schema: z.object({ track: TrackS, from: PosS.optional(), to: PosS.optional(), amount: z.number().min(0.2).max(2).optional().describe('1 = natural, 0.5 = tight, 1.5 = loose.'), seed: z.number().optional() }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const p = ctx.studio.project;
        const from = a.from !== undefined ? pos(ctx, a.from) : undefined;
        const to = a.to !== undefined ? pos(ctx, a.to) : undefined;
        const notes = ops.getNotes(t, from, to);
        if (!notes.length) throw new Error('No notes in that range.');
        const plain: TNote[] = notes.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.v, art: n.art }));
        const r = performNotes(t, plain, p.tempo[0].bpm, ops.projectBeatsPerBar(p), a.seed ?? 1, a.amount ?? 1);
        const lo = Math.min(...notes.map((n) => n.t));
        const hi = Math.max(...notes.map((n) => n.t + n.d));
        ctx.studio.mutate('Perform', (pp) => {
          const tt = ops.findTrack(pp, a.track);
          ops.removeNotes(tt, (n) => n.t >= lo - 1e-6 && n.t <= hi + 1e-6);
          ops.addNotes(pp, tt, r.notes);
          for (const [cc, pts] of Object.entries(r.cc)) ops.setCC(pp, tt, +cc, pts);
        });
        return { summary: `Performed ${t.name}: ${r.did.join('; ')}.`, applied: r.did, _tracks: [t.id] };
      },
    }),
    plan_form: action({
      description: `Plan the sections of a piece: ${FORM_NAMES.join(', ')}. Returns sections with bar numbers, energy 0-1, which roles play and a note on each.`,
      schema: z.object({ form: z.string(), roles: z.array(z.string()).optional().describe('Roles you will use: pad, chords, bass, drums, melody, arp, counter, fx.') }),
      agent: 'thinking',
      run: (_c, a) => {
        const sections = planForm(a.form, a.roles);
        return { summary: `${a.form}: ${sections.length} sections, ${sections.reduce((x, s) => x + s.bars, 0)} bars`, description: FORMS[a.form].description, sections: sections.map((s) => ({ name: s.name, startBar: s.startBar, bars: s.bars, energy: s.energy, layers: s.layers, note: s.note })) };
      },
    }),
    mark_form: action({
      description: 'Write the planned sections as markers on the timeline so the human sees the structure.',
      schema: z.object({ form: z.string(), start: PosS.optional() }),
      mutates: true,
      run: (ctx, a) => {
        const sections = planForm(a.form);
        const start = a.start !== undefined ? pos(ctx, a.start) : 0;
        ctx.studio.mutate('Mark form', (p) => {
          const bpb = ops.projectBeatsPerBar(p, start);
          p.markers = sections.map((s) => ({ id: ops.nextId('m'), t: ops.toTicks(start + ((s.startBar ?? 1) - 1) * bpb), name: s.name }));
        });
        return { summary: `Marked ${sections.length} sections.` };
      },
    }),
  },
};

// ============================================================ critique
const critiqueTool: ToolDef = {
  name: 'critique',
  description: 'Review the music: composition (harmony, melody, rhythm, dynamics, structure, humanization, orchestration) and the mix. Returns specific findings and how to fix each.',
  actions: {
    composition: action({
      description: 'Analyse the written notes for generic-sounding habits and real problems: repetition, flat velocity, grid-locked timing, melody against the chords, range, parallel fifths, no arc, register clashes. Each finding says what to do.',
      schema: z.object({ tracks: z.array(TrackS).optional(), from: PosS.optional(), to: PosS.optional() }),
      agent: 'thinking',
      run: (ctx, a) => {
        const p = ctx.studio.project;
        const ts: Track[] = (a.tracks?.length ? a.tracks.map((r: string) => ops.findTrack(p, r)) : p.tracks).filter((t: Track) => t.kind === 'instrument');
        const from = a.from !== undefined ? pos(ctx, a.from) : 0;
        const to = a.to !== undefined ? pos(ctx, a.to) : undefined;
        const tracks: CritTrack[] = ts.map((t) => ({ name: t.name, role: roleOf(t), instrument: t.instrument?.type, range: t.instrument ? getInstrumentDef(t.instrument.type)?.range : undefined, notes: ops.getNotes(t, from, to).map((n) => ({ t: n.t - from, d: n.d, p: n.p, v: n.v, art: n.art })) }));
        const total = (to ?? ops.projectLengthBeats(p)) - from;
        if (total <= 0 || !tracks.some((t) => t.notes.length)) throw new Error('There are no notes to critique yet.');
        const c = critiqueNotes({ bpm: p.tempo[0].bpm, beatsPerBar: ops.projectBeatsPerBar(p, from), key: p.key, tracks, totalBeats: total });
        const bar0 = barOfBeat(p.sig, from).bar - 1;
        return {
          summary: `Composition score ${c.score.overall}/100: ${c.findings.filter((f) => f.severity !== 'info').length} issues, ${c.strengths.length} strengths.`,
          score: c.score,
          findings: c.findings.map((f) => ({ severity: f.severity, category: f.category, track: f.track, bars: f.bars ? f.bars.map((b) => b + bar0) : undefined, problem: f.message, fix: f.fix })),
          strengths: c.strengths,
          harmonyByBar: c.analysis.romanByBar.map((r, i) => `${i + 1 + bar0}:${c.analysis.chordsByBar[i]}${r !== '-' ? '(' + r + ')' : ''}`).join(' '),
          notesPerBar: c.analysis.density.map((d) => d.notes).join(','),
        };
      },
    }),
    mix: action({
      description: 'Render the project and critique the mix: loudness, clipping, spectral balance, stereo, and the balance between tracks (who is too loud, who masks whom). Returns the picture too.',
      schema: z.object({ from: PosS.optional(), to: PosS.optional() }),
      agent: 'listening',
      run: async (ctx, a) => {
        const p = ctx.studio.project;
        const r = await ctx.studio.render({ startBeat: a.from !== undefined ? pos(ctx, a.from) : undefined, endBeat: a.to !== undefined ? pos(ctx, a.to) : undefined, analyze: true, picture: true, trackStats: true });
        const issues = [...(r.report?.issues ?? [])];
        const stats = r.trackStats ?? {};
        const rows = p.tracks.filter((t) => stats[t.id]).map((t) => ({ t, ...stats[t.id], role: roleOf(t) }));
        const active = rows.filter((x) => x.rmsDb > -55);
        const melody = active.filter((x) => x.role === 'melody');
        const ref = melody.length ? Math.max(...melody.map((x) => x.rmsDb)) : null;
        for (const x of active) {
          if (ref !== null && x.role === 'pad' && x.rmsDb > ref - 1) issues.push({ severity: 'warn', message: `${x.t.name} (pad) is as loud as the lead (${round(x.rmsDb, 1)} vs ${round(ref, 1)} dB RMS): it will bury the melody.`, hint: 'Lower the pad by 4-6 dB or cut 1-3 kHz on it.' });
          if (ref !== null && x.role === 'chords' && x.rmsDb > ref + 3) issues.push({ severity: 'warn', message: `${x.t.name} is ${round(x.rmsDb - ref, 1)} dB above the lead.`, hint: 'Pull the accompaniment down 3-5 dB.' });
          if (ref !== null && x.role === 'melody' && x.rmsDb < ref - 6) issues.push({ severity: 'info', message: `${x.t.name} is quiet relative to the main lead.` });
        }
        const lowTracks = active.filter((x) => x.lowShare > 0.45 && x.rmsDb > -30);
        if (lowTracks.length >= 2) issues.push({ severity: 'warn', message: `Low-end collision: ${lowTracks.map((x) => x.t.name).join(' and ')} all concentrate below 250 Hz.`, hint: 'High-pass all but one at 100-150 Hz, or sidechain the sustained one to the kick.' });
        const mids = active.filter((x) => x.midShare > 0.6 && x.role !== 'melody');
        if (mids.length >= 3) issues.push({ severity: 'info', message: `${mids.length} accompaniment tracks sit mostly in 250 Hz-2.5 kHz (${mids.map((x) => x.t.name).join(', ')}): crowded midrange.`, hint: 'Pan them apart, thin the voicings, EQ-carve each a different region.' });
        if (!p.tracks.some((t) => t.sends.length) && !p.master.inserts.some((f) => f.type === 'reverb')) issues.push({ severity: 'info', message: 'No reverb anywhere: the mix is dry and every instrument sounds like it is in a different room.', hint: 'Create a bus with a Hall or Plate reverb and send tracks to it (-12 to -18 dB).' });
        if (!p.master.inserts.some((f) => f.type === 'limiter') && (r.report?.loudness.truePeakDb ?? -99) > -1) issues.push({ severity: 'warn', message: 'Master peaks above -1 dBTP and there is no limiter.', hint: 'Add a limiter with ceiling -1 dB on the master.' });
        return {
          summary: `Mix: ${round(r.report?.loudness.integratedLufs ?? 0, 1)} LUFS, peak ${r.report?.loudness.truePeakDb} dBTP, ${issues.length} findings.`,
          loudness: r.report?.loudness, stereo: r.report?.stereo, bands: r.report?.spectrum.bands.map((b) => `${b.name}:${b.share}%`),
          tracks: active.map((x) => ({ track: x.t.name, role: x.role, rmsDb: round(x.rmsDb, 1), peakDb: round(x.peakDb, 1), low: `${Math.round(x.lowShare * 100)}%`, mid: `${Math.round(x.midShare * 100)}%`, high: `${Math.round(x.highShare * 100)}%` })),
          findings: issues,
          _images: r.picture ? [image(r.picture.png, 'Waveform and spectrogram of the mix. Bars are numbered; frequency axis is log (100, 1k, 10k labelled).')] : [],
        };
      },
    }),
  },
};

export const musicTools: ToolDef[] = [theoryTool, composeTool, critiqueTool];
export { lastProg, voiceChord, legato };
export type { Project };
