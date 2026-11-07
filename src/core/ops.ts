// Pure operations on the project model. Everything here works in beats at the API surface and ticks inside the model.

import { PPQ, MeterMap, TRACK_COLORS } from '../engine/project.ts';
import type { AudioClip, AutoLane, CCLane, FxSpec, MidiClip, NoteEvent, Project, Track } from '../engine/project.ts';
import type { TNote } from '../theory/humanize.ts';
import { getInstrumentDef, findPreset } from '../engine/instruments/index.ts';
import { getFxDef } from '../engine/fx/index.ts';

let counter = 0;
export function resetIds(p: Project): void {
  let max = 0;
  const scan = (s: string) => {
    const m = /^[a-z]+(\d+)$/.exec(s);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  for (const t of p.tracks) {
    scan(t.id);
    for (const c of t.clips) {
      scan(c.id);
      if (c.kind === 'midi') for (const n of c.notes) scan(n.id);
    }
    for (const f of t.inserts) scan(f.id);
    for (const a of t.auto) scan(a.id);
  }
  for (const f of p.master.inserts) scan(f.id);
  counter = Math.max(counter, max);
}
export const nextId = (prefix: string): string => prefix + ++counter;

export const toTicks = (beats: number): number => Math.round(beats * PPQ * 1000) / 1000;
export const toBeats = (ticks: number): number => ticks / PPQ;

export function findTrack(p: Project, ref: string | undefined): Track {
  if (!ref) throw new Error('A track is required. Use tracks action "list" to see the ids and names.');
  const byId = p.tracks.find((t) => t.id === ref);
  if (byId) return byId;
  const low = ref.toLowerCase();
  const exact = p.tracks.filter((t) => t.name.toLowerCase() === low);
  if (exact.length === 1) return exact[0];
  const part = p.tracks.filter((t) => t.name.toLowerCase().startsWith(low) || t.name.toLowerCase().includes(low));
  if (part.length === 1) return part[0];
  if (exact.length > 1 || part.length > 1) throw new Error(`"${ref}" matches several tracks (${(exact.length ? exact : part).map((t) => `${t.id}:${t.name}`).join(', ')}). Use the id.`);
  throw new Error(`No track "${ref}". Tracks: ${p.tracks.map((t) => `${t.id}:${t.name}`).join(', ') || '(none)'}.`);
}

export function newTrack(p: Project, o: { name?: string; kind?: Track['kind']; color?: string; instrument?: { type: string; preset?: string; params?: Record<string, number | string> }; out?: string }): Track {
  const kind = o.kind ?? (o.instrument ? 'instrument' : 'audio');
  let instrument: Track['instrument'];
  if (kind === 'instrument') {
    const type = o.instrument?.type ?? 'piano';
    const def = getInstrumentDef(type);
    if (!def) throw new Error(`Unknown instrument "${type}". Known: ${['piano', 'organ', 'fm', 'mallet', 'plucked', 'wind_string', 'subsynth', 'drums', 'sampler'].join(', ')}.`);
    let preset = o.instrument?.preset;
    if (preset) {
      const real = Object.keys(def.presets).find((k) => k === preset) ?? Object.keys(def.presets).find((k) => k.toLowerCase() === preset!.toLowerCase()) ?? Object.keys(def.presets).find((k) => k.toLowerCase().includes(preset!.toLowerCase()));
      if (!real) throw new Error(`Unknown preset "${preset}" for ${type}. Presets: ${Object.keys(def.presets).join(', ')}.`);
      preset = real;
    }
    instrument = { type, preset, params: { ...(o.instrument?.params ?? {}) } };
  }
  const t: Track = {
    id: nextId('t'),
    name: o.name ?? (instrument ? (getInstrumentDef(instrument.type)?.name ?? 'Track') : kind === 'bus' ? 'Bus' : 'Audio'),
    kind,
    color: o.color ?? TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
    instrument,
    inserts: [],
    sends: [],
    vol: 0,
    pan: 0,
    mute: false,
    solo: false,
    out: o.out ?? 'master',
    clips: [],
    auto: [],
  };
  p.tracks.push(t);
  return t;
}

export function projectBeatsPerBar(p: Project, atBeat = 0): number {
  return new MeterMap(p.sig).barTicksAt(atBeat * PPQ) / PPQ;
}

export function projectLengthBeats(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.len);
  return end / PPQ;
}

function barStartTick(p: Project, tick: number): number {
  const m = new MeterMap(p.sig);
  const pos = m.position(tick);
  return m.tickOf(pos.bar, 1);
}

function barEndTick(p: Project, tick: number): number {
  const m = new MeterMap(p.sig);
  const pos = m.position(tick);
  return m.tickOf(pos.bar + 1, 1);
}

/** Find the clip a span belongs to, or make one aligned to bars. Overlapping clips are merged. */
export function ensureMidiClip(p: Project, t: Track, startTick: number, endTick: number, name?: string): MidiClip {
  const overlapping = t.clips.filter((c): c is MidiClip => c.kind === 'midi' && c.start < endTick && c.start + c.len > startTick);
  if (!overlapping.length) {
    const s = barStartTick(p, startTick);
    let e = barEndTick(p, Math.max(startTick, endTick - 1));
    if (e <= s) e = barEndTick(p, s);
    const clip: MidiClip = { id: nextId('c'), kind: 'midi', start: s, len: e - s, name: name ?? t.name, notes: [], cc: [] };
    t.clips.push(clip);
    t.clips.sort((a, b) => a.start - b.start);
    return clip;
  }
  const first = overlapping[0];
  let lo = Math.min(first.start, barStartTick(p, startTick));
  let hi = Math.max(first.start + first.len, barEndTick(p, Math.max(startTick, endTick - 1)));
  for (const o of overlapping.slice(1)) {
    lo = Math.min(lo, o.start);
    hi = Math.max(hi, o.start + o.len);
  }
  // move first's content to the new origin and merge the others in
  const shift = first.start - lo;
  if (shift) {
    for (const n of first.notes) n.t += shift;
    for (const l of first.cc) for (const pt of l.pts) pt.t += shift;
  }
  for (const o of overlapping.slice(1)) {
    const off = o.start - lo;
    for (const n of o.notes) first.notes.push({ ...n, t: n.t + off });
    for (const l of o.cc) {
      const mine = first.cc.find((x) => x.cc === l.cc);
      const pts = l.pts.map((pt) => ({ ...pt, t: pt.t + off }));
      if (mine) mine.pts.push(...pts);
      else first.cc.push({ cc: l.cc, pts });
    }
    t.clips = t.clips.filter((c) => c !== o);
  }
  first.start = lo;
  first.len = hi - lo;
  if (name) first.name = name;
  return first;
}

export interface NoteIn {
  start: number;
  dur: number;
  pitch: number;
  vel?: number;
  art?: string;
}

/** Add notes given in absolute beats. Returns the clip ids touched. */
export function addNotes(p: Project, t: Track, notes: TNote[], o: { clipName?: string; replaceRange?: [number, number] } = {}): { clips: string[]; added: number } {
  if (t.kind !== 'instrument') throw new Error(`Track "${t.name}" is an ${t.kind} track and cannot hold notes. Use an instrument track.`);
  if (!notes.length) return { clips: [], added: 0 };
  const lo = Math.min(...notes.map((n) => n.t));
  const hi = Math.max(...notes.map((n) => n.t + n.d));
  const startTick = toTicks(lo);
  const endTick = toTicks(hi);
  const clip = ensureMidiClip(p, t, startTick, Math.max(endTick, startTick + 1), o.clipName);
  if (o.replaceRange) {
    const a = toTicks(o.replaceRange[0]) - clip.start;
    const b = toTicks(o.replaceRange[1]) - clip.start;
    clip.notes = clip.notes.filter((n) => !(n.t >= a - 1e-6 && n.t < b - 1e-6));
  }
  for (const n of notes) {
    clip.notes.push({
      id: nextId('n'),
      t: toTicks(n.t) - clip.start,
      d: Math.max(1, toTicks(n.d)),
      p: Math.max(0, Math.min(127, Math.round(n.p))),
      v: Math.max(1, Math.min(127, Math.round(n.v ?? 90))),
      ...(n.art ? { art: n.art } : {}),
    });
  }
  clip.notes.sort((a, b) => a.t - b.t || a.p - b.p);
  const maxEnd = Math.max(...clip.notes.map((n) => n.t + n.d));
  if (maxEnd > clip.len) clip.len = barEndTick(p, clip.start + maxEnd - 1) - clip.start;
  return { clips: [clip.id], added: notes.length };
}

/** All notes of a track as absolute beats, optionally limited to a beat range and pitch range. */
export function getNotes(t: Track, from?: number, to?: number): (TNote & { id: string; clip: string })[] {
  const out: (TNote & { id: string; clip: string })[] = [];
  for (const c of t.clips) {
    if (c.kind !== 'midi') continue;
    for (const n of c.notes) {
      const s = (c.start + n.t) / PPQ;
      if (from !== undefined && s < from - 1e-6) continue;
      if (to !== undefined && s >= to - 1e-6) continue;
      out.push({ id: n.id, clip: c.id, t: s, d: n.d / PPQ, p: n.p, v: n.v, art: n.art });
    }
  }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}

export function removeNotes(t: Track, pred: (n: TNote & { id: string }) => boolean): number {
  let removed = 0;
  for (const c of t.clips) {
    if (c.kind !== 'midi') continue;
    const before = c.notes.length;
    c.notes = c.notes.filter((n) => !pred({ id: n.id, t: (c.start + n.t) / PPQ, d: n.d / PPQ, p: n.p, v: n.v, art: n.art }));
    removed += before - c.notes.length;
  }
  return removed;
}

/** Update notes in place: the callback may return a patch (absolute beats) or null to delete. */
export function mapNotes(t: Track, fn: (n: TNote & { id: string }) => Partial<TNote> | null | undefined): number {
  let changed = 0;
  for (const c of t.clips) {
    if (c.kind !== 'midi') continue;
    const next: NoteEvent[] = [];
    for (const n of c.notes) {
      const abs = { id: n.id, t: (c.start + n.t) / PPQ, d: n.d / PPQ, p: n.p, v: n.v, art: n.art };
      const r = fn(abs);
      if (r === null) {
        changed++;
        continue;
      }
      if (r) {
        const merged = { ...abs, ...r };
        next.push({ id: n.id, t: toTicks(merged.t) - c.start, d: Math.max(1, toTicks(merged.d)), p: Math.max(0, Math.min(127, Math.round(merged.p))), v: Math.max(1, Math.min(127, Math.round(merged.v))), ...(merged.art ? { art: merged.art } : {}) });
        changed++;
      } else next.push(n);
    }
    c.notes = next.sort((a, b) => a.t - b.t || a.p - b.p);
  }
  return changed;
}

export function setCC(p: Project, t: Track, cc: number, pts: { t: number; v: number }[]): void {
  if (!pts.length) return;
  const lo = Math.min(...pts.map((x) => x.t));
  const hi = Math.max(...pts.map((x) => x.t));
  const clip = ensureMidiClip(p, t, toTicks(lo), Math.max(toTicks(hi), toTicks(lo) + 1));
  let lane = clip.cc.find((l) => l.cc === cc);
  if (!lane) {
    lane = { cc, pts: [] };
    clip.cc.push(lane);
  }
  const a = toTicks(lo) - clip.start;
  const b = toTicks(hi) - clip.start;
  lane.pts = lane.pts.filter((x) => x.t < a - 1e-6 || x.t > b + 1e-6);
  for (const x of pts) lane.pts.push({ t: toTicks(x.t) - clip.start, v: x.v });
  lane.pts.sort((x, y) => x.t - y.t);
}

export function getCC(t: Track, cc: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (const c of t.clips) {
    if (c.kind !== 'midi') continue;
    const lane = c.cc.find((l) => l.cc === cc);
    if (lane) for (const pt of lane.pts) out.push({ t: (c.start + pt.t) / PPQ, v: pt.v });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function addFx(p: Project, t: Track | null, type: string, o: { preset?: string; params?: Record<string, number | string>; index?: number; sidechain?: string; name?: string } = {}): FxSpec {
  const def = getFxDef(type);
  if (!def) throw new Error(`Unknown effect "${type}". Known: eq, compressor, limiter, gate, reverb, delay, chorus, flanger, phaser, tremolo, filter, distortion, bitcrusher, lofi, utility, widener.`);
  let params: Record<string, number | string> = {};
  if (o.preset) {
    const key = Object.keys(def.presets ?? {}).find((k) => k.toLowerCase() === o.preset!.toLowerCase()) ?? Object.keys(def.presets ?? {}).find((k) => k.toLowerCase().includes(o.preset!.toLowerCase()));
    if (!key) throw new Error(`Unknown preset "${o.preset}" for ${type}. Presets: ${Object.keys(def.presets ?? {}).join(', ') || '(none)'}.`);
    params = { ...def.presets![key] };
  }
  Object.assign(params, o.params ?? {});
  const fx: FxSpec = { id: nextId('fx'), type, name: o.name ?? def.name, params, ...(o.sidechain ? { sidechain: o.sidechain } : {}) };
  const list = t ? t.inserts : p.master.inserts;
  if (o.index === undefined || o.index >= list.length) list.push(fx);
  else list.splice(Math.max(0, o.index), 0, fx);
  return fx;
}

export function findFx(p: Project, ref: string): { fx: FxSpec; owner: Track | null } {
  for (const t of p.tracks) {
    const f = t.inserts.find((x) => x.id === ref);
    if (f) return { fx: f, owner: t };
  }
  const m = p.master.inserts.find((x) => x.id === ref);
  if (m) return { fx: m, owner: null };
  throw new Error(`No effect with id "${ref}".`);
}

export function setAutomation(owner: { auto: AutoLane[] }, target: string, pts: { t: number; v: number; c?: number }[], replace = true): AutoLane {
  let lane = owner.auto.find((l) => l.target === target);
  if (!lane) {
    lane = { id: nextId('a'), target, pts: [] };
    owner.auto.push(lane);
  }
  const sorted = [...pts].sort((a, b) => a.t - b.t).map((x) => ({ t: toTicks(x.t), v: x.v, ...(x.c ? { c: x.c } : {}) }));
  if (replace && sorted.length) {
    const a = sorted[0].t;
    const b = sorted[sorted.length - 1].t;
    lane.pts = lane.pts.filter((x) => x.t < a - 1e-6 || x.t > b + 1e-6);
  }
  lane.pts.push(...sorted);
  lane.pts.sort((a, b) => a.t - b.t);
  return lane;
}

export function addAudioClip(t: Track, o: { assetId: string; start: number; len: number; name: string; gain?: number; offset?: number; fadeIn?: number; fadeOut?: number }): AudioClip {
  const c: AudioClip = {
    id: nextId('c'), kind: 'audio', start: toTicks(o.start), len: toTicks(o.len), name: o.name, assetId: o.assetId,
    offset: o.offset ?? 0, gain: o.gain ?? 0, fadeIn: toTicks(o.fadeIn ?? 0), fadeOut: toTicks(o.fadeOut ?? 0.02), pitch: 0, rate: 1,
  };
  t.clips.push(c);
  t.clips.sort((a, b) => a.start - b.start);
  return c;
}

export function describeTrack(t: Track, p: Project) {
  const midi = t.clips.filter((c): c is MidiClip => c.kind === 'midi');
  const nNotes = midi.reduce((a, c) => a + c.notes.length, 0);
  const end = Math.max(0, ...t.clips.map((c) => c.start + c.len));
  const m = new MeterMap(p.sig);
  return {
    id: t.id, name: t.name, kind: t.kind,
    instrument: t.instrument ? `${t.instrument.type}${t.instrument.preset ? ' / ' + t.instrument.preset : ''}` : undefined,
    volDb: t.vol, pan: t.pan, mute: t.mute, solo: t.solo, out: t.out,
    inserts: t.inserts.map((f) => `${f.id}:${f.type}${f.bypass ? ' (bypassed)' : ''}`),
    sends: t.sends.map((s) => `${s.to} ${s.level}dB`),
    clips: t.clips.length, notes: nNotes,
    endsAtBar: end ? m.position(end).bar : 0,
    automation: t.auto.map((a) => a.target),
  };
}

export { MeterMap, PPQ };
export type { CCLane };
