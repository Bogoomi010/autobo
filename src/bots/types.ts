/**
 * 로봇 매수봇 공용 타입. `docs/robot-buyer-bot-reference.md`에 정리된 원본(React) 설계를
 * 게임(Phaser) 아키텍처로 이식한 것 — 프레임워크 상태 대신 `bus` 이벤트로 UI에 통지한다.
 */

/** Rust `start_trade_volume_stream`이 "trade-volume-snapshot" 이벤트로 emit하는 스냅샷(마켓당 ~1초 간격) */
export interface TradeVolumeSnapshot {
  market: string;
  last_trade_price: number;
  last_trade_volume: number;
  accumulated_volume: number;
  accumulated_trade_value: number;
  accumulated_bid_volume: number;
  accumulated_ask_volume: number;
  accumulated_bid_trade_value: number;
  accumulated_ask_trade_value: number;
  trade_count: number;
  last_trade_timestamp?: number | null;
  ask_bid?: string | null;
}

/** 봇 상태 머신 상태 */
export type BotState =
  | "idle"
  | "scanning"
  | "targeting"
  | "buying"
  | "holding"
  | "selling"
  | "sold_profit"
  | "sold_loss"
  | "error";

/** 로봇 매수봇 하나. 명단(id/name/settings)만 영속화하고 런타임 포지션은 영속화하지 않는다 */
export interface TradeBot {
  id: string;
  name: string;
  /** 이 봇의 신규 매수 허용 여부. false여도 이미 보유한 포지션의 매도 감시는 계속한다. */
  enabled: boolean;
  state: BotState;
  settings: BotSettings;
  targetMarket: string | null;
  targetNameKo: string | null;
  entryPrice: number | null;
  volume: number | null;
  investedKrw: number;
  /** 매수 이후 관측된 최고가 — 붕괴 스코어(고점 대비 되돌림) 계산용 */
  peakPriceSinceEntry: number | null;
  /** 이번 거래 식별자 — bot_trades_log.csv/bot_market_log.csv를 이어붙이는 조인 키 */
  tradeId: string | null;
  /** 시장 스냅샷 로그를 마지막으로 남긴 시각 — 샘플링 주기 판단용 */
  lastMarketLogAt: number | null;
  currentPnlRate: number | null;
  lastMessage: string;
  lastActionAt: number | null;
  realizedPnlKrw: number;
  tradesDone: number;
  /** 최근 활동 로그(조준/매수/매도/오류) — 메모리에만 유지, 최대 BOT_LOG_MAX건. 월드 매수봇 상세 패널용 */
  logs: BotLogEntry[];
}

/** 매수봇 활동 로그 1건 — CSV(§6)와 별개로, 월드에서 바로 훑어볼 수 있는 짧은 인메모리 이력 */
export interface BotLogEntry {
  at: number;
  message: string;
}

/** 스캔 창(급등 탐지 시간대) 설정 */
export interface ScanWindowConfig {
  /** KST 기준 시작 시(0-23). 구버전 반복 스캔 창 및 표시 호환용 */
  startHourKst: number;
  /** KST 기준 시작 분(0-59). 구버전 반복 스캔 창 및 표시 호환용 */
  startMinute: number;
  /** 창 지속 시간(분) */
  durationMinutes: number;
  /** 1회성 스캔 창 시작 시각(epoch ms). 없으면 구버전 KST 반복 창으로 처리한다. */
  startAt?: number;
  /** 1회성 스캔 창 종료 시각(epoch ms). 없으면 구버전 KST 반복 창으로 처리한다. */
  endAt?: number;
}

/**
 * 봇 종류 — 매도 판정을 "언제부터 허용하는지"가 다르다(매도 알고리즘 자체는 공통).
 * - scalp(단타봇): 세션(스캔 창) 안에서만 매도 판정, 세션이 끝나면 보유 중이어도 강제 매도
 * - longterm(장투봇): 손절·익절은 즉시, 붕괴 신호 판정은 24시간 이후, 최대 보유기간에는 강제 청산
 */
export type BotType = "scalp" | "longterm";

export const BOT_TYPE_LABEL: Record<BotType, string> = {
  scalp: "단타봇",
  longterm: "장투봇",
};

/** 장투봇 붕괴 신호 판정 대기시간(24시간). 손절·익절 목표는 이 시간 전에도 즉시 적용한다. */
export const BOT_HOLD_LIMIT_MS = 24 * 60 * 60 * 1000;

/** 장투봇은 최소 1일, 최대 30일까지 한 거래의 보유기간을 설정한다. */
export const BOT_MIN_LONGTERM_DURATION_MINUTES = 24 * 60;
export const BOT_MAX_LONGTERM_DURATION_MINUTES = 30 * 24 * 60;

/**
 * 업비트 KRW 마켓 최소 주문금액(5,000원)에 손실·수수료 완충을 더한 앱 최소 예산과 1회 주문 안전 상한.
 * 매도 후 순실현손익은 다음 매수 원금에 합산하되, 원금은 최소·최대 안전범위를 지킨다.
 * 수익은 매도 즉시 실적과 모의 금고에 반영한다.
 */
export const BOT_MIN_BUDGET_KRW = 6_000;
export const BOT_MAX_BUDGET_KRW = 100_000;

/** 봇 1대별 사용자 설정 — 생성 창에서 입력받아 봇마다 독립적으로 가진다 */
export interface BotSettings {
  /** 단타봇/장투봇 — 보유 시간 제약을 결정하며 생성 후 변경하지 않는다 */
  botType: BotType;
  /** 1회 시장가 매수 예산(KRW) */
  budgetKrw: number;
  /** 익절 기준 수익률(예: 0.03 = +3%) */
  takeProfitRate: number;
  /** 손절 기준 손실률(예: 0.02 = -2%, 양수로 표기) */
  stopLossRate: number;
  /**
   * 투자 시간.
   * - 단타봇: 신규 진입 스캔 창이자 포지션 강제 청산 시각
   * - 장투봇: 신규 진입 스캔 창이면서, 매수 후 한 거래의 최대 보유기간
   */
  scanWindow: ScanWindowConfig;
}

/** 기본 투자 시간: 30분. startHourKst/startMinute는 구버전 반복 창 호환용 기본값이다. */
export const DEFAULT_SCAN_WINDOW: ScanWindowConfig = {
  startHourKst: 9,
  startMinute: 0,
  durationMinutes: 30,
};

/** 봇 생성 창의 기본값 */
export const DEFAULT_BOT_SETTINGS: BotSettings = {
  botType: "scalp",
  budgetKrw: BOT_MIN_BUDGET_KRW,
  takeProfitRate: 0.03,
  stopLossRate: 0.02,
  scanWindow: DEFAULT_SCAN_WINDOW,
};

/** 봇 엔진 전역 설정(사용자가 봇 단위로 바꾸지 않는 값) */
export interface BotEngineConfig {
  /** 24시간 누적 거래대금 하한(유동성 필터, KRW) */
  minLiquidityKrw24h: number;
  /** 거래 수수료율(예: 0.0005 = 0.05%) */
  feeRate: number;
  /** 하루(KST) 누적 실현손익이 이 값 이하로 내려가면 신규 매수를 중단(KRW, 양수) */
  dailyLossLimitKrw: number;
  /** 누적 실현손익 고점 대비 낙폭이 이 값 이상이면 봇 엔진을 정지(KRW, 양수) */
  maxDrawdownKrw: number;
  /** 실거래 모드에서 주문/체결조회가 연속으로 이 횟수만큼 실패하면 봇 엔진을 정지 */
  maxConsecutiveApiErrors: number;
}

/** 기본 봇 엔진 설정 */
export const DEFAULT_BOT_ENGINE_CONFIG: BotEngineConfig = {
  minLiquidityKrw24h: 1_000_000_000,
  feeRate: 0.0005,
  dailyLossLimitKrw: 50_000,
  maxDrawdownKrw: 100_000,
  maxConsecutiveApiErrors: 3,
};

/** 급등 후보 점수 결과 */
export interface SurgeScore {
  market: string;
  /** 종합 점수(가중합, 높을수록 급등 가능성 큼) */
  score: number;
  /** 전일 대비 등락률(0.05 = +5%) — 09:00 시가 기준 캔들을 별도로 조회하지 않고 대용으로 사용 */
  changeFromOpen: number;
  /** 체결대금 가속도(최근 30초 / 직전 30초, 클램프됨) */
  tradeValueAccel: number;
  /** 매수 체결 비중(0~1) */
  bidRatio: number;
  /** UI 표시용 한국어 사유 목록 */
  reasons: string[];
}

/**
 * 매수/매도 로그 1건 — Rust `log_bot_trade` 커맨드로 전달해 ROOT/bot_trades_log.csv에
 * 누적 기록한다. 필드명은 Rust `BotTradeLogEntry` 구조체와 동일한 snake_case를 그대로 쓴다.
 */
export interface BotTradeLogEntry {
  timestamp: string;
  /** 이 거래(매수~매도)의 식별자 — bot_market_log.csv의 같은 trade_id와 조인해서 시장상황 대 수익결과를 비교한다 */
  trade_id: string;
  bot_id: string;
  bot_name: string;
  action: "buy" | "sell";
  market: string;
  name_ko: string | null;
  mode: "sim" | "real";
  price: number;
  volume: number;
  invested_krw: number;
  /** 매도일 때만 값 존재(실현 손익 KRW), 매수는 null */
  pnl_krw: number | null;
  /** 매도일 때만 값 존재(수익률), 매수는 null */
  pnl_rate: number | null;
  reason: "buy" | "profit" | "loss" | "timeout" | "signal";
}

/**
 * 보유 중 시장 스냅샷 1건 — Rust `log_market_snapshot` 커맨드로 전달해 ROOT/bot_market_log.csv에
 * 누적 기록한다. 매수~매도 사이 일정 주기로 남겨, 거래 종료 후 시장 상황과 수익결과를 비교하는 데 쓴다.
 */
export interface BotMarketLogEntry {
  timestamp: string;
  trade_id: string;
  bot_id: string;
  bot_name: string;
  market: string;
  mode: "sim" | "real";
  price: number;
  pnl_rate: number;
  /** 붕괴 스코어 입력값 — 체결대금 가속도(최근30초/직전30초) */
  trade_value_accel: number;
  /** 붕괴 스코어 입력값 — 매수 체결 비중(0~1) */
  bid_ratio: number;
  /** 붕괴 스코어(0~100) — 높을수록 하락 반전 조짐이 강함 */
  collapse_score: number;
  /** 매수 이후 최고가 대비 되돌림(0~1) */
  retracement: number;
}
