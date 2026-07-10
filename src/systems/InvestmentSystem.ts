import { fetchAllKrwTickers, fetchMarkets } from "../api/upbit";
import { STOP_LOSS_RATE, TAKE_PROFIT_RATE, TICKER_POLL_MS } from "../game/config";
import { bus, EV } from "../game/events";
import { store } from "../game/state";
import type { CoinInfo, Ticker } from "../game/types";
import { backgroundTrading } from "../core/backgroundTrading";

/** 백오프 상한 (ms) */
const BACKOFF_MAX_MS = 60_000;

/**
 * 시세 폴링 + 자동 익절/손절 시스템.
 * - TICKER_POLL_MS 간격으로 전 KRW 마켓 시세 조회 (/v1/ticker/all 1회 호출)
 * - 포지션 수익률이 ±3% 도달 시 store.closePosition 호출
 *   (실거래 모드에선 실제 시장가 매도 — status 가드로 중복 주문 방지)
 * - API 실패 시 지수 백오프 + EV.API_STATUS 방송
 */
class InvestmentSystem {
  private markets: CoinInfo[] = [];
  private tickers = new Map<string, Ticker>();
  private apiOk = false;
  private backoffStep = 0;
  private started = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollRunning = false;
  private lastPollStartedAt = 0;

  start(): void {
    if (this.started) return;
    this.started = true;
    backgroundTrading.subscribe((now) => {
      if (this.markets.length === 0 || this.pollRunning || now - this.lastPollStartedAt < TICKER_POLL_MS) return;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = null;
      void this.poll();
    });
    void this.bootstrap();
  }

  /** 캐시된 KRW 마켓 목록 (로드 전이면 빈 배열) */
  getMarkets(): CoinInfo[] {
    return this.markets;
  }

  /** 캐시된 최신 시세 */
  getTicker(market: string): Ticker | undefined {
    return this.tickers.get(market);
  }

  /** 마켓 목록 로드 (실패 시 재시도) → 폴링 루프 시작 */
  private async bootstrap(): Promise<void> {
    try {
      this.markets = await fetchMarkets();
      store.setCoinCatalog(this.markets);
      this.setApiStatus(true);
      this.scheduleNext(0);
    } catch {
      this.setApiStatus(false);
      setTimeout(() => void this.bootstrap(), this.nextBackoff());
    }
  }

  /** 다음 폴링 예약 (setTimeout 재귀 — 요청이 겹치지 않게) */
  private scheduleNext(delay: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (this.pollRunning) return;
    this.pollRunning = true;
    this.lastPollStartedAt = Date.now();
    try {
      const tickers = await fetchAllKrwTickers();
      const map = new Map<string, Ticker>();
      for (const t of tickers) map.set(t.market, t);
      this.tickers = map;

      this.setApiStatus(true);
      this.backoffStep = 0;

      bus.emit(EV.TICKERS, map);
      this.runAutoTrade(map);

      this.scheduleNext(TICKER_POLL_MS);
    } catch {
      this.setApiStatus(false);
      this.scheduleNext(this.nextBackoff());
    } finally {
      this.pollRunning = false;
    }
  }

  /** 포지션 순회하며 ±목표 도달 시 자동 청산 (비동기 — status 가드가 중복을 막는다) */
  private runAutoTrade(map: Map<string, Ticker>): void {
    for (const pos of [...store.positions]) {
      if (pos.status !== "open") continue;
      const t = map.get(pos.market);
      if (!t || pos.entryPrice <= 0) continue;
      const rate = t.price / pos.entryPrice - 1;
      if (rate >= TAKE_PROFIT_RATE) {
        void store.closePosition(pos.id, "take-profit", t.price);
      } else if (rate <= STOP_LOSS_RATE) {
        void store.closePosition(pos.id, "stop-loss", t.price);
      }
    }
  }

  /** 지수 백오프 지연 계산 (3s → 6s → 12s → ... 최대 60s) */
  private nextBackoff(): number {
    const delay = Math.min(TICKER_POLL_MS * 2 ** this.backoffStep, BACKOFF_MAX_MS);
    this.backoffStep++;
    return delay;
  }

  /** API 상태 변화 시에만 방송 (중복 방송 방지) */
  private setApiStatus(ok: boolean): void {
    if (this.apiOk === ok) return;
    this.apiOk = ok;
    bus.emit(EV.API_STATUS, ok);
  }
}

export const investment = new InvestmentSystem();
