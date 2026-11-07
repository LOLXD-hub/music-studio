import { SFX_FAMILIES } from './families.ts';
import type { Family, PDef } from './families.ts';
import { renderRecipe } from './synth.ts';
import { Rng, dbToGain } from '../engine/dsp/core.ts';
import { createFx } from '../engine/fx/index.ts';

export interface SfxEntry {
  id: string;
  name: string;
  category: string;
  /** Slash-separated folder path, starts with the category. */
  folder: string;
  family: string;
  tags: string[];
  params: Record<string, number>;
  seed: number;
}

export interface SfxEdit {
  /** dB */
  gain?: number;
  trimStart?: number;
  trimEnd?: number;
  fadeIn?: number;
  fadeOut?: number;
  reverse?: boolean;
  /** Semitones, varispeed (changes length). */
  pitch?: number;
  lp?: number;
  hp?: number;
  reverb?: number;
  drive?: number;
  echo?: number;
  /** Peak normalize to this dBFS after all edits. */
  normalize?: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function sampleParams(f: Family, i: number): { params: Record<string, number>; labels: string[] } {
  const params: Record<string, number> = {};
  const dev: { label: string; d: number }[] = [];
  f.params.forEach((pd: PDef, j) => {
    const rng = new Rng(hash(f.id + ':' + pd.k) + 7919);
    // stratified: a seeded permutation of strata so every part of the range is used once per family
    const idx = Array.from({ length: f.variants }, (_, k) => k);
    for (let k = idx.length - 1; k > 0; k--) {
      const r = rng.int(k + 1);
      [idx[k], idx[r]] = [idx[r], idx[k]];
    }
    const u = (idx[i] + new Rng(hash(f.id + pd.k + i)).next()) / f.variants;
    let v = pd.log ? pd.min * Math.pow(pd.max / pd.min, u) : pd.min + (pd.max - pd.min) * u;
    if (pd.int) v = Math.round(v);
    params[pd.k] = +v.toFixed(4);
    if (pd.int && pd.max - pd.min < 3) return;
    const dd = Math.abs(u - 0.5);
    if (dd > 0.2) dev.push({ label: u < 0.5 ? pd.lo : pd.hi, d: dd });
    void j;
  });
  dev.sort((a, b) => b.d - a.d);
  const labels = dev.slice(0, 2).map((d) => d.label);
  return { params, labels };
}

let cache: SfxEntry[] | null = null;

/** The built-in library. Deterministic: ids and parameters never change between runs. */
export function buildCatalog(): SfxEntry[] {
  if (cache) return cache;
  const out: SfxEntry[] = [];
  for (const f of SFX_FAMILIES) {
    for (let i = 0; i < f.variants; i++) {
      const id = `${f.id}-${pad2(i + 1)}`;
      if (f.fixed) {
        out.push({ id, name: f.fixed[i].name, category: f.category, folder: f.folder, family: f.id, tags: f.tags, params: f.fixed[i].params, seed: hash(id) });
        continue;
      }
      const { params, labels } = sampleParams(f, i);
      const name = `${f.title}${labels.length ? ' - ' + labels.join(', ') : ''} ${pad2(i + 1)}`;
      out.push({ id, name, category: f.category, folder: f.folder, family: f.id, tags: [...f.tags, ...labels], params, seed: hash(id) });
    }
  }
  cache = out;
  return out;
}

export function getFamily(id: string): Family | undefined {
  return SFX_FAMILIES.find((f) => f.id === id);
}

/** Parameter definitions for the editor UI. */
export function familyParams(familyId: string): PDef[] {
  return getFamily(familyId)?.params ?? [];
}

export function renderSfx(entry: Pick<SfxEntry, 'family' | 'params' | 'seed'>, sr = 44100, overrides?: Record<string, number>): { L: Float32Array; R: Float32Array } {
  const f = getFamily(entry.family);
  if (!f) throw new Error(`Unknown sound family ${entry.family}`);
  const p = { ...entry.params, ...(overrides ?? {}) };
  if (f.custom) return f.custom(p, sr, entry.seed);
  return renderRecipe(f.build!(p), sr, entry.seed);
}

/** Non-destructive edits applied on top of a rendered or imported sound. */
export function applyEdit(L: Float32Array, R: Float32Array, sr: number, e: SfxEdit): { L: Float32Array; R: Float32Array } {
  let l: Float32Array = L;
  let r: Float32Array = R;
  if (e.pitch) {
    const ratio = Math.pow(2, e.pitch / 12);
    const n = Math.max(8, Math.floor(l.length / ratio));
    const nl = new Float32Array(n);
    const nr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const a = Math.max(0, i0 - 1), b = i0, c = Math.min(l.length - 1, i0 + 1), d = Math.min(l.length - 1, i0 + 2);
      const cub = (x: Float32Array) => x[b] + 0.5 * f * (x[c] - x[a] + f * (2 * x[a] - 5 * x[b] + 4 * x[c] - x[d] + f * (3 * (x[b] - x[c]) + x[d] - x[a])));
      nl[i] = cub(l);
      nr[i] = cub(r);
    }
    l = nl;
    r = nr;
  }
  if (e.reverse) {
    l = Float32Array.from(l).reverse();
    r = Float32Array.from(r).reverse();
  }
  if (e.trimStart || e.trimEnd) {
    const a = Math.max(0, Math.round((e.trimStart ?? 0) * sr));
    const b = e.trimEnd ? Math.min(l.length, Math.round(e.trimEnd * sr)) : l.length;
    if (b > a + 4) {
      l = l.slice(a, b);
      r = r.slice(a, b);
    }
  }
  l = Float32Array.from(l);
  r = Float32Array.from(r);
  const chain: ReturnType<typeof createFx>[] = [];
  if (e.hp) chain.push(createFx('eq', sr, { hp: e.hp }));
  if (e.lp) chain.push(createFx('eq', sr, { lp: e.lp }));
  if (e.drive) chain.push(createFx('distortion', sr, { drive: e.drive, output: -e.drive * 0.4 }));
  if (e.echo) chain.push(createFx('delay', sr, { time_l: 220, time_r: 260, feedback: 0.35, mix: e.echo }));
  let tail = 0;
  if (e.reverb) {
    chain.push(createFx('reverb', sr, { decay: 1.6, mix: e.reverb, size: 1.1 }));
    tail = Math.round(1.8 * sr);
  }
  if (e.echo) tail = Math.max(tail, Math.round(1.2 * sr));
  if (tail) {
    const nl = new Float32Array(l.length + tail);
    const nr = new Float32Array(r.length + tail);
    nl.set(l);
    nr.set(r);
    l = nl;
    r = nr;
  }
  for (const fx of chain) {
    if (!fx) continue;
    for (let i = 0; i < l.length; i += 512) {
      const end = Math.min(l.length, i + 512);
      fx.process(l.subarray(i, end), r.subarray(i, end), 0, end - i);
    }
  }
  const fi = Math.round((e.fadeIn ?? 0) * sr);
  const fo = Math.round((e.fadeOut ?? 0.004) * sr);
  for (let i = 0; i < Math.min(fi, l.length); i++) {
    const g = i / fi;
    l[i] *= g;
    r[i] *= g;
  }
  for (let i = 0; i < Math.min(fo, l.length); i++) {
    const g = i / fo;
    l[l.length - 1 - i] *= g;
    r[r.length - 1 - i] *= g;
  }
  const gain = e.gain ? dbToGain(e.gain) : 1;
  let g = gain;
  if (e.normalize !== undefined) {
    let pk = 0;
    for (let i = 0; i < l.length; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
    if (pk > 1e-6) g = dbToGain(e.normalize) / pk * (e.gain ? gain : 1);
  }
  if (g !== 1) for (let i = 0; i < l.length; i++) { l[i] *= g; r[i] *= g; }
  return { L: l, R: r };
}

export function categoryTree(entries: Pick<SfxEntry, 'category' | 'folder'>[]): { category: string; folders: { folder: string; count: number }[]; count: number }[] {
  const cats = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!cats.has(e.category)) cats.set(e.category, new Map());
    const m = cats.get(e.category)!;
    m.set(e.folder, (m.get(e.folder) ?? 0) + 1);
  }
  return [...cats.entries()].map(([category, m]) => ({ category, folders: [...m.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder)), count: [...m.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => a.category.localeCompare(b.category));
}
