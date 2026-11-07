// Renders every Clawd animation frame to a PNG sheet so the art can be inspected, and writes the logo and icons.
import fs from 'node:fs';
import path from 'node:path';
import { frame, logo, toRgba, STATE_FRAMES, W, H } from '../src/app/shared/clawd.ts';
import type { ClawdState } from '../src/app/shared/clawd.ts';
import { encodePng } from '../src/core/png.ts';

const out = path.resolve(process.argv[2] ?? 'tmp');
fs.mkdirSync(out, { recursive: true });
const states = Object.keys(STATE_FRAMES) as ClawdState[];
const scale = 5;
const cols = 8;
const sheetW = cols * W * scale;
const sheetH = states.length * H * scale;
const rgba = new Uint8Array(sheetW * sheetH * 4);
for (let i = 0; i < sheetW * sheetH; i++) { rgba[i * 4] = 25; rgba[i * 4 + 1] = 25; rgba[i * 4 + 2] = 25; rgba[i * 4 + 3] = 255; }
states.forEach((st, row) => {
  for (let n = 0; n < Math.min(cols, STATE_FRAMES[st].frames); n++) {
    const f = toRgba(frame(st, n), scale);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      const s = (y * f.width + x) * 4;
      if (!f.rgba[s + 3]) continue;
      const d = ((row * H * scale + y) * sheetW + n * W * scale + x) * 4;
      rgba[d] = f.rgba[s]; rgba[d + 1] = f.rgba[s + 1]; rgba[d + 2] = f.rgba[s + 2]; rgba[d + 3] = 255;
    }
  }
});
fs.writeFileSync(path.join(out, 'clawd-sheet.png'), encodePng({ width: sheetW, height: sheetH, rgba }));
const lg = toRgba(logo(), 12, [25, 25, 25, 255]);
fs.writeFileSync(path.join(out, 'clawd-logo.png'), encodePng(lg));
console.log('wrote', out);
