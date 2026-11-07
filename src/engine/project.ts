// Project data model. Plain JSON, so it can be saved to disk, sent to the UI, or shipped to a worker.
// Time is in ticks (960 per quarter note) everywhere inside the model.

export const PPQ = 960;

export interface NoteEvent {
  id: string;
  /** Start, ticks relative to the clip start. Fractional ticks are allowed (humanize). */
  t: number;
  /** Duration in ticks. */
  d: number;
  /** MIDI pitch 0..127. */
  p: number;
  /** Velocity 1..127. */
  v: number;
  /** Articulation hint for instruments that understand it: 'stac', 'pizz', 'trem', 'leg', 'mute', 'sul', 'ghost', 'accent', ... */
  art?: string;
}

export interface CCPoint {
  t: number;
  v: number;
}

/** cc 0..127 is a MIDI controller; cc 128 is pitch bend (value -1..1 mapped to 0..127 in the editor, stored as -1..1 here). */
export interface CCLane {
  cc: number;
  pts: CCPoint[];
}

export interface MidiClip {
  id: string;
  kind: 'midi';
  start: number;
  len: number;
  name: string;
  color?: string;
  notes: NoteEvent[];
  cc: CCLane[];
  muted?: boolean;
}

export interface AudioClip {
  id: string;
  kind: 'audio';
  start: number;
  len: number;
  name: string;
  color?: string;
  assetId: string;
  /** Start offset into the asset, seconds. */
  offset: number;
  /** Clip gain, dB. */
  gain: number;
  /** Fades in ticks. */
  fadeIn: number;
  fadeOut: number;
  /** Playback pitch shift in semitones (varispeed: changes duration too unless `rate` compensates). */
  pitch: number;
  /** Extra playback rate multiplier. */
  rate: number;
  reverse?: boolean;
  muted?: boolean;
}

export type Clip = MidiClip | AudioClip;

export interface FxSpec {
  id: string;
  type: string;
  name?: string;
  params: Record<string, number | string>;
  bypass?: boolean;
  /** Track id whose signal keys this effect (compressors, gates). */
  sidechain?: string;
}

export interface InstrumentSpec {
  type: string;
  preset?: string;
  params: Record<string, number | string>;
}

export interface AutoPoint {
  t: number;
  v: number;
  /** Curve of the segment leaving this point, -1..1 (0 = linear). */
  c?: number;
}

/**
 * Automation targets:
 *  'vol' (dB), 'pan' (-1..1), 'mute' (0/1), 'send:<n>' (dB),
 *  'inst:<param>', 'fx:<fxId>:<param>'
 */
export interface AutoLane {
  id: string;
  target: string;
  pts: AutoPoint[];
}

export interface Send {
  to: string;
  /** dB */
  level: number;
  pre?: boolean;
}

export type TrackKind = 'instrument' | 'audio' | 'bus';

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  instrument?: InstrumentSpec;
  inserts: FxSpec[];
  sends: Send[];
  /** dB */
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** 'master' or a bus track id. */
  out: string;
  clips: Clip[];
  auto: AutoLane[];
  /** Free text the agent or the user left on this track. */
  note?: string;
}

export interface Marker {
  id: string;
  t: number;
  name: string;
}

export interface TempoPoint {
  t: number;
  bpm: number;
}

export interface SigPoint {
  t: number;
  num: number;
  den: number;
}

export interface AssetRef {
  id: string;
  name: string;
  sampleRate: number;
  channels: number;
  frames: number;
  /** Original file path, when the asset came from disk. */
  path?: string;
  source?: 'import' | 'sfx' | 'bounce' | 'sample';
}

export interface Brief {
  title?: string;
  genre?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  form?: string[];
  references?: string;
  notes?: string;
  /** Free-form checklist the agent maintains while it works. */
  steps?: { text: string; done: boolean }[];
}

export interface MasterBus {
  inserts: FxSpec[];
  vol: number;
  auto: AutoLane[];
}

export interface Project {
  v: 1;
  id: string;
  name: string;
  tempo: TempoPoint[];
  sig: SigPoint[];
  key?: { root: number; mode: string };
  tracks: Track[];
  master: MasterBus;
  markers: Marker[];
  assets: AssetRef[];
  seed: number;
  loop?: { start: number; end: number } | null;
  brief?: Brief;
  meta: { created: string; modified: string };
}

export function newProject(name = 'Untitled'): Project {
  const now = new Date().toISOString();
  return {
    v: 1,
    id: 'p' + Math.random().toString(36).slice(2, 10),
    name,
    tempo: [{ t: 0, bpm: 120 }],
    sig: [{ t: 0, num: 4, den: 4 }],
    tracks: [],
    master: { inserts: [], vol: 0, auto: [] },
    markers: [],
    assets: [],
    seed: 1,
    loop: null,
    meta: { created: now, modified: now },
  };
}

/** Track palette, picked by index so a new track gets a distinct hue. */
export const TRACK_COLORS = [
  '#c28b5a', '#5f97be', '#6fae82', '#a77cb8', '#c4a755', '#58a8a2', '#bb6d86', '#837bbd',
  '#97ad58', '#c5885a', '#6d86bf', '#c27474',
];

let idCounter = 0;
export function uid(prefix = 'x'): string {
  idCounter = (idCounter + 1) % 1679616;
  return prefix + Date.now().toString(36).slice(-4) + idCounter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 5);
}

/** Tempo and meter helpers. All conversions go through ticks. */
export class TempoMap {
  private pts: { t: number; bpm: number; sec: number }[] = [];
  constructor(tempo: TempoPoint[]) {
    const sorted = [...tempo].sort((a, b) => a.t - b.t);
    if (!sorted.length || sorted[0].t > 0) sorted.unshift({ t: 0, bpm: sorted[0]?.bpm ?? 120 });
    let sec = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) sec += ((sorted[i].t - sorted[i - 1].t) / PPQ) * (60 / sorted[i - 1].bpm);
      this.pts.push({ t: sorted[i].t, bpm: sorted[i].bpm, sec });
    }
  }
  tickToSec(tick: number): number {
    let i = this.pts.length - 1;
    while (i > 0 && this.pts[i].t > tick) i--;
    const p = this.pts[i];
    return p.sec + ((tick - p.t) / PPQ) * (60 / p.bpm);
  }
  secToTick(sec: number): number {
    let i = this.pts.length - 1;
    while (i > 0 && this.pts[i].sec > sec) i--;
    const p = this.pts[i];
    return p.t + ((sec - p.sec) * p.bpm * PPQ) / 60;
  }
  bpmAt(tick: number): number {
    let i = this.pts.length - 1;
    while (i > 0 && this.pts[i].t > tick) i--;
    return this.pts[i].bpm;
  }
}

export class MeterMap {
  private pts: { t: number; num: number; den: number; bar: number }[] = [];
  constructor(sig: SigPoint[]) {
    const sorted = [...sig].sort((a, b) => a.t - b.t);
    if (!sorted.length || sorted[0].t > 0) sorted.unshift({ t: 0, num: 4, den: 4 });
    let bar = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = sorted[i - 1];
        const barTicks = (prev.num * 4 * PPQ) / prev.den;
        bar += Math.round((sorted[i].t - prev.t) / barTicks);
      }
      this.pts.push({ ...sorted[i], bar });
    }
  }
  private at(tick: number) {
    let i = this.pts.length - 1;
    while (i > 0 && this.pts[i].t > tick) i--;
    return this.pts[i];
  }
  barTicksAt(tick: number): number {
    const p = this.at(tick);
    return (p.num * 4 * PPQ) / p.den;
  }
  /** 1-based bar and beat (fractional) for a tick. */
  position(tick: number): { bar: number; beat: number } {
    const p = this.at(tick);
    const barTicks = (p.num * 4 * PPQ) / p.den;
    const rel = tick - p.t;
    const bars = Math.floor(rel / barTicks);
    const within = rel - bars * barTicks;
    return { bar: p.bar + bars + 1, beat: within / ((4 * PPQ) / p.den) + 1 };
  }
  /** Tick of a 1-based bar and beat. */
  tickOf(bar: number, beat = 1): number {
    let i = this.pts.length - 1;
    while (i > 0 && this.pts[i].bar + 1 > bar) i--;
    const p = this.pts[i];
    const barTicks = (p.num * 4 * PPQ) / p.den;
    return p.t + (bar - 1 - p.bar) * barTicks + (beat - 1) * ((4 * PPQ) / p.den);
  }
}

export function projectEndTick(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.len);
  return end;
}
