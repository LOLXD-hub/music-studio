import { useEffect, useState } from 'preact/hooks';
import { uiStore, projectStore, useStore, toast, setAppName, APP_NAMES } from './state.ts';
import { Btn, Icon, Modal } from './ui.tsx';
import { exec, invoke } from './api.ts';

interface Client {
  id: string;
  name: string;
  detected: boolean;
  skillInstalled: boolean;
  mcpConfigured: boolean;
  skillPaths: string[];
  note: string;
}

export function ConnectDialog(): preact.JSX.Element | null {
  const show = useStore(uiStore, (s) => s.showConnect);
  const ep = useStore(uiStore, (s) => s.endpoint);
  const [clients, setClients] = useState<Client[]>([]);
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const refresh = async () => setClients(await invoke('connect-detect'));
  useEffect(() => {
    if (!show) return;
    refresh();
    invoke('connect-info').then(setInfo);
  }, [show]);
  if (!show) return null;

  const close = () => {
    uiStore.set({ showConnect: false });
    invoke('settings-set', { onboarded: true });
  };
  const install = async (c: Client, what: 'skill' | 'mcp' | 'both') => {
    setBusy(c.id + what);
    const r = await invoke('connect-install', { client: c.id, what });
    setBusy(null);
    if (r.ok) toast(`${c.name}: ${what === 'skill' ? 'skill installed' : what === 'mcp' ? 'connection added' : 'connected and skill installed'}. ${c.id === 'claude-code' ? 'Start a new session to pick it up.' : 'Restart it to pick it up.'}`);
    else toast(r.error, true);
    refresh();
  };
  const found = clients.filter((c) => c.detected);
  const rest = clients.filter((c) => !c.detected);
  const row = (c: Client) => (
    <div class="client" key={c.id}>
      <div>
        <b>{c.name}</b>
        <div style={{ display: 'flex', gap: '5px', margin: '4px 0' }}>
          <span class={'chip' + (c.detected ? ' good' : '')}>{c.detected ? 'found' : 'not found'}</span>
          <span class={'chip' + (c.mcpConfigured ? ' good' : '')}>{c.mcpConfigured ? 'connected' : 'not connected'}</span>
          {c.skillPaths.length > 0 && <span class={'chip' + (c.skillInstalled ? ' good' : '')}>{c.skillInstalled ? 'skill installed' : 'no skill'}</span>}
        </div>
        <small>{c.note}</small>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' }}>
        <Btn primary sm disabled={busy !== null} onClick={() => install(c, c.skillPaths.length ? 'both' : 'mcp')}>{busy === c.id + 'both' || busy === c.id + 'mcp' ? 'Working…' : c.mcpConfigured && (c.skillInstalled || !c.skillPaths.length) ? 'Reinstall' : c.skillPaths.length ? 'Connect + skill' : 'Connect'}</Btn>
        {c.skillPaths.length > 0 && <Btn sm cls="ghost" onClick={() => install(c, 'skill')}>Skill only</Btn>}
      </div>
    </div>
  );

  return (
    <Modal title="Connect your AI" onClose={close} footer={<Btn primary onClick={close}>Done</Btn>}>
      <div class="muted" style={{ marginBottom: '14px' }}>
        AI agents drive the studio over MCP. Choose the ones you use. The app writes each one's connection and installs a skill that explains how to write music here, how to listen to the result, and how to export it.
      </div>
      {found.length === 0 && <div class="chip bad" style={{ marginBottom: '10px' }}>No supported AI client was found on this computer. Use a snippet below.</div>}
      {found.map(row)}
      {rest.length > 0 && <div style={{ margin: '8px 0' }}><Btn sm cls="ghost" onClick={() => setShowOther(!showOther)}>{showOther ? 'Hide' : 'Show'} clients that were not found ({rest.length})</Btn></div>}
      {showOther && rest.map(row)}

      <div class="card" style={{ margin: '14px 0 8px' }}>
        <h4>How your AI listens</h4>
        <div class="muted" style={{ fontSize: '12.5px', lineHeight: 1.55 }}>
          It cannot hear audio. After each change it asks the studio to render the song and reads loudness, spectral balance, stereo width and key, and looks at a spectrogram picture with bar numbers. You hear the real thing: press play. Pin a note on the timeline or type feedback, and the AI reads it on its next step.
        </div>
      </div>
      <div class="card" style={{ margin: '0 0 8px' }}>
        <h4>How it builds</h4>
        <div class="muted" style={{ fontSize: '12.5px', lineHeight: 1.55 }}>
          It plans in a brief, picks instruments, writes chords, bass, drums and melody as notes you can edit, performs them with human timing, mixes, then checks the result. Every call shows in the Agent deck, and Revert undoes a step. The skill teaches it to avoid loops that repeat for 32 bars, flat dynamics and stiff timing.
        </div>
      </div>

      <div class="card" style={{ margin: '0 0 8px' }}>
        <h4>Other clients</h4>
        <div class="muted" style={{ fontSize: '12px', marginBottom: '6px' }}>Any client that supports MCP can connect. Copy a snippet and the skill folder.</div>
        {info && Object.entries(info.snippets as Record<string, string>).map(([k, v]) => (
          <div key={k}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <b style={{ fontSize: '12px', flex: 1 }}>{k}</b>
              <Btn sm onClick={() => { invoke('copy', v); toast('Copied.'); }}>Copy</Btn>
            </div>
            <pre class="code">{v.replace(ep.token, '•••• token ••••')}</pre>
          </div>
        ))}
        {info && <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span class="muted" style={{ fontSize: '12px', flex: 1 }}>Skill folder: <span class="mono">{info.skillFolder}</span></span>
          <Btn sm onClick={() => invoke('open-path', info.skillFolder)}>Show</Btn>
        </div>}
      </div>
    </Modal>
  );
}

export function ExportDialog(): preact.JSX.Element | null {
  const show = useStore(uiStore, (s) => s.showExport);
  const project = useStore(projectStore, (s) => s.project);
  const [fmt, setFmt] = useState('wav');
  const [quality, setQuality] = useState('16');
  const [sr, setSr] = useState('44100');
  const [norm, setNorm] = useState(true);
  const [lufs, setLufs] = useState(-14);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  useEffect(() => { if (show) setRes(null); }, [show]);
  if (!show) return null;
  const q = fmt === 'wav' ? [['16', '16-bit'], ['24', '24-bit'], ['32', '32-bit float']] : fmt === 'flac' ? [['16', '16-bit'], ['24', '24-bit']] : [['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']];
  const choose = (f: string) => { setFmt(f); setQuality(f === 'wav' || f === 'flac' ? '16' : '256'); };
  const go = async () => {
    const f = await window.msai.invoke('dialog-save', { title: 'Export audio', defaultPath: `${project.name}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (!f) return;
    setBusy(true);
    const lossy = !['wav', 'flac'].includes(fmt);
    const r = await exec('render', { action: 'mixdown', path: f, format: fmt, bit_depth: lossy ? undefined : +quality, kbps: lossy ? +quality : undefined, sample_rate: +sr, normalize_lufs: norm ? lufs : undefined });
    setBusy(false);
    if (r) setRes(r.result);
  };
  return (
    <Modal title="Export audio" narrow onClose={() => uiStore.set({ showExport: false })} footer={<><Btn onClick={() => uiStore.set({ showExport: false })}>Close</Btn><Btn primary icon="export" disabled={busy} onClick={go}>{busy ? 'Rendering…' : 'Export…'}</Btn></>}>
      <div class="pgrid" style={{ gap: '10px' }}>
        <div class="prow"><span>Format</span>
          <select value={fmt} onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
            <option value="wav">WAV</option><option value="flac">FLAC (lossless)</option><option value="mp3">MP3</option><option value="ogg">OGG Vorbis (needs FFmpeg)</option><option value="m4a">M4A / AAC (needs FFmpeg)</option><option value="opus">Opus (needs FFmpeg)</option>
          </select><span /></div>
        <div class="prow"><span>Quality</span><select value={quality} onChange={(e) => setQuality((e.target as HTMLSelectElement).value)}>{q.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select><span /></div>
        <div class="prow"><span>Sample rate</span><select value={sr} onChange={(e) => setSr((e.target as HTMLSelectElement).value)}><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option></select><span /></div>
        <div class="prow"><span>Loudness</span><label class="field"><input type="checkbox" class="switch" checked={norm} onChange={(e) => setNorm((e.target as HTMLInputElement).checked)} /><span class="muted">{norm ? `Normalize to ${lufs} LUFS, peaks under -1 dB` : 'Keep the mix level'}</span></label><span /></div>
        {norm && <div class="prow"><span>Target</span><input type="range" min={-23} max={-8} step={1} value={lufs} style={{ '--p': ((lufs + 23) / 15) * 100 + '%' } as never} onInput={(e) => setLufs(+(e.target as HTMLInputElement).value)} /><span class="v">{lufs}</span></div>}
      </div>
      {res && (
        <div class="card" style={{ margin: '14px 0 0' }}>
          <h4>Done</h4>
          <div style={{ fontSize: '12.5px', userSelect: 'text' }}>{res.summary}</div>
          {res.issues?.map((i: any, k: number) => <div key={k} class="muted" style={{ fontSize: '11.5px', marginTop: '4px' }}>{i.message}</div>)}
          <div style={{ marginTop: '8px' }}><Btn sm icon="folder" onClick={() => invoke('open-path', res.path)}>Show in folder</Btn></div>
        </div>
      )}
    </Modal>
  );
}

export function SettingsDialog(): preact.JSX.Element | null {
  const show = useStore(uiStore, (s) => s.showSettings);
  const name = useStore(uiStore, (s) => s.appName);
  const dataDir = useStore(uiStore, (s) => s.dataDir);
  const ep = useStore(uiStore, (s) => s.endpoint);
  const version = useStore(uiStore, (s) => s.version);
  if (!show) return null;
  const close = () => uiStore.set({ showSettings: false });
  return (
    <Modal title="Settings" narrow onClose={close} footer={<Btn onClick={close}>Close</Btn>}>
      <div class="setrow">
        <div class="lb">Name</div>
        <div>
          {APP_NAMES.map((n) => (
            <div key={n} class={'radio' + (n === name ? ' on' : '')} onClick={() => setAppName(n)}><i />{n}{n === 'Music studio' ? <span class="faint"> (default)</span> : null}</div>
          ))}
          <div class="faint" style={{ marginTop: '4px', fontSize: '11px' }}>Shown in the window title and the top bar. File formats and the MCP connection id do not change.</div>
        </div>
      </div>
      <div class="setrow">
        <div class="lb">Data folder</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span class="mono" style={{ flex: 1, overflowWrap: 'anywhere', userSelect: 'text' }}>{dataDir}</span>
          <Btn sm onClick={() => invoke('open-path', dataDir)}>Show</Btn>
        </div>
      </div>
      <div class="setrow">
        <div class="lb">MCP endpoint</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span class="mono" style={{ flex: 1, overflowWrap: 'anywhere', userSelect: 'text' }}>{ep.url || 'not running'}</span>
          <Btn sm onClick={() => { close(); uiStore.set({ showConnect: true }); }}>Connect your AI…</Btn>
        </div>
      </div>
      <div class="setrow">
        <div class="lb">Version</div>
        <div class="mono">{version || 'dev'}</div>
      </div>
    </Modal>
  );
}

export { Icon };
