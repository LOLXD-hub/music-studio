import { useRef, useState } from 'preact/hooks';
import { projectStore, uiStore, useStore } from './state.ts';
import { Btn, Modal, Slider } from './ui.tsx';
import { exec } from './api.ts';

interface PD {
  id: string;
  name: string;
  min: number;
  max: number;
  def: number;
  step?: number;
  unit?: string;
  options?: string[];
  group?: string;
  log?: boolean;
}

function fmt(v: number, p: PD): string {
  if (p.options) return p.options[Math.round(v)] ?? String(v);
  const a = Math.abs(v);
  const s = a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3);
  return s.replace(/\.?0+$/, '') + (p.unit ? ' ' + p.unit : '');
}

export function ParamPanel({ params, values, onChange }: { params: PD[]; values: Record<string, number | string>; onChange: (id: string, v: number) => void }): preact.JSX.Element {
  const groups = new Map<string, PD[]>();
  for (const p of params) {
    const g = p.group ?? 'Parameters';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  const numeric = (p: PD): number => {
    const v = values[p.id];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && p.options) {
      const i = p.options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
      if (i >= 0) return i;
    }
    return p.def;
  };
  const [, bump] = useState(0);
  return (
    <div>
      {[...groups.entries()].map(([g, list]) => (
        <div key={g} style={{ marginBottom: '10px' }}>
          <div class="group-h" style={{ paddingLeft: 0 }}>{g}</div>
          <div class="pgrid">
            {list.map((p) => {
              const v = numeric(p);
              return (
                <div class="prow" key={p.id}>
                  <span title={p.id}>{p.name}</span>
                  {p.options ? (
                    <select value={String(Math.round(v))} onChange={(e) => { onChange(p.id, +(e.target as HTMLSelectElement).value); bump((n) => n + 1); }}>
                      {p.options.map((o, i) => <option value={String(i)} key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <Slider value={v} min={p.min} max={p.max} step={p.step ?? 0.001} log={p.log && p.min > 0} onInput={(x) => { onChange(p.id, x); bump((n) => n + 1); }} />
                  )}
                  <span class="v">{p.options ? '' : fmt(v, p)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number): (...a: T) => void {
  const t = useRef<number>(0);
  return (...a: T) => {
    clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(...a), ms);
  };
}

export function FxEditor(): preact.JSX.Element | null {
  const ed = useStore(uiStore, (s) => s.fxEditor);
  const project = useStore(projectStore, (s) => s.project);
  const catalog = useStore(uiStore, (s) => s.catalog);
  const [local, setLocal] = useState<Record<string, number>>({});
  const send = useDebounced((fx: string, id: string, v: number) => exec('effects', { action: 'update', fx, params: { [id]: v } }), 90);
  if (!ed) return null;
  const owner = ed.track === 'master' ? null : project.tracks.find((t) => t.id === ed.track);
  const fx = (owner ? owner.inserts : project.master.inserts).find((f) => f.id === ed.fx);
  const def = catalog?.effects.find((d: any) => d.type === fx?.type);
  if (!fx || !def) return null;
  const values = { ...Object.fromEntries(def.params.map((p: PD) => [p.id, p.def])), ...fx.params, ...local };
  return (
    <Modal title={`${def.name}${owner ? ' on ' + owner.name : ' on master'}`} onClose={() => { setLocal({}); uiStore.set({ fxEditor: null }); }}
      footer={<>
        <Btn cls="danger" icon="trash" onClick={() => { exec('effects', { action: 'remove', fx: fx.id }); uiStore.set({ fxEditor: null }); }}>Remove</Btn>
        <Btn on={!!fx.bypass} onClick={() => exec('effects', { action: 'update', fx: fx.id, bypass: !fx.bypass })}>{fx.bypass ? 'Bypassed' : 'Bypass'}</Btn>
        <Btn primary onClick={() => { setLocal({}); uiStore.set({ fxEditor: null }); }}>Done</Btn>
      </>}>
      <div class="muted" style={{ marginBottom: '10px' }}>{def.description}</div>
      {def.presets.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {def.presets.map((p: string) => <span key={p} class="chip click" onClick={() => { setLocal({}); exec('effects', { action: 'update', fx: fx.id, preset: p }); }}>{p}</span>)}
        </div>
      )}
      <ParamPanel params={def.params} values={values} onChange={(id, v) => { setLocal((l) => ({ ...l, [id]: v })); send(fx.id, id, v); }} />
    </Modal>
  );
}

export function InstEditor(): preact.JSX.Element | null {
  const id = useStore(uiStore, (s) => s.instEditor);
  const project = useStore(projectStore, (s) => s.project);
  const catalog = useStore(uiStore, (s) => s.catalog);
  const [local, setLocal] = useState<Record<string, number>>({});
  const send = useDebounced((track: string, pid: string, v: number) => exec('instruments', { action: 'set', track, params: { [pid]: v } }), 90);
  if (!id) return null;
  const t = project.tracks.find((x) => x.id === id);
  const def = catalog?.instruments.find((d: any) => d.type === t?.instrument?.type);
  if (!t?.instrument || !def) return null;
  const presetVals = (t.instrument.preset && def.presetValues?.[t.instrument.preset]) || {};
  const values = { ...Object.fromEntries(def.params.map((p: PD) => [p.id, p.def])), ...presetVals, ...t.instrument.params, ...local };
  return (
    <Modal title={`${t.name}: ${def.name}`} onClose={() => { setLocal({}); uiStore.set({ instEditor: null }); }} footer={<Btn primary onClick={() => { setLocal({}); uiStore.set({ instEditor: null }); }}>Done</Btn>}>
      <div class="muted" style={{ marginBottom: '8px' }}>{def.description}</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {def.presets.map((p: string) => <span key={p} class={'chip click' + (t.instrument?.preset === p ? ' accent' : '')} onClick={() => { setLocal({}); exec('instruments', { action: 'set', track: t.id, preset: p, reset: true }); }}>{p}</span>)}
      </div>
      {def.articulations.length > 0 && <div class="muted" style={{ marginBottom: '10px', fontSize: '11.5px' }}>Articulations this instrument understands: {def.articulations.join(', ')}</div>}
      <ParamPanel params={def.params} values={values} onChange={(pid, v) => { setLocal((l) => ({ ...l, [pid]: v })); send(t.id, pid, v); }} />
    </Modal>
  );
}
