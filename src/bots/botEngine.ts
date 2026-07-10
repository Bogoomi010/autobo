/**
 * 로봇 매수봇 엔진. docs/robot-buyer-bot-reference.md 에 정리한 원본(React `useBotEngine`) 설계를
 * 게임 아키텍처로 이식 — React state 대신 싱글턴 + `bus` 이벤트로 UI(botDock.ts)에 통지한다.
 *
 * 1초 tick 루프: 봇 생성 시점부터 사용자가 고른 시간 동안(또는 수동 스캔 5분) 급등 코인을 탐지해
 * 대기 중인 봇에게 배정 → 봇당 예산(기본 6천원) 시장가 매수 → 익절/손절 자동 매도.
 *
 * 단타봇/장투봇은 매도 알고리즘 자체는 같고(고정 익절/손절 + 붕괴 스코어 조기매도),
 * "매도를 허용하는 시점"만 다르다.
 * - 단타봇: 세션(스캔 창) 시간 안에서만 매도 판정을 하며, 세션이 끝나면 보유 중이어도 강제 매도한다.
 * - 장투봇: 손절은 보유시간과 무관하게 즉시 적용하고, 익절/반전 판정은 24시간 뒤 열며 최대 보유기간에는 강제 청산한다.
 * 각자의 조건을 통과한 뒤부터는 동일하게 고정 익절을 확인하고, 그 사이 구간에서는
 * 붕괴 스코어(진입 스코어의 반전판 — 고점 대비 되돌림/체결대금 감속/매도 우위 전환)가 임계값을
 * 넘으면 조기 매도한다.
 * 봇은 플레이어가 들고 다니는 돈(carried)과 무관하게 독립적으로 동작한다.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fetchAccounts, placeOrder } from "../api/upbit";
import { isTauri } from "../core/platform";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";
import { store } from "../game/state";
import { investment } from "../systems/InvestmentSystem";
import { COLLAPSE_THRESHOLD, scoreCollapse, scoreSurgeCandidates } from "./surge";
import { decideLongtermExit } from "./exitPolicy";
import {
  BOT_MAX_LONGTERM_DURATION_MINUTES,
  BOT_MAX_BUDGET_KRW,
  BOT_MIN_BUDGET_KRW,
  BOT_MIN_LONGTERM_DURATION_MINUTES,
  BOT_TYPE_LABEL,
  DEFAULT_BOT_ENGINE_CONFIG,
  DEFAULT_BOT_SETTINGS,
  type BotEngineConfig,
  type BotLogEntry,
  type BotMarketLogEntry,
  type BotSettings,
  type BotTradeLogEntry,
  type BotType,
  type ScanWindowConfig,
  type TradeBot,
  type TradeVolumeSnapshot,
} from "./types";

const TICK_MS = 1000;
// 월드 매수봇 상세 패널에 보여줄 인메모리 활동 로그 — CSV(§6)와 별개로 최근 N건만 유지한다
const BOT_LOG_MAX = 30;
const HISTORY_WINDOW_MS = 60_000; // 롤링 체결 이력 60초
const SURGE_SCAN_INTERVAL_MS = 3000; // 급등 점수화 주기
const MANUAL_SCAN_DURATION_MS = 5 * 60_000; // 수동 스캔 창 5분
const SOLD_COOLDOWN_MS = 10_000; // 매도 후 idle 복귀 쿨다운
const ERROR_RECOVER_MS = 30_000; // 에러 후 idle 복귀
const SCORE_THRESHOLD = 25; // 배정 최소 점수(0~100)
const FILL_POLL_TRIES = 5; // 실거래 체결 수량 확인 재시도
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul UTC+9 (DST 없음)

// 보유 중 시장 스냅샷 로그 샘플링 주기 — 단타봇은 세션이 짧아 촘촘히, 장투봇은 장기 보유 가능성이 있어 느슨하게
const MARKET_LOG_INTERVAL_MS: Record<BotType, number> = {
  scalp: 5_000,
  longterm: 60_000,
};

const ROSTER_KEY = "coin_office_bots_roster";
const ENABLED_KEY = "coin_office_bots_enabled";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 명단과 함께 영속화하는 항목. 진입가/보유수량 같은 "지금 이 순간의 포지션"은 여전히
 * 영속화하지 않지만(재시작 시 실제 시세와 괴리될 위험), 누적 실현손익/거래 횟수/활동 로그는
 * "쌓이는 데이터"라 프로그램이 언제 꺼질지 몰라도 잃지 않도록 매 변경마다 같이 저장한다.
 */
interface RosterEntry {
  id: string;
  name: string;
  enabled: boolean;
  settings: BotSettings;
  realizedPnlKrw: number;
  tradesDone: number;
  logs: BotLogEntry[];
}

type KstParts = { weekday: number; hour: number; minute: number; minutesOfDay: number };

/** now(ms, UTC epoch) → KST 시각 구성요소. weekday: 0(일)~6(토) */
function kstPartsOf(now: number): KstParts {
  const d = new Date(now + KST_OFFSET_MS);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return { weekday: d.getUTCDay(), hour, minute, minutesOfDay: hour * 60 + minute };
}

/** now(ms, UTC epoch) → KST 날짜 키(YYYY-MM-DD) — 일일 손실 한도 리셋 기준 */
function kstDateKey(now: number): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 스캔 창(봇마다 설정 가능) 내부인지. 새 봇은 1회성 startAt/endAt, 구버전 봇은 KST 반복 창을 쓴다. */
function isWithinDailyScanWindow(scanWindow: ScanWindowConfig, now: number): boolean {
  if (typeof scanWindow.startAt === "number" && typeof scanWindow.endAt === "number") {
    return now >= scanWindow.startAt && now < scanWindow.endAt;
  }
  const { weekday, minutesOfDay } = kstPartsOf(now);
  if (weekday === 0 || weekday === 6) return false; // 주말 제외
  const start = scanWindow.startHourKst * 60 + scanWindow.startMinute;
  const end = start + scanWindow.durationMinutes;
  return minutesOfDay >= start && minutesOfDay < end;
}

/** 스캔 창이 끝나는 시각의 epoch ms — 단타봇의 세션 강제 마감 기준 */
function scanWindowEndMs(scanWindow: ScanWindowConfig, now: number): number {
  if (typeof scanWindow.endAt === "number") return scanWindow.endAt;
  const kst = new Date(now + KST_OFFSET_MS);
  const kstMidnightUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  const endMinutesOfDay = scanWindow.startHourKst * 60 + scanWindow.startMinute + scanWindow.durationMinutes;
  return kstMidnightUtcMs + endMinutesOfDay * 60_000;
}

function isValidSettings(value: unknown): value is BotSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as BotSettings;
  return (
    (s.botType === "scalp" || s.botType === "longterm") &&
    typeof s.budgetKrw === "number" &&
    typeof s.takeProfitRate === "number" &&
    typeof s.stopLossRate === "number" &&
    !!s.scanWindow &&
    typeof s.scanWindow.startHourKst === "number" &&
    typeof s.scanWindow.startMinute === "number" &&
    typeof s.scanWindow.durationMinutes === "number" &&
    (s.scanWindow.startAt === undefined || typeof s.scanWindow.startAt === "number") &&
    (s.scanWindow.endAt === undefined || typeof s.scanWindow.endAt === "number")
  );
}

/** 예산/기간 정책 적용 — 저장 데이터도 현재 실거래 최소액과 종류별 기간 범위에 맞춘다. */
function clampSettings(settings: BotSettings): BotSettings {
  const durationMinutes =
    settings.botType === "longterm"
      ? Math.max(BOT_MIN_LONGTERM_DURATION_MINUTES, Math.min(settings.scanWindow.durationMinutes, BOT_MAX_LONGTERM_DURATION_MINUTES))
      : Math.max(30, Math.min(settings.scanWindow.durationMinutes, 24 * 60));
  const startAt = settings.scanWindow.startAt;
  return {
    ...settings,
    budgetKrw: Math.max(BOT_MIN_BUDGET_KRW, Math.min(settings.budgetKrw, BOT_MAX_BUDGET_KRW)),
    scanWindow: {
      ...settings.scanWindow,
      durationMinutes,
      ...(typeof startAt === "number" ? { endAt: startAt + durationMinutes * 60_000 } : {}),
    },
  };
}

function isValidLogs(value: unknown): value is BotLogEntry[] {
  return (
    Array.isArray(value) &&
    value.every((v) => !!v && typeof v === "object" && typeof (v as BotLogEntry).at === "number" && typeof (v as BotLogEntry).message === "string")
  );
}

function loadRoster(): RosterEntry[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is { id: string; name: string; enabled?: unknown; settings?: unknown; realizedPnlKrw?: unknown; tradesDone?: unknown; logs?: unknown } =>
          !!e && typeof e === "object" && typeof (e as RosterEntry).id === "string" && typeof (e as RosterEntry).name === "string"
      )
      .map((e) => {
        const rawSettings = isValidSettings(e.settings) ? e.settings : DEFAULT_BOT_SETTINGS;
        const legacyUnderMinimum = rawSettings.budgetKrw < BOT_MIN_BUDGET_KRW;
        const logs = isValidLogs(e.logs) ? e.logs : [];
        return {
          id: e.id,
          name: e.name,
          // 기존 6천원 미만 봇은 주문액을 자동 증액한 채 바로 실행하지 않도록 안전하게 일시정지한다.
          enabled: legacyUnderMinimum ? false : typeof e.enabled === "boolean" ? e.enabled : true,
          settings: clampSettings(rawSettings),
          realizedPnlKrw: typeof e.realizedPnlKrw === "number" ? e.realizedPnlKrw : 0,
          tradesDone: typeof e.tradesDone === "number" ? e.tradesDone : 0,
          logs: legacyUnderMinimum
            ? [...logs, { at: Date.now(), message: `⏸ 최소 주문금액 ${krw(BOT_MIN_BUDGET_KRW)} 적용으로 개별 중지` }].slice(-BOT_LOG_MAX)
            : logs,
        };
      });
  } catch {
    return [];
  }
}

function saveRoster(bots: TradeBot[]): void {
  try {
    const roster: RosterEntry[] = bots.map((b) => ({
      id: b.id,
      name: b.name,
      enabled: b.enabled,
      settings: b.settings,
      realizedPnlKrw: b.realizedPnlKrw,
      tradesDone: b.tradesDone,
      logs: b.logs,
    }));
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    // localStorage 불가 환경은 조용히 무시
  }
}

function makeBot(id: string, name: string, settings: BotSettings, enabled = true): TradeBot {
  return {
    id,
    name,
    enabled,
    state: "idle",
    settings,
    targetMarket: null,
    targetNameKo: null,
    entryPrice: null,
    volume: null,
    investedKrw: 0,
    peakPriceSinceEntry: null,
    tradeId: null,
    lastMarketLogAt: null,
    currentPnlRate: null,
    lastMessage: "대기 중",
    lastActionAt: null,
    realizedPnlKrw: 0,
    tradesDone: 0,
    logs: [],
  };
}

const BOT_NAME_RE = /^(?:단타봇|장투봇)([A-Z]+)$/;

/** 1→A, 2→B, ..., 26→Z, 27→AA ... (스프레드시트 열 이름 방식) */
function indexToLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function lettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 단타봇/장투봇 구분 없이 생성 순서대로 A, B, C... 문자를 붙인다(예: 단타봇A, 장투봇B) */
function nextBotName(bots: TradeBot[], botType: BotType): string {
  let max = 0;
  for (const b of bots) {
    const m = BOT_NAME_RE.exec(b.name);
    if (m) max = Math.max(max, lettersToIndex(m[1]));
  }
  return `${BOT_TYPE_LABEL[botType]}${indexToLetters(max + 1)}`;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class BotEngine {
  // 런타임 포지션(진입가/수량 등)은 그대로 초기화하되, 누적 실현손익/거래 횟수/활동 로그는 명단과 함께 복원한다
  private bots: TradeBot[] = loadRoster().map((r) => ({
    ...makeBot(r.id, r.name, r.settings, r.enabled),
    realizedPnlKrw: r.realizedPnlKrw,
    tradesDone: r.tradesDone,
    logs: r.logs,
  }));
  private config: BotEngineConfig = DEFAULT_BOT_ENGINE_CONFIG;
  private enabled = localStorage.getItem(ENABLED_KEY) === "1";
  private scanActive = false;
  private lastScanAt: number | null = null;
  private manualScanUntil: number | null = null;
  private lastSurgeScan = 0;
  private inFlight = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickRunning = false;

  // 리스크 가드 — 앱 재시작 시 초기화된다(런타임 포지션과 동일하게 영속화하지 않음)
  private dailyKey: string = kstDateKey(Date.now());
  private dailyPnlKrw = 0;
  private equityPeakKrw = 0;
  private cumulativeRealizedKrw = 0;
  private buyHaltedByDailyLoss = false;
  private consecutiveApiErrors = 0;

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

  addBot(settings: BotSettings): void {
    this.bots = [...this.bots, makeBot(uid(), nextBotName(this.bots, settings.botType), clampSettings(settings))];
    saveRoster(this.bots);
    this.notify();
  }

  /** 개별 봇의 신규 진입만 켜고 끈다. 보유 중 포지션의 손익 감시와 청산은 중지하지 않는다. */
  setBotEnabled(id: string, on: boolean): void {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot || bot.enabled === on) return;

    const now = Date.now();
    let settings = bot.settings;
    const windowExpired = typeof settings.scanWindow.endAt === "number" && settings.scanWindow.endAt <= now;
    if (on && windowExpired) {
      settings = {
        ...settings,
        scanWindow: {
          ...settings.scanWindow,
          startAt: now,
          endAt: now + settings.scanWindow.durationMinutes * 60_000,
        },
      };
    }

    const canReturnToIdle = bot.state === "idle" || bot.state === "scanning";
    this.patchBot(id, {
      enabled: on,
      settings,
      ...(canReturnToIdle ? { state: "idle" as const } : {}),
      lastMessage: on
        ? this.enabled
          ? "개별 시작, 대기 중"
          : "개별 시작됨 · 전체 봇 꺼짐"
        : bot.state === "holding"
          ? "신규 매수 중지 · 보유 포지션 관리 중"
          : "개별 중지",
      logs: this.appendLogFor(id, on ? "▶️ 개별 봇 시작" : "⏸ 개별 봇 중지 — 신규 매수만 중단"),
    });
    bus.emit(EV.TOAST, `${bot.name} ${on ? "시작" : "중지"}`, on ? "good" : "info");
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

  /** 수동 스캔 창을 5분간 강제로 연다 (개별 봇 세션을 기다리지 않고 즉시 테스트/실행) */
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

  /** 매수/매도 체결을 ROOT/bot_trades_log.csv에 누적 기록(브라우저 개발 모드는 파일시스템이 없어 조용히 스킵) */
  private logTrade(entry: BotTradeLogEntry): void {
    if (!isTauri()) return;
    void invoke("log_bot_trade", { entry }).catch(() => {
      // 로그 기록 실패는 매매 자체를 막지 않는다
    });
  }

  /** 보유 중 시장 스냅샷을 ROOT/bot_market_log.csv에 누적 기록 — trade_id로 거래 결과와 조인해 분석한다 */
  private logMarketSnapshot(entry: BotMarketLogEntry): void {
    if (!isTauri()) return;
    void invoke("log_market_snapshot", { entry }).catch(() => {
      // 로그 기록 실패는 매매 자체를 막지 않는다
    });
  }

  /** KST 날짜가 바뀌면 일일 손실 집계와 매수 중단 플래그를 리셋 */
  private rolloverDailyIfNeeded(now: number): void {
    const key = kstDateKey(now);
    if (key === this.dailyKey) return;
    this.dailyKey = key;
    this.dailyPnlKrw = 0;
    this.buyHaltedByDailyLoss = false;
  }

  /** 매도 실현손익을 반영해 일일 손실 한도/최대 낙폭(MDD)을 판정 — 매도 자체는 막지 않고 신규 매수만 제한/정지시킨다 */
  private recordRealizedPnl(realized: number, now: number): void {
    this.rolloverDailyIfNeeded(now);
    this.dailyPnlKrw += realized;
    this.cumulativeRealizedKrw += realized;
    this.equityPeakKrw = Math.max(this.equityPeakKrw, this.cumulativeRealizedKrw);

    if (!this.buyHaltedByDailyLoss && this.dailyPnlKrw <= -this.config.dailyLossLimitKrw) {
      this.buyHaltedByDailyLoss = true;
      bus.emit(EV.TOAST, `🛑 오늘 손실이 ${krw(this.config.dailyLossLimitKrw)}을 넘어 신규 매수를 중단했어요`, "bad");
    }

    const drawdown = this.equityPeakKrw - this.cumulativeRealizedKrw;
    if (this.enabled && drawdown >= this.config.maxDrawdownKrw) {
      bus.emit(EV.TOAST, `🛑 누적 낙폭이 ${krw(this.config.maxDrawdownKrw)}을 넘어 매수봇을 정지했어요`, "bad");
      this.setEnabled(false);
    }
  }

  /** 실거래 주문/체결조회 실패 연속 횟수를 집계 — 한도 초과 시 엔진 전체를 정지 */
  private registerApiError(): void {
    this.consecutiveApiErrors += 1;
    if (this.enabled && this.consecutiveApiErrors >= this.config.maxConsecutiveApiErrors) {
      bus.emit(EV.TOAST, `🛑 API 오류가 ${this.consecutiveApiErrors}회 연속 발생해 매수봇을 정지했어요`, "bad");
      this.setEnabled(false);
      this.consecutiveApiErrors = 0;
    }
  }

  private patchBot(id: string, patch: Partial<TradeBot>): void {
    this.bots = this.bots.map((b) => (b.id === id ? { ...b, ...patch } : b));
    saveRoster(this.bots);
    this.notify();
  }

  /** botId의 현재 로그에 한 줄 추가(최대 BOT_LOG_MAX건 유지) — this.bots를 그때그때 조회해 항상 최신 로그 위에 이어붙인다 */
  private appendLogFor(botId: string, message: string): BotLogEntry[] {
    const logs = this.bots.find((b) => b.id === botId)?.logs ?? [];
    const next = [...logs, { at: Date.now(), message }];
    return next.length > BOT_LOG_MAX ? next.slice(next.length - BOT_LOG_MAX) : next;
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
    if (!bot.enabled) {
      this.inFlight.delete(botId);
      return;
    }
    const budgetKrw = Math.max(BOT_MIN_BUDGET_KRW, Math.min(bot.settings.budgetKrw, BOT_MAX_BUDGET_KRW));

    if (store.mode === "real" && !store.connected) {
      this.patchBot(botId, {
        state: "scanning",
        lastMessage: "키 미연동으로 대기",
        logs: this.appendLogFor(botId, "⚠️ 키 미연동으로 매수 대기"),
      });
      this.inFlight.delete(botId);
      return;
    }

    if (this.buyHaltedByDailyLoss) {
      this.patchBot(botId, {
        state: "scanning",
        lastMessage: "일일 손실 한도로 매수 중단",
        logs: this.appendLogFor(botId, "🛑 일일 손실 한도로 매수 중단"),
      });
      this.inFlight.delete(botId);
      return;
    }

    this.patchBot(botId, {
      state: "buying",
      targetMarket: market,
      targetNameKo: nameKo,
      lastMessage: `${market} 매수 시도...`,
      lastActionAt: Date.now(),
      logs: this.appendLogFor(botId, `🛒 ${nameKo ?? market} 매수 시도`),
    });

    // 동일 시도에 대해 고정된 identifier — 업비트 측에서 같은 identifier 재요청을 중복 주문으로 거부하게 한다
    const orderIdentifier = `bot-${bot.id}-buy-${uid()}`;
    // 이 거래(매수~매도) 전체를 식별 — bot_trades_log.csv/bot_market_log.csv 조인 키로 쓴다
    const tradeId = uid();

    void (async () => {
      try {
        let entryPrice: number | null = null;
        let volume: number | null = null;

        if (store.mode === "sim") {
          const price = this.getCurrentPrice(market);
          if (price && price > 0) {
            entryPrice = price;
            volume = (budgetKrw * (1 - this.config.feeRate)) / price;
          }
        } else {
          await placeOrder(
            { market, side: "bid", ord_type: "price", price: String(budgetKrw), identifier: orderIdentifier },
            false
          );
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
          if (store.mode === "real") this.registerApiError();
          this.patchBot(botId, {
            state: "error",
            lastMessage: "체결 수량 확인 실패",
            lastActionAt: Date.now(),
            logs: this.appendLogFor(botId, `❌ ${nameKo ?? market} 매수 실패 — 체결 수량 확인 실패`),
          });
          bus.emit(EV.TOAST, `🤖 ${bot.name}: ${market} 체결 수량 확인 실패`, "bad");
          return;
        }

        if (store.mode === "real") this.consecutiveApiErrors = 0;

        this.patchBot(botId, {
          state: "holding",
          targetMarket: market,
          targetNameKo: nameKo,
          entryPrice,
          volume,
          investedKrw: budgetKrw,
          peakPriceSinceEntry: entryPrice,
          tradeId,
          lastMarketLogAt: Date.now(),
          currentPnlRate: 0,
          lastMessage: `${nameKo ?? market} 매수!`,
          lastActionAt: Date.now(),
          logs: this.appendLogFor(botId, `✅ ${nameKo ?? market} 매수 완료 @ ${krw(entryPrice)} (${krw(budgetKrw)})`),
        });
        bus.emit(EV.TOAST, `🤖 ${bot.name} → ${nameKo ?? market} ${store.mode === "sim" ? "[모의] " : ""}매수`, "good");
        if (store.mode === "real") void store.refreshAccounts(); // 자금이 묶인 만큼 금고 표시를 바로 갱신
        this.logTrade({
          timestamp: new Date().toISOString(),
          trade_id: tradeId,
          bot_id: bot.id,
          bot_name: bot.name,
          action: "buy",
          market,
          name_ko: nameKo,
          mode: store.mode,
          price: entryPrice,
          volume,
          invested_krw: budgetKrw,
          pnl_krw: null,
          pnl_rate: null,
          reason: "buy",
        });
      } catch (err) {
        if (store.mode === "real") this.registerApiError();
        this.patchBot(botId, {
          state: "error",
          lastMessage: `매수 오류: ${String(err)}`,
          lastActionAt: Date.now(),
          logs: this.appendLogFor(botId, `❌ 매수 오류: ${String(err)}`),
        });
        bus.emit(EV.TOAST, `🤖 ${bot.name}: 매수 오류`, "bad");
      } finally {
        this.inFlight.delete(botId);
      }
    })();
  }

  private executeSell(
    bot: TradeBot,
    reason: "profit" | "loss" | "timeout" | "signal",
    pnlRate: number,
    detail?: string
  ): void {
    const botId = bot.id;
    if (this.inFlight.has(botId)) return;
    const market = bot.targetMarket;
    const volume = bot.volume;
    const entryPrice = bot.entryPrice;
    if (!market || !volume || !entryPrice) return;

    this.inFlight.add(botId);
    const startMessage =
      reason === "timeout"
        ? "세션 종료, 자동 매도 중..."
        : reason === "signal"
        ? "반전 신호 감지, 매도 중..."
        : reason === "profit"
        ? "익절 매도 중..."
        : "손절 매도 중...";
    this.patchBot(botId, {
      state: "selling",
      lastMessage: startMessage,
      lastActionAt: Date.now(),
      logs: this.appendLogFor(botId, `📤 ${bot.targetNameKo ?? market} ${startMessage}`),
    });

    // 익절/손절 매도는 리스크 방어 목적이므로 매수와 달리 일일 손실 한도로 막지 않는다
    const orderIdentifier = `bot-${bot.id}-sell-${uid()}`;

    void (async () => {
      try {
        if (store.mode === "real") {
          await placeOrder(
            { market, side: "ask", ord_type: "market", volume: String(volume), identifier: orderIdentifier },
            false
          );
        }
        if (store.mode === "real") this.consecutiveApiErrors = 0;

        const currentPrice = this.getCurrentPrice(market) ?? entryPrice * (1 + pnlRate);
        const proceeds = currentPrice * volume * (1 - this.config.feeRate);
        const cost = entryPrice * volume * (1 + this.config.feeRate);
        const realized = proceeds - cost;
        this.recordRealizedPnl(realized, Date.now());

        // 상태는 실제 손익 부호로 정하고, reason은 매도 사유(익절/손절/세션종료/반전신호)로 따로 남긴다
        const soldState = pnlRate >= 0 ? "sold_profit" : "sold_loss";
        const reasonLabel =
          reason === "timeout" ? "세션종료 매도" : reason === "signal" ? "반전신호 매도" : reason === "profit" ? "익절" : "손절";
        const reasonEmoji = reason === "timeout" ? "⏰" : reason === "signal" ? "📉" : reason === "profit" ? "✨" : "💥";
        this.patchBot(botId, {
          state: soldState,
          currentPnlRate: pnlRate,
          realizedPnlKrw: bot.realizedPnlKrw + realized,
          tradesDone: bot.tradesDone + 1,
          lastMessage: `${pnlRate >= 0 ? "+" : ""}${(pnlRate * 100).toFixed(1)}% ${reasonLabel}!`,
          lastActionAt: Date.now(),
          logs: this.appendLogFor(
            botId,
            `${pnlRate >= 0 ? "💰" : "📉"} ${bot.targetNameKo ?? market} ${reasonLabel} @ ${krw(currentPrice)} — ${pnlRate >= 0 ? "+" : ""}${(pnlRate * 100).toFixed(2)}% (${krw(realized)})`
          ),
        });
        bus.emit(
          EV.TOAST,
          `🤖 ${bot.name} ${bot.targetNameKo ?? market} ${reasonEmoji} ${reasonLabel}${detail ? ` (${detail})` : ""} (${(pnlRate * 100).toFixed(1)}%)`,
          pnlRate >= 0 ? "good" : "bad"
        );

        // 원금은 다음 매수 때 다시 그만큼만 쓰고, 수익은 정산기 연출 없이 곧바로 금고에 꽂힌다
        if (store.mode === "sim" && realized > 0) {
          store.creditVaultFromBot(realized);
          bus.emit(EV.BOT_PROFIT_CREDITED, botId, realized);
        } else if (store.mode === "real") {
          void store.refreshAccounts(); // 실거래는 이미 실계좌에 들어간 돈 — 표시만 바로 갱신
        }

        this.logTrade({
          timestamp: new Date().toISOString(),
          trade_id: bot.tradeId ?? "",
          bot_id: bot.id,
          bot_name: bot.name,
          action: "sell",
          market,
          name_ko: bot.targetNameKo,
          mode: store.mode,
          price: currentPrice,
          volume,
          invested_krw: bot.investedKrw,
          pnl_krw: realized,
          pnl_rate: pnlRate,
          reason,
        });
      } catch (err) {
        if (store.mode === "real") this.registerApiError();
        this.patchBot(botId, {
          state: "error",
          lastMessage: `매도 오류: ${String(err)}`,
          lastActionAt: Date.now(),
          logs: this.appendLogFor(botId, `❌ 매도 오류: ${String(err)}`),
        });
        bus.emit(EV.TOAST, `🤖 ${bot.name}: 매도 오류`, "bad");
      } finally {
        this.inFlight.delete(botId);
      }
    })();
  }

  /** 이 봇의 동작 시간대(스캔 창)가 지금 활성인지 — 수동 스캔은 모든 봇에 공통으로 강제 적용된다 */
  private isBotActive(bot: TradeBot, manualActive: boolean, now: number): boolean {
    return bot.enabled && (manualActive || isWithinDailyScanWindow(bot.settings.scanWindow, now));
  }

  private runTick(): void {
    const now = Date.now();
    this.rolloverDailyIfNeeded(now);
    const manualActive = this.manualScanUntil !== null && now < this.manualScanUntil;
    const anyActive = this.bots.some((b) => this.isBotActive(b, manualActive, now));
    this.scanActive = anyActive;
    if (anyActive) this.lastScanAt = now;

    if (isTauri() && !this.tradeStreamStarted) void this.ensureTradeStream();
    this.updateHistory(now);

    const current = this.bots;
    let changed = false;

    const nextBots = current.map((bot) => {
      const active = this.isBotActive(bot, manualActive, now);
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
            return { ...bot, state: "idle" as const, lastMessage: bot.enabled ? "대기 중" : "개별 중지" };
          }
          return bot;
        case "holding": {
          if (!bot.entryPrice || !bot.targetMarket) return bot;
          const price = this.getCurrentPrice(bot.targetMarket);
          if (!price) return bot;
          const pnl = (price * (1 - this.config.feeRate) - bot.entryPrice * (1 + this.config.feeRate)) / bot.entryPrice;
          const peakPriceSinceEntry = Math.max(bot.peakPriceSinceEntry ?? bot.entryPrice, price);
          changed = true;

          const logInterval = MARKET_LOG_INTERVAL_MS[bot.settings.botType];
          const dueForLog = !bot.lastMarketLogAt || now - bot.lastMarketLogAt >= logInterval;
          if (dueForLog && bot.tradeId) {
            const collapse = scoreCollapse({
              peakPrice: peakPriceSinceEntry,
              currentPrice: price,
              history: this.history[bot.targetMarket],
              now,
            });
            this.logMarketSnapshot({
              timestamp: new Date(now).toISOString(),
              trade_id: bot.tradeId,
              bot_id: bot.id,
              bot_name: bot.name,
              market: bot.targetMarket,
              mode: store.mode,
              price,
              pnl_rate: pnl,
              trade_value_accel: collapse.tradeValueAccel,
              bid_ratio: collapse.bidRatio,
              collapse_score: collapse.score,
              retracement: collapse.retracement,
            });
          }

          return {
            ...bot,
            currentPnlRate: pnl,
            peakPriceSinceEntry,
            lastMarketLogAt: dueForLog ? now : bot.lastMarketLogAt,
          };
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
              peakPriceSinceEntry: null,
              tradeId: null,
              lastMarketLogAt: null,
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
              peakPriceSinceEntry: null,
              tradeId: null,
              lastMarketLogAt: null,
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

      if (bot.settings.botType === "scalp") {
        // 단타봇: 세션(스캔 창)이 끝나면 익절/손절 조건과 무관하게 강제 매도
        if (now >= scanWindowEndMs(bot.settings.scanWindow, now)) {
          this.executeSell(bot, "timeout", pnl);
          continue;
        }
        if (pnl >= bot.settings.takeProfitRate) {
          this.executeSell(bot, "profit", pnl);
          continue;
        }
        if (pnl <= -bot.settings.stopLossRate) {
          this.executeSell(bot, "loss", pnl);
          continue;
        }
      } else {
        const heldMs = bot.lastActionAt ? now - bot.lastActionAt : 0;
        const decision = decideLongtermExit({
          pnlRate: pnl,
          takeProfitRate: bot.settings.takeProfitRate,
          stopLossRate: bot.settings.stopLossRate,
          heldMs,
          maxHoldMs: bot.settings.scanWindow.durationMinutes * 60_000,
        });
        if (decision === "wait") continue;
        if (decision !== "evaluate_signal") {
          this.executeSell(bot, decision, pnl);
          continue;
        }
      }

      // 고정 익절/손절 사이에서도 붕괴 스코어(추세 반전 조짐)가 임계값을 넘으면 조기 매도
      // (단타봇은 세션 중, 장투봇은 매수 24시간 이후부터 — 위에서 이미 각자의 조건을 통과한 상태)
      const collapse = scoreCollapse({
        peakPrice: bot.peakPriceSinceEntry ?? bot.entryPrice,
        currentPrice: price,
        history: this.history[bot.targetMarket],
        now,
      });
      if (collapse.score >= COLLAPSE_THRESHOLD) this.executeSell(bot, "signal", pnl, collapse.reasons[0]);
    }

    // 급등 스캔 + 배정(3초 주기) — 봇마다 동작 시간대가 다를 수 있어 배정 대상은 각자의 활성 여부로 다시 거른다
    if (anyActive && now - this.lastSurgeScan >= SURGE_SCAN_INTERVAL_MS) {
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
        (b) =>
          (b.state === "scanning" || b.state === "idle") &&
          !b.targetMarket &&
          !this.inFlight.has(b.id) &&
          this.isBotActive(b, manualActive, now)
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
          logs: this.appendLogFor(bot.id, `🎯 ${coin?.nameKo ?? cand.market} 후보 조준 (${cand.reasons[0]})`),
        });
        this.executeBuy(bot.id, cand.market, coin?.nameKo ?? null);
      }
    }

    if (changed) this.notify();
  }
}

export const botEngine = new BotEngine();
