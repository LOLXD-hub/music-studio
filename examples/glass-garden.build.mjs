// "Glass Garden": a wistful neo-classical piece in A minor. Felt piano opens alone, strings and a solo violin
// carry the theme, a horn and flute lift it into the climax (the only place drums play), then it falls back
// to the piano and ends on a Picardy chord. 32 bars at 72 bpm with a slowing last bar.
/** The whole piece as tool calls. `call(tool, args)` is whatever executes them: this script, or the app's demo recorder. */
export async function build(call) {

await call('studio', { action: 'new', name: 'Glass Garden', tempo: 72, key: 'A minor' });
await call('agent', {
  action: 'brief', title: 'Glass Garden', genre: 'Neo-classical / cinematic', mood: 'wistful, slowly opening, a little hopeful at the end', key: 'A minor', tempo: 72,
  form: ['Piano alone (1-8)', 'Theme on violin (9-16)', 'Climax (17-24)', 'Resolution (25-32)'],
  notes: 'One motif (E D C B / A) is stated, answered, lifted an octave and finally played low by the cello. Drums appear only in the climax. The last chord turns to A major.',
  steps: [{ text: 'Harmony and bass line', done: false }, { text: 'Piano figures per section', done: false }, { text: 'Theme: violin, violins, cello', done: false }, { text: 'Counter-lines: flute, horn, harp', done: false }, { text: 'Drums for the climax only', done: false }, { text: 'Perform, mix, check', done: false }],
});

const tick = async (i) => call('agent', { action: 'step', index: i, done: true });

// ---------------------------------------------------------------- harmony (bars)
const A1 = 'Am9:2 Fmaj7:2 Cmaj7/E:2 Dm7:1 E7sus4:0.5 E7:0.5';
const A2 = 'Am9:1 Am/G:1 Fmaj7:1 Dm7/F:1 Cmaj7:1 Em7:0.5 Gsus4:0.5 Dm9:1 E7:1';
const B = 'Dm9:1 Bbmaj7:1 E7sus4:1 E7:1 Am9:1 Fmaj7:1 Dm7:1 E7:1';
const C = 'Am9:1 Fmaj7:1 Cmaj7/E:1 Dm7:1 E7:1 Am:1 A:2';

// ---------------------------------------------------------------- tracks
const T = [
  ['Felt piano', 'piano', 'Felt / mellow', -4],
  ['Harp', 'plucked', 'Harp', -10],
  ['Cellos', 'wind_string', 'Cellos (section)', -9],
  ['Solo cello', 'wind_string', 'Cello (solo)', -6],
  ['Violin', 'wind_string', 'Violin (solo)', -6],
  ['Violins', 'wind_string', 'Violins (section)', -10],
  ['Flute', 'wind_string', 'Flute', -9],
  ['Horn', 'wind_string', 'French horn', -10],
  ['Double bass', 'wind_string', 'Double bass (solo)', -9],
  ['Drums', 'drums', 'Acoustic kit', -10],
];
for (const [n, inst, preset, vol] of T) await call('tracks', { action: 'add', name: n, instrument: inst, preset, vol });
await call('tracks', { action: 'add', name: 'Hall', kind: 'bus', vol: -3 });
await call('effects', { action: 'add', track: 'Hall', type: 'reverb', preset: 'Concert hall', params: { mix: 1, predelay: 26, highcut: 7500 } });
const sends = { 'Felt piano': -15, Harp: -11, Cellos: -12, 'Solo cello': -10, Violin: -9, Violins: -9, Flute: -9, Horn: -11, 'Double bass': -24, Drums: -17 };
for (const [t, lv] of Object.entries(sends)) await call('effects', { action: 'send', track: t, to: 'Hall', level: lv });

// stereo placement: orchestra seating
for (const [t, pan] of Object.entries({ 'Felt piano': -0.08, Harp: -0.55, Cellos: 0.3, 'Solo cello': 0.18, Violin: -0.22, Violins: -0.42, Flute: 0.1, Horn: 0.42, 'Double bass': 0.55, Drums: 0 })) await call('tracks', { action: 'update', track: t, pan });
await tick(1);

// ---------------------------------------------------------------- piano: a different figure in every section
await call('compose', { action: 'chords', track: 'Felt piano', progression: A1, start: '1:1', style: 'ballad', voices: 4, range_lo: 'A2', range_hi: 'G4', velocity: 56, seed: 3 });
await call('compose', { action: 'chords', track: 'Felt piano', progression: A2, start: '9:1', style: 'broken', voices: 4, range_lo: 'A2', range_hi: 'C5', velocity: 64, seed: 5 });
await call('compose', { action: 'chords', track: 'Felt piano', progression: B, start: '17:1', style: 'pop-piano', voices: 4, range_lo: 'C3', range_hi: 'G5', velocity: 80, seed: 8 });
await call('compose', { action: 'chords', track: 'Felt piano', progression: C, start: '25:1', style: 'ballad', voices: 4, range_lo: 'A2', range_hi: 'G4', velocity: 50, seed: 11 });
// bars 7-8: a small rising line in the right hand leads into the theme
await call('notes', { action: 'add', track: 'Felt piano', at: '7:1', text: 'r:1 A4:0.5 C5:0.5 E5:1 D5:1 r:2 B4:1 G#4:1 E5@50:2', replace: false, velocity: 60 });
await tick(2);

// ---------------------------------------------------------------- strings and bass follow the same harmony
await call('compose', { action: 'chords', track: 'Cellos', progression: 'Cmaj7/E:2 Dm7:1 E7sus4:0.5 E7:0.5', start: '5:1', style: 'sustain', voices: 3, range_lo: 'E2', range_hi: 'G4', velocity: 46, seed: 2 });
await call('compose', { action: 'chords', track: 'Cellos', progression: A2, start: '9:1', style: 'sustain', voices: 3, range_lo: 'E2', range_hi: 'G4', velocity: 58, seed: 2 });
await call('compose', { action: 'chords', track: 'Cellos', progression: B, start: '17:1', style: 'sustain', voices: 4, range_lo: 'D2', range_hi: 'A4', velocity: 82, seed: 2 });
await call('compose', { action: 'chords', track: 'Cellos', progression: C, start: '25:1', style: 'sustain', voices: 3, range_lo: 'E2', range_hi: 'G4', velocity: 44, seed: 2 });
await call('compose', { action: 'bass', track: 'Double bass', progression: A2, start: '9:1', style: 'root', range_lo: 'E1', range_hi: 'E3', velocity: 64 });
await call('compose', { action: 'bass', track: 'Double bass', progression: B, start: '17:1', style: 'half-time', range_lo: 'E1', range_hi: 'E3', velocity: 84 });
await call('compose', { action: 'bass', track: 'Double bass', progression: C, start: '25:1', style: 'root', range_lo: 'E1', range_hi: 'E3', velocity: 48 });

// ---------------------------------------------------------------- the theme, written by hand
// Bars 9-16 (solo violin): motif E D C B / A, then a rising answer that peaks on C6 in bar 13
await call('notes', {
  action: 'add', track: 'Violin', at: '9:1', velocity: 76,
  text: [
    'E5:1.5 D5:0.5 C5:1 B4:1', 'A4:2.5 C5:0.5 E5:1', 'F5:1.5 E5:0.5 C5:1 A4:1', 'D5:3 C5:1',
    'E5:1 G5@82:1 C6@92:1 B5@86:1', 'A5:1.5 G5:0.5 E5:2', 'F5:1 E5:1 D5:1 F5@84:1', 'E5@88:2.5 r:0.5 G#4@60:1',
  ].join(' '),
});
// Bars 17-24 (violins in section, an octave above and in full voice): the motif lifts
await call('notes', {
  action: 'add', track: 'Violins', at: '17:1', velocity: 88,
  text: [
    'A5:1 D6:1.5 C6:0.5 A5:1', 'Bb5:2 D6:1 F6:1', 'E6:2 D6:1 B5:1', 'G#5:3 B5:1',
    'A5:1.5 C6:0.5 E6@100:2', 'A5:1 C6:1 F6@100:2', 'F6:1.5 E6:0.5 D6:1 A5:1', 'B5@90:2 G#5@80:2',
  ].join(' '),
});
// Flute: an arpeggiated figure under the lift (17-20), then it joins the melody (21-24)
await call('notes', {
  action: 'add', track: 'Flute', at: '17:1', velocity: 70,
  text: [
    'D6:0.5 A5:0.5 F5:0.5 A5:0.5 D6:0.5 A5:0.5 F5:0.5 A5:0.5', 'Bb5:0.5 F5:0.5 D5:0.5 F5:0.5 Bb5:0.5 F5:0.5 D6:0.5 F5:0.5',
    'E6:0.5 B5:0.5 G#5:0.5 B5:0.5 E6:0.5 B5:0.5 D6:0.5 B5:0.5', 'G#5:0.5 B5:0.5 E6:0.5 B5:0.5 G#5:2',
    'A5:1.5 C6:0.5 E6:2', 'A5:1 C6:1 F6:2', 'F6:1.5 E6:0.5 D6:2', 'B5:2 G#5:2',
  ].join(' '),
});
// Horn: long held tones under the climax, shaped by expression below
await call('notes', { action: 'add', track: 'Horn', at: '17:1', velocity: 72, text: 'F4:8 E4:4 D4:4' });
await call('notes', { action: 'add', track: 'Horn', at: '21:1', velocity: 80, text: 'E4:8 D4:4 E4:4@72' });
// Harp: rising arpeggios from the climax into the resolution
await call('compose', { action: 'chords', track: 'Harp', progression: B, start: '17:1', style: 'arp-updown', voices: 4, range_lo: 'D3', range_hi: 'D6', velocity: 62, seed: 4 });
await call('compose', { action: 'chords', track: 'Harp', progression: C, start: '25:1', style: 'arp-up', voices: 4, range_lo: 'A3', range_hi: 'E6', velocity: 40, seed: 6 });
// Solo cello takes the motif low in the resolution
await call('notes', {
  action: 'add', track: 'Solo cello', at: '25:1', velocity: 62,
  text: ['E4:1.5 D4:0.5 C4:1 B3:1', 'A3:3 r:1', 'C4:1.5 B3:0.5 G3:1 E3:1', 'D4:3 C4@52:1', 'B3:3 r:1', 'E3@50:2 G#3@54:2', 'A3@56:4', 'C#4@46:4'].join(' '),
});
await tick(3);
await tick(4);

// ---------------------------------------------------------------- drums only where the piece peaks
await call('compose', { action: 'drums', track: 'Drums', style: 'half', start: '17:1', sections: [{ bars: 4, intensity: 0.5, fill_every: 4 }, { bars: 4, intensity: 0.9, ride: true, fill_every: 4 }], crash: true, variation: 0.5, seed: 9 });
await tick(5);

// ---------------------------------------------------------------- tempo, performance, mix
await call('studio', { action: 'set', tempo_map: [{ at: '31:1', bpm: 68 }, { at: '32:1', bpm: 62 }, { at: '32:3', bpm: 54 }] });
await call('compose', { action: 'mark_form', form: 'cinematic-build' });
for (const t of ['Felt piano', 'Harp', 'Cellos', 'Solo cello', 'Violin', 'Violins', 'Flute', 'Horn', 'Double bass', 'Drums']) await call('compose', { action: 'perform', track: t, amount: t === 'Drums' ? 0.8 : 1 });

// a long crescendo in the climax and a breath before it, written into expression
for (const t of ['Cellos', 'Violins', 'Horn']) {
  await call('notes', { action: 'cc', track: t, controller: 11, points: [{ at: '16:3', value: 70 }, { at: '17:1', value: 84 }, { at: '20:1', value: 104 }, { at: '23:1', value: 127 }, { at: '24:4', value: 90 }, { at: '25:1', value: 70 }] });
}

// EQ to separate the layers, glue on the master
await call('effects', { action: 'add', track: 'Cellos', type: 'eq', params: { hp: 60, b1_f: 300, b1_g: -2.5, b1_q: 1 } });
await call('effects', { action: 'add', track: 'Felt piano', type: 'eq', params: { hp: 35, b1_f: 260, b1_g: -2, b1_q: 1, hs_f: 7000, hs_g: -1.5 } });
await call('effects', { action: 'add', track: 'Violins', type: 'eq', params: { hp: 180, b2_f: 2600, b2_g: -2, b2_q: 0.9 } });
await call('effects', { action: 'add', track: 'Flute', type: 'eq', params: { hp: 260 } });
await call('effects', { action: 'add', track: 'Double bass', type: 'eq', params: { hp: 38, b2_f: 700, b2_g: 2, b2_q: 0.9 } });
await call('effects', { action: 'add', track: 'master', type: 'compressor', preset: 'Gentle glue' });
await call('effects', { action: 'add', track: 'master', type: 'limiter', params: { ceiling: -1, gain: 2.5, release: 160 } });
await tick(6);

}
