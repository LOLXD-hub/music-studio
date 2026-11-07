import zlib from 'node:zlib';
import type { ImageData8 } from '../engine/analysis/index.ts';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGBA to PNG (RGB when fully opaque to keep the file small). */
export function encodePng(img: ImageData8): Buffer {
  const { width: w, height: h, rgba } = img;
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (w * ch + 1) + 1 + x * ch;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (ch === 4) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Minimal PNG decoder (8-bit, non-interlaced, color types 0/2/3/4/6). Used for sprite and icon tooling. */
export function decodePng(buf: Uint8Array): ImageData8 {
  const b = Buffer.from(buf);
  let p = 8;
  let w = 0, h = 0, ct = 0, bd = 8;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('Only 8-bit PNG is supported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const chn = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  const stride = w * chn;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= chn ? out[y * stride + x - chn] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= chn && y > 0 ? out[(y - 1) * stride + x - chn] : 0;
      let r: number;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1);
      else { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      out[y * stride + x] = r & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r: number, g: number, bl: number, a = 255;
    if (ct === 6) { r = out[i * 4]; g = out[i * 4 + 1]; bl = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else if (ct === 2) { r = out[i * 3]; g = out[i * 3 + 1]; bl = out[i * 3 + 2]; }
    else if (ct === 3) { const k = out[i]; r = plte![k * 3]; g = plte![k * 3 + 1]; bl = plte![k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
    else if (ct === 0) { r = g = bl = out[i]; }
    else { r = g = bl = out[i * 2]; a = out[i * 2 + 1]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = bl; rgba[i * 4 + 3] = a;
  }
  return { width: w, height: h, rgba };
}
