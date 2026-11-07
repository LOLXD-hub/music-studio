import { useEffect, useRef, useState } from 'preact/hooks';
import type { Track } from '../../engine/project.ts';
import { PPQ } from '../../engine/project.ts';
import { projectStore, uiStore, useStore, toast } from './state.ts';
import { Btn, Icon, Slider } from './ui.tsx';
import { exec } from './api.ts';
import { tone } from './color.ts';

const ROOMS: [string, string, string][] = [
  ['Dry booth', 'Small room', 'A close, dead recording space'],
  ['Studio', 'Studio room', 'A live room with some air'],
  ['Hall', 'Concert hall', 'A concert hall, 2.6 s tail'],
  ['Cathedral', 'Cathedral', 'Huge and slow, 6.5 s tail'],
];

const roomBus = (tracks: Track[]) => tracks.find((t) => t.kind === 'bus' && /room|hall|reverb/i.test(t.name));

/** Rough seat for an instrument on a stage: x 0..1 (left to right), y 0..1 (front to back). */
function seatFor(t: Track, scheme: string): [number, number] {
  const k = `${t.name} ${t.instrument?.preset ?? ''} ${t.instrument?.type ?? ''}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => k.includes(x));
  if (scheme === 'orchestra') {
    if (has('violin') && has('section', 'violins')) return [0.2, 0.3];
    if (has('viola')) return [0.38, 0.32];
    if (has('cello')) return [0.62, 0.32];
    if (has('bass') && has('double', 'section')) return [0.82, 0.42];
    if (has('flute', 'oboe', 'clarinet', 'bassoon', 'sax')) return [0.5, 0.52];
    if (has('horn', 'trumpet', 'trombone', 'tuba', 'brass')) return [0.5, 0.74];
    if (has('drums', 'mallet', 'percussion')) return [0.7, 0.86];
    if (has('harp')) return [0.12, 0.55];
    if (has('piano')) return [0.5, 0.12];
    if (has('choir')) return [0.5, 0.9];
    return [0.5, 0.45];
  }
  if (scheme === 'band') {
    if (has('drums')) return [0.5, 0.82];
    if (has('bass')) return [0.78, 0.55];
    if (has('guitar')) return [0.22, 0.5];
    if (has('piano', 'organ', 'keys', 'fm')) return [0.36, 0.6];
    if (has('synth', 'pad')) return [0.64, 0.62];
    return [0.5, 0.3];
  }
  if (scheme === 'trio') {
    if (has('bass')) return [0.74, 0.5];
    if (has('drums')) return [0.5, 0.8];
    if (has('piano')) return [0.28, 0.45];
    return [0.5, 0.25];
  }
  return [0.5, 0.5];
}

function Stage(): preact.JSX.Element {
  const project = useStore(projectStore, (s) => s.project);
  const sel = useStore(uiStore, (s) => s.selTrack);
  const box = useRef<HTMLDivElement>(null);
  const bus = roomBus(project.tracks);
  const insts = project.tracks.filter((t) => t.kind === 'instrument');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const depthOf = (t: Track): number => {
    const s = bus ? t.sends.find((x) => x.to === bus.id) : undefined;
    return s ? Math.min(1, Math.max(0, (s.level + 30) / 24)) : 0.2;
  };
  const rawPos = (t: Track): [number, number] => (drag?.id === t.id ? [drag.x, drag.y] : [(t.pan + 1) / 2, 0.12 + depthOf(t) * 0.76]);
  // players with the same pan and depth would sit on top of each other: fan them out sideways for display
  const posOf = (t: Track): [number, number] => {
    const [x, y] = rawPos(t);
    if (drag?.id === t.id) return [x, y];
    const same = insts.filter((o) => { const [ox, oy] = rawPos(o); return Math.abs(ox - x) < 0.08 && Math.abs(oy - y) < 0.07; });
    if (same.length < 2) return [x, y];
    const i = same.indexOf(t);
    return [Math.min(0.94, Math.max(0.06, x + (i - (same.length - 1) / 2) * 0.17)), y + (i % 2 ? 0.045 : -0.02)];
  };

  const setRoom = async (preset: string) => {
    let b = bus;
    if (!b) {
      const r = await exec('tracks', { action: 'add', name: 'Room', kind: 'bus' });
      if (!r) return;
      b = project.tracks.find((t) => t.id === r.result.track.id) ?? ({ id: r.result.track.id } as Track);
      await exec('effects', { action: 'add', track: r.result.track.id, type: 'reverb', preset, params: { mix: 1 } });
      for (const t of insts) await exec('effects', { action: 'send', track: t.id, to: r.result.track.id, level: -20 });
      toast('Room created and every instrument sent to it.');
      return;
    }
    const fx = b.inserts.find((f) => f.type === 'reverb');
    if (fx) await exec('effects', { action: 'update', fx: fx.id, preset, params: { mix: 1 } });
    else await exec('effects', { action: 'add', track: b.id, type: 'reverb', preset, params: { mix: 1 } });
  };

  const seat = async (scheme: string) => {
    if (!bus) await setRoom('Studio room');
    const p = projectStore.get().project;
    const b = roomBus(p.tracks);
    for (const t of p.tracks.filter((x) => x.kind === 'instrument')) {
      const [x, y] = seatFor(t, scheme);
      await exec('tracks', { action: 'update', track: t.id, pan: Math.round((x * 2 - 1) * 70) / 100 });
      if (b) await exec('effects', { action: 'send', track: t.id, to: b.id, level: Math.round(-30 + ((y - 0.12) / 0.76) * 24) });
    }
    toast('Seated.');
  };

  const down = (e: PointerEvent, t: Track) => {
    const el = box.current!;
    el.setPointerCapture?.(e.pointerId);
    uiStore.set({ selTrack: t.id });
    const rect = el.getBoundingClientRect();
    const calc = (ev: PointerEvent) => ({ x: Math.min(0.97, Math.max(0.03, (ev.clientX - rect.left) / rect.width)), y: Math.min(0.97, Math.max(0.05, (ev.clientY - rect.top) / rect.height)) });
    let cur = calc(e);
    setDrag({ id: t.id, ...cur });
    const mv = (m: PointerEvent) => { cur = calc(m); setDrag({ id: t.id, ...cur }); };
    const up = async () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      await exec('tracks', { action: 'update', track: t.id, pan: Math.round((cur.x * 2 - 1) * 100) / 100 });
      if (bus) await exec('effects', { action: 'send', track: t.id, to: bus.id, level: Math.round(-30 + ((cur.y - 0.12) / 0.76) * 24) });
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div class="panel" style={{ minHeight: 0 }}>
      <div class="ph">Stage <span class="faint" style={{ marginLeft: 'auto', letterSpacing: 0, textTransform: 'none' }}>drag players: left-right is pan, front-back is how much room they get</span></div>
      <div style={{ display: 'flex', gap: '6px', padding: '0 14px 10px', flexWrap: 'wrap' }}>
        {ROOMS.map(([n, p, d]) => <Btn sm key={n} title={d} onClick={() => setRoom(p)}>{n}</Btn>)}
        <span style={{ width: '1px', background: 'var(--line)', margin: '0 4px' }} />
        <Btn sm icon="music" onClick={() => seat('orchestra')}>Orchestra</Btn>
        <Btn sm onClick={() => seat('band')}>Band</Btn>
        <Btn sm onClick={() => seat('trio')}>Trio</Btn>
      </div>
      <div class="stage" ref={box}>
        <div class="lbl" style={{ left: '50%', top: '6px', transform: 'translateX(-50%)' }}>front</div>
        <div class="lbl" style={{ left: '50%', bottom: '6px', transform: 'translateX(-50%)' }}>back of the room</div>
        <div class="lbl" style={{ left: '10px', top: '50%' }}>L</div>
        <div class="lbl" style={{ right: '10px', top: '50%' }}>R</div>
        {insts.map((t) => {
          const [x, y] = posOf(t);
          return <div key={t.id} class={'chair' + (sel === t.id ? ' sel' : '')} style={{ left: x * 100 + '%', top: y * 100 + '%', background: tone(t.color, 0.36, 0.6) }} onPointerDown={(e) => down(e as never, t)}>{t.name}</div>;
        })}
        {insts.length === 0 && <div class="empty" style={{ position: 'absolute', inset: 0 }}><div>Instrument tracks appear here as players.</div></div>}
      </div>
    </div>
  );
}

function Lanes({ t }: { t: Track }): preact.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const project = useStore(projectStore, (s) => s.project);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const end = Math.max(1, ...t.clips.map((x) => x.start + x.len));
    const lanes: [number, string, string][] = [[11, 'Expression', '#7ba0bf'], [1, 'Vibrato', '#9d8ec0'], [64, 'Pedal', '#86b08a']];
    const rowH = H / lanes.length;
    lanes.forEach(([cc, label, col], i) => {
      const y0 = i * rowH;
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.fillRect(0, y0 + 2, W, rowH - 4);
      g.fillStyle = 'rgba(235,240,255,0.55)';
      g.font = '10px Segoe UI, sans-serif';
      g.fillText(label, 6, y0 + 13);
      const pts: { t: number; v: number }[] = [];
      for (const c2 of t.clips) if (c2.kind === 'midi') for (const l of c2.cc) if (l.cc === cc) for (const p of l.pts) pts.push({ t: c2.start + p.t, v: p.v });
      pts.sort((a, b) => a.t - b.t);
      if (!pts.length) return;
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      g.beginPath();
      pts.forEach((p, k) => {
        const x = (p.t / end) * W;
        const y = y0 + rowH - 4 - (p.v / 127) * (rowH - 10);
        if (k === 0) g.moveTo(x, y);
        else cc === 64 ? (g.lineTo(x, g.canvas ? y : y)) : g.lineTo(x, y);
      });
      g.stroke();
    });
    void project;
  }, [t, project.tempo]);
  return <canvas ref={ref} style={{ width: '100%', height: '120px', borderRadius: '2px', background: '#1b2024' }} />;
}

function Performance(): preact.JSX.Element {
  const project = useStore(projectStore, (s) => s.project);
  const selId = useStore(uiStore, (s) => s.selTrack);
  const sel = useStore(uiStore, (s) => s.selClip);
  const catalog = useStore(uiStore, (s) => s.catalog);
  const t = project.tracks.find((x) => x.id === selId && x.kind === 'instrument') ?? project.tracks.find((x) => x.kind === 'instrument');
  const [v, setV] = useState({ timing: 6, drift: 8, velocity: 6, tendency: 0, accent: 4 });
  const [rep, setRep] = useState<any>(null);
  if (!t) return <div class="panel"><div class="empty"><div class="big">No players yet</div><div>Add instrument tracks, then shape how they perform.</div></div></div>;
  const def = catalog?.instruments.find((d: any) => d.type === t.instrument?.type);
  const arts: string[] = def?.articulations ?? [];
  const noteCount = t.clips.reduce((a, c) => a + (c.kind === 'midi' ? c.notes.length : 0), 0);
  const clip = t.clips.find((c) => c.id === sel?.clip);
  return (
    <div class="panel">
      <div class="ph"><i class="swatch" style={{ background: tone(t.color, 0.36, 0.55) }} /> {t.name} <span class="faint" style={{ letterSpacing: 0, textTransform: 'none' }}>{t.instrument?.preset ?? t.instrument?.type}</span></div>
      <div class="pb" style={{ padding: '0 14px 14px' }}>
        <div class="muted" style={{ fontSize: '12px', marginBottom: '10px' }}>{noteCount} notes. Perform adds what a real player does for this instrument. Humanize loosens timing and velocity.</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <Btn primary icon="wand" onClick={async () => { const r = await exec('compose', { action: 'perform', track: t.id }); if (r) toast(r.result.summary); }}>Perform</Btn>
          <Btn icon="music" onClick={async () => { for (const x of project.tracks.filter((q) => q.kind === 'instrument' && q.clips.length)) await exec('compose', { action: 'perform', track: x.id }, { quiet: true }); toast('All tracks performed.'); }}>Perform all</Btn>
        </div>
        <div class="group-h" style={{ paddingLeft: 0 }}>Humanize</div>
        <div class="pgrid">
          {([['timing', 'Timing', 0, 25, 'ms'], ['drift', 'Drift', 0, 30, 'ms'], ['velocity', 'Velocity', 0, 20, ''], ['tendency', 'Feel', -20, 20, 'ms'], ['accent', 'Accent', 0, 20, '']] as const).map(([k, l, mn, mx, u]) => (
            <div class="prow" key={k}><span>{l}</span><Slider value={v[k]} min={mn} max={mx} step={0.5} onInput={(x) => setV({ ...v, [k]: x })} /><span class="v">{v[k].toFixed(1)}{u}</span></div>
          ))}
        </div>
        <div style={{ margin: '10px 0' }}>
          <Btn sm icon="wand" onClick={async () => { const r = await exec('compose', { action: 'humanize', track: t.id, timing_ms: v.timing, drift_ms: v.drift, velocity: v.velocity, tendency_ms: v.tendency, accent: v.accent }); if (r) toast(r.result.summary); }}>Apply to {t.name}</Btn>
        </div>
        {arts.length > 0 && (
          <>
            <div class="group-h" style={{ paddingLeft: 0 }}>Articulation for the selected clip</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {arts.map((a) => <span key={a} class="chip click" onClick={async () => {
                if (!clip || clip.kind !== 'midi') return toast('Select a MIDI clip of this track first.', true);
                const r = await exec('notes', { action: 'transform', track: t.id, op: 'set_articulation', art: a, from: clip.start / PPQ, to: (clip.start + clip.len) / PPQ });
                if (r) toast(r.result.summary);
              }}>{a}</span>)}
              <span class="chip click" onClick={async () => { if (clip) await exec('notes', { action: 'transform', track: t.id, op: 'set_articulation', art: '', from: clip.start / PPQ, to: (clip.start + clip.len) / PPQ }); }}>clear</span>
            </div>
          </>
        )}
        <div class="group-h" style={{ paddingLeft: 0 }}>Controller lanes</div>
        <Lanes t={t} />
        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div class="group-h" style={{ padding: 0, flex: 1 }}>Realism check</div>
          <Btn sm icon="sparkle" onClick={async () => { const r = await exec('critique', { action: 'composition', tracks: [t.id] }); if (r) setRep(r.result); }}>Check {t.name}</Btn>
        </div>
        {rep && (rep.findings.filter((f: any) => ['humanization', 'orchestration', 'rhythm', 'dynamics'].includes(f.category)).length === 0
          ? <div class="chip good" style={{ marginTop: '8px' }}>Nothing mechanical found.</div>
          : rep.findings.filter((f: any) => ['humanization', 'orchestration', 'rhythm', 'dynamics'].includes(f.category)).map((f: any, i: number) => <div key={i} class={'finding ' + f.severity}><b>{f.category}</b><p>{f.problem}</p><div class="muted" style={{ fontSize: '11.5px' }}>{f.fix}</div></div>))}
      </div>
    </div>
  );
}

export function Live(): preact.JSX.Element {
  return (
    <div class="live-view grow" style={{ flex: 1, minHeight: 0 }}>
      <Stage />
      <Performance />
    </div>
  );
}

export { Icon };
