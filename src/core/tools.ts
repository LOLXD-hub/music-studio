import { Studio } from './studio.ts';
import type { StudioOptions, ToolDef } from './studio.ts';
import { coreTools } from './tools-core.ts';
import { musicTools } from './tools-music.ts';
import { audioTools } from './tools-audio.ts';

export const ALL_TOOLS: ToolDef[] = [...coreTools, ...musicTools, ...audioTools];

/** A Studio with every tool registered. This is what the app, the MCP server and scripts use. */
export function createStudio(o: StudioOptions = {}): Studio {
  const s = new Studio(o);
  s.registerTools(ALL_TOOLS);
  return s;
}

export { Studio };
export type { ToolDef };
