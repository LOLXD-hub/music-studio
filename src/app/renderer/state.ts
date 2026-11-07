import { useEffect, useRef, useState } from 'preact/hooks';
import { newProject, PPQ, TempoMap, MeterMap } from '../../engine/project.ts';
import type { AssetRef, Project, Track } from '../../engine/project.ts';
import type { Activity, AgentState, FeedbackItem } from '../../core/studio.ts';

type Listener = () => void;

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      subs.forEach((l) => l());
    },
    subscribe(l: Listener) {
      subs.add(l);
      return () => subs.delete(l);
    },
  };
}

export function useStore<T extends object, S>(store: ReturnType<typeof createStore<T>>, sel: (s: T) => S): S {
  const [, force] = useState(0);
  const last = useRef<S>(sel(store.get()));
  const selRef = useRef(sel);
  selRef.current = sel;
  last.current = sel(store.get());
  useEffect(() => {
    return store.subscribe(() => {
      const next = selRef.current(store.get());
      if (!Object.is(next, last.current)) {
        last.current = next;
        force((n) => n + 1);
      }
    });
  }, [store]);
  return last.current;
}

export const projectStore = createStore({
  project: newProject('Untitled') as Project,
  rev: 0,
  assets: [] as AssetRef[],
  historyLength: 0,
  dirty: false,
  projectPath: null as string | null,
});

export type Mode = 'studio' | 'sfx' | 'live';
export type Dock = 'roll' | 'mixer';

export type AppName = 'Music studio' | 'Claude music';
export const APP_NAMES: AppName[] = ['Music studio', 'Claude music'];

function loadAppName(): AppName {
  try {
    const v = localStorage.getItem('msai.appName');
    if (v === 'Claude music') return v;
  } catch { /* storage can be unavailable */ }
  return 'Music studio';
}

export function setAppName(n: AppName): void {
  try { localStorage.setItem('msai.appName', n); } catch { /* ignore */ }
  document.title = n;
  uiStore.set({ appName: n });
}

export const uiStore = createStore({
  appName: loadAppName() as AppName,
  showSettings: false,
  mode: 'studio' as Mode,
  dock: 'roll' as Dock,
  browserTab: 'instruments' as 'instruments' | 'effects' | 'files' | 'plugins',
  selTrack: null as string | null,
  selClip: null as { track: string; clip: string } | null,
  pxPerBeat: 26,
  snap: 0.25,
  pinMode: false,
  showConnect: false,
  showExport: false,
  fxEditor: null as { track: string; fx: string } | null,
  instEditor: null as string | null,
  endpoint: { url: '', token: '' },
  dataDir: '',
  version: '',
  sfxCounts: { total: 0, builtin: 0, user: 0, hidden: 0 },
  catalog: null as null | { instruments: any[]; effects: any[]; sfxFamilies: Record<string, any[]> },
  toasts: [] as { id: number; text: string; err?: boolean }[],
  tools: {} as Record<string, string[]>,
});

export const agentStore = createStore({
  agent: { state: 'asleep', message: 'No agent connected', since: Date.now(), connected: false } as AgentState,
  activity: [] as Activity[],
  feedback: [] as FeedbackItem[],
  touched: {} as Record<string, number>,
  fresh: {} as Record<string, number>,
});

export const transportStore = createStore({ playing: false, position: 0, loop: false });

/** Mutable meter data, written by the audio bridge and read by canvases and meters without re-rendering. */
export const meters = {
  tracks: {} as Record<string, { peakL: number; peakR: number; rms: number }>,
  master: { peakL: 0, peakR: 0, rms: 0 },
  gr: {} as Record<string, number>,
  load: 0,
  listeners: new Set<() => void>(),
  emit() {
    this.listeners.forEach((l) => l());
  },
};

// ---------------------------------------------------------------- time helpers

let tmCache: { key: unknown; tm: TempoMap } | null = null;
export function tempoMap(p: Project): TempoMap {
  if (!tmCache || tmCache.key !== p.tempo) tmCache = { key: p.tempo, tm: new TempoMap(p.tempo) };
  return tmCache.tm;
}

export const secToBeats = (p: Project, sec: number): number => tempoMap(p).secToTick(sec) / PPQ;
export const beatsToSec = (p: Project, beats: number): number => tempoMap(p).tickToSec(beats * PPQ);

let meterCache: { key: unknown; m: MeterMap } | null = null;
export function meterMap(p: Project): MeterMap {
  if (!meterCache || meterCache.key !== p.sig) meterCache = { key: p.sig, m: new MeterMap(p.sig) };
  return meterCache.m;
}

export function barBeat(p: Project, beats: number): { bar: number; beat: number } {
  return meterMap(p).position(beats * PPQ);
}

export function beatsPerBar(p: Project, at = 0): number {
  return meterMap(p).barTicksAt(at * PPQ) / PPQ;
}

export function projectEndBeats(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, (c.start + c.len) / PPQ);
  return end;
}

// ---------------------------------------------------------------- applying main-process events

export interface ChangePayload {
  rev: number;
  meta: Omit<Project, 'tracks'> | null;
  order: string[];
  tracks: Record<string, Track>;
  removed: string[];
  dirty: boolean;
  history?: number;
}

export function applyChange(c: ChangePayload): { metaChanged: boolean; changed: Track[]; removed: string[] } {
  const cur = projectStore.get();
  const old = new Map(cur.project.tracks.map((t) => [t.id, t]));
  const tracks = c.order.map((id) => c.tracks[id] ?? old.get(id)!).filter(Boolean);
  const project: Project = { ...(c.meta ? { ...cur.project, ...c.meta } : cur.project), tracks };
  projectStore.set({ project, rev: c.rev, dirty: c.dirty, historyLength: c.history ?? cur.historyLength });
  // fresh clip glow: clips that did not exist before
  const fresh: Record<string, number> = {};
  const now = Date.now();
  for (const t of Object.values(c.tracks)) {
    const prev = old.get(t.id);
    const prevIds = new Set(prev?.clips.map((x) => x.id));
    for (const cl of t.clips) if (!prevIds.has(cl.id)) fresh[cl.id] = now;
  }
  if (Object.keys(fresh).length) agentStore.set((s) => ({ fresh: { ...s.fresh, ...fresh } }));
  return { metaChanged: !!c.meta, changed: Object.values(c.tracks), removed: c.removed };
}

export function toast(text: string, err = false): void {
  const id = Date.now() + Math.random();
  uiStore.set((s) => ({ toasts: [...s.toasts, { id, text, err }] }));
  setTimeout(() => uiStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), err ? 7000 : 3200);
}

export function trackById(id: string | null | undefined): Track | undefined {
  return id ? projectStore.get().project.tracks.find((t) => t.id === id) : undefined;
}

export const fmtDb = (db: number): string => (db <= -59 ? '-inf' : db.toFixed(1));
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-6));
