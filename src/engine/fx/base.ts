import type { ParamDesc } from '../dsp/core.ts';
import { resolveParam } from '../dsp/core.ts';

export interface FxProcessor {
  /** Process stereo audio in place for samples [start, end). */
  process(L: Float32Array, R: Float32Array, start: number, end: number): void;
  setParam(id: string, v: number): void;
  reset(): void;
  /** Seconds of audio the effect keeps producing after the input stops. */
  tail(): number;
  setTempo?(bpm: number): void;
  setSidechain?(L: Float32Array | null, R: Float32Array | null): void;
  /** Meter value for UI (gain reduction in dB, for dynamics). */
  meter?(): number;
}

export interface FxDef {
  type: string;
  name: string;
  category: 'dynamics' | 'eq' | 'space' | 'time' | 'modulation' | 'distortion' | 'utility' | 'filter';
  description: string;
  params: ParamDesc[];
  presets?: Record<string, Record<string, number | string>>;
  create(sampleRate: number): FxProcessor;
}

export function defaults(params: ParamDesc[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const p of params) o[p.id] = p.def;
  return o;
}

/** Base class: keeps parameter values and calls update() after every change. */
export abstract class FxBase implements FxProcessor {
  p: Record<string, number>;
  protected desc: Map<string, ParamDesc>;
  protected sr: number;
  constructor(sr: number, params: ParamDesc[]) {
    this.sr = sr;
    this.p = defaults(params);
    this.desc = new Map(params.map((d) => [d.id, d]));
  }
  setParam(id: string, v: number | string): void {
    const d = this.desc.get(id);
    if (!d) return;
    this.p[id] = resolveParam(d, v);
    this.update(id);
  }
  /** Called after the constructor sets defaults; subclasses call it themselves. */
  protected update(_id?: string): void {}
  abstract process(L: Float32Array, R: Float32Array, start: number, end: number): void;
  reset(): void {}
  tail(): number {
    return 0;
  }
}
