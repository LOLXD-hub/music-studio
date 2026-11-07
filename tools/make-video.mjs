// Records the app while a scripted "AI" builds Glass Garden, then muxes the real render of the climax over the playback section.
//   node tools/make-video.mjs            -> docs/media/demo.mp4
// Electron records JPEG frames with timestamps (src/app/main/main.ts, --record), FFmpeg only encodes them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { findFfmpeg } from '../src/core/audioio.ts';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electron = require('electron');
const frames = path.join(root, 'tmp', 'video-frames');
const data = path.join(root, 'tmp', 'video-data');
if (!process.env.SKIP_RECORD) {
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  fs.rmSync(data, { recursive: true, force: true });
}

const ffmpeg = findFfmpeg() ?? 'ffmpeg';

if (process.env.SKIP_RECORD) console.log('re-encoding the last recording');
else console.log('recording...');
const rec = process.env.SKIP_RECORD ? { stdout: '' } : spawnSync(electron, ['.', `--record=${frames}`, `--driver=${path.join(root, 'tools/demo/showcase.cjs')}`, '--size=1600x980', `--pace=${process.env.PACE ?? 260}`], {
  cwd: root, env: { ...process.env, MSAI_DATA: data }, encoding: 'utf8', timeout: 900_000,
});
console.log((rec.stdout || '').split('\n').filter((l) => /recorded|failed|error/i.test(l) && !/GPU|network_service|AudioContext/.test(l)).join('\n'));

const meta = JSON.parse(fs.readFileSync(path.join(frames, 'frames.json'), 'utf8'));
const marks = JSON.parse(fs.readFileSync(path.join(frames, 'marks.json'), 'utf8'));
const n = meta.stamps.length;
const list = [];
// the analysis renders take a minute of real time and show the same screen: play that stretch faster
const sq = { from: marks.buildEnd + 2500, to: marks.listened - 1500, factor: 6 };
const saved = Math.max(0, (sq.to - sq.from) * (1 - 1 / sq.factor));
for (let i = 0; i < n; i++) {
  let d = i + 1 < n ? (meta.stamps[i + 1] - meta.stamps[i]) / 1000 : 1.2;
  if (meta.stamps[i] >= sq.from && meta.stamps[i] < sq.to) d /= sq.factor;
  list.push(`file 'f${String(i).padStart(5, '0')}.jpg'`, `duration ${Math.max(0.02, d).toFixed(3)}`);
}
list.push(`file 'f${String(n - 1).padStart(5, '0')}.jpg'`);
fs.writeFileSync(path.join(frames, 'list.txt'), list.join('\n'));

const out = path.join(root, 'docs', 'media', 'demo.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
const playMs = Math.round(marks.playStart - saved);
const playSec = (marks.playEnd - marks.playStart) / 1000;
const piece = path.join(root, 'examples', 'music', 'glass-garden.mp3');
const climaxStart = 53.34; // bar 17 at 72 bpm
const args = [
  '-y', '-v', 'error',
  '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
  '-ss', String(climaxStart), '-t', playSec.toFixed(2), '-i', piece,
  '-filter_complex', `[0:v]fps=15,scale=1600:-2,format=yuv420p[v];[1:a]afade=t=in:d=0.3,afade=t=out:st=${(playSec - 1.5).toFixed(2)}:d=1.5,adelay=${playMs}|${playMs},apad[a]`,
  '-map', '[v]', '-map', '[a]', '-shortest',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
];
const enc = spawnSync(ffmpeg, args, { encoding: 'utf8' });
if (enc.status !== 0) { console.error(enc.error ?? enc.stderr); process.exit(1); }
const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log(`wrote docs/media/demo.mp4 (${mb} MB, ${n} frames, ${(meta.stamps[n - 1] / 1000).toFixed(0)} s)`);
