import { PPQ, TempoMap } from './project.ts';
import type { AudioClip, AutoLane, FxSpec, InstrumentSpec, MidiClip, Project, Track } from './project.ts';
import { createFx } from './fx/index.ts';
import type { FxProcessor } from './fx/index.ts';
import { createInstrument, Sampler } from './instruments/index.ts';
import type { Instrument, Zone } from './instruments/index.ts';
import { Smoother, clamp, dbToGain } from './dsp/core.ts';
import { trimFor } from './instruments/calibration.ts';

export interface AssetBuffer {
  channels: Float32Array[];
  sampleRate: number;
}

const MAX_BLOCK = 8192;
const CONTROL_STEP = 128;

const EV_OFF = 0;
const EV_CC = 1;
const EV_ON = 2;

interface Ev {
  sample: number;
  type: number;
  a: number;
  b: number;
  art?: string;
}

interface Lane {
  target: string;
  ticks: Float64Array;
  vals: Float64Array;
  curves: Float64Array;
  last: number;
}

interface FxRt {
  id: string;
  type: string;
  proc: FxProcessor;
  bypass: boolean;
  sidechain?: string;
  applied: Record<string, number | string>;
}

interface AudioPlay {
  clip: AudioClip;
  startSample: number;
  endSample: number;
  asset: AssetBuffer | null;
}

interface TrackRt {
  id: string;
  spec: Track;
  inst: Instrument | null;
  instKey: string;
  instTrim: number;
  fx: FxRt[];
  bufL: Float32Array;
  bufR: Float32Array;
  events: Ev[];
  next: number;
  audio: AudioPlay[];
  vol: Smoother;
  balance: Smoother;
  sendGain: Smoother[];
  lanes: Lane[];
  muted: boolean;
  /** Effective values after automation. */
  volDb: number;
  pan: number;
  autoMute: boolean;
  sendDb: number[];
  peakL: number;
  peakR: number;
  rmsAcc: number;
  rmsN: number;
  scSource: string | null;
}

export interface MeterReading {
  peakL: number;
  peakR: number;
  rms: number;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function curveShape(t: number, c: number): number {
  if (!c) return t;
  return c > 0 ? Math.pow(t, 1 + c * 3) : 1 - Math.pow(1 - t, 1 - c * 3);
}

export class Engine {
  readonly sampleRate: number;
  private project: Project | null = null;
  private tempo = new TempoMap([{ t: 0, bpm: 120 }]);
  private tracks = new Map<string, TrackRt>();
  private order: TrackRt[] = [];
  private assets = new Map<string, AssetBuffer>();
  private masterFx: FxRt[] = [];
  private masterVol = new Smoother(1, 0.01, 44100);
  private masterLanes: Lane[] = [];
  private mL = new Float32Array(MAX_BLOCK);
  private mR = new Float32Array(MAX_BLOCK);
  private mPeakL = 0;
  private mPeakR = 0;
  private mRms = 0;
  private mRmsN = 0;
  private seed = 1;

  playing = false;
  /** Transport position in samples. */
  pos = 0;
  loop: { start: number; end: number } | null = null;
  private clock = 0;
  private pendingOffs: { at: number; track: string; pitch: number }[] = [];
  private auditions: { L: Float32Array; R: Float32Array; pos: number; rate: number; gain: number }[] = [];
  private evScratch: { off: number; t: TrackRt; ev: Ev }[] = [];
  private lastBpmSet = -1;
  /** When set, only these tracks are audible (offline stem rendering). Buses always stay on. */
  soloOnly: Set<string> | null = null;

  constructor(sampleRate: number, seed = 1) {
    this.sampleRate = sampleRate;
    this.seed = seed;
    this.masterVol = new Smoother(1, 0.01, sampleRate);
  }

  // ------------------------------------------------------------------ project sync

  setAsset(id: string, data: AssetBuffer): void {
    this.assets.set(id, data);
    if (this.project) for (const t of this.tracks.values()) this.rebuildAudio(t);
  }

  hasAsset(id: string): boolean {
    return this.assets.has(id);
  }

  removeAsset(id: string): void {
    this.assets.delete(id);
  }

  setProject(p: Project): void {
    this.project = p;
    this.seed = p.seed || 1;
    this.tempo = new TempoMap(p.tempo);
    const keep = new Set(p.tracks.map((t) => t.id));
    for (const id of [...this.tracks.keys()]) if (!keep.has(id)) this.disposeTrack(id);
    for (const t of p.tracks) this.syncTrack(t);
    this.syncMaster(p);
    this.recomputeOrder();
    this.recomputeMute();
    this.loop = p.loop ? { start: this.tickToSample(p.loop.start), end: this.tickToSample(p.loop.end) } : null;
    // tempo map affects every event time
    for (const t of this.tracks.values()) this.compileTrack(t);
  }

  /** Replace one track in place, keeping instrument and effect state when their settings are unchanged. */
  updateTrack(track: Track): void {
    if (!this.project) return;
    const i = this.project.tracks.findIndex((t) => t.id === track.id);
    if (i >= 0) this.project.tracks[i] = track;
    else this.project.tracks.push(track);
    this.syncTrack(track);
    this.recomputeOrder();
    this.recomputeMute();
  }

  removeTrack(id: string): void {
    if (this.project) this.project.tracks = this.project.tracks.filter((t) => t.id !== id);
    this.disposeTrack(id);
    this.recomputeOrder();
    this.recomputeMute();
  }

  updateMeta(p: Project): void {
    this.setProject(p);
  }

  private tickToSample(tick: number): number {
    return Math.round(this.tempo.tickToSec(tick) * this.sampleRate);
  }

  private disposeTrack(id: string): void {
    const t = this.tracks.get(id);
    if (t?.inst) t.inst.allNotesOff();
    this.tracks.delete(id);
  }

  private newTrackRt(spec: Track): TrackRt {
    return {
      id: spec.id, spec, inst: null, instKey: '', instTrim: 1, fx: [],
      bufL: new Float32Array(MAX_BLOCK), bufR: new Float32Array(MAX_BLOCK),
      events: [], next: 0, audio: [],
      vol: new Smoother(dbToGain(spec.vol), 0.012, this.sampleRate),
      balance: new Smoother(spec.pan, 0.012, this.sampleRate),
      sendGain: [], lanes: [], muted: false, volDb: spec.vol, pan: spec.pan, autoMute: false, sendDb: [],
      peakL: 0, peakR: 0, rmsAcc: 0, rmsN: 0, scSource: null,
    };
  }

  private syncTrack(spec: Track): void {
    let t = this.tracks.get(spec.id);
    if (!t) {
      t = this.newTrackRt(spec);
      this.tracks.set(spec.id, t);
      t.vol.jump(dbToGain(spec.vol));
      t.balance.jump(spec.pan);
    }
    t.spec = spec;
    t.volDb = spec.vol;
    t.pan = spec.pan;
    t.sendDb = spec.sends.map((s) => s.level);
    while (t.sendGain.length < spec.sends.length) t.sendGain.push(new Smoother(dbToGain(spec.sends[t.sendGain.length].level), 0.012, this.sampleRate));
    t.sendGain.length = spec.sends.length;
    this.syncInstrument(t, spec.instrument);
    this.syncFx(t.fx, spec.inserts, t);
    this.rebuildAudio(t);
    this.compileTrack(t);
  }

  private instKeyOf(spec?: InstrumentSpec): string {
    return spec ? JSON.stringify([spec.type, spec.preset ?? '', spec.params, (spec as { zones?: unknown }).zones ?? null]) : '';
  }

  private syncInstrument(t: TrackRt, spec?: InstrumentSpec): void {
    const key = this.instKeyOf(spec);
    if (key === t.instKey && (t.inst || !spec)) return;
    if (t.inst) t.inst.allNotesOff();
    t.instKey = key;
    t.inst = null;
    t.instTrim = 1;
    if (!spec) return;
    const inst = createInstrument(spec.type, this.sampleRate, (hashStr(t.id) ^ this.seed) >>> 0, spec.preset, spec.params ?? {});
    if (!inst) return;
    if (inst instanceof Sampler) this.loadZones(inst, spec);
    t.inst = inst;
    t.instTrim = trimFor(spec.type, spec.preset);
  }

  private loadZones(inst: Sampler, spec: InstrumentSpec): void {
    const zs = (spec as { zones?: { assetId: string; root: number; lo?: number; hi?: number; velLo?: number; velHi?: number; tune?: number; gain?: number; pan?: number; loopStart?: number; loopEnd?: number; attack?: number; release?: number; cutoff?: number }[] }).zones ?? [];
    const zones: Zone[] = [];
    for (const z of zs) {
      const data = this.assets.get(z.assetId);
      if (!data) continue;
      zones.push({
        data, root: z.root, lo: z.lo ?? 0, hi: z.hi ?? 127, velLo: z.velLo ?? 0, velHi: z.velHi ?? 127,
        tune: z.tune ?? 0, gain: z.gain ?? 0, pan: z.pan ?? 0, loopStart: z.loopStart, loopEnd: z.loopEnd,
        attack: z.attack, release: z.release, cutoff: z.cutoff,
      });
    }
    inst.setZones(zones);
  }

  private syncFx(list: FxRt[], specs: FxSpec[], t: TrackRt | null): void {
    const old = new Map(list.map((f) => [f.id, f]));
    const next: FxRt[] = [];
    for (const s of specs) {
      let rt = old.get(s.id);
      if (!rt || rt.type !== s.type) {
        const proc = createFx(s.type, this.sampleRate, s.params);
        if (!proc) continue;
        rt = { id: s.id, type: s.type, proc, bypass: !!s.bypass, sidechain: s.sidechain, applied: { ...s.params } };
      } else {
        for (const [k, v] of Object.entries(s.params)) {
          if (rt.applied[k] !== v) {
            rt.proc.setParam(k, v as number);
            rt.applied[k] = v;
          }
        }
      }
      rt.bypass = !!s.bypass;
      rt.sidechain = s.sidechain;
      next.push(rt);
    }
    list.length = 0;
    list.push(...next);
    void t;
  }

  private syncMaster(p: Project): void {
    this.syncFx(this.masterFx, p.master.inserts, null);
    this.masterVol.set(dbToGain(p.master.vol));
    this.masterLanes = this.compileLanes(p.master.auto);
  }

  private rebuildAudio(t: TrackRt): void {
    t.audio = [];
    for (const c of t.spec.clips) {
      if (c.kind !== 'audio' || c.muted) continue;
      const startSample = this.tickToSample(c.start);
      const endSample = this.tickToSample(c.start + c.len);
      t.audio.push({ clip: c, startSample, endSample, asset: this.assets.get(c.assetId) ?? null });
    }
  }

  private compileLanes(lanes: AutoLane[]): Lane[] {
    const out: Lane[] = [];
    for (const l of lanes) {
      if (!l.pts.length) continue;
      const pts = [...l.pts].sort((a, b) => a.t - b.t);
      out.push({
        target: l.target,
        ticks: Float64Array.from(pts.map((p) => p.t)),
        vals: Float64Array.from(pts.map((p) => p.v)),
        curves: Float64Array.from(pts.map((p) => p.c ?? 0)),
        last: NaN,
      });
    }
    return out;
  }

  private compileTrack(t: TrackRt): void {
    const sr = this.sampleRate;
    const evs: Ev[] = [];
    for (const c of t.spec.clips) {
      if (c.kind !== 'midi' || c.muted) continue;
      const clip = c as MidiClip;
      for (const n of clip.notes) {
        const on = clip.start + n.t;
        const off = on + Math.max(1, n.d);
        const sOn = Math.round(this.tempo.tickToSec(on) * sr);
        let sOff = Math.round(this.tempo.tickToSec(off) * sr);
        if (sOff <= sOn) sOff = sOn + 1;
        evs.push({ sample: sOn, type: EV_ON, a: n.p, b: n.v, art: n.art });
        evs.push({ sample: sOff, type: EV_OFF, a: n.p, b: 0 });
      }
      for (const lane of clip.cc) {
        const pts = [...lane.pts].sort((a, b) => a.t - b.t);
        const stepped = lane.cc === 64;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const tick = clip.start + p.t;
          evs.push({ sample: Math.round(this.tempo.tickToSec(tick) * sr), type: EV_CC, a: lane.cc, b: p.v });
          const q = pts[i + 1];
          if (!stepped && q && q.t - p.t > 24 && q.v !== p.v) {
            // interpolate smooth controllers so crescendos do not step
            for (let tt = p.t + 24; tt < q.t; tt += 24) {
              const v = p.v + ((q.v - p.v) * (tt - p.t)) / (q.t - p.t);
              evs.push({ sample: Math.round(this.tempo.tickToSec(clip.start + tt) * sr), type: EV_CC, a: lane.cc, b: v });
            }
          }
        }
      }
    }
    evs.sort((x, y) => x.sample - y.sample || x.type - y.type);
    t.events = evs;
    t.next = this.firstEventAt(evs, this.pos);
    t.lanes = this.compileLanes(t.spec.auto);
    t.scSource = null;
  }

  private firstEventAt(evs: Ev[], sample: number): number {
    let lo = 0;
    let hi = evs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (evs[mid].sample < sample) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private recomputeOrder(): void {
    const list = [...this.tracks.values()];
    const byId = new Map(list.map((t) => [t.id, t]));
    const deps = new Map<string, Set<string>>();
    for (const t of list) deps.set(t.id, new Set());
    for (const t of list) {
      const outs = [t.spec.out, ...t.spec.sends.map((s) => s.to)];
      for (const o of outs) if (o !== 'master' && byId.has(o) && o !== t.id) deps.get(o)!.add(t.id);
      for (const f of t.spec.inserts) if (f.sidechain && byId.has(f.sidechain) && f.sidechain !== t.id) deps.get(t.id)!.add(f.sidechain);
    }
    const out: TrackRt[] = [];
    const state = new Map<string, number>();
    const visit = (id: string): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) return; // cycle: ignore the back edge
      state.set(id, 1);
      for (const d of deps.get(id) ?? []) visit(d);
      state.set(id, 2);
      out.push(byId.get(id)!);
    };
    for (const t of list) visit(t.id);
    this.order = out;
  }

  private recomputeMute(): void {
    const anySolo = this.order.some((t) => t.spec.solo && t.spec.kind !== 'bus');
    for (const t of this.order) {
      let m = t.spec.mute;
      if (anySolo && t.spec.kind !== 'bus' && !t.spec.solo) m = true;
      if (this.soloOnly && t.spec.kind !== 'bus' && !this.soloOnly.has(t.id)) m = true;
      t.muted = m;
    }
  }

  setSoloOnly(ids: string[] | null): void {
    this.soloOnly = ids ? new Set(ids) : null;
    this.recomputeMute();
  }

  // ------------------------------------------------------------------ transport

  play(): void {
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.releaseAll();
  }

  pause(): void {
    this.playing = false;
    this.releaseAll();
  }

  releaseAll(): void {
    for (const t of this.tracks.values()) {
      if (t.inst) {
        t.inst.cc(64, 0);
        t.inst.allNotesOff();
      }
    }
  }

  seekSamples(sample: number): void {
    this.pos = Math.max(0, Math.round(sample));
    this.releaseAll();
    for (const t of this.tracks.values()) {
      t.next = this.firstEventAt(t.events, this.pos);
      t.inst?.cc(11, 127);
    }
  }

  seekSeconds(sec: number): void {
    this.seekSamples(sec * this.sampleRate);
  }

  seekTicks(tick: number): void {
    this.seekSamples(this.tickToSample(tick));
  }

  get positionSeconds(): number {
    return this.pos / this.sampleRate;
  }

  get positionTicks(): number {
    return this.tempo.secToTick(this.positionSeconds);
  }

  setLoop(startTick: number | null, endTick?: number): void {
    this.loop = startTick === null ? null : { start: this.tickToSample(startTick), end: this.tickToSample(endTick ?? startTick) };
  }

  // ------------------------------------------------------------------ live input

  noteOn(trackId: string, pitch: number, vel = 100): void {
    this.tracks.get(trackId)?.inst?.noteOn(pitch, vel);
  }

  noteOff(trackId: string, pitch: number): void {
    this.tracks.get(trackId)?.inst?.noteOff(pitch);
  }

  /** Play a note immediately and release it after `durSec`. */
  auditionNote(trackId: string, pitch: number, vel = 100, durSec = 0.6): void {
    const t = this.tracks.get(trackId);
    if (!t?.inst) return;
    t.inst.noteOn(pitch, vel);
    this.pendingOffs.push({ at: this.clock + Math.round(durSec * this.sampleRate), track: trackId, pitch });
  }

  /** Play an audio buffer straight to the output (sound-effect preview). */
  auditionBuffer(L: Float32Array, R: Float32Array, sampleRate: number, gain = 1): void {
    this.auditions.push({ L, R, pos: 0, rate: sampleRate / this.sampleRate, gain });
  }

  stopAudition(): void {
    this.auditions = [];
  }

  // ------------------------------------------------------------------ processing

  /** Real-time entry point. Fills outL/outR for [0, n). */
  process(outL: Float32Array, outR: Float32Array, n: number): void {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    let done = 0;
    while (done < n) {
      let chunk = n - done;
      if (this.playing && this.loop && this.loop.end > this.loop.start) {
        const toEnd = this.loop.end - this.pos;
        if (toEnd <= 0) {
          this.seekSamples(this.loop.start);
          continue;
        }
        chunk = Math.min(chunk, toEnd);
      }
      this.renderRange(outL, outR, done, done + chunk);
      if (this.playing) this.pos += chunk;
      this.clock += chunk;
      done += chunk;
      if (this.playing && this.loop && this.pos >= this.loop.end) this.seekSamples(this.loop.start);
    }
  }

  private rangeA = 0;

  private renderRange(outL: Float32Array, outR: Float32Array, a: number, b: number): void {
    this.rangeA = a;
    // pending note-offs from auditions
    if (this.pendingOffs.length) {
      const keep: typeof this.pendingOffs = [];
      for (const p of this.pendingOffs) {
        if (p.at < this.clock + (b - a)) this.tracks.get(p.track)?.inst?.noteOff(p.pitch);
        else keep.push(p);
      }
      this.pendingOffs = keep;
    }
    const bpm = this.tempo.bpmAt(this.tempo.secToTick(this.pos / this.sampleRate));
    if (bpm !== this.lastBpmSet) {
      this.lastBpmSet = bpm;
      for (const t of this.tracks.values()) {
        t.inst?.setTempo?.(bpm);
        for (const f of t.fx) f.proc.setTempo?.(bpm);
      }
      for (const f of this.masterFx) f.proc.setTempo?.(bpm);
    }
    const list = this.evScratch;
    list.length = 0;
    if (this.playing) {
      const len = b - a;
      for (const t of this.tracks.values()) {
        while (t.next < t.events.length && t.events[t.next].sample < this.pos + len) {
          const ev = t.events[t.next++];
          list.push({ off: Math.max(a, ev.sample - this.pos + a), t, ev });
        }
      }
      list.sort((x, y) => x.off - y.off || x.ev.type - y.ev.type);
    }
    let cursor = a;
    for (const item of list) {
      if (item.off > cursor) {
        this.mix(outL, outR, cursor, item.off);
        cursor = item.off;
      }
      const inst = item.t.inst;
      if (inst && !item.t.muted) {
        const ev = item.ev;
        if (ev.type === EV_ON) inst.noteOn(ev.a, ev.b, ev.art);
        else if (ev.type === EV_OFF) inst.noteOff(ev.a);
        else if (ev.a === 128) inst.pitchBend(ev.b);
        else inst.cc(ev.a, ev.b);
      } else if (inst && item.ev.type !== EV_ON) {
        // keep note-offs and pedal state consistent even when muted
        if (item.ev.type === EV_OFF) inst.noteOff(item.ev.a);
        else if (item.ev.a !== 128) inst.cc(item.ev.a, item.ev.b);
      }
    }
    if (cursor < b) this.mix(outL, outR, cursor, b);
  }

  private evalLane(l: Lane, tick: number): number {
    const n = l.ticks.length;
    if (tick <= l.ticks[0]) return l.vals[0];
    if (tick >= l.ticks[n - 1]) return l.vals[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (l.ticks[mid] <= tick) lo = mid;
      else hi = mid;
    }
    const f = (tick - l.ticks[lo]) / (l.ticks[hi] - l.ticks[lo]);
    return l.vals[lo] + (l.vals[hi] - l.vals[lo]) * curveShape(f, l.curves[lo]);
  }

  private applyAutomation(sampleMid: number): void {
    const tick = this.tempo.secToTick(sampleMid / this.sampleRate);
    for (const t of this.order) {
      if (!t.lanes.length) continue;
      for (const l of t.lanes) {
        const v = this.evalLane(l, tick);
        if (v === l.last) continue;
        l.last = v;
        this.applyTarget(t, l.target, v);
      }
    }
    for (const l of this.masterLanes) {
      const v = this.evalLane(l, tick);
      if (v === l.last) continue;
      l.last = v;
      if (l.target === 'vol') this.masterVol.set(dbToGain(v));
      else if (l.target.startsWith('fx:')) {
        const [, id, param] = l.target.split(':');
        this.masterFx.find((f) => f.id === id)?.proc.setParam(param, v);
      }
    }
  }

  private applyTarget(t: TrackRt, target: string, v: number): void {
    if (target === 'vol') t.volDb = v;
    else if (target === 'pan') t.pan = v;
    else if (target === 'mute') t.autoMute = v > 0.5;
    else if (target.startsWith('send:')) t.sendDb[parseInt(target.slice(5), 10)] = v;
    else if (target.startsWith('inst:')) t.inst?.setParam(target.slice(5), v);
    else if (target.startsWith('fx:')) {
      const [, id, param] = target.split(':');
      t.fx.find((f) => f.id === id)?.proc.setParam(param, v);
    }
  }

  /** Mix [a, b) into the output, in steps so automation stays smooth. */
  private mix(outL: Float32Array, outR: Float32Array, a: number, b: number): void {
    for (let s = a; s < b; s += CONTROL_STEP) {
      const e = Math.min(b, s + CONTROL_STEP);
      this.mixStep(outL, outR, s, e);
    }
  }

  private mixStep(outL: Float32Array, outR: Float32Array, s: number, e: number): void {
    const sr = this.sampleRate;
    const mL = this.mL;
    const mR = this.mR;
    mL.fill(0, s, e);
    mR.fill(0, s, e);
    this.applyAutomation(this.pos + (s - this.rangeA) + (e - s) / 2);
    for (const t of this.order) {
      t.bufL.fill(0, s, e);
      t.bufR.fill(0, s, e);
    }
    const byId = this.tracks;
    for (const t of this.order) {
      const L = t.bufL;
      const R = t.bufR;
      if (t.inst) {
        if (t.instTrim !== 1 && t.instTrim > 0) {
          // render into the buffer, then trim: instruments add into the buffer, which is empty here
          t.inst.process(L, R, s, e);
          const g = t.instTrim;
          for (let i = s; i < e; i++) {
            L[i] *= g;
            R[i] *= g;
          }
        } else t.inst.process(L, R, s, e);
      }
      if (t.audio.length && this.playing) this.mixAudio(t, s, e);
      for (const f of t.fx) {
        if (f.bypass) continue;
        if (f.proc.setSidechain) {
          const src = f.sidechain ? byId.get(f.sidechain) : undefined;
          if (src) f.proc.setSidechain(src.bufL, src.bufR);
          else f.proc.setSidechain(null, null);
        }
        f.proc.process(L, R, s, e);
      }
      // fader and balance
      const muted = t.muted || t.autoMute;
      t.vol.set(muted ? 0 : dbToGain(t.volDb));
      t.balance.set(t.pan);
      let pk = 0;
      let pkR = 0;
      let rms = 0;
      for (let i = s; i < e; i++) {
        const g = t.vol.next();
        const bal = t.balance.next();
        const gl = g * (bal > 0 ? 1 - bal : 1);
        const gr = g * (bal < 0 ? 1 + bal : 1);
        const l = L[i] * gl;
        const r = R[i] * gr;
        L[i] = l;
        R[i] = r;
        const al = l < 0 ? -l : l;
        const ar = r < 0 ? -r : r;
        if (al > pk) pk = al;
        if (ar > pkR) pkR = ar;
        rms += l * l + r * r;
      }
      if (pk > t.peakL) t.peakL = pk;
      if (pkR > t.peakR) t.peakR = pkR;
      t.rmsAcc += rms;
      t.rmsN += (e - s) * 2;
      // routing
      for (let k = 0; k < t.spec.sends.length; k++) {
        const bus = byId.get(t.spec.sends[k].to);
        if (!bus || bus === t) continue;
        t.sendGain[k].set(dbToGain(t.sendDb[k] ?? -120));
        const sg = t.sendGain[k];
        for (let i = s; i < e; i++) {
          const g = sg.next();
          bus.bufL[i] += L[i] * g;
          bus.bufR[i] += R[i] * g;
        }
      }
      const dest = t.spec.out === 'master' ? null : byId.get(t.spec.out);
      if (dest && dest !== t) {
        for (let i = s; i < e; i++) {
          dest.bufL[i] += L[i];
          dest.bufR[i] += R[i];
        }
      } else {
        for (let i = s; i < e; i++) {
          mL[i] += L[i];
          mR[i] += R[i];
        }
      }
    }
    // auditions go straight to the master bus
    if (this.auditions.length) this.mixAuditions(mL, mR, s, e);
    for (const f of this.masterFx) if (!f.bypass) f.proc.process(mL, mR, s, e);
    let pl = 0;
    let pr = 0;
    let rms = 0;
    for (let i = s; i < e; i++) {
      const g = this.masterVol.next();
      let l = mL[i] * g;
      let r = mR[i] * g;
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      outL[i] += l;
      outR[i] += r;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      rms += l * l + r * r;
    }
    if (pl > this.mPeakL) this.mPeakL = pl;
    if (pr > this.mPeakR) this.mPeakR = pr;
    this.mRms += rms;
    this.mRmsN += (e - s) * 2;
    void sr;
  }

  private mixAudio(t: TrackRt, s: number, e: number): void {
    const sr = this.sampleRate;
    const L = t.bufL;
    const R = t.bufR;
    // `pos` stays at the start of the current range while it renders, so transport time of index s is pos + (s - rangeA)
    const base = this.pos + (s - this.rangeA);
    for (const p of t.audio) {
      if (!p.asset) p.asset = this.assets.get(p.clip.assetId) ?? null;
      if (!p.asset) continue;
      const from = Math.max(base, p.startSample);
      const to = Math.min(base + (e - s), p.endSample);
      if (to <= from) continue;
      const c = p.clip;
      const asset = p.asset;
      const a0 = asset.channels[0];
      const a1 = asset.channels.length > 1 ? asset.channels[1] : a0;
      const ratio = Math.pow(2, c.pitch / 12) * c.rate * (asset.sampleRate / sr);
      const gain = dbToGain(c.gain);
      const fadeIn = Math.max(0, this.tickToSample(c.start + c.fadeIn) - p.startSample);
      const fadeOut = Math.max(0, p.endSample - this.tickToSample(c.start + c.len - c.fadeOut));
      const len = asset.channels[0].length;
      const offFrames = c.offset * asset.sampleRate;
      for (let sp = from; sp < to; sp++) {
        const rel = sp - p.startSample;
        let src = offFrames + rel * ratio;
        if (c.reverse) src = len - 1 - src;
        if (src < 0 || src >= len - 1) continue;
        const i0 = Math.floor(src);
        const f = src - i0;
        let g = gain;
        if (fadeIn > 0 && rel < fadeIn) g *= rel / fadeIn;
        const fromEnd = p.endSample - sp;
        if (fadeOut > 0 && fromEnd < fadeOut) g *= fromEnd / fadeOut;
        const o = s + (sp - base);
        L[o] += (a0[i0] + (a0[i0 + 1] - a0[i0]) * f) * g;
        R[o] += (a1[i0] + (a1[i0 + 1] - a1[i0]) * f) * g;
      }
    }
  }

  private mixAuditions(mL: Float32Array, mR: Float32Array, s: number, e: number): void {
    for (const a of this.auditions) {
      for (let i = s; i < e; i++) {
        const i0 = Math.floor(a.pos);
        if (i0 >= a.L.length - 1) break;
        const f = a.pos - i0;
        mL[i] += (a.L[i0] + (a.L[i0 + 1] - a.L[i0]) * f) * a.gain;
        mR[i] += (a.R[i0] + (a.R[i0 + 1] - a.R[i0]) * f) * a.gain;
        a.pos += a.rate;
      }
    }
    this.auditions = this.auditions.filter((a) => a.pos < a.L.length - 1);
  }

  // ------------------------------------------------------------------ metering

  readMeters(): { tracks: Record<string, MeterReading>; master: MeterReading; gr: Record<string, number>; position: number } {
    const tracks: Record<string, MeterReading> = {};
    const gr: Record<string, number> = {};
    for (const t of this.tracks.values()) {
      tracks[t.id] = { peakL: t.peakL, peakR: t.peakR, rms: t.rmsN ? Math.sqrt(t.rmsAcc / t.rmsN) : 0 };
      t.peakL = t.peakR = 0;
      t.rmsAcc = 0;
      t.rmsN = 0;
      for (const f of t.fx) {
        const m = f.proc.meter?.();
        if (m !== undefined) gr[f.id] = m;
      }
    }
    for (const f of this.masterFx) {
      const m = f.proc.meter?.();
      if (m !== undefined) gr[f.id] = m;
    }
    const master = { peakL: this.mPeakL, peakR: this.mPeakR, rms: this.mRmsN ? Math.sqrt(this.mRms / this.mRmsN) : 0 };
    this.mPeakL = this.mPeakR = 0;
    this.mRms = 0;
    this.mRmsN = 0;
    return { tracks, master, gr, position: this.pos / this.sampleRate };
  }

  /** Tail length in seconds the project's effects can still ring after the last note. */
  fxTailSeconds(): number {
    let tail = 0;
    const scan = (list: FxRt[]) => {
      for (const f of list) tail = Math.max(tail, f.proc.tail());
    };
    for (const t of this.tracks.values()) scan(t.fx);
    scan(this.masterFx);
    return tail;
  }

  /** Total length of the arrangement in seconds (end of the last clip). */
  projectSeconds(): number {
    if (!this.project) return 0;
    let end = 0;
    for (const t of this.project.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.len);
    return this.tempo.tickToSec(end);
  }

  tickToSeconds(tick: number): number {
    return this.tempo.tickToSec(tick);
  }
}

export { PPQ, clamp };
