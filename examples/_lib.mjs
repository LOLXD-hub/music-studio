// Shared helpers for the example pieces. Every piece is built with the same tool calls an AI agent makes over MCP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/core/tools.ts';

export function open(name) {
  const dataDir = process.env.MSAI_DATA ?? fs.mkdtempSync(path.join(os.tmpdir(), 'msai-ex-'));
  const studio = createStudio({ dataDir });
  const log = [];
  const call = async (tool, args) => {
    const t0 = Date.now();
    const { result, images } = await studio.exec(tool, args, { source: 'mcp', client: 'Claude Code' });
    log.push({ tool, action: args.action, summary: result.summary, ms: Date.now() - t0 });
    if (process.env.VERBOSE) console.log(`> ${tool}.${args.action}: ${result.summary ?? ''}`);
    return { ...result, _images: images };
  };
  return { studio, call, log, name, dataDir };
}

/** Render, analyse, export mp3 + flac + mid + project + spectrogram into examples/music. */
export async function finish({ studio, call, name }, opts = {}) {
  const out = path.resolve(import.meta.dirname, 'music');
  fs.mkdirSync(out, { recursive: true });
  const analysis = await call('listen', { action: 'analyze', save_preview: false, width: 1400 });
  const noNotes = opts.critique === false; // sound-effect projects have no notes to critique
  const crit = noNotes ? { score: null, findings: [], strengths: [] } : await call('critique', { action: 'composition' });
  const mix = noNotes ? { findings: [], tracks: [] } : await call('critique', { action: 'mix' });
  const png = analysis._images?.[0];
  if (png) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(png.base64, 'base64'));
  const norm = opts.lufs ?? -14;
  const mp3 = await call('render', { action: 'mixdown', path: path.join(out, `${name}.mp3`), format: 'mp3', kbps: 192, normalize_lufs: norm });
  const flac = await call('render', { action: 'mixdown', path: path.join(out, `${name}.flac`), format: 'flac', bit_depth: 16, normalize_lufs: norm });
  await call('midi', { action: 'export', path: path.join(out, `${name}.mid`) });
  await call('studio', { action: 'save', path: path.join(out, `${name}.msai`) });
  const report = {
    name,
    duration: analysis.duration,
    loudness: mp3.loudness,
    spectrum: analysis.spectrum,
    stereo: analysis.stereo,
    issues: mp3.issues,
    critic: { score: crit.score, findings: crit.findings, strengths: crit.strengths },
    mix: { findings: mix.findings, tracks: mix.tracks },
  };
  fs.writeFileSync(path.join(out, `${name}.report.json`), JSON.stringify(report, null, 1));
  console.log(`\n${name}: ${analysis.duration}, ${mp3.loudness.integratedLufs} LUFS, true peak ${mp3.loudness.truePeakDb} dBTP`);
  console.log('critic', JSON.stringify(crit.score));
  for (const f of crit.findings) console.log(`  [${f.severity}] ${f.category}${f.track ? '/' + f.track : ''}: ${f.problem}`);
  for (const f of mix.findings) console.log(`  [mix ${f.severity}] ${f.message}`);
  studio.dispose();
  return report;
}
