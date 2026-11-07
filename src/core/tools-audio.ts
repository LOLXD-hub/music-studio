import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z, action, pos, track, round, PosS, TrackS, image } from './toolkit.ts';
import type { Ctx, ToolDef } from './toolkit.ts';
import { PPQ, TempoMap } from '../engine/project.ts';
import { analyzeAudio, renderPicture } from '../engine/analysis/index.ts';
import type { AudioReport } from '../engine/analysis/index.ts';
import { applyEdit } from '../sfx/catalog.ts';
import type { SfxEdit } from '../sfx/catalog.ts';
import { encodeAudio, extFor, decodeAudioFile, findFfmpeg } from './audioio.ts';
import type { ExportFormat } from './audioio.ts';
import { parseMidi, writeMidi } from '../engine/io/midi.ts';
import * as ops from './ops.ts';
import { encodePng } from './png.ts';
import { createFx } from '../engine/fx/index.ts';
import { safeName } from './studio.ts';
import type { TNote } from '../theory/humanize.ts';
import { parsePc } from '../theory/pitch.ts';

const compactReport = (r: AudioReport) => ({
  duration: `${r.durationSec} s`,
  loudness: r.loudness,
  stereo: r.stereo,
  spectrum: { centroidHz: r.spectrum.centroidHz, rolloff85Hz: r.spectrum.rolloff85Hz, tiltDbPerOct: r.spectrum.tiltDbPerOct, bands: r.spectrum.bands.map((b) => `${b.name} ${b.lo}-${b.hi} Hz: ${b.share}%`) },
  clipping: r.clipping,
  music: { estimatedKey: r.music.keys, estimatedTempo: r.music.tempo, onsetsPerSecond: r.music.onsetsPerSec },
  loudnessCurve: r.curve.length > 40 ? r.curve.filter((_, i) => i % Math.ceil(r.curve.length / 40) === 0) : r.curve,
  descriptors: r.descriptors,
  issues: r.issues,
});

function previewPath(ctx: Ctx, name: string): string {
  return path.join(ctx.studio.dataDir, 'Previews', safeName(name) + '.wav');
}

// ============================================================ audio
const audioTool: ToolDef = {
  name: 'audio',
  description: 'Audio assets: import files (WAV, MP3, FLAC, and others via FFmpeg), inspect, edit (normalize, fades, reverse, pitch, filters), bounce tracks to audio.',
  actions: {
    import: action({
      description: 'Import an audio file as an asset. Place it with clips add_audio.',
      schema: z.object({ path: z.string(), name: z.string().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const ref = await ctx.studio.importAudio(a.path, { name: a.name });
        return { summary: `Imported "${ref.name}" (${round(ref.frames / ref.sampleRate, 2)} s, ${ref.channels} ch, ${ref.sampleRate} Hz).`, asset: ref };
      },
    }),
    list: action({ description: 'List audio assets.', schema: z.object({}), run: (ctx) => ({ summary: `${ctx.studio.assets.size} assets`, assets: [...ctx.studio.assets.values()].map((a) => ({ id: a.ref.id, name: a.ref.name, seconds: round(a.ref.frames / a.ref.sampleRate, 2), channels: a.ref.channels, sampleRate: a.ref.sampleRate, source: a.ref.source })) }) }),
    info: action({
      description: 'Analyse one asset: loudness, spectrum, peak.',
      schema: z.object({ asset: z.string() }),
      agent: 'listening',
      run: (ctx, a) => {
        const x = ctx.studio.assets.get(a.asset);
        if (!x) throw new Error(`No asset ${a.asset}.`);
        const L = x.data.channels[0];
        const r = analyzeAudio(L, x.data.channels[1] ?? L, x.data.sampleRate);
        return { summary: `${x.ref.name}: ${r.loudness.integratedLufs} LUFS, peak ${r.loudness.samplePeakDb} dB`, ...compactReport(r) };
      },
    }),
    edit: action({
      description: 'Create an edited copy of an asset: gain, fades, reverse, pitch (semitones, changes length), low/high-pass, reverb, echo, drive, trim, normalize. The original stays.',
      schema: z.object({ asset: z.string(), name: z.string().optional(), gain: z.number().optional(), fade_in: z.number().optional(), fade_out: z.number().optional(), reverse: z.boolean().optional(), pitch: z.number().optional(), lp: z.number().optional(), hp: z.number().optional(), reverb: z.number().min(0).max(1).optional(), echo: z.number().min(0).max(1).optional(), drive: z.number().optional(), trim_start: z.number().optional(), trim_end: z.number().optional(), normalize_db: z.number().optional() }),
      agent: 'loading',
      run: (ctx, a) => {
        const x = ctx.studio.assets.get(a.asset);
        if (!x) throw new Error(`No asset ${a.asset}.`);
        const L = x.data.channels[0];
        const R = x.data.channels[1] ?? L;
        const e: SfxEdit = { gain: a.gain, fadeIn: a.fade_in, fadeOut: a.fade_out, reverse: a.reverse, pitch: a.pitch, lp: a.lp, hp: a.hp, reverb: a.reverb, echo: a.echo, drive: a.drive, trimStart: a.trim_start, trimEnd: a.trim_end, normalize: a.normalize_db };
        const out = applyEdit(L, R, x.data.sampleRate, e);
        const ref = ctx.studio.addAsset([out.L, out.R], x.data.sampleRate, { name: a.name ?? x.ref.name + ' (edited)', source: 'import' });
        return { summary: `Created "${ref.name}" (${ref.id}).`, asset: ref };
      },
    }),
    bounce: action({
      description: 'Render the project (or chosen tracks, or a time range) to a new audio asset, e.g. to freeze a track or capture a texture.',
      schema: z.object({ tracks: z.array(TrackS).optional(), from: PosS.optional(), to: PosS.optional(), name: z.string().optional(), to_library: z.boolean().optional().describe('Also store it in the sound library.') }),
      agent: 'loading',
      run: async (ctx, a) => {
        const r = await ctx.studio.render({ tracks: a.tracks, startBeat: a.from !== undefined ? pos(ctx, a.from) : undefined, endBeat: a.to !== undefined ? pos(ctx, a.to) : undefined });
        const ref = ctx.studio.addAsset([r.L, r.R], r.sampleRate, { name: a.name ?? 'Bounce', source: 'bounce' });
        let lib: string | undefined;
        if (a.to_library) lib = ctx.studio.sfx.addBuffer(r.L, r.R, r.sampleRate, { name: a.name ?? 'Bounce', category: 'My Sounds', folder: 'My Sounds/Bounces', tags: ['bounce'] }).id;
        return { summary: `Bounced ${round(r.durationSec, 2)} s to asset ${ref.id}${lib ? ` and library item ${lib}` : ''}.`, asset: ref, library: lib };
      },
    }),
    remove: action({ description: 'Remove an unused asset.', schema: z.object({ asset: z.string() }), mutates: true, run: (ctx, a) => {
      const used = ctx.studio.project.tracks.some((t) => t.clips.some((c) => c.kind === 'audio' && c.assetId === a.asset));
      if (used) throw new Error('That asset is used by a clip. Remove the clip first.');
      ctx.studio.assets.delete(a.asset);
      ctx.studio.project.assets = ctx.studio.project.assets.filter((x) => x.id !== a.asset);
      return { summary: `Removed asset ${a.asset}.` };
    } }),
  },
};

// ============================================================ midi
function guessInstrument(program: number, channel: number): { type: string; preset?: string } {
  if (channel === 9) return { type: 'drums', preset: 'Acoustic kit' };
  if (program < 8) return { type: 'piano', preset: program === 4 || program === 5 ? undefined : 'Concert grand' };
  if (program < 16) return { type: 'mallet', preset: program === 11 ? 'Vibraphone' : program === 12 ? 'Marimba' : program === 9 ? 'Glockenspiel' : program === 14 ? 'Tubular bells' : 'Celesta' };
  if (program < 24) return { type: 'organ', preset: 'Jazz 888000000' };
  if (program < 32) return { type: 'plucked', preset: program < 26 ? 'Acoustic guitar (steel)' : program < 28 ? 'Electric guitar (clean)' : 'Electric guitar (crunch)' };
  if (program < 40) return { type: 'plucked', preset: program === 34 ? 'Picked bass' : 'Finger bass' };
  if (program < 48) return { type: 'wind_string', preset: program === 40 ? 'Violin (solo)' : program === 41 ? 'Viola (solo)' : program === 42 ? 'Cello (solo)' : program === 43 ? 'Double bass (solo)' : program === 46 ? undefined : 'Violins (section)' };
  if (program < 56) return { type: 'wind_string', preset: program >= 52 && program <= 54 ? 'Choir (ahh)' : 'String ensemble' };
  if (program < 64) return { type: 'wind_string', preset: program === 56 ? 'Trumpet' : program === 57 ? 'Trombone' : program === 58 ? 'Tuba' : program === 60 ? 'French horn' : 'Brass section' };
  if (program < 72) return { type: 'wind_string', preset: program < 68 ? 'Alto sax' : program === 68 ? 'Oboe' : program === 70 ? 'Bassoon' : 'Clarinet' };
  if (program < 80) return { type: 'wind_string', preset: 'Flute' };
  if (program < 88) return { type: 'subsynth', preset: 'Supersaw lead' };
  if (program < 96) return { type: 'wind_string', preset: 'Warm analog pad' };
  return { type: 'subsynth', preset: 'Soft lead' };
}

const midiTool: ToolDef = {
  name: 'midi',
  description: 'Import and export Standard MIDI Files.',
  actions: {
    import: action({
      description: 'Import a .mid file: tempo, meter, key and one instrument track per channel (instruments chosen from the General MIDI program).',
      schema: z.object({ path: z.string(), replace: z.boolean().optional().describe('Replace the current tracks (default: add to them).') }),
      mutates: true,
      agent: 'loading',
      run: (ctx, a) => {
        const f = parseMidi(new Uint8Array(fs.readFileSync(a.path)));
        let made = 0;
        let notes = 0;
        ctx.studio.mutate('Import MIDI', (p) => {
          if (a.replace) p.tracks = [];
          if (f.tempo.length) p.tempo = f.tempo.map((t) => ({ t: t.t, bpm: Math.round(t.bpm * 100) / 100 }));
          if (f.sig.length) p.sig = f.sig.map((s) => ({ t: s.t, num: s.num, den: s.den }));
          if (f.keySig) {
            const majors = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
            const minors = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
            const name = (f.keySig.minor ? minors : majors)[f.keySig.sharps + 7];
            if (name) p.key = { root: parsePc(name), mode: f.keySig.minor ? 'minor' : 'major' };
          }
          for (const tr of f.tracks) {
            if (!tr.notes.length) continue;
            const inst = guessInstrument(tr.program, tr.channel);
            const t = ops.newTrack(p, { name: tr.name || `Track ${made + 1}`, kind: 'instrument', instrument: inst });
            const list: TNote[] = tr.notes.map((n) => ({ t: n.t / PPQ, d: n.d / PPQ, p: n.p, v: n.v }));
            ops.addNotes(p, t, list);
            const pedal = tr.cc.filter((c) => c.cc === 64).map((c) => ({ t: c.t / PPQ, v: c.v }));
            if (pedal.length) ops.setCC(p, t, 64, pedal);
            const expr = tr.cc.filter((c) => c.cc === 11).map((c) => ({ t: c.t / PPQ, v: c.v }));
            if (expr.length) ops.setCC(p, t, 11, expr);
            made++;
            notes += list.length;
          }
        });
        return { summary: `Imported ${made} tracks and ${notes} notes from ${path.basename(a.path)}.` };
      },
    }),
    export: action({
      description: 'Write the project as a Standard MIDI File (format 1).',
      schema: z.object({ path: z.string().optional() }),
      run: (ctx, a) => {
        const target = a.path ?? path.join(ctx.studio.dataDir, 'Exports', safeName(ctx.studio.project.name) + '.mid');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, writeMidi(ctx.studio.project));
        return { summary: `Wrote ${target}`, path: target };
      },
    }),
  },
};

// ============================================================ render
async function writeFile(ctx: Ctx, L: Float32Array, R: Float32Array, sr: number, target: string, format: ExportFormat, bitDepth?: number, kbps?: number): Promise<number> {
  const bytes = await encodeAudio(L, R, sr, { format, bitDepth, kbps });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  void ctx;
  return bytes.length;
}

const renderTool: ToolDef = {
  name: 'render',
  description: 'Export audio: mixdown, stems. WAV (16/24/32f), MP3, FLAC natively; OGG/M4A/Opus through FFmpeg if installed. All audio is generated by the built-in engine.',
  actions: {
    mixdown: action({
      description: 'Render the whole project (or a range, or chosen tracks) to a file. Optionally normalize to a loudness target with a true-peak ceiling.',
      schema: z.object({
        path: z.string().optional(), format: z.enum(['wav', 'mp3', 'flac', 'ogg', 'm4a', 'opus']).optional(), bit_depth: z.number().optional(), kbps: z.number().optional(), sample_rate: z.number().optional(),
        from: PosS.optional(), to: PosS.optional(), tracks: z.array(TrackS).optional(), normalize_lufs: z.number().min(-30).max(-5).optional(), ceiling_db: z.number().min(-6).max(0).optional(),
      }),
      agent: 'loading',
      run: async (ctx, a) => {
        const format = (a.format ?? (a.path ? (path.extname(a.path).slice(1).toLowerCase() as ExportFormat) : 'wav')) || 'wav';
        const r = await ctx.studio.render({ sampleRate: a.sample_rate ?? 44100, tracks: a.tracks, startBeat: a.from !== undefined ? pos(ctx, a.from) : undefined, endBeat: a.to !== undefined ? pos(ctx, a.to) : undefined, analyze: true });
        let L = r.L;
        let R = r.R;
        let gainDb = 0;
        if (a.normalize_lufs !== undefined && r.report) {
          gainDb = a.normalize_lufs - r.report.loudness.integratedLufs;
          const g = Math.pow(10, gainDb / 20);
          L = Float32Array.from(L, (x) => x * g);
          R = Float32Array.from(R, (x) => x * g);
          const lim = createFx('limiter', r.sampleRate, { ceiling: a.ceiling_db ?? -1, gain: 0, release: 120 })!;
          for (let i = 0; i < L.length; i += 1024) { const e = Math.min(L.length, i + 1024); lim.process(L.subarray(i, e), R.subarray(i, e), 0, e - i); }
        }
        const target = a.path ?? path.join(ctx.studio.dataDir, 'Exports', `${safeName(ctx.studio.project.name)}.${extFor(format)}`);
        const size = await writeFile(ctx, L, R, r.sampleRate, target, format, a.bit_depth, a.kbps);
        const check = a.normalize_lufs !== undefined ? analyzeAudio(L, R, r.sampleRate) : r.report!;
        return { summary: `Exported ${path.basename(target)}: ${round(r.durationSec, 1)} s, ${round(size / 1048576, 2)} MB, ${check.loudness.integratedLufs} LUFS, peak ${check.loudness.truePeakDb} dBTP.`, path: target, bytes: size, format, durationSec: round(r.durationSec, 2), normalizedGainDb: round(gainDb, 2), loudness: check.loudness, issues: check.issues };
      },
    }),
    stems: action({
      description: 'Render every instrument and audio track on its own (with its bus returns) into a folder.',
      schema: z.object({ dir: z.string().optional(), format: z.enum(['wav', 'flac', 'mp3']).optional(), bit_depth: z.number().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const dir = a.dir ?? path.join(ctx.studio.dataDir, 'Exports', safeName(ctx.studio.project.name) + ' stems');
        const format = a.format ?? 'wav';
        const files: string[] = [];
        for (const t of ctx.studio.project.tracks.filter((x) => x.kind !== 'bus' && x.clips.length)) {
          const r = await ctx.studio.render({ tracks: [t.id] });
          const f = path.join(dir, `${safeName(t.name)}.${format}`);
          await writeFile(ctx, r.L, r.R, r.sampleRate, f, format, a.bit_depth);
          files.push(f);
        }
        return { summary: `Wrote ${files.length} stems to ${dir}`, dir, files };
      },
    }),
    preview: action({
      description: 'Quick WAV render of a range into the Previews folder (for the human to open) without analysis.',
      schema: z.object({ from: PosS.optional(), to: PosS.optional(), tracks: z.array(TrackS).optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const r = await ctx.studio.render({ tracks: a.tracks, startBeat: a.from !== undefined ? pos(ctx, a.from) : undefined, endBeat: a.to !== undefined ? pos(ctx, a.to) : undefined });
        const f = previewPath(ctx, ctx.studio.project.name + ' preview');
        await writeFile(ctx, r.L, r.R, r.sampleRate, f, 'wav', 16);
        return { summary: `Preview written (${round(r.durationSec, 1)} s).`, path: f };
      },
    }),
  },
};

// ============================================================ listen
const listenTool: ToolDef = {
  name: 'listen',
  description: 'Listen with numbers and pictures: render the project (or one track, or a range) and get loudness, spectrum, stereo, key/tempo estimates, issues, and a waveform + spectrogram image. Also analyses external audio files and compares with a reference.',
  actions: {
    analyze: action({
      description: 'Render and analyse. Use tracks to hear only some tracks, from/to to focus a section. The picture shows waveform on top and a log-frequency spectrogram with bar numbers.',
      schema: z.object({ from: PosS.optional(), to: PosS.optional(), tracks: z.array(TrackS).optional(), picture: z.boolean().optional().describe('Return the image (default true).'), width: z.number().int().min(600).max(2400).optional(), save_preview: z.boolean().optional() }),
      agent: 'listening',
      run: async (ctx, a) => {
        const r = await ctx.studio.render({ tracks: a.tracks, startBeat: a.from !== undefined ? pos(ctx, a.from) : undefined, endBeat: a.to !== undefined ? pos(ctx, a.to) : undefined, analyze: true, picture: a.picture !== false, pictureWidth: a.width });
        let preview: string | undefined;
        if (a.save_preview) {
          preview = previewPath(ctx, ctx.studio.project.name + ' listen');
          await writeFile(ctx, r.L, r.R, r.sampleRate, preview, 'wav', 16);
        }
        const rep = r.report!;
        const key = ctx.studio.project.key;
        return {
          summary: `${round(r.durationSec, 1)} s rendered in ${round(r.renderMs / 1000, 1)} s: ${rep.loudness.integratedLufs} LUFS, peak ${rep.loudness.truePeakDb} dBTP, ${rep.descriptors.join(', ')}.`,
          ...compactReport(rep), projectKey: key ? `${key.root}/${key.mode}` : null, preview,
          pictureGuide: r.picture ? r.picture.layout : undefined,
          _images: r.picture ? [image(r.picture.png, 'Top: waveform (light = RMS, red = clipping). Below: spectrogram, log frequency (100, 1k, 10k labelled), bar numbers on the time axis.')] : [],
        };
      },
    }),
    file: action({
      description: 'Analyse any audio file on disk (a reference track, an export) the same way.',
      schema: z.object({ path: z.string(), picture: z.boolean().optional() }),
      agent: 'listening',
      run: async (_ctx, a) => {
        const d = await decodeAudioFile(a.path);
        const L = d.channels[0];
        const R = d.channels[1] ?? L;
        const rep = analyzeAudio(L, R, d.sampleRate);
        const pic = a.picture !== false ? renderPicture(L, R, d.sampleRate) : null;
        return { summary: `${path.basename(a.path)}: ${rep.loudness.integratedLufs} LUFS, ${rep.descriptors.join(', ')}.`, ...compactReport(rep), _images: pic ? [image(encodePng(pic.image), 'Waveform and spectrogram of the file.')] : [] };
      },
    }),
    compare: action({
      description: 'Compare the current mix with a reference audio file: loudness, spectral balance by band, width, brightness. Tells you what to change.',
      schema: z.object({ reference: z.string() }),
      agent: 'listening',
      run: async (ctx, a) => {
        const mine = (await ctx.studio.render({ analyze: true })).report!;
        const d = await decodeAudioFile(a.reference);
        const ref = analyzeAudio(d.channels[0], d.channels[1] ?? d.channels[0], d.sampleRate);
        const advice: string[] = [];
        const dL = mine.loudness.integratedLufs - ref.loudness.integratedLufs;
        if (Math.abs(dL) > 1.5) advice.push(`Your mix is ${round(Math.abs(dL), 1)} LU ${dL > 0 ? 'louder' : 'quieter'} than the reference.`);
        for (const b of mine.spectrum.bands) {
          const rb = ref.spectrum.bands.find((x) => x.name === b.name)!;
          const diff = b.share - rb.share;
          if (Math.abs(diff) > 6) advice.push(`${b.name} (${b.lo}-${b.hi} Hz) has ${round(Math.abs(diff), 0)} points ${diff > 0 ? 'more' : 'less'} of the energy than the reference.`);
        }
        if (Math.abs(mine.stereo.widthPercent - ref.stereo.widthPercent) > 12) advice.push(`Stereo width ${mine.stereo.widthPercent}% vs reference ${ref.stereo.widthPercent}%.`);
        if (Math.abs(mine.spectrum.centroidHz - ref.spectrum.centroidHz) > 600) advice.push(`Brightness: centroid ${mine.spectrum.centroidHz} Hz vs ${ref.spectrum.centroidHz} Hz.`);
        return { summary: advice.length ? `${advice.length} differences from the reference.` : 'Close to the reference.', mine: compactReport(mine).loudness, reference: compactReport(ref).loudness, advice };
      },
    }),
  },
};

// ============================================================ sfx
const sfxTool: ToolDef = {
  name: 'sfx',
  description: 'Sound effects library: 1000+ synthesized sounds in folders; search, audition, place on the timeline, import your own, edit, add, delete, export.',
  actions: {
    categories: action({ description: 'Category and folder tree with counts.', schema: z.object({}), run: (ctx) => ({ summary: `${ctx.studio.sfx.count().total} sounds`, counts: ctx.studio.sfx.count(), tree: ctx.studio.sfx.categories() }) }),
    families: action({ description: 'The synthesis families you can add new sounds from, with their parameter ranges.', schema: z.object({}), run: (ctx) => ({ summary: 'Sound families', families: ctx.studio.sfx.families() }) }),
    search: action({
      description: 'Find sounds by text, category, folder, tags. Returns ids, names and folders.',
      schema: z.object({ query: z.string().optional(), category: z.string().optional(), folder: z.string().optional(), tags: z.array(z.string()).optional(), source: z.enum(['builtin', 'user']).optional(), favorites: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().optional() }),
      run: (ctx, a) => {
        const r = ctx.studio.sfx.search(a);
        return { summary: `${r.total} matches${r.total > r.items.length ? `, showing ${r.items.length}` : ''}`, total: r.total, items: r.items.map((i) => ({ id: i.id, name: i.name, folder: i.folder, tags: i.tags.slice(0, 5), source: i.source, favorite: i.favorite || undefined })) };
      },
    }),
    get: action({ description: 'Details of one sound: parameters and edits.', schema: z.object({ id: z.string() }), run: (ctx, a) => ({ summary: ctx.studio.sfx.get(a.id).name, item: ctx.studio.sfx.get(a.id) }) }),
    preview: action({
      description: 'Play a sound in the app and get its numbers (duration, peak, brightness).',
      schema: z.object({ id: z.string() }),
      agent: 'listening',
      run: async (ctx, a) => {
        const r = await ctx.studio.sfx.render(a.id);
        const rep = analyzeAudio(r.L, r.R, r.sr);
        ctx.studio.emit('audition', { id: a.id, L: r.L, R: r.R, sampleRate: r.sr });
        const item = ctx.studio.sfx.get(a.id);
        return { summary: `"${item.name}": ${rep.durationSec} s, peak ${rep.loudness.samplePeakDb} dB, ${rep.descriptors.slice(0, 2).join(', ')}`, id: a.id, durationSec: rep.durationSec, peakDb: rep.loudness.samplePeakDb, centroidHz: rep.spectrum.centroidHz, heardInApp: ctx.studio.transport.uiConnected };
      },
    }),
    place: action({
      description: 'Put a sound on the timeline at a position (on the "SFX" audio track unless another is given).',
      schema: z.object({ id: z.string(), at: PosS, track: z.string().optional(), gain: z.number().optional(), fade_out: z.number().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const item = ctx.studio.sfx.get(a.id);
        const r = await ctx.studio.sfx.render(a.id);
        const at = pos(ctx, a.at);
        const assetId = `sfx_${a.id}_${Math.abs(JSON.stringify([item.params, item.edit]).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`;
        if (!ctx.studio.assets.has(assetId)) ctx.studio.addAsset([r.L, r.R], r.sr, { name: item.name, source: 'sfx', id: assetId });
        const tm = new TempoMap(ctx.studio.project.tempo);
        const durBeats = (tm.secToTick(tm.tickToSec(at * PPQ) + r.L.length / r.sr) - at * PPQ) / PPQ;
        let cid = '';
        ctx.studio.mutate('Place sound', (p) => {
          const name = a.track ?? 'SFX';
          let t = p.tracks.find((x) => x.id === name) ?? p.tracks.find((x) => x.name.toLowerCase() === name.toLowerCase());
          if (!t) t = ops.newTrack(p, { name, kind: 'audio' });
          if (t.kind !== 'audio') throw new Error(`Track "${t.name}" is not an audio track.`);
          cid = ops.addAudioClip(t, { assetId, start: at, len: durBeats, name: item.name, gain: a.gain, fadeOut: a.fade_out ?? 0.02 }).id;
        });
        return { summary: `Placed "${item.name}" at beat ${round(at, 2)} (${round(r.L.length / r.sr, 2)} s).`, clip: cid };
      },
    }),
    import: action({
      description: 'Add your own audio file to the library.',
      schema: z.object({ path: z.string(), name: z.string().optional(), category: z.string().optional(), folder: z.string().optional(), tags: z.array(z.string()).optional() }),
      agent: 'loading',
      run: async (ctx, a) => { const it = await ctx.studio.sfx.importFile(a.path, a); return { summary: `Imported "${it.name}" as ${it.id} into ${it.folder}.`, item: it }; },
    }),
    import_folder: action({
      description: 'Import every audio file in a folder (non-recursive) into a library category.',
      schema: z.object({ dir: z.string(), category: z.string().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const files = fs.readdirSync(a.dir).filter((f) => /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i.test(f));
        const items = [];
        for (const f of files.slice(0, 200)) items.push((await ctx.studio.sfx.importFile(path.join(a.dir, f), { category: a.category, folder: `${a.category ?? 'My Sounds'}/${path.basename(a.dir)}` })).id);
        return { summary: `Imported ${items.length} files.`, ids: items };
      },
    }),
    add: action({
      description: 'Create a new synthesized sound from a family and parameters (see sfx families). It joins the user library.',
      schema: z.object({ family: z.string(), params: z.record(z.string(), z.number()).optional(), name: z.string().optional(), category: z.string().optional(), folder: z.string().optional(), tags: z.array(z.string()).optional() }),
      run: (ctx, a) => { const it = ctx.studio.sfx.addSynth(a); return { summary: `Created "${it.name}" (${it.id}).`, item: it }; },
    }),
    edit: action({
      description: 'Edit a sound: family parameters (params), an edit chain (gain dB, fade_in/out s, reverse, pitch st, lp/hp Hz, reverb 0-1, echo 0-1, drive, trim_start/end s, normalize dB), name, tags, folder. Built-ins keep their original; use reset to undo.',
      schema: z.object({ id: z.string(), params: z.record(z.string(), z.number()).optional(), gain: z.number().optional(), fade_in: z.number().optional(), fade_out: z.number().optional(), reverse: z.boolean().optional(), pitch: z.number().optional(), lp: z.number().optional(), hp: z.number().optional(), reverb: z.number().optional(), echo: z.number().optional(), drive: z.number().optional(), trim_start: z.number().optional(), trim_end: z.number().optional(), normalize_db: z.number().optional(), name: z.string().optional(), tags: z.array(z.string()).optional(), folder: z.string().optional(), reset: z.boolean().optional() }),
      run: (ctx, a) => {
        const edit: SfxEdit = { gain: a.gain, fadeIn: a.fade_in, fadeOut: a.fade_out, reverse: a.reverse, pitch: a.pitch, lp: a.lp, hp: a.hp, reverb: a.reverb, echo: a.echo, drive: a.drive, trimStart: a.trim_start, trimEnd: a.trim_end, normalize: a.normalize_db };
        for (const k of Object.keys(edit) as (keyof SfxEdit)[]) if (edit[k] === undefined) delete edit[k];
        const it = ctx.studio.sfx.edit(a.id, { params: a.params, edit: Object.keys(edit).length || a.reset ? edit : undefined, name: a.name, tags: a.tags, folder: a.folder, reset: a.reset });
        return { summary: `Edited "${it.name}".`, item: it };
      },
    }),
    delete: action({ description: 'Delete a user sound, or hide a built-in one (restore brings it back).', schema: z.object({ id: z.string() }), run: (ctx, a) => { const r = ctx.studio.sfx.remove(a.id); return { summary: r.deleted ? `Deleted ${a.id}.` : `Hid built-in ${a.id}. Use sfx restore to bring it back.`, ...r }; } }),
    restore: action({ description: 'Restore a hidden built-in sound, or all of them.', schema: z.object({ id: z.string().optional() }), run: (ctx, a) => ({ summary: `Restored ${ctx.studio.sfx.restore(a.id)} sounds.` }) }),
    favorite: action({ description: 'Mark or unmark a favourite.', schema: z.object({ id: z.string(), on: z.boolean().optional() }), run: (ctx, a) => { ctx.studio.sfx.favorite(a.id, a.on !== false); return { summary: 'Favourite updated.' }; } }),
    export: action({
      description: 'Write a sound (with its edits) to a WAV/MP3/FLAC file.',
      schema: z.object({ id: z.string(), path: z.string().optional(), format: z.enum(['wav', 'mp3', 'flac']).optional(), bit_depth: z.number().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const it = ctx.studio.sfx.get(a.id);
        const r = await ctx.studio.sfx.render(a.id, 44100);
        const fmt = (a.format ?? 'wav') as ExportFormat;
        const target = a.path ?? path.join(ctx.studio.dataDir, 'Exports', safeName(it.name) + '.' + fmt);
        const size = await writeFile(ctx, r.L, r.R, r.sr, target, fmt, a.bit_depth);
        return { summary: `Exported to ${target}`, path: target, bytes: size };
      },
    }),
  },
};

// ============================================================ plugins
function vst3Dirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') return [path.join(process.env.CommonProgramFiles ?? 'C:\\Program Files\\Common Files', 'VST3'), path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Common', 'VST3')];
  if (process.platform === 'darwin') return ['/Library/Audio/Plug-Ins/VST3', path.join(home, 'Library/Audio/Plug-Ins/VST3')];
  return [path.join(home, '.vst3'), '/usr/lib/vst3', '/usr/local/lib/vst3'];
}

export function scanVst3(): { name: string; path: string; vendor?: string; category?: string }[] {
  const out: { name: string; path: string; vendor?: string; category?: string }[] = [];
  const walk = (dir: string, depth: number) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.name.toLowerCase().endsWith('.vst3')) {
        const item: { name: string; path: string; vendor?: string; category?: string } = { name: e.name.replace(/\.vst3$/i, ''), path: p };
        try {
          const mi = path.join(p, 'Contents', 'moduleinfo.json');
          if (fs.existsSync(mi)) {
            const j = JSON.parse(fs.readFileSync(mi, 'utf8').replace(/^\uFEFF/, ''));
            item.vendor = j['Factory Info']?.Vendor ?? j.Vendor;
            item.category = j.Classes?.[0]?.Category;
          }
        } catch { /* ignore */ }
        out.push(item);
      } else if (e.isDirectory() && depth < 2) walk(p, depth + 1);
    }
  };
  for (const d of vst3Dirs()) walk(d, 0);
  return out;
}

const pluginsTool: ToolDef = {
  name: 'plugins',
  description: 'Third-party plugins. VST3 plugins on this computer are found and listed; hosting them in the audio graph is not available yet (see status).',
  actions: {
    scan: action({ description: 'List VST3 plugins installed in the standard folders.', schema: z.object({}), agent: 'loading', run: () => { const l = scanVst3(); return { summary: `${l.length} VST3 plugins found`, plugins: l, note: 'Found but not hostable yet: use the built-in instruments, or load samples/SoundFonts into a sampler track for recorded sounds.' }; } }),
    status: action({ description: 'What plugin support exists right now.', schema: z.object({}), run: () => ({ summary: 'VST3: scan only', vst3: { scan: true, host: false, reason: 'A native audio-plugin host process is a separate component; the project model and the scanner are in place, hosting is planned.' }, builtin: 'Every built-in instrument and effect runs in the project engine and exports offline.', ffmpeg: findFfmpeg() ? 'installed (used only for decoding/encoding other file formats)' : 'not installed' }) }),
  },
};

export const audioTools: ToolDef[] = [audioTool, midiTool, renderTool, listenTool, sfxTool, pluginsTool];
