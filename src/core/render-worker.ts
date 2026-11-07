// Runs in a worker thread so rendering never blocks the app or the MCP server.
import { parentPort } from 'node:worker_threads';
import { renderProject } from '../engine/render.ts';
import type { RenderOptions } from '../engine/render.ts';
import { analyzeAudio, renderPicture } from '../engine/analysis/index.ts';
import type { AssetBuffer } from '../engine/engine.ts';
import type { Project } from '../engine/project.ts';

interface Job {
  id: number;
  project: Project;
  assets: Record<string, AssetBuffer>;
  opts: RenderOptions;
  analyze?: { projectBpm?: number };
  picture?: { width?: number; barTimes?: number[]; firstBar?: number };
}

parentPort!.on('message', (m: Job) => {
  try {
    const assets = new Map(Object.entries(m.assets));
    const res = renderProject(m.project, assets, {
      ...m.opts,
      onProgress: (f) => parentPort!.postMessage({ id: m.id, progress: f }),
    });
    const out: Record<string, unknown> = {
      id: m.id, done: true, L: res.L, R: res.R, sampleRate: res.sampleRate, durationSec: res.durationSec, tailSec: res.tailSec, renderMs: res.renderMs, trace: res.trace, trackStats: res.trackStats,
    };
    if (m.analyze) out.report = analyzeAudio(res.L, res.R, res.sampleRate, m.analyze);
    if (m.picture) {
      const pic = renderPicture(res.L, res.R, res.sampleRate, m.picture);
      out.picture = { width: pic.image.width, height: pic.image.height, rgba: pic.image.rgba, layout: pic.layout };
    }
    const transfer: ArrayBuffer[] = [res.L.buffer as ArrayBuffer, res.R.buffer as ArrayBuffer];
    parentPort!.postMessage(out, transfer);
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error).stack ?? String(e) });
  }
});
