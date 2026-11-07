import { render } from 'preact';
import { App } from './App.tsx';
import { agentStore, applyChange, projectStore, transportStore, uiStore, toast } from './state.ts';
import type { ChangePayload } from './state.ts';
import { invoke } from './api.ts';
import { audio } from './audio.ts';
import { sfxStore } from './SoundFx.tsx';
import type { Activity, FeedbackItem } from '../../core/studio.ts';

async function boot(): Promise<void> {
  const snap = await invoke('snapshot');
  projectStore.set({ project: snap.snap.project, rev: snap.snap.rev, assets: snap.snap.assets, historyLength: snap.historyLength, projectPath: snap.projectPath, dirty: false });
  agentStore.set({ agent: snap.agent, activity: snap.activity, feedback: snap.feedback });
  uiStore.set({ endpoint: snap.endpoint, dataDir: snap.dataDir, version: snap.version, sfxCounts: snap.sfx, showConnect: !snap.onboarded });
  const [catalog, help] = await Promise.all([invoke('catalog'), invoke('exec', 'studio', { action: 'help' })]);
  uiStore.set({ catalog, tools: help.ok ? help.result.tools : {} });
  const first = snap.snap.project.tracks.find((t: any) => t.kind === 'instrument');
  if (first) uiStore.set({ selTrack: first.id });
  window.msai.onEvent((name, payload) => handle(name, payload));
  render(<App />, document.getElementById('root')!);
  audio.init().catch((e) => console.error('audio init failed', e));
  window.msai.send('ready', true);
}

function handle(name: string, p: any): void {
  switch (name) {
    case 'change': {
      const c = p as ChangePayload;
      const r = applyChange(c);
      const proj = projectStore.get().project;
      if (r.metaChanged) audio.setProject(proj);
      else {
        for (const t of r.changed) audio.updateTrack(t);
        for (const id of r.removed) audio.removeTrack(id);
      }
      const sel = uiStore.get();
      if (sel.selTrack && !proj.tracks.some((t) => t.id === sel.selTrack)) uiStore.set({ selTrack: proj.tracks.find((t) => t.kind === 'instrument')?.id ?? null });
      if (sel.selClip && !proj.tracks.find((t) => t.id === sel.selClip!.track)?.clips.some((x) => x.id === sel.selClip!.clip)) uiStore.set({ selClip: null });
      break;
    }
    case 'replaced': {
      projectStore.set({ project: p.project, rev: p.rev, assets: p.assets, dirty: false, historyLength: 0 });
      audio.setProject(p.project);
      uiStore.set({ selClip: null, selTrack: p.project.tracks.find((t: any) => t.kind === 'instrument')?.id ?? null });
      break;
    }
    case 'activity': {
      const a = p as Activity;
      agentStore.set((s) => {
        const i = s.activity.findIndex((x) => x.id === a.id);
        const activity = i >= 0 ? s.activity.map((x, k) => (k === i ? { ...a } : x)) : [...s.activity, { ...a }].slice(-400);
        const touched = { ...s.touched };
        if (a.tracks) for (const t of a.tracks) touched[t] = Date.now();
        return { activity, touched };
      });
      break;
    }
    case 'agent': agentStore.set({ agent: p }); break;
    case 'feedback': {
      if (!p) invoke('snapshot').then((s: any) => agentStore.set({ feedback: s.feedback }));
      else {
        const f = p as FeedbackItem;
        agentStore.set((s) => ({ feedback: s.feedback.some((x) => x.id === f.id) ? s.feedback.map((x) => (x.id === f.id ? { ...f } : x)) : [...s.feedback, f] }));
      }
      break;
    }
    case 'transport': {
      if (p.cmd === 'play') audio.play(p.from);
      else if (p.cmd === 'pause') audio.pause();
      else if (p.cmd === 'stop') audio.stop();
      else if (p.cmd === 'seek') audio.seekBeats(p.to);
      break;
    }
    case 'audition': {
      audio.audition(p.L, p.R, p.sampleRate);
      sfxStore.set({ id: p.id, wave: p.L, sampleRate: p.sampleRate });
      break;
    }
    case 'audition-note': audio.note(p.track, p.pitch, p.vel, p.seconds); break;
    case 'asset': audio.syncAssets(); break;
    case 'saved': toast('Saved.'); break;
  }
}

boot().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#ff9;z-index:999;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
  console.error(e);
});

// A small hook for screenshots and the demo recorder.
(window as any).__msai = Object.assign((window as any).__msai ?? {}, {
  ui: uiStore,
  project: projectStore,
  transport: transportStore,
  agent: agentStore,
  audio,
  setMode: (m: string) => uiStore.set({ mode: m as never }),
  setDock: (d: string) => uiStore.set({ dock: d as never }),
  selectTrack: (name: string) => {
    const t = projectStore.get().project.tracks.find((x) => x.name === name || x.id === name);
    if (t) uiStore.set({ selTrack: t.id });
  },
  openClip: (name: string, idx = 0) => {
    const t = projectStore.get().project.tracks.find((x) => x.name === name || x.id === name);
    const c = t?.clips.filter((x) => x.kind === 'midi')[idx];
    if (t && c) uiStore.set({ selTrack: t.id, selClip: { track: t.id, clip: c.id }, dock: 'roll' });
  },
  setZoom: (px: number) => uiStore.set({ pxPerBeat: px }),
  scrub: (sec: number) => transportStore.set({ position: sec }),
  connect: (on = true) => uiStore.set({ showConnect: on }),
});
