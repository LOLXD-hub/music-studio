import { Engine } from './engine.ts';
import type { AssetBuffer } from './engine.ts';
import type { Project } from './project.ts';

export interface RenderOptions {
  sampleRate?: number;
  startSec?: number;
  /** Defaults to the end of the last clip. */
  endSec?: number;
  /** Upper bound for the effect tail that is rendered after `endSec`. */
  tailMaxSec?: number;
  /** Render only these tracks (buses stay audible), for stems. */
  soloTracks?: string[];
  block?: number;
  onProgress?: (fraction: number) => void;
  /** Collect per-track RMS this often (seconds). Used by the demo recorder and the activity meters. */
  meterEverySec?: number;
}

export interface MeterFrame {
  t: number;
  master: number;
  tracks: Record<string, number>;
}

export interface RenderResult {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  durationSec: number;
  /** Seconds of tail rendered after the end marker. */
  tailSec: number;
  trace?: MeterFrame[];
  renderMs: number;
}

/** Deterministic offline render. Same engine code as real-time playback, no audio device involved. */
export function renderProject(project: Project, assets: Map<string, AssetBuffer>, opts: RenderOptions = {}): RenderResult {
  const t0 = Date.now();
  const sr = opts.sampleRate ?? 44100;
  const eng = new Engine(sr, project.seed);
  for (const [id, a] of assets) eng.setAsset(id, a);
  eng.setProject(structuredClone(project));
  eng.loop = null;
  const start = opts.startSec ?? 0;
  const end = opts.endSec ?? eng.projectSeconds();
  const block = Math.min(opts.block ?? 512, 4096);
  const tailMax = opts.tailMaxSec ?? 8;
  const tailTarget = Math.min(tailMax, eng.fxTailSeconds() + 0.5);
  if (opts.soloTracks) eng.setSoloOnly(opts.soloTracks);
  eng.seekSeconds(start);
  eng.play();
  const bodyFrames = Math.max(0, Math.round((end - start) * sr));
  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];
  const outL = new Float32Array(block);
  const outR = new Float32Array(block);
  let written = 0;
  let silent = 0;
  const maxFrames = bodyFrames + Math.round(tailMax * sr);
  const trace: MeterFrame[] = [];
  const every = opts.meterEverySec ?? 0;
  let nextMeter = 0;
  while (written < maxFrames) {
    const n = Math.min(block, maxFrames - written);
    eng.process(outL, outR, n);
    chunksL.push(outL.slice(0, n));
    chunksR.push(outR.slice(0, n));
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(outL[i]);
      const b = Math.abs(outR[i]);
      if (a > pk) pk = a;
      if (b > pk) pk = b;
    }
    written += n;
    if (every > 0 && written / sr >= nextMeter) {
      const m = eng.readMeters();
      const tr: Record<string, number> = {};
      for (const [id, r] of Object.entries(m.tracks)) tr[id] = Math.max(r.peakL, r.peakR);
      trace.push({ t: written / sr, master: Math.max(m.master.peakL, m.master.peakR), tracks: tr });
      nextMeter += every;
    }
    if (written >= bodyFrames) {
      silent = pk < 3e-5 ? silent + n : 0;
      if (written - bodyFrames >= tailTarget * sr && silent > 0.25 * sr) break;
      if (silent > 0.6 * sr) break;
    }
    if (opts.onProgress && (written & 0xffff) < block) opts.onProgress(Math.min(1, written / Math.max(1, bodyFrames)));
  }
  eng.stop();
  const total = Math.min(written, maxFrames);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  let o = 0;
  for (let i = 0; i < chunksL.length; i++) {
    L.set(chunksL[i], o);
    R.set(chunksR[i], o);
    o += chunksL[i].length;
  }
  // trim trailing digital silence but keep a short pad
  let last = total - 1;
  while (last > bodyFrames && Math.abs(L[last]) < 1e-5 && Math.abs(R[last]) < 1e-5) last--;
  const keep = Math.min(total, Math.max(bodyFrames, last + Math.round(0.05 * sr)));
  return {
    L: L.subarray(0, keep),
    R: R.subarray(0, keep),
    sampleRate: sr,
    durationSec: keep / sr,
    tailSec: Math.max(0, keep - bodyFrames) / sr,
    trace: every > 0 ? trace : undefined,
    renderMs: Date.now() - t0,
  };
}
