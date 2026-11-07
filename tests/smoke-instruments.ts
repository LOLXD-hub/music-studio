import { INSTRUMENT_DEFS, createInstrument } from '../src/engine/instruments/index.ts';
import { FX_DEFS, createFx } from '../src/engine/fx/index.ts';

const SR = 44100;

function detectPitch(x: Float32Array, sr: number, fmin = 30, fmax = 2000): number {
  // normalized autocorrelation on a window from the sustained part
  const n = Math.min(x.length, 8192);
  const lagMin = Math.floor(sr / fmax);
  const lagMax = Math.floor(sr / fmin);
  let best = 0;
  let bestLag = 0;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[i] * x[i];
  if (e0 < 1e-9) return 0;
  for (let lag = lagMin; lag <= lagMax && lag < n - 1; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += x[i] * x[i + lag];
    const c = s / e0;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return bestLag ? sr / bestLag : 0;
}

function stats(L: Float32Array, R: Float32Array, from = 0, to = L.length) {
  let peak = 0;
  let sum = 0;
  let bad = 0;
  for (let i = from; i < to; i++) {
    const a = L[i];
    const b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) bad++;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    sum += a * a + b * b;
  }
  return { peak, rms: Math.sqrt(sum / (2 * (to - from))), bad };
}

const db = (x: number) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);

console.log('=== instruments ===');
for (const def of INSTRUMENT_DEFS) {
  if (def.type === 'sampler') continue;
  const presets = Object.keys(def.presets);
  for (const name of presets) {
    const inst = createInstrument(def.type, SR, 1, name);
    if (!inst) throw new Error('missing ' + def.type);
    const isDrum = def.type === 'drums';
    const pitch = isDrum ? 38 : def.type === 'plucked' && /bass/i.test(name) ? 40 : 60;
    const N = Math.floor(SR * 1.5);
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    const t0 = performance.now();
    inst.noteOn(pitch, 100);
    const noteLen = Math.floor(SR * 1.0);
    const blk = 128;
    let off = false;
    for (let i = 0; i < N; i += blk) {
      if (!off && i >= noteLen) {
        inst.noteOff(pitch);
        off = true;
      }
      const e = Math.min(N, i + blk);
      inst.process(L.subarray(i, e), R.subarray(i, e), 0, e - i);
    }
    const ms = performance.now() - t0;
    const st = stats(L, R);
    const seg = L.subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.15) + 8192);
    const f = isDrum ? 0 : detectPitch(seg, SR);
    const expect = 440 * Math.pow(2, (pitch - 69) / 12);
    const tail = stats(L, R, N - 2000, N);
    console.log(
      `${def.type.padEnd(11)} ${name.padEnd(28)} peak ${db(st.peak).padStart(6)} dB  rms ${db(st.rms).padStart(6)} dB  ` +
        `f0 ${f ? f.toFixed(1).padStart(7) : '    n/a'} (want ${isDrum ? 'n/a' : expect.toFixed(1)})  tail ${db(tail.peak).padStart(7)} dB  voices ${inst.activeVoices()}  ${ms.toFixed(0)}ms${st.bad ? '  NaN!! ' + st.bad : ''}`,
    );
  }
}

console.log('\n=== fx (white-noise burst through each default + presets) ===');
for (const def of FX_DEFS) {
  const names = ['(default)', ...Object.keys(def.presets ?? {})];
  for (const name of names) {
    const fx = createFx(def.type, SR, name === '(default)' ? {} : (def.presets![name] as Record<string, number>));
    if (!fx) throw new Error('missing fx ' + def.type);
    const N = SR * 2;
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    let seed = 1;
    for (let i = 0; i < SR * 0.5; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const sine = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.3;
      L[i] = sine + ((seed / 4294967296) * 2 - 1) * 0.1;
      R[i] = sine * 0.9;
    }
    const inStats = stats(L, R, 0, SR * 0.5);
    const t0 = performance.now();
    for (let i = 0; i < N; i += 128) {
      const e = Math.min(N, i + 128);
      fx.process(L.subarray(i, e), R.subarray(i, e), 0, e - i);
    }
    const ms = performance.now() - t0;
    const st = stats(L, R, 0, SR * 0.5);
    const tail = stats(L, R, N - 4000, N);
    console.log(
      `${def.type.padEnd(11)} ${name.padEnd(24)} in ${db(inStats.rms).padStart(6)} dB -> out rms ${db(st.rms).padStart(6)} peak ${db(st.peak).padStart(6)}  tail ${db(tail.peak).padStart(7)} dB  ${ms.toFixed(0)}ms${st.bad || tail.bad ? '  NaN!!' : ''}`,
    );
  }
}
