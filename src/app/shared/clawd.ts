// Clawd, drawn pixel by pixel. Proportions follow the reference sprite: an 8-wide body, two tall narrow eyes,
// arm stubs on both sides and four legs. Every animation is composed from small hand-made sprites.
// Pure data and a tiny rasterizer, so the same code draws the live status widget, the app icon and the README GIFs.

export const PAL: Record<string, string> = {
  O: '#D87656', // body
  S: '#B5603F', // body shadow
  E: '#120D0B', // eyes
  W: '#F4F1EC', // white
  G: '#34343C', // dark grey
  g: '#6B6B78', // mid grey
  L: '#A4A4B2', // light grey
  B: '#5BC0FF', // blue block
  Y: '#FFD166', // yellow
  N: '#7EE0A0', // mint
  R: '#FF6B7A', // red
  C: '#FF8A3D', // carrot
  D: '#E0661F', // carrot shadow
  H: '#62C46E', // leaf
  h: '#3C8F4E', // leaf shadow
  T: '#8A5A3C', // wood
  t: '#B98557', // wood light
  K: '#1E1E24', // near black
  P: '#B78CFF', // violet
};

export interface PxCanvas {
  w: number;
  h: number;
  px: string[][];
}

export function canvas(w: number, h: number): PxCanvas {
  return { w, h, px: Array.from({ length: h }, () => Array.from({ length: w }, () => '.')) };
}

export function put(c: PxCanvas, x: number, y: number, ch: string): void {
  if (x >= 0 && y >= 0 && x < c.w && y < c.h && ch !== '.') c.px[y][x] = ch;
}

/** Paint ASCII rows. '.' is transparent. */
export function blit(c: PxCanvas, rows: string[], x: number, y: number): void {
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) put(c, x + i, y + j, r[i]);
  });
}

export function rect(c: PxCanvas, x: number, y: number, w: number, h: number, ch: string): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j, ch);
}

export function draw(ctx: CanvasRenderingContext2D, c: PxCanvas, scale: number): void {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const ch = c.px[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = PAL[ch] ?? '#f0f';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

export function toRgba(c: PxCanvas, scale: number, bg: [number, number, number, number] | null = null): { width: number; height: number; rgba: Uint8Array } {
  const W = c.w * scale;
  const H = c.h * scale;
  const rgba = new Uint8Array(W * H * 4);
  if (bg) for (let i = 0; i < W * H; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = bg[3]; }
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const ch = c.px[y][x];
      if (ch === '.') continue;
      const hex = PAL[ch];
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
        const o = ((y * scale + j) * W + x * scale + i) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
    }
  }
  return { width: W, height: H, rgba };
}

// ---------------------------------------------------------------- body

/** 12 x 9 body: 8 wide trunk, tall eyes at columns 3 and 8, arm stubs, four legs (columns 2, 4, 7, 9). */
const BODY = [
  '..OOOOOOOOS.',
  '..OEOOOOEOS.',
  '..OEOOOOEOS.',
  'OOOOOOOOOOOS',
  'OOOOOOOOOOSS',
  '..OOOOOOOOS.',
  '..SSSSSSSSS.',
  '..O.O..O.O..',
  '..S.S..S.S..',
];

type Eyes = 'open' | 'blink' | 'closed' | 'up' | 'happy';
type Arms = 'down' | 'none';

interface Pose {
  x: number;
  y: number;
  eyes?: Eyes;
  arms?: Arms;
  /** Leg shift for walking: moves the outer pair by one pixel. */
  step?: 0 | 1;
}

function clawd(c: PxCanvas, p: Pose): void {
  const rows = BODY.map((r) => r.split(''));
  const eyes = p.eyes ?? 'open';
  const setEye = (row: number, col: number, ch: string) => (rows[row][col] = ch);
  if (eyes === 'blink') {
    for (const col of [3, 8]) { setEye(1, col, 'O'); setEye(2, col, 'E'); }
  } else if (eyes === 'closed') {
    for (const col of [3, 8]) { setEye(1, col, 'O'); setEye(2, col, 'E'); }
  } else if (eyes === 'up') {
    for (const col of [3, 8]) { setEye(0, col, 'E'); setEye(1, col, 'E'); setEye(2, col, 'O'); }
  } else if (eyes === 'happy') {
    for (const col of [3, 8]) { setEye(1, col, 'E'); setEye(2, col, 'O'); }
    rows[2][2] = 'O';
  }
  if (p.arms === 'none') {
    for (const [r, cols] of [[3, [0, 1, 10, 11]], [4, [0, 1, 10, 11]]] as [number, number[]][]) for (const col of cols) rows[r][col] = '.';
  }
  if (p.step === 1) {
    rows[7] = '..O..O.O..O.'.split('');
    rows[8] = '..S..S.S..S.'.split('');
  }
  blit(c, rows.map((r) => r.join('')), p.x, p.y);
}

// ---------------------------------------------------------------- props

const HEADPHONES = [
  '.GGGGGGGGGG.',
  'GG........GG',
  'gG........Gg',
  'GG........GG',
];

const HAMMER_UP = [
  '.LLL.',
  '.LLL.',
  '..T..',
  '..T..',
  '..T..',
];

const HAMMER_DOWN = [
  '..T..',
  '..T..',
  '..T..',
  '.LLL.',
  '.LLL.',
];

const CARROT = [
  '..hHh..',
  '.HhHhH.',
  '..CCC..',
  '.CCCCC.',
  '.CCCDC.',
  '..CCDC.',
  '..CDDC.',
  '...CD..',
  '...D...',
];

const NOTE = ['.WW', '.W.', 'WW.'];
const BULB = ['.YYY.', 'YYYYY', 'YYYYY', '.YYY.', '..G..'];
const ZZZ = ['WWW', '.W.', 'WWW'];

function bar(c: PxCanvas, x: number, y: number, w: number, fill: number): void {
  rect(c, x, y, w, 3, 'G');
  rect(c, x + 1, y + 1, w - 2, 1, 'K');
  rect(c, x + 1, y + 1, Math.round((w - 2) * fill), 1, 'C');
}

// ---------------------------------------------------------------- animations

export type ClawdState = 'asleep' | 'idle' | 'listening' | 'building' | 'loading' | 'thinking' | 'mixing';

export const STATE_FRAMES: Record<ClawdState, { fps: number; frames: number }> = {
  asleep: { fps: 2, frames: 4 },
  idle: { fps: 4, frames: 24 },
  listening: { fps: 5, frames: 8 },
  building: { fps: 5, frames: 8 },
  loading: { fps: 5, frames: 8 },
  thinking: { fps: 3, frames: 8 },
  mixing: { fps: 4, frames: 8 },
};

export const W = 26;
export const H = 26;

/** One frame of an animation. `n` is the frame counter. */
export function frame(state: ClawdState, n: number): PxCanvas {
  const c = canvas(W, H);
  const gx = 7;
  const gy = 11;
  // ground shadow
  rect(c, gx + 1, gy + 9, 10, 1, 'K');
  switch (state) {
    case 'asleep': {
      const down = n % 4 < 2 ? 1 : 0;
      clawd(c, { x: gx, y: gy + 1 + down * 0, eyes: 'closed' });
      const k = n % 4;
      for (let i = 0; i <= k; i++) blit(c, ZZZ, gx + 9 + i * 2, gy - 2 - i * 2 + (i === 0 ? 1 : 0));
      break;
    }
    case 'idle': {
      const blink = n % 24 === 17 || n % 24 === 18;
      const bob = n % 12 < 6 ? 0 : 1;
      clawd(c, { x: gx, y: gy + bob, eyes: blink ? 'blink' : 'open' });
      break;
    }
    case 'listening': {
      const beat = n % 4;
      const sway = [0, 1, 1, 0][beat];
      const dy = beat % 2 === 0 ? 0 : 1;
      clawd(c, { x: gx + (n % 8 < 4 ? sway : -sway + 1), y: gy + dy, eyes: n % 8 === 6 ? 'blink' : 'open' });
      blit(c, HEADPHONES, gx + (n % 8 < 4 ? sway : -sway + 1), gy + dy - 1);
      const t = n % 8;
      blit(c, NOTE, gx + 13, gy + 3 - Math.floor(t / 2), );
      if (t > 3) blit(c, NOTE, gx - 4, gy + 6 - (t - 4));
      break;
    }
    case 'building': {
      const phase = n % 8;
      const strike = phase >= 4;
      // block stack grows each cycle
      const bricks = Math.min(3, 1 + Math.floor(phase / 3));
      const cols = ['B', 'Y', 'N'];
      for (let i = 0; i < bricks; i++) rect(c, 0, gy + 9 - 3 * (i + 1) + 0, 4, 3, cols[i]);
      clawd(c, { x: gx, y: gy, eyes: strike ? 'happy' : 'open' });
      // right arm raised holding the hammer, then striking down
      if (!strike) {
        rect(c, gx + 10, gy + 3, 2, 2, '.');
        rect(c, gx + 10, gy + 1, 2, 2, 'O');
        blit(c, HAMMER_UP, gx + 9, gy - 4);
      } else {
        blit(c, HAMMER_DOWN, gx + 12, gy + 4);
        if (phase === 4) { put(c, gx + 13, gy + 3, 'Y'); put(c, gx + 15, gy + 4, 'Y'); put(c, gx + 16, gy + 6, 'Y'); }
      }
      break;
    }
    case 'loading': {
      const step = (n % 2) as 0 | 1;
      const bob = n % 4 < 2 ? 0 : 1;
      clawd(c, { x: gx, y: gy + bob, eyes: 'open', arms: 'none', step });
      blit(c, CARROT, gx + 2, gy + 3 + bob);
      // arms hold the carrot
      rect(c, gx + 1, gy + 4 + bob, 2, 2, 'O');
      rect(c, gx + 9, gy + 4 + bob, 2, 2, 'O');
      bar(c, gx - 2, gy + 11, 16, (n % 8) / 7);
      break;
    }
    case 'thinking': {
      const t = n % 8;
      clawd(c, { x: gx, y: gy, eyes: t === 7 ? 'blink' : 'up' });
      // right hand on the chin
      rect(c, gx + 10, gy + 3, 2, 2, '.');
      rect(c, gx + 9, gy + 3, 3, 2, 'O');
      const dots = t < 6 ? 1 + Math.floor(t / 2) : 3;
      for (let i = 0; i < dots; i++) rect(c, gx + 12 + i * 2, gy - 3 - i, 1, 1, 'W');
      rect(c, gx + 13, gy - 7, 7, 1, 'W');
      if (t >= 5) blit(c, BULB, gx + 13, gy - 11);
      break;
    }
    case 'mixing': {
      const t = n % 8;
      clawd(c, { x: gx, y: gy - 1, eyes: 'open' });
      // small console in front
      rect(c, gx - 1, gy + 8, 14, 4, 'G');
      rect(c, gx - 1, gy + 8, 14, 1, 'g');
      for (let i = 0; i < 4; i++) {
        const lvl = Math.round(1 + 1.5 * (1 + Math.sin(((t + i * 2) / 8) * Math.PI * 2)));
        rect(c, gx + 1 + i * 3, gy + 9, 1, 3, 'K');
        rect(c, gx + i * 3, gy + 9 + Math.min(2, lvl) - 1, 3, 1, i % 2 ? 'Y' : 'C');
      }
      put(c, gx + 11, gy + 7, t % 4 < 2 ? 'N' : 'R');
      // arm reaching to a fader
      const reach = t % 4 < 2 ? 0 : 1;
      rect(c, gx + 10, gy + 3, 2, 2, '.');
      rect(c, gx + 9 + reach, gy + 4, 2, 3, 'O');
      break;
    }
  }
  return c;
}

/** Logo: Clawd holding the carrot, front pose. */
export function logo(): PxCanvas {
  const c = canvas(18, 20);
  rect(c, 3, 17, 12, 1, 'K');
  clawd(c, { x: 3, y: 4, eyes: 'open', arms: 'none' });
  // the carrot is held in front of the chest with both hands; the face stays free
  blit(c, CARROT, 5, 8);
  rect(c, 3, 9, 3, 2, 'O');
  rect(c, 12, 9, 3, 2, 'O');
  put(c, 8, 12, 'Y');
  put(c, 9, 12, 'W');
  return c;
}
