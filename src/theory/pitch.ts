// Pitch, scale and chord vocabulary. Pure functions, no state.

export const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** "C#4", "Bb3", "e5" -> MIDI number (C4 = 60). Also accepts plain numbers. */
export function noteToMidi(n: string | number): number {
  if (typeof n === 'number') return n;
  const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)?$/.exec(n.trim());
  if (!m) throw new Error(`Cannot read note name "${n}". Use forms like C4, F#3, Bb5.`);
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  const oct = m[3] === undefined ? 4 : parseInt(m[3], 10);
  return (oct + 1) * 12 + pc;
}

export function midiToName(m: number, flats = false): string {
  const pc = mod12(m);
  return (flats ? NAMES_FLAT : NAMES_SHARP)[pc] + (Math.floor(m / 12) - 1);
}

export function pcName(pc: number, flats = false): string {
  return (flats ? NAMES_FLAT : NAMES_SHARP)[mod12(pc)];
}

/** Pitch-class from a name like "C", "F#", "Bb". */
export function parsePc(s: string): number {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(s.trim());
  if (!m) throw new Error(`Cannot read pitch class "${s}".`);
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return mod12(pc);
}

// ---------------------------------------------------------------- scales

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  'whole tone': [0, 2, 4, 6, 8, 10],
  'diminished (whole-half)': [0, 2, 3, 5, 6, 8, 9, 11],
  'diminished (half-whole)': [0, 1, 3, 4, 6, 7, 9, 10],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  'hungarian minor': [0, 2, 3, 6, 7, 8, 11],
  'lydian dominant': [0, 2, 4, 6, 7, 9, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const SCALE_ALIASES: Record<string, string> = {
  ionian: 'major', aeolian: 'minor', 'natural minor': 'minor', min: 'minor', maj: 'major', 'harmonic': 'harmonic minor',
  'melodic': 'melodic minor', pentatonic: 'major pentatonic', 'minor blues': 'blues', 'major blues': 'major pentatonic',
};

export function scaleIntervals(mode: string): number[] {
  const k = mode.toLowerCase().trim();
  const name = SCALE_ALIASES[k] ?? k;
  const s = SCALES[name];
  if (!s) throw new Error(`Unknown scale "${mode}". Known: ${Object.keys(SCALES).join(', ')}.`);
  return s;
}

export interface Key {
  root: number;
  mode: string;
}

/** "C", "Am", "F# minor", "Bb major", "D dorian" -> Key. */
export function parseKey(s: string): Key {
  const t = s.trim();
  const m = /^([A-Ga-g][#b♯♭]*)\s*(.*)$/.exec(t);
  if (!m) throw new Error(`Cannot read key "${s}". Try "C major", "A minor", "D dorian".`);
  const root = parsePc(m[1]);
  let rest = m[2].trim().toLowerCase();
  if (rest === '' || rest === 'maj' || rest === 'major' || rest === 'ionian') return { root, mode: 'major' };
  if (rest === 'm' || rest === 'min' || rest === 'minor' || rest === 'aeolian' || rest === '-') return { root, mode: 'minor' };
  rest = rest.replace(/^m\s+/, 'minor ');
  scaleIntervals(rest); // validates
  return { root, mode: SCALE_ALIASES[rest] ?? rest };
}

export function keyName(k: Key): string {
  const flats = [1, 3, 5, 6, 8, 10].includes(k.root) && k.mode !== 'major' ? true : [5, 10, 3, 8, 1, 6].includes(k.root);
  return `${pcName(k.root, flats)} ${k.mode}`;
}

export function scalePcs(key: Key): number[] {
  return scaleIntervals(key.mode).map((i) => mod12(key.root + i));
}

/** All scale tones between lo and hi (MIDI), ascending. */
export function scaleLadder(key: Key, lo: number, hi: number): number[] {
  const pcs = new Set(scalePcs(key));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(mod12(m))) out.push(m);
  return out;
}

export function inScale(key: Key, midi: number): boolean {
  return scalePcs(key).includes(mod12(midi));
}

/** Scale degree (1-based) -> MIDI in the given octave of the tonic. degree may exceed 7 to climb octaves. */
export function degreeToMidi(key: Key, degree: number, octave = 4): number {
  const iv = scaleIntervals(key.mode);
  const n = iv.length;
  const idx = degree - 1;
  const oct = Math.floor(idx / n);
  const d = ((idx % n) + n) % n;
  return (octave + 1) * 12 + key.root + iv[d] + oct * 12;
}

export function nearestScaleTone(key: Key, midi: number): number {
  if (inScale(key, midi)) return midi;
  return inScale(key, midi - 1) ? midi - 1 : midi + 1;
}

// ---------------------------------------------------------------- chords

interface Quality {
  name: string;
  iv: number[];
  /** Symbol suffix used when printing. */
  suffix: string;
  /** Interval classes that are essential (root and third/seventh) for light voicings. */
  guide: number[];
}

export const QUALITIES: Quality[] = [
  { name: 'maj', iv: [0, 4, 7], suffix: '', guide: [4] },
  { name: 'min', iv: [0, 3, 7], suffix: 'm', guide: [3] },
  { name: 'dim', iv: [0, 3, 6], suffix: 'dim', guide: [3, 6] },
  { name: 'aug', iv: [0, 4, 8], suffix: 'aug', guide: [4, 8] },
  { name: 'sus2', iv: [0, 2, 7], suffix: 'sus2', guide: [2] },
  { name: 'sus4', iv: [0, 5, 7], suffix: 'sus4', guide: [5] },
  { name: '5', iv: [0, 7], suffix: '5', guide: [7] },
  { name: '6', iv: [0, 4, 7, 9], suffix: '6', guide: [4, 9] },
  { name: 'm6', iv: [0, 3, 7, 9], suffix: 'm6', guide: [3, 9] },
  { name: '69', iv: [0, 4, 7, 9, 14], suffix: '6/9', guide: [4, 9] },
  { name: '7', iv: [0, 4, 7, 10], suffix: '7', guide: [4, 10] },
  { name: 'maj7', iv: [0, 4, 7, 11], suffix: 'maj7', guide: [4, 11] },
  { name: 'm7', iv: [0, 3, 7, 10], suffix: 'm7', guide: [3, 10] },
  { name: 'm7b5', iv: [0, 3, 6, 10], suffix: 'm7b5', guide: [3, 6, 10] },
  { name: 'dim7', iv: [0, 3, 6, 9], suffix: 'dim7', guide: [3, 6, 9] },
  { name: 'mMaj7', iv: [0, 3, 7, 11], suffix: 'm(maj7)', guide: [3, 11] },
  { name: '7sus4', iv: [0, 5, 7, 10], suffix: '7sus4', guide: [5, 10] },
  { name: 'aug7', iv: [0, 4, 8, 10], suffix: '7#5', guide: [4, 8, 10] },
  { name: 'maj7#11', iv: [0, 4, 7, 11, 18], suffix: 'maj7#11', guide: [4, 11] },
  { name: 'add9', iv: [0, 4, 7, 14], suffix: 'add9', guide: [4] },
  { name: 'madd9', iv: [0, 3, 7, 14], suffix: 'madd9', guide: [3] },
  { name: '9', iv: [0, 4, 7, 10, 14], suffix: '9', guide: [4, 10] },
  { name: 'maj9', iv: [0, 4, 7, 11, 14], suffix: 'maj9', guide: [4, 11] },
  { name: 'm9', iv: [0, 3, 7, 10, 14], suffix: 'm9', guide: [3, 10] },
  { name: '11', iv: [0, 4, 7, 10, 14, 17], suffix: '11', guide: [4, 10] },
  { name: 'm11', iv: [0, 3, 7, 10, 14, 17], suffix: 'm11', guide: [3, 10] },
  { name: '13', iv: [0, 4, 7, 10, 14, 21], suffix: '13', guide: [4, 10] },
  { name: 'maj13', iv: [0, 4, 7, 11, 14, 21], suffix: 'maj13', guide: [4, 11] },
  { name: 'm13', iv: [0, 3, 7, 10, 14, 21], suffix: 'm13', guide: [3, 10] },
  { name: '7b9', iv: [0, 4, 7, 10, 13], suffix: '7b9', guide: [4, 10] },
  { name: '7#9', iv: [0, 4, 7, 10, 15], suffix: '7#9', guide: [4, 10] },
  { name: '7#11', iv: [0, 4, 7, 10, 18], suffix: '7#11', guide: [4, 10] },
  { name: '7b5', iv: [0, 4, 6, 10], suffix: '7b5', guide: [4, 6, 10] },
  { name: 'alt', iv: [0, 4, 6, 10, 13], suffix: '7alt', guide: [4, 10] },
];

const Q_BY_NAME = new Map(QUALITIES.map((q) => [q.name, q]));

const Q_ALIASES: Record<string, string> = {
  '': 'maj', M: 'maj', maj: 'maj', major: 'maj', m: 'min', min: 'min', '-': 'min', minor: 'min', dim: 'dim', o: 'dim', '°': 'dim',
  aug: 'aug', '+': 'aug', sus2: 'sus2', sus4: 'sus4', sus: 'sus4', '5': '5', '6': '6', m6: 'm6', min6: 'm6', '69': '69', '6/9': '69',
  '7': '7', dom7: '7', maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7', m7: 'm7', min7: 'm7', '-7': 'm7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', dim7: 'dim7', o7: 'dim7', '°7': 'dim7', mmaj7: 'mMaj7', 'm(maj7)': 'mMaj7', mM7: 'mMaj7',
  '7sus4': '7sus4', '7sus': '7sus4', '7#5': 'aug7', aug7: 'aug7', '+7': 'aug7', 'maj7#11': 'maj7#11', add9: 'add9', add2: 'add9',
  madd9: 'madd9', m9: 'm9', min9: 'm9', '9': '9', maj9: 'maj9', M9: 'maj9', '11': '11', m11: 'm11', '13': '13', maj13: 'maj13', m13: 'm13',
  '7b9': '7b9', '7#9': '7#9', '7#11': '7#11', '7b5': '7b5', '7alt': 'alt', alt: 'alt',
};

export interface Chord {
  root: number;
  quality: string;
  /** Intervals above the root (semitones, may exceed 12 for extensions). */
  iv: number[];
  bass?: number;
  symbol: string;
}

export function parseChord(sym: string): Chord {
  const s = sym.trim().replace('♯', '#').replace('♭', 'b');
  const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(s);
  if (!m) throw new Error(`Cannot read chord "${sym}". Examples: Cmaj7, Am, F#m7b5, Bb7sus4, G/B.`);
  const root = parsePc(m[1] + m[2]);
  const q = Q_ALIASES[m[3].replace(/[()\s]/g, '')] ?? Q_ALIASES[m[3]];
  if (!q) throw new Error(`Unknown chord quality "${m[3]}" in "${sym}".`);
  const bass = m[4] ? parsePc(m[4]) : undefined;
  return makeChord(root, q, bass);
}

export function makeChord(root: number, quality: string, bass?: number): Chord {
  const q = Q_BY_NAME.get(quality);
  if (!q) throw new Error(`Unknown chord quality "${quality}".`);
  const flats = [1, 3, 5, 6, 8, 10].includes(mod12(root)) && mod12(root) !== 6;
  const sym = pcName(root, flats) + q.suffix + (bass !== undefined && bass !== root ? '/' + pcName(bass, flats) : '');
  return { root: mod12(root), quality, iv: q.iv, bass, symbol: sym };
}

/** Pitch classes of the chord (bass included). */
export function chordPcs(c: Chord): number[] {
  const pcs = c.iv.map((i) => mod12(c.root + i));
  if (c.bass !== undefined && !pcs.includes(c.bass)) pcs.push(c.bass);
  return [...new Set(pcs)];
}

export function chordMidi(c: Chord, octave = 3): number[] {
  const base = (octave + 1) * 12 + c.root;
  const notes = c.iv.map((i) => base + i);
  if (c.bass !== undefined) notes.unshift((octave + 1) * 12 + c.bass - (c.bass > c.root ? 12 : 0));
  return notes;
}

export function qualityInfo(name: string): Quality | undefined {
  return Q_BY_NAME.get(name);
}

// ---------------------------------------------------------------- roman numerals

const ROMAN: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };

/**
 * Roman numeral -> chord in a key. Supports: I ii iii IV V vi vii°, accidentals (bVII, bVI, #iv°, bII for Neapolitan),
 * extensions (V7, ii7, Imaj7, vi9, IVadd9, Isus4, V7b9, viiø7), inversion slash with a roman numeral target for
 * secondary chords (V7/V, vii°7/vi), and slash-bass like I/3 (third in the bass).
 */
export function romanToChord(key: Key, rn: string): Chord {
  let s = rn.trim().replace('♭', 'b').replace('♯', '#');
  let target = key;
  const sec = /^(.+?)\/([b#]?[ivIV]+)$/.exec(s);
  let bassDeg: number | undefined;
  if (sec) {
    // either "V7/V" (secondary) or "I/3"-style handled below
    const t = sec[2];
    const tOff = secondaryRootOffset(key, t);
    target = { root: mod12(key.root + tOff), mode: /^[a-z]/.test(t.replace(/^[b#]/, '')) ? 'minor' : 'major' };
    s = sec[1];
  } else {
    const bm = /^(.+?)\/(\d)$/.exec(s);
    if (bm) {
      s = bm[1];
      bassDeg = parseInt(bm[2], 10);
    }
  }
  const m = /^([b#]*)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(s);
  if (!m) throw new Error(`Cannot read Roman numeral "${rn}". Examples: I, vi, IV, V7, ii7, bVII, V7/V, vii°7.`);
  const acc = m[1];
  const num = m[2];
  const rest = m[3];
  const upper = num === num.toUpperCase();
  const degIdx = ROMAN[num.toUpperCase()];
  const scale = target.mode === 'minor' || ['minor', 'dorian', 'phrygian', 'locrian', 'harmonic minor', 'melodic minor'].includes(target.mode)
    ? scaleIntervals(target.mode === 'major' ? 'major' : target.mode) : scaleIntervals(target.mode);
  const baseIntervals = scale.length === 7 ? scale : SCALES.major;
  let off = baseIntervals[degIdx];
  // in minor, vii° means the raised leading tone
  const dimMark = /^(°|dim|o|ø)/.test(rest);
  if (!sec && target.mode === 'minor' && degIdx === 6 && !upper && dimMark) off = 11;
  for (const a of acc) off += a === '#' ? 1 : -1;
  const root = mod12(target.root + off);
  let quality: string;
  const r = rest.replace(/^°/, 'dim').replace(/^ø/, 'm7b5');
  if (/^dim7/.test(r)) quality = 'dim7';
  else if (/^dim/.test(r)) quality = 'dim';
  else if (/^m7b5/.test(r)) quality = 'm7b5';
  else if (/^\+7|^aug7/.test(r)) quality = 'aug7';
  else if (/^\+|^aug/.test(r)) quality = 'aug';
  else {
    const ext = r.replace(/^\(|\)$/g, '');
    const table: Record<string, [string, string]> = {
      '': ['maj', 'min'], '7': ['7', 'm7'], maj7: ['maj7', 'mMaj7'], '9': ['9', 'm9'], maj9: ['maj9', 'maj9'], '6': ['6', 'm6'], '69': ['69', '69'],
      add9: ['add9', 'madd9'], '11': ['11', 'm11'], '13': ['13', 'm13'], sus4: ['sus4', 'sus4'], sus2: ['sus2', 'sus2'], '7sus4': ['7sus4', '7sus4'],
      '7b9': ['7b9', '7b9'], '7#9': ['7#9', '7#9'], '7#11': ['7#11', '7#11'], '7alt': ['alt', 'alt'], '5': ['5', '5'], m7: ['m7', 'm7'], m: ['min', 'min'],
    };
    const pair = table[ext];
    if (!pair) throw new Error(`Unknown extension "${rest}" in "${rn}".`);
    quality = upper ? pair[0] : pair[1];
    // a lowercase numeral with 'maj7' extension means minor-major seventh
    if (!upper && ext === 'maj7') quality = 'mMaj7';
  }
  let bass: number | undefined;
  if (bassDeg !== undefined) {
    const q = qualityInfo(quality)!;
    const idx = bassDeg === 3 ? 1 : bassDeg === 5 ? 2 : bassDeg === 7 ? 3 : 0;
    const iv = q.iv[idx] ?? 0;
    bass = mod12(root + iv);
  }
  return makeChord(root, quality, bass);
}

function secondaryRootOffset(key: Key, numeral: string): number {
  const acc = /^[b#]*/.exec(numeral)![0];
  const num = numeral.slice(acc.length);
  const idx = ROMAN[num.toUpperCase()];
  const sc = key.mode === 'minor' ? SCALES.minor : SCALES.major;
  let off = sc[idx];
  for (const a of acc) off += a === '#' ? 1 : -1;
  return off;
}

/** Name a set of MIDI notes as a chord, best effort. Returns null if nothing fits. */
export function identifyChord(midi: number[], weights?: number[]): { chord: Chord; score: number } | null {
  if (!midi.length) return null;
  const w = new Array(12).fill(0);
  midi.forEach((m, i) => (w[mod12(m)] += weights?.[i] ?? 1));
  const lowest = mod12(Math.min(...midi));
  let best: { chord: Chord; score: number } | null = null;
  const total = w.reduce((a, b) => a + b, 0);
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (q.name === '5' || q.name === '69' || q.name === 'alt') continue;
      const pcs = new Set(q.iv.map((i) => mod12(root + i)));
      let inside = 0;
      let outside = 0;
      for (let pc = 0; pc < 12; pc++) (pcs.has(pc) ? (inside += w[pc]) : (outside += w[pc]));
      let missing = 0;
      for (const i of q.guide) if (!w[mod12(root + i)]) missing++;
      if (!w[root] && lowest !== root) missing += 0.5;
      const size = q.iv.length;
      // 6th, add9 and similar chords are usually a relative minor or a plain triad with a passing note
      const colourPenalty = ['6', 'm6', '69', 'add9', 'madd9', 'sus2', 'sus4', '7sus4'].includes(q.name) ? 0.1 : 0;
      const score = -colourPenalty + inside / total - outside / total * 1.6 - missing * 0.25 - Math.max(0, size - 4) * 0.04 + (lowest === root ? 0.06 : 0) - (size === 4 && !midi.some((m) => !q.iv.slice(0, 3).includes(mod12(m - root))) ? 0.12 : 0);
      if (!best || score > best.score) best = { chord: makeChord(root, q.name, lowest !== root ? lowest : undefined), score };
    }
  }
  return best && best.score > 0.25 ? best : null;
}

/** Interval name between two pitch classes or midi notes (ascending, mod octave). */
export function intervalName(semis: number): string {
  const names = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];
  const a = Math.abs(semis);
  return a === 12 ? 'octave' : names[a % 12] + (a > 12 ? ' (+octave)' : '');
}
