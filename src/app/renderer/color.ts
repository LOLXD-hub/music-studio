// Colour helpers: track colours are stored as hex, the UI shows them desaturated so a dozen tracks stay calm.

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** The hue of `hex` at a fixed, low saturation and the given lightness (0..1). */
export function tone(hex: string, s: number, l: number): string {
  const [h] = hexToHsl(hex);
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

export interface ClipTones { body: string; head: string; note: string }

/** Flat clip colours in the manner of a playlist: a darker title strip over a mid-tone body. */
export function clipTones(hex: string): ClipTones {
  return { body: tone(hex, 0.34, 0.4), head: tone(hex, 0.34, 0.3), note: 'rgba(236, 240, 243, 0.86)' };
}

/** Note colour in the piano roll: lighter than the clip so notes read against the grid. */
export function noteTone(hex: string, alpha: number): string {
  const [h] = hexToHsl(hex);
  return `hsla(${h.toFixed(0)}, 38%, 62%, ${alpha})`;
}
