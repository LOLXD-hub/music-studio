// The Studio: single source of truth for the open project. The Electron app, the MCP server, the command line and the
// demo scripts all talk to this class, so a person and an agent always see the same state.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { z } from 'zod';
import { newProject, PPQ, MeterMap, TempoMap } from '../engine/project.ts';
import type { AssetRef, Project, Track } from '../engine/project.ts';
import type { AssetBuffer } from '../engine/engine.ts';
import type { AudioReport } from '../engine/analysis/index.ts';
import type { MeterFrame } from '../engine/render.ts';
import { decodeWav, encodeWav } from '../engine/io/wav.ts';
import { decodeAudioFile } from './audioio.ts';
import { SfxLibrary } from './sfxlib.ts';
import { resetIds, nextId } from './ops.ts';
import { encodePng } from './png.ts';

export type Source = 'mcp' | 'ui' | 'cli' | 'script';
export type AgentKind = 'listening' | 'building' | 'loading' | 'thinking' | 'mixing';
export type AgentStateName = 'asleep' | 'idle' | AgentKind;

export interface Ctx {
  studio: Studio;
  source: Source;
  client?: string;
}

export interface ActionDef {
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  mutates?: boolean;
  agent?: AgentKind;
  run: (ctx: Ctx, args: any) => Promise<any> | any;
}

export interface ToolDef {
  name: string;
  description: string;
  actions: Record<string, ActionDef>;
}

export interface Activity {
  id: number;
  ts: number;
  source: Source;
  client?: string;
  tool: string;
  action: string;
  summary: string;
  status: 'running' | 'ok' | 'error';
  ms: number;
  error?: string;
  tracks?: string[];
  /** Index into the history stack before this action, for "revert to before this". */
  rev?: number;
  mutated?: boolean;
}

export interface AgentState {
  state: AgentStateName;
  message: string;
  tool?: string;
  since: number;
  connected: boolean;
  client?: string;
}

export interface FeedbackItem {
  id: number;
  ts: number;
  kind: 'message' | 'pin' | 'rating' | 'edit';
  text: string;
  target?: { track?: string; clip?: string; beat?: number; endBeat?: number; bar?: number };
  rating?: 'like' | 'dislike';
  delivered: boolean;
  reply?: string;
}

export interface RenderOutput {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  durationSec: number;
  tailSec: number;
  renderMs: number;
  report?: AudioReport;
  picture?: { width: number; height: number; png: Buffer; layout: Record<string, unknown> };
  trace?: MeterFrame[];
  trackStats?: Record<string, { rmsDb: number; peakDb: number; lowShare: number; midShare: number; highShare: number }>;
  startBeat: number;
  endBeat: number;
}

export interface RenderRequest {
  startBeat?: number;
  endBeat?: number;
  sampleRate?: number;
  tracks?: string[];
  tailMaxSec?: number;
  analyze?: boolean;
  picture?: boolean;
  pictureWidth?: number;
  meterEverySec?: number;
  trackStats?: boolean;
}

let workerPath: string | null = null;
export function setRenderWorkerPath(p: string): void {
  workerPath = p;
}
function defaultWorker(): string {
  if (workerPath) return workerPath;
  return new URL('./render-worker.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

export interface StudioOptions {
  dataDir?: string;
  autosave?: boolean;
  /** Called to load tool definitions; set by tools.ts to avoid a circular import. */
  tools?: ToolDef[];
}

export class Studio extends EventEmitter {
  project: Project;
  rev = 0;
  readonly assets = new Map<string, { ref: AssetRef; data: AssetBuffer }>();
  readonly dataDir: string;
  projectPath: string | null = null;
  dirty = false;
  activity: Activity[] = [];
  agent: AgentState = { state: 'asleep', message: 'No agent connected', since: Date.now(), connected: false };
  feedback: FeedbackItem[] = [];
  transport = { playing: false, position: 0, uiConnected: false, loop: false };
  readonly sfx: SfxLibrary;
  readonly tools = new Map<string, ToolDef>();
  private history: { label: string; project: Project }[] = [];
  private redoStack: { label: string; project: Project }[] = [];
  private activityId = 1;
  private feedbackId = 1;
  private lastSeen = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pinnedUntil = 0;
  private sigs = new Map<string, string>();
  private metaSig = '';
  private renderCache = new Map<string, RenderOutput>();
  private waiters: ((f: FeedbackItem) => void)[] = [];
  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(o: StudioOptions = {}) {
    super();
    this.setMaxListeners(50);
    this.dataDir = o.dataDir ?? process.env.MSAI_DATA ?? path.join(os.homedir(), 'Music studio');
    for (const d of ['Projects', 'Exports', 'Previews', 'Sound library']) fs.mkdirSync(path.join(this.dataDir, d), { recursive: true });
    this.sfx = new SfxLibrary(path.join(this.dataDir, 'Sound library'));
    this.project = newProject('Untitled');
    resetIds(this.project);
    for (const t of o.tools ?? []) this.tools.set(t.name, t);
    this.presenceTimer = setInterval(() => this.checkPresence(), 5000);
    this.presenceTimer.unref?.();
  }

  dispose(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  // ------------------------------------------------------------------ project state

  /** Run a change atomically on a copy of the project; on success it becomes the project and one undo step is recorded. */
  mutate<T>(label: string, fn: (p: Project) => T): T {
    const draft = structuredClone(this.project);
    const res = fn(draft);
    draft.meta.modified = new Date().toISOString();
    this.history.push({ label, project: this.project });
    if (this.history.length > 40) this.history.shift();
    this.redoStack = [];
    this.project = draft;
    this.rev++;
    this.dirty = true;
    this.renderCache.clear();
    this.emitChange();
    return res;
  }

  /** Change that should not create an undo step (live meters, transport follow, project name typing). */
  mutateQuiet<T>(fn: (p: Project) => T): T {
    const res = fn(this.project);
    this.rev++;
    this.dirty = true;
    this.renderCache.clear();
    this.emitChange();
    return res;
  }

  undo(): string | null {
    const h = this.history.pop();
    if (!h) return null;
    this.redoStack.push({ label: h.label, project: this.project });
    this.project = h.project;
    this.rev++;
    this.dirty = true;
    this.renderCache.clear();
    this.emitChange();
    return h.label;
  }

  redo(): string | null {
    const h = this.redoStack.pop();
    if (!h) return null;
    this.history.push({ label: h.label, project: this.project });
    this.project = h.project;
    this.rev++;
    this.dirty = true;
    this.renderCache.clear();
    this.emitChange();
    return h.label;
  }

  historyLength(): number {
    return this.history.length;
  }

  /** Revert to the state before history entry `index` (as recorded in Activity.rev). */
  revertTo(index: number): void {
    if (index < 0 || index >= this.history.length) throw new Error('That step is no longer in the undo history.');
    const target = this.history[index].project;
    const dropped = this.history.splice(index);
    this.redoStack.push(...dropped.reverse().slice(0, 1).map((d) => ({ label: d.label, project: this.project })));
    this.project = target;
    this.rev++;
    this.dirty = true;
    this.renderCache.clear();
    this.emitChange();
  }

  /** Emit a patch the UI can apply: only the tracks whose content changed. */
  private emitChange(): void {
    const p = this.project;
    const { tracks, ...rest } = p;
    const metaSig = JSON.stringify(rest) + '|' + tracks.map((t) => t.id).join(',');
    const changed: Record<string, Track> = {};
    const seen = new Set<string>();
    for (const t of tracks) {
      seen.add(t.id);
      const sig = JSON.stringify(t);
      if (this.sigs.get(t.id) !== sig) {
        this.sigs.set(t.id, sig);
        changed[t.id] = t;
      }
    }
    const removed: string[] = [];
    for (const id of [...this.sigs.keys()]) if (!seen.has(id)) {
      this.sigs.delete(id);
      removed.push(id);
    }
    const metaChanged = metaSig !== this.metaSig;
    this.metaSig = metaSig;
    this.emit('change', { rev: this.rev, meta: metaChanged ? rest : null, order: tracks.map((t) => t.id), tracks: changed, removed, dirty: this.dirty, history: this.history.length });
  }

  /** Full snapshot for a UI that just connected. */
  snapshot(): { rev: number; project: Project; assets: AssetRef[] } {
    this.sigs.clear();
    this.metaSig = '';
    for (const t of this.project.tracks) this.sigs.set(t.id, JSON.stringify(t));
    const { tracks: _t, ...rest } = this.project;
    this.metaSig = JSON.stringify(rest) + '|' + this.project.tracks.map((t) => t.id).join(',');
    return { rev: this.rev, project: this.project, assets: [...this.assets.values()].map((a) => a.ref) };
  }

  replaceProject(p: Project, assets?: Map<string, { ref: AssetRef; data: AssetBuffer }>, file: string | null = null): void {
    this.project = p;
    this.history = [];
    this.redoStack = [];
    this.assets.clear();
    if (assets) for (const [k, v] of assets) this.assets.set(k, v);
    resetIds(p);
    this.projectPath = file;
    this.dirty = false;
    this.rev++;
    this.renderCache.clear();
    this.sigs.clear();
    this.metaSig = '';
    this.emit('replaced', this.snapshot());
  }

  newProject(name = 'Untitled'): void {
    this.replaceProject(newProject(name));
  }

  // ------------------------------------------------------------------ audio assets

  async importAudio(file: string, opts: { name?: string; source?: AssetRef['source'] } = {}): Promise<AssetRef> {
    const d = await decodeAudioFile(file);
    return this.addAsset(d.channels, d.sampleRate, { name: opts.name ?? path.basename(file, path.extname(file)), path: file, source: opts.source ?? 'import' });
  }

  addAsset(channels: Float32Array[], sampleRate: number, o: { name: string; path?: string; source?: AssetRef['source']; id?: string }): AssetRef {
    const id = o.id ?? nextId('as');
    const ref: AssetRef = { id, name: o.name, sampleRate, channels: channels.length, frames: channels[0].length, path: o.path, source: o.source ?? 'import' };
    this.assets.set(id, { ref, data: { channels, sampleRate } });
    // asset list lives in the project so it survives save/open
    this.project.assets = this.project.assets.filter((a) => a.id !== id);
    this.project.assets.push(ref);
    this.dirty = true;
    this.emit('asset', ref);
    return ref;
  }

  assetBuffers(): Map<string, AssetBuffer> {
    const m = new Map<string, AssetBuffer>();
    for (const [k, v] of this.assets) m.set(k, v.data);
    return m;
  }

  // ------------------------------------------------------------------ files

  async saveProject(file?: string): Promise<string> {
    const target = file ?? this.projectPath ?? path.join(this.dataDir, 'Projects', safeName(this.project.name) + '.msai');
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const assetsDir = target.replace(/\.msai$/i, '') + '.assets';
    const used = new Set<string>();
    for (const t of this.project.tracks) {
      for (const c of t.clips) if (c.kind === 'audio') used.add(c.assetId);
      const zs = (t.instrument as { zones?: { assetId: string }[] } | undefined)?.zones;
      if (zs) for (const z of zs) used.add(z.assetId);
    }
    if (used.size) fs.mkdirSync(assetsDir, { recursive: true });
    for (const id of used) {
      const a = this.assets.get(id);
      if (a) fs.writeFileSync(path.join(assetsDir, id + '.wav'), encodeWav(a.data.channels, a.data.sampleRate, 32));
    }
    const doc = { format: 'music-studio', version: 1, savedAt: new Date().toISOString(), project: { ...this.project, assets: this.project.assets.filter((a) => used.has(a.id)) } };
    fs.writeFileSync(target, JSON.stringify(doc));
    this.projectPath = target;
    this.dirty = false;
    this.emit('saved', target);
    return target;
  }

  async openProject(file: string): Promise<Project> {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc.format !== 'music-studio') throw new Error('This is not a Music studio project file.');
    const p = doc.project as Project;
    const assets = new Map<string, { ref: AssetRef; data: AssetBuffer }>();
    const dir = file.replace(/\.msai$/i, '') + '.assets';
    for (const ref of p.assets ?? []) {
      const f = path.join(dir, ref.id + '.wav');
      if (!fs.existsSync(f)) continue;
      const d = decodeWav(new Uint8Array(fs.readFileSync(f)));
      assets.set(ref.id, { ref, data: { channels: d.channels, sampleRate: d.sampleRate } });
    }
    this.replaceProject(p, assets, file);
    return p;
  }

  // ------------------------------------------------------------------ render and listen

  private runWorker(msg: Record<string, unknown>, onProgress?: (f: number) => void): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const w = new Worker(defaultWorker(), { execArgv: process.versions.electron ? [] : undefined });
      const id = Math.floor(Math.random() * 1e9);
      w.on('message', (m: Record<string, any>) => {
        if (m.progress !== undefined) return onProgress?.(m.progress);
        if (m.error) {
          w.terminate();
          return reject(new Error(m.error));
        }
        w.terminate();
        resolve(m);
      });
      w.on('error', (e) => {
        reject(e);
      });
      w.postMessage({ id, ...msg });
    });
  }

  /** Time positions of every bar start (seconds) inside a beat range, for pictures. */
  barTimes(startBeat: number, endBeat: number): { times: number[]; first: number } {
    const p = this.project;
    const meter = new MeterMap(p.sig);
    const tm = new TempoMap(p.tempo);
    const startTick = startBeat * PPQ;
    const first = meter.position(startTick);
    let bar = Math.ceil(first.beat - 1e-6) === 1 || Math.abs(first.beat - 1) < 1e-6 ? first.bar : first.bar + 1;
    const times: number[] = [];
    const t0 = tm.tickToSec(startTick);
    for (let guard = 0; guard < 4000; guard++, bar++) {
      const tick = meter.tickOf(bar, 1);
      if (tick > endBeat * PPQ + 1e-6) break;
      times.push(tm.tickToSec(tick) - t0);
    }
    return { times, first: bar - times.length };
  }

  async render(req: RenderRequest = {}, onProgress?: (f: number) => void): Promise<RenderOutput> {
    const key = JSON.stringify([this.rev, req]);
    const hit = this.renderCache.get(key);
    if (hit) return hit;
    const p = this.project;
    const tm = new TempoMap(p.tempo);
    const endAuto = Math.max(0, ...p.tracks.flatMap((t) => t.clips.map((c) => (c.start + c.len) / PPQ)));
    const startBeat = req.startBeat ?? 0;
    const endBeat = req.endBeat ?? endAuto;
    if (endBeat <= startBeat) throw new Error('Nothing to render: the project has no clips yet, or the range is empty.');
    const bt = this.barTimes(startBeat, endBeat);
    const job = {
      project: p,
      assets: Object.fromEntries([...this.assets.entries()].map(([k, v]) => [k, v.data])),
      opts: {
        sampleRate: req.sampleRate ?? 44100, startSec: tm.tickToSec(startBeat * PPQ), endSec: tm.tickToSec(endBeat * PPQ),
        tailMaxSec: req.tailMaxSec ?? 6, soloTracks: req.tracks?.length ? req.tracks.map((r) => this.trackId(r)) : undefined, meterEverySec: req.meterEverySec, trackStats: req.trackStats,
      },
      analyze: req.analyze ? { projectBpm: p.tempo[0]?.bpm } : undefined,
      picture: req.picture ? { width: req.pictureWidth ?? 1200, barTimes: bt.times, firstBar: bt.first } : undefined,
    };
    const m = await this.runWorker(job, onProgress);
    const out: RenderOutput = {
      L: m.L, R: m.R, sampleRate: m.sampleRate, durationSec: m.durationSec, tailSec: m.tailSec, renderMs: m.renderMs, report: m.report, trace: m.trace, trackStats: m.trackStats, startBeat, endBeat,
    };
    if (m.picture) out.picture = { width: m.picture.width, height: m.picture.height, png: encodePng({ width: m.picture.width, height: m.picture.height, rgba: m.picture.rgba }), layout: m.picture.layout };
    if (this.renderCache.size > 6) this.renderCache.delete(this.renderCache.keys().next().value as string);
    this.renderCache.set(key, out);
    return out;
  }

  trackId(ref: string): string {
    const t = this.project.tracks.find((x) => x.id === ref) ?? this.project.tracks.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!t) throw new Error(`No track "${ref}".`);
    return t.id;
  }

  // ------------------------------------------------------------------ agent presence, activity, feedback

  private checkPresence(): void {
    const connected = Date.now() - this.lastSeen < 120000 && this.lastSeen > 0;
    if (connected !== this.agent.connected) {
      this.agent = { ...this.agent, connected, state: connected ? 'idle' : 'asleep', message: connected ? 'Connected' : 'No agent connected', since: Date.now() };
      this.emit('agent', this.agent);
    }
  }

  markSeen(client?: string): void {
    this.lastSeen = Date.now();
    if (!this.agent.connected) {
      this.agent = { ...this.agent, connected: true, state: 'idle', message: 'Connected', client, since: Date.now() };
      this.emit('agent', this.agent);
    } else if (client && client !== this.agent.client) {
      this.agent = { ...this.agent, client };
      this.emit('agent', this.agent);
    }
  }

  setAgent(state: AgentStateName, message: string, tool?: string, holdSec = 0): void {
    if (holdSec > 0) this.pinnedUntil = Date.now() + holdSec * 1000;
    else if (Date.now() < this.pinnedUntil && state === 'idle') return;
    this.agent = { ...this.agent, state, message, tool, since: Date.now() };
    this.emit('agent', this.agent);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (state !== 'idle' && state !== 'asleep') {
      this.idleTimer = setTimeout(() => {
        if (Date.now() < this.pinnedUntil) return;
        this.agent = { ...this.agent, state: this.agent.connected ? 'idle' : 'asleep', message: this.agent.connected ? 'Waiting' : 'No agent connected', tool: undefined, since: Date.now() };
        this.emit('agent', this.agent);
      }, Math.max(1800, holdSec * 1000));
    }
  }

  logActivity(a: Omit<Activity, 'id' | 'ts'>): Activity {
    const act: Activity = { ...a, id: this.activityId++, ts: Date.now() };
    this.activity.push(act);
    if (this.activity.length > 600) this.activity.splice(0, this.activity.length - 600);
    this.emit('activity', act);
    return act;
  }

  updateActivity(act: Activity, patch: Partial<Activity>): void {
    Object.assign(act, patch);
    this.emit('activity', act);
  }

  addFeedback(f: Omit<FeedbackItem, 'id' | 'ts' | 'delivered'>): FeedbackItem {
    const item: FeedbackItem = { ...f, id: this.feedbackId++, ts: Date.now(), delivered: false };
    this.feedback.push(item);
    this.emit('feedback', item);
    const w = this.waiters.splice(0);
    for (const fn of w) fn(item);
    return item;
  }

  takeFeedback(markDelivered = true): FeedbackItem[] {
    const items = this.feedback.filter((f) => !f.delivered);
    if (markDelivered) for (const f of items) f.delivered = true;
    if (items.length && markDelivered) this.emit('feedback', null);
    return items;
  }

  waitForFeedback(timeoutMs: number): Promise<FeedbackItem | null> {
    const pending = this.feedback.find((f) => !f.delivered);
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== fn);
        resolve(null);
      }, timeoutMs);
      const fn = (f: FeedbackItem) => {
        clearTimeout(t);
        resolve(f);
      };
      this.waiters.push(fn);
    });
  }

  reportTransport(t: { playing?: boolean; position?: number; loop?: boolean; uiConnected?: boolean }): void {
    Object.assign(this.transport, t);
    this.emit('transport-state', this.transport);
  }

  // ------------------------------------------------------------------ tools

  registerTools(tools: ToolDef[]): void {
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Execute one tool action. Used by MCP, the command line and the UI alike. */
  async exec(tool: string, args: Record<string, any> = {}, opts: { source?: Source; client?: string } = {}): Promise<{ result: any; images: { mime: string; base64: string; caption?: string }[] }> {
    const source = opts.source ?? 'script';
    const def = this.tools.get(tool);
    if (!def) throw new Error(`Unknown tool "${tool}". Tools: ${[...this.tools.keys()].join(', ')}.`);
    const action = (args.action as string | undefined) ?? Object.keys(def.actions)[0];
    const ad = def.actions[action];
    if (!ad) throw new Error(`Tool ${tool} has no action "${action}". Actions: ${Object.keys(def.actions).join(', ')}.`);
    if (source === 'mcp') this.markSeen(opts.client);
    const t0 = Date.now();
    const act = this.logActivity({ source, client: opts.client, tool, action, summary: `${tool}.${action}`, status: 'running', ms: 0, rev: this.history.length });
    if (source === 'mcp' && ad.agent) this.setAgent(ad.agent, `${tool} ${action}`, tool);
    try {
      const { action: _a, ...rest } = args;
      const parsed = ad.schema.safeParse(rest);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ');
        throw new Error(`Invalid arguments for ${tool}.${action}: ${issues}. Call studio {action:"help", tool:"${tool}", topic:"${action}"} for the full schema.`);
      }
      const before = this.rev;
      const raw = await ad.run({ studio: this, source, client: opts.client }, parsed.data);
      const result: Record<string, any> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { result: raw };
      const images = (result._images as { mime: string; base64: string; caption?: string }[] | undefined) ?? [];
      delete result._images;
      const summary = typeof result.summary === 'string' ? result.summary : `${tool}.${action}`;
      const touched = this.rev !== before;
      this.updateActivity(act, { status: 'ok', ms: Date.now() - t0, summary, mutated: touched, tracks: result._tracks });
      delete result._tracks;
      if (source === 'mcp') this.setAgent(this.agent.state === 'idle' ? 'idle' : this.agent.state, this.agent.message, tool);
      return { result, images };
    } catch (e) {
      const msg = (e as Error).message;
      this.updateActivity(act, { status: 'error', ms: Date.now() - t0, error: msg, summary: `${tool}.${action} failed` });
      throw e;
    }
  }
}

export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim().slice(0, 80) || 'Untitled';
}
