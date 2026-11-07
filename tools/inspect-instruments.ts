// Renders a short phrase per instrument and writes spectrogram pictures so the sound design can be inspected by eye.
import fs from 'node:fs';
import path from 'node:path';
import { newProject, PPQ, uid } from '../src/engine/project.ts';
import type { Project, Track, MidiClip } from '../src/engine/project.ts';
import { renderProject } from '../src/engine/render.ts';
import { analyzeAudio, renderPicture } from '../src/engine/analysis/index.ts';
import { encodePng } from '../src/core/png.ts';
import { encodeWav } from '../src/engine/io/wav.ts';

const out = path.resolve(process.argv[2] ?? 'tmp/inspect');
fs.mkdirSync(out, { recursive: true });
const which = process.argv.slice(3);

interface Case { name: string; type: string; preset: string; notes: [number, number, number, number][]; art?: string }
const scale = (root: number, step = 1, vel = 90, dur = 0.9): [number, number, number, number][] => [0, 2, 4, 5, 7, 9, 11, 12].map((s, i) => [i * step, dur, root + s, vel]);
const cases: Case[] = [
  { name: 'piano', type: 'piano', preset: 'Concert grand', notes: [[0, 3, 36, 80], [3, 3, 48, 80], [6, 3, 60, 80], [9, 3, 72, 80], [12, 3, 84, 80], [15, 2, 60, 110]] },
  { name: 'violin', type: 'wind_string', preset: 'Violin (solo)', notes: scale(67, 1.0, 85, 1.05) },
  { name: 'cello-section', type: 'wind_string', preset: 'Cellos (section)', notes: [[0, 6, 48, 80], [0, 6, 55, 80], [0, 6, 64, 80], [6, 6, 50, 80], [6, 6, 57, 80], [6, 6, 65, 80]] },
  { name: 'trumpet', type: 'wind_string', preset: 'Trumpet', notes: scale(60, 1.0, 95, 0.95) },
  { name: 'flute', type: 'wind_string', preset: 'Flute', notes: scale(72, 1.0, 80, 0.95) },
  { name: 'guitar', type: 'plucked', preset: 'Acoustic guitar (steel)', notes: [[0, 2, 40, 90], [1, 2, 47, 85], [2, 2, 52, 85], [3, 2, 56, 85], [4, 2, 59, 85], [5, 2, 64, 90], [8, 3, 52, 100]] },
  { name: 'epiano', type: 'fm', preset: 'FM electric piano', notes: scale(60, 1.0, 85, 1.2) },
  { name: 'marimba', type: 'mallet', preset: 'Marimba', notes: scale(60, 0.5, 95, 0.5) },
  { name: 'organ', type: 'organ', preset: 'Jazz 888000000', notes: [[0, 4, 48, 90], [0, 4, 55, 90], [0, 4, 64, 90]] },
  { name: 'supersaw', type: 'subsynth', preset: 'Supersaw lead', notes: scale(60, 0.75, 95, 0.7) },
  { name: 'drums', type: 'drums', preset: 'Acoustic kit', notes: (() => { const n: [number, number, number, number][] = []; for (let b = 0; b < 4; b++) { n.push([b * 2, 0.2, 36, 105], [b * 2 + 1, 0.2, 38, 100]); for (let h = 0; h < 4; h++) n.push([b * 2 + h * 0.5, 0.1, 42, h % 2 ? 60 : 85]); } n.push([8, 0.2, 49, 100]); return n; })() },
];

for (const c of cases) {
  if (which.length && !which.includes(c.name)) continue;
  const p: Project = newProject(c.name);
  p.tempo = [{ t: 0, bpm: 60 }];
  const clip: MidiClip = { id: uid('c'), kind: 'midi', start: 0, len: 24 * PPQ, name: 'x', notes: [], cc: [] };
  for (const [t, d, pitch, v] of c.notes) clip.notes.push({ id: uid('n'), t: t * PPQ, d: d * PPQ, p: pitch, v });
  const tr: Track = { id: 't1', name: c.name, kind: 'instrument', color: '#fff', instrument: { type: c.type, preset: c.preset, params: {} }, inserts: [], sends: [], vol: 0, pan: 0, mute: false, solo: false, out: 'master', clips: [clip], auto: [] };
  p.tracks.push(tr);
  const r = renderProject(p, new Map(), { sampleRate: 44100 });
  const rep = analyzeAudio(r.L, r.R, 44100);
  const pic = renderPicture(r.L, r.R, 44100, { width: 900, fMax: 12000 });
  fs.writeFileSync(path.join(out, c.name + '.png'), encodePng(pic.image));
  fs.writeFileSync(path.join(out, c.name + '.wav'), encodeWav([r.L, r.R], 44100, 16));
  console.log(c.name.padEnd(14), `${r.durationSec.toFixed(1)}s`, `peak ${rep.loudness.samplePeakDb} dB`, `lufs ${rep.loudness.integratedLufs}`, `centroid ${rep.spectrum.centroidHz} Hz`, `stereo ${rep.stereo.widthPercent}%`);
}
