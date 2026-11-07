// Renders the whole built-in sound-effect library and checks every sound: finite, audible, not clipping,
// sane duration, and not a near-duplicate of a sibling. Pass --out <dir> to write the WAV files too.
import fs from 'node:fs';
import path from 'node:path';
import { buildCatalog, renderSfx, categoryTree } from '../src/sfx/catalog.ts';
import { encodeWav } from '../src/engine/io/wav.ts';

const outIdx = process.argv.indexOf('--out');
const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const entries = buildCatalog();
console.log(`library: ${entries.length} sounds`);
for (const c of categoryTree(entries)) console.log(`  ${c.category.padEnd(20)} ${String(c.count).padStart(4)}  (${c.folders.length} folders)`);

interface Feat { id: string; family: string; dur: number; rms: number; peak: number; cent: number; env: number[] }
const feats: Feat[] = [];
const problems: string[] = [];
const t0 = Date.now();
const SR = 44100;
for (const e of entries) {
  let r: { L: Float32Array; R: Float32Array };
  try {
    r = renderSfx(e, SR);
  } catch (err) {
    problems.push(`${e.id}: threw ${(err as Error).message}`);
    continue;
  }
  const n = r.L.length;
  let pk = 0, sq = 0, bad = 0, zc = 0;
  for (let i = 0; i < n; i++) {
    const a = r.L[i], b = r.R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) bad++;
    pk = Math.max(pk, Math.abs(a), Math.abs(b));
    sq += a * a + b * b;
    if (i && (a >= 0) !== (r.L[i - 1] >= 0)) zc++;
  }
  const dur = n / SR;
  const rms = Math.sqrt(sq / (2 * n));
  const rmsDb = 20 * Math.log10(rms + 1e-9);
  if (bad) problems.push(`${e.id}: ${bad} non-finite samples`);
  if (pk > 1.0001) problems.push(`${e.id}: peak ${pk.toFixed(3)} above full scale`);
  if (pk < 0.05) problems.push(`${e.id}: nearly silent (peak ${pk.toFixed(3)})`);
  if (rmsDb < -48) problems.push(`${e.id}: very quiet (rms ${rmsDb.toFixed(1)} dB)`);
  if (dur < 0.02 || dur > 16) problems.push(`${e.id}: odd duration ${dur.toFixed(2)} s`);
  // coarse feature vector: duration, rms, zero-crossing centroid proxy and 8-bin energy envelope
  const env: number[] = [];
  for (let b = 0; b < 8; b++) {
    let s = 0;
    const a = Math.floor((b * n) / 8), z = Math.floor(((b + 1) * n) / 8);
    for (let i = a; i < z; i++) s += r.L[i] * r.L[i];
    env.push(Math.sqrt(s / Math.max(1, z - a)));
  }
  const m = Math.max(...env, 1e-9);
  feats.push({ id: e.id, family: e.family, dur, rms: rmsDb, peak: pk, cent: (zc / n) * SR * 0.5, env: env.map((x) => x / m) });
  if (outDir) {
    const dir = path.join(outDir, ...e.folder.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, e.name.replace(/[^\w .,-]+/g, '_') + '.wav'), encodeWav([r.L, r.R], SR, 16));
  }
}
// near duplicates inside one family: same duration (+-3%), same centroid (+-4%) and the same envelope shape
const byFam = new Map<string, Feat[]>();
for (const f of feats) byFam.set(f.family, [...(byFam.get(f.family) ?? []), f]);
let dupes = 0;
for (const list of byFam.values()) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const envDist = Math.sqrt(a.env.reduce((s, v, k) => s + (v - b.env[k]) ** 2, 0) / 8);
    if (Math.abs(a.dur - b.dur) / Math.max(a.dur, b.dur) < 0.03 && Math.abs(a.cent - b.cent) / Math.max(a.cent, b.cent, 1) < 0.04 && envDist < 0.04) {
      dupes++;
      if (dupes <= 15) problems.push(`near-duplicate: ${a.id} ~ ${b.id}`);
    }
  }
}
const ms = Date.now() - t0;
const total = feats.reduce((a, f) => a + f.dur, 0);
console.log(`\nrendered ${feats.length} sounds, ${total.toFixed(0)} s of audio in ${(ms / 1000).toFixed(1)} s`);
console.log(`problems: ${problems.length}${dupes ? ` (near-duplicates: ${dupes})` : ''}`);
for (const p of problems.slice(0, 60)) console.log('  -', p);
if (entries.length < 1000) {
  console.log(`FAIL: need at least 1000 sounds, have ${entries.length}`);
  process.exit(1);
}
