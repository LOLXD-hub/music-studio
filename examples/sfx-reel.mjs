// A reel of sound effects from the built-in library: two sounds from every folder that has enough variety,
// placed one after another on an audio track and mixed down. The effects are synthesized by the app; nothing is sampled.
import { open, finish } from './_lib.mjs';

const { studio, call, name } = open('sfx-reel');
await call('studio', { action: 'new', name: 'Sound effects reel', tempo: 60 });
await call('agent', { action: 'brief', title: 'Sound effects reel', genre: 'Library demo', mood: 'neutral', tempo: 60, notes: 'One sound from each of 40 folders, in order, with a short gap between them. At 60 bpm one beat is one second.' });

const tree = (await call('sfx', { action: 'categories' })).tree;
const folders = tree.flatMap((c) => c.folders.map((f) => ({ category: c.category, folder: f.folder, count: f.count })));
// spread over the categories: at most 3 folders from each, first folder with several variants first
const per = new Map();
const picks = [];
for (const f of folders.sort((a, b) => b.count - a.count)) {
  const n = per.get(f.category) ?? 0;
  if (n >= 3) continue;
  per.set(f.category, n + 1);
  picks.push(f);
}
picks.sort((a, b) => a.category.localeCompare(b.category) || a.folder.localeCompare(b.folder));

let t = 0;
const placed = [];
for (const f of picks.slice(0, 44)) {
  const found = await call('sfx', { action: 'search', folder: f.folder, limit: 6 });
  if (!found.items.length) continue;
  const item = found.items[Math.min(2, found.items.length - 1)];
  const r = await call('sfx', { action: 'place', id: item.id, at: t, gain: -3 });
  const sec = +(/\(([\d.]+) s\)/.exec(r.summary)?.[1] ?? 1.5);
  const len = Math.min(sec, 4);
  placed.push({ at: t, name: item.name, folder: f.folder, seconds: sec });
  t += len + 0.35;
  if (placed.length >= 40) break;
}
console.log(`placed ${placed.length} sounds, ${t.toFixed(1)} s`);
for (const p of placed) console.log(`${String(p.at.toFixed(1)).padStart(6)}  ${p.folder} / ${p.name}`);

await call('effects', { action: 'add', track: 'master', type: 'limiter', preset: 'Transparent' });
await finish({ studio, call, name }, { lufs: -16, critique: false });
process.exit(0);
