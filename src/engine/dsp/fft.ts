/** In-place radix-2 FFT with cached twiddles. */
export class FFT {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  constructor(n: number) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Forward transform of re/im arrays, in place. */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const l = i + j;
          const r = l + half;
          const tr = re[r] * this.cos[k] + im[r] * this.sin[k];
          const ti = -re[r] * this.sin[k] + im[r] * this.cos[k];
          re[r] = re[l] - tr;
          im[r] = im[l] - ti;
          re[l] += tr;
          im[l] += ti;
        }
      }
    }
  }

  /** Inverse transform, in place, scaled by 1/n. */
  inverse(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < this.n; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / this.n;
    for (let i = 0; i < this.n; i++) {
      re[i] *= s;
      im[i] = -im[i] * s;
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
