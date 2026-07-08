/**
 * 로봇 매수봇 엔진. docs/robot-buyer-bot-reference.md 에 정리한 원본(React `useBotEngine`) 설계를
 * 게임 아키텍처로 이식 — React state 대신 싱글턴 + `bus` 이벤트로 UI(botDock.ts)에 통지한다.
 *
 * 1초 tick 루프: KST 09:00~09:30(평일, 또는 수동 스캔 5분) 스캔 창 동안 급등 코인을 탐지해
 * 대기 중인 봇에게 배정 → 봇당 예산(기본 1만원) 시장가 매수 → +3% 익절 / -2% 손절 자동 매도.
 * 봇은 플레이어가 들고 다니는 돈(carried)과 무관하게 독립적으로 동작한다.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fetchAccounts, placeOrder } from "../api/upbit";
import { isTauri } from "../core/platform";
import { bus, EV } from "../game/events";
import { store } from "../game/state";
import { investment } from "../systems/InvestmentSystem";
import { scoreSurgeCandidates } from "./surge";
import {
  DEFAULT_BOT_ENGINE_CONFIG,
  type BotEngineConfig,
  type TradeBot,
  type TradeVolumeSnapshot,
} from "./types";

const TICK_MS = 1000;
const HISTORY_WINDOW_MS = 60_000; // 롤링 체결 이력 60초
const SURGE_SCAN_INTERVAL_MS = 3000; // 급등 점수화 주기
const MANUAL_SCAN_DURATION_MS = 5 * 60_000; // 수동 스캔 창 5분
const SOLD_COOLDOWN_MS = 10_000; // 매도 후 idle 복귀 쿨다운
const ERROR_RECOVER_MS = 30_000; // 에러 후 idle 복귀
const SCORE_THRESHOLD = 25; // 배정 최소 점수(0~100)
const FILL_POLL_TRIES = 5; // 실거래 체결 수량 확인 재시도
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul UTC+9 (DST 없음)

const ROSTER_KEY = "coin_office_bots_roster";
const ENABLED_KEY = "coin_office_bots_enabled";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RosterEntry {
  id: string;
  name: string;
}

type KstParts = { weekday: number; hour: number; minute: number; minutesOfDay: number };

/** now(ms, UTC epoch) → KST 시각 구성요소. weekday: 0(일)~6(토) */
function kstPartsOf(now: number): KstParts {
  const d = new Date(now + KST_OFFSET_MS);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return { weekday: d.getUTCDay(), hour, minute, minutesOfDay: hour * 60 + minute };
}

/** 평일 KST 스캔 창(기본 09:00~09:30) 내부인지 */
function isWithinDailyScanWindow(config: BotEngineConfig, now: number): boolean {
  const { weekday, minutesOfDay } = kstPartsOf(now);
  if (weekday === 0 || weekday === 6) return false; // 주말 제외
  const start = config.scanWindow.startHourKst * 60 + config.scanWindow.startMinute;
  const end = start + config.scanWindow.durationMinutes;
  return minutesOfDay >= start && minutesOfDay < end;
}

function loadRoster(): RosterEntry[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RosterEntry =>
        !!e && typeof e === "object" && typeof (e as RosterEntry).id === "string" && typeof (e as RosterEntry).name === "string"
    );
  } catch {
    return [];
  }
}

function saveRoster(bots: TradeBot[]): void {
  try {
    const roster: RosterEntry[] = bots.map((b) => ({ id: b.id, name: b.name }));
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    // localStorage 불가 환경은 조용히 무시
  }
}

function makeBot(id: string, name: string): TradeBot {
  return {
    id,
    name,
    state: "idle",
    targetMarket: null,
    targetNameKo: null,
    entryPrice: null,
    volume: null,
    investedKrw: 0,
    currentPnlRate: null,
    lastMessage: "대기 중",
    lastActionAt: null,
    realizedPnlKrw: 0,
    tradesDone: 0,
  };
}

function nextBotName(bots: TradeBot[]): string {
  let max = 0;
  for (const b of bots) {
    const m = /^로봇-(\d+)$/.exec(b.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `로봇-${max + 1}`;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class BotEngine {
  private bots: TradeBot[] = loadRoster().map((r) => makeBot(r.id, r.name));
  private config: BotEngineConfig = DEFAULT_BOT_ENGINE_CONFIG;
  private enabled = localStorage.getItem(ENABLED_KEY) === "1";
  private scanActive = false;
  private lastScanAt: number | null = null;
  private manualScanUntil: number | null = null;
  private lastSurgeScan = 0;
  private inFlight = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickRunning = false;

  // Tauri 전용 — 체결 스트림으로 급등 가속도/매수비중 계산용 롤링 이력을 만든다.
  // 스트림이 없으면(브라우저) 이력이 비어 있고, surge.ts가 자동으로 중립값을 반환한다.
  private latestSnapshots: Record<string, TradeVolumeSnapshot> = {};
  private history: Record<string, TradeVolumeSnapshot[]> = {};
  private tradeStreamStarted = false;
  private unlistenSnapshot: UnlistenFn | null = null;

  /** 앱 시작 시 1회 호출 — 저장된 봇 명단을 복원하고, 켜져 있었다면 루프를 재개한다 */
  start(): void {
    if (this.bots.length > 0) {
      bus.emit(EV.TOAST, "저장된 매수봇 명단을 불러왔어요. 보유 포지션은 초기화됩니다.", "info");
    }
    this.notify();
    if (this.enabled) this.runLoop(true);
  }

  getBots(): TradeBot[] {
    return this.bots;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getScanActive(): boolean {
    return this.scanActive;
  }

  getLastScanAt(): number | null {
    return this.lastScanAt;
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
    this.runLoop(on);
    this.notify();
  }

  addBot(): void {
    this.bots = [...this.bots, makeBot(uid(), nextBotName(this.bots))];
    saveRoster(this.bots);
    this.notify();
  }

  removeBot(id: string): void {
    this.inFlight.delete(id);
    this.bots = this.bots.filter((b) => b.id !== id);
    saveRoster(this.bots);
    this.notify();
  }

  clearFinishedBots(): void {
    const finished = new Set(["idle", "sold_profit", "sold_loss", "error"]);
    this.bots = this.bots.filter((b) => !finished.has(b.state));
    saveRoster(this.bots);
    this.notify();
  }

  /** 수동 스캔 창을 5분간 강제로 연다 (자동 09:00 창을 기다리지 않고 즉시 테스트/실행) */
  triggerScanNow(): void {
    const now = Date.now();
    this.manualScanUntil = now + MANUAL_SCAN_DURATION_MS;
    this.lastSurgeScan = 0; // 즉시 스캔 허용
    this.scanActive = true;
    this.lastScanAt = now;
    bus.emit(EV.TOAST, "수동 스캔 창을 5분간 열었어요", "info");
    this.notify();
  }

  // ---------- 내부 ----------

  private runLoop(on: boolean): void {
    if (on) {
      if (this.tickTimer) return;
      void this.ensureTradeStream();
      this.tickTimer = setInterval(() => {
        if (this.tickRunning) return;
        this.tickRunning = true;
        try {
          this.runTick();
        } finally {
          this.tickRunning = false;
        }
      }, TICK_MS);
    } else if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.teardownTradeStream();
    }
  }

  /** Tauri 전용 — 전체 KRW 마켓 체결 스트림 구독 시작(가속도/매수비중 정밀도용, 실패해도 등락률/z-score만으로 계속 동작) */
  private async ensureTradeStream(): Promise<void> {
    if (!isTauri() || this.tradeStreamStarted) return;
    const markets = investment.getMarkets().map((m) => m.market);
    if (markets.length === 0) return; // 아직 마켓 목록 로드 전 — 다음 tick에서 재시도
    try {
      this.unlistenSnapshot = await listen<TradeVolumeSnapshot[]>("trade-volume-snapshot", (event) => {
        for (const snap of event.payload) this.latestSnapshots[snap.market] = snap;
      });
      await invoke("start_trade_volume_stream", { markets });
      this.tradeStreamStarted = true;
    } catch {
      // 스트림 연결 실패 — 조용히 포기, 등락률/z-score만으로 계속 동작
    }
  }

  private teardownTradeStream(): void {
    this.unlistenSnapshot?.();
    this.unlistenSnapshot = null;
    this.tradeStreamStarted = false;
    if (isTauri()) void invoke("stop_trade_volume_stream").catch(() => {});
  }

  private notify(): void {
    bus.emit(EV.BOTS_CHANGED, this.bots, {
      enabled: this.enabled,
      scanActive: this.scanActive,
      lastScanAt: this.lastScanAt,
    });
  }

  private patchBot(id: string, patch: Partial<TradeBot>): void {
    this.bots = this.bots.map((b) => (b.id === id ? { ...b, ...patch } : b));
    saveRoster(this.bots);
    this.notify();
  }

  private getCurrentPrice(market: string): number | null {
    const snap = this.latestSnapshots[market];
    if (snap && snap.last_trade_price > 0) return snap.last_trade_price;
    return investment.getTicker(market)?.price ?? null;
  }

  private updateHistory(now: number): void {
    for (const market of Object.keys(this.latestSnapshots)) {
      const snap = this.latestSnapshots[market];
      const list = this.history[market] ?? [];
      list.push({ ...snap, last_trade_timestamp: now });
      const cutoff = now - HISTORY_WINDOW_MS;
      while (list.length > 0 && (list[0].last_trade_timestamp ?? 0) < cutoff) list.shift();
      this.history[market] = list;
    }
  }

  private executeBuy(botId: string, market: string, nameKo: string | null): void {
    if (this.inFlight.has(botId)) return;
    this.inFlight.add(botId);
    const bot = this.bots.find((b) => b.id === botId);
    if (!bot) {
      this.inFlight.delete(botId);
      return;
    }

    if (store.mode === "real" && !store.connected) {
      this.patchBot(botId, { state: "scanning", lastMessage: "키 미연동으로 대기" });
      this.inFlight.delete(botId);
      return;
    }

    this.patchBot(botId, {
      state: "buying",
      targetMarket: market,
      targetNameKo: nameKo,
      lastMessage: `${market} 매수 시도...`,
      lastActionAt: Date.now(),
    });

    void (async () => {
      try {
        let entryPrice: number | null = null;
        let volume: number | null = null;

        if (store.mode === "sim") {
          const price = this.getCurrentPrice(market);
          if (price && price > 0) {
            entryPrice = price;
            volume = (this.config.budgetKrw * (1 - this.config.feeRate)) / price;
          }
        } else {
          await placeOrder({ market, side: "bid", ord_type: "price", price: String(this.config.budgetKrw) }, false);
          const currency = market.replace("KRW-", "");
          for (let i = 0; i < FILL_POLL_TRIES; i += 1) {
            await sleep(1000);
            try {
              const accounts = await fetchAccounts();
              const acc = accounts.find((a) => a.currency === currency);
              if (acc && acc.balance > 0) {
                entryPrice = acc.avgBuyPrice || this.getCurrentPrice(market) || 0;
                volume = acc.balance;
                break;
              }
            } catch {
              // 재시도
            }
          }
        }

        if (!entryPrice || !volume || entryPrice <= 0 || volume <= 0) {
          this.patchBot(botId, { state: "error", lastMessage: "체결 수량 확인 실패", lastActionAt: Date.now() });
          bus.emit(EV.TOAST, `🤖 ${bot.name}: ${market} 체결 수량 확인 실패`, "bad");
          return;
        }

        this.patchBot(botId, {
          state: "holding",
          targetMarket: market,
          targetNameKo: nameKo,
          entryPrice,
          volume,
          investedKrw: this.config.budgetKrw,
          currentPnlRate: 0,
          lastMessage: `${nameKo ?? market} 매수!`,
          lastActionAt: Date.now(),
        });
        bus.emit(EV.TOAST, `🤖 ${bot.name} → ${nameKo ?? market} ${store.mode === "sim" ? "[모의] " : ""}매수`, "good");
      } catch (err) {
        this.patchBot(botId, { state: "error", lastMessage: `매수 오류: ${String(err)}`, lastActionAt: Date.now() });
        bus.emit(EV.TOAST, `🤖 ${bot.name}: 매수 오류`, "bad");
      } finally {
        this.inFlight.delete(botId);
      }
    })();
  }

  private executeSell(bot: TradeBot, reason: "profit" | "loss", pnlRate: number): void {
    const botId = bot.id;
    if (this.inFlight.has(botId)) return;
    const market = bot.targetMarket;
    const volume = bot.volume;
    const entryPrice = bot.entryPrice;
    if (!market || !volume || !entryPrice) return;

    this.inFlight.add(botId);
    this.patchBot(botId, {
      state: "selling",
      lastMessage: reason === "profit" ? "익절 매도 중..." : "손절 매도 중...",
      lastActionAt: Date.now(),
    });

    void (async () => {
      try {
        if (store.mode === "real") {
          await placeOrder({ market, side: "ask", ord_type: "market", volume: String(volume) }, false);
        }

        const currentPrice = this.getCurrentPrice(market) ?? entryPrice * (1 + pnlRate);
        const proceeds = currentPrice * volume * (1 - this.config.feeRate);
        const cost = entryPrice * volume * (1 + this.config.feeRate);
        const realized = proceeds - cost;

        this.patchBot(botId, {
          state: reason === "profit" ? "sold_profit" : "sold_loss",
          currentPnlRate: pnlRate,
          realizedPnlKrw: bot.realizedPnlKrw + realized,
          tradesDone: bot.tradesDone + 1,
          lastMessage: `${pnlRate >= 0 ? "+" : ""}${(pnlRate * 100).toFixed(1)}% ${reason === "profit" ? "익절!" : "손절!"}`,
          lastActionAt: Date.now(),
        });
        bus.emit(
          EV.TOAST,
          `🤖 ${bot.name} ${bot.targetNameKo ?? market} ${reason === "profit" ? "✨ 익절" : "💥 손절"} (${(pnlRate * 100).toFixed(1)}%)`,
          reason === "profit" ? "good" : "bad"
        );
      } catch (err) {
        this.patchBot(botId, { state: "error", lastMessage: `매도 오류: ${String(err)}`, lastActionAt: Date.now() });
        bus.emit(EV.TOAST, `🤖 ${bot.name}: 매도 오류`, "bad");
      } finally {
        this.inFlight.delete(botId);
      }
    })();
  }

  private runTick(): void {
    const now = Date.now();
    const manualActive = this.manualScanUntil !== null && now < this.manualScanUntil;
    const active = manualActive || isWithinDailyScanWindow(this.config, now);
    this.scanActive = active;
    if (active) this.lastScanAt = now;

    if (isTauri() && !this.tradeStreamStarted) void this.ensureTradeStream();
    this.updateHistory(now);

    const current = this.bots;
    let changed = false;

    const nextBots = current.map((bot) => {
      switch (bot.state) {
        case "idle":
          if (active) {
            changed = true;
            return { ...bot, state: "scanning" as const, lastMessage: "급등 코인 탐색 중..." };
          }
          return bot;
        case "scanning":
          if (!active) {
            changed = true;
            return { ...bot, state: "idle" as const, lastMessage: "대기 중" };
          }
          return bot;
        case "holding": {
          if (!bot.entryPrice || !bot.targetMarket) return bot;
          const price = this.getCurrentPrice(bot.targetMarket);
          if (!price) return bot;
          const pnl = (price * (1 - this.config.feeRate) - bot.entryPrice * (1 + this.config.feeRate)) / bot.entryPrice;
          changed = true;
          return { ...bot, currentPnlRate: pnl };
        }
        case "sold_profit":
        case "sold_loss":
          if (bot.lastActionAt && now - bot.lastActionAt >= SOLD_COOLDOWN_MS) {
            changed = true;
            return {
              ...bot,
              state: "idle" as const,
              targetMarket: null,
              targetNameKo: null,
              entryPrice: null,
              volume: null,
              investedKrw: 0,
              currentPnlRate: null,
              lastMessage: "대기 중",
            };
          }
          return bot;
        case "error":
          if (bot.lastActionAt && now - bot.lastActionAt >= ERROR_RECOVER_MS) {
            changed = true;
            return {
              ...bot,
              state: "idle" as const,
              targetMarket: null,
              targetNameKo: null,
              entryPrice: null,
              volume: null,
              investedKrw: 0,
              currentPnlRate: null,
              lastMessage: "복구, 대기 중",
            };
          }
          return bot;
        default:
          return bot;
      }
    });

    if (changed) {
      this.bots = nextBots;
      saveRoster(this.bots);
    }

    // 보유 봇 익절/손절 판정
    for (const bot of this.bots) {
      if (bot.state !== "holding" || !bot.entryPrice || !bot.targetMarket) continue;
      if (this.inFlight.has(bot.id)) continue;
      const price = this.getCurrentPrice(bot.targetMarket);
      if (!price) continue;
      const pnl = (price * (1 - this.config.feeRate) - bot.entryPrice * (1 + this.config.feeRate)) / bot.entryPrice;
      if (pnl >= this.config.takeProfitRate) this.executeSell(bot, "profit", pnl);
      else if (pnl <= -this.config.stopLossRate) this.executeSell(bot, "loss", pnl);
    }

    // 급등 스캔 + 배정(3초 주기)
    if (active && now - this.lastSurgeScan >= SURGE_SCAN_INTERVAL_MS) {
      this.lastSurgeScan = now;
      const tickers = Array.from(investment.getMarkets().map((m) => investment.getTicker(m.market)).filter((t): t is NonNullable<typeof t> => !!t));

      const assigned = new Set<string>();
      for (const bot of this.bots) {
        if (bot.targetMarket && bot.state !== "idle" && bot.state !== "scanning") assigned.add(bot.targetMarket);
      }

      const candidates = scoreSurgeCandidates({
        tickers,
        tradeVolumeHistory: this.history,
        config: this.config,
        excludeMarkets: assigned,
        now,
      });

      const availableBots = this.bots.filter(
        (b) => (b.state === "scanning" || b.state === "idle") && !b.targetMarket && !this.inFlight.has(b.id)
      );

      let ci = 0;
      for (const bot of availableBots) {
        while (ci < candidates.length && assigned.has(candidates[ci].market)) ci += 1;
        if (ci >= candidates.length) break;
        const cand = candidates[ci];
        if (cand.score < SCORE_THRESHOLD) break; // 정렬되어 있으므로 이하도 미달
        assigned.add(cand.market);
        ci += 1;
        const coin = investment.getMarkets().find((m) => m.market === cand.market);
        this.patchBot(bot.id, {
          state: "targeting",
          targetMarket: cand.market,
          targetNameKo: coin?.nameKo ?? null,
          lastMessage: `${coin?.nameKo ?? cand.market} 조준! (${cand.reasons[0]})`,
        });
        this.executeBuy(bot.id, cand.market, coin?.nameKo ?? null);
      }
    }

    if (changed) this.notify();
  }
}

export const botEngine = new BotEngine();
