// AudioWorklet: runs the same engine that renders exports, so what you hear is what you export.
import { Engine } from '../../engine/engine.ts';
import type { Project, Track } from '../../engine/project.ts';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

type Msg =
  | { type: 'setProject'; project: Project }
  | { type: 'updateTrack'; track: Track }
  | { type: 'removeTrack'; id: string }
  | { type: 'asset'; id: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'play'; from?: number }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; sec: number }
  | { type: 'note'; track: string; pitch: number; vel: number; dur: number }
  | { type: 'noteOn'; track: string; pitch: number; vel: number }
  | { type: 'noteOff'; track: string; pitch: number }
  | { type: 'audition'; L: Float32Array; R: Float32Array; sampleRate: number }
  | { type: 'stopAudition' };

class MsaiProcessor extends AudioWorkletProcessor {
  private engine = new Engine(sampleRate, 1);
  private blocks = 0;
  private busy = 0;
  private wall = 0;
  private lastPos = -1;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Msg>) => this.onMessage(e.data);
  }

  private onMessage(m: Msg): void {
    const e = this.engine;
    switch (m.type) {
      case 'setProject': e.setProject(m.project); break;
      case 'updateTrack': e.updateTrack(m.track); break;
      case 'removeTrack': e.removeTrack(m.id); break;
      case 'asset': e.setAsset(m.id, { channels: m.channels, sampleRate: m.sampleRate }); break;
      case 'play': if (m.from !== undefined) e.seekSeconds(m.from); e.play(); break;
      case 'pause': e.pause(); break;
      case 'stop': e.stop(); e.seekSeconds(0); break;
      case 'seek': e.seekSeconds(m.sec); break;
      case 'note': e.auditionNote(m.track, m.pitch, m.vel, m.dur); break;
      case 'noteOn': e.noteOn(m.track, m.pitch, m.vel); break;
      case 'noteOff': e.noteOff(m.track, m.pitch); break;
      case 'audition': e.auditionBuffer(m.L, m.R, m.sampleRate, 0.9); break;
      case 'stopAudition': e.stopAudition(); break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const t0 = Date.now();
    try {
      this.engine.process(L, R, L.length);
    } catch (err) {
      L.fill(0);
      R.fill(0);
      this.port.postMessage({ type: 'error', message: String((err as Error).stack ?? err) });
    }
    this.busy += Date.now() - t0;
    this.blocks++;
    if (this.blocks % 8 === 0) {
      const now = Date.now();
      const load = this.wall ? Math.min(1, this.busy / Math.max(1, now - this.wall)) : 0;
      this.wall = now;
      this.busy = 0;
      const m = this.engine.readMeters();
      this.port.postMessage({ type: 'meters', ...m, playing: this.engine.playing, load });
      this.lastPos = m.position;
    }
    return true;
  }
}

registerProcessor('msai-engine', MsaiProcessor as unknown as new () => AudioWorkletProcessor);
void currentTime;
