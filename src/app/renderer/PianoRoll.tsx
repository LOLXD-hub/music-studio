import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PPQ } from '../../engine/project.ts';
import type { MidiClip } from '../../engine/project.ts';
import { projectStore, transportStore, uiStore, useStore, secToBeats, beatsPerBar, toast } from './state.ts';
import { Btn } from './ui.tsx';
import { exec, invoke } from './api.ts';
import { audio } from './audio.ts';
import { noteTone } from './color.ts';
import { midiToName } from '../../theory/pitch.ts';

interface RN {
  id: string;
  t: number; // beats, relative to clip
  d: number;
  p: number;
  v: number;
  art?: string;
}

const KEYS = 58;
const RULER = 22;
const VEL = 62;
const BLACK = new Set([1, 3, 6, 8, 10]);

type Drag =
  | { kind: 'add'; id: string; t0: number }
  | { kind: 'move'; ids: string[]; startBeat: number; startPitch: number; orig: Map<string, RN> }
  | { kind: 'resize'; ids: string[]; startBeat: number; orig: Map<string, RN> }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'vel' }
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number };

export function PianoRoll(): preact.JSX.Element {
  const sel = useStore(uiStore, (s) => s.selClip);
  const snap = useStore(uiStore, (s) => s.snap);
  const project = useStore(projectStore, (s) => s.project);
  const track = project.tracks.find((t) => t.id === sel?.track);
  const clip = track?.clips.find((c) => c.id === sel?.clip && c.kind === 'midi') as MidiClip | undefined;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const [view, setView] = useState({ x0: 0, y0: 84, pxB: 56, pxP: 14 });
  const [draft, setDraft] = useState<RN[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lastLen = useRef(0.5);
  const bpb = beatsPerBar(project);

  const base: RN[] = useMemo(() => (clip ? clip.notes.map((n) => ({ id: n.id, t: n.t / PPQ, d: n.d / PPQ, p: n.p, v: n.v, art: n.art })) : []), [clip]);
  const notes = draft ?? base;
  useEffect(() => setDraft(null), [clip]);
  useEffect(() => setSelected(new Set()), [sel?.clip]);

  // fit the view to the clip when it opens
  useEffect(() => {
    if (!clip) return;
    const ns = clip.notes;
    const lo = ns.length ? Math.min(...ns.map((n) => n.p)) : 55;
    const hi = ns.length ? Math.max(...ns.map((n) => n.p)) : 76;
    const rows = Math.max(18, hi - lo + 8);
    const pxP = Math.max(9, Math.min(20, (size.h - RULER - VEL) / rows));
    const clipBeats = clip.len / PPQ;
    const pxB = Math.max(18, Math.min(120, (size.w - KEYS - 20) / Math.max(4, clipBeats)));
    setView({ x0: 0, y0: hi + 4, pxB, pxP });
    // eslint-disable-next-line
  }, [sel?.clip]);

  const open = !!clip && !!track;
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(120, el.clientHeight - 38) }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: Math.max(120, el.clientHeight - 38) });
    return () => ro.disconnect();
  }, [open]);

  const gridH = size.h - RULER - VEL;
  const xOf = (beat: number) => KEYS + (beat - view.x0) * view.pxB;
  const yOf = (pitch: number) => RULER + (view.y0 - pitch - 1) * view.pxP + view.pxP;
  const beatAt = (x: number) => view.x0 + (x - KEYS) / view.pxB;
  const pitchAt = (y: number) => Math.floor(view.y0 - (y - RULER) / view.pxP);
  const snapB = (b: number) => (snap > 0 ? Math.round(b / snap) * snap : b);

  // draw
  useLayoutEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    c.style.width = size.w + 'px';
    c.style.height = size.h + 'px';
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const color = track?.color ?? '#b88a5c';
    const clipBeats = clip ? clip.len / PPQ : 8;
    // pitch rows
    const topP = Math.ceil(view.y0);
    const botP = Math.floor(view.y0 - gridH / view.pxP) - 1;
    for (let p = botP; p <= topP; p++) {
      const y = RULER + (view.y0 - p - 1) * view.pxP + view.pxP;
      const y0 = y - view.pxP;
      if (y0 > RULER + gridH || y < RULER) continue;
      g.fillStyle = BLACK.has(((p % 12) + 12) % 12) ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.025)';
      g.fillRect(KEYS, Math.max(RULER, y0), size.w - KEYS, Math.min(gridH + RULER, y) - Math.max(RULER, y0));
      if (p % 12 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.1)';
        g.fillRect(KEYS, y - 0.5, size.w - KEYS, 1);
      }
    }
    // clip bounds shading
    const endX = xOf(clipBeats);
    if (endX < size.w) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(Math.max(KEYS, endX), RULER, size.w, gridH + VEL);
    }
    // vertical grid
    const b0 = Math.floor(view.x0);
    const b1 = Math.ceil(view.x0 + (size.w - KEYS) / view.pxB);
    const sub = snap > 0 ? snap : 0.25;
    const absStart = clip ? clip.start / PPQ : 0;
    for (let b = b0; b <= b1; b += Math.max(sub, view.pxB * sub < 7 ? 0.5 : sub)) {
      const x = xOf(b);
      if (x < KEYS) continue;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      const abs = b + absStart;
      const isBar = isBeat && Math.abs(abs / bpb - Math.round(abs / bpb)) < 1e-6;
      g.fillStyle = isBar ? 'rgba(255,255,255,0.28)' : isBeat ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)';
      g.fillRect(x, RULER - (isBar ? 6 : 0), 1, gridH + VEL + (isBar ? 6 : 0));
      if (isBar) {
        g.fillStyle = 'rgba(235,240,255,0.8)';
        g.font = '600 10.5px Segoe UI Variable Text, Segoe UI, sans-serif';
        g.fillText(String(Math.round(abs / bpb) + 1), x + 4, 13);
      }
    }
    // notes
    g.save();
    g.beginPath();
    g.rect(KEYS, RULER, size.w - KEYS, gridH);
    g.clip();
    for (const n of notes) {
      const x = xOf(n.t);
      const w = Math.max(3, n.d * view.pxB - 1);
      const y = RULER + (view.y0 - n.p - 1) * view.pxP + view.pxP - view.pxP + 0;
      const yy = RULER + (view.y0 - n.p - 1) * view.pxP;
      void y;
      if (x + w < KEYS || x > size.w || yy + view.pxP < RULER || yy > RULER + gridH) continue;
      const a = 0.45 + (n.v / 127) * 0.55;
      g.fillStyle = noteTone(color, a);
      g.beginPath();
      g.roundRect(x, yy + 0.5, w, view.pxP - 1, 1.5);
      g.fill();
      g.strokeStyle = selected.has(n.id) ? '#f2f5f7' : 'rgba(0,0,0,0.45)';
      g.lineWidth = selected.has(n.id) ? 2 : 1;
      g.stroke();
      if (w > 34 && view.pxP >= 11) {
        g.fillStyle = 'rgba(10,12,20,0.75)';
        g.font = '600 9.5px Segoe UI, sans-serif';
        g.fillText(midiToName(n.p), x + 4, yy + view.pxP - 3.5);
      }
    }
    g.restore();
    // velocity lane
    const vy = RULER + gridH;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(KEYS, vy, size.w - KEYS, VEL);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(KEYS, vy, size.w - KEYS, 1);
    for (const n of notes) {
      const x = xOf(n.t);
      if (x < KEYS || x > size.w) continue;
      const h = (n.v / 127) * (VEL - 8);
      g.fillStyle = selected.has(n.id) ? '#f2f5f7' : noteTone(color, 0.95);
      g.fillRect(x, vy + VEL - 4 - h, 3, h);
    }
    // keyboard
    for (let p = botP; p <= topP; p++) {
      const y0 = RULER + (view.y0 - p - 1) * view.pxP;
      if (y0 + view.pxP < RULER || y0 > RULER + gridH) continue;
      const black = BLACK.has(((p % 12) + 12) % 12);
      g.fillStyle = black ? '#2a3036' : '#c9d0d5';
      g.fillRect(0, y0, black ? KEYS * 0.62 : KEYS - 1, view.pxP - 0.5);
      if (!black) {
        g.fillStyle = 'rgba(0,0,0,0.0)';
      }
      if (p % 12 === 0) {
        g.fillStyle = '#20262a';
        g.font = '600 9.5px Segoe UI, sans-serif';
        g.fillText(midiToName(p), KEYS - 26, y0 + view.pxP - 3.5);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 0, KEYS, RULER);
    // marquee
    if (marquee) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.fillStyle = 'rgba(255,255,255,0.08)';
      const mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1);
      g.fillRect(mx, my, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      g.strokeRect(mx, my, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
  }, [notes, view, size, selected, snap, marquee, track?.color, clip?.len]);

  // playhead overlay
  useEffect(() => {
    return transportStore.subscribe(() => {
      const h = head.current;
      if (!h || !clip) return;
      const beat = secToBeats(projectStore.get().project, transportStore.get().position) - clip.start / PPQ;
      const x = KEYS + (beat - view.x0) * view.pxB;
      h.style.transform = `translateX(${x}px)`;
      h.style.display = x >= KEYS && x < size.w ? 'block' : 'none';
    });
  }, [view, clip, size.w]);

  const commit = async (list: RN[], silent = false) => {
    if (!clip || !track) return;
    const off = clip.start / PPQ;
    const r = await exec('notes', { action: 'set', track: track.id, clip: clip.id, notes: list.map((n) => ({ id: n.id, start: n.t + off, dur: n.d, pitch: n.p, vel: n.v, art: n.art })) }, { quiet: silent });
    if (!r) setDraft(null);
  };

  const hit = (x: number, y: number): { note: RN; edge: boolean } | null => {
    if (y < RULER || y > RULER + gridH || x < KEYS) return null;
    const b = beatAt(x);
    const p = pitchAt(y);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.p === p && b >= n.t - 0.001 && b <= n.t + n.d + 0.001) return { note: n, edge: xOf(n.t + n.d) - x < 7 && n.d * view.pxB > 12 };
    }
    return null;
  };

  const onDown = (e: PointerEvent) => {
    if (!clip) return;
    const r = cv.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x0, vy: view.y0 };
      return;
    }
    if (x < KEYS && y > RULER && y < RULER + gridH) {
      const p = pitchAt(y);
      if (track) audio.note(track.id, p, 100, 0.6);
      return;
    }
    if (y >= RULER + gridH) {
      // velocity lane
      const b = beatAt(x);
      const near = [...notes].sort((a, c) => Math.abs(a.t - b) - Math.abs(c.t - b))[0];
      if (near && Math.abs(xOf(near.t) - x) < 8) {
        dragRef.current = { kind: 'vel' };
        setVel(y, near.id);
      }
      return;
    }
    if (e.button === 2) {
      const h = hit(x, y);
      if (h) {
        const next = notes.filter((n) => n.id !== h.note.id);
        setDraft(next);
        commit(next);
      }
      return;
    }
    const h = hit(x, y);
    const b = beatAt(x);
    if (h) {
      let ids = [...selected];
      if (!selected.has(h.note.id)) {
        ids = e.shiftKey ? [...selected, h.note.id] : [h.note.id];
        setSelected(new Set(ids));
      } else if (e.shiftKey) {
        ids = ids.filter((i) => i !== h.note.id);
        setSelected(new Set(ids));
      }
      if (track) audio.note(track.id, h.note.p, h.note.v, 0.35);
      const orig = new Map(notes.filter((n) => ids.includes(n.id)).map((n) => [n.id, { ...n }]));
      dragRef.current = h.edge ? { kind: 'resize', ids, startBeat: b, orig } : { kind: 'move', ids, startBeat: b, startPitch: pitchAt(y), orig };
      return;
    }
    if (e.shiftKey) {
      dragRef.current = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y };
      setMarquee({ x0: x, y0: y, x1: x, y1: y });
      return;
    }
    // add a note
    const t = Math.max(0, snapB(b));
    const p = pitchAt(y);
    if (t >= clip.len / PPQ) return;
    const id = 'new' + Math.random().toString(36).slice(2, 8);
    const d = lastLen.current || (snap > 0 ? snap : 0.5);
    const nn: RN = { id, t, d, p, v: 92 };
    setDraft([...notes, nn]);
    setSelected(new Set([id]));
    dragRef.current = { kind: 'add', id, t0: t };
    if (track) audio.note(track.id, p, 92, 0.4);
  };

  const setVel = (y: number, id: string) => {
    const v = Math.max(1, Math.min(127, Math.round(((RULER + gridH + VEL - 4 - y) / (VEL - 8)) * 127)));
    const ids = selected.has(id) ? [...selected] : [id];
    setDraft(notes.map((n) => (ids.includes(n.id) ? { ...n, v } : n)));
  };

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || !clip) return;
    const r = cv.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x0: Math.max(0, d.vx - (e.clientX - d.x) / v.pxB), y0: Math.min(127, Math.max(12, d.vy + (e.clientY - d.y) / v.pxP)) }));
    } else if (d.kind === 'add') {
      const t = snapB(beatAt(x));
      const len = Math.max(snap > 0 ? snap : 0.125, t - d.t0);
      setDraft((cur) => (cur ?? notes).map((n) => (n.id === d.id ? { ...n, d: Math.max(snap > 0 ? snap : 0.125, snap > 0 ? Math.max(snap, len) : len) } : n)));
    } else if (d.kind === 'move') {
      const db = snapB(beatAt(x)) - snapB(d.startBeat);
      const dp = pitchAt(y) - d.startPitch;
      setDraft(notes.map((n) => {
        const o = d.orig.get(n.id);
        return o ? { ...n, t: Math.max(0, o.t + db), p: Math.max(0, Math.min(127, o.p + dp)) } : n;
      }));
    } else if (d.kind === 'resize') {
      const db = snapB(beatAt(x)) - snapB(d.startBeat);
      setDraft(notes.map((n) => {
        const o = d.orig.get(n.id);
        return o ? { ...n, d: Math.max(snap > 0 ? snap : 0.0625, o.d + db) } : n;
      }));
    } else if (d.kind === 'marquee') {
      const m = { ...d, x1: x, y1: y };
      dragRef.current = m;
      setMarquee(m);
    } else if (d.kind === 'vel') {
      const b = beatAt(x);
      void b;
      const near = [...selected][0] ?? notes[0]?.id;
      if (near) setVel(y, near);
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const ids = notes.filter((n) => {
        const nx = xOf(n.t), nx2 = xOf(n.t + n.d), ny = RULER + (view.y0 - n.p - 1) * view.pxP;
        return nx2 >= x0 && nx <= x1 && ny + view.pxP >= y0 && ny <= y1;
      }).map((n) => n.id);
      setSelected(new Set(ids));
      setMarquee(null);
      return;
    }
    if (d.kind === 'add') {
      const n = (draft ?? notes).find((x) => x.id === d.id);
      if (n) lastLen.current = n.d;
    }
    if (draft) commit(draft);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => ({ ...v, pxB: Math.max(10, Math.min(260, v.pxB * f)) }));
    } else if (e.shiftKey) setView((v) => ({ ...v, x0: Math.max(0, v.x0 + e.deltaY / v.pxB) }));
    else setView((v) => ({ ...v, y0: Math.min(127, Math.max(12, v.y0 + e.deltaY / v.pxP / 3)) }));
  };

  // keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (uiStore.get().dock !== 'roll' || !clip) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ids = selected;
      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.size) {
        e.preventDefault();
        const next = notes.filter((n) => !ids.has(n.id));
        setDraft(next);
        commit(next);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(notes.map((n) => n.id)));
      } else if (e.ctrlKey && e.key.toLowerCase() === 'd' && ids.size) {
        e.preventDefault();
        const picked = notes.filter((n) => ids.has(n.id));
        const span = Math.max(...picked.map((n) => n.t + n.d)) - Math.min(...picked.map((n) => n.t));
        const copies = picked.map((n) => ({ ...n, id: 'c' + Math.random().toString(36).slice(2, 8), t: n.t + span }));
        const next = [...notes, ...copies];
        setDraft(next);
        setSelected(new Set(copies.map((c) => c.id)));
        commit(next);
      } else if (e.key.startsWith('Arrow') && ids.size) {
        e.preventDefault();
        const dp = e.key === 'ArrowUp' ? (e.shiftKey ? 12 : 1) : e.key === 'ArrowDown' ? (e.shiftKey ? -12 : -1) : 0;
        const dt = e.key === 'ArrowRight' ? (snap || 0.25) : e.key === 'ArrowLeft' ? -(snap || 0.25) : 0;
        const next = notes.map((n) => (ids.has(n.id) ? { ...n, p: n.p + dp, t: Math.max(0, n.t + dt) } : n));
        setDraft(next);
        commit(next, true);
      } else if (e.key.toLowerCase() === 'q' && !e.ctrlKey && ids.size) {
        const next = notes.map((n) => (ids.has(n.id) && snap > 0 ? { ...n, t: Math.round(n.t / snap) * snap } : n));
        setDraft(next);
        commit(next);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!clip || !track) {
    return (
      <div class="empty" style={{ position: 'absolute', inset: 0 }}>
        <div class="big">Piano roll</div>
        <div>Double-click a clip, or double-click an empty lane of an instrument track, to edit its notes.</div>
      </div>
    );
  }

  const noteCount = notes.length;
  const off = clip.start / PPQ;
  return (
    <div class="roll" ref={wrap}>
      <div class="roll-bar">
        <i class="swatch" style={{ background: track.color }} />
        <b>{clip.name}</b>
        <span class="muted tnum">{noteCount} notes · {(clip.len / PPQ / bpb).toFixed(1)} bars</span>
        <span style={{ flex: 1 }} />
        <span class="muted">Snap</span>
        <select value={String(snap)} onChange={(e) => uiStore.set({ snap: +(e.target as HTMLSelectElement).value })}>
          <option value="1">1/4</option><option value="0.5">1/8</option><option value="0.25">1/16</option><option value="0.125">1/32</option><option value="0.3333333">1/8T</option><option value="0">Off</option>
        </select>
        <Btn sm onClick={() => exec('notes', { action: 'transform', track: track.id, op: 'quantize', from: off, to: off + clip.len / PPQ, grid: snap || 0.25 })}>Quantize</Btn>
        <Btn sm icon="wand" onClick={() => exec('compose', { action: 'humanize', track: track.id, from: off, to: off + clip.len / PPQ })}>Humanize</Btn>
        <Btn sm onClick={() => exec('notes', { action: 'transform', track: track.id, op: 'legato', from: off, to: off + clip.len / PPQ })}>Legato</Btn>
        <Btn sm icon="pin" onClick={async () => {
          const text = window.prompt('What should the AI change in this clip?');
          if (text) { await invoke('feedback-add', { kind: 'pin', text, target: { track: track.name, clip: clip.id, beat: off, bar: Math.floor(off / bpb) + 1 } }); toast('Sent to the AI.'); }
        }}>Ask AI</Btn>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas ref={cv} onPointerDown={onDown as never} onPointerMove={onMove as never} onPointerUp={onUp} onWheel={onWheel as never} onContextMenu={(e) => e.preventDefault()} style={{ cursor: 'crosshair', touchAction: 'none' }} />
        <div ref={head} class="playhead" style={{ top: RULER + 'px', display: 'none', left: 0, height: gridH + VEL + 'px', bottom: 'auto' }} />
      </div>
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export { invoke };
