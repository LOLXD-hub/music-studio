import type { InstDef, Instrument } from './base.ts';
import { pianoDef, malletDef } from './modal.ts';
import { pluckedDef } from './pluck.ts';
import { windStringDef } from './sourcefilter.ts';
import { organDef } from './organ.ts';
import { fmDef } from './fm.ts';
import { subSynthDef } from './subsynth.ts';
import { drumsDef } from './drums.ts';
import { samplerDef } from './sampler.ts';

export type { Instrument, InstDef, InstrumentCategory } from './base.ts';
export { Sampler } from './sampler.ts';
export type { Zone, SampleData } from './sampler.ts';
export { makeHit, GM_DRUMS, Hit } from './drums.ts';

export const INSTRUMENT_DEFS: InstDef[] = [
  pianoDef, organDef, fmDef, malletDef, pluckedDef, windStringDef, subSynthDef, drumsDef, samplerDef,
];

const byType = new Map(INSTRUMENT_DEFS.map((d) => [d.type, d]));

export function getInstrumentDef(type: string): InstDef | undefined {
  return byType.get(type);
}

/** Create an instrument and apply a preset and/or parameter overrides. */
export function createInstrument(
  type: string,
  sampleRate: number,
  seed: number,
  preset?: string,
  params: Record<string, number | string> = {},
): Instrument | null {
  const def = byType.get(type);
  if (!def) return null;
  const inst = def.create(sampleRate, seed);
  if (preset) {
    const pr = findPreset(def, preset);
    if (pr) for (const [k, v] of Object.entries(pr)) inst.setParam(k, v);
  }
  for (const [k, v] of Object.entries(params)) inst.setParam(k, v);
  return inst;
}

export function findPreset(def: InstDef, name: string): Record<string, number | string> | undefined {
  if (def.presets[name]) return def.presets[name];
  const low = name.toLowerCase();
  const key = Object.keys(def.presets).find((k) => k.toLowerCase() === low) ?? Object.keys(def.presets).find((k) => k.toLowerCase().includes(low));
  return key ? def.presets[key] : undefined;
}
