// 급등 탐지 점수화 알고리즘 (순수 함수). docs/robot-buyer-bot-reference.md 의 원본 설계를 이식.
//
// 종합 점수 = 가중합(0~100). 아래 3개 정규화 성분의 가중 평균 * 100.
//   1) 등락률(24h)         changeFromOpen  가중치 0.45  (게임에는 09:00 시가 캔들 조회가 없어 대용으로 사용)
//   2) 체결대금 가속도     tradeValueAccel 가중치 0.30
//   3) 매수 체결 비중       bidRatio        가중치 0.25
//
// 통과 조건(후보 편입): 유동성 필터(24h 누적 거래대금 >= minLiquidityKrw24h)
//   AND 시장 전체 등락률 분포 대비 z-score >= Z_THRESHOLD(=1.5).
// 이미 다른 봇에 배정된 마켓은 제외한다. 점수 내림차순 정렬.

import type { Ticker } from "../game/types";
import type { BotEngineConfig, SurgeScore, TradeVolumeSnapshot } from "./types";

/** 가중치(합 = 1.0) */
export const SURGE_WEIGHTS = {
  changeFromOpen: 0.45,
  tradeValueAccel: 0.3,
  bidRatio: 0.25,
} as const;

/** z-score 급등 판정 임계값 */
export const Z_THRESHOLD = 1.5;

/** 가속도 클램프 상한(배수) */
export const ACCEL_CAP = 5;

const CHANGE_FROM_OPEN_FULL = 0.1; // +10% 이상이면 만점
const ACCEL_FULL = 5; // 가속 5배 이상이면 만점
const WINDOW_HALF_MS = 30_000; // 30초 버킷

export interface SurgeInputs {
  /** 전체 시세 목록(KRW 마켓만 사용) */
  tickers: Ticker[];
  /** 마켓별 롤링 체결 스냅샷 이력(오래된 순, 최소 최근 60초). Tauri 없이는 빈 객체 — 이 경우 가속도/매수비중은 중립값으로 처리된다 */
  tradeVolumeHistory: Record<string, TradeVolumeSnapshot[]>;
  /** 엔진 설정(유동성 하한 등) */
  config: BotEngineConfig;
  /** 이미 배정되어 제외할 마켓 */
  excludeMarkets?: Iterable<string>;
  /** 기준 시각(테스트 주입용). 기본 Date.now() */
  now?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 체결대금 가속도 = (최근 30초 체결대금) / (직전 30초 체결대금), [0, ACCEL_CAP] 클램프 */
export function computeTradeValueAccel(history: TradeVolumeSnapshot[] | undefined, now: number): number {
  if (!history || history.length < 2) return 1;
  const recentStart = now - WINDOW_HALF_MS;
  const prevStart = now - WINDOW_HALF_MS * 2;

  const withTs = history
    .map((s) => ({ ts: s.last_trade_timestamp ?? 0, v: s.accumulated_trade_value }))
    .filter((s) => s.ts > 0)
    .sort((a, b) => a.ts - b.ts);
  if (withTs.length < 2) return 1;

  const valueAt = (target: number, prefer: "before" | "after"): number => {
    let chosen: number | null = null;
    if (prefer === "after") {
      for (const s of withTs) {
        if (s.ts >= target) {
          chosen = s.v;
          break;
        }
      }
      if (chosen === null) chosen = withTs[withTs.length - 1].v;
    } else {
      for (let i = withTs.length - 1; i >= 0; i -= 1) {
        if (withTs[i].ts <= target) {
          chosen = withTs[i].v;
          break;
        }
      }
      if (chosen === null) chosen = withTs[0].v;
    }
    return chosen;
  };

  const recentValue = Math.max(0, valueAt(now, "before") - valueAt(recentStart, "after"));
  const prevValue = Math.max(0, valueAt(recentStart, "before") - valueAt(prevStart, "after"));
  if (prevValue <= 0) return recentValue > 0 ? ACCEL_CAP : 1;
  return clamp(recentValue / prevValue, 0, ACCEL_CAP);
}

/** 매수 체결 비중 = (bid 누적 증가분) / (전체 누적 증가분), [0,1] 클램프 */
export function computeBidRatio(history: TradeVolumeSnapshot[] | undefined): number {
  if (!history || history.length < 2) return 0.5;
  const first = history[0];
  const last = history[history.length - 1];
  const totalDelta = (last.accumulated_trade_value ?? 0) - (first.accumulated_trade_value ?? 0);
  const bidDelta = (last.accumulated_bid_trade_value ?? 0) - (first.accumulated_bid_trade_value ?? 0);
  if (totalDelta <= 0) return 0.5;
  return clamp(bidDelta / totalDelta, 0, 1);
}

/** changeRate24h 의 시장 횡단면 z-score 맵 */
export function computeChangeRateZScores(tickers: Ticker[]): Record<string, number> {
  const krw = tickers.filter((t) => t.market.startsWith("KRW-"));
  const n = krw.length;
  const result: Record<string, number> = {};
  if (n === 0) return result;
  const mean = krw.reduce((sum, t) => sum + t.changeRate24h, 0) / n;
  const variance = krw.reduce((sum, t) => sum + (t.changeRate24h - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  for (const t of krw) {
    result[t.market] = std > 0 ? (t.changeRate24h - mean) / std : 0;
  }
  return result;
}

/**
 * 급등 후보 점수화. 유동성/z-score 조건을 통과하고 배정되지 않은 KRW 마켓만
 * 점수 내림차순으로 반환한다.
 */
export function scoreSurgeCandidates(inputs: SurgeInputs): SurgeScore[] {
  const { tickers, tradeVolumeHistory, config, excludeMarkets, now = Date.now() } = inputs;

  const excluded = new Set<string>(excludeMarkets ?? []);
  const zScores = computeChangeRateZScores(tickers);
  const results: SurgeScore[] = [];

  for (const ticker of tickers) {
    if (!ticker.market.startsWith("KRW-")) continue;
    if (excluded.has(ticker.market)) continue;
    if (ticker.accTradePrice24h < config.minLiquidityKrw24h) continue;

    const z = zScores[ticker.market] ?? 0;
    if (z < Z_THRESHOLD) continue;

    const changeFromOpen = ticker.changeRate24h;
    const history = tradeVolumeHistory[ticker.market];
    const accel = computeTradeValueAccel(history, now);
    const bidRatio = computeBidRatio(history);

    const nChange = clamp(changeFromOpen / CHANGE_FROM_OPEN_FULL, 0, 1);
    const nAccel = clamp((accel - 1) / (ACCEL_FULL - 1), 0, 1);
    const nBid = clamp((bidRatio - 0.5) * 2, 0, 1); // 매수 우위(>50%)만 가점

    const score =
      (SURGE_WEIGHTS.changeFromOpen * nChange +
        SURGE_WEIGHTS.tradeValueAccel * nAccel +
        SURGE_WEIGHTS.bidRatio * nBid) *
      100;

    results.push({
      market: ticker.market,
      score,
      changeFromOpen,
      tradeValueAccel: accel,
      bidRatio,
      reasons: [
        `등락률 ${changeFromOpen >= 0 ? "+" : ""}${(changeFromOpen * 100).toFixed(1)}%`,
        `체결대금 가속 ${accel.toFixed(1)}배`,
        `매수 체결 ${(bidRatio * 100).toFixed(0)}%`,
        `시장 대비 z=${z.toFixed(1)} 급등`,
      ],
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---- 하락(붕괴) 감지 — 진입 점수화의 반전판. 보유 중 추세가 꺾이는 조기 신호를 잡는 데 쓴다 ----
// (단타봇/장투봇 공통 — 각자 매도 판정을 여는 시점을 지난 뒤부터 적용된다)
//
// 붕괴 점수 = 가중합(0~100). 진입 점수의 3개 성분을 반대로 해석한다.
//   1) 고점 대비 되돌림        retracement     가중치 0.45 (등락률의 반대편)
//   2) 체결대금 감속           decel           가중치 0.30 (가속도의 반대편)
//   3) 매도 체결 우위 전환      askDominance    가중치 0.25 (매수비중의 반대편)
// 임계값(COLLAPSE_THRESHOLD) 이상이면 조기 매도 신호로 판단한다. 고정 익절/손절과는 별개의 보조 신호.

export const COLLAPSE_WEIGHTS = {
  retrace: 0.45,
  decel: 0.3,
  askDominance: 0.25,
} as const;

/** 붕괴 점수 임계값(0~100) */
export const COLLAPSE_THRESHOLD = 25;

const RETRACE_FULL = 0.015; // 진입 후 최고가 대비 -1.5% 되돌림이면 만점
const DECEL_FULL = 0.3; // 최근30초/직전30초 체결대금 비율이 0.3배 이하로 급감하면 만점

export interface CollapseInputs {
  /** 매수 이후 관측된 최고가 */
  peakPrice: number;
  currentPrice: number;
  /** 마켓별 롤링 체결 스냅샷 이력(scoreSurgeCandidates와 동일한 이력 사용) */
  history: TradeVolumeSnapshot[] | undefined;
  now?: number;
}

export interface CollapseScore {
  score: number;
  retracement: number;
  tradeValueAccel: number;
  bidRatio: number;
  reasons: string[];
}

/** 급등 진입 후 하락 반전 조짐을 점수화 — scoreSurgeCandidates의 3개 지표를 반대로 해석한다 */
export function scoreCollapse(inputs: CollapseInputs): CollapseScore {
  const { peakPrice, currentPrice, history, now = Date.now() } = inputs;
  const accel = computeTradeValueAccel(history, now);
  const bidRatio = computeBidRatio(history);
  const retracement = peakPrice > 0 ? Math.max(0, (peakPrice - currentPrice) / peakPrice) : 0;

  const nRetrace = clamp(retracement / RETRACE_FULL, 0, 1);
  const nDecel = clamp((1 - accel) / (1 - DECEL_FULL), 0, 1);
  const nAskDominance = clamp((0.5 - bidRatio) * 2, 0, 1);

  const score =
    (COLLAPSE_WEIGHTS.retrace * nRetrace + COLLAPSE_WEIGHTS.decel * nDecel + COLLAPSE_WEIGHTS.askDominance * nAskDominance) *
    100;

  return {
    score,
    retracement,
    tradeValueAccel: accel,
    bidRatio,
    reasons: [
      `고점 대비 -${(retracement * 100).toFixed(2)}% 되돌림`,
      `체결대금 가속 ${accel.toFixed(2)}배(감속)`,
      `매수체결 ${(bidRatio * 100).toFixed(0)}%(매도 우위 전환)`,
    ],
  };
}
