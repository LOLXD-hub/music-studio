import { useEffect, useRef } from 'preact/hooks';
import type { Track } from '../../engine/project.ts';
import { projectStore, uiStore, useStore, meters, fmtDb } from './state.ts';
import { ContextMenu } from './ui.tsx';
import { exec } from './api.ts';
import { audio } from './audio.ts';
import { tone } from './color.ts';
import { useState } from 'preact/hooks';

const dbToPos = (db: number) => Math.pow(Math.max(0, db + 60) / 66, 0.5);
const posToDb = (p: number) => p * p * 66 - 60;

/** Applies a change to the local replica and the audio engine right away; the main process is told when the gesture ends. */
function patchLocal(id: string, patch: Partial<Track> | null, master?: { vol: number }): void {
  const cur = projectStore.get().project;
  if (master) {
    const next = { ...cur, master: { ...cur.master, ...master } };
    projectStore.set({ project: next });
    audio.setProject(next);
    return;
  }
  const tracks = cur.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  projectStore.set({ project: { ...cur, tracks } });
  const t = tracks.find((x) => x.id === id);
  if (t) audio.updateTrack(t);
}

function Meter({ id, master }: { id: string; master?: boolean }): preact.JSX.Element {
  const l = useRef<HTMLElement>(null);
  const r = useRef<HTMLElement>(null);
  const hl = useRef<HTMLElement>(null);
  const hr = useRef<HTMLElement>(null);
  const hold = useRef({ l: 0, r: 0 });
  useEffect(() => {
    const f = () => {
      const m = master ? meters.master : meters.tracks[id];
      if (!m) return;
      const pl = dbToPos(20 * Math.log10(Math.max(m.peakL, 1e-5)));
      const pr = dbToPos(20 * Math.log10(Math.max(m.peakR, 1e-5)));
      hold.current.l = Math.max(pl, hold.current.l - 0.012);
      hold.current.r = Math.max(pr, hold.current.r - 0.012);
      if (l.current) l.current.style.height = pl * 100 + '%';
      if (r.current) r.current.style.height = pr * 100 + '%';
      if (hl.current) hl.current.style.bottom = hold.current.l * 100 + '%';
      if (hr.current) hr.current.style.bottom = hold.current.r * 100 + '%';
    };
    meters.listeners.add(f);
    return () => void meters.listeners.delete(f);
  }, [id, master]);
  return (
    <>
      <div class="meter"><i ref={l as never} /><b ref={hl as never} /></div>
      <div class="meter"><i ref={r as never} /><b ref={hr as never} /></div>
    </>
  );
}

function Fader({ db, onLive, onCommit }: { db: number; onLive: (db: number) => void; onCommit: (db: number) => void }): preact.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const down = (e: PointerEvent) => {
    const el = box.current!;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const setFrom = (cy: number) => {
      const p = 1 - Math.min(1, Math.max(0, (cy - rect.top) / rect.height));
      const v = Math.round(posToDb(p) * 10) / 10;
      onLive(v <= -59.5 ? -80 : v);
      return v;
    };
    let v = setFrom(e.clientY);
    const mv = (m: PointerEvent) => (v = setFrom(m.clientY));
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      onCommit(v <= -59.5 ? -60 : v);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };
  const pos = dbToPos(Math.max(-60, db));
  return (
    <div class="fader" ref={box} onPointerDown={down as never} onDblClick={() => { onLive(0); onCommit(0); }} style={{ height: '100%' }}>
      <div class="cap" style={{ top: (1 - pos) * 100 + '%' }} />
    </div>
  );
}

function Strip({ t, bus }: { t: Track; bus: Track[] }): preact.JSX.Element {
  const selTrack = useStore(uiStore, (s) => s.selTrack);
  const [menu, setMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
  const catalog = useStore(uiStore, (s) => s.catalog);
  return (
    <div class={'strip' + (selTrack === t.id ? ' sel' : '')} style={{ ['--tc' as never]: tone(t.color, 0.36, 0.5) }} onClick={() => uiStore.set({ selTrack: t.id })}>
      <div class="sn"><span title={t.name}>{t.name}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {t.inserts.map((f) => (
          <div key={f.id} class={'slot' + (f.bypass ? ' byp' : '')} onClick={() => uiStore.set({ fxEditor: { track: t.id, fx: f.id } })} title={f.type}>
            {f.name ?? f.type}
          </div>
        ))}
        <div class="slot add" onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom, items: (catalog?.effects ?? []).map((fx: any) => ({ label: fx.name, run: () => exec('effects', { action: 'add', track: t.id, type: fx.type }) })) });
        }}>+ effect</div>
      </div>
      {bus.length > 0 && t.kind !== 'bus' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {bus.map((b) => {
            const s = t.sends.find((x) => x.to === b.id);
            return (
              <div class="knobline" key={b.id} title={`Send to ${b.name}`}>
                <span style={{ width: '30px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <input type="range" min={-60} max={0} step={1} value={s ? s.level : -60} style={{ '--p': ((s ? s.level : -60) + 60) / 0.6 + '%' } as never}
                  onChange={(e) => { const v = +(e.target as HTMLInputElement).value; exec('effects', { action: 'send', track: t.id, to: b.id, level: v <= -59 ? null : v }); }} />
              </div>
            );
          })}
        </div>
      )}
      <div class="knobline" title="Pan"><span>L</span>
        <input type="range" min={-100} max={100} step={1} value={Math.round(t.pan * 100)} style={{ '--p': (t.pan * 100 + 100) / 2 + '%' } as never}
          onInput={(e) => patchLocal(t.id, { pan: +(e.target as HTMLInputElement).value / 100 })}
          onChange={(e) => exec('tracks', { action: 'update', track: t.id, pan: +(e.target as HTMLInputElement).value / 100 })} /><span>R</span></div>
      <div class="faderbox">
        <Fader db={t.vol} onLive={(db) => patchLocal(t.id, { vol: db })} onCommit={(db) => exec('tracks', { action: 'update', track: t.id, vol: db })} />
        <Meter id={t.id} />
      </div>
      <div class="tnum muted" style={{ textAlign: 'center', fontSize: '11px' }}>{fmtDb(t.vol)} dB</div>
      <div class="ms" style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
        <button class={'m' + (t.mute ? ' on' : '')} onClick={() => exec('tracks', { action: 'update', track: t.id, mute: !t.mute })}>M</button>
        <button class={'s' + (t.solo ? ' on' : '')} onClick={() => exec('tracks', { action: 'update', track: t.id, solo: !t.solo })}>S</button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function Mixer(): preact.JSX.Element {
  const project = useStore(projectStore, (s) => s.project);
  const catalog = useStore(uiStore, (s) => s.catalog);
  const [menu, setMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
  const buses = project.tracks.filter((t) => t.kind === 'bus');
  const grRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = () => {
      const lim = project.master.inserts.find((x) => x.type === 'limiter');
      const v = lim ? meters.gr[lim.id] ?? 0 : 0;
      if (grRef.current) grRef.current.textContent = lim ? `GR ${Math.abs(v).toFixed(1)} dB` : '';
    };
    meters.listeners.add(f);
    return () => void meters.listeners.delete(f);
  }, [project.master.inserts]);
  return (
    <div class="mixer">
      {project.tracks.map((t) => <Strip key={t.id} t={t} bus={buses.filter((b) => b.id !== t.id)} />)}
      <div style={{ flex: 1 }} />
      <div class="strip master">
        <div class="sn"><span>Master</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {project.master.inserts.map((f) => (
            <div key={f.id} class={'slot' + (f.bypass ? ' byp' : '')} onClick={() => uiStore.set({ fxEditor: { track: 'master', fx: f.id } })}>{f.name ?? f.type}</div>
          ))}
          <div class="slot add" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.left - 60, y: r.bottom, items: (catalog?.effects ?? []).map((fx: any) => ({ label: fx.name, run: () => exec('effects', { action: 'add', track: 'master', type: fx.type }) })) });
          }}>+ effect</div>
        </div>
        <div class="faderbox" style={{ marginTop: '4px' }}>
          <Fader db={project.master.vol} onLive={(db) => patchLocal('', null, { vol: db })} onCommit={(db) => exec('mixer', { action: 'set', master_vol: db })} />
          <Meter id="master" master />
        </div>
        <div class="tnum muted" style={{ textAlign: 'center', fontSize: '11px' }}>{fmtDb(project.master.vol)} dB</div>
        <div ref={grRef} class="muted tnum" style={{ textAlign: 'center', fontSize: '10px', height: '12px' }} />
        <div class="slot add" title="Add the finishing limiter" onClick={() => { if (!project.master.inserts.some((f) => f.type === 'limiter')) exec('effects', { action: 'add', track: 'master', type: 'limiter', preset: 'Transparent' }); }}>
          {project.master.inserts.some((f) => f.type === 'limiter') ? 'limiter on' : '+ limiter'}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
