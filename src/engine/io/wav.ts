// WAV reader/writer. PCM 8/16/24/32 and IEEE float 32/64, mono or stereo or more.

export interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
  /** Loop points from a `smpl` chunk, in frames. */
  loop?: { start: number; end: number };
  /** MIDI root note from a `smpl` chunk. */
  rootNote?: number;
}

export function decodeWav(bytes: Uint8Array): DecodedAudio {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let pos = 12;
  let fmt = { format: 1, channels: 2, rate: 44100, bits: 16 };
  let dataStart = -1;
  let dataLen = 0;
  let loop: DecodedAudio['loop'];
  let rootNote: number | undefined;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    let size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(body + 24, true);
    } else if (id === 'data') {
      dataStart = body;
      if (size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      dataLen = size;
    } else if (id === 'smpl' && size >= 36) {
      rootNote = dv.getUint32(body + 12, true);
      const nLoops = dv.getUint32(body + 28, true);
      if (nLoops > 0 && size >= 36 + 24) {
        loop = { start: dv.getUint32(body + 36 + 8, true), end: dv.getUint32(body + 36 + 12, true) };
      }
    }
    pos = body + size + (size & 1);
  }
  if (dataStart < 0) throw new Error('WAV has no data chunk');
  const bytesPer = fmt.bits >> 3;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const channels: Float32Array[] = [];
  for (let c = 0; c < fmt.channels; c++) channels.push(new Float32Array(frames));
  let o = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      let v: number;
      if (fmt.format === 3) v = fmt.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
      else if (fmt.bits === 8) v = (bytes[o] - 128) / 128;
      else if (fmt.bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (fmt.bits === 24) {
        let x = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
        if (x & 0x800000) x |= ~0xffffff;
        v = x / 8388608;
      } else v = dv.getInt32(o, true) / 2147483648;
      channels[c][i] = v;
      o += bytesPer;
    }
  }
  return { channels, sampleRate: fmt.rate, loop, rootNote };
}

export type WavBits = 16 | 24 | 32;

/** Encode to WAV. 32 means 32-bit float. 16-bit output is dithered with TPDF noise unless `dither` is false. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: WavBits = 16, dither = true): Uint8Array {
  const nCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPer = bits >> 3;
  const dataLen = frames * nCh * bytesPer;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, bits === 32 ? 3 : 1, true);
  dv.setUint16(22, nCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nCh * bytesPer, true);
  dv.setUint16(32, nCh * bytesPer, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, dataLen, true);
  let o = 44;
  let seed = 22222;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = channels[c][i];
      if (bits === 32) {
        dv.setFloat32(o, x, true);
      } else if (bits === 24) {
        let v = Math.round(Math.max(-1, Math.min(1, x)) * 8388607);
        if (v < 0) v += 0x1000000;
        out[o] = v & 255;
        out[o + 1] = (v >> 8) & 255;
        out[o + 2] = (v >> 16) & 255;
      } else {
        const d = dither ? (rnd() - rnd()) / 32768 : 0;
        dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, x + d)) * 32767), true);
      }
      o += bytesPer;
    }
  }
  return out;
}
