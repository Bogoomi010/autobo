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

/** 로봇 매수봇 하나. 명단(id/name)만 영속화하고 런타임 포지션은 영속화하지 않는다 */
export interface TradeBot {
  id: string;
  name: string;
  state: BotState;
  targetMarket: string | null;
  targetNameKo: string | null;
  entryPrice: number | null;
  volume: number | null;
  investedKrw: number;
  currentPnlRate: number | null;
  lastMessage: string;
  lastActionAt: number | null;
  realizedPnlKrw: number;
  tradesDone: number;
}

/** 스캔 창(급등 탐지 시간대) 설정 */
export interface ScanWindowConfig {
  /** KST 기준 시작 시(0-23) */
  startHourKst: number;
  /** KST 기준 시작 분(0-59) */
  startMinute: number;
  /** 창 지속 시간(분) */
  durationMinutes: number;
}

/** 봇 엔진 전역 설정 */
export interface BotEngineConfig {
  /** 봇당 1회 시장가 매수 예산(KRW) */
  budgetKrw: number;
  /** 익절 기준 수익률(예: 0.03 = +3%) */
  takeProfitRate: number;
  /** 손절 기준 손실률(예: 0.02 = -2%, 양수로 표기) */
  stopLossRate: number;
  /** 자동 스캔 창 */
  scanWindow: ScanWindowConfig;
  /** 24시간 누적 거래대금 하한(유동성 필터, KRW) */
  minLiquidityKrw24h: number;
  /** 거래 수수료율(예: 0.0005 = 0.05%) */
  feeRate: number;
}

/** 기본 스캔 창: KST 09:00 ~ 09:30 */
export const DEFAULT_SCAN_WINDOW: ScanWindowConfig = {
  startHourKst: 9,
  startMinute: 0,
  durationMinutes: 30,
};

/** 기본 봇 엔진 설정 */
export const DEFAULT_BOT_ENGINE_CONFIG: BotEngineConfig = {
  budgetKrw: 10_000,
  takeProfitRate: 0.03,
  stopLossRate: 0.02,
  scanWindow: DEFAULT_SCAN_WINDOW,
  minLiquidityKrw24h: 1_000_000_000,
  feeRate: 0.0005,
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
