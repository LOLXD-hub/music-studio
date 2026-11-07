// Bridge between the UI and the AudioWorklet engine.
import type { Project, Track } from '../../engine/project.ts';
import { meters, projectStore, transportStore, secToBeats, tempoMap } from './state.ts';
import { invoke } from './api.ts';

class AudioBridge {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  ready: Promise<void> | null = null;
  private sentAssets = new Set<string>();
  private posAt = 0;
  private posSec = 0;
  private playing = false;
  private raf = 0;
  sampleRate = 48000;
  private pending: { msg: Record<string, unknown>; transfer?: Transferable[] }[] = [];

  init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.sampleRate = this.ctx.sampleRate;
      await this.ctx.audioWorklet.addModule('msai://app/worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'msai-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.node.connect(this.ctx.destination);
      this.node.port.onmessage = (e) => this.onMessage(e.data);
      for (const p of this.pending) this.node.port.postMessage(p.msg, p.transfer ?? []);
      this.pending = [];
      this.setProject(projectStore.get().project);
      void this.syncAssets();
      const tick = () => {
        this.raf = requestAnimationFrame(tick);
        if (this.playing) {
          const sec = this.posSec + (performance.now() - this.posAt) / 1000;
          transportStore.set({ position: sec });
        }
      };
      tick();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    })();
    return this.ready;
  }

  private post(msg: Record<string, unknown>, transfer?: Transferable[]): void {
    if (this.node) this.node.port.postMessage(msg, transfer ?? []);
    else this.pending.push({ msg, transfer });
  }

  private onMessage(m: any): void {
    if (m.type === 'meters') {
      meters.tracks = m.tracks;
      meters.master = m.master;
      meters.gr = m.gr;
      meters.load = m.load;
      this.posSec = m.position;
      this.posAt = performance.now();
      if (m.playing !== this.playing) {
        this.playing = m.playing;
        transportStore.set({ playing: m.playing, position: m.position });
        this.report();
      } else if (!m.playing) transportStore.set({ position: m.position });
      meters.emit();
    } else if (m.type === 'error') console.error('engine:', m.message);
  }

  private report(): void {
    window.msai.send('transport-state', { playing: this.playing, position: this.posSec });
  }

  setProject(p: Project): void {
    this.post({ type: 'setProject', project: p });
    void this.syncAssets();
  }
  updateTrack(t: Track): void {
    this.post({ type: 'updateTrack', track: t });
    void this.syncAssets();
  }
  removeTrack(id: string): void {
    this.post({ type: 'removeTrack', id });
  }

  async syncAssets(): Promise<void> {
    const p = projectStore.get().project;
    const need = new Set<string>();
    for (const t of p.tracks) {
      for (const c of t.clips) if (c.kind === 'audio') need.add(c.assetId);
      const zs = (t.instrument as { zones?: { assetId: string }[] } | undefined)?.zones;
      if (zs) for (const z of zs) need.add(z.assetId);
    }
    for (const id of need) {
      if (this.sentAssets.has(id)) continue;
      this.sentAssets.add(id);
      const a = await invoke('asset', id);
      if (a) this.post({ type: 'asset', id, channels: a.channels, sampleRate: a.sampleRate });
      else this.sentAssets.delete(id);
    }
  }

  async play(fromBeats?: number): Promise<void> {
    await this.init();
    if (this.ctx!.state === 'suspended') await this.ctx!.resume();
    const p = projectStore.get().project;
    const from = fromBeats !== undefined ? tempoMap(p).tickToSec(fromBeats * 960) : undefined;
    this.post({ type: 'play', from });
  }
  pause(): void {
    this.post({ type: 'pause' });
  }
  stop(): void {
    this.post({ type: 'stop' });
    transportStore.set({ position: 0, playing: false });
  }
  seekBeats(beats: number): void {
    const p = projectStore.get().project;
    const sec = tempoMap(p).tickToSec(beats * 960);
    this.post({ type: 'seek', sec });
    transportStore.set({ position: sec });
  }
  note(track: string, pitch: number, vel = 100, dur = 0.5): void {
    void this.init().then(() => this.post({ type: 'note', track, pitch, vel, dur }));
  }
  noteOn(track: string, pitch: number, vel = 100): void {
    void this.init().then(() => this.post({ type: 'noteOn', track, pitch, vel }));
  }
  noteOff(track: string, pitch: number): void {
    this.post({ type: 'noteOff', track, pitch });
  }
  audition(L: Float32Array, R: Float32Array, sampleRate: number): void {
    void this.init().then(() => this.post({ type: 'audition', L, R, sampleRate }));
  }
  stopAudition(): void {
    this.post({ type: 'stopAudition' });
  }
}

export const audio = new AudioBridge();
export { secToBeats };
