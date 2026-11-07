import type { FxDef, FxProcessor } from './base.ts';
import { eqDef } from './eq.ts';
import { compressorDef, limiterDef, gateDef } from './dynamics.ts';
import { reverbDef } from './reverb.ts';
import { delayDef, chorusDef, flangerDef, phaserDef, tremoloDef, lofiDef, filterDef } from './timefx.ts';
import { distortionDef, bitcrusherDef } from './drive.ts';
import { utilityDef, widenerDef } from './util.ts';

export type { FxDef, FxProcessor } from './base.ts';

export const FX_DEFS: FxDef[] = [
  eqDef, compressorDef, limiterDef, gateDef, reverbDef, delayDef, chorusDef, flangerDef, phaserDef,
  tremoloDef, filterDef, distortionDef, bitcrusherDef, lofiDef, utilityDef, widenerDef,
];

const byType = new Map(FX_DEFS.map((d) => [d.type, d]));

export function getFxDef(type: string): FxDef | undefined {
  return byType.get(type);
}

/** Create a processor and apply a parameter bag (names or option labels). Unknown params are ignored. */
export function createFx(type: string, sampleRate: number, params: Record<string, number | string> = {}): FxProcessor | null {
  const def = byType.get(type);
  if (!def) return null;
  const fx = def.create(sampleRate);
  for (const [k, v] of Object.entries(params)) fx.setParam(k, v as number);
  return fx;
}
