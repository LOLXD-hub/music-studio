import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { agentStore, projectStore, transportStore, uiStore, useStore, toast, secToBeats, barBeat } from './state.ts';
import { Btn, Icon } from './ui.tsx';
import { exec, invoke } from './api.ts';

const hhmmss = (t: number) => new Date(t).toTimeString().slice(0, 8);

function shellSplit(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function parseValue(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** `notes add track=Piano text="C4:1 E4:1"`  or  `{"tool":"notes","action":"add",...}` */
function parseCommand(input: string, tools: Record<string, string[]>): { tool: string; args: Record<string, unknown> } | null {
  const s = input.trim();
  if (s.startsWith('{')) {
    const j = JSON.parse(s);
    const { tool, ...args } = j;
    return { tool, args };
  }
  const tk = shellSplit(s);
  if (!tk.length) return null;
  let tool = tk[0];
  let rest = tk.slice(1);
  const args: Record<string, unknown> = {};
  if (tool.includes('.')) {
    const [t, a] = tool.split('.');
    tool = t;
    args.action = a;
  }
  if (!tools[tool]) return null;
  if (!args.action && rest[0] && !rest[0].includes('=') && tools[tool].includes(rest[0])) {
    args.action = rest[0];
    rest = rest.slice(1);
  }
  if (!args.action) args.action = tools[tool][0];
  for (const r of rest) {
    const i = r.indexOf('=');
    if (i > 0) args[r.slice(0, i)] = parseValue(r.slice(i + 1));
  }
  return { tool, args };
}

function BriefCard(): preact.JSX.Element {
  const brief = useStore(projectStore, (s) => s.project.brief);
  if (!brief || !Object.keys(brief).length) {
    return (
      <div class="card">
        <h4>Brief</h4>
        <div class="muted" style={{ fontSize: '12px' }}>When your AI posts its plan (genre, key, form, steps) it shows up here, so you can check the direction before it writes.</div>
      </div>
    );
  }
  const steps = brief.steps ?? [];
  const done = steps.filter((s) => s.done).length;
  return (
    <div class="card">
      <div class="brief-title">{brief.title ?? 'Untitled piece'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '6px 0' }}>
        {brief.genre && <span class="chip accent">{brief.genre}</span>}
        {brief.mood && <span class="chip">{brief.mood}</span>}
        {brief.key && <span class="chip">{brief.key}</span>}
        {brief.tempo && <span class="chip">{brief.tempo} bpm</span>}
      </div>
      {brief.form && brief.form.length > 0 && <div class="muted" style={{ fontSize: '11.5px' }}>{brief.form.join(' → ')}</div>}
      {brief.notes && <div style={{ fontSize: '12px', marginTop: '6px', userSelect: 'text' }}>{brief.notes}</div>}
      {steps.length > 0 && (
        <>
          <div style={{ height: '4px', background: '#14181b', margin: '10px 0 2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: (done / steps.length) * 100 + '%', background: 'var(--mint)', transition: 'width .4s' }} />
          </div>
          <ul class="steps">{steps.map((s, i) => <li key={i} class={s.done ? 'done' : ''}><i>{s.done ? '✓' : ''}</i>{s.text}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function BriefStrip({ open, onToggle }: { open: boolean; onToggle: () => void }): preact.JSX.Element {
  const brief = useStore(projectStore, (s) => s.project.brief);
  const steps = brief?.steps ?? [];
  const done = steps.filter((s) => s.done).length;
  return (
    <div class="card" style={{ cursor: 'pointer', padding: '10px 14px' }} onClick={onToggle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brief?.title ?? 'No brief yet'}</div>
          <div class="muted" style={{ fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brief ? [brief.genre, brief.mood, brief.key, brief.tempo ? brief.tempo + ' bpm' : null].filter(Boolean).join(' · ') : 'The AI posts its plan here before it writes.'}</div>
        </div>
        {steps.length > 0 && <span class="chip good">{done}/{steps.length}</span>}
        <Icon n="chevron" size={14} />
      </div>
      {steps.length > 0 && <div style={{ height: '3px', background: '#14181b', marginTop: '8px', overflow: 'hidden' }}><div style={{ height: '100%', width: (done / steps.length) * 100 + '%', background: 'var(--mint)', transition: 'width .4s' }} /></div>}
      {open && <div style={{ height: '0' }} />}
    </div>
  );
}

function Critic(): preact.JSX.Element {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await exec('critique', { action: 'composition' });
    setBusy(false);
    if (r) setData(r.result);
  };
  const ring = (v: number) => ({ '--v': v, '--c': v >= 85 ? 'var(--mint)' : v >= 65 ? 'var(--amber)' : 'var(--rose)' }) as never;
  return (
    <div class="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h4 style={{ margin: 0, flex: 1 }}>Critic</h4>
        <Btn sm icon="sparkle" onClick={run} disabled={busy}>{busy ? 'Reading…' : data ? 'Run again' : 'Review the music'}</Btn>
      </div>
      {data && (
        <>
          <div class="score" style={{ marginTop: '10px' }}>
            <div class="ring" style={ring(data.score.overall)}><span>{data.score.overall}</span></div>
            <div class="muted" style={{ fontSize: '11.5px', lineHeight: 1.5 }}>
              {(['harmony', 'melody', 'rhythm', 'dynamics', 'structure', 'humanization', 'orchestration'] as const).map((k) => <span key={k} style={{ marginRight: '8px' }}>{k} <b style={{ color: 'var(--text)' }}>{data.score[k]}</b></span>)}
            </div>
          </div>
          {data.strengths?.map((s: string, i: number) => <div key={i} class="chip good" style={{ marginTop: '6px', height: 'auto', padding: '3px 9px', whiteSpace: 'normal' }}>{s}</div>)}
          {data.findings?.slice(0, 8).map((f: any, i: number) => (
            <div key={i} class={'finding ' + f.severity}>
              <b>{f.severity} · {f.category}{f.track ? ' · ' + f.track : ''}{f.bars ? ` · bars ${f.bars[0]}-${f.bars[1]}` : ''}</b>
              <p>{f.problem}</p>
              <div class="muted" style={{ fontSize: '11.5px', userSelect: 'text' }}>{f.fix}</div>
              <div style={{ marginTop: '4px' }}><Btn sm icon="send" onClick={() => invoke('feedback-add', { kind: 'message', text: `Please fix: ${f.problem} (${f.fix})`, target: f.track ? { track: f.track } : undefined }).then(() => toast('Sent to the AI.'))}>Send to AI</Btn></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const QUICK = ['Too loud', 'Too quiet', 'Too busy', 'Too empty', 'More human', 'Brighter', 'Darker', 'Keep this'];

export function AgentDeck(): preact.JSX.Element {
  const activity = useStore(agentStore, (s) => s.activity);
  const feedback = useStore(agentStore, (s) => s.feedback);
  const agent = useStore(agentStore, (s) => s.agent);
  const hist = useStore(projectStore, (s) => s.historyLength);
  const tools = useStore(uiStore, (s) => s.tools);
  const feedRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [cmd, setCmd] = useState('');
  const [cmdHist, setCmdHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [sugIdx, setSugIdx] = useState(0);
  const [tab, setTab] = useState<'activity' | 'critic'>('activity');
  const [briefOpen, setBriefOpen] = useState(false);

  const items = useMemo(() => {
    const a = activity.map((x) => ({ ts: x.ts, kind: 'act' as const, a: x }));
    const f = feedback.map((x) => ({ ts: x.ts, kind: 'fb' as const, f: x }));
    return [...a, ...f].sort((x, y) => x.ts - y.ts).slice(-160);
  }, [activity, feedback]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, activity[activity.length - 1]?.status]);

  const context = () => {
    const st = uiStore.get();
    const p = projectStore.get().project;
    const t = p.tracks.find((x) => x.id === st.selTrack);
    const beat = secToBeats(p, transportStore.get().position);
    return { track: t?.name, beat, bar: barBeat(p, beat).bar };
  };

  const sendMessage = async (msg: string, extra?: object) => {
    const c = context();
    await invoke('feedback-add', { kind: 'message', text: msg, target: c.track ? { track: c.track, beat: c.beat, bar: c.bar } : { beat: c.beat, bar: c.bar }, ...extra });
  };

  const runCmd = async () => {
    const line = cmd.trim();
    if (!line) return;
    setCmd('');
    setCmdHist((h) => [line, ...h].slice(0, 50));
    setHi(-1);
    let parsed: ReturnType<typeof parseCommand> = null;
    try {
      parsed = parseCommand(line, tools);
    } catch (e) {
      toast('That JSON could not be read: ' + (e as Error).message, true);
      return;
    }
    if (!parsed) {
      await sendMessage(line);
      return;
    }
    const r = await window.msai.invoke('exec', parsed.tool, parsed.args, 'cli');
    if (!r.ok) toast(r.error, true);
  };

  const sug = useMemo(() => {
    const t = cmd.trimStart();
    if (!t || t.startsWith('{') || t.includes('=')) return [];
    const parts = t.split(/\s+/);
    const out: string[] = [];
    if (parts.length <= 1) {
      for (const [k, acts] of Object.entries(tools)) if (k.startsWith(parts[0])) out.push(...acts.map((a) => `${k} ${a} `));
    } else if (parts.length === 2) {
      const acts = tools[parts[0]];
      if (acts) for (const a of acts) if (a.startsWith(parts[1]) && a !== parts[1]) out.push(`${parts[0]} ${a} `);
    }
    return out.slice(0, 8);
  }, [cmd, tools]);

  const revert = async (a: { rev?: number }) => {
    const steps = hist - (a.rev ?? hist);
    if (steps <= 0) return;
    await exec('studio', { action: 'undo', steps });
  };

  return (
    <div class="panel deck grow">
      <div class="ph">
        <Icon n="sparkle" size={14} /> Agent deck
        <span style={{ flex: 1 }} />
        <span class={'chip' + (agent.connected ? ' good' : '')}>{agent.connected ? agent.client ?? 'connected' : 'offline'}</span>
      </div>
      <BriefStrip open={briefOpen} onToggle={() => setBriefOpen(!briefOpen)} />
      {briefOpen && <div style={{ overflow: 'auto', flex: 'none', maxHeight: '42%' }}><BriefCard /></div>}
      <div class="tabs" style={{ padding: '0 12px 6px' }}>
        <button class={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button>
        <button class={tab === 'critic' ? 'on' : ''} onClick={() => setTab('critic')}>Critic</button>
      </div>
      {tab === 'critic' && <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}><Critic /></div>}
      <div class="feed" ref={feedRef} style={tab === 'critic' ? { display: 'none' } : undefined}>
        {items.length === 0 && <div class="muted" style={{ padding: '8px 4px', fontSize: '12px' }}>Nothing yet. Tool calls from your AI, your edits and your messages appear here as they happen.</div>}
        {items.map((it) =>
          it.kind === 'act' ? (
            <div key={'a' + it.a.id} class={`ev ${it.a.source}${it.a.status === 'error' ? ' err' : ''}${it.a.status === 'running' ? ' run' : ''}`}>
              <div class="ic">{it.a.source === 'mcp' ? 'AI' : it.a.source === 'cli' ? '>' : 'me'}</div>
              <div class="tx">
                {it.a.status === 'error' ? it.a.error : it.a.summary}
                <small>{hhmmss(it.a.ts)} · {it.a.tool}.{it.a.action}{it.a.ms ? ` · ${it.a.ms} ms` : ''}</small>
              </div>
              <div class="acts">
                {it.a.mutated && it.a.rev !== undefined && hist - it.a.rev > 0 && hist - it.a.rev <= 12 && <Btn sm cls="ghost" title="Undo this and everything after it" onClick={() => revert(it.a)}>Revert</Btn>}
              </div>
            </div>
          ) : (
            <div key={'f' + it.f.id} class="ev ui" style={{ background: '#2c3943' }}>
              <div class="ic">{it.f.kind === 'pin' ? '•' : it.f.rating === 'like' ? '+' : it.f.rating === 'dislike' ? '−' : 'me'}</div>
              <div class="tx">
                {it.f.text}
                {it.f.reply && <small style={{ color: 'var(--mint)' }}>AI: {it.f.reply}</small>}
                <small>{hhmmss(it.f.ts)} · {it.f.target?.track ? it.f.target.track + ' · ' : ''}{it.f.target?.bar ? 'bar ' + it.f.target.bar + ' · ' : ''}{it.f.delivered ? 'read by the AI' : 'waiting for the AI'}</small>
              </div>
              <div />
            </div>
          ),
        )}
      </div>
      <div class="composer">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {QUICK.map((q) => <span key={q} class="chip click" onClick={() => sendMessage(q)}>{q}</span>)}
        </div>
        <div class="row1">
          <input type="text" placeholder="Tell the AI what to change…" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { sendMessage(text.trim()); setText(''); } }} />
          <Btn icon="thumbUp" cls="ghost" title="I like this part" onClick={() => sendMessage('I like this part, keep it.', { kind: 'rating', rating: 'like' })} />
          <Btn icon="thumbDown" cls="ghost" title="I don't like this part" onClick={() => sendMessage("I don't like this part.", { kind: 'rating', rating: 'dislike' })} />
          <Btn primary icon="send" onClick={() => { if (text.trim()) { sendMessage(text.trim()); setText(''); } }} />
        </div>
      </div>
      <div class="cmdline">
        <span class="mono muted">&gt;</span>
        <input type="text" spellcheck={false} placeholder='notes add track=Piano text="C4:1 E4:1 G4:2"   (tab completes)' value={cmd}
          onInput={(e) => { setCmd((e.target as HTMLInputElement).value); setSugIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && sug.length) { e.preventDefault(); setCmd(sug[sugIdx]); }
            else if (e.key === 'ArrowDown' && sug.length) { e.preventDefault(); setSugIdx((i) => Math.min(sug.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp' && sug.length) { e.preventDefault(); setSugIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'ArrowUp') { const n = Math.min(cmdHist.length - 1, hi + 1); setHi(n); if (cmdHist[n]) setCmd(cmdHist[n]); }
            else if (e.key === 'ArrowDown') { const n = Math.max(-1, hi - 1); setHi(n); setCmd(n < 0 ? '' : cmdHist[n]); }
            else if (e.key === 'Enter') runCmd();
          }} />
        {sug.length > 0 && <div class="suggest">{sug.map((s, i) => <div key={s} class={i === sugIdx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); setCmd(s); }}>{s}</div>)}</div>}
      </div>
    </div>
  );
}
