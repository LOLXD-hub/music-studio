import { useEffect, useRef, useState } from 'preact/hooks';
import { projectStore, transportStore, uiStore, useStore, createStore, toast, secToBeats } from './state.ts';
import { Btn, Icon, Slider } from './ui.tsx';
import { exec, invoke, pickFiles } from './api.ts';
import { audio } from './audio.ts';

export const sfxStore = createStore({ id: '', wave: null as Float32Array | null, sampleRate: 44100 });

interface Item {
  id: string;
  name: string;
  folder: string;
  tags: string[];
  source: 'builtin' | 'user';
  favorite?: boolean;
}

function Wave(): preact.JSX.Element {
  const w = useStore(sfxStore, (s) => s.wave);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    if (!w) return;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, H / 2, W, 1);
    const step = w.length / W;
    for (let x = 0; x < W; x++) {
      let mx = 0, mn = 0;
      for (let i = Math.floor(x * step); i < Math.min(w.length, Math.floor((x + 1) * step)); i++) { mx = Math.max(mx, w[i]); mn = Math.min(mn, w[i]); }
      g.fillStyle = '#b9966a';
      g.fillRect(x, H / 2 - mx * (H / 2 - 3), 1, Math.max(1, (mx - mn) * (H / 2 - 3)));
    }
  }, [w]);
  return <canvas class="wave" ref={ref} />;
}

const EDITS: { k: string; label: string; min: number; max: number; step?: number; unit?: string; def: number }[] = [
  { k: 'gain', label: 'Gain', min: -24, max: 12, step: 0.5, unit: 'dB', def: 0 },
  { k: 'pitch', label: 'Pitch', min: -24, max: 24, step: 1, unit: 'st', def: 0 },
  { k: 'lp', label: 'Low-pass', min: 300, max: 20000, unit: 'Hz', def: 20000 },
  { k: 'hp', label: 'High-pass', min: 20, max: 4000, unit: 'Hz', def: 20 },
  { k: 'reverb', label: 'Reverb', min: 0, max: 1, def: 0 },
  { k: 'echo', label: 'Echo', min: 0, max: 1, def: 0 },
  { k: 'drive', label: 'Drive', min: 0, max: 24, unit: 'dB', def: 0 },
  { k: 'fade_in', label: 'Fade in', min: 0, max: 1, unit: 's', def: 0 },
  { k: 'fade_out', label: 'Fade out', min: 0, max: 2, unit: 's', def: 0 },
];

export function SoundFx(): preact.JSX.Element {
  const catalog = useStore(uiStore, (s) => s.catalog);
  const [tree, setTree] = useState<{ category: string; count: number; folders: { folder: string; count: number }[] }[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(120);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loc, setLoc] = useState<Record<string, number>>({});
  const [onlyFav, setOnlyFav] = useState(false);
  const [counts, setCounts] = useState({ total: 0, user: 0, hidden: 0 });
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const tm = useRef<number>(0);

  const loadTree = async () => {
    const r = await exec('sfx', { action: 'categories' }, { quiet: true });
    if (r) { setTree(r.result.tree); setCounts(r.result.counts); }
  };
  const loadItems = async () => {
    const r = await exec('sfx', { action: 'search', query: query || undefined, category: cat ?? undefined, folder: folder ?? undefined, favorites: onlyFav || undefined, limit }, { quiet: true });
    if (r) { setItems(r.result.items); setTotal(r.result.total); }
  };
  useEffect(() => { loadTree(); }, []);
  useEffect(() => { clearTimeout(tm.current); tm.current = window.setTimeout(loadItems, 120); }, [query, cat, folder, limit, onlyFav]);

  const select = async (id: string, play = true) => {
    setSelId(id);
    setLoc({});
    const r = await exec('sfx', { action: 'get', id }, { quiet: true });
    if (r) setDetail(r.result.item);
    if (play) preview(id);
  };
  const preview = async (id: string) => { await exec('sfx', { action: 'preview', id }, { quiet: true }); };
  const params: any[] = detail?.family ? (catalog?.sfxFamilies[detail.family] ?? []) : [];

  const applyParam = async (k: string, v: number) => {
    if (!selId) return;
    const r = await exec('sfx', { action: 'edit', id: selId, params: { [k]: v } });
    if (r) { setDetail(r.result.item); preview(selId); }
  };
  const applyEdit = async (k: string, v: number) => {
    if (!selId) return;
    const key = k;
    const r = await exec('sfx', { action: 'edit', id: selId, [key]: v });
    if (r) { setDetail(r.result.item); preview(selId); }
  };
  const editVal = (k: string, def: number): number => {
    if (loc[k] !== undefined) return loc[k];
    const e = detail?.edit ?? {};
    const map: Record<string, string> = { fade_in: 'fadeIn', fade_out: 'fadeOut' };
    return e[map[k] ?? k] ?? def;
  };

  return (
    <div class="fx-view grow" style={{ flex: 1, minHeight: 0 }}>
      <div class="panel">
        <div class="ph">Library <span class="faint" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{counts.total} sounds</span></div>
        <div class="pb tree list">
          <div class={'cat' + (!cat ? ' sel' : '')} onClick={() => { setCat(null); setFolder(null); }}><Icon n="music" size={14} /><span style={{ flex: 1 }}>All sounds</span><span class="faint">{counts.total}</span></div>
          <div class={'cat' + (onlyFav ? ' sel' : '')} onClick={() => setOnlyFav(!onlyFav)}><Icon n="star" size={14} /><span style={{ flex: 1 }}>Favourites</span></div>
          {tree.map((c) => (
            <div key={c.category}>
              <div class={'cat' + (cat === c.category && !folder ? ' sel' : '')} onClick={() => { setCat(c.category); setFolder(null); setOpenCats((s) => new Set(s.has(c.category) ? [...s].filter((x) => x !== c.category) : [...s, c.category])); }}>
                <Icon n="chevron" size={12} /><span style={{ flex: 1 }}>{c.category}</span><span class="faint">{c.count}</span>
              </div>
              {(openCats.has(c.category) || cat === c.category) && c.folders.map((f) => (
                <div key={f.folder} class={'fol' + (folder === f.folder ? ' sel' : '')} onClick={() => { setCat(c.category); setFolder(f.folder); }}>
                  <span>{f.folder.split('/').slice(1).join('/') || f.folder}</span><span class="faint">{f.count}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div class="panel">
        <div class="ph" style={{ gap: '8px' }}>
          <div class="field" style={{ flex: 1, textTransform: 'none', letterSpacing: 0 }}>
            <Icon n="search" size={14} />
            <input type="search" style={{ flex: 1 }} placeholder="Search 1000+ sounds: laser, door, riser, rain…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </div>
          <Btn sm icon="import" onClick={async () => { const f = await pickFiles('Import sounds', [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aiff'] }], true); for (const p of f) await exec('sfx', { action: 'import', path: p, category: cat && !['My Sounds'].includes(cat) ? 'My Sounds' : cat ?? 'My Sounds' }); if (f.length) { toast(`Imported ${f.length} sound(s).`); loadTree(); loadItems(); } }}>Import</Btn>
          <Btn sm icon="folder" onClick={async () => { const d = await window.msai.invoke('dialog-open', { title: 'Import a folder of sounds', dir: true }); if (d[0]) { const r = await exec('sfx', { action: 'import_folder', dir: d[0] }); if (r) { toast(r.result.summary); loadTree(); loadItems(); } } }}>Folder</Btn>
          <Btn sm icon="plus" onClick={async () => {
            const fams = Object.keys(catalog?.sfxFamilies ?? {});
            const f = window.prompt('New sound from which family?\n' + fams.join(', '), 'laser');
            if (!f) return;
            const r = await exec('sfx', { action: 'add', family: f });
            if (r) { toast(r.result.summary); loadTree(); await loadItems(); select(r.result.item.id); }
          }}>New</Btn>
        </div>
        <div class="pb list" style={{ padding: '0 8px 10px' }}>
          {items.length === 0 && <div class="empty"><div class="big">No sounds match</div><div>Try another word or clear the folder filter.</div></div>}
          {items.map((i) => (
            <div key={i.id} class={'sfx-row' + (selId === i.id ? ' sel' : '')} onClick={() => select(i.id)}>
              <Btn sm cls="ghost" icon="play" onClick={(e) => { e.stopPropagation(); select(i.id); }} />
              <div class="nm">{i.name}{i.source === 'user' && <span class="chip accent" style={{ marginLeft: '8px', height: '17px' }}>mine</span>}</div>
              <div class="fo">{i.folder.split('/').slice(1).join(' / ') || i.folder}</div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: i.favorite ? 'var(--amber)' : 'var(--faint)', cursor: 'pointer' }} onClick={async (e) => { e.stopPropagation(); await exec('sfx', { action: 'favorite', id: i.id, on: !i.favorite }); loadItems(); }}><Icon n="star" size={14} fill={!!i.favorite} /></span>
              </div>
            </div>
          ))}
          {items.length < total && <div style={{ textAlign: 'center', padding: '10px' }}><Btn sm onClick={() => setLimit(limit + 200)}>Show more ({total - items.length} left)</Btn></div>}
        </div>
      </div>

      <div class="panel">
        <div class="ph">Sound</div>
        <div class="pb" style={{ padding: '0 14px 14px' }}>
          {!detail ? <div class="empty"><div class="big">Pick a sound</div><div>Click any sound to hear it. Then change its parameters, add effects, place it on the timeline, or export it.</div></div> : (
            <>
              <div style={{ fontWeight: 650, fontSize: '15px', marginBottom: '2px' }}>{detail.name}</div>
              <div class="muted" style={{ fontSize: '11.5px', marginBottom: '8px' }}>{detail.folder} · {detail.source === 'user' ? 'your sound' : 'built-in'}</div>
              <Wave />
              <div style={{ display: 'flex', gap: '6px', margin: '10px 0', flexWrap: 'wrap' }}>
                <Btn primary icon="play" onClick={() => preview(detail.id)}>Play</Btn>
                <Btn icon="plus" onClick={async () => { const at = Math.round(secToBeats(projectStore.get().project, transportStore.get().position) * 4) / 4; const r = await exec('sfx', { action: 'place', id: detail.id, at }); if (r) toast(r.result.summary); }}>Place at playhead</Btn>
                <Btn icon="export" onClick={async () => { const f = await window.msai.invoke('dialog-save', { title: 'Export sound', defaultPath: detail.name + '.wav', filters: [{ name: 'WAV', extensions: ['wav'] }, { name: 'FLAC', extensions: ['flac'] }, { name: 'MP3', extensions: ['mp3'] }] }); if (f) { const r = await exec('sfx', { action: 'export', id: detail.id, path: f }); if (r) { toast(r.result.summary); invoke('open-path', f); } } }}>Export</Btn>
              </div>
              {params.length > 0 && (
                <>
                  <div class="group-h" style={{ paddingLeft: 0 }}>Character</div>
                  <div class="pgrid">
                    {params.map((p: any) => {
                      const v = loc[p.k] ?? detail.params?.[p.k] ?? (p.min + p.max) / 2;
                      return (
                        <div class="prow" key={p.k} title={`${p.lo} to ${p.hi}`}>
                          <span>{p.k}</span>
                          <Slider value={v} min={p.min} max={p.max} step={Math.abs(p.max - p.min) > 20 ? 1 : 0.001} log={p.min > 0 && p.max / p.min > 20} onInput={(x) => setLoc((l) => ({ ...l, [p.k]: x }))} onChange={(x) => applyParam(p.k, x)} />
                          <span class="v">{v >= 100 ? v.toFixed(0) : v.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <div class="group-h" style={{ paddingLeft: 0 }}>Edit chain</div>
              <div class="pgrid">
                {EDITS.map((e) => {
                  const v = editVal(e.k, e.def);
                  return (
                    <div class="prow" key={e.k}>
                      <span>{e.label}</span>
                      <Slider value={v} min={e.min} max={e.max} step={e.step ?? 0.001} log={e.k === 'lp' || e.k === 'hp'} onInput={(x) => setLoc((l) => ({ ...l, [e.k]: x }))} onChange={(x) => applyEdit(e.k, x)} />
                      <span class="v">{Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '6px', margin: '12px 0 4px', flexWrap: 'wrap' }}>
                <Btn sm on={!!detail.edit?.reverse} onClick={() => applyEdit('reverse', detail.edit?.reverse ? 0 : 1)}>Reverse</Btn>
                <Btn sm onClick={async () => { const r = await exec('sfx', { action: 'edit', id: detail.id, reset: true }); if (r) { setLoc({}); setDetail(r.result.item); preview(detail.id); } }}>Reset edits</Btn>
                {detail.source === 'builtin' && detail.family && <Btn sm icon="plus" onClick={async () => { const r = await exec('sfx', { action: 'add', family: detail.family, params: { ...detail.params }, name: detail.name + ' (mine)' }); if (r) { toast('Saved to My Sounds.'); loadTree(); } }}>Save a copy</Btn>}
                <Btn sm cls="danger" icon="trash" onClick={async () => { const r = await exec('sfx', { action: 'delete', id: detail.id }); if (r) { toast(r.result.summary); setDetail(null); setSelId(null); loadTree(); loadItems(); } }}>{detail.source === 'user' ? 'Delete' : 'Hide'}</Btn>
              </div>
              {counts.hidden > 0 && <Btn sm cls="ghost" onClick={async () => { const r = await exec('sfx', { action: 'restore' }); if (r) { toast(r.result.summary); loadTree(); loadItems(); } }}>Restore {counts.hidden} hidden</Btn>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { audio };
