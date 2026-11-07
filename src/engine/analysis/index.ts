// Audio analysis: loudness (ITU-R BS.1770), spectrum, stereo image, key and tempo estimates, and spectrogram images.
// This is how an agent "listens": it cannot hear, so it reads these measurements and looks at the pictures.

import { FFT, hann } from '../dsp/fft.ts';

export interface Band {
  name: string;
  lo: number;
  hi: number;
  /** Level relative to the total, dB. */
  db: number;
  share: number;
}

export interface Issue {
  severity: 'info' | 'warn' | 'problem';
  message: string;
  hint?: string;
}

export interface AudioReport {
  durationSec: number;
  sampleRate: number;
  loudness: { integratedLufs: number; shortTermMaxLufs: number; lra: number; samplePeakDb: number; truePeakDb: number; rmsDb: number; crestDb: number };
  curve: { t: number; lufs: number }[];
  clipping: { samples: number; runs: number };
  dcOffset: number;
  silenceRatio: number;
  stereo: { correlation: number; widthPercent: number; balanceDb: number };
  spectrum: { bands: Band[]; centroidHz: number; rolloff85Hz: number; flatness: number; tiltDbPerOct: number };
  music: { keys: { name: string; score: number }[]; tempo: { bpm: number; score: number }[]; onsetsPerSec: number };
  descriptors: string[];
  issues: Issue[];
}

const db10 = (x: number) => 10 * Math.log10(Math.max(x, 1e-12));
const db20 = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

// ---------------------------------------------------------------- loudness

function kWeight(x: Float32Array, sr: number): Float64Array {
  // Stage 1: high-shelf, stage 2: RLB high-pass (coefficients as in libebur128, valid for any sample rate)
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const b10 = (Vh + (Vb * K) / Q + K * K) / a0;
  const b11 = (2 * (K * K - Vh)) / a0;
  const b12 = (Vh - (Vb * K) / Q + K * K) / a0;
  const a11 = (2 * (K * K - 1)) / a0;
  const a12 = (1 - K / Q + K * K) / a0;
  const f1 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sr);
  a0 = 1 + K / Q2 + K * K;
  const a21 = (2 * (K * K - 1)) / a0;
  const a22 = (1 - K / Q2 + K * K) / a0;
  const y = new Float64Array(x.length);
  let s1a = 0, s1b = 0, s2a = 0, s2b = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const w = v - a11 * s1a - a12 * s1b;
    const o1 = b10 * w + b11 * s1a + b12 * s1b;
    s1b = s1a;
    s1a = w;
    const w2 = o1 - a21 * s2a - a22 * s2b;
    const o2 = w2 - 2 * s2a + s2b;
    s2b = s2a;
    s2a = w2;
    y[i] = o2;
  }
  return y;
}

function loudness(L: Float32Array, R: Float32Array, sr: number) {
  const kl = kWeight(L, sr);
  const kr = kWeight(R, sr);
  const blk = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const n = L.length;
  // cumulative energy for fast windows
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + kl[i] * kl[i] + kr[i] * kr[i];
  const energies: number[] = [];
  for (let s = 0; s + blk <= n; s += hop) energies.push((cum[s + blk] - cum[s]) / blk);
  if (!energies.length) energies.push((cum[n] / Math.max(1, n)));
  const lufs = (e: number) => -0.691 + db10(e);
  const abs = energies.filter((e) => lufs(e) > -70);
  let integrated = -70;
  if (abs.length) {
    const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
    const gate = lufs(mean) - 10;
    const rel = abs.filter((e) => lufs(e) > gate);
    if (rel.length) integrated = lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
  }
  // short-term (3 s) series, hop 1 s
  const st = Math.round(3 * sr);
  const stHop = sr;
  const curve: { t: number; lufs: number }[] = [];
  let stMax = -70;
  const stVals: number[] = [];
  for (let s = 0; s + Math.min(st, n) <= n; s += stHop) {
    const len = Math.min(st, n - s);
    const l = lufs((cum[s + len] - cum[s]) / len);
    curve.push({ t: +(s / sr).toFixed(2), lufs: +l.toFixed(1) });
    if (l > -70) stVals.push(l);
    if (l > stMax) stMax = l;
    if (n <= st) break;
  }
  let lra = 0;
  if (stVals.length > 2) {
    const meanE = stVals.reduce((a, b) => a + Math.pow(10, b / 10), 0) / stVals.length;
    const gated = stVals.filter((v) => v > db10(meanE) - 20).sort((a, b) => a - b);
    if (gated.length > 1) lra = gated[Math.floor(gated.length * 0.95)] - gated[Math.floor(gated.length * 0.1)];
  }
  return { integrated, stMax, lra, curve };
}

function truePeak(x: Float32Array): number {
  // 4x oversampling with cubic interpolation, enough to catch inter-sample overs
  let pk = 0;
  for (let i = 1; i < x.length - 2; i++) {
    const y0 = x[i - 1], y1 = x[i], y2 = x[i + 1], y3 = x[i + 2];
    const a = Math.abs(y1);
    if (a > pk) pk = a;
    if (Math.abs(y1) < pk * 0.6 && Math.abs(y2) < pk * 0.6) continue;
    for (let k = 1; k < 4; k++) {
      const f = k / 4;
      const v = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      if (Math.abs(v) > pk) pk = Math.abs(v);
    }
  }
  return pk;
}

// ---------------------------------------------------------------- STFT helpers

interface Stft {
  mags: Float32Array[];
  hopSec: number;
  binHz: number;
}

function stft(mono: Float32Array, sr: number, size: number, hop: number, maxFrames = 6000): Stft {
  const fft = new FFT(size);
  const win = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const frames = Math.max(1, Math.floor((mono.length - size) / hop) + 1);
  const step = frames > maxFrames ? Math.ceil(frames / maxFrames) : 1;
  const mags: Float32Array[] = [];
  for (let f = 0; f < frames; f += step) {
    const o = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = (mono[o + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    const m = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (size / 4);
    mags.push(m);
  }
  return { mags, hopSec: (hop * step) / sr, binHz: sr / size };
}

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbb += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * dbb + 1e-12);
}

export function detectKey(S: Stft): { name: string; score: number }[] {
  const chroma = new Array(12).fill(0);
  for (const m of S.mags) {
    for (let i = 2; i < m.length; i++) {
      const f = i * S.binHz;
      if (f < 65 || f > 2100) continue;
      const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12;
      chroma[pc] += Math.log1p(m[i] * 40);
    }
  }
  const out: { name: string; score: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - k + 12) % 12]);
    out.push({ name: KEY_NAMES[k] + ' major', score: corr(chroma, rot(MAJOR)) });
    out.push({ name: KEY_NAMES[k] + ' minor', score: corr(chroma, rot(MINOR)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((k) => ({ name: k.name, score: +k.score.toFixed(3) }));
}

function tempoAndOnsets(S: Stft): { tempo: { bpm: number; score: number }[]; onsetsPerSec: number } {
  const n = S.mags.length;
  if (n < 16) return { tempo: [], onsetsPerSec: 0 };
  const lo = Math.max(1, Math.floor(60 / S.binHz));
  const hi = Math.min(S.mags[0].length - 1, Math.floor(5000 / S.binHz));
  const flux = new Float64Array(n);
  for (let f = 1; f < n; f++) {
    let s = 0;
    for (let i = lo; i < hi; i++) {
      const d = Math.log1p(S.mags[f][i] * 50) - Math.log1p(S.mags[f - 1][i] * 50);
      if (d > 0) s += d;
    }
    flux[f] = s;
  }
  let mean = 0;
  for (const v of flux) mean += v;
  mean /= n;
  for (let i = 0; i < n; i++) flux[i] = Math.max(0, flux[i] - mean * 0.8);
  // onsets: local maxima above an adaptive threshold
  let onsets = 0;
  let thr = 0;
  for (const v of flux) thr += v * v;
  thr = Math.sqrt(thr / n) * 1.2;
  for (let i = 1; i < n - 1; i++) if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) onsets++;
  const dur = n * S.hopSec;
  const res: { bpm: number; score: number }[] = [];
  const minLag = Math.floor(60 / 200 / S.hopSec);
  const maxLag = Math.min(n - 1, Math.ceil(60 / 55 / S.hopSec));
  let best = 0;
  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += flux[i] * flux[i + lag];
    s /= n - lag;
    ac[lag] = s;
    if (s > best) best = s;
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best * 0.35) {
      const bpm = 60 / (lag * S.hopSec);
      // mild prior towards 70..150 bpm
      const prior = Math.exp(-Math.pow(Math.log2(bpm / 105), 2) / 1.2);
      res.push({ bpm: +bpm.toFixed(1), score: +((ac[lag] / best) * (0.5 + 0.5 * prior)).toFixed(3) });
    }
  }
  res.sort((a, b) => b.score - a.score);
  return { tempo: res.slice(0, 3), onsetsPerSec: +(onsets / Math.max(1, dur)).toFixed(2) };
}

const BAND_DEFS: [string, number, number][] = [
  ['sub', 20, 60], ['bass', 60, 250], ['low-mid', 250, 500], ['mid', 500, 2000], ['high-mid', 2000, 4000], ['presence', 4000, 8000], ['air', 8000, 16000],
];

export interface AnalyzeOptions {
  /** Tempo the project claims, to compare with the detected tempo. */
  projectBpm?: number;
  projectKey?: string;
}

export function analyzeAudio(L: Float32Array, R: Float32Array, sr: number, opts: AnalyzeOptions = {}): AudioReport {
  const n = L.length;
  const dur = n / sr;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i] + R[i]);

  const ld = loudness(L, R, sr);
  let sp = 0, sq = 0, dc = 0, clipS = 0, clipRuns = 0, silent = 0;
  let inRun = 0;
  let sL = 0, sR = 0, sM = 0, sS = 0, cLR = 0;
  const silWin = Math.round(0.05 * sr);
  let winPk = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    const aa = Math.abs(a), ab = Math.abs(b);
    const m = Math.max(aa, ab);
    if (m > sp) sp = m;
    sq += a * a + b * b;
    dc += a + b;
    if (m >= 0.999) {
      clipS++;
      if (++inRun === 3) clipRuns++;
    } else inRun = 0;
    sL += a * a;
    sR += b * b;
    cLR += a * b;
    const mid = 0.5 * (a + b), side = 0.5 * (a - b);
    sM += mid * mid;
    sS += side * side;
    if (m > winPk) winPk = m;
    if ((i + 1) % silWin === 0) {
      if (winPk < 1e-4) silent++;
      winPk = 0;
    }
  }
  const tp = Math.max(truePeak(L), truePeak(R));
  const rms = Math.sqrt(sq / Math.max(1, 2 * n));

  const size = 4096;
  const S = stft(mono, sr, size, 2048);
  // averaged power spectrum
  const avg = new Float64Array(size / 2);
  for (const m of S.mags) for (let i = 0; i < m.length; i++) avg[i] += m[i] * m[i];
  const frames = Math.max(1, S.mags.length);
  for (let i = 0; i < avg.length; i++) avg[i] /= frames;
  let total = 0;
  for (let i = 1; i < avg.length; i++) total += avg[i];
  const bands: Band[] = BAND_DEFS.map(([name, lo, hi]) => {
    let e = 0;
    for (let i = Math.floor(lo / S.binHz); i <= Math.min(avg.length - 1, Math.floor(hi / S.binHz)); i++) e += avg[i];
    return { name, lo, hi, db: +db10(e / Math.max(total, 1e-12)).toFixed(1), share: +((100 * e) / Math.max(total, 1e-12)).toFixed(1) };
  });
  let cs = 0, ce = 0, acc = 0, roll = 0;
  let logSum = 0, cnt = 0;
  for (let i = 2; i < avg.length; i++) {
    const f = i * S.binHz;
    cs += f * avg[i];
    ce += avg[i];
    if (f > 30 && f < 16000) {
      logSum += Math.log(avg[i] + 1e-14);
      cnt++;
    }
  }
  for (let i = 2; i < avg.length; i++) {
    acc += avg[i];
    if (!roll && acc >= 0.85 * ce) roll = i * S.binHz;
  }
  let mean = 0;
  for (let i = 2; i < avg.length; i++) if (i * S.binHz > 30 && i * S.binHz < 16000) mean += avg[i];
  mean /= Math.max(1, cnt);
  const flat = Math.exp(logSum / Math.max(1, cnt)) / Math.max(mean, 1e-14);
  // spectral tilt: slope of log power vs log frequency, in dB per octave
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
  for (let i = 3; i < avg.length; i++) {
    const f = i * S.binHz;
    if (f < 80 || f > 12000) continue;
    const x = Math.log2(f);
    const y = db10(avg[i] + 1e-14);
    sx += x; sy += y; sxx += x * x; sxy += x * y; k++;
  }
  const tilt = k > 2 ? (k * sxy - sx * sy) / (k * sxx - sx * sx) : 0;

  const keys = n > sr * 3 ? detectKey(S) : [];
  const { tempo, onsetsPerSec } = tempoAndOnsets(S);

  const corrLR = cLR / Math.sqrt(sL * sR + 1e-12);
  const width = (100 * Math.sqrt(sS / Math.max(sM + sS, 1e-12)));
  const report: AudioReport = {
    durationSec: +dur.toFixed(2),
    sampleRate: sr,
    loudness: {
      integratedLufs: +ld.integrated.toFixed(1),
      shortTermMaxLufs: +ld.stMax.toFixed(1),
      lra: +ld.lra.toFixed(1),
      samplePeakDb: +db20(sp).toFixed(1),
      truePeakDb: +db20(tp).toFixed(1),
      rmsDb: +db20(rms).toFixed(1),
      crestDb: +(db20(sp) - db20(rms)).toFixed(1),
    },
    curve: ld.curve,
    clipping: { samples: clipS, runs: clipRuns },
    dcOffset: +(dc / Math.max(1, 2 * n)).toFixed(5),
    silenceRatio: +(silent / Math.max(1, Math.floor(n / silWin))).toFixed(3),
    stereo: { correlation: +corrLR.toFixed(2), widthPercent: +width.toFixed(0), balanceDb: +(10 * Math.log10((sL + 1e-12) / (sR + 1e-12))).toFixed(1) },
    spectrum: { bands, centroidHz: Math.round(cs / Math.max(ce, 1e-12)), rolloff85Hz: Math.round(roll), flatness: +flat.toFixed(3), tiltDbPerOct: +tilt.toFixed(1) },
    music: { keys, tempo, onsetsPerSec },
    descriptors: [],
    issues: [],
  };
  describe(report, opts);
  return report;
}

function describe(r: AudioReport, o: AnalyzeOptions): void {
  const d = r.descriptors;
  const issues = r.issues;
  const band = (name: string) => r.spectrum.bands.find((b) => b.name === name)!;
  const c = r.spectrum.centroidHz;
  d.push(c < 900 ? 'dark' : c < 1800 ? 'warm' : c < 3200 ? 'balanced-bright' : 'bright');
  if (r.spectrum.tiltDbPerOct < -6.5) d.push('dull top end');
  else if (r.spectrum.tiltDbPerOct > -3) d.push('very airy / thin');
  if (r.loudness.crestDb > 20) d.push('very dynamic');
  else if (r.loudness.crestDb < 10) d.push('heavily compressed');
  d.push(r.stereo.widthPercent > 45 ? 'wide stereo' : r.stereo.widthPercent < 12 ? 'nearly mono' : 'moderate stereo width');
  if (r.loudness.lra > 10) d.push('large dynamic range between sections');
  else if (r.loudness.lra < 3 && r.durationSec > 20) d.push('flat arrangement energy (little change between sections)');

  if (r.clipping.runs > 0) issues.push({ severity: 'problem', message: `Clipping: ${r.clipping.samples} samples at full scale in ${r.clipping.runs} runs.`, hint: 'Lower track volumes or the master limiter input gain, or reduce the loudest layer.' });
  if (r.loudness.truePeakDb > -0.1 && r.clipping.runs === 0) issues.push({ severity: 'warn', message: `True peak ${r.loudness.truePeakDb} dBTP: inter-sample overs are possible after encoding to MP3/AAC.`, hint: 'Set the limiter ceiling to -1 dB.' });
  if (r.loudness.integratedLufs > -9) issues.push({ severity: 'warn', message: `Very loud master (${r.loudness.integratedLufs} LUFS). Streaming services will turn it down and the dynamics are likely crushed.`, hint: 'Aim for -14 to -10 LUFS.' });
  if (r.loudness.integratedLufs < -26 && r.durationSec > 1) issues.push({ severity: 'warn', message: `Very quiet (${r.loudness.integratedLufs} LUFS).`, hint: 'Raise levels or add a limiter on the master with some input gain.' });
  if (Math.abs(r.dcOffset) > 0.005) issues.push({ severity: 'warn', message: `DC offset ${r.dcOffset}.`, hint: 'Add a high-pass at 20-30 Hz on the offending track.' });
  if (r.stereo.correlation < 0) issues.push({ severity: 'problem', message: `Negative L/R correlation (${r.stereo.correlation}): the mix will partly cancel in mono.`, hint: 'Check for out-of-phase layers or an over-wide widener.' });
  else if (r.stereo.correlation < 0.25) issues.push({ severity: 'warn', message: `Low L/R correlation (${r.stereo.correlation}): weak mono compatibility.` });
  if (Math.abs(r.stereo.balanceDb) > 2.5) issues.push({ severity: 'warn', message: `Stereo balance leans ${r.stereo.balanceDb > 0 ? 'left' : 'right'} by ${Math.abs(r.stereo.balanceDb)} dB.` });
  const lm = band('low-mid'), bs = band('bass'), hm = band('high-mid'), pr = band('presence'), sb = band('sub'), mid = band('mid');
  if (lm.share > 38) issues.push({ severity: 'warn', message: `Low-mid build-up (${lm.share}% of the energy at 250-500 Hz): the mix is likely muddy.`, hint: 'Cut 250-400 Hz on pads, guitars and piano; use a high-pass on everything that is not bass or kick.' });
  if (bs.share + sb.share < 8 && r.durationSec > 3) issues.push({ severity: 'info', message: 'Little energy below 250 Hz: the mix may feel thin on full-range speakers.', hint: 'Add or raise a bass part, or check that the kick has body.' });
  if (sb.share > 14) issues.push({ severity: 'warn', message: `A lot of sub energy (${sb.share}% below 60 Hz): small speakers will not reproduce it and it eats headroom.` });
  if (hm.share + pr.share > 30) issues.push({ severity: 'warn', message: `Harsh balance: ${(hm.share + pr.share).toFixed(0)}% of the energy above 2 kHz.`, hint: 'Lower hi-hats, bright synth layers or add a high shelf cut.' });
  if (mid.share < 12 && r.durationSec > 3) issues.push({ severity: 'info', message: 'Hollow midrange: the main melodic instruments may be too quiet or too sparse.' });
  if (r.durationSec > 30 && r.loudness.lra < 2) issues.push({ severity: 'info', message: 'Loudness is almost constant for the whole piece. Real arrangements breathe: thin out the intro, build the chorus.' });
  if (r.silenceRatio > 0.35) issues.push({ severity: 'info', message: `${Math.round(r.silenceRatio * 100)}% of the file is near-silent.` });
  if (o.projectBpm && r.music.tempo.length && r.durationSec > 8) {
    const t = r.music.tempo[0].bpm;
    const ratios = [1, 2, 0.5, 1.5, 2 / 3];
    if (!ratios.some((x) => Math.abs(t - o.projectBpm! * x) / (o.projectBpm! * x) < 0.04)) d.push(`detected tempo ${t} differs from the project tempo ${o.projectBpm} (can happen with sparse or rubato material)`);
  }
}

// ---------------------------------------------------------------- images

export interface ImageData8 {
  width: number;
  height: number;
  /** RGBA, row-major. */
  rgba: Uint8Array;
}

const MAGMA: [number, number, number][] = [
  [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164],
];

function magma(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t)) * (MAGMA.length - 1);
  const i = Math.min(MAGMA.length - 2, Math.floor(t));
  const f = t - i;
  const a = MAGMA[i], b = MAGMA[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// 3x5 pixel digits for labels
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111',
  k: '101101110101101', '.': '000000000000010', s: '011100010001110', m: '000111111101101',
};

export function drawText(img: ImageData8, x: number, y: number, text: string, color: [number, number, number], scale = 1): void {
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r * 3 + c] === '1') {
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            const px = x + c * scale + dx, py = y + r * scale + dy;
            if (px >= 0 && py >= 0 && px < img.width && py < img.height) {
              const o = (py * img.width + px) * 4;
              img.rgba[o] = color[0]; img.rgba[o + 1] = color[1]; img.rgba[o + 2] = color[2]; img.rgba[o + 3] = 255;
            }
          }
        }
      }
    }
    x += 4 * scale;
  }
}

function blend(img: ImageData8, x: number, y: number, c: [number, number, number], a: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.rgba[o] = img.rgba[o] * (1 - a) + c[0] * a;
  img.rgba[o + 1] = img.rgba[o + 1] * (1 - a) + c[1] * a;
  img.rgba[o + 2] = img.rgba[o + 2] * (1 - a) + c[2] * a;
}

export interface PictureOptions {
  width?: number;
  /** Bar line positions in seconds (1-based bar numbers are labelled). */
  barTimes?: number[];
  /** First bar number for barTimes[0]. */
  firstBar?: number;
  fMin?: number;
  fMax?: number;
}

/** Waveform on top, log-frequency spectrogram below. Bars and frequency ticks are drawn and labelled. */
export function renderPicture(L: Float32Array, R: Float32Array, sr: number, o: PictureOptions = {}): { image: ImageData8; layout: Record<string, unknown> } {
  const W = o.width ?? 1200;
  const waveH = 96;
  const specH = 360;
  const H = waveH + specH + 2;
  const img: ImageData8 = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i++) { img.rgba[i * 4] = 10; img.rgba[i * 4 + 1] = 10; img.rgba[i * 4 + 2] = 14; img.rgba[i * 4 + 3] = 255; }
  const n = L.length;
  const dur = n / sr;
  // waveform with rms
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
    let mn = 0, mx = 0, e = 0, cnt = 0;
    for (let i = a; i < b; i++) {
      const v = 0.5 * (L[i] + R[i]);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      e += v * v; cnt++;
    }
    const rms = Math.sqrt(e / Math.max(1, cnt));
    const mid = waveH / 2;
    const clip = mx > 0.99 || mn < -0.99;
    for (let y = Math.round(mid - mx * mid * 0.95); y <= Math.round(mid - mn * mid * 0.95); y++) blend(img, x, y, clip ? [255, 80, 80] : [70, 150, 190], 0.9);
    for (let y = Math.round(mid - rms * mid * 0.95 * 1.4); y <= Math.round(mid + rms * mid * 0.95 * 1.4); y++) blend(img, x, y, [160, 220, 250], 0.85);
  }
  // spectrogram
  const fMin = o.fMin ?? 30;
  const fMax = Math.min(o.fMax ?? 16000, sr / 2 * 0.98);
  const size = 4096;
  const fft = new FFT(size);
  const win = hann(size);
  const re = new Float64Array(size), im = new Float64Array(size);
  const binHz = sr / size;
  const rowBins: [number, number][] = [];
  for (let y = 0; y < specH; y++) {
    const f0 = fMin * Math.pow(fMax / fMin, 1 - (y + 1) / specH);
    const f1 = fMin * Math.pow(fMax / fMin, 1 - y / specH);
    rowBins.push([f0 / binHz, f1 / binHz]);
  }
  const col = new Float32Array(specH);
  let maxDb = -200;
  const cols: Float32Array[] = [];
  for (let x = 0; x < W; x++) {
    const center = Math.floor(((x + 0.5) / W) * n);
    for (let i = 0; i < size; i++) {
      const idx = center - size / 2 + i;
      re[i] = idx >= 0 && idx < n ? 0.5 * (L[idx] + R[idx]) * win[i] : 0;
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let y = 0; y < specH; y++) {
      const [b0, b1] = rowBins[y];
      let m = 0;
      const i0 = Math.floor(b0), i1 = Math.max(i0, Math.ceil(b1));
      if (i1 - i0 < 1) {
        const f = b0 - i0;
        const a = Math.hypot(re[i0], im[i0]), b = Math.hypot(re[i0 + 1], im[i0 + 1]);
        m = a + (b - a) * f;
      } else for (let i = i0; i <= i1; i++) m = Math.max(m, Math.hypot(re[i], im[i]));
      const d = 20 * Math.log10(m / (size / 4) + 1e-9);
      col[y] = d;
      if (d > maxDb) maxDb = d;
    }
    cols.push(Float32Array.from(col));
  }
  const top = Math.max(maxDb, -60);
  const range = 78;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < specH; y++) {
      const t = (cols[x][y] - (top - range)) / range;
      const c = magma(t);
      const o2 = ((waveH + 2 + y) * W + x) * 4;
      img.rgba[o2] = c[0]; img.rgba[o2 + 1] = c[1]; img.rgba[o2 + 2] = c[2]; img.rgba[o2 + 3] = 255;
    }
  }
  const yOf = (f: number) => waveH + 2 + Math.round((1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * specH);
  for (const f of [100, 1000, 10000]) {
    const y = yOf(f);
    for (let x = 0; x < W; x += 2) blend(img, x, y, [255, 255, 255], 0.28);
    drawText(img, 3, y - 7, f >= 1000 ? f / 1000 + 'k' : String(f), [255, 255, 255], 2);
  }
  for (const f of [300, 3000]) {
    const y = yOf(f);
    for (let x = 0; x < W; x += 6) blend(img, x, y, [255, 255, 255], 0.14);
  }
  // time grid: bars if given, otherwise seconds
  if (o.barTimes && o.barTimes.length) {
    const first = o.firstBar ?? 1;
    const stride = o.barTimes.length > 64 ? 8 : o.barTimes.length > 32 ? 4 : o.barTimes.length > 16 ? 2 : 1;
    o.barTimes.forEach((t, i) => {
      if (t > dur) return;
      const x = Math.round((t / dur) * W);
      const strong = i % 4 === 0;
      for (let y = 0; y < H; y += strong ? 1 : 3) blend(img, x, y, [255, 255, 255], strong ? 0.22 : 0.1);
      if (i % stride === 0) drawText(img, x + 3, waveH + 4, String(first + i), [255, 255, 255], 2);
    });
  } else {
    const step = dur > 120 ? 20 : dur > 40 ? 10 : dur > 15 ? 5 : 1;
    for (let t = 0; t < dur; t += step) {
      const x = Math.round((t / dur) * W);
      for (let y = 0; y < H; y += 2) blend(img, x, y, [255, 255, 255], 0.14);
      drawText(img, x + 3, waveH + 4, t + 's', [255, 255, 255], 2);
    }
  }
  return {
    image: img,
    layout: {
      width: W, height: H, waveform: { y0: 0, y1: waveH, note: 'mid channel, light core = RMS, red = clipping' },
      spectrogram: { y0: waveH + 2, y1: H, freqAxis: 'log', fMinHz: fMin, fMaxHz: Math.round(fMax), labelledLinesHz: [100, 1000, 10000], dynamicRangeDb: range },
      timeAxis: o.barTimes?.length ? 'x = time, vertical lines are bar starts, digits are bar numbers (every 4th line brighter)' : 'x = time in seconds, labels in seconds',
      durationSec: +dur.toFixed(2),
    },
  };
}
