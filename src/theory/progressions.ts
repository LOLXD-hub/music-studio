import { Rng } from '../engine/dsp/core.ts';
import { makeChord, mod12, romanToChord } from './pitch.ts';
import type { Chord, Key } from './pitch.ts';

export interface ProgTemplate {
  name: string;
  mode: 'major' | 'minor' | 'any';
  styles: string[];
  moods: string[];
  /** One roman numeral per chord; each lasts `bars` bars unless `lengths` says otherwise. */
  numerals: string[];
  lengths?: number[];
  note: string;
}

export const PROGRESSIONS: ProgTemplate[] = [
  { name: 'Pop axis', mode: 'major', styles: ['pop', 'rock', 'edm', 'singer-songwriter'], moods: ['uplifting', 'anthemic', 'emotional'], numerals: ['I', 'V', 'vi', 'IV'], note: 'Most common modern loop. Strong because each chord moves by a third or fifth; vary the bass line and rhythm to keep it from sounding generic.' },
  { name: 'Sensitive axis (vi first)', mode: 'major', styles: ['pop', 'rock', 'edm', 'cinematic'], moods: ['emotional', 'melancholic', 'nostalgic'], numerals: ['vi', 'IV', 'I', 'V'], note: 'Starts on the minor tonic-relative, so the loop feels unresolved and wistful.' },
  { name: '50s progression', mode: 'major', styles: ['pop', 'doo-wop', 'ballad'], moods: ['nostalgic', 'warm', 'romantic'], numerals: ['I', 'vi', 'IV', 'V'], note: 'Doo-wop turnaround. Warm and familiar.' },
  { name: 'Canon-like', mode: 'major', styles: ['classical', 'ballad', 'pop', 'cinematic'], moods: ['romantic', 'uplifting', 'emotional'], numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], lengths: [1, 1, 1, 1, 1, 1, 1, 1], note: 'Descending-bass sequence, eight chords. Works over 8 bars with a stepwise bass.' },
  { name: 'Plagal rock', mode: 'major', styles: ['rock', 'pop', 'folk'], moods: ['anthemic', 'warm', 'confident'], numerals: ['I', 'IV', 'V', 'IV'], note: 'Rock/folk staple; IV acts as an extended tonic neighbour.' },
  { name: 'Lift and release', mode: 'major', styles: ['pop', 'singer-songwriter', 'lofi'], moods: ['dreamy', 'hopeful', 'warm'], numerals: ['IV', 'I', 'V', 'vi'], note: 'Starts away from the tonic, which gives a floating, open feeling.' },
  { name: 'Mixolydian lift', mode: 'major', styles: ['rock', 'folk', 'indie'], moods: ['free', 'confident', 'warm'], numerals: ['I', 'bVII', 'IV', 'I'], note: 'Borrowed bVII avoids the leading-tone pull, giving a relaxed rock sound.' },
  { name: 'Minor pop', mode: 'minor', styles: ['pop', 'rock', 'edm', 'cinematic'], moods: ['dark', 'emotional', 'epic', 'tense'], numerals: ['i', 'VI', 'III', 'VII'], note: 'Natural-minor loop, the minor-key sibling of the pop axis. Epic and reliable.' },
  { name: 'Minor descent', mode: 'minor', styles: ['cinematic', 'pop', 'electronic'], moods: ['melancholic', 'dark', 'dramatic'], numerals: ['i', 'VII', 'VI', 'VII'], note: 'Rocking between VI and VII over a minor tonic; good for builds.' },
  { name: 'Andalusian cadence', mode: 'minor', styles: ['flamenco', 'cinematic', 'rock', 'latin'], moods: ['dramatic', 'passionate', 'dark'], numerals: ['i', 'VII', 'VI', 'V'], note: 'Descending tetrachord ending on a major V. Strong pull back to i.' },
  { name: 'Minor with subdominant', mode: 'minor', styles: ['pop', 'rock', 'ballad'], moods: ['sad', 'emotional', 'melancholic'], numerals: ['i', 'iv', 'VII', 'III'], note: 'Moves around the circle of fifths: i-iv-VII-III-VI-ii°-V-i fragment.' },
  { name: 'Harmonic minor cadence', mode: 'minor', styles: ['classical', 'cinematic', 'metal'], moods: ['dramatic', 'dark', 'epic'], numerals: ['i', 'VI', 'iv', 'V'], note: 'The major V (raised leading tone) gives a real dominant pull.' },
  { name: 'Lament bass', mode: 'minor', styles: ['classical', 'cinematic', 'ballad'], moods: ['sad', 'dramatic', 'melancholic'], numerals: ['i', 'v/3', 'VI', 'iv/3', 'V'], note: 'Stepwise descending bass line from tonic to dominant. The oldest sad progression.' },
  { name: 'Aeolian vamp (cinematic)', mode: 'minor', styles: ['cinematic', 'ambient', 'electronic'], moods: ['epic', 'tense', 'mysterious'], numerals: ['i', 'bVI', 'bIII', 'bVII'], lengths: [2, 2, 2, 2], note: 'Slow harmonic rhythm: two bars per chord leaves room for texture and melody.' },
  { name: 'Dorian vamp', mode: 'minor', styles: ['funk', 'jazz', 'soul', 'lofi', 'rock'], moods: ['groovy', 'cool', 'mysterious'], numerals: ['i7', 'IV7'], lengths: [2, 2], note: 'Raised sixth in IV is the Dorian signature. Hold on this two-chord groove.' },
  { name: 'Phrygian vamp', mode: 'minor', styles: ['metal', 'flamenco', 'cinematic'], moods: ['dark', 'menacing', 'tense'], numerals: ['i', 'bII'], lengths: [2, 2], note: 'The flat second is the darkest colour in the diatonic palette.' },
  { name: 'ii-V-I (jazz)', mode: 'major', styles: ['jazz', 'bossa', 'lofi', 'neo-soul'], moods: ['smooth', 'sophisticated', 'warm'], numerals: ['ii7', 'V7', 'Imaj7', 'Imaj7'], lengths: [1, 1, 2, 0], note: 'The basic jazz cadence. The seventh of each chord resolves down by step into the third of the next.' },
  { name: 'Turnaround', mode: 'major', styles: ['jazz', 'lofi', 'neo-soul'], moods: ['smooth', 'nostalgic', 'warm'], numerals: ['Imaj7', 'vi7', 'ii7', 'V7'], note: 'I-vi-ii-V turnaround; the circle of fifths in miniature.' },
  { name: 'Lofi loop', mode: 'major', styles: ['lofi', 'neo-soul', 'jazz'], moods: ['dreamy', 'nostalgic', 'chill', 'warm'], numerals: ['Imaj9', 'vi9', 'ii9', 'V13'], note: 'Extended chords, soft voice leading. Keep the top voice stepwise.' },
  { name: 'Neo-soul', mode: 'major', styles: ['neo-soul', 'lofi', 'rnb'], moods: ['smooth', 'warm', 'romantic'], numerals: ['IVmaj9', 'iii7', 'ii9', 'Imaj9'], note: 'Descending extended chords with stepwise top voice.' },
  { name: 'Minor ii-V-i', mode: 'minor', styles: ['jazz', 'bossa', 'latin'], moods: ['sophisticated', 'moody', 'smooth'], numerals: ['iiø7', 'V7b9', 'i7', 'i7'], lengths: [1, 1, 2, 0], note: 'Minor cadence. The V7b9 pulls hard into i.' },
  { name: 'Bossa cycle', mode: 'major', styles: ['bossa', 'jazz', 'latin'], moods: ['relaxed', 'warm', 'romantic'], numerals: ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'Imaj7'], lengths: [1, 1, 1, 1, 1, 1], note: 'Smooth stepwise root motion with seventh chords.' },
  { name: '12-bar blues', mode: 'major', styles: ['blues', 'rock', 'jazz', 'shuffle'], moods: ['groovy', 'earthy', 'confident'], numerals: ['I7', 'IV7', 'I7', 'V7', 'IV7', 'I7', 'V7'], lengths: [4, 2, 2, 1, 1, 1, 1], note: 'Standard twelve bars: I (4), IV (2), I (2), V (1), IV (1), I (1), V (1).' },
  { name: 'Major with borrowed minor iv', mode: 'major', styles: ['pop', 'cinematic', 'singer-songwriter'], moods: ['bittersweet', 'emotional', 'nostalgic'], numerals: ['I', 'iii', 'IV', 'iv'], note: 'The major-to-minor IV is a classic bittersweet move.' },
  { name: 'Epic major', mode: 'major', styles: ['cinematic', 'epic', 'orchestral'], moods: ['epic', 'triumphant', 'heroic'], numerals: ['I', 'bVII', 'bVI', 'V'], note: 'Borrowed bVII and bVI from the parallel minor give a heroic, widescreen sound.' },
  { name: 'Emotional rise', mode: 'major', styles: ['cinematic', 'pop', 'orchestral'], moods: ['hopeful', 'emotional', 'uplifting'], numerals: ['vi', 'V', 'IV', 'V'], note: 'Climbs back to the dominant, perfect for a pre-chorus.' },
  { name: 'Circle of fifths', mode: 'major', styles: ['jazz', 'classical', 'pop'], moods: ['smooth', 'sophisticated'], numerals: ['Imaj7', 'IVmaj7', 'viiø7', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7'], note: 'Full diatonic circle: each root drops a fifth.' },
  { name: 'EDM minor', mode: 'minor', styles: ['edm', 'electronic', 'house', 'trance'], moods: ['euphoric', 'driving', 'dark'], numerals: ['i', 'i', 'VI', 'VII'], note: 'Static tonic then lift; pairs with an arpeggio or a rolling bass.' },
  { name: 'Trance lift', mode: 'minor', styles: ['trance', 'edm', 'electronic'], moods: ['euphoric', 'emotional', 'uplifting'], numerals: ['i', 'VI', 'III', 'VII'], note: 'Same notes as the minor pop loop; voicings and an arpeggio carry the emotion.' },
  { name: 'Modal lydian', mode: 'major', styles: ['cinematic', 'ambient', 'film'], moods: ['wonder', 'dreamy', 'floating'], numerals: ['I', 'II', 'I', 'vii'], note: 'The raised fourth (II major) gives a sense of wonder.' },
];

export type CadenceType = 'authentic' | 'half' | 'plagal' | 'deceptive' | 'open';

export function cadenceNumerals(minor: boolean, type: CadenceType): string[] {
  switch (type) {
    case 'authentic': return minor ? ['iv', 'V', 'i'] : ['IV', 'V', 'I'];
    case 'half': return minor ? ['i', 'iv', 'V'] : ['I', 'ii', 'V'];
    case 'plagal': return minor ? ['i', 'iv', 'i'] : ['I', 'IV', 'I'];
    case 'deceptive': return minor ? ['iv', 'V', 'VI'] : ['ii', 'V', 'vi'];
    default: return minor ? ['VI', 'VII', 'i'] : ['IV', 'V', 'vi'];
  }
}

export interface ChordSlot {
  roman: string;
  chord: Chord;
  /** Start position in beats from the start of the progression. */
  startBeat: number;
  beats: number;
}

export interface ProgressionOption {
  name: string;
  romans: string[];
  chords: ChordSlot[];
  bars: number;
  rationale: string;
}

function slotsFrom(key: Key, romans: string[], lengths: number[], beatsPerBar: number, startBeat = 0): ChordSlot[] {
  const out: ChordSlot[] = [];
  let beat = startBeat;
  romans.forEach((rn, i) => {
    const beats = (lengths[i] ?? 1) * beatsPerBar;
    out.push({ roman: rn, chord: romanToChord(key, rn), startBeat: beat, beats });
    beat += beats;
  });
  return out;
}

function templateLengths(t: ProgTemplate): number[] {
  if (!t.lengths) return t.numerals.map(() => 1);
  return t.lengths.map((l) => l || 1);
}

export interface SuggestOptions {
  key: Key;
  bars?: number;
  style?: string;
  mood?: string;
  count?: number;
  seed?: number;
  beatsPerBar?: number;
  /** How the final phrase ends. */
  cadence?: CadenceType;
  /** 'triads' | 'sevenths' | 'extended' */
  richness?: 'triads' | 'sevenths' | 'extended';
}

function enrich(rn: string, richness: string): string {
  if (richness === 'triads') return rn;
  if (/\/\d$/.test(rn)) return rn;
  const slash = rn.indexOf('/');
  if (slash > 0) return enrich(rn.slice(0, slash), richness === 'extended' ? 'sevenths' : richness) + rn.slice(slash);
  if (/[0-9ø°]|sus|add|alt/.test(rn)) return rn;
  const lower = rn.replace(/^[b#]*/, '')[0] === rn.replace(/^[b#]*/, '')[0].toLowerCase();
  const stripped = rn.replace(/^[b#]*/, '');
  if (richness === 'sevenths') {
    if (stripped === 'V') return rn + '7';
    return lower ? rn + '7' : rn + 'maj7';
  }
  if (stripped === 'V') return rn + '9';
  return lower ? rn + '9' : rn + 'maj9';
}

/** Choose and extend progressions that fit the style and mood. Deterministic for a seed. */
export function suggestProgressions(o: SuggestOptions): ProgressionOption[] {
  const rng = new Rng(o.seed ?? 1);
  const minor = ['minor', 'dorian', 'phrygian', 'harmonic minor', 'melodic minor', 'locrian'].includes(o.key.mode);
  const bpb = o.beatsPerBar ?? 4;
  const bars = o.bars ?? 8;
  const scored = PROGRESSIONS.filter((t) => t.mode === 'any' || (minor ? t.mode === 'minor' : t.mode === 'major')).map((t) => {
    let s = rng.next() * 0.4;
    if (o.style && t.styles.includes(o.style.toLowerCase())) s += 2;
    if (o.mood && t.moods.includes(o.mood.toLowerCase())) s += 1.6;
    return { t, s };
  }).sort((a, b) => b.s - a.s);
  const out: ProgressionOption[] = [];
  for (const { t } of scored.slice(0, o.count ?? 3)) {
    let romans = t.numerals.map((r) => enrich(r, o.richness ?? 'triads'));
    let lens = templateLengths(t);
    const cycle = lens.reduce((a, b) => a + b, 0);
    // repeat to fill the requested bars; the last repetition takes the requested cadence
    const reps = Math.max(1, Math.ceil(bars / cycle));
    let rr: string[] = [];
    let ll: number[] = [];
    for (let i = 0; i < reps; i++) {
      let r = [...romans];
      let l = [...lens];
      if (i % 2 === 1 && r.length >= 3) {
        // second pass: change the last chord so the loop does not repeat verbatim (turnaround)
        const alt = minor ? ['V', 'VII', 'iv'] : ['V', 'iii', 'ii'];
        r[r.length - 1] = enrich(alt[Math.floor(rng.next() * alt.length)], o.richness ?? 'triads');
      }
      if (i === reps - 1 && o.cadence && r.length >= 2) {
        const cad = cadenceNumerals(minor, o.cadence).map((x) => enrich(x, o.richness ?? 'triads'));
        const lastBars = l[l.length - 1];
        r = [...r.slice(0, Math.max(0, r.length - 2)), ...cad.slice(-2)];
        l = [...l.slice(0, Math.max(0, l.length - 2)), 1, lastBars];
        l = l.slice(0, r.length);
      }
      rr = rr.concat(r);
      ll = ll.concat(l);
    }
    // trim to the requested bars
    let total = 0;
    const R: string[] = [];
    const Lx: number[] = [];
    for (let i = 0; i < rr.length && total < bars; i++) {
      const len = Math.min(ll[i], bars - total);
      R.push(rr[i]);
      Lx.push(len);
      total += len;
    }
    romans = R;
    lens = Lx;
    out.push({
      name: t.name,
      romans,
      chords: slotsFrom(o.key, romans, lens, bpb),
      bars: total,
      rationale: t.note + (o.cadence ? ` Ends with a ${o.cadence} cadence.` : ''),
    });
  }
  return out;
}

// ---------------------------------------------------------------- functional generator

type Fn = 'T' | 'PD' | 'D';

/** Random walk over tonic / predominant / dominant functions: more varied than a fixed loop but still goal-directed. */
export function functionalProgression(key: Key, bars: number, seed = 1, o: { richness?: 'triads' | 'sevenths' | 'extended'; chordsPerBar?: number; endCadence?: CadenceType; beatsPerBar?: number } = {}): ProgressionOption {
  const rng = new Rng(seed);
  const minor = ['minor', 'dorian', 'phrygian', 'harmonic minor', 'melodic minor', 'locrian'].includes(key.mode);
  const cpb = o.chordsPerBar ?? 1;
  const total = Math.max(1, Math.round(bars * cpb));
  const pools: Record<Fn, string[][]> = minor
    ? { T: [['i'], ['i'], ['III'], ['VI']], PD: [['iv'], ['iiø7'], ['VI'], ['iv'], ['bII']], D: [['V'], ['V'], ['VII']] }
    : { T: [['I'], ['I'], ['vi'], ['iii']], PD: [['IV'], ['ii'], ['IV'], ['ii'], ['V/V']], D: [['V'], ['V'], ['vii°']] };
  const next: Record<Fn, [Fn, number][]> = {
    T: [['PD', 0.55], ['T', 0.2], ['D', 0.25]],
    PD: [['D', 0.65], ['PD', 0.15], ['T', 0.2]],
    D: [['T', 0.8], ['PD', 0.05], ['D', 0.15]],
  };
  const romans: string[] = [];
  let fn: Fn = 'T';
  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    if (i === 0) fn = 'T';
    else {
      const r = rng.next();
      let acc = 0;
      for (const [f, p] of next[fn]) {
        acc += p;
        if (r <= acc) { fn = f; break; }
      }
    }
    if (isLast) fn = 'T';
    if (i === total - 2 && total > 3) fn = rng.chance(0.75) ? 'D' : 'PD';
    const pool = pools[fn];
    let rn = pool[Math.floor(rng.next() * pool.length)][0];
    if (rn === romans[romans.length - 1]) rn = pool[(pool.findIndex((p) => p[0] === rn) + 1) % pool.length][0];
    romans.push(rn);
  }
  if (o.endCadence) {
    const cad = cadenceNumerals(minor, o.endCadence);
    for (let i = 0; i < cad.length && i < romans.length; i++) romans[romans.length - cad.length + i] = cad[i];
  }
  const rich = romans.map((r) => enrich(r, o.richness ?? 'triads'));
  const bpb = o.beatsPerBar ?? 4;
  const beatsEach = bpb / cpb;
  const slots: ChordSlot[] = rich.map((rn, i) => ({ roman: rn, chord: romanToChord(key, rn), startBeat: i * beatsEach, beats: beatsEach }));
  return { name: 'Functional walk', romans: rich, chords: slots, bars, rationale: 'Generated by a tonic-predominant-dominant random walk with a cadence at the end.' };
}

// ---------------------------------------------------------------- reharmonisation

/** Add colour to a progression: secondary dominants, tritone substitutions, ii-V approaches. Never changes the first chord. */
export function reharmonize(key: Key, slots: ChordSlot[], level = 0.4, seed = 1): ChordSlot[] {
  const rng = new Rng(seed);
  const out: ChordSlot[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const nxt = slots[i + 1];
    out.push(s);
    if (!nxt || i === 0) continue;
    if (s.beats < 2) continue;
    if (rng.next() > level) continue;
    // approach the next chord with its dominant: shorten the current chord, add V7 of the target
    const target = nxt.chord;
    const dom = makeChord(mod12(target.root + 7), '7');
    const mode = rng.next();
    const half = s.beats / 2;
    out[out.length - 1] = { ...s, beats: half };
    if (mode < 0.35 && s.beats >= 4) {
      const tri = makeChord(mod12(target.root + 1), '7');
      out.push({ roman: 'bII7/' + nxt.roman, chord: tri, startBeat: s.startBeat + half, beats: half });
    } else if (mode < 0.7 && s.beats >= 4) {
      const ii = makeChord(mod12(dom.root + 7), '7' === '7' ? 'm7' : 'min');
      out[out.length - 1] = { ...s, beats: half / 2 };
      out.push({ roman: 'ii/' + nxt.roman, chord: ii, startBeat: s.startBeat + half / 2, beats: half / 2 });
      out.push({ roman: 'V7/' + nxt.roman, chord: dom, startBeat: s.startBeat + half, beats: half });
    } else {
      out.push({ roman: 'V7/' + nxt.roman, chord: dom, startBeat: s.startBeat + half, beats: half });
    }
  }
  // recompute start beats
  let beat = slots[0]?.startBeat ?? 0;
  for (const s of out) {
    s.startBeat = beat;
    beat += s.beats;
  }
  void key;
  return out;
}
