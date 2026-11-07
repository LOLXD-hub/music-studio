// Comparison: the same notes, rendered by this app's engine and by FFmpeg alone.
//
// The FFmpeg versions are a deliberate best effort with nothing but FFmpeg signal sources (sine, aevalsrc,
// anoisesrc), envelopes (afade) and mixing (amix). They show what "generate music with FFmpeg" gives you.
// Nothing here is used by the app: the app only uses FFmpeg to decode and encode files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TempoMap } from '../src/engine/project.ts';
import type { MidiClip, Project } from '../src/engine/project.ts';
import { renderProject } from '../src/engine/render.ts';
import { analyzeAudio, renderPicture } from '../src/engine/analysis/index.ts';
import type { ImageData8 } from '../src/engine/analysis/index.ts';
import { encodePng } from '../src/core/png.ts';
import { decodeWav } from '../src/engine/io/wav.ts';
import { encodeAudio, findFfmpeg } from '../src/core/audioio.ts';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docs', 'comparison');
fs.mkdirSync(outDir, { recursive: true });
const work = path.join(root, 'tmp', 'compare');
fs.mkdirSync(work, { recursive: true });
const ffmpeg = findFfmpeg();
if (!ffmpeg) throw new Error('FFmpeg is needed for the baseline renders.');

const doc = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'music', 'glass-garden.msai'), 'utf8'));
const project: Project = doc.project;
const tm = new TempoMap(project.tempo);
const SR = 44100;

interface N { t: number; d: number; p: number; v: number; drum: boolean }
function notesIn(from: number, to: number): N[] {
  const out: N[] = [];
  for (const tr of project.tracks) {
    if (tr.kind !== 'instrument') continue;
    const drum = tr.instrument?.type === 'drums';
    for (const c of tr.clips) {
      if (c.kind !== 'midi') continue;
      for (const n of (c as MidiClip).notes) {
        const t = tm.tickToSec(c.start + n.t);
        const e = tm.tickToSec(c.start + n.t + n.d);
        if (t >= from && t < to) out.push({ t: t - from, d: Math.max(0.06, Math.min(e, to) - t), p: n.p, v: n.v, drum });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

type Variant = 'sine' | 'additive';
function filterScript(notes: N[], variant: Variant): string {
  const lines: string[] = [];
  const labels: string[] = [];
  notes.forEach((n, i) => {
    const a = (0.2 * Math.pow(n.v / 127, 1.4)).toFixed(4);
    const f = (440 * Math.pow(2, (n.p - 69) / 12)).toFixed(3);
    const d = n.d.toFixed(3);
    const ms = Math.round(n.t * 1000);
    const lab = `n${i}`;
    if (n.drum) {
      // GM drum map: kick 35/36, snare 38/40, hats 42/44/46, everything else is noise with a longer tail
      let src: string;
      if (n.p === 35 || n.p === 36) src = `aevalsrc='${a}*sin(2*PI*(48+130*exp(-38*t))*t)*exp(-9*t)':s=${SR}:d=0.35`;
      else if (n.p === 38 || n.p === 40) src = `anoisesrc=d=0.2:c=white:r=${SR}:a=${a},highpass=f=1200,afade=t=out:st=0.02:d=0.18`;
      else if (n.p === 42 || n.p === 44 || n.p === 46) src = `anoisesrc=d=0.06:c=white:r=${SR}:a=${(+a * 0.6).toFixed(4)},highpass=f=6500,afade=t=out:st=0.005:d=0.055`;
      else src = `anoisesrc=d=0.9:c=white:r=${SR}:a=${(+a * 0.5).toFixed(4)},highpass=f=3000,afade=t=out:st=0.05:d=0.85`;
      lines.push(`${src},adelay=${ms}:all=1[${lab}]`);
    } else if (variant === 'sine') {
      lines.push(`sine=frequency=${f}:sample_rate=${SR}:duration=${d},volume=${a},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, n.d - 0.08).toFixed(3)}:d=0.08,adelay=${ms}:all=1[${lab}]`);
    } else {
      const E = `${a}*(sin(2*PI*${f}*t)+0.5*sin(4*PI*${f}*t)+0.33*sin(6*PI*${f}*t)+0.22*sin(8*PI*${f}*t)+0.15*sin(10*PI*${f}*t))*exp(-2.2*t)`;
      lines.push(`aevalsrc='${E}':s=${SR}:d=${d},afade=t=in:d=0.006,afade=t=out:st=${Math.max(0, n.d - 0.06).toFixed(3)}:d=0.06,adelay=${ms}:all=1[${lab}]`);
    }
    labels.push(`[${lab}]`);
  });
  lines.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[out]`);
  return lines.join(';\n');
}

function ffmpegRender(notes: N[], variant: Variant, name: string): { L: Float32Array; R: Float32Array; seconds: number } {
  const script = path.join(work, `${name}.txt`);
  const wav = path.join(work, `${name}.wav`);
  fs.writeFileSync(script, filterScript(notes, variant));
  const t0 = Date.now();
  const r = spawnSync(ffmpeg!, ['-y', '-v', 'error', '-/filter_complex', script, '-map', '[out]', '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_f32le', wav], { windowsHide: true, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${r.stderr.toString().slice(0, 500)}`);
  const d = decodeWav(new Uint8Array(fs.readFileSync(wav)));
  return { L: d.channels[0], R: d.channels[1] ?? d.channels[0], seconds: (Date.now() - t0) / 1000 };
}

function normalize(L: Float32Array, R: Float32Array, target = -16): void {
  const rep = analyzeAudio(L, R, SR);
  let g = Math.pow(10, (target - rep.loudness.integratedLufs) / 20);
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk * g > 0.89) g = 0.89 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
}

function stack(imgs: ImageData8[], gap = 6): ImageData8 {
  const w = imgs[0].width;
  const h = imgs.reduce((s, i) => s + i.height, 0) + gap * (imgs.length - 1);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  let y = 0;
  for (const im of imgs) { rgba.set(im.rgba, y * w * 4); y += im.height + gap; }
  return { width: w, height: h, rgba };
}

const excerpts = [
  { id: 'strings-piano', title: 'Bars 9-14: solo violin, piano, cellos and bass', from: 26.67, to: 46.67 },
  { id: 'full-with-drums', title: 'Bars 17-20: the climax with drums, harp and strings', from: 53.34, to: 66.67 },
];

const report: Record<string, any> = { source: 'examples/music/glass-garden.msai', sampleRate: SR, excerpts: {} };
for (const ex of excerpts) {
  const notes = notesIn(ex.from, ex.to);
  console.log(`${ex.id}: ${notes.length} notes`);
  const eng = renderProject(project, new Map(), { sampleRate: SR, startSec: ex.from, endSec: ex.to, tailMaxSec: 1.5 });
  const variants: [string, string, { L: Float32Array; R: Float32Array }][] = [['engine', 'Music studio engine', { L: eng.L, R: eng.R }]];
  for (const v of ['sine', 'additive'] as Variant[]) {
    const r = ffmpegRender(notes, v, `${ex.id}-${v}`);
    console.log(`  ffmpeg ${v}: ${r.seconds.toFixed(1)} s`);
    variants.push([`ffmpeg-${v}`, v === 'sine' ? 'FFmpeg: sine tones' : 'FFmpeg: 5-harmonic tones with decay', r]);
  }
  const rows: any[] = [];
  const pics: ImageData8[] = [];
  for (const [id, label, a] of variants) {
    normalize(a.L, a.R);
    const rep = analyzeAudio(a.L, a.R, SR);
    const pic = renderPicture(a.L, a.R, SR, { width: 1400, fMax: 12000 });
    pics.push(pic.image);
    fs.writeFileSync(path.join(outDir, `${ex.id}-${id}.png`), encodePng(pic.image));
    fs.writeFileSync(path.join(outDir, `${ex.id}-${id}.mp3`), await encodeAudio(a.L, a.R, SR, { format: 'mp3', kbps: 192 }));
    rows.push({
      id, label, seconds: +(a.L.length / SR).toFixed(1),
      centroidHz: rep.spectrum.centroidHz, rolloff85Hz: rep.spectrum.rolloff85Hz, flatness: +rep.spectrum.flatness.toFixed(4),
      crestDb: rep.loudness.crestDb, lra: rep.loudness.lra, stereoWidthPercent: rep.stereo.widthPercent,
      bands: rep.spectrum.bands.map((b: any) => ({ name: b.name, db: b.db })),
    });
  }
  fs.writeFileSync(path.join(outDir, `${ex.id}-stack.png`), encodePng(stack(pics)));
  report.excerpts[ex.id] = { title: ex.title, from: ex.from, to: ex.to, notes: notes.length, rows };
  fs.copyFileSync(path.join(work, `${ex.id}-additive.txt`), path.join(outDir, `${ex.id}-additive.filtergraph.txt`));
}
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(report, null, 1));
console.log('wrote', outDir);
