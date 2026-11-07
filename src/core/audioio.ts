// Decoding and encoding of audio files. WAV, MP3, FLAC are handled natively; other formats go through FFmpeg
// when it is installed (decode/encode only, FFmpeg never generates audio here).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { decodeWav, encodeWav } from '../engine/io/wav.ts';
import type { DecodedAudio, WavBits } from '../engine/io/wav.ts';

const require = createRequire(import.meta.url);

let ffmpegPath: string | null | undefined;

export function findFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const r = spawnSync(c, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      if (r.status === 0) return (ffmpegPath = c);
    } catch { /* not found */ }
  }
  if (process.platform === 'win32') {
    const base = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(base)) {
        if (!/ffmpeg/i.test(d)) continue;
        const stack = [path.join(base, d)];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            const p = path.join(cur, e.name);
            if (e.isDirectory()) stack.push(p);
            else if (e.name.toLowerCase() === 'ffmpeg.exe') return (ffmpegPath = p);
          }
        }
      }
    } catch { /* ignore */ }
  }
  return (ffmpegPath = null);
}

function ffmpegDecode(file: string): Promise<DecodedAudio> {
  const ff = findFfmpeg();
  if (!ff) return Promise.reject(new Error(`Cannot decode ${path.extname(file)} without FFmpeg. Install FFmpeg, or convert the file to WAV, MP3 or FLAC.`));
  return new Promise((resolve, reject) => {
    const p = spawn(ff, ['-v', 'error', '-i', file, '-f', 'wav', '-acodec', 'pcm_f32le', '-'], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => (err += c.toString()));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('FFmpeg could not decode the file: ' + err.slice(0, 300)));
      try {
        resolve(decodeWav(new Uint8Array(Buffer.concat(chunks))));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function decodeAudioBytes(bytes: Uint8Array, ext: string, file = ''): Promise<DecodedAudio> {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'wav' || e === 'wave') return decodeWav(bytes);
  if (e === 'mp3') {
    const { MPEGDecoder } = await import('mpg123-decoder');
    const dec = new MPEGDecoder();
    await dec.ready;
    const r = dec.decode(bytes);
    dec.free();
    if (!r.samplesDecoded) throw new Error('The MP3 file contains no decodable audio.');
    return { channels: r.channelData.length === 1 ? [r.channelData[0]] : r.channelData.slice(0, 2), sampleRate: r.sampleRate };
  }
  if (e === 'flac') {
    const { FLACDecoder } = await import('@wasm-audio-decoders/flac');
    const dec = new FLACDecoder();
    await dec.ready;
    const r = await dec.decodeFile(bytes);
    dec.free();
    if (!r.samplesDecoded) throw new Error('The FLAC file contains no decodable audio.');
    return { channels: r.channelData.slice(0, 2), sampleRate: r.sampleRate };
  }
  if (!file) throw new Error(`Unsupported format .${e}`);
  return ffmpegDecode(file);
}

export async function decodeAudioFile(file: string): Promise<DecodedAudio> {
  const ext = path.extname(file);
  const bytes = new Uint8Array(fs.readFileSync(file));
  try {
    return await decodeAudioBytes(bytes, ext, file);
  } catch (err) {
    // a mislabelled file: try FFmpeg once before giving up
    if (findFfmpeg() && !/ffmpeg/i.test((err as Error).message)) return ffmpegDecode(file);
    throw err;
  }
}

// ------------------------------------------------------------------ FLAC encoder

class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private n = 0;
  write(value: number, bits: number): void {
    // value is a non-negative integer < 2^bits (bits <= 48)
    while (bits > 0) {
      const take = Math.min(8 - this.n, bits);
      const shift = bits - take;
      const part = Math.floor(value / Math.pow(2, shift)) % (1 << take);
      this.cur = (this.cur << take) | part;
      this.n += take;
      bits -= take;
      if (this.n === 8) {
        this.bytes.push(this.cur & 255);
        this.cur = 0;
        this.n = 0;
      }
    }
  }
  writeSigned(v: number, bits: number): void {
    this.write(v < 0 ? v + Math.pow(2, bits) : v, bits);
  }
  unary(q: number): void {
    while (q >= 24) {
      this.write(0, 24);
      q -= 24;
    }
    this.write(1, q + 1);
  }
  align(): void {
    if (this.n) this.write(0, 8 - this.n);
  }
  get length(): number {
    return this.bytes.length;
  }
  toBytes(): number[] {
    return this.bytes;
  }
}

function crc8(b: number[]): number {
  let c = 0;
  for (const x of b) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
  }
  return c;
}

const CRC16 = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

function crc16(b: number[]): number {
  let c = 0;
  for (const x of b) c = ((c << 8) & 0xffff) ^ CRC16[((c >> 8) ^ x) & 255];
  return c;
}

function utf8Number(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
  if (n < 0x200000) return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
  return [0xf8 | (n >> 24), 0x80 | ((n >> 18) & 63), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
}

function residual(x: Int32Array, order: number): Float64Array {
  const n = x.length;
  const r = new Float64Array(n - order);
  for (let i = order; i < n; i++) {
    let p = 0;
    if (order === 1) p = x[i - 1];
    else if (order === 2) p = 2 * x[i - 1] - x[i - 2];
    else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
    else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    r[i - order] = x[i] - p;
  }
  return r;
}

const zig = (v: number): number => (v >= 0 ? 2 * v : -2 * v - 1);

function writeSubframe(bw: BitWriter, x: Int32Array, bps: number): void {
  const n = x.length;
  let constant = true;
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) {
    bw.write(0, 8);
    bw.writeSigned(x[0], bps);
    return;
  }
  let best = 0;
  let bestSum = Infinity;
  for (let o = 0; o <= 4 && o < n; o++) {
    const r = residual(x, o);
    let s = 0;
    for (let i = 0; i < r.length; i++) s += Math.abs(r[i]);
    if (s < bestSum) { bestSum = s; best = o; }
  }
  const order = best;
  const res = residual(x, order);
  // choose partition order and Rice parameters
  let bestBits = Infinity;
  let bestPlan: { po: number; ks: number[] } | null = null;
  for (let po = 0; po <= 6; po++) {
    const parts = 1 << po;
    if (n % parts !== 0 || (n >> po) <= order) continue;
    const ks: number[] = [];
    let bits = 0;
    let start = 0;
    for (let p = 0; p < parts; p++) {
      const len = (n >> po) - (p === 0 ? order : 0);
      let sum = 0;
      for (let i = start; i < start + len; i++) sum += zig(res[i]);
      let bk = 0;
      let bb = Infinity;
      for (let k = 0; k < 15; k++) {
        const b = len * (k + 1) + Math.floor(sum / Math.pow(2, k));
        if (b < bb) { bb = b; bk = k; }
      }
      ks.push(bk);
      bits += bb + 4;
      start += len;
    }
    if (bits < bestBits) { bestBits = bits; bestPlan = { po, ks }; }
  }
  if (!bestPlan || bestBits > n * bps) {
    // verbatim
    bw.write(1 << 1, 8);
    for (let i = 0; i < n; i++) bw.writeSigned(x[i], bps);
    return;
  }
  bw.write((8 + order) << 1, 8);
  for (let i = 0; i < order; i++) bw.writeSigned(x[i], bps);
  bw.write(0, 2);
  bw.write(bestPlan.po, 4);
  let start = 0;
  const parts = 1 << bestPlan.po;
  for (let p = 0; p < parts; p++) {
    const k = bestPlan.ks[p];
    bw.write(k, 4);
    const len = (n >> bestPlan.po) - (p === 0 ? order : 0);
    for (let i = start; i < start + len; i++) {
      const u = zig(res[i]);
      const q = Math.floor(u / Math.pow(2, k));
      bw.unary(q);
      if (k) bw.write(u - q * Math.pow(2, k), k);
    }
    start += len;
  }
}

/** Lossless FLAC encoder (fixed predictors, Rice coding). 16 or 24 bit. */
export function encodeFlac(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 16): Uint8Array {
  const nCh = channels.length;
  const total = channels[0].length;
  const scale = bits === 16 ? 32767 : 8388607;
  const ints = channels.map((c) => {
    const a = new Int32Array(total);
    for (let i = 0; i < total; i++) a[i] = Math.max(-scale - 1, Math.min(scale, Math.round(c[i] * scale)));
    return a;
  });
  const block = 4096;
  const frames: number[][] = [];
  let minF = Infinity, maxF = 0;
  const md5 = createHash('md5');
  const bytesPer = bits / 8;
  const pcm = Buffer.alloc(total * nCh * bytesPer);
  let o = 0;
  for (let i = 0; i < total; i++) for (let c = 0; c < nCh; c++) {
    const v = ints[c][i];
    pcm[o++] = v & 255;
    pcm[o++] = (v >> 8) & 255;
    if (bytesPer === 3) pcm[o++] = (v >> 16) & 255;
  }
  md5.update(pcm);
  for (let start = 0, fn = 0; start < total || (total === 0 && fn === 0); start += block, fn++) {
    const n = Math.min(block, total - start);
    const head: number[] = [0xff, 0xf8];
    const last = n < block;
    head.push(((last ? 0b0111 : 0b1100) << 4) | 0);
    head.push(((nCh - 1) << 4) | 0);
    head.push(...utf8Number(fn));
    if (last) head.push(((n - 1) >> 8) & 255, (n - 1) & 255);
    head.push(crc8(head));
    const bw = new BitWriter();
    for (let c = 0; c < nCh; c++) writeSubframe(bw, ints[c].subarray(start, start + n), bits);
    bw.align();
    const frame = [...head, ...bw.toBytes()];
    const crc = crc16(frame);
    frame.push(crc >> 8, crc & 255);
    frames.push(frame);
    minF = Math.min(minF, frame.length);
    maxF = Math.max(maxF, frame.length);
    if (total === 0) break;
  }
  const si = Buffer.alloc(34);
  si.writeUInt16BE(block, 0);
  si.writeUInt16BE(block, 2);
  si.writeUIntBE(minF === Infinity ? 0 : minF, 4, 3);
  si.writeUIntBE(maxF, 7, 3);
  // sample rate (20 bits) | channels-1 (3) | bps-1 (5) | total samples (36)
  const packed = BigInt(sampleRate) << 44n | BigInt(nCh - 1) << 41n | BigInt(bits - 1) << 36n | BigInt(total);
  si.writeBigUInt64BE(packed, 10);
  md5.digest().copy(si, 18);
  const out = Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), si, ...frames.map((f) => Buffer.from(f))]);
  return new Uint8Array(out);
}

// ------------------------------------------------------------------ MP3 / generic encode

type LameLib = { Mp3Encoder: new (ch: number, sr: number, kbps: number) => { encodeBuffer(l: Int16Array, r?: Int16Array): Int8Array; flush(): Int8Array } };
let lameLib: LameLib | null = null;

/** lamejs only works when its single-file bundle is evaluated as a unit (its split build relies on globals). */
function loadLame(): LameLib {
  if (lameLib) return lameLib;
  const candidates: string[] = [];
  if (process.env.MSAI_LAME) candidates.push(process.env.MSAI_LAME);
  try { candidates.push(require.resolve('lamejs/lame.all.js')); } catch { /* bundled build */ }
  try { candidates.push(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'lame.all.js')); } catch { /* ignore */ }
  candidates.push(path.join(process.cwd(), 'node_modules', 'lamejs', 'lame.all.js'));
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      lameLib = new Function(fs.readFileSync(c, 'utf8') + '\n;return lamejs;')() as LameLib;
      return lameLib;
    }
  }
  throw new Error('The MP3 encoder (lamejs) was not found. Reinstall the app, or export FLAC/WAV.');
}

function encodeMp3(L: Float32Array, R: Float32Array, sampleRate: number, kbps: number): Uint8Array {
  const lame = loadLame();
  const enc = new lame.Mp3Encoder(2, sampleRate, kbps);
  const toI16 = (x: Float32Array) => {
    const a = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
    return a;
  };
  const l = toI16(L);
  const r = toI16(R);
  const parts: Buffer[] = [];
  for (let i = 0; i < l.length; i += 1152 * 8) {
    const b = enc.encodeBuffer(l.subarray(i, i + 1152 * 8), r.subarray(i, i + 1152 * 8));
    if (b.length) parts.push(Buffer.from(b));
  }
  const f = enc.flush();
  if (f.length) parts.push(Buffer.from(f));
  return new Uint8Array(Buffer.concat(parts));
}

export type ExportFormat = 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a' | 'opus';

export interface EncodeOptions {
  format: ExportFormat;
  /** wav: 16, 24 or 32 (float). flac: 16 or 24. */
  bitDepth?: number;
  /** mp3/ogg/m4a bitrate in kbps. */
  kbps?: number;
}

function ffmpegEncode(L: Float32Array, R: Float32Array, sr: number, fmt: ExportFormat, kbps: number): Promise<Uint8Array> {
  const ff = findFfmpeg();
  if (!ff) return Promise.reject(new Error(`Exporting ${fmt} needs FFmpeg for encoding. Export WAV, FLAC or MP3 instead, or install FFmpeg.`));
  const codec = fmt === 'ogg' ? ['-c:a', 'libvorbis', '-b:a', `${kbps}k`, '-f', 'ogg'] : fmt === 'opus' ? ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-f', 'ogg'] : ['-c:a', 'aac', '-b:a', `${kbps}k`, '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4'];
  return new Promise((resolve, reject) => {
    const p = spawn(ff, ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', ...codec, 'pipe:1'], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => (err += c.toString()));
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error('FFmpeg could not encode: ' + err.slice(0, 300)))));
    p.stdin.on('error', () => undefined);
    p.stdin.end(Buffer.from(encodeWav([L, R], sr, 16)));
  });
}

export async function encodeAudio(L: Float32Array, R: Float32Array, sampleRate: number, o: EncodeOptions): Promise<Uint8Array> {
  switch (o.format) {
    case 'wav': return encodeWav([L, R], sampleRate, ([16, 24, 32].includes(o.bitDepth ?? 16) ? (o.bitDepth ?? 16) : 16) as WavBits);
    case 'flac': return encodeFlac([L, R], sampleRate, o.bitDepth === 24 ? 24 : 16);
    case 'mp3': return encodeMp3(L, R, sampleRate, o.kbps ?? 256);
    default: return ffmpegEncode(L, R, sampleRate, o.format, o.kbps ?? 192);
  }
}

export function extFor(f: ExportFormat): string {
  return f === 'm4a' ? 'm4a' : f === 'opus' ? 'opus' : f;
}
