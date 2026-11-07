// End-to-end engine test: build a small project by hand, render it offline, write WAV + spectrogram, print the report.
import fs from 'node:fs';
import { newProject, PPQ, uid } from '../src/engine/project.ts';
import type { Project, Track, MidiClip } from '../src/engine/project.ts';
import { renderProject } from '../src/engine/render.ts';
import { encodeWav } from '../src/engine/io/wav.ts';
import { analyzeAudio, renderPicture } from '../src/engine/analysis/index.ts';
import { encodePng } from '../src/core/png.ts';

const out = new URL('../tmp/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(out, { recursive: true });

const p: Project = newProject('engine test');
p.tempo = [{ t: 0, bpm: 84 }];
const beat = PPQ;
const bar = 4 * beat;

function track(name: string, type: string, preset: string, extra: Partial<Track> = {}): Track {
  const t: Track = {
    id: uid('t'), name, kind: 'instrument', color: '#fff', instrument: { type, preset, params: {} }, inserts: [], sends: [],
    vol: -3, pan: 0, mute: false, solo: false, out: 'master', clips: [], auto: [], ...extra,
  };
  p.tracks.push(t);
  return t;
}
function clip(t: Track, startBar: number, bars: number, notes: [number, number, number, number][]): void {
  const c: MidiClip = { id: uid('c'), kind: 'midi', start: (startBar - 1) * bar, len: bars * bar, name: 'x', notes: [], cc: [] };
  for (const [tb, d, pitch, vel] of notes) c.notes.push({ id: uid('n'), t: tb * beat, d: d * beat, p: pitch, v: vel });
  t.clips.push(c);
}

const rev = track('Reverb', 'piano', '', { kind: 'bus', instrument: undefined });
rev.inserts.push({ id: 'rv', type: 'reverb', params: { size: 1.2, decay: 2.4, mix: 1, predelay: 18 } });
rev.vol = -6;

const piano = track('Piano', 'piano', 'Concert grand', { sends: [{ to: rev.id, level: -12 }] });
const strings = track('Cellos', 'wind_string', 'Cellos (section)', { sends: [{ to: rev.id, level: -9 }], vol: -8 });
const bass = track('Bass', 'plucked', 'Finger bass');
const drums = track('Drums', 'drums', 'Acoustic kit', { vol: -6 });
const lead = track('Violin', 'wind_string', 'Violin (solo)', { sends: [{ to: rev.id, level: -8 }], vol: -6 });

// C minor: Cm  Ab  Eb  Bb
const chords: number[][] = [[48, 55, 60, 63, 67], [44, 51, 60, 63, 68], [51, 58, 62, 67, 70], [46, 53, 62, 65, 70]];
chords.forEach((c, i) => {
  clip(piano, 1 + i, 1, c.flatMap((n, k) => [[0 + k * 0.03, 3.8, n, 78 - k * 3] as [number, number, number, number]]));
  clip(strings, 1 + i, 1, [[0, 4, c[1] - 12 + 12, 70], [0, 4, c[2], 66], [0, 4, c[3], 64]]);
  clip(bass, 1 + i, 1, [[0, 1.5, c[0] - 12, 92], [2, 1, c[0] - 12, 80], [3, 0.8, c[0] - 5, 76]]);
});
clip(lead, 2, 3, [[0, 1.5, 72, 80], [1.5, 0.5, 70, 70], [2, 2, 67, 76], [4, 1, 68, 72], [5, 1, 72, 84], [6, 2, 75, 88], [8, 4, 74, 82]]);
const dn: [number, number, number, number][] = [];
for (let b = 0; b < 4; b++) {
  const o = b * 4;
  dn.push([o, 0.2, 36, 100], [o + 2, 0.2, 38, 96], [o + 3.5, 0.2, 36, 70]);
  for (let h = 0; h < 8; h++) dn.push([o + h * 0.5, 0.2, 42, h % 2 ? 62 : 84]);
}
clip(drums, 1, 4, dn);

p.master.inserts.push({ id: 'lim', type: 'limiter', params: { ceiling: -1, gain: 2 } });

const res = renderProject(p, new Map(), { sampleRate: 44100 });
console.log(`rendered ${res.durationSec.toFixed(2)} s in ${res.renderMs} ms (${(res.durationSec / (res.renderMs / 1000)).toFixed(1)}x realtime), tail ${res.tailSec.toFixed(2)} s`);
fs.writeFileSync(out + 'engine-test.wav', encodeWav([res.L, res.R], res.sampleRate, 16));
const rep = analyzeAudio(res.L, res.R, res.sampleRate, { projectBpm: 84 });
console.log(JSON.stringify({ loudness: rep.loudness, stereo: rep.stereo, spectrum: { ...rep.spectrum, bands: rep.spectrum.bands.map((b) => `${b.name}:${b.share}%`) }, music: rep.music, descriptors: rep.descriptors, issues: rep.issues }, null, 1));
const barTimes = [0, 1, 2, 3, 4, 5].map((i) => (i * 4 * 60) / 84);
const pic = renderPicture(res.L, res.R, res.sampleRate, { barTimes });
fs.writeFileSync(out + 'engine-test.png', encodePng(pic.image));
console.log('wrote', out);
