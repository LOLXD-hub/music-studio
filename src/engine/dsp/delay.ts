/** Circular delay line with fractional reads. */
export class DelayLine {
  readonly buf: Float32Array;
  private w = 0;
  private mask: number;
  constructor(maxSamples: number) {
    let n = 2;
    while (n < maxSamples + 4) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
  }
  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
  /** Integer tap, 1 = last written sample. */
  tap(d: number): number {
    return this.buf[(this.w - d) & this.mask];
  }
  /** Linear interpolation. */
  read(d: number): number {
    const i = Math.floor(d);
    const f = d - i;
    const a = this.buf[(this.w - i) & this.mask];
    const b = this.buf[(this.w - i - 1) & this.mask];
    return a + (b - a) * f;
  }
  /** Four-point Lagrange read, cleaner for modulated delays. */
  readCubic(d: number): number {
    const i = Math.floor(d);
    const f = d - i;
    const m = this.mask;
    const w = this.w;
    const y0 = this.buf[(w - i + 1) & m];
    const y1 = this.buf[(w - i) & m];
    const y2 = this.buf[(w - i - 1) & m];
    const y3 = this.buf[(w - i - 2) & m];
    const c0 = y1;
    const c1 = y2 - y0 / 3 - y1 / 2 - y3 / 6;
    const c2 = (y0 + y2) / 2 - y1;
    const c3 = (y3 - y0) / 6 + (y1 - y2) / 2;
    return ((c3 * f + c2) * f + c1) * f + c0;
  }
  clear(): void {
    this.buf.fill(0);
  }
  get length(): number {
    return this.buf.length;
  }
}

/** Schroeder allpass with a fixed delay, used for diffusion. */
export class Allpass {
  private buf: Float32Array;
  private i = 0;
  private len: number;
  private g: number;
  constructor(len: number, g: number) {
    this.len = Math.max(1, len);
    this.g = g;
    this.buf = new Float32Array(this.len);
  }
  tick(x: number): number {
    const d = this.buf[this.i];
    const v = x - this.g * d;
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.len;
    return d + this.g * v;
  }
  clear(): void {
    this.buf.fill(0);
  }
}
