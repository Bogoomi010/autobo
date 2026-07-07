/** 절차적 효과음 (WebAudio) — 에셋 없이 오실레이터로 생성 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastShoot = 0;

  /** 최초 사용자 입력 후 호출 (브라우저 오디오 정책) */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = 0.36 * Math.max(0, Math.min(1, v));
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) {
      o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shoot(): void {
    const now = performance.now();
    if (now - this.lastShoot < 70) return; // 과도한 연타 방지
    this.lastShoot = now;
    this.tone(880, 0.045, "square", 0.07, 440);
  }

  kill(): void {
    this.tone(330, 0.09, "triangle", 0.18, 660);
  }

  gacha(): void {
    this.tone(523, 0.09, "sine", 0.22, 784);
  }

  /** 합성/조합/카드 획득 */
  power(): void {
    this.tone(392, 0.2, "sawtooth", 0.2, 1046);
  }

  alarm(): void {
    this.tone(160, 0.28, "square", 0.22, 120);
    this.tone(160, 0.28, "square", 0.22, 120, 0.34);
  }

  card(): void {
    this.tone(659, 0.12, "sine", 0.2, 880);
  }

  win(): void {
    this.tone(523, 0.16, "triangle", 0.25);
    this.tone(659, 0.16, "triangle", 0.25, undefined, 0.16);
    this.tone(784, 0.3, "triangle", 0.25, undefined, 0.32);
  }

  lose(): void {
    this.tone(220, 0.6, "sawtooth", 0.22, 70);
  }
}

export const sfx = new Sfx();
