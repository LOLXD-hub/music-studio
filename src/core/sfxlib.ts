// The sound library manager: 1000+ built-in synthesized effects plus the user's own sounds.
// Built-ins are recipes (family + parameters), so "editing" one changes its parameters and an edit chain;
// nothing is copied from disk until a sound is exported or placed in a project.

import fs from 'node:fs';
import path from 'node:path';
import { buildCatalog, renderSfx, applyEdit, getFamily, categoryTree } from '../sfx/catalog.ts';
import type { SfxEdit, SfxEntry } from '../sfx/catalog.ts';
import { decodeAudioFile } from './audioio.ts';
import { encodeWav } from '../engine/io/wav.ts';

export interface SfxItem {
  id: string;
  name: string;
  category: string;
  folder: string;
  tags: string[];
  source: 'builtin' | 'user';
  kind: 'synth' | 'file';
  family?: string;
  params?: Record<string, number>;
  edit?: SfxEdit;
  favorite: boolean;
  /** Duration in seconds once known. */
  duration?: number;
}

interface UserItem {
  id: string;
  name: string;
  category: string;
  folder: string;
  tags: string[];
  kind: 'synth' | 'file';
  file?: string;
  family?: string;
  params?: Record<string, number>;
  seed?: number;
  edit?: SfxEdit;
}

interface Store {
  items: UserItem[];
  hidden: string[];
  overrides: Record<string, { params?: Record<string, number>; edit?: SfxEdit; name?: string; tags?: string[]; folder?: string }>;
  favorites: string[];
}

export class SfxLibrary {
  private store: Store = { items: [], hidden: [], overrides: {}, favorites: [] };
  private builtin = buildCatalog();
  private builtinById = new Map(this.builtin.map((e) => [e.id, e]));
  private cache = new Map<string, { L: Float32Array; R: Float32Array; sr: number }>();
  private storeFile: string;
  private filesDir: string;
  private nextUser = 1;
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.storeFile = path.join(dir, 'library.json');
    this.filesDir = path.join(dir, 'files');
    fs.mkdirSync(this.filesDir, { recursive: true });
    if (fs.existsSync(this.storeFile)) {
      try {
        this.store = { ...this.store, ...JSON.parse(fs.readFileSync(this.storeFile, 'utf8')) };
      } catch { /* keep defaults */ }
    }
    for (const it of this.store.items) {
      const m = /^u(\d+)$/.exec(it.id);
      if (m) this.nextUser = Math.max(this.nextUser, parseInt(m[1], 10) + 1);
    }
  }

  private save(): void {
    fs.writeFileSync(this.storeFile, JSON.stringify(this.store, null, 1));
  }

  private toItem(e: SfxEntry): SfxItem {
    const o = this.store.overrides[e.id];
    return {
      id: e.id, name: o?.name ?? e.name, category: e.category, folder: o?.folder ?? e.folder, tags: o?.tags ?? e.tags,
      source: 'builtin', kind: 'synth', family: e.family, params: { ...e.params, ...(o?.params ?? {}) }, edit: o?.edit,
      favorite: this.store.favorites.includes(e.id),
    };
  }

  private userToItem(u: UserItem): SfxItem {
    return { id: u.id, name: u.name, category: u.category, folder: u.folder, tags: u.tags, source: 'user', kind: u.kind, family: u.family, params: u.params, edit: u.edit, favorite: this.store.favorites.includes(u.id) };
  }

  count(): { total: number; builtin: number; user: number; hidden: number } {
    return { total: this.builtin.length - this.store.hidden.length + this.store.items.length, builtin: this.builtin.length - this.store.hidden.length, user: this.store.items.length, hidden: this.store.hidden.length };
  }

  all(): SfxItem[] {
    const hidden = new Set(this.store.hidden);
    return [...this.builtin.filter((e) => !hidden.has(e.id)).map((e) => this.toItem(e)), ...this.store.items.map((u) => this.userToItem(u))];
  }

  categories() {
    return categoryTree(this.all());
  }

  search(o: { query?: string; category?: string; folder?: string; tags?: string[]; source?: string; favorites?: boolean; limit?: number; offset?: number }): { total: number; items: SfxItem[] } {
    let list = this.all();
    if (o.category) list = list.filter((i) => i.category.toLowerCase() === o.category!.toLowerCase());
    if (o.folder) list = list.filter((i) => i.folder.toLowerCase().includes(o.folder!.toLowerCase()));
    if (o.source) list = list.filter((i) => i.source === o.source);
    if (o.favorites) list = list.filter((i) => i.favorite);
    if (o.tags?.length) list = list.filter((i) => o.tags!.every((t) => i.tags.some((x) => x.toLowerCase().includes(t.toLowerCase()))));
    if (o.query) {
      const terms = o.query.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((i) => {
        const hay = `${i.name} ${i.category} ${i.folder} ${i.tags.join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const off = o.offset ?? 0;
    return { total: list.length, items: list.slice(off, off + (o.limit ?? 50)) };
  }

  get(id: string): SfxItem {
    const b = this.builtinById.get(id);
    if (b && !this.store.hidden.includes(id)) return this.toItem(b);
    const u = this.store.items.find((x) => x.id === id);
    if (u) return this.userToItem(u);
    throw new Error(`No sound "${id}". Use sfx action "search" to find ids.`);
  }

  async render(id: string, sr = 44100): Promise<{ L: Float32Array; R: Float32Array; sr: number }> {
    const key = `${id}@${sr}:${JSON.stringify(this.store.overrides[id] ?? '')}:${JSON.stringify(this.store.items.find((x) => x.id === id)?.edit ?? '')}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const item = this.get(id);
    let L: Float32Array;
    let R: Float32Array;
    let outSr = sr;
    if (item.kind === 'synth') {
      const seed = this.builtinById.get(id)?.seed ?? this.store.items.find((x) => x.id === id)?.seed ?? 1;
      const r = renderSfx({ family: item.family!, params: item.params ?? {}, seed }, sr);
      L = r.L;
      R = r.R;
    } else {
      const u = this.store.items.find((x) => x.id === id)!;
      const d = await decodeAudioFile(path.join(this.filesDir, u.file!));
      L = d.channels[0];
      R = d.channels[1] ?? d.channels[0];
      outSr = d.sampleRate;
    }
    if (item.edit && Object.keys(item.edit).length) {
      const r = applyEdit(L, R, outSr, item.edit);
      L = r.L;
      R = r.R;
    }
    const out = { L, R, sr: outSr };
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, out);
    return out;
  }

  async importFile(file: string, o: { name?: string; category?: string; folder?: string; tags?: string[] } = {}): Promise<SfxItem> {
    const d = await decodeAudioFile(file);
    const id = 'u' + this.nextUser++;
    const base = path.basename(file, path.extname(file));
    const target = `${id}.wav`;
    const L = d.channels[0];
    const R = d.channels[1] ?? d.channels[0];
    fs.writeFileSync(path.join(this.filesDir, target), encodeWav([L, R], d.sampleRate, 24));
    const category = o.category ?? 'My Sounds';
    const u: UserItem = { id, name: o.name ?? base, category, folder: o.folder ?? `${category}/Imported`, tags: o.tags ?? ['imported'], kind: 'file', file: target };
    this.store.items.push(u);
    this.save();
    return this.userToItem(u);
  }

  /** Store a rendered buffer (a bounce from the project, or an edited copy) as a user sound. */
  addBuffer(L: Float32Array, R: Float32Array, sr: number, o: { name: string; category?: string; folder?: string; tags?: string[] }): SfxItem {
    const id = 'u' + this.nextUser++;
    const target = `${id}.wav`;
    fs.writeFileSync(path.join(this.filesDir, target), encodeWav([L, R], sr, 24));
    const category = o.category ?? 'My Sounds';
    const u: UserItem = { id, name: o.name, category, folder: o.folder ?? `${category}/Created`, tags: o.tags ?? ['created'], kind: 'file', file: target };
    this.store.items.push(u);
    this.save();
    return this.userToItem(u);
  }

  /** New synthesized sound from a family and parameters. */
  addSynth(o: { family: string; params?: Record<string, number>; name?: string; category?: string; folder?: string; tags?: string[]; seed?: number }): SfxItem {
    const f = getFamily(o.family);
    if (!f) throw new Error(`Unknown sound family "${o.family}". Families: ${this.families().map((x) => x.id).join(', ')}.`);
    const params: Record<string, number> = {};
    for (const p of f.params) params[p.k] = o.params?.[p.k] ?? +((p.min + p.max) / 2).toFixed(3);
    const id = 'u' + this.nextUser++;
    const u: UserItem = {
      id, name: o.name ?? `${f.title} (custom)`, category: o.category ?? 'My Sounds', folder: o.folder ?? `${o.category ?? 'My Sounds'}/Synthesized`,
      tags: o.tags ?? [...f.tags, 'custom'], kind: 'synth', family: f.id, params, seed: o.seed ?? 1000 + this.nextUser,
    };
    this.store.items.push(u);
    this.save();
    return this.userToItem(u);
  }

  families() {
    return buildCatalogFamilies();
  }

  /** Change parameters, edit chain, name, tags or folder. Built-ins keep their original; the change is an override. */
  edit(id: string, o: { params?: Record<string, number>; edit?: SfxEdit; name?: string; tags?: string[]; folder?: string; reset?: boolean }): SfxItem {
    this.get(id);
    const cacheKeys = [...this.cache.keys()].filter((k) => k.startsWith(id + '@'));
    for (const k of cacheKeys) this.cache.delete(k);
    const u = this.store.items.find((x) => x.id === id);
    if (u) {
      if (o.params) u.params = { ...(u.params ?? {}), ...o.params };
      if (o.edit) u.edit = o.reset ? o.edit : { ...(u.edit ?? {}), ...o.edit };
      if (o.name) u.name = o.name;
      if (o.tags) u.tags = o.tags;
      if (o.folder) {
        u.folder = o.folder;
        u.category = o.folder.split('/')[0];
      }
    } else {
      if (o.reset) delete this.store.overrides[id];
      const cur = this.store.overrides[id] ?? {};
      this.store.overrides[id] = {
        ...cur,
        ...(o.params ? { params: { ...(cur.params ?? {}), ...o.params } } : {}),
        ...(o.edit ? { edit: o.reset ? o.edit : { ...(cur.edit ?? {}), ...o.edit } } : {}),
        ...(o.name ? { name: o.name } : {}),
        ...(o.tags ? { tags: o.tags } : {}),
        ...(o.folder ? { folder: o.folder } : {}),
      };
    }
    this.save();
    return this.get(id);
  }

  /** Remove a sound. User sounds are deleted; built-ins are hidden and can be restored. */
  remove(id: string): { deleted: boolean; hidden: boolean } {
    const u = this.store.items.findIndex((x) => x.id === id);
    if (u >= 0) {
      const item = this.store.items[u];
      if (item.file) fs.rmSync(path.join(this.filesDir, item.file), { force: true });
      this.store.items.splice(u, 1);
      this.save();
      return { deleted: true, hidden: false };
    }
    if (!this.builtinById.has(id)) throw new Error(`No sound "${id}".`);
    if (!this.store.hidden.includes(id)) this.store.hidden.push(id);
    this.save();
    return { deleted: false, hidden: true };
  }

  restore(id?: string): number {
    if (id) {
      const n = this.store.hidden.length;
      this.store.hidden = this.store.hidden.filter((x) => x !== id);
      this.save();
      return n - this.store.hidden.length;
    }
    const n = this.store.hidden.length;
    this.store.hidden = [];
    this.save();
    return n;
  }

  favorite(id: string, on: boolean): void {
    this.get(id);
    this.store.favorites = this.store.favorites.filter((x) => x !== id);
    if (on) this.store.favorites.push(id);
    this.save();
  }

  hiddenIds(): string[] {
    return [...this.store.hidden];
  }
}

import { SFX_FAMILIES } from '../sfx/families.ts';
function buildCatalogFamilies() {
  return SFX_FAMILIES.map((f) => ({ id: f.id, title: f.title, category: f.category, folder: f.folder, variants: f.variants, params: f.params.map((p) => ({ k: p.k, min: p.min, max: p.max, lo: p.lo, hi: p.hi })) }));
}
