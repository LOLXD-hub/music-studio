// Writes the logo, the app icon and one GIF per Clawd state from the pixel data in src/app/shared/clawd.ts.
// FFmpeg only packs the frames into GIF and ICO files here.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { frame, logo, toRgba, STATE_FRAMES } from '../src/app/shared/clawd.ts';
import type { ClawdState } from '../src/app/shared/clawd.ts';
import { encodePng } from '../src/core/png.ts';
import { findFfmpeg } from '../src/core/audioio.ts';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const media = path.join(root, 'docs', 'media');
const work = path.join(root, 'tmp', 'clawd');
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(media, { recursive: true });
const ff = findFfmpeg();

// logo: transparent, and a 256 px icon with the logo centred on a dark tile
const lg = toRgba(logo(), 10);
fs.writeFileSync(path.join(assets, 'logo.png'), encodePng(lg));
const S = 256;
const icon = new Uint8Array(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const r = 44; // rounded tile
  const dx = Math.max(0, Math.max(r - x, x - (S - 1 - r))), dy = Math.max(0, Math.max(r - y, y - (S - 1 - r)));
  if (dx * dx + dy * dy <= r * r) { const o = (y * S + x) * 4; icon[o] = 38; icon[o + 1] = 45; icon[o + 2] = 51; icon[o + 3] = 255; }
}
const ox = Math.floor((S - lg.width) / 2), oy = Math.floor((S - lg.height) / 2);
for (let y = 0; y < lg.height; y++) for (let x = 0; x < lg.width; x++) {
  const s = (y * lg.width + x) * 4;
  if (!lg.rgba[s + 3]) continue;
  const d = ((oy + y) * S + ox + x) * 4;
  icon[d] = lg.rgba[s]; icon[d + 1] = lg.rgba[s + 1]; icon[d + 2] = lg.rgba[s + 2]; icon[d + 3] = 255;
}
fs.writeFileSync(path.join(assets, 'icon.png'), encodePng({ width: S, height: S, rgba: icon }));
console.log(`logo ${lg.width}x${lg.height}, icon ${S}x${S}`);
if (ff) spawnSync(ff, ['-y', '-v', 'error', '-i', path.join(assets, 'icon.png'), path.join(assets, 'icon.ico')], { windowsHide: true });

// one GIF per state, on the panel colour, 8 px per sprite pixel
for (const st of Object.keys(STATE_FRAMES) as ClawdState[]) {
  const info = STATE_FRAMES[st];
  const dir = path.join(work, st);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 0; n < info.frames; n++) fs.writeFileSync(path.join(dir, `f${String(n).padStart(2, '0')}.png`), encodePng(toRgba(frame(st, n), 8, [43, 49, 55, 255])));
  if (!ff) continue;
  const out = path.join(media, `clawd-${st}.gif`);
  const r = spawnSync(ff, ['-y', '-v', 'error', '-framerate', String(info.fps), '-i', path.join(dir, 'f%02d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=32[p];[b][p]paletteuse=dither=none', '-loop', '0', out], { windowsHide: true });
  console.log(st.padEnd(10), `${info.frames} frames @ ${info.fps} fps`, r.status === 0 ? '-> ' + path.relative(root, out) : 'ffmpeg failed: ' + r.stderr.toString().slice(0, 200));
}
