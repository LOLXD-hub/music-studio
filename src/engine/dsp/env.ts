const IDLE = 0;
const ATTACK = 1;
const DECAY = 2;
const SUSTAIN = 3;
const RELEASE = 4;

/** Exponential ADSR. Attack aims past 1.0 so it reaches the peak in finite time like an analog circuit. */
export class ADSR {
  level = 0;
  private stage = IDLE;
  private aCoef = 0;
  private dCoef = 0;
  private rCoef = 0;
  private sustain = 0.7;
  private sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.setTimes(0.005, 0.2, 0.7, 0.2);
  }

  private coef(sec: number): number {
    return 1 - Math.exp(-1 / Math.max(1, sec * this.sampleRate));
  }

  /** Times are the time constants in seconds; sustain is 0..1. */
  setTimes(attack: number, decay: number, sustain: number, release: number): void {
    this.aCoef = this.coef(attack * 0.35);
    this.dCoef = this.coef(decay * 0.3);
    this.rCoef = this.coef(release * 0.3);
    this.sustain = sustain;
  }

  gateOn(retrigger = true): void {
    if (retrigger && this.stage === IDLE) this.level = 0;
    this.stage = ATTACK;
  }

  gateOff(): void {
    if (this.stage !== IDLE) this.stage = RELEASE;
  }

  /** Fast release, used for voice stealing. */
  kill(): void {
    this.stage = RELEASE;
    this.rCoef = this.coef(0.004);
  }

  get idle(): boolean {
    return this.stage === IDLE;
  }

  get releasing(): boolean {
    return this.stage === RELEASE;
  }

  tick(): number {
    switch (this.stage) {
      case ATTACK:
        this.level += (1.25 - this.level) * this.aCoef;
        if (this.level >= 1) {
          this.level = 1;
          this.stage = DECAY;
        }
        break;
      case DECAY:
        this.level += (this.sustain - this.level) * this.dCoef;
        if (Math.abs(this.level - this.sustain) < 1e-4) {
          this.level = this.sustain;
          this.stage = SUSTAIN;
        }
        break;
      case SUSTAIN:
        this.level = this.sustain;
        break;
      case RELEASE:
        this.level -= this.level * this.rCoef;
        if (this.level < 1e-5) {
          this.level = 0;
          this.stage = IDLE;
        }
        break;
      default:
        this.level = 0;
    }
    return this.level;
  }

  reset(): void {
    this.level = 0;
    this.stage = IDLE;
  }
}

/** Linear segment envelope: used for pitch sweeps and short transients. */
export class Ramp {
  value = 0;
  private step = 0;
  private remaining = 0;
  start(from: number, to: number, samples: number): void {
    this.value = from;
    this.remaining = Math.max(1, samples);
    this.step = (to - from) / this.remaining;
  }
  tick(): number {
    if (this.remaining > 0) {
      this.value += this.step;
      this.remaining--;
    }
    return this.value;
  }
}

/** Exponential decay to zero, used by percussive sources. */
export class Decay {
  level = 0;
  private coef = 0;
  trigger(amount: number, seconds: number, sampleRate: number): void {
    this.level = amount;
    // reaches roughly -60 dB after `seconds`
    this.coef = Math.exp(Math.log(0.001) / Math.max(1, seconds * sampleRate));
  }
  tick(): number {
    const v = this.level;
    this.level *= this.coef;
    if (this.level < 1e-6) this.level = 0;
    return v;
  }
  get active(): boolean {
    return this.level > 1e-6;
  }
}
