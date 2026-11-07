import { parseKey, romanToChord, parseChord, noteToMidi, chordMidi, identifyChord, midiToName } from '../src/theory/pitch.ts';
import { suggestProgressions, functionalProgression } from '../src/theory/progressions.ts';
import { voiceProgression } from '../src/theory/voicing.ts';
import { generateMelody } from '../src/theory/melody.ts';
import { bassLine, comp } from '../src/theory/patterns.ts';
import { generateDrums } from '../src/theory/drumpat.ts';
import { critique } from '../src/theory/critic.ts';
import { humanize } from '../src/theory/humanize.ts';

let fails = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.log('FAIL', name, 'got', JSON.stringify(a), 'want', JSON.stringify(b)); }
};

eq('noteToMidi', noteToMidi('C4'), 60);
eq('noteToMidi flat', noteToMidi('Bb3'), 58);
const cm = parseKey('C minor');
eq('roman i', romanToChord(cm, 'i').symbol, 'Cm');
eq('roman VI', romanToChord(cm, 'VI').symbol, 'Ab');
eq('roman VII', romanToChord(cm, 'VII').symbol, 'Bb');
eq('roman V7', romanToChord(cm, 'V7').symbol, 'G7');
eq('roman V7/V in C', romanToChord(parseKey('C'), 'V7/V').symbol, 'D7');
eq('roman bVII', romanToChord(parseKey('C'), 'bVII').symbol, 'Bb');
eq('roman iiø7', romanToChord(parseKey('C'), 'iiø7').symbol, 'Dm7b5');
eq('roman I/3', romanToChord(parseKey('C'), 'I/3').symbol, 'C/E');
eq('parse Am7/G', parseChord('Am7/G').symbol, 'Am7/G');
eq('chordMidi Cmaj7', chordMidi(parseChord('Cmaj7'), 3), [48, 52, 55, 59]);
eq('identify', identifyChord([48, 52, 55, 59])?.chord.symbol, 'Cmaj7');
eq('identify minor', identifyChord([57, 60, 64])?.chord.symbol, 'Am');

const key = parseKey('A minor');
const opts = suggestProgressions({ key, bars: 8, style: 'cinematic', mood: 'dark', count: 2, seed: 3, cadence: 'authentic' });
console.log(opts.map((o) => `${o.name}: ${o.romans.join(' ')}  =>  ${o.chords.map((c) => c.chord.symbol).join(' ')}`).join('\n'));
const fp = functionalProgression(parseKey('D major'), 8, 5, { richness: 'sevenths', endCadence: 'authentic' });
console.log('functional:', fp.romans.join(' '), '=>', fp.chords.map((c) => c.chord.symbol).join(' '));

const chosen = opts[0];
const voiced = voiceProgression(chosen.chords.map((c) => c.chord), { range: [48, 72], voices: 4 });
console.log('voicings:', voiced.map((v) => v.map((m) => midiToName(m)).join(' ')).join(' | '));
const mel = generateMelody({ key, chords: chosen.chords, beats: 32, range: [64, 84], density: 0.5, seed: 9, cadence: 'authentic' });
console.log('melody:', mel.slice(0, 14).map((n) => `${midiToName(n.p)}@${n.t}/${n.d.toFixed(2)}`).join(' '));
const bass = bassLine(chosen.chords, { style: 'root-fifth', seed: 1 });
const drums = generateDrums({ style: 'rock', bars: 8, seed: 2, intensity: 0.7, crashOnDownbeats: true });
const slots = chosen.chords.map((c, i) => ({ startBeat: c.startBeat, beats: c.beats, voicing: voiced[i], chord: c.chord }));
const pad = comp(slots, { style: 'ballad', beatsPerBar: 4, seed: 4, velocity: 64 });
const cr = critique({
  bpm: 90, beatsPerBar: 4, key, totalBeats: 32,
  tracks: [
    { name: 'Lead', role: 'melody', instrument: 'wind_string', notes: mel },
    { name: 'Piano', role: 'chords', instrument: 'piano', notes: pad },
    { name: 'Bass', role: 'bass', instrument: 'plucked', notes: bass },
    { name: 'Drums', role: 'drums', instrument: 'drums', notes: drums },
  ],
});
console.log('critic score', JSON.stringify(cr.score));
console.log(cr.findings.map((f) => `[${f.severity}] ${f.category}${f.track ? '/' + f.track : ''}: ${f.message}`).join('\n') || '(no findings)');
console.log('strengths:', cr.strengths.join(' | '));
console.log('roman by bar:', cr.analysis.romanByBar.join(' '));
const h = humanize(pad, { bpm: 90, timing: 6, drift: 8, velocity: 5, seed: 1 });
console.log('humanized sample', h.slice(0, 3).map((n) => `${n.t.toFixed(3)} v${n.v}`).join(', '));
if (fails) { console.log(fails, 'failures'); process.exit(1); } else console.log('theory ok');
