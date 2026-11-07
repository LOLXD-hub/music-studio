import fs from 'node:fs';
import path from 'node:path';
import { z, action, pos, len, track, round, PosS, LenS, TrackS, PitchS } from './toolkit.ts';
import type { ToolDef } from './toolkit.ts';
import { PPQ, MeterMap } from '../engine/project.ts';
import type { Project, Track } from '../engine/project.ts';
import { INSTRUMENT_DEFS, getInstrumentDef } from '../engine/instruments/index.ts';
import { FX_DEFS, getFxDef } from '../engine/fx/index.ts';
import { parseKey, keyName, noteToMidi, midiToName } from '../theory/pitch.ts';
import { parseNoteText, notesToText, barOfBeat, beatsPerBarAt } from './format.ts';
import type { TNote } from '../theory/humanize.ts';
import { humanize as humanizeNotes, quantize } from '../theory/humanize.ts';
import * as ops from './ops.ts';
import { findFfmpeg } from './audioio.ts';
import { GUIDE } from './guide.ts';
import { safeName } from './studio.ts';

const barLabel = (p: Project, a: number, b: number): string => {
  const x = barOfBeat(p.sig, a).bar;
  const y = barOfBeat(p.sig, Math.max(a, b - 1e-6)).bar;
  return x === y ? `bar ${x}` : `bars ${x}-${y}`;
};

const noteArg = z.object({
  pitch: PitchS.optional(),
  pitches: z.array(PitchS).optional().describe('Several pitches that start together (a chord).'),
  start: PosS,
  dur: LenS.optional().describe('Default 1 beat.'),
  vel: z.number().min(1).max(127).optional().describe('Velocity, default 90.'),
  art: z.string().optional().describe('Articulation: stac, pizz, trem, acc, mute, ...'),
});

function expandNotes(ctx: Parameters<typeof pos>[0], list: z.infer<typeof noteArg>[], base = 0): TNote[] {
  const out: TNote[] = [];
  for (const n of list) {
    const at = pos(ctx, n.start) + base;
    const d = len(ctx, n.dur, at, 1);
    const ps = n.pitches ?? (n.pitch !== undefined ? [n.pitch] : []);
    if (!ps.length) throw new Error('Each note needs "pitch" or "pitches".');
    for (const p of ps) out.push({ t: at, d, p: noteToMidi(p), v: n.vel ?? 90, art: n.art });
  }
  return out;
}

// ============================================================ studio
const studioTool: ToolDef = {
  name: 'studio',
  description: 'Project-level control: status, help, new/open/save, tempo, key, time signature, loop, markers, undo/redo.',
  actions: {
    status: action({
      description: 'Overview of the project: settings, tracks, length, agent and transport state, capabilities.',
      schema: z.object({}),
      run: (ctx) => {
        const s = ctx.studio;
        const p = s.project;
        const bars = barOfBeat(p.sig, ops.projectLengthBeats(p)).bar - 1;
        return {
          summary: `Project "${p.name}": ${p.tracks.length} tracks, ${bars} bars at ${p.tempo[0].bpm} bpm.`,
          project: { name: p.name, tempo: p.tempo.map((t) => ({ at: t.t / PPQ, bpm: t.bpm })), sig: p.sig.map((x) => `${x.num}/${x.den}`), key: p.key ? keyName(p.key) : null, bars, lengthBeats: ops.projectLengthBeats(p), revision: s.rev, file: s.projectPath, unsaved: s.dirty, loop: p.loop ? { from: p.loop.start / PPQ, to: p.loop.end / PPQ } : null },
          tracks: p.tracks.map((t) => ops.describeTrack(t, p)),
          markers: p.markers.map((m) => ({ at: m.t / PPQ, bar: barOfBeat(p.sig, m.t / PPQ).bar, name: m.name })),
          brief: p.brief ?? null,
          assets: p.assets.length,
          transport: s.transport,
          agent: s.agent,
          pendingFeedback: s.feedback.filter((f) => !f.delivered).length,
          capabilities: { ffmpeg: findFfmpeg() ? 'available (conversion only)' : 'not installed', formats: ['wav', 'mp3', 'flac', findFfmpeg() ? 'ogg, m4a, opus' : null].filter(Boolean), soundEffects: s.sfx.count(), instruments: INSTRUMENT_DEFS.map((d) => d.type), effects: FX_DEFS.map((d) => d.type), vst3: 'scan only (hosting is not available yet)' },
        };
      },
    }),
    help: action({
      description: 'Guides ("workflow", "time", "listen", "realism", "mix", "sfx", "mistakes") or the exact argument schema of a tool action.',
      schema: z.object({ topic: z.string().optional().describe('Guide name, or an action name when `tool` is set.'), tool: z.string().optional() }),
      run: (ctx, a) => {
        if (a.tool) {
          const def = ctx.studio.tools.get(a.tool);
          if (!def) throw new Error(`No tool "${a.tool}". Tools: ${[...ctx.studio.tools.keys()].join(', ')}.`);
          if (a.topic) {
            const ad = def.actions[a.topic];
            if (!ad) throw new Error(`Tool ${a.tool} has no action "${a.topic}". Actions: ${Object.keys(def.actions).join(', ')}.`);
            return { summary: `Schema of ${a.tool}.${a.topic}`, description: ad.description, schema: z.toJSONSchema(ad.schema) };
          }
          return { summary: `Actions of ${a.tool}`, actions: Object.fromEntries(Object.entries(def.actions).map(([k, v]) => [k, v.description])) };
        }
        if (a.topic && GUIDE[a.topic]) return { summary: `Guide: ${a.topic}`, guide: GUIDE[a.topic] };
        return { summary: 'Available guides and tools', guides: Object.keys(GUIDE), tools: Object.fromEntries([...ctx.studio.tools.entries()].map(([k, v]) => [k, Object.keys(v.actions)])), start: GUIDE.workflow };
      },
    }),
    new: action({
      description: 'Start a new empty project (the current one is replaced; save first if needed).',
      schema: z.object({ name: z.string().optional(), tempo: z.number().min(20).max(300).optional(), key: z.string().optional(), sig: z.string().optional() }),
      run: (ctx, a) => {
        ctx.studio.newProject(a.name ?? 'Untitled');
        ctx.studio.mutate('Set up', (p) => {
          if (a.tempo) p.tempo[0].bpm = a.tempo;
          if (a.key) p.key = parseKey(a.key);
          if (a.sig) {
            const m = /^(\d+)\/(\d+)$/.exec(a.sig);
            if (!m) throw new Error('sig must look like 4/4 or 6/8');
            p.sig[0] = { t: 0, num: +m[1], den: +m[2] };
          }
        });
        return { summary: `New project "${ctx.studio.project.name}".` };
      },
    }),
    open: action({
      description: 'Open a saved project (.msai).',
      schema: z.object({ path: z.string() }),
      agent: 'loading',
      run: async (ctx, a) => {
        const p = await ctx.studio.openProject(a.path);
        return { summary: `Opened "${p.name}" with ${p.tracks.length} tracks.` };
      },
    }),
    save: action({
      description: 'Save the project. Without a path it is saved in the Projects folder under its name.',
      schema: z.object({ path: z.string().optional() }),
      run: async (ctx, a) => {
        const f = await ctx.studio.saveProject(a.path);
        return { summary: `Saved to ${f}`, path: f };
      },
    }),
    list_projects: action({
      description: 'List saved projects in the default Projects folder.',
      schema: z.object({}),
      run: (ctx) => {
        const dir = path.join(ctx.studio.dataDir, 'Projects');
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.msai')).map((f) => ({ file: path.join(dir, f), modified: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
        return { summary: `${files.length} saved projects`, projects: files };
      },
    }),
    set: action({
      description: 'Change project settings: name, tempo (or a tempo_map of changes), key, time signature, loop region, markers.',
      schema: z.object({
        name: z.string().optional(),
        tempo: z.number().min(20).max(300).optional().describe('Base tempo in bpm.'),
        tempo_map: z.array(z.object({ at: PosS, bpm: z.number() })).optional().describe('Tempo changes (accelerando, ritardando, section changes).'),
        sig: z.string().optional().describe('Time signature at the start, e.g. "3/4".'),
        key: z.string().optional().describe('e.g. "C minor", "F# major", "D dorian", "Am".'),
        loop: z.union([z.object({ from: PosS, to: PosS }), z.null()]).optional(),
        markers: z.array(z.object({ at: PosS, name: z.string() })).optional().describe('Replaces all markers.'),
      }),
      mutates: true,
      run: (ctx, a) => {
        const changes: string[] = [];
        ctx.studio.mutate('Project settings', (p) => {
          if (a.name) { p.name = a.name; changes.push(`name ${a.name}`); }
          if (a.tempo) { p.tempo[0].bpm = a.tempo; changes.push(`${a.tempo} bpm`); }
          if (a.tempo_map) {
            p.tempo = [p.tempo[0], ...a.tempo_map.map((t: { at: string | number; bpm: number }) => ({ t: ops.toTicks(pos(ctx, t.at)), bpm: t.bpm }))].sort((x, y) => x.t - y.t);
            changes.push(`${a.tempo_map.length} tempo changes`);
          }
          if (a.sig) {
            const m = /^(\d+)\/(\d+)$/.exec(a.sig);
            if (!m) throw new Error('sig must look like 4/4 or 6/8');
            p.sig[0] = { t: 0, num: +m[1], den: +m[2] };
            changes.push(`${a.sig} time`);
          }
          if (a.key) { p.key = parseKey(a.key); changes.push(`key ${keyName(p.key)}`); }
          if (a.loop !== undefined) {
            p.loop = a.loop ? { start: ops.toTicks(pos(ctx, a.loop.from)), end: ops.toTicks(pos(ctx, a.loop.to)) } : null;
            changes.push(a.loop ? 'loop on' : 'loop off');
          }
          if (a.markers) p.markers = a.markers.map((m: { at: string | number; name: string }) => ({ id: ops.nextId('m'), t: ops.toTicks(pos(ctx, m.at)), name: m.name }));
        });
        return { summary: `Project updated: ${changes.join(', ') || 'nothing changed'}.` };
      },
    }),
    undo: action({
      description: 'Undo the last change, or the last N changes.',
      schema: z.object({ steps: z.number().int().min(1).max(40).optional() }),
      run: (ctx, a) => {
        let last: string | null = null;
        let n = 0;
        for (let i = 0; i < (a.steps ?? 1); i++) {
          const l = ctx.studio.undo();
          if (!l) break;
          last = l;
          n++;
        }
        return { summary: n ? `Undid ${n} step${n > 1 ? 's' : ''}${n === 1 ? `: ${last}` : ''}.` : 'Nothing to undo.' };
      },
    }),
    redo: action({ description: 'Redo.', schema: z.object({}), run: (ctx) => { const l = ctx.studio.redo(); return { summary: l ? `Redid: ${l}` : 'Nothing to redo.' }; } }),
  },
};

// ============================================================ agent
const agentTool: ToolDef = {
  name: 'agent',
  description: 'Talk to the human through the app: show your status animation, post your plan (brief), leave messages, and read their feedback and pins.',
  actions: {
    status: action({
      description: 'Set the status shown on the mascot in the app: listening, building, loading, thinking, mixing or idle. Hold keeps it for N seconds.',
      schema: z.object({ state: z.enum(['listening', 'building', 'loading', 'thinking', 'mixing', 'idle']), message: z.string().max(120).optional(), hold: z.number().min(0).max(120).optional() }),
      run: (ctx, a) => {
        ctx.studio.markSeen();
        ctx.studio.setAgent(a.state, a.message ?? a.state, undefined, a.hold ?? 0);
        return { summary: `Status: ${a.state}${a.message ? ' - ' + a.message : ''}` };
      },
    }),
    brief: action({
      description: 'Record (or read) the creative brief that the human sees in the Agent deck: title, genre, mood, key, tempo, form, references, notes and a step checklist.',
      schema: z.object({
        title: z.string().optional(), genre: z.string().optional(), mood: z.string().optional(), key: z.string().optional(), tempo: z.number().optional(),
        form: z.array(z.string()).optional(), references: z.string().optional(), notes: z.string().optional(),
        steps: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional().describe('Checklist; replaces the list.'),
        read: z.boolean().optional().describe('Only read the current brief.'),
      }),
      run: (ctx, a) => {
        const { read, ...rest } = a;
        if (!read && Object.keys(rest).length) {
          ctx.studio.mutate('Brief', (p) => {
            const b = { ...(p.brief ?? {}), ...rest } as NonNullable<Project['brief']>;
            if (rest.steps) b.steps = rest.steps.map((s: { text: string; done?: boolean }) => ({ text: s.text, done: !!s.done }));
            p.brief = b;
          });
        }
        return { summary: read ? 'Brief read' : 'Brief updated', brief: ctx.studio.project.brief ?? null };
      },
    }),
    step: action({
      description: 'Tick a checklist item of the brief (by index starting at 1) or add one.',
      schema: z.object({ index: z.number().int().optional(), text: z.string().optional(), done: z.boolean().optional() }),
      run: (ctx, a) => {
        ctx.studio.mutate('Checklist', (p) => {
          const b = (p.brief ??= {});
          b.steps ??= [];
          if (a.index) {
            const s = b.steps[a.index - 1];
            if (!s) throw new Error(`No step ${a.index}.`);
            s.done = a.done ?? true;
          } else if (a.text) b.steps.push({ text: a.text, done: !!a.done });
        });
        return { summary: 'Checklist updated', steps: ctx.studio.project.brief?.steps };
      },
    }),
    say: action({
      description: 'Post a short message to the human in the activity feed (what you did, what you want them to listen for, a question).',
      schema: z.object({ text: z.string().min(1).max(600) }),
      run: (ctx, a) => {
        ctx.studio.logActivity({ source: 'mcp', tool: 'agent', action: 'say', summary: a.text, status: 'ok', ms: 0 });
        return { summary: 'Message shown to the human.' };
      },
    }),
    feedback: action({
      description: 'Read the human\'s unread feedback: typed messages, pins on the timeline (with track and bar), likes/dislikes. Marks them delivered.',
      schema: z.object({ peek: z.boolean().optional().describe('Do not mark as delivered.') }),
      run: (ctx, a) => {
        const items = ctx.studio.takeFeedback(!a.peek);
        return { summary: items.length ? `${items.length} new feedback item(s)` : 'No new feedback.', feedback: items.map((f) => ({ id: f.id, kind: f.kind, text: f.text, rating: f.rating, target: f.target })) };
      },
    }),
    wait_feedback: action({
      description: 'Wait up to N seconds (max 45) for the human to leave feedback, then return it. Use after asking them to listen.',
      schema: z.object({ seconds: z.number().min(1).max(45).optional() }),
      agent: 'listening',
      run: async (ctx, a) => {
        ctx.studio.setAgent('listening', 'Waiting for your feedback', 'agent', a.seconds ?? 30);
        const f = await ctx.studio.waitForFeedback((a.seconds ?? 30) * 1000);
        if (!f) return { summary: 'No feedback arrived in time.', feedback: [] };
        const items = ctx.studio.takeFeedback(true);
        return { summary: `${items.length} feedback item(s)`, feedback: items.map((x) => ({ id: x.id, kind: x.kind, text: x.text, rating: x.rating, target: x.target })) };
      },
    }),
    reply: action({
      description: 'Answer a feedback item (shown under it in the feed).',
      schema: z.object({ id: z.number().int(), text: z.string() }),
      run: (ctx, a) => {
        const f = ctx.studio.feedback.find((x) => x.id === a.id);
        if (!f) throw new Error(`No feedback ${a.id}.`);
        f.reply = a.text;
        ctx.studio.emit('feedback', f);
        return { summary: `Replied to #${a.id}` };
      },
    }),
  },
};

// ============================================================ tracks
const tracksTool: ToolDef = {
  name: 'tracks',
  description: 'Create and manage tracks: instrument tracks, audio tracks and buses.',
  actions: {
    list: action({ description: 'List all tracks with instruments, levels, effects, clips.', schema: z.object({}), run: (ctx) => ({ summary: `${ctx.studio.project.tracks.length} tracks`, tracks: ctx.studio.project.tracks.map((t) => ops.describeTrack(t, ctx.studio.project)) }) }),
    add: action({
      description: 'Add a track. Instrument tracks need an instrument type (piano, organ, fm, mallet, plucked, wind_string, subsynth, drums, sampler) and optionally a preset.',
      schema: z.object({
        name: z.string().optional(), kind: z.enum(['instrument', 'audio', 'bus']).optional(), instrument: z.string().optional().describe('Instrument type.'), preset: z.string().optional(),
        params: z.record(z.string(), z.union([z.number(), z.string()])).optional(), color: z.string().optional(), out: z.string().optional().describe('"master" or a bus track.'),
        vol: z.number().min(-60).max(12).optional().describe('Fader in dB.'), pan: z.number().min(-1).max(1).optional(),
      }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        let id = '';
        ctx.studio.mutate(`Add track ${a.name ?? ''}`, (p) => {
          const kind = a.kind ?? (a.instrument || a.preset ? 'instrument' : 'audio');
          const t = ops.newTrack(p, { name: a.name, kind, color: a.color, out: a.out ? ops.findTrack(p, a.out).id : undefined, instrument: kind === 'instrument' ? { type: a.instrument ?? 'piano', preset: a.preset, params: a.params } : undefined });
          if (a.vol !== undefined) t.vol = a.vol;
          if (a.pan !== undefined) t.pan = a.pan;
          id = t.id;
        });
        const t = ops.findTrack(ctx.studio.project, id);
        return { summary: `Added ${t.kind} track "${t.name}" (${t.id})${t.instrument ? ` with ${t.instrument.type}${t.instrument.preset ? ' / ' + t.instrument.preset : ''}` : ''}.`, track: ops.describeTrack(t, ctx.studio.project), _tracks: [t.id] };
      },
    }),
    update: action({
      description: 'Change a track: name, color, fader (vol dB), pan, mute, solo, output routing, notes.',
      schema: z.object({ track: TrackS, name: z.string().optional(), color: z.string().optional(), vol: z.number().min(-60).max(12).optional(), pan: z.number().min(-1).max(1).optional(), mute: z.boolean().optional(), solo: z.boolean().optional(), out: z.string().optional(), note: z.string().optional() }),
      mutates: true,
      run: (ctx, a) => {
        let id = '';
        ctx.studio.mutate('Update track', (p) => {
          const t = ops.findTrack(p, a.track);
          id = t.id;
          if (a.name) t.name = a.name;
          if (a.color) t.color = a.color;
          if (a.vol !== undefined) t.vol = a.vol;
          if (a.pan !== undefined) t.pan = a.pan;
          if (a.mute !== undefined) t.mute = a.mute;
          if (a.solo !== undefined) t.solo = a.solo;
          if (a.note !== undefined) t.note = a.note;
          if (a.out) t.out = a.out === 'master' ? 'master' : ops.findTrack(p, a.out).id;
        });
        return { summary: `Updated track ${id}.`, _tracks: [id] };
      },
    }),
    remove: action({ description: 'Delete a track and its clips.', schema: z.object({ track: TrackS }), mutates: true, run: (ctx, a) => {
      let name = '';
      ctx.studio.mutate('Remove track', (p) => {
        const t = ops.findTrack(p, a.track);
        name = t.name;
        p.tracks = p.tracks.filter((x) => x.id !== t.id);
        for (const o of p.tracks) { o.sends = o.sends.filter((s) => s.to !== t.id); if (o.out === t.id) o.out = 'master'; }
      });
      return { summary: `Removed "${name}".` };
    } }),
    duplicate: action({ description: 'Duplicate a track with its clips and effects.', schema: z.object({ track: TrackS, name: z.string().optional() }), mutates: true, run: (ctx, a) => {
      let nid = '';
      ctx.studio.mutate('Duplicate track', (p) => {
        const t = ops.findTrack(p, a.track);
        const c = structuredClone(t);
        c.id = ops.nextId('t');
        c.name = a.name ?? t.name + ' copy';
        for (const cl of c.clips) { cl.id = ops.nextId('c'); if (cl.kind === 'midi') for (const n of cl.notes) n.id = ops.nextId('n'); }
        for (const f of c.inserts) f.id = ops.nextId('fx');
        for (const au of c.auto) au.id = ops.nextId('a');
        p.tracks.splice(p.tracks.indexOf(t) + 1, 0, c);
        nid = c.id;
      });
      return { summary: `Duplicated to ${nid}.`, _tracks: [nid] };
    } }),
    reorder: action({ description: 'Set the track order.', schema: z.object({ order: z.array(TrackS) }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Reorder tracks', (p) => {
        const ids = a.order.map((r: string) => ops.findTrack(p, r).id);
        const rest = p.tracks.filter((t) => !ids.includes(t.id));
        p.tracks = [...ids.map((i: string) => p.tracks.find((t) => t.id === i)!), ...rest];
      });
      return { summary: 'Track order updated.' };
    } }),
  },
};

// ============================================================ instruments
const instrumentsTool: ToolDef = {
  name: 'instruments',
  description: 'Instruments: catalog, parameters, presets, changing a track\'s instrument, auditioning notes, loading samples.',
  actions: {
    catalog: action({
      description: 'All instruments with category, range, presets and articulations.',
      schema: z.object({ category: z.string().optional() }),
      run: (_ctx, a) => {
        const list = INSTRUMENT_DEFS.filter((d) => !a.category || d.category === a.category);
        return { summary: `${list.length} instruments`, instruments: list.map((d) => ({ type: d.type, name: d.name, category: d.category, description: d.description, range: d.range.map((m) => midiToName(m)).join(' to '), polyphony: d.polyphony, presets: Object.keys(d.presets), articulations: d.articulations ?? [], parameterCount: d.params.length })) };
      },
    }),
    info: action({
      description: 'Full parameter list (id, range, default, options) and presets of one instrument type.',
      schema: z.object({ type: z.string() }),
      run: (_ctx, a) => {
        const d = getInstrumentDef(a.type);
        if (!d) throw new Error(`Unknown instrument "${a.type}".`);
        return { summary: `${d.name}: ${d.params.length} parameters`, type: d.type, description: d.description, range: d.range, articulations: d.articulations ?? [], presets: d.presets, params: d.params.map((p) => ({ id: p.id, name: p.name, min: p.min, max: p.max, default: p.def, unit: p.unit, options: p.options, group: p.group })) };
      },
    }),
    set: action({
      description: 'Change a track\'s instrument, preset and/or parameters. Parameters can be options text ("Mono legato") or numbers.',
      schema: z.object({ track: TrackS, type: z.string().optional(), preset: z.string().optional(), params: z.record(z.string(), z.union([z.number(), z.string()])).optional(), reset: z.boolean().optional().describe('Drop earlier parameter overrides.') }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        let desc = '';
        ctx.studio.mutate('Change instrument', (p) => {
          const t = ops.findTrack(p, a.track);
          if (t.kind !== 'instrument') throw new Error('Only instrument tracks have an instrument.');
          const type = a.type ?? t.instrument?.type ?? 'piano';
          const def = getInstrumentDef(type);
          if (!def) throw new Error(`Unknown instrument "${type}".`);
          let preset = a.preset ?? (a.type && a.type !== t.instrument?.type ? undefined : t.instrument?.preset);
          if (a.preset) {
            const real = Object.keys(def.presets).find((k) => k.toLowerCase() === a.preset!.toLowerCase()) ?? Object.keys(def.presets).find((k) => k.toLowerCase().includes(a.preset!.toLowerCase()));
            if (!real) throw new Error(`Unknown preset "${a.preset}" for ${type}. Presets: ${Object.keys(def.presets).join(', ')}.`);
            preset = real;
          }
          const keep = a.reset || (a.type && a.type !== t.instrument?.type) ? {} : { ...(t.instrument?.params ?? {}) };
          t.instrument = { ...(t.instrument as object), type, preset, params: { ...keep, ...(a.params ?? {}) } };
          desc = `${t.name}: ${type}${preset ? ' / ' + preset : ''}`;
        });
        return { summary: `Instrument set. ${desc}` };
      },
    }),
    preview: action({
      description: 'Play a note on a track\'s instrument in the app (the human hears it).',
      schema: z.object({ track: TrackS, pitch: PitchS.optional(), vel: z.number().optional(), seconds: z.number().min(0.1).max(8).optional() }),
      agent: 'listening',
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        ctx.studio.emit('audition-note', { track: t.id, pitch: noteToMidi(a.pitch ?? 60), vel: a.vel ?? 100, seconds: a.seconds ?? 1.2 });
        return { summary: `Played ${midiToName(noteToMidi(a.pitch ?? 60))} on ${t.name}.`, heardInApp: ctx.studio.transport.uiConnected };
      },
    }),
    sampler: action({
      description: 'Turn a track into a sampler and load audio files as key zones. Each zone: file (path) or asset (id), root note, key range, velocity range. This is the route to recorded instruments.',
      schema: z.object({
        track: TrackS,
        zones: z.array(z.object({ file: z.string().optional(), asset: z.string().optional(), root: PitchS, lo: PitchS.optional(), hi: PitchS.optional(), velLo: z.number().optional(), velHi: z.number().optional(), tune: z.number().optional(), gain: z.number().optional(), pan: z.number().optional(), loopStart: z.number().optional(), loopEnd: z.number().optional() })),
        params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      }),
      agent: 'loading',
      run: async (ctx, a) => {
        const out: { assetId: string; root: number; lo?: number; hi?: number; velLo?: number; velHi?: number; tune?: number; gain?: number; pan?: number; loopStart?: number; loopEnd?: number }[] = [];
        for (const z of a.zones) {
          let id = z.asset as string | undefined;
          if (!id) {
            if (!z.file) throw new Error('Each zone needs "file" or "asset".');
            id = (await ctx.studio.importAudio(z.file, { source: 'sample' })).id;
          }
          out.push({ assetId: id, root: noteToMidi(z.root), lo: z.lo !== undefined ? noteToMidi(z.lo) : undefined, hi: z.hi !== undefined ? noteToMidi(z.hi) : undefined, velLo: z.velLo, velHi: z.velHi, tune: z.tune, gain: z.gain, pan: z.pan, loopStart: z.loopStart, loopEnd: z.loopEnd });
        }
        ctx.studio.mutate('Load samples', (p) => {
          const t = ops.findTrack(p, a.track);
          t.instrument = { type: 'sampler', preset: 'Default', params: a.params ?? {}, ...({ zones: out } as object) } as Track['instrument'];
        });
        return { summary: `Sampler loaded with ${out.length} zones.` };
      },
    }),
  },
};

// ============================================================ clips
const clipsTool: ToolDef = {
  name: 'clips',
  description: 'Clips on the timeline: list, create, move, split, duplicate, delete, audio clips.',
  actions: {
    list: action({
      description: 'List clips (optionally of one track) with their bars.',
      schema: z.object({ track: TrackS.optional() }),
      run: (ctx, a) => {
        const p = ctx.studio.project;
        const ts = a.track ? [ops.findTrack(p, a.track)] : p.tracks;
        const rows = ts.flatMap((t) => t.clips.map((c) => ({ track: t.name, trackId: t.id, id: c.id, kind: c.kind, name: c.name, from: barLabel(p, c.start / PPQ, (c.start + c.len) / PPQ), startBeat: c.start / PPQ, lengthBeats: c.len / PPQ, notes: c.kind === 'midi' ? c.notes.length : undefined, muted: !!c.muted })));
        return { summary: `${rows.length} clips`, clips: rows };
      },
    }),
    add: action({ description: 'Create an empty MIDI clip.', schema: z.object({ track: TrackS, at: PosS, length: LenS.optional(), name: z.string().optional() }), mutates: true, run: (ctx, a) => {
      let id = '';
      ctx.studio.mutate('Add clip', (p) => {
        const t = ops.findTrack(p, a.track);
        const at = pos(ctx, a.at);
        const l = len(ctx, a.length, at, 4);
        const c = ops.ensureMidiClip(p, t, ops.toTicks(at), ops.toTicks(at + l), a.name);
        id = c.id;
      });
      return { summary: `Clip ${id} ready.`, clip: id };
    } }),
    remove: action({ description: 'Delete a clip.', schema: z.object({ track: TrackS, clip: z.string() }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Delete clip', (p) => { const t = ops.findTrack(p, a.track); const n = t.clips.length; t.clips = t.clips.filter((c) => c.id !== a.clip); if (t.clips.length === n) throw new Error(`No clip ${a.clip} on ${t.name}.`); });
      return { summary: `Deleted clip ${a.clip}.` };
    } }),
    move: action({ description: 'Move a clip to a new start position.', schema: z.object({ track: TrackS, clip: z.string(), to: PosS }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Move clip', (p) => { const c = ops.findTrack(p, a.track).clips.find((x) => x.id === a.clip); if (!c) throw new Error(`No clip ${a.clip}.`); c.start = ops.toTicks(pos(ctx, a.to)); });
      return { summary: `Moved clip ${a.clip}.` };
    } }),
    duplicate: action({ description: 'Copy a clip to another position (optionally several times in a row).', schema: z.object({ track: TrackS, clip: z.string(), to: PosS, times: z.number().int().min(1).max(64).optional() }), mutates: true, run: (ctx, a) => {
      let made = 0;
      ctx.studio.mutate('Duplicate clip', (p) => {
        const t = ops.findTrack(p, a.track);
        const c = t.clips.find((x) => x.id === a.clip);
        if (!c) throw new Error(`No clip ${a.clip}.`);
        let at = ops.toTicks(pos(ctx, a.to));
        for (let i = 0; i < (a.times ?? 1); i++) {
          const k = structuredClone(c);
          k.id = ops.nextId('c');
          if (k.kind === 'midi') for (const n of k.notes) n.id = ops.nextId('n');
          k.start = at;
          t.clips.push(k);
          at += c.len;
          made++;
        }
        t.clips.sort((x, y) => x.start - y.start);
      });
      return { summary: `Copied clip ${made} time(s).` };
    } }),
    split: action({ description: 'Split a MIDI clip at a position.', schema: z.object({ track: TrackS, clip: z.string(), at: PosS }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Split clip', (p) => {
        const t = ops.findTrack(p, a.track);
        const c = t.clips.find((x) => x.id === a.clip);
        if (!c || c.kind !== 'midi') throw new Error('Only MIDI clips can be split.');
        const cut = ops.toTicks(pos(ctx, a.at)) - c.start;
        if (cut <= 0 || cut >= c.len) throw new Error('The split position is outside the clip.');
        const right = { ...structuredClone(c), id: ops.nextId('c'), start: c.start + cut, len: c.len - cut, notes: c.notes.filter((n) => n.t >= cut).map((n) => ({ ...n, id: ops.nextId('n'), t: n.t - cut })), cc: c.cc.map((l) => ({ cc: l.cc, pts: l.pts.filter((x) => x.t >= cut).map((x) => ({ ...x, t: x.t - cut })) })) };
        c.notes = c.notes.filter((n) => n.t < cut);
        c.cc = c.cc.map((l) => ({ cc: l.cc, pts: l.pts.filter((x) => x.t < cut) }));
        c.len = cut;
        t.clips.push(right);
        t.clips.sort((x, y) => x.start - y.start);
      });
      return { summary: 'Clip split.' };
    } }),
    update: action({ description: 'Rename, recolor, mute or resize a clip.', schema: z.object({ track: TrackS, clip: z.string(), name: z.string().optional(), color: z.string().optional(), muted: z.boolean().optional(), length: LenS.optional() }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Update clip', (p) => {
        const c = ops.findTrack(p, a.track).clips.find((x) => x.id === a.clip);
        if (!c) throw new Error(`No clip ${a.clip}.`);
        if (a.name) c.name = a.name;
        if (a.color) c.color = a.color;
        if (a.muted !== undefined) c.muted = a.muted;
        if (a.length !== undefined) c.len = ops.toTicks(len(ctx, a.length, c.start / PPQ, c.len / PPQ));
      });
      return { summary: `Updated clip ${a.clip}.` };
    } }),
    add_audio: action({
      description: 'Place an audio file or an asset on an audio track. Creates the track if `track` is a new name.',
      schema: z.object({ track: TrackS, file: z.string().optional(), asset: z.string().optional(), at: PosS, length: LenS.optional(), gain: z.number().optional(), offset: z.number().optional().describe('Start offset into the audio, seconds.'), fade_in: LenS.optional(), fade_out: LenS.optional(), name: z.string().optional() }),
      agent: 'loading',
      run: async (ctx, a) => {
        let assetId = a.asset as string | undefined;
        if (!assetId) {
          if (!a.file) throw new Error('Give "file" or "asset".');
          assetId = (await ctx.studio.importAudio(a.file)).id;
        }
        const asset = ctx.studio.assets.get(assetId);
        if (!asset) throw new Error(`No asset ${assetId}. Use audio {action:"list"}.`);
        const at = pos(ctx, a.at);
        const bpm = ctx.studio.project.tempo[0].bpm;
        const durBeats = (asset.ref.frames / asset.ref.sampleRate - (a.offset ?? 0)) * (bpm / 60);
        const l = a.length !== undefined ? len(ctx, a.length, at, durBeats) : durBeats;
        let cid = '';
        ctx.studio.mutate('Add audio clip', (p) => {
          let t = p.tracks.find((x) => x.id === a.track) ?? p.tracks.find((x) => x.name.toLowerCase() === a.track.toLowerCase());
          if (!t) t = ops.newTrack(p, { name: a.track, kind: 'audio' });
          if (t.kind !== 'audio') throw new Error(`Track "${t.name}" is not an audio track.`);
          const c = ops.addAudioClip(t, { assetId: assetId!, start: at, len: l, name: a.name ?? asset.ref.name, gain: a.gain, offset: a.offset, fadeIn: a.fade_in !== undefined ? len(ctx, a.fade_in) : 0, fadeOut: a.fade_out !== undefined ? len(ctx, a.fade_out) : 0.02 });
          cid = c.id;
        });
        return { summary: `Placed "${asset.ref.name}" at ${barLabel(ctx.studio.project, at, at + l)}.`, clip: cid };
      },
    }),
    edit_audio: action({
      description: 'Change an audio clip: gain (dB), fades, pitch shift (semitones, varispeed), rate, reverse, start offset.',
      schema: z.object({ track: TrackS, clip: z.string(), gain: z.number().optional(), fade_in: LenS.optional(), fade_out: LenS.optional(), pitch: z.number().optional(), rate: z.number().optional(), reverse: z.boolean().optional(), offset: z.number().optional() }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Edit audio clip', (p) => {
          const c = ops.findTrack(p, a.track).clips.find((x) => x.id === a.clip);
          if (!c || c.kind !== 'audio') throw new Error('Not an audio clip.');
          if (a.gain !== undefined) c.gain = a.gain;
          if (a.fade_in !== undefined) c.fadeIn = ops.toTicks(len(ctx, a.fade_in));
          if (a.fade_out !== undefined) c.fadeOut = ops.toTicks(len(ctx, a.fade_out));
          if (a.pitch !== undefined) c.pitch = a.pitch;
          if (a.rate !== undefined) c.rate = a.rate;
          if (a.reverse !== undefined) c.reverse = a.reverse;
          if (a.offset !== undefined) c.offset = a.offset;
        });
        return { summary: `Edited audio clip ${a.clip}.` };
      },
    }),
  },
};

// ============================================================ notes
const notesTool: ToolDef = {
  name: 'notes',
  description: 'Write and edit notes. Prefer the compact `text` form for writing music: "C4:1 E4:0.5 G4:0.5 r:1 [C4 E4 G4]:2@80".',
  actions: {
    add: action({
      description: 'Add notes to a track. Give `text` (compact notation, placed at `at`) or a `notes` array. Positions are absolute beats or "bar:beat". Clips are created automatically.',
      schema: z.object({
        track: TrackS,
        text: z.string().optional().describe('Compact note text, see studio help topic "time".'),
        notes: z.array(noteArg).optional(),
        at: PosS.optional().describe('Start position of the text, or an offset added to every note in `notes`.'),
        replace: z.boolean().optional().describe('Replace existing notes in the span covered by the new notes.'),
        clip_name: z.string().optional(),
        velocity: z.number().min(1).max(127).optional().describe('Default velocity for text notes.'),
      }),
      mutates: true,
      agent: 'building',
      run: (ctx, a) => {
        const base = a.at !== undefined ? pos(ctx, a.at) : 0;
        const list: TNote[] = a.text ? parseNoteText(a.text, { vel: a.velocity }).map((n) => ({ ...n, t: n.t + base })) : expandNotes(ctx, a.notes ?? [], base);
        if (!list.length) throw new Error('No notes given. Provide `text` or `notes`.');
        let tname = '';
        let clips: string[] = [];
        ctx.studio.mutate('Add notes', (p) => {
          const t = ops.findTrack(p, a.track);
          tname = t.name;
          const lo = Math.min(...list.map((n) => n.t));
          const hi = Math.max(...list.map((n) => n.t + n.d));
          clips = ops.addNotes(p, t, list, { clipName: a.clip_name, replaceRange: a.replace ? [lo, hi] : undefined }).clips;
        });
        const lo = Math.min(...list.map((n) => n.t));
        const hi = Math.max(...list.map((n) => n.t + n.d));
        return { summary: `Added ${list.length} notes to ${tname}, ${barLabel(ctx.studio.project, lo, hi)}.`, clips, _tracks: [ops.findTrack(ctx.studio.project, a.track).id] };
      },
    }),
    set: action({
      description: 'Replace ALL notes of one clip with the given list (absolute beats). Used by the piano roll; also handy to rewrite a clip in one go.',
      schema: z.object({ track: TrackS, clip: z.string(), notes: z.array(z.object({ id: z.string().optional(), start: z.number(), dur: z.number(), pitch: z.number(), vel: z.number().optional(), art: z.string().optional() })) }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Edit notes', (p) => {
          const t = ops.findTrack(p, a.track);
          const c = t.clips.find((x) => x.id === a.clip);
          if (!c || c.kind !== 'midi') throw new Error(`No MIDI clip ${a.clip} on ${t.name}.`);
          c.notes = a.notes.map((n: { id?: string; start: number; dur: number; pitch: number; vel?: number; art?: string }) => ({
            id: n.id && !/^(new|c)[a-z0-9]{5,6}$/.test(n.id) ? n.id : ops.nextId('n'),
            t: ops.toTicks(n.start) - c.start, d: Math.max(1, ops.toTicks(n.dur)), p: Math.max(0, Math.min(127, Math.round(n.pitch))), v: Math.max(1, Math.min(127, Math.round(n.vel ?? 90))),
            ...(n.art ? { art: n.art } : {}),
          })).sort((x: { t: number; p: number }, y: { t: number; p: number }) => x.t - y.t || x.p - y.p);
          const end = Math.max(0, ...c.notes.map((n) => n.t + n.d));
          if (end > c.len) c.len = Math.ceil(end / (ops.projectBeatsPerBar(p) * PPQ)) * ops.projectBeatsPerBar(p) * PPQ;
        });
        return { summary: `Clip ${a.clip} now has ${a.notes.length} notes.`, _tracks: [ops.findTrack(ctx.studio.project, a.track).id] };
      },
    }),
    get: action({
      description: 'Read notes back as text (one line per bar) so you can check what was written. Range in beats or bars.',
      schema: z.object({ track: TrackS, from: PosS.optional(), to: PosS.optional(), limit_bars: z.number().int().optional() }),
      run: (ctx, a) => {
        const t = track(ctx, a.track);
        const from = a.from !== undefined ? pos(ctx, a.from) : undefined;
        const to = a.to !== undefined ? pos(ctx, a.to) : undefined;
        const notes = ops.getNotes(t, from, to);
        let text = notesToText(notes, ctx.studio.project.sig);
        const lines = text.split('\n');
        const cap = a.limit_bars ?? 64;
        if (lines.length > cap) text = lines.slice(0, cap).join('\n') + `\n... (${lines.length - cap} more bars; narrow with from/to)`;
        return { summary: `${notes.length} notes on ${t.name}`, count: notes.length, text: text || '(no notes)' };
      },
    }),
    remove: action({
      description: 'Delete notes in a range and/or pitch range. With no range, deletes ALL notes of the track.',
      schema: z.object({ track: TrackS, from: PosS.optional(), to: PosS.optional(), pitch_min: PitchS.optional(), pitch_max: PitchS.optional(), all: z.boolean().optional().describe('Required to clear the whole track when no range is given.') }),
      mutates: true,
      run: (ctx, a) => {
        if (a.from === undefined && a.to === undefined && a.pitch_min === undefined && a.pitch_max === undefined && !a.all) throw new Error('This would delete every note. Pass all:true to confirm, or give a range.');
        const from = a.from !== undefined ? pos(ctx, a.from) : -Infinity;
        const to = a.to !== undefined ? pos(ctx, a.to) : Infinity;
        const lo = a.pitch_min !== undefined ? noteToMidi(a.pitch_min) : 0;
        const hi = a.pitch_max !== undefined ? noteToMidi(a.pitch_max) : 127;
        let n = 0;
        ctx.studio.mutate('Delete notes', (p) => { n = ops.removeNotes(ops.findTrack(p, a.track), (x) => x.t >= from - 1e-6 && x.t < to - 1e-6 && x.p >= lo && x.p <= hi); });
        return { summary: `Deleted ${n} notes.`, deleted: n };
      },
    }),
    transform: action({
      description: 'Edit notes in a range: transpose, octave, velocity_scale, velocity_add, set_velocity, quantize, humanize, legato, staccato, stretch, shift, reverse, set_articulation.',
      schema: z.object({
        track: TrackS, op: z.enum(['transpose', 'octave', 'velocity_scale', 'velocity_add', 'set_velocity', 'quantize', 'humanize', 'legato', 'staccato', 'stretch', 'shift', 'reverse', 'set_articulation']),
        from: PosS.optional(), to: PosS.optional(), pitch_min: PitchS.optional(), pitch_max: PitchS.optional(),
        amount: z.number().optional().describe('Semitones, octaves, factor, beats or velocity depending on op.'),
        grid: z.number().optional().describe('quantize grid in beats (0.25 = 16th).'), strength: z.number().min(0).max(1).optional(),
        timing_ms: z.number().optional(), velocity_jitter: z.number().optional(), seed: z.number().optional(), art: z.string().optional(),
      }),
      mutates: true,
      run: (ctx, a) => {
        const p0 = ctx.studio.project;
        const bpm = p0.tempo[0].bpm;
        const from = a.from !== undefined ? pos(ctx, a.from) : -Infinity;
        const to = a.to !== undefined ? pos(ctx, a.to) : Infinity;
        const lo = a.pitch_min !== undefined ? noteToMidi(a.pitch_min) : 0;
        const hi = a.pitch_max !== undefined ? noteToMidi(a.pitch_max) : 127;
        const amt = a.amount ?? 0;
        let changed = 0;
        ctx.studio.mutate(`Notes: ${a.op}`, (p) => {
          const t = ops.findTrack(p, a.track);
          const sel = (n: TNote) => n.t >= from - 1e-6 && n.t < to - 1e-6 && n.p >= lo && n.p <= hi;
          const all = ops.getNotes(t);
          const picked = all.filter(sel);
          const byId = new Map<string, Partial<TNote>>();
          switch (a.op) {
            case 'transpose': for (const n of picked) byId.set(n.id, { p: n.p + amt }); break;
            case 'octave': for (const n of picked) byId.set(n.id, { p: n.p + 12 * amt }); break;
            case 'velocity_scale': for (const n of picked) byId.set(n.id, { v: n.v * (a.amount ?? 1) }); break;
            case 'velocity_add': for (const n of picked) byId.set(n.id, { v: n.v + amt }); break;
            case 'set_velocity': for (const n of picked) byId.set(n.id, { v: amt }); break;
            case 'shift': for (const n of picked) byId.set(n.id, { t: n.t + amt }); break;
            case 'stretch': { const o = picked.length ? Math.min(...picked.map((n) => n.t)) : 0; const f = a.amount ?? 1; for (const n of picked) byId.set(n.id, { t: o + (n.t - o) * f, d: n.d * f }); break; }
            case 'staccato': for (const n of picked) byId.set(n.id, { d: n.d * (a.amount ?? 0.5) }); break;
            case 'set_articulation': for (const n of picked) byId.set(n.id, { art: a.art }); break;
            case 'quantize': { const q = quantize(picked, a.grid ?? 0.25, a.strength ?? 1); picked.forEach((n, i) => byId.set(n.id, { t: q[i].t })); break; }
            case 'humanize': { const h = humanizeNotes(picked, { bpm, timing: a.timing_ms ?? 6, velocity: a.velocity_jitter ?? 5, drift: 8, seed: a.seed ?? 1 }); picked.forEach((n, i) => byId.set(n.id, { t: h[i].t, v: h[i].v, d: h[i].d })); break; }
            case 'legato': {
              const sorted = [...picked].sort((x, y) => x.t - y.t);
              sorted.forEach((n, i) => { const nx = sorted.slice(i + 1).find((m) => m.t > n.t + 0.01); if (nx) byId.set(n.id, { d: Math.max(n.d, nx.t - n.t + ((a.amount ?? 25) / 1000) * (bpm / 60)) }); });
              break;
            }
            case 'reverse': {
              if (picked.length) { const a0 = Math.min(...picked.map((n) => n.t)); const b0 = Math.max(...picked.map((n) => n.t + n.d)); for (const n of picked) byId.set(n.id, { t: a0 + (b0 - (n.t + n.d)) }); }
              break;
            }
          }
          changed = ops.mapNotes(t, (n) => byId.get(n.id));
        });
        return { summary: `${a.op}: changed ${changed} notes on ${track(ctx, a.track).name}.`, changed };
      },
    }),
    cc: action({
      description: 'Write controller data: 1 mod wheel (vibrato), 7 volume, 11 expression, 64 sustain pedal, 128 pitch bend (-1..1). Points are {at, value}; value 0-127 (pedal: 0 up, 127 down).',
      schema: z.object({ track: TrackS, controller: z.number().int().min(0).max(128), points: z.array(z.object({ at: PosS, value: z.number() })) }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Controller data', (p) => ops.setCC(p, ops.findTrack(p, a.track), a.controller, a.points.map((x: { at: string | number; value: number }) => ({ t: pos(ctx, x.at), v: x.value }))));
        return { summary: `Wrote ${a.points.length} points of CC${a.controller}.` };
      },
    }),
  },
};

// ============================================================ automation
const automationTool: ToolDef = {
  name: 'automation',
  description: 'Automate volume, pan, send levels, instrument parameters and effect parameters over time.',
  actions: {
    targets: action({
      description: 'List automatable targets for a track (or master).',
      schema: z.object({ track: TrackS.optional() }),
      run: (ctx, a) => {
        const p = ctx.studio.project;
        const t = a.track && a.track !== 'master' ? ops.findTrack(p, a.track) : null;
        const owner = t ? t.inserts : p.master.inserts;
        const targets = ['vol', ...(t ? ['pan', 'mute', ...t.sends.map((_, i) => `send:${i}`)] : [])];
        if (t?.instrument) { const d = getInstrumentDef(t.instrument.type); for (const q of d?.params ?? []) targets.push(`inst:${q.id}`); }
        for (const f of owner) for (const q of getFxDef(f.type)?.params ?? []) targets.push(`fx:${f.id}:${q.id}`);
        return { summary: `${targets.length} targets`, targets };
      },
    }),
    set: action({
      description: 'Set automation points on a target: "vol" (dB), "pan", "send:0", "inst:<param>", "fx:<fxId>:<param>". Points are {at, value, curve?}; curve -1..1 shapes the segment after the point. Replaces points in the covered range.',
      schema: z.object({ track: TrackS.describe('Track, or "master".'), target: z.string(), points: z.array(z.object({ at: PosS, value: z.number(), curve: z.number().min(-1).max(1).optional() })) }),
      mutates: true,
      agent: 'mixing',
      run: (ctx, a) => {
        ctx.studio.mutate('Automation', (p) => {
          const owner = a.track === 'master' ? p.master : ops.findTrack(p, a.track);
          ops.setAutomation(owner, a.target, a.points.map((x: { at: string | number; value: number; curve?: number }) => ({ t: pos(ctx, x.at), v: x.value, c: x.curve })));
        });
        return { summary: `Automated ${a.target} on ${a.track} with ${a.points.length} points.` };
      },
    }),
    ramp: action({
      description: 'Shortcut: ramp a target from one value to another between two positions.',
      schema: z.object({ track: TrackS, target: z.string(), from_at: PosS, to_at: PosS, from_value: z.number(), to_value: z.number(), curve: z.number().optional() }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Automation ramp', (p) => {
          const owner = a.track === 'master' ? p.master : ops.findTrack(p, a.track);
          ops.setAutomation(owner, a.target, [{ t: pos(ctx, a.from_at), v: a.from_value, c: a.curve }, { t: pos(ctx, a.to_at), v: a.to_value }]);
        });
        return { summary: `Ramped ${a.target} ${a.from_value} to ${a.to_value}.` };
      },
    }),
    lfo: action({
      description: 'Write a smooth LFO shape (sine) into a target between two positions, e.g. a filter sweep or tremolo on a send.',
      schema: z.object({ track: TrackS, target: z.string(), from_at: PosS, to_at: PosS, min: z.number(), max: z.number(), period_beats: z.number().min(0.25), shape: z.enum(['sine', 'triangle', 'saw']).optional() }),
      mutates: true,
      run: (ctx, a) => {
        const from = pos(ctx, a.from_at);
        const to = pos(ctx, a.to_at);
        const pts: { t: number; v: number }[] = [];
        const step = a.period_beats / 16;
        for (let t = from; t <= to + 1e-6; t += step) {
          const x = ((t - from) / a.period_beats) % 1;
          const s = a.shape === 'triangle' ? (x < 0.5 ? x * 2 : 2 - x * 2) : a.shape === 'saw' ? x : 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
          pts.push({ t, v: a.min + (a.max - a.min) * s });
        }
        ctx.studio.mutate('Automation LFO', (p) => ops.setAutomation(a.track === 'master' ? p.master : ops.findTrack(p, a.track), a.target, pts));
        return { summary: `LFO written to ${a.target} (${pts.length} points).` };
      },
    }),
    get: action({
      description: 'Read the automation lanes of a track.',
      schema: z.object({ track: TrackS }),
      run: (ctx, a) => {
        const p = ctx.studio.project;
        const o = a.track === 'master' ? p.master : ops.findTrack(p, a.track);
        return { summary: `${o.auto.length} lanes`, lanes: o.auto.map((l) => ({ target: l.target, points: l.pts.map((x) => ({ at: round(x.t / PPQ, 3), value: round(x.v, 3), curve: x.c })) })) };
      },
    }),
    clear: action({
      description: 'Remove automation for a target (or all targets of the track when `target` is omitted).',
      schema: z.object({ track: TrackS, target: z.string().optional() }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Clear automation', (p) => { const o = a.track === 'master' ? p.master : ops.findTrack(p, a.track); o.auto = a.target ? o.auto.filter((l) => l.target !== a.target) : []; });
        return { summary: 'Automation cleared.' };
      },
    }),
  },
};

// ============================================================ effects
const effectsTool: ToolDef = {
  name: 'effects',
  description: 'Insert effects on tracks and the master, sends to buses, sidechain routing.',
  actions: {
    catalog: action({ description: 'All effects with category, description and presets.', schema: z.object({}), run: () => ({ summary: `${FX_DEFS.length} effects`, effects: FX_DEFS.map((d) => ({ type: d.type, name: d.name, category: d.category, description: d.description, presets: Object.keys(d.presets ?? {}) })) }) }),
    info: action({ description: 'Parameter list of one effect.', schema: z.object({ type: z.string() }), run: (_c, a) => { const d = getFxDef(a.type); if (!d) throw new Error(`Unknown effect ${a.type}`); return { summary: d.name, params: d.params.map((p) => ({ id: p.id, name: p.name, min: p.min, max: p.max, default: p.def, unit: p.unit, options: p.options })), presets: d.presets }; } }),
    add: action({
      description: 'Insert an effect on a track (or "master"). Use preset and/or params. sidechain: a track whose signal keys a compressor.',
      schema: z.object({ track: TrackS.describe('Track, bus, or "master".'), type: z.string(), preset: z.string().optional(), params: z.record(z.string(), z.union([z.number(), z.string()])).optional(), index: z.number().int().optional(), sidechain: z.string().optional() }),
      mutates: true,
      agent: 'mixing',
      run: (ctx, a) => {
        let id = '';
        ctx.studio.mutate(`Add ${a.type}`, (p) => {
          const t = a.track === 'master' ? null : ops.findTrack(p, a.track);
          const sc = a.sidechain ? ops.findTrack(p, a.sidechain).id : undefined;
          id = ops.addFx(p, t, a.type, { preset: a.preset, params: a.params, index: a.index, sidechain: sc }).id;
        });
        return { summary: `Added ${a.type}${a.preset ? ' (' + a.preset + ')' : ''} to ${a.track} as ${id}.`, fx: id };
      },
    }),
    update: action({
      description: 'Change effect parameters, bypass it, or set its sidechain source.',
      schema: z.object({ fx: z.string().describe('Effect id (fx1 ...).'), params: z.record(z.string(), z.union([z.number(), z.string()])).optional(), preset: z.string().optional(), bypass: z.boolean().optional(), sidechain: z.string().optional() }),
      mutates: true,
      run: (ctx, a) => {
        ctx.studio.mutate('Update effect', (p) => {
          const { fx } = ops.findFx(p, a.fx);
          if (a.preset) {
            const d = getFxDef(fx.type)!;
            const key = Object.keys(d.presets ?? {}).find((k) => k.toLowerCase().includes(a.preset!.toLowerCase()));
            if (!key) throw new Error(`Unknown preset "${a.preset}".`);
            fx.params = { ...fx.params, ...d.presets![key] };
          }
          if (a.params) fx.params = { ...fx.params, ...a.params };
          if (a.bypass !== undefined) fx.bypass = a.bypass;
          if (a.sidechain !== undefined) fx.sidechain = a.sidechain ? ops.findTrack(p, a.sidechain).id : undefined;
        });
        return { summary: `Updated ${a.fx}.` };
      },
    }),
    remove: action({ description: 'Remove an effect by id.', schema: z.object({ fx: z.string() }), mutates: true, run: (ctx, a) => { ctx.studio.mutate('Remove effect', (p) => { const { owner } = ops.findFx(p, a.fx); const list = owner ? owner.inserts : p.master.inserts; const i = list.findIndex((f) => f.id === a.fx); list.splice(i, 1); }); return { summary: `Removed ${a.fx}.` }; } }),
    move: action({ description: 'Move an effect to a position in its chain.', schema: z.object({ fx: z.string(), index: z.number().int() }), mutates: true, run: (ctx, a) => { ctx.studio.mutate('Move effect', (p) => { const { fx, owner } = ops.findFx(p, a.fx); const list = owner ? owner.inserts : p.master.inserts; list.splice(list.indexOf(fx), 1); list.splice(Math.max(0, a.index), 0, fx); }); return { summary: `Moved ${a.fx}.` }; } }),
    list: action({ description: 'Effects on a track or master.', schema: z.object({ track: TrackS }), run: (ctx, a) => { const p = ctx.studio.project; const list = a.track === 'master' ? p.master.inserts : ops.findTrack(p, a.track).inserts; return { summary: `${list.length} effects`, effects: list }; } }),
    send: action({
      description: 'Send a track to a bus at a level (dB). level null removes the send.',
      schema: z.object({ track: TrackS, to: TrackS, level: z.number().min(-60).max(12).nullable().optional(), pre: z.boolean().optional() }),
      mutates: true,
      agent: 'mixing',
      run: (ctx, a) => {
        ctx.studio.mutate('Send', (p) => {
          const t = ops.findTrack(p, a.track);
          const bus = ops.findTrack(p, a.to);
          if (bus.kind !== 'bus') throw new Error(`"${bus.name}" is not a bus. Create one with tracks {action:"add", kind:"bus"}.`);
          t.sends = t.sends.filter((s) => s.to !== bus.id);
          if (a.level !== null) t.sends.push({ to: bus.id, level: a.level ?? -12, pre: a.pre });
        });
        return { summary: `Send ${a.track} to ${a.to}: ${a.level === null ? 'removed' : (a.level ?? -12) + ' dB'}.` };
      },
    }),
  },
};

// ============================================================ mixer
const mixerTool: ToolDef = {
  name: 'mixer',
  description: 'Levels, pans, mute/solo for many tracks at once, and the master fader.',
  actions: {
    get: action({ description: 'Current mixer state.', schema: z.object({}), run: (ctx) => { const p = ctx.studio.project; return { summary: 'Mixer', master: { volDb: p.master.vol, inserts: p.master.inserts.map((f) => `${f.id}:${f.type}`) }, tracks: p.tracks.map((t) => ({ id: t.id, name: t.name, volDb: t.vol, pan: t.pan, mute: t.mute, solo: t.solo, out: t.out, sends: t.sends })) }; } }),
    set: action({
      description: 'Set levels for several tracks in one call. levels: [{track, vol, pan, mute, solo}], master_vol in dB.',
      schema: z.object({ levels: z.array(z.object({ track: TrackS, vol: z.number().optional(), pan: z.number().optional(), mute: z.boolean().optional(), solo: z.boolean().optional() })).optional(), master_vol: z.number().optional() }),
      mutates: true,
      agent: 'mixing',
      run: (ctx, a) => {
        ctx.studio.mutate('Mixer', (p) => {
          for (const l of a.levels ?? []) {
            const t = ops.findTrack(p, l.track);
            if (l.vol !== undefined) t.vol = l.vol;
            if (l.pan !== undefined) t.pan = l.pan;
            if (l.mute !== undefined) t.mute = l.mute;
            if (l.solo !== undefined) t.solo = l.solo;
          }
          if (a.master_vol !== undefined) p.master.vol = a.master_vol;
        });
        return { summary: `Mixer updated (${a.levels?.length ?? 0} tracks).` };
      },
    }),
    clear_solo: action({ description: 'Turn off all mute and solo switches.', schema: z.object({}), mutates: true, run: (ctx) => { ctx.studio.mutate('Clear solo', (p) => { for (const t of p.tracks) { t.solo = false; t.mute = false; } }); return { summary: 'All mute/solo cleared.' }; } }),
  },
};

// ============================================================ transport
const transportTool: ToolDef = {
  name: 'transport',
  description: 'Playback in the app so the human can listen: play, pause, stop, seek, loop.',
  actions: {
    play: action({
      description: 'Start playback in the app, optionally from a position and looping a range.',
      schema: z.object({ from: PosS.optional(), loop_from: PosS.optional(), loop_to: PosS.optional() }),
      agent: 'listening',
      run: (ctx, a) => {
        const from = a.from !== undefined ? pos(ctx, a.from) : undefined;
        if (a.loop_from !== undefined && a.loop_to !== undefined) ctx.studio.mutate('Loop', (p) => { p.loop = { start: ops.toTicks(pos(ctx, a.loop_from)), end: ops.toTicks(pos(ctx, a.loop_to)) }; });
        ctx.studio.emit('transport', { cmd: 'play', from });
        return { summary: ctx.studio.transport.uiConnected ? 'Playing in the app.' : 'Play requested, but no app window is open to play it.', uiConnected: ctx.studio.transport.uiConnected };
      },
    }),
    pause: action({ description: 'Pause playback.', schema: z.object({}), run: (ctx) => { ctx.studio.emit('transport', { cmd: 'pause' }); return { summary: 'Paused.' }; } }),
    stop: action({ description: 'Stop and return to the start.', schema: z.object({}), run: (ctx) => { ctx.studio.emit('transport', { cmd: 'stop' }); return { summary: 'Stopped.' }; } }),
    seek: action({ description: 'Move the playhead.', schema: z.object({ to: PosS }), run: (ctx, a) => { ctx.studio.emit('transport', { cmd: 'seek', to: pos(ctx, a.to) }); return { summary: `Playhead at ${a.to}.` }; } }),
    loop: action({ description: 'Set or clear the loop region.', schema: z.object({ from: PosS.optional(), to: PosS.optional(), off: z.boolean().optional() }), mutates: true, run: (ctx, a) => {
      ctx.studio.mutate('Loop', (p) => { p.loop = a.off || a.from === undefined ? null : { start: ops.toTicks(pos(ctx, a.from)), end: ops.toTicks(pos(ctx, a.to, 0)) }; });
      return { summary: a.off ? 'Loop off.' : 'Loop set.' };
    } }),
    status: action({ description: 'Whether the app is playing and where the playhead is.', schema: z.object({}), run: (ctx) => ({ summary: ctx.studio.transport.playing ? 'Playing' : 'Stopped', ...ctx.studio.transport, positionBar: barOfBeat(ctx.studio.project.sig, ctx.studio.transport.position * (ctx.studio.project.tempo[0].bpm / 60)).bar }) }),
  },
};

export const coreTools: ToolDef[] = [studioTool, agentTool, tracksTool, instrumentsTool, clipsTool, notesTool, automationTool, effectsTool, mixerTool, transportTool];
export { safeName, beatsPerBarAt, MeterMap };
