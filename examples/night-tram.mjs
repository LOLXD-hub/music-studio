// "Night Tram": slow lo-fi jazz in D minor at 76 bpm. Electric piano and finger bass lay the bed, a vibraphone
// and a nylon guitar trade the tune, drums drop out for a four-bar break and return. 32 bars.
import { open, finish } from './_lib.mjs';

const { studio, call, name } = open('night-tram');

await call('studio', { action: 'new', name: 'Night Tram', tempo: 76, key: 'D minor' });
await call('agent', {
  action: 'brief', title: 'Night Tram', genre: 'Lo-fi jazz', mood: 'late, tired, warm', key: 'D minor', tempo: 76,
  form: ['Bed (1-4)', 'Tune A (5-12)', 'Tune B (13-20)', 'Break (21-24)', 'Return (25-30)', 'Fade (31-32)'],
  notes: 'Drums sit behind the beat with swing. Electric piano is dusty, vibraphone leads, guitar answers in the gaps. The break strips everything but the piano.',
  steps: [{ text: 'Chords + bass', done: false }, { text: 'Tune on vibraphone', done: false }, { text: 'Guitar answers', done: false }, { text: 'Drums with swing, break at 21', done: false }, { text: 'Humanize, mix, check', done: false }],
});

const P = 'Dm9:1 G7:1 Cmaj7:1 Fmaj7:1 Bbmaj7:1 A7:1 Dm9:1 A7:1';
const tracks = [
  ['E-piano', 'fm', 'FM electric piano', -8, -0.2],
  ['Bass', 'plucked', 'Finger bass', -7, 0],
  ['Vibes', 'mallet', 'Vibraphone', -8, 0.25],
  ['Guitar', 'plucked', 'Nylon guitar', -11, -0.45],
  ['Pad', 'subsynth', 'Warm pad', -20, 0.1],
  ['Drums', 'drums', 'Lo-fi kit', -9, 0],
];
for (const [n, inst, preset, vol, pan] of tracks) await call('tracks', { action: 'add', name: n, instrument: inst, preset, vol, pan });
await call('tracks', { action: 'add', name: 'Room', kind: 'bus', vol: -3 });
await call('effects', { action: 'add', track: 'Room', type: 'reverb', preset: 'Studio room', params: { mix: 1 } });
for (const [t, lv] of Object.entries({ 'E-piano': -14, Vibes: -9, Guitar: -11, Pad: -8, Drums: -18 })) await call('effects', { action: 'send', track: t, to: 'Room', level: lv });
await call('effects', { action: 'add', track: 'E-piano', type: 'lofi', preset: 'Subtle warmth' });
await call('effects', { action: 'add', track: 'E-piano', type: 'chorus', preset: 'Subtle widen' });
await call('effects', { action: 'add', track: 'Vibes', type: 'delay', preset: 'Dotted eighth echo', params: { mix: 0.14 } });
await call('effects', { action: 'add', track: 'Drums', type: 'lofi', preset: 'Dusty tape' });

// ------------------------------------------------------------ bed
const EP = { track: 'E-piano', progression: P, voices: 4, range_lo: 'F3', range_hi: 'A5' };
await call('compose', { action: 'chords', ...EP, start: '1:1', bars: 4, style: 'half', velocity: 54, seed: 2 });
await call('compose', { action: 'chords', ...EP, start: '5:1', bars: 16, style: 'syncopated', velocity: 68, seed: 2 });
await call('compose', { action: 'chords', ...EP, start: '21:1', bars: 4, style: 'sustain', velocity: 46, seed: 2 });
await call('compose', { action: 'chords', ...EP, start: '25:1', bars: 6, style: 'syncopated', velocity: 64, seed: 4 });
await call('compose', { action: 'chords', ...EP, progression: 'A7:1 Dm9:1', start: '31:1', bars: 2, style: 'sustain', velocity: 50, seed: 2 });
await call('compose', { action: 'bass', track: 'Bass', progression: P, start: '3:1', bars: 18, style: 'ballad', range_lo: 'E1', range_hi: 'G3', velocity: 78, seed: 5 });
await call('compose', { action: 'bass', track: 'Bass', progression: P, start: '25:1', bars: 6, style: 'ballad', range_lo: 'E1', range_hi: 'G3', velocity: 74, seed: 7 });
await call('compose', { action: 'bass', track: 'Bass', progression: 'A7:1 Dm9:1', start: '31:1', bars: 2, style: 'root', range_lo: 'E1', range_hi: 'G3', velocity: 56, seed: 7 });
await call('compose', { action: 'chords', track: 'Pad', progression: P, start: '13:1', bars: 8, style: 'sustain', voices: 3, range_lo: 'D3', range_hi: 'A4', velocity: 46, seed: 1 });

// ------------------------------------------------------------ the tune
await call('compose', { action: 'melody', track: 'Vibes', progression: P, start: '5:1', bars: 8, density: 0.5, contour: 'arch', form: 'AB', phrase_bars: 2, rests: 0.22, syncopation: 0.35, cadence: 'half', seed: 14, velocity: 78 });
await call('compose', { action: 'melody', track: 'Vibes', progression: P, start: '13:1', bars: 8, density: 0.55, contour: 'wave', form: 'ABAC', phrase_bars: 2, rests: 0.2, syncopation: 0.4, cadence: 'open', seed: 31, velocity: 82 });
await call('compose', { action: 'melody', track: 'Vibes', progression: P, start: '25:1', bars: 6, density: 0.4, contour: 'descending', phrase_bars: 2, rests: 0.25, cadence: 'authentic', seed: 14, velocity: 70 });
await call('notes', { action: 'add', track: 'Vibes', at: '32:1', text: 'D5:3.5@52', replace: false });
// guitar answers in the second half of every phrase
await call('compose', { action: 'chords', track: 'Guitar', progression: P, start: '9:1', bars: 4, style: 'arp-up', voices: 3, range_lo: 'D3', range_hi: 'D5', velocity: 58, seed: 3 });
await call('compose', { action: 'chords', track: 'Guitar', progression: P, start: '17:1', bars: 4, style: 'broken', voices: 4, range_lo: 'D3', range_hi: 'E5', velocity: 62, seed: 6 });
await call('compose', { action: 'chords', track: 'Guitar', progression: P, start: '25:1', bars: 4, style: 'arp-updown', voices: 3, range_lo: 'D3', range_hi: 'D5', velocity: 54, seed: 9 });

// ------------------------------------------------------------ drums: swing, break at bar 21, soft return
await call('compose', { action: 'drums', track: 'Drums', style: 'lofi', start: '1:1', swing: 0.2, crash: false, variation: 0.6, sections: [{ bars: 4, intensity: 0.3 }, { bars: 8, intensity: 0.5, fill_every: 4 }, { bars: 8, intensity: 0.65, fill_every: 4 }] });
await call('compose', { action: 'drums', track: 'Drums', style: 'lofi', start: '25:1', swing: 0.2, crash: false, variation: 0.6, sections: [{ bars: 6, intensity: 0.45, fill_every: 4 }] });

// slow down the last bar
await call('studio', { action: 'set', tempo_map: [{ at: '31:1', bpm: 70 }, { at: '32:2', bpm: 60 }] });
for (const t of ['E-piano', 'Bass', 'Vibes', 'Guitar', 'Pad', 'Drums']) await call('compose', { action: 'perform', track: t, amount: t === 'Drums' ? 1 : 0.9 });
await call('compose', { action: 'mark_form', form: 'lofi-loop' });

await call('effects', { action: 'add', track: 'E-piano', type: 'eq', params: { hp: 110, b1_f: 330, b1_g: -3.5, b1_q: 0.9, hs_f: 6500, hs_g: -3 } });
await call('effects', { action: 'add', track: 'Bass', type: 'eq', params: { hp: 38, b1_f: 350, b1_g: -2.5, b1_q: 0.9 } });
await call('effects', { action: 'add', track: 'Guitar', type: 'eq', params: { hp: 140, b1_f: 320, b1_g: -3, b1_q: 0.9 } });
await call('effects', { action: 'add', track: 'Drums', type: 'compressor', preset: 'Drum punch' });
await call('effects', { action: 'add', track: 'master', type: 'compressor', preset: 'Gentle glue' });
await call('effects', { action: 'add', track: 'master', type: 'limiter', preset: 'Transparent' });

await finish({ studio, call, name }, { lufs: -15 });
process.exit(0);
