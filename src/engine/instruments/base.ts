import { resolveParam } from '../dsp/core.ts';
import type { ParamDesc } from '../dsp/core.ts';

export interface Instrument {
  readonly type: string;
  setParam(id: string, v: number | string): void;
  /** vel 1..127. art: optional articulation hint. */
  noteOn(pitch: number, vel: number, art?: string): void;
  noteOff(pitch: number): void;
  cc(num: number, value: number): void;
  /** -1..1, mapped to the instrument's bend range. */
  pitchBend(v: number): void;
  allNotesOff(): void;
  /** Adds into L/R for samples [start, end). */
  process(L: Float32Array, R: Float32Array, start: number, end: number): void;
  activeVoices(): number;
  reset(): void;
  /** Called once per audio chunk with the tempo, for tempo-synced instruments. */
  setTempo?(bpm: number): void;
}

export type InstrumentCategory = 'keys' | 'strings' | 'plucked' | 'winds' | 'brass' | 'synth' | 'drums' | 'percussion' | 'pads' | 'sampler' | 'voice';

export interface InstDef {
  type: string;
  name: string;
  category: InstrumentCategory;
  description: string;
  /** Typical playable MIDI range, helps the composer keep parts idiomatic. */
  range: [number, number];
  /** 'poly' or 'mono' character; mono instruments play one line at a time. */
  polyphony: 'poly' | 'mono';
  params: ParamDesc[];
  presets: Record<string, Record<string, number | string>>;
  /** Articulations the instrument responds to. */
  articulations?: string[];
  create(sampleRate: number, seed: number): Instrument;
}

export abstract class VoiceBase {
  active = false;
  pitch = 0;
  vel = 0;
  /** Key is still held. */
  held = false;
  /** Key released but the sustain pedal keeps the note. */
  sustained = false;
  /** Samples since note-on. */
  age = 0;
  order = 0;
}

/**
 * Shared note/controller handling for polyphonic instruments: voice allocation and stealing,
 * sustain pedal, expression and modulation controllers.
 */
export abstract class InstrumentBase<V extends VoiceBase> implements Instrument {
  abstract readonly type: string;
  protected voices: V[] = [];
  protected p: Record<string, number> = {};
  protected desc = new Map<string, ParamDesc>();
  protected pedal = false;
  protected expression = 1;
  protected modWheel = 0;
  protected volume = 1;
  protected bend = 0;
  protected counter = 0;
  protected bpm = 120;

  protected sr: number;
  constructor(sr: number, params: ParamDesc[]) {
    this.sr = sr;
    for (const d of params) {
      this.desc.set(d.id, d);
      this.p[d.id] = d.def;
    }
  }

  protected abstract startVoice(v: V, pitch: number, vel: number, art?: string): void;
  protected abstract releaseVoice(v: V): void;
  protected abstract renderVoice(v: V, L: Float32Array, R: Float32Array, s: number, e: number): void;
  protected onParam(_id: string): void {}

  protected addVoices(n: number, make: () => V): void {
    for (let i = 0; i < n; i++) this.voices.push(make());
  }

  setParam(id: string, value: number | string): void {
    const d = this.desc.get(id);
    if (!d) return;
    this.p[id] = resolveParam(d, value);
    this.onParam(id);
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
  }

  /** Pick a free voice, or steal: prefer releasing voices, then the oldest. */
  protected allocate(): V {
    let best: V | null = null;
    let bestScore = -1;
    for (const v of this.voices) {
      if (!v.active) return v;
      // higher score = better candidate to steal
      let score = v.age;
      if (!v.held && !v.sustained) score += 1e9;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best as V;
  }

  noteOn(pitch: number, vel: number, art?: string): void {
    const v = this.allocate();
    v.active = true;
    v.pitch = pitch;
    v.vel = vel;
    v.held = true;
    v.sustained = false;
    v.age = 0;
    v.order = ++this.counter;
    this.startVoice(v, pitch, vel, art);
  }

  noteOff(pitch: number): void {
    for (const v of this.voices) {
      if (v.active && v.held && v.pitch === pitch) {
        v.held = false;
        if (this.pedal) v.sustained = true;
        else this.releaseVoice(v);
      }
    }
  }

  cc(num: number, value: number): void {
    switch (num) {
      case 64: {
        const down = value >= 64;
        if (this.pedal && !down) {
          for (const v of this.voices) {
            if (v.active && v.sustained) {
              v.sustained = false;
              this.releaseVoice(v);
            }
          }
        }
        this.pedal = down;
        break;
      }
      case 11:
        this.expression = value / 127;
        break;
      case 7:
        this.volume = value / 127;
        break;
      case 1:
        this.modWheel = value / 127;
        break;
      case 123:
      case 120:
        this.allNotesOff();
        break;
    }
  }

  pitchBend(v: number): void {
    this.bend = v;
  }

  allNotesOff(): void {
    for (const v of this.voices) {
      if (v.active) {
        v.held = false;
        v.sustained = false;
        this.releaseVoice(v);
      }
    }
  }

  process(L: Float32Array, R: Float32Array, s: number, e: number): void {
    for (const v of this.voices) {
      if (v.active) this.renderVoice(v, L, R, s, e);
    }
  }

  activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  reset(): void {
    for (const v of this.voices) {
      v.active = false;
      v.held = false;
      v.sustained = false;
    }
    this.pedal = false;
  }
}
