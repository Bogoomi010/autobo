/** 절차적 효과음 (WebAudio) — 에셋 없이 오실레이터로 생성 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastShoot = 0;
  private lastHover = 0;
  private lastBotHover = 0;
  private lastFootLeft = true;

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

  /** 버튼/카드 마우스 호버 — 짧고 여린 블립 (연속 호버 시 과다 재생 방지) */
  hover(): void {
    const now = performance.now();
    if (now - this.lastHover < 60) return;
    this.lastHover = now;
    this.tone(1180, 0.035, "sine", 0.05, 1500);
  }

  /** 매수봇 로봇 마우스 호버 — "삐-빅" 2음 스캔음 (연속 호버 시 과다 재생 방지) */
  botHover(): void {
    const now = performance.now();
    if (now - this.lastBotHover < 90) return;
    this.lastBotHover = now;
    this.tone(1600, 0.025, "square", 0.05, 1750);
    this.tone(1250, 0.03, "square", 0.05, 1150, 0.03);
  }

  /** 매수봇 로봇에서 마우스가 빠져나갈 때 — 낮고 짧은 단음(호버음의 꼬리 느낌) */
  botHoverOut(): void {
    this.tone(950, 0.028, "square", 0.035, 650);
  }

  /** 매수봇 로봇 클릭(상세 패널 열기) — 호버음보다 낮고 또렷한 확인 블립 */
  botClick(): void {
    this.tone(1050, 0.04, "square", 0.07, 800);
    this.tone(1500, 0.045, "square", 0.08, 1750, 0.045);
  }

  /** 걸음걸이 발소리 — 좌우 번갈아 살짝 다른 피치로 자연스러움을 준다 */
  step(): void {
    this.lastFootLeft = !this.lastFootLeft;
    this.tone(this.lastFootLeft ? 95 : 80, 0.05, "square", 0.05, 55);
  }

  /** 월드 상호작용으로 메뉴/모달이 열릴 때(금고 출금, 코인 단말기, 시세판 등) */
  select(): void {
    this.tone(740, 0.05, "square", 0.12, 1040);
  }

  /** 상호작용 조건 미충족(돈이 없어 투자 불가 등) — 짧은 거부음 */
  denied(): void {
    this.tone(180, 0.09, "square", 0.14, 120);
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
