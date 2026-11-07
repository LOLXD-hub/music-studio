import { z } from 'zod';
import type { ActionDef, Ctx, ToolDef } from './studio.ts';
import { parseLen, parsePos } from './format.ts';
import type { Pos } from './format.ts';
import { findTrack } from './ops.ts';
import type { Track } from '../engine/project.ts';

export { z };
export type { ActionDef, Ctx, ToolDef };

export const PosS = z.union([z.number(), z.string()]).describe('Position: beats from the start (number, 0-based) or "bar:beat" such as "5:1" (bar 5, beat 1; bars and beats are 1-based).');
export const LenS = z.union([z.number(), z.string()]).describe('Length: beats (number) or text such as "2 bars", "1/4".');
export const TrackS = z.string().describe('Track id (t1, t2 ...) or track name.');
export const PitchS = z.union([z.number(), z.string()]).describe('MIDI number (60) or note name (C4, F#3, Bb5). Middle C is C4 = 60.');

export function action(def: ActionDef): ActionDef {
  return def;
}

export function pos(ctx: Ctx, v: Pos | undefined, fallback = 0): number {
  return parsePos(v, ctx.studio.project.sig, fallback);
}

export function len(ctx: Ctx, v: Pos | undefined, at = 0, fallback = 4): number {
  return parseLen(v, ctx.studio.project.sig, at, fallback);
}

export function track(ctx: Ctx, ref: string | undefined): Track {
  return findTrack(ctx.studio.project, ref);
}

export const round = (x: number, d = 2): number => +x.toFixed(d);

/** MCP result images are PNG base64. */
export function image(png: Uint8Array | Buffer, caption: string): { mime: string; base64: string; caption: string } {
  return { mime: 'image/png', base64: Buffer.from(png).toString('base64'), caption };
}

/** Compose the input schema an MCP client sees: `action` plus the union of every action's fields (all optional). */
export function mcpInputShape(def: ToolDef): z.ZodRawShape {
  const names = Object.keys(def.actions) as [string, ...string[]];
  const shape: Record<string, z.ZodTypeAny> = { action: z.enum(names).describe(`What to do. One of: ${names.join(', ')}.`) };
  for (const a of Object.values(def.actions)) {
    for (const [k, v] of Object.entries(a.schema.shape)) {
      if (!shape[k]) shape[k] = (v as z.ZodTypeAny).optional();
    }
  }
  return shape as z.ZodRawShape;
}

function fieldName(k: string, v: z.ZodTypeAny): string {
  let opt = false;
  try {
    opt = v.isOptional();
  } catch { /* ignore */ }
  return opt ? k : k + '*';
}

/** Human-readable action list used in tool descriptions: "add: Add notes. Fields: track*, notes, text". */
export function describeActions(def: ToolDef): string {
  return Object.entries(def.actions)
    .map(([name, a]) => `- ${name}: ${a.description} Fields: ${Object.entries(a.schema.shape).map(([k, v]) => fieldName(k, v as z.ZodTypeAny)).join(', ') || '(none)'}.`)
    .join('\n');
}
