// Drives the Studio through the same tool calls an agent would make, renders, analyses, critiques, exports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/core/tools.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msai-'));
const s = createStudio({ dataDir: dir });
const call = async (tool: string, args: Record<string, unknown>) => {
  try {
    const { result, images } = await s.exec(tool, args, { source: 'script' });
    console.log(`> ${tool}.${args.action}: ${(result as { summary?: string }).summary ?? ''}${images.length ? ` [+${images.length} image]` : ''}`);
    return result as Record<string, any>;
  } catch (e) {
    console.log(`! ${tool}.${args.action}: ${(e as Error).message}`);
    throw e;
  }
};

await call('studio', { action: 'new', name: 'Flow test', tempo: 92, key: 'A minor' });
const prog = await call('theory', { action: 'progression', key: 'A minor', bars: 8, style: 'cinematic', mood: 'dark', count: 1, cadence: 'authentic' });
const chords = prog.options[0].chords as string;
await call('tracks', { action: 'add', name: 'Piano', instrument: 'piano', preset: 'Felt / mellow', vol: -4 });
await call('tracks', { action: 'add', name: 'Strings', instrument: 'wind_string', preset: 'Cellos (section)', vol: -8 });
await call('tracks', { action: 'add', name: 'Bass', instrument: 'plucked', preset: 'Finger bass', vol: -6 });
await call('tracks', { action: 'add', name: 'Drums', instrument: 'drums', preset: 'Acoustic kit', vol: -7 });
await call('tracks', { action: 'add', name: 'Lead', instrument: 'wind_string', preset: 'Violin (solo)', vol: -6 });
await call('tracks', { action: 'add', name: 'Hall', kind: 'bus' });
await call('effects', { action: 'add', track: 'Hall', type: 'reverb', preset: 'Concert hall', params: { mix: 1 } });
for (const t of ['Piano', 'Strings', 'Lead']) await call('effects', { action: 'send', track: t, to: 'Hall', level: -10 });
await call('compose', { action: 'chords', track: 'Piano', progression: chords, bars: 8, style: 'ballad', voices: 4 });
await call('compose', { action: 'chords', track: 'Strings', style: 'sustain', voices: 3, range_lo: 'A2', range_hi: 'E4' });
await call('compose', { action: 'bass', track: 'Bass', style: 'root-fifth' });
await call('compose', { action: 'drums', track: 'Drums', style: 'half', sections: [{ bars: 4, intensity: 0.3 }, { bars: 4, intensity: 0.8, ride: true }] });
await call('compose', { action: 'melody', track: 'Lead', start: '3:1', bars: 6, density: 0.4, contour: 'arch', seed: 7 });
for (const t of ['Piano', 'Strings', 'Bass', 'Drums', 'Lead']) await call('compose', { action: 'perform', track: t });
const notes = await call('notes', { action: 'get', track: 'Lead', from: '3:1', to: '5:1' });
console.log(notes.text);
const crit = await call('critique', { action: 'composition' });
console.log(JSON.stringify(crit.score), crit.findings.map((f: any) => `[${f.severity}] ${f.problem}`).slice(0, 6).join('\n'));
const l = await call('listen', { action: 'analyze' });
console.log('LUFS', l.loudness.integratedLufs, 'peak', l.loudness.truePeakDb, 'issues', l.issues.length);
const mix = await call('critique', { action: 'mix' });
console.log(mix.findings.map((f: any) => f.message).join('\n'));
await call('render', { action: 'mixdown', path: path.join(dir, 'out.flac'), format: 'flac', bit_depth: 16 });
await call('render', { action: 'mixdown', path: path.join(dir, 'out.mp3'), format: 'mp3', kbps: 192 });
await call('midi', { action: 'export', path: path.join(dir, 'out.mid') });
await call('sfx', { action: 'search', query: 'laser', limit: 3 });
await call('sfx', { action: 'place', id: 'laser-03', at: '5:1' });
await call('studio', { action: 'save', path: path.join(dir, 'flow.msai') });
await call('studio', { action: 'open', path: path.join(dir, 'flow.msai') });
const st = await call('studio', { action: 'status' });
console.log(st.tracks.map((t: any) => `${t.name}: ${t.notes} notes, ${t.clips} clips`).join(' | '));
for (const f of fs.readdirSync(dir)) console.log(f, fs.statSync(path.join(dir, f)).size);
s.dispose();
console.log('ok');
process.exit(0);
