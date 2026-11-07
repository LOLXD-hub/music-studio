// "Static Bloom": 124 bpm electronic piece in A minor. A pad and a bell arp open it, the kick arrives at bar 9,
// the lead and acid bass drop at 17, a breakdown at 33 and a bigger second drop at 41. 64 bars.
import { open, finish } from './_lib.mjs';

const { studio, call, name } = open('static-bloom');

await call('studio', { action: 'new', name: 'Static Bloom', tempo: 124, key: 'A minor' });
await call('agent', {
  action: 'brief', title: 'Static Bloom', genre: 'Melodic house', mood: 'bright, forward, a little melancholy', key: 'A minor', tempo: 124,
  form: ['Intro (1-8)', 'Build (9-16)', 'Drop (17-32)', 'Break (33-40)', 'Drop 2 (41-56)', 'Outro (57-64)'],
  notes: 'Pad and bass duck under the kick. The lead only plays in the drops. The break keeps the arp and drops the drums for eight bars.',
  steps: [{ text: 'Chords, pad, arp', done: false }, { text: 'Kick, hats, clap by section', done: false }, { text: 'Acid bass + sidechain', done: false }, { text: 'Lead for both drops', done: false }, { text: 'Mix and check', done: false }],
});

const P = 'Am:1 F:1 C:1 G:1';
const T = [
  ['Kick+Drums', 'drums', '909 kit', -6, 0],
  ['Bass', 'subsynth', 'Acid bass', -11, 0],
  ['Sub', 'subsynth', 'Sub bass', -22, 0],
  ['Pad', 'subsynth', 'Warm pad', -14, 0],
  ['Chords', 'subsynth', 'Brass stab', -17, -0.2],
  ['Arp', 'subsynth', 'Bell arp', -15, 0.3],
  ['Lead', 'subsynth', 'Supersaw lead', -10, 0],
  ['Pluck', 'subsynth', 'Pluck', -16, -0.35],
];
for (const [n, inst, preset, vol, pan] of T) await call('tracks', { action: 'add', name: n, instrument: inst, preset, vol, pan });
await call('tracks', { action: 'add', name: 'Space', kind: 'bus', vol: -4 });
await call('effects', { action: 'add', track: 'Space', type: 'reverb', preset: 'Plate', params: { mix: 1 } });
await call('tracks', { action: 'add', name: 'Echo', kind: 'bus', vol: -6 });
await call('effects', { action: 'add', track: 'Echo', type: 'delay', preset: 'Dotted eighth echo', params: { mix: 1, feedback: 0.4 } });
for (const [t, lv] of Object.entries({ Pad: -9, Chords: -14, Arp: -10, Lead: -12, Pluck: -12, 'Kick+Drums': -22 })) await call('effects', { action: 'send', track: t, to: 'Space', level: lv });
for (const [t, lv] of Object.entries({ Arp: -9, Lead: -12, Pluck: -10 })) await call('effects', { action: 'send', track: t, to: 'Echo', level: lv });

const drums = 'Kick+Drums';
for (const t of ['Pad', 'Chords', 'Bass', 'Sub']) await call('effects', { action: 'add', track: t, type: 'compressor', preset: 'Sidechain pump', sidechain: drums });

// ------------------------------------------------------------ harmony: the pad runs the whole piece
const PAD = { action: 'chords', track: 'Pad', progression: P, style: 'sustain' };
await call('compose', { ...PAD, start: '1:1', bars: 16, voices: 3, range_lo: 'A2', range_hi: 'E4', velocity: 52, seed: 1 });
await call('compose', { ...PAD, start: '17:1', bars: 16, voices: 4, range_lo: 'A2', range_hi: 'E5', velocity: 66, seed: 2 });
await call('compose', { ...PAD, start: '33:1', bars: 8, voices: 3, range_lo: 'C3', range_hi: 'G4', velocity: 58, seed: 3 });
await call('compose', { ...PAD, start: '41:1', bars: 16, voices: 4, range_lo: 'C3', range_hi: 'G5', velocity: 70, seed: 4 });
await call('compose', { ...PAD, start: '57:1', bars: 6, voices: 3, range_lo: 'A2', range_hi: 'E4', velocity: 48, seed: 5 });
await call('compose', { ...PAD, progression: 'G:1 Am:1', start: '63:1', bars: 2, voices: 3, range_lo: 'A2', range_hi: 'E4', velocity: 44, seed: 5 });
await call('compose', { action: 'chords', track: 'Arp', progression: P, start: '1:1', bars: 16, style: 'arp-updown', voices: 3, range_lo: 'A4', range_hi: 'E6', velocity: 62, seed: 2 });
await call('compose', { action: 'chords', track: 'Arp', progression: P, start: '17:1', bars: 16, style: 'pulse-16th', voices: 3, range_lo: 'A4', range_hi: 'E6', velocity: 66, seed: 3 });
await call('compose', { action: 'chords', track: 'Arp', progression: P, start: '33:1', bars: 8, style: 'arp-updown', voices: 3, range_lo: 'A4', range_hi: 'E6', velocity: 70, seed: 4 });
await call('compose', { action: 'chords', track: 'Arp', progression: P, start: '41:1', bars: 16, style: 'pulse-16th', voices: 3, range_lo: 'A4', range_hi: 'E6', velocity: 68, seed: 5 });
await call('compose', { action: 'chords', track: 'Chords', progression: P, start: '17:1', bars: 16, style: 'offbeat', voices: 4, range_lo: 'A3', range_hi: 'E5', velocity: 74, seed: 7 });
await call('compose', { action: 'chords', track: 'Chords', progression: P, start: '41:1', bars: 16, style: 'stabs', voices: 4, range_lo: 'A3', range_hi: 'E5', velocity: 78, seed: 8 });

// ------------------------------------------------------------ rhythm section
await call('compose', {
  action: 'drums', track: drums, style: 'four-on-floor', start: '9:1', crash: true, variation: 0.4,
  sections: [{ bars: 4, intensity: 0.4 }, { bars: 4, intensity: 0.6, fill_every: 4 }, { bars: 16, intensity: 0.85, fill_every: 8 }],
});
await call('compose', { action: 'drums', track: drums, style: 'four-on-floor', start: '41:1', crash: true, variation: 0.4, sections: [{ bars: 16, intensity: 0.95, fill_every: 8 }] });
await call('compose', { action: 'drums', track: drums, style: 'four-on-floor', start: '57:1', crash: false, variation: 0.3, sections: [{ bars: 4, intensity: 0.5 }] });
await call('compose', { action: 'bass', track: 'Bass', progression: P, start: '9:1', bars: 8, style: 'eighths', range_lo: 'A2', range_hi: 'E4', velocity: 70, seed: 3 });
await call('compose', { action: 'bass', track: 'Bass', progression: P, start: '17:1', bars: 16, style: 'kick-lock', kick_style: 'four-on-floor', range_lo: 'A2', range_hi: 'E4', velocity: 92, seed: 4 });
await call('compose', { action: 'bass', track: 'Bass', progression: P, start: '41:1', bars: 16, style: 'kick-lock', kick_style: 'four-on-floor', range_lo: 'A2', range_hi: 'E4', velocity: 96, seed: 6 });
await call('compose', { action: 'bass', track: 'Sub', progression: P, start: '17:1', bars: 16, style: 'root', range_lo: 'A1', range_hi: 'E2', velocity: 90, seed: 4 });
await call('compose', { action: 'bass', track: 'Sub', progression: P, start: '41:1', bars: 16, style: 'root', range_lo: 'A1', range_hi: 'E2', velocity: 94, seed: 4 });

// ------------------------------------------------------------ melodies: lead in the drops, pluck answers in the break
await call('compose', { action: 'melody', track: 'Lead', progression: P, start: '17:1', bars: 16, density: 0.5, contour: 'arch', form: 'AABA', phrase_bars: 4, rests: 0.18, syncopation: 0.45, cadence: 'half', seed: 21, velocity: 92 });
await call('compose', { action: 'melody', track: 'Lead', progression: P, start: '41:1', bars: 16, density: 0.6, contour: 'ascending', form: 'AABA', phrase_bars: 4, rests: 0.15, syncopation: 0.5, cadence: 'authentic', seed: 21, velocity: 98 });
await call('compose', { action: 'melody', track: 'Pluck', progression: P, start: '33:1', bars: 8, density: 0.35, contour: 'wave', phrase_bars: 2, rests: 0.3, cadence: 'open', seed: 8, velocity: 80 });
await call('compose', { action: 'melody', track: 'Pluck', progression: P, start: '57:1', bars: 6, density: 0.3, contour: 'descending', phrase_bars: 2, rests: 0.32, cadence: 'authentic', seed: 8, velocity: 60 });

await call('notes', { action: 'add', track: 'Pluck', at: '63:1', text: 'A4:6@46', replace: false });
await call('compose', { action: 'mark_form', form: 'edm-drop' });
for (const t of ['Lead', 'Pluck', 'Arp', 'Chords', 'Pad']) await call('compose', { action: 'perform', track: t, amount: 0.5 });
for (const t of ['Sub', 'Bass']) await call('compose', { action: 'humanize', track: t, velocity: 7, timing_ms: 3, drift_ms: 2, seed: 5 });
await call('compose', { action: 'humanize', track: 'Pad', velocity: 8, timing_ms: 0, drift_ms: 0, seed: 3 });

// ------------------------------------------------------------ automation: filter opens through the build, tempo fixed
await call('automation', { action: 'set', track: 'Pad', target: 'vol', points: [{ at: '1:1', value: -28 }, { at: '9:1', value: -21 }, { at: '17:1', value: -19 }, { at: '33:1', value: -17 }, { at: '41:1', value: -20 }, { at: '63:1', value: -30 }] }).catch(() => {});

await call('effects', { action: 'add', track: 'Lead', type: 'eq', params: { hp: 220, b2_f: 3200, b2_g: -1.5, b2_q: 0.9 } });
await call('effects', { action: 'add', track: 'Bass', type: 'eq', params: { hp: 40, lp: 3800 } });
await call('effects', { action: 'add', track: 'Sub', type: 'eq', params: { hp: 46 } });
await call('effects', { action: 'add', track: drums, type: 'compressor', preset: 'Drum punch' });
await call('effects', { action: 'add', track: 'master', type: 'compressor', preset: 'Gentle glue' });
await call('effects', { action: 'add', track: 'master', type: 'limiter', preset: 'Loud master', params: { ceiling: -1.4 } });

await finish({ studio, call, name }, { lufs: -12 });
process.exit(0);
