import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../core/platform";
import type { Account, Candle, CandleUnit, CoinInfo, TradeTick, Ticker } from "../game/types";

/**
 * 업비트 API 클라이언트.
 *
 * - Quotation(시세): Tauri → Rust 커맨드 / 브라우저 개발 → vite 프록시("/upbit-api")
 * - Exchange(잔고·주문): **Tauri Rust 커맨드 전용** — 프론트에서 직접 호출 금지
 *   (docs/upbit-api-implementation-notes.md 원칙)
 * - 실패 시 예외를 던진다. 호출측이 백오프/토스트를 처리한다.
 */

// ---------- Quotation ----------

/** 업비트 /v1/market/all 원본 (필요 필드만) */
interface RawMarket {
  market: string;
  korean_name: string;
  english_name: string;
  market_event?: { warning?: boolean };
}

/** 업비트 ticker 원본 (필요 필드만) */
interface RawTicker {
  market: string;
  trade_price: number;
  signed_change_rate: number;
  acc_trade_price_24h: number;
  high_price: number;
  low_price: number;
  acc_trade_volume_24h: number;
}

async function quotation<T>(path: string, command: string, args: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return (await invoke(command, args)) as T;
  }
  const res = await fetch(`/upbit-api${path}`);
  if (!res.ok) throw new Error(`upbit ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** KRW 마켓 전체 목록 (유의 종목 제외) */
export async function fetchMarkets(): Promise<CoinInfo[]> {
  const raw = await quotation<RawMarket[]>(
    "/v1/market/all?is_details=true",
    "get_markets",
    { isDetails: true }
  );
  return raw
    .filter((m) => m.market.startsWith("KRW-") && m.market_event?.warning !== true)
    .map((m) => ({
      market: m.market,
      nameKo: m.korean_name,
      nameEn: m.english_name,
      symbol: m.market.slice(4), // "KRW-BTC" -> "BTC"
    }));
}

/** 전체 KRW 마켓 현재 시세 — /v1/ticker/all 한 번으로 조회 (rate limit 절약) */
export async function fetchAllKrwTickers(): Promise<Ticker[]> {
  const raw = await quotation<RawTicker[]>(
    "/v1/ticker/all?quote_currencies=KRW",
    "get_quote_tickers",
    { quoteCurrencies: "KRW" }
  );
  return raw.map((t) => ({
    market: t.market,
    price: t.trade_price,
    changeRate24h: t.signed_change_rate,
    accTradePrice24h: t.acc_trade_price_24h,
    high24h: t.high_price,
    low24h: t.low_price,
    accTradeVolume24h: t.acc_trade_volume_24h,
  }));
}

/** 업비트 캔들 원본 (분/초/일/주/월 공통 필드만) */
interface RawCandle {
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_volume: number;
}

/** CandleUnit → 업비트 캔들 경로 (Rust `get_candles`의 timeframe 분기와 1:1 대응) */
function candlePath(unit: CandleUnit): string {
  switch (unit) {
    case "seconds":
      return "/v1/candles/seconds";
    case "1d":
      return "/v1/candles/days";
    case "1w":
      return "/v1/candles/weeks";
    case "1mo":
      return "/v1/candles/months";
    case "1y":
      return "/v1/candles/years";
    default:
      return `/v1/candles/minutes/${unit.replace("m", "")}`;
  }
}

/**
 * 캔들(OHLCV) 조회 — 업비트는 최신순으로 내려주므로 과거→최신 오름차순으로 뒤집어 반환한다
 * (차트 라이브러리는 시간 오름차순 입력을 요구한다).
 * @param to 이 시각(ms, exclusive) 이전 캔들만 조회 — 차트를 과거로 스크롤할 때 페이지네이션 커서로 사용
 */
export async function fetchCandles(
  market: string,
  unit: CandleUnit,
  count = 200,
  to?: number
): Promise<Candle[]> {
  const toParam = to !== undefined ? new Date(to).toISOString() : undefined;
  const query = `market=${encodeURIComponent(market)}&count=${count}${toParam ? `&to=${encodeURIComponent(toParam)}` : ""}`;
  const raw = await quotation<RawCandle[]>(
    `${candlePath(unit)}?${query}`,
    "get_candles",
    { market, timeframe: unit, count, to: toParam }
  );
  return raw
    .map((c) => ({
      time: Math.floor(c.timestamp / 1000),
      open: c.opening_price,
      high: c.high_price,
      low: c.low_price,
      close: c.trade_price,
      volume: c.candle_acc_trade_volume,
    }))
    .sort((a, b) => a.time - b.time);
}

/** 업비트 체결(틱) 원본 */
interface RawTrade {
  sequential_id: number;
  trade_price: number;
  trade_volume: number;
  timestamp: number;
  ask_bid: "ASK" | "BID";
}

/** 최근 체결 내역(틱) 조회 — 업비트 응답 순서(최신순) 그대로 반환 */
export async function fetchRecentTrades(market: string, count = 30): Promise<TradeTick[]> {
  const raw = await quotation<RawTrade[]>(
    `/v1/trades/ticks?market=${encodeURIComponent(market)}&count=${count}`,
    "get_trades",
    { market, count }
  );
  return raw.map((t) => ({
    id: String(t.sequential_id),
    time: t.timestamp,
    price: t.trade_price,
    volume: t.trade_volume,
    side: t.ask_bid === "BID" ? "bid" : "ask",
  }));
}

// ---------- Exchange (Tauri 전용 · 실계좌) ----------

function requireTauri(): void {
  if (!isTauri()) throw new Error("실거래는 데스크톱 앱(Tauri)에서만 가능합니다.");
}

/** 업비트 /v1/accounts 원본 (필요 필드만) */
interface RawAccount {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
}

function mapAccounts(raw: RawAccount[]): Account[] {
  return raw.map((a) => ({
    currency: a.currency,
    balance: Number(a.balance),
    locked: Number(a.locked),
    avgBuyPrice: Number(a.avg_buy_price),
  }));
}

/** ROOT 폴더(실행 파일 옆)에 암호화 저장된 API Key 존재 여부 */
export async function hasSavedKeys(): Promise<boolean> {
  if (!isTauri()) return false; // 브라우저엔 암호화 키 저장소 없음 → 실거래 선택 시 키 입력 유도
  return (await invoke("has_saved_keys")) as boolean;
}

/**
 * 입력받은 API Key를 잔고 조회로 검증 → 암호화 저장(upbitkey.enc) + 세션 연동.
 * 잘못된 키는 저장되지 않고 예외를 던진다.
 */
export async function saveApiKeys(accessKey: string, secretKey: string): Promise<Account[]> {
  requireTauri();
  return mapAccounts(
    (await invoke("save_api_keys", { accessKey, secretKey })) as RawAccount[]
  );
}

/** 저장된 API Key(upbitkey.enc, 구버전 upbitkey 자동 이전)로 세션 연동 + 계좌 반환 */
export async function connectAccount(): Promise<Account[]> {
  requireTauri();
  return mapAccounts((await invoke("connect_upbitkey_account")) as RawAccount[]);
}

/** 세션 연동된 계좌 잔고 조회 */
export async function fetchAccounts(): Promise<Account[]> {
  requireTauri();
  return mapAccounts((await invoke("get_session_accounts")) as RawAccount[]);
}

/** 주문 요청 — Rust OrderRequest와 동일한 snake_case 필드 */
export interface OrderRequest {
  market: string;
  side: "bid" | "ask";
  volume?: string;
  price?: string;
  ord_type: "limit" | "price" | "market";
  identifier?: string;
}

/** 업비트 주문 응답 (필요 필드만) */
export interface OrderResult {
  uuid: string;
  state: string; // wait | watch | done | cancel
  paid_fee?: string;
  executed_volume?: string;
  /** /v1/order (단건 조회)에서만 포함 */
  trades?: { price: string; volume: string; funds: string }[];
}

/**
 * 실주문 전송. dryRun=true면 업비트로 전송하지 않고 모의 응답 반환 (Rust place_order의 안전장치).
 */
export async function placeOrder(order: OrderRequest, dryRun: boolean): Promise<OrderResult> {
  requireTauri();
  return (await invoke("place_order", { order, dryRun })) as OrderResult;
}

/** 주문 단건 조회 (체결 내역 포함) — 주문 생성 응답만 믿지 않고 최종 상태를 확인한다 */
export async function fetchOrder(uuid: string): Promise<OrderResult> {
  requireTauri();
  return (await invoke("get_order", { uuid })) as OrderResult;
}
