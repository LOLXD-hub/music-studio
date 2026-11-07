import { useEffect, useState } from 'preact/hooks';
import { projectStore, uiStore, useStore, toast } from './state.ts';
import { Btn, Icon } from './ui.tsx';
import { exec, invoke, pickFiles } from './api.ts';

const CAT_ORDER = ['keys', 'strings', 'plucked', 'synth', 'drums', 'percussion', 'sampler'];
const CAT_LABEL: Record<string, string> = { keys: 'Keys', strings: 'Strings, winds and voices', plucked: 'Plucked', synth: 'Synths', drums: 'Drums', percussion: 'Mallets and bells', sampler: 'Sampler' };

export function Browser(): preact.JSX.Element {
  const tab = useStore(uiStore, (s) => s.browserTab);
  const catalog = useStore(uiStore, (s) => s.catalog);
  const selTrack = useStore(uiStore, (s) => s.selTrack);
  const [open, setOpen] = useState<string | null>('piano');
  const [projects, setProjects] = useState<{ file: string; modified: string }[]>([]);
  const [vst, setVst] = useState<{ name: string; vendor?: string; path: string }[] | null>(null);

  useEffect(() => {
    if (tab === 'files') exec('studio', { action: 'list_projects' }, { quiet: true }).then((r) => r && setProjects(r.result.projects));
  }, [tab]);

  const addTrack = async (type: string, preset: string, name: string) => {
    const r = await exec('tracks', { action: 'add', name, instrument: type, preset });
    if (r) uiStore.set({ selTrack: r.result.track.id });
  };

  const instruments = (catalog?.instruments ?? []).filter((d: any) => d.type !== 'sampler');
  const groups = CAT_ORDER.map((c) => [c, instruments.filter((d: any) => d.category === c)] as const).filter(([, l]) => l.length);

  return (
    <div class="panel grow">
      <div class="ph">Browser</div>
      <div class="tabs">
        {([['instruments', 'Sounds'], ['effects', 'Effects'], ['files', 'Files'], ['plugins', 'Plugins']] as const).map(([k, l]) => (
          <button key={k} class={tab === k ? 'on' : ''} onClick={() => uiStore.set({ browserTab: k })}>{l}</button>
        ))}
      </div>
      <div class="pb">
        {tab === 'instruments' && (
          <div class="list">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div class="group-h">{CAT_LABEL[cat] ?? cat}</div>
                {list.map((d: any) => (
                  <div key={d.type}>
                    <div class="row" onClick={() => setOpen(open === d.type ? null : d.type)}>
                      <Icon n="chevron" size={12} />
                      <span style={{ flex: 1, fontWeight: 600 }}>{d.name}</span>
                      <span class="faint" style={{ fontSize: '11px' }}>{d.presets.length}</span>
                    </div>
                    {open === d.type && d.presets.map((p: string) => (
                      <div key={p} class="row" style={{ paddingLeft: '30px', color: 'var(--muted)' }} title="Add a track with this sound" onClick={() => addTrack(d.type, p, p.replace(/\s*\(.*\)/, ''))}>
                        <Icon n="plus" size={12} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            <div class="group-h">More</div>
            <div class="row" onClick={() => exec('tracks', { action: 'add', name: 'Bus', kind: 'bus' })}><Icon n="plus" size={12} /><span>Effects bus</span></div>
            <div class="row" onClick={() => exec('tracks', { action: 'add', name: 'Audio', kind: 'audio' })}><Icon n="plus" size={12} /><span>Audio track</span></div>
          </div>
        )}
        {tab === 'effects' && (
          <div class="list">
            <div class="muted" style={{ padding: '2px 10px 6px', fontSize: '11.5px' }}>Adds to the selected track, or to the master when none is selected.</div>
            {(catalog?.effects ?? []).map((d: any) => (
              <div key={d.type} class="row" title={d.description} onClick={() => exec('effects', { action: 'add', track: selTrack ?? 'master', type: d.type })}>
                <Icon n="sliders" size={14} />
                <span style={{ flex: 1 }}>{d.name}</span>
                <span class="faint" style={{ fontSize: '10.5px' }}>{d.category}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'files' && (
          <div class="list">
            <div class="group-h">Project</div>
            <div class="row" onClick={async () => { const f = await pickFiles('Open project', [{ name: 'Music studio project', extensions: ['msai'] }]); if (f[0]) { const r = await exec('studio', { action: 'open', path: f[0] }); if (r) toast(r.result.summary); } }}><Icon n="folder" size={14} /><span>Open project…</span></div>
            <div class="row" onClick={async () => { const r = await exec('studio', { action: 'new' }); if (r) toast('New project.'); }}><Icon n="plus" size={14} /><span>New project</span></div>
            <div class="row" onClick={async () => { const r = await exec('studio', { action: 'save' }); if (r) toast(r.result.summary); }}><Icon n="save" size={14} /><span>Save</span></div>
            <div class="group-h">Import</div>
            <div class="row" onClick={async () => { const f = await pickFiles('Import audio', [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'aiff'] }], true); for (const p of f) { const r = await exec('clips', { action: 'add_audio', track: 'Audio', file: p, at: 0 }); if (r) toast(r.result.summary); } }}><Icon n="import" size={14} /><span>Audio file…</span></div>
            <div class="row" onClick={async () => { const f = await pickFiles('Import MIDI', [{ name: 'MIDI', extensions: ['mid', 'midi'] }]); if (f[0]) { const r = await exec('midi', { action: 'import', path: f[0] }); if (r) toast(r.result.summary); } }}><Icon n="import" size={14} /><span>MIDI file…</span></div>
            <div class="row" onClick={async () => { const f = await pickFiles('Load a sample into a sampler track', [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac'] }]); if (f[0]) { const t = await exec('tracks', { action: 'add', name: 'Sampler', instrument: 'sampler' }); if (t) { const r = await exec('instruments', { action: 'sampler', track: t.result.track.id, zones: [{ file: f[0], root: 'C4', lo: 0, hi: 127 }] }); if (r) toast(r.result.summary); } } }}><Icon n="wave" size={14} /><span>Sample to a keyboard…</span></div>
            <div class="group-h">Export</div>
            <div class="row" onClick={() => uiStore.set({ showExport: true })}><Icon n="export" size={14} /><span>Audio…</span></div>
            <div class="row" onClick={async () => { const r = await exec('midi', { action: 'export' }); if (r) { toast(r.result.summary); invoke('open-path', r.result.path); } }}><Icon n="export" size={14} /><span>MIDI file</span></div>
            <div class="row" onClick={async () => { const r = await exec('render', { action: 'stems' }); if (r) { toast(r.result.summary); invoke('open-path', r.result.dir); } }}><Icon n="export" size={14} /><span>Stems</span></div>
            <div class="group-h">Recent projects</div>
            {projects.length === 0 && <div class="faint" style={{ padding: '4px 10px' }}>None saved yet.</div>}
            {projects.slice(0, 12).map((p) => (
              <div key={p.file} class="row" onClick={async () => { const r = await exec('studio', { action: 'open', path: p.file }); if (r) toast(r.result.summary); }}>
                <Icon n="music" size={14} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file.split(/[\\/]/).pop()?.replace('.msai', '')}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'plugins' && (
          <div class="list">
            <div class="card" style={{ margin: '4px 6px 10px' }}>
              <h4>VST3</h4>
              <div class="muted" style={{ fontSize: '12px' }}>Installed plugins are found here. Hosting them inside the project needs a separate plugin-host process that is not part of this version, so they cannot be loaded yet. For recorded instruments, load samples or SoundFonts into a sampler track.</div>
              <div style={{ marginTop: '8px' }}><Btn sm onClick={async () => { const r = await exec('plugins', { action: 'scan' }); if (r) setVst(r.result.plugins); }}>Scan this computer</Btn></div>
            </div>
            {vst && vst.length === 0 && <div class="faint" style={{ padding: '4px 10px' }}>No VST3 plugins found.</div>}
            {vst?.map((p) => <div key={p.path} class="row" title={p.path}><Icon n="sliders" size={14} /><span style={{ flex: 1 }}>{p.name}</span><span class="faint" style={{ fontSize: '10.5px' }}>{p.vendor}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

export { projectStore };
