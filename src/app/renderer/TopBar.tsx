import { useEffect, useRef, useState } from 'preact/hooks';
import { agentStore, projectStore, transportStore, uiStore, useStore, barBeat, beatsPerBar, secToBeats, beatsToSec, projectEndBeats, toast } from './state.ts';
import { Btn, ContextMenu, Icon, Segmented, fmtTime } from './ui.tsx';
import type { MenuItem } from './ui.tsx';
import { exec, invoke, pickFiles } from './api.ts';
import { audio } from './audio.ts';
import { frame, draw, STATE_FRAMES, W, H } from '../shared/clawd.ts';
import type { ClawdState } from '../shared/clawd.ts';

const LABEL: Record<ClawdState, [string, string]> = {
  asleep: ['Asleep', 'No agent connected'],
  idle: ['Ready', 'Connected'],
  listening: ['Listening', 'Checking how it sounds'],
  building: ['Building', 'Writing notes and parts'],
  loading: ['Loading', 'Rendering or importing'],
  thinking: ['Thinking', 'Planning the next move'],
  mixing: ['Mixing', 'Balancing levels and effects'],
};

export function ClawdStatus(): preact.JSX.Element {
  const agent = useStore(agentStore, (s) => s.agent);
  const ref = useRef<HTMLCanvasElement>(null);
  const state: ClawdState = !agent.connected ? 'asleep' : (agent.state as ClawdState);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(2, Math.round(2 * dpr));
    cv.width = W * s;
    cv.height = H * s;
    cv.style.width = (W * s) / dpr + 'px';
    cv.style.height = (H * s) / dpr + 'px';
    const ctx = cv.getContext('2d')!;
    const info = STATE_FRAMES[state];
    let n = 0;
    const paint = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      draw(ctx, frame(state, n++), s);
    };
    paint();
    const id = setInterval(paint, 1000 / info.fps);
    (window.__msai ??= {}).clawdFrame = (k: number) => { n = k; paint(); };
    return () => clearInterval(id);
  }, [state]);
  const [t1, t2] = LABEL[state];
  const busy = agent.connected && state !== 'idle';
  return (
    <div class={'status' + (agent.connected ? ' live' : '') + (busy ? ' busy' : '')} onClick={() => uiStore.set({ showConnect: true })} title="Connect your AI">
      <canvas ref={ref} />
      <div style={{ minWidth: 0 }}>
        <div class="t1">
          <span class="dot" />
          {agent.connected && agent.client ? `${agent.client}: ${t1.toLowerCase()}` : t1}
        </div>
        <div class="t2">{agent.connected && agent.message && agent.message !== 'Connected' && agent.message !== 'Waiting' ? agent.message : t2}</div>
      </div>
    </div>
  );
}

function Clock(): preact.JSX.Element {
  const pos = useStore(transportStore, (s) => s.position);
  const project = useStore(projectStore, (s) => s.project);
  const beats = secToBeats(project, pos);
  const bb = barBeat(project, Math.max(0, beats));
  return (
    <div class="clock" title="Bar.beat.tick and time">
      <span>
        {String(bb.bar).padStart(3, '0')}.{Math.floor(bb.beat)}.{String(Math.floor((bb.beat % 1) * 4) + 1)}
      </span>
      <small>{fmtTime(pos)}</small>
    </div>
  );
}

function MenuBar(): preact.JSX.Element {
  const project = useStore(projectStore, (s) => s.project);
  const dirty = useStore(projectStore, (s) => s.dirty);
  const appName = useStore(uiStore, (s) => s.appName);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number; items: MenuItem[] } | null>(null);

  const save = async () => { const r = await exec('studio', { action: 'save' }); if (r) toast(r.result.summary); };
  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New project', run: async () => { const r = await exec('studio', { action: 'new' }); if (r) toast('New project.'); } },
      { label: 'Open…', run: async () => { const f = await pickFiles('Open project', [{ name: 'Music studio project', extensions: ['msai'] }]); if (f[0]) { const r = await exec('studio', { action: 'open', path: f[0] }); if (r) toast(r.result.summary); } } },
      { label: 'Save', hint: 'Ctrl+S', run: save },
      'sep',
      { label: 'Export audio…', run: () => uiStore.set({ showExport: true }) },
      { label: 'Export MIDI', run: async () => { const r = await exec('midi', { action: 'export' }); if (r) { toast(r.result.summary); invoke('open-path', r.result.path); } } },
      { label: 'Export stems', run: async () => { const r = await exec('render', { action: 'stems' }); if (r) { toast(r.result.summary); invoke('open-path', r.result.dir); } } },
    ],
    Edit: [
      { label: 'Undo', hint: 'Ctrl+Z', run: () => exec('studio', { action: 'undo' }) },
      { label: 'Redo', hint: 'Ctrl+Y', run: () => exec('studio', { action: 'redo' }) },
    ],
    View: [
      { label: 'Studio', run: () => uiStore.set({ mode: 'studio' }) },
      { label: 'Sound FX', run: () => uiStore.set({ mode: 'sfx' }) },
      { label: 'Live', run: () => uiStore.set({ mode: 'live' }) },
      'sep',
      { label: 'Piano roll', run: () => uiStore.set({ mode: 'studio', dock: 'roll' }) },
      { label: 'Mixer', run: () => uiStore.set({ mode: 'studio', dock: 'mixer' }) },
    ],
    Options: [
      { label: 'Settings…', run: () => uiStore.set({ showSettings: true }) },
      { label: 'Connect your AI…', run: () => uiStore.set({ showConnect: true }) },
    ],
  };
  return (
    <div class="menubar">
      {Object.entries(menus).map(([name, items]) => (
        <span
          key={name}
          class={'mi' + (menu?.name === name ? ' open' : '')}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ name, x: r.left, y: r.bottom, items });
          }}
        >
          {name}
        </span>
      ))}
      <div class="title"><b>{appName}</b>{'  ·  '}{project.name}{dirty ? ' *' : ''}</div>
      <div class="gap" />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function TopBar(): preact.JSX.Element {
  const mode = useStore(uiStore, (s) => s.mode);
  const playing = useStore(transportStore, (s) => s.playing);
  const project = useStore(projectStore, (s) => s.project);
  const hist = useStore(projectStore, (s) => s.historyLength);
  const dirty = useStore(projectStore, (s) => s.dirty);
  const bpm = project.tempo[0]?.bpm ?? 120;
  const looping = !!project.loop;

  const toggle = async () => {
    if (playing) audio.pause();
    else {
      const loop = projectStore.get().project.loop;
      const pos = transportStore.get().position;
      const end = projectEndBeats(project);
      if (end > 0 && secToBeats(project, pos) >= end - 0.01 && !loop) await audio.play(0);
      else await audio.play();
    }
  };

  return (
    <div class="head">
      <ClawdStatus />
      <div class="right">
        <MenuBar />
        <div class="toolbar">
          <Segmented value={mode} options={[{ value: 'studio', label: 'Studio' }, { value: 'sfx', label: 'Sound FX' }, { value: 'live', label: 'Live' }]} onChange={(m) => uiStore.set({ mode: m })} />
          <div class="vr" />
          <div class="transport">
            <div class="tbtn" title="Back to start" onClick={() => { audio.seekBeats(0); }}>
              <Icon n="prev" size={14} />
            </div>
            <div class={'tbtn play' + (playing ? ' playing' : '')} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle}>
              <Icon n={playing ? 'pause' : 'play'} size={15} fill />
            </div>
            <div class="tbtn" title="Stop" onClick={() => audio.stop()}>
              <Icon n="stop" size={12} fill />
            </div>
            <div class={'tbtn' + (looping ? ' on' : '')} title="Loop the marked range" onClick={() => {
              if (looping) exec('transport', { action: 'loop', off: true });
              else exec('transport', { action: 'loop', from: 0, to: Math.max(beatsPerBar(project) * 4, projectEndBeats(project)) });
            }}>
              <Icon n="loop" size={14} />
            </div>
          </div>
          <Clock />
          <div class="field" title="Tempo">
            <input class="num" type="number" min={20} max={300} value={bpm} onChange={(e) => exec('studio', { action: 'set', tempo: +(e.target as HTMLInputElement).value })} />
            <span class="muted" style={{ fontSize: '10.5px' }}>BPM</span>
          </div>
          <span class="chip" title={project.key ? 'Project key' : 'No key set'}>{project.key ? `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][project.key.root]} ${project.key.mode}` : 'No key'}</span>
          <div class="sp" />
          <div class="right-tools">
            <Btn icon="undo" cls="ghost" title="Undo (Ctrl+Z)" disabled={hist === 0} onClick={() => exec('studio', { action: 'undo' })} />
            <Btn icon="redo" cls="ghost" title="Redo (Ctrl+Y)" onClick={() => exec('studio', { action: 'redo' })} />
            <Btn icon="save" cls="ghost" title={dirty ? 'Save (unsaved changes)' : 'Save'} onClick={save2} on={dirty} />
            <Btn icon="gear" cls="ghost" title="Settings" onClick={() => uiStore.set({ showSettings: true })} />
            <Btn primary icon="export" onClick={() => uiStore.set({ showExport: true })}>Export</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

async function save2(): Promise<void> {
  const r = await exec('studio', { action: 'save' });
  if (r) toast(r.result.summary);
}

export { beatsToSec };
