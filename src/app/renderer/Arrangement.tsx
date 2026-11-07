import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PPQ } from '../../engine/project.ts';
import type { AudioClip, Clip, MidiClip, Track } from '../../engine/project.ts';
import { agentStore, projectStore, transportStore, uiStore, useStore, beatsPerBar, projectEndBeats, barBeat, secToBeats, meters, toast } from './state.ts';
import { Btn, ContextMenu, Icon } from './ui.tsx';
import { exec, invoke } from './api.ts';
import { audio } from './audio.ts';
import { clipTones, tone } from './color.ts';

const ROW = 60;

// -------------------------------------------------------------- audio peaks cache
const peaks = new Map<string, Float32Array | 'loading'>();
let peaksVersion = 0;
const peakSubs = new Set<() => void>();
function peaksFor(id: string): Float32Array | null {
  const p = peaks.get(id);
  if (p && p !== 'loading') return p;
  if (!p) {
    peaks.set(id, 'loading');
    invoke('asset', id).then((a: { channels: Float32Array[] } | null) => {
      if (!a) return peaks.delete(id);
      const ch = a.channels[0];
      const N = 1024;
      const out = new Float32Array(N);
      const step = Math.max(1, Math.floor(ch.length / N));
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(ch[j]));
        out[i] = m;
      }
      peaks.set(id, out);
      peaksVersion++;
      peakSubs.forEach((f) => f());
    });
  }
  return null;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// -------------------------------------------------------------- clip view
function ClipView({ track, clip, px, selected, fresh, onDown, onOpen, onCtx }: { track: Track; clip: Clip; px: number; selected: boolean; fresh: boolean; onDown: (e: PointerEvent, kind: 'move' | 'resize') => void; onOpen: () => void; onCtx: (e: MouseEvent) => void }): preact.JSX.Element {
  const cv = useRef<HTMLCanvasElement>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    peakSubs.add(f);
    return () => void peakSubs.delete(f);
  }, []);
  const base = clip.color ?? track.color;
  const tones = clipTones(base);
  const w = Math.max(6, (clip.len / PPQ) * px);
  useLayoutEffect(() => {
    const c = cv.current;
    if (!c) return;
    const h = ROW - 10;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    if (clip.kind === 'midi') {
      const notes = (clip as MidiClip).notes;
      if (!notes.length) return;
      let lo = 127, hi = 0;
      for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
      const span = Math.max(12, hi - lo + 3);
      const rowH = Math.min(4, (h - 16) / span);
      g.fillStyle = tones.note;
      for (const n of notes) {
        const x = (n.t / PPQ) * px;
        const y = 14 + (hi - n.p + 1) * rowH * ((h - 16) / (span * rowH));
        g.globalAlpha = 0.5 + (n.v / 127) * 0.5;
        g.fillRect(x, y, Math.max(1.5, (n.d / PPQ) * px - 0.5), Math.max(1.5, rowH - 0.6));
      }
    } else {
      const pk = peaksFor((clip as AudioClip).assetId);
      if (!pk) return;
      g.fillStyle = tones.note;
      const mid = (h + 12) / 2;
      const gain = Math.pow(10, (clip as AudioClip).gain / 20);
      for (let x = 0; x < w; x += 2) {
        const i = Math.floor((x / w) * (pk.length - 1));
        const a = Math.min(1, pk[i] * gain) * (h - 20) * 0.5;
        g.fillRect(x, mid - a, 1.5, Math.max(1, a * 2));
      }
    }
  }, [clip, px, w, peaksVersion, tones.note]);
  return (
    <div
      class={'clip' + (selected ? ' sel' : '') + (fresh ? ' fresh' : '')}
      data-clip={clip.id}
      style={{ left: (clip.start / PPQ) * px + 'px', width: w + 'px', background: tones.body, ['--clip-head' as never]: tones.head, opacity: clip.muted ? 0.4 : 1 }}
      onPointerDown={(e) => { if (e.button === 0) onDown(e, 'move'); }}
      onDblClick={onOpen}
      onContextMenu={onCtx}
    >
      <canvas ref={cv} />
      <div class="cn">{clip.name}</div>
      <div class="rz" onPointerDown={(e) => { e.stopPropagation(); onDown(e, 'resize'); }} />
    </div>
  );
}

// -------------------------------------------------------------- ruler
function Ruler({ px, scrollLeft, width }: { px: number; scrollLeft: number; width: number }): preact.JSX.Element {
  const cv = useRef<HTMLCanvasElement>(null);
  const project = useStore(projectStore, (s) => s.project);
  useLayoutEffect(() => {
    const c = cv.current;
    if (!c || width < 10) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(22 * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, 22);
    const bpb = beatsPerBar(project);
    const barPx = bpb * px;
    const first = Math.floor(scrollLeft / barPx);
    const last = Math.ceil((scrollLeft + width) / barPx);
    const every = barPx > 70 ? 1 : barPx > 34 ? 2 : barPx > 17 ? 4 : 8;
    g.font = '11px Segoe UI, sans-serif';
    for (let b = first; b <= last; b++) {
      const x = b * barPx - scrollLeft;
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(x, 4, 1, 18);
      if (b % every === 0) {
        g.fillStyle = 'rgba(222,228,232,0.85)';
        g.fillText(String(b + 1), x + 4, 14);
      }
      if (px >= 20) {
        g.fillStyle = 'rgba(255,255,255,0.14)';
        for (let k = 1; k < bpb; k++) g.fillRect(x + k * px, 16, 1, 6);
      }
    }
  }, [px, scrollLeft, width, project.sig]);
  return <canvas ref={cv} style={{ position: 'absolute', left: 0, top: 0, width: width + 'px', height: '22px' }} />;
}

// -------------------------------------------------------------- main
export function Arrangement(): preact.JSX.Element {
  const project = useStore(projectStore, (s) => s.project);
  const px = useStore(uiStore, (s) => s.pxPerBeat);
  const selClip = useStore(uiStore, (s) => s.selClip);
  const selTrack = useStore(uiStore, (s) => s.selTrack);
  const pinMode = useStore(uiStore, (s) => s.pinMode);
  const touched = useStore(agentStore, (s) => s.touched);
  const fresh = useStore(agentStore, (s) => s.fresh);
  const feedback = useStore(agentStore, (s) => s.feedback);
  const lanes = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const rulerWrap = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [vw, setVw] = useState(900);
  const [menu, setMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
  const [pinDraft, setPinDraft] = useState<{ track: Track; beat: number; x: number; y: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const bpb = beatsPerBar(project);
  const end = Math.max(projectEndBeats(project) + bpb * 4, bpb * 16);
  const totalW = end * px;

  const hasTracks = project.tracks.length > 0;
  useEffect(() => {
    const el = lanes.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, [hasTracks]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onScroll = () => {
    const el = lanes.current!;
    setScroll({ x: el.scrollLeft, y: el.scrollTop });
    if (heads.current) heads.current.scrollTop = el.scrollTop;
  };

  // follow the playhead while playing
  useEffect(() => {
    return transportStore.subscribe(() => {
      const t = transportStore.get();
      if (!t.playing) return;
      const x = secToBeats(projectStore.get().project, t.position) * uiStore.get().pxPerBeat;
      const el = lanes.current;
      if (el && (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft)) el.scrollLeft = Math.max(0, x - 80);
    });
  }, []);

  // wheel zoom with Ctrl
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const el = lanes.current!;
    const rect = el.getBoundingClientRect();
    const beatAt = (el.scrollLeft + e.clientX - rect.left) / px;
    const next = Math.max(6, Math.min(160, px * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    uiStore.set({ pxPerBeat: next });
    requestAnimationFrame(() => { el.scrollLeft = beatAt * next - (e.clientX - rect.left); });
  };

  const seekFromEvent = (e: MouseEvent) => {
    const rect = rulerWrap.current!.getBoundingClientRect();
    const beats = Math.max(0, (e.clientX - rect.left + scroll.x) / px);
    audio.seekBeats(Math.round(beats * 4) / 4);
  };
  const onRulerDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const rect = rulerWrap.current!.getBoundingClientRect();
    const a = Math.max(0, Math.round(((e.clientX - rect.left + scroll.x) / px) * 4) / 4);
    if (e.shiftKey) {
      const mv = (m: MouseEvent) => {
        const b = Math.max(0, Math.round(((m.clientX - rect.left + scroll.x) / px) * 4) / 4);
        if (Math.abs(b - a) >= 1) exec('transport', { action: 'loop', from: Math.min(a, b), to: Math.max(a, b) }, { quiet: true });
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
      return;
    }
    seekFromEvent(e);
    const mv = (m: MouseEvent) => seekFromEvent(m);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  };

  // clip dragging
  const startDrag = (e: PointerEvent, track: Track, clip: Clip, kind: 'move' | 'resize') => {
    e.preventDefault();
    uiStore.set({ selClip: { track: track.id, clip: clip.id }, selTrack: track.id });
    const el = (e.currentTarget as HTMLElement).closest('.clip') as HTMLElement;
    const x0 = e.clientX;
    const start0 = clip.start / PPQ;
    const len0 = clip.len / PPQ;
    const grid = uiStore.get().snap >= 1 ? 1 : px > 40 ? 0.25 : 1;
    let moved = false;
    let dBeats = 0;
    const mv = (m: PointerEvent) => {
      const d = (m.clientX - x0) / px;
      dBeats = Math.round(d / grid) * grid;
      if (Math.abs(m.clientX - x0) > 3) moved = true;
      if (!moved) return;
      if (kind === 'move') el.style.left = Math.max(0, start0 + dBeats) * px + 'px';
      else el.style.width = Math.max(grid, len0 + dBeats) * px + 'px';
    };
    const up = async () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (!moved) return;
      if (kind === 'move') await exec('clips', { action: 'move', track: track.id, clip: clip.id, to: Math.max(0, start0 + dBeats) });
      else await exec('clips', { action: 'update', track: track.id, clip: clip.id, length: Math.max(grid, len0 + dBeats) });
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const openClip = (track: Track, clip: Clip) => {
    uiStore.set({ selClip: { track: track.id, clip: clip.id }, selTrack: track.id, dock: 'roll' });
  };

  const laneDown = (e: MouseEvent, track: Track) => {
    if ((e.target as HTMLElement).closest('.clip, .pin')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.max(0, (e.clientX - rect.left) / px);
    uiStore.set({ selTrack: track.id });
    if (pinMode) {
      setPinDraft({ track, beat: Math.round(beat * 4) / 4, x: e.clientX, y: e.clientY });
      uiStore.set({ pinMode: false });
    }
  };

  const laneDbl = async (e: MouseEvent, track: Track) => {
    if ((e.target as HTMLElement).closest('.clip')) return;
    if (track.kind !== 'instrument') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.floor(Math.max(0, (e.clientX - rect.left) / px) / bpb) * bpb;
    const r = await exec('clips', { action: 'add', track: track.id, at: beat, length: bpb * 4 });
    if (r) uiStore.set({ selClip: { track: track.id, clip: r.result.clip }, selTrack: track.id, dock: 'roll' });
  };

  const clipMenu = (e: MouseEvent, track: Track, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    uiStore.set({ selClip: { track: track.id, clip: clip.id }, selTrack: track.id });
    const playPos = secToBeats(project, transportStore.get().position);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: clip.kind === 'midi' ? 'Open in piano roll' : 'Select', run: () => openClip(track, clip) },
        { label: 'Duplicate after', run: () => exec('clips', { action: 'duplicate', track: track.id, clip: clip.id, to: (clip.start + clip.len) / PPQ }) },
        ...(clip.kind === 'midi' ? [{ label: 'Split at playhead', run: () => exec('clips', { action: 'split', track: track.id, clip: clip.id, at: playPos }) }] : []),
        { label: clip.muted ? 'Unmute' : 'Mute', run: () => exec('clips', { action: 'update', track: track.id, clip: clip.id, muted: !clip.muted }) },
        'sep',
        { label: 'Ask the AI to rework this', run: () => setPinDraft({ track, beat: clip.start / PPQ, x: e.clientX, y: e.clientY }) },
        'sep',
        { label: 'Delete', run: () => exec('clips', { action: 'remove', track: track.id, clip: clip.id }) },
      ],
    });
  };

  const headMenu = (e: MouseEvent, t: Track) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Rename', run: () => { const n = window.prompt('Track name', t.name); if (n) exec('tracks', { action: 'update', track: t.id, name: n }); } },
        ...(t.kind === 'instrument' ? [{ label: 'Instrument settings', run: () => uiStore.set({ instEditor: t.id }) }] : []),
        { label: 'Duplicate', run: () => exec('tracks', { action: 'duplicate', track: t.id }) },
        { label: 'Leave a note for the AI', run: () => setPinDraft({ track: t, beat: secToBeats(project, transportStore.get().position), x: e.clientX, y: e.clientY }) },
        'sep',
        { label: 'Delete track', run: () => exec('tracks', { action: 'remove', track: t.id }) },
      ],
    });
  };

  const onDropFiles = async (e: DragEvent) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    const rect = lanes.current!.getBoundingClientRect();
    const at = Math.max(0, Math.round(((e.clientX - rect.left + scroll.x) / px) * 4) / 4);
    for (const f of files) {
      const p = window.msai.pathForFile?.(f) ?? '';
      if (!p) { toast('This file cannot be read from here. Use Files > Import.', true); continue; }
      if (/\.midi?$/i.test(p)) await exec('midi', { action: 'import', path: p });
      else await exec('clips', { action: 'add_audio', track: 'Audio', file: p, at });
    }
  };

  const markers = project.markers;
  const loop = project.loop;
  const pins = feedback.filter((f) => f.kind === 'pin' && f.target?.beat !== undefined);

  if (!project.tracks.length) {
    return (
      <div class="panel grow" style={{ position: 'relative' }}>
        <div class="empty" style={{ flex: 1 }}>
          <div class="big">An empty session</div>
          <div style={{ maxWidth: '380px' }}>Ask your AI to start a piece, or add a track yourself from the browser on the left. Everything it writes appears here as it happens.</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn primary icon="link" onClick={() => uiStore.set({ showConnect: true })}>Connect your AI</Btn>
            <Btn icon="plus" onClick={() => exec('tracks', { action: 'add', name: 'Piano', instrument: 'piano' })}>Add a piano track</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="panel grow" onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <div class="arr">
        <div class="corner">
          <Btn icon="plus" sm cls="ghost" title="Zoom in" onClick={() => uiStore.set({ pxPerBeat: Math.min(160, px * 1.3) })} />
          <Btn sm cls="ghost" title="Zoom out" onClick={() => uiStore.set({ pxPerBeat: Math.max(6, px / 1.3) })}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>−</span>
          </Btn>
          <Btn icon="pin" sm cls={pinMode ? '' : 'ghost'} on={pinMode} title="Pin a note for the AI: click a lane" onClick={() => uiStore.set({ pinMode: !pinMode })} />
          <span class="faint" style={{ fontSize: '11px', marginLeft: 'auto' }}>{project.tracks.length} tracks</span>
        </div>
        <div class="ruler-wrap" ref={rulerWrap} onMouseDown={onRulerDown as never}>
          <Ruler px={px} scrollLeft={scroll.x} width={vw} />
          {markers.map((m) => (
            <div key={m.id} class="marker" style={{ left: (m.t / PPQ) * px - scroll.x + 'px' }} onMouseDown={(e) => { e.stopPropagation(); audio.seekBeats(m.t / PPQ); }} title={`${m.name} (bar ${barBeat(project, m.t / PPQ).bar})`}>
              {m.name}
            </div>
          ))}
          {loop && <div style={{ position: 'absolute', top: 0, height: '3px', background: 'var(--accent-2)', opacity: 0.9, left: (loop.start / PPQ) * px - scroll.x + 'px', width: ((loop.end - loop.start) / PPQ) * px + 'px' }} />}
          <PlayheadRuler px={px} scrollLeft={scroll.x} />
        </div>
        <div class="heads" ref={heads}>
          {project.tracks.map((t) => (
            <TrackHead key={t.id} t={t} sel={selTrack === t.id} touched={now - (touched[t.id] ?? 0) < 1800} onMenu={(e) => headMenu(e, t)} />
          ))}
        </div>
        <div class="lanes" ref={lanes} onScroll={onScroll} onWheel={onWheel as never}>
          <div style={{ width: totalW + 'px', position: 'relative' }}>
            {project.tracks.map((t) => (
              <div
                key={t.id}
                class="lane"
                style={{ backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.11) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`, backgroundSize: `${bpb * px}px 100%, ${px}px 100%`, backgroundColor: selTrack === t.id ? '#2a3137' : undefined }}
                onMouseDown={(e) => laneDown(e, t)}
                onDblClick={(e) => laneDbl(e, t)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const beat = Math.round(((e.clientX - rect.left) / px) * 4) / 4;
                  setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Leave a note for the AI here', run: () => setPinDraft({ track: t, beat, x: e.clientX, y: e.clientY }) }, ...(t.kind === 'instrument' ? [{ label: 'New clip here', run: () => exec('clips', { action: 'add', track: t.id, at: Math.floor(beat / bpb) * bpb, length: bpb * 4 }) }] : [])] });
                }}
              >
                {loop && <div style={{ position: 'absolute', top: 0, bottom: 0, left: (loop.start / PPQ) * px + 'px', width: ((loop.end - loop.start) / PPQ) * px + 'px', background: 'rgba(123,160,191,0.08)', pointerEvents: 'none' }} />}
                {t.clips.map((c) => (
                  <ClipView key={c.id} track={t} clip={c} px={px} selected={selClip?.clip === c.id} fresh={now - (fresh[c.id] ?? 0) < 2200} onDown={(e, k) => startDrag(e, t, c, k)} onOpen={() => openClip(t, c)} onCtx={(e) => clipMenu(e, t, c)} />
                ))}
                {pins.filter((f) => project.tracks.find((x) => x.name === f.target!.track || x.id === f.target!.track)?.id === t.id).map((f) => (
                  <div key={f.id} class={'pin' + (f.reply ? ' done' : '')} style={{ left: f.target!.beat! * px + 'px' }} title={f.text + (f.reply ? `\nAI: ${f.reply}` : '')}>
                    <i />
                    <b>{f.text}</b>
                  </div>
                ))}
              </div>
            ))}
            <Playhead px={px} />
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {pinDraft && <PinEditor draft={pinDraft} onClose={() => setPinDraft(null)} />}
    </div>
  );
}

function TrackHead({ t, sel, touched, onMenu }: { t: Track; sel: boolean; touched: boolean; onMenu: (e: MouseEvent) => void }): preact.JSX.Element {
  const level = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = () => {
      const m = meters.tracks[t.id];
      if (level.current && m) level.current.style.width = Math.min(100, Math.max(0, (Math.max(m.peakL, m.peakR) ** 0.5) * 100)) + '%';
    };
    meters.listeners.add(f);
    return () => void meters.listeners.delete(f);
  }, [t.id]);
  return (
    <div class={'thead' + (sel ? ' sel' : '') + (touched ? ' touched' : '')} style={{ ['--tc' as never]: tone(t.color, 0.36, 0.5) }} onClick={() => uiStore.set({ selTrack: t.id })} onContextMenu={onMenu as never} onDblClick={() => t.kind === 'instrument' && uiStore.set({ instEditor: t.id })}>
      <div class="nm">
        <span class="n">{t.name}</span>
      </div>
      <div class="sub">{t.instrument ? `${t.instrument.preset ?? t.instrument.type}` : t.kind === 'bus' ? 'Bus' : 'Audio'}</div>
      <div class="ms">
        <button class={'m' + (t.mute ? ' on' : '')} onClick={(e) => { e.stopPropagation(); exec('tracks', { action: 'update', track: t.id, mute: !t.mute }); }}>M</button>
        <button class={'s' + (t.solo ? ' on' : '')} onClick={(e) => { e.stopPropagation(); exec('tracks', { action: 'update', track: t.id, solo: !t.solo }); }}>S</button>
        <div style={{ flex: 1, height: '4px', alignSelf: 'center', marginLeft: '6px', background: '#14181b', overflow: 'hidden' }}>
          <div ref={level} style={{ height: '100%', width: '0%', background: tone(t.color, 0.36, 0.6), transition: 'width 0.05s' }} />
        </div>
      </div>
    </div>
  );
}

function Playhead({ px }: { px: number }): preact.JSX.Element {
  const pos = useStore(transportStore, (s) => s.position);
  const project = useStore(projectStore, (s) => s.project);
  return <div class="playhead" style={{ left: secToBeats(project, pos) * px + 'px' }} />;
}

function PlayheadRuler({ px, scrollLeft }: { px: number; scrollLeft: number }): preact.JSX.Element {
  const pos = useStore(transportStore, (s) => s.position);
  const project = useStore(projectStore, (s) => s.project);
  return <div style={{ position: 'absolute', top: 0, bottom: 0, width: '1px', background: '#e8edf0', left: secToBeats(project, pos) * px - scrollLeft + 'px', pointerEvents: 'none' }} />;
}

function PinEditor({ draft, onClose }: { draft: { track: Track; beat: number; x: number; y: number }; onClose: () => void }): preact.JSX.Element {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const project = projectStore.get().project;
  const send = async () => {
    if (!text.trim()) return onClose();
    const bb = barBeat(project, draft.beat);
    await invoke('feedback-add', { kind: 'pin', text: text.trim(), target: { track: draft.track.name, beat: draft.beat, bar: bb.bar } });
    toast('Sent to the AI.');
    onClose();
  };
  return (
    <div class="overlay" style={{ background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="popover" style={{ position: 'fixed', left: Math.min(draft.x, window.innerWidth - 360) + 'px', top: Math.min(draft.y, window.innerHeight - 120) + 'px', padding: '10px', width: '340px', display: 'flex', gap: '8px', flexDirection: 'column' }}>
        <div class="muted" style={{ fontSize: '11px' }}>Note for the AI · {draft.track.name} · bar {barBeat(project, draft.beat).bar}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input ref={ref} type="text" style={{ flex: 1 }} placeholder="e.g. too busy here, drop the hats" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') onClose(); }} />
          <Btn primary onClick={send}>Send</Btn>
        </div>
      </div>
    </div>
  );
}

export { Icon, useMemo };
