import { useEffect } from 'preact/hooks';
import { projectStore, transportStore, uiStore, useStore, toast, secToBeats, setAppName } from './state.ts';
import { TopBar } from './TopBar.tsx';
import { Browser } from './Browser.tsx';
import { Arrangement } from './Arrangement.tsx';
import { PianoRoll } from './PianoRoll.tsx';
import { Mixer } from './Mixer.tsx';
import { AgentDeck } from './AgentDeck.tsx';
import { SoundFx } from './SoundFx.tsx';
import { Live } from './Live.tsx';
import { ConnectDialog, ExportDialog, SettingsDialog } from './Dialogs.tsx';
import { FxEditor, InstEditor } from './Editors.tsx';
import { exec } from './api.ts';
import { audio } from './audio.ts';

function Dock(): preact.JSX.Element {
  const dock = useStore(uiStore, (s) => s.dock);
  const sel = useStore(uiStore, (s) => s.selClip);
  const project = useStore(projectStore, (s) => s.project);
  const track = project.tracks.find((t) => t.id === sel?.track);
  return (
    <div class="panel dock" style={{ flex: '0 0 39%', minHeight: '250px' }}>
      <div class="dock-tabs">
        <div class="tabs" style={{ padding: 0, width: '170px' }}>
          <button class={dock === 'roll' ? 'on' : ''} onClick={() => uiStore.set({ dock: 'roll' })}>Piano roll</button>
          <button class={dock === 'mixer' ? 'on' : ''} onClick={() => uiStore.set({ dock: 'mixer' })}>Mixer</button>
        </div>
        {dock === 'roll' && track && <span class="muted" style={{ fontSize: '12px' }}>{track.name}</span>}
      </div>
      <div class="dock-body">{dock === 'roll' ? <PianoRoll /> : <Mixer />}</div>
    </div>
  );
}

function Toasts(): preact.JSX.Element {
  const list = useStore(uiStore, (s) => s.toasts);
  return <div class="toasts">{list.map((t) => <div key={t.id} class={'toast' + (t.err ? ' err' : '')}>{t.text}</div>)}</div>;
}

export function App(): preact.JSX.Element {
  const mode = useStore(uiStore, (s) => s.mode);

  useEffect(() => { setAppName(uiStore.get().appName); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        if (transportStore.get().playing) audio.pause();
        else audio.play();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        exec('studio', { action: e.shiftKey ? 'redo' : 'undo' });
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        exec('studio', { action: 'redo' });
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exec('studio', { action: 'save' }).then((r) => r && toast(r.result.summary));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && uiStore.get().dock !== 'roll') {
        const s = uiStore.get().selClip;
        if (s) exec('clips', { action: 'remove', track: s.track, clip: s.clip });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const cols = mode === 'studio' ? undefined : 'wide-right';
  void secToBeats;
  return (
    <div class="app">
      <TopBar />
      <div class="workspace" style={cols ? { gridTemplateColumns: 'minmax(0,1fr) 320px' } : undefined}>
        {mode === 'studio' && <div class="col"><Browser /></div>}
        <div class="col">
          {mode === 'studio' && (<><Arrangement /><Dock /></>)}
          {mode === 'sfx' && <SoundFx />}
          {mode === 'live' && <Live />}
        </div>
        <div class="col"><AgentDeck /></div>
      </div>
      <ConnectDialog />
      <ExportDialog />
      <SettingsDialog />
      <FxEditor />
      <InstEditor />
      <Toasts />
    </div>
  );
}
