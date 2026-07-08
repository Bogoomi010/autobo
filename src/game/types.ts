/** 업비트 KRW 마켓 코인 정보 */
export interface CoinInfo {
  /** ex) "KRW-BTC" */
  market: string;
  /** ex) "비트코인" */
  nameKo: string;
  /** ex) "Bitcoin" */
  nameEn: string;
  /** ex) "BTC" */
  symbol: string;
}

/** 실시간 시세 스냅샷 */
export interface Ticker {
  market: string;
  /** 현재가 (KRW) */
  price: number;
  /** 전일 대비 등락률 (signed, ex) 0.031 = +3.1%) */
  changeRate24h: number;
  /** 24h 누적 거래대금 (KRW) — 목록 정렬용 */
  accTradePrice24h: number;
  /** 24h 고가 (KRW) — 트레이딩 보드 헤더용 */
  high24h: number;
  /** 24h 저가 (KRW) — 트레이딩 보드 헤더용 */
  low24h: number;
  /** 24h 누적 거래량 (코인 수량) */
  accTradeVolume24h: number;
}

/** 열린 포지션 — 이 게임에서 매수한 물량만 관리한다 (외부 보유 코인은 건드리지 않음) */
export interface Position {
  id: string;
  market: string;
  nameKo: string;
  symbol: string;
  /** 매수에 쓴 KRW (수수료 포함) */
  investedKrw: number;
  /** 평균 체결가 */
  entryPrice: number;
  /** 보유 수량 (매도 시 이 수량만 매도) */
  volume: number;
  /** selling = 매도 주문 진행 중 (중복 매도 방지) */
  status: "open" | "selling";
  openedAt: number;
}

/** 청산된 거래 기록 */
export interface ClosedTrade {
  market: string;
  nameKo: string;
  symbol: string;
  investedKrw: number;
  /** 매도 정산액 (수수료 차감 후 KRW) */
  payout: number;
  /** 확정 수익률 */
  pnlRate: number;
  reason: "take-profit" | "stop-loss";
  closedAt: number;
}

/** 정산기에서 배출되어 바닥에 놓인 돈뭉치 (아직 안 주움) */
export interface Payout {
  id: string;
  amount: number;
  reason: "take-profit" | "stop-loss";
}

/** 정규화된 캔들(OHLCV) — 업비트 분/초/일/주/월 캔들 응답을 공통 형태로 변환한 값 */
export interface Candle {
  /** 유닉스 타임스탬프 (초) — lightweight-charts 의 `time` 필드로 그대로 사용 */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 캔들 조회 단위 — Rust `get_candles` / 업비트 캔들 API 경로와 1:1 매핑 */
export type CandleUnit =
  | "seconds"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "60m"
  | "240m"
  | "1d"
  | "1w"
  | "1mo"
  | "1y";

/** 개별 체결(틱) — 업비트 `/v1/trades/ticks` 응답을 공통 형태로 변환한 값 */
export interface TradeTick {
  /** 업비트 sequential_id (문자열로 다룸 — 64비트 정밀도 손실 방지) */
  id: string;
  /** 체결 시각 (ms) */
  time: number;
  price: number;
  volume: number;
  /** BID = 매수 체결(상승가 매수 우세), ASK = 매도 체결 */
  side: "bid" | "ask";
}

/** 업비트 계좌 (필요 필드만) */
export interface Account {
  currency: string;
  balance: number;
  locked: number;
  avgBuyPrice: number;
}

/** 로컬 세이브 스키마 (localStorage key: "coin_office") — 잔고는 저장하지 않고 항상 계좌에서 읽는다 */
export interface SaveData {
  carried: number;
  positions: Position[];
  payouts: Payout[];
  trades: ClosedTrade[];
  /** 브라우저 모의 모드 전용 가상 잔고 */
  simBalance?: number;
}
